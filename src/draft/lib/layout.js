// Layout engine, kit driven. Turns a program into room blocks that sit inside
// the lot's setback envelope, using the style kit's room templates and zones.
// Still a packer, not a solver: rows by zone (front porch, public, private,
// service, rear porch), centered on the envelope, rotated to the lot.
import { KIT as FARMHOUSE, FIXTURE_H, FIXTURE_NAME } from '../../kits/modern-farmhouse.js'
import { roofSurfaces, dormerWalls } from './roof.js'
import { DEFAULT_LOT, worldOf } from './lot.js'
import { applyOps } from './ops.js'

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
function minScale(rooms, kit) {
  const R = kit.rules || {}
  let k = 0.5
  rooms.filter(isConditioned).forEach((r) => {
    const min = R.minSize?.[r.kind]
    const [mw, md] = min || (R.habitable?.includes(r.kind) ? [7, 7] : [3, 3])
    k = Math.max(k, Math.min(mw, md) / Math.min(r.w, r.d), Math.max(mw, md) / Math.max(r.w, r.d))
    if (R.habitable?.includes(r.kind)) k = Math.max(k, Math.sqrt(70 / (r.w * r.d)))
  })
  return k
}

export const isConditioned = (r) => !r.open && r.kind !== 'garage' && !r.element
/** Rooms only: no doors, windows, or fixtures. */
export const isRoom = (r) => !r.element

/**
 * Start from the kit's traced plan and adjust it to the program:
 * drop extras that are off, add or remove bedrooms and baths at the wing
 * ends, add a garage beside the service wing, then scale to the square
 * footage. Positions stay where the drafter put them.
 */
export function fromPlan(program, kit, lot = DEFAULT_LOT) {
  const ref = kit.reference?.program || {}
  const T = kit.plan
  let rooms = T.rooms.map((r) => ({ ...r, zone: kit.rooms[r.kind]?.zone || 'private', open: !!kit.rooms[r.kind]?.open, plumbing: !!kit.rooms[r.kind]?.plumbing, fill: kit.rooms[r.kind]?.open ? '#e6e1d8' : r.kind === 'garage' ? '#dcd7cf' : undefined, h: kit.rooms[r.kind]?.open ? 0.6 : undefined }))

  const drop = (kind, n = 1) => {
    for (let i = 0; i < n; i++) {
      const idx = rooms.map((r) => r.kind).lastIndexOf(kind)
      if (idx >= 0) rooms.splice(idx, 1)
    }
  }
  if (!program.office) drop('office')
  if (!program.suite2) { drop('suite2'); rooms = rooms.filter((r) => r.id !== 'wic2') }
  if (!program.halfBath) drop('halfbath')
  if (!program.frontPorch) drop('frontPorch')
  if (!program.rearPorch) drop('rearPorch')

  // Bedrooms: the plan has (ref.beds - 1) secondary bedrooms. Remove from the bottom of the wing;
  // extra bedrooms, baths and the garage are added after placement, like a client's "add" (so they
  // get a door and a window, sit against the house, and stay inside the setbacks).
  const want = program.beds - 1
  const have = rooms.filter((r) => r.kind === 'bed').length
  if (want < have) drop('bed', have - want)
  const extras = []
  for (let i = have; i < want; i++) extras.push({ op: 'add', kind: 'bed', name: `Bedroom ${i + 1}`, id: `bed-${i + 1}`, near: 'bed' })

  // Full baths: plan has mbath + jackjill + bath1 (+ suite2's bath is bath1 here). When one has to go,
  // take the one whose removal leaves every wet room within reach of the plumbing (the kit's rule).
  const wantB = program.baths - 1
  const haveB = rooms.filter((r) => r.kind === 'bath' || r.kind === 'jackjill').length
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
  for (let i = haveB; i < wantB; i++) extras.push({ op: 'add', kind: 'bath', name: `Bath ${i + 1}`, id: `bath-${i + 1}`, near: 'bed' })

  if (program.garage > 0) {
    const g = kit.rooms.garage
    const anchor = rooms.find((r) => r.kind === 'laundry') || rooms.find((r) => r.kind === 'mud')
    extras.unshift({ op: 'add', kind: 'garage', name: `${program.garage}-Car Garage`, id: 'garage', w: g.perCar * program.garage, d: g.d, near: anchor?.id })
  }

  // Doors, windows, fixtures ride along as elements (not rooms). Those whose
  // room was dropped are dropped too.
  const ids = new Set(rooms.map((r) => r.id))
  const keep = (e) => !e.room || ids.has(e.room) || e.room === 'dormer'
  ;(T.doors || []).filter(keep).forEach((d, i) => {
    const w = d.axis === 'h' ? d.w : 0.6
    const dd = d.axis === 'h' ? 0.6 : d.w
    rooms.push({ ...d, id: d.id || `door-${i}`, kind: 'door', element: true, open: true, name: d.cased ? 'Opening' : 'Door', x: d.x - w / 2, y: d.y - dd / 2, w, d: dd, span: d.w, h: 6.67 })
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

  // Scale to the requested square footage about the plan centre, but never so small that a room
  // falls under the kit's minimum: the draft then comes out at the smallest size this plan allows.
  const cond = rooms.filter(isConditioned)
  const base = cond.reduce((a, r) => a + r.w * r.d, 0) * program.stories
  const kMin = minScale(rooms, kit)
  const kReq = Math.sqrt(program.sqft / base)
  const k = Math.max(kReq, kMin)
  const minSqft = Math.round((base * kMin * kMin) / 50) * 50
  const cx = T.footprint.w / 2
  const cy = T.footprint.d / 2
  rooms.forEach((r) => {
    if (r.dormer) return
    r.x = cx + (r.x - cx) * k
    r.y = cy + (r.y - cy) * k
    r.w *= k
    r.d *= k
    if (r.span) r.span *= k
  })
  let placed = placeLocal(rooms, program.stories, kit, [cx, cy], lot)
  if (T.roof) {
    // roof masses whose room was dropped are dropped too; the rest scale with the plan
    const masses = T.roof.filter((m) => !m.id || ids.has(m.id) || !T.rooms.some((r) => r.id === m.id)).filter((m) => !(m.id === 'leftwing' && !ids.has('suite2')))
    placed.push({ id: 'roof', kind: 'roof', element: true, open: true, name: 'Roof', x: -100, y: -100, w: 0, d: 0, h: 0, local: [0, 0], center: [0, 0], masses, scale: k, centre: [cx, cy], offset: [0, 0], faces: roofSurfaces(masses, k, [cx, cy]), dormers: dormerWalls(masses, k, [cx, cy]) })
  }
  // the house sits where it fits on this lot before the extras go on, so they are placed against the real
  // position; the fit may trim the house, but never under the kit's minimum room sizes
  const floor = { minScale: Math.max(0.85, kMin / k) }
  const first = fitToLot(placed, kit, program.stories, lot, floor)
  placed = first.rooms
  if (extras.length) {
    const near = (op) => (op.near === 'bed' ? placed.filter((r) => isRoom(r) && r.kind === 'bed').map((r) => r.id).pop() || placed.find((r) => isRoom(r) && r.kind === 'master')?.id : op.near)
    const ops = extras.map((op) => ({ ...op, near: near(op) })).map((op) => (op.near && placed.some((r) => r.id === op.near) ? op : { ...op, near: undefined }))
    placed = applyOps(ops, placed, kit, program.stories, lot, { starter: true }).rooms
  }
  const fit = fitToLot(placed, kit, program.stories, lot, { minScale: Math.max(0.85, kMin / (k * first.scale)) })
  return { rooms: fit.rooms, planScale: k, minSqft, clamped: kReq < kMin - 1e-9, fitScale: first.scale * fit.scale, fitShift: [first.shift[0] + fit.shift[0], first.shift[1] + fit.shift[1]] }
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
  const cornersOf = (r, s, dx, dy) => {
    const x0 = centre[0] + (r.x - centre[0]) * s + dx - centre[0]
    const y0 = centre[1] + (r.y - centre[1]) * s + dy - centre[1]
    return [
      [x0, y0],
      [x0 + r.w * s, y0],
      [x0 + r.w * s, y0 + r.d * s],
      [x0, y0 + r.d * s],
    ]
  }
  const fits = (s, dx, dy) => solid.every((r) => cornersOf(r, s, dx, dy).every((p) => insidePoly(env, p)))
  // the house's box must fit the envelope's box at all before any shift is worth trying
  const ex = env.map((p) => p[0])
  const ez = env.map((p) => p[1])
  const envW = Math.max(...ex) - Math.min(...ex)
  const envD = Math.max(...ez) - Math.min(...ez)
  const hx = solid.flatMap((r) => [r.x - centre[0], r.x + r.w - centre[0]])
  const hz = solid.flatMap((r) => [r.y - centre[1], r.y + r.d - centre[1]])
  const houseW = Math.max(...hx) - Math.min(...hx)
  const houseD = Math.max(...hz) - Math.min(...hz)
  // rings of whole-foot shifts, nearest first, at each scale step
  const rings = []
  for (let ring = 0; ring <= maxShift; ring++) for (let dx = -ring; dx <= ring; dx++) for (let dy = -ring; dy <= ring; dy++) if (Math.max(Math.abs(dx), Math.abs(dy)) === ring) rings.push([dx, dy])
  let found = null
  for (let s = 1; s >= minScale - 1e-9 && !found; s = Math.round((s - 0.03) * 100) / 100) {
    if (houseW * s > envW + 0.01 || houseD * s > envD + 0.01) continue
    const slackX = Math.ceil((envW - houseW * s) / 2) + 2
    const slackZ = Math.ceil((envD - houseD * s) / 2) + 2
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
  flat.forEach((r) => {
    if (r.dormer) return
    if (r.kind === 'roof') {
      r.scale = (r.scale || 1) * s
      r.offset = [(r.offset?.[0] || 0) * s + dx, (r.offset?.[1] || 0) * s + dy]
      r.faces = roofSurfaces(r.masses, r.scale, r.centre || centre, r.offset)
      r.dormers = dormerWalls(r.masses, r.scale, r.centre || centre, r.offset)
      return
    }
    r.x = centre[0] + (r.x - centre[0]) * s + dx
    r.y = centre[1] + (r.y - centre[1]) * s + dy
    r.w *= s
    r.d *= s
    if (r.span) r.span *= s
  })
  const roof = flat.find((r) => r.kind === 'roof')
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
