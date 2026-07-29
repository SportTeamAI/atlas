// Sesión. El JWT vive en una cookie HttpOnly puesta por el backend: JS no la ve ni la
// guarda (inmune a robo por XSS). Nada en localStorage ni en sessionStorage.
//
// Ya NO hay selector "ver como": se entra SIEMPRE con correo y contraseña por /auth/login,
// también en local. El endpoint que listaba usuarios se eliminó — publicar nombres, correos
// y roles sin autenticar le dice a un atacante a quién apuntar y quién es administrador.

const KEY = 'jl_demo'

function leerCookie(nombre) {
  const m = document.cookie.match(new RegExp('(?:^|; )' + nombre + '=([^;]*)'))
  return m ? decodeURIComponent(m[1]) : null
}

// Solo para pruebas locales por consola (el backend únicamente lo acepta con
// APP_DEMO_LOGIN=1, que en producción impide arrancar). La app no lo usa.
let _email = leerCookie(KEY) || ''

export function getEmail() {
  return _email
}

export function setEmail(email) {
  _email = email
  document.cookie = `${KEY}=${encodeURIComponent(email)}; path=/; max-age=${60 * 60 * 24 * 30}; SameSite=Lax`
}
