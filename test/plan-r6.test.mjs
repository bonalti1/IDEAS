// Round 6 plan quality: the narrow plan's rear access (a side-yard door is not a back door), Bedroom 3 the size
// of the others; the compact plan's mud room with a door of its own when there is no garage; no door swings
// into a room under 25 sf (the pantry doors are pocket doors or swing out).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { auditPlan } from '../src/draft/lib/audit.js'
import { generateRooms, DEFAULT_PROGRAM, kitFor, isRoom, doorEl } from '../src/draft/lib/layout.js'
import { withPlanCoords } from '../src/draft/lib/ops.js'
import { STYLES } from '../src/draft/lib/styles.js'
import { DEFAULT_LOT } from '../src/draft/lib/lot.js'
import { LOTS } from './helpers.mjs'

const style = STYLES.find((s) => s.id === 'farmhouse')
const kit = kitFor(style)
const P = (o) => ({ ...DEFAULT_PROGRAM, ...o })
const ids = (a) => a.errors.map((e) => e.id).concat(a.warnings.map((w) => w.id))

test('narrow plan: the back yard is reached from the dining room, not through the primary bedroom; the primary keeps a window; a door into a 5 ft side yard is not a back door', () => {
  const lot = LOTS['narrow 50 x 120']
  const program = P({ beds: 3, baths: 2, halfBath: false, office: false, garage: 2, sqft: 1800 })
  const rooms = generateRooms(program, style, lot)
  const a = auditPlan(rooms, program, kit, lot)
  assert.deepEqual(a.errors.map((e) => e.message), [])
  assert.ok(!ids(a).includes('rear-door'))
  const flat = withPlanCoords(rooms, kit).rooms
  const master = flat.find((r) => r.id === 'master')
  assert.ok(!flat.some((e) => e.kind === 'door' && e.exterior && e.room === 'master'), 'no exterior door in the primary bedroom')
  assert.ok(flat.filter((e) => e.kind === 'window' && e.room === 'master').length >= 2, 'the primary bedroom has its windows')
  // without the dining room's French door, a door on the dining room's side wall (into the 5 ft side yard) does not count
  const noRear = rooms.filter((e) => e.id !== 'd-rear')
  assert.ok(ids(auditPlan(noRear, program, kit, lot)).includes('rear-door'), 'no back door: warned')
  const dining = flat.find((r) => r.id === 'dining')
  const side = { ...doorEl(kit, 'd-side', 'dining', 'v', dining.x + dining.w, dining.y + 4, 'exteriorSingle', { swing: -1, hinge: 'start', exterior: true }), local: [dining.local[0] + dining.w / 2, dining.local[1] + 4 - dining.d / 2] }
  const withSide = [...noRear, side]
  assert.ok(ids(auditPlan(withSide, program, kit, lot)).includes('rear-door'), 'a door into a 5 ft side yard is not a back door')
  assert.ok(!ids(auditPlan(withSide, program, kit, null)).includes('rear-door'), 'with no lot known the side door counts, as before')
  void master
})

test('narrow plan: Bedroom 3 is Bedroom 2\'s size, not 20 ft wide', () => {
  const lot = LOTS['narrow 50 x 120']
  const rooms = generateRooms(P({ beds: 3, baths: 2, halfBath: false, office: false, garage: 2, sqft: 1800 }), style, lot)
  const bed2 = rooms.find((r) => r.id === 'bed2')
  const bed3 = rooms.find((r) => r.id === 'bed3')
  assert.ok(bed2 && bed3)
  const ratio = (bed3.w * bed3.d) / (bed2.w * bed2.d)
  assert.ok(ratio > 0.85 && ratio < 1.15, `Bedroom 3 is ${bed3.w} x ${bed3.d}, Bedroom 2 ${bed2.w} x ${bed2.d}`)
  assert.ok(Math.max(bed3.w, bed3.d) < 17, 'no 20 ft bedroom')
})

test('compact plan: with no garage the mud room has its own door to the yard; with a garage, the garage door; the pantry door swings out', () => {
  const lot = LOTS['McAllen 100 x 150']
  for (const garage of [0, 2]) {
    const program = P({ beds: 3, baths: 2, halfBath: false, office: false, garage, sqft: 1300 })
    const rooms = generateRooms(program, style, lot)
    const a = auditPlan(rooms, program, kit, lot)
    assert.deepEqual(a.errors.map((e) => e.message), [], `g${garage}`)
    const mudDoors = rooms.filter((e) => e.kind === 'door' && e.room === 'mud')
    const garageDoor = rooms.find((e) => e.kind === 'door' && e.room === 'garage' && !/overhead/.test(e.size || ''))
    if (garage) assert.ok(garageDoor && !mudDoors.some((d) => d.exterior), 'the garage door serves the mud room')
    else assert.ok(mudDoors.some((d) => d.exterior), 'the mud room opens to the yard')
    const pantryDoor = rooms.find((e) => e.kind === 'door' && e.room === 'pantry')
    assert.ok(pantryDoor && (pantryDoor.pocket || pantryDoor.swing === -1), 'the pantry door is a pocket door or swings out')
  }
})

test('the audit refuses a door that swings into a room under 25 sf: the standard plan pantry door as a swing door', () => {
  const rooms = generateRooms(DEFAULT_PROGRAM, style, DEFAULT_LOT)
  assert.ok(!ids(auditPlan(rooms, DEFAULT_PROGRAM, kit, DEFAULT_LOT)).includes('swing-small'), 'the pantry door is a pocket door')
  const swung = rooms.map((e) => (e.id === 'd-pantry' ? { ...e, pocket: false, swing: -1, hinge: 'start' } : e))
  const a = auditPlan(swung, DEFAULT_PROGRAM, kit, DEFAULT_LOT)
  assert.ok(a.errors.some((e) => e.id === 'swing-small' && /Pantry/.test(e.message)), a.errors.map((e) => e.id).join(','))
  assert.ok(rooms.filter(isRoom).length > 0)
})
