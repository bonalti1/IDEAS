// Accounts, saved projects, credits, rollback, review. Runs on the JSON store in local sign-in mode,
// and on Postgres too when TEST_DATABASE_URL is set.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { generateRooms } from '../src/draft/lib/layout.js'
import { STYLES } from '../src/draft/lib/styles.js'
import { KIT } from '../src/kits/modern-farmhouse.js'

const style = STYLES.find((s) => s.id === 'farmhouse')
const program = { ...KIT.reference.program }
const WORKER = 'test-worker-key'

async function startServer(t, env) {
  const port = 8900 + Math.floor(Math.random() * 100)
  const base = `http://127.0.0.1:${port}`
  const proc = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, DRAFTHOUSE_CLAUDE_KEY: '', ANTHROPIC_API_KEY: '', DATABASE_URL: '', SUPABASE_URL: '', RESEND_API_KEY: '', DRAFTHOUSE_APP_KEY: '', DRAFTHOUSE_WORKER_KEY: WORKER, DRAFTHOUSE_DRAFTERS: 'maria@drafthouse.test', DRAFTHOUSE_ADMINS: 'rolando@drafthouse.test', PORT: String(port), ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  proc.stdout.on('data', (c) => (out += c))
  proc.stderr.on('data', (c) => (out += c))
  t.after(() => proc.kill())
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(base + '/api/health')
      return { base, log: () => out }
    } catch {
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  throw new Error('server did not start:\n' + out)
}

// a signed-in caller
async function who(base, email, name) {
  const r = await fetch(base + '/api/auth/dev-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, name }) })
  const { token, user } = await r.json()
  const h = { 'content-type': 'application/json', authorization: `Bearer ${token}` }
  return {
    user,
    get: (p) => fetch(base + p, { headers: h }),
    post: (p, body = {}) => fetch(base + p, { method: 'POST', headers: h, body: JSON.stringify(body) }),
    put: (p, body = {}) => fetch(base + p, { method: 'PUT', headers: h, body: JSON.stringify(body) }),
  }
}
const j = async (r) => ({ status: r.status, body: await r.json() })
const nRooms = (rs) => rs.filter((r) => !r.element).length // doors, windows, fixtures ride along as elements

async function suite(base) {
  const ana = await who(base, 'ana@example.com', 'Ana Garza')
  const ben = await who(base, 'ben@example.com', 'Ben Lopez')
  const maria = await who(base, 'maria@drafthouse.test', 'Maria')
  assert.equal(ana.user.role, 'client')
  assert.equal(maria.user.role, 'drafter')
  assert.equal((await j(await ana.get('/api/me'))).body.user.email, 'ana@example.com')

  // a project starts with the first draft as version 1 and the full credit allowance
  const rooms = generateRooms(program, style)
  const created = await j(await ana.post('/api/projects', { lot: { address: 'Lot 514, Villa-Rama East' }, style: { id: 'farmhouse', name: 'Modern Farmhouse' }, program, rooms, client: 'Ana Garza' }))
  assert.equal(created.status, 201)
  const prj = created.body
  assert.equal(prj.status, 'drafting')
  assert.equal(prj.credits, 10)
  assert.equal(prj.version, 1)
  assert.equal(nRooms(prj.rooms), nRooms(rooms))

  // an applied change costs one credit and makes version 2; a rejected one costs nothing
  const c1 = await j(await ana.post(`/api/projects/${prj.id}/change`, { text: 'make the kitchen bigger' }))
  assert.equal(c1.status, 200)
  assert.equal(c1.body.applied, true, c1.body.reply)
  assert.equal(c1.body.source, 'fallback', 'no Claude key in tests: basic rules')
  assert.equal(c1.body.credits, 9)
  assert.equal(c1.body.version, 2)
  const kitchen = (rs) => rs.find((r) => r.id === 'kitchen')
  assert.ok(kitchen(c1.body.rooms).w > kitchen(rooms).w)
  const c2 = await j(await ana.post(`/api/projects/${prj.id}/change`, { text: 'remove the kitchen' }))
  assert.equal(c2.body.applied, false)
  assert.equal(c2.body.credits, 9, 'a rejected change is free')
  const c3 = await j(await ana.post(`/api/projects/${prj.id}/change`, { text: 'add an office' }))
  assert.equal(c3.body.applied, true, c3.body.reply)
  assert.equal(c3.body.credits, 8)

  // the project reloads with its versions and current rooms; credits survive a reload because they live here
  const d1 = await j(await ana.get(`/api/projects/${prj.id}`))
  assert.equal(d1.body.credits, 8)
  assert.equal(d1.body.version, 3)
  assert.deepEqual(d1.body.versions.map((v) => v.kind), ['initial', 'change', 'change'])
  assert.equal(d1.body.versions[1].text, 'make the kitchen bigger')
  assert.equal(d1.body.versions[1].rooms, undefined, 'summaries carry no rooms')
  assert.equal(nRooms(d1.body.rooms), nRooms(rooms) + 1, 'office added')
  assert.equal((await j(await ana.get('/api/projects'))).body.length, 1)

  // rollback to version 1 returns both credits and keeps every version
  const rb = await j(await ana.post(`/api/projects/${prj.id}/rollback`, { version: 1 }))
  assert.equal(rb.status, 200)
  assert.equal(rb.body.credits, 10)
  assert.equal(rb.body.refunded, 2)
  assert.equal(rb.body.version, 4)
  assert.equal(kitchen(rb.body.rooms).w, kitchen(rooms).w)
  assert.equal(nRooms(rb.body.rooms), nRooms(rooms))
  const d2 = await j(await ana.get(`/api/projects/${prj.id}`))
  assert.deepEqual(d2.body.versions.map((v) => v.kind), ['initial', 'change', 'change', 'rollback'])
  assert.equal(d2.body.versions[1].refunded, true)
  // rolling forward to version 3 is free and does not refund twice
  const rf = await j(await ana.post(`/api/projects/${prj.id}/rollback`, { version: 3 }))
  assert.equal(rf.body.credits, 10)
  assert.equal(nRooms(rf.body.rooms), nRooms(rooms) + 1)
  assert.equal((await j(await ana.post(`/api/projects/${prj.id}/rollback`, { version: 99 }))).status, 404)

  // the program can change: a free version with regenerated rooms (the lot and the packer decide what fits, not this test)
  const up = await j(await ana.put(`/api/projects/${prj.id}`, { program: { ...program, name: 'same rooms' }, rooms: generateRooms(program, style), client: 'Ana G.', note: 'Rooms changed' }))
  assert.equal(up.status, 200)
  assert.equal(up.body.client, 'Ana G.')
  assert.equal(up.body.version, 6)
  assert.equal(up.body.credits, 10)

  // permissions: another client cannot see, change or send it; drafters can see it
  assert.equal((await ben.get(`/api/projects/${prj.id}`)).status, 404)
  assert.equal((await ben.post(`/api/projects/${prj.id}/change`, { text: 'bigger kitchen' })).status, 404)
  assert.equal((await ben.post(`/api/projects/${prj.id}/send`, {})).status, 404)
  assert.equal((await j(await ben.get('/api/projects'))).body.length, 0)
  assert.equal((await maria.get(`/api/projects/${prj.id}`)).status, 200)
  assert.equal((await ana.get('/api/review')).status, 403, 'clients cannot see the review inbox')
  assert.equal((await ana.get('/api/admin/overview')).status, 403)
  assert.equal((await fetch(base + '/api/projects')).status, 401, 'no token')
  assert.equal((await fetch(base + '/api/projects', { headers: { authorization: 'Bearer dh1.bogus.sig' } })).status, 401, 'bad token')

  // send: the design goes to the drafters, nothing is built yet, and the plan is locked
  const sent = await j(await ana.post(`/api/projects/${prj.id}/send`, { design: { contract: 1, client: 'Ana Garza', lot: { address: 'Lot 514' }, style: { name: 'Modern Farmhouse' }, livingSf: 2533, changes: ['make the kitchen bigger'] }, ifc: 'ISO-10303-21;' }))
  assert.equal(sent.status, 200)
  assert.equal(sent.body.status, 'in_review')
  assert.ok(sent.body.designId)
  assert.equal((await ana.post(`/api/projects/${prj.id}/change`, { text: 'bigger kitchen' })).status, 409)
  assert.equal((await ana.post(`/api/projects/${prj.id}/send`, {})).status, 409)
  const worker = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': WORKER }, body: JSON.stringify(body) })
  assert.equal((await worker('/api/jobs/claim', { worker: 'w' })).status, 204, 'no job until a drafter approves')

  // the drafter returns it with a note; the client sees the note and can keep drafting
  const inbox = await j(await maria.get('/api/review'))
  assert.equal(inbox.body.waiting.length, 1)
  assert.equal(inbox.body.waiting[0].id, prj.id)
  const ret = await j(await maria.post(`/api/review/${prj.id}`, { decision: 'returned', note: 'The office needs a window. Move it to an outside wall.' }))
  assert.equal(ret.status, 200)
  assert.equal(ret.body.status, 'returned')
  const d3 = await j(await ana.get(`/api/projects/${prj.id}`))
  assert.equal(d3.body.status, 'returned')
  assert.match(d3.body.review.note, /needs a window/)
  assert.equal(d3.body.reviews.length, 1)
  const c4 = await j(await ana.post(`/api/projects/${prj.id}/change`, { text: 'make the kitchen bigger' }))
  assert.equal(c4.body.applied, true, c4.body.reply)
  assert.equal(c4.body.credits, 9)

  // sent again, approved: the Revit job is queued, built when the worker finishes
  await ana.post(`/api/projects/${prj.id}/send`, { design: { contract: 1, client: 'Ana Garza' } })
  assert.equal((await j(await maria.get('/api/review'))).body.waiting.length, 1)
  assert.equal((await maria.post(`/api/review/${prj.id}`, { decision: 'maybe' })).status, 400)
  // the drafter sees the audit with the design: pass or fail per check, sf asked vs delivered, open questions
  const det = await j(await maria.get(`/api/review/${prj.id}`))
  assert.ok(det.body.audit && Array.isArray(det.body.audit.groups) && det.body.audit.groups.length >= 8, 'audit groups')
  assert.equal(det.body.audit.ok, true, JSON.stringify(det.body.audit.groups.filter((g) => !g.ok)))
  assert.ok(det.body.audit.measures.livingSf > 0 && det.body.audit.questions.some((q) => /rates are not confirmed/i.test(q)))
  const ok = await j(await maria.post(`/api/review/${prj.id}`, { decision: 'approved', note: 'Looks good.' }))
  assert.equal(ok.body.status, 'approved')
  assert.ok(ok.body.jobId)
  assert.equal((await maria.post(`/api/review/${prj.id}`, { decision: 'approved' })).status, 409, 'cannot review twice')
  const claim = await j(await worker('/api/jobs/claim', { worker: 'office-1' }))
  assert.equal(claim.status, 200)
  assert.equal(claim.body.projectId, prj.id)
  const d4 = await j(await ana.get(`/api/projects/${prj.id}`))
  assert.equal(d4.body.status, 'approved')
  assert.equal(d4.body.job.status, 'running')
  await worker(`/api/jobs/${claim.body.id}/complete`, { outputs: [{ name: 'model.rvt', url: `/files/${claim.body.designId}/model.rvt` }] })
  const d5 = await j(await ana.get(`/api/projects/${prj.id}`))
  assert.equal(d5.body.status, 'built')
  assert.equal(d5.body.job.status, 'done')
  assert.equal((await j(await maria.get('/api/review'))).body.waiting.length, 0)
  assert.equal((await j(await maria.get('/api/review'))).body.recent[0].status, 'built')

  // roles: only an admin changes them
  const rolando = await who(base, 'rolando@drafthouse.test', 'Rolando')
  assert.equal(rolando.user.role, 'admin')
  assert.equal((await maria.post(`/api/admin/users/${ben.user.id}/role`, { role: 'drafter' })).status, 403)
  assert.equal((await j(await rolando.post(`/api/admin/users/${ben.user.id}/role`, { role: 'drafter' }))).body.role, 'drafter')
  const ben2 = await who(base, 'ben@example.com')
  assert.equal(ben2.user.role, 'drafter')
  assert.equal((await ben2.get('/api/review')).status, 200)

  // the interpret log kept every verdict with the project id
  const log = await j(await maria.get('/api/interpret/log'))
  assert.ok(log.body.recent.some((r) => r.projectId === prj.id && r.verdict === 'rejected'))
  assert.ok(log.body.recent.some((r) => r.projectId === prj.id && r.verdict === 'applied'))
}

test('accounts, projects, credits, rollback and review on the JSON store', async (t) => {
  const { base } = await startServer(t, { DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dh-')) })
  await suite(base)
})

test('credits run out: the change is refused with 402 and nothing is saved', async (t) => {
  const { base } = await startServer(t, { DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dh-')), CREDITS_PER_PROJECT: '1' })
  const ana = await who(base, 'ana@example.com')
  const prj = (await j(await ana.post('/api/projects', { style: { id: 'farmhouse' }, program, rooms: generateRooms(program, style) }))).body
  assert.equal(prj.credits, 1)
  const c1 = await j(await ana.post(`/api/projects/${prj.id}/change`, { text: 'make the kitchen bigger' }))
  assert.equal(c1.body.credits, 0)
  const c2 = await j(await ana.post(`/api/projects/${prj.id}/change`, { text: 'add an office' }))
  assert.equal(c2.status, 402)
  assert.equal(c2.body.credits, 0)
  const d = await j(await ana.get(`/api/projects/${prj.id}`))
  assert.equal(d.body.version, 2)
  assert.equal(nRooms(d.body.rooms), nRooms(prj.rooms), 'the office was not added')
  // undo gives the credit back and the next change works again
  await ana.post(`/api/projects/${prj.id}/rollback`, { version: 1 })
  assert.equal((await j(await ana.post(`/api/projects/${prj.id}/change`, { text: 'add an office' }))).body.applied, true)
})

test('local sign-in is off when Supabase is configured', async (t) => {
  const { base } = await startServer(t, { DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dh-')), SUPABASE_URL: 'https://example.supabase.co', SUPABASE_JWT_SECRET: 'x' })
  const r = await fetch(base + '/api/auth/dev-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'ana@example.com' }) })
  assert.equal(r.status, 404)
  assert.equal((await fetch(base + '/api/me', { headers: { authorization: 'Bearer dh1.x.y' } })).status, 401)
  const h = await (await fetch(base + '/api/health')).json()
  assert.equal(h.auth, 'supabase')
})

test('accounts on Postgres', { skip: !process.env.TEST_DATABASE_URL && 'set TEST_DATABASE_URL to run' }, async (t) => {
  const { default: pg } = await import('pg')
  const admin = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL })
  await admin.connect()
  const name = 'dh_acc_' + Date.now().toString(36)
  await admin.query(`create database ${name}`)
  t.after(async () => {
    await admin.query(`drop database ${name} with (force)`)
    await admin.end()
  })
  const url = new URL(process.env.TEST_DATABASE_URL)
  url.pathname = '/' + name
  const { base, log } = await startServer(t, { DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dh-')), DATABASE_URL: url.toString() })
  assert.match(log(), /applied 001_init\.sql, 002_accounts\.sql/)
  await suite(base)
})

test('a plan that breaks the rules cannot be sent: 409 with the reasons, then it sends once fixed', async (t) => {
  const { base } = await startServer(t, { DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dh-')) })
  const ana = await who(base, 'ana@example.com', 'Ana Garza')
  const good = generateRooms(program, style)
  // the kitchen pushed 60 ft east crosses the side setback; the office rebuilds the lot from the spec, so geometry sent by a browser cannot bypass the rules
  const broken = good.map((r) => (r.id === 'kitchen' ? { ...r, center: [r.center[0] + 200, r.center[1]] } : r))
  const prj = (await j(await ana.post('/api/projects', { style: { id: 'farmhouse' }, program, rooms: broken, lot: { spec: { kind: 'reference' } } }))).body
  const refused = await j(await ana.post(`/api/projects/${prj.id}/send`, { design: { contract: 1, client: 'Ana Garza' }, ifc: 'ISO-10303-21;' }))
  assert.equal(refused.status, 409)
  assert.match(refused.body.error, /breaks 1 rule/)
  assert.ok(refused.body.rules.some((x) => /setback/.test(x)), refused.body.rules.join(' | '))
  assert.equal((await j(await ana.get(`/api/projects/${prj.id}`))).body.status, 'drafting')
  await ana.put(`/api/projects/${prj.id}`, { rooms: good, note: 'fixed' })
  const sent = await j(await ana.post(`/api/projects/${prj.id}/send`, { design: { contract: 1, client: 'Ana Garza' }, ifc: 'ISO-10303-21;' }))
  assert.equal(sent.status, 200)
  assert.equal(sent.body.status, 'in_review')
})

test('a fix the client clicked applies its ops without the interpreter and costs one credit', async (t) => {
  const { base } = await startServer(t, { DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dh-')) })
  const ana = await who(base, 'ana@example.com', 'Ana Garza')
  // a 100 by 150 ft lot in McAllen: a 40 ft primary bedroom crosses the side setback there
  const { buildLot } = await import('../src/draft/lib/lot.js')
  const lot = buildLot({ kind: 'manual', width: 100, depth: 150, city: 'mcallen', setbacks: {} })
  const prj = (await j(await ana.post('/api/projects', { style: { id: 'farmhouse' }, program, rooms: generateRooms(program, style, lot), lot }))).body
  // too wide: refused with the whole list and at least one fix to click
  const no = await j(await ana.post(`/api/projects/${prj.id}/change`, { text: 'make the primary bedroom 40 feet wide' }))
  assert.equal(no.body.applied, false)
  assert.ok(no.body.reasons.length >= 1)
  assert.ok(no.body.fixes.length >= 1, 'a fix is offered')
  assert.ok(no.body.fixes[0].label.endsWith('?'))
  assert.equal(no.body.credits, 10, 'a refusal costs nothing')
  const yes = await j(await ana.post(`/api/projects/${prj.id}/change`, { text: no.body.fixes[0].label, ops: no.body.fixes[0].ops }))
  assert.equal(yes.body.applied, true, yes.body.reply)
  assert.equal(yes.body.source, 'fix')
  assert.equal(yes.body.credits, 9)
})

test('/api/interpret answers 200 with the basic rules when the office has no Claude key', async (t) => {
  const { base } = await startServer(t, { DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dh-')) })
  const { summarizeRooms } = await import('../src/draft/lib/ops.js')
  const rooms = summarizeRooms(generateRooms(program, style))
  const r = await fetch(base + '/api/interpret', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'make the kitchen bigger', rooms, program, kit: { id: 'farmhouse' } }) })
  assert.equal(r.status, 200)
  const body = await r.json()
  assert.equal(body.source, 'fallback')
  assert.equal(body.reason, 'not configured')
  assert.equal(body.ops[0].op, 'resize')
  assert.equal(body.ops[0].room, 'kitchen')
  // a request the rules cannot read is still 200, with a question back and no ops
  const r2 = await fetch(base + '/api/interpret', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'make it nicer', rooms, program, kit: { id: 'farmhouse' } }) })
  assert.equal(r2.status, 200)
  assert.deepEqual((await r2.json()).ops, [])
})

test('a plan with audit errors is approved only over an override note, and the override is logged', async () => {
  // Send blocks a plan that fails the audit, so the gate is for a design already in review (a kit or
  // audit update after it was sent): exercised on the project module with a JSON store
  const { openStore } = await import('../server/store/index.mjs')
  const { makeProjects } = await import('../server/projects.mjs')
  const store = openStore({ databaseUrl: '', dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'dh-gate-')) })
  const events = []
  const projects = makeProjects({ store, interpreter: null, event: async (kind, message, ref) => events.push({ kind, message, ...ref }), logInterpret: async () => {}, lots: { lotOfProject: async (p) => p.lot } })
  const user = { id: 'u1', email: 'ana@example.com', name: 'Ana Garza', credits: 10 }
  await store.users.put(user)
  const rooms = generateRooms(program, style).filter((e) => e.id !== 'd-bed2') // Bedroom 2 loses its hall door: unreachable
  const p = await projects.create(user, { style: { id: 'farmhouse' }, program, rooms, client: 'Ana Garza' })
  p.status = 'in_review'
  await store.projects.put(p)
  const det = await projects.detail(p, { drafter: true })
  assert.equal(det.audit.ok, false)
  assert.ok(det.audit.groups.find((g) => g.id === 'reach' && !g.ok), 'the reach check fails')
  assert.equal((await projects.detail(p)).audit, undefined, 'the owner view has no audit')
  const maria = { id: 'd1', email: 'maria@drafthouse.test', name: 'Maria', role: 'drafter' }
  await assert.rejects(projects.review(p, maria, { decision: 'approved', note: 'Door drawn by hand in Revit; client confirmed.' }, async () => ({ id: 'job1' })), /override note/)
  await assert.rejects(projects.review(p, maria, { decision: 'approved', override: 'ok by me' }, async () => ({ id: 'job1' })), /20 characters/)
  const yes = await projects.review(p, maria, { decision: 'approved', note: 'Approved.', override: 'Door drawn by hand in Revit; client confirmed.' }, async () => ({ id: 'job1' }))
  assert.equal(yes.status, 'approved')
  assert.equal(yes.reviews[0].override.by, 'Maria')
  assert.ok(yes.reviews[0].override.errors.length >= 1 && yes.reviews[0].override.at)
  assert.ok(events.some((e) => /approved over \d+ audit error/.test(e.message) && e.override), 'the override is in the log')
})

test('the homeowner never receives the audit, the office questions or an override note; the drafter does, cached per version', async (t) => {
  const { base } = await startServer(t, { DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dh-priv-')) })
  const ana = await who(base, 'ana2@example.com', 'Ana Garza')
  const maria = await who(base, 'maria@drafthouse.test', 'Maria')
  const prj = (await j(await ana.post('/api/projects', { lot: { address: 'Lot 514, Villa-Rama East' }, style: { id: 'farmhouse', name: 'Modern Farmhouse' }, program, rooms: generateRooms(program, style), client: 'Ana Garza' }))).body
  const own = (await j(await ana.get(`/api/projects/${prj.id}`))).body
  assert.equal(own.audit, undefined, 'no audit for the owner')
  assert.equal(own.questions, undefined, 'no office questions for the owner')
  assert.ok(!JSON.stringify(own).includes('server/projects.mjs'), 'no source paths for the owner')
  const office = (await j(await maria.get(`/api/review/${prj.id}`))).body
  assert.ok(office.audit && typeof office.audit.ok === 'boolean' && office.audit.questions.length >= 1, 'the drafter sees the audit and the questions')
  assert.deepEqual((await j(await maria.get(`/api/review/${prj.id}`))).body.audit, office.audit, 'the same audit for the same version')
  // sent and approved with a note to the client: the owner sees the decision and the note, never override fields
  await ana.post(`/api/projects/${prj.id}/send`, { design: { contract: 1, client: 'Ana Garza' } })
  const ok = await j(await maria.post(`/api/review/${prj.id}`, { decision: 'approved', note: 'Approved, building it.' }))
  assert.equal(ok.status, 200, JSON.stringify(ok.body))
  const seen = (await j(await ana.get(`/api/projects/${prj.id}`))).body
  assert.equal(seen.reviews.length, 1)
  assert.equal(seen.reviews[0].override, undefined)
  assert.equal(seen.reviews[0].overridden, false)
  assert.equal(seen.reviews[0].auditErrors, undefined)
  assert.match(seen.review.note, /Approved, building it/)
  assert.equal(seen.audit, undefined)
  // the override itself (20 characters, who, when, which errors) is covered on the module above
})

test('with no Claude key the office answers a change in under a second (the regex fallback), and an unsupported request without a model call', async (t) => {
  const { base } = await startServer(t, { DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dh-fast-')) })
  const ana = await who(base, 'ana3@example.com', 'Ana Garza')
  const prj = (await j(await ana.post('/api/projects', { lot: { address: 'Lot 514, Villa-Rama East' }, style: { id: 'farmhouse', name: 'Modern Farmhouse' }, program, rooms: generateRooms(program, style), client: 'Ana Garza' }))).body
  const t0 = Date.now()
  const c = await j(await ana.post(`/api/projects/${prj.id}/change`, { text: 'make the kitchen 2 feet wider' }))
  const ms = Date.now() - t0
  assert.equal(c.body.applied, true, c.body.reply)
  assert.equal(c.body.source, 'fallback')
  assert.ok(ms < 1000, `fallback took ${ms} ms`)
  const two = await j(await ana.post(`/api/projects/${prj.id}/change`, { text: 'make it two story' }))
  assert.equal(two.body.applied, false)
  assert.match(two.body.reply, /one story for now/)
  assert.equal(two.body.credits, c.body.credits, 'no credit for an unsupported request')
  console.log(`  fallback change on the office API with no key: ${ms} ms`)
})

test('after an override approval, no owner view (list, detail, what update and rollback return) carries the override note, the errors it covered, drafter ids or lot-confirmation notes', async (t) => {
  const { openStore } = await import('../server/store/index.mjs')
  const { makeProjects } = await import('../server/projects.mjs')
  const store = openStore({ databaseUrl: '', dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'dh-own-')) })
  const projects = makeProjects({ store, interpreter: null, event: async () => {}, logInterpret: async () => {}, lots: { lotOfProject: async (p) => p.lot } })
  const user = { id: 'u9', email: 'ana9@example.com', name: 'Ana Garza', credits: 10 }
  await store.users.put(user)
  const rooms = generateRooms(program, style).filter((e) => e.id !== 'd-bed2')
  const p = await projects.create(user, { style: { id: 'farmhouse' }, program, rooms, client: 'Ana Garza', lot: { address: 'Lot 514', spec: { kind: 'plat', confirmed: true, confirmedBy: 'maria@drafthouse.test', confirmNote: 'checked against the plat' }, plat: { notes: 'reader notes for the office' } } })
  p.status = 'in_review'
  await store.projects.put(p)
  const maria = { id: 'd9', email: 'maria@drafthouse.test', name: 'Maria', role: 'drafter' }
  const SECRET = 'The hall door is on the drafter sheet; the draft lost it on export.'
  const yes = await projects.review(p, maria, { decision: 'approved', note: 'Approved.', override: SECRET }, async () => ({ id: 'job9' }))
  assert.equal(yes.reviews[0].override.note, SECRET, 'the drafter view carries the override')
  const views = {
    list: (await store.projects.listForUser(user.id)).map(projects.ownerView),
    detail: await projects.detail(await store.projects.get(p.id)),
  }
  for (const [name, v] of Object.entries(views)) {
    const text = JSON.stringify(v)
    assert.ok(!text.includes(SECRET), `${name}: no override note`)
    assert.ok(!/"override":\{/.test(text) && !/"byId"/.test(text) && !/"auditErrors"/.test(text) && !/"drafterId"/.test(text) && !/"audit":\{/.test(text) && !/"questions":/.test(text) && !/confirmedBy|confirmNote|reader notes/.test(text), `${name}: no office-only fields: ${text.slice(0, 200)}`)
    assert.ok(text.includes('"overridden":true') && text.includes('"decision":"approved"'), `${name}: the decision and the fact of an override stay`)
  }
})

test('GET /api/projects goes through the owner view', async (t) => {
  const { base } = await startServer(t, { DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dh-list-')) })
  const ana = await who(base, 'ana5@example.com', 'Ana Garza')
  const maria = await who(base, 'maria@drafthouse.test', 'Maria')
  const prj = (await j(await ana.post('/api/projects', { lot: { address: 'Lot 514, Villa-Rama East' }, style: { id: 'farmhouse', name: 'Modern Farmhouse' }, program, rooms: generateRooms(program, style), client: 'Ana Garza' }))).body
  await ana.post(`/api/projects/${prj.id}/send`, { design: { contract: 1, client: 'Ana Garza' } })
  await maria.post(`/api/review/${prj.id}`, { decision: 'returned', note: 'Move the office window.' })
  const list = await (await ana.get('/api/projects')).text()
  const rows = JSON.parse(list)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].review.decision, 'returned')
  assert.ok(!/"drafterId"|"override"|"audit":\{|"questions":/.test(list), 'no office-only fields in the list')
  assert.equal(rows[0].review.overridden, false)
})
