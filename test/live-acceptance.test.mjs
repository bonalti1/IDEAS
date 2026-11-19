// Round 9, item 9: the acceptance addresses against the LIVE county, FEMA and city services. Runs only with
// LIVE=1 (needs the internet; the fixtures cover CI). Owner and mailing values are never printed: the assertions
// only touch ids, legals, geometry, flood and zoning.
//
//   LIVE=1 node --test test/live-acceptance.test.mjs      (NODE_USE_ENV_PROXY=1 in front on a machine behind a proxy)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeParcels } from '../server/parcels.mjs'
import { makeLots, FEMA_DOWN } from '../server/lots.mjs'
import { makeZoning } from '../server/zoning.mjs'
import { TEST_ADDRESSES } from '../server/parcel-sources.mjs'

const skip = process.env.LIVE !== '1' && 'set LIVE=1 to run the acceptance addresses against the live services'
const memStore = () => {
  const m = new Map()
  return { meta: { get: async (k) => (m.has(k) ? m.get(k) : null), set: async (k, v) => m.set(k, v) } }
}
const CITY = { 'McAllen': 'mcallen', 'Brownsville': 'brownsville', 'Corpus Christi': 'corpuschristi', 'Pharr': 'pharr', 'Edinburg': 'edinburg', 'Mission': 'mission' }

test('live: the acceptance addresses resolve to the right parcel, front, flood zone and zoning', { skip, timeout: 600000 }, async (t) => {
  const store = memStore()
  const lots = makeLots({ store, files: {}, interpreter: {}, event: async () => {}, log: () => {} })
  const parcels = makeParcels({ store, geocode: (a) => lots.geocode(a), log: () => {}, event: async () => {} })
  const zoning = makeZoning({ store })
  const report = []
  let floodSkipped = 0
  for (const t of TEST_ADDRESSES) {
    const r = await parcels.lookup({ address: t.address, force: true })
    assert.equal(r.match, 'one', `${t.address}: ${r.match} ${r.reason || ''} ${JSON.stringify(r.tried || [])}`)
    if (t.expect.propId) assert.equal(r.propId, t.expect.propId, `${t.address}: prop id`)
    if (t.expect.never) assert.notEqual(r.propId, t.expect.never, `${t.address}: the neighbour's parcel`)
    if (t.expect.legal) assert.match(r.legal, t.expect.legal, `${t.address}: legal`)
    if (t.expect.areaSf) assert.ok(r.areaSf >= t.expect.areaSf[0] && r.areaSf <= t.expect.areaSf[1], `${t.address}: area ${r.areaSf}`)
    if (t.expect.frontFt) {
      const f = r.edges[r.frontEdge].lengthFt
      assert.ok(f >= t.expect.frontFt[0] && f <= t.expect.frontFt[1], `${t.address}: front edge ${f} ft (by ${r.frontBy})`)
      assert.equal(r.frontBy, 'named-road', `${t.address}: the front comes from the named road`)
    }
    if (t.expect.frontStreet) assert.match(r.frontStreet || '', t.expect.frontStreet, `${t.address}: front street`)
    // round 11: the whole street side (a curved frontage is several chords) within a foot of the recorded width
    if (t.expect.frontWidthFt != null) assert.ok(Math.abs(r.frontWidthFt - t.expect.frontWidthFt) <= 1, `${t.address}: street side ${r.frontWidthFt} ft, recorded ${t.expect.frontWidthFt}`)
    if (t.expect.frontChords) {
      assert.equal(r.frontChords, t.expect.frontChords, `${t.address}: front chords (${r.edgeKinds.join(',')})`)
      assert.ok(r.frontWidthFt >= 45, `${t.address}: front ${r.frontWidthFt} ft`)
    }
    if (t.expect.corner != null) assert.equal(!!r.corner, t.expect.corner, `${t.address}: corner`)
    if (t.expect.confidence) assert.equal(r.confidence, t.expect.confidence, `${t.address}: matched ${r.matchedBy}/${r.confidence}`)
    // drafter-only fields are present on the raw record (never printed here): the mapped columns exist on the layer
    assert.ok(r.owner, `${t.address}: the owner column is mapped`)
    assert.ok(r.mailing, `${t.address}: the mailing columns are mapped`)
    if (t.expect.notThis) assert.ok(!r.situs.startsWith(t.expect.notThis), `${t.address}: ${r.situs}`)
    assert.ok(r.closure <= 0.5, `${t.address}: closure ${r.closure}`)
    // round 11, item 4: FEMA has bad minutes (ECONNRESET, connect timeouts, 504s). The product answers 502 with a
    // plain line and caches nothing, which is right; here that is a skipped flood check with a note, not a failure
    let flood = { status: 'skipped', firm: null }
    try {
      flood = await lots.floodAt({ lat: r.interior.lat, lon: r.interior.lon })
      if (t.expect.flood) assert.equal(flood.status, t.expect.flood, `${t.address}: flood ${flood.status} (${flood.note})`)
      if (t.expect.firm) assert.equal(flood.firm, t.expect.firm, `${t.address}: FIRM`)
    } catch (e) {
      if (e.message !== FEMA_DOWN) throw e
      floodSkipped++
    }
    const place = (r.census?.place || '').trim()
    const cityId = CITY[place] || null
    const z = cityId ? await zoning.lookup({ cityId, lat: r.interior.lat, lon: r.interior.lon }) : { district: null }
    if (t.expect.zoning) assert.equal(z.district, t.expect.zoning, `${t.address}: zoning ${JSON.stringify(z)}`)
    report.push(`${t.address}: ${r.propId} ${r.legal} ${r.areaSf} sf, front ${r.frontWidthFt} ft${r.frontChords > 1 ? ` in ${r.frontChords} pieces` : ''} on ${r.frontStreet}${r.corner ? ' (corner: ' + r.streets.filter((x) => x.role === 'side').map((x) => x.name).join(', ') + ')' : ''}, flood ${flood.status}${flood.firm ? ' ' + flood.firm : ''}, zoning ${z.district || 'n/a'}, matched by ${r.matchedBy}${r.confidence === 'near' ? ' (near: listed as ' + r.listedAs + ')' : ''}`)
  }
  console.log(report.join('\n'))
  if (floodSkipped) t.diagnostic(`FEMA did not answer for ${floodSkipped} of ${TEST_ADDRESSES.length} addresses: the flood check was skipped for those (a FEMA outage, not a failure here)`)
})

test('live: a commercial McAllen lot and downtown Brownsville are not house districts; Mission has no layer', { skip, timeout: 120000 }, async () => {
  const store = memStore()
  const lots = makeLots({ store, files: {}, interpreter: {}, event: async () => {} })
  const parcels = makeParcels({ store, geocode: (a) => lots.geocode(a), log: () => {}, event: async () => {} })
  const zoning = makeZoning({ store })
  for (const [address, cityId, district] of [
    ['2200 S 10th St, McAllen, TX 78503', 'mcallen', 'C-2'],
    ['1001 E Elizabeth St, Brownsville, TX 78520', 'brownsville', 'DC'],
  ]) {
    const r = await parcels.lookup({ address, force: true })
    assert.equal(r.match, 'one', `${address}: ${r.match}`)
    const z = await zoning.lookup({ cityId, lat: r.interior.lat, lon: r.interior.lon })
    assert.equal(z.district, district, `${address}: ${JSON.stringify(z)}`)
    assert.equal(z.residential, false)
    assert.match(z.message, /the office will call you/)
  }
  const m = await zoning.lookup({ cityId: 'mission', lat: 26.2159, lon: -98.3253 })
  assert.equal(m.status, 'unknown')
  assert.match(m.reason, /no zoning layer/)
})
