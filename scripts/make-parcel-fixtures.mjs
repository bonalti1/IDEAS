// Writes test/fixtures/parcels/*.json, the recorded answers the parcel, flood and zoning tests and the
// DRAFTHOUSE_FIXTURES=1 server replay (server/fixtures.mjs).
//
//   LIVE=1 node scripts/make-parcel-fixtures.mjs     records from the live services (Census, the county
//                                                    ArcGIS layers, FEMA NFHL, the city zoning layers) and
//                                                    keeps only the mapped fields (ids, legal, situs, acres, city
//                                                    limits), never an owner or mailing field, and refuses to write otherwise
//   node scripts/make-parcel-fixtures.mjs            builds the same files from the research numbers in
//                                                    docs/FIX-ROUND-7.md (synthetic: true), for a machine
//                                                    that cannot reach the services (this sandbox blocks them)
//
// Owner names and mailing addresses never reach the repo: a recording keeps only the allow-listed fields (round 9, item 7).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PARCEL_SOURCES, sourcesFor } from '../server/parcel-sources.mjs'
import { ZONING_LAYERS } from '../server/zoning.mjs'
import { interiorLonLat, parseAddress, whereClause, normalizeSitus } from '../server/parcels.mjs'
import { FORBIDDEN_KEY, assertNoPersonKeys } from '../server/fixtures.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(__dirname, '..', 'test', 'fixtures', 'parcels')
const EARTH_FT = 20902231
const LIVE = process.env.LIVE === '1'
const REDACT = 'REDACTED' // kept for the synthetic cases' comments; recorded files carry no person fields at all (allow-list below)

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
    // 80 ft on Kerria Ave (south) by 130.35 ft deep: 10,428 sf; prop_id is an integer on this layer
    shape: { origin: [-98.2212, 26.2091], pts: [[0, 0], [80, 0], [80, 130.35], [0, 130.35]] },
    census: { street: 'KERRIA', suffix: 'AVE', zip: '78501', offsetFt: [40, -25] },
    parcel: { prop_id: 255056, geo_id: 'P2500-00-004-0007-00', legal_desc: 'PALMS LOT 7 BLK 4', situs: '1201 KERRIA AVE, MCALLEN TX' },
    addressPoint: { fulladdr: '1201 KERRIA AVE', municipality: 'MCALLEN' },
    // Hidalgo County has no digital FIRM: every NFHL layer is empty here (live, Nov 19, 2026)
    nfhl: { 0: [], 1: [], 3: [], 28: [], 34: [] },
    zoning: { ZONE: 'R-1' },
    decoys: [{ shape: { origin: [-98.2212, 26.2091], pts: [[81, 0], [161, 0], [161, 130.35], [81, 130.35]] }, parcel: { prop_id: 255057, geo_id: 'P2500-00-004-0008-00', legal_desc: 'PALMS LOT 8 BLK 4', situs: '1205 KERRIA AVE, MCALLEN TX' }, addressPoint: { fulladdr: '1205 KERRIA AVE', municipality: 'MCALLEN' } }],
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
    parcel: { prop_id: '144311', geo_id: '72-0114-0160-0010-00', legal1: 'MCKENZIE ESTATES LOT 16 BLK 1', situsdispl: '36 MELISSA DR', acres: 0.1865 },
    // live: zone X on panel 48061C0590F, no LOMR, no LOMA (Nov 19, 2026)
    nfhl: { 0: [{ STUDY_ID: '48061C' }], 1: [], 3: [{ DFIRM_ID: '48061C', PANEL: '0590', FIRM_PAN: '48061C0590F', PANEL_TYP: 'Countywide, Panel Printed', EFF_DATE: 1518739200000, SCALE: '12000' }], 28: [{ DFIRM_ID: '48061C', FLD_ZONE: 'X', ZONE_SUBTY: 'AREA OF MINIMAL FLOOD HAZARD', SFHA_TF: 'F', STATIC_BFE: -9999 }], 34: [] },
    zoning: { ZoningFNI: 'R-1' },
    decoys: [
      // 1021 Clarissa Dr: across the street, a smaller lot whose centre is nearer the Census point than Melissa's own
      { shape: { origin: [-97.4612, 25.9701], pts: [[5, -32], [65, -32], [65, -97], [5, -97]] }, parcel: { prop_id: '144290', geo_id: '72-0114-0150-0020-00', legal1: 'MCKENZIE ESTATES LOT 2 BLK 2', situsdispl: '1021 CLARISSA DR', acres: 0.0895 } },
    ],
  },
  {
    slug: 'curtis-clark-5435-corpus-christi',
    address: '5435 Curtis Clark Dr, Corpus Christi, TX 78412',
    county: 'Nueces County',
    cityId: 'corpuschristi',
    place: 'Corpus Christi',
    // the live lot is a 31 x 300 ft sliver whose 31 ft end is on Curtis Clark Dr (south): 9,479 sf, with a 0.6 ft
    // sliver edge at the far corner that the cleaner removes
    shape: { origin: [-97.3651, 27.7108], pts: [[0, 0], [31.6, 0], [31.6, 300], [0.6, 300], [0, 300]] },
    census: { street: 'CURTIS CLARK', suffix: 'DR', zip: '78412', offsetFt: [15.8, -24] },
    parcel: { prop_id: '236866', geo_id: '2905-0005-0085', legal_desc: 'GARDENDALE 2 SE/2 OF LT 8 BK 5', situs_num: '5435', situs_street_prefx: null, situs_street: 'CURTIS CLARK', situs_street_sufix: 'DR', situs_city: 'CORPUS CHRISTI', legal_acreage: 0.2176, CITY_LIMITS: 'CORPUS CHRISTI' },
    // live: zone X on panel 48355C0510G (Nov 19, 2026)
    nfhl: { 0: [{ STUDY_ID: '48355C' }], 1: [], 3: [{ DFIRM_ID: '48355C', PANEL: '0510', FIRM_PAN: '48355C0510G', PANEL_TYP: 'Countywide, Panel Printed', EFF_DATE: 1665619200000, SCALE: '12000' }], 28: [{ DFIRM_ID: '48355C', FLD_ZONE: 'X', ZONE_SUBTY: 'AREA OF MINIMAL FLOOD HAZARD', SFHA_TF: 'F', STATIC_BFE: -9999 }], 34: [] },
    zoning: { TAG2023: 'SF-6' },
    decoys: [{ shape: { origin: [-97.3651, 27.7108], pts: [[32.5, 0], [64, 0], [64, 300], [32.5, 300]] }, parcel: { prop_id: '236867', geo_id: '2905-0005-0086', legal_desc: 'GARDENDALE 2 NW/2 OF LT 8 BK 5', situs_num: '5402', situs_street_prefx: null, situs_street: 'BURTON', situs_street_sufix: 'LN', situs_city: 'CORPUS CHRISTI', legal_acreage: 0.2175, CITY_LIMITS: 'CORPUS CHRISTI' } }],
  },
  {
    // round 9, item 5: the RGV911 address point for 118 S Cage Blvd carries parcel 259436, which is 118 W Park Ave
    // (the neighbour); the real lot is 259430. Zoned C-2 (Pharr's layer overlaps: an older R-1 polygon under it).
    slug: 'cage-118-pharr',
    address: '118 S Cage Blvd, Pharr, TX 78577',
    county: 'Hidalgo County',
    cityId: 'pharr',
    place: 'Pharr',
    shape: { origin: [-98.1838, 26.1942], pts: [[0, 0], [50, 0], [50, 140], [0, 140]] },
    census: { street: 'CAGE', suffix: 'BLVD', preDirection: 'S', zip: '78577', offsetFt: [25, -30] },
    parcel: { prop_id: 259430, geo_id: 'P5000-00-043-0001-00', legal_desc: 'PHARR ORIGINAL TOWNSITE LOT 1 & 2 BLK 43', situs: '118 S CAGE BLVD, PHARR TX' },
    addressPoint: { fulladdr: '118 S CAGE BLVD', municipality: 'PHARR', parcelIdOverride: 259436 },
    nfhl: { 0: [], 1: [], 3: [], 28: [], 34: [] },
    zoning: [{ ZONE: 'C-2', last_edited_date: 1700000000000 }, { ZONE: 'R-1', last_edited_date: 1500000000000 }],
    decoys: [{ shape: { origin: [-98.1838, 26.1942], pts: [[0, 141], [50, 141], [50, 281], [0, 281]] }, parcel: { prop_id: 259436, geo_id: 'P5000-00-043-0008-00', legal_desc: 'PHARR ORIGINAL TOWNSITE LOT 8 & 9 BLK 43', situs: '118 W PARK AVE, PHARR TX' } }],
  },
  {
    // a rural Starr County tract with no digital FIRM and no recorded subdivision (items 4 and 8 of round 7)
    slug: 'ranch-rd-rio-grande-city',
    address: '4400 Ranch Rd, Rio Grande City, TX 78582',
    county: 'Starr County',
    cityId: null,
    place: null,
    shape: { origin: [-98.8402, 26.4302], pts: [[0, 0], [300, 0], [300, 726], [0, 726]] },
    census: { street: 'RANCH', suffix: 'RD', zip: '78582', offsetFt: [150, -30] },
    parcel: { prop_id: '34110', geo_id: '0400-0000-0091', legal_desc: 'ABST 91 SHARE 22 PORCION 76 5.00 AC', situs_num: '4400', situs_street_prefx: null, situs_street: 'RANCH', situs_street_sufix: 'RD', situs_city: 'RIO GRANDE CITY', legal_acreage: 5.0 },
    nfhl: { 0: [], 1: [], 3: [], 28: [], 34: [] },
    zoning: null,
    decoys: [],
  },
  {
    // a commercial McAllen lot (La Plaza side of S 10th): zoned C-2, Send blocked (round 9 acceptance)
    slug: 's-10th-2200-mcallen',
    address: '2200 S 10th St, McAllen, TX 78503',
    county: 'Hidalgo County',
    cityId: 'mcallen',
    place: 'McAllen',
    shape: { origin: [-98.2303, 26.1842], pts: [[0, 0], [100, 0], [100, 150], [0, 150]] },
    census: { street: '10TH', suffix: 'ST', preDirection: 'S', zip: '78503', offsetFt: [50, -30] },
    parcel: { prop_id: 201314, geo_id: 'M1800-00-001-0001-00', legal_desc: 'MCALLEN ORIGINAL TOWNSITE LOT 1 BLK 18', situs: '2200 S 10TH ST, MCALLEN TX' },
    addressPoint: { fulladdr: '2200 S 10TH ST', municipality: 'MCALLEN' },
    nfhl: { 0: [], 1: [], 3: [], 28: [], 34: [] },
    zoning: { ZONE: 'C-2' },
    decoys: [],
  },
  {
    // downtown Brownsville, zoned DC: blocked; a LOMR and a LOMA on file here (synthetic, to exercise those readers)
    slug: 'e-elizabeth-1001-brownsville',
    address: '1001 E Elizabeth St, Brownsville, TX 78520',
    county: 'Cameron County',
    cityId: 'brownsville',
    place: 'Brownsville',
    shape: { origin: [-97.4961, 25.9012], pts: [[0, 0], [60, 0], [60, 120], [0, 120]] },
    census: { street: 'ELIZABETH', suffix: 'ST', preDirection: 'E', zip: '78520', offsetFt: [30, -25] },
    parcel: { prop_id: '100210', geo_id: '03-0100-0010-0010-00', legal1: 'BROWNSVILLE ORIGINAL TOWNSITE LOT 1 BLK 10', situsdispl: '1001 E ELIZABETH ST', acres: 0.165 },
    nfhl: { 0: [{ STUDY_ID: '48061C' }], 1: [{ DFIRM_ID: '48061C', LOMR_ID: '48061C_LOMR_1', CASE_NO: '24-06-1234P', EFF_DATE: 1735689600000, STATUS: 'Effective' }], 3: [{ DFIRM_ID: '48061C', PANEL: '0585', FIRM_PAN: '48061C0585F', PANEL_TYP: 'Countywide, Panel Printed', EFF_DATE: 1518739200000, SCALE: '12000' }], 28: [{ DFIRM_ID: '48061C', FLD_ZONE: 'AE', ZONE_SUBTY: null, SFHA_TF: 'T', STATIC_BFE: 20 }], 34: [{ CASENUMBER: '23-06-0456A', STATUS: 'Determination Issued', DETERMINATIONTYPE: 'LOMA', DATEENDED: 1690000000000 }] },
    zoning: { ZoningFNI: 'DC' },
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
  const addressPoints = [c, ...c.decoys].filter((x) => x.addressPoint).map((x) => { const { parcelIdOverride, ...ap } = x.addressPoint; return { ...ap, parcel_id: String(parcelIdOverride ?? x.parcel.prop_id) } })
  return {
    synthetic: true,
    builtFrom: 'the live lookups in the round-7 brief and the round-9 review (ids, legals, edges, areas, the flood panels FEMA answered on Nov 19, 2026) with stand-in coordinates; the county parcel and city zoning services are not reachable from the build machine. Re-record with LIVE=1 node scripts/make-parcel-fixtures.mjs.',
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
    zoning: c.zoning && c.cityId ? { cityId: c.cityId, features: Array.isArray(c.zoning) ? c.zoning : [c.zoning] } : null,
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
  // round 9, item 7: an allow-list, not a pattern. Only the fields parcel-sources.mjs maps (ids, legal, situs, acres,
  // city limits) are kept; the owner and mailing fields (owner_name, owner_addr, addr_line1..3, addr_city, zip,
  // addr1..3, addrcity, addrzip, file_as_name, name, ownerAddre and whatever else a layer carries) never reach the file.
  const keep = new Set([F.propId, F.geoId, F.legal, F.acres, F.situs, F.situsNum, F.situsStreet, ...(F.situsParts || []), src.cityLimits].filter(Boolean))
  const redact = (props) => {
    const out = Object.fromEntries(Object.entries(props || {}).filter(([k]) => keep.has(k)))
    for (const k of Object.keys(out)) if (FORBIDDEN_KEY.test(k)) throw new Error(`the allow-list kept a forbidden key: ${k}`)
    return out
  }
  let addressPoints = []
  if (src.addressPoints) {
    const apf = src.addressPoints.fields
    const ap = await arcgis(src.addressPoints.url, { where: whereClause([[apf.fulladdr, 'LIKE', `${parsed.number} %${parsed.street}%`]], src.addressPoints.types || {}), returnGeometry: 'false', f: 'geojson' }, src.headers)
    addressPoints = (ap.features || []).map((f) => Object.fromEntries(Object.entries(f.properties || {}).filter(([k]) => [apf.fulladdr, apf.municipality, apf.parcelId].includes(k))))
  }
  const near = await arcgis(src.url, { geometry: `${census.coordinates.x},${census.coordinates.y}`, geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', distance: '60', units: 'esriSRUnit_Meter', f: 'geojson' }, src.headers)
  const parcels = (near.features || []).map((f) => ({ type: 'Feature', properties: redact(f.properties), geometry: f.geometry }))
  const mine = parcels.find((p) => normalizeSitus(F.situs ? p.properties[F.situs] : [p.properties[F.situsNum], p.properties[F.situsStreet]].join(' ')).startsWith(parsed.number + ' ')) || parcels[0]
  const interior = interiorLonLat(mine.geometry.coordinates[0])
  const nfhl = {}
  for (const layer of [0, 1, 3, 28, 34]) {
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
  assertNoPersonKeys(rec)
  const text = JSON.stringify(rec, null, 1)
  fs.writeFileSync(path.join(OUT, `${c.slug}.json`), text + '\n')
  console.log(`${rec.synthetic ? 'synthetic' : 'recorded '} ${c.slug}: ${rec.parcels.length} parcel(s), nfhl layers ${Object.keys(rec.nfhl).join('/')}, zoning ${rec.zoning ? 'yes' : 'none'}`)
}
