// Office API end to end: design in, job claimed, progress, files, complete, dashboard overview,
// API keys, CORS, backup. Runs on the JSON store always, and on Postgres too when
// TEST_DATABASE_URL is set (a fresh database is created and dropped for the run).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'

const APP = 'test-app-key'
const WORKER = 'test-worker-key'
const ORIGIN = 'https://drafthouse.example'

async function startServer(t, env) {
  const port = 8790 + Math.floor(Math.random() * 100)
  const base = `http://127.0.0.1:${port}`
  const proc = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, DRAFTHOUSE_CLAUDE_KEY: '', ANTHROPIC_API_KEY: '', DATABASE_URL: '', SUPABASE_URL: '', RESEND_API_KEY: '', PORT: String(port), ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
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

// the full pipeline against a running server, as the app (app key) and the worker (worker key)
async function pipeline(base, keys) {
  const h = (role) => (keys ? { 'x-api-key': role === 'worker' ? WORKER : APP } : {})
  const post = (p, body, role = 'app') => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...h(role) }, body: JSON.stringify(body) })
  const get = (p, role = 'app') => fetch(base + p, { headers: h(role) })

  const h0 = await (await get('/api/health')).json()
  assert.equal(h0.ok, false, 'no worker yet means not healthy')
  assert.ok(h0.checks.find((c) => c.id === 'db').ok, 'database check ok')
  assert.ok(h0.checks.find((c) => c.id === 'store').ok, 'file store check ok')

  const hb = await (await post('/api/workers/heartbeat', { id: 'office-1', name: 'Office Revit', revit: '2024', pyrevit: '4.8', checks: [{ id: 'revit', name: 'Revit responds', ok: true, detail: 'smoke test 12s', at: new Date().toISOString() }] }, 'worker')).json()
  assert.ok(hb.ok)
  const h1 = await (await get('/api/health')).json()
  assert.equal(h1.ok, true)

  const created = await (await post('/api/designs', { design: { contract: 1, client: 'Garza', lot: { address: 'Lot 514' }, style: { name: 'Modern Farmhouse' }, livingSf: 2533 }, ifc: 'ISO-10303-21;' })).json()
  assert.equal(created.job.status, 'queued')
  const claim = await post('/api/jobs/claim', { worker: 'office-1' }, 'worker')
  assert.equal(claim.status, 200)
  const job = await claim.json()
  assert.equal(job.status, 'running')
  assert.equal(job.attempts, 1)
  const design = await (await get(job.designUrl, 'worker')).json()
  assert.equal(design.client, 'Garza')
  await post(`/api/jobs/${job.id}/progress`, { step: 'walls', message: '116 walls', pct: 40 }, 'worker')
  const up = await fetch(base + `/api/jobs/${job.id}/files/model.rvt`, { method: 'PUT', headers: h('worker'), body: Buffer.from('rvt bytes') })
  assert.equal((await up.json()).ok, true)
  await post(`/api/jobs/${job.id}/complete`, { outputs: [{ name: 'model.rvt', url: `/files/${job.designId}/model.rvt` }], log: 'ok' }, 'worker')
  const done = await (await get(`/api/jobs/${job.id}`)).json()
  assert.equal(done.status, 'done')
  assert.equal(done.steps.length, 1)
  const file = await get(`/files/${job.designId}/model.rvt`)
  assert.equal(await file.text(), 'rvt bytes')
  // a file link opened in a new tab carries the key in the query string
  if (keys) assert.equal((await fetch(base + `/files/${job.designId}/model.rvt?key=${APP}`)).status, 200)
  const ov = await (await get('/api/admin/overview')).json()
  assert.equal(ov.counts.done, 1)
  assert.equal(ov.counts.designs, 1)
  assert.ok(ov.events.length >= 3)
  assert.equal(ov.jobs[0].id, job.id)
  const none = await post('/api/jobs/claim', { worker: 'office-1' }, 'worker')
  assert.equal(none.status, 204)

  // fail once re-queues, fail twice stays failed, retry re-queues
  const second = await (await post('/api/designs', { design: { contract: 1, client: 'Lopez' } })).json()
  const j2 = await (await post('/api/jobs/claim', { worker: 'office-1' }, 'worker')).json()
  assert.equal(j2.designId, second.design.id)
  await post(`/api/jobs/${j2.id}/fail`, { error: 'Revit crashed' }, 'worker')
  assert.equal((await (await get(`/api/jobs/${j2.id}`)).json()).status, 'queued')
  await post('/api/jobs/claim', { worker: 'office-1' }, 'worker')
  await post(`/api/jobs/${j2.id}/fail`, { error: 'Revit crashed again' }, 'worker')
  assert.equal((await (await get(`/api/jobs/${j2.id}`)).json()).status, 'failed')
  await post(`/api/jobs/${j2.id}/retry`, {})
  assert.equal((await (await get(`/api/jobs/${j2.id}`)).json()).status, 'queued')

  // commands reach the worker once
  await post('/api/workers/office-1/commands', { command: 'smoke' })
  const hb2 = await (await post('/api/workers/heartbeat', { id: 'office-1', name: 'Office Revit' }, 'worker')).json()
  assert.deepEqual(hb2.commands, ['smoke'])
  const hb3 = await (await post('/api/workers/heartbeat', { id: 'office-1', name: 'Office Revit' }, 'worker')).json()
  assert.deepEqual(hb3.commands, [])

  // interpret log lines land in the store and the summary counts them
  await post('/api/interpret/verdict', { text: 'make the kitchen bigger', source: 'fallback', applied: true, reply: 'ok', ops: [] })
  const ilog = await (await get('/api/interpret/log')).json()
  assert.equal(ilog.count, 1)
  assert.equal(ilog.recent[0].request, 'make the kitchen bigger')

  // no Claude key in the test environment → 503 so the app falls back
  const interp = await post('/api/interpret', { text: 'bigger kitchen', rooms: [], program: {}, kit: {} })
  assert.equal(interp.status, 503)

  // backup on demand writes a gzip dump with everything in it
  const bk = await (await post('/api/admin/backup', {})).json()
  assert.ok(bk.name.startsWith('backups/db-'))
  assert.equal(bk.designs, 2)
  const h2 = await (await get('/api/health')).json()
  assert.ok(h2.checks.find((c) => c.id === 'backup').ok, 'backup check ok after a backup')
  return { bk, designId: job.designId }
}

test('office API end to end on the JSON store, open auth', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-'))
  const { base } = await startServer(t, { DATA_DIR: dir })
  const { bk } = await pipeline(base, false)
  const dump = JSON.parse(gunzipSync(fs.readFileSync(path.join(dir, 'files', bk.name))).toString())
  assert.equal(dump.designs.length, 2)
  assert.equal(dump.interpretLog.length, 1)
  // without keys, health says the API is open
  const h = await (await fetch(base + '/api/health')).json()
  assert.equal(h.checks.find((c) => c.id === 'auth').ok, false)
})

test('API keys and CORS', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-'))
  const { base } = await startServer(t, { DATA_DIR: dir, DRAFTHOUSE_APP_KEY: APP, DRAFTHOUSE_WORKER_KEY: WORKER, DRAFTHOUSE_APP_ORIGIN: ORIGIN })
  // no key: only the health verdict, nothing else
  const pub = await (await fetch(base + '/api/health')).json()
  assert.deepEqual(Object.keys(pub).sort(), ['ok', 'uptimeS', 'version'])
  assert.equal((await fetch(base + '/api/admin/overview')).status, 401)
  assert.equal((await fetch(base + '/api/jobs/claim', { method: 'POST' })).status, 401)
  // wrong key
  assert.equal((await fetch(base + '/api/admin/overview', { headers: { 'x-api-key': 'nope' } })).status, 401)
  // app key cannot act as the worker, worker key cannot see the dashboard
  assert.equal((await fetch(base + '/api/jobs/claim', { method: 'POST', headers: { 'x-api-key': APP } })).status, 403)
  assert.equal((await fetch(base + '/api/admin/overview', { headers: { 'x-api-key': WORKER } })).status, 403)
  assert.equal((await fetch(base + '/api/interpret/log', { headers: { authorization: `Bearer ${APP}` } })).status, 200)
  // CORS: the app origin is echoed, another site gets nothing
  const good = await fetch(base + '/api/health', { headers: { origin: ORIGIN, 'x-api-key': APP } })
  assert.equal(good.headers.get('access-control-allow-origin'), ORIGIN)
  const bad = await fetch(base + '/api/health', { headers: { origin: 'https://evil.example', 'x-api-key': APP } })
  assert.equal(bad.headers.get('access-control-allow-origin'), null)
  const pre = await fetch(base + '/api/designs', { method: 'OPTIONS', headers: { origin: ORIGIN } })
  assert.equal(pre.status, 204)
  assert.match(pre.headers.get('access-control-allow-headers'), /x-api-key/)
  // the whole pipeline still works with the right keys
  await pipeline(base, true)
  const h = await (await fetch(base + '/api/health', { headers: { 'x-api-key': APP } })).json()
  assert.equal(h.checks.find((c) => c.id === 'auth').ok, true)
})

test('office API end to end on Postgres', { skip: !process.env.TEST_DATABASE_URL && 'set TEST_DATABASE_URL to run' }, async (t) => {
  const { default: pg } = await import('pg')
  const admin = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL })
  await admin.connect()
  const name = 'dh_test_' + Date.now().toString(36)
  await admin.query(`create database ${name}`)
  t.after(async () => {
    await admin.query(`drop database ${name} with (force)`)
    await admin.end()
  })
  const url = new URL(process.env.TEST_DATABASE_URL)
  url.pathname = '/' + name
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-'))
  const { base, log } = await startServer(t, { DATA_DIR: dir, DATABASE_URL: url.toString(), DRAFTHOUSE_APP_KEY: APP, DRAFTHOUSE_WORKER_KEY: WORKER })
  assert.match(log(), /applied 001_init\.sql/)
  await pipeline(base, true)
  const h = await (await fetch(base + '/api/health', { headers: { 'x-api-key': APP } })).json()
  assert.equal(h.store, 'postgres')
  assert.match(h.checks.find((c) => c.id === 'db').detail, /2 designs, 2 jobs, 1 migrations/)
  // a second start finds the migration applied and the data still there
  const again = await startServer(t, { DATA_DIR: dir, DATABASE_URL: url.toString(), DRAFTHOUSE_APP_KEY: APP, DRAFTHOUSE_WORKER_KEY: WORKER })
  assert.doesNotMatch(again.log(), /applied 001_init/)
  const ov = await (await fetch(again.base + '/api/admin/overview', { headers: { 'x-api-key': APP } })).json()
  assert.equal(ov.counts.designs, 2)
  assert.equal(ov.counts.done, 1)
})

test('two workers never claim the same job', { skip: !process.env.TEST_DATABASE_URL && 'set TEST_DATABASE_URL to run' }, async (t) => {
  const { default: pg } = await import('pg')
  const admin = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL })
  await admin.connect()
  const name = 'dh_race_' + Date.now().toString(36)
  await admin.query(`create database ${name}`)
  t.after(async () => {
    await admin.query(`drop database ${name} with (force)`)
    await admin.end()
  })
  const url = new URL(process.env.TEST_DATABASE_URL)
  url.pathname = '/' + name
  const { base } = await startServer(t, { DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dh-')), DATABASE_URL: url.toString() })
  const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  for (let i = 0; i < 3; i++) await post('/api/designs', { design: { contract: 1, client: 'C' + i } })
  const claims = await Promise.all(Array.from({ length: 8 }, (_, i) => post('/api/jobs/claim', { worker: 'w' + i })))
  const got = claims.filter((r) => r.status === 200)
  assert.equal(got.length, 3)
  const ids = await Promise.all(got.map(async (r) => (await r.json()).id))
  assert.equal(new Set(ids).size, 3)
})
