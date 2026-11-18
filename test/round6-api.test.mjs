// Round 6, the office API: a lot spec the office cannot build is refused at the door with a plain line
// (400), a fault on our side answers with a generic line and the detail in the log (500, no crash), and a
// project keeps what the client first asked for beside the program it was drafted to.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { generateRooms } from '../src/draft/lib/layout.js'
import { STYLES } from '../src/draft/lib/styles.js'
import { KIT } from '../src/kits/modern-farmhouse.js'
import { buildLot } from '../src/draft/lib/lot.js'

const style = STYLES.find((s) => s.id === 'farmhouse')
const program = { ...KIT.reference.program }

async function startServer(t, env = {}) {
  const port = 9300 + Math.floor(Math.random() * 100)
  const base = `http://127.0.0.1:${port}`
  const proc = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, DRAFTHOUSE_CLAUDE_KEY: '', ANTHROPIC_API_KEY: '', DATABASE_URL: '', SUPABASE_URL: '', RESEND_API_KEY: '', DRAFTHOUSE_APP_KEY: '', DRAFTHOUSE_WORKER_KEY: 'test-worker-key', DRAFTHOUSE_DRAFTERS: 'maria@drafthouse.test', PORT: String(port), DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dh-r6-')), ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  proc.stdout.on('data', (c) => (out += c))
  proc.stderr.on('data', (c) => (out += c))
  t.after(() => proc.kill())
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(base + '/api/health')
      return { base, log: () => out, alive: () => proc.exitCode === null }
    } catch {
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  throw new Error('server did not start:\n' + out)
}
async function who(base, email, name) {
  const r = await fetch(base + '/api/auth/dev-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, name }) })
  const { token } = await r.json()
  const h = { 'content-type': 'application/json', authorization: `Bearer ${token}` }
  return {
    get: (p) => fetch(base + p, { headers: h }),
    post: (p, body = {}) => fetch(base + p, { method: 'POST', headers: h, body: JSON.stringify(body) }),
    put: (p, body = {}) => fetch(base + p, { method: 'PUT', headers: h, body: JSON.stringify(body) }),
  }
}
const j = async (r) => ({ status: r.status, body: await r.json() })

test('a lot spec the office cannot build is refused at the door: 400 with a plain line on create and on update, not a 500 on the first change', async (t) => {
  const { base } = await startServer(t)
  const ana = await who(base, 'ana@example.com', 'Ana Garza')
  const rooms = generateRooms(program, style)
  const bad = { address: 'somewhere', spec: { kind: 'plat', calls: [] } } // a plat with no boundary calls
  const r1 = await j(await ana.post('/api/projects', { lot: bad, style: { id: 'farmhouse' }, program, rooms, client: 'Ana' }))
  assert.equal(r1.status, 400, JSON.stringify(r1.body))
  assert.match(r1.body.error, /the lot cannot be built from what was sent \(plat\)/)
  assert.doesNotMatch(r1.body.error, /undefined|TypeError|Cannot read/)
  // a lot of no width is as bad
  const r1b = await j(await ana.post('/api/projects', { lot: { spec: { kind: 'manual', width: 0, depth: 150, city: 'mcallen' } }, style: { id: 'farmhouse' }, program, rooms, client: 'Ana' }))
  assert.equal(r1b.status, 400, JSON.stringify(r1b.body))
  assert.match(r1b.body.error, /0 x 150/)
  // a sound lot goes through, and a bad one cannot replace it later
  const good = buildLot({ kind: 'manual', width: 100, depth: 150, city: 'mcallen' })
  const made = await j(await ana.post('/api/projects', { lot: good, style: { id: 'farmhouse' }, program, rooms: generateRooms(program, style, good), client: 'Ana' }))
  assert.equal(made.status, 201, JSON.stringify(made.body))
  const r2 = await j(await ana.put(`/api/projects/${made.body.id}`, { lot: bad }))
  assert.equal(r2.status, 400)
  assert.match(r2.body.error, /cannot be built/)
  const still = await j(await ana.get(`/api/projects/${made.body.id}`))
  assert.equal(still.body.lot.spec.width, 100, 'the sound lot stays')
  // a change on the project works: the bad spec never reached the lot builder
  const ch = await j(await ana.post(`/api/projects/${made.body.id}/change`, { text: 'make the kitchen bigger' }))
  assert.ok(ch.status < 500, JSON.stringify(ch.body))
})

test('a fault on our side answers 500 with a generic line, logs the detail, and the server stays up', async (t) => {
  const { base, log, alive } = await startServer(t)
  const ana = await who(base, 'ana@example.com', 'Ana Garza')
  // the checkout without Stripe is a 503 the client sees plainly; before round 6 any 5xx crashed the server
  const r = await j(await ana.post('/api/billing/checkout', { pack: 'pack5' }))
  assert.ok(r.status >= 500, JSON.stringify(r))
  assert.equal(r.body.error, 'Something went wrong on our side; the office has the detail. Try again in a moment.')
  assert.ok(alive(), 'the server did not crash')
  assert.match(log(), /\[api\] POST \/api\/billing\/checkout → 5\d\d/, 'the detail is in the log')
  const h = await fetch(base + '/api/health')
  assert.equal(h.status, 200)
})

test('a project keeps what the client first asked for beside the program it was drafted to (program.asked), through create, detail and the list', async (t) => {
  const { base } = await startServer(t)
  const ana = await who(base, 'ana@example.com', 'Ana Garza')
  const lot = buildLot({ kind: 'manual', width: 60, depth: 120, city: 'mcallen' })
  const asked = { ...program, sqft: 2800 }
  const drafted = { ...program, sqft: 2200, asked }
  const rooms = generateRooms(drafted, style, lot)
  const made = await j(await ana.post('/api/projects', { lot, style: { id: 'farmhouse' }, program: drafted, rooms, client: 'Ana' }))
  assert.equal(made.status, 201, JSON.stringify(made.body))
  assert.equal(made.body.program.asked.sqft, 2800)
  const detail = await j(await ana.get(`/api/projects/${made.body.id}`))
  assert.equal(detail.body.program.asked.sqft, 2800)
  assert.equal(detail.body.program.sqft, 2200)
  const list = await j(await ana.get('/api/projects'))
  assert.equal((list.body.projects || list.body).find((p) => p.id === made.body.id).program.asked.sqft, 2800)
})
