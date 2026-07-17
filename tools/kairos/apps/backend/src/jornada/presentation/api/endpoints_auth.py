"""Endpoints de autenticación local (JWT en cookie HttpOnly).

- `POST /auth/login`: correo + contraseña → set-cookie con el JWT.
- `GET  /auth/onboarding/{token}`: valida un token de onboarding y dice de quién es.
- `POST /auth/definir-contrasena`: con el token, la persona crea su contraseña (un solo
  uso) y queda logueada (set-cookie).
- `POST /auth/logout`: borra la cookie.
- `GET  /auth/estado`: dice si hay sesión real (jwt) o demo, y quién es.

El JWT viaja SIEMPRE en cookie HttpOnly (nunca en localStorage): inaccesible por JS, así
un XSS no puede robar la sesión. Migrable luego al SSO del hub sin tocar el resto.
"""

from __future__ import annotations

import threading
from collections import defaultdict
from datetime import datetime, timedelta

from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Request, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from jornada.config.settings import get_settings
from jornada.infrastructure.db import models as m
from jornada.infrastructure.db.database import get_session
from jornada.infrastructure.db.models import ahora_bogota
from jornada.infrastructure.security.auth import crear_jwt, hash_password, verificar_password
from jornada.presentation.api import schemas_crud as s
from jornada.presentation.api.deps import COOKIE_JWT, dominio_permitido, resolver_identidad

router = APIRouter(tags=["auth"])

# Rate-limit por IP: máx 5 intentos fallidos en 15 minutos.
# ponytail: dict en memoria, se reinicia al redeployar; suficiente para frenar ataques simples.
_rl_lock = threading.Lock()
_rl_fallos: dict[str, list] = defaultdict(list)
_RL_MAX = 5
_RL_VENTANA = timedelta(minutes=15)


def _rl_check(ip: str) -> None:
    ahora = datetime.utcnow()
    with _rl_lock:
        _rl_fallos[ip] = [t for t in _rl_fallos[ip] if ahora - t < _RL_VENTANA]
        if len(_rl_fallos[ip]) >= _RL_MAX:
            raise HTTPException(429, "Demasiados intentos fallidos desde tu red. Espera 15 minutos.")


def _rl_fail(ip: str) -> None:
    with _rl_lock:
        _rl_fallos[ip].append(datetime.utcnow())


def _rl_clear(ip: str) -> None:
    with _rl_lock:
        _rl_fallos.pop(ip, None)


# NO existe ningún endpoint que liste usuarios sin autenticar.
#
# Aquí hubo un `/auth/usuarios-demo` para el selector "ver como" de desarrollo. Se ELIMINÓ:
# un endpoint público que devuelve nombres, correos y roles es un regalo para quien quiera
# atacar (sabe a quién apuntar y quién es admin). Aunque en producción respondiera 404, el
# código seguía ahí y bastaba un despiste de configuración para exponerlo.
#
# A la plataforma se entra SIEMPRE por /auth/login con contraseña, también en local.


def _me(u: m.Usuario) -> s.MeOut:
    return s.MeOut(id=u.id, nombre=u.nombre, email=u.email, rol=u.rol,
                   equipo_id=u.equipo_id, activo=u.activo)


def _set_cookie(response: Response, token: str) -> None:
    """Pone el JWT en una cookie HttpOnly.

    SIEMPRE `SameSite=Lax`, nunca `None`. El front (productodeportivas.com/atlas) y la API
    (api.productodeportivas.com) son **distinto origen pero el MISMO SITIO**: SameSite se
    mide por el dominio registrable (productodeportivas.com), no por el subdominio. Por eso
    la cookie viaja bien con Lax, y de paso **el navegador bloquea el CSRF** de otros sitios.
    Antes decía `None` "porque son dominios distintos": era un error de concepto que abría
    la puerta al CSRF sin necesidad.

    `APP_COOKIE_DOMAIN=.productodeportivas.com` hace que la cookie se comparta con el
    subdominio de la API. Vacío (local) = solo el host actual.
    """
    cfg = get_settings()
    prod = cfg.app_env == "production"
    response.set_cookie(
        key=COOKIE_JWT, value=token, httponly=True,
        secure=prod, samesite="lax",
        domain=cfg.app_cookie_domain or None,
        max_age=cfg.jwt_expira_horas * 3600, path="/",
    )


@router.post("/auth/login", response_model=s.MeOut)
def login(payload: s.LoginIn, request: Request, response: Response, db: Session = Depends(get_session)):
    ip = (request.client.host if request.client else "unknown")
    _rl_check(ip)
    email = payload.email.strip().lower()
    if not dominio_permitido(email):
        _rl_fail(ip)
        raise HTTPException(403, "Solo se puede ingresar con correos @virtualsoft.tech.")
    u = db.scalar(select(m.Usuario).where(func.lower(m.Usuario.email) == email))
    # Mensaje ÚNICO para "no existe / inactivo / sin contraseña / contraseña mala": así no
    # se puede enumerar qué correos existen ni cuáles están pendientes de onboarding.
    _generico = "Correo o contraseña incorrectos, o el acceso aún no está activo (usa tu enlace para crear la contraseña)."
    if not u or not u.activo or not u.password_hash or not verificar_password(payload.password, u.password_hash):
        _rl_fail(ip)
        raise HTTPException(401, _generico)
    _rl_clear(ip)
    u.ultimo_acceso = ahora_bogota()
    db.commit()
    _set_cookie(response, crear_jwt(u.id, u.rol))
    return _me(u)


def _naive(dt: datetime) -> datetime:
    """Quita tz para comparar sin choques naive/aware."""
    return dt.replace(tzinfo=None) if dt.tzinfo else dt


def _token_valido(u: m.Usuario | None, token: str) -> bool:
    if not u or not u.onboarding_token or u.onboarding_token != token:
        return False
    if u.onboarding_expira and _naive(u.onboarding_expira) < _naive(ahora_bogota()):
        return False
    return True


@router.get("/auth/onboarding/{token}", response_model=s.OnboardingInfoOut)
def ver_onboarding(token: str, db: Session = Depends(get_session)):
    """Dice si el token sirve y de quién es (para mostrar 'Hola, X' al crear la clave)."""
    u = db.scalar(select(m.Usuario).where(m.Usuario.onboarding_token == token))
    if not _token_valido(u, token) or not u.activo:
        return s.OnboardingInfoOut(valido=False)
    return s.OnboardingInfoOut(valido=True, email=u.email, nombre=u.nombre, rol=u.rol)


@router.post("/auth/definir-contrasena", response_model=s.MeOut)
def definir_contrasena(payload: s.DefinirPasswordIn, response: Response, db: Session = Depends(get_session)):
    u = db.scalar(select(m.Usuario).where(m.Usuario.onboarding_token == payload.token))
    if not _token_valido(u, payload.token) or not u.activo:
        raise HTTPException(400, "El enlace no es válido o ya expiró. Pídele a TH que lo regenere.")
    if len(payload.password) < 12:
        raise HTTPException(400, "La contraseña debe tener al menos 12 caracteres.")
    if len(payload.password.encode("utf-8")) > 72:
        # bcrypt ignora en silencio lo que pase de 72 bytes: mejor rechazar explícito.
        raise HTTPException(400, "La contraseña es demasiado larga (máximo 72 caracteres).")
    username = u.email.split("@")[0].lower()
    if len(username) > 3 and username in payload.password.lower():
        raise HTTPException(400, "La contraseña no puede contener tu nombre de usuario.")
    u.password_hash = hash_password(payload.password)
    u.onboarding_token = None   # un solo uso
    u.onboarding_expira = None
    u.ultimo_acceso = ahora_bogota()
    db.commit()
    _set_cookie(response, crear_jwt(u.id, u.rol))
    return _me(u)


@router.post("/auth/logout")
def logout(response: Response) -> dict:
    """Cierra la sesión real: borra la cookie del JWT.

    Se borra con el MISMO `domain` con que se puso: si no coincide, el navegador la deja
    viva y la sesión no se cerraría de verdad."""
    response.delete_cookie(key=COOKIE_JWT, path="/", domain=get_settings().app_cookie_domain or None)
    return {"ok": True}


@router.get("/auth/estado")
def estado(
    authorization: str | None = Header(default=None),
    jl_token: str | None = Cookie(default=None),
    x_demo_user: str | None = Header(default=None),
    db: Session = Depends(get_session),
) -> dict:
    """Le dice al frontend si la sesión es real (jwt) o demo, y quién es."""
    u, via = resolver_identidad(authorization, jl_token, x_demo_user, db)
    return {"via": via, "usuario": _me(u).model_dump() if u else None}
