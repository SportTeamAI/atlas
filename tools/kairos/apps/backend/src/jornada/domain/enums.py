"""Enumeraciones del dominio de clasificación de horas (Colombia)."""

from __future__ import annotations

from enum import Enum


class JornadaType(str, Enum):
    """Tipos de jornada (Bloque 6.6 del prompt maestro)."""

    ESTANDAR = "estandar"  # límite diario pactado; genera extras sobre el diario
    FLEXIBLE = "flexible"  # 4-9h; extras solo si supera el semanal
    TURNO_CONTINUO = "turno_continuo"  # máx 6h; sin extras ni recargos noct/descanso
    DIRECCION_CONFIANZA = "direccion_confianza"  # sin límite; siempre ordinarios


class RestType(str, Enum):
    """Tipo de día de descanso, para separar dominical de festivo en el reporte."""

    DOMINICAL = "dominical"
    FESTIVO = "festivo"


class Category(str, Enum):
    """Las 8 categorías de clasificación (Bloque 6.7).

    Estructura del código: <ORD|EXT>_<DIUR|NOCT>_<REG|DESC>
      - ORD/EXT  : ordinaria vs extra
      - DIUR/NOCT: franja diurna vs nocturna
      - REG/DESC : día regular vs día de descanso (dominical/festivo)
    """

    ORD_DIUR_REG = "ORD_DIUR_REG"
    ORD_DIUR_DESC = "ORD_DIUR_DESC"
    ORD_NOCT_REG = "ORD_NOCT_REG"
    ORD_NOCT_DESC = "ORD_NOCT_DESC"
    EXT_DIUR_REG = "EXT_DIUR_REG"
    EXT_DIUR_DESC = "EXT_DIUR_DESC"
    EXT_NOCT_REG = "EXT_NOCT_REG"
    EXT_NOCT_DESC = "EXT_NOCT_DESC"
