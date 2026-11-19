// Fix round 13, item 2: the browser's Back broke the app. Back took a homeowner to #/review ("Not a drafter
// account"), a reload kept the error, and the house was gone.
//   - each homeowner step has its own address; Back and Forward move between the homeowner's own steps
//   - a reload opens the step that was on screen (a saved house from the office, an earlier step from the tab)
//   - a homeowner never stays on an office address, and Back cannot return to one
// The office API answers from the recordings; nothing reaches the internet. The screens skip when no Chrome is found.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { stepHash, readHash, reach } from '../src/draft/lib/route.js'
import { chromePath, startPreview, appContext, spawnGroup, freePort, shotDir } from './browser.mjs'
import { fixtureEnv } from './server-env.mjs'

const CHROME = chromePath()
const skip = !CHROME && 'no Chrome found (set CHROME=/path/to/chrome)'
const OUT = shotDir('round13')

test('2: a step has one address and an address one step; nothing shows past what there is (no rooms without a lot, no draft without rooms)', () => {
  assert.equal(stepHash(0), '#/')
  assert.equal(stepHash(0, 'prj_1'), '#/', 'the first screen is nobody\'s house')
  assert.equal(stepHash(1), '#/lot')
  assert.equal(stepHash(4, 'prj_ab12'), '#/draft/prj_ab12')
  for (let n = 0; n <= 5; n++) assert.deepEqual(readHash(stepHash(n, n ? 'prj_x' : null)), { office: null, step: n, id: n ? 'prj_x' : null })
  for (const h of ['', '#', '#/', '#/nope', '#/draft/../../etc', '#/billing', '#/draft/<script>']) assert.equal(readHash(h).step, 0, h)
  for (const h of ['#/review', '#/office', '#/drafter', '#/admin', '#/lot514']) assert.ok(readHash(h).office, `${h} is the office's`)
  assert.equal(reach(4, {}), 0)
  assert.equal(reach(4, { intake: true }), 1)
  assert.equal(reach(4, { intake: true, lot: true }), 2)
  assert.equal(reach(4, { lot: true, style: true }), 3)
  assert.equal(reach(4, { lot: true, style: true, rooms: true }), 4)
  assert.equal(reach(2, { lot: true, style: true, rooms: true }), 2, 'Back to an earlier step is always allowed')
  assert.equal(reach(3, { lot: true, style: true, rooms: true, locked: true }), 5, 'a plan with the drafters stays on its last step')
  assert.equal(reach(9, { lot: true, style: true, rooms: true }), 0)
})

async function startApi(t, { port, DATA_DIR }) {
  const apiBase = `http://127.0.0.1:${port}`
  const api = spawnGroup(t, process.execPath, ['server/index.mjs'], { env: { ...fixtureEnv, DRAFTHOUSE_CLAUDE_KEY: '', ANTHROPIC_API_KEY: '', DATABASE_URL: '', SUPABASE_URL: '', RESEND_API_KEY: '', DRAFTHOUSE_APP_KEY: '', DRAFTHOUSE_WORKER_KEY: 'wk', DRAFTHOUSE_DRAFTERS: 'maria@drafthouse.test', REGRID_API_TOKEN: '', PARCEL_DAILY_CHECK: '0', PARCEL_FIELD_CHECK: '0', PORT: String(port), DATA_DIR, ALLOWED_ORIGINS: '*' } })
  for (let i = 0; i < 150; i++) {
    try {
      await fetch(`${apiBase}/api/health`)
      return { apiBase, log: api.log }
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
const hashOf = (page) => page.evaluate(() => window.location.hash)
const until = async (page, what, fn, ms = 20000) => {
  const t0 = Date.now()
  let last
  while (Date.now() - t0 < ms) {
    last = await fn()
    if (last) return last
    await page.waitForTimeout(150)
  }
  assert.fail(`${what} (address ${await hashOf(page)})`)
}

test('screens 2: every step has its address; Back and Forward move between the homeowner\'s steps; a reload opens the same step; an office address sends a homeowner home', { skip, timeout: 420000 }, async (t) => {
  const appBase = await startPreview(t)
  const api = await startApi(t, { port: await freePort(), DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dh-r13-route-')) })
  const { chromium } = await import('playwright-core')
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })
  t.after(() => browser.close())
  const ctx = await appContext(browser, api.apiBase, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(appBase, { waitUntil: 'domcontentloaded' })
  await signIn(page, 'Rosa Homeowner', 'rosa@example.com')

  // the lot step, before a lot is taken: its own address, and a reload comes back to it with the address typed
  await page.locator('#start-address').fill('1201 Kerria Ave, McAllen, TX 78501')
  await page.getByRole('button', { name: 'Find my lot' }).click()
  await page.getByTestId('parcel-card').waitFor({ timeout: 30000 })
  // the address typed is saved as her house at once (the review of PR #12), so the lot step's address carries it
  const lotHash = await until(page, 'the lot step\'s address carries the house', async () => (/^#\/lot\/prj_\w+$/.test(await hashOf(page)) ? hashOf(page) : null))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByTestId('parcel-card').waitFor({ timeout: 30000 })
  assert.equal(await hashOf(page), lotHash, 'a reload on the lot step stays on the lot step')
  assert.match(await page.locator('main').innerText(), /1201 Kerria Ave/i)

  // take the lot: the style step, and the address carries the saved house
  await page.getByTestId('parcel-yes').click()
  await page.waitForTimeout(800)
  await page.getByTestId('lot-next').click()
  await page.getByRole('button', { name: /Modern Farmhouse/ }).waitFor({ timeout: 20000 })
  const styleHash = await until(page, 'the style step\'s address carries the house', async () => (/^#\/style\/prj_\w+$/.test(await hashOf(page)) ? hashOf(page) : null))
  const id = styleHash.split('/')[2]

  // rooms, then the draft
  await page.getByRole('button', { name: /Modern Farmhouse/ }).click()
  await page.getByRole('button', { name: /Next|Continue|rooms/i }).last().click()
  await page.getByTestId('lot-strip').waitFor({ timeout: 20000 })
  assert.equal(await hashOf(page), `#/rooms/${id}`)
  await page.getByRole('button', { name: 'Draft my house' }).waitFor({ timeout: 60000 })
  await until(page, 'the rooms are checked', async () => page.getByRole('button', { name: 'Draft my house' }).isEnabled(), 90000)
  await page.getByRole('button', { name: 'Draft my house' }).click()
  await page.getByTestId('changes-left').waitFor({ timeout: 60000 })
  assert.equal(await hashOf(page), `#/draft/${id}`)

  // Back: the rooms step, then the style step; Forward: the rooms step again. Never an office page, never an error.
  await page.goBack()
  await page.getByTestId('lot-strip').waitFor({ timeout: 20000 })
  assert.equal(await hashOf(page), `#/rooms/${id}`)
  await page.goBack()
  await page.getByRole('button', { name: /Modern Farmhouse/ }).waitFor({ timeout: 20000 })
  assert.equal(await hashOf(page), `#/style/${id}`)
  await page.goForward()
  await page.getByTestId('lot-strip').waitFor({ timeout: 20000 })
  await page.goForward()
  await page.getByTestId('changes-left').waitFor({ timeout: 20000 })
  assert.equal(await hashOf(page), `#/draft/${id}`)

  // a reload on the draft: the same house, the same step, the same number of changes left
  const left = await page.getByTestId('changes-left').innerText()
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByTestId('changes-left').waitFor({ timeout: 30000 })
  assert.equal(await hashOf(page), `#/draft/${id}`)
  assert.equal(await page.getByTestId('changes-left').innerText(), left)
  assert.match(await page.locator('main').innerText(), /Shape it/)
  await page.screenshot({ path: `${OUT}/2-reload-on-draft-1440.png` })

  // a reload on the rooms step of the same house
  await page.goBack()
  await page.getByTestId('lot-strip').waitFor({ timeout: 20000 })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByTestId('lot-strip').waitFor({ timeout: 30000 })
  assert.equal(await hashOf(page), `#/rooms/${id}`)
  assert.match(await page.getByTestId('lot-strip').innerText(), /1201 Kerria Ave/i)

  // the office's address: a homeowner is taken to their own first screen, and Back does not return to the office page
  await page.goto(appBase + '#/review', { waitUntil: 'domcontentloaded' })
  await page.locator('#start-address').waitFor({ timeout: 20000 })
  assert.equal(await hashOf(page), '#/')
  const body = await page.locator('body').innerText()
  assert.doesNotMatch(body, /Not a drafter account|Office sign-in/)
  assert.match(body, /1201 Kerria Ave/, 'their house is listed on their first screen')
  await page.screenshot({ path: `${OUT}/2-office-address-sends-home-1440.png` })
  await page.goBack()
  await page.waitForTimeout(800)
  assert.doesNotMatch(await hashOf(page), /review|office|drafter|admin/, 'Back never lands on an office address')
  assert.doesNotMatch(await page.locator('body').innerText(), /Not a drafter account/)

  // an address for a step this house has not reached, or for a house that is not theirs: their first screen, no error
  await page.goto(appBase + '#/draft/prj_nobody', { waitUntil: 'domcontentloaded' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('#start-address').waitFor({ timeout: 20000 })
  assert.equal(await hashOf(page), '#/')
  assert.deepEqual(errors, [], 'no page error on the way')
})
