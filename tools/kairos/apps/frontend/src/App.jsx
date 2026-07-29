import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Clock, Scale, Users, UserCog, CalendarRange, Settings, Wallet, CalendarDays,
  Menu, ExternalLink, ChevronRight, ChevronDown, LayoutDashboard, Bell, UserCircle,
  FileBarChart2, HeartPulse, Lock, Info, Compass, Briefcase, BookOpen, SlidersHorizontal,
} from 'lucide-react'
import { getEstadoAuth, logout, getNotificaciones, marcarNotifLeida } from './api/client'
import { getEmail, setEmail } from './api/session'
import { ConfirmHost, Spinner, Toaster } from './components/ui'
import { OnboardingPage, LoginModal } from './components/Acceso'
import InicioPage from './pages/InicioPage'
import RegistrarHorarioPage from './pages/RegistrarHorarioPage'
import MiEquipoPage from './pages/MiEquipoPage'
import EmpleadosPage from './pages/EmpleadosPage'
import PeriodosPage from './pages/PeriodosPage'
import ReportePage from './pages/ReportePage'
import ConsolidadoPage from './pages/ConsolidadoPage'
import LicenciasPage from './pages/LicenciasPage'
import ConfiguracionPage from './pages/ConfiguracionPage'
import ReferenciaLegalPage from './pages/ReferenciaLegalPage'
import CalendarioPage from './pages/CalendarioPage'
import ProximamentePage from './pages/ProximamentePage'

// A qué pantalla lleva cada tipo de notificación (#2). Los slugs coinciden con NAV;
// si el destino no está visible para el rol, la campana solo marca leído.
const NOTIF_DESTINO = {
  PERIODO_LISTO: 'consolidado',       // líder valida / TH revisa
  LIDER_VALIDO: 'consolidado',        // registrador: ya puede enviar a TH
  DEVOLUCION: 'consolidado',          // ver la observación en el chat del área
  APROBADO: 'consolidado',            // TH aprobó: queda en el histórico
  TURNO_PROPUESTO: 'config',          // TH pone la abreviatura
  EMPLEADO_SIN_CONFIG: 'config',
  RECORDATORIO_ENTREGA: 'registrar',
  CORTE_PROXIMO: 'consolidado',       // operativo: enviar antes del corte a TH (#12)
  FINANCIERA_PROXIMO: 'reporte',      // TH: enviar a financiera (#12)
  CAMBIO_NORMATIVO: 'referencia-legal',
  LIMITE_HORAS: 'registrar',
}

const TODOS = ['super_admin', 'registrador', 'lider']
const NAV = [
  // Resumen: dashboard de TH y también de operativos (por empleado, #5).
  { slug: 'inicio', label: 'Resumen', icon: LayoutDashboard, grupo: 'General', roles: ['super_admin'] },
  { slug: 'inicio', label: 'Resumen', icon: LayoutDashboard, grupo: 'Mi equipo', roles: ['registrador', 'lider'] },
  // Registrar = captura de turnos + extras; Consolidado = revisión + chat + validación.
  { slug: 'registrar', label: 'Registrar horario', icon: Clock, grupo: 'Mi equipo', roles: ['registrador', 'lider'] },
  { slug: 'consolidado', label: 'Consolidado y chat', icon: Users, grupo: 'Mi equipo', roles: ['registrador', 'lider'] },
  { slug: 'mi-equipo', label: 'Mi equipo', icon: UserCog, grupo: 'Mi equipo', roles: ['registrador', 'lider'] },
  // Consolidado de TH: tarjetas por área + chat (#7).
  { slug: 'consolidado', label: 'Consolidado y chat', icon: Users, grupo: 'Gestión', roles: ['super_admin'] },
  { slug: 'reporte', label: 'Reporte de horas', icon: FileBarChart2, grupo: 'Gestión', roles: ['super_admin'] },
  // Información: Calendario para todos; Referencia legal SOLO TH (#7).
  { slug: 'calendario', label: 'Calendario', icon: CalendarDays, grupo: 'Información', roles: TODOS },
  { slug: 'referencia-legal', label: 'Referencia legal', icon: Scale, grupo: 'Información', roles: TODOS },
  { slug: 'licencias', label: 'Licencias', icon: HeartPulse, grupo: 'Información', roles: TODOS },
  { slug: 'config', label: 'Configuración', icon: Settings, grupo: 'Ajustes', roles: ['super_admin'] },
]

// Pantalla inicial: TODOS arrancan en el Resumen (#6).
const INICIO_ROL = { super_admin: 'inicio', registrador: 'inicio', lider: 'inicio' }

const ROL_CHIP = { super_admin: 'TH', registrador: 'Registrador', lider: 'Líder' }

export default function App() {
  const [email, setEmailState] = useState(getEmail())
  const [me, setMe] = useState(null)
  const [activo, setActivo] = useState('inicio')
  const [menuOpen, setMenuOpen] = useState(false)   // móvil: drawer
  const [deepArea, setDeepArea] = useState(null)     // #6 área a abrir directo en Consolidado
  // Acceso real (JWT): onboarding por enlace (?onboarding=token) y login por contraseña.
  const [obToken, setObToken] = useState(() => new URLSearchParams(window.location.search).get('onboarding'))
  const [loginOpen, setLoginOpen] = useState(false)
  const [authTick, setAuthTick] = useState(0)   // fuerza refetch de la identidad
  const [via, setVia] = useState(null)          // 'jwt' (sesión real) | 'demo' | null

  useEffect(() => {
    setMe(null)
    // La identidad sale SOLO de /auth/estado, que la lee de la cookie HttpOnly del JWT.
    // Sin sesión no hay usuario y la app manda al login: no hay lista de usuarios que pedir.
    getEstadoAuth().then(({ via: v, usuario }) => {
      setVia(v)
      if (usuario) { setMe(usuario); setActivo(INICIO_ROL[usuario.rol] || 'inicio') } else setMe(null)
    }).catch(() => { setMe(null); setVia(null) })
  }, [email, authTick])

  const cambiarRol = async (nuevoEmail) => {
    if (via === 'jwt') { try { await logout() } catch { /* noop */ } }   // salir del login real
    setEmail(nuevoEmail); setEmailState(nuevoEmail); setAuthTick((t) => t + 1)
  }
  // Tras onboarding o login: limpia el ?onboarding= de la URL y recarga la identidad.
  const trasEntrar = () => {
    setLoginOpen(false); setObToken(null)
    try { window.history.replaceState({}, '', window.location.pathname) } catch { /* noop */ }
    setAuthTick((t) => t + 1)
  }

  const navVisible = useMemo(() => (me ? NAV.filter((i) => i.roles.includes(me.rol)) : []), [me])
  const grupos = useMemo(() => {
    const g = {}
    navVisible.forEach((i) => { (g[i.grupo] ||= []).push(i) })
    return g
  }, [navVisible])
  const item = navVisible.find((i) => i.slug === activo) || navVisible[0]
  const seleccionar = (slug) => { setActivo(slug); setDeepArea(null); setMenuOpen(false) }
  // #6 Desde el Resumen de TH: entrar directo a un área en Consolidado.
  const verArea = (area) => { setActivo('consolidado'); setDeepArea(area) }

  // Enlace de onboarding: la persona crea su contraseña antes de entrar a la app.
  if (obToken) return <OnboardingPage token={obToken} onListo={trasEntrar} />

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      <Toaster />
      <ConfirmHost />
      {loginOpen && <LoginModal onClose={() => setLoginOpen(false)} onListo={trasEntrar} />}
      <Sidebar grupos={grupos} item={item} mobileOpen={menuOpen} setMobileOpen={setMenuOpen} onSelect={seleccionar} />

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-[56px] shrink-0 bg-white border-b border-slate-200 flex items-center justify-between px-3 sm:px-4 gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <button className="lg:hidden text-slate-500 p-1.5 -ml-1" onClick={() => setMenuOpen(true)} aria-label="Menú"><Menu size={20} /></button>
            <div className="flex items-center gap-1.5 text-sm text-slate-400 min-w-0">
              <span className="hidden md:inline">Jornada Laboral</span>
              <ChevronRight size={14} className="hidden md:inline" />
              <span className="font-semibold text-slate-700 truncate">{item?.label}</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <NotificacionesBell email={email} onNavegar={(slug) => navVisible.some((i) => i.slug === slug) && seleccionar(slug)} />
            <RoleSwitcher me={me} onChange={cambiarRol} onLogin={() => setLoginOpen(true)} conJwt={via === 'jwt'} />
            <a href="https://deportivasvirtualsoft.web.app/" target="_blank" rel="noreferrer"
              className="hidden sm:inline-flex items-center gap-1.5 text-[12px] font-medium text-blue-600 hover:text-blue-700 border border-blue-200 hover:border-blue-300 rounded-lg px-2.5 py-1.5">
              Hub <ExternalLink size={13} />
            </a>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto scroll-thin">
          {!me ? <div className="h-full flex items-center justify-center"><Spinner /></div>
            : <Pagina key={email + item?.slug} item={item} me={me} onVerArea={verArea} deepArea={deepArea} />}
        </main>
        {/* Footer INMÓVIL: fuera del área scrolleable, siempre visible (#1) */}
        <footer className="shrink-0 border-t border-slate-200 bg-white py-2.5 px-4 text-center">
          <span className="text-[12px] text-slate-400">Producto Deportivas · VirtualSoft {new Date().getFullYear()} ©</span>
        </footer>
      </div>
    </div>
  )
}

// Icono representativo por GRUPO grande (#1: SVG único por módulo grande).
const GRUPO_ICON = {
  'General': Compass,
  'Mi equipo': Briefcase,
  'Gestión': UserCog,
  'Información': BookOpen,
  'Ajustes': SlidersHorizontal,
  'Próximamente': Lock,
}

// Sidebar: en desktop es un rail de 60px (solo iconos) que se EXPANDE al pasar
// el mouse por encima y se colapsa al salir (#1). En mobile es un drawer.
function Sidebar({ grupos, item, mobileOpen, setMobileOpen, onSelect }) {
  const [expandido, setExpandido] = useState(false)
  const irA = (slug) => { onSelect(slug) }

  return (
    <>
      {mobileOpen && <div className="fixed inset-0 bg-black/30 z-20 lg:hidden" onClick={() => setMobileOpen(false)} />}

      <aside
        onMouseEnter={() => setExpandido(true)}
        onMouseLeave={() => setExpandido(false)}
        className={`fixed lg:absolute z-30 w-[230px] h-full bg-white border-r border-slate-200 flex flex-col transition-all duration-200
          ${expandido ? 'lg:w-[230px] lg:shadow-2xl' : 'lg:w-[60px]'}
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        {/* Logo */}
        <div className="h-[56px] flex items-center gap-2.5 px-3 border-b border-slate-100 shrink-0 overflow-hidden">
          <div className="w-9 h-9 rounded-lg bg-blue-600 text-white flex items-center justify-center font-impact text-lg shrink-0">JL</div>
          <div className={`leading-tight whitespace-nowrap transition-opacity ${expandido ? 'lg:opacity-100' : 'lg:opacity-0'} opacity-100`}>
            <div className="font-bold text-slate-800 text-[14px]">Jornada Laboral</div>
            <div className="text-[10px] text-slate-400 uppercase tracking-wide">Registro de horas</div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto overflow-x-hidden scroll-thin px-2 py-3">
          {Object.entries(grupos).map(([grupo, items]) => {
            const GIcon = GRUPO_ICON[grupo] || Compass
            return (
              <div key={grupo} className="mb-3">
                {/* Encabezado de grupo: label al expandir, icono en el rail */}
                <div className="px-2 mb-1.5 h-4 flex items-center">
                  <span className={`text-[10px] uppercase tracking-[0.14em] text-slate-400 font-semibold whitespace-nowrap transition-opacity ${expandido ? 'lg:opacity-100' : 'lg:opacity-0'} opacity-100`}>{grupo}</span>
                  <GIcon size={13} className={`text-slate-300 mx-auto ${expandido ? 'lg:hidden' : 'lg:block'} hidden`} />
                </div>
                {items.map((it) => {
                  const Icon = it.icon
                  const isActive = it.slug === item?.slug
                  return (
                    <button key={it.slug} onClick={() => { irA(it.slug); setMobileOpen(false) }} title={!expandido ? it.label : undefined}
                      className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13.5px] mb-0.5 transition-colors ${isActive ? 'bg-blue-600 text-white font-semibold' : 'text-slate-600 hover:bg-slate-100'}`}>
                      <Icon size={17} className={`shrink-0 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                      <span className={`flex-1 text-left whitespace-nowrap transition-opacity ${expandido ? 'lg:opacity-100' : 'lg:opacity-0'} opacity-100`}>{it.label}</span>
                      {it.locked && expandido && <Lock size={12} className={isActive ? 'text-white' : 'text-slate-300'} />}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </nav>
      </aside>
      {/* Ocupa el ancho del rail para que el contenido no se mueva (aside es absolute). */}
      <div className="hidden lg:block w-[60px] shrink-0" />
    </>
  )
}

// Menú de la sesión. Ya NO ofrece "ver como": esa lista salía de un endpoint público que se
// eliminó. Aquí solo se ve quién eres y se entra o se sale.
function RoleSwitcher({ me, onChange, onLogin, conJwt }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5 sm:gap-2 border border-slate-200 hover:border-slate-300 rounded-lg px-2 sm:px-2.5 py-1.5">
        <UserCircle size={16} className="text-blue-600" />
        <span className="text-[12px] font-medium text-slate-700 hidden sm:inline">{me ? ROL_CHIP[me.rol] : '…'}</span>
        <ChevronDown size={13} className="text-slate-400" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 w-60 bg-white border border-slate-200 rounded-xl shadow-lg z-40 p-1.5">
            {me && (
              <div className="px-2 py-1.5 border-b border-slate-100 mb-1">
                <div className="text-[13px] font-semibold text-slate-700 truncate">{me.nombre}</div>
                <div className="text-[11px] text-slate-400">{ROL_CHIP[me.rol]}</div>
              </div>
            )}
            <div className="mt-1 pt-1">
              {conJwt ? (
                <button onClick={() => { onChange(''); setOpen(false) }}
                  className="w-full text-left px-2 py-1.5 rounded-lg text-[13px] text-rose-600 hover:bg-rose-50 font-medium">Cerrar sesión</button>
              ) : (
                <button onClick={() => { onLogin?.(); setOpen(false) }}
                  className="w-full text-left px-2 py-1.5 rounded-lg text-[13px] text-[#16697a] hover:bg-[#16697a]/5 font-medium">Iniciar sesión con contraseña</button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function NotificacionesBell({ email, onNavegar }) {
  const [items, setItems] = useState([])
  const [open, setOpen] = useState(false)
  const cargar = () => getNotificaciones().then(setItems).catch(() => setItems([]))
  useEffect(() => { cargar() }, [email])
  const noLeidas = items.filter((n) => !n.leida).length
  const abrir = async (n) => {
    setOpen(false)
    if (!n.leida) { try { await marcarNotifLeida(n.id) } catch { /* noop */ } setItems((p) => p.map((x) => x.id === n.id ? { ...x, leida: true } : x)) }
    const slug = NOTIF_DESTINO[n.tipo]
    if (slug) onNavegar?.(slug)
  }
  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} className="relative p-2 rounded-lg hover:bg-slate-100" aria-label="Notificaciones">
        <Bell size={18} className={noLeidas ? 'text-blue-600' : 'text-slate-500'} />
        {noLeidas > 0 && <span className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-rose-500 text-white text-[9px] flex items-center justify-center font-bold">{noLeidas}</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 w-[300px] max-w-[calc(100vw-1rem)] bg-white border border-slate-200 rounded-xl shadow-lg z-40 p-2 max-h-[70vh] overflow-y-auto scroll-thin">
            <div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold px-2 py-1">Notificaciones</div>
            {items.length === 0 && <div className="text-[13px] text-slate-400 px-2 py-3">Sin notificaciones</div>}
            {items.map((n) => (
              <button key={n.id} onClick={() => abrir(n)}
                className={`w-full text-left px-2.5 py-2 rounded-lg mb-0.5 border transition-colors ${n.leida ? 'bg-white border-transparent hover:bg-slate-50' : 'bg-blue-50/70 border-blue-100 hover:bg-blue-50'}`}>
                <div className="flex items-start gap-2">
                  {!n.leida && <span className="w-2 h-2 rounded-full bg-blue-500 mt-1.5 shrink-0" />}
                  <div className="min-w-0">
                    <div className={`text-[13px] ${n.leida ? 'font-medium text-slate-600' : 'font-semibold text-slate-800'}`}>{n.titulo}</div>
                    {n.descripcion && <div className="text-[12px] text-slate-500 line-clamp-2">{n.descripcion}</div>}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function Pagina({ item, me, onVerArea, deepArea }) {
  switch (item?.slug) {
    case 'inicio': return <InicioPage me={me} onVerArea={onVerArea} />
    case 'registrar': return <RegistrarHorarioPage me={me} />
    case 'mi-equipo': return <MiEquipoPage me={me} />
    case 'empleados': return <EmpleadosPage me={me} />
    case 'periodos': return <PeriodosPage me={me} />
    case 'seguimiento': return <PeriodosPage me={me} />
    case 'consolidado': return <ConsolidadoPage me={me} initialArea={deepArea} />
    case 'reporte': return <ReportePage me={me} />
    case 'licencias': return <LicenciasPage me={me} />
    case 'config': return <ConfiguracionPage me={me} />
    case 'referencia-legal': return <ReferenciaLegalPage me={me} />
    case 'calendario': return <CalendarioPage me={me} />
    case 'nomina': return <ProximamentePage titulo="Módulo de Nómina" mensaje="Cuando estés listo para activar el cálculo de nómina en pesos, contacta al equipo técnico. Este sistema clasifica horas; el cálculo monetario llega con el módulo de nómina." />
    default: return null
  }
}
