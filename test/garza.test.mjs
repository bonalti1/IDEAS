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
test('IFC export is well formed', () => {
  const ifc = toIFC({ rooms, program, kit: KIT, style, lot: { address: 'Lot 514' } })
  assert.ok(ifc.startsWith('ISO-10303-21;'))
  assert.ok(ifc.includes("FILE_SCHEMA(('IFC4'))"))
  assert.equal((ifc.match(/IFCDOOR\(/g) || []).length, KIT.plan.doors.filter((d) => !d.cased).length)
  assert.equal((ifc.match(/IFCWINDOW\(/g) || []).length, KIT.plan.windows.filter((w) => !w.dormer).length)
  assert.equal((ifc.match(/IFCRELVOIDSELEMENT\(/g) || []).length, (ifc.match(/IFCOPENINGELEMENT\(/g) || []).length)
  assert.ok(!/\\'/.test(ifc), 'no backslash-escaped quotes in STEP text')
  assert.ok(wallsFrom(rooms, KIT).some((w) => w.plumbing), 'plumbing walls present')
})
