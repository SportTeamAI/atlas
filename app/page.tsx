"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import QuantumNebula from "./components/quantum-nebula";
import HubCarousel from "./components/hub-carousel";

type Phase = "intro" | "leaving" | "hub";

export default function HomePage() {
  const [phase, setPhase] = useState<Phase>("intro");
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const finishIntro = () =>
    setPhase((p) => (p === "intro" ? "leaving" : p));

  // Al terminar el video, la intro (video, logo y nebulosa) se desvanece
  // y entra el hub sobre fondo blanco.
  useEffect(() => {
    if (phase !== "leaving") return;
    const t = setTimeout(() => setPhase("hub"), 900);
    return () => clearTimeout(t);
  }, [phase]);

  // Robustez móvil: garantiza que la intro avance al hub aunque el navegador
  // bloquee el autoplay del video, tarde en cargar o falle sin disparar
  // onEnded/onError (típico en navegadores móviles). Sin esto el usuario
  // se queda atrapado en el inicio.
  useEffect(() => {
    if (phase !== "intro") return;
    const video = videoRef.current;

    const advance = () => setPhase((p) => (p === "intro" ? "leaving" : p));
    let fallback: ReturnType<typeof setTimeout>;

    const schedule = (ms: number) => {
      clearTimeout(fallback);
      fallback = setTimeout(advance, ms);
    };

    // Tope de seguridad generoso por si nunca llega a cargar la metadata.
    schedule(14000);

    if (video) {
      // El autoplay móvil exige muted; React no siempre fija la propiedad DOM.
      video.muted = true;
      video.defaultMuted = true;

      // Cuando se conoce la duración real, ajusta el tope a duración + margen.
      const onMeta = () => {
        if (video.duration && Number.isFinite(video.duration)) {
          schedule(video.duration * 1000 + 2000);
        }
      };
      video.addEventListener("loadedmetadata", onMeta);
      if (video.readyState >= 1) onMeta();

      // Intenta reproducir explícitamente; si el navegador rechaza el
      // autoplay, no atrapamos al usuario y avanzamos pronto.
      const playPromise = video.play?.();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => schedule(2500));
      }

      return () => {
        video.removeEventListener("loadedmetadata", onMeta);
        clearTimeout(fallback);
      };
    }

    return () => clearTimeout(fallback);
  }, [phase]);

  const inHub = phase === "hub";

  return (
    <main
      className={`relative min-h-screen overflow-hidden transition-colors duration-700 ${
        inHub ? "bg-white" : "bg-black"
      }`}
    >
      {/* ——— Intro: nebulosa + logo animado + video, desaparece al terminar ——— */}
      {!inHub && (
        <div
          className={`absolute inset-0 z-10 transition-opacity duration-1000 ${
            phase === "leaving" ? "opacity-0" : "opacity-100"
          }`}
        >
          <QuantumNebula />

          {/* Logo de Atlas, entra animado sobre la presentación */}
          <div className="pointer-events-none absolute left-1/2 top-[7vh] z-20 -translate-x-1/2">
            <Image
              src="/atlas-logo.png"
              alt="Atlas"
              width={140}
              height={140}
              priority
              className="atlas-logo h-[14vh] w-auto object-contain"
            />
          </div>

          {/* Video de Atlas sosteniendo el mundo, integrado a la nebulosa */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <video
              ref={videoRef}
              src="/atlas-hero.mp4"
              poster="/atlas-poster.jpg"
              autoPlay
              muted
              playsInline
              preload="auto"
              onEnded={finishIntro}
              onError={finishIntro}
              className="atlas-video h-full w-full object-cover mix-blend-screen sm:h-[82vh] sm:w-auto sm:max-w-[92vw] sm:object-contain"
            />
          </div>
        </div>
      )}

      {/* ——— Hub de herramientas (Kairos y Pronos), fondo blanco ——— */}
      {inHub && (
        <div className="hub-in absolute inset-0 z-10 flex items-center justify-center px-4 pb-16">
          <HubCarousel />
        </div>
      )}

      {/* ——— Footer ——— */}
      <footer className="absolute bottom-0 left-0 right-0 z-20 py-4 text-center">
        <p
          className={`text-xs transition-colors duration-700 ${
            inHub ? "text-neutral-500" : "text-white/40"
          }`}
        >
          Copyright © 2026 Producto Deportivas. Todos los derechos reservados.
        </p>
      </footer>
    </main>
  );
}
