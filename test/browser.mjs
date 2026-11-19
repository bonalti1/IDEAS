// Shared by the browser tests (round 9, item 12): one Chrome lookup, free ports instead of the developer's
// :8787 and :4188, a preview server that dies with its whole process group, and a way to point the built app
// at the test's own API port without rebuilding (localStorage 'drafthouse.api', read once by lib/api.js).
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'

/** CHROME, then PLAYWRIGHT_CHROMIUM, then whatever `which` finds, then the sandbox path; null when there is none. */
export function chromePath() {
  for (const p of [process.env.CHROME, process.env.PLAYWRIGHT_CHROMIUM]) if (p && fs.existsSync(p)) return p
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    const r = spawnSync('which', [name], { encoding: 'utf8' })
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim()
  }
  return fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : null
}

/** A port nothing listens on right now. */
export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

async function waitFor(url, tries = 150) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url)
      if (r.status < 500) return true
    } catch {}
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`${url} did not come up`)
}

/** Spawn in its own process group so t.after kills the tree (npx → vite → esbuild), not just the first process. */
export function spawnGroup(t, cmd, args, { env = {}, cwd } = {}) {
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
  let out = ''
  p.stdout.on('data', (d) => (out += d))
  p.stderr.on('data', (d) => (out += d))
  t.after(() => {
    try {
      process.kill(-p.pid, 'SIGTERM')
    } catch {
      try {
        p.kill()
      } catch {}
    }
  })
  return { proc: p, log: () => out }
}

/** The built app on a free port (vite preview, built first when dist/ is missing). Returns its URL. */
export async function startPreview(t) {
  if (!fs.existsSync('dist/index.html')) {
    const b = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], { encoding: 'utf8', timeout: 240000 })
    if (b.status !== 0) throw new Error('vite build failed: ' + (b.stderr || '').slice(-400))
  }
  const port = await freePort()
  spawnGroup(t, process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'])
  await waitFor(`http://127.0.0.1:${port}/`)
  return `http://127.0.0.1:${port}`
}

/** A browser context whose app calls `apiBase` (set before any script runs), with the viewport and options given. */
export async function appContext(browser, apiBase, options = {}) {
  const ctx = await browser.newContext(options)
  await ctx.addInitScript((api) => {
    try {
      localStorage.setItem('drafthouse.api', api)
    } catch {}
  }, apiBase)
  return ctx
}

/** Where a browser test writes its pictures: SHOTS when set, else a temp folder nobody commits. */
export function shotDir(fallbackName) {
  const dir = process.env.SHOTS || path.join(os.tmpdir(), `dh-shots-${fallbackName}`)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}
