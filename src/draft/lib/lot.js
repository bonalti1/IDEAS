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
/** Inset polygon: setback per boundary edge (feet). Convex result; a notch in the lot is cut off, which is the safe side. */
export function envelopeOf(boundary, setbackPerEdge) {
  const n = boundary.length
  let poly = boundary.map((p) => [...p])
  for (let i = 0; i < n; i++) {
    const off = setbackPerEdge[i] ?? 0
    const nrm = outwardNormal(boundary, i)
    const inward = [-nrm[0], -nrm[1]]
    const a = boundary[i]
    poly = clipHalfPlane(poly, [a[0] + inward[0] * off, a[1] + inward[1] * off], inward)
    if (poly.length < 3) return []
  }
  // drop the near-duplicate points arcs leave behind
  return poly.filter((p, i) => i === 0 || Math.hypot(p[0] - poly[i - 1][0], p[1] - poly[i - 1][1]) > 0.05)
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

const labelFor = (edge) => `${edge.setback}' — ${edge.street ? edge.street.toUpperCase() : edge.kind === 'rear' ? 'REAR' : 'SIDE'}`

/**
 * Why a lot cannot be drafted on yet, in one sentence, or null: a size still being typed (under 20 ft),
 * setbacks that leave no buildable area, or a lot under the city's minimum. The Lot step shows the
 * last good lot while this is set, so a half-typed depth never blanks the page.
 */
export function lotProblem(spec, lot) {
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
  const frontEdge = edges.findIndex((e) => e.kind === 'front')
  const fi = Math.max(0, frontEdge)
  const nrm = outwardNormal(corners, fi)
  const angle = Math.atan2(nrm[1], nrm[0]) - Math.PI / 2 // +lz of the house frame points at the street
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
    edges: edges.map((e, i) => ({ ...e, label: labelFor(e), index: i })),
    envelope: envelope.map(([x, z]) => [r2(x), r2(z)]),
    envelopeLabels: edges.map(labelFor),
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
