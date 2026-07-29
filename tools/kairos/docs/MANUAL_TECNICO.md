# Manual Técnico — Kairos / Jornada Laboral

Sistema de registro y clasificación de horas laborales (Colombia, CST + Ley 2466/2025),
módulo del hub **NOSTRA / Producto Deportivas**. Nombre de la herramienta: **Kairos**.

---

## 1. Arquitectura (¿monolito o microservicios?)

**Front y back SEPARADOS**, comunicados por API REST. No son microservicios: el backend
es un **monolito modular** (una sola app FastAPI con arquitectura hexagonal por capas).

```
┌─────────────────────────┐        HTTPS / JSON        ┌──────────────────────────────┐
│  FRONTEND (SPA)         │  ───────────────────────►  │  BACKEND (una sola app)      │
│  React 18 + Vite        │   cookie HttpOnly (JWT)    │  FastAPI + SQLAlchemy        │
│  Tailwind v4            │  ◄───────────────────────  │  SQLite (dev) / Postgres     │
│  apps/frontend          │        /api (proxy)        │  apps/backend                │
└─────────────────────────┘                            └──────────────────────────────┘
        (Firebase Hosting)                                     (VPS / uvicorn)
```

- **Separación**: se despliegan por separado (el front como estático; el back como servicio).
- **Monolito modular** en el back: un proceso, con capas `domain` (lógica legal pura,
  sin dependencias), `application`, `infrastructure` (BD, Buk, seguridad), `presentation`
  (API). No hay varios servicios independientes → menos complejidad operativa.
- En dev, Vite proxya `/api` → `127.0.0.1:8020`, así front y back son **mismo origen**
  (la cookie de sesión funciona sin CORS).

## 2. Stack

| Capa | Tecnología |
|---|---|
| Backend | Python 3.14, FastAPI, SQLAlchemy 2.0, pydantic-settings, structlog |
| BD | SQLite (dev, `apps/backend/data/jornada.db`) · PostgreSQL (prod) |
| Auth | JWT local (PyJWT HS256) + bcrypt (passlib); cookie HttpOnly |
| Frontend | React 18, Vite 6, Tailwind v4 (tema teal #16697A), lucide-react |
| Integración | Buk (HR) por API REST (urllib) |

## 3. Estructura del backend (`apps/backend/src/jornada`)

```
domain/            # Lógica pura (clasificación legal de horas, recargos, festivos, calendario)
  algorithms/      #   classifier.py (núcleo), recargos.py, time_segments.py
  nomina/          #   calendario.py (cortes, pagos, reporte a TH/Financiera)
application/       # Casos de uso, seed, reporte_excel
infrastructure/
  db/              # models.py (tablas), database.py
  security/        # auth.py (hash, JWT, tokens onboarding)
  buk/             # cliente.py, sync.py (integración Buk)
presentation/api/  # endpoints_*.py (auth, buk, crud, clasificacion), deps.py, schemas_crud.py, app.py
config/settings.py # variables de entorno
```

## 4. Autenticación y seguridad

- **Identidad**: JWT firmado localmente (HS256), en **cookie HttpOnly** `jl_token`
  (JavaScript NO puede leerla → inmune a robo por XSS). `credentials: 'include'` en el front.
  **Cero datos de sesión en localStorage/sessionStorage.**
- **Onboarding**: TH/líder genera un enlace de un solo uso (`?onboarding=<token>`, token
  de 256 bits, expira 7 días). La persona abre el enlace, crea su contraseña → queda
  logueada (cookie). Después ingresa con correo + contraseña.
- **Roles**: `super_admin` (Talento Humano), `lider`, `registrador`. Validados en el
  backend con `require_rol` en cada endpoint (la seguridad NO depende de la URL del front).
- **Restricción de dominio**: solo correos **@virtualsoft.tech** pueden tener acceso real.
- **Modo demo** (`X-Demo-User`): solo para desarrollo; **gateado a `APP_ENV != production`**.
  En producción la única identidad válida es el JWT.
- **Guardas de producción**: la app **no arranca** si `JWT_SECRET` es el default o < 32
  chars. La lista de usuarios demo se **elimina del bundle** de producción (tree-shaking).
- **Datos**: cada respuesta va filtrada por rol/equipo; nunca se expone `password_hash`.
  El token de onboarding se muestra a TH/líder **solo para compartir el enlace** (no hay
  servidor de correo aún) — endurecer con verificación por correo al desplegar.

## 5. Períodos de nómina

- Nomenclatura `NM{q}Q{Mes}{AA}` (NM1 paga 15, NM2 paga fin de mes).
- **Períodos por área**: un período con `equipo_id` solo lo ve esa área (SAC/Incidentes
  reportaron julio en fechas distintas). Conservan el nombre estándar (NM1QJulio26) con una
  **nota** que explica las fechas propias. Desde agosto todos usan los globales.
- **Reporte a Financiera** = corte a TH + 2 días hábiles.

## 6. Ajustes de nómina (TH)

- `AjusteReporte` (empleado + período + categoría + horas ± + motivo + autor).
- **NO toca la grilla** (lo reportado por el equipo queda intacto). Se aplica ENCIMA en el
  reporte a Financiera y en el resumen. Al crearlo publica una **nota automática en
  Consolidado y chat** del área → trazabilidad. Endpoints `/ajustes` (solo super_admin).

## 7. Integración Buk (HR)

- **Token** (secreto): solo en variable de entorno `BUK_TOKEN` (nunca en código/BD/front).
  Se genera en Buk › Configuración › Accesos API con permiso **Colaboradores: solo lectura**.
- `BUK_TENANT` = subdominio (`https://{tenant}.buk.co`). Base: `/api/v1/{pais}`.
- `cliente.py`: GET con header `auth_token`, paginado. `sync.py`: upsert por cédula
  (actualiza existentes; crea nuevos si su área mapea a un Equipo; reporta los que no).
- **Automático**: `BUK_SYNC_HORAS > 0` activa un scheduler que sincroniza cada N horas
  (cuando entra alguien nuevo a Buk, aparece solo). Manual: botón en Config › Integración Buk.

## 8. Variables de entorno (`apps/backend/.env`)

```
APP_ENV=development|production
JWT_SECRET=<>=32 chars aleatorios>        # OBLIGATORIO en producción
JWT_EXPIRA_HORAS=12
FRONTEND_BASE_URL=http://localhost:5180   # para los enlaces de onboarding
BUK_TENANT=                                # subdominio de Buk
BUK_TOKEN=                                 # auth_token solo lectura (SECRETO)
BUK_PAIS=colombia
BUK_SYNC_HORAS=0                           # 0=manual; ej. 12 = auto cada 12 h
```

El `.env` está **gitignored** (no se sube). Los nombres de variable = campo en mayúsculas.

## 9. Ejecución local

```
# Backend (venv propio)
cd apps/backend
.venv/Scripts/python -m uvicorn jornada.presentation.api.app:app --host 127.0.0.1 --port 8020 --app-dir src
# Frontend
cd apps/frontend
npm run dev        # http://localhost:5180  (proxya /api → 8020)
```

## 10. Sobre las URLs por rol (`/rol/jornadalaboral`) y Kairos

Se puede estructurar la navegación con rutas (ej. base `/jornada-laboral`), pero **la URL
NO es un mecanismo de seguridad**: cualquiera puede teclear cualquier ruta. Los permisos
se hacen cumplir en el **backend** (JWT + `require_rol` por endpoint), que ya está. Para el
control fino de permisos dentro de Kairos, lo correcto es un modelo de permisos por rol en
el back (no en el path). La ruta sirve para organización/integración con el hub, no para proteger.
