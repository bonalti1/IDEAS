// Where the camera stands for the top view and the 3D view. Plain numbers, no drawing, so it can be tested.
import { DEFAULT_LOT } from './lot.js'
import { isRoom } from './layout.js'
import { offsetPolyline, polylinePoint } from '../../lib/geometry.js'
import { STREET_WIDTH_ILLUSTRATIVE } from '../../data/survey.js'

/** The canvas camera's vertical field of view, in degrees (HouseScene's Canvas). */
export const FOV = 42
const HALF = Math.tan(((FOV / 2) * Math.PI) / 180)
// room for a street's name around the point it is written at (the letters are 8 ft tall)
const NAME_PAD = 7

/** Where each street's name is written: the middle of the street band, half way along the lot's side. */
/**
 * Round 14: how far from the dashed line (the edge of the buildable area), toward the property line, an open-space
 * label is centred. A strip wide enough for the words holds them; a strip narrower than the words (a 5 ft side yard
 * under 4 ft letters) put them on top of the red property line, so there the label sits just outside the lot.
 */
export function edgeLabelOffset(setbackFt, textFt) {
  const room = Number.isFinite(+setbackFt) && +setbackFt >= 0 ? +setbackFt : Infinity
  if (room >= textFt * 1.7) return Math.min(Math.max(2, textFt), room / 2)
  return room + textFt * 0.9
}

/**
 * Round 15 (polish, k02): how big the words on the ground are drawn. Beside a house in the 3D view they are kept small
 * (full-size lettering was as tall as a door). On a phone the lot is drawn about 300 px wide, so 4 ft letters came out
 * about 7 px: there they are drawn half as big again, about 11 px.
 */
export function groundTextScale({ house = false, view = 'top', phone = false } = {}) {
  if (house && view !== 'top') return 0.45
  return phone ? 1.5 : 1
}

export function streetNamePoints(lot) {
  const out = []
  for (const st of lot.streets || []) {
    if (!st.pts || st.pts.length < 2) continue
    try {
      const mid = offsetPolyline(st.pts, STREET_WIDTH_ILLUSTRATIVE / 2, lot.centroid)
      out.push(polylinePoint(mid, 0.5).point)
    } catch {
      /* a street with no usable line has no name to hold */
    }
  }
  return out
}

/**
 * Camera presets. With rooms, the plan view frames the house (readable labels) and the 3D view
 * looks at it from the street; without rooms, both frame the lot, and the top view holds the lot and the names
 * of its streets (`hold`: the box that has to be in the picture, see topHeight).
 */
export function camerasFor(lot = DEFAULT_LOT, rooms = []) {
  const solid = rooms.filter((r) => isRoom(r) && r.center)
  let CX, CZ, span
  let hold = null
  if (solid.length) {
    const xs = solid.flatMap((r) => [r.center[0] - r.w / 2 - r.d / 2, r.center[0] + r.w / 2 + r.d / 2])
    const zs = solid.flatMap((r) => [r.center[1] - r.w / 2 - r.d / 2, r.center[1] + r.w / 2 + r.d / 2])
    CX = (Math.min(...xs) + Math.max(...xs)) / 2
    CZ = (Math.min(...zs) + Math.max(...zs)) / 2
    const ext = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs))
    span = Math.max(70, ext * 0.95)
  } else {
    ;[CX, CZ] = lot.centroid || lot.centre
    const xs = (lot.boundary || []).map((p) => p[0])
    const zs = (lot.boundary || []).map((p) => p[1])
    const extent = xs.length ? Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) : 200
    span = Math.max(140, extent * 1.35)
    if (xs.length) {
      // the 390 px near-match lot (round 12, item 7): the street's name sat past the right edge of the picture
      const names = streetNamePoints(lot)
      const hx = [...xs, ...names.flatMap((p) => [p[0] - NAME_PAD, p[0] + NAME_PAD])]
      const hz = [...zs, ...names.flatMap((p) => [p[1] - NAME_PAD, p[1] + NAME_PAD])]
      hold = { x0: Math.min(...hx), x1: Math.max(...hx), z0: Math.min(...hz), z1: Math.max(...hz) }
    }
  }
  const cos = Math.cos(lot.angle || 0)
  const sin = Math.sin(lot.angle || 0)
  // round 15 (polish): with a house, the 3D view holds the house and the lot's street side too. A house turned to sit
  // in the widest part of a pie lot (Kiskadee) had its curved frontage cut off at the bottom of the picture.
  let C3 = [CX, CZ]
  let span3 = span
  let hold3 = null
  if (solid.length) {
    const b = lot.boundary || []
    const front = (lot.edges || []).flatMap((e, i) => (e.kind === 'front' && b.length ? [b[i], b[(i + 1) % b.length]] : [])).filter(Boolean)
    if (front.length) {
      const xs = solid.flatMap((r) => [r.center[0] - r.w / 2 - r.d / 2, r.center[0] + r.w / 2 + r.d / 2]).concat(front.map((p) => p[0]))
      const zs = solid.flatMap((r) => [r.center[1] - r.w / 2 - r.d / 2, r.center[1] + r.w / 2 + r.d / 2]).concat(front.map((p) => p[1]))
      C3 = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2]
      span3 = Math.max(span, Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) * 0.95)
      hold3 = front.concat(solid.map((r) => r.center))
    }
  }
  // the 3D view looks from the street side (local +z) toward the rear
  const back = (lx, lz) => [C3[0] + lx * cos - lz * sin, C3[1] + lx * sin + lz * cos]
  let d3 = solid.length ? Math.max(120, span3 * 1.3) : span
  // the street side is nearest the camera, so the picture's bottom edge cuts it first: step back until it is in
  // (a square picture, the narrowest the 3D view is shown in)
  for (let k = 0; hold3 && k < 12 && !hold3.every((p) => inView3(back(-d3 * 0.55, d3 * 0.75), d3 * 0.55, C3, p)); k++) d3 *= 1.1
  const [px, pz] = back(-d3 * 0.55, d3 * 0.75)
  return {
    top: { position: [CX, span * 1.25, CZ + 0.5], target: [CX, 0, CZ], ...(hold ? { hold } : {}) },
    '3d': { position: [px, d3 * 0.55, pz], target: [C3[0], 0, C3[1]] },
  }
}

/** Is ground point p in the picture of a camera at (pos, height) looking at the ground point t? A square picture, a little air. */
function inView3([x, z], y, t, p) {
  const f = [t[0] - x, -y, t[1] - z]
  const fl = Math.hypot(...f)
  const F = f.map((v) => v / fl)
  const rl = Math.hypot(F[2], F[0])
  const R = [-F[2] / rl, 0, F[0] / rl]
  const U = [R[1] * F[2] - R[2] * F[1], R[2] * F[0] - R[0] * F[2], R[0] * F[1] - R[1] * F[0]]
  const v = [p[0] - x, -y, p[1] - z]
  const d = v[0] * F[0] + v[1] * F[1] + v[2] * F[2]
  const lim = HALF * 0.94
  return d > 0 && Math.abs((v[0] * U[0] + v[1] * U[1] + v[2] * U[2]) / d) <= lim && Math.abs((v[0] * R[0] + v[2] * R[2]) / d) <= lim
}

/** How much of the ground a camera looking straight down from `height` shows, in feet, in a picture `aspect` wide for 1 tall. */
export function topShows(height, aspect = 1) {
  const d = 2 * height * HALF
  return { w: d * aspect, d }
}

/**
 * The height the top view's camera stands at in a picture of this shape: its own, or higher when the lot and
 * its street names (cam.hold) would not all be in the picture, with a little air around them.
 */
export function topHeight(cam, aspect = 1) {
  const y = cam.position[1]
  if (!cam.hold || !(aspect > 0)) return y
  const AIR = 1.04
  const halfW = Math.max(cam.target[0] - cam.hold.x0, cam.hold.x1 - cam.target[0]) * AIR
  const halfD = Math.max(cam.target[2] - cam.hold.z0, cam.hold.z1 - cam.target[2]) * AIR
  return Math.max(y, halfD / HALF, halfW / (HALF * aspect))
}
