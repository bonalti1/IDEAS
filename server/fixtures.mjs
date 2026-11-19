// Recorded answers from the parcel, flood and zoning services (round 7). CI never hits the network: with
// DRAFTHOUSE_FIXTURES=1 the server's fetch for those hosts answers from test/fixtures/parcels/*.json, and
// the tests pass the same function in as fetchImpl. scripts/make-parcel-fixtures.mjs writes the files:
// from the live services behind LIVE=1 (owner and mailing redacted before anything is committed), or, when
// the services cannot be reached from the build machine, built from the research numbers and marked
// synthetic: true so nobody mistakes them for a recording.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeSitus, parseAddress } from './parcels.mjs'
import { PARCEL_SOURCES } from './parcel-sources.mjs'
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
  for (const a of rec.addressPoints || []) for (const k of Object.keys(a)) if (!/^(fulladdr|municipality|parcel_id)$/.test(k)) throw new Error(`${rec.slug}: unexpected address-point key ${k}`)
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
    return op === '=' ? String(v) === String(value) : likeToRe(value.toUpperCase()).test(String(v).toUpperCase())
  })

/**
 * A fetch that answers from the fixtures. Unknown URLs get a 404 with a JSON error, so a module under test
 * fails the way it would on a dead service, never by reaching the internet.
 */
export function fixtureFetch(fixtures = loadFixtures(), { log = () => {}, failUrls = [] } = {}) {
  const allParcels = fixtures.flatMap((f) => (f.parcels || []).map((p) => ({ ...p, county: f.county, fixture: f })))
  return async function fetchFixture(url, opts = {}) {
    const u = new URL(String(url))
    const base = u.origin + u.pathname.replace(/\/query$/, '')
    const q = u.searchParams
    log(`fixture fetch ${base}`)
    if (failUrls.some((f) => base.includes(f))) return json({ error: { code: 500, message: 'fixture: this URL is set to fail' } }, 500)
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
      const feats = fixtures.flatMap((f) => (f.addressPoints || []).filter((a) => matches(a, conds)).map((a) => ({ type: 'Feature', properties: a, geometry: null })))
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
        feats = feats.filter((p) => p.geometry.coordinates[0].some((pt) => distM({ lon, lat }, { lon: pt[0], lat: pt[1] }) <= d + 1))
      }
      return json({ type: 'FeatureCollection', features: feats.map(({ county, fixture, ...p }) => ({ type: 'Feature', ...p })) })
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
