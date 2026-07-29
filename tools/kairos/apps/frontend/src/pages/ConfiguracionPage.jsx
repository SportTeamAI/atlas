import { useState, useEffect } from 'react'
import { Settings, Users, Clock3, FileText, ShieldCheck, Plus, X, ExternalLink, CalendarRange, CalendarDays, Trash2, ChevronLeft, Upload, Info, Pencil, HeartPulse, KeyRound, Copy, RotateCcw, Scale, Inbox, Check, Bell } from 'lucide-react'
import {
  createBeneficio, createPagoManual, createPeriodo, createTurno, deleteBeneficio, deletePagoManual, deleteTurno,
  generarPeriodos, getBeneficios, getEmpleados, getEquipos, getInactivos, getPagosManuales, getPeriodos, getTurnos,
  patchBeneficio, patchEmpleado, patchEquipo, patchPagoManual, patchPeriodo, patchTurno, reabrirPeriodo,
  getAccesos, otorgarAcceso, revocarAcceso, regenerarAcceso,
  getAjustes, crearAjuste, borrarAjuste, sincronizarBuk,
  getSolicitudes, resolverSolicitud, getReceptores, marcarReceptor,
} from '../api/client'
import { Badge, Btn, Card, Select, Spinner, Switch, PageHeader, confirmar, toast, useFetch } from '../components/ui'
import { CONTRATOS } from '../data/contratos'
import { LICENCIAS } from '../data/licencias'

// #15: se quita "Recargos (ley)" — esa información ya vive en Referencia legal.
// #10: "Equipos/áreas" (con barra, no "y").
const TABS = [
  // Equipos y personas van JUNTOS: la gente depende del área. Todo llega de Buk.
  { key: 'equipos', label: 'Equipos y personas', icon: Users, desc: 'Áreas y su gente, traídas de Buk. Enciende las áreas que operan en la herramienta.' },
  { key: 'turnos', label: 'Turnos', icon: Clock3, desc: 'Catálogo de turnos reutilizables que el registrador aplica al período.' },
  { key: 'contratos', label: 'Contratos', icon: FileText, desc: 'Tipos de contrato laboral con su descripción y norma.' },
  { key: 'accesos', label: 'Accesos', icon: KeyRound, desc: 'Da o quita acceso al sistema y genera el enlace para que cada quien cree su contraseña.' },
  // TEMPORAL: esta pestaña desaparece cuando las solicitudes se resuelvan desde la campana
  // (modal con el historial). Se mantiene mientras tanto para que TH pueda aprobarlas.
  { key: 'solicitudes', label: 'Solicitudes de los líderes', icon: Inbox, desc: 'Peticiones de los líderes: que alguien lleve horario o tenga acceso. Aquí se aprueban y se decide a quién de TH le llegan.' },
  { key: 'ajustes', label: 'Ajustes de nómina', icon: Scale, desc: 'Descuenta o agrega horas de un tipo a un empleado sin tocar lo reportado; queda nota en el chat.' },
  { key: 'periodos', label: 'Períodos (cortes)', icon: CalendarRange, desc: 'Genera el calendario de nómina del año con pagos y cortes a TH.' },
  { key: 'pagos', label: 'Primas y aguinaldo', icon: CalendarDays, desc: 'Registra pagos manuales (primas, aguinaldo) que salen en el calendario.' },
  { key: 'beneficios', label: 'Beneficios / licencias', icon: HeartPulse, desc: 'Crea licencias adicionales de la empresa (ej. día de la familia) y actívalas o no.' },
]

export default function ConfiguracionPage({ me }) {
  // Inicio en home (cards explicativas). Cada card abre su sección.
  const [tab, setTab] = useState(null)
  if (!tab) {
    return (
      <div className="max-w-6xl mx-auto p-5 lg:p-7">
        <PageHeader icon={Settings} title="Configuración" subtitle="Todo lo que Talento Humano puede ajustar para que el sistema funcione bien." />
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {TABS.map((t) => {
            const Icon = t.icon
            return (
              <button key={t.key} onClick={() => setTab(t.key)}
                className="text-left rounded-2xl border border-slate-200 hover:border-blue-300 hover:shadow-md transition p-5 bg-white">
                <div className="flex items-center gap-2.5 mb-2">
                  <span className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center"><Icon size={20} /></span>
                  <div className="font-semibold text-slate-800 text-[15px]">{t.label}</div>
                </div>
                <p className="text-[13px] text-slate-500 leading-snug">{t.desc}</p>
              </button>
            )
          })}
        </div>
      </div>
    )
  }
  // Pestaña abierta: header con regreso y mini-nav lateral.
  return (
    <div className="max-w-6xl mx-auto p-5 lg:p-7">
      <button onClick={() => setTab(null)} className="text-[13px] text-slate-500 hover:text-slate-700 mb-3 inline-flex items-center gap-1">
        <ChevronLeft size={14} /> Volver a configuración
      </button>
      <PageHeader icon={TABS.find((x) => x.key === tab).icon} title={TABS.find((x) => x.key === tab).label} subtitle={TABS.find((x) => x.key === tab).desc} />
      {tab === 'turnos' && <Turnos me={me} />}
      {tab === 'contratos' && <Contratos me={me} />}
      {tab === 'equipos' && <Equipos me={me} />}
      {tab === 'accesos' && <Accesos me={me} />}
      {tab === 'solicitudes' && <Solicitudes me={me} />}
      {tab === 'ajustes' && <Ajustes me={me} />}
      {tab === 'periodos' && <PeriodosCortes me={me} />}
      {tab === 'pagos' && <PagosTab me={me} />}
      {tab === 'beneficios' && <BeneficiosTab me={me} />}
    </div>
  )
}

// ── Accesos (login autogestionado, JWT) ─────────────────────────────────────
function Accesos({ me }) {
  const accesos = useFetch(getAccesos, [me?.email])
  const empleados = useFetch(getEmpleados, [me?.email])     // solo ACTIVOS: a un apagado no se le da acceso
  const equipos = useFetch(() => getEquipos(false, true), [me?.email])
  const [fEmpresa, setFEmpresa] = useState('todas')
  const [fArea, setFArea] = useState('todas')
  const [nuevoEmp, setNuevoEmp] = useState('')
  const [nuevoRol, setNuevoRol] = useState('registrador')
  const [busy, setBusy] = useState(false)
  const [fEstado, setFEstado] = useState('con')   // con | revocados | todos

  const todos = accesos.data || []
  const correosConAcceso = new Set(todos.map((a) => (a.email || '').toLowerCase()))
  const eqById = Object.fromEntries((equipos.data || []).map((q) => [q.id, q]))
  const empresas = [...new Set((equipos.data || []).filter((q) => q.activo).map((q) => q.empresa).filter(Boolean))].sort()
  // Áreas ACTIVAS de la empresa elegida (a un área apagada no se le da acceso).
  const areasVis = (equipos.data || [])
    .filter((q) => q.activo && (fEmpresa === 'todas' || q.empresa === fEmpresa))
    .sort((a, b) => a.nombre.localeCompare(b.nombre))
  const areaIds = new Set(areasVis.map((q) => q.id))
  // Candidatos: empleado ACTIVO, con correo, sin acceso aún, del área/empresa filtrada.
  const sinAcceso = (empleados.data || [])
    .filter((e) => e.email && !correosConAcceso.has(e.email.toLowerCase()))
    .filter((e) => (fArea === 'todas' ? areaIds.has(e.equipo_id) : e.equipo_id === fArea))

  // La tabla respeta los MISMOS filtros de arriba: si estás mirando un área, solo
  // ves los accesos de esa área (no todos). Al revocar, la persona sale de "Con
  // acceso" y queda en "Revocados", que es donde se vuelve a encontrar.
  // Con "Todas las áreas" se ven TODOS los accesos, incluso los de un área apagada: si no,
  // un acceso vivo desaparecería del panel y nadie podría revocarlo.
  const enFiltro = fArea === 'todas' ? todos : todos.filter((a) => a.equipo_id === fArea)
  const nCon = enFiltro.filter((a) => a.activo).length
  const nRev = enFiltro.length - nCon
  const lista = enFiltro.filter((a) => (fEstado === 'todos' ? true : fEstado === 'con' ? a.activo : !a.activo))

  const copiar = async (url) => {
    try { await navigator.clipboard.writeText(url); toast('Enlace copiado. Compártelo con la persona.', 'success') }
    catch { toast(url, 'info') }
  }
  const otorgar = async () => {
    if (!nuevoEmp) return toast('Elige a un integrante.', 'info')
    setBusy(true)
    try {
      const a = await otorgarAcceso(nuevoEmp, nuevoRol)
      accesos.reload(); setNuevoEmp('')
      if (a.onboarding_url) copiar(a.onboarding_url)
    } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }
  const restablecer = async (a) => {
    if (!(await confirmar(`Restablecer el acceso de ${a.nombre}: se genera un enlace nuevo y deberá crear otra vez su contraseña. ¿Continuar?`, { ok: 'Sí, restablecer' }))) return
    try { const r = await regenerarAcceso(a.id); accesos.reload(); if (r.onboarding_url) copiar(r.onboarding_url) }
    catch (e) { toast(e.message, 'error') }
  }
  const revocar = async (a) => {
    if (!(await confirmar(`Revocar el acceso de ${a.nombre}: no podrá entrar (sus horas no se borran). ¿Continuar?`, { ok: 'Sí, revocar', peligro: true }))) return
    try {
      await revocarAcceso(a.id); accesos.reload()
      toast(`${a.nombre} ya no tiene acceso. Queda en «Revocados» por si hay que reactivarlo.`, 'success')
    } catch (e) { toast(e.message, 'error') }
  }

  const ROL_TXT = { super_admin: 'Administrador', lider: 'Líder', registrador: 'Registrador' }
  return (
    <div className="space-y-5">
      <Card title="Dar acceso a un integrante">
        <p className="text-[12px] text-slate-500 px-4 pt-3">
          Solo aparecen personas <strong>activas</strong> de <strong>áreas activas</strong> (a alguien apagado no se le
          puede dar acceso). Se genera su login y un enlace de un solo uso para que cree su contraseña.
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 p-4 items-end">
          {empresas.length > 1 && (
            <div>
              <label className="block text-[12px] font-semibold text-slate-600 mb-1">Empresa</label>
              <Select value={fEmpresa} onChange={(v) => { setFEmpresa(v); setFArea('todas'); setNuevoEmp('') }}
                options={[{ value: 'todas', label: 'Todas' }, ...empresas.map((x) => ({ value: x, label: x }))]} />
            </div>
          )}
          <div>
            <label className="block text-[12px] font-semibold text-slate-600 mb-1">Área</label>
            <Select value={fArea} onChange={(v) => { setFArea(v); setNuevoEmp('') }}
              options={[{ value: 'todas', label: 'Todas las áreas' }, ...areasVis.map((q) => ({ value: q.id, label: q.nombre }))]} />
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-slate-600 mb-1">Persona ({sinAcceso.length})</label>
            <Select value={nuevoEmp} onChange={setNuevoEmp}
              options={[{ value: '', label: sinAcceso.length ? 'Elige…' : 'Todas ya tienen acceso' }, ...sinAcceso.map((e) => ({ value: e.id, label: e.nombre }))]} />
          </div>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="block text-[12px] font-semibold text-slate-600 mb-1">Rol</label>
              <Select value={nuevoRol} onChange={setNuevoRol}
                options={[{ value: 'registrador', label: 'Registrador' }, { value: 'lider', label: 'Líder' }, { value: 'super_admin', label: 'Administrador' }]} />
            </div>
            <Btn onClick={otorgar} disabled={busy}><KeyRound size={14} /> Dar acceso</Btn>
          </div>
        </div>
      </Card>

      <Card title="Accesos del sistema">
        <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
          {[['con', `Con acceso (${nCon})`], ['revocados', `Revocados (${nRev})`], ['todos', `Todos (${enFiltro.length})`]].map(([k, l]) => (
            <button key={k} onClick={() => setFEstado(k)}
              className={`text-[12px] font-semibold px-2.5 py-1 rounded-lg transition ${fEstado === k ? 'bg-[#16697a] text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>{l}</button>
          ))}
          <span className="text-[11.5px] text-slate-400 ml-auto">
            {fArea === 'todas' ? 'Todas las áreas' : eqById[fArea]?.nombre} · el filtro de arriba también aplica aquí
          </span>
        </div>
        {accesos.loading ? <div className="p-5"><Spinner /></div> : (
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
                <th className="px-4 py-2.5 font-semibold">Persona</th>
                <th className="px-3 py-2.5 font-semibold">Rol</th>
                <th className="px-3 py-2.5 font-semibold">Área</th>
                <th className="px-3 py-2.5 font-semibold">Estado</th>
                <th className="px-3 py-2.5 font-semibold text-right">Acciones</th>
              </tr></thead>
              <tbody>
                {lista.map((a) => (
                  <tr key={a.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-slate-700">{a.nombre}</div>
                      <div className="text-[12px] text-slate-400">{a.email}</div>
                    </td>
                    <td className="px-3 py-2.5 text-slate-600 text-[13px]">{ROL_TXT[a.rol] || a.rol}</td>
                    <td className="px-3 py-2.5 text-slate-500 text-[13px]">
                      {a.equipo_nombre || '—'}
                      {a.empleado_activo === null && <div className="text-[10.5px] text-amber-600 font-medium mt-0.5">no está en Buk</div>}
                      {a.empleado_activo === false && <div className="text-[10.5px] text-rose-500 font-medium mt-0.5">empleado apagado</div>}
                    </td>
                    <td className="px-3 py-2.5"><EstadoAcceso a={a} /></td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-1.5 flex-wrap">
                        {a.onboarding_pendiente && a.onboarding_url && (
                          <button onClick={() => copiar(a.onboarding_url)} title="Copiar enlace de onboarding"
                            className="inline-flex items-center gap-1 text-[12px] font-medium text-[#16697a] hover:bg-[#16697a]/5 px-2 py-1 rounded-lg"><Copy size={13} /> Copiar enlace</button>
                        )}
                        {a.activo && !a.onboarding_pendiente && (
                          <button onClick={() => restablecer(a)} title="Restablecer contraseña (nuevo enlace)"
                            className="inline-flex items-center gap-1 text-[12px] font-medium text-slate-500 hover:bg-slate-100 px-2 py-1 rounded-lg"><RotateCcw size={13} /> Restablecer</button>
                        )}
                        {a.activo && a.id !== me?.id && (
                          <button onClick={() => revocar(a)} className="inline-flex items-center gap-1 text-[12px] font-medium text-rose-500 hover:bg-rose-50 px-2 py-1 rounded-lg"><X size={13} /> Revocar</button>
                        )}
                        {!a.activo && (
                          <button onClick={() => restablecer(a)} className="inline-flex items-center gap-1 text-[12px] font-medium text-emerald-600 hover:bg-emerald-50 px-2 py-1 rounded-lg"><RotateCcw size={13} /> Reactivar</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {lista.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-[13px] text-slate-400">
                  {fEstado === 'revocados' ? 'No hay accesos revocados aquí.'
                    : fArea === 'todas' ? 'Aún no hay accesos.' : 'Esta área no tiene accesos todavía.'}
                </td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}


// ── Solicitudes de los líderes ──────────────────────────────────────────────
// El líder no cambia nada por su cuenta: pide y TH resuelve. Aprobar APLICA el cambio.
function Solicitudes({ me }) {
  const sols = useFetch(getSolicitudes, [me?.email])
  const receptores = useFetch(getReceptores, [me?.email])
  const [filtro, setFiltro] = useState('pendiente')
  const [busy, setBusy] = useState(null)

  const todas = sols.data || []
  const nPend = todas.filter((x) => x.estado === 'pendiente').length
  const lista = todas.filter((x) => (filtro === 'todas' ? true : x.estado === filtro))

  const resolver = async (sol, aprobar) => {
    const verbo = aprobar ? 'Aprobar' : 'Rechazar'
    const que = sol.tipo === 'lleva_horario'
      ? `${sol.empleado_nombre} empezará a aparecer para reportar horas.`
      : `${sol.empleado_nombre} tendrá acceso con rol registrador (se le genera su enlace).`
    if (!(await confirmar(`${verbo} la solicitud de ${sol.solicitado_por}. ${aprobar ? que : 'No se aplica ningún cambio.'} ¿Continuar?`,
      { ok: `Sí, ${verbo.toLowerCase()}`, peligro: !aprobar }))) return
    setBusy(sol.id)
    try {
      await resolverSolicitud(sol.id, aprobar, null)
      sols.reload()
      toast(aprobar ? 'Aprobada y aplicada. Le avisamos al líder.' : 'Rechazada. Le avisamos al líder.', 'success')
    } catch (e) { toast(e.message, 'error') } finally { setBusy(null) }
  }
  const toggleReceptor = async (r) => {
    setBusy(r.id)
    try { await marcarReceptor(r.id, !r.recibe); receptores.reload() }
    catch (e) { toast(e.message, 'error') } finally { setBusy(null) }
  }

  const EST = {
    pendiente: 'bg-amber-100 text-amber-700',
    aprobada: 'bg-emerald-100 text-emerald-700',
    rechazada: 'bg-slate-100 text-slate-500',
  }
  return (
    <div className="space-y-5">
      <Card title={<span className="flex items-center gap-2"><Bell size={14} className="text-[#16697a]" /> ¿A quién de Talento Humano le llegan?</span>}>
        <p className="text-[12px] text-slate-500 px-4 pt-3">
          Marca quién recibe la notificación cuando un líder hace una solicitud. Quien lidera
          Talento Humano la recibe <strong>siempre</strong> y no se puede desmarcar.
        </p>
        {receptores.loading ? <div className="p-5"><Spinner /></div> : (
          <div className="p-4 flex flex-wrap gap-2">
            {(receptores.data || []).map((r) => (
              <button key={r.id} onClick={() => !r.fijo && toggleReceptor(r)} disabled={r.fijo || busy === r.id}
                title={r.fijo ? 'Lidera Talento Humano: recibe siempre.' : (r.recibe ? 'Clic para que deje de recibir' : 'Clic para que reciba')}
                className={`inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-3 py-1.5 rounded-xl border transition ${
                  r.recibe ? 'border-[#16697a]/30 bg-[#16697a]/5 text-[#16697a]' : 'border-slate-200 bg-white text-slate-400 hover:border-slate-300'
                } ${r.fijo ? 'cursor-default' : ''}`}>
                {r.recibe && <Check size={13} />} {r.nombre}
                {r.fijo && <span className="text-[10px] font-bold uppercase opacity-60">fija</span>}
              </button>
            ))}
          </div>
        )}
      </Card>

      <Card title={`Solicitudes${nPend ? ` · ${nPend} sin resolver` : ''}`}>
        <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
          {[['pendiente', `Sin resolver (${nPend})`], ['aprobada', 'Aprobadas'], ['rechazada', 'Rechazadas'], ['todas', `Todas (${todas.length})`]].map(([k, l]) => (
            <button key={k} onClick={() => setFiltro(k)}
              className={`text-[12px] font-semibold px-2.5 py-1 rounded-lg transition ${filtro === k ? 'bg-[#16697a] text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>{l}</button>
          ))}
        </div>
        {sols.loading ? <div className="p-5"><Spinner /></div> : (
          <div className="overflow-x-auto scroll-thin mt-2">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
                <th className="px-4 py-2.5 font-semibold">Persona</th>
                <th className="px-3 py-2.5 font-semibold">Qué pide</th>
                <th className="px-3 py-2.5 font-semibold">Lo pide</th>
                <th className="px-3 py-2.5 font-semibold">Estado</th>
                <th className="px-3 py-2.5 font-semibold text-right">Acciones</th>
              </tr></thead>
              <tbody>
                {lista.map((x) => (
                  <tr key={x.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-slate-700">{x.empleado_nombre}</div>
                      <div className="text-[12px] text-slate-400">{x.equipo_nombre}</div>
                    </td>
                    <td className="px-3 py-2.5 text-slate-600 text-[13px]">
                      {x.tipo_texto}
                      {x.motivo && <div className="text-[12px] text-slate-400 italic">«{x.motivo}»</div>}
                    </td>
                    <td className="px-3 py-2.5 text-slate-500 text-[12.5px]">{x.solicitado_por || '—'}</td>
                    <td className="px-3 py-2.5">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${EST[x.estado]}`}>
                        {x.estado === 'pendiente' ? 'Sin resolver' : x.estado === 'aprobada' ? 'Aprobada' : 'Rechazada'}
                      </span>
                      {x.resuelto_por && <div className="text-[11px] text-slate-400 mt-0.5">por {x.resuelto_por}</div>}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-1.5">
                        {x.estado === 'pendiente' ? (
                          <>
                            <Btn size="sm" onClick={() => resolver(x, true)} disabled={busy === x.id}>{busy === x.id ? '…' : <><Check size={13} /> Aprobar</>}</Btn>
                            <Btn size="sm" variant="ghost" onClick={() => resolver(x, false)} disabled={busy === x.id}><X size={13} /> Rechazar</Btn>
                          </>
                        ) : <span className="text-slate-300">—</span>}
                      </div>
                    </td>
                  </tr>
                ))}
                {lista.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-[13px] text-slate-400">
                  {filtro === 'pendiente' ? 'No hay solicitudes sin resolver ✓' : 'Nada por aquí.'}
                </td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}


// Estado del acceso en una línea: punto de color + una palabra. El detalle largo va en
// el title (tooltip), para que la tabla no se rompa en tres renglones.
function EstadoAcceso({ a }) {
  const e = !a.activo ? ['bg-slate-300', 'text-slate-500', 'Revocado', 'No puede entrar. Sus horas no se borran.']
    : a.tiene_password ? ['bg-emerald-500', 'text-emerald-700', 'Activo', 'Ya creó su contraseña y puede entrar.']
      : a.onboarding_pendiente ? ['bg-amber-500', 'text-amber-700', 'Enlace enviado', 'Tiene enlace de un solo uso; falta que cree su contraseña.']
        : ['bg-slate-300', 'text-slate-500', 'Sin activar', 'No tiene contraseña ni enlace: usa Restablecer para generarle uno.']
  return (
    <span className={`inline-flex items-center gap-1.5 text-[12px] font-semibold whitespace-nowrap ${e[1]}`} title={e[3]}>
      <span className={`w-1.5 h-1.5 rounded-full ${e[0]}`} />{e[2]}
    </span>
  )
}


// ── Ajustes de nómina (TH descuenta/agrega sobre lo reportado) ──────────────
const CATS_AJUSTE = [
  { value: 'ORD_NOCT_REG', label: 'Recargo nocturno (35%)' },
  { value: 'ORD_DIUR_DESC', label: 'Dominical/festivo diurno (80/90%)' },
  { value: 'ORD_NOCT_DESC', label: 'Nocturno + dominical/festivo (115/125%)' },
  { value: 'ORD_DIUR_REG', label: 'Ordinaria diurna (0%)' },
  { value: 'EXT_DIUR_REG', label: 'Extra diurna' },
  { value: 'EXT_NOCT_REG', label: 'Extra nocturna' },
  { value: 'EXT_DIUR_DESC', label: 'Extra diurna dominical/festivo' },
  { value: 'EXT_NOCT_DESC', label: 'Extra nocturna dominical/festivo' },
]

function Ajustes({ me }) {
  const periodos = useFetch(getPeriodos, [me?.email])
  const empleados = useFetch(getEmpleados, [me?.email])
  const [per, setPer] = useState('')
  const [emp, setEmp] = useState('')
  const [cat, setCat] = useState('ORD_NOCT_DESC')
  const [signo, setSigno] = useState('-')   // '-' descuenta | '+' agrega
  const [horas, setHoras] = useState('')
  const [motivo, setMotivo] = useState('')
  const [busy, setBusy] = useState(false)
  // Historial COMPLETO (todos los períodos): se puede VER, pero solo se AJUSTA el actual.
  const historial = useFetch(getAjustes, [me?.email])

  // Solo el período EN CURSO es ajustable: el pasado ya se pagó y el siguiente aún no se reporta.
  const abiertos = (periodos.data || []).filter((p) => p.estado === 'abierto')
  const perById = Object.fromEntries((periodos.data || []).map((p) => [p.id, p]))
  const esAjustable = (a) => perById[a.periodo_id]?.estado === 'abierto'
  // Solo se ajustan horas a quien LLEVA HORARIO (no al rol: un líder con turnos sí va).
  const empList = (empleados.data || []).filter((e) => e.lleva_horario)
  // El período sale del ÁREA del empleado, no se elige suelto: si su área tiene fechas
  // propias (SAC, Incidentes) manda ese; si no, el global. Así el ajuste nunca cae en un
  // período que no es el suyo.
  const empSel = empList.find((e) => e.id === emp)
  const propios = empSel ? abiertos.filter((p) => p.equipo_id === empSel.equipo_id) : []
  const aplican = !empSel ? [] : propios.length ? propios : abiertos.filter((p) => !p.equipo_id)
  const perEfectivo = aplican.find((p) => p.id === per)?.id || aplican[0]?.id || ''
  const guardar = async () => {
    if (!emp) return toast('Elige el empleado.', 'info')
    if (!perEfectivo) return toast('Su área no tiene un período en curso para ajustar.', 'info')
    const h = parseFloat(horas)
    if (!h || h <= 0) return toast('Indica las horas (mayor a 0).', 'info')
    if (!motivo.trim()) return toast('El motivo es obligatorio.', 'info')
    setBusy(true)
    try {
      await crearAjuste({ empleado_id: emp, periodo_id: perEfectivo, categoria: cat, horas: signo === '-' ? -h : h, motivo: motivo.trim() })
      setHoras(''); setMotivo(''); historial.reload()
      toast('Ajuste guardado. Quedó la nota en Consolidado y chat.', 'success')
    } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }
  const quitar = async (a) => {
    if (!(await confirmar('Anular este ajuste. ¿Continuar?', { ok: 'Sí, anular', peligro: true }))) return
    try { await borrarAjuste(a.id); historial.reload() } catch (e) { toast(e.message, 'error') }
  }

  return (
    <div className="space-y-5">
      <Card title="Nuevo ajuste">
        <p className="text-[12px] text-slate-500 px-4 pt-3">No cambia lo que reportó el equipo (la grilla queda igual). Se aplica al reporte a Financiera y al resumen, y se publica una nota en <strong>Consolidado y chat</strong>.</p>
        <div className="p-4 grid sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Empleado</label>
            <Select value={emp} onChange={(v) => { setEmp(v); setPer('') }} options={[{ value: '', label: 'Elige…' }, ...empList.map((e) => ({ value: e.id, label: e.nombre }))]} />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Período en curso (según su área)</label>
            <Select value={perEfectivo} onChange={setPer} disabled={aplican.length < 2}
              options={aplican.length
                ? aplican.map((p) => ({ value: p.id, label: `${p.nombre}${p.area_nombre ? ' · ' + p.area_nombre : ' · todas las áreas'} (${p.fecha_inicio}→${p.fecha_fin})` }))
                : [{ value: '', label: emp ? 'Su área no tiene período en curso' : 'Elige primero el empleado' }]} />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Tipo de hora</label>
            <Select value={cat} onChange={setCat} options={CATS_AJUSTE} />
          </div>
          <div className="flex gap-2">
            <div className="w-28">
              <label className="block text-[11px] font-semibold text-slate-500 mb-1">Acción</label>
              <Select value={signo} onChange={setSigno} options={[{ value: '-', label: 'Descontar' }, { value: '+', label: 'Agregar' }]} />
            </div>
            <div className="flex-1">
              <label className="block text-[11px] font-semibold text-slate-500 mb-1">Horas</label>
              <input type="number" min="0" step="0.5" value={horas} onChange={(e) => setHoras(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] focus:border-[#16697a] outline-none" placeholder="0" />
            </div>
          </div>
          <div className="sm:col-span-2">
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Motivo (obligatorio, sale en el chat)</label>
            <input value={motivo} onChange={(e) => setMotivo(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] focus:border-[#16697a] outline-none" placeholder="Ej: se reportó por error un turno dominical" />
          </div>
          <div className="sm:col-span-2">
            <Btn onClick={guardar} disabled={busy}><Scale size={14} /> {busy ? 'Guardando…' : 'Guardar ajuste'}</Btn>
          </div>
        </div>
      </Card>

      <Card title="Historial de ajustes">
        <p className="text-[12px] text-slate-500 px-4 pt-3">Todos los períodos. Los de períodos ya cerrados quedan como <strong>registro</strong> (solo lectura).</p>
        {historial.loading ? <div className="p-5"><Spinner /></div>
          : (historial.data || []).length === 0 ? <p className="text-[13px] text-slate-400 px-4 py-4">Aún no hay ajustes.</p>
            : (
              <div className="divide-y divide-slate-50 mt-2">
                {(historial.data || []).map((a) => {
                  const p = perById[a.periodo_id]
                  return (
                    <div key={a.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <div>
                        <div className="text-[13.5px] text-slate-700">
                          <strong className={a.horas < 0 ? 'text-rose-600' : 'text-emerald-600'}>{a.horas > 0 ? '+' : ''}{a.horas} h</strong> · {a.categoria_label} · {a.empleado_nombre}
                        </div>
                        <div className="text-[12px] text-slate-400">
                          {p ? `${p.nombre}${p.area_nombre ? ' · ' + p.area_nombre : ''} · ` : ''}{a.motivo} · por {a.creado_por}
                        </div>
                      </div>
                      {esAjustable(a)
                        ? <button onClick={() => quitar(a)} title="Anular" className="text-rose-400 hover:text-rose-600 p-1.5 shrink-0"><Trash2 size={14} /></button>
                        : <span className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 shrink-0">registro</span>}
                    </div>
                  )
                })}
              </div>
            )}
      </Card>
    </div>
  )
}


// ── Períodos / cortes de nómina (GLOBALES, no por equipo) ───────────────────
const ESTADO_PERIODO = { abierto: 'Abierto', programado: 'Programado', en_revision: 'En revisión', cerrado: 'Cerrado' }

function PeriodosCortes({ me }) {
  const periodos = useFetch(getPeriodos, [me?.email])
  const [modal, setModal] = useState(false)         // crear período manual
  const [edit, setEdit] = useState(null)            // editar período (modal, #3)
  const [genModal, setGenModal] = useState(false)   // generar año (modal, #1)
  const [gen, setGen] = useState(null)              // mensaje de resultado
  const [anio, setAnio] = useState(2026)
  const [filtro, setFiltro] = useState('activos')   // activos | cerrados | todos (#4)
  const anioDe = (p) => Number((p.fecha_pago || p.fecha_fin || '').slice(0, 4))
  const delAnio = (periodos.data || []).filter((p) => anioDe(p) === anio)
  const lista = delAnio.filter((p) =>
    filtro === 'todos' ? true : filtro === 'cerrados' ? p.estado === 'cerrado' : p.estado !== 'cerrado')
  // El selector de año SOLO lista años que ya tienen períodos: no aparece el año
  // vacío por adelantado (antes salía 2027 sin nada). Para crear un año nuevo se
  // usa el botón "Generar año", que abre un modal con su propio selector. #1
  const aniosConDatos = [...new Set((periodos.data || []).map(anioDe).filter(Boolean))].sort()
  const aniosOpt = aniosConDatos.length ? aniosConDatos : [2026]

  // Si el año seleccionado dejó de tener datos (p. ej. se recargó), cae al último con datos.
  useEffect(() => {
    if (aniosConDatos.length && !aniosConDatos.includes(anio)) setAnio(Math.max(...aniosConDatos))
  }, [periodos.data])   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-5">
      <Card title="Períodos de nómina"
        action={
          <div className="flex gap-2 items-center">
            <Select value={filtro} onChange={setFiltro} size="sm" className="w-40"
              options={[{ value: 'activos', label: 'Activos' }, { value: 'cerrados', label: 'Cerrados' }, { value: 'todos', label: 'Todos' }]} />
            <div className="w-px h-6 bg-slate-200" />
            <Select value={anio} onChange={(v) => setAnio(Number(v))} size="sm" className="w-24"
              options={aniosOpt.map((y) => ({ value: y, label: String(y) }))} />
            <Btn variant="ghost" onClick={() => { setGen(null); setGenModal(true) }}>
              <Upload size={14} /> Generar año
            </Btn>
            <Btn onClick={() => setModal(true)}><Plus size={14} /> Crear período</Btn>
          </div>
        }>
        <div className="px-5 py-3 bg-blue-50/50 border-b border-blue-100 flex items-start gap-2">
          <Info size={15} className="text-blue-600 mt-0.5 shrink-0" />
          <p className="text-[12px] text-slate-600">
            Un período es quincenal (paga 15 y 30). Los globales aplican a <strong>todos los equipos</strong>; un área puede tener su
            <strong> período propio</strong> (solo ella lo ve, tapa al global que cruce sus fechas). El <strong>corte</strong> (reporte a TH) se calcula
            6 días hábiles antes del pago. Con <strong>Generar año</strong> creas de una vez todas las quincenas de un año (2026 va de julio a diciembre).
            El pasado queda como registro. Solo hay <strong>un período abierto</strong> a la vez por calendario (uno por área si tiene propios).
          </p>
        </div>
        {gen && gen !== 'running' && <p className="text-[12px] text-emerald-700 px-5 pt-3">{gen}</p>}
        {periodos.loading ? <div className="p-5"><Spinner /></div> : lista.length === 0 ? (
          <p className="text-[13px] text-slate-400 px-5 py-6">No hay períodos para este filtro. Usa <strong>Generar año</strong>, <strong>Crear período</strong> o cambia el filtro a <strong>Todos</strong>.</p>
        ) : (
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
                <th className="px-5 py-2.5 font-semibold">#</th>
                <th className="px-3 py-2.5 font-semibold">Período</th>
                <th className="px-3 py-2.5 font-semibold">Rango</th>
                <th className="px-3 py-2.5 font-semibold">Corte (TH)</th>
                <th className="px-3 py-2.5 font-semibold">Financiera</th>
                <th className="px-3 py-2.5 font-semibold">Pago</th>
                <th className="px-3 py-2.5 font-semibold">Estado</th>
                <th /></tr></thead>
              <tbody>
                {lista.map((p) => (
                  <tr key={p.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
                    <td className="px-5 py-2.5 text-slate-400 tabular">{p.secuencia}</td>
                    <td className="px-3 py-2.5 font-medium text-slate-700">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {p.nombre || '—'}
                        {p.area_nombre && <span className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded bg-teal-50 text-teal-700">{p.area_nombre}</span>}
                      </div>
                      {p.nota && <div className="text-[11px] text-slate-400 mt-0.5 font-normal max-w-md">{p.nota}</div>}
                    </td>
                    <td className="px-3 py-2.5 text-slate-500 tabular text-[12px]">{p.fecha_inicio} → {p.fecha_fin}</td>
                    <td className="px-3 py-2.5 text-amber-700 tabular font-semibold">{p.fecha_corte}</td>
                    <td className="px-3 py-2.5 text-violet-600 tabular">{p.fecha_reporte_financiera || '—'}</td>
                    <td className="px-3 py-2.5 text-slate-600 tabular">{p.fecha_pago || '—'}</td>
                    <td className="px-3 py-2.5"><Badge tone={p.estado}>{ESTADO_PERIODO[p.estado] || p.estado}</Badge></td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      <button onClick={() => setEdit(p)} className="text-blue-600 hover:text-blue-700 mr-3" title="Editar fechas"><Pencil size={14} /></button>
                      {p.estado === 'cerrado' && (
                        <button onClick={async () => { await reabrirPeriodo(p.id); periodos.reload() }}
                          className="text-[12px] text-blue-600 hover:text-blue-700 font-medium">Reabrir</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {modal && <ModalCrearPeriodo onClose={() => setModal(false)} onDone={() => { setModal(false); periodos.reload() }} />}
      {edit && <ModalEditarPeriodo periodo={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); periodos.reload() }} />}
      {genModal && <ModalGenerarAnio aniosConDatos={aniosConDatos}
        onClose={() => setGenModal(false)}
        onDone={(msg, y) => { setGen(msg); setGenModal(false); setAnio(y); periodos.reload() }} />}
    </div>
  )
}

// Modal para generar todas las quincenas de un año (#1). Se elige el año aquí
// en vez de dejar años vacíos en el selector de la lista.
function ModalGenerarAnio({ aniosConDatos, onClose, onDone }) {
  const proximo = (aniosConDatos.length ? Math.max(...aniosConDatos) : 2025) + 1
  const opciones = [...Array(4)].map((_, i) => proximo + i)   // próximo + 3 años
  const [anio, setAnio] = useState(proximo)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const yaExiste = aniosConDatos.includes(anio)

  const generar = async () => {
    setBusy(true); setError(null)
    try {
      // 2026 arranca en julio (jul–dic); 2027 en adelante, año completo.
      const payload = anio === 2026 ? { anio: 2026, mes_desde: 7, quincena_desde: 1 } : { anio, mes_desde: 1, quincena_desde: 1 }
      const r = await generarPeriodos(payload)
      onDone(r.creados > 0 ? `Se crearon ${r.creados} períodos de ${anio}.` : `Los períodos de ${anio} ya existían.`, anio)
    } catch (e) { setError(e.message); setBusy(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/30 z-[70] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-1">
          <h3 className="font-bold text-slate-800">Generar año</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <p className="text-[12px] text-slate-500 mb-4">Crea de una vez todas las quincenas del año con sus cortes a TH y días de pago.</p>
        <I label="Año">
          <select className="inp" value={anio} onChange={(e) => setAnio(Number(e.target.value))}>
            {[...new Set([...aniosConDatos, ...opciones])].sort().map((y) => (
              <option key={y} value={y}>{y}{aniosConDatos.includes(y) ? ' (ya existe)' : ''}</option>
            ))}
          </select>
        </I>
        {yaExiste && <p className="text-[12px] text-amber-700 mt-3">Este año ya tiene períodos; no se crearán duplicados.</p>}
        {error && <p className="text-rose-600 text-[13px] mt-3">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
          <Btn onClick={generar} disabled={busy}>{busy ? 'Generando…' : `Generar ${anio}`}</Btn>
        </div>
        <style>{`.inp{width:100%;border:1px solid #afd6df;border-radius:10px;padding:8px 10px;font-size:14px;background:#fff;outline:none}.inp:focus{border-color:#16697a;box-shadow:0 0 0 3px rgba(22,105,122,.15)}`}</style>
      </div>
    </div>
  )
}

// Modal para editar las fechas de un período (#3).
function ModalEditarPeriodo({ periodo, onClose, onDone }) {
  const [f, setF] = useState({
    nombre: periodo.nombre || '', fecha_inicio: periodo.fecha_inicio, fecha_fin: periodo.fecha_fin,
    fecha_corte: periodo.fecha_corte, fecha_pago: periodo.fecha_pago || '', fecha_reporte_financiera: periodo.fecha_reporte_financiera || '',
  })
  const [busy, setBusy] = useState(false); const [error, setError] = useState(null)
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }))
  const guardar = async () => {
    setBusy(true); setError(null)
    // Las fechas opcionales vacías deben ir como null, no como "" (el back las
    // valida como date|None y rechazaría la cadena vacía con un 422).
    const payload = { ...f, fecha_pago: f.fecha_pago || null, fecha_reporte_financiera: f.fecha_reporte_financiera || null }
    try { await patchPeriodo(periodo.id, payload); onDone() }
    catch (e) { setError(e.message); setBusy(false) }
  }
  return (
    <div className="fixed inset-0 bg-black/30 z-[70] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-1">
          <h3 className="font-bold text-slate-800">Editar {periodo.nombre}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <p className="text-[12px] text-slate-500 mb-4">Las fechas se calculan solas, pero si hay una excepción (ej. por prima) puedes ajustarlas aquí.</p>
        <div className="grid grid-cols-2 gap-3">
          <I label="Nombre"><input className="inp" value={f.nombre} onChange={set('nombre')} /></I>
          <div />
          <I label="Inicio"><input type="date" className="inp" value={f.fecha_inicio} onChange={set('fecha_inicio')} /></I>
          <I label="Fin"><input type="date" className="inp" value={f.fecha_fin} onChange={set('fecha_fin')} /></I>
          <I label="Corte (reporte a TH)"><input type="date" className="inp" value={f.fecha_corte} onChange={set('fecha_corte')} /></I>
          <I label="Reporte a financiera"><input type="date" className="inp" value={f.fecha_reporte_financiera} onChange={set('fecha_reporte_financiera')} /></I>
          <I label="Día de pago"><input type="date" className="inp" value={f.fecha_pago} onChange={set('fecha_pago')} /></I>
        </div>
        {error && <p className="text-rose-600 text-[13px] mt-3">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
          <Btn onClick={guardar} disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</Btn>
        </div>
        <style>{`.inp{width:100%;border:1px solid #afd6df;border-radius:10px;padding:8px 10px;font-size:14px;background:#fff;outline:none}.inp:focus{border-color:#16697a;box-shadow:0 0 0 3px rgba(22,105,122,.15)}`}</style>
      </div>
    </div>
  )
}

// Modal para crear un período puntual con inicio/fin/corte.
function ModalCrearPeriodo({ onClose, onDone }) {
  const [f, setF] = useState({ nombre: '', fecha_inicio: '', fecha_fin: '', fecha_corte: '', frecuencia: 'quincenal' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }))
  const guardar = async () => {
    setBusy(true); setError(null)
    try { await createPeriodo(f); onDone() }
    catch (e) { setError(e.message); setBusy(false) }
  }
  return (
    <div className="fixed inset-0 bg-black/30 z-[70] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-1">
          <h3 className="font-bold text-slate-800">Crear período</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <p className="text-[12px] text-slate-500 mb-4">El corte es el deadline para subir los horarios; lo que pase después entra al próximo período.</p>
        <div className="grid grid-cols-2 gap-3">
          <I label="Nombre"><input className="inp" value={f.nombre} onChange={set('nombre')} placeholder="Q1 ago 2026" /></I>
          <I label="Frecuencia">
            <select className="inp" value={f.frecuencia} onChange={set('frecuencia')}>
              <option value="quincenal">Quincenal</option><option value="mensual">Mensual</option>
            </select>
          </I>
          <I label="Inicio"><input type="date" className="inp" value={f.fecha_inicio} onChange={set('fecha_inicio')} /></I>
          <I label="Fin"><input type="date" className="inp" value={f.fecha_fin} onChange={set('fecha_fin')} /></I>
          <I label="Corte (deadline)"><input type="date" className="inp" value={f.fecha_corte} onChange={set('fecha_corte')} /></I>
        </div>
        {error && <p className="text-rose-600 text-[13px] mt-3">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
          <Btn onClick={guardar} disabled={busy || !f.fecha_inicio || !f.fecha_fin || !f.fecha_corte}>{busy ? 'Creando…' : 'Crear'}</Btn>
        </div>
        <style>{`.inp{width:100%;border:1px solid #afd6df;border-radius:10px;padding:8px 10px;font-size:14px;background:#fff;outline:none}.inp:focus{border-color:#16697a;box-shadow:0 0 0 3px rgba(22,105,122,.15)}`}</style>
      </div>
    </div>
  )
}

// ── Pagos manuales: primas y aguinaldo (salen en el calendario) — #8 ─────────
const TIPO_PAGO = { prima: 'Prima', aguinaldo: 'Aguinaldo', otro: 'Otro' }
function PagosTab({ me }) {
  const pagos = useFetch(getPagosManuales, [me?.email])
  const [modal, setModal] = useState(false)   // #2 modal agregar pago
  const borrar = async (id) => { await deletePagoManual(id); pagos.reload() }
  // Más reciente primero (#2).
  const lista = [...(pagos.data || [])].sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''))
  return (
    <Card title="Primas y aguinaldo (pagos manuales)"
      action={<Btn size="sm" onClick={() => setModal(true)}><Plus size={14} /> Agregar</Btn>}>
      <div className="px-5 py-3 bg-blue-50/50 border-b border-blue-100 flex items-start gap-2">
        <Info size={15} className="text-blue-600 mt-0.5 shrink-0" />
        <p className="text-[12px] text-slate-600">Estos pagos no siguen las quincenas: los define <strong>TH con Financiera</strong> (ej. la <strong>prima de junio</strong> se pagó el viernes 5). Al registrarlos aquí, aparecen en el <strong>calendario</strong>.</p>
      </div>
      {pagos.loading ? <div className="p-5"><Spinner /></div> : lista.length === 0 ? (
        <p className="text-[12px] text-slate-400 px-5 py-4">Sin pagos registrados. Usa <strong>Agregar</strong>.</p>
      ) : (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
            <th className="px-5 py-2.5 font-semibold">Tipo</th><th className="px-3 py-2.5 font-semibold">Fecha</th><th className="px-3 py-2.5 font-semibold">Descripción</th><th /></tr></thead>
          <tbody>
            {lista.map((p) => (
              <tr key={p.id} className="border-b border-slate-50 last:border-0">
                <td className="px-5 py-2.5"><Badge tone="aprobado">{TIPO_PAGO[p.tipo] || p.tipo}</Badge></td>
                <td className="px-3 py-2.5 tabular text-blue-700 font-semibold">{p.fecha}</td>
                <td className="px-3 py-2.5 text-slate-600">{p.descripcion || '—'}</td>
                <td className="px-3 py-2.5 text-right"><button onClick={() => borrar(p.id)} className="text-rose-600 hover:text-rose-700"><Trash2 size={14} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {modal && <ModalPago onClose={() => setModal(false)} onDone={() => { setModal(false); pagos.reload() }} />}
    </Card>
  )
}

// #2 Agregar pago manual (prima/aguinaldo) en modal.
function ModalPago({ onClose, onDone }) {
  const [f, setF] = useState({ tipo: 'prima', fecha: '', descripcion: '' })
  const [busy, setBusy] = useState(false); const [error, setError] = useState(null)
  const guardar = async () => {
    if (!f.fecha) { setError('Elige la fecha de pago.'); return }
    setBusy(true); setError(null)
    try { await createPagoManual({ ...f, descripcion: f.descripcion.trim() || null }); onDone() }
    catch (e) { setError(e.message); setBusy(false) }
  }
  return (
    <div className="fixed inset-0 bg-black/30 z-[70] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-3">
          <h3 className="font-bold text-slate-800">Nuevo pago manual</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <div className="space-y-3">
          <div><span className="block text-[12px] font-medium text-slate-500 mb-1.5">Tipo</span>
            <Select value={f.tipo} onChange={(v) => setF((p) => ({ ...p, tipo: v }))} size="sm"
              options={[{ value: 'prima', label: 'Prima' }, { value: 'aguinaldo', label: 'Aguinaldo' }, { value: 'otro', label: 'Otro' }]} /></div>
          <I label="Fecha de pago"><input type="date" className="inp" value={f.fecha} onChange={(e) => setF((p) => ({ ...p, fecha: e.target.value }))} /></I>
          <I label="Descripción (opcional)"><input className="inp" value={f.descripcion} onChange={(e) => setF((p) => ({ ...p, descripcion: e.target.value }))} placeholder="Prima de servicios – junio" /></I>
        </div>
        {error && <p className="text-rose-600 text-[13px] mt-3">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
          <Btn onClick={guardar} disabled={busy}>{busy ? 'Guardando…' : 'Agregar'}</Btn>
        </div>
        <style>{`.inp{width:100%;border:1px solid #afd6df;border-radius:10px;padding:8px 10px;font-size:14px;background:#fff;outline:none}.inp:focus{border-color:#16697a;box-shadow:0 0 0 3px rgba(22,105,122,.15)}`}</style>
      </div>
    </div>
  )
}

// ── Beneficios/licencias de empresa con toggle activa/inactiva (#6) ──────────
function BeneficiosTab({ me }) {
  const bene = useFetch(getBeneficios, [me?.email])
  const [modal, setModal] = useState(false)   // #3 modal agregar beneficio
  const toggle = async (b) => { await patchBeneficio(b.id, { activa: !b.activa }); bene.reload() }
  const borrar = async (id) => { await deleteBeneficio(id); bene.reload() }
  return (
    <div className="space-y-5">
    {/* De la empresa PRIMERO (#3): se activan y se pueden colocar en el día del empleado. */}
    <Card title="Beneficios de la empresa (activables)"
      action={<Btn size="sm" onClick={() => setModal(true)}><Plus size={14} /> Agregar</Btn>}>
      <div className="px-5 py-3 bg-emerald-50/60 border-b border-emerald-100 flex items-start gap-2">
        <Info size={15} className="text-emerald-600 mt-0.5 shrink-0" />
        <p className="text-[12px] text-slate-600">Beneficios <strong>voluntarios</strong> de la empresa. Los que estén <strong>Activos</strong> se pueden <strong>colocar</strong> en el día del empleado (en Registrar horario, junto a las licencias). Agrega, activa/desactiva o elimina.</p>
      </div>
      {bene.loading ? <div className="p-5"><Spinner /></div> : (bene.data || []).length === 0 ? (
        <p className="text-[12px] text-slate-400 px-5 py-4">Sin beneficios. Usa <strong>Agregar</strong>.</p>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 p-4">
          {(bene.data || []).map((b) => (
            <div key={b.id} className={`rounded-xl border p-3.5 ${b.activa ? 'border-emerald-200 bg-emerald-50/30' : 'border-slate-200'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="font-semibold text-slate-700 text-[14px]">{b.nombre}</div>
                <button onClick={() => borrar(b.id)} className="text-slate-300 hover:text-rose-600 shrink-0"><Trash2 size={13} /></button>
              </div>
              <div className="text-[12px] text-slate-500 mt-1">{b.dias} día(s) · {b.remunerada ? 'remunerada' : 'no remunerada'}</div>
              {b.descripcion && <p className="text-[12px] text-slate-500 mt-1.5 line-clamp-3">{b.descripcion}</p>}
              <div className="flex items-center justify-between gap-2 mt-2.5">
                <span className="text-[11px] text-slate-400">{b.base_legal || 'Beneficio de la empresa'}</span>
                <button onClick={() => toggle(b)} className={`text-[12px] font-semibold px-2.5 py-1 rounded-lg shrink-0 ${b.activa ? 'bg-emerald-500/15 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                  {b.activa ? 'Activa' : 'Inactiva'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>

    {/* De ley DESPUÉS (informativo). */}
    <Card title="Beneficios de ley (informativos)">
      <div className="px-5 py-3 bg-blue-50/50 border-b border-blue-100 flex items-start gap-2">
        <Info size={15} className="text-blue-600 mt-0.5 shrink-0" />
        <p className="text-[12px] text-slate-600">Licencias y permisos que exige la ley colombiana. Siempre aplican; se marcan en el día del empleado desde <strong>Registrar horario</strong>. El detalle de cada uno está en la sección <strong>Licencias</strong>.</p>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 p-4">
        {LICENCIAS.map((l) => (
          <div key={l.tipo} className="rounded-xl border border-slate-200 p-3.5">
            <div className="font-semibold text-slate-700 text-[13px]">{l.nombre}</div>
            <div className="text-[12px] text-slate-500 mt-1">{l.duracion} · paga {l.remunerada} ({l.quien_paga})</div>
            <div className="text-[11px] text-slate-400 mt-1.5">{l.base_legal}</div>
          </div>
        ))}
      </div>
    </Card>
    {modal && <ModalBeneficio onClose={() => setModal(false)} onDone={() => { setModal(false); bene.reload() }} />}
    </div>
  )
}

// #3 Agregar beneficio de empresa en modal.
function ModalBeneficio({ onClose, onDone }) {
  const [f, setF] = useState({ nombre: '', dias: 1, descripcion: '', remunerada: true })
  const [busy, setBusy] = useState(false); const [error, setError] = useState(null)
  const guardar = async () => {
    setBusy(true); setError(null)
    try { await createBeneficio({ nombre: f.nombre.trim(), dias: Number(f.dias) || 1, descripcion: f.descripcion.trim() || null, remunerada: f.remunerada, activa: true }); onDone() }
    catch (e) { setError(e.message); setBusy(false) }
  }
  return (
    <div className="fixed inset-0 bg-black/30 z-[70] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-3">
          <h3 className="font-bold text-slate-800">Nuevo beneficio de empresa</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <div className="space-y-3">
          <I label="Nombre"><input className="inp" value={f.nombre} onChange={(e) => setF((p) => ({ ...p, nombre: e.target.value }))} placeholder="Día de la familia" /></I>
          <div className="grid grid-cols-2 gap-3">
            <I label="Días"><input type="number" min="0.5" step="0.5" className="inp" value={f.dias} onChange={(e) => setF((p) => ({ ...p, dias: e.target.value }))} /></I>
            <div className="flex items-end pb-2">
              <Switch checked={f.remunerada} onChange={(v) => setF((p) => ({ ...p, remunerada: v }))} label="Remunerada" />
            </div>
          </div>
          <I label="Descripción (opcional)"><input className="inp" value={f.descripcion} onChange={(e) => setF((p) => ({ ...p, descripcion: e.target.value }))} /></I>
        </div>
        {error && <p className="text-rose-600 text-[13px] mt-3">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
          <Btn onClick={guardar} disabled={busy || !f.nombre.trim()}>{busy ? 'Guardando…' : 'Agregar'}</Btn>
        </div>
        <style>{`.inp{width:100%;border:1px solid #afd6df;border-radius:10px;padding:8px 10px;font-size:14px;background:#fff;outline:none}.inp:focus{border-color:#16697a;box-shadow:0 0 0 3px rgba(22,105,122,.15)}`}</style>
      </div>
    </div>
  )
}


function Turnos({ me }) {
  const { data, loading, reload } = useFetch(getTurnos, [me?.email])
  const equipos = useFetch(getEquipos, [me?.email])
  const eqMap = Object.fromEntries((equipos.data || []).map((q) => [q.id, q.nombre]))
  const [modal, setModal] = useState(null)   // #13 null | {} crear | turno editar
  const [pap, setPap] = useState(false)       // #15 papelera
  // Duración bruta del turno en horas (para saber si el almuerzo aplica, #8).
  const durH = (t) => { const [a, b] = [t.hora_inicio, t.hora_fin].map((s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m }); let d = b - a; if (d <= 0) d += 1440; return d / 60 }
  const desactivar = async (t) => {
    if (!(await confirmar(`¿Eliminar (desactivar) el turno "${t.nombre}"? Se puede recuperar luego desde la Papelera.`, { ok: 'Eliminar', peligro: true }))) return
    try { await patchTurno(t.id, { activo: false }); reload() } catch (e) { toast(e.message, 'error') }
  }
  return (
    <div className="space-y-5">
      <Card title="Turnos disponibles" action={
        <div className="flex gap-2">
          <Btn size="sm" variant="ghost" onClick={() => setPap(true)}><Trash2 size={14} /> Papelera</Btn>
          <Btn size="sm" onClick={() => setModal({})}><Plus size={14} /> Crear turno</Btn>
        </div>}>
        {loading ? <div className="p-5"><Spinner /></div> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
              <th className="px-5 py-2.5 font-semibold">Turno</th><th className="px-3 py-2.5 font-semibold">Abrev.</th><th className="px-3 py-2.5 font-semibold">Horario</th>
              <th className="px-3 py-2.5 font-semibold">Almuerzo</th><th className="px-3 py-2.5 font-semibold">Quién lo usa (áreas)</th><th /></tr></thead>
            <tbody>
              {(data || []).map((t) => (
                <tr key={t.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
                  <td className="px-5 py-2.5 font-medium text-slate-700">{t.nombre}</td>
                  <td className="px-3 py-2.5"><span className="bg-blue-50 text-blue-700 rounded px-1.5 font-semibold">{t.abreviatura}</span></td>
                  <td className="px-3 py-2.5 font-mono text-slate-500">{t.hora_inicio.slice(0, 5)} – {t.hora_fin.slice(0, 5)}</td>
                  <td className="px-3 py-2.5 text-[12px]">
                    {(() => {
                      const usaSAC = (t.equipos_ids || []).some((id) => eqMap[id] === 'Servicio al Cliente')
                      const base = (t.almuerzo_min || 0) === 60 ? '1 h' : `${t.almuerzo_min} min`
                      return <span className="text-slate-600">{base}{usaSAC && <span className="text-amber-600"> · SAC 30 min</span>}</span>
                    })()}
                  </td>
                  <td className="px-3 py-2.5 text-[12px]">
                    {(t.equipos_ids && t.equipos_ids.length)
                      ? <span className="text-slate-600">{t.equipos_ids.map((id) => eqMap[id]).filter(Boolean).join(', ')}</span>
                      : <span className="inline-flex items-center rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5 text-[11px] font-medium">Todas las áreas</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="inline-flex items-center gap-2">
                      <button onClick={() => setModal(t)} title="Editar" className="text-blue-600 hover:text-blue-700"><Pencil size={14} /></button>
                      <button onClick={() => desactivar(t)} title="Eliminar (desactivar)" className="text-slate-300 hover:text-rose-500"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {modal && <ModalTurno turno={modal.id ? modal : null} equipos={equipos.data || []}
        onClose={() => setModal(null)} onDone={() => { setModal(null); reload() }} />}
      {pap && <ModalPapelera recurso="turnos" titulo="Turnos eliminados"
        restore={(id) => patchTurno(id, { activo: true })} borrar={deleteTurno}
        onClose={() => { setPap(false); reload() }} />}
    </div>
  )
}

// #13 Crear/editar turno en modal.
function ModalTurno({ turno, equipos, onClose, onDone }) {
  const [f, setF] = useState({
    nombre: turno?.nombre || '', abreviatura: turno?.abreviatura || '',
    hora_inicio: (turno?.hora_inicio || '08:00').slice(0, 5), hora_fin: (turno?.hora_fin || '17:00').slice(0, 5),
    almuerzo_min: turno?.almuerzo_min ?? 60, equipo_id: turno?.equipo_id || '',
  })
  const [busy, setBusy] = useState(false); const [error, setError] = useState(null)
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }))
  const guardar = async () => {
    setBusy(true); setError(null)
    try {
      const payload = { nombre: f.nombre.trim(), abreviatura: f.abreviatura.trim(), hora_inicio: f.hora_inicio, hora_fin: f.hora_fin, almuerzo_min: Number(f.almuerzo_min) || 0, equipo_id: f.equipo_id || null }
      if (turno) await patchTurno(turno.id, payload); else await createTurno(payload)
      onDone()
    } catch (e) { setError(e.message); setBusy(false) }
  }
  return (
    <div className="fixed inset-0 bg-black/30 z-[70] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-3">
          <h3 className="font-bold text-slate-800">{turno ? 'Editar turno' : 'Crear turno'}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <I label="Nombre"><input className="inp" value={f.nombre} onChange={set('nombre')} placeholder="Mañana" /></I>
          <I label="Abrev."><input className="inp" maxLength={3} value={f.abreviatura} onChange={set('abreviatura')} placeholder="M" /></I>
          <I label="Entrada"><input type="time" className="inp" value={f.hora_inicio} onChange={set('hora_inicio')} /></I>
          <I label="Salida"><input type="time" className="inp" value={f.hora_fin} onChange={set('hora_fin')} /></I>
          <I label="Almuerzo (min)"><input type="number" min="0" max="240" step="5" className="inp" value={f.almuerzo_min} onChange={set('almuerzo_min')} /></I>
          <I label="Área"><select className="inp" value={f.equipo_id} onChange={set('equipo_id')}>
            <option value="">Todas las áreas (global)</option>
            {equipos.map((q) => <option key={q.id} value={q.id}>{q.nombre}</option>)}
          </select></I>
        </div>
        <p className="text-[11px] text-slate-400 mt-2">El almuerzo se descuenta solo si el turno queda ≥ 8 h; si es de 8 h o menos, se registra completo.</p>
        {error && <p className="text-rose-600 text-[13px] mt-2">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
          <Btn onClick={guardar} disabled={busy || !f.nombre.trim()}>{busy ? 'Guardando…' : (turno ? 'Guardar' : 'Crear')}</Btn>
        </div>
        <style>{`.inp{width:100%;border:1px solid #afd6df;border-radius:10px;padding:8px 10px;font-size:14px;background:#fff;outline:none}.inp:focus{border-color:#16697a;box-shadow:0 0 0 3px rgba(22,105,122,.15)}`}</style>
      </div>
    </div>
  )
}

// #15 Papelera: lista los inactivos de un recurso y permite recuperar o borrar
// definitivamente. restore(id) reactiva; borrar(id) elimina para siempre.
function ModalPapelera({ recurso, titulo, restore, borrar, onClose }) {
  const { data, loading, reload } = useFetch(() => getInactivos(recurso), [])
  const items = data || []
  const recuperar = async (it) => { try { await restore(it.id); reload() } catch (e) { toast(e.message, 'error') } }
  const eliminar = async (it) => {
    if (!(await confirmar(`¿Borrar DEFINITIVAMENTE "${it.nombre}"? Ya no se podrá recuperar.`, { ok: 'Borrar definitivamente', peligro: true }))) return
    try { await borrar(it.id); reload() } catch (e) { toast(e.message, 'error') }
  }
  return (
    <div className="fixed inset-0 bg-black/30 z-[70] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-5 max-h-[85vh] overflow-y-auto scroll-thin" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-3">
          <h3 className="font-bold text-slate-800">{titulo}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        {loading ? <div className="p-4"><Spinner /></div> : items.length === 0 ? (
          <p className="text-[13px] text-slate-400 py-6 text-center">No hay elementos eliminados.</p>
        ) : (
          <div className="divide-y divide-slate-50">
            {items.map((it) => (
              <div key={it.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="font-medium text-slate-700 text-[14px]">{it.nombre}</div>
                <div className="flex items-center gap-3">
                  <button onClick={() => recuperar(it)} className="text-[12px] text-blue-600 hover:text-blue-700 font-medium">Recuperar</button>
                  <button onClick={() => eliminar(it)} className="text-[12px] text-rose-600 hover:text-rose-700 font-medium">Eliminar definitivamente</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Contratos() {
  return (
    <div className="space-y-5">
      <Card title="Tipos de contrato (información)">
        <div className="grid sm:grid-cols-2 gap-3 p-4">
          {CONTRATOS.map((c) => (
            <div key={c.tipo} className="rounded-xl border border-slate-200 p-4">
              <div className="flex items-center justify-between">
                <div className="font-semibold text-slate-700">{c.nombre}</div>
                <span className="text-[11px] text-slate-400">{c.base_legal}</span>
              </div>
              <p className="text-[13px] text-slate-500 mt-1.5">{c.descripcion}</p>
              <a href={c.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] text-blue-600 hover:text-blue-700 font-medium mt-2">Ver norma <ExternalLink size={12} /></a>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}


// ── Equipos y su gente — la fuente de verdad es BUK ──────────────────────────
// Aquí NO se crea, edita ni elimina gente ni áreas: eso se hace en Buk y llega con
// "Actualizar desde Buk". Lo único que decide TH es qué áreas están ACTIVAS: un área
// apagada existe pero no opera (su gente tampoco). Quién lidera o registra se maneja en
// Accesos (es tema de roles), no aquí.
function Equipos({ me }) {
  const equipos = useFetch(() => getEquipos(false, true), [me?.email])   // activos + apagados
  const [filtro, setFiltro] = useState('activos')   // activos | inactivos | todos
  const [emp, setEmp] = useState('todas')           // empresa: VirtualSoft | Quota Media | todas
  const [sel, setSel] = useState(null)              // área abierta (ver su gente)
  const [syncing, setSyncing] = useState(false)
  const [busy, setBusy] = useState(null)

  const todas = equipos.data || []
  const nAct = todas.filter((e) => e.activo).length
  // En el mismo Buk conviven VirtualSoft y Quota Media: se pueden filtrar por empresa.
  const empresas = [...new Set(todas.map((e) => e.empresa).filter(Boolean))].sort()
  const lista = todas
    .filter((e) => (filtro === 'todos' ? true : filtro === 'activos' ? e.activo : !e.activo))
    .filter((e) => (emp === 'todas' ? true : e.empresa === emp))

  const syncBuk = async () => {
    setSyncing(true)
    try {
      const r = await sincronizarBuk()
      equipos.reload()
      toast(`Buk: ${r.actualizados} actualizados · ${r.creados} personas nuevas · ${r.areas_nuevas} áreas nuevas.`, 'success')
    } catch (e) { toast(e.message, 'error') } finally { setSyncing(false) }
  }
  const toggle = async (e) => {
    const encender = !e.activo
    const msg = encender
      ? `Activar "${e.nombre}": entra a la herramienta junto con sus ${e.n_empleados} personas. ¿Continuar?`
      : `Apagar "${e.nombre}": deja de operar en la herramienta. ¿Continuar?`
    if (!(await confirmar(msg, { ok: encender ? 'Sí, activar' : 'Sí, apagar', peligro: !encender }))) return
    setBusy(e.id)
    try { await patchEquipo(e.id, { activo: encender }); equipos.reload() }
    catch (err) { toast(err.message, 'error') } finally { setBusy(null) }
  }

  if (sel) return <EquipoDetalle equipo={sel} me={me} onVolver={() => { setSel(null); equipos.reload() }} />

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-[12px] font-medium">
          {[['activos', `Activas (${nAct})`], ['inactivos', `Apagadas (${todas.length - nAct})`], ['todos', `Todas (${todas.length})`]].map(([k, l]) => (
            <button key={k} onClick={() => setFiltro(k)}
              className={`px-3 py-1.5 ${filtro === k ? 'bg-[#16697a] text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>{l}</button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {empresas.length > 1 && (
            <Select value={emp} onChange={setEmp} size="sm" className="w-44"
              options={[{ value: 'todas', label: 'Todas las empresas' }, ...empresas.map((x) => ({ value: x, label: x }))]} />
          )}
          <Btn size="sm" variant="ghost" onClick={syncBuk} disabled={syncing}>
            <RotateCcw size={14} /> {syncing ? 'Sincronizando…' : 'Actualizar desde Buk'}
          </Btn>
        </div>
      </div>
      <p className="text-[12px] text-slate-500">
        Las áreas y las personas <strong>vienen de Buk</strong>: aquí no se crean ni se editan. Enciende un área para que
        opere en la herramienta (entra con toda su gente). Quién registra o lidera se define en <strong>Accesos</strong>.
      </p>
      {equipos.loading ? <Spinner /> : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {lista.map((e) => (
            <div key={e.id} className={`rounded-2xl border p-4 transition ${e.activo ? 'border-slate-200 bg-white hover:border-[#16697a]/40 hover:shadow-sm' : 'border-slate-100 bg-slate-50/70'}`}>
              <button onClick={() => setSel(e)} className="text-left w-full">
                <div className={`font-semibold text-[14.5px] leading-snug ${e.activo ? 'text-slate-800' : 'text-slate-400'}`}>{e.nombre}</div>
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  <span className="text-[12px] text-slate-400">{e.n_empleados} {e.n_empleados === 1 ? 'persona' : 'personas'}</span>
                  {e.empresa && (
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${e.empresa.toLowerCase().startsWith('quota') ? 'bg-violet-50 text-violet-700' : 'bg-teal-50 text-teal-700'}`}>{e.empresa}</span>
                  )}
                </div>
              </button>
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
                <button onClick={() => setSel(e)} className="text-[12px] font-medium text-[#16697a] hover:underline">Ver colaboradores →</button>
                <Switch checked={e.activo} onChange={() => toggle(e)} disabled={busy === e.id} />
              </div>
            </div>
          ))}
          {lista.length === 0 && <p className="text-[13px] text-slate-400 col-span-full py-6">No hay áreas en este filtro.</p>}
        </div>
      )}
    </div>
  )
}

// Gente de un área (solo lectura: los datos son de Buk).
function EquipoDetalle({ equipo, me, onVolver }) {
  const emps = useFetch(() => getEmpleados(equipo.id, true), [me?.email, equipo.id])
  const [busy, setBusy] = useState(null)
  const lista = emps.data || []
  // Aquí SOLO se decide si la persona LLEVA HORARIO (los líderes que sí trabajan turnos se
  // marcan aquí; Talento Humano va apagado porque no reporta horas). El "activo" no se ve:
  // eso es tema de Accesos, y encender el horario ya activa a la persona en el backend.
  const set = async (e, campo, valor) => {
    setBusy(e.id + campo)
    try { await patchEmpleado(e.id, { [campo]: valor }); emps.reload() }
    catch (err) { toast(err.message, 'error') } finally { setBusy(null) }
  }
  return (
    <div className="space-y-4">
      <button onClick={onVolver} className="text-[13px] text-slate-500 hover:text-slate-700 inline-flex items-center gap-1">
        <ChevronLeft size={14} /> Volver a las áreas
      </button>
      <Card title={
        <span className="flex items-center gap-2">{equipo.nombre}
          <span className={`text-[10.5px] font-semibold px-1.5 py-0.5 rounded ${equipo.activo ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
            {equipo.activo ? 'Activa' : 'Apagada'}
          </span>
        </span>}>
        <p className="text-[12px] text-slate-500 px-4 pt-3">
          Nombre, correo y cargo vienen de <strong>Buk</strong> (para corregirlos se cambian allá).
          Aquí decides quién <strong>lleva horario</strong>: solo esa gente aparece en Registrar horario
          y en el consolidado (Talento Humano no reporta horas; un líder que sí trabaja turnos se marca aquí).
          Los <strong>accesos</strong> a la plataforma se dan en la pestaña Accesos.
        </p>
        {emps.loading ? <div className="p-5"><Spinner /></div>
          : lista.length === 0 ? <p className="text-[13px] text-slate-400 px-4 py-4">Esta área no tiene gente.</p>
            : (
              <div className="overflow-x-auto scroll-thin mt-2">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
                    <th className="px-4 py-2.5 font-semibold">Persona</th>
                    <th className="px-3 py-2.5 font-semibold">Cargo</th>
                    <th className="px-3 py-2.5 font-semibold">Lleva horario</th>
                  </tr></thead>
                  <tbody>
                    {lista.map((e) => (
                      <tr key={e.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
                        <td className="px-4 py-2.5">
                          <div className={`font-medium ${e.lleva_horario ? 'text-slate-700' : 'text-slate-400'}`}>{e.nombre}</div>
                          <div className="text-[12px] text-slate-400">{e.email || '—'} · {e.cedula}</div>
                        </td>
                        <td className="px-3 py-2.5 text-slate-600 text-[13px]">{e.cargo || '—'}</td>
                        <td className="px-3 py-2.5">
                          <Switch checked={e.lleva_horario} disabled={busy === e.id + 'lleva_horario'}
                            onChange={(v) => set(e, 'lleva_horario', v)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
      </Card>
    </div>
  )
}

function I({ label, children }) {
  return <label className="block"><span className="block text-[12px] font-medium text-slate-500 mb-1.5">{label}</span>{children}</label>
}
