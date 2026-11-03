// Draft House office API: job queue, file store, worker heartbeats, health.
// No dependencies. Run: node server/index.mjs   (PORT, DATA_DIR env optional)
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = +(process.env.PORT || 8787)
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data')
const FILES = path.join(DATA, 'files')
const DB_PATH = path.join(DATA, 'db.json')
const VERSION = '0.1.0'
const LEASE_MIN = 20 // a running job with no progress for this long is stuck
const WORKER_STALE_S = 90 // a worker silent for this long is offline
const started = Date.now()

fs.mkdirSync(FILES, { recursive: true })
const db = fs.existsSync(DB_PATH) ? JSON.parse(fs.readFileSync(DB_PATH, 'utf8')) : { designs: [], jobs: [], workers: [], events: [], commands: [] }
let saveTimer = null
const save = () => {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => fs.writeFileSync(DB_PATH, JSON.stringify(db)), 50)
}
const id = (p) => p + '_' + crypto.randomBytes(5).toString('hex')
const now = () => new Date().toISOString()
const event = (kind, message, ref = {}) => {
  db.events.unshift({ id: id('ev'), at: now(), kind, message, ...ref })
  db.events.length = Math.min(db.events.length, 500)
  save()
}

// ── health ─────────────────────────────────────────────────────────────────
function health() {
  const t = Date.now()
  const workers = db.workers.map((w) => ({ ...w, online: t - Date.parse(w.lastSeen) < WORKER_STALE_S * 1000 }))
  const queued = db.jobs.filter((j) => j.status === 'queued').length
  const running = db.jobs.filter((j) => j.status === 'running').length
  const stuck = db.jobs.filter((j) => j.status === 'running' && t - Date.parse(j.updatedAt) > LEASE_MIN * 60000).length
  let storeOk = true
  try {
    fs.accessSync(FILES, fs.constants.W_OK)
  } catch {
    storeOk = false
  }
  const checks = [
    { id: 'api', name: 'Office API', ok: true, detail: `v${VERSION}, up ${Math.round((t - started) / 60000)} min`, at: now() },
    { id: 'store', name: 'File store', ok: storeOk, detail: storeOk ? `${countFiles()} files` : 'not writable', at: now() },
    { id: 'queue', name: 'Job queue', ok: stuck === 0, detail: `${queued} queued, ${running} running${stuck ? `, ${stuck} stuck` : ''}`, at: now() },
    { id: 'worker', name: 'Revit worker', ok: workers.some((w) => w.online), detail: workers.length ? workers.map((w) => `${w.name}: ${w.online ? 'online' : 'offline'}`).join(', ') : 'none registered', at: now() },
  ]
  workers.forEach((w) => (w.checks || []).forEach((c) => checks.push({ ...c, id: `${w.id}:${c.id}`, worker: w.name })))
  return { ok: checks.every((c) => c.ok), version: VERSION, uptimeS: Math.round((t - started) / 1000), checks, workers, queue: { queued, running, stuck } }
}
function countFiles() {
  let n = 0
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : n++))
  walk(FILES)
  return n
}

// ── helpers ────────────────────────────────────────────────────────────────
const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, x-worker-key', 'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS' })
  res.end(JSON.stringify(body))
}
const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
const safe = (s) => String(s).replace(/[^A-Za-z0-9._-]/g, '_')

const routes = []
const route = (method, pattern, handler) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler })

// ── designs & jobs ─────────────────────────────────────────────────────────
route('POST', '/api/designs', async (req, res) => {
  const body = JSON.parse((await readBody(req)).toString('utf8') || '{}')
  if (!body.design || body.design.contract !== 1) return json(res, 400, { error: 'design with contract 1 required' })
  const d = { id: id('dsn'), createdAt: now(), client: body.design.client || body.client || 'Client', address: body.design.lot?.address || '', style: body.design.style?.name || '', livingSf: body.design.livingSf || null, changes: body.design.changes || [] }
  const dir = path.join(FILES, d.id)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'design.json'), JSON.stringify(body.design))
  if (body.ifc) fs.writeFileSync(path.join(dir, 'draft.ifc'), body.ifc)
  db.designs.unshift(d)
  const job = { id: id('job'), designId: d.id, status: 'queued', createdAt: now(), updatedAt: now(), attempts: 0, steps: [], outputs: [], client: d.client, address: d.address }
  db.jobs.unshift(job)
  event('design', `${d.client}: design received, job queued`, { designId: d.id, jobId: job.id })
  json(res, 201, { design: d, job })
})
route('GET', '/api/designs', (req, res) => json(res, 200, db.designs.slice(0, 100)))
route('GET', '/api/designs/:id/design.json', (req, res, p) => {
  const f = path.join(FILES, safe(p.id), 'design.json')
  if (!fs.existsSync(f)) return json(res, 404, { error: 'not found' })
  res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' })
  fs.createReadStream(f).pipe(res)
})
route('GET', '/api/jobs', (req, res) => json(res, 200, db.jobs.slice(0, 200)))
route('GET', '/api/jobs/:id', (req, res, p) => {
  const j = db.jobs.find((x) => x.id === p.id)
  j ? json(res, 200, j) : json(res, 404, { error: 'not found' })
})
route('POST', '/api/jobs/claim', async (req, res) => {
  const body = JSON.parse((await readBody(req)).toString('utf8') || '{}')
  const job = db.jobs.find((j) => j.status === 'queued')
  if (!job) return json(res, 204, {})
  job.status = 'running'
  job.worker = body.worker || 'worker'
  job.startedAt = now()
  job.updatedAt = now()
  job.attempts += 1
  job.steps = []
  event('job', `${job.client}: ${job.worker} started building`, { jobId: job.id })
  json(res, 200, { ...job, designUrl: `/api/designs/${job.designId}/design.json` })
})
route('POST', '/api/jobs/:id/progress', async (req, res, p) => {
  const job = db.jobs.find((x) => x.id === p.id)
  if (!job) return json(res, 404, { error: 'not found' })
  const body = JSON.parse((await readBody(req)).toString('utf8') || '{}')
  job.steps.push({ at: now(), step: body.step, message: body.message, pct: body.pct })
  job.updatedAt = now()
  save()
  json(res, 200, { ok: true })
})
route('POST', '/api/jobs/:id/complete', async (req, res, p) => {
  const job = db.jobs.find((x) => x.id === p.id)
  if (!job) return json(res, 404, { error: 'not found' })
  const body = JSON.parse((await readBody(req)).toString('utf8') || '{}')
  job.status = 'done'
  job.finishedAt = now()
  job.updatedAt = now()
  job.durationS = Math.round((Date.parse(job.finishedAt) - Date.parse(job.startedAt)) / 1000)
  job.outputs = body.outputs || job.outputs
  job.warnings = body.warnings || []
  job.log = (body.log || '').slice(-20000)
  event('job', `${job.client}: model built in ${job.durationS}s${job.warnings.length ? `, ${job.warnings.length} warnings` : ''}`, { jobId: job.id })
  json(res, 200, { ok: true })
})
route('POST', '/api/jobs/:id/fail', async (req, res, p) => {
  const job = db.jobs.find((x) => x.id === p.id)
  if (!job) return json(res, 404, { error: 'not found' })
  const body = JSON.parse((await readBody(req)).toString('utf8') || '{}')
  job.status = job.attempts < 2 ? 'queued' : 'failed'
  job.error = body.error || 'unknown error'
  job.log = (body.log || '').slice(-20000)
  job.updatedAt = now()
  event('error', `${job.client}: build failed (${job.error})${job.status === 'queued' ? ', retrying' : ''}`, { jobId: job.id })
  json(res, 200, { ok: true, status: job.status })
})
route('POST', '/api/jobs/:id/retry', (req, res, p) => {
  const job = db.jobs.find((x) => x.id === p.id)
  if (!job) return json(res, 404, { error: 'not found' })
  job.status = 'queued'
  job.attempts = 0
  job.error = null
  job.updatedAt = now()
  event('job', `${job.client}: retry requested from the dashboard`, { jobId: job.id })
  json(res, 200, { ok: true })
})
route('PUT', '/api/jobs/:id/files/:name', async (req, res, p) => {
  const job = db.jobs.find((x) => x.id === p.id)
  if (!job) return json(res, 404, { error: 'not found' })
  const dir = path.join(FILES, safe(job.designId))
  fs.mkdirSync(dir, { recursive: true })
  const name = safe(p.name)
  fs.writeFileSync(path.join(dir, name), await readBody(req))
  const url = `/files/${job.designId}/${name}`
  if (!job.outputs.some((o) => o.url === url)) job.outputs.push({ name, url, at: now() })
  job.updatedAt = now()
  save()
  json(res, 200, { ok: true, url })
})
route('GET', '/files/:design/:name', (req, res, p) => {
  const f = path.join(FILES, safe(p.design), safe(p.name))
  if (!fs.existsSync(f)) return json(res, 404, { error: 'not found' })
  const type = f.endsWith('.pdf') ? 'application/pdf' : f.endsWith('.json') ? 'application/json' : f.endsWith('.ifc') ? 'application/x-step' : 'application/octet-stream'
  res.writeHead(200, { 'content-type': type, 'access-control-allow-origin': '*' })
  fs.createReadStream(f).pipe(res)
})

// ── workers ────────────────────────────────────────────────────────────────
route('POST', '/api/workers/heartbeat', async (req, res) => {
  const body = JSON.parse((await readBody(req)).toString('utf8') || '{}')
  if (!body.id) return json(res, 400, { error: 'id required' })
  let w = db.workers.find((x) => x.id === body.id)
  if (!w) {
    w = { id: body.id, firstSeen: now() }
    db.workers.push(w)
    event('worker', `${body.name || body.id} connected`, { worker: body.id })
  }
  Object.assign(w, { name: body.name || w.name, host: body.host, revit: body.revit, pyrevit: body.pyrevit, template: body.template, families: body.families, disk: body.disk, cpu: body.cpu, mem: body.mem, version: body.version, checks: body.checks || w.checks || [], current: body.current || null, lastSeen: now() })
  save()
  const cmds = db.commands.filter((c) => c.worker === w.id && !c.taken)
  cmds.forEach((c) => (c.taken = now()))
  json(res, 200, { ok: true, commands: cmds.map((c) => c.command), pollS: 10 })
})
route('GET', '/api/workers', (req, res) => json(res, 200, health().workers))
route('POST', '/api/workers/:id/commands', async (req, res, p) => {
  const body = JSON.parse((await readBody(req)).toString('utf8') || '{}')
  db.commands.push({ id: id('cmd'), worker: p.id, command: body.command, at: now(), taken: null })
  event('worker', `${p.id}: command "${body.command}" queued`, { worker: p.id })
  json(res, 200, { ok: true })
})

// ── health & admin ─────────────────────────────────────────────────────────
route('GET', '/api/health', (req, res) => json(res, 200, health()))
route('GET', '/api/admin/overview', (req, res) => {
  const h = health()
  const done = db.jobs.filter((j) => j.status === 'done')
  const avg = done.length ? Math.round(done.reduce((s, j) => s + (j.durationS || 0), 0) / done.length) : null
  json(res, 200, {
    health: h,
    counts: { designs: db.designs.length, jobs: db.jobs.length, queued: h.queue.queued, running: h.queue.running, done: done.length, failed: db.jobs.filter((j) => j.status === 'failed').length, avgDurationS: avg },
    jobs: db.jobs.slice(0, 25),
    recentDurations: done.slice(0, 20).reverse().map((j) => ({ id: j.id, client: j.client, s: j.durationS })),
    events: db.events.slice(0, 40),
    designs: db.designs.slice(0, 10),
  })
})

http
  .createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') return json(res, 204, {})
      const url = new URL(req.url, 'http://x')
      for (const r of routes) {
        const m = url.pathname.match(r.re)
        if (m && r.method === req.method) return await r.handler(req, res, m.groups || {})
      }
      json(res, 404, { error: 'no route', path: url.pathname })
    } catch (e) {
      json(res, 500, { error: String(e.message || e) })
    }
  })
  .listen(PORT, () => console.log(`Draft House office API on :${PORT}, data in ${DATA}`))
