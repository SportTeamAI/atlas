import { useEffect, useState } from 'react'
import { subscribeAuth } from './firebase'

/**
 * AuthGate — bloquea la app si no hay sesión real de Firebase (mismo patrón que
 * Nemesis). En DESARROLLO (vite dev) se permite sin sesión para poder trabajar;
 * el BUILD de producción SIEMPRE exige sesión del hub.
 */
export default function AuthGate({ children }) {
  const [estado, setEstado] = useState(import.meta.env.DEV ? 'ok' : 'verificando')

  useEffect(() => {
    if (import.meta.env.DEV) return undefined
    return subscribeAuth((user) => setEstado(user ? 'ok' : 'denegado'))
  }, [])

  if (estado === 'verificando') {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-slate-50 text-slate-500">
        <span className="w-4 h-4 rounded-full border-2 border-slate-200 border-t-[#16697a] animate-spin" />
        <span className="ml-3 text-sm">Verificando sesión…</span>
      </div>
    )
  }
  if (estado === 'denegado') {
    const hubUrl = `${window.location.origin}/`
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-slate-50 px-6">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-8 shadow-xl">
          <p className="text-[11px] uppercase tracking-[0.18em] text-rose-600 font-bold">Acceso restringido</p>
          <h1 className="text-lg font-extrabold mt-1 mb-3">Sesión requerida</h1>
          <p className="text-sm text-slate-600 mb-6">
            Este módulo solo está disponible a través del hub <strong>Producto Deportivas</strong> con
            una sesión activa.
          </p>
          <a
            href={hubUrl}
            className="inline-flex w-full items-center justify-center px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold"
          >
            Ir al hub para iniciar sesión
          </a>
        </div>
      </div>
    )
  }
  return children
}
