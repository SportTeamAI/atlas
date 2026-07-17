"""Calendario de nómina de Colombia (reglas del negocio).

Reglas (definidas con el cliente):
- Días hábiles = lunes a viernes que NO sean festivos.
- Día de pago = 15 y último día del mes; si no es hábil, se paga el día hábil
  inmediatamente anterior.
- Reporte a TH (Talento Humano) = 6 días hábiles antes del día de pago
  (este es el "corte": deadline para que líder/registrador envíen novedades).
- Reporte a Financiera = 2 días hábiles después del reporte a TH.
- El PERÍODO que se contabiliza va desde el día en que se ENVÍA el reporte a
  FINANCIERA del ciclo anterior hasta el día ANTES del envío a financiera de
  este ciclo. Se paga en la primera quincena posterior a ese envío.
  Ej.: 5-jun→22-jun se paga el 30-jun; 23-jun→7-jul se paga el 15-jul.
- Nomenclatura: NM{q}Q{Mes}{YY}  (Nómina, quincena 1|2, mes, año 2 díg).
  NM1 paga el 15; NM2 paga fin de mes. Ej: NM1QJulio26, NM2QEnero26.
"""

from __future__ import annotations

import calendar
from dataclasses import dataclass
from datetime import date, timedelta

from jornada.domain.festivos import es_festivo

MESES_ES = [
    "", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
]


def es_habil(d: date) -> bool:
    """Lunes a viernes que no sea festivo nacional."""
    return d.weekday() < 5 and not es_festivo(d)


def dia_habil_anterior(d: date) -> date:
    """Si d no es hábil, retrocede al día hábil inmediatamente anterior."""
    while not es_habil(d):
        d -= timedelta(days=1)
    return d


def restar_dias_habiles(desde: date, n: int) -> date:
    """La fecha n días hábiles ANTES de `desde` (sin contar `desde`)."""
    d = desde
    restados = 0
    while restados < n:
        d -= timedelta(days=1)
        if es_habil(d):
            restados += 1
    return d


def sumar_dias_habiles(desde: date, n: int) -> date:
    """La fecha n días hábiles DESPUÉS de `desde` (sin contar `desde`)."""
    d = desde
    sumados = 0
    while sumados < n:
        d += timedelta(days=1)
        if es_habil(d):
            sumados += 1
    return d


def dia_pago(anio: int, mes: int, quincena: int) -> date:
    """Día de pago de una quincena: 15 (q1) o 30 (q2).

    Aunque el mes tenga 31 días se paga el 30; si el mes es más corto (febrero),
    el último día. Si el día no es hábil, se paga el día hábil anterior.
    """
    if quincena == 1:
        base = date(anio, mes, 15)
    else:
        ultimo = calendar.monthrange(anio, mes)[1]
        base = date(anio, mes, min(30, ultimo))
    return dia_habil_anterior(base)


@dataclass(frozen=True)
class CicloNomina:
    nombre: str            # NM1QJulio26
    quincena: int          # 1 | 2
    anio: int
    mes: int
    fecha_pago: date
    fecha_reporte_th: date        # corte (deadline líder/registrador)
    fecha_reporte_financiera: date
    fecha_inicio: date            # = envío a financiera del ciclo anterior
    fecha_fin: date               # = día antes del envío a financiera de este ciclo


def _prev_quincena(anio: int, mes: int, quincena: int) -> tuple[int, int, int]:
    if quincena == 2:
        return anio, mes, 1
    if mes == 1:
        return anio - 1, 12, 2
    return anio, mes - 1, 2


def _corte_th(anio: int, mes: int, quincena: int) -> date:
    """Reporte a TH = 6 días hábiles antes del día de pago de esa quincena."""
    return restar_dias_habiles(dia_pago(anio, mes, quincena), 6)


def secuencia_quincena(mes: int, quincena: int) -> int:
    """Número de quincena en el año (1..24). Julio Q1 = 13."""
    return (mes - 1) * 2 + quincena


def construir_ciclo(anio: int, mes: int, quincena: int) -> CicloNomina:
    """Un ciclo que PAGA el 15/30 de (mes, quincena).

    El período liquidado va desde el ENVÍO A FINANCIERA del ciclo ANTERIOR hasta
    el día antes del envío a financiera de ESTE ciclo. Se reporta a TH en `th`,
    se envía a financiera en `fin` y se paga en `pago`.
    Ej. NM1QJulio26: período 23 jun–7 jul, TH 6 jul, financiera 8 jul, pago 15 jul.
    """
    pago = dia_pago(anio, mes, quincena)
    th = restar_dias_habiles(pago, 6)
    fin = sumar_dias_habiles(th, 2)  # envío a financiera de ESTE ciclo
    pa, pm, pq = _prev_quincena(anio, mes, quincena)
    th_prev = _corte_th(pa, pm, pq)
    nombre = f"NM{quincena}Q{MESES_ES[mes]}{anio % 100:02d}"
    # El período contabilizado va desde el DÍA DESPUÉS del reporte a TH del ciclo
    # anterior hasta el reporte a TH de ESTE ciclo (el corte es el último día del
    # período; lo que pase después entra al siguiente). Los ciclos quedan contiguos.
    return CicloNomina(
        nombre=nombre, quincena=quincena, anio=anio, mes=mes,
        fecha_pago=pago, fecha_reporte_th=th, fecha_reporte_financiera=fin,
        fecha_inicio=th_prev + timedelta(days=1), fecha_fin=th,
    )


def generar_ciclos(
    anio_desde: int, mes_desde: int, quincena_desde: int,
    anio_hasta: int, mes_hasta: int, quincena_hasta: int,
) -> list[CicloNomina]:
    """Genera los ciclos (quincenas) entre dos puntos, inclusive."""
    ciclos: list[CicloNomina] = []
    a, m, q = anio_desde, mes_desde, quincena_desde
    while (a, m, q) <= (anio_hasta, mes_hasta, quincena_hasta):
        ciclos.append(construir_ciclo(a, m, q))
        if q == 1:
            q = 2
        else:
            q = 1
            if m == 12:
                a, m = a + 1, 1
            else:
                m += 1
    return ciclos
