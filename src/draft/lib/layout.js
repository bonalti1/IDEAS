// Layout engine, kit driven. Turns a program into room blocks that sit inside
// the lot's setback envelope, using the style kit's room templates and zones.
// Still a packer, not a solver: rows by zone (front porch, public, private,
// service, rear porch), centered on the envelope, rotated to the lot.
import { KIT as FARMHOUSE, FIXTURE_H, FIXTURE_NAME } from '../../kits/modern-farmhouse.js'
import { roofSurfaces, dormerWalls } from './roof.js'
import { DEFAULT_LOT, worldOf } from './lot.js'
import { applyOps, envelopeSize, pushWall, settleIslands, settleKitchen } from './ops.js'
import { fillVoid } from './add.js'
import { drivewaySlabs, drivewayProblem, frameOf } from './site.js'
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
/** The width of the lot's setback envelope in the house frame (Infinity with no envelope). */
export function envelopeWidth(lot) {
  const L = lotOf(lot)
  if (!L.envelope || L.envelope.length < 3) return Infinity
  const xs = L.envelope.map((p) => localOf(L, p)[0])
  return Math.max(...xs) - Math.min(...xs)
}

export function fromPlan(program, kit, lot = DEFAULT_LOT, planId = null) {
  if (!planId && kit.plans && Object.keys(kit.plans).length) {
    const noEnvelope = !lotOf(lot).envelope
    const inRange = (range) => !range || !program.sqft || (program.sqft >= range[0] && program.sqft <= range[1])
    // a plan wider than the lot at its smallest is not drawn to find that out (round 8: the rooms step's speed)
    const envW = envelopeWidth(lot)
    const narrowEnough = (plan) => !plan?.minWidth || plan.minWidth <= envW + 0.01
    // first the plans drawn for this living area (the compact one for a small house), the standard plan ahead
    // of the others; then any plan that holds the program and fits the lot; the standard plan when none does
    const standard = fromPlan(program, kit, lot, 'standard')
    const standardFits = noEnvelope || fitsEnvelope(standard.rooms, kit, lot)
    // a garage the standard plan could only take by trimming the house (or not at all): the garage-forward
    // variant puts it at the front corner and keeps the house its size
    const hasGarage = (d) => d.rooms.some((r) => isRoom(r) && r.kind === 'garage')
    if (program.garage > 0 && kit.plans.frontgarage && narrowEnough(kit.plans.frontgarage) && !noEnvelope && inRange(kit.plans.frontgarage.sqft) && (!hasGarage(standard) || standard.fitScale < 0.97)) {
      const alt = fromPlan(program, kit, lot, 'frontgarage')
      if (fitsEnvelope(alt.rooms, kit, lot) && hasGarage(alt) && (!hasGarage(standard) || alt.fitScale > standard.fitScale + 0.01)) return alt
    }
    if (standardFits && inRange(kit.planSqft)) return standard
    for (const id of Object.keys(kit.plans)) {
      if (!planHolds(kit.plans[id], program) || !inRange(kit.plans[id].sqft) || !narrowEnough(kit.plans[id])) continue
      const alt = fromPlan(program, kit, lot, id)
      if (noEnvelope || fitsEnvelope(alt.rooms, kit, lot)) return alt
    }
    if (standardFits) return standard
    for (const id of Object.keys(kit.plans)) {
      if (!planHolds(kit.plans[id], program) || !narrowEnough(kit.plans[id])) continue
      const alt = fromPlan(program, kit, lot, id)
      if (fitsEnvelope(alt.rooms, kit, lot)) return alt
    }
    return standard
  }
  const ref = kit.reference?.program || {}
  const T = planId && planId !== 'standard' && kit.plans?.[planId] ? kit.plans[planId] : kit.plan
  let rooms = T.rooms.map((r) => ({ ...r, zone: kit.rooms[r.kind]?.zone || 'private', open: !!kit.rooms[r.kind]?.open, plumbing: !!kit.rooms[r.kind]?.plumbing, fill: kit.rooms[r.kind]?.open ? '#e6e1d8' : r.kind === 'garage' ? '#dcd7cf' : undefined, h: kit.rooms[r.kind]?.open ? 0.6 : undefined }))

  const dropped = []
  const drop = (kind, n = 1) => {
    for (let i = 0; i < n; i++) {
      const idx = rooms.map((r) => r.kind).lastIndexOf(kind)
      if (idx >= 0) dropped.push(...rooms.splice(idx, 1))
    }
  }
  if (!program.office) drop('office')
  if (!program.garage) drop('garage')
  // the mini primary's spot at the front of the wing: when the program has no mini primary but more
  // bedrooms than the wing draws, the first extra bedroom takes it (with its closet and Bath 1), and the
  // hall stays its drawn length; otherwise the room, its closet and its gable go
  const wantBeds = program.beds - 1
  const drawnBeds = rooms.filter((r) => r.kind === 'bed').length
  const s2 = rooms.find((r) => r.id === 'suite2')
  const frontSlot = !program.suite2 && s2 && wantBeds > drawnBeds
  if (frontSlot) {
    s2.kind = 'bed'
    s2.name = `Bedroom ${drawnBeds + 1}`
  } else if (!program.suite2) { drop('suite2'); dropped.push(...rooms.filter((r) => r.id === 'wic2')); rooms = rooms.filter((r) => r.id !== 'wic2') }
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
    if (pick) dropped.push(...rooms.splice(rooms.indexOf(pick), 1))
  }


  // rooms that go with a dropped room (a bedroom's closet), and what shortens with it (the hall)
  {
    const present = new Set(rooms.map((r) => r.id))
    Object.entries(T.companions || {}).forEach(([owner, list]) => {
      if (!present.has(owner)) rooms = rooms.filter((r) => !list.includes(r.id))
    })
    // a neighbour grows into an enclosed space a dropped room leaves (the primary closet takes the half bath's)
    Object.entries(T.companions || {}).forEach(([owner, list]) => {
      if (!present.has(owner)) dropped.push(...T.rooms.filter((r) => list.includes(r.id)))
    })
    dropped.forEach((gone) => fillVoid(rooms, gone, T.fills?.[gone.id]))
    ;(T.trims || []).forEach((t) => {
      if (present.has(t.when)) return
      const r = rooms.find((x) => x.id === t.room)
      if (r && t.y !== undefined && t.y > r.y) {
        r.d -= t.y - r.y
        r.y = t.y
      }
      if (r && t.y1 !== undefined) r.d = t.y1 - r.y
    })
  }

  // Doors, windows, fixtures ride along as elements (not rooms). Those whose
  // room was dropped are dropped too.
  const ids = new Set(rooms.map((r) => r.id))
  const keep = (e) => (!e.room || ids.has(e.room) || e.room === 'dormer') && !(e.unless && ids.has(e.unless))
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
    if (program.garage !== drawnCars) drawnGarage.w = program.garage >= 3 ? Math.max(32, g.perCar * program.garage - 1) : g.perCar * program.garage
    drawnGarage.name = `${program.garage}-Car Garage`
    const side = garageFacing(drawnGarage, rooms) || 's'
    for (let i = rooms.length - 1; i >= 0; i--) if (rooms[i].kind === 'door' && rooms[i].room === drawnGarage.id && /overhead/.test(rooms[i].size || '')) rooms.splice(i, 1)
    rooms.push(...overheadDoors(kit, drawnGarage, program.garage, side))
  }

  // the wing: extra bedrooms and baths slot in at the rear of the bedroom wing, the hall lengthens
  // with `wingSplit` the extra bedrooms stack on both sides of the hall (two rooms a band) so the hall stays short
  const wing = T.id && T.id !== 'standard' && !T.wing ? { shift: 0, east: null } : extendWing(rooms, kit, { beds: extraBeds, baths: extraBaths, prefer: program.wingSplit ? 'split' : null })
  const wingShift = wing.shift
  // Bath 1 served the mini primary; without it (and no bedroom in its spot), the bath opens from Bedroom 1 (never the outside)
  if (!program.suite2 && !frontSlot) {
    const bath1 = rooms.find((r) => r.id === 'bath1')
    const bed1 = rooms.find((r) => r.id === 'bed1')
    const door = rooms.find((e) => e.id === 'd-bath1')
    if (bath1 && bed1 && door) {
      const x0 = Math.max(bath1.x, bed1.x) + 0.5
      const x1 = Math.min(bath1.x + bath1.w, bed1.x + bed1.w) - 0.5
      // where no fixture stands against that wall
      const span = (kit.doors.bath?.w || 28) / 12
      const against = rooms.filter((f) => f.kind === 'fixture' && f.room === 'bath1' && f.y < bath1.y + 0.6)
      let at = (x0 + x1) / 2
      for (let c = x1 - span / 2; c >= x0 + span / 2; c -= 0.25) {
        if (!against.some((f) => f.x < c + span / 2 + 0.2 && f.x + f.w > c - span / 2 - 0.2)) { at = c; break }
      }
      Object.assign(door, doorEl(kit, 'd-bath1', 'bath1', 'h', at, bath1.y, 'bath', { swing: 1, hinge: 'start' }))
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
    const masses = T.roof.filter((m) => !m.id || ids2.has(m.id) || !T.rooms.some((r) => r.id === m.id)).filter((m) => !(m.id === 'leftwing' && !ids2.has('suite2'))).filter((m) => !(m.id && m.id.startsWith('awning-') && T.rooms.some((r) => r.id === m.id.slice(7)) && !ids2.has(m.id.slice(7)))).map((m) => {
      // a mass drawn for a room that is not there takes its 'absent' shape (the bed wing runs on over Bath 1 without the mini primary)
      const { absent, ...mass } = m
      Object.entries(absent || {}).forEach(([id, over]) => { if (!ids2.has(id)) Object.assign(mass, over) })
      return m.id === 'bedwing' && wingShift ? { ...mass, y0: mass.y0 - wingShift } : m.id === 'garage' && drawnGarage ? { ...mass, x1: drawnGarage.x + drawnGarage.w } : mass
    })
    // the rooms across the hall from the wing, behind the porch: a gable tied into the bed wing's
    if (wing.east) {
      masses.push({ id: 'eastwing', kind: 'gable', x0: wing.east.x0, x1: wing.east.x1, y0: wing.east.y0, y1: wing.east.y1, ridge: 'ew', plate: 9, pitch: 10, ends: ['e'] })
      // the rear porch's roof follows the porch, now shorter
      const porchRoom = rooms.find((r) => isRoom(r) && r.kind === 'rearPorch')
      const pm = masses.find((m) => m.id === 'rearPorch')
      if (porchRoom && pm) { pm.x0 = porchRoom.x; pm.x1 = porchRoom.x + porchRoom.w }
    }
    // an awning over the west window of a room the wing grew by (the drawn rooms carry their own)
    const drawnIds = new Set(T.rooms.map((r) => r.id))
    const west = Math.min(...rooms.filter((r) => isRoom(r) && !r.open).map((r) => r.x))
    rooms.filter((r) => isRoom(r) && !r.open && !drawnIds.has(r.id) && Math.abs(r.x - west) < 0.5).forEach((r) => {
      rooms.filter((e) => e.kind === 'window' && e.room === r.id && e.axis === 'v' && Math.abs(e.x + e.w / 2 - r.x) < 0.4).forEach((win) => {
        const cy = win.y + win.d / 2
        masses.push({ id: `awning-${r.id}`, kind: 'shed', x0: r.x - 2.5, x1: r.x, y0: cy - win.span / 2 - 0.5, y1: cy + win.span / 2 + 0.5, high: 'e', plate: 8.5, pitch: 4, material: 'metal awning', overhang: 0 })
      })
    })
    rooms.push({ id: 'roof', kind: 'roof', element: true, open: true, name: 'Roof', x: -100, y: -100, w: 0, d: 0, h: 0, local: [0, 0], center: [0, 0], masses, scale: 1, centre: [cx, cy], offset: [0, 0], faces: roofSurfaces(masses, 1, [cx, cy]), dormers: dormerWalls(masses, 1, [cx, cy]), plan: T.id || 'standard' })
  }
  const areaAt = (k) => {
    const copy = rooms.filter(isRoom).map((r) => ({ ...r }))
    scalePlan(copy, k, cx, cy, kit, T.id || null)
    return copy.filter(isConditioned).reduce((a, r) => a + r.w * r.d, 0) * program.stories
  }
  const base = areaAt(1)
  // a drawn garage keeps its size either way, so the house grows unevenly around it: search both ways
  const kReq = program.sqft >= base ? search((k) => areaAt(k) >= program.sqft, 1, 1.6) : search((k) => areaAt(k) >= program.sqft, 0.5, 1)
  const kRoom = roomFloor(rooms, kit, cx, cy, T.id || null)
  const kMin = Math.max(kRoom, fixtureFloor(rooms, kit, program, lot, kRoom, cx, cy, T.id || null))
  let k = Math.max(kReq, kMin)
  let capped = null // the area the lot's width caps this plan at, when it is short of the ask
  const minSqft = Math.round(areaAt(kMin) / 50) * 50
  // a house that grows past the lot's width grows deeper instead: the width scale stops where the envelope
  // does, and the depth scale makes up the area (rooms up to 40% deeper than drawn)
  if (k > 1 + 1e-9 && lotOf(lot).envelope) {
    const [envW] = envelopeSize(lotOf(lot))
    const widthAt = (kx, ky) => {
      const copy = rooms.filter(isRoom).map((r) => ({ ...r }))
      scalePlan(copy, [kx, ky], cx, cy, kit, T.id || null)
      const solid = copy.filter((r) => !r.open)
      return Math.max(...solid.map((r) => r.x + r.w)) - Math.min(...solid.map((r) => r.x))
    }
    // a foot and a half of slack: the fit shifts the house by whole feet
    const room = envW - 0.5 // half a foot of slack: the fit places the house to the quarter foot
    if (widthAt(k, k) > room && widthAt(Math.max(0.85, kMin), Math.max(0.85, kMin)) <= room) {
      // the widest the plan goes on this lot, down to the room floor when the plan is wider than the lot at scale 1
      let lo = Math.max(0.85, kMin)
      let hi = k
      while (hi - lo > 0.0025) {
        const mid = (lo + hi) / 2
        if (widthAt(mid, mid) <= room) lo = mid
        else hi = mid
      }
      const kx = Math.floor(lo * 200) / 200
      const areaXY = (ky) => {
        const copy = rooms.filter(isRoom).map((r) => ({ ...r }))
        scalePlan(copy, [kx, ky], cx, cy, kit, T.id || null)
        return copy.filter(isConditioned).reduce((a, r) => a + r.w * r.d, 0) * program.stories
      }
      const kyMax = Math.min(1.6, kx * 1.5)
      const ky = areaXY(kyMax) >= program.sqft ? search((v) => areaXY(v) >= program.sqft, kx, kyMax) : kyMax
      k = [kx, ky]
      // deeper rooms can only do so much: short of the area asked, the draft says the width capped it
      if (areaXY(ky) < program.sqft * 0.97) capped = Math.round(areaXY(ky) / 50) * 50
    }
  }
  scalePlan(rooms, k, cx, cy, kit, T.id || null)
  widenHalls(rooms, kit)
  settleIslands(rooms)
  settleKitchen(rooms)
  const roofEl = rooms.find((r) => r.kind === 'roof')
  let placed = placeLocal(rooms.filter((r) => r.kind !== 'roof'), program.stories, kit, [cx, cy], lot)
  if (roofEl) placed.push(roofEl)
  // the house sits where it fits on this lot before the garage goes on, so it is placed against the real
  // position; the fit may trim the house, but never under the kit's minimum room sizes
  const kW = Array.isArray(k) ? k[0] : k // the width scale: what a trim measures against
  const floor = { minScale: Math.max(0.85, kMin / kW) }
  const first = fitToLot(placed, kit, program.stories, lot, floor)
  placed = first.rooms
  if (program.garage > 0 && !placed.some((r) => isRoom(r) && r.kind === 'garage')) placed = attachGarage(placed, kit, program.garage, lot, program.stories, { minScale: Math.max(0.85, kMin / (kW * first.scale)) })
  const fit = fitToLot(placed, kit, program.stories, lot, { minScale: Math.max(0.85, kMin / (kW * first.scale)) })
  // the fit may have shrunk the rooms around their fixtures: aisles and the work triangle settle again
  settleIslands(fit.rooms)
  settleKitchen(fit.rooms)
  // on a lot deeper than the house (not the reference lot, where the house sits where the drafter put it) the house
  // moves up to the front setback line, a few feet behind it, so the driveway is short and the back yard deep
  const slid = slideToFront(fit.rooms, kit, program.stories, lot)
  return { rooms: slid.rooms, planScale: Array.isArray(k) ? k[0] : k, planScaleY: Array.isArray(k) ? k[1] : null, minSqft, capped, clamped: kReq < kMin - 1e-9, fitScale: first.scale * fit.scale, fitShift: [first.shift[0] + fit.shift[0], first.shift[1] + fit.shift[1] + slid.shift] }
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
function bandMap(rooms, axis, k, c, keepSize = KEEP_SIZE) {
  const size = axis === 'x' ? 'w' : 'd'
  const other = axis === 'x' ? 'd' : 'w'
  const solid = rooms.filter((r) => isRoom(r))
  // a garage is sized by its cars whatever the house does; when the house shrinks, halls keep their
  // width and the service rooms keep both sizes (a plan can name its own set: the compact plan keeps none,
  // its baths and closets are drawn with room to give and the fixture floor guards their clearances)
  const keep = k >= 1 - 1e-9 ? ['garage'] : [...keepSize, 'garage']
  if (k >= 1 - 1e-9 && !solid.some((r) => r.kind === 'garage')) return (v) => c + (v - c) * k
  // spans and edges rounded the same way, so a band that keeps its size really does (a 1/1000 ft slip let the garage shrink)
  const r3 = (v) => Math.round(v * 1000) / 1000
  const fixed = solid.filter((r) => keep.includes(r.kind) && (r.kind !== 'hall' || r[size] <= r[other])).map((r) => [r3(r[axis]), r3(r[axis] + r[size])])
  const edges = [...new Set(solid.flatMap((r) => [r[axis], r[axis] + r[size]]).concat([c]).map(r3))].sort((a, b) => a - b)
  const out = [edges[0]]
  for (let i = 1; i < edges.length; i++) {
    const a = edges[i - 1]
    const b = edges[i]
    const keep = fixed.some(([f0, f1]) => f0 <= a + 1e-4 && b <= f1 + 1e-4)
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
export function scalePlan(rooms, k, cx, cy, kit, planId = planIdOf(rooms)) {
  const keepSize = (planId && kit?.plans?.[planId]?.keepSize) || KEEP_SIZE
  // one scale, or [kx, ky] when a lot's width caps the growth and the rooms grow deeper instead
  const [kx, ky] = Array.isArray(k) ? k : [k, k]
  const fx = bandMap(rooms, 'x', kx, cx, keepSize)
  const fy = bandMap(rooms, 'y', ky, cy, keepSize)
  const anchors = rooms.filter((e) => e.element && !e.dormer && e.room).map((e) => {
    const host = rooms.find((r) => r.id === e.room)
    if (!host) return null
    const nearX = e.x + e.w / 2 < host.x + host.w / 2
    const nearY = e.y + e.d / 2 < host.y + host.d / 2
    return { e, host, w0: host.w, d0: host.d, fx: (e.x + e.w / 2 - host.x) / host.w, fy: (e.y + e.d / 2 - host.y) / host.d, nearX, nearY, ox: nearX ? e.x - host.x : host.x + host.w - (e.x + e.w), oy: nearY ? e.y - host.y : host.y + host.d - (e.y + e.d) }
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
  anchors.forEach(({ e, host, fx, fy, nearX, nearY, ox, oy, w0, d0 }) => {
    if (e.kind === 'fixture') {
      // a counter run is built to the wall: its length follows the room's (the pieces on it keep their size)
      if (e.fixture === 'counter' && w0 && d0) {
        if (e.w >= e.d) e.w = Math.max(2, e.w * (host.w / w0))
        else e.d = Math.max(2, e.d * (host.d / d0))
      }
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

/** The minimum size for a room kind: the kit's rule, or the plan's own where a plan draws smaller rooms (the compact one). */
export function minSizeOf(kit, kind, planId = null) {
  return (planId && kit.plans?.[planId]?.minSize?.[kind]) || kit.rules?.minSize?.[kind] || null
}
/** The largest a room of this kind is drawn in the kit, [w, d] in feet (the kit's maxSize, else its maxRoomFt both ways). */
export function maxSizeOf(kit, kind) {
  const m = kit.rules?.maxRoomFt || 40
  return kit.rules?.maxSize?.[kind] || [m, m]
}
/** Which of the kit's plans these rooms were drawn from (the roof element carries it). */
export const planIdOf = (rooms) => rooms.find((r) => r.kind === 'roof')?.plan || null
/** Do the rooms meet the kit's minimum sizes (the garage aside)? */
export function roomsMeetMinimums(rooms, kit, planId = planIdOf(rooms)) {
  const R = kit.rules || {}
  return rooms.filter((r) => isRoom(r) && !r.open && r.kind !== 'garage').every((r) => {
    const min = minSizeOf(kit, r.kind, planId)
    const [mw, md] = min || (R.habitable?.includes(r.kind) ? [7, 7] : [3, 3])
    return Math.min(r.w, r.d) >= Math.min(mw, md) - 0.01 && Math.max(r.w, r.d) >= Math.max(mw, md) - 0.01 && (!R.habitable?.includes(r.kind) || r.w * r.d >= 70 - 0.01)
  })
}
/** The smallest scale at which every room still meets the kit's minimum size. */
function roomFloor(rooms, kit, cx, cy, planId = planIdOf(rooms)) {
  return search((k) => {
    const copy = rooms.filter(isRoom).map((r) => ({ ...r }))
    scalePlan(copy, k, cx, cy, kit, planId)
    return roomsMeetMinimums(copy, kit, planId)
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

const FIXTURE_IDS = new Set(['toilet-front', 'toilet-side', 'shower-front', 'hall', 'door-partial', 'overlap', 'aisle', 'door-nowall', 'door-approach', 'swing-fixture', 'swing-swing'])
/** The smallest scale at which every bath keeps the clearances around its fixtures and every hall its width. */
function fixtureFloor(rooms, kit, program, lot, from, cx, cy, planId = planIdOf(rooms)) {
  const ok = (k) => {
    // the rooms and their elements alone: the audit needs no roof, and rebuilding the roof's surfaces at every
    // step of the search was most of a draft's time (round 8)
    const copy = rooms.filter((r) => r.kind !== 'roof').map((r) => ({ ...r }))
    scalePlan(copy, k, cx, cy, kit, planId)
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
  // a pair is two leaves: the catalog width is one leaf's, whether the pair is the spec's or asked for
  const span = opts.pair || spec.pair ? (spec.w * 2) / 12 : spec.w / 12
  const w = axis === 'h' ? span : 0.6
  const d = axis === 'h' ? 0.6 : span
  return { id, kind: 'door', element: true, open: true, name: opts.cased ? 'Opening' : 'Door', room, axis, x: x - w / 2, y: y - d / 2, w, d, span, size, h: spec.h ? spec.h / 12 : 6.67, swing: opts.swing ?? 1, hinge: opts.hinge || 'start', pair: !!opts.pair || !!spec.pair, cased: !!opts.cased, pocket: !!opts.pocket, barn: !!opts.barn, exterior: !!opts.exterior || !!spec.overhead, fireRated: !!spec.fireRated, selfClosing: !!spec.selfClosing }
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
 * Extra bedrooms and baths go on both sides of the bedroom hall. On the west, the rooms at the rear of
 * the wing (Bedroom 2 and its closets) move back, the hallway lengthens, and the new room slots into the
 * band Bedroom 2 left, against the hall with its own hall door, a closet (bedrooms) or fixtures (baths),
 * and an egress window on the outside wall. On the east, behind the rear porch line, a room takes the
 * band across the hall from the last west room when that costs the hall less than half a slot: the
 * hall only grows as far as that room's rear wall. Bedrooms first, then baths (a bath pairs across
 * from a bedroom). Plan feet, before scaling. Returns how far the wing grew and the east rooms' box.
 */
export function extendWing(rooms, kit, { beds = 0, baths = 0, prefer = null }) {
  if (!beds && !baths) return { shift: 0, east: null }
  const hall = rooms.find((r) => r.id === 'hall')
  const bed2 = rooms.find((r) => r.id === 'bed2')
  if (!hall || !bed2) return { shift: 0, east: null }
  // the rooms at the rear of the wing: everything in the wing's columns at or above Bedroom 2's bottom edge
  const rearBlock = (top) => rooms.filter((r) => isRoom(r) && !r.open && r !== hall && r.y + r.d <= top + 0.3 && r.x < hall.x + hall.w - 0.5 && r.x + r.w > bed2.x - 0.5)
  const elementsOf = (ids) => rooms.filter((e) => e.element && e.kind !== 'roof' && ids.has(e.room))
  const bedX = bed2.x
  const bedW = bed2.w
  const wallX = hall.x // the hall's west edge: where bedroom doors sit
  const eastX = hall.x + hall.w // the hall's east edge
  const closetD = 2.5 // 26" clear: a reach-in you can hang a coat in
  let east = null
  let total = 0
  let bedNo = rooms.filter((r) => r.kind === 'bed').length
  let bathNo = rooms.filter((r) => r.kind === 'bath').length
  const fx = (id, k, x, y, w, d, extra = {}) => rooms.push({ id: `fx-${id}-${k}`, kind: 'fixture', fixture: k, element: true, open: true, name: FIXTURE_NAME[k], room: id, x, y, w, d, h: FIXTURE_H[k], ...extra })
  // the rear of the wing moves back by `by` and the hall grows by it; with `fill` the vacated band is left
  // for a new room, else Bedroom 2 keeps its bottom wall and grows into it
  const growRear = (by, fill) => {
    const top = bed2.y + bed2.d
    const block = rearBlock(top)
    const ids = new Set(block.map((r) => r.id))
    block.forEach((r) => (r.y -= by))
    elementsOf(ids).forEach((e) => shiftEl(e, 0, -by))
    hall.y -= by
    hall.d += by
    total += by
    if (!fill) {
      // Bedroom 2 grows back to its old bottom wall; its door and bed keep their place in the room (shiftEl moved them)
      bed2.d += by
    }
    return top - by
  }
  // the east slot: across the hall, in the rear porch's footprint against the living room's back wall
  const living = rooms.find((r) => isRoom(r) && !r.open && r.kind === 'living' && Math.abs(r.x - eastX) < 0.5)
  const porch = rooms.find((r) => isRoom(r) && r.kind === 'rearPorch' && Math.abs(r.x - eastX) < 0.5 && living && r.y + r.d <= living.y + 0.3)
  const eastFree = () => !!living && !east && !rooms.some((r) => isRoom(r) && !r.open && r.x >= eastX - 0.3 && r.x < eastX + bedW && r.y + r.d > living.y - 12.75 && r.y < living.y - 0.3)
  const D = 12.75
  let eastBed = null
  let eastBath = null
  let westFree = null // a band the hall opened for an east room, left for the next west room (split wing)
  const wantBath = baths > 0
  // a split wing pays off only when a second bedroom can stack behind the first across the hall and the rest fills the band it opens
  const splitWorks = prefer === 'split' && beds >= 2 && (beds >= 3 || baths >= 2)
  const slots = [...Array(beds).fill('bed'), ...Array(baths).fill('bath')]
  slots.forEach((kind, i) => {
    const SD = kind === 'bed' ? D : 6.0
    if (kind === 'bath' && eastBath && !eastBath.counted) {
      eastBath.counted = true
      return
    }
    // a split wing: the next bedroom stacks behind the one across the hall, and the band the hall opens for
    // its door is left for the rooms after it on the west side (two rooms a band). Only when what is left to
    // place fills that band: two baths, or a bedroom
    const left = slots.slice(i + 1)
    const fills = left.filter((k) => k === 'bed').length > 0 || left.filter((k) => k === 'bath').length * 6 >= D - 1
    const behindFree = () => splitWorks && fills && east && eastBed && !eastBath && !rooms.some((r) => isRoom(r) && !r.open && r.x + r.w > eastX - 0.3 && r.x < eastX + bedW && r.y + r.d > east.y0 - D - 0.3 && r.y < east.y0 - 0.3)
    if (kind === 'bed' && behindFree()) {
      const x0 = eastX
      const bandY = east.y0 - D
      const doorY = east.y0 - 0.5 - 1.335
      const need = Math.max(0, hall.y - (doorY - 1.335 - 0.3))
      if (need > 0) {
        const vacated = growRear(need, true)
        westFree = { y: vacated, d: need }
      }
      bedNo += 1
      const id = `bed-${bedNo}`
      const closet = { id: `closet-${bedNo}`, kind: 'wic', name: 'Closet', x: x0, y: bandY, w: bedW, d: closetD, zone: 'private', open: false, plumbing: false }
      const room = { id, kind: 'bed', name: `Bedroom ${bedNo}`, x: x0, y: bandY + closetD, w: bedW, d: D - closetD, zone: 'private', open: false, plumbing: false }
      rooms.push(room, closet)
      rooms.push(doorEl(kit, `d-closet-${bedNo}`, closet.id, 'h', x0 + bedW / 2, closet.y + closet.d, 'closet', { swing: 1, hinge: 'start', pair: true }))
      rooms.push(windowEl(kit, `win-${id}`, id, 'v', x0 + bedW, room.y + room.d / 2, 'A'))
      rooms.push({ id: `fx-${id}`, kind: 'fixture', fixture: 'bed', element: true, open: true, name: FIXTURE_NAME.bed, room: id, x: x0 + 3.25, y: room.y + room.d - 6.7, w: 7, d: 6.5, h: FIXTURE_H.bed, head: 's' })
      rooms.push(doorEl(kit, `d-${id}`, id, 'v', x0, doorY, 'interiorWide', { swing: 1, hinge: 'end' }))
      east = { ...east, y0: bandY }
      eastBed = room
      return
    }
    // a bedroom across the hall, when the corner is free: the room runs the band's full depth with its window
    // on the rear wall; its door sits at the front end of the hall wall, so the hall grows only the foot or two
    // that door needs. With a bath to place as well, the bath and the closet stand in a column east of the room
    // (the closet at the rear, the bath entered from the bedroom); else the closet lies along the rear wall and
    // the window looks east onto the porch
    if (kind === 'bed' && prefer !== 'west' && eastFree()) {
      const x0 = eastX
      const bandY = living.y - D // the band: bandY .. living.y
      const doorY = living.y - 0.5 - 1.335
      const need = Math.max(0, hall.y - (doorY - 1.335 - 0.3))
      if (need > 0) growRear(need, false)
      bedNo += 1
      const id = `bed-${bedNo}`
      const withBath = wantBath && !eastBath && !splitWorks // a split wing stacks a bedroom behind this one, so it keeps its east wall for the window
      let room
      let right = x0 + bedW
      if (withBath) {
        const BW = 5.5
        room = { id, kind: 'bed', name: `Bedroom ${bedNo}`, x: x0, y: bandY, w: bedW, d: D, zone: 'private', open: false, plumbing: false }
        const closet = { id: `closet-${bedNo}`, kind: 'wic', name: 'Closet', x: x0 + bedW, y: bandY, w: BW, d: closetD, zone: 'private', open: false, plumbing: false }
        bathNo += 1
        const bid = `bath-${bathNo}`
        const bath = { id: bid, kind: 'bath', name: `Bath ${bathNo}`, x: x0 + bedW, y: bandY + closetD, w: BW, d: D - closetD, zone: 'private', open: false, plumbing: true }
        rooms.push(room, closet, bath)
        rooms.push(doorEl(kit, `d-closet-${bedNo}`, closet.id, 'v', closet.x, closet.y + closet.d / 2, 'closet', { swing: -1, hinge: 'start' }))
        // the bath's door from the bedroom, hinged on the rear jamb so the leaf clears the shower across the room
        rooms.push(doorEl(kit, `d-${bid}`, bid, 'v', bath.x, bath.y + 2.4 + 1.165, 'bath', { swing: 1, hinge: 'end' }))
        rooms.push(windowEl(kit, `win-${bid}`, bid, 'v', bath.x + BW, bath.y + 4.2, 'C'))
        // the toilet at the rear end, the vanity on the far wall, the shower along the front wall, each with its clear front
        fx(bid, 'toilet', bath.x + 0.5, bath.y + 0.3, 2.3, 1.5, { face: 's' })
        fx(bid, 'vanity', bath.x + BW - 2, bath.y + 2.6, 2, 2.5, { face: 'w' })
        fx(bid, 'shower', bath.x + 0.05, bath.y + bath.d - 3, BW - 0.1, 3)
        right = x0 + bedW + BW
        eastBath = bath
        // the window on the rear wall beside the bed, which stands with its head to the rear
        rooms.push(windowEl(kit, `win-${id}`, id, 'h', x0 + bedW - 2.25, bandY, 'A'))
        rooms.push({ id: `fx-${id}`, kind: 'fixture', fixture: 'bed', element: true, open: true, name: FIXTURE_NAME.bed, room: id, x: x0 + 0.75, y: bandY + 0.2, w: 7, d: 6.5, h: FIXTURE_H.bed, head: 'n' })
      } else {
        const closet = { id: `closet-${bedNo}`, kind: 'wic', name: 'Closet', x: x0, y: bandY, w: bedW, d: closetD, zone: 'private', open: false, plumbing: false }
        room = { id, kind: 'bed', name: `Bedroom ${bedNo}`, x: x0, y: bandY + closetD, w: bedW, d: D - closetD, zone: 'private', open: false, plumbing: false }
        rooms.push(room, closet)
        rooms.push(doorEl(kit, `d-closet-${bedNo}`, closet.id, 'h', x0 + bedW / 2, closet.y + closet.d, 'closet', { swing: 1, hinge: 'start', pair: true }))
        // the window east onto the porch; the bed against the living room's wall, clear of both doors' approaches
        rooms.push(windowEl(kit, `win-${id}`, id, 'v', x0 + bedW, room.y + 2, 'A'))
        rooms.push({ id: `fx-${id}`, kind: 'fixture', fixture: 'bed', element: true, open: true, name: FIXTURE_NAME.bed, room: id, x: x0 + 3.25, y: living.y - 6.7, w: 7, d: 6.5, h: FIXTURE_H.bed, head: 's' })
      }
      rooms.push(doorEl(kit, `d-${id}`, id, 'v', x0, doorY, 'interiorWide', { swing: 1, hinge: 'end' }))
      // the porch gives the rooms their corner
      if (porch) {
        porch.w = porch.x + porch.w - right
        porch.x = right
      }
      east = { x0, x1: right, y0: bandY, y1: living.y }
      eastBed = room
      // the living room's back door moves clear of the new rooms: a pair when the wall left takes one, else a single
      const back = rooms.find((e) => e.kind === 'door' && e.room === 'living' && e.exterior && e.axis === 'h' && Math.abs(e.y + e.d / 2 - living.y) < 0.4)
      if (back && back.x < right + 0.5) {
        const free = living.x + living.w - right
        const pair = free >= 6 + 1
        Object.assign(back, doorEl(kit, back.id, 'living', 'h', right + free / 2, living.y, pair ? 'exteriorPair' : 'exteriorSingle', { swing: 1, hinge: 'start', pair, exterior: true }))
      }
      return
    }
    if (kind === 'bath' && eastBath && !eastBath.counted) {
      // the bath beside the bedroom across the hall was placed with it
      eastBath.counted = true
      return
    }
    // west: everything at the rear of the wing moves back by a room, the hall grows by it; the band Bedroom 2 vacates takes
    // the new room (in a split wing, the band the hall already opened for the room across from it)
    let bandY
    let depth = SD
    if (westFree && westFree.d >= SD - 0.01) {
      // a bath takes the front of the free band; the last one that fits takes what is left, so no sliver is walled off
      if (kind === 'bath' && westFree.d - SD < 6) depth = westFree.d
      bandY = westFree.y + westFree.d - depth
      westFree = { y: westFree.y, d: westFree.d - depth }
      if (westFree.d < 0.01) westFree = null
    } else bandY = growRear(SD, true) // the vacated band: y from bandY to bandY + SD
    if (kind === 'bed') {
      bedNo += 1
      const id = `bed-${bedNo}`
      const room = { id, kind: 'bed', name: `Bedroom ${bedNo}`, x: bedX, y: bandY + closetD, w: bedW, d: SD - closetD, zone: 'private', open: false, plumbing: false }
      const closet = { id: `closet-${bedNo}`, kind: 'wic', name: 'Closet', x: bedX, y: bandY, w: bedW, d: closetD, zone: 'private', open: false, plumbing: false }
      rooms.push(room, closet)
      rooms.push(doorEl(kit, `d-${id}`, id, 'v', wallX, room.y + room.d / 2, 'interiorWide', { swing: -1, hinge: 'start' }))
      rooms.push(doorEl(kit, `d-closet-${bedNo}`, closet.id, 'h', bedX + 3.5, room.y, 'closet', { swing: 1, hinge: 'start', pair: true }))
      rooms.push(windowEl(kit, `win-${id}`, id, 'v', bedX, room.y + room.d / 2, 'A', true))
      // the bed by the outside wall, clear of the closet doors and of a Jack & Jill door on the wall below
      rooms.push({ id: `fx-${id}`, kind: 'fixture', fixture: 'bed', element: true, open: true, name: FIXTURE_NAME.bed, room: id, x: bedX + 0.2, y: room.y + 3, w: 7, d: 6.5, h: FIXTURE_H.bed })
    } else {
      bathNo += 1
      const id = `bath-${bathNo}`
      const room = { id, kind: 'bath', name: `Bath ${bathNo}`, x: bedX, y: bandY, w: bedW, d: depth, zone: 'private', open: false, plumbing: true }
      rooms.push(room)
      // the door at the front end of the hall wall, hinged on the front jamb: its swing clears the vanity on the rear wall
      rooms.push(doorEl(kit, `d-${id}`, id, 'v', wallX, room.y + room.d - 1.5, 'bath', { swing: -1, hinge: 'end' }))
      rooms.push(windowEl(kit, `win-${id}`, id, 'v', bedX, room.y + room.d / 2, 'C'))
      fx(id, 'shower', bedX + 0.3, bandY + 0.3, 3, 5.4)
      fx(id, 'toilet', bedX + 4.5, bandY + 0.3, 2.3, 1.5, { face: 's' })
      fx(id, 'vanity', bedX + 8, bandY + 0.3, 3.5, 2, { face: 's' })
    }
  })
  // a window on the wall the east rooms stand against would face into them: it goes (the room keeps its other glazing)
  if (east) {
    for (let i = rooms.length - 1; i >= 0; i--) {
      const e = rooms[i]
      if (e.kind !== 'window' || e.axis !== 'h') continue
      const cx = e.x + e.w / 2
      const cy = e.y + e.d / 2
      if (Math.abs(cy - east.y1) < 0.4 && cx > east.x0 - 0.3 && cx < east.x1 + 0.3) rooms.splice(i, 1)
    }
  }
  // the Jack & Jill's rear door served Bedroom 2; when a bath took that band, the door goes (the bath is reached from the hall)
  const jj = rooms.find((r) => r.id === 'jackjill')
  if (jj) {
    const north = rooms.find((r) => isRoom(r) && !r.open && r !== jj && Math.abs(r.y + r.d - jj.y) < 0.3 && r.x < jj.x + jj.w - 0.5 && r.x + r.w > jj.x + 0.5)
    if (north && !['bed', 'master', 'suite2'].includes(north.kind)) {
      const i = rooms.findIndex((e) => e.id === 'd-jj-n')
      if (i >= 0) rooms.splice(i, 1)
    }
  }
  return { shift: total, east }
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
  // wall between and beside the doors: 2 ft, or 1 ft either side of a single car's door
  const jamb = n === 1 ? 1 : 2
  // the widths, in bay order, and how many bays each covers
  const plans = n === 1 ? [[single, 1]] : n === 2 ? [[wide, 2]] : n === 3 ? [[wide, 2], [single, 1]] : n === 4 ? [[wide, 2], [wide, 2]] : [[wide, 2], [wide, 2], [single, 1]]
  let doors = plans
  const sum = (list) => list.reduce((a, [w]) => a + w, 0)
  if (sum(doors) + jamb * (doors.length + 1) > wallLen + 0.01) {
    // too tight for the wide doors: singles, one per bay, as many as fit with 2 ft walls
    const singles = []
    for (let i = 0; i < n && (i + 1) * single + jamb * (i + 2) <= wallLen + 0.01; i++) singles.push([single, 1])
    if (singles.length) doors = singles
    else doors = [[Math.min(single, wallLen - 2 * jamb), 1]]
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
  const gapsOk = (st) => st.every((x, i) => x >= jamb - 0.01 && x + doors[i][0] <= wallLen - jamb + 0.01 && (i === 0 || x - (st[i - 1] + doors[i - 1][0]) >= jamb - 0.01))
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

/**
 * The garage attaches at the service end, with its house door into the laundry (rated and self
 * closing), overhead doors toward the street, nothing covering a window, and a driveway a car can
 * use. In order: front-load beside the laundry at the plan's size; front-load with the house narrowed
 * (down to `minScale`, the fit after this does the narrowing); a 3-car as a tandem (two bays wide,
 * two deep) front-load; side-load with a 25 ft apron and a lane down that side; the courtyard way
 * (doors toward the rear court, a leg behind the house, a lane down the far side yard). Each
 * candidate's driveway is checked with drivewayProblem(); the first drivable one is taken. When none
 * is, the house comes back without a garage and the rooms step says so.
 * Placed rooms in; placed rooms out.
 */
export function attachGarage(placed, kit, cars, lot, stories = 1, { minScale = 0.85, prefer = null, tandem = false } = {}) {
  const L = lotOf(lot)
  const centre = kit.plan ? [kit.plan.footprint.w / 2, kit.plan.footprint.d / 2] : [0, 0]
  const flat = placed.map((r) => (r.x !== undefined || !r.local ? { ...r } : { ...r, x: r.local[0] + centre[0] - r.w / 2, y: r.local[1] + centre[1] - r.d / 2 }))
  const laundry = flat.find((r) => r.id === 'laundry') || flat.find((r) => r.kind === 'laundry') || flat.find((r) => r.kind === 'mud')
  if (!laundry) return placed
  const g = kit.rooms.garage
  const solid = flat.filter((r) => isRoom(r) && !r.open)
  const xs = solid.flatMap((r) => [r.x, r.x + r.w])
  const houseW = Math.max(...xs) - Math.min(...xs)
  const [envW] = envelopeSize(L)
  const envL = L.envelope && L.envelope.length >= 3 ? L.envelope.map((pt) => localOf(L, pt)) : null
  const envRear = envL ? Math.min(...envL.map((pt) => pt[1])) + centre[1] : -Infinity
  const envFront = envL ? Math.max(...envL.map((pt) => pt[1])) + centre[1] : Infinity
  const houseFront = Math.max(...solid.map((r) => r.y + r.d))
  const slackFront = Math.max(0, envFront - houseFront)
  const house = (x, y, name, gw, gd, extra = {}) => ({ id: 'garage', kind: 'garage', name, x, y, w: gw, d: gd, zone: 'service', open: false, plumbing: false, fill: '#dcd7cf', ...extra })
  const garageDoor = (room, host, side) => {
    if (side === 'v') {
      const occupied = flat.filter((e) => e.element && e.kind === 'fixture' && e.room === host.id && e.x + e.w > host.x + host.w - 1)
      let dy = host.y + 2.5
      if (occupied.some((f) => dy > f.y - 1.5 && dy < f.y + f.d + 1.5)) dy = host.y + host.d - 2.5
      return doorEl(kit, 'd-garage', 'garage', 'v', room.x, dy, 'garage', { swing: 1, hinge: 'start' })
    }
    const x0 = Math.max(host.x, room.x) + 0.5
    const x1 = Math.min(host.x + host.w, room.x + room.w) - 0.5
    return doorEl(kit, 'd-garage', 'garage', 'h', (x0 + x1) / 2, host.y, 'garage', { swing: -1, hinge: 'start' })
  }
  const hostsFor = (room) => solid.filter((r) => ['laundry', 'mud', 'hall', 'foyer'].includes(r.kind) && Math.abs(r.y - (room.y + room.d)) < 0.75 && Math.min(r.x + r.w, room.x + room.w) - Math.max(r.x, room.x) >= 3.5)
  // the candidates, in the order an STB designer would take them
  const candidates = []
  // a tandem garage parks the third car behind one of two bays: two bays wide, two cars deep
  // a 3-car is 32 ft wide (10'-8" a bay, the mark is 31–32), a 4-car 43: a foot a bay less than the 2-car's 11
  const wideW = Math.max(32, g.perCar * cars - 1)
  const widths = tandem && cars >= 3 ? [[g.perCar * 2, 2, true]] : cars >= 3 ? [[wideW, cars, false], [g.perCar * 2, 2, true]] : [[g.perCar * cars, cars, false]]
  for (const [w, bays, tandem] of widths) {
    const d = tandem ? g.d * 2 : g.d
    const name = `${cars}-Car Garage${tandem ? ' (tandem)' : ''}`
    // front-load beside the laundry: at the plan's size, or with the house narrowed to fit
    const scale = Math.min(1, (envW - w) / houseW)
    if (scale >= minScale - 1e-9) {
      const room = house(laundry.x + laundry.w, laundry.y, name, w, d, tandem ? { tandem: true, bays } : {})
      candidates.push({ room, host: laundry, side: 'v', doors: overheadDoors(kit, room, bays, 's'), kind: 'front' })
    }
    if (tandem) continue
    // side-load behind the laundry, doors on the outer face, 25 ft of apron to the lot line
    const sw = d
    const sd = w
    for (let shift = -10; shift <= 30; shift += 1) {
      const room = house(laundry.x + laundry.w - sw - shift, laundry.y - sd, name, sw, sd)
      const slide = Math.max(0, Math.min(slackFront, envRear - room.y))
      if (room.y + slide < envRear - 0.01) continue
      const hosts = hostsFor(room)
      if (!hosts.length) continue
      candidates.push({ room, host: hosts.find((r) => r.id === laundry.id) || hosts[0], side: 'h', doors: overheadDoors(kit, room, bays, 'e'), kind: 'side', slide })
      break
    }
    // the courtyard way: doors on the west face toward the rear court, the lane down the far side yard
    {
      const room = house(laundry.x + laundry.w - sw, laundry.y - sd, name, sw, sd, { driveway: 'courtyard' })
      const slide = Math.max(0, Math.min(slackFront, envRear - room.y))
      const hosts = hostsFor(room)
      if (room.y + slide >= envRear - 0.01 && hosts.length) candidates.push({ room, host: hosts.find((r) => r.id === laundry.id) || hosts[0], side: 'h', doors: overheadDoors(kit, room, bays, 'w'), kind: 'courtyard', slide })
    }
  }
  const habitable = kit.rules?.habitable || ['bed', 'master', 'suite2', 'kitchen', 'living', 'dining', 'office']
  const covered = (room) => flat.filter((e) => e.element && (e.kind === 'window' || e.kind === 'door') && e.room !== laundry.id && e.x + e.w / 2 > room.x - 0.3 && e.x + e.w / 2 < room.x + room.w + 0.3 && e.y + e.d / 2 > room.y - 0.3 && e.y + e.d / 2 < room.y + room.d + 0.3)
  // a door, or a window of a room that needs its daylight, blocks the spot; a bath's or closet's window goes with the pick
  const blockedBy = (room) => covered(room).some((e) => e.kind === 'door' || habitable.includes(solid.find((r) => r.id === e.room)?.kind))
  let pick = null
  // the way asked for: front-load, or side-load (the courtyard way counts as side-load)
  const wanted = prefer === 'front' ? candidates.filter((c) => c.kind === 'front') : prefer === 'side' ? candidates.filter((c) => c.kind !== 'front') : candidates
  const runsInto = (room) => solid.some((r) => r.id !== room.id && Math.min(Math.min(r.x + r.w, room.x + room.w) - Math.max(r.x, room.x), Math.min(r.y + r.d, room.y + room.d) - Math.max(r.y, room.y)) > 0.6)
  for (const c of wanted) {
    if (blockedBy(c.room) || runsInto(c.room)) continue
    // the driveway from this garage, on the house as it will sit: slid toward the street when the garage
    // needs it, and centred in the envelope with the garage on (the fit after this narrows and shifts it)
    const boxX0 = Math.min(Math.min(...xs), c.room.x)
    const boxX1 = Math.max(Math.max(...xs), c.room.x + c.room.w)
    const envX = envL ? [Math.min(...envL.map((pt) => pt[0])) + centre[0], Math.max(...envL.map((pt) => pt[0])) + centre[0]] : [boxX0, boxX1]
    const dx = c.kind === 'front' ? (envX[0] + envX[1]) / 2 - (boxX0 + boxX1) / 2 : 0
    const trial = [...flat.filter((r) => isRoom(r)).map((r) => ({ ...r, x: r.x + dx, y: r.y + (c.slide || 0) })), { ...c.room, x: c.room.x + dx, y: c.room.y + (c.slide || 0) }]
    const trialDoors = c.doors.map((d) => ({ ...d, x: d.x + dx, y: d.y + (c.slide || 0) }))
    const frame = frameOf([...trial, ...trialDoors], centre)
    const problem = drivewayProblem(drivewaySlabs(frame.rooms, frame.doors, L), frame.rooms, frame.doors, L)
    if (!problem) {
      pick = c
      break
    }
  }
  if (!pick) return placed
  const room = pick.room
  covered(room).filter((e) => e.kind === 'window').forEach((e) => {
    const i = flat.indexOf(e)
    if (i >= 0) flat.splice(i, 1)
  })
  const elements = [garageDoor(room, pick.host, pick.side), ...pick.doors]
  if (pick.kind !== 'front') {
    // a rear window of a room the garage covers moves to that room's outside side wall when it has one
    flat.filter((e) => e.kind === 'window' && e.room !== 'garage').forEach((win) => {
      const home = solid.find((r) => r.id === win.room)
      if (!home) return
      const c = [win.x + win.w / 2, win.y + win.d / 2]
      const covered = c[0] > room.x - 0.3 && c[0] < room.x + room.w + 0.3 && c[1] > room.y - 0.3 && c[1] < room.y + room.d + 0.3
      if (!covered) return
      // a side wall is free when no room stands against it and the garage does not run along it
      const alongWall = (x) => room.x - 0.3 <= x && x <= room.x + room.w + 0.3 && Math.min(room.y + room.d, home.y + home.d) - Math.max(room.y, home.y) > 1
      const eastFree = !solid.some((r) => r !== home && Math.abs(r.x - (home.x + home.w)) < 0.75 && Math.min(r.y + r.d, home.y + home.d) - Math.max(r.y, home.y) > 1) && !alongWall(home.x + home.w)
      const westFree = !solid.some((r) => r !== home && Math.abs(r.x + r.w - home.x) < 0.75 && Math.min(r.y + r.d, home.y + home.d) - Math.max(r.y, home.y) > 1) && !alongWall(home.x)
      if (eastFree) Object.assign(win, windowEl(kit, win.id, home.id, 'v', home.x + home.w, home.y + home.d - 3, win.mark || 'A'))
      else if (westFree) Object.assign(win, windowEl(kit, win.id, home.id, 'v', home.x, home.y + home.d - 3, win.mark || 'A'))
    })
  }
  flat.push(room, ...elements)
  // a gable over the garage, ridge along its long side, tied into the house roof
  const roof = flat.find((r) => r.kind === 'roof')
  if (roof && roof.masses) {
    const k = roof.scale || 1
    const off = roof.offset || [0, 0]
    const c = roof.centre || centre
    const base = (v, i) => c[i] + (v - off[i] - c[i]) / k
    const ridgeEW = room.w >= room.d
    roof.masses = [...roof.masses, { id: 'garage', kind: 'gable', x0: base(room.x, 0), x1: base(room.x + room.w, 0), y0: base(room.y, 1), y1: base(room.y + room.d, 1), ridge: ridgeEW ? 'ew' : 'ns', plate: 11, pitch: +String(kit.roof?.pitch || '10').split(':')[0] || 10, ends: pick.kind === 'front' ? (ridgeEW ? ['e'] : ['s']) : (ridgeEW ? ['w'] : ['n']) }]
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
      if (s !== 1) scalePlan(copy, s, centre[0], centre[1], kit, planIdOf(flat))
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
    // the driveway is checked as a real path by attachGarage and the audit (site.js); nothing to add here
    return rs.filter(() => false)
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
  // a rectangular envelope (every typed lot, most plats): the shift that puts the house inside is read off the
  // boxes directly, the smallest one that does, to the inch. An irregular envelope falls back to rings of
  // whole-foot shifts, nearest first (quarter-foot within 20 ft on a lot with under 2 ft to spare); the ring
  // search cost 400–700 ms a draft on the 50 ft lot, which froze the rooms step (round 8)
  const rect = env.length === 4 && new Set(ex.map((v) => v.toFixed(3))).size === 2 && new Set(ez.map((v) => v.toFixed(3))).size === 2
  const nearestZeroIn = (lo, hi) => (lo > 0 ? lo : hi < 0 ? hi : 0)
  let found = null
  if (rect) {
    const envX0 = Math.min(...ex)
    const envX1 = Math.max(...ex)
    const envZ0 = Math.min(...ez)
    const envZ1 = Math.max(...ez)
    for (let s = 1; s >= minScale - 1e-9 && !found; s = Math.round((s - 0.03) * 100) / 100) {
      const rs = roomsAt(s)
      if (!roomsMeetMinimums(rs, kit, planIdOf(flat))) continue
      const hx0 = Math.min(...rs.map((r) => r.x)) - centre[0]
      const hx1 = Math.max(...rs.map((r) => r.x + r.w)) - centre[0]
      const hz0 = Math.min(...rs.map((r) => r.y)) - centre[1]
      const hz1 = Math.max(...rs.map((r) => r.y + r.d)) - centre[1]
      const dxLo = envX0 - hx0
      const dxHi = envX1 - hx1
      const dyLo = envZ0 - hz0
      const dyHi = envZ1 - hz1
      if (dxLo > dxHi + 1e-6 || dyLo > dyHi + 1e-6) continue
      // the smallest shift, in quarter feet, still inside the range (whole feet when there is room for it)
      const pick = (lo, hi) => {
        const raw = nearestZeroIn(lo, hi)
        const whole = raw > 0 ? Math.ceil(raw) : Math.floor(raw)
        if (whole >= lo - 1e-6 && whole <= hi + 1e-6) return whole
        const q = raw > 0 ? Math.ceil(raw * 4) / 4 : Math.floor(raw * 4) / 4
        return q >= lo - 1e-6 && q <= hi + 1e-6 ? q : raw
      }
      const dx = pick(dxLo, dxHi)
      const dy = pick(dyLo, dyHi)
      if (Math.abs(dx) > maxShift + 1e-6 || Math.abs(dy) > maxShift + 1e-6) continue
      if (fits(s, dx, dy)) found = { s, dx, dy }
    }
  } else {
    const step = envW - boxAt(1)[0] < 2 ? 0.25 : 1
    const reach = step < 1 ? Math.min(maxShift, 20) : maxShift
    const rings = []
    for (let ring = 0; ring <= reach / step; ring++) for (let dx = -ring; dx <= ring; dx++) for (let dy = -ring; dy <= ring; dy++) if (Math.max(Math.abs(dx), Math.abs(dy)) === ring) rings.push([dx * step, dy * step])
    for (let s = 1; s >= minScale - 1e-9 && !found; s = Math.round((s - 0.03) * 100) / 100) {
      const [houseW, houseD] = boxAt(s)
      if (houseW > envW + 0.01 || houseD > envD + 0.01 || !roomsMeetMinimums(roomsAt(s), kit, planIdOf(flat))) continue
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
  }

  if (!found || (found.s === 1 && found.dx === 0 && found.dy === 0)) return { rooms, shift: [0, 0], scale: 1 }
  const { s, dx, dy } = found
  // doors, windows and fixtures keep their size through a trim and their place in their rooms; the roof follows
  if (s !== 1) scalePlan(flat, s, centre[0], centre[1], kit, planIdOf(flat))
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

/** How far behind the front setback line the house sits on a lot with room to spare, feet. */
export const FRONT_YARD_FT = 6

/**
 * On a lot deeper than the house, the placed house slides toward the street until its front (porch and
 * garage included) is FRONT_YARD_FT behind the front setback line, as long as every room stays inside the
 * envelope. The reference lot is left alone: the Garza house sits where the drafter put it.
 * @returns {{ rooms, shift }} shift in feet toward the street
 */
export function slideToFront(rooms, kit, stories = 1, lot = DEFAULT_LOT) {
  const L = lotOf(lot)
  if (!L.envelope || L.envelope.length < 3 || L.spec?.kind === 'reference' || L === DEFAULT_LOT) return { rooms, shift: 0 }
  const env = L.envelope.map((p) => localOf(L, p))
  const envFront = Math.max(...env.map((p) => p[1]))
  const placed = rooms.filter((r) => isRoom(r) && r.local)
  if (!placed.length) return { rooms, shift: 0 }
  const houseFront = Math.max(...placed.map((r) => r.local[1] + r.d / 2))
  const dz = Math.floor(envFront - houseFront - FRONT_YARD_FT)
  if (dz < 1) return { rooms, shift: 0 }
  const solid = placed.filter((r) => !r.open)
  const inside = solid.every((r) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].every(([sx, sy]) => insidePoly(env, [r.local[0] + sx * (r.w / 2 - 0.05), r.local[1] + dz + sy * (r.d / 2 - 0.05)])))
  if (!inside) return { rooms, shift: 0 }
  const centre = kit.plan ? [kit.plan.footprint.w / 2, kit.plan.footprint.d / 2] : [0, 0]
  const flat = rooms.map((r) => (r.x !== undefined || !r.local ? { ...r } : { ...r, x: r.local[0] + centre[0] - r.w / 2, y: r.local[1] + centre[1] - r.d / 2 }))
  const roof = flat.find((r) => r.kind === 'roof')
  if (roof) {
    roof.offset = [roof.offset?.[0] || 0, (roof.offset?.[1] || 0) + dz]
    roof.faces = roofSurfaces(roof.masses, roof.scale || 1, roof.centre || centre, roof.offset)
    roof.dormers = dormerWalls(roof.masses, roof.scale || 1, roof.centre || centre, roof.offset)
  }
  flat.forEach((r) => {
    if (r.dormer || r.kind === 'roof') return
    r.y += dz
  })
  const out = placeLocal(flat.filter((r) => r.kind !== 'roof'), stories, kit, centre, L)
  if (roof) out.push(roof)
  return { rooms: out, shift: dz }
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

/**
 * The program as the plan actually has it: bedrooms, full and half baths, the garage's cars, the
 * office, the porches and the living area, counted from the rooms. Every screen, design.json, the
 * summary and the title block read this, so "add a bedroom" shows up everywhere at once.
 */
export function programOf(rooms, program = {}) {
  const list = rooms.filter(isRoom)
  const count = (...kinds) => list.filter((r) => kinds.includes(r.kind)).length
  const garage = list.find((r) => r.kind === 'garage')
  const cars = garage ? +(garage.name.match(/^(\d+)-Car/) || [])[1] || Math.max(1, Math.round(Math.max(garage.w, garage.d) / 11)) : 0
  const tandem = !!garage && (!!garage.tandem || /tandem/i.test(garage.name || ''))
  return {
    ...program,
    tandem,
    beds: count('bed', 'master', 'suite2'),
    baths: count('bath', 'mbath', 'jackjill'),
    halfBath: count('halfbath') > 0,
    halfBaths: count('halfbath'),
    office: count('office') > 0,
    garage: cars,
    suite2: count('suite2') > 0,
    frontPorch: count('frontPorch') > 0,
    rearPorch: count('rearPorch') > 0,
    stories: program.stories || 1,
    livingSf: Math.round(floorArea(rooms, program.stories || 1)),
    asked: program.asked || null, // the program as first asked for, when a fit offer replaced it (round 6)
  }
}
/** "4 bed · 3.5 bath · 2-car · 1 story" */
export function programLine(p, sep = ' · ') {
  const baths = `${p.baths}${p.halfBaths > 1 ? `.${p.halfBaths}` : p.halfBath ? '.5' : ''}`
  // a tandem third bay is said so the client knows the third car parks behind another
  return [`${p.beds} bed`, `${baths} bath`, p.garage ? `${p.garage}-car${p.tandem ? ' (tandem: one bay two cars deep)' : ''}` : null, `${p.stories === 2 ? 'two story' : p.stories ? `${p.stories} story` : ''}`].filter(Boolean).join(sep)
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
