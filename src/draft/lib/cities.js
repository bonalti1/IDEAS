// City rules for single-family lots in the Rio Grande Valley: setbacks (feet), lot coverage,
// building height. These are the office's working defaults and are editable on the Office
// dashboard; the table saved there wins over this file. Every row starts unverified: confirm
// each against the city's current zoning ordinance (R-1 or equivalent) before relying on it.
export const CITY_DEFAULTS = {
  mission: { name: 'Mission, TX', county: 'Hidalgo County', zoning: 'R-1 Single Family', front: 25, side: 6, rear: 10, streetSide: 15, maxCoverage: 0.5, maxHeightFt: 35, minLotSf: 6000, verified: false },
  mcallen: { name: 'McAllen, TX', county: 'Hidalgo County', zoning: 'R-1 Single Family', front: 25, side: 6, rear: 10, streetSide: 15, maxCoverage: 0.5, maxHeightFt: 35, minLotSf: 6000, verified: false },
  edinburg: { name: 'Edinburg, TX', county: 'Hidalgo County', zoning: 'R-1 Single Family', front: 25, side: 5, rear: 10, streetSide: 15, maxCoverage: 0.5, maxHeightFt: 35, minLotSf: 6000, verified: false },
  pharr: { name: 'Pharr, TX', county: 'Hidalgo County', zoning: 'R-1 Single Family', front: 25, side: 5, rear: 10, streetSide: 15, maxCoverage: 0.5, maxHeightFt: 35, minLotSf: 6000, verified: false },
  palmview: { name: 'Palmview, TX', county: 'Hidalgo County', zoning: 'R-1 Single Family', front: 25, side: 6, rear: 10, streetSide: 20, maxCoverage: 0.5, maxHeightFt: 35, minLotSf: 6000, verified: false },
  weslaco: { name: 'Weslaco, TX', county: 'Hidalgo County', zoning: 'R-1 Single Family', front: 25, side: 5, rear: 10, streetSide: 15, maxCoverage: 0.5, maxHeightFt: 35, minLotSf: 6000, verified: false },
  hidalgo: { name: 'Hidalgo County (unincorporated)', county: 'Hidalgo County', zoning: 'County subdivision rules', front: 25, side: 5, rear: 10, streetSide: 15, maxCoverage: 0.5, maxHeightFt: 35, minLotSf: 6000, verified: false },
}
export const CITY_IDS = Object.keys(CITY_DEFAULTS)
/** The counties we price in (src/draft/lib/pricing.js has the rates); the first four are the Rio Grande Valley. */
export const COUNTIES = ['Hidalgo County', 'Cameron County', 'Starr County', 'Willacy County', 'Jim Wells County', 'Nueces County', 'Kleberg County', 'San Patricio County']
export const RGV = COUNTIES.slice(0, 4)

/** What the lot step says about a geocoded address: our city rules, county defaults, or outside the Valley. */
export function geoMessage(geo, table = CITY_DEFAULTS) {
  if (!geo) return ''
  if (!geo.found) return geo.note || 'The address was not found. Check it, or type the lot in.'
  if (geo.cityId && table[geo.cityId]) return `We have the ${table[geo.cityId].name} rules.`
  const county = geo.county || ''
  if (RGV.includes(county)) return `We don't have rules for this address yet. ${county} is in the Valley, so the county defaults are used and a drafter checks the city's setbacks.`
  if (COUNTIES.includes(county)) return `We don't have rules for this address yet. ${county} is outside the Rio Grande Valley; we price it, and a drafter checks the setbacks before anything is drawn.`
  return `We don't have rules for this address yet. ${geo.place ? `${geo.place}${geo.state ? ', ' + geo.state : ''}` : 'It'} is outside the Rio Grande Valley, where we build. You can still draft to see a plan; pick a county below for a price.`
}
export const RULE_FIELDS = ['front', 'side', 'rear', 'streetSide', 'maxCoverage', 'maxHeightFt', 'minLotSf']

/** The city table with the office's edits applied. */
export function cityTable(overrides = {}) {
  const out = {}
  for (const id of CITY_IDS) out[id] = { id, ...CITY_DEFAULTS[id], ...(overrides[id] || {}) }
  return out
}

/** One city's rules, with any per-lot setback overrides on top. */
export function rulesFor(cityId, overrides = {}, table = cityTable()) {
  const base = table[cityId] || table.hidalgo
  const r = { ...base }
  for (const k of ['front', 'side', 'rear', 'streetSide']) if (overrides[k] !== undefined && overrides[k] !== null && overrides[k] !== '') r[k] = +overrides[k]
  return r
}

/** Guess the city from free text such as an address. */
export function guessCity(text = '') {
  const t = String(text).toLowerCase()
  for (const id of CITY_IDS) if (id !== 'hidalgo' && t.includes(CITY_DEFAULTS[id].name.split(',')[0].toLowerCase())) return id
  return 'hidalgo'
}
