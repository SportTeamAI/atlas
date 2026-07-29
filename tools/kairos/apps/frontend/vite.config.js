import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// VITE_BASE: '/' en standalone, '/jornada/' al embeberse en el hub NOSTRA.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: process.env.VITE_BASE || '/',
  server: {
    port: 5180,
    proxy: {
      // El front llama /api/... y el proxy lo reescribe al backend FastAPI local.
      '/api': {
        target: process.env.VITE_API_PROXY || 'http://127.0.0.1:8020',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
