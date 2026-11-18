// Round 5 plan quality: door swings and the 30" in front of every door; the guests' bath off a public
// room; the suite entered away from the kitchen; the work triangle 15 to 22 ft; a hall over 35 ft
// warned; the narrow plan's hall bath by its bedrooms and its door to the yard; the 5-bed wing with
// rooms on both sides of the hall; the compact 3/2 within 3% from 1,300 to 1,600 sf on both lots.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { auditPlan, CLEAR } from '../src/draft/lib/audit.js'
import { generateRooms, DEFAULT_PROGRAM, kitFor, isRoom, programOf, extendWing } from '../src/draft/lib/layout.js'
import { withPlanCoords } from '../src/draft/lib/ops.js'
import { STYLES } from '../src/draft/lib/styles.js'
import { DEFAULT_LOT } from '../src/draft/lib/lot.js'
import { fitsLot } from '../src/draft/lib/fit.js'
import { planIdOf } from '../src/draft/lib/layout.js'
import { LOTS } from './helpers.mjs'

const style = STYLES.find((s) => s.id === 'farmhouse')
const kit = kitFor(style)
const ids = (a) => a.findings.map((f) => f.id)
const draft = (program, lot = DEFAULT_LOT) => {
  const rooms = generateRooms(program, style, lot)
  return { rooms, audit: auditPlan(rooms, program, kit, lot), flat: withPlanCoords(rooms, kit).rooms }
}
const P = (over) => ({ ...DEFAULT_PROGRAM, ...over })
const three2 = P({ beds: 3, baths: 2, halfBath: false, office: false, garage: 0, suite2: false, sqft: 1800 })

test('the audit catches a door swinging into another door, a door swinging into a fixture, a fixture in front of a door, a powder room reached only through the mud room, a suite reached only through the kitchen, and no door to the back yard', () => {
  const { rooms } = draft(DEFAULT_PROGRAM)
  const mud = rooms.find((r) => r.id === 'mud')
  const laundry = rooms.find((r) => r.id === 'laundry')
  // the laundry door swung into the mud room, with the back door hinged beside it: the two leaves meet
  const swings = rooms.map((e) => (e.id === 'd-laundry' ? { ...e, swing: -1, hinge: 'start' } : e.id === 'd-mud-ext' ? { ...e, x: laundry.x - 3.2, hinge: 'end' } : e))
  assert.ok(ids(auditPlan(swings, DEFAULT_PROGRAM, kit, DEFAULT_LOT)).includes('swing-swing'), 'two leaves that meet')
  // the bench moved under the back door's swing, and in front of the kitchen door
  const bench = rooms.map((e) => (e.kind === 'fixture' && e.fixture === 'bench' ? { ...e, x: mud.x + 0.4, y: mud.y + 0.8, w: 1.5, d: 3.5 } : e))
  const b = ids(auditPlan(bench, DEFAULT_PROGRAM, kit, DEFAULT_LOT))
  assert.ok(b.includes('swing-fixture'), `a leaf into the bench: ${b.join(',')}`)
  assert.ok(b.includes('door-approach'), `the bench in front of the kitchen door: ${b.join(',')}`)
  // the half bath entered from the mud room instead of the gallery
  const half = rooms.find((r) => r.id === 'halfbath')
  const viaMud = rooms.map((e) => (e.id === 'd-halfbath' ? { ...e, axis: 'h', w: 2.33, d: 0.6, x: half.x + 1.2, y: half.y - 0.3, swing: 1, hinge: 'start' } : e))
  assert.ok(ids(auditPlan(viaMud, DEFAULT_PROGRAM, kit, DEFAULT_LOT)).includes('powder-reach'))
  // the gallery entered from the kitchen instead of the dining room
  const gallery = rooms.find((r) => r.id === 'mhall')
  const kitchen = rooms.find((r) => r.id === 'kitchen')
  const viaKitchen = rooms.map((e) => (e.id === 'd-gallery' ? { ...e, y: Math.min(kitchen.y + kitchen.d, gallery.y + gallery.d) - 4 } : e))
  assert.ok(ids(auditPlan(viaKitchen, DEFAULT_PROGRAM, kit, DEFAULT_LOT)).includes('suite-kitchen'))
  // the living room's French door gone: no way to the back yard from the family rooms
  assert.ok(ids(auditPlan(rooms.filter((e) => e.id !== 'd-rear'), DEFAULT_PROGRAM, kit, DEFAULT_LOT)).includes('rear-door'))
  assert.ok(!ids(auditPlan(rooms, DEFAULT_PROGRAM, kit, DEFAULT_LOT)).some((id) => ['swing-swing', 'swing-fixture', 'door-approach', 'powder-reach', 'suite-kitchen', 'rear-door'].includes(id)))
})

test('the default draft, the Garza sample and a 3/2: no swing meets another or a fixture, 30" clear in front of every door, the half bath off the gallery, the suite entered from the dining side, the work triangle 15 to 22 ft', () => {
  for (const program of [DEFAULT_PROGRAM, kit.reference.program, three2]) {
    const { audit: a, flat } = draft(program)
    assert.deepEqual(a.errors.map((e) => e.message), [])
    const warn = a.warnings.map((w) => w.id)
    assert.ok(!warn.includes('powder-reach') && !warn.includes('suite-kitchen'), warn.join(','))
    assert.ok(a.measures.triangle.total >= 15 && a.measures.triangle.total <= CLEAR.triangleGoodFt, `triangle ${a.measures.triangle.total}`)
    // the mud room: a pocket door to the kitchen, the bench on the wall with no door
    const mud = flat.find((r) => r.id === 'mud')
    const pocket = flat.find((e) => e.id === 'd-kit-mud')
    assert.ok(pocket?.pocket, 'the kitchen door is a pocket door')
    const bench = flat.find((e) => e.kind === 'fixture' && e.fixture === 'bench')
    assert.ok(bench && bench.y + bench.d > mud.y + mud.d - 0.3, 'the bench sits on the south wall')
    assert.ok(!flat.some((e) => e.kind === 'door' && e.axis === 'h' && Math.abs(e.y + e.d / 2 - (mud.y + mud.d)) < 0.4 && e.x < mud.x + mud.w && e.x + e.w > mud.x), 'no door on that wall')
  }
})

test('a hall over 35 ft is warned: a 6-bed wing has one; the default, the 5-bed and the 3/2 do not (round 6: the wing grows at the front and across the hall first)', () => {
  const six = draft(P({ beds: 6, baths: 4, halfBath: false, garage: 2, sqft: 3800 }))
  assert.ok(six.audit.warnings.some((w) => w.id === 'hall-long'))
  assert.ok(six.audit.measures.halls.some((h) => h.lengthFt > CLEAR.hallLongFt))
  for (const [name, program] of [['default', P({})], ['5/4', P({ beds: 5, baths: 4, halfBath: false, garage: 3, sqft: 3500 })]]) {
    const d = draft(program)
    assert.ok(!d.audit.warnings.some((w) => w.id === 'hall-long'), `${name}: ${d.audit.measures.halls.map((h) => `${h.name} ${h.lengthFt}`).join(',')}`)
    assert.ok(d.audit.measures.circulation.pct <= 12, `${name}: circulation ${d.audit.measures.circulation.pct}%`)
  }
  const small = draft(three2)
  assert.ok(!small.audit.warnings.some((w) => w.id === 'hall-long'), small.audit.measures.halls.map((h) => `${h.name} ${h.lengthFt}`).join(','))
})

test('the 5-bed wing: Bedroom 3 takes the front of the wing, Bedroom 4 and its bath sit across the hall at the rear corner, and the hall stays under 35 ft', () => {
  const five = P({ beds: 5, baths: 4, halfBath: false, garage: 2, sqft: 3500 })
  const { audit: a, flat } = draft(five)
  assert.deepEqual(a.errors.map((e) => e.message), [])
  const hall = flat.find((r) => r.id === 'hall')
  const beds = flat.filter((r) => isRoom(r) && r.kind === 'bed')
  assert.equal(beds.length, 4, 'four secondary bedrooms')
  const east = flat.filter((r) => isRoom(r) && ['bed', 'bath', 'wic'].includes(r.kind) && r.x >= hall.x + hall.w - 0.3 && r.y < hall.y + 5)
  assert.ok(east.some((r) => r.kind === 'bed') && east.some((r) => r.kind === 'bath'), 'a bedroom and a bath across the hall at the rear corner')
  const front = beds.find((r) => r.y + r.d > hall.y + hall.d - 0.5)
  assert.ok(front, 'a bedroom at the front of the wing, where the mini primary would be')
  const hallFt = a.measures.halls.find((h) => h.name === 'Hallway').lengthFt
  assert.ok(hallFt <= CLEAR.hallLongFt, `the hallway is ${hallFt} ft (it was 61.8 with every room on one side, 55.8 in round 5)`)
  // a wing of two extra bedrooms and one extra bath in kit feet: the first bedroom and the bath across the hall, the hall grew by a door's worth, not by rooms
  const rooms = kit.plan.rooms.map((r) => ({ ...r, open: !!kit.rooms[r.kind]?.open }))
  const grew = extendWing(rooms, kit, { beds: 2, baths: 1 })
  assert.ok(grew.east, 'rooms east of the hall')
  assert.ok(grew.shift < 12.75 + 6, `the hall grew ${grew.shift} ft`)
})

test('the narrow plan: the hall bath sits beside Bedroom 3 off its short hall, the dining room opens to the rear porch through its back wall, the laundry and a drop zone sit off a short cross hall', () => {
  const lot = LOTS['narrow 50 x 120']
  for (const program of [P({ beds: 3, baths: 2, halfBath: false, office: false, garage: 0, suite2: false, sqft: 1800 }), P({ beds: 4, baths: 2, halfBath: false, office: false, garage: 2, suite2: false, sqft: 2200 })]) {
    const { audit: a, flat } = draft(program, lot)
    assert.equal(flat.find((r) => r.kind === 'roof')?.plan, 'narrow')
    assert.deepEqual(a.errors.map((e) => e.message), [])
    const bath = flat.find((r) => r.id === 'bath2')
    const bed3 = flat.find((r) => r.id === 'bed3')
    const hall3 = flat.find((r) => r.id === 'hall3')
    assert.ok(bath && bed3 && hall3 && Math.abs(bath.x + bath.w - bed3.x) < 0.5 && Math.abs(hall3.x + hall3.w - bed3.x) < 0.5, 'Bath 2 and the short hall stand beside Bedroom 3')
    const yardDoor = flat.find((e) => e.kind === 'door' && e.exterior && e.room === 'dining')
    const dining = flat.find((r) => r.id === 'dining')
    assert.ok(yardDoor && yardDoor.axis === 'h' && Math.abs(yardDoor.y + yardDoor.d / 2 - dining.y) < 0.4 && yardDoor.pair, 'the dining room opens to the back yard through a pair on its rear wall')
    assert.ok(!a.warnings.some((w) => w.id === 'rear-door' || w.id === 'circulation' || w.id === 'hall-long'), a.warnings.map((w) => w.id).join(','))
    assert.ok(flat.find((r) => r.id === 'mud') && flat.find((r) => r.id === 'laundry'))
  }
})

test('the compact plan: a 3/2 at 1,300, 1,450 and 1,600 sf, with a 2-car garage or none, drafts within 3% on the 50 ft and the 100 ft lots and passes the audit', () => {
  for (const lot of [LOTS['narrow 50 x 120'], LOTS['McAllen 100 x 150']]) {
    for (const [sqft, garage] of [[1300, 0], [1450, 2], [1600, 2], [1600, 1]]) {
      const program = P({ beds: 3, baths: 2, halfBath: false, office: false, suite2: false, rearPorch: false, garage, sqft })
      const { audit: a, flat } = draft(program, lot)
      assert.equal(flat.find((r) => r.kind === 'roof')?.plan, 'compact', `${sqft} sf takes the compact plan`)
      assert.deepEqual(a.errors.map((e) => e.message), [], `${sqft} g${garage}`)
      assert.ok(Math.abs(a.measures.livingSf - sqft) / sqft <= 0.03, `${a.measures.livingSf} sf for ${sqft}`)
      const got = programOf(flat)
      assert.equal(got.beds, 3)
      assert.equal(got.baths, 2)
      assert.equal(got.garage, garage)
      assert.ok(a.measures.triangle.total >= 15 && a.measures.triangle.total <= 22, `triangle ${a.measures.triangle.total}`)
      assert.ok(!a.warnings.some((w) => w.id === 'hall-long' || w.id === 'circulation'), a.warnings.map((w) => w.id).join(','))
    }
  }
  // 1,800 sf and up is the standard plan's (or the narrow one's on a 50 ft lot)
  assert.notEqual(draft(three2, LOTS['McAllen 100 x 150']).flat.find((r) => r.kind === 'roof')?.plan, 'compact')
})

test('a fit offer drafts on the plan it names: 5/4 3-car 3,500 sf on the 50 ft lot is offered as what the plan nearest that size holds (the narrow plan), and that plan is what comes out', () => {
  const f = fitsLot({ ...DEFAULT_PROGRAM, beds: 5, baths: 4, halfBath: false, office: true, garage: 3, sqft: 3500 }, style, LOTS['narrow 50 x 120'])
  assert.ok(!f.ok && f.suggestion, 'the program does not fit and an offer is made')
  const m = f.suggestion.label.match(/what the (\w+) plan holds/)
  assert.ok(m, f.suggestion.label)
  const rooms = generateRooms(f.suggestion.program, style, LOTS['narrow 50 x 120'])
  assert.equal(planIdOf(rooms), m[1], `${f.suggestion.label} at ${f.suggestion.program.sqft} sf drafted the ${planIdOf(rooms)} plan`)
  const a = auditPlan(rooms, f.suggestion.program, kit, LOTS['narrow 50 x 120'])
  assert.equal(a.errors.length, 0, a.errors.map((e) => e.message).join(' / '))
  assert.ok(!a.warnings.some((w) => w.id === 'area'), 'the offered size is what the draft comes out at')
})
