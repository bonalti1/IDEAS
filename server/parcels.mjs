// The parcel lookup service (round 7, item 3): an address → the appraisal district's parcel polygon, cleaned
// into surveyor's calls the lot engine already understands, with the legal description, the ids, the situs,
// and (drafter-only) the owner and mailing address. Free county ArcGIS layers first (server/parcel-sources.mjs),
// Regrid only when REGRID_API_TOKEN is set. Every answer is advisory: a recorded plat or survey wins.
//
// The matching pipeline stops at the first step that gives exactly one parcel:
//   1. the Census geocoder: county, place, and the street-line point (never inside the lot)
//   2. the county's address points (Hidalgo, Willacy): fulladdr + municipality → parcel_id → the parcel
//   3. an attribute query on the house number and street (whitelisted fields, quotes escaped)
//   4. a 40 m buffer around the Census point, keeping the candidates whose situs starts with the number and holds the street
//   5. otherwise { match: 'none', candidates } (up to 6, nearest first) so the client taps their lot
import { vectorToBearing, traverse } from '../src/draft/lib/lot.js'
import { PARCEL_SOURCES, ROAD_SOURCE, sourcesFor, sourceById, TEST_ADDRESSES } from './parcel-sources.mjs'

const fail = (status, error, extra = {}) => Object.assign(new Error(error), { status, ...extra })
export const COUNTY_DOWN = 'The county parcel map did not answer; type the lot in or try again in a moment. The drafter can pull the parcel later.'
const now = () => new Date().toISOString()
const FT_PER_M = 3.280839895
const EARTH_FT = 20902231 // mean radius, feet
const CACHE_DAYS = 30
const TIMEOUT_MS = 8000
const ROAD_TIMEOUT_MS = 6000
const RECORD_V = 2 // round 10: the front edge comes from the named road; older cached parcels are read again
const MAX_SOURCES = 2
const BREAKER_FAILS = 3
const BREAKER_MIN = 10

// ── geometry: WGS84 → feet on a local tangent plane, ring cleaning, surveyor's calls ──────────────────
/** Project lon/lat points to feet, x east and y north, on a tangent plane at the centroid (within 0.1% on a city lot). */
export function projectRing(ring) {
  const lon0 = ring.reduce((a, p) => a + p[0], 0) / ring.length
  const lat0 = ring.reduce((a, p) => a + p[1], 0) / ring.length
  const k = Math.cos((lat0 * Math.PI) / 180)
  const toFt = ([lon, lat]) => [((lon - lon0) * Math.PI * EARTH_FT * k) / 180, ((lat - lat0) * Math.PI * EARTH_FT) / 180]
  return { pts: ring.map(toFt), origin: [lon0, lat0], toFt, toLonLat: ([x, y]) => [lon0 + (x * 180) / (Math.PI * EARTH_FT * k), lat0 + (y * 180) / (Math.PI * EARTH_FT)] }
}
export const signedArea = (pts) => pts.reduce((a, p, i) => {
  const q = pts[(i + 1) % pts.length]
  return a + (p[0] * q[1] - q[0] * p[1])
}, 0) / 2
/**
 * Clean a ring (feet): drop the closing duplicate, drop edges under 1 ft, merge vertices whose turn is under 2°,
 * force clockwise (north up, as a plat is read). Returns { pts, dropped: { short, straight } }.
 */
export function cleanRing(ptsIn, { minEdgeFt = 1.0, maxTurnDeg = 2 } = {}) {
  let pts = ptsIn.map((p) => [p[0], p[1]])
  const same = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6
  if (pts.length > 1 && same(pts[0], pts[pts.length - 1])) pts.pop()
  let short = 0
  let straight = 0
  // short edges: merge the vertex into the next one
  for (let guard = 0; guard < 50; guard++) {
    const i = pts.findIndex((p, k) => Math.hypot(p[0] - pts[(k + 1) % pts.length][0], p[1] - pts[(k + 1) % pts.length][1]) < minEdgeFt)
    if (i < 0 || pts.length <= 3) break
    pts.splice(i, 1)
    short++
  }
  // straight runs: drop a vertex whose turn is under the angle
  for (let guard = 0; guard < 100; guard++) {
    let dropped = false
    for (let i = 0; i < pts.length && pts.length > 3; i++) {
      const a = pts[(i - 1 + pts.length) % pts.length]
      const b = pts[i]
      const c = pts[(i + 1) % pts.length]
      const h1 = Math.atan2(b[1] - a[1], b[0] - a[0])
      const h2 = Math.atan2(c[1] - b[1], c[0] - b[0])
      let turn = Math.abs(((h2 - h1 + Math.PI) % (2 * Math.PI)) - Math.PI)
      turn = (turn * 180) / Math.PI
      if (turn < maxTurnDeg) {
        pts.splice(i, 1)
        straight++
        dropped = true
        break
      }
    }
    if (!dropped) break
  }
  // clockwise with north up: in an x-east, y-north frame a clockwise ring has a negative signed area
  if (signedArea(pts) > 0) pts.reverse()
  return { pts, dropped: { short, straight } }
}
/** The edges of a clean ring as surveyor's calls: { lengthFt, bearing }, so traverse() rebuilds the shape. */
export function ringToCalls(pts) {
  return pts.map((p, i) => {
    const q = pts[(i + 1) % pts.length]
    const dx = q[0] - p[0]
    const dy = q[1] - p[1]
    // the lot engine's frame has z toward the south (bearingToVector('N 0 E') is [0, -1]); east is +x in both
    return { distance: Math.round(Math.hypot(dx, dy) * 100) / 100, bearing: vectorToBearing([dx, -dy]) }
  })
}
const segDist = (p, a, b) => {
  const l2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / l2)) : 0
  return Math.hypot(p[0] - (a[0] + (b[0] - a[0]) * t), p[1] - (a[1] + (b[1] - a[1]) * t))
}
/** Each edge of a clean clockwise ring: its midpoint, length and outward unit normal (x east, y north). */
export function edgeFrames(pts) {
  const n = pts.length
  // a clockwise ring (negative signed area): the outward normal of the edge p → q is its left-hand normal
  const cw = signedArea(pts) <= 0
  return pts.map((p, i) => {
    const q = pts[(i + 1) % n]
    const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
    const len = Math.hypot(q[0] - p[0], q[1] - p[1])
    let nx = -(q[1] - p[1]) / (len || 1)
    let ny = (q[0] - p[0]) / (len || 1)
    if (!cw) {
      nx = -nx
      ny = -ny
    }
    return { i, a: p, b: q, mid, len, nx, ny }
  })
}
/** The nearest point of a polyline to p, and how far it is. */
const nearestOnLine = (p, line) => {
  let best = { d: Infinity, q: null }
  for (let k = 0; k < line.length - 1; k++) {
    const a = line[k]
    const b = line[k + 1]
    const l2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / l2)) : 0
    const q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
    const d = Math.hypot(p[0] - q[0], p[1] - q[1])
    if (d < best.d) best = { d, q }
  }
  return best
}
const DIR_RE = /^(N|S|E|W|NE|NW|SE|SW|NORTH|SOUTH|EAST|WEST)$/
/** A street's core name: upper case, no house number, no direction, no suffix ("N 27th St" → "27TH", "Curtis Clark Dr" → "CURTIS CLARK"). */
export function streetCore(name) {
  const words = String(name || '')
    .toUpperCase()
    .replace(/[.,()]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => SUFFIX[w] || w)
  if (words.length > 1 && /^\d+[A-Z]?$/.test(words[0]) && !/^(ST|ND|RD|TH)$/.test(words[1])) words.shift() // a leading house number
  const core = words.filter((w) => !DIR_RE.test(w))
  if (core.length > 1 && SUFFIX_SHORT.has(core[core.length - 1])) core.pop()
  return core.join(' ')
}
/** The suffix a street name ends with, the short way ("Kerria Avenue" → "AVE"), or null. */
export function streetSuffix(name) {
  const words = String(name || '').toUpperCase().replace(/[.,()]/g, ' ').split(/\s+/).filter(Boolean).map((w) => SUFFIX[w] || w).filter((w) => !DIR_RE.test(w))
  const last = words[words.length - 1]
  return words.length > 1 && SUFFIX_SHORT.has(last) ? last : null
}
const HWY_RE = /^(?:FM|RM|SH|US|IH|I|BUS|HWY|STATE HWY|US HWY|FARM TO MARKET|CO RD|COUNTY RD|CR)\s*-?\s*(\d+[A-Z]?)$/
/** Does this road carry the street's name? Directions and the suffix are ignored; "FM 495" matches the road whose base name is 495. */
export function sameStreet(road, street) {
  const want = streetCore(street)
  if (!want) return false
  const base = streetCore(road.base || '') || String(road.base || '').toUpperCase().trim()
  if (base && base === want) return true
  if (streetCore(road.name || '') === want) return true
  const h = want.match(HWY_RE)
  return !!h && String(road.base || '').toUpperCase().trim() === h[1]
}
/**
 * The front of a lot from the roads around it (round 10, item 1). pts is the clean clockwise ring in feet; roads are
 * [{ name, base, suffix, layer, lines: [[x, y], ...] }] in the same frame; streets are the names to look for, in order
 * (what the homeowner typed, what the Census matched); situs is the parcel's own situs string, searched for a road's
 * base name when no typed name matched. The front is the edge of 5 ft or more whose midpoint is nearest the named road
 * with its outward normal facing it; on a tie (within 3 ft) the shorter edge. Other named roads that run along an edge
 * make a corner lot (a side street) or a through lot (a street behind). Returns null when no road carries the name.
 */
export function frontFromRoads(pts, roads, { streets = [], situs = '', suffix = null, cornerFt = ROAD_SOURCE.cornerFt } = {}) {
  const named = (roads || []).filter((r) => r.name && r.lines?.length)
  if (!named.length) return null
  let mine = []
  for (const st of streets) {
    mine = named.filter((r) => sameStreet(r, st))
    if (mine.length) break
  }
  if (!mine.length && situs) {
    const hay = ' ' + String(situs).toUpperCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ') + ' '
    mine = named.filter((r) => {
      const b = streetCore(r.base || r.name)
      return b.length >= 2 && hay.includes(' ' + b + ' ')
    })
    // the longest base name wins ("ROYAL PALM" over "PALM")
    const longest = Math.max(0, ...mine.map((r) => streetCore(r.base || r.name).length))
    mine = mine.filter((r) => streetCore(r.base || r.name).length === longest)
  }
  if (!mine.length) return null
  // "27th St" over "27th Cir" when the address says which
  if (suffix && mine.some((r) => String(r.suffix || '').toUpperCase() === suffix)) mine = mine.filter((r) => String(r.suffix || '').toUpperCase() === suffix)
  const frames = edgeFrames(pts)
  const toRoads = (e, list) => {
    let best = { d: Infinity, facing: false, road: null }
    for (const r of list) for (const line of r.lines) {
      const hit = nearestOnLine(e.mid, line)
      if (hit.d < best.d) {
        const cos = hit.d > 0.01 ? ((hit.q[0] - e.mid[0]) * e.nx + (hit.q[1] - e.mid[1]) * e.ny) / hit.d : 1
        best = { d: hit.d, facing: cos > 0.5, road: r }
      }
    }
    return best
  }
  const scored = frames.filter((e) => e.len >= 5).map((e) => ({ e, ...toRoads(e, mine) }))
  if (!scored.length) return null
  const pool = scored.some((x) => x.facing) ? scored.filter((x) => x.facing) : scored
  pool.sort((a, b) => (Math.abs(a.d - b.d) <= 3 ? a.e.len - b.e.len || a.d - b.d : a.d - b.d))
  const front = pool[0]
  const frontName = front.road.name
  const frontCore = streetCore(front.road.base || front.road.name)
  // a curved frontage is several chords: every edge that faces the same road at about the same distance fronts on it
  const fronts = scored.filter((x) => x.facing && x.d <= front.d + 8).map((x) => x.e.i)
  if (!fronts.includes(front.e.i)) fronts.push(front.e.i)
  const kinds = frames.map((e) => (fronts.includes(e.i) ? 'front' : 'side'))
  const streetsOut = [{ edge: front.e.i, name: frontName, distFt: Math.round(front.d), role: 'front' }]
  // other named roads along an edge: a side street (corner lot) or a street behind (through lot)
  const others = named.filter((r) => streetCore(r.base || r.name) !== frontCore)
  const byName = new Map()
  for (const r of others) {
    const k = streetCore(r.base || r.name)
    byName.set(k, [...(byName.get(k) || []), r])
  }
  for (const list of byName.values()) {
    // a second name on the same centreline (S 10th St is also State Hwy 336) is the front street again, not a side street
    const alias = toRoads(front.e, list)
    if (alias.facing && Math.abs(alias.d - front.d) <= 12) continue
    const limit = Math.max(...list.map((r) => cornerFt[r.layer] ?? 40))
    const hits = frames.filter((e) => e.len >= 15 && !fronts.includes(e.i)).map((e) => ({ e, ...toRoads(e, list) })).filter((x) => x.facing && x.d <= limit).sort((a, b) => a.d - b.d)
    if (!hits.length) continue
    const h = hits[0]
    if (streetsOut.some((s) => s.edge === h.e.i)) continue
    const dot = h.e.nx * front.e.nx + h.e.ny * front.e.ny
    const role = dot <= -0.5 ? 'rear' : 'side'
    streetsOut.push({ edge: h.e.i, name: h.road.name, distFt: Math.round(h.d), role })
    if (role === 'side') kinds[h.e.i] = 'streetSide'
  }
  // the rear: every edge that faces away from the front; without one, the edge opposite the front
  let anyRear = false
  frames.forEach((e) => {
    if (kinds[e.i] !== 'side') return
    if (e.nx * front.e.nx + e.ny * front.e.ny <= -0.7 && e.len >= 5) {
      kinds[e.i] = 'rear'
      anyRear = true
    }
  })
  if (!anyRear && frames.length >= 4) {
    const opp = (front.e.i + Math.floor(frames.length / 2)) % frames.length
    if (kinds[opp] === 'side') kinds[opp] = 'rear'
  }
  const frontWidthFt = Math.round(fronts.reduce((a, i) => a + frames[i].len, 0) * 100) / 100
  return { frontEdge: front.e.i, frontBy: 'named-road', frontStreet: frontName, frontDistFt: Math.round(front.d), frontWidthFt, corner: streetsOut.some((s) => s.role === 'side'), streets: streetsOut, edgeKinds: kinds }
}
/** The edge kinds when only the front is known: the front, the rear facing away from it, sides for the rest. */
export function kindsFromFront(pts, frontEdge) {
  const frames = edgeFrames(pts)
  const f = frames[frontEdge] || frames[0]
  const kinds = frames.map((e) => (e.i === f.i ? 'front' : e.len >= 5 && e.nx * f.nx + e.ny * f.ny <= -0.7 ? 'rear' : 'side'))
  if (!kinds.includes('rear') && frames.length >= 4) kinds[(f.i + Math.floor(frames.length / 2)) % frames.length] = 'rear'
  return kinds
}
/** The edge an inside point is nearest, when it sits within 20 ft of one (an address point by the front door); else null. */
export function edgeNearPoint(pts, p, withinFt = 20) {
  const frames = edgeFrames(pts).filter((e) => e.len >= 5).map((e) => ({ e, d: segDist(p, e.a, e.b) })).sort((a, b) => (Math.abs(a.d - b.d) <= 3 ? a.e.len - b.e.len : a.d - b.d))
  return frames.length && frames[0].d <= withinFt ? frames[0].e.i : null
}
/** See normalize(): the edge facing the street point. Exported for the geometry tests. */
export function pickFrontEdge(pts, ref) {
  const n = pts.length
  const c = interiorPoint(pts)
  const edges = pts.map((p, i) => {
    const q = pts[(i + 1) % n]
    const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
    const len = Math.hypot(q[0] - p[0], q[1] - p[1])
    let nx = -(q[1] - p[1]) / (len || 1)
    let ny = (q[0] - p[0]) / (len || 1)
    // outward: away from the interior point
    if ((mid[0] - c[0]) * nx + (mid[1] - c[1]) * ny < 0) {
      nx = -nx
      ny = -ny
    }
    return { i, mid, len, nx, ny }
  })
  if (!ref) {
    // no street point: the edge whose outward normal points most to the south (the street is drawn below)
    return edges.slice().sort((a, b) => a.ny - b.ny || a.len - b.len)[0].i
  }
  const scored = edges.map((e) => {
    const vx = ref[0] - e.mid[0]
    const vy = ref[1] - e.mid[1]
    const along = vx * e.nx + vy * e.ny // positive when the point lies outside this edge
    const perp = Math.hypot(vx - along * e.nx, vy - along * e.ny) // how far the point sits off the midpoint's ray
    const score = perp + Math.max(0, -along) * 4 + (perp > e.len / 2 + 15 ? 40 : 0)
    return { ...e, score }
  })
  scored.sort((a, b) => a.score - b.score || a.len - b.len || a.i - b.i)
  return scored[0].i
}
const pointInRing = (pt, ring) => {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
/** A point inside the ring: the centroid, or the first point on the way from it toward a vertex that is. */
export function interiorPoint(pts) {
  const n = pts.length
  const c = [pts.reduce((a, p) => a + p[0], 0) / n, pts.reduce((a, p) => a + p[1], 0) / n]
  if (pointInRing(c, pts)) return c
  for (const v of pts) for (const t of [0.5, 0.25, 0.75, 0.1, 0.9]) {
    const q = [c[0] + (v[0] - c[0]) * t, c[1] + (v[1] - c[1]) * t]
    if (pointInRing(q, pts)) return q
  }
  return c
}
/** The same for a GeoJSON polygon in lon/lat: the interior point in lon/lat. */
export function interiorLonLat(ring) {
  const { pts, toLonLat } = projectRing(ring)
  return toLonLat(interiorPoint(pts))
}

// ── situs normalisation and the where clause ────────────────────────────────────────────────────────
const SUFFIX = { STREET: 'ST', AVENUE: 'AVE', DRIVE: 'DR', ROAD: 'RD', LANE: 'LN', BOULEVARD: 'BLVD', COURT: 'CT', CIRCLE: 'CIR', PLACE: 'PL', TERRACE: 'TER', PARKWAY: 'PKWY', HIGHWAY: 'HWY', TRAIL: 'TRL', WAY: 'WAY', LOOP: 'LOOP', EXPRESSWAY: 'EXPY', CALLE: 'CLL' }
const SUFFIX_SHORT = new Set([...Object.values(SUFFIX), 'CIR', 'LOOP', 'EXPY', 'PASS', 'RUN', 'ROW', 'PT', 'CV', 'XING'])
/** Collapse spaces, uppercase, drop ", TX" and the ZIP, and spell suffixes the short way. */
export function normalizeSitus(s) {
  return String(s || '')
    .toUpperCase()
    .replace(/,?\s*TX\b.*$/, '')
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((w) => SUFFIX[w] || w)
    .join(' ')
}
/** The house number and the street's core name (no suffix, no direction) from a free address. */
export function parseAddress(address) {
  const n = normalizeSitus(String(address || '').split(',')[0])
  const m = n.match(/^(\d+[A-Z]?)\s+(.*)$/)
  if (!m) return { number: null, street: null }
  const words = m[2].split(' ').filter((w) => !/^(N|S|E|W|NE|NW|SE|SW|NORTH|SOUTH|EAST|WEST)$/.test(w))
  const last = words[words.length - 1]
  if (words.length > 1 && Object.values(SUFFIX).includes(last)) words.pop()
  return { number: m[1], street: words.join(' ') }
}
const FIELD_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
/**
 * A where clause from whitelisted field names and escaped values: a quote in a value is doubled, never a break-out.
 * `types` names the layer's integer fields (round 9, item 2): those are emitted unquoted and must be digits only,
 * because ArcGIS answers 400 to `prop_id = '255056'` on an esriFieldTypeInteger field.
 */
export function whereClause(parts, types = {}) {
  return parts
    .map(([field, op, value]) => {
      if (!FIELD_RE.test(field)) throw new Error(`field name not allowed: ${field}`)
      if (types[field] === 'integer') {
        if (op !== '=') throw new Error(`operator not allowed on an integer field: ${op}`)
        const n = String(value).trim()
        if (!/^\d{1,18}$/.test(n)) throw Object.assign(new Error(`${field} must be a whole number`), { status: 400 })
        return `${field} = ${n}`
      }
      const v = String(value).replace(/'/g, "''").replace(/[;\\]/g, '')
      if (op === 'LIKE') return `UPPER(${field}) LIKE '${v}'`
      if (op === '=') return `${field} = '${v}'`
      throw new Error(`operator not allowed: ${op}`)
    })
    .join(' AND ')
}
/** An attribute by its mapped field name; the layer's own spelling wins, any other case is accepted (PROP_ID for prop_id). */
export function attr(attrs, field) {
  if (!field || !attrs) return undefined
  if (field in attrs) return attrs[field]
  const k = Object.keys(attrs).find((x) => x.toLowerCase() === String(field).toLowerCase())
  return k ? attrs[k] : undefined
}
/** A mapped field that may be one column or several joined in order (a mailing address in six columns). */
const joined = (attrs, field) => {
  if (!field) return null
  const parts = (Array.isArray(field) ? field : [field]).map((k) => attr(attrs, k)).map((v) => (v == null ? '' : String(v).trim())).filter(Boolean)
  return parts.length ? parts.join(', ') : null
}
const situsOf = (src, attrs) => {
  const F = src.fields
  if (F.situs) return normalizeSitus(attr(attrs, F.situs))
  if (F.situsParts) return normalizeSitus(F.situsParts.map((k) => attr(attrs, k)).filter(Boolean).join(' '))
  return normalizeSitus([attr(attrs, F.situsNum), attr(attrs, F.situsStreet)].filter(Boolean).join(' '))
}
const situsMatches = (situs, { number, street }) => !!number && situs.startsWith(number + ' ') && (!street || situs.includes(street))

// ── the service ─────────────────────────────────────────────────────────────────────────────────────
export function makeParcels({ store, event = async () => {}, log = console.log, env = process.env, fetchImpl = globalThis.fetch, geocode, sources = PARCEL_SOURCES, roads: roadSource = ROAD_SOURCE }) {
  const liveSources = (county) => sources.filter((s) => !s.disabled && !s.dormant && s.kind === 'arcgis' && s.county === county)
  const breaker = new Map() // source id → { fails: [ms], openUntil }
  const health = new Map() // source id → { at, ms, ok, error }
  const metric = { lookups: 0, failures: 0 }
  const fieldCheck = new Map() // source id → { at, ok, missing, wrongType, error }: the mapped fields against the layer's own list
  const regridToken = (env.REGRID_API_TOKEN || '').trim()
  const regridCap = +(env.REGRID_MONTHLY_CAP || 1500)

  const open = (id) => {
    const b = breaker.get(id)
    return !!b && b.openUntil > Date.now()
  }
  const noteFail = (id, error) => {
    const b = breaker.get(id) || { fails: [], openUntil: 0 }
    const t = Date.now()
    b.fails = [...b.fails.filter((x) => t - x < BREAKER_MIN * 60000), t]
    if (b.fails.length >= BREAKER_FAILS) {
      b.openUntil = t + BREAKER_MIN * 60000
      b.fails = []
      log(`parcels: source ${id} skipped for ${BREAKER_MIN} minutes after ${BREAKER_FAILS} failures (${error})`)
    }
    breaker.set(id, b)
  }
  const noteOk = (id) => breaker.set(id, { fails: [], openUntil: 0 })

  /** One ArcGIS query: the URL with the params, the source's headers, an 8 s timeout, one retry on 5xx. */
  async function arcgis(src, layerUrl, params, { retry = true } = {}) {
    const url = `${layerUrl}/query?${new URLSearchParams({ f: 'geojson', outSR: '4326', returnGeometry: 'true', outFields: '*', ...params })}`
    const t0 = Date.now()
    let res
    try {
      res = await fetchImpl(url, { headers: { accept: 'application/json', ...(src.headers || {}) }, signal: AbortSignal.timeout(TIMEOUT_MS) })
    } catch (e) {
      health.set(src.id, { at: now(), ms: Date.now() - t0, ok: false, error: String(e.message || e).slice(0, 120) })
      throw fail(502, `${src.name}: ${e.name === 'TimeoutError' || /abort/i.test(String(e)) ? 'no answer in 8 s' : e.message}`)
    }
    if (res.status >= 500 && retry) return arcgis(src, layerUrl, params, { retry: false })
    if (!res.ok) {
      health.set(src.id, { at: now(), ms: Date.now() - t0, ok: false, error: `HTTP ${res.status}` })
      throw fail(502, `${src.name} answered ${res.status}${res.status === 403 ? ' (a User-Agent header is required)' : ''}`)
    }
    const body = await res.json()
    if (body.error) {
      health.set(src.id, { at: now(), ms: Date.now() - t0, ok: false, error: String(body.error.message || body.error).slice(0, 120) })
      throw fail(502, `${src.name}: ${body.error.message || 'query error'}`)
    }
    health.set(src.id, { at: now(), ms: Date.now() - t0, ok: true, error: null })
    return body.features || []
  }

  /** A feature → the normalized parcel (geometry cleaned to calls; owner and mailing included, stripped later for homeowners). */
  function normalize(src, feature, { matchedBy, confidence, censusPoint }) {
    const a = feature.properties || feature.attributes || {}
    const F = src.fields
    const geom = feature.geometry
    if (!geom || geom.type !== 'Polygon' || !geom.coordinates?.length) return { match: 'needs-drafter', reason: geom?.type === 'MultiPolygon' ? 'the parcel is drawn as more than one piece' : 'the parcel has no usable outline', source: { id: src.id, name: src.name, url: src.url, fetchedAt: now(), checkedAt: src.checkedAt }, attributes: a }
    if (geom.coordinates.length > 1) return { match: 'needs-drafter', reason: 'the parcel outline has a hole', source: { id: src.id, name: src.name, url: src.url, fetchedAt: now(), checkedAt: src.checkedAt }, attributes: a }
    const ring = geom.coordinates[0]
    const { pts, toFt } = projectRing(ring)
    const { pts: clean, dropped } = cleanRing(pts)
    const calls = ringToCalls(clean)
    const t = traverse(calls)
    const areaSf = Math.abs(signedArea(clean))
    const interior = interiorLonLat(ring)
    const inside = censusPoint ? pointInRing(toFt([censusPoint.lon, censusPoint.lat]), clean) : null
    const situs = situsOf(src, a)
    const legal = String(attr(a, F.legal) || '').trim()
    // the front here is the last fallback (round 10, item 1): the edge facing the Census point, which is interpolated
    // along the street and can sit hundreds of feet from the lot; no point: the southern edge. withFront() replaces it
    // with the edge on the named road whenever TIGERweb answers
    const frontEdge = pickFrontEdge(clean, censusPoint ? toFt([censusPoint.lon, censusPoint.lat]) : null)
    const acresRaw = F.acres ? attr(a, F.acres) : null
    const acresCad = acresRaw != null && acresRaw !== '' ? +acresRaw : null
    return {
      match: 'one',
      matchedBy,
      confidence,
      source: { id: src.id, name: src.name, url: src.url, fetchedAt: now(), checkedAt: src.checkedAt },
      county: src.county,
      v: RECORD_V,
      propId: attr(a, F.propId) != null ? String(attr(a, F.propId)) : null,
      geoId: attr(a, F.geoId) != null ? String(attr(a, F.geoId)) : null,
      situs,
      legal,
      acresCad,
      owner: joined(a, F.owner),
      mailing: joined(a, F.mailing),
      polygonWgs84: ring,
      interior: { lon: interior[0], lat: interior[1] },
      censusInside: inside,
      areaSf: Math.round(areaSf),
      acres: Math.round((areaSf / 43560) * 1000) / 1000,
      // round 9, item 15: a tract over two acres or with hundreds of edges (La Plaza: 400+ edges, 2,090,836 sf) is not drawn edge by
      // edge on the client; the card says so and the drafter takes it from here
      large: areaSf > 2 * 43560 || calls.length > 60,
      edges: calls.map((c) => ({ lengthFt: c.distance, bearing: c.bearing })),
      calls,
      frontEdge,
      frontBy: censusPoint ? 'census-point' : 'south',
      frontStreet: null,
      corner: false,
      streets: [],
      edgeKinds: kindsFromFront(clean, frontEdge),
      closure: t.closure,
      cleaned: dropped,
      cityLimits: src.cityLimits ? attr(a, src.cityLimits) ?? null : null,
      attributes: a,
    }
  }
  const candidateOf = (src, feature, censusPoint) => {
    const a = feature.properties || feature.attributes || {}
    const ring = feature.geometry?.type === 'Polygon' ? feature.geometry.coordinates[0] : null
    const c = ring ? interiorLonLat(ring) : null
    const dist = c && censusPoint ? Math.hypot((c[0] - censusPoint.lon) * 288200 * Math.cos((censusPoint.lat * Math.PI) / 180), (c[1] - censusPoint.lat) * 364000) : null
    return { propId: attr(a, src.fields.propId) != null ? String(attr(a, src.fields.propId)) : null, situs: situsOf(src, a), legal: String(attr(a, src.fields.legal) || ''), distanceFt: dist == null ? null : Math.round(dist), feature }
  }

  /**
   * The named roads within 120 m of a point, from TIGERweb (round 10, item 1): [{ name, base, suffix, layer, lines }]
   * in lon/lat, or null when the service did not answer (the caller falls back). One query per layer, side by side.
   */
  async function roadsNear(point, layers = roadSource.layers) {
    if (!roadSource?.url || !point) return null
    const F = roadSource.fields
    const t0 = Date.now()
    const one = async (layer) => {
      const url = `${roadSource.url}/${layer}/query?${new URLSearchParams({ f: 'geojson', outSR: '4326', returnGeometry: 'true', outFields: [F.name, F.base, F.suffix, F.mtfcc].join(','), geometry: `${point.lon},${point.lat}`, geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', distance: String(roadSource.bufferM), units: 'esriSRUnit_Meter' })}`
      const res = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(ROAD_TIMEOUT_MS) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = await res.json()
      if (body.error) throw new Error(body.error.message || 'query error')
      return (body.features || []).flatMap((f) => {
        const g = f.geometry
        const lines = g?.type === 'LineString' ? [g.coordinates] : g?.type === 'MultiLineString' ? g.coordinates : []
        const pr = f.properties || {}
        return lines.length ? [{ name: pr[F.name] || null, base: pr[F.base] || null, suffix: pr[F.suffix] || null, layer, lines }] : []
      })
    }
    const got = await Promise.allSettled(layers.map(one))
    const ok = got.filter((g) => g.status === 'fulfilled')
    if (!ok.length) {
      const error = String(got[0]?.reason?.message || got[0]?.reason || 'no answer').slice(0, 120)
      health.set(roadSource.id, { at: now(), ms: Date.now() - t0, ok: false, error })
      log(`parcels: ${roadSource.name} did not answer (${error}); the front edge falls back to the address point or the Census point`)
      return null
    }
    health.set(roadSource.id, { at: now(), ms: Date.now() - t0, ok: true, error: null })
    return ok.flatMap((g) => g.value)
  }
  /**
   * The front edge of a matched parcel (round 10, item 1), in this order: the edge on the road that carries the
   * address's street name (TIGERweb); the county's address point, when it sits by an edge; the Census point; the
   * southern edge. On a tie the shorter edge. A second named road along another edge makes it a corner lot and that
   * edge takes the street-side setback. The answer is stored with the parcel (30 days).
   */
  async function withFront(rec, { typed = '', matched = '', addressPoint = null } = {}) {
    if (!rec || rec.match !== 'one' || !rec.polygonWgs84) return rec
    const { pts, toFt } = projectRing(rec.polygonWgs84)
    const { pts: clean } = cleanRing(pts)
    const typedStreet = String(typed || '').split(',')[0]
    const matchedStreet = String(matched || '').split(',')[0]
    const streets = [typedStreet, matchedStreet].map((x) => streetCore(x)).filter(Boolean)
    const suffix = streetSuffix(typedStreet) || streetSuffix(matchedStreet)
    const inFt = (roads) => roads.map((r) => ({ ...r, lines: r.lines.map((line) => line.map(toFt)) }))
    let roads = await roadsNear(rec.interior).catch(() => null)
    let front = roads ? frontFromRoads(clean, inFt(roads), { streets, situs: rec.situs, suffix, cornerFt: roadSource.cornerFt }) : null
    if (roads && !front && roadSource.lastResort?.length) {
      const more = await roadsNear(rec.interior, roadSource.lastResort).catch(() => null)
      if (more?.length) {
        roads = [...roads, ...more]
        front = frontFromRoads(clean, inFt(roads), { streets, situs: rec.situs, suffix, cornerFt: roadSource.cornerFt })
      }
    }
    const roadsMeta = { source: roadSource.id, at: now(), answered: !!roads, named: roads ? [...new Set(roads.map((r) => r.name).filter(Boolean))].slice(0, 12) : [] }
    if (front) return { ...rec, ...front, roads: roadsMeta }
    // the county's address point, when it sits by an edge (a point in the middle of the lot says nothing)
    if (addressPoint) {
      const i = edgeNearPoint(clean, toFt([addressPoint.lon, addressPoint.lat]))
      if (i != null) return { ...rec, frontEdge: i, frontBy: 'address-point', edgeKinds: kindsFromFront(clean, i), roads: roadsMeta }
    }
    return { ...rec, roads: roadsMeta }
  }

  /**
   * The pipeline on one source. Returns a normalized parcel or { match: 'none', candidates }. A step that fails
   * (a 400 from the layer, a timeout) is noted and the next step runs (round 9, item 2); only when every step
   * failed and nothing matched does the error come out, so the breaker counts a dead source, not one odd query.
   */
  async function lookupOn(src, { address, number, street, censusPoint, place }) {
    const F = src.fields
    const T = src.types || {}
    const errors = []
    const disagreements = []
    const step = async (name, fn) => {
      try {
        return await fn()
      } catch (e) {
        errors.push({ step: name, error: e.message })
        return undefined
      }
    }
    const tag = (rec) => (rec && rec.match === 'one' ? { ...rec, stepErrors: errors.length ? errors : undefined, disagreements: disagreements.length ? disagreements : undefined } : rec)
    // 2. address points: the parcel they name is taken only when its situs agrees with the typed number and street
    //    (round 9, item 5: for 118 S Cage Blvd the point carries the neighbour, 118 W Park Ave)
    if (src.addressPoints && number && street) {
      const hit = await step('address-point', async () => {
        const ap = src.addressPoints
        const where = whereClause([[ap.fields.fulladdr, 'LIKE', `${number} %${street}%`], ...(place ? [[ap.fields.municipality, 'LIKE', `%${normalizeSitus(place)}%`]] : [])], ap.types || {})
        const points = await arcgis(src, ap.url, { where, outFields: [ap.fields.fulladdr, ap.fields.municipality, ap.fields.parcelId].join(',') })
        const ids = [...new Set(points.map((p) => (p.properties || p.attributes)?.[ap.fields.parcelId]).filter((v) => v != null && String(v).trim() !== ''))]
        if (ids.length !== 1) return null
        const parcels = await arcgis(src, src.url, { where: whereClause([[ap.parcelKey, '=', ids[0]]], T) })
        if (parcels.length !== 1) return null
        const situs = situsOf(src, parcels[0].properties || parcels[0].attributes || {})
        if (!situsMatches(situs, { number, street })) {
          disagreements.push({ parcelId: String(ids[0]), situs, asked: `${number} ${street}` })
          log(`parcels: ${src.id} address point ${ids[0]} is "${situs}", not ${number} ${street}; falling through`)
          return null
        }
        const at = points.find((p) => p.geometry?.type === 'Point')?.geometry.coordinates
        return { ...normalize(src, parcels[0], { matchedBy: 'address-point', confidence: 'exact', censusPoint }), addressPoint: at ? { lon: at[0], lat: at[1] } : null }
      })
      if (hit) return tag(hit)
    }
    // 3. attribute query on the number and the street
    if (number && street) {
      const hit = await step('situs', async () => {
        let where
        if (F.situs) where = whereClause([[F.situs, 'LIKE', `${number} %${street}%`]], T)
        else if (F.situsNum && F.situsStreet) where = whereClause([[F.situsNum, '=', number], [F.situsStreet, 'LIKE', `${street}%`]], T)
        if (!where) return null
        const feats = await arcgis(src, src.url, { where })
        const good = feats.filter((f) => situsMatches(situsOf(src, f.properties || f.attributes || {}), { number, street }))
        return good.length === 1 ? normalize(src, good[0], { matchedBy: 'situs', confidence: 'situs', censusPoint }) : null
      })
      if (hit) return tag(hit)
    }
    // 4. a 40 m buffer around the Census point, filtered on the situs; 5. else the nearest candidates to tap
    if (censusPoint) {
      const out = await step('buffer', async () => {
        const feats = await arcgis(src, src.url, { geometry: `${censusPoint.lon},${censusPoint.lat}`, geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', distance: '40', units: 'esriSRUnit_Meter' })
        const cands = feats.map((f) => candidateOf(src, f, censusPoint)).sort((a, b) => (a.distanceFt ?? 1e9) - (b.distanceFt ?? 1e9))
        const good = cands.filter((c) => situsMatches(c.situs, { number, street }))
        if (good.length === 1) return normalize(src, good[0].feature, { matchedBy: 'buffer-situs', confidence: 'situs', censusPoint })
        return { match: 'none', candidates: cands.slice(0, 6).map(({ feature, ...c }) => c), source: { id: src.id, name: src.name, url: src.url, fetchedAt: now(), checkedAt: src.checkedAt }, county: src.county, stepErrors: errors.length ? errors : undefined, disagreements: disagreements.length ? disagreements : undefined }
      })
      if (out) return tag(out)
    }
    if (errors.length) {
      const e = new Error(errors.map((x) => `${x.step}: ${x.error}`).join('; '))
      e.status = 502
      throw e
    }
    return { match: 'none', candidates: [], source: { id: src.id, name: src.name, url: src.url, fetchedAt: now(), checkedAt: src.checkedAt }, county: src.county, disagreements: disagreements.length ? disagreements : undefined }
  }

  /** Regrid, only with a token: address first, then the point; counted against the monthly cap; never logged. */
  async function regrid({ address, censusPoint }) {
    if (!regridToken) return null
    const month = now().slice(0, 7)
    const usedKey = `regrid:usage:${month}`
    const used = +((await store.meta.get(usedKey)) || 0)
    if (used >= regridCap) {
      log(`parcels: Regrid monthly cap (${regridCap}) reached; not queried`)
      return null
    }
    const src = sourceById('regrid')
    const call = async (path, params) => {
      const res = await fetchImpl(`${src.url}/${path}?${new URLSearchParams({ ...params, token: regridToken })}`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
      if (!res.ok) throw fail(502, `Regrid answered ${res.status}`)
      return res.json()
    }
    let body = await call('address', { query: address, limit: '1' })
    let feats = body?.parcels?.features || []
    if (!feats.length && censusPoint) {
      body = await call('point', { lat: String(censusPoint.lat), lon: String(censusPoint.lon), radius: '40', limit: '5' })
      feats = body?.parcels?.features || []
    }
    await store.meta.set(usedKey, used + feats.length)
    if (!feats.length) return null
    const f = feats[0]
    const p = f.properties?.fields || f.properties || {}
    const feature = { geometry: f.geometry, properties: { prop_id: p.parcelnumb, geo_id: p.parcelnumb_no_formatting || p.parcelnumb, owner: p.owner, owner_addr: [p.mailadd, p.mail_city, p.mail_state2, p.mail_zip].filter(Boolean).join(', '), situs: [p.address, p.scity].filter(Boolean).join(', '), legal: p.legaldesc, acres: p.ll_gisacre } }
    const rsrc = { ...src, county: p.county ? `${p.county} County` : null, fields: { propId: 'prop_id', geoId: 'geo_id', owner: 'owner', mailing: 'owner_addr', situs: 'situs', legal: 'legal', acres: 'acres' } }
    const out = normalize(rsrc, feature, { matchedBy: 'regrid', confidence: feats.length === 1 ? 'exact' : 'pick', censusPoint })
    out.source = { id: 'regrid', name: src.name, url: src.url, fetchedAt: now(), checkedAt: src.checkedAt }
    return out
  }

  return {
    sources,
    /**
     * Look a parcel up by address (or by lat/lon). Cached 30 days under parcel:<normalized address>.
     * Returns the normalized parcel (owner and mailing included: the route strips them for homeowners).
     */
    async lookup({ address, lat, lon, county: countyHint, force = false, confirmed = false } = {}) {
      const a = String(address || '').trim()
      const key = a ? 'parcel:' + a.toLowerCase().replace(/\s+/g, ' ') : lat != null && lon != null ? `parcel:@${(+lat).toFixed(5)},${(+lon).toFixed(5)}` : null
      if (!key) throw fail(400, 'address, or lat and lon, required')
      if (a.length > 200) throw fail(400, 'the address is too long (200 characters at most)')
      if (!force) {
        const cached = await store.meta.get(key)
        if (cached && (cached.match !== 'one' || cached.v === RECORD_V) && Date.now() - Date.parse(cached.cachedAt) < CACHE_DAYS * 86400000) return { ...cached, cached: true }
      }
      metric.lookups++
      // 1. the Census geocoder
      let geo = null
      if (a) {
        try {
          geo = await geocode(a)
        } catch (e) {
          geo = null
        }
      }
      // round 10, item 3: the geocoder matched another address (W typed, E found): no parcel is offered until the
      // homeowner says the found address is theirs
      if (geo?.found && geo.mismatch && !confirmed) return { match: 'confirm-address', mismatch: geo.mismatch, geo: { found: true, matched: geo.matched, county: geo.county, place: geo.place }, candidates: [], cachedAt: now() }
      const censusPoint = lat != null && lon != null ? { lat: +lat, lon: +lon } : geo?.found ? { lat: geo.lat, lon: geo.lon } : null
      const county = countyHint || geo?.county || null
      const { number, street } = parseAddress(a || geo?.matched || '')
      const place = geo?.place || null
      const tried = []
      let out = null
      let lastError = null
      const list = county ? liveSources(county) : []
      for (const src of list.slice(0, MAX_SOURCES)) {
        if (open(src.id)) {
          tried.push({ id: src.id, skipped: 'circuit open' })
          continue
        }
        const urls = [src.url, ...(src.fallbacks || [])]
        let got = null
        for (const url of urls) {
          try {
            got = await lookupOn({ ...src, url }, { address: a, number, street, censusPoint, place })
            noteOk(src.id)
            break
          } catch (e) {
            lastError = e.message
            tried.push({ id: src.id, url, error: e.message })
          }
        }
        // the breaker counts a source that failed on every one of its URLs (the monthly name change is not a failure)
        if (!got) noteFail(src.id, lastError)
        if (got) {
          out = got
          if (got.match === 'one') break
        }
      }
      // the dormant fallbacks: PostGIS (item 12) and Regrid
      if (!out || out.match !== 'one') {
        try {
          const r = await regrid({ address: a, censusPoint })
          if (r) out = r
        } catch (e) {
          lastError = e.message
          tried.push({ id: 'regrid', error: e.message })
        }
      }
      if (!out) {
        metric.failures++
        if (!county) return { match: 'none', reason: geo && !geo.found ? 'the address was not found' : 'the county is not one we have a parcel source for', geo: geo && { found: geo.found, county: geo.county, place: geo.place }, candidates: [], tried, cachedAt: now() }
        // the plain line goes to the homeowner; which step failed on which source stays in the log (round 10, item 6)
        log(`parcels: no source answered for ${county} (${lastError || 'no source'})`)
        throw fail(502, COUNTY_DOWN, { tried, upstream: 'county', detail: lastError || 'no source' })
      }
      if (out.match === 'one') out = await withFront(out, { typed: a, matched: geo?.matched || '', addressPoint: out.addressPoint || null })
      if (out.disagreements?.length) {
        const prev = (await store.meta.get('parcels:disagreements')) || []
        await store.meta.set('parcels:disagreements', [{ at: now(), address: a || null, ...out.disagreements[0] }, ...prev].slice(0, 50))
      }
      const rec = { ...out, address: a || null, census: censusPoint ? { ...censusPoint, matched: geo?.matched || null, county, place } : null, jurisdictionHint: geo ? { county, place } : null, tried, cachedAt: now() }
      if (out.match === 'one' || out.match === 'none') await store.meta.set(key, rec)
      return rec
    },
    /** A candidate the client tapped: the parcel by its id on the county's source. */
    async byId({ county, propId }) {
      const src = liveSources(county)[0]
      if (!src) throw fail(404, 'no parcel source for that county')
      const feats = await arcgis(src, src.url, { where: whereClause([[src.fields.propId, '=', String(propId)]], src.types || {}) })
      if (feats.length !== 1) throw fail(404, 'parcel not found')
      const out = await withFront(normalize(src, feats[0], { matchedBy: 'pick', confidence: 'pick', censusPoint: null }))
      return { ...out, cachedAt: now() }
    },
    /** The health page's rows: last check, latency and error per source; Regrid usage against its cap. */
    async health() {
      const month = now().slice(0, 7)
      const regridUsed = +((await store.meta.get(`regrid:usage:${month}`)) || 0)
      const asceUsed = +((await store.meta.get(`asce:usage:${month}`)) || 0)
      const daily = (await store.meta.get('parcels:daily')) || null
      return {
        sources: [...sources, ...(roadSource?.url ? [roadSource] : [])].map((s) => ({ id: s.id, name: s.name, county: s.county, kind: s.kind, url: s.url || null, disabled: s.disabled || null, dormant: s.dormant || null, checkedAt: s.checkedAt, last: health.get(s.id) || null, circuitOpen: open(s.id), fields: fieldCheck.get(s.id) || null })),
        lookups: metric.lookups,
        failures: metric.failures,
        failureRate: metric.lookups ? Math.round((metric.failures / metric.lookups) * 1000) / 10 : 0,
        regrid: { enabled: !!regridToken, used: regridUsed, cap: regridCap, month },
        asce: { enabled: !!(env.ASCE_HAZARD_API_KEY || '').trim(), used: asceUsed, cap: 1000, month },
        daily,
        fieldCheck: (await store.meta.get('parcels:fields')) || null,
        disagreements: (await store.meta.get('parcels:disagreements')) || [],
      }
    },
    /**
     * The daily check: the three test addresses against the live sources (not from the cache); a failure or a
     * missing field is reported and emailed. Returns the results; stores them under parcels:daily.
     */
    async dailyCheck({ email = null } = {}) {
      const results = []
      for (const t of TEST_ADDRESSES) {
        try {
          const r = await this.lookup({ address: t.address, county: t.county, force: true })
          const missing = ['propId', 'legal', 'situs', 'calls'].filter((k) => r.match === 'one' && (r[k] == null || r[k] === '' || (Array.isArray(r[k]) && !r[k].length)))
          const ok = r.match === 'one' && !missing.length && (!t.expect.legal || t.expect.legal.test(r.legal || ''))
          results.push({ address: t.address, ok, match: r.match, matchedBy: r.matchedBy || null, missing, areaSf: r.areaSf || null })
        } catch (e) {
          results.push({ address: t.address, ok: false, error: e.message })
        }
      }
      const rec = { at: now(), ok: results.every((r) => r.ok), results }
      const prev = (await store.meta.get('parcels:daily')) || {}
      rec.failedDays = rec.ok ? 0 : (prev.failedDays || 0) + 1
      await store.meta.set('parcels:daily', rec)
      if (!rec.ok) {
        await event('alert', `parcel sources: the daily check failed (${results.filter((r) => !r.ok).map((r) => r.address.split(',')[0]).join(', ')}), ${rec.failedDays} day${rec.failedDays === 1 ? '' : 's'} running`)
        if (email) await email('Draft House: a parcel source failed its daily check', results.map((r) => `${r.ok ? 'ok  ' : 'FAIL'} ${r.address}${r.error ? `: ${r.error}` : r.missing?.length ? `: missing ${r.missing.join(', ')}` : r.match && r.match !== 'one' ? `: ${r.match}` : ''}`).join('\n') + `\n\n${rec.failedDays} day(s) running. Regrid turns on when this fails 3 days running or the free sources fail more than 5% of lookups in a month (REGRID_API_TOKEN).`)
      }
      return rec
    },
    /**
     * Round 10, item 5: every mapped field against the layer's own field list (its ?f=json). A mapped column the layer
     * does not have (owner_name on a layer that says file_as_name) left the drafter's owner lookup empty for a whole
     * county. Returns one row per source and stores them for the sources page; nothing here reads a parcel.
     */
    async checkFields() {
      const rows = []
      const describe = async (url, headers = {}) => {
        const res = await fetchImpl(`${url}?f=json`, { headers: { accept: 'application/json', ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS) })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const body = await res.json()
        if (body.error) throw new Error(body.error.message || 'no description')
        if (!Array.isArray(body.fields)) throw new Error('the layer lists no fields')
        return body.fields
      }
      const compare = (fields, mapped, types = {}) => {
        const names = new Map(fields.map((f) => [f.name, String(f.type || '')]))
        const lower = new Map(fields.map((f) => [String(f.name).toLowerCase(), f.name]))
        const missing = []
        const otherCase = []
        const wrongType = []
        for (const [role, col] of mapped) {
          if (!col) continue
          if (names.has(col)) {
            const numeric = /Integer|Double|OID/i.test(names.get(col))
            if ((role === 'propId' || role === 'parcelKey') && numeric && types[col] !== 'integer') wrongType.push(`${col} is a number on the layer but is sent quoted`)
            if (types[col] === 'integer' && !numeric) wrongType.push(`${col} is text on the layer but is sent unquoted`)
          } else if (lower.has(String(col).toLowerCase())) otherCase.push(`${col} is spelled ${lower.get(String(col).toLowerCase())}`)
          else missing.push(`${role}: ${col}`)
        }
        return { missing, otherCase, wrongType }
      }
      const mappedOf = (s) => {
        const F = s.fields || {}
        const list = (v) => (Array.isArray(v) ? v : v ? [v] : [])
        return [['propId', F.propId], ['geoId', F.geoId], ...list(F.owner).map((c) => ['owner', c]), ...list(F.mailing).map((c) => ['mailing', c]), ['situs', F.situs], ['situsNum', F.situsNum], ['situsStreet', F.situsStreet], ...list(F.situsParts).map((c) => ['situs', c]), ['legal', F.legal], ['acres', F.acres], ['cityLimits', s.cityLimits]]
      }
      for (const s of sources.filter((x) => x.kind === 'arcgis' && !x.disabled && !x.dormant)) {
        const row = { id: s.id, at: now(), ok: true, missing: [], otherCase: [], wrongType: [], error: null, layers: [] }
        const targets = [[s.url, mappedOf(s), s.types || {}], ...(s.fallbacks || []).map((u) => [u, mappedOf(s), s.types || {}])]
        if (s.addressPoints) targets.push([s.addressPoints.url, [['fulladdr', s.addressPoints.fields.fulladdr], ['municipality', s.addressPoints.fields.municipality], ['parcelId', s.addressPoints.fields.parcelId]], s.addressPoints.types || {}])
        for (const [url, mapped, types] of targets) {
          try {
            const c = compare(await describe(url, s.headers || {}), mapped, types)
            row.layers.push({ url, ...c })
            // the primary layer decides; a fallback is reported beside it
            const tag = url === s.url ? '' : ` (${url.split('/rest/services/')[1] || url})`
            row.missing.push(...c.missing.map((m) => m + tag))
            row.otherCase.push(...c.otherCase.map((m) => m + tag))
            row.wrongType.push(...c.wrongType.map((m) => m + tag))
          } catch (e) {
            if (e?.code === 'DH_NETWORK_GUARD') throw e
            row.layers.push({ url, error: String(e.message || e).slice(0, 120) })
            if (url === s.url) row.error = String(e.message || e).slice(0, 120)
          }
        }
        row.ok = !row.missing.length && !row.wrongType.length && !row.error
        fieldCheck.set(s.id, row)
        rows.push(row)
      }
      if (roadSource?.url) {
        const row = { id: roadSource.id, at: now(), ok: true, missing: [], otherCase: [], wrongType: [], error: null, layers: [] }
        for (const layer of [...roadSource.layers, ...(roadSource.lastResort || [])]) {
          const url = `${roadSource.url}/${layer}`
          try {
            const c = compare(await describe(url), Object.entries(roadSource.fields))
            row.layers.push({ url, ...c })
            row.missing.push(...c.missing.map((m) => `${m} (layer ${layer})`))
          } catch (e) {
            if (e?.code === 'DH_NETWORK_GUARD') throw e
            row.layers.push({ url, error: String(e.message || e).slice(0, 120) })
            if (layer === roadSource.layers[0]) row.error = String(e.message || e).slice(0, 120)
          }
        }
        row.ok = !row.missing.length && !row.error
        fieldCheck.set(roadSource.id, row)
        rows.push(row)
      }
      const rec = { at: now(), ok: rows.every((r) => r.ok), rows }
      await store.meta.set('parcels:fields', rec)
      const bad = rows.filter((r) => r.missing.length || r.wrongType.length)
      if (bad.length) {
        const text = bad.map((r) => `${r.id}: ${[...r.missing.map((m) => `no column for ${m}`), ...r.wrongType].join('; ')}`).join(' | ')
        log(`parcels: mapped fields that the layers do not have: ${text}`)
        await event('alert', `parcel sources: a mapped column is missing on the live layer (${bad.map((r) => r.id).join(', ')}); the sources page lists them`)
      }
      return rec
    },
    describe: () => {
      const bad = [...fieldCheck.values()].filter((r) => r.missing.length || r.wrongType.length)
      return { ok: !bad.length, detail: `${sources.filter((s) => s.kind === 'arcgis' && !s.disabled).length} county sources; Regrid ${regridToken ? 'on' : 'dormant'}; ${metric.lookups} lookup${metric.lookups === 1 ? '' : 's'} since start${metric.failures ? `, ${metric.failures} failed` : ''}${fieldCheck.size ? (bad.length ? `; mapped columns missing on ${bad.map((r) => r.id).join(', ')}` : '; mapped columns all present') : '; mapped columns not checked yet'}` }
    },
    // for tests
    _breaker: breaker,
    _health: health,
  }
}
