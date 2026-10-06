import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const API = `http://localhost:${process.env.API_PORT ?? 8787}`

export default defineConfig({
  plugins: [react()],
  root: '.',
  build: { outDir: 'dist/client' },
  server: {
    host: true,
    port: 5174,
    strictPort: true,
    proxy: { '/api': API, '/media': API },
  },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 60_000 },
})
