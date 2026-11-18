// Shared by the audit, garage, widths, plan-svg and kits tests: the four test lots, the four test
// programs, what the rooms step would draft for a program on a lot, and the Garza export read back
// into a kit by scripts/kit-from-ifc.py (null without python + IfcOpenShell).
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { generateRooms, DEFAULT_PROGRAM, kitFor } from '../src/draft/lib/layout.js'
import { fitsLot } from '../src/draft/lib/fit.js'
import { toIFC } from '../src/draft/lib/ifc.js'
import { STYLES } from '../src/draft/lib/styles.js'
import { DEFAULT_LOT, buildLot } from '../src/draft/lib/lot.js'

const style = STYLES.find((s) => s.id === 'farmhouse')
const kit = kitFor(style)

export const LOTS = {
  'reference (Lot 514)': DEFAULT_LOT,
  'McAllen 100 x 150': buildLot({ kind: 'manual', width: 100, depth: 150, city: 'mcallen', frontStreet: 'E Nolana Ave', setbacks: {} }),
  'narrow 50 x 120': buildLot({ kind: 'manual', width: 50, depth: 120, city: 'pharr', setbacks: {} }),
  'corner 110 x 140': buildLot({ kind: 'manual', width: 110, depth: 140, city: 'palmview', corner: 'left', sideStreet: 'Elm St', setbacks: {} }),
}
export const PROGRAMS = {
  '3/2 at 1,800 sf': { ...DEFAULT_PROGRAM, beds: 3, baths: 2, halfBath: false, office: false, garage: 0, sqft: 1800 },
  '4/3.5 office 2-car 2,800 sf': { ...DEFAULT_PROGRAM, beds: 4, baths: 3, halfBath: true, office: true, garage: 2, sqft: 2800 },
  '5/4 3-car 3,500 sf': { ...DEFAULT_PROGRAM, beds: 5, baths: 4, halfBath: false, office: true, garage: 3, sqft: 3500 },
  'Garza sample': { ...kit.reference.program },
}

/** What the rooms step drafts for a program on a lot: the program, it at the largest size that fits,
 * or the smallest change that fits (the offer); null when nothing does. */
export function draftable(program, lot, forStyle = style) {
  const f = fitsLot(program, forStyle, lot)
  if (f.ok) return program
  if (f.maxSqft) return { ...program, sqft: f.maxSqft }
  if (f.suggestion?.program) return f.suggestion.program
  return null
}

/** A style object for a kit, the way styles.js shapes them. */
export const styleFor = (k) => ({ id: k.id, name: k.name, kit: k, psf: 190, roof: 'gable', stories: 1 })

export const py = ['/usr/bin/python3.13', 'python3.13', 'python3', 'python'].find((p) => spawnSync(p, ['-c', 'import ifcopenshell, numpy'], { stdio: 'ignore' }).status === 0)
export const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-kits-'))

let converted
/** The Garza export converted into a kit (built once per process), or null without python + IfcOpenShell. */
export function convertedKit() {
  if (!py) return null
  if (converted !== undefined) return converted
  const ifcPath = path.join(scratch, 'garza-matrix.ifc')
  const rooms = generateRooms({ ...kit.reference.program }, style, DEFAULT_LOT)
  fs.writeFileSync(ifcPath, toIFC({ rooms, program: kit.reference.program, kit, style, lot: DEFAULT_LOT }))
  const out = path.join(scratch, 'kits-matrix')
  fs.mkdirSync(out, { recursive: true })
  fs.copyFileSync('src/kits/modern-farmhouse.js', path.join(out, 'modern-farmhouse.js'))
  fs.copyFileSync('src/kits/farmhouse-narrow.js', path.join(out, 'farmhouse-narrow.js'))
  fs.copyFileSync('src/kits/farmhouse-front-garage.js', path.join(out, 'farmhouse-front-garage.js'))
  const r = spawnSync(py, ['-I', 'scripts/kit-from-ifc.py', ifcPath, '--id', 'garzaifc', '--name', 'Garza (IFC)', '--out', out, '--quiet'], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(r.stderr)
  // the module is plain data around one JSON literal: read it here so the matrix can be declared synchronously
  const src = fs.readFileSync(path.join(out, 'garzaifc.ifc.js'), 'utf8')
  const PLAN = JSON.parse(src.slice(src.indexOf('const PLAN = ') + 'const PLAN = '.length, src.indexOf('\nexport const KIT')))
  converted = { ...kit, id: PLAN.id, name: PLAN.name, generated: true, source: PLAN.source, plates: { ...kit.plates, default: PLAN.plates.default, byRoom: { ...kit.plates.byRoom, ...PLAN.plates.byRoom } }, plan: PLAN.plan, reference: PLAN.reference, stats: PLAN.stats }
  return converted
}
