"""Endpoint de clasificación de horas (expone el núcleo del dominio)."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from jornada.domain.algorithms.classifier import classify_shift
from jornada.domain.algorithms.time_segments import hhmm_to_decimal  # noqa: F401 (validación futura)
from jornada.domain.festivos import es_festivo
from jornada.domain.labels import category_label
from jornada.infrastructure.db import models as m
from jornada.presentation.api.deps import current_user
from jornada.presentation.api.schemas import (
    ClassificationResponse,
    SegmentResponse,
    ShiftRequest,
)

router = APIRouter(tags=["clasificacion"])


def _parse_time(text: str):
    """Convierte 'HH:MM' a datetime.time (validación vía dominio)."""
    from datetime import time

    h, m = text.strip().split(":")
    return time(int(h), int(m))


@router.post("/clasificar", response_model=ClassificationResponse)
def clasificar(payload: ShiftRequest, _: m.Usuario = Depends(current_user)) -> ClassificationResponse:
    """Clasifica un turno y devuelve las horas por categoría con su recargo.

    Exige sesión: es una calculadora sin datos, pero sin login no se responde NADA. Antes
    cualquiera podía usar el motor de cálculo de la empresa sin identificarse.

    Si no se marca `is_holiday`, el backend lo deduce de la lista de festivos.
    """
    is_holiday = payload.is_holiday or es_festivo(payload.work_date)

    resultado = classify_shift(
        work_date=payload.work_date,
        start=_parse_time(payload.start),
        end=_parse_time(payload.end),
        jornada=payload.jornada,
        daily_limit=payload.daily_limit,
        weekly_limit=payload.weekly_limit,
        meal_hours=payload.meal_hours,
        is_holiday=is_holiday,
        is_employee_rest_day=payload.is_employee_rest_day,
        weekly_accumulated_before=payload.weekly_accumulated_before,
    )

    segments = [
        SegmentResponse(
            category=s.category.value,
            label=category_label(s.category, resultado.rest_type),
            hours=s.hours,
            recargo_pct=round(s.recargo * 100, 3),
        )
        for s in resultado.segments
    ]
    return ClassificationResponse(
        gross_hours=resultado.gross_hours,
        net_hours=resultado.net_hours,
        rest_type=resultado.rest_type.value if resultado.rest_type else None,
        segments=segments,
    )
