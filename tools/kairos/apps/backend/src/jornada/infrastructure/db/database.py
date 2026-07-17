"""Motor y sesión de base de datos — PostgreSQL (psycopg3).

Requiere DATABASE_URL en el entorno. Sin ella la app no arranca.
Ejemplo: postgresql+psycopg://user:pass@localhost/atlas
"""

from __future__ import annotations

import os
import uuid
from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL no está definida. "
        "Configúrala en .env o en las variables de entorno del sistema."
    )

engine = create_engine(DATABASE_URL, pool_pre_ping=True, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


class Base(DeclarativeBase):
    """Base declarativa de los modelos."""


def new_id() -> str:
    """Genera un id UUID (string hex de 32 caracteres)."""
    return uuid.uuid4().hex


def get_session() -> Iterator:
    """Dependencia FastAPI: una sesión por request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
