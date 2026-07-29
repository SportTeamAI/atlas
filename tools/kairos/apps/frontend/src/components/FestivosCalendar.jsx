import { useMemo } from 'react'
import { Tooltip } from './ui'

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
// La semana empieza en DOMINGO (#5).
const DOW = ['D', 'L', 'M', 'M', 'J', 'V', 'S']

// Estilo por tipo de marcador (prioridad festivo > th > fin > pago > prima/aguinaldo).
const TIPO = {
  festivo: { cls: 'bg-blue-600 text-white font-bold', titulo: 'Festivo' },
  th: { cls: 'bg-amber-500 text-white font-bold', titulo: 'Reporte a TH' },
  fin: { cls: 'bg-violet-500 text-white font-bold', titulo: 'Reporte a Financiera' },
  pago: { cls: 'bg-emerald-500 text-white font-bold', titulo: 'Día de pago' },
  prima: { cls: 'bg-rose-500 text-white font-bold', titulo: 'Prima' },
  aguinaldo: { cls: 'bg-indigo-500 text-white font-bold', titulo: 'Aguinaldo' },
}
const PRIORIDAD = ['festivo', 'th', 'fin', 'pago', 'prima', 'aguinaldo']

const hoyISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Calendario anual compacto. `marcadores`: [{ fecha, tipo, label }].
export default function FestivosCalendar({ festivos = [], marcadores = [], anio = 2026 }) {
  const mapa = useMemo(() => {
    const m = {}
    festivos.forEach((f) => { (m[f.fecha_descanso] ||= []).push({ tipo: 'festivo', label: f.nombre }) })
    marcadores.forEach((x) => { (m[x.fecha] ||= []).push({ tipo: x.tipo, label: x.label }) })
    return m
  }, [festivos, marcadores])
  const HOY = hoyISO()
  const ahora = new Date()
  const mesActual = ahora.getFullYear() === anio ? ahora.getMonth() : -1

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {MESES.map((nombre, mes) => (
        <MiniMes key={mes} nombre={nombre} anio={anio} mes={mes} mapa={mapa} hoy={HOY} actual={mes === mesActual} />
      ))}
    </div>
  )
}

function MiniMes({ nombre, anio, mes, mapa, hoy, actual }) {
  // getUTCDay: 0=domingo … como la semana empieza en domingo, el offset es directo.
  const offset = new Date(Date.UTC(anio, mes, 1)).getUTCDay()
  const diasMes = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate()
  const celdas = [...Array(offset).fill(null), ...Array.from({ length: diasMes }, (_, i) => i + 1)]

  return (
    <div className={`rounded-lg border bg-white p-2 ${actual ? 'border-[#16697a] ring-2 ring-[#16697a]/20 shadow-sm' : 'border-slate-100'}`}>
      <div className={`text-[12px] font-semibold mb-1.5 flex items-center gap-1.5 ${actual ? 'text-[#16697a]' : 'text-slate-700'}`}>
        {nombre}{actual && <span className="text-[9px] font-bold bg-[#16697a] text-white rounded px-1.5 py-0.5 uppercase tracking-wide">Mes actual</span>}
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {DOW.map((d, i) => <div key={i} className={`text-[8px] font-semibold ${i === 0 || i === 6 ? 'text-rose-400' : 'text-slate-300'}`}>{d}</div>)}
        {celdas.map((dia, i) => {
          if (!dia) return <div key={i} />
          const iso = `${anio}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
          const dow = (offset + dia - 1) % 7   // 0=domingo, 6=sábado
          const finde = dow === 0 || dow === 6
          const esHoy = iso === hoy
          const items = mapa[iso]
          const principal = items && items.length ? (PRIORIDAD.find((t) => items.some((x) => x.tipo === t)) || items[0].tipo) : null
          // Fin de semana sin marcador: número en rojo, sin color de fondo (#5).
          const cls = principal ? (TIPO[principal]?.cls || '') : finde ? 'text-rose-500 font-semibold' : 'text-slate-500'
          const anillo = esHoy ? 'ring-2 ring-[#16697a] ring-offset-1' : ''
          const cell = <div className={`text-[10px] rounded py-0.5 tabular ${cls} ${anillo}`}>{dia}</div>
          if (!items || items.length === 0) return <div key={i}>{cell}</div>
          return (
            <Tooltip key={i} content={<div className="space-y-1">
              {esHoy && <div className="font-semibold text-[#16697a]">Hoy</div>}
              {items.map((x, k) => (
                <div key={k}><div className="font-semibold text-blue-700">{TIPO[x.tipo]?.titulo || x.tipo}</div><div>{x.label}</div></div>
              ))}
            </div>}>
              {cell}
            </Tooltip>
          )
        })}
      </div>
    </div>
  )
}
