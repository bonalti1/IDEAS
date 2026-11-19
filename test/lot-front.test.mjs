// Round 10 on the screens: the Lot step draws the county parcel with the street on its true frontage (Kerria,
// Armagoza and the 31 x 300 Curtis Clark sliver, at 1440 and 390 px), never keeps a previous lot, says when the
// geocoder found another address than the one typed and offers no parcel until the homeowner agrees, lets a homeowner
// draft on a lot whose address was never confirmed, and shows a plain line when FEMA does not answer. The office API
// answers from the recorded fixtures; nothing reaches the internet. Pictures land in a temp folder, or in SHOTS when
// set (SHOTS=docs/fix-round-10 refreshes the report's). Skips when no Chrome is found.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromePath, startPreview, appContext, spawnGroup, freePort, shotDir } from './browser.mjs'

const CHROME = chromePath()
const skip = !CHROME && 'no Chrome found (set CHROME=/path/to/chrome)'
const OUT = shotDir('lot-front')

async function startApi(t, appBase, env = {}) {
  const port = await freePort()
  const apiBase = `http://127.0.0.1:${port}`
  const api = spawnGroup(t, process.execPath, ['server/index.mjs'], { env: { DRAFTHOUSE_CLAUDE_KEY: '', ANTHROPIC_API_KEY: '', DATABASE_URL: '', SUPABASE_URL: '', RESEND_API_KEY: '', DRAFTHOUSE_APP_KEY: '', DRAFTHOUSE_WORKER_KEY: 'wk', DRAFTHOUSE_DRAFTERS: 'maria@drafthouse.test', DRAFTHOUSE_APP_ORIGIN: appBase, PORT: String(port), DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dh-r10-front-')), ...env } })
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
async function toLot(browser, appBase, apiBase, viewport, address, who = 'ana') {
  const ctx = await appContext(browser, apiBase, { viewport, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(appBase, { waitUntil: 'domcontentloaded' })
  await page.locator('#signin-name').fill('Ana Garza')
  await page.locator('#signin-email').fill(`${who}@example.com`)
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.locator('#start-address').waitFor()
  await page.locator('#start-address').fill(address)
  await page.getByRole('button', { name: 'Find my lot' }).click()
  await page.locator('#lot-city').waitFor()
  return { page, errors, ctx }
}
const SIZES = [
  { name: '1440', viewport: { width: 1440, height: 900 } },
  { name: '390', viewport: { width: 390, height: 844 } },
]
// the three lots of the acceptance list: the street each fronts on, its frontage and its area, as recorded live
const LOTS = [
  { slug: 'kerria', address: '1201 Kerria Ave, McAllen, TX 78501', street: 'Kerria Ave', front: '79.75', area: /10,40\d sf/, corner: 'N 12th St' },
  { slug: 'armagoza', address: '1534 Armagoza Dr, Edinburg, TX 78541', street: 'N Armagoza Dr', front: '67.43', area: /9,45\d sf/ },
  { slug: 'curtis-clark', address: '5435 Curtis Clark Dr, Corpus Christi, TX 78412', street: 'Curtis Clark Dr', front: '31.15', area: /9,50\d sf/ },
]

test('screens: the parcel is drawn with the street on its true frontage; Curtis Clark is the 31 x 300 sliver; a previous lot never stays', { skip, timeout: 420000 }, async (t) => {
  const appBase = await startPreview(t)
  const { apiBase } = await startApi(t, appBase)
  const { chromium } = await import('playwright-core')
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })
  t.after(() => browser.close())
  for (const size of SIZES)
    for (const lot of LOTS) {
      const { page, errors, ctx } = await toLot(browser, appBase, apiBase, size.viewport, lot.address, `${lot.slug}${size.name}`)
      const card = page.getByTestId('parcel-card')
      await card.waitFor({ timeout: 30000 })
      const offer = await card.innerText()
      assert.match(offer, /Is this your lot\?/i, `${lot.slug} ${size.name}`)
      // the street side is the frontage on the named street, in feet
      assert.ok(offer.includes(`street side (${lot.street}) ${lot.front}'`), `${lot.slug} ${size.name}: the street side is ${lot.front} ft on ${lot.street}:\n${offer}`)
      if (lot.corner) assert.match(offer, new RegExp(`A corner lot: the side on ${lot.corner} takes the street-side setback`))
      else assert.doesNotMatch(offer, /A corner lot/)
      assert.doesNotMatch(offer, /best guess/)
      // before the parcel is taken the page shows the typed 100 x 150 assumption (15,000 sf)
      await page.getByTestId('parcel-yes').click()
      await page.waitForTimeout(1500)
      const side = await page.locator('.lot-side').innerText()
      assert.match(side, /Your lot, from the county parcel map/i)
      const stats = await page.locator('.lot-side .stats').innerText()
      assert.match(stats, lot.area, `${lot.slug} ${size.name}: the lot area is the parcel's:\n${stats}`)
      assert.doesNotMatch(stats, /15,000 sf/, 'the typed 100 x 150 lot is gone')
      assert.doesNotMatch(side, /The buildable area is very small|leave no buildable area/, `${lot.slug}: the envelope is real`)
      assert.equal(await page.getByTestId('lot-next').isEnabled(), true, `${lot.slug} ${size.name}: the homeowner can go on`)
      if (size.name === '1440') {
        const tag = await page.getByTestId('lot-tag').innerText()
        assert.match(tag, new RegExp(lot.address.split(',')[0], 'i'))
        assert.doesNotMatch(tag, /no room|very little room/i)
      }
      await page.waitForTimeout(1200)
      await page.screenshot({ path: `${OUT}/lot-${lot.slug}-${size.name}.png`, fullPage: size.name === '390' })
      assert.deepEqual(errors, [], `${lot.slug} ${size.name}: page errors`)
      await ctx.close()
    }
  // a parcel the setbacks leave no room on is still the one drawn, in red, with the reason (never the previous lot):
  // the Curtis Clark sliver with a 200 ft front setback typed in
  const { page, errors } = await toLot(browser, appBase, apiBase, SIZES[0].viewport, LOTS[2].address, 'red')
  await page.getByTestId('parcel-card').waitFor({ timeout: 30000 })
  await page.getByTestId('parcel-yes').click()
  await page.waitForTimeout(800)
  await page.locator('details.setbacks summary').click()
  const sb = page.locator('details.setbacks input')
  await sb.nth(1).fill('20') // side: 20 + 20 on a 31 ft wide lot
  await page.waitForTimeout(1200)
  const tag = await page.getByTestId('lot-tag').innerText()
  assert.match(tag, /5435 CURTIS CLARK DR/i, 'still the parcel')
  assert.match(tag, /no room to build/i)
  const panel = await page.locator('.lot-side').innerText()
  assert.match(panel, /The setbacks leave no buildable area/)
  assert.doesNotMatch(panel, /15,000 sf/)
  assert.equal(await page.getByTestId('lot-next').isEnabled(), false)
  await page.screenshot({ path: `${OUT}/lot-no-room-drawn-red-1440.png` })
  assert.deepEqual(errors, [], 'the scene does not crash on an empty envelope')
})

test('screens: another address was found (W typed, E matched): a yellow question, no parcel until yes; an unconfirmed address never blocks Draft', { skip, timeout: 300000 }, async (t) => {
  const appBase = await startPreview(t)
  const { apiBase } = await startApi(t, appBase)
  const { chromium } = await import('playwright-core')
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })
  t.after(() => browser.close())
  for (const size of SIZES) {
    const { page, errors, ctx } = await toLot(browser, appBase, apiBase, size.viewport, '1300 W Nolana Ave, McAllen, TX 78504', `nolana${size.name}`)
    const check = page.getByTestId('address-check')
    await check.waitFor({ timeout: 30000 })
    const q = await check.innerText()
    assert.match(q, /We found 1300 E Nolana Ave, not W\. Is that right\?/)
    await page.waitForTimeout(1500)
    const side = await page.locator('.lot-side').innerText()
    assert.doesNotMatch(side, /Found: 1300 E NOLANA AVE/, 'the found address is not shown as if it were the typed one')
    assert.equal(await page.getByTestId('parcel-card').count(), 0, 'no parcel is offered before the homeowner answers')
    assert.doesNotMatch(side, /NOLANA RETAIL|C-3|zoned/i)
    await page.screenshot({ path: `${OUT}/address-check-w-nolana-${size.name}.png`, fullPage: size.name === '390' })
    if (size.name === '1440') {
      // "No": the typed lot goes on; Rooms says it fits and Draft is enabled (it was blocked by an unconfirmed C-3)
      await page.getByTestId('address-no').click()
      await page.waitForTimeout(600)
      assert.match(await check.innerText(), /Then we did not find your address/)
      assert.equal(await page.getByTestId('parcel-card').count(), 0)
      await page.locator('#lot-confirm').check()
      await page.getByTestId('lot-next').click()
      await page.getByRole('button', { name: /Modern Farmhouse/ }).click()
      await page.getByRole('button', { name: /Next, rooms/ }).click()
      const draftBtn = page.getByRole('button', { name: /Draft my house/ })
      await draftBtn.waitFor()
      await page.waitForTimeout(1500)
      const rooms = await page.locator('.screen').innerText()
      assert.doesNotMatch(rooms, /zoned C-3|Does not fit this lot: This lot is zoned/)
      assert.equal(await draftBtn.isEnabled(), true, 'Draft my house is enabled on the typed lot')
      await page.screenshot({ path: `${OUT}/rooms-draft-open-unconfirmed-address-1440.png` })
    } else {
      // "Yes": now the parcel at the found address is offered: the 4-acre commercial tract, said to be large, edges not listed
      await page.getByTestId('address-yes').click()
      const card = page.getByTestId('parcel-card')
      await card.waitFor({ timeout: 30000 })
      await page.waitForTimeout(1500)
      const text = await card.innerText()
      assert.match(text, /NOLANA RETAIL LOT 1/)
      assert.match(text, /A large tract \(4\.0\d+ acres, 9 sides\): the office draws this one/)
      assert.equal(await card.locator('.edges').count(), 0, 'no edge list for a large tract')
      assert.match(await check.innerText(), /Using 1300 E Nolana Ave/)
      await page.screenshot({ path: `${OUT}/address-confirmed-large-tract-390.png`, fullPage: true })
    }
    assert.deepEqual(errors, [])
    await ctx.close()
  }
})

test('screens: FEMA does not answer: the Lot step says so in a plain line and the homeowner goes on', { skip, timeout: 240000 }, async (t) => {
  const appBase = await startPreview(t)
  const { apiBase, log } = await startApi(t, appBase, { DRAFTHOUSE_FIXTURE_THROW: 'hazards.fema.gov' })
  const { chromium } = await import('playwright-core')
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })
  t.after(() => browser.close())
  const { page, errors } = await toLot(browser, appBase, apiBase, SIZES[0].viewport, '5435 Curtis Clark Dr, Corpus Christi, TX 78412', 'fema')
  await page.getByTestId('parcel-card').waitFor({ timeout: 30000 })
  const line = page.getByTestId('flood-error')
  await line.waitFor({ timeout: 30000 })
  assert.equal((await line.innerText()).trim(), 'FEMA did not answer; the office checks the flood zone.')
  await page.getByTestId('parcel-yes').click()
  await page.waitForTimeout(1000)
  assert.match(await page.locator('.lot-side .stats').innerText(), /FEMA did not answer · the office checks/)
  assert.equal(await page.getByTestId('lot-next').isEnabled(), true)
  await page.screenshot({ path: `${OUT}/fema-did-not-answer-1440.png` })
  assert.doesNotMatch(log(), /→ 500/, 'no 500 on the server')
  assert.match(log(), /FEMA NFHL layer \d+ did not answer/)
  assert.deepEqual(errors, [])
})
