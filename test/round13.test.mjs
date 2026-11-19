// Fix round 13 (the customer test addendum), the parts that are not screens.
//   6  an address typed in one run or with a small slip ("3305 N 27 street mcallen") is the same address: no
//      "is that right?" question for a spelling, and one parcel, not a list of six
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeParcels, parseAddress, streetCore } from '../server/parcels.mjs'
import { makeLots, addressMismatch } from '../server/lots.mjs'
import { fixtureFetch, loadFixtures } from '../server/fixtures.mjs'

function sources() {
  const m = new Map()
  const store = { meta: { get: async (k) => (m.has(k) ? m.get(k) : null), set: async (k, v) => m.set(k, v) } }
  const fetchImpl = fixtureFetch(loadFixtures())
  const lots = makeLots({ store, fetchImpl, files: {}, interpreter: {}, event: async () => {}, log: () => {}, env: {} })
  const parcels = makeParcels({ store, fetchImpl, geocode: (x) => lots.geocode(x), log: () => {}, env: {}, event: async () => {} })
  return { lots, parcels }
}

test('6: an address typed in one run, a bare street number and a spelled-out suffix read as the same address', () => {
  const same = ['3305 N 27th St, McAllen, TX 78501', '3305 N 27 street mcallen', '3305 n 27 st', '3305 N 27th Street McAllen TX 78501', '3305 north 27 street, mcallen tx', '3305 N 27 th St Mcallen']
  for (const a of same) assert.deepEqual(parseAddress(a), { number: '3305', street: '27TH' }, a)
  for (const a of same) assert.equal(streetCore(a), '27TH', a)
  // the endings of numbered streets
  for (const [typed, want] of [['100 E 1 st', '1ST'], ['22 N 2 street', '2ND'], ['7 S 3 st', '3RD'], ['9 W 11 st', '11TH'], ['9 W 12 st', '12TH'], ['9 W 13 st', '13TH'], ['4 N 22 st', '22ND'], ['8 N 23 rd st', '23RD'], ['15 N 101 st', '101ST'], ['15 N 111 st', '111TH']]) assert.equal(parseAddress(typed).street, want, typed)
  // a city, a state and a ZIP after the suffix are not the street's name
  assert.deepEqual(parseAddress('118 S Cage Blvd Pharr'), { number: '118', street: 'CAGE' })
  assert.deepEqual(parseAddress('1201 Kerria Avenue Mcallen Texas'), { number: '1201', street: 'KERRIA' })
  assert.deepEqual(parseAddress('2002 kiskadee lane mission tx 78572'), { number: '2002', street: 'KISKADEE' })
  // and what must not change: roads named by a number or a letter after the word, and saints
  for (const [typed, want] of [['100 County Rd 12', 'COUNTY RD 12'], ['200 Loop 499', 'LOOP 499'], ['5 Ave B', 'AVE B'], ['12 FM 495', 'FM 495'], ['40 Mile 7 Rd', 'MILE 7'], ['900 St Jude Ave', 'ST JUDE'], ['5435 Curtis Clark Dr', 'CURTIS CLARK'], ['344 SE 3rd St', '3RD']]) assert.equal(parseAddress(typed).street, want, typed)
})

test('6: a spelling slip is not "another address was found"; a different street or direction still is', () => {
  const found = '3305 N 27TH ST, MCALLEN, TX, 78501'
  for (const typed of ['3305 N 27 street mcallen', '3305 n 27 st', '3305 N 27th Street McAllen TX', '3305 N 27 th st mcallen']) assert.equal(addressMismatch(typed, found), null, typed)
  assert.match(addressMismatch('3305 N 28 street mcallen', found).message, /We found 3305 N 27th St, not/)
  assert.match(addressMismatch('1300 W Nolana Ave', '1300 E NOLANA AVE, MCALLEN, TX, 78504').message, /We found 1300 E Nolana Ave, not W\. Is that right\?/)
  assert.deepEqual(addressMismatch('3307 N 27 street', found).what, ['number'])
})

test('6: "3305 N 27 street mcallen" finds the one parcel the well-typed address finds: no question first, no list of six', async () => {
  const { parcels } = sources()
  const well = await parcels.lookup({ address: '3305 N 27th St, McAllen, TX 78501' })
  assert.equal(well.match, 'one')
  for (const typed of ['3305 N 27 street mcallen', '3305 n 27 st mcallen tx', '3305 N 27th Street McAllen']) {
    const k = await parcels.lookup({ address: typed })
    assert.notEqual(k.match, 'confirm-address', `${typed}: asked "is that right?" for a spelling`)
    assert.equal(k.match, 'one', `${typed}: ${k.match}, ${(k.candidates || []).length} candidates`)
    assert.equal(k.propId, well.propId, typed)
    assert.equal((k.candidates || []).length, 0, 'one best match, not a list')
  }
  // a number that is not on the street is still not guessed
  const other = await parcels.lookup({ address: '3399 N 27 street mcallen' })
  assert.notEqual(other.propId, well.propId)
})
