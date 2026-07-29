import { useState } from 'react'
import { Users, Check, Copy, Send, Clock } from 'lucide-react'
import { getEmpleados, getAccesos, getSolicitudes, crearSolicitud } from '../api/client'
import { Btn, Card, EmptyState, PageHeader, Spinner, confirmar, toast, useFetch } from '../components/ui'

// Cómo se ve cada rol de acceso. TH es "Administrador" de cara al usuario.
const ROL_ETIQUETA = { super_admin: 'Administrador', lider: 'Líder', registrador: 'Registra' }
const ROL_ESTILO = {
  super_admin: 'bg-violet-100 text-violet-700',
  lider: 'bg-blue-100 text-blue-700',
  registrador: 'bg-emerald-100 text-emerald-700',
}

export default function MiEquipoPage({ me }) {
  const { data, loading, error, reload } = useFetch(getEmpleados, [me?.email])
  // Estado de acceso (login) por persona. Solo líder/TH pueden consultarlo.
  const puedeVerAcceso = me?.rol === 'lider' || me?.rol === 'super_admin'
  const accesos = useFetch(() => (puedeVerAcceso ? getAccesos() : Promise.resolve([])), [me?.email])
  const puedeDesignar = me?.rol === 'lider'   // solo el líder activa/quita; TH solo lo ve
  const [saving, setSaving] = useState(null)
  const accesoDe = (email) => (accesos.data || []).find((a) => (a.email || '').toLowerCase() === (email || '').toLowerCase())
  // Quién lleva horario lo activa SOLO Talento Humano. El líder lo solicita y espera.
  const solicitudes = useFetch(() => (puedeVerAcceso ? getSolicitudes() : Promise.resolve([])), [me?.email])
  const pendienteDe = (empId, tipo) => (solicitudes.data || [])
    .find((x) => x.empleado_id === empId && x.tipo === tipo && x.estado === 'pendiente')

  const pedir = async (emp, tipo) => {
    const que = tipo === 'lleva_horario'
      ? `${emp.nombre} aparezca para reportar horas`
      : `${emp.nombre} entre a la plataforma con rol registrador`
    const motivo = await confirmar(`Le pedirás a Talento Humano que ${que}.`, {
      ok: 'Enviar solicitud',
      campo: { etiqueta: '¿Por qué? (opcional)', placeholder: 'Ej.: entra a turnos desde esta quincena' },
    })
    if (motivo === false) return   // canceló ('' = envía sin motivo)
    setSaving(emp.id + tipo)
    try {
      await crearSolicitud({ empleado_id: emp.id, tipo, motivo: motivo || null })
      solicitudes.reload()
      toast('Solicitud enviada a Talento Humano. Te avisamos cuando la resuelvan.', 'success')
    } catch (e) { toast(e.message, 'error') } finally { setSaving(null) }
  }

  const copiar = async (url) => {
    try { await navigator.clipboard.writeText(url); toast('Enlace copiado. Compártelo con la persona para que cree su contraseña.', 'success') }
    catch { toast(url, 'info') }
  }

  return (
    <div className="max-w-5xl mx-auto p-5 lg:p-7">
      <PageHeader icon={Users} title="Mi equipo" subtitle="Tu equipo: su cargo, quién lleva horario, con qué rol entra y quién registra."
        info={{
          titulo: 'Mi equipo',
          descripcion: 'Consulta a los integrantes de tu equipo. Los cambios los aplica Talento Humano: desde aquí se los solicitas.',
          pasos: [
            { titulo: 'Lleva horario', texto: 'Es quién aparece para reportar horas. Lo activa Talento Humano; si falta alguien, pulsa Solicitar y le llega la petición.' },
            { titulo: 'Acceso para registrar', texto: 'Es otra cosa: que la persona entre a la plataforma con rol registrador. También se solicita a TH; cuando la aprueban, se genera su enlace para crear contraseña.' },
          ],
        }} />

      <Card title="Integrantes del equipo">
        {loading && <div className="p-5"><Spinner /></div>}
        {error && <div className="p-5 text-rose-600 text-sm">{error}</div>}
        {data && data.length === 0 && <EmptyState>No tienes empleados asignados.</EmptyState>}
        {data && data.length > 0 && (
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
                  <th className="px-5 py-2.5 font-semibold">Empleado</th>
                  <th className="px-3 py-2.5 font-semibold">Cargo</th>
                  <th className="px-3 py-2.5 font-semibold">Lleva horario</th>
                  <th className="px-3 py-2.5 font-semibold">Rol</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Registra</th>
                </tr>
              </thead>
              <tbody>
                {data.map((e) => {
                  const ac = accesoDe(e.email)
                  return (
                    <tr key={e.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
                      <td className="px-5 py-2.5 font-medium text-slate-700">{e.nombre}</td>
                      <td className="px-3 py-2.5 text-slate-500 text-[12px]">{e.cargo || '—'}</td>
                      {/* Lo activa SOLO Talento Humano: aquí se ve y, si falta, se solicita. */}
                      <td className="px-3 py-2.5">
                        {e.lleva_horario ? (
                          <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-emerald-700"><Check size={13} /> Sí</span>
                        ) : pendienteDe(e.id, 'lleva_horario') ? (
                          <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-amber-600" title="Talento Humano aún no la resuelve"><Clock size={13} /> Solicitado</span>
                        ) : puedeDesignar ? (
                          <button onClick={() => pedir(e, 'lleva_horario')} disabled={saving === e.id + 'lleva_horario'}
                            className="inline-flex items-center gap-1 text-[12px] font-medium text-[#16697a] hover:bg-[#16697a]/5 px-2 py-1 rounded-lg disabled:opacity-50"
                            title="Pedirle a Talento Humano que esta persona lleve horario">
                            <Send size={12} /> Solicitar
                          </button>
                        ) : <span className="text-[12px] text-slate-300">No</span>}
                      </td>
                      {/* ROL con el que entra a la plataforma. Sin acceso = "—" (no tiene rol).
                          El líder registra por definición: se dice en el mismo chip. */}
                      <td className="px-3 py-2.5">
                        {!ac || !ac.activo ? <span className="text-[12px] text-slate-300">—</span> : (
                          <span className="inline-flex items-center gap-1.5">
                            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${ROL_ESTILO[ac.rol] || 'bg-slate-100 text-slate-500'}`}>
                              {ac.rol === 'lider' ? 'Líder · registra' : ROL_ETIQUETA[ac.rol] || ac.rol}
                            </span>
                            {/* Solo si el backend entregó la URL (a un líder no se la da:
                                con ese enlace se le pone contraseña a la cuenta). */}
                            {!ac.tiene_password && ac.onboarding_pendiente && ac.onboarding_url && (
                              <button onClick={() => copiar(ac.onboarding_url)} className="inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 hover:bg-amber-200" title="Aún no crea su contraseña. Copiar enlace de activación.">
                                <Copy size={11} /> enlace
                              </button>
                            )}
                          </span>
                        )}
                      </td>
                      {/* El acceso lo da Talento Humano. El líder lo solicita (es OTRA cosa
                          que llevar horario, por eso va aparte). */}
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-end gap-2">
                          {/* Al líder no se le repite "Registra": ya lo dice su rol. */}
                          {e.reporta && ac?.rol !== 'lider' && (
                            <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-emerald-700 bg-emerald-50 rounded px-2 py-0.5"><Check size={12} /> Registra</span>
                          )}
                          {!puedeDesignar || e.reporta || ac?.rol === 'lider' ? (
                            (!e.reporta && ac?.rol !== 'lider') && <span className="text-slate-300">—</span>
                          ) : pendienteDe(e.id, 'acceso_registrador') ? (
                            <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-amber-600 min-w-[96px] justify-center" title="Talento Humano aún no la resuelve"><Clock size={13} /> Solicitado</span>
                          ) : (
                            <Btn size="sm" variant="ghost" className="min-w-[96px] justify-center"
                              onClick={() => pedir(e, 'acceso_registrador')} disabled={saving === e.id + 'acceso_registrador'}>
                              {saving === e.id + 'acceso_registrador' ? '…' : <><Send size={12} /> Solicitar</>}
                            </Btn>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
