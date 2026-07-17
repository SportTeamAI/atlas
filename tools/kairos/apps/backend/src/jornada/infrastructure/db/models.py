"""Modelos ORM (tablas del Bloque 7, adaptadas al MVP con SQLite).

Nota MVP: `registros_horarios.clasificacion` guarda el desglose por categoría
como JSON (un turno puede tener varios tramos al cruzar 19:00/6:00), además de
los totales. En el esquema original era una sola categoría por fila; este enfoque
es más fiel a la segmentación legal.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import JSON, Boolean, Date, DateTime, Float, ForeignKey, String, Time, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from jornada.infrastructure.db.database import Base, new_id

# Todos los sellos de tiempo se guardan en hora de Bogotá (naive). SQLite `func.now()`
# devuelve UTC, que se veía +5 h en los mensajes; con esto el front (navegador en
# Colombia) los interpreta como locales y coinciden con la hora real. Colombia es
# UTC-5 fijo todo el año (sin horario de verano), así que usamos un offset fijo en
# vez de una zona IANA (Windows/Python no trae la base tz). #3
_BOGOTA = timezone(timedelta(hours=-5))


def ahora_bogota() -> datetime:
    """Fecha-hora actual en Bogotá, sin tzinfo (wall-clock local de Colombia)."""
    return datetime.now(_BOGOTA).replace(tzinfo=None)


class Equipo(Base):
    __tablename__ = "equipos"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    nombre: Mapped[str] = mapped_column(String(100), unique=True)
    # Origen en Buk. En el mismo tenant conviven DOS empresas (VirtualSoft y Quota Media) y
    # repiten nombres de área (p. ej. "Audiovisual" existe en las dos): el match del sync va
    # por `buk_area_id`, NUNCA por nombre, y `empresa` las separa en la UI.
    buk_area_id: Mapped[int | None] = mapped_column(default=None)
    empresa: Mapped[str | None] = mapped_column(String(60), default=None)
    descripcion: Mapped[str | None] = mapped_column(String(255), default=None)
    lider_id: Mapped[str | None] = mapped_column(ForeignKey("usuarios.id"), default=None)
    almuerzo_min: Mapped[int] = mapped_column(default=60)  # min de alimentación por área (#4/#6)
    # #7/#8 SAC descuenta su almuerzo SIEMPRE (30 min), sin importar el largo del
    # turno. Las demás áreas solo descuentan si el turno es largo (regla condicional).
    almuerzo_siempre: Mapped[bool] = mapped_column(Boolean, default=False)
    tiempo_alim_tipo: Mapped[str] = mapped_column(String(10), default="estandar")  # estandar|variable
    tiempo_alim_horas: Mapped[float] = mapped_column(Float, default=0.0)
    tiempo_alim_min_h: Mapped[float | None] = mapped_column(Float, default=None)
    tiempo_alim_max_h: Mapped[float | None] = mapped_column(Float, default=None)
    activo: Mapped[bool] = mapped_column(Boolean, default=True)
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=ahora_bogota)

    empleados: Mapped[list[Empleado]] = relationship(back_populates="equipo")


# ─────────────────────────────────────────────────────────────────────────────
# CORE de Atlas: quién entra y a QUÉ herramienta. Es lo único que sube de nivel;
# empleados y equipos siguen siendo de la herramienta (los lee Atlas para asignar
# permisos, y cada herramienta los configura a su manera).
# ─────────────────────────────────────────────────────────────────────────────
class Herramienta(Base):
    """Cada producto del ecosistema (kairos, pronos…). El hub de Atlas solo muestra
    aquellas en las que la persona tiene un permiso: si no se asigna, no se ve."""

    __tablename__ = "herramientas"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    slug: Mapped[str] = mapped_column(String(30), unique=True)   # kairos | pronos
    nombre: Mapped[str] = mapped_column(String(60))
    descripcion: Mapped[str | None] = mapped_column(String(200), default=None)
    ruta: Mapped[str] = mapped_column(String(120), default="")   # /atlas/kairos/
    # Roles válidos DENTRO de esta herramienta. Cada una define los suyos: Kairos usa
    # super_admin/lider/registrador; Pronos tendrá otros. Por eso es una lista, no un enum.
    roles: Mapped[list] = mapped_column(JSON, default=list)
    activa: Mapped[bool] = mapped_column(Boolean, default=True)
    orden: Mapped[int] = mapped_column(default=0)


class Permiso(Base):
    """Un usuario tiene acceso a UNA herramienta con UN rol. Sin fila aquí, no entra.

    Es lo que decide el hub y lo que decide el rol dentro de cada herramienta: por eso
    el rol vive aquí y no en `Usuario` (una persona puede ser admin en Kairos y no tener
    nada en Pronos). Lo asigna el admin de Atlas.
    """

    __tablename__ = "permisos"
    __table_args__ = (UniqueConstraint("usuario_id", "herramienta_id", name="uq_permiso_usuario_herramienta"),)
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    usuario_id: Mapped[str] = mapped_column(ForeignKey("usuarios.id", ondelete="CASCADE"))
    herramienta_id: Mapped[str] = mapped_column(ForeignKey("herramientas.id", ondelete="CASCADE"))
    rol: Mapped[str] = mapped_column(String(20))
    otorgado_por: Mapped[str | None] = mapped_column(ForeignKey("usuarios.id"), default=None)
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=ahora_bogota)


class Usuario(Base):
    __tablename__ = "usuarios"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    nombre: Mapped[str] = mapped_column(String(255))
    email: Mapped[str] = mapped_column(String(255), unique=True)
    # OJO: este es el rol EN KAIROS (histórico). El rol por herramienta vive en `Permiso`.
    # Se mantiene mientras Kairos migra a leer de ahí, para no romper nada por el camino.
    rol: Mapped[str] = mapped_column(String(20))  # super_admin|registrador|lider
    # Admin de ATLAS: da y quita permisos de TODAS las herramientas. Es otra cosa que ser
    # admin DENTRO de una herramienta (eso es un Permiso con rol super_admin).
    es_admin_atlas: Mapped[bool] = mapped_column(Boolean, default=False)
    # RELACIÓN REAL con la persona de nómina. Antes se unía comparando el TEXTO del correo:
    # si el correo no coincidía (usuarios demo con correos inventados), el acceso quedaba
    # huérfano y no se sabía quién era. La llave foránea evita inventar vínculos.
    empleado_id: Mapped[str | None] = mapped_column(ForeignKey("empleados.id"), default=None)
    equipo_id: Mapped[str | None] = mapped_column(ForeignKey("equipos.id"), default=None)
    activo: Mapped[bool] = mapped_column(Boolean, default=True)
    # A quién de Talento Humano le llegan las SOLICITUDES de los líderes. El líder del área
    # de TH recibe siempre (no se puede quitar); a los demás los marca/desmarca TH.
    recibe_solicitudes: Mapped[bool] = mapped_column(Boolean, default=False)
    formato_horas: Mapped[str] = mapped_column(String(10), default="legible")
    ultimo_acceso: Mapped[datetime | None] = mapped_column(DateTime, default=None)
    # Auth local (JWT). password_hash NULL = acceso creado pero PENDIENTE de onboarding
    # (la persona aún no define su contraseña). El token de un solo uso sirve para eso.
    password_hash: Mapped[str | None] = mapped_column(String(200), default=None)
    onboarding_token: Mapped[str | None] = mapped_column(String(64), default=None)
    onboarding_expira: Mapped[datetime | None] = mapped_column(DateTime, default=None)
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=ahora_bogota)


class Turno(Base):
    """Catálogo de turnos (atajo opcional para registrar más rápido)."""

    __tablename__ = "turnos"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    nombre: Mapped[str] = mapped_column(String(60))
    abreviatura: Mapped[str] = mapped_column(String(4), default="")
    hora_inicio: Mapped[time] = mapped_column(Time)
    hora_fin: Mapped[time] = mapped_column(Time)
    # Minutos de alimentación del turno (#4). Solo se descuentan si el turno es
    # lo bastante largo (queda >= 8 h tras descontarlos); si no, se registra completo.
    almuerzo_min: Mapped[int] = mapped_column(default=60)
    # Turno específico de un área (None = disponible para todas). Compat.
    equipo_id: Mapped[str | None] = mapped_column(ForeignKey("equipos.id"), default=None)
    # #2 Un mismo horario NO se duplica: un turno lo pueden usar VARIAS áreas.
    # Lista de ids de equipo que lo usan (vacía = todas).
    equipos_ids: Mapped[list] = mapped_column(JSON, default=list)
    activo: Mapped[bool] = mapped_column(Boolean, default=True)


class Empleado(Base):
    __tablename__ = "empleados"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    cedula: Mapped[str] = mapped_column(String(20), unique=True)
    nombre: Mapped[str] = mapped_column(String(255))
    email: Mapped[str | None] = mapped_column(String(255), default=None)
    cargo: Mapped[str | None] = mapped_column(String(120), default=None)
    # Liderazgo dentro del área: colaborador | lider (#5). `reporta` es aparte:
    # el líder también puede reportar (#2), por eso es un booleano independiente.
    rol_operativo: Mapped[str] = mapped_column(String(15), default="colaborador")
    reporta: Mapped[bool] = mapped_column(Boolean, default=False)
    # ¿Esta persona LLEVA HORARIO? (aparece en grillas, reportes y consolidado). Antes se
    # deducía del rol ("los líderes no"), lo que escondía a líderes que sí trabajan turnos
    # (p. ej. Deivys) y metía a Talento Humano, que no reporta. Ahora es explícito y TH lo
    # puede activar/quitar por persona.
    lleva_horario: Mapped[bool] = mapped_column(Boolean, default=True)
    equipo_id: Mapped[str] = mapped_column(ForeignKey("equipos.id"))
    # True = el área la fija TH aquí y el sync de Buk NO la pisa. Para casos en que Buk
    # tiene a la persona en otra área pero operativamente trabaja en este equipo.
    equipo_manual: Mapped[bool] = mapped_column(Boolean, default=False)
    # Tipo de contrato (laboral): indefinido | fijo | obra_labor | aprendizaje
    tipo_contrato: Mapped[str] = mapped_column(String(20), default="indefinido")
    # Tipo de jornada (define la clasificación de horas)
    tipo_jornada: Mapped[str] = mapped_column(String(30))
    jornada_horas_dia: Mapped[float | None] = mapped_column(Float, default=8.0)
    jornada_horas_semana: Mapped[float | None] = mapped_column(Float, default=44.0)
    # Horario habitual (hora de entrada/salida): base para "aplicar al período".
    horario_inicio_habitual: Mapped[time | None] = mapped_column(Time, default=None)
    horario_fin_habitual: Mapped[time | None] = mapped_column(Time, default=None)
    dia_descanso: Mapped[str] = mapped_column(String(10), default="domingo")
    fecha_ingreso: Mapped[date | None] = mapped_column(Date, default=None)
    activo: Mapped[bool] = mapped_column(Boolean, default=True)
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=ahora_bogota)

    equipo: Mapped[Equipo] = relationship(back_populates="empleados")


class Periodo(Base):
    """Período de nómina GLOBAL (todos los equipos). El corte es la fecha tope
    para subir los horarios — lo que pase después entra al siguiente período.
    """

    __tablename__ = "periodos"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    # Período específico de un área (None = GLOBAL, lo ven todas). Sirve para áreas que
    # reportaron julio en fechas distintas (SAC/Incidentes); desde agosto todos usan los
    # globales. Un global queda "tapado" para un área si esta tiene un período propio que
    # cruza sus fechas (ver listar_periodos).
    equipo_id: Mapped[str | None] = mapped_column(ForeignKey("equipos.id"), default=None)
    # Nota/novedad del período (p. ej. explicar por qué un área tiene fechas propias para
    # un NM que en el resto va estándar).
    nota: Mapped[str | None] = mapped_column(String(300), default=None)
    nombre: Mapped[str | None] = mapped_column(String(100), default=None)  # NM1QJulio26
    quincena: Mapped[int] = mapped_column(default=1)  # 1 (paga 15) | 2 (paga 30)
    secuencia: Mapped[int] = mapped_column(default=1)  # nº de quincena del año 1..24
    fecha_inicio: Mapped[date] = mapped_column(Date)
    fecha_fin: Mapped[date] = mapped_column(Date)
    # fecha_corte == reporte a TH (deadline para líder/registrador).
    fecha_corte: Mapped[date] = mapped_column(Date)
    fecha_pago: Mapped[date | None] = mapped_column(Date, default=None)
    fecha_reporte_financiera: Mapped[date | None] = mapped_column(Date, default=None)
    frecuencia: Mapped[str] = mapped_column(String(15), default="quincenal")
    estado: Mapped[str] = mapped_column(String(15), default="abierto")  # programado|abierto|en_revision|cerrado
    cerrado_en: Mapped[datetime | None] = mapped_column(DateTime, default=None)
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=ahora_bogota)


class PeriodoEquipo(Base):
    """Estado del período por equipo (cada equipo valida/envía a RH por su lado)."""

    __tablename__ = "periodo_equipo"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    periodo_id: Mapped[str] = mapped_column(ForeignKey("periodos.id"))
    equipo_id: Mapped[str] = mapped_column(ForeignKey("equipos.id"))
    # Estado del flujo del equipo dentro del período:
    #   registro → pend_validacion → validado → en_th → aprobado
    # (bloqueado = cambios NO permitidos cuando está validado/en_th/aprobado).
    estado_flujo: Mapped[str] = mapped_column(String(20), default="registro")
    validado_lider: Mapped[bool] = mapped_column(Boolean, default=False)
    enviado_a_rh_en: Mapped[datetime | None] = mapped_column(DateTime, default=None)
    aprobado_rh: Mapped[bool] = mapped_column(Boolean, default=False)


class Novedad(Base):
    __tablename__ = "novedades"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    empleado_id: Mapped[str] = mapped_column(ForeignKey("empleados.id"))
    periodo_id: Mapped[str | None] = mapped_column(ForeignKey("periodos.id"), default=None)
    fecha_inicio: Mapped[date] = mapped_column(Date)
    fecha_fin: Mapped[date] = mapped_column(Date)
    # 40, no 20: "INCAPACIDAD_ENFERMEDAD" son 22 caracteres y NO cabía. SQLite lo guardaba
    # igual (ignora los límites de VARCHAR) y nadie se enteró; PostgreSQL lo rechaza. Al
    # migrar saltó a la cara: el dato llevaba semanas violando su propio esquema.
    tipo: Mapped[str] = mapped_column(String(40))
    es_remunerada: Mapped[bool] = mapped_column(Boolean, default=True)
    # #1 Fracción de la jornada que paga por día (1.0 = día completo, 0.5 = medio
    # día, ej. votación o "medio día por cumpleaños"). Se paga fraccion × jornada.
    fraccion_dia: Mapped[float] = mapped_column(Float, default=1.0)
    descripcion: Mapped[str | None] = mapped_column(String(255), default=None)
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=ahora_bogota)


class RegistroHorario(Base):
    __tablename__ = "registros_horarios"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    empleado_id: Mapped[str] = mapped_column(ForeignKey("empleados.id"))
    periodo_id: Mapped[str | None] = mapped_column(ForeignKey("periodos.id"), default=None)
    fecha: Mapped[date] = mapped_column(Date)
    hora_inicio: Mapped[time] = mapped_column(Time)
    hora_fin: Mapped[time] = mapped_column(Time)
    tiempo_alimentacion_h: Mapped[float] = mapped_column(Float, default=0.0)
    duracion_bruta_h: Mapped[float] = mapped_column(Float)
    duracion_neta_h: Mapped[float] = mapped_column(Float)
    tipo_descanso: Mapped[str | None] = mapped_column(String(10), default=None)  # dominical|festivo
    clasificacion: Mapped[list] = mapped_column(JSON, default=list)  # [{category,label,hours,recargo_pct}]
    estado: Mapped[str] = mapped_column(String(15), default="pendiente")  # pendiente|aprobado|rechazado
    observacion_rh: Mapped[str | None] = mapped_column(String(500), default=None)
    # Motivo/justificación de una hora extra o bloque agregado (lo escribe quien registra;
    # TH lo valida). Vacío en el turno base.
    motivo: Mapped[str | None] = mapped_column(String(300), default=None)
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=ahora_bogota)


class Festivo(Base):
    __tablename__ = "festivos_nacionales"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    anio: Mapped[int] = mapped_column()
    nombre: Mapped[str] = mapped_column(String(200))
    fecha_descanso: Mapped[date] = mapped_column(Date)


class FestivoExcepcion(Base):
    """Excepción puntual al calendario calculado (Ley Emiliani).
    TH puede agregar/quitar un festivo específico desde Configuración sin tocar código."""

    __tablename__ = "festivos_excepciones"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    fecha: Mapped[date] = mapped_column(Date, unique=True)
    tipo: Mapped[str] = mapped_column(String(6))          # 'agregar' | 'quitar'
    motivo: Mapped[str | None] = mapped_column(String(200), default=None)
    creado_por: Mapped[str | None] = mapped_column(
        ForeignKey("usuarios.id", ondelete="SET NULL"), default=None)
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=ahora_bogota)


class ConfigRecargo(Base):
    __tablename__ = "config_recargos"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    fecha_desde: Mapped[date] = mapped_column(Date, unique=True)
    recargo_nocturna_h: Mapped[float] = mapped_column(Float, default=0.350)
    recargo_extra_diurna: Mapped[float] = mapped_column(Float, default=0.250)
    recargo_extra_nocturna: Mapped[float] = mapped_column(Float, default=0.750)
    recargo_dia_descanso: Mapped[float] = mapped_column(Float)
    jornada_max_semanal_h: Mapped[float] = mapped_column(Float)


class Solicitud(Base):
    """Petición de un LÍDER a Talento Humano sobre alguien de su equipo.

    Son dos cosas distintas y no se mezclan:
    - `lleva_horario`: que la persona aparezca para reportar horas.
    - `acceso_registrador`: que la persona entre a la plataforma con rol registrador.

    El líder ya no cambia nada de esto por su cuenta: lo solicita y TH aprueba o rechaza.
    """

    __tablename__ = "solicitudes"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    empleado_id: Mapped[str] = mapped_column(ForeignKey("empleados.id"))
    equipo_id: Mapped[str | None] = mapped_column(ForeignKey("equipos.id"), default=None)
    tipo: Mapped[str] = mapped_column(String(30))            # lleva_horario|acceso_registrador
    motivo: Mapped[str | None] = mapped_column(String(300), default=None)
    estado: Mapped[str] = mapped_column(String(12), default="pendiente")  # pendiente|aprobada|rechazada
    respuesta: Mapped[str | None] = mapped_column(String(300), default=None)
    creado_por: Mapped[str | None] = mapped_column(ForeignKey("usuarios.id"), default=None)
    resuelto_por: Mapped[str | None] = mapped_column(ForeignKey("usuarios.id"), default=None)
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=ahora_bogota)
    resuelto_en: Mapped[datetime | None] = mapped_column(DateTime, default=None)


class Notificacion(Base):
    __tablename__ = "notificaciones"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    rol_destino: Mapped[str | None] = mapped_column(String(20), default=None)
    # Destinatario concreto. Con esto la solicitud le llega a la persona de TH encargada
    # (no a todo el rol). NULL = la notificación es para todo el `rol_destino`, como antes.
    usuario_id: Mapped[str | None] = mapped_column(ForeignKey("usuarios.id"), default=None)
    equipo_id: Mapped[str | None] = mapped_column(ForeignKey("equipos.id"), default=None)
    tipo: Mapped[str] = mapped_column(String(50))
    titulo: Mapped[str] = mapped_column(String(255))
    descripcion: Mapped[str | None] = mapped_column(String(500), default=None)
    leida: Mapped[bool] = mapped_column(Boolean, default=False)
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=ahora_bogota)


class TiempoAlimentacionContrato(Base):
    """Minutos de almuerzo por tipo de contrato (configurable por RH)."""

    __tablename__ = "tiempo_almuerzo_contrato"
    tipo_contrato: Mapped[str] = mapped_column(String(20), primary_key=True)
    minutos: Mapped[int] = mapped_column(default=60)


class BeneficioLicencia(Base):
    """Licencias/beneficios ADICIONALES de la empresa que dan tiempo (ej. día de
    la familia). Se pueden activar/desactivar (#6)."""

    __tablename__ = "beneficios_licencia"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    nombre: Mapped[str] = mapped_column(String(120))
    dias: Mapped[float] = mapped_column(Float, default=1.0)
    remunerada: Mapped[bool] = mapped_column(Boolean, default=True)
    activa: Mapped[bool] = mapped_column(Boolean, default=False)
    descripcion: Mapped[str | None] = mapped_column(String(300), default=None)
    base_legal: Mapped[str | None] = mapped_column(String(200), default=None)


class InvestigacionNormativa(Base):
    """Corridas del pipeline de investigación de cambios normativos (#3): sirve para
    limitar a 1 por día y 3 por semana, y para dejar el resultado en el historial."""

    __tablename__ = "investigacion_normativa"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=ahora_bogota)
    resultado: Mapped[str] = mapped_column(String(300))


class PagoManual(Base):
    """Pagos que RH configura a mano (prima, aguinaldo) y salen en el calendario."""

    __tablename__ = "pagos_manuales"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    tipo: Mapped[str] = mapped_column(String(20))  # prima | aguinaldo | otro
    fecha: Mapped[date] = mapped_column(Date)
    descripcion: Mapped[str | None] = mapped_column(String(200), default=None)


class EventoEspecial(Base):
    """Fechas especiales (eventos) configuradas por RH; se muestran en el calendario."""

    __tablename__ = "eventos_especiales"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    fecha: Mapped[date] = mapped_column(Date)
    nombre: Mapped[str] = mapped_column(String(200))
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=ahora_bogota)


class SolicitudCambio(Base):
    """Solicitud post-cierre: registrador/líder pide a RH cambiar un registro/novedad."""

    __tablename__ = "solicitudes_cambio"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    periodo_id: Mapped[str] = mapped_column(ForeignKey("periodos.id"))
    empleado_id: Mapped[str] = mapped_column(ForeignKey("empleados.id"))
    fecha: Mapped[date] = mapped_column(Date)
    motivo: Mapped[str] = mapped_column(String(500))  # incapacidad, error, etc.
    propuesta: Mapped[str] = mapped_column(String(500))  # "cambiar 8-17 por novedad LICENCIA_ENF"
    solicitante_nombre: Mapped[str] = mapped_column(String(120))
    solicitante_rol: Mapped[str] = mapped_column(String(20))
    estado: Mapped[str] = mapped_column(String(15), default="pendiente")  # pendiente|aprobada|rechazada
    respuesta_rh: Mapped[str | None] = mapped_column(String(500), default=None)
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=ahora_bogota)


class Comentario(Base):
    """Hilo de comentarios/validación sobre un período (estilo red social)."""

    __tablename__ = "comentarios"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    periodo_id: Mapped[str] = mapped_column(ForeignKey("periodos.id"))
    # Chat/eventos POR ÁREA (#4). None = general del período (legado).
    equipo_id: Mapped[str | None] = mapped_column(ForeignKey("equipos.id"), default=None)
    autor_nombre: Mapped[str] = mapped_column(String(120))
    autor_rol: Mapped[str] = mapped_column(String(20))
    texto: Mapped[str] = mapped_column(String(1000))
    tipo: Mapped[str] = mapped_column(String(20), default="comentario")  # comentario|validacion|aprobacion|observacion|ajuste
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=ahora_bogota)


class AjusteReporte(Base):
    """Ajuste que hace TALENTO HUMANO sobre lo reportado por un equipo (descuento o pago
    de más de cierto tipo de hora), SIN tocar la grilla ni los registros del equipo.

    Se aplica encima del reporte: el consolidado a Financiera y el resumen "horas
    cargadas" muestran reportado ± ajustes. Queda con motivo y autor → trazabilidad; al
    crearlo se publica una nota automática en Consolidado y chat del área.
    """

    __tablename__ = "ajustes_reporte"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    empleado_id: Mapped[str] = mapped_column(ForeignKey("empleados.id"))
    periodo_id: Mapped[str] = mapped_column(ForeignKey("periodos.id"))
    categoria: Mapped[str] = mapped_column(String(20))   # código Category: ORD_NOCT_DESC, etc.
    horas: Mapped[float] = mapped_column(Float)          # + agrega, − descuenta
    motivo: Mapped[str] = mapped_column(String(500))
    creado_por: Mapped[str | None] = mapped_column(String(120), default=None)
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=ahora_bogota)
