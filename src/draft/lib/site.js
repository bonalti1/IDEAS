// The site: the driveway as a real path (door → apron → lane → street), the front walk, and how
// much of the lot the house covers. One place for it, so the layout, the audit, the 3D scene, the
// site plan drawing, design.json and the PDF agree. House frame throughout (x along the front,
// z toward the street; the plan centre at the lot's centre), the way design.json keeps rooms.
//
// A drivable path: every piece at least 10 ft wide, inside the lot, crossing no room, each piece
// touching the next, the first at the overhead door, the last at the street; and at every turn a
// clear 20 ft pocket on the inside of the turn (the fillet a car's inside wheel sweeps), inside the
// lot and clear of rooms. drivewayProblem() says what fails, or null.

export const LANE_FT = 12 // a driveway lane
export const APRON_FT = 25 // from a side-facing door to where a car can turn in
export const TURN_FT = 20 // the pocket on the inside of a turn

/** The lot boundary's street edge in the house frame: the largest local z. */
export function streetZ(lot, fallback = 60) {
  if (!lot?.boundary?.length) return fallback
  const cos = Math.cos(lot.angle || 0)
  const sin = Math.sin(lot.angle || 0)
  const c = lot.centre || [0, 0]
  return Math.max(...lot.boundary.map((p) => -(p[0] - c[0]) * sin + (p[1] - c[1]) * cos))
}

/** Where a lane of half-width `half` centred on x meets the lot's street edge: the last z (from z0, toward the street) still inside the lot. */
export function streetZAt(lot, x, half, z0, fallback = 60) {
  if (!lot?.boundary || lot.boundary.length < 3) return fallback
  const ok = (z) => insideLotFrame(lot, x, z) && insideLotFrame(lot, x - half, z) && insideLotFrame(lot, x + half, z)
  let z = z0
  if (!ok(z + 0.5)) return z
  while (z < z0 + 400 && ok(z + 0.5)) z += 0.5
  while (ok(z + 0.05)) z += 0.05
  return Math.round(z * 100) / 100
}

/** Is a house-frame point inside the lot boundary? (true when the lot has no boundary) */
export function insideLotFrame(lot, x, z) {
  if (!lot?.boundary || lot.boundary.length < 3) return true
  const cos = Math.cos(lot.angle || 0)
  const sin = Math.sin(lot.angle || 0)
  const c = lot.centre || [0, 0]
  const X = c[0] + x * cos - z * sin
  const Z = c[1] + x * sin + z * cos
  const poly = lot.boundary
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]
    const [xj, zj] = poly[j]
    if (zi > Z !== zj > Z && X < ((xj - xi) * (Z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

const rect = (x, z, w, d, part) => ({ x, z, w, d, part })
// the corners of a piece, pulled in a hair so an edge on the lot line still counts as inside
const corners = (s, e = 0.1) => [[s.x - s.w / 2 + e, s.z - s.d / 2 + e], [s.x + s.w / 2 - e, s.z - s.d / 2 + e], [s.x + s.w / 2 - e, s.z + s.d / 2 - e], [s.x - s.w / 2 + e, s.z + s.d / 2 - e]]
const overlap1 = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0)
/** How far two centre-based rectangles intrude on each other (0 when apart). */
export const intrusion = (a, b) => Math.min(Math.max(0, overlap1(a.x - a.w / 2, a.x + a.w / 2, b.x - b.w / 2, b.x + b.w / 2)), Math.max(0, overlap1(a.z - a.d / 2, a.z + a.d / 2, b.z - b.d / 2, b.z + b.d / 2)))

/**
 * The driveway as slabs { x, z, w, d, part } (centres, house frame), from the garage's overhead door:
 * straight out to the street from a front-load door; from a side-facing door a 25 ft apron and a lane
 * to the street down that side; the courtyard way (the doors toward the rear court, the apron there,
 * a leg behind the house to the far side yard, a lane down it) when the garage says so.
 * @param {object[]} rooms  { id, kind, open, x, z, w, d, driveway? }
 * @param {object[]} doors  { axis, x, z, span, size }
 */
export function drivewaySlabs(rooms, doors, lot) {
  const garage = rooms.find((r) => r.kind === 'garage' && !r.open)
  const door = doors.find((e) => (e.size === 'overhead' || e.size === 'overheadSingle') && e.x !== undefined && (!garage || e.room === garage.id || e.room === undefined)) || doors.find((e) => (e.size === 'overhead' || e.size === 'overheadSingle') && e.x !== undefined)
  if (!garage || !door) return []
  const street = streetZ(lot, garage.z + garage.d / 2 + 30)
  const solid = rooms.filter((r) => !r.open && r.kind !== 'roof' && r.w && r.d)
  const facing = door.axis === 'h' ? (door.z > garage.z ? 's' : 'n') : door.x > garage.x ? 'e' : 'w'
  if (facing === 's') {
    const z0 = garage.z + garage.d / 2
    const w = Math.max(LANE_FT, (door.span || 16) + 2)
    const end = streetZAt(lot, door.x, w / 2, z0, street)
    return [rect(door.x, (z0 + end) / 2, w, end - z0, 'drive')]
  }
  if (facing === 'n') return [] // a rear-facing door needs an alley; nothing to draw toward the street
  const dir = facing === 'e' ? 1 : -1
  const face = garage.x + (dir * garage.w) / 2
  const apron = rect(face + (dir * APRON_FT) / 2, garage.z, APRON_FT, garage.d, 'apron')
  const front = garage.z + garage.d / 2
  if (garage.driveway === 'courtyard') {
    // the court is between the garage and the far wing: the leg runs along the apron's band to the far
    // side yard, then the lane turns down that yard to the street
    const far = dir === -1 ? Math.min(...solid.map((r) => r.x - r.w / 2)) : Math.max(...solid.map((r) => r.x + r.w / 2))
    const laneX = far - dir * (1 + LANE_FT / 2)
    const legEnd = laneX - (dir * LANE_FT) / 2
    const legStart = face + dir * APRON_FT
    const leg = rect((legStart + legEnd) / 2, front - LANE_FT / 2, Math.abs(legEnd - legStart), LANE_FT, 'drive')
    const laneTop = front - LANE_FT
    const end = streetZAt(lot, laneX, LANE_FT / 2, laneTop, street)
    return [apron, leg, rect(laneX, (laneTop + end) / 2, LANE_FT, end - laneTop, 'drive')]
  }
  // side-load: the lane leaves the apron's outer part for the street
  const laneX = face + dir * (APRON_FT - LANE_FT / 2)
  const end = streetZAt(lot, laneX, LANE_FT / 2, front, street)
  return [apron, rect(laneX, (front + end) / 2, LANE_FT, end - front, 'drive')]
}

/**
 * Why a driveway is not drivable, or null: a piece under 10 ft wide, outside the lot, through a room,
 * a gap between pieces, not starting at the overhead door, not reaching the street, or a turn with
 * no 20 ft pocket on its inside.
 */
export function drivewayProblem(slabs, rooms, doors, lot) {
  const garage = rooms.find((r) => r.kind === 'garage' && !r.open)
  if (!garage) return null
  const door = doors.find((e) => (e.size === 'overhead' || e.size === 'overheadSingle') && e.x !== undefined)
  if (!door) return 'the garage has no overhead door'
  if (!slabs.length) return 'the overhead door faces away from the street and this lot has no alley'
  const solid = rooms.filter((r) => !r.open && r.kind !== 'roof' && r.w && r.d && r.id !== garage.id)
  const name = (r) => r.name || r.kind
  for (const s of slabs) {
    if (Math.min(s.w, s.d) < 10 - 0.01 && s.part !== 'apron') return `the driveway narrows to ${Math.round(Math.min(s.w, s.d))} ft; a lane needs 10 ft`
    if (!corners(s).every(([x, z]) => insideLotFrame(lot, x, z))) return `the driveway ${s.part === 'apron' ? 'apron' : 'lane'} leaves the lot`
    const hit = solid.find((r) => intrusion(s, r) > 0.5)
    if (hit) return `the driveway ${s.part === 'apron' ? 'apron' : 'lane'} runs through the ${name(hit).toLowerCase()}`
    if (intrusion(s, garage) > 0.5) return 'the driveway runs through the garage itself'
  }
  // from the door, piece to piece, to the street
  const first = slabs[0]
  const dcx = door.x
  const dcz = door.z
  if (dcx < first.x - first.w / 2 - 1 || dcx > first.x + first.w / 2 + 1 || dcz < first.z - first.d / 2 - 1 || dcz > first.z + first.d / 2 + 1) return 'the driveway does not start at the overhead door'
  for (let i = 1; i < slabs.length; i++) if (intrusion(slabs[i - 1], slabs[i]) < 0.01 && overlap1(slabs[i - 1].x - slabs[i - 1].w / 2, slabs[i - 1].x + slabs[i - 1].w / 2, slabs[i].x - slabs[i].w / 2, slabs[i].x + slabs[i].w / 2) < -0.5 && overlap1(slabs[i - 1].z - slabs[i - 1].d / 2, slabs[i - 1].z + slabs[i - 1].d / 2, slabs[i].z - slabs[i].d / 2, slabs[i].z + slabs[i].d / 2) < -0.5) return 'the driveway has a gap between its pieces'
  const last = slabs[slabs.length - 1]
  // the street: the lot's edge toward the street at the lane's own line (a skewed front edge is nearer at one side)
  const houseFront = Math.max(...rooms.filter((r) => !r.open && r.kind !== 'roof').map((r) => r.z + r.d / 2))
  const edge = streetZAt(lot, last.x, Math.min(last.w, last.d) / 2 - 0.1, Math.max(last.z - last.d / 2, Math.min(houseFront, last.z)), streetZ(lot, last.z + last.d / 2))
  if (last.z + last.d / 2 < edge - 1) return 'the driveway stops short of the street'
  if (last.z + last.d / 2 < houseFront - 0.5) return 'the driveway ends behind the house, not at the street'
  // every turn: a 20 ft pocket on the inside, clear of rooms and inside the lot
  for (let i = 1; i < slabs.length; i++) {
    const a = slabs[i - 1]
    const b = slabs[i]
    const alongA = a.w >= a.d ? 'x' : 'z'
    const alongB = b.w >= b.d ? 'x' : 'z'
    if (alongA === alongB && a.part !== 'apron') continue
    const pocket = turnPocket(a, b)
    if (!pocket) continue
    if (!corners(pocket).every(([x, z]) => insideLotFrame(lot, x, z))) return `the turn from the ${a.part} needs a ${TURN_FT} ft pocket on its inside, and it leaves the lot`
    const hit = solid.find((r) => intrusion(pocket, r) > 0.5)
    if (hit) return `the turn from the ${a.part} needs a ${TURN_FT} ft pocket on its inside, and the ${name(hit).toLowerCase()} is in it`
    if (intrusion(pocket, garage) > 0.5) return `the turn from the ${a.part} needs a ${TURN_FT} ft pocket on its inside, and the garage is in it`
  }
  return null
}

/** The 20 ft square on the inside of the turn between two touching pieces: at the concave corner of their L, outside both. */
export function turnPocket(a, b) {
  const ax0 = a.x - a.w / 2
  const ax1 = a.x + a.w / 2
  const az0 = a.z - a.d / 2
  const az1 = a.z + a.d / 2
  const bx0 = b.x - b.w / 2
  const bx1 = b.x + b.w / 2
  const bz0 = b.z - b.d / 2
  const bz1 = b.z + b.d / 2
  const ox0 = Math.max(ax0, bx0)
  const ox1 = Math.min(ax1, bx1)
  const oz0 = Math.max(az0, bz0)
  const oz1 = Math.min(az1, bz1)
  if (ox1 < ox0 - 0.01 || oz1 < oz0 - 0.01) return null
  const inA = (x, z) => x > ax0 + 0.01 && x < ax1 - 0.01 && z > az0 + 0.01 && z < az1 - 0.01
  const inB = (x, z) => x > bx0 + 0.01 && x < bx1 - 0.01 && z > bz0 + 0.01 && z < bz1 - 0.01
  for (const [cx, cz] of [[ox0, oz0], [ox1, oz0], [ox1, oz1], [ox0, oz1]]) {
    for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const px = cx + dx * 0.5
      const pz = cz + dz * 0.5
      // the concave corner: just outside both pieces diagonally, but inside one piece along each axis
      if (!inA(px, pz) && !inB(px, pz) && (inA(cx + dx * 0.5, cz - dz * 0.5) || inB(cx + dx * 0.5, cz - dz * 0.5)) && (inA(cx - dx * 0.5, cz + dz * 0.5) || inB(cx - dx * 0.5, cz + dz * 0.5))) {
        return rect(cx + (dx * TURN_FT) / 2, cz + (dz * TURN_FT) / 2, TURN_FT, TURN_FT, 'turn')
      }
    }
  }
  return null
}

/** The front walk: 4 ft wide from the front door straight to the street (or to the driveway when it crosses one). */
export function walkSlabs(rooms, doors, lot, drive = []) {
  const front = doors.find((e) => e.exterior && e.size !== 'overhead' && e.size !== 'overheadSingle' && e.axis === 'h' && rooms.some((r) => r.id === e.room && ['foyer', 'living'].includes(r.kind))) || doors.find((e) => e.exterior && e.axis === 'h' && !/overhead/.test(e.size || ''))
  if (!front) return []
  const street = streetZ(lot, front.z + 30)
  let z0 = front.z
  rooms.filter((r) => r.open && Math.abs(r.x - front.x) < r.w / 2 + 0.5 && r.z > front.z).forEach((p) => (z0 = Math.max(z0, p.z + p.d / 2)))
  let z1 = street
  drive.forEach((s) => {
    if (front.x > s.x - s.w / 2 && front.x < s.x + s.w / 2 && s.z - s.d / 2 > z0 && s.z - s.d / 2 < z1) z1 = s.z - s.d / 2
  })
  if (z1 - z0 < 1) return []
  return [{ x: front.x, z: (z0 + z1) / 2, w: 4, d: z1 - z0, part: 'walk' }]
}

/** The driveway's length along its pieces, feet. */
export const drivewayLength = (slabs) => Math.round(slabs.filter((s) => s.part !== 'apron').reduce((s, r) => s + Math.max(r.w, r.d), 0) + (slabs.some((s) => s.part === 'apron') ? APRON_FT : 0))

/** Lot coverage: the roofed footprint (rooms, porches, garage) over the lot area, as a percent. */
export function lotCoverage(rooms, lot) {
  const footprint = rooms.filter((r) => r.kind !== 'roof' && r.w && r.d).reduce((s, r) => s + r.w * r.d, 0)
  const lotSf = lot?.areaSf || 0
  return { footprintSf: Math.round(footprint), lotSf: Math.round(lotSf), pct: lotSf ? Math.round((footprint / lotSf) * 1000) / 10 : null }
}

/** Plan-coordinate rooms and elements (x, y top-left, the kit's plan centre at the lot centre) → the house frame this module uses. */
export function frameOf(flat, centre) {
  const rooms = flat.filter((r) => !r.element).map((r) => ({ id: r.id, kind: r.kind, name: r.name, open: !!r.open, driveway: r.driveway, x: r.x + r.w / 2 - centre[0], z: r.y + r.d / 2 - centre[1], w: r.w, d: r.d }))
  const doors = flat.filter((e) => e.kind === 'door').map((e) => ({ id: e.id, room: e.room, axis: e.axis, x: e.x + e.w / 2 - centre[0], z: e.y + e.d / 2 - centre[1], span: e.span, size: e.size, exterior: !!e.exterior }))
  return { rooms, doors }
}
