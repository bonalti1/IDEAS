// Convert every drafter export in kits-ifc/ into a style kit, register the styles, and report.
// usage: node scripts/convert-kits.mjs [kits-ifc]      (needs python3 with ifcopenshell and numpy)
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const dir = process.argv[2] || 'kits-ifc'
const STYLE_NAMES = { modern: 'Modern', farmhouse: 'Modern Farmhouse', spanish: 'Spanish', hillcountry: 'Hill Country', ranch: 'Ranch', craftsman: 'Craftsman', transitional: 'Transitional', tuscan: 'Tuscan', midcentury: 'Mid-Century', coastal: 'Coastal' }
const py = ['python3.13', 'python3', 'python'].map((p) => ({ p, ok: spawnSync(p, ['-c', 'import ifcopenshell, numpy'], { stdio: 'ignore' }).status === 0 })).find((x) => x.ok)?.p
if (!py) {
  console.error('no python with ifcopenshell and numpy on PATH (python3 -m pip install ifcopenshell numpy)')
  process.exit(2)
}
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.ifc$/i.test(f)) : []
if (!files.length) {
  console.log(`nothing to convert: put the drafters' IFC exports in ${dir}/ named by style id (see ${dir}/README.md)`)
  process.exit(0)
}
let failed = 0
for (const f of files) {
  const id = f.replace(/\.ifc$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '')
  const name = STYLE_NAMES[id] || id
  if (!STYLE_NAMES[id]) console.log(`note: ${f} is not a style id (${Object.keys(STYLE_NAMES).join(', ')}); the kit is written but no style will pick it up`)
  const r = spawnSync(py, ['-I', 'scripts/kit-from-ifc.py', path.join(dir, f), '--id', id, '--name', name], { encoding: 'utf8' })
  process.stdout.write(`${f} → ${id}\n${r.stdout}${r.stderr}`)
  if (r.status !== 0) failed++
}
console.log(failed ? `${failed} of ${files.length} failed` : `${files.length} kit${files.length === 1 ? '' : 's'} written; run npm test for the reference checks`)
process.exit(failed ? 1 : 0)
