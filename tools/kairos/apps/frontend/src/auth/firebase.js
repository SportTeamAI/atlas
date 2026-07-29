// Firebase Auth client — comparte la sesión del hub Nostra (mismo proyecto).
// El backend verifica el ID token contra el JWKS público de Google (sin secretos).
import { initializeApp } from 'firebase/app'
import {
  getAuth,
  onAuthStateChanged,
  browserLocalPersistence,
  setPersistence,
} from 'firebase/auth'

// Mismos valores públicos que el hub Nostra (NOSTRA/index.html y dashboard Nemesis).
const firebaseConfig = {
  apiKey: 'AIzaSyC-c7u3aCrl4g9aNZK-c9YoVVLEfFJybmc',
  authDomain: 'deportivasvirtualsoft.firebaseapp.com',
  projectId: 'deportivasvirtualsoft',
  storageBucket: 'deportivasvirtualsoft.firebasestorage.app',
  messagingSenderId: '93674109223',
  appId: '1:93674109223:web:9daf73ae78b49f02cf9102',
}

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)

// En producción comparte la sesión del hub (persistencia local). En DEV se
// omite para no abrir conexiones que cuelguen el render headless del preview.
if (!import.meta.env.DEV) {
  setPersistence(auth, browserLocalPersistence).catch(() => {})
}

export function subscribeAuth(cb) {
  return onAuthStateChanged(auth, cb)
}
