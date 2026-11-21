// Round 7, items 1, 7, 9 and 11, on the screens: the Lot step offers the county parcel ("Is this your lot?"), the
// client takes it, the rules panel shows every number with its source, the flood zone is read at the parcel, the
// drafter's review shows the parcel card, the sourced rules and the owner lookup, and the office dashboard shows the
// sources page. The office API answers from the recorded fixtures (DRAFTHOUSE_FIXTURES=1); nothing reaches the
// internet. Pictures land in a temp folder, or in SHOTS when set. Skips when no Chrome is found.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromePath, startPreview, appContext, spawnGroup, freePort, shotDir } from './browser.mjs'

// round 9, item 12: one Chrome lookup (CHROME, then `which`), free ports (never :8787 / :4189), the preview killed
// with its process group, pictures in a temp folder unless SHOTS names one (SHOTS=docs/fix-round-7 refreshes the report's)
const CHROME = chromePath()
const skip = !CHROME && 'no Chrome found (set CHROME=/path/to/chrome)'
const OUT = shotDir('lot-flow')

test('screens: parcel offered, taken, rules panel, flood at the parcel, review card with owner lookup, sources page', { skip, timeout: 240000 }, async (t) => {
  const base = await startPreview(t)
  const API_PORT = await freePort()
  const apiBase = `http://127.0.0.1:${API_PORT}`
  const api = spawnGroup(t, process.execPath, ['server/index.mjs'], { env: { DRAFTHOUSE_FIXTURES: '1', DRAFTHOUSE_CLAUDE_KEY: '', ANTHROPIC_API_KEY: '', DATABASE_URL: '', SUPABASE_URL: '', RESEND_API_KEY: '', DRAFTHOUSE_APP_KEY: '', DRAFTHOUSE_WORKER_KEY: 'wk', DRAFTHOUSE_DRAFTERS: 'maria@drafthouse.test', DRAFTHOUSE_APP_ORIGIN: base, PORT: String(API_PORT), DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dh-r7-flow-')) } })
  for (let i = 0; i < 150; i++) {
    try {
      await fetch(`${apiBase}/api/health`)
      break
    } catch {
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  const { chromium } = await import('playwright-core')
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })
  t.after(() => browser.close())
  const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false })

  // ── the client, at 1440 ──
  const page = await (await appContext(browser, apiBase, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true })).newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(base, { waitUntil: 'domcontentloaded' })
  await page.locator('#signin-name').fill('Ana Garza')
  await page.locator('#signin-email').fill('ana@example.com')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.locator('#start-address').waitFor()
  await page.locator('#start-address').fill('1201 Kerria Ave, McAllen, TX 78501')
  await page.getByRole('button', { name: 'Find my lot' }).click()
  await page.locator('#lot-city').waitFor()
  // the parcel card: legal, sides, area, the three answers
  const card = page.getByTestId('parcel-card')
  await card.waitFor({ timeout: 30000 })
  const cardText = await card.innerText()
  assert.match(cardText, /Is this your lot\?/i)
  assert.match(cardText, /PALMS LOT 7 BLK 4/)
  assert.match(cardText, /4 sides, about 10,4\d\d sf/)
  assert.match(cardText, /Hidalgo County Appraisal District/)
  assert.match(cardText, /advisory/)
  assert.doesNotMatch(cardText, /REDACTED|owner/i, 'no owner on the client screen')
  await page.waitForTimeout(1500)
  await shot(page, 'lot-parcel-offer-1440')
  // the geocode note is the table's wording
  assert.match(await page.locator('.lot-side').innerText(), /We have the McAllen, TX rules, from the city code/)
  await page.getByTestId('parcel-yes').click()
  await page.waitForTimeout(1200)
  const side = await page.locator('.lot-side').innerText()
  assert.match(side, /Your lot, from the county parcel map/i)
  assert.match(side, /Flood zone/)
  assert.match(side, /no digital FEMA map here · the county decides/, 'Hidalgo County has no digital FIRM (round 9, item 3)')
  assert.doesNotMatch(side, /at the street/, 'the flood zone was read at the parcel, not the street point')
  assert.match(side, /Zoning\s+R-1/)
  // the rules panel: sources and statuses
  const panel = page.getByTestId('rules-panel')
  await panel.locator('summary').click()
  await page.waitForTimeout(400)
  const pt = await panel.innerText()
  assert.match(pt, /Rules used for this lot/i)
  assert.match(pt, /Kept open at the street\s+20 ft\s+from the city code/) // round 12, item D: a homeowner's words, never "setback"
  assert.match(pt, /Kept open on each side\s+5 ft/)
  assert.doesNotMatch(pt, /setback/i)
  assert.match(pt, /Design wind speed\s+set by the engineer of record/)
  assert.match(pt, /Flood zone/)
  assert.doesNotMatch(pt, /\$|price|estimate/i)
  await shot(page, 'lot-parcel-taken-rules-1440')
  // the lot step goes on without a checkbox (the client said yes); the drafter still confirms
  const next = page.getByTestId('lot-next')
  assert.equal(await next.isEnabled(), true)
  await next.click()
  await page.getByRole('button', { name: /Modern Farmhouse/ }).click()
  await page.getByRole('button', { name: /Next, rooms/ }).click()
  // the default rooms may not fit an 80 ft lot: take the size the rooms step offers, then draft
  // (round 12, item E: the rooms start at what fits this lot; the homeowner is told so and never meets "does not fit" first)
  const draftBtn = page.getByRole('button', { name: /Draft my house/ })
  // round 15: on Kerria the default rooms fit as asked (the Valley plan), so nothing is trimmed and no start card shows;
  // a lot that does need it still says "We started you with what fits this lot" (round12.test.mjs, item E)
  await draftBtn.waitFor({ timeout: 60000 })
  await page.waitForFunction(() => !/Checking the lot…/.test(document.body.innerText), null, { timeout: 120000 })
  await page.waitForTimeout(1000)
  if (await page.getByTestId('auto-start').count()) assert.match(await page.getByTestId('auto-start').innerText(), /We started you with what fits this lot; you can change it\./)
  assert.doesNotMatch(await page.locator('main').innerText(), /Does not fit/)
  assert.equal(await draftBtn.isEnabled(), true)
  await shot(page, 'rooms-start-fits-1440')
  await draftBtn.click()
  await page.getByLabel('Your change').waitFor({ timeout: 60000 })
  // on to Send: the rules panel again, no block for a house district
  await page.getByRole('button', { name: /send to drafters/i }).first().click()
  await page.getByText('Ready to hand off?').waitFor({ timeout: 30000 })
  await page.waitForTimeout(800)
  const sendText = await page.locator('.screen').innerText()
  assert.match(sendText, /Rules used for this lot/i)
  assert.doesNotMatch(sendText, /cannot be sent yet/)
  await shot(page, 'send-rules-panel-1440')
  // round 12, item C: the lot is still with a drafter. That is the normal next step, not a failure: a calm card,
  // no Send button to press yet, and never "Could not send"
  const waiting = page.getByTestId('lot-waiting')
  await waiting.waitFor({ timeout: 20000 })
  assert.match(await waiting.innerText(), /Your plan is saved/i)
  assert.match(await waiting.innerText(), /A drafter is checking your lot against the county records, usually within one business day\. We'll email you, and then you can send it\./)
  assert.equal(await page.getByRole('button', { name: 'Send to drafters' }).count(), 0, 'the Send button comes when the lot is confirmed')
  assert.doesNotMatch(await page.locator('.screen').innerText(), /Could not|could not send|cannot be sent/i)
  await shot(page, 'send-lot-with-drafter-calm-1440')

  // ── a commercial lot blocks Send with the office's line ──
  const p2 = await (await appContext(browser, apiBase, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })).newPage()
  await p2.goto(base, { waitUntil: 'domcontentloaded' })
  await p2.locator('#signin-name').fill('Beto Ruiz')
  await p2.locator('#signin-email').fill('beto@example.com')
  await p2.getByRole('button', { name: 'Continue' }).click()
  await p2.locator('#start-address').waitFor()
  await p2.locator('#start-address').fill('2200 S 10th St, McAllen, TX 78503')
  await p2.getByRole('button', { name: 'Find my lot' }).click()
  await p2.getByTestId('parcel-card').waitFor({ timeout: 30000 })
  await p2.getByTestId('parcel-yes').click()
  await p2.waitForTimeout(1500)
  const side2 = await p2.locator('.lot-side').innerText()
  assert.match(side2, /zoned C-2 \(commercial\)\. A house may need a rezoning; the office will call you\./)
  await shot(p2, 'lot-commercial-zoning-390')

  // ── the drafter: inbox lists the parcel lot, the card, the sourced rules, the owner lookup ──
  const dp = await (await appContext(browser, apiBase, { viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })).newPage()
  await dp.goto(`${base}/#/review`, { waitUntil: 'domcontentloaded' })
  await dp.locator('#signin-email').fill('maria@drafthouse.test')
  await dp.getByRole('button', { name: 'Continue' }).click()
  await dp.getByText(/Ana Garza/).first().waitFor({ timeout: 30000 })
  await dp.getByText(/Ana Garza/).first().click()
  const lotCard = dp.getByTestId('lot-card')
  await lotCard.waitFor({ timeout: 20000 })
  const lc = await lotCard.innerText()
  assert.match(lc, /Lot from the county parcel map · needs your confirmation/i)
  assert.match(lc, /PALMS LOT 7 BLK 4 \(geo id P2500-00-004-0007-00\)/)
  assert.match(lc, /matched by address-point/)
  assert.match(lc, /advisory/)
  // round 12, item J: the checklist comes first; the rules and sources are behind "details"
  assert.match(await dp.getByTestId('review-checklist').innerText(), /The lot matches the plat or deed/i)
  await dp.getByTestId('rules-details').locator('summary').first().click()
  const dpanel = dp.getByTestId('rules-panel')
  const dpt = await dpanel.innerText()
  assert.match(dpt, /Parcel 255056/)
  assert.match(dpt, /Look up the owner of record/i)
  assert.match(dpt, /ecode360|mcallen\.net/i, 'the drafter sees the sources')
  await dpanel.getByText('Look up the owner of record').click()
  await dp.waitForTimeout(1500)
  assert.match(await dpanel.innerText(), /Owner of record: (not given|REDACTED)/, 'the fixtures carry no owner field (allow-list); live it is the name')
  await shot(dp, 'review-parcel-rules-1440')
  // confirm the lot
  await dp.getByTestId('check-confirm-lot').click()
  await dp.waitForTimeout(1500)
  assert.match(await dp.getByTestId('lot-card').innerText(), /confirmed by maria@drafthouse.test/i)

  // ── the lot confirmed, the client sends again and the summary PDF carries the "Rules used" page (item 9) ──
  // (the Send page looks again every 20 seconds: the button appears on its own once the drafter has confirmed)
  await page.getByRole('button', { name: 'Send to drafters' }).waitFor({ timeout: 45000 })
  assert.equal(await page.getByTestId('lot-waiting').count(), 0)
  await page.getByRole('button', { name: 'Send to drafters' }).click()
  const dl = page.getByRole('button', { name: /Download your summary/ })
  await dl.waitFor({ timeout: 30000 })
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), dl.click()])
  const pdfPath = path.join(os.tmpdir(), `dh-r7-summary-${Date.now()}.pdf`)
  await download.saveAs(pdfPath)
  const { spawnSync } = await import('node:child_process')
  const txt = spawnSync('pdftotext', ['-layout', pdfPath, '-'], { encoding: 'utf8' })
  if (txt.status === 0) {
    assert.match(txt.stdout, /RULES USED FOR THIS LOT/)
    assert.match(txt.stdout, /Kept open at the street\s+20 ft\s+city code/)
    assert.match(txt.stdout, /Design wind speed\s+set by the engineer of record/)
    assert.match(txt.stdout, /zoned R-1/)
    assert.match(txt.stdout, /A drafter confirms every line/)
    assert.doesNotMatch(txt.stdout, /REDACTED/)
  }
  await shot(page, 'send-after-confirm-1440')

  // ── the office dashboard: sources and the rules table ──
  await dp.goto(`${base}/#/admin`, { waitUntil: 'domcontentloaded' })
  await dp.getByTestId('sources').waitFor({ timeout: 30000 })
  const st = await dp.getByTestId('sources').innerText()
  assert.match(st, /Hidalgo County Appraisal District via RGV911/)
  assert.match(st, /Regrid dormant/i)
  assert.match(st, /TxGIO StratMap/)
  assert.match(st, /disabled: its query operation/i)
  await dp.getByTestId('sources-check').click()
  await dp.waitForTimeout(3000)
  assert.match(await dp.getByTestId('sources').innerText(), /Daily check: passed/i)
  const rt = await dp.getByTestId('rules-table').innerText()
  assert.match(rt, /McAllen, TX/)
  assert.match(rt, /all from the code/i)
  assert.match(rt, /unknown/i)
  await dp.getByTestId('rules-row-sanjuan').getByText('Sources and every field').click()
  await dp.waitForTimeout(400)
  assert.match(await dp.getByTestId('rules-table').innerText(), /unknown, confirm with city/i)
  await shot(dp, 'admin-sources-rules-1440')
  assert.deepEqual(errors, [], 'no page errors')
  assert.ok(!/REDACTED|token=/.test(api.log()), 'no owner or token in the API log')
})
