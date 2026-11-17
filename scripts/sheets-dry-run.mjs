// Dry run of the sheet set: which views, schedules and tags the Revit worker places on each sheet,
// from a design.json or from a draft built here. Needs no Revit; the real placement runs on the
// office PC (worker/revit/build_model.py reads the same plan from design.sheetPlan).
//   node scripts/sheets-dry-run.mjs design.json
//   node scripts/sheets-dry-run.mjs --default | --garza
import fs from 'node:fs'
import { sheetPlan, describeSheetPlan } from '../src/draft/lib/sheets.js'
import { generateRooms, DEFAULT_PROGRAM, kitFor } from '../src/draft/lib/layout.js'
import { buildDesign } from '../src/draft/lib/contract.js'
import { STYLES } from '../src/draft/lib/styles.js'
import { DEFAULT_LOT } from '../src/draft/lib/lot.js'

const args = process.argv.slice(2)
const style = STYLES.find((s) => s.id === 'farmhouse')
const kit = kitFor(style)
let design
if (args[0] && !args[0].startsWith('--')) design = JSON.parse(fs.readFileSync(args[0], 'utf8'))
else {
  const program = args.includes('--garza') ? { ...kit.reference.program } : { ...DEFAULT_PROGRAM }
  design = buildDesign({ rooms: generateRooms(program, style, DEFAULT_LOT), program, style, lot: DEFAULT_LOT, client: 'Dry run' })
}
const plan = design.sheetPlan || sheetPlan(design)
console.log(`Sheet set · ${design.client || ''} · ${design.style?.name || ''} · ${plan.length} sheets`)
console.log(describeSheetPlan(plan))
const views = plan.reduce((n, s) => n + s.views.length, 0)
const schedules = plan.reduce((n, s) => n + s.schedules.length, 0)
console.log(`\n${views} views and ${schedules} schedules to place. Needs Revit for the real run: the office PC tests worker/revit/build_model.py on this design.`)
