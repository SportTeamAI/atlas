"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../lib/api";

interface Persona {
  id: string;
  nombre: string;
  email: string;
  usuario_id: string | null;
}

interface Permiso {
  id: string;
  usuario_id: string;
  herramienta_slug: string;
  rol: string;
  nombre_usuario?: string;
}

interface Herramienta {
  slug: string;
  nombre: string;
  roles?: string[];   // roles válidos de la herramienta (para elegir el rol al dar acceso)
}

export default function AdminPage() {
  const router = useRouter();
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [permisos, setPermisos] = useState<Permiso[]>([]);
  const [herramientas, setHerramientas] = useState<Herramienta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [q, setQ] = useState("");   // buscar persona por nombre/correo

  useEffect(() => {
    Promise.all([
      api.get("/auth/estado"),
      api.get("/core/personas"),
      api.get("/core/permisos"),
      api.get("/core/herramientas"),
    ])
      .then(async ([estado, pers, perm, herr]) => {
        if (!estado.ok) { router.replace("/login"); return; }
        const { usuario } = await estado.json();
        if (!usuario || usuario.rol !== "super_admin") { router.replace("/hub"); return; }
        setPersonas(pers.ok ? await pers.json() : []);
        setPermisos(perm.ok ? await perm.json() : []);
        setHerramientas(herr.ok ? await herr.json() : []);
        setLoading(false);
      })
      .catch(() => { setError("No se pudo cargar. Intenta de nuevo."); setLoading(false); });
  }, [router]);

  const tienePermiso = (usuarioId: string, slug: string) =>
    permisos.some((p) => p.usuario_id === usuarioId && p.herramienta_slug === slug);

  const togglePermiso = async (usuarioId: string, slug: string) => {
    const key = `${usuarioId}:${slug}`;
    setSaving(key);
    try {
      const permiso = permisos.find((p) => p.usuario_id === usuarioId && p.herramienta_slug === slug);
      if (permiso) {
        await api.delete(`/core/permisos/${permiso.id}`);
        setPermisos((p) => p.filter((x) => x.id !== permiso.id));
      } else {
        // Al dar acceso arranca con el rol BASE (el de menor privilegio) del tool; TH lo ajusta luego.
        const h = herramientas.find((x) => x.slug === slug);
        const base = h?.roles?.[h.roles.length - 1] ?? "miembro";
        const res = await api.post("/core/permisos", { usuario_id: usuarioId, herramienta: slug, rol: base });
        if (res.ok) {
          const nuevo = await res.json();
          setPermisos((p) => [...p, nuevo]);
        }
      }
    } catch {
      /* noop */
    } finally {
      setSaving(null);
    }
  };

  // #roles Cambiar el rol de un acceso ya dado. POST /permisos es UPSERT en el backend (si ya
  // tiene, le cambia el rol), y valida el rol contra los roles de la herramienta.
  const cambiarRol = async (usuarioId: string, slug: string, rol: string) => {
    const key = `${usuarioId}:${slug}`;
    setSaving(key);
    try {
      const res = await api.post("/core/permisos", { usuario_id: usuarioId, herramienta: slug, rol });
      if (res.ok) {
        const act = await res.json();
        setPermisos((p) => p.map((x) => (x.usuario_id === usuarioId && x.herramienta_slug === slug ? act : x)));
      }
    } catch {
      /* noop */
    } finally {
      setSaving(null);
    }
  };

  const _busca = q.trim().toLowerCase();
  const personasConUsuario = personas
    .filter((p) => p.usuario_id)
    .filter((p) => !_busca || p.nombre.toLowerCase().includes(_busca) || p.email.toLowerCase().includes(_busca));

  if (loading) return (
    <main className="flex min-h-screen items-center justify-center bg-white">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#16697A] border-t-transparent" />
    </main>
  );

  if (error) return (
    <main className="flex min-h-screen items-center justify-center bg-white">
      <p className="text-red-600">{error}</p>
    </main>
  );

  return (
    <main className="min-h-screen bg-neutral-50">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-neutral-200 bg-white px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/hub")}
            className="text-sm text-neutral-500 hover:text-neutral-900 transition"
          >
            ← Hub
          </button>
          <span className="text-neutral-300">/</span>
          <h1 className="text-sm font-semibold text-neutral-900">Administración de accesos</h1>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-6 py-8">
        <p className="mb-4 text-sm text-neutral-500">
          Activa o desactiva el acceso a cada herramienta para los usuarios del sistema.
          Apagar el interruptor <strong>quita</strong> el acceso. Los cambios se aplican de inmediato.
        </p>

        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar persona por nombre o correo…"
          className="mb-4 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-800 outline-none transition focus:border-[#16697A]"
        />

        {/* Tabla */}
        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-100 bg-neutral-50">
                <th className="px-4 py-3 text-left font-medium text-neutral-600">Persona</th>
                {herramientas.map((h) => (
                  <th key={h.slug} className="px-4 py-3 text-center font-medium text-neutral-600 capitalize">
                    {h.nombre}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-50">
              {personasConUsuario.length === 0 && (
                <tr>
                  <td colSpan={herramientas.length + 1} className="px-4 py-8 text-center text-neutral-400">
                    No hay usuarios registrados aún.
                  </td>
                </tr>
              )}
              {personasConUsuario.map((p) => (
                <tr key={p.usuario_id} className="hover:bg-neutral-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-neutral-900">{p.nombre}</div>
                    <div className="text-xs text-neutral-400">{p.email}</div>
                  </td>
                  {herramientas.map((h) => {
                    const key = `${p.usuario_id}:${h.slug}`;
                    const tiene = tienePermiso(p.usuario_id!, h.slug);
                    const permiso = permisos.find((x) => x.usuario_id === p.usuario_id && x.herramienta_slug === h.slug);
                    const cargando = saving === key;
                    return (
                      <td key={h.slug} className="px-4 py-3 text-center">
                        <div className="inline-flex flex-col items-center gap-1">
                          <button
                            onClick={() => togglePermiso(p.usuario_id!, h.slug)}
                            disabled={cargando}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                              tiene ? "bg-[#16697A]" : "bg-neutral-200"
                            } disabled:opacity-50`}
                            aria-label={tiene ? "Quitar acceso" : "Dar acceso"}
                          >
                            <span
                              className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                                tiene ? "translate-x-6" : "translate-x-1"
                              }`}
                            />
                          </button>
                          {tiene && permiso && (
                            h.roles && h.roles.length > 0 ? (
                              <select
                                value={permiso.rol}
                                disabled={cargando}
                                onChange={(e) => cambiarRol(p.usuario_id!, h.slug, e.target.value)}
                                className="rounded border border-neutral-200 bg-white px-1 py-0.5 text-[10px] font-medium capitalize text-[#16697A] outline-none focus:border-[#16697A] disabled:opacity-50"
                                aria-label={`Rol en ${h.nombre}`}
                              >
                                {(h.roles.includes(permiso.rol) ? h.roles : [permiso.rol, ...h.roles]).map((r) => (
                                  <option key={r} value={r}>{r}</option>
                                ))}
                              </select>
                            ) : (
                              <span className="text-[10px] font-medium capitalize text-[#16697A]">{permiso.rol}</span>
                            )
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-4 text-xs text-neutral-400">
          Solo aparecen personas que ya tienen cuenta de usuario en el sistema.
        </p>
      </div>
    </main>
  );
}
