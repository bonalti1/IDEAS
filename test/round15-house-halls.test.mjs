// Fix round 15, item U19 (plan and audit): the drafter's card showed a plan with a 4'-3" x 55'-3" hallway while the
// audit said "halls 35 ft max" and passed. The plan was the narrow plan's first draft on 3305 N 27th St, McAllen (the
// default rooms, offered as the narrow plan's 4 bed, 2 bath at 2,500 sf): its hallway ran from the fourth bedroom to
// the living room, 55 ft, and the audit measured only the 22 ft of it with walls on both sides.
//   1  the audit measures a hall the way it is drawn: a hall drawn over 35 ft is warned, and the length it lists is
//      the drawn one (the walled stretch is kept beside it)
//   2  no first draft of the default rooms on the recorded lots, the 100 x 150 lot or a 50 ft lot draws a hall over
//      35 ft (the narrow plan draws its hall as a rear hall and a hallway with the kitchen between; the compact plan's
//      linen closet takes the first 7 ft of its hall)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isRoom, fromPlan, DEFAULT_PROGRAM } from '../src/draft/lib/layout.js'
import { auditPlan, auditSummary, CLEAR } from '../src/draft/lib/audit.js'
import { recordedLots, typedLot, firstDraft, style } from './round15-house-lots.mjs'

const halls = (rooms) => rooms.filter((r) => isRoom(r) && r.kind === 'hall')
const drawn = (h) => Math.max(h.w, h.d)
// what the rooms step offered on that lot in round 14: the narrow plan's 4 bed, 2 bath, 2-car at 2,500 sf
const OFFERED = { ...DEFAULT_PROGRAM, beds: 4, baths: 2, halfBath: false, office: false, garage: 2, sqft: 2500 }
/** The narrow plan as the card showed it: that program drafted on that lot on the narrow plan. */
async function reported() {
  const lot = (await recordedLots())['3305 N 27th St']
  const d = fromPlan(OFFERED, style.kit, lot, 'narrow')
  return { lot, program: OFFERED, rooms: d.rooms }
}

test('U19 1: the reported plan (the narrow plan\'s 4 bed, 2 bath at 2,500 sf on 3305 N 27th St): every hall is drawn 35 ft or under, and the audit lists each at its drawn length', async () => {
  const f = await reported()
  const hs = halls(f.rooms)
  assert.ok(hs.length, 'the plan has halls')
  for (const h of hs) assert.ok(drawn(h) <= CLEAR.hallLongFt + 0.05, `${h.name} is drawn ${h.w.toFixed(2)} x ${h.d.toFixed(2)} ft (the card showed 4'-3" x 55'-3")`)
  const a = auditPlan(f.rooms, f.program, style.kit, f.lot)
  for (const h of hs) {
    const m = a.measures.halls.find((x) => x.name === h.name)
    assert.ok(m && Math.abs(m.lengthFt - drawn(h)) < 0.06, `${h.name}: the audit lists ${m?.lengthFt} ft, the plan draws ${drawn(h).toFixed(2)}`)
  }
})

test('U19 2: a hall drawn 55 ft long, though open to the kitchen and the dining room for half of it, is warned, and the halls check is not a pass', async () => {
  const f = await reported()
  // the hallway as round 14 drew it: one room from the rear hall's end to the living room, the kitchen 4 ft narrower
  const rooms = f.rooms.map((r) => ({ ...r }))
  const hall = rooms.find((r) => r.id === 'hall')
  const rear = rooms.find((r) => r.id === 'hallr')
  const kitchen = rooms.find((r) => r.id === 'kitchen')
  assert.ok(hall && rear && kitchen, 'the narrow plan draws a rear hall and a hallway')
  const end = hall.y + hall.d
  hall.y = rear.y
  hall.d = end - rear.y
  kitchen.x += hall.w
  kitchen.w -= hall.w
  rooms.splice(rooms.indexOf(rear), 1)
  assert.ok(drawn(hall) > 50, `the glued hall is ${drawn(hall).toFixed(2)} ft`)
  const a = auditPlan(rooms, f.program, style.kit, f.lot)
  const warn = a.warnings.find((w) => w.id === 'hall-long')
  assert.ok(warn, `no hall-long warning; halls ${JSON.stringify(a.measures.halls)}`)
  assert.match(warn.message, /Hallway is 4'-\d+" x 5\d'-\d+" as drawn/)
  const m = a.measures.halls.find((x) => x.name === 'Hallway')
  assert.ok(Math.abs(m.lengthFt - drawn(hall)) < 0.06 && m.enclosedFt < m.lengthFt, JSON.stringify(m))
  const group = auditSummary(rooms, f.program, style.kit, f.lot).groups.find((g) => g.id === 'halls')
  assert.notEqual(group.state, 'pass', 'the drafter card does not say "Halls ... none over 35 ft" with a pass')
})

test('U19 3: no first draft of the default rooms draws a hall over 35 ft: the recorded lots, 100 x 150, 60 x 120 and 50 x 120', async () => {
  const lots = await recordedLots()
  const all = { ...lots, '100 x 150': typedLot(100, 150), '60 x 120': typedLot(60, 120), '50 x 120': typedLot(50, 120) }
  const over = []
  for (const [name, lot] of Object.entries(all)) {
    if (/Cage/.test(name)) continue // a commercial parcel: the house tests leave it out
    const f = firstDraft(lot)
    for (const h of halls(f.rooms)) if (drawn(h) > CLEAR.hallLongFt + 0.05) over.push(`${name} (${f.plan}): ${h.name} ${h.w.toFixed(2)} x ${h.d.toFixed(2)}`)
    const a = auditPlan(f.rooms, f.program, style.kit, f.lot)
    assert.ok(!a.warnings.some((w) => w.id === 'hall-long'), `${name}: ${a.warnings.filter((w) => w.id === 'hall-long').map((w) => w.message).join(' | ')}`)
  }
  assert.deepEqual(over, [])
})
