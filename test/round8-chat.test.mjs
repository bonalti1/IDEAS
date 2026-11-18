// Round 8: the chat reads a request the way a client writes it and answers in plain words: commas inside
// numbers, clauses it did not understand, parts this style cannot take, rooms that do not exist, sizes
// below zero or past the kit, "add 10 bedrooms", a fix tap that says what it did, the floor said once.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateRooms, DEFAULT_PROGRAM, kitFor, programOf, floorArea, isRoom } from '../src/draft/lib/layout.js'
import { interpretRequest, decide, dropUnsupported } from '../src/draft/lib/interpret.js'
import { regexOps, splitClauses, validateOps } from '../src/draft/lib/ops.js'
import { auditPlan } from '../src/draft/lib/audit.js'
import { STYLES } from '../src/draft/lib/styles.js'
import { DEFAULT_LOT } from '../src/draft/lib/lot.js'

const style = STYLES.find((s) => s.id === 'farmhouse')
const kit = kitFor(style)
const offline = async () => {
  throw new Error('no api')
}
const ask = (text, rooms, program = DEFAULT_PROGRAM, lot = DEFAULT_LOT) => interpretRequest(text, rooms, program, style, { lot, interpreter: offline, report: false })
const errors = (rooms, program = DEFAULT_PROGRAM) => auditPlan(rooms, program, kit, DEFAULT_LOT).errors.map((e) => e.message)

test('commas inside numbers do not split a request: "make the house 2,500 sf; add an office; remove the half bath" is three parts and all three go through', async () => {
  assert.deepEqual(splitClauses('make the house 2,500 sf; add an office; remove the half bath'), ['make the house 2,500 sf', 'add an office', 'remove the half bath'])
  assert.deepEqual(splitClauses('make the house 2,500 sf, add an office'), ['make the house 2,500 sf', 'add an office'])
  assert.deepEqual(splitClauses('swap the office and the dining room'), ['swap the office and the dining room'])
  const rooms = generateRooms(DEFAULT_PROGRAM, style, DEFAULT_LOT)
  const diff = regexOps('make the house 2,500 sf; add an office; remove the half bath', rooms, kit, DEFAULT_LOT)
  assert.deepEqual(diff.ops.map((o) => o.op), ['scale', 'add', 'remove'])
  assert.equal(diff.ops[0].sqft, 2500)
  const r = await ask('make the house 2,500 sf; add an office; remove the half bath', rooms)
  assert.ok(r.applied, r.reply)
  assert.doesNotMatch(r.reply, /op 1|needs sqft/)
  const p = programOf(r.rooms, DEFAULT_PROGRAM)
  assert.equal(p.halfBath, false)
  assert.equal(r.rooms.filter((x) => isRoom(x) && x.kind === 'office').length, 2)
})

test('a clause that is not understood is named, and "it" means the room of the clause before', async () => {
  const rooms = generateRooms(DEFAULT_PROGRAM, style, DEFAULT_LOT)
  const diff = regexOps('make the kitchen bigger and then make it smaller', rooms, kit, DEFAULT_LOT)
  assert.equal(diff.parts?.length, 2, JSON.stringify(diff))
  assert.ok(diff.ops.every((o) => o.room === 'kitchen'))
  const r = await ask('make the kitchen bigger and then frobnicate the thing', rooms)
  assert.ok(r.applied, r.reply)
  assert.match(r.reply, /I didn't do: "frobnicate the thing"/)
  assert.match(r.reply, /counts once, for what was done/)
})

test('one unsupported part does not kill the request: the supported parts go through and the rest is named; all unsupported is refused plainly', async () => {
  const rooms = generateRooms(DEFAULT_PROGRAM, style, DEFAULT_LOT)
  const split = dropUnsupported('make the kitchen bigger, add a pool and remove the office', style)
  assert.equal(split.text, 'make the kitchen bigger; remove the office')
  assert.equal(split.dropped.length, 1)
  assert.match(split.dropped[0].why, /not something this plan can hold/)
  const r = await ask('make the kitchen bigger, add a pool and remove the office', rooms)
  assert.ok(r.applied, r.reply)
  assert.ok(!r.rooms.some((x) => isRoom(x) && x.kind === 'office'), 'the office is gone')
  assert.match(r.reply, /I didn't do: "add a pool"/)
  const two = await ask('add a second story and make the garage 3 cars', rooms)
  assert.ok(two.applied, two.reply)
  assert.equal(programOf(two.rooms, DEFAULT_PROGRAM).garage, 3)
  assert.match(two.reply, /second story/)
  const none = await ask('add a pool', rooms)
  assert.ok(!none.applied && none.unsupported)
})

test('a room called by a number it does not have is refused, and names match whole words', async () => {
  const five = generateRooms({ ...DEFAULT_PROGRAM, beds: 5 }, style, DEFAULT_LOT)
  const r = await ask('make bedroom 7 bigger', five)
  assert.ok(!r.applied)
  assert.match(r.reply, /There is no Bedroom 7; this plan has Bedrooms 1–4/)
  const one = await ask('make bedroom 1 bigger', five)
  assert.ok(one.applied, one.reply)
  assert.equal(one.ops[0].room, five.find((x) => x.name === 'Bedroom 1').id)
  const d = regexOps('make bedroom 12 bigger', five, kit, DEFAULT_LOT)
  assert.deepEqual(d.ops, [], 'bedroom 12 is not bedroom 1')
})

test('validator errors are sentences; bad keys and kinds are refused; no TypeError text reaches a client', () => {
  const rooms = generateRooms(DEFAULT_PROGRAM, style, DEFAULT_LOT)
  const v = validateOps([{ op: 'garage', cars: 9 }, { op: 'scale' }, { op: 'resize', room: 'kitchen' }], rooms, kit)
  assert.deepEqual(v.errors, ['A garage can hold 1 to 4 cars.', 'Give a size between 600 and 10,000 sf.', 'A resize needs a width and a depth in feet.'])
  for (const ops of [[{ op: 'add', kind: '__proto__' }], [{ op: 'add', kind: 'constructor' }], [JSON.parse('{"op":"resize","room":"kitchen","w":10,"d":10,"__proto__":{"x":1}}')], [{ op: 'redraft', program: JSON.parse('{"__proto__":{"garage":9}}') }]]) {
    const d = decide({ ops, reply: '', confidence: 1 }, rooms, DEFAULT_PROGRAM, style, kit, 'fix', DEFAULT_LOT)
    assert.ok(!d.applied)
    assert.doesNotMatch(JSON.stringify(d), /Cannot read|TypeError|undefined/)
    assert.doesNotMatch(d.reply, /^op \d/)
  }
  const d = decide({ ops: [{ op: 'garage', cars: 9 }], reply: '', confidence: 1 }, rooms, DEFAULT_PROGRAM, style, kit, 'fix', DEFAULT_LOT)
  assert.equal(d.reply, 'A garage can hold 1 to 4 cars.')
})

test('a size below zero is unclear, not 2,000 sf', async () => {
  const rooms = generateRooms(DEFAULT_PROGRAM, style, DEFAULT_LOT)
  const r = await ask('make the house -2,000 sf', rooms)
  assert.ok(!r.applied)
  assert.match(r.reply, /below zero/)
  assert.deepEqual(r.ops, [])
})

test('a resize past the kit\'s largest for the room is out of range, with the largest as the fix; fix offers never go past it', async () => {
  const rooms = generateRooms(DEFAULT_PROGRAM, style, DEFAULT_LOT)
  const r = await ask('make the kitchen 200 feet wider', rooms)
  assert.ok(!r.applied)
  assert.match(r.reply, /The kitchen in this kit goes up to 2\d' by \d+'/)
  for (const f of r.fixes) {
    assert.ok(f.ops.every((o) => o.op !== 'resize' || (o.w <= 24 && o.d <= 24)), f.label)
    const d = decide({ ops: f.ops, reply: '', confidence: 1 }, rooms, DEFAULT_PROGRAM, style, kit, 'fix', DEFAULT_LOT)
    assert.ok(d.applied, `${f.label}: ${d.reply}`)
  }
})

test('"add 10 bedrooms" is capped with plain words; "add 2 bedrooms" adds two', async () => {
  const rooms = generateRooms(DEFAULT_PROGRAM, style, DEFAULT_LOT)
  const t0 = performance.now()
  const r = await ask('add 10 bedrooms', rooms)
  assert.ok(performance.now() - t0 < 1500, 'answers at once')
  assert.ok(!r.applied)
  assert.match(r.reply, /This plan holds up to 6 bedrooms on this lot; it has 4\. Ask for 2 more at most\./)
  const two = await ask('add 2 bedrooms', rooms)
  assert.ok(two.applied, two.reply)
  assert.equal(programOf(two.rooms, DEFAULT_PROGRAM).beds, 6)
})

test('the floor is said once and the numbers agree: 2,000 names 2,300; 2,200 says the floor and what was drawn', async () => {
  const rooms = generateRooms(DEFAULT_PROGRAM, style, DEFAULT_LOT)
  const low = await ask('make the house 2,000 sf', rooms)
  assert.ok(!low.applied)
  const m = low.reply.match(/smallest this plan goes with these rooms is about ([\d,]+) sf/)
  assert.ok(m, low.reply)
  assert.equal((low.reply.match(/\d[\d,]{2,} sf/g) || []).length, 2, `one asked size and one floor: ${low.reply}`)
  const floor = +m[1].replace(/,/g, '')
  const near = await ask('make the house 2,200 sf', rooms)
  assert.ok(near.applied, near.reply)
  assert.match(near.reply, /^The smallest this house goes is about [\d,]+ sf; I drew it at [\d,]+\./)
  const said = +near.reply.match(/about ([\d,]+) sf/)[1].replace(/,/g, '')
  assert.ok(Math.abs(said - floor) <= 50, `the two floors agree: ${said} vs ${floor}`)
  assert.doesNotMatch(near.reply, /smallest.*smallest/s)
  assert.deepEqual(errors(near.rooms), [])
})

test('a fix tap answers with what was done, not the button\'s question', () => {
  const rooms = generateRooms(DEFAULT_PROGRAM, style, DEFAULT_LOT)
  const d = decide({ ops: [{ op: 'garage', cars: 3 }], reply: '', confidence: 1 }, rooms, DEFAULT_PROGRAM, style, kit, 'fix', DEFAULT_LOT)
  assert.ok(d.applied, d.reply)
  assert.match(d.reply, /^Added a 3-car garage/)
  assert.doesNotMatch(d.reply, /\?/)
})
