// Fix round 14, from a homeowner's screenshot of the live site: a plat was uploaded with no address typed.
//   1  the house is never given another lot's name ("Lot 514, Villa-Rama East Phase V") as its address
//   2  a plat the office cannot read (no reader key, the reader failed, no outline found) is KEPT for the drafter;
//      the homeowner is never told about the office's key, and never loses the file
//   3  no lot is shown as the homeowner's before there is one: no 100 by 150 guess with real-looking square feet,
//      and "Looks right, pick a style" stays off until there is a lot
//   4  the homeowner keeps going: by the address (the county parcel, with the plat attached) or by the width and
//      depth printed on the plat; either way the drafter's card says the plat was not read and links the file
//   5  plain words: an address that is not found is not "the Census geocoder", rules to be checked are not
//      "office defaults, unverified", and what the reader cost the office never reaches the browser
// The office API answers from the recordings; nothing reaches the internet. Browser tests skip when no Chrome is found.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromePath, startPreview, appContext, spawnGroup, freePort, shotDir } from './browser.mjs'
import { buildLot, platFromTyped, lotProblem } from '../src/draft/lib/lot.js'
import { makeLots } from '../server/lots.mjs'
import { edgeLabelOffset } from '../src/draft/lib/camera.js'
import { fixtureEnv } from './server-env.mjs'

const CHROME = chromePath()
const skip = !CHROME && 'no Chrome found (set CHROME=/path/to/chrome)'
const OUT = shotDir('round14')
const PLAT = 'test/fixtures/garza-site-plan.png'
const OFFICE_WORDS = /Claude|API key|office key|reader needs|503|Census geocoder|unverified|Lot 514|Villa-Rama/i

async function startApi(t, env = {}) {
  const port = await freePort()
  const apiBase = `http://127.0.0.1:${port}`
  spawnGroup(t, process.execPath, ['server/index.mjs'], { env: { ...fixtureEnv, DRAFTHOUSE_CLAUDE_KEY: '', ANTHROPIC_API_KEY: '', DATABASE_URL: '', SUPABASE_URL: '', RESEND_API_KEY: '', DRAFTHOUSE_APP_KEY: '', DRAFTHOUSE_WORKER_KEY: 'wk', DRAFTHOUSE_DRAFTERS: 'maria@drafthouse.test', REGRID_API_TOKEN: '', PARCEL_DAILY_CHECK: '0', PARCEL_FIELD_CHECK: '0', PORT: String(port), DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dh-r14-')), ALLOWED_ORIGINS: '*', ...env } })
  for (let i = 0; i < 150; i++) {
    try {
      await fetch(`${apiBase}/api/health`)
      return apiBase
    } catch {
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  throw new Error('the office API did not start')
}
async function who(base, email, name) {
  const { token } = await (await fetch(base + '/api/auth/dev-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, name: name || email.split('@')[0] }) })).json()
  const h = { 'content-type': 'application/json', authorization: `Bearer ${token}` }
  return { get: (p) => fetch(base + p, { headers: h }), post: (p, b = {}) => fetch(base + p, { method: 'POST', headers: h, body: JSON.stringify(b) }) }
}
const memStore = () => {
  const m = new Map()
  return { meta: { get: async (k) => (m.has(k) ? m.get(k) : null), set: async (k, v) => m.set(k, v) } }
}
const png = () => fs.readFileSync(PLAT).toString('base64')

test('1 and 3 (unit): a rectangle typed off an unread plat is a plat lot the drafter confirms, the same shape as the typed lot', () => {
  const typed = { kind: 'manual', address: '', width: 80, depth: 140, city: 'mcallen', frontStreet: 'Showers Rd', corner: '', sideStreet: '', setbacks: {} }
  const spec = platFromTyped(typed, { platId: 'plat_abc', unread: true })
  assert.equal(spec.kind, 'plat')
  assert.equal(spec.confirmed, false, 'a drafter confirms it against the file')
  assert.equal(spec.platId, 'plat_abc')
  assert.equal(spec.typedBy, 'homeowner')
  assert.deepEqual(spec.typed, { width: 80, depth: 140, frontStreet: 'Showers Rd', corner: '', sideStreet: '' })
  const a = buildLot(typed)
  const b = buildLot(spec)
  assert.equal(b.confirmed, false)
  assert.equal(Math.round(b.areaSf), Math.round(a.areaSf))
  assert.equal(Math.round(b.envelopeSf), Math.round(a.envelopeSf))
  assert.deepEqual(b.edges.map((e) => e.kind), a.edges.map((e) => e.kind))
  assert.deepEqual(b.envelope, a.envelope)
  assert.equal(lotProblem(spec, b), null)
  // a corner lot keeps its second street as a street side
  const corner = buildLot(platFromTyped({ ...typed, corner: 'right', sideStreet: 'Mile 2 Rd' }, { platId: 'plat_abc' }))
  assert.deepEqual(corner.edges.map((e) => e.kind), buildLot({ ...typed, corner: 'right', sideStreet: 'Mile 2 Rd' }).edges.map((e) => e.kind))
})

test('6 (unit): the words on a narrow side yard no longer sit on the property line', () => {
  for (const text of [4, 5.2, 8]) {
    // a strip wide enough holds its words between the two lines, clear of both by a quarter of the letters at least
    for (const strip of [20, 25, 40].filter((st) => st >= text * 1.7)) {
      const off = edgeLabelOffset(strip, text)
      assert.ok(off - text / 2 >= 0 && off + text / 2 <= strip, `${strip} ft strip, ${text} ft letters: inside the strip (${off})`)
    }
    // a 5 or 6 ft side yard cannot: the words go outside the lot, clear of the red line (they used to straddle it)
    for (const strip of [5, 6]) {
      const off = edgeLabelOffset(strip, text)
      assert.ok(off - text / 2 >= strip + text * 0.3, `${strip} ft strip, ${text} ft letters: outside the property line (${off})`)
      const before = Math.max(2, text) // round 13: always this far out, whatever the strip
      assert.ok(before - text / 2 < strip && before + text / 2 >= strip, 'before: the words reached or crossed the property line')
    }
  }
  assert.ok(Number.isFinite(edgeLabelOffset(undefined, 4)))
})

test('2 and 5 (unit): the reader off, failing or finding no outline keeps the file and says so to the office only; a good read carries no cost to the browser', async () => {
  const run = async (interpreter) => {
    const store = memStore()
    const events = []
    const put = []
    const lots = makeLots({ store, fetchImpl: async () => new Response('{}'), files: { putRaw: async (k, buf) => put.push([k, buf.length]) }, interpreter, event: async (kind, text) => events.push(text), log: () => {}, env: {} })
    const out = await lots.readPlat({ name: 'Survey Lot 539.png', data: png() })
    return { out, events, put, stored: await lots.plat(out.platId) }
  }
  // no key on this server
  const off = await run({ configured: false })
  assert.equal(off.out.unread, true)
  assert.match(off.out.platId, /^plat_[0-9a-f]{10}$/)
  assert.equal(off.put.length, 1, 'the file is kept')
  assert.equal(off.stored.why, 'no-reader')
  assert.match(off.events[0], /saved, not read .*DRAFTHOUSE_CLAUDE_KEY/)
  // round 15, P4: no file name either (it can carry an owner's name); a plain label instead
  assert.deepEqual(Object.keys(off.out).sort(), ['at', 'ext', 'label', 'platId', 'unread'], 'the browser gets no reason')
  assert.doesNotMatch(JSON.stringify(off.out), OFFICE_WORDS)
  // the reader did not answer
  const down = await run({ configured: true, parseDocument: async () => { throw new Error('overloaded_error: try later') } })
  assert.equal(down.out.unread, true)
  assert.equal(down.stored.why, 'reader-failed')
  assert.equal(down.put.length, 1)
  assert.doesNotMatch(JSON.stringify(down.out), /overloaded/)
  // the reader found two sides: not an outline
  const two = await run({ configured: true, parseDocument: async () => ({ calls: [{ bearing: `N 00°00'00" E`, distance: 100 }, { bearing: `N 90°00'00" E`, distance: 50 }], confidence: 0.2, cost: 0.031, usage: { input_tokens: 1 }, ms: 9 }) })
  assert.equal(two.out.unread, true)
  assert.equal(two.stored.why, 'no-outline')
  assert.equal(two.stored.calls.length, 2, 'what the reader found stays for the drafter')
  assert.equal(two.out.calls, undefined)
  // a good read: the outline goes to the browser, the reader's cost and token counts do not
  const good = await run({ configured: true, parseDocument: async () => ({ lotNumber: 'Lot 539', calls: platFromTyped({ width: 80, depth: 140 }, {}).calls, streets: [], front: 2, confidence: 0.9, cost: 0.031, usage: { input_tokens: 1 }, ms: 9 }) })
  assert.equal(good.out.unread, undefined)
  assert.equal(good.out.calls.length, 4)
  assert.equal(good.out.areaSf, 11200)
  for (const k of ['cost', 'usage', 'ms', 'why']) assert.equal(k in good.out, false, `${k} stays on the server`)
  assert.equal(good.stored.cost, 0.031, 'the office keeps what the read cost')
})

test('5 (unit): an address that is not found is said in plain words', async () => {
  const lots = makeLots({ store: memStore(), fetchImpl: async () => new Response(JSON.stringify({ result: { addressMatches: [] } }), { status: 200, headers: { 'content-type': 'application/json' } }), files: {}, interpreter: {}, event: async () => {}, log: () => {}, env: {} })
  const g = await lots.geocode('1 Nowhere At All Rd, Mission, TX')
  assert.equal(g.found, false)
  assert.match(g.note, /^We could not find this address\./)
  assert.doesNotMatch(g.note, /Census|geocoder/i)
  const lotScreen = fs.readFileSync('src/draft/screens/Lot.jsx', 'utf8')
  assert.doesNotMatch(lotScreen, /office defaults, unverified/)
  assert.doesNotMatch(fs.readFileSync('src/draft/screens/Start.jsx', 'utf8'), /Lot 514|Villa-Rama/, 'no lot is named for the homeowner')
})

test('2 and 4 (HTTP): with no reader key the upload is 200 and kept; the typed-off-the-plat lot is saved as a plat lot, waits in the drafter queue with its file, and the drafter confirms it', async (t) => {
  const base = await startApi(t, { PLAT_UPLOADS_PER_10MIN: '3' })
  const ana = await who(base, 'ana.r14@example.com', 'Ana Plat')
  const maria = await who(base, 'maria@drafthouse.test', 'Maria Drafter')
  const up = await ana.post('/api/lot/plat', { name: 'HLG20-099 SurveyPlat Lot 539.png', data: png() })
  assert.equal(up.status, 200, 'never a 503 to a homeowner')
  const rec = await up.json()
  assert.equal(rec.unread, true)
  assert.doesNotMatch(JSON.stringify(rec), OFFICE_WORDS)
  // the file is there for the drafter
  // round 15, B3: the file opens for the account that uploaded it (signed out it is 401)
  assert.equal((await fetch(`${base}/api/lot/plat/${rec.platId}`)).status, 401)
  const file = await ana.get(`/api/lot/plat/${rec.platId}`)
  assert.equal(file.status, 200)
  assert.equal(file.headers.get('content-type'), 'image/png')
  assert.equal((await file.arrayBuffer()).byteLength, fs.statSync(PLAT).size)
  // something that is not a plat is refused in a sentence
  const bad = await ana.post('/api/lot/plat', { name: 'notes.txt', data: Buffer.from('hello there').toString('base64') })
  assert.equal(bad.status, 400)
  assert.match((await bad.json()).error, /^That file is not a PDF or a photo\./)
  // the homeowner types what the plat shows: 80 by 140 on Showers Rd
  const spec = platFromTyped({ kind: 'manual', address: '', width: 80, depth: 140, city: '', county: 'Hidalgo', frontStreet: 'Showers Rd', corner: '', sideStreet: '', setbacks: {} }, rec)
  const lot = { ...buildLot(spec), plat: rec }
  const made = await ana.post('/api/projects', { lot, stage: 'style', client: 'Ana Plat' })
  assert.equal(made.status, 201)
  const prj = await made.json()
  assert.equal(prj.lot.spec.kind, 'plat')
  assert.equal(prj.lot.spec.typedBy, 'homeowner')
  assert.equal(prj.lot.spec.platId, rec.platId)
  assert.equal(prj.lot.spec.confirmed, false)
  assert.equal(prj.lot.plat.unread, true)
  assert.doesNotMatch(prj.address || '', /Lot 514/)
  // the drafter's queue has it, and the drafter confirms it against the file
  const inbox = await (await maria.get('/api/review')).json()
  const mine = (inbox.lots || []).find((p) => p.id === prj.id)
  assert.ok(mine, 'in "lots to confirm"')
  assert.equal(mine.lot.spec.typedBy, 'homeowner')
  const ok = await maria.post(`/api/review/${prj.id}/lot`, { confirmed: true, note: 'checked against the plat: 80 by 140' })
  assert.equal(ok.status, 200)
  assert.equal((await ok.json()).lot.spec.confirmed, true)
  // the office's activity says why the plat was not read; the homeowner's project does not
  const over = await (await maria.get('/api/admin/overview')).json()
  assert.ok((over.events || []).some((e) => /saved, not read .*no Claude key/.test(e.text || e.message || JSON.stringify(e))), 'the office sees the reason')
  const again = await (await ana.get(`/api/projects/${prj.id}`)).json()
  assert.doesNotMatch(JSON.stringify(again), /no-reader|Claude key/)
  // uploads are counted (found on the way: they were neither counted nor behind a sign-in): the fourth in ten
  // minutes from one account waits, in a sentence; a refused file was not counted, and another account is not held up
  for (let i = 0; i < 2; i++) assert.equal((await ana.post('/api/lot/plat', { name: `again-${i}.png`, data: png() })).status, 200)
  const fourth = await ana.post('/api/lot/plat', { name: 'fourth.png', data: png() })
  assert.equal(fourth.status, 429)
  assert.match((await fourth.json()).error, /^Too many files at once\. Wait a few minutes and try again, or type the lot in\.$/)
  const bea = await who(base, 'bea.r14@example.com', 'Bea Plat')
  assert.equal((await bea.post('/api/lot/plat', { name: 'bea.png', data: png() })).status, 200)
})

const signIn = async (page, name, email) => {
  await page.locator('#signin-email').waitFor({ timeout: 20000 })
  if (await page.locator('#signin-name').count()) await page.locator('#signin-name').fill(name)
  await page.locator('#signin-email').fill(email)
  await page.getByRole('button', { name: /Continue|Email me/ }).click()
  await page.locator('#start-address').waitFor({ timeout: 20000 })
}
const signOut = async (page) => {
  if (await page.getByTestId('account').isVisible().catch(() => false)) {
    await page.getByTestId('account').locator('summary').click()
    await page.locator('.dh-account-menu').getByRole('button', { name: 'Sign out' }).click()
  } else await page.getByRole('button', { name: 'Sign out' }).first().click()
  await page.locator('#signin-email').waitFor({ timeout: 20000 })
}
/** Nothing on the page is cut off sideways. */
const noSideScroll = async (page) => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no sideways scroll')

for (const [w, h] of [
  [1440, 900],
  [390, 844],
]) {
  test(`screens at ${w} px: a plat with no address and no reader. Nobody else's lot is shown, the file is saved for the drafter, and the homeowner goes on by typing the plat's width and depth`, { skip, timeout: 300000 }, async (t) => {
    const appBase = await startPreview(t)
    const apiBase = await startApi(t)
    const { chromium } = await import('playwright-core')
    const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
    t.after(() => browser.close())
    const ctx = await appContext(browser, apiBase, { viewport: { width: w, height: h }, deviceScaleFactor: 1 })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    const refused = [] // an office answer of 400 or more on the way is a failure of its own
    page.on('response', async (r) => {
      if (r.url().includes('/api/') && r.status() >= 400) refused.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname} ${(await r.text().catch(() => '')).slice(0, 200)}`)
    })
    await page.goto(appBase, { waitUntil: 'domcontentloaded' })
    await signIn(page, 'Rosa Plat', `rosa.${w}@example.com`)
    // only the plat: no address is typed
    await page.locator('.start .drop input[type=file]').setInputFiles(PLAT)
    await page.getByTestId('start-file-only').waitFor({ timeout: 10000 })
    await page.getByRole('button', { name: 'Find my lot' }).click()
    const saved = page.getByTestId('plat-saved')
    await saved.waitFor({ timeout: 30000 })
    const body = async () => await page.locator('#root').innerText()
    let text = await body()
    assert.doesNotMatch(text, OFFICE_WORDS, 'no office words, and nobody else\'s lot')
    assert.doesNotMatch(text, /15,000|10,350|7,500/, 'no square feet of a lot that is not theirs')
    assert.match(await saved.innerText(), /Your plat is saved for the drafter/i)
    assert.match(await saved.innerText(), /add your street address above .* or type the width and depth printed on the plat/i)
    await page.getByTestId('lot-wait').waitFor({ timeout: 5000 })
    assert.equal(await page.getByTestId('lot-tag').count(), 0, 'no lot name over an empty drawing')
    assert.equal(await page.locator('.stats').count(), 0, 'no lot numbers before there is a lot')
    assert.ok(await page.getByTestId('lot-next').isDisabled(), '"Looks right" is off: there is no lot yet')
    assert.equal(await page.locator('#lot-confirm').count(), 0)
    await noSideScroll(page)
    await page.screenshot({ path: `${OUT}/1-plat-saved-no-lot-yet-${w}.png`, fullPage: w < 600 })
    // she types what the plat shows
    await page.locator('#lot-width').fill('80')
    await page.locator('#lot-depth').fill('140')
    await page.locator('#lot-street').fill('Showers Rd')
    await page.locator('.stats').waitFor({ timeout: 10000 })
    assert.equal(await page.getByTestId('lot-wait').count(), 0)
    text = await body()
    assert.match(text, /11,200/)
    assert.match(text, /A drafter confirms the lot before the design is sent on/)
    assert.doesNotMatch(text, OFFICE_WORDS)
    assert.doesNotMatch(await page.getByTestId('lot-tag').textContent(), /514/) // the tag is hidden on a phone
    await page.waitForTimeout(1500)
    await noSideScroll(page)
    await page.screenshot({ path: `${OUT}/2-lot-from-the-plat-numbers-${w}.png`, fullPage: w < 600 })
    // round 15 (U18) asks for no silent city when nothing tells us one: the homeowner picks it, then goes on
    assert.ok(await page.getByTestId('lot-next').isDisabled(), 'not before the city is picked')
    await page.locator('#lot-city').selectOption('mcallen')
    assert.ok(await page.getByTestId('lot-next').isEnabled())
    await page.getByTestId('lot-next').click()
    await page.getByTestId('style-farmhouse').waitFor({ timeout: 20000 })
    await page.waitForTimeout(1200)
    assert.deepEqual(refused, [], 'the office took everything the homeowner sent')
    // back on the lot step the numbers she typed are still there, and so is the saved plat
    await page.goBack()
    await page.locator('#lot-width').waitFor({ timeout: 20000 })
    assert.equal(await page.locator('#lot-width').inputValue(), '80')
    assert.equal(await page.locator('#lot-depth').inputValue(), '140')
    await page.getByTestId('plat-saved').waitFor({ timeout: 5000 })
    await signOut(page)
    // the drafter: the queue says the plat was not read, the card says what was typed and links the file
    await page.locator('#signin-email').fill('maria@drafthouse.test')
    if (await page.locator('#signin-name').count()) await page.locator('#signin-name').fill('Maria Drafter')
    await page.getByRole('button', { name: /Continue|Email me/ }).click()
    await page.locator('#signin-email').waitFor({ state: 'detached', timeout: 20000 })
    await page.goto(appBase + '/#/review', { waitUntil: 'domcontentloaded' })
    const row = page.getByTestId('row-plat-unread').first()
    await row.waitFor({ timeout: 30000 })
    // round 15, P4: the row says what it is and when, never the uploaded file's own name
    assert.match(await page.locator('.inbox-row').first().innerText(), /no address · Plat \(photo\), \d{4}-\d{2}-\d{2}/, 'the row says a plat came with no address')
    assert.doesNotMatch(await page.locator('.inbox-row').first().innerText(), /garza-site-plan/)
    await noSideScroll(page)
    await page.screenshot({ path: `${OUT}/3-drafter-queue-plat-not-read-${w}.png`, fullPage: w < 600 })
    await row.click()
    const card = page.getByTestId('lot-card')
    await card.waitFor({ timeout: 20000 })
    assert.match(await page.getByTestId('plat-unread').innerText(), /Plat not read by the office\. The homeowner typed 80 by 140 ft/)
    // the checklist at the top of the card says the same, not "Read from the plat"
    const list = await page.getByTestId('review-checklist').innerText()
    assert.match(list, /Plat not read by the office: the homeowner typed 80 by 140 ft from it\. Open the plat and check the outline\./)
    assert.doesNotMatch(list, /Read from the plat: compare the calls/)
    assert.match(await card.innerText(), /Open the plat photo/i)
    assert.doesNotMatch(await card.innerText(), /Read with \d+% confidence/)
    // round 15, B3: the plat opens with the drafter's own token, in a new tab, from memory (a plain link carries none)
    const [tab] = await Promise.all([page.context().waitForEvent('page'), card.getByTestId('open-plat').click()])
    await tab.waitForURL(/^blob:/, { timeout: 15000 })
    await tab.close()
    await card.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${OUT}/4-drafter-card-plat-not-read-${w}.png`, fullPage: w < 600 })
    assert.deepEqual(errors, [], 'no page errors')
  })
}

test('screens at 1440 px: a plat with no reader, then the address typed on the lot step. The county parcel is offered and taken, and the plat goes with it to the drafter; the plat tab alone never passes a guessed lot', { skip, timeout: 300000 }, async (t) => {
  const appBase = await startPreview(t)
  const apiBase = await startApi(t)
  const { chromium } = await import('playwright-core')
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
  t.after(() => browser.close())
  const ctx = await appContext(browser, apiBase, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(appBase, { waitUntil: 'domcontentloaded' })
  await signIn(page, 'Kira Plat', 'kira.r14@example.com')
  await page.locator('.start .drop input[type=file]').setInputFiles(PLAT)
  await page.getByRole('button', { name: 'Find my lot' }).click()
  await page.getByTestId('plat-saved').waitFor({ timeout: 30000 })
  // the address, added here
  assert.ok(await page.getByTestId('add-address-go').isDisabled())
  await page.locator('#lot-address').fill('1201 Kerria Ave, McAllen, TX 78501')
  await page.getByTestId('add-address-go').click()
  await page.getByTestId('parcel-card').waitFor({ timeout: 30000 })
  assert.equal(await page.getByTestId('add-address').count(), 0)
  assert.match(await page.getByTestId('plat-saved').innerText(), /type the width and depth printed on the plat/i)
  await page.screenshot({ path: `${OUT}/5-address-added-parcel-offered-1440.png` })
  await page.getByTestId('parcel-yes').click()
  await page.getByTestId('lot-tag').waitFor({ timeout: 10000 })
  assert.match(await page.getByTestId('plat-saved').innerText(), /Your lot from the county map is used for now, and the drafter checks it against your plat/)
  assert.match(await page.getByTestId('lot-tag').innerText(), /1201 Kerria/i)
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${OUT}/6-parcel-taken-plat-attached-1440.png` })
  await page.getByTestId('lot-next').click()
  await page.getByTestId('style-farmhouse').waitFor({ timeout: 20000 })
  await page.waitForTimeout(1200)
  const maria = await who(apiBase, 'maria@drafthouse.test', 'Maria Drafter')
  const inbox = await (await maria.get('/api/review')).json()
  const hers = (inbox.lots || []).find((p) => /Kerria/i.test(p.address || ''))
  assert.ok(hers, 'the lot is in the drafter queue')
  assert.equal(hers.lot.spec.kind, 'parcel')
  assert.match(hers.lot.spec.platId, /^plat_/)
  assert.equal(hers.lot.plat?.unread, true)
  assert.deepEqual(errors, [], 'no page errors')

  // another homeowner: an address is typed, then the plat tab is opened with nothing uploaded
  const ctx2 = await appContext(browser, apiBase, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  const p2 = await ctx2.newPage()
  await p2.goto(appBase, { waitUntil: 'domcontentloaded' })
  await signIn(p2, 'Nora Typed', 'nora.r14@example.com')
  await p2.locator('#start-address').fill('1 Nowhere At All Rd, Mission, TX')
  await p2.getByRole('button', { name: 'Find my lot' }).click()
  await p2.locator('#lot-width').waitFor({ timeout: 30000 })
  assert.doesNotMatch(await p2.locator('#root').innerText(), /Census geocoder|office defaults, unverified/i)
  await p2.getByRole('button', { name: 'From the plat' }).click()
  await p2.getByTestId('lot-wait').waitFor({ timeout: 5000 })
  assert.ok(await p2.getByTestId('lot-next').isDisabled(), 'a guessed 100 by 150 lot does not pass from the plat tab')
  assert.equal(await p2.locator('.stats').count(), 0)
  await p2.screenshot({ path: `${OUT}/7-plat-tab-waits-for-the-plat-1440.png` })
  // typing it in still works, with the tick
  await p2.getByRole('button', { name: 'Type it in' }).click()
  assert.ok(await p2.getByTestId('lot-next').isDisabled())
  await p2.locator('#lot-confirm').check()
  assert.ok(await p2.getByTestId('lot-next').isEnabled())
})

test('screens at 1440 px: a visitor without an account who types an address is told once, calmly, why nothing is looked up, with the way to sign in; no "(sign in first)" errors', { skip, timeout: 300000 }, async (t) => {
  const appBase = await startPreview(t)
  const apiBase = await startApi(t)
  const { chromium } = await import('playwright-core')
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
  t.after(() => browser.close())
  const ctx = await appContext(browser, apiBase, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  const refused = []
  page.on('response', (r) => {
    if (r.url().includes('/api/lot/') && r.status() >= 400) refused.push(`${r.status()} ${new URL(r.url()).pathname}`)
  })
  await page.goto(appBase, { waitUntil: 'domcontentloaded' })
  await page.locator('#signin-email').waitFor({ timeout: 20000 })
  await page.getByRole('button', { name: 'Try it without an account' }).click()
  await page.locator('#start-address').waitFor({ timeout: 20000 })
  const name = page.getByPlaceholder('First and last name')
  if (await name.count()) await name.fill('Gil Guest')
  await page.locator('#start-address').fill('1201 Kerria Ave, McAllen, TX 78501')
  await page.getByRole('button', { name: 'Find my lot' }).click()
  const line = page.getByTestId('guest-lookup')
  await line.waitFor({ timeout: 30000 })
  await page.waitForTimeout(2500)
  const text = await page.locator('#root').innerText()
  assert.doesNotMatch(text, /sign in first|Could not look the address up|Could not reach the county parcel map|could not be read/i)
  assert.match(await line.innerText(), /Without an account we cannot find your lot on the county map or check the flood map\. Type the lot in or upload the plat\. Or sign in with your email, and we find it for you\./)
  assert.deepEqual(refused, [], 'nothing is asked that the office would refuse')
  await page.screenshot({ path: `${OUT}/8-no-account-one-calm-line-1440.png` })
  // typing the lot in still works without an account
  await page.locator('#lot-confirm').check()
  assert.ok(await page.getByTestId('lot-next').isEnabled())
  // and the way in is one tap: back to the first screen, where the sign-in is
  await page.getByTestId('guest-sign-in').click()
  await page.locator('#signin-email').waitFor({ timeout: 20000 })
  assert.deepEqual(errors, [], 'no page errors')
})
