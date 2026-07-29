# 05 — Módulo de Nómina (Colombia) — PRÓXIMAMENTE

Motor plasmado en backend (`domain/nomina/`), UI bloqueada hasta activarlo.
Datos verificados contra fuentes oficiales (Ley 100/1993, Ley 50/1990,
Dec. 1772/1994, ET art. 114-1). Cifras monetarias 2026 = **configurables por
vigencia** (el SMMLV 2026 está suspendido provisionalmente por el Consejo de
Estado → `estado=PROVISIONAL`).

## Conceptos (resumen)

| Concepto | % / valor | Base | Quién asume | Base legal |
|---|---|---|---|---|
| Salud (empleado) | 4% | IBC | Empleado | Ley 100/1993 |
| Pensión (empleado) | 4% | IBC | Empleado | Ley 100/1993 |
| Fondo Solidaridad Pensional | 1%–2% (>4 SMMLV) | IBC | Empleado | Ley 100 art. 27 |
| Retención en la fuente | tabla art. 383 (desde 95 UVT) | base depurada | Empleado | ET art. 383 |
| Salud patronal | 8,5% | IBC | Empleador | Ley 100 (exonerado <10 SMMLV) |
| Pensión patronal | 12% | IBC | Empleador | Ley 100 |
| ARL | 0,522%–6,96% (clase I–V) | IBC | Empleador | Dec. 1772/1994 |
| SENA | 2% | IBC | Empleador | exonerado <10 SMMLV (ET 114-1) |
| ICBF | 3% | IBC | Empleador | exonerado <10 SMMLV |
| Caja de Compensación | 4% | IBC | Empleador | Ley 21/1982 (nunca exonerado) |
| Cesantías | 8,33% (1/12) | salario + aux. transporte | Empleador | CST 249; Ley 50/1990 |
| Intereses cesantías | 12% anual (1%/mes) | sobre cesantías | Empleador | Ley 52/1975 |
| Prima de servicios | 8,33% (1/12) | salario + aux. transporte | Empleador | CST 306 |
| Vacaciones | 4,17% (1/24) | solo salario | Empleador | CST 186 |

**Exoneración (ET art. 114-1):** por cada trabajador que gane < 10 SMMLV (empleador
persona jurídica contribuyente de renta) se exoneran salud patronal 8,5% + SENA 2% +
ICBF 3%. NO se exoneran pensión, ARL ni CCF. Se evalúa por trabajador.

**Topes:** IBC máx 25 SMMLV; salario integral cotiza sobre el 70% (≥13 SMMLV).
**Auxilio de transporte:** hasta 2 SMMLV; entra en base de cesantías/prima, no en IBC.

## Parámetros 2026 (PROVISIONALES por litigio)
SMMLV $1.750.905 · Auxilio transporte $249.095 · UVT $52.374. Viven en
`ParametrosAnio` (configurables por año).

## Estructura sugerida (futuro)
`parametro_vigencia`, `concepto_nomina`, `empleado` (salario, clase ARL, exonerado),
`periodo_nomina`, `novedad_nomina` (recibe horas extra/recargos ya calculados por el
módulo de clasificación), `liquidacion_empleado`, `liquidacion_detalle`,
`provision_prestacion`.

## Implementado ya (backend)
- `domain/nomina/parametros.py`: %s legales + ARL + FSP + `ParametrosAnio`.
- `domain/nomina/liquidacion.py`: `liquidar(...)` → devengados, deducciones,
  aportes patronales, provisiones, neto y costo total del empleador.
- Tests `tests/unit/test_nomina.py` (validan el ejemplo de 3M).

Pendiente al activar: retención en la fuente (motor de depuración art. 383),
persistencia (tablas), UI y reportes. La UI sigue como **Próximamente** 🔒.
