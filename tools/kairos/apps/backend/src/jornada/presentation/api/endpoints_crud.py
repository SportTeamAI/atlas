"""Endpoints CRUD del MVP con alcance por rol.

super_admin (RH) ve y administra todo (y puede MODIFICAR la configuración);
registrador/líder solo ven y operan su equipo.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta

import structlog
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from jornada.domain.algorithms.classifier import classify_shift
from jornada.domain.enums import Category, JornadaType
from jornada.domain.festivos import es_festivo, festivos_colombia
from jornada.domain.labels import category_label
from jornada.application import reporte_excel
from jornada.domain.nomina import calendario
from jornada.config.settings import get_settings
from jornada.infrastructure.buk import cliente as buk_cliente
from jornada.infrastructure.buk import sync as buk_sync
from jornada.infrastructure.db import models as m
from jornada.infrastructure.db.database import get_session
from jornada.infrastructure.email import enviar_correo, smtp_configurado
from jornada.infrastructure.security.auth import nuevo_token_onboarding
from jornada.presentation.api import schemas_crud as s
from jornada.presentation.api.deps import current_user, dominio_permitido, equipos_visibles, require_rol

router = APIRouter(tags=["crud"])
log = structlog.get_logger()

# Fecha "hoy" del ambiente de prueba. El demo está construido alrededor del
# 1 jul 2026 (período en curso NM1QJulio26). En producción se usará date.today().
HOY_DEMO = date(2026, 7, 6)   # corte de la 1.ª quincena de julio: NM1QJulio26 queda ABIERTA para pruebas

_DIAS = {
    "lunes": 0, "martes": 1, "miercoles": 2, "miércoles": 2, "jueves": 3,
    "viernes": 4, "sabado": 5, "sábado": 5, "domingo": 6,
}


def _estado_periodo(p: m.Periodo, hoy: date = HOY_DEMO) -> str:
    """Estado REAL del período según el calendario (no depende del valor guardado, que
    puede estar viejo). El cierre manual de TH manda."""
    if p.cerrado_en:
        return "cerrado"
    if hoy < p.fecha_inicio:
        return "programado"          # aún no empieza
    if p.fecha_inicio <= hoy <= p.fecha_fin:
        return "abierto"             # EN CURSO (el único ajustable)
    return "en_revision"             # ya terminó: espera validación/cierre de TH

# Equipos de turnos fijos cuyas horas extra se reportan DÍA A DÍA (no por acumulado
# semanal). Fuente única en schemas_crud (la comparte el motor y la UI vía EquipoOut).
_EQUIPOS_EXTRAS_DIARIAS = s.EQUIPOS_EXTRAS_DIARIAS


def _semanas_de_periodo(per: "m.Periodo") -> tuple[dict[tuple[int, int], int], list[dict]]:
    """Semanas ISO que toca el período, numeradas en orden (#3). Una semana puede
    quedar PARTIDA entre períodos: aquí se cuenta la parte que cae en este período,
    y se marca `parcial` (el resto está en otro período). Incluye el rango de fechas
    y el límite legal de la semana (44 h; 42 h desde el 15-jul-2026, #6)."""
    seen: dict[tuple[int, int], int] = {}
    rangos: dict[int, list[date]] = {}
    d = per.fecha_inicio
    n = 0
    while d <= per.fecha_fin:
        wk = d.isocalendar()[:2]
        if wk not in seen:
            n += 1
            seen[wk] = n
            rangos[n] = [d, d]
        else:
            rangos[seen[wk]][1] = d
        d += timedelta(days=1)
    meta = []
    for i in range(1, n + 1):
        ini_p, fin_p = rangos[i]
        lunes = ini_p - timedelta(days=ini_p.weekday())      # lunes de la semana ISO
        domingo = lunes + timedelta(days=6)                  # domingo de la semana ISO
        parcial = lunes < per.fecha_inicio or domingo > per.fecha_fin
        limite = 42 if lunes >= date(2026, 7, 15) else 44    # jornada legal vigente
        meta.append({
            "n": i, "label": f"Sem {i}",
            "rango": f"{ini_p.isoformat()} → {fin_p.isoformat()}",
            "semana_iso": f"{lunes.isoformat()} → {domingo.isoformat()}",
            "parcial": parcial, "limite": limite,
        })
    return seen, meta


def restar_dias_habiles(desde: date, n: int) -> date:
    """Devuelve la fecha n días hábiles ANTES de `desde` (L-V, sin festivos)."""
    d = desde
    restados = 0
    while restados < n:
        d -= timedelta(days=1)
        if d.weekday() < 5 and not es_festivo(d):  # 0-4 = L-V
            restados += 1
    return d


def _clasificar(emp: m.Empleado, fecha: date, ini: time, fin: time, meal_h: float, rest: bool):
    """Clasifica un turno con la jornada del empleado y devuelve (resumen, json)."""
    r = classify_shift(
        work_date=fecha, start=ini, end=fin, jornada=JornadaType(emp.tipo_jornada),
        daily_limit=emp.jornada_horas_dia or 8.0, weekly_limit=emp.jornada_horas_semana,
        meal_hours=meal_h, is_holiday=es_festivo(fecha), is_employee_rest_day=rest,
    )
    segs = [{"category": x.category.value, "label": category_label(x.category, r.rest_type),
             "hours": x.hours, "recargo_pct": round(x.recargo * 100, 1)} for x in r.segments]
    return r, segs


def _gross_h(ini: time, fin: time) -> float:
    """Duración bruta del turno en horas (si fin<=ini, cruza medianoche)."""
    g = (fin.hour + fin.minute / 60.0) - (ini.hour + ini.minute / 60.0)
    return g + 24.0 if g <= 0 else g


def _partir_medianoche(fecha: date, ini: time, fin: time) -> list[tuple[date, time, time]]:
    """Parte un turno que cruza medianoche en dos: la parte hasta 00:00 queda en su
    día, y la parte después de 00:00 pasa al DÍA SIGUIENTE (así cada tramo cuenta en
    el día que corresponde, aunque el siguiente sea de descanso). Los turnos que no
    cruzan (o terminan justo a las 00:00) quedan igual."""
    if fin <= ini and fin != time(0, 0):
        return [(fecha, ini, time(0, 0)), (fecha + timedelta(days=1), time(0, 0), fin)]
    return [(fecha, ini, fin)]


def _meal_efectivo(meal: float, ini: time, fin: time) -> float:
    """Alimentación a descontar según la duración del turno (#3): el almuerzo SOLO
    se descuenta si el turno es lo bastante largo para que, tras descontarlo, queden
    al menos 8 h (p. ej. 9 h con 1 h de almuerzo = 8 h). Si el turno es de 8 h o
    menos, se registra completo (no se descuenta almuerzo)."""
    if meal <= 0:
        return 0.0
    return meal if _gross_h(ini, fin) >= 8.0 + meal else 0.0


def _reclasificar_periodo_emp(db: Session, emp: m.Empleado, per: m.Periodo) -> None:
    """Recalcula los registros del empleado en el período con la lógica SEMANAL de
    extras (#5): las horas extra SOLO aparecen cuando el acumulado de la SEMANA
    supera el máximo legal vigente (44 h; 42 h desde el 15-jul-2026). Un festivo o
    domingo trabajado sin haber completado la semana NO es extra: cuenta como
    ordinaria con su recargo dominical/festivo. Descuenta además la alimentación
    del área.

    La semana ISO puede CRUZAR el borde del período (p. ej. el período se parte un
    miércoles): la acumulación toma TODOS los registros del empleado en las semanas
    que toca el período —aunque caigan en otro período—, pero solo RE-clasifica los
    de ESTE período; los de otros períodos solo suman su neto ya guardado (#1).
    """
    # Rango que cubre las semanas completas del período: lunes de la 1ª semana →
    # domingo de la última.
    ini_semana = per.fecha_inicio - timedelta(days=per.fecha_inicio.weekday())
    fin_semana = per.fecha_fin + timedelta(days=(6 - per.fecha_fin.weekday()))
    regs = list(db.scalars(select(m.RegistroHorario).where(
        m.RegistroHorario.empleado_id == emp.id,
        m.RegistroHorario.fecha >= ini_semana,
        m.RegistroHorario.fecha <= fin_semana,
    ).order_by(m.RegistroHorario.fecha, m.RegistroHorario.hora_inicio)))
    if not regs:
        return
    # Días cuyo turno TERMINA a medianoche: al día siguiente les cae una "cola"
    # (00:00-…) que es la CONTINUACIÓN de ese turno, no un bloque nuevo del día.
    _MID = time(0, 0)
    dias_fin_mid = {r.fecha for r in regs if r.hora_fin == _MID}
    # Horas de la "cola" que sigue a cada turno que termina a medianoche. Sirven para
    # calcular el almuerzo del turno COMPLETO (base + cola), no solo de la parte antes de
    # las 00:00 — si no, un turno partido de 8 h (p. ej. 18:00-02:00) no descontaba el almuerzo.
    cola_gross_de: dict[date, float] = {}
    for r in regs:
        if r.hora_inicio == _MID and (r.fecha - timedelta(days=1)) in dias_fin_mid:
            k = r.fecha - timedelta(days=1)
            cola_gross_de[k] = cola_gross_de.get(k, 0.0) + _gross_h(r.hora_inicio, r.hora_fin)
    descanso = _DIAS.get((emp.dia_descanso or "").lower(), 6)
    jt_base = JornadaType(emp.tipo_jornada)
    # Turno continuo / dirección-confianza no generan extras ni recargos: se respetan.
    sin_extras = jt_base in (JornadaType.TURNO_CONTINUO, JornadaType.DIRECCION_CONFIANZA)
    eq_area = db.get(m.Equipo, emp.equipo_id) if emp.equipo_id else None
    alm_area_h = (eq_area.almuerzo_min or 0) / 60.0 if eq_area else 0.0
    # Regla de extras: por defecto DÍA A DÍA para TODOS (extra = lo que pase de la
    # jornada diaria). La ÚNICA excepción son las semanas que TIENEN un festivo: en esas
    # semanas, Deportivas y Operaciones Comerciales pasan a acumulado SEMANAL (sumatorio);
    # SAC/Riesgos/Incidentes se quedan día a día siempre.
    equipo_siempre_diario = bool(eq_area and (eq_area.nombre or "").strip().lower() in _EQUIPOS_EXTRAS_DIARIAS)
    lim_dia = emp.jornada_horas_dia or 8.0
    # Semanas ISO (dentro del rango del período) que CONTIENEN algún festivo.
    semanas_festivo: set[tuple[int, int]] = set()
    _d = ini_semana
    while _d <= fin_semana:
        if es_festivo(_d):
            semanas_festivo.add(_d.isocalendar()[:2])
        _d += timedelta(days=1)
    acc: dict[tuple[int, int], float] = {}
    acc_dia: dict[date, float] = {}   # trabajo (neto) acumulado por DÍA (extras diarias)
    meal_dias: set[date] = set()      # días a los que ya se les descontó el almuerzo (1 vez/día)
    # Semana partida al inicio del período (empieza a mitad de semana): NO se asume
    # nada por los días previos. Solo cuentan las horas REALMENTE trabajadas —las de
    # este período y las de la quincena anterior que compartan semana (ver abajo)—.
    # Antes se asumían 8 h por día previo, lo que inflaba extras fantasma cuando la
    # semana anterior no tenía datos (p. ej. un domingo salía con extra sin deberlo).
    for reg in regs:
        wk = reg.fecha.isocalendar()[:2]
        antes = acc.get(wk, 0.0)
        es_fest = es_festivo(reg.fecha)
        # ¿Es la "cola" (00:00-…) de un turno que arrancó el día anterior? Entonces es
        # la CONTINUACIÓN del turno base, no un bloque agregado: no toma el almuerzo del
        # día (lo toma el turno propio) ni marca el turno propio como "agregado" (extra).
        es_cola = reg.hora_inicio == _MID and (reg.fecha - timedelta(days=1)) in dias_fin_mid
        # Día a día para todos, SALVO Deportivas/Operaciones en semanas con festivo, que
        # van por acumulado SEMANAL (sumatorio). SAC/Riesgos/Incidentes: siempre diario.
        semana_diaria = equipo_siempre_diario or (wk not in semanas_festivo)
        dia_diario = (not sin_extras) and semana_diaria
        if reg.periodo_id != per.id:
            # Otra quincena, misma semana: solo suma al acumulado semanal los días de
            # semanas que de verdad usan la regla semanal (las diarias no entran).
            if not (sin_extras or semana_diaria):
                acc[wk] = antes + (reg.duracion_neta_h or 0.0)
            continue
        # Alimentación: el almuerzo se descuenta SIEMPRE (también en domingo/festivo y en
        # turnos nocturnos). El RECARGO (dominical/festivo/nocturno) se paga sobre las
        # horas TRABAJADAS, pero el almuerzo no se paga y NO es extra. En día normal sale
        # de las diurnas (subtract_meal_diurnas_first); en día de recargo, a prorrata
        # (subtract_meal). Un turno de 9 h en domingo/festivo = 8 h netas con recargo, sin extra.
        es_recargo_dia = es_fest or (reg.fecha.weekday() == descanso)
        # Un bloque con MOTIVO es una extra explícita (Apoyo Correo, Chat VIP, etc.).
        es_extra_marcado = bool(reg.motivo)
        # El almuerzo se descuenta UNA sola vez por día, del turno BASE (no de la cola ni
        # de una extra marcada; si no, la extra "reclamaba" el almuerzo y el turno base
        # quedaba sin descontarlo → salía 1 h extra fantasma).
        if reg.fecha in meal_dias or es_cola or es_extra_marcado:
            meal_h = 0.0
        else:
            _g = _gross_h(reg.hora_inicio, reg.hora_fin)
            # Turno partido (termina a medianoche): el almuerzo se calcula sobre el turno
            # COMPLETO (base + cola) y se descuenta de la parte base (entre los 2 días).
            if reg.hora_fin == _MID:
                _g += cola_gross_de.get(reg.fecha, 0.0)
            # Almuerzo según la duración del turno: 7 h o menos → SIN almuerzo (turno
            # corto, p. ej. los de 7 h de SAC = 42 h/sem); ~8 h → el del área (SAC 30 min);
            # 9 h o más (9a6/10a7) → 1 h.
            if _g > 8.0 + 1e-6:
                _alm = max(alm_area_h, 1.0)
            elif _g <= 7.0 + 1e-6:
                _alm = 0.0
            else:
                _alm = alm_area_h
            meal_h = min(_alm, max(0.0, _g - 0.5))
            meal_dias.add(reg.fecha)
        jornada_dia = jt_base if sin_extras else (JornadaType.ESTANDAR if dia_diario else JornadaType.FLEXIBLE)
        dia_antes = acc_dia.get(reg.fecha, 0.0)
        r = classify_shift(
            work_date=reg.fecha, start=reg.hora_inicio, end=reg.hora_fin,
            jornada=jornada_dia, daily_limit=lim_dia, weekly_limit=None,
            meal_hours=meal_h,
            is_holiday=es_fest,
            is_employee_rest_day=(reg.fecha.weekday() == descanso),
            # Salto de día: si el turno cruza medianoche, la parte del día siguiente
            # toma el festivo/descanso de ESE día (p. ej. festivo → normal).
            is_holiday_next=es_festivo(reg.fecha + timedelta(days=1)),
            is_employee_rest_day_next=((reg.fecha + timedelta(days=1)).weekday() == descanso),
            weekly_accumulated_before=antes,
            daily_accumulated_before=dia_antes,
            es_extra_marcado=es_extra_marcado,
        )
        # La cola y las extras marcadas NO suman al acumulado diario: si lo hicieran, el
        # turno base del día se vería como bloque "agregado" y saldría todo extra.
        if not es_cola and not es_extra_marcado:
            acc_dia[reg.fecha] = dia_antes + r.net_hours   # trabajo neto del día (base)
        # Solo los días con regla SEMANAL suman al acumulado (los diarios/festivos no).
        if not dia_diario:
            acc[wk] = antes + r.net_hours
        reg.duracion_bruta_h = r.gross_hours
        reg.duracion_neta_h = r.net_hours
        # Guardar el almuerzo EFECTIVO (el que de verdad se descontó): en un turno de
        # 8 h no se descuenta, así antes quedaba alm=1 pero neto=8 (confuso). #4
        reg.tiempo_alimentacion_h = meal_h
        reg.tipo_descanso = r.rest_type.value if r.rest_type else None
        reg.clasificacion = [
            {"category": x.category.value, "label": category_label(x.category, r.rest_type),
             "hours": x.hours, "recargo_pct": round(x.recargo * 100, 1)} for x in r.segments
        ]


# ── Identidad / usuarios ─────────────────────────────────────────────────────
@router.get("/me", response_model=s.MeOut)
def me(user: m.Usuario = Depends(current_user)) -> m.Usuario:
    return user


@router.get("/usuarios", response_model=list[s.MeOut])
def listar_usuarios(_: m.Usuario = Depends(require_rol("super_admin")), db: Session = Depends(get_session)):
    return list(db.scalars(select(m.Usuario).order_by(m.Usuario.nombre)))


@router.patch("/usuarios/{usuario_id}", response_model=s.MeOut)
def editar_usuario(
    usuario_id: str, payload: s.UsuarioPatch,
    _: m.Usuario = Depends(require_rol("super_admin")), db: Session = Depends(get_session),
):
    """RH designa rol y/o equipo (p. ej. quién registra horarios)."""
    u = db.get(m.Usuario, usuario_id)
    if not u:
        raise HTTPException(404, "Usuario no encontrado.")
    datos = payload.model_dump(exclude_none=True)
    if "rol" in datos and datos["rol"] not in ("super_admin", "lider", "registrador"):
        raise HTTPException(400, "Rol inválido.")
    for k, v in datos.items():
        setattr(u, k, v)
    db.commit()
    db.refresh(u)
    return u


# ── Mi equipo: el líder designa quién registra (#1) ──────────────────────────
@router.get("/mi-equipo/usuarios", response_model=list[s.MeOut])
def usuarios_de_mi_equipo(user: m.Usuario = Depends(require_rol("lider", "super_admin")), db: Session = Depends(get_session)):
    """Usuarios del equipo del líder (para designar registrador). Incluye a los
    INACTIVOS (ex-registradores que volvieron a colaborador) para poder re-elegirlos."""
    if user.rol == "super_admin":
        return list(db.scalars(select(m.Usuario).order_by(m.Usuario.nombre)))
    if not user.equipo_id:
        return []
    return list(db.scalars(select(m.Usuario).where(m.Usuario.equipo_id == user.equipo_id).order_by(m.Usuario.nombre)))


def _crear_o_activar_usuario(
    db: Session, *, nombre: str, email: str, rol: str, equipo_id: str | None, empleado_id: str | None = None,
) -> m.Usuario:
    """Crea o reactiva el LOGIN de alguien con el rol dado. Si aún no tiene contraseña, le
    pone un token de onboarding (un solo uso, 7 días) para que la cree él mismo. El
    llamante debe validar el dominio del correo ANTES.

    El usuario queda RELACIONADO con su empleado (`empleado_id`): el nombre, el área y la
    cédula salen siempre de ahí (dato real de Buk), nunca de texto suelto."""
    correo = email.strip().lower()
    if not empleado_id:   # acceso creado a mano: amarrarlo al empleado que tenga ese correo
        emp = db.scalar(select(m.Empleado).where(func.lower(m.Empleado.email) == correo))
        empleado_id = emp.id if emp else None
    u = db.scalar(select(m.Usuario).where(func.lower(m.Usuario.email) == correo))
    if not u:
        u = m.Usuario(nombre=nombre, email=correo, rol=rol, equipo_id=equipo_id, activo=True, empleado_id=empleado_id)
        db.add(u)
    else:
        u.rol = rol
        u.equipo_id = equipo_id
        u.activo = True
        u.empleado_id = empleado_id or u.empleado_id
    if not u.password_hash and not u.onboarding_token:
        u.onboarding_token = nuevo_token_onboarding()
        u.onboarding_expira = m.ahora_bogota() + timedelta(days=7)
    return u


def _generar_acceso(db: Session, emp: m.Empleado, rol: str) -> m.Usuario | None:
    """Acceso autogestionado a partir de un EMPLEADO. Solo correos del dominio permitido."""
    if not dominio_permitido(emp.email):
        return None
    return _crear_o_activar_usuario(
        db, nombre=emp.nombre, email=emp.email, rol=rol, equipo_id=emp.equipo_id, empleado_id=emp.id,
    )


def _exigir_empleado_visible(db: Session, user: m.Usuario, empleado_id: str) -> m.Empleado:
    """Devuelve el empleado SOLO si es del equipo del usuario (TH ve todos).

    Sin esto, cualquier registrador podía mandar el id de alguien de otra área y
    escribirle horas, extras o borrarle registros: eso va derecho al reporte a Financiera.
    Todo endpoint que reciba un `empleado_id` del cliente tiene que pasar por aquí.
    """
    emp = db.get(m.Empleado, empleado_id)
    if not emp:
        raise HTTPException(404, "Empleado no encontrado.")
    vis = equipos_visibles(user)
    if vis is not None and emp.equipo_id not in vis:
        raise HTTPException(403, "Esa persona no es de tu equipo.")
    return emp


def _acceso_out(db: Session, u: m.Usuario, *, incluir_url: bool = True) -> s.AccesoOut:
    """Fila del panel de accesos. Todo sale del EMPLEADO relacionado (`u.empleado_id`),
    que es el dato real de Buk: nombre y área. `equipo_id`/`equipo_nombre` son SIEMPRE la
    misma área (si no, filtrar por área en el panel mostraría filas de otra).

    Ojo: el `u.equipo_id` del usuario es otra cosa — el equipo que LIDERA/registra, que
    puede no ser el suyo (p. ej. Edwin lidera Productos pero en Buk está en Dirección
    Comercial). Solo se usa como respaldo si el usuario aún no tiene empleado."""
    emp = db.get(m.Empleado, u.empleado_id) if u.empleado_id else None
    eq = db.get(m.Equipo, emp.equipo_id) if emp else (db.get(m.Equipo, u.equipo_id) if u.equipo_id else None)
    pendiente = bool(u.onboarding_token) and not u.password_hash
    # El enlace de onboarding SIRVE PARA PONER LA CONTRASEÑA: quien lo tenga entra como esa
    # persona. Solo se le entrega a Talento Humano, que es quien lo comparte.
    # Hash (#token) en vez de query param: el fragmento no llega al servidor → no queda en logs de nginx.
    url = f"{get_settings().frontend_base_url}/onboarding#{u.onboarding_token}" if (pendiente and incluir_url) else None
    return s.AccesoOut(
        id=u.id, nombre=(emp.nombre if emp else u.nombre), email=u.email, rol=u.rol,
        equipo_id=(eq.id if eq else None),
        equipo_nombre=(eq.nombre if eq else None), activo=u.activo,
        tiene_password=bool(u.password_hash), onboarding_pendiente=pendiente, onboarding_url=url,
        # Coherencia con la nómina: si no existe como empleado o está apagado, el acceso
        # está desalineado y TH debe verlo (no tiene sentido dar permisos a alguien así).
        empleado_activo=(emp.activo if emp else None),
    )


@router.post("/mi-equipo/registrador/{empleado_id}", response_model=s.EmpleadoOut)
def toggle_registrador(
    empleado_id: str, activar: bool = True,
    _: m.Usuario = Depends(require_rol("super_admin")),
    db: Session = Depends(get_session),
):
    """Activa o quita a un integrante como registrador de horarios. Se permiten VARIOS
    registradores por equipo. Fuente de verdad: `Empleado.reporta`.

    SOLO Talento Humano: el líder lo pide con una solicitud de tipo `acceso_registrador`.
    Activar genera el login (rol registrador) + su enlace de onboarding."""
    emp = db.get(m.Empleado, empleado_id)
    if not emp:
        raise HTTPException(404, "Empleado no encontrado.")
    emp.reporta = activar
    # Activar = GENERAR el acceso: crea el login (rol registrador) + token de onboarding
    # si no existía. Un líder ya puede registrar, así que NO se degrada a registrador.
    if emp.email:
        u = db.scalar(select(m.Usuario).where(func.lower(m.Usuario.email) == emp.email.strip().lower()))
        if activar:
            if not (u and u.rol == "lider"):
                _generar_acceso(db, emp, "registrador")
        elif u and u.rol == "registrador":
            u.activo = False
    # Sin notificación por cada cambio (evita spam): TH lo ve en su Configuración.
    db.commit()
    db.refresh(emp)
    return emp


# ── Solicitudes del líder a Talento Humano ───────────────────────────────────
# El líder no cambia por su cuenta ni quién lleva horario ni quién entra a la plataforma:
# lo SOLICITA y TH resuelve. Son dos cosas distintas y se piden por separado.
TIPOS_SOLICITUD = {
    "lleva_horario": "Que lleve horario",
    "acceso_registrador": "Acceso con rol registrador",
}


def _receptores_th(db: Session) -> list[m.Usuario]:
    """A quién de TH le llegan las solicitudes: el LÍDER del área de Talento Humano
    (siempre, sale de `Equipo.lider_id`) más los que TH haya marcado."""
    receptores: dict[str, m.Usuario] = {}
    for u in db.scalars(select(m.Usuario).where(m.Usuario.rol == "super_admin", m.Usuario.activo)):
        if u.recibe_solicitudes or _es_lider_de_th(db, u):
            receptores[u.id] = u
    return list(receptores.values())


def _es_lider_de_th(db: Session, usuario: m.Usuario) -> bool:
    """¿Este usuario lidera su propia área? `Equipo.lider_id` apunta a USUARIOS (no a
    empleados): el área de la persona sale de su empleado, pero el líder se compara
    contra el id de usuario."""
    emp = db.get(m.Empleado, usuario.empleado_id) if usuario.empleado_id else None
    equipo_id = emp.equipo_id if emp else usuario.equipo_id
    if not equipo_id:
        return False
    eq = db.get(m.Equipo, equipo_id)
    return bool(eq and eq.lider_id == usuario.id)


def _solicitud_out(db: Session, sol: m.Solicitud) -> s.SolicitudOut:
    emp = db.get(m.Empleado, sol.empleado_id)
    eq = db.get(m.Equipo, sol.equipo_id) if sol.equipo_id else None
    quien = db.get(m.Usuario, sol.creado_por) if sol.creado_por else None
    resolvio = db.get(m.Usuario, sol.resuelto_por) if sol.resuelto_por else None
    return s.SolicitudOut(
        id=sol.id, empleado_id=sol.empleado_id, empleado_nombre=(emp.nombre if emp else None),
        equipo_nombre=(eq.nombre if eq else None), tipo=sol.tipo,
        tipo_texto=TIPOS_SOLICITUD.get(sol.tipo, sol.tipo), motivo=sol.motivo, estado=sol.estado,
        respuesta=sol.respuesta, solicitado_por=(quien.nombre if quien else None),
        resuelto_por=(resolvio.nombre if resolvio else None),
        creado_en=sol.creado_en, resuelto_en=sol.resuelto_en,
    )


@router.post("/solicitudes", response_model=s.SolicitudOut, status_code=201)
def crear_solicitud(
    payload: s.SolicitudIn,
    user: m.Usuario = Depends(require_rol("lider")), db: Session = Depends(get_session),
):
    """El líder pide a TH que alguien de SU equipo lleve horario o tenga acceso."""
    if payload.tipo not in TIPOS_SOLICITUD:
        raise HTTPException(400, "Tipo de solicitud inválido.")
    emp = db.get(m.Empleado, payload.empleado_id)
    if not emp:
        raise HTTPException(404, "Empleado no encontrado.")
    if emp.equipo_id != user.equipo_id:
        raise HTTPException(403, "Solo puedes solicitar por gente de tu propio equipo.")
    if payload.tipo == "lleva_horario" and emp.lleva_horario:
        raise HTTPException(409, "Esa persona ya lleva horario.")
    if db.scalar(select(m.Solicitud).where(
        m.Solicitud.empleado_id == emp.id, m.Solicitud.tipo == payload.tipo,
        m.Solicitud.estado == "pendiente",
    )):
        raise HTTPException(409, "Ya hay una solicitud pendiente igual para esa persona.")

    sol = m.Solicitud(empleado_id=emp.id, equipo_id=emp.equipo_id, tipo=payload.tipo,
                      motivo=(payload.motivo or "").strip() or None, creado_por=user.id)
    db.add(sol)
    # Le llega a la persona de TH encargada, no a todo el rol.
    for th in _receptores_th(db):
        db.add(m.Notificacion(
            rol_destino="super_admin", usuario_id=th.id, tipo="solicitud",
            titulo=f"{TIPOS_SOLICITUD[payload.tipo]}: {emp.nombre}",
            descripcion=f"{user.nombre} lo solicita." + (f" Motivo: {sol.motivo}" if sol.motivo else ""),
            equipo_id=emp.equipo_id,
        ))
    db.commit()
    db.refresh(sol)
    return _solicitud_out(db, sol)


@router.get("/solicitudes", response_model=list[s.SolicitudOut])
def listar_solicitudes(
    estado: str | None = None,
    user: m.Usuario = Depends(require_rol("super_admin", "lider")), db: Session = Depends(get_session),
):
    """TH ve todas; el líder solo las de su equipo."""
    q = select(m.Solicitud)
    if user.rol == "lider":
        q = q.where(m.Solicitud.equipo_id == user.equipo_id)
    if estado:
        q = q.where(m.Solicitud.estado == estado)
    return [_solicitud_out(db, x) for x in db.scalars(q.order_by(m.Solicitud.creado_en.desc()))]


@router.post("/solicitudes/{solicitud_id}/resolver", response_model=s.SolicitudOut)
def resolver_solicitud(
    solicitud_id: str, aprobar: bool, payload: s.SolicitudResolverIn | None = None,
    user: m.Usuario = Depends(require_rol("super_admin")), db: Session = Depends(get_session),
):
    """TH aprueba o rechaza. Aprobar APLICA el cambio pedido; no hay que hacerlo aparte."""
    sol = db.get(m.Solicitud, solicitud_id)
    if not sol:
        raise HTTPException(404, "Solicitud no encontrada.")
    if sol.estado != "pendiente":
        raise HTTPException(409, "Esa solicitud ya fue resuelta.")
    emp = db.get(m.Empleado, sol.empleado_id)
    if not emp:
        raise HTTPException(404, "El empleado de la solicitud ya no existe.")

    if aprobar:
        if sol.tipo == "lleva_horario":
            emp.lleva_horario = True
            emp.activo = True   # si lleva horario tiene que existir en la plataforma
        elif sol.tipo == "acceso_registrador":
            if not dominio_permitido(emp.email):
                raise HTTPException(409, "Esa persona no tiene un correo del dominio permitido.")
            emp.reporta = True
            _generar_acceso(db, emp, "registrador")
    sol.estado = "aprobada" if aprobar else "rechazada"
    sol.respuesta = ((payload.respuesta or "").strip() or None) if payload else None
    sol.resuelto_por = user.id
    sol.resuelto_en = m.ahora_bogota()
    # Le avisa de vuelta al líder que la pidió.
    if sol.creado_por:
        db.add(m.Notificacion(
            rol_destino="lider", usuario_id=sol.creado_por, tipo="solicitud",
            titulo=f"{TIPOS_SOLICITUD.get(sol.tipo, sol.tipo)} de {emp.nombre}: {sol.estado}",
            descripcion=f"{user.nombre} la {'aprobó' if aprobar else 'rechazó'}." + (f" {sol.respuesta}" if sol.respuesta else ""),
            equipo_id=sol.equipo_id,
        ))
    db.commit()
    db.refresh(sol)
    return _solicitud_out(db, sol)


@router.get("/solicitudes/receptores", response_model=list[s.ReceptorOut])
def listar_receptores(_: m.Usuario = Depends(require_rol("super_admin")), db: Session = Depends(get_session)):
    """Quién de TH recibe las solicitudes. El líder del área de TH sale como `fijo`."""
    out = []
    for u in db.scalars(select(m.Usuario).where(m.Usuario.rol == "super_admin", m.Usuario.activo).order_by(m.Usuario.nombre)):
        fijo = _es_lider_de_th(db, u)
        out.append(s.ReceptorOut(id=u.id, nombre=u.nombre, email=u.email,
                                 recibe=(u.recibe_solicitudes or fijo), fijo=fijo))
    return out


@router.post("/solicitudes/receptores/{usuario_id}", response_model=s.ReceptorOut)
def marcar_receptor(
    usuario_id: str, recibe: bool,
    _: m.Usuario = Depends(require_rol("super_admin")), db: Session = Depends(get_session),
):
    """TH decide quién más de su grupo recibe las solicitudes. Al líder del área de TH no
    se le puede quitar: si no, las solicitudes se quedarían sin destinatario."""
    u = db.get(m.Usuario, usuario_id)
    if not u or u.rol != "super_admin":
        raise HTTPException(404, "Ese usuario no es de Talento Humano.")
    if not recibe and _es_lider_de_th(db, u):
        raise HTTPException(409, "El líder de Talento Humano recibe siempre las solicitudes.")
    u.recibe_solicitudes = recibe
    db.commit()
    fijo = _es_lider_de_th(db, u)
    return s.ReceptorOut(id=u.id, nombre=u.nombre, email=u.email, recibe=(u.recibe_solicitudes or fijo), fijo=fijo)


# ── Accesos (login autogestionado, JWT) ──────────────────────────────────────
@router.get("/accesos", response_model=list[s.AccesoOut])
def listar_accesos(user: m.Usuario = Depends(require_rol("super_admin", "lider")), db: Session = Depends(get_session)):
    """Panel de accesos: quién tiene login, en qué estado (activo / pendiente de crear
    contraseña / con contraseña). TH ve todos; el líder, su equipo (y sin los enlaces)."""
    q = select(m.Usuario)
    if user.rol == "lider":
        q = q.where(m.Usuario.equipo_id == user.equipo_id)
    es_th = user.rol == "super_admin"
    return [_acceso_out(db, u, incluir_url=es_th) for u in db.scalars(q.order_by(m.Usuario.nombre))]


@router.post("/accesos/otorgar/{empleado_id}", response_model=s.AccesoOut)
def otorgar_acceso(
    empleado_id: str, rol: str = "registrador",
    _: m.Usuario = Depends(require_rol("super_admin")), db: Session = Depends(get_session),
):
    """Genera el acceso de un empleado (crea login + enlace de onboarding). SOLO Talento
    Humano da accesos: el líder los pide con una solicitud (POST /solicitudes) y TH aprueba,
    que es lo que termina llamando aquí."""
    emp = db.get(m.Empleado, empleado_id)
    if not emp:
        raise HTTPException(404, "Empleado no encontrado.")
    if not emp.email:
        raise HTTPException(400, "El empleado no tiene correo; agrégalo primero.")
    if not dominio_permitido(emp.email):
        raise HTTPException(400, "Solo se puede dar acceso a correos @virtualsoft.tech.")
    if rol not in ("super_admin", "lider", "registrador"):
        raise HTTPException(400, "Rol inválido.")
    u = _generar_acceso(db, emp, rol)
    if u is None:
        raise HTTPException(400, "No se pudo generar el acceso.")
    if rol == "registrador":
        emp.reporta = True
    db.commit()
    db.refresh(u)
    return _acceso_out(db, u)


@router.post("/accesos/crear", response_model=s.AccesoOut)
def crear_acceso(payload: s.CrearAccesoIn, _: m.Usuario = Depends(require_rol("super_admin")), db: Session = Depends(get_session)):
    """TH crea acceso para alguien que NO está en el listado de empleados (p. ej. otro
    miembro de Talento Humano). Genera login + enlace de onboarding."""
    if not dominio_permitido(payload.email):
        raise HTTPException(400, "Solo se puede dar acceso a correos @virtualsoft.tech.")
    if payload.rol not in ("super_admin", "lider", "registrador"):
        raise HTTPException(400, "Rol inválido.")
    u = _crear_o_activar_usuario(db, nombre=payload.nombre.strip(), email=payload.email, rol=payload.rol, equipo_id=payload.equipo_id)
    db.commit()
    db.refresh(u)
    return _acceso_out(db, u)


@router.post("/accesos/{usuario_id}/revocar", response_model=s.AccesoOut)
def revocar_acceso(usuario_id: str, user: m.Usuario = Depends(require_rol("super_admin")), db: Session = Depends(get_session)):
    """Desactiva el login (deja de poder entrar). No borra a la persona ni sus horas.

    SOLO Talento Humano: cuando el líder podía, bastaba con que un usuario tuviera su mismo
    `equipo_id` para tocarlo — incluido otro líder o un TH."""
    u = db.get(m.Usuario, usuario_id)
    if not u:
        raise HTTPException(404, "Acceso no encontrado.")
    if u.id == user.id:
        raise HTTPException(400, "No puedes revocar tu propio acceso.")
    u.activo = False
    db.commit()
    db.refresh(u)
    return _acceso_out(db, u)


@router.post("/accesos/{usuario_id}/regenerar", response_model=s.AccesoOut)
def regenerar_acceso(usuario_id: str, _: m.Usuario = Depends(require_rol("super_admin")), db: Session = Depends(get_session)):
    """Reactiva y RESTABLECE la contraseña: genera un nuevo enlace de onboarding para que
    la persona vuelva a crear su clave (útil para 'olvidé mi contraseña' o reinvitar).

    SOLO Talento Humano: esto BORRA la contraseña y devuelve el enlace para poner otra, o
    sea que quien lo llama puede quedarse con la cuenta. Un líder no puede hacer esto."""
    u = db.get(m.Usuario, usuario_id)
    if not u:
        raise HTTPException(404, "Acceso no encontrado.")
    u.activo = True
    u.password_hash = None
    u.onboarding_token = nuevo_token_onboarding()
    u.onboarding_expira = m.ahora_bogota() + timedelta(days=7)
    db.commit()
    db.refresh(u)
    return _acceso_out(db, u)


# ── Ajustes de TH (descuentos/pagos sobre lo reportado, sin tocar la grilla) ──
def _ajuste_out(db: Session, a: m.AjusteReporte) -> s.AjusteOut:
    emp = db.get(m.Empleado, a.empleado_id)
    try:
        etiqueta = category_label(Category(a.categoria), None)
    except ValueError:
        etiqueta = a.categoria
    return s.AjusteOut(
        id=a.id, empleado_id=a.empleado_id, empleado_nombre=(emp.nombre if emp else None),
        periodo_id=a.periodo_id, categoria=a.categoria, categoria_label=etiqueta,
        horas=a.horas, motivo=a.motivo, creado_por=a.creado_por, creado_en=a.creado_en,
    )


@router.get("/ajustes", response_model=list[s.AjusteOut])
def listar_ajustes(periodo_id: str | None = None, user: m.Usuario = Depends(current_user), db: Session = Depends(get_session)):
    """Ajustes del período. TH ve todos; líder/registrador solo los de su equipo."""
    q = select(m.AjusteReporte)
    if periodo_id:
        q = q.where(m.AjusteReporte.periodo_id == periodo_id)
    ajustes = list(db.scalars(q.order_by(m.AjusteReporte.creado_en.desc())))
    vis = equipos_visibles(user)
    if vis is not None:
        ids = {e.id for e in db.scalars(select(m.Empleado).where(m.Empleado.equipo_id.in_(vis or ["__none__"])))}
        ajustes = [a for a in ajustes if a.empleado_id in ids]
    return [_ajuste_out(db, a) for a in ajustes]


@router.post("/ajustes", response_model=s.AjusteOut, status_code=201)
def crear_ajuste(payload: s.AjusteIn, user: m.Usuario = Depends(require_rol("super_admin")), db: Session = Depends(get_session)):
    """TH ajusta lo reportado (sin tocar la grilla). Publica una nota automática en el
    chat del área del período (queda la trazabilidad de qué, a quién y por qué)."""
    emp = db.get(m.Empleado, payload.empleado_id)
    if not emp:
        raise HTTPException(404, "Empleado no encontrado.")
    per = db.get(m.Periodo, payload.periodo_id)
    if not per:
        raise HTTPException(404, "Período no encontrado.")
    # Solo se ajusta el período EN CURSO: el pasado ya se pagó y el siguiente aún no se
    # reporta. El historial de ajustes de otros períodos queda visible (solo lectura).
    if _estado_periodo(per) != "abierto":
        raise HTTPException(409, "Solo se puede ajustar el período EN CURSO. Los demás son de solo lectura (historial).")
    # El período tiene que ser EL DEL ÁREA de la persona: si su área tiene fechas propias
    # (SAC, Incidentes) es ese; si no, el global. Ajustar en otro descuadra el reporte.
    if per.equipo_id and per.equipo_id != emp.equipo_id:
        raise HTTPException(409, "Ese período es de otra área. Usa el período que le corresponde a la persona.")
    if not per.equipo_id and db.scalar(select(m.Periodo).where(
        m.Periodo.equipo_id == emp.equipo_id, m.Periodo.nombre == per.nombre,
    )):
        raise HTTPException(409, "El área de la persona tiene fechas propias para este período: ajusta sobre el período del área.")
    if payload.categoria not in {c.value for c in Category}:
        raise HTTPException(400, "Tipo de hora inválido.")
    if abs(payload.horas) < 1e-9:
        raise HTTPException(400, "Las horas del ajuste no pueden ser 0.")
    if not payload.motivo.strip():
        raise HTTPException(400, "El motivo es obligatorio.")
    a = m.AjusteReporte(empleado_id=emp.id, periodo_id=payload.periodo_id, categoria=payload.categoria,
                        horas=payload.horas, motivo=payload.motivo.strip(), creado_por=user.nombre)
    db.add(a)
    etiqueta = category_label(Category(payload.categoria), None)
    verbo = "descuenta" if payload.horas < 0 else "agrega"
    _evento(db, payload.periodo_id, user,
            f"Ajuste de TH: se {verbo} {abs(payload.horas):g} h de «{etiqueta}» a {emp.nombre}. Motivo: {payload.motivo.strip()}",
            tipo="ajuste", equipo_id=emp.equipo_id)
    db.commit()
    db.refresh(a)
    return _ajuste_out(db, a)


@router.delete("/ajustes/{ajuste_id}", status_code=204)
def borrar_ajuste(ajuste_id: str, user: m.Usuario = Depends(require_rol("super_admin")), db: Session = Depends(get_session)):
    a = db.get(m.AjusteReporte, ajuste_id)
    if not a:
        return
    per = db.get(m.Periodo, a.periodo_id)
    if per and _estado_periodo(per) != "abierto":
        raise HTTPException(409, "Solo se pueden anular ajustes del período EN CURSO.")
    emp = db.get(m.Empleado, a.empleado_id)
    _evento(db, a.periodo_id, user,
            f"Ajuste de TH ANULADO ({category_label(Category(a.categoria), None)} {a.horas:+g} h a {emp.nombre if emp else '—'}).",
            tipo="ajuste", equipo_id=(emp.equipo_id if emp else None))
    db.delete(a)
    db.commit()


# ── Equipos / áreas ──────────────────────────────────────────────────────────
@router.get("/equipos", response_model=list[s.EquipoOut])
def listar_equipos(
    inactivos: bool = False, todos: bool = False,
    user: m.Usuario = Depends(current_user), db: Session = Depends(get_session),
):
    """Áreas. Por defecto solo las activas; `inactivos=1` solo las apagadas; `todos=1` las
    dos (para la vista de TH con el toggle). Incluye `n_empleados` para las tarjetas."""
    q = select(m.Equipo)
    if not todos:
        q = q.where(m.Equipo.activo == (not inactivos))
    vis = equipos_visibles(user)
    if vis is not None:
        q = q.where(m.Equipo.id.in_(vis or ["__none__"]))
    equipos = list(db.scalars(q.order_by(m.Equipo.nombre)))
    # Conteo de gente por área (incluye inactivos: si el área está apagada, su gente también).
    # `n_lleva_horario` es cuántos reportan horas: un área con 0 no se le pide reporte
    # (p. ej. Talento Humano, que usa la herramienta pero no marca turnos).
    conteo: dict[str, int] = {}
    con_horario: dict[str, int] = {}
    for e in db.scalars(select(m.Empleado)):
        conteo[e.equipo_id] = conteo.get(e.equipo_id, 0) + 1
        if e.activo and e.lleva_horario:
            con_horario[e.equipo_id] = con_horario.get(e.equipo_id, 0) + 1
    for e in equipos:
        e.n_empleados = conteo.get(e.id, 0)
        e.n_lleva_horario = con_horario.get(e.id, 0)
    return equipos


def _asignar_lider(db: Session, equipo_id: str, lider_id: str | None) -> None:
    """Al designar líder de un equipo, ese usuario pasa a rol 'lider' y a ese equipo."""
    if not lider_id:
        return
    u = db.get(m.Usuario, lider_id)
    if not u:
        raise HTTPException(404, "El líder seleccionado no existe.")
    u.rol = "lider"
    u.equipo_id = equipo_id


@router.post("/equipos", response_model=s.EquipoOut, status_code=201)
def crear_equipo(payload: s.EquipoIn, _: m.Usuario = Depends(require_rol("super_admin")), db: Session = Depends(get_session)):
    if db.scalar(select(m.Equipo).where(m.Equipo.nombre == payload.nombre)):
        raise HTTPException(409, "Ya existe un equipo con ese nombre.")
    eq = m.Equipo(**payload.model_dump())
    db.add(eq)
    db.flush()
    _asignar_lider(db, eq.id, payload.lider_id)
    db.commit()
    db.refresh(eq)
    return eq


@router.post("/empleados/sincronizar-buk")
def sincronizar_buk(_: m.Usuario = Depends(require_rol("super_admin")), db: Session = Depends(get_session)) -> dict:
    """Botón de TH: trae de Buk los datos de los empleados (nombre, correo, cargo) y los
    actualiza. No crea gente ni toca áreas: Buk manda en los DATOS, no en quién usa la
    herramienta. Corre igual solo cada BUK_SYNC_HORAS."""
    if not get_settings().buk_configurado():
        raise HTTPException(400, "Buk no está configurado (falta BUK_TENANT/BUK_TOKEN en el servidor).")
    try:
        return buk_sync.sincronizar(db)
    except buk_cliente.BukError as e:
        # El detalle crudo de Buk se queda en el log del servidor: al navegador va un
        # mensaje fijo (ese cuerpo es de un sistema externo y no se controla qué trae).
        log.warning("buk_sync_manual_fallo", error=str(e))
        raise HTTPException(400, "No se pudo sincronizar con Buk. Revisa el log del servidor.") from e


@router.patch("/equipos/{equipo_id}", response_model=s.EquipoOut)
def editar_equipo(equipo_id: str, payload: s.EquipoPatch, _: m.Usuario = Depends(require_rol("super_admin")), db: Session = Depends(get_session)):
    eq = db.get(m.Equipo, equipo_id)
    if not eq:
        raise HTTPException(404, "Equipo no encontrado.")
    datos = payload.model_dump(exclude_unset=True)
    if "lider_id" in datos:
        _asignar_lider(db, eq.id, datos["lider_id"])
    # ACTIVAR un área activa también a SU GENTE. Las áreas que llegan de Buk se crean
    # inactivas junto con sus colaboradores: al activarlas aquí, entran a la herramienta de
    # una vez, sin activar persona por persona. (Desactivar NO apaga a la gente: eso lo usa
    # el "borrar área" de la config y ahí los empleados se mueven aparte.)
    activando = datos.get("activo") is True and not eq.activo
    for k, v in datos.items():
        setattr(eq, k, v)
    if activando:
        for emp in db.scalars(select(m.Empleado).where(m.Empleado.equipo_id == eq.id)):
            emp.activo = True
    db.commit()
    db.refresh(eq)
    return eq


@router.delete("/equipos/{equipo_id}", status_code=204)
def borrar_equipo(equipo_id: str, _: m.Usuario = Depends(require_rol("super_admin")), db: Session = Depends(get_session)):
    """Borrado DEFINITIVO de un área (desde inactivos, #15). Bloquea si aún tiene empleados."""
    eq = db.get(m.Equipo, equipo_id)
    if not eq:
        return
    n = db.scalar(select(func.count()).select_from(m.Empleado).where(m.Empleado.equipo_id == eq.id)) or 0
    if n:
        raise HTTPException(409, "No se puede borrar: el área todavía tiene empleados. Reasígnalos primero.")
    db.execute(delete(m.Turno).where(m.Turno.equipo_id == eq.id))
    db.delete(eq)
    db.commit()


# ── Empleados ────────────────────────────────────────────────────────────────
@router.get("/empleados", response_model=list[s.EmpleadoOut])
def listar_empleados(
    equipo_id: str | None = None, inactivos: bool = False, todos: bool = False,
    user: m.Usuario = Depends(current_user), db: Session = Depends(get_session),
):
    """Empleados. `todos=1` trae activos e inactivos (para ver la gente de un área apagada)."""
    q = select(m.Empleado)
    if not todos:
        q = q.where(m.Empleado.activo == (not inactivos))
    vis = equipos_visibles(user)
    if vis is not None:
        q = q.where(m.Empleado.equipo_id.in_(vis or ["__none__"]))
    if equipo_id:
        q = q.where(m.Empleado.equipo_id == equipo_id)
    return list(db.scalars(q.order_by(m.Empleado.nombre)))


@router.post("/empleados", response_model=s.EmpleadoOut, status_code=201)
def crear_empleado(payload: s.EmpleadoIn, _: m.Usuario = Depends(require_rol("super_admin")), db: Session = Depends(get_session)):
    if db.scalar(select(m.Empleado).where(m.Empleado.cedula == payload.cedula)):
        raise HTTPException(409, "Ya existe un empleado con esa cédula.")
    emp = m.Empleado(**payload.model_dump())
    db.add(emp)
    db.commit()
    db.refresh(emp)
    return emp


@router.patch("/empleados/{empleado_id}", response_model=s.EmpleadoOut)
def editar_empleado(
    empleado_id: str, payload: s.EmpleadoPatch,
    _: m.Usuario = Depends(require_rol("super_admin")), db: Session = Depends(get_session),
):
    """Edita un empleado (p. ej. pasarlo de equipo)."""
    emp = db.get(m.Empleado, empleado_id)
    if not emp:
        raise HTTPException(404, "Empleado no encontrado.")
    datos = payload.model_dump(exclude_none=True)
    for k, v in datos.items():
        setattr(emp, k, v)
    if datos.get("lleva_horario"):
        emp.activo = True   # engranaje: quien lleva horario tiene que existir en la plataforma para salir en la grilla
    # OJO: antes, al pasar a líder se BORRABAN sus horarios y novedades (el modelo viejo
    # asumía "líder = no lleva horario"). Ya no: quién aparece en grilla/reporte lo decide
    # `lleva_horario`, y hay líderes que sí trabajan turnos. Borrar datos aquí era una
    # pérdida silenciosa.
    db.commit()
    db.refresh(emp)
    return emp


@router.post("/mi-equipo/lleva-horario/{empleado_id}", response_model=s.EmpleadoOut)
def toggle_lleva_horario(
    empleado_id: str, valor: bool = True,
    user: m.Usuario = Depends(require_rol("super_admin")), db: Session = Depends(get_session),
):
    """Quién lleva horario (aparece en grilla/consolidado/reporte) lo activa SOLO Talento
    Humano. El líder no lo cambia: lo pide con una solicitud (POST /solicitudes) y TH
    aprueba. Es distinto del ACCESO a la plataforma, que va con el rol en Accesos."""
    emp = db.get(m.Empleado, empleado_id)
    if not emp:
        raise HTTPException(404, "Empleado no encontrado.")
    emp.lleva_horario = valor
    if valor:
        emp.activo = True   # engranaje: si lleva horario, existe en la plataforma (si no, no saldría en la grilla)
    db.commit()
    db.refresh(emp)
    return emp


@router.delete("/empleados/{empleado_id}", status_code=204)
def borrar_empleado(empleado_id: str, _: m.Usuario = Depends(require_rol("super_admin")), db: Session = Depends(get_session)):
    """Borrado DEFINITIVO (desde inactivos): elimina el empleado y sus registros/novedades (#15)."""
    emp = db.get(m.Empleado, empleado_id)
    if emp:
        db.execute(delete(m.RegistroHorario).where(m.RegistroHorario.empleado_id == emp.id))
        db.execute(delete(m.Novedad).where(m.Novedad.empleado_id == emp.id))
        db.delete(emp)
        db.commit()


# ── Períodos (GLOBALES; estado por equipo en PeriodoEquipo) ───────────────────
def _ensure_pe(db: Session, periodo_id: str, equipo_id: str) -> m.PeriodoEquipo:
    """Devuelve el registro PeriodoEquipo (lo crea si no existe)."""
    pe = db.scalar(select(m.PeriodoEquipo).where(
        m.PeriodoEquipo.periodo_id == periodo_id, m.PeriodoEquipo.equipo_id == equipo_id))
    if not pe:
        pe = m.PeriodoEquipo(periodo_id=periodo_id, equipo_id=equipo_id)
        db.add(pe)
        db.flush()
    return pe


# Estados del flujo bloqueados a edición (ya validado por el líder en adelante).
_BLOQUEADO = {"validado", "en_th", "aprobado"}


def _evento(db: Session, periodo_id: str, user: m.Usuario, texto: str, tipo: str = "evento", equipo_id: str | None = None) -> None:
    """Registra un evento en la línea de tiempo del área (mismo hilo que el chat)."""
    db.add(m.Comentario(periodo_id=periodo_id, equipo_id=equipo_id or user.equipo_id,
                        autor_nombre=user.nombre, autor_rol=user.rol, texto=texto, tipo=tipo))


def _guardar_cambio(db: Session, periodo_id: str, user: m.Usuario) -> None:
    """Al editar horarios: bloquea si ya está validado; si estaba pendiente de
    validación, reinicia el flujo y avisa al líder que hubo cambios (#1)."""
    if not user.equipo_id:
        return
    pe = _ensure_pe(db, periodo_id, user.equipo_id)
    if pe.estado_flujo in _BLOQUEADO:
        raise HTTPException(409, "El líder ya validó este período; no se puede cambiar. Para corregir, el líder o TH debe devolverlo.")
    if pe.estado_flujo == "pend_validacion":
        pe.estado_flujo = "registro"
        pe.validado_lider = False
        _evento(db, periodo_id, user, f"{user.nombre} hizo cambios tras enviar a validación; debe reenviarse al líder.")
        db.add(m.Notificacion(rol_destino="lider", equipo_id=user.equipo_id, tipo="LIMITE_HORAS",
                              titulo="Hubo cambios antes de validar",
                              descripcion=f"{user.nombre} modificó horarios; espera el reenvío para validar."))


def _reevaluar_flujo_area(db: Session, per: m.Periodo, equipo_id: str | None, user: m.Usuario) -> None:
    """#3 Si tras borrar horarios el área se queda SIN datos (ningún horario ni
    novedad del período), el flujo vuelve a 'registro': hay que registrar, validar,
    enviar y aprobar de nuevo. Evita que un área borrada siga mostrándose como
    validada/en TH/aprobada (mostraba estados que ya no eran ciertos)."""
    if not equipo_id or not per:
        return
    pe = db.scalar(select(m.PeriodoEquipo).where(
        m.PeriodoEquipo.periodo_id == per.id, m.PeriodoEquipo.equipo_id == equipo_id))
    if not pe or pe.estado_flujo == "registro":
        return
    emp_ids = list(db.scalars(select(m.Empleado.id).where(m.Empleado.equipo_id == equipo_id)))
    n_reg = n_nov = 0
    if emp_ids:
        n_reg = db.scalar(select(func.count()).select_from(m.RegistroHorario).where(
            m.RegistroHorario.periodo_id == per.id, m.RegistroHorario.empleado_id.in_(emp_ids))) or 0
        n_nov = db.scalar(select(func.count()).select_from(m.Novedad).where(
            m.Novedad.empleado_id.in_(emp_ids),
            m.Novedad.fecha_inicio <= per.fecha_fin, m.Novedad.fecha_fin >= per.fecha_inicio)) or 0
    if n_reg or n_nov:
        return  # todavía queda algo cargado: no se reinicia el proceso.
    prev = pe.estado_flujo
    pe.estado_flujo = "registro"
    pe.validado_lider = False
    pe.enviado_a_rh_en = None
    pe.aprobado_rh = False
    eq = db.get(m.Equipo, equipo_id)
    _evento(db, per.id, user,
            f"Se borraron todos los horarios de {eq.nombre if eq else 'el área'}; "
            f"el proceso vuelve a 'registro' (estaba en '{prev}').", equipo_id=equipo_id)


@router.get("/periodos", response_model=list[s.PeriodoOut])
def listar_periodos(user: m.Usuario = Depends(current_user), db: Session = Depends(get_session)):
    """Lista los períodos que le corresponden al usuario, ajustando el estado según
    el calendario.

    Períodos por ÁREA: un período con `equipo_id` solo lo ve esa área. Para un usuario
    de un área, un período global queda TAPADO si el área tiene uno propio que cruza sus
    fechas (así SAC/Incidentes ven su julio propio en vez del global). TH (sin área) ve
    todos, etiquetados con su área.

    Regla (#12.1): a lo sumo UN período abierto por área — el que corre hoy.
    """
    hoy = HOY_DEMO
    periodos = list(db.scalars(select(m.Periodo).order_by(m.Periodo.fecha_inicio.desc())))
    area_nombres = {e.id: e.nombre for e in db.scalars(select(m.Equipo))}
    for p in periodos:
        p.area_nombre = area_nombres.get(p.equipo_id) if p.equipo_id else None
    cambio = False
    for p in periodos:
        nuevo = _estado_periodo(p, hoy)
        if p.estado != nuevo:
            p.estado = nuevo; cambio = True
    if cambio:
        db.commit()
    # Filtrado por ÁREA: un usuario de un área ve sus períodos propios + los globales que
    # NO estén tapados por uno propio (que cruce sus fechas). TH (sin área) ve todos.
    if user.equipo_id:
        propios = [p for p in periodos if p.equipo_id == user.equipo_id]
        def _tapado(g):
            return any(a.fecha_inicio <= g.fecha_fin and g.fecha_inicio <= a.fecha_fin for a in propios)
        periodos = [p for p in periodos if p.equipo_id == user.equipo_id or (p.equipo_id is None and not _tapado(p))]
    # #1 Orden: primero el abierto (en curso), luego los PROGRAMADOS en orden
    # ascendente (el próximo a abrir primero), y al final los que se van cerrando
    # (en_revision y cerrado), más recientes primero.
    orden = {"abierto": 0, "programado": 1, "en_revision": 2, "cerrado": 3}
    def _key(p):
        g = orden.get(p.estado, 9)
        # programado ascendente; el resto descendente
        f = p.fecha_inicio.toordinal()
        return (g, f if p.estado == "programado" else -f)
    periodos.sort(key=_key)
    return periodos


# Excepciones reales del calendario (fechas ajustadas a mano por el cliente).
# Clave: (año, mes, quincena) → fechas que reemplazan a las calculadas. #12: la
# primera quincena de junio 2026 reportó a TH el 2 y a Financiera el 4 de junio.
_EXCEPCIONES_CAL: dict[tuple[int, int, int], dict[str, str]] = {
    (2026, 6, 1): {"fecha_corte": "2026-06-02", "fecha_reporte_financiera": "2026-06-04"},
}


@router.get("/calendario/nomina")
def calendario_nomina(anio: int = 2026, _: m.Usuario = Depends(current_user)) -> list[dict]:
    """Calendario de nómina COMPLETO del año (24 quincenas), calculado al vuelo —
    para verlo entero en el módulo de calendario aunque la operación arranque en
    julio (#3). No depende de los períodos persistidos. Aplica las excepciones
    reales del cliente (#12)."""
    salida = []
    for c in calendario.generar_ciclos(anio, 1, 1, anio, 12, 2):
        fila = {
            "nombre": c.nombre, "secuencia": calendario.secuencia_quincena(c.mes, c.quincena),
            "fecha_inicio": c.fecha_inicio.isoformat(), "fecha_fin": c.fecha_fin.isoformat(),
            "fecha_corte": c.fecha_reporte_th.isoformat(), "fecha_pago": c.fecha_pago.isoformat(),
            "fecha_reporte_financiera": c.fecha_reporte_financiera.isoformat(),
        }
        fila.update(_EXCEPCIONES_CAL.get((anio, c.mes, c.quincena), {}))
        salida.append(fila)
    return salida


@router.get("/periodos/{periodo_id}/equipos", response_model=list[s.PeriodoEquipoOut])
def estado_por_equipo(periodo_id: str, user: m.Usuario = Depends(current_user), db: Session = Depends(get_session)):
    """Estado del flujo por área. Devuelve TODAS las áreas visibles (aunque aún no
    tengan fila de flujo → 'registro') e incluye `tiene_datos` para distinguir
    'Pendiente' (nada cargado) de 'En proceso' (parcial) en la interfaz (#1)."""
    per = db.get(m.Periodo, periodo_id)
    if not per:
        raise HTTPException(404, "Período no encontrado.")
    pes = {pe.equipo_id: pe for pe in db.scalars(
        select(m.PeriodoEquipo).where(m.PeriodoEquipo.periodo_id == periodo_id))}
    q = select(m.Equipo).where(m.Equipo.activo)
    vis = equipos_visibles(user)
    if vis is not None:
        q = q.where(m.Equipo.id.in_(vis or ["__none__"]))
    salida: list[s.PeriodoEquipoOut] = []
    for area in db.scalars(q.order_by(m.Equipo.nombre)):
        pe = pes.get(area.id)
        emp_ids = list(db.scalars(select(m.Empleado.id).where(m.Empleado.equipo_id == area.id)))
        tiene = False
        if emp_ids:
            tiene = bool(db.scalar(select(m.RegistroHorario.id).where(
                m.RegistroHorario.periodo_id == per.id,
                m.RegistroHorario.empleado_id.in_(emp_ids)).limit(1))) or bool(db.scalar(
                select(m.Novedad.id).where(
                    m.Novedad.empleado_id.in_(emp_ids),
                    m.Novedad.fecha_inicio <= per.fecha_fin,
                    m.Novedad.fecha_fin >= per.fecha_inicio).limit(1)))
        salida.append(s.PeriodoEquipoOut(
            equipo_id=area.id,
            estado_flujo=pe.estado_flujo if pe else "registro",
            validado_lider=pe.validado_lider if pe else False,
            enviado_a_rh_en=pe.enviado_a_rh_en if pe else None,
            aprobado_rh=pe.aprobado_rh if pe else False,
            tiene_datos=tiene,
        ))
    return salida


def _agrega_horas_por_categoria(registros: list[m.RegistroHorario]) -> dict[str, dict[str, float]]:
    agg: dict[str, dict[str, float]] = {}
    for r in registros:
        d = agg.setdefault(r.empleado_id, {})
        for sg in (r.clasificacion or []):
            d[sg["category"]] = round(d.get(sg["category"], 0.0) + sg["hours"], 2)
    return agg


@router.post("/periodos/{periodo_id}/exportar-recargos")
def exportar_recargos(
    periodo_id: str, _: m.Usuario = Depends(require_rol("super_admin")),
    db: Session = Depends(get_session),
):
    """Pipeline "enviar a financiera" (#21.1): ZIP con la carpeta del período
    (NM2QDiciembre26) y un Excel por área "Recargos - <ÁREA>.xlsx" replicando la
    plantilla del cliente, relleno con las horas de recargo del período.
    """
    per = db.get(m.Periodo, periodo_id)
    if not per:
        raise HTTPException(404, "Período no encontrado.")
    # #4: la carpeta lleva el número de quincena del año como prefijo.
    carpeta = f"{per.secuencia}. {per.nombre or per.id[:6]}"
    registros = list(db.scalars(select(m.RegistroHorario).where(m.RegistroHorario.periodo_id == per.id)))
    agg = _agrega_horas_por_categoria(registros)
    areas = list(db.scalars(select(m.Equipo).where(m.Equipo.activo).order_by(m.Equipo.nombre)))

    archivos: list[tuple[str, bytes]] = []
    for area in areas:
        emps = list(db.scalars(select(m.Empleado).where(m.Empleado.equipo_id == area.id, m.Empleado.activo).order_by(m.Empleado.nombre)))
        filas = [{"cedula": e.cedula, "nombre": e.nombre, "cargo": e.cargo,
                  "cats": agg.get(e.id, {}), "observaciones": ""} for e in emps]
        contenido = reporte_excel.construir_excel_area(
            area=area.nombre.upper(), periodo=carpeta, fecha_corte=per.fecha_corte,
            fecha_inicio=per.fecha_inicio, fecha_fin=per.fecha_fin, filas=filas)
        archivos.append((f"Recargos - {area.nombre.upper()}.xlsx", contenido))

    zip_bytes = reporte_excel.construir_zip_periodo(carpeta, archivos)
    return Response(content=zip_bytes, media_type="application/zip",
                    headers={"Content-Disposition": f'attachment; filename="{carpeta}.zip"'})


@router.post("/periodos/{periodo_id}/generar-carpeta")
def generar_carpeta_nomina(
    periodo_id: str, _: m.Usuario = Depends(require_rol("super_admin")),
    db: Session = Depends(get_session),
) -> dict:
    """Plan de la carpeta (nombre + Excel por área) sin descargar. La descarga
    del ZIP se hace en /exportar-recargos; el Drive real se conecta en despliegue.
    """
    per = db.get(m.Periodo, periodo_id)
    if not per:
        raise HTTPException(404, "Período no encontrado.")
    areas = list(db.scalars(select(m.Equipo).where(m.Equipo.activo).order_by(m.Equipo.nombre)))
    carpeta = per.nombre or f"Periodo-{per.id[:6]}"
    return {
        "carpeta": carpeta,
        "ruta_drive": f"/Nómina/{per.fecha_pago.year if per.fecha_pago else 2026}/{carpeta}",
        "plantillas": [f"Recargos - {a.nombre.upper()}.xlsx" for a in areas],
        "estado": "planificado",
        "nota": "La creación real en Drive se activa en el despliegue (credenciales de servicio).",
    }


@router.post("/periodos", response_model=s.PeriodoOut, status_code=201)
def crear_periodo(payload: s.PeriodoIn, _: m.Usuario = Depends(require_rol("super_admin")), db: Session = Depends(get_session)):
    if payload.fecha_corte < payload.fecha_inicio or payload.fecha_corte > payload.fecha_fin + timedelta(days=30):
        raise HTTPException(400, "La fecha de corte debe estar dentro o cerca del rango del período.")
    if payload.nombre and db.scalar(select(m.Periodo).where(func.lower(m.Periodo.nombre) == payload.nombre.strip().lower())):
        raise HTTPException(409, "Ya existe un período con ese nombre.")
    # No permitir solape de rangos con otro período (evita quincenas duplicadas). #6
    solape = db.scalar(select(m.Periodo).where(
        m.Periodo.fecha_inicio <= payload.fecha_fin, m.Periodo.fecha_fin >= payload.fecha_inicio))
    if solape:
        raise HTTPException(409, f"El rango se solapa con el período '{solape.nombre or solape.id[:6]}'.")
    per = m.Periodo(**payload.model_dump())
    db.add(per)
    db.commit()
    db.refresh(per)
    return per


@router.post("/periodos/generar")
def generar_periodos(
    payload: s.GenerarPeriodosIn,
    _: m.Usuario = Depends(require_rol("super_admin")), db: Session = Depends(get_session),
) -> dict:
    """Genera todos los ciclos de nómina del año con la lógica del calendario
    colombiano (pago 15/fin de mes, corte a TH 6 hábiles antes, +2 a financiera).
    Nomenclatura NM{q}Q{Mes}{YY}. No duplica los existentes.
    """
    ciclos = calendario.generar_ciclos(
        payload.anio, payload.mes_desde, payload.quincena_desde, payload.anio, 12, 2)
    creados = 0
    for c in ciclos:
        if db.scalar(select(m.Periodo).where(m.Periodo.nombre == c.nombre)):
            continue
        db.add(m.Periodo(
            nombre=c.nombre, quincena=c.quincena,
            secuencia=calendario.secuencia_quincena(c.mes, c.quincena),
            fecha_inicio=c.fecha_inicio, fecha_fin=c.fecha_fin,
            fecha_corte=c.fecha_reporte_th, fecha_pago=c.fecha_pago,
            fecha_reporte_financiera=c.fecha_reporte_financiera, frecuencia="quincenal"))
        creados += 1
    db.commit()
    return {"creados": creados}


@router.patch("/periodos/{periodo_id}", response_model=s.PeriodoOut)
def editar_periodo(periodo_id: str, payload: s.PeriodoPatch, _: m.Usuario = Depends(require_rol("super_admin")), db: Session = Depends(get_session)):
    """Ajuste manual de fechas (ej. la excepción de junio). El cálculo es
    automático, pero si TH cambia una fecha, se guarda (#3)."""
    per = db.get(m.Periodo, periodo_id)
    if not per:
        raise HTTPException(404, "Período no encontrado.")
    for k, v in payload.model_dump(exclude_none=True).items():
        setattr(per, k, v)
    db.commit()
    db.refresh(per)
    return per


@router.post("/periodos/{periodo_id}/reabrir", response_model=s.PeriodoOut)
def reabrir_periodo(
    periodo_id: str, payload: s.AprobarIn | None = None,
    user: m.Usuario = Depends(require_rol("super_admin")), db: Session = Depends(get_session),
):
    """TH reabre un período cerrado para corregir un ÁREA (#10). Solo TH puede;
    el registrador y el líder reciben notificación y queda en el historial. Sin
    equipo_id se reabre todo el período; con equipo_id, solo esa área."""
    per = db.get(m.Periodo, periodo_id)
    if not per:
        raise HTTPException(404, "Período no encontrado.")
    per.cerrado_en = None
    if per.estado == "cerrado":
        per.estado = "en_revision"
    eq_filtro = payload.equipo_id if payload else None
    q = select(m.PeriodoEquipo).where(m.PeriodoEquipo.periodo_id == per.id)
    if eq_filtro:
        q = q.where(m.PeriodoEquipo.equipo_id == eq_filtro)
    for pe in db.scalars(q):
        pe.estado_flujo = "en_th"   # TH puede modificar y volver a aprobar
        pe.aprobado_rh = False
        eq = db.get(m.Equipo, pe.equipo_id)
        area = eq.nombre if eq else "el área"
        _evento(db, periodo_id, user, f"Talento Humano reabrió {area} de {per.nombre} para un ajuste.", tipo="observacion", equipo_id=pe.equipo_id)
        for rol in ("registrador", "lider"):
            db.add(m.Notificacion(rol_destino=rol, equipo_id=pe.equipo_id, tipo="DEVOLUCION",
                                  titulo=f"{area}: período reabierto por TH",
                                  descripcion=f"{per.nombre}: Talento Humano reabrió el período para modificar."))
    db.commit()
    db.refresh(per)
    return per


def _validar_area_lista(db: Session, per: m.Periodo, equipo_id: str) -> None:
    """Verifica que el área esté LISTA para enviar (#4/#6): cada empleado activo
    con TODOS los días del período cubiertos (turno, licencia/beneficio o Descanso)
    y sin romper el tope legal de 12 h extra/semana. Lanza 409 explicando qué falta.
    """
    # #2 Los líderes no se agendan (no llevan horario): no se exigen ni cuentan.
    emps = list(db.scalars(select(m.Empleado).where(
        m.Empleado.activo, m.Empleado.equipo_id == equipo_id, m.Empleado.lleva_horario)))
    if not emps:
        return
    dias = [per.fecha_inicio + timedelta(days=i) for i in range((per.fecha_fin - per.fecha_inicio).days + 1)]
    emp_ids = [e.id for e in emps]
    regs = list(db.scalars(select(m.RegistroHorario).where(
        m.RegistroHorario.periodo_id == per.id, m.RegistroHorario.empleado_id.in_(emp_ids))))
    novs = list(db.scalars(select(m.Novedad).where(
        m.Novedad.empleado_id.in_(emp_ids),
        m.Novedad.fecha_inicio <= per.fecha_fin, m.Novedad.fecha_fin >= per.fecha_inicio)))
    cubierto: set[tuple[str, date]] = {(r.empleado_id, r.fecha) for r in regs}
    for n in novs:
        d = max(n.fecha_inicio, per.fecha_inicio)
        while d <= min(n.fecha_fin, per.fecha_fin):
            cubierto.add((n.empleado_id, d)); d += timedelta(days=1)
    # #2/#4 El día de descanso semanal (domingo) y el SÁBADO no se exigen: si no se
    # marca nada, son descanso por defecto (semana L-V). Solo se cuentan como
    # faltantes los días L-V sin turno/licencia/descanso explícito.
    faltantes = []
    for e in emps:
        descanso = _DIAS.get((e.dia_descanso or "").lower(), 6)
        n_falta = sum(1 for d in dias if (e.id, d) not in cubierto
                      and d.weekday() != descanso and d.weekday() != 5)
        if n_falta:
            faltantes.append({"nombre": e.nombre, "faltan": n_falta})
    # #1 Ordenado: primero a quienes más días les faltan, luego alfabético.
    faltantes.sort(key=lambda x: (-x["faltan"], x["nombre"]))
    ext_sem: dict[tuple[str, tuple[int, int]], float] = {}
    for r in regs:
        wk = r.fecha.isocalendar()[:2]
        for sg in (r.clasificacion or []):
            if sg["category"].startswith("EXT"):
                ext_sem[(r.empleado_id, wk)] = ext_sem.get((r.empleado_id, wk), 0.0) + sg["hours"]
    nom = {e.id: e.nombre for e in emps}
    excede = sorted({nom[eid] for (eid, _wk), h in ext_sem.items() if h > 12.0001})
    if faltantes or excede:
        # #1 Detalle ESTRUCTURADO para que la interfaz lo muestre como modal ordenado.
        raise HTTPException(409, detail={
            "tipo": "area_incompleta",
            "titulo": "Aún faltan cosas por completar antes de enviar",
            "faltantes": faltantes,
            "excede": excede,
        })


@router.post("/periodos/{periodo_id}/enviar-validacion", response_model=s.PeriodoEquipoOut)
def enviar_a_validacion(
    periodo_id: str, user: m.Usuario = Depends(require_rol("registrador", "lider")),
    db: Session = Depends(get_session),
):
    """El registrador envía los horarios al LÍDER para que valide (#1, #2)."""
    per = db.get(m.Periodo, periodo_id)
    if not per:
        raise HTTPException(404, "Período no encontrado.")
    if not user.equipo_id:
        raise HTTPException(400, "Tu usuario no tiene equipo asignado.")
    n_reg = db.scalar(select(func.count()).select_from(m.RegistroHorario).where(m.RegistroHorario.periodo_id == per.id)) or 0
    if n_reg == 0:
        raise HTTPException(409, "Aún no hay horarios registrados para enviar a validación.")
    _validar_area_lista(db, per, user.equipo_id)  # #4/#6: días completos + límites
    pe = _ensure_pe(db, periodo_id, user.equipo_id)
    if pe.estado_flujo in _BLOQUEADO:
        raise HTTPException(409, "El período ya fue validado; no se puede reenviar.")
    eq = db.get(m.Equipo, user.equipo_id)
    area = eq.nombre if eq else "tu área"
    pe.estado_flujo = "pend_validacion"
    _evento(db, periodo_id, user, f"{user.nombre} envió los horarios de {area} al líder para validación.")
    db.add(m.Notificacion(rol_destino="lider", equipo_id=user.equipo_id, tipo="PERIODO_LISTO",
                          titulo=f"{area}: horarios listos para validar",
                          descripcion=f"{user.nombre} envió los horarios de {area} ({per.nombre}). Revísalos y valida."))
    db.commit()
    db.refresh(pe)
    return pe


@router.post("/periodos/{periodo_id}/enviar", response_model=s.PeriodoOut)
def enviar_periodo(
    periodo_id: str, user: m.Usuario = Depends(require_rol("registrador", "lider")),
    db: Session = Depends(get_session),
):
    """Envía a TH el equipo del usuario (requiere validación del líder, #3)."""
    per = db.get(m.Periodo, periodo_id)
    if not per:
        raise HTTPException(404, "Período no encontrado.")
    if per.estado == "cerrado":
        raise HTTPException(409, "El período ya está cerrado; usa Solicitud de cambio.")
    if not user.equipo_id:
        raise HTTPException(400, "Tu usuario no tiene equipo asignado.")
    pe = _ensure_pe(db, periodo_id, user.equipo_id)
    if pe.estado_flujo not in ("validado", "en_th"):
        raise HTTPException(409, "El líder debe validar antes de enviar a Talento Humano.")
    eq = db.get(m.Equipo, user.equipo_id)
    area = eq.nombre if eq else "un equipo"
    pe.estado_flujo = "en_th"
    pe.enviado_a_rh_en = m.ahora_bogota()
    _evento(db, periodo_id, user, f"{user.nombre} envió los horarios de {area} a Talento Humano.")
    db.add(m.Notificacion(rol_destino="super_admin", equipo_id=user.equipo_id, tipo="PERIODO_LISTO",
                          titulo=f"{area}: listo para revisión de TH",
                          descripcion=f"{user.nombre} envió a Talento Humano los horarios de {area} ({per.nombre})."))
    if per.estado == "abierto":
        per.estado = "en_revision"
    db.commit()
    db.refresh(per)
    return per


@router.post("/periodos/{periodo_id}/cerrar", response_model=s.PeriodoOut)
def cerrar_periodo(periodo_id: str, _: m.Usuario = Depends(require_rol("super_admin")), db: Session = Depends(get_session)):
    per = db.get(m.Periodo, periodo_id)
    if not per:
        raise HTTPException(404, "Período no encontrado.")
    # #1 Para cerrar deben cumplirse condiciones, no basta con accionar:
    #  (a) que el período ya haya llegado a su fecha de corte (reporte a TH), y
    #  (b) que existan horas registradas.
    faltantes = []
    if HOY_DEMO < per.fecha_corte:
        faltantes.append(f"aún no llega la fecha de corte ({per.fecha_corte.isoformat()})")
    n_reg = db.scalar(select(func.count()).select_from(m.RegistroHorario).where(m.RegistroHorario.periodo_id == per.id)) or 0
    if n_reg == 0:
        faltantes.append("no hay horas registradas en el período")
    if faltantes:
        raise HTTPException(409, "No se puede enviar a financiera / cerrar: " + "; ".join(faltantes) + ".")
    per.estado = "cerrado"
    per.cerrado_en = m.ahora_bogota()
    db.commit()
    db.refresh(per)
    return per


# ── Validación del líder + comentarios estilo red social ─────────────────────
@router.post("/periodos/{periodo_id}/validar-lider", response_model=s.PeriodoOutFull)
def validar_lider(
    periodo_id: str, user: m.Usuario = Depends(require_rol("lider", "super_admin")),
    db: Session = Depends(get_session),
):
    """El líder valida SU equipo. A partir de aquí se BLOQUEAN los cambios (#1)."""
    per = db.get(m.Periodo, periodo_id)
    if not per:
        raise HTTPException(404, "Período no encontrado.")
    if not user.equipo_id and user.rol != "super_admin":
        raise HTTPException(400, "Tu usuario no tiene equipo asignado.")
    area = "el equipo"
    if user.equipo_id:
        pe = _ensure_pe(db, periodo_id, user.equipo_id)
        pe.estado_flujo = "validado"
        pe.validado_lider = True
        eq = db.get(m.Equipo, user.equipo_id)
        area = eq.nombre if eq else area
    _evento(db, periodo_id, user, f"{user.nombre} (líder de {area}) validó los horarios. Quedan bloqueados para edición.", tipo="validacion")
    db.add(m.Notificacion(rol_destino="registrador", equipo_id=user.equipo_id, tipo="LIDER_VALIDO",
                          titulo=f"{area}: el líder validó", descripcion=f"{per.nombre} validado; ya se puede enviar a Talento Humano."))
    db.commit()
    db.refresh(per)
    return per


@router.post("/periodos/{periodo_id}/devolver", response_model=s.PeriodoOutFull)
def devolver_periodo(
    periodo_id: str, payload: s.ComentarioIn,
    user: m.Usuario = Depends(require_rol("super_admin", "lider")),
    db: Session = Depends(get_session),
):
    """Devuelve el período al equipo correspondiente con una observación."""
    per = db.get(m.Periodo, periodo_id)
    if not per:
        raise HTTPException(404, "Período no encontrado.")
    # Devolver reabre la edición (estado_flujo=registro) y deja la observación
    # en la línea de tiempo. Si es TH, devuelve a todos; si es líder, a su equipo.
    equipos_devueltos = []
    if user.rol == "super_admin":
        q_pe = select(m.PeriodoEquipo).where(m.PeriodoEquipo.periodo_id == per.id)
        if payload.equipo_id:  # TH devuelve UN área específica (consolidado por área)
            q_pe = q_pe.where(m.PeriodoEquipo.equipo_id == payload.equipo_id)
        for pe in db.scalars(q_pe):
            pe.estado_flujo = "registro"
            pe.validado_lider = False
            pe.aprobado_rh = False
            pe.enviado_a_rh_en = None
            equipos_devueltos.append(pe.equipo_id)
    elif user.equipo_id:
        pe = _ensure_pe(db, per.id, user.equipo_id)
        pe.estado_flujo = "registro"
        pe.validado_lider = False
        pe.enviado_a_rh_en = None
        pe.aprobado_rh = False
        equipos_devueltos.append(user.equipo_id)
    if per.estado == "en_revision":
        per.estado = "abierto"
    # La observación se deja en el hilo del área devuelta (si TH devuelve varias,
    # una por cada una; si el líder, la suya).
    for eq in equipos_devueltos:
        db.add(m.Comentario(periodo_id=per.id, equipo_id=eq, autor_nombre=user.nombre,
                            autor_rol=user.rol, texto=payload.texto, tipo="observacion"))
        nombre_eq = (db.get(m.Equipo, eq).nombre if db.get(m.Equipo, eq) else "")
        db.add(m.Notificacion(rol_destino="registrador", equipo_id=eq, tipo="DEVOLUCION",
                              titulo=f"{nombre_eq}: período devuelto con observaciones",
                              descripcion=f"{user.nombre}: {payload.texto[:140]}"))
        db.add(m.Notificacion(rol_destino="lider", equipo_id=eq, tipo="DEVOLUCION",
                              titulo=f"{nombre_eq}: período devuelto con observaciones",
                              descripcion=f"{user.nombre}: {payload.texto[:140]}"))
    db.commit()
    db.refresh(per)
    return per


@router.post("/periodos/{periodo_id}/aprobar", response_model=s.PeriodoOutFull)
def aprobar_periodo(
    periodo_id: str, payload: s.AprobarIn | None = None,
    user: m.Usuario = Depends(require_rol("super_admin")),
    db: Session = Depends(get_session),
):
    """TH APRUEBA lo que enviaron los equipos (#3). Solo se puede aprobar lo que
    ya está en Talento Humano (estado_flujo='en_th'). Al aprobar queda 'aprobado'
    (entra al histórico) y se notifica al registrador y al líder. Sin equipo_id se
    aprueban TODAS las áreas que estén en_th.
    """
    per = db.get(m.Periodo, periodo_id)
    if not per:
        raise HTTPException(404, "Período no encontrado.")
    eq_filtro = payload.equipo_id if payload else None
    q = select(m.PeriodoEquipo).where(
        m.PeriodoEquipo.periodo_id == per.id, m.PeriodoEquipo.estado_flujo == "en_th")
    if eq_filtro:
        q = q.where(m.PeriodoEquipo.equipo_id == eq_filtro)
    pes = list(db.scalars(q))
    if not pes:
        raise HTTPException(409, "No hay áreas pendientes de aprobar (deben estar enviadas a Talento Humano).")
    for pe in pes:
        pe.estado_flujo = "aprobado"
        pe.aprobado_rh = True
        eq = db.get(m.Equipo, pe.equipo_id)
        area = eq.nombre if eq else "el área"
        _evento(db, periodo_id, user, f"Talento Humano aprobó los horarios de {area}.", tipo="validacion", equipo_id=pe.equipo_id)
        for rol in ("registrador", "lider"):
            db.add(m.Notificacion(rol_destino=rol, equipo_id=pe.equipo_id, tipo="APROBADO",
                                  titulo=f"{area}: aprobado por Talento Humano",
                                  descripcion=f"{per.nombre}: TH aprobó los horarios. Queda en el histórico."))
    db.commit()
    db.refresh(per)
    return per


@router.get("/periodos/{periodo_id}/comentarios", response_model=list[s.ComentarioOut])
def listar_comentarios(periodo_id: str, equipo_id: str | None = None, user: m.Usuario = Depends(current_user), db: Session = Depends(get_session)):
    """Hilo del período. Con ?equipo_id devuelve el chat de ESA área (más los
    mensajes generales sin área, #4).

    El `equipo_id` llega del cliente: hay que cruzarlo con los equipos visibles. Si no,
    cualquiera leía el hilo de otra área (observaciones de TH, motivos de ajustes…)."""
    vis = equipos_visibles(user)
    if vis is not None:
        if equipo_id and equipo_id not in vis:
            raise HTTPException(403, "Ese chat es de otra área.")
        if not equipo_id:
            equipo_id = user.equipo_id   # un operativo solo ve el suyo, nunca todos
    q = select(m.Comentario).where(m.Comentario.periodo_id == periodo_id)
    if equipo_id:
        q = q.where((m.Comentario.equipo_id == equipo_id) | (m.Comentario.equipo_id.is_(None)))
    return list(db.scalars(q.order_by(m.Comentario.creado_en)))


@router.post("/periodos/{periodo_id}/comentarios", response_model=s.ComentarioOut, status_code=201)
def crear_comentario(
    periodo_id: str, payload: s.ComentarioIn,
    user: m.Usuario = Depends(current_user), db: Session = Depends(get_session),
):
    if not db.get(m.Periodo, periodo_id):
        raise HTTPException(404, "Período no encontrado.")
    # El área del mensaje: TH puede indicarla (está viendo un área); a un operativo se le
    # FUERZA la suya, para que no pueda escribir en el hilo de otra haciéndose pasar por
    # parte de ese equipo.
    eq = payload.equipo_id if user.rol == "super_admin" else user.equipo_id
    # #8 TH solo puede comentar un área cuando ya está en REVISIÓN de TH (en_th) o
    # aprobada; antes de eso el área aún es del registrador/líder.
    if user.rol == "super_admin" and eq:
        pe = db.scalar(select(m.PeriodoEquipo).where(
            m.PeriodoEquipo.periodo_id == periodo_id, m.PeriodoEquipo.equipo_id == eq))
        if not pe or pe.estado_flujo not in ("en_th", "aprobado"):
            raise HTTPException(409, "Podrás comentar esta área cuando la envíen a revisión de Talento Humano.")
    c = m.Comentario(periodo_id=periodo_id, equipo_id=eq, autor_nombre=user.nombre,
                     autor_rol=user.rol, texto=payload.texto, tipo=payload.tipo)
    # Notificar a la contraparte del área (sin spam: una por comentario).
    if eq and payload.tipo in ("comentario", "observacion"):
        destino = "lider" if user.rol == "registrador" else ("registrador" if user.rol == "lider" else None)
        if user.rol == "super_admin":
            for rol in ("lider", "registrador"):
                db.add(m.Notificacion(rol_destino=rol, equipo_id=eq, tipo="DEVOLUCION" if payload.tipo == "observacion" else "PERIODO_LISTO",
                                      titulo=("Nueva observación de TH" if payload.tipo == "observacion" else "Nuevo mensaje de TH"),
                                      descripcion=f"{user.nombre}: {payload.texto[:120]}"))
        elif destino:
            db.add(m.Notificacion(rol_destino=destino, equipo_id=eq, tipo="PERIODO_LISTO",
                                  titulo="Nuevo mensaje en el chat del período",
                                  descripcion=f"{user.nombre}: {payload.texto[:120]}"))
    # #2 Un comentario/observación de TH DEVUELVE el área al equipo (si estaba en TH):
    # deja de estar en revisión y vuelve a 'registro' para que corrijan. Si TH está
    # conforme, aprueba (esa es la validación); no comenta.
    if user.rol == "super_admin" and eq and payload.tipo in ("comentario", "observacion"):
        pe_dev = db.scalar(select(m.PeriodoEquipo).where(
            m.PeriodoEquipo.periodo_id == periodo_id, m.PeriodoEquipo.equipo_id == eq))
        if pe_dev and pe_dev.estado_flujo == "en_th":
            pe_dev.estado_flujo = "registro"
            pe_dev.validado_lider = False
            pe_dev.enviado_a_rh_en = None
            pe_dev.aprobado_rh = False
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


# ── Eventos especiales (calendario) ──────────────────────────────────────────
@router.get("/eventos", response_model=list[s.EventoEspecialOut])
def listar_eventos(_: m.Usuario = Depends(current_user), db: Session = Depends(get_session)):
    return list(db.scalars(select(m.EventoEspecial).order_by(m.EventoEspecial.fecha)))


@router.post("/eventos", response_model=s.EventoEspecialOut, status_code=201)
def crear_evento(payload: s.EventoEspecialIn, _: m.Usuario = Depends(require_rol("super_admin")), db: Session = Depends(get_session)):
    if db.scalar(select(m.EventoEspecial).where(m.EventoEspecial.fecha == payload.fecha,
                                                func.lower(m.EventoEspecial.nombre) == payload.nombre.strip().lower())):
        raise HTTPException(409, "Ya existe ese evento en esa fecha.")
    ev = m.EventoEspecial(**payload.model_dump())
    db.add(ev)
    db.commit()
    db.refresh(ev)
    return ev


@router.patch("/eventos/{evento_id}", response_model=s.EventoEspecialOut)
def editar_evento(evento_id: str, payload: s.EventoEspecialIn, _: m.Usuario = Depends(require_rol("super_admin")), db: Session = Depends(get_session)):
    ev = db.get(m.EventoEspecial, evento_id)
    if not ev:
        raise HTTPException(404, "Evento no encontrado.")
    ev.fecha = payload.fecha
    ev.nombre = payload.nombre
    db.commit()
    db.refresh(ev)
    return ev


@router.delete("/eventos/{evento_id}", status_code=204)
def borrar_evento(evento_id: str, _: m.Usuario = Depends(require_rol("super_admin")), db: Session = Depends(get_session)):
    ev = db.get(m.EventoEspecial, evento_id)
    if ev:
        db.delete(ev)
        db.commit()


# ── Beneficios/licencias de empresa (#6) ─────────────────────────────────────
@router.get("/beneficios", response_model=list[s.BeneficioOut])
def listar_beneficios(_: m.Usuario = Depends(current_user), db: Session = Depends(get_session)):
    return list(db.scalars(select(m.BeneficioLicencia).order_by(m.BeneficioLicencia.nombre)))


@router.post("/beneficios", response_model=s.BeneficioOut, status_code=201)
def crear_beneficio(payload: s.BeneficioIn, _: m.Usuario = Depends(require_rol("super_admin")), db: Session = Depends(get_session)):
    if db.scalar(select(m.BeneficioLicencia).where(func.lower(m.BeneficioLicencia.nombre) == payload.nombre.strip().lower())):
        raise HTTPException(409, "Ya existe un beneficio con ese nombre.")
    b = m.BeneficioLicencia(**payload.model_dump())
    db.add(b)
    db.commit()
    db.refresh(b)
    return b


@router.patch("/beneficios/{beneficio_id}", response_model=s.BeneficioOut)
def editar_beneficio(beneficio_id: str, payload: s.BeneficioPatch, _: m.Usuario = Depends(require_rol("super_admin")), db: Session = Depends(get_session)):
    b = db.get(m.BeneficioLicencia, beneficio_id)
    if not b:
        raise HTTPException(404, "Beneficio no encontrado.")
    for k, v in payload.model_dump(exclude_none=True).items():
        setattr(b, k, v)
    db.commit()
    db.refresh(b)
    return b


@router.delete("/beneficios/{beneficio_id}", status_code=204)
def borrar_beneficio(beneficio_id: str, _: m.Usuario = Depends(require_rol("super_admin")), db: Session = Depends(get_session)):
    b = db.get(m.BeneficioLicencia, beneficio_id)
    if b:
        db.delete(b)
        db.commit()


# ── Pagos manuales (primas / aguinaldo) — salen en el calendario (#8) ────────
@router.get("/pagos-manuales", response_model=list[s.PagoManualOut])
def listar_pagos_manuales(_: m.Usuario = Depends(current_user), db: Session = Depends(get_session)):
    return list(db.scalars(select(m.PagoManual).order_by(m.PagoManual.fecha)))


@router.post("/pagos-manuales", response_model=s.PagoManualOut, status_code=201)
def crear_pago_manual(payload: s.PagoManualIn, _: m.Usuario = Depends(require_rol("super_admin")), db: Session = Depends(get_session)):
    if db.scalar(select(m.PagoManual).where(m.PagoManual.fecha == payload.fecha, m.PagoManual.tipo == payload.tipo)):
        raise HTTPException(409, "Ya existe un pago de ese tipo en esa fecha.")
    p = m.PagoManual(**payload.model_dump())
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


@router.patch("/pagos-manuales/{pago_id}", response_model=s.PagoManualOut)
def editar_pago_manual(pago_id: str, payload: s.PagoManualPatch, _: m.Usuario = Depends(require_rol("super_admin")), db: Session = Depends(get_session)):
    p = db.get(m.PagoManual, pago_id)
    if not p:
        raise HTTPException(404, "Pago no encontrado.")
    for k, v in payload.model_dump(exclude_none=True).items():
        setattr(p, k, v)
    db.commit()
    db.refresh(p)
    return p


@router.delete("/pagos-manuales/{pago_id}", status_code=204)
def borrar_pago_manual(pago_id: str, _: m.Usuario = Depends(require_rol("super_admin")), db: Session = Depends(get_session)):
    p = db.get(m.PagoManual, pago_id)
    if p:
        db.delete(p)
        db.commit()


# ── Tiempo de almuerzo por tipo de contrato ──────────────────────────────────
@router.get("/almuerzo", response_model=list[s.TiempoAlmuerzoOut])
def listar_almuerzo(_: m.Usuario = Depends(current_user), db: Session = Depends(get_session)):
    return list(db.scalars(select(m.TiempoAlimentacionContrato)))


@router.put("/almuerzo", response_model=s.TiempoAlmuerzoOut)
def upsert_almuerzo(payload: s.TiempoAlmuerzoIn, _: m.Usuario = Depends(require_rol("super_admin")), db: Session = Depends(get_session)):
    obj = db.get(m.TiempoAlimentacionContrato, payload.tipo_contrato)
    if obj:
        obj.minutos = payload.minutos
    else:
        obj = m.TiempoAlimentacionContrato(tipo_contrato=payload.tipo_contrato, minutos=payload.minutos)
        db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


# ── Solicitudes de cambio post-cierre (#15) ──────────────────────────────────
@router.get("/solicitudes-cambio", response_model=list[s.SolicitudCambioOut])
def listar_solicitudes(user: m.Usuario = Depends(current_user), db: Session = Depends(get_session)):
    """TH ve todas; los demás solo las de su equipo. El `motivo` puede traer datos de salud
    (incapacidades): no puede quedar a la vista de toda la empresa."""
    q = select(m.SolicitudCambio)
    vis = equipos_visibles(user)
    if vis is not None:
        q = q.join(m.Empleado, m.Empleado.id == m.SolicitudCambio.empleado_id).where(
            m.Empleado.equipo_id.in_(vis or ["__none__"]))
    return list(db.scalars(q.order_by(m.SolicitudCambio.creado_en.desc())))


@router.post("/solicitudes-cambio", response_model=s.SolicitudCambioOut, status_code=201)
def crear_solicitud(
    payload: s.SolicitudCambioIn,
    user: m.Usuario = Depends(require_rol("registrador", "lider", "super_admin")),
    db: Session = Depends(get_session),
):
    if not db.get(m.Periodo, payload.periodo_id):
        raise HTTPException(404, "Período no encontrado.")
    _exigir_empleado_visible(db, user, payload.empleado_id)
    sol = m.SolicitudCambio(**payload.model_dump(), solicitante_nombre=user.nombre, solicitante_rol=user.rol)
    db.add(sol)
    db.add(m.Notificacion(rol_destino="super_admin", tipo="SOLICITUD_CAMBIO",
                          titulo="Solicitud de cambio post-cierre",
                          descripcion=f"{user.nombre} pide cambio el {payload.fecha}: {payload.motivo[:120]}"))
    db.commit()
    db.refresh(sol)
    return sol


@router.post("/solicitudes-cambio/{sol_id}/responder", response_model=s.SolicitudCambioOut)
def responder_solicitud(
    sol_id: str, payload: s.SolicitudCambioResponderIn,
    user: m.Usuario = Depends(require_rol("super_admin")),
    db: Session = Depends(get_session),
):
    sol = db.get(m.SolicitudCambio, sol_id)
    if not sol:
        raise HTTPException(404, "Solicitud no encontrada.")
    sol.estado = "aprobada" if payload.aprobar else "rechazada"
    sol.respuesta_rh = payload.respuesta
    # Notificar al equipo solicitante.
    emp = db.get(m.Empleado, sol.empleado_id)
    eq = emp.equipo_id if emp else None
    db.add(m.Notificacion(rol_destino="registrador", equipo_id=eq, tipo="SOLICITUD_RESPUESTA",
                          titulo=f"Solicitud {sol.estado}: {sol.fecha}",
                          descripcion=f"{user.nombre}: {payload.respuesta[:140]}"))
    db.add(m.Notificacion(rol_destino="lider", equipo_id=eq, tipo="SOLICITUD_RESPUESTA",
                          titulo=f"Solicitud {sol.estado}: {sol.fecha}",
                          descripcion=f"{user.nombre}: {payload.respuesta[:140]}"))
    db.commit()
    db.refresh(sol)
    return sol


# ── Sugerir turno (registrador propone uno nuevo) ────────────────────────────
@router.post("/turnos/sugerir", status_code=201)
def sugerir_turno(payload: s.TurnoIn, user: m.Usuario = Depends(require_rol("registrador", "lider")), db: Session = Depends(get_session)) -> dict:
    """Proponer un horario (#7). Si YA existe (mismo horario) y no lo ve el área,
    se agrega al área. Si NO existe, se crea para el área con abreviatura vacía y
    se avisa a TH para que le ponga la abreviatura."""
    if not user.equipo_id:
        raise HTTPException(400, "Tu usuario no tiene equipo asignado.")
    rango = f"{payload.hora_inicio.strftime('%H:%M')}–{payload.hora_fin.strftime('%H:%M')}"
    existentes = list(db.scalars(select(m.Turno).where(
        m.Turno.hora_inicio == payload.hora_inicio, m.Turno.hora_fin == payload.hora_fin, m.Turno.activo)))
    # ¿Alguno ya es visible para el área (global o del propio equipo)?
    visible = any(t.equipo_id is None or t.equipo_id == user.equipo_id for t in existentes)
    if visible:
        return {"existente": True, "mensaje": f"Ese horario ({rango}) ya está disponible para tu área."}
    if existentes:
        base = existentes[0]
        db.add(m.Turno(nombre=base.nombre, abreviatura=base.abreviatura,
                       hora_inicio=payload.hora_inicio, hora_fin=payload.hora_fin, equipo_id=user.equipo_id))
        db.commit()
        return {"existente": True, "mensaje": f"El horario {rango} ya existía; se agregó a tu área."}
    # No existe: se crea para el área (abreviatura la pondrá TH).
    db.add(m.Turno(nombre=payload.nombre, abreviatura="", hora_inicio=payload.hora_inicio,
                   hora_fin=payload.hora_fin, equipo_id=user.equipo_id))
    db.add(m.Notificacion(
        rol_destino="super_admin", equipo_id=user.equipo_id, tipo="TURNO_PROPUESTO",
        titulo=f"Nuevo turno propuesto: {payload.nombre}",
        descripcion=f"{user.nombre} propuso {rango} (\"{payload.nombre}\"). Ponle la abreviatura en Configuración → Turnos."))
    db.commit()
    return {"creado": True, "mensaje": f"Se creó “{payload.nombre}” ({rango}) para tu área. TH le pondrá la abreviatura."}


@router.post("/periodos/{periodo_id}/aplicar-habitual")
def aplicar_habitual(
    periodo_id: str, payload: s.AplicarHabitualIn,
    user: m.Usuario = Depends(require_rol("super_admin", "registrador", "lider")), db: Session = Depends(get_session),
) -> dict:
    """Aplica el HORARIO HABITUAL de cada empleado a todo el período (1 clic).

    Salta el día de descanso de cada empleado y los días con novedad. El sistema
    calcula la clasificación según la hora de entrada/salida.
    """
    per = db.get(m.Periodo, periodo_id)
    if not per:
        raise HTTPException(404, "Período no encontrado.")
    if per.estado != "abierto":
        raise HTTPException(409, "El período no está abierto.")
    _guardar_cambio(db, periodo_id, user)

    # Período es global: el alcance se limita al equipo del usuario operativo (RH = todos).
    _eq_filtro = equipos_visibles(user)
    q = select(m.Empleado).where(m.Empleado.activo)
    if _eq_filtro is not None:
        q = q.where(m.Empleado.equipo_id.in_(_eq_filtro or ["__none__"]))
    if payload.empleado_ids:
        q = q.where(m.Empleado.id.in_(payload.empleado_ids))
    empleados = list(db.scalars(q))

    dias = [per.fecha_inicio + timedelta(days=i) for i in range((per.fecha_fin - per.fecha_inicio).days + 1)]
    creados = 0
    for emp in empleados:
        if not emp.horario_inicio_habitual or not emp.horario_fin_habitual:
            continue
        descanso = _DIAS.get((emp.dia_descanso or "").lower(), 6)
        for dia in dias:
            if dia.weekday() == descanso:
                continue
            if db.scalar(select(m.Novedad).where(
                m.Novedad.empleado_id == emp.id, m.Novedad.fecha_inicio <= dia, m.Novedad.fecha_fin >= dia)):
                continue
            existente = db.scalar(select(m.RegistroHorario).where(
                m.RegistroHorario.empleado_id == emp.id, m.RegistroHorario.fecha == dia))
            if existente and not payload.sobrescribir:
                continue
            if existente:
                db.delete(existente)
            r, segs = _clasificar(emp, dia, emp.horario_inicio_habitual, emp.horario_fin_habitual, 0.0, False)
            db.add(m.RegistroHorario(
                empleado_id=emp.id, periodo_id=per.id, fecha=dia,
                hora_inicio=emp.horario_inicio_habitual, hora_fin=emp.horario_fin_habitual,
                tiempo_alimentacion_h=1.0,
                duracion_bruta_h=r.gross_hours, duracion_neta_h=r.net_hours,
                tipo_descanso=r.rest_type.value if r.rest_type else None, clasificacion=segs, estado="pendiente"))
            creados += 1
    db.flush()
    for emp in empleados:
        _reclasificar_periodo_emp(db, emp, per)
    db.commit()
    return {"creados": creados}


@router.get("/turnos", response_model=list[s.TurnoOut])
def listar_turnos(
    equipo_id: str | None = None, inactivos: bool = False,
    user: m.Usuario = Depends(current_user), db: Session = Depends(get_session),
):
    """Catálogo de turnos. Registrador/líder ven los de SU área + los globales;
    RH ve todos (o filtra por ?equipo_id)."""
    turnos = list(db.scalars(select(m.Turno).where(
        m.Turno.activo == (not inactivos)).order_by(m.Turno.hora_inicio)))
    area = equipo_id
    if area is None and user.rol in ("registrador", "lider") and user.equipo_id:
        area = user.equipo_id
    if area:
        # #2 Un turno lo pueden usar varias áreas (equipos_ids); vacío = todas.
        turnos = [t for t in turnos if not t.equipos_ids or area in (t.equipos_ids or [])]
    return turnos


@router.post("/turnos", response_model=s.TurnoOut, status_code=201)
def crear_turno(payload: s.TurnoIn, _: m.Usuario = Depends(require_rol("super_admin")), db: Session = Depends(get_session)):
    """RH crea un turno/horario reutilizable para que lo usen quienes registran."""
    if db.scalar(select(m.Turno).where(func.lower(m.Turno.nombre) == payload.nombre.strip().lower(), m.Turno.activo)):
        raise HTTPException(409, "Ya existe un turno con ese nombre.")
    t = m.Turno(**payload.model_dump())
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


@router.patch("/turnos/{turno_id}", response_model=s.TurnoOut)
def editar_turno(turno_id: str, payload: s.TurnoPatch, _: m.Usuario = Depends(require_rol("super_admin")), db: Session = Depends(get_session)):
    """RH edita un turno (p. ej. sus minutos de alimentación, #4)."""
    t = db.get(m.Turno, turno_id)
    if not t:
        raise HTTPException(404, "Turno no encontrado.")
    for k, v in payload.model_dump(exclude_none=True).items():
        setattr(t, k, v)
    db.commit()
    db.refresh(t)
    return t


@router.delete("/turnos/{turno_id}", status_code=204)
def borrar_turno(turno_id: str, _: m.Usuario = Depends(require_rol("super_admin")), db: Session = Depends(get_session)):
    """Borrado DEFINITIVO de un turno (desde inactivos, #15)."""
    t = db.get(m.Turno, turno_id)
    if t:
        db.delete(t)
        db.commit()


@router.post("/periodos/{periodo_id}/asignar")
def asignar(
    periodo_id: str, payload: s.AsignarIn,
    user: m.Usuario = Depends(require_rol("super_admin", "registrador", "lider")), db: Session = Depends(get_session),
) -> dict:
    """Asigna un horario a varios empleados en el alcance elegido (período, día o rango).

    Si `turno_id` es None usa el horario habitual de cada empleado. Si `fechas` es
    None aplica a todo el período. Salta el día de descanso y los días con novedad.
    """
    per = db.get(m.Periodo, periodo_id)
    if not per:
        raise HTTPException(404, "Período no encontrado.")
    if per.estado != "abierto":
        raise HTTPException(409, "El período no está abierto.")
    _guardar_cambio(db, periodo_id, user)
    turno = db.get(m.Turno, payload.turno_id) if payload.turno_id else None
    if payload.turno_id and not turno:
        raise HTTPException(404, "Turno no encontrado.")

    # Período es global: el alcance se limita al equipo del usuario operativo (RH = todos).
    _eq_filtro = equipos_visibles(user)
    q = select(m.Empleado).where(m.Empleado.activo)
    if _eq_filtro is not None:
        q = q.where(m.Empleado.equipo_id.in_(_eq_filtro or ["__none__"]))
    if payload.empleado_ids:
        q = q.where(m.Empleado.id.in_(payload.empleado_ids))
    empleados = list(db.scalars(q))

    if payload.fechas:
        dias = [d for d in payload.fechas if per.fecha_inicio <= d <= per.fecha_fin]
    else:
        dias = [per.fecha_inicio + timedelta(days=i) for i in range((per.fecha_fin - per.fecha_inicio).days + 1)]
    # El día de descanso semanal solo se OMITE cuando se aplica a TODO el período (sin
    # elegir días). Si el usuario eligió días concretos —aunque sean sábado/domingo—, se
    # respetan: hay equipos (SAC/Incidentes/Riesgos) que trabajan fines de semana por turnos.
    salta_descanso = not payload.fechas

    # QUITAR: borra el horario/novedad de los días elegidos (deshacer). #3-prev
    if payload.es_quitar:
        creados = 0
        for emp in empleados:
            for dia in dias:
                for prev in db.scalars(select(m.RegistroHorario).where(
                        m.RegistroHorario.empleado_id == emp.id, m.RegistroHorario.fecha == dia)):
                    db.delete(prev); creados += 1
                nov = db.scalar(select(m.Novedad).where(
                    m.Novedad.empleado_id == emp.id,
                    m.Novedad.fecha_inicio <= dia, m.Novedad.fecha_fin >= dia))
                if nov:
                    db.delete(nov); creados += 1
        db.flush()
        for emp in empleados:
            _reclasificar_periodo_emp(db, emp, per)
        db.commit()
        return {"creados": creados}

    # Marcar los días elegidos como DESCANSO (reemplaza horario/novedad de ese día).
    if payload.es_descanso:
        creados = 0
        for emp in empleados:
            for dia in dias:
                for prev in db.scalars(select(m.RegistroHorario).where(
                        m.RegistroHorario.empleado_id == emp.id, m.RegistroHorario.fecha == dia)):
                    db.delete(prev)
                nov = db.scalar(select(m.Novedad).where(
                    m.Novedad.empleado_id == emp.id,
                    m.Novedad.fecha_inicio <= dia, m.Novedad.fecha_fin >= dia))
                if nov:
                    db.delete(nov)
                db.add(m.Novedad(empleado_id=emp.id, periodo_id=per.id, fecha_inicio=dia,
                                 fecha_fin=dia, tipo="DESCANSO", es_remunerada=True))
                creados += 1
        db.flush()
        for emp in empleados:
            _reclasificar_periodo_emp(db, emp, per)
        db.commit()
        return {"creados": creados}

    # #3 Horario MANUAL (fuera del catálogo): se aplica tal cual, sin guardar turno
    # ni mandar recomendación.
    manual = payload.hora_inicio is not None and payload.hora_fin is not None
    creados = 0
    for emp in empleados:
        if manual:
            ini, fin = payload.hora_inicio, payload.hora_fin
        elif turno:
            ini, fin = turno.hora_inicio, turno.hora_fin
        else:
            if not emp.horario_inicio_habitual or not emp.horario_fin_habitual:
                continue
            ini, fin = emp.horario_inicio_habitual, emp.horario_fin_habitual
        descanso = _DIAS.get((emp.dia_descanso or "").lower(), 6)
        meal_h0 = ((payload.meal_min if payload.meal_min is not None else 60) if manual else (turno.almuerzo_min if turno else 60)) / 60.0
        for dia in dias:
            if salta_descanso and dia.weekday() == descanso:
                continue  # solo al aplicar a TODO el período se salta el turno que ARRANCA en descanso (la cola del día previo sí cae aquí)
            nov_dia = db.scalar(select(m.Novedad).where(
                m.Novedad.empleado_id == emp.id, m.Novedad.fecha_inicio <= dia, m.Novedad.fecha_fin >= dia))
            if nov_dia:
                # Un DESCANSO en un día ELEGIDO explícitamente se reemplaza por el turno (igual
                # que el editor por día). Una licencia/beneficio (ausencia real) NO se pisa.
                if salta_descanso or nov_dia.tipo != "DESCANSO":
                    continue
                db.delete(nov_dia)
            # Turno PROPIO del día = los que NO son cola (00:00-…) del día anterior.
            propios = list(db.scalars(select(m.RegistroHorario).where(
                m.RegistroHorario.empleado_id == emp.id, m.RegistroHorario.fecha == dia,
                m.RegistroHorario.hora_inicio != time(0, 0))))
            if propios and not payload.sobrescribir:
                continue
            for p in propios:
                db.delete(p)
            # Partir el turno por medianoche: la parte de después de 00:00 pasa al día
            # siguiente (cuenta en SU día, aunque sea descanso). Reemplaza la cola previa.
            for f, i, ff in _partir_medianoche(dia, ini, fin):
                pid = per.id
                if f != dia:
                    per_f = db.scalar(select(m.Periodo).where(m.Periodo.fecha_inicio <= f, m.Periodo.fecha_fin >= f))
                    pid = per_f.id if per_f else per.id
                    for prev in db.scalars(select(m.RegistroHorario).where(
                            m.RegistroHorario.empleado_id == emp.id, m.RegistroHorario.fecha == f,
                            m.RegistroHorario.hora_inicio == time(0, 0))):
                        db.delete(prev)
                r, segs = _clasificar(emp, f, i, ff, 0.0, f.weekday() == descanso)
                db.add(m.RegistroHorario(
                    empleado_id=emp.id, periodo_id=pid, fecha=f,
                    hora_inicio=i, hora_fin=ff,
                    tiempo_alimentacion_h=0.0 if f != dia else meal_h0,
                    duracion_bruta_h=r.gross_hours, duracion_neta_h=r.net_hours,
                    tipo_descanso=r.rest_type.value if r.rest_type else None, clasificacion=segs, estado="pendiente"))
                creados += 1
    db.flush()
    for emp in empleados:
        _reclasificar_periodo_emp(db, emp, per)
    db.commit()
    return {"creados": creados}


@router.post("/periodos/{periodo_id}/aplicar-turno")
def aplicar_turno(
    periodo_id: str, payload: s.AplicarTurnoIn,
    user: m.Usuario = Depends(require_rol("super_admin", "registrador", "lider")), db: Session = Depends(get_session),
) -> dict:
    """Aplica un TURNO (horario fijo) a todo el período (atajo de registro)."""
    per = db.get(m.Periodo, periodo_id)
    if not per or per.estado != "abierto":
        raise HTTPException(409, "El período no está abierto.")
    _guardar_cambio(db, periodo_id, user)
    turno = db.get(m.Turno, payload.turno_id)
    if not turno:
        raise HTTPException(404, "Turno no encontrado.")
    # Período es global: el alcance se limita al equipo del usuario operativo (RH = todos).
    _eq_filtro = equipos_visibles(user)
    q = select(m.Empleado).where(m.Empleado.activo)
    if _eq_filtro is not None:
        q = q.where(m.Empleado.equipo_id.in_(_eq_filtro or ["__none__"]))
    if payload.empleado_ids:
        q = q.where(m.Empleado.id.in_(payload.empleado_ids))
    empleados = list(db.scalars(q))
    dias = [per.fecha_inicio + timedelta(days=i) for i in range((per.fecha_fin - per.fecha_inicio).days + 1)]
    creados = 0
    for emp in empleados:
        descanso = _DIAS.get((emp.dia_descanso or "").lower(), 6)
        for dia in dias:
            if dia.weekday() == descanso:
                continue
            if db.scalar(select(m.Novedad).where(
                m.Novedad.empleado_id == emp.id, m.Novedad.fecha_inicio <= dia, m.Novedad.fecha_fin >= dia)):
                continue
            existente = db.scalar(select(m.RegistroHorario).where(
                m.RegistroHorario.empleado_id == emp.id, m.RegistroHorario.fecha == dia))
            if existente and not payload.sobrescribir:
                continue
            if existente:
                db.delete(existente)
            r, segs = _clasificar(emp, dia, turno.hora_inicio, turno.hora_fin, 0.0, False)
            db.add(m.RegistroHorario(
                empleado_id=emp.id, periodo_id=per.id, fecha=dia,
                hora_inicio=turno.hora_inicio, hora_fin=turno.hora_fin,
                tiempo_alimentacion_h=(turno.almuerzo_min or 0) / 60.0,
                duracion_bruta_h=r.gross_hours, duracion_neta_h=r.net_hours,
                tipo_descanso=r.rest_type.value if r.rest_type else None, clasificacion=segs, estado="pendiente"))
            creados += 1
    db.flush()
    for emp in empleados:
        _reclasificar_periodo_emp(db, emp, per)
    db.commit()
    return {"creados": creados, "turno": turno.nombre}


# Orden de categorías para el reporte (las 8 del Bloque 6.7).
_CATEGORIAS = [
    "ORD_DIUR_REG", "ORD_NOCT_REG", "ORD_DIUR_DESC", "ORD_NOCT_DESC",
    "EXT_DIUR_REG", "EXT_NOCT_REG", "EXT_DIUR_DESC", "EXT_NOCT_DESC",
    # #10 Licencia/beneficio REMUNERADO: no son horas trabajadas, pero SÍ se pagan
    # (la jornada del día). Se muestran como una categoría más del reporte.
    "LIC_REM",
]


@router.get("/periodos/{periodo_id}/reporte")
def reporte_periodo(periodo_id: str, user: m.Usuario = Depends(current_user), db: Session = Depends(get_session)) -> dict:
    """Reporte del período: cuántas horas trabajó cada empleado por categoría.

    Este es el ENTREGABLE: total de horas y desglose por categoría (ordinaria,
    nocturna, extra, dominical/festivo…) por empleado, más días de novedad.
    """
    per = db.get(m.Periodo, periodo_id)
    if not per:
        raise HTTPException(404, "Período no encontrado.")
    vis = equipos_visibles(user)

    q_emp = select(m.Empleado).where(m.Empleado.activo, m.Empleado.lleva_horario)  # solo quien lleva horario
    q_reg = select(m.RegistroHorario).where(m.RegistroHorario.periodo_id == per.id) \
        .join(m.Empleado, m.Empleado.id == m.RegistroHorario.empleado_id)
    q_nov = select(m.Novedad).join(m.Empleado, m.Empleado.id == m.Novedad.empleado_id)
    if vis is not None:
        eqs = vis or ["__none__"]
        q_emp = q_emp.where(m.Empleado.equipo_id.in_(eqs))
        q_reg = q_reg.where(m.Empleado.equipo_id.in_(eqs))
        q_nov = q_nov.where(m.Empleado.equipo_id.in_(eqs))
    empleados = list(db.scalars(q_emp))
    registros = list(db.scalars(q_reg))
    novedades = list(db.scalars(q_nov))

    sem_map, sem_meta = _semanas_de_periodo(per)  # #3 semanas ISO del período
    emp_by_id = {e.id: e for e in empleados}
    _base = lambda: {"total": 0.0, "cats": {}, "nov_dias": 0, "lic_rem_dias": 0, "lic_norem_dias": 0, "sem": {}}
    agg: dict[str, dict] = {e.id: _base() for e in empleados}
    for r in registros:
        d = agg.setdefault(r.empleado_id, _base())
        d["total"] = round(d["total"] + r.duracion_neta_h, 2)
        nsem = sem_map.get(r.fecha.isocalendar()[:2])
        if nsem:
            d["sem"][nsem] = round(d["sem"].get(nsem, 0.0) + r.duracion_neta_h, 2)
        for sg in (r.clasificacion or []):
            d["cats"][sg["category"]] = round(d["cats"].get(sg["category"], 0.0) + sg["hours"], 2)
    for n in novedades:
        ini = max(n.fecha_inicio, per.fecha_inicio)
        fin = min(n.fecha_fin, per.fecha_fin)
        if fin >= ini and n.empleado_id in agg:
            dias_n = (fin - ini).days + 1
            agg[n.empleado_id]["nov_dias"] += dias_n
            # #10 El DESCANSO es descanso semanal (aparte). Para licencias/beneficios:
            # las REMUNERADAS pagan la jornada del día (cuenta en el total y en LIC_REM);
            # las NO remuneradas no suman horas (solo se cuentan los días).
            if n.tipo != "DESCANSO":
                frac = n.fraccion_dia if n.fraccion_dia else 1.0
                if n.es_remunerada:
                    e = emp_by_id.get(n.empleado_id)
                    jh = (e.jornada_horas_dia if e and e.jornada_horas_dia else 8)
                    # #1 Paga la FRACCIÓN de la jornada por día (medio día = 4 h).
                    horas = round(dias_n * frac * jh, 2)
                    agg[n.empleado_id]["cats"]["LIC_REM"] = round(agg[n.empleado_id]["cats"].get("LIC_REM", 0.0) + horas, 2)
                    agg[n.empleado_id]["total"] = round(agg[n.empleado_id]["total"] + horas, 2)
                    agg[n.empleado_id]["lic_rem_dias"] = round(agg[n.empleado_id]["lic_rem_dias"] + dias_n * frac, 2)
                else:
                    agg[n.empleado_id]["lic_norem_dias"] = round(agg[n.empleado_id]["lic_norem_dias"] + dias_n * frac, 2)

    # AJUSTES DE TH: se aplican ENCIMA de lo reportado (no tocan la grilla). Suman/restan a
    # su categoría y al total → esto es lo que se envía a Financiera. Se exponen por empleado
    # con su motivo para trazabilidad (la nota también quedó en Consolidado y chat).
    ajustes = list(db.scalars(select(m.AjusteReporte).where(m.AjusteReporte.periodo_id == per.id)))
    ajustes_emp: dict[str, list] = {}
    for a in ajustes:
        if a.empleado_id not in agg:
            continue
        agg[a.empleado_id]["cats"][a.categoria] = round(agg[a.empleado_id]["cats"].get(a.categoria, 0.0) + a.horas, 2)
        agg[a.empleado_id]["total"] = round(agg[a.empleado_id]["total"] + a.horas, 2)
        ajustes_emp.setdefault(a.empleado_id, []).append({"categoria": a.categoria, "horas": a.horas, "motivo": a.motivo})

    filas = [{
        "empleado_id": e.id, "nombre": e.nombre, "tipo_jornada": e.tipo_jornada,
        "total_neto": agg[e.id]["total"],
        "categorias": {c: agg[e.id]["cats"].get(c, 0.0) for c in _CATEGORIAS},
        "novedades_dias": agg[e.id]["nov_dias"],
        "licencia_rem_dias": agg[e.id]["lic_rem_dias"],
        "licencia_norem_dias": agg[e.id]["lic_norem_dias"],
        "ajustes": ajustes_emp.get(e.id, []),   # ajustes de TH aplicados a esta fila
        "semanas": [round(agg[e.id]["sem"].get(sm["n"], 0.0), 2) for sm in sem_meta],  # #3
    } for e in empleados]

    return {
        "periodo": {"id": per.id, "nombre": per.nombre, "estado": per.estado,
                    "fecha_inicio": per.fecha_inicio.isoformat(), "fecha_fin": per.fecha_fin.isoformat()},
        "categorias": _CATEGORIAS,
        "semanas_periodo": sem_meta,  # #3
        "filas": filas,
    }


# ── Novedades ────────────────────────────────────────────────────────────────
@router.get("/novedades", response_model=list[s.NovedadOut])
def listar_novedades(empleado_id: str | None = None, user: m.Usuario = Depends(current_user), db: Session = Depends(get_session)):
    q = select(m.Novedad).join(m.Empleado, m.Empleado.id == m.Novedad.empleado_id)
    vis = equipos_visibles(user)
    if vis is not None:
        q = q.where(m.Empleado.equipo_id.in_(vis or ["__none__"]))
    if empleado_id:
        q = q.where(m.Novedad.empleado_id == empleado_id)
    return list(db.scalars(q.order_by(m.Novedad.fecha_inicio.desc())))


@router.post("/novedades", response_model=s.NovedadOut, status_code=201)
def crear_novedad(payload: s.NovedadIn, user: m.Usuario = Depends(require_rol("super_admin", "registrador", "lider")), db: Session = Depends(get_session)):
    """Pone una novedad (licencia, descanso…) en un día. Solo sobre gente del propio
    equipo y sobre un período que siga abierto: una novedad suma/quita horas del reporte."""
    _exigir_empleado_visible(db, user, payload.empleado_id)
    if payload.periodo_id:
        per = db.get(m.Periodo, payload.periodo_id)
        if not per:
            raise HTTPException(404, "Período no encontrado.")
        if user.rol != "super_admin" and _estado_periodo(per) != "abierto":
            raise HTTPException(409, "Ese período ya no está abierto.")
    nov = m.Novedad(**payload.model_dump())
    db.add(nov)
    db.commit()
    db.refresh(nov)
    return nov


@router.delete("/novedades/{novedad_id}", status_code=204)
def borrar_novedad(novedad_id: str, user: m.Usuario = Depends(require_rol("super_admin", "registrador", "lider")), db: Session = Depends(get_session)):
    """Quita una novedad/descanso del día (vuelve a "–"). Solo de tu propio equipo."""
    nov = db.get(m.Novedad, novedad_id)
    if nov:
        emp = _exigir_empleado_visible(db, user, nov.empleado_id)
        per = db.get(m.Periodo, nov.periodo_id) if nov.periodo_id else None
        if nov.periodo_id:
            _guardar_cambio(db, nov.periodo_id, user)
        db.delete(nov)
        if per and emp:
            db.flush()
            _reevaluar_flujo_area(db, per, emp.equipo_id, user)  # #3
        db.commit()


# ── Registros de horario ─────────────────────────────────────────────────────
@router.get("/registros", response_model=list[s.RegistroOut])
def listar_registros(
    periodo_id: str | None = None, empleado_id: str | None = None,
    user: m.Usuario = Depends(current_user), db: Session = Depends(get_session),
):
    q = select(m.RegistroHorario).join(m.Empleado, m.Empleado.id == m.RegistroHorario.empleado_id)
    vis = equipos_visibles(user)
    if vis is not None:
        q = q.where(m.Empleado.equipo_id.in_(vis or ["__none__"]))
    if periodo_id:
        q = q.where(m.RegistroHorario.periodo_id == periodo_id)
    if empleado_id:
        q = q.where(m.RegistroHorario.empleado_id == empleado_id)
    return list(db.scalars(q.order_by(m.RegistroHorario.fecha)))


@router.post("/registros", response_model=s.RegistroOut, status_code=201)
def crear_registro(payload: s.RegistroIn, user: m.Usuario = Depends(require_rol("super_admin", "registrador", "lider")), db: Session = Depends(get_session)):
    """Registra un turno por hora de entrada/salida y lo clasifica.

    Validaciones (BD-back-front conversan): el empleado debe existir y estar
    activo; el período debe existir y estar abierto; la fecha debe caer dentro
    del rango del período; el empleado no debe tener novedad ese día.
    """
    emp = _exigir_empleado_visible(db, user, payload.empleado_id)
    if not emp.activo:
        raise HTTPException(404, "Empleado no encontrado o inactivo.")
    if payload.periodo_id:
        per = db.get(m.Periodo, payload.periodo_id)
        if not per:
            raise HTTPException(404, "Período no encontrado.")
        if per.estado == "cerrado":
            raise HTTPException(409, "El período ya está cerrado; usa Solicitud de cambio.")
        if not (per.fecha_inicio <= payload.fecha <= per.fecha_fin):
            raise HTTPException(400, "La fecha está fuera del rango del período.")
        _guardar_cambio(db, payload.periodo_id, user)
    if db.scalar(select(m.Novedad).where(
        m.Novedad.empleado_id == emp.id, m.Novedad.fecha_inicio <= payload.fecha, m.Novedad.fecha_fin >= payload.fecha)):
        raise HTTPException(409, "El empleado tiene una novedad ese día; no se puede registrar horario.")
    # El turno se parte por medianoche (cada tramo cuenta en SU día).
    partes = _partir_medianoche(payload.fecha, payload.hora_inicio, payload.hora_fin)
    # #1 Al AGREGAR un bloque/extra NO se puede pisar horas ya cargadas ese día (no se
    # colocan extras/bloques sobre horario ya trabajado). Al REEMPLAZAR sí (borra el día).
    if not payload.reemplazar:
        def _iv(ini: time, fin: time) -> tuple[float, float]:
            a = ini.hour + ini.minute / 60.0
            b = fin.hour + fin.minute / 60.0
            return a, (b + 24.0 if b <= a else b)
        for f, i, ff in partes:
            na, nb = _iv(i, ff)
            for ex in db.scalars(select(m.RegistroHorario).where(
                    m.RegistroHorario.empleado_id == emp.id, m.RegistroHorario.fecha == f)):
                ea, eb = _iv(ex.hora_inicio, ex.hora_fin)
                if min(nb, eb) - max(na, ea) > 1e-9:
                    raise HTTPException(409, (
                        f"El bloque {i.strftime('%H:%M')}–{ff.strftime('%H:%M')} se cruza con un "
                        f"horario ya cargado ({ex.hora_inicio.strftime('%H:%M')}–{ex.hora_fin.strftime('%H:%M')}). "
                        "Ajusta la hora o edita el turno existente."))
    # #5 Turno partido: reemplazar (borra el día) o AGREGAR otro bloque. NUNCA borra las
    # "colas" de 00:00 (son la continuación del turno del día anterior, viven en este día).
    if payload.reemplazar:
        for prev in db.scalars(select(m.RegistroHorario).where(
                m.RegistroHorario.empleado_id == emp.id, m.RegistroHorario.fecha == payload.fecha,
                m.RegistroHorario.hora_inicio != time(0, 0))):
            db.delete(prev)

    meal_h = (payload.meal_min or 0) / 60.0
    creados: list[m.RegistroHorario] = []

    def _add_bloque(fecha, ini, fin, periodo_id):
        r, segs = _clasificar(emp, fecha, ini, fin, meal_h, payload.is_employee_rest_day)
        reg = m.RegistroHorario(
            empleado_id=emp.id, periodo_id=periodo_id, fecha=fecha,
            hora_inicio=ini, hora_fin=fin, tiempo_alimentacion_h=meal_h,
            duracion_bruta_h=r.gross_hours, duracion_neta_h=r.net_hours,
            tipo_descanso=r.rest_type.value if r.rest_type else None, clasificacion=segs,
            # El motivo solo aplica a bloques AGREGADOS (extras); el turno base no lo lleva.
            motivo=(payload.motivo if not payload.reemplazar else None), estado="pendiente")
        db.add(reg)
        creados.append(reg)

    # El turno se PARTE por medianoche: cada tramo cuenta en SU día (lo de después de
    # las 00:00 pasa al día siguiente, aunque sea de descanso). Cada parte reemplaza la
    # "cola" previa de ese día (para no duplicar al re-guardar).
    for f, i, ff in partes:
        pid = payload.periodo_id
        if f != payload.fecha:
            # La cola cae al día siguiente: puede estar en otro período; reemplaza la cola previa.
            per_f = db.scalar(select(m.Periodo).where(m.Periodo.fecha_inicio <= f, m.Periodo.fecha_fin >= f))
            pid = per_f.id if per_f else None
            for prev in db.scalars(select(m.RegistroHorario).where(
                    m.RegistroHorario.empleado_id == emp.id, m.RegistroHorario.fecha == f,
                    m.RegistroHorario.hora_inicio == time(0, 0))):
                db.delete(prev)
        _add_bloque(f, i, ff, pid)

    if payload.periodo_id:
        db.flush()
        _reclasificar_periodo_emp(db, emp, per)
    db.commit()
    reg0 = creados[0]
    db.refresh(reg0)
    return reg0


@router.delete("/registros/{registro_id}", status_code=204)
def borrar_registro(registro_id: str, user: m.Usuario = Depends(require_rol("super_admin", "registrador", "lider")), db: Session = Depends(get_session)):
    reg = db.get(m.RegistroHorario, registro_id)
    if reg:
        emp = _exigir_empleado_visible(db, user, reg.empleado_id)
        per = db.get(m.Periodo, reg.periodo_id) if reg.periodo_id else None
        if reg.periodo_id:
            _guardar_cambio(db, reg.periodo_id, user)
        db.delete(reg)
        # Borrar un día cambia el acumulado semanal: reclasifica lo que quede (#5).
        if emp and per:
            db.flush()
            _reclasificar_periodo_emp(db, emp, per)
            _reevaluar_flujo_area(db, per, emp.equipo_id, user)  # #3
        db.commit()


# ── Configuración: recargos (RH puede MODIFICAR) ────────────────────────────
@router.get("/config/recargos", response_model=list[s.ConfigRecargoOut])
def config_recargos(_: m.Usuario = Depends(require_rol("super_admin")), db: Session = Depends(get_session)):
    return list(db.scalars(select(m.ConfigRecargo).order_by(m.ConfigRecargo.fecha_desde)))


@router.patch("/config/recargos/{fecha_desde}", response_model=s.ConfigRecargoOut)
def editar_recargo(
    fecha_desde: date, payload: s.ConfigRecargoPatch,
    _: m.Usuario = Depends(require_rol("super_admin")), db: Session = Depends(get_session),
):
    cfg = db.scalar(select(m.ConfigRecargo).where(m.ConfigRecargo.fecha_desde == fecha_desde))
    if not cfg:
        raise HTTPException(404, "Vigencia no encontrada.")
    for k, v in payload.model_dump(exclude_none=True).items():
        setattr(cfg, k, v)
    db.commit()
    db.refresh(cfg)
    return cfg


@router.post("/normativa/investigar")
def investigar_normativa(user: m.Usuario = Depends(require_rol("super_admin")), db: Session = Depends(get_session)):
    """#3 Pipeline de investigación normativa: revisa (en el momento) si hay cambios
    en la norma y deja el resultado como notificación. Límite: 1 por día y 3 por
    semana. Hoy las vigencias están al día → 'sin novedades'."""
    ahora = m.ahora_bogota()
    hoy0 = ahora.replace(hour=0, minute=0, second=0, microsecond=0)
    hace7 = ahora - timedelta(days=7)
    hoy_n = db.scalar(select(func.count()).select_from(m.InvestigacionNormativa)
                      .where(m.InvestigacionNormativa.creado_en >= hoy0)) or 0
    if hoy_n >= 1:
        raise HTTPException(429, "La investigación normativa ya se ejecutó hoy. Máximo 1 por día.")
    sem_n = db.scalar(select(func.count()).select_from(m.InvestigacionNormativa)
                      .where(m.InvestigacionNormativa.creado_en >= hace7)) or 0
    if sem_n >= 3:
        raise HTTPException(429, "Se alcanzó el máximo de 3 investigaciones por semana. Intenta la próxima semana.")
    # Investigación REAL contra el calendario de vigencias del sistema (jornada y
    # recargos): dice qué rige hoy y cuál es el PRÓXIMO cambio con su fecha (#3).
    hoy_d = ahora.date()
    vigs = list(db.scalars(select(m.ConfigRecargo).order_by(m.ConfigRecargo.fecha_desde)))
    actuales = [v for v in vigs if v.fecha_desde <= hoy_d]
    act = actuales[-1] if actuales else (vigs[0] if vigs else None)
    futuras = [v for v in vigs if v.fecha_desde > hoy_d]
    lineas = []
    if act:
        lineas.append(
            f"Vigente hoy ({act.fecha_desde.isoformat()}): jornada máx "
            f"{int(act.jornada_max_semanal_h)} h/sem · recargo dominical/festivo "
            f"{int(act.recargo_dia_descanso * 100)}% · nocturno {int(act.recargo_nocturna_h * 100)}%.")
    hallazgo = False
    if futuras:
        prox = futuras[0]
        faltan = (prox.fecha_desde - hoy_d).days
        lineas.append(
            f"Próximo cambio: {prox.fecha_desde.isoformat()} (en {faltan} días) → jornada "
            f"{int(prox.jornada_max_semanal_h)} h/sem · dominical/festivo "
            f"{int(prox.recargo_dia_descanso * 100)}%.")
        hallazgo = faltan <= 60
    else:
        lineas.append("No hay más cambios normativos registrados hacia adelante.")
    lineas.append("Base: CST + Ley 2466/2025 (Función Pública). El monitoreo automático en vivo "
                  "de la fuente oficial se activa en el despliegue con la integración de búsqueda.")
    resultado = " ".join(lineas)
    db.add(m.InvestigacionNormativa(resultado=resultado))
    db.add(m.Notificacion(rol_destino="super_admin", tipo="CAMBIO_NORMATIVO",
                          titulo="Investigación normativa completada",
                          descripcion=resultado))
    db.commit()
    return {"resultado": resultado, "hallazgo": hallazgo}


# ── Datos de apoyo ──────────────────────────────────────────────────────────
@router.get("/festivos", response_model=list[s.FestivoOut])
def listar_festivos(
    anio_desde: int = 2026, anio_hasta: int = 2029,
    _: m.Usuario = Depends(current_user), db: Session = Depends(get_session),
):
    """Festivos para el rango de años. Base: cálculo Ley Emiliani + excepciones de TH."""
    excepciones = db.scalars(
        select(m.FestivoExcepcion)
        .where(m.FestivoExcepcion.fecha >= date(anio_desde, 1, 1),
               m.FestivoExcepcion.fecha <= date(anio_hasta, 12, 31)),
    ).all()
    quitar = {e.fecha for e in excepciones if e.tipo == "quitar"}
    agregar = {e.fecha: (e.motivo or "Festivo especial") for e in excepciones if e.tipo == "agregar"}

    resultado = [
        {"nombre": n, "fecha_descanso": f}
        for y in range(anio_desde, anio_hasta + 1)
        for f, n in festivos_colombia(y)
        if f not in quitar
    ] + [{"nombre": nombre, "fecha_descanso": f} for f, nombre in agregar.items()]
    return sorted(resultado, key=lambda x: x["fecha_descanso"])


@router.get("/admin/festivos/excepciones", response_model=list[s.FestivoExcepcionOut])
def listar_excepciones(_: m.Usuario = Depends(require_rol("super_admin")), db: Session = Depends(get_session)):
    """Excepciones que TH agregó al calendario calculado."""
    return db.scalars(select(m.FestivoExcepcion).order_by(m.FestivoExcepcion.fecha)).all()


@router.post("/admin/festivos/excepciones", response_model=s.FestivoExcepcionOut, status_code=201)
def crear_excepcion(
    payload: s.FestivoExcepcionIn,
    user: m.Usuario = Depends(require_rol("super_admin")),
    db: Session = Depends(get_session),
):
    """Agrega o quita un festivo puntual (p. ej. decreto especial, cambio de ley)."""
    if payload.tipo not in ("agregar", "quitar"):
        raise HTTPException(400, "tipo debe ser 'agregar' o 'quitar'.")
    if db.scalar(select(m.FestivoExcepcion).where(m.FestivoExcepcion.fecha == payload.fecha)):
        raise HTTPException(409, f"Ya existe una excepción para {payload.fecha}.")
    exc = m.FestivoExcepcion(fecha=payload.fecha, tipo=payload.tipo,
                              motivo=payload.motivo, creado_por=user.id)
    db.add(exc)
    db.commit()
    db.refresh(exc)
    return exc


@router.delete("/admin/festivos/excepciones/{excepcion_id}", status_code=204)
def borrar_excepcion(
    excepcion_id: str,
    _: m.Usuario = Depends(require_rol("super_admin")),
    db: Session = Depends(get_session),
):
    """Elimina una excepción (restaura el festivo calculado)."""
    exc = db.get(m.FestivoExcepcion, excepcion_id)
    if not exc:
        raise HTTPException(404, "Excepción no encontrada.")
    db.delete(exc)
    db.commit()


@router.get("/notificaciones", response_model=list[s.NotificacionOut])
def listar_notificaciones(user: m.Usuario = Depends(current_user), db: Session = Depends(get_session)):
    """Las notificaciones con `usuario_id` son PERSONALES (las solicitudes que le llegan a
    quien TH designó); las demás siguen siendo para todo el rol."""
    q = select(m.Notificacion).where(
        m.Notificacion.rol_destino == user.rol,
        (m.Notificacion.usuario_id == user.id) | (m.Notificacion.usuario_id.is_(None)),
    )
    if user.equipo_id:
        q = q.where((m.Notificacion.equipo_id == user.equipo_id) | (m.Notificacion.equipo_id.is_(None)))
    return list(db.scalars(q.order_by(m.Notificacion.creado_en.desc())))


@router.post("/notificaciones/{notif_id}/leida", status_code=204)
def marcar_leida(notif_id: str, user: m.Usuario = Depends(current_user), db: Session = Depends(get_session)):
    """Solo tus propias notificaciones: antes cualquiera podía marcarle como leída un aviso
    a TH y ocultárselo."""
    n = db.get(m.Notificacion, notif_id)
    if not n:
        return
    if n.rol_destino != user.rol or (n.usuario_id and n.usuario_id != user.id):
        raise HTTPException(403, "Esa notificación no es tuya.")
    if user.equipo_id and n.equipo_id and n.equipo_id != user.equipo_id:
        raise HTTPException(403, "Esa notificación no es tuya.")
    n.leida = True
    db.commit()


@router.get("/dashboard")
def dashboard(user: m.Usuario = Depends(current_user), db: Session = Depends(get_session)) -> dict:
    """Agregados para gráficas: horas por categoría, por equipo y fuerza laboral."""
    vis = equipos_visibles(user)

    eq_q = select(m.Equipo).where(m.Equipo.activo)
    emp_q = select(m.Empleado).where(m.Empleado.activo, m.Empleado.lleva_horario)  # solo quien lleva horario
    reg_q = select(m.RegistroHorario).join(m.Empleado, m.Empleado.id == m.RegistroHorario.empleado_id)
    if vis is not None:
        eq_q = eq_q.where(m.Equipo.id.in_(vis or ["__none__"]))
        emp_q = emp_q.where(m.Empleado.equipo_id.in_(vis or ["__none__"]))
        reg_q = reg_q.where(m.Empleado.equipo_id.in_(vis or ["__none__"]))

    empleados = list(db.scalars(emp_q))
    registros = list(db.scalars(reg_q))
    # Solo áreas donde alguien lleva horario: Talento Humano usa la herramienta pero no
    # reporta horas, así que no cuenta como área del período ni se le pide reporte.
    con_horario = {e.equipo_id for e in empleados}
    equipos = [e for e in db.scalars(eq_q) if e.id in con_horario]

    eq_nombre = {e.id: e.nombre for e in equipos}
    emp_equipo = {e.id: e.equipo_id for e in empleados}

    por_categoria = {c: 0.0 for c in _CATEGORIAS}
    horas_equipo: dict[str, float] = {e.id: 0.0 for e in equipos}
    for r in registros:
        for sg in (r.clasificacion or []):
            if sg["category"] in por_categoria:
                por_categoria[sg["category"]] = round(por_categoria[sg["category"]] + sg["hours"], 1)
        eqid = emp_equipo.get(r.empleado_id)
        if eqid in horas_equipo:
            horas_equipo[eqid] = round(horas_equipo[eqid] + r.duracion_neta_h, 1)

    por_jornada: dict[str, int] = {}
    emp_por_equipo: dict[str, int] = {e.id: 0 for e in equipos}
    for e in empleados:
        por_jornada[e.tipo_jornada] = por_jornada.get(e.tipo_jornada, 0) + 1
        if e.equipo_id in emp_por_equipo:
            emp_por_equipo[e.equipo_id] += 1

    # Horas netas por EMPLEADO con el DESGLOSE por tipo (#2): ordinarias, recargos
    # (nocturno), extras y festivas/dominicales. Cuenta TODO lo cargado (no se corta
    # a hoy) para que cuadre con lo que muestra el detalle del empleado (#1).
    def _bucket(cat: str) -> str:
        if cat.startswith("EXT"):
            # #2 Extra "plana" (diurna 25%) vs extra CON recargo (nocturna/dom/fes).
            return "extras" if cat == "EXT_DIUR_REG" else "extras_rec"
        if cat.endswith("_DESC"):
            return "domfes"
        if cat == "ORD_NOCT_REG":
            return "recargos"
        return "ordinarias"

    horas_emp: dict[str, float] = {e.id: 0.0 for e in empleados}
    desglose_emp: dict[str, dict[str, float]] = {
        e.id: {"ordinarias": 0.0, "recargos": 0.0, "extras": 0.0, "extras_rec": 0.0, "domfes": 0.0} for e in empleados}
    # #1 Desglose FINO por las 8 categorías (diurna/nocturna × ordinaria/extra × normal/
    # festivo-dominical) para verlo segregado en el resumen.
    cats_emp: dict[str, dict[str, float]] = {e.id: {c: 0.0 for c in _CATEGORIAS} for e in empleados}
    for r in registros:
        if r.empleado_id in horas_emp:
            horas_emp[r.empleado_id] = round(horas_emp[r.empleado_id] + r.duracion_neta_h, 1)
            for sg in (r.clasificacion or []):
                b = _bucket(sg["category"])
                desglose_emp[r.empleado_id][b] = round(desglose_emp[r.empleado_id][b] + sg["hours"], 1)
                if sg["category"] in cats_emp[r.empleado_id]:
                    cats_emp[r.empleado_id][sg["category"]] = round(cats_emp[r.empleado_id][sg["category"]] + sg["hours"], 1)

    # AJUSTES DE TH: las "horas cargadas" que ven líderes y registradores salen YA con el
    # ajuste aplicado (igual que el reporte a Financiera). La grilla día a día no cambia;
    # el porqué del ajuste queda en la nota de Consolidado y chat.
    for a in db.scalars(select(m.AjusteReporte)):
        if a.empleado_id not in horas_emp:
            continue   # fuera del alcance del usuario (otro equipo)
        horas_emp[a.empleado_id] = round(horas_emp[a.empleado_id] + a.horas, 1)
        desglose_emp[a.empleado_id][_bucket(a.categoria)] = round(
            desglose_emp[a.empleado_id][_bucket(a.categoria)] + a.horas, 1)
        if a.categoria in cats_emp[a.empleado_id]:
            cats_emp[a.empleado_id][a.categoria] = round(cats_emp[a.empleado_id][a.categoria] + a.horas, 1)
        if a.categoria in por_categoria:
            por_categoria[a.categoria] = round(por_categoria[a.categoria] + a.horas, 1)
        _eq = emp_equipo.get(a.empleado_id)
        if _eq in horas_equipo:
            horas_equipo[_eq] = round(horas_equipo[_eq] + a.horas, 1)

    # #3 Horas por SEMANA (del período abierto). La semana puede ir partida entre
    # períodos: aquí solo cuenta la parte de este período.
    per_abierto = db.scalar(select(m.Periodo).where(m.Periodo.estado == "abierto").order_by(m.Periodo.fecha_inicio))
    sem_map, sem_meta = _semanas_de_periodo(per_abierto) if per_abierto else ({}, [])
    sem_emp: dict[str, dict[int, float]] = {e.id: {} for e in empleados}
    if per_abierto:
        for r in registros:
            if r.empleado_id in sem_emp and r.periodo_id == per_abierto.id:
                nsem = sem_map.get(r.fecha.isocalendar()[:2])
                if nsem:
                    sem_emp[r.empleado_id][nsem] = round(sem_emp[r.empleado_id].get(nsem, 0.0) + r.duracion_neta_h, 1)

    total_horas = round(sum(r.duracion_neta_h for r in registros), 1)
    horas_extra = round(sum(
        sg["hours"] for r in registros for sg in (r.clasificacion or []) if sg["category"].startswith("EXT")
    ), 1)
    horas_recargo = round(sum(
        sg["hours"] for r in registros for sg in (r.clasificacion or [])
        if sg["category"] not in ("ORD_DIUR_REG",)
    ), 1)

    return {
        "kpis": {
            "empleados": len(empleados), "equipos": len(equipos),
            "total_horas": total_horas, "horas_extra": horas_extra, "horas_con_recargo": horas_recargo,
        },
        "por_categoria": [{"categoria": c, "horas": por_categoria[c]} for c in _CATEGORIAS if por_categoria[c] > 0],
        "por_equipo": [{"equipo": eq_nombre[e.id], "horas": horas_equipo[e.id], "empleados": emp_por_equipo[e.id]} for e in equipos],
        "semanas_periodo": sem_meta,
        "por_empleado": [{"empleado": e.nombre, "equipo": eq_nombre.get(e.equipo_id, ""), "horas": horas_emp[e.id],
                          "tipo": e.tipo_jornada, "reporta": bool(e.reporta), **desglose_emp[e.id],
                          "cats": cats_emp[e.id],
                          "semanas": [round(sem_emp[e.id].get(sm["n"], 0.0), 1) for sm in sem_meta]}
                         for e in sorted(empleados, key=lambda x: x.nombre)],
        "fuerza_laboral": [{"tipo": k, "n": v} for k, v in por_jornada.items()],
    }


def _faltan_dias_area(db: Session, per: m.Periodo, equipo_id: str) -> int:
    """Días laborables (sin el descanso semanal) sin turno/licencia/descanso."""
    emps = list(db.scalars(select(m.Empleado).where(m.Empleado.activo, m.Empleado.equipo_id == equipo_id)))
    if not emps:
        return 0
    dias = [per.fecha_inicio + timedelta(days=i) for i in range((per.fecha_fin - per.fecha_inicio).days + 1)]
    emp_ids = [e.id for e in emps]
    regs = list(db.scalars(select(m.RegistroHorario).where(
        m.RegistroHorario.periodo_id == per.id, m.RegistroHorario.empleado_id.in_(emp_ids))))
    novs = list(db.scalars(select(m.Novedad).where(
        m.Novedad.empleado_id.in_(emp_ids),
        m.Novedad.fecha_inicio <= per.fecha_fin, m.Novedad.fecha_fin >= per.fecha_inicio)))
    cubierto = {(r.empleado_id, r.fecha) for r in regs}
    for n in novs:
        d = max(n.fecha_inicio, per.fecha_inicio)
        while d <= min(n.fecha_fin, per.fecha_fin):
            cubierto.add((n.empleado_id, d)); d += timedelta(days=1)
    total = 0
    for e in emps:
        descanso = _DIAS.get((e.dia_descanso or "").lower(), 6)
        total += sum(1 for d in dias if (e.id, d) not in cubierto and d.weekday() != descanso)
    return total


@router.post("/recordatorios/enviar")
def enviar_recordatorios(_: m.Usuario = Depends(require_rol("super_admin")), db: Session = Depends(get_session)) -> dict:
    """Recordatorios INTELIGENTES por correo a registradores y líderes (#4).

    Solo se avisa a las áreas que AÚN no cumplieron su parte: las que ya validó el
    líder o que ya están en TH/aprobadas NO se molestan. Según el estado:
      · le faltan días → recuerda cuántos faltan;
      · completa pero sin enviar → recuerda enviarla a validación;
      · ya con el líder → recuerda validar.
    El envío real usa SMTP (variables de entorno); sin SMTP se registra en el log y
    se crea la notificación en la app.
    """
    per = db.scalar(select(m.Periodo).where(m.Periodo.estado == "abierto").order_by(m.Periodo.fecha_inicio))
    if not per:
        return {"enviados": 0, "detalle": [], "smtp": smtp_configurado(), "mensaje": "No hay período abierto."}
    areas = list(db.scalars(select(m.Equipo).where(m.Equipo.activo).order_by(m.Equipo.nombre)))
    pes = {pe.equipo_id: pe for pe in db.scalars(
        select(m.PeriodoEquipo).where(m.PeriodoEquipo.periodo_id == per.id))}
    detalle: list[dict] = []
    enviados = 0
    for area in areas:
        flujo = pes[area.id].estado_flujo if area.id in pes else "registro"
        if flujo in ("validado", "en_th", "aprobado"):
            continue  # ya cumplieron su parte: no se les molesta (inteligente).
        faltan = _faltan_dias_area(db, per, area.id)
        if flujo == "pend_validacion":
            rol_dest, accion = "lider", "validar los horarios que ya te enviaron"
            asunto = f"[{area.nombre}] Pendiente: validar horarios de {per.nombre}"
        elif faltan > 0:
            rol_dest, accion = "registrador", f"cargar {faltan} día(s) que faltan"
            asunto = f"[{area.nombre}] Te faltan {faltan} día(s) por cargar en {per.nombre}"
        else:
            rol_dest, accion = "registrador", "enviar el área a validación del líder (ya está completa)"
            asunto = f"[{area.nombre}] Lista para enviar a validación: {per.nombre}"
        cuerpo = (f"Hola,\n\nRecordatorio del período {per.nombre} "
                  f"({per.fecha_inicio} a {per.fecha_fin}). Debes {accion}.\n"
                  f"Fecha de corte (reporte a Talento Humano): {per.fecha_corte}.\n\n"
                  f"Ingresa a Jornada Laboral para completarlo.\n")
        roles = ["lider"] if rol_dest == "lider" else ["registrador", "lider"]
        correos: list[str] = []
        for u in db.scalars(select(m.Usuario).where(
                m.Usuario.equipo_id == area.id, m.Usuario.rol.in_(roles))):
            enviar_correo(u.email, asunto, cuerpo)
            correos.append(u.email)
        db.add(m.Notificacion(rol_destino=rol_dest, equipo_id=area.id, tipo="RECORDATORIO_ENTREGA",
                              titulo=asunto, descripcion=cuerpo.split("\n\n")[0]))
        enviados += len(correos)
        detalle.append({"area": area.nombre, "accion": accion, "faltan": faltan, "correos": correos})
    db.commit()
    return {"enviados": enviados, "detalle": detalle, "smtp": smtp_configurado()}


@router.get("/resumen")
def resumen(user: m.Usuario = Depends(current_user), db: Session = Depends(get_session)) -> dict:
    vis = equipos_visibles(user)

    def _scoped(model, join_emp=False, by_id=False):
        q = select(model)
        if join_emp:
            q = q.join(m.Empleado, m.Empleado.id == model.empleado_id)
        if vis is not None:
            col = model.id if by_id else (m.Empleado.equipo_id if join_emp else getattr(model, "equipo_id", None))
            if col is not None:
                q = q.where(col.in_(vis or ["__none__"]))
        return len(list(db.scalars(q)))

    return {
        "rol": user.rol,
        "equipos": _scoped(m.Equipo, by_id=True),
        "empleados": _scoped(m.Empleado),
        "periodos": _scoped(m.Periodo),
        "registros": _scoped(m.RegistroHorario, join_emp=True),
        "novedades": _scoped(m.Novedad, join_emp=True),
    }
