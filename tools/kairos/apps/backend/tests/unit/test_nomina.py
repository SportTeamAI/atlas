"""Tests del motor de liquidación de nómina (Próximamente)."""

from __future__ import annotations

import pytest

from jornada.domain.nomina.liquidacion import liquidar
from jornada.domain.nomina.parametros import fsp_pct


def test_ejemplo_3millones_exonerado():
    """Salario 3M, clase II, mes completo, exonerado (gana < 10 SMMLV)."""
    r = liquidar(salario=3_000_000, dias=30, clase_riesgo="II", exonerado=True)
    assert r.total_devengado == pytest.approx(3_000_000)
    assert r.total_deducciones == pytest.approx(240_000)   # 4% salud + 4% pensión
    assert r.neto == pytest.approx(2_760_000)
    assert r.total_aportes == pytest.approx(511_320)       # pensión 360k + ARL II 31,320 + CCF 120k
    assert r.total_provisiones == pytest.approx(627_500)   # ces 250k + int 2.5k + prima 250k + vac 125k
    assert r.costo_total_empleador == pytest.approx(4_138_820)


def test_sin_exoneracion_suma_salud_sena_icbf():
    base = liquidar(salario=3_000_000, exonerado=True).total_aportes
    full = liquidar(salario=3_000_000, exonerado=False).total_aportes
    # 8.5% + 2% + 3% sobre 3M = 405,000 adicionales
    assert full - base == pytest.approx(405_000)


def test_fsp_por_rango():
    smmlv = 1_750_905
    assert fsp_pct(3 * smmlv, smmlv) == 0.0
    assert fsp_pct(5 * smmlv, smmlv) == 0.01
    assert fsp_pct(21 * smmlv, smmlv) == 0.02
