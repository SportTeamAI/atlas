import { useState } from 'react'
import { CalendarDays } from 'lucide-react'
import { getCalendarioNomina, getFestivos, getPagosManuales, getPeriodos } from '../api/client'
import { Card, PageHeader, Select, Spinner, useFetch } from '../components/ui'
import FestivosCalendar from '../components/FestivosCalendar'

// Calendario de nómina. Para TH (RH) muestra todo (reporte a TH, pago, reporte a
// financiera, primas/aguinaldo). Para líder/registrador SOLO cuándo enviar el
// reporte de novedades a TH (#7).
export default function CalendarioPage({ me }) {
  const esRH = me?.rol === 'super_admin'
  const [anio, setAnio] = useState(2026)   // #6/#18 año seleccionable
  // Años DISPONIBLES = los que tienen períodos (congruente con Configuración, #4).
  const periodosDB = useFetch(getPeriodos, [me?.email])
  const aniosDisp = [...new Set([2026, ...(periodosDB.data || []).map((p) => Number((p.fecha_pago || p.fecha_fin || '').slice(0, 4))).filter(Boolean)])].sort()
  const festivos = useFetch(getFestivos, [me?.email])
  // Calendario COMPLETO del año (todas las quincenas), solo para este módulo (#3).
  const periodos = useFetch(() => getCalendarioNomina(anio), [me?.email, anio])
  const pagos = useFetch(esRH ? getPagosManuales : () => Promise.resolve([]), [me?.email])

  const marcadores = []
  ;(periodos.data || []).forEach((p) => {
    // Reporte a TH lo ven todos (es su deadline de novedades).
    marcadores.push({ fecha: p.fecha_corte, tipo: 'th', label: `${p.nombre}: reporte de novedades a TH` })
    if (esRH) {
      if (p.fecha_reporte_financiera) marcadores.push({ fecha: p.fecha_reporte_financiera, tipo: 'fin', label: `${p.nombre}: reporte a Financiera` })
      if (p.fecha_pago) marcadores.push({ fecha: p.fecha_pago, tipo: 'pago', label: `${p.nombre}: día de pago` })
    }
  })
  if (esRH) (pagos.data || []).forEach((p) => marcadores.push({ fecha: p.fecha, tipo: p.tipo === 'aguinaldo' ? 'aguinaldo' : 'prima', label: `${p.tipo === 'aguinaldo' ? 'Aguinaldo' : 'Prima'}${p.descripcion ? ' – ' + p.descripcion : ''}` }))

  return (
    <div className="max-w-7xl mx-auto p-5 lg:p-7">
      <PageHeader icon={CalendarDays} title={`Calendario ${anio}`}
        subtitle={esRH ? 'Reporte a TH, día de pago, reporte a Financiera, primas y festivos.' : 'Cuándo debes enviar tu reporte de novedades a TH, y los festivos.'}
        action={<Select value={anio} onChange={(v) => setAnio(Number(v))} size="sm" className="w-24"
          options={aniosDisp.map((y) => ({ value: y, label: String(y) }))} />}
        info={{
          titulo: 'Calendario de nómina',
          descripcion: esRH
            ? 'Todas las fechas clave del ciclo de nómina para Talento Humano.'
            : 'Aquí ves cuándo cierra cada período y debes enviar tus novedades a TH.',
          pasos: esRH ? [
            { titulo: 'Reporte a TH (ámbar)', texto: 'Deadline para que líder/registrador envíen novedades (6 días hábiles antes del pago).' },
            { titulo: 'Financiera (violeta)', texto: '2 días hábiles después del reporte a TH.' },
            { titulo: 'Pago (verde)', texto: '15 y fin de mes; si no es hábil, el hábil anterior.' },
            { titulo: 'Primas/aguinaldo (rosa)', texto: 'Pagos manuales que registras en Configuración.' },
          ] : [
            { titulo: 'Reporte a TH (ámbar)', texto: 'La fecha tope para enviar tus novedades del período.' },
            { titulo: 'Festivos (teal)', texto: 'Festivos nacionales de Colombia.' },
          ],
        }} />
      <Card className="p-4">
        <div className="flex items-center gap-4 mb-3 text-[12px] text-slate-500 flex-wrap">
          <Leyenda color="bg-blue-600" texto="Festivo" />
          <Leyenda color="bg-amber-500" texto="Reporte a TH" />
          {esRH && <><Leyenda color="bg-violet-500" texto="Reporte a Financiera" /><Leyenda color="bg-emerald-500" texto="Día de pago" /><Leyenda color="bg-rose-500" texto="Prima" /><Leyenda color="bg-indigo-500" texto="Aguinaldo" /></>}
          <span className="text-slate-400">Pasa el mouse sobre un día marcado para ver el detalle.</span>
        </div>
        {(festivos.loading || periodos.loading) && <Spinner />}
        {festivos.data && <FestivosCalendar festivos={festivos.data} marcadores={marcadores} anio={anio} />}
      </Card>
    </div>
  )
}

function Leyenda({ color, texto }) {
  return <span className="flex items-center gap-1.5"><span className={`w-3 h-3 rounded inline-block ${color}`} /> {texto}</span>
}
