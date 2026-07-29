import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Send, Lock, X, Trash2, Plus, Pencil, Sparkles, ChevronRight, ChevronDown, CheckCircle2, Undo2, AlertTriangle, ShieldCheck } from 'lucide-react'
import {
  aprobarPeriodo, asignar, createNovedad, createRegistro,
  deleteNovedad, deleteRegistro, devolverPeriodo, enviarPeriodo, enviarValidacion, getBeneficios, getEmpleados, getEquipos, getEstadoEquipos, getFestivos, getNovedades, getRegistros,
  getTurnos, validarLider,
} from '../api/client'
import { Badge, Btn, Card, EmptyState, Spinner, toast, useFetch, confirmar } from './ui'
import { LICENCIAS, LIC_MAP, esPagada } from '../data/licencias'
import Comentarios from './Comentarios'

const DOW = ['D', 'L', 'M', 'M', 'J', 'V', 'S']
// Día de descanso del empleado → índice de getUTCDay (0=domingo). Sirve para mostrar
// el descanso semanal como "D" implícito sin tener que marcarlo a mano (#2).
const DIA_DOW = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, 'miércoles': 3, jueves: 4, viernes: 5, sabado: 6, 'sábado': 6 }

// Abreviatura corta para mostrar la licencia/permiso en la celda (#4).
const ABREV_LIC = {
  VACACIONES: 'VAC', LICENCIA_MATERNIDAD: 'MAT', LICENCIA_PATERNIDAD: 'PAT',
  INCAPACIDAD_ENFERMEDAD: 'INC', INCAPACIDAD_ACCIDENTE: 'ARL', LICENCIA_LUTO: 'LUT',
  LICENCIA_VOTACION: 'VOT', PERMISO_REMUNERADO: 'PER', PERMISO_NO_REMUNERADO: 'PNR',
  LICENCIA_CALAMIDAD: 'CAL', LICENCIA_CUIDADO: 'CUI', PERMISO_CITA_MEDICA: 'MED',
  LICENCIA_SINDICAL: 'SIN', PERMISO_BICI: 'BIC', GUARDIA: 'GUA',
}

function diasDe(inicio, fin) {
  const [ay, am, ad] = inicio.split('-').map(Number)
  const [by, bm, bd] = fin.split('-').map(Number)
  const out = []
  const d = new Date(Date.UTC(ay, am - 1, ad))
  const end = new Date(Date.UTC(by, bm - 1, bd))
  while (d <= end) {
    out.push({ iso: d.toISOString().slice(0, 10), dow: d.getUTCDay(), num: d.getUTCDate() })
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

// Lista de fechas ISO entre dos fechas (inclusive).
function rangoISO(desde, hasta) {
  return diasDe(desde, hasta).map((d) => d.iso)
}

// Lunes de la semana de una fecha ISO (clave para agrupar extras por semana).
function lunesDe(iso) {
  const [y, m, dd] = iso.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1, dd))
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

// modo: 'registro' = captura de turnos/horas/extras (sin chat ni validación);
//       'consolidado' = vista de todos + chat + validación (sin edición).
export default function GrillaPeriodo({ periodo, me, onEstadoChange, equipoId, modo = 'consolidado' }) {
  const empleados = useFetch(getEmpleados, [me?.email])
  const festivos = useFetch(getFestivos, [me?.email])
  const turnos = useFetch(getTurnos, [me?.email])
  const equipos = useFetch(getEquipos, [me?.email])
  const beneficios = useFetch(getBeneficios, [me?.email])  // beneficios de empresa activos (#2)
  const beneActivos = useMemo(() => (beneficios.data || []).filter((b) => b.activa), [beneficios.data])
  // Minutos de alimentación por área (#4/#6): se descuentan solos, no se piden a mano.
  const mealDeArea = useMemo(() => Object.fromEntries((equipos.data || []).map((q) => [q.id, q.almuerzo_min ?? 60])), [equipos.data])
  const registros = useFetch(() => getRegistros(periodo.id), [me?.email, periodo.id])
  const novedades = useFetch(getNovedades, [me?.email])
  const estadoEq = useFetch(() => getEstadoEquipos(periodo.id), [me?.email, periodo.id])
  // Recarga TODO lo que cambia al cargar/quitar horarios. Antes solo se recargaba
  // `registros`, por eso descansos/novedades no aparecían hasta cambiar de pestaña. #1
  const recargarDatos = () => { registros.reload(); novedades.reload(); estadoEq.reload() }
  const [accion, setAccion] = useState(null)
  const [estado, setEstado] = useState(periodo.estado)
  // Área en foco: la que TH está revisando (equipoId) o la del usuario operativo.
  const areaId = equipoId || me?.equipo_id
  // Estado del flujo del área en foco: registro → pend_validacion → validado →
  // en_th (bloqueado a edición desde "validado").
  const flujo = useMemo(() => (estadoEq.data || []).find((p) => p.equipo_id === areaId)?.estado_flujo || 'registro', [estadoEq.data, areaId])
  const bloqueado = flujo === 'validado' || flujo === 'en_th' || flujo === 'aprobado'
  // Solo se edita en modo REGISTRO; en consolidado es lectura + validación/chat.
  const editable = modo === 'registro' && (me?.rol === 'registrador' || me?.rol === 'lider') && periodo.estado === 'abierto' && !bloqueado
  const [celda, setCelda] = useState(null)
  const [empSel, setEmpSel] = useState(null)
  const [diaDetalle, setDiaDetalle] = useState(null)  // #7 desglose de un día (TH)
  const [tip, setTip] = useState(null)

  // Asignación masiva: selección de empleados + horario + alcance.
  const [seleccion, setSeleccion] = useState(new Set())
  const [vistaReg, setVistaReg] = useState('completar')  // #3 'completar' | 'todos'
  const [bulkOpen, setBulkOpen] = useState(false)         // #2 modal de carga masiva
  const [bulkQuitar, setBulkQuitar] = useState(false)     // #1 abrir el modal directo en modo Quitar

  const dias = useMemo(() => diasDe(periodo.fecha_inicio, periodo.fecha_fin), [periodo])
  const festMap = useMemo(() => Object.fromEntries((festivos.data || []).map((f) => [f.fecha_descanso, f.nombre])), [festivos.data])
  // Cada día puede tener VARIOS bloques (turno partido, #5): mapa a lista.
  const regMap = useMemo(() => {
    const map = {}
    ;(registros.data || []).forEach((r) => { (map[`${r.empleado_id}|${r.fecha}`] ||= []).push(r) })
    return map
  }, [registros.data])
  const netDia = (arr) => (arr || []).reduce((a, r) => a + (r.duracion_neta_h || 0), 0)
  // Mapa de novedades (licencias/permisos) por empleado|día dentro del período.
  const iniP = periodo.fecha_inicio, finP = periodo.fecha_fin
  const novMap = useMemo(() => {
    const map = {}
    ;(novedades.data || []).forEach((n) => {
      const a = n.fecha_inicio < iniP ? iniP : n.fecha_inicio
      const b = n.fecha_fin > finP ? finP : n.fecha_fin
      if (a <= b) rangoISO(a, b).forEach((iso) => { map[`${n.empleado_id}|${iso}`] = n })
    })
    return map
  }, [novedades.data, iniP, finP])

  // Filtra al área en foco. #2 Los LÍDERES no se agendan (no llevan horario/extras):
  // no aparecen para cargar horario, solo manejan su perfil.
  // Aparece en la grilla quien LLEVA HORARIO (y está activo: /empleados ya solo trae
  // activos). No se mira el rol: un líder que trabaja turnos SÍ va, y Talento Humano no.
  const emps = (empleados.data || []).filter((e) => (!areaId || e.equipo_id === areaId) && e.lleva_horario)
  // Un empleado está "cargado" (aparece en la grilla) si tiene algún horario o
  // novedad en el período. Los "pendientes" son los que faltan por cargar (#5).
  const tieneAlgo = (empId) => dias.some((d) => regMap[`${empId}|${d.iso}`] || novMap[`${empId}|${d.iso}`])
  const asignados = emps.filter((e) => tieneAlgo(e.id))
  // #1 Días laborables SIN cargar (excluye el descanso semanal). Sirve para la
  // señal de "le falta X" y para poder rellenar el resto sin ir uno por uno.
  // #4 El sábado (dow 6) y el descanso semanal no cuentan como "faltan": son descanso por defecto (L-V).
  const diasFaltantes = (emp) => dias.filter((d) => d.dow !== (DIA_DOW[(emp.dia_descanso || 'domingo').toLowerCase()] ?? 0) && d.dow !== 6 && !(regMap[`${emp.id}|${d.iso}`] || novMap[`${emp.id}|${d.iso}`]))
  const faltanMap = Object.fromEntries(emps.map((e) => [e.id, diasFaltantes(e).length]))
  // "Por cargar" = a quienes les falta ≥1 día laborable (incluye los parciales),
  // para poder completar el resto desde el mismo panel (#1).
  const pendientes = emps.filter((e) => faltanMap[e.id] > 0)
  // En REGISTRO la grilla muestra solo lo cargado; en consolidado, todos.
  const filas = modo === 'registro' ? asignados : emps
  const toggle = (id) => setSeleccion((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleTodos = () => setSeleccion((s) => (s.size === pendientes.length ? new Set() : new Set(pendientes.map((e) => e.id))))

  // #2/#3 Carga masiva: empleados seleccionados + días + turno del catálogo O un
  // horario manual (entrada/salida) que no está en la lista (no guarda ni recomienda).
  const cargarHorarioBulk = async (turnoId, fechas, manual, descanso, quitar) => {
    const ids = [...seleccion]
    if (!ids.length) { toast('Elige al menos un empleado.', 'info'); return }
    if (!fechas || !fechas.length) { toast('Elige al menos un día.', 'info'); return }
    setAccion('bulk')
    try {
      const payload = { empleado_ids: ids, fechas, sobrescribir: false }
      if (quitar) payload.es_quitar = true
      else if (descanso) payload.es_descanso = true
      else if (manual) { payload.hora_inicio = manual.hora_inicio; payload.hora_fin = manual.hora_fin }
      else payload.turno_id = turnoId || null
      await asignar(periodo.id, payload)
      // #2 NO se cierra el modal ni se pierde la selección de empleados: queda abierto
      // para seguir cargando (los días recién puestos salen solos de la lista).
      recargarDatos()
    } catch (e) { toast(e.message, 'error') } finally { setAccion(null) }
  }
  // Quitar la fila de un empleado = borrar sus horarios del período; vuelve a
  // aparecer en la lista de pendientes para volver a cargarlo (#5).
  // Quitar la fila = borrar TODO lo del empleado en el período (horarios Y
  // novedades/descansos) para que vuelva a "pendientes" (#5).
  const quitarFila = async (emp) => {
    const suyos = (registros.data || []).filter((r) => r.empleado_id === emp.id)
    const novs = (novedades.data || []).filter((n) => n.empleado_id === emp.id
      && n.fecha_inicio <= periodo.fecha_fin && n.fecha_fin >= periodo.fecha_inicio)
    setAccion('quitar-' + emp.id)
    try {
      for (const r of suyos) await deleteRegistro(r.id)
      for (const n of novs) await deleteNovedad(n.id)
      recargarDatos()
    } catch (e) { toast(e.message, 'error') } finally { setAccion(null) }
  }
  // Quitar el horario/novedad de UN día de un empleado (desde su detalle).
  const quitarDiaEmp = async (emp, iso) => {
    const suyos = (registros.data || []).filter((r) => r.empleado_id === emp.id && r.fecha === iso)
    const novs = (novedades.data || []).filter((n) => n.empleado_id === emp.id && n.fecha_inicio <= iso && n.fecha_fin >= iso)
    if (!suyos.length && !novs.length) return
    setAccion('quitar-dia')
    try {
      for (const r of suyos) await deleteRegistro(r.id)
      for (const n of novs) await deleteNovedad(n.id)
      recargarDatos()
    } catch (e) { toast(e.message, 'error') } finally { setAccion(null) }
  }
  const [comentTick, setComentTick] = useState(0)  // fuerza recarga del timeline
  const refrescar = () => { recargarDatos(); setComentTick((t) => t + 1) }
  // #1 Si el área no está lista, el backend responde estructurado → se muestra como
  // modal ordenado en vez de un toast.
  const [faltanModal, setFaltanModal] = useState(null)
  const conAviso = (fn) => async () => { try { await fn() } catch (e) { if (e?.data?.tipo === 'area_incompleta') setFaltanModal(e.data); else toast(e.message, 'error') } }
  const enviarValidar = conAviso(async () => { setAccion('validar-env'); try { await enviarValidacion(periodo.id); refrescar() } finally { setAccion(null) } })
  const enviar = conAviso(async () => { setAccion('enviar'); try { await enviarPeriodo(periodo.id); setEstado('en_revision'); refrescar(); onEstadoChange?.('en_revision') } finally { setAccion(null) } })
  const [devolverOpen, setDevolverOpen] = useState(false)
  const validar = conAviso(async () => { setAccion('validar'); try { await validarLider(periodo.id); refrescar() } finally { setAccion(null) } })
  const aprobar = conAviso(async () => { setAccion('aprobar'); try { await aprobarPeriodo(periodo.id, { equipo_id: areaId || null }); refrescar() } finally { setAccion(null) } })
  const onDevolver = async (texto) => {
    setAccion('devolver')
    try { await devolverPeriodo(periodo.id, { texto, tipo: 'observacion', equipo_id: areaId || null }); setEstado('abierto'); setDevolverOpen(false); refrescar(); onEstadoChange?.('abierto') }
    finally { setAccion(null) }
  }

  const cargando = empleados.loading || registros.loading
  const nSel = seleccion.size

  const esOperativo = me?.rol === 'registrador' || me?.rol === 'lider'
  return (
    <div>
      {/* #1 El stepper del flujo aparece SOLO en Consolidado y chat, no en el registro. */}
      {esOperativo && modo === 'consolidado' && estado !== 'cerrado' && (
        <FlujoStepper flujo={flujo} registroLabel={flujo === 'registro' ? (asignados.length === 0 ? 'Pendiente' : 'En proceso') : 'Registro'} />
      )}

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="font-semibold text-slate-700 text-[14px]">{periodo.nombre}</span>
        <span className="text-[12px] text-slate-400 tabular">({periodo.fecha_inicio} → {periodo.fecha_fin})</span>
        <Badge tone={estado}>{{ abierto: 'En curso', en_revision: 'En revisión', cerrado: 'Cerrado' }[estado]}</Badge>
        {bloqueado && <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full"><Lock size={11} /> Bloqueado (validado)</span>}
        <div className="flex-1" />

        {/* Botones de flujo: SOLO en el consolidado (validación/envío/devolución) */}
        {modo === 'consolidado' && <>
          {me?.rol === 'registrador' && estado === 'abierto' && flujo === 'registro' && (
            <Btn onClick={enviarValidar} disabled={accion === 'validar-env'}><ShieldCheck size={14} /> {accion === 'validar-env' ? '…' : 'Enviar a validación del líder'}</Btn>
          )}
          {me?.rol === 'registrador' && flujo === 'pend_validacion' && (
            <span className="text-[12px] text-amber-700 bg-amber-50 px-2.5 py-1.5 rounded-lg">Esperando validación del líder…</span>
          )}
          {me?.rol === 'registrador' && flujo === 'validado' && estado === 'abierto' && (
            <Btn onClick={enviar} disabled={accion === 'enviar'}><Send size={14} /> {accion === 'enviar' ? '…' : 'Enviar a Talento Humano'}</Btn>
          )}
          {me?.rol === 'lider' && estado === 'abierto' && (flujo === 'registro' || flujo === 'pend_validacion') && (
            <Btn onClick={validar} disabled={accion === 'validar'}><CheckCircle2 size={14} /> {accion === 'validar' ? '…' : 'Validar como líder'}</Btn>
          )}
          {me?.rol === 'lider' && flujo === 'validado' && estado === 'abierto' && (
            <Btn onClick={enviar} disabled={accion === 'enviar'}><Send size={14} /> {accion === 'enviar' ? '…' : 'Enviar a Talento Humano'}</Btn>
          )}
          {me?.rol === 'super_admin' && flujo === 'en_th' && (
            <>
              <Btn onClick={aprobar} disabled={accion === 'aprobar'}><ShieldCheck size={14} /> {accion === 'aprobar' ? '…' : 'Aprobar el área'}</Btn>
              <span className="text-[11px] text-slate-400">Para devolver, escribe un comentario u observación en el chat.</span>
            </>
          )}
        </>}
      </div>

      {periodo.nota && (
        <div className="mb-3 rounded-lg border border-blue-100 bg-blue-50/60 px-3 py-2 text-[12px] text-blue-800">
          <strong>Nota del período:</strong> {periodo.nota}
        </div>
      )}

      {bloqueado && esOperativo && modo === 'registro' && (
        <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-600 flex items-center gap-2">
          <Lock size={13} className="text-slate-400" /> El líder ya validó: los horarios quedan bloqueados. Para corregir, el líder o TH debe <strong>devolver</strong> el período (en Consolidado).
        </div>
      )}

      {/* #1 En REGISTRO se trabaja POR EMPLEADO (lista); el conglomerado (grilla de
          días) se ve en Consolidado y chat. */}
      {modo === 'registro' ? (
        (() => {
          // #3 "Por completar" = a quienes les falta ≥1 día (salen al completarse);
          // "Con horario" = SOLO quienes ya tienen algo cargado (para ajustar/novedades).
          const listaReg = vistaReg === 'completar' ? pendientes : asignados
          return (
            <>
              {editable && (
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-[12px]">
                    <button onClick={() => { setVistaReg('completar'); setSeleccion(new Set()) }} className={`px-2.5 py-1.5 font-medium ${vistaReg === 'completar' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600'}`}>Por completar ({pendientes.length})</button>
                    <button onClick={() => { setVistaReg('todos'); setSeleccion(new Set()) }} className={`px-2.5 py-1.5 font-medium ${vistaReg === 'todos' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600'}`}>Con horario ({asignados.length})</button>
                  </div>
                  <div className="flex-1" />
                  {listaReg.length > 0 && (
                    <button onClick={() => setSeleccion((s) => (s.size >= listaReg.length ? new Set() : new Set(listaReg.map((e) => e.id))))} className="text-[12px] text-blue-600 hover:text-blue-700">{seleccion.size >= listaReg.length ? 'Quitar selección' : 'Seleccionar todos'}</button>
                  )}
                  {vistaReg === 'completar' ? (
                    <Btn onClick={() => { setBulkQuitar(false); setBulkOpen(true) }} disabled={!nSel}><Sparkles size={14} /> Cargar horario{nSel ? ` (${nSel})` : ''}</Btn>
                  ) : (
                    <Btn variant="ghost" onClick={() => { setBulkQuitar(true); setBulkOpen(true) }} disabled={!nSel}><Trash2 size={14} /> Quitar horario{nSel ? ` (${nSel})` : ''}</Btn>
                  )}
                </div>
              )}
              <Card className="p-0">
                {cargando ? <div className="p-5"><Spinner /></div> : listaReg.length === 0 ? (
                  <EmptyState>{vistaReg === 'completar' ? 'Todos completaron su horario ✓' : 'Aún nadie tiene horario cargado. Cárgalo en “Por completar”.'}</EmptyState>
                ) : (
                  <ul className="divide-y divide-slate-50">
                    {listaReg.map((e) => {
                      const falt = faltanMap[e.id]
                      const total = dias.reduce((a, d) => a + netDia(regMap[`${e.id}|${d.iso}`]), 0)
                      const sel = seleccion.has(e.id)
                      const badge = falt > 0
                        ? <span className="shrink-0 text-[10px] font-bold text-amber-700 bg-amber-100 rounded-full px-2 py-0.5">falta</span>
                        : <span className="shrink-0 text-[10px] font-bold text-emerald-700 bg-emerald-100 rounded-full px-2 py-0.5">completo ✓</span>
                      const nombreBloque = (
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-slate-700 flex items-center gap-2">
                            <span className="truncate">{e.nombre}</span>{badge}
                          </div>
                          <div className="text-[12px] text-slate-400">{vistaReg === 'completar'
                            ? (total > 0 ? `${total.toFixed(1)} h cargadas` : 'Sin horario aún')
                            : (total > 0 ? `${total.toFixed(1)} h cargadas · abre para ajustar o marcar novedad` : 'Sin horario · abre para cargar o marcar novedad')}</div>
                        </div>
                      )
                      return (
                        <li key={e.id} className={`flex items-center gap-2 px-4 py-3 ${editable ? 'hover:bg-slate-50' : ''}`}>
                          {/* Checkbox en ambas vistas: en "completar" para cargar; en "Con
                              horario" para quitar en bloque (#1). */}
                          <input type="checkbox" className="accent-[#16697a] shrink-0" checked={sel} onChange={() => toggle(e.id)} disabled={!editable} title={vistaReg === 'completar' ? 'Seleccionar para cargar' : 'Seleccionar para quitar'} />
                          {vistaReg === 'completar' ? (
                            <label className="flex-1 flex items-center gap-2.5 cursor-pointer min-w-0" onClick={() => editable && toggle(e.id)}>{nombreBloque}</label>
                          ) : (
                            /* "Con horario" = abrir a la persona para ajustes/novedades por día. */
                            <button onClick={() => editable && setEmpSel(e)} disabled={!editable} className="flex-1 flex items-center justify-between gap-3 text-left min-w-0">
                              {nombreBloque}
                              {editable && <ChevronRight size={16} className="text-slate-300 shrink-0" />}
                            </button>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </Card>
              <p className="text-[12px] text-slate-400 mt-2">{vistaReg === 'completar'
                ? <>Marca empleados y pulsa <strong>Cargar horario</strong> para asignarles turnos por días (solo rellena lo vacío).</>
                : <>Abre a una persona para <strong>ajustes y novedades</strong> por día: cambiar horario, entrada/salida, bloques, licencias o descansos.</>}</p>
            </>
          )
        })()
      ) : (
      <Card className="p-0">
        {cargando && <div className="p-5"><Spinner /></div>}
        {!cargando && filas.length === 0 && (
          <EmptyState>No hay empleados en este equipo.</EmptyState>
        )}
        {!cargando && filas.length > 0 && (
          <div className="overflow-x-auto scroll-thin">
            <table className="text-[12px] border-collapse w-full">
              <thead>
                <tr className="bg-slate-50/70">
                  <th className="sticky left-0 bg-slate-50/70 z-10 text-left px-3 py-2.5 font-semibold text-slate-500 min-w-[210px]">Empleado</th>
                  {dias.map((d) => {
                    const fest = festMap[d.iso]
                    const rest = !!fest || d.dow === 0  // festivo o domingo = descanso (#2)
                    return (
                      <th key={d.iso}
                        onClick={() => setDiaDetalle(d.iso)}
                        onMouseEnter={fest ? (e) => setTip({ x: e.clientX, y: e.clientY, title: fest, lines: ['Festivo (se trata como dominical)', 'Clic: desglose del día'] }) : (e) => setTip({ x: e.clientX, y: e.clientY, title: `${DOW[d.dow]} ${d.num}`, lines: ['Clic: desglose del día'] })}
                        onMouseLeave={() => setTip(null)}
                        className={`px-1.5 py-1.5 text-center font-medium cursor-pointer hover:bg-blue-50 ${rest ? 'bg-rose-50 text-rose-500' : 'text-slate-500'}`}>
                        <div className="text-[10px]">{DOW[d.dow]}</div>
                        <div className={`tabular font-semibold ${fest ? 'relative' : ''}`}>{d.num}{fest && <span className="absolute -top-0.5 -right-1 w-1.5 h-1.5 rounded-full bg-rose-500" />}</div>
                      </th>
                    )
                  })}
                  <th className="px-3 py-2.5 text-right font-semibold text-slate-500">Neto</th>
                  {editable && <th className="px-2" />}
                </tr>
              </thead>
              <tbody>
                {filas.map((emp, i) => {
                  const total = dias.reduce((a, d) => a + netDia(regMap[`${emp.id}|${d.iso}`]), 0)
                  return (
                    <tr key={emp.id} className={i % 2 ? 'bg-slate-50/30' : ''}>
                      <td className="sticky left-0 z-10 px-3 py-3" style={{ backgroundColor: i % 2 ? '#fafbfc' : '#fff' }}>
                        <button onClick={() => setEmpSel(emp)} className="text-left group hover:text-blue-700">
                          <div className="font-semibold text-slate-700 group-hover:text-blue-700 flex items-center gap-1">
                            {emp.nombre}<ChevronRight size={13} className="opacity-0 group-hover:opacity-100 text-blue-600" />
                            {editable && faltanMap[emp.id] > 0 && (
                              <span title="Le falta cargar horario en días laborables"
                                className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">
                                falta
                              </span>
                            )}
                          </div>
                        </button>
                      </td>
                      {dias.map((d) => {
                        const arr = regMap[`${emp.id}|${d.iso}`] || []
                        const hay = arr.length > 0
                        const nd = netDia(arr)
                        const multi = arr.length > 1   // turno partido (#5)
                        const nov = novMap[`${emp.id}|${d.iso}`]
                        const fest = festMap[d.iso]
                        const rest = !!fest || d.dow === 0
                        const recargo = hay ? Math.max(0, ...arr.flatMap((r) => (r.clasificacion || []).map((s) => s.recargo_pct)), 0) : 0
                        const tieneExtra = hay && arr.some((r) => (r.clasificacion || []).some((s) => (s.category || '').startsWith('EXT')))
                        const esDescanso = nov?.tipo === 'DESCANSO'
                        // #3 El descanso NO se asume por defecto: los días sin nada quedan en
                        // "–" y el usuario marca el descanso a mano (antes el domingo/sábado
                        // salían como "D" implícito).
                        const descansoImplicito = false
                        const lic = nov ? (esDescanso ? 'D' : (ABREV_LIC[nov.tipo] || (nov.tipo?.startsWith('BEN:') ? 'BEN' : 'LIC'))) : null
                        return (
                          <td key={d.iso} className={`text-center px-1 py-1 ${rest ? 'bg-rose-50/40' : ''}`}>
                            <button
                              disabled={!editable}
                              onClick={() => editable && setCelda({ emp, iso: d.iso, bloques: arr, novedad: nov })}
                              onMouseEnter={(e) => {
                                if (hay) setTip({ x: e.clientX, y: e.clientY, title: `${emp.nombre} · ${d.iso}${multi ? ' (partido)' : ''}`, lines: arr.flatMap((r) => [`${r.hora_inicio.slice(0, 5)}–${r.hora_fin.slice(0, 5)}:`, ...r.clasificacion.map((s) => `  ${s.label}: ${s.hours}h (${s.recargo_pct}%)`)]) })
                                else if (esDescanso) setTip({ x: e.clientX, y: e.clientY, title: `${emp.nombre} · ${d.iso}`, lines: ['Descanso (D)'] })
                                else if (nov) setTip({ x: e.clientX, y: e.clientY, title: LIC_MAP[nov.tipo]?.nombre || 'Licencia / beneficio', lines: ['Licencia / beneficio'] })
                                else if (descansoImplicito) setTip({ x: e.clientX, y: e.clientY, title: `${emp.nombre} · ${d.iso}`, lines: ['Descanso semanal (por defecto)', 'Si trabajó ese día, cárgale un horario.'] })
                                else setTip({ x: e.clientX, y: e.clientY, title: `${emp.nombre} · ${d.iso}`, lines: ['Sin asignar (–)'] })
                              }}
                              onMouseLeave={() => setTip(null)}
                              className={`relative min-w-[26px] rounded-md px-1 py-0.5 tabular transition ${editable ? 'cursor-pointer hover:ring-2 hover:ring-blue-300' : ''} ${
                                hay ? (recargo >= 90 ? 'bg-rose-500/15 text-rose-700 font-semibold' : recargo > 0 ? 'bg-amber-500/20 text-amber-800 font-semibold' : 'bg-slate-100 text-slate-700')
                                  : esDescanso ? 'bg-slate-100 text-slate-500 font-semibold'
                                  : nov ? 'bg-violet-100 text-violet-700 font-bold text-[10px]'
                                  : descansoImplicito ? 'text-slate-400 font-semibold'
                                  : 'text-slate-300'
                              }`}>
                              {hay ? nd.toFixed(1).replace(/\.0$/, '') : nov ? lic : descansoImplicito ? 'D' : '–'}
                              {/* Punto ÁMBAR = tiene recargo (nocturno/dominical/festivo); punto ÍNDIGO = tiene extra. */}
                              {recargo > 0 && <span className="absolute -top-1 -right-1 w-1.5 h-1.5 rounded-full bg-amber-500" title="Tiene recargo (nocturno/dominical/festivo)" />}
                              {tieneExtra && <span className="absolute -top-1 -left-1 w-1.5 h-1.5 rounded-full bg-indigo-600" title="Tiene horas extra" />}
                            </button>
                          </td>
                        )
                      })}
                      <td className="px-3 py-1.5 text-right font-mono tabular font-bold text-blue-700" style={{ backgroundColor: i % 2 ? '#fafbfc' : '#fff' }}>{total.toFixed(1)}</td>
                      {editable && (
                        <td className="px-2 text-center">
                          <button onClick={() => quitarFila(emp)} disabled={accion === 'quitar-' + emp.id}
                            title="Quitar del período (vuelve a pendientes)"
                            className="text-slate-300 hover:text-rose-500">
                            <Trash2 size={14} />
                          </button>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      )}

      {modo !== 'registro' && (
      <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px] text-slate-400">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-slate-100 inline-block" /> Ordinaria</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-amber-500/20 inline-block" /> Con recargo</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-rose-500/15 inline-block" /> Dominical / festivo</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-violet-100 inline-block" /> Licencia / beneficio</span>
        <span className="flex items-center gap-1.5"><span className="font-bold text-slate-500">D</span> Descanso</span>
        <span className="flex items-center gap-1.5"><span className="font-bold text-slate-300">–</span> Sin asignar</span>
        <span className="text-slate-300">·</span>
        <span className="flex items-center gap-1.5"><span className="relative inline-block w-3 h-3"><span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-amber-500" /></span> Punto = recargo</span>
        <span className="flex items-center gap-1.5"><span className="relative inline-block w-3 h-3"><span className="absolute -top-0.5 -left-0.5 w-1.5 h-1.5 rounded-full bg-indigo-600" /></span> Punto = extra</span>
      </div>
      )}

      {/* #1 Modal ordenado con lo que falta por completar antes de enviar. */}
      {faltanModal && (
        <div className="fixed inset-0 bg-black/30 z-[70] flex items-center justify-center p-4" onClick={() => setFaltanModal(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between p-5 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0"><AlertTriangle size={18} /></span>
                <h3 className="font-bold text-slate-800 text-[15px]">{faltanModal.titulo}</h3>
              </div>
              <button onClick={() => setFaltanModal(null)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            <div className="overflow-y-auto scroll-thin p-5 space-y-4">
              {faltanModal.faltantes?.length > 0 && (
                <div>
                  <p className="text-[12px] text-slate-500 mb-2">Marca un turno, licencia/beneficio o descanso en los días en <strong>“–”</strong>:</p>
                  <ul className="rounded-xl border border-slate-200 divide-y divide-slate-100">
                    {faltanModal.faltantes.map((f) => (
                      <li key={f.nombre} className="flex items-center justify-between gap-3 px-3 py-2">
                        <span className="text-[13px] text-slate-700 truncate">{f.nombre}</span>
                        <span className="shrink-0 text-[11px] font-bold text-amber-700 bg-amber-100 rounded-full px-2 py-0.5">falta</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {faltanModal.excede?.length > 0 && (
                <div>
                  <p className="text-[12px] text-rose-600 font-medium mb-2">Superan el tope legal de 12 h extra/semana:</p>
                  <ul className="rounded-xl border border-rose-100 bg-rose-50/40 divide-y divide-rose-100">
                    {faltanModal.excede.map((n) => <li key={n} className="px-3 py-2 text-[13px] text-slate-700">{n}</li>)}
                  </ul>
                </div>
              )}
            </div>
            <div className="p-4 border-t border-slate-100 flex justify-end">
              <Btn onClick={() => setFaltanModal(null)}>Entendido</Btn>
            </div>
          </div>
        </div>
      )}

      {tip && createPortal(
        <div style={{ left: tip.x + 14, top: tip.y + 14 }} className="fixed z-[120] max-w-[260px] bg-white border border-blue-200 shadow-xl rounded-lg px-3 py-2 pointer-events-none">
          <div className="text-[11px] font-semibold text-blue-700 mb-0.5">{tip.title}</div>
          {tip.lines.map((l, i) => <div key={i} className="text-[12px] text-slate-600">{l}</div>)}
        </div>, document.body)}

      {celda && (
        <CeldaEditor celda={celda} periodoId={periodo.id} turnos={turnos.data || []}
          mealMin={celda.bloques?.[0] ? Math.round((celda.bloques[0].tiempo_alimentacion_h || 0) * 60) : 60} beneficios={beneActivos}
          extrasDiarias={(equipos.data || []).find((q) => q.id === celda.emp?.equipo_id)?.extras_diarias ?? true}
          onClose={() => setCelda(null)} onSaved={() => recargarDatos()} />
      )}
      {empSel && (
        <EmpleadoModal emp={empSel} dias={dias} regMap={regMap} novMap={novMap} festMap={festMap} editable={editable}
          onDia={(iso, arr) => { setEmpSel(null); setCelda({ emp: empSel, iso, bloques: arr || [], novedad: novMap[`${empSel.id}|${iso}`] || null }) }}
          onQuitarDia={(iso) => quitarDiaEmp(empSel, iso)}
          onQuitarTodo={async () => { await quitarFila(empSel); setEmpSel(null) }}
          onClose={() => setEmpSel(null)} />
      )}
      {/* #7 Desglose de un día: qué reporta cada empleado ese día (para TH). */}
      {diaDetalle && (
        <DiaDetalleModal iso={diaDetalle} emps={filas} regMap={regMap} novMap={novMap} festMap={festMap}
          onEmpleado={(emp) => { setDiaDetalle(null); setEmpSel(emp) }}
          onClose={() => setDiaDetalle(null)} />
      )}
      {/* #2/#5 Carga masiva: días (multi) + horario. No lista los días que TODOS los
          empleados seleccionados ya tienen cargados. */}
      {bulkOpen && (() => {
        const selArr = [...seleccion]
        const cargado = (id, d) => (regMap[`${id}|${d.iso}`] || []).length > 0 || !!novMap[`${id}|${d.iso}`]
        const yaCargado = new Set(dias.filter((d) => selArr.length && selArr.every((id) => cargado(id, d))).map((d) => d.iso))
        const cargadoAlguno = new Set(dias.filter((d) => selArr.some((id) => cargado(id, d))).map((d) => d.iso))
        return (
          <BulkAsignarModal dias={dias} yaCargado={yaCargado} cargadoAlguno={cargadoAlguno} festMap={festMap}
            turnos={turnos.data || []} nSel={nSel} busy={accion === 'bulk'} arranqueQuitar={bulkQuitar}
            onAplicar={cargarHorarioBulk} onClose={() => { setBulkOpen(false); setBulkQuitar(false) }} />
        )
      })()}

      {/* Línea de tiempo + chat del ÁREA — solo en el consolidado (#4) */}
      {modo === 'consolidado' && <Comentarios key={comentTick} periodoId={periodo.id} me={me} equipoId={areaId} cerrado={flujo === 'aprobado'} />}

      {devolverOpen && (
        <DevolverModal onClose={() => setDevolverOpen(false)} onEnviar={onDevolver} busy={accion === 'devolver'} />
      )}
    </div>
  )
}

function DevolverModal({ onClose, onEnviar, busy }) {
  const [t, setT] = useState('')
  return (
    <div className="fixed inset-0 bg-black/30 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold text-slate-800 mb-2">Devolver con observaciones</h3>
        <p className="text-[12px] text-slate-500 mb-3">El registrador y el líder recibirán una notificación con tu observación.</p>
        <textarea value={t} onChange={(e) => setT(e.target.value)} rows={4} placeholder="Describe qué falta o qué corregir…"
          className="w-full border border-blue-200 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#16697a] focus:ring-2 focus:ring-[#16697a]/15" />
        <div className="flex gap-2 mt-3 justify-end">
          <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
          <Btn onClick={() => onEnviar(t.trim())} disabled={busy || !t.trim()}><Undo2 size={14} /> {busy ? 'Enviando…' : 'Devolver'}</Btn>
        </div>
      </div>
    </div>
  )
}

// Pasos del flujo del área (para el stepper del consolidado). El paso "registro"
// muestra "Pendiente"/"En proceso" según haya datos (registroLabel).
const FLUJO_PASOS = [
  { key: 'registro', label: 'Registro' },
  { key: 'pend_validacion', label: 'Validación líder' },
  { key: 'validado', label: 'Validado' },
  { key: 'en_th', label: 'En Talento Humano' },
  { key: 'aprobado', label: 'Aprobado' },
]

function FlujoStepper({ flujo, registroLabel }) {
  const idx = Math.max(0, FLUJO_PASOS.findIndex((p) => p.key === flujo))
  return (
    <div className="flex items-center gap-1 mb-3 flex-wrap">
      {FLUJO_PASOS.map((p, i) => {
        const done = i < idx, cur = i === idx
        const label = p.key === 'registro' && registroLabel ? registroLabel : p.label
        return (
          <div key={p.key} className="flex items-center gap-1">
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ${cur ? 'bg-blue-600 text-white' : done ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>
              <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] ${cur ? 'bg-white/25' : done ? 'bg-emerald-500 text-white' : 'bg-slate-300 text-white'}`}>{done ? '✓' : i + 1}</span>
              {label}
            </div>
            {i < FLUJO_PASOS.length - 1 && <ChevronRight size={13} className="text-slate-300" />}
          </div>
        )
      })}
    </div>
  )
}

// #2 Modal de carga masiva: elige DÍAS (multi) y el HORARIO del área, para los
// empleados ya seleccionados en la lista. Solo rellena los días vacíos.
function BulkAsignarModal({ dias, yaCargado = new Set(), cargadoAlguno = new Set(), festMap, turnos, nSel, busy, arranqueQuitar = false, onAplicar, onClose }) {
  const esRest = (d) => !!festMap[d.iso] || d.dow === 0    // domingo/festivo (rojo)
  const esSab = (d) => d.dow === 6                          // sábado (otro color, no auto)
  const esLaborable = (d) => !esRest(d) && !esSab(d)        // L-V: lo que entra a "hábiles"
  const [turnoSel, setTurnoSel] = useState(turnos[0]?.id || '')
  const [modoH, setModoH] = useState(arranqueQuitar ? 'quitar' : 'catalogo')   // 'catalogo' | 'manual' | 'descanso' | 'quitar'
  const [manIni, setManIni] = useState('08:00')
  const [manFin, setManFin] = useState('17:00')
  const [selDias, setSelDias] = useState(() => new Set())
  const quitar = modoH === 'quitar'
  // #5 En carga NO se listan los días ya cargados por todos; en "Quitar" se listan
  // SOLO los que tienen algo cargado (#3-prev). Además, si los días HÁBILES de una
  // semana ya están todos cargados, sus sábados/domingos se dan por descanso y NO se
  // listan (antes seguían apareciendo y confundían). #1
  const disponibles = useMemo(() => {
    if (quitar) return dias.filter((d) => cargadoAlguno.has(d.iso))
    const semanaConHabiles = new Set()  // lunes de semanas que TIENEN hábiles en el período
    const semanaPend = new Set()        // lunes de semanas con algún hábil aún sin cargar
    for (const d of dias) if (esLaborable(d)) { const k = lunesDe(d.iso); semanaConHabiles.add(k); if (!yaCargado.has(d.iso)) semanaPend.add(k) }
    return dias.filter((d) => {
      if (yaCargado.has(d.iso)) return false
      if (esLaborable(d)) return true
      const k = lunesDe(d.iso)
      // Descanso: ocultar SOLO si su semana tiene hábiles y ya están todos cargados.
      // Un fragmento de puro fin de semana (1ª semana del período, sin hábiles) SÍ se
      // muestra, para que la numeración arranque en SEM 1 y no se pierdan esos días. #1
      return !semanaConHabiles.has(k) || semanaPend.has(k)
    })
  }, [dias, quitar, yaCargado, cargadoAlguno, festMap])   // eslint-disable-line react-hooks/exhaustive-deps
  // Al cambiar de modo (p. ej. a Quitar) se limpia la selección (cambian los días).
  useEffect(() => { setSelDias(new Set()) }, [quitar])
  const semanas = useMemo(() => {
    const map = new Map()
    let n = 0
    for (const d of dias) {                 // la numeración de semana usa TODO el período
      const k = lunesDe(d.iso)
      if (!map.has(k)) { n += 1; map.set(k, { n, dias: [] }) }
    }
    const out = new Map()
    for (const d of disponibles) {          // pero solo se listan los días disponibles
      const k = lunesDe(d.iso)
      if (!out.has(k)) out.set(k, { n: map.get(k).n, dias: [] })
      out.get(k).dias.push(d)
    }
    return [...out.values()].sort((a, b) => a.n - b.n)
  }, [dias, disponibles])
  const toggleDia = (iso) => setSelDias((s) => { const n = new Set(s); n.has(iso) ? n.delete(iso) : n.add(iso); return n })
  const aplicar = () => {
    if (quitar) onAplicar(null, [...selDias], null, false, true)
    else if (modoH === 'descanso') onAplicar(null, [...selDias], null, true)
    else if (modoH === 'manual') onAplicar(null, [...selDias], { hora_inicio: manIni, hora_fin: manFin })
    else onAplicar(turnoSel || null, [...selDias])
    setSelDias(new Set())   // #2 limpia los días elegidos; el modal queda ABIERTO para seguir cargando
  }
  return (
    <div className="fixed inset-0 bg-black/30 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[88vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between p-5 border-b border-slate-100">
          <div>
            <h3 className="font-bold text-slate-800">{quitar ? 'Quitar horario' : 'Cargar horario'}</h3>
            <p className="text-[12px] text-slate-500">A {nSel} empleado{nSel !== 1 ? 's' : ''} · {quitar ? 'elige los días a quitar (o Todos).' : 'elige los días y el turno del área.'}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <div className="p-5 overflow-y-auto scroll-thin space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[12px] font-medium text-slate-500">Días ({selDias.size})</span>
              <span className="text-[11px]">
                <button onClick={() => setSelDias(new Set((quitar ? disponibles : disponibles.filter(esLaborable)).map((d) => d.iso)))} className="text-blue-600 hover:text-blue-700">{quitar ? 'Todos' : 'Todos los hábiles'}</button>
                <span className="text-slate-300"> · </span>
                <button onClick={() => setSelDias(new Set())} className="text-slate-500 hover:text-slate-600">Ninguno</button>
              </span>
            </div>
            {semanas.length === 0 && <p className={`text-[13px] rounded-lg px-3 py-2 ${quitar ? 'text-slate-500 bg-slate-50' : 'text-emerald-700 bg-emerald-50'}`}>{quitar ? 'No hay días con horario cargado para quitar.' : 'Todos los días ya tienen horario para los seleccionados ✓'}</p>}
            <div className="space-y-2.5">
              {semanas.map((sm) => {
                // "Marcar semana" y "hábiles" son L-V (el sábado no entra por defecto);
                // en "Quitar" se pueden marcar todos los días cargados.
                const habiles = quitar ? sm.dias : sm.dias.filter(esLaborable)
                const todosSel = habiles.length > 0 && habiles.every((d) => selDias.has(d.iso))
                return (
                  <div key={sm.n}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Sem {sm.n}</span>
                      <button onClick={() => setSelDias((s) => { const n = new Set(s); habiles.forEach((d) => todosSel ? n.delete(d.iso) : n.add(d.iso)); return n })}
                        className="text-[10px] text-blue-600 hover:text-blue-700">{todosSel ? 'Quitar' : 'Marcar semana'}</button>
                    </div>
                    <div className="grid grid-cols-7 gap-1.5">
                      {sm.dias.map((d) => {
                        const rest = esRest(d); const sab = esSab(d); const on = selDias.has(d.iso)
                        return (
                          <button key={d.iso} onClick={() => toggleDia(d.iso)}
                            className={`rounded-lg py-1.5 text-center border transition ${on ? 'bg-blue-600 text-white border-blue-600' : rest ? 'bg-rose-50 text-rose-400 border-rose-100' : sab ? 'bg-amber-50 text-amber-500 border-amber-100 hover:border-amber-300' : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'}`}>
                            <div className="text-[9px] uppercase">{DOW[d.dow]}</div>
                            <div className="text-[13px] font-semibold tabular">{d.num}</div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
            <p className="text-[11px] text-slate-400 mt-1.5"><span className="text-rose-400">Rosa</span> = domingo/festivo (descanso). <span className="text-amber-500">Ámbar</span> = sábado (no entra en "Marcar semana"). Ambos se cargan solo si los marcas.</p>
          </div>
          <div>
            <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-[12px] mb-2">
              <button onClick={() => setModoH('catalogo')} className={`px-2.5 py-1.5 ${modoH === 'catalogo' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600'}`}>Del catálogo</button>
              <button onClick={() => setModoH('manual')} className={`px-2.5 py-1.5 ${modoH === 'manual' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600'}`}>Manual</button>
              <button onClick={() => setModoH('descanso')} className={`px-2.5 py-1.5 ${modoH === 'descanso' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600'}`}>Descanso</button>
              <button onClick={() => setModoH('quitar')} className={`px-2.5 py-1.5 ${quitar ? 'bg-rose-600 text-white' : 'bg-white text-rose-600'}`}>Quitar</button>
            </div>
            {quitar && (
              <p className="text-[12px] text-slate-500 rounded-lg bg-rose-50 border border-rose-100 px-3 py-2">Los días marcados <strong>se borran</strong> (horario o novedad) para los empleados seleccionados. Arriba solo salen los días que ya tienen algo cargado.</p>
            )}
            {modoH === 'catalogo' && (
              <L label="Horario del área">
                <select className="inp" value={turnoSel} onChange={(e) => setTurnoSel(e.target.value)}>
                  {turnos.length === 0 && <option value="">Sin turnos configurados</option>}
                  {turnos.map((t) => <option key={t.id} value={t.id}>{t.abreviatura ? `${t.abreviatura} · ` : ''}{t.nombre} ({t.hora_inicio.slice(0, 5)}–{t.hora_fin.slice(0, 5)})</option>)}
                </select>
              </L>
            )}
            {modoH === 'manual' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <L label="Entrada"><input type="time" className="inp" value={manIni} onChange={(e) => setManIni(e.target.value)} /></L>
                  <L label="Salida"><input type="time" className="inp" value={manFin} onChange={(e) => setManFin(e.target.value)} /></L>
                </div>
                <p className="text-[11px] text-slate-400 mt-1.5">Horario puntual fuera del catálogo: se aplica tal cual, sin guardarlo ni proponerlo a TH (#3).</p>
              </>
            )}
            {modoH === 'descanso' && (
              <p className="text-[12px] text-slate-500 rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">Los días marcados quedarán como <strong>Descanso (D)</strong> para los empleados seleccionados (reemplaza el horario de ese día).</p>
            )}
          </div>
        </div>
        <div className="p-4 border-t border-slate-100 flex justify-end gap-2">
          <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
          {quitar ? (
            <Btn onClick={aplicar} disabled={busy || !selDias.size} className="bg-rose-600 hover:bg-rose-500 border-rose-600">
              <Trash2 size={14} /> {busy ? 'Quitando…' : `Quitar a ${nSel}`}
            </Btn>
          ) : (
            <Btn onClick={aplicar} disabled={busy || !selDias.size || (modoH === 'catalogo' && !turnoSel)}>
              <Sparkles size={14} /> {busy ? 'Cargando…' : `Aplicar a ${nSel}`}
            </Btn>
          )}
        </div>
        <style>{`.inp{width:100%;border:1px solid #e2e8f0;border-radius:10px;padding:8px 10px;font-size:14px;background:#fff;outline:none}.inp:focus{border-color:#16697a}`}</style>
      </div>
    </div>
  )
}

// #7 Desglose de un día para TH: qué reporta cada empleado (horas + categorías).
function DiaDetalleModal({ iso, emps, regMap, novMap = {}, festMap, onEmpleado, onClose }) {
  const [y, mo, d] = iso.split('-').map(Number)
  const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay()
  const fest = festMap[iso]
  const filas = emps.map((e) => {
    const arr = regMap[`${e.id}|${iso}`] || []
    const nov = novMap[`${e.id}|${iso}`]
    const neto = arr.reduce((a, r) => a + (r.duracion_neta_h || 0), 0)
    const cats = {}
    arr.forEach((r) => (r.clasificacion || []).forEach((s) => { cats[s.label] = (cats[s.label] || 0) + s.hours }))
    return { e, arr, nov, neto, cats }
  }).filter((f) => f.arr.length || f.nov)
  const totCats = {}; let totNeto = 0
  filas.forEach((f) => { totNeto += f.neto; Object.entries(f.cats).forEach(([k, v]) => { totCats[k] = (totCats[k] || 0) + v }) })
  return (
    <div className="fixed inset-0 bg-black/30 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between p-5 border-b border-slate-100">
          <div>
            <h3 className="font-bold text-slate-800">Desglose del día</h3>
            <p className="text-[13px] text-slate-500">{['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][dow]} {iso}{fest && <span className="text-blue-600"> · {fest}</span>}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <div className="overflow-y-auto scroll-thin p-4 flex-1 min-h-0">
          {filas.length === 0 && <p className="text-[13px] text-slate-400 px-2 py-4">Nadie tiene horario ni novedad reportada este día.</p>}
          {filas.length > 0 && <p className="text-[11px] text-slate-400 px-1 pb-2">Clic en un empleado para ver su detalle del período.</p>}
          <ul className="divide-y divide-slate-50">
            {filas.map((f) => (
              <li key={f.e.id}>
                <button onClick={() => onEmpleado && onEmpleado(f.e)} className="w-full text-left py-2.5 px-1 rounded-lg hover:bg-blue-50/60 transition-colors">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-slate-700 text-[13.5px] truncate">{f.e.nombre}</span>
                    <span className={`text-[13px] font-bold tabular shrink-0 ${f.arr.length ? 'text-slate-800' : 'text-violet-600'}`}>{f.arr.length ? `${f.neto.toFixed(1)} h` : (f.nov?.tipo === 'DESCANSO' ? 'Descanso' : 'Licencia')}</span>
                  </div>
                  {f.arr.length > 0 && (() => {
                    const base = f.arr.filter((r) => !r.motivo)
                    const extras = f.arr.filter((r) => r.motivo)
                    return (
                      <div className="text-[12px] text-slate-500 mt-0.5">
                        {base.length > 0 && <span className="font-mono">{base.map((r) => `${r.hora_inicio.slice(0, 5)}–${r.hora_fin.slice(0, 5)}`).join(' + ')} <span className="font-sans text-slate-400">(turno)</span></span>}
                        {extras.map((r) => {
                          const fr = (r.clasificacion?.[0]?.category || '').includes('NOCT') ? 'nocturna' : 'diurna'
                          return <span key={r.id} className="block text-amber-600">+ {(r.duracion_neta_h || 0).toFixed(1)} h extra {fr} · {r.motivo}</span>
                        })}
                      </div>
                    )
                  })()}
                  {Object.keys(f.cats).length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {Object.entries(f.cats).map(([k, v]) => <span key={k} className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{k}: {v.toFixed(1)}h</span>)}
                    </div>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
        {filas.length > 0 && (
          <div className="p-4 border-t border-slate-100 shrink-0">
            <div className="flex items-center justify-between mb-1.5"><span className="text-[12px] font-semibold text-slate-600">Total del día ({filas.length})</span><span className="text-[13px] font-bold text-blue-700 tabular">{totNeto.toFixed(1)} h</span></div>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(totCats).map(([k, v]) => <span key={k} className="text-[11px] font-semibold px-2 py-0.5 rounded bg-blue-50 text-blue-700">{k}: {v.toFixed(1)}h</span>)}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function EmpleadoModal({ emp, dias, regMap, novMap = {}, festMap, editable = true, onDia, onQuitarDia, onQuitarTodo, onClose }) {
  const [quitando, setQuitando] = useState(false)
  const tieneAlgo = dias.some((d) => (regMap[`${emp.id}|${d.iso}`] || []).length > 0 || novMap[`${emp.id}|${d.iso}`])
  // #2 Se muestran los días con horario/novedad Y ADEMÁS los de descanso (sáb/dom/
  // festivo/día de descanso del empleado), por si hay que ajustar algo ahí.
  const restDow = DIA_DOW[(emp.dia_descanso || 'domingo').toLowerCase()] ?? 0
  const esRestDia = (d) => d.dow === restDow || d.dow === 6 || !!festMap[d.iso]
  const visibles = dias.filter((d) => (regMap[`${emp.id}|${d.iso}`] || []).length > 0 || novMap[`${emp.id}|${d.iso}`] || esRestDia(d))
  // Numeración de semanas del período (SEM 1, SEM 2…) para agrupar los días (#1).
  const semNum = new Map()
  { let n = 0; for (const d of dias) { const k = lunesDe(d.iso); if (!semNum.has(k)) { n += 1; semNum.set(k, n) } } }
  const semanas = []
  { const map = new Map(); for (const d of visibles) { const k = lunesDe(d.iso); if (!map.has(k)) map.set(k, { n: semNum.get(k), dias: [] }); map.get(k).dias.push(d) }
    semanas.push(...[...map.values()].sort((a, b) => a.n - b.n)) }
  const filaDia = (d) => {
    const arr = regMap[`${emp.id}|${d.iso}`] || []
    const nov = novMap[`${emp.id}|${d.iso}`]
    const fest = festMap[d.iso]
    const nd = arr.reduce((a, r) => a + (r.duracion_neta_h || 0), 0)
    const base = arr.filter((r) => !r.motivo)
    const extraH = arr.filter((r) => r.motivo).reduce((a, r) => a + (r.duracion_neta_h || 0), 0)
    const baseH = base.reduce((a, r) => a + (r.duracion_neta_h || 0), 0)
    const descImpl = !arr.length && !nov && esRestDia(d)   // descanso sin novedad explícita
    const detalle = arr.length
      ? `${base.map((r) => `${r.hora_inicio.slice(0, 5)}–${r.hora_fin.slice(0, 5)}`).join(' + ') || '—'} · ${baseH.toFixed(1)}h${extraH > 0 ? ` +${extraH.toFixed(1)}h extra` : ''}`
      : nov?.tipo === 'DESCANSO' ? 'Descanso (D)'
        : nov ? (LIC_MAP[nov.tipo]?.nombre || 'Licencia / beneficio')
          : 'Descanso'
    const conDatos = arr.length > 0 || !!nov
    return (
      <div key={d.iso} className="flex items-center gap-1 pr-1">
        <button onClick={() => editable && onDia(d.iso, arr)} className={`flex-1 flex items-center justify-between px-3 py-2 rounded-lg text-left min-w-0 ${editable ? 'hover:bg-slate-50 cursor-pointer' : 'cursor-default'}`}>
          <span className="text-[13px] text-slate-600">{['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'][d.dow]} {d.num} {fest && <span className="text-blue-600 text-[11px]">· {fest}</span>}</span>
          <span className={`text-[13px] font-mono tabular ${arr.length ? 'text-slate-700' : descImpl ? 'text-slate-400' : 'text-violet-600'}`}>{detalle}</span>
        </button>
        {editable && conDatos && onQuitarDia && (
          <button onClick={() => onQuitarDia(d.iso)} title="Quitar este día" className="text-rose-400 hover:text-rose-600 p-1.5 shrink-0"><Trash2 size={14} /></button>
        )}
      </div>
    )
  }
  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between p-5 border-b border-slate-100">
          <div>
            <h3 className="font-bold text-slate-800">{emp.nombre}</h3>
            <p className="text-[13px] text-slate-500">{emp.tipo_contrato} · {emp.tipo_jornada} · habitual {emp.horario_inicio_habitual?.slice(0, 5)}–{emp.horario_fin_habitual?.slice(0, 5)}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <div className="overflow-y-auto scroll-thin p-3 flex-1 min-h-0">
          <p className="text-[12px] text-slate-400 px-2 pb-2">{editable
            ? <>Clic en un día para ajustarlo o marcar una novedad; usa la <strong>papelera</strong> para quitar ese día.</>
            : <>Desglose día a día de <strong>{emp.nombre}</strong> en el período (solo lectura).</>}</p>
          {visibles.length === 0 && <p className="text-[13px] text-slate-400 px-3 py-4">Aún no tiene días con horario cargado.</p>}
          {semanas.map((sm) => (
            <div key={sm.n} className="mb-2">
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide px-2 py-1">Sem {sm.n}</div>
              {sm.dias.map((d) => filaDia(d))}
            </div>
          ))}
        </div>
        {editable && tieneAlgo && onQuitarTodo && (
          <div className="p-3 border-t border-slate-100 shrink-0 flex items-center justify-between gap-2">
            <span className="text-[12px] text-slate-400">Al quitar todo, vuelve a <strong>Por completar</strong>.</span>
            <Btn variant="ghost" disabled={quitando}
              onClick={async () => { if (!(await confirmar(`¿Quitar TODO el horario de ${emp.nombre} en este período? Volverá a "Por completar".`, { ok: 'Sí, quitar todo', peligro: true }))) return; setQuitando(true); await onQuitarTodo() }}>
              <Trash2 size={14} /> {quitando ? 'Quitando…' : 'Quitar todo el horario'}
            </Btn>
          </div>
        )}
      </div>
    </div>
  )
}

function CeldaEditor({ celda, periodoId, turnos = [], mealMin = 60, beneficios = [], extrasDiarias = true, onClose, onSaved }) {
  // Palabra del tiempo de más según el equipo: operativos (extras día a día) = "hora
  // extra"; administrativos (Deportivas/Operaciones) = "bloque" (extra solo si supera
  // el tope semanal, lo decide el motor). Evita confusiones al registrar (#).
  const palabraMas = extrasDiarias ? 'hora extra' : 'bloque'
  const { emp, iso } = celda
  // #4 Si el día AÚN NO se ha cumplido (futuro), el modal es de SOLO LECTURA: no se
  // agrega bloque, no se cambia el horario ni se marcan novedades; solo se ve.
  const _hoyC = new Date(); _hoyC.setHours(0, 0, 0, 0)
  const [_yC, _mC, _dC] = iso.split('-').map(Number)
  const diaFuturo = new Date(_yC, _mC - 1, _dC) > _hoyC
  // #1/#4 Los bloques y la novedad viven en estado LOCAL: al guardar se refrescan
  // en vivo (sin cerrar el modal) para poder ir agregando más bloques y verlos.
  const [bloques, setBloques] = useState(celda.bloques || [])
  const [novedad, setNovedad] = useState(celda.novedad || null)
  const registro = (celda.bloques || [])[0] || null   // primer bloque (para valores por defecto)
  const [tab, setTab] = useState(novedad && !bloques.length ? 'novedad' : 'horario')
  const [f, setF] = useState({
    hora_inicio: registro?.hora_inicio?.slice(0, 5) || emp.horario_inicio_habitual?.slice(0, 5) || '08:00',
    hora_fin: registro?.hora_fin?.slice(0, 5) || emp.horario_fin_habitual?.slice(0, 5) || '17:00',
    novedad: novedad?.tipo || 'VACACIONES',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  // Salida "base" del turno, para poder AMPLIARLA con horas extra (#14).
  const [baseFin, setBaseFin] = useState(f.hora_fin)
  const [extraH, setExtraH] = useState(0)
  const [motivo, setMotivo] = useState('')         // justificación de la extra/bloque (para TH)
  const [mealAct, setMealAct] = useState(mealMin)  // almuerzo del turno elegido (#4)
  const [editId, setEditId] = useState(null)       // bloque en edición (#5)
  // Modo del tab Horario (#9): 'ver' muestra lo cargado sin formulario; 'form'
  // muestra el formulario para AGREGAR o EDITAR. Si el día está vacío, arranca en form.
  const [modo, setModo] = useState(bloques.length ? 'ver' : 'form')
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }))
  // Editar un bloque ya cargado (#5): carga sus horas en el formulario. Si ese
  // bloque NO descontaba almuerzo (turno ≤ 8 h), al extenderlo tampoco lo hará (#6).
  const editarBloque = (b) => {
    setF((p) => ({ ...p, hora_inicio: b.hora_inicio.slice(0, 5), hora_fin: b.hora_fin.slice(0, 5) }))
    setBaseFin(b.hora_fin.slice(0, 5)); setExtraH(0); setMotivo(b.motivo || '')
    setMealAct((b.duracion_bruta_h - b.duracion_neta_h) > 0.01 ? (mealMin || 60) : 0)
    setEditId(b.id); setError(null); setTab('horario'); setModo('form')
  }
  // Abrir el formulario para AGREGAR un bloque. La entrada se prellena SEGUIDA al
  // último horario (el usuario la cambia si es otro momento del día); no descuenta
  // almuerzo (mealAct=0). La lógica decide si el bloque es extra (día a día o tope).
  const abrirAgregar = () => {
    setEditId(null); setError(null); setMealAct(0)
    if (bloques.length) {
      const finMax = Math.max(...bloques.map((b) => { let e = _toMin(b.hora_fin.slice(0, 5)); const i = _toMin(b.hora_inicio.slice(0, 5)); if (e <= i) e += 1440; return e }))
      const fmt = (t) => { t = ((t % 1440) + 1440) % 1440; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}` }
      const ini = fmt(finMax), fin = fmt(finMax + 60)
      setF((p) => ({ ...p, hora_inicio: ini, hora_fin: fin }))
      setBaseFin(fin); setExtraH(0)
    }
    setModo('form')
  }
  const cancelarForm = () => { setEditId(null); setError(null); setModo(bloques.length ? 'ver' : 'form') }
  const addHoras = (hhmm, n) => {
    const [h, mm] = hhmm.split(':').map(Number)
    const t = (h * 60 + mm + Math.round(n * 60)) % 1440
    return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
  }
  const aplicarExtra = (n) => { setExtraH(n); setF((p) => ({ ...p, hora_fin: addHoras(baseFin, Number(n) || 0) })) }

  // Horas netas EN VIVO = (salida − entrada) − almuerzo del área. Guía visual para

  // #1/#4 Refresca los bloques/novedad del día EN VIVO (sin cerrar) y recarga la
  // grilla del padre. Devuelve los bloques frescos para decidir el modo.
  const recargar = async () => {
    let delDia = []
    try {
      const [regs, novs] = await Promise.all([getRegistros(periodoId, emp.id), getNovedades(emp.id)])
      delDia = (regs || []).filter((r) => r.fecha === iso).sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio))
      setBloques(delDia)
      setNovedad((novs || []).find((n) => n.empleado_id === emp.id && n.fecha_inicio <= iso && n.fecha_fin >= iso) || null)
    } catch { /* noop */ }
    onSaved?.()
    return delDia
  }
  // Guardar reemplaza el día; Agregar bloque añade un turno partido (#5). Si el
  // día estaba como Descanso y se carga un horario, deja de ser descanso (#7).
  const guardarComun = async (reemplazar) => {
    setBusy(true); setError(null)
    try {
      if (editId) await deleteRegistro(editId)      // editar = reemplazar SOLO ese bloque
      if (novedad?.tipo === 'DESCANSO') await deleteNovedad(novedad.id)
      await createRegistro({ empleado_id: emp.id, periodo_id: periodoId, fecha: iso, hora_inicio: f.hora_inicio, hora_fin: f.hora_fin, meal_min: mealAct, reemplazar: editId ? false : reemplazar, motivo: motivo.trim() || null })
      const nb = await recargar()           // #1/#4 se ve al instante; el modal sigue abierto
      setEditId(null); setExtraH(0); setMotivo(''); setModo(nb.length ? 'ver' : 'form')
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const guardarHorario = () => guardarComun(true)
  const guardarEdicion = () => guardarComun(false)
  // #10 El bloque no puede pisarse con otro ya cargado ese día (excepto el que se edita).
  const _toMin = (hhmm) => { const [h, mm] = hhmm.split(':').map(Number); return h * 60 + mm }
  const otros = () => bloques.filter((b) => b.id !== editId)
  const solapa = () => {
    let a1 = _toMin(f.hora_inicio), b1 = _toMin(f.hora_fin); if (b1 <= a1) b1 += 1440
    return otros().some((bl) => {
      let a2 = _toMin(bl.hora_inicio.slice(0, 5)), b2 = _toMin(bl.hora_fin.slice(0, 5)); if (b2 <= a2) b2 += 1440
      return a1 < b2 && a2 < b1
    })
  }
  const agregarBloque = () => {
    // #7 Un bloque extra (conexión fuera de horario) es una NOVEDAD: solo se puede
    // cargar cuando el día ya terminó (una fecha anterior a hoy).
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0)
    const [yy, mm, dd] = iso.split('-').map(Number)
    if (new Date(yy, mm - 1, dd) >= hoy) { setError('Un bloque extra solo se carga cuando el día ya terminó (es una novedad de conexión).'); return }
    // El bloque puede ir seguido o en otro momento del día: solo NO puede cruzarse con
    // horas ya cargadas (la lógica decide si es extra por el tope/festivo).
    if (solapa()) { setError('El bloque se cruza con un horario ya cargado ese día. Ajusta la hora de entrada/salida.'); return }
    guardarComun(false)
  }
  const borrarBloque = async (id) => { setBusy(true); try { await deleteRegistro(id); const nb = await recargar(); setModo(nb.length ? 'ver' : 'form') } catch (e) { setError(e.message) } finally { setBusy(false) } }
  // Beneficio de empresa seleccionado (tipo con prefijo BEN:) o licencia legal.
  const benSel = beneficios.find((b) => `BEN:${b.id}` === f.novedad)
  // #3 Un día es UNA sola cosa (descanso O licencia O horario). Borra TODAS las
  // novedades del día antes de marcar otra, aunque hubiera duplicados colgados.
  const borrarNovedadesDelDia = async () => {
    const novs = await getNovedades(emp.id)
    for (const n of (novs || []).filter((n) => n.fecha_inicio <= iso && n.fecha_fin >= iso)) await deleteNovedad(n.id)
  }
  const guardarNovedad = async () => {
    setBusy(true); setError(null)
    try {
      for (const b of bloques) await deleteRegistro(b.id)
      await borrarNovedadesDelDia()
      const esRem = benSel ? !!benSel.remunerada : esPagada(f.novedad)
      // #1 Fracción de jornada que paga por día: beneficio de medio día (dias<1),
      // o licencia con fracción (votación = ½). Por defecto día completo.
      const fraccion = benSel ? (benSel.dias < 1 ? benSel.dias : 1.0) : (LIC_MAP[f.novedad]?.fraccion ?? 1.0)
      await createNovedad({ empleado_id: emp.id, periodo_id: periodoId, fecha_inicio: iso, fecha_fin: iso, tipo: f.novedad, es_remunerada: esRem, fraccion_dia: fraccion })
      await recargar()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  // Marcar el día como Descanso (D): una novedad tipo DESCANSO (#6).
  const guardarDescanso = async () => {
    // Si el día YA tiene horario cargado, pedir confirmación: marcarlo Descanso lo borra.
    if (bloques.length > 0 && !(await confirmar('Este día ya tiene horario cargado. Marcarlo como Descanso (D) borrará ese horario. ¿Continuar?', { ok: 'Sí, marcar Descanso', peligro: true }))) return
    setBusy(true); setError(null)
    try {
      for (const b of bloques) await deleteRegistro(b.id)
      await borrarNovedadesDelDia()
      await createNovedad({ empleado_id: emp.id, periodo_id: periodoId, fecha_inicio: iso, fecha_fin: iso, tipo: 'DESCANSO', es_remunerada: true })
      await recargar()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const quitar = async () => { setBusy(true); try { for (const b of bloques) await deleteRegistro(b.id); if (novedad) await deleteNovedad(novedad.id); await recargar(); setModo('form'); setTab('horario') } finally { setBusy(false) } }

  return (
    <div className="fixed inset-0 bg-black/30 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-3">
          <div><h3 className="font-bold text-slate-800">{emp.nombre}</h3><p className="text-[13px] text-slate-500">{iso} · {emp.tipo_jornada}</p></div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        {/* Estado actual del día: horario, descanso, licencia o sin asignar (–). */}
        <div className={`mb-4 rounded-lg px-3 py-2 text-[12px] ${
          bloques.length ? 'bg-slate-50 text-slate-600' : novedad?.tipo === 'DESCANSO' ? 'bg-slate-50 text-slate-600' : novedad ? 'bg-violet-50 text-violet-700' : 'bg-slate-50 text-slate-500'}`}>
          {bloques.length ? (
            <div>
              <div>Actualmente: <strong>{bloques.length > 1 ? `${bloques.length} bloques (turno partido)` : 'horario cargado'}</strong> · {bloques.reduce((a, b) => a + (b.duracion_neta_h || 0), 0).toFixed(1)} h netas.</div>
              {/* Desglose ordinaria/extra/recargo para saber qué se pagó como extra. */}
              {(() => {
                const cats = {}
                bloques.forEach((b) => (b.clasificacion || []).forEach((s) => { cats[s.label] = (cats[s.label] || 0) + s.hours }))
                const entries = Object.entries(cats).filter(([, v]) => v > 0)
                return entries.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {entries.map(([k, v]) => {
                      const esExtra = /extra/i.test(k)
                      return <span key={k} className={`text-[10.5px] font-semibold px-1.5 py-0.5 rounded ${esExtra ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-600'}`}>{k}: {v.toFixed(1)}h</span>
                    })}
                  </div>
                )
              })()}
              {bloques.map((b) => (
                <div key={b.id} className={`flex items-center justify-between gap-2 mt-1 ${editId === b.id ? 'bg-blue-100/60 rounded px-1' : ''}`}>
                  <span className="min-w-0">
                    <span className="font-mono tabular">{b.hora_inicio.slice(0, 5)}–{b.hora_fin.slice(0, 5)} · {b.duracion_neta_h.toFixed(1)} h{editId === b.id ? ' (editando)' : ''}</span>
                    {b.motivo && <span className="block text-[11px] text-amber-600 truncate">Motivo: {b.motivo}</span>}
                  </span>
                  {!diaFuturo && (
                  <span className="flex items-center gap-2">
                    <button onClick={() => editarBloque(b)} disabled={busy} title="Editar este horario" className="text-blue-600 hover:text-blue-700"><Pencil size={12} /></button>
                    <button onClick={() => borrarBloque(b.id)} disabled={busy} title="Quitar este bloque" className="text-rose-500 hover:text-rose-600"><Trash2 size={12} /></button>
                  </span>
                  )}
                </div>
              ))}
            </div>
          ) : novedad?.tipo === 'DESCANSO'
              ? <>Actualmente: <strong>Descanso (D)</strong>. No cuenta como horas trabajadas.</>
              : novedad
                ? <>Actualmente: <strong>{LIC_MAP[novedad.tipo]?.nombre || 'Licencia'}</strong>. No cuenta como horas trabajadas.</>
                : <>Sin asignar (<strong>“–”</strong>). Carga un turno, marca una licencia/beneficio o márcalo como <strong>Descanso</strong>.</>}
        </div>
        {/* #4 Día futuro: solo lectura (ya se ve el estado arriba). */}
        {diaFuturo ? (
          <p className="text-[12px] text-slate-500 rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">Este día <strong>aún no se ha cumplido</strong>: solo lectura. Podrás ajustar el horario o marcar novedades cuando el día pase.</p>
        ) : (<>
        {/* #2 El proceso legal es: 1) montar el horario y 2) luego, si el empleado se
            ausenta, marcar la licencia sobre ese día. Por eso la pestaña de licencia
            solo se habilita cuando el día YA tiene un horario cargado (o ya es novedad). */}
        {(() => {
          // #8 La novedad (licencia) solo se marca si el día YA se cumplió (no futuro).
          const hoyN = new Date(); hoyN.setHours(0, 0, 0, 0)
          const [yN, mN, dN] = iso.split('-').map(Number)
          const diaCumplido = new Date(yN, mN - 1, dN) <= hoyN
          const puedeNovedad = (bloques.length > 0 || !!novedad) && diaCumplido
          const hint = !diaCumplido
            ? 'No puedes marcar una novedad en un día que aún no se ha cumplido.'
            : 'Primero carga el horario del día; luego puedes marcar una licencia si el empleado se ausenta.'
          return (
        <>
        <div className="flex flex-wrap gap-2 mb-2">
          <button onClick={() => setTab('horario')} className={`text-[13px] px-3 py-1.5 rounded-lg ${tab === 'horario' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}>1 · Horario</button>
          <button onClick={() => puedeNovedad && setTab('novedad')} disabled={!puedeNovedad}
            title={puedeNovedad ? undefined : hint}
            className={`text-[13px] px-3 py-1.5 rounded-lg ${tab === 'novedad' ? 'bg-blue-600 text-white' : puedeNovedad ? 'bg-slate-100 text-slate-600' : 'bg-slate-50 text-slate-300 cursor-not-allowed'}`}>2 · Licencia / beneficio</button>
          <button onClick={guardarDescanso} disabled={busy} className={`text-[13px] px-3 py-1.5 rounded-lg ${novedad?.tipo === 'DESCANSO' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>Descanso (D)</button>
        </div>
        {!puedeNovedad && <p className="text-[11px] text-slate-400 mb-4">{!diaCumplido ? <>No puedes marcar una <strong>novedad</strong> en un día que aún no se ha cumplido.</> : <>Primero carga el <strong>horario</strong>; la licencia se marca sobre un día que ya tiene horario (o marca <strong>Descanso</strong> si no trabaja).</>}</p>}
        {puedeNovedad && <div className="mb-4" />}
        </>
        ); })()}
        {tab === 'horario' ? (
          modo === 'ver' ? (
            /* #9 Con horario ya cargado NO se muestra el formulario de entrada; solo
               las acciones. Editar un bloque es con su lápiz (arriba). */
            <div className="mt-1">
              <p className="text-[12px] text-slate-500 mb-3">El horario base es <strong>ordinario</strong>. {extrasDiarias
                ? <>El tiempo de más cuenta como <strong>hora extra</strong>.</>
                : <>El tiempo de más se agrega como <strong>bloque</strong>; será extra solo si la semana supera el tope (44/42 h).</>}</p>
              <div className="flex flex-wrap gap-2">
                <Btn onClick={() => abrirAgregar()} disabled={busy}><Plus size={14} /> Agregar {palabraMas}</Btn>
                <Btn variant="ghost" onClick={quitar} disabled={busy}><Trash2 size={14} /> Quitar día</Btn>
              </div>
            </div>
          ) : (
          <>
            {!editId && !bloques.length && turnos.length > 0 && (
              <L label="Turno rápido (opcional)">
                <select className="inp" defaultValue="" onChange={(e) => { const t = turnos.find((x) => x.id === e.target.value); if (t) { setF((p) => ({ ...p, hora_inicio: t.hora_inicio.slice(0, 5), hora_fin: t.hora_fin.slice(0, 5) })); setBaseFin(t.hora_fin.slice(0, 5)); setExtraH(0); setMealAct(t.almuerzo_min ?? 60) } }}>
                  <option value="">— Elegir turno —</option>
                  {turnos.map((t) => <option key={t.id} value={t.id}>{t.abreviatura ? `${t.abreviatura} · ` : ''}{t.nombre} ({t.hora_inicio.slice(0, 5)}–{t.hora_fin.slice(0, 5)})</option>)}
                </select>
              </L>
            )}
            <div className="grid grid-cols-2 gap-3 mt-3">
              <L label="Entrada"><input type="time" className="inp" value={f.hora_inicio} onChange={(e) => { set('hora_inicio')(e) }} /></L>
              <L label="Salida"><input type="time" className="inp" value={f.hora_fin} onChange={(e) => { set('hora_fin')(e); setBaseFin(e.target.value); setExtraH(0) }} /></L>
            </div>
            <p className="text-[11px] text-slate-400 mt-2">{bloques.length
              ? (extrasDiarias
                  ? <>Este tiempo se registra como <strong>extra</strong>. No descuenta almuerzo (el turno base ya lo descontó).</>
                  : <>Se agrega como <strong>bloque</strong>; será extra solo si la semana supera el tope. No descuenta almuerzo.</>)
              : <>Ajustas entrada y salida. Si el turno pasa de medianoche, la parte después de las 00:00 se guarda en el día siguiente.</>}</p>
            {(bloques.length > 0 || editId) && (
              <div className="mt-3">
                <L label="Motivo (para que TH lo valide)">
                  <input className="inp" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300}
                    placeholder="Ej.: Apoyo Correo electrónicos, Chat VIP, Reunión…" />
                </L>
              </div>
            )}
            <div className="flex flex-wrap gap-2 mt-4">
              {editId ? (
                <>
                  <Btn onClick={guardarEdicion} disabled={busy}>{busy ? 'Guardando…' : 'Guardar cambios'}</Btn>
                  <Btn variant="ghost" onClick={cancelarForm}>Cancelar</Btn>
                </>
              ) : bloques.length ? (
                <>
                  <Btn onClick={agregarBloque} disabled={busy}><Plus size={14} /> {busy ? 'Guardando…' : `Agregar ${palabraMas}`}</Btn>
                  <Btn variant="ghost" onClick={cancelarForm}>Cancelar</Btn>
                </>
              ) : (
                <Btn onClick={guardarHorario} disabled={busy}>{busy ? 'Guardando…' : 'Guardar horario'}</Btn>
              )}
            </div>
          </>
          )
        ) : (
          <>
            <L label="Tipo de licencia / beneficio">
              <select className="inp" value={f.novedad} onChange={set('novedad')}>
                <optgroup label="Licencias de ley">
                  {LICENCIAS.map((l) => <option key={l.tipo} value={l.tipo}>{l.nombre}</option>)}
                </optgroup>
                {beneficios.length > 0 && (
                  <optgroup label="Beneficios de la empresa">
                    {beneficios.map((b) => <option key={b.id} value={`BEN:${b.id}`}>{b.nombre}</option>)}
                  </optgroup>
                )}
              </select>
            </L>
            <div className="mt-3 rounded-xl bg-blue-50/50 border border-blue-100 p-3">
              {benSel ? (
                <>
                  <div className="text-[13px] font-semibold text-slate-700">{benSel.nombre}</div>
                  <div className="text-[12px] text-emerald-700 mt-0.5">{benSel.dias} día(s) · {benSel.remunerada ? 'remunerada' : 'no remunerada'} · Beneficio de la empresa</div>
                  {benSel.descripcion && <p className="text-[12px] text-slate-500 mt-1.5">{benSel.descripcion}</p>}
                </>
              ) : (
                <>
                  <div className="text-[13px] font-semibold text-slate-700">{LIC_MAP[f.novedad]?.nombre}</div>
                  <div className="text-[12px] text-blue-700 mt-0.5">{LIC_MAP[f.novedad]?.duracion} · paga {LIC_MAP[f.novedad]?.remunerada} ({LIC_MAP[f.novedad]?.quien_paga}) · {LIC_MAP[f.novedad]?.base_legal}</div>
                  <p className="text-[12px] text-slate-500 mt-1.5">{LIC_MAP[f.novedad]?.descripcion}</p>
                </>
              )}
              <p className="text-[11px] text-slate-400 mt-1.5">No es tiempo trabajado (no genera horas extra). Si es <strong>remunerada</strong>, paga la jornada del día{(benSel ? benSel.dias < 1 : LIC_MAP[f.novedad]?.fraccion === 0.5) ? ' (medio día = 4 h)' : ''}; aparece como “Lic. remunerada” en el reporte.</p>
            </div>
            <div className="mt-5"><Btn onClick={guardarNovedad} disabled={busy}>{busy ? 'Guardando…' : 'Marcar'}</Btn></div>
          </>
        )}
        </>)}
        {error && <p className="text-rose-600 text-[13px] mt-3">{error}</p>}
        {/* #4 Cierra el modal cuando el usuario terminó de agregar bloques/ajustes. */}
        <div className="mt-4 pt-3 border-t border-slate-100 flex justify-end">
          <Btn variant="ghost" onClick={onClose}><CheckCircle2 size={14} /> Listo</Btn>
        </div>
        <style>{`.inp{width:100%;border:1px solid #e2e8f0;border-radius:10px;padding:8px 10px;font-size:14px;background:#fff;outline:none}.inp:focus{border-color:#16697a;box-shadow:0 0 0 3px rgba(22,105,122,.12)}`}</style>
      </div>
    </div>
  )
}

function L({ label, children }) {
  return <label className="block"><span className="block text-[12px] font-medium text-slate-500 mb-1.5">{label}</span>{children}</label>
}
