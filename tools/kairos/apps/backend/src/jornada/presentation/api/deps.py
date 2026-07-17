"""Dependencias de la API: usuario actual (demo) y guardias por rol.

MVP: el usuario llega por el header `X-Demo-User` (email) que envía el selector
de rol del frontend. En producción esto se reemplaza por la verificación del
ID token de Firebase (mismo patrón que Nemesis), sin tocar los endpoints.
"""

from __future__ import annotations

from collections.abc import Callable

from fastapi import Cookie, Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from jornada.config.settings import get_settings
from jornada.infrastructure.db import models as m
from jornada.infrastructure.db.database import get_session
from jornada.infrastructure.security.auth import decodificar_jwt

EMAIL_DEMO_DEFAULT = "susana.rojas@virtualsoft.tech"   # TH real (ya no hay usuarios demo inventados)
COOKIE_JWT = "jl_token"   # el JWT viaja en cookie HttpOnly (no en localStorage: inmune a XSS)
# Solo estos correos pueden tener acceso REAL (login por contraseña). Los usuarios
# demo (@demo.co) siguen funcionando por el header X-Demo-User, no por login.
DOMINIO_PERMITIDO = "@virtualsoft.tech"


def dominio_permitido(email: str | None) -> bool:
    return bool(email) and email.strip().lower().endswith(DOMINIO_PERMITIDO)


def resolver_identidad(
    authorization: str | None, jl_token: str | None, x_demo_user: str | None, db: Session,
) -> tuple[m.Usuario | None, str | None]:
    """Devuelve (usuario, via) donde via ∈ {'jwt','demo',None}.

    Prioridad: JWT (cookie HttpOnly o header Bearer) → si viene y es válido, gana. Si viene
    y es INVÁLIDO, no autentica (no cae al demo). Sin token: fallback demo SOLO fuera de prod.
    """
    token = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    elif jl_token:
        token = jl_token
    if token:
        claims = decodificar_jwt(token)
        if claims and claims.get("sub"):
            u = db.get(m.Usuario, claims["sub"])
            if u and u.activo:
                return u, "jwt"
        return None, None   # token presente pero inválido/expirado
    # Fallback demo: FALLA CERRADO. Solo si se encendió a propósito (APP_DEMO_LOGIN=1);
    # y jamás en producción, aunque alguien deje la variable puesta por error.
    cfg = get_settings()
    if cfg.app_demo_login and cfg.app_env != "production":
        email = (x_demo_user or EMAIL_DEMO_DEFAULT).strip().lower()
        u = db.scalar(select(m.Usuario).where(m.Usuario.email == email))
        if u and u.activo:
            return u, "demo"
    return None, None


def current_user(
    authorization: str | None = Header(default=None),
    jl_token: str | None = Cookie(default=None),
    x_demo_user: str | None = Header(default=None),
    db: Session = Depends(get_session),
) -> m.Usuario:
    """Usuario actual: JWT (cookie HttpOnly o Bearer) con prioridad; fallback demo en dev."""
    user, _via = resolver_identidad(authorization, jl_token, x_demo_user, db)
    if user is None:
        raise HTTPException(status_code=401, detail="No autenticado.")
    # Rol en Kairos viene de Permiso (fuente de verdad), no de Usuario.rol.
    kairos_rol = db.scalar(
        select(m.Permiso.rol)
        .join(m.Herramienta, m.Herramienta.id == m.Permiso.herramienta_id)
        .where(m.Permiso.usuario_id == user.id, m.Herramienta.slug == "kairos", m.Herramienta.activa),
    )
    if kairos_rol is not None:
        user.rol = kairos_rol
    return user


def require_rol(*roles: str) -> Callable[..., m.Usuario]:
    """Genera una dependencia que exige uno de los roles indicados."""

    def _dep(user: m.Usuario = Depends(current_user)) -> m.Usuario:
        if user.rol not in roles:
            raise HTTPException(status_code=403, detail="No autorizado para esta acción.")
        return user

    return _dep


def equipos_visibles(user: m.Usuario) -> list[str] | None:
    """Ids de equipos que el usuario puede ver. None = todos (super_admin)."""
    if user.rol == "super_admin":
        return None
    return [user.equipo_id] if user.equipo_id else []
