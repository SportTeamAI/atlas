"""Configuración de recargos por vigencia y cálculo del recargo por categoría.

Los recargos SE SUMAN (Bloque 6.7). Ej. nocturna dominical = 35% + 90% = 125%.
El sistema aplica la norma según la FECHA DEL REGISTRO, no la fecha actual
(Bloque 6.4): cada cambio normativo es una nueva fila de vigencia.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from jornada.domain.enums import Category
from jornada.domain.errors import ConfigError


@dataclass(frozen=True)
class RecargoConfig:
    """Recargos vigentes desde `fecha_desde` (Bloque 7, tabla config_recargos)."""

    fecha_desde: date
    recargo_nocturna: float  # recargo de la franja nocturna (0.35)
    recargo_extra_diurna: float  # 0.25
    recargo_extra_nocturna: float  # 0.75
    recargo_dia_descanso: float  # dominical/festivo (0.90 -> 1.00)
    jornada_max_semanal: float  # 44 -> 42
    night_start: float = 19.0  # inicio de franja nocturna
    night_end: float = 6.0  # fin de franja nocturna


# Vigencias iniciales obligatorias (Bloque 7). Los recargos nocturno/extra son
# constantes en estas fechas; solo cambian el dominical/festivo y la jornada máx.
DEFAULT_VIGENCIAS: tuple[RecargoConfig, ...] = (
    # Ley 2466/2025: dominical/festivo sube gradual — 80% (jul-2025→jun-2026),
    # 90% (desde jul-2026), 100% (desde jul-2027). Jornada: 44h → 42h el 15-jul-2026.
    RecargoConfig(date(2026, 1, 1), 0.350, 0.250, 0.750, 0.800, 44.0),
    RecargoConfig(date(2026, 7, 1), 0.350, 0.250, 0.750, 0.900, 44.0),
    RecargoConfig(date(2026, 7, 15), 0.350, 0.250, 0.750, 0.900, 42.0),
    RecargoConfig(date(2027, 7, 1), 0.350, 0.250, 0.750, 1.000, 42.0),
)


def config_for_date(
    work_date: date,
    vigencias: tuple[RecargoConfig, ...] = DEFAULT_VIGENCIAS,
) -> RecargoConfig:
    """Devuelve la vigencia aplicable: la de mayor `fecha_desde` <= work_date."""
    aplicables = [c for c in vigencias if c.fecha_desde <= work_date]
    if not aplicables:
        raise ConfigError(
            f"No hay configuración de recargos vigente para {work_date.isoformat()} "
            "(fecha anterior a la primera vigencia)."
        )
    return max(aplicables, key=lambda c: c.fecha_desde)


def recargo_for_category(category: Category, cfg: RecargoConfig) -> float:
    """Calcula el recargo (fracción) de una categoría sumando sus componentes."""
    tabla: dict[Category, float] = {
        Category.ORD_DIUR_REG: 0.0,
        Category.ORD_NOCT_REG: cfg.recargo_nocturna,
        Category.ORD_DIUR_DESC: cfg.recargo_dia_descanso,
        Category.ORD_NOCT_DESC: cfg.recargo_nocturna + cfg.recargo_dia_descanso,
        Category.EXT_DIUR_REG: cfg.recargo_extra_diurna,
        Category.EXT_NOCT_REG: cfg.recargo_extra_nocturna,
        Category.EXT_DIUR_DESC: cfg.recargo_extra_diurna + cfg.recargo_dia_descanso,
        Category.EXT_NOCT_DESC: cfg.recargo_extra_nocturna + cfg.recargo_dia_descanso,
    }
    return round(tabla[category], 5)
