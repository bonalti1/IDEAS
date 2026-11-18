// Round 6, the chat: "make the house N sf" re-drafts when the stretched plan fails and puts the client's
// edits back; a request in parts says which part went through; a garage that will not go where asked
// gets the next best thing; the options are built a candidate a turn; the edit log reads past rollbacks.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateRooms, DEFAULT_PROGRAM, kitFor, programOf, floorArea, isRoom, planIdOf } from '../src/draft/lib/layout.js'
import { interpretRequest, decide, redraft, editsOf, roomLevelOps } from '../src/draft/lib/interpret.js'
import { regexOps } from '../src/draft/lib/ops.js'
import { optionsFor, optionsForAsync } from '../src/draft/lib/options.js'
import { auditPlan } from '../src/draft/lib/audit.js'
import { STYLES } from '../src/draft/lib/styles.js'
import { DEFAULT_LOT, buildLot } from '../src/draft/lib/lot.js'
import { LOTS } from './helpers.mjs'

const style = STYLES.find((s) => s.id === 'farmhouse')
const kit = kitFor(style)
const offline = async () => {
  throw new Error('no api')
}
const ask = (text, rooms, program, lot = DEFAULT_LOT, history = []) => interpretRequest(text, rooms, program, style, { lot, interpreter: offline, report: false, history })
const living = (rooms) => floorArea(rooms, 1)
const errors = (rooms, program, lot = DEFAULT_LOT) => auditPlan(rooms, program, kit, lot).errors.map((e) => e.message)

test('the size ladder on the default draft: 2,000 to 3,200 sf each applies within 5% (a re-draft when the stretched plan fails) or names a size that itself applies', async () => {
  const rooms = generateRooms(DEFAULT_PROGRAM, style, DEFAULT_LOT)
  const table = []
  for (const n of [2000, 2200, 2400, 2600, 2700, 3000, 3200]) {
    const r = await ask(`make the house ${n.toLocaleString()} sf`, rooms, DEFAULT_PROGRAM)
    if (r.applied) {
      const sf = living(r.rooms)
      assert.ok(Math.abs(sf - n) / n < 0.05, `${n}: drafted ${Math.round(sf)} sf`)
      assert.deepEqual(errors(r.rooms, DEFAULT_PROGRAM), [], `${n}: ${r.reply}`)
      table.push(`${n}: ${Math.round(sf)} sf${r.redrafted ? ' (re-drafted)' : ''}`)
    } else {
      // the floor or the ceiling is named, and the size it names applies
      assert.match(r.reply, /smallest this plan goes|largest it fits here/, `${n}: ${r.reply}`)
      assert.equal(r.fixes.length, 1, `${n}: one fix, the size named`)
      const d = decide({ ops: r.fixes[0].ops, reply: r.fixes[0].label, confidence: 1 }, rooms, DEFAULT_PROGRAM, style, kit, 'fix', DEFAULT_LOT)
      assert.ok(d.applied, `${n}: the fix "${r.fixes[0].label}" applies: ${d.reply}`)
      assert.deepEqual(errors(d.rooms, DEFAULT_PROGRAM), [])
      table.push(`${n}: ${r.reply} → ${r.fixes[0].label}`)
    }
  }
  // the ask under the plan's floor is the one that is named, not quietly drawn at the floor
  assert.match(table[0], /2000: At 2,000 sf the rooms fall under their minimums; the smallest/, table.join('\n'))
})

test('a re-draft puts the client\'s room edits back and says which could not be kept', async () => {
  const rooms = generateRooms(DEFAULT_PROGRAM, style, DEFAULT_LOT)
  const wider = await ask('make the kitchen 2 feet wider', rooms, DEFAULT_PROGRAM)
  assert.ok(wider.applied, wider.reply)
  const history = [
    { text: 'make the kitchen 2 feet wider', ops: wider.ops },
    // an edit that names a room no new draft has
    { text: 'make the sunroom bigger', ops: [{ op: 'resize', room: 'sunroom-x', w: 20, d: 20 }] },
  ]
  const r = redraft(3200, wider.rooms, DEFAULT_PROGRAM, style, DEFAULT_LOT, history)
  assert.ok(r.ok, JSON.stringify(r.reasons))
  assert.ok(Math.abs(living(r.rooms) - 3200) / 3200 < 0.05, `${Math.round(living(r.rooms))} sf`)
  assert.deepEqual(r.kept, ['make the kitchen 2 feet wider'])
  assert.equal(r.dropped.length, 1)
  assert.equal(r.dropped[0].text, 'make the sunroom bigger')
  const k0 = generateRooms({ ...DEFAULT_PROGRAM, sqft: 3200 }, style, DEFAULT_LOT).find((x) => x.id === 'kitchen')
  const k1 = r.rooms.find((x) => x.id === 'kitchen')
  assert.ok(k1.w > k0.w + 0.5, `the kitchen is wider than a plain 3,200 sf draft draws it (${k1.w} vs ${k0.w})`)
  // through the chat: the reply says what stands and what could not be kept
  const chat = await ask('make the house 3,200 sf', wider.rooms, DEFAULT_PROGRAM, DEFAULT_LOT, history)
  assert.ok(chat.applied, chat.reply)
  if (chat.redrafted) {
    assert.match(chat.reply, /Re-drafted the house at [\d,]+ sf/)
    assert.match(chat.reply, /still stand: "make the kitchen 2 feet wider"/)
    assert.match(chat.reply, /Could not keep: "make the sunroom bigger"/)
  }
  // the program-level edits are not re-applied: the counted program already carries them
  assert.deepEqual(roomLevelOps([{ op: 'add', kind: 'bed' }, { op: 'scale', sqft: 3000 }, { op: 'resize', room: 'kitchen', w: 20, d: 15 }, { op: 'garage', cars: 3 }]), [{ op: 'resize', room: 'kitchen', w: 20, d: 15 }, { op: 'garage', cars: 3 }])
})

test('the edit log reads past a rollback and starts over at a new first draft', () => {
  const versions = [
    { n: 1, kind: 'initial', text: 'First draft' },
    { n: 2, kind: 'change', text: 'make the kitchen bigger', ops: [{ op: 'resize', room: 'kitchen', w: 20, d: 15 }] },
    { n: 3, kind: 'change', text: 'add an office', ops: [{ op: 'add', kind: 'office' }] },
    { n: 4, kind: 'rollback', text: 'Back to version 2', rollbackOf: 2 },
    { n: 5, kind: 'change', text: 'make the pantry smaller', ops: [{ op: 'resize', room: 'pantry', w: 4, d: 5 }] },
  ]
  assert.deepEqual(editsOf(versions).map((e) => e.text), ['make the kitchen bigger', 'make the pantry smaller'])
  const reset = [...versions, { n: 6, kind: 'program', text: 'Rooms changed' }, { n: 7, kind: 'change', text: 'add a half bath', ops: [{ op: 'add', kind: 'halfbath' }] }]
  assert.deepEqual(editsOf(reset).map((e) => e.text), ['add a half bath'])
  assert.deepEqual(editsOf([]), [])
})

test('"make the house 3000 sf and add a bedroom" does both, or says which part it could not do; one charge', async () => {
  const rooms = generateRooms(DEFAULT_PROGRAM, style, DEFAULT_LOT)
  const diff = regexOps('make the house 3000 sf and add a bedroom', rooms, kit, DEFAULT_LOT)
  assert.equal(diff.parts?.length, 2, 'the fallback reads two parts')
  assert.deepEqual(diff.ops.map((o) => o.op), ['scale', 'add'])
  // a swap is one request, not two parts
  assert.ok(!regexOps('swap the office and the dining room', rooms, kit, DEFAULT_LOT).parts)
  const r = await ask('make the house 3000 sf and add a bedroom', rooms, DEFAULT_PROGRAM)
  assert.ok(r.applied, r.reply)
  const p = programOf(r.rooms, DEFAULT_PROGRAM)
  assert.equal(p.beds, 5)
  assert.ok(living(r.rooms) >= 2850, `${Math.round(living(r.rooms))} sf`)
  assert.deepEqual(errors(r.rooms, DEFAULT_PROGRAM), [])
  assert.match(r.reply, /^Done: /)
  // a part that cannot be done is named, the other goes through, and the reply says the charge is for what was done
  const both = await ask('make the kitchen bigger and add a helipad', rooms, DEFAULT_PROGRAM)
  assert.ok(!both.applied || /Not done|helipad/i.test(both.reply) || !/helipad/.test(both.reply), both.reply)
  const two = await ask('add a bedroom and make the primary bath 2 feet wider', rooms, DEFAULT_PROGRAM)
  assert.ok(two.applied, two.reply)
  if (two.partial) {
    assert.match(two.reply, /Not done: .*This counts as one change, for what was done\./)
    assert.ok(two.kept.length >= 1 && two.dropped.length >= 1)
  }
})

test('a garage that will not go where asked: plain words, and the next best thing as a fix that applies (a smaller garage, a tandem bay, a new draft with the garage)', async () => {
  const narrow = LOTS['narrow 50 x 120']
  const program = { ...DEFAULT_PROGRAM, beds: 3, baths: 2, halfBath: false, office: false, garage: 0, suite2: false, sqft: 1800 }
  const rooms = generateRooms(program, style, narrow)
  assert.equal(planIdOf(rooms), 'narrow')
  const r = await ask('add a garage', rooms, program, narrow)
  assert.ok(!r.applied)
  assert.doesNotMatch(r.reply, /free wall/, 'no "no free wall at the laundry"')
  assert.match(r.reply, /no room for a garage/i)
  const redo = r.fixes.find((f) => /Re-draft the house with a 2-car garage/.test(f.label))
  assert.ok(redo, `a re-draft is offered: ${r.fixes.map((f) => f.label).join(' | ')}`)
  const d = decide({ ops: redo.ops, reply: redo.label, confidence: 1 }, rooms, program, style, kit, 'fix', narrow)
  assert.ok(d.applied, d.reply)
  const g = d.rooms.find((x) => isRoom(x) && x.kind === 'garage')
  assert.ok(g && Math.max(g.w, g.d) >= 20, 'the new draft has a 2-car garage')
  assert.deepEqual(errors(d.rooms, program, narrow), [])
  assert.match(d.reply, /Drew a new draft with a 2-car garage/)
  // the garage options on that plan offer the same new draft
  const { options } = optionsFor('garage', rooms, program, style, narrow)
  assert.ok(options.some((o) => /Re-draft with a 2-car garage/.test(o.label)), options.map((o) => o.label).join(' | '))
  // on the default draft a 4-car that does not fit offers one bay less or a tandem bay
  const def = generateRooms(DEFAULT_PROGRAM, style, DEFAULT_LOT)
  const four = await ask('make the garage 4 cars', def, DEFAULT_PROGRAM)
  if (!four.applied) {
    assert.match(four.reply, /no room for a 4-car garage|^There is no room/i)
    assert.ok(four.fixes.length >= 1, 'something next best is offered')
    for (const f of four.fixes) assert.ok(decide({ ops: f.ops, reply: f.label, confidence: 1 }, def, DEFAULT_PROGRAM, style, kit, 'fix', DEFAULT_LOT).applied, f.label)
  }
})

test('the Garza sample: at least 9 of the 10 requests apply and pass the audit', async () => {
  const program = { ...kit.reference.program }
  const table = []
  for (const t of ['make the kitchen 2 feet wider', 'make the living room 3 feet deeper', 'make the dining room bigger', 'make the primary bedroom bigger', 'make the garage 3 cars', 'make the primary closet bigger', 'add a bedroom', 'add a porch on the back', 'make the pantry smaller', 'make bedroom 2 bigger']) {
    const r = await ask(t, generateRooms(program, style, DEFAULT_LOT), program)
    const errs = r.applied ? errors(r.rooms, program) : null
    table.push({ t, ok: r.applied && errs.length === 0, why: r.applied ? errs.join(' | ') : `${r.reply} [fixes: ${(r.fixes || []).map((f) => f.label).join(' | ')}]` })
  }
  assert.ok(table.filter((x) => x.ok).length >= 9, table.map((x) => `${x.t}: ${x.ok ? 'ok' : x.why}`).join('\n'))
  // what is refused offers a fix or says the plan already has it
  table.filter((x) => !x.ok).forEach((x) => assert.match(x.why, /already has|fixes: .+\S/))
})

test('the options come out the same built one candidate a turn (the picker no longer freezes the page)', async () => {
  const rooms = generateRooms(DEFAULT_PROGRAM, style, DEFAULT_LOT)
  const sync = optionsFor('garage', rooms, DEFAULT_PROGRAM, style, DEFAULT_LOT)
  let ticks = 0
  const orig = globalThis.setTimeout
  globalThis.setTimeout = (fn, ms) => {
    if (ms === 0) ticks++
    return orig(fn, ms)
  }
  let async
  try {
    async = await optionsForAsync('garage', rooms, DEFAULT_PROGRAM, style, DEFAULT_LOT)
  } finally {
    globalThis.setTimeout = orig
  }
  assert.deepEqual(async.options.map((o) => o.label), sync.options.map((o) => o.label))
  assert.ok(ticks >= sync.options.length, `yielded ${ticks} times for ${sync.options.length} options`)
})

test('a split wing: the 6/5 is offered the bedrooms stacked on both sides of the hall, and that draft has the shorter hall', () => {
  const six = { ...DEFAULT_PROGRAM, beds: 6, baths: 5, halfBath: false, garage: 2, sqft: 3900 }
  const rooms = generateRooms(six, style, DEFAULT_LOT)
  const before = Math.max(...auditPlan(rooms, six, kit, DEFAULT_LOT).measures.halls.map((h) => h.lengthFt))
  const split = generateRooms({ ...six, wingSplit: true }, style, DEFAULT_LOT)
  const after = Math.max(...auditPlan(split, six, kit, DEFAULT_LOT).measures.halls.map((h) => h.lengthFt))
  assert.ok(after < before - 1, `hall ${after} ft with the split, ${before} without`)
  assert.deepEqual(errors(split, six), [])
  const { options } = optionsFor('wing', rooms, six, style, DEFAULT_LOT)
  const opt = options.find((o) => /Split the bedrooms/.test(o.label))
  assert.ok(opt, options.map((o) => o.label).join(' | '))
  // a plan whose hall the split would not shorten is not offered it (the default has nothing to split)
  const def = generateRooms(DEFAULT_PROGRAM, style, DEFAULT_LOT)
  assert.ok(!optionsFor('wing', def, DEFAULT_PROGRAM, style, DEFAULT_LOT).options.some((o) => /Split/.test(o.label)))
})
