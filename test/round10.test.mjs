// Fix round 10 (the architect's live review of PR #9, Nov 19 2026). Each item's test fails on round 9's code and
// passes on this one. Everything here runs on the live recordings in test/fixtures/parcels: no network.
//   1  the street side of a lot is the edge on the named road (TIGERweb), on all nine reviewed lots; the fallbacks;
//      corner lots; a curved frontage; a lot the setbacks leave no room on is still built, never replaced
//   2  every test that starts the server starts it on the fixtures, and a real host is refused without LIVE=1
//   3  the geocoder matched another address than the one typed: said so, and no parcel until the homeowner agrees
//   4  zoning warns on the plan and blocks Send only for a confirmed lot (the HTTP flow)
//   5  the owner and mailing columns as the live layers spell them; the mapped-column check
//   6  an outside service that drops the connection is a 502 with a plain line, never a 500
//   7  the owner gate is tested on a made-up owner (parcels.test.mjs); the recordings carry none
//   8  chat: bigger then smaller on the server path; the swap sentence; nothing of the validator's text in a reply
//   9  the geocode, flood, zoning and wind routes need a signed-in user and are limited
//   10 x-forwarded-for is trusted only behind a known proxy; empty limiter keys are dropped
//   11 a large commercial tract stays flagged large
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { makeParcels, frontFromRoads, kindsFromFront, edgeNearPoint, edgeFrames, streetCore, streetSuffix, sameStreet, projectRing, cleanRing, attr, COUNTY_DOWN } from '../server/parcels.mjs'
import { makeLots, addressMismatch, addressParts, FEMA_DOWN, CENSUS_DOWN } from '../server/lots.mjs'
import { makeZoning, ZONING_DOWN } from '../server/zoning.mjs'
import { fixtureFetch, loadFixtures, guardNetwork, LAYERS } from '../server/fixtures.mjs'
import { PARCEL_SOURCES, ROAD_SOURCE, TEST_ADDRESSES } from '../server/parcel-sources.mjs'
import { clientIp, makeWindow } from '../server/net.mjs'
import { buildLot, lotProblem, zoningBlocksSend } from '../src/draft/lib/lot.js'
import { parcelSpec } from '../src/draft/lib/parcel-spec.js'
import { interpretRequest, problemWords } from '../src/draft/lib/interpret.js'
import { generateRooms, DEFAULT_PROGRAM, kitFor } from '../src/draft/lib/layout.js'
import { checkRules } from '../src/draft/lib/rules.js'
import { fitsLot } from '../src/draft/lib/fit.js'
import { STYLES } from '../src/draft/lib/styles.js'
import { fixtureEnv, LIVE } from './server-env.mjs'

const FIX = loadFixtures()
const fx = (slug) => FIX.find((f) => f.slug === slug)
const memStore = () => {
  const m = new Map()
  return { meta: { get: async (k) => (m.has(k) ? m.get(k) : null), set: async (k, v) => m.set(k, v) }, _m: m }
}
const services = (opts = {}) => {
  const store = memStore()
  const log = []
  const fetchImpl = opts.fetchImpl || fixtureFetch(opts.fixtures || FIX, { failUrls: opts.failUrls || [], throwUrls: opts.throwUrls || [] })
  const lots = makeLots({ store, fetchImpl, files: {}, interpreter: {}, event: async () => {}, log: (m) => log.push(m) })
  const parcels = makeParcels({ store, fetchImpl, geocode: (a) => lots.geocode(a), log: (m) => log.push(m), env: {}, event: async () => {}, sources: opts.sources, ...(opts.roads !== undefined ? { roads: opts.roads } : {}) })
  const zoning = makeZoning({ store, fetchImpl, log: (m) => log.push(m) })
  return { store, lots, parcels, zoning, log }
}
const style = STYLES.find((s) => s.ready) || STYLES[0]

// ── item 1: the street side ──────────────────────────────────────────────────────────────────────────
// the nine lots of the review, with the street side the code gave on round 9 and the one measured against the road
const NINE = [
  ['1201 Kerria Ave, McAllen, TX 78501', 79.6],
  ['36 Melissa Dr, Brownsville, TX 78526', 63.4],
  ['5435 Curtis Clark Dr, Corpus Christi, TX 78412', 31.1],
  ['3305 N 27th St, McAllen, TX 78501', 65.1],
  ['1534 Armagoza Dr, Edinburg, TX 78541', 67.3],
  ['3013 Yvonne St, Edinburg, TX 78542', 54.8],
  ['2218 Royal Palm Dr, Mission, TX 78572', 80.1],
  ['2454 E 30th St, Brownsville, TX 78521', 50.1],
  ['4175 Sierra Madre Dr, Brownsville, TX 78521', 49.9],
]

test('1: on all nine reviewed lots the street side is the edge on the named road, within half a foot of the measured frontage', async () => {
  const { parcels } = services()
  assert.equal(TEST_ADDRESSES.filter((t) => t.expect.frontFt).length, 9, 'all nine are in the acceptance set with frontFt')
  for (const [address, trueFt] of NINE) {
    assert.ok(TEST_ADDRESSES.some((t) => t.address === address && t.expect.frontFt), `${address} is in TEST_ADDRESSES`)
    const r = await parcels.lookup({ address })
    assert.equal(r.match, 'one', address)
    const f = r.edges[r.frontEdge].lengthFt
    assert.ok(Math.abs(f - trueFt) <= 0.5, `${address}: street side ${f} ft, measured ${trueFt} ft`)
    assert.equal(r.frontBy, 'named-road', address)
    assert.ok(r.frontDistFt >= 12 && r.frontDistFt <= 45, `${address}: the road's centreline is ${r.frontDistFt} ft from the frontage`)
    assert.equal(r.edgeKinds[r.frontEdge], 'front')
    assert.equal(r.edgeKinds.filter((k) => k === 'rear').length, 1, `${address}: one rear edge on a four-sided lot`)
    assert.equal(r.roads.source, 'tigerweb-roads')
    // the front is stored with the parcel: a second lookup is the cache, with the same front
    const again = await parcels.lookup({ address })
    assert.equal(again.cached, true)
    assert.equal(again.frontEdge, r.frontEdge)
  }
})

test('1: what round 9 did (the edge facing the Census point) is wrong on seven of the nine, which is why it is now only the last fallback', async () => {
  // with the road map off, the pipeline falls back: the county address point when it sits by an edge, else the Census point
  const { parcels, log } = services({ failUrls: ['tigerweb.geo.census.gov'] })
  let wrong = 0
  for (const [address, trueFt] of NINE) {
    const r = await parcels.lookup({ address })
    assert.equal(r.match, 'one', address)
    assert.notEqual(r.frontBy, 'named-road', address)
    assert.ok(['census-point', 'address-point'].includes(r.frontBy), `${address}: ${r.frontBy}`)
    assert.equal(r.roads.answered, false)
    if (Math.abs(r.edges[r.frontEdge].lengthFt - trueFt) > 1) wrong++
  }
  assert.ok(wrong >= 5, `${wrong} of 9 fronts are wrong without the road map (the review counted 7 on the Census point alone)`)
  assert.ok(log.some((l) => /Census TIGERweb roads did not answer/.test(l)), 'the fallback is logged for the sources page')
  const h = await parcels.health()
  assert.equal(h.sources.find((s) => s.id === 'tigerweb-roads').last.ok, false)
})

test('1: street names match without directions and suffixes; the suffix decides between two roads of one name', () => {
  assert.equal(streetCore('N 27th St'), '27TH')
  assert.equal(streetCore('5435 Curtis Clark Dr'), 'CURTIS CLARK')
  assert.equal(streetCore('E Griffin Pkwy'), 'GRIFFIN')
  assert.equal(streetCore('1201 1st St'), '1ST')
  assert.equal(streetCore('Kerria Avenue'), 'KERRIA')
  assert.equal(streetSuffix('Kerria Avenue'), 'AVE')
  assert.equal(streetSuffix('N 27th Cir'), 'CIR')
  assert.equal(streetSuffix('Broadway'), null)
  assert.ok(sameStreet({ name: 'N Armagoza Dr', base: 'Armagoza' }, 'ARMAGOZA'))
  assert.ok(sameStreet({ name: 'E Yvonne St', base: 'Yvonne' }, 'Yvonne Street'))
  assert.ok(sameStreet({ name: 'FM 495', base: '495' }, 'FM 495'))
  assert.ok(!sameStreet({ name: 'N 12th St', base: '12th' }, 'KERRIA'))
  assert.ok(!sameStreet({ name: null, base: null }, 'KERRIA'))
  // 3305 N 27th St: N 27th St, N 27th Cir and N 27th 1/2 St are all near; the lot fronts on the St
  const f = fx('n-27th-3305-mcallen')
  const names = f.roads.map((r) => r.properties.NAME)
  assert.ok(names.includes('N 27th St') && names.includes('N 27th Cir') && names.includes('N 27th 1/2 St'), names.join(', '))
  assert.equal(f.expect.frontStreet, 'N 27th St')
})

test('1: the front picker on plain shapes: nearest midpoint facing the road, the shorter edge on a tie, corner and through lots, a curved frontage', () => {
  // an 80 x 130 lot, clockwise with north up; the street runs along the south side 30 ft out
  const lot = cleanRing([[0, 0], [80, 0], [80, 130], [0, 130]]).pts
  const south = { name: 'Elm St', base: 'Elm', suffix: 'St', layer: 8, lines: [[[-200, -30], [300, -30]]] }
  const west = { name: 'N 2nd St', base: '2nd', suffix: 'St', layer: 8, lines: [[[-25, -200], [-25, 400]]] }
  const north = { name: 'Oak Ave', base: 'Oak', suffix: 'Ave', layer: 8, lines: [[[-200, 160], [300, 160]]] }
  const far = { name: 'Pine St', base: 'Pine', suffix: 'St', layer: 8, lines: [[[200, -200], [200, 400]]] }
  const lenOf = (pts, i) => edgeFrames(pts)[i].len
  const one = frontFromRoads(lot, [south, far], { streets: ['ELM'] })
  assert.equal(Math.round(lenOf(lot, one.frontEdge)), 80)
  assert.equal(one.frontStreet, 'Elm St')
  assert.equal(one.frontDistFt, 30)
  assert.equal(one.corner, false, 'a road 120 ft away is not a side street')
  assert.deepEqual([...one.edgeKinds].sort(), ['front', 'rear', 'side', 'side'])
  assert.equal(one.frontWidthFt, 80)
  // a corner lot: a second named road along the west side takes the street-side setback
  const corner = frontFromRoads(lot, [south, west], { streets: ['ELM'] })
  assert.equal(corner.corner, true)
  assert.deepEqual(corner.streets.map((s) => `${s.name}:${s.role}`), ['Elm St:front', 'N 2nd St:side'])
  assert.equal(corner.edgeKinds.filter((k) => k === 'streetSide').length, 1)
  assert.equal(Math.round(lenOf(lot, corner.edgeKinds.indexOf('streetSide'))), 130)
  // the same lot addressed on the side street: the 130 ft side is the front (the address decides, not the shape)
  const turned = frontFromRoads(lot, [south, west], { streets: ['2ND'] })
  assert.equal(Math.round(lenOf(lot, turned.frontEdge)), 130)
  assert.equal(turned.corner, true)
  // a street behind the lot is a through lot, not a corner
  const through = frontFromRoads(lot, [south, north], { streets: ['ELM'] })
  assert.equal(through.corner, false)
  assert.deepEqual(through.streets.map((s) => s.role), ['front', 'rear'])
  // a second name on the same centreline (S 10th St is also State Hwy 336) is not a side street
  const alias = { name: 'State Hwy 9', base: '9', suffix: null, layer: 6, lines: south.lines }
  assert.equal(frontFromRoads(lot, [south, alias], { streets: ['ELM'] }).corner, false)
  // a road that carries the name but no typed street: found from the parcel's situs
  assert.equal(frontFromRoads(lot, [south, west], { streets: [], situs: '12 ELM ST SOMEWHERE' }).frontStreet, 'Elm St')
  // no road of that name: null, and the caller falls back
  assert.equal(frontFromRoads(lot, [west], { streets: ['ELM'], situs: '12 ELM ST SOMEWHERE' }), null)
  assert.equal(frontFromRoads(lot, [], { streets: ['ELM'] }), null)
  // a square lot on a corner where both roads sit the same distance out: the tie goes to the named road, and between
  // two edges on that road at the same distance, to the shorter one
  const sliver = cleanRing([[0, 0], [31, 0], [31, 300], [0, 300]]).pts
  const bend = { name: 'Curtis Clark Dr', base: 'Curtis Clark', suffix: 'Dr', layer: 8, lines: [[[-33, 400], [-33, -33], [200, -33]]] }
  const s = frontFromRoads(sliver, [bend], { streets: ['CURTIS CLARK'] })
  assert.equal(Math.round(lenOf(sliver, s.frontEdge)), 31, 'the road runs along the 300 ft side and the 31 ft end at the same distance: the shorter edge')
  // a curved frontage in three chords: all three front on the street, and the lot's width is their total
  const cul = cleanRing([[0, 0], [20, -8], [45, -8], [65, 0], [65, 110], [0, 110]]).pts
  const arc = { name: 'Bay Ct', base: 'Bay', suffix: 'Ct', layer: 8, lines: [[[-40, -22], [20, -36], [45, -36], [105, -22]]] }
  const c = frontFromRoads(cul, [arc], { streets: ['BAY'] })
  assert.equal(c.edgeKinds.filter((k) => k === 'front').length, 3)
  assert.ok(Math.abs(c.frontWidthFt - (Math.hypot(20, 8) * 2 + 25)) < 0.1, `width ${c.frontWidthFt}`)
  // the fallbacks on shapes: an address point by an edge picks it; one in the middle of the lot says nothing
  assert.equal(Math.round(lenOf(lot, edgeNearPoint(lot, [40, 12]))), 80)
  assert.equal(edgeNearPoint(lot, [40, 65]), null)
  assert.deepEqual(kindsFromFront(lot, edgeNearPoint(lot, [40, 12])).filter((k) => k === 'rear').length, 1)
})

test('1: corner lots from the recordings; the side street takes the street-side setback (round 9 item 17)', async () => {
  const { parcels } = services()
  const k = await parcels.lookup({ address: '1201 Kerria Ave, McAllen, TX 78501' })
  assert.equal(k.corner, true)
  assert.deepEqual(k.streets.map((s) => `${s.name}:${s.role}`), ['Kerria Ave:front', 'N 12th St:side'])
  const spec = parcelSpec(k, { address: k.address, city: 'mcallen', county: 'Hidalgo County', geo: { street: 'KERRIA AVE' } })
  assert.equal(spec.cornerLot, true)
  assert.deepEqual(spec.streets, [{ edge: k.frontEdge, name: 'Kerria Ave' }, { edge: k.streets[1].edge, name: 'N 12th St' }])
  const lot = buildLot(spec)
  assert.equal(lot.corner, true)
  const side = lot.edges[k.streets[1].edge]
  assert.equal(side.kind, 'streetSide')
  assert.equal(side.street, 'N 12th St')
  assert.equal(side.setback, lot.rules.streetSide)
  assert.equal(lot.edges[k.frontEdge].kind, 'front')
  assert.equal(lot.streets.length, 2, 'both streets are drawn')
  assert.ok(lot.envelopeSf > 4000, `envelope ${lot.envelopeSf}`)
  // a lot that is not on a corner has one street and no street side
  const a = await parcels.lookup({ address: '1534 Armagoza Dr, Edinburg, TX 78541' })
  assert.equal(a.corner, false)
  assert.equal(buildLot(parcelSpec(a, { address: a.address, city: 'edinburg', county: 'Hidalgo County' })).corner, false)
  // 2218 Royal Palm Dr sides on E Griffin Pkwy (a secondary road, layer 6); 2200 S 10th St is not a corner on its own alias
  const rp = await parcels.lookup({ address: '2218 Royal Palm Dr, Mission, TX 78572' })
  assert.ok(rp.streets.some((s) => s.role === 'side' && /Griffin/.test(s.name)))
  const plaza = await parcels.lookup({ address: '2200 S 10th St, McAllen, TX 78503' })
  assert.ok(!plaza.streets.some((s) => /Hwy 336/.test(s.name)), 'State Hwy 336 is S 10th St under another name')
})

test('1: Armagoza and Curtis Clark as lots: the house faces the street, and the sliver is built as a sliver', async () => {
  const { parcels } = services()
  const a = await parcels.lookup({ address: '1534 Armagoza Dr, Edinburg, TX 78541' })
  const lotA = buildLot(parcelSpec(a, { address: a.address, city: 'edinburg', county: 'Hidalgo County' }))
  assert.ok(lotA.dims.width > 66 && lotA.dims.width < 69, `width ${lotA.dims.width}`)
  assert.ok(lotA.dims.depth > 138 && lotA.dims.depth < 142, `depth ${lotA.dims.depth}`)
  // the review: with the 140 ft side on the street the buildable area collapsed to 3,519 sf
  assert.ok(lotA.envelopeSf > 5000, `buildable area ${Math.round(lotA.envelopeSf)} sf`)
  assert.equal(lotProblem(lotA.spec, lotA), null)
  const c = await parcels.lookup({ address: '5435 Curtis Clark Dr, Corpus Christi, TX 78412' })
  const lotC = buildLot(parcelSpec(c, { address: c.address, city: 'corpuschristi', county: 'Nueces County' }))
  assert.ok(lotC.dims.width > 30 && lotC.dims.width < 33 && lotC.dims.depth > 295, `${lotC.dims.width} x ${lotC.dims.depth}`)
  assert.ok(Math.abs(lotC.areaSf - 9505) < 20, 'the 31 x 300 parcel, not a typed 100 x 150 lot')
  assert.ok(lotC.envelopeSf > 3000, `the envelope is a strip, not empty: ${Math.round(lotC.envelopeSf)} sf`)
  // the same parcel with the 300 ft side as the front (round 9): the setbacks leave nothing, and the lot is still built
  const wrongFront = c.edges.findIndex((e) => e.lengthFt > 290)
  const bad = buildLot({ ...parcelSpec(c, { address: c.address, city: 'corpuschristi', county: 'Nueces County' }), front: wrongFront, kinds: kindsFromFront(cleanRing(projectRing(c.polygonWgs84).pts).pts, wrongFront), streets: [{ edge: wrongFront, name: 'Curtis Clark Dr' }] })
  assert.ok(bad.envelopeSf < 600, `front and rear setbacks on a 31 ft deep lot leave a strip of ${Math.round(bad.envelopeSf)} sf or nothing`)
  assert.equal(bad.boundary.length, 4, 'the parcel itself is still there to draw')
  assert.ok(Math.abs(bad.areaSf - 9505) < 20)
  assert.match(lotProblem(bad.spec, bad), /buildable area/)
  // and a lot the setbacks leave nothing at all on (a 15 ft strip) is built too, with an empty envelope, so it can be drawn red
  const strip = buildLot({ kind: 'parcel', city: 'mcallen', calls: [{ distance: 200, bearing: 'N 90 E' }, { distance: 15, bearing: 'S 0 E' }, { distance: 200, bearing: 'S 90 W' }, { distance: 15, bearing: 'N 0 E' }], front: 2, kinds: ['rear', 'side', 'front', 'side'], streets: [{ edge: 2, name: 'Elm St' }], setbacks: {} })
  assert.equal(strip.envelope.length, 0)
  assert.equal(strip.boundary.length, 4)
  assert.match(lotProblem(strip.spec, strip), /setbacks leave no buildable area/)
})

test('1: the Lot view draws the parcel even when the setbacks leave no room, marks it red and says why (source check)', () => {
  const lotJsx = fs.readFileSync('src/draft/screens/Lot.jsx', 'utf8')
  assert.match(lotJsx, /const drawAnyway = built && \(built\.kind === 'parcel' \|\| built\.kind === 'plat'\)/)
  assert.match(lotJsx, /const shown = lot \|\| \(drawAnyway \? built : lastGood\.current\)/, 'a parcel never falls back to the previous lot')
  assert.match(lotJsx, /lotProblem=\{problem && drawAnyway/)
  const site = fs.readFileSync('src/components/SitePlan.jsx', 'utf8')
  assert.match(site, /E\.length < 3 \? \[\]/, 'an empty envelope no longer throws in the scene')
  assert.match(site, /bad=\{!!problem\}/)
})

// ── item 2: hermetic tests ───────────────────────────────────────────────────────────────────────────
test('2: every test that starts the office API starts it on the fixtures unless LIVE=1', () => {
  assert.deepEqual(fixtureEnv, LIVE ? {} : { DRAFTHOUSE_FIXTURES: '1' })
  const files = fs.readdirSync('test').filter((f) => f.endsWith('.mjs'))
  let spawns = 0
  for (const f of files) {
    const src = fs.readFileSync(path.join('test', f), 'utf8')
    for (const line of src.split('\n')) {
      if (!/spawn(Group)?\(/.test(line) || !/server\/index\.mjs/.test(line)) continue
      spawns++
      assert.ok(/\.\.\.fixtureEnv/.test(line) || /spawnGroup\(/.test(line), `${f}: a server is started without fixtureEnv: ${line.trim().slice(0, 120)}`)
    }
  }
  assert.ok(spawns >= 9, `${spawns} places start the server`)
  assert.match(fs.readFileSync('test/browser.mjs', 'utf8'), /env: \{ \.\.\.process\.env, \.\.\.fixtureEnv, \.\.\.env \}/, 'spawnGroup adds it for the browser tests')
  assert.match(JSON.parse(fs.readFileSync('package.json', 'utf8')).scripts.test, /--import \.\/test\/guard\.mjs/)
})

test('2: a non-LIVE run that reaches a real host is refused, naming the host; loopback passes; LIVE=1 turns the guard off', async (t) => {
  // this very process is guarded (test/guard.mjs)
  await assert.rejects(fetch('https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28?f=json'), (e) => e.code === 'DH_NETWORK_GUARD' && /hazards\.fema\.gov/.test(e.message) && /LIVE=1/.test(e.message))
  await assert.rejects(fetch(new URL('https://geocoding.geo.census.gov/geocoder/benchmarks')), (e) => e.code === 'DH_NETWORK_GUARD')
  // a fresh process: off with LIVE=1, on without, and an allow-listed host passes the guard
  const run = (env, code) => spawnSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, LIVE: '', DRAFTHOUSE_NET_ALLOW: '', ...env }, encoding: 'utf8' })
  const probe = "import { guardNetwork } from './server/fixtures.mjs'; const on = guardNetwork(); let out = 'guard ' + on; try { await fetch('http://127.0.0.1:9/') } catch (e) { out += ' loopback:' + (e.code === 'DH_NETWORK_GUARD' ? 'refused' : 'passed') } try { await fetch('https://example.invalid/') } catch (e) { out += ' real:' + (e.code === 'DH_NETWORK_GUARD' ? 'refused' : 'passed') } console.log(out)"
  assert.match(run({}, probe).stdout, /guard true loopback:passed real:refused/)
  assert.match(run({ LIVE: '1' }, "import { guardNetwork } from './server/fixtures.mjs'; console.log('guard ' + guardNetwork())").stdout, /guard false/)
  assert.match(run({ DRAFTHOUSE_NET_ALLOW: 'example.invalid' }, probe).stdout, /real:passed/)
  assert.equal(guardNetwork(), !LIVE)
})

// ── item 3: the geocoder matched another address ─────────────────────────────────────────────────────
test('3: 1300 W Nolana typed, 1300 E NOLANA found: the mismatch is named and no parcel is offered until it is confirmed', async () => {
  const { lots, parcels } = services()
  const geo = await lots.geocode('1300 W Nolana Ave, McAllen, TX 78504')
  assert.equal(geo.found, true)
  assert.match(geo.matched, /^1300 E NOLANA AVE/)
  assert.deepEqual(geo.mismatch.what, ['direction'])
  assert.equal(geo.mismatch.message, 'We found 1300 E Nolana Ave, not W. Is that right?')
  assert.equal(geo.mismatch.typedDirection, 'W')
  assert.equal(geo.mismatch.foundDirection, 'E')
  const held = await parcels.lookup({ address: '1300 W Nolana Ave, McAllen, TX 78504' })
  assert.equal(held.match, 'confirm-address')
  assert.equal(held.mismatch.message, geo.mismatch.message)
  assert.ok(!held.propId && !held.legal && !held.calls, 'no parcel, no legal, no outline')
  // once the homeowner says the found address is theirs, the parcel comes: the 4-acre commercial tract of the review
  const ok = await parcels.lookup({ address: '1300 W Nolana Ave, McAllen, TX 78504', confirmed: true })
  assert.equal(ok.match, 'one')
  assert.equal(ok.legal, 'NOLANA RETAIL LOT 1')
  assert.equal(ok.large, true)
  // an address that matched as typed is not held
  assert.equal((await lots.geocode('1201 Kerria Ave, McAllen, TX 78501')).mismatch, null)
  assert.equal((await lots.geocode('1534 Armagoza Dr, Edinburg, TX 78541')).mismatch, null, 'a direction the homeowner left out is not a mismatch')
  // the comparison itself
  assert.deepEqual(addressParts('1300 W Nolana Ave, McAllen'), { number: '1300', pre: 'W', street: 'NOLANA' })
  assert.deepEqual(addressParts('36 Melissa Drive'), { number: '36', pre: null, street: 'MELISSA' })
  assert.equal(addressMismatch('3305 N 27th St', '3305 N 27TH ST, MCALLEN, TX, 78501'), null)
  assert.deepEqual(addressMismatch('3307 N 27th St', '3305 N 27TH ST, MCALLEN, TX').what, ['number'])
  assert.equal(addressMismatch('1201 Keria Ave', '1201 KERRIA AVE, MCALLEN, TX').message, 'We found 1201 Kerria Ave, not 1201 Keria Ave. Is that right?')
  assert.deepEqual(addressMismatch('1300 West Nolana Avenue', '1300 E NOLANA AVE, MCALLEN, TX').what, ['direction'])
  assert.equal(addressMismatch('', '1300 E NOLANA AVE'), null)
})

// ── item 5: the owner and mailing columns ────────────────────────────────────────────────────────────
test('5: the mapped columns exist on every layer (the field check), and a wrong mapping is caught by name', async () => {
  const { parcels, store } = services()
  const ok = await parcels.checkFields()
  assert.equal(ok.ok, true, JSON.stringify(ok.rows.filter((r) => !r.ok)))
  assert.equal(ok.rows.length, 9, 'eight county sources and the road source')
  assert.ok(ok.rows.every((r) => !r.missing.length && !r.wrongType.length))
  assert.ok(ok.rows.find((r) => r.id === 'cameron-cobgis').otherCase.some((m) => /PROP_ID/.test(m)), "Cameron's third fallback spells its columns in another case")
  assert.equal((await store.meta.get('parcels:fields')).ok, true)
  assert.match(parcels.describe().detail, /mapped columns all present/)
  const h = await parcels.health()
  assert.equal(h.fieldCheck.ok, true)
  assert.equal(h.sources.find((s) => s.id === 'hidalgo-rgv911').fields.ok, true)
  // round 9's mapping for Hidalgo (owner_name, owner_addr) and Cameron (owner_addr): the check names each missing column
  const old = PARCEL_SOURCES.map((s) => (s.id === 'hidalgo-rgv911' ? { ...s, fields: { ...s.fields, owner: 'owner_name', mailing: 'owner_addr' }, types: {} } : s.id === 'cameron-cobgis' ? { ...s, fields: { ...s.fields, mailing: 'owner_addr' } } : s))
  const bad = services({ sources: old })
  const r = await bad.parcels.checkFields()
  assert.equal(r.ok, false)
  const hid = r.rows.find((x) => x.id === 'hidalgo-rgv911')
  assert.deepEqual(hid.missing, ['owner: owner_name', 'mailing: owner_addr'])
  assert.ok(hid.wrongType.some((m) => /prop_id is a number on the layer but is sent quoted/.test(m)))
  assert.ok(r.rows.find((x) => x.id === 'cameron-cobgis').missing.some((m) => /^mailing: owner_addr/.test(m)))
  assert.equal(bad.parcels.describe().ok, false)
  assert.match(bad.parcels.describe().detail, /mapped columns missing on hidalgo-rgv911, cameron-cobgis/)
  assert.ok(bad.log.some((l) => /no column for owner: owner_name/.test(l)))
  // the layer descriptions the check reads are the live ones
  const H = LAYERS['https://gis.rgv911.org/server/rest/services/RGV911_Web_Apps_MIL1/MapServer/7'].fields
  for (const k of ['file_as_name', 'addr_line1', 'addr_line2', 'addr_line3', 'addr_city', 'addr_state', 'zip']) assert.ok(k in H, k)
  assert.equal(H.prop_id, 'integer')
  // an attribute is read whatever the case the layer spells it in; a mailing address is joined in order, blanks left out
  assert.equal(attr({ PROP_ID: 7 }, 'prop_id'), 7)
  assert.equal(attr({ prop_id: 1, PROP_ID: 2 }, 'prop_id'), 1)
  assert.equal(attr({}, 'prop_id'), undefined)
})

test('5: a drafter gets the owner and the mailing address for a Hidalgo and a Cameron lot (made-up values through the fixture server)', async () => {
  const withOwner = services({ fetchImpl: fixtureFetch(FIX, { ownerSentinel: true }) })
  const k = await withOwner.parcels.lookup({ address: '1201 Kerria Ave, McAllen, TX 78501' })
  assert.equal(k.owner, 'SENTINEL OWNER 255056')
  assert.equal(k.mailing, 'PO BOX 0 SENTINEL 255056, NOWHERE, TX, 00000')
  const m = await withOwner.parcels.lookup({ address: '36 Melissa Dr, Brownsville, TX 78526' })
  assert.equal(m.owner, 'SENTINEL OWNER 144311')
  assert.equal(m.mailing, 'PO BOX 0 SENTINEL 144311, NOWHERE, TX, 00000')
  // on round 9's mapping the same lookups gave no owner at all
  const old = PARCEL_SOURCES.map((s) => (s.id === 'hidalgo-rgv911' ? { ...s, fields: { ...s.fields, owner: 'owner_name', mailing: 'owner_addr' } } : s))
  const before = services({ sources: old, fetchImpl: fixtureFetch(FIX, { ownerSentinel: true }) })
  assert.equal((await before.parcels.lookup({ address: '1201 Kerria Ave, McAllen, TX 78501' })).owner, null)
  // nothing of it in a log line
  assert.ok(!withOwner.log.join('\n').includes('SENTINEL'))
})

// ── item 6: an outside service that drops the connection ─────────────────────────────────────────────
test('6: FEMA, the Census, the county and a city zoning server dropping the connection are 502s with a plain line', async () => {
  const fema = services({ throwUrls: ['hazards.fema.gov'] })
  const pt = fx('curtis-clark-5435-corpus-christi').point
  await assert.rejects(fema.lots.floodAt(pt), (e) => e.status === 502 && e.message === FEMA_DOWN && e.message === 'FEMA did not answer; the office checks the flood zone')
  assert.ok(fema.log.some((l) => /FEMA NFHL layer \d+ did not answer \(ECONNRESET\)/.test(l)), 'the cause is in the log, not in the answer')
  const census = services({ throwUrls: ['geocoding.geo.census.gov'] })
  await assert.rejects(census.lots.geocode('1201 Kerria Ave, McAllen, TX'), (e) => e.status === 502 && e.message === CENSUS_DOWN)
  const zone = services({ throwUrls: ['gismap.mcallen.net'] })
  const kp = fx('kerria-1201-mcallen').point
  await assert.rejects(zone.zoning.lookup({ cityId: 'mcallen', lat: kp.lat, lon: kp.lon }), (e) => e.status === 502 && e.message === ZONING_DOWN)
  const county = services({ throwUrls: ['gis.rgv911.org'] })
  await assert.rejects(county.parcels.lookup({ address: '1201 Kerria Ave, McAllen, TX 78501' }), (e) => e.status === 502 && e.message === COUNTY_DOWN && !/fetch failed|ECONNRESET/.test(e.message))
  assert.ok(county.log.some((l) => /no source answered for Hidalgo County/.test(l)))
  // the road map dropping the connection is not an error at all: the front falls back
  const roads = services({ throwUrls: ['tigerweb.geo.census.gov'] })
  const r = await roads.parcels.lookup({ address: '1201 Kerria Ave, McAllen, TX 78501' })
  assert.equal(r.match, 'one')
  assert.notEqual(r.frontBy, 'named-road')
})

// ── items 10 and 11 ──────────────────────────────────────────────────────────────────────────────────
test('10: x-forwarded-for is read only behind a known proxy; a limiter key with an empty window is dropped', () => {
  const req = (xff, remote = '10.0.0.9') => ({ headers: xff ? { 'x-forwarded-for': xff } : {}, socket: { remoteAddress: remote } })
  // no trusted proxy: the header is ignored, whatever it says
  assert.equal(clientIp(req('1.2.3.4'), 0), '10.0.0.9')
  assert.equal(clientIp(req('1.2.3.4, 5.6.7.8')), '10.0.0.9')
  assert.equal(clientIp(req(null, '::ffff:192.168.1.5'), 0), '192.168.1.5')
  // one trusted proxy: the entry it wrote (the last one); a value the client put in front is not the address
  assert.equal(clientIp(req('203.0.113.7'), 1), '203.0.113.7')
  assert.equal(clientIp(req('6.6.6.6, 203.0.113.7'), 1), '203.0.113.7', 'a spoofed first entry is ignored')
  assert.equal(clientIp(req('6.6.6.6, 203.0.113.7, 172.16.0.1'), 2), '203.0.113.7')
  assert.equal(clientIp(req('', '10.0.0.9'), 1), '10.0.0.9', 'no header behind the proxy: the socket')
  // the window: counts, expires, and deletes the key
  let t = 1_000_000
  const w = makeWindow({ windowMs: 1000, limitFor: (k) => (k.includes(':ip:') ? 6 : 2), now: () => t })
  assert.equal(w.left('parcel:u:a'), 2)
  assert.equal(w.size(), 0, 'reading a key nobody counted does not create it')
  w.count('parcel:u:a')
  w.count('parcel:u:a')
  w.count('parcel:ip:1.1.1.1')
  assert.equal(w.left('parcel:u:a'), 0)
  assert.equal(w.left('parcel:ip:1.1.1.1'), 5)
  assert.equal(w.size(), 2)
  t += 1001
  assert.equal(w.left('parcel:u:a'), 2, 'the window passed')
  assert.equal(w.size(), 1, 'the key that was read is gone; the other waits for the sweep')
  assert.equal(w.prune(), 0)
  assert.equal(w.size(), 0)
  const idx = fs.readFileSync('server/index.mjs', 'utf8')
  assert.match(idx, /setInterval\(\(\) => lookups\.prune\(\), 600000\)\.unref\(\)/)
  assert.match(idx, /clientIp\(req, TRUST_PROXY_HOPS\)/)
  assert.doesNotMatch(idx, /req\.headers\['x-forwarded-for'\]/, 'the server no longer reads the header itself')
})

test('11: a large commercial tract is flagged large and the client card skips its edge list', async () => {
  const { parcels } = services()
  const plaza = await parcels.lookup({ address: '2200 S 10th St, McAllen, TX 78503' })
  assert.equal(plaza.large, true)
  assert.ok(plaza.edges.length > 400, `${plaza.edges.length} edges`)
  assert.ok(plaza.areaSf > 2_000_000)
  const pharr = await parcels.lookup({ address: '118 S Cage Blvd, Pharr, TX 78577' })
  assert.equal(pharr.large, false, '1.65 acres with 6 edges: not large; its zoning is what blocks it')
  const lotJsx = fs.readFileSync('src/draft/screens/Lot.jsx', 'utf8')
  assert.match(lotJsx, /parcel\.large \|\| zoning\?\.residential === false \? \(/, 'the edge list is skipped for a large tract or a lot that is not a house district')
  assert.match(lotJsx, /!parcel\.large && parcel\.corner/)
})

// ── item 8: chat ─────────────────────────────────────────────────────────────────────────────────────
test('8: a refusal never carries the validator\'s text or a bracket; a swap names both rooms and the real reason', async () => {
  const lot = buildLot({ kind: 'manual', width: 100, depth: 150, city: 'mcallen', setbacks: {} })
  const rooms = generateRooms(DEFAULT_PROGRAM, style, lot)
  const kit = kitFor(style)
  const offline = async () => {
    throw new Error('offline')
  }
  const ask = (text) => interpretRequest(text, rooms, DEFAULT_PROGRAM, style, { lot, interpreter: offline, report: false })
  const swap = await ask('swap the kitchen and the garage')
  assert.equal(swap.applied, false)
  assert.match(swap.reply, /^Swapping the kitchen and the 2-car garage does not work on this plan: the two rooms are too different in size to trade places\./)
  assert.doesNotMatch(swap.reply, /that room|bedroom's window|cannot grow that way|[()]/)
  assert.ok(swap.reasons.length >= 1, 'the validator reason is kept for the drafter log')
  for (const text of ['remove all the bedrooms', 'make the garage 10 feet wider', 'swap the primary bedroom and the living room', 'remove the kitchen', 'make the kitchen bigger and remove bedroom 3']) {
    const r = await ask(text)
    assert.doesNotMatch(r.reply, /[()]/, `${text}: ${r.reply}`)
    for (const raw of r.reasons || []) if (/door|window|reached|dryer|faces into/.test(raw)) assert.ok(!r.reply.includes(raw.replace(/\.$/, '')), `${text}: the reply quotes the validator: ${raw}`)
    assert.doesNotMatch(r.reply, /Jack & Jill door|opens to the outside \(|Closet has no door/)
  }
  // the words for a problem the plan already had
  assert.equal(problemWords(['Closet has no door.'], rooms, 'noun'), 'a room has no door, or a door that opens to the outside')
  assert.equal(problemWords(['Kitchen has no window.'], rooms, 'verb'), 'leaves the kitchen without a window')
  assert.equal(problemWords(['Nothing we know.'], rooms), null)
  // a request in parts: what was not done is named, the reason follows as its own sentence
  const two = await ask('make the kitchen bigger and remove bedroom 3')
  assert.equal(two.applied, true)
  assert.match(two.reply, /^Done: make the kitchen bigger\. Not done: remove bedroom 3\. Taking out the Bedroom 3 leaves rooms without a door/)
  assert.match(two.reply, /This counts as one change, for what was done\.$/)
})

// ── over HTTP: items 3, 4, 6, 8 and 9 through the real server on the fixtures ────────────────────────
async function startServer(t, env = {}) {
  const port = 9200 + Math.floor(Math.random() * 300)
  const base = `http://127.0.0.1:${port}`
  const proc = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, ...fixtureEnv, DRAFTHOUSE_CLAUDE_KEY: '', ANTHROPIC_API_KEY: '', DATABASE_URL: '', SUPABASE_URL: '', RESEND_API_KEY: '', DRAFTHOUSE_APP_KEY: '', DRAFTHOUSE_WORKER_KEY: 'test-worker-key', DRAFTHOUSE_DRAFTERS: 'maria@drafthouse.test', REGRID_API_TOKEN: '', PORT: String(port), DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dh-r10-')), ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
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
async function who(base, email, extra = {}) {
  const r = await fetch(base + '/api/auth/dev-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, name: email.split('@')[0] }) })
  const { token } = await r.json()
  const h = { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...extra }
  return { get: (p) => fetch(base + p, { headers: h }), post: (p, b = {}) => fetch(base + p, { method: 'POST', headers: h, body: JSON.stringify(b) }), put: (p, b = {}) => fetch(base + p, { method: 'PUT', headers: h, body: JSON.stringify(b) }) }
}
const enc = encodeURIComponent

test('9: the geocode, flood, zoning and wind routes need a signed-in user and are limited per user; a cached answer is free', async (t) => {
  const { base } = await startServer(t, { PARCEL_LOOKUPS_PER_10MIN: '3' })
  const kp = fx('kerria-1201-mcallen').point
  const routes = [`/api/lot/geocode?address=${enc('1201 Kerria Ave, McAllen, TX 78501')}`, `/api/lot/flood?lat=${kp.lat}&lon=${kp.lon}`, `/api/lot/flood?address=${enc('36 Melissa Dr, Brownsville, TX 78526')}`, `/api/lot/zoning?city=mcallen&lat=${kp.lat}&lon=${kp.lon}`, `/api/lot/wind?city=mcallen&lat=${kp.lat}&lon=${kp.lon}`]
  // anonymous: 401 on every one (they were open to anyone on round 9)
  for (const r of routes) assert.equal((await fetch(base + r)).status, 401, r)
  const ana = await who(base, 'ana@example.com')
  for (const r of routes) assert.equal((await ana.get(r)).status, 200, r)
  // the same answers again come from the cache and cost nothing: far more than the limit of 3, all 200
  for (let i = 0; i < 8; i++) for (const r of routes.slice(0, 4)) assert.equal((await ana.get(r)).status, 200, `${r} again (${i})`)
  // three fresh points reach FEMA, the fourth is refused with the plain line
  const beto = await who(base, 'beto@example.com')
  const got = []
  for (let i = 0; i < 5; i++) got.push((await beto.get(`/api/lot/flood?lat=${(26.3 + i * 0.01).toFixed(4)}&lon=-98.2`)).status)
  assert.deepEqual(got, [200, 200, 200, 429, 429])
  const over = await beto.get('/api/lot/flood?lat=26.5&lon=-98.2')
  assert.match((await over.json()).error, /Too many lot lookups for now/)
  // the kinds are counted apart: Beto's geocodes are not used up by his flood lookups
  assert.equal((await beto.get(routes[0])).status, 200)
  const geos = []
  for (const a of ['36 Melissa Dr, Brownsville, TX 78526', '5435 Curtis Clark Dr, Corpus Christi, TX 78412', '3305 N 27th St, McAllen, TX 78501', '1534 Armagoza Dr, Edinburg, TX 78541', '3013 Yvonne St, Edinburg, TX 78542']) geos.push((await beto.get(`/api/lot/geocode?address=${enc(a)}`)).status)
  assert.deepEqual(geos, [200, 200, 200, 200, 429], '36 Melissa was geocoded for Ana already (free); three fresh ones pass, the fourth is over the limit')
  // a header a client makes up does not buy a fresh count (no trusted proxy in this run)
  const spoof = await who(base, 'beto@example.com', { 'x-forwarded-for': '9.9.9.9' })
  assert.equal((await spoof.get('/api/lot/flood?lat=26.6&lon=-98.2')).status, 429)
})

test('6 and 3 over HTTP: a dropped FEMA connection answers 502 with the plain line; the held address answers confirm-address', async (t) => {
  const { base, log } = await startServer(t)
  const ana = await who(base, 'ana@example.com')
  // the parcel for a mismatched address: held, then given once confirmed
  const q = `/api/lot/parcel?address=${enc('1300 W Nolana Ave, McAllen, TX 78504')}`
  const held = await (await ana.get(q)).json()
  assert.equal(held.match, 'confirm-address')
  assert.equal(held.mismatch.message, 'We found 1300 E Nolana Ave, not W. Is that right?')
  assert.ok(!('legal' in held))
  const ok = await (await ana.get(q + '&confirmed=1')).json()
  assert.equal(ok.match, 'one')
  assert.equal(ok.legal, 'NOLANA RETAIL LOT 1')
  const geo = await (await ana.get(`/api/lot/geocode?address=${enc('1300 W Nolana Ave, McAllen, TX 78504')}`)).json()
  assert.equal(geo.mismatch.foundDirection, 'E')
  // a point no fixture covers answers "no digital FIRM" (200); a 500 never comes back from this route
  const r = await ana.get('/api/lot/flood?lat=26.9&lon=-98.9')
  assert.equal(r.status, 200)
  assert.doesNotMatch(log(), /→ 500/)
})

test('6 over HTTP: the server answers 502, not 500, when FEMA drops the connection', async (t) => {
  // a server whose FEMA calls fail the way the review saw: "TypeError: fetch failed"
  const { base, log } = await startServer(t, { DRAFTHOUSE_FIXTURE_THROW: 'hazards.fema.gov' })
  const ana = await who(base, 'ana@example.com')
  const pt = fx('curtis-clark-5435-corpus-christi').point
  const r = await ana.get(`/api/lot/flood?lat=${pt.lat}&lon=${pt.lon}`)
  assert.equal(r.status, 502)
  const body = await r.json()
  assert.equal(body.error, 'FEMA did not answer; the office checks the flood zone')
  assert.ok(!('requestId' in body) || typeof body.requestId === 'string')
  assert.doesNotMatch(JSON.stringify(body), /fetch failed|TypeError|ECONNRESET/)
  assert.doesNotMatch(log(), /→ 500/)
})

test('4 over HTTP: an unconfirmed address never blocks the draft; zoning blocks Send only for a parcel lot or a typed lot a drafter confirmed', async (t) => {
  const { base } = await startServer(t)
  const ana = await who(base, 'ana@example.com')
  const maria = await who(base, 'maria@drafthouse.test')
  const program = DEFAULT_PROGRAM
  const c3 = { status: 'found', district: 'C-3', residential: false, use: 'commercial', message: 'This lot is zoned C-3 (commercial). A house may need a rezoning; the office will call you.' }
  // the review's case: a typed 100 x 150 lot that picked up C-3 from a parcel nobody accepted
  const typed = buildLot({ kind: 'manual', address: '1300 W Nolana Ave, McAllen, TX', width: 100, depth: 150, city: 'mcallen', frontStreet: 'Nolana Ave', setbacks: {}, zoning: c3 })
  const rooms = generateRooms(program, style, typed)
  // Rooms and Draft: the plan fits and passes with the zoning on it (it was "Does not fit this lot" and Draft was disabled)
  assert.equal(fitsLot(program, style, typed).ok, true)
  assert.equal(checkRules(rooms, program, style, typed).ok, true)
  assert.equal(zoningBlocksSend(typed), false)
  const made = await ana.post('/api/projects', { lot: typed, style: { id: style.id }, program, rooms })
  assert.equal(made.status, 201)
  const prj = await made.json()
  // the browser's zoning on a typed lot is not kept at all: only a drafter can put one there
  assert.equal(prj.lot.spec.zoning ?? null, null)
  const design = { contract: 1, client: 'Ana', rooms: [] }
  const sent = await ana.post(`/api/projects/${prj.id}/send`, { design })
  assert.notEqual(sent.status, 409, `Send is not blocked by a zoning nobody confirmed: ${sent.status} ${await sent.clone().text()}`)
  // a second plan on the same typed lot; the drafter reads the map and confirms C-3: now Send is blocked, with the office's line
  const prj2 = await (await ana.post('/api/projects', { lot: typed, style: { id: style.id }, program, rooms })).json()
  assert.equal((await ana.post(`/api/review/${prj2.id}/zoning`, { district: 'C-3', residential: false })).status, 403, 'drafters only')
  assert.equal((await maria.post(`/api/review/${prj2.id}/zoning`, {})).status, 400)
  const z = await (await maria.post(`/api/review/${prj2.id}/zoning`, { district: 'C-3', residential: false, use: 'commercial' })).json()
  assert.equal(z.lot.zoning.confirmedBy, 'maria@drafthouse.test')
  const blocked = await ana.post(`/api/projects/${prj2.id}/send`, { design })
  assert.equal(blocked.status, 409)
  assert.match((await blocked.json()).error, /zoned C-3 \(commercial\).*the office calls you before the design is sent on/)
  // the homeowner cannot clear or forge the drafter's mark by saving the lot again
  const forged = await ana.put(`/api/projects/${prj2.id}`, { lot: { ...typed, spec: { ...typed.spec, zoning: null } } })
  assert.equal(forged.status, 200)
  assert.equal((await ana.post(`/api/projects/${prj2.id}/send`, { design })).status, 409, 'still blocked')
  const prj3 = await (await ana.post('/api/projects', { lot: { ...typed, spec: { ...typed.spec, zoning: { ...c3, residential: true, confirmedBy: 'maria@drafthouse.test' } } }, style: { id: style.id }, program, rooms })).json()
  assert.equal(prj3.lot.spec.zoning ?? null, null, 'a confirmedBy from the browser is dropped')
  // a parcel lot cannot arrive already confirmed either
  const parcel = (await (await ana.get(`/api/lot/parcel?address=${enc('1201 Kerria Ave, McAllen, TX 78501')}`)).json())
  const spec = { ...parcelSpec(parcel, { address: parcel.address, city: 'mcallen', county: 'Hidalgo County' }), confirmed: true, confirmedBy: 'ana@example.com' }
  const lotP = buildLot(spec)
  const prj4 = await (await ana.post('/api/projects', { lot: lotP, style: { id: style.id }, program, rooms: generateRooms(program, style, lotP) })).json()
  assert.equal(prj4.lot.spec.confirmed, false, 'only a drafter confirms a parcel lot')
  // the drafter clears the zoning note: Send opens again
  await maria.post(`/api/review/${prj2.id}/zoning`, { clear: true })
  assert.notEqual((await ana.post(`/api/projects/${prj2.id}/send`, { design })).status, 409)
})

test('8 over HTTP: "make the kitchen bigger and then make it smaller" nets to no change in the app\'s own chat, and uses none', async (t) => {
  const { base } = await startServer(t)
  const ana = await who(base, 'ana@example.com')
  const lot = buildLot({ kind: 'manual', width: 100, depth: 150, city: 'mcallen', frontStreet: 'Elm St', setbacks: {} })
  const prj = await (await ana.post('/api/projects', { lot, style: { id: style.id }, program: DEFAULT_PROGRAM, rooms: generateRooms(DEFAULT_PROGRAM, style, lot) })).json()
  const before = prj.changesLeft
  const r = await (await ana.post(`/api/projects/${prj.id}/change`, { text: 'make the kitchen bigger and then make it smaller' })).json()
  assert.equal(r.applied, false)
  assert.equal(r.noop, true)
  assert.match(r.reply, /^That nets out to no change: making the kitchen bigger and then smaller again leaves it as it is\. No change was used\.$/)
  assert.doesNotMatch(r.reply, /largest|goes up to/, 'not the kitchen-max sentence')
  assert.equal(r.changesLeft, before)
  assert.equal(r.version, prj.version)
  const swap = await (await ana.post(`/api/projects/${prj.id}/change`, { text: 'swap the kitchen and the garage' })).json()
  assert.equal(swap.applied, false)
  assert.match(swap.reply, /^Swapping the kitchen and the 2-car garage does not work on this plan/)
  assert.doesNotMatch(swap.reply, /that room|[()]/)
  assert.equal(swap.changesLeft, before)
})
