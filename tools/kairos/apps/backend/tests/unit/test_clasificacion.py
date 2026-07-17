"""Tests del algoritmo de clasificación legal (núcleo del sistema).

Cubren: las 8 categorías, los recargos que se suman, la segmentación por
franjas, los tipos de jornada, dominical vs festivo y los cambios normativos
por fecha del registro (Bloques 6.2-6.7).
"""

from __future__ import annotations

from datetime import date, time

import pytest

from jornada.domain.algorithms.classifier import (
    ShiftClassification,
    classify,
    classify_shift,
)
from jornada.domain.algorithms.recargos import (
    DEFAULT_VIGENCIAS,
    config_for_date,
    recargo_for_category,
)
from jornada.domain.algorithms.time_segments import (
    decimal_to_legible,
    gross_duration_hours,
    hhmm_to_decimal,
    split_into_franjas,
    subtract_meal,
)
from jornada.domain.enums import Category, JornadaType, RestType


def _hours(result: ShiftClassification, category: Category) -> float:
    """Helper: horas de una categoría (0 si no aparece)."""
    return round(result.hours_by_category().get(category, 0.0), 4)


# --------------------------------------------------------------------------- #
# classify(): la lógica única                                                 #
# --------------------------------------------------------------------------- #
class TestClassify:
    def test_las_8_combinaciones(self) -> None:
        casos = {
            (True, False, False): Category.ORD_DIUR_REG,
            (True, False, True): Category.ORD_DIUR_DESC,
            (True, True, False): Category.ORD_NOCT_REG,
            (True, True, True): Category.ORD_NOCT_DESC,
            (False, False, False): Category.EXT_DIUR_REG,
            (False, False, True): Category.EXT_DIUR_DESC,
            (False, True, False): Category.EXT_NOCT_REG,
            (False, True, True): Category.EXT_NOCT_DESC,
        }
        for (is_ord, is_night, is_rest), esperado in casos.items():
            assert classify(is_ordinary=is_ord, is_night=is_night, is_rest_day=is_rest) == esperado


# --------------------------------------------------------------------------- #
# Recargos: la tabla vigente a 1 jul 2026 y los cambios normativos            #
# --------------------------------------------------------------------------- #
class TestRecargos:
    def test_tabla_vigente_1jul2026(self) -> None:
        cfg = config_for_date(date(2026, 7, 10))
        esperado = {
            Category.ORD_DIUR_REG: 0.00,
            Category.ORD_NOCT_REG: 0.35,
            Category.ORD_DIUR_DESC: 0.90,
            Category.ORD_NOCT_DESC: 1.25,  # 35 + 90
            Category.EXT_DIUR_REG: 0.25,
            Category.EXT_NOCT_REG: 0.75,
            Category.EXT_DIUR_DESC: 1.15,  # 25 + 90
            Category.EXT_NOCT_DESC: 1.65,  # 75 + 90
        }
        for cat, rec in esperado.items():
            assert recargo_for_category(cat, cfg) == pytest.approx(rec)

    def test_jornada_max_cambia_15jul2026(self) -> None:
        assert config_for_date(date(2026, 7, 10)).jornada_max_semanal == 44.0
        assert config_for_date(date(2026, 7, 15)).jornada_max_semanal == 42.0
        assert config_for_date(date(2026, 12, 31)).jornada_max_semanal == 42.0

    def test_descanso_sube_a_100pct_en_2027(self) -> None:
        cfg = config_for_date(date(2027, 8, 1))
        assert recargo_for_category(Category.ORD_DIUR_DESC, cfg) == pytest.approx(1.00)
        assert recargo_for_category(Category.ORD_NOCT_DESC, cfg) == pytest.approx(1.35)  # 35 + 100
        assert recargo_for_category(Category.EXT_NOCT_DESC, cfg) == pytest.approx(1.75)  # 75 + 100

    def test_fecha_anterior_a_vigencia_falla(self) -> None:
        from jornada.domain.errors import ConfigError

        with pytest.raises(ConfigError):
            config_for_date(date(2025, 12, 31))  # anterior a la primera vigencia (2026-01-01)


# --------------------------------------------------------------------------- #
# Conversión de horas y segmentación de franjas                               #
# --------------------------------------------------------------------------- #
class TestTiempo:
    def test_hhmm_a_decimal(self) -> None:
        assert hhmm_to_decimal("08:30") == pytest.approx(8.5)
        assert hhmm_to_decimal("00:00") == pytest.approx(0.0)
        assert hhmm_to_decimal("19:45") == pytest.approx(19.75)

    def test_decimal_a_legible(self) -> None:
        assert decimal_to_legible(9.5) == "9 horas 30 minutos"
        assert decimal_to_legible(1.0) == "1 hora"
        assert decimal_to_legible(0.5) == "30 minutos"

    def test_duracion_bruta_nocturna_cruza_medianoche(self) -> None:
        assert gross_duration_hours(time(22, 0), time(6, 0)) == pytest.approx(8.0)

    def test_turno_diurno_no_se_segmenta(self) -> None:
        segs = split_into_franjas(time(8, 0), time(17, 30))
        assert len(segs) == 1
        assert segs[0].hours == pytest.approx(9.5)
        assert segs[0].is_night is False

    def test_turno_cruza_19h(self) -> None:
        # 14:00-22:00 => 5h diurna (14-19) + 3h nocturna (19-22)
        segs = split_into_franjas(time(14, 0), time(22, 0))
        diurnas = sum(s.hours for s in segs if not s.is_night)
        nocturnas = sum(s.hours for s in segs if s.is_night)
        assert diurnas == pytest.approx(5.0)
        assert nocturnas == pytest.approx(3.0)

    def test_turno_nocturno_completo(self) -> None:
        # 22:00-06:00 => 8h nocturnas
        segs = split_into_franjas(time(22, 0), time(6, 0))
        assert all(s.is_night for s in segs)
        assert sum(s.hours for s in segs) == pytest.approx(8.0)

    def test_turno_madrugada_cruza_6h(self) -> None:
        # 05:00-08:00 => 1h nocturna (5-6) + 2h diurna (6-8)
        segs = split_into_franjas(time(5, 0), time(8, 0))
        nocturnas = sum(s.hours for s in segs if s.is_night)
        diurnas = sum(s.hours for s in segs if not s.is_night)
        assert nocturnas == pytest.approx(1.0)
        assert diurnas == pytest.approx(2.0)

    def test_alimentacion_proporcional(self) -> None:
        segs = [
            split_into_franjas(time(8, 0), time(18, 0))[0],
        ]
        neto = subtract_meal(segs, 1.0)
        assert sum(s.hours for s in neto) == pytest.approx(9.0)  # 10h - 1h


# --------------------------------------------------------------------------- #
# classify_shift(): turnos completos                                          #
# --------------------------------------------------------------------------- #
class TestClassifyShift:
    FECHA = date(2026, 7, 10)  # vigencia: descanso 90%, jornada 44h

    def test_estandar_diurno_con_extra(self) -> None:
        # 08:00-18:00 = 10h presencia, 1h alimentación => 9h de TRABAJO. La extra es el
        # trabajo que pasa de 8h: 9 - 8 = 1h. Un 8-17 (8h de trabajo) NO daría extra.
        r = classify_shift(
            work_date=self.FECHA,
            start=time(8, 0),
            end=time(18, 0),
            jornada=JornadaType.ESTANDAR,
            daily_limit=8.0,
            meal_hours=1.0,
        )
        assert r.net_hours == pytest.approx(9.0)
        assert _hours(r, Category.ORD_DIUR_REG) == pytest.approx(8.0)
        assert _hours(r, Category.EXT_DIUR_REG) == pytest.approx(1.0)
        assert r.rest_type is None

    def test_estandar_cruza_noche_sin_extra(self) -> None:
        # 14:00-22:00 (8h), límite 8h => 5h ORD diurna + 3h ORD nocturna.
        r = classify_shift(
            work_date=self.FECHA,
            start=time(14, 0),
            end=time(22, 0),
            jornada=JornadaType.ESTANDAR,
            daily_limit=8.0,
        )
        assert _hours(r, Category.ORD_DIUR_REG) == pytest.approx(5.0)
        assert _hours(r, Category.ORD_NOCT_REG) == pytest.approx(3.0)
        assert _hours(r, Category.EXT_DIUR_REG) == 0.0

    def test_festivo_aplica_recargo_descanso(self) -> None:
        # Mismo turno en festivo => categorías DESC con recargo dominical/festivo.
        r = classify_shift(
            work_date=self.FECHA,
            start=time(14, 0),
            end=time(22, 0),
            jornada=JornadaType.ESTANDAR,
            daily_limit=8.0,
            is_holiday=True,
        )
        assert r.rest_type == RestType.FESTIVO
        assert _hours(r, Category.ORD_DIUR_DESC) == pytest.approx(5.0)
        assert _hours(r, Category.ORD_NOCT_DESC) == pytest.approx(3.0)
        # Verificar el recargo nocturno-descanso = 125%.
        noct = next(s for s in r.segments if s.category == Category.ORD_NOCT_DESC)
        assert noct.recargo == pytest.approx(1.25)

    def test_dominical_cuando_es_dia_descanso_empleado(self) -> None:
        r = classify_shift(
            work_date=self.FECHA,
            start=time(8, 0),
            end=time(12, 0),
            jornada=JornadaType.ESTANDAR,
            daily_limit=8.0,
            is_employee_rest_day=True,
        )
        assert r.rest_type == RestType.DOMINICAL
        assert _hours(r, Category.ORD_DIUR_DESC) == pytest.approx(4.0)

    def test_festivo_en_dia_descanso_no_duplica(self) -> None:
        # Festivo que cae en el día de descanso => se guarda como festivo, sin duplicar.
        r = classify_shift(
            work_date=self.FECHA,
            start=time(8, 0),
            end=time(12, 0),
            jornada=JornadaType.ESTANDAR,
            daily_limit=8.0,
            is_holiday=True,
            is_employee_rest_day=True,
        )
        assert r.rest_type == RestType.FESTIVO
        desc = next(s for s in r.segments if s.category == Category.ORD_DIUR_DESC)
        assert desc.recargo == pytest.approx(0.90)  # no 1.80

    def test_turno_continuo_sin_recargos(self) -> None:
        # turno_continuo de noche en festivo => todo ORD_DIUR_REG (0%).
        r = classify_shift(
            work_date=self.FECHA,
            start=time(22, 0),
            end=time(4, 0),
            jornada=JornadaType.TURNO_CONTINUO,
            is_holiday=True,
        )
        assert _hours(r, Category.ORD_DIUR_REG) == pytest.approx(6.0)
        assert all(s.recargo == 0.0 for s in r.segments)

    def test_direccion_confianza_siempre_ordinario(self) -> None:
        r = classify_shift(
            work_date=self.FECHA,
            start=time(8, 0),
            end=time(20, 0),
            jornada=JornadaType.DIRECCION_CONFIANZA,
            daily_limit=8.0,
        )
        # 12h sin extras ni recargos.
        assert _hours(r, Category.ORD_DIUR_REG) == pytest.approx(12.0)
        assert len(r.segments) == 1

    def test_flexible_extra_solo_si_supera_semanal(self) -> None:
        # Acumulado 40h, turno 6h, semanal 44h => exceso 46-44 = 2h extra.
        r = classify_shift(
            work_date=self.FECHA,
            start=time(13, 0),
            end=time(19, 0),
            jornada=JornadaType.FLEXIBLE,
            weekly_limit=44.0,
            weekly_accumulated_before=40.0,
        )
        assert _hours(r, Category.EXT_DIUR_REG) == pytest.approx(2.0)
        assert _hours(r, Category.ORD_DIUR_REG) == pytest.approx(4.0)

    def test_flexible_sin_exceso_todo_ordinario(self) -> None:
        r = classify_shift(
            work_date=self.FECHA,
            start=time(13, 0),
            end=time(19, 0),
            jornada=JornadaType.FLEXIBLE,
            weekly_limit=44.0,
            weekly_accumulated_before=10.0,
        )
        assert _hours(r, Category.ORD_DIUR_REG) == pytest.approx(6.0)
        assert _hours(r, Category.EXT_DIUR_REG) == 0.0

    def test_total_horas_iguala_neto(self) -> None:
        r = classify_shift(
            work_date=self.FECHA,
            start=time(16, 0),
            end=time(2, 0),
            jornada=JornadaType.ESTANDAR,
            daily_limit=8.0,
            meal_hours=1.0,
        )
        assert r.total_hours() == pytest.approx(r.net_hours)
