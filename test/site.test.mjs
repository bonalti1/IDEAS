// The site plan: lot lines with their lengths, the setback envelope with each setback named, the house
// footprint, the driveway to the street, the front walk, the street name, a north arrow and the lot
// coverage, on every lot of the matrix; the driveway the 3D scene and the drawing share lands on the street.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateRooms, kitFor, isRoom } from '../src/draft/lib/layout.js'
import { buildDesign } from '../src/draft/lib/contract.js'
import { sitePlanSVG, planSheetHTML, sheetFor, planSVG } from '../src/draft/lib/plan-svg.js'
import { drivewaySlabs, walkSlabs, lotCoverage, streetZ } from '../src/draft/lib/site.js'
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
    assert.ok(Math.abs(far - streetZ(design.lot)) < 0.01, `driveway to the street (${far} vs ${streetZ(design.lot)})`)
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
