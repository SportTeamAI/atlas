import { useState } from 'react'
import { HeartPulse, ExternalLink, X, BookOpen } from 'lucide-react'
import { getBeneficios, getEmpleados, getNovedades } from '../api/client'
import { Card, EmptyState, PageHeader, Spinner, useFetch } from '../components/ui'
import { LICENCIAS, LIC_MAP } from '../data/licencias'

// Color según quién asume el pago: empleador=verde, compartido/EPS/ARL=ámbar, no paga=rojo.
function colorPaga(l) {
  if (l.remunerada === 'No') return { cls: 'bg-rose-500/15 text-rose-600', txt: 'No paga' }
  if ((l.quien_paga || '') === 'Empleador') return { cls: 'bg-emerald-500/15 text-emerald-600', txt: 'Empleador' }
  return { cls: 'bg-amber-500/20 text-amber-700', txt: l.quien_paga } // EPS / ARL / compartido
}

export default function LicenciasPage({ me }) {
  const { data, loading, error } = useFetch(getNovedades, [me?.email])
  const empleados = useFetch(getEmpleados, [me?.email])
  const beneficios = useFetch(getBeneficios, [me?.email])
  const empMap = Object.fromEntries((empleados.data || []).map((e) => [e.id, e.nombre]))
  const [ley, setLey] = useState(null)
  // El "Descanso (D)" es una marca de registro, no una licencia: no va aquí (#6).
  const registradas = (data || []).filter((n) => n.tipo !== 'DESCANSO')

  return (
    <div className="max-w-6xl mx-auto p-5 lg:p-7">
      <PageHeader icon={HeartPulse} title="Licencias y ausencias"
        subtitle="Informativo: las licencias se registran al montar el horario; aquí TH las consulta." />

      {/* La lista de "Registradas" solo aparece si HAY licencias (#5). */}
      {registradas.length > 0 && (
        <Card title="Registradas" className="mb-6">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
              <th className="px-5 py-2.5 font-semibold">Empleado</th><th className="px-3 py-2.5 font-semibold">Tipo</th>
              <th className="px-3 py-2.5 font-semibold">Desde</th><th className="px-3 py-2.5 font-semibold">Hasta</th>
              <th className="px-3 py-2.5 font-semibold">Paga</th></tr></thead>
            <tbody>
              {registradas.map((n) => {
                const lic = LIC_MAP[n.tipo]
                const c = lic ? colorPaga(lic) : { cls: 'bg-slate-100 text-slate-600', txt: n.es_remunerada ? 'Sí' : 'No' }
                return (
                  <tr key={n.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-5 py-2.5 font-medium text-slate-700">{empMap[n.empleado_id] || '—'}</td>
                    <td className="px-3 py-2.5 text-slate-600">{lic?.nombre || n.tipo}</td>
                    <td className="px-3 py-2.5 text-slate-500 tabular">{n.fecha_inicio}</td>
                    <td className="px-3 py-2.5 text-slate-500 tabular">{n.fecha_fin}</td>
                    <td className="px-3 py-2.5"><span className={`inline-block px-2 py-0.5 rounded-md text-[11px] font-semibold ${c.cls}`}>{c.txt}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}

      {/* #2 Primero los de la EMPRESA, luego los de ley. */}
      <Card title="Beneficios de la empresa (voluntarios)" className="mb-6">
        {(beneficios.data || []).filter((b) => b.activa).length === 0 ? (
          <EmptyState>No hay beneficios de empresa activos. Se activan en Configuración → Beneficios.</EmptyState>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 p-4">
            {(beneficios.data || []).filter((b) => b.activa).map((b) => {
              const c = b.remunerada ? { cls: 'bg-emerald-500/15 text-emerald-600', txt: 'Empleador' } : { cls: 'bg-rose-500/15 text-rose-600', txt: 'No paga' }
              return (
                <button key={b.id} onClick={() => setLey({ nombre: b.nombre, duracion: `${b.dias} día(s)`, descripcion: b.descripcion, base_legal: b.base_legal || 'Beneficio de la empresa', calculo: b.descripcion, url: null, remunerada: b.remunerada ? 'Sí' : 'No', quien_paga: 'Empleador' })}
                  className="text-left rounded-xl border border-slate-200 hover:border-blue-300 hover:shadow-sm transition p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-semibold text-slate-700 text-[14px]">{b.nombre}</div>
                    <BookOpen size={15} className="text-blue-600 shrink-0 mt-0.5" />
                  </div>
                  <div className="text-[12px] text-slate-500 mt-1">{b.dias} día(s)</div>
                  <div className="flex items-center gap-2 mt-2">
                    <span className={`inline-block px-2 py-0.5 rounded-md text-[11px] font-semibold ${c.cls}`}>{c.txt}</span>
                    <span className="text-[11px] text-slate-400">{b.base_legal || 'Beneficio de la empresa'}</span>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </Card>

      <Card title="Licencias de ley (Colombia) — clic para ver la norma">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 p-4">
          {LICENCIAS.map((l) => {
            const c = colorPaga(l)
            return (
              <button key={l.tipo} onClick={() => setLey(l)}
                className="text-left rounded-xl border border-slate-200 hover:border-blue-300 hover:shadow-sm transition p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-semibold text-slate-700 text-[14px]">{l.nombre}</div>
                  <BookOpen size={15} className="text-blue-600 shrink-0 mt-0.5" />
                </div>
                <div className="text-[12px] text-slate-500 mt-1">{l.duracion}</div>
                <div className="flex items-center gap-2 mt-2">
                  <span className={`inline-block px-2 py-0.5 rounded-md text-[11px] font-semibold ${c.cls}`}>{c.txt}</span>
                  <span className="text-[11px] text-slate-400">{l.base_legal}</span>
                </div>
              </button>
            )
          })}
        </div>
        <div className="px-5 pb-4 flex items-center gap-4 text-[11px] text-slate-400 flex-wrap">
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-emerald-500/30 inline-block" /> Paga el empleador</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-amber-500/30 inline-block" /> Comparte / EPS / ARL</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-rose-500/30 inline-block" /> No remunerada</span>
        </div>
      </Card>

      {ley && <ModalLey ley={ley} onClose={() => setLey(null)} />}
    </div>
  )
}

function ModalLey({ ley, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-blue-600 font-bold">{ley.base_legal}</p>
            <h3 className="text-lg font-bold text-slate-800 mt-0.5">{ley.nombre}</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <div className="grid grid-cols-3 gap-3 mb-4">
          <Dato label="Duración" valor={ley.duracion} />
          <Dato label="¿Remunerada?" valor={ley.remunerada} />
          <Dato label="Quién paga" valor={ley.quien_paga} />
        </div>
        <p className="text-sm text-slate-600 leading-relaxed mb-3">{ley.descripcion}</p>
        <div className="rounded-xl bg-slate-50 border border-slate-100 p-3 mb-4">
          <div className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold mb-1">Cálculo / liquidación</div>
          <p className="text-[13px] text-slate-600">{ley.calculo}</p>
        </div>
        <a href={ley.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-blue-600 hover:text-blue-700">
          Ver norma oficial (Función Pública) <ExternalLink size={14} />
        </a>
      </div>
    </div>
  )
}

function Dato({ label, valor }) {
  return (
    <div className="rounded-lg bg-slate-50 border border-slate-100 p-2.5">
      <div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">{label}</div>
      <div className="text-[13px] font-semibold text-slate-700 mt-0.5">{valor}</div>
    </div>
  )
}
