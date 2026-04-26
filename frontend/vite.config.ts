import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../cmd/server/frontend/dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      // Existing template API (kept so /api/health etc. still work).
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      // Pupload BFF — the only surface the React app talks to.
      '/bff': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
