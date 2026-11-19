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
import { makeParcels } from './parcels.mjs'
import { countyFromKey } from './parcel-sources.mjs'
import { makeZoning } from './zoning.mjs'
import { makeWind } from './wind.mjs'
import { fixtureMode, fixtureFetch, guardNetwork } from './fixtures.mjs'
import { clientIp, makeWindow } from './net.mjs'
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
// parcel, flood and zoning services answer from recorded fixtures with DRAFTHOUSE_FIXTURES=1 (CI, screenshots); never the internet
// In fixture mode nothing may reach a real host (round 10, item 2): the global fetch throws on one unless LIVE=1.
if (fixtureMode()) guardNetwork()
const fetchImpl = fixtureMode() ? fixtureFetch() : globalThis.fetch
const lots = makeLots({ store, files, interpreter, event, fetchImpl })
const parcels = makeParcels({ store, event, fetchImpl, geocode: (a) => lots.geocode(a) })
const zoning = makeZoning({ store, fetchImpl })
const wind = makeWind({ store, fetchImpl })
const projects = makeProjects({ store, interpreter, event, logInterpret, lots, alerts })
// Payments are dormant (round 8, P0b): the client app never talks about money and plan changes are free,
// granted by the office. BILLING_ENABLED=1 registers the Stripe routes again; off, they do not exist (404).
const BILLING_ENABLED = /^(1|true|yes)$/i.test(String(process.env.BILLING_ENABLED || ''))
const billing = BILLING_ENABLED ? makeBilling({ store, event }) : null
// an account record as a homeowner may see it: no balance, no money
const safeUser = (u) => (u ? (({ credits, ...keep }) => keep)(u) : u)

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
    ...(billing ? [{ id: 'billing', name: 'Payments', ...billing.describe(), at: now() }] : []),
    { id: 'alerts', name: 'Alert email', ...alerts.describe(), at: now() },
    { id: 'parcels', name: 'Parcel sources', ...parcels.describe(), at: now() },
    { id: 'wind', name: 'Design wind speed', ...wind.describe(), at: now() },
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
    const r = await users.devLogin(await readJson(req, { email: 'string', name: 'string?' }))
    json(res, 200, { ...r, user: safeUser(r.user) }, req)
  } catch (e) {
    json(res, 400, { error: e.message }, req)
  }
})
route('GET', '/api/me', 'user', async (req, res, p, ctx) => json(res, 200, { user: safeUser(ctx.user), auth: users.devMode ? 'local' : 'supabase' }, req))
route('GET', '/api/projects', 'user', async (req, res, p, ctx) => json(res, 200, await projects.list(ctx.user), req))
route('POST', '/api/projects', 'user', async (req, res, p, ctx) => {
  const body = await readJson(req, { rooms: 'array', style: 'object', program: 'object', lot: 'object?', client: 'string?' })
  // the drafter's marks on a lot (confirmed, a confirmed zoning) never come from a browser (round 10)
  if (body.lot) body.lot = projects.ownerLot(body.lot, null)
  json(res, 201, await projects.create(ctx.user, body), req)
})
route('GET', '/api/projects/:id', 'user', async (req, res, p, ctx) => json(res, 200, await projects.detail(await projects.load(ctx.user, p.id, { drafter: users.isDrafter(ctx.user) }), { drafter: users.isDrafter(ctx.user) }), req))
route('PUT', '/api/projects/:id', 'user', async (req, res, p, ctx) => {
  const prj = await projects.load(ctx.user, p.id)
  const body = await readJson(req, { rooms: 'array?', program: 'object?', lot: 'object?', client: 'string?', note: 'string?' })
  if (body.lot) body.lot = projects.ownerLot(body.lot, prj.lot)
  json(res, 200, await projects.update(prj, body), req)
})
route('POST', '/api/projects/:id/change', 'user', async (req, res, p, ctx) => {
  const body = await readJson(req, { text: 'string', ops: 'array?' })
  json(res, 200, await projects.change(await projects.load(ctx.user, p.id), body.text, body.ops), req)
})
route('POST', '/api/projects/:id/rollback', 'user', async (req, res, p, ctx) => json(res, 200, await projects.rollback(await projects.load(ctx.user, p.id), (await readJson(req, { version: 'number' })).version), req))
route('POST', '/api/projects/:id/send', 'user', async (req, res, p, ctx) => json(res, 200, await projects.send(await projects.load(ctx.user, p.id), await readJson(req, { design: 'object?', ifc: 'string?' }), saveDesign), req))
// the homeowner asks the office for a meeting (cost is covered there), or for more changes (round 8, M4/M8)
route('POST', '/api/projects/:id/meeting-request', 'user', async (req, res, p, ctx) => json(res, 200, await projects.requestMeeting(await projects.load(ctx.user, p.id), await readJson(req, { note: 'string?', kind: 'string?' })), req))
// round 7, item 8: a lot zoned for something other than a house blocks Send; the client asks the office to call
route('POST', '/api/projects/:id/call-me', 'user', async (req, res, p, ctx) => {
  const prj = await projects.load(ctx.user, p.id)
  const body = await readJson(req, { note: 'string?' })
  const note = String(body?.note || '').slice(0, 300)
  await event('request', `${prj.client}: asked the office to call about the lot${note ? ` (${note})` : ''}`, { projectId: prj.id, request: 'call-me' })
  if (alerts.configured) await alerts.email(`Draft House: ${prj.client} asked for a call`, `${prj.client} (${ctx.user.email}) asked the office to call about ${prj.address || 'their lot'}.\n${note}\nProject ${prj.id}.`)
  json(res, 200, { ok: true, message: 'The office will call you.' }, req)
})

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
// The geocode, flood, zoning and wind routes need a signed-in user and are rate-limited like the parcel routes
// (round 10, item 9): anonymous and unlimited, they were an open proxy onto the Census, FEMA and the small city
// zoning servers. An answer from the cache costs nothing.
route('GET', '/api/lot/geocode', 'user', async (req, res, p, ctx) => {
  const url = new URL(req.url, 'http://x')
  const keys = limited('geocode', req, res, ctx)
  if (!keys) return
  const rec = await lots.geocode(url.searchParams.get('address'))
  if (!rec.cached) keys.forEach(countLookup)
  json(res, 200, rec, req)
})
route('GET', '/api/lot/flood', 'user', async (req, res, p, ctx) => {
  const url = new URL(req.url, 'http://x')
  const lat = url.searchParams.get('lat')
  const lon = url.searchParams.get('lon')
  const keys = limited('flood', req, res, ctx)
  if (!keys) return
  const rec = lat != null && lon != null ? await lots.floodAt({ lat: +lat, lon: +lon, address: url.searchParams.get('address') || null }) : await lots.flood(url.searchParams.get('address'))
  if (!rec.cached) keys.forEach(countLookup)
  json(res, 200, rec, req)
})
// ── parcels, zoning, the sourced rules table, the sources health page (round 7) ──
// Owner names and mailing addresses are drafter-only: everyone else gets the parcel without them.
const parcelView = (rec, ctx) => {
  if (!rec || users.isDrafter(ctx.user)) return rec
  const { owner, mailing, attributes, ...keep } = rec
  return { ...keep, candidates: rec.candidates?.map(({ owner: o, mailing: m, ...c }) => c) }
}
// The parcel routes need a signed-in user and are rate-limited per user and per address (round 9, item 8): the office
// server must not be an open proxy onto the county layers. 20 lookups that reach a county per 10 minutes; cache hits
// are free. 429 with a plain line past that.
const LOOKUPS_PER_WINDOW = +(process.env.PARCEL_LOOKUPS_PER_10MIN || 20) // per user, per kind of lookup
const LOOKUPS_PER_IP = LOOKUPS_PER_WINDOW * 3 // an office or a family behind one address
const lookups = makeWindow({ windowMs: 600000, limitFor: (key) => (key.includes(':ip:') ? LOOKUPS_PER_IP : LOOKUPS_PER_WINDOW) })
const lookupsLeft = (key) => lookups.left(key)
const countLookup = (key) => lookups.count(key)
// a key whose window is empty is dropped when it is next read, and every ten minutes for the ones nobody reads again (round 10, item 10)
setInterval(() => lookups.prune(), 600000).unref()
// x-forwarded-for is trusted only behind a known proxy: TRUST_PROXY_HOPS is how many sit in front (1 on Render); unset, the socket's address
const TRUST_PROXY_HOPS = Math.max(0, Math.floor(+(process.env.TRUST_PROXY_HOPS || 0)) || 0)
const lookupKeys = (req, ctx, kind = 'parcel') => [`${kind}:u:${ctx.user?.id || 'anon'}`, `${kind}:ip:${clientIp(req, TRUST_PROXY_HOPS)}`]
const LOOKUP_LIMIT_MESSAGE = 'Too many lot lookups for now. Try again in ten minutes, or type the lot in; the drafter can pull the parcel later.'
/** The limiter for one kind of lookup: the keys to count on a real lookup, or null after a 429 was sent. */
function limited(kind, req, res, ctx) {
  const keys = lookupKeys(req, ctx, kind)
  if (keys.some((k) => lookupsLeft(k) <= 0)) {
    json(res, 429, { error: LOOKUP_LIMIT_MESSAGE, retryAfterS: 600 }, req)
    return null
  }
  return keys
}
route('GET', '/api/lot/parcel', 'user', async (req, res, p, ctx) => {
  const url = new URL(req.url, 'http://x')
  const address = url.searchParams.get('address')
  const lat = url.searchParams.get('lat')
  const lon = url.searchParams.get('lon')
  if (address && address.length > 200) return json(res, 400, { error: 'the address is too long (200 characters at most)' }, req)
  const keys = lookupKeys(req, ctx)
  if (keys.some((k) => lookupsLeft(k) <= 0)) return json(res, 429, { error: LOOKUP_LIMIT_MESSAGE, retryAfterS: 600 }, req)
  // confirmed=1: the homeowner said the address the geocoder found is theirs (round 10, item 3)
  const rec = await parcels.lookup({ address, lat: lat != null ? +lat : undefined, lon: lon != null ? +lon : undefined, force: url.searchParams.get('force') === '1' && users.isDrafter(ctx.user), confirmed: url.searchParams.get('confirmed') === '1' })
  if (!rec.cached && rec.match !== 'confirm-address') keys.forEach(countLookup)
  json(res, 200, parcelView(rec, ctx), req)
})
// :county is the county's name or its slug ("Hidalgo County", "hidalgo", "hidalgo-county"); :propId the appraisal district's id
route('GET', '/api/lot/parcel/:county/:propId', 'user', async (req, res, p, ctx) => {
  const county = countyFromKey(decodeURIComponent(p.county))
  if (!county) return json(res, 404, { error: `no parcel source for "${decodeURIComponent(p.county)}"; use the county name or its slug (hidalgo, cameron, nueces, starr, willacy, jimwells, kleberg, sanpatricio)` }, req)
  const keys = lookupKeys(req, ctx)
  if (keys.some((k) => lookupsLeft(k) <= 0)) return json(res, 429, { error: LOOKUP_LIMIT_MESSAGE, retryAfterS: 600 }, req)
  keys.forEach(countLookup)
  json(res, 200, parcelView(await parcels.byId({ county, propId: safe(p.propId) }), ctx), req)
})
route('GET', '/api/lot/zoning', 'user', async (req, res, p, ctx) => {
  const url = new URL(req.url, 'http://x')
  const keys = limited('zoning', req, res, ctx)
  if (!keys) return
  const rec = await zoning.lookup({ cityId: safe(url.searchParams.get('city') || ''), lat: url.searchParams.get('lat'), lon: url.searchParams.get('lon') })
  if (!rec.cached && rec.status !== 'unknown') keys.forEach(countLookup)
  json(res, 200, rec, req)
})
route('GET', '/api/lot/wind', 'user', async (req, res, p, ctx) => {
  const url = new URL(req.url, 'http://x')
  const keys = limited('wind', req, res, ctx)
  if (!keys) return
  const table = await lots.jurisdictions()
  const rec = await wind.lookup({ lat: url.searchParams.get('lat'), lon: url.searchParams.get('lon'), row: table[safe(url.searchParams.get('city') || '')] || null })
  // only a call that reached the ASCE service counts
  if (!rec.cached && /ASCE Hazard API/.test(rec.source || '')) keys.forEach(countLookup)
  json(res, 200, rec, req)
})
route('GET', '/api/jurisdictions', 'app', async (req, res) => json(res, 200, await lots.jurisdictions(), req))
route('PUT', '/api/admin/jurisdictions/:id', 'drafter', async (req, res, p, ctx) => {
  await lots.setCity(safe(p.id), await readJson(req, { source: 'string?', verified: 'boolean?', flags: 'array?', note: 'string?', zoning: 'string?' }), ctx.user)
  json(res, 200, (await lots.jurisdictions())[safe(p.id)], req)
})
route('GET', '/api/admin/sources', 'drafter', async (req, res) => json(res, 200, { ...(await parcels.health()), zoning: Object.entries(zoning.layers).map(([cityId, L]) => ({ cityId, url: L.url, field: L.field })), fixtures: fixtureMode() }, req))
// the mapped columns against each layer's own field list (round 10, item 5): run at start, daily, and on demand here
route('POST', '/api/admin/sources/fields', 'drafter', async (req, res) => json(res, 200, await parcels.checkFields(), req))
route('POST', '/api/admin/sources/check', 'drafter', async (req, res) => json(res, 200, await parcels.dailyCheck({ email: alerts.email ? (subject, text) => alerts.email(subject, text) : null }), req))

// ── billing: pricing, Stripe Checkout, the webhook, receipts (only with BILLING_ENABLED=1) ──
if (billing) {
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
}

// ── the change allowance: free changes per plan, granted by the office (round 8, M7) ──
route('GET', '/api/admin/allowance', 'drafter', async (req, res) => json(res, 200, { default: await projects.allowanceDefault() }, req))
route('PUT', '/api/admin/allowance', 'drafter', async (req, res, p, ctx) => json(res, 200, await projects.setAllowanceDefault((await readJson(req, { default: 'number' })).default, ctx.user), req))
route('POST', '/api/review/:id/allowance', 'drafter', async (req, res, p, ctx) => json(res, 200, await projects.grantAllowance(await projects.load(ctx.user, p.id, { drafter: true }), ctx.user, await readJson(req, { add: 'number', note: 'string?' })), req))
// the office estimate (round 8, M2): drafters and admins only; a homeowner gets 403 from the role check
route('GET', '/api/review/:id/estimate', 'drafter', async (req, res, p, ctx) => {
  const url = new URL(req.url, 'http://x')
  const u = url.searchParams.get('upgrades') // "brick,plate10"; "none" switches every adder off; absent: the style's own
  json(res, 200, await projects.estimateFor(await projects.load(ctx.user, p.id, { drafter: true }), { upgrades: u === null ? null : u === 'none' ? [] : u.split(',').map((x) => x.trim()).filter(Boolean) }), req)
})

// ── drafter review ─────────────────────────────────────────────────────────
route('GET', '/api/review', 'drafter', async (req, res) => json(res, 200, await projects.inbox(), req))
route('GET', '/api/review/:id', 'drafter', async (req, res, p, ctx) => json(res, 200, await projects.detail(await projects.load(ctx.user, p.id, { drafter: true }), { drafter: true }), req))
route('POST', '/api/review/:id', 'drafter', async (req, res, p, ctx) => json(res, 200, await projects.review(await projects.load(ctx.user, p.id, { drafter: true }), ctx.user, await readJson(req, { decision: 'string', note: 'string?' }), queueJob), req))
// a drafter confirms the zoning of a typed lot (round 10, item 4): only then can zoning block its Send
route('POST', '/api/review/:id/zoning', 'drafter', async (req, res, p, ctx) => json(res, 200, await projects.confirmZoning(await projects.load(ctx.user, p.id, { drafter: true }), ctx.user, await readJson(req, { district: 'string?', residential: 'boolean?', use: 'string?', note: 'string?', clear: 'boolean?' })), req))
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
    // the usage and its cost stay in the log and the activity (office-only); the app gets the diff
    const { usage, cost, ...diff } = out
    json(res, 200, diff, req)
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
// test-only (DRAFTHOUSE_TEST_ROUTES=1): an unexpected error and an error that hides its words, to prove the 500 path
if (/^(1|true)$/i.test(process.env.DRAFTHOUSE_TEST_ROUTES || '')) {
  route('GET', '/api/_test/boom', 'public', async (req) => {
    const mode = new URL(req.url, 'http://x').searchParams.get('mode')
    if (mode === 'hidden') throw Object.assign(new Error('a detail the client must not see'), { status: 500, expose: false })
    if (mode === 'own') throw Object.assign(new Error('the plat reader is resting'), { status: 503 })
    throw new TypeError('boom: cannot read properties of undefined')
  })
}
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
      // an app route still learns who is signed in when a token is sent (drafter-only fields on shared routes, round 7)
      if (!wantsUser && req.headers.authorization) ctx.user = await users.fromRequest(req).catch(() => null)
      if (wantsUser) {
        ctx.user = await users.fromRequest(req)
        if (!ctx.user) return json(res, 401, { error: 'sign in first', signIn: true }, req)
        if (r.need === 'drafter' && !users.isDrafter(ctx.user)) return json(res, 403, { error: 'drafters only' }, req)
      }
      return await r.handler(req, res, m.groups || {}, ctx)
    }
    json(res, 404, { error: 'no route', path: url.pathname }, req)
  } catch (e) {
    // an error with a status of its own and expose not false returns its own words (a 503 the code meant for the
    // client, a 409, a 400). Anything else is the office's fault: 500, a plain line with a request id, and the
    // detail and stack in the log under the same id (round 8, item 3)
    let own = !!e.status && e.expose !== false
    let status = own ? e.status : e.message === 'body too large' ? 413 : 500
    // an upstream service that dropped the connection or timed out (round 10, item 6): "TypeError: fetch failed", an
    // AbortError or a TimeoutError that nobody caught is a 502 with a plain line, never a 500
    if (!own && status === 500 && e?.code !== 'DH_NETWORK_GUARD' && (e?.name === 'TimeoutError' || e?.name === 'AbortError' || (e instanceof TypeError && /fetch failed/i.test(e.message || '')) || /^(ECONNRESET|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|UND_ERR_)/.test(String(e?.cause?.code || e?.code || '')))) {
      console.error(`[api] ${req.method} ${String(req.url).split('?')[0]} → 502: an outside service did not answer (${e?.cause?.code || e?.name || 'fetch failed'})`)
      e = Object.assign(new Error('A map service did not answer; try again in a moment. The office checks it if it stays down.'), { status: 502 })
      own = true
      status = 502
    }
    const requestId = own && status < 500 ? null : crypto.randomBytes(4).toString('hex')
    if (status >= 500) console.error(`[api] ${req.method} ${req.url} → ${status} (request ${requestId}):`, e?.stack || e)
    const error = own ? String(e.message || e) : status === 413 ? 'body too large' : `Something went wrong on our side; the office has been told. Reference ${requestId}.`
    json(res, status, { error, ...(requestId ? { requestId } : {}), ...(e.lotPending ? { lotPending: true } : {}), ...(e.rules ? { rules: e.rules } : {}) }, req)
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
    console.log(`parcels: ${parcels.describe().detail}${fixtureMode() ? ' (answering from fixtures)' : ''}`)
    // the daily parcel-source check (round 7): PARCEL_DAILY_CHECK=1 on Render; off on laptops and in tests
    // the mapped columns against the layers' own field lists, once at start (round 10, item 5); PARCEL_FIELD_CHECK=0 turns it off
    if (process.env.PARCEL_FIELD_CHECK !== '0') parcels.checkFields().then((r) => console.log(`parcels: mapped columns ${r.ok ? 'all present on the layers' : 'NOT all present: ' + r.rows.filter((x) => !x.ok).map((x) => `${x.id} (${[...x.missing, ...x.wrongType, x.error].filter(Boolean).join('; ')})`).join(', ')}`)).catch((e) => console.error('parcel field check:', e.message))
    if (process.env.PARCEL_DAILY_CHECK === '1') {
      const run = () => parcels.checkFields().catch((e) => console.error('parcel field check:', e.message)).then(() => parcels.dailyCheck({ email: alerts.email ? (subject, text) => alerts.email(subject, text) : null }).catch((e) => console.error('parcel daily check:', e.message)))
      setTimeout(run, 5 * 60000).unref()
      setInterval(run, 24 * 3600000).unref()
    }
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
