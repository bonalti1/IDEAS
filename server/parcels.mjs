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
import { PARCEL_SOURCES, sourcesFor, sourceById, TEST_ADDRESSES } from './parcel-sources.mjs'

const fail = (status, error, extra = {}) => Object.assign(new Error(error), { status, ...extra })
const now = () => new Date().toISOString()
const FT_PER_M = 3.280839895
const EARTH_FT = 20902231 // mean radius, feet
const CACHE_DAYS = 30
const TIMEOUT_MS = 8000
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
const SUFFIX = { STREET: 'ST', AVENUE: 'AVE', DRIVE: 'DR', ROAD: 'RD', LANE: 'LN', BOULEVARD: 'BLVD', COURT: 'CT', CIRCLE: 'CIR', PLACE: 'PL', TERRACE: 'TER', PARKWAY: 'PKWY', HIGHWAY: 'HWY', TRAIL: 'TRL', WAY: 'WAY' }
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
/** A where clause from whitelisted field names and escaped values: a quote in a value is doubled, never a break-out. */
export function whereClause(parts) {
  return parts
    .map(([field, op, value]) => {
      if (!FIELD_RE.test(field)) throw new Error(`field name not allowed: ${field}`)
      const v = String(value).replace(/'/g, "''").replace(/[;\\]/g, '')
      if (op === 'LIKE') return `UPPER(${field}) LIKE '${v}'`
      if (op === '=') return `${field} = '${v}'`
      throw new Error(`operator not allowed: ${op}`)
    })
    .join(' AND ')
}
const situsOf = (src, attrs) => {
  const F = src.fields
  if (F.situs) return normalizeSitus(attrs[F.situs])
  if (F.situsParts) return normalizeSitus(F.situsParts.map((k) => attrs[k]).filter(Boolean).join(' '))
  return normalizeSitus([attrs[F.situsNum], attrs[F.situsStreet]].filter(Boolean).join(' '))
}
const situsMatches = (situs, { number, street }) => !!number && situs.startsWith(number + ' ') && (!street || situs.includes(street))

// ── the service ─────────────────────────────────────────────────────────────────────────────────────
export function makeParcels({ store, event = async () => {}, log = console.log, env = process.env, fetchImpl = globalThis.fetch, geocode, sources = PARCEL_SOURCES }) {
  const liveSources = (county) => sources.filter((s) => !s.disabled && !s.dormant && s.kind === 'arcgis' && s.county === county)
  const breaker = new Map() // source id → { fails: [ms], openUntil }
  const health = new Map() // source id → { at, ms, ok, error }
  const metric = { lookups: 0, failures: 0 }
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
    const legal = String(a[F.legal] || '').trim()
    // the front: the edge nearest the Census point (which sits on the street centreline), else the southern edge
    let frontEdge = 0
    {
      const ref = censusPoint ? toFt([censusPoint.lon, censusPoint.lat]) : [interiorPoint(clean)[0], Math.min(...clean.map((p) => p[1])) - 50]
      let best = Infinity
      clean.forEach((p, i) => {
        const qn = clean[(i + 1) % clean.length]
        const d = segDist(ref, p, qn)
        if (d < best) {
          best = d
          frontEdge = i
        }
      })
    }
    const acresCad = F.acres && a[F.acres] != null && a[F.acres] !== '' ? +a[F.acres] : null
    return {
      match: 'one',
      matchedBy,
      confidence,
      source: { id: src.id, name: src.name, url: src.url, fetchedAt: now(), checkedAt: src.checkedAt },
      county: src.county,
      propId: a[F.propId] != null ? String(a[F.propId]) : null,
      geoId: a[F.geoId] != null ? String(a[F.geoId]) : null,
      situs,
      legal,
      acresCad,
      owner: F.owner ? String(a[F.owner] || '').trim() || null : null,
      mailing: F.mailing ? String(a[F.mailing] || '').trim() || null : null,
      polygonWgs84: ring,
      interior: { lon: interior[0], lat: interior[1] },
      censusInside: inside,
      areaSf: Math.round(areaSf),
      acres: Math.round((areaSf / 43560) * 1000) / 1000,
      edges: calls.map((c) => ({ lengthFt: c.distance, bearing: c.bearing })),
      calls,
      frontEdge,
      closure: t.closure,
      cleaned: dropped,
      cityLimits: src.cityLimits ? a[src.cityLimits] ?? null : null,
      attributes: a,
    }
  }
  const candidateOf = (src, feature, censusPoint) => {
    const a = feature.properties || feature.attributes || {}
    const ring = feature.geometry?.type === 'Polygon' ? feature.geometry.coordinates[0] : null
    const c = ring ? interiorLonLat(ring) : null
    const dist = c && censusPoint ? Math.hypot((c[0] - censusPoint.lon) * 288200 * Math.cos((censusPoint.lat * Math.PI) / 180), (c[1] - censusPoint.lat) * 364000) : null
    return { propId: a[src.fields.propId] != null ? String(a[src.fields.propId]) : null, situs: situsOf(src, a), legal: String(a[src.fields.legal] || ''), distanceFt: dist == null ? null : Math.round(dist), feature }
  }

  /** The pipeline on one source. Returns a normalized parcel, { match: 'none', candidates }, or throws. */
  async function lookupOn(src, { address, number, street, censusPoint, place }) {
    const F = src.fields
    // 2. address points
    if (src.addressPoints && number && street) {
      const ap = src.addressPoints
      const where = whereClause([[ap.fields.fulladdr, 'LIKE', `${number} %${street}%`], ...(place ? [[ap.fields.municipality, 'LIKE', `%${normalizeSitus(place)}%`]] : [])])
      const points = await arcgis(src, ap.url, { where, returnGeometry: 'false' })
      const ids = [...new Set(points.map((p) => (p.properties || p.attributes)?.[ap.fields.parcelId]).filter((v) => v != null))]
      if (ids.length === 1) {
        const parcels = await arcgis(src, src.url, { where: whereClause([[ap.parcelKey, '=', ids[0]]]) })
        if (parcels.length === 1) return normalize(src, parcels[0], { matchedBy: 'address-point', confidence: 'exact', censusPoint })
      }
    }
    // 3. attribute query on the number and the street
    if (number && street) {
      let where
      if (F.situs) where = whereClause([[F.situs, 'LIKE', `${number} %${street}%`]])
      else if (F.situsNum && F.situsStreet) where = whereClause([[F.situsNum, '=', number], [F.situsStreet, 'LIKE', `${street}%`]])
      if (where) {
        const feats = await arcgis(src, src.url, { where })
        const good = feats.filter((f) => situsMatches(situsOf(src, f.properties || f.attributes || {}), { number, street }))
        if (good.length === 1) return normalize(src, good[0], { matchedBy: 'situs', confidence: 'situs', censusPoint })
      }
    }
    // 4. a 40 m buffer around the Census point, filtered on the situs
    if (censusPoint) {
      const feats = await arcgis(src, src.url, { geometry: `${censusPoint.lon},${censusPoint.lat}`, geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', distance: '40', units: 'esriSRUnit_Meter' })
      const cands = feats.map((f) => candidateOf(src, f, censusPoint)).sort((a, b) => (a.distanceFt ?? 1e9) - (b.distanceFt ?? 1e9))
      const good = cands.filter((c) => situsMatches(c.situs, { number, street }))
      if (good.length === 1) return normalize(src, good[0].feature, { matchedBy: 'buffer-situs', confidence: 'situs', censusPoint })
      // 5. no single match: the nearest candidates for the client to pick from
      return { match: 'none', candidates: cands.slice(0, 6).map(({ feature, ...c }) => c), source: { id: src.id, name: src.name, url: src.url, fetchedAt: now(), checkedAt: src.checkedAt }, county: src.county }
    }
    return { match: 'none', candidates: [], source: { id: src.id, name: src.name, url: src.url, fetchedAt: now(), checkedAt: src.checkedAt }, county: src.county }
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
    async lookup({ address, lat, lon, county: countyHint, force = false } = {}) {
      const a = String(address || '').trim()
      const key = a ? 'parcel:' + a.toLowerCase().replace(/\s+/g, ' ') : lat != null && lon != null ? `parcel:@${(+lat).toFixed(5)},${(+lon).toFixed(5)}` : null
      if (!key) throw fail(400, 'address, or lat and lon, required')
      if (a.length > 200) throw fail(400, 'the address is too long (200 characters at most)')
      if (!force) {
        const cached = await store.meta.get(key)
        if (cached && Date.now() - Date.parse(cached.cachedAt) < CACHE_DAYS * 86400000) return { ...cached, cached: true }
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
        throw fail(502, `the county appraisal district did not answer (${lastError || 'no source'}); type the lot in or try again in a moment`, { tried })
      }
      const rec = { ...out, address: a || null, census: censusPoint ? { ...censusPoint, matched: geo?.matched || null, county, place } : null, jurisdictionHint: geo ? { county, place } : null, tried, cachedAt: now() }
      if (out.match === 'one' || out.match === 'none') await store.meta.set(key, rec)
      return rec
    },
    /** A candidate the client tapped: the parcel by its id on the county's source. */
    async byId({ county, propId }) {
      const src = liveSources(county)[0]
      if (!src) throw fail(404, 'no parcel source for that county')
      const feats = await arcgis(src, src.url, { where: whereClause([[src.fields.propId, '=', String(propId)]]) })
      if (feats.length !== 1) throw fail(404, 'parcel not found')
      const out = normalize(src, feats[0], { matchedBy: 'pick', confidence: 'pick', censusPoint: null })
      return { ...out, cachedAt: now() }
    },
    /** The health page's rows: last check, latency and error per source; Regrid usage against its cap. */
    async health() {
      const month = now().slice(0, 7)
      const regridUsed = +((await store.meta.get(`regrid:usage:${month}`)) || 0)
      const asceUsed = +((await store.meta.get(`asce:usage:${month}`)) || 0)
      const daily = (await store.meta.get('parcels:daily')) || null
      return {
        sources: sources.map((s) => ({ id: s.id, name: s.name, county: s.county, kind: s.kind, url: s.url || null, disabled: s.disabled || null, dormant: s.dormant || null, checkedAt: s.checkedAt, last: health.get(s.id) || null, circuitOpen: open(s.id) })),
        lookups: metric.lookups,
        failures: metric.failures,
        failureRate: metric.lookups ? Math.round((metric.failures / metric.lookups) * 1000) / 10 : 0,
        regrid: { enabled: !!regridToken, used: regridUsed, cap: regridCap, month },
        asce: { enabled: !!(env.ASCE_HAZARD_API_KEY || '').trim(), used: asceUsed, cap: 1000, month },
        daily,
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
    describe: () => ({ ok: true, detail: `${sources.filter((s) => s.kind === 'arcgis' && !s.disabled).length} county sources; Regrid ${regridToken ? 'on' : 'dormant'}; ${metric.lookups} lookup${metric.lookups === 1 ? '' : 's'} since start${metric.failures ? `, ${metric.failures} failed` : ''}` }),
    // for tests
    _breaker: breaker,
    _health: health,
  }
}
