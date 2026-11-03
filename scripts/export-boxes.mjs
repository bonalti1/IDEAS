// Export rooms, wall pieces (cut for openings), doors, windows, and fixtures
// as plain boxes in local feet for a dependency-free viewer.
// usage: node scripts/export-boxes.mjs boxes.json
import { generateRooms, outline, floorArea, isRoom } from '../src/draft/lib/layout.js'
import { wallsFrom } from '../src/draft/lib/ifc.js'
import { splitWalls } from '../src/draft/lib/openings.js'
import { roofFaces } from '../src/draft/lib/roof.js'
import { STYLES } from '../src/draft/lib/styles.js'
import { KIT, WINDOW_SILL, WINDOW_HEAD, DOOR_HEAD } from '../src/kits/modern-farmhouse.js'
import fs from 'node:fs'
const style = STYLES.find((s) => s.id === 'farmhouse')
const program = { ...KIT.reference.program }
const all = generateRooms(program, style)
const rooms = all.filter(isRoom)
const elements = all.filter((r) => r.element)
const walls = wallsFrom(all, KIT)
const pieces = splitWalls(walls, elements)
const r2 = (v) => +(+v).toFixed(2)
const out = {
  rooms: rooms.map((r) => ({ n: r.name, k: r.kind, x: r2(r.local[0]), z: r2(r.local[1]), w: r.w, d: r.d, h: r2(r.h), open: r.open })),
  walls: pieces.map((w) => ({ a: w.a.map(r2), b: w.b.map(r2), t: r2(w.thicknessIn / 12), y0: r2(w.y0), h: r2(w.h), ext: w.exterior, kind: w.kind })),
  doors: elements.filter((e) => e.kind === 'door').map((e) => ({ x: r2(e.local[0]), z: r2(e.local[1]), span: r2(e.span), axis: e.axis, swing: e.swing, hinge: e.hinge, pair: !!e.pair, cased: !!e.cased, h: DOOR_HEAD })),
  windows: elements.filter((e) => e.kind === 'window' && !e.dormer).map((e) => ({ x: r2(e.local[0]), z: r2(e.local[1]), span: r2(e.span), axis: e.axis, mark: e.mark, sill: e.sill ?? WINDOW_SILL[e.mark], head: e.head ?? WINDOW_HEAD[e.mark] })),
  fixtures: elements.filter((e) => e.kind === 'fixture').map((e) => ({ k: e.fixture, n: e.name, x: r2(e.local[0]), z: r2(e.local[1]), w: r2(e.w), d: r2(e.d), h: r2(e.h), head: e.head, face: e.face })),
  roof: all.filter((r) => r.kind === 'roof').flatMap((r) => roofFaces(r.prisms)).map((f) => ({ pts: f.pts.map((p) => p.map(r2)), kind: f.kind, id: f.id })),
  stats: { roofMasses: all.filter((r) => r.kind === 'roof').reduce((n, r) => n + r.prisms.length, 0), livingSf: Math.round(floorArea(all, 1)), perimeter: Math.round(outline(all).perimeter), footprint: outline(all), walls: walls.length, exterior: walls.filter((w) => w.exterior).length },
}
fs.writeFileSync(process.argv[2] || 'boxes.json', JSON.stringify(out))
console.log('rooms', out.rooms.length, 'wall pieces', out.walls.length, 'doors', out.doors.length, 'windows', out.windows.length, 'fixtures', out.fixtures.length, 'roof faces', out.roof.length, 'bytes', JSON.stringify(out).length)
