// Ten common requests through the change interpreter, with the Claude call
// stubbed (offline fallback and a fake Claude), plus the rules that reject.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateRooms, isRoom } from '../src/draft/lib/layout.js'
import { interpretRequest } from '../src/draft/lib/interpret.js'
import { regexOps, applyOps, validateOps } from '../src/draft/lib/ops.js'
import { checkRules } from '../src/draft/lib/rules.js'
import { STYLES } from '../src/draft/lib/styles.js'
import { KIT } from '../src/kits/modern-farmhouse.js'

const style = STYLES.find((s) => s.id === 'farmhouse')
const program = { ...KIT.reference.program }
const fresh = () => generateRooms(program, style)
const offline = async () => {
  throw new Error('no api')
}
const byId = (rooms, id) => rooms.find((r) => r.id === id)
const ask = (text, rooms = fresh(), interpreter = offline) => interpretRequest(text, rooms, program, style, { interpreter })

test('the reference plan passes every rule', () => {
  const r = checkRules(fresh(), program, style)
  assert.deepEqual(r.reasons, [])
})

test('1. bigger kitchen', async () => {
  const before = byId(fresh(), 'kitchen')
  const res = await ask('make the kitchen bigger')
  assert.equal(res.applied, true, res.reply)
  assert.equal(res.source, 'fallback')
  const k = byId(res.rooms, 'kitchen')
  assert.ok(k.w > before.w && k.d > before.d)
  // the island and counters came along and stayed inside
  res.rooms.filter((e) => e.kind === 'fixture' && e.room === 'kitchen').forEach((f) => {
    assert.ok(f.x >= k.x - 0.01 && f.x + f.w <= k.x + k.w + 0.01, `${f.name} left the kitchen`)
  })
})

test('2. add an office', async () => {
  const res = await ask('add an office')
  assert.equal(res.applied, true, res.reply)
  const offices = res.rooms.filter((r) => isRoom(r) && r.kind === 'office')
  assert.equal(offices.length, 2)
  const added = offices[1]
  assert.ok(res.rooms.some((e) => e.kind === 'door' && e.room === added.id), 'new office has a door')
  assert.ok(res.rooms.some((e) => e.kind === 'window' && e.room === added.id), 'new office has a window')
})

test('3. remove the half bath', async () => {
  const res = await ask('remove the half bath')
  assert.equal(res.applied, true, res.reply)
  assert.ok(!byId(res.rooms, 'halfbath'))
  assert.ok(!res.rooms.some((e) => e.room === 'halfbath'), 'its fixtures and door are gone')
})

test('4. make the master closet bigger', async () => {
  const before = byId(fresh(), 'mwic')
  const res = await ask('make the master closet bigger')
  assert.equal(res.applied, true, res.reply)
  const c = byId(res.rooms, 'mwic')
  assert.ok(c.w > before.w)
  const door = res.rooms.find((e) => e.kind === 'door' && e.room === 'mwic')
  assert.ok(door, 'closet door still there')
})

test('5. add a bedroom gets an egress window and passes', async () => {
  const res = await ask('add a bedroom')
  assert.equal(res.applied, true, res.reply)
  const beds = res.rooms.filter((r) => isRoom(r) && r.kind === 'bed')
  assert.equal(beds.length, 3)
  assert.ok(res.rooms.some((e) => e.kind === 'window' && e.room === beds[2].id))
})

test('6. bigger primary bath moves its fixtures with it', async () => {
  const before = fresh()
  const shower0 = before.find((e) => e.kind === 'fixture' && e.fixture === 'shower' && e.room === 'mbath')
  const res = await ask('bigger primary bath')
  assert.equal(res.applied, true, res.reply)
  const shower = res.rooms.find((e) => e.kind === 'fixture' && e.fixture === 'shower' && e.room === 'mbath')
  assert.notDeepEqual(shower.local, shower0.local, 'shower moved with the room')
})

test('7. remove the rear porch', async () => {
  const res = await ask('remove the rear porch')
  assert.equal(res.applied, true, res.reply)
  assert.ok(!byId(res.rooms, 'rearPorch'))
})

test('8. shrinking a bedroom below the minimum is rejected', async () => {
  let rooms = fresh()
  // three "smaller" steps take Bedroom 2 from 12.5 ft under the 10 ft minimum
  let last
  for (let i = 0; i < 4; i++) {
    last = await ask('make bedroom 2 smaller', rooms)
    if (!last.applied) break
    rooms = last.rooms
  }
  assert.equal(last.applied, false)
  assert.match(last.reply, /minimum|70 square feet/)
})

test('9. removing the kitchen is rejected', async () => {
  const res = await ask('remove the kitchen')
  assert.equal(res.applied, false)
  assert.match(res.reply, /needs a kitchen/i)
})

test('10. a move toward the street past the setback is rejected (fake Claude diff)', async () => {
  const fake = async () => ({ ops: [{ op: 'move', room: 'suite2', dx: 0, dy: 30 }], reply: 'Moved the mini primary toward the street.', confidence: 0.9 })
  const res = await ask('push the mini primary way out toward the street', fresh(), fake)
  assert.equal(res.source, 'claude')
  assert.equal(res.applied, false)
  assert.match(res.reply, /setback|run into/)
})

test('a fake Claude resize that overlaps a neighbour is rejected, a sane one applies', async () => {
  const bad = async () => ({ ops: [{ op: 'resize', room: 'kitchen', w: 38, d: 19 }], reply: 'Huge kitchen.', confidence: 0.9 })
  const r1 = await ask('giant kitchen', fresh(), bad)
  assert.equal(r1.applied, false)
  assert.match(r1.reply, /run into|setback|cover/)
  const good = async () => ({ ops: [{ op: 'resize', room: 'office', w: 12, d: 7.5 }], reply: 'Widened the office to 12 feet.', confidence: 0.9 })
  const r2 = await ask('office 12 feet wide', fresh(), good)
  assert.equal(r2.applied, true, r2.reply)
  assert.equal(byId(r2.rooms, 'office').w, 12)
})

test('low confidence or unknown ids never apply', async () => {
  const unsure = async () => ({ ops: [], reply: 'Which room do you mean?', confidence: 0.2 })
  const r1 = await ask('make it nicer', fresh(), unsure)
  assert.equal(r1.applied, false)
  assert.equal(r1.reply, 'Which room do you mean?')
  const badId = async () => ({ ops: [{ op: 'remove', room: 'garage-9' }], reply: 'Removed.', confidence: 0.9 })
  const r2 = await ask('remove the garage', fresh(), badId)
  assert.equal(r2.applied, false)
  assert.match(r2.reply, /could not apply/)
})

test('validateOps and regexOps shapes', () => {
  const rooms = fresh()
  assert.equal(validateOps([{ op: 'fly' }], rooms, KIT).ok, false)
  assert.equal(validateOps([{ op: 'resize', room: 'kitchen', w: 12, d: 19 }], rooms, KIT).ok, true)
  const r = regexOps('add a half bath next to the laundry', rooms, KIT)
  assert.deepEqual(r.ops[0], { op: 'add', kind: 'halfbath', near: 'laundry' })
  const res = applyOps(r.ops, rooms, KIT, 1)
  assert.ok(res.rooms.filter((x) => isRoom(x) && x.kind === 'halfbath').length === 2)
})

test('a timeout on the Claude call falls back and is labelled', async () => {
  const slow = async () => {
    const e = new Error('The operation was aborted')
    e.name = 'AbortError'
    throw e
  }
  const res = await ask('make the kitchen bigger', fresh(), slow)
  assert.equal(res.source, 'timeout')
  assert.equal(res.applied, true, res.reply)
})
