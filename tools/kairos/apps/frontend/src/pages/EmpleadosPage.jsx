import { useMemo, useState } from 'react'
import { UserCog } from 'lucide-react'
import { getEmpleados, getEquipos } from '../api/client'
import { Badge, Card, EmptyState, PageHeader, Spinner, useFetch } from '../components/ui'
import { CONTRATO_MAP } from '../data/contratos'

const JORNADA = { estandar: 'Estándar', flexible: 'Flexible', turno_continuo: 'Turno continuo', direccion_confianza: 'Dirección y confianza' }

// Vista de solo lectura de empleados, con filtro por área (la gestión está en Configuración).
export default function EmpleadosPage({ me }) {
  const { data, loading, error } = useFetch(getEmpleados, [me?.email])
  const equipos = useFetch(getEquipos, [me?.email])
  const eqMap = Object.fromEntries((equipos.data || []).map((e) => [e.id, e.nombre]))
  const [filtro, setFiltro] = useState('todos')

  const lista = useMemo(
    () => (data || []).filter((e) => filtro === 'todos' || e.equipo_id === filtro),
    [data, filtro],
  )

  return (
    <div className="max-w-6xl mx-auto p-5 lg:p-7">
      <PageHeader icon={UserCog} title="Empleados" subtitle="Consulta de empleados (la creación y edición está en Configuración)."
        action={
          <select value={filtro} onChange={(e) => setFiltro(e.target.value)}
            className="border border-blue-200 rounded-lg px-3 py-1.5 text-[13px] text-slate-700 bg-white outline-none focus:border-[#16697a] focus:ring-2 focus:ring-[#16697a]/15">
            <option value="todos">Todas las áreas</option>
            {(equipos.data || []).map((q) => <option key={q.id} value={q.id}>{q.nombre}</option>)}
          </select>
        } />

      <Card>
        {loading && <div className="p-5"><Spinner /></div>}
        {error && <div className="p-5 text-rose-600 text-sm">{error}</div>}
        {data && lista.length === 0 && <EmptyState>No hay empleados en esta área.</EmptyState>}
        {lista.length > 0 && (
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
                  <th className="px-5 py-2.5 font-semibold">Cédula</th>
                  <th className="px-3 py-2.5 font-semibold">Nombre</th>
                  <th className="px-3 py-2.5 font-semibold">Área / equipo</th>
                  <th className="px-3 py-2.5 font-semibold">Contrato</th>
                  <th className="px-3 py-2.5 font-semibold">Jornada</th>
                  <th className="px-3 py-2.5 font-semibold">Horario</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((e) => (
                  <tr key={e.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
                    <td className="px-5 py-2.5 font-mono text-[12px] text-slate-500">{e.cedula}</td>
                    <td className="px-3 py-2.5 font-medium text-slate-700">{e.nombre}</td>
                    <td className="px-3 py-2.5 text-slate-500">{eqMap[e.equipo_id] || '—'}</td>
                    <td className="px-3 py-2.5 text-slate-500">{CONTRATO_MAP[e.tipo_contrato]?.nombre || e.tipo_contrato}</td>
                    <td className="px-3 py-2.5"><Badge>{JORNADA[e.tipo_jornada] || e.tipo_jornada}</Badge></td>
                    <td className="px-3 py-2.5 text-slate-500 font-mono text-[12px]">
                      {e.horario_inicio_habitual ? `${e.horario_inicio_habitual.slice(0, 5)}–${e.horario_fin_habitual?.slice(0, 5)}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
