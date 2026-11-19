// Zoning lookup (round 7, item 5): the city's zoning layer queried at the parcel's interior point (the street
// point returns nothing in McAllen), normalised to the district code our rules table knows, with the raw
// attributes kept for the drafter. Mission, San Benito and Rio Grande City have no layer: 'unknown'.
const fail = (status, error) => Object.assign(new Error(error), { status })
const now = () => new Date().toISOString()

export const ZONING_LAYERS = {
  mcallen: { url: 'https://gismap.mcallen.net/arcgis/rest/services/DevelopmentZoning/MapServer/4', field: 'ZONE' },
  edinburg: { url: 'https://services7.arcgis.com/z3I4HxFCWafiHSiG/arcgis/rest/services/COE_ZONING_DISTRICTS/FeatureServer/0', field: 'CODE', nameField: 'DISTRICT' },
  pharr: { url: 'https://services.arcgis.com/Uj8MycSVzMEzm7ey/arcgis/rest/services/Pharr_Published/FeatureServer/37', field: 'ZONE', overlaps: true, newest: 'last_edited_date' },
  weslaco: { url: 'https://services7.arcgis.com/9yzEIJbAp0HzkDjg/arcgis/rest/services/WESLACO_ZONING_DISTRICTS/FeatureServer/106', field: 'CODE' },
  harlingen: { url: 'https://services3.arcgis.com/gSCPzHZGMdbiljnH/arcgis/rest/services', newestOf: /^COH_Zoning_Map_/, field: 'Zone' },
  brownsville: { url: 'https://services2.arcgis.com/6oaLMZEZlktbQpyi/arcgis/rest/services/Zoning_District_Boundaries_view/FeatureServer/0', field: 'ZoningFNI' },
  corpuschristi: { url: 'https://ccpublicgis.cctexas.com/arcgis/rest/services/CC_GENERAL_SERVICES/MapServer/4', field: 'TAG2023' },
}
export const NO_LAYER = ['mission', 'sanbenito', 'riograndecity']
// Weslaco's new UDO renames the old districts (UDO Ch. 2 conversion table)
export const WESLACO_CONVERSION = { 'R-1': 'R-1', 'R-4': 'R-1-N', 'R-3': 'R-1-RCH', 'R-2': 'R-2' }
// single-family districts per city (what the rules table has numbers for)
const RESIDENTIAL = {
  mcallen: ['R-1', 'R-1A', 'R-1T'],
  edinburg: ['RP', 'R-1', 'R-1A'],
  pharr: ['R-1', 'R-1A'],
  weslaco: ['R-1', 'R-1-N', 'R-1-RCH'],
  harlingen: ['R-1', 'R-1A', 'SF'],
  brownsville: ['R-1', 'R-1A'],
  corpuschristi: ['RS-6', 'SF-6', 'RS-4.5', 'RS-10', 'RS-15', 'RS-22'],
}
const USE_WORDS = { C: 'commercial', B: 'business', I: 'industrial', M: 'industrial', DC: 'downtown core', MU: 'mixed use', O: 'office', A: 'agricultural', AG: 'agricultural', PUD: 'planned development', RM: 'multifamily' }

/** 'r1', 'R1/CC', 'R-1 ' and friends → 'R-1'; Weslaco's old codes → the UDO names. */
export function normalizeDistrict(cityId, raw) {
  let s = String(raw || '').trim().toUpperCase().split('/')[0].trim()
  if (!s) return null
  // r1 → R-1, rs6 → RS-6, sf6 → SF-6, r1a → R-1A
  s = s.replace(/^([A-Z]{1,2})-?(\d+(?:\.\d+)?)([A-Z]*)$/, (m, a, n, t) => `${a}-${n}${t}`)
  if (cityId === 'weslaco' && WESLACO_CONVERSION[s]) s = WESLACO_CONVERSION[s]
  return s
}
/** Is the district one we draft against; if not, what kind of use is it? */
export function classify(cityId, district) {
  if (!district) return { residential: null, use: 'unknown' }
  if ((RESIDENTIAL[cityId] || []).includes(district)) return { residential: true, use: 'single-family' }
  if (/^(R|RS|SF|RP)-?\d/.test(district)) return { residential: true, use: 'residential (not the single-family row we have rules for)' }
  const letters = district.replace(/[^A-Z]/g, '')
  return { residential: false, use: USE_WORDS[letters] || USE_WORDS[letters[0]] || 'not residential' }
}
/** The plain words for a lot we cannot draft against R-1 rules. */
export const nonResidentialMessage = (district, use) => `This lot is zoned ${district} (${use}). A house may need a rezoning; the office will call you.`

export function makeZoning({ store, fetchImpl = globalThis.fetch, log = console.log }) {
  async function query(layer, url, lat, lon) {
    const q = new URLSearchParams({ geometry: `${lon},${lat}`, geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: '*', returnGeometry: 'false', f: 'json' })
    const res = await fetchImpl(`${url}/query?${q}`, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) throw fail(502, `the zoning layer answered ${res.status}`)
    const body = await res.json()
    if (body.error) throw fail(502, `the zoning layer: ${body.error.message || 'query error'}`)
    return (body.features || []).map((f) => f.attributes || f.properties || {})
  }
  async function newestHarlingenLayer(base) {
    const res = await fetchImpl(`${base}?f=json`, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) throw fail(502, `the Harlingen service list answered ${res.status}`)
    const body = await res.json()
    const names = (body.services || []).map((s) => s.name.split('/').pop()).filter((n) => /^COH_Zoning_Map_/.test(n)).sort()
    if (!names.length) throw fail(502, 'no Harlingen zoning layer found')
    return `${base}/${names[names.length - 1]}/FeatureServer/0`
  }
  return {
    layers: ZONING_LAYERS,
    /**
     * The district at a point for a city: { status: 'found'|'unknown'|'none', district, raw, residential, use, message,
     * layer, features (all of them, newest first for Pharr) }. Cached 30 days per city and point.
     */
    async lookup({ cityId, lat, lon }) {
      if (!cityId) return { status: 'unknown', district: null, reason: 'no city', at: now() }
      if (NO_LAYER.includes(cityId) || !ZONING_LAYERS[cityId]) return { status: 'unknown', district: null, reason: `${cityId} publishes no zoning layer; the drafter reads the zoning map`, at: now() }
      if (lat == null || lon == null) return { status: 'unknown', district: null, reason: 'no point', at: now() }
      const key = `zoning:${cityId}:${(+lat).toFixed(5)},${(+lon).toFixed(5)}`
      const cached = await store.meta.get(key)
      if (cached && Date.now() - Date.parse(cached.at) < 30 * 86400000) return cached
      const L = ZONING_LAYERS[cityId]
      const url = L.newestOf ? await newestHarlingenLayer(L.url) : L.url
      let feats = await query(L, url, lat, lon)
      if (L.overlaps && L.newest) feats = feats.slice().sort((a, b) => (b[L.newest] || 0) - (a[L.newest] || 0))
      const f = feats[0]
      const rawDistrict = f ? f[L.field] : null
      const district = normalizeDistrict(cityId, rawDistrict)
      const { residential, use } = classify(cityId, district)
      const rec = {
        status: f ? 'found' : 'none',
        cityId,
        district,
        rawDistrict: rawDistrict ?? null,
        name: L.nameField && f ? f[L.nameField] : null,
        residential,
        use,
        message: f && residential === false ? nonResidentialMessage(district, use) : null,
        overlapping: L.overlaps ? feats.map((x) => ({ district: normalizeDistrict(cityId, x[L.field]), edited: x[L.newest] || null })) : null,
        layer: url,
        field: L.field,
        raw: f || null,
        at: now(),
      }
      await store.meta.set(key, rec)
      return rec
    },
  }
}
