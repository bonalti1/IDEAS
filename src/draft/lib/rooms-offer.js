// What the rooms step offers on a lot (round 15, U5, U10, U16): the recent build, only where it fits, and the
// "tight lot" card, only where our ready plans really are tight. Both are read from the fit check of the lot
// (lib/fit.js, run in the rooms step's worker), never from the rooms the homeowner happens to have on screen.
import { DEFAULT_PROGRAM } from './layout.js'
import { insideRect } from './lot.js'

const sameish = (a, b) => ['beds', 'baths', 'halfBath', 'suite2', 'office', 'garage', 'stories', 'sqft', 'frontPorch', 'rearPorch'].every((k) => (a?.[k] ?? false) === (b?.[k] ?? false))

/**
 * Can the recent build's house sit on this lot at all? Its footprint (72 by 53 ft for the Rio Grande City house)
 * against the largest rectangle inside the space the city lets you build on, either way round. Instant: no draft.
 */
export function buildCouldFit(ref, lot) {
  if (!ref?.footprint) return true
  let room
  try {
    room = insideRect(lot)
  } catch {
    return false
  }
  if (!room || !(room.w > 0) || !(room.d > 0)) return false
  const { w, d } = ref.footprint
  return (w <= room.w + 0.5 && d <= room.d + 0.5) || (d <= room.w + 0.5 && w <= room.d + 0.5)
}

/**
 * The recent build as the rooms step offers it on this lot, from the fit check of its rooms: the rooms themselves
 * when they fit; the same house less one extra when that is what fits (it keeps its bedrooms and at least 80% of its
 * size: "without the second suite"); otherwise nothing. `{ program, without }` or null.
 */
export function recentBuildOffer(ref, check) {
  if (!ref || !check || check.checking) return null
  if (check.ok) return { program: { ...ref.program }, without: null }
  const s = check.suggestion
  if (!s?.program) return null
  const p = s.program
  const keeps = p.beds === ref.program.beds && p.baths === ref.program.baths && (p.sqft || 0) >= 0.8 * ref.program.sqft && (p.garage || 0) >= (ref.program.garage || 0)
  if (!keeps || /starter|plan holds|plan draws/.test(s.label || '')) return null
  return { program: { ...p }, without: s.label }
}

/**
 * Is this lot tight for our ready plans? Read from the fit check of the default rooms on it: the house had to be
 * turned to sit on the lot, or what fits is a smaller kind of house (fewer bedrooms, no garage, or a quarter
 * smaller). A lot where the default fits, or fits as the narrow plan with its bedrooms and garage, is not tight
 * (Kerria, 10,405 sf: the 4 bed, 2 bath, 2-car narrow plan fits). A lot where nothing fits has its own card.
 */
export function lotIsTight(defaultCheck, base = DEFAULT_PROGRAM) {
  if (!defaultCheck || defaultCheck.checking || defaultCheck.deadEnd) return false
  if (defaultCheck.turn) return true
  if (defaultCheck.ok) return false
  const fitted = defaultCheck.maxSqft ? { ...base, sqft: defaultCheck.maxSqft } : defaultCheck.suggestion?.program
  if (!fitted) return false
  return (fitted.beds || 0) < (base.beds || 0) || ((base.garage || 0) > 0 && !(fitted.garage > 0)) || (fitted.sqft || 0) < 0.75 * (base.sqft || 0)
}

/** The same rooms, field by field (what the recent-build card compares to say "this is what you will get"). */
export const sameRooms = sameish
