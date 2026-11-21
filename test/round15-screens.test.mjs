// Fix round 15, the homeowner screens, as code (no browser): what the rooms step offers on a lot, the recent
// build's new name, and the screens' words. The browser tests are test/round15-screens-*.test.mjs.
//   U5, U10, U16  the recent build only where it fits; "tight lot" only where our ready plans are tight
//   office 1      "Recent build, Rio Grande City" everywhere a homeowner can see it, in both languages
// The lots are read from the recordings; nothing reaches the internet.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { buildLot, turnLot } from '../src/draft/lib/lot.js'
import { parcelSpec } from '../src/draft/lib/parcel-spec.js'
import { DEFAULT_PROGRAM, lotOf, kitFor } from '../src/draft/lib/layout.js'
import { fitsLot } from '../src/draft/lib/fit.js'
import { STYLES } from '../src/draft/lib/styles.js'
import { es } from '../src/draft/lib/i18n.js'
import { makeParcels } from '../server/parcels.mjs'
import { makeLots } from '../server/lots.mjs'
import { fixtureFetch, loadFixtures } from '../server/fixtures.mjs'
import { HOMEOWNER_FILES } from './i18n-scan.mjs'
import './server-env.mjs'

const style = STYLES.find((s) => s.ready)
const ref = kitFor(style).reference
async function lotAt(address) {
  const m = new Map()
  const store = { meta: { get: async (k) => (m.has(k) ? m.get(k) : null), set: async (k, v) => m.set(k, v) } }
  const fetchImpl = fixtureFetch(loadFixtures())
  const lots = makeLots({ store, fetchImpl, files: {}, interpreter: {}, event: async () => {}, log: () => {}, env: {} })
  const parcels = makeParcels({ store, fetchImpl, geocode: (x) => lots.geocode(x), log: () => {}, env: {}, event: async () => {} })
  const g = await lots.geocode(address)
  const p = await parcels.lookup({ address })
  return turnLot(lotOf(buildLot(parcelSpec(p, { address, city: g.cityId, county: g.county }))), 0)
}

test('U5, U16 (unit): Kiskadee is tight and its lot cannot take the recent build; Kerria is not tight and is offered the recent build, fitted', async () => {
  const { buildCouldFit, recentBuildOffer, lotIsTight } = await import('../src/draft/lib/rooms-offer.js')
  const kiskadee = await lotAt('2002 Kiskadee Ln, Mission, TX 78572')
  const kerria = await lotAt('1201 Kerria Ave, McAllen, TX 78501')
  // the recent build's 72 by 53 ft house does not fit Kiskadee's 37 by 43 ft at all: no draft is even drawn
  assert.equal(buildCouldFit(ref, kiskadee), false)
  assert.equal(buildCouldFit(ref, kerria), true)
  // on Kerria its rooms are offered as they fit: the same 3 bed, 3.5 bath house without the second suite
  const offer = recentBuildOffer(ref, fitsLot({ ...ref.program }, style, kerria))
  assert.ok(offer, 'Kerria is offered the recent build')
  assert.equal(offer.program.beds, ref.program.beds)
  assert.equal(offer.program.baths, ref.program.baths)
  assert.equal(offer.without, 'without the second suite')
  assert.ok(fitsLot(offer.program, style, kerria).ok, 'what the card sets fits the lot')
  // a starter is not the recent build: never offered as it
  assert.equal(recentBuildOffer(ref, { ok: false, suggestion: { label: 'as a 3 bed, 2 bath starter with no garage', program: { ...ref.program, beds: 3, baths: 2, sqft: 1400 } } }), null)
  // tight: our default rooms had to be turned or cut to a starter on Kiskadee; on Kerria the narrow plan holds them
  assert.equal(lotIsTight(fitsLot(DEFAULT_PROGRAM, style, kiskadee)), true)
  assert.equal(lotIsTight(fitsLot(DEFAULT_PROGRAM, style, kerria)), false)
  assert.equal(lotIsTight({ ok: true, reasons: [] }), false)
  assert.equal(lotIsTight({ ok: false, deadEnd: true }), false, 'a lot nothing fits has its own card')
})

test('office decision 1 (unit): the recent build is "Recent build, Rio Grande City" ("Casa reciente, Rio Grande City"); no homeowner screen or dictionary line carries the old name', () => {
  assert.equal(ref.name, 'Recent build, Rio Grande City')
  assert.equal(es['Recent build, Rio Grande City'], 'Casa reciente, Rio Grande City')
  for (const [k, v] of Object.entries(es)) assert.doesNotMatch(`${k} ${v}`, /Garza/, k)
  for (const f of [...HOMEOWNER_FILES, 'src/draft/lib/styles.js', 'src/draft/lib/status.js', 'src/draft/lib/trust.js']) {
    const shown = fs.readFileSync(f, 'utf8').replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '') // what a comment says is not shown
    assert.doesNotMatch(shown, /Garza/, `${f} shows the old name`)
  }
})
