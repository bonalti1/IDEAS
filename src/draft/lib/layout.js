// Layout engine, kit driven. Turns a program into room blocks that sit inside
// the lot's setback envelope, using the style kit's room templates and zones.
// Still a packer, not a solver: rows by zone (front porch, public, private,
// service, rear porch), centered on the envelope, rotated to the lot.
import { LOT_ANGLE } from '../../data/program.js'
import { SETBACK_CORNERS } from '../../data/survey.js'
import { KIT as FARMHOUSE } from '../../kits/modern-farmhouse.js'

const ENVELOPE_CENTER = [
  SETBACK_CORNERS.reduce((s, p) => s + p[0], 0) / 4,
  SETBACK_CORNERS.reduce((s, p) => s + p[1], 0) / 4,
]

// Halls, closets, and wall thickness are not modeled as rooms. On the Garza
// plan they are about 22% of the conditioned area, so the kit's room sizes
// are scaled against that.
export const CIRCULATION = 1.22
const ZONES = ['rear', 'service', 'private', 'public', 'front']

export const DEFAULT_PROGRAM = {
  beds: 4, baths: 3, halfBath: true, suite2: false, office: true,
  garage: 2, stories: 1, sqft: 2800, frontPorch: true, rearPorch: true,
}

export const kitFor = (style) => style?.kit || FARMHOUSE
export { ENVELOPE_CENTER }

let uid = 0
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

export function generateRooms(program, style) {
  const kit = kitFor(style)
  if (kit.plan) return fromPlan(program, kit)
  const rooms = roomsFor(program, kit)
  // Scale conditioned rooms so the plan lands on the requested square footage.
  const cond = rooms.filter(isConditioned)
  const base = cond.reduce((a, r) => a + r.w * r.d, 0) * CIRCULATION * program.stories
  const k = Math.sqrt(program.sqft / base)
  cond.forEach((r) => {
    r.w = Math.round(r.w * k * 2) / 2
    r.d = Math.round(r.d * k * 2) / 2
  })
  return place(rooms, program.stories, kit)
}

export const isConditioned = (r) => !r.open && r.kind !== 'garage'

/**
 * Start from the kit's traced plan and adjust it to the program:
 * drop extras that are off, add or remove bedrooms and baths at the wing
 * ends, add a garage beside the service wing, then scale to the square
 * footage. Positions stay where the drafter put them.
 */
export function fromPlan(program, kit) {
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

  // Bedrooms: the plan has (ref.beds - 1) secondary bedrooms. Add below the bed wing, remove from the bottom.
  const want = program.beds - 1
  const have = rooms.filter((r) => r.kind === 'bed').length
  if (want < have) drop('bed', have - want)
  for (let i = have; i < want; i++) addBelow(rooms, kit, 'bed', `Bedroom ${i + 1}`, 'bed')

  // Full baths: plan has mbath + jackjill + bath1 (+ suite2's bath is bath1 here).
  const wantB = program.baths - 1
  const haveB = rooms.filter((r) => r.kind === 'bath' || r.kind === 'jackjill').length
  if (wantB < haveB) drop('bath', haveB - wantB)
  for (let i = haveB; i < wantB; i++) addBelow(rooms, kit, 'bath', `Bath ${i + 1}`, 'bed')

  if (program.garage > 0) {
    const g = kit.rooms.garage
    const anchor = rooms.find((r) => r.kind === 'laundry') || rooms.find((r) => r.kind === 'mud')
    const w = g.perCar * program.garage
    rooms.push({ id: 'garage', kind: 'garage', name: `${program.garage}-Car Garage`, x: anchor ? anchor.x + anchor.w : T.footprint.w, y: anchor ? anchor.y : 0, w, d: g.d, zone: 'service', fill: '#dcd7cf' })
  }

  // Scale to the requested square footage about the plan centre.
  const cond = rooms.filter(isConditioned)
  const base = cond.reduce((a, r) => a + r.w * r.d, 0) * program.stories
  const k = Math.sqrt(program.sqft / base)
  const cx = T.footprint.w / 2
  const cy = T.footprint.d / 2
  rooms.forEach((r) => {
    r.x = cx + (r.x - cx) * k
    r.y = cy + (r.y - cy) * k
    r.w *= k
    r.d *= k
  })
  return placeLocal(rooms, program.stories, kit, [cx, cy])
}

function addBelow(rooms, kit, kind, name, belowKind) {
  const t = kit.rooms[kind]
  const col = rooms.filter((r) => r.kind === belowKind || r.kind === 'bath' || r.kind === 'suite2')
  const bottom = col.reduce((m, r) => Math.max(m, r.y + r.d), 0)
  const left = Math.min(...col.map((r) => r.x))
  rooms.push({ id: `${kind}-${rooms.length}`, kind, name, x: left, y: bottom, w: t.w, d: t.d, zone: t.zone, plumbing: !!t.plumbing })
}

/** Rooms with plan coordinates (x, y from the rear-left corner) → placed on the lot. */
export function placeLocal(rooms, stories, kit, centre) {
  const cos = Math.cos(LOT_ANGLE)
  const sin = Math.sin(LOT_ANGLE)
  return rooms.map((r) => {
    const lx = r.x + r.w / 2 - centre[0]
    const lz = r.y + r.d / 2 - centre[1] // y grows toward the street, which is +z (south) on this lot
    const plate = r.open ? 0.6 : r.kind === 'garage' ? 11 : kit.plates.byRoom[r.kind] || kit.plates.default
    return {
      ...r,
      w: Math.round(r.w * 4) / 4,
      d: Math.round(r.d * 4) / 4,
      h: r.h ?? plate * stories,
      plate,
      center: [ENVELOPE_CENTER[0] + lx * cos - lz * sin, ENVELOPE_CENTER[1] + lx * sin + lz * cos],
      local: [lx, lz],
    }
  })
}

/** Lay zone rows front to back, centered on the envelope, rotated to the lot. */
export function place(rooms, stories = 1, kit = FARMHOUSE) {
  const rows = ZONES.map((z) => rooms.filter((r) => r.zone === z)).filter((r) => r.length)
  const rowDepth = rows.map((r) => Math.max(...r.map((x) => x.d)))
  const rowWidth = rows.map((r) => r.reduce((s, x) => s + x.w, 0))
  const totalD = rowDepth.reduce((a, b) => a + b, 0)
  const cos = Math.cos(LOT_ANGLE)
  const sin = Math.sin(LOT_ANGLE)
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
        center: [ENVELOPE_CENTER[0] + lx * cos - lz * sin, ENVELOPE_CENTER[1] + lx * sin + lz * cos],
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
  const solid = rooms.filter((r) => !r.open)
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

/**
 * Mock interpreter for plain-language change requests.
 * Returns { rooms, reply, applied } without any network call.
 * The real version sends the request and the current rooms to Claude and
 * gets a structured diff back, then runs it through the rules engine.
 */
export function applyRequest(text, rooms, stories, style) {
  const kit = kitFor(style)
  const t = text.toLowerCase()
  const grow = /\b(bigger|larger|wider|more room|expand|increase)\b/.test(t)
  const shrink = /\b(smaller|tighter|reduce|shrink|less)\b/.test(t)
  const add = /\b(add|another|extra|one more)\b/.test(t)
  const remove = /\b(remove|delete|drop|get rid of|without|no)\b/.test(t)

  const kinds = [
    ['mbath', /(primary|master) bath/],
    ['master', /(primary|master)/],
    ['kitchen', /kitchen/],
    ['living', /living|family room|great room/],
    ['dining', /dining/],
    ['garage', /garage/],
    ['bed', /bedroom|bed\b/],
    ['halfbath', /half bath|powder/],
    ['bath', /\bbath/],
    ['laundry', /laundry|utility/],
    ['frontPorch', /front porch/],
    ['rearPorch', /rear porch|back porch|patio/],
    ['office', /office|study/],
    ['pantry', /pantry/],
    ['mud', /mud ?room/],
  ]
  const kind = kinds.find(([, re]) => re.test(t))?.[0]
  const flat = rooms.map((r) => ({ ...r }))

  if (kind && add) {
    if (!kit.rooms[kind]) return { rooms, reply: `That room is not in the ${kit.name} kit yet.`, applied: false }
    const n = flat.filter((r) => r.kind === kind).length + 1
    const room = mk(kit, kind, kind === 'bed' ? { name: `Bedroom ${n}` } : kind === 'bath' ? { name: `Bath ${n}` } : {})
    flat.push(room)
    return relayout(flat, stories, kit, `Added ${room.name.toLowerCase()}, ${room.w}' by ${room.d}' per the ${kit.name} kit. Area and estimate updated.`)
  }
  if (kind && remove) {
    const idx = flat.map((r) => r.kind).lastIndexOf(kind)
    if (idx === -1) return { rooms, reply: `There is no ${kit.rooms[kind]?.name.toLowerCase() || kind} in the plan to remove.`, applied: false }
    const gone = flat.splice(idx, 1)[0]
    return relayout(flat, stories, kit, `Removed ${gone.name.toLowerCase()}.`)
  }
  if (kind && (grow || shrink)) {
    const f = grow ? 1.15 : 0.87
    let hit = 0
    flat.forEach((r) => {
      if (r.kind === kind) {
        r.w = Math.round(r.w * f * 2) / 2
        r.d = Math.round(r.d * f * 2) / 2
        hit++
      }
    })
    if (!hit) return { rooms, reply: `I could not find that room to change.`, applied: false }
    const label = kit.rooms[kind]?.name.toLowerCase() || kind
    return relayout(flat, stories, kit, `${grow ? 'Enlarged' : 'Reduced'} the ${label} by about 15 percent. Still inside the setback envelope.`)
  }
  return {
    rooms,
    applied: false,
    reply: 'In the real app this goes to the design assistant. For now try "make the kitchen bigger", "add an office", or "remove the rear porch".',
  }
}

function relayout(flat, stories, kit, reply) {
  if (flat.some((r) => r.x !== undefined)) {
    // plan-based: positions are kept; new rooms (no x yet) go below the bedroom wing
    const centre = [kit.plan.footprint.w / 2, kit.plan.footprint.d / 2]
    flat.forEach((r) => {
      if (r.x === undefined) {
        const col = flat.filter((o) => o.x !== undefined && ['bed', 'bath', 'suite2'].includes(o.kind))
        r.x = Math.min(...col.map((o) => o.x))
        r.y = col.reduce((m, o) => Math.max(m, o.y + o.d), 0)
      }
      // keep the room centred where it was after a size change
      if (r.local) {
        r.x = r.local[0] + centre[0] - r.w / 2
        r.y = r.local[1] + centre[1] - r.d / 2
      }
    })
    return { rooms: placeLocal(flat, stories, kit, centre), reply, applied: true }
  }
  return { rooms: place(flat, stories, kit), reply, applied: true }
}
