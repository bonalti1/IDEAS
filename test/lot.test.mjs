// Lots: bearings, the traverse of the recorded Lot 514 plat, manual lots, envelopes, city rules,
// the house on a different lot, and the server routes. The live plat reader and the flood lookup
// run only with LIVE=1 (they need the Claude key and the internet).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { bearingToVector, vectorToBearing, traverse, buildLot, envelopeOf, referenceCalls, DEFAULT_LOT, worldOf } from '../src/draft/lib/lot.js'
import { cityTable, rulesFor, guessCity, CITY_IDS } from '../src/draft/lib/cities.js'
import { generateRooms, isRoom, DEFAULT_PROGRAM } from '../src/draft/lib/layout.js'
import { checkRules } from '../src/draft/lib/rules.js'
import { interpretRequest } from '../src/draft/lib/interpret.js'
import { STYLES } from '../src/draft/lib/styles.js'
import { KIT } from '../src/kits/modern-farmhouse.js'
import { LOT_AREA_SF, LOT_CORNERS, ARC_RECORDED } from '../src/data/survey.js'
import { fixtureEnv } from './server-env.mjs'

const style = STYLES.find((s) => s.id === 'farmhouse')
const program = { ...KIT.reference.program }
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`)

test('bearings read in every common spelling', () => {
  const n = bearingToVector('N 00°00\'00" E')
  close(n[0], 0, 1e-9, 'north x')
  close(n[1], -1, 1e-9, 'north z (south is +z)')
  const e = bearingToVector('S 90°00\'00" E')
  close(e[0], 1, 1e-9, 'east')
  const sw = bearingToVector('S 45-00-00 W')
  close(sw[0], -Math.SQRT1_2, 1e-9, 'sw x')
  close(sw[1], Math.SQRT1_2, 1e-9, 'sw z')
  const az = bearingToVector(180)
  close(az[1], 1, 1e-9, 'azimuth 180 points south')
  assert.equal(vectorToBearing([0, -1]), 'N 00°00\'00" E')
  assert.equal(vectorToBearing(bearingToVector('N 05°00\'00" E')), 'N 05°00\'00" E')
  assert.throws(() => bearingToVector('north-ish'))
})

test('the Lot 514 plat, as calls, traverses back to the recorded corners', () => {
  const calls = referenceCalls()
  assert.equal(calls.length, 7)
  assert.ok(calls[1].curve, 'the Don St corner is a curve')
  const t = traverse(calls)
  assert.ok(t.closure < 0.25, `closes within ${t.closure} ft`)
  close(t.areaSf, LOT_AREA_SF, LOT_AREA_SF * 0.005, 'area within half a percent of the recorded plat')
  assert.equal(t.corners.length, LOT_CORNERS.length)
  t.corners.forEach((c, i) => {
    close(c[0], LOT_CORNERS[i][0], 0.3, `corner ${i} x`)
    close(c[1], LOT_CORNERS[i][1], 0.3, `corner ${i} z`)
  })
  const arc = t.arcs[0]
  close(arc.radius, ARC_RECORDED.R, 0, 'radius')
  close(arc.arcLength, ARC_RECORDED.arcLength, 0.3, 'arc length 55.11')
  close(arc.chord, ARC_RECORDED.chord, 0.01, 'chord 52.23')
  close(arc.delta, ARC_RECORDED.deltaDeg, 0.05, 'delta 62°58\'14"')
})

test('a plat lot with the drafter\'s side kinds gets the same envelope the drafter drew for Lot 514', () => {
  const lot = buildLot({ kind: 'plat', calls: referenceCalls(), streets: [{ edge: 4, name: 'Ida Blvd' }, { edge: 1, name: 'Don St' }, { edge: 2, name: 'Don St' }, { edge: 3, name: 'Don St' }, { edge: 5, name: 'Showers Rd' }, { edge: 6, name: 'Showers Rd' }], front: 4, kinds: ['side', 'streetSide', 'streetSide', 'streetSide', 'front', 'rear', 'rear'], city: 'palmview', setbacks: { front: 10, side: 6, rear: 20, streetSide: 25 } })
  assert.equal(lot.kind, 'plat')
  assert.equal(lot.confirmed, false, 'a plat lot starts unconfirmed')
  close(lot.areaSf, LOT_AREA_SF, 120, 'area')
  // the drafter's hand-drawn envelope is a 4-corner approximation; the clipped one follows the curve and is a little smaller (safe side)
  close(lot.envelopeSf, DEFAULT_LOT.envelopeSf, DEFAULT_LOT.envelopeSf * 0.06, 'envelope area')
  assert.ok(lot.envelopeSf <= DEFAULT_LOT.envelopeSf, 'never more buildable area than the drafter drew')
  close(lot.centre[0], DEFAULT_LOT.centre[0], 4, 'centre x')
  close(lot.centre[1], DEFAULT_LOT.centre[1], 4, 'centre z')
  assert.equal(lot.edges[4].kind, 'front')
  assert.equal(lot.edges[4].label, "10' — IDA BLVD")
  assert.equal(lot.streets.length, 6)
  // the house frame faces Ida Blvd: local +z lands south of the centre
  const p = worldOf(lot, 0, 10)
  assert.ok(p[1] > lot.centre[1], 'toward the street is +z (south) on this lot')
})

test('a manual lot: rectangle, city setbacks, corner option, overrides', () => {
  const m = buildLot({ kind: 'manual', width: 100, depth: 150, city: 'mcallen', frontStreet: 'Elm St' })
  assert.equal(m.areaSf, 15000)
  assert.deepEqual(m.envelope, [
    [5, 10],
    [95, 10],
    [95, 130],
    [5, 130],
  ])
  // round 7: McAllen R-1 is 20 front, 5 side, 10 rear, read from the code (jurisdictions.js)
  assert.equal(m.envelopeSf, 90 * 120)
  assert.equal(m.angle, 0)
  assert.deepEqual(m.envelopeLabels, ["10' — REAR", "5' — SIDE", "20' — ELM ST", "5' — SIDE"])
  assert.equal(m.streets.length, 1)
  assert.equal(m.cityName, 'McAllen, TX')
  const c = buildLot({ kind: 'manual', width: 100, depth: 150, city: 'palmview', frontStreet: 'Elm St', corner: 'right', sideStreet: 'Oak Dr' })
  assert.equal(c.edges[1].kind, 'streetSide')
  assert.equal(c.edges[1].setback, 10)
  assert.equal(c.streets.length, 2)
  const o = buildLot({ kind: 'manual', width: 100, depth: 150, city: 'mcallen', setbacks: { front: 30, side: '8' } })
  assert.equal(o.envelope[0][0], 8)
  assert.equal(o.envelope[2][1], 120)
  const tiny = buildLot({ kind: 'manual', width: 20, depth: 30, city: 'mcallen' })
  assert.equal(tiny.envelopeSf, 8 * -5 < 0 ? 0 : tiny.envelopeSf, 'no negative envelope')
  assert.ok(tiny.envelope.length === 0 || tiny.envelopeSf < 100)
})

test('envelopeOf insets each edge by its own setback', () => {
  const sq = [
    [0, 0],
    [100, 0],
    [100, 100],
    [0, 100],
  ]
  assert.deepEqual(envelopeOf(sq, [10, 20, 30, 40]), [
    [40, 10],
    [80, 10],
    [80, 70],
    [40, 70],
  ])
})

test('city table: the sourced rows for 15 cities and 7 counties (round 7), office overrides win, lot overrides win over those', () => {
  assert.deepEqual(CITY_IDS.slice(0, 7), ['mcallen', 'edinburg', 'mission', 'pharr', 'hidalgo', 'weslaco', 'sanjuan'])
  assert.equal(CITY_IDS.length, 22)
  for (const id of ['harlingen', 'brownsville', 'corpuschristi', 'alice', 'riograndecity', 'cameron-county', 'nueces-county']) assert.ok(CITY_IDS.includes(id), id)
  assert.equal(rulesFor('harlingen').garageFt, 20, 'Harlingen: a front-facing garage door 20 ft from the street (round 8, item 30d)')
  assert.equal(rulesFor('mcallen').garageFt, 18)
  const t = cityTable({ mcallen: { front: 22, verified: true } })
  assert.equal(t.mcallen.front, 22)
  assert.equal(t.mcallen.verified, true)
  assert.equal(t.mission.front, 20, 'Mission R-1 front is 20 (summary row)')
  assert.equal(t.edinburg.rear, 20, 'Edinburg R-1 rear is 20, not the old 10')
  assert.equal(rulesFor('mcallen', { front: 15 }, t).front, 15)
  assert.equal(rulesFor('mcallen', { front: '' }, t).front, 22)
  assert.equal(rulesFor('nowhere').name, 'Hidalgo County (unincorporated)')
  assert.equal(guessCity('123 Main St, Edinburg TX'), 'edinburg')
  assert.equal(guessCity('somewhere'), 'hidalgo')
})

test('the Garza plan drafts and changes on a 100 by 150 McAllen lot, and refuses a lot that is too small', async () => {
  const lot = buildLot({ kind: 'manual', width: 100, depth: 150, city: 'mcallen', frontStreet: 'Elm St' })
  const rooms = generateRooms(program, style, lot)
  assert.ok(rooms.filter(isRoom).length > 20)
  const r = checkRules(rooms, program, style, lot)
  assert.deepEqual(r.reasons, [], 'the reference plan fits the lot')
  // every room sits inside the envelope
  rooms.filter(isRoom).filter((x) => !x.open).forEach((x) => {
    assert.ok(x.center[0] > 6 && x.center[0] < 94 && x.center[1] > 10 && x.center[1] < 125, `${x.name} on the lot`)
  })
  const res = await interpretRequest('make the kitchen bigger', rooms, program, style, { lot, interpreter: async () => { throw new Error('offline') } })
  assert.equal(res.applied, true, res.reply)
  // a 60 ft lot takes the kit's narrow plan now; 30 ft takes nothing
  const narrow = buildLot({ kind: 'manual', width: 30, depth: 150, city: 'mcallen', frontStreet: 'Elm St' })
  const r2 = checkRules(generateRooms(program, style, narrow), program, style, narrow)
  assert.ok(r2.reasons.some((x) => /setback/.test(x)), r2.reasons.join(' | '))
  // and the move rule names the right street on the new lot
  const far = await interpretRequest('push the kitchen 80 feet toward the street', rooms, program, style, { lot, interpreter: async () => ({ ops: [{ op: 'move', room: 'kitchen', dx: 0, dy: 80 }], reply: 'moved', confidence: 0.9 }) })
  assert.equal(far.applied, false)
  assert.match(far.reply, /elm st/i)
})

// ── server routes ──
async function startServer(t, env = {}) {
  const port = 9000 + Math.floor(Math.random() * 100)
  const base = `http://127.0.0.1:${port}`
  const proc = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, ...fixtureEnv, DRAFTHOUSE_CLAUDE_KEY: '', ANTHROPIC_API_KEY: '', DATABASE_URL: '', SUPABASE_URL: '', DRAFTHOUSE_DRAFTERS: 'maria@drafthouse.test', PORT: String(port), DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dh-')), ...env }, stdio: 'ignore' })
  t.after(() => proc.kill())
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(base + '/api/health')
      return base
    } catch {
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  throw new Error('server did not start')
}
// round 15, B2: a plat lot names a plat the office has, uploaded from the same account
const platIdOf = async (w) => (await (await w.post('/api/lot/plat', { name: 'p.png', data: fs.readFileSync('test/fixtures/garza-site-plan.png').toString('base64') })).json()).platId
const who = async (base, email) => {
  const { token } = await (await fetch(base + '/api/auth/dev-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) })).json()
  const h = { 'content-type': 'application/json', authorization: `Bearer ${token}` }
  return { get: (p) => fetch(base + p, { headers: h }), post: (p, b = {}) => fetch(base + p, { method: 'POST', headers: h, body: JSON.stringify(b) }), put: (p, b = {}) => fetch(base + p, { method: 'PUT', headers: h, body: JSON.stringify(b) }) }
}

test('city rules are served, drafters edit them, and lots pick the edit up', async (t) => {
  const base = await startServer(t)
  const ana = await who(base, 'ana@example.com')
  const maria = await who(base, 'maria@drafthouse.test')
  const t0 = await (await fetch(base + '/api/cities')).json()
  assert.equal(t0.mcallen.front, 20)
  assert.equal((await ana.put('/api/admin/cities/mcallen', { front: 22 })).status, 403, 'clients cannot edit')
  const up = await (await maria.put('/api/admin/cities/mcallen', { front: 22, verified: true, note: 'per ordinance 2024-12', source: 'McAllen Code, read 2026-11-18' })).json()
  assert.equal(up.front, 22)
  assert.equal(up.verified, true)
  assert.equal((await maria.put('/api/admin/cities/atlantis', { front: 1 })).status, 404)
  const t1 = await (await fetch(base + '/api/cities')).json()
  assert.equal(t1.mcallen.front, 22)
  assert.equal(t1.mcallen.updatedBy, 'maria@drafthouse.test')
  // the sourced table carries the edit with its source, status and date (round 7)
  const j = await (await fetch(base + '/api/jurisdictions')).json()
  assert.equal(j.mcallen.front.value, 22)
  assert.equal(j.mcallen.front.status, 'verified')
  assert.equal(j.mcallen.front.source, 'McAllen Code, read 2026-11-18')
  assert.equal(j.mcallen.front.by, 'maria@drafthouse.test')
  // a project on that lot: the server rebuilds the lot from its spec with the edited table
  const lot = buildLot({ kind: 'manual', width: 100, depth: 150, city: 'mcallen', frontStreet: 'Elm St' }, t1)
  assert.equal(lot.envelope[0][1], 10)
  assert.equal(lot.envelope[2][1], 128, 'front setback now 22')
  const prj = await (await ana.post('/api/projects', { lot, style: { id: 'farmhouse' }, program, rooms: generateRooms(program, style, lot) })).json()
  assert.equal(prj.lot.spec.kind, 'manual')
  const c = await (await ana.post(`/api/projects/${prj.id}/change`, { text: 'make the kitchen bigger' })).json()
  assert.equal(c.applied, true, c.reply)
})

test('a plat lot the drafter has not confirmed never blocks Send (round 15, B4): the plan waits as "Lot to confirm + plan", approval waits for the lot, and a corrected lot sends the plan back', async (t) => {
  const base = await startServer(t)
  const ana = await who(base, 'ana@example.com')
  const maria = await who(base, 'maria@drafthouse.test')
  const spec = { kind: 'plat', calls: referenceCalls(), streets: [{ edge: 4, name: 'Ida Blvd' }], front: 4, kinds: ['side', 'streetSide', 'streetSide', 'streetSide', 'front', 'rear', 'rear'], city: 'palmview', setbacks: { front: 10, side: 6, rear: 20, streetSide: 25 }, platId: 'plat_test', confirmed: false }
  spec.platId = await platIdOf(ana)
  const lot = buildLot(spec)
  const prj = await (await ana.post('/api/projects', { lot, style: { id: 'farmhouse' }, program, rooms: generateRooms(program, style, lot) })).json()
  assert.equal(prj.lot.confirmed, false)
  // round 15, B4: the homeowner can always send; the plan waits for the drafter with its lot
  const sent = await ana.post(`/api/projects/${prj.id}/send`, { design: { contract: 1, client: 'Ana' } })
  assert.equal(sent.status, 200)
  assert.equal((await sent.json()).status, 'in_review')
  const inbox = await (await maria.get('/api/review')).json()
  assert.equal(inbox.waiting.length, 1)
  assert.equal(inbox.waiting[0].id, prj.id)
  assert.equal(inbox.waiting[0].lotPending, true, 'marked "Lot to confirm + plan"')
  assert.equal(inbox.lots.length, 0, 'not listed twice')
  // the drafter cannot approve the plan before the lot is confirmed
  const early = await maria.post(`/api/review/${prj.id}`, { decision: 'approved' })
  assert.equal(early.status, 409)
  assert.match((await early.json()).error, /^Confirm the lot first/)
  assert.equal((await ana.post(`/api/review/${prj.id}/lot`, { confirmed: true })).status, 403)
  // the drafter corrects the front setback and confirms: the plan is re-placed as a free version
  const ok = await (await maria.post(`/api/review/${prj.id}/lot`, { confirmed: true, spec: { setbacks: { front: 12, side: 6, rear: 20, streetSide: 25 } }, note: 'front is 12 per the plat note' })).json()
  assert.equal(ok.lot.confirmed, true)
  assert.equal(ok.lot.spec.confirmedBy, 'maria@drafthouse.test')
  assert.equal(ok.lot.rules.front, 12)
  assert.equal(ok.versions[ok.versions.length - 1].kind, 'lot')
  assert.equal(ok.changesLeft, 10)
  // the corrected lot moved the plan, so the plan the homeowner sent goes back to them with a plain note
  assert.equal(ok.status, 'returned')
  assert.match(ok.review.note, /^We corrected your lot/)
  assert.equal((await (await maria.get('/api/review')).json()).lots.length, 0)
  const sent2 = await ana.post(`/api/projects/${prj.id}/send`, { design: { contract: 1, client: 'Ana' } })
  assert.equal(sent2.status, 200)
  assert.equal((await sent2.json()).lotPending, undefined)
  // a typed lot has nothing to confirm
  const m = buildLot({ kind: 'manual', width: 100, depth: 150, city: 'mcallen' })
  const prj2 = await (await ana.post('/api/projects', { lot: m, style: { id: 'farmhouse' }, program, rooms: generateRooms(program, style, m) })).json()
  assert.equal((await maria.post(`/api/review/${prj2.id}/lot`, { confirmed: true })).status, 409)
  // without the Claude key the plat is kept for the drafter and the homeowner goes on (round 14; it was a 503 naming the key)
  const kept = await ana.post('/api/lot/plat', { name: 'x.pdf', data: Buffer.from('%PDF-1.4').toString('base64') })
  assert.equal(kept.status, 200)
  assert.equal((await kept.json()).unread, true)
})

test('live: Claude reads the Garza site plan and FEMA answers for its address', { skip: !process.env.LIVE && 'set LIVE=1 (needs the Claude key and the internet)' }, async (t) => {
  const base = await startServer(t, { DRAFTHOUSE_CLAUDE_KEY: process.env.DRAFTHOUSE_CLAUDE_KEY || process.env.ANTHROPIC_API_KEY, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '' })
  const data = fs.readFileSync('test/fixtures/garza-site-plan.png').toString('base64')
  // round 15, office decision 2: uploading needs an account
  const r = await (await who(base, 'ana.live@example.com')).post('/api/lot/plat', { name: 'garza-site-plan.png', data })
  assert.equal(r.status, 200)
  const read = await r.json()
  assert.equal(read.calls.length, 4, 'four sides')
  const dists = read.calls.map((c) => (c.curve ? c.curve.arcLength : c.distance)).sort((a, b) => a - b)
  assert.deepEqual(dists.map((d) => Math.round(d * 10) / 10), [150, 161.1, 259.6, 318], 'the printed distances')
  assert.ok(read.calls.some((c) => c.curve && Math.abs(c.curve.radius - 1105.92) < 0.1), 'the curve radius')
  assert.ok(read.closure < 2, `closes within ${read.closure} ft`)
  assert.ok(read.areaSf > 40000 && read.areaSf < 46000, `area ${read.areaSf}`)
  assert.deepEqual(read.setbacks, { front: 25, side: 5, rear: 10 }, 'printed setbacks')
  assert.match(read.streets[0].name, /FM 2360/)
  const lot = buildLot({ kind: 'plat', calls: read.calls, streets: read.streets, front: read.front, kinds: read.kinds?.length === read.calls.length ? read.kinds : undefined, setbacks: read.setbacks, city: 'hidalgo' })
  assert.ok(lot.envelopeSf > 25000, `buildable ${lot.envelopeSf}`)
  const rooms = generateRooms(program, style, lot)
  assert.deepEqual(checkRules(rooms, program, style, lot).reasons, [], 'the Garza house fits its own lot')
  // round 14: what the read cost the office and its token counts stay on the server
  for (const k of ['cost', 'usage', 'ms']) assert.equal(k in read, false, `${k} is not sent to the browser`)
  // the flood route has needed an account since round 10 (this live test still asked without one)
  const ana = await who(base, 'ana.live@example.com')
  const f = await (await ana.get(`/api/lot/flood?address=${encodeURIComponent('2554 N FM 2360, Rio Grande City, TX 78582')}`)).json()
  assert.ok(f.matched || f.note, JSON.stringify(f))
})

test('a half-typed lot size never builds a bad lot: the Lot step keeps the last good one and says what is missing', async () => {
  const { lotProblem } = await import('../src/draft/lib/lot.js')
  for (const v of ['', '1', '12', 'abc', null, undefined, '-5', '19.9']) {
    const spec = { kind: 'manual', width: 100, depth: v, city: 'mcallen', setbacks: {} }
    const lot = buildLot(spec)
    assert.ok(lot, `buildLot copes with ${JSON.stringify(v)}`)
    assert.match(lotProblem(spec, lot) || '', /depth|buildable/, `${JSON.stringify(v)} is reported`)
  }
  // deep enough to type, not deep enough for the setbacks
  const shallow = { kind: 'manual', width: 100, depth: 30, city: 'mcallen', setbacks: {} }
  assert.match(lotProblem(shallow, buildLot(shallow)), /setbacks leave no buildable area/)
  const fine = { kind: 'manual', width: 100, depth: 150, city: 'mcallen', setbacks: {} }
  assert.equal(lotProblem(fine, buildLot(fine)), null)
})

test('an address outside the Valley clears the city preset message: no rules yet, outside the Rio Grande Valley; the county decides the price', async () => {
  const { geoMessage, COUNTIES } = await import('../src/draft/lib/cities.js')
  const { estimate, countyOf } = await import('../src/draft/lib/pricing.js')
  // round 7, item 2: the four cases come from the jurisdiction table
  assert.match(geoMessage({ found: true, cityId: 'mcallen', place: 'McAllen', county: 'Hidalgo County' }), /McAllen, TX rules, from the city code/)
  assert.match(geoMessage({ found: true, cityId: null, county: 'Travis County', place: 'Austin', state: 'TX' }), /outside the eight counties we build in/)
  assert.match(geoMessage({ found: true, cityId: null, county: 'Cameron County', place: 'Los Fresnos' }), /no rules for that city yet, so the county row is used, unverified/)
  assert.match(geoMessage({ found: true, cityId: 'corpuschristi', county: 'Nueces County', place: 'Corpus Christi' }), /Corpus Christi, TX rules; 2 of them are summaries/)
  assert.match(geoMessage({ found: true, cityId: null, county: 'Starr County', place: null }), /Unincorporated Starr County: the county subdivision rules are used/)
  // no city preset, no county: no silent Hidalgo
  const noCity = buildLot({ kind: 'manual', width: 100, depth: 150, city: '', setbacks: {} })
  assert.equal(countyOf(noCity), null)
  const style = STYLES.find((s) => s.id === 'farmhouse')
  const e = estimate({ program: { ...DEFAULT_PROGRAM, sqft: 2000 }, style, lot: noCity })
  assert.equal(e.needsCounty, true)
  assert.equal(e.county, null)
  const withCounty = buildLot({ kind: 'manual', width: 100, depth: 150, city: '', county: 'Nueces County', setbacks: {} })
  assert.equal(countyOf(withCounty), 'Nueces County')
  assert.deepEqual(estimate({ program: { ...DEFAULT_PROGRAM, sqft: 2000 }, style, lot: withCounty }).perSf, [130, 145])
  assert.ok(COUNTIES.includes('Nueces County'))
})
