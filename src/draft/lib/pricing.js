// The price range, from South Texas Builders' own rates. One config, one function, used by the rooms
// step, the draft screen and the Send screen so all three show the same number.
//
// CONFIRM: Rolando confirms every number in RATES before launch. The living-area rates come from
// south-texasbuilders.com (construction only); the garage and porch rates and the style multipliers
// are placeholders until he does.
import { CITY_DEFAULTS as CITIES } from './cities.js'
import { floorArea, isRoom, kitFor } from './layout.js'

export const RATES = {
  confirmed: false, // flips when Rolando signs off; the screens say "estimate" until then
  source: 'south-texasbuilders.com, construction only',
  note: 'Construction only. Land, septic, utilities and windstorm are quoted separately.',
  // $/sf of living (conditioned) area, low and high
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
  defaultCounty: 'Hidalgo County',
  // multipliers on the living-area rate by style (CONFIRM)
  styles: { farmhouse: 1, ranch: 0.96, hillcountry: 1.06, spanish: 1.08, modern: 1.12 },
  // $/sf of garage and porch floor, low and high (CONFIRM)
  garagePerSf: [45, 55],
  porchPerSf: [35, 45],
}

/** The county a lot is in, from its city preset; the default county when the lot has none. */
export function countyOf(lot) {
  return CITIES[lot?.city]?.county || RATES.defaultCounty
}

/**
 * The estimate for a plan: { low, high, mid, perSf: [lo, hi], county, areas: {living, garage, porches},
 * parts: { living: [lo, hi], garage: [lo, hi], porches: [lo, hi] }, note, confirmed }.
 * With rooms the areas come from the plan; with a program alone (the rooms step) from the program
 * and the kit's templates.
 */
export function estimate({ rooms, program, style, lot, county: countyOverride }) {
  const kit = kitFor(style)
  const county = countyOverride || countyOf(lot)
  const rate = RATES.counties[county] || RATES.counties[RATES.defaultCounty]
  const mult = RATES.styles[style?.id] ?? 1
  const perSf = rate.map((r) => Math.round(r * mult))
  let living
  let garage
  let porches
  if (rooms && rooms.length) {
    living = floorArea(rooms, program.stories || 1)
    const list = rooms.filter(isRoom)
    garage = list.filter((r) => r.kind === 'garage').reduce((a, r) => a + r.w * r.d, 0)
    porches = list.filter((r) => r.open).reduce((a, r) => a + r.w * r.d, 0)
  } else {
    living = program.sqft || 0
    const g = kit?.rooms?.garage
    garage = program.garage && g ? program.garage * (g.perCar || 11) * (g.d || 22) : 0
    const fp = kit?.rooms?.frontPorch
    const rp = kit?.rooms?.rearPorch
    porches = (fp ? fp.w * fp.d : 0) + (program.rearPorch !== false && rp ? rp.w * rp.d : 0)
  }
  const parts = {
    living: perSf.map((r) => living * r),
    garage: RATES.garagePerSf.map((r) => garage * r),
    porches: RATES.porchPerSf.map((r) => porches * r),
  }
  const low = parts.living[0] + parts.garage[0] + parts.porches[0]
  const high = parts.living[1] + parts.garage[1] + parts.porches[1]
  return { low, high, mid: (low + high) / 2, perSf, county, areas: { living, garage, porches }, parts, note: RATES.note, confirmed: RATES.confirmed }
}

const k = (n) => '$' + Math.round(n / 1000).toLocaleString() + 'k'
/** "$231k–$241k" */
export const range = (e) => k(e.low) + '–' + k(e.high)
/** "$115–120/sf living · garage $45–55/sf · porches $35–45/sf" */
export const rateLine = (e) => '$' + e.perSf[0] + '–' + e.perSf[1] + '/sf living · garage $' + RATES.garagePerSf[0] + '–' + RATES.garagePerSf[1] + '/sf · porches $' + RATES.porchPerSf[0] + '–' + RATES.porchPerSf[1] + '/sf'
