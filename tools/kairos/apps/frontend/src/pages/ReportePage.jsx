import { useEffect, useMemo, useState } from 'react'
import { FileBarChart2, Download, History, LayoutList, Layers, Send, ShieldCheck, CheckCircle2, Clock } from 'lucide-react'
import { aprobarPeriodo, cerrarPeriodo, getEmpleados, getEquipos, getEstadoEquipos, getPeriodos, getReporte, reabrirPeriodo } from '../api/client'
import { getEmail } from '../api/session'
import { AvisoCorte, Badge, Btn, Card, EmptyState, PageHeader, Select, Spinner, toast, useFetch } from '../components/ui'
import GrillaPeriodo from '../components/GrillaPeriodo'

// Estado del flujo por área para el reporte (#3): TH solo "recibe" desde en_th.
const RECIBIDO = new Set(['en_th', 'aprobado'])
const FLUJO_REP = {
  pendiente: { txt: 'Pendiente', cls: 'bg-slate-100 text-slate-400', icon: Clock },
  en_proceso: { txt: 'En proceso', cls: 'bg-sky-100 text-sky-700', icon: Clock },
  pend_validacion: { txt: 'En validación del líder', cls: 'bg-amber-100 text-amber-700', icon: Clock },
  validado: { txt: 'Validado, sin enviar a TH', cls: 'bg-blue-100 text-blue-700', icon: Clock },
  en_th: { txt: 'En Talento Humano', cls: 'bg-indigo-100 text-indigo-700', icon: ShieldCheck },
  aprobado: { txt: 'Aprobado', cls: 'bg-emerald-100 text-emerald-700', icon: CheckCircle2 },
}

const CAT_LABEL = {
  ORD_DIUR_REG: 'Ord. Diurna', ORD_NOCT_REG: 'Ord. Noct.',
  ORD_DIUR_DESC: 'Diurna Dom/Fes', ORD_NOCT_DESC: 'Noct. Dom/Fes',
  EXT_DIUR_REG: 'Extra Diurna', EXT_NOCT_REG: 'Extra Noct.',
  EXT_DIUR_DESC: 'Ext.D Dom/Fes', EXT_NOCT_DESC: 'Ext.N Dom/Fes',
  LIC_REM: 'Lic. remunerada',  // #10 licencia/beneficio pagado (jornada del día)
}

// Pipeline "enviar a financiera": descarga el ZIP (carpeta del período + un
// Excel "Recargos - <ÁREA>" por área) y CIERRA el período (#11). Se puede
// reabrir desde Configuración si hay que corregir algo.
// Descarga el ZIP (carpeta + Excel por área) para previsualizar (#1).
async function descargarZip(periodoId, nombre) {
  const res = await fetch(`/api/periodos/${periodoId}/exportar-recargos`, {
    method: 'POST', headers: { 'X-Demo-User': getEmail() },
  })
  if (!res.ok) { toast('No se pudo generar el ZIP.', 'error'); return false }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = `${nombre}.zip`; a.click()
  URL.revokeObjectURL(url)
  return true
}

async function enviarAFinanciera(periodoId, nombre) {
  // #1 Se valida el cierre (fecha de corte + horas). Si NO se puede, igual se
  // descarga el ZIP para revisar y se avisa con un toast (no con alert nativo).
  try {
    await cerrarPeriodo(periodoId)
  } catch (e) {
    toast(e.message || 'No se puede cerrar el período todavía. Se descarga solo para revisión.', 'error')
    await descargarZip(periodoId, nombre)
    return false
  }
  await descargarZip(periodoId, nombre)
  toast(`Enviado a financiera y cerrado: ${nombre}.`, 'ok')
  return true
}

export default function ReportePage({ me }) {
  const { data: periodos, loading } = useFetch(getPeriodos, [me?.email])
  const equipos = useFetch(getEquipos, [me?.email])
  const empleados = useFetch(getEmpleados, [me?.email])
  const empMap = useMemo(() => Object.fromEntries((empleados.data || []).map((e) => [e.id, e])), [empleados.data])
  const [selId, setSelId] = useState(null)
  const [areaFiltro, setAreaFiltro] = useState('todos')
  const [vista, setVista] = useState('areas') // 'areas' | 'plana'
  const [modoCol, setModoCol] = useState('categorias') // #3 'categorias' | 'semana'
  const [histOpen, setHistOpen] = useState(false)

  // Por defecto, el período EN CURSO (abierto); si no, el más reciente (#4).
  useEffect(() => {
    if (periodos && selId === null && periodos.length) {
      const enCurso = periodos.find((p) => p.estado === 'abierto')
      setSelId((enCurso || periodos[0]).id)
    }
  }, [periodos, selId])
  const rep = useFetch(() => getReporte(selId), [me?.email, selId])
  const estadoEq = useFetch(() => (selId ? getEstadoEquipos(selId) : Promise.resolve([])), [me?.email, selId])
  const flujoDe = useMemo(() => Object.fromEntries((estadoEq.data || []).map((x) => [x.equipo_id, x.estado_flujo])), [estadoEq.data])
  const datosDe = useMemo(() => Object.fromEntries((estadoEq.data || []).map((x) => [x.equipo_id, x.tiene_datos])), [estadoEq.data])
  const [aprobando, setAprobando] = useState(null)
  const aprobarArea = async (equipoId) => {
    setAprobando(equipoId)
    try { await aprobarPeriodo(selId, { equipo_id: equipoId }); toast('Área aprobada.', 'ok'); rep.reload(); estadoEq.reload() }
    catch (e) { toast(e.message, 'error') } finally { setAprobando(null) }
  }
  const [reabriendo, setReabriendo] = useState(null)
  const reabrirArea = async (equipoId) => {
    setReabriendo(equipoId)
    try { await reabrirPeriodo(selId, { equipo_id: equipoId }); toast('Área reabierta para modificar.', 'ok'); rep.reload(); estadoEq.reload() }
    catch (e) { toast(e.message, 'error') } finally { setReabriendo(null) }
  }
  const sel = (periodos || []).find((p) => p.id === selId)
  // Histórico: incluye los cerrados Y los que están en revisión (ya pasaron, esperan cierre).
  const cerrados = (periodos || []).filter((p) => p.estado === 'cerrado' || p.estado === 'en_revision')
  // Gate del envío a financiera (#3/#19): solo cuando TODAS las áreas están
  // aprobadas Y ya es el día de reporte a financiera.
  const areasTotal = (equipos.data || []).length
  const aprobadas = (equipos.data || []).filter((q) => flujoDe[q.id] === 'aprobado').length
  const todasAprobadas = areasTotal > 0 && aprobadas === areasTotal
  const esDiaFinanciera = (() => {
    if (!sel?.fecha_reporte_financiera) return false
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0)
    const [y, m, d] = sel.fecha_reporte_financiera.split('-').map(Number)
    return hoy >= new Date(y, m - 1, d)
  })()
  const puedeEnviarFin = todasAprobadas && esDiaFinanciera && sel?.estado !== 'cerrado'
  const faltaEnviarFin = !todasAprobadas
    ? `Faltan ${areasTotal - aprobadas} de ${areasTotal} áreas por aprobar`
    : !esDiaFinanciera ? `El envío a Financiera es el ${sel?.fecha_reporte_financiera}` : null

  // Agrupa las filas del reporte por área (usa el equipo del empleado).
  const porArea = useMemo(() => {
    if (!rep.data || vista !== 'areas') return null
    const grupos = {}
    rep.data.filas.forEach((f) => {
      const eq = empMap[f.empleado_id]?.equipo_id
      const k = eq || 'sin-area'
      ;(grupos[k] ||= []).push(f)
    })
    return grupos
  }, [rep.data, vista, empMap])

  const eqMap = Object.fromEntries((equipos.data || []).map((e) => [e.id, e.nombre]))
  // Gate #3: el reporte solo incluye áreas que TH ya recibió (en_th/aprobado).
  const filasVisibles = (rep.data?.filas || []).filter((f) => {
    const eq = empMap[f.empleado_id]?.equipo_id
    if (!RECIBIDO.has(flujoDe[eq])) return false
    if (areaFiltro === 'todos') return true
    return eq === areaFiltro
  })

  return (
    <div className="max-w-7xl mx-auto p-5 lg:p-7">
      <PageHeader icon={FileBarChart2} title="Reporte de horas" subtitle="Se llena a medida que los equipos envían y TH aprueba cada área. Vista por área o plana."
        action={sel && (
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <Btn variant="ghost" onClick={() => descargarZip(sel.id, `${sel.secuencia}. ${sel.nombre}`)}><Download size={15} /> Descargar (previsualizar)</Btn>
            {sel.estado === 'cerrado' ? (
              <Badge tone="cerrado">Cerrado</Badge>
            ) : puedeEnviarFin ? (
              <Btn onClick={async () => { if (await enviarAFinanciera(sel.id, `${sel.secuencia}. ${sel.nombre}`)) { rep.reload(); estadoEq.reload() } }}>
                <Send size={15} /> Enviar a financiera y cerrar
              </Btn>
            ) : (
              <span className="text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">{faltaEnviarFin}</span>
            )}
          </div>
        )} />

      {sel && sel.estado !== 'cerrado' && <AvisoCorte fecha={sel.fecha_reporte_financiera} destino="financiera" />}
      {loading && <Spinner />}
      {periodos && periodos.length === 0 && <EmptyState>No hay períodos.</EmptyState>}
      {periodos && periodos.length > 0 && (
        <>
          {/* Toolbar: período mostrado + histórico + filtro por área + vista */}
          <Card className="p-3 mb-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 text-[13px] flex-wrap">
                <span className="text-slate-400">Período:</span>
                <span className="font-semibold text-slate-700">{sel?.nombre || '—'}</span>
                {sel && <span className="text-slate-500 tabular text-[12px]">({sel.fecha_inicio} → {sel.fecha_fin})</span>}
                {sel && <Badge tone={sel.estado}>{sel.estado === 'abierto' ? 'En curso' : sel.estado === 'cerrado' ? 'Cerrado' : sel.estado}</Badge>}
              </div>
              <Btn size="sm" variant="ghost" onClick={() => setHistOpen(true)}><History size={14} /> Histórico</Btn>
              <div className="flex-1" />
              <span className="text-[12px] text-slate-400">Área:</span>
              <Select value={areaFiltro} onChange={setAreaFiltro} size="sm" className="w-44"
                options={[{ value: 'todos', label: 'Todas las áreas' }, ...(equipos.data || []).map((q) => ({ value: q.id, label: q.nombre }))]} />
              <div className="inline-flex rounded-lg border border-blue-200 overflow-hidden">
                <button onClick={() => setVista('areas')} className={`text-[12px] px-3 py-1.5 inline-flex items-center gap-1 ${vista === 'areas' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600'}`}><Layers size={13} /> Por áreas</button>
                <button onClick={() => setVista('plana')} className={`text-[12px] px-3 py-1.5 inline-flex items-center gap-1 ${vista === 'plana' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600'}`}><LayoutList size={13} /> Lista plana</button>
              </div>
              {/* #3 Desglose de columnas: por categoría o por semana. */}
              <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
                <button onClick={() => setModoCol('categorias')} className={`text-[12px] px-3 py-1.5 ${modoCol === 'categorias' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600'}`}>Categorías</button>
                <button onClick={() => setModoCol('semana')} className={`text-[12px] px-3 py-1.5 ${modoCol === 'semana' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600'}`}>Semana</button>
              </div>
            </div>
          </Card>

          {rep.loading && <Spinner />}
          {rep.error && <Card className="p-5 text-rose-600 text-sm">{rep.error}</Card>}
          {rep.data && vista === 'plana' && <Tabla rep={rep.data} filas={filasVisibles} modoCol={modoCol} />}
          {rep.data && vista === 'areas' && (
            <div className="space-y-4">
              {(equipos.data || [])
                .filter((q) => areaFiltro === 'todos' || areaFiltro === q.id)
                .map((q) => {
                  const estado = flujoDe[q.id] || 'registro'
                  // El estado 'registro' se muestra como Pendiente/En proceso (#1).
                  const dispKey = estado === 'registro' ? (datosDe[q.id] ? 'en_proceso' : 'pendiente') : estado
                  const fl = FLUJO_REP[dispKey]; const Icon = fl.icon
                  const recibido = RECIBIDO.has(estado)
                  const filas = (porArea?.[q.id]) || []
                  return (
                    <Card key={q.id} title={`${q.nombre} (${recibido ? filas.length : 0})`}
                      action={
                        <div className="flex items-center gap-2">
                          <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${fl.cls}`}><Icon size={12} /> {fl.txt}</span>
                          {estado === 'en_th' && (
                            <Btn size="sm" onClick={() => aprobarArea(q.id)} disabled={aprobando === q.id}>
                              <ShieldCheck size={14} /> {aprobando === q.id ? 'Aprobando…' : 'Aprobar'}
                            </Btn>
                          )}
                          {sel?.estado === 'cerrado' && (
                            <Btn size="sm" variant="ghost" onClick={() => reabrirArea(q.id)} disabled={reabriendo === q.id}>
                              {reabriendo === q.id ? 'Reabriendo…' : 'Reabrir'}
                            </Btn>
                          )}
                        </div>
                      }>
                      {recibido
                        ? <Tabla rep={rep.data} filas={filas} sinCard modoCol={modoCol} />
                        : <div className="p-6 text-center text-[13px] text-slate-400">Aún no enviado a Talento Humano. El reporte se carga cuando el área envía y TH aprueba.</div>}
                    </Card>
                  )
                })}
            </div>
          )}
        </>
      )}

      {/* #4 Histórico: modal con los períodos cerrados; al elegir uno se muestra su reporte. */}
      {histOpen && (
        <div className="fixed inset-0 bg-black/30 z-[70] flex items-center justify-center p-4" onClick={() => setHistOpen(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-5 max-h-[80vh] overflow-y-auto scroll-thin" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-3">
              <h3 className="font-bold text-slate-800">Histórico de reportes</h3>
              <button onClick={() => setHistOpen(false)} className="text-slate-400 hover:text-slate-600 text-2xl leading-none">×</button>
            </div>
            {cerrados.length === 0 ? <EmptyState>Aún no hay períodos cerrados.</EmptyState> : (
              <div className="divide-y divide-slate-50">
                {cerrados.map((p) => (
                  <button key={p.id} onClick={() => { setSelId(p.id); setHistOpen(false) }}
                    className="w-full flex items-center justify-between gap-3 px-2 py-2.5 hover:bg-slate-50 rounded-lg text-left">
                    <div>
                      <div className="font-medium text-slate-700 text-[14px]">{p.secuencia}. {p.nombre}</div>
                      <div className="text-[12px] text-slate-400 tabular">{p.fecha_inicio} → {p.fecha_fin} · pago {p.fecha_pago}</div>
                    </div>
                    <span className="text-[12px] text-blue-600 font-medium">Ver detalle →</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Tabla({ rep, filas, sinCard, modoCol = 'categorias' }) {
  // #3 Columnas por CATEGORÍA o por SEMANA (misma tabla, distinto desglose).
  const semana = modoCol === 'semana'
  const cols = semana ? (rep.semanas_periodo || []) : rep.categorias
  const colLabel = (c) => semana ? c.label : (CAT_LABEL[c] || c)
  const colTitle = (c) => semana ? `${c.rango}${c.parcial ? ' (semana partida con otro período)' : ''} · límite ${c.limite} h/sem` : undefined
  const colSub = (c) => semana ? c.rango.replaceAll('2026-', '') : null
  const colVal = (f, c, i) => semana ? ((f.semanas || [])[i] || 0) : (f.categorias[c] || 0)
  const cuerpo = (
    <div className="overflow-x-auto scroll-thin">
      <table className="w-full text-[12px] border-collapse">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
            <th className="sticky left-0 bg-white px-4 py-2.5 font-semibold min-w-[150px]">Empleado</th>
            <th className="px-2 py-2.5 font-semibold text-right">Total</th>
            {cols.map((c, i) => (
              <th key={i} title={colTitle(c)} className="px-2 py-2.5 font-semibold text-right whitespace-nowrap">
                {colLabel(c)}{semana && c.parcial && <span className="text-amber-500"> *</span>}
                {colSub(c) && <div className="text-[9px] font-normal text-slate-300 normal-case tabular">{colSub(c)}</div>}
              </th>
            ))}
            {!semana && <th className="px-2 py-2.5 font-semibold text-right">Novedad</th>}
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.empleado_id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
              <td className="sticky left-0 bg-white px-4 py-2 font-medium text-slate-700">{f.nombre}</td>
              <td className="px-2 py-2 text-right font-mono tabular font-bold text-blue-700">{f.total_neto.toFixed(1)}</td>
              {cols.map((c, i) => {
                const v = colVal(f, c, i)
                return <td key={i} className={`px-2 py-2 text-right font-mono tabular ${v ? 'text-slate-700' : 'text-slate-200'}`}>{v ? v.toFixed(1) : '·'}</td>
              })}
              {!semana && <td className="px-2 py-2 text-right tabular text-slate-500">{f.novedades_dias || '·'}</td>}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-slate-100 font-semibold">
            <td className="sticky left-0 bg-white px-4 py-2.5 text-slate-700">Total</td>
            <td className="px-2 py-2.5 text-right font-mono tabular text-blue-700">{filas.reduce((a, f) => a + f.total_neto, 0).toFixed(1)}</td>
            {cols.map((c, i) => (
              <td key={i} className="px-2 py-2.5 text-right font-mono tabular text-slate-600">
                {(filas.reduce((a, f) => a + colVal(f, c, i), 0) || 0).toFixed(1)}
              </td>
            ))}
            {!semana && <td />}
          </tr>
        </tfoot>
      </table>
    </div>
  )
  return sinCard ? cuerpo : <Card>{cuerpo}</Card>
}
