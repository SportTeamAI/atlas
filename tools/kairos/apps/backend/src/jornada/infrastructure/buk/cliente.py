"""Cliente HTTP de la API de Buk (solo lectura).

Auth: header `auth_token`. Base: https://{tenant}.buk.co/api/v1/{pais}/. Usa urllib de la
stdlib (no agrega dependencias). El token viene de settings (variable de entorno), nunca
se loguea ni se persiste.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from jornada.config.settings import get_settings


class BukError(Exception):
    """Falla al hablar con Buk (config faltante, token inválido, red, etc.)."""


def _base() -> str:
    cfg = get_settings()
    if not cfg.buk_configurado():
        raise BukError("Buk no está configurado: falta BUK_TENANT o BUK_TOKEN en el entorno.")
    return f"https://{cfg.buk_tenant}.buk.co/api/v1/{cfg.buk_pais}"


def _get(path: str, params: dict[str, Any] | None = None) -> Any:
    cfg = get_settings()
    url = f"{_base()}/{path.lstrip('/')}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"auth_token": cfg.buk_token, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:  # noqa: S310 (host fijo de Buk)
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detalle = e.read().decode("utf-8", "ignore")[:300] if e.fp else ""
        raise BukError(f"Buk respondió {e.code}: {detalle or e.reason}") from e
    except urllib.error.URLError as e:
        raise BukError(f"No se pudo conectar con Buk: {e.reason}") from e


def empresas() -> list[dict[str, Any]]:
    """Empresas del tenant. En este Buk conviven VIRTUALSOFT (1) y QUOTA MEDIA (2)."""
    d = _get("companies", {"page_size": 50, "page": 1})
    filas = d.get("data", d if isinstance(d, list) else [])
    return [{"id": c.get("id"), "nombre": c.get("name")} for c in filas]


def areas() -> list[dict[str, Any]]:
    """Todas las áreas de Buk (paginado). Solo id y nombre."""
    out, page = [], 1
    while True:
        d = _get("areas", {"page_size": 100, "page": page})
        f = d.get("data", d if isinstance(d, list) else [])
        if not f:
            break
        out += [{"id": a.get("id"), "nombre": a.get("name")} for a in f]
        if len(f) < 100:
            break
        page += 1
    return out


def _solo_lo_necesario(colab: dict[str, Any]) -> dict[str, Any]:
    """BLINDAJE: deja pasar SOLO los campos que la herramienta necesita y descarta el
    resto AQUÍ, en el borde.

    Buk devuelve mucho más de lo que pedimos —sueldo (como atributo personalizado
    `Salario`, que el permiso "ver sueldos" NO cubre), cuenta bancaria, banco, EPS,
    régimen de pensión, dirección, cumpleaños, correo personal—. Nada de eso entra al
    proceso: no se puede loguear, ni guardar, ni exponer por la API, porque el resto del
    código nunca llega a verlo. Si mañana Buk agrega campos nuevos, tampoco pasan.
    """
    cj = colab.get("current_job") or {}
    return {
        "document_number": colab.get("document_number"),
        "rut": colab.get("rut"),
        "full_name": colab.get("full_name"),
        "email": colab.get("email"),
        "current_job": {
            "area_id": cj.get("area_id"),
            # En el mismo Buk conviven DOS empresas (VirtualSoft y Quota Media): sin esto,
            # áreas con el mismo nombre de empresas distintas se confunden entre sí.
            "company_id": cj.get("company_id"),
            "role": {"name": (cj.get("role") or {}).get("name")},
        },
    }


def colaboradores_activos(page_size: int = 100) -> list[dict[str, Any]]:
    """Colaboradores activos (paginado), YA filtrados a los campos necesarios."""
    out: list[dict[str, Any]] = []
    page = 1
    while True:
        data = _get("employees/active", {"page_size": page_size, "page": page})
        filas = data.get("data", data if isinstance(data, list) else [])
        if not filas:
            break
        out.extend(_solo_lo_necesario(f) for f in filas)
        # Corta si Buk indica que no hay más páginas o si la página vino incompleta.
        pag = data.get("pagination") or {}
        if len(filas) < page_size or (pag.get("total_pages") and page >= pag["total_pages"]):
            break
        page += 1
    return out
