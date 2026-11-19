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

test('a 5xx the code meant for the client keeps its words (round 8), is logged, and the server stays up (before round 6 any 5xx crashed it)', async (t) => {
  const { base, log, alive } = await startServer(t)
  const ana = await who(base, 'ana@example.com', 'Ana Garza')
  // the plat reader without a model is a 503 with a plain line of its own (billing is gone from the client, round 8)
  const r = await j(await ana.post('/api/lot/plat', { name: 'plat.pdf', data: 'data:application/pdf;base64,JVBERi0xLjQK' }))
  assert.equal(r.status, 503, JSON.stringify(r))
  assert.match(r.body.error, /plat|interpreter|not set up|key/i)
  assert.ok(alive(), 'the server did not crash')
  assert.match(log(), /\[api\] POST \/api\/lot\/plat → 503/, 'the detail is in the log')
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

test('a fix the plan cannot take in place is a new draft through the office: "add a garage" on the narrow 3/2 is refused with a re-draft fix, the fix applies, the garage is there, one credit', async (t) => {
  const { generateRooms: gen, DEFAULT_PROGRAM, isRoom } = await import('../src/draft/lib/layout.js')
  const { base } = await startServer(t)
  const ana = await who(base, 'ana@example.com', 'Ana Garza')
  const lot = buildLot({ kind: 'manual', width: 50, depth: 120, city: 'pharr', setbacks: {} })
  const p32 = { ...DEFAULT_PROGRAM, beds: 3, baths: 2, halfBath: false, office: false, garage: 0, suite2: false, sqft: 1800 }
  const rooms = gen(p32, style, lot)
  const made = await j(await ana.post('/api/projects', { lot, style: { id: 'farmhouse' }, program: p32, rooms, client: 'Ana' }))
  assert.equal(made.status, 201, JSON.stringify(made.body))
  const credits = made.body.changesLeft
  // an edit first, so the re-draft has something to carry over (the first of these the narrow plan takes)
  let edit = null
  for (const text of ['make the pantry smaller', 'make bedroom 2 bigger', 'make the living room 1 foot deeper', 'make the primary closet bigger']) {
    const r0 = await j(await ana.post(`/api/projects/${made.body.id}/change`, { text }))
    if (r0.body.applied) {
      edit = text
      break
    }
  }
  assert.ok(edit, 'one room-level edit applied on the narrow 3/2')
  const r = await j(await ana.post(`/api/projects/${made.body.id}/change`, { text: 'add a garage' }))
  assert.equal(r.status, 200)
  assert.equal(r.body.applied, false)
  assert.match(r.body.reply, /no room for a garage/i)
  assert.equal(r.body.changesLeft, credits - 1, 'a refusal is not charged')
  const redo = r.body.fixes.find((f) => /Re-draft the house with a 2-car garage/.test(f.label))
  assert.ok(redo, JSON.stringify(r.body.fixes))
  const done = await j(await ana.post(`/api/projects/${made.body.id}/change`, { text: redo.label, ops: redo.ops }))
  assert.equal(done.body.applied, true, done.body.reply)
  assert.ok(done.body.rooms.some((x) => isRoom(x) && x.kind === 'garage'), 'the new draft has the garage')
  assert.ok(done.body.reply.includes(`still stand: "${edit}"`) || done.body.reply.includes(`Could not keep: "${edit}"`), `the earlier edit is accounted for: ${done.body.reply}`)
  assert.equal(done.body.changesLeft, credits - 2, 'one change for the new draft')
  const detail = await j(await ana.get(`/api/projects/${made.body.id}`))
  assert.equal(detail.body.versions[detail.body.versions.length - 1].kind, 'change')
})

// ── round 8 ──────────────────────────────────────────────────────────────────
test('round 8: the stored program follows the drawn plan after a 5-step chat (Review and Send read the same numbers), and "undo" rolls back at no credit', async (t) => {
  const { generateRooms: gen, DEFAULT_PROGRAM, programOf, floorArea } = await import('../src/draft/lib/layout.js')
  const { base } = await startServer(t)
  const ana = await who(base, 'ana@example.com', 'Ana Garza')
  const lot = buildLot({ kind: 'manual', width: 100, depth: 150, city: 'mcallen', setbacks: {} })
  const program = { ...DEFAULT_PROGRAM, sqft: 2800 }
  const rooms = gen(program, style, lot)
  const made = await j(await ana.post('/api/projects', { lot, style: { id: 'farmhouse' }, program, rooms, client: 'Ana' }))
  assert.equal(made.status, 201, JSON.stringify(made.body))
  const id = made.body.id
  const steps = ['make the house 2,400 sf', 'add a bedroom', 'add a bedroom', 'make the garage 3 cars', 'make the kitchen 2 feet wider']
  let applied = 0
  for (const text of steps) {
    const r = await j(await ana.post(`/api/projects/${id}/change`, { text }))
    if (r.body.applied) applied++
  }
  // round 9: with McAllen's sourced setbacks (20 / 5 / 10) the 2,400 sf re-draft lands on a plan where the 3-car garage and the
  // wider kitchen are refused for the setback and the foyer; three of the five land, and the stored program must still follow
  assert.ok(applied >= 3, `${applied} of 5 applied`)
  const detail = await j(await ana.get(`/api/projects/${id}`))
  const drawn = programOf(detail.body.rooms, detail.body.program)
  const stored = detail.body.program
  assert.equal(stored.beds, drawn.beds, 'beds follow the plan')
  assert.equal(stored.garage, drawn.garage, 'the garage follows the plan')
  assert.equal(stored.sqft, Math.round(floorArea(detail.body.rooms, 1) / 50) * 50, 'the living area follows the plan, to 50 sf')
  assert.equal(stored.asked.sqft, 2800, 'the first ask is kept')
  assert.equal(stored.asked.beds, 4)
  const review = await j(await (await who(base, 'maria@drafthouse.test', 'Maria')).get(`/api/review/${id}`))
  assert.equal(review.body.program.beds, drawn.beds)
  // "undo": back one version, the credit returned, nothing charged
  const before = detail.body
  const undo = await j(await ana.post(`/api/projects/${id}/change`, { text: 'undo' }))
  assert.equal(undo.status, 200, JSON.stringify(undo.body))
  assert.equal(undo.body.applied, true)
  assert.equal(undo.body.undo, true)
  assert.match(undo.body.reply, /^Back to version \d+\./)
  assert.equal(undo.body.changesLeft, before.changesLeft + 1, 'the change that was undone came back to the plan')
  const after = await j(await ana.get(`/api/projects/${id}`))
  assert.equal(after.body.versions[after.body.versions.length - 1].kind, 'rollback')
  assert.equal(after.body.program.beds, programOf(after.body.rooms, after.body.program).beds, 'the program follows the restored plan')
  const back = await j(await ana.post(`/api/projects/${id}/change`, { text: 'go back' }))
  assert.equal(back.body.applied, true)
  // a fix tap answers with what was done (on the reference lot, where the standard plan takes a 3-car in place)
  const fresh = await j(await ana.post('/api/projects', { lot: { address: 'Lot 514, Villa-Rama East' }, style: { id: 'farmhouse' }, program, rooms: gen(program, style), client: 'Ana' }))
  const tap = await j(await ana.post(`/api/projects/${fresh.body.id}/change`, { text: 'Make it a 3-car garage?', ops: [{ op: 'garage', cars: 3 }] }))
  assert.equal(tap.body.applied, true, tap.body.reply)
  assert.doesNotMatch(tap.body.reply, /\?/)
  assert.match(tap.body.reply, /3-car garage/)
})

test('round 8, item 3: an unexpected error answers 500 with a plain line and a request id, the log carries the same id and the stack; an error that hides its words (expose: false) does the same; an error with its own status keeps its words', async (t) => {
  const { base, log, alive } = await startServer(t, { DRAFTHOUSE_TEST_ROUTES: '1' })
  const boom = await j(await fetch(base + '/api/_test/boom'))
  assert.equal(boom.status, 500)
  assert.match(boom.body.error, /^Something went wrong on our side; the office has been told\. Reference [0-9a-f]{8}\.$/)
  assert.match(boom.body.requestId, /^[0-9a-f]{8}$/)
  assert.ok(!/cannot read properties/.test(boom.body.error), 'no detail reaches the client')
  assert.match(log(), new RegExp(`\\[api\\] GET /api/_test/boom → 500 \\(request ${boom.body.requestId}\\)`), 'the log names the id')
  assert.match(log(), /boom: cannot read properties of undefined/, 'the detail is in the log')
  const hidden = await j(await fetch(base + '/api/_test/boom?mode=hidden'))
  assert.equal(hidden.status, 500)
  assert.ok(!/must not see/.test(hidden.body.error))
  assert.match(hidden.body.requestId, /^[0-9a-f]{8}$/)
  const own = await j(await fetch(base + '/api/_test/boom?mode=own'))
  assert.equal(own.status, 503)
  assert.equal(own.body.error, 'the plat reader is resting')
  assert.ok(alive(), 'the server stays up')
})
