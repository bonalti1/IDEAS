// "Show me options": two or three sound options for the garage, the porches and the bedroom wing on
// the default draft and on the Garza sample, each passing the rules and the audit, each with its area
// and price change, each made of ops a pick sends as one ordinary change.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { optionsFor, optionTopic, OPTION_TOPICS } from '../src/draft/lib/options.js'
import { generateRooms, DEFAULT_PROGRAM, kitFor, isRoom } from '../src/draft/lib/layout.js'
import { auditPlan } from '../src/draft/lib/audit.js'
import { interpretRequest } from '../src/draft/lib/interpret.js'
import { STYLES } from '../src/draft/lib/styles.js'
import { DEFAULT_LOT } from '../src/draft/lib/lot.js'

const style = STYLES.find((s) => s.id === 'farmhouse')
const kit = kitFor(style)

test('the words that ask for options', () => {
  assert.equal(optionTopic('show me options for the garage'), 'garage')
  assert.equal(optionTopic('what are my choices for the porch?'), 'porch')
  assert.equal(optionTopic('bedroom wing options'), 'wing')
  assert.equal(optionTopic('make the garage 3 cars'), null)
  assert.equal(optionTopic('show me the plan'), null)
})

for (const [name, program] of [['the default draft', DEFAULT_PROGRAM], ['the Garza sample', { ...kit.reference.program }]]) {
  for (const topic of OPTION_TOPICS) {
    test(`options for ${topic} on ${name}: at least two, every one passes the audit, with ops and deltas`, async () => {
      const rooms = generateRooms(program, style, DEFAULT_LOT)
      const { options } = optionsFor(topic, rooms, program, style, DEFAULT_LOT)
      assert.ok(options.length >= 2 && options.length <= 4, `${options.length} options: ${options.map((o) => o.label).join(', ')}`)
      for (const o of options) {
        assert.deepEqual(auditPlan(o.rooms, program, kit, DEFAULT_LOT).errors.map((e) => e.message), [], o.label)
        assert.ok(o.ops.length >= 1 && typeof o.sf === 'number' && typeof o.cost === 'number' && o.svg.startsWith('<svg'), o.label)
        assert.ok(o.rooms.filter(isRoom).length >= 10)
        // picking it is one ordinary change with these ops, and lands on the same plan
        const picked = await interpretRequest(o.label, rooms, program, style, { lot: DEFAULT_LOT, interpreter: async () => ({ ops: o.ops, reply: o.label, confidence: 1 }), report: false })
        assert.equal(picked.applied, true, `${o.label}: ${picked.reply}`)
        assert.equal(picked.rooms.filter(isRoom).length, o.rooms.filter(isRoom).length)
      }
      const labels = options.map((o) => o.label)
      assert.equal(new Set(labels).size, labels.length, 'no two options alike')
    })
  }
}

// Round 5: real design variants (the way the garage loads, a tandem third bay, the porch depth, the next
// bedroom in line or across the hall), and the chat phrases that used to fall through
test('the garage options offer a side-load and a tandem third bay where the lot takes them, not only fewer cars', () => {
  const rooms = generateRooms(DEFAULT_PROGRAM, style, DEFAULT_LOT)
  const { options } = optionsFor('garage', rooms, DEFAULT_PROGRAM, style, DEFAULT_LOT)
  const labels = options.map((o) => o.label)
  assert.ok(labels.some((l) => /side-load/.test(l)), `a side-load: ${labels.join(', ')}`)
  assert.ok(labels.some((l) => /tandem/.test(l)), `a tandem: ${labels.join(', ')}`)
  const tandem = options.find((o) => /tandem/.test(o.label))
  const g = tandem.rooms.find((r) => isRoom(r) && r.kind === 'garage')
  assert.ok(g.tandem && Math.max(g.w, g.d) >= 40, `${g.w} x ${g.d}`)
})

test('the wing options offer the next bedroom in line or across the hall, and both pass', () => {
  const rooms = generateRooms(DEFAULT_PROGRAM, style, DEFAULT_LOT)
  const { options } = optionsFor('wing', rooms, DEFAULT_PROGRAM, style, DEFAULT_LOT)
  const labels = options.map((o) => o.label)
  assert.ok(labels.some((l) => /in line/.test(l)) && labels.some((l) => /across the hall/.test(l)), labels.join(', '))
  const across = options.find((o) => /bedroom, across/.test(o.label))
  const hall = across.rooms.find((r) => r.id === 'hall')
  const bed = across.rooms.filter((r) => isRoom(r) && r.kind === 'bed').sort((a, b) => b.local[0] - a.local[0])[0]
  assert.ok(bed.local[0] > hall.local[0], 'the new bedroom lies east of the hall')
})

test('typed in chat: "make the house 3,000 sf" scales the plan, "swap the office and the dining room" is a swap, "show me options for the garage" opens the picker', async () => {
  const rooms = generateRooms(DEFAULT_PROGRAM, style, DEFAULT_LOT)
  const offline = async () => { throw new Error('offline') }
  const scaled = await interpretRequest('make the house 3,000 sf', rooms, DEFAULT_PROGRAM, style, { lot: DEFAULT_LOT, interpreter: offline, report: false })
  assert.equal(scaled.applied, true, scaled.reply)
  assert.equal(scaled.ops[0].op, 'scale')
  const sf = scaled.rooms.filter((r) => isRoom(r) && !r.open && r.kind !== 'garage').reduce((a, r) => a + r.w * r.d, 0)
  assert.ok(Math.abs(sf - 3000) / 3000 < 0.05, `${Math.round(sf)} sf`)
  const swapped = await interpretRequest('swap the office and the dining room', rooms, DEFAULT_PROGRAM, style, { lot: DEFAULT_LOT, interpreter: offline, report: false })
  assert.equal(swapped.ops[0]?.op, 'swap', swapped.reply)
  assert.ok(!/which room|tell me what to do/i.test(swapped.reply), swapped.reply)
  // two bedrooms of a size trade places and the plan still passes
  const beds = rooms.filter((r) => isRoom(r) && r.kind === 'bed')
  const two = await interpretRequest(`swap ${beds[0].name} and ${beds[1].name}`, rooms, DEFAULT_PROGRAM, style, { lot: DEFAULT_LOT, interpreter: offline, report: false })
  assert.equal(two.applied, true, two.reply)
  assert.equal(optionTopic('show me options for the garage'), 'garage')
  assert.equal(optionTopic('what are my choices for the porch'), 'porch')
})

test('"swap the office and the dining room" on the default draft applies: the dining room grows to its 9 by 9 minimum in the office\'s spot', async () => {
  const rooms = generateRooms(DEFAULT_PROGRAM, style, DEFAULT_LOT)
  const offline = async () => {
    throw new Error('no api')
  }
  const r = await interpretRequest('swap the office and the dining room', rooms, DEFAULT_PROGRAM, style, { lot: DEFAULT_LOT, interpreter: offline, report: false })
  assert.ok(r.applied, r.reply)
  const dining = r.rooms.find((x) => isRoom(x) && x.kind === 'dining')
  const office = r.rooms.find((x) => isRoom(x) && x.kind === 'office')
  assert.ok(dining && office, 'both rooms are still there')
  assert.ok(Math.min(dining.w, dining.d) >= 9 - 0.01, `the dining room is ${dining.w} by ${dining.d}`)
  assert.ok(r.ops.some((o) => o.op === 'resize' && o.room === dining.id), 'the swap carried a resize to the minimum')
  const a = auditPlan(r.rooms, DEFAULT_PROGRAM, kit, DEFAULT_LOT)
  assert.equal(a.errors.length, 0, a.errors.map((e) => e.message).join(' / '))
})

test('on a lot the plan already fills, "make the house 3,000 sf" names the largest size and offers no fix that would fail; the same size is "already there", not a refusal over a snapped wall', async () => {
  const { buildLot } = await import('../src/draft/lib/lot.js')
  const { decide } = await import('../src/draft/lib/interpret.js')
  const offline = async () => {
    throw new Error('no api')
  }
  const mcallen = buildLot({ kind: 'manual', width: 100, depth: 150, city: 'mcallen', frontStreet: 'E Nolana Ave', setbacks: {} })
  const program = { ...DEFAULT_PROGRAM, sqft: 2350 }
  const rooms = generateRooms(program, style, mcallen)
  const r = await interpretRequest('make the house 3,000 sf', rooms, program, style, { lot: mcallen, interpreter: offline, report: false })
  assert.ok(!r.applied && /largest it fits here/.test(r.reply), r.reply)
  for (const f of r.fixes || []) {
    const d = decide({ ops: f.ops, reply: f.label, confidence: 1 }, rooms, program, style, kit, 'fix', mcallen)
    assert.ok(d.applied, `the offered fix "${f.label}" must apply: ${d.reply}`)
  }
  const same = await interpretRequest('make the house 2,350 sf', rooms, program, style, { lot: mcallen, interpreter: offline, report: false })
  assert.ok(!same.applied && /already about/.test(same.reply), same.reply)
})
