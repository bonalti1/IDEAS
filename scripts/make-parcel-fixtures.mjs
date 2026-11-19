// Writes test/fixtures/parcels/*.json, the recorded answers the parcel, flood and zoning tests and the
// DRAFTHOUSE_FIXTURES=1 server replay (server/fixtures.mjs).
//
//   LIVE=1 node scripts/make-parcel-fixtures.mjs     records from the live services (Census, the county
//                                                    ArcGIS layers, FEMA NFHL, the city zoning layers) and
//                                                    REDACTS the owner and mailing fields before writing
//   node scripts/make-parcel-fixtures.mjs            builds the same files from the research numbers in
//                                                    docs/FIX-ROUND-7.md (synthetic: true), for a machine
//                                                    that cannot reach the services (this sandbox blocks them)
//
// Owner names and mailing addresses never reach the repo: a recording replaces them with "REDACTED".
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PARCEL_SOURCES, sourcesFor } from '../server/parcel-sources.mjs'
import { ZONING_LAYERS } from '../server/zoning.mjs'
import { interiorLonLat, parseAddress, whereClause, normalizeSitus } from '../server/parcels.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(__dirname, '..', 'test', 'fixtures', 'parcels')
const EARTH_FT = 20902231
const LIVE = process.env.LIVE === '1'
const REDACT = 'REDACTED'

// ── the acceptance set and the extra cases the tests need ──────────────────────────────────────────
// Numbers: edges and areas from the Nov 17, 2026 live lookups quoted in the round-7 brief; everything else is a
// plausible stand-in so the geometry pipeline, the matching steps and the flood/zoning readers can be tested.
const CASES = [
  {
    slug: 'kerria-1201-mcallen',
    address: '1201 Kerria Ave, McAllen, TX 78501',
    county: 'Hidalgo County',
    cityId: 'mcallen',
    place: 'McAllen',
    // a rectangle 80 ft on Kerria Ave (south) by 130.35 ft deep: 10,428 sf
    shape: { origin: [-98.2212, 26.2091], pts: [[0, 0], [80, 0], [80, 130.35], [0, 130.35]] },
    census: { street: 'KERRIA', suffix: 'AVE', zip: '78501', offsetFt: [40, -25] }, // the Census point: mid-front, 25 ft out in the street
    parcel: { prop_id: '255056', geo_id: 'P2500-00-004-0007-00', legal_desc: 'PALMS LOT 7 BLK 4', situs: '1201 KERRIA AVE, MCALLEN TX', owner_name: REDACT, owner_addr: REDACT },
    addressPoint: { fulladdr: '1201 KERRIA AVE', municipality: 'MCALLEN' },
    nfhl: { 0: [{ DFIRM_ID: '48215C', STUDY_TYP: 'NP', EFF_DATE: 1552953600000 }], 28: [{ FLD_ZONE: 'X', ZONE_SUBTY: 'AREA OF MINIMAL FLOOD HAZARD', SFHA_TF: 'F', STATIC_BFE: -9999, DFIRM_ID: '48215C', FLD_AR_ID: '48215C_1' }], 3: [], 21: [], 34: [] },
    zoning: { ZONE: 'R-1' },
    decoys: [
      // the neighbour: same block, next lot east
      { shape: { origin: [-98.2212, 26.2091], pts: [[81, 0], [161, 0], [161, 130.35], [81, 130.35]] }, parcel: { prop_id: '255057', geo_id: 'P2500-00-004-0008-00', legal_desc: 'PALMS LOT 8 BLK 4', situs: '1205 KERRIA AVE, MCALLEN TX', owner_name: REDACT, owner_addr: REDACT }, addressPoint: { fulladdr: '1205 KERRIA AVE', municipality: 'MCALLEN' } },
    ],
  },
  {
    slug: 'melissa-36-brownsville',
    address: '36 Melissa Dr, Brownsville, TX 78526',
    county: 'Cameron County',
    cityId: 'brownsville',
    place: 'Brownsville',
    // five edges: a 70 ft front on Melissa Dr (south), 116.76 ft deep, the rear corner clipped: 8,123 sf
    shape: { origin: [-97.4612, 25.9701], pts: [[0, 0], [70, 0], [70, 106.76], [60, 116.76], [0, 116.76]] },
    census: { street: 'MELISSA', suffix: 'DR', zip: '78526', offsetFt: [35, -22] },
    parcel: { prop_id: '7201140', geo_id: '72-0114-0160-0010-00', legal1: 'MCKENZIE ESTATES LOT 16 BLK 1', situsdispl: '36 MELISSA DR', acres: 0.1865, owner: REDACT, owner_addr: REDACT },
    nfhl: { 0: [{ DFIRM_ID: '48061C', STUDY_TYP: 'NP', EFF_DATE: 1392940800000 }], 28: [{ FLD_ZONE: 'AE', ZONE_SUBTY: null, SFHA_TF: 'T', STATIC_BFE: 20, DFIRM_ID: '48061C', FLD_AR_ID: '48061C_22' }], 3: [{ CASE_NO: '24-06-1234P', EFF_DATE: 1735689600000, STATUS: 'Effective' }], 21: [], 34: [] },
    zoning: { ZoningFNI: 'R-1' },
    decoys: [
      // 1021 Clarissa Dr: across the street, a smaller lot whose centre is nearer the Census point than Melissa's own
      { shape: { origin: [-97.4612, 25.9701], pts: [[5, -32], [65, -32], [65, -97], [5, -97]] }, parcel: { prop_id: '7201099', geo_id: '72-0114-0150-0020-00', legal1: 'MCKENZIE ESTATES LOT 2 BLK 2', situsdispl: '1021 CLARISSA DR', acres: 0.0895, owner: REDACT, owner_addr: REDACT } },
    ],
  },
  {
    slug: 'curtis-clark-5435-corpus-christi',
    address: '5435 Curtis Clark Dr, Corpus Christi, TX 78412',
    county: 'Nueces County',
    cityId: 'corpuschristi',
    place: 'Corpus Christi',
    // 65 ft on Curtis Clark Dr (south) by 145.83 ft: 9,479 sf; the CAD polygon carries a 0.6 ft sliver edge at the
    // rear-left corner that the cleaner removes (the live polygon had one too)
    shape: { origin: [-97.3651, 27.7108], pts: [[0, 0], [65, 0], [65, 145.83], [0.6, 145.83], [0, 145.83]] },
    census: { street: 'CURTIS CLARK', suffix: 'DR', zip: '78412', offsetFt: [32, -24] },
    parcel: { prop_id: '155608', geo_id: '2905-0005-0085', legal_desc: 'GARDENDALE 2 SE/2 OF LT 8 BK 5', situs_num: '5435', situs_street_prefx: null, situs_street: 'CURTIS CLARK', situs_street_sufix: 'DR', situs_city: 'CORPUS CHRISTI', legal_acreage: 0.2176, file_as_name: REDACT, CITY_LIMITS: 'CORPUS CHRISTI' },
    nfhl: { 0: [{ DFIRM_ID: '48355C', STUDY_TYP: 'NP', EFF_DATE: 1551398400000 }], 28: [{ FLD_ZONE: 'X', ZONE_SUBTY: '0.2 PCT ANNUAL CHANCE FLOOD HAZARD', SFHA_TF: 'F', STATIC_BFE: -9999, DFIRM_ID: '48355C', FLD_AR_ID: '48355C_7' }], 3: [], 21: [{ FLD_ZONE: 'AE', SFHA_TF: 'T', STATUS: 'Preliminary' }], 34: [] },
    zoning: { TAG2023: 'RS-6' },
    decoys: [
      // 5402 Burton: the lot behind, across the rear line
      { shape: { origin: [-97.3651, 27.7108], pts: [[0, 146.5], [65, 146.5], [65, 292], [0, 292]] }, parcel: { prop_id: '155620', geo_id: '2905-0005-0100', legal_desc: 'GARDENDALE 2 LT 10 BK 5', situs_num: '5402', situs_street_prefx: null, situs_street: 'BURTON', situs_street_sufix: 'LN', situs_city: 'CORPUS CHRISTI', legal_acreage: 0.2175, file_as_name: REDACT, CITY_LIMITS: 'CORPUS CHRISTI' } },
    ],
  },
  {
    // a rural Starr County tract with no digital FIRM and no recorded subdivision (items 4 and 8)
    slug: 'ranch-rd-rio-grande-city',
    address: '4400 Ranch Rd, Rio Grande City, TX 78582',
    county: 'Starr County',
    cityId: null,
    place: null,
    shape: { origin: [-98.8402, 26.4302], pts: [[0, 0], [300, 0], [300, 726], [0, 726]] }, // 5 acres
    census: { street: 'RANCH', suffix: 'RD', zip: '78582', offsetFt: [150, -30] },
    parcel: { prop_id: '34110', geo_id: '0400-0000-0091', legal_desc: 'ABST 91 SHARE 22 PORCION 76 5.00 AC', situs_num: '4400', situs_street_prefx: null, situs_street: 'RANCH', situs_street_sufix: 'RD', situs_city: 'RIO GRANDE CITY', legal_acreage: 5.0, file_as_name: REDACT },
    nfhl: { 0: [], 28: [], 3: [], 21: [], 34: [] },
    zoning: null,
    decoys: [],
  },
  {
    // a commercial lot in McAllen (item 8: non-residential zoning blocks Send)
    slug: 'n-10th-1300-mcallen',
    address: '1300 N 10th St, McAllen, TX 78501',
    county: 'Hidalgo County',
    cityId: 'mcallen',
    place: 'McAllen',
    shape: { origin: [-98.2303, 26.2142], pts: [[0, 0], [100, 0], [100, 150], [0, 150]] },
    census: { street: '10TH', suffix: 'ST', preDirection: 'N', zip: '78501', offsetFt: [50, -30] },
    parcel: { prop_id: '201314', geo_id: 'M1800-00-001-0001-00', legal_desc: 'MCALLEN ORIGINAL TOWNSITE LOT 1 BLK 18', situs: '1300 N 10TH ST, MCALLEN TX', owner_name: REDACT, owner_addr: REDACT },
    addressPoint: { fulladdr: '1300 N 10TH ST', municipality: 'MCALLEN' },
    nfhl: { 0: [{ DFIRM_ID: '48215C', STUDY_TYP: 'NP', EFF_DATE: 1552953600000 }], 28: [{ FLD_ZONE: 'X', ZONE_SUBTY: 'AREA OF MINIMAL FLOOD HAZARD', SFHA_TF: 'F', STATIC_BFE: -9999, DFIRM_ID: '48215C', FLD_AR_ID: '48215C_1' }], 3: [], 21: [], 34: [] },
    zoning: { ZONE: 'C-3' },
    decoys: [],
  },
]

/** Feet (x east, y north) from an origin → lon/lat with the same tangent-plane maths parcels.mjs uses, so areas round-trip. */
function ringLonLat(origin, pts) {
  const [lon0, lat0] = origin
  const k = Math.cos((lat0 * Math.PI) / 180)
  const ring = pts.map(([x, y]) => [+(lon0 + (x * 180) / (Math.PI * EARTH_FT * k)).toFixed(8), +(lat0 + (y * 180) / (Math.PI * EARTH_FT)).toFixed(8)])
  ring.push(ring[0])
  return ring
}
const censusMatch = (c, shape, parsed) => {
  const [lon, lat] = ringLonLat(shape.origin, [c.census.offsetFt])[0]
  return {
    matchedAddress: `${parsed.number} ${c.census.preDirection ? c.census.preDirection + ' ' : ''}${c.census.street} ${c.census.suffix}, ${(c.place || c.address.split(',')[1].trim()).toUpperCase()}, TX, ${c.census.zip}`,
    coordinates: { x: lon, y: lat },
    addressComponents: { fromAddress: parsed.number, toAddress: parsed.number, preDirection: c.census.preDirection || '', streetName: c.census.street, suffixType: c.census.suffix, suffixDirection: '', city: (c.place || c.address.split(',')[1].trim()).toUpperCase(), state: 'TX', zip: c.census.zip },
    geographies: { Counties: [{ NAME: c.county, GEOID: '48' }], 'Incorporated Places': c.place ? [{ NAME: `${c.place} city` }] : [] },
  }
}

function synthetic(c) {
  const parsed = parseAddress(c.address)
  const ring = ringLonLat(c.shape.origin, c.shape.pts)
  const interior = interiorLonLat(ring)
  const parcels = [{ type: 'Feature', properties: c.parcel, geometry: { type: 'Polygon', coordinates: [ring] } }, ...c.decoys.map((d) => ({ type: 'Feature', properties: d.parcel, geometry: { type: 'Polygon', coordinates: [ringLonLat(d.shape.origin, d.shape.pts)] } }))]
  const addressPoints = [c, ...c.decoys].filter((x) => x.addressPoint).map((x) => ({ ...x.addressPoint, parcel_id: x.parcel.prop_id }))
  return {
    synthetic: true,
    builtFrom: 'the live lookups quoted in the round-7 brief (edges, area, legal, ids) with stand-in coordinates and attributes; the parcel, flood and zoning services are not reachable from the build machine. Re-record with LIVE=1 node scripts/make-parcel-fixtures.mjs.',
    recordedAt: new Date().toISOString().slice(0, 10),
    slug: c.slug,
    address: c.address,
    county: c.county,
    cityId: c.cityId,
    point: { lon: interior[0], lat: interior[1] },
    census: censusMatch(c, c.shape, parsed),
    addressPoints,
    parcels,
    nfhl: c.nfhl,
    zoning: c.zoning && c.cityId ? { cityId: c.cityId, features: [c.zoning] } : null,
  }
}

async function arcgis(url, params, headers = {}) {
  const r = await fetch(`${url}/query?${new URLSearchParams({ f: 'json', outSR: '4326', returnGeometry: 'true', outFields: '*', ...params })}`, { headers, signal: AbortSignal.timeout(20000) })
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`)
  const b = await r.json()
  if (b.error) throw new Error(`${url}: ${b.error.message}`)
  return b
}
/** Records one case from the live services; owner and mailing fields are redacted before anything is returned. */
async function record(c) {
  const parsed = parseAddress(c.address)
  const g = await (await fetch(`https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress?address=${encodeURIComponent(c.address)}&benchmark=Public_AR_Current&vintage=Current_Current&layers=Counties,Incorporated%20Places&format=json`, { signal: AbortSignal.timeout(20000) })).json()
  const census = g.result?.addressMatches?.[0]
  if (!census) throw new Error(`Census did not find ${c.address}`)
  const src = sourcesFor(c.county)[0]
  const F = src.fields
  const redact = (props) => {
    const out = { ...props }
    for (const k of [F.owner, F.mailing].filter(Boolean)) if (k in out) out[k] = REDACT
    for (const k of Object.keys(out)) if (/owner|mail|name$/i.test(k) && !/situs|legal/i.test(k)) out[k] = REDACT
    return out
  }
  let addressPoints = []
  if (src.addressPoints) {
    const ap = await arcgis(src.addressPoints.url, { where: whereClause([[src.addressPoints.fields.fulladdr, 'LIKE', `${parsed.number} %${parsed.street}%`]]), returnGeometry: 'false', f: 'geojson' }, src.headers)
    addressPoints = (ap.features || []).map((f) => f.properties)
  }
  const near = await arcgis(src.url, { geometry: `${census.coordinates.x},${census.coordinates.y}`, geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', distance: '60', units: 'esriSRUnit_Meter', f: 'geojson' }, src.headers)
  const parcels = (near.features || []).map((f) => ({ type: 'Feature', properties: redact(f.properties), geometry: f.geometry }))
  const mine = parcels.find((p) => normalizeSitus(F.situs ? p.properties[F.situs] : [p.properties[F.situsNum], p.properties[F.situsStreet]].join(' ')).startsWith(parsed.number + ' ')) || parcels[0]
  const interior = interiorLonLat(mine.geometry.coordinates[0])
  const nfhl = {}
  for (const layer of [0, 28, 3, 21, 34]) {
    const r = await arcgis(`https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/${layer}`, { geometry: `${interior[0]},${interior[1]}`, geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', returnGeometry: 'false' }).catch(() => ({ features: [] }))
    nfhl[layer] = (r.features || []).map((f) => f.attributes)
  }
  let zoning = null
  if (c.cityId && ZONING_LAYERS[c.cityId] && !ZONING_LAYERS[c.cityId].newestOf) {
    const L = ZONING_LAYERS[c.cityId]
    const r = await arcgis(L.url, { geometry: `${interior[0]},${interior[1]}`, geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', returnGeometry: 'false' }).catch(() => ({ features: [] }))
    zoning = { cityId: c.cityId, features: (r.features || []).map((f) => f.attributes) }
  }
  return { synthetic: false, recordedAt: new Date().toISOString().slice(0, 10), slug: c.slug, address: c.address, county: c.county, cityId: c.cityId, point: { lon: interior[0], lat: interior[1] }, census, addressPoints, parcels, nfhl, zoning }
}

fs.mkdirSync(OUT, { recursive: true })
for (const c of CASES) {
  const rec = LIVE ? await record(c).catch((e) => (console.error(`${c.slug}: ${e.message}; writing the synthetic fixture instead`), synthetic(c))) : synthetic(c)
  const text = JSON.stringify(rec, null, 1)
  if (/owner_name|file_as_name|owner_addr|ownerAddre/.test(text) && !new RegExp(`"(owner_name|file_as_name|owner_addr|ownerAddre|owner)": "${REDACT}"`).test(text) && /"(owner_name|owner_addr|ownerAddre|owner)": "(?!REDACTED)/.test(text)) throw new Error(`${c.slug}: an owner or mailing value survived redaction; not writing`)
  fs.writeFileSync(path.join(OUT, `${c.slug}.json`), text + '\n')
  console.log(`${rec.synthetic ? 'synthetic' : 'recorded '} ${c.slug}: ${rec.parcels.length} parcel(s), nfhl layers ${Object.keys(rec.nfhl).join('/')}, zoning ${rec.zoning ? 'yes' : 'none'}`)
}
