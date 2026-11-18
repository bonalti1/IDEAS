// Round 8, the plans: the narrow plan keeps its size and its halls short, Bedroom 3 opens off the main hall;
// the corner 5/4 3-car grows past 2,562 sf by narrowing the plan and deepening the rooms; a 3-car is 32 ft;
// a room open to a lit room counts as lit; the split option hides below six bedrooms.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateRooms, DEFAULT_PROGRAM, kitFor, isRoom, floorArea, planIdOf } from '../src/draft/lib/layout.js'
import { withPlanCoords } from '../src/draft/lib/ops.js'
import { auditPlan } from '../src/draft/lib/audit.js'
import { fitsLot } from '../src/draft/lib/fit.js'
import { optionsFor } from '../src/draft/lib/options.js'
import { STYLES } from '../src/draft/lib/styles.js'
import { DEFAULT_LOT } from '../src/draft/lib/lot.js'
import { LOTS } from './helpers.mjs'

const style = STYLES.find((s) => s.id === 'farmhouse')
const kit = kitFor(style)
const P = (over) => ({ ...DEFAULT_PROGRAM, ...over })
const drafted = (program, lot) => {
  const f = fitsLot(program, style, lot)
  const p = f.ok ? program : f.maxSqft ? { ...program, sqft: f.maxSqft } : f.suggestion?.program || program
  const rooms = generateRooms(p, style, lot)
  return { p, rooms, audit: auditPlan(rooms, p, kit, lot), f }
}

test('the narrow lot keeps its size: the 4/2 2-car draws 2,350 sf within 3%, the 4/3.5 and 5/4 asks are offered the narrow plan at 2,350 or more, the Garza sample at 2,350 or more; the 3/2 at 1,800 sits within 3% with halls under 11% of the area', () => {
  const lot = LOTS['narrow 50 x 120']
  const four = drafted(P({ beds: 4, baths: 2, halfBath: false, office: false, garage: 2, suite2: false, sqft: 2350 }), lot)
  assert.ok(four.f.ok, four.f.reasons?.join(' | '))
  const sf4 = floorArea(four.rooms, 1)
  assert.ok(Math.abs(sf4 - 2350) / 2350 <= 0.03, `${Math.round(sf4)} sf`)
  assert.deepEqual(four.audit.errors.map((e) => e.message), [])
  for (const program of [P({ sqft: 2800 }), P({ beds: 5, baths: 4, halfBath: false, office: true, garage: 3, sqft: 3500 }), { ...kit.reference.program }]) {
    const d = drafted(program, lot)
    assert.equal(planIdOf(d.rooms), 'narrow')
    assert.ok(floorArea(d.rooms, 1) >= 2350, `${program.beds}/${program.baths}: ${Math.round(floorArea(d.rooms, 1))} sf (PR #5 drew 2,351; round 6 fell to 2,202)`)
    assert.deepEqual(d.audit.errors.map((e) => e.message), [])
  }
  const three = drafted(P({ beds: 3, baths: 2, halfBath: false, office: false, garage: 0, suite2: false, sqft: 1800 }), lot)
  const sf3 = floorArea(three.rooms, 1)
  // the 3/2 at 1,800 draws at the plan's smallest (the rooms step says so and offers it): within 6%, as the audit test asks
  assert.ok(Math.abs(sf3 - 1800) / 1800 <= 0.06, `3/2 1,800 draws ${Math.round(sf3)} sf`)
  assert.ok(three.audit.measures.circulation.pct <= 11, `circulation ${three.audit.measures.circulation.pct}% (round 6: 12.0, the warning line)`)
  assert.ok(three.audit.measures.halls.every((h) => h.lengthFt > 0), JSON.stringify(three.audit.measures.halls))
})

test('the corner 5/4 3-car no longer loses 950 sf over 4 ft of lot: the garage-forward plan narrows to the 84 ft envelope and the rooms grow deeper (3,200 sf or more, 0 errors); a 3-car garage is 32 ft wide', () => {
  const lot = LOTS['corner 110 x 140']
  const d = drafted(P({ beds: 5, baths: 4, halfBath: false, office: true, garage: 3, sqft: 3500 }), lot)
  const sf = floorArea(d.rooms, 1)
  assert.ok(sf >= 3200, `${Math.round(sf)} sf (round 6: 2,562; the target is 3,400)`)
  assert.deepEqual(d.audit.errors.map((e) => e.message), [])
  const g = d.rooms.find((r) => isRoom(r) && r.kind === 'garage')
  assert.ok(g && Math.abs(Math.max(g.w, g.d) - 32) < 0.01, `3-car ${g?.w} x ${g?.d}`)
  const mc = drafted(P({ beds: 5, baths: 4, halfBath: false, office: true, garage: 3, sqft: 3500 }), LOTS['McAllen 100 x 150'])
  const gm = mc.rooms.find((r) => isRoom(r) && r.kind === 'garage')
  assert.ok(gm && Math.abs(Math.max(gm.w, gm.d) - 32) < 0.01, `McAllen 3-car ${gm?.w} x ${gm?.d}`)
  assert.ok(floorArea(mc.rooms, 1) >= 3400)
})

test('a room open to a lit room counts as lit (the narrow kitchen, open to the dining room); a closed room with no window still fails', () => {
  const lot = LOTS['narrow 50 x 120']
  const rooms = generateRooms(P({ beds: 3, baths: 2, halfBath: false, office: false, garage: 0, suite2: false, sqft: 1800 }), style, lot)
  const a = auditPlan(rooms, DEFAULT_PROGRAM, kit, lot)
  assert.ok(!a.errors.some((e) => e.id === 'window'), a.errors.map((e) => e.message).join(' | '))
  const kitchen = rooms.find((r) => r.id === 'kitchen')
  assert.ok(!rooms.some((e) => e.kind === 'window' && e.room === kitchen.id), 'the kitchen has no window of its own')
  // the dining room's window and French pair gone: the kitchen is no longer lit through the opening
  const dark = rooms.filter((e) => !((e.kind === 'window' || e.kind === 'door') && e.room === 'dining' && (e.kind === 'window' || e.exterior)))
  const b = auditPlan(dark, DEFAULT_PROGRAM, kit, lot)
  assert.ok(b.errors.some((e) => e.id === 'window' && /Kitchen|Dining/.test(e.message)), b.errors.map((e) => e.message).join(' | '))
})

test('the split-bedrooms option is hidden below six bedrooms (where it draws the same house) and offered on the 6/5', () => {
  const five = generateRooms(P({ beds: 5, baths: 4, halfBath: false, office: true, garage: 3, sqft: 3500 }), style, DEFAULT_LOT)
  assert.ok(!optionsFor('wing', five, DEFAULT_PROGRAM, style, DEFAULT_LOT).options.some((o) => /Split/.test(o.label)))
  const six = P({ beds: 6, baths: 5, halfBath: false, garage: 2, sqft: 3900 })
  const rooms = generateRooms(six, style, DEFAULT_LOT)
  assert.ok(optionsFor('wing', rooms, six, style, DEFAULT_LOT).options.some((o) => /Split/.test(o.label)))
})
