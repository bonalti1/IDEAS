// The chat requests an architect expects to work: adds build real rooms (door from the house, window,
// fixtures, roof), resizes push walls, and the plan passes the audit after each one.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateRooms, DEFAULT_PROGRAM, kitFor, isRoom } from '../src/draft/lib/layout.js'
import { interpretRequest } from '../src/draft/lib/interpret.js'
import { auditPlan } from '../src/draft/lib/audit.js'
import { STYLES } from '../src/draft/lib/styles.js'
import { DEFAULT_LOT } from '../src/draft/lib/lot.js'

const style = STYLES.find((s) => s.id === 'farmhouse')
const kit = kitFor(style)
const offline = async () => {
  throw new Error('no api')
}
const ask = (text, rooms, program) => interpretRequest(text, rooms, program, style, { interpreter: offline })
const errors = (rooms, program) => auditPlan(rooms, program, kit, DEFAULT_LOT).errors.map((e) => e.message)
const byKind = (rooms, kind) => rooms.filter((r) => isRoom(r) && r.kind === kind)

test('adds on the default draft: bedroom, rear porch, office, full bath, half bath by the laundry; each passes the audit', async () => {
  const program = { ...DEFAULT_PROGRAM }
  const fresh = () => generateRooms(program, style, DEFAULT_LOT)
  const bed = await ask('add a bedroom', fresh(), program)
  assert.equal(bed.applied, true, bed.reply)
  assert.equal(byKind(bed.rooms, 'bed').length, byKind(fresh(), 'bed').length + 1)
  const newBed = byKind(bed.rooms, 'bed').find((r) => !byKind(fresh(), 'bed').some((o) => o.id === r.id))
  assert.ok(bed.rooms.some((e) => e.kind === 'window' && e.room === newBed.id), 'the new bedroom has a window')
  assert.ok(bed.rooms.some((r) => isRoom(r) && r.kind === 'wic' && Math.abs(r.x - newBed.x) < 0.1 && r.w * r.d >= 10), 'and a closet at least 2 by 5')
  assert.deepEqual(errors(bed.rooms, program), [])

  const porch = await ask('add a porch on the back', fresh(), program)
  assert.equal(porch.applied, true, porch.reply)
  const rp = byKind(porch.rooms, 'rearPorch')
  assert.equal(rp.length, 1)
  assert.ok(rp[0].d >= 8, `rear porch ${rp[0].d} ft deep`)
  const solid = porch.rooms.filter((r) => isRoom(r) && !r.open)
  assert.ok(solid.every((r) => r.y + r.d <= rp[0].y + 0.6 || r.y >= rp[0].y + rp[0].d - 0.6 || r.x + r.w <= rp[0].x + 0.6 || r.x >= rp[0].x + rp[0].w - 0.6), 'the porch is on the rear wall, over no room')
  assert.deepEqual(errors(porch.rooms, program), [])
  const twice = await ask('add a porch on the back', porch.rooms, program)
  assert.equal(twice.applied, false, 'never twice')

  const office = await ask('add an office', fresh(), program)
  assert.equal(office.applied, true, office.reply)
  assert.deepEqual(errors(office.rooms, program), [])

  const bath = await ask('add a full bath', fresh(), program)
  assert.equal(bath.applied, true, bath.reply)
  const newBath = byKind(bath.rooms, 'bath').find((r) => !byKind(fresh(), 'bath').some((o) => o.id === r.id))
  const fx = bath.rooms.filter((e) => e.kind === 'fixture' && e.room === newBath.id).map((e) => e.fixture)
  assert.ok(fx.includes('toilet') && fx.includes('vanity') && (fx.includes('shower') || fx.includes('tub')), `fixtures ${fx}`)
  assert.deepEqual(errors(bath.rooms, program), [])

  const half = await ask('add a half bath next to the laundry', fresh(), program)
  assert.equal(half.applied, true, half.reply)
  const laundry = byKind(half.rooms, 'laundry')[0]
  const hb = byKind(half.rooms, 'halfbath').find((r) => !byKind(fresh(), 'halfbath').some((o) => o.id === r.id))
  const touching = Math.abs(hb.x - (laundry.x + laundry.w)) < 1 || Math.abs(laundry.x - (hb.x + hb.w)) < 1 || Math.abs(hb.y - (laundry.y + laundry.d)) < 1 || Math.abs(laundry.y - (hb.y + hb.d)) < 1
  assert.ok(touching, 'the half bath touches the laundry')
  assert.deepEqual(errors(half.rooms, program), [])
})

test('"move the laundry next to the garage" moves it, or says it is already there', async () => {
  const program = { ...DEFAULT_PROGRAM }
  const res = await ask('move the laundry next to the garage', generateRooms(program, style, DEFAULT_LOT), program)
  assert.equal(res.applied, false)
  assert.match(res.reply, /already next to/)
  // the subject is the room named first: "move the office next to the laundry" moves the office
  const office = await ask('move the office next to the laundry', generateRooms(program, style, DEFAULT_LOT), program)
  assert.equal(office.applied, true, office.reply)
  const o = byKind(office.rooms, 'office')[0]
  const l = byKind(office.rooms, 'laundry')[0]
  assert.ok(Math.abs(o.x - (l.x + l.w)) < 1 || Math.abs(l.x - (o.x + o.w)) < 1 || Math.abs(o.y - (l.y + l.d)) < 1 || Math.abs(l.y - (o.y + o.d)) < 1, 'the office touches the laundry')
  assert.deepEqual(errors(office.rooms, program), [])
})

test('five resizes in a row on the default draft all apply and the plan still passes the audit', async () => {
  const program = { ...DEFAULT_PROGRAM }
  let rooms = generateRooms(program, style, DEFAULT_LOT)
  const before = Object.fromEntries(rooms.filter(isRoom).map((r) => [r.id, { w: r.w, d: r.d }]))
  for (const t of ['make the kitchen 2 feet wider', 'make the living room 3 feet deeper', 'make the dining room bigger', 'make the primary bedroom bigger', 'make the garage 3 cars']) {
    const r = await ask(t, rooms, program)
    assert.equal(r.applied, true, `${t}: ${r.reply} ${(r.reasons || []).join(' | ')}`)
    rooms = r.rooms
  }
  const after = Object.fromEntries(rooms.filter(isRoom).map((r) => [r.id, r]))
  assert.ok(Math.abs(after.kitchen.w - before.kitchen.w - 2) < 0.01, 'kitchen 2 ft wider')
  assert.ok(Math.abs(after.living.d - before.living.d - 3) < 0.01, 'living 3 ft deeper')
  assert.ok(after.dining.w * after.dining.d > before.dining.w * before.dining.d, 'dining bigger')
  assert.ok(after.master.w * after.master.d > before.master.w * before.master.d, 'primary bigger')
  assert.ok(after.garage.w >= 32 && after.garage.d >= 22, `3-car garage ${after.garage.w} x ${after.garage.d}`)
  assert.deepEqual(errors(rooms, program), [])
})

test('on the reference lot, at least 9 of the 10 requests apply and pass the audit', async () => {
  const program = { ...kit.reference.program }
  const table = []
  for (const t of ['make the kitchen 2 feet wider', 'make the living room 3 feet deeper', 'make the dining room bigger', 'make the primary bedroom bigger', 'make the garage 3 cars', 'make the primary closet bigger', 'add a bedroom', 'add a porch on the back', 'make the pantry smaller', 'make bedroom 2 bigger']) {
    const r = await ask(t, generateRooms(program, style, DEFAULT_LOT), program)
    const errs = r.applied ? errors(r.rooms, program) : null
    table.push({ t, ok: r.applied && errs.length === 0, why: r.applied ? errs.join(' | ') : r.reply })
  }
  const passed = table.filter((x) => x.ok)
  assert.ok(passed.length >= 9, table.map((x) => `${x.t}: ${x.ok ? 'ok' : x.why}`).join('\n'))
  // the one that may not: the sample already has a rear porch, and the app says so rather than adding a second
  table.filter((x) => !x.ok).forEach((x) => assert.match(x.why, /already has a rear porch/))
})

test('a resize is refused only for a setback, a cover or a minimum size, and says which', async () => {
  const program = { ...DEFAULT_PROGRAM }
  const fresh = () => generateRooms(program, style, DEFAULT_LOT)
  let rooms = fresh()
  let last
  for (let i = 0; i < 12; i++) {
    last = await ask('make the pantry smaller', rooms, program)
    if (!last.applied) break
    rooms = last.rooms
  }
  assert.equal(last.applied, false)
  assert.match(last.reply, /minimum|too small/)
})
