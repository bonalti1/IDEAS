// Draft House office API: accounts, saved projects, change interpreter, job queue, file store,
// worker heartbeats, drafter review, health.
// Run: node server/index.mjs
// Storage: Postgres when DATABASE_URL is set, else server/data/db.json. Files: Supabase Storage
// when SUPABASE_URL and SUPABASE_SERVICE_KEY are set, else server/data/files. See docs/DEPLOY.md.
import http from 'node:http'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { openStore } from './store/index.mjs'
import { openFiles } from './files/index.mjs'
import { makeAuth } from './auth.mjs'
import { makeAlerts } from './alerts.mjs'
import { makeBackup } from './backup.mjs'
import { makeInterpreter } from './interpreter.mjs'
import { makeUsers } from './users.mjs'
import { makeProjects } from './projects.mjs'
import { makeLots } from './lots.mjs'
import { makeBilling } from './billing.mjs'
import { regexOps } from '../src/draft/lib/ops.js'
import { kitFor } from '../src/draft/lib/layout.js'
import { STYLES } from '../src/draft/lib/styles.js'
import { buildLot } from '../src/draft/lib/lot.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = +(process.env.PORT || 8787)
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data')
const VERSION = '0.3.0'
const LEASE_MIN = 20 // a running job with no progress for this long is stuck
const WORKER_STALE_S = 90 // a worker silent for this long is offline
const MAX_BODY = 25 * 1024 * 1024
const started = Date.now()

const store = openStore({ dataDir: DATA })
const files = openFiles({ dataDir: DATA })
const auth = makeAuth()
const id = (p) => p + '_' + crypto.randomBytes(5).toString('hex')
const now = () => new Date().toISOString()
const event = (kind, message, ref = {}) => store.events.add({ id: id('ev'), at: now(), kind, message, ...ref }).catch((e) => console.error('event:', e.message))
const logInterpret = (rec) => store.interpretLog.add({ at: now(), ...rec }).catch((e) => console.error('interpret log:', e.message))
const alerts = makeAlerts({ store, event })
const backup = makeBackup({ store, files, event })
const interpreter = makeInterpreter()
const users = makeUsers({ store, dataDir: DATA })
const lots = makeLots({ store, files, interpreter, event })
const projects = makeProjects({ store, interpreter, event, logInterpret, lots })
const billing = makeBilling({ store, event })

// ── health ─────────────────────────────────────────────────────────────────
async function health() {
  const t = Date.now()
  const workers = (await store.workers.list()).map((w) => ({ ...w, online: t - Date.parse(w.lastSeen) < WORKER_STALE_S * 1000 }))
  const q = await store.jobs.stats(LEASE_MIN * 60000, t)
  const [db, fstore, bk] = await Promise.all([store.ping(), files.ping(), backup.describe()])
  const checks = [
    { id: 'api', name: 'Office API', ok: true, detail: `v${VERSION}, up ${Math.round((t - started) / 60000)} min`, at: now() },
    { id: 'db', name: 'Database', ok: db.ok, detail: db.detail, at: now() },
    { id: 'store', name: 'File store', ok: fstore.ok, detail: fstore.detail, at: now() },
    { id: 'queue', name: 'Job queue', ok: q.stuck === 0, detail: `${q.queued} queued, ${q.running} running${q.stuck ? `, ${q.stuck} stuck` : ''}`, at: now() },
    { id: 'interpreter', name: 'Change interpreter', ...interpreter.describe(), at: now() },
    { id: 'worker', name: 'Revit worker', ok: workers.some((w) => w.online), detail: workers.length ? workers.map((w) => `${w.name}: ${w.online ? 'online' : 'offline'}`).join(', ') : 'none registered', at: now() },
    { id: 'auth', name: 'API keys', ...auth.describe(), at: now() },
    { id: 'accounts', name: 'Client accounts', ...users.describe(), at: now() },
    { id: 'billing', name: 'Payments', ...billing.describe(), at: now() },
    { id: 'alerts', name: 'Alert email', ...alerts.describe(), at: now() },
    { id: 'backup', name: 'Nightly backup', ...bk, at: now() },
  ]
  workers.forEach((w) => (w.checks || []).forEach((c) => checks.push({ ...c, id: `${w.id}:${c.id}`, worker: w.name })))
  const soft = new Set(['interpreter', 'auth', 'accounts', 'alerts', 'backup', 'billing']) // shown, but they do not take the office down
  return { ok: checks.filter((c) => !soft.has(c.id)).every((c) => c.ok), version: VERSION, uptimeS: Math.round((t - started) / 1000), store: store.kind, files: files.kind, auth: users.devMode ? 'local' : 'supabase', checks, workers, queue: { queued: q.queued, running: q.running, stuck: q.stuck } }
}

// ── helpers ────────────────────────────────────────────────────────────────
const json = (res, code, body, req) => {
  res.writeHead(code, { 'content-type': 'application/json', ...auth.cors(req) })
  res.end(JSON.stringify(body))
}
const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(new Error('body too large'))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const bad = (status, message) => Object.assign(new Error(message), { status })
/**
 * The request body as a JSON object, or a 400 the client can read: "the request body is not JSON" on a
 * parse error, "a JSON object is required" for null, a list, a number or a string. With `shape`
 * ({ field: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'string?' …, a trailing ? for optional })
 * each named field is checked too, so a handler never dereferences a body it did not get.
 */
const readJson = async (req, shape = null) => {
  const raw = (await readBody(req)).toString('utf8')
  let body
  try {
    body = raw.trim() ? JSON.parse(raw) : {}
  } catch {
    throw bad(400, 'the request body is not JSON')
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad(400, 'a JSON object is required')
  if (shape) need(body, shape)
  return body
}
const TYPE = { string: (v) => typeof v === 'string', number: (v) => typeof v === 'number' && Number.isFinite(v), boolean: (v) => typeof v === 'boolean', array: (v) => Array.isArray(v), object: (v) => !!v && typeof v === 'object' && !Array.isArray(v) }
/** Checks a body's fields against a shape (see readJson); throws a 400 that names the first field that is wrong. */
function need(body, shape) {
  for (const [field, spec] of Object.entries(shape)) {
    const optional = spec.endsWith('?')
    const type = spec.replace(/\?$/, '')
    const v = body[field]
    if (v === undefined || v === null) {
      if (optional) continue
      throw bad(400, `${field} is required`)
    }
    if (!TYPE[type](v)) throw bad(400, `${field} must be ${type === 'array' ? 'a list' : type === 'object' ? 'an object' : `a ${type}`}`)
    if (type === 'array' && field === 'rooms' && v.some((r) => !r || typeof r !== 'object')) throw bad(400, 'rooms must be a list of rooms')
    if (type === 'object' && Object.keys(v).some((k) => BAD_KEYS.has(k))) throw bad(400, `${field} has a key that is not allowed`)
  }
  if (Object.keys(body).some((k) => BAD_KEYS.has(k))) throw bad(400, 'a key in the body is not allowed')
}
const safe = (s) => String(s).replace(/[^A-Za-z0-9._-]/g, '_')
const typeOf = (name) => (name.endsWith('.pdf') ? 'application/pdf' : name.endsWith('.json') ? 'application/json' : name.endsWith('.ifc') ? 'application/x-step' : name.endsWith('.rvt') ? 'application/vnd.autodesk.revit' : 'application/octet-stream')
const sendFile = async (req, res, design, name) => {
  const f = await files.get(design, name)
  if (!f) return json(res, 404, { error: 'not found' }, req)
  res.writeHead(200, { 'content-type': typeOf(name), ...(f.size ? { 'content-length': f.size } : {}), ...auth.cors(req) })
  if (typeof f.body.pipe === 'function') f.body.pipe(res)
  else {
    for await (const chunk of f.body) res.write(chunk)
    res.end()
  }
}

// need: 'public' (anyone) | 'any' (either key) | 'app' | 'worker' | 'user' (app key + signed-in user) | 'drafter' (user with the drafter or admin role)
const routes = []
const route = (method, pattern, need, handler) => routes.push({ method, need, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler })

// a design document and its draft IFC go to the file store; a queued job is created on approval
async function saveDesign(design, ifc, extra = {}) {
  const d = { id: id('dsn'), createdAt: now(), client: design.client || 'Client', address: design.lot?.address || '', style: design.style?.name || '', livingSf: design.livingSf || null, changes: design.changes || [], ...extra }
  await files.put(d.id, 'design.json', Buffer.from(JSON.stringify(design)), 'application/json')
  if (ifc) await files.put(d.id, 'draft.ifc', Buffer.from(ifc), 'application/x-step')
  await store.designs.add(d)
  return d
}
async function queueJob(designId, extra = {}) {
  const d = await store.designs.get(designId)
  if (!d) throw Object.assign(new Error('design not found'), { status: 404 })
  const job = { id: id('job'), designId, status: 'queued', createdAt: now(), updatedAt: now(), attempts: 0, steps: [], outputs: [], client: d.client, address: d.address, ...extra }
  await store.jobs.add(job)
  await event('design', `${d.client}: job queued for the office computer`, { designId, jobId: job.id })
  return job
}

// ── accounts & projects ────────────────────────────────────────────────────
route('POST', '/api/auth/dev-login', 'app', async (req, res) => {
  if (!users.devMode) return json(res, 404, { error: 'local sign-in is off; sign in through Supabase' }, req)
  try {
    json(res, 200, await users.devLogin(await readJson(req, { email: 'string', name: 'string?' })), req)
  } catch (e) {
    json(res, 400, { error: e.message }, req)
  }
})
route('GET', '/api/me', 'user', async (req, res, p, ctx) => json(res, 200, { user: ctx.user, credits: ctx.user.credits || 0, freeCredits: users.freeCredits, auth: users.devMode ? 'local' : 'supabase' }, req))
route('GET', '/api/projects', 'user', async (req, res, p, ctx) => json(res, 200, (await store.projects.listForUser(ctx.user.id)).map(projects.ownerView), req))
route('POST', '/api/projects', 'user', async (req, res, p, ctx) => json(res, 201, await projects.create(ctx.user, await readJson(req, { rooms: 'array', style: 'object', program: 'object', lot: 'object?', client: 'string?' })), req))
route('GET', '/api/projects/:id', 'user', async (req, res, p, ctx) => json(res, 200, await projects.detail(await projects.load(ctx.user, p.id, { drafter: users.isDrafter(ctx.user) }), { drafter: users.isDrafter(ctx.user) }), req))
route('PUT', '/api/projects/:id', 'user', async (req, res, p, ctx) => json(res, 200, await projects.update(await projects.load(ctx.user, p.id), await readJson(req, { rooms: 'array?', program: 'object?', lot: 'object?', client: 'string?', note: 'string?' })), req))
route('POST', '/api/projects/:id/change', 'user', async (req, res, p, ctx) => {
  const body = await readJson(req, { text: 'string', ops: 'array?' })
  json(res, 200, await projects.change(await projects.load(ctx.user, p.id), body.text, body.ops), req)
})
route('POST', '/api/projects/:id/rollback', 'user', async (req, res, p, ctx) => json(res, 200, await projects.rollback(await projects.load(ctx.user, p.id), (await readJson(req, { version: 'number' })).version), req))
route('POST', '/api/projects/:id/send', 'user', async (req, res, p, ctx) => json(res, 200, await projects.send(await projects.load(ctx.user, p.id), await readJson(req, { design: 'object', ifc: 'string?' }), saveDesign), req))

// ── lots: city rules, plat reading, flood zone ─────────────────────────────
route('GET', '/api/cities', 'app', async (req, res) => json(res, 200, await lots.table(), req))
route('PUT', '/api/admin/cities/:id', 'drafter', async (req, res, p, ctx) => json(res, 200, await lots.setCity(p.id, await readJson(req, {}), ctx.user), req))
route('POST', '/api/lot/plat', 'app', async (req, res) => json(res, 200, await lots.readPlat(await readJson(req, { name: 'string?', data: 'string' })), req))
route('GET', '/api/lot/plat/:id', 'any', async (req, res, p) => {
  const rec = await lots.plat(safe(p.id))
  const ext = rec?.ext || 'pdf'
  const f = await files.get('plats', `${safe(p.id)}.${ext}`)
  if (!f) return json(res, 404, { error: 'not found' }, req)
  res.writeHead(200, { 'content-type': ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : 'image/jpeg', ...auth.cors(req) })
  if (typeof f.body.pipe === 'function') f.body.pipe(res)
  else {
    for await (const chunk of f.body) res.write(chunk)
    res.end()
  }
})
route('GET', '/api/lot/geocode', 'app', async (req, res) => {
  const url = new URL(req.url, 'http://x')
  json(res, 200, await lots.geocode(url.searchParams.get('address')), req)
})
route('GET', '/api/lot/flood', 'app', async (req, res) => {
  const url = new URL(req.url, 'http://x')
  json(res, 200, await lots.flood(url.searchParams.get('address')), req)
})

// ── billing: pricing, Stripe Checkout, the webhook, receipts ───────────────
route('GET', '/api/billing', 'user', async (req, res, p, ctx) => json(res, 200, { credits: ctx.user.credits || 0, pricing: await billing.pricing(), mode: billing.mode, history: await billing.history(ctx.user) }, req))
route('POST', '/api/billing/checkout', 'user', async (req, res, p, ctx) => {
  const body = await readJson(req, { pack: 'string' })
  json(res, 200, await billing.checkout(ctx.user, body.pack, req.headers.origin || ''), req)
})
route('GET', '/api/billing/session/:id', 'user', async (req, res, p, ctx) => json(res, 200, await billing.session(ctx.user, p.id), req))
// Stripe posts here; the signature in the header is the authentication
route('POST', '/api/billing/webhook', 'public', async (req, res) => {
  const raw = await readBody(req)
  json(res, 200, await billing.webhook(raw, req.headers['stripe-signature'] || ''), req)
})
route('PUT', '/api/admin/pricing', 'drafter', async (req, res, p, ctx) => {
  if (ctx.user.role !== 'admin') return json(res, 403, { error: 'only an admin changes prices' }, req)
  json(res, 200, await billing.setPricing(await readJson(req, {}), ctx.user), req)
})
route('GET', '/api/admin/pricing', 'drafter', async (req, res) => json(res, 200, await billing.pricing(), req))
route('GET', '/api/admin/payments', 'drafter', async (req, res) => json(res, 200, await store.payments.list(100), req))
route('POST', '/api/admin/users/:id/credits', 'drafter', async (req, res, p, ctx) => {
  if (ctx.user.role !== 'admin') return json(res, 403, { error: 'only an admin grants credits' }, req)
  const body = await readJson(req, { credits: 'number', note: 'string?' })
  json(res, 200, await billing.grant(ctx.user, p.id, body.credits, body.note), req)
})

// ── drafter review ─────────────────────────────────────────────────────────
route('GET', '/api/review', 'drafter', async (req, res) => json(res, 200, await projects.inbox(), req))
route('GET', '/api/review/:id', 'drafter', async (req, res, p, ctx) => json(res, 200, await projects.detail(await projects.load(ctx.user, p.id, { drafter: true }), { drafter: true }), req))
route('POST', '/api/review/:id', 'drafter', async (req, res, p, ctx) => json(res, 200, await projects.review(await projects.load(ctx.user, p.id, { drafter: true }), ctx.user, await readJson(req, { decision: 'string', note: 'string?' }), queueJob), req))
route('POST', '/api/review/:id/lot', 'drafter', async (req, res, p, ctx) => json(res, 200, await projects.confirmLot(await projects.load(ctx.user, p.id, { drafter: true }), ctx.user, await readJson(req, { confirmed: 'boolean?', lot: 'object?', note: 'string?' })), req))
route('GET', '/api/admin/users', 'drafter', async (req, res) => json(res, 200, await store.users.list(), req))
route('POST', '/api/admin/users/:id/role', 'drafter', async (req, res, p, ctx) => {
  if (ctx.user.role !== 'admin') return json(res, 403, { error: 'only an admin changes roles' }, req)
  const u = await store.users.get(p.id)
  if (!u) return json(res, 404, { error: 'not found' }, req)
  const { role } = await readJson(req, { role: 'string' })
  if (!['client', 'drafter', 'admin'].includes(role)) return json(res, 400, { error: 'role must be client, drafter or admin' }, req)
  u.role = role
  await store.users.put(u)
  await event('worker', `${ctx.user.email} made ${u.email} a ${role}`)
  json(res, 200, u, req)
})

// ── designs & jobs ─────────────────────────────────────────────────────────
// direct design intake without an account (tests, scripts, the app when the client skipped sign-in): queued at once
route('POST', '/api/designs', 'app', async (req, res) => {
  const body = await readJson(req, { design: 'object', ifc: 'string?', client: 'string?' })
  if (!body.design || body.design.contract !== 1) return json(res, 400, { error: 'design with contract 1 required' }, req)
  const d = await saveDesign({ ...body.design, client: body.design.client || body.client }, body.ifc)
  const job = await queueJob(d.id)
  json(res, 201, { design: d, job }, req)
})
route('GET', '/api/designs', 'drafter', async (req, res) => json(res, 200, await store.designs.list(100), req))
route('GET', '/api/designs/:id/design.json', 'any', (req, res, p) => sendFile(req, res, p.id, 'design.json'))
route('GET', '/api/jobs', 'drafter', async (req, res) => json(res, 200, await store.jobs.list(200), req))
route('GET', '/api/jobs/:id', 'any', async (req, res, p) => {
  const j = await store.jobs.get(p.id)
  j ? json(res, 200, j, req) : json(res, 404, { error: 'not found' }, req)
})
route('POST', '/api/jobs/claim', 'worker', async (req, res) => {
  const body = await readJson(req, { worker: 'string?' })
  const job = await store.jobs.claim(body.worker || 'worker', now())
  if (!job) return json(res, 204, {}, req)
  await event('job', `${job.client}: ${job.worker} started building`, { jobId: job.id })
  json(res, 200, { ...job, designUrl: `/api/designs/${job.designId}/design.json` }, req)
})
route('POST', '/api/jobs/:id/progress', 'worker', async (req, res, p) => {
  const job = await store.jobs.get(p.id)
  if (!job) return json(res, 404, { error: 'not found' }, req)
  const body = await readJson(req, { step: 'string?', message: 'string?', pct: 'number?' })
  job.steps.push({ at: now(), step: body.step, message: body.message, pct: body.pct })
  job.updatedAt = now()
  await store.jobs.put(job)
  json(res, 200, { ok: true }, req)
})
route('POST', '/api/jobs/:id/complete', 'worker', async (req, res, p) => {
  const job = await store.jobs.get(p.id)
  if (!job) return json(res, 404, { error: 'not found' }, req)
  const body = await readJson(req, { outputs: 'array?', warnings: 'array?', fallbacks: 'array?', log: 'string?' })
  job.status = 'done'
  job.finishedAt = now()
  job.updatedAt = now()
  job.durationS = Math.round((Date.parse(job.finishedAt) - Date.parse(job.startedAt || job.updatedAt)) / 1000)
  job.outputs = body.outputs || job.outputs
  job.warnings = body.warnings || []
  job.fallbacks = body.fallbacks || []
  job.log = (body.log || '').slice(-20000)
  await store.jobs.put(job)
  await event('job', `${job.client}: model built in ${job.durationS}s${job.warnings.length ? `, ${job.warnings.length} warnings` : ''}${job.fallbacks.length ? `, ${job.fallbacks.length} name fallbacks` : ''}`, { jobId: job.id })
  await projects.built(job.id)
  json(res, 200, { ok: true }, req)
})
route('POST', '/api/jobs/:id/fail', 'worker', async (req, res, p) => {
  const job = await store.jobs.get(p.id)
  if (!job) return json(res, 404, { error: 'not found' }, req)
  const body = await readJson(req, { error: 'string?', log: 'string?' })
  job.status = job.attempts < 2 ? 'queued' : 'failed'
  job.error = body.error || 'unknown error'
  job.log = (body.log || '').slice(-20000)
  job.updatedAt = now()
  await store.jobs.put(job)
  await event('error', `${job.client}: build failed (${job.error})${job.status === 'queued' ? ', retrying' : ''}`, { jobId: job.id })
  json(res, 200, { ok: true, status: job.status }, req)
})
route('POST', '/api/jobs/:id/retry', 'drafter', async (req, res, p) => {
  const job = await store.jobs.get(p.id)
  if (!job) return json(res, 404, { error: 'not found' }, req)
  job.status = 'queued'
  job.attempts = 0
  job.error = null
  job.updatedAt = now()
  await store.jobs.put(job)
  await event('job', `${job.client}: retry requested from the dashboard`, { jobId: job.id })
  json(res, 200, { ok: true }, req)
})
route('PUT', '/api/jobs/:id/files/:name', 'worker', async (req, res, p) => {
  const job = await store.jobs.get(p.id)
  if (!job) return json(res, 404, { error: 'not found' }, req)
  const name = safe(p.name)
  const url = await files.put(job.designId, name, await readBody(req), typeOf(name))
  if (!job.outputs.some((o) => o.url === url)) job.outputs.push({ name, url, at: now() })
  job.updatedAt = now()
  await store.jobs.put(job)
  json(res, 200, { ok: true, url }, req)
})
route('GET', '/files/:design/:name', 'any', (req, res, p) => sendFile(req, res, p.design, p.name))

// ── workers ────────────────────────────────────────────────────────────────
route('POST', '/api/workers/heartbeat', 'worker', async (req, res) => {
  const body = await readJson(req, { id: 'string', name: 'string?', checks: 'array?' })
  if (!body.id) return json(res, 400, { error: 'id required' }, req)
  let w = await store.workers.get(body.id)
  if (!w) {
    w = { id: body.id, firstSeen: now() }
    await event('worker', `${body.name || body.id} connected`, { worker: body.id })
  }
  Object.assign(w, { name: body.name || w.name, host: body.host, revit: body.revit, pyrevit: body.pyrevit, template: body.template, families: body.families, disk: body.disk, cpu: body.cpu, mem: body.mem, version: body.version, checks: body.checks || w.checks || [], current: body.current || null, lastSeen: now() })
  await store.workers.put(w)
  const commands = await store.commands.take(w.id, now())
  json(res, 200, { ok: true, commands, pollS: 10 }, req)
})
route('GET', '/api/workers', 'drafter', async (req, res) => json(res, 200, (await health()).workers, req))
route('POST', '/api/workers/:id/commands', 'drafter', async (req, res, p) => {
  const body = await readJson(req, { command: 'string' })
  await store.commands.add({ id: id('cmd'), worker: p.id, command: body.command, at: now(), taken: null })
  await event('worker', `${p.id}: command "${body.command}" queued`, { worker: p.id })
  json(res, 200, { ok: true }, req)
})

// ── change interpreter for the no-account path (the app decides and keeps credits locally) ──
route('POST', '/api/interpret', 'app', async (req, res) => {
  const body = await readJson(req, { text: 'string', rooms: 'array', program: 'object?', kit: 'object?', lot: 'object?', client: 'string?' })
  const input = { request: String(body.text).slice(0, 500), program: body.program, kit: body.kit, rooms: body.rooms }
  try {
    const out = await interpreter.ask(input)
    logInterpret({ request: input.request, client: body.client || null, rooms: body.rooms.length, diff: { ops: out.ops, reply: out.reply, confidence: out.confidence }, verdict: out.confidence < 0.5 || !out.ops.length ? 'unsure' : 'diff', ms: out.ms, usage: out.usage, cost: out.cost, model: out.model })
    await event('interpret', `"${input.request.slice(0, 60)}" → ${out.ops.length} op${out.ops.length === 1 ? '' : 's'}, ${out.ms} ms, $${out.cost.toFixed(4)}`)
    json(res, 200, out, req)
  } catch (e) {
    if (!e.unconfigured) {
      logInterpret({ request: input.request, client: body.client || null, verdict: e.timeout ? 'timeout' : e.refusal ? 'refusal' : e.noDiff ? 'no-diff' : 'error', error: String(e.message).slice(0, 200), ms: e.ms, usage: e.usage, cost: e.cost, model: interpreter.model })
      await event('error', `interpreter: ${e.timeout ? `no answer in ${interpreter.timeoutMs} ms` : e.message}`)
    }
    // no key, a timeout, a refusal: the basic rules answer, with 200, so a chat message is never an error
    const kit = kitFor(STYLES.find((st) => st.id === body.kit?.id) || STYLES.find((st) => st.ready))
    let lot
    try {
      lot = body.lot?.spec ? buildLot(body.lot.spec, await lots.table()) : undefined
    } catch {
      lot = undefined
    }
    const out = regexOps(input.request, body.rooms, kit, lot)
    json(res, 200, { ...out, source: e.timeout ? 'timeout' : 'fallback', reason: e.unconfigured ? 'not configured' : e.timeout ? 'timeout' : String(e.message || e).slice(0, 120), ms: e.ms }, req)
  }
})
route('POST', '/api/interpret/verdict', 'app', async (req, res) => {
  const body = await readJson(req, { text: 'string?', source: 'string?', reasons: 'array?', ops: 'array?', reply: 'string?', client: 'string?' })
  await logInterpret({ request: String(body.text || '').slice(0, 500), client: body.client || null, source: body.source, verdict: body.applied ? 'applied' : 'rejected', reasons: body.reasons || [], reply: body.reply, ops: body.ops })
  json(res, 200, { ok: true }, req)
})
route('GET', '/api/interpret/log', 'drafter', async (req, res) => {
  const [summary, recent] = await Promise.all([store.interpretLog.summary(), store.interpretLog.recent(50)])
  json(res, 200, { ...summary, recent }, req)
})

// ── health & admin ─────────────────────────────────────────────────────────
route('GET', '/api/health', 'public', async (req, res, p, ctx) => {
  const h = await health()
  // without a key (the hosting health probe, anyone on the internet) only the verdict is shown
  if (!ctx.role) return json(res, 200, { ok: h.ok, version: h.version, uptimeS: h.uptimeS, auth: h.auth }, req)
  json(res, 200, h, req)
})
route('GET', '/api/admin/overview', 'drafter', async (req, res) => {
  const [h, q, jobs, events, designs, designCount, projectCount, inbox] = await Promise.all([health(), store.jobs.stats(LEASE_MIN * 60000, Date.now()), store.jobs.list(25), store.events.list(40), store.designs.list(10), store.designs.count(), store.projects.count(), projects.inbox()])
  json(res, 200, {
    health: h,
    counts: { designs: designCount, projects: projectCount, waitingReview: inbox.waiting.length, jobs: q.total, queued: q.queued, running: q.running, done: q.done, failed: q.failed, avgDurationS: q.avgDurationS },
    jobs,
    recentDurations: q.recentDone,
    events,
    designs,
  }, req)
})
route('POST', '/api/admin/backup', 'drafter', async (req, res) => json(res, 200, await backup.run('dashboard'), req))

// ── server ─────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') return json(res, 204, {}, req)
    const url = new URL(req.url, 'http://x')
    for (const r of routes) {
      const m = url.pathname.match(r.re)
      if (!m || r.method !== req.method) continue
      const role = auth.role(req, url)
      const wantsUser = r.need === 'user' || r.need === 'drafter'
      if (!auth.allows(wantsUser ? 'app' : r.need, role)) return json(res, role ? 403 : 401, { error: role ? `this key may not ${req.method} ${url.pathname}` : 'API key required (x-api-key)' }, req)
      const ctx = { role: role === 'open' ? 'app' : role, user: null }
      if (wantsUser) {
        ctx.user = await users.fromRequest(req)
        if (!ctx.user) return json(res, 401, { error: 'sign in first', signIn: true }, req)
        if (r.need === 'drafter' && !users.isDrafter(ctx.user)) return json(res, 403, { error: 'drafters only' }, req)
      }
      return await r.handler(req, res, m.groups || {}, ctx)
    }
    json(res, 404, { error: 'no route', path: url.pathname }, req)
  } catch (e) {
    const status = e.status || (e.message === 'body too large' ? 413 : 500)
    // an error with no status of its own is the office's fault: the detail goes to the log, the client gets a
    // plain line. A 503 the code meant for the client ("payments are not set up yet") keeps its words
    const unexpected = !e.status && status >= 500
    if (status >= 500) console.error(`[api] ${req.method} ${req.url} → ${status}:`, e?.stack || e)
    const error = unexpected ? 'Something went wrong on our side; the office has the detail. Try again in a moment.' : String(e.message || e)
    json(res, status, { error, ...(e.credits !== undefined ? { credits: e.credits } : {}), ...(e.lotPending ? { lotPending: true } : {}), ...(e.rules ? { rules: e.rules } : {}) }, req)
  }
})

async function main() {
  await store.init()
  await files.init()
  server.listen(PORT, () => {
    console.log(`Draft House office API v${VERSION} on :${PORT}; store ${store.kind} (${store.detail}); files ${files.kind} (${files.detail})`)
    console.log(`auth: ${auth.describe().detail}`)
    console.log(`accounts: ${users.describe().detail}`)
    console.log(interpreter.configured ? `interpreter: key from ${interpreter.keyVar} (${interpreter.keyLength} chars), model ${interpreter.model}` : 'interpreter: no DRAFTHOUSE_CLAUDE_KEY or ANTHROPIC_API_KEY, clients get the basic rules')
    console.log(`alerts: ${alerts.describe().detail}`)
    interpreter.probe()
    alerts.start()
    backup.start()
  })
}
const shutdown = async (sig) => {
  console.log(`${sig}: closing`)
  server.close()
  alerts.stop()
  backup.stop()
  await store.close().catch(() => {})
  process.exit(0)
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
main().catch((e) => {
  console.error(`could not start: ${e.message}`)
  process.exit(1)
})
