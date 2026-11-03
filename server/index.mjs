// Draft House office API: job queue, file store, worker heartbeats, health, change interpreter.
// Run: node server/index.mjs
// Storage: Postgres when DATABASE_URL is set, else server/data/db.json. Files: Supabase Storage
// when SUPABASE_URL and SUPABASE_SERVICE_KEY are set, else server/data/files. See docs/DEPLOY.md.
import http from 'node:http'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import Anthropic from '@anthropic-ai/sdk'
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema'
import { openStore } from './store/index.mjs'
import { openFiles } from './files/index.mjs'
import { makeAuth } from './auth.mjs'
import { makeAlerts } from './alerts.mjs'
import { makeBackup } from './backup.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = +(process.env.PORT || 8787)
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data')
const VERSION = '0.2.0'
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
const alerts = makeAlerts({ store, event })
const backup = makeBackup({ store, files, event })

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
    { id: 'interpreter', name: 'Change interpreter', ok: !!interpreterClient && interpreterReach.ok !== false, detail: interpreterClient ? interpreterReach.detail : 'no API key, clients get the basic rules', at: now() },
    { id: 'worker', name: 'Revit worker', ok: workers.some((w) => w.online), detail: workers.length ? workers.map((w) => `${w.name}: ${w.online ? 'online' : 'offline'}`).join(', ') : 'none registered', at: now() },
    { id: 'auth', name: 'API keys', ...auth.describe(), at: now() },
    { id: 'alerts', name: 'Alert email', ...alerts.describe(), at: now() },
    { id: 'backup', name: 'Nightly backup', ...bk, at: now() },
  ]
  workers.forEach((w) => (w.checks || []).forEach((c) => checks.push({ ...c, id: `${w.id}:${c.id}`, worker: w.name })))
  const soft = new Set(['interpreter', 'auth', 'alerts', 'backup']) // shown, but they do not take the office down
  return { ok: checks.filter((c) => !soft.has(c.id)).every((c) => c.ok), version: VERSION, uptimeS: Math.round((t - started) / 1000), store: store.kind, files: files.kind, checks, workers, queue: { queued: q.queued, running: q.running, stuck: q.stuck } }
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
const readJson = async (req) => JSON.parse((await readBody(req)).toString('utf8') || '{}')
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

// need: 'public' (anyone) | 'any' (either key) | 'app' | 'worker'
const routes = []
const route = (method, pattern, need, handler) => routes.push({ method, need, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler })

// ── designs & jobs ─────────────────────────────────────────────────────────
route('POST', '/api/designs', 'app', async (req, res) => {
  const body = await readJson(req)
  if (!body.design || body.design.contract !== 1) return json(res, 400, { error: 'design with contract 1 required' }, req)
  const d = { id: id('dsn'), createdAt: now(), client: body.design.client || body.client || 'Client', address: body.design.lot?.address || '', style: body.design.style?.name || '', livingSf: body.design.livingSf || null, changes: body.design.changes || [] }
  await files.put(d.id, 'design.json', Buffer.from(JSON.stringify(body.design)), 'application/json')
  if (body.ifc) await files.put(d.id, 'draft.ifc', Buffer.from(body.ifc), 'application/x-step')
  await store.designs.add(d)
  const job = { id: id('job'), designId: d.id, status: 'queued', createdAt: now(), updatedAt: now(), attempts: 0, steps: [], outputs: [], client: d.client, address: d.address }
  await store.jobs.add(job)
  await event('design', `${d.client}: design received, job queued`, { designId: d.id, jobId: job.id })
  json(res, 201, { design: d, job }, req)
})
route('GET', '/api/designs', 'app', async (req, res) => json(res, 200, await store.designs.list(100), req))
route('GET', '/api/designs/:id/design.json', 'any', (req, res, p) => sendFile(req, res, p.id, 'design.json'))
route('GET', '/api/jobs', 'app', async (req, res) => json(res, 200, await store.jobs.list(200), req))
route('GET', '/api/jobs/:id', 'any', async (req, res, p) => {
  const j = await store.jobs.get(p.id)
  j ? json(res, 200, j, req) : json(res, 404, { error: 'not found' }, req)
})
route('POST', '/api/jobs/claim', 'worker', async (req, res) => {
  const body = await readJson(req)
  const job = await store.jobs.claim(body.worker || 'worker', now())
  if (!job) return json(res, 204, {}, req)
  await event('job', `${job.client}: ${job.worker} started building`, { jobId: job.id })
  json(res, 200, { ...job, designUrl: `/api/designs/${job.designId}/design.json` }, req)
})
route('POST', '/api/jobs/:id/progress', 'worker', async (req, res, p) => {
  const job = await store.jobs.get(p.id)
  if (!job) return json(res, 404, { error: 'not found' }, req)
  const body = await readJson(req)
  job.steps.push({ at: now(), step: body.step, message: body.message, pct: body.pct })
  job.updatedAt = now()
  await store.jobs.put(job)
  json(res, 200, { ok: true }, req)
})
route('POST', '/api/jobs/:id/complete', 'worker', async (req, res, p) => {
  const job = await store.jobs.get(p.id)
  if (!job) return json(res, 404, { error: 'not found' }, req)
  const body = await readJson(req)
  job.status = 'done'
  job.finishedAt = now()
  job.updatedAt = now()
  job.durationS = Math.round((Date.parse(job.finishedAt) - Date.parse(job.startedAt || job.updatedAt)) / 1000)
  job.outputs = body.outputs || job.outputs
  job.warnings = body.warnings || []
  job.log = (body.log || '').slice(-20000)
  await store.jobs.put(job)
  await event('job', `${job.client}: model built in ${job.durationS}s${job.warnings.length ? `, ${job.warnings.length} warnings` : ''}`, { jobId: job.id })
  json(res, 200, { ok: true }, req)
})
route('POST', '/api/jobs/:id/fail', 'worker', async (req, res, p) => {
  const job = await store.jobs.get(p.id)
  if (!job) return json(res, 404, { error: 'not found' }, req)
  const body = await readJson(req)
  job.status = job.attempts < 2 ? 'queued' : 'failed'
  job.error = body.error || 'unknown error'
  job.log = (body.log || '').slice(-20000)
  job.updatedAt = now()
  await store.jobs.put(job)
  await event('error', `${job.client}: build failed (${job.error})${job.status === 'queued' ? ', retrying' : ''}`, { jobId: job.id })
  json(res, 200, { ok: true, status: job.status }, req)
})
route('POST', '/api/jobs/:id/retry', 'app', async (req, res, p) => {
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
  const body = await readJson(req)
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
route('GET', '/api/workers', 'app', async (req, res) => json(res, 200, (await health()).workers, req))
route('POST', '/api/workers/:id/commands', 'app', async (req, res, p) => {
  const body = await readJson(req)
  await store.commands.add({ id: id('cmd'), worker: p.id, command: body.command, at: now(), taken: null })
  await event('worker', `${p.id}: command "${body.command}" queued`, { worker: p.id })
  json(res, 200, { ok: true }, req)
})

// ── change interpreter (Claude; the key never leaves this process) ─────────
const INTERPRET_MODEL = process.env.INTERPRET_MODEL || 'claude-opus-5-5'
const DIFF_SCHEMA = {
  type: 'object',
  properties: {
    ops: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          op: { type: 'string', enum: ['resize', 'add', 'remove', 'move'] },
          room: { type: 'string', description: 'room id for resize, remove, move' },
          kind: { type: 'string', description: 'room kind for add, one of the kit kinds' },
          name: { type: 'string' },
          w: { type: 'number', description: 'feet, along the front' },
          d: { type: 'number', description: 'feet, front to back' },
          near: { type: 'string', description: 'room id to place a new room beside' },
          dx: { type: 'number', description: 'feet east' },
          dy: { type: 'number', description: 'feet toward the street' },
        },
        required: ['op'],
        additionalProperties: false,
      },
    },
    reply: { type: 'string', description: 'one or two sentences to the client, past tense, no jargon' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
  required: ['ops', 'reply', 'confidence'],
  additionalProperties: false,
}
const INTERPRET_SYSTEM = `You turn a home buyer's plain-language request into a small list of edits to their floor plan.
You get the current rooms (id, kind, name, width w and depth d in feet, position x y in feet from the rear-left corner, y grows toward the street) and the kit's room kinds with typical sizes.
Rules:
- Use only ids and kinds that appear in the input. Never invent ids.
- "Bigger" means about 15% larger in both directions, "much bigger" about 30%. "Wider" changes w only, "deeper" or "longer" changes d only.
- A size or distance the client states is exact. Use it as given, even when it is under a minimum, crosses the lot, or looks like a bad idea. A plan checker runs after you, enforces minimums, setbacks and overlaps, and explains the problem to the client; never substitute a different number and never ask back just because a stated number breaks a rule.
- Keep dimensions in quarter-foot steps. When you choose a size yourself, keep it within reason: bedrooms 10 to 20 feet, kitchens 9 to 22, no room over 40.
- "Add" always means one more room of that kind, even when the plan already has one (a second office, a third bedroom). Do not ask whether they meant to resize the existing one.
- A new room gets the kit's template size unless the client gives one. Put it near the room they mention with "near".
- Removing a room removes what is in it. Do not remove the kitchen, the living room, the last bedroom or the last bathroom; set confidence low and explain instead.
- If the request is unclear, or not about the floor plan, return no ops, a question in reply, and confidence below 0.5.
- The reply is one or two friendly sentences in past tense describing what you did, as if talking to the buyer.`
const INTERPRET_TIMEOUT_MS = +(process.env.INTERPRET_TIMEOUT_MS || 8000)
// $ per million tokens; Claude Opus 5.5 list prices. Override with INTERPRET_PRICES='{"in":4,"out":20,"cacheRead":0.2,"cacheWrite":5}'
const PRICES = process.env.INTERPRET_PRICES ? JSON.parse(process.env.INTERPRET_PRICES) : { in: 4, out: 20, cacheRead: 0.2, cacheWrite: 5 }
const costOf = (u) => ((u?.input_tokens || 0) * PRICES.in + (u?.output_tokens || 0) * PRICES.out + (u?.cache_read_input_tokens || 0) * PRICES.cacheRead + (u?.cache_creation_input_tokens || 0) * PRICES.cacheWrite) / 1e6
const logInterpret = (rec) => store.interpretLog.add({ at: now(), ...rec }).catch((e) => console.error('interpret log:', e.message))
// DRAFTHOUSE_CLAUDE_KEY first (some hosts blank ANTHROPIC_API_KEY), then ANTHROPIC_API_KEY.
// Only the length is ever printed or reported.
const KEY_VARS = ['DRAFTHOUSE_CLAUDE_KEY', 'ANTHROPIC_API_KEY']
const keyVar = KEY_VARS.find((v) => (process.env[v] || '').trim())
const claudeKey = keyVar ? process.env[keyVar].trim() : ''
const interpreterClient = claudeKey ? new Anthropic({ apiKey: claudeKey, timeout: INTERPRET_TIMEOUT_MS, maxRetries: 0 }) : null
// the innermost network error code (ECONNREFUSED, ENOTFOUND, ...) behind the SDK's connection error
const netCause = (e) => {
  for (let c = e.cause; c; c = c.cause) if (c.code) return c.code
  return e.cause?.message || e.message
}
// Can this machine reach api.anthropic.com with this key? Checked at start and kept current by real calls; health shows it.
let interpreterReach = { ok: null, detail: 'checking api.anthropic.com' }
async function probeInterpreter() {
  if (!interpreterClient) return
  try {
    await interpreterClient.models.retrieve(INTERPRET_MODEL, { timeout: 10000 })
    interpreterReach = { ok: true, detail: `${INTERPRET_MODEL}, api.anthropic.com reachable` }
  } catch (e) {
    const blocked = e instanceof Anthropic.APIConnectionError
    const detail = blocked
      ? `api.anthropic.com is blocked or unreachable from this machine (network access): ${netCause(e)}`
      : e instanceof Anthropic.AuthenticationError
        ? `api.anthropic.com rejected the key from ${keyVar} (401)`
        : e instanceof Anthropic.PermissionDeniedError
          ? `api.anthropic.com refused access (403): ${e.message}`
          : e instanceof Anthropic.NotFoundError
            ? `model ${INTERPRET_MODEL} not available to this key`
            : `api.anthropic.com check failed: ${e.message}`
    interpreterReach = { ok: false, detail }
  }
  console.log(`interpreter: ${interpreterReach.detail}`)
}

route('POST', '/api/interpret', 'app', async (req, res) => {
  if (!interpreterClient) return json(res, 503, { error: 'interpreter not configured on this server (no DRAFTHOUSE_CLAUDE_KEY or ANTHROPIC_API_KEY)' }, req)
  const body = await readJson(req)
  if (!body.text || !Array.isArray(body.rooms)) return json(res, 400, { error: 'text and rooms required' }, req)
  const input = { request: String(body.text).slice(0, 500), program: body.program, kit: body.kit, rooms: body.rooms }
  const t0 = Date.now()
  try {
    const message = await interpreterClient.messages.parse({
      model: INTERPRET_MODEL,
      max_tokens: 4000,
      system: [{ type: 'text', text: INTERPRET_SYSTEM, cache_control: { type: 'ephemeral' } }],
      output_config: { effort: 'low', format: jsonSchemaOutputFormat(DIFF_SCHEMA) },
      messages: [{ role: 'user', content: JSON.stringify(input) }],
    })
    const ms = Date.now() - t0
    const cost = costOf(message.usage)
    interpreterReach = { ok: true, detail: `${INTERPRET_MODEL}, api.anthropic.com reachable` }
    if (message.stop_reason === 'refusal') {
      logInterpret({ request: input.request, client: body.client || null, verdict: 'refusal', category: message.stop_details?.category || null, ms, usage: message.usage, cost, model: INTERPRET_MODEL })
      return json(res, 502, { error: 'interpreter declined', category: message.stop_details?.category || null }, req)
    }
    const out = message.parsed_output
    if (!out || !Array.isArray(out.ops)) {
      logInterpret({ request: input.request, client: body.client || null, verdict: 'no-diff', ms, usage: message.usage, cost, model: INTERPRET_MODEL })
      return json(res, 502, { error: 'interpreter returned no diff' }, req)
    }
    logInterpret({ request: input.request, client: body.client || null, rooms: body.rooms?.length, diff: out, verdict: out.confidence < 0.5 || !out.ops.length ? 'unsure' : 'diff', ms, usage: message.usage, cost, model: INTERPRET_MODEL })
    await event('interpret', `"${input.request.slice(0, 60)}" → ${out.ops.length} op${out.ops.length === 1 ? '' : 's'}, ${ms} ms, $${cost.toFixed(4)}`)
    json(res, 200, { ...out, model: INTERPRET_MODEL, usage: message.usage, cost, ms }, req)
  } catch (e) {
    const ms = Date.now() - t0
    const timeout = e instanceof Anthropic.APIConnectionTimeoutError || /timed? ?out/i.test(e.message || '')
    const blocked = !timeout && e instanceof Anthropic.APIConnectionError
    const status = timeout ? 504 : blocked ? 503 : e instanceof Anthropic.RateLimitError ? 429 : e instanceof Anthropic.AuthenticationError ? 503 : e instanceof Anthropic.APIError ? 502 : 500
    const error = timeout ? `interpreter timed out after ${INTERPRET_TIMEOUT_MS} ms` : blocked ? `api.anthropic.com is blocked or unreachable from this machine (network access): ${netCause(e)}` : String(e.message || e)
    if (blocked) interpreterReach = { ok: false, detail: error }
    logInterpret({ request: input.request, client: body.client || null, verdict: timeout ? 'timeout' : 'error', error: error.slice(0, 200), ms, model: INTERPRET_MODEL })
    await event('error', `interpreter: ${timeout ? `no answer in ${INTERPRET_TIMEOUT_MS} ms` : error}`)
    json(res, status, { error, timeout, blocked }, req)
  }
})

route('POST', '/api/interpret/verdict', 'app', async (req, res) => {
  const body = await readJson(req)
  await logInterpret({ request: String(body.text || '').slice(0, 500), client: body.client || null, source: body.source, verdict: body.applied ? 'applied' : 'rejected', reasons: body.reasons || [], reply: body.reply, ops: body.ops })
  json(res, 200, { ok: true }, req)
})
route('GET', '/api/interpret/log', 'app', async (req, res) => {
  const [summary, recent] = await Promise.all([store.interpretLog.summary(), store.interpretLog.recent(50)])
  json(res, 200, { ...summary, recent }, req)
})

// ── health & admin ─────────────────────────────────────────────────────────
route('GET', '/api/health', 'public', async (req, res, p, role) => {
  const h = await health()
  // without a key (the hosting health probe, anyone on the internet) only the verdict is shown
  if (!role) return json(res, 200, { ok: h.ok, version: h.version, uptimeS: h.uptimeS }, req)
  json(res, 200, h, req)
})
route('GET', '/api/admin/overview', 'app', async (req, res) => {
  const [h, q, jobs, events, designs, designCount] = await Promise.all([health(), store.jobs.stats(LEASE_MIN * 60000, Date.now()), store.jobs.list(25), store.events.list(40), store.designs.list(10), store.designs.count()])
  json(res, 200, {
    health: h,
    counts: { designs: designCount, jobs: q.total, queued: q.queued, running: q.running, done: q.done, failed: q.failed, avgDurationS: q.avgDurationS },
    jobs,
    recentDurations: q.recentDone,
    events,
    designs,
  }, req)
})
route('POST', '/api/admin/backup', 'app', async (req, res) => json(res, 200, await backup.run('dashboard'), req))

// ── server ─────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') return json(res, 204, {}, req)
    const url = new URL(req.url, 'http://x')
    for (const r of routes) {
      const m = url.pathname.match(r.re)
      if (!m || r.method !== req.method) continue
      const role = auth.role(req, url)
      if (!auth.allows(r.need, role)) return json(res, role ? 403 : 401, { error: role ? `this key may not ${req.method} ${url.pathname}` : 'API key required (x-api-key)' }, req)
      return await r.handler(req, res, m.groups || {}, role === 'open' ? 'app' : role)
    }
    json(res, 404, { error: 'no route', path: url.pathname }, req)
  } catch (e) {
    json(res, e.message === 'body too large' ? 413 : 500, { error: String(e.message || e) }, req)
  }
})

async function main() {
  await store.init()
  await files.init()
  server.listen(PORT, () => {
    console.log(`Draft House office API v${VERSION} on :${PORT}; store ${store.kind} (${store.detail}); files ${files.kind} (${files.detail})`)
    console.log(`auth: ${auth.describe().detail}`)
    console.log(keyVar ? `interpreter: key from ${keyVar} (${claudeKey.length} chars), model ${INTERPRET_MODEL}` : 'interpreter: no DRAFTHOUSE_CLAUDE_KEY or ANTHROPIC_API_KEY, clients get the basic rules')
    console.log(`alerts: ${alerts.describe().detail}`)
    probeInterpreter()
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
