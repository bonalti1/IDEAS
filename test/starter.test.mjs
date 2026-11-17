// The first draft a client sees always passes the rules: on every city preset's default lot, on
// the recorded Lot 514, for the starter program and the ones around it. When a program cannot fit
// a lot, the rooms step learns that before "Draft my house" and gets the largest size that does.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildLot, DEFAULT_LOT } from '../src/draft/lib/lot.js'
import { generateRooms, starterDraft, fitToLot, programLimits, DEFAULT_PROGRAM, isRoom, floorArea, kitFor } from '../src/draft/lib/layout.js'
import { fitsLot } from '../src/draft/lib/fit.js'
import { checkRules } from '../src/draft/lib/rules.js'
import { STYLES } from '../src/draft/lib/styles.js'
import { CITY_IDS } from '../src/draft/lib/cities.js'

const style = STYLES.find((s) => s.id === 'farmhouse')
const ref = style.kit.reference.program
const defaultLot = (city, extra = {}) => buildLot({ kind: 'manual', width: 100, depth: 150, city, frontStreet: '', corner: '', setbacks: {}, ...extra })
const programs = {
  reference: ref,
  starter: DEFAULT_PROGRAM,
  'four beds, three cars, 3200': { ...DEFAULT_PROGRAM, beds: 4, baths: 3, garage: 3, sqft: 3200 },
  'five beds with a second suite': { ...DEFAULT_PROGRAM, beds: 5, baths: 4, suite2: true, garage: 2, sqft: 3000, rearPorch: true },
  'three beds, no garage, small': { ...DEFAULT_PROGRAM, beds: 3, baths: 2, garage: 0, sqft: 1400, office: false },
}

for (const city of CITY_IDS) {
  test(`the starter draft passes the rules on the 100 x 150 default lot in ${city}`, () => {
    const lot = defaultLot(city)
    for (const [name, program] of Object.entries(programs)) {
      const rooms = generateRooms(program, style, lot)
      const r = checkRules(rooms, program, style, lot)
      assert.deepEqual(r.reasons, [], `${city}, ${name}`)
    }
  })
}

test('the starter draft passes the rules on the recorded Lot 514 and on a corner lot', () => {
  for (const lot of [DEFAULT_LOT, defaultLot('palmview', { width: 110, depth: 140, corner: 'left', sideStreet: 'Elm' })]) {
    for (const [name, program] of Object.entries(programs)) {
      const r = checkRules(generateRooms(program, style, lot), program, style, lot)
      assert.deepEqual(r.reasons, [], `${lot.address || 'corner'}, ${name}`)
    }
  }
})

test('extras added for the program are real rooms: the garage keeps its id, a new bedroom gets a door and an egress window', () => {
  const rooms = generateRooms(DEFAULT_PROGRAM, style, defaultLot('hidalgo'))
  const garage = rooms.find((r) => r.id === 'garage')
  assert.ok(garage && garage.kind === 'garage' && garage.w === 22, 'two-car garage')
  const bed3 = rooms.find((r) => r.id === 'bed-3')
  assert.ok(bed3, 'the fourth bedroom')
  assert.ok(rooms.some((e) => e.kind === 'window' && e.room === 'bed-3'), 'window')
  assert.ok(rooms.some((e) => e.kind === 'door' && e.room === 'bed-3'), 'door')
  // nothing sits on a porch
  const porches = rooms.filter((r) => isRoom(r) && r.open)
  const solid = rooms.filter((r) => isRoom(r) && !r.open)
  const overlap = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1 && Math.min(a.y + a.d, b.y + b.d) - Math.max(a.y, b.y) > 1
  porches.forEach((p) => solid.forEach((s) => assert.ok(!overlap(p, s), `${s.name} sits on the ${p.name}`)))
})

test('the reference program on the reference lot is left exactly where the drafter put it', () => {
  const d = starterDraft(ref, style, DEFAULT_LOT)
  assert.equal(d.fitScale, 1)
  assert.deepEqual(d.fitShift, [0, 0])
  assert.equal(d.clamped, false)
})

test('a small request is drafted at the smallest size the plan allows, and says so', () => {
  const d = starterDraft({ ...ref, sqft: 1400 }, style, DEFAULT_LOT)
  assert.equal(d.clamped, true)
  assert.ok(d.minSqft > 1400 && d.minSqft < ref.sqft, `min ${d.minSqft}`)
  assert.ok(Math.abs(floorArea(d.rooms) - d.minSqft) < d.minSqft * 0.06, `${Math.round(floorArea(d.rooms))} sf vs ${d.minSqft}`)
  assert.deepEqual(checkRules(d.rooms, { ...ref, sqft: 1400 }, style, DEFAULT_LOT).reasons, [])
})

test('fitToLot shifts a house back inside the setbacks and never grows it', () => {
  const lot = defaultLot('hidalgo')
  const rooms = generateRooms(ref, style, lot)
  const kit = kitFor(style)
  // push every room 30 ft east: the plan now crosses the side setback
  const pushed = rooms.map((r) => (r.kind === 'roof' ? r : { ...r, x: (r.x ?? 0) + 30 }))
  const bad = checkRules(pushed.map((r) => (r.x !== undefined && r.center ? { ...r, center: [r.center[0] + 30, r.center[1]] } : r)), ref, style, lot)
  assert.ok(bad.reasons.some((x) => /setback/.test(x)), 'pushed plan crosses the setback')
  const fit = fitToLot(pushed, kit, 1, lot)
  assert.equal(fit.scale, 1)
  assert.ok(fit.shift[0] <= -20 && fit.shift[0] >= -30, `shifted back by ${fit.shift[0]} (the smallest shift that fits, not the full 30)`)
  assert.deepEqual(checkRules(fit.rooms, ref, style, lot).reasons, [])
})

test('a program that does not fit is refused before drafting, with the largest size or the smallest change that does', () => {
  // 90 ft lot, too much house: a smaller living area fits
  const lot90 = defaultLot('mcallen', { width: 90, depth: 130 })
  const big = { ...DEFAULT_PROGRAM, sqft: 3800 }
  const f = fitsLot(big, style, lot90)
  assert.equal(f.ok, false)
  assert.ok(f.reasons.length > 0)
  assert.ok(f.maxSqft && f.maxSqft < 3800, `max ${f.maxSqft}`)
  const smaller = { ...big, sqft: f.maxSqft }
  assert.deepEqual(checkRules(generateRooms(smaller, style, lot90), smaller, style, lot90).reasons, [])
  // 70 ft lot: this plan is 72 ft wide, so either a smaller size or a smaller program is offered, and it passes
  const lot = defaultLot('mcallen', { width: 70, depth: 120 })
  const g = fitsLot({ ...DEFAULT_PROGRAM, beds: 4, baths: 3, garage: 2, sqft: 2800 }, style, lot)
  assert.equal(g.ok, false)
  if (g.maxSqft || g.suggestion) {
    const fitted = g.maxSqft ? { ...DEFAULT_PROGRAM, beds: 4, baths: 3, garage: 2, sqft: g.maxSqft } : g.suggestion.program
    assert.deepEqual(checkRules(generateRooms(fitted, style, lot), fitted, style, lot).reasons, [], g.suggestion?.label || `at ${g.maxSqft} sf`)
  } else {
    // nothing fits: the step can say how wide the smallest plan is against the lot
    assert.ok(g.need && g.need.houseWidth > g.need.lotWidth, JSON.stringify(g.need))
  }
  // 80 ft lot: three beds and no garage fit (trimmed), so the step lets the client through
  const h = fitsLot({ ...DEFAULT_PROGRAM, beds: 3, baths: 2, garage: 0, sqft: 2800 }, style, defaultLot('mcallen', { width: 80, depth: 120 }))
  assert.equal(h.ok, true, h.reasons.join(' | '))
  const ok = fitsLot(ref, style, defaultLot('mission'))
  assert.equal(ok.ok, true)
  assert.equal(ok.maxSqft, null)
})

test('the rooms step only offers what the kit can draft', () => {
  const lim = programLimits(style)
  assert.deepEqual(lim.stories, [1, 1], 'the farmhouse kit is one story')
  assert.equal(lim.beds[0], 3)
  assert.ok(lim.garage[1] >= 3)
})
