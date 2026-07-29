import { useEffect, useMemo, useState } from 'react'
import { Users, History, ChevronLeft, ChevronRight, Clock, ShieldCheck, CheckCircle2, Send } from 'lucide-react'
import { getEquipos, getEstadoEquipos, getPeriodos } from '../api/client'
import { AvisoCorte, Badge, Btn, Card, EmptyState, PageHeader, Select, Spinner, useFetch } from '../components/ui'
import GrillaPeriodo from '../components/GrillaPeriodo'

const FLUJO = {
  pendiente: { txt: 'Pendiente', cls: 'bg-slate-100 text-slate-400', icon: Clock },
  en_proceso: { txt: 'En proceso', cls: 'bg-sky-100 text-sky-700', icon: Clock },
  pend_validacion: { txt: 'Esperando validación', cls: 'bg-amber-100 text-amber-700', icon: ShieldCheck },
  validado: { txt: 'Validado por líder', cls: 'bg-blue-100 text-blue-700', icon: CheckCircle2 },
  en_th: { txt: 'Enviado a TH', cls: 'bg-emerald-100 text-emerald-700', icon: Send },
  aprobado: { txt: 'Aprobado', cls: 'bg-emerald-100 text-emerald-700', icon: CheckCircle2 },
}
// Estado 'registro' → 'pendiente'/'en_proceso' según si el área ya tiene algo cargado (#1).
const claveFlujo = (st) => {
  const ef = st?.estado_flujo || 'registro'
  return ef === 'registro' ? (st?.tiene_datos ? 'en_proceso' : 'pendiente') : ef
}

// TH: consolidado POR ÁREA (#2). Tarjetas de áreas → entrar a cada una para
// revisar su grilla y su chat individual (#4).
export default function ConsolidadoPage({ me, initialArea }) {
  const { data: periodos, loading } = useFetch(getPeriodos, [me?.email])
  const equipos = useFetch(getEquipos, [me?.email])
  const [selId, setSelId] = useState(null)
  const [areaSel, setAreaSel] = useState(initialArea || null)  // área en la que entré (#6: puede venir del Resumen)
  const [histOpen, setHistOpen] = useState(false)

  useEffect(() => {
    if (periodos && selId === null && periodos.length) {
      // Por defecto, el GLOBAL en curso (el estándar). Solo si no hay global abierto
      // —caso de un área que solo ve su período propio— se toma su abierto.
      const enCurso = periodos.find((p) => p.estado === 'abierto' && !p.equipo_id)
        || periodos.find((p) => p.estado === 'abierto')
      setSelId((enCurso || periodos[0]).id)
    }
  }, [periodos, selId])
  const sel = (periodos || []).find((p) => p.id === selId)
  // Histórico: períodos que ya pasaron — cerrados Y los que están en revisión (esperando
  // cierre de TH). Antes solo salían los 'cerrado', por eso una quincena en revisión
  // quedaba sin dónde verla.
  const cerrados = (periodos || []).filter((p) => p.estado === 'cerrado' || p.estado === 'en_revision')
  const estadoEq = useFetch(() => (sel ? getEstadoEquipos(sel.id) : Promise.resolve([])), [me?.email, sel?.id])
  const estadoDe = useMemo(() => Object.fromEntries((estadoEq.data || []).map((x) => [x.equipo_id, x])), [estadoEq.data])
  const esOperativo = me?.rol !== 'super_admin'
  // Subtítulo según el perfil que abre el módulo (#1).
  const SUBTITULO = {
    registrador: 'Revisa lo que registraste, envíalo a validación del líder y comunícate con Talento Humano.',
    lider: 'Revisa lo registrado por tu equipo, valídalo y comunícate con Talento Humano.',
    super_admin: 'Revisa cada área, valida lo que envían los equipos, comenta o devuelve, y comunícate con ellos.',
  }
  const subtitulo = SUBTITULO[me?.rol] || 'Revisa lo registrado y comunícate con el equipo.'

  // Operativo (registrador/líder): su propia área, consolidada + chat, directo.
  if (esOperativo) {
    return (
      <div className="max-w-7xl mx-auto p-5 lg:p-7">
        <PageHeader icon={Users} title="Consolidado y chat"
          subtitle={subtitulo}
          action={<Btn size="sm" variant="ghost" onClick={() => setHistOpen(true)}><History size={14} /> Histórico</Btn>} />
        {sel && <AvisoCorte fecha={sel.fecha_corte} destino="th" />}
        {loading && <Spinner />}
        {periodos && periodos.length === 0 && <EmptyState>No hay períodos.</EmptyState>}
        {sel && <GrillaPeriodo periodo={sel} me={me} modo="consolidado" />}
        {histOpen && <ModalHistorico cerrados={cerrados} onPick={(id) => { setSelId(id); setHistOpen(false) }} onClose={() => setHistOpen(false)} />}
      </div>
    )
  }

  // TH — detalle de un área. Si el área tiene un período PROPIO abierto (SAC/Incidentes
  // reportaron julio en fechas distintas), se revisa ESE en vez del global.
  const periodoArea = areaSel
    ? (periodos || []).find((p) => p.equipo_id === areaSel.id && p.estado === 'abierto')
      || (periodos || []).find((p) => p.estado === 'abierto' && !p.equipo_id)
      || sel
    : sel
  if (areaSel && periodoArea) {
    return (
      <div className="max-w-7xl mx-auto p-5 lg:p-7">
        <button onClick={() => setAreaSel(null)} className="inline-flex items-center gap-1 text-[13px] text-slate-500 hover:text-slate-700 mb-3">
          <ChevronLeft size={15} /> Volver a las áreas
        </button>
        <PageHeader icon={Users} title={areaSel.nombre}
          subtitle={periodoArea.nota || 'Revisa los horarios, comenta u observa y devuelve si falta algo.'} />
        <GrillaPeriodo periodo={periodoArea} me={me} equipoId={areaSel.id} />
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto p-5 lg:p-7">
      <PageHeader icon={Users} title="Consolidado y chat"
        subtitle="Entra a cada área para revisar sus horas y comunicarte con quien registra y el líder."
        action={
          <div className="flex items-center gap-2 flex-wrap">
            {sel && <span className="font-semibold text-slate-700 text-[13px]">{sel.nombre} <span className="text-slate-400 font-normal tabular text-[12px]">({sel.fecha_inicio} → {sel.fecha_fin})</span></span>}
            {sel && <Badge tone={sel.estado}>{sel.estado === 'abierto' ? 'En curso' : sel.estado === 'cerrado' ? 'Cerrado' : sel.estado}</Badge>}
            <Btn size="sm" variant="ghost" onClick={() => setHistOpen(true)}><History size={14} /> Histórico</Btn>
          </div>
        } />

      {loading && <Spinner />}
      {periodos && periodos.length === 0 && <EmptyState>No hay períodos.</EmptyState>}

      {sel && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {(equipos.data || []).map((a) => {
            const f = FLUJO[claveFlujo(estadoDe[a.id])]
            const Icon = f.icon
            return (
              <button key={a.id} onClick={() => setAreaSel(a)}
                className="text-left rounded-2xl border border-slate-200 hover:border-blue-300 hover:shadow-md transition p-5 bg-white">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="font-semibold text-slate-800 text-[15px]">{a.nombre}</div>
                  <ChevronRight size={16} className="text-slate-300" />
                </div>
                {a.descripcion && <p className="text-[12px] text-slate-400 mb-3">{a.descripcion}</p>}
                <span className={`inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1 rounded-lg ${f.cls}`}>
                  <Icon size={13} /> {f.txt}
                </span>
              </button>
            )
          })}
          {(equipos.data || []).length === 0 && <EmptyState>No hay áreas.</EmptyState>}
        </div>
      )}

      {histOpen && <ModalHistorico cerrados={cerrados} onPick={(id) => { setSelId(id); setAreaSel(null); setHistOpen(false) }} onClose={() => setHistOpen(false)} />}
    </div>
  )
}

function ModalHistorico({ cerrados, onPick, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/30 z-[70] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-5 max-h-[80vh] overflow-y-auto scroll-thin" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-3">
          <h3 className="font-bold text-slate-800">Histórico de períodos</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl leading-none">×</button>
        </div>
        {cerrados.length === 0 ? <EmptyState>Aún no hay períodos pasados.</EmptyState> : (
          <div className="divide-y divide-slate-50">
            {cerrados.map((p) => (
              <button key={p.id} onClick={() => onPick(p.id)}
                className="w-full flex items-center justify-between gap-3 px-2 py-2.5 hover:bg-slate-50 rounded-lg text-left">
                <div>
                  <div className="font-medium text-slate-700 text-[14px] flex items-center gap-2">{p.secuencia}. {p.nombre}
                    <Badge tone={p.estado}>{p.estado === 'cerrado' ? 'Cerrado' : 'En revisión'}</Badge>
                  </div>
                  <div className="text-[12px] text-slate-400 tabular">{p.fecha_inicio} → {p.fecha_fin}</div>
                </div>
                <span className="text-[12px] text-blue-600 font-medium">Abrir →</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
