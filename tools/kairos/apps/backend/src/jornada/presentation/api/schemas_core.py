"""Esquemas del CORE de Atlas (herramientas y permisos)."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class HerramientaOut(BaseModel):
    id: str
    slug: str
    nombre: str
    descripcion: str | None = None
    ruta: str
    roles: list[str] = []
    activa: bool = True
    # Con qué rol entra QUIEN pregunta. None cuando es el catálogo del admin.
    mi_rol: str | None = None


class PersonaOut(BaseModel):
    """Gente a la que se le puede dar acceso. Sale de EMPLEADOS (dato real de Buk)."""

    empleado_id: str
    nombre: str
    email: str | None = None
    cargo: str | None = None
    equipo_nombre: str | None = None
    empresa: str | None = None
    # usuario_id = None → aún no tiene login; hay que crearlo antes de darle permisos.
    usuario_id: str | None = None
    tiene_acceso: bool = False
    es_admin_atlas: bool = False


class PermisoIn(BaseModel):
    usuario_id: str
    herramienta: str      # slug: kairos | pronos
    rol: str


class PermisoOut(BaseModel):
    id: str
    usuario_id: str
    usuario_nombre: str
    usuario_email: str
    herramienta_slug: str
    herramienta_nombre: str
    rol: str
    usuario_activo: bool
    creado_en: datetime
