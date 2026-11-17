// The plan audit with measurements, for a design.json or for a draft built here.
//   node scripts/plan-audit.mjs design.json
//   node scripts/plan-audit.mjs --default            the starter program on the reference lot
//   node scripts/plan-audit.mjs --garza              the Garza sample on the reference lot
//   node scripts/plan-audit.mjs --program '{"beds":5,...}' [--lot 100x150:mcallen]
import fs from 'node:fs'
import { auditPlan, auditDesign } from '../src/draft/lib/audit.js'
import { generateRooms, DEFAULT_PROGRAM, kitFor, isRoom, floorArea } from '../src/draft/lib/layout.js'
import { STYLES } from '../src/draft/lib/styles.js'
import { DEFAULT_LOT, buildLot } from '../src/draft/lib/lot.js'
import { takeoff } from '../src/draft/lib/takeoff.js'

const args = process.argv.slice(2)
const style = STYLES.find((s) => s.id === 'farmhouse')
const kit = kitFor(style)
let audit
let rooms
let program
let title
if (args[0] && !args[0].startsWith('--')) {
  const design = JSON.parse(fs.readFileSync(args[0], 'utf8'))
  audit = auditDesign(design, STYLES.find((s) => s.id === design.style?.id) || style)
  program = design.program
  title = `${args[0]}: ${design.client || ''} ${design.style?.name || ''}`
} else {
  const lotArg = args[args.indexOf('--lot') + 1]
  const lot = args.includes('--lot') && lotArg ? (() => { const [dims, city] = lotArg.split(':'); const [w, d] = dims.split('x').map(Number); return buildLot({ kind: 'manual', width: w, depth: d, city: city || 'hidalgo', setbacks: {} }) })() : DEFAULT_LOT
  program = args.includes('--garza') ? { ...kit.reference.program } : args.includes('--program') ? { ...DEFAULT_PROGRAM, ...JSON.parse(args[args.indexOf('--program') + 1]) } : { ...DEFAULT_PROGRAM }
  rooms = generateRooms(program, style, lot)
  audit = auditPlan(rooms, program, kit, lot)
  title = `${args.includes('--garza') ? 'Garza sample' : 'first draft'}: ${program.beds} bed, ${program.baths}${program.halfBath ? '.5' : ''} bath, ${program.garage}-car, ${program.sqft} sf on ${lot.address || `${lot.spec.width}x${lot.spec.depth} ${lot.city}`}`
}

console.log(`Plan audit · ${title}`)
console.log(audit.ok ? '  0 errors' : `  ${audit.errors.length} error${audit.errors.length === 1 ? '' : 's'}`)
audit.errors.forEach((f) => console.log(`  ✗ [${f.id}] ${f.message}`))
audit.warnings.forEach((f) => console.log(`  ! [${f.id}] ${f.message}`))
const m = audit.measures
console.log('Measurements')
if (m.requestedSf) console.log(`  living area: ${m.livingSf} sf delivered, ${m.requestedSf} sf asked (${((m.livingSf / m.requestedSf - 1) * 100).toFixed(1)}%)`)
else console.log(`  living area: ${m.livingSf} sf`)
if (m.triangle) console.log(`  kitchen work triangle: ${m.triangle.total} ft (legs ${m.triangle.legs.join(', ')})`)
if (m.halls?.length) console.log(`  halls: ${m.halls.map((h) => `${h.name} ${h.clearIn}" clear`).join('; ')}`)
if (m.doors?.length) {
  const widths = {}
  m.doors.forEach((d) => (widths[d.widthIn] = (widths[d.widthIn] || 0) + 1))
  console.log(`  door widths: ${Object.entries(widths).sort((a, b) => a[0] - b[0]).map(([w, n]) => `${w}" ×${n}`).join(', ')}`)
}
if (rooms) {
  const t = takeoff(rooms, program, kit)
  console.log(`  windows: ${t.windows.map((w) => `${w.mark} ${w.w}x${w.h} ×${w.count}`).join(', ')}`)
  console.log(`  rooms: ${rooms.filter(isRoom).length}, floor area ${Math.round(floorArea(rooms, program.stories))} sf`)
}
process.exit(audit.ok ? 0 : 1)
