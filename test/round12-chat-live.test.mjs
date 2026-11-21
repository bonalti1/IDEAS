// Round 12, item G, against the real Claude interpreter. Skipped unless LIVE=1 and DRAFTHOUSE_CLAUDE_KEY are set:
//   NODE_USE_ENV_PROXY=1 LIVE=1 node --test test/round12-chat-live.test.mjs
// The same four sentences as test/round12-chat.test.mjs, each sent to Claude through server/interpreter.mjs (the
// prompt and the schema the office uses), then judged by the same code the office runs (decide). The key is read
// by the interpreter from the environment and is never printed; only what Claude answered is.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateRooms, DEFAULT_PROGRAM, kitFor, programOf, isRoom } from '../src/draft/lib/layout.js'
import { decide } from '../src/draft/lib/interpret.js'
import { summarizeRooms } from '../src/draft/lib/ops.js'
import { checkRules } from '../src/draft/lib/rules.js'
import { fitsLot } from '../src/draft/lib/fit.js'
import { STYLES } from '../src/draft/lib/styles.js'
import { buildLot } from '../src/draft/lib/lot.js'
import { makeInterpreter } from '../server/interpreter.mjs'

const ON = process.env.LIVE === '1' && !!(process.env.DRAFTHOUSE_CLAUDE_KEY || '').trim()
const skip = ON ? false : 'set LIVE=1 and DRAFTHOUSE_CLAUDE_KEY to run against the real Claude interpreter'

const style = STYLES.find((s) => s.id === 'farmhouse')
const kit = kitFor(style)
const kitMeta = { id: kit.id, name: kit.name, kinds: Object.fromEntries(Object.entries(kit.rooms).map(([k, t]) => [k, { name: t.name, w: t.w, d: t.d, zone: t.zone }])), minSize: kit.rules?.minSize || {} }
function draft(program, lot) {
  const f = fitsLot(program, style, lot)
  const p = f.ok ? program : f.maxSqft ? { ...program, sqft: f.maxSqft } : f.suggestion?.program
  return { program: p, rooms: generateRooms(p, style, lot), lot }
}
const MONEY = /\$|\b\d+k\b|\/sf\b|\bcredits?\b|\bbuy\b|\bpurchase\b|\bprices?\b|\bpricing\b|\brates?\b|\bcosts?\b|\bbilling\b|\bpay(ment)?s?\b|\bfees?\b|\bdollars?\b/i
const room = (rooms, kind) => rooms.find((r) => isRoom(r) && r.kind === kind)

test('live Claude: the four sentences map to the right ops or offer, and the office code gives the same outcomes as with the basic rules', { skip, timeout: 300000 }, async (t) => {
  // the office waits 8 s for Claude before the basic rules answer; this check waits longer so a slow answer is still read
  const interpreter = makeInterpreter({ env: { ...process.env, INTERPRET_TIMEOUT_MS: process.env.INTERPRET_TIMEOUT_MS || '45000' }, log: () => {} })
  assert.equal(interpreter.configured, true)
  const roomy = draft(DEFAULT_PROGRAM, buildLot({ kind: 'manual', width: 100, depth: 150, city: 'mcallen', frontStreet: 'E Nolana Ave', setbacks: {} }))
  const three = draft({ ...DEFAULT_PROGRAM, beds: 3, baths: 2 }, roomy.lot)
  const tight = draft(DEFAULT_PROGRAM, buildLot({ kind: 'manual', width: 60, depth: 110, city: 'mcallen', setbacks: {} }))
  const said = []
  const send = async (text, plan, name) => {
    const diff = await interpreter.ask({ request: text, program: plan.program, kit: kitMeta, rooms: summarizeRooms(plan.rooms) })
    const r = decide(diff, plan.rooms, plan.program, style, kit, 'claude', plan.lot)
    said.push(`${name}: "${text}" → Claude ops ${JSON.stringify(diff.ops)}${diff.intent ? ` intent ${diff.intent}` : ''} conf ${diff.confidence} in ${diff.ms} ms (${diff.model}) → ${r.applied ? 'applied' : 'not applied'}: ${r.reply}${r.fixes?.length ? ` [buttons: ${r.fixes.map((f) => f.label).join(' | ')}]` : ''}`)
    assert.doesNotMatch(r.reply, MONEY, `${text}: ${r.reply}`)
    assert.doesNotMatch(r.reply, /setback/i, `${text}: ${r.reply}`)
    assert.doesNotMatch(String(diff.reply || ''), MONEY, `Claude's own reply: ${diff.reply}`)
    assert.doesNotMatch(String(diff.reply || ''), /setback/i, `Claude's own reply: ${diff.reply}`)
    return { diff, r }
  }
  const tapsApply = (r, plan, text) => {
    for (const f of r.fixes || []) {
      const d = decide({ ops: f.ops, reply: '', confidence: 1 }, plan.rooms, plan.program, style, kit, 'fix', plan.lot)
      assert.equal(d.applied, true, `${text}: the button "${f.label}" applies: ${d.reply}`)
      assert.deepEqual(checkRules(d.rooms, d.program || plan.program, style, plan.lot).reasons, [], `${text}: after "${f.label}"`)
    }
  }
  try {
    // 1. the bedroom count
    const up = await send('I want 4 bedrooms', three, '3-bedroom plan, 100 x 150')
    assert.equal(up.r.applied, true, up.r.reply)
    assert.equal(programOf(up.r.rooms, three.program).beds, 4)
    assert.deepEqual(checkRules(up.r.rooms, three.program, style, three.lot).reasons, [])
    const same = await send('I want 4 bedrooms', roomy, '4-bedroom plan, 100 x 150')
    assert.equal(same.r.applied, false, same.r.reply)
    assert.match(same.r.reply, /already has 4 bedrooms/)
    // 2. the patio
    const patio = await send('Add a covered patio in the back', roomy, '100 x 150')
    assert.ok(patio.diff.ops.some((o) => o.op === 'add' && o.kind === 'rearPorch'), JSON.stringify(patio.diff.ops))
    assert.equal(patio.r.applied, true, patio.r.reply)
    assert.ok(room(patio.r.rooms, 'rearPorch'))
    const noRoom = await send('Add a covered patio in the back', tight, 'tight 60 x 110')
    assert.equal(noRoom.r.applied, false, noRoom.r.reply)
    assert.match(noRoom.r.reply, /^A covered patio at the back does not fit as asked: /)
    assert.ok(noRoom.r.fixes.length >= 1, 'a button is offered')
    tapsApply(noRoom.r, tight, 'patio on the tight lot')
    // 3. the kitchen
    const kitchen = await send('Make the kitchen bigger', roomy, '100 x 150')
    assert.ok(kitchen.diff.ops.some((o) => o.op === 'resize' && o.room === 'kitchen'), JSON.stringify(kitchen.diff.ops))
    assert.equal(kitchen.r.applied, true, kitchen.r.reply)
    const stuck = await send('Make the kitchen bigger', tight, 'tight 60 x 110')
    assert.equal(stuck.r.applied, false, stuck.r.reply)
    assert.match(stuck.r.reply, /^The kitchen (can only grow|cannot get bigger)/) // round 15, U12
    assert.ok(stuck.r.fixes.length >= 1, 'the size that fits is offered')
    tapsApply(stuck.r, tight, 'kitchen on the tight lot')
    // 4. more open
    const open = await send('Make it feel more open', roomy, '100 x 150')
    assert.deepEqual(open.diff.ops, [], 'Claude changes nothing on a guess')
    assert.equal(open.r.applied, false)
    assert.match(open.r.reply, /already one open space/)
    assert.ok(open.r.fixes.length >= 1)
    tapsApply(open.r, roomy, 'more open')
  } finally {
    for (const line of said) t.diagnostic(line)
  }
})

// The schema Claude answers in was rewritten for this item (one shape per op, no optional field), so the requests
// the old schema carried are checked too: each comes back as the op it always was, and the plan code takes it.
test('live Claude: the requests the chat already knew still come back as the same ops in the new schema', { skip, timeout: 300000 }, async (t) => {
  const { validateOps, normalizeOps } = await import('../src/draft/lib/ops.js')
  const interpreter = makeInterpreter({ env: { ...process.env, INTERPRET_TIMEOUT_MS: process.env.INTERPRET_TIMEOUT_MS || '45000' }, log: () => {} })
  const plan = draft(DEFAULT_PROGRAM, buildLot({ kind: 'manual', width: 100, depth: 150, city: 'mcallen', frontStreet: 'E Nolana Ave', setbacks: {} }))
  const kitchen = room(plan.rooms, 'kitchen')
  const cases = [
    ['add an office', (ops) => ops.length === 1 && ops[0].op === 'add' && ops[0].kind === 'office'],
    ['remove the half bath', (ops) => ops.length === 1 && ops[0].op === 'remove' && ops[0].room === 'halfbath'],
    ['make the kitchen 2 feet wider', (ops) => ops.length === 1 && ops[0].op === 'resize' && ops[0].room === 'kitchen' && Math.abs(ops[0].w - (kitchen.w + 2)) < 0.01 && Math.abs(ops[0].d - kitchen.d) < 0.01 && !ops[0].soft],
    ['make the garage 3 cars', (ops) => ops.length === 1 && ops[0].op === 'garage' && ops[0].cars === 3],
    ['make the garage side-load', (ops) => ops.length === 1 && ops[0].op === 'garage' && ops[0].load === 'side'],
    ['move the office next to the laundry', (ops) => ops.length === 1 && ops[0].op === 'moveBeside' && ops[0].room === 'office' && ops[0].target === 'laundry'],
    ['push the office 3 feet toward the street', (ops) => ops.length === 1 && ops[0].op === 'move' && ops[0].room === 'office' && ops[0].dy === 3 && ops[0].dx === 0],
    ['swap the office and the dining room', (ops) => ops.length === 1 && ops[0].op === 'swap' && [ops[0].room, ops[0].target].sort().join() === 'dining,office'],
    ['make the house 3,000 square feet', (ops) => ops.length === 1 && ops[0].op === 'scale' && ops[0].sqft === 3000],
    ['add a bedroom across the hall', (ops) => ops.length === 1 && ops[0].op === 'add' && ops[0].kind === 'bed' && ops[0].side === 'east'],
    ['how much will this house cost?', (ops, diff) => ops.length === 0 && !/\$\s?\d/.test(diff.reply)],
  ]
  const said = []
  const wrong = []
  try {
    for (const [text, right] of cases) {
      const diff = await interpreter.ask({ request: text, program: plan.program, kit: kitMeta, rooms: summarizeRooms(plan.rooms) })
      const ops = normalizeOps(diff.ops, plan.rooms)
      said.push(`"${text}" → ${JSON.stringify(diff.ops)} conf ${diff.confidence} in ${diff.ms} ms`)
      assert.ok(diff.ops.every((o) => Object.values(o).every((v) => v !== null)), `${text}: no null reaches the plan code`)
      assert.deepEqual(validateOps(ops, plan.rooms, kit).errors, [], text)
      if (!right(ops, diff)) wrong.push(`${text}: ${JSON.stringify(diff.ops)}`)
    }
    assert.deepEqual(wrong, [], 'each request comes back as the op it always was')
  } finally {
    for (const line of said) t.diagnostic(line)
  }
})
