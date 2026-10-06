import fs from 'node:fs'
import path from 'node:path'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { createApp } from './app.ts'
import { loadConfig } from './config.ts'
import { buildServices } from './services.ts'

if (fs.existsSync('.env')) process.loadEnvFile('.env')

const cfg = loadConfig()
const svc = buildServices(cfg)
const app = createApp(svc)

// In production the API also serves the built UI.
if (process.env.NODE_ENV === 'production' && fs.existsSync('dist/client')) {
  app.use('/*', serveStatic({ root: 'dist/client' }))
  app.get('*', serveStatic({ path: path.join('dist/client', 'index.html') }))
}

serve({ fetch: app.fetch, port: cfg.port }, ({ port }) => {
  console.log(`Alto Video Factory API on http://localhost:${port}`)
  console.log(`  store:   ${svc.store.kind}`)
  console.log(`  storage: ${svc.storage.kind}`)
  console.log(`  jobs:    ${svc.runner.kind}`)
  const p = svc.providers
  for (const x of [p.analyst, ...p.images, ...p.videos, p.segmenter]) {
    console.log(`  ${x.info.kind.padEnd(9)} ${x.info.label} [${x.info.model}]`)
  }
})
