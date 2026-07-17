"""CORE de Atlas: herramientas y permisos.

Esto es lo ÚNICO que sube de nivel desde Kairos. Aquí se responde a dos preguntas:

- **¿Qué ve esta persona en el hub?** → `GET /core/mis-herramientas`. Solo las que tienen un
  permiso suyo: **si no se asigna, no se ve** (Pronos no le aparece a nadie hasta asignarlo).
- **¿Con qué rol entra a cada herramienta?** → el `rol` del permiso. Por eso el rol vive en
  `Permiso` y no en `Usuario`: alguien puede ser admin en Kairos y no tener nada en Pronos.

Los **empleados y equipos NO se mueven aquí**: siguen siendo de la herramienta, con su lógica
(`lleva_horario`, `reporta`…). Atlas solo los LEE (`GET /core/personas`) para saber a quién
asignarle un permiso. Es la misma tabla, así que no hay usuarios duplicados ni datos que
sincronizar entre dos sitios.
"""

from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from jornada.config.settings import get_settings
from jornada.infrastructure.db import models as m
from jornada.infrastructure.db.database import get_session
from jornada.infrastructure.db.models import ahora_bogota
from jornada.infrastructure.email import enviar_onboarding
from jornada.infrastructure.security.auth import nuevo_token_onboarding
from jornada.presentation.api import schemas_core as s
from jornada.presentation.api.deps import current_user

router = APIRouter(prefix="/core", tags=["core"])


def admin_atlas(user: m.Usuario = Depends(current_user)) -> m.Usuario:
    """Solo el admin de Atlas reparte permisos. Ser admin DENTRO de una herramienta no
    da derecho a repartir accesos de las demás."""
    if not user.es_admin_atlas:
        raise HTTPException(403, "Solo un administrador de Atlas puede gestionar permisos.")
    return user


def rol_en(db: Session, usuario: m.Usuario, slug: str) -> str | None:
    """Rol de esta persona en una herramienta, o None si no tiene acceso."""
    fila = db.execute(
        select(m.Permiso.rol).join(m.Herramienta, m.Herramienta.id == m.Permiso.herramienta_id)
        .where(m.Permiso.usuario_id == usuario.id, m.Herramienta.slug == slug, m.Herramienta.activa),
    ).first()
    return fila[0] if fila else None


@router.get("/mis-herramientas", response_model=list[s.HerramientaOut])
def mis_herramientas(user: m.Usuario = Depends(current_user), db: Session = Depends(get_session)):
    """Lo que esta persona puede abrir desde el hub. Es la lista que pinta Atlas."""
    filas = db.execute(
        select(m.Herramienta, m.Permiso.rol).join(m.Permiso, m.Permiso.herramienta_id == m.Herramienta.id)
        .where(m.Permiso.usuario_id == user.id, m.Herramienta.activa)
        .order_by(m.Herramienta.orden),
    ).all()
    return [
        s.HerramientaOut(id=h.id, slug=h.slug, nombre=h.nombre, descripcion=h.descripcion,
                         ruta=h.ruta, roles=h.roles, activa=h.activa, mi_rol=rol)
        for h, rol in filas
    ]


@router.get("/herramientas", response_model=list[s.HerramientaOut])
def listar_herramientas(_: m.Usuario = Depends(admin_atlas), db: Session = Depends(get_session)):
    """Catálogo completo (solo el admin de Atlas), para la pantalla de permisos."""
    return [
        s.HerramientaOut(id=h.id, slug=h.slug, nombre=h.nombre, descripcion=h.descripcion,
                         ruta=h.ruta, roles=h.roles, activa=h.activa, mi_rol=None)
        for h in db.scalars(select(m.Herramienta).order_by(m.Herramienta.orden))
    ]


@router.get("/personas", response_model=list[s.PersonaOut])
def listar_personas(_: m.Usuario = Depends(admin_atlas), db: Session = Depends(get_session)):
    """Gente a la que se le puede dar acceso: sale de EMPLEADOS (el dato real de Buk), no de
    una lista aparte. Así Atlas y las herramientas ven exactamente a las mismas personas."""
    equipos = {e.id: e for e in db.scalars(select(m.Equipo))}
    usuarios = {u.empleado_id: u for u in db.scalars(select(m.Usuario)) if u.empleado_id}
    out = []
    for emp in db.scalars(select(m.Empleado).where(m.Empleado.activo).order_by(m.Empleado.nombre)):
        eq = equipos.get(emp.equipo_id)
        u = usuarios.get(emp.id)
        out.append(s.PersonaOut(
            empleado_id=emp.id, nombre=emp.nombre, email=emp.email, cargo=emp.cargo,
            equipo_nombre=(eq.nombre if eq else None), empresa=(eq.empresa if eq else None),
            usuario_id=(u.id if u else None), tiene_acceso=bool(u and u.activo),
        ))
    return out


@router.get("/permisos", response_model=list[s.PermisoOut])
def listar_permisos(
    herramienta: str | None = None,
    _: m.Usuario = Depends(admin_atlas), db: Session = Depends(get_session),
):
    """Quién tiene qué. Con ?herramienta=kairos se filtra a una sola."""
    q = select(m.Permiso, m.Usuario, m.Herramienta) \
        .join(m.Usuario, m.Usuario.id == m.Permiso.usuario_id) \
        .join(m.Herramienta, m.Herramienta.id == m.Permiso.herramienta_id)
    if herramienta:
        q = q.where(m.Herramienta.slug == herramienta)
    return [
        s.PermisoOut(id=p.id, usuario_id=u.id, usuario_nombre=u.nombre, usuario_email=u.email,
                     herramienta_slug=h.slug, herramienta_nombre=h.nombre, rol=p.rol,
                     usuario_activo=u.activo, creado_en=p.creado_en)
        for p, u, h in db.execute(q.order_by(m.Usuario.nombre)).all()
    ]


@router.post("/permisos", response_model=s.PermisoOut, status_code=201)
def asignar_permiso(
    payload: s.PermisoIn,
    background_tasks: BackgroundTasks,
    admin: m.Usuario = Depends(admin_atlas), db: Session = Depends(get_session),
):
    """Da acceso a una herramienta con un rol. Si ya tenía, se le cambia el rol."""
    u = db.get(m.Usuario, payload.usuario_id)
    if not u:
        raise HTTPException(404, "Ese acceso no existe. Primero hay que crearle el login.")
    h = db.scalar(select(m.Herramienta).where(m.Herramienta.slug == payload.herramienta))
    if not h:
        raise HTTPException(404, "Herramienta no encontrada.")
    if payload.rol not in (h.roles or []):
        raise HTTPException(400, f"Rol inválido para {h.nombre}. Válidos: {', '.join(h.roles or [])}.")

    p = db.scalar(select(m.Permiso).where(
        m.Permiso.usuario_id == u.id, m.Permiso.herramienta_id == h.id))
    if p:
        p.rol = payload.rol
        p.otorgado_por = admin.id
    else:
        p = m.Permiso(usuario_id=u.id, herramienta_id=h.id, rol=payload.rol, otorgado_por=admin.id)
        db.add(p)
    db.commit()
    db.refresh(p)

    # Si el usuario aún no tiene contraseña, asegurar token y enviar bienvenida por correo.
    if not u.password_hash:
        if not u.onboarding_token:
            u.onboarding_token = nuevo_token_onboarding()
            u.onboarding_expira = ahora_bogota() + timedelta(days=7)
            db.commit()
        link = f"{get_settings().frontend_base_url}/onboarding#{u.onboarding_token}"
        background_tasks.add_task(enviar_onboarding, u.email, u.nombre, link)

    return s.PermisoOut(id=p.id, usuario_id=u.id, usuario_nombre=u.nombre, usuario_email=u.email,
                        herramienta_slug=h.slug, herramienta_nombre=h.nombre, rol=p.rol,
                        usuario_activo=u.activo, creado_en=p.creado_en)


@router.delete("/permisos/{permiso_id}", status_code=204)
def quitar_permiso(
    permiso_id: str,
    admin: m.Usuario = Depends(admin_atlas), db: Session = Depends(get_session),
):
    """Quita el acceso a una herramienta (no borra el login ni los datos de la persona)."""
    p = db.get(m.Permiso, permiso_id)
    if not p:
        raise HTTPException(404, "Permiso no encontrado.")
    if p.usuario_id == admin.id:
        raise HTTPException(400, "No puedes quitarte a ti mismo el acceso.")
    db.delete(p)
    db.commit()


@router.post("/admin-atlas/{usuario_id}", response_model=s.PersonaOut)
def marcar_admin_atlas(
    usuario_id: str, valor: bool,
    admin: m.Usuario = Depends(admin_atlas), db: Session = Depends(get_session),
):
    """Nombra (o quita) a otro administrador de Atlas. No puedes quitarte a ti mismo, y
    siempre tiene que quedar al menos uno: si no, nadie podría volver a dar permisos."""
    u = db.get(m.Usuario, usuario_id)
    if not u:
        raise HTTPException(404, "Usuario no encontrado.")
    if not valor:
        if u.id == admin.id:
            raise HTTPException(400, "No puedes quitarte a ti mismo el rol de administrador.")
        otros = db.scalar(select(m.Usuario).where(
            m.Usuario.es_admin_atlas, m.Usuario.activo, m.Usuario.id != u.id))
        if not otros:
            raise HTTPException(409, "Es el único administrador de Atlas: nombra otro antes de quitarlo.")
    u.es_admin_atlas = valor
    db.commit()
    emp = db.get(m.Empleado, u.empleado_id) if u.empleado_id else None
    eq = db.get(m.Equipo, emp.equipo_id) if emp else None
    return s.PersonaOut(
        empleado_id=(emp.id if emp else ""), nombre=u.nombre, email=u.email,
        cargo=(emp.cargo if emp else None), equipo_nombre=(eq.nombre if eq else None),
        empresa=(eq.empresa if eq else None), usuario_id=u.id, tiene_acceso=u.activo,
        es_admin_atlas=u.es_admin_atlas,
    )
