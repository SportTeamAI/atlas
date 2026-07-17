"""Conversión de horas y segmentación de un turno en franjas diurna/nocturna.

Reglas (Bloque 6.2 y 6.3):
  - Las horas se manejan en decimal: 8.5 == 8h 30min.
  - Diurna 6:00-19:00 (0% recargo), Nocturna 19:00-6:00.
  - Un turno que cruza 19:00 o 6:00 se divide en tramos y cada tramo se
    clasifica individualmente.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import time

from jornada.domain.errors import ValidationError

# Tolerancia para comparaciones de punto flotante en horas.
_EPS = 1e-6


@dataclass(frozen=True)
class Segment:
    """Tramo homogéneo de un turno: duración, si es nocturno y su hora de INICIO en
    decimal desde el arranque del turno (puede pasar de 24 si cruza medianoche; sirve
    para saber a qué DÍA pertenece el tramo)."""

    hours: float
    is_night: bool
    start: float = 0.0


def time_to_decimal(t: time) -> float:
    """Convierte un `time` a horas decimales. Ej: 17:30 -> 17.5."""
    return t.hour + t.minute / 60.0 + t.second / 3600.0


def hhmm_to_decimal(text: str) -> float:
    """Convierte 'HH:MM' a horas decimales. Ej: '08:30' -> 8.5."""
    try:
        h_str, m_str = text.strip().split(":")
        h, m = int(h_str), int(m_str)
    except (ValueError, AttributeError) as exc:  # pragma: no cover - defensivo
        raise ValidationError(f"Hora inválida: {text!r}. Formato esperado 'HH:MM'.") from exc
    if not (0 <= h <= 23 and 0 <= m <= 59):
        raise ValidationError(f"Hora fuera de rango: {text!r}.")
    return h + m / 60.0


def decimal_to_legible(hours: float) -> str:
    """Convierte horas decimales a texto legible. Ej: 9.5 -> '9 horas 30 minutos'."""
    total_min = round(hours * 60)
    h, m = divmod(total_min, 60)
    partes = []
    if h:
        partes.append(f"{h} hora" + ("s" if h != 1 else ""))
    if m:
        partes.append(f"{m} minuto" + ("s" if m != 1 else ""))
    return " ".join(partes) if partes else "0 minutos"


def gross_duration_hours(start: time, end: time) -> float:
    """Duración bruta del turno en horas, contemplando cruce de medianoche."""
    s = time_to_decimal(start)
    e = time_to_decimal(end)
    if e <= s:
        e += 24.0  # el turno termina al día siguiente (turno nocturno)
    return e - s


def _is_night_at(hour_of_day: float, night_start: float, night_end: float) -> bool:
    """Indica si una hora del día (0-24) cae en la franja nocturna."""
    h = hour_of_day % 24.0
    if night_start <= night_end:
        # Ventana contigua (caso atípico, ej. 0:00-6:00).
        return night_start - _EPS <= h < night_end - _EPS
    # Ventana que envuelve la medianoche (caso normal 19:00-6:00).
    return h >= night_start - _EPS or h < night_end - _EPS


def split_into_franjas(
    start: time,
    end: time,
    night_start: float = 19.0,
    night_end: float = 6.0,
) -> list[Segment]:
    """Divide el turno [start, end) en tramos diurnos/nocturnos.

    Los cortes ocurren en `night_end` (6:00) y `night_start` (19:00) de cada día
    contenido en el rango. Cada tramo se etiqueta según su punto medio.
    """
    s = time_to_decimal(start)
    e = time_to_decimal(end)
    if e <= s:
        e += 24.0
    if e - s > 24.0 + _EPS:
        raise ValidationError("Un turno no puede superar 24 horas.")

    # Reunir los puntos de corte dentro del rango abierto (s, e): las franjas
    # (night_end 6:00, night_start 19/21:00) y también la MEDIANOCHE (24, 48…) para
    # que ningún tramo cruce de día (así cada tramo se paga con el festivo/recargo
    # de SU día).
    cuts: set[float] = set()
    k = 0
    while 24.0 * k <= e:
        base = 24.0 * k
        for boundary in (0.0, night_end, night_start):
            p = base + boundary
            if s + _EPS < p < e - _EPS:
                cuts.add(p)
        k += 1

    points = sorted({s, e} | cuts)
    segments: list[Segment] = []
    for a, b in zip(points, points[1:]):
        if b - a <= _EPS:
            continue
        mid = (a + b) / 2.0
        segments.append(Segment(hours=round(b - a, 6), is_night=_is_night_at(mid, night_start, night_end), start=a))
    return segments


def subtract_meal(segments: list[Segment], meal_hours: float) -> list[Segment]:
    """Descuenta el tiempo de alimentación proporcionalmente de cada tramo.

    El descanso de alimentación es no remunerado; se reparte a prorrata entre
    los tramos porque no se conoce el instante exacto del descanso.
    """
    if meal_hours <= _EPS:
        return segments
    total = sum(s.hours for s in segments)
    if total <= _EPS:
        return segments
    if meal_hours >= total:
        raise ValidationError("El tiempo de alimentación no puede ser mayor o igual al turno.")
    factor = (total - meal_hours) / total
    return [Segment(hours=round(s.hours * factor, 6), is_night=s.is_night, start=s.start) for s in segments]


def subtract_meal_diurnas_first(segments: list[Segment], meal_hours: float) -> list[Segment]:
    """Descuenta la alimentación priorizando los tramos diurnos (sin recargo).

    En un día normal el recargo lo llevan los tramos nocturnos; el descanso de
    alimentación se resta primero de los tramos diurnos para que las horas con
    recargo se paguen COMPLETAS (#7). Si el turno no tiene suficientes horas
    diurnas, el remanente se descuenta a prorrata de los nocturnos. El total
    descontado es siempre `meal_hours`, así que las horas netas (para el tope
    de 44/42) no cambian: solo cambia DE DÓNDE sale el descuento.
    """
    if meal_hours <= _EPS:
        return segments
    total = sum(s.hours for s in segments)
    if total <= _EPS:
        return segments
    if meal_hours >= total:
        raise ValidationError("El tiempo de alimentación no puede ser mayor o igual al turno.")
    diurnas = sum(s.hours for s in segments if not s.is_night)
    if diurnas <= _EPS:
        # El turno es todo nocturno (recargo): NO se descuenta el almuerzo, se paga
        # completo. #4
        return segments
    # El almuerzo sale SOLO de las franjas diurnas (hasta donde alcancen); las
    # nocturnas quedan completas (su recargo se paga completo). Si el almuerzo es
    # mayor que las diurnas, solo se quita lo diurno y el resto NO toca lo nocturno.
    quitar = min(meal_hours, diurnas)
    factor = (diurnas - quitar) / diurnas
    return [
        Segment(hours=s.hours if s.is_night else round(s.hours * factor, 6), is_night=s.is_night, start=s.start)
        for s in segments
    ]
