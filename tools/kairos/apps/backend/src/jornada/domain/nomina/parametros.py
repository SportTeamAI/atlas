"""Parámetros legales de nómina (Colombia).

Los porcentajes de seguridad social, parafiscales, ARL y prestaciones son
estables (Ley 100/1993, Ley 50/1990, Dec. 1772/1994, ET art. 114-1). Las cifras
monetarias por año son configurables (tabla de vigencias).
"""

from __future__ import annotations

from dataclasses import dataclass

# ── Deducciones del empleado (sobre IBC) ──────────────────────────────────────
SALUD_EMPLEADO = 0.04
PENSION_EMPLEADO = 0.04

# ── Aportes del empleador (sobre IBC) ─────────────────────────────────────────
SALUD_EMPLEADOR = 0.085  # exonerado si salario < 10 SMMLV (ET 114-1)
PENSION_EMPLEADOR = 0.12
# Parafiscales
SENA = 0.02   # exonerado si salario < 10 SMMLV
ICBF = 0.03   # exonerado si salario < 10 SMMLV
CCF = 0.04    # NUNCA exonerado

# ── Prestaciones sociales (provisiones) — fracciones exactas ──────────────────
CESANTIAS = 1 / 12          # ≈ 8.33%
INTERESES_CESANTIAS_MES = 0.01  # 12% anual
PRIMA = 1 / 12              # ≈ 8.33%
VACACIONES = 1 / 24        # ≈ 4.17% (15 días hábiles/año, solo salario)

# ── ARL por clase de riesgo (tarifa inicial, Dec. 1772/1994) ──────────────────
ARL_CLASES = {"I": 0.00522, "II": 0.01044, "III": 0.02436, "IV": 0.0435, "V": 0.0696}

# Exoneración de aportes (salud patronal + SENA + ICBF) bajo este umbral.
EXONERACION_SMMLV = 10
TOPE_IBC_SMMLV = 25  # tope del IBC de seguridad social


def fsp_pct(ibc: float, smmlv: float) -> float:
    """Fondo de Solidaridad Pensional: aporte adicional del empleado por rango."""
    r = ibc / smmlv if smmlv else 0
    if r < 4:
        return 0.0
    if r <= 16:
        return 0.01
    if r <= 17:
        return 0.012
    if r <= 18:
        return 0.014
    if r <= 19:
        return 0.016
    if r <= 20:
        return 0.018
    return 0.02


@dataclass(frozen=True)
class ParametrosAnio:
    """Cifras monetarias por vigencia (configurables)."""

    anio: int
    smmlv: float
    auxilio_transporte: float
    uvt: float
    estado: str = "PROVISIONAL"  # CONFIRMADO | PROVISIONAL


# 2026: SMMLV/auxilio según Dec. 1469/1470 de 2025. El SMMLV está suspendido
# provisionalmente por el Consejo de Estado → tratar como PROVISIONAL.
PARAMS_2026 = ParametrosAnio(anio=2026, smmlv=1_750_905, auxilio_transporte=249_095, uvt=52_374, estado="PROVISIONAL")
