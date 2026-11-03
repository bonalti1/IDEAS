// IFC4 export of the draft: walls, floor slabs, and rooms as IfcSpace, placed
// on the lot. Written as STEP text with no library so it runs in the browser.
// Opens in Revit (Insert > Link IFC or Open IFC), BIMcollab Zoom, or any IFC viewer.
import { LOT_ANGLE } from '../../data/program.js'
import { ENVELOPE_CENTER, isConditioned } from './layout.js'
import { hostWall } from './openings.js'
import { WINDOW_SILL, WINDOW_HEAD, DOOR_HEAD, FIXTURE_NAME } from '../../kits/modern-farmhouse.js'

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

/**
 * Wall segments from the room blocks, in local feet. Each room edge is sampled
 * every half foot; runs with a neighbour become interior walls, runs with no
 * neighbour exterior walls, and runs facing a room the kit lists as open to
 * this one get no wall at all. Exact shared edges are emitted once.
 */
export function wallsFrom(rooms, kit) {
  const solid = rooms.filter((r) => !r.open && !r.element)
  const openPairs = new Set((kit.plan?.open || []).flatMap(([a, b]) => [a + '|' + b, b + '|' + a]))
  const isOpen = (r, o) => openPairs.has(r.id + '|' + o.id) || openPairs.has(r.kind + '|' + o.kind)
  const inside = (pt, r) => Math.abs(pt[0] - r.local[0]) < r.w / 2 - 0.01 && Math.abs(pt[1] - r.local[1]) < r.d / 2 - 0.01
  const key = (a, b) => {
    const p = [a, b].sort((u, v) => u[0] - v[0] || u[1] - v[1])
    return p.map((q) => q.map((v) => v.toFixed(1)).join(',')).join('|')
  }
  const seen = new Map()
  const STEP = 0.5
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
      const len = Math.hypot(b[0] - a[0], b[1] - a[1])
      const ux = (b[0] - a[0]) / len
      const uz = (b[1] - a[1]) / len
      const nx = -uz
      const nz = ux
      const n = Math.max(1, Math.round(len / STEP))
      // classify each sample: 'ext', 'open', or the neighbour room
      const runs = []
      for (let k = 0; k < n; k++) {
        const t = ((k + 0.5) / n) * len
        const p = [a[0] + ux * t, a[1] + uz * t]
        const out = inside([p[0] + nx * 0.6, p[1] + nz * 0.6], r) ? -1.25 : 1.25
        const probe = [p[0] + nx * out, p[1] + nz * out]
        const o = solid.find((x) => x !== r && inside(probe, x))
        const status = !o ? 'ext' : isOpen(r, o) ? 'open' : 'wall'
        const plumbing = !!r.plumbing || !!o?.plumbing
        const last = runs[runs.length - 1]
        if (last && last.status === status && last.plumbing === plumbing) last.k1 = k + 1
        else runs.push({ status, plumbing, k0: k, k1: k + 1 })
      }
      runs.forEach((run) => {
        if (run.status === 'open') return
        const t0 = (run.k0 / n) * len
        const t1 = (run.k1 / n) * len
        const pa = [a[0] + ux * t0, a[1] + uz * t0]
        const pb = [a[0] + ux * t1, a[1] + uz * t1]
        const kk = key(pa, pb)
        const exterior = run.status === 'ext'
        const prev = seen.get(kk)
        if (prev) {
          prev.plate = Math.max(prev.plate, r.plate)
          prev.plumbing = prev.plumbing || (run.plumbing && !exterior)
          prev.exterior = prev.exterior && exterior
        } else {
          seen.set(kk, { a: pa, b: pb, plate: r.plate, plumbing: run.plumbing && !exterior, exterior, rooms: [r.name] })
        }
      })
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

  // ── doors and windows: opening voids the host wall, door or window fills it
  const elements = rooms.filter((r) => r.element)
  const fillIds = []
  const wallBox = (w, t0, t1, z0, h, extra = 0.1) => {
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1])
    const dir = [(X(w.b[0]) - X(w.a[0])) / (len * FT), (Y(w.b[1]) - Y(w.a[1])) / (len * FT)]
    const t = (w.thicknessIn / 12) * FT + extra
    const sx = X(w.a[0]) + dir[0] * t0 * FT - dir[1] * (t / 2)
    const sy = Y(w.a[1]) + dir[1] * t0 * FT + dir[0] * (t / 2)
    return box(sx.toFixed(4), sy.toFixed(4), (z0 * FT).toFixed(4), (t1 - t0) * FT, t, h * FT, dir)
  }
  elements
    .filter((e) => (e.kind === 'door' || e.kind === 'window') && !e.dormer)
    .forEach((e, i) => {
      const host = hostWall(walls, e)
      if (!host) return
      const w = walls[host.i]
      const sill = e.kind === 'window' ? WINDOW_SILL[e.mark] ?? 2 : 0
      const head = e.kind === 'window' ? WINDOW_HEAD[e.mark] ?? 7 : DOOR_HEAD
      const t0 = Math.max(0, host.t - e.span / 2)
      const t1 = Math.min(host.len, host.t + e.span / 2)
      const op = wallBox(w, t0, t1, sill, head - sill)
      const opening = add(`IFCOPENINGELEMENT(${g()},#${oh},'Opening for ${e.name}',$,$,#${op.pl},#${op.shape},$,.OPENING.)`)
      add(`IFCRELVOIDSELEMENT(${g()},#${oh},$,$,#${wallIds[host.i]},#${opening})`)
      if (e.cased) return
      const fb = wallBox(w, t0, t1, sill, head - sill, -0.02)
      const H = ((head - sill) * FT).toFixed(3)
      const W = ((t1 - t0) * FT).toFixed(3)
      let fill
      if (e.kind === 'door') {
        const op = e.pair ? '.DOUBLE_DOOR_SINGLE_SWING.' : e.hinge === 'end' ? '.SINGLE_SWING_RIGHT.' : '.SINGLE_SWING_LEFT.'
        fill = add(`IFCDOOR(${g()},#${oh},'${e.size || 'door'} ${e.pair ? 'pair' : ''}'.trim(),'${kit.doors[e.size]?.material || ''}',$,#${fb.pl},#${fb.shape},$,${H},${W},.DOOR.,${op},$)`)
      } else {
        const win = kit.windows[e.mark] || {}
        fill = add(`IFCWINDOW(${g()},#${oh},'Window ${e.mark}','${win.type || ''} ${win.material || ''}'.trim(),$,#${fb.pl},#${fb.shape},$,${H},${W},.WINDOW.,.${e.span >= 5 ? 'DOUBLE_PANEL_VERTICAL' : 'SINGLE_PANEL'}.,$)`)
      }
      add(`IFCRELFILLSELEMENT(${g()},#${oh},$,$,#${opening},#${fill})`)
      fillIds.push(fill)
    })

  // ── fixtures and furniture ────────────────────────────────────────────
  const FIX_IFC = {
    toilet: ['IFCSANITARYTERMINAL', '.TOILETPAN.'], shower: ['IFCSANITARYTERMINAL', '.SHOWER.'], vanity: ['IFCSANITARYTERMINAL', '.WASHHANDBASIN.'], sink: ['IFCSANITARYTERMINAL', '.SINK.'],
    fridge: ['IFCELECTRICAPPLIANCE', '.REFRIGERATOR.'], range: ['IFCELECTRICAPPLIANCE', '.ELECTRICCOOKER.'], washer: ['IFCELECTRICAPPLIANCE', '.WASHINGMACHINE.'], dryer: ['IFCELECTRICAPPLIANCE', '.TUMBLEDRYER.'],
    bed: ['IFCFURNITURE', '.BED.'], sofa: ['IFCFURNITURE', '.SOFA.'], table: ['IFCFURNITURE', '.TABLE.'], coffee: ['IFCFURNITURE', '.TABLE.'], desk: ['IFCFURNITURE', '.DESK.'], shelves: ['IFCFURNITURE', '.SHELF.'], linen: ['IFCFURNITURE', '.SHELF.'],
  }
  const fixtureIds = elements
    .filter((e) => e.kind === 'fixture')
    .map((e) => {
      const [cls, type] = FIX_IFC[e.fixture] || ['IFCFURNITURE', '.USERDEFINED.']
      const { pl, shape } = box(X(e.local[0] - e.w / 2).toFixed(4), Y(e.local[1] + e.d / 2).toFixed(4), '0.', e.w * FT, e.d * FT, e.h * FT)
      const name = FIXTURE_NAME[e.fixture] || e.fixture
      return add(`${cls}(${g()},#${oh},'${name}',$,'${name}',#${pl},#${shape},$,${type})`)
    })

  // ── slabs: one per solid room footprint, 4" below finished floor ──────
  const slabT = (4 / 12) * FT
  const slabIds = rooms
    .filter((r) => !r.open && !r.element)
    .map((r) => {
      const { pl, shape } = box(X(r.local[0] - r.w / 2).toFixed(4), Y(r.local[1] + r.d / 2).toFixed(4), (-slabT).toFixed(4), r.w * FT, r.d * FT, slabT)
      return add(`IFCSLAB(${g()},#${oh},'Slab ${r.name}','${kit.foundation.slab}',$,#${pl},#${shape},$,.FLOOR.)`)
    })

  // ── spaces (rooms) ────────────────────────────────────────────────────
  const spaceIds = rooms.filter((r) => !r.element).map((r) => {
    const h = r.open ? 0.3 : r.plate * FT
    const { pl, shape } = box(X(r.local[0] - r.w / 2).toFixed(4), Y(r.local[1] + r.d / 2).toFixed(4), '0.', r.w * FT, r.d * FT, h)
    return add(`IFCSPACE(${g()},#${oh},'${r.name}','${r.w} ft x ${r.d} ft',$,#${pl},#${shape},$,.ELEMENT.,.${r.open ? 'EXTERNAL' : 'INTERNAL'}.,$)`)
  })
  add(`IFCRELAGGREGATES(${g()},#${oh},$,$,#${storey},(${spaceIds.map((i) => '#' + i).join(',')}))`)
  add(`IFCRELCONTAINEDINSPATIALSTRUCTURE(${g()},#${oh},$,$,(${[...wallIds, ...slabIds, ...fillIds, ...fixtureIds].map((i) => '#' + i).join(',')}),#${storey})`)

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
