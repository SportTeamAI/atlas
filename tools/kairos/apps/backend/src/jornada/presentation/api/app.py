"""Aplicación FastAPI del backend de Jornada Laboral.

Por ahora expone /health y el endpoint de clasificación (núcleo del sistema).
Los CRUD (equipos, usuarios, empleados, periodos, novedades, registros) se
añaden sobre esta base en la Fase 1.
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from jornada.application.seed import inicializar_herramientas, seed_si_vacio
from jornada.config.settings import get_settings
from jornada.infrastructure.buk import sync as buk_sync
from jornada.infrastructure.db.database import SessionLocal
from jornada.domain.errors import DomainError, ValidationError
from jornada.infrastructure.logs import configurar_logs, get_logger
from jornada.presentation.api import endpoints_auth, endpoints_clasificacion, endpoints_core, endpoints_crud

settings = get_settings()
configurar_logs(settings.app_log_level, json=settings.app_env == "production")
log = get_logger("jornada.api")

_DEFAULT_JWT_SECRET = "dev-secret-cambiar-en-produccion"


async def _buk_auto_sync() -> None:
    """Sincroniza colaboradores desde Buk cada BUK_SYNC_HORAS horas (si está activo).
    Así, cuando entra alguien nuevo a Buk, aparece solo en la herramienta."""
    intervalo = settings.buk_sync_horas * 3600
    while True:
        await asyncio.sleep(intervalo)
        try:
            db = SessionLocal()
            res = await asyncio.to_thread(buk_sync.sincronizar, db)
            db.close()
            log.info("buk_sync_auto", **res)
        except Exception as e:  # noqa: BLE001 (el scheduler no debe tumbar la app)
            log.warning("buk_sync_auto_fallo", error=str(e))


@asynccontextmanager
async def lifespan(_: FastAPI):
    """Al arrancar: valida seguridad, crea tablas, siembra demo y arranca el sync de Buk."""
    if settings.app_env == "production":
        # En prod: exigir un secreto JWT propio y fuerte (si no, se podrían forjar
        # tokens de super_admin con el secreto público del repo).
        if settings.jwt_secret == _DEFAULT_JWT_SECRET or len(settings.jwt_secret) < 32:
            raise RuntimeError(
                "JWT_SECRET inseguro en producción: define uno propio de >=32 caracteres "
                "(la variable se llama JWT_SECRET, sin prefijo APP_)."
            )
        # El "ver como" sin contraseña es un bypass de login: en producción, ni por error.
        if settings.app_demo_login:
            raise RuntimeError(
                "APP_DEMO_LOGIN está encendido en producción: cualquiera entraría sin contraseña."
            )
    if settings.app_demo_login:
        log.warning("demo_login_encendido", detalle="Se entra sin contraseña con X-Demo-User. Solo para local.")
    seed_si_vacio()
    inicializar_herramientas()
    tarea = None
    if settings.buk_configurado() and settings.buk_sync_horas > 0:
        tarea = asyncio.create_task(_buk_auto_sync())
        log.info("buk_sync_programado", cada_horas=settings.buk_sync_horas)
    log.info("backend_listo", env=settings.app_env)
    yield
    if tarea:
        tarea.cancel()


app = FastAPI(
    title="Jornada Laboral — API",
    description="Registro y clasificación de horas laborales (Colombia, Ley 2466/2025).",
    version="0.1.0",
    docs_url=None if settings.app_env == "production" else "/docs",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_STATUS_MAP: dict[type[DomainError], int] = {
    ValidationError: 400,
}


@app.exception_handler(DomainError)
async def _domain_error_handler(_: Request, exc: DomainError) -> JSONResponse:
    """Convierte errores de dominio en respuestas HTTP limpias."""
    status = next((s for t, s in _STATUS_MAP.items() if isinstance(exc, t)), 400)
    return JSONResponse(status_code=status, content={"error": exc.message, "code": exc.code})


@app.get("/health", tags=["sistema"])
def health() -> dict[str, str]:
    """Health check público."""
    return {"status": "ok", "env": settings.app_env, "version": app.version}


app.include_router(endpoints_auth.router)
app.include_router(endpoints_core.router)      # CORE de Atlas: herramientas y permisos
app.include_router(endpoints_clasificacion.router)
app.include_router(endpoints_crud.router)
