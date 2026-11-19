// The appraisal-district parcel layers per county (round 7, item 3), all live-tested on Nov 17, 2026. One entry
// per county: the ArcGIS layer, its field names as they came back, the address-point layer where one exists,
// the headers a source insists on, and notes. Owner and mailing fields are read and then kept drafter-only.
// The TxGIO StratMap layer is listed as disabled: its query operation answers "Requested operation is not
// supported". Regrid (app.regrid.com) is the dormant paid fallback, used only with REGRID_API_TOKEN set.
export const CHECKED_AT = '2026-11-19'

// the BIS appraisal-software schema shared by several CADs
const BIS_MAILING = ['addr_line1', 'addr_line2', 'addr_line3', 'addr_city', 'addr_state', 'zip']
const BIS_TYPES = { prop_id: 'integer' }
const BIS_FIELDS = { propId: 'prop_id', geoId: 'geo_id', owner: 'file_as_name', mailing: BIS_MAILING, situsParts: ['situs_num', 'situs_street_prefx', 'situs_street', 'situs_street_sufix', 'situs_city'], situsNum: 'situs_num', situsStreet: 'situs_street', legal: 'legal_desc', acres: 'legal_acreage' }

export const PARCEL_SOURCES = [
  {
    county: 'Hidalgo County',
    id: 'hidalgo-rgv911',
    name: 'Hidalgo County Appraisal District via RGV911',
    url: 'https://gis.rgv911.org/server/rest/services/RGV911_Web_Apps_MIL1/MapServer/7',
    kind: 'arcgis',
    // round 10, item 5: the layer has file_as_name and addr_line1..3, addr_city, addr_state, zip; there is no owner_name or owner_addr
    fields: { propId: 'prop_id', geoId: 'geo_id', owner: 'file_as_name', mailing: ['addr_line1', 'addr_line2', 'addr_line3', 'addr_city', 'addr_state', 'zip'], situs: 'situs', situsNum: null, situsStreet: null, legal: 'legal_desc', acres: null },
    // the layer's own field types (round 9, item 2): prop_id is esriFieldTypeInteger here, so a quoted value is a 400
    types: { prop_id: 'integer' },
    addressPoints: { url: 'https://gis.rgv911.org/server/rest/services/RGV911_Web_Apps_MIL1/MapServer/0', fields: { fulladdr: 'fulladdr', municipality: 'municipality', parcelId: 'parcel_id' }, parcelKey: 'prop_id' },
    headers: {},
    notes: 'situs is one string ("1201 KERRIA AVE, MCALLEN TX"); land_acres is empty, so acreage comes from the polygon; address points are layer 0 of the same service (fulladdr, municipality, parcel_id = prop_id)',
    checkedAt: CHECKED_AT,
  },
  {
    county: 'Willacy County',
    id: 'willacy-rgv911',
    name: 'Willacy County Appraisal District via RGV911',
    url: 'https://gis.rgv911.org/server/rest/services/SCC/Intrado_SCC_Basemap/MapServer/48',
    kind: 'arcgis',
    fields: { propId: 'prop_id', geoId: 'geo_id', owner: 'file_as_na', mailing: ['addr_line1', 'addr_line2', 'addr_line3', 'addr_city', 'addr_state', 'zip'], situs: null, situsNum: 'situs_num', situsStreet: 'situs_st_1', legal: 'legal_desc', acres: 'legal_acre' },
    types: { prop_id: 'integer' },
    // round 10: layer 0 of the SCC service is Texas_Railroads; Willacy's address points are in the same RGV911 layer as Hidalgo's
    addressPoints: { url: 'https://gis.rgv911.org/server/rest/services/RGV911_Web_Apps_MIL1/MapServer/0', fields: { fulladdr: 'fulladdr', municipality: 'municipality', parcelId: 'parcel_id' }, parcelKey: 'prop_id' },
    headers: {},
    notes: 'file_as_na, situs_num, situs_st_1, legal_desc; address points come from the RGV911 web-apps layer 0',
    checkedAt: CHECKED_AT,
  },
  {
    county: 'Cameron County',
    id: 'cameron-cobgis',
    name: 'Cameron County Appraisal District via the City of Brownsville GIS',
    url: 'https://cobgis.brownsvilletx.gov/arcgis/rest/services/Hosted/CameronCAD_Parcels_Sep2026/FeatureServer/0',
    fallbacks: ['https://cobgis.brownsvilletx.gov/arcgis/rest/services/Hosted/CameronCAD_Parcels_05312026/FeatureServer/0', 'https://services2.arcgis.com/6oaLMZEZlktbQpyi/arcgis/rest/services/CCAD_Parcels_View/FeatureServer/0'],
    geometryOnly: 'https://gissvr.cameroncad.org/arcgiswa/rest/services/Features/parcels/FeatureServer/0', // GEO_ID / PROP_ID only
    kind: 'arcgis',
    // round 10, item 5: the mailing address is addr1..3, addrcity, addrstate, addrzip; the third fallback spells its fields in another case (PROP_ID, situsDispl)
    fields: { propId: 'prop_id', geoId: 'geo_id', owner: 'owner', mailing: ['addr1', 'addr2', 'addr3', 'addrcity', 'addrstate', 'addrzip'], situs: 'situsdispl', situsNum: null, situsStreet: null, legal: 'legal1', acres: 'acres' },
    types: { prop_id: 'integer' },
    headers: { 'User-Agent': 'DraftHouse/1.0 (South Texas Builders office; parcel lookup)' }, // 403 without one
    notes: 'needs a User-Agent header or it answers 403; the hosted service name changes monthly, so the fallbacks are tried in order',
    checkedAt: CHECKED_AT,
  },
  { county: 'Nueces County', id: 'nueces-cad', name: 'Nueces County Appraisal District', url: 'https://services6.arcgis.com/j94FvPaik4etwHFk/ArcGIS/rest/services/NuecesCADWebService/FeatureServer/0', kind: 'arcgis', fields: { ...BIS_FIELDS }, types: { ...BIS_TYPES }, headers: {}, notes: 'BIS schema; its city column is a taxing-unit code (C03), not a city name, and there is no CITY_LIMITS column', checkedAt: CHECKED_AT },
  { county: 'Kleberg County', id: 'kleberg-cad', name: 'Kleberg County Appraisal District', url: 'https://services6.arcgis.com/j94FvPaik4etwHFk/arcgis/rest/services/KlebergCADWebService/FeatureServer/0', kind: 'arcgis', fields: { ...BIS_FIELDS }, types: { ...BIS_TYPES }, headers: {}, notes: 'BIS schema', checkedAt: CHECKED_AT },
  { county: 'San Patricio County', id: 'sanpatricio-cad', name: 'San Patricio County Appraisal District', url: 'https://services8.arcgis.com/EPyTHdGc5BhnbNty/arcgis/rest/services/SanPatricioCADWebService/FeatureServer/0', kind: 'arcgis', fields: { ...BIS_FIELDS }, types: { ...BIS_TYPES }, headers: {}, notes: 'BIS schema', checkedAt: CHECKED_AT },
  { county: 'Starr County', id: 'starr-cad', name: 'Starr County Appraisal District', url: 'https://services.arcgis.com/eeOR7tCg5imWJmGV/arcgis/rest/services/StarrCADWebService/FeatureServer/0', kind: 'arcgis', fields: { ...BIS_FIELDS }, types: { ...BIS_TYPES }, headers: {}, notes: 'BIS schema', checkedAt: CHECKED_AT },
  {
    county: 'Jim Wells County',
    id: 'jimwells-cad',
    name: 'Jim Wells County Appraisal District',
    url: 'https://services8.arcgis.com/36tOt5wOeEMz3tyS/arcgis/rest/services/JimWellsCADWebService/FeatureServer/0',
    kind: 'arcgis',
    fields: { propId: 'pid', geoId: 'geoID', owner: 'name', mailing: 'ownerAddre', situs: 'situsAddre', situsNum: null, situsStreet: null, legal: 'legalDescr', acres: 'legalAcrea' },
    headers: {},
    types: { pid: 'integer' },
    notes: 'a different schema: pid, geoID, name, ownerAddre, legalDescr, legalAcrea, situsAddre',
    checkedAt: CHECKED_AT,
  },
  {
    county: '*',
    id: 'txgio-stratmap',
    name: 'TxGIO StratMap land parcels',
    url: 'https://feature.geographic.texas.gov/arcgis/rest/services/Parcels/stratmap_land_parcels_48_most_recent/MapServer/0',
    kind: 'arcgis',
    disabled: 'its query operation answers "Requested operation is not supported" (Nov 17, 2026)',
    fields: {},
    headers: {},
    checkedAt: CHECKED_AT,
  },
  {
    county: '*',
    id: 'cad-postgis',
    name: 'Monthly CAD downloads in Supabase PostGIS (scripts/cad-import.mjs)',
    kind: 'postgis',
    table: 'cad_parcels',
    dormant: 'tried after the live sources, only when CAD_POSTGIS=1 and the table exists; not scheduled until Rolando agrees (item 12)',
    fields: {},
    headers: {},
    checkedAt: CHECKED_AT,
  },
  {
    county: '*',
    id: 'regrid',
    name: 'Regrid (paid; dormant)',
    url: 'https://app.regrid.com/api/v2/parcels',
    kind: 'regrid',
    dormant: 'runs only when REGRID_API_TOKEN is set; the office turns it on if the free sources fail more than 5% of lookups in a month or the daily check fails 3 days running (decisions.md C1)',
    fields: {},
    headers: {},
    checkedAt: CHECKED_AT,
  },
]

/**
 * The roads the front edge is read from (round 10, item 1): Census TIGERweb. Layer 8 is Local Roads, 6 is Secondary
 * Roads at the most detailed scale, 2 is Primary Roads. The front of a lot is the edge nearest the road that carries the address's
 * street name; the Census geocoder's point is interpolated along the street and often lands hundreds of feet away.
 */
export const ROAD_SOURCE = {
  id: 'tigerweb-roads',
  name: 'Census TIGERweb roads',
  county: '*',
  kind: 'roads',
  url: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Transportation/MapServer',
  layers: [8, 6],
  lastResort: [2],
  fields: { name: 'NAME', base: 'BASENAME', suffix: 'SUFTYPEABRV', mtfcc: 'MTFCC' },
  bufferM: 120,
  // a second named road counts as the lot's side street when it runs this close to an edge's midpoint: a local street's
  // centreline sits 15 to 34 ft from the lot line (measured on nine lots, Nov 19 2026), a secondary road's up to 55 ft
  cornerFt: { 8: 40, 6: 60, 2: 60 },
  checkedAt: CHECKED_AT,
}

/** The live source(s) for a county, in the order to try them (at most two are tried per lookup). */
export const sourcesFor = (county) => PARCEL_SOURCES.filter((s) => !s.disabled && !s.dormant && s.kind === 'arcgis' && s.county === county)
export const sourceById = (id) => PARCEL_SOURCES.find((s) => s.id === id) || null

// The acceptance set (and the daily health check's). Round 10, item 1: the nine lots whose front edge the architect
// measured against the named TIGERweb road on Nov 19, 2026 (frontFt is that edge, give or take a foot), then the Pharr
// address whose county address point names the neighbour.
export const TEST_ADDRESSES = [
  { address: '1201 Kerria Ave, McAllen, TX 78501', county: 'Hidalgo County', expect: { propId: '255056', geoId: 'P2500-00-004-0007-00', legal: /PALMS LOT 7 BLK 4/, edges: 4, areaSf: [10300, 10550], frontFt: [78.6, 80.8], frontStreet: /KERRIA/i, flood: 'no-digital-firm', zoning: 'R-1' } },
  { address: '36 Melissa Dr, Brownsville, TX 78526', county: 'Cameron County', expect: { propId: '144311', legal: /MCKENZIE ESTATES LOT 16 BLK 1/, edges: 4, areaSf: [8042, 8204], notThis: '1021 CLARISSA DR', frontFt: [62.4, 64.6], frontStreet: /MELISSA/i, flood: 'x', firm: '48061C', zoning: 'R-1' } },
  { address: '5435 Curtis Clark Dr, Corpus Christi, TX 78412', county: 'Nueces County', expect: { propId: '236866', legal: /GARDENDALE 2 SE\/2 OF LT 8 BK 5/, areaSf: [9384, 9574], notThis: '5402 BURTON', frontFt: [30.1, 32.2], frontStreet: /CURTIS CLARK/i, flood: 'x', firm: '48355C', zoning: 'SF-6' } },
  { address: '3305 N 27th St, McAllen, TX 78501', county: 'Hidalgo County', expect: { propId: '177413', frontFt: [64.1, 66.3], frontStreet: /27TH ST/i, flood: 'no-digital-firm', zoning: 'R-1' } },
  { address: '1534 Armagoza Dr, Edinburg, TX 78541', county: 'Hidalgo County', expect: { propId: '634314', frontFt: [66.3, 68.5], frontStreet: /ARMAGOZA/i, flood: 'no-digital-firm' } },
  { address: '3013 Yvonne St, Edinburg, TX 78542', county: 'Hidalgo County', expect: { propId: '121595', frontFt: [53.8, 56], frontStreet: /YVONNE/i, flood: 'no-digital-firm' } },
  { address: '2218 Royal Palm Dr, Mission, TX 78572', county: 'Hidalgo County', expect: { propId: '273291', frontFt: [79.1, 81.3], frontStreet: /ROYAL PALM/i, flood: 'no-digital-firm' } },
  { address: '2454 E 30th St, Brownsville, TX 78521', county: 'Cameron County', expect: { propId: '52374', frontFt: [49.1, 51.2], frontStreet: /30TH/i, flood: 'x', firm: '48061C' } },
  { address: '4175 Sierra Madre Dr, Brownsville, TX 78521', county: 'Cameron County', expect: { propId: '42520', frontFt: [48.9, 51.1], frontStreet: /SIERRA MADRE/i, flood: 'x', firm: '48061C' } },
  // round 9, item 5: the RGV911 address point carries the neighbour's parcel (259436, 118 W Park Ave); the situs check must refuse it
  { address: '118 S Cage Blvd, Pharr, TX 78577', county: 'Hidalgo County', expect: { propId: '259430', never: '259436', frontStreet: /CAGE/i, zoning: 'C-2' } },
]

/** A county from a route key: "Hidalgo County", "hidalgo", "hidalgo-county" and "Hidalgo%20County" all name the same one (round 9, item 8). */
export const COUNTY_NAMES = [...new Set(PARCEL_SOURCES.map((s) => s.county).filter((c) => c && c !== '*'))]
export function countyFromKey(key) {
  const k = String(key || '').toLowerCase().replace(/[^a-z]/g, '').replace(/county$/, '')
  return COUNTY_NAMES.find((c) => c.toLowerCase().replace(/[^a-z]/g, '').replace(/county$/, '') === k) || null
}
