// The price range, from South Texas Builders' own rates. One config, one function, used by the rooms
// step, the draft screen and the Send screen so all three show the same number.
//
// CONFIRM: Rolando confirms every number in RATES before launch. The living-area rates come from
// south-texasbuilders.com (construction only); the garage and porch rates and the style multipliers
// are placeholders until he does.
import { CITY_DEFAULTS as CITIES } from './cities.js'
import { floorArea, isRoom, kitFor } from './layout.js'
import { flatwork } from './takeoff.js'

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
  // $/sf of driveway and walk, 4" slab with a broom finish (CONFIRM)
  flatworkPerSf: [6, 9],
}

/** The county a lot is in, from its city preset; the default county when the lot has none. */
export function countyOf(lot) {
  return CITIES[lot?.city]?.county || (RATES.counties[lot?.spec?.county] ? lot.spec.county : null)
}

/**
 * The estimate for a plan: { low, high, mid, perSf: [lo, hi], county, areas: {living, garage, porches, flatwork},
 * parts: { living: [lo, hi], garage: [lo, hi], porches: [lo, hi], flatwork: [lo, hi] }, note, confirmed }.
 * The flatwork is the driveway and the front walk the site plan draws (with rooms); with a program alone, a
 * 30 ft drive the garage's width and a 4 ft walk.
 * With rooms the areas come from the plan; with a program alone (the rooms step) from the program
 * and the kit's templates.
 */
export function estimate({ rooms, program, style, lot, county: countyOverride }) {
  const kit = kitFor(style)
  // no county, no price: the lot step asks for one (the default county's rates size the parts for the math only)
  const county = countyOverride || countyOf(lot)
  const rate = RATES.counties[county] || RATES.counties[RATES.defaultCounty]
  const mult = RATES.styles[style?.id] ?? 1
  const perSf = rate.map((r) => Math.round(r * mult))
  let living
  let garage
  let porches
  let flat
  if (rooms && rooms.length) {
    living = floorArea(rooms, program.stories || 1)
    const list = rooms.filter(isRoom)
    garage = list.filter((r) => r.kind === 'garage').reduce((a, r) => a + r.w * r.d, 0)
    porches = list.filter((r) => r.open).reduce((a, r) => a + r.w * r.d, 0)
    flat = flatwork(rooms, kit, lot).total
  } else {
    living = program.sqft || 0
    const g = kit?.rooms?.garage
    garage = program.garage && g ? program.garage * (g.perCar || 11) * (g.d || 22) : 0
    const fp = kit?.rooms?.frontPorch
    const rp = kit?.rooms?.rearPorch
    porches = (fp ? fp.w * fp.d : 0) + (program.rearPorch !== false && rp ? rp.w * rp.d : 0)
    flat = (program.garage ? 30 * (g?.perCar || 11) * program.garage : 0) + 4 * 25
  }
  const parts = {
    living: perSf.map((r) => living * r),
    garage: RATES.garagePerSf.map((r) => garage * r),
    porches: RATES.porchPerSf.map((r) => porches * r),
    flatwork: RATES.flatworkPerSf.map((r) => flat * r),
  }
  const low = parts.living[0] + parts.garage[0] + parts.porches[0] + parts.flatwork[0]
  const high = parts.living[1] + parts.garage[1] + parts.porches[1] + parts.flatwork[1]
  return { low, high, mid: (low + high) / 2, perSf, county, needsCounty: !county, fromRooms: !!(rooms && rooms.length), areas: { living, garage, porches, flatwork: flat }, parts, note: RATES.note, confirmed: RATES.confirmed }
}

const k = (n) => '$' + Math.round(n / 1000).toLocaleString() + 'k'
/** "$231k–$241k", or what is missing for one */
export const range = (e) => (e.needsCounty ? 'pick the county on the lot step' : k(e.low) + '–' + k(e.high))
/** "$115–120/sf living · garage $45–55/sf · porches $35–45/sf" */
export const rateLine = (e) => '$' + e.perSf[0] + '–' + e.perSf[1] + '/sf living · garage $' + RATES.garagePerSf[0] + '–' + RATES.garagePerSf[1] + '/sf · porches $' + RATES.porchPerSf[0] + '–' + RATES.porchPerSf[1] + '/sf · driveway and walk $' + RATES.flatworkPerSf[0] + '–' + RATES.flatworkPerSf[1] + '/sf'
