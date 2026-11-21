// Fix round 15, B4 (office decision): a homeowner can ALWAYS press Send. When the lot is not confirmed yet, the Send
// step says in one plain line that the drafter checks it first, and Send puts the house in the drafter's queue as
// "Lot to confirm + plan". The drafter confirms the lot before approving; a lot the drafter corrects sends the plan
// back with a plain note. The office API answers from the recordings; nothing reaches the internet.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnGroup, freePort } from './browser.mjs'
import { buildLot } from '../src/draft/lib/lot.js'
import { parcelSpec } from '../src/draft/lib/parcel-spec.js'
import { DEFAULT_PROGRAM, generateRooms } from '../src/draft/lib/layout.js'
import { STYLES } from '../src/draft/lib/styles.js'
import { fixtureEnv } from './server-env.mjs'

async function startApi(t) {
  const port = await freePort()
  const base = `http://127.0.0.1:${port}`
  spawnGroup(t, process.execPath, ['server/index.mjs'], { env: { ...fixtureEnv, DRAFTHOUSE_CLAUDE_KEY: '', ANTHROPIC_API_KEY: '', DATABASE_URL: '', SUPABASE_URL: '', RESEND_API_KEY: '', DRAFTHOUSE_APP_KEY: '', DRAFTHOUSE_WORKER_KEY: 'wk', DRAFTHOUSE_DRAFTERS: 'maria@drafthouse.test', REGRID_API_TOKEN: '', PARCEL_DAILY_CHECK: '0', PARCEL_FIELD_CHECK: '0', PLAT_PRUNE: '0', PORT: String(port), DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dh-r15-send-')), ALLOWED_ORIGINS: '*' } })
  for (let i = 0; i < 150; i++) {
    try {
      await fetch(`${base}/api/health`)
      return base
    } catch {
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  throw new Error('the office API did not start')
}
async function who(base, email) {
  const { token } = await (await fetch(base + '/api/auth/dev-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, name: email.split('@')[0] }) })).json()
  const h = { 'content-type': 'application/json', authorization: `Bearer ${token}` }
  return { get: (p) => fetch(base + p, { headers: h }), post: (p, b = {}) => fetch(base + p, { method: 'POST', headers: h, body: JSON.stringify(b) }) }
}

test('B4: Send goes through on a lot not confirmed yet; the queue says "Lot to confirm + plan"; approval waits for the lot; confirming it unchanged keeps the plan waiting and approval then works', async (t) => {
  const base = await startApi(t)
  const ana = await who(base, 'ana.b4@example.com')
  const maria = await who(base, 'maria@drafthouse.test')
  const address = '1201 Kerria Ave, McAllen, TX 78501'
  const parcel = await (await ana.get(`/api/lot/parcel?address=${encodeURIComponent(address)}`)).json()
  const lot = buildLot(parcelSpec(parcel, { address, city: 'mcallen', county: 'Hidalgo County' }))
  const style = STYLES.find((s) => s.id === 'farmhouse') || STYLES[0]
  const program = { ...DEFAULT_PROGRAM, sqft: 1600, beds: 3, baths: 2, halfBath: false, office: false }
  const prj = await (await ana.post('/api/projects', { lot, style: { id: style.id, name: style.name }, program, rooms: generateRooms(program, style, lot) })).json()
  assert.equal(prj.lot.spec.confirmed, false)
  const sent = await ana.post(`/api/projects/${prj.id}/send`, { design: { contract: 1, client: 'Ana' } })
  assert.equal(sent.status, 200, 'never a dead end: ' + (await sent.clone().text()).slice(0, 300))
  const after = await sent.json()
  assert.equal(after.status, 'in_review')
  assert.equal(after.lotPending, true)
  const inbox = await (await maria.get('/api/review')).json()
  const row = inbox.waiting.find((p) => p.id === prj.id)
  assert.ok(row, 'in "Waiting for you"')
  assert.equal(row.lot.spec.confirmed, false, 'the row shows "Lot to confirm + plan"')
  assert.ok(!inbox.lots.some((p) => p.id === prj.id), 'listed once')
  const early = await maria.post(`/api/review/${prj.id}`, { decision: 'approved' })
  assert.equal(early.status, 409)
  assert.match((await early.json()).error, /^Confirm the lot first/)
  const conf = await (await maria.post(`/api/review/${prj.id}/lot`, { confirmed: true })).json()
  assert.equal(conf.status, 'in_review', 'confirmed as it was: the plan stays with the drafter')
  assert.equal(conf.lotPending, undefined)
  const ok = await maria.post(`/api/review/${prj.id}`, { decision: 'approved' })
  assert.equal(ok.status, 200)
  assert.equal((await ok.json()).status, 'approved')
})

test('B4 (screen): the Send button is always there, with one plain line about the lot, in English and Spanish; the queue row and the approve button say what is waiting', () => {
  const send = fs.readFileSync('src/draft/screens/Send.jsx', 'utf8')
  assert.match(send, /Our drafter will check your lot first, usually within 1 business day\. You don't need to do anything\./)
  assert.doesNotMatch(send, /\{!lotWaiting && \(\s*<Button primary/, 'the button is not hidden while the lot waits')
  assert.doesNotMatch(send, /e\.body\?\.lotPending/)
  const es = fs.readFileSync('src/draft/lib/i18n-es.js', 'utf8')
  assert.match(es, /Nuestro dibujante revisa tu lote primero, por lo general en 1 día hábil\. No tienes que hacer nada\./)
  const review = fs.readFileSync('src/draft/screens/Review.jsx', 'utf8')
  assert.match(review, /Lot to confirm \+ plan/)
  assert.match(review, /data-testid="approve-needs-lot"/)
})

test('B5: a plat uploaded with no address and nothing typed is saved at once and shows in the drafter queue with its file; only its own account can save it', async (t) => {
  const base = await startApi(t)
  const ana = await who(base, 'ana.b5@example.com')
  const bob = await who(base, 'bob.b5@example.com')
  const maria = await who(base, 'maria@drafthouse.test')
  const rec = await (await ana.post('/api/lot/plat', { name: 'x.png', data: fs.readFileSync('test/fixtures/garza-site-plan.png').toString('base64') })).json()
  assert.equal((await bob.post('/api/projects', { platId: rec.platId })).status, 400, 'not another account\'s plat')
  const made = await ana.post('/api/projects', { platId: rec.platId })
  assert.equal(made.status, 201)
  const prj = await made.json()
  assert.equal(prj.stage, 'lot')
  assert.equal(prj.lot, null)
  const row = (await (await maria.get('/api/review')).json()).lots.find((p) => p.id === prj.id)
  assert.ok(row, 'in "Lots to confirm" straight away')
  assert.equal(row.platId, rec.platId)
  assert.equal((await maria.get(`/api/lot/plat/${rec.platId}`)).status, 200, 'the drafter opens the file')
  const review = fs.readFileSync('src/draft/screens/Review.jsx', 'utf8')
  assert.match(review, /Plat not read, nothing typed yet/)
  assert.match(review, /data-testid="plat-only-card"/)
})
