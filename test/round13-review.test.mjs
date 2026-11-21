// Fix round 13, the review of PR #12 and its customer walkthrough, on the screens.
//   M1     the drafter's card and queue say when an outline was not checked against the county; Confirm asks the
//          county again and, while it does not answer, needs "I checked the outline myself"
//   houses a homeowner who signs out on the lot step, the rooms step or the draft finds the house on their first
//          screen and is back on that step with one click
//   tight  a lot our plans only just fit offers "Send my lot to the drafter" as a button, and the chat takes the same
//          request; the queue shows it
// The office API answers from the recordings; nothing reaches the internet. Skips when no Chrome is found.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromePath, startPreview, appContext, spawnGroup, freePort, shotDir } from './browser.mjs'
import { buildLot } from '../src/draft/lib/lot.js'
import { parcelSpec, UNCHECKED_LINE } from '../src/draft/lib/parcel-spec.js'
import { DEFAULT_PROGRAM } from '../src/draft/lib/layout.js'
import { makeParcels } from '../server/parcels.mjs'
import { makeLots } from '../server/lots.mjs'
import { fixtureFetch, loadFixtures } from '../server/fixtures.mjs'
import { fixtureEnv } from './server-env.mjs'

const CHROME = chromePath()
const skip = !CHROME && 'no Chrome found (set CHROME=/path/to/chrome)'
const OUT = shotDir('round13')
const HIDALGO = 'gis.rgv911.org/server/rest/services/RGV911_Web_Apps_MIL1/MapServer/7'
const enc = encodeURIComponent

async function startApi(t, env = {}) {
  const port = await freePort()
  const apiBase = `http://127.0.0.1:${port}`
  spawnGroup(t, process.execPath, ['server/index.mjs'], { env: { ...fixtureEnv, DRAFTHOUSE_CLAUDE_KEY: '', ANTHROPIC_API_KEY: '', DATABASE_URL: '', SUPABASE_URL: '', RESEND_API_KEY: '', DRAFTHOUSE_APP_KEY: '', DRAFTHOUSE_WORKER_KEY: 'wk', DRAFTHOUSE_DRAFTERS: 'maria@drafthouse.test', REGRID_API_TOKEN: '', PARCEL_DAILY_CHECK: '0', PARCEL_FIELD_CHECK: '0', PORT: String(port), DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dh-r13-review-')), ALLOWED_ORIGINS: '*', ...env } })
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
  return { get: (p) => fetch(base + p, { headers: h }).then((r) => r.json()), post: (p, b = {}) => fetch(base + p, { method: 'POST', headers: h, body: JSON.stringify(b) }).then((r) => r.json()) }
}
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

test('screens M1: an outline the county could not check is red on the drafter\'s card and marked in the queue; Confirm needs the county or "I checked the outline myself"; a near match is labelled in the queue', { skip, timeout: 300000 }, async (t) => {
  const appBase = await startPreview(t)
  const apiBase = await startApi(t, { DRAFTHOUSE_FIXTURE_THROW: HIDALGO })
  // Kerria's lot, read from the recordings here and sent while the office cannot ask Hidalgo County
  const m = new Map()
  const store = { meta: { get: async (k) => (m.has(k) ? m.get(k) : null), set: async (k, v) => m.set(k, v) } }
  const fetchImpl = fixtureFetch(loadFixtures())
  const lots = makeLots({ store, fetchImpl, files: {}, interpreter: {}, event: async () => {}, log: () => {}, env: {} })
  const parcels = makeParcels({ store, fetchImpl, geocode: (x) => lots.geocode(x), log: () => {}, env: {}, event: async () => {} })
  const kAddress = '1201 Kerria Ave, McAllen, TX 78501'
  const kerria = await parcels.lookup({ address: kAddress })
  const small = { ...DEFAULT_PROGRAM, sqft: 1600, beds: 3, baths: 2, halfBath: false, office: false }
  const una = await who(apiBase, 'una@example.com', 'Una Unchecked')
  const made = await una.post('/api/projects', { lot: buildLot(parcelSpec(kerria, { address: kAddress, city: 'mcallen', county: 'Hidalgo County' })), program: small, client: 'Una Unchecked' })
  assert.equal(made.lot?.spec?.confidence, 'unchecked', JSON.stringify(made).slice(0, 200))
  // a near match from Willacy County, which does answer
  const nia = await who(apiBase, 'nia@example.com', 'Nia Near')
  const nAddress = '323 N 11th St, Raymondville, TX 78580'
  const near = await nia.get(`/api/lot/parcel?address=${enc(nAddress)}`)
  await nia.post('/api/projects', { lot: buildLot(parcelSpec(near, { address: nAddress, city: '', county: 'Willacy County' })), program: small, client: 'Nia Near' })

  const { chromium } = await import('playwright-core')
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })
  t.after(() => browser.close())
  const dp = await (await appContext(browser, apiBase, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })).newPage()
  const errors = []
  dp.on('pageerror', (e) => errors.push(e.message))
  await dp.goto(`${appBase}/#/review`, { waitUntil: 'domcontentloaded' })
  await dp.locator('#signin-email').fill('maria@drafthouse.test')
  await dp.getByRole('button', { name: /Continue|Email me/ }).click()
  await dp.getByText(/Una Unchecked/).first().waitFor({ timeout: 30000 })
  // the queue: one clear, labelled mark on each card
  assert.match(await dp.locator('.inbox-row', { hasText: 'Una Unchecked' }).getByTestId('row-unchecked').innerText(), /Outline not checked/i)
  assert.match(await dp.locator('.inbox-row', { hasText: 'Nia Near' }).getByTestId('row-near').innerText(), /Near match: check the address/i)
  assert.equal(await dp.locator('.inbox-row', { hasText: 'Nia Near' }).getByTestId('row-unchecked').count(), 0)
  for (const row of await dp.locator('.inbox-row').all()) {
    const b = await row.boundingBox()
    const inside = await row.evaluate((el) => [...el.querySelectorAll('.pill')].every((p) => p.scrollWidth <= p.clientWidth + 1 && p.getBoundingClientRect().height < 30))
    assert.ok(b.height < 120 && inside, 'a queue card keeps each mark whole, on one line')
  }
  await dp.screenshot({ path: `${OUT}/m1-drafter-queue-marks-1440.png` })
  // the card
  await dp.getByText(/Una Unchecked/).first().click()
  const line = dp.getByTestId('lot-unchecked')
  await line.waitFor({ timeout: 30000 })
  assert.equal(await line.innerText(), UNCHECKED_LINE)
  assert.equal(await line.innerText(), 'Lot outline not checked against the county (county did not answer). Check it before confirming.')
  assert.match(await line.evaluate((el) => getComputedStyle(el).borderColor + ' ' + getComputedStyle(el).color), /179, 38, 30|140, 29, 24/, 'it is red')
  assert.equal(await dp.getByTestId('self-checked').count(), 0, 'the tick is offered only after the county was asked again and did not answer')
  await dp.waitForTimeout(800)
  await dp.screenshot({ path: `${OUT}/m1-drafter-card-unchecked-1440.png` })
  // Confirm asks the county again; it still does not answer, so nothing is confirmed and the tick appears
  await dp.getByTestId('check-confirm-lot').click()
  await dp.getByTestId('self-checked').waitFor({ timeout: 20000 })
  assert.match(await dp.locator('body').innerText(), /The county did not answer, so this outline is still not checked against the county/)
  assert.equal(await dp.getByText(/Confirmed by maria@drafthouse\.test/i).count(), 0)
  await dp.screenshot({ path: `${OUT}/m1-drafter-card-county-still-down-1440.png` })
  await dp.getByTestId('self-checked').locator('input').check()
  await dp.getByTestId('check-confirm-lot').click()
  await dp.getByText(/Confirmed by maria@drafthouse\.test/i).first().waitFor({ timeout: 20000 })
  assert.equal(await dp.getByTestId('lot-unchecked').count(), 0, 'the red line is gone once the drafter has vouched for the outline')
  assert.deepEqual(errors, [])
})

test('screens houses and tight lot: signing out on the lot step, the rooms step and the draft each leaves the house on the first screen, one click from that step; Kiskadee offers the drafter as a button and takes it as a chat request', { skip, timeout: 480000 }, async (t) => {
  const appBase = await startPreview(t)
  const apiBase = await startApi(t)
  const { chromium } = await import('playwright-core')
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })
  t.after(() => browser.close())
  const page = await (await appContext(browser, apiBase, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })).newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(appBase, { waitUntil: 'domcontentloaded' })
  await signIn(page, 'Maria Homeowner', 'maria.h@example.com')
  // 1. the lot step: the address is typed, the parcel is offered, and she signs out before taking it
  await page.locator('#start-address').fill('2002 Kiskadee Ln, Mission, TX 78572')
  await page.getByRole('button', { name: 'Find my lot' }).click()
  await page.getByTestId('parcel-card').waitFor({ timeout: 30000 })
  // the sides in her words, not a surveyor's
  const sides = await page.getByTestId('lot-sides').innerText()
  assert.match(sides, /Front \(Kiskadee Ln\): about 50 ft, curved/)
  assert.match(sides, /Left side: about 100 ft/)
  assert.doesNotMatch(await page.getByTestId('parcel-card').innerText(), /[NS] \d+°/)
  await page.waitForTimeout(600)
  await signOut(page)
  await signIn(page, 'Maria Homeowner', 'maria.h@example.com')
  const first = page.getByTestId('house-address-only')
  await first.waitFor({ timeout: 20000 })
  assert.match(await first.innerText(), /Address saved, lot not chosen yet/i)
  assert.equal(await page.locator('.houses .house').count(), 1)
  await page.screenshot({ path: `${OUT}/houses-signed-out-on-lot-step-1440.png` })
  await page.locator('.houses .house').first().click()
  await page.getByTestId('parcel-card').waitFor({ timeout: 30000 })
  assert.match(await page.evaluate(() => window.location.hash), /^#\/lot\/prj_/)
  // 2. she takes the lot, reaches the rooms step and signs out there
  await page.getByTestId('parcel-yes').click()
  await page.waitForTimeout(800)
  await page.getByTestId('lot-next').click()
  await page.getByTestId('style-farmhouse').click()
  await page.getByRole('button', { name: /Next, rooms/ }).click()
  await page.getByTestId('auto-start').waitFor({ timeout: 120000 })
  // a lot our plans only just fit: the drafter is a button, in plain sight
  const tight = page.getByTestId('tight-lot')
  await tight.waitFor({ timeout: 20000 })
  assert.ok(await page.getByTestId('send-lot-tight').isVisible())
  assert.match(await tight.innerText(), /A tight lot for our ready plans/i)
  await page.screenshot({ path: `${OUT}/tight-lot-send-to-drafter-button-1440.png`, fullPage: true })
  await page.waitForTimeout(1200)
  await signOut(page)
  await signIn(page, 'Maria Homeowner', 'maria.h@example.com')
  // round 15 (U11) asks the card to say the real step: rooms saved on the rooms step are "Rooms chosen, ready to draft"
  await page.getByTestId('house-rooms-chosen').waitFor({ timeout: 20000 })
  assert.equal(await page.locator('.houses .house').count(), 1, 'the same house, not a second one')
  await page.locator('.houses .house').first().click()
  await page.getByTestId('lot-strip').waitFor({ timeout: 30000 })
  assert.match(await page.evaluate(() => window.location.hash), /^#\/rooms\/prj_/)
  // 3. she drafts, signs out on the draft, and is back on it with one click
  const draft = page.getByRole('button', { name: 'Draft my house' })
  for (let i = 0; i < 480 && !(await draft.isEnabled()); i++) await page.waitForTimeout(250)
  await draft.click()
  await page.getByTestId('changes-left').waitFor({ timeout: 60000 })
  // (round 15, U14: what counts waits behind the info button by the count)
  await page.getByTestId('changes-info').click()
  await page.getByTestId('changes-more').waitFor({ state: 'visible', timeout: 5000 })
  const note = await page.getByTestId('changes-note').innerText()
  assert.match(note, /10 free changes; a failed request doesn't use one/)
  assert.match(note, /Choosing your lot and rooms, your first draft and undo are free/)
  await page.waitForTimeout(800)
  await signOut(page)
  await signIn(page, 'Maria Homeowner', 'maria.h@example.com')
  await page.locator('.houses .house').first().click()
  await page.getByTestId('changes-left').waitFor({ timeout: 60000 })
  assert.match(await page.evaluate(() => window.location.hash), /^#\/draft\/prj_/)
  // 4. the chat takes "send my lot to the drafter"; nothing is used; the drafter's queue has it
  const box = page.getByLabel('Your change')
  await box.fill('have the drafter design it')
  await box.press('Enter')
  await page.getByText(/Your lot is with our drafter now/).waitFor({ timeout: 30000 })
  assert.match(await page.getByTestId('changes-left').innerText(), /10 changes left/i)
  await page.screenshot({ path: `${OUT}/tight-lot-chat-send-my-lot-1440.png` })
  const drafter = await who(apiBase, 'maria@drafthouse.test')
  const inbox = await drafter.get('/api/review')
  assert.equal(inbox.custom.length, 1)
  assert.match(inbox.custom[0].address, /2002 Kiskadee Ln/i)
  assert.deepEqual(errors, [])
})
