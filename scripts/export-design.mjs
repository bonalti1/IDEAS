// Write the Garza reference design as design.json, the file the office worker builds from.
// usage: node scripts/export-design.mjs [out.json]
import fs from 'node:fs'
import { buildDesign } from '../src/draft/lib/contract.js'
import { generateRooms } from '../src/draft/lib/layout.js'
import { STYLES } from '../src/draft/lib/styles.js'
import { KIT } from '../src/kits/modern-farmhouse.js'
import { DEFAULT_LOT } from '../src/draft/lib/lot.js'

const style = STYLES.find((s) => s.id === 'farmhouse')
const program = { ...KIT.reference.program }
const rooms = generateRooms(program, style, DEFAULT_LOT)
const design = buildDesign({ rooms, program, style, lot: DEFAULT_LOT, client: 'Edgar & Denise Garza', history: [] })
const out = process.argv[2] || 'design.json'
fs.writeFileSync(out, JSON.stringify(design, null, 2))
console.log(`${out}: ${design.rooms.length} rooms, ${design.walls.length} walls, ${design.doors.length} doors, ${design.windows.length} windows, ${design.fixtures.length} fixtures, ${design.roof?.masses.length || 0} roof masses, footprint ${design.footprint.length} points`)
