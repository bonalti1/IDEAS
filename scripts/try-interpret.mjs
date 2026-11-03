// Runs the ten named requests through the real office interpreter and prints,
// for each: the request, Claude's diff, the rules verdict, the reply, timing,
// tokens and cost. Needs the office API running with ANTHROPIC_API_KEY set.
// usage: node scripts/try-interpret.mjs [api base]   (default http://localhost:8787)
import { generateRooms } from '../src/draft/lib/layout.js'
import { validateOps, applyOps, summarizeRooms } from '../src/draft/lib/ops.js'
import { checkRules } from '../src/draft/lib/rules.js'
import { STYLES } from '../src/draft/lib/styles.js'
import { KIT } from '../src/kits/modern-farmhouse.js'

const API = (process.argv[2] || 'http://localhost:8787').replace(/\/$/, '')
const style = STYLES.find((s) => s.id === 'farmhouse')
const program = { ...KIT.reference.program }
const REQUESTS = [
  'make the kitchen bigger',
  'add an office',
  'remove the half bath',
  'make the master closet bigger',
  'add a bedroom',
  'bigger primary bath',
  'remove the rear porch',
  'make bedroom 2 much smaller, like 8 by 8',
  'remove the kitchen',
  'push the mini primary 30 feet toward the street',
]
const kitMeta = { id: KIT.id, name: KIT.name, kinds: Object.fromEntries(Object.entries(KIT.rooms).map(([k, t]) => [k, { name: t.name, w: t.w, d: t.d, zone: t.zone }])), minSize: KIT.rules?.minSize || {} }
const line = (s = '─') => console.log(s.repeat(78))

const health = await fetch(API + '/api/health').then((r) => r.json()).catch(() => null)
const interp = health?.checks?.find((c) => c.id === 'interpreter')
console.log(`office API ${API}: ${health ? 'up' : 'DOWN'}; interpreter: ${interp ? (interp.ok ? interp.detail : 'NOT CONFIGURED (' + interp.detail + ')') : 'unknown'}`)
if (!health || !interp?.ok) {
  console.log('Nothing to prove without a configured interpreter. Set ANTHROPIC_API_KEY on the office API and run again.')
  process.exit(2)
}

let totalCost = 0
let totalMs = 0
const summary = []
for (const text of REQUESTS) {
  const rooms = generateRooms(program, style)
  line()
  console.log(`REQUEST  ${text}`)
  const t0 = Date.now()
  let res
  try {
    const r = await fetch(API + '/api/interpret', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, rooms: summarizeRooms(rooms), program, kit: kitMeta }) })
    res = { status: r.status, body: await r.json() }
  } catch (e) {
    res = { status: 0, body: { error: String(e.message || e) } }
  }
  const ms = Date.now() - t0
  totalMs += ms
  if (res.status !== 200) {
    console.log(`CLAUDE   HTTP ${res.status}: ${res.body.error}`)
    summary.push({ text, verdict: `error ${res.status}` })
    continue
  }
  const { ops, reply, confidence, usage, cost, model } = res.body
  console.log(`CLAUDE   ${model} · ${ms} ms · in ${usage?.input_tokens ?? '?'} (cache read ${usage?.cache_read_input_tokens ?? 0}) · out ${usage?.output_tokens ?? '?'} · $${(cost ?? 0).toFixed(4)}`)
  console.log(`DIFF     confidence ${confidence} · ${ops.length ? ops.map((o) => JSON.stringify(o)).join('\n         ') : '(no ops)'}`)
  totalCost += cost || 0
  let verdict
  if (confidence < 0.5 || !ops.length) verdict = `NOT APPLIED (confidence ${confidence})`
  else {
    const v = validateOps(ops, rooms, KIT)
    if (!v.ok) verdict = `REJECTED by shape check: ${v.errors.join('; ')}`
    else {
      try {
        const next = applyOps(ops, rooms, KIT, program.stories)
        const rules = checkRules(next.rooms, program, style)
        verdict = rules.ok ? `APPLIED: ${next.did.join('; ')}` : `REJECTED by rules: ${rules.reasons.join(' ')}`
      } catch (e) {
        verdict = `FAILED to apply: ${e.message}`
      }
    }
  }
  console.log(`RULES    ${verdict}`)
  console.log(`REPLY    ${reply}`)
  summary.push({ text, verdict: verdict.split(':')[0], ms, cost })
}
line('═')
console.log('SUMMARY')
summary.forEach((s) => console.log(`  ${s.verdict.padEnd(26)} ${s.ms ? String(s.ms).padStart(5) + ' ms' : '       '}  $${(s.cost ?? 0).toFixed(4)}  ${s.text}`))
console.log(`  total $${totalCost.toFixed(4)} · ${Math.round(totalMs / REQUESTS.length)} ms avg · $${(totalCost / REQUESTS.length).toFixed(4)} per request`)
