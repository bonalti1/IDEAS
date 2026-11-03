// Export the Garza reference program as IFC without the browser.
// usage: node scripts/export-ifc.mjs out.ifc
import { generateRooms } from '../src/draft/lib/layout.js'
import { toIFC, wallsFrom } from '../src/draft/lib/ifc.js'
import { STYLES } from '../src/draft/lib/styles.js'
import { KIT } from '../src/kits/modern-farmhouse.js'
import fs from 'node:fs'
const style = STYLES.find((s) => s.id === 'farmhouse')
const program = { ...KIT.reference.program }
const rooms = generateRooms(program, style)
const walls = wallsFrom(rooms, KIT)
console.log('walls', walls.length, 'exterior', walls.filter((w) => w.exterior).length, 'plumbing', walls.filter((w) => w.plumbing && !w.exterior).length)
const text = toIFC({ rooms, program, kit: KIT, style, lot: { address: 'Lot 514, Villa-Rama East Phase V' } })
fs.writeFileSync(process.argv[2] || 'draft-house.ifc', text)
console.log('bytes', text.length, 'lines', text.split('\n').length)
