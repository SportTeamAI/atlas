# Atlas

Plataforma de gestión de herramientas de uso interno de **Talento Humano**.

**En vivo:** https://atlas-vs.web.app

## Descripción

Atlas es el punto de entrada a las herramientas internas del área:

| Herramienta | Descripción |
|---|---|
| **Kairos** | Gestión de horas y horarios para nómina. |
| **Pronos** | Presupuestos y proyecciones de costos y gastos para el área. |

El inicio muestra una intro animada (logo + video de Atlas sosteniendo el mundo sobre la nebulosa de partículas) y, al terminar, presenta el **Hub de Herramientas** con el carrusel de acceso a Kairos y Pronos.

## Stack

- [Next.js 15](https://nextjs.org/) (App Router, export estático) + React 19
- [Tailwind CSS 4](https://tailwindcss.com/)
- [Three.js](https://threejs.org/) — fondo "Quantum Nebula" (50.000 partículas)
- [Swiper](https://swiperjs.com/) — carrusel del hub
- [Firebase Hosting](https://firebase.google.com/docs/hosting) — despliegue (proyecto `atlas-vs`)

## Desarrollo local

```bash
npm install
npm run dev
```

Abre http://localhost:3000.

## Estructura del proyecto

```
atlas/
├── app/                  # Aplicación Next.js (portal / hub)
│   ├── components/
│   │   ├── quantum-nebula.tsx   # Fondo de partículas de la intro
│   │   └── hub-carousel.tsx     # Carrusel del hub (Kairos y Pronos)
│   ├── page.tsx          # Flujo: intro (video + logo) → hub
│   ├── layout.tsx
│   └── icon.png          # Favicon
├── public/               # Video de la intro y logo
├── tools/                # ⬅ AQUÍ viven los proyectos de las herramientas
│   ├── kairos/           # Proyecto Kairos
│   └── pronos/           # Proyecto Pronos
├── firebase.json         # Configuración de Firebase Hosting
└── .firebaserc           # Proyecto activo: atlas-vs
```

## 📦 Cómo incluir los proyectos Kairos y Pronos

Cada herramienta vive en su propia carpeta dentro de [`tools/`](tools/):

- `tools/kairos/` → proyecto **Kairos** (gestión de horas y horarios para nómina)
- `tools/pronos/` → proyecto **Pronos** (presupuestos y proyecciones de costos y gastos)

### Pasos para agregar una herramienta

1. **Copia el código del proyecto** dentro de su carpeta:

   ```bash
   # Ejemplo con Kairos
   cp -r <ruta-del-proyecto-kairos>/* tools/kairos/
   ```

   O, si la herramienta tiene su propio repositorio, inclúyela como submódulo:

   ```bash
   git submodule add <url-del-repo-kairos> tools/kairos
   git submodule add <url-del-repo-pronos> tools/pronos
   ```

2. **Cada herramienta mantiene sus propias dependencias**: dentro de su carpeta debe tener su propio `package.json` y su README con instrucciones de desarrollo. Instálalas desde su carpeta:

   ```bash
   cd tools/kairos
   npm install
   npm run dev
   ```

3. **Conecta el botón "Entrar" del hub**: en [`app/components/hub-carousel.tsx`](app/components/hub-carousel.tsx), el arreglo `TOOLS` define las tarjetas del carrusel. Agrega la URL o ruta de cada herramienta y úsala en el botón "Entrar" de `ToolCard`.

4. **Despliegue**: cada herramienta puede desplegarse como sitio adicional de Firebase Hosting del mismo proyecto `atlas-vs` (por ejemplo `atlas-vs-kairos.web.app`), agregando su bloque en `firebase.json`, o en su propio hosting. El portal enlaza a la URL desplegada.

> **Convención:** no mezclar código de las herramientas con el portal (`app/`). Todo lo de Kairos va en `tools/kairos/` y todo lo de Pronos en `tools/pronos/`.

## Despliegue del portal

El portal se exporta estático y se sirve con Firebase Hosting (proyecto `atlas-vs`):

```bash
npm run build          # genera la carpeta out/
firebase deploy --only hosting
```

---

Copyright © 2026 Producto Deportivas. Todos los derechos reservados.
