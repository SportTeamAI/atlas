"""Siembra de datos demo para el MVP (todo inventado, sin datos reales).

3 roles (RH, registrador, líder), catálogo de turnos, empleados con tipo de
contrato y turno asignado, un período abierto, festivos, vigencias y
notificaciones (incluido un recordatorio de fecha de entrega).
"""

from __future__ import annotations

from datetime import date, time

from sqlalchemy import select
from sqlalchemy.orm import Session

from jornada.domain.algorithms.classifier import classify_shift
from jornada.domain.algorithms.recargos import DEFAULT_VIGENCIAS
from jornada.domain.enums import JornadaType
from jornada.domain.festivos import FESTIVOS_2026, es_festivo
from jornada.domain.labels import category_label
from jornada.infrastructure.db import models as m
from jornada.infrastructure.db.database import Base, SessionLocal, engine


def _clasificar(*, work_date, start, end, jornada, daily_limit, meal_h, rest_day):
    r = classify_shift(
        work_date=work_date, start=start, end=end, jornada=JornadaType(jornada),
        daily_limit=daily_limit, meal_hours=meal_h, is_holiday=es_festivo(work_date),
        is_employee_rest_day=rest_day,
    )
    segs = [
        {"category": s.category.value, "label": category_label(s.category, r.rest_type),
         "hours": s.hours, "recargo_pct": round(s.recargo * 100, 1)}
        for s in r.segments
    ]
    return r, segs


def inicializar_herramientas() -> None:
    """Asegura que el catálogo de herramientas (kairos, pronos) exista. Idempotente."""
    with SessionLocal() as db:
        if db.scalar(select(m.Herramienta).limit(1)) is not None:
            return
        db.add_all([
            m.Herramienta(
                slug="kairos", nombre="Kairos",
                descripcion="Gestión de horas y horarios para nómina.",
                ruta="/kairos/", roles=["super_admin", "lider", "registrador"],
                activa=True, orden=1,
            ),
            m.Herramienta(
                slug="pronos", nombre="Pronos",
                descripcion="Presupuestos y proyecciones de costos y gastos.",
                ruta="/pronos/", roles=["super_admin", "analista"],
                activa=True, orden=2,
            ),
        ])
        db.commit()


def seed_si_vacio() -> None:
    """Crea las tablas y siembra datos demo solo si la BD está vacía."""
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        if db.scalar(select(m.Usuario).limit(1)) is not None:
            return
        _sembrar(db)
        db.commit()


def _sembrar(db: Session) -> None:
    # Vigencias de recargos.
    for v in DEFAULT_VIGENCIAS:
        db.add(m.ConfigRecargo(
            fecha_desde=v.fecha_desde, recargo_nocturna_h=v.recargo_nocturna,
            recargo_extra_diurna=v.recargo_extra_diurna, recargo_extra_nocturna=v.recargo_extra_nocturna,
            recargo_dia_descanso=v.recargo_dia_descanso, jornada_max_semanal_h=v.jornada_max_semanal,
        ))

    # Festivos 2026.
    for f, nombre in FESTIVOS_2026:
        db.add(m.Festivo(anio=2026, nombre=nombre, fecha_descanso=f))

    # ── Áreas reales (4) ─────────────────────────────────────────────────────
    # Alimentación por área (#4/#6): todas 1 h (60 min) salvo Servicio al Cliente (30 min).
    eq_ops = m.Equipo(nombre="Operaciones Comerciales", descripcion="Gestión de servicios comerciales", almuerzo_min=60)
    eq_inc = m.Equipo(nombre="Incidentes", descripcion="Analistas de tecnología", almuerzo_min=60)
    eq_rie = m.Equipo(nombre="Riesgos", descripcion="Gestión de servicios a riesgos", almuerzo_min=60)
    eq_sac = m.Equipo(nombre="Servicio al Cliente", descripcion="Atención al cliente", almuerzo_min=30, almuerzo_siempre=True)
    eq_dep = m.Equipo(nombre="Deportivas", descripcion="Analistas de deportivas", almuerzo_min=60)
    db.add_all([eq_ops, eq_inc, eq_rie, eq_sac, eq_dep])
    db.flush()

    # Turnos REALES (#4). Un horario repetido NO se duplica: es UN turno con la
    # lista de áreas que lo usan (#2). El almuerzo es 60 min; SAC descuenta 30 min
    # SIEMPRE por regla de área (Equipo.almuerzo_siempre), así que el mismo turno
    # sirve para SAC y para las demás. Ese tiempo se descuenta de las 42/44 (extras)
    # pero SÍ cuenta para recargos (#4.6).
    def _t(nombre, letra, ini, fin, equipos, alm=60):
        return m.Turno(nombre=nombre, abreviatura=letra, hora_inicio=ini, hora_fin=fin,
                       almuerzo_min=alm, equipos_ids=[e.id for e in equipos])
    db.add_all([
        _t("Mañana 6-3", "T63", time(6, 0), time(15, 0), [eq_dep]),
        _t("Oficina 8-5", "T85", time(8, 0), time(17, 0), [eq_dep, eq_inc, eq_sac, eq_ops]),
        _t("Oficina 9-6", "T96", time(9, 0), time(18, 0), [eq_dep, eq_sac]),
        _t("Diurno 8-4", "T84", time(8, 0), time(16, 0), [eq_inc, eq_rie]),
        _t("Tarde 2-10", "T210", time(14, 0), time(22, 0), [eq_inc]),
        _t("Mañana 6-2", "T62", time(6, 0), time(14, 0), [eq_inc, eq_sac]),
        _t("Nocturno 10-6", "T106", time(22, 0), time(6, 0), [eq_inc]),
        _t("Tarde 3-11", "T311", time(15, 0), time(23, 0), [eq_rie]),
        _t("Noche 7-2", "T72", time(19, 0), time(2, 0), [eq_rie]),
        _t("Tarde 1-9", "T19", time(13, 0), time(21, 0), [eq_sac]),
        _t("Noche 6-2", "T62N", time(18, 0), time(2, 0), [eq_sac]),
    ])

    D = "@virtualsoft.tech"
    # ── Empleados por área: (cédula, nombre, correo) ─────────────────────────
    EMPLEADOS_OPS = [
        ("1066575892", "Yeiner Jaraba Zapata", "yeiner.jaraba"),
        ("1007285999", "Cristian David Rendon Jaramillo", "cristian.rendon"),
        ("1036668935", "Alejandra Tirado Montoya", "alejandra.tirado"),
        ("1127619603", "Liz Carolina Carvajal Ponce", "liz.carvajal"),
        ("1085347167", "Robert Guerrero Perez", "robert.guerrero"),
        ("1067287443", "Monica Zapata Cardona", "monica.zapata"),
        ("1000889286", "Osmey Eduardo Perez Arango", "osmey.perez"),
    ]
    EMPLEADOS_INC = [
        ("1000206608", "Alejandro García Montoya", "alejandro.garcia"),
        ("1000760934", "Mariana Hernández Cortes", "mariana.hernandez"),
        ("78750380", "Jose Alejandro Segrera Vanegas", "jose.segrera"),
        ("1152685501", "Katerine Martínez Luna", "katerine.martinez"),
        ("1193459130", "Juan Camilo Torres Esteban", "juan.torres"),
        ("1001370660", "Gabriel Andres Carmona Carmona", "gabriel.carmona"),
        ("1025642587", "Yulian David Taborda Zapata", "yulian.taborda"),
        ("1037502039", "Laura Cristina Molina Estrada", "laura.molina"),
        ("1001420969", "Samuel Soto Giraldo", "samuel.soto"),
        ("1042709573", "Jorge Armando Lezcano Baena", "jorge.lezcano"),
        ("7005495", "Deivys Eduardo Millán Reyes", "deivys.millan"),
    ]
    EMPLEADOS_RIE = [
        ("1234989442", "Marilyn Alejandra Jimenez Diosa", "marilyn.jimenez"),
        ("1034917796", "Juan Jose Diaz Alvarez", "juan.diaz"),
        ("1001748731", "Alexander Villada Berrio", "alexander.villada"),
        ("1017255664", "Sebastián Arango Lazcano", "sebastian.arango"),
        ("1035428495", "Sebastián Hincapié Arias", "sebastian.hincapie"),
        ("1003292456", "Oriana Borja Romero", "oriana.borja"),
        ("1001289541", "Daniel Felipe Benavides Chaguala", "daniel.benavides"),
        ("1040573331", "Josue Alvarez Uribe", "josue.alvarez"),
        ("1037574291", "Yefferson Giraldo Tamayo", "yefferson.giraldo"),
        ("1039760426", "Maria Alejandra Sánchez Londoño", "maria.sanchez"),
        ("1039760901", "Sara Santamaria Foronda", "sara.santamaria"),
    ]
    EMPLEADOS_SAC = [
        ("1000901296", "Sebastian Agudelo Gaviria", "sebastian.agudelo"),
        ("1036424250", "Durley Manuela Aguirre Bonilla", "manuela.aguirre"),
        ("1018223781", "Juan Camilo Cassiani Padilla", "juan.cassiani"),
        ("1039759686", "Yeni Tatiana Cañola Rios", "yeni.canola"),
        ("1040200950", "Sebastian Durango Garcia", "sebastian.durango"),
        ("1001004331", "Andrea Euse Martinez", "andrea.euse"),
        ("32242987", "Yessica Maria Giraldo Tamayo", "yessica.giraldo"),
        ("1253693", "Andres Gonzalez Irigoyen", "andres.gonzalez"),
        ("1001540146", "Carolina Herrera Zuleta", "carolina.herrera"),
        ("1019084000", "Grecia Yeanneth Martinez Olarte", "grecia.martinez"),
        ("1128419506", "Juan Esteban Mazo", "juan.mazo"),
        ("1003434847", "Daniela Andrea Oviedo Dominguez", "daniela.oviedo"),
        ("1129807858", "Ximena Vanessa Oviedo Dominguez", "ximena.oviedo"),
        ("1000873761", "Manuela Rodriguez Uribe", "manuela.rodriguez"),
        ("1001228905", "Mariana Vanegas Pineda", "mariana.vanegas"),
        ("1007945621", "Ivan Dario Muñoz Martinez", "ivan.munoz"),
        ("1001468585", "Daniela Quinchía Zuluaga", "daniela.quinchia"),
        ("1040200528", "Marisa Sanchez Bermudez", "marisa.sanchez"),
    ]

    # Deportivas (#6): equipo real. Líder Edwin Cifuentes; registra Pablo Botero.
    EMPLEADOS_DEP = [
        ("1003336668", "Carpio Martinez Dany Esther", "dany.carpio"),
        ("1037525137", "Duque Mesa Johan Sebastian", "sebastian.duque"),
        ("1037608817", "Panchana Villada Jose Jhonatan", "jose.panchana"),
        ("1039706553", "Coronado Bustos Laura Valentina", "laura.coronado"),
        ("1000412207", "Pablo Botero Baena", "pablo.botero"),
        ("1035302661", "Edwin Ramiro Cifuentes Quintero", "edwin.cifuentes"),
    ]

    CARGO = {
        eq_ops.id: "Gestor de Servicios Comerciales",
        eq_inc.id: "Analista de Tecnología",
        eq_rie.id: "Gestor de Servicios a Riesgos",
        eq_sac.id: "Auxiliar de Servicio al Cliente",
        eq_dep.id: "Gestor de Servicios Comerciales",
    }
    # Cargo por empleado cuando difiere del cargo por defecto de su área (Deportivas).
    CARGO_EMP = {
        "1000412207": "Analista Comercial",       # Pablo Botero (registra)
        "1035302661": "Líder de Deportivas",       # Edwin Cifuentes (líder)
    }
    # Los líderes también son empleados (#8). Se agregan a su área.
    EMPLEADOS_OPS.append(("1152198241", "Yenny Cristina Estrada Rudas", "cristina.estrada"))
    EMPLEADOS_RIE.append(("1039761775", "Camilo Espinosa Ibarra", "camilo.espinosa"))
    EMPLEADOS_SAC.append(("1193030707", "Manuela Espinosa Ibarra", "manuela.espinosa"))
    # Liderazgo por cédula. Deivys es líder Y reporta (#2). Edwin lidera Deportivas.
    LIDER = {"1152198241", "1039761775", "1193030707", "7005495", "1035302661"}
    REPORTA = {
        "7005495",     # Deivys Millán (líder que reporta, Incidentes)
        "1066575892",  # Yeiner Jaraba (Operaciones)
        "1039760901",  # Sara Santamaria (Riesgos)
        "1039760426",  # Maria Alejandra Sánchez (Riesgos)
        "1129807858",  # Ximena Oviedo (SAC)
        "1000412207",  # Pablo Botero (registra Deportivas)
    }
    empleados: list[m.Empleado] = []
    for eq, lista in [(eq_ops, EMPLEADOS_OPS), (eq_inc, EMPLEADOS_INC),
                      (eq_rie, EMPLEADOS_RIE), (eq_sac, EMPLEADOS_SAC), (eq_dep, EMPLEADOS_DEP)]:
        for ced, nom, correo in lista:
            empleados.append(m.Empleado(
                cedula=ced, nombre=nom, email=f"{correo}{D}", cargo=CARGO_EMP.get(ced, CARGO[eq.id]), equipo_id=eq.id,
                rol_operativo="lider" if ced in LIDER else "colaborador", reporta=ced in REPORTA,
                tipo_contrato="indefinido", tipo_jornada="estandar",
                jornada_horas_dia=8, jornada_horas_semana=44, dia_descanso="domingo"))
    db.add_all(empleados)
    db.flush()

    # ── Usuarios: RH + líderes + registradores por área ──────────────────────
    # Correos de líderes provisionales (pendientes de confirmar con el cliente).
    rh = m.Usuario(nombre="Talento Humano", email="rh@demo.co", rol="super_admin")
    # Líderes por área. Deivys (Incidentes) usa lider@demo.co para el switcher
    # (es el líder real de Incidentes; no hay un "líder demo" aparte — #11).
    lid_ops = m.Usuario(nombre="Yenny Cristina Estrada Rudas", email="cristina.estrada" + D, rol="lider", equipo_id=eq_ops.id)
    lid_inc = m.Usuario(nombre="Deivys Millán", email="lider@demo.co", rol="lider", equipo_id=eq_inc.id)
    lid_rie = m.Usuario(nombre="Camilo Espinosa Ibarra", email="camilo.espinosa" + D, rol="lider", equipo_id=eq_rie.id)
    lid_sac = m.Usuario(nombre="Manuela Espinosa Ibarra", email="manuela.espinosa" + D, rol="lider", equipo_id=eq_sac.id)
    lid_dep = m.Usuario(nombre="Edwin Ramiro Cifuentes Quintero", email="edwin.cifuentes" + D, rol="lider", equipo_id=eq_dep.id)
    # Registradores por área. Yeiner (Operaciones) usa registrador@demo.co.
    reg_ops = m.Usuario(nombre="Yeiner Jaraba", email="registrador@demo.co", rol="registrador", equipo_id=eq_ops.id)
    reg_rie1 = m.Usuario(nombre="Sara Santamaria", email="sara.santamaria" + D, rol="registrador", equipo_id=eq_rie.id)
    reg_rie2 = m.Usuario(nombre="Maria Alejandra Sánchez", email="maria.sanchez" + D, rol="registrador", equipo_id=eq_rie.id)
    reg_sac = m.Usuario(nombre="Ximena Oviedo", email="ximena.oviedo" + D, rol="registrador", equipo_id=eq_sac.id)
    reg_dep = m.Usuario(nombre="Pablo Botero Baena", email="pablo.botero" + D, rol="registrador", equipo_id=eq_dep.id)
    db.add_all([rh, lid_ops, lid_inc, lid_rie, lid_sac, lid_dep, reg_ops, reg_rie1, reg_rie2, reg_sac, reg_dep])
    db.flush()

    # Líder de cada área.
    eq_ops.lider_id = lid_ops.id
    eq_inc.lider_id = lid_inc.id
    eq_rie.lider_id = lid_rie.id
    eq_sac.lider_id = lid_sac.id
    eq_dep.lider_id = lid_dep.id
    # Equipo de referencia para notificaciones demo.
    eq_ventas = eq_inc

    # La app ARRANCA el 1 de julio 2026: se generan solo los ciclos de julio a
    # diciembre (quincenas 13–24). No hay períodos del semestre pasado.
    from jornada.domain.nomina.calendario import generar_ciclos, secuencia_quincena
    periodo = None
    hoy = date(2026, 7, 6)  # "hoy" del demo = corte de la 1.ª quincena de julio (NM1QJulio26 abierta)
    for c in generar_ciclos(2026, 7, 1, 2026, 12, 2):
        estado = "abierto" if c.fecha_inicio <= hoy <= c.fecha_fin else "programado"
        p = m.Periodo(nombre=c.nombre, quincena=c.quincena, secuencia=secuencia_quincena(c.mes, c.quincena),
                      fecha_inicio=c.fecha_inicio, fecha_fin=c.fecha_fin,
                      fecha_corte=c.fecha_reporte_th, fecha_pago=c.fecha_pago,
                      fecha_reporte_financiera=c.fecha_reporte_financiera,
                      frecuencia="quincenal", estado=estado)
        db.add(p)
        if estado == "abierto":
            periodo = p
    if periodo is None:  # respaldo: el primero
        periodo = db.scalar(select(m.Periodo).order_by(m.Periodo.fecha_inicio))
    db.flush()

    # Prima de servicios de junio (pago manual) — se pagó el viernes 5 jun.
    db.add(m.PagoManual(tipo="prima", fecha=date(2026, 6, 5), descripcion="Prima de servicios – junio"))

    # Aviso del cambio normativo vigente HOY (15-jul-2026): jornada 44 h → 42 h. Una sola
    # notificación por rol (sin repetir) para que TH, líderes y registradores lo vean.
    for _rol in ("super_admin", "lider", "registrador"):
        db.add(m.Notificacion(
            rol_destino=_rol, tipo="CAMBIO_NORMATIVO",
            titulo="Jornada máxima semanal: 44 h → 42 h",
            descripcion="Desde el 15-jul-2026 la jornada máxima baja de 44 h a 42 h (Ley 2101/2021). "
                        "El sistema ya calcula las semanas desde esa fecha con el tope de 42 h."))

    # Beneficios/licencias configurables (todos APAGADOS por defecto). Info
    # verificada; se activan por empresa según su política (#1, #2).
    db.add_all([
        m.BeneficioLicencia(
            nombre="Día por grados educativos", dias=1.0, remunerada=True, activa=True,
            descripcion="Día libre remunerado para asistir a la ceremonia de grado del trabajador o de "
                        "un familiar cercano. Beneficio voluntario de la empresa.",
            base_legal="Beneficio empresarial (no legal)."),
        m.BeneficioLicencia(
            nombre="Día por luto de mascotas", dias=1.0, remunerada=True, activa=True,
            descripcion="Día libre remunerado por el fallecimiento de una mascota. Beneficio voluntario "
                        "de la empresa.",
            base_legal="Beneficio empresarial (no legal)."),
        m.BeneficioLicencia(
            nombre="Medio día por cumpleaños", dias=0.5, remunerada=True, activa=True,
            descripcion="Media jornada libre remunerada el día del cumpleaños del trabajador. Beneficio "
                        "voluntario de la empresa.",
            base_legal="Beneficio empresarial (no legal)."),
    ])

    # #10 La quincena arranca VACÍA (sin horarios precargados): cada área los carga.

    # Notificaciones: recordatorio de entrega + cambio normativo.
    db.add_all([
        m.Notificacion(rol_destino="registrador", equipo_id=eq_ventas.id, tipo="RECORDATORIO_ENTREGA",
                       titulo="El período cierra el 31 de julio",
                       descripcion="Recuerda enviar el período de Ventas a RH antes de la fecha de corte."),
        m.Notificacion(rol_destino="super_admin", tipo="CAMBIO_NORMATIVO",
                       titulo="Cambio normativo: 1 jul 2027",
                       descripcion="El recargo dominical/festivo sube de 90% a 100%."),
    ])
