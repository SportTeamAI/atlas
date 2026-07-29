import { useEffect, useState } from 'react'
import { ShieldCheck, LogIn, X } from 'lucide-react'
import { verOnboarding, definirContrasena, login } from '../api/client'

const ROL_TXT = { super_admin: 'Administrador', lider: 'Líder', registrador: 'Registrador' }

// Pantalla de onboarding: la persona llega por su enlace (?onboarding=token) y CREA su
// contraseña. Al terminar queda logueada (guarda el JWT) y se recarga la app.
export function OnboardingPage({ token, onListo }) {
  const [info, setInfo] = useState(null)   // null=cargando, {valido,...}
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { verOnboarding(token).then(setInfo).catch(() => setInfo({ valido: false })) }, [token])

  const enviar = async () => {
    setErr('')
    if (pw.length < 8) return setErr('La contraseña debe tener al menos 8 caracteres.')
    if (pw !== pw2) return setErr('Las contraseñas no coinciden.')
    setBusy(true)
    try {
      await definirContrasena(token, pw)   // el backend pone la cookie HttpOnly
      onListo()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-slate-50 px-6">
      <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-8 shadow-xl">
        <div className="w-11 h-11 rounded-xl bg-[#16697a]/10 text-[#16697a] flex items-center justify-center mb-4"><ShieldCheck size={22} /></div>
        {info === null && <p className="text-sm text-slate-500">Verificando tu enlace…</p>}
        {info && !info.valido && (
          <>
            <h1 className="text-lg font-extrabold mb-2">Enlace no válido</h1>
            <p className="text-sm text-slate-600">Este enlace de acceso ya se usó o expiró. Pídele a Talento Humano (o a tu líder) que te genere uno nuevo.</p>
          </>
        )}
        {info && info.valido && (
          <>
            <p className="text-[11px] uppercase tracking-[0.18em] text-[#16697a] font-bold">Crea tu contraseña</p>
            <h1 className="text-lg font-extrabold mt-1 mb-1">Hola, {info.nombre}</h1>
            <p className="text-[13px] text-slate-500 mb-5">{info.email} · {ROL_TXT[info.rol] || info.rol}</p>
            <label className="block text-[12px] font-semibold text-slate-600 mb-1">Nueva contraseña</label>
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm mb-3 focus:border-[#16697a] outline-none" placeholder="Mínimo 8 caracteres" />
            <label className="block text-[12px] font-semibold text-slate-600 mb-1">Repite la contraseña</label>
            <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && enviar()}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm mb-4 focus:border-[#16697a] outline-none" placeholder="Repite la contraseña" />
            {err && <p className="text-[13px] text-rose-600 mb-3">{err}</p>}
            <button onClick={enviar} disabled={busy}
              className="w-full py-2.5 rounded-xl bg-[#16697a] hover:bg-[#12566a] text-white text-sm font-semibold disabled:opacity-60">
              {busy ? 'Guardando…' : 'Crear contraseña y entrar'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// Modal de login real (correo + contraseña). Al entrar guarda el JWT y llama onListo.
export function LoginModal({ onClose, onListo }) {
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const entrar = async () => {
    setErr(''); setBusy(true)
    try {
      await login(email.trim(), pw)   // el backend pone la cookie HttpOnly
      onListo()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-[80] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2 text-[#16697a]"><LogIn size={18} /><h3 className="font-bold text-slate-800">Iniciar sesión</h3></div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <label className="block text-[12px] font-semibold text-slate-600 mb-1">Correo</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} autoFocus
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm mb-3 focus:border-[#16697a] outline-none" placeholder="tu.correo@virtualsoft.tech" />
        <label className="block text-[12px] font-semibold text-slate-600 mb-1">Contraseña</label>
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && entrar()}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm mb-4 focus:border-[#16697a] outline-none" placeholder="Tu contraseña" />
        {err && <p className="text-[13px] text-rose-600 mb-3">{err}</p>}
        <button onClick={entrar} disabled={busy}
          className="w-full py-2.5 rounded-xl bg-[#16697a] hover:bg-[#12566a] text-white text-sm font-semibold disabled:opacity-60">
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
        <p className="text-[11px] text-slate-400 mt-3 text-center">¿Primera vez? Usa el enlace que te compartió Talento Humano o tu líder.</p>
      </div>
    </div>
  )
}
