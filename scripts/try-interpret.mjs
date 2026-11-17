// Runs the ten named requests through the real office interpreter and prints,
// for each: the request, Claude's diff, the rules verdict, the reply, timing,
// tokens and cost, and whether the outcome is the right one.
// The office API must be running with DRAFTHOUSE_CLAUDE_KEY (or ANTHROPIC_API_KEY) set.
// usage: node scripts/try-interpret.mjs [api base]   (default http://localhost:8787)
// Exit 0 when at least 9 of 10 come out right, 1 when fewer, 2 when nothing could be tried.
import Anthropic from '@anthropic-ai/sdk'
import { generateRooms, isRoom } from '../src/draft/lib/layout.js'
import { summarizeRooms } from '../src/draft/lib/ops.js'
import { decide } from '../src/draft/lib/interpret.js'
import { STYLES } from '../src/draft/lib/styles.js'
import { KIT } from '../src/kits/modern-farmhouse.js'

const API = (process.argv[2] || 'http://localhost:8787').replace(/\/$/, '')
const KEY = process.env.DRAFTHOUSE_APP_KEY || ''
const AUTH = KEY ? { 'x-api-key': KEY } : {}
const MODEL = process.env.INTERPRET_MODEL || 'claude-opus-5-5'
const style = STYLES.find((s) => s.id === 'farmhouse')
const program = { ...KIT.reference.program }
const fresh = () => generateRooms(program, style)
const room = (rooms, id) => rooms.find((r) => isRoom(r) && r.id === id)
const count = (rooms, kind) => rooms.filter((r) => isRoom(r) && r.kind === kind).length

// What "right" means for each request. Applied ones say what must be true after;
// the last three must be refused, either by Claude asking back or by the rules.
const REQUESTS = [
  { text: 'make the kitchen bigger', apply: (a, b) => room(b, 'kitchen').w * room(b, 'kitchen').d > room(a, 'kitchen').w * room(a, 'kitchen').d },
  { text: 'add an office', apply: (a, b) => count(b, 'office') === count(a, 'office') + 1 },
  { text: 'remove the half bath', apply: (a, b) => !room(b, 'halfbath') },
  { text: 'make the master closet bigger', apply: (a, b) => room(b, 'mwic').w * room(b, 'mwic').d > room(a, 'mwic').w * room(a, 'mwic').d },
  { text: 'add a bedroom', apply: (a, b) => count(b, 'bed') === count(a, 'bed') + 1 },
  { text: 'bigger primary bath', apply: (a, b) => room(b, 'mbath').w * room(b, 'mbath').d > room(a, 'mbath').w * room(a, 'mbath').d },
  { text: 'remove the rear porch', apply: (a, b) => !room(b, 'rearPorch') },
  { text: 'make bedroom 2 much smaller, like 8 by 8', refuse: true },
  { text: 'remove the kitchen', refuse: true },
  { text: 'push the mini primary 30 feet toward the street', refuse: true },
]
const kitMeta = { id: KIT.id, name: KIT.name, kinds: Object.fromEntries(Object.entries(KIT.rooms).map(([k, t]) => [k, { name: t.name, w: t.w, d: t.d, zone: t.zone }])), minSize: KIT.rules?.minSize || {} }
const line = (s = '─') => console.log(s.repeat(78))
const money = (v) => `$${(v ?? 0).toFixed(4)}`

const netCause = (e) => {
  for (let c = e.cause; c; c = c.cause) if (c.code) return c.code
  return e.cause?.message || e.message
}

// 1. the key, from the same variables the office API reads (length only, never the value)
const keyVar = ['DRAFTHOUSE_CLAUDE_KEY', 'ANTHROPIC_API_KEY'].find((v) => (process.env[v] || '').trim())
const key = keyVar ? process.env[keyVar].trim() : ''
console.log(keyVar ? `key      ${keyVar}, ${key.length} chars` : 'key      none in DRAFTHOUSE_CLAUDE_KEY or ANTHROPIC_API_KEY on this shell')

// 2. can this machine reach api.anthropic.com at all?
if (key) {
  try {
    await new Anthropic({ apiKey: key, maxRetries: 0, timeout: 10000 }).models.retrieve(MODEL)
    console.log(`network  api.anthropic.com reachable, ${MODEL} available to this key`)
  } catch (e) {
    if (e instanceof Anthropic.APIConnectionError) {
      console.log(`network  BLOCKED: api.anthropic.com cannot be reached from this machine (${netCause(e)}).`)
      console.log('         The environment\'s network access does not allow it. Allow api.anthropic.com and run again.')
      process.exit(2)
    }
    console.log(`network  api.anthropic.com answered but refused: ${e.status ?? ''} ${e.message}`)
    process.exit(2)
  }
}

// 3. the office API and its interpreter
const health = await fetch(API + '/api/health', { headers: AUTH }).then((r) => r.json()).catch(() => null)
const interp = health?.checks?.find((c) => c.id === 'interpreter')
console.log(`office   ${API}: ${health ? 'up' : 'DOWN'}; interpreter: ${interp ? (interp.ok ? interp.detail : 'NOT READY (' + interp.detail + ')') : 'unknown'}`)
if (!health || !interp?.ok) {
  console.log('Nothing to prove without a working interpreter. Start the office API with DRAFTHOUSE_CLAUDE_KEY set (npm run office) and run again.')
  process.exit(2)
}

let totalCost = 0
let totalMs = 0
const summary = []
for (const req of REQUESTS) {
  const rooms = fresh()
  line()
  console.log(`REQUEST  ${req.text}`)
  const t0 = Date.now()
  let res
  try {
    const r = await fetch(API + '/api/interpret', { method: 'POST', headers: { 'content-type': 'application/json', ...AUTH }, body: JSON.stringify({ text: req.text, rooms: summarizeRooms(rooms), program, kit: kitMeta, client: 'try-interpret' }) })
    res = { status: r.status, body: await r.json() }
  } catch (e) {
    res = { status: 0, body: { error: String(e.message || e) } }
  }
  const ms = Date.now() - t0
  totalMs += ms
  if (res.status !== 200) {
    console.log(`CLAUDE   HTTP ${res.status} after ${ms} ms: ${res.body.error}`)
    summary.push({ text: req.text, verdict: `ERROR ${res.status}`, ms, cost: 0, ok: false })
    continue
  }
  const { ops, reply, confidence, usage, cost, model } = res.body
  totalCost += cost || 0
  console.log(`CLAUDE   ${model} · ${ms} ms · in ${usage?.input_tokens ?? '?'} · cache read ${usage?.cache_read_input_tokens ?? 0} · cache write ${usage?.cache_creation_input_tokens ?? 0} · out ${usage?.output_tokens ?? '?'} · ${money(cost)}`)
  console.log(`DIFF     confidence ${confidence} · ${ops.length ? ops.map((o) => JSON.stringify(o)).join('\n         ') : '(no ops)'}`)

  // exactly what the app does with the diff: confidence gate, shape check, apply, rules
  const out = decide({ ops, reply, confidence }, rooms, program, style, KIT, 'claude')
  const verdict = out.applied ? 'APPLIED' : !out.ops.length ? 'ASKED BACK' : out.reasons?.length ? 'REJECTED' : 'NOT APPLIED'
  const detail = out.applied ? out.did.join('; ') : out.reasons?.join(' ') || `confidence ${confidence}`
  const ok = req.refuse ? !out.applied : out.applied && !!req.apply(rooms, out.rooms)
  console.log(`RULES    ${verdict}: ${detail}`)
  console.log(`REPLY    ${out.reply}`)
  console.log(`RESULT   ${ok ? 'RIGHT' : 'WRONG'} (wanted ${req.refuse ? 'a refusal' : 'the change applied'})`)
  await fetch(API + '/api/interpret/verdict',{ method: 'POST', headers: { 'content-type': 'application/json', ...AUTH }, body: JSON.stringify({ text: req.text, client: 'try-interpret', source: 'claude', applied: out.applied, reasons: out.reasons || [], reply: out.reply, ops: out.ops }) }).catch(() => null)
  summary.push({ text: req.text, verdict, ms, cost, ok })
}
line('═')
const right = summary.filter((s) => s.ok).length
console.log('SUMMARY')
summary.forEach((s) => console.log(`  ${s.ok ? 'RIGHT' : 'WRONG'}  ${s.verdict.padEnd(11)} ${String(s.ms).padStart(5)} ms  ${money(s.cost)}  ${s.text}`))
console.log(`  ${right} of ${REQUESTS.length} right · total ${money(totalCost)} · ${Math.round(totalMs / REQUESTS.length)} ms avg · ${money(totalCost / REQUESTS.length)} per request`)
process.exit(right >= 9 ? 0 : 1)
