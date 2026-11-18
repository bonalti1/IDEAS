// The city rules table, as the rest of the app reads it: flat numbers per jurisdiction, derived from the
// sourced table in jurisdictions.js (round 7, item 5). Everything that imported cities.js keeps working;
// new code reads jurisdictions.js for the sources, statuses and rule objects.
import { JURISDICTIONS, JURISDICTION_IDS, RULE_FIELDS as J_FIELDS, COUNTIES as J_COUNTIES, RGV as J_RGV, jurisdictionTable, resolveRules, geoMessage as jGeoMessage, countyRowId } from './jurisdictions.js'

export { COUNTIES, RGV } from './jurisdictions.js'
export const RULE_FIELDS = J_FIELDS

/** A jurisdiction row as a flat city row: numbers (rule objects resolved for a 100 × 150 lot), the district, verified. */
export function flatRow(row, dims = { width: 100, depth: 150 }) {
  const r = resolveRules(row, {}, dims)
  return {
    id: row.id,
    name: row.name,
    county: row.county,
    kind: row.kind,
    priority: row.priority,
    zoning: row.kind === 'county' ? 'County subdivision rules' : row.district?.value ? `${row.district.value} Single Family` : 'unknown',
    front: r.front,
    side: r.side,
    rear: r.rear,
    streetSide: r.streetSide,
    garageFt: r.garageFt,
    maxCoverage: r.maxCoverage ?? 0.5,
    coverageIncludesImpervious: r.coverageIncludesImpervious,
    maxHeightFt: r.maxHeightFt ?? 35,
    maxStories: r.maxStories,
    minLotSf: r.minLotSf,
    minLotWidth: r.minLotWidth,
    minHouseSf: r.minHouseSf,
    verified: row.verified !== undefined ? !!row.verified : J_FIELDS.slice(0, 4).every((k) => row[k]?.status === 'verified'),
    updatedAt: row.updatedAt || null,
    updatedBy: row.updatedBy || null,
    note: row.note || null,
    flags: r.flags,
    unknown: r.unknown,
    recheck: r.recheck,
    irc: r.irc,
    windstorm: r.windstorm,
    windText: r.windText,
    row,
  }
}

export const CITY_DEFAULTS = Object.fromEntries(JURISDICTION_IDS.map((id) => [id, flatRow(JURISDICTIONS[id])]))
export const CITY_IDS = JURISDICTION_IDS

/** What the lot step says about a geocoded address: our city rules, county defaults, or outside the eight counties. */
export const geoMessage = (geo, table = JURISDICTIONS) => jGeoMessage(geo, table && table.mcallen?.row ? Object.fromEntries(Object.values(table).map((c) => [c.id, c.row])) : table)

/** The city table with the office's edits applied (flat rows; each carries its sourced `row`). */
export function cityTable(overrides = {}) {
  const t = jurisdictionTable(overrides)
  const out = {}
  for (const id of JURISDICTION_IDS) out[id] = flatRow(t[id])
  return out
}

/**
 * One jurisdiction's rules for a lot, with any per-lot setback overrides on top and the rule objects resolved
 * against the lot's dimensions ({ width, depth, rowFt }). An unknown id falls back to the county's row ('hidalgo').
 */
export function rulesFor(cityId, overrides = {}, table = cityTable(), dims = {}) {
  const base = table[cityId] || table[countyRowId(overrides.county) || 'hidalgo'] || table.hidalgo
  const row = base.row || JURISDICTIONS[base.id] || JURISDICTIONS.hidalgo
  const r = resolveRules(row, overrides, dims)
  return { ...base, ...r, name: base.name, zoning: base.zoning, row }
}

/** Guess the city from free text such as an address. */
export function guessCity(text = '') {
  const t = String(text).toLowerCase()
  for (const id of CITY_IDS) if (CITY_DEFAULTS[id].kind === 'city' && t.includes(CITY_DEFAULTS[id].name.split(',')[0].toLowerCase())) return id
  return 'hidalgo'
}
