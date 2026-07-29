import { useState } from 'react'
import { CalendarRange, ChevronLeft, Lock } from 'lucide-react'
import { getPeriodos } from '../api/client'
import { Badge, Btn, Card, EmptyState, PageHeader, Select, Spinner, useFetch } from '../components/ui'
import GrillaPeriodo from '../components/GrillaPeriodo'

const ESTADO_LABEL = { abierto: 'Abierto', programado: 'Programado', en_revision: 'En revisión', cerrado: 'Cerrado' }

// Histórico de períodos. La creación de cortes vive en Configuración → Períodos.
export default function PeriodosPage({ me }) {
  const [sel, setSel] = useState(null)
  if (sel) {
    return (
      <div className="max-w-7xl mx-auto p-5 lg:p-7">
        <button onClick={() => setSel(null)} className="inline-flex items-center gap-1 text-[13px] text-slate-500 hover:text-slate-700 mb-3">
          <ChevronLeft size={15} /> Volver a períodos
        </button>
        <PageHeader icon={CalendarRange} title={sel.nombre || 'Período'} subtitle="Revisión y comentarios." />
        <GrillaPeriodo periodo={sel} me={me} />
      </div>
    )
  }
  return <Lista me={me} abrir={setSel} />
}

function Lista({ me, abrir }) {
  const { data, loading, error } = useFetch(getPeriodos, [me?.email])
  const [estadoF, setEstadoF] = useState('activos')  // por defecto oculta cerrados (#5)
  const lista = (data || []).filter((p) => estadoF === 'activos' ? p.estado !== 'cerrado' : p.estado === estadoF)

  return (
    <div className="max-w-5xl mx-auto p-5 lg:p-7">
      <PageHeader icon={CalendarRange} title="Períodos" subtitle="Histórico de cortes. La creación se hace en Configuración → Períodos (cortes)."
        info={{
          titulo: 'Períodos',
          descripcion: 'Un período es el rango de fechas (ej. 1-15) que se contabiliza para nómina. El corte es la FECHA TOPE para subir los horarios; lo que pase después entra al próximo período (por eso si hay una novedad post-cierre se hace una "solicitud de cambio").',
          pasos: [
            { titulo: 'Quincena', texto: 'Hay dos por mes: del 1 al 15 y del 16 al fin de mes. Son los mismos para TODOS los equipos.' },
            { titulo: 'Estado', texto: 'Abierto: se pueden cargar horarios · En revisión: enviado a TH · Cerrado: ya se contabilizó.' },
            { titulo: 'Apertura/cierre automático', texto: 'Se abre al entrar el rango de fechas y pasa a revisión cuando se pasa el corte.' },
          ],
        }}
        action={
          <Select value={estadoF} onChange={setEstadoF} size="sm" className="w-48"
            options={[
              { value: 'activos', label: 'Activos (sin cerrados)' },
              { value: 'abierto', label: 'En curso' },
              { value: 'en_revision', label: 'En revisión' },
              { value: 'cerrado', label: 'Cerrados (histórico)' },
            ]} />
        } />

      <Card>
        {loading && <div className="p-5"><Spinner /></div>}
        {error && <div className="p-5 text-rose-600 text-sm">{error}</div>}
        {data && lista.length === 0 && <EmptyState>No hay períodos para este filtro.</EmptyState>}
        {lista.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
                <th className="px-5 py-2.5 font-semibold">Período</th>
                <th className="px-3 py-2.5 font-semibold">Rango</th>
                <th className="px-3 py-2.5 font-semibold">Corte</th>
                <th className="px-3 py-2.5 font-semibold">Estado</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {lista.map((p) => (
                <tr key={p.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50 cursor-pointer" onClick={() => abrir(p)}>
                  <td className="px-5 py-2.5 font-medium text-slate-700">
                    <span className="inline-flex items-center gap-2">{p.nombre}{p.estado === 'cerrado' && <Lock size={12} className="text-slate-400" />}</span>
                  </td>
                  <td className="px-3 py-2.5 text-slate-500 tabular">{p.fecha_inicio} → {p.fecha_fin}</td>
                  <td className="px-3 py-2.5 text-amber-700 tabular font-semibold">{p.fecha_corte}</td>
                  <td className="px-3 py-2.5"><Badge tone={p.estado}>{ESTADO_LABEL[p.estado]}</Badge></td>
                  <td className="px-3 py-2.5 text-right"><Btn size="sm" variant="ghost">Inspeccionar</Btn></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}
