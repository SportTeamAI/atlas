"""Clasificador de horas — núcleo legal del sistema (Bloque 6.7).

`classify` es la lógica única (ordinaria/extra × diurna/nocturna × regular/descanso).
`classify_shift` arma un turno completo: lo segmenta en franjas, descuenta el
tiempo de alimentación, decide ordinarias vs extras según el tipo de jornada y
asigna recargos según la vigencia de la fecha del registro.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, time

from jornada.domain.algorithms.recargos import (
    DEFAULT_VIGENCIAS,
    RecargoConfig,
    config_for_date,
    recargo_for_category,
)
from jornada.domain.algorithms.time_segments import (
    gross_duration_hours,
    split_into_franjas,
    subtract_meal,
    subtract_meal_diurnas_first,
)
from jornada.domain.enums import Category, JornadaType, RestType

# Jornadas que NO generan extras ni recargos nocturnos/de descanso (Bloque 6.6).
_SIN_RECARGOS: frozenset[JornadaType] = frozenset(
    {JornadaType.TURNO_CONTINUO, JornadaType.DIRECCION_CONFIANZA}
)


def classify(*, is_ordinary: bool, is_night: bool, is_rest_day: bool) -> Category:
    """Lógica única de clasificación. Retorna el código interno de categoría."""
    prefix = "ORD" if is_ordinary else "EXT"
    franja = "NOCT" if is_night else "DIUR"
    suffix = "DESC" if is_rest_day else "REG"
    return Category(f"{prefix}_{franja}_{suffix}")


@dataclass(frozen=True)
class ClassifiedSegment:
    """Horas de una categoría con su recargo (fracción)."""

    category: Category
    hours: float
    recargo: float


@dataclass(frozen=True)
class ShiftClassification:
    """Resultado de clasificar un turno completo."""

    gross_hours: float
    net_hours: float
    rest_type: RestType | None
    segments: tuple[ClassifiedSegment, ...] = field(default_factory=tuple)

    def hours_by_category(self) -> dict[Category, float]:
        """Suma de horas por categoría (para reporte/persistencia)."""
        return {s.category: s.hours for s in self.segments}

    def total_hours(self) -> float:
        """Total de horas netas clasificadas (debe igualar net_hours)."""
        return round(sum(s.hours for s in self.segments), 6)


def _extra_hours(
    jornada: JornadaType,
    net: float,
    gross: float,
    daily_limit: float,
    weekly_limit: float,
    weekly_accumulated_before: float,
    daily_accumulated_before: float = 0.0,
    es_extra_marcado: bool = False,
) -> float:
    """Calcula cuántas horas del turno son EXTRA según el tipo de jornada."""
    # Bloque marcado explícitamente como extra (lleva un motivo/justificación): en la
    # jornada día a día es TODO extra, sin importar el orden respecto al turno base.
    if es_extra_marcado and jornada == JornadaType.ESTANDAR:
        return net
    if jornada == JornadaType.ESTANDAR:
        if daily_accumulated_before > 1e-9:
            # Bloque AGREGADO (hora extra / conexión aparte sobre el horario base): es
            # TODO extra. La categoría (diurna/nocturna, festivo/dominical) la pone el
            # propio tramo: p. ej. un agregado 18-20 = 1 h extra diurna (18-19) + 1 h
            # extra nocturna (19-20).
            return net
        # Bloque BASE (el turno establecido del día): extra = el TRABAJO (neto, ya sin
        # almuerzo) que pase de la jornada diaria (8 h de TRABAJO). Un 8-16 (7 h de
        # trabajo) = 0 extra; 8-17 (8 h) = 0 extra; 8-18 (9 h) = 1 h extra.
        return max(0.0, net - daily_limit)
    if jornada == JornadaType.FLEXIBLE:
        # Extra solo si el acumulado semanal supera el máximo legal/pactado.
        exceso = (weekly_accumulated_before + net) - weekly_limit
        return min(net, max(0.0, exceso))
    # turno_continuo y direccion_confianza no generan extras.
    return 0.0


def classify_shift(
    *,
    work_date: date,
    start: time,
    end: time,
    jornada: JornadaType,
    daily_limit: float = 8.0,
    weekly_limit: float | None = None,
    meal_hours: float = 0.0,
    is_holiday: bool = False,
    is_employee_rest_day: bool = False,
    is_holiday_next: bool = False,
    is_employee_rest_day_next: bool = False,
    weekly_accumulated_before: float = 0.0,
    daily_accumulated_before: float = 0.0,
    es_extra_marcado: bool = False,
    vigencias: tuple[RecargoConfig, ...] = DEFAULT_VIGENCIAS,
) -> ShiftClassification:
    """Clasifica un turno completo y devuelve las horas por categoría con recargo.

    Args:
        work_date: fecha del registro (define la vigencia normativa aplicable).
        start, end: hora de inicio y fin (end < start => turno nocturno).
        jornada: tipo de jornada del empleado.
        daily_limit: límite diario pactado (para jornada estándar).
        weekly_limit: máximo semanal del empleado; si None usa el legal vigente.
        meal_hours: tiempo de alimentación a descontar (horas decimales).
        is_holiday: el día es festivo nacional.
        is_employee_rest_day: el día es el día de descanso del empleado (dominical).
        weekly_accumulated_before: horas netas ya trabajadas en la semana (flexible).
    """
    cfg = config_for_date(work_date, vigencias)

    # Día de descanso: el festivo tiene prioridad sobre el dominical y NO se
    # duplica el recargo si el festivo cae en el día de descanso (Bloque 6.7).
    is_rest = is_holiday or is_employee_rest_day

    gross = gross_duration_hours(start, end)
    franjas = split_into_franjas(start, end, cfg.night_start, cfg.night_end)
    # DOS vistas del almuerzo:
    #  - net_hours (GRILLA / horas realmente TRABAJADAS): el almuerzo se descuenta SIEMPRE
    #    (gross − almuerzo), también en domingo/festivo.
    #  - franjas → segments (REPORTE / recargos): en día NORMAL el almuerzo sale de los
    #    tramos DIURNOS ordinarios (los nocturnos completos); en día de RECARGO
    #    (dominical/festivo) NO se rebaja: el recargo se paga COMPLETO.
    net = max(0.0, round(gross - meal_hours, 6))
    if not is_rest:
        franjas = subtract_meal_diurnas_first(franjas, meal_hours)
    rest_type: RestType | None = (RestType.FESTIVO if is_holiday else RestType.DOMINICAL) if is_rest else None

    sin_recargos = jornada in _SIN_RECARGOS

    wk_limit = weekly_limit if weekly_limit is not None else cfg.jornada_max_semanal
    # El TOPE de extras se mide sobre lo realmente trabajado (net).
    extra = _extra_hours(jornada, net, gross, daily_limit, wk_limit, weekly_accumulated_before, daily_accumulated_before, es_extra_marcado)

    # #salto-de-día: los tramos DESPUÉS de medianoche pertenecen al día siguiente, así
    # que su festivo/dominical se decide con el estado del día siguiente. Un turno que
    # arranca festivo y cruza a un día normal paga la parte de después de medianoche
    # como recargo nocturno NORMAL (no festivo).
    is_rest_next = is_holiday_next or is_employee_rest_day_next

    # Las horas extra son las ÚLTIMAS del turno: recorremos los tramos en orden
    # inverso marcando como extra hasta agotar el presupuesto de extras.
    totals: dict[Category, float] = {}
    remaining_extra = extra
    for seg in reversed(franjas):
        if sin_recargos:
            # Sin recargos ni extras: todo cuenta como ordinaria sin recargo.
            totals[Category.ORD_DIUR_REG] = round(
                totals.get(Category.ORD_DIUR_REG, 0.0) + seg.hours, 6
            )
            continue
        seg_rest = is_rest_next if seg.start >= 24.0 - 1e-9 else is_rest
        seg_extra = min(seg.hours, remaining_extra)
        remaining_extra = round(remaining_extra - seg_extra, 6)
        seg_ord = round(seg.hours - seg_extra, 6)
        if seg_extra > 0:
            cat = classify(is_ordinary=False, is_night=seg.is_night, is_rest_day=seg_rest)
            totals[cat] = round(totals.get(cat, 0.0) + seg_extra, 6)
        if seg_ord > 0:
            cat = classify(is_ordinary=True, is_night=seg.is_night, is_rest_day=seg_rest)
            totals[cat] = round(totals.get(cat, 0.0) + seg_ord, 6)

    segments = tuple(
        ClassifiedSegment(category=cat, hours=hrs, recargo=recargo_for_category(cat, cfg))
        for cat, hrs in totals.items()
        if hrs > 0
    )
    return ShiftClassification(
        gross_hours=round(gross, 6),
        net_hours=net,
        rest_type=rest_type,
        segments=segments,
    )
