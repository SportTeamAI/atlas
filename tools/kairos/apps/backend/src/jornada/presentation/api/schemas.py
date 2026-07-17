"""Esquemas Pydantic de entrada/salida de la API de clasificación."""

from __future__ import annotations

from datetime import date

from pydantic import BaseModel, Field

from jornada.domain.enums import JornadaType


class ShiftRequest(BaseModel):
    """Datos de un turno a clasificar."""

    work_date: date = Field(..., description="Fecha del registro (define la vigencia legal).")
    start: str = Field(..., examples=["08:00"], description="Hora de inicio 'HH:MM'.")
    end: str = Field(..., examples=["18:00"], description="Hora de fin 'HH:MM' (puede cruzar medianoche).")
    jornada: JornadaType = Field(JornadaType.ESTANDAR, description="Tipo de jornada del empleado.")
    daily_limit: float = Field(8.0, ge=0, le=24, description="Límite diario pactado (jornada estándar).")
    weekly_limit: float | None = Field(None, ge=0, le=126, description="Máximo semanal; si nulo usa el legal.")
    meal_hours: float = Field(0.0, ge=0, le=12, description="Tiempo de alimentación a descontar (horas).")
    is_holiday: bool = Field(False, description="El día es festivo nacional.")
    is_employee_rest_day: bool = Field(False, description="El día es el descanso del empleado (dominical).")
    weekly_accumulated_before: float = Field(0.0, ge=0, description="Horas netas previas de la semana (flexible).")


class SegmentResponse(BaseModel):
    """Un bloque de horas clasificado."""

    category: str = Field(..., description="Código interno de categoría.")
    label: str = Field(..., description="Etiqueta legible (separa dominical/festivo).")
    hours: float = Field(..., description="Horas en esta categoría.")
    recargo_pct: float = Field(..., description="Recargo en porcentaje (ej. 125.0).")


class ClassificationResponse(BaseModel):
    """Resultado de clasificar un turno."""

    gross_hours: float
    net_hours: float
    rest_type: str | None
    segments: list[SegmentResponse]
