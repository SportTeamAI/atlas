import { Clock } from 'lucide-react'
import { getPeriodos } from '../api/client'
import { AvisoCorte, EmptyState, PageHeader, Spinner, useFetch } from '../components/ui'
import GrillaPeriodo from '../components/GrillaPeriodo'

// Registro de horario: SOLO el período EN CURSO (abierto) — #21.4.
export default function RegistrarHorarioPage({ me }) {
  const { data: periodos, loading } = useFetch(getPeriodos, [me?.email])
  const enCurso = (periodos || []).find((p) => p.estado === 'abierto')

  return (
    <div className="max-w-7xl mx-auto p-5 lg:p-7">
      <PageHeader icon={Clock} title="Registrar horario"
        subtitle={enCurso ? `Período en curso: ${enCurso.nombre}. Primero monta los horarios; luego, las novedades.` : 'Registro de horarios del período en curso.'}
        info={{
          titulo: 'Registrar horario (por empleado)',
          descripcion: 'Aquí se trabaja POR EMPLEADO: primero se montan los horarios y luego, sobre un día que ya tiene horario, se marca la licencia si el empleado se ausenta. La vista consolidada (grilla de días) y el chat están en Consolidado y chat.',
          pasos: [
            { titulo: '1 · Cargar horarios', texto: 'Arriba eliges a quién completar (cada uno muestra cuántos días le faltan), el turno y el alcance, y pulsas Aplicar. También puedes abrir un empleado de la lista para ajustar día a día.' },
            { titulo: '2 · Novedades', texto: 'La licencia/beneficio se marca sobre un día que YA tiene horario (si el empleado se ausenta). Un día sin horario queda como Descanso (D).' },
            { titulo: 'Horas extra', texto: 'Al abrir un día puedes ampliar la salida. Solo se pagan como extra si la SEMANA supera 44 h (42 h desde el 15-jul); si no, van con recargo.' },
            { titulo: 'Consolidar', texto: 'Cuando termines, ve a Consolidado y chat para revisar la grilla y enviar a validación del líder.' },
          ],
        }} />

      {enCurso && <AvisoCorte fecha={enCurso.fecha_corte} destino="th" />}
      {loading && <Spinner />}
      {periodos && !enCurso && (
        <EmptyState>No hay un período en curso ahora mismo. Talento Humano abre el período según el calendario.</EmptyState>
      )}
      {enCurso && <GrillaPeriodo periodo={enCurso} me={me} modo="registro" />}
    </div>
  )
}
