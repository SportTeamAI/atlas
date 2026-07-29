// Cliente HTTP del backend. Adjunta el usuario demo (header X-Demo-User) y, si
// hay sesión Firebase, también el ID token (para producción).
import { getEmail } from './session'

async function request(path, { method = 'GET', body } = {}) {
  // El JWT de la sesión real viaja en cookie HttpOnly (credentials: 'include'); JS no lo
  // toca. X-Demo-User es solo el selector demo de dev (el backend lo ignora en prod).
  const headers = { 'Content-Type': 'application/json', 'X-Demo-User': getEmail() }
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    credentials: 'include',
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }))
    const detail = err.detail ?? err.error
    // El detalle puede ser un objeto estructurado (ej. área incompleta → modal).
    const msg = typeof detail === 'string' ? detail : (detail?.titulo || `HTTP ${res.status}`)
    const e = new Error(msg)
    if (detail && typeof detail === 'object') e.data = detail
    e.status = res.status
    throw e
  }
  return res.status === 204 ? null : res.json()
}

// ── Identidad / dashboard ── (la identidad va por /auth/estado en session.js)
export const getResumen = () => request('/resumen')
export const getDashboard = () => request('/dashboard')
export const enviarRecordatorios = () => request('/recordatorios/enviar', { method: 'POST', body: {} })

// ── Catálogos ──
// todos=true trae activos + inactivos (vista de TH con toggle); por defecto solo activos.
export const getEquipos = (inactivos, todos) => request(`/equipos${todos ? '?todos=1' : inactivos ? '?inactivos=1' : ''}`)
export const getEmpleados = (equipoId, todos) => {
  const qs = new URLSearchParams()
  if (equipoId) qs.set('equipo_id', equipoId)
  if (todos) qs.set('todos', '1')
  const q = qs.toString()
  return request(`/empleados${q ? `?${q}` : ''}`)
}
export const getInactivos = (recurso) => request(`/${recurso}?inactivos=1`)
export const deleteEquipo = (id) => request(`/equipos/${id}`, { method: 'DELETE' })
export const deleteEmpleado = (id) => request(`/empleados/${id}`, { method: 'DELETE' })
export const deleteTurno = (id) => request(`/turnos/${id}`, { method: 'DELETE' })
export const createEmpleado = (data) => request('/empleados', { method: 'POST', body: data })
export const getUsuarios = () => request('/usuarios')
export const getUsuariosMiEquipo = () => request('/mi-equipo/usuarios')
export const designarRegistrador = (id) => request(`/mi-equipo/registrador/${id}`, { method: 'POST' })
// Activa/quita a un EMPLEADO como registrador (varios permitidos). El líder lo maneja.
export const toggleRegistrador = (empleadoId, activar) => request(`/mi-equipo/registrador/${empleadoId}?activar=${activar}`, { method: 'POST' })
// El líder decide quién de su equipo lleva horario (distinto del acceso a la plataforma).
export const toggleLlevaHorario = (empleadoId, valor) => request(`/mi-equipo/lleva-horario/${empleadoId}?valor=${valor}`, { method: 'POST' })
export const getFestivos = () => request('/festivos')
export const getNotificaciones = () => request('/notificaciones')
export const marcarNotifLeida = (id) => request(`/notificaciones/${id}/leida`, { method: 'POST' })
export const getConfigRecargos = () => request('/config/recargos')
export const patchRecargo = (fecha, data) => request(`/config/recargos/${fecha}`, { method: 'PATCH', body: data })
export const getTurnos = () => request('/turnos')
export const createTurno = (data) => request('/turnos', { method: 'POST', body: data })
export const patchTurno = (id, data) => request(`/turnos/${id}`, { method: 'PATCH', body: data })
export const aplicarHabitual = (periodoId, data) => request(`/periodos/${periodoId}/aplicar-habitual`, { method: 'POST', body: data })
export const aplicarTurno = (periodoId, data) => request(`/periodos/${periodoId}/aplicar-turno`, { method: 'POST', body: data })
export const asignar = (periodoId, data) => request(`/periodos/${periodoId}/asignar`, { method: 'POST', body: data })
export const enviarValidacion = (periodoId) => request(`/periodos/${periodoId}/enviar-validacion`, { method: 'POST' })
export const validarLider = (periodoId) => request(`/periodos/${periodoId}/validar-lider`, { method: 'POST' })
export const getEstadoEquipos = (periodoId) => request(`/periodos/${periodoId}/equipos`)
export const devolverPeriodo = (periodoId, data) => request(`/periodos/${periodoId}/devolver`, { method: 'POST', body: data })
export const aprobarPeriodo = (periodoId, data) => request(`/periodos/${periodoId}/aprobar`, { method: 'POST', body: data || {} })
export const getComentarios = (periodoId, equipoId) => request(`/periodos/${periodoId}/comentarios${equipoId ? `?equipo_id=${equipoId}` : ''}`)
export const postComentario = (periodoId, data) => request(`/periodos/${periodoId}/comentarios`, { method: 'POST', body: data })
export const getEventos = () => request('/eventos')
export const createEvento = (data) => request('/eventos', { method: 'POST', body: data })
export const patchEvento = (id, data) => request(`/eventos/${id}`, { method: 'PATCH', body: data })
export const deleteEvento = (id) => request(`/eventos/${id}`, { method: 'DELETE' })
export const generarPeriodos = (data) => request('/periodos/generar', { method: 'POST', body: data })
export const getCalendarioNomina = (anio = 2026) => request(`/calendario/nomina?anio=${anio}`)
export const investigarNormativa = () => request('/normativa/investigar', { method: 'POST', body: {} })
export const getBeneficios = () => request('/beneficios')
export const createBeneficio = (data) => request('/beneficios', { method: 'POST', body: data })
export const patchBeneficio = (id, data) => request(`/beneficios/${id}`, { method: 'PATCH', body: data })
export const deleteBeneficio = (id) => request(`/beneficios/${id}`, { method: 'DELETE' })
export const getPagosManuales = () => request('/pagos-manuales')
export const createPagoManual = (data) => request('/pagos-manuales', { method: 'POST', body: data })
export const patchPagoManual = (id, data) => request(`/pagos-manuales/${id}`, { method: 'PATCH', body: data })
export const deletePagoManual = (id) => request(`/pagos-manuales/${id}`, { method: 'DELETE' })
export const getAlmuerzo = () => request('/almuerzo')
export const setAlmuerzo = (data) => request('/almuerzo', { method: 'PUT', body: data })
export const sugerirTurno = (data) => request('/turnos/sugerir', { method: 'POST', body: data })
export const getSolicitudesCambio = () => request('/solicitudes-cambio')
export const createSolicitudCambio = (data) => request('/solicitudes-cambio', { method: 'POST', body: data })
export const responderSolicitudCambio = (id, data) => request(`/solicitudes-cambio/${id}/responder`, { method: 'POST', body: data })
export const getReporte = (periodoId) => request(`/periodos/${periodoId}/reporte`)
export const generarCarpetaNomina = (periodoId) => request(`/periodos/${periodoId}/generar-carpeta`, { method: 'POST' })
export const createEquipo = (data) => request('/equipos', { method: 'POST', body: data })
export const patchEquipo = (id, data) => request(`/equipos/${id}`, { method: 'PATCH', body: data })
export const patchEmpleado = (id, data) => request(`/empleados/${id}`, { method: 'PATCH', body: data })
export const patchUsuario = (id, data) => request(`/usuarios/${id}`, { method: 'PATCH', body: data })
export const deleteRegistro = (id) => request(`/registros/${id}`, { method: 'DELETE' })

// ── Períodos ──
export const getPeriodos = () => request('/periodos')
export const createPeriodo = (data) => request('/periodos', { method: 'POST', body: data })
export const enviarPeriodo = (id) => request(`/periodos/${id}/enviar`, { method: 'POST' })
export const cerrarPeriodo = (id) => request(`/periodos/${id}/cerrar`, { method: 'POST' })
export const reabrirPeriodo = (id, data) => request(`/periodos/${id}/reabrir`, { method: 'POST', body: data || {} })
export const patchPeriodo = (id, data) => request(`/periodos/${id}`, { method: 'PATCH', body: data })

// ── Novedades ──
export const getNovedades = (empId) => request(`/novedades${empId ? `?empleado_id=${empId}` : ''}`)
export const createNovedad = (data) => request('/novedades', { method: 'POST', body: data })
export const deleteNovedad = (id) => request(`/novedades/${id}`, { method: 'DELETE' })

// ── Registros ──
export const getRegistros = (periodoId, empId) => {
  const qs = new URLSearchParams()
  if (periodoId) qs.set('periodo_id', periodoId)
  if (empId) qs.set('empleado_id', empId)
  const q = qs.toString()
  return request(`/registros${q ? `?${q}` : ''}`)
}
export const createRegistro = (data) => request('/registros', { method: 'POST', body: data })
export const clasificar = (payload) => request('/clasificar', { method: 'POST', body: payload })

// ── Auth / accesos (JWT en cookie HttpOnly) ──
export const login = (email, password) => request('/auth/login', { method: 'POST', body: { email, password } })
export const logout = () => request('/auth/logout', { method: 'POST', body: {} })
export const getEstadoAuth = () => request('/auth/estado')
export const verOnboarding = (token) => request(`/auth/onboarding/${token}`)
export const definirContrasena = (token, password) => request('/auth/definir-contrasena', { method: 'POST', body: { token, password } })
export const getAccesos = () => request('/accesos')

// ── Solicitudes del líder a TH (lleva horario / acceso con rol registrador) ──
export const getSolicitudes = (estado) => request(`/solicitudes${estado ? `?estado=${estado}` : ''}`)
export const crearSolicitud = (data) => request('/solicitudes', { method: 'POST', body: data })
export const resolverSolicitud = (id, aprobar, respuesta) =>
  request(`/solicitudes/${id}/resolver?aprobar=${aprobar}`, { method: 'POST', body: { respuesta } })
export const getReceptores = () => request('/solicitudes/receptores')
export const marcarReceptor = (usuarioId, recibe) =>
  request(`/solicitudes/receptores/${usuarioId}?recibe=${recibe}`, { method: 'POST', body: {} })
export const otorgarAcceso = (empleadoId, rol = 'registrador') => request(`/accesos/otorgar/${empleadoId}?rol=${rol}`, { method: 'POST', body: {} })
export const crearAcceso = (data) => request('/accesos/crear', { method: 'POST', body: data })
export const revocarAcceso = (usuarioId) => request(`/accesos/${usuarioId}/revocar`, { method: 'POST', body: {} })
export const regenerarAcceso = (usuarioId) => request(`/accesos/${usuarioId}/regenerar`, { method: 'POST', body: {} })

// ── Ajustes de TH ──
export const getAjustes = (periodoId) => request(`/ajustes${periodoId ? `?periodo_id=${periodoId}` : ''}`)
export const crearAjuste = (data) => request('/ajustes', { method: 'POST', body: data })
export const borrarAjuste = (id) => request(`/ajustes/${id}`, { method: 'DELETE' })

// Buk: corre solo cada BUK_SYNC_HORAS; este es el disparador manual de TH.
export const sincronizarBuk = () => request('/empleados/sincronizar-buk', { method: 'POST', body: {} })
