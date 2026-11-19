// Fix round 12 on the screens (the real-customer test's two must-fix bugs).
//   B  a lot is saved the moment it is taken: sign out and back in (with the office API restarted in between) and
//      "Your houses" has it; resume lands on the rooms step with the lot drawn
//   A  the Kiskadee pie lot is draftable (the starter is offered, the house is turned), and a lot nothing fits
//      offers "Send my lot to the drafter", which puts it in the drafter's queue
// The office API answers from the recordings; nothing reaches the internet. Skips when no Chrome is found.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromePath, startPreview, appContext, spawnGroup, freePort, shotDir } from './browser.mjs'

const CHROME = chromePath()
const skip = !CHROME && 'no Chrome found (set CHROME=/path/to/chrome)'
const OUT = shotDir('round12')

async function startApi(t, { port, DATA_DIR }) {
  const apiBase = `http://127.0.0.1:${port}`
  const api = spawnGroup(t, process.execPath, ['server/index.mjs'], { env: { DRAFTHOUSE_CLAUDE_KEY: '', ANTHROPIC_API_KEY: '', DATABASE_URL: '', SUPABASE_URL: '', RESEND_API_KEY: '', DRAFTHOUSE_APP_KEY: '', DRAFTHOUSE_WORKER_KEY: 'wk', DRAFTHOUSE_DRAFTERS: 'maria@drafthouse.test', REGRID_API_TOKEN: '', PARCEL_DAILY_CHECK: '0', PARCEL_FIELD_CHECK: '0', PORT: String(port), DATA_DIR, ALLOWED_ORIGINS: '*' } })
  for (let i = 0; i < 150; i++) {
    try {
      await fetch(`${apiBase}/api/health`)
      return { apiBase, log: api.log, stop: () => new Promise((ok) => (api.proc.once('exit', ok), process.kill(-api.proc.pid, 'SIGTERM'))) }
    } catch {
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  throw new Error('the office API did not start')
}
const signIn = async (page, name, email) => {
  await page.locator('#signin-email').waitFor({ timeout: 20000 })
  if (await page.locator('#signin-name').count()) await page.locator('#signin-name').fill(name)
  await page.locator('#signin-email').fill(email)
  await page.getByRole('button', { name: /Continue|Email me/ }).click()
  await page.locator('#start-address').waitFor({ timeout: 20000 })
}
const takeLot = async (page, address) => {
  await page.locator('#start-address').fill(address)
  await page.getByRole('button', { name: 'Find my lot' }).click()
  await page.getByTestId('parcel-card').waitFor({ timeout: 30000 })
  await page.getByTestId('parcel-yes').click()
  await page.waitForTimeout(800)
  await page.getByTestId('lot-next').click()
}
const asUser = async (apiBase, email) => {
  const { token } = await (await fetch(apiBase + '/api/auth/dev-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, name: email.split('@')[0] }) })).json()
  return (p) => fetch(apiBase + p, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.json())
}

test('screens B and A: the Kiskadee lot is saved when taken, survives sign-out and an API restart, resumes on the rooms step, and can be drafted with the house turned', { skip, timeout: 420000 }, async (t) => {
  const appBase = await startPreview(t)
  const port = await freePort()
  const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-r12-flow-'))
  let api = await startApi(t, { port, DATA_DIR })
  const { chromium } = await import('playwright-core')
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })
  t.after(() => browser.close())
  const ctx = await appContext(browser, api.apiBase, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(appBase, { waitUntil: 'domcontentloaded' })
  await signIn(page, 'Kis Homeowner', 'kis@example.com')
  await takeLot(page, '2002 Kiskadee Ln, Mission, TX 78572')
  // the style step: the lot is already saved (round 11 saved nothing before the Draft step)
  await page.getByRole('button', { name: /Modern Farmhouse/ }).waitFor({ timeout: 20000 })
  const kis = await asUser(api.apiBase, 'kis@example.com')
  let mine = []
  for (let i = 0; i < 40 && !mine.length; i++) {
    mine = await kis('/api/projects')
    if (!mine.length) await page.waitForTimeout(250)
  }
  assert.equal(mine.length, 1, 'the lot is saved as soon as it is taken')
  assert.equal(mine[0].version, 0)
  const maria = await asUser(api.apiBase, 'maria@drafthouse.test')
  assert.ok((await maria('/api/review')).lots.some((p) => p.id === mine[0].id), 'and it is in the drafter\'s lots to confirm')
  // the office API restarts; the homeowner signs out and back in
  await api.stop()
  api = await startApi(t, { port, DATA_DIR })
  await page.getByRole('button', { name: 'Sign out' }).click()
  await signIn(page, 'Kis Homeowner', 'kis@example.com')
  const pill = page.getByTestId('house-lot-only')
  await pill.waitFor({ timeout: 20000 })
  assert.match(await pill.innerText(), /Lot saved, rooms not chosen yet/i)
  assert.match(await page.locator('.houses').innerText(), /2002 Kiskadee Ln/i)
  await page.screenshot({ path: `${OUT}/b-your-houses-lot-saved-1440.png` })
  // resume: the rooms step, with the lot drawn
  await page.locator('.houses .house').first().click()
  await page.getByTestId('lot-strip').waitFor({ timeout: 20000 })
  assert.ok(await page.getByTestId('lot-thumb').isVisible(), 'the parcel is drawn on the rooms step')
  assert.match(await page.getByTestId('lot-strip').innerText(), /2002 Kiskadee Ln/i)
  assert.match(await page.getByTestId('lot-strip').innerText(), /5,88\d sf lot/)
  const head = page.locator('.screen-head').last()
  // the default 4 bed with an office and a 2-car garage does not fit a pie lot: nobody chose those rooms, so the
  // homeowner starts with the 3 bed, 2 bath starter that does fit (item E), and never sees "does not fit" or a dead end
  let flashed = false
  const watch = setInterval(async () => {
    try {
      if (await page.getByRole('button', { name: 'Try that' }).count()) flashed = true
    } catch {
      /* the page is between screens */
    }
  }, 150)
  await page.getByTestId('auto-start').waitFor({ timeout: 90000 })
  clearInterval(watch)
  assert.equal(flashed, false, 'the offer for the rooms we replaced never flashes by')
  assert.equal(await page.getByTestId('custom-lot').count(), 0, 'not a dead end')
  assert.equal(await page.getByRole('button', { name: 'Try that' }).count(), 0)
  await page.getByText(/The house is turned \d+(\.\d)?° from square to the street/).waitFor({ timeout: 60000 })
  const body = await page.locator('main').innerText()
  assert.doesNotMatch(body, /setback/i, 'plain words on the rooms step')
  assert.doesNotMatch(body, /NaN|undefined/)
  await page.screenshot({ path: `${OUT}/a-kiskadee-rooms-fits-turned-1440.png` })
  const draft = page.getByRole('button', { name: /Draft my house/ })
  assert.equal(await draft.isEnabled(), true, 'round 11: Draft stayed disabled on this lot at every size')
  await draft.click()
  await page.getByText(/Here is your first draft/).waitFor({ timeout: 60000 })
  await page.waitForTimeout(2500)
  assert.match(await page.locator('main').innerText(), /turned \d+(\.\d)?° from square to the street/)
  await page.screenshot({ path: `${OUT}/a-kiskadee-draft-1440.png` })
  // saved as the first draft of the same project, on the turned lot, and it passes the office's rules
  const after = await kis('/api/projects')
  assert.equal(after.length, 1, 'the same project, not a second one')
  assert.equal(after[0].version, 1)
  const full = await kis(`/api/projects/${after[0].id}`)
  assert.ok(Math.abs(full.lot.spec.turn) > 0 && Math.abs(full.lot.spec.turn) <= 15)
  assert.ok(full.rooms.length > 8)
  assert.deepEqual(errors, [], 'no page errors')
  void head
})

test('screens A: a lot none of our plans fits offers "Send my lot to the drafter"; the drafter sees it in the queue and the homeowner sees it is with a drafter (390 px)', { skip, timeout: 300000 }, async (t) => {
  const appBase = await startPreview(t)
  const port = await freePort()
  const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-r12-flow2-'))
  const api = await startApi(t, { port, DATA_DIR })
  const { chromium } = await import('playwright-core')
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })
  t.after(() => browser.close())
  const ctx = await appContext(browser, api.apiBase, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(appBase, { waitUntil: 'domcontentloaded' })
  await signIn(page, 'Sam Sliver', 'sam@example.com')
  await takeLot(page, '5435 Curtis Clark Dr, Corpus Christi, TX 78412')
  await page.getByRole('button', { name: /Modern Farmhouse/ }).click()
  await page.getByRole('button', { name: /Next, rooms/ }).click()
  const card = page.getByTestId('custom-lot')
  await card.waitFor({ timeout: 60000 })
  assert.match(await card.innerText(), /This lot needs a house designed for it/i)
  assert.equal(await page.getByRole('button', { name: /Draft my house/ }).isEnabled(), false)
  assert.doesNotMatch(await page.locator('main').innerText(), /setback|NaN|undefined/i)
  await page.screenshot({ path: `${OUT}/a-no-plan-fits-send-lot-390.png`, fullPage: true })
  await page.getByTestId('send-lot').click()
  await page.getByText(/Your lot is with our drafter/i).waitFor({ timeout: 20000 })
  await page.screenshot({ path: `${OUT}/a-lot-sent-to-drafter-390.png`, fullPage: true })
  const sam = await asUser(api.apiBase, 'sam@example.com')
  const mine = await sam('/api/projects')
  assert.equal(mine.length, 1)
  assert.ok(mine[0].needsCustom?.at, 'saved with needsCustom')
  assert.equal(mine[0].changesUsed, 0)
  // "Your houses" says where it is
  await page.locator('.brand').click()
  await page.getByTestId('house-custom').waitFor({ timeout: 20000 })
  assert.match(await page.getByTestId('house-custom').innerText(), /With a drafter/i)
  // the drafter's inbox has it, and the card opens on a lot with no rooms without an error
  const dctx = await appContext(browser, api.apiBase, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  const dp = await dctx.newPage()
  const derr = []
  dp.on('pageerror', (e) => derr.push(e.message))
  await dp.goto(`${appBase}/#/review`, { waitUntil: 'domcontentloaded' })
  await dp.locator('#signin-email').fill('maria@drafthouse.test')
  await dp.getByRole('button', { name: /Continue|Email me/ }).click()
  const q = dp.getByTestId('inbox-custom')
  await q.waitFor({ timeout: 30000 })
  assert.match(await q.innerText(), /Lots that need a house designed \(1\)/i)
  assert.match(await q.innerText(), /Sam Sliver/)
  await dp.screenshot({ path: `${OUT}/a-drafter-inbox-custom-1440.png` })
  await q.getByText(/Sam Sliver/).click()
  const list = dp.getByTestId('review-checklist')
  await list.waitFor({ timeout: 20000 })
  assert.match(await dp.getByTestId('needs-custom').innerText(), /none of the ready plans fits/i)
  await dp.waitForTimeout(1500)
  await dp.screenshot({ path: `${OUT}/a-drafter-card-custom-lot-1440.png` })
  assert.deepEqual(derr, [], 'the review card of a lot with no rooms does not crash')
  assert.deepEqual(errors, [])
})
