"""Auth local: hashing de contraseñas (bcrypt), emisión/verificación de JWT y
tokens de onboarding (un solo uso).

Es una implementación LOCAL, pensada para migrar luego al SSO del hub/Firebase sin
tocar los endpoints: la verificación del token vive tras `decodificar_jwt`.
"""

from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from jornada.config.settings import get_settings

_ALG = "HS256"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verificar_password(password: str, hash_: str | None) -> bool:
    if not hash_:
        return False
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hash_.encode("utf-8"))
    except Exception:
        return False


def crear_jwt(usuario_id: str, rol: str) -> str:
    """Emite un JWT firmado con la clave local. Incluye sub (usuario), rol y exp."""
    cfg = get_settings()
    ahora = datetime.now(timezone.utc)
    payload = {
        "sub": usuario_id,
        "rol": rol,
        "iat": ahora,
        "exp": ahora + timedelta(hours=cfg.jwt_expira_horas),
    }
    return jwt.encode(payload, cfg.jwt_secret, algorithm=_ALG)


def decodificar_jwt(token: str) -> dict | None:
    """Decodifica y valida un JWT. None si es inválido o expiró."""
    try:
        return jwt.decode(token, get_settings().jwt_secret, algorithms=[_ALG])
    except jwt.PyJWTError:
        return None


def nuevo_token_onboarding() -> str:
    """Token URL-safe de un solo uso para que la persona cree su contraseña."""
    return secrets.token_urlsafe(32)
