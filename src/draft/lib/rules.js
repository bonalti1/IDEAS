// Rules engine. Checks a plan (rooms + elements) and returns reasons a client
// can read. Run on the plan as it would be after a change, before applying it.
import { isRoom, isConditioned, kitFor } from './layout.js'
import { LOT_ANGLE } from '../../data/program.js'
import { SETBACK_CORNERS, SETBACK_EDGE_LABELS, LOT_AREA_SF } from '../../data/survey.js'
import { polygonArea } from '../../lib/geometry.js'
import { CITIES } from './styles.js'

const ENVELOPE_SF = Math.abs(polygonArea(SETBACK_CORNERS))

function inside(poly, [x, z]) {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]
    const [xj, zj] = poly[j]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c
  }
  return c
}
function nearestEdge(poly, [x, z]) {
  let best = 0
  let bd = Infinity
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i]
    const [bx, bz] = poly[(i + 1) % poly.length]
    const len2 = (bx - ax) ** 2 + (bz - az) ** 2
    const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / len2))
    const d = Math.hypot(x - (ax + (bx - ax) * t), z - (az + (bz - az) * t))
    if (d < bd) {
      bd = d
      best = i
    }
  }
  return best
}
/** World corners of a room from its centre on the lot. */
function corners(r) {
  const cos = Math.cos(LOT_ANGLE)
  const sin = Math.sin(LOT_ANGLE)
  const [cx, cz] = r.center
  return [
    [-r.w / 2, -r.d / 2],
    [r.w / 2, -r.d / 2],
    [r.w / 2, r.d / 2],
    [-r.w / 2, r.d / 2],
  ].map(([lx, lz]) => [cx + lx * cos - lz * sin, cz + lx * sin + lz * cos])
}
const gap = (a, b) => {
  const dx = Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w), 0)
  const dy = Math.max(a.y - (b.y + b.d), b.y - (a.y + a.d), 0)
  return Math.hypot(dx, dy)
}
// how far one room intrudes into another: the smaller side of the overlap rectangle.
// Traced plans have slivers where walls are, so only a real intrusion (over 1 ft) counts.
const intrusion = (a, b) => Math.min(Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)), Math.max(0, Math.min(a.y + a.d, b.y + b.d) - Math.max(a.y, b.y)))

/**
 * @returns {{ ok: boolean, reasons: string[] }}
 */
export function checkRules(rooms, program, style, city = CITIES.palmview) {
  const kit = kitFor(style)
  const R = kit.rules || {}
  const reasons = []
  const roomsOnly = rooms.filter(isRoom)
  const solid = roomsOnly.filter((r) => !r.open)
  const label = (r) => r.name

  // 1. setbacks
  solid.forEach((r) => {
    if (!r.center) return
    const out = corners(r).find((p) => !inside(SETBACK_CORNERS, p))
    if (out) {
      const edge = SETBACK_EDGE_LABELS[nearestEdge(SETBACK_CORNERS, out)] || 'the property line'
      reasons.push(`${label(r)} would cross the setback at ${edge.replace(/^(\d+)' — /, '$1 ft from ').toLowerCase()}.`)
    }
  })

  // 2. overlaps
  for (let i = 0; i < solid.length; i++)
    for (let j = i + 1; j < solid.length; j++) {
      const a = solid[i]
      const b = solid[j]
      if (a.x === undefined || b.x === undefined) continue
      if (intrusion(a, b) > 1) reasons.push(`${label(a)} would run into ${label(b).toLowerCase()}.`)
    }

  // 3. minimum sizes
  solid.forEach((r) => {
    const min = R.minSize?.[r.kind]
    const [mw, md] = min || (R.habitable?.includes(r.kind) ? [7, 7] : [3, 3])
    const fits = (Math.min(r.w, r.d) >= Math.min(mw, md) - 0.01 && Math.max(r.w, r.d) >= Math.max(mw, md) - 0.01)
    if (!fits) reasons.push(`${label(r)} would be ${r.w}' by ${r.d}', under the ${mw}' by ${md}' minimum.`)
    if (R.habitable?.includes(r.kind) && r.w * r.d < 70) reasons.push(`${label(r)} would be under 70 square feet, the code minimum for a living space.`)
    if (R.maxRoomFt && Math.max(r.w, r.d) > R.maxRoomFt) reasons.push(`${label(r)} at ${Math.max(r.w, r.d)}' is longer than we can roof in this style (${R.maxRoomFt}' max).`)
  })

  // 4. bedroom egress
  const windows = rooms.filter((e) => e.kind === 'window')
  solid.filter((r) => R.bedrooms?.includes(r.kind)).forEach((r) => {
    if (!windows.some((w) => w.room === r.id)) reasons.push(`${label(r)} needs a window for emergency exit.`)
  })

  // 5. wet rooms near plumbing
  const wet = solid.filter((r) => R.wet?.includes(r.kind) && r.x !== undefined)
  wet.forEach((r) => {
    const others = wet.filter((o) => o !== r)
    if (!others.length) return
    const d = Math.min(...others.map((o) => gap(r, o)))
    if (d > (R.wetDistanceFt || 20)) reasons.push(`${label(r)} would be ${Math.round(d)}' from the nearest plumbing; keep baths, kitchen and laundry within ${R.wetDistanceFt || 20}'.`)
  })

  // 6. lot fit
  const cond = roomsOnly.filter(isConditioned).reduce((s, r) => s + r.w * r.d, 0)
  const garage = roomsOnly.filter((r) => r.kind === 'garage').reduce((s, r) => s + r.w * r.d, 0)
  const footprint = cond / (program.stories || 1) + garage
  const maxFootprint = Math.min(ENVELOPE_SF, LOT_AREA_SF * city.maxCoverage)
  if (footprint > maxFootprint) reasons.push(`The house would cover ${Math.round(footprint).toLocaleString()} square feet of the lot; this lot allows ${Math.round(maxFootprint).toLocaleString()}.`)

  // 7. required rooms
  ;(R.required || []).forEach((group) => {
    if (!roomsOnly.some((r) => group.includes(r.kind))) reasons.push(`Every house needs a ${kit.rooms[group[0]]?.name.toLowerCase() || group[0]}.`)
  })

  return { ok: reasons.length === 0, reasons: [...new Set(reasons)] }
}
