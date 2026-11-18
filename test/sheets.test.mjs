// The sheet set the worker places (dry run, no Revit), the design.json it reads it from, and the
// trust content's placeholders, listed so they can be filled before launch.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { sheetPlan, describeSheetPlan } from '../src/draft/lib/sheets.js'
import { generateRooms, DEFAULT_PROGRAM, kitFor } from '../src/draft/lib/layout.js'
import { buildDesign } from '../src/draft/lib/contract.js'
import { STYLES } from '../src/draft/lib/styles.js'
import { DEFAULT_LOT } from '../src/draft/lib/lot.js'
import { TRUST } from '../src/draft/lib/trust.js'
import { summaryHTML } from '../src/draft/lib/plan-svg.js'
import { estimate } from '../src/draft/lib/pricing.js'
import { auditSummary } from '../src/draft/lib/audit.js'

const style = STYLES.find((s) => s.id === 'farmhouse')
const kit = kitFor(style)

test('the sheet plan puts the floor plan with tags and schedules on 200, the elevations on 300 and 301, the roof plan on 100, the site plan on 99 and the index on the cover', () => {
  const program = { ...DEFAULT_PROGRAM }
  const rooms = generateRooms(program, style, DEFAULT_LOT)
  const design = buildDesign({ rooms, program, style, lot: DEFAULT_LOT, client: 'Test' })
  assert.ok(Array.isArray(design.sheetPlan) && design.sheetPlan.length === kit.sheets.length, 'design.json carries the plan')
  const plan = sheetPlan(design)
  const by = Object.fromEntries(plan.map((s) => [s.no, s]))
  const p200 = by['200'].views.find((v) => v.name === 'Floor Plan')
  assert.ok(p200 && p200.tags.doors === design.doors.filter((d) => !d.cased).length && p200.tags.windows === design.windows.length && p200.dimensions)
  assert.deepEqual(by['200'].schedules, ['Door Schedule', 'Window Schedule'])
  assert.deepEqual(by['300'].views.map((v) => v.name), ['Front Elevation', 'Rear Elevation'])
  assert.deepEqual(by['301'].views.map((v) => v.name), ['Left Elevation', 'Right Elevation'])
  assert.equal(by['100'].views[0].name, 'Roof Plan')
  assert.equal(by['99'].views[0].name, 'Site Plan')
  assert.ok(by['99'].views[0].contents.some((c) => /driveway/.test(c)), 'the driveway is on the site plan')
  assert.ok(by.CVR.schedules.includes('Sheet index'))
  const text = describeSheetPlan(plan)
  assert.ok(text.split('\n').length === plan.length && /door tags/.test(text))
  // the dry-run script prints it and says it needs Revit for the real run
  const r = spawnSync(process.execPath, ['scripts/sheets-dry-run.mjs', '--default'], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /11 views and 4 schedules/)
  assert.match(r.stdout, /Needs Revit/)
})

test('the worker reads the same plan (worker/revit/build_model.py places per design.sheetPlan and reports what it could not place)', async () => {
  const fs = await import('node:fs')
  const py = fs.readFileSync('worker/revit/build_model.py', 'utf8')
  for (const needle of ["DESIGN.get('sheetPlan')", 'IndependentTag.Create', 'CreateElevationMarker', 'CreateSheetList', "'Door Schedule'", "'Roof Plan'", "'Site Plan'", 'NewDimension', "report['sheetsNotPlaced']"]) assert.ok(py.includes(needle), needle)
})

test('the trust content names its placeholders, and the summary page carries the plan, the checks and the cost sentence, never a price (round 8)', () => {
  assert.ok(TRUST.drafter.placeholder === true && TRUST.drafter.photo === null, 'the drafter name and photo are placeholders until Rolando supplies them')
  assert.ok(TRUST.next.length >= 3 && TRUST.next.every((n) => n.when && n.what))
  assert.match(TRUST.checked, /IRC/)
  const program = { ...DEFAULT_PROGRAM }
  const rooms = generateRooms(program, style, DEFAULT_LOT)
  const design = buildDesign({ rooms, program, style, lot: DEFAULT_LOT, client: 'Test Client' })
  const html = summaryHTML(design, auditSummary(rooms, program, kit, DEFAULT_LOT), TRUST, kit.titleBlock)
  assert.ok(html.includes('<svg') && html.includes('Checked before you saw it') && (html.match(/class="ok"/g) || []).length >= 8)
  assert.match(html, /we go over cost with you at your meeting with the South Texas Builders office/i, 'the cost sentence')
  assert.doesNotMatch(html.replace(/<svg[\s\S]*?<\/svg>/g, ''), /\$|\d+k\b|\/sf/, 'no money on the client summary')
  assert.ok(html.includes(kit.titleBlock.firm))
})
