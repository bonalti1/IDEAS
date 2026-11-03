// IFC4 export of the draft: walls, floor slabs, and rooms as IfcSpace, placed
// on the lot. Written as STEP text with no library so it runs in the browser.
// Opens in Revit (Insert > Link IFC or Open IFC), BIMcollab Zoom, or any IFC viewer.
import { LOT_ANGLE } from '../../data/program.js'
import { ENVELOPE_CENTER, isConditioned } from './layout.js'

const FT = 0.3048
const m = (ft) => (ft * FT).toFixed(4)

// 22-char IFC GUID from random bytes
const B64 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$'
export function ifcGuid() {
  const bytes = new Uint8Array(16)
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes)
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  let out = ''
  let n = 0n
  for (const b of bytes) n = (n << 8n) | BigInt(b)
  for (let i = 0; i < 22; i++) {
    out = B64[Number(n & 63n)] + out
    n >>= 6n
  }
  return out
}

/** Wall segments from the room blocks, in local feet. Shared edges become one wall. */
export function wallsFrom(rooms, kit) {
  const solid = rooms.filter((r) => !r.open)
  const key = (a, b) => {
    const p = [a, b].sort((u, v) => u[0] - v[0] || u[1] - v[1])
    return p.map((q) => q.map((v) => v.toFixed(2)).join(',')).join('|')
  }
  const inside = (pt, r) => Math.abs(pt[0] - r.local[0]) < r.w / 2 - 0.01 && Math.abs(pt[1] - r.local[1]) < r.d / 2 - 0.01
  const seen = new Map()
  solid.forEach((r) => {
    const [cx, cz] = r.local
    const hw = r.w / 2
    const hd = r.d / 2
    const corners = [
      [cx - hw, cz - hd],
      [cx + hw, cz - hd],
      [cx + hw, cz + hd],
      [cx - hw, cz + hd],
    ]
    for (let i = 0; i < 4; i++) {
      const a = corners[i]
      const b = corners[(i + 1) % 4]
      const k = key(a, b)
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
      const nx = -(b[1] - a[1])
      const nz = b[0] - a[0]
      const len = Math.hypot(nx, nz)
      const probe = (s) => [mid[0] + (nx / len) * s, mid[1] + (nz / len) * s]
      // One probe lands inside this room; the other tells us what is beyond the edge.
      const neighbor = solid.find((o) => o !== r && (inside(probe(1.25), o) || inside(probe(-1.25), o)))
      const exterior = !neighbor
      const prev = seen.get(k)
      const plumbing = !!r.plumbing || !!neighbor?.plumbing
      if (prev) {
        prev.plate = Math.max(prev.plate, r.plate)
        prev.plumbing = prev.plumbing || plumbing
        prev.exterior = false
      } else {
        seen.set(k, { a, b, plate: r.plate, plumbing: plumbing && !exterior, exterior, rooms: [r.name] })
      }
    }
  })
  return [...seen.values()].map((w) => ({
    ...w,
    thicknessIn: w.exterior ? kit.walls.exterior.thicknessIn : w.plumbing ? kit.walls.plumbing.thicknessIn : kit.walls.interior.thicknessIn,
  }))
}

export function toIFC({ rooms, program, kit, style, lot, projectName = 'Draft House' }) {
  const lines = []
  let n = 0
  const add = (s) => {
    n++
    lines.push(`#${n}=${s};`)
    return n
  }
  const g = () => `'${ifcGuid()}'`
  const ts = Math.floor(Date.now() / 1000)

  // ── header & context ──────────────────────────────────────────────────
  const person = add(`IFCPERSON($,$,$,$,$,$,$,$)`)
  const org = add(`IFCORGANIZATION($,'${projectName}',$,$,$)`)
  const pao = add(`IFCPERSONANDORGANIZATION(#${person},#${org},$)`)
  const app = add(`IFCAPPLICATION(#${org},'0.1','${projectName}','DH')`)
  const oh = add(`IFCOWNERHISTORY(#${pao},#${app},$,.ADDED.,$,$,$,${ts})`)
  const uL = add(`IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)`)
  const uA = add(`IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)`)
  const uV = add(`IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)`)
  const uP = add(`IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)`)
  const units = add(`IFCUNITASSIGNMENT((#${uL},#${uA},#${uV},#${uP}))`)
  const origin = add(`IFCCARTESIANPOINT((0.,0.,0.))`)
  const zDir = add(`IFCDIRECTION((0.,0.,1.))`)
  const xDir = add(`IFCDIRECTION((1.,0.,0.))`)
  const wcs = add(`IFCAXIS2PLACEMENT3D(#${origin},#${zDir},#${xDir})`)
  const ctx = add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#${wcs},$)`)
  const body = add(`IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,#${ctx},$,.MODEL_VIEW.,$)`)
  const project = add(`IFCPROJECT(${g()},#${oh},'${projectName}','${style.name} draft',$,$,$,(#${ctx}),#${units})`)

  // ── site, building (rotated to the lot), storey ───────────────────────
  const sitePl = add(`IFCLOCALPLACEMENT($,#${wcs})`)
  const site = add(`IFCSITE(${g()},#${oh},'${(lot?.address || 'Lot').replace(/'/g, '')}',$,$,#${sitePl},$,$,.ELEMENT.,$,$,$,$,$)`)
  const cos = Math.cos(LOT_ANGLE)
  const sin = Math.sin(LOT_ANGLE)
  const bOrigin = add(`IFCCARTESIANPOINT((${m(ENVELOPE_CENTER[0])},${m(-ENVELOPE_CENTER[1])},0.))`)
  const bRef = add(`IFCDIRECTION((${cos.toFixed(6)},${(-sin).toFixed(6)},0.))`)
  const bAx = add(`IFCAXIS2PLACEMENT3D(#${bOrigin},#${zDir},#${bRef})`)
  const bPl = add(`IFCLOCALPLACEMENT(#${sitePl},#${bAx})`)
  const building = add(`IFCBUILDING(${g()},#${oh},'${style.name}',$,$,#${bPl},$,$,.ELEMENT.,$,$,$)`)
  const sPl = add(`IFCLOCALPLACEMENT(#${bPl},#${wcs})`)
  const storey = add(`IFCBUILDINGSTOREY(${g()},#${oh},'Level 1',$,$,#${sPl},$,$,.ELEMENT.,0.)`)
  add(`IFCRELAGGREGATES(${g()},#${oh},$,$,#${project},(#${site}))`)
  add(`IFCRELAGGREGATES(${g()},#${oh},$,$,#${site},(#${building}))`)
  add(`IFCRELAGGREGATES(${g()},#${oh},$,$,#${building},(#${storey}))`)

  // helper: extruded rectangle body. (x, y) local metres, w along x, d along y.
  const box = (x, y, z, w, d, h, dirX = [1, 0]) => {
    const p = add(`IFCCARTESIANPOINT((${x},${y},${z}))`)
    const dx = add(`IFCDIRECTION((${dirX[0].toFixed(6)},${dirX[1].toFixed(6)},0.))`)
    const ax = add(`IFCAXIS2PLACEMENT3D(#${p},#${zDir},#${dx})`)
    const pl = add(`IFCLOCALPLACEMENT(#${sPl},#${ax})`)
    const p2 = add(`IFCCARTESIANPOINT((${(w / 2).toFixed(4)},${(d / 2).toFixed(4)}))`)
    const ax2 = add(`IFCAXIS2PLACEMENT2D(#${p2},$)`)
    const prof = add(`IFCRECTANGLEPROFILEDEF(.AREA.,$,#${ax2},${w.toFixed(4)},${d.toFixed(4)})`)
    const solid = add(`IFCEXTRUDEDAREASOLID(#${prof},#${wcs},#${zDir},${h.toFixed(4)})`)
    const rep = add(`IFCSHAPEREPRESENTATION(#${body},'Body','SweptSolid',(#${solid}))`)
    const shape = add(`IFCPRODUCTDEFINITIONSHAPE($,$,(#${rep}))`)
    return { pl, shape }
  }
  // local feet (lx along front, lz front to back) → IFC local metres (x, y north)
  const X = (lx) => lx * FT
  const Y = (lz) => -lz * FT

  // ── walls ─────────────────────────────────────────────────────────────
  const walls = wallsFrom(rooms, kit)
  const wallIds = walls.map((w, i) => {
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) * FT
    const t = (w.thicknessIn / 12) * FT
    const dir = [(X(w.b[0]) - X(w.a[0])) / len, (Y(w.b[1]) - Y(w.a[1])) / len]
    // start at a, offset half thickness to the left so the wall is centred on the line
    const sx = X(w.a[0]) - dir[1] * (t / 2)
    const sy = Y(w.a[1]) + dir[0] * (t / 2)
    const { pl, shape } = box(sx.toFixed(4), sy.toFixed(4), '0.', len, t, w.plate * FT, dir)
    return add(`IFCWALL(${g()},#${oh},'${w.exterior ? 'Exterior' : w.plumbing ? 'Plumbing' : 'Interior'} wall ${i + 1}','${w.thicknessIn}" ${w.exterior ? kit.walls.exterior.studs : w.plumbing ? kit.walls.plumbing.studs : kit.walls.interior.studs}',$,#${pl},#${shape},$,.STANDARD.)`)
  })

  // ── slabs: one per solid room footprint, 4" below finished floor ──────
  const slabT = (4 / 12) * FT
  const slabIds = rooms
    .filter((r) => !r.open)
    .map((r) => {
      const { pl, shape } = box(X(r.local[0] - r.w / 2).toFixed(4), Y(r.local[1] + r.d / 2).toFixed(4), (-slabT).toFixed(4), r.w * FT, r.d * FT, slabT)
      return add(`IFCSLAB(${g()},#${oh},'Slab ${r.name}','${kit.foundation.slab}',$,#${pl},#${shape},$,.FLOOR.)`)
    })

  // ── spaces (rooms) ────────────────────────────────────────────────────
  const spaceIds = rooms.map((r) => {
    const h = r.open ? 0.3 : r.plate * FT
    const { pl, shape } = box(X(r.local[0] - r.w / 2).toFixed(4), Y(r.local[1] + r.d / 2).toFixed(4), '0.', r.w * FT, r.d * FT, h)
    return add(`IFCSPACE(${g()},#${oh},'${r.name}','${r.w} ft x ${r.d} ft',$,#${pl},#${shape},$,.ELEMENT.,.${r.open ? 'EXTERNAL' : 'INTERNAL'}.,$)`)
  })
  add(`IFCRELAGGREGATES(${g()},#${oh},$,$,#${storey},(${spaceIds.map((i) => '#' + i).join(',')}))`)
  add(`IFCRELCONTAINEDINSPATIALSTRUCTURE(${g()},#${oh},$,$,(${[...wallIds, ...slabIds].map((i) => '#' + i).join(',')}),#${storey})`)

  // ── property set: what the drafter needs to know ──────────────────────
  const props = [
    ['Style', style.name],
    ['Kit', `${kit.name} (${kit.source.plan} rev ${kit.source.rev})`],
    ['Program', `${program.beds} bed, ${program.baths}${program.halfBath ? '.5' : ''} bath, ${program.garage}-car, ${program.stories} story`],
    ['Roof', `${kit.roof.pitch}, ${kit.roof.rafters}, ${kit.roof.overhang} overhang`],
    ['Plates', `${kit.plates.default}' typ, ${kit.plates.public}' public, ${kit.plates.vaulted}' vault`],
    ['Exterior', `${kit.exterior.siding}; ${kit.exterior.accent}`],
    ['Foundation', kit.foundation.slab],
  ].map(([k, v]) => add(`IFCPROPERTYSINGLEVALUE('${k}',$,IFCTEXT('${String(v).replace(/'/g, '')}'),$)`))
  const pset = add(`IFCPROPERTYSET(${g()},#${oh},'DraftHouse',$,(${props.map((i) => '#' + i).join(',')}))`)
  add(`IFCRELDEFINESBYPROPERTIES(${g()},#${oh},$,$,(#${building}),#${pset})`)

  const date = new Date().toISOString().slice(0, 19)
  return [
    'ISO-10303-21;',
    'HEADER;',
    `FILE_DESCRIPTION(('ViewDefinition [ReferenceView_V1.2]'),'2;1');`,
    `FILE_NAME('draft-house.ifc','${date}',('${projectName}'),('${kit.titleBlock?.firm || ''}'),'${projectName} 0.1','${projectName}','');`,
    `FILE_SCHEMA(('IFC4'));`,
    'ENDSEC;',
    'DATA;',
    ...lines,
    'ENDSEC;',
    'END-ISO-10303-21;',
    '',
  ].join('\n')
}

export function downloadIFC(args) {
  const text = toIFC(args)
  const blob = new Blob([text], { type: 'application/x-step' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `draft-house-${(args.lot?.address || 'lot').replace(/\W+/g, '-').toLowerCase().slice(0, 30)}.ifc`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  return text
}
