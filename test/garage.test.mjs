// The garage: doors that match the bays, a driveway on the real lot, and "make the garage 3 cars".
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateRooms, DEFAULT_PROGRAM, kitFor, isRoom, overheadDoors, garageFacing } from '../src/draft/lib/layout.js'
import { auditPlan } from '../src/draft/lib/audit.js'
import { interpretRequest } from '../src/draft/lib/interpret.js'
import { withPlanCoords } from '../src/draft/lib/ops.js'
import { STYLES } from '../src/draft/lib/styles.js'
import { DEFAULT_LOT, buildLot } from '../src/draft/lib/lot.js'
import { LOTS, PROGRAMS, draftable } from './helpers.mjs'

const style = STYLES.find((s) => s.id === 'farmhouse')
const kit = kitFor(style)
const offline = async () => {
  throw new Error('no api')
}
const garageOf = (rooms) => {
  const flat = withPlanCoords(rooms, kit).rooms
  const g = flat.find((r) => isRoom(r) && r.kind === 'garage')
  const doors = flat.filter((e) => e.kind === 'door' && e.room === g?.id && /overhead/.test(e.size || ''))
  return { g, doors, flat }
}
const garageErrors = (rooms, program, lot) => auditPlan(rooms, program, kit, lot).errors.filter((e) => /garage|doors-overlap/.test(e.id)).map((e) => e.message)

test('overhead doors by bay: a 2-car gets one 16 ft door, a 3-car 16 + 9, no overlap, 2 ft of wall between and at the ends, centred on the bays', () => {
  const two = overheadDoors(kit, { id: 'g', x: 0, y: 0, w: 22, d: 22 }, 2, 's')
  assert.deepEqual(two.map((d) => d.span), [16])
  assert.ok(Math.abs(two[0].x + two[0].w / 2 - 11) < 0.01, 'centred')
  const three = overheadDoors(kit, { id: 'g', x: 0, y: 0, w: 33, d: 22 }, 3, 's')
  assert.deepEqual(three.map((d) => d.span), [16, 9])
  const [a, b] = three
  assert.ok(a.x >= 2 - 0.01 && b.x >= a.x + a.w + 2 - 0.01 && b.x + b.w <= 33 - 2 + 0.01, `${a.x} ${a.x + a.w} ${b.x} ${b.x + b.w}`)
  // a side-load 3-car turns its bays along the long wall
  const side = overheadDoors(kit, { id: 'g', x: 0, y: 0, w: 22, d: 33 }, 3, 'e')
  assert.deepEqual(side.map((d) => d.span), [16, 9])
  assert.ok(side.every((d) => d.axis === 'v' && Math.abs(d.x + d.w / 2 - 22) < 0.01))
  // a narrow wall falls back to singles
  const tight = overheadDoors(kit, { id: 'g', x: 0, y: 0, w: 20, d: 22 }, 2, 's')
  assert.ok(tight.every((d) => d.span === 9) || (tight.length === 1 && tight[0].span === 16))
})

for (const [lotName, lot] of Object.entries(LOTS)) {
  for (const [progName, program] of Object.entries(PROGRAMS)) {
    if (!program.garage) continue
    test(`garage on the lot: ${progName} on ${lotName}`, () => {
      const drafted = draftable(program, lot)
      assert.ok(drafted, 'something drafts')
      if (!drafted.garage) return // the offer dropped the garage: nothing to check
      const rooms = generateRooms(drafted, style, lot)
      const { g, doors } = garageOf(rooms)
      assert.ok(g, 'a garage')
      // a tandem garage parks the third car behind one of two bays: two wide, two deep
      const bays = g.tandem ? Math.round(Math.min(g.w, g.d) / kit.rooms.garage.perCar) * Math.floor(Math.max(g.w, g.d) / 20) : Math.round(Math.max(g.w, g.d) / kit.rooms.garage.perCar)
      if (g.tandem) assert.ok(bays >= drafted.garage, `${g.name} ${g.w} x ${g.d}`)
      else assert.equal(bays, drafted.garage, `${g.name} ${g.w} x ${g.d}`)
      assert.match(g.name, new RegExp(`^${drafted.garage}-Car`))
      const across = g.tandem ? Math.round(Math.min(g.w, g.d) / kit.rooms.garage.perCar) : drafted.garage
      assert.ok(doors.reduce((a, d) => a + d.span, 0) >= across * 8, 'doors cover the bays')
      assert.deepEqual(garageErrors(rooms, drafted, lot), [])
      // the driveway: a front-load door faces the street; a side door has 25 ft of apron inside the lot
      const facing = garageFacing(g, doors)
      assert.ok(['s', 'e', 'w'].includes(facing), `faces ${facing}; a rear door needs an alley`)
    })
  }
}

test('"make the garage 3 cars" on the default draft re-places the garage with 16 + 9 ft doors and passes the audit; a 50 ft lot refuses it honestly', async () => {
  const r = await interpretRequest('make the garage 3 cars', generateRooms(DEFAULT_PROGRAM, style, DEFAULT_LOT), DEFAULT_PROGRAM, style, { lot: DEFAULT_LOT, interpreter: offline })
  assert.equal(r.applied, true, r.reply)
  const { g, doors } = garageOf(r.rooms)
  assert.equal(g.name, '3-Car Garage')
  assert.ok(Math.max(g.w, g.d) >= 32)
  assert.deepEqual(doors.map((d) => d.span).sort(), [16, 9].sort())
  assert.deepEqual(auditPlan(r.rooms, DEFAULT_PROGRAM, kit, DEFAULT_LOT).errors, [])
  const narrow = buildLot({ kind: 'manual', width: 50, depth: 120, city: 'pharr', setbacks: {} })
  const p = { ...DEFAULT_PROGRAM, beds: 3, baths: 2, halfBath: false, office: false, sqft: 1800 }
  const n = await interpretRequest('make the garage 3 cars', generateRooms(p, style, narrow), p, style, { lot: narrow, interpreter: offline })
  assert.equal(n.applied, false)
  assert.match(n.reply, /setback|lot/)
})

test('the audit catches overlapping doors, too little door for the bays, a wrong bay count in the name, and a door that faces the rear yard', () => {
  const rooms = generateRooms(DEFAULT_PROGRAM, style, DEFAULT_LOT)
  const { g, doors, flat } = garageOf(rooms)
  const ids = (list) => auditPlan(list, DEFAULT_PROGRAM, kit, DEFAULT_LOT).errors.map((e) => e.id)
  // a second 16 ft door on top of the first
  const dup = [...flat, { ...doors[0], id: 'd-garage-overhead-dup', x: doors[0].x + 4 }]
  assert.ok(ids(dup).includes('doors-overlap'))
  // the name says 3 cars on a 22 ft garage
  const named = flat.map((r) => (r.id === g.id ? { ...r, name: '3-Car Garage' } : r))
  assert.ok(ids(named).includes('garage-name'))
  // a 9 ft door for two bays
  const small = flat.map((e) => (e.id === doors[0].id ? { ...e, size: 'overheadSingle', span: 9, w: e.axis === 'h' ? 9 : e.w, d: e.axis === 'h' ? e.d : 9 } : e))
  assert.ok(ids(small).includes('garage-bays'))
  // the door moved to the rear wall, no alley on this lot
  const rear = flat.map((e) => (e.id === doors[0].id ? { ...e, y: g.y - e.d / 2 } : e))
  assert.ok(ids(rear).includes('garage-street'))
})
