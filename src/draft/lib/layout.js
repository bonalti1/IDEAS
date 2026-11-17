// Layout engine, kit driven. Turns a program into room blocks that sit inside
// the lot's setback envelope, using the style kit's room templates and zones.
// Still a packer, not a solver: rows by zone (front porch, public, private,
// service, rear porch), centered on the envelope, rotated to the lot.
import { KIT as FARMHOUSE, FIXTURE_H, FIXTURE_NAME } from '../../kits/modern-farmhouse.js'
import { roofSurfaces, dormerWalls } from './roof.js'
import { DEFAULT_LOT, worldOf } from './lot.js'
import { applyOps, envelopeSize, pushWall, settleIslands, settleKitchen } from './ops.js'
import { auditPlan } from './audit.js'

// the reference lot's envelope centre, kept for older call sites
const ENVELOPE_CENTER = DEFAULT_LOT.centre
/** A lot object, or the reference lot when none (or only an address) was given. */
export const lotOf = (lot) => (lot && lot.envelope && lot.angle !== undefined ? lot : DEFAULT_LOT)

// Halls, closets, and wall thickness are not modeled as rooms. On the Garza
// plan they are about 22% of the conditioned area, so the kit's room sizes
// are scaled against that.
export const CIRCULATION = 1.22
const ZONES = ['rear', 'service', 'private', 'public', 'front']

export const DEFAULT_PROGRAM = {
  beds: 4, baths: 3, halfBath: true, suite2: false, office: true,
  garage: 2, stories: 1, sqft: 2800, frontPorch: true, rearPorch: false,
}

/** What the rooms step may ask of a style: the ranges its kit can draft. */
export function programLimits(style) {
  const kit = kitFor(style)
  const ref = kit.reference?.program || DEFAULT_PROGRAM
  return kit.limits || { beds: [Math.max(1, ref.beds), 6], baths: [Math.max(1, ref.baths - 1), 5], garage: [0, 3], stories: [1, ref.stories || 1], sqft: [1400, 6000] }
}

export const kitFor = (style) => style?.kit || FARMHOUSE
export { ENVELOPE_CENTER }

let uid = 0
export function makeRoom(kit, kind, overrides = {}) {
  return mk(kit, kind, overrides)
}
function mk(kit, kind, overrides = {}) {
  const t = kit.rooms[kind]
  return { id: `${kind}-${uid++}`, kind, name: t.name, w: t.w, d: t.d, zone: t.zone, open: !!t.open, plumbing: !!t.plumbing, ...overrides }
}

/** Build the room list for a program from the kit. */
export function roomsFor(program, kit) {
  uid = 0
  const r = []
  if (program.frontPorch) r.push(mk(kit, 'frontPorch', { fill: '#e6e1d8', h: 0.6 }))

  r.push(mk(kit, 'foyer'), mk(kit, 'living'), mk(kit, 'kitchen'), mk(kit, 'dining'), mk(kit, 'pantry'))
  if (program.office) r.push(mk(kit, 'office'))

  r.push(mk(kit, 'master'), mk(kit, 'mbath'), mk(kit, 'mwic'))
  if (program.suite2) r.push(mk(kit, 'suite2'), mk(kit, 'wic'))
  for (let i = 1; i <= program.beds - 1; i++) r.push(mk(kit, 'bed', { name: `Bedroom ${i}` }))

  // Full baths beyond the primary: pair bedrooms with a Jack & Jill first.
  let extraBaths = Math.max(0, program.baths - 1)
  if (program.suite2 && extraBaths > 0) {
    r.push(mk(kit, 'bath', { name: 'Mini Primary Bath' }))
    extraBaths--
  }
  let bathNo = 1
  if (program.beds - 1 >= 2 && extraBaths > 0) {
    r.push(mk(kit, 'jackjill'))
    extraBaths--
  }
  while (extraBaths-- > 0) r.push(mk(kit, 'bath', { name: `Bath ${bathNo++}` }))
  if (program.halfBath) r.push(mk(kit, 'halfbath'))

  r.push(mk(kit, 'laundry'), mk(kit, 'mud'))
  if (program.garage > 0) {
    const g = kit.rooms.garage
    r.push(mk(kit, 'garage', { name: `${program.garage}-Car Garage`, w: g.perCar * program.garage + (program.garage - 1) * 0, fill: '#dcd7cf' }))
  }
  if (program.rearPorch) r.push(mk(kit, 'rearPorch', { fill: '#e6e1d8', h: 0.6 }))
  return r
}

export function generateRooms(program, style, lot = DEFAULT_LOT) {
  return starterDraft(program, style, lot).rooms
}

/**
 * The first draft with what was done to make it fit: { rooms, planScale (the plan scaled to the
 * square footage), minSqft (the smallest this plan goes before a room falls under the kit's
 * minimum), clamped (the request was under that), fitScale and fitShift (what the lot needed) }.
 */
export function starterDraft(program, style, lot = DEFAULT_LOT) {
  const kit = kitFor(style)
  if (kit.plan) return fromPlan(program, kit, lotOf(lot))
  const rooms = roomsFor(program, kit)
  // Scale conditioned rooms so the plan lands on the requested square footage.
  const cond = rooms.filter(isConditioned)
  const base = cond.reduce((a, r) => a + r.w * r.d, 0) * CIRCULATION * program.stories
  const k = Math.sqrt(program.sqft / base)
  cond.forEach((r) => {
    r.w = Math.round(r.w * k * 2) / 2
    r.d = Math.round(r.d * k * 2) / 2
  })
  return { rooms: place(rooms, program.stories, kit, lotOf(lot)), planScale: k, minSqft: 0, clamped: false, fitScale: 1, fitShift: [0, 0] }
}

/** The smallest scale the plan can shrink to before a room falls under the kit's minimum size. */
// rooms that do not shrink with the house: baths, closets, halls and the service rooms keep their size
// when a plan scales down (the living rooms and bedrooms give the space), as an architect would draw them
export const KEEP_SIZE = ['bath', 'mbath', 'jackjill', 'halfbath', 'wic', 'mwic', 'hall', 'laundry', 'mud', 'pantry', 'office', 'foyer']

export const isConditioned = (r) => !r.open && r.kind !== 'garage' && !r.element
/** Rooms only: no doors, windows, or fixtures. */
export const isRoom = (r) => !r.element

/**
 * Start from the kit's traced plan and adjust it to the program:
 * drop extras that are off, add or remove bedrooms and baths at the wing
 * ends, add a garage beside the service wing, then scale to the square
 * footage. Positions stay where the drafter put them.
 */
/** Can a plan hold this program? A plan with no stated capacity holds anything the kit can draft. */
export function planHolds(plan, program) {
  const c = plan?.capacity
  if (!c) return true
  return program.beds <= c.beds && program.baths <= c.baths && (!program.halfBath || c.halfBath) && (!program.office || c.office) && (program.garage || 0) <= c.garage && (!program.suite2 || c.suite2)
}
/** The largest program a plan holds, from this one: what the rooms step offers on a lot only that plan fits. */
export function programWithin(plan, program) {
  const c = plan?.capacity
  if (!c) return program
  return { ...program, beds: Math.min(program.beds, c.beds), baths: Math.min(program.baths, c.baths), halfBath: program.halfBath && c.halfBath, office: program.office && c.office, garage: Math.min(program.garage || 0, c.garage), suite2: program.suite2 && c.suite2 }
}

/** Every solid room inside the lot's setback envelope? Placed rooms (with `local`). */
export function fitsEnvelope(placed, kit, lot) {
  const L = lotOf(lot)
  if (!L.envelope || L.envelope.length < 3) return true
  const env = L.envelope.map((p) => localOf(L, p))
  return placed
    .filter((r) => isRoom(r) && !r.open && r.local)
    .every((r) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].every(([sx, sy]) => insidePoly(env, [r.local[0] + sx * (r.w / 2 - 0.05), r.local[1] + sy * (r.d / 2 - 0.05)])))
}

/**
 * The plan for this program on this lot: the kit's standard plan when it fits the lot's envelope,
 * else the first of the kit's other plans (the narrow one) that does; the standard plan when none
 * does, so the rooms step can say what would fit.
 */
export function fromPlan(program, kit, lot = DEFAULT_LOT, planId = null) {
  if (!planId && kit.plans && Object.keys(kit.plans).length) {
    const standard = fromPlan(program, kit, lot, 'standard')
    if (fitsEnvelope(standard.rooms, kit, lot) || !lotOf(lot).envelope) return standard
    for (const id of Object.keys(kit.plans)) {
      if (!planHolds(kit.plans[id], program)) continue
      const alt = fromPlan(program, kit, lot, id)
      if (fitsEnvelope(alt.rooms, kit, lot)) return alt
    }
    return standard
  }
  const ref = kit.reference?.program || {}
  const T = planId && planId !== 'standard' && kit.plans?.[planId] ? kit.plans[planId] : kit.plan
  let rooms = T.rooms.map((r) => ({ ...r, zone: kit.rooms[r.kind]?.zone || 'private', open: !!kit.rooms[r.kind]?.open, plumbing: !!kit.rooms[r.kind]?.plumbing, fill: kit.rooms[r.kind]?.open ? '#e6e1d8' : r.kind === 'garage' ? '#dcd7cf' : undefined, h: kit.rooms[r.kind]?.open ? 0.6 : undefined }))

  const drop = (kind, n = 1) => {
    for (let i = 0; i < n; i++) {
      const idx = rooms.map((r) => r.kind).lastIndexOf(kind)
      if (idx >= 0) rooms.splice(idx, 1)
    }
  }
  if (!program.office) drop('office')
  if (!program.garage) drop('garage')
  if (!program.suite2) { drop('suite2'); rooms = rooms.filter((r) => r.id !== 'wic2') }
  if (!program.halfBath) drop('halfbath')
  if (!program.frontPorch) drop('frontPorch')
  if (!program.rearPorch) drop('rearPorch')

  // Bedrooms: the plan has (ref.beds - 1) secondary bedrooms. Remove from the bottom of the wing;
  // extra bedrooms and baths extend the bedroom wing along the hallway (below), the garage attaches
  // at the service end after placement.
  const want = program.beds - 1
  const have = rooms.filter((r) => r.kind === 'bed').length
  if (want < have) drop('bed', have - want)
  const extraBeds = Math.max(0, want - have)

  // Full baths: plan has mbath + jackjill + bath1 (+ suite2's bath is bath1 here). When one has to go,
  // take the one whose removal leaves every wet room within reach of the plumbing (the kit's rule).
  const wantB = program.baths - 1
  const haveB = rooms.filter((r) => r.kind === 'bath' || r.kind === 'jackjill').length
  const extraBaths = Math.max(0, wantB - haveB)
  for (let i = haveB; i > wantB; i--) {
    const wet = kit.rules?.wet || []
    const far = (list) => {
      const w = list.filter((r) => wet.includes(r.kind))
      return w.some((r) => w.filter((o) => o !== r).every((o) => Math.hypot(Math.max(r.x - (o.x + o.w), o.x - (r.x + r.w), 0), Math.max(r.y - (o.y + o.d), o.y - (r.y + r.d), 0)) > (kit.rules?.wetDistanceFt || 20)))
    }
    const candidates = [...rooms.filter((r) => r.kind === 'bath').reverse(), ...rooms.filter((r) => r.kind === 'jackjill')]
    const pick = candidates.find((c) => !far(rooms.filter((r) => r !== c))) || candidates[0]
    if (pick) rooms.splice(rooms.indexOf(pick), 1)
  }


  // rooms that go with a dropped room (a bedroom's closet), and what shortens with it (the hall)
  {
    const present = new Set(rooms.map((r) => r.id))
    Object.entries(T.companions || {}).forEach(([owner, list]) => {
      if (!present.has(owner)) rooms = rooms.filter((r) => !list.includes(r.id))
    })
    ;(T.trims || []).forEach((t) => {
      if (present.has(t.when)) return
      const r = rooms.find((x) => x.id === t.room)
      if (r && t.y !== undefined && t.y > r.y) {
        r.d -= t.y - r.y
        r.y = t.y
      }
    })
  }

  // Doors, windows, fixtures ride along as elements (not rooms). Those whose
  // room was dropped are dropped too.
  const ids = new Set(rooms.map((r) => r.id))
  const keep = (e) => !e.room || ids.has(e.room) || e.room === 'dormer'
  ;(T.doors || []).filter(keep).forEach((d, i) => {
    const w = d.axis === 'h' ? d.w : 0.6
    const dd = d.axis === 'h' ? 0.6 : d.w
    const spec = (d.size && kit.doors?.[d.size]) || null
    rooms.push({ ...d, id: d.id || `door-${i}`, kind: 'door', element: true, open: true, name: d.cased ? 'Opening' : 'Door', x: d.x - w / 2, y: d.y - dd / 2, w, d: dd, span: d.w, h: spec?.h ? spec.h / 12 : 6.67, pair: !!d.pair || !!spec?.pair, exterior: !!d.exterior || !!spec?.overhead, fireRated: !!spec?.fireRated, selfClosing: !!spec?.selfClosing })
  })
  ;(T.windows || []).filter(keep).forEach((win, i) => {
    if (win.dormer) {
      rooms.push({ ...win, id: `win-${i}`, kind: 'window', element: true, open: true, name: `Window ${win.mark}`, x: -100, y: -100, w: 0, d: 0, span: win.w, h: 0, dormer: true })
      return
    }
    const w = win.axis === 'h' ? win.w : 0.6
    const dd = win.axis === 'h' ? 0.6 : win.w
    rooms.push({ ...win, id: `win-${i}`, kind: 'window', element: true, open: true, name: `Window ${win.mark}`, x: win.x - w / 2, y: win.y - dd / 2, w, d: dd, span: win.w, h: 7 })
  })
  ;(T.fixtures || []).filter(keep).forEach((f, i) => {
    rooms.push({ ...f, id: `fx-${i}`, kind: 'fixture', fixture: f.k, element: true, open: true, name: FIXTURE_NAME[f.k] || f.k, h: FIXTURE_H[f.k] || 2 })
  })

  // a plan that draws its own garage sizes it by the cars asked for and lays its overhead doors out by bay
  const drawnGarage = rooms.find((r) => r.kind === 'garage')
  if (drawnGarage && program.garage > 0) {
    const g = kit.rooms.garage
    const drawnCars = +(drawnGarage.name.match(/^(\d+)-Car/) || [])[1] || 2
    if (program.garage !== drawnCars) drawnGarage.w = Math.max(g.perCar * program.garage, program.garage >= 3 ? 32 : 0)
    drawnGarage.name = `${program.garage}-Car Garage`
    const side = garageFacing(drawnGarage, rooms) || 's'
    for (let i = rooms.length - 1; i >= 0; i--) if (rooms[i].kind === 'door' && rooms[i].room === drawnGarage.id && /overhead/.test(rooms[i].size || '')) rooms.splice(i, 1)
    rooms.push(...overheadDoors(kit, drawnGarage, program.garage, side))
  }

  // the wing: extra bedrooms and baths slot in at the rear of the bedroom wing, the hall lengthens
  const wingShift = T.id === 'narrow' ? 0 : extendWing(rooms, kit, { beds: extraBeds, baths: extraBaths })
  // Bath 1 served the mini primary; without it, the bath opens from Bedroom 1 (never the outside)
  if (!program.suite2) {
    const bath1 = rooms.find((r) => r.id === 'bath1')
    const bed1 = rooms.find((r) => r.id === 'bed1')
    const door = rooms.find((e) => e.id === 'd-bath1')
    if (bath1 && bed1 && door) {
      const x0 = Math.max(bath1.x, bed1.x) + 0.5
      const x1 = Math.min(bath1.x + bath1.w, bed1.x + bed1.w) - 0.5
      Object.assign(door, doorEl(kit, 'd-bath1', 'bath1', 'h', (x0 + x1) / 2, bath1.y, 'bath', { swing: 1, hinge: 'start' }))
    }
  }

  // Scale to the requested square footage about the plan centre. Baths, closets, halls and the
  // service rooms keep their drawn size when the house shrinks (the living rooms and bedrooms give
  // the space); nothing goes under the kit's minimum room sizes, a bath never loses the clearances
  // around its fixtures and a hall never its width: the draft then comes out at the smallest size
  // this plan allows.
  const cx = T.footprint.w / 2
  const cy = T.footprint.d / 2
  if (T.roof) {
    // roof masses whose room was dropped are dropped too; the bed wing's roof grows with the wing; the roof then scales with the rooms
    const ids2 = new Set(rooms.filter(isRoom).map((r) => r.id))
    const masses = T.roof.filter((m) => !m.id || ids2.has(m.id) || !T.rooms.some((r) => r.id === m.id)).filter((m) => !(m.id === 'leftwing' && !ids2.has('suite2'))).map((m) => (m.id === 'bedwing' && wingShift ? { ...m, y0: m.y0 - wingShift } : m.id === 'garage' && drawnGarage ? { ...m, x1: drawnGarage.x + drawnGarage.w } : { ...m }))
    rooms.push({ id: 'roof', kind: 'roof', element: true, open: true, name: 'Roof', x: -100, y: -100, w: 0, d: 0, h: 0, local: [0, 0], center: [0, 0], masses, scale: 1, centre: [cx, cy], offset: [0, 0], faces: roofSurfaces(masses, 1, [cx, cy]), dormers: dormerWalls(masses, 1, [cx, cy]), plan: T.id || 'standard' })
  }
  const areaAt = (k) => {
    const copy = rooms.filter(isRoom).map((r) => ({ ...r }))
    scalePlan(copy, k, cx, cy, kit)
    return copy.filter(isConditioned).reduce((a, r) => a + r.w * r.d, 0) * program.stories
  }
  const base = areaAt(1)
  const kReq = program.sqft >= base ? Math.sqrt(program.sqft / base) : search((k) => areaAt(k) >= program.sqft, 0.5, 1)
  const kRoom = roomFloor(rooms, kit, cx, cy)
  const kMin = Math.max(kRoom, fixtureFloor(rooms, kit, program, lot, kRoom, cx, cy))
  const k = Math.max(kReq, kMin)
  const minSqft = Math.round(areaAt(kMin) / 50) * 50
  scalePlan(rooms, k, cx, cy, kit)
  widenHalls(rooms, kit)
  settleIslands(rooms)
  settleKitchen(rooms)
  const roofEl = rooms.find((r) => r.kind === 'roof')
  let placed = placeLocal(rooms.filter((r) => r.kind !== 'roof'), program.stories, kit, [cx, cy], lot)
  if (roofEl) placed.push(roofEl)
  // the house sits where it fits on this lot before the garage goes on, so it is placed against the real
  // position; the fit may trim the house, but never under the kit's minimum room sizes
  const floor = { minScale: Math.max(0.85, kMin / k) }
  const first = fitToLot(placed, kit, program.stories, lot, floor)
  placed = first.rooms
  if (program.garage > 0 && !placed.some((r) => isRoom(r) && r.kind === 'garage')) placed = attachGarage(placed, kit, program.garage, lot, program.stories)
  const fit = fitToLot(placed, kit, program.stories, lot, { minScale: Math.max(0.85, kMin / (k * first.scale)) })
  // the fit may have shrunk the rooms around their fixtures: aisles and the work triangle settle again
  settleIslands(fit.rooms)
  settleKitchen(fit.rooms)
  return { rooms: fit.rooms, planScale: k, minSqft, clamped: kReq < kMin - 1e-9, fitScale: first.scale * fit.scale, fitShift: [first.shift[0] + fit.shift[0], first.shift[1] + fit.shift[1]] }
}

/** The smallest k in [lo, hi] (to 0.01) for which `ok(k)` holds; ok is monotone (false below, true above). */
function search(ok, lo, hi) {
  if (ok(lo)) return lo
  if (!ok(hi)) return hi
  while (hi - lo > 0.0025) {
    const mid = (lo + hi) / 2
    if (ok(mid)) hi = mid
    else lo = mid
  }
  return Math.ceil(hi * 200) / 200
}

/** Piecewise map of one plan axis for a scale k < 1: the spans of rooms that keep their size map 1:1,
 * everything else scales by k, and the plan centre c stays put. Uniform about c for k >= 1. */
function bandMap(rooms, axis, k, c) {
  const size = axis === 'x' ? 'w' : 'd'
  const other = axis === 'x' ? 'd' : 'w'
  const solid = rooms.filter((r) => isRoom(r))
  // a garage is sized by its cars whatever the house does; when the house shrinks, halls keep their
  // width and the service rooms keep both sizes
  const keep = k >= 1 - 1e-9 ? ['garage'] : [...KEEP_SIZE, 'garage']
  if (k >= 1 - 1e-9 && !solid.some((r) => r.kind === 'garage')) return (v) => c + (v - c) * k
  const fixed = solid.filter((r) => keep.includes(r.kind) && (r.kind !== 'hall' || r[size] <= r[other])).map((r) => [r[axis], r[axis] + r[size]])
  const edges = [...new Set(solid.flatMap((r) => [r[axis], r[axis] + r[size]]).concat([c]).map((v) => Math.round(v * 1000) / 1000))].sort((a, b) => a - b)
  const out = [edges[0]]
  for (let i = 1; i < edges.length; i++) {
    const a = edges[i - 1]
    const b = edges[i]
    const keep = fixed.some(([f0, f1]) => f0 <= a + 1e-6 && b <= f1 + 1e-6)
    out.push(out[i - 1] + (b - a) * (keep ? 1 : k))
  }
  const f = (v) => {
    if (v <= edges[0]) return out[0] + (v - edges[0]) * k
    const i = edges.findIndex((e) => e >= v - 1e-9)
    if (i < 0) return out[out.length - 1] + (v - edges[edges.length - 1]) * k
    if (i === 0) return out[0]
    const a = edges[i - 1]
    const t = (v - a) / (edges[i] - a)
    return out[i - 1] + t * (out[i] - out[i - 1])
  }
  const shift = c - f(c)
  return (v) => f(v) + shift
}

/** Scale the plan about (cx, cy): uniformly when it grows; when it shrinks, the baths, closets, halls
 * and service rooms keep their size and the other rooms give the space (see bandMap). Elements keep
 * their catalog size and their place in the room: a door or window stays where it was along its wall,
 * a fixture keeps its distance from the nearest wall. The roof masses follow the rooms. In place. */
export function scalePlan(rooms, k, cx, cy, kit) {
  const fx = bandMap(rooms, 'x', k, cx)
  const fy = bandMap(rooms, 'y', k, cy)
  const anchors = rooms.filter((e) => e.element && !e.dormer && e.room).map((e) => {
    const host = rooms.find((r) => r.id === e.room)
    if (!host) return null
    const nearX = e.x + e.w / 2 < host.x + host.w / 2
    const nearY = e.y + e.d / 2 < host.y + host.d / 2
    return { e, host, fx: (e.x + e.w / 2 - host.x) / host.w, fy: (e.y + e.d / 2 - host.y) / host.d, nearX, nearY, ox: nearX ? e.x - host.x : host.x + host.w - (e.x + e.w), oy: nearY ? e.y - host.y : host.y + host.d - (e.y + e.d) }
  }).filter(Boolean)
  rooms.forEach((r) => {
    if (r.dormer) return
    if (r.kind === 'roof') {
      // masses to plan coordinates first (an earlier scale or shift is baked in), then through the map
      const k0 = r.scale || 1
      const off = r.offset || [0, 0]
      const c0 = r.centre || [cx, cy]
      const px = (v) => fx(c0[0] + (v - c0[0]) * k0 + off[0])
      const py = (v) => fy(c0[1] + (v - c0[1]) * k0 + off[1])
      r.masses = (r.masses || []).map((m) => ({ ...m, ...(m.x0 !== undefined ? { x0: px(m.x0), x1: px(m.x1) } : {}), ...(m.y0 !== undefined ? { y0: py(m.y0), y1: py(m.y1) } : {}), ...(m.face !== undefined ? { face: py(m.face) } : {}), ...(m.cuts ? { cuts: m.cuts.map((ct) => ({ ...ct, x0: px(ct.x0), x1: px(ct.x1), y0: py(ct.y0), y1: py(ct.y1) })) } : {}) }))
      r.scale = 1
      r.offset = [0, 0]
      r.centre = [cx, cy]
      r.faces = roofSurfaces(r.masses, 1, [cx, cy])
      r.dormers = dormerWalls(r.masses, 1, [cx, cy])
      return
    }
    if (r.element) {
      const ex = fx(r.x + r.w / 2)
      const ey = fy(r.y + r.d / 2)
      r.x = ex - r.w / 2
      r.y = ey - r.d / 2
      return
    }
    // room edges snap to 2" so dimensions read clean and shared walls stay shared
    const snap = (v) => Math.round(v * 6) / 6
    const x1 = snap(fx(r.x + r.w))
    const y1 = snap(fy(r.y + r.d))
    r.x = snap(fx(r.x))
    r.y = snap(fy(r.y))
    r.w = x1 - r.x
    r.d = y1 - r.y
  })
  anchors.forEach(({ e, host, fx, fy, nearX, nearY, ox, oy }) => {
    if (e.kind === 'fixture') {
      e.x = nearX ? host.x + ox : host.x + host.w - ox - e.w
      e.y = nearY ? host.y + oy : host.y + host.d - oy - e.d
      e.x = Math.min(Math.max(e.x, host.x), host.x + host.w - e.w)
      e.y = Math.min(Math.max(e.y, host.y), host.y + host.d - e.d)
    } else {
      e.x = host.x + fx * host.w - e.w / 2
      e.y = host.y + fy * host.d - e.d / 2
    }
  })
  // a pair door wider than its wall becomes a single
  rooms.filter((e) => e.kind === 'door' && e.pair && !e.exterior).forEach((e) => {
    const host = rooms.find((r) => r.id === e.room)
    const wall = e.axis === 'h' ? host?.w : host?.d
    if (host && e.span > wall - 0.5) {
      const spec = kit.doors[e.size] || kit.doors.interior
      const span = spec.pair ? spec.w / 12 : Math.min(spec.w / 12, (kit.doors.interior?.w || 32) / 12)
      const cxE = e.x + e.w / 2
      const cyE = e.y + e.d / 2
      e.pair = false
      e.span = span
      e.w = e.axis === 'h' ? span : 0.6
      e.d = e.axis === 'h' ? 0.6 : span
      e.x = cxE - e.w / 2
      e.y = cyE - e.d / 2
    }
  })
  return rooms
}

/** Do the rooms meet the kit's minimum sizes (the garage aside)? */
export function roomsMeetMinimums(rooms, kit) {
  const R = kit.rules || {}
  return rooms.filter((r) => isRoom(r) && !r.open && r.kind !== 'garage').every((r) => {
    const min = R.minSize?.[r.kind]
    const [mw, md] = min || (R.habitable?.includes(r.kind) ? [7, 7] : [3, 3])
    return Math.min(r.w, r.d) >= Math.min(mw, md) - 0.01 && Math.max(r.w, r.d) >= Math.max(mw, md) - 0.01 && (!R.habitable?.includes(r.kind) || r.w * r.d >= 70 - 0.01)
  })
}
/** The smallest scale at which every room still meets the kit's minimum size. */
function roomFloor(rooms, kit, cx, cy) {
  return search((k) => {
    const copy = rooms.filter(isRoom).map((r) => ({ ...r }))
    scalePlan(copy, k, cx, cy, kit)
    return roomsMeetMinimums(copy, kit)
  }, 0.5, 1)
}

/** Halls stay 42" wide whatever the plan scale: a narrow one pushes its side wall out. In place. */
function widenHalls(rooms, kit) {
  const HALL = kit.hallWidthFt || 3.5
  rooms.filter((r) => isRoom(r) && r.kind === 'hall').forEach((h) => {
    const narrow = h.w <= h.d ? 'w' : 'd'
    const deficit = HALL - h[narrow]
    if (deficit > 0.01) {
      const sides = narrow === 'w' ? ['e', 'w'] : ['s', 'n']
      if (typeof pushWall(rooms, h.id, sides[0], deficit, kit, { roof: null }) === 'string') pushWall(rooms, h.id, sides[1], deficit, kit, { roof: null })
    }
  })
}

const FIXTURE_IDS = new Set(['toilet-front', 'toilet-side', 'shower-front', 'hall', 'door-partial', 'overlap', 'aisle', 'door-nowall'])
/** The smallest scale at which every bath keeps the clearances around its fixtures and every hall its width. */
function fixtureFloor(rooms, kit, program, lot, from, cx, cy) {
  const ok = (k) => {
    const copy = rooms.map((r) => ({ ...r }))
    scalePlan(copy, k, cx, cy, kit)
    widenHalls(copy, kit)
    settleIslands(copy)
    settleKitchen(copy)
    const bad = auditPlan(copy, program, kit, lot).errors.filter((f) => FIXTURE_IDS.has(f.id))
    return !bad.length
  }
  if (from >= 1) return from
  return search(ok, from, 1)
}

/** A door element centred at (x, y) on a wall along `axis`, at the kit's catalog size. */
export function doorEl(kit, id, room, axis, x, y, size, opts = {}) {
  const spec = kit.doors[size] || kit.doors.interior
  const span = opts.pair && !spec.pair ? (spec.w * 2) / 12 : spec.w / 12
  const w = axis === 'h' ? span : 0.6
  const d = axis === 'h' ? 0.6 : span
  return { id, kind: 'door', element: true, open: true, name: opts.cased ? 'Opening' : 'Door', room, axis, x: x - w / 2, y: y - d / 2, w, d, span, size, h: spec.h ? spec.h / 12 : 6.67, swing: opts.swing ?? 1, hinge: opts.hinge || 'start', pair: !!opts.pair || !!spec.pair, cased: !!opts.cased, exterior: !!opts.exterior || !!spec.overhead, fireRated: !!spec.fireRated, selfClosing: !!spec.selfClosing }
}
/** A window element centred at (x, y) on a wall along `axis`; a twin is two catalog units mulled. */
export function windowEl(kit, id, room, axis, x, y, mark = 'A', twin = false) {
  const spec = kit.windows[mark] || kit.windows.A
  const span = (spec.w / 12) * (twin ? 2 : 1)
  const w = axis === 'h' ? span : 0.6
  const d = axis === 'h' ? 0.6 : span
  const headFt = /(\d+)'-(\d+)"/.test(spec.head || '') ? +RegExp.$1 + +RegExp.$2 / 12 : 7
  return { id, kind: 'window', element: true, open: true, name: `Window ${mark}`, room, mark, axis, x: x - w / 2, y: y - d / 2, w, d, span, sill: headFt - spec.h / 12, head: headFt, h: 7 }
}
const shiftEl = (e, dx, dy) => {
  e.x += dx
  e.y += dy
}

/**
 * Extra bedrooms and baths extend the bedroom wing at its rear: the rooms at the rear of the wing
 * (Bedroom 2 and its closets) move back, the hallway lengthens, and each new room slots in
 * against the hall with its own hall door, a closet (bedrooms) or fixtures (baths), and an egress
 * window on the outside wall. Plan feet, before scaling. Returns how far the wing grew.
 */
export function extendWing(rooms, kit, { beds = 0, baths = 0 }) {
  if (!beds && !baths) return 0
  const hall = rooms.find((r) => r.id === 'hall')
  const bed2 = rooms.find((r) => r.id === 'bed2')
  if (!hall || !bed2) return 0
  // the rooms at the rear of the wing: everything in the wing's columns at or above Bedroom 2's bottom edge
  const rearBlock = (top) => rooms.filter((r) => isRoom(r) && !r.open && r !== hall && r.y + r.d <= top + 0.3 && r.x < hall.x + hall.w + 0.5 && r.x + r.w > bed2.x - 0.5)
  const elementsOf = (ids) => rooms.filter((e) => e.element && e.kind !== 'roof' && ids.has(e.room))
  const bedX = bed2.x
  const bedW = bed2.w
  const wallX = hall.x // the hall's west edge: where bedroom doors sit
  let total = 0
  let bedNo = rooms.filter((r) => r.kind === 'bed').length
  let bathNo = rooms.filter((r) => r.kind === 'bath').length
  const slots = [...Array(baths).fill('bath'), ...Array(beds).fill('bed')]
  slots.forEach((kind) => {
    const D = kind === 'bed' ? 12.75 : 6.0
    // everything at the rear of the wing moves back by D, the hall grows by D; the band Bedroom 2 vacates takes the new room
    const top = bed2.y + bed2.d
    const block = rearBlock(top)
    const ids = new Set(block.map((r) => r.id))
    block.forEach((r) => (r.y -= D))
    elementsOf(ids).forEach((e) => shiftEl(e, 0, -D))
    const bandY = top - D // the vacated band: y from bandY to top
    hall.y -= D
    hall.d += D
    total += D
    if (kind === 'bed') {
      bedNo += 1
      const id = `bed-${bedNo}`
      const closetD = 2.25
      const room = { id, kind: 'bed', name: `Bedroom ${bedNo}`, x: bedX, y: bandY + closetD, w: bedW, d: D - closetD, zone: 'private', open: false, plumbing: false }
      const closet = { id: `closet-${bedNo}`, kind: 'wic', name: 'Closet', x: bedX, y: bandY, w: bedW, d: closetD, zone: 'private', open: false, plumbing: false }
      rooms.push(room, closet)
      rooms.push(doorEl(kit, `d-${id}`, id, 'v', wallX, room.y + room.d / 2, 'interiorWide', { swing: -1, hinge: 'start' }))
      rooms.push(doorEl(kit, `d-closet-${bedNo}`, closet.id, 'h', bedX + 3.5, room.y, 'closet', { swing: 1, hinge: 'start', pair: true }))
      rooms.push(windowEl(kit, `win-${id}`, id, 'v', bedX, room.y + room.d / 2, 'A', true))
      rooms.push({ id: `fx-${id}`, kind: 'fixture', fixture: 'bed', element: true, open: true, name: FIXTURE_NAME.bed, room: id, x: bedX + 0.5, y: room.y + 2, w: 7, d: 6.5, h: FIXTURE_H.bed })
    } else {
      bathNo += 1
      const id = `bath-${bathNo}`
      const room = { id, kind: 'bath', name: `Bath ${bathNo}`, x: bedX, y: bandY, w: bedW, d: D, zone: 'private', open: false, plumbing: true }
      rooms.push(room)
      rooms.push(doorEl(kit, `d-${id}`, id, 'v', wallX, room.y + room.d / 2, 'bath', { swing: -1, hinge: 'start' }))
      rooms.push(windowEl(kit, `win-${id}`, id, 'v', bedX, room.y + room.d / 2, 'C'))
      const fx = (k, x, y, w, d, extra = {}) => rooms.push({ id: `fx-${id}-${k}`, kind: 'fixture', fixture: k, element: true, open: true, name: FIXTURE_NAME[k], room: id, x, y, w, d, h: FIXTURE_H[k], ...extra })
      fx('shower', bedX + 0.3, bandY + 0.3, 3, 5.4)
      fx('toilet', bedX + 4.5, bandY + 0.3, 2.3, 1.5, { face: 's' })
      fx('vanity', bedX + 8, bandY + 0.3, 3.5, 2, { face: 's' })
    }
  })
  return total
}

/**
 * The garage attaches at the service end, with its house door into the laundry (rated and self
 * closing), an overhead door toward the street, and nothing covering a window. Front-load beside
 * the laundry when the lot is wide enough, else behind it with the overhead door on its outer
 * side wall and a driveway down the side. Placed rooms in; placed rooms out.
 */
/**
 * The overhead doors for a garage with `cars` bays on one wall: one 16' door or two 9' doors for
 * two cars, 16' + 9' or three 9' doors for three, two 16' for four, one 9' for one. No two doors
 * overlap, at least 2 ft of wall between doors and at the ends, each door centred on its bays when
 * that leaves the 2 ft, else spread evenly. `side` is the wall: 's' (front) 'n' 'e' 'w'.
 */
export function overheadDoors(kit, room, cars, side = 's') {
  const wide = (kit.doors.overhead?.w || 192) / 12
  const single = (kit.doors.overheadSingle?.w || 108) / 12
  const wallLen = side === 's' || side === 'n' ? room.w : room.d
  const n = Math.max(1, Math.round(cars))
  // the widths, in bay order, and how many bays each covers
  const plans = n === 1 ? [[single, 1]] : n === 2 ? [[wide, 2]] : n === 3 ? [[wide, 2], [single, 1]] : n === 4 ? [[wide, 2], [wide, 2]] : [[wide, 2], [wide, 2], [single, 1]]
  let doors = plans
  const sum = (list) => list.reduce((a, [w]) => a + w, 0)
  if (sum(doors) + 2 * (doors.length + 1) > wallLen + 0.01) {
    // too tight for the wide doors: singles, one per bay, as many as fit with 2 ft walls
    const singles = []
    for (let i = 0; i < n && (i + 1) * single + 2 * (i + 2) <= wallLen + 0.01; i++) singles.push([single, 1])
    if (singles.length) doors = singles
    else doors = [[Math.min(single, wallLen - 4), 1]]
  }
  const bays = doors.reduce((a, [, b]) => a + b, 0)
  const bayW = wallLen / Math.max(bays, 1)
  // centred on the bays
  let starts = []
  let at = 0
  doors.forEach(([w, b]) => {
    starts.push(at * bayW + (b * bayW - w) / 2)
    at += b
  })
  const gapsOk = (st) => st.every((x, i) => x >= 2 - 0.01 && x + doors[i][0] <= wallLen - 2 + 0.01 && (i === 0 || x - (st[i - 1] + doors[i - 1][0]) >= 2 - 0.01))
  if (!gapsOk(starts)) {
    // spread evenly: equal wall between the doors and at the ends
    const gap = (wallLen - sum(doors)) / (doors.length + 1)
    starts = []
    let x = gap
    doors.forEach(([w]) => {
      starts.push(x)
      x += w + gap
    })
  }
  return doors.map(([w], i) => {
    const size = w >= wide - 0.01 ? 'overhead' : 'overheadSingle'
    const id = i === 0 ? 'd-garage-overhead' : `d-garage-overhead-${i + 1}`
    const c = starts[i] + w / 2
    const el =
      side === 's' ? doorEl(kit, id, room.id, 'h', room.x + c, room.y + room.d, size, { swing: 1 })
      : side === 'n' ? doorEl(kit, id, room.id, 'h', room.x + c, room.y, size, { swing: -1 })
      : side === 'e' ? doorEl(kit, id, room.id, 'v', room.x + room.w, room.y + c, size, { swing: 1 })
      : doorEl(kit, id, room.id, 'v', room.x, room.y + c, size, { swing: -1 })
    // a narrowed single keeps its drawn width
    if (Math.abs(el.span - w) > 0.01) {
      el.span = w
      if (el.axis === 'h') {
        el.w = w
        el.x = room.x + c - w / 2
      } else {
        el.d = w
        el.y = room.y + c - w / 2
      }
    }
    return el
  })
}

/** Which wall of the garage its overhead doors are on: 's' 'n' 'e' 'w', or null. */
export function garageFacing(room, doors) {
  const d = doors.find((e) => e.kind === 'door' && e.room === room.id && (e.size === 'overhead' || e.size === 'overheadSingle'))
  if (!d) return null
  const cx = d.x + d.w / 2
  const cy = d.y + d.d / 2
  if (d.axis === 'h') return Math.abs(cy - (room.y + room.d)) < Math.abs(cy - room.y) ? 's' : 'n'
  return Math.abs(cx - (room.x + room.w)) < Math.abs(cx - room.x) ? 'e' : 'w'
}

/** Is a plan point inside the lot boundary? Plan coords, the kit's plan centre at the lot centre. */
export function insideLot(lot, kit, x, y) {
  const L = lotOf(lot)
  if (!L.boundary || L.boundary.length < 3) return true
  const centre = kit.plan ? [kit.plan.footprint.w / 2, kit.plan.footprint.d / 2] : [0, 0]
  return insidePoly(L.boundary, worldOf(L, x - centre[0], y - centre[1]))
}

export function attachGarage(placed, kit, cars, lot, stories = 1) {
  const L = lotOf(lot)
  const centre = kit.plan ? [kit.plan.footprint.w / 2, kit.plan.footprint.d / 2] : [0, 0]
  const flat = placed.map((r) => (r.x !== undefined || !r.local ? { ...r } : { ...r, x: r.local[0] + centre[0] - r.w / 2, y: r.local[1] + centre[1] - r.d / 2 }))
  const laundry = flat.find((r) => r.id === 'laundry') || flat.find((r) => r.kind === 'laundry') || flat.find((r) => r.kind === 'mud')
  if (!laundry) return placed
  const g = kit.rooms.garage
  const w = Math.max(g.perCar * cars, cars >= 3 ? 32 : 0)
  const d = g.d
  const solid = flat.filter((r) => isRoom(r) && !r.open)
  const xs = solid.flatMap((r) => [r.x, r.x + r.w])
  const [envW] = envelopeSize(L)
  const eastFits = Math.max(...xs) + w - Math.min(...xs) <= envW + 0.01
  // a garage that would reach past the rear lot line can still go on when the whole house can slide
  // toward the street by that much (the fit after this attaches it does the sliding)
  const envL = L.envelope && L.envelope.length >= 3 ? L.envelope.map((pt) => localOf(L, pt)) : null
  const envRear = envL ? Math.min(...envL.map((pt) => pt[1])) + centre[1] : -Infinity
  const envFront = envL ? Math.max(...envL.map((pt) => pt[1])) + centre[1] : Infinity
  const houseFront = Math.max(...solid.map((r) => r.y + r.d))
  const slackFront = Math.max(0, envFront - houseFront)
  const slideFor = (rect) => Math.max(0, Math.min(slackFront, envRear - rect.y))
  const inLotShifted = (x, y, shift) => insideLot(L, kit, x, y + shift)
  // side-load needs 25 ft clear from the overhead door to the lot line (a car has to turn in): the
  // garage sits behind the laundry, and steps west along the rear of the house until it has them
  const clearAt = (face, y) => {
    const shift = slideFor({ y })
    return inLotShifted(face + 25, y + w / 2, shift) && inLotShifted(face + 25, y + 1, shift) && inLotShifted(face + 25, y + w - 1, shift) && y + shift >= envRear - 0.01
  }
  // a side-load garage turns: its bays run front to back, the doors along its long side
  const sw = d
  const sd = w
  let sideRoom = { x: laundry.x + laundry.w - sw, y: laundry.y - sd, w: sw, d: sd }
  let sideClear = clearAt(sideRoom.x + sideRoom.w, sideRoom.y)
  for (let shift = 1; !sideClear && shift <= 30; shift++) {
    const r = { x: laundry.x + laundry.w - sw - shift, y: laundry.y - sd, w: sw, d: sd }
    if (clearAt(r.x + r.w, r.y)) {
      sideRoom = r
      sideClear = true
    }
  }
  // it must still touch a room it can open into (mud room, laundry, hall or foyer) along its front wall
  let hostRow = solid.filter((r) => ['laundry', 'mud', 'hall', 'foyer'].includes(r.kind) && Math.abs(r.y - (sideRoom.y + sideRoom.d)) < 0.75 && Math.min(r.x + r.w, sideRoom.x + sideRoom.w) - Math.max(r.x, sideRoom.x) >= 3.5)
  if (sideClear && !hostRow.length) sideClear = false
  // or the courtyard way: the doors on the garage's west face toward the rear yard, 25 ft of apron
  // there, and a 10 ft driveway down the east side yard from the street to the rear
  let courtyard = false
  if (!eastFits && !sideClear) {
    const r = { x: laundry.x + laundry.w - sw, y: laundry.y - sd, w: sw, d: sd }
    const apron = { x: r.x - 25, y: r.y, w: 25, d: r.d }
    const shift = slideFor(r)
    const apronClear = r.y + shift >= envRear - 0.01 && !solid.some((o) => Math.min(o.x + o.w, apron.x + apron.w) - Math.max(o.x, apron.x) > 0.5 && Math.min(o.y + o.d, apron.y + apron.d) - Math.max(o.y, apron.y) > 0.5) && inLotShifted(apron.x, apron.y + 1, shift) && inLotShifted(apron.x, apron.y + apron.d - 1, shift)
    // the lane down the east side yard, 10 ft wide; the house may slide west by what its west yard has
    // beyond the setback (the fit after this does the sliding)
    const east = Math.max(...xs)
    const envWest = envL ? Math.min(...envL.map((pt) => pt[0])) + centre[0] : -Infinity
    const westSlack = Math.max(0, Math.min(...xs) - envWest)
    const lane = [r.y, Math.max(...solid.map((o) => o.y + o.d)) + 30]
    const laneAt = (dxShift) => {
      let ok = insideLot(L, kit, east + 10 - dxShift, r.y + 1 + shift)
      for (let y = r.y; y < lane[1] && ok; y += 5) ok = insideLot(L, kit, east + 10 - dxShift, y + shift)
      return ok
    }
    const laneClear = laneAt(0) || laneAt(westSlack)
    const hostW = solid.filter((o) => ['laundry', 'mud', 'hall', 'foyer'].includes(o.kind) && Math.abs(o.y - (r.y + r.d)) < 0.75 && Math.min(o.x + o.w, r.x + r.w) - Math.max(o.x, r.x) >= 3.5)
    if (apronClear && laneClear && hostW.length) {
      courtyard = true
      sideRoom = r
      hostRow = hostW
    }
  }
  const house = (x, y, cars, gw = w, gd = d) => ({ id: 'garage', kind: 'garage', name: `${cars}-Car Garage`, x, y, w: gw, d: gd, zone: 'service', open: false, plumbing: false, fill: '#dcd7cf' })
  const elements = []
  let room
  if (eastFits || (!sideClear && !courtyard)) {
    // front-load: beside the laundry, overhead doors on the front wall, house door through the laundry's east wall
    room = house(laundry.x + laundry.w, laundry.y, cars)
    const occupied = flat.filter((e) => e.element && e.kind === 'fixture' && e.room === laundry.id && e.x + e.w > laundry.x + laundry.w - 1)
    let dy = laundry.y + 2.5
    if (occupied.some((f) => dy > f.y - 1.5 && dy < f.y + f.d + 1.5)) dy = laundry.y + laundry.d - 2.5
    elements.push(doorEl(kit, 'd-garage', 'garage', 'v', room.x, dy, 'garage', { swing: 1, hinge: 'start' }))
    elements.push(...overheadDoors(kit, room, cars, 's'))
  } else {
    // side-load behind the house: house door through the rear wall of the laundry (or mud room / hall it
    // touches), overhead doors on the garage's east wall
    room = house(sideRoom.x, sideRoom.y, cars, sideRoom.w, sideRoom.d)
    const host = hostRow.find((r) => r.id === laundry.id) || hostRow.sort((a, b) => Math.min(b.x + b.w, room.x + room.w) - Math.max(b.x, room.x) - (Math.min(a.x + a.w, room.x + room.w) - Math.max(a.x, room.x)))[0]
    const x0 = Math.max(host.x, room.x) + 0.5
    const x1 = Math.min(host.x + host.w, room.x + room.w) - 0.5
    elements.push(doorEl(kit, 'd-garage', 'garage', 'h', (x0 + x1) / 2, host.y, 'garage', { swing: -1, hinge: 'start' }))
    elements.push(...overheadDoors(kit, room, cars, courtyard ? 'w' : 'e'))
    if (courtyard) room.driveway = 'courtyard' // the driveway runs down the east side yard and across the rear to the west-facing doors
    // a rear window of a room the garage covers moves to that room's outside side wall when it has one
    flat.filter((e) => e.kind === 'window' && e.room !== 'garage').forEach((win) => {
      const home = solid.find((r) => r.id === win.room)
      if (!home) return
      const c = [win.x + win.w / 2, win.y + win.d / 2]
      const covered = c[0] > room.x - 0.3 && c[0] < room.x + room.w + 0.3 && c[1] > room.y - 0.3 && c[1] < room.y + room.d + 0.3
      if (!covered) return
      const eastFree = !solid.some((r) => r !== home && Math.abs(r.x - (home.x + home.w)) < 0.75 && Math.min(r.y + r.d, home.y + home.d) - Math.max(r.y, home.y) > 1) && home.x + home.w >= room.x + room.w - 0.3
      const westFree = !solid.some((r) => r !== home && Math.abs(r.x + r.w - home.x) < 0.75 && Math.min(r.y + r.d, home.y + home.d) - Math.max(r.y, home.y) > 1) && home.x <= room.x + 0.3
      if (eastFree) Object.assign(win, windowEl(kit, win.id, home.id, 'v', home.x + home.w, home.y + home.d - 3, win.mark || 'A'))
      else if (westFree) Object.assign(win, windowEl(kit, win.id, home.id, 'v', home.x, home.y + home.d - 3, win.mark || 'A'))
    })
  }
  // never on another room's window or door
  flat.filter((e) => e.element && (e.kind === 'window' || e.kind === 'door') && e.room !== laundry.id).forEach((e) => {
    const c = [e.x + e.w / 2, e.y + e.d / 2]
    if (c[0] > room.x - 0.3 && c[0] < room.x + room.w + 0.3 && c[1] > room.y - 0.3 && c[1] < room.y + room.d + 0.3) room.blocked = true
  })
  if (room.blocked) return placed
  flat.push(room, ...elements)
  // a gable over the garage, ridge along its long side, tied into the house roof
  const roof = flat.find((r) => r.kind === 'roof')
  if (roof && roof.masses) {
    const k = roof.scale || 1
    const off = roof.offset || [0, 0]
    const c = roof.centre || centre
    const base = (v, i) => c[i] + (v - off[i] - c[i]) / k
    const ridgeEW = room.w >= room.d
    roof.masses = [...roof.masses, { id: 'garage', kind: 'gable', x0: base(room.x, 0), x1: base(room.x + room.w, 0), y0: base(room.y, 1), y1: base(room.y + room.d, 1), ridge: ridgeEW ? 'ew' : 'ns', plate: 11, pitch: +String(kit.roof?.pitch || '10').split(':')[0] || 10, ends: eastFits ? (ridgeEW ? ['e'] : ['s']) : (ridgeEW ? ['w'] : ['n']) }]
    roof.faces = roofSurfaces(roof.masses, k, c, off)
    roof.dormers = dormerWalls(roof.masses, k, c, off)
  }
  const out = placeLocal(flat.filter((r) => r.kind !== 'roof'), stories, kit, centre, L)
  if (roof) out.push(roof)
  return out
}

/** World → house frame (the inverse of worldOf). */
function localOf(lot, [X, Z]) {
  const cos = Math.cos(lot.angle)
  const sin = Math.sin(lot.angle)
  const dx = X - lot.centre[0]
  const dz = Z - lot.centre[1]
  return [dx * cos + dz * sin, -dx * sin + dz * cos]
}
function insidePoly(poly, [x, z]) {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]
    const [xj, zj] = poly[j]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c
  }
  return c
}

/**
 * Shift the whole house (and, when it still does not fit, shrink it a little) until every
 * enclosed room sits inside the lot's setback envelope. Rooms keep their shape and their
 * place relative to each other. Returns { rooms, shift: [dx, dy] plan feet, scale }.
 * Open porches may hang past the envelope (they are not enclosed); the rules agree.
 */
export function fitToLot(rooms, kit, stories = 1, lot = DEFAULT_LOT, { maxShift = 40, minScale = 0.85 } = {}) {
  const L = lotOf(lot)
  if (!L.envelope || L.envelope.length < 3) return { rooms, shift: [0, 0], scale: 1 }
  const env = L.envelope.map((p) => localOf(L, p))
  const centre = kit.plan ? [kit.plan.footprint.w / 2, kit.plan.footprint.d / 2] : [0, 0]
  const flat = rooms.map((r) => (r.x !== undefined || !r.local ? { ...r } : { ...r, x: r.local[0] + centre[0] - r.w / 2, y: r.local[1] + centre[1] - r.d / 2 }))
  const solid = flat.filter((r) => isRoom(r) && !r.open)
  if (!solid.length) return { rooms, shift: [0, 0], scale: 1 }
  // the rooms at each trial scale (service rooms keep their size, see scalePlan)
  const mapped = new Map()
  const roomsAt = (s) => {
    if (!mapped.has(s)) {
      const copy = solid.map((r) => ({ ...r }))
      if (s !== 1) scalePlan(copy, s, centre[0], centre[1], kit)
      mapped.set(s, copy)
    }
    return mapped.get(s)
  }
  const cornersOf = (r, dx, dy) => {
    const x0 = r.x + dx - centre[0]
    const y0 = r.y + dy - centre[1]
    return [
      [x0, y0],
      [x0 + r.w, y0],
      [x0 + r.w, y0 + r.d],
      [x0, y0 + r.d],
    ]
  }
  const bound = L.boundary && L.boundary.length >= 3 ? L.boundary.map((p) => localOf(L, p)) : null
  const lanesAt = (s) => {
    const rs = roomsAt(s)
    return rs
      .filter((r) => r.kind === 'garage' && r.driveway === 'courtyard')
      .map((g) => {
        const east = Math.max(...rs.map((r) => r.x + r.w))
        const front = Math.max(...rs.map((r) => r.y + r.d))
        return { x: east, y: g.y, w: 10, d: front + 20 - g.y }
      })
  }
  const fits = (s, dx, dy) => roomsAt(s).every((r) => cornersOf(r, dx, dy).every((p) => insidePoly(env, p))) && (!bound || lanesAt(s).every((r) => cornersOf(r, dx, dy).every((p) => insidePoly(bound, p))))
  // the house's box must fit the envelope's box at all before any shift is worth trying
  const ex = env.map((p) => p[0])
  const ez = env.map((p) => p[1])
  const envW = Math.max(...ex) - Math.min(...ex)
  const envD = Math.max(...ez) - Math.min(...ez)
  const boxAt = (s) => {
    const rs = roomsAt(s)
    const hx = rs.flatMap((r) => [r.x, r.x + r.w])
    const hz = rs.flatMap((r) => [r.y, r.y + r.d])
    return [Math.max(...hx) - Math.min(...hx), Math.max(...hz) - Math.min(...hz)]
  }
  // rings of whole-foot shifts, nearest first, at each scale step
  const rings = []
  for (let ring = 0; ring <= maxShift; ring++) for (let dx = -ring; dx <= ring; dx++) for (let dy = -ring; dy <= ring; dy++) if (Math.max(Math.abs(dx), Math.abs(dy)) === ring) rings.push([dx, dy])
  let found = null
  for (let s = 1; s >= minScale - 1e-9 && !found; s = Math.round((s - 0.03) * 100) / 100) {
    const [houseW, houseD] = boxAt(s)
    if (houseW > envW + 0.01 || houseD > envD + 0.01 || !roomsMeetMinimums(roomsAt(s), kit)) continue
    const slackX = Math.ceil((envW - houseW) / 2) + 2
    const slackZ = Math.ceil((envD - houseD) / 2) + 2
    for (const [dx, dy] of rings) {
      if (Math.abs(dx) > slackX + maxShift || Math.abs(dy) > slackZ + maxShift) continue
      if (fits(s, dx, dy)) {
        found = { s, dx, dy }
        break
      }
    }
  }
  if (!found || (found.s === 1 && found.dx === 0 && found.dy === 0)) return { rooms, shift: [0, 0], scale: 1 }
  const { s, dx, dy } = found
  // doors, windows and fixtures keep their size through a trim and their place in their rooms; the roof follows
  if (s !== 1) scalePlan(flat, s, centre[0], centre[1], kit)
  const roof = flat.find((r) => r.kind === 'roof')
  if (roof) {
    roof.offset = [(roof.offset?.[0] || 0) + dx, (roof.offset?.[1] || 0) + dy]
    roof.faces = roofSurfaces(roof.masses, roof.scale || 1, roof.centre || centre, roof.offset)
    roof.dormers = dormerWalls(roof.masses, roof.scale || 1, roof.centre || centre, roof.offset)
  }
  flat.forEach((r) => {
    if (r.dormer || r.kind === 'roof') return
    r.x += dx
    r.y += dy
  })
  const placed = placeLocal(flat.filter((r) => r.kind !== 'roof'), stories, kit, centre, L)
  if (roof) placed.push(roof)
  return { rooms: placed, shift: [dx, dy], scale: s }
}

/** Rooms with plan coordinates (x, y from the rear-left corner) → placed on the lot. */
export function placeLocal(rooms, stories, kit, centre, lot = DEFAULT_LOT) {
  const L = lotOf(lot)
  return rooms.map((r) => {
    const lx = r.x + r.w / 2 - centre[0]
    const lz = r.y + r.d / 2 - centre[1] // y grows toward the street, which is +z (south) on this lot
    const plate = r.open ? 0.6 : r.kind === 'garage' ? 11 : kit.plates.byRoom[r.kind] || kit.plates.default
    if (r.element) return { ...r, plate: 0, center: worldOf(L, lx, lz), local: [lx, lz] }
    return {
      ...r,
      w: Math.round(r.w * 4) / 4,
      d: Math.round(r.d * 4) / 4,
      h: r.h ?? plate * stories,
      plate,
      center: worldOf(L, lx, lz),
      local: [lx, lz],
    }
  })
}

/** Lay zone rows front to back, centered on the envelope, rotated to the lot. */
export function place(rooms, stories = 1, kit = FARMHOUSE, lot = DEFAULT_LOT) {
  const L = lotOf(lot)
  const rows = ZONES.map((z) => rooms.filter((r) => r.zone === z)).filter((r) => r.length)
  const rowDepth = rows.map((r) => Math.max(...r.map((x) => x.d)))
  const rowWidth = rows.map((r) => r.reduce((s, x) => s + x.w, 0))
  const totalD = rowDepth.reduce((a, b) => a + b, 0)
  const out = []
  let zCursor = -totalD / 2
  rows.forEach((r, ri) => {
    let xCursor = -rowWidth[ri] / 2
    r.forEach((x) => {
      const lx = xCursor + x.w / 2
      const lz = zCursor + rowDepth[ri] / 2
      const plate = x.open ? 0.6 : x.kind === 'garage' ? 11 : (kit.plates.byRoom[x.kind] || kit.plates.default)
      out.push({
        ...x,
        h: x.h ?? plate * stories,
        plate,
        center: worldOf(L, lx, lz),
        local: [lx, lz], // before rotation; x along the front, z front to back
        row: ri,
      })
      xCursor += x.w
    })
    zCursor += rowDepth[ri]
  })
  return out
}

/** Conditioned floor area including the circulation allowance. */
export function floorArea(rooms, stories = 1) {
  const planBased = rooms.some((r) => r.kind === 'hall')
  return rooms.filter(isConditioned).reduce((s, r) => s + r.w * r.d, 0) * (planBased ? 1 : CIRCULATION) * stories
}

/** Exterior outline from the room blocks: perimeter, front width, depth, in feet. */
export function outline(rooms) {
  const solid = rooms.filter((r) => !r.open && !r.element)
  const inside = (pt, r) => Math.abs(pt[0] - r.local[0]) < r.w / 2 - 0.01 && Math.abs(pt[1] - r.local[1]) < r.d / 2 - 0.01
  let perimeter = 0
  solid.forEach((r) => {
    const [cx, cz] = r.local
    const edges = [
      [[cx - r.w / 2, cz - r.d / 2], [cx + r.w / 2, cz - r.d / 2]],
      [[cx + r.w / 2, cz - r.d / 2], [cx + r.w / 2, cz + r.d / 2]],
      [[cx + r.w / 2, cz + r.d / 2], [cx - r.w / 2, cz + r.d / 2]],
      [[cx - r.w / 2, cz + r.d / 2], [cx - r.w / 2, cz - r.d / 2]],
    ]
    edges.forEach(([a, b]) => {
      // sample the edge in 1 ft steps; a sample with no neighbour on the far side is exterior
      const len = Math.hypot(b[0] - a[0], b[1] - a[1])
      const nx = -(b[1] - a[1]) / len
      const nz = (b[0] - a[0]) / len
      const steps = Math.max(1, Math.round(len))
      for (let i = 0; i < steps; i++) {
        const t = (i + 0.5) / steps
        const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
        const out1 = [p[0] + nx * 1.25, p[1] + nz * 1.25] // past a wall or tracing gap
        const out2 = [p[0] - nx * 1.25, p[1] - nz * 1.25]
        const probe = inside(out1, r) ? out2 : out1
        if (!solid.some((o) => o !== r && inside(probe, o))) perimeter += len / steps
      }
    })
  })
  const xs = solid.flatMap((r) => [r.local[0] - r.w / 2, r.local[0] + r.w / 2])
  const zs = solid.flatMap((r) => [r.local[1] - r.d / 2, r.local[1] + r.d / 2])
  const maxWidth = Math.max(...xs) - Math.min(...xs)
  return { perimeter, frontWidth: maxWidth, depth: Math.max(...zs) - Math.min(...zs), maxWidth }
}
