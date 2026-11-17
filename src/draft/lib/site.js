// The site: where the driveway and the front walk run on the lot, and how much of the lot the house
// covers. One place for it, so the 3D scene, the site plan drawing and the PDF agree. House frame
// throughout (x along the front, z toward the street; the plan centre at the lot's centre), the way
// design.json keeps rooms and doors.

/** The lot boundary's far street edge in the house frame: the largest local z. */
export function streetZ(lot, fallback = 60) {
  if (!lot?.boundary?.length) return fallback
  const cos = Math.cos(lot.angle || 0)
  const sin = Math.sin(lot.angle || 0)
  const c = lot.centre || [0, 0]
  return Math.max(...lot.boundary.map((p) => -(p[0] - c[0]) * sin + (p[1] - c[1]) * cos))
}

/**
 * The driveway as slabs { x, z, w, d } (centres, house frame): straight out to the street from a
 * front-load door; a 25 ft apron and a lane down the side from a side-load door; the courtyard way
 * (apron off the rear-facing doors, across the rear, down the side yard) when the garage says so.
 * @param {object[]} rooms  { id, kind, open, x, z, w, d, driveway? }
 * @param {object[]} doors  { axis, x, z, span, size }
 */
export function drivewaySlabs(rooms, doors, lot) {
  const garage = rooms.find((r) => r.kind === 'garage' && !r.open)
  const door = doors.find((e) => (e.size === 'overhead' || e.size === 'overheadSingle') && e.x !== undefined)
  if (!garage || !door) return []
  const street = streetZ(lot, garage.z + garage.d / 2 + 30)
  const out = []
  if (door.axis === 'h') {
    const z0 = door.z
    out.push({ x: door.x, z: (z0 + street) / 2, w: (door.span || 16) + 2, d: street - z0, part: 'drive' })
  } else if (garage.driveway === 'courtyard' || door.x < garage.x) {
    const x0 = door.x
    const solid = rooms.filter((r) => !r.open && r.kind !== 'roof')
    const east = Math.max(...solid.map((r) => r.x + r.w / 2))
    out.push({ x: x0 - 12.5, z: garage.z, w: 25, d: garage.d, part: 'apron' })
    const legZ = garage.z - garage.d / 2 + 6
    out.push({ x: (x0 - 25 + east + 10) / 2, z: legZ, w: east + 10 - (x0 - 25), d: 12, part: 'drive' })
    out.push({ x: east + 5, z: (legZ + street) / 2, w: 10, d: street - legZ, part: 'drive' })
  } else {
    const dir = door.x > garage.x ? 1 : -1
    const x0 = door.x
    out.push({ x: x0 + dir * 12.5, z: garage.z, w: 25, d: garage.d, part: 'apron' })
    const z1 = garage.z + garage.d / 2
    out.push({ x: x0 + dir * 12, z: (z1 + street) / 2, w: 12, d: street - z1, part: 'drive' })
  }
  return out
}

/** The front walk: 4 ft wide from the front door straight to the street (or to the driveway when it crosses one). */
export function walkSlabs(rooms, doors, lot, drive = []) {
  const front = doors.find((e) => e.exterior && e.size !== 'overhead' && e.size !== 'overheadSingle' && e.axis === 'h' && rooms.some((r) => r.id === e.room && ['foyer', 'living'].includes(r.kind))) || doors.find((e) => e.exterior && e.axis === 'h' && !/overhead/.test(e.size || ''))
  if (!front) return []
  const street = streetZ(lot, front.z + 30)
  // porches in the way are walked across, not paved
  let z0 = front.z
  rooms.filter((r) => r.open && Math.abs(r.x - front.x) < r.w / 2 + 0.5 && r.z > front.z).forEach((p) => (z0 = Math.max(z0, p.z + p.d / 2)))
  // a driveway crossing the walk's line ends it
  let z1 = street
  drive.forEach((s) => {
    if (front.x > s.x - s.w / 2 && front.x < s.x + s.w / 2 && s.z - s.d / 2 > z0 && s.z - s.d / 2 < z1) z1 = s.z - s.d / 2
  })
  if (z1 - z0 < 1) return []
  return [{ x: front.x, z: (z0 + z1) / 2, w: 4, d: z1 - z0, part: 'walk' }]
}

/** Lot coverage: the roofed footprint (rooms, porches, garage) over the lot area, as a percent. */
export function lotCoverage(rooms, lot) {
  const footprint = rooms.filter((r) => r.kind !== 'roof' && r.w && r.d).reduce((s, r) => s + r.w * r.d, 0)
  const lotSf = lot?.areaSf || 0
  return { footprintSf: Math.round(footprint), lotSf: Math.round(lotSf), pct: lotSf ? Math.round((footprint / lotSf) * 1000) / 10 : null }
}
