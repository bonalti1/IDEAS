// The office estimate, from South Texas Builders' published rates. One config, one function. Since round 8
// (P0b) nothing here reaches a homeowner: the drafter's Review screen, the office dashboard and the
// internal "Meeting prep" sheet are its only readers. Values marked CONFIRM ship as defaults the office
// can edit; the sources are in docs (draft-house-decisions.md, A1–A6).
import { CITY_DEFAULTS as CITIES } from './cities.js'
import { floorArea, isRoom, kitFor, programOf } from './layout.js'
import { flatwork } from './takeoff.js'

export const RATES = {
  confirmed: false, // flips when Rolando signs off; the office screens say "estimate" until then
  source: 'south-texasbuilders.com/custom-home-cost (2026), single story, 9 ft plate, 30-yr shingle, construction only',
  note: 'Construction only. Land, septic, utilities and windstorm are quoted separately.',
  // $/sf of living (conditioned) area, low and high: STB's published rates by county (A1, verified)
  counties: {
    'Hidalgo County': [115, 120],
    'Starr County': [115, 120],
    'Cameron County': [120, 130],
    'Willacy County': [120, 130],
    'Jim Wells County': [130, 145],
    'Nueces County': [130, 145],
    'Kleberg County': [130, 145],
    'San Patricio County': [130, 145],
  },
  // STB lists Hidalgo, Starr, Cameron and Jim Wells plus "Alice & the Coastal Bend"; elsewhere the office confirms the rate
  usualCounties: ['Hidalgo County', 'Starr County', 'Cameron County', 'Jim Wells County'],
  defaultCounty: 'Hidalgo County',
  // no multiplier by style (A2): a style's look is priced as the upgrade adders its kit draws
  styles: { farmhouse: 1, ranch: 1, hillcountry: 1, spanish: 1, modern: 1, craftsman: 1, transitional: 1, tuscan: 1, midcentury: 1, coastal: 1 },
  // STB's published upgrade adders, $/sf of living area (A2, verified): south-texasbuilders.com/whats-included
  upgrades: { brick: 2, rPanelRoof: 5, standingSeamRoof: 9, plate10: [3, 5], hebel: 5, metalWall: 5 },
  upgradeNames: { brick: 'Brick exterior', rPanelRoof: 'R-panel metal roof', standingSeamRoof: 'Standing-seam metal roof', plate10: '10 ft plate height', hebel: 'Hebel (AAC) walls', metalWall: 'Metal wall panels' },
  upgradesSource: 'south-texasbuilders.com/whats-included',
  // the adders each style's kit draws (assumption, CONFIRM): modern a standing-seam roof; Spanish and hill country brick
  styleUpgrades: { modern: ['standingSeamRoof'], spanish: ['brick'], hillcountry: ['brick'] },
  // $/sf of garage and porch floor, low and high (A3, CONFIRM: set both to [0, 0] if STB's rate already includes them)
  garagePerSf: [45, 55],
  porchPerSf: [35, 45],
  // $/sf of driveway and walk beyond what STB includes: 4" slab, broom finish (A4; McAllen, 365buildersllc.com, CONFIRM)
  flatworkPerSf: [6, 10],
  // the driveway STB includes by garage size, sf (A4): 0/1/2-car verified from What's Included; 3-car an assumption, CONFIRM; tandem counts as 3
  drivewayAllowanceSf: { 0: 0, 1: 400, 2: 600, 3: 800 },
  // the coastal counties where TDI windstorm inspections and the WPI-8 certificate apply (A6, verified)
  windstormCounties: ['Cameron County', 'Willacy County', 'Nueces County', 'Kleberg County', 'San Patricio County'],
  windstormLine: 'Windstorm inspections and TDI certificate (WPI-8): quoted separately. Free with a TDI field inspector; an appointed engineer’s fee if one inspects.',
  // full baths STB includes by living area (A5, verified): 2 at 1,500–1,800 sf, 3 at 1,800–2,500 sf (and above, CONFIRM), plus one tub/shower combination
  bathsIncluded: (livingSf) => (livingSf <= 1800 ? 2 : 3),
  tubsIncluded: 1,
}

/** The county a lot is in, from its city preset; the default county when the lot has none. */
export function countyOf(lot) {
  return CITIES[lot?.city]?.county || (RATES.counties[lot?.spec?.county] ? lot.spec.county : null)
}

/** The upgrade adders a style's kit draws, by id. */
export const styleUpgrades = (style) => [...(RATES.styleUpgrades[style?.id] || [])]
const perSfOf = (id) => {
  const v = RATES.upgrades[id]
  return Array.isArray(v) ? v : [v, v]
}
const money = (n) => '$' + Math.round(n).toLocaleString()

/**
 * The office estimate for a plan: { low, high, mid, perSf: [lo, hi], county, areas: {living, garage, porches,
 * flatwork}, parts: { living, garage, porches, flatwork, upgrades } (each [lo, hi]), upgrades: [{ id, label, perSf,
 * amount, on }], lines: [{ id, label, text, amount }] (the $0 notes: windstorm, extra baths, two-story, service
 * area), flatwork: { total, allowance, beyond, label }, note, confirmed }.
 * With rooms the areas come from the plan; with a program alone (the rooms step) from the program and the kit.
 * `upgrades` overrides the style's adders (an office toggle); [] switches them all off.
 */
export function estimate({ rooms, program, style, lot, county: countyOverride, upgrades: upgradeIds = null }) {
  const kit = kitFor(style)
  program = program || {}
  // no county, no price: the lot step asks for one (the default county's rates size the parts for the math only)
  const county = countyOverride || countyOf(lot)
  const rate = RATES.counties[county] || RATES.counties[RATES.defaultCounty]
  const perSf = rate.map((r) => Math.round(r * (RATES.styles[style?.id] ?? 1)))
  let living
  let garage
  let porches
  let flat
  let cars
  let tandem = false
  let fullBaths
  let tubs = 0
  if (rooms && rooms.length) {
    living = floorArea(rooms, program.stories || 1)
    const list = rooms.filter(isRoom)
    garage = list.filter((r) => r.kind === 'garage').reduce((a, r) => a + r.w * r.d, 0)
    porches = list.filter((r) => r.open).reduce((a, r) => a + r.w * r.d, 0)
    flat = flatwork(rooms, kit, lot).total
    const drawn = programOf(rooms, program)
    cars = drawn.garage || 0
    tandem = !!drawn.tandem
    fullBaths = drawn.baths || 0
    tubs = rooms.filter((e) => e.kind === 'fixture' && e.fixture === 'tub').length
  } else {
    living = program.sqft || 0
    const g = kit?.rooms?.garage
    cars = program.garage || 0
    tandem = !!program.tandem
    garage = cars && g ? cars * (g.perCar || 11) * (g.d || 22) : 0
    const fp = kit?.rooms?.frontPorch
    const rp = kit?.rooms?.rearPorch
    porches = (fp ? fp.w * fp.d : 0) + (program.rearPorch !== false && rp ? rp.w * rp.d : 0)
    flat = (cars ? 30 * (g?.perCar || 11) * cars : 0) + 4 * 25
    fullBaths = program.baths || 0
  }
  // the driveway and walk: only what is beyond STB's included allowance is priced (A4)
  const allowance = RATES.drivewayAllowanceSf[Math.min(3, tandem ? 3 : cars)] ?? 0
  const beyond = Math.max(0, Math.round(flat) - allowance)
  const flatworkInfo = {
    total: Math.round(flat),
    allowance,
    beyond,
    label: beyond > 0 ? `Driveway and walk beyond the included ${allowance.toLocaleString()} sf: ${beyond.toLocaleString()} sf × $${RATES.flatworkPerSf[0]}–${RATES.flatworkPerSf[1]}` : `Driveway included (up to ${allowance.toLocaleString()} sf)`,
  }
  // the upgrade adders: the style's by default, or the office's choice
  const ids = Array.isArray(upgradeIds) ? upgradeIds.filter((id) => RATES.upgrades[id] !== undefined) : styleUpgrades(style)
  const upgrades = ids.map((id) => ({ id, label: RATES.upgradeNames[id] || id, perSf: perSfOf(id), amount: perSfOf(id).map((r) => living * r), on: true }))
  const parts = {
    living: perSf.map((r) => living * r),
    garage: RATES.garagePerSf.map((r) => garage * r),
    porches: RATES.porchPerSf.map((r) => porches * r),
    flatwork: RATES.flatworkPerSf.map((r) => beyond * r),
    upgrades: [0, 1].map((i) => upgrades.reduce((a, u) => a + u.amount[i], 0)),
  }
  const low = parts.living[0] + parts.garage[0] + parts.porches[0] + parts.flatwork[0] + parts.upgrades[0]
  const high = parts.living[1] + parts.garage[1] + parts.porches[1] + parts.flatwork[1] + parts.upgrades[1]
  // the $0 notes beside the range: nothing is added to the total
  const lines = []
  if (county && !RATES.usualCounties.includes(county)) lines.push({ id: 'service-area', label: county, text: 'outside our usual service area; the office confirms the rate', amount: null })
  if ((program.stories || 1) >= 2) lines.push({ id: 'two-story', label: 'Two-story', text: 'two-story: office quote', amount: null })
  if (county && RATES.windstormCounties.includes(county)) lines.push({ id: 'windstorm', label: 'Windstorm', text: RATES.windstormLine, amount: null })
  const extraBaths = Math.max(0, (fullBaths || 0) - RATES.bathsIncluded(living))
  if (extraBaths > 0) lines.push({ id: 'extra-baths', label: 'Baths', text: `${extraBaths} extra full bath${extraBaths === 1 ? '' : 's'}: quoted by the office`, amount: null })
  const extraTubs = Math.max(0, tubs - RATES.tubsIncluded)
  if (extraTubs > 0) lines.push({ id: 'extra-tubs', label: 'Tubs', text: `${extraTubs} extra tub${extraTubs === 1 ? '' : 's'}: quoted by the office`, amount: null })
  return {
    low,
    high,
    mid: (low + high) / 2,
    perSf,
    county,
    serviceArea: !county || RATES.usualCounties.includes(county),
    needsCounty: !county,
    fromRooms: !!(rooms && rooms.length),
    areas: { living, garage, porches, flatwork: Math.round(flat) },
    parts,
    upgrades,
    lines,
    flatwork: flatworkInfo,
    cars,
    tandem,
    note: RATES.note,
    source: RATES.source,
    confirmed: RATES.confirmed,
  }
}

const k = (n) => '$' + Math.round(n / 1000).toLocaleString() + 'k'
/** "$231k–$241k", or what is missing for one */
export const range = (e) => (e.needsCounty ? 'pick the county on the lot step' : k(e.low) + '–' + k(e.high))
/** "$115–120/sf living · garage $45–55/sf · porches $35–45/sf · driveway and walk beyond the allowance $6–10/sf" */
export const rateLine = (e) => '$' + e.perSf[0] + '–' + e.perSf[1] + '/sf living · garage $' + RATES.garagePerSf[0] + '–' + RATES.garagePerSf[1] + '/sf · porches $' + RATES.porchPerSf[0] + '–' + RATES.porchPerSf[1] + '/sf · driveway and walk beyond the allowance $' + RATES.flatworkPerSf[0] + '–' + RATES.flatworkPerSf[1] + '/sf'
/** The upgrade and note lines as the office reads them: "Standing-seam metal roof: $18,000–$18,000", "Windstorm: …". */
export const estimateLines = (e) => [
  ...(e.upgrades || []).map((u) => ({ id: u.id, label: u.label, text: `$${u.perSf[0]}${u.perSf[1] !== u.perSf[0] ? `–${u.perSf[1]}` : ''}/sf: ${money(u.amount[0])}${u.amount[1] !== u.amount[0] ? `–${money(u.amount[1])}` : ''}`, amount: u.amount })),
  ...(e.flatwork ? [{ id: 'flatwork', label: 'Driveway and walk', text: e.flatwork.label + (e.flatwork.beyond > 0 ? `: ${money(e.parts.flatwork[0])}–${money(e.parts.flatwork[1])}` : ' at $0'), amount: e.parts.flatwork }] : []),
  ...(e.lines || []),
]
