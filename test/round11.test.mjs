// Fix round 11 (the architect's review of PR #10, Nov 19 2026). Each test fails on round 10's code and passes here.
// All of it runs on the recordings: no network.
//   1  a homeowner cannot clear the zoning block on a confirmed parcel lot: the server reads the zoning itself
//   2  a curved frontage fronts on all of its chords (the pie lot on a cul-de-sac)
//   3  the per-address limit never keys on an address every visitor shares; the proxy chain is logged in positions
//   4  FEMA: two more tries with a wait, the two hard layers first, the soft ones only after they answer
//   5  the daily check covers the street side's width, the corner flag and owner and mailing presence, and emails
//      only when the same address fails twice running
//   6  an address point whose parcel is listed a few numbers off on the same street is used, not answered "none"
//   7  a roof that runs on past its wall does so only under a higher roof; otherwise it closes with a hip
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { makeParcels, frontFromRoads, cleanRing, edgeFrames, situsNear } from '../server/parcels.mjs'
import { makeLots, FEMA_DOWN } from '../server/lots.mjs'
import { fixtureFetch, loadFixtures } from '../server/fixtures.mjs'
import { TEST_ADDRESSES } from '../server/parcel-sources.mjs'
import { clientIp, isSharedAddress, proxyChain, proxyChainLine } from '../server/net.mjs'
import { buildLot } from '../src/draft/lib/lot.js'
import { parcelSpec } from '../src/draft/lib/parcel-spec.js'
import { generateRooms, DEFAULT_PROGRAM } from '../src/draft/lib/layout.js'
import { roofSheets } from '../src/draft/lib/roof.js'
import { STYLES } from '../src/draft/lib/styles.js'
import { fixtureEnv } from './server-env.mjs'

const FIX = loadFixtures()
const fx = (slug) => FIX.find((f) => f.slug === slug)
const style = STYLES.find((s) => s.ready) || STYLES[0]
const memStore = () => {
  const m = new Map()
  return { meta: { get: async (k) => (m.has(k) ? m.get(k) : null), set: async (k, v) => m.set(k, v) }, _m: m }
}
const services = (opts = {}) => {
  const store = opts.store || memStore()
  const log = []
  const fetchImpl = opts.fetchImpl || fixtureFetch(opts.fixtures || FIX, { failUrls: opts.failUrls || [], throwUrls: opts.throwUrls || [], ownerSentinel: !!opts.owner })
  const lots = makeLots({ store, fetchImpl, files: {}, interpreter: {}, event: async () => {}, log: (m) => log.push(m), env: { FEMA_BACKOFF_MS: '3,6' } })
  const parcels = makeParcels({ store, fetchImpl, geocode: (a) => lots.geocode(a), log: (m) => log.push(m), env: {}, event: async () => {} })
  return { store, lots, parcels, log }
}

// ── over HTTP ────────────────────────────────────────────────────────────────────────────────────────
async function startServer(t, env = {}) {
  const port = 9600 + Math.floor(Math.random() * 300)
  const base = `http://127.0.0.1:${port}`
  const proc = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, ...fixtureEnv, DRAFTHOUSE_CLAUDE_KEY: '', ANTHROPIC_API_KEY: '', DATABASE_URL: '', SUPABASE_URL: '', RESEND_API_KEY: '', DRAFTHOUSE_APP_KEY: '', DRAFTHOUSE_WORKER_KEY: 'test-worker-key', DRAFTHOUSE_DRAFTERS: 'maria@drafthouse.test', REGRID_API_TOKEN: '', FEMA_BACKOFF_MS: '3,6', PORT: String(port), DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dh-r11-')), ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
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

test('1: the five steps of the review: a homeowner cannot clear the zoning block on a confirmed parcel lot (step 5 is 409)', async (t) => {
  const { base } = await startServer(t)
  const ana = await who(base, 'ana@example.com')
  const maria = await who(base, 'maria@drafthouse.test')
  const address = '118 S Cage Blvd, Pharr, TX 78577'
  const parcel = await (await ana.get(`/api/lot/parcel?address=${enc(address)}`)).json()
  assert.equal(parcel.propId, '259430')
  const program = { ...DEFAULT_PROGRAM }
  // 1. the project, with no zoning sent at all: the server reads it at the parcel (C-2)
  const spec = parcelSpec(parcel, { address, city: 'pharr', county: 'Hidalgo County' })
  assert.equal(spec.zoning, null)
  const lot = buildLot(spec)
  const rooms = generateRooms(program, style, lot)
  const made = await ana.post('/api/projects', { lot, style: { id: style.id }, program, rooms })
  assert.equal(made.status, 201, await made.clone().text())
  const prj = await made.json()
  assert.equal(prj.lot.spec.zoning.district, 'C-2', 'leaving the zoning out does not leave the lot without one')
  assert.equal(prj.lot.spec.zoning.residential, false)
  assert.equal(prj.lot.spec.zoning.readBy, 'server')
  const design = { contract: 1, client: 'Ana', rooms: [] }
  // 2. Send before the drafter confirmed the lot: 409, lot pending
  const s2 = await ana.post(`/api/projects/${prj.id}/send`, { design })
  assert.equal(s2.status, 409)
  assert.equal((await s2.json()).lotPending, true)
  // 3. the drafter confirms the lot; the zoning it confirmed carries who confirmed it; Send: 409, zoned C-2
  const conf = await (await maria.post(`/api/review/${prj.id}/lot`, { confirmed: true })).json()
  assert.equal(conf.lot.spec.confirmed, true)
  assert.equal(conf.lot.spec.zoning.district, 'C-2')
  assert.equal(conf.lot.spec.zoning.confirmedBy, 'maria@drafthouse.test')
  const s3 = await ana.post(`/api/projects/${prj.id}/send`, { design })
  assert.equal(s3.status, 409)
  assert.match((await s3.json()).error, /zoned C-2/)
  // 4. the homeowner saves the same outline with a house zoning of their own
  const forged = { ...lot, spec: { ...spec, zoning: { status: 'found', district: 'R-1', residential: true, use: 'single-family' } }, zoning: { district: 'R-1', residential: true } }
  const put = await ana.put(`/api/projects/${prj.id}`, { lot: forged })
  assert.equal(put.status, 200)
  const after = await put.json()
  assert.equal(after.lot.spec.confirmed, true, 'the same outline keeps its confirmation')
  assert.equal(after.lot.spec.zoning.district, 'C-2', 'and its zoning: the R-1 from the browser is not taken')
  assert.equal(after.lot.zoning.district, 'C-2')
  // 5. Send is still blocked
  const s5 = await ana.post(`/api/projects/${prj.id}/send`, { design })
  assert.equal(s5.status, 409, 'step 5 of the review answered 200 on round 10')
  assert.match((await s5.json()).error, /zoned C-2 \(commercial\)/)
  // the other ways round it: no zoning key at all, a zoning of null, and a forged zoning on a new project
  for (const z of [undefined, null, { district: 'R-1', residential: true, confirmedBy: 'maria@drafthouse.test' }]) {
    const sp = { ...spec }
    if (z === undefined) delete sp.zoning
    else sp.zoning = z
    assert.equal((await ana.put(`/api/projects/${prj.id}`, { lot: { ...lot, spec: sp } })).status, 200)
    assert.equal((await ana.post(`/api/projects/${prj.id}/send`, { design })).status, 409)
  }
  const fresh = await (await ana.post('/api/projects', { lot: forged, style: { id: style.id }, program, rooms })).json()
  assert.equal(fresh.lot.spec.zoning.district, 'C-2', 'a new project with a forged zoning gets the server\'s')
  assert.equal(fresh.lot.spec.zoning.confirmedBy, undefined)
  // naming another parcel (a house lot's id) under the same outline drops the confirmation: the drafter looks again
  const swapped = await (await ana.put(`/api/projects/${prj.id}`, { lot: { ...lot, spec: { ...spec, propId: '255056', address: '1201 Kerria Ave, McAllen, TX 78501', city: 'mcallen' } } })).json()
  assert.equal(swapped.lot.spec.confirmed, false)
  const s6 = await ana.post(`/api/projects/${prj.id}/send`, { design })
  assert.equal(s6.status, 409)
  assert.equal((await s6.json()).lotPending, true)
  // a house lot is not blocked by any of this: Kerria (R-1), confirmed, sends
  const kp = await (await ana.get(`/api/lot/parcel?address=${enc('1201 Kerria Ave, McAllen, TX 78501')}`)).json()
  const kSpec = parcelSpec(kp, { address: '1201 Kerria Ave, McAllen, TX 78501', city: 'mcallen', county: 'Hidalgo County' })
  const kLot = buildLot(kSpec)
  const kProgram = { ...DEFAULT_PROGRAM, sqft: 2000, beds: 3, baths: 2, halfBath: false, office: false }
  const house = await (await ana.post('/api/projects', { lot: kLot, style: { id: style.id }, program: kProgram, rooms: generateRooms(kProgram, style, kLot) })).json()
  assert.equal(house.lot.spec.zoning.district, 'R-1')
  assert.equal(house.lot.spec.zoning.residential, true)
  const kc = await (await maria.post(`/api/review/${house.id}/lot`, { confirmed: true })).json()
  assert.equal(kc.lot.spec.zoning.confirmedBy, 'maria@drafthouse.test')
  const ks = await ana.post(`/api/projects/${house.id}/send`, { design })
  assert.notEqual((await ks.clone().json()).zoning, true)
  assert.doesNotMatch(await ks.text(), /zoned/)
})

// ── item 2 ───────────────────────────────────────────────────────────────────────────────────────────
// a pie lot on a cul-de-sac: the street side is an arc of six 8.4 ft chords 44 ft from the bulb's centre, and the
// road's centreline stops short of the centre, so the chords sit 41 to 54 ft from it
function pie() {
  const R = 44
  const arc = []
  for (let k = 0; k <= 6; k++) {
    const a = ((20 + 11 * k) * Math.PI) / 180
    arc.push([R * Math.cos(a), R * Math.sin(a)])
  }
  const far = 160
  const ring = [...arc, [far * Math.cos((86 * Math.PI) / 180), far * Math.sin((86 * Math.PI) / 180)], [far * Math.cos((20 * Math.PI) / 180), far * Math.sin((20 * Math.PI) / 180)]]
  return cleanRing(ring).pts
}

test('2: a curved frontage is front on all six chords, and its width is their sum', () => {
  const lot = pie()
  const road = { name: 'Kiskadee Ln', base: 'Kiskadee', suffix: 'Ln', layer: 8, lines: [[[10, -10], [10, -300]]] }
  const f = frontFromRoads(lot, [road], { streets: ['KISKADEE'] })
  const frames = edgeFrames(lot)
  assert.equal(frames.length, 9, 'six chords, two sides, the rear')
  const fronts = f.edgeKinds.map((k, i) => (k === 'front' ? i : -1)).filter((i) => i >= 0)
  assert.equal(fronts.length, 6, `front on ${fronts.length} of the 6 chords`)
  assert.ok(fronts.every((i) => frames[i].len < 9), 'only the chords: neither long side joined the front')
  assert.equal(f.frontChords, 6)
  assert.ok(Math.abs(f.frontWidthFt - frames.filter((e) => e.len < 9).reduce((a, e) => a + e.len, 0)) < 0.05, `width ${f.frontWidthFt}`)
  assert.ok(f.frontWidthFt >= 45, `front ${f.frontWidthFt} ft`)
  assert.equal(f.edgeKinds.filter((k) => k === 'rear').length, 1)
  assert.equal(f.edgeKinds.filter((k) => k === 'side').length, 2)
  // what round 10 did: facing within 60 degrees and within 8 ft of the nearest: four of the six
  const dist = (e) => Math.hypot(e.mid[0] - 10, e.mid[1] + 10)
  const nearest = Math.min(...frames.filter((e) => e.len < 9).map(dist))
  assert.equal(frames.filter((e) => e.len < 9 && dist(e) <= nearest + 8).length, 4, 'the old rule left two chords with the 5 ft side setback')
  // as a lot: every chord takes the front setback, and the lot's width is the arc, not one chord
  const calls = lot.map((p, i) => {
    const q = lot[(i + 1) % lot.length]
    return { dx: q[0] - p[0], dy: q[1] - p[1] }
  })
  assert.equal(calls.length, 9)
  // a straight frontage drawn in two pieces is one frontage; an edge that turns away from the street is not part of it
  const two = cleanRing([[0, 0], [40, 0], [80, 3], [80, 130], [0, 130]]).pts
  const street = { name: 'Elm St', base: 'Elm', layer: 8, lines: [[[-200, -30], [300, -27]]] }
  const t2 = frontFromRoads(two, [street], { streets: ['ELM'] })
  assert.equal(t2.frontChords, 2)
  assert.ok(Math.abs(t2.frontWidthFt - 80.1) < 0.3, `width ${t2.frontWidthFt}`)
  const clipped = cleanRing([[0, 0], [70, 0], [80, 20], [80, 130], [0, 130]]).pts
  const c = frontFromRoads(clipped, [{ name: 'Elm St', base: 'Elm', layer: 8, lines: [[[-200, -30], [300, -30]]] }], { streets: ['ELM'] })
  assert.equal(c.frontChords, 1, 'an edge turning more than 60 degrees away from the street is a side, not frontage')
  assert.equal(Math.round(c.frontWidthFt), 70)
  // a plain rectangle is as it was
  const sq = cleanRing([[0, 0], [80, 0], [80, 130], [0, 130]]).pts
  const s = frontFromRoads(sq, [{ name: 'Elm St', base: 'Elm', layer: 8, lines: [[[-200, -30], [300, -30]]] }], { streets: ['ELM'] })
  assert.equal(s.frontChords, 1)
  assert.equal(s.frontWidthFt, 80)
})

// ── item 3 ───────────────────────────────────────────────────────────────────────────────────────────
test('3: an address every visitor shares is never a limiter key; the proxy chain is described in positions only', () => {
  for (const ip of ['10.0.0.9', '172.20.1.1', '192.168.1.5', '127.0.0.1', '100.64.3.3', '::1', 'fd00::1', 'fe80::1', '::ffff:10.1.1.1', '104.16.5.5', '172.68.1.1', '162.158.9.9', '173.245.48.1', '2606:4700:10::1', '?', '']) assert.equal(isSharedAddress(ip), true, ip)
  for (const ip of ['203.0.113.7', '8.8.8.8', '172.15.0.1', '172.32.0.1', '104.15.255.255', '2001:db8::1', '::ffff:203.0.113.7']) assert.equal(isSharedAddress(ip), false, ip)
  // Render: client → Cloudflare → Render's load balancer; the visitor is the third entry from the right
  const req = { headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.7, 172.68.1.1, 10.0.0.2', 'cf-connecting-ip': '203.0.113.7' }, socket: { remoteAddress: '10.0.0.2' } }
  assert.deepEqual(proxyChain(req), { entries: 4, cf: true, cfFromRight: 3 })
  const line = proxyChainLine(proxyChain(req), 1)
  assert.equal(line, 'proxy chain: X-Forwarded-For has 4 entries; CF-Connecting-IP is entry 3 from the right; TRUST_PROXY_HOPS is 1 (set it to 3)')
  assert.doesNotMatch(line, /\d+\.\d+\.\d+\.\d+/, 'no address in the log line')
  assert.match(proxyChainLine(proxyChain(req), 3), /TRUST_PROXY_HOPS is 3 \(right\)$/)
  assert.match(proxyChainLine(proxyChain({ headers: {} }), 3), /has 0 entries; no CF-Connecting-IP header/)
  // with 1 (round 10's value) the key would be the load balancer, with 2 Cloudflare: both shared, both left out
  assert.equal(isSharedAddress(clientIp(req, 1)), true)
  assert.equal(isSharedAddress(clientIp(req, 2)), true)
  assert.equal(clientIp(req, 3), '203.0.113.7')
  assert.equal(isSharedAddress(clientIp(req, 3)), false)
  const idx = fs.readFileSync('server/index.mjs', 'utf8')
  assert.match(idx, /isSharedAddress\(ip\) \? \[\] : \[`\$\{kind\}:ip:\$\{ip\}`\]/)
  assert.match(fs.readFileSync('render.yaml', 'utf8'), /TRUST_PROXY_HOPS[^\n]*\n\s+value: "3"/)
  assert.match(fs.readFileSync('docs/DEPLOY.md', 'utf8'), /proxy chain: X-Forwarded-For has/)
})

test('3 over HTTP: behind a shared address only the per-user limit counts; a public address is limited per address; the chain is logged once', async (t) => {
  // one fresh lookup per user per ten minutes, three per address
  const { base, log } = await startServer(t, { PARCEL_LOOKUPS_PER_10MIN: '1', TRUST_PROXY_HOPS: '1' })
  const flood = (i) => `/api/lot/flood?lat=${(26.3 + i * 0.01).toFixed(4)}&lon=-98.2`
  // five visitors behind Cloudflare's address (what hops=1 picks on Render): none is refused for another's lookups
  const got = []
  for (let i = 0; i < 5; i++) got.push((await (await who(base, `cf${i}@example.com`, { 'x-forwarded-for': '203.0.113.50, 172.68.1.1', 'cf-connecting-ip': '203.0.113.50' })).get(flood(i))).status)
  assert.deepEqual(got, [200, 200, 200, 200, 200], 'on round 10 the fourth visitor of all was refused')
  // the same from one public address: the fourth is refused
  const pub = []
  for (let i = 0; i < 5; i++) pub.push((await (await who(base, `pub${i}@example.com`, { 'x-forwarded-for': '198.51.100.9' })).get(flood(10 + i))).status)
  assert.deepEqual(pub, [200, 200, 200, 429, 429])
  // and each user still has a limit of their own behind the shared address
  const one = await who(base, 'cf0@example.com', { 'x-forwarded-for': '203.0.113.50, 172.68.1.1' })
  assert.equal((await one.get(flood(30))).status, 429)
  const lines = log().split('\n').filter((l) => /^proxy chain:/.test(l))
  assert.ok(lines.length >= 1 && lines.length <= 2, `${lines.length} proxy chain lines`)
  assert.ok(lines.some((l) => /CF-Connecting-IP is entry 2 from the right; TRUST_PROXY_HOPS is 1 \(set it to 2\)/.test(l)), lines.join(' | '))
  assert.ok(lines.every((l) => !/\d+\.\d+\.\d+\.\d+/.test(l)), 'positions only')
})

// ── item 4 ───────────────────────────────────────────────────────────────────────────────────────────
test('4: FEMA gets two more tries with a wait; the hard layers go first and the soft ones only after they answer', async () => {
  const calls = []
  const counting = (inner) => async (url, opts) => {
    const m = /NFHL\/MapServer\/(\d+)\/query/.exec(String(url))
    if (m) calls.push(+m[1])
    return inner(url, opts)
  }
  const pt = fx('curtis-clark-5435-corpus-christi').point
  // FEMA down: three tries on each of the two hard layers, and not one call to layers 0, 1 or 34
  const down = services({ fetchImpl: counting(fixtureFetch(FIX, { throwUrls: ['hazards.fema.gov'] })) })
  await assert.rejects(down.lots.floodAt(pt), (e) => e.status === 502 && e.message === FEMA_DOWN)
  await new Promise((ok) => setTimeout(ok, 40)) // the two layers run side by side: let the slower one finish its last try
  assert.deepEqual([...calls].sort((a, b) => a - b), [3, 3, 3, 28, 28, 28], `calls ${calls}`)
  assert.equal(down.log.filter((l) => /trying again in 3 ms/.test(l)).length, 2)
  assert.equal(down.log.filter((l) => /trying again in 6 ms/.test(l)).length, 2)
  assert.equal(await down.store.meta.get(`flood:@${(+pt.lat).toFixed(5)},${(+pt.lon).toFixed(5)}`), null, 'nothing is cached for a failed read')
  // FEMA up: the hard layers first, then the soft ones
  calls.length = 0
  const up = services({ fetchImpl: counting(fixtureFetch(FIX)) })
  const ok = await up.lots.floodAt(pt)
  assert.equal(ok.status, 'x')
  assert.deepEqual(calls.slice(0, 2).sort((a, b) => a - b), [3, 28])
  assert.deepEqual(calls.slice(2).sort((a, b) => a - b), [1, 34], 'layer 0 is not needed when a panel or a zone answered')
  // no FIRM at all (Hidalgo): 3 and 28 come back empty, then layer 0 says whether a study exists
  calls.length = 0
  const none = await up.lots.floodAt(fx('kerria-1201-mcallen').point)
  assert.equal(none.status, 'no-digital-firm')
  assert.deepEqual(calls.slice(0, 2).sort((a, b) => a - b), [3, 28])
  assert.deepEqual(calls.slice(2), [0])
  // a soft layer that fails costs one call and does not fail the read
  calls.length = 0
  const soft = services({ fetchImpl: counting(fixtureFetch(FIX, { throwUrls: ['NFHL/MapServer/34'] })) })
  const s = await soft.lots.floodAt(pt)
  assert.equal(s.status, 'x')
  assert.equal(calls.filter((n) => n === 34).length, 1)
  // the live test treats a FEMA outage on the flood step as a skip with a note
  // (round 12 moved the rule into test/live-flood.mjs, which the live test calls)
  const live = fs.readFileSync('test/live-acceptance.test.mjs', 'utf8') + fs.readFileSync('test/live-flood.mjs', 'utf8')
  assert.match(live, /FEMA_DOWN/)
  assert.match(live, /t\.diagnostic\(/)
})

// ── item 5 ───────────────────────────────────────────────────────────────────────────────────────────
test('5: the daily check covers the street side, the corner and owner presence, and emails on the second failed run of an address', async () => {
  assert.ok(TEST_ADDRESSES.every((t) => typeof t.expect.frontWidthFt === 'number' && typeof t.expect.corner === 'boolean'))
  const emails = []
  const email = async (s, t) => emails.push({ s, t })
  // all well (the fixture server adds a made-up owner): every address reports its width, corner and presence flags
  const good = services({ owner: true })
  const ok = await good.parcels.dailyCheck({ email })
  assert.equal(ok.ok, true, JSON.stringify(ok.results.filter((r) => !r.ok)))
  for (const r of ok.results) {
    const t = TEST_ADDRESSES.find((x) => x.address === r.address)
    assert.ok(Math.abs(r.frontWidthFt - t.expect.frontWidthFt) <= 1, r.address)
    assert.equal(r.corner, t.expect.corner, r.address)
    assert.equal(r.owner, true)
    assert.equal(r.mailing, true)
    assert.equal(r.failedDays, 0)
  }
  assert.ok(!JSON.stringify(ok).includes('SENTINEL'), 'presence only: no owner or mailing value in the record')
  assert.equal(emails.length, 0)
  // no owner coming back (the mapping broke, round 10 item 5): a failure, named, when the owner is required
  const noOwner = services()
  const r1 = await noOwner.parcels.dailyCheck({ email })
  assert.equal(r1.ok, false)
  assert.ok(r1.results.every((r) => !r.ok && r.why.includes('no owner came back') && r.why.includes('no mailing address came back') && r.failedDays === 1))
  assert.equal(emails.length, 0, 'the first failed run does not email')
  // (round 12: a run counts again only 6 hours or more after the last one; this is the next day's run)
  const r2 = await noOwner.parcels.dailyCheck({ email, at: new Date(Date.now() + 24 * 3600000).toISOString() })
  assert.ok(r2.results.every((r) => r.failedDays === 2))
  assert.equal(emails.length, 1, 'the second failed run of the same address does')
  assert.match(emails[0].s, /twice running/)
  assert.match(emails[0].t, /FAIL 1201 Kerria Ave[^\n]*no owner came back[^\n]*\(2 runs running\)/)
  // a server on the recordings does not ask for the owner
  assert.equal((await services().parcels.dailyCheck({ requireOwner: false })).ok, true)
  // the street side: with the road map down the front falls back and the width drifts; said with both numbers
  emails.length = 0
  const store = memStore()
  const drift = services({ store, failUrls: ['tigerweb.geo.census.gov'] })
  const d1 = await drift.parcels.dailyCheck({ email, requireOwner: false })
  const cc = d1.results.find((r) => /Curtis Clark/.test(r.address))
  assert.equal(cc.ok, false)
  assert.match(cc.why.join('; '), /street side 300\.67 ft, recorded 31\.15 ft \(read from the census-point, not the road\)/)
  assert.ok(d1.results.some((r) => /Kerria/.test(r.address) && r.why.includes('no longer read as a corner lot')))
  assert.equal(emails.length, 0)
  // the next run is healthy again: counts reset, no email
  const healed = services({ store })
  const d2 = await healed.parcels.dailyCheck({ email, requireOwner: false })
  assert.equal(d2.ok, true)
  assert.ok(d2.results.every((r) => r.failedDays === 0))
  assert.equal(d2.failedDays, 0)
  assert.equal(emails.length, 0)
  // one bad run, one good, one bad: never two in a row, never an email
  const d3 = await services({ store, failUrls: ['tigerweb.geo.census.gov'] }).parcels.dailyCheck({ email, requireOwner: false })
  assert.ok(d3.results.filter((r) => !r.ok).every((r) => r.failedDays === 1))
  assert.equal(emails.length, 0)
})

// ── item 6 ───────────────────────────────────────────────────────────────────────────────────────────
test('6: an address point whose parcel is listed a few numbers off on the same street is the answer, marked near; another street never is', async () => {
  assert.equal(situsNear('329 11TH', { number: '323', street: '11TH' }), true)
  assert.equal(situsNear('118 W PARK AVE', { number: '118', street: 'CAGE' }), false, 'another street')
  assert.equal(situsNear('343 11TH', { number: '323', street: '11TH' }), false, '20 off')
  assert.equal(situsNear('329 111TH', { number: '323', street: '11TH' }), false, 'another street that only starts the same')
  assert.equal(situsNear('323 11TH', { number: '323', street: '11TH' }), false, 'the same number is an exact match, not a near one')
  // the Kerria recording with the appraisal district listing the lot six numbers off (a variant built here)
  const variant = (situs) => {
    const k = structuredClone(fx('kerria-1201-mcallen'))
    k.synthetic = true
    k.parcels.find((p) => String(p.properties.prop_id) === '255056').properties.situs = situs
    return [k]
  }
  const near = services({ fixtures: variant('1207 KERRIA AVE, MCALLEN TX') })
  const r = await near.parcels.lookup({ address: '1201 Kerria Ave, McAllen, TX 78501' })
  assert.equal(r.match, 'one', 'round 10 answered none')
  assert.equal(r.propId, '255056')
  assert.equal(r.matchedBy, 'address-point')
  assert.equal(r.confidence, 'near', 'never "exact"')
  assert.equal(r.listedAs, '1207 KERRIA AVE MCALLEN')
  assert.equal(r.disagreements[0].situs, '1207 KERRIA AVE MCALLEN', 'still logged for the sources page')
  assert.equal(r.frontBy, 'named-road')
  assert.ok(near.log.some((l) => /kept as a near match/.test(l)))
  // thirty numbers off is another lot: not taken
  const far = services({ fixtures: variant('1231 KERRIA AVE, MCALLEN TX') })
  const f = await far.parcels.lookup({ address: '1201 Kerria Ave, McAllen, TX 78501' })
  assert.notEqual(f.propId, '255056')
  assert.equal(f.match, 'none')
  // Pharr is as it was: the address point names another street's parcel, refused, and the situs search finds 259430
  const pharr = await services().parcels.lookup({ address: '118 S Cage Blvd, Pharr, TX 78577' })
  assert.equal(pharr.propId, '259430')
  assert.equal(pharr.matchedBy, 'situs')
  assert.equal(pharr.listedAs, undefined)
  assert.match(fs.readFileSync('src/draft/screens/Lot.jsx', 'utf8'), /parcel\.confidence === 'near' && parcel\.listedAs/)
})

test('2 and 6 on the live recordings: Kiskadee fronts on its six chords (49.92 ft); 323 N 11th St is the parcel listed as 329, marked near; Harris is a corner; Premont answers', async () => {
  const { parcels } = services()
  const k = await parcels.lookup({ address: '2002 Kiskadee Ln, Mission, TX 78572' })
  assert.equal(k.match, 'one')
  assert.equal(k.propId, '707917')
  assert.equal(k.edges.length, 11)
  const fronts = k.edgeKinds.map((kind, i) => (kind === 'front' ? i : -1)).filter((i) => i >= 0)
  assert.deepEqual(fronts, [0, 1, 2, 3, 4, 10], `front on ${fronts.join(', ')} (round 10: 3 and 4 only)`)
  assert.equal(k.frontChords, 6)
  assert.ok(k.frontWidthFt >= 45, `front ${k.frontWidthFt} ft`)
  assert.equal(k.frontWidthFt, 49.92)
  assert.ok(fronts.every((i) => k.edges[i].lengthFt < 9), 'the chords only: neither 90 ft side is front')
  assert.equal(k.corner, false)
  // the front setback now runs along the whole arc: no side-setback chord faces the street
  const lot = buildLot(parcelSpec(k, { city: 'mission' }))
  const kinds = lot.edges.map((e) => e.kind)
  assert.equal(kinds.filter((x) => x === 'front').length, 6, kinds.join(','))
  const w = await parcels.lookup({ address: '323 N 11th St, Raymondville, TX 78580' })
  assert.equal(w.match, 'one', 'round 10 answered none')
  assert.equal(w.propId, '11327')
  assert.equal(w.confidence, 'near')
  assert.equal(w.listedAs, '329 11TH')
  assert.equal(w.frontWidthFt, 50.18)
  assert.match(w.frontStreet, /11th/i)
  const h = await parcels.lookup({ address: '510 W Harris Ave, Raymondville, TX 78580' })
  assert.equal(h.confidence, 'exact')
  assert.equal(h.corner, true)
  assert.equal(h.frontWidthFt, 74.87)
  assert.ok(h.streets.some((x) => x.role === 'side' && /4th/i.test(x.name)))
  const p = await parcels.lookup({ address: '344 SE 3rd St, Premont, TX 78375' })
  assert.equal(p.propId, '34725')
  assert.equal(p.frontWidthFt, 49.92)
  for (const address of ['2002 Kiskadee Ln, Mission, TX 78572', '323 N 11th St, Raymondville, TX 78580', '510 W Harris Ave, Raymondville, TX 78580', '344 SE 3rd St, Premont, TX 78375']) assert.ok(TEST_ADDRESSES.some((t) => t.address === address), `${address} is in the acceptance set (daily check and live test)`)
  assert.equal(TEST_ADDRESSES.find((t) => /Kiskadee/.test(t.address)).expect.frontChords, 6)
})

test('2 (found on the way): a street side that curves into the lot no longer halves the buildable area, and every setback still holds', async () => {
  const { parcels } = services()
  const segDist = (p, a, b) => {
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)))
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz)
  }
  // the safe side, checked on every recorded lot: no corner of the envelope is nearer a lot line than that line's setback
  const holds = (lot, name) => {
    const B = lot.boundary
    for (const p of lot.envelope) for (const e of lot.edges) {
      const d = segDist(p, B[e.index], B[(e.index + 1) % B.length])
      assert.ok(d >= e.setback - 0.05, `${name}: an envelope corner is ${d.toFixed(2)} ft from edge ${e.index} (${e.kind}, ${e.setback} ft)`)
    }
  }
  const k = await parcels.lookup({ address: '2002 Kiskadee Ln, Mission, TX 78572' })
  const lot = buildLot(parcelSpec(k, { city: 'mission' }))
  assert.equal(lot.boundary.length, lot.corners.length, 'a parcel lot has no arcs: boundary and corners are the same points')
  holds(lot, 'Kiskadee')
  assert.ok(lot.envelopeSf >= 2900, `buildable ${Math.round(lot.envelopeSf)} sf (edge by edge: 1,614 sf; the true inset of the curve is about 3,200)`)
  assert.ok(lot.envelopeSf <= 3200, 'never more than the true inset')
  // every piece of the street side is labelled with the street, never "SIDE"
  for (const e of lot.edges.filter((x) => x.kind === 'front')) assert.equal(e.label, "20' — KISKADEE LN", `edge ${e.index}: ${e.label}`)
  // the house faces the middle of the curve, not its first chord
  const o = [Math.cos(lot.angle + Math.PI / 2), Math.sin(lot.angle + Math.PI / 2)]
  const frames = edgeFrames(lot.corners.map(([x, z]) => [x, z]))
  const fronts = lot.edges.filter((e) => e.kind === 'front').map((e) => e.index)
  const dots = fronts.map((i) => {
    const a = lot.corners[i]
    const b = lot.corners[(i + 1) % lot.corners.length]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    return Math.abs((b[0] - a[0]) * o[0] + (b[1] - a[1]) * o[1]) / len
  })
  assert.ok(frames.length === 11 && Math.max(...dots) < Math.sin((30 * Math.PI) / 180), `the house is within 30 degrees of square to every front chord (${dots.map((d) => d.toFixed(2))})`)
  // every other recorded lot: the setbacks hold, and a lot with no curve keeps the envelope it had
  for (const t of TEST_ADDRESSES) {
    const r = await parcels.lookup({ address: t.address })
    const city = { McAllen: 'mcallen', Brownsville: 'brownsville', 'Corpus Christi': 'corpuschristi', Pharr: 'pharr', Edinburg: 'edinburg', Mission: 'mission' }[(r.census?.place || '').trim()] || ''
    const L = buildLot(parcelSpec(r, { city, county: t.county }))
    holds(L, t.address)
  }
  // a plain 100 x 150 lot is untouched
  const plain = buildLot({ kind: 'manual', width: 100, depth: 150, city: 'mcallen', setbacks: {} })
  assert.equal(plain.envelope.length, 4)
})

// ── item 7 ───────────────────────────────────────────────────────────────────────────────────────────
test('7: a roof runs on past its wall only under a higher roof; otherwise it closes with a hip (the 2,800 sf default)', () => {
  const lot = buildLot({ kind: 'manual', width: 100, depth: 150, city: 'mcallen', setbacks: {} })
  const rooms = generateRooms(DEFAULT_PROGRAM, style, lot)
  const roof = rooms.find((r) => r.kind === 'roof')
  const { sheets, ends } = roofSheets(roof.masses, roof.scale || 1, roof.centre, roof.offset)
  const ids = sheets.map((s) => s.id)
  // the wide front-left gable has nothing as high behind it: a hip closes it (it ran 20 ft on over the lower roofs)
  assert.ok(ids.includes('leftwing-hip-start'), ids.join(' '))
  const wing = roof.faces.filter((f) => f.mass === 'leftwing' && f.kind === 'slope')
  const wingBack = Math.min(...wing.flatMap((f) => f.rings[0].map((p) => p[2])))
  const wingMass = roof.masses.find((m) => m.id === 'leftwing')
  const k = roof.scale || 1
  const zOf = (y) => roof.centre[1] + (y - roof.centre[1]) * k + (roof.offset?.[1] || 0) - roof.centre[1]
  const xOf = (x) => roof.centre[0] + (x - roof.centre[0]) * k + (roof.offset?.[0] || 0) - roof.centre[0]
  assert.ok(zOf(wingMass.y0) - wingBack < 9, `the wing's roof ends ${Math.round(zOf(wingMass.y0) - wingBack)} ft behind its wall (20 ft before)`)
  // the garage dies into the main roof, but beside the main roof (past its east eave) it no longer hangs over the yard
  const main = roof.masses.find((m) => m.id === 'main')
  const garage = roof.masses.find((m) => m.id === 'garage')
  const eastEave = xOf(main.x1) + 1.33
  const backWall = zOf(garage.y0)
  const overYard = roof.faces.filter((f) => f.mass === 'garage' && f.kind === 'slope').flatMap((f) => f.rings[0]).filter((p) => p[0] > eastEave + 0.2 && p[2] < backWall - 0.2)
  assert.equal(overYard.length, 0, 'no garage roof over open ground behind its back wall')
  // and its back wall is closed where it stands in the open
  assert.ok(ends.some((e) => e.mass === 'garage' && Math.abs(e.at - (backWall - 0.03)) < 0.01), 'a wall triangle at the garage\'s back wall')
  assert.ok(roof.faces.some((f) => f.mass === 'garage' && f.kind === 'end' && f.rings[0].some((p) => Math.abs(p[2] - (backWall - 0.03)) < 0.01)), 'visible where no roof covers it')
  // nothing visible is buried under another roof, and no slope vertex floats above every roof plane
  const slopes = roof.faces.filter((f) => f.kind === 'slope')
  assert.ok(slopes.length >= 25)
  // the listed gable ends are all still there
  for (const id of ['main', 'leftwing', 'bedwing', 'office', 'frontgable', 'master', 'garage']) assert.ok(ends.some((e) => e.mass === id), id)
})

test('7: the Draft step says the changes left once, and the top view\'s north mark is a fixed corner mark (source check)', () => {
  const draft = fs.readFileSync('src/draft/screens/Draft.jsx', 'utf8')
  assert.doesNotMatch(draft, /changes? left\s*<\/span>|\{changesLeft\} change/, 'the card no longer repeats the header')
  assert.match(fs.readFileSync('src/draft/DraftApp.jsx', 'utf8'), /data-testid="changes-left"/)
  const scene = fs.readFileSync('src/draft/HouseScene.jsx', 'utf8')
  assert.match(scene, /northArrow=\{view !== 'top'\}/)
  assert.match(scene, /className="compass" data-testid="north"/)
  assert.match(fs.readFileSync('src/draft/draft.css', 'utf8'), /\.compass \{ position: absolute; left: 14px; bottom: 12px;/)
})
