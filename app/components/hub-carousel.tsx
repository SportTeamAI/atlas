"use client";

import Image from "next/image";
import { Swiper, SwiperSlide } from "swiper/react";
import {
  Autoplay,
  EffectCoverflow,
  Navigation,
  Pagination,
} from "swiper/modules";

import "swiper/css";
import "swiper/css/effect-coverflow";
import "swiper/css/pagination";
import "swiper/css/navigation";

// Hub de herramientas de Atlas — basado en el Card Carousel de 21st.dev
// (larsen66/card-carousel), en tema claro para las herramientas internas
// de Talento Humano.
type Tool = {
  name: string;
  tagline: string;
  description: string;
  accent: string;
};

const TOOLS: Tool[] = [
  {
    name: "Kairos",
    tagline: "Horas y horarios",
    description: "Gestión de horas y horarios para nómina.",
    accent: "from-cyan-100 via-sky-50 to-transparent",
  },
  {
    name: "Pronos",
    tagline: "Presupuestos y proyecciones",
    description:
      "Presupuestos y proyecciones de costos y gastos para el área.",
    accent: "from-indigo-100 via-blue-50 to-transparent",
  },
];

function ToolCard({ tool }: { tool: Tool }) {
  return (
    <div className="group relative flex h-[380px] w-full flex-col justify-between overflow-hidden rounded-xl border border-black/10 bg-white p-6 shadow-sm transition-all duration-300 hover:border-sky-400/60 hover:shadow-md">
      <div
        className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${tool.accent}`}
      />
      <div className="relative flex items-center gap-3">
        <Image
          src="/atlas-logo.png"
          alt="Atlas"
          width={36}
          height={36}
          className="h-9 w-9 object-contain"
        />
        <span className="text-xs uppercase tracking-[0.25em] text-neutral-400">
          Atlas · Talento Humano
        </span>
      </div>
      <div className="relative">
        <h3 className="text-4xl font-bold tracking-tight text-neutral-900">
          {tool.name}
        </h3>
        <p className="mt-1 text-sm text-sky-600">{tool.tagline}</p>
        <p className="mt-4 text-sm leading-relaxed text-neutral-500">
          {tool.description}
        </p>
        <button className="mt-6 w-full rounded-lg bg-neutral-900 py-2.5 text-sm font-semibold text-white transition-all duration-200 hover:bg-sky-600">
          Entrar
        </button>
      </div>
    </div>
  );
}

export default function HubCarousel() {
  // Con loop y pocas tarjetas, Swiper necesita slides duplicados
  // (igual que el componente original de 21st.dev).
  const slides = [...TOOLS, ...TOOLS];

  return (
    <section className="w-full">
      <style>{`
        .hub-swiper .swiper {
          width: 100%;
          padding-bottom: 50px;
        }
        .hub-swiper .swiper-slide {
          background-position: center;
          background-size: cover;
          width: 300px;
        }
        .hub-swiper .swiper-3d .swiper-slide-shadow-left,
        .hub-swiper .swiper-3d .swiper-slide-shadow-right {
          background-image: none;
          background: none;
        }
        .hub-swiper {
          --swiper-theme-color: #0284c7;
          --swiper-navigation-size: 28px;
        }
      `}</style>

      <div className="hub-swiper mx-auto w-full max-w-4xl rounded-[24px] border border-black/5 p-2 shadow-sm md:rounded-t-[44px]">
        <div className="relative mx-auto flex w-full flex-col rounded-[24px] border border-black/5 bg-neutral-800/5 p-2 shadow-sm md:items-start md:gap-8 md:rounded-b-[20px] md:rounded-t-[40px] md:p-2">
          <div className="absolute left-4 top-6 inline-flex items-center gap-2 rounded-[14px] border border-black/10 bg-white px-3 py-1 text-sm text-neutral-600 md:left-6">
            <span className="inline-block h-2 w-2 rounded-full bg-sky-500" />
            Herramientas internas
          </div>

          <div className="flex w-full flex-col justify-center pb-2 pl-4 pt-16 md:items-center md:pl-0">
            <h2 className="text-4xl font-bold tracking-tight text-neutral-900 opacity-90">
              Hub de Herramientas
            </h2>
            <p className="text-neutral-500">
              Selecciona la herramienta con la que quieres trabajar.
            </p>
          </div>

          <div className="flex w-full items-center justify-center gap-4">
            <div className="w-full">
              <Swiper
                spaceBetween={50}
                autoplay={{ delay: 2500, disableOnInteraction: false }}
                effect="coverflow"
                grabCursor
                centeredSlides
                loop
                slidesPerView="auto"
                coverflowEffect={{
                  rotate: 0,
                  stretch: 0,
                  depth: 100,
                  modifier: 2.5,
                }}
                pagination
                navigation
                modules={[Autoplay, EffectCoverflow, Pagination, Navigation]}
              >
                {slides.map((tool, i) => (
                  <SwiperSlide key={`${tool.name}-${i}`}>
                    <div className="size-full rounded-3xl">
                      <ToolCard tool={tool} />
                    </div>
                  </SwiperSlide>
                ))}
              </Swiper>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
