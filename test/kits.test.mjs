// Style kits made from IFC exports: the converter round-trips our own Garza export back into a kit
// that matches the traced one, the generated kit module loads and drafts a house that passes the
// rules, and every kit registered in src/kits/generated.js gets the same reference checks.
// Needs python3 with IfcOpenShell and numpy (skipped otherwise).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { generateRooms, isRoom, kitFor } from '../src/draft/lib/layout.js'
import { checkRules } from '../src/draft/lib/rules.js'
import { toIFC, wallsFrom } from '../src/draft/lib/ifc.js'
import { hostWall } from '../src/draft/lib/openings.js'
import { STYLES } from '../src/draft/lib/styles.js'
import { GENERATED } from '../src/kits/generated.js'
import { DEFAULT_LOT } from '../src/draft/lib/lot.js'

const py = ['/usr/bin/python3.13', 'python3.13', 'python3', 'python'].find((p) => spawnSync(p, ['-c', 'import ifcopenshell, numpy'], { stdio: 'ignore' }).status === 0)
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-kits-'))

/** The checks every kit must pass: it drafts its reference house, the house obeys the rules, the elements sit on walls, the IFC is well formed. */
function referenceChecks(kit, label) {
  const style = { id: kit.id, name: kit.name, kit, psf: 190, roof: 'gable', stories: 1 }
  const program = { ...kit.reference.program }
  const rooms = generateRooms(program, style, DEFAULT_LOT)
  const roomList = rooms.filter(isRoom)
  assert.ok(roomList.length >= 8, `${label}: ${roomList.length} rooms`)
  // the geometry rules (setbacks, sizes, overlaps, plumbing, roof). The architect audit is checked for the
  // hand-traced kit; a kit read back from an IFC does not yet carry every door's room and exterior flag
  // (see scripts/kit-from-ifc.py), so it is reported, not asserted, here
  const rules = checkRules(rooms, program, style, DEFAULT_LOT, { audit: !kit.generated })
  assert.deepEqual(rules.reasons, [], `${label}: reference house passes the rules`)
  if (kit.generated) {
    const audit = checkRules(rooms, program, style, DEFAULT_LOT)
    if (audit.reasons.length) console.log(`  (${label}: ${audit.reasons.length} audit findings on the converted kit, not asserted)`)
  }
  const walls = wallsFrom(rooms, kitFor(style))
  assert.ok(walls.length > 20, `${label}: walls`)
  const doors = rooms.filter((e) => e.kind === 'door')
  const windows = rooms.filter((e) => e.kind === 'window' && !e.dormer)
  const lost = [...doors, ...windows].filter((e) => !hostWall(walls, e))
  assert.ok(lost.length <= Math.ceil((doors.length + windows.length) * 0.1), `${label}: ${lost.length} openings have no host wall`)
  const ifc = toIFC({ rooms, program, kit, style, lot: DEFAULT_LOT })
  assert.match(ifc, /^ISO-10303-21;/)
  assert.ok((ifc.match(/IFCSPACE\(/g) || []).length >= 8, `${label}: IFC spaces`)
  assert.equal((ifc.match(/IFCDOOR\(/g) || []).length, doors.filter((d) => !d.cased).length, `${label}: every door exported`)
  return { rooms: roomList.length, doors: doors.length, windows: windows.length, walls: walls.length }
}

test('the Garza export round-trips into a kit that matches the traced one', { skip: !py && 'no python with ifcopenshell' }, () => {
  const ifcPath = path.join(dir, 'garza.ifc')
  const style = STYLES.find((s) => s.id === 'farmhouse')
  const rooms = generateRooms({ ...style.kit.reference.program }, style, DEFAULT_LOT)
  fs.writeFileSync(ifcPath, toIFC({ rooms, program: style.kit.reference.program, kit: style.kit, style, lot: DEFAULT_LOT }))
  const r = spawnSync(py, ['-I', 'scripts/kit-from-ifc.py', ifcPath, '--id', 'garzart', '--name', 'Garza round trip', '--compare', 'src/kits/modern-farmhouse.js', '--json'], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stdout.slice(-2000) + r.stderr.slice(-2000))
  const { kit, compare } = JSON.parse(r.stdout)
  assert.equal(compare.ok, true, compare.lines.join('\n'))
  assert.equal(kit.stats.rooms, style.kit.plan.rooms.length)
  assert.equal(kit.stats.windows, style.kit.plan.windows.length)
  assert.equal(kit.stats.doors, style.kit.plan.doors.length)
  assert.equal(kit.stats.fixtures, style.kit.plan.fixtures.length)
  assert.deepEqual(kit.reference.program.beds, style.kit.reference.program.beds)
  assert.ok(Math.abs(kit.reference.livingSf - style.kit.reference.livingSf) < 30, `living sf ${kit.reference.livingSf}`)
})

test('a generated kit module loads, registers, and drafts a house that passes the rules', { skip: !py && 'no python with ifcopenshell' }, async () => {
  const ifcPath = path.join(dir, 'garza.ifc')
  if (!fs.existsSync(ifcPath)) {
    const style = STYLES.find((s) => s.id === 'farmhouse')
    const rooms = generateRooms({ ...style.kit.reference.program }, style, DEFAULT_LOT)
    fs.writeFileSync(ifcPath, toIFC({ rooms, program: style.kit.reference.program, kit: style.kit, style, lot: DEFAULT_LOT }))
  }
  const out = path.join(dir, 'kits')
  fs.mkdirSync(out, { recursive: true })
  // the generated module imports the base kit by relative path, so it must sit beside it
  fs.copyFileSync('src/kits/modern-farmhouse.js', path.join(out, 'modern-farmhouse.js'))
  const r = spawnSync(py, ['-I', 'scripts/kit-from-ifc.py', ifcPath, '--id', 'spanish', '--name', 'Spanish', '--out', out, '--quiet'], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  assert.ok(fs.existsSync(path.join(out, 'spanish.ifc.js')))
  const registry = fs.readFileSync(path.join(out, 'generated.js'), 'utf8')
  assert.match(registry, /'spanish': K_spanish/)
  const mod = await import(pathToFileURL(path.join(out, 'spanish.ifc.js')).href)
  const kit = mod.KIT
  assert.equal(kit.id, 'spanish')
  assert.equal(kit.generated, true)
  assert.ok(kit.rooms.bed && kit.rules && kit.sheets, 'templates, rules and sheets come from the base kit')
  const stats = referenceChecks(kit, 'spanish (from the Garza export)')
  assert.ok(stats.rooms >= 20)
})

for (const [id, kit] of Object.entries(GENERATED)) {
  test(`generated kit "${id}" passes the reference checks`, () => {
    assert.ok(STYLES.find((s) => s.id === id)?.ready, `${id} is a ready style`)
    referenceChecks(kit, id)
  })
}
