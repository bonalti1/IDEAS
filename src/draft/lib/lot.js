// The lot: boundary, streets, setbacks, buildable envelope, and the house frame on it.
// Coordinates are plat feet, x east and z south. A lot is built from a small spec so the
// server can rebuild it instead of trusting geometry sent by a browser:
//   { kind: 'manual', width, depth, city, frontStreet, corner, sideStreet, setbacks }
//   { kind: 'plat', calls, streets, front, city, setbacks, platId, confirmed }
//   { kind: 'reference' }  the recorded Lot 514 plat, used by the tests and the drafter view
import { polygonArea, polygonCentroid, tessellateArc, extendPolyline } from '../../lib/geometry.js'
import { BOUNDARY, LOT_CORNERS, SETBACK_CORNERS, SETBACK_EDGE_LABELS, STREETS as REF_STREETS, ARC_RECORDED as REF_ARC } from '../../data/survey.js'
import { LOT_ANGLE as REF_ANGLE } from '../../data/program.js'
import { cityTable, rulesFor } from './cities.js'
import polygonClipping from 'polygon-clipping'

const r2 = (v) => Math.round(v * 100) / 100

/** "N 05°00'00\" E", "S 87-15-30 W", "N5°E", or an azimuth in degrees → unit vector [east, south]. */
export function bearingToVector(b) {
  if (typeof b === 'number') return [Math.sin((b * Math.PI) / 180), -Math.cos((b * Math.PI) / 180)]
  const s = String(b).trim().toUpperCase().replace(/[º˚]/g, '°')
  const m = s.match(/^([NS])\s*(\d+(?:\.\d+)?)\s*(?:[°\-\s]\s*(\d+(?:\.\d+)?))?\s*(?:['′\-\s]\s*(\d+(?:\.\d+)?))?\s*["″]?\s*([EW])$/)
  if (!m) {
    const az = parseFloat(s)
    if (!isNaN(az)) return bearingToVector(az)
    throw new Error(`cannot read bearing "${b}"`)
  }
  const deg = parseFloat(m[2]) + (parseFloat(m[3] || 0) || 0) / 60 + (parseFloat(m[4] || 0) || 0) / 3600
  const t = (deg * Math.PI) / 180
  const ns = m[1] === 'N' ? -1 : 1
  const ew = m[5] === 'E' ? 1 : -1
  return [ew * Math.sin(t), ns * Math.cos(t)]
}

/** The bearing text for a direction vector, for display. */
export function vectorToBearing([x, z]) {
  const ns = z <= 0 ? 'N' : 'S'
  const ew = x >= 0 ? 'E' : 'W'
  const total = Math.round((Math.atan2(Math.abs(x), Math.abs(z)) * 180 * 3600) / Math.PI) // whole seconds, carried
  const d = Math.floor(total / 3600)
  const mi = Math.floor((total % 3600) / 60)
  const sec = total % 60
  return `${ns} ${String(d).padStart(2, '0')}°${String(mi).padStart(2, '0')}'${String(sec).padStart(2, '0')}" ${ew}`
}

/**
 * Walk the calls of a plat. A call is { bearing, distance } for a line, or
 * { curve: { radius, arcLength?, delta?, chord?, chordBearing?, direction: 'left'|'right' } }.
 * Returns the boundary (arcs tessellated), the corner points, the closure error and the area.
 */
export function traverse(calls, start = [0, 0]) {
  let p = [...start]
  const corners = [p]
  const boundary = [p]
  const arcs = []
  let heading = null
  for (const c of calls) {
    if (c.curve) {
      const cv = c.curve
      const R = +cv.radius
      let delta = cv.delta != null ? (+cv.delta * Math.PI) / 180 : cv.arcLength != null ? +cv.arcLength / R : cv.chord != null ? 2 * Math.asin(Math.min(1, +cv.chord / (2 * R))) : null
      if (!R || !delta) throw new Error('a curve needs a radius and one of delta, arc length or chord')
      const chord = cv.chord != null ? +cv.chord : 2 * R * Math.sin(delta / 2)
      let dir
      if (cv.chordBearing) dir = bearingToVector(cv.chordBearing)
      else if (heading) {
        // tangent curve: the chord turns half the delta from the incoming heading
        const turn = (cv.direction === 'left' ? -1 : 1) * (delta / 2)
        dir = [heading[0] * Math.cos(turn) - heading[1] * Math.sin(turn), heading[0] * Math.sin(turn) + heading[1] * Math.cos(turn)]
      } else throw new Error('a curve needs a chord bearing or a preceding line')
      const end = [p[0] + dir[0] * chord, p[1] + dir[1] * chord]
      // the arc bulges away from the centre, which sits on the inside of the turn
      const nx = -dir[1]
      const nz = dir[0]
      const sideSign = cv.direction === 'left' ? -1 : 1
      const inside = [(p[0] + end[0]) / 2 + nx * sideSign * R, (p[1] + end[1]) / 2 + nz * sideSign * R]
      const arc = tessellateArc(p, end, R, inside, 24)
      arcs.push({ from: p, to: end, radius: R, delta: (delta * 180) / Math.PI, arcLength: delta * R, chord })
      boundary.push(...arc.points.slice(1))
      corners.push(end)
      const outTurn = (cv.direction === 'left' ? -1 : 1) * (delta / 2)
      heading = [dir[0] * Math.cos(outTurn) - dir[1] * Math.sin(outTurn), dir[0] * Math.sin(outTurn) + dir[1] * Math.cos(outTurn)]
      p = end
    } else {
      const dir = bearingToVector(c.bearing)
      const end = [p[0] + dir[0] * +c.distance, p[1] + dir[1] * +c.distance]
      boundary.push(end)
      corners.push(end)
      heading = dir
      p = end
    }
  }
  const closure = Math.hypot(p[0] - start[0], p[1] - start[1])
  // the last point should be the first; drop it so the polygon closes implicitly
  if (closure < 1.5) {
    boundary.pop()
    corners.pop()
  }
  return { boundary, corners, arcs, closure: r2(closure), areaSf: Math.abs(polygonArea(boundary)) }
}

// ── envelope: the boundary clipped by every edge's setback line (half-plane clipping) ──
function clipHalfPlane(poly, p0, nrm) {
  // keep the side where (p - p0) · nrm >= 0
  const side = (p) => (p[0] - p0[0]) * nrm[0] + (p[1] - p0[1]) * nrm[1]
  const out = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const sa = side(a)
    const sb = side(b)
    if (sa >= 0) out.push(a)
    if ((sa >= 0) !== (sb >= 0)) {
      const t = sa / (sa - sb)
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
    }
  }
  return out
}
/**
 * Inset polygon: setback per boundary edge (feet). Convex result; a notch in the lot is cut off, which is the safe side.
 *
 * A side that curves INTO the lot (the street side of a pie lot on a cul-de-sac is an arc of short chords) is the
 * case plain edge-by-edge clipping gets badly wrong: each chord's setback line, run on across the lot, cuts off what
 * its neighbours left, and 2002 Kiskadee Ln kept 1,614 sf of a true 3,200 (round 11). For a run of edges that turn
 * gently and share a setback, one line is tried instead: square to the run's mean direction, the setback behind the
 * run's deepest point. Every point past that line is at least the setback from every point of the run, so it is
 * still the safe side. The run takes whichever of the two leaves more room.
 */
// ── is a room inside the buildable area? ──
// The buildable area of nearly every lot is convex: a room (a rectangle) is inside it when its four corners are.
// Round 12, item A: where a street side curves into the lot the area now follows the curve, so it has a notch, and a
// rectangle with all four corners inside can still have the curve poking through one of its sides. For such an area
// the edges are tested too. The convex case costs what it always did.
const convexKnown = new WeakMap()
/** Is this polygon convex (no notch)? Remembered per array. */
export function isConvexPoly(poly) {
  let known = convexKnown.get(poly)
  if (known === undefined) {
    known = true
    const n = poly.length
    let sign = 0
    for (let i = 0; i < n && known; i++) {
      const a = poly[i]
      const b = poly[(i + 1) % n]
      const c = poly[(i + 2) % n]
      const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
      if (Math.abs(cross) < 1e-7) continue
      if (!sign) sign = Math.sign(cross)
      else if (Math.sign(cross) !== sign) known = false
    }
    convexKnown.set(poly, known)
  }
  return known
}
// each polygon's edges are laid out flat once (x, z, the next x, the next z), because the fit asks this question
// about the same buildable area many thousands of times
const flatKnown = new WeakMap()
function flatOf(poly) {
  let f = flatKnown.get(poly)
  if (!f) {
    const n = poly.length
    f = new Float64Array(n * 4 + 4)
    let x0 = Infinity
    let x1 = -Infinity
    let z0 = Infinity
    let z1 = -Infinity
    for (let i = 0, j = n - 1; i < n; j = i++) {
      f[i * 4 + 4] = poly[i][0]
      f[i * 4 + 5] = poly[i][1]
      f[i * 4 + 6] = poly[j][0]
      f[i * 4 + 7] = poly[j][1]
      if (poly[i][0] < x0) x0 = poly[i][0]
      if (poly[i][0] > x1) x1 = poly[i][0]
      if (poly[i][1] < z0) z0 = poly[i][1]
      if (poly[i][1] > z1) z1 = poly[i][1]
    }
    f[0] = x0
    f[1] = x1
    f[2] = z0
    f[3] = z1
    flatKnown.set(poly, f)
  }
  return f
}
const inFlat = (f, x, z) => {
  if (x < f[0] || x > f[1] || z < f[2] || z > f[3]) return false
  let c = false
  for (let k = 4; k < f.length; k += 4) {
    const zi = f[k + 1]
    const zj = f[k + 3]
    if (zi > z !== zj > z && x < ((f[k + 2] - f[k]) * (z - zi)) / (zj - zi) + f[k]) c = !c
  }
  return c
}
const pointIn = (poly, p) => inFlat(flatOf(poly), p[0], p[1])
// a point inside a four-cornered shape; nothing is kept, because the shape is a new one every time
const inQuad = (quad, p) => {
  let c = false
  for (let i = 0, j = 3; i < 4; j = i++) {
    const zi = quad[i][1]
    const zj = quad[j][1]
    if (zi > p[1] !== zj > p[1] && p[0] < ((quad[j][0] - quad[i][0]) * (p[1] - zi)) / (zj - zi) + quad[i][0]) c = !c
  }
  return c
}
const crossAt = (p, q, a, b) => {
  const d = (q[0] - p[0]) * (b[1] - a[1]) - (q[1] - p[1]) * (b[0] - a[0])
  if (Math.abs(d) < 1e-12) return null
  const t = ((a[0] - p[0]) * (b[1] - a[1]) - (a[1] - p[1]) * (b[0] - a[0])) / d
  const u = ((a[0] - p[0]) * (q[1] - p[1]) - (a[1] - p[1]) * (q[0] - p[0])) / d
  return t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9 ? [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t] : null
}
/**
 * Where a four-cornered shape (corners in order, same coordinates as `poly`) leaves the polygon: the first corner
 * that is outside it, or, for a polygon with a notch, the point where an edge of the polygon cuts through the shape.
 * null when the shape is inside.
 */
export function outsidePoint(poly, quad) {
  for (const p of quad) if (!pointIn(poly, p)) return p
  if (isConvexPoly(poly)) return null
  // only the polygon's edges near the shape are looked at (the curve is a handful of short pieces in one corner)
  let x0 = Infinity
  let x1 = -Infinity
  let z0 = Infinity
  let z1 = -Infinity
  for (const [x, z] of quad) {
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (z < z0) z0 = z
    if (z > z1) z1 = z
  }
  for (const e of edgesOf(poly)) {
    if (e.x1 < x0 || e.x0 > x1 || e.z1 < z0 || e.z0 > z1) continue
    if (inQuad(quad, e.a)) return e.a
    for (let k = 0; k < 4; k++) {
      const hit = crossAt(quad[k], quad[(k + 1) % 4], e.a, e.b)
      if (hit) return hit
    }
  }
  return null
}
/**
 * The fit's own question, asked tens of thousands of times: is this box (square to the axes, same coordinates as
 * `poly`) wholly inside the polygon? The same answer as `!outsidePoint(poly, corners)`, with nothing allocated.
 */
export function boxInside(poly, x0, z0, x1, z1) {
  const f = flatOf(poly)
  if (x0 < f[0] || x1 > f[1] || z0 < f[2] || z1 > f[3]) return false
  if (!inFlat(f, x0, z0) || !inFlat(f, x1, z0) || !inFlat(f, x1, z1) || !inFlat(f, x0, z1)) return false
  if (isConvexPoly(poly)) return true
  // a notch: no edge of the polygon may pass through the inside of the box
  const E = 1e-7
  const ax = x0 + E
  const bx = x1 - E
  const az = z0 + E
  const bz = z1 - E
  for (let k = 4; k < f.length; k += 4) {
    const px = f[k]
    const pz = f[k + 1]
    const qx = f[k + 2]
    const qz = f[k + 3]
    if ((px < ax && qx < ax) || (px > bx && qx > bx) || (pz < az && qz < az) || (pz > bz && qz > bz)) continue
    // the piece of the edge inside the box, if any (Liang and Barsky)
    let t0 = 0
    let t1 = 1
    const dx = qx - px
    const dz = qz - pz
    let hit = true
    for (let side = 0; side < 4 && hit; side++) {
      const pp = side === 0 ? -dx : side === 1 ? dx : side === 2 ? -dz : dz
      const qq = side === 0 ? px - ax : side === 1 ? bx - px : side === 2 ? pz - az : bz - pz
      if (pp === 0) {
        if (qq < 0) hit = false
      } else {
        const r = qq / pp
        if (pp < 0) {
          if (r > t1) hit = false
          else if (r > t0) t0 = r
        } else if (r < t0) hit = false
        else if (r < t1) t1 = r
      }
    }
    if (hit && t1 - t0 > 1e-9) return false
  }
  return true
}
const edgesKnown = new WeakMap()
function edgesOf(poly) {
  let list = edgesKnown.get(poly)
  if (!list) {
    list = poly.map((a, i) => {
      const b = poly[(i + 1) % poly.length]
      return { a, b, x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]), z0: Math.min(a[1], b[1]), z1: Math.max(a[1], b[1]) }
    })
    edgesKnown.set(poly, list)
  }
  return list
}

const envelopeKept = new Map()
const envelopeWork = { made: 0, reused: 0, runsTried: 0 }
/** How many envelopes were worked out, answered from the kept ones, and how many runs were tried (for the tests). */
export const envelopeStats = () => ({ ...envelopeWork })
export function envelopeOf(boundary, setbackPerEdge) {
  // round 12, item 5: the same outline and setbacks give the same envelope, and a lot is rebuilt on every save and
  // every keystroke of the Lot step: the last 64 are kept. Callers get their own copy of the points.
  const key = JSON.stringify([boundary, setbackPerEdge])
  let hit = envelopeKept.get(key)
  if (hit) {
    envelopeKept.delete(key)
    envelopeWork.reused++
  } else {
    hit = envelopeNow(boundary, setbackPerEdge)
    envelopeWork.made++
    if (envelopeKept.size >= 64) envelopeKept.delete(envelopeKept.keys().next().value)
  }
  envelopeKept.set(key, hit)
  return hit.map((p) => [...p])
}
function envelopeNow(boundary, setbackPerEdge) {
  const n = boundary.length
  const area = (poly) => (poly.length >= 3 ? Math.abs(polygonArea(poly)) : 0)
  const inwardOf = (i) => {
    const nrm = outwardNormal(boundary, i)
    return [-nrm[0], -nrm[1]]
  }
  const clip = (runs) => {
    const inRun = new Set(runs.flat())
    let poly = boundary.map((p) => [...p])
    for (let i = 0; i < n && poly.length >= 3; i++) {
      if (inRun.has(i)) continue
      const off = setbackPerEdge[i] ?? 0
      const inward = inwardOf(i)
      const a = boundary[i]
      poly = clipHalfPlane(poly, [a[0] + inward[0] * off, a[1] + inward[1] * off], inward)
    }
    for (const run of runs) {
      if (poly.length < 3) break
      let mx = 0
      let mz = 0
      for (const i of run) {
        const a = boundary[i]
        const b = boundary[(i + 1) % n]
        const len = Math.hypot(b[0] - a[0], b[1] - a[1])
        const inward = inwardOf(i)
        mx += inward[0] * len
        mz += inward[1] * len
      }
      const ml = Math.hypot(mx, mz)
      if (ml < 1e-9) return []
      const mean = [mx / ml, mz / ml]
      let deepest = -Infinity
      for (const i of run) for (const p of [boundary[i], boundary[(i + 1) % n]]) deepest = Math.max(deepest, p[0] * mean[0] + p[1] * mean[1])
      const at = deepest + (setbackPerEdge[run[0]] ?? 0)
      poly = clipHalfPlane(poly, [mean[0] * at, mean[1] * at], mean)
    }
    if (poly.length < 3) return []
    // drop the near-duplicate points arcs leave behind
    return poly.filter((p, i) => i === 0 || Math.hypot(p[0] - poly[i - 1][0], p[1] - poly[i - 1][1]) > 0.05)
  }
  let best = clip([])
  // runs: neighbours with the same setback, each turning under 30 degrees from the one before, under 120 in all
  const turn = (i, j) => {
    const a = inwardOf(i)
    const b = inwardOf(j)
    return (Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1]))) * 180) / Math.PI
  }
  const joins = (i) => (setbackPerEdge[i] ?? 0) > 0 && (setbackPerEdge[i] ?? 0) === (setbackPerEdge[(i + 1) % n] ?? 0) && turn(i, (i + 1) % n) < 30
  if (n < 4 || !boundary.some((_, i) => joins(i)) || boundary.every((_, i) => joins(i))) return best
  const start = boundary.findIndex((_, i) => !joins((i - 1 + n) % n))
  const found = []
  let run = []
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n
    run.push(i)
    if (!joins(i) || turn(run[0], (i + 1) % n) >= 120) {
      // a curve is three chords or more (round 12): two edges meeting at a shallow angle are left edge by edge
      if (run.length >= 3) found.push(run)
      run = []
    }
  }
  let kept = []
  let bestSf = area(best)
  for (const r of found) {
    envelopeWork.runsTried++
    const cand = clip([...kept, r])
    if (area(cand) > bestSf + 1) {
      best = cand
      bestSf = area(cand)
      kept = [...kept, r]
    }
  }
  if (!kept.length) return best
  // Round 12, item A: a run that curves into the lot is followed, not cut straight. Everything within the setback of
  // any piece of the run is taken off (a strip along each piece, a round at each corner drawn a hair large so it
  // errs on the safe side); the other edges keep their straight lines. The result has a notch where the curve is.
  try {
    const inRun = new Set(kept.flat())
    let base = boundary.map((p) => [...p])
    for (let i = 0; i < n && base.length >= 3; i++) {
      if (inRun.has(i)) continue
      const off = setbackPerEdge[i] ?? 0
      const inward = inwardOf(i)
      const a = boundary[i]
      base = clipHalfPlane(base, [a[0] + inward[0] * off, a[1] + inward[1] * off], inward)
    }
    if (base.length < 3) return best
    const ring = (pts) => [[...pts, pts[0]]]
    const SEG = 20
    const off = []
    for (const i of inRun) {
      const s = setbackPerEdge[i] ?? 0
      const a = boundary[i]
      const b = boundary[(i + 1) % n]
      const inward = inwardOf(i)
      // the strip, a little past the edge on the outside so nothing is left along the lot line
      off.push([ring([[a[0] - inward[0], a[1] - inward[1]], [b[0] - inward[0], b[1] - inward[1]], [b[0] + inward[0] * s, b[1] + inward[1] * s], [a[0] + inward[0] * s, a[1] + inward[1] * s]])])
      const R = s / Math.cos(Math.PI / SEG)
      for (const c of [a, b]) {
        const round = []
        for (let k = 0; k < SEG; k++) round.push([c[0] + R * Math.cos((2 * Math.PI * k) / SEG), c[1] + R * Math.sin((2 * Math.PI * k) / SEG)])
        off.push([ring(round)])
      }
    }
    const left = polygonClipping.difference([ring(base)], ...off)
    let curved = null
    for (const piece of left) {
      const outer = piece[0].slice(0, -1)
      if (!curved || area(outer) > area(curved)) curved = outer
    }
    if (curved && curved.length >= 3 && area(curved) > bestSf + 1) {
      // drop points closer than half an inch (the rounds leave a few)
      best = curved.filter((p, i) => i === 0 || Math.hypot(p[0] - curved[i - 1][0], p[1] - curved[i - 1][1]) > 0.04)
    }
  } catch {
    /* the straight line stands */
  }
  return best
}

/** Outward unit normal of boundary edge i. */
function outwardNormal(boundary, i) {
  const n = boundary.length
  const a = boundary[i]
  const b = boundary[(i + 1) % n]
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const l = Math.hypot(dx, dz) || 1
  const c = polygonCentroid(boundary)
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  let nx = -dz / l
  let nz = dx / l
  if ((mid[0] + nx - c[0]) ** 2 + (mid[1] + nz - c[1]) ** 2 < (mid[0] - nx - c[0]) ** 2 + (mid[1] - nz - c[1]) ** 2) {
    nx = -nx
    nz = -nz
  }
  return [nx, nz]
}

// a street side drawn in several pieces (a curved frontage) carries the street's name on one piece only: the others
// are labelled with it too, never "SIDE" (round 11)
const labelFor = (edge, frontName) => {
  const name = edge.street || (edge.kind === 'front' ? frontName || 'FRONT' : '')
  return `${edge.setback}' — ${name ? name.toUpperCase() : edge.kind === 'rear' ? 'REAR' : 'SIDE'}`
}

/**
 * Why a lot cannot be drafted on yet, in one sentence, or null: a size still being typed (under 20 ft),
 * setbacks that leave no buildable area, or a lot under the city's minimum. The Lot step shows the
 * last good lot while this is set, so a half-typed depth never blanks the page.
 */
/**
 * Round 14: a plat is on file but the office could not read it, so the homeowner typed the width and depth it shows.
 * The lot is a plat lot, so a drafter confirms it against the file like any other plat, and its four calls are that
 * rectangle (rear, right side, front, left side: the same corners as a typed lot, the street to the south). `typed`
 * keeps what was typed so the lot step can show it again.
 */
export function platFromTyped(spec, plat) {
  const W = +spec.width
  const D = +spec.depth
  const streets = []
  if (spec.frontStreet) streets.push({ edge: 2, name: String(spec.frontStreet) })
  if (spec.corner === 'left' || spec.corner === 'right') streets.push({ edge: spec.corner === 'right' ? 1 : 3, name: String(spec.sideStreet || ''), role: 'side' })
  return {
    kind: 'plat',
    address: spec.address || '',
    city: spec.city,
    county: spec.county,
    calls: [
      { bearing: `N 90°00'00" E`, distance: W },
      { bearing: `S 00°00'00" E`, distance: D },
      { bearing: `N 90°00'00" W`, distance: W },
      { bearing: `N 00°00'00" E`, distance: D },
    ],
    front: 2,
    rear: 0,
    streets,
    frontStreet: spec.frontStreet || '',
    setbacks: spec.setbacks || {},
    ...(spec.noStreetGarage ? { noStreetGarage: true } : {}),
    platId: plat?.platId || spec.platId || null,
    confirmed: false,
    readConfidence: 0,
    typedBy: 'homeowner',
    typed: { width: W, depth: D, frontStreet: spec.frontStreet || '', corner: spec.corner || '', sideStreet: spec.sideStreet || '' },
  }
}

export function lotProblem(spec, lot, lang = 'en') {
  // round 13: the same sentences in Spanish for a homeowner who reads Spanish (the English ones are unchanged)
  if (lang === 'es') return lotProblemEs(spec, lot)
  if (spec?.kind === 'manual') {
    const W = +spec.width
    const D = +spec.depth
    if (!(W >= 20)) return 'Enter the lot width in feet (20 ft or more).'
    if (!(D >= 20)) return 'Enter the lot depth in feet (20 ft or more).'
  }
  // a parcel from the appraisal district (round 7, item 7): at least three calls, closing within 1.5 ft
  if (spec?.kind === 'parcel') {
    if (!Array.isArray(spec.calls) || spec.calls.length < 3) return 'The parcel outline needs at least three sides; a drafter can draw it from the plat.'
    if (lot && lot.closure > 1.5) return `The parcel outline does not close (off by ${lot.closure} ft); a drafter checks it against the plat.`
  }
  if (!lot) return 'The lot could not be built from these numbers.'
  if (!lot.envelope || lot.envelope.length < 3 || !(lot.envelopeSf > 0)) {
    const r = lot.rules || {}
    return `The setbacks leave no buildable area: ${r.front ?? 25}' front and ${r.rear ?? 10}' rear need a lot deeper than ${(r.front ?? 25) + (r.rear ?? 10)} ft, ${r.side ?? 5}' each side a lot wider than ${2 * (r.side ?? 5)} ft.`
  }
  if (lot.envelopeSf < 1500) return 'The buildable area is very small. Check the dimensions and the setbacks.'
  return null
}

/** `lotProblem` in Spanish. No jargon: the space the city keeps open along each edge of the lot is said in those words. */
function lotProblemEs(spec, lot) {
  if (spec?.kind === 'manual') {
    if (!(+spec.width >= 20)) return 'Escribe el ancho del lote en pies (20 pies o más).'
    if (!(+spec.depth >= 20)) return 'Escribe el fondo del lote en pies (20 pies o más).'
  }
  if (spec?.kind === 'parcel') {
    if (!Array.isArray(spec.calls) || spec.calls.length < 3) return 'El contorno del lote necesita por lo menos tres lados; un dibujante lo puede trazar con el plat.'
    if (lot && lot.closure > 1.5) return `El contorno del lote no cierra (le faltan ${lot.closure} pies); un dibujante lo revisa con el plat.`
  }
  if (!lot) return 'No pudimos dibujar el lote con estas medidas.'
  if (!lot.envelope || lot.envelope.length < 3 || !(lot.envelopeSf > 0)) {
    const r = lot.rules || {}
    return `El espacio que la ciudad mantiene libre a lo largo de las orillas no deja lugar para construir: ${r.front ?? 25} pies al frente y ${r.rear ?? 10} pies al fondo piden un lote de más de ${(r.front ?? 25) + (r.rear ?? 10)} pies de fondo, y ${r.side ?? 5} pies de cada lado, un lote de más de ${2 * (r.side ?? 5)} pies de ancho.`
  }
  if (lot.envelopeSf < 1500) return 'El área donde se puede construir es muy chica. Revisa las medidas y el espacio que la ciudad mantiene libre a lo largo de cada orilla del lote.'
  return null
}

/**
 * Does the lot's zoning stop the design from being sent (decision B6, round 10 item 4)? Zoning never stops a homeowner
 * from drafting: on the Rooms and Draft steps it is a warning. It blocks Send only when the zoning is known to belong
 * to this lot: a parcel or plat lot (the district was read at the parcel the homeowner took), or a typed lot whose
 * zoning a drafter has confirmed.
 */
export function zoningBlocksSend(lot) {
  const z = lot?.zoning
  if (!z || z.residential !== false) return false
  const kind = lot.kind || lot.spec?.kind
  if (kind === 'parcel' || kind === 'plat') return true
  return !!z.confirmedBy
}

export const MAX_TURN = 15
/** The turn a lot spec asks for, in degrees, held to 15 either way (0 when none). */
export function lotTurn(spec) {
  const t = +spec?.turn
  return Number.isFinite(t) ? Math.max(-MAX_TURN, Math.min(MAX_TURN, t)) : 0
}
/** The same lot with the house turned `deg` from square to the street (replacing any turn it had). */
export function turnLot(lot, deg) {
  if (!lot?.spec || lot.spec.kind === 'reference') return lot
  const was = lotTurn(lot.spec)
  const now = lotTurn({ turn: deg })
  return { ...lot, angle: lot.angle + ((now - was) * Math.PI) / 180, spec: { ...lot.spec, turn: now } }
}
/**
 * The largest rectangle, square to the house, that fits inside the buildable area: { w, d, areaSf } in feet, w across
 * the street side and d front to back. This is what a house plan has to fit in; the area's bounding box (90 x 56 ft
 * on the Kiskadee wedge, where the largest rectangle is about 40 x 40) is not. `turn` looks at the lot turned that
 * many more degrees. Columns across the area are compared, so an area with a notch (a curved street side) is measured
 * as it is: the rectangle stops where the curve comes in.
 */
export function insideRect(lot, turn = 0) {
  const env = lot?.envelope || []
  if (env.length < 3) return { w: 0, d: 0, areaSf: 0 }
  const a = (lot.angle || 0) + (turn * Math.PI) / 180
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  const c = lot.centre || [0, 0]
  const pts = env.map(([X, Z]) => [(X - c[0]) * cos + (Z - c[1]) * sin, -(X - c[0]) * sin + (Z - c[1]) * cos])
  const xs = pts.map((p) => p[0])
  const lo = Math.min(...xs)
  const hi = Math.max(...xs)
  // the area's reach front to back at a given x: one stretch for a convex area, more where it has a notch
  const spans = (x) => {
    const hits = []
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]
      const q = pts[(i + 1) % pts.length]
      if (p[0] > x === q[0] > x) continue
      hits.push(p[1] + ((x - p[0]) / (q[0] - p[0])) * (q[1] - p[1]))
    }
    hits.sort((u, v) => u - v)
    const out = []
    for (let k = 0; k + 1 < hits.length; k += 2) out.push([hits[k], hits[k + 1]])
    return out
  }
  const N = 48
  const at = []
  // (columns a hair inside the two ends, where the area has no depth)
  for (let i = 0; i <= N; i++) {
    const x = lo + (hi - lo) * (0.001 + (0.998 * i) / N)
    at.push([x, spans(x)])
  }
  const meet = (A, B) => {
    const out = []
    for (const a of A) for (const b of B) {
      const z0 = Math.max(a[0], b[0])
      const z1 = Math.min(a[1], b[1])
      if (z1 > z0) out.push([z0, z1])
    }
    return out
  }
  let best = { w: 0, d: 0, areaSf: 0 }
  for (let i = 0; i < N; i++) {
    // what every column from i to j shares: the rectangle's reach front to back
    let common = at[i][1]
    for (let j = i + 1; j <= N && common.length; j++) {
      common = meet(common, at[j][1])
      const w = at[j][0] - at[i][0]
      for (const [z0, z1] of common) {
        const d = z1 - z0
        if (w * d > best.areaSf) {
          // its corners on the lot (world feet), for whoever wants to draw or check it
          const world = [[at[i][0], z0], [at[j][0], z0], [at[j][0], z1], [at[i][0], z1]].map(([x, z]) => [c[0] + x * cos - z * sin, c[1] + x * sin + z * cos])
          best = { w, d, areaSf: w * d, corners: world }
        }
      }
    }
  }
  return best
}

/** Build the full lot from a spec. Deterministic, so the server can repeat it. */
export function buildLot(spec = { kind: 'reference' }, table = cityTable()) {
  if (!spec || spec.kind === 'reference') return referenceLot()
  // no city rules yet: the lot keeps its empty city (the price asks for a county); the county's row shapes the envelope
  const city = table[spec.city] ? spec.city : spec.city === '' ? '' : 'hidalgo'
  const countyRow = !table[spec.city] && spec.county ? Object.keys(table).find((id) => table[id].kind === 'county' && table[id].county === spec.county) : null
  // the rules are resolved against the lot's own width and depth (round 7: Pharr's rear as a share of the depth,
  // Weslaco's lesser-of, Hidalgo County's half right of way, McAllen's narrow lots of record), so the geometry
  // comes first and the setbacks after
  let rules = null
  const rulesWith = (dims) => (rules = rulesFor(city || countyRow || 'hidalgo', { ...(spec.setbacks || {}), county: spec.county }, table, { ...dims, rowFt: spec.rowFt }))
  let boundary
  let corners
  let edges // per corner-edge: { kind, street, setback }
  let arcs = []
  let closure = 0
  let dims = { width: null, depth: null }
  if (spec.kind === 'manual') {
    const W = Math.max(20, +spec.width || 0)
    const D = Math.max(20, +spec.depth || 0)
    dims = { width: W, depth: D }
    rulesWith(dims)
    corners = [
      [0, 0],
      [W, 0],
      [W, D],
      [0, D],
    ] // clockwise: rear-left, rear-right, front-right, front-left; the street is south
    boundary = corners
    const sideKind = (which) => (spec.corner === which ? 'streetSide' : 'side')
    edges = [
      { kind: 'rear', setback: rules.rear },
      { kind: sideKind('right'), street: spec.corner === 'right' ? spec.sideStreet : undefined, setback: spec.corner === 'right' ? rules.streetSide : rules.side },
      { kind: 'front', street: spec.frontStreet || 'street', setback: rules.front },
      { kind: sideKind('left'), street: spec.corner === 'left' ? spec.sideStreet : undefined, setback: spec.corner === 'left' ? rules.streetSide : rules.side },
    ]
  } else if (spec.kind === 'plat' || spec.kind === 'parcel') {
    // a parcel from the appraisal district is a plat whose calls were computed from the polygon (round 7, item 7)
    const t = traverse(spec.calls || [])
    boundary = t.boundary
    corners = t.corners
    arcs = t.arcs
    closure = t.closure
    const streets = spec.streets || []
    const frontIdx = spec.front ?? streets[0]?.edge ?? 0
    // the lot's width (the front edge) and depth (how far the far corner sits behind the front line)
    {
      const a = corners[frontIdx % corners.length] || [0, 0]
      const b = corners[(frontIdx + 1) % corners.length] || [0, 0]
      const len = Math.hypot(b[0] - a[0], b[1] - a[1])
      const nx = len ? (b[1] - a[1]) / len : 0
      const nz = len ? -(b[0] - a[0]) / len : 1
      const depth = Math.max(0, ...corners.map((c) => Math.abs((c[0] - a[0]) * nx + (c[1] - a[1]) * nz)))
      // a curved frontage is several chords (round 10): the parcel lookup gives their total as the lot's width
      const width = +spec.frontWidthFt > len ? +spec.frontWidthFt : len
      dims = { width: Math.round(width * 10) / 10, depth: Math.round(depth * 10) / 10 }
    }
    rulesWith(dims)
    edges = corners.map((_, i) => {
      const st = streets.find((s) => +s.edge === i)
      const forced = spec.kinds?.[i] // 'front' | 'side' | 'rear' | 'streetSide', when the drafter says so
      const kind = forced || (i === frontIdx ? 'front' : st ? 'streetSide' : spec.rear != null && +spec.rear === i ? 'rear' : 'side')
      return { kind, street: st?.name || (i === frontIdx ? spec.frontStreet : undefined), setback: kind === 'front' ? rules.front : kind === 'streetSide' ? rules.streetSide : kind === 'rear' ? rules.rear : rules.side }
    })
    // without a stated rear, the edge opposite the front is the rear
    if (spec.rear == null && !spec.kinds && corners.length >= 4) {
      const opp = (frontIdx + Math.floor(corners.length / 2)) % corners.length
      if (edges[opp].kind === 'side') edges[opp] = { ...edges[opp], kind: 'rear', setback: rules.rear }
    }
  } else throw new Error(`unknown lot kind ${spec.kind}`)

  // setback per boundary edge (arc pieces take the setback of the corner edge they belong to)
  const perEdge = []
  let ci = 0
  for (let i = 0; i < boundary.length; i++) {
    const b = boundary[i]
    const c = corners[(ci + 1) % corners.length]
    perEdge.push(edges[ci % edges.length].setback)
    if (c && Math.hypot(b[0] - c[0], b[1] - c[1]) < 1e-6 && i > 0) ci++
  }
  // align: perEdge[i] is the setback of the edge starting at boundary[i]
  const perEdgeAligned = boundary.map((p, i) => {
    let k = 0
    for (let j = 0; j < corners.length; j++) {
      const c = corners[j]
      if (Math.hypot(p[0] - c[0], p[1] - c[1]) < 1e-6) k = j
    }
    // points inside an arc keep the setback of the edge they are in
    return edges[edgeIndexOfBoundaryPoint(boundary, corners, i)]?.setback ?? perEdge[i]
  })
  const envelope = envelopeOf(boundary, perEdgeAligned)
  const frontName = edges.find((e) => e.kind === 'front' && e.street)?.street || ''
  const frontEdge = edges.findIndex((e) => e.kind === 'front')
  const fi = Math.max(0, frontEdge)
  // the house faces the street: square to the front edge, or to the middle of a street side drawn in several pieces
  // (a curved frontage: the length-weighted mean of its pieces, round 11)
  const fronts = edges.map((e, i) => (e.kind === 'front' ? i : -1)).filter((i) => i >= 0)
  let nrm = outwardNormal(corners, fi)
  if (fronts.length > 1) {
    let sx = 0
    let sz = 0
    for (const i of fronts) {
      const a = corners[i]
      const b = corners[(i + 1) % corners.length]
      const len = Math.hypot(b[0] - a[0], b[1] - a[1])
      const o = outwardNormal(corners, i)
      sx += o[0] * len
      sz += o[1] * len
    }
    const sl = Math.hypot(sx, sz)
    if (sl > 1e-9) nrm = [sx / sl, sz / sl]
  }
  // round 12, item A: the house may be turned a little from square to the street (15 degrees at most either way)
  // to sit in the widest part of a wedge-shaped buildable area; the fit chooses the turn and it is kept on the spec
  const turn = lotTurn(spec)
  const angle = Math.atan2(nrm[1], nrm[0]) - Math.PI / 2 + (turn * Math.PI) / 180 // +lz of the house frame points at the street
  const envC = polygonCentroid(envelope)
  const centre = isFinite(envC[0]) ? envC : polygonCentroid(boundary)
  const areaSf = Math.abs(polygonArea(boundary))
  const streets = edges
    .map((e, i) => (e.street ? { name: e.street, pts: extendPolyline([corners[i], corners[(i + 1) % corners.length]], 50, 50), edge: i } : null))
    .filter(Boolean)
  // what the panel says about this lot's rules (round 7, items 8 and 9): the rows with their sources, the derived
  // values, the flags (unknown or stale rules, a lot under today's minimum, an unplatted tract)
  const flags = [...(rules.flags || [])]
  if (rules.minLotSf && areaSf < rules.minLotSf - 1) flags.push(`below today's minimum lot size (${Math.round(areaSf).toLocaleString()} sf, the district asks ${rules.minLotSf.toLocaleString()} sf); lots of record usually still build. The drafter confirms.`)
  if (rules.minLotWidth && dims.width && dims.width < rules.minLotWidth - 0.05) flags.push(`below today's minimum lot width (${dims.width} ft, the district asks ${rules.minLotWidth} ft); lots of record usually still build. The drafter confirms.`)
  const legal = spec.legal || spec.parcel?.legal || ''
  const unplatted = !!legal && /\b(ABST|ABSTRACT|TRACT|TR|ACRES?|AC)\b/i.test(legal) && !/\b(LOT|LT|BLK|BLOCK)\b/i.test(legal)
  if (unplatted) flags.push('no recorded subdivision in the legal description: platting needed before a permit (drafter task)')
  const jurisdiction = spec.jurisdiction || { type: table[city]?.kind === 'county' || !city ? 'county' : 'city', id: city || countyRow || 'hidalgo', name: rules.name, county: rules.county || spec.county || null, etj: null, source: spec.kind === 'manual' ? 'picked on the lot step' : 'from the lot' }
  return {
    kind: spec.kind,
    source: spec.kind,
    spec,
    address: spec.address || '',
    city,
    cityName: city ? rules.name : countyRow ? table[countyRow].name : 'no city rules yet (county defaults)',
    rules,
    rulesUsed: rules.used || [],
    ruleNotes: rules.derived || [],
    flags,
    unplatted,
    jurisdiction,
    dims,
    parcel: spec.kind === 'parcel' ? { propId: spec.propId || null, geoId: spec.geoId || null, legal: legal || null, acres: spec.acres ?? null, source: spec.source || null, fetchedAt: spec.parcelFetchedAt || null, matchedBy: spec.matchedBy || null, confidence: spec.confidence || null } : null,
    boundary: boundary.map(([x, z]) => [r2(x), r2(z)]),
    corners: corners.map(([x, z]) => [r2(x), r2(z)]),
    arcs,
    closure,
    edges: edges.map((e, i) => ({ ...e, label: labelFor(e, frontName), index: i })),
    envelope: envelope.map(([x, z]) => [r2(x), r2(z)]),
    envelopeLabels: edges.map((e) => labelFor(e, frontName)),
    envelopeSf: Math.abs(polygonArea(envelope)),
    areaSf,
    centroid: polygonCentroid(boundary),
    centre: [r2(centre[0]), r2(centre[1])],
    angle,
    streets,
    confirmed: spec.kind === 'plat' || spec.kind === 'parcel' ? !!spec.confirmed : true,
    corner: spec.kind === 'manual' ? !!spec.corner : edges.some((e) => e.kind === 'streetSide'),
    flood: spec.flood || null,
    zoning: spec.zoning || null,
    wind: spec.wind || null,
  }
}

function edgeIndexOfBoundaryPoint(boundary, corners, i) {
  // the corner edge that boundary point i starts on: the last corner at or before it
  let k = 0
  for (let j = 0; j <= i; j++) {
    const p = boundary[j]
    const idx = corners.findIndex((c) => Math.hypot(p[0] - c[0], p[1] - c[1]) < 1e-6)
    if (idx >= 0) k = idx
  }
  return k
}

/** Lot 514, Villa-Rama East Phase V, Palmview: the recorded plat, as before. */
export function referenceLot() {
  const rules = rulesFor('palmview', { front: 10, side: 6, rear: 20, streetSide: 25 })
  return {
    kind: 'reference',
    source: 'reference',
    spec: { kind: 'reference' },
    address: 'Lot 514, Villa-Rama East Phase V, Palmview TX',
    city: 'palmview',
    cityName: rules.name,
    rules,
    boundary: BOUNDARY,
    corners: LOT_CORNERS,
    arcs: [{ radius: 50, delta: REF_ARC.deltaDeg, arcLength: REF_ARC.arcLength, chord: REF_ARC.chord }],
    closure: 0,
    edges: SETBACK_EDGE_LABELS.map((label, i) => ({ label, index: i, setback: parseInt(label), kind: i === 2 ? 'front' : i === 0 ? 'side' : 'streetSide', street: label.split('— ')[1] })),
    envelope: SETBACK_CORNERS,
    envelopeLabels: SETBACK_EDGE_LABELS,
    envelopeSf: Math.abs(polygonArea(SETBACK_CORNERS)),
    areaSf: Math.abs(polygonArea(BOUNDARY)),
    centroid: polygonCentroid(BOUNDARY),
    centre: [SETBACK_CORNERS.reduce((s, p) => s + p[0], 0) / 4, SETBACK_CORNERS.reduce((s, p) => s + p[1], 0) / 4],
    angle: REF_ANGLE,
    streets: REF_STREETS,
    confirmed: true,
    flood: null,
    label: 'LOT 514',
  }
}

export const DEFAULT_LOT = referenceLot()

/** House frame → world: local x along the front, local z toward the street. */
export function worldOf(lot, lx, lz, centre = lot.centre) {
  const cos = Math.cos(lot.angle)
  const sin = Math.sin(lot.angle)
  return [centre[0] + lx * cos - lz * sin, centre[1] + lx * sin + lz * cos]
}

/** Calls derived from the reference lot's corners, the way a plat would list them. */
export function referenceCalls() {
  const c = LOT_CORNERS
  const line = (a, b) => ({ bearing: vectorToBearing([b[0] - a[0], b[1] - a[1]]), distance: r2(Math.hypot(b[0] - a[0], b[1] - a[1])) })
  return [
    line(c[0], c[1]),
    { curve: { radius: REF_ARC.R, delta: r2(REF_ARC.deltaDeg), chord: REF_ARC.chord, chordBearing: vectorToBearing([c[2][0] - c[1][0], c[2][1] - c[1][1]]), direction: 'right' } },
    line(c[2], c[3]),
    line(c[3], c[4]),
    line(c[4], c[5]),
    line(c[5], c[6]),
    line(c[6], c[0]),
  ]
}
