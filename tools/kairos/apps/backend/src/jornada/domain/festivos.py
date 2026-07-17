"""Festivos nacionales de Colombia — CALCULADOS para cualquier año.

Usa el algoritmo de Pascua (Butcher/Meeus) + la Ley Emiliani (traslado a lunes)
e incluye la Virgen de Chiquinquirá (Ley 2578/2026). Antes solo existía la lista
de 2026; ahora se genera para el año que se pida (2027, 2028, …). El cálculo
reproduce exactamente la lista verificada de 2026.
"""

from __future__ import annotations

from datetime import date, timedelta
from functools import lru_cache


def _pascua(anio: int) -> date:
    """Domingo de Pascua (algoritmo de Butcher, calendario gregoriano)."""
    a = anio % 19
    b = anio // 100
    c = anio % 100
    d = b // 4
    e = b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i = c // 4
    k = c % 4
    ll = (32 + 2 * e + 2 * i - h - k) % 7
    mm = (a + 11 * h + 22 * ll) // 451
    mes = (h + ll - 7 * mm + 114) // 31
    dia = ((h + ll - 7 * mm + 114) % 31) + 1
    return date(anio, mes, dia)


def _emiliani(d: date) -> date:
    """Traslada al lunes siguiente si no cae en lunes (Ley 51 de 1983)."""
    return d + timedelta(days=(7 - d.weekday()) % 7)


@lru_cache(maxsize=32)
def festivos_colombia(anio: int) -> tuple[tuple[date, str], ...]:
    """Festivos nacionales de Colombia del año (fecha de descanso ya trasladada)."""
    p = _pascua(anio)
    fijos = [
        (date(anio, 1, 1), "Año Nuevo"),
        (date(anio, 5, 1), "Día del Trabajo"),
        (date(anio, 7, 20), "Independencia"),
        (date(anio, 8, 7), "Batalla de Boyacá"),
        (date(anio, 12, 8), "Inmaculada Concepción"),
        (date(anio, 12, 25), "Navidad"),
        (p - timedelta(days=3), "Jueves Santo"),
        (p - timedelta(days=2), "Viernes Santo"),
        (p + timedelta(days=43), "Ascensión"),
        (p + timedelta(days=64), "Corpus Christi"),
        (p + timedelta(days=71), "Sagrado Corazón"),
    ]
    emiliani = [
        (date(anio, 1, 6), "Reyes Magos"),
        (date(anio, 3, 19), "San José"),
        (date(anio, 6, 29), "San Pedro y San Pablo"),
        (date(anio, 7, 9), "Virgen de Chiquinquirá"),  # Ley 2578/2026
        (date(anio, 8, 15), "Asunción de la Virgen"),
        (date(anio, 10, 12), "Día de la Raza"),
        (date(anio, 11, 1), "Todos los Santos"),
        (date(anio, 11, 11), "Independencia de Cartagena"),
    ]
    out = list(fijos) + [(_emiliani(d), n) for d, n in emiliani]
    return tuple(sorted(out, key=lambda x: x[0]))


# Compatibilidad: la lista de 2026 sigue disponible como antes.
FESTIVOS_2026: tuple[tuple[date, str], ...] = festivos_colombia(2026)


def es_festivo(d: date) -> bool:
    """Indica si la fecha es un festivo nacional de Colombia (cualquier año)."""
    return d in {f for f, _ in festivos_colombia(d.year)}
