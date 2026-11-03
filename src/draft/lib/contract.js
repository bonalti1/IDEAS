// The design contract: the one JSON document the app hands to the Revit
// worker. Everything the worker needs to build the model in the office
// template is in here. Version it; the worker refuses versions it does not know.
import { kitFor, isRoom, floorArea } from './layout.js'
import { wallsFrom } from './ifc.js'
import { takeoff } from './takeoff.js'
import { WINDOW_SILL, WINDOW_HEAD, DOOR_HEAD } from '../../kits/modern-farmhouse.js'

export const CONTRACT_VERSION = 1

export function buildDesign({ rooms, program, style, lot, client, history = [] }) {
  const kit = kitFor(style)
  const roomList = rooms.filter(isRoom)
  const elements = rooms.filter((r) => r.element)
  const roof = rooms.find((r) => r.kind === 'roof')
  const walls = wallsFrom(rooms, kit)
  const r2 = (v) => +(+v).toFixed(3)
  return {
    contract: CONTRACT_VERSION,
    createdAt: new Date().toISOString(),
    client: client || null,
    lot: lot ? { address: lot.address } : null,
    style: { id: style.id, name: style.name, kitId: kit.id, kitSource: kit.source },
    program,
    units: 'feet',
    // local frame: x along the front of the house, z toward the street, y up; origin at the plan centre
    frame: { x: 'along front', z: 'toward street', y: 'up', origin: 'plan centre', lotRotationRad: null },
    levels: [{ name: 'Level 1', elevation: 0 }],
    rooms: roomList.map((r) => ({ id: r.id, kind: r.kind, name: r.name, x: r2(r.local[0]), z: r2(r.local[1]), w: r2(r.w), d: r2(r.d), plate: r2(r.plate), open: !!r.open, plumbing: !!r.plumbing })),
    walls: walls.map((w, i) => ({ id: `wall-${i + 1}`, a: w.a.map(r2), b: w.b.map(r2), thicknessIn: w.thicknessIn, plate: r2(w.plate), base: r2(w.base || 0), exterior: !!w.exterior, plumbing: !!w.plumbing, dormer: !!w.dormer, revitType: w.dormer || w.exterior ? kit.revit?.wallTypes?.exterior : w.plumbing ? kit.revit?.wallTypes?.plumbing : kit.revit?.wallTypes?.interior })),
    doors: elements.filter((e) => e.kind === 'door').map((e) => ({ id: e.id, room: e.room, x: r2(e.local[0]), z: r2(e.local[1]), axis: e.axis, width: r2(e.span), height: DOOR_HEAD, swing: e.swing || null, hinge: e.hinge || null, pair: !!e.pair, cased: !!e.cased, exterior: !!e.exterior, size: e.size || null, revitFamily: kit.revit?.doors?.[e.size] || null })),
    windows: elements.filter((e) => e.kind === 'window').map((e) => ({ id: e.id, room: e.room, mark: e.mark, x: r2(e.local[0]), z: r2(e.local[1]), axis: e.axis, width: r2(e.span), sill: e.sill ?? WINDOW_SILL[e.mark] ?? 2, head: e.head ?? WINDOW_HEAD[e.mark] ?? 7, revitFamily: kit.revit?.windows?.[e.mark] || null })),
    fixtures: elements.filter((e) => e.kind === 'fixture').map((e) => ({ id: e.id, kind: e.fixture, name: e.name, room: e.room, x: r2(e.local[0]), z: r2(e.local[1]), w: r2(e.w), d: r2(e.d), h: r2(e.h), revitFamily: kit.revit?.fixtures?.[e.fixture] || null })),
    roof: roof
      ? {
          masses: roof.masses,
          panels: roof.faces.filter((f) => f.kind === 'slope').map((f) => ({ id: f.id, mass: f.mass, material: f.material, rings: f.rings.map((ring) => ring.map((p) => p.map(r2))) })),
          dormers: roof.dormers,
          pitch: kit.roof.pitch,
          overhang: kit.roof.overhang,
        }
      : null,
    sheets: kit.sheets,
    titleBlock: kit.titleBlock,
    takeoff: takeoff(rooms, program, kit),
    livingSf: Math.round(floorArea(rooms, program.stories)),
    changes: history.filter((m) => m.who === 'you').map((m) => m.text),
  }
}
