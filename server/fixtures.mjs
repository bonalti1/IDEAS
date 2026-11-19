// Recorded answers from the parcel, road, flood and zoning services. CI never hits the network: with
// DRAFTHOUSE_FIXTURES=1 the server's fetch for those hosts answers from test/fixtures/parcels/*.json, and
// the tests pass the same function in as fetchImpl. scripts/make-parcel-fixtures.mjs records the files from the
// live services behind LIVE=1, keeping only allow-listed columns (never an owner or mailing column); one case the
// Census does not know is built by hand and marked synthetic: true so nobody mistakes it for a recording.
// guardNetwork() (round 10, item 2) makes a test run that reaches a real host fail loudly unless LIVE=1.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeSitus, parseAddress } from './parcels.mjs'
import { PARCEL_SOURCES, ROAD_SOURCE } from './parcel-sources.mjs'
import { ZONING_LAYERS } from './zoning.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const FIXTURE_DIR = path.join(__dirname, '..', 'test', 'fixtures', 'parcels')
/** Per-layer field lists and types (round 9, item 9): what a query may ask for, as the live layer would allow. */
export const LAYERS = (() => {
  const p = path.join(FIXTURE_DIR, 'layers.json')
  if (!fs.existsSync(p)) return {}
  const j = JSON.parse(fs.readFileSync(p, 'utf8'))
  delete j._about
  return j
})()
const arcError = (message, code = 400) => json({ error: { code, message, details: [] } }, 400)
export const fixtureMode = (env = process.env) => env.DRAFTHOUSE_FIXTURES === '1'
// any key that could carry a person: the recorder refuses to write a fixture that has one, and a test reads every
// committed fixture against it (round 9, item 7)
export const FORBIDDEN_KEY = /owner|mail|addr|zip|name$|file_as|^name$|taxpayer|deed/i
/** Every parcel property key in a fixture, against the forbidden list. Throws naming the first. */
export function assertNoPersonKeys(rec) {
  for (const p of rec.parcels || []) for (const k of Object.keys(p.properties || {})) if (FORBIDDEN_KEY.test(k) && !/situs|legal/i.test(k)) throw new Error(`${rec.slug}: forbidden key ${k} in a parcel record`)
  for (const a of rec.addressPoints || []) for (const k of Object.keys(a)) if (!/^(fulladdr|municipality|parcel_id|point)$/.test(k)) throw new Error(`${rec.slug}: unexpected address-point key ${k}`)
  for (const r of rec.roads || []) for (const k of Object.keys(r.properties || {})) if (!Object.values(ROAD_SOURCE.fields).includes(k)) throw new Error(`${rec.slug}: unexpected road key ${k}`)
  for (const [layer, rows] of Object.entries(rec.nfhl || {})) for (const row of rows) for (const k of Object.keys(row)) if (!(NFHL_KEEP[layer] || []).includes(k)) throw new Error(`${rec.slug}: unexpected NFHL key ${k} on layer ${layer}`)
}
/** The NFHL columns a recording keeps per layer: the ones server/lots.mjs reads, and nothing else. */
export const NFHL_KEEP = {
  0: ['STUDY_ID'],
  1: ['DFIRM_ID', 'LOMR_ID', 'CASE_NO', 'EFF_DATE', 'STATUS'],
  3: ['DFIRM_ID', 'PANEL', 'FIRM_PAN', 'PANEL_TYP', 'EFF_DATE', 'SCALE'],
  28: ['DFIRM_ID', 'FLD_AR_ID', 'FLD_ZONE', 'ZONE_SUBTY', 'SFHA_TF', 'STATIC_BFE', 'DEPTH'],
  34: ['CASENUMBER', 'STATUS', 'DETERMINATIONTYPE', 'DATEENDED'],
}
/** A made-up owner and mailing address for a parcel, so the owner-gating tests never need a real one (round 10, item 7). */
export const OWNER_SENTINEL = 'SENTINEL OWNER'
export const MAILING_SENTINEL = 'PO BOX 0 SENTINEL'
const withSentinel = (src, props) => {
  const out = { ...props }
  const id = props[src.fields.propId]
  const own = Array.isArray(src.fields.owner) ? src.fields.owner : src.fields.owner ? [src.fields.owner] : []
  const mail = Array.isArray(src.fields.mailing) ? src.fields.mailing : src.fields.mailing ? [src.fields.mailing] : []
  own.forEach((k, i) => (out[k] = i === 0 ? `${OWNER_SENTINEL} ${id}` : ''))
  mail.forEach((k, i) => (out[k] = i === 0 ? `${MAILING_SENTINEL} ${id}` : i === 1 ? '' : i === mail.length - 1 ? '00000' : i === mail.length - 2 ? 'TX' : i === mail.length - 3 ? 'NOWHERE' : ''))
  return out
}

const LOOPBACK = /^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?|0\.0\.0\.0)$/
let guarded = false
/**
 * Round 10, item 2: in a test run (or a server started with DRAFTHOUSE_FIXTURES=1) nothing may reach a real host.
 * Replaces the global fetch with one that lets loopback through and throws on anything else, naming the host, unless
 * LIVE=1. DRAFTHOUSE_NET_ALLOW lists hosts a run may still reach (comma separated). Returns true when it is on.
 */
export function guardNetwork(env = process.env) {
  if (env.LIVE === '1') return false
  if (guarded) return true
  guarded = true
  const real = globalThis.fetch
  const allow = String(env.DRAFTHOUSE_NET_ALLOW || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean)
  globalThis.fetch = async function guardedFetch(input, init) {
    let host = ''
    try {
      host = new URL(typeof input === 'string' ? input : input?.url || String(input)).hostname.toLowerCase()
    } catch {
      return real(input, init)
    }
    if (LOOPBACK.test(host) || allow.includes(host)) return real(input, init)
    const e = new Error(`a test run tried to reach a real host (${host}) without LIVE=1; answer it from the fixtures (server/fixtures.mjs) or run with LIVE=1`)
    e.code = 'DH_NETWORK_GUARD'
    console.error(e.message)
    throw e
  }
  return true
}

export function loadFixtures(dir = FIXTURE_DIR) {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f !== 'layers.json')
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))
}

const PARCEL_URLS = new Set(PARCEL_SOURCES.flatMap((s) => [s.url, ...(s.fallbacks || [])]).filter(Boolean))
const AP_URLS = new Map(PARCEL_SOURCES.filter((s) => s.addressPoints).map((s) => [s.addressPoints.url, s]))
const ZONING_URLS = Object.entries(ZONING_LAYERS).map(([cityId, L]) => ({ cityId, ...L }))

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const likeToRe = (pat) => new RegExp('^' + pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$')
const distM = (a, b) => Math.hypot((a.lon - b.lon) * 111320 * Math.cos((a.lat * Math.PI) / 180), (a.lat - b.lat) * 110540)
/** Metres from a point to a polygon ring: 0 inside, else the nearest edge (what an ArcGIS buffer query intersects). */
const ringDistM = (pt, ring) => {
  const k = 111320 * Math.cos((pt.lat * Math.PI) / 180)
  const xy = ring.map(([lon, lat]) => [(lon - pt.lon) * k, (lat - pt.lat) * 110540])
  let inside = false
  let best = Infinity
  for (let i = 0, j = xy.length - 1; i < xy.length; j = i++) {
    const [xi, yi] = xy[i]
    const [xj, yj] = xy[j]
    if (yi > 0 !== yj > 0 && 0 < ((xj - xi) * (0 - yi)) / (yj - yi) + xi) inside = !inside
    const l2 = (xj - xi) ** 2 + (yj - yi) ** 2
    const t = l2 ? Math.max(0, Math.min(1, (-xi * (xj - xi) - yi * (yj - yi)) / l2)) : 0
    best = Math.min(best, Math.hypot(xi + (xj - xi) * t, yi + (yj - yi) * t))
  }
  return inside ? 0 : best
}
const outerRings = (geom) => (geom?.type === 'Polygon' ? [geom.coordinates[0]] : geom?.type === 'MultiPolygon' ? geom.coordinates.map((p) => p[0]) : [])
const centroid = (ring) => ({ lon: ring.reduce((s, p) => s + p[0], 0) / ring.length, lat: ring.reduce((s, p) => s + p[1], 0) / ring.length })

/** The where clause's conditions: [[field, op, value, quoted]]; LIKE values keep their wildcards; a bare number is unquoted. */
export function parseWhere(where) {
  const out = []
  for (const m of String(where || '').matchAll(/(?:UPPER\()?([A-Za-z_][A-Za-z0-9_]*)\)?\s*(=|LIKE)\s*(?:'((?:[^']|'')*)'|(\d+))/g)) out.push([m[1], m[2], m[3] !== undefined ? m[3].replace(/''/g, "'") : m[4], m[3] !== undefined])
  return out
}
/**
 * What the live layer would say to this query, before any data: an unknown layer is "Invalid URL"; a field in
 * outFields or where that the layer lacks is "Failed to execute query."; a quoted value on an integer field is
 * "Unable to complete operation." (the exact answers RGV911 and FEMA gave on Nov 19, 2026). null when the query is fine.
 */
export function layerRefusal(base, q) {
  const L = LAYERS[base]
  if (!L) {
    // a layer number nobody described under a service we do describe (NFHL/21) does not exist
    const service = base.replace(/\/\d+$/, '')
    if (Object.keys(LAYERS).some((k) => k.startsWith(service + '/'))) return arcError('Invalid URL', 400)
    return null
  }
  const fields = L.fields || {}
  const outFields = (q.get('outFields') || '*').trim()
  if (outFields !== '*') for (const f of outFields.split(',').map((x) => x.trim()).filter(Boolean)) if (!(f in fields)) return arcError('Failed to execute query.')
  for (const [field, , , quoted] of parseWhere(q.get('where'))) {
    if (!(field in fields)) return arcError('Failed to execute query.')
    if (fields[field] === 'integer' && quoted) return arcError('Unable to complete operation.')
  }
  return null
}
const matches = (attrs, conds) =>
  conds.every(([field, op, value]) => {
    const v = attrs[field]
    if (v === undefined || v === null) return false
    return op === '=' ? String(v).trim() === String(value).trim() : likeToRe(value.toUpperCase()).test(String(v).toUpperCase())
  })

/**
 * A fetch that answers from the fixtures. Unknown URLs get a 404 with a JSON error, so a module under test
 * fails the way it would on a dead service, never by reaching the internet.
 */
// Test switches for a server started on the fixtures: DRAFTHOUSE_FIXTURE_OWNER=sentinel adds a made-up owner and
// mailing address to every parcel; DRAFTHOUSE_FIXTURE_THROW=host[,host] makes calls to those hosts drop the connection.
export function fixtureFetch(fixtures = loadFixtures(), { log = () => {}, failUrls = [], throwUrls = String(process.env.DRAFTHOUSE_FIXTURE_THROW || '').split(',').map((x) => x.trim()).filter(Boolean), ownerSentinel = process.env.DRAFTHOUSE_FIXTURE_OWNER === 'sentinel' } = {}) {
  // the same parcel can sit in two recordings (neighbouring lots): one copy per county and id
  const seen = new Set()
  const allParcels = fixtures.flatMap((f) => (f.parcels || []).map((p) => ({ ...p, county: f.county, fixture: f }))).filter((p) => {
    const src = PARCEL_SOURCES.find((s) => s.county === p.county && s.kind === 'arcgis')
    const k = `${p.county}|${src ? p.properties?.[src.fields.propId] : JSON.stringify(p.properties)}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  return async function fetchFixture(url, opts = {}) {
    const u = new URL(String(url))
    const base = u.origin + u.pathname.replace(/\/query$/, '')
    const q = u.searchParams
    log(`fixture fetch ${base}`)
    if (failUrls.some((f) => base.includes(f))) return json({ error: { code: 500, message: 'fixture: this URL is set to fail' } }, 500)
    // a dropped connection, the way undici reports one (round 10, item 6)
    if (throwUrls.some((f) => base.includes(f))) throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }) })
    // a layer's own description (?f=json), for code that reads field types before it queries
    if (LAYERS[base] && u.pathname.endsWith('/query') === false && q.get('f') === 'json') return json({ name: LAYERS[base].name, fields: Object.entries(LAYERS[base].fields).map(([name, type]) => ({ name, type: 'esriFieldType' + type[0].toUpperCase() + type.slice(1) })) })
    if (u.pathname.endsWith('/query')) {
      const refusal = layerRefusal(base, q)
      if (refusal) return refusal
    }
    // the Census geocoder
    if (u.hostname === 'geocoding.geo.census.gov') {
      const want = parseAddress(q.get('address') || '')
      const f = fixtures.find((x) => {
        const have = parseAddress(x.address)
        return have.number === want.number && have.street && want.street && (have.street.includes(want.street) || want.street.includes(have.street))
      })
      return json({ result: { input: { address: { address: q.get('address') } }, addressMatches: f?.census ? [f.census] : [] } })
    }
    // address points (RGV911 layer 0)
    if (AP_URLS.has(base)) {
      const conds = parseWhere(q.get('where'))
      const feats = fixtures.flatMap((f) => (f.addressPoints || []).filter((a) => matches(a, conds)).map(({ point, ...a }) => ({ type: 'Feature', properties: a, geometry: point && q.get('returnGeometry') !== 'false' ? { type: 'Point', coordinates: point } : null })))
      return json({ type: 'FeatureCollection', features: feats })
    }
    // the parcel layers
    if (PARCEL_URLS.has(base)) {
      const src = PARCEL_SOURCES.find((s) => s.url === base || (s.fallbacks || []).includes(base))
      let feats = allParcels.filter((p) => p.county === src.county)
      if (q.get('where')) feats = feats.filter((p) => matches(p.properties, parseWhere(q.get('where'))))
      else if (q.get('geometry')) {
        const [lon, lat] = q.get('geometry').split(',').map(Number)
        const d = +(q.get('distance') || 0)
        feats = feats.filter((p) => outerRings(p.geometry).some((ring) => ringDistM({ lon, lat }, ring) <= d))
      }
      return json({ type: 'FeatureCollection', features: feats.map(({ county, fixture, ...p }) => ({ type: 'Feature', ...p, properties: ownerSentinel ? withSentinel(src, p.properties) : p.properties })) })
    }
    // TIGERweb roads: the recorded road pieces of the nearest fixture, per layer
    if (base.startsWith(ROAD_SOURCE.url + '/')) {
      const layer = +(base.match(/MapServer\/(\d+)$/) || [])[1]
      const [lon, lat] = (q.get('geometry') || '0,0').split(',').map(Number)
      const near = fixtures.filter((f) => f.point && f.roads).map((f) => ({ f, d: distM({ lon, lat }, f.point) })).sort((a, b) => a.d - b.d)[0]
      if (!near || near.d > 150) return json({ type: 'FeatureCollection', features: [] })
      return json({ type: 'FeatureCollection', features: near.f.roads.filter((r) => r.layer === layer).map((r) => ({ type: 'Feature', properties: r.properties, geometry: r.geometry })) })
    }
    // FEMA's National Flood Hazard Layer: the layer number picks the fixture's recorded answer at the nearest point
    if (u.hostname === 'hazards.fema.gov') {
      const layer = (u.pathname.match(/MapServer\/(\d+)\/query/) || [])[1]
      const [lon, lat] = (q.get('geometry') || '0,0').split(',').map(Number)
      const near = fixtures.filter((f) => f.point).map((f) => ({ f, d: distM({ lon, lat }, f.point) })).sort((a, b) => a.d - b.d)[0]
      if (!near || near.d > 300) return json({ features: [] })
      const feats = (near.f.nfhl?.[layer] || []).map((attributes) => ({ attributes }))
      return json({ features: feats })
    }
    // zoning layers (and Harlingen's service list)
    const z = ZONING_URLS.find((L) => base === L.url || base.startsWith(L.url))
    if (z) {
      if (z.newestOf && base === z.url) return json({ services: [{ name: 'COH_Zoning_Map_2024', type: 'FeatureServer' }, { name: 'COH_Zoning_Map_2026', type: 'FeatureServer' }] })
      const [lon, lat] = (q.get('geometry') || '0,0').split(',').map(Number)
      const near = fixtures.filter((f) => f.point && f.zoning?.cityId === z.cityId).map((f) => ({ f, d: distM({ lon, lat }, f.point) })).sort((a, b) => a.d - b.d)[0]
      if (!near || near.d > 300) return json({ features: [] })
      return json({ features: (near.f.zoning.features || []).map((attributes) => ({ attributes })) })
    }
    if (u.hostname === 'app.regrid.com') return json({ error: 'fixture: Regrid is never called in tests' }, 401)
    return json({ error: { code: 404, message: `no fixture answers ${base}` } }, 404)
  }
}
