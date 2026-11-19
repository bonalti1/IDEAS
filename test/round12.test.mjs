// Fix round 12 (the architect's review of PR #11, Nov 19 2026). Each test fails on round 11's code and passes here.
// All of it runs on the recordings: no network.
//   1  the drafter is told a lot was a near match: the server stamps it from its own parcel record
//   2  a parcel lot's outline, front and edge kinds are the county's, whatever outline the browser sends
//   3  a plat lot gets its zoning read at the address's map point when a drafter confirms it
//   5  the envelope of a lot is worked out once per outline, and the run search only where a side curves
//   6  the live test fails when FEMA is gone for good (most addresses skipped, or a 404 / a missing layer)
//   7  the daily check's "two runs in a row" does not count two clicks a minute apart
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { outlineGapFt } from '../server/projects.mjs'
import { buildLot, envelopeOf, envelopeStats, insideRect, turnLot, lotTurn } from '../src/draft/lib/lot.js'
import { checkRules } from '../src/draft/lib/rules.js'
import { starterDraft } from '../src/draft/lib/layout.js'
import { TEST_ADDRESSES } from '../server/parcel-sources.mjs'
import { plainReason } from '../src/draft/lib/plain.js'
import { roofSurfaces, dormerWalls, roofWork } from '../src/draft/lib/roof.js'
import { fitsLot, clearFitCache, startFrom } from '../src/draft/lib/fit.js'
import { makeParcels } from '../server/parcels.mjs'
import { makeLots, FEMA_DOWN } from '../server/lots.mjs'
import { fixtureFetch, loadFixtures } from '../server/fixtures.mjs'
import { parcelSpec, lotMatchNotes } from '../src/draft/lib/parcel-spec.js'
import { generateRooms, DEFAULT_PROGRAM } from '../src/draft/lib/layout.js'
import { STYLES } from '../src/draft/lib/styles.js'
import { fixtureEnv } from './server-env.mjs'
import { floodFailure, checkFloodSkips } from './live-flood.mjs'

const style = STYLES.find((s) => s.ready) || STYLES[0]
const enc = encodeURIComponent
const design = { contract: 1, client: 'Ana', rooms: [] }
const small = { ...DEFAULT_PROGRAM, sqft: 1600, beds: 3, baths: 2, halfBath: false, office: false }

async function startServer(t, env = {}) {
  const port = 9900 + Math.floor(Math.random() * 90)
  const base = `http://127.0.0.1:${port}`
  const proc = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, ...fixtureEnv, DRAFTHOUSE_CLAUDE_KEY: '', ANTHROPIC_API_KEY: '', DATABASE_URL: '', SUPABASE_URL: '', RESEND_API_KEY: '', DRAFTHOUSE_APP_KEY: '', DRAFTHOUSE_WORKER_KEY: 'test-worker-key', DRAFTHOUSE_DRAFTERS: 'maria@drafthouse.test', REGRID_API_TOKEN: '', PARCEL_DAILY_CHECK: '0', PARCEL_FIELD_CHECK: '0', PORT: String(port), FEMA_BACKOFF_MS: '3,6', DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dh-r12-')), ...env } })
  let out = ''
  proc.stdout.on('data', (d) => (out += d))
  proc.stderr.on('data', (d) => (out += d))
  t.after(() => proc.kill())
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(base + '/api/health')
      break
    } catch {
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  return { base, log: () => out, kill: () => proc.kill() }
}
async function who(base, email, extra = {}) {
  const r = await fetch(base + '/api/auth/dev-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, name: email.split('@')[0] }) })
  const { token } = await r.json()
  const h = { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...extra }
  return { get: (p) => fetch(base + p, { headers: h }), post: (p, b = {}) => fetch(base + p, { method: 'POST', headers: h, body: JSON.stringify(b) }), put: (p, b = {}) => fetch(base + p, { method: 'PUT', headers: h, body: JSON.stringify(b) }) }
}
const lotEvents = async (maria) => (await (await maria.get('/api/admin/overview')).json()).events.filter((e) => e.kind === 'lot')

// ── item 1 ───────────────────────────────────────────────────────────────────────────────────────────
test('1: a near match reaches the drafter: the server stamps it from its own record, and "exact" from the browser does not remove it', async (t) => {
  const { base } = await startServer(t)
  const ana = await who(base, 'ana@example.com')
  const maria = await who(base, 'maria@drafthouse.test')
  const address = '323 N 11th St, Raymondville, TX 78580'
  const parcel = await (await ana.get(`/api/lot/parcel?address=${enc(address)}`)).json()
  assert.equal(parcel.confidence, 'near')
  // the browser says "exact" and leaves the listed address out
  const spec = { ...parcelSpec(parcel, { address, city: '', county: 'Willacy County' }), confidence: 'exact', matchedBy: 'address-point', listedAs: undefined }
  const lot = buildLot(spec)
  const made = await ana.post('/api/projects', { lot, style: { id: style.id }, program: small, rooms: generateRooms(small, style, lot), client: 'Ana Near' })
  assert.equal(made.status, 201, await made.clone().text())
  const prj = await made.json()
  assert.equal(prj.lot.spec.confidence, 'near', 'round 11 stored the browser\'s "exact"')
  assert.equal(prj.lot.spec.listedAs, '329 11TH')
  assert.equal(prj.lot.spec.outlineBy, 'county')
  // what the drafter's review card reads
  const seen = await (await maria.get(`/api/projects/${prj.id}`)).json()
  assert.deepEqual(lotMatchNotes(seen.lot.spec), ['Near match: the county lists this parcel as 329 11TH, not 323 N 11th St. Check the deed or plat before confirming.'])
  // saving it again as "exact", or with a made-up listed address, changes nothing
  for (const lie of [{ confidence: 'exact' }, { confidence: 'exact', listedAs: '323 11TH' }, { confidence: 'situs', listedAs: null, outlineBy: 'drafter' }]) {
    const put = await ana.put(`/api/projects/${prj.id}`, { lot: { ...lot, spec: { ...spec, ...lie } } })
    assert.equal(put.status, 200)
    const after = (await put.json()).lot.spec
    assert.equal(after.confidence, 'near')
    assert.equal(after.listedAs, '329 11TH')
    assert.equal(after.outlineBy, 'county')
  }
  // confirmed, it still says so: the note stays on the card for whoever opens the plan later
  const conf = await (await maria.post(`/api/review/${prj.id}/lot`, { confirmed: true, note: 'checked against the plat' })).json()
  assert.equal(conf.lot.spec.confirmed, true)
  assert.equal(lotMatchNotes(conf.lot.spec).length, 1)
  // an exact match has no note; a parcel the address does not lead to is said to be picked, with the one it does lead to
  const k = await (await ana.get(`/api/lot/parcel?address=${enc('1201 Kerria Ave, McAllen, TX 78501')}`)).json()
  const kSpec = parcelSpec(k, { address: '1201 Kerria Ave, McAllen, TX 78501', city: 'mcallen', county: 'Hidalgo County' })
  const kLot = buildLot(kSpec)
  const exact = await (await ana.post('/api/projects', { lot: kLot, style: { id: style.id }, program: small, rooms: generateRooms(small, style, kLot) })).json()
  assert.equal(exact.lot.spec.confidence, 'exact')
  assert.deepEqual(lotMatchNotes(exact.lot.spec), [])
  await ana.get(`/api/lot/parcel?address=${enc('118 S Cage Blvd, Pharr, TX 78577')}`) // the server has seen Pharr
  const other = await (await ana.post('/api/projects', { lot: { ...kLot, spec: { ...kSpec, propId: '259430', confidence: 'exact' } }, style: { id: style.id }, program: small, rooms: generateRooms(small, style, kLot) })).json()
  if (other.lot.spec.outlineBy === 'county') {
    assert.equal(other.lot.spec.confidence, 'pick')
    assert.match(lotMatchNotes(other.lot.spec)[0], /The address leads to parcel 255056, but this lot names parcel 259430/)
  } else assert.equal(other.lot.spec.confidence, 'unchecked')
  // the card shows the notes
  const review = fs.readFileSync('src/draft/screens/Review.jsx', 'utf8')
  assert.match(review, /lotMatchNotes\(open\.lot\.spec\)\.map/)
  assert.match(review, /data-testid="lot-match-note"/)
})

// ── item 2 ───────────────────────────────────────────────────────────────────────────────────────────
test('2: the outline of a parcel lot is the county\'s: Pharr\'s commercial outline under Kerria\'s parcel id is replaced, and logged', async (t) => {
  const { base } = await startServer(t)
  const ana = await who(base, 'ana@example.com')
  const maria = await who(base, 'maria@drafthouse.test')
  const pharr = await (await ana.get(`/api/lot/parcel?address=${enc('118 S Cage Blvd, Pharr, TX 78577')}`)).json()
  const kerria = await (await ana.get(`/api/lot/parcel?address=${enc('1201 Kerria Ave, McAllen, TX 78501')}`)).json()
  assert.ok(pharr.areaSf > 70000 && kerria.areaSf < 11000)
  const kAddress = '1201 Kerria Ave, McAllen, TX 78501'
  const honest = parcelSpec(kerria, { address: kAddress, city: 'mcallen', county: 'Hidalgo County' })
  // Pharr's 1.65 acres, front and edge kinds, with Kerria's id and address
  const forged = { ...parcelSpec(pharr, { address: kAddress, city: 'mcallen', county: 'Hidalgo County' }), propId: kerria.propId, geoId: kerria.geoId, legal: kerria.legal }
  const fLot = buildLot(forged)
  assert.ok(fLot.areaSf > 70000)
  const made = await ana.post('/api/projects', { lot: fLot, style: { id: style.id }, program: small, rooms: generateRooms(small, style, fLot), client: 'Ana Outline' })
  assert.equal(made.status, 201, await made.clone().text())
  const prj = await made.json()
  assert.deepEqual(prj.lot.spec.calls, kerria.calls, 'the stored outline is the county\'s for parcel 255056 (round 11 stored Pharr\'s)')
  assert.ok(prj.lot.areaSf > 10300 && prj.lot.areaSf < 10550, `area ${prj.lot.areaSf}`)
  assert.equal(prj.lot.spec.front, honest.front)
  assert.deepEqual(prj.lot.spec.kinds, honest.kinds)
  assert.deepEqual(prj.lot.spec.streets, honest.streets)
  assert.equal(prj.lot.spec.frontWidthFt, 79.75)
  assert.equal(prj.lot.spec.legal, kerria.legal)
  assert.equal(prj.lot.spec.zoning.district, 'R-1')
  assert.equal(prj.lot.spec.outlineBy, 'county')
  const ev = await lotEvents(maria)
  assert.equal(ev.length, 1, JSON.stringify(ev))
  assert.match(ev[0].message || ev[0].text || JSON.stringify(ev[0]), /parcel 255056 .*the outline sent by the browser .*the county's outline was used/)
  // an honest lot is stored as sent and logs nothing; one that is a few inches off is the county's too, without a log line
  const hLot = buildLot(honest)
  const ok = await (await ana.post('/api/projects', { lot: hLot, style: { id: style.id }, program: small, rooms: generateRooms(small, style, hLot) })).json()
  assert.deepEqual(ok.lot.spec.calls, kerria.calls)
  const nudged = { ...honest, calls: honest.calls.map((c, i) => (i === 0 ? { ...c, distance: +(c.distance + 0.4).toFixed(2) } : c)) }
  assert.ok(outlineGapFt(nudged.calls, honest.calls) <= 1)
  const near = await (await ana.put(`/api/projects/${ok.id}`, { lot: { ...hLot, spec: nudged } })).json()
  assert.deepEqual(near.lot.spec.calls, kerria.calls)
  assert.equal((await lotEvents(maria)).length, 1, 'no new lot event')
  // a confirmed lot: the same outline keeps the confirmation; a different one loses it and is the county's again
  const conf = await (await maria.post(`/api/review/${ok.id}/lot`, { confirmed: true })).json()
  assert.equal(conf.lot.spec.confirmed, true)
  assert.equal((await (await ana.put(`/api/projects/${ok.id}`, { lot: { ...hLot, spec: honest } })).json()).lot.spec.confirmed, true)
  const swapped = await (await ana.put(`/api/projects/${ok.id}`, { lot: { ...fLot, spec: forged } })).json()
  assert.equal(swapped.lot.spec.confirmed, false)
  assert.deepEqual(swapped.lot.spec.calls, kerria.calls)
  assert.equal((await lotEvents(maria)).length, 2)
  // calls a drafter corrects by hand are the drafter's, and stay while the homeowner sends them back unchanged
  // (two opposite sides 3 ft longer, so the outline still closes)
  const fixed = honest.calls.map((c, i) => (i === 0 || i === 2 ? { ...c, distance: +(c.distance + 3).toFixed(2) } : c))
  assert.ok(outlineGapFt(fixed, honest.calls) > 1)
  const bh = await maria.post(`/api/review/${ok.id}/lot`, { confirmed: true, spec: { calls: fixed } })
  assert.equal(bh.status, 200, await bh.clone().text())
  const byHand = await bh.json()
  assert.equal(byHand.lot.spec.outlineBy, 'drafter')
  const kp = await ana.put(`/api/projects/${ok.id}`, { lot: { ...byHand.lot, spec: { ...byHand.lot.spec, outlineBy: 'county', confirmedBy: 'ana@example.com' } } })
  assert.equal(kp.status, 200, await kp.clone().text())
  const kept = await kp.json()
  assert.deepEqual(kept.lot.spec.calls, fixed)
  assert.equal(kept.lot.spec.confirmed, true)
  const asMaria = (await (await maria.get(`/api/projects/${ok.id}`)).json()).lot.spec
  assert.equal(asMaria.confirmedBy, 'maria@drafthouse.test', 'not the name the browser sent')
  assert.equal(asMaria.outlineBy, 'drafter')
  // the gap between two outlines
  assert.equal(outlineGapFt(honest.calls, honest.calls), 0)
  assert.equal(outlineGapFt(honest.calls, pharr.calls), Infinity, 'a different number of sides')
  assert.equal(outlineGapFt(null, honest.calls), Infinity)
})

// ── item 3 ───────────────────────────────────────────────────────────────────────────────────────────
test('3: a plat lot gets its zoning read when a drafter confirms it, shown to confirm or change; a commercial district blocks Send', async (t) => {
  const { base } = await startServer(t)
  const ana = await who(base, 'ana@example.com')
  const maria = await who(base, 'maria@drafthouse.test')
  const plat = (address, city) => ({ kind: 'plat', address, city, county: 'Hidalgo County', calls: [{ bearing: 'N 00°00\'00" E', distance: 150 }, { bearing: 'N 90°00\'00" E', distance: 100 }, { bearing: 'S 00°00\'00" E', distance: 150 }, { bearing: 'N 90°00\'00" W', distance: 100 }], front: 3, streets: [{ edge: 3, name: 'Cage Blvd' }], setbacks: {}, zoning: { district: 'R-1', residential: true } })
  const make = async (address, city) => {
    const lot = buildLot(plat(address, city))
    const r = await ana.post('/api/projects', { lot, style: { id: style.id }, program: small, rooms: generateRooms(small, style, lot) })
    assert.equal(r.status, 201, await r.clone().text())
    return r.json()
  }
  const prj = await make('118 S Cage Blvd, Pharr, TX 78577', 'pharr')
  assert.equal(prj.lot.spec.zoning, null, 'nothing from the browser, and nothing read before a drafter has looked at the plat')
  const conf = await (await maria.post(`/api/review/${prj.id}/lot`, { confirmed: true })).json()
  assert.equal(conf.lot.spec.confirmed, true)
  assert.equal(conf.lot.spec.zoning.district, 'C-2', 'round 11 left a confirmed plat lot with no zoning')
  assert.equal(conf.lot.spec.zoning.residential, false)
  assert.equal(conf.lot.spec.zoning.readBy, 'server')
  assert.equal(conf.lot.spec.zoning.readAt, 'the address point')
  assert.equal(conf.lot.spec.zoning.confirmedBy, undefined, 'read, not confirmed: the card asks the drafter to confirm or change')
  const s = await ana.post(`/api/projects/${prj.id}/send`, { design })
  assert.equal(s.status, 409)
  assert.match((await s.json()).error, /zoned C-2/)
  // the homeowner cannot swap it for a house district
  const put = await (await ana.put(`/api/projects/${prj.id}`, { lot: { ...conf.lot, spec: { ...conf.lot.spec, zoning: { district: 'R-1', residential: true } } } })).json()
  assert.equal(put.lot.spec.zoning.district, 'C-2')
  // the drafter confirms it as read, or changes it; a district a drafter entered is not read over on the next confirm
  const asRead = await (await maria.post(`/api/review/${prj.id}/zoning`, { district: 'C-2', residential: false, use: conf.lot.spec.zoning.use })).json()
  assert.equal(asRead.lot.spec.zoning.confirmedBy, 'maria@drafthouse.test')
  const changed = await (await maria.post(`/api/review/${prj.id}/zoning`, { district: 'R-2', residential: true })).json()
  assert.equal(changed.lot.spec.zoning.district, 'R-2')
  const again = await (await maria.post(`/api/review/${prj.id}/lot`, { confirmed: true })).json()
  assert.equal(again.lot.spec.zoning.district, 'R-2')
  assert.equal(again.lot.spec.zoning.confirmedBy, 'maria@drafthouse.test')
  // a house district blocks nothing
  const house = await make('1201 Kerria Ave, McAllen, TX 78501', 'mcallen')
  const hc = await (await maria.post(`/api/review/${house.id}/lot`, { confirmed: true })).json()
  assert.equal(hc.lot.spec.zoning.district, 'R-1')
  assert.doesNotMatch(await (await ana.post(`/api/projects/${house.id}/send`, { design })).text(), /zoned/)
  // an address the geocoder does not know: confirmed all the same, the zoning left for the drafter to enter
  const lost = await make('1 Nowhere Rd, Pharr, TX 78577', 'pharr')
  const lc = await (await maria.post(`/api/review/${lost.id}/lot`, { confirmed: true })).json()
  assert.equal(lc.lot.spec.confirmed, true)
  assert.equal(lc.lot.spec.zoning?.district ?? null, null)
  // the card
  const review = fs.readFileSync('src/draft/screens/Review.jsx', 'utf8')
  assert.match(review, /data-testid="zoning-read"/)
  assert.match(review, /confirm or change/)
  assert.match(review, /data-testid="zoning-as-read"/)
})

// ── item 5 ─────────────────────────────────────────────────────────────────────────────────
test('5: a roof is worked out once per set of masses (the fit asked twice for each plan it tried), and an envelope once per outline', async () => {
  const lot = buildLot({ kind: 'manual', width: 100, depth: 150, city: 'mcallen', setbacks: {} })
  const rooms = generateRooms(DEFAULT_PROGRAM, style, lot)
  const roof = rooms.find((r) => r.kind === 'roof')
  const args = [roof.masses, roof.scale || 1, roof.centre, roof.offset || [0, 0]]
  // a set of masses nobody has asked for yet (moved a foot): faces, then dormer walls, then both again
  const moved = roof.masses.map((m) => ({ ...m, x: m.x + 1 }))
  const before = roofWork()
  const faces = roofSurfaces(moved, args[1], args[2], args[3])
  dormerWalls(moved, args[1], args[2], args[3])
  const again = roofSurfaces(moved, args[1], args[2], args[3])
  dormerWalls(moved, args[1], args[2], args[3])
  assert.equal(roofWork().made - before.made, 1, 'round 11 worked the same roof out four times here')
  assert.deepEqual(again, faces)
  assert.notEqual(again, faces, 'each caller gets a list of its own')
  // the fit of the default plan: most of what it asks for is a roof it already has
  clearFitCache()
  const w0 = roofWork()
  fitsLot({ ...DEFAULT_PROGRAM, sqft: 2810 }, style, lot)
  const w = roofWork()
  assert.ok(w.reused - w0.reused >= w.made - w0.made, `made ${w.made - w0.made}, reused ${w.reused - w0.reused}`)
  // the envelope: once per outline and setbacks; a copy each time; the run search only where a side curves
  const e0 = envelopeStats()
  const spec = { kind: 'manual', width: 97, depth: 143, city: 'mcallen', setbacks: {} }
  const a = buildLot(spec)
  const b = buildLot(spec)
  const e1 = envelopeStats()
  assert.equal(e1.made - e0.made, 1)
  assert.equal(e1.reused - e0.reused, 1)
  assert.equal(e1.runsTried - e0.runsTried, 0, 'a rectangle has no run to try')
  assert.deepEqual(a.envelope, b.envelope)
  const sq = [[0, 0], [100, 0], [100, 150], [0, 150]]
  const one = envelopeOf(sq, [20, 5, 10, 5])
  one[0][0] = 999
  assert.notEqual(envelopeOf(sq, [20, 5, 10, 5])[0][0], 999, 'what is kept cannot be changed through what was handed out')
  // Kiskadee still gets its one line behind the curve
  const FIX = loadFixtures()
  const m = new Map()
  const store = { meta: { get: async (k) => (m.has(k) ? m.get(k) : null), set: async (k, v) => m.set(k, v) } }
  const fetchImpl = fixtureFetch(FIX)
  const lots = makeLots({ store, fetchImpl, files: {}, interpreter: {}, event: async () => {}, log: () => {}, env: {} })
  const parcels = makeParcels({ store, fetchImpl, geocode: (x) => lots.geocode(x), log: () => {}, env: {}, event: async () => {} })
  const k = await parcels.lookup({ address: '2002 Kiskadee Ln, Mission, TX 78572' })
  const e2 = envelopeStats()
  const kis = buildLot(parcelSpec(k, { city: 'mission' }))
  assert.equal(envelopeStats().runsTried - e2.runsTried, 1, 'the six front chords, and not the two 9.6 ft pieces at the back corner')
  assert.ok(kis.envelopeSf >= 2900 && kis.envelopeSf <= 3200, `buildable ${Math.round(kis.envelopeSf)} sf`)
})

// ── item 6 ─────────────────────────────────────────────────────────────────────────────────
test('6: the live test skips a FEMA outage but fails when FEMA is gone: a 404, a missing layer, or more than half the addresses skipped', async () => {
  const FIX = loadFixtures()
  const pt = FIX.find((f) => f.slug === 'curtis-clark-5435-corpus-christi').point
  const events = []
  const mk = (fetchImpl) => {
    const m = new Map()
    const store = { meta: { get: async (k) => (m.has(k) ? m.get(k) : null), set: async (k, v) => m.set(k, v) } }
    const log = []
    return { log, lots: makeLots({ store, fetchImpl, files: {}, interpreter: {}, event: async (kind, text) => events.push({ kind, text }), log: (l) => log.push(l), env: { FEMA_BACKOFF_MS: '2,4' } }) }
  }
  const real = fixtureFetch(FIX)
  const fema = (answer) => async (url, opts) => (String(url).includes('hazards.fema.gov') ? answer() : real(url, opts))
  const res = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const caught = async (lots) => lots.floodAt(pt).then(() => null, (e) => e)
  // an outage: a reset, a 504: skipped
  for (const answer of [() => { throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }) }) }, () => res({}, 504), () => res({ error: { code: 500, message: 'Error performing query operation' } })]) {
    const { lots, log } = mk(fema(answer))
    const e = await caught(lots)
    assert.equal(e.message, FEMA_DOWN)
    assert.equal(e.status, 502)
    assert.equal(e.why, 'outage')
    assert.equal(floodFailure(e, 'x'), 'skip')
    assert.equal(log.filter((l) => /trying again/.test(l)).length, 4, 'an outage is tried again')
  }
  assert.equal(events.length, 0)
  // FEMA gone: the service moved (404), or the layer is not there: the homeowner still gets the plain 502, the live test fails, the office gets one alert
  for (const [answer, word] of [[() => res({}, 404), /HTTP 404/], [() => res({ error: { code: 400, message: 'Invalid or missing input parameters.' } }), /Invalid or missing/], [() => res({ error: { code: 404, message: 'Layer not found' } }), /Layer not found/]]) {
    const { lots, log } = mk(fema(answer))
    const e = await caught(lots)
    assert.equal(e.message, FEMA_DOWN, 'the homeowner reads the same plain line')
    assert.equal(e.status, 502)
    assert.equal(e.why, 'gone')
    assert.throws(() => floodFailure(e, '36 Melissa Dr'), (x) => /36 Melissa Dr: FEMA answered, but not with data/.test(x.message) && word.test(x.message) && /not an outage/.test(x.message), 'round 11 skipped this and passed')
    assert.equal(log.filter((l) => /trying again/.test(l)).length, 0, 'waiting does not mend a 404')
    const again = await caught(lots)
    assert.equal(again.why, 'gone')
  }
  assert.equal(events.filter((e) => e.kind === 'alert' && /FEMA's flood map service answered/.test(e.text)).length, 3, 'one alert per server process, not one per lookup')
  // an error that is not FEMA's is not swallowed
  assert.throws(() => floodFailure(new Error('boom'), 'x'), /boom/)
  // more than half skipped is a failure; half or fewer is a note
  assert.equal(checkFloodSkips(0, 14), null)
  assert.match(checkFloodSkips(3, 14), /3 of 14 addresses/)
  assert.match(checkFloodSkips(7, 14), /7 of 14/)
  assert.throws(() => checkFloodSkips(8, 14), /8 of 14 addresses: more than half/)
  assert.throws(() => checkFloodSkips(14, 14), /more than half/)
  // and the live test uses both
  const live = fs.readFileSync('test/live-acceptance.test.mjs', 'utf8')
  assert.match(live, /floodFailure\(e, t\.address\)/)
  assert.match(live, /checkFloodSkips\(floodSkipped, TEST_ADDRESSES\.length\)/)
})

// ── item 7 ─────────────────────────────────────────────────────────────────────────────────
test('7: two taps of "Check now" a minute apart are one failed run and send no email; the next day\'s failure is the second and does', async () => {
  const FIX = loadFixtures()
  const m = new Map()
  const store = { meta: { get: async (k) => (m.has(k) ? m.get(k) : null), set: async (k, v) => m.set(k, v) } }
  const fetchImpl = fixtureFetch(FIX) // the recordings carry no owner: every address fails "no owner came back"
  const lots = makeLots({ store, fetchImpl, files: {}, interpreter: {}, event: async () => {}, log: () => {}, env: {} })
  const parcels = makeParcels({ store, fetchImpl, geocode: (x) => lots.geocode(x), log: () => {}, env: {}, event: async () => {} })
  const emails = []
  const email = async (s2, t2) => emails.push({ s: s2, t: t2 })
  const t0 = Date.parse('2026-11-19T12:00:00Z')
  const at = (min) => new Date(t0 + min * 60000).toISOString()
  const r1 = await parcels.dailyCheck({ email, at: at(0) })
  assert.equal(r1.ok, false)
  assert.equal(r1.results[0].failedDays, 1)
  const r2 = await parcels.dailyCheck({ email, at: at(1) })
  assert.equal(r2.results[0].failedDays, 1, 'round 11 counted the second tap as a second run')
  assert.equal(r2.failedDays, 1)
  assert.equal(emails.length, 0, 'and emailed the office')
  await parcels.dailyCheck({ email, at: at(5 * 60) })
  assert.equal(emails.length, 0, 'five hours later is still the same failure')
  const r4 = await parcels.dailyCheck({ email, at: at(24 * 60) })
  assert.equal(r4.results[0].failedDays, 2)
  assert.equal(emails.length, 1, 'the next day: twice running')
  assert.match(emails[0].s, /twice running/)
  // a tap right after that run does not email again
  await parcels.dailyCheck({ email, at: at(24 * 60 + 2) })
  assert.equal(emails.length, 1)
  // a pass in between starts the count again
  const healthy = makeParcels({ store, fetchImpl, geocode: (x) => lots.geocode(x), log: () => {}, env: {}, event: async () => {} })
  assert.equal((await healthy.dailyCheck({ email, requireOwner: false, at: at(30 * 60) })).ok, true)
  const r6 = await parcels.dailyCheck({ email, at: at(54 * 60) })
  assert.equal(r6.results[0].failedDays, 1)
  assert.equal(emails.length, 1)
})

// ── item B ─────────────────────────────────────────────────────────────────────────────────
test('B: a lot is saved the moment it is taken: 201 with no rooms, in "Your houses" and in the drafter\'s lots to confirm, no change used, and still there after the office API restarts', async (t) => {
  const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-r12-b-'))
  let srv = await startServer(t, { DATA_DIR })
  let ana = await who(srv.base, 'ana@example.com')
  let maria = await who(srv.base, 'maria@drafthouse.test')
  const address = '2002 Kiskadee Ln, Mission, TX 78572'
  const parcel = await (await ana.get(`/api/lot/parcel?address=${enc(address)}`)).json()
  const lot = buildLot(parcelSpec(parcel, { address, city: 'mission', county: 'Hidalgo County' }))
  // the lot alone: no rooms, no style
  const made = await ana.post('/api/projects', { lot, program: small, client: 'Ana Garza' })
  assert.equal(made.status, 201, 'round 11 answered 400 "rooms required": ' + (await made.clone().text()))
  const prj = await made.json()
  assert.equal(prj.version, 0)
  assert.equal(prj.stage, 'style')
  assert.deepEqual(prj.rooms, [])
  assert.equal(prj.changesUsed, 0)
  assert.equal(prj.changesLeft, 10, 'a saved lot uses no free change')
  assert.equal(prj.lot.spec.propId, '707917')
  assert.equal(prj.lot.spec.outlineBy, 'county')
  // the homeowner's list, and the drafter's queue, at once
  const mine = await (await ana.get('/api/projects')).json()
  assert.equal(mine.length, 1)
  assert.equal(mine[0].id, prj.id)
  assert.equal(mine[0].version, 0)
  const inbox = await (await maria.get('/api/review')).json()
  assert.ok(inbox.lots.some((p) => p.id === prj.id), 'the drafter can confirm the lot while the homeowner is still choosing rooms')
  // there is no plan to change or send yet
  assert.equal((await ana.post(`/api/projects/${prj.id}/change`, { text: 'make the kitchen bigger' })).status, 409)
  assert.equal((await ana.post(`/api/projects/${prj.id}/send`, { design })).status, 409)
  // each step updates it: the style, then the rooms asked for
  const st = await (await ana.put(`/api/projects/${prj.id}`, { style: { id: style.id, name: style.name }, stage: 'rooms' })).json()
  assert.equal(st.stage, 'rooms')
  assert.equal(st.style.id, style.id)
  const pr = await (await ana.put(`/api/projects/${prj.id}`, { program: { ...small, beds: 2 }, stage: 'rooms' })).json()
  assert.equal(pr.program.beds, 2)
  assert.equal(pr.version, 0)
  // the drafter confirms it meanwhile
  const conf = await (await maria.post(`/api/review/${prj.id}/lot`, { confirmed: true })).json()
  assert.equal(conf.lot.spec.confirmed, true)
  // the office API restarts: the project is in the store, not in memory
  srv.kill()
  srv = await startServer(t, { DATA_DIR })
  ana = await who(srv.base, 'ana@example.com')
  maria = await who(srv.base, 'maria@drafthouse.test')
  const after = await (await ana.get('/api/projects')).json()
  assert.equal(after.length, 1, 'still there after a restart')
  const back = await (await ana.get(`/api/projects/${prj.id}`)).json()
  assert.equal(back.stage, 'rooms')
  assert.equal(back.program.beds, 2)
  assert.equal(back.lot.spec.confirmed, true)
  assert.ok(back.lot.envelope.length >= 3, 'the lot comes back built: resume draws the parcel')
  // the first rooms are the first draft: version 1, free
  const plain = buildLot({ kind: 'manual', width: 100, depth: 150, city: 'mcallen', setbacks: {} })
  const typed = await (await ana.post('/api/projects', { lot: plain, program: small })).json()
  assert.equal(typed.version, 0)
  const noStyle = await ana.put(`/api/projects/${typed.id}`, { rooms: generateRooms(small, style, plain) })
  assert.equal(noStyle.status, 400, 'rooms need a style')
  const drafted = await (await ana.put(`/api/projects/${typed.id}`, { style: { id: style.id, name: style.name }, program: small, rooms: generateRooms(small, style, plain) })).json()
  assert.equal(drafted.version, 1)
  assert.equal(drafted.stage, 'draft')
  assert.equal(drafted.versions[0].kind, 'initial')
  assert.equal(drafted.changesUsed, 0)
  assert.ok(drafted.rooms.length > 5)
  // nothing to save: still refused
  assert.equal((await ana.post('/api/projects', { program: small })).status, 400)
  assert.equal((await ana.post('/api/projects', { rooms: generateRooms(small, style, plain) })).status, 400, 'rooms without a style')
  // the app saves at the Lot step, the Style step and on the Rooms step, and resumes where it was left
  const app = fs.readFileSync('src/draft/DraftApp.jsx', 'utf8')
  assert.match(app, /saveDraft\(\{ lot: taken, program/)
  assert.match(app, /saveDraft\(\{ program \}, 'rooms'\)/)
  assert.match(fs.readFileSync('src/draft/screens/Start.jsx', 'utf8'), /Lot saved, rooms not chosen yet/)
})

// ── item A ─────────────────────────────────────────────────────────────────────────────────
const CITY = { McAllen: 'mcallen', Brownsville: 'brownsville', 'Corpus Christi': 'corpuschristi', Pharr: 'pharr', Edinburg: 'edinburg', Mission: 'mission' }
async function recordedLots() {
  const FIX = loadFixtures()
  const m = new Map()
  const store = { meta: { get: async (k) => (m.has(k) ? m.get(k) : null), set: async (k, v) => m.set(k, v) } }
  const fetchImpl = fixtureFetch(FIX)
  const lots = makeLots({ store, fetchImpl, files: {}, interpreter: {}, event: async () => {}, log: () => {}, env: {} })
  const parcels = makeParcels({ store, fetchImpl, geocode: (x) => lots.geocode(x), log: () => {}, env: {}, event: async () => {} })
  const out = []
  for (const t of TEST_ADDRESSES) {
    const k = await parcels.lookup({ address: t.address })
    out.push({ address: t.address, lot: buildLot(parcelSpec(k, { address: t.address, city: CITY[(k.census?.place || '').trim()] || '', county: t.county })) })
  }
  return out
}
const inPoly = (poly, [x, z]) => {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]
    const [xj, zj] = poly[j]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

test('A: the Kiskadee pie lot can be drafted: a 3 bed, 2 bath house fits once the house is turned, and the default program is offered that starter', async () => {
  const all = await recordedLots()
  const kis = all.find((x) => /Kiskadee/.test(x.address)).lot
  const three = { ...DEFAULT_PROGRAM, beds: 3, baths: 2, halfBath: false, office: false, garage: 0, sqft: 1400 }
  clearFitCache()
  const f = fitsLot(three, style, kis)
  assert.equal(f.ok, true, `round 11: "Does not fit" at every size (${f.reasons?.[0]})`)
  assert.ok(Math.abs(f.turn) > 0 && Math.abs(f.turn) <= 15, `turn ${f.turn}`)
  // the lot the app then builds, and the office rebuilds from the spec, carries the turn; the first draft passes the rules on it
  const turned = buildLot({ ...kis.spec, turn: f.turn })
  assert.equal(lotTurn(turned.spec), f.turn)
  assert.ok(Math.abs(turned.angle - turnLot(kis, f.turn).angle) < 1e-9, 'turnLot and buildLot agree')
  const d = starterDraft(three, style, turned)
  const rules = checkRules(d.rooms, three, style, turned)
  assert.equal(rules.ok, true, rules.reasons.join(' | '))
  assert.ok(d.fitScale >= 0.95)
  assert.ok(d.rooms.filter((r) => r.kind === 'bed' || r.kind === 'master').length === 3)
  // a turn is never more than 15 degrees, whatever a browser sends
  assert.equal(lotTurn({ turn: 40 }), 15)
  assert.equal(lotTurn({ turn: -90 }), -15)
  assert.equal(lotTurn({ turn: 'x' }), 0)
  assert.ok(Math.abs(buildLot({ ...kis.spec, turn: 40 }).angle - buildLot({ ...kis.spec, turn: 15 }).angle) < 1e-9)
  // the default 4 bed with an office and a 2-car garage: not a dead end, the starter is offered, and taking it fits
  clearFitCache()
  const dflt = fitsLot(DEFAULT_PROGRAM, style, kis)
  assert.equal(dflt.ok, false)
  assert.ok(!dflt.deadEnd, 'round 11 left the homeowner with nothing to do')
  assert.match(dflt.suggestion.label, /3 bed, 2 bath starter with no garage/)
  const taken = fitsLot(dflt.suggestion.program, style, kis)
  assert.equal(taken.ok, true)
  // a plain rectangle of a lot is never turned
  const plain = buildLot({ kind: 'manual', width: 100, depth: 150, city: 'mcallen', setbacks: {} })
  assert.equal(fitsLot(DEFAULT_PROGRAM, style, plain).turn, undefined)
  assert.equal(lotTurn(turnLot(plain, 0).spec), 0)
})

test('A: "the space you can build on" is the largest rectangle inside the buildable area, never its bounding box; a lot nothing fits says so and is never a dead end', async () => {
  const all = await recordedLots()
  for (const { address, lot } of all) {
    const r = insideRect(lot)
    // the rectangle really is inside the buildable area, and it is not bigger than the area
    for (const c of r.corners) {
      const pulled = [c[0] + (lot.centre[0] - c[0]) * 0.002, c[1] + (lot.centre[1] - c[1]) * 0.002]
      assert.ok(inPoly(lot.envelope, pulled), `${address}: a corner of the largest rectangle is outside the buildable area`)
    }
    assert.ok(r.areaSf <= lot.envelopeSf + 1, address)
    assert.ok(r.areaSf >= 0.45 * lot.envelopeSf, `${address}: ${Math.round(r.areaSf)} of ${Math.round(lot.envelopeSf)} sf`)
  }
  const kis = all.find((x) => /Kiskadee/.test(x.address)).lot
  const kr = insideRect(kis)
  assert.ok(kr.w < 45 && kr.d < 50, `Kiskadee holds about a 40 x 40 ft house square to the street (${kr.w.toFixed(1)} x ${kr.d.toFixed(1)}), not the 90 x 56 its bounding box says`)
  assert.ok(Math.max(...[2.5, 5, 7.5, 10, 12.5, 15].map((t) => insideRect(kis, t).areaSf)) > kr.areaSf * 1.03, 'and more of one when the house is turned')
  // lots where no plan of ours fits (the 21 ft wide sliver, the 35 ft deep corner lot): deadEnd, with honest numbers
  let deadEnds = 0
  for (const { address, lot } of all) {
    clearFitCache()
    const f = fitsLot({ ...DEFAULT_PROGRAM, beds: 3, baths: 2, halfBath: false, office: false, garage: 0, sqft: 1400 }, style, lot)
    if (f.ok || f.maxSqft || f.suggestion) continue
    deadEnds++
    assert.equal(f.deadEnd, true, `${address}: nothing fits, so the step offers the drafter`)
    const r = insideRect(lot)
    assert.ok(f.need.lotWidth <= r.w + 1e-9 && f.need.lotDepth <= r.d + 1e-9, `${address}: need says ${f.need.lotWidth} x ${f.need.lotDepth}, the largest rectangle inside is ${r.w.toFixed(1)} x ${r.d.toFixed(1)}`)
  }
  assert.ok(deadEnds >= 2, 'Curtis Clark (31 ft wide) and W Harris (35 ft deep) are dead ends for our plans')
  // the step shows the button and the fit message in plain words
  const step = fs.readFileSync('src/draft/screens/Program.jsx', 'utf8')
  assert.match(step, /check\.deadEnd/)
  assert.match(step, /Send my lot to the drafter/)
  assert.match(step, /data-testid="send-lot"/)
  assert.doesNotMatch(step, /setback/i, 'no "setback" on the rooms step')
  assert.equal(plainReason('Bedroom 2 would cross the setback at 6 ft from side.'), 'Bedroom 2 would sit too close to the side of the lot (the city keeps 6 ft open there).')
  assert.equal(plainReason('Garage would cross the setback at 20 ft from kiskadee ln.'), 'Garage would sit too close to the street side (Kiskadee Ln) (the city keeps 20 ft open there).')
  assert.doesNotMatch(plainReason('A 2-car garage has no spot on this lot that a car can be driven to (front-load does not fit the setbacks, and a side driveway has no room to turn).'), /setback/i)
})

test('A over HTTP: "Send my lot to the drafter" saves the lot with needsCustom, puts it in the drafter\'s queue, uses no change, and can be taken back', async (t) => {
  const { base } = await startServer(t)
  const ana = await who(base, 'ana@example.com')
  const maria = await who(base, 'maria@drafthouse.test')
  const address = '5435 Curtis Clark Dr, Corpus Christi, TX 78412'
  const parcel = await (await ana.get(`/api/lot/parcel?address=${enc(address)}`)).json()
  const lot = buildLot(parcelSpec(parcel, { address, city: 'corpuschristi', county: 'Nueces County' }))
  const prj = await (await ana.post('/api/projects', { lot, program: small, client: 'Ana Sliver' })).json()
  assert.equal(prj.version, 0)
  const sent = await ana.post(`/api/projects/${prj.id}/custom`, { note: 'We would like a porch.', program: { ...small, beds: 4 } })
  assert.equal(sent.status, 200, await sent.clone().text())
  const after = await sent.json()
  assert.ok(after.needsCustom?.at)
  assert.equal(after.needsCustom.note, 'We would like a porch.')
  assert.equal(after.program.beds, 4, 'the rooms asked for go with it')
  assert.equal(after.changesUsed, 0)
  const inbox = await (await maria.get('/api/review')).json()
  assert.ok(inbox.custom.some((p) => p.id === prj.id), 'in the drafter\'s queue')
  assert.ok(inbox.lots.some((p) => p.id === prj.id), 'and still a lot to confirm')
  assert.ok((await (await ana.get('/api/projects')).json())[0].needsCustom, 'and "Your houses" says it is with a drafter')
  // asking twice is one request; taking it back clears it
  const again = await (await ana.post(`/api/projects/${prj.id}/custom`, {})).json()
  assert.equal(again.needsCustom.at, after.needsCustom.at)
  const cleared = await (await ana.post(`/api/projects/${prj.id}/custom`, { clear: true })).json()
  assert.equal(cleared.needsCustom, null)
  assert.equal((await (await maria.get('/api/review')).json()).custom.length, 0)
  // another homeowner cannot flag it, and a bad body is a 400
  const eve = await who(base, 'eve@example.com')
  assert.equal((await eve.post(`/api/projects/${prj.id}/custom`, {})).status, 404)
  assert.equal((await ana.post(`/api/projects/${prj.id}/custom`, { note: 5 })).status, 400)
  // the turn is the lot's: saved with it, held to 15 degrees, and the stored lot is built with it
  const kAddr = '2002 Kiskadee Ln, Mission, TX 78572'
  const kp = await (await ana.get(`/api/lot/parcel?address=${enc(kAddr)}`)).json()
  const kSpec = parcelSpec(kp, { address: kAddr, city: 'mission', county: 'Hidalgo County' })
  const kLot = buildLot({ ...kSpec, turn: 40 })
  const saved = await (await ana.post('/api/projects', { lot: kLot, program: small })).json()
  assert.equal(lotTurn(saved.lot.spec), 15)
  assert.ok(Math.abs(saved.lot.angle - buildLot({ ...kSpec, turn: 15 }).angle) < 1e-6)
  const three = { ...DEFAULT_PROGRAM, beds: 3, baths: 2, halfBath: false, office: false, garage: 0, sqft: 1400 }
  const drafted = await ana.put(`/api/projects/${saved.id}`, { lot: buildLot({ ...kSpec, turn: 15 }), style: { id: style.id, name: style.name }, program: three, rooms: starterDraft(three, style, buildLot({ ...kSpec, turn: 15 })).rooms })
  assert.equal(drafted.status, 200, await drafted.clone().text())
  const dj = await drafted.json()
  assert.equal(dj.version, 1)
  assert.equal(lotTurn(dj.lot.spec), 15)
})

// ── items E, F, D ──────────────────────────────────────────────────────────────────────────
test('E: on every recorded lot the homeowner starts from a program that fits, or is offered the drafter; never "does not fit" before a house is seen', async () => {
  const all = await recordedLots()
  const table = []
  let trimmed = 0
  for (const { address, lot } of all) {
    clearFitCache()
    const first = fitsLot(DEFAULT_PROGRAM, style, lot)
    const start = startFrom(first, DEFAULT_PROGRAM)
    if (first.ok) {
      assert.equal(start, null, `${address}: the default fits, nothing to trim`)
      table.push(`${address.split(',')[0]}: the default fits`)
      continue
    }
    if (!start) {
      assert.equal(first.deadEnd, true, `${address}: neither a start nor the drafter`)
      table.push(`${address.split(',')[0]}: no plan fits, the drafter is offered`)
      continue
    }
    trimmed++
    const f = fitsLot(start, style, lot)
    assert.equal(f.ok, true, `${address}: starts at ${start.beds} bed, ${start.baths} bath, ${start.garage}-car, ${start.sqft} sf, which does not fit (${f.reasons?.[0]})`)
    table.push(`${address.split(',')[0]}: starts at ${start.beds} bed, ${start.baths} bath, ${start.garage ? start.garage + '-car' : 'no garage'}${start.office ? ', office' : ''}, ${start.sqft} sf${f.turn ? `, turned ${f.turn} deg` : ''}`)
  }
  console.log(table.join('\n'))
  assert.ok(trimmed >= 8, 'round 11: the default 4 bed, 3 bath, office, 2-car met "does not fit" on most real lots')
  // 3305 N 27th St, the lot of the real-customer test
  assert.match(table.find((l) => /3305 N 27th/.test(l)), /starts at/)
  const step = fs.readFileSync('src/draft/screens/Program.jsx', 'utf8')
  assert.match(step, /We started you with what fits this lot; you can change it\./)
  assert.match(step, /startFrom\(checked, program\)/)
})

test('F and D (source): no NaN for a lot with no city rules, and no "setback" in what a homeowner reads', () => {
  const lot = fs.readFileSync('src/draft/screens/Lot.jsx', 'utf8')
  assert.match(lot, /50% \(county default, the drafter confirms\)/)
  assert.match(lot, /'the drafter confirms'/)
  assert.doesNotMatch(lot, /Math\.round\(city\.maxCoverage \* 100\)/, 'the raw multiply that printed NaN% is gone')
  // the sentences a homeowner used to read, through the plain-words filter the screens now apply
  for (const line of [
    'Bedroom 2 would cross the setback at 6 ft from side.',
    'The kitchen would run past the 6 ft side setback.',
    'That would put the garage past the 20 ft setback from Kiskadee Ln.',
    'At 3,000 sf this plan runs past the setbacks on this lot; the largest it fits here with these rooms is about 2,400 sf.',
    'The setbacks leave no buildable area: 25\' front and 10\' rear need a lot deeper than 35 ft, 5\' each side a lot wider than 10 ft.',
    'The buildable area is very small. Check the dimensions and the setbacks.',
    'A corner lot: the side on N 12th St takes the street-side setback.',
    '+1 ft of setback per ft above 25',
  ]) {
    const out = plainReason(line)
    assert.doesNotMatch(out, /setback/i, out)
    assert.ok(out.length >= line.length * 0.6, out)
  }
  assert.equal(plainReason('The kitchen is 2 ft longer now.'), 'The kitchen is 2 ft longer now.', 'a line with no such word is left alone')
  // the homeowner screens: no "setback" in their own text (comments, class names and the drafter's screens aside)
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/className="[^"]*"|setSetback|\.setbacks|setbacks:|setbacks\?|setbacks \|\|/g, '')
  for (const f of ['Start.jsx', 'Lot.jsx', 'Style.jsx', 'Program.jsx', 'Draft.jsx', 'Send.jsx']) {
    const text = strip(fs.readFileSync(`src/draft/screens/${f}`, 'utf8'))
    assert.doesNotMatch(text, />[^<{]*setback[^<{]*</i, `${f}: "setback" in the page's own text`)
    assert.doesNotMatch(text, /'[^'\n]*\bsetbacks?\b[^'\n]*'|`[^`\n]*\bsetbacks?\b[^`\n]*`/i, `${f}: "setback" in a string a homeowner reads`)
  }
})
