import { useState } from 'react'
import { Scale, ExternalLink, X, BookOpen, Calendar } from 'lucide-react'
import { investigarNormativa } from '../api/client'
import { Btn, Card, PageHeader, toast } from '../components/ui'

// Recargos con explicación, base legal y enlace oficial (mismo estilo que Licencias).
// Los 12 tipos (separando dominical de festivo, como en la nómina).
const U_CST = 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=199983'
const U_REF = 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=260676'
const RECARGOS = [
  { cat: 'Ordinaria diurna', franja: '6AM–7PM', pct: 0, base: 'CST Art. 158',
    art: 'Jornada ordinaria diurna (6:00 a 19:00): no genera recargo.', url: U_CST },
  { cat: 'Ordinaria nocturna', franja: '7PM–6AM', pct: 35, base: 'CST Art. 168',
    art: 'Trabajo nocturno (19:00 a 6:00): recargo del 35% sobre la hora ordinaria.', url: U_CST },
  { cat: 'Ordinaria dominical', franja: '6AM–7PM', pct: 90, base: 'Ley 2466/2025',
    art: 'Trabajo DIURNO (6:00 a 19:00) en domingo: recargo del 90% (sube a 100% desde 1 jul 2027). En la franja nocturna se suma el 35% (ver Ord. nocturna dominical).', url: U_REF },
  { cat: 'Ordinaria festivo', franja: '6AM–7PM', pct: 90, base: 'Ley 2466/2025',
    art: 'Trabajo DIURNO (6:00 a 19:00) en festivo: recargo del 90% (sube a 100% desde 1 jul 2027). En la franja nocturna se suma el 35% (ver Ord. nocturna festivo).', url: U_REF },
  { cat: 'Ord. nocturna dominical', franja: '7PM–6AM', pct: 125, base: 'Suma 35 + 90',
    art: 'Nocturna en domingo: 35% + 90% = 125%.', url: U_REF },
  { cat: 'Ord. nocturna festivo', franja: '7PM–6AM', pct: 125, base: 'Suma 35 + 90',
    art: 'Nocturna en festivo: 35% + 90% = 125%.', url: U_REF },
  { cat: 'Extra diurna', franja: '6AM–7PM', pct: 25, base: 'CST Art. 168',
    art: 'Hora extra diurna (supera la jornada): recargo del 25%.', url: U_CST },
  { cat: 'Extra nocturna', franja: '7PM–6AM', pct: 75, base: 'CST Art. 168',
    art: 'Hora extra nocturna: recargo del 75%.', url: U_CST },
  { cat: 'Extra diurna dominical', franja: '6AM–7PM', pct: 115, base: 'Suma 25 + 90',
    art: 'Extra diurna en domingo: 25% + 90% = 115%.', url: U_REF },
  { cat: 'Extra diurna festivo', franja: '6AM–7PM', pct: 115, base: 'Suma 25 + 90',
    art: 'Extra diurna en festivo: 25% + 90% = 115%.', url: U_REF },
  { cat: 'Extra nocturna dominical', franja: '7PM–6AM', pct: 165, base: 'Suma 75 + 90',
    art: 'Extra nocturna en domingo: 75% + 90% = 165%.', url: U_REF },
  { cat: 'Extra nocturna festivo', franja: '7PM–6AM', pct: 165, base: 'Suma 75 + 90',
    art: 'Extra nocturna en festivo: 75% + 90% = 165%.', url: U_REF },
]

const HITOS = [
  { fecha: '1 jul 2026', cambio: 'Recargo dominical/festivo 80% → 90%' },
  { fecha: '15 jul 2026', cambio: 'Jornada máxima semanal 44h → 42h' },
  { fecha: '1 jul 2027', cambio: 'Recargo dominical/festivo 90% → 100%' },
]

export default function ReferenciaLegalPage({ me }) {
  const [ley, setLey] = useState(null)
  const [cronoOpen, setCronoOpen] = useState(false)
  const [recargosOpen, setRecargosOpen] = useState(false)
  const [investigando, setInvestigando] = useState(false)  // pipeline de investigación (#3)
  const esRH = me?.rol === 'super_admin'
  const investigar = async () => {
    setInvestigando(true)
    try { const r = await investigarNormativa(); toast(r.resultado, r.hallazgo ? 'ok' : 'info') }
    catch (e) { toast(e.message, 'error') } finally { setInvestigando(false) }
  }

  return (
    <div className="max-w-7xl mx-auto p-5 lg:p-7">
      <PageHeader icon={Scale} title="Referencia legal"
        subtitle={esRH ? 'Recargos vigentes y normativa completa (1 jul 2026 – 30 jun 2027).' : 'Lo esencial de tu jornada laboral (Colombia).'} />

      {/* Resumen y reglas, una bajo la otra (como estaba antes). Los botones de
          recargos/cronograma van ARRIBA en este card (solo TH, #3). */}
      <Card title="Tu jornada en Colombia (resumen)" className="p-4 mb-4"
        action={esRH && (
          <div className="flex flex-wrap gap-2">
            <Btn size="sm" onClick={() => setRecargosOpen(true)}><BookOpen size={14} /> Ver recargos vigentes</Btn>
            <Btn size="sm" variant="ghost" onClick={() => setCronoOpen(true)}><Calendar size={14} /> Cronograma normativo</Btn>
          </div>
        )}>
        <div className="grid sm:grid-cols-3 gap-3">
          <Dato label="Jornada máxima semanal" valor="42 horas" sub="Desde 15 jul 2026 (antes 44 h)" />
          <Dato label="Tope de horas extra" valor="máx 12 h / semana" sub="No hay tope diario; es semanal" />
          <Dato label="Jornada diurna" valor="6:00 – 19:00" sub="Fuera: nocturno (recargo)" />
        </div>
        <p className="text-[12px] text-slate-600 mt-2.5 leading-snug">
          Semana de <strong>lunes a domingo</strong> con <strong>1 día de descanso</strong>. Por defecto las extra se
          cuentan <strong>día a día</strong> (lo que pase de 8 h de trabajo en el día). En equipos
          <strong> administrativos</strong> (Deportivas, Operaciones Comerciales), en las <strong>semanas con festivo</strong>
          se cuentan <strong>por semana</strong> (extra solo al superar 44 h; 42 desde el 15‑jul). Los
          <strong> recargos</strong> (nocturno, dominical, festivo) se pagan siempre, sean ordinarias o extra.
        </p>
      </Card>

      {/* Reglas del sistema — visibles para TODOS (registrador y líder también, #7). */}
      <Card title="¿Cuándo una hora es EXTRA? (así lo calcula el sistema)" className="p-4 mb-4">
        <ul className="text-[12px] text-slate-600 space-y-1 leading-snug">
          <li>• <strong>Nadie registra extras a mano</strong>: solo ponen entrada/salida; el sistema calcula y ubica cada hora.</li>
          <li>• <strong>Recargo ≠ extra</strong>: el recargo (nocturno 7pm–6am, domingo, festivo) se paga aunque NO sea extra.</li>
          <li>• <strong>Tope legal</strong>: <strong>12 h extra/semana</strong>.</li>
        </ul>
        <div className="grid sm:grid-cols-2 gap-2.5 mt-2.5">
          <div className="rounded-xl bg-emerald-50/60 border border-emerald-100 p-3">
            <div className="text-[12px] font-semibold text-emerald-700 mb-1">Operativos · día a día</div>
            <div className="text-[11px] text-slate-500 mb-1.5">Servicio al Cliente, Riesgos, Incidentes</div>
            <ul className="text-[12px] text-slate-600 space-y-1 leading-snug">
              <li>▸ Trabajar <strong>más de 8 h</strong> en el día → esas horas son <strong>extra</strong>.</li>
              <li>▸ Un <strong>bloque agregado</strong> sobre el turno base → <strong>todo extra</strong>.</li>
              <li>▸ Ej.: turno <strong>8–18</strong> (9 h) → <strong>1 h extra</strong> ese día.</li>
            </ul>
          </div>
          <div className="rounded-xl bg-blue-50/60 border border-blue-100 p-3">
            <div className="text-[12px] font-semibold text-blue-700 mb-1">Administrativos · por semana en festivos</div>
            <div className="text-[11px] text-slate-500 mb-1.5">Deportivas, Operaciones Comerciales</div>
            <ul className="text-[12px] text-slate-600 space-y-1 leading-snug">
              <li>▸ Semanas normales: igual, <strong>día a día</strong>.</li>
              <li>▸ Semanas <strong>con festivo</strong>: por <strong>semana</strong> — extra solo al superar <strong>44 h</strong> (42 desde 15‑jul).</li>
              <li>▸ Ej.: semana con festivo de <strong>46 h</strong> → <strong>2 h extra</strong>.</li>
            </ul>
          </div>
        </div>
        <p className="text-[11px] text-slate-500 mt-2.5">En ambos casos, un <strong>domingo/festivo</strong> trabajado sin superar el tope se paga con <strong>recargo</strong> (dominical/festivo), <strong>no como extra</strong>.</p>
      </Card>

      {/* Línea de tiempo de cambios normativos — visible para TODOS (imagen 3). */}
      <Card title="Cambios normativos (vigencias)" className="p-4 mb-4">
        <div className="space-y-2">
          {HITOS.map((h) => {
            const activo = h.fecha === '15 jul 2026'   // el próximo cambio (jornada 42 h)
            return (
              <div key={h.fecha} className={`flex items-start gap-3 rounded-xl px-3 py-2 ${activo ? 'bg-teal-50 border border-teal-200' : ''}`}>
                <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${activo ? 'bg-teal-500' : 'bg-slate-300'}`} />
                <div>
                  <div className={`text-[13px] font-semibold ${activo ? 'text-teal-700' : 'text-slate-700'}`}>{h.fecha}{activo && <span className="ml-2 text-[10px] uppercase tracking-wide bg-teal-500 text-white rounded px-1.5 py-0.5">Próximo cambio</span>}</div>
                  <div className="text-[12px] text-slate-600">{h.cambio}</div>
                </div>
              </div>
            )
          })}
        </div>
        <p className="text-[11px] text-slate-400 mt-3">El sistema aplica cada cambio automáticamente según la fecha de cada registro.</p>
      </Card>

      {/* Modal de recargos vigentes (#4). */}
      {recargosOpen && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={() => setRecargosOpen(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[88vh] overflow-y-auto scroll-thin p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <h3 className="text-lg font-bold text-slate-800">Recargos vigentes</h3>
              <button onClick={() => setRecargosOpen(false)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {RECARGOS.map((r) => (
                <button key={r.cat} onClick={() => setLey(r)}
                  className="text-left rounded-xl border border-slate-200 hover:border-blue-300 hover:shadow-sm transition p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-semibold text-slate-700 text-[14px]">{r.cat}</div>
                    <BookOpen size={15} className="text-blue-600 shrink-0 mt-0.5" />
                  </div>
                  <div className="text-[12px] text-slate-500 mt-1 font-mono">{r.franja}</div>
                  <div className="flex items-center justify-between mt-2">
                    <span className="font-impact text-2xl text-blue-700 leading-none">{r.pct}%</span>
                    <span className="text-[11px] text-slate-400">{r.base}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Cronograma normativo: modal disparado desde el botón "Cronograma normativo". */}
      {cronoOpen && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={() => setCronoOpen(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-blue-600 font-bold">Próximos cambios</p>
                <h3 className="text-lg font-bold text-slate-800 mt-0.5">Cronograma de cambios normativos</h3>
              </div>
              <button onClick={() => setCronoOpen(false)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            <div className="space-y-3">
              {HITOS.map((h) => (
                <div key={h.fecha} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 flex items-start gap-3">
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-600 mt-1.5 shrink-0" />
                  <div><div className="font-semibold text-slate-800 text-sm">{h.fecha}</div><p className="text-[13px] text-slate-600">{h.cambio}</p></div>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-slate-400 mt-4">El sistema aplica cada cambio automáticamente según la fecha del registro (vigencias en `config_recargos`).</p>
            {/* #3 Pipeline de investigación de cambios normativos (bajo demanda de TH). */}
            <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50/50 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[13px] font-semibold text-slate-700">Investigar cambios normativos</div>
                  <div className="text-[11px] text-slate-500">Revisa la normativa vigente en el momento y te deja una notificación con el resultado (con o sin novedades). Máximo <strong>1 vez al día</strong> y <strong>3 por semana</strong>.</div>
                </div>
                <Btn size="sm" onClick={investigar} disabled={investigando}>
                  {investigando ? 'Investigando…' : 'Investigar ahora'}
                </Btn>
              </div>
            </div>
          </div>
        </div>
      )}

      {ley && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={() => setLey(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-blue-600 font-bold">{ley.base}</p>
                <h3 className="text-lg font-bold text-slate-800 mt-0.5">{ley.cat} — {ley.pct}%</h3>
              </div>
              <button onClick={() => setLey(null)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <Dato label="Franja" valor={ley.franja} />
              <Dato label="Recargo" valor={`${ley.pct}%`} />
            </div>
            <p className="text-sm text-slate-600 leading-relaxed mb-4">{ley.art}</p>
            <div className="text-[12px] text-slate-400 mb-4">Vigencia: 1 jul 2026 – 30 jun 2027</div>
            <a href={ley.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-blue-600 hover:text-blue-700">
              Ver norma oficial (Función Pública) <ExternalLink size={14} />
            </a>
          </div>
        </div>
      )}
    </div>
  )
}

function Dato({ label, valor, sub }) {
  return (
    <div className="rounded-lg bg-slate-50 border border-slate-100 p-3">
      <div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">{label}</div>
      <div className="text-[15px] font-bold text-slate-800 mt-0.5">{valor}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  )
}
