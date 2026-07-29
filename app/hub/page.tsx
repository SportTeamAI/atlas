"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import HubCarousel, { type ToolData } from "../components/hub-carousel";
import { api } from "../lib/api";
import { p } from "../lib/path";

interface Me {
  nombre: string;
  email: string;
  rol: string;
}

export default function HubPage() {
  const router = useRouter();
  const [tools, setTools] = useState<ToolData[] | null>(null);
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    api
      .get("/auth/estado")
      .then(async (res) => {
        if (!res.ok) { router.replace("/login"); return; }
        const data = await res.json();
        if (!data.usuario) { router.replace("/login"); return; }
        setMe(data.usuario);
        const toolsRes = await api.get("/core/mis-herramientas");
        const lista: ToolData[] = toolsRes.ok ? await toolsRes.json() : [];
        // Si NO es super_admin y solo tiene UNA herramienta, se salta el hub y entra directo a
        // ella (los super_admin siempre ven el hub para poder gestionar accesos). #hub-skip
        if (data.usuario.rol !== "super_admin" && lista.length === 1 && lista[0]?.ruta) {
          window.location.href = lista[0].ruta;
          return;
        }
        setTools(lista);
      })
      .catch(() => router.replace("/login"));
  }, [router]);

  async function handleLogout() {
    await api.post("/auth/logout", {});
    router.replace("/login");
  }

  if (tools === null) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-white">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#16697A] border-t-transparent" />
      </main>
    );
  }

  const primerNombre = (me?.nombre ?? "").split(" ")[0] || me?.email || "";

  return (
    <main className="flex min-h-screen flex-col bg-white">
      {/* Header limpio — solo logo */}
      <header className="flex items-center justify-between border-b border-neutral-100 px-6 py-3">
        <div className="flex items-center gap-2">
          <Image src={p("/atlas-logo.png")} alt="Atlas" width={28} height={28} className="w-7" />
          <span className="text-sm font-semibold text-neutral-700">Atlas</span>
        </div>
        {me?.rol === "super_admin" && (
          <button
            onClick={() => router.push("/admin")}
            className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-600 transition hover:border-[#16697A] hover:text-[#16697A]"
          >
            Gestionar accesos
          </button>
        )}
      </header>

      {/* Contenido principal */}
      <div className="flex flex-1 items-center justify-center px-4 py-8">
        {tools.length === 0 ? (
          <p className="text-neutral-400">
            Aún no tienes herramientas asignadas. Contacta a un administrador.
          </p>
        ) : (
          <HubCarousel tools={tools} />
        )}
      </div>

      {/* Bottom nav con usuario y logout */}
      <footer className="border-t border-neutral-100 bg-white px-6 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#16697A]/10 text-xs font-bold text-[#16697A]">
              {primerNombre.charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="text-sm font-medium text-neutral-800">{primerNombre}</p>
              <p className="text-xs text-neutral-400">{me?.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => router.push("/seguridad")}
              title="Seguridad"
              className="rounded-lg p-1.5 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="5" y="11" width="14" height="10" rx="2" />
                <path d="M8 11V7a4 4 0 018 0v4" />
              </svg>
            </button>
            <button
              onClick={handleLogout}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900"
            >
              Cerrar sesión
            </button>
          </div>
        </div>
      </footer>
    </main>
  );
}
