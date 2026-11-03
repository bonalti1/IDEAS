// Export rooms and walls as plain boxes (local feet) for a dependency-free viewer.
// usage: node scripts/export-boxes.mjs boxes.json
import { generateRooms, outline, floorArea } from '../src/draft/lib/layout.js'
import { wallsFrom } from '../src/draft/lib/ifc.js'
import { STYLES } from '../src/draft/lib/styles.js'
import { KIT } from '../src/kits/modern-farmhouse.js'
import fs from 'node:fs'
const style = STYLES.find((s) => s.id === 'farmhouse')
const program = { ...KIT.reference.program }
const rooms = generateRooms(program, style)
const walls = wallsFrom(rooms, KIT)
const out = {
  rooms: rooms.map((r) => ({ n: r.name, k: r.kind, x: +r.local[0].toFixed(2), z: +r.local[1].toFixed(2), w: r.w, d: r.d, h: +r.h.toFixed(2), open: r.open })),
  walls: walls.map((w) => ({ a: w.a.map((v) => +v.toFixed(2)), b: w.b.map((v) => +v.toFixed(2)), t: +(w.thicknessIn / 12).toFixed(3), h: w.plate, ext: w.exterior, pl: w.plumbing })),
  stats: { livingSf: Math.round(floorArea(rooms, 1)), perimeter: Math.round(outline(rooms).perimeter), footprint: outline(rooms) },
}
fs.writeFileSync(process.argv[2], JSON.stringify(out))
console.log('rooms', out.rooms.length, 'walls', out.walls.length, 'bytes', JSON.stringify(out).length)
