"""Esquemas Pydantic de lectura/escritura para los CRUD del MVP."""

from __future__ import annotations

from datetime import date, datetime, time

from pydantic import BaseModel, ConfigDict, computed_field

# Equipos cuyas horas extra son SIEMPRE día a día (operativos: un bloque agregado ya
# es extra). El resto (administrativos: Deportivas, Operaciones Comerciales) van por
# acumulado SEMANAL en semanas con festivo, así que un bloque agregado NO es extra por
# sí solo. Fuente única de esta regla (la usa el motor de extras y la UI).
EQUIPOS_EXTRAS_DIARIAS = {"servicio al cliente", "riesgos", "incidentes"}


class _ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class MeOut(_ORM):
    id: str
    nombre: str
    email: str
    rol: str
    equipo_id: str | None
    activo: bool = True


# ── Auth / accesos (JWT local) ────────────────────────────────────────────────
class LoginIn(BaseModel):
    email: str
    password: str


class DefinirPasswordIn(BaseModel):
    token: str
    password: str


class TokenOut(BaseModel):
    token: str
    usuario: MeOut


class OnboardingInfoOut(BaseModel):
    valido: bool
    email: str | None = None
    nombre: str | None = None
    rol: str | None = None


class SolicitudIn(BaseModel):
    """Lo que pide un líder a TH sobre alguien de su equipo."""

    empleado_id: str
    tipo: str            # lleva_horario | acceso_registrador
    motivo: str | None = None


class SolicitudResolverIn(BaseModel):
    respuesta: str | None = None


class SolicitudOut(BaseModel):
    id: str
    empleado_id: str
    empleado_nombre: str | None = None
    equipo_nombre: str | None = None
    tipo: str
    tipo_texto: str          # "Que lleve horario" / "Acceso con rol registrador"
    motivo: str | None = None
    estado: str
    respuesta: str | None = None
    solicitado_por: str | None = None
    resuelto_por: str | None = None
    creado_en: datetime
    resuelto_en: datetime | None = None


class ReceptorOut(BaseModel):
    """Quién de TH recibe las solicitudes de los líderes."""

    id: str
    nombre: str
    email: str
    recibe: bool
    fijo: bool           # el líder del área de TH recibe siempre: no se puede desmarcar


class AccesoOut(BaseModel):
    """Fila del panel de accesos (TH / líder): estado de login de cada persona."""

    id: str
    nombre: str
    email: str
    rol: str
    equipo_id: str | None = None
    equipo_nombre: str | None = None
    activo: bool
    tiene_password: bool
    onboarding_pendiente: bool
    onboarding_url: str | None = None
    # None = no existe como empleado (usuario suelto); False = empleado apagado. En ambos
    # casos el acceso está desalineado con la nómina y TH debe verlo.
    empleado_activo: bool | None = None


class CrearAccesoIn(BaseModel):
    """TH crea acceso para alguien que no está en el roster de empleados (p. ej. TH)."""

    nombre: str
    email: str
    rol: str = "super_admin"
    equipo_id: str | None = None


# ── Ajustes de TH (descuentos/pagos de más sobre lo reportado) ─────────────────
class AjusteIn(BaseModel):
    empleado_id: str
    periodo_id: str
    categoria: str          # código Category: ORD_NOCT_DESC, etc.
    horas: float            # + agrega, − descuenta
    motivo: str


class AjusteOut(BaseModel):
    id: str
    empleado_id: str
    empleado_nombre: str | None = None
    periodo_id: str
    categoria: str
    categoria_label: str | None = None
    horas: float
    motivo: str
    creado_por: str | None = None
    creado_en: datetime


class EquipoOut(_ORM):
    id: str
    nombre: str
    descripcion: str | None
    lider_id: str | None
    almuerzo_min: int
    tiempo_alim_tipo: str
    tiempo_alim_horas: float
    activo: bool
    n_empleados: int = 0        # cuánta gente tiene el área (para las tarjetas de Configuración)
    n_lleva_horario: int = 0    # cuántos reportan horas: si es 0, al área no se le pide reporte
    empresa: str | None = None  # VirtualSoft / Quota Media (conviven en el mismo Buk)

    @computed_field
    @property
    def extras_diarias(self) -> bool:
        """True para equipos operativos (extra día a día); False para administrativos
        (Deportivas/Operaciones): un bloque agregado NO es extra por sí solo."""
        return (self.nombre or "").strip().lower() in EQUIPOS_EXTRAS_DIARIAS


class EmpleadoOut(_ORM):
    id: str
    cedula: str
    nombre: str
    email: str | None
    cargo: str | None
    rol_operativo: str
    reporta: bool
    equipo_id: str
    tipo_contrato: str
    tipo_jornada: str
    jornada_horas_dia: float | None
    jornada_horas_semana: float | None
    horario_inicio_habitual: time | None
    horario_fin_habitual: time | None
    dia_descanso: str
    activo: bool
    lleva_horario: bool = True   # ¿aparece en grillas/reportes? (TH no; líderes solo si trabajan turnos)


class EmpleadoIn(BaseModel):
    cedula: str
    nombre: str
    email: str | None = None
    cargo: str | None = None
    equipo_id: str
    rol_operativo: str = "colaborador"   # colaborador | lider (al líder no se le agenda)
    reporta: bool = False
    tipo_contrato: str = "indefinido"
    tipo_jornada: str
    jornada_horas_dia: float | None = 8.0
    jornada_horas_semana: float | None = 44.0
    horario_inicio_habitual: time | None = None
    horario_fin_habitual: time | None = None
    dia_descanso: str = "domingo"


class EmpleadoPatch(BaseModel):
    """Edición parcial de empleado (p. ej. reasignar de equipo o corregir nombre)."""

    nombre: str | None = None
    email: str | None = None
    cargo: str | None = None
    rol_operativo: str | None = None
    reporta: bool | None = None
    lleva_horario: bool | None = None   # TH lo activa/quita por persona (líderes con turno, etc.)
    equipo_id: str | None = None
    tipo_contrato: str | None = None
    tipo_jornada: str | None = None
    horario_inicio_habitual: time | None = None
    horario_fin_habitual: time | None = None
    dia_descanso: str | None = None
    activo: bool | None = None


class EquipoIn(BaseModel):
    nombre: str
    descripcion: str | None = None
    lider_id: str | None = None
    almuerzo_min: int = 60
    tiempo_alim_tipo: str = "estandar"
    tiempo_alim_horas: float = 0.0


class EquipoPatch(BaseModel):
    nombre: str | None = None
    descripcion: str | None = None
    lider_id: str | None = None
    almuerzo_min: int | None = None
    activo: bool | None = None


class UsuarioPatch(BaseModel):
    """RH designa rol y/o equipo (p. ej. quién registra horarios)."""

    rol: str | None = None
    equipo_id: str | None = None
    activo: bool | None = None


class AplicarHabitualIn(BaseModel):
    """Aplica el horario habitual de cada empleado a todo el período."""

    empleado_ids: list[str] | None = None  # None = todos los del equipo
    sobrescribir: bool = True


class TurnoOut(_ORM):
    id: str
    nombre: str
    abreviatura: str
    hora_inicio: time
    hora_fin: time
    almuerzo_min: int
    equipo_id: str | None
    equipos_ids: list[str] = []  # #2 áreas que USAN este turno (vacío = todas)


class TurnoIn(BaseModel):
    """Alta de un turno reutilizable (RH)."""

    nombre: str
    abreviatura: str = ""
    hora_inicio: time
    hora_fin: time
    almuerzo_min: int = 60
    equipo_id: str | None = None
    equipos_ids: list[str] = []


class TurnoPatch(BaseModel):
    nombre: str | None = None
    abreviatura: str | None = None
    hora_inicio: time | None = None
    hora_fin: time | None = None
    almuerzo_min: int | None = None
    activo: bool | None = None


class AplicarTurnoIn(BaseModel):
    """Aplica un turno (horario fijo) a todo el período."""

    turno_id: str
    empleado_ids: list[str] | None = None
    sobrescribir: bool = True


class AsignarIn(BaseModel):
    """Asignación flexible: a varios empleados, un horario, en el alcance elegido.

    - empleado_ids None = todos los del equipo.
    - turno_id None = usa el horario habitual de cada empleado.
    - fechas None = todos los días del período; o una lista de fechas (un día o
      un rango) en formato ISO.
    """

    empleado_ids: list[str] | None = None
    turno_id: str | None = None
    fechas: list[date] | None = None
    sobrescribir: bool = True
    # #3 Horario MANUAL (fuera del catálogo): si vienen, se aplican tal cual y NO
    # se guarda turno ni se manda ninguna recomendación.
    hora_inicio: time | None = None
    hora_fin: time | None = None
    meal_min: int | None = None
    # Marcar los días elegidos como DESCANSO (en vez de un horario).
    es_descanso: bool = False
    # QUITAR: borra el horario/novedad de los días elegidos (deshacer).
    es_quitar: bool = False


class ConfigRecargoOut(_ORM):
    fecha_desde: date
    recargo_nocturna_h: float
    recargo_extra_diurna: float
    recargo_extra_nocturna: float
    recargo_dia_descanso: float
    jornada_max_semanal_h: float


class ConfigRecargoPatch(BaseModel):
    recargo_nocturna_h: float | None = None
    recargo_extra_diurna: float | None = None
    recargo_extra_nocturna: float | None = None
    recargo_dia_descanso: float | None = None
    jornada_max_semanal_h: float | None = None


class PeriodoOut(_ORM):
    id: str
    nombre: str | None
    quincena: int
    secuencia: int
    fecha_inicio: date
    fecha_fin: date
    fecha_corte: date              # = reporte a TH
    fecha_pago: date | None
    fecha_reporte_financiera: date | None
    frecuencia: str
    estado: str
    equipo_id: str | None = None   # None = global; set = período propio de un área
    area_nombre: str | None = None  # nombre del área si es un período propio (para la UI)
    nota: str | None = None         # novedad (p. ej. fechas propias del área para este NM)


class PeriodoIn(BaseModel):
    nombre: str | None = None
    quincena: int = 1
    fecha_inicio: date
    fecha_fin: date
    fecha_corte: date
    fecha_pago: date | None = None
    fecha_reporte_financiera: date | None = None
    frecuencia: str = "quincenal"


class TiempoAlmuerzoOut(_ORM):
    tipo_contrato: str
    minutos: int


class TiempoAlmuerzoIn(BaseModel):
    tipo_contrato: str
    minutos: int


class PeriodoPatch(BaseModel):
    """Ajuste manual de fechas de un período (excepciones, #3)."""

    nombre: str | None = None
    fecha_inicio: date | None = None
    fecha_fin: date | None = None
    fecha_corte: date | None = None            # reporte a TH
    fecha_pago: date | None = None
    fecha_reporte_financiera: date | None = None


class GenerarPeriodosIn(BaseModel):
    """Genera los períodos (quincenas) de nómina de un año con la lógica del
    calendario colombiano: pago 15/fin de mes, corte a TH 6 hábiles antes, etc.
    """

    anio: int = 2026
    # Punto de arranque para el primer año (2026 empieza en NM1QJulio26).
    mes_desde: int = 7
    quincena_desde: int = 1


class NovedadOut(_ORM):
    id: str
    empleado_id: str
    fecha_inicio: date
    fecha_fin: date
    tipo: str
    es_remunerada: bool
    fraccion_dia: float = 1.0
    descripcion: str | None


class NovedadIn(BaseModel):
    empleado_id: str
    periodo_id: str | None = None
    fecha_inicio: date
    fecha_fin: date
    tipo: str
    es_remunerada: bool = True
    fraccion_dia: float = 1.0
    descripcion: str | None = None


class RegistroOut(_ORM):
    id: str
    empleado_id: str
    periodo_id: str | None
    fecha: date
    hora_inicio: time
    hora_fin: time
    tiempo_alimentacion_h: float
    duracion_bruta_h: float
    duracion_neta_h: float
    tipo_descanso: str | None
    clasificacion: list
    estado: str
    motivo: str | None = None


class RegistroIn(BaseModel):
    empleado_id: str
    periodo_id: str | None = None
    fecha: date
    hora_inicio: time
    hora_fin: time
    meal_min: float = 0.0
    is_employee_rest_day: bool = False
    # #5 Turno partido: True (por defecto) reemplaza el día; False AGREGA otro
    # bloque no continuo al mismo día (sin borrar el existente).
    reemplazar: bool = True
    # Motivo/justificación de la extra o bloque agregado (para que TH lo valide).
    motivo: str | None = None


class NotificacionOut(_ORM):
    id: str
    tipo: str
    titulo: str
    descripcion: str | None
    leida: bool
    creado_en: datetime


class FestivoOut(_ORM):
    nombre: str
    fecha_descanso: date


class FestivoExcepcionIn(BaseModel):
    fecha: date
    tipo: str          # 'agregar' | 'quitar'
    motivo: str | None = None


class FestivoExcepcionOut(_ORM):
    id: str
    fecha: date
    tipo: str
    motivo: str | None
    creado_por: str | None
    creado_en: datetime


class EventoEspecialOut(_ORM):
    id: str
    fecha: date
    nombre: str


class EventoEspecialIn(BaseModel):
    fecha: date
    nombre: str


class BeneficioOut(_ORM):
    id: str
    nombre: str
    dias: float
    remunerada: bool
    activa: bool
    descripcion: str | None
    base_legal: str | None


class BeneficioIn(BaseModel):
    nombre: str
    dias: float = 1.0
    remunerada: bool = True
    activa: bool = False
    descripcion: str | None = None
    base_legal: str | None = None


class BeneficioPatch(BaseModel):
    nombre: str | None = None
    dias: float | None = None
    remunerada: bool | None = None
    activa: bool | None = None
    descripcion: str | None = None
    base_legal: str | None = None


class PagoManualOut(_ORM):
    id: str
    tipo: str
    fecha: date
    descripcion: str | None


class PagoManualIn(BaseModel):
    tipo: str = "prima"  # prima | aguinaldo | otro
    fecha: date
    descripcion: str | None = None


class PagoManualPatch(BaseModel):
    tipo: str | None = None
    fecha: date | None = None
    descripcion: str | None = None


class ComentarioOut(_ORM):
    id: str
    periodo_id: str
    equipo_id: str | None
    autor_nombre: str
    autor_rol: str
    texto: str
    tipo: str
    creado_en: datetime


class ComentarioIn(BaseModel):
    texto: str
    tipo: str = "comentario"  # comentario | observacion | aprobacion | validacion
    equipo_id: str | None = None  # área a la que pertenece el mensaje (#4)


class AprobarIn(BaseModel):
    equipo_id: str | None = None  # área a aprobar; None = todas las que están en_th


class PeriodoOutFull(_ORM):
    id: str
    nombre: str | None
    fecha_inicio: date
    fecha_fin: date
    fecha_corte: date
    frecuencia: str
    estado: str
    cerrado_en: datetime | None


class SolicitudCambioOut(_ORM):
    id: str
    periodo_id: str
    empleado_id: str
    fecha: date
    motivo: str
    propuesta: str
    solicitante_nombre: str
    solicitante_rol: str
    estado: str
    respuesta_rh: str | None
    creado_en: datetime


class SolicitudCambioIn(BaseModel):
    periodo_id: str
    empleado_id: str
    fecha: date
    motivo: str
    propuesta: str


class SolicitudCambioResponderIn(BaseModel):
    aprobar: bool
    respuesta: str


class PeriodoEquipoOut(_ORM):
    """Estado del período para un equipo concreto."""

    equipo_id: str
    estado_flujo: str
    validado_lider: bool
    enviado_a_rh_en: datetime | None
    aprobado_rh: bool
    # #1 ¿el área ya tiene algún horario/novedad cargado en el período? Distingue
    # "Pendiente" (nada cargado) de "En proceso" (parcial) en el estado del área.
    tiene_datos: bool = False
