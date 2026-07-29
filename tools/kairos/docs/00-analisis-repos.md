# 00 — Análisis de Repos de Referencia

> **Proyecto:** Sistema de Registro y Clasificación de Horas Laborales (Colombia, Ley 2466/2025)
> **Nombre interno / carpeta:** `Nemesis/jornada-laboral/`
> **Rama de trabajo:** `feature/jornada-laboral` (aislada, **sin push**, no dispara CI/CD)
> **Fecha:** 29 jun 2026 · **Estado:** ⏳ Pendiente de aprobación del usuario (Bloque 1)

Este documento cumple el **Bloque 1** del PROMPT_MAESTRO_V5: validación y análisis en **solo lectura** de los repos de referencia. **No se ha escrito código del MVP.** Claude Code no avanza al Bloque 2 hasta que apruebes este documento.

---

## 0. Nota sobre los repos de referencia (validación git)

| Repo del prompt | Ruta real en disco | Estado |
|---|---|---|
| **WC System** (visual) | `C:\Proyectos\Nostra\WC System` (+ `web/`) | ✅ Presente, dentro del monorepo |
| **Nemesis** (lógica) | `C:\Proyectos\Nostra\Nemesis` | ✅ Presente |
| **Nostro** (entorno) | `C:\Proyectos\Nostra` (raíz del monorepo) | ✅ Presente — **"Nostro" = monorepo Nostra** |

**Hallazgos de validación (reglas del Bloque 1):**
- Los 3 "repos" son en realidad **un único monorepo git** (`SportTeamAI/Nostra`, rama `main`). No son clones separados → **no se clonó nada** (correcto).
- ⚠️ **El árbol de trabajo tiene 82 archivos modificados sin commitear** (el reskin teal en curso del dashboard de Nemesis). Por la regla del Bloque 1 **NO se hizo `git pull` ni se tocó nada**. Trabajamos en una rama nueva (`feature/jornada-laboral`) creada desde el estado actual; esos cambios quedan intactos.
- **No existe un repo "Nostro" independiente.** Las rutas placeholder del prompt nunca se rellenaron; se asume —y se confirma por estructura— que el rol "entorno base" lo cumple la raíz del monorepo.

---

## Sección A — WC System (Referencia VISUAL)

La encarnación React del lenguaje visual objetivo existe en **dos** lugares; el más útil para nosotros es el **dashboard de Nemesis ya reskineado** al tema teal de WC System (es React/Vite, igual que lo que construiremos).

### A.1 Stack frontend detectado

| | WC System (`WC System/web`) | Nemesis dashboard (`Nemesis/dashboard`) |
|---|---|---|
| Framework | React `19.2` | React `18.3` |
| Bundler | Vite `7.x` | Vite `6.x` |
| CSS | **Tailwind v4** (`tailwind.config.js`) | **Tailwind v4** (`@theme` en `index.css`, sin config.js) |
| Charts | Recharts `3.x` | Recharts `2.14` |
| Iconos | lucide-react | lucide-react `0.469` |
| Router | React Router `7` | Manual (History API) |
| Auth front | Firebase | Firebase (`AuthGate.jsx` + `permisos.js`) |

**Decisión visual:** clonamos el patrón del **dashboard de Nemesis** (Tailwind v4 + `@theme`, Recharts, lucide-react, shell sidebar+header). Es el código React vivo más cercano a lo que necesitamos.

### A.2 Paleta de colores (HEX reales)

Rampa **teal** (remapeo de `blue-*` en [`Nemesis/dashboard/src/index.css`](../../dashboard/src/index.css)):

```
50 #eef7f9 · 100 #d5eaef · 200 #afd6df · 300 #82c0cc · 400 #489fb5
500 #2a8aa1 · 600 #16697a ←PRIMARY · 700 #115463 · 800 #0f4450 · 900 #0d3943
```

Superficies y tinta (de `WC System/web/src/index.css`):
```
--page-bg #f4f6f8 · --surface #ffffff · --surface-2 #f8fafc · --surface-3 #eef2f6
--ink-1 #0f172a · --ink-2 #1e293b · --ink-3 #334155 · --ink-4 #64748b · --ink-5 #94a3b8
```
Semánticos muteados (no neón): verde `#2a8770`, ámbar `#cf9a35`, rojo `#c23a3a`, violeta `#6f6aa6`.

### A.3 Tipografía
- **Inter** (`font-display`) → body, UI, tablas.
- **Bebas Neue** (`font-impact`) → números grandes / titulares (KPI).
- **Roboto Mono** (`font-mono`) → cifras tabulares.

### A.4 Componentes reutilizables identificados (en `Nemesis/dashboard/src/components`)
Shell/layout: `App.jsx` (sidebar rail colapsable + header + footer), `FilterBar.jsx`.
KPI/tarjetas: `KpiCard.jsx` (6 acentos de color), `KpiCardInteractivo.jsx`, `TopRankCard.jsx`.
Tablas: `TopTable.jsx`, `RankingTable.jsx`.
Charts (Recharts): `TimeSeriesChart.jsx`, `DistribucionChart.jsx`, `ComparativaBarChart.jsx`, `ParetoChart.jsx`, `ScatterBubble.jsx`.
Overlays: `Tooltip.jsx` (4 posiciones), `TierModal.jsx`, `DimensionDetailModal.jsx`, `OperacionesBreakdownModal.jsx`.
Paneles: `DetallePanel.jsx`, `DrillDownPanel.jsx`, `InsightPanel.jsx`, `PlaceholderPanel.jsx`.

**Decisión:** se **adaptan** (no se copian textualmente) `KpiCard`, `FilterBar` (selector de período/equipo), `Tooltip`, `TopTable`, modales y el shell sidebar+header. Se **crean nuevos** los componentes específicos del dominio (calendario de período, grilla empleado×día, formulario de registro con cálculo en vivo, tabla de recargos legal). No aplican los charts analíticos de apuestas (Pareto/Scatter de GGR) salvo para reportes Fase 2.

### A.5 Layout responsive
Shell `flex h-screen`: sidebar (rail 56px ↔ 220px con flyout) + main (header `h-[53px]` con breadcrumb/filtros/botón **Hub** + `<main>` scrollable + footer de estado). Drawer en mobile, rail colapsable en desktop. **Lo replicamos.**

### A.6 Auth en el front
[`AuthGate.jsx`](../../dashboard/src/auth/AuthGate.jsx) bloquea toda la app si no hay sesión Firebase (en `DEV` permite pasar). Sesión **compartida con el hub** vía `browserLocalPersistence` (mismo proyecto Firebase) → **botón "Ir al hub para iniciar sesión"**. [`permisos.js`](../../dashboard/src/auth/permisos.js): roles `admin/junta/operativo/analista/quota`, `filtrarNav()` + `puedeVer(slug, rol)`. **Este es el patrón de integración con el hub que adoptaremos.**

---

## Sección B — Nemesis (Referencia LÓGICA / ARQUITECTURA)

### B.1 Stack backend detectado
- **Python 3.11+**, tipado estricto (`mypy --strict`), linter/formatter **ruff**.
- **FastAPI 0.115** + **Uvicorn** (ASGI). Entrypoint `src.presentation.api.app:app`.
- Validación/config: **Pydantic 2.9** + **pydantic-settings** (lee `.env`).
- Auth: **Firebase Authentication** como IdP — el backend **verifica** ID tokens (RS256 contra JWKS de Google), **no emite** tokens. `PyJWT`, `python-jose`, `passlib[bcrypt]` disponibles.
- Logging: **structlog** (JSON en prod, consola en dev) + audit log separado.
- Datos (Nemesis): Snowflake (read-only, capa SILVER) + DuckDB (cache). *No usa una BD transaccional.*

### B.2 Arquitectura en capas — **Hexagonal (Ports & Adapters)**
```
src/
├── domain/         # modelos puros, errores, puertos (Protocols). Sin deps externas.
├── application/    # casos de uso (queries/, refresh_*). Lógica de negocio.
├── infrastructure/ # adapters reales (snowflake, duckdb), security/ (7 middlewares), etl/
└── presentation/   # api/ (app.py, deps.py, endpoints*.py), cli.py
```
**Decisión:** **replicamos esta arquitectura hexagonal** tal cual, adaptando los adapters a PostgreSQL. El **algoritmo de clasificación legal** vive en `domain/` (puro, testeable) — encaja perfecto con "Domain sin dependencias externas".

### B.3 Auth y sesiones
`presentation/api/deps.py`: dependencia global `require_auth` (rutas públicas en allow-list), `require_rol(*roles)` para autorización. `infrastructure/security/firebase_auth.py` verifica issuer/audience/exp y deriva el rol desde el **custom claim `role`**. **Es exactamente el modelo de integración con el hub.**

### B.4 Manejo de errores centralizado
Jerarquía `DomainError` → `AuthenticationError/AuthorizationError/ValidationError/RepositoryError`. Exception handlers en `app.py` mapean a HTTP (400/401/403/503/500) con cuerpo `{ "error", "code" }`, sin filtrar detalles internos. **Lo replicamos.**

### B.5 Migraciones
Nemesis **no tiene migraciones formales** (es read-only sobre Snowflake; usa `.sql` estáticos + jobs de rollup). **Gap para nuestro proyecto** → introduciremos **Alembic** (estándar FastAPI+SQLAlchemy) para versionar el schema PostgreSQL transaccional. Justificación documentada.

### B.6 Logging
**structlog** configurado en `infrastructure/logs.py`; audit logging en `infrastructure/security/audit.py` (rotación 10MB×30d, eventos ACCESS/LOGIN/DATA/CONFIG). **Lo replicamos** (encaja con la tabla `auditoria` del Bloque 7).

### B.7 Tests
**pytest** + pytest-asyncio + pytest-cov, `--cov=src`. `tests/unit/` y `tests/security/` (incl. `test_auth_global.py`, que es el **gate del CI**). **Modelo a seguir**, con foco obligatorio en `algorithms/` (clasificador legal).

### B.8 Configuración / variables de entorno
`pydantic-settings` por secciones con prefijo (`SNOWFLAKE_`, `APP_`, `CACHE_`, `API_`). Patrón a reutilizar (cambiando Snowflake→Postgres).

### B.9 Agentes y skills encontrados → ver **Sección D**.

---

## Sección C — Nostro / Monorepo Nostra (ENTORNO)

### C.1 Estructura
Monorepo multi-app: `NOSTRA` (hub), `Nemesis`, `WC System`, `Calendario`, `OddsVision`, `Bot_Negativos` (Dashboard GGR), `E-Learning`, `Cuotas`, etc. Cada módulo **se buildea a `public/<modulo>/`**.

### C.2 Hosting / deploy — Firebase Hosting
[`firebase.json`](../../../firebase.json): rewrites SPA por ruta (`/nemesis/**`, `/wcsystem/**`, …). El **hub** = `https://deportivasvirtualsoft.web.app` (proyecto `deportivasvirtualsoft`). **Un módulo nuevo se publicaría como `/jornada/**` → `public/jornada/index.html`.**

### C.3 CI/CD — GitHub Actions (⚠️ crítico para no romper prod)

| Workflow | Trigger | Efecto |
|---|---|---|
| **deploy-nemesis.yml** | `push` a **main** tocando `Nemesis/src/**`, `Nemesis/requirements.txt`, `Nemesis/pyproject.toml`, `Nemesis/dashboard/**`, o el propio workflow | Gate de tests → **backend a VPS (rsync+SSH)** + **frontend a Firebase `live`** |
| odds-api.yml | cron cada 2h | Scrape odds → Firestore |
| promo-report-update.yml | cron diario 09:00 UTC | Reporte calendario → commit + Firebase |

**Conclusión de seguridad CI/CD (lo que pediste):**
- Nuestro código vive en `Nemesis/jornada-laboral/**`, que **NO coincide** con ningún `paths:` del workflow → aun un push accidental **no dispararía** el deploy de Nemesis.
- Aun así, **trabajamos en `feature/jornada-laboral` y no hacemos push.** El deploy a prod **solo** ocurre con push a `main`. **Doble garantía: rama aislada + path fuera de los triggers.**
- Cuando llegue el despliegue de prueba (Fase 3) usaremos un **workflow y subdominio propios** (`deploy-jornada.yml`, entorno **test**), nunca el de Nemesis.

### C.4 Variables de entorno
Raíz `.env.example`: puertos Vite por app. `Nemesis/.env.example`: `SNOWFLAKE_*`, `APP_*` (incl. `APP_JWT_SECRET`, `APP_RATE_LIMIT_*`), `ENCRYPTION_KEY`, `CACHE_*`, `API_*`, `APP_TRUSTED_HOSTS`, `APP_IP_WHITELIST`.

### C.5 Scripts y deploy del VPS
`package.json` raíz + `build-all.ps1` + `scripts/rebuild.ps1` (build modular a `public/`). Nemesis corre en VPS Hostinger: nginx+TLS → `127.0.0.1:8000` (uvicorn), systemd, secrets en `/etc/nemesis/.env`. **Dockerfile** multi-stage no-root y **nginx/nginx.conf** endurecido disponibles como plantilla. **Reutilizamos estos patrones** para el entorno de prueba del nuevo sistema (subdominio + BD + nginx propios).

---

## Sección D — Inventario consolidado de agentes y skills

| Agente / Skill | Repo origen | Rol | ¿Aplica? | Cómo se invoca |
|---|:--:|---|:--:|---|
| **deploy-engineer** (agente) | Nemesis | DevOps/CI-CD en VPS Hostinger; tiene MCP hostinger-vps/dns/domains | ✅ **Sí** (Bloque 4) | Agent tool `subagent_type: deploy-engineer` o leyendo su guía |
| **security-auditor** (agente) | Nemesis | Auditoría de fugas/red/TLS/auth, solo lectura, veredicto APTO/NO APTO | ✅ **Sí** (pre-deploy) | Agent tool / skill `nemesis-security` |
| **frontend-ux-engineer** (agente) | Nemesis | UX/UI senior React+Vite+Tailwind v4+recharts; verifica en preview | ✅ **Sí** (Fase 2 PWA) | Agent tool + preview tools |
| **nemesis-deploy** (skill) | Nemesis | Procedimiento 9 fases: DNS→VPS→secrets→systemd→cron→nginx/TLS→front→CI/CD→verificación | ✅ **Adaptado** (entorno test) | `Skill: nemesis-deploy` |
| **nemesis-security** (skill) | Nemesis | Escaneo secretos, red, TLS, auth-gate, GitHub | ✅ **Sí** | `Skill: nemesis-security` |
| **nemesis-ux** (skill) | Nemesis | Auditoría responsive/jerarquía/estados/accesibilidad por fases | ✅ **Sí** (Fase 2) | `Skill: nemesis-ux` |
| MCP **hostinger-vps / -dns / -domains** | (sesión) | Operar VPS, DNS y dominios reales | ✅ **Sí** (Bloque 4) | tools `mcp__hostinger-*` |

WC System **no tiene agentes propios** (`.claude/` no existe ahí); su valor es 100% visual.

**Agentes de uso general disponibles** (no del repo, pero útiles): `Explore`/`Plan` (análisis), `gsd-*` (planificación/ejecución/review). Skills genéricas relevantes: `springboot-*`/`django-*` no aplican; sí `database-migrations`, `e2e-testing`, `security-review`, `deployment-patterns`, `frontend-design`.

---

## Sección E — Gaps detectados (capacidades faltantes)

| Capacidad necesaria | ¿Cubierta? | Acción |
|---|:--:|---|
| Diseño UI React+Tailwind | ✅ `frontend-ux-engineer` | Reutilizar |
| Arquitectura backend en capas | ✅ patrón Nemesis (hexagonal) | Replicar |
| Despliegue Hostinger | ✅ `deploy-engineer` + `nemesis-deploy` | Reutilizar (adaptado a entorno test) |
| Auditoría de seguridad | ✅ `security-auditor` + `nemesis-security` | Reutilizar |
| **Validación legal colombiana (CST + Ley 2466/2025)** | ❌ **No existe** | **Crear `colombian-labor-law-validator`** (único agente nuevo justificado) |
| **Schema + migraciones PostgreSQL transaccional** | ⚠️ Parcial (Nemesis es read-only) | Introducir **Alembic**; opcional agente `database-engineer` o usar `gsd-*`/skill `database-migrations` |
| **Clasificador de horas con tests** | ❌ Es nuevo (núcleo) | Construir en `domain/algorithms/` con pytest obligatorio (lo valida el agente legal) |

**Único agente nuevo a crear:** `colombian-labor-law-validator` (rol: validar el algoritmo de clasificación, recargos, festivos, jornadas y fechas normativas contra CST/Ley 2466/2025). Para schema/migraciones se evaluará reutilizar skills genéricas antes de crear un agente dedicado.

---

## DECISIONES DE ARQUITECTURA RECOMENDADAS (requieren tu visto bueno)

Como me delegaste el stack ("usa lo que mejor se nos dé y quede mejor alineado"), esta es mi recomendación **alineada con el ecosistema NOSTRA**:

1. **Backend: Python + FastAPI** (arquitectura hexagonal idéntica a Nemesis) en vez del Node/Express del prompt. **Razón:** todo el ecosistema (Nemesis, WC System) es Python+FastAPI; reutilizamos patrones, agentes (`deploy-engineer`), skills (`nemesis-deploy`/`-security`) y el know-how del equipo. El algoritmo legal va en `domain/` puro y testeable.
2. **Base de datos: PostgreSQL 15+** con **SQLAlchemy + Alembic** para migraciones versionadas. Es la BD correcta para CRUD transaccional (Nemesis usa Snowflake porque es read-only; aquí necesitamos escrituras/auditoría).
3. **Frontend: React 18 + Vite + Tailwind v4 (`@theme` teal #16697A) + Recharts + lucide-react + TypeScript**, clonando el shell y componentes del dashboard de Nemesis. **PWA** con Workbox (service worker) + **Dexie/IndexedDB** (offline, Bloque 5).
4. **Auth e integración con "el hub": Firebase Authentication** (mismo proyecto `deportivasvirtualsoft`), verificando ID tokens en el backend igual que Nemesis (`firebase_auth.py`), con **roles vía custom claims** (`super_admin/registrador/lider`). **Razón:** es el SSO del hub → "se comunica muy bien con el hub", da MFA, reset de contraseña e invitación por correo sin reinventarlos. La gestión autónoma de usuarios por RH (Bloque 6.1) se implementa como API admin que crea usuarios y asigna claims.
   - *Alternativa si RH quiere un universo de usuarios totalmente independiente del hub:* auth local con JWT propios + tabla `usuarios` (como en el schema del Bloque 7). **Decisión tuya.**
5. **Despliegue de prueba (Fase 3): subdominio + BD + workflow PROPIOS** (vía `deploy-engineer`/MCP Hostinger), **nunca** el pipeline de Nemesis. Frontend de prueba como módulo `/jornada/` o en su propio subdominio.

### Divergencias explícitas respecto al PROMPT_MAESTRO_V5
| Prompt pedía | Decisión | Motivo |
|---|---|---|
| Node.js + Express + TS | **Python + FastAPI** | Alineación total con el ecosistema |
| JWT propio + refresh + bcrypt | **Firebase Auth** (con fallback JWT local si lo prefieres) | SSO del hub |
| ORM Prisma/Drizzle | **SQLAlchemy + Alembic** | Estándar del stack Python elegido |
| Zod (validación) | **Pydantic v2** | Equivalente nativo en Python |

Frontend (React+Vite+Tailwind+PWA), PostgreSQL, Swagger/OpenAPI, tests del algoritmo, pantallas "Próximamente", y todo el dominio funcional (Bloques 6–8) **se mantienen igual que el prompt**.

---

## Próximos pasos (tras tu aprobación)
1. Crear el agente `colombian-labor-law-validator` en `Nemesis/jornada-laboral/.claude/agents/`.
2. `docs/01-arquitectura.md` (estructura de carpetas definitiva + diagrama).
3. Fase 1 MVP Backend: scaffold hexagonal, settings, logger, migraciones Alembic con datos iniciales (19 festivos 2026 + 3 filas `config_recargos` + super_admin), auth Firebase/roles, CRUD, **algoritmo de clasificación con tests**, Swagger.
4. Fase 2 MVP Frontend PWA. 5. Fase 3 despliegue a **entorno de prueba**.

> **⏸️ PUNTO DE APROBACIÓN.** Confirma (o corrige) las **Decisiones de Arquitectura** —en especial: (a) Python+FastAPI, (b) Firebase Auth vs JWT local— y arranco la Fase 1 en la rama aislada.
