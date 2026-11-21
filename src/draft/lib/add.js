// Adding rooms the way a drafter would: a bedroom, bath or office slots into the bedroom wing off
// the hallway; a porch goes on the rear (or front) wall of the public rooms, 8 ft deep at least;
// anything "next to" a room attaches to that room's outside wall with a door from it, a window on
// the outside, its fixtures, and a roof mass that ties in. Plan feet, on the flat (plan-coordinate)
// room list, in place. Each helper returns the room it made, or null when there is no sound spot.
import { isRoom, doorEl, windowEl, extendWing } from './layout.js'
import { roofSurfaces, dormerWalls } from './roof.js'
import { FIXTURE_H, FIXTURE_NAME } from '../../kits/modern-farmhouse.js'

const HABITABLE = ['bed', 'master', 'suite2', 'kitchen', 'living', 'dining', 'office']
const PRIVATE = ['bed', 'master', 'suite2', 'bath', 'mbath', 'jackjill', 'halfbath', 'wic', 'mwic', 'garage']
const overlap1 = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0)
const intrudes = (a, b, tol = 0.5) => overlap1(a.x, a.x + a.w, b.x, b.x + b.w) > tol && overlap1(a.y, a.y + a.d, b.y, b.y + b.d) > tol

/**
 * Fixtures a new room of this kind gets, laid out inside it and clear of its doors: the layout is drawn
 * with the door in mind, then mirrored across the room (left-right, front-back, both) until no piece
 * sits under a door's swing or in the 30" in front of it.
 */
export function fixturesFor(kind, room, doors = []) {
  const base = fixturesLayout(kind, room)
  if (!doors.length || !base.length) return base
  const flipFace = { e: 'w', w: 'e', n: 's', s: 'n' }
  const mirror = (list, fx, fy) => list.map((f) => ({
    ...f,
    x: fx ? room.x + room.w - (f.x - room.x) - f.w : f.x,
    y: fy ? room.y + room.d - (f.y - room.y) - f.d : f.y,
    ...(f.face && ((fx && (f.face === 'e' || f.face === 'w')) || (fy && (f.face === 'n' || f.face === 's'))) ? { face: flipFace[f.face] } : {}),
    ...(f.head && ((fx && (f.head === 'e' || f.head === 'w')) || (fy && (f.head === 'n' || f.head === 's'))) ? { head: flipFace[f.head] } : {}),
  }))
  // the no-go zones: a square the leaf sweeps and the 30" strip, on this room's side of each door
  const zones = doors.flatMap((d) => {
    const span = d.span || Math.max(d.w, d.d)
    const reach = Math.max(span, 2.5)
    if (d.axis === 'h') {
      const wall = d.y + d.d / 2
      const inRoomBelow = wall < room.y + room.d / 2 // the door is on the room's rear (low y) wall
      return [{ x: d.x - 0.2, y: inRoomBelow ? wall : wall - reach, w: span + 0.4, d: reach }]
    }
    const wall = d.x + d.w / 2
    const onWest = wall < room.x + room.w / 2
    return [{ x: onWest ? wall : wall - reach, y: d.y - 0.2, w: reach, d: span + 0.4 }]
  })
  const clear = (list) => list.every((f) => !zones.some((z) => overlap1(f.x, f.x + f.w, z.x, z.x + z.w) > 0.05 && overlap1(f.y, f.y + f.d, z.y, z.y + z.d) > 0.05))
  for (const [fx, fy] of [[false, false], [true, false], [false, true], [true, true]]) {
    const list = mirror(base, fx, fy)
    if (clear(list)) return list
  }
  return base
}
function fixturesLayout(kind, room) {
  const fx = (k, x, y, w, d, extra = {}) => ({ id: `fx-${room.id}-${k}`, kind: 'fixture', fixture: k, element: true, open: true, name: FIXTURE_NAME[k] || k, room: room.id, x, y, w, d, h: FIXTURE_H[k] || 2, ...extra })
  const { x, y, w, d } = room
  if (kind === 'bath' || kind === 'jackjill') {
    const along = w >= d
    return along
      ? [fx('shower', x + 0.3, y + 0.3, 3, Math.min(5.4, d - 0.6)), fx('toilet', x + 4.5, y + 0.3, 2.3, 1.5, { face: 's' }), fx('vanity', x + Math.max(8, w - 3.8), y + 0.3, Math.min(3.5, w - 8.3), 2, { face: 's' })]
      : [fx('shower', x + 0.3, y + 0.3, Math.min(5.4, w - 0.6), 3), fx('toilet', x + 0.3, y + 4.5, 1.5, 2.3, { face: 'e' }), fx('vanity', x + 0.3, y + Math.max(8, d - 3.8), 2, Math.min(3.5, d - 8.3), { face: 'e' })]
  }
  if (kind === 'halfbath') {
    // a narrow half bath: the toilet at one end facing down the room, the sink at the other
    if (w < 4.5 && d >= w) return [fx('toilet', x + (w - 1.5) / 2, y + 0.3, 1.5, 2.3, { face: 's' }), fx('vanity', x + (w - 2) / 2, y + d - 2.3, 2, 2, { face: 'n' })]
    if (d < 4.5) return [fx('toilet', x + 0.3, y + (d - 1.5) / 2, 2.3, 1.5, { face: 'e' }), fx('vanity', x + w - 2.3, y + (d - 2) / 2, 2, 2, { face: 'w' })]
    const along = w >= d
    return along ? [fx('toilet', x + 0.5, y + 0.3, 2.3, 1.5, { face: 's' }), fx('vanity', x + w - 2.5, y + 0.3, 2, 2, { face: 's' })] : [fx('toilet', x + 0.3, y + 0.5, 1.5, 2.3, { face: 'e' }), fx('vanity', x + 0.3, y + d - 2.5, 2, 2, { face: 'e' })]
  }
  if (kind === 'bed' || kind === 'suite2' || kind === 'master') return [fx('bed', x + 0.5, y + 2, Math.min(7, w - 1), Math.min(6.5, d - 3), { head: 'w' })]
  if (kind === 'office') return [fx('desk', x + w - 2.5, y + 1, 2, Math.min(5, d - 2))]
  if (kind === 'laundry') return [fx('washer', x + w - 2.5, y + 0.5, 2.25, 2.5), fx('dryer', x + w - 2.5, y + 3.25, 2.25, 2.5)]
  if (kind === 'pantry') return [fx('shelves', x + 0.25, y + 0.25, Math.min(w - 0.5, 8), 1.5)]
  return []
}

/** The doors on a room's walls: its own and the ones other rooms (a closet, a bath) open through them. */
export function doorsOf(flat, room) {
  return flat.filter((e) => {
    if (e.kind !== 'door') return false
    if (e.room === room.id) return true
    const cx = e.x + e.w / 2
    const cy = e.y + e.d / 2
    const onX = cx > room.x - 0.4 && cx < room.x + room.w + 0.4
    const onY = cy > room.y - 0.4 && cy < room.y + room.d + 0.4
    return (onX && (Math.abs(cy - room.y) < 0.4 || Math.abs(cy - (room.y + room.d)) < 0.4)) || (onY && (Math.abs(cx - room.x) < 0.4 || Math.abs(cx - (room.x + room.w)) < 0.4))
  })
}

/** A roof mass over a new room: a gable with its ridge along the long side, open toward the house. */
export function roofFor(flat, room, kit, exteriorSides) {
  const roof = flat.find((r) => r.kind === 'roof')
  if (!roof || !roof.masses) return
  const k = roof.scale || 1
  const off = roof.offset || [0, 0]
  const c = roof.centre || [0, 0]
  const base = (v, i) => c[i] + (v - off[i] - c[i]) / k
  const ridgeEW = room.w >= room.d
  const ends = (ridgeEW ? ['w', 'e'] : ['n', 's']).filter((e) => exteriorSides.includes(e))
  roof.masses = [...roof.masses.filter((m) => m.id !== room.id), { id: room.id, kind: room.open ? 'shed' : 'gable', x0: base(room.x, 0), x1: base(room.x + room.w, 0), y0: base(room.y, 1), y1: base(room.y + room.d, 1), ridge: ridgeEW ? 'ew' : 'ns', plate: room.open ? 8 : room.kind === 'garage' ? 11 : 9, pitch: room.open ? 3 : +String(kit.roof?.pitch || '10').split(':')[0] || 10, ends, ...(room.open ? { high: exteriorSides.includes('n') ? 's' : exteriorSides.includes('s') ? 'n' : exteriorSides.includes('e') ? 'w' : 'e', material: 'metal roof' } : {}) }]
  roof.faces = roofSurfaces(roof.masses, k, c, off)
  roof.dormers = dormerWalls(roof.masses, k, c, off)
}

/** Which sides of a rectangle face the outside: no enclosed room or porch beyond them. */
export function exteriorSides(flat, rect, except = []) {
  const all = flat.filter((r) => isRoom(r) && !except.includes(r.id))
  const probe = (pt) => all.some((r) => pt[0] > r.x + 0.05 && pt[0] < r.x + r.w - 0.05 && pt[1] > r.y + 0.05 && pt[1] < r.y + r.d - 0.05)
  const mid = [rect.x + rect.w / 2, rect.y + rect.d / 2]
  const out = []
  if (!probe([rect.x - 0.7, mid[1]]) && !probe([rect.x - 0.7, rect.y + 1]) && !probe([rect.x - 0.7, rect.y + rect.d - 1])) out.push('w')
  if (!probe([rect.x + rect.w + 0.7, mid[1]]) && !probe([rect.x + rect.w + 0.7, rect.y + 1]) && !probe([rect.x + rect.w + 0.7, rect.y + rect.d - 1])) out.push('e')
  if (!probe([mid[0], rect.y - 0.7]) && !probe([rect.x + 1, rect.y - 0.7]) && !probe([rect.x + rect.w - 1, rect.y - 0.7])) out.push('n')
  if (!probe([mid[0], rect.y + rect.d + 0.7]) && !probe([rect.x + 1, rect.y + rect.d + 0.7]) && !probe([rect.x + rect.w - 1, rect.y + rect.d + 0.7])) out.push('s')
  return out
}

/** Elements (doors, windows) of other rooms that a rectangle would cover. */
function covers(flat, rect, exceptRoom) {
  return flat.filter((e) => e.element && (e.kind === 'door' || e.kind === 'window') && e.room !== exceptRoom && intrudes({ x: e.x - 0.2, y: e.y - 0.2, w: e.w + 0.4, d: e.d + 0.4 }, { x: rect.x - 0.2, y: rect.y - 0.2, w: rect.w + 0.4, d: rect.d + 0.4 }, 0.05))
}

/**
 * Attach a new room to `target`'s outside wall with a door from the target. Tries each outside
 * side of the target, widest first; refuses spots that overlap a room or porch, cover a door or
 * window, or leave the new room with no outside wall for its window.
 */
/** The room a new room at `rect` gets its door from: the target when people pass through it (or it is
 * the bedroom a bath or closet serves), else any such room along the new room's walls. {room, side}
 * where side is the new room's wall the host sits on. */
function room_host(rooms, rect, target, kind) {
  const passThrough = (r) => !PRIVATE.includes(r.kind) && !r.open
  const suite = (r) => ['bed', 'master', 'suite2'].includes(r.kind) && ['bath', 'wic', 'halfbath'].includes(kind)
  const sideOf = (r) => {
    if (overlap1(rect.y, rect.y + rect.d, r.y, r.y + r.d) >= 3.5) {
      if (Math.abs(r.x + r.w - rect.x) < 0.75) return 'w'
      if (Math.abs(r.x - (rect.x + rect.w)) < 0.75) return 'e'
    }
    if (overlap1(rect.x, rect.x + rect.w, r.x, r.x + r.w) >= 3.5) {
      if (Math.abs(r.y + r.d - rect.y) < 0.75) return 'n'
      if (Math.abs(r.y - (rect.y + rect.d)) < 0.75) return 's'
    }
    return null
  }
  const ts = sideOf(target)
  if (ts && (passThrough(target) || suite(target))) return { room: target, side: ts }
  for (const r of rooms) {
    if (r === target || !passThrough(r)) continue
    const side = sideOf(r)
    if (side) return { room: r, side }
  }
  return null
}

export function attachBeside(flat, kit, { kind, name, id, w, d, target, door = 'interior', exteriorDoorFrom }) {
  const t = flat.find((r) => r.id === target)
  if (!t) return null
  const rooms = flat.filter((r) => isRoom(r))
  const cands = []
  for (const side of ['e', 'w', 'n', 's']) {
    // the free runs along this side of the target (nothing built just outside it)
    const along = side === 'e' || side === 'w' ? [t.y, t.y + t.d] : [t.x, t.x + t.w]
    const need = side === 'e' || side === 'w' ? d : w
    const blocked = rooms
      .filter((r) => r !== t)
      .map((r) => (side === 'e' ? (Math.abs(r.x - (t.x + t.w)) < 0.75 ? [r.y, r.y + r.d] : null) : side === 'w' ? (Math.abs(r.x + r.w - t.x) < 0.75 ? [r.y, r.y + r.d] : null) : side === 'n' ? (Math.abs(r.y + r.d - t.y) < 0.75 ? [r.x, r.x + r.w] : null) : Math.abs(r.y - (t.y + t.d)) < 0.75 ? [r.x, r.x + r.w] : null))
      .filter(Boolean)
      .sort((p, q) => p[0] - q[0])
    const runs = []
    let cur = along[0]
    for (const [b0, b1] of blocked) {
      if (b0 > cur + 0.5) runs.push([cur, Math.min(b0, along[1])])
      cur = Math.max(cur, b1)
    }
    if (cur < along[1] - 0.5) runs.push([cur, along[1]])
    const spots = []
    runs.filter(([r0, r1]) => r1 - r0 >= Math.min(need, 3.5)).forEach(([r0, r1]) => {
      spots.push(r0, r1 - need, r0 + (r1 - r0 - need) / 2)
    })
    for (const s of spots) {
      const rect = side === 'e' ? { x: t.x + t.w, y: s, w, d } : side === 'w' ? { x: t.x - w, y: s, w, d } : side === 'n' ? { x: s, y: t.y - d, w, d } : { x: s, y: t.y + t.d, w, d }
      const sharedLen = side === 'e' || side === 'w' ? overlap1(rect.y, rect.y + rect.d, t.y, t.y + t.d) : overlap1(rect.x, rect.x + rect.w, t.x, t.x + t.w)
      if (sharedLen < 3.5) continue
      if (rooms.some((r) => intrudes(rect, r))) continue
      if (covers(flat, rect, null).length) continue
      const ext = exteriorSides([...flat, { ...rect, id: '__new', kind, open: false, element: false }], rect, ['__new'])
      if (HABITABLE.includes(kind) && !ext.length) continue
      // the room's door comes from a room people pass through, or from the bedroom it serves
      const host = room_host(rooms, rect, t, kind)
      if (!host && !kit.rooms[kind]?.open) continue
      cands.push({ side, rect, ext, sharedLen, host })
    }
  }
  if (!cands.length) return null
  cands.sort((a, b) => (b.host?.room === t) - (a.host?.room === t) || b.ext.length - a.ext.length || b.sharedLen - a.sharedLen)
  const { side, rect, ext, host } = cands[0]
  const room = { id, kind, name, ...rect, zone: kit.rooms[kind]?.zone || 'private', open: !!kit.rooms[kind]?.open, plumbing: !!kit.rooms[kind]?.plumbing }
  flat.push(room)
  if (!room.open) {
    // the door from the host, on the shared wall
    const hs = host.side
    const axis = hs === 'e' || hs === 'w' ? 'v' : 'h'
    const h = host.room
    const along = axis === 'v' ? (Math.max(rect.y, h.y) + Math.min(rect.y + rect.d, h.y + h.d)) / 2 : (Math.max(rect.x, h.x) + Math.min(rect.x + rect.w, h.x + h.w)) / 2
    const at = hs === 'w' ? [rect.x, along] : hs === 'e' ? [rect.x + rect.w, along] : hs === 's' ? [along, rect.y + rect.d] : [along, rect.y]
    flat.push(doorEl(kit, `d-${id}`, id, axis, at[0], at[1], door, { swing: hs === 'w' || hs === 'n' ? 1 : -1, hinge: 'start' }))
    // a window on an outside wall, egress size for bedrooms
    if (ext.length && (HABITABLE.includes(kind) || kind === 'bath' || kind === 'laundry')) {
      const ws = ext.includes(side === 'e' ? 'e' : side === 'w' ? 'w' : side === 'n' ? 'n' : 's') ? (side === 'e' ? 'e' : side === 'w' ? 'w' : side === 'n' ? 'n' : 's') : ext[0]
      const span = ws === 'e' || ws === 'w' ? rect.d : rect.w
      const mark = kind === 'bath' ? 'C' : 'A'
      const twin = mark === 'A' && span >= 9
      const mid = ws === 'e' || ws === 'w' ? [ws === 'e' ? rect.x + rect.w : rect.x, rect.y + rect.d / 2] : [rect.x + rect.w / 2, ws === 'n' ? rect.y : rect.y + rect.d]
      flat.push(windowEl(kit, `win-${id}`, id, ws === 'e' || ws === 'w' ? 'v' : 'h', mid[0], mid[1], mark, twin))
    }
    fixturesFor(kind, room, flat.filter((e) => e.kind === 'door' && e.room === id)).forEach((f) => flat.push(f))
  } else if (exteriorDoorFrom) {
    // a porch: French doors from the room it serves, when that wall has none
    const axis = side === 'e' || side === 'w' ? 'v' : 'h'
    const along = axis === 'v' ? (Math.max(rect.y, t.y) + Math.min(rect.y + rect.d, t.y + t.d)) / 2 : (Math.max(rect.x, t.x) + Math.min(rect.x + rect.w, t.x + t.w)) / 2
    const at = side === 'e' ? [rect.x, along] : side === 'w' ? [rect.x + rect.w, along] : side === 'n' ? [along, rect.y + rect.d] : [along, rect.y]
    if (!flat.some((e) => e.kind === 'door' && e.exterior && e.room === t.id)) flat.push(doorEl(kit, `d-${id}`, t.id, axis, at[0], at[1], 'exteriorPair', { swing: side === 'e' || side === 's' ? 1 : -1, exterior: true }))
  }
  roofFor(flat, room, kit, ext)
  return room
}

/**
 * A porch on the rear (or front) wall of the public rooms, the kit's depth (8 ft minimum). With a size
 * ({ w, d } in feet: "a 12 by 14 patio", or the smaller patio a refusal offers) it is that wide, centred on
 * the wall it goes on and never wider than the free wall, and that deep (8 ft at least, 16 at most).
 */
export function addPorch(flat, kit, where = 'rear', { w = null, d = null } = {}) {
  const kind = where === 'rear' ? 'rearPorch' : 'frontPorch'
  if (flat.some((r) => isRoom(r) && r.kind === kind)) return null
  const living = flat.find((r) => r.id === 'living') || flat.find((r) => isRoom(r) && r.kind === 'living')
  const dining = flat.find((r) => isRoom(r) && r.kind === 'dining')
  const foyer = flat.find((r) => isRoom(r) && r.kind === 'foyer')
  const kitchen = flat.find((r) => isRoom(r) && r.kind === 'kitchen')
  const minDepth = kit.porch?.minDepthFt || 8
  const depth = d > 0 ? Math.min(16, Math.max(minDepth, d)) : Math.max(minDepth, kit.porch?.depthFt || 10)
  const rooms = flat.filter((r) => isRoom(r))
  // the wall it goes on: the living room's back wall, or the dining room's when the living room's is taken
  // (the narrow and the compact plans put the living room at the front, the dining room at the back), or the kitchen's
  // when it is the family room on the yard (round 15: the Valley plan's kitchen has the back wall and the French door)
  const anchors = (where === 'rear' ? [living, dining, kitchen] : [foyer || living]).filter(Boolean)
  let anchor = null
  let rect = null
  let x0 = 0
  let x1 = 0
  for (const a of anchors) {
    const span = where === 'rear' && a === living && dining && Math.abs(living.y - dining.y) < 0.5 ? { x: Math.min(living.x, dining.x), w: Math.max(living.x + living.w, dining.x + dining.w) - Math.min(living.x, dining.x) } : { x: a.x, w: a.w }
    const r0 = where === 'rear' ? { x: span.x, y: a.y - depth, w: span.w, d: depth } : { x: span.x, y: a.y + a.d, w: span.w, d: depth }
    // trim the porch to what is free along that wall
    let lo = r0.x
    let hi = r0.x + r0.w
    rooms.forEach((r) => {
      if (overlap1(r.y, r.y + r.d, r0.y, r0.y + r0.d) <= 0.5) return
      if (r.x + r.w <= lo + 0.5 || r.x >= hi - 0.5) return
      if (r.x > (lo + hi) / 2) hi = Math.min(hi, r.x)
      else lo = Math.max(lo, r.x + r.w)
    })
    if (hi - lo < 8) continue
    anchor = a
    rect = r0
    x0 = lo
    x1 = hi
    break
  }
  if (!anchor) return null
  if (w > 0 && w < x1 - x0 - 0.01) {
    // the width asked for, centred on the room it serves, kept on the free wall
    const want = Math.max(8, w)
    const mid = Math.min(Math.max(anchor.x + anchor.w / 2, x0 + want / 2), x1 - want / 2)
    x0 = mid - want / 2
    x1 = mid + want / 2
  }
  const room = { id: kind, kind, name: kit.rooms[kind]?.name || (where === 'rear' ? 'Rear Porch' : 'Front Porch'), x: x0, y: rect.y, w: x1 - x0, d: depth, zone: where, open: true, fill: '#e6e1d8', h: 0.6 }
  flat.push(room)
  // French doors from the room it serves when that wall has no exterior door yet
  const serves = where === 'rear' ? (anchor === kitchen ? kitchen : dining && dining.x >= x0 && dining.x + dining.w <= x1 + 0.5 ? dining : anchor === dining ? dining : living) : foyer || living
  if (serves && !flat.some((e) => e.kind === 'door' && e.exterior && e.room === serves.id && Math.abs(e.y + e.d / 2 - (where === 'rear' ? serves.y : serves.y + serves.d)) < 0.6)) {
    const cx = Math.max(serves.x, x0) + Math.min(serves.x + serves.w, x1) - (Math.max(serves.x, x0) + Math.min(serves.x + serves.w, x1)) / 2
    const cy = where === 'rear' ? serves.y : serves.y + serves.d
    if (!covers(flat, { x: cx - 3.3, y: cy - 0.4, w: 6.6, d: 0.8 }, null).length) flat.push(doorEl(kit, `d-${kind}`, serves.id, 'h', cx, cy, 'exteriorPair', { swing: where === 'rear' ? -1 : 1, exterior: true }))
  }
  roofFor(flat, room, kit, where === 'rear' ? ['n', 'w', 'e'] : ['s', 'w', 'e'])
  return room
}

/** A bedroom, bath or office in the bedroom wing, off the hallway (the way the first draft grows). */
export function addInWing(flat, kit, kind, { side = null } = {}) {
  const before = new Set(flat.filter(isRoom).map((r) => r.id))
  const grown = kind === 'office' ? { shift: extendWingOffice(flat, kit), east: null } : extendWing(flat, kit, kind === 'bed' ? { beds: 1, prefer: side } : { baths: 1, prefer: side })
  const shift = grown.shift
  const made = flat.filter((r) => isRoom(r) && !before.has(r.id) && r.kind === kind)[0] || null
  if (!made) return null
  // a room across the hall carries its own gable
  const roofEl = flat.find((r) => r.kind === 'roof')
  if (grown.east && roofEl?.masses) {
    const k = roofEl.scale || 1
    const c = roofEl.centre || [0, 0]
    const off = roofEl.offset || [0, 0]
    const back = (v, i) => c[i] + (v - off[i] - c[i]) / k
    const e = grown.east
    roofEl.masses = [...roofEl.masses.filter((m) => m.id !== 'eastwing'), { id: 'eastwing', kind: 'gable', x0: back(e.x0, 0), x1: back(e.x1, 0), y0: back(e.y0, 1), y1: back(e.y1, 1), ridge: 'ew', plate: 9, pitch: 10, ends: ['e'] }]
  }
  if (!shift && !grown.east) return made
  // the bed wing's roof grows with the wing
  const roof = flat.find((r) => r.kind === 'roof')
  if (roof && roof.masses) {
    const k = roof.scale || 1
    roof.masses = roof.masses.map((m) => (m.id === 'bedwing' ? { ...m, y0: m.y0 - shift / k } : m))
    roof.faces = roofSurfaces(roof.masses, k, roof.centre || [0, 0], roof.offset || [0, 0])
    roof.dormers = dormerWalls(roof.masses, k, roof.centre || [0, 0], roof.offset || [0, 0])
  }
  return made
}

/** An office slot in the wing: 10 ft deep, a hall door, a window on the outside wall, a desk. */
function extendWingOffice(flat, kit) {
  const hall = flat.find((r) => r.id === 'hall')
  const bed2 = flat.find((r) => r.id === 'bed2')
  if (!hall || !bed2) return 0
  const D = 10
  const top = bed2.y + bed2.d
  const block = flat.filter((r) => isRoom(r) && !r.open && r !== hall && r.y + r.d <= top + 0.3 && r.x < hall.x + hall.w + 0.5 && r.x + r.w > bed2.x - 0.5)
  const ids = new Set(block.map((r) => r.id))
  block.forEach((r) => (r.y -= D))
  flat.filter((e) => e.element && e.kind !== 'roof' && ids.has(e.room)).forEach((e) => (e.y -= D))
  const bandY = top - D
  hall.y -= D
  hall.d += D
  const n = flat.filter((r) => isRoom(r) && r.kind === 'office').length + 1
  const id = `office-${n}`
  const room = { id, kind: 'office', name: n === 1 ? 'Office' : `Office ${n}`, x: bed2.x, y: bandY, w: bed2.w, d: D, zone: 'public', open: false, plumbing: false }
  flat.push(room)
  flat.push(doorEl(kit, `d-${id}`, id, 'v', hall.x, room.y + room.d / 2, 'interiorWide', { swing: -1, hinge: 'start' }))
  flat.push(windowEl(kit, `win-${id}`, id, 'v', bed2.x, room.y + room.d / 2, 'A', true))
  fixturesFor('office', room, flat.filter((e) => e.kind === 'door' && e.room === id)).forEach((f) => flat.push(f))
  return D
}

/** Remove a room and everything in it. */
/**
 * A room that left an enclosed space behind hands it to a neighbour on the same wall line (the plan may
 * name which; else storage and halls first), so no unlabeled void is left in the house. Returns the
 * room that grew, or null when the space opens to the outside or no neighbour lines up.
 */
export function fillVoid(flat, gone, named = null) {
  if (!gone || gone.open || exteriorSides(flat, gone).length) return null
  const solid = flat.filter((r) => isRoom(r) && !r.open)
  const sameRow = (n) => Math.abs(n.y - gone.y) < 0.3 && Math.abs(n.d - gone.d) < 0.3 && (Math.abs(n.x + n.w - gone.x) < 0.6 || Math.abs(gone.x + gone.w - n.x) < 0.6)
  const sameCol = (n) => Math.abs(n.x - gone.x) < 0.3 && Math.abs(n.w - gone.w) < 0.3 && (Math.abs(n.y + n.d - gone.y) < 0.6 || Math.abs(gone.y + gone.d - n.y) < 0.6)
  const order = ['wic', 'mwic', 'pantry', 'hall', 'laundry', 'mud', 'halfbath', 'bath', 'foyer', 'office', 'dining', 'kitchen', 'living', 'bed', 'suite2', 'master']
  const cands = solid.filter((n) => sameRow(n) || sameCol(n)).sort((a, b) => (a.id === named ? -1 : b.id === named ? 1 : order.indexOf(a.kind) - order.indexOf(b.kind)))
  const n = cands[0]
  if (!n) return null
  if (sameRow(n)) {
    const x0 = Math.min(n.x, gone.x)
    n.w = Math.max(n.x + n.w, gone.x + gone.w) - x0
    n.x = x0
  } else {
    const y0 = Math.min(n.y, gone.y)
    n.d = Math.max(n.y + n.d, gone.y + gone.d) - y0
    n.y = y0
  }
  return n
}

export function removeRoom(flat, id, kit = null) {
  const gone = flat.find((r) => r.id === id)
  for (let i = flat.length - 1; i >= 0; i--) if (flat[i].id === id || (flat[i].element && flat[i].room === id)) flat.splice(i, 1)
  if (gone) fillVoid(flat, gone, kit?.plan?.fills?.[id])
  const roof = flat.find((r) => r.kind === 'roof')
  if (roof && roof.masses?.some((m) => m.id === id)) {
    roof.masses = roof.masses.filter((m) => m.id !== id)
    roof.faces = roofSurfaces(roof.masses, roof.scale || 1, roof.centre || [0, 0], roof.offset || [0, 0])
    roof.dormers = dormerWalls(roof.masses, roof.scale || 1, roof.centre || [0, 0], roof.offset || [0, 0])
  }
}

/** Move a room next to another: it leaves its spot and re-attaches to the target's outside wall, same size, new door, window and fixtures. */
export function moveBeside(flat, kit, roomId, targetId) {
  const r = flat.find((x) => x.id === roomId)
  const t = flat.find((x) => x.id === targetId)
  if (!r || !t) return null
  const keep = { kind: r.kind, name: r.name, id: r.id, w: r.w, d: r.d }
  const snapshot = flat.map((e) => ({ ...e }))
  removeRoom(flat, roomId)
  const made = attachBeside(flat, kit, { ...keep, target: targetId, door: r.kind === 'bath' || r.kind === 'halfbath' ? 'bath' : 'interior' })
  if (!made) {
    flat.length = 0
    snapshot.forEach((e) => flat.push(e))
    return null
  }
  return made
}
