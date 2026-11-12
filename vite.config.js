import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    // same-origin office API during development (run with VITE_API_URL='' to use it):
    // lets a preview opened from another device reach the API without CORS or a second port
    proxy: { '/api': 'http://localhost:8787', '/files': 'http://localhost:8787' },
  },
})
