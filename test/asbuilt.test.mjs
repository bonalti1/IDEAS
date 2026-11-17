// The program follows the plan: after "add a bedroom", "add a half bath" and "make the garage 3 cars",
// every screen's line, design.json, the summary and the title block say what the plan has.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateRooms, DEFAULT_PROGRAM, kitFor, programOf, programLine } from '../src/draft/lib/layout.js'
import { interpretRequest } from '../src/draft/lib/interpret.js'
import { buildDesign } from '../src/draft/lib/contract.js'
import { planSVG, planSheetHTML, summaryHTML, lotTitle } from '../src/draft/lib/plan-svg.js'
import { auditSummary } from '../src/draft/lib/audit.js'
import { estimate } from '../src/draft/lib/pricing.js'
import { TRUST } from '../src/draft/lib/trust.js'
import { STYLES } from '../src/draft/lib/styles.js'
import { DEFAULT_LOT, buildLot } from '../src/draft/lib/lot.js'

const style = STYLES.find((s) => s.id === 'farmhouse')
const kit = kitFor(style)
const offline = async () => {
  throw new Error('no api')
}

test('add a bedroom, add a half bath, make the garage 3 cars: the counts follow the plan everywhere', async () => {
  const program = { ...DEFAULT_PROGRAM }
  let rooms = generateRooms(program, style, DEFAULT_LOT)
  assert.equal(programLine(programOf(rooms, program)), '4 bed · 3.5 bath · 2-car · 1 story')
  for (const t of ['add a bedroom', 'add a half bath', 'make the garage 3 cars']) {
    const r = await interpretRequest(t, rooms, program, style, { lot: DEFAULT_LOT, interpreter: offline })
    assert.equal(r.applied, true, `${t}: ${r.reply}`)
    rooms = r.rooms
  }
  const ab = programOf(rooms, program)
  assert.equal(ab.beds, 5)
  assert.equal(ab.baths, 3)
  assert.equal(ab.halfBaths, 2)
  assert.equal(ab.garage, 3)
  assert.equal(programLine(ab), '5 bed · 3.2 bath · 3-car · 1 story')
  // design.json carries the plan as built beside the program the client started with
  const design = buildDesign({ rooms, program, style, lot: DEFAULT_LOT, client: 'Ana Garza' })
  assert.equal(design.program.beds, 4)
  assert.equal(design.asBuilt.beds, 5)
  assert.equal(design.asBuilt.garage, 3)
  assert.ok(design.asBuilt.livingSf > design.program.sqft)
  // the drawing's title, the sheet's title block and the summary say 5 bed, 3-car
  const svg = planSVG(design).svg
  assert.ok(svg.includes('5 bed, 3.2 bath, 3-car') || svg.includes('5 bed, 3'), svg.match(/FLOOR PLAN[^<]*/)?.[0])
  const sheet = planSheetHTML(design, kit.titleBlock)
  assert.ok(sheet.includes('5 bed, 3') && sheet.includes('3-car'))
  const summary = summaryHTML(design, estimate({ rooms, program, style, lot: DEFAULT_LOT }), auditSummary(rooms, program, kit, DEFAULT_LOT), TRUST, kit.titleBlock)
  assert.ok(summary.includes('5 bed, 3') && summary.includes('3-car garage'))
})

test('the audit panel marks warnings with their own state, and the living area is what is drawn', () => {
  const program = { ...DEFAULT_PROGRAM, beds: 3, baths: 2, halfBath: false, office: false, garage: 0, sqft: 1800 }
  const rooms = generateRooms(program, style, DEFAULT_LOT)
  const a = auditSummary(rooms, program, kit, DEFAULT_LOT)
  const area = a.groups.find((g) => g.id === 'area')
  // the kit's smallest 3/2 is over 1,800 sf: the area group warns, it does not pass green
  assert.equal(area.state, 'warn', JSON.stringify(area))
  assert.ok(a.warnings >= 1)
  assert.ok(a.groups.every((g) => ['pass', 'warn', 'fail'].includes(g.state)))
  const drawn = rooms.filter((r) => !r.element && !r.open && r.kind !== 'garage').reduce((s, r) => s + r.w * r.d, 0)
  assert.ok(Math.abs(a.measures.livingSf - drawn) < 1, `${a.measures.livingSf} vs ${drawn}`)
})

test('a typed-in lot with no address titles as "100 × 150 lot, McAllen"', () => {
  const lot = buildLot({ kind: 'manual', width: 100, depth: 150, city: 'mcallen', setbacks: {} })
  const rooms = generateRooms(DEFAULT_PROGRAM, style, lot)
  const design = buildDesign({ rooms, program: DEFAULT_PROGRAM, style, lot, client: 'Test' })
  assert.equal(lotTitle(design), '100 × 150 lot, McAllen')
  assert.ok(planSVG(design).svg.includes('100 × 150 lot, McAllen'))
  assert.ok(!planSheetHTML(design, kit.titleBlock).includes('Review · lot'))
})
