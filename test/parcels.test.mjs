// Round 7, item 3: the parcel service. Geometry (projection, ring cleaning, surveyor's calls that traverse back),
// the where clause (no quote breaks out), situs parsing, the matching pipeline on the recorded fixtures for the
// three acceptance addresses (never the internet), the 40 m buffer never auto-picking a neighbour, the cache, the
// circuit breaker, owner and mailing drafter-only over HTTP, Regrid dormant without a token (and never logged),
// the daily check and the sources page.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { projectRing, cleanRing, ringToCalls, signedArea, interiorLonLat, whereClause, parseAddress, normalizeSitus, makeParcels } from '../server/parcels.mjs'
import { fixtureFetch, loadFixtures, parseWhere } from '../server/fixtures.mjs'
import { PARCEL_SOURCES, TEST_ADDRESSES, sourcesFor } from '../server/parcel-sources.mjs'
import { makeLots } from '../server/lots.mjs'
import { traverse, buildLot } from '../src/draft/lib/lot.js'

const FIX = loadFixtures()
const kerria = FIX.find((f) => f.slug === 'kerria-1201-mcallen')
const melissa = FIX.find((f) => f.slug === 'melissa-36-brownsville')
const curtis = FIX.find((f) => f.slug === 'curtis-clark-5435-corpus-christi')
const memStore = () => {
  const m = new Map()
  return { meta: { get: async (k) => (m.has(k) ? m.get(k) : null), set: async (k, v) => m.set(k, v) }, _m: m }
}
const services = (opts = {}) => {
  const store = memStore()
  const log = []
  const fetchImpl = opts.fetchImpl || fixtureFetch(FIX, { failUrls: opts.failUrls || [] })
  const lots = makeLots({ store, fetchImpl, files: {}, interpreter: {}, event: async () => {} })
  const parcels = makeParcels({ store, fetchImpl, geocode: (a) => lots.geocode(a), log: (m) => log.push(m), env: opts.env || {}, event: async () => {}, sources: opts.sources })
  return { store, lots, parcels, log }
}

test('fixtures: committed recordings carry no owner names or mailing addresses', () => {
  assert.ok(FIX.length >= 5)
  for (const f of FIX) {
    const text = JSON.stringify(f)
    for (const m of text.matchAll(/"(owner_name|owner_addr|owner|file_as_name|file_as_na|name|ownerAddre)":\s*"([^"]*)"/g)) assert.equal(m[2], 'REDACTED', `${f.slug}: ${m[1]} is not redacted`)
    assert.ok(f.synthetic === true || f.synthetic === false, 'each fixture says whether it is a recording')
    if (f.synthetic) assert.match(f.builtFrom, /round-7 brief/)
  }
})

test('geometry: a WGS84 ring projects to feet, cleans, becomes calls that traverse back to the same area and close', () => {
  const ring = kerria.parcels[0].geometry.coordinates[0]
  const { pts } = projectRing(ring)
  const { pts: clean, dropped } = cleanRing(pts)
  assert.equal(clean.length, 4)
  assert.deepEqual(dropped, { short: 0, straight: 0 })
  assert.ok(signedArea(clean) < 0, 'clockwise with north up')
  const calls = ringToCalls(clean)
  const t = traverse(calls)
  assert.ok(t.closure < 0.05, `closure ${t.closure}`)
  assert.ok(Math.abs(t.areaSf - 10428) < 10428 * 0.002, `area ${t.areaSf}`)
  // the 0.6 ft sliver on the Curtis Clark polygon is dropped; nothing else is
  const c = cleanRing(projectRing(curtis.parcels[0].geometry.coordinates[0]).pts)
  assert.equal(c.dropped.short, 1)
  assert.equal(c.pts.length, 4)
  // a vertex on a straight run (under 2 degrees of turn) is dropped too
  const straight = cleanRing([[0, 0], [50, 0.2], [100, 0], [100, 100], [0, 100]])
  assert.equal(straight.dropped.straight, 1)
  assert.equal(straight.pts.length, 4)
  // a ring under 3 points is never produced; a triangle stays a triangle
  assert.equal(cleanRing([[0, 0], [0.5, 0], [100, 0], [50, 80]]).pts.length, 3)
  // the interior point is inside the polygon (an L-shaped lot's centroid is outside it)
  const L = [[0, 0], [100, 0], [100, 30], [30, 30], [30, 100], [0, 100]].map(([x, y]) => [-98 + x / 300000, 26 + y / 364000])
  const ip = interiorLonLat(L)
  assert.ok(ip[0] > -98 + 30 / 300000 ? ip[1] < 26 + 30 / 364000 : true, 'interior point is in one of the arms')
})

test('the where clause only takes whitelisted field names and doubles quotes, so a street name cannot break out', () => {
  assert.equal(whereClause([['situs', 'LIKE', "1201 %O'BRIEN%"]]), "UPPER(situs) LIKE '1201 %O''BRIEN%'")
  assert.equal(whereClause([['prop_id', '=', "1' OR 1=1; DROP TABLE x --"]]), "prop_id = '1'' OR 1=1 DROP TABLE x --'")
  assert.throws(() => whereClause([['situs; DROP', '=', 'x']]), /field name not allowed/)
  assert.throws(() => whereClause([['situs', '>', 'x']]), /operator not allowed/)
  assert.deepEqual(parseWhere("UPPER(fulladdr) LIKE '1201 %KERRIA%' AND UPPER(municipality) LIKE '%MCALLEN%'"), [['fulladdr', 'LIKE', '1201 %KERRIA%'], ['municipality', 'LIKE', '%MCALLEN%']])
})

test('addresses: the number and the street core in every common spelling', () => {
  assert.deepEqual(parseAddress('1201 Kerria Ave, McAllen, TX 78501'), { number: '1201', street: 'KERRIA' })
  assert.deepEqual(parseAddress('5435 Curtis Clark Drive, Corpus Christi TX'), { number: '5435', street: 'CURTIS CLARK' })
  assert.deepEqual(parseAddress('1300 N 10th St, McAllen'), { number: '1300', street: '10TH' })
  assert.deepEqual(parseAddress('Kerria Ave'), { number: null, street: null })
  assert.equal(normalizeSitus('36 Melissa Drive, Brownsville, TX 78526'), '36 MELISSA DR, BROWNSVILLE'.replace(',', '').replace('  ', ' ').replace('DR BROWNSVILLE', 'DR BROWNSVILLE'))
  assert.equal(normalizeSitus('1201 KERRIA AVE, MCALLEN TX'), '1201 KERRIA AVE MCALLEN')
})

test('the three acceptance addresses resolve to one parcel each with the legal, ids, edges and area the brief quotes', async () => {
  const { parcels } = services()
  const want = Object.fromEntries(TEST_ADDRESSES.map((t) => [t.address, t]))
  const k = await parcels.lookup({ address: '1201 Kerria Ave, McAllen, TX 78501' })
  assert.equal(k.match, 'one')
  assert.equal(k.matchedBy, 'address-point', 'Hidalgo: fulladdr + municipality → parcel_id')
  assert.equal(k.propId, '255056')
  assert.equal(k.geoId, 'P2500-00-004-0007-00')
  assert.match(k.legal, want[k.address].expect.legal)
  assert.equal(k.edges.length, 4)
  assert.ok(k.areaSf >= 10324 && k.areaSf <= 10532, `area ${k.areaSf}`)
  assert.ok(k.closure <= 0.1)
  assert.equal(k.county, 'Hidalgo County')
  assert.equal(k.calls.length, 4)
  assert.equal(typeof k.frontEdge, 'number')
  assert.ok(k.interior && Math.abs(k.interior.lat - kerria.point.lat) < 1e-4)
  const m = await parcels.lookup({ address: '36 Melissa Dr, Brownsville, TX 78526' })
  assert.equal(m.match, 'one')
  assert.equal(m.matchedBy, 'situs', 'Cameron: no address points; situsdispl LIKE')
  assert.match(m.legal, /MCKENZIE ESTATES LOT 16 BLK 1/)
  assert.equal(m.edges.length, 5)
  assert.ok(m.areaSf >= 8042 && m.areaSf <= 8204, `area ${m.areaSf}`)
  assert.notEqual(m.situs, '1021 CLARISSA DR', 'the buffer\'s nearest neighbour is never returned for the address')
  const c = await parcels.lookup({ address: '5435 Curtis Clark Dr, Corpus Christi, TX 78412' })
  assert.equal(c.match, 'one')
  assert.equal(c.matchedBy, 'situs', 'Nueces (BIS schema): situs_num = and situs_street LIKE')
  assert.match(c.legal, /GARDENDALE 2 SE\/2 OF LT 8 BK 5/)
  assert.ok(c.areaSf >= 9384 && c.areaSf <= 9574, `area ${c.areaSf}`)
  assert.equal(c.cleaned.short, 1, 'the 0.6 ft edge was removed')
  assert.equal(c.edges.length, 4)
  assert.notEqual(c.situs.slice(0, 4), '5402')
  assert.equal(c.cityLimits, 'CORPUS CHRISTI')
  // owner and mailing come back from the service (redacted in the fixture) and are stripped by the route, not here
  assert.equal(m.owner, 'REDACTED')
  // the parcel as a lot: kind parcel, the rules resolved on its own dims, the drafter's checks
  const lot = buildLot({ kind: 'parcel', calls: k.calls, front: k.frontEdge, streets: [{ edge: k.frontEdge, name: 'Kerria Ave' }], city: 'mcallen', setbacks: {}, legal: k.legal, propId: k.propId })
  assert.equal(lot.kind, 'parcel')
  assert.equal(lot.confirmed, false, 'a parcel lot waits for the drafter like a plat')
  assert.ok(Math.abs(lot.areaSf - 10428) < 30)
  assert.equal(lot.rules.front, 20)
  assert.equal(lot.rules.side, 5)
  assert.ok(lot.dims.width > 79 && lot.dims.width < 81, `front edge ${lot.dims.width} ft is the lot width`)
  assert.ok(lot.dims.depth > 129 && lot.dims.depth < 132)
  assert.ok(lot.envelopeSf > 0)
  assert.equal(lot.unplatted, false)
  assert.ok(lot.rulesUsed.length >= 9)
})

test('with only a point, the 40 m buffer lists the nearest parcels for the client to tap and never picks one (1021 Clarissa Dr sits first)', async () => {
  const { parcels } = services()
  const r = await parcels.lookup({ lat: melissa.census.coordinates.y, lon: melissa.census.coordinates.x, county: 'Cameron County' })
  assert.equal(r.match, 'none')
  assert.equal(r.candidates[0].situs, '1021 CLARISSA DR', 'the nearest centre is the neighbour across the street')
  assert.equal(r.candidates[1].situs, '36 MELISSA DR')
  assert.ok(r.candidates[0].distanceFt < r.candidates[1].distanceFt)
  assert.ok(!('owner' in r.candidates[0]))
  // the client taps the right one
  const pick = await parcels.byId({ county: 'Cameron County', propId: r.candidates[1].propId })
  assert.equal(pick.match, 'one')
  assert.equal(pick.matchedBy, 'pick')
  assert.match(pick.legal, /LOT 16 BLK 1/)
  await assert.rejects(parcels.byId({ county: 'Cameron County', propId: 'nope' }), /parcel not found/)
  await assert.rejects(parcels.byId({ county: 'Travis County', propId: '1' }), /no parcel source/)
})

test('an unplatted tract and an address the geocoder does not know', async () => {
  const { parcels } = services()
  const r = await parcels.lookup({ address: '4400 Ranch Rd, Rio Grande City, TX 78582' })
  assert.equal(r.match, 'one')
  assert.match(r.legal, /ABST 91/)
  const lot = buildLot({ kind: 'parcel', calls: r.calls, front: r.frontEdge, streets: [{ edge: r.frontEdge, name: 'Ranch Rd' }], city: 'riograndecity', setbacks: {}, legal: r.legal })
  assert.equal(lot.unplatted, true)
  assert.ok(lot.flags.some((f) => /platting needed/.test(f)))
  const none = await parcels.lookup({ address: '999 Nowhere Ln, Austin, TX' })
  assert.equal(none.match, 'none')
  assert.equal(none.reason, 'the address was not found')
  await assert.rejects(parcels.lookup({}), /address, or lat and lon, required/)
  await assert.rejects(parcels.lookup({ address: 'x'.repeat(201) }), /too long/)
})

test('cache 30 days, the circuit breaker after three failures, the fallback URL when the monthly service name moved', async () => {
  const s1 = services()
  const a = await s1.parcels.lookup({ address: '1201 Kerria Ave, McAllen, TX 78501' })
  assert.ok(!a.cached)
  const b = await s1.parcels.lookup({ address: '1201  kerria ave, mcallen, tx 78501' })
  assert.equal(b.cached, true, 'spacing and case do not miss the cache')
  assert.equal(s1.store._m.has('parcel:1201 kerria ave, mcallen, tx 78501'), true)
  // Cameron's hosted layer renamed: the first URL fails, the fallback answers, and the breaker does not count it
  const s2 = services({ failUrls: ['CameronCAD_Parcels_Sep2026'] })
  const m = await s2.parcels.lookup({ address: '36 Melissa Dr, Brownsville, TX 78526' })
  assert.equal(m.match, 'one')
  assert.equal(m.tried.length, 1)
  assert.match(m.tried[0].error, /500/)
  assert.equal(s2.parcels._breaker.get('cameron-cobgis')?.openUntil || 0, 0, 'a fallback that worked is not a source failure')
  // every URL of a source dead three times in ten minutes: the breaker opens and the source is skipped
  const s3 = services({ failUrls: ['cobgis.brownsvilletx.gov', 'services2.arcgis.com'] })
  for (let i = 0; i < 3; i++) await assert.rejects(s3.parcels.lookup({ address: '36 Melissa Dr, Brownsville, TX 78526', force: true }), /did not answer/)
  assert.ok(s3.parcels._breaker.get('cameron-cobgis').openUntil > Date.now())
  assert.ok(s3.log.some((l) => /skipped for 10 minutes/.test(l)))
  await assert.rejects(s3.parcels.lookup({ address: '36 Melissa Dr, Brownsville, TX 78526', force: true }), (e) => e.tried?.[0]?.skipped === 'circuit open')
  const h = await s3.parcels.health()
  assert.equal(h.sources.find((x) => x.id === 'cameron-cobgis').circuitOpen, true)
  assert.equal(h.failures, 4)
})

test('Regrid stays dormant without REGRID_API_TOKEN; with one it is called last, counted against the cap, and the token is never logged', async () => {
  let regridCalls = 0
  let urlsSeen = []
  const base = fixtureFetch(FIX)
  const fetchImpl = async (url, opts) => {
    urlsSeen.push(String(url))
    if (String(url).includes('app.regrid.com')) {
      regridCalls++
      return new Response(JSON.stringify({ parcels: { type: 'FeatureCollection', features: [] } }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return base(url, opts)
  }
  const dormant = services({ fetchImpl })
  await dormant.parcels.lookup({ address: '999 Nowhere Ln, Austin, TX' })
  assert.equal(regridCalls, 0, 'no token, no Regrid')
  const on = services({ fetchImpl, env: { REGRID_API_TOKEN: 'rg-secret-TESTONLY-123', REGRID_MONTHLY_CAP: '2' } })
  const miss = await on.parcels.lookup({ address: '4401 Ranch Rd, Rio Grande City, TX 78582' }) // Starr: the fixture has 4400, not 4401 → buffer gives candidates → Regrid tried
  assert.ok(regridCalls >= 1, 'Regrid tried after the free sources found nothing exact')
  assert.ok(urlsSeen.some((u) => u.includes('token=rg-secret-TESTONLY-123')), 'the token travels only in the request')
  assert.ok(!on.log.some((l) => l.includes('rg-secret')), 'and never in a log line')
  assert.ok(!JSON.stringify(miss).includes('rg-secret'), 'nor in the answer')
  const h = await on.parcels.health()
  assert.equal(h.regrid.enabled, true)
  assert.equal(h.regrid.cap, 2)
  assert.ok(!JSON.stringify(h).includes('rg-secret'))
})

test('the daily check runs the three addresses against the sources (not the cache) and records the result', async () => {
  const { parcels, store } = services()
  const emails = []
  const rec = await parcels.dailyCheck({ email: async (s, t) => emails.push({ s, t }) })
  assert.equal(rec.ok, true)
  assert.equal(rec.results.length, 3)
  assert.deepEqual(rec.results.map((r) => r.ok), [true, true, true])
  assert.equal(emails.length, 0)
  assert.equal((await store.meta.get('parcels:daily')).failedDays, 0)
  // a dead county: the check fails, counts the day and emails the office
  const dead = services({ failUrls: ['gis.rgv911.org'] })
  const r2 = await dead.parcels.dailyCheck({ email: async (s, t) => emails.push({ s, t }) })
  assert.equal(r2.ok, false)
  assert.equal(r2.failedDays, 1)
  assert.equal(emails.length, 1)
  assert.match(emails[0].s, /daily check/)
  assert.match(emails[0].t, /FAIL 1201 Kerria Ave/)
  assert.ok(!/token/i.test(emails[0].t.replace('REGRID_API_TOKEN', '')))
})

test('every live source is listed with the fields it answers; StratMap is disabled with the reason; the dormant ones say why', () => {
  const live = PARCEL_SOURCES.filter((s) => s.kind === 'arcgis' && !s.disabled)
  assert.equal(live.length, 8)
  for (const s of live) {
    assert.ok(s.fields.propId && s.fields.legal, `${s.id} names its prop_id and legal fields`)
    assert.ok(s.fields.situs || s.fields.situsParts || (s.fields.situsNum && s.fields.situsStreet), `${s.id} can read a situs`)
    assert.equal(s.checkedAt, '2026-11-17')
  }
  assert.equal(sourcesFor('Cameron County')[0].headers['User-Agent'].length > 0, true, 'Cameron answers 403 without one')
  assert.match(PARCEL_SOURCES.find((s) => s.id === 'txgio-stratmap').disabled, /not supported/)
  assert.match(PARCEL_SOURCES.find((s) => s.id === 'regrid').dormant, /REGRID_API_TOKEN/)
  assert.match(PARCEL_SOURCES.find((s) => s.id === 'cad-postgis').dormant, /CAD_POSTGIS/)
  assert.equal(sourcesFor('Travis County').length, 0)
})

// ── over HTTP: owner and mailing are drafter-only; the sources page is drafter-only ─────────────────────
async function startServer(t, env = {}) {
  const port = 8800 + Math.floor(Math.random() * 150)
  const base = `http://localhost:${port}`
  const proc = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, DRAFTHOUSE_FIXTURES: '1', DRAFTHOUSE_CLAUDE_KEY: '', ANTHROPIC_API_KEY: '', DATABASE_URL: '', SUPABASE_URL: '', RESEND_API_KEY: '', DRAFTHOUSE_APP_KEY: '', DRAFTHOUSE_WORKER_KEY: 'test-worker-key', DRAFTHOUSE_DRAFTERS: 'maria@drafthouse.test', REGRID_API_TOKEN: '', PORT: String(port), DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dh-r7-')), ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
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
  return { base, log: () => out }
}
async function who(base, email) {
  const r = await fetch(base + '/api/auth/dev-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, name: email.split('@')[0] }) })
  const { token } = await r.json()
  const h = { 'content-type': 'application/json', authorization: `Bearer ${token}` }
  return { get: (p) => fetch(base + p, { headers: h }), post: (p, b = {}) => fetch(base + p, { method: 'POST', headers: h, body: JSON.stringify(b) }), put: (p, b = {}) => fetch(base + p, { method: 'PUT', headers: h, body: JSON.stringify(b) }) }
}

test('HTTP: owner names and mailing addresses are drafter-only; the sources page and the forced refresh are drafter-only; a token never appears in a log line', async (t) => {
  const { base, log } = await startServer(t)
  const ana = await who(base, 'ana@example.com')
  const maria = await who(base, 'maria@drafthouse.test')
  const q = '/api/lot/parcel?address=' + encodeURIComponent('36 Melissa Dr, Brownsville, TX 78526')
  const anon = await (await fetch(base + q)).json()
  assert.equal(anon.match, 'one')
  assert.ok(!('owner' in anon) && !('mailing' in anon) && !('attributes' in anon), 'anonymous: stripped')
  const client = await (await ana.get(q)).json()
  assert.ok(!('owner' in client) && !('mailing' in client) && !('attributes' in client), 'signed-in client: stripped')
  assert.equal(client.legal, 'MCKENZIE ESTATES LOT 16 BLK 1')
  const drafter = await (await maria.get(q)).json()
  assert.equal(drafter.owner, 'REDACTED', 'drafter: the owner of record is there (redacted in the fixture)')
  assert.equal(drafter.mailing, 'REDACTED')
  const byId = await (await ana.get('/api/lot/parcel/Cameron%20County/7201140')).json()
  assert.ok(!('owner' in byId))
  const byIdD = await (await maria.get('/api/lot/parcel/Cameron%20County/7201140')).json()
  assert.equal(byIdD.owner, 'REDACTED')
  // the candidates list is stripped too
  const cands = await (await ana.get(`/api/lot/parcel?lat=${melissa.census.coordinates.y}&lon=${melissa.census.coordinates.x}`)).json()
  assert.equal(cands.match, 'none')
  assert.ok(cands.candidates.every((c) => !('owner' in c)))
  assert.equal((await ana.get('/api/admin/sources')).status, 403)
  const src = await (await maria.get('/api/admin/sources')).json()
  assert.equal(src.sources.length, PARCEL_SOURCES.length)
  assert.equal(src.regrid.enabled, false)
  assert.equal(src.fixtures, true)
  const chk = await (await maria.post('/api/admin/sources/check')).json()
  assert.equal(chk.ok, true)
  assert.equal((await ana.post('/api/admin/sources/check')).status, 403)
  assert.equal((await fetch(base + '/api/lot/parcel?address=' + 'x'.repeat(201))).status, 400)
  assert.ok(!/token=/.test(log()), 'no token in the server log')
  assert.ok(!/REDACTED/.test(log()), 'no owner field in the server log')
})
