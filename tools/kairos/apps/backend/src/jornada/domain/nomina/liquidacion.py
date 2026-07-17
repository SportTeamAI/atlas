"""Motor de liquidación de nómina (Colombia) — PRÓXIMAMENTE.

Calcula, para un empleado y un período, los devengados, deducciones, aportes
patronales y provisiones de prestaciones. Pensado para recibir las horas extra /
recargos ya cuantificados por el módulo de clasificación (otros_devengados).
"""

from __future__ import annotations

from dataclasses import dataclass, field

from jornada.domain.nomina import parametros as p


@dataclass(frozen=True)
class Linea:
    concepto: str
    tipo: str  # DEVENGADO | DEDUCCION | APORTE | PROVISION
    base: float
    porcentaje: float
    valor: float


@dataclass
class Liquidacion:
    lineas: list[Linea] = field(default_factory=list)
    total_devengado: float = 0.0
    total_deducciones: float = 0.0
    neto: float = 0.0
    total_aportes: float = 0.0
    total_provisiones: float = 0.0
    costo_total_empleador: float = 0.0


def liquidar(
    *,
    salario: float,
    dias: int = 30,
    clase_riesgo: str = "II",
    aux_transporte: bool = False,
    exonerado: bool = True,
    otros_devengados_salariales: float = 0.0,  # horas extra/recargos, comisiones
    params: p.ParametrosAnio = p.PARAMS_2026,
) -> Liquidacion:
    """Liquida un mes (o fracción) de un empleado. Montos redondeados a 2 dec."""
    salario_periodo = round(salario * dias / 30, 2)
    lineas: list[Linea] = [Linea("Salario", "DEVENGADO", 0, 0, salario_periodo)]
    if otros_devengados_salariales:
        lineas.append(Linea("Horas extra / recargos", "DEVENGADO", 0, 0, round(otros_devengados_salariales, 2)))

    aux = 0.0
    if aux_transporte and salario <= 2 * params.smmlv:
        aux = round(params.auxilio_transporte * dias / 30, 2)
        lineas.append(Linea("Auxilio de transporte", "DEVENGADO", 0, 0, aux))

    total_dev = round(sum(x.valor for x in lineas), 2)

    # IBC: base salarial (sin auxilio), con tope de 25 SMMLV.
    ibc = min(salario_periodo + round(otros_devengados_salariales, 2), params.smmlv * p.TOPE_IBC_SMMLV)

    # Deducciones del empleado.
    ded = [
        Linea("Salud", "DEDUCCION", ibc, p.SALUD_EMPLEADO, round(ibc * p.SALUD_EMPLEADO, 2)),
        Linea("Pensión", "DEDUCCION", ibc, p.PENSION_EMPLEADO, round(ibc * p.PENSION_EMPLEADO, 2)),
    ]
    fsp = p.fsp_pct(ibc, params.smmlv)
    if fsp:
        ded.append(Linea("Fondo Solidaridad Pensional", "DEDUCCION", ibc, fsp, round(ibc * fsp, 2)))
    lineas.extend(ded)
    total_ded = round(sum(x.valor for x in ded), 2)
    neto = round(total_dev - total_ded, 2)

    # Aportes del empleador.
    arl = p.ARL_CLASES.get(clase_riesgo, p.ARL_CLASES["II"])
    ap: list[Linea] = []
    if not exonerado:
        ap.append(Linea("Salud patronal", "APORTE", ibc, p.SALUD_EMPLEADOR, round(ibc * p.SALUD_EMPLEADOR, 2)))
    ap.append(Linea("Pensión patronal", "APORTE", ibc, p.PENSION_EMPLEADOR, round(ibc * p.PENSION_EMPLEADOR, 2)))
    ap.append(Linea("ARL", "APORTE", ibc, arl, round(ibc * arl, 2)))
    if not exonerado:
        ap.append(Linea("SENA", "APORTE", ibc, p.SENA, round(ibc * p.SENA, 2)))
        ap.append(Linea("ICBF", "APORTE", ibc, p.ICBF, round(ibc * p.ICBF, 2)))
    ap.append(Linea("Caja de Compensación", "APORTE", ibc, p.CCF, round(ibc * p.CCF, 2)))
    lineas.extend(ap)
    total_ap = round(sum(x.valor for x in ap), 2)

    # Provisiones de prestaciones (cesantías y prima incluyen auxilio; vacaciones no).
    base_prest = salario_periodo + aux
    base_vac = salario_periodo
    ces = round(base_prest * p.CESANTIAS, 2)
    prov = [
        Linea("Cesantías", "PROVISION", base_prest, p.CESANTIAS, ces),
        Linea("Intereses de cesantías", "PROVISION", ces, p.INTERESES_CESANTIAS_MES, round(ces * p.INTERESES_CESANTIAS_MES, 2)),
        Linea("Prima de servicios", "PROVISION", base_prest, p.PRIMA, round(base_prest * p.PRIMA, 2)),
        Linea("Vacaciones", "PROVISION", base_vac, p.VACACIONES, round(base_vac * p.VACACIONES, 2)),
    ]
    lineas.extend(prov)
    total_prov = round(sum(x.valor for x in prov), 2)

    costo = round(total_dev + total_ap + total_prov, 2)
    return Liquidacion(lineas, total_dev, total_ded, neto, total_ap, total_prov, costo)
