// Writes test/fixtures/parcels/*.json (the recorded answers the parcel, road, flood and zoning tests replay, and
// the DRAFTHOUSE_FIXTURES=1 server with them) and test/fixtures/parcels/layers.json (each layer's own field list).
//
//   LIVE=1 node scripts/make-parcel-fixtures.mjs          records every case from the live services: the Census
//                                                         geocoder, the county parcel and address-point layers,
//                                                         TIGERweb roads, FEMA NFHL and the city zoning layers
//   LIVE=1 node scripts/make-parcel-fixtures.mjs kerria   records only the cases whose slug holds the word
//   node scripts/make-parcel-fixtures.mjs                 rewrites only the synthetic case (an address the Census
//                                                         does not know); recordings are left alone
//
// Owner names and mailing addresses never reach the repo (round 9 item 7, round 10 item 7): a recording keeps only
// the allow-listed columns (ids, legal, situs, acres), the recorder refuses to write a file with a person-shaped key,
// and an owner's name that also sits inside a kept column (a public legal description) is cut out of it; the file
// carries the counts, never a value. An owner-occupied lot's mailing address is its situs by definition, and stays.
// On a machine whose Node does not read HTTPS_PROXY, run it with NODE_USE_ENV_PROXY=1.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PARCEL_SOURCES, ROAD_SOURCE, sourcesFor } from '../server/parcel-sources.mjs'
import { ZONING_LAYERS } from '../server/zoning.mjs'
import { makeParcels, interiorLonLat, parseAddress, whereClause, attr } from '../server/parcels.mjs'
import { makeLots } from '../server/lots.mjs'
import { makeZoning } from '../server/zoning.mjs'
import { FORBIDDEN_KEY, assertNoPersonKeys, fixtureFetch, NFHL_KEEP } from '../server/fixtures.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(__dirname, '..', 'test', 'fixtures', 'parcels')
const EARTH_FT = 20902231
const LIVE = process.env.LIVE === '1'
const only = process.argv.slice(2)

// ── the cases ──────────────────────────────────────────────────────────────────────────────────────
// The nine front-edge addresses of the round-10 review, the Pharr address whose county address point names the
// neighbour, two lots that are not house districts, and the address the Census matches on the wrong side of town.
const CASES = [
  { slug: 'kerria-1201-mcallen', address: '1201 Kerria Ave, McAllen, TX 78501', county: 'Hidalgo County', cityId: 'mcallen' },
  { slug: 'melissa-36-brownsville', address: '36 Melissa Dr, Brownsville, TX 78526', county: 'Cameron County', cityId: 'brownsville' },
  { slug: 'curtis-clark-5435-corpus-christi', address: '5435 Curtis Clark Dr, Corpus Christi, TX 78412', county: 'Nueces County', cityId: 'corpuschristi' },
  { slug: 'n-27th-3305-mcallen', address: '3305 N 27th St, McAllen, TX 78501', county: 'Hidalgo County', cityId: 'mcallen' },
  { slug: 'armagoza-1534-edinburg', address: '1534 Armagoza Dr, Edinburg, TX 78541', county: 'Hidalgo County', cityId: 'edinburg' },
  { slug: 'yvonne-3013-edinburg', address: '3013 Yvonne St, Edinburg, TX 78542', county: 'Hidalgo County', cityId: 'edinburg' },
  { slug: 'royal-palm-2218-mission', address: '2218 Royal Palm Dr, Mission, TX 78572', county: 'Hidalgo County', cityId: 'mission' },
  { slug: 'e-30th-2454-brownsville', address: '2454 E 30th St, Brownsville, TX 78521', county: 'Cameron County', cityId: 'brownsville' },
  { slug: 'sierra-madre-4175-brownsville', address: '4175 Sierra Madre Dr, Brownsville, TX 78521', county: 'Cameron County', cityId: 'brownsville' },
  { slug: 'cage-118-pharr', address: '118 S Cage Blvd, Pharr, TX 78577', county: 'Hidalgo County', cityId: 'pharr' },
  { slug: 's-10th-2200-mcallen', address: '2200 S 10th St, McAllen, TX 78503', county: 'Hidalgo County', cityId: 'mcallen' },
  { slug: 'e-elizabeth-1001-brownsville', address: '1001 E Elizabeth St, Brownsville, TX 78520', county: 'Cameron County', cityId: 'brownsville' },
  // a pie lot on a cul-de-sac: the street side is an arc of six 8 ft chords (round 11, item 2)
  { slug: 'kiskadee-2002-mission', address: '2002 Kiskadee Ln, Mission, TX 78572', county: 'Hidalgo County', cityId: 'mission' },
  // Willacy: the address point for 323 is on the parcel the county lists as 329 (round 11, item 6); a corner lot; Jim Wells
  { slug: 'n-11th-323-raymondville', address: '323 N 11th St, Raymondville, TX 78580', county: 'Willacy County', cityId: null },
  { slug: 'w-harris-510-raymondville', address: '510 W Harris Ave, Raymondville, TX 78580', county: 'Willacy County', cityId: null },
  { slug: 'se-3rd-344-premont', address: '344 SE 3rd St, Premont, TX 78375', county: 'Jim Wells County', cityId: null },
  // typed W, matched E by the Census (round 10, item 3): the homeowner is asked before any parcel is offered
  { slug: 'w-nolana-1300-mcallen', address: '1300 W Nolana Ave, McAllen, TX 78504', county: 'Hidalgo County', cityId: 'mcallen' },
  {
    // a rural Starr County tract the Census does not know: no digital FIRM, no recorded subdivision (round 7, items 4 and 8)
    slug: 'ranch-rd-rio-grande-city',
    address: '4400 Ranch Rd, Rio Grande City, TX 78582',
    county: 'Starr County',
    cityId: null,
    synthetic: {
      place: null,
      shape: { origin: [-98.8402, 26.4302], pts: [[0, 0], [300, 0], [300, 726], [0, 726]] },
      census: { street: 'RANCH', suffix: 'RD', zip: '78582', offsetFt: [150, -30] },
      parcel: { prop_id: 34110, geo_id: '0400-0000-0091', legal_desc: 'ABST 91 SHARE 22 PORCION 76 5.00 AC', situs_num: '4400', situs_street_prefx: null, situs_street: 'RANCH', situs_street_sufix: 'RD', situs_city: 'RIO GRANDE CITY', legal_acreage: 5.0 },
      road: { NAME: 'Ranch Rd', BASENAME: 'Ranch', SUFTYPEABRV: 'Rd', MTFCC: 'S1400', line: [[-200, -30], [500, -30]] },
      nfhl: { 0: [], 1: [], 3: [], 28: [], 34: [] },
    },
  },
]

const round7 = (ring) => ring.map(([x, y]) => [+x.toFixed(7), +y.toFixed(7)])
/** Feet (x east, y north) from an origin → lon/lat with the same tangent-plane maths parcels.mjs uses, so areas round-trip. */
function ringLonLat(origin, pts, close = true) {
  const [lon0, lat0] = origin
  const k = Math.cos((lat0 * Math.PI) / 180)
  const ring = pts.map(([x, y]) => [+(lon0 + (x * 180) / (Math.PI * EARTH_FT * k)).toFixed(8), +(lat0 + (y * 180) / (Math.PI * EARTH_FT)).toFixed(8)])
  if (close) ring.push(ring[0])
  return ring
}

function synthetic(c) {
  const s = c.synthetic
  const parsed = parseAddress(c.address)
  const ring = ringLonLat(s.shape.origin, s.shape.pts)
  const interior = interiorLonLat(ring)
  const [lon, lat] = ringLonLat(s.shape.origin, [s.census.offsetFt], false)[0]
  const city = c.address.split(',')[1].trim().toUpperCase()
  const { line, ...roadProps } = s.road
  return {
    synthetic: true,
    builtFrom: 'an address the Census geocoder does not know, kept so a county tract with no digital FIRM and no recorded subdivision can be tested; every number is a stand-in',
    recordedAt: new Date().toISOString().slice(0, 10),
    slug: c.slug,
    address: c.address,
    county: c.county,
    cityId: c.cityId,
    point: { lon: interior[0], lat: interior[1] },
    census: {
      matchedAddress: `${parsed.number} ${s.census.street} ${s.census.suffix}, ${city}, TX, ${s.census.zip}`,
      coordinates: { x: lon, y: lat },
      addressComponents: { fromAddress: parsed.number, toAddress: parsed.number, preDirection: '', streetName: s.census.street, suffixType: s.census.suffix, suffixDirection: '', city, state: 'TX', zip: s.census.zip },
      geographies: { Counties: [{ NAME: c.county, GEOID: '48' }], 'Incorporated Places': [] },
    },
    addressPoints: [],
    parcels: [{ type: 'Feature', properties: s.parcel, geometry: { type: 'Polygon', coordinates: [ring] } }],
    roads: [{ layer: 8, properties: roadProps, geometry: { type: 'LineString', coordinates: ringLonLat(s.shape.origin, line, false) } }],
    nfhl: s.nfhl,
    zoning: null,
  }
}

const UA = { 'User-Agent': 'DraftHouse/1.0 (South Texas Builders office; fixture recorder)' }
async function getJson(url, headers = {}) {
  let last
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { accept: 'application/json', ...headers }, signal: AbortSignal.timeout(25000) })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const b = await r.json()
      if (b.error) throw new Error(b.error.message || 'query error')
      return b
    } catch (e) {
      last = e
      await new Promise((ok) => setTimeout(ok, 800 * (i + 1)))
    }
  }
  throw new Error(`${url.split('?')[0]}: ${last.message}`)
}
const arcgis = (url, params, headers = {}) => getJson(`${url}/query?${new URLSearchParams({ f: 'geojson', outSR: '4326', returnGeometry: 'true', outFields: '*', ...params })}`, headers)
const at = (lon, lat, more = {}) => ({ geometry: `${lon},${lat}`, geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', ...more })

const mem = () => {
  const m = new Map()
  return { meta: { get: async (k) => (m.has(k) ? m.get(k) : null), set: async (k, v) => m.set(k, v) } }
}
/** The pipeline's own answer for an address, through any fetch: what a fixture must replay to. */
async function pipeline(address, fetchImpl) {
  const store = mem()
  const lots = makeLots({ store, files: {}, interpreter: {}, event: async () => {}, fetchImpl, log: () => {} })
  const parcels = makeParcels({ store, fetchImpl, geocode: (a) => lots.geocode(a), log: () => {}, event: async () => {}, env: {} })
  const zoning = makeZoning({ store, fetchImpl, log: () => {} })
  const p = await parcels.lookup({ address, force: true })
  const out = { match: p.match, propId: p.propId || null, matchedBy: p.matchedBy || null, areaSf: p.areaSf || null, edges: p.edges?.length || 0, frontFt: p.match === 'one' ? p.edges[p.frontEdge].lengthFt : null, frontBy: p.frontBy || null, frontStreet: p.frontStreet || null, corner: !!p.corner, frontWidthFt: p.frontWidthFt ?? null, frontChords: p.frontChords ?? null, confidence: p.confidence || null, interior: p.interior || null }
  return { out, lots, zoning, parcel: p }
}

/** Records one case from the live services; only allow-listed columns are kept. */
async function record(c) {
  const parsed = parseAddress(c.address)
  const g = await getJson(`https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress?address=${encodeURIComponent(c.address)}&benchmark=Public_AR_Current&vintage=Current_Current&layers=Counties,Incorporated%20Places&format=json`)
  const m0 = g.result?.addressMatches?.[0]
  if (!m0) throw new Error(`Census did not find ${c.address}`)
  const slim = (list) => (list || []).map((x) => ({ NAME: x.NAME, BASENAME: x.BASENAME, GEOID: x.GEOID }))
  const census = { matchedAddress: m0.matchedAddress, coordinates: m0.coordinates, addressComponents: m0.addressComponents, geographies: { Counties: slim(m0.geographies?.Counties), 'Incorporated Places': slim(m0.geographies?.['Incorporated Places']) } }
  const src = sourcesFor(c.county)[0]
  const F = src.fields
  const T = src.types || {}
  const headers = { ...UA, ...(src.headers || {}) }
  // the allow-list: only the columns parcel-sources.mjs maps for ids, legal, situs and acres; never the owner or mailing columns
  const keep = new Set([F.propId, F.geoId, F.legal, F.acres, F.situs, F.situsNum, F.situsStreet, ...(F.situsParts || [])].filter(Boolean))
  const redact = (props) => {
    const out = Object.fromEntries(Object.entries(props || {}).filter(([k]) => keep.has(k)))
    for (const k of Object.keys(out)) if (FORBIDDEN_KEY.test(k) && !/situs|legal/i.test(k)) throw new Error(`the allow-list kept a forbidden key: ${k}`)
    return out
  }
  const raw = new Map() // prop id → the raw feature, in memory only (for the owner cross-check)
  const take = (feats) => {
    for (const f of feats || []) {
      const id = attr(f.properties || {}, F.propId)
      if (id != null && f.geometry?.type === 'Polygon' && !raw.has(String(id))) raw.set(String(id), f)
      else if (id != null && f.geometry && !raw.has(String(id))) raw.set(String(id), f)
    }
  }
  // 1. the address points for the typed number and street, with their positions
  let addressPoints = []
  if (src.addressPoints) {
    const ap = src.addressPoints
    const got = await arcgis(ap.url, { where: whereClause([[ap.fields.fulladdr, 'LIKE', `${parsed.number} %${parsed.street}%`]], ap.types || {}), outFields: [ap.fields.fulladdr, ap.fields.municipality, ap.fields.parcelId].join(',') }, headers)
    addressPoints = (got.features || []).map((f) => ({ fulladdr: f.properties[ap.fields.fulladdr], municipality: f.properties[ap.fields.municipality], parcel_id: f.properties[ap.fields.parcelId], point: f.geometry?.type === 'Point' ? [+f.geometry.coordinates[0].toFixed(7), +f.geometry.coordinates[1].toFixed(7)] : null }))
    // the parcels those points name
    for (const id of [...new Set(addressPoints.map((a) => a.parcel_id).filter((v) => v != null && /^\d+$/.test(String(v).trim())))].slice(0, 8)) take((await arcgis(src.url, { where: whereClause([[ap.parcelKey, '=', String(id).trim()]], T) }, headers)).features)
  }
  // 2. the situs query the pipeline runs
  let where = null
  if (F.situs) where = whereClause([[F.situs, 'LIKE', `${parsed.number} %${parsed.street}%`]], T)
  else if (F.situsNum && F.situsStreet) where = whereClause([[F.situsNum, '=', parsed.number], [F.situsStreet, 'LIKE', `${parsed.street}%`]], T)
  if (where) take((await arcgis(src.url, { where }, headers)).features)
  // 3. everything within 45 m of the Census point (the pipeline's buffer is 40 m)
  take((await arcgis(src.url, at(census.coordinates.x, census.coordinates.y, { distance: '45', units: 'esriSRUnit_Meter' }), headers)).features)
  // the live pipeline's answer tells which parcel is the lot
  const live = await pipeline(c.address, (url, opts = {}) => fetch(url, opts))
  const interior = live.out.interior ? [live.out.interior.lon, live.out.interior.lat] : [census.coordinates.x, census.coordinates.y]
  // 4. the roads around the lot, the flood layers and the zoning at its interior point
  const RF = ROAD_SOURCE.fields
  const roads = []
  for (const layer of [...ROAD_SOURCE.layers, ...(ROAD_SOURCE.lastResort || [])]) {
    const r = await arcgis(`${ROAD_SOURCE.url}/${layer}`, at(interior[0], interior[1], { distance: String(ROAD_SOURCE.bufferM), units: 'esriSRUnit_Meter', outFields: [RF.name, RF.base, RF.suffix, RF.mtfcc].join(',') }))
    for (const f of r.features || []) roads.push({ layer, properties: { [RF.name]: f.properties[RF.name] ?? null, [RF.base]: f.properties[RF.base] ?? null, [RF.suffix]: f.properties[RF.suffix] ?? null, [RF.mtfcc]: f.properties[RF.mtfcc] ?? null }, geometry: { type: f.geometry.type, coordinates: f.geometry.type === 'LineString' ? round7(f.geometry.coordinates) : f.geometry.coordinates.map(round7) } })
  }
  const nfhl = {}
  for (const layer of [0, 1, 3, 28, 34]) {
    const r = await getJson(`https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/${layer}/query?${new URLSearchParams({ ...at(interior[0], interior[1]), outFields: NFHL_KEEP[layer].join(','), returnGeometry: 'false', f: 'json' })}`)
    nfhl[layer] = (r.features || []).map((f) => Object.fromEntries(NFHL_KEEP[layer].map((k) => [k, f.attributes?.[k] ?? null])))
  }
  let zoning = null
  if (c.cityId && ZONING_LAYERS[c.cityId] && !ZONING_LAYERS[c.cityId].newestOf) {
    const L = ZONING_LAYERS[c.cityId]
    const zk = [L.field, L.nameField, L.newest].filter(Boolean)
    const r = await getJson(`${L.url}/query?${new URLSearchParams({ ...at(interior[0], interior[1]), outFields: zk.join(','), returnGeometry: 'false', f: 'json' })}`)
    zoning = { cityId: c.cityId, features: (r.features || []).map((f) => Object.fromEntries(zk.map((k) => [k, f.attributes?.[k] ?? null]))) }
  }
  const ownerCol = Array.isArray(F.owner) ? F.owner : F.owner ? [F.owner] : []
  const mailCol = Array.isArray(F.mailing) ? F.mailing.slice(0, 1) : F.mailing ? [F.mailing] : []
  let scrubbed = 0
  // full precision on the outline: rounding it to 1 cm moves the area by a few square feet
  const parcels = [...raw.values()].filter((f) => f.geometry).map((f) => {
    const props = redact(f.properties)
    // an owner's name can sit inside a public legal description ("... SMITH SUBDIVISION"): it is cut out of the kept columns
    for (const k of ownerCol) {
      const v = String(attr(f.properties || {}, k) ?? '').trim()
      if (v.length < 6) continue
      for (const [pk, pv] of Object.entries(props)) if (typeof pv === 'string' && pv.includes(v)) {
        props[pk] = pv.split(v).join('[owner name removed]')
        scrubbed++
      }
    }
    return { type: 'Feature', properties: props, geometry: f.geometry }
  })
  const rec = { synthetic: false, recordedAt: new Date().toISOString().slice(0, 10), slug: c.slug, address: c.address, county: c.county, cityId: c.cityId, point: { lon: +interior[0].toFixed(7), lat: +interior[1].toFixed(7) }, census, addressPoints, parcels, roads, nfhl, zoning, expect: { ...live.out, interior: undefined } }
  // the owner cross-check: counts only, nothing printed
  const text = JSON.stringify({ ...rec, expect: undefined })
  const seen = (cols) => [...raw.values()].filter((f) => cols.some((k) => { const v = String(attr(f.properties || {}, k) ?? '').trim(); return v.length >= 6 && text.includes(JSON.stringify(v).slice(1, -1)) })).length
  rec.ownerCheck = { parcels: raw.size, ownerStringsInKeptColumns: seen(ownerCol), ownerStringsCutFromKeptColumns: scrubbed, mailingLinesInKeptColumns: seen(mailCol), note: 'counts only, no values; an owner name found inside a kept column (a legal description) is cut out before the file is written; an owner-occupied lot is mailed at its situs, which is the property address and stays' }
  if (rec.ownerCheck.ownerStringsInKeptColumns) throw new Error(`${rec.ownerCheck.ownerStringsInKeptColumns} owner string(s) still sit in a kept column`)
  // the replay must give the live answer
  const replay = await pipeline(c.address, fixtureFetch([rec], { strict: true }))
  const same = ['match', 'propId', 'matchedBy', 'confidence', 'areaSf', 'edges', 'frontFt', 'frontWidthFt', 'frontChords', 'frontBy', 'frontStreet', 'corner'].filter((k) => JSON.stringify(replay.out[k]) !== JSON.stringify(live.out[k]))
  if (same.length) throw new Error(`the recording does not replay the live answer (${same.map((k) => `${k}: live ${JSON.stringify(live.out[k])}, replay ${JSON.stringify(replay.out[k])}`).join('; ')})`)
  return rec
}

/** Every layer's own field list, as the service describes it: what the fixture server enforces and the field check reads. */
async function describeLayers() {
  const kind = (t) => String(t || '').replace('esriFieldType', '').toLowerCase().replace(/^smallinteger$/, 'integer')
  const out = { _about: `Layer descriptions the fixture server enforces: a query naming a field a layer does not have, a quoted value on an integer field, or a layer that does not exist answers the way ArcGIS does, so a wrong field name or layer number fails in CI the way it fails live. Read from the live services on ${new Date().toISOString().slice(0, 10)} by scripts/make-parcel-fixtures.mjs.` }
  const urls = [
    ...[0, 1, 3, 28, 34].map((n) => `https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/${n}`),
    ...PARCEL_SOURCES.filter((s) => s.kind === 'arcgis' && !s.disabled).flatMap((s) => [s.url, ...(s.fallbacks || []), s.addressPoints?.url]),
    ...[...ROAD_SOURCE.layers, ...(ROAD_SOURCE.lastResort || [])].map((n) => `${ROAD_SOURCE.url}/${n}`),
    ...Object.values(ZONING_LAYERS).filter((L) => !L.newestOf).map((L) => L.url),
  ].filter(Boolean)
  for (const url of [...new Set(urls)]) {
    try {
      const d = await getJson(`${url}?f=json`, UA)
      out[url] = { name: d.name, fields: Object.fromEntries((d.fields || []).map((f) => [f.name, kind(f.type)])) }
    } catch (e) {
      console.error(`layer ${url}: ${e.message}; left out of layers.json`)
    }
  }
  // Harlingen's zoning service is found by its newest name; the test double answers under this one
  out['https://services3.arcgis.com/gSCPzHZGMdbiljnH/arcgis/rest/services/COH_Zoning_Map_2026/FeatureServer/0'] = { name: 'Harlingen zoning', fields: { OBJECTID: 'oid', Zone: 'string' } }
  return out
}

fs.mkdirSync(OUT, { recursive: true })
let failed = 0
for (const c of CASES) {
  if (only.length && !only.some((w) => c.slug.includes(w))) continue
  if (!c.synthetic && !LIVE) continue
  let rec
  try {
    rec = c.synthetic ? synthetic(c) : await record(c)
  } catch (e) {
    failed++
    console.error(`FAILED   ${c.slug}: ${e.message}; the file on disk is left as it was`)
    continue
  }
  assertNoPersonKeys(rec)
  fs.writeFileSync(path.join(OUT, `${c.slug}.json`), JSON.stringify(rec) + '\n')
  console.log(`${rec.synthetic ? 'synthetic' : 'recorded '} ${c.slug}: ${rec.parcels.length} parcel(s), ${rec.roads.length} road piece(s), nfhl ${Object.entries(rec.nfhl).map(([k, v]) => `${k}:${v.length}`).join(' ')}, zoning ${rec.zoning ? rec.zoning.features.length : 'none'}${rec.expect ? `; lot ${rec.expect.propId} by ${rec.expect.matchedBy}, front ${rec.expect.frontFt} ft on ${rec.expect.frontStreet} (${rec.expect.frontBy})${rec.expect.corner ? ', corner' : ''}` : ''}${rec.ownerCheck ? `; owner strings in kept columns ${rec.ownerCheck.ownerStringsInKeptColumns}/${rec.ownerCheck.parcels}, cut ${rec.ownerCheck.ownerStringsCutFromKeptColumns}` : ''}`)
}
if (LIVE && !only.length) {
  fs.writeFileSync(path.join(OUT, 'layers.json'), JSON.stringify(await describeLayers(), null, 1) + '\n')
  console.log('layers.json written')
}
if (failed) process.exitCode = 1
