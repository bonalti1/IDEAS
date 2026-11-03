// Change ops: validate, apply, and the regex fallback that produces them.
// Schema in docs/change-diff.md. Plan feet throughout.
import { makeRoom, placeLocal, kitFor, isRoom, ENVELOPE_CENTER } from './layout.js'
import { LOT_ANGLE } from '../../data/program.js'
import { SETBACK_CORNERS } from '../../data/survey.js'
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
function insideSetbacks(rect, centre) {
  const cos = Math.cos(LOT_ANGLE)
  const sin = Math.sin(LOT_ANGLE)
  return [
    [rect.x, rect.y],
    [rect.x + rect.w, rect.y],
    [rect.x + rect.w, rect.y + rect.d],
    [rect.x, rect.y + rect.d],
  ].every(([px, py]) => {
    const lx = px - centre[0]
    const lz = py - centre[1]
    return insidePoly(SETBACK_CORNERS, [ENVELOPE_CENTER[0] + lx * cos - lz * sin, ENVELOPE_CENTER[1] + lx * sin + lz * cos])
  })
}

const PRIVATE = ['bed', 'master', 'suite2', 'bath', 'mbath', 'jackjill', 'halfbath', 'wic', 'mwic']
const PUBLIC = ['living', 'dining', 'kitchen', 'foyer', 'office', 'pantry', 'mud', 'laundry']

/**
 * A spot for a new room: against the house, no collision, inside the setbacks.
 * Tries beside `near` first, then beside rooms of the same zone, then any room.
 */
function findSpot(rooms, near, w, d, kind, centre) {
  const solid = rooms.filter((r) => isRoom(r) && !r.open)
  const fits = (c) => !solid.some((o) => intrusion({ ...c, w, d }, o) > 1) && insideSetbacks({ ...c, w, d }, centre)
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
  for (const nb of order) for (const c of around(nb)) if (fits(c)) return c
  // nothing touches: fall back to below the bedroom wing and let the rules speak
  const col = solid.filter((r) => PRIVATE.includes(r.kind))
  return { x: Math.min(...col.map((r) => r.x)), y: col.reduce((m, r) => Math.max(m, r.y + r.d), 0) }
}

/** Where a resized room should sit: the placement that intrudes least into its neighbours, closest to where it was. */
function bestPlacement(r, w, d, rooms, centre) {
  const solid = rooms.filter((o) => isRoom(o) && !o.open && o !== r)
  const dw = w - r.w
  const dd = d - r.d
  const cands = []
  for (const ax of [0, -dw, -dw / 2]) for (const ay of [0, -dd, -dd / 2]) cands.push({ x: r.x + ax, y: r.y + ay, w, d })
  const score = (c) => {
    const bump = solid.reduce((s, o) => s + Math.max(0, intrusion(c, o) - 1), 0)
    const drift = Math.hypot(c.x + w / 2 - (r.x + r.w / 2), c.y + d / 2 - (r.y + r.d / 2))
    return (insideSetbacks(c, centre) ? 0 : 1000) + bump * 10 + drift * 0.1
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
export function applyOps(ops, rooms, kit, stories = 1) {
  const { rooms: flat, centre } = withPlanCoords(rooms, kit)
  const did = []
  const byId = () => Object.fromEntries(flat.filter(isRoom).map((r) => [r.id, r]))

  ops.forEach((o) => {
    const rs = byId()
    if (o.op === 'resize') {
      const r = rs[o.room]
      const w = q(o.w)
      const d = q(o.d)
      const to = bestPlacement(r, w, d, flat, centre)
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
      const spot = findSpot(flat, near, w, d, o.kind, centre)
      const room = makeRoom(kit, o.kind, { name, w, d, x: spot.x, y: spot.y, id: `${o.kind}-${Date.now().toString(36)}-${n}` })
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
    roof.faces = roofSurfaces(masses, roof.scale || 1, roof.centre || centre)
    roof.dormers = dormerWalls(masses, roof.scale || 1, roof.centre || centre)
  }
  const placed = placeLocal(flat.filter((r) => r.kind !== 'roof'), stories, kit, centre)
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
  ['frontPorch', /front porch/],
  ['rearPorch', /rear porch|back porch|patio/],
  ['office', /office|study/],
  ['pantry', /pantry/],
  ['mud', /mud ?room/],
  ['foyer', /foyer|entry/],
  ['wic', /closet/],
]

/** Produces ops from keywords. The fallback when the interpreter is unreachable. */
export function regexOps(text, rooms, kit) {
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
  if (add) {
    if (!kit.rooms[kind]) return { ops: [], reply: `The ${kit.name} kit does not have that room yet.`, confidence: 0.4 }
    const nearKind = KINDS.find(([k, re]) => k !== kind && re.test(rest))?.[0]
    const near = nearKind ? roomsOnly.find((r) => r.kind === nearKind)?.id : null
    return { ops: [{ op: 'add', kind, ...(near ? { near } : {}) }], reply: `Adding ${/^[aeiou]/i.test(kit.rooms[kind].name) ? 'an' : 'a'} ${kit.rooms[kind].name.toLowerCase()}${near ? ' next to the ' + roomsOnly.find((r) => r.id === near).name.toLowerCase() : ''}.`, confidence: 0.7 }
  }
  if (!targets.length) return { ops: [], reply: `There is no ${kit.rooms[kind]?.name.toLowerCase() || kind} in this plan.`, confidence: 0.6 }
  const last = targets[targets.length - 1]
  if (remove) return { ops: [{ op: 'remove', room: last.id }], reply: `Removing the ${last.name.toLowerCase()}.`, confidence: 0.7 }
  if (grow || shrink) {
    const f = grow ? much : 1 / much
    const wider = /\bwider\b/.test(t)
    const deeper = /\bdeeper|longer\b/.test(t)
    const ops = targets.map((r) => ({ op: 'resize', room: r.id, w: by && wider ? r.w + by : deeper ? r.w : q(r.w * f), d: by && deeper ? r.d + by : wider ? r.d : q(r.d * f) }))
    return { ops, reply: `${grow ? 'Enlarging' : 'Reducing'} the ${last.name.toLowerCase()} by about ${Math.round(Math.abs(f - 1) * 100)} percent.`, confidence: 0.7 }
  }
  return { ops: [], reply: 'Tell me what to do with that room: bigger, smaller, add one, or remove it.', confidence: 0.3 }
}

/** Compact room list for the interpreter prompt. */
export function summarizeRooms(rooms) {
  return rooms.filter(isRoom).map((r) => ({ id: r.id, kind: r.kind, name: r.name, w: r.w, d: r.d, x: q(r.x ?? 0), y: q(r.y ?? 0), open: !!r.open }))
}

export { FIXTURE_H, FIXTURE_NAME }
