// Fix round 15: the review of PR #14, the upload door.
//   D2  uploading a plat needs an account (401 signed out); the "everyone without an account" bucket is gone
//   B1  uploads sent at the same moment cannot get round the limit: the slot is taken before the (slow, paid) read
//   B2  whether a plat was read, and how far a sent outline sits from it, come from the office's record, never the browser
//   B3  a plat opens only for its uploader, the owner of a house that uses it, or the office; a house attaches only
//       its own account's plat; the file is served with nosniff and an inline name of its own
//   U7  an upload no house uses is removed after 30 days; one a house uses stays; the health page shows the disk
//   P4  the queue and the homeowner never see the uploaded file's own name
// The office API answers from the recordings; nothing reaches the internet.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnGroup, freePort } from './browser.mjs'
import { buildLot, platFromTyped } from '../src/draft/lib/lot.js'
import { makeLots } from '../server/lots.mjs'
import { localFiles } from '../server/files/local.mjs'
import { fixtureEnv } from './server-env.mjs'

const PLAT = 'test/fixtures/garza-site-plan.png'
const png = () => fs.readFileSync(PLAT).toString('base64')

async function startApi(t, env = {}) {
  const port = await freePort()
  const base = `http://127.0.0.1:${port}`
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-r15-plats-'))
  spawnGroup(t, process.execPath, ['server/index.mjs'], { env: { ...fixtureEnv, DRAFTHOUSE_CLAUDE_KEY: '', ANTHROPIC_API_KEY: '', DATABASE_URL: '', SUPABASE_URL: '', RESEND_API_KEY: '', DRAFTHOUSE_APP_KEY: '', DRAFTHOUSE_WORKER_KEY: 'wk', DRAFTHOUSE_DRAFTERS: 'maria@drafthouse.test', REGRID_API_TOKEN: '', PARCEL_DAILY_CHECK: '0', PARCEL_FIELD_CHECK: '0', PLAT_PRUNE: '0', PORT: String(port), DATA_DIR: dataDir, ALLOWED_ORIGINS: '*', ...env } })
  for (let i = 0; i < 150; i++) {
    try {
      await fetch(`${base}/api/health`)
      return { base, dataDir }
    } catch {
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  throw new Error('the office API did not start')
}
async function who(base, email, name) {
  const { token } = await (await fetch(base + '/api/auth/dev-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, name: name || email.split('@')[0] }) })).json()
  const h = { 'content-type': 'application/json', authorization: `Bearer ${token}` }
  return { token, get: (p) => fetch(base + p, { headers: h }), post: (p, b = {}) => fetch(base + p, { method: 'POST', headers: h, body: JSON.stringify(b) }), put: (p, b = {}) => fetch(base + p, { method: 'PUT', headers: h, body: JSON.stringify(b) }) }
}
const typedLot = (rec, w = 80, d = 140) => ({ ...buildLot(platFromTyped({ kind: 'manual', address: '', width: w, depth: d, city: '', county: 'Hidalgo', frontStreet: 'Test St', corner: '', sideStreet: '', setbacks: {} }, rec)), plat: rec })

test('D2: a signed-out upload is 401 and stores nothing; signed in it is 200', async (t) => {
  const { base, dataDir } = await startApi(t)
  const anon = await fetch(base + '/api/lot/plat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'x.png', data: png() }) })
  assert.equal(anon.status, 401)
  assert.equal((await anon.json()).signIn, true)
  assert.ok(!fs.existsSync(path.join(dataDir, 'files', 'plats')), 'nothing was stored')
  const ana = await who(base, 'ana.r15@example.com')
  assert.equal((await ana.post('/api/lot/plat', { name: 'x.png', data: png() })).status, 200)
})

test('B1: 12 uploads sent at once from one account with a limit of 3 and a reader that takes 3 s give exactly 3 × 200 and 9 × 429, and exactly 3 reads', { timeout: 60000 }, async (t) => {
  const { base } = await startApi(t, { DRAFTHOUSE_TEST_ROUTES: '1', DRAFTHOUSE_TEST_PLAT_READER_MS: '3000', PLAT_UPLOADS_PER_10MIN: '3' })
  const ana = await who(base, 'ana.b1@example.com')
  const t0 = Date.now()
  const all = await Promise.all(Array.from({ length: 12 }, (_, i) => ana.post('/api/lot/plat', { name: `p${i}.png`, data: png() })))
  const codes = all.map((r) => r.status).sort()
  assert.deepEqual(codes, [200, 200, 200, ...Array(9).fill(429)])
  assert.ok(Date.now() - t0 >= 2900, 'the reads really were slow')
  const reads = (await (await fetch(base + '/api/_test/boom?mode=reads')).json()).reads
  assert.equal(reads, 3, 'the stand-in reader was called exactly 3 times')
  for (const r of all.filter((x) => x.status === 429)) assert.match((await r.json()).error, /^Too many files at once\./)
  // a refused file gives its slot back: another account with a limit of 3 sends 2 text files, then 3 plats, all taken
  const bea = await who(base, 'bea.b1@example.com')
  for (let i = 0; i < 2; i++) assert.equal((await bea.post('/api/lot/plat', { name: 'notes.txt', data: Buffer.from('hello').toString('base64') })).status, 400)
  const three = await Promise.all([0, 1, 2].map((i) => bea.post('/api/lot/plat', { name: `b${i}.png`, data: png() })))
  assert.deepEqual(three.map((r) => r.status), [200, 200, 200])
  assert.equal((await bea.post('/api/lot/plat', { name: 'b3.png', data: png() })).status, 429)
})

test('B2: the office record decides. A forged "read" on an unread plat is shown as "Plat not read"; an outline that is not the read one is marked; an unknown plat id is 400', async (t) => {
  // reader on (the test stand-in answers 80 by 140 at once) for the read case; off for the unread case
  const on = await startApi(t, { DRAFTHOUSE_TEST_ROUTES: '1', DRAFTHOUSE_TEST_PLAT_READER_MS: '0' })
  const off = await startApi(t)
  // 1. unread plat, the browser claims it was read and sends a 71,834 sf outline with no typedBy
  const ana = await who(off.base, 'ana.b2@example.com')
  const maria = await who(off.base, 'maria@drafthouse.test')
  const rec = await (await ana.post('/api/lot/plat', { name: 'mine.png', data: png() })).json()
  assert.equal(rec.unread, true)
  const big = { ...typedLot(rec, 266, 270), plat: { ...rec, unread: false, calls: [], confidence: 0.99 } }
  delete big.spec.typedBy
  delete big.spec.typed
  big.spec.confirmed = true
  const made = await ana.post('/api/projects', { lot: big, stage: 'style', client: 'Ana' })
  assert.equal(made.status, 201)
  const prj = await made.json()
  assert.equal(prj.lot.plat.unread, true, 'the office record, not the browser')
  assert.equal(prj.lot.spec.typedBy, 'homeowner')
  assert.equal(prj.lot.spec.confirmed, false)
  assert.deepEqual([prj.lot.spec.typed.width, prj.lot.spec.typed.depth], [266, 270])
  const row = (await (await maria.get('/api/review')).json()).lots.find((p) => p.id === prj.id)
  assert.ok(row && row.lot.plat.unread && row.lot.spec.typedBy === 'homeowner', 'the queue marks it "Plat not read"')
  // 2. a read plat, and an outline that is not the one read (80 by 140 read, 200 by 300 sent)
  const ben = await who(on.base, 'ben.b2@example.com')
  const read = await (await ben.post('/api/lot/plat', { name: 'read.png', data: png() })).json()
  assert.equal(read.unread, undefined)
  assert.equal(read.areaSf, 11200)
  const same = await (await ben.post('/api/projects', { lot: { ...buildLot({ kind: 'plat', calls: read.calls, streets: read.streets, front: read.front, city: '', county: 'Hidalgo', platId: read.platId }), plat: read }, stage: 'style' })).json()
  assert.equal(same.lot.spec.outlineBy, 'plat')
  assert.equal(same.lot.spec.typedBy, undefined)
  const other = await (await ben.post('/api/projects', { lot: { ...typedLot(read, 200, 300), plat: read }, stage: 'style' })).json()
  assert.equal(other.lot.spec.typedBy, 'homeowner')
  assert.equal(other.lot.plat.unread, undefined)
  assert.ok(other.lot.spec.outlineGapFt > 100, `the gap is recorded (${other.lot.spec.outlineGapFt} ft)`)
  assert.equal(other.lot.spec.platAreaSf, 11200)
  // 3. a plat id the office does not have, and a plat lot with no plat
  const fake = await ana.post('/api/projects', { lot: typedLot({ platId: 'plat_0000000000' }), stage: 'style' })
  assert.equal(fake.status, 400)
  assert.match((await fake.json()).error, /^We do not have that plat\./)
  const none = typedLot(rec)
  delete none.spec.platId
  const noPlat = await ana.post('/api/projects', { lot: none, stage: 'style' })
  assert.equal(noPlat.status, 400)
  assert.match((await noPlat.json()).error, /^A lot from a plat needs its plat\./)
})

test('B3: a plat opens for its uploader, a house owner using it and the office only, with nosniff and its own inline name; another account cannot attach it', async (t) => {
  const { base } = await startApi(t)
  const ana = await who(base, 'ana.b3@example.com')
  const bob = await who(base, 'bob.b3@example.com')
  const maria = await who(base, 'maria@drafthouse.test')
  const rec = await (await ana.post('/api/lot/plat', { name: 'Owner Name survey.png', data: png() })).json()
  assert.equal(rec.name, undefined, 'P4: the file name is not sent back')
  assert.equal(rec.label, 'Plat (photo)')
  const url = `/api/lot/plat/${rec.platId}`
  assert.equal((await fetch(base + url)).status, 401, 'signed out')
  assert.equal((await bob.get(url)).status, 404, 'another homeowner')
  for (const [who_, r] of [['the uploader', await ana.get(url)], ['the drafter', await maria.get(url)]]) {
    assert.equal(r.status, 200, who_)
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff', who_)
    assert.equal(r.headers.get('content-disposition'), 'inline; filename="plat.png"', who_)
    assert.equal(r.headers.get('content-type'), 'image/png')
  }
  // a "%PDF" file with HTML after it is served as a PDF download-or-view, never sniffed as a page
  const pdfish = await (await ana.post('/api/lot/plat', { name: 'x.pdf', data: Buffer.from('%PDF-1.4\n<html><script>alert(1)</script></html>').toString('base64') })).json()
  const served = await ana.get(`/api/lot/plat/${pdfish.platId}`)
  assert.equal(served.headers.get('content-type'), 'application/pdf')
  assert.equal(served.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(served.headers.get('content-disposition'), 'inline; filename="plat.pdf"')
  // Bob saves a house pointing at Ana's plat: refused
  const stolen = await bob.post('/api/projects', { lot: typedLot(rec), stage: 'style' })
  assert.equal(stolen.status, 400)
  assert.match((await stolen.json()).error, /^That plat was uploaded from another account\./)
  // Ana's own house with it is fine, and the drafter sees the original name inside the card only
  const prj = await (await ana.post('/api/projects', { lot: typedLot(rec), stage: 'style' })).json()
  assert.ok(prj.id)
  assert.doesNotMatch(JSON.stringify(prj), /Owner Name/, 'the homeowner view carries no file name')
  const inbox = await (await maria.get('/api/review')).json()
  assert.doesNotMatch(JSON.stringify(inbox), /Owner Name/, 'the queue carries no file name')
  const detail = await (await maria.get(`/api/projects/${prj.id}`)).json()
  assert.equal(detail.platFile.name, 'Owner Name survey.png')
  // the activity log never names the file
  const over = await (await maria.get('/api/admin/overview')).json()
  assert.doesNotMatch(JSON.stringify(over.events), /Owner Name/)
})

test('U7: an upload no house uses is removed after 30 days; one a house uses stays; the health page shows the disk', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-r15-prune-'))
  const files = localFiles(dir)
  const m = new Map()
  const store = { meta: { get: async (k) => (m.has(k) ? structuredClone(m.get(k)) : null), set: async (k, v) => m.set(k, structuredClone(v)) } }
  const events = []
  const lots = makeLots({ store, files, interpreter: { configured: false }, event: async (k, x) => events.push(x), log: () => {}, env: {}, fetchImpl: async () => new Response('{}') })
  const orphan = await lots.readPlat({ name: 'a.png', data: png() }, { owner: 'u1' })
  const used = await lots.readPlat({ name: 'b.png', data: png() }, { owner: 'u1' })
  await lots.platUsed(used.platId, 'prj_1')
  const day = 86400000
  const t0 = Date.parse(orphan.at)
  assert.deepEqual(await lots.prunePlats({ t: t0 + 29 * day }), [], 'kept for 29 days')
  assert.deepEqual(await lots.prunePlats({ t: t0 + 31 * day }), [orphan.platId], 'gone after 30 days')
  assert.equal(await files.get('plats', `${orphan.platId}.png`), null)
  assert.equal(await lots.plat(orphan.platId), null, 'its id is never served again')
  assert.ok(await files.get('plats', `${used.platId}.png`), 'the one a house uses stays')
  assert.ok(await lots.plat(used.platId))
  assert.match(events.at(-1), /removed 1 uploaded plat no house used in 30 days/)
  const ping = await files.ping()
  assert.match(ping.detail, /^\d+ files, [\d.]+ MB on disk \(uploaded plats: 1 files, [\d.]+ MB\)$/)
})

test('U7: a day cap per account holds after the ten-minute window has room again', async (t) => {
  const { base } = await startApi(t, { PLAT_UPLOADS_PER_10MIN: '50', PLAT_UPLOADS_PER_DAY: '4' })
  const ana = await who(base, 'ana.day@example.com')
  const codes = []
  for (let i = 0; i < 5; i++) codes.push((await ana.post('/api/lot/plat', { name: `d${i}.png`, data: png() })).status)
  assert.deepEqual(codes, [200, 200, 200, 200, 429])
})
