// Round 15, the house: the lots the house tests draft on, and the first draft the app makes on each.
// The recorded parcels (no network), the 100 x 150 lot a homeowner types, and a 50 ft lot.
import { buildLot } from '../src/draft/lib/lot.js'
import { TEST_ADDRESSES } from '../server/parcel-sources.mjs'
import { makeParcels } from '../server/parcels.mjs'
import { makeLots } from '../server/lots.mjs'
import { fixtureFetch, loadFixtures } from '../server/fixtures.mjs'
import { parcelSpec } from '../src/draft/lib/parcel-spec.js'
import { starterDraft, DEFAULT_PROGRAM, isRoom } from '../src/draft/lib/layout.js'
import { fitsLot, startFrom } from '../src/draft/lib/fit.js'
import { STYLES } from '../src/draft/lib/styles.js'

export const style = STYLES.find((s) => s.id === 'farmhouse')
const CITY = { McAllen: 'mcallen', Brownsville: 'brownsville', 'Corpus Christi': 'corpuschristi', Pharr: 'pharr', Edinburg: 'edinburg', Mission: 'mission' }

let recorded = null
/** The recorded lots by their street line ("1201 Kerria Ave", ...). */
export async function recordedLots() {
  if (recorded) return recorded
  const FIX = loadFixtures()
  const m = new Map()
  const store = { meta: { get: async (k) => (m.has(k) ? m.get(k) : null), set: async (k, v) => m.set(k, v) } }
  const fetchImpl = fixtureFetch(FIX)
  const lots = makeLots({ store, fetchImpl, files: {}, interpreter: {}, event: async () => {}, log: () => {}, env: {} })
  const parcels = makeParcels({ store, fetchImpl, geocode: (x) => lots.geocode(x), log: () => {}, env: {}, event: async () => {} })
  recorded = {}
  for (const t of TEST_ADDRESSES) {
    const k = await parcels.lookup({ address: t.address })
    recorded[t.address.split(',')[0]] = buildLot(parcelSpec(k, { address: t.address, city: CITY[(k.census?.place || '').trim()] || '', county: t.county }))
  }
  return recorded
}
export const typedLot = (width, depth) => buildLot({ kind: 'manual', width, depth, city: 'mcallen', setbacks: {} })

/**
 * The first draft a homeowner sees on a lot with the rooms nobody has changed: the fit's answer for the default (the
 * Rooms step replaces a default that does not fit with the fit's own offer), drafted the way the app drafts it.
 */
export function firstDraft(lot, program = DEFAULT_PROGRAM) {
  const check = fitsLot(program, style, lot)
  const used = startFrom(check, program) || program
  const onLot = Number.isFinite(check.turn) ? buildLot({ ...lot.spec, turn: check.turn }) : lot
  const draft = starterDraft(used, style, onLot)
  return { check, program: used, lot: onLot, draft, rooms: draft.rooms, plan: draft.rooms.find((r) => r.kind === 'roof')?.plan }
}

/** Width (along the street) and depth of the enclosed house, porches left out, feet. */
export function footprint(rooms) {
  const solid = rooms.filter((r) => isRoom(r) && !r.open)
  const w = Math.max(...solid.map((r) => r.x + r.w)) - Math.min(...solid.map((r) => r.x))
  const d = Math.max(...solid.map((r) => r.y + r.d)) - Math.min(...solid.map((r) => r.y))
  return { w, d, ratio: d / w }
}
