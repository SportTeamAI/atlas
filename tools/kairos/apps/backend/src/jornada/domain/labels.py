"""Etiquetas legibles de las categorías (separan dominical vs festivo)."""

from __future__ import annotations

from jornada.domain.enums import Category, RestType

# Etiqueta base por categoría; el sufijo de descanso se ajusta según RestType.
_BASE: dict[Category, str] = {
    Category.ORD_DIUR_REG: "Ordinaria Diurna Regular",
    Category.ORD_NOCT_REG: "Ordinaria Nocturna Regular",
    Category.EXT_DIUR_REG: "Extra Diurna Regular",
    Category.EXT_NOCT_REG: "Extra Nocturna Regular",
    Category.ORD_DIUR_DESC: "Ordinaria Diurna",
    Category.ORD_NOCT_DESC: "Ordinaria Nocturna",
    Category.EXT_DIUR_DESC: "Extra Diurna",
    Category.EXT_NOCT_DESC: "Extra Nocturna",
}

_DESC_CATS: frozenset[Category] = frozenset(
    {
        Category.ORD_DIUR_DESC,
        Category.ORD_NOCT_DESC,
        Category.EXT_DIUR_DESC,
        Category.EXT_NOCT_DESC,
    }
)


def category_label(category: Category, rest_type: RestType | None) -> str:
    """Etiqueta legible. Para categorías de descanso añade Dominical/Festivo."""
    base = _BASE[category]
    if category in _DESC_CATS:
        sufijo = "Festivo" if rest_type == RestType.FESTIVO else "Dominical"
        return f"{base} — {sufijo}"
    return base
