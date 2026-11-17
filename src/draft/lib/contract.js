// The design contract: the one JSON document the app hands to the Revit
// worker. Everything the worker needs to build the model in the office
// template is in here. Version it; the worker refuses versions it does not know.
import polygonClipping from 'polygon-clipping'
import { kitFor, isRoom, floorArea, programOf } from './layout.js'
import { wallsFrom } from './ifc.js'
import { takeoff } from './takeoff.js'
import { sheetPlan } from './sheets.js'
import { WINDOW_SILL, WINDOW_HEAD, DOOR_HEAD } from '../../kits/modern-farmhouse.js'
import { drivewaySlabs, walkSlabs, lotCoverage, drivewayLength } from './site.js'

export const CONTRACT_VERSION = 1

/** Door and window marks (D01…, W01…) in element order: the same mark in design.json, the schedule and the IFC. */
export function openingMarks(rooms) {
  const marks = new Map()
  let d = 0
  let w = 0
  rooms.forEach((e) => {
    if (!e.element || e.dormer) return
    if (e.kind === 'door' && !e.cased) marks.set(e.id, `D${String(++d).padStart(2, '0')}`)
    if (e.kind === 'window') marks.set(e.id, `W${String(++w).padStart(2, '0')}`)
  })
  return marks
}

/** The site in the house frame: the driveway pieces, the walk and the coverage, as drawn everywhere. */
function siteOf(rooms, lot) {
  const r2 = (v) => Math.round(v * 100) / 100
  const list = rooms.filter((r) => !r.element && r.local).map((r) => ({ id: r.id, kind: r.kind, name: r.name, open: !!r.open, driveway: r.driveway, x: r.local[0], z: r.local[1], w: r.w, d: r.d }))
  const doors = rooms.filter((e) => e.kind === 'door' && e.local).map((e) => ({ id: e.id, room: e.room, axis: e.axis, x: e.local[0], z: e.local[1], span: e.span, size: e.size, exterior: !!e.exterior }))
  const drive = drivewaySlabs(list, doors, lot)
  const slab = (s) => ({ x: r2(s.x), z: r2(s.z), w: r2(s.w), d: r2(s.d), part: s.part })
  return { driveway: drive.map(slab), drivewayFt: drivewayLength(drive), walk: walkSlabs(list, doors, lot, drive).map(slab), coverage: lotCoverage(list, lot) }
}

export function buildDesign({ rooms, program, style, lot, client, history = [] }) {
  const marks = openingMarks(rooms)
  const kit = kitFor(style)
  const roomList = rooms.filter(isRoom)
  const elements = rooms.filter((r) => r.element)
  const roof = rooms.find((r) => r.kind === 'roof')
  const walls = wallsFrom(rooms, kit)
  const r2 = (v) => +(+v).toFixed(3)
  const design = {
    contract: CONTRACT_VERSION,
    createdAt: new Date().toISOString(),
    client: client || null,
    lot: lot ? { address: lot.address, city: lot.city, cityName: lot.cityName, spec: lot.spec ? { kind: lot.spec.kind, width: lot.spec.width, depth: lot.spec.depth } : null, source: lot.source, confirmed: lot.confirmed, areaSf: lot.areaSf, boundary: lot.boundary, corners: lot.corners || null, envelope: lot.envelope, angle: lot.angle, centre: lot.centre, setbacks: lot.edges?.map((e) => e.label), edges: lot.edges?.map((e) => ({ kind: e.kind, street: e.street || null, setback: e.setback, label: e.label })) || null, frontStreet: lot.edges?.find((e) => e.kind === 'front')?.street || lot.spec?.frontStreet || null, alley: !!lot.alley, flood: lot.flood || null } : null,
    style: { id: style.id, name: style.name, kitId: kit.id, kitSource: kit.source },
    program,
    // the plan as it is after the client's changes: what the title block, the summary and the schedules say
    asBuilt: programOf(rooms, program),
    site: siteOf(rooms, lot),
    units: 'feet',
    // local frame: x along the front of the house, z toward the street, y up; origin at the plan centre
    frame: { x: 'along front', z: 'toward street', y: 'up', origin: 'plan centre', lotRotationRad: null },
    levels: [{ name: 'Level 1', elevation: 0 }],
    rooms: roomList.map((r) => ({ id: r.id, kind: r.kind, name: r.name, x: r2(r.local[0]), z: r2(r.local[1]), w: r2(r.w), d: r2(r.d), plate: r2(r.plate), open: !!r.open, plumbing: !!r.plumbing })),
    walls: walls.map((w, i) => ({ id: `wall-${i + 1}`, a: w.a.map(r2), b: w.b.map(r2), thicknessIn: w.thicknessIn, plate: r2(w.plate), base: r2(w.base || 0), exterior: !!w.exterior, plumbing: !!w.plumbing, dormer: !!w.dormer, revitType: w.dormer || w.exterior ? kit.revit?.wallTypes?.exterior : w.plumbing ? kit.revit?.wallTypes?.plumbing : kit.revit?.wallTypes?.interior })),
    doors: elements.filter((e) => e.kind === 'door').map((e) => ({ id: e.id, tag: marks.get(e.id) || null, room: e.room, x: r2(e.local[0]), z: r2(e.local[1]), axis: e.axis, width: r2(e.span), height: e.h ? r2(e.h) : DOOR_HEAD, swing: e.swing || null, hinge: e.hinge || null, pair: !!e.pair, cased: !!e.cased, exterior: !!e.exterior, size: e.size || null, fireRated: !!e.fireRated, selfClosing: !!e.selfClosing, overhead: e.size === 'overhead' || e.size === 'overheadSingle', revitFamily: kit.revit?.doors?.[e.size] || null })),
    windows: elements.filter((e) => e.kind === 'window').map((e) => ({ id: e.id, tag: marks.get(e.id) || null, room: e.room, mark: e.mark, x: r2(e.local[0]), z: r2(e.local[1]), axis: e.axis, width: r2(e.span), sill: e.sill ?? WINDOW_SILL[e.mark] ?? 2, head: e.head ?? WINDOW_HEAD[e.mark] ?? 7, revitFamily: kit.revit?.windows?.[e.mark] || null })),
    fixtures: elements.filter((e) => e.kind === 'fixture').map((e) => ({ id: e.id, kind: e.fixture, name: e.name, room: e.room, x: r2(e.local[0]), z: r2(e.local[1]), w: r2(e.w), d: r2(e.d), h: r2(e.h), face: e.face || null, revitFamily: kit.revit?.fixtures?.[e.fixture] || null })),
    // the slab outline(s): the union of the solid rooms, grown a little so wall-thick gaps close; largest ring first (frame feet)
    footprint: footprintOf(roomList)[0] || [],
    footprints: footprintOf(roomList),
    roof: roof
      ? {
          centre: roof.centre || null,
          scale: roof.scale || 1,
          masses: roof.masses,
          panels: roof.faces.filter((f) => f.kind === 'slope').map((f) => ({ id: f.id, mass: f.mass, material: f.material, rings: f.rings.map((ring) => ring.map((p) => p.map(r2))) })),
          dormers: roof.dormers,
          pitch: kit.roof.pitch,
          overhang: kit.roof.overhang,
        }
      : null,
    revit: kit.revit || null,
    sheets: kit.sheets,
    titleBlock: kit.titleBlock,
    takeoff: takeoff(rooms, program, kit),
    livingSf: Math.round(floorArea(rooms, program.stories)),
    changes: history.filter((m) => m.who === 'you').map((m) => m.text),
  }
  design.sheetPlan = sheetPlan(design)
  return design
}

/** Union of the solid rooms (each grown by `grow` ft so wall-thick gaps close) as outlines in frame feet, largest ring first. */
export function footprintOf(roomList, grow = 0.4) {
  const rects = roomList
    .filter((r) => !r.open && r.local)
    .map((r) => {
      const [cx, cz] = r.local
      const w = r.w / 2 + grow
      const d = r.d / 2 + grow
      return [[[cx - w, cz - d], [cx + w, cz - d], [cx + w, cz + d], [cx - w, cz + d], [cx - w, cz - d]]]
    })
  if (!rects.length) return []
  try {
    const u = polygonClipping.union(...rects)
    const rings = u.map((poly) => poly[0]).map((ring) => ring.map(([x, z]) => [+x.toFixed(3), +z.toFixed(3)]))
    rings.forEach((ring) => {
      if (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) ring.pop()
    })
    rings.sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)))
    return rings
  } catch {
    return []
  }
}
const area = (ring) => ring.reduce((s, [x, z], i) => s + x * (ring[(i + 1) % ring.length][1]) - ring[(i + 1) % ring.length][0] * z, 0) / 2
