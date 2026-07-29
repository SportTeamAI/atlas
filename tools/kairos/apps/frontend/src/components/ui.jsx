// Componentes reutilizables del MVP (gama teal del hub).
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, CheckCircle2, AlertTriangle, BellRing, Info as InfoIcon, X as XIcon } from 'lucide-react'

// Aviso de proximidad a una fecha de corte (#12). destino: 'th' (reporte a TH,
// para registrador/líder) o 'financiera' (para TH). Se pone urgente (ámbar) el
// día antes y el mismo día.
export function AvisoCorte({ fecha, destino = 'th' }) {
  if (!fecha) return null
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0)
  const [y, m, d] = fecha.split('-').map(Number)
  const dias = Math.round((new Date(y, m - 1, d) - hoy) / 86400000)
  if (dias < 0 || dias > 6) return null
  const urgente = dias <= 1
  const cuando = dias === 0 ? 'HOY' : dias === 1 ? 'mañana' : `en ${dias} días`
  const txt = destino === 'financiera'
    ? `Envío a Financiera ${cuando} (${fecha}).`
    : `Reporte a Talento Humano ${cuando} (${fecha}). Valida y envía a tiempo.`
  return (
    <div className={`mb-4 rounded-xl border px-4 py-2.5 flex items-center gap-2 text-[13px] ${urgente ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-blue-50 border-blue-100 text-blue-700'}`}>
      <BellRing size={15} className="shrink-0" /> <span>{urgente && <strong>¡Atención! </strong>}{txt}</span>
    </div>
  )
}

// ── Toast con la marca (reemplaza el alert() nativo del navegador, #1) ───────
let _toastId = 0
const _toastSubs = new Set()
export function toast(mensaje, tipo = 'info') {
  const t = { id: ++_toastId, mensaje, tipo }
  _toastSubs.forEach((fn) => fn(t))
}
export function Toaster() {
  const [items, setItems] = useState([])
  useEffect(() => {
    const add = (t) => {
      // Más recientes ARRIBA, máximo 6 apilados (#8).
      setItems((p) => [t, ...p].slice(0, 6))
      // TODOS se van solos: los avisos con X ya no se quedan pegados esperando un clic.
      // El error dura 10 s (da tiempo a leerlo); los de éxito/info, 6 s. La X sigue ahí
      // para cerrarlo antes.
      setTimeout(() => setItems((p) => p.filter((x) => x.id !== t.id)), t.tipo === 'error' ? 10000 : 6000)
    }
    _toastSubs.add(add)
    return () => _toastSubs.delete(add)
  }, [])
  const estilo = {
    ok: { cls: 'border-emerald-200 bg-emerald-50 text-emerald-800', icon: <CheckCircle2 size={16} className="text-emerald-600" /> },
    error: { cls: 'border-rose-200 bg-rose-50 text-rose-800', icon: <AlertTriangle size={16} className="text-rose-600" /> },
    info: { cls: 'border-blue-200 bg-white text-slate-700', icon: <InfoIcon size={16} className="text-blue-600" /> },
  }
  return createPortal(
    <div className="fixed bottom-4 right-4 z-[200] flex flex-col gap-2 max-w-[360px]">
      {items.map((t) => {
        const e = estilo[t.tipo] || estilo.info
        return (
          <div key={t.id} className={`flex items-start gap-2.5 border rounded-xl shadow-lg px-3.5 py-2.5 text-[13px] ${e.cls} animate-[slidein_.2s_ease]`}>
            <span className="mt-0.5 shrink-0">{e.icon}</span>
            <span className="flex-1 leading-snug">{t.mensaje}</span>
            <button onClick={() => setItems((p) => p.filter((x) => x.id !== t.id))} className="text-slate-400 hover:text-slate-600 shrink-0"><XIcon size={14} /></button>
          </div>
        )
      })}
    </div>, document.body)
}

// ── Confirmación con la marca (reemplaza el window.confirm nativo, #12) ──────
let _confirmFn = null
export function confirmar(mensaje, { ok = 'Aceptar', cancel = 'Cancelar', peligro = false, campo = null } = {}) {
  // `campo` = { etiqueta, placeholder }: además de confirmar, pide un texto y resuelve con
  // él (cadena, quizá vacía) en vez de `true`. Se usa el mismo diálogo de la marca, no el
  // window.prompt nativo (feo y bloqueado por el navegador en algunos contextos).
  return new Promise((resolve) => {
    if (_confirmFn) _confirmFn({ mensaje, ok, cancel, peligro, campo, resolve })
    else resolve(campo ? window.prompt(mensaje) : window.confirm(mensaje))
  })
}
export function ConfirmHost() {
  const [c, setC] = useState(null)
  const [texto, setTexto] = useState('')
  useEffect(() => { _confirmFn = (v) => { setTexto(''); setC(v) }; return () => { _confirmFn = null } }, [])
  if (!c) return null
  const cerrar = (v) => { c.resolve(v); setC(null) }
  const aceptar = () => cerrar(c.campo ? texto : true)
  return createPortal(
    <div className="fixed inset-0 bg-black/40 z-[210] flex items-center justify-center p-4" onClick={() => cerrar(false)}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <p className="text-[14px] text-slate-700 leading-relaxed">{c.mensaje}</p>
        {c.campo && (
          <label className="block mt-4">
            <span className="block text-[12px] font-medium text-slate-500 mb-1.5">{c.campo.etiqueta}</span>
            <input autoFocus value={texto} onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') aceptar() }}
              placeholder={c.campo.placeholder || ''}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] focus:outline-none focus:border-[#16697a]" />
          </label>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={() => cerrar(false)} className="px-3.5 py-2 rounded-lg text-[13px] font-medium text-slate-600 bg-slate-100 hover:bg-slate-200">{c.cancel}</button>
          <button onClick={aceptar} className={`px-3.5 py-2 rounded-lg text-[13px] font-semibold text-white ${c.peligro ? 'bg-rose-600 hover:bg-rose-700' : 'bg-[#16697a] hover:bg-[#12566a]'}`}>{c.ok}</button>
        </div>
      </div>
    </div>, document.body)
}

// Tooltip con la marca (claro/teal), no el negro nativo del navegador.
// Renderiza una burbuja fija cerca del cursor; no se recorta dentro de tablas.
export function Tooltip({ content, children, className = '' }) {
  const [pos, setPos] = useState(null)
  if (!content) return children
  return (
    <span
      className={className}
      onMouseEnter={(e) => setPos({ x: e.clientX, y: e.clientY })}
      onMouseMove={(e) => setPos({ x: e.clientX, y: e.clientY })}
      onMouseLeave={() => setPos(null)}
    >
      {children}
      {pos && createPortal(
        <div style={{ left: pos.x + 14, top: pos.y + 14 }}
          className="fixed z-[120] max-w-[260px] bg-white border border-blue-200 shadow-xl rounded-lg px-3 py-2 text-[12px] text-slate-700 pointer-events-none">
          {content}
        </div>, document.body)}
    </span>
  )
}

// Select con la marca (reemplaza el <select> nativo negro del sistema, #4/#5).
// options: [{ value, label }]  ·  value, onChange(value)
export function Select({ value, onChange, options, placeholder = 'Seleccionar…', size = 'md', className = '', disabled }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const btnRef = useRef(null)
  const menuRef = useRef(null)   // dropdown en portal: NO cerrar al hacer clic dentro
  const [pos, setPos] = useState(null)
  const actual = options.find((o) => String(o.value) === String(value))
  const pad = size === 'sm' ? 'px-2.5 py-1.5 text-[12px]' : 'px-3 py-2 text-[13px]'

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target) && !(menuRef.current && menuRef.current.contains(e.target))) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const abrir = () => {
    if (disabled) return
    const r = btnRef.current.getBoundingClientRect()
    setPos({ left: r.left, top: r.bottom + 4, width: r.width })
    setOpen((v) => !v)
  }

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button ref={btnRef} type="button" onClick={abrir} disabled={disabled}
        className={`w-full flex items-center justify-between gap-2 bg-white border border-blue-200 rounded-lg ${pad} text-slate-700 outline-none hover:border-blue-300 focus:border-[#16697a] focus:ring-2 focus:ring-[#16697a]/15 disabled:opacity-50`}>
        <span className={`truncate ${actual ? '' : 'text-slate-400'}`}>{actual ? actual.label : placeholder}</span>
        <ChevronDown size={14} className={`text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && pos && createPortal(
        <div ref={menuRef} style={{ left: pos.left, top: pos.top, minWidth: pos.width }}
          className="fixed z-[130] max-h-64 overflow-y-auto scroll-thin bg-white border border-slate-200 rounded-xl shadow-xl p-1">
          {options.length === 0 && <div className="px-3 py-2 text-[12px] text-slate-400">Sin opciones</div>}
          {options.map((o) => {
            const sel = String(o.value) === String(value)
            return (
              <button key={o.value} type="button" onClick={() => { onChange(o.value); setOpen(false) }}
                className={`w-full text-left px-3 py-1.5 rounded-lg text-[13px] transition-colors ${sel ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-slate-600 hover:bg-slate-100'}`}>
                {o.label}
              </button>
            )
          })}
        </div>, document.body)}
    </div>
  )
}

// Interruptor con la marca (teal), en vez del checkbox nativo del navegador (#12).
export function Switch({ checked, onChange, label, disabled }) {
  return (
    <label className={`inline-flex items-center gap-2.5 select-none ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <button type="button" role="switch" aria-checked={checked} disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${checked ? 'bg-[#16697a]' : 'bg-slate-300'}`}>
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : ''}`} />
      </button>
      {label && <span className="text-[13px] text-slate-700">{label}</span>}
    </label>
  )
}

export function Card({ title, action, children, className = '' }) {
  return (
    <section className={`bg-white rounded-2xl border border-slate-200 shadow-sm ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <h2 className="text-[13px] font-semibold text-slate-700 uppercase tracking-wide">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

export function Btn({ children, onClick, variant = 'primary', size = 'md', disabled, type = 'button', className = '' }) {
  const base = 'inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-colors disabled:opacity-50'
  const sizes = { sm: 'text-[12px] px-2.5 py-1.5', md: 'text-[13px] px-3.5 py-2' }
  const variants = {
    primary: 'bg-blue-600 hover:bg-blue-500 text-white',
    ghost: 'border border-slate-200 hover:border-slate-300 text-slate-600',
    danger: 'bg-rose-600 hover:bg-rose-500 text-white',
  }
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}>
      {children}
    </button>
  )
}

const ESTADO_COLOR = {
  abierto: 'bg-blue-50 text-blue-700',
  programado: 'bg-slate-100 text-slate-500',
  en_revision: 'bg-amber-500/15 text-amber-600',
  cerrado: 'bg-slate-100 text-slate-500',
  pendiente: 'bg-amber-500/15 text-amber-600',
  aprobado: 'bg-emerald-500/15 text-emerald-600',
  rechazado: 'bg-rose-500/15 text-rose-600',
}

export function Badge({ children, tone }) {
  const cls = ESTADO_COLOR[tone] || 'bg-slate-100 text-slate-600'
  return <span className={`inline-block px-2 py-0.5 rounded-md text-[11px] font-semibold ${cls}`}>{children}</span>
}

export function EmptyState({ children }) {
  return <div className="text-center text-sm text-slate-400 py-10">{children}</div>
}

export function Spinner() {
  return <span className="inline-block w-4 h-4 rounded-full border-2 border-slate-200 border-t-[#16697a] animate-spin" />
}

export function PageHeader({ icon: Icon, title, subtitle, action, info }) {
  return (
    <header className="flex items-start justify-between mb-6 gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-bold flex items-center gap-2 flex-wrap">
          {Icon && <Icon size={20} className="text-blue-600" />} <span>{title}</span>
          {info && <InfoButton {...info} />}
        </h1>
        {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
      </div>
      {action}
    </header>
  )
}

// Botón (i) que abre un modal con la explicación del modulo (#20).
// Uso: <PageHeader info={{ titulo, descripcion, pasos: [{titulo, texto}] }} />
export function InfoButton({ titulo, descripcion, pasos = [] }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)} title="¿Para qué sirve esta pantalla?" aria-label="Información"
        className="ml-1 w-6 h-6 inline-flex items-center justify-center rounded-full bg-blue-50 hover:bg-blue-100 text-blue-600 text-[12px] font-bold border border-blue-200">i</button>
      {open && createPortal(
        <div className="fixed inset-0 bg-black/30 z-[80] flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-3">
              <h3 className="text-lg font-bold text-slate-800">¿Qué es “{titulo}”?</h3>
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600 text-2xl leading-none" aria-label="Cerrar">×</button>
            </div>
            {descripcion && <p className="text-[13.5px] text-slate-600 leading-relaxed mb-4">{descripcion}</p>}
            {pasos.length > 0 && (
              <ol className="space-y-2.5">
                {pasos.map((p, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="w-6 h-6 rounded-full bg-blue-600 text-white text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                    <div>
                      {p.titulo && <div className="font-semibold text-slate-700 text-[13px]">{p.titulo}</div>}
                      <div className="text-[12.5px] text-slate-500 leading-snug">{p.texto}</div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>, document.body)}
    </>
  )
}

// Hook simple de fetch con estados de carga/error. `deps` fuerza recarga.
export function useFetch(fn, deps = []) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let vivo = true
    setLoading(true)
    fn()
      .then((d) => vivo && (setData(d), setError(null)))
      .catch((e) => vivo && setError(e.message))
      .finally(() => vivo && setLoading(false))
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])
  return { data, loading, error, reload: () => setTick((t) => t + 1) }
}
