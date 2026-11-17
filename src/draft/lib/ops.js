// Change ops: validate, apply, and the regex fallback that produces them.
// Schema in docs/change-diff.md. Plan feet throughout.
import { makeRoom, placeLocal, kitFor, isRoom, lotOf } from './layout.js'
import { DEFAULT_LOT, worldOf } from './lot.js'
import { roofSurfaces, dormerWalls } from './roof.js'
import { FIXTURE_H, FIXTURE_NAME, WINDOW_SILL, WINDOW_HEAD } from '../../kits/modern-farmhouse.js'

export const OPS = ['resize', 'add', 'remove', 'move']
const q = (v) => Math.round(v * 4) / 4

/** Shape check only. Rules come later. */
export function validateOps(ops, rooms, kit) {
  const errors = []
  if (!Array.isArray(ops)) return { ok: false, errors: ['ops must be a list'] }
  const ids = new Set(rooms.filter(isRoom).map((r) => r.id))
  ops.forEach((o, i) => {
    const at = `op ${i + 1}`
    if (!o || !OPS.includes(o.op)) return errors.push(`${at}: unknown op "${o?.op}"`)
    if (o.op !== 'add' && !ids.has(o.room)) errors.push(`${at}: no room "${o.room}"`)
    if (o.op === 'resize' && !(o.w > 0 && o.d > 0)) errors.push(`${at}: resize needs w and d`)
    if (o.op === 'add' && !kit.rooms[o.kind]) errors.push(`${at}: kind "${o.kind}" is not in the ${kit.name} kit`)
    if (o.op === 'move' && !(Number.isFinite(o.dx) && Number.isFinite(o.dy))) errors.push(`${at}: move needs dx and dy`)
  })
  return { ok: errors.length === 0, errors }
}

/** Plan coordinates for every room, even packer-made ones that only have `local`. */
function withPlanCoords(rooms, kit) {
  const centre = kit.plan ? [kit.plan.footprint.w / 2, kit.plan.footprint.d / 2] : [0, 0]
  const out = rooms.map((r) => {
    if (r.x !== undefined || !r.local) return { ...r }
    return { ...r, x: r.local[0] + centre[0] - r.w / 2, y: r.local[1] + centre[1] - r.d / 2 }
  })
  return { rooms: out, centre }
}

const overlaps = (a, b, pad = 0.1) => a.x < b.x + b.w - pad && a.x + a.w > b.x + pad && a.y < b.y + b.d - pad && a.y + a.d > b.y + pad
// overlap rectangle's smaller side; traced plans have wall slivers, so under 1 ft is not a collision
const intrusion = (a, b) => Math.min(Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)), Math.max(0, Math.min(a.y + a.d, b.y + b.d) - Math.max(a.y, b.y)))

function insidePoly(poly, [x, z]) {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]
    const [xj, zj] = poly[j]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c
  }
  return c
}
/** Is a plan rectangle inside the lot's setback envelope once placed on the lot? */
function insideSetbacks(rect, centre, lot = DEFAULT_LOT) {
  return [
    [rect.x, rect.y],
    [rect.x + rect.w, rect.y],
    [rect.x + rect.w, rect.y + rect.d],
    [rect.x, rect.y + rect.d],
  ].every(([px, py]) => {
    return insidePoly(lot.envelope, worldOf(lot, px - centre[0], py - centre[1]))
  })
}

/** Width and depth of the lot's setback envelope in the house frame. */
function envelopeSize(lot) {
  const cos = Math.cos(lot.angle)
  const sin = Math.sin(lot.angle)
  const pts = (lot.envelope || []).map(([X, Z]) => [(X - lot.centre[0]) * cos + (Z - lot.centre[1]) * sin, -(X - lot.centre[0]) * sin + (Z - lot.centre[1]) * cos])
  if (!pts.length) return [Infinity, Infinity]
  const xs = pts.map((p) => p[0])
  const zs = pts.map((p) => p[1])
  return [Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)]
}

const PRIVATE = ['bed', 'master', 'suite2', 'bath', 'mbath', 'jackjill', 'halfbath', 'wic', 'mwic']
const PUBLIC = ['living', 'dining', 'kitchen', 'foyer', 'office', 'pantry', 'mud', 'laundry']

/**
 * A spot for a new room: against the house, no collision, inside the setbacks.
 * Tries beside `near` first, then beside rooms of the same zone, then any room.
 */
function findSpot(rooms, near, w, d, kind, centre, lot = DEFAULT_LOT, starter = false) {
  const solid = rooms.filter((r) => isRoom(r) && !r.open)
  const fits = (c) => !solid.some((o) => intrusion({ ...c, w, d }, o) > 1) && insideSetbacks({ ...c, w, d }, centre, lot)
  const around = (nb) => [
    { x: nb.x + nb.w, y: nb.y }, // east
    { x: nb.x - w, y: nb.y }, // west
    { x: nb.x, y: nb.y + nb.d }, // toward the street
    { x: nb.x, y: nb.y - d }, // toward the back
    { x: nb.x + nb.w, y: nb.y + nb.d - d },
    { x: nb.x - w, y: nb.y + nb.d - d },
    { x: nb.x + nb.w - w, y: nb.y + nb.d },
    { x: nb.x + nb.w - w, y: nb.y - d },
  ]
  const zone = PRIVATE.includes(kind) ? PRIVATE : PUBLIC
  const order = [near, ...solid.filter((r) => zone.includes(r.kind) && r !== near), ...solid.filter((r) => !zone.includes(r.kind) && r !== near)].filter(Boolean)
  if (starter) {
    // the first draft is re-fitted to the lot afterwards, so a spot only has to keep the house small
    // enough for the envelope (a little over is fine, the fit shrinks it): pick the spot that grows
    // the footprint least, trying the mentioned neighbour first
    const env = envelopeSize(lot)
    const bbox = (c) => {
      const xs = [...solid.flatMap((o) => [o.x, o.x + o.w]), c.x, c.x + w]
      const ys = [...solid.flatMap((o) => [o.y, o.y + o.d]), c.y, c.y + d]
      return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)]
    }
    const everything = rooms.filter((r) => isRoom(r)) // porches count as taken ground for a new room
    const clear = (c) => !everything.some((o) => intrusion({ ...c, w, d }, o) > 1)
    const roomy = (c) => {
      const [bw, bd] = bbox(c)
      return bw <= env[0] * 1.06 && bd <= env[1] * 1.06
    }
    let best = null
    order.forEach((nb, ni) => {
      around(nb).forEach((c) => {
        if (!clear(c) || !roomy(c)) return
        const [bw, bd] = bbox(c)
        const over = bw > env[0] || bd > env[1] // the fit would have to shrink the house
        const score = bw * bd + (over ? 3000 : 0) + (nb === near ? 0 : 400 + ni * 50)
        if (!best || score < best.score) best = { ...c, score }
      })
    })
    if (best) return { x: best.x, y: best.y }
  }
  for (const nb of order) for (const c of around(nb)) if (fits(c)) return c
  // nothing touches: fall back to below the bedroom wing and let the rules speak
  const col = solid.filter((r) => PRIVATE.includes(r.kind))
  return { x: Math.min(...col.map((r) => r.x)), y: col.reduce((m, r) => Math.max(m, r.y + r.d), 0) }
}

/** Where a resized room should sit: the placement that intrudes least into its neighbours, closest to where it was. */
function bestPlacement(r, w, d, rooms, centre, lot = DEFAULT_LOT) {
  const solid = rooms.filter((o) => isRoom(o) && !o.open && o !== r)
  const dw = w - r.w
  const dd = d - r.d
  const cands = []
  for (const ax of [0, -dw, -dw / 2]) for (const ay of [0, -dd, -dd / 2]) cands.push({ x: r.x + ax, y: r.y + ay, w, d })
  const score = (c) => {
    const bump = solid.reduce((s, o) => s + Math.max(0, intrusion(c, o) - 1), 0)
    const drift = Math.hypot(c.x + w / 2 - (r.x + r.w / 2), c.y + d / 2 - (r.y + r.d / 2))
    return (insideSetbacks(c, centre, lot) ? 0 : 1000) + bump * 10 + drift * 0.1
  }
  return cands.sort((a, b) => score(a) - score(b))[0]
}

/** Which side of `room` touches `other`: 'n' 's' 'e' 'w' or null. */
function sharedSide(room, other) {
  const touch = (a, b) => Math.abs(a - b) < 1.0
  const xo = Math.min(room.x + room.w, other.x + other.w) - Math.max(room.x, other.x) > 2
  const yo = Math.min(room.y + room.d, other.y + other.d) - Math.max(room.y, other.y) > 2
  if (xo && touch(room.y, other.y + other.d)) return 'n'
  if (xo && touch(room.y + room.d, other.y)) return 's'
  if (yo && touch(room.x, other.x + other.w)) return 'w'
  if (yo && touch(room.x + room.w, other.x)) return 'e'
  return null
}

function edgeCentre(room, side) {
  return side === 'n' ? [room.x + room.w / 2, room.y] : side === 's' ? [room.x + room.w / 2, room.y + room.d] : side === 'w' ? [room.x, room.y + room.d / 2] : [room.x + room.w, room.y + room.d / 2]
}

/**
 * Apply ops to the room list. Returns the new list (rooms + elements + roof),
 * fully placed, plus plain descriptions of what happened.
 */
export function applyOps(ops, rooms, kit, stories = 1, lot = DEFAULT_LOT, { starter = false } = {}) {
  const L = lotOf(lot)
  const { rooms: flat, centre } = withPlanCoords(rooms, kit)
  const did = []
  const byId = () => Object.fromEntries(flat.filter(isRoom).map((r) => [r.id, r]))

  ops.forEach((o) => {
    const rs = byId()
    if (o.op === 'resize') {
      const r = rs[o.room]
      const w = q(o.w)
      const d = q(o.d)
      const to = bestPlacement(r, w, d, flat, centre, L)
      const sx = w / r.w
      const sy = d / r.d
      // everything in the room keeps its place relative to the room's walls
      flat.forEach((e) => {
        if (!e.element || e.room !== r.id || e.kind === 'roof') return
        const ex = e.x + e.w / 2
        const ey = e.y + e.d / 2
        let nx = to.x + (ex - r.x) * sx
        let ny = to.y + (ey - r.y) * sy
        if (e.kind === 'fixture') {
          nx = Math.min(Math.max(nx, to.x + e.w / 2), to.x + w - e.w / 2)
          ny = Math.min(Math.max(ny, to.y + e.d / 2), to.y + d - e.d / 2)
        }
        e.x = nx - e.w / 2
        e.y = ny - e.d / 2
      })
      did.push(`${r.name} is now ${w}' by ${d}' (was ${r.w}' by ${r.d}')`)
      r.w = w
      r.d = d
      r.x = to.x
      r.y = to.y
      // a garage is named by its cars
      if (r.kind === 'garage' && kit.rooms.garage?.perCar && /-Car Garage$/.test(r.name)) r.name = `${Math.max(1, Math.round(w / kit.rooms.garage.perCar))}-Car Garage`
    } else if (o.op === 'move') {
      const r = rs[o.room]
      r.x += o.dx
      r.y += o.dy
      flat.forEach((e) => {
        if (e.element && e.room === r.id && e.kind !== 'roof') {
          e.x += o.dx
          e.y += o.dy
        }
      })
      did.push(`Moved ${r.name.toLowerCase()} ${Math.abs(o.dx) >= Math.abs(o.dy) ? `${Math.abs(o.dx)}' ${o.dx > 0 ? 'east' : 'west'}` : `${Math.abs(o.dy)}' ${o.dy > 0 ? 'toward the street' : 'toward the back'}`}`)
    } else if (o.op === 'remove') {
      const r = rs[o.room]
      const idx = flat.indexOf(r)
      flat.splice(idx, 1)
      for (let i = flat.length - 1; i >= 0; i--) if (flat[i].element && flat[i].room === r.id) flat.splice(i, 1)
      did.push(`Removed ${r.name.toLowerCase()}`)
    } else if (o.op === 'add') {
      const t = kit.rooms[o.kind]
      const n = flat.filter((r) => r.kind === o.kind).length + 1
      const name = o.name || (['bed', 'bath'].includes(o.kind) ? `${t.name} ${n}` : t.name)
      const w = q(o.w || t.w)
      const d = q(o.d || t.d)
      const near = o.near ? rs[o.near] : null
      const spot = findSpot(flat, near, w, d, o.kind, centre, L, starter)
      const room = makeRoom(kit, o.kind, { name, w, d, x: spot.x, y: spot.y, id: o.id || `${o.kind}-${Date.now().toString(36)}-${n}`, ...(o.kind === 'garage' ? { fill: '#dcd7cf' } : {}) })
      flat.push(room)
      // a door on the wall shared with a neighbour, a window on an outside wall
      const neighbours = flat.filter((r) => isRoom(r) && r !== room && !r.open)
      const withSide = neighbours.map((nb) => [nb, sharedSide(room, nb)]).filter(([, s]) => s)
      const sides = ['n', 'e', 's', 'w']
      const doorSide = withSide[0]?.[1] || null
      if (doorSide) {
        const [dx, dy] = edgeCentre(room, doorSide)
        const axis = doorSide === 'n' || doorSide === 's' ? 'h' : 'v'
        const size = kit.doors.interior
        flat.push({ id: `door-${room.id}`, kind: 'door', element: true, open: true, name: 'Door', room: room.id, axis, x: axis === 'h' ? dx - size.w / 24 : dx - 0.3, y: axis === 'h' ? dy - 0.3 : dy - size.w / 24, w: axis === 'h' ? size.w / 12 : 0.6, d: axis === 'h' ? 0.6 : size.w / 12, span: size.w / 12, swing: doorSide === 'n' || doorSide === 'w' ? 1 : -1, hinge: 'start', size: 'interior', h: 6.67 })
      }
      const outside = sides.filter((s) => !withSide.some(([, ws]) => ws === s))
      if (outside.length && ['bed', 'master', 'suite2', 'office', 'living', 'dining', 'kitchen'].includes(o.kind)) {
        const side = outside.includes('s') ? 's' : outside[0]
        const [wx, wy] = edgeCentre(room, side)
        const axis = side === 'n' || side === 's' ? 'h' : 'v'
        const span = Math.min(6, Math.max(3, (axis === 'h' ? w : d) - 4))
        flat.push({ id: `win-${room.id}`, kind: 'window', element: true, open: true, name: 'Window A', room: room.id, mark: 'A', axis, x: axis === 'h' ? wx - span / 2 : wx - 0.3, y: axis === 'h' ? wy - 0.3 : wy - span / 2, w: axis === 'h' ? span : 0.6, d: axis === 'h' ? 0.6 : span, span, sill: WINDOW_SILL.A, head: WINDOW_HEAD.A, h: 7 })
      }
      did.push(`Added ${name.toLowerCase()}, ${w}' by ${d}'${near ? ` next to the ${near.name.toLowerCase()}` : ''}`)
    }
  })

  // roof follows the rooms that remain
  const roof = flat.find((r) => r.kind === 'roof')
  if (roof && kit.plan?.roof) {
    const ids = new Set(flat.filter(isRoom).map((r) => r.id))
    const masses = kit.plan.roof.filter((m) => !m.id || ids.has(m.id) || !kit.plan.rooms.some((r) => r.id === m.id)).filter((m) => !(m.id === 'leftwing' && !ids.has('suite2')))
    roof.masses = masses
    roof.faces = roofSurfaces(masses, roof.scale || 1, roof.centre || centre, roof.offset || [0, 0])
    roof.dormers = dormerWalls(masses, roof.scale || 1, roof.centre || centre, roof.offset || [0, 0])
  }
  const placed = placeLocal(flat.filter((r) => r.kind !== 'roof'), stories, kit, centre, L)
  if (roof) placed.push(roof)
  return { rooms: placed, did }
}

// ── regex fallback ──────────────────────────────────────────────────────────
const KINDS = [
  ['mwic', /(primary|master) closet/],
  ['mbath', /(primary|master) bath/],
  ['master', /(primary|master) (bed|suite)|\bmaster\b|\bprimary\b/],
  ['suite2', /mini (primary|master)|second suite|guest suite/],
  ['kitchen', /kitchen/],
  ['living', /living|family room|great room/],
  ['dining', /dining/],
  ['garage', /garage/],
  ['halfbath', /half bath|powder/],
  ['jackjill', /jack/],
  ['bed', /bedroom|bed\b/],
  ['bath', /\bbath/],
  ['laundry', /laundry|utility/],
  ['frontPorch', /front porch|porch (on|at|in|to) the front|porch out front/],
  ['rearPorch', /rear porch|back porch|patio|porch (on|at|in|to) the (back|rear)|porch out back|covered patio/],
  ['porch', /\bporch\b/],
  ['office', /office|study/],
  ['pantry', /pantry/],
  ['mud', /mud ?room/],
  ['foyer', /foyer|entry/],
  ['wic', /closet/],
]

/** Produces ops from keywords. The fallback when the interpreter is unreachable. */
/** The same plan placed on another lot (after a drafter confirms or corrects the lot). */
export function replaceOnLot(rooms, kit, stories, lot) {
  const { rooms: flat, centre } = withPlanCoords(rooms, kit)
  const placed = placeLocal(flat.filter((r) => r.kind !== 'roof'), stories, kit, centre, lotOf(lot))
  const roof = rooms.find((r) => r.kind === 'roof')
  if (roof) placed.push(roof)
  return placed
}

/** A free spot for `room` against `target`: the move that puts it there, or null. */
export function spotBeside(rooms, kit, room, target, lot = DEFAULT_LOT) {
  const { rooms: flat, centre } = withPlanCoords(rooms, kit)
  const r = flat.find((x) => x.id === room.id)
  const t = flat.find((x) => x.id === target.id)
  if (!r || !t) return null
  const others = flat.filter((x) => x !== r)
  const spot = findSpot(others, t, r.w, r.d, r.kind, centre, lotOf(lot))
  if (!spot) return null
  // findSpot falls back to "below the bedroom wing" when nothing touches; only a spot against the target counts
  const touches = sharedSide({ ...r, x: spot.x, y: spot.y }, t)
  if (!touches) return null
  return { dx: q(spot.x - r.x), dy: q(spot.y - r.y) }
}

const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 }

export function regexOps(text, rooms, kit, lot = DEFAULT_LOT) {
  const t = text.toLowerCase()
  const grow = /\b(bigger|larger|wider|deeper|more room|expand|increase|enlarge)\b/.test(t)
  const shrink = /\b(smaller|tighter|reduce|shrink|less|narrower)\b/.test(t)
  const add = /\b(add|another|extra|one more|put in)\b/.test(t)
  const remove = /\b(remove|delete|drop|get rid of|without|take out|no longer)\b/.test(t)
  const much = /\b(much|a lot|way|double)\b/.test(t) ? 1.3 : 1.15
  const hit = KINDS.find(([, re]) => re.test(t))
  const kind = hit?.[0]
  const rest = hit ? t.replace(hit[1], ' ') : t // so "half bath next to the laundry" finds the laundry, not the bath
  const roomsOnly = rooms.filter(isRoom)
  const targets = roomsOnly.filter((r) => r.kind === kind)
  const feet = t.match(/(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')/)
  const by = feet ? +feet[1] : null

  if (!kind) return { ops: [], reply: 'I did not catch which room you mean. Try "make the kitchen bigger", "add an office", or "remove the half bath".', confidence: 0.2 }
  if (kind === 'porch') return { ops: [], reply: 'Front porch or back porch?', confidence: 0.3 }
  // "make the garage 3 cars", "three-car garage"
  const cars = t.match(/(\d+|one|two|three|four)[- ]?cars?\b/)
  if (kind === 'garage' && cars && !add && !remove) {
    const n = WORDS[cars[1]] || +cars[1]
    if (!targets.length) return { ops: [{ op: 'add', kind: 'garage', name: `${n}-Car Garage`, w: kit.rooms.garage.perCar * n, d: kit.rooms.garage.d, near: roomsOnly.find((r) => r.kind === 'laundry' || r.kind === 'mud')?.id }], reply: `Adding a ${n}-car garage.`, confidence: 0.7 }
    const g = targets[targets.length - 1]
    return { ops: [{ op: 'resize', room: g.id, w: kit.rooms.garage.perCar * n, d: g.d }], reply: `Making the garage ${n} cars wide, ${kit.rooms.garage.perCar * n} feet.`, confidence: 0.75 }
  }
  // "move the office 10 feet toward the street", "shift the garage 5 ft east"
  const byDist = t.match(/(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')\s*(?:toward|towards|to|closer to)?\s*(?:the\s+)?(street|front|back|rear|east|west|left|right|north|south)\b/)
  if (/\b(move|push|pull|shift|slide|relocate)\b/.test(t) && byDist && targets.length) {
    const n = +byDist[1]
    const dir = byDist[2]
    const dx = /east|right/.test(dir) ? n : /west|left/.test(dir) ? -n : 0
    const dy = /street|front|south/.test(dir) ? n : /back|rear|north/.test(dir) ? -n : 0
    const r = targets[targets.length - 1]
    return { ops: [{ op: 'move', room: r.id, dx, dy }], reply: `Moving the ${r.name.toLowerCase()} ${n} feet ${dir === 'front' || dir === 'south' ? 'toward the street' : dir === 'rear' || dir === 'north' ? 'toward the back' : dir === 'street' ? 'toward the street' : dir === 'back' ? 'toward the back' : dir}.`, confidence: 0.7 }
  }
  // "move the laundry next to the garage"
  const move = /\b(move|put|place|relocate|shift)\b/.test(t) && /\b(next to|beside|by|near|against|closer to)\b/.test(t)
  if (move && targets.length) {
    const nearKind = KINDS.find(([k, re]) => k !== kind && k !== 'porch' && re.test(rest))?.[0]
    const target = nearKind ? roomsOnly.find((r) => r.kind === nearKind) : null
    if (!target) return { ops: [], reply: `Next to which room? There is no ${nearKind ? kit.rooms[nearKind]?.name.toLowerCase() || nearKind : 'room by that name'} in this plan.`, confidence: 0.4 }
    const r = targets[targets.length - 1]
    const d = spotBeside(rooms, kit, r, target, lot)
    if (!d) return { ops: [], reply: `There is no free spot for the ${r.name.toLowerCase()} against the ${target.name.toLowerCase()}.`, confidence: 0.6 }
    if (d.dx === 0 && d.dy === 0) return { ops: [], reply: `The ${r.name.toLowerCase()} is already next to the ${target.name.toLowerCase()}.`, confidence: 0.6 }
    return { ops: [{ op: 'move', room: r.id, dx: d.dx, dy: d.dy }], reply: `Moving the ${r.name.toLowerCase()} next to the ${target.name.toLowerCase()}.`, confidence: 0.7 }
  }
  if (add) {
    if (!kit.rooms[kind]) return { ops: [], reply: `The ${kit.name} kit does not have that room yet.`, confidence: 0.4 }
    const nearKind = KINDS.find(([k, re]) => k !== kind && re.test(rest))?.[0]
    const near = nearKind ? roomsOnly.find((r) => r.kind === nearKind)?.id : null
    return { ops: [{ op: 'add', kind, ...(near ? { near } : {}) }], reply: `Adding ${/^[aeiou]/i.test(kit.rooms[kind].name) ? 'an' : 'a'} ${kit.rooms[kind].name.toLowerCase()}${near ? ' next to the ' + roomsOnly.find((r) => r.id === near).name.toLowerCase() : ''}.`, confidence: 0.7 }
  }
  if (!targets.length) return { ops: [], reply: `There is no ${kit.rooms[kind]?.name.toLowerCase() || kind} in this plan.`, confidence: 0.6 }
  const last = targets[targets.length - 1]
  if (remove) return { ops: [{ op: 'remove', room: last.id }], reply: `Removing the ${last.name.toLowerCase()}.`, confidence: 0.7 }
  // "make the kitchen 14 feet wide", "20 feet deep", "12 by 16": sizes stated outright
  const abs = t.match(/(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')?\s*(wide|deep|long|across)\b/)
  const both = t.match(/(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')?\s*(?:by|x|×)\s*(\d+(?:\.\d+)?)/)
  if (both || (abs && !grow && !shrink)) {
    const w = both ? +both[1] : abs[2] === 'wide' || abs[2] === 'across' ? +abs[1] : last.w
    const d = both ? +both[2] : abs[2] !== 'wide' && abs[2] !== 'across' ? +abs[1] : last.d
    return { ops: [{ op: 'resize', room: last.id, w: q(w), d: q(d) }], reply: `Making the ${last.name.toLowerCase()} ${q(w)} by ${q(d)} feet.`, confidence: 0.75 }
  }
  if (grow || shrink) {
    const f = grow ? much : 1 / much
    const wider = /\bwider\b/.test(t)
    const deeper = /\bdeeper|longer\b/.test(t)
    const sign = grow ? 1 : -1
    const ops = targets.map((r) => ({ op: 'resize', room: r.id, w: by && wider ? r.w + sign * by : deeper ? r.w : by && !deeper ? r.w + sign * by : q(r.w * f), d: by && deeper ? r.d + sign * by : wider ? r.d : by ? r.d + sign * by : q(r.d * f) }))
    const how = by ? `${by} feet ${wider ? 'wider' : deeper ? 'deeper' : grow ? 'bigger each way' : 'smaller each way'}` : `about ${Math.round(Math.abs(f - 1) * 100)} percent`
    return { ops, reply: `${grow ? 'Making' : 'Making'} the ${last.name.toLowerCase()} ${how}.`, confidence: 0.7 }
  }
  return { ops: [], reply: 'Tell me what to do with that room: bigger, smaller, add one, or remove it.', confidence: 0.3 }
}

/** Compact room list for the interpreter prompt. */
export function summarizeRooms(rooms) {
  return rooms.filter(isRoom).map((r) => ({ id: r.id, kind: r.kind, name: r.name, w: r.w, d: r.d, x: q(r.x ?? 0), y: q(r.y ?? 0), open: !!r.open }))
}

export { FIXTURE_H, FIXTURE_NAME }
