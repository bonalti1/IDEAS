// Round 15, the chat: the two lots the review tried the chat on, built from the recordings (no network), with the
// first draft the app draws on each: Kiskadee (a tight pie lot: the starter the rooms step offers, turned to sit in
// the widest part) and Kerria (a roomy lot: the default rooms, or the largest that fits).
import { buildLot } from '../src/draft/lib/lot.js'
import { starterDraft, DEFAULT_PROGRAM, floorArea } from '../src/draft/lib/layout.js'
import { fitsLot, clearFitCache, startFrom } from '../src/draft/lib/fit.js'
import { makeParcels } from '../server/parcels.mjs'
import { makeLots } from '../server/lots.mjs'
import { fixtureFetch, loadFixtures } from '../server/fixtures.mjs'
import { parcelSpec } from '../src/draft/lib/parcel-spec.js'
import { STYLES } from '../src/draft/lib/styles.js'

export const style = STYLES.find((s) => s.ready) || STYLES[0]
export const KISKADEE = '2002 Kiskadee Ln, Mission, TX 78572'
export const KERRIA = '1201 Kerria Ave, McAllen, TX 78501'

async function lotAt(address, city) {
  const m = new Map()
  const store = { meta: { get: async (k) => (m.has(k) ? m.get(k) : null), set: async (k, v) => m.set(k, v) } }
  const fetchImpl = fixtureFetch(loadFixtures())
  const lots = makeLots({ store, fetchImpl, files: {}, interpreter: {}, event: async () => {}, log: () => {}, env: {} })
  const parcels = makeParcels({ store, fetchImpl, geocode: (x) => lots.geocode(x), log: () => {}, env: {}, event: async () => {} })
  const parcel = await parcels.lookup({ address })
  return buildLot(parcelSpec(parcel, { address, city, county: 'Hidalgo County' }))
}

/** The plan the app draws first on a lot: the default rooms, or what the rooms step starts the homeowner with. */
export function firstPlan(lot0, program0 = DEFAULT_PROGRAM) {
  clearFitCache()
  let program = program0
  let check = fitsLot(program, style, lot0)
  if (!check.ok) {
    program = startFrom(check, program) || program
    check = fitsLot(program, style, lot0)
  }
  const lot = Number.isFinite(check.turn) && check.turn ? buildLot({ ...lot0.spec, turn: check.turn }) : lot0
  const d = starterDraft(program, style, lot)
  return { program, rooms: d.rooms, lot, sf: floorArea(d.rooms, program.stories || 1) }
}

let cache = null
/** { kiskadee, kerria }: each { program, rooms, lot, sf }. */
export async function plans() {
  if (cache) return cache
  const kis = await lotAt(KISKADEE, 'mission')
  const ker = await lotAt(KERRIA, 'mcallen')
  cache = { kiskadee: firstPlan(kis), kerria: firstPlan(ker) }
  return cache
}
