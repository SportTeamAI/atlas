"""Sincronización Buk → Equipo/Empleado. La dispara TH con el botón de Configuración.

REGLA DE ORO: **Buk es la fuente de verdad**. Aquí no se crean ni se editan personas ni
áreas a mano: todo llega de Buk. Lo único que decide la herramienta es **qué áreas están
activas** (las inactivas existen pero no operan).

DOS EMPRESAS EN EL MISMO BUK: VirtualSoft (company_id 1) y Quota Media (2). Repiten
nombres de área —"Audiovisual" existe en las dos y son equipos DISTINTOS—, por eso el
match va SIEMPRE por `buk_area_id`, nunca por nombre. Cuando dos áreas de empresas
distintas se llaman igual, se le agrega la empresa al nombre para poder distinguirlas
(`Equipo.nombre` es único).

El sync:
- ÁREAS: crea las que falten (INACTIVAS, para que TH las active cuando las necesite).
- PERSONAS: crea las que falten (inactivas si su área lo está) y actualiza las que ya
  están: nombre, correo, cargo y **área**.
- EXCEPCIÓN: un empleado con `equipo_manual=True` conserva el área que le puso TH.

Solo se leen los campos necesarios. Los datos sensibles que Buk devuelve (salario, cuenta
bancaria, EPS, pensión, dirección) ni siquiera llegan hasta aquí: los descarta el cliente.
"""

from __future__ import annotations

import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from jornada.infrastructure.buk import cliente
from jornada.infrastructure.db import models as m


def _ced(s: str | None) -> str:
    """Normaliza la cédula: Buk la manda con puntos (1.017.174.262); aquí va sin ellos."""
    return re.sub(r"[^0-9A-Za-z]", "", s or "")


def _corta(nombre_empresa: str | None) -> str | None:
    """'VIRTUALSOFT SERVICIOS & SOFTWARE S.A.S' -> 'VirtualSoft'; 'QUOTA MEDIA S.A.S' -> 'Quota Media'."""
    if not nombre_empresa:
        return None
    n = re.sub(r"\bS\.?A\.?S\.?\b", "", nombre_empresa, flags=re.I).strip(" .&")
    n = re.sub(r"\bSERVICIOS?\b.*", "", n, flags=re.I).strip(" .&")
    return n.title() or nombre_empresa


def _datos(colab: dict) -> dict[str, Any]:
    """Extrae lo que necesitamos del colaborador de Buk."""
    cj = colab.get("current_job") or {}
    rol = cj.get("role") or {}
    return {
        "cedula": _ced(colab.get("document_number") or colab.get("rut")),
        "nombre": (colab.get("full_name") or "").strip() or None,
        "email": (colab.get("email") or "").strip() or None,
        "cargo": (rol.get("name") or "").strip() or None,
        "area_id": cj.get("area_id"),
        "company_id": cj.get("company_id"),
    }


def sincronizar(db: Session) -> dict[str, Any]:
    """Trae empresas, áreas y colaboradores de Buk y los refleja aquí."""
    empresas = {e["id"]: _corta(e["nombre"]) for e in cliente.empresas()}
    areas = cliente.areas()
    colabs = [_datos(c) for c in cliente.colaboradores_activos()]

    # De qué empresa es cada área: se deduce de su gente (Buk no lo expone en /areas).
    empresa_de_area: dict[int, int] = {}
    for d in colabs:
        if d["area_id"] is not None and d["company_id"] is not None:
            empresa_de_area.setdefault(d["area_id"], d["company_id"])

    # Nombres de área repetidos entre empresas → hay que desambiguar con la empresa.
    veces = {}
    for a in areas:
        veces[a["nombre"]] = veces.get(a["nombre"], 0) + 1

    # 1) ÁREAS: match por buk_area_id (NO por nombre).
    por_buk_id = {e.buk_area_id: e for e in db.scalars(select(m.Equipo)) if e.buk_area_id is not None}
    usados = {e.nombre for e in db.scalars(select(m.Equipo))}
    areas_nuevas = 0
    for a in areas:
        emp_nom = empresas.get(empresa_de_area.get(a["id"]))
        eq = por_buk_id.get(a["id"])
        if eq:
            eq.empresa = emp_nom or eq.empresa
            continue
        # Nombre: si se repite entre empresas, se le pone la empresa para distinguirlo.
        nombre = a["nombre"] if veces.get(a["nombre"], 0) == 1 else f"{a['nombre']} · {emp_nom or a['id']}"
        while nombre in usados:                       # choque con algo ya existente
            nombre = f"{nombre} ({a['id']})"
        eq = m.Equipo(nombre=nombre, buk_area_id=a["id"], empresa=emp_nom,
                      descripcion=f"Área de Buk (id {a['id']})", activo=False)
        db.add(eq)
        db.flush()
        por_buk_id[a["id"]] = eq
        usados.add(nombre)
        areas_nuevas += 1
    db.commit()

    # 2) PERSONAS
    nuestros = {_ced(e.cedula): e for e in db.scalars(select(m.Empleado))}
    actualizados, sin_cambios, creados, movidos = 0, 0, 0, 0
    for d in colabs:
        if not d["cedula"]:
            continue
        eq = por_buk_id.get(d["area_id"])
        emp = nuestros.get(d["cedula"])
        if not emp:
            if not eq:
                continue
            db.add(m.Empleado(cedula=d["cedula"], nombre=d["nombre"] or d["cedula"], email=d["email"],
                              cargo=d["cargo"], equipo_id=eq.id, tipo_jornada="estandar",
                              dia_descanso="domingo", activo=eq.activo))
            creados += 1
            continue
        cambio = False
        for campo in ("nombre", "email", "cargo"):
            if d[campo] and getattr(emp, campo) != d[campo]:
                setattr(emp, campo, d[campo])
                cambio = True
        if eq and not emp.equipo_manual and emp.equipo_id != eq.id:
            emp.equipo_id = eq.id
            movidos += 1
            cambio = True
        actualizados += 1 if cambio else 0
        sin_cambios += 0 if cambio else 1
    db.commit()
    return {
        "colaboradores_buk": len(colabs),
        "areas_nuevas": areas_nuevas,
        "creados": creados,
        "actualizados": actualizados,
        "movidos_de_area": movidos,
        "sin_cambios": sin_cambios,
    }
