import { Lock } from 'lucide-react'

/** Pantalla "Próximamente" con candado (Bloque 8). Nunca queda en blanco ni 404. */
export default function ProximamentePage({ titulo, mensaje }) {
  return (
    <div className="h-full flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center">
        <div className="w-14 h-14 rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center mx-auto mb-4">
          <Lock size={24} className="text-slate-400" />
        </div>
        <h1 className="text-lg font-bold text-slate-800 mb-2">{titulo}</h1>
        <p className="text-sm text-slate-500 leading-relaxed">{mensaje}</p>
        <span className="inline-flex items-center gap-1.5 mt-5 text-[11px] uppercase tracking-[0.18em] font-bold text-blue-600 bg-blue-50 px-3 py-1 rounded-full">
          <Lock size={11} /> Próximamente
        </span>
      </div>
    </div>
  )
}
