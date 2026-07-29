import { useEffect, useState } from 'react'
import { MessageCircle, Send, CheckCircle2, AlertCircle, GitCommitHorizontal } from 'lucide-react'
import { getComentarios, postComentario } from '../api/client'
import { Btn, Card, Spinner } from './ui'

// Hilo de comentarios estilo red social sobre un período.
export default function Comentarios({ periodoId, me, equipoId, cerrado }) {
  const [items, setItems] = useState(null)
  const [texto, setTexto] = useState('')
  const [tipo, setTipo] = useState('comentario')  // comentario | observacion
  const [busy, setBusy] = useState(false)
  // Líder y TH pueden marcar el mensaje como observación (#8).
  const puedeObservar = me?.rol === 'lider' || me?.rol === 'super_admin'

  // Si la carga falla, dejamos [] (no null) para no quedar en Spinner infinito.
  const cargar = async () => { try { setItems(await getComentarios(periodoId, equipoId)) } catch { setItems([]) } }
  useEffect(() => { cargar() /* eslint-disable-next-line */ }, [periodoId, equipoId, me?.email])

  const enviar = async () => {
    if (!texto.trim()) return
    setBusy(true)
    try { await postComentario(periodoId, { texto: texto.trim(), tipo: puedeObservar ? tipo : 'comentario', equipo_id: equipoId || null }); setTexto(''); cargar() }
    finally { setBusy(false) }
  }

  return (
    <Card title={<span className="flex items-center gap-2"><MessageCircle size={15} className="text-blue-600" /> Línea de tiempo, comentarios y validación</span>} className="mt-4">
      {items === null && <div className="p-5"><Spinner /></div>}
      {items && items.length === 0 && <p className="text-[12px] text-slate-400 px-5 py-4">Sin actividad aún. El primer evento aparecerá al enviar los horarios a validación.</p>}
      {items && items.length > 0 && (
        <ul className="divide-y divide-slate-50">
          {items.map((c) => c.tipo === 'evento' ? <ItemEvento key={c.id} c={c} /> : <ItemComentario key={c.id} c={c} />)}
        </ul>
      )}
      {cerrado ? (
        /* #3 Área aprobada: el chat queda cerrado hasta que TH reabra el período. */
        <div className="p-3 border-t border-slate-100 text-[12px] text-slate-500 bg-slate-50/60">
          Área <strong>aprobada</strong>: el chat está cerrado. Talento Humano puede reabrir el período (en Reporte de horas) para volver a activarlo, y cualquier cambio quedará registrado aquí.
        </div>
      ) : (
      <div className="p-3 border-t border-slate-100 flex gap-2 items-center flex-wrap">
        {puedeObservar && (
          <div className="inline-flex rounded-lg border border-blue-200 overflow-hidden text-[12px]">
            <button onClick={() => setTipo('comentario')} className={`px-2.5 py-1.5 ${tipo === 'comentario' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600'}`}>Comentario</button>
            <button onClick={() => setTipo('observacion')} className={`px-2.5 py-1.5 ${tipo === 'observacion' ? 'bg-amber-500 text-white' : 'bg-white text-slate-600'}`}>Observación</button>
          </div>
        )}
        <input value={texto} onChange={(e) => setTexto(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && enviar()}
          placeholder={tipo === 'observacion' ? 'Escribe una observación…' : 'Escribe un comentario…'}
          className="flex-1 min-w-[160px] border border-blue-200 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#16697a] focus:ring-2 focus:ring-[#16697a]/15" />
        <Btn onClick={enviar} disabled={busy || !texto.trim()}><Send size={14} /> Enviar</Btn>
      </div>
      )}
    </Card>
  )
}

function ItemComentario({ c }) {
  const fmt = (iso) => {
    try { return new Date(iso).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) }
    catch { return iso }
  }
  const meta = TIPO_META[c.tipo] || TIPO_META.comentario
  const inicial = (c.autor_nombre || '?').trim().charAt(0).toUpperCase()
  return (
    <li className="px-4 py-3 flex gap-3">
      <div className={`w-9 h-9 rounded-full ${meta.cls} flex items-center justify-center font-bold text-[14px] shrink-0`}>{inicial}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-slate-700 text-[13px]">{c.autor_nombre}</span>
          <span className="text-[11px] text-slate-400 uppercase">{ROL_LBL[c.autor_rol] || c.autor_rol}</span>
          {meta.badge && (
            <span className={`text-[10px] uppercase tracking-wide font-bold px-2 py-0.5 rounded-full ${meta.badgeCls}`}>
              {meta.icon} {meta.badge}
            </span>
          )}
          <span className="text-[11px] text-slate-400 ml-auto">{fmt(c.creado_en)}</span>
        </div>
        <p className="text-[13px] text-slate-700 mt-1 leading-snug whitespace-pre-wrap">{c.texto}</p>
      </div>
    </li>
  )
}

// Evento del flujo: marcador de línea de tiempo, más compacto que un comentario.
function ItemEvento({ c }) {
  const fmt = (iso) => { try { return new Date(iso).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) } catch { return iso } }
  return (
    <li className="px-4 py-2 flex items-center gap-3 bg-slate-50/40">
      <div className="w-9 flex justify-center shrink-0"><GitCommitHorizontal size={16} className="text-blue-500" /></div>
      <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
        <span className="text-[12.5px] text-slate-600">{c.texto}</span>
        <span className="text-[11px] text-slate-400 ml-auto">{fmt(c.creado_en)}</span>
      </div>
    </li>
  )
}

const ROL_LBL = { super_admin: 'TH', registrador: 'Registrador', lider: 'Líder' }
const TIPO_META = {
  comentario: { cls: 'bg-blue-50 text-blue-700' },
  validacion: { cls: 'bg-emerald-100 text-emerald-700', badge: 'Validó', badgeCls: 'bg-emerald-100 text-emerald-700', icon: <CheckCircle2 size={11} className="inline -mt-0.5" /> },
  aprobacion: { cls: 'bg-emerald-100 text-emerald-700', badge: 'Aprobó', badgeCls: 'bg-emerald-100 text-emerald-700', icon: <CheckCircle2 size={11} className="inline -mt-0.5" /> },
  observacion: { cls: 'bg-amber-100 text-amber-700', badge: 'Observación', badgeCls: 'bg-amber-100 text-amber-700', icon: <AlertCircle size={11} className="inline -mt-0.5" /> },
}
