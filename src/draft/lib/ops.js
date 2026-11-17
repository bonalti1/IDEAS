// Change ops: validate, apply, and the regex fallback that produces them.
// Schema in docs/change-diff.md. Plan feet throughout.
import { makeRoom, placeLocal, kitFor, isRoom, lotOf, attachGarage, fitToLot, overheadDoors, garageFacing, minSizeOf, planIdOf, scalePlan, isConditioned } from './layout.js'
import { attachBeside, addPorch, addInWing, moveBeside, removeRoom, fixturesFor, doorsOf } from './add.js'
import { DEFAULT_LOT, worldOf } from './lot.js'
import { auditPlan } from './audit.js'
import { roofSurfaces, dormerWalls } from './roof.js'
import { FIXTURE_H, FIXTURE_NAME, WINDOW_SILL, WINDOW_HEAD } from '../../kits/modern-farmhouse.js'

export const OPS = ['resize', 'add', 'remove', 'move', 'moveBeside', 'garage', 'scale', 'swap']
const q = (v) => Math.round(v * 4) / 4

/**
 * Tidy a diff before it is checked: a resize missing one side keeps the room's current side, a move
 * missing an axis moves 0 on it, and ops with nothing in them are dropped. The interpreter sometimes
 * adds such a stub beside the real op; the client should not lose the change over it.
 */
export function normalizeOps(ops, rooms) {
  if (!Array.isArray(ops)) return ops
  const byId = Object.fromEntries(rooms.filter(isRoom).map((r) => [r.id, r]))
  return ops
    .map((o) => {
      if (!o || typeof o !== 'object') return o
      if (o.op === 'resize') {
        const r = byId[o.room]
        if (!r) return o
        const w = o.w > 0 ? o.w : r.w
        const d = o.d > 0 ? o.d : r.d
        if (!(o.w > 0) && !(o.d > 0)) return null
        // a garage is placed by its cars, not stretched: a resize of one becomes "N cars"
        if (r.kind === 'garage') return { op: 'garage', cars: Math.max(1, Math.min(4, Math.round(Math.max(w, d) / 11))) }
        return { ...o, w, d }
      }
      if (o.op === 'move') {
        if (o.target && byId[o.target]) return { op: 'moveBeside', room: o.room, target: o.target }
        const dx = Number.isFinite(o.dx) ? o.dx : 0
        const dy = Number.isFinite(o.dy) ? o.dy : 0
        if (!dx && !dy) return null
        return { ...o, dx, dy }
      }
      if (o.op === 'add' && !o.kind) return null
      // a garage op without a bay count keeps the garage's bays ("make the garage side-load")
      if (o.op === 'garage' && !(o.cars >= 1)) {
        const g = rooms.find((r) => isRoom(r) && r.kind === 'garage')
        const cars = g ? (g.tandem || /tandem/i.test(g.name || '') ? 3 : Math.max(1, Math.round(Math.max(g.w, g.d) / 11))) : 2
        return { ...o, cars }
      }
      return o
    })
    .filter(Boolean)
}

/** Shape check only. Rules come later. */
export function validateOps(ops, rooms, kit) {
  const errors = []
  if (!Array.isArray(ops)) return { ok: false, errors: ['ops must be a list'] }
  const ids = new Set(rooms.filter(isRoom).map((r) => r.id))
  ops.forEach((o, i) => {
    const at = `op ${i + 1}`
    if (!o || !OPS.includes(o.op)) return errors.push(`${at}: unknown op "${o?.op}"`)
    if (o.op !== 'add' && o.op !== 'garage' && o.op !== 'scale' && !ids.has(o.room)) errors.push(`${at}: no room "${o.room}"`)
    if (o.op === 'scale' && !(o.sqft >= 600 && o.sqft <= 10000)) errors.push(`${at}: scale needs sqft`)
    if (o.op === 'swap' && !ids.has(o.target)) errors.push(`${at}: no room "${o.target}" to swap with`)
    if (o.op === 'resize' && !(o.w > 0 && o.d > 0)) errors.push(`${at}: resize needs w and d`)
    if (o.op === 'garage' && !(o.cars >= 1 && o.cars <= 4)) errors.push(`${at}: garage needs cars (1 to 4)`)
    if (o.op === 'add' && !kit.rooms[o.kind]) errors.push(`${at}: kind "${o.kind}" is not in the ${kit.name} kit`)
    if (o.op === 'move' && !(Number.isFinite(o.dx) && Number.isFinite(o.dy))) errors.push(`${at}: move needs dx and dy`)
    if (o.op === 'moveBeside' && !ids.has(o.target)) errors.push(`${at}: no room "${o.target}" to move next to`)
  })
  return { ok: errors.length === 0, errors }
}

/** Plan coordinates for every room, even packer-made ones that only have `local`. */
export function withPlanCoords(rooms, kit) {
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
export function envelopeSize(lot) {
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

/**
 * Move one wall of a room so the house stays one piece. The rooms directly behind the wall (in the
 * room's lane) move with it when they are free to (every room they touch moves too, sits on the
 * line and stretches, or is the room itself); otherwise they give up the space, as long as they stay
 * above their minimum size and nothing in them is in the way. A porch behind the wall shrinks
 * rather than moving while it stays 8 ft deep. Rooms that straddle the line in the lane stretch;
 * rooms whose far edge sits on the line and that touch a moved room across it stretch to keep up.
 * Elements go with their rooms; a door or window on the moving wall moves with it; the roof follows.
 * side 'e' | 'w' | 's' | 'n'; delta > 0 moves the wall outward (the room grows). In place.
 * Returns true, or a string saying why the wall cannot move.
 */
export function pushWall(flat, roomId, side, delta, kit, { roof: roofOverride } = {}) {
  const room = flat.find((r) => r.id === roomId)
  if (!room || !delta) return false
  const axis = side === 'e' || side === 'w' ? 'x' : 'y'
  const size = axis === 'x' ? 'w' : 'd'
  const cross = axis === 'x' ? 'y' : 'x'
  const crossSize = axis === 'x' ? 'd' : 'w'
  const outward = side === 'e' || side === 's' ? 1 : -1
  const L = outward > 0 ? room[axis] + room[size] : room[axis]
  const move = outward * delta
  const tol = 0.6
  const rooms = flat.filter((r) => isRoom(r))
  const lo = (r) => r[axis]
  const hi = (r) => r[axis] + r[size]
  const beyond = (r) => (outward > 0 ? lo(r) >= L - tol : hi(r) <= L + tol)
  const straddles = (r) => lo(r) < L - tol && hi(r) > L + tol
  const span1 = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0)
  const crossOverlap = (a, b) => span1(a[cross], a[cross] + a[crossSize], b[cross], b[cross] + b[crossSize]) > 0.5
  const touches = (a, b) => (crossOverlap(a, b) && (Math.abs(lo(a) - hi(b)) < 0.75 || Math.abs(lo(b) - hi(a)) < 0.75)) || (span1(lo(a), hi(a), lo(b), hi(b)) > 0.5 && (Math.abs(a[cross] - (b[cross] + b[crossSize])) < 0.75 || Math.abs(b[cross] - (a[cross] + a[crossSize])) < 0.75))
  const farOnLine = (r) => (outward > 0 ? Math.abs(hi(r) - L) < tol : Math.abs(lo(r) - L) < tol)
  const lane = rooms.filter((r) => r !== room && beyond(r) && crossOverlap(r, room))
  // stacked behind the lane, transitively
  const behind = new Set(lane)
  for (let changed = true; changed; ) {
    changed = false
    rooms.forEach((r) => {
      if (r === room || behind.has(r) || !beyond(r)) return
      if ([...behind].some((m) => crossOverlap(r, m) && (outward > 0 ? Math.abs(lo(r) - hi(m)) < 0.75 : Math.abs(hi(r) - lo(m)) < 0.75))) {
        behind.add(r)
        changed = true
      }
    })
  }
  // porches behind the wall shrink while they stay deep enough
  const minPorch = kit.porch?.minDepthFt || 8
  const shrinkers = new Set([...behind].filter((r) => r.open && delta > 0 && r[size] - delta >= minPorch - 0.01))
  // who is free to move: every neighbour moves too, sits on the line (and will stretch), or is the room
  // when the room shrinks nothing moves: the lane takes the space (an outside wall just steps back)
  const cand = new Set(delta > 0 ? [...behind].filter((r) => !shrinkers.has(r)) : [])
  const moved = new Set(cand)
  for (let changed = true; changed; ) {
    changed = false
    ;[...moved].forEach((r) => {
      const ok = rooms.every((n) => n === r || n === room || !touches(n, r) || moved.has(n) || shrinkers.has(n) || (!beyond(n) && (farOnLine(n) || (straddles(n) && crossOverlap(n, room)))) || (beyond(n) && !touches(n, room) && crossOverlap(n, r) === false && !crossOverlap(n, room) && Math.abs(lo(n) - hi(r)) > 0.75 && Math.abs(lo(r) - hi(n)) > 0.75))
      if (!ok) {
        moved.delete(r)
        changed = true
      }
    })
  }
  // beside a moved room and beyond the line: joins when it, too, is free (the rest of a wing)
  for (let changed = true; changed; ) {
    changed = false
    rooms.forEach((r) => {
      if (r === room || moved.has(r) || shrinkers.has(r) || !beyond(r) || r.open) return
      if (![...moved].some((m) => touches(m, r))) return
      const ok = rooms.every((n) => n === r || n === room || !touches(n, r) || moved.has(n) || shrinkers.has(n) || (!beyond(n) && (farOnLine(n) || (straddles(n) && crossOverlap(n, room)))))
      if (ok) {
        moved.add(r)
        changed = true
      }
    })
  }
  // lane rooms that cannot move give up the space, when they can (or take it, when the room shrinks)
  // only rooms against the wall give or take space; a lane room further off stays where it is, and
  // the wall may not reach it
  const against = (r) => Math.abs((outward > 0 ? lo(r) : hi(r)) - L) < tol
  const staying = [...lane].filter((r) => !moved.has(r) && !shrinkers.has(r) && !against(r))
  const givers = [...lane].filter((r) => !moved.has(r) && !shrinkers.has(r) && against(r) && (delta > 0 || !r.open))
  const minOf = (r) => {
    const m = minSizeOf(kit, r.kind, planIdOf(flat))
    return m ? (axis === 'x' ? m[0] : m[1]) : 3
  }
  if (delta > 0) {
    const hit = staying.find((r) => (outward > 0 ? lo(r) < L + delta + 0.3 : hi(r) > L - delta - 0.3))
    if (hit) return `${hit.name} is in the way`
    for (const r of givers) {
      if (r[size] - delta < minOf(r) - 0.01) return `${r.name} would be too small`
      const cut = outward > 0 ? [lo(r), lo(r) + delta] : [hi(r) - delta, hi(r)]
      const inWay = flat.find((e) => e.element && e.kind === 'fixture' && e.room === r.id && span1(e[axis], e[axis] + e[size], cut[0], cut[1]) > 0.3)
      if (inWay) return `${inWay.name.toLowerCase()} in the ${r.name.toLowerCase()} is in the way`
    }
  }
  const stretched = new Set(rooms.filter((r) => r !== room && !moved.has(r) && !shrinkers.has(r) && !givers.includes(r) && !staying.includes(r) && straddles(r) && crossOverlap(r, room)))
  rooms.forEach((r) => {
    if (r === room || moved.has(r) || stretched.has(r) || shrinkers.has(r) || givers.includes(r) || staying.includes(r) || !farOnLine(r) || beyond(r)) return
    // beside the room on the line, touching something across it that moves or gives: keep up with the wall
    if ([...moved, ...givers, ...shrinkers].some((m) => crossOverlap(r, m) && (outward > 0 ? Math.abs(hi(r) - lo(m)) < 0.75 : Math.abs(lo(r) - hi(m)) < 0.75))) stretched.add(r)
  })
  if (delta < 0) {
    const tooSmall = [...stretched].find((r) => !r.open && r[size] + delta < minOf(r) - 0.01)
    if (tooSmall) return `${tooSmall.name} would be too small`
  }
  const grow = (r, d) => {
    if (outward > 0) r[size] += d
    else {
      r[axis] -= d
      r[size] += d
    }
  }
  // the rooms' rectangles before the wall moves, so each room's own roof mass can follow its edges
  const before = new Map(rooms.map((r) => [r.id, { x: r.x, y: r.y, w: r.w, d: r.d }]))
  moved.forEach((r) => (r[axis] += move))
  stretched.forEach((r) => grow(r, delta))
  shrinkers.forEach((r) => {
    if (outward > 0) {
      r[axis] += delta
      r[size] -= delta
    } else r[size] -= delta
  })
  givers.forEach((r) => {
    // the wall moves into them (delta > 0) or away from them (delta < 0, they take the space)
    if (outward > 0) {
      r[axis] += delta
      r[size] -= delta
    } else r[size] -= delta
  })
  grow(room, delta)
  const movedIds = new Set([...moved].map((r) => r.id))
  const stretchedIds = new Set([...stretched].map((r) => r.id))
  flat.forEach((e) => {
    if (!e.element || e.kind === 'roof') return
    const c = e[axis] + e[size] / 2
    if (e.room === room.id) {
      if (Math.abs(c - L) < 0.6) e[axis] += move
    } else if (movedIds.has(e.room)) e[axis] += move
    else if (stretchedIds.has(e.room)) {
      if (outward > 0 ? c >= L - 0.6 : c <= L + 0.6) e[axis] += move
    } else if (givers.some((g) => g.id === e.room) || [...shrinkers].some((g) => g.id === e.room)) {
      if (Math.abs(c - L) < 0.6) e[axis] += move // a door on the shared wall goes with the wall
    }
  })
  // the roof, in base coordinates: masses stacked behind in the lane move, masses across the line stretch
  const roof = roofOverride === null ? null : roofOverride || flat.find((r) => r.kind === 'roof')
  if (roof && roof.masses) {
    const k = roof.scale || 1
    const off = roof.offset || [0, 0]
    const c0 = roof.centre || [0, 0]
    const i = axis === 'x' ? 0 : 1
    const j = axis === 'x' ? 1 : 0
    const Lb = c0[i] + (L - off[i] - c0[i]) / k
    const db = delta / k
    const a0 = axis === 'x' ? 'x0' : 'y0'
    const a1 = axis === 'x' ? 'x1' : 'y1'
    const b0 = axis === 'x' ? 'y0' : 'x0'
    const b1 = axis === 'x' ? 'y1' : 'x1'
    const toB = (v, idx) => c0[idx] + (v - off[idx] - c0[idx]) / k
    const laneB = [toB(room[cross], j), toB(room[cross] + room[crossSize], j)]
    const movedB = [...moved].map((r) => ({ lo: toB(lo(r), i), hi: toB(hi(r), i), c0: toB(r[cross], j), c1: toB(r[cross] + r[crossSize], j) }))
    const mLo = (m) => m[a0] ?? m.face
    const mHi = (m) => m[a1] ?? m.face
    const mBeyond = (m) => (outward > 0 ? mLo(m) >= Lb - tol : mHi(m) <= Lb + tol)
    const inLane = (m, c0b, c1b) => Math.min(m[b1] ?? m[b0] ?? 0, c1b) - Math.max(m[b0] ?? 0, c0b) > 0.5
    const byId = new Map(rooms.map((r) => [r.id, r]))
    roof.masses = roof.masses.map((m) => {
      const mm = { ...m }
      const shift = outward * db
      // a mass that is a room's own roof follows that room's edges exactly
      const own = m.id && byId.get(m.id) && before.get(m.id)
      if (own) {
        const r = byId.get(m.id)
        const o = before.get(m.id)
        const dLo = (r[axis] - o[axis]) / k
        const dHi = (r[axis] + r[size] - (o[axis] + o[size])) / k
        if (Math.abs(dLo) < 1e-9 && Math.abs(dHi) < 1e-9) return mm
        if (mm[a0] !== undefined) mm[a0] += dLo
        if (mm[a1] !== undefined) mm[a1] += dHi
        if (axis === 'y' && mm.face !== undefined) mm.face += Math.abs(mm.face - toB(o.y, 1)) < Math.abs(mm.face - toB(o.y + o.d, 1)) ? dLo : dHi
        if (mm.cuts) mm.cuts = mm.cuts.map((ct) => ({ ...ct, [a0]: ct[a0] + (Math.abs(ct[a0] - mLo(m)) < 0.75 ? dLo : 0), [a1]: ct[a1] + (Math.abs(ct[a1] - mHi(m)) < 0.75 ? dHi : 0) }))
        return mm
      }
      // a mass with no room of its own (the main roof, a dormer, an awning): moves with the rooms that moved under it, stretches across the line
      const movesWith = mBeyond(m) && movedB.some((r) => inLane(m, r.c0, r.c1) && mLo(m) < r.hi + 0.75 && mHi(m) > r.lo - 0.75)
      if (movesWith && !m.id?.endsWith('Porch')) {
        if (mm[a0] !== undefined) mm[a0] += shift
        if (mm[a1] !== undefined) mm[a1] += shift
        if (axis === 'y' && mm.face !== undefined) mm.face += shift
        if (mm.cuts) mm.cuts = mm.cuts.map((ct) => ({ ...ct, [a0]: ct[a0] + shift, [a1]: ct[a1] + shift }))
      } else if (!mBeyond(m) && mLo(m) < Lb - tol && mHi(m) > Lb + tol && inLane(m, laneB[0], laneB[1]) && movedB.some((r) => inLane(m, r.c0, r.c1) && (outward > 0 ? Math.abs(r.hi - mHi(m)) < 0.75 : Math.abs(r.lo - mLo(m)) < 0.75))) {
        // the wall moved inside the mass, and the rooms at the mass's far edge moved with it: the mass stretches
        if (outward > 0) mm[a1] += db
        else mm[a0] -= db
      } else if (m.id?.endsWith('Porch') && mBeyond(m) && inLane(m, laneB[0], laneB[1])) {
        if (outward > 0) mm[a0] += db
        else mm[a1] -= db
      }
      return mm
    })
    roof.faces = roofSurfaces(roof.masses, k, c0, off)
    roof.dormers = dormerWalls(roof.masses, k, c0, off)
  }
  settleDoors(flat, kit)
  return true
}

/** Interior doors stay within the wall their two rooms share: a door past the end of a wall that got
 * shorter slides back onto it, and a pair door wider than the wall becomes a single. In place. */
export function settleDoors(flat, kit) {
  const rooms = flat.filter((r) => isRoom(r) && !r.open)
  const at = (x, y) => rooms.find((r) => x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.d)
  flat.filter((e) => e.kind === 'door' && !e.exterior && !e.cased).forEach((e) => {
    const host = rooms.find((r) => r.id === e.room)
    if (!host) return
    const cx = e.x + e.w / 2
    const cy = e.y + e.d / 2
    const a = e.axis === 'h' ? at(cx, cy - 0.7) : at(cx - 0.7, cy)
    const b = e.axis === 'h' ? at(cx, cy + 0.7) : at(cx + 0.7, cy)
    const across = [a, b].find((r) => r && r !== host) || rooms.find((r) => r !== host && (e.axis === 'h' ? Math.abs(r.y - cy) < 0.6 || Math.abs(r.y + r.d - cy) < 0.6 : Math.abs(r.x - cx) < 0.6 || Math.abs(r.x + r.w - cx) < 0.6) && (e.axis === 'h' ? Math.min(r.x + r.w, host.x + host.w) - Math.max(r.x, host.x) : Math.min(r.y + r.d, host.y + host.d) - Math.max(r.y, host.y)) > 1)
    if (!across) return
    const ax = e.axis === 'h' ? 'x' : 'y'
    const sz = e.axis === 'h' ? 'w' : 'd'
    const run0 = Math.max(host[ax], across[ax])
    const run1 = Math.min(host[ax] + host[sz], across[ax] + across[sz])
    const run = run1 - run0
    if (run < 2.5) return
    if (e.span > run - 0.5) {
      const spec = kit.doors[e.size] || kit.doors.interior
      const span = Math.min(spec.pair ? spec.w / 12 : spec.w / 12, (kit.doors.interior?.w || 32) / 12)
      if (e.pair || span < e.span) {
        e.pair = false
        e.span = span
        e[sz] = span
      }
    }
    if (e[ax] < run0 + 0.25 || e[ax] + e[sz] > run1 - 0.25) e[ax] = Math.min(Math.max(e[ax], run0 + 0.3), run1 - 0.3 - e[sz])
  })
}

/** Kitchen islands keep 42" aisles: an island too close to a counter or wall shrinks away from it. */
export function settleIslands(flat, need = 3.5) {
  const kitchens = flat.filter((r) => isRoom(r) && r.kind === 'kitchen')
  kitchens.forEach((k) => {
    const fx = flat.filter((e) => e.kind === 'fixture' && e.room === k.id)
    const counters = fx.filter((f) => ['counter', 'fridge', 'range', 'sink'].includes(f.fixture))
    // counters and appliances stay against their walls when the room moved under them
    fx.filter((f) => f.fixture !== 'island').forEach((f) => {
      if (f.x - k.x < 1 && f.x - k.x > -1) f.x = k.x
      if (k.x + k.w - (f.x + f.w) < 1 && k.x + k.w - (f.x + f.w) > -1) f.x = k.x + k.w - f.w
      if (f.y - k.y < 1 && f.y - k.y > -1) f.y = k.y
      if (k.y + k.d - (f.y + f.d) < 1 && k.y + k.d - (f.y + f.d) > -1) f.y = k.y + k.d - f.d
    })
    fx.filter((f) => f.fixture === 'island').forEach((isl) => {
      // a peninsula (an island drawn against a wall) stays against it
      if (isl.x - k.x < 1 && isl.x - k.x > -1) isl.x = k.x
      if (k.x + k.w - (isl.x + isl.w) < 1 && k.x + k.w - (isl.x + isl.w) > -1) isl.x = k.x + k.w - isl.w
      for (let pass = 0; pass < 3; pass++) {
        const facing = (side) => counters.filter((c) => (side === 'w' || side === 'e' ? Math.min(c.y + c.d, isl.y + isl.d) - Math.max(c.y, isl.y) > 0.5 : Math.min(c.x + c.w, isl.x + isl.w) - Math.max(c.x, isl.x) > 0.5))
        const gap = {
          w: isl.x - k.x < 0.5 ? Infinity : Math.min(isl.x - k.x, ...facing('w').map((c) => isl.x - (c.x + c.w)).filter((v) => v >= -0.01)),
          e: k.x + k.w - (isl.x + isl.w) < 0.5 ? Infinity : Math.min(k.x + k.w - (isl.x + isl.w), ...facing('e').map((c) => c.x - (isl.x + isl.w)).filter((v) => v >= -0.01)),
          n: isl.y - k.y < 0.5 ? Infinity : Math.min(isl.y - k.y, ...facing('n').map((c) => isl.y - (c.y + c.d)).filter((v) => v >= -0.01)),
          s: k.y + k.d - (isl.y + isl.d) < 0.5 ? Infinity : Math.min(k.y + k.d - (isl.y + isl.d), ...facing('s').map((c) => c.y - (isl.y + isl.d)).filter((v) => v >= -0.01)),
        }
        let changed = false
        if (gap.e < need) {
          isl.w = Math.max(2, isl.w - (need - gap.e))
          changed = true
        }
        if (gap.w < need) {
          const cut = Math.min(need - gap.w, isl.w - 2)
          isl.x += cut
          isl.w -= cut
          changed = true
        }
        if (gap.s < need) {
          isl.d = Math.max(2, isl.d - (need - gap.s))
          changed = true
        }
        if (gap.n < need) {
          const cut = Math.min(need - gap.n, isl.d - 2)
          isl.y += cut
          isl.d -= cut
          changed = true
        }
        if (!changed) break
      }
    })
  })
}

/**
 * The kitchen work triangle stays 26 ft or less with legs of 4 to 9 ft: the range and the fridge
 * slide along their runs (the sink stays on its plumbing) until every leg is in range.
 */
export function settleKitchen(flat, { maxLeg = 9, minLeg = 4, maxTotal = 26 } = {}) {
  flat.filter((r) => isRoom(r) && r.kind === 'kitchen').forEach((k) => {
    const fx = flat.filter((e) => e.kind === 'fixture' && e.room === k.id)
    const pick = (kind) => fx.find((f) => f.fixture === kind)
    const sink = pick('sink')
    const range = pick('range')
    const fridge = pick('fridge')
    if (!sink || !range || !fridge) return
    const c = (f) => [f.x + f.w / 2, f.y + f.d / 2]
    const dist = (a, b) => Math.hypot(c(a)[0] - c(b)[0], c(a)[1] - c(b)[1])
    const legs = () => [dist(sink, range), dist(range, fridge), dist(fridge, sink)]
    const bad = (L) => Math.max(0, Math.max(...L) - maxLeg) + Math.max(0, minLeg - Math.min(...L)) + Math.max(0, L.reduce((a, b) => a + b, 0) - maxTotal)
    // a fixture slides along the wall it sits on, never into the 30" in front of a door on that wall
    const runAxis = (f) => (Math.abs(f.x - k.x) < 0.6 || Math.abs(f.x + f.w - (k.x + k.w)) < 0.6 ? 'y' : 'x')
    const approach = 2.5
    const fronts = flat.filter((e) => e.kind === 'door' && e.size !== 'overhead' && e.size !== 'overheadSingle').map((d) => {
      const span = d.span || Math.max(d.w, d.d)
      if (d.axis === 'h') {
        const wall = d.y + d.d / 2
        if (Math.abs(wall - k.y) < 0.6) return { x: d.x, y: k.y, w: span, d: approach }
        if (Math.abs(wall - (k.y + k.d)) < 0.6) return { x: d.x, y: k.y + k.d - approach, w: span, d: approach }
      } else {
        const wall = d.x + d.w / 2
        if (Math.abs(wall - k.x) < 0.6) return { x: k.x, y: d.y, w: approach, d: span }
        if (Math.abs(wall - (k.x + k.w)) < 0.6) return { x: k.x + k.w - approach, y: d.y, w: approach, d: span }
      }
      return null
    }).filter(Boolean)
    const inFront = (f) => fronts.some((a) => Math.min(a.x + a.w, f.x + f.w) - Math.max(a.x, f.x) > 0.1 && Math.min(a.y + a.d, f.y + f.d) - Math.max(a.y, f.y) > 0.1)
    for (let i = 0; i < 80 && bad(legs()) > 0.001; i++) {
      let best = null
      for (const f of [range, fridge]) {
        for (const axis of [runAxis(f), runAxis(f) === 'x' ? 'y' : 'x']) for (const dir of [-0.25, 0.25]) {
          const before = { x: f.x, y: f.y }
          f[axis] += dir
          f.x = Math.min(Math.max(f.x, k.x), k.x + k.w - f.w)
          f.y = Math.min(Math.max(f.y, k.y), k.y + k.d - f.d)
          const clash = inFront(f) || fx.some((o) => o !== f && o.fixture !== 'counter' && Math.min(o.x + o.w, f.x + f.w) - Math.max(o.x, f.x) > 0.3 && Math.min(o.y + o.d, f.y + f.d) - Math.max(o.y, f.y) > 0.3)
          const score = clash ? Infinity : bad(legs())
          if (!best || score < best.score) best = { f, pos: { x: f.x, y: f.y }, score }
          Object.assign(f, before)
        }
      }
      if (!best || best.score >= bad(legs()) - 1e-9) break
      Object.assign(best.f, best.pos)
    }
  })
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
      let r = rs[o.room]
      const w = q(o.w)
      const d = q(o.d)
      const was = { w: r.w, d: r.d }
      // what the audit already flags: a push may not add to it
      const auditKeys = (list) => new Set(auditPlan(list, { stories, sqft: 0 }, kit, lot).errors.filter((f) => f.id !== 'area').map((f) => `${f.id}:${f.room || ''}`))
      const flagged = auditKeys(flat)
      // the wall that moves: when growing, the side with the least house beyond it (an outside wall
      // if there is one); when shrinking, the side with the most, so the house closes up
      const solid = flat.filter((x) => isRoom(x) && !x.open && x !== r)
      const beyondArea = (side) => solid.filter((x) => (side === 'e' ? x.x >= r.x + r.w - 0.3 : side === 'w' ? x.x + x.w <= r.x + 0.3 : side === 's' ? x.y >= r.y + r.d - 0.3 : x.y + x.d <= r.y + 0.3)).reduce((s2, x) => s2 + x.w * x.d, 0)
      const pick = (a, b) => (beyondArea(a) <= beyondArea(b) ? a : b)
      const area = w * d
      const failed = []
      for (const [axisKey, a, b] of [['w', 'e', 'w'], ['d', 's', 'n']]) {
        // a "bigger"/"smaller" request (soft) with no sizes stated: an axis that cannot move hands its share to the other
        const target = o.soft && failed.length ? q(area / r[axisKey === 'w' ? 'd' : 'w']) : axisKey === 'w' ? w : d
        const delta = target - r[axisKey]
        if (Math.abs(delta) <= 0.01) continue
        const first = pick(a, b)
        const attempt = (side) => {
          const snap = flat.map((e) => ({ ...e, ...(e.masses ? { masses: e.masses.map((m) => ({ ...m })) } : {}) }))
          const out = pushWall(flat, r.id, side, delta, kit)
          if (typeof out === 'string') return out
          const undo = (why) => {
            flat.length = 0
            snap.forEach((e) => flat.push(e))
            return why
          }
          const outside = flat.find((x) => isRoom(x) && !x.open && !insideSetbacks(x, centre, lot))
          if (outside) return undo(`${outside.name} would cross the setback`)
          // nothing may land on another room or on a porch
          const all = flat.filter(isRoom)
          for (const a of all) for (const b of all) {
            if (a === b || (a.open && b.open) || intrusion(a, b) <= 0.6) continue
            return undo(`${a.name} would run into the ${b.name.toLowerCase()}`)
          }
          // and the architect's checks must still pass: a push that breaks one is undone, the other side tried
          settleIslands(flat)
          settleKitchen(flat)
          const broke = auditPlan(flat, { stories, sqft: 0 }, kit, lot).errors.find((f) => f.id !== 'area' && !flagged.has(`${f.id}:${f.room || ''}`))
          if (broke) return undo(broke.message.replace(/\.$/, ''))
          return true
        }
        let res = attempt(first)
        if (typeof res === 'string') res = attempt(first === a ? b : a)
        if (typeof res === 'string') {
          if (o.soft && !failed.length) {
            failed.push(res)
            continue
          }
          throw new Error(`${r.name} cannot grow that way: ${failed[0] || res}`)
        }
      }
      r = flat.find((x) => x.id === o.room) // the room object may have been replaced by an undo
      // fixtures inside the room stay inside it
      flat.forEach((e) => {
        if (e.kind !== 'fixture' || e.room !== r.id) return
        e.x = Math.min(Math.max(e.x, r.x), r.x + r.w - e.w)
        e.y = Math.min(Math.max(e.y, r.y), r.y + r.d - e.d)
      })
      settleIslands(flat)
      settleKitchen(flat)
      did.push(`${r.name} is now ${q(r.w)}' by ${q(r.d)}' (was ${was.w}' by ${was.d}')`)
      // a garage is named by its cars, and its overhead doors are laid out again for the bays
      if (r.kind === 'garage' && kit.rooms.garage?.perCar) {
        const cars = Math.max(1, Math.round(Math.max(r.w, r.d) / kit.rooms.garage.perCar))
        if (/-Car Garage$/.test(r.name)) r.name = `${cars}-Car Garage`
        const side = garageFacing(r, flat) || 's'
        for (let i = flat.length - 1; i >= 0; i--) if (flat[i].kind === 'door' && flat[i].room === r.id && (flat[i].size === 'overhead' || flat[i].size === 'overheadSingle')) flat.splice(i, 1)
        flat.push(...overheadDoors(kit, r, cars, side))
      }
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
      removeRoom(flat, r.id, kit)
      did.push(`Removed ${r.name.toLowerCase()}`)
    } else if (o.op === 'garage') {
      // the garage comes off and goes back on for the cars asked, with its doors laid out by bay; a plan
      // that draws its own garage (the narrow one) resizes it in place instead
      const g = flat.find((r) => isRoom(r) && r.kind === 'garage')
      if (!g) throw new Error('there is no garage in this plan; say "add a garage"')
      const cars = Math.max(1, Math.round(o.cars || 2))
      const drawn = flat.find((r) => r.kind === 'roof')?.plan === 'narrow'
      if (drawn) {
        const w = Math.max(kit.rooms.garage.perCar * cars, cars >= 3 ? 32 : 0)
        const res = pushWall(flat, g.id, 'e', w - g.w, kit)
        if (typeof res === 'string') throw new Error(`${g.name} cannot grow that way: ${res}`)
        const after = flat.find((r) => r.id === g.id)
        after.name = `${cars}-Car Garage`
        for (let i = flat.length - 1; i >= 0; i--) if (flat[i].kind === 'door' && flat[i].room === g.id && /overhead/.test(flat[i].size || '')) flat.splice(i, 1)
        flat.push(...overheadDoors(kit, after, cars, garageFacing(after, flat) || 's'))
      } else {
        removeRoom(flat, g.id)
        const placed = attachGarage(placeLocal(flat.filter((r) => r.kind !== 'roof'), stories, kit, centre, L).concat(flat.filter((r) => r.kind === 'roof')), kit, cars, L, stories, { prefer: o.load || null, tandem: !!o.tandem })
        if (!placed.some((r) => isRoom(r) && r.kind === 'garage')) throw new Error(`there is no sound spot for a ${cars}-car${o.tandem ? ' tandem' : ''}${o.load ? ` ${o.load}-load` : ''} garage on this lot`)
        flat.length = 0
        placed.forEach((r) => flat.push(r))
      }
      const made = flat.find((r) => isRoom(r) && r.kind === 'garage')
      did.push(`${cars}-car garage${made.tandem ? ' (tandem)' : ''}${o.load ? `, ${o.load}-load` : ''}, ${q(made.w)}' wide`)
    } else if (o.op === 'scale') {
      // the whole house to a living area, within this plan's range; the service rooms keep their size on the way down
      const lim = kit.limits?.sqft || [1400, 6000]
      const sqft = Math.round(o.sqft)
      if (sqft < lim[0] || sqft > lim[1]) throw new Error(`this plan draws ${lim[0].toLocaleString()} to ${lim[1].toLocaleString()} sf; ${sqft.toLocaleString()} is outside that`)
      const areaOf = (list) => list.filter((r) => isRoom(r) && isConditioned(r)).reduce((a, r) => a + r.w * r.d, 0) * stories
      const base = areaOf(flat)
      // within 1% of where it is: nothing to scale (a re-scale of a plan the fit already trimmed only snaps walls)
      if (Math.abs(sqft - base) / base < 0.01) throw new Error(`the house is already about ${Math.round(base).toLocaleString()} sf`)
      // the search scales the rooms alone (the roof's surfaces are costly to rebuild); the plan scales once at the end
      const planId = planIdOf(flat)
      const at = (k) => {
        const copy = flat.filter(isRoom).map((r) => ({ ...r }))
        scalePlan(copy, k, centre[0], centre[1], kit, planId)
        return areaOf(copy)
      }
      let lo = sqft < base ? 0.5 : 1
      let hi = sqft < base ? 1 : 1.8
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2
        if (at(mid) >= sqft) hi = mid
        else lo = mid
      }
      const k = Math.round(hi * 1000) / 1000
      scalePlan(flat, k, centre[0], centre[1], kit)
      settleIslands(flat)
      settleKitchen(flat)
      const got = Math.round(areaOf(flat))
      if (Math.abs(got - sqft) / sqft > 0.05) throw new Error(`the smallest this plan goes with these rooms is about ${Math.round(got / 50) * 50} sf`)
      did.push(`${got.toLocaleString()} sf of living area (was ${Math.round(base).toLocaleString()})`)
    } else if (o.op === 'swap') {
      // two rooms trade places: each takes the other's rectangle, doors and windows (its walls stay), and gets
      // fixtures laid for its kind; the rules and the audit then judge the result (a dining room needs a window)
      const a = rs[o.room]
      const b = rs[o.target]
      if (a === b) throw new Error('that is the same room twice')
      if (a.open !== b.open) throw new Error(`a porch and a room cannot trade places`)
      const keep = ['kind', 'name', 'zone', 'plumbing', 'fill', 'h', 'vaulted']
      const ta = Object.fromEntries(keep.map((k) => [k, a[k]]))
      const tb = Object.fromEntries(keep.map((k) => [k, b[k]]))
      keep.forEach((k) => {
        if (k in tb) a[k] = tb[k]
        else delete a[k]
        if (k in ta) b[k] = ta[k]
        else delete b[k]
      })
      // each rectangle keeps its id, its doors, windows and openings; the furniture is laid for what it now is
      for (let i = flat.length - 1; i >= 0; i--) if (flat[i].kind === 'fixture' && (flat[i].room === a.id || flat[i].room === b.id)) flat.splice(i, 1)
      for (const r of [a, b]) fixturesFor(r.kind, r, doorsOf(flat, r)).forEach((f) => flat.push(f))
      did.push(`Swapped the ${ta.name.toLowerCase()} and the ${tb.name.toLowerCase()}`)
    } else if (o.op === 'moveBeside') {
      const r = rs[o.room]
      const t = rs[o.target]
      const made = moveBeside(flat, kit, r.id, t.id)
      if (!made) throw new Error(`there is no sound spot for the ${r.name.toLowerCase()} against the ${t.name.toLowerCase()}${['garage', 'bed', 'master', 'suite2', 'bath', 'mbath', 'jackjill', 'halfbath', 'wic', 'mwic'].includes(t.kind) ? `: it would only open into the ${t.name.toLowerCase()}, and it needs a door from the house` : ''}`)
      did.push(`Moved ${r.name.toLowerCase()} next to the ${t.name.toLowerCase()}`)
    } else if (o.op === 'add') {
      const t = kit.rooms[o.kind]
      const n = flat.filter((r) => r.kind === o.kind).length + 1
      const name = o.name || (['bed', 'bath'].includes(o.kind) ? `${t.name} ${n}` : n > 1 ? `${t.name} ${n}` : t.name)
      const w = q(o.w || t.w)
      const d = q(o.d || t.d)
      const near = o.near ? rs[o.near] : null
      const id = o.id || `${o.kind}-${n}-${Date.now().toString(36).slice(-4)}`
      let room = null
      if (o.kind === 'rearPorch' || o.kind === 'frontPorch') {
        room = addPorch(flat, kit, o.kind === 'rearPorch' ? 'rear' : 'front')
        if (!room) throw new Error(flat.some((r) => isRoom(r) && r.kind === o.kind) ? `the plan already has a ${t.name.toLowerCase()}` : `there is no free wall for a ${t.name.toLowerCase()}`)
      } else if (o.kind === 'garage') {
        if (flat.some((r) => isRoom(r) && r.kind === 'garage')) throw new Error('the plan already has a garage')
        const cars = o.w ? Math.max(1, Math.round(o.w / (kit.rooms.garage.perCar || 11))) : 2
        const placed = attachGarage(placeLocal(flat.filter((r) => r.kind !== 'roof'), stories, kit, centre, L).concat(flat.filter((r) => r.kind === 'roof')), kit, cars, L, stories)
        room = placed.find((r) => r.id === 'garage')
        if (!room) throw new Error('there is no free wall at the laundry for a garage')
        flat.length = 0
        placed.forEach((r) => flat.push(r))
      } else if (near && !['bed'].includes(o.kind)) {
        room = attachBeside(flat, kit, { kind: o.kind, name, id, w, d, target: near.id, door: ['bath', 'halfbath', 'jackjill'].includes(o.kind) ? 'bath' : 'interior' })
        if (!room && ['bath', 'office'].includes(o.kind)) room = addInWing(flat, kit, o.kind)
      } else if (['bed', 'bath', 'office'].includes(o.kind)) {
        room = addInWing(flat, kit, o.kind, { side: o.side || null })
        if (!room && near) room = attachBeside(flat, kit, { kind: o.kind, name, id, w, d, target: near.id })
      } else {
        // anything else attaches to the room it belongs with: a hall, the kitchen, the laundry
        const hosts = (o.kind === 'pantry' ? ['kitchen'] : o.kind === 'halfbath' ? ['laundry', 'mud', 'foyer', 'hall'] : o.kind === 'laundry' || o.kind === 'mud' ? ['garage', 'kitchen', 'hall'] : ['hall', 'foyer', 'living']).map((k) => flat.find((r) => isRoom(r) && r.kind === k)).filter(Boolean)
        for (const h of hosts) {
          room = attachBeside(flat, kit, { kind: o.kind, name, id, w, d, target: h.id, door: ['bath', 'halfbath', 'jackjill'].includes(o.kind) ? 'bath' : 'interior' })
          if (room) break
        }
      }
      if (!room) throw new Error(`there is no sound spot for ${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name.toLowerCase()}`)
      did.push(`Added ${room.name.toLowerCase()}, ${q(room.w)}' by ${q(room.d)}' (${Math.round(room.w * room.d).toLocaleString()} sf)${near ? ` next to the ${near.name.toLowerCase()}` : room.kind === 'bed' || room.kind === 'bath' || room.kind === 'office' ? ' off the hallway' : ''}`)
    }
  })

  // roof follows the rooms that remain
  const roof = flat.find((r) => r.kind === 'roof')
  if (roof && kit.plan?.roof) {
    const ids = new Set(flat.filter(isRoom).map((r) => r.id))
    const masses = (roof.masses || kit.plan.roof).filter((m) => !m.id || ids.has(m.id) || !kit.plan.rooms.some((r) => r.id === m.id)).filter((m) => !(m.id === 'leftwing' && !ids.has('suite2'))).filter((m) => !(m.id && m.id.startsWith('awning-') && kit.plan.rooms.some((r) => r.id === m.id.slice(7)) && !ids.has(m.id.slice(7))))
    roof.masses = masses
    roof.faces = roofSurfaces(masses, roof.scale || 1, roof.centre || centre, roof.offset || [0, 0])
    roof.dormers = dormerWalls(masses, roof.scale || 1, roof.centre || centre, roof.offset || [0, 0])
  }
  let placed = placeLocal(flat.filter((r) => r.kind !== 'roof'), stories, kit, centre, L)
  if (roof) placed.push(roof)
  // a change that pushed the house past a setback: the house slides on the lot when a shift alone fits it
  if (ops.some((o) => o.op === 'add' || o.op === 'garage' || o.op === 'scale') && flat.some((x) => isRoom(x) && !x.open && !insideSetbacks(x, centre, lot))) {
    const refit = fitToLot(placed, kit, stories, lot, { minScale: 1 })
    if (refit.scale === 1 && (refit.shift[0] || refit.shift[1])) {
      placed = refit.rooms
      const [dx, dy] = refit.shift
      did.push(`The house moved ${Math.abs(dx) >= Math.abs(dy) ? `${Math.abs(dx)}' ${dx > 0 ? 'east' : 'west'}` : `${Math.abs(dy)}' ${dy > 0 ? 'toward the street' : 'toward the back'}`} on the lot to stay inside the setbacks`)
    }
  }
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
  const roomsOnly = rooms.filter(isRoom)
  // every room kind the text names, in the order the text names them
  const hits = KINDS.map(([k, re]) => {
    const m = re.exec(t)
    return m ? { k, re, at: m.index, end: m.index + m[0].length } : null
  })
    .filter(Boolean)
    .sort((a, b) => a.at - b.at || b.end - b.at - (a.end - a.at))
    // "half bath" is one room, not a half bath and a bath
    .filter((h, i, all) => !all.slice(0, i).some((o) => o.at <= h.at && h.end <= o.end))
  const hit = hits[0] ? [hits[0].k, hits[0].re] : null
  const kind = hit?.[0]
  const rest = hit ? t.replace(hit[1], ' ') : t // so "half bath next to the laundry" finds the laundry, not the bath
  // a room called by name ("bedroom 2", "bath 1") is the one meant
  const named = roomsOnly
    .filter((r) => r.name && t.includes(r.name.toLowerCase()))
    .map((r) => ({ r, at: t.indexOf(r.name.toLowerCase()) }))
    .filter((n) => !hit || n.at <= hits[0].at + 1)
    .sort((a, b) => a.at - b.at || b.r.name.length - a.r.name.length)[0]?.r
  const targets = named ? [named] : roomsOnly.filter((r) => r.kind === kind)
  const feet = t.match(/(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')/)
  const by = feet ? +feet[1] : null

  // "make the house 3,000 sf", "I want about 2,400 square feet": the whole plan scales
  const sqftSaid = t.match(/(\d[\d,]*(?:\.\d+)?)\s*(?:k\b)?\s*(?:sq\.? ?ft\.?|square feet|square foot|sf\b|sqft)/)
  if (sqftSaid && (!kind || /\b(house|home|plan|whole|total|overall|living area)\b/.test(t))) {
    let n = +sqftSaid[1].replace(/,/g, '')
    if (/\d\s*k\b/.test(sqftSaid[0])) n *= 1000
    return { ops: [{ op: 'scale', sqft: n }], reply: `Sizing the house to about ${Math.round(n).toLocaleString()} square feet.`, confidence: 0.7 }
  }
  // "swap the office and the dining room", "switch the laundry with the pantry"
  if (/\b(swap|switch|exchange|trade places?)\b/.test(t)) {
    // rooms called by name first ("bedroom 1 and bedroom 2"), else the two kinds named
    const byName = roomsOnly.filter((r) => r.name && t.includes(r.name.toLowerCase())).map((r) => ({ r, at: t.indexOf(r.name.toLowerCase()) })).sort((p, q) => p.at - q.at || q.r.name.length - p.r.name.length).filter((n, i, all) => !all.slice(0, i).some((o) => o.at === n.at)).map((n) => n.r)
    const pair = byName.length >= 2 ? byName.slice(0, 2) : hits.length >= 2 ? [roomsOnly.find((r) => r.kind === hits[0].k), roomsOnly.find((r) => r.kind === hits[1].k)] : null
    if (pair) {
      const [a, b] = pair
      if (!a || !b) return { ops: [], reply: `There is no ${kit.rooms[!a ? hits[0].k : hits[1].k]?.name.toLowerCase() || 'such room'} in this plan to swap.`, confidence: 0.5 }
      return { ops: [{ op: 'swap', room: a.id, target: b.id }], reply: `Swapping the ${a.name.toLowerCase()} and the ${b.name.toLowerCase()}.`, confidence: 0.7 }
    }
    return { ops: [], reply: 'Which two rooms should trade places? Say it like "swap the office and the dining room".', confidence: 0.4 }
  }
  if (!kind) return { ops: [], reply: 'I did not catch which room you mean. Try "make the kitchen bigger", "add an office", "make the house 2,400 sf", or "swap the office and the dining room".', confidence: 0.2 }
  if (kind === 'porch') return { ops: [], reply: 'Front porch or back porch?', confidence: 0.3 }
  // "make the garage 3 cars", "three-car garage"
  const cars = t.match(/(\d+|one|two|three|four)[- ]?cars?\b/)
  const load = /\bside[- ]?(load|entry|loading)\b|\bfrom the side\b/.test(t) ? 'side' : /\bfront[- ]?(load|entry|loading)\b|\bfrom the (street|front)\b/.test(t) ? 'front' : null
  const tandem = /\btandem\b/.test(t)
  if (kind === 'garage' && (load || tandem) && targets.length && !add && !remove) {
    const n = cars ? WORDS[cars[1]] || +cars[1] : tandem ? 3 : Math.max(1, Math.round(Math.max(targets[0].w, targets[0].d) / kit.rooms.garage.perCar))
    return { ops: [{ op: 'garage', cars: n, ...(load ? { load } : {}), ...(tandem ? { tandem: true } : {}) }], reply: `Making the garage ${n} cars${tandem ? ' with a tandem bay' : ''}${load ? `, ${load}-load` : ''}.`, confidence: 0.7 }
  }
  if (kind === 'garage' && cars && !add && !remove) {
    const n = WORDS[cars[1]] || +cars[1]
    if (!targets.length) return { ops: [{ op: 'add', kind: 'garage', name: `${n}-Car Garage`, w: kit.rooms.garage.perCar * n, d: kit.rooms.garage.d, near: roomsOnly.find((r) => r.kind === 'laundry' || r.kind === 'mud')?.id }], reply: `Adding a ${n}-car garage.`, confidence: 0.7 }
    const g = targets[targets.length - 1]
    return { ops: [{ op: 'garage', cars: n }], reply: `Making the garage ${n} cars, ${Math.max(kit.rooms.garage.perCar * n, n >= 3 ? 32 : 0)} feet wide.`, confidence: 0.75 }
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
    const nearKind = (hits.find((h) => h.k !== kind && h.k !== 'porch') || {}).k
    const target = nearKind ? roomsOnly.find((r) => r.kind === nearKind) : null
    if (!target) return { ops: [], reply: `Next to which room? There is no ${nearKind ? kit.rooms[nearKind]?.name.toLowerCase() || nearKind : 'room by that name'} in this plan.`, confidence: 0.4 }
    const r = targets[targets.length - 1]
    const { rooms: flat } = withPlanCoords(rooms, kit)
    const a = flat.find((x) => x.id === r.id)
    const b = flat.find((x) => x.id === target.id)
    const touching = a && b && ((Math.min(a.y + a.d, b.y + b.d) - Math.max(a.y, b.y) > 0.5 && (Math.abs(a.x - (b.x + b.w)) < 0.6 || Math.abs(b.x - (a.x + a.w)) < 0.6)) || (Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.5 && (Math.abs(a.y - (b.y + b.d)) < 0.6 || Math.abs(b.y - (a.y + a.d)) < 0.6)))
    if (touching) return { ops: [], reply: `The ${r.name.toLowerCase()} is already next to the ${target.name.toLowerCase()}.`, confidence: 0.6 }
    return { ops: [{ op: 'moveBeside', room: r.id, target: target.id }], reply: `Moving the ${r.name.toLowerCase()} next to the ${target.name.toLowerCase()}.`, confidence: 0.7 }
  }
  if (add) {
    if (!kit.rooms[kind]) return { ops: [], reply: `The ${kit.name} kit does not have that room yet.`, confidence: 0.4 }
    const nearKind = (hits.find((h) => h.k !== kind && h.k !== 'porch') || {}).k
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
    const ops = targets.map((r) => ({ op: 'resize', room: r.id, w: by && wider ? r.w + sign * by : deeper ? r.w : by && !deeper ? r.w + sign * by : q(r.w * f), d: by && deeper ? r.d + sign * by : wider ? r.d : by ? r.d + sign * by : q(r.d * f), ...(by || wider || deeper ? {} : { soft: true }) }))
    const how = by ? `${by} feet ${wider ? 'wider' : deeper ? 'deeper' : grow ? 'bigger each way' : 'smaller each way'}` : `about ${Math.round(Math.abs(f - 1) * 100)} percent ${grow ? 'bigger' : 'smaller'}`
    return { ops, reply: `${grow ? 'Making' : 'Making'} the ${last.name.toLowerCase()} ${how}.`, confidence: 0.7 }
  }
  return { ops: [], reply: 'Tell me what to do with that room: bigger, smaller, add one, or remove it.', confidence: 0.3 }
}

/** Compact room list for the interpreter prompt. */
export function summarizeRooms(rooms) {
  return rooms.filter(isRoom).map((r) => ({ id: r.id, kind: r.kind, name: r.name, w: r.w, d: r.d, x: q(r.x ?? 0), y: q(r.y ?? 0), open: !!r.open }))
}

export { FIXTURE_H, FIXTURE_NAME }
