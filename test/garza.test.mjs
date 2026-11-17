// Reference test: the Garza program through the farmhouse kit must stay
// within 5% of the numbers on the real set (cover sheet, FD-25083 rev 08).
// run: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateRooms, isRoom } from '../src/draft/lib/layout.js'
import { takeoff } from '../src/draft/lib/takeoff.js'
import { toIFC, wallsFrom } from '../src/draft/lib/ifc.js'
import { STYLES } from '../src/draft/lib/styles.js'
import { KIT } from '../src/kits/modern-farmhouse.js'

const style = STYLES.find((s) => s.id === 'farmhouse')
const program = { ...KIT.reference.program }
const rooms = generateRooms(program, style)
const t = takeoff(rooms, program, KIT)
const ref = KIT.reference
const within = (a, b, pct, what) => assert.ok(Math.abs(a - b) / b <= pct, `${what}: app ${Math.round(a)} vs set ${b}`)

test('areas match the cover sheet', () => {
  within(t.areas.living, ref.livingSf, 0.02, 'living sf')
  within(t.areas.frontPorch, ref.frontPorchSf, 0.05, 'front porch')
  within(t.areas.rearPorch, ref.rearPorchSf, 0.05, 'rear porch')
  within(t.areas.total, ref.totalSf, 0.02, 'total')
})
test('material takeoff matches the cover sheet', () => {
  within(t.sidingSf, ref.takeoff.boardBattenSf, 0.06, 'board and batten')
  within(t.stoneSf, ref.takeoff.stoneSf, 0.06, 'stone')
  within(t.showerTileSf, ref.takeoff.showerTileSf, 0.02, 'shower tile')
})
test('schedules match the set', () => {
  assert.equal(t.counts.exteriorDoors, ref.takeoff.exteriorDoors)
  assert.equal(t.counts.singleHung, ref.takeoff.singleHung)
  assert.equal(t.counts.fixed, ref.takeoff.fixed)
  within(t.counts.interiorDoors, ref.takeoff.interiorDoors, 0.15, 'interior doors')
})
test('plan has the traced rooms, openings, and fixtures', () => {
  assert.equal(rooms.filter(isRoom).length, KIT.plan.rooms.length)
  assert.equal(rooms.filter((r) => r.kind === 'door').length, KIT.plan.doors.length)
  assert.equal(rooms.filter((r) => r.kind === 'fixture').length, KIT.plan.fixtures.length)
})
test('roof follows sheet 100', () => {
  const roof = rooms.find((r) => r.kind === 'roof')
  assert.equal(roof.masses.length, KIT.plan.roof.length)
  const top = (id) => Math.max(...roof.faces.filter((f) => f.mass === id && f.kind === 'slope').flatMap((f) => f.rings[0].map((p) => p[1])))
  assert.ok(top('main') > 21 && top('main') < 24, `main ridge ${top('main').toFixed(1)} ft`)
  assert.ok(top('leftwing') > 19, 'left wing gable peaks near 20 ft like the front elevation')
  for (const id of ['leftwing', 'office', 'pantry', 'master', 'frontPorch', 'rearPorch', 'dormer']) assert.ok(roof.faces.some((f) => f.mass === id), `roof mass ${id} is visible`)
  // valleys: no visible slope of one mass sits under another mass's plane
  const slopes = roof.faces.filter((f) => f.kind === 'slope')
  const hAt = (p, x, z) => p.a * x + p.b * z + p.c
  let under = 0
  // a vertex counts as buried only if it is clearly inside the other face, not on its boundary
  const strictly = (g, x, z) => [[0.15, 0], [-0.15, 0], [0, 0.15], [0, -0.15]].every(([dx, dz]) => inside(g.rings[0], x + dx, z + dz) && !g.rings.slice(1).some((h) => inside(h, x + dx, z + dz)))
  slopes.forEach((f) => f.rings[0].forEach(([x, y, z]) => slopes.forEach((g) => { if (g.mass !== f.mass && g.plane && hAt(g.plane, x, z) > y + 0.5 && strictly(g, x, z)) under++ })))
  function inside(r, x, z) { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { if (r[i][2] > z !== r[j][2] > z && x < ((r[j][0] - r[i][0]) * (z - r[i][2])) / (r[j][2] - r[i][2]) + r[i][0]) c = !c } return c }
  assert.equal(under, 0, 'visible roof vertices buried under another roof')
})
test('IFC export is well formed', () => {
  const ifc = toIFC({ rooms, program, kit: KIT, style, lot: { address: 'Lot 514' } })
  assert.ok(ifc.startsWith('ISO-10303-21;'))
  assert.ok(ifc.includes("FILE_SCHEMA(('IFC4'))"))
  assert.equal((ifc.match(/IFCDOOR\(/g) || []).length, KIT.plan.doors.filter((d) => !d.cased).length)
  assert.equal((ifc.match(/IFCWINDOW\(/g) || []).length, KIT.plan.windows.filter((w) => !w.dormer).length)
  assert.equal((ifc.match(/IFCRELVOIDSELEMENT\(/g) || []).length, (ifc.match(/IFCOPENINGELEMENT\(/g) || []).length)
  assert.ok(!/\\'/.test(ifc), 'no backslash-escaped quotes in STEP text')
  assert.equal((ifc.match(/IFCROOF\(/g) || []).length, 1)
  assert.ok((ifc.match(/IFCSLAB\([^\n]*\.ROOF\.\)/g) || []).length > 20, 'roof panels')
  // every quoted string must have apostrophes doubled: no odd lone apostrophe inside a line
  ifc.split('\n').forEach((line) => assert.ok(((line.match(/'/g) || []).length % 2) === 0, 'unbalanced quote: ' + line.slice(0, 80)))
  assert.ok(wallsFrom(rooms, KIT).some((w) => w.plumbing), 'plumbing walls present')
})
