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
  // the review's list: "Av" for Ave, a city in two words, a direction left out
  assert.deepEqual(parseAddress('1201 Kerria Av Mc Allen'), { number: '1201', street: 'KERRIA' })
  assert.deepEqual(parseAddress('1201 kerria avenue, mc allen tx'), { number: '1201', street: 'KERRIA' })
  assert.deepEqual(parseAddress('3305 27th St McAllen'), { number: '3305', street: '27TH' })
  assert.deepEqual(parseAddress('77 S Main St San Juan'), { number: '77', street: 'MAIN' })
  assert.equal(addressMismatch('1201 Kerria Av Mc Allen', '1201 KERRIA AVE, MCALLEN, TX, 78501'), null)
  assert.equal(addressMismatch('3305 27th St McAllen', '3305 N 27TH ST, MCALLEN, TX, 78501'), null, 'a direction left out is not another address')
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

// ── review of PR #12: M1, M2, and the house a homeowner could not find after signing out on the lot step ─────────
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { buildLot } from '../src/draft/lib/lot.js'
import { parcelSpec } from '../src/draft/lib/parcel-spec.js'
import { generateRooms } from '../src/draft/lib/layout.js'
import { STYLES } from '../src/draft/lib/styles.js'
import { cleanProgram } from '../server/projects.mjs'
import { fixtureEnv } from './server-env.mjs'

const style = STYLES.find((s) => s.ready)
const small = { beds: 3, baths: 2, halfBath: false, office: false, suite2: false, garage: 2, stories: 1, sqft: 2000, frontPorch: true, rearPorch: false }
const HIDALGO = 'gis.rgv911.org/server/rest/services/RGV911_Web_Apps_MIL1/MapServer/7'
async function startServer(t, env = {}) {
  const port = 9700 + Math.floor(Math.random() * 180)
  const base = `http://127.0.0.1:${port}`
  const proc = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, ...fixtureEnv, DRAFTHOUSE_CLAUDE_KEY: '', ANTHROPIC_API_KEY: '', DATABASE_URL: '', SUPABASE_URL: '', RESEND_API_KEY: '', DRAFTHOUSE_APP_KEY: '', DRAFTHOUSE_DRAFTERS: 'maria@drafthouse.test', REGRID_API_TOKEN: '', PARCEL_DAILY_CHECK: '0', PARCEL_FIELD_CHECK: '0', PORT: String(port), DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dh-r13-')), ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  proc.stdout.on('data', (d) => (out += d))
  proc.stderr.on('data', (d) => (out += d))
  const kill = () => new Promise((ok) => (proc.exitCode !== null ? ok() : (proc.once('exit', ok), proc.kill())))
  t.after(kill)
  for (let i = 0; i < 150; i++) {
    try {
      await fetch(base + '/api/health')
      break
    } catch {
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  return { base, log: () => out, kill }
}
async function who(base, email) {
  const r = await fetch(base + '/api/auth/dev-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, name: email.split('@')[0] }) })
  const { token } = await r.json()
  const h = { 'content-type': 'application/json', authorization: `Bearer ${token}` }
  return { get: (p) => fetch(base + p, { headers: h }), post: (p, b = {}) => fetch(base + p, { method: 'POST', headers: h, body: JSON.stringify(b) }), put: (p, b = {}) => fetch(base + p, { method: 'PUT', headers: h, body: JSON.stringify(b) }) }
}
const kAddress = '1201 Kerria Ave, McAllen, TX 78501'
// the two county records, read once from the recordings in this process (no server needed)
async function records() {
  const { parcels } = sources()
  return { kerria: await parcels.lookup({ address: kAddress }), pharr: await parcels.lookup({ address: '118 S Cage Blvd, Pharr, TX 78577' }) }
}

test('M1: a parcel number the county does not have is refused when the lot is saved (400, plain words); it never becomes a normal lot', async (t) => {
  const { base } = await startServer(t)
  const ana = await who(base, 'ana@example.com')
  const maria = await who(base, 'maria@drafthouse.test')
  const { pharr } = await records()
  // the review's forgery: Pharr's 71,834 sf outline under a number nobody has
  const forged = buildLot({ ...parcelSpec(pharr, { address: '999 Made Up St, McAllen, TX 78501', city: 'mcallen', county: 'Hidalgo County' }), propId: '99999999' })
  assert.ok(forged.areaSf > 70000)
  const lotOnly = await ana.post('/api/projects', { lot: forged, program: small })
  assert.equal(lotOnly.status, 400)
  assert.match((await lotOnly.json()).error, /The county has no parcel number 99999999\. Look the address up again, or type the lot in\./)
  const withRooms = await ana.post('/api/projects', { lot: forged, style: { id: style.id }, program: small, rooms: generateRooms(small, style, forged) })
  assert.equal(withRooms.status, 400)
  assert.deepEqual(await (await ana.get('/api/projects')).json(), [], 'nothing was saved')
  assert.equal((await (await maria.get('/api/review')).json()).lots.length, 0, 'and no drafter sees it')
})

test('M1: with the county not answering the lot is kept as unchecked; Confirm asks the county again and, while it is still down, needs "I checked the outline myself"; with the county back, Confirm puts the county\'s outline in', async (t) => {
  const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-r13-m1-'))
  const down = await startServer(t, { DATA_DIR, DRAFTHOUSE_FIXTURE_THROW: HIDALGO })
  const { kerria, pharr } = await records()
  // Pharr's outline under Kerria's (real) number, sent while the county cannot be asked
  const forged = buildLot({ ...parcelSpec(pharr, { address: kAddress, city: 'mcallen', county: 'Hidalgo County' }), propId: kerria.propId, geoId: kerria.geoId, legal: kerria.legal })
  let ana = await who(down.base, 'ana@example.com')
  let maria = await who(down.base, 'maria@drafthouse.test')
  const made = await ana.post('/api/projects', { lot: forged, style: { id: style.id }, program: small, rooms: generateRooms(small, style, forged), client: 'Ana Unchecked' })
  assert.equal(made.status, 201, await made.clone().text())
  const prj = await made.json()
  assert.equal(prj.lot.spec.confidence, 'unchecked')
  assert.equal(prj.lot.spec.outlineBy, 'browser')
  assert.equal(prj.lot.spec.confirmed, false)
  // the drafter: Confirm without the tick is refused, and says why
  const no = await maria.post(`/api/review/${prj.id}/lot`, { confirmed: true })
  assert.equal(no.status, 409)
  const why = await no.json()
  assert.equal(why.unchecked, true)
  assert.match(why.error, /The county did not answer, so this outline is still not checked against the county\./)
  assert.equal((await (await maria.get(`/api/projects/${prj.id}`)).json()).lot.spec.confirmed, false, 'nothing was confirmed')
  // round 15, B4: the homeowner can still send; the plan waits with its unchecked lot, and the drafter cannot approve it
  const sentEarly = await ana.post(`/api/projects/${prj.id}/send`, { design: { contract: 1, client: 'Ana' } })
  assert.equal(sentEarly.status, 200)
  assert.equal((await sentEarly.json()).lotPending, true)
  assert.equal((await maria.post(`/api/review/${prj.id}`, { decision: 'approved' })).status, 409)
  // the county is back (the same office, restarted without the outage): Confirm replaces the outline, and the mark goes
  await down.kill()
  const up = await startServer(t, { DATA_DIR })
  ana = await who(up.base, 'ana@example.com')
  maria = await who(up.base, 'maria@drafthouse.test')
  const yes = await maria.post(`/api/review/${prj.id}/lot`, { confirmed: true })
  assert.equal(yes.status, 200, await yes.clone().text())
  const after = (await yes.json()).lot
  assert.equal(after.spec.confirmed, true)
  assert.equal(after.spec.outlineBy, 'county')
  assert.notEqual(after.spec.confidence, 'unchecked')
  assert.deepEqual(after.spec.calls, kerria.calls, 'the county\'s outline for the number, not the one the browser sent')
  assert.ok(after.areaSf > 10300 && after.areaSf < 10550, `area ${after.areaSf}`)
  // the outline changed under the plan the homeowner sent, so the plan went back to them with a plain note
  assert.equal((await (await ana.get(`/api/projects/${prj.id}`)).json()).status, 'returned')
})

test('M1: while the county stays down, a drafter who ticks "I checked the outline myself" confirms on their own name, and it is logged', async (t) => {
  const down = await startServer(t, { DRAFTHOUSE_FIXTURE_THROW: HIDALGO })
  const { kerria } = await records()
  const honest = buildLot(parcelSpec(kerria, { address: kAddress, city: 'mcallen', county: 'Hidalgo County' }))
  const ana = await who(down.base, 'ana@example.com')
  const maria = await who(down.base, 'maria@drafthouse.test')
  const prj = await (await ana.post('/api/projects', { lot: honest, program: small })).json()
  assert.equal(prj.lot.spec.confidence, 'unchecked')
  assert.equal((await maria.post(`/api/review/${prj.id}/lot`, { confirmed: true })).status, 409)
  assert.equal((await maria.post(`/api/review/${prj.id}/lot`, { confirmed: true, checked: 'yes' })).status, 400, 'the tick is a yes or a no, nothing else')
  const ok = await maria.post(`/api/review/${prj.id}/lot`, { confirmed: true, checked: true })
  assert.equal(ok.status, 200, await ok.clone().text())
  const lot = (await ok.json()).lot
  assert.equal(lot.spec.confirmed, true)
  assert.equal(lot.spec.outlineBy, 'drafter')
  assert.equal(lot.spec.confirmedBy, 'maria@drafthouse.test')
  const events = (await (await maria.get('/api/admin/overview')).json()).events.filter((e) => e.kind === 'lot')
  assert.ok(events.some((e) => /confirmed parcel 255056 on their own check of the outline; the county did not answer/.test(e.message || e.text || JSON.stringify(e))), JSON.stringify(events))
})

test('M2: the rooms sent with "Send my lot to the drafter" are cleaned like any others: no made-up fields, no impossible counts', async (t) => {
  // the cleaner itself
  assert.deepEqual(cleanProgram({ beds: 3, baths: 2.5, garage: 2, sqft: 1999.6, office: true, foo: 'x', __v: 1, halfBath: 'yes' }), { beds: 3, baths: 2.5, garage: 2, sqft: 2000, office: true })
  assert.throws(() => cleanProgram({ beds: 999 }), /the bedrooms asked for must be between 1 and 8/)
  assert.throws(() => cleanProgram({ sqft: 'big' }), /the size asked for must be between 600 and 10000/)
  assert.throws(() => cleanProgram('3 beds'), /must be a list of counts/)
  assert.deepEqual(cleanProgram({ beds: 4, asked: { beds: 5, foo: 1, asked: { beds: 6 } } }), { beds: 4, asked: { beds: 5 } })
  // over HTTP
  const { base } = await startServer(t)
  const ana = await who(base, 'ana@example.com')
  const { kerria } = await records()
  const lot = buildLot(parcelSpec(kerria, { address: kAddress, city: 'mcallen', county: 'Hidalgo County' }))
  const prj = await (await ana.post('/api/projects', { lot, program: { ...small, foo: 'x' } })).json()
  assert.equal(prj.program.foo, undefined, 'create drops what is not a room count')
  const bad = await ana.post(`/api/projects/${prj.id}/custom`, { program: { beds: 999, foo: 'x' } })
  assert.equal(bad.status, 400)
  assert.match((await bad.json()).error, /the bedrooms asked for must be between 1 and 8/)
  const ok = await ana.post(`/api/projects/${prj.id}/custom`, { program: { beds: 5, foo: 'x', garage: 1 }, note: 'a pie lot' })
  assert.equal(ok.status, 200, await ok.clone().text())
  const got = await ok.json()
  assert.equal(got.program.beds, 5)
  assert.equal(got.program.garage, 1)
  assert.equal(got.program.baths, 2, 'what was there and not sent again is kept')
  assert.equal(got.program.foo, undefined)
  assert.ok(got.needsCustom)
  const upd = await ana.put(`/api/projects/${prj.id}`, { program: { beds: 4, evil: { nested: true } } })
  assert.equal((await upd.json()).program.evil, undefined, 'and so does an update')
})

test('houses: an address typed and not yet taken is saved, listed for its homeowner only, opens the lot step, and becomes the same house when the lot is taken', async (t) => {
  const { base } = await startServer(t)
  const ana = await who(base, 'ana@example.com')
  const maria = await who(base, 'maria@drafthouse.test')
  const made = await ana.post('/api/projects', { address: kAddress, stage: 'lot', client: 'Ana' })
  assert.equal(made.status, 201, await made.clone().text())
  const prj = await made.json()
  assert.equal(prj.version, 0)
  assert.equal(prj.stage, 'lot')
  assert.equal(prj.lot, null)
  assert.equal(prj.address, kAddress)
  assert.equal(prj.changesLeft, 10)
  const mine = await (await ana.get('/api/projects')).json()
  assert.equal(mine.length, 1)
  assert.equal(mine[0].address, kAddress)
  const review = await (await maria.get('/api/review')).json()
  assert.equal(review.lots.length, 0, 'no lot yet: nothing for a drafter to confirm')
  assert.equal((await ana.post('/api/projects', { address: 'x' })).status, 400, 'an address, not a letter')
  assert.equal((await ana.post(`/api/projects/${prj.id}/send`, {})).status, 409)
  // the lot is taken: the same house, now in the drafter's lots to confirm
  const { kerria } = await records()
  const lot = buildLot(parcelSpec(kerria, { address: kAddress, city: 'mcallen', county: 'Hidalgo County' }))
  const taken = await (await ana.put(`/api/projects/${prj.id}`, { lot, stage: 'style' })).json()
  assert.equal(taken.id, prj.id)
  assert.equal(taken.stage, 'style')
  assert.equal(taken.lot.spec.propId, kerria.propId)
  assert.equal((await (await ana.get('/api/projects')).json()).length, 1)
  assert.ok((await (await maria.get('/api/review')).json()).lots.some((p) => p.id === prj.id))
})
