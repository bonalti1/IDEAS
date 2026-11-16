// The office worker side that can be tested without Revit: the design the worker gets, the dry-run
// self-check, the name mapping, and that the Revit scripts at least parse.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildDesign } from '../src/draft/lib/contract.js'
import { generateRooms } from '../src/draft/lib/layout.js'
import { STYLES } from '../src/draft/lib/styles.js'
import { KIT } from '../src/kits/modern-farmhouse.js'
import { DEFAULT_LOT } from '../src/draft/lib/lot.js'

const style = STYLES.find((s) => s.id === 'farmhouse')
const program = { ...KIT.reference.program }
const py = ['python3', 'python'].find((p) => spawnSync(p, ['--version']).status === 0)
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-worker-'))
const design = buildDesign({ rooms: generateRooms(program, style, DEFAULT_LOT), program, style, lot: DEFAULT_LOT, client: 'Garza' })
const designPath = path.join(dir, 'design.json')
fs.writeFileSync(designPath, JSON.stringify(design))
const run = (args) => {
  const r = spawnSync(py, args, { encoding: 'utf8' })
  return { code: r.status, out: r.stdout + r.stderr }
}

test('the design carries what the build script reads', () => {
  assert.equal(design.contract, 1)
  assert.ok(design.revit?.floorType, 'kit revit names travel with the design')
  assert.ok(design.revit.titleBlockFamily)
  assert.ok(design.footprint.length >= 4, 'slab outline')
  assert.ok(design.roof.centre && design.roof.scale, 'roof masses can be placed')
  assert.ok(design.walls.every((w) => w.revitType && w.plate > w.base))
  assert.ok(design.doors.every((d) => d.cased || d.revitFamily))
  assert.ok(design.windows.every((w) => w.revitFamily))
  // the slab outline encloses the plan: every solid room centre is inside it
  const inside = (pt, poly) => {
    let c = false
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, zi] = poly[i]
      const [xj, zj] = poly[j]
      if (zi > pt[1] !== zj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - zi)) / (zj - zi) + xi) c = !c
    }
    return c
  }
  assert.ok(design.footprints.length >= 1 && design.footprints[0] === design.footprint || design.footprints[0].length === design.footprint.length)
  design.rooms.filter((r) => !r.open).forEach((r) => assert.ok(design.footprints.some((ring) => inside([r.x, r.z], ring)), `${r.name} under a slab`))
})

test('the Revit scripts parse as Python', { skip: !py && 'no python' }, () => {
  for (const f of ['worker/draft_house_worker.py', 'worker/revit/build_model.py', 'worker/revit/list_names.py', 'worker/revit/smoke.py', 'worker/revit/selfcheck.py']) {
    const r = run(['-m', 'py_compile', f])
    assert.equal(r.code, 0, `${f}: ${r.out}`)
  }
})

test('selfcheck passes the Garza design and counts what the mapping still has to cover', { skip: !py && 'no python' }, () => {
  const r = run(['worker/revit/selfcheck.py', designPath, '--json'])
  assert.equal(r.code, 0, r.out)
  const j = JSON.parse(r.out)
  assert.equal(j.ok, true)
  assert.deepEqual(j.errors, [])
  assert.equal(j.counts.walls, design.walls.length)
  assert.equal(j.counts.roofMasses, design.roof.masses.length)
  assert.ok(j.counts.footprintPoints >= 4)
  assert.ok(j.distinctNames.doors.length >= 5)
  assert.equal(j.mapping, null, 'no kit.revit.json in the repo')
})

test('selfcheck with the example mapping and a template names file lists exactly the names that will fall back', { skip: !py && 'no python' }, () => {
  const names = {
    wallTypes: ['Exterior - 2x4 Board and Batten', 'Interior - 2x4', 'Interior - 2x6 Plumbing'],
    floorTypes: ['Slab on Grade - 4in'],
    roofTypes: ['Architectural Shingles on 2x6'],
    doors: ['Single-Flush : 30" x 80"', 'Single-Flush : 32" x 80"', 'Single-Flush : 24" x 80"', 'Single-Flush : 36" x 80"', 'Exterior - Single : 36" x 80"', 'Exterior - French Pair : 72" x 96"'],
    windows: ['Single Hung : 36" x 60"', 'Fixed : 42" x 36"', 'Fixed : 24" x 36"', 'Single Hung : 36" x 42"'],
    titleBlocks: ['STB Title Block : 24x36'],
    furniture: ['Bed - Queen', 'Sofa', 'Table - Dining', 'Desk', 'Bench', 'Coffee Table'],
    casework: ['Base Cabinet - Run', 'Island', 'Shelving', 'Linen Cabinet', 'Vanity - Single', 'Media Wall'],
    plumbing: ['Toilet - Standard', 'Shower Pan', 'Sink - Kitchen', 'Water Heater'],
    appliances: ['Refrigerator', 'Range', 'Washer', 'Dryer'],
    genericModels: [],
  }
  // take one door family the design really uses out of the template
  const used = [...new Set(design.doors.map((d) => d.revitFamily).filter(Boolean))]
  const missing = used.find((n) => names.doors.includes(n))
  names.doors = names.doors.filter((n) => n !== missing)
  const namesPath = path.join(dir, 'names.json')
  fs.writeFileSync(namesPath, JSON.stringify(names))
  const r = run(['worker/revit/selfcheck.py', designPath, '--map', 'worker/kit.revit.example.json', '--names', namesPath, '--json'])
  assert.equal(r.code, 0, r.out)
  const j = JSON.parse(r.out)
  assert.deepEqual(j.fallbacks.map((f) => f.wanted), [missing], 'exactly the removed door family falls back')
  // a mapping that points that kit name at a family the template has clears the fallback
  const mapped = JSON.parse(fs.readFileSync('worker/kit.revit.example.json', 'utf8'))
  mapped.doors[missing] = names.doors[0]
  const mapPath = path.join(dir, 'kit.revit.json')
  fs.writeFileSync(mapPath, JSON.stringify(mapped))
  const r2 = run(['worker/revit/selfcheck.py', designPath, '--map', mapPath, '--names', namesPath, '--json'])
  assert.deepEqual(JSON.parse(r2.out).fallbacks, [])
  // a broken design is refused
  fs.writeFileSync(path.join(dir, 'bad.json'), JSON.stringify({ contract: 2, rooms: [] }))
  const r3 = run(['worker/revit/selfcheck.py', path.join(dir, 'bad.json')])
  assert.equal(r3.code, 1)
  assert.match(r3.out, /contract is 2/)
})
