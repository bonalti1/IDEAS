// The site plan: lot lines with their lengths, the setback envelope with each setback named, the house
// footprint, the driveway to the street, the front walk, the street name, a north arrow and the lot
// coverage, on every lot of the matrix; the driveway the 3D scene and the drawing share lands on the street.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateRooms, kitFor, isRoom } from '../src/draft/lib/layout.js'
import { buildDesign } from '../src/draft/lib/contract.js'
import { sitePlanSVG, planSheetHTML, sheetFor, planSVG } from '../src/draft/lib/plan-svg.js'
import { drivewaySlabs, walkSlabs, lotCoverage, streetZ, streetZAt } from '../src/draft/lib/site.js'
import { STYLES } from '../src/draft/lib/styles.js'
import { LOTS, PROGRAMS, draftable } from './helpers.mjs'

const style = STYLES.find((s) => s.id === 'farmhouse')
const kit = kitFor(style)

for (const [lotName, lot] of Object.entries(LOTS)) {
  test(`site plan: ${lotName}`, () => {
    const program = draftable(PROGRAMS['4/3.5 office 2-car 2,800 sf'], lot)
    const rooms = generateRooms(program, style, lot)
    const design = buildDesign({ rooms, program, style, lot, client: 'Test' })
    assert.ok(design.lot.edges?.length >= 3 && design.lot.corners?.length >= 3, 'design.json carries the lot edges and corners')
    const site = sitePlanSVG(design)
    const svg = site.svg
    assert.ok(svg.includes('id="lot-lines"') && svg.includes('id="setbacks"') && svg.includes('id="north"') && svg.includes('id="scale"') && svg.includes('id="coverage"'))
    assert.ok(svg.includes('class="driveway"') && svg.includes('class="walk"'), 'a driveway and a walk')
    assert.ok((svg.match(/class="footprint/g) || []).length === design.rooms.length, 'every room in the footprint')
    assert.ok(svg.includes('class="street"'), 'the street is named')
    assert.ok(/\d+' (front|side|rear|street side) setback/.test(svg), 'the setbacks are labelled')
    assert.ok(/class="lot-dim"[^>]*>\d+'-\d+"</.test(svg), 'the lot lines carry their lengths')
    assert.ok(site.coverage.pct > 0 && site.coverage.pct < 100 && svg.includes(`lot coverage ${site.coverage.pct}%`))
    assert.equal(site.coverage.footprintSf, Math.round(design.rooms.reduce((s, r) => s + r.w * r.d, 0)))
    // the driveway reaches the street edge of the lot and the walk starts at the front door
    const drive = drivewaySlabs(design.rooms, design.doors, design.lot)
    const far = Math.max(...drive.map((s) => s.z + s.d / 2))
    const last = drive[drive.length - 1]
    const edge = streetZAt(design.lot, last.x, Math.min(last.w, last.d) / 2 - 0.1, last.z - last.d / 2, streetZ(design.lot))
    assert.ok(Math.abs(far - edge) < 0.2 && far <= streetZ(design.lot) + 0.01, `driveway to the street edge on its own line (${far} vs ${edge}, lot front ${streetZ(design.lot)})`)
    const walk = walkSlabs(design.rooms, design.doors, design.lot, drive)
    const front = design.doors.find((d) => d.exterior && !d.overhead && d.axis === 'h')
    assert.ok(walk.length === 1 && Math.abs(walk[0].x - front.x) < 0.01 && walk[0].w === 4, 'a 4 ft walk from the front door')
    // the sheet: 1/4" on 24 x 36 fits every lot of the matrix
    assert.equal(sheetFor(planSVG(design)).plan[0], 0.25)
    assert.ok(planSheetHTML(design, kit.titleBlock).includes('Site plan'))
  })
}

test('the courtyard garage on the McAllen lot drives down the side yard: an apron, a leg across the rear, a lane to the street', () => {
  const lot = LOTS['McAllen 100 x 150']
  const program = PROGRAMS['4/3.5 office 2-car 2,800 sf']
  const rooms = generateRooms(program, style, lot)
  const design = buildDesign({ rooms, program, style, lot, client: 'Test' })
  const g = rooms.find((r) => isRoom(r) && r.kind === 'garage')
  const drive = drivewaySlabs(design.rooms, design.doors, design.lot)
  if (g.driveway === 'courtyard') {
    assert.deepEqual(drive.map((s) => s.part), ['apron', 'drive', 'drive'])
    assert.ok(drive[0].w === 25, 'a 25 ft apron')
  } else assert.ok(drive.length >= 1)
  assert.ok(lotCoverage(design.rooms, design.lot).pct <= 45)
})

// Round 5: the driveway is a real path. Every garage of the 4 x 4 matrix (and of the options the picker offers)
// has a driveway that crosses no room, stays inside the lot, starts at the overhead door, reaches the street,
// and has a 20 ft pocket on the inside of every turn. design.json carries the same path.
import { drivewayProblem, frameOf, intrusion, turnPocket, drivewayLength } from '../src/draft/lib/site.js'
import { withPlanCoords } from '../src/draft/lib/ops.js'
import { auditPlan } from '../src/draft/lib/audit.js'

for (const [lotName, lot] of Object.entries(LOTS)) {
  for (const [progName, program] of Object.entries(PROGRAMS)) {
    if (!program.garage) continue
    test(`a drivable driveway: ${progName} on ${lotName}`, () => {
      const drafted = draftable(program, lot)
      assert.ok(drafted)
      const rooms = generateRooms(drafted, style, lot)
      const g = rooms.find((r) => isRoom(r) && r.kind === 'garage')
      if (!g) {
        assert.equal(drafted.garage, 0, 'a garage asked for is drawn, or the rooms step offered a program without one')
        return
      }
      const design = buildDesign({ rooms, program: drafted, style, lot, client: 'Test' })
      const slabs = drivewaySlabs(design.rooms, design.doors, design.lot)
      assert.ok(slabs.length >= 1, 'a driveway')
      const solid = design.rooms.filter((r) => !r.open)
      slabs.forEach((s) => solid.forEach((r) => assert.ok(intrusion(s, r) <= 0.5, `${s.part} crosses ${r.name} on ${lotName}`)))
      assert.equal(drivewayProblem(slabs, design.rooms, design.doors, design.lot), null)
      assert.ok(design.site.driveway.length === slabs.length && design.site.drivewayFt === drivewayLength(slabs), 'design.json carries the same path')
      // the audit says the same, from the plan's own coordinates
      const a = auditPlan(rooms, drafted, kit, lot)
      assert.deepEqual(a.errors.filter((e) => e.id === 'garage-street'), [])
      assert.ok(a.measures.driveway && a.measures.driveway.problem === null && a.measures.driveway.lengthFt > 0)
    })
  }
}

test('the audit refuses a driveway through a room, one that leaves the lot, and a turn with no 20 ft pocket', () => {
  const program = PROGRAMS['4/3.5 office 2-car 2,800 sf']
  const lot = LOTS['reference (Lot 514)']
  const rooms = generateRooms(program, style, lot)
  const design = buildDesign({ rooms, program, style, lot, client: 'Test' })
  const slabs = drivewaySlabs(design.rooms, design.doors, design.lot)
  const garage = design.rooms.find((r) => r.kind === 'garage')
  // the lane bent through the house: a leg across the living room
  const living = design.rooms.find((r) => r.kind === 'living')
  const through = [slabs[0], { x: living.x, z: living.z, w: 12, d: 12, part: 'drive' }]
  assert.match(drivewayProblem(through, design.rooms, design.doors, design.lot) || '', /runs through the living/)
  // a lane out past the lot line
  const out = [{ ...slabs[0], x: slabs[0].x + 200 }]
  assert.match(drivewayProblem(out, design.rooms, design.doors, design.lot) || '', /leaves the lot|does not start/)
  // a side-load turn beside the house: the apron off the garage's east face, the lane down from the apron's outer
  // part; the 20 ft pocket on the inside of that turn lands on the house beside the garage, so the turn cannot be made
  const face = garage.x + garage.w / 2
  const apron = { x: face + 12.5, z: garage.z, w: 25, d: garage.d, part: 'apron' }
  const front = garage.z + garage.d / 2
  const laneEnd = streetZAt(design.lot, face + 19, 6, front)
  const lane = { x: face + 19, z: (front + laneEnd) / 2, w: 12, d: laneEnd - front, part: 'drive' }
  const pocket = turnPocket(apron, lane)
  assert.ok(pocket && pocket.w === 20 && pocket.d === 20, 'a 20 ft pocket on the inside of the turn')
  assert.ok(pocket.x - pocket.w / 2 < face && pocket.z > garage.z + garage.d / 2, 'the pocket reaches beside the house, on the inside of the turn')
  const problem = drivewayProblem([apron, lane], [...design.rooms.map((r) => ({ ...r })), { id: 'wall', kind: 'laundry', name: 'Laundry', x: face - 4, z: garage.z + garage.d / 2 + 8, w: 8, d: 15 }], design.doors.map((d) => (d.overhead ? { ...d, axis: 'v', x: face, z: garage.z } : d)), design.lot)
  assert.match(problem || '', /pocket on its inside/)
  // the layout never draws a courtyard garage whose leg runs through the garage (the round-4 bug)
  for (const [lotName, lotX] of Object.entries(LOTS)) {
    const r2 = generateRooms(program, style, lotX)
    const g2 = r2.find((r) => isRoom(r) && r.kind === 'garage')
    if (!g2) continue
    const d2 = buildDesign({ rooms: r2, program, style, lot: lotX, client: 'Test' })
    const s2 = drivewaySlabs(d2.rooms, d2.doors, d2.lot)
    s2.forEach((s) => assert.ok(intrusion(s, d2.rooms.find((r) => r.kind === 'garage')) <= 0.5, `${lotName}: the driveway does not run through the garage`))
  }
})

test('tabloid is always 1/8": the 5/4 3-car plan runs past one 11 x 17 sheet and is split in two, a 3/2 goes on one', () => {
  const big = PROGRAMS['5/4 with office and 3-car at 3,500 sf'] || Object.values(PROGRAMS).find((p) => p.beds === 5)
  const small = Object.values(PROGRAMS).find((p) => p.beds === 3 && !p.garage)
  assert.ok(big && small, 'both programs are in the matrix')
  const lot = LOTS['Lot 514'] || Object.values(LOTS)[0]
  for (const [program, expectSplit] of [[big, true], [small, false]]) {
    const drafted = draftable(program, lot)
    const design = buildDesign({ rooms: generateRooms(drafted, style, lot), program: drafted, kit, style, lot })
    const S = sheetFor(planSVG(design), 'tabloid')
    assert.equal(S.plan[0], 0.125, `${program.beds} bed tabloid at 1/8", got ${S.plan[1]}`)
    assert.equal(!!S.split, expectSplit, `${program.beds} bed: ${expectSplit ? 'two sheets with a match line' : 'one sheet'} (split=${S.split})`)
  }
})
