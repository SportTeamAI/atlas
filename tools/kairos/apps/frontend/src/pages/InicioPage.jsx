import { useMemo, useState } from 'react'
import { UserCog, Clock, Zap, TrendingUp, LayoutDashboard, Users, CalendarClock, CheckCircle2, Send, ShieldCheck, Building2, Bell, CalendarX } from 'lucide-react'
import { enviarRecordatorios, getDashboard, getEquipos, getEstadoEquipos, getFestivos, getPeriodos } from '../api/client'
import { Btn, Card, PageHeader, Spinner, toast, useFetch } from '../components/ui'

// Etiquetas del flujo por equipo. El estado 'registro' se muestra como "Pendiente"
// (nada cargado) o "En proceso" (parcial) según `tiene_datos` (#1).
const FLUJO = {
  pendiente: { txt: 'Pendiente', cls: 'bg-slate-100 text-slate-400', icon: Clock },
  en_proceso: { txt: 'En proceso', cls: 'bg-sky-100 text-sky-700', icon: Clock },
  pend_validacion: { txt: 'Esperando validación', cls: 'bg-amber-100 text-amber-700', icon: ShieldCheck },
  validado: { txt: 'Validado por líder', cls: 'bg-blue-100 text-blue-700', icon: CheckCircle2 },
  en_th: { txt: 'Enviado a TH', cls: 'bg-emerald-100 text-emerald-700', icon: Send },
  aprobado: { txt: 'Aprobado', cls: 'bg-emerald-100 text-emerald-700', icon: CheckCircle2 },
}
// Estado 'registro' → 'pendiente'/'en_proceso' según si el área ya tiene algo cargado.
const claveFlujo = (st) => {
  const ef = st?.estado_flujo || 'registro'
  return ef === 'registro' ? (st?.tiene_datos ? 'en_proceso' : 'pendiente') : ef
}

// #1 Desglose FINO por las 8 categorías (diurna/nocturna × ordinaria/extra × normal/
// festivo-dominical) para verlo segregado en el resumen "Por tipo".
const COLS_TIPO = [
  { k: 'ORD_DIUR_REG', h: 'Ord.', h2: 'Diurna', t: 'Ordinaria diurna', tone: 'text-slate-600' },
  { k: 'ORD_NOCT_REG', h: 'Ord.', h2: 'Nocturna', t: 'Ordinaria nocturna (recargo 35%)', tone: 'text-amber-700' },
  { k: 'EXT_DIUR_REG', h: 'Extra', h2: 'Diurna', t: 'Extra diurna (25%)', tone: 'text-orange-700' },
  { k: 'EXT_NOCT_REG', h: 'Extra', h2: 'Nocturna', t: 'Extra nocturna (75%)', tone: 'text-orange-800' },
  { k: 'ORD_DIUR_DESC', h: 'Fes/Dom', h2: 'Diurna', t: 'Festivo/dominical diurna', tone: 'text-rose-700' },
  { k: 'ORD_NOCT_DESC', h: 'Fes/Dom', h2: 'Nocturna', t: 'Festivo/dominical nocturna (recargo + nocturno)', tone: 'text-rose-800' },
  { k: 'EXT_DIUR_DESC', h: 'Ext F/D', h2: 'Diurna', t: 'Extra festivo/dominical diurna', tone: 'text-rose-900' },
  { k: 'EXT_NOCT_DESC', h: 'Ext F/D', h2: 'Nocturna', t: 'Extra festivo/dominical nocturna', tone: 'text-rose-900' },
]

export default function InicioPage({ me, onVerArea }) {
  const esRH = me?.rol === 'super_admin'
  const { data, loading } = useFetch(getDashboard, [me?.email])
  const periodos = useFetch(getPeriodos, [me?.email])
  const equipos = useFetch(getEquipos, [me?.email])
  // Preferir el GLOBAL en curso (resumen general). Solo si no hay global abierto —un área
  // que solo ve su período propio— se toma su abierto. (Mismo criterio que Consolidado.)
  const enCurso = (periodos.data || []).find((p) => p.estado === 'abierto' && !p.equipo_id)
    || (periodos.data || []).find((p) => p.estado === 'abierto')
    || (periodos.data || [])[0]
  const estadoEq = useFetch(() => (enCurso ? getEstadoEquipos(enCurso.id) : Promise.resolve([])), [me?.email, enCurso?.id])
  const estadoDe = useMemo(() => Object.fromEntries((estadoEq.data || []).map((x) => [x.equipo_id, x])), [estadoEq.data])

  // Resumen de avance por área. Solo las que tienen gente que LLEVA HORARIO: a un área
  // donde nadie marca turnos (Talento Humano) no se le pide reporte ni se le cuenta.
  const areas = (equipos.data || []).filter((a) => a.n_lleva_horario > 0)
  const listos = areas.filter((a) => ['en_th', 'aprobado'].includes(estadoDe[a.id]?.estado_flujo)).length
  const horasEq = Object.fromEntries((data?.por_equipo || []).map((x) => [x.equipo, x.horas]))
  // Dashboard del operativo (#5): sus empleados con las horas que llevan cargadas.
  const empleadosDash = data?.por_empleado || []
  const semanas = data?.semanas_periodo || []       // #3 semanas ISO del período
  const [vistaEq, setVistaEq] = useState('tipo')     // 'tipo' | 'semana'
  // #7 Días festivos DENTRO del período en curso (KPI para operativos).
  const festivos = useFetch(getFestivos, [me?.email])
  const festivosPeriodo = useMemo(() => {
    if (!enCurso) return 0
    return (festivos.data || []).filter((f) => f.fecha_descanso >= enCurso.fecha_inicio && f.fecha_descanso <= enCurso.fecha_fin).length
  }, [festivos.data, enCurso])
  // Recordatorios inteligentes por correo (#4): solo TH los dispara.
  const [recordando, setRecordando] = useState(false)
  const recordar = async () => {
    setRecordando(true)
    try {
      const r = await enviarRecordatorios()
      const areas = (r.detalle || []).length
      const base = areas === 0 ? 'No hay áreas pendientes por recordar ✓' : `Recordatorios de ${areas} área(s) generados`
      toast(r.smtp ? `${base} y enviados por correo.` : `${base}. Correo simulado (configura SMTP para envío real).`, 'ok')
    } catch (e) { toast(e.message, 'error') } finally { setRecordando(false) }
  }

  return (
    // #4 El Resumen (TH y operativo) ocupa el alto disponible (h-full): no hay scroll
    // de página; solo scrollea la lista (áreas o empleados) dentro de su card.
    <div className="max-w-7xl mx-auto p-5 lg:p-7 h-full flex flex-col min-h-0">
      <PageHeader icon={LayoutDashboard} title={`Hola, ${me?.nombre || (esRH ? 'Talento Humano' : '')}`}
        subtitle={esRH ? 'Resumen del período en curso: cómo va cada área y qué falta.' : 'Resumen de tu equipo: horas que llevan cargadas tus colaboradores este período.'} />
      {loading && <Spinner />}
      {data && (
        <div className="flex-1 min-h-0 flex flex-col gap-4">
          {/* Banner del período en curso */}
          {enCurso && (
            <Card className="p-4 sm:p-5 shrink-0">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 sm:justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center"><CalendarClock size={18} /></span>
                  <div>
                    <div className="text-[11px] text-slate-400 uppercase tracking-wide">Período en curso</div>
                    <div className="font-bold text-slate-800 text-[15px]">{enCurso.nombre} <span className="text-slate-400 font-normal text-[13px]">({enCurso.fecha_inicio} → {enCurso.fecha_fin})</span></div>
                  </div>
                </div>
                <Dato etiqueta="Reporte a TH" valor={enCurso.fecha_corte} tono="text-amber-700" />
                {/* #7 Reporte a financiera solo le interesa a TH. */}
                {esRH && <Dato etiqueta="Reporte a financiera" valor={enCurso.fecha_reporte_financiera || '—'} tono="text-violet-700" />}
                <Dato etiqueta="Día de pago" valor={enCurso.fecha_pago || '—'} tono="text-emerald-700" />
                {esRH && (
                  <Btn size="sm" variant="ghost" onClick={recordar} disabled={recordando}>
                    <Bell size={14} /> {recordando ? 'Enviando…' : 'Recordar pendientes'}
                  </Btn>
                )}
              </div>
            </Card>
          )}

          {/* KPIs en texto (sutil, sin gráficas) */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 shrink-0">
            <Kpi icon={UserCog} label={esRH ? 'Empleados' : 'Mi equipo'} value={data.kpis.empleados} />
            {esRH && <Kpi icon={Building2} label="Áreas" value={data.kpis.equipos} />}
            <Kpi icon={Clock} label="Horas registradas" value={data.kpis.total_horas} accent />
            <Kpi icon={Zap} label="Horas extra" value={data.kpis.horas_extra} />
            <Kpi icon={TrendingUp} label="Con recargo" value={data.kpis.horas_con_recargo} />
            {/* #7 Para operativos, festivos del período en vez del reporte a financiera. */}
            {!esRH && <Kpi icon={CalendarX} label="Festivos del período" value={festivosPeriodo} />}
          </div>

          {/* TH: avance por área. Operativo (#5): sus empleados con las horas cargadas. */}
          {esRH ? (
          <Card className="flex-1 min-h-0 flex flex-col" title={<span className="flex items-center gap-2"><Users size={14} className="text-blue-600" /> Avance por área · {listos}/{areas.length} enviadas a TH</span>}>
            {estadoEq.loading || equipos.loading ? <div className="p-5"><Spinner /></div> : (
              <ul className="flex-1 min-h-0 overflow-y-auto scroll-thin divide-y divide-slate-50">
                {areas.map((a) => {
                  const f = FLUJO[claveFlujo(estadoDe[a.id])]
                  const Icon = f.icon
                  return (
                    <li key={a.id}>
                      <button onClick={() => onVerArea?.(a)}
                        className="w-full flex items-center justify-between gap-3 px-5 py-3 text-left hover:bg-blue-50/60 transition-colors">
                        <div className="min-w-0">
                          <div className="font-medium text-slate-700 text-[14px]">{a.nombre}</div>
                          <div className="text-[12px] text-slate-400">{horasEq[a.nombre] ? `${horasEq[a.nombre]} h registradas` : 'Sin horas aún'}</div>
                        </div>
                        <span className={`inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1 rounded-lg shrink-0 ${f.cls}`}>
                          <Icon size={13} /> {f.txt}
                        </span>
                      </button>
                    </li>
                  )
                })}
                {areas.length === 0 && <li className="px-5 py-6 text-center text-slate-400 text-[13px]">No hay áreas.</li>}
              </ul>
            )}
          </Card>
          ) : (
          <Card className="flex-1 min-h-0 flex flex-col"
            title={<span className="flex items-center gap-2"><Users size={14} className="text-blue-600" /> Mi equipo · horas cargadas ({empleadosDash.length})</span>}
            action={<VistaToggle vista={vistaEq} onChange={setVistaEq} />}>
            {loading ? <div className="p-5"><Spinner /></div> : (
              <div className="flex-1 min-h-0 flex flex-col">
                {/* #2/#3 Desglose por COLUMNAS. El toggle cambia entre por TIPO
                    (ordinarias/recargos/extras/extra c-rec/dom-fes) y por SEMANA. */}
                <div className="flex-1 min-h-0 overflow-auto scroll-thin">
                  <table className="w-full text-[12.5px]">
                    <thead className="sticky top-0 bg-white z-10">
                      <tr className="text-[10px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
                        <th className="text-left font-semibold px-5 py-2 sticky left-0 bg-white">Empleado</th>
                        {vistaEq === 'tipo' ? (
                          COLS_TIPO.map((c) => (
                            <th key={c.k} className="text-right font-semibold px-2 py-1.5 whitespace-nowrap" title={c.t}>
                              <div>{c.h}</div><div className="text-[9px] font-normal text-slate-300 normal-case">{c.h2}</div>
                            </th>
                          ))
                        ) : (
                          semanas.map((sm) => (
                            <th key={sm.n} className="text-right font-semibold px-2 py-1.5"
                              title={`${sm.rango}${sm.parcial ? ' (semana partida: el resto está en otro período)' : ''} · límite ${sm.limite} h/sem`}>
                              <div>{sm.label}{sm.parcial && <span className="text-amber-500" title="parcial"> *</span>}</div>
                              <div className="text-[9px] font-normal text-slate-300 normal-case tabular">{sm.rango.replaceAll('2026-', '')}</div>
                            </th>
                          ))
                        )}
                        <th className="text-right font-semibold px-5 py-2">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {empleadosDash.map((e, i) => (
                        <tr key={e.empleado} className={`border-b border-slate-50 last:border-0 ${i % 2 ? 'bg-slate-50/40' : ''}`}>
                          <td className={`px-5 py-2 sticky left-0 ${i % 2 ? 'bg-slate-50/40' : 'bg-white'}`}>
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-medium text-slate-700 truncate">{e.empleado}</span>
                              {e.reporta && <span className="shrink-0 text-[10px] font-semibold text-blue-600 bg-blue-50 rounded px-1.5 py-0.5">registra</span>}
                            </div>
                          </td>
                          {vistaEq === 'tipo' ? (
                            COLS_TIPO.map((c) => <Celda key={c.k} val={(e.cats || {})[c.k] || 0} tone={c.tone} />)
                          ) : (
                            semanas.map((sm, j) => <Celda key={sm.n} val={(e.semanas || [])[j] || 0} tone="text-sky-700" />)
                          )}
                          <td className="px-5 py-2 text-right font-bold text-slate-800 tabular">{e.horas > 0 ? `${e.horas}` : '—'}</td>
                        </tr>
                      ))}
                      {empleadosDash.length === 0 && <tr><td colSpan={vistaEq === 'tipo' ? COLS_TIPO.length + 2 : semanas.length + 2} className="px-5 py-6 text-center text-slate-400 text-[13px]">Tu equipo no tiene empleados.</td></tr>}
                    </tbody>
                  </table>
                </div>
                <div className="shrink-0 px-5 py-3 border-t border-slate-100 text-[12px] text-slate-400">
                  {vistaEq === 'semana'
                    ? <>La jornada legal es <strong>44 h/semana</strong> (<strong>42 h</strong> desde el 15-jul-2026); las extra se cuentan por semana. <strong>*</strong> = semana partida con otro período (aquí solo cuentan sus días de este período).</>
                    : <>Carga y ajusta los horarios en <strong>Registrar horario</strong>; revisa y envía a validación en <strong>Consolidado y chat</strong>.</>}
                </div>
              </div>
            )}
          </Card>
          )}

          {esRH && (
          <p className="text-[12px] text-slate-400 px-1">
            Revisa el detalle de cada área en <strong>Consolidado y chat</strong>; el reporte con los recargos, en <strong>Reporte de horas</strong>.
          </p>
          )}
        </div>
      )}
    </div>
  )
}

// #3 Toggle "Por tipo" ⇄ "Por semana" del desglose de horas.
function VistaToggle({ vista, onChange }) {
  return (
    <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-[11px]">
      {[['tipo', 'Por tipo'], ['semana', 'Por semana']].map(([v, l]) => (
        <button key={v} onClick={() => onChange(v)}
          className={`px-2.5 py-1 font-medium ${vista === v ? 'bg-blue-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>{l}</button>
      ))}
    </div>
  )
}

// Celda numérica del desglose (#2): la columna con horas se resalta; el 0 se atenúa.
function Celda({ val, tone }) {
  const on = val > 0
  return <td className={`px-2 py-2 text-right tabular ${on ? `font-semibold ${tone || 'text-slate-600'}` : 'text-slate-300'}`}>{on ? val : '0'}</td>
}

function Dato({ etiqueta, valor, tono }) {
  return (
    <div>
      <div className="text-[11px] text-slate-400 uppercase tracking-wide">{etiqueta}</div>
      <div className={`font-semibold tabular text-[14px] ${tono || 'text-slate-700'}`}>{valor}</div>
    </div>
  )
}

function Kpi({ icon: Icon, label, value, accent }) {
  return (
    <div className={`rounded-2xl border p-3 sm:p-4 ${accent ? 'border-blue-200 bg-blue-50/40' : 'border-slate-200 bg-white'}`}>
      <div className="flex items-center gap-2 text-slate-400 text-[11px] sm:text-[12px] mb-1.5"><Icon size={13} /> {label}</div>
      <div className={`font-impact text-2xl sm:text-3xl leading-none ${accent ? 'text-blue-700' : 'text-slate-800'}`}>{value}</div>
    </div>
  )
}
