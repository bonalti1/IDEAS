// The plan audit: it catches what an architect catches (on plans broken on purpose), and the first
// draft passes it on the four test lots for the four test programs. The Garza sample passes too.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { auditPlan, auditDesign } from '../src/draft/lib/audit.js'
import { generateRooms, DEFAULT_PROGRAM, kitFor, isRoom } from '../src/draft/lib/layout.js'
import { fitsLot } from '../src/draft/lib/fit.js'
export { LOTS, PROGRAMS, draftable }
import { buildDesign } from '../src/draft/lib/contract.js'
import { STYLES } from '../src/draft/lib/styles.js'
import { DEFAULT_LOT, buildLot } from '../src/draft/lib/lot.js'
import { LOTS, PROGRAMS, draftable, convertedKit, styleFor } from './helpers.mjs'

const style = STYLES.find((s) => s.id === 'farmhouse')
const kit = kitFor(style)
const ids = (a) => a.errors.map((e) => e.id)

test('the default first draft passes the audit with 0 errors', () => {
  const a = auditPlan(generateRooms(DEFAULT_PROGRAM, style, DEFAULT_LOT), DEFAULT_PROGRAM, kit, DEFAULT_LOT)
  assert.deepEqual(a.errors, [])
})

test('the Garza sample passes the audit, and its work triangle and halls measure right', () => {
  const p = kit.reference.program
  const a = auditPlan(generateRooms(p, style, DEFAULT_LOT), p, kit, DEFAULT_LOT)
  assert.deepEqual(a.errors, [])
  assert.ok(a.measures.triangle.total <= 26, `triangle ${a.measures.triangle.total}`)
  a.measures.halls.forEach((h) => assert.ok(h.clearIn >= 42, `${h.name} ${h.clearIn}"`))
})

test('the audit catches a bedroom reached through another, a door to the outside, a blocked window and a garage with no door', () => {
  const rooms = generateRooms(PROGRAMS['4/3.5 office 2-car 2,800 sf'], style, DEFAULT_LOT)
  // Bedroom 3 loses its hall door: unreachable
  const fourth = rooms.find((r) => isRoom(r) && r.kind === 'bed' && r.name === 'Bedroom 3')
  const fourthDoor = rooms.find((e) => e.kind === 'door' && e.room === fourth.id && !e.cased)
  const noDoor = rooms.filter((e) => e !== fourthDoor)
  assert.ok(ids(auditPlan(noDoor, DEFAULT_PROGRAM, kit, DEFAULT_LOT)).includes('reach'))
  // Bedroom 1's door moved onto its outside wall
  const bed1 = rooms.find((r) => r.id === 'bed1')
  const outside = rooms.map((e) => (e.id === 'd-bed1' ? { ...e, x: bed1.x - 0.3, y: bed1.y + bed1.d / 2 - e.d / 2 } : e))
  assert.ok(ids(auditPlan(outside, DEFAULT_PROGRAM, kit, DEFAULT_LOT)).includes('door-outside'))
  // the garage loses its house door and its overhead door
  const noGarageDoors = rooms.filter((e) => !/^d-garage/.test(e.id))
  const g = ids(auditPlan(noGarageDoors, DEFAULT_PROGRAM, kit, DEFAULT_LOT))
  assert.ok(g.includes('garage-door') && g.includes('garage-overhead'), g.join(','))
  // the primary bath's door moved to the hall: the suite check
  const mbath = rooms.find((r) => r.id === 'mbath')
  const hallDoor = rooms.map((e) => (e.id === 'd-mbath' ? { ...e, axis: 'v', w: 0.6, d: 2.5, x: mbath.x - 0.3, y: mbath.y + 2 } : e))
  assert.ok(ids(auditPlan(hallDoor, DEFAULT_PROGRAM, kit, DEFAULT_LOT)).includes('suite-bath'))
  // a bedroom pushed onto another: overlap
  const bed2 = rooms.find((r) => r.id === 'bed2')
  const overlap = rooms.map((e) => (e.id === 'bed2' ? { ...e, y: bed2.y + 6 } : e))
  assert.ok(ids(auditPlan(overlap, DEFAULT_PROGRAM, kit, DEFAULT_LOT)).includes('overlap'))
  // a toilet with no room in front of it
  const bath = rooms.find((r) => r.id === 'bath1')
  const tight = rooms.map((e) => (e.kind === 'fixture' && e.fixture === 'toilet' && e.room === 'bath1' ? { ...e, face: 'n', y: bath.y + 0.2 } : e))
  assert.ok(ids(auditPlan(tight, DEFAULT_PROGRAM, kit, DEFAULT_LOT)).includes('toilet-front'))
})

test('bedroom egress: a fixed window is not an exit, a 36 x 60 single hung is', () => {
  const rooms = generateRooms(DEFAULT_PROGRAM, style, DEFAULT_LOT)
  const fixed = rooms.map((e) => (e.kind === 'window' && e.room === 'bed2' ? { ...e, mark: 'B', span: 3.5, w: e.axis === 'h' ? 3.5 : e.w, d: e.axis === 'h' ? e.d : 3.5 } : e))
  assert.ok(ids(auditPlan(fixed, DEFAULT_PROGRAM, kit, DEFAULT_LOT)).includes('egress'))
  assert.ok(!ids(auditPlan(rooms, DEFAULT_PROGRAM, kit, DEFAULT_LOT)).includes('egress'))
})

for (const [lotName, lot] of Object.entries(LOTS)) {
  for (const [progName, program] of Object.entries(PROGRAMS)) {
    test(`first draft audit: ${progName} on ${lotName}`, () => {
      // every cell drafts: the program, a size that fits, or an offer (the 5/4 3-car on the 50 ft lot drafts with a 2-car)
      const drafted = draftable(program, lot)
      assert.ok(drafted, `nothing fits: ${fitsLot(program, style, lot).reasons.join(' | ')}`)
      const rooms = generateRooms(drafted, style, lot)
      const a = auditPlan(rooms, drafted, kit, lot)
      assert.deepEqual(a.errors.map((e) => e.message), [])
      if (lotName.startsWith('narrow')) assert.equal(rooms.find((r) => r.kind === 'roof')?.plan, 'narrow', 'the 50 ft lot takes the narrow plan')
    })
  }
}

test('the narrow plan: 3/2 at 1,800 sf and 4/2 at 2,200 sf pass the audit on a 50 ft lot, within 3% of the size asked', () => {
  const lot = LOTS['narrow 50 x 120']
  for (const program of [{ ...DEFAULT_PROGRAM, beds: 3, baths: 2, halfBath: false, office: false, garage: 2, sqft: 1800 }, { ...DEFAULT_PROGRAM, beds: 4, baths: 2, halfBath: false, office: false, garage: 2, sqft: 2200 }]) {
    const f = fitsLot(program, style, lot)
    assert.equal(f.ok, true)
    // the rooms step drafts at the plan's smallest size when the ask is under it, and says so
    const asked = Math.max(program.sqft, f.draft.clamped ? f.draft.minSqft : 0)
    const drafted = { ...program, sqft: asked }
    const rooms = generateRooms(drafted, style, lot)
    const a = auditPlan(rooms, drafted, kit, lot)
    assert.deepEqual(a.errors.map((e) => e.message), [])
    assert.ok(Math.abs(a.measures.livingSf - asked) / asked <= 0.03, `${a.measures.livingSf} sf for ${asked} (asked ${program.sqft})`)
    assert.ok(asked <= program.sqft * 1.03, `the plan's smallest size ${asked} is within 3% of ${program.sqft}`)
    assert.equal(rooms.find((r) => r.kind === 'roof')?.plan, 'narrow')
  }
})

// a kit converted from an IFC (our own Garza export read back by scripts/kit-from-ifc.py) drafts the same matrix
{
  const conv = convertedKit()
  for (const [lotName, lot] of Object.entries(LOTS)) {
    for (const [progName, program] of Object.entries(PROGRAMS)) {
      test(`first draft audit on the IFC-converted kit: ${progName} on ${lotName}`, { skip: !conv && 'no python with ifcopenshell' }, () => {
        const cStyle = styleFor(conv)
        const drafted = draftable(program, lot, cStyle)
        assert.ok(drafted, `nothing fits: ${fitsLot(program, cStyle, lot).reasons.join(' | ')}`)
        const rooms = generateRooms(drafted, cStyle, lot)
        const a = auditPlan(rooms, drafted, conv, lot)
        assert.deepEqual(a.errors.map((e) => e.message), [])
        // the bedrooms asked for (the Garza set counts its mini primary apart from its 3 bedrooms)
        assert.equal(rooms.filter((r) => isRoom(r) && ['bed', 'master'].includes(r.kind)).length, drafted.beds, 'the bedrooms asked for')
      })
    }
  }
}

test('the audit reads a design.json the same way', () => {
  const rooms = generateRooms(DEFAULT_PROGRAM, style, DEFAULT_LOT)
  const design = buildDesign({ rooms, program: DEFAULT_PROGRAM, style, lot: DEFAULT_LOT, client: 'Test' })
  const a = auditDesign(design, kit)
  assert.deepEqual(a.errors, [])
  assert.ok(a.measures.triangle)
})

test('every door and window is a catalog size, and the rooms are still rooms', () => {
  for (const [, lot] of Object.entries(LOTS)) {
    for (const [, p] of Object.entries(PROGRAMS)) {
      const program = draftable(p, lot)
      const rooms = generateRooms(program, style, lot)
      const doorWidths = new Set(Object.values(kit.doors).filter((d) => d.w).flatMap((d) => [d.w, d.w * 2]))
      rooms.filter((e) => e.kind === 'door' && !e.cased).forEach((d) => assert.ok(doorWidths.has(Math.round(d.span * 12)), `${d.id} ${Math.round(d.span * 12)}"`))
      rooms.filter((e) => e.kind === 'window' && !e.dormer).forEach((w) => assert.ok([36, 72, 42, 24, 84].includes(Math.round(w.span * 12)), `${w.id} ${Math.round(w.span * 12)}"`))
      assert.ok(rooms.filter(isRoom).length >= 10)
    }
  }
})
