// Round 7, items 1, 7, 9 and 11, on the screens: the Lot step offers the county parcel ("Is this your lot?"), the
// client takes it, the rules panel shows every number with its source, the flood zone is read at the parcel, the
// drafter's review shows the parcel card, the sourced rules and the owner lookup, and the office dashboard shows the
// sources page. The office API answers from the recorded fixtures (DRAFTHOUSE_FIXTURES=1); nothing reaches the
// internet. Pictures land in docs/fix-round-7/. Runs when a built dist/ and Chromium are present.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const CHROME = '/opt/pw-browsers/chromium'
const haveDist = fs.existsSync('dist/index.html')
const haveChrome = fs.existsSync(CHROME) || !!process.env.PLAYWRIGHT_CHROMIUM
const skip = !(haveDist && haveChrome) && 'needs dist/ (vite build) and the sandbox Chromium'
const API_PORT = 8787 // what the built app calls (VITE_API_URL default)
const WEB_PORT = 4189
const OUT = 'docs/fix-round-7'

async function up(url, tries = 150) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url)
      if (r.status < 500) return true
    } catch {}
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`${url} did not come up`)
}
function start(t, cmd, args, env) {
  // its own process group, so the whole tree (npx → vite → esbuild) dies with it
  const p = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
  let out = ''
  p.stdout.on('data', (d) => (out += d))
  p.stderr.on('data', (d) => (out += d))
  t.after(() => {
    try {
      process.kill(-p.pid, 'SIGTERM')
    } catch {
      p.kill()
    }
  })
  return { p, log: () => out }
}

test('screens: parcel offered, taken, rules panel, flood at the parcel, review card with owner lookup, sources page', { skip, timeout: 240000 }, async (t) => {
  fs.mkdirSync(OUT, { recursive: true })
  const api = start(t, process.execPath, ['server/index.mjs'], { DRAFTHOUSE_FIXTURES: '1', DRAFTHOUSE_CLAUDE_KEY: '', ANTHROPIC_API_KEY: '', DATABASE_URL: '', SUPABASE_URL: '', RESEND_API_KEY: '', DRAFTHOUSE_APP_KEY: '', DRAFTHOUSE_WORKER_KEY: 'wk', DRAFTHOUSE_DRAFTERS: 'maria@drafthouse.test', PORT: String(API_PORT), DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dh-r7-flow-')) })
  await up(`http://localhost:${API_PORT}/api/health`)
  const web = start(t, process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(WEB_PORT), '--strictPort'], {})
  await up(`http://localhost:${WEB_PORT}/`)
  const { chromium } = await import('playwright-core')
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || CHROME, args: ['--no-sandbox'] })
  t.after(() => browser.close())
  const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false })
  const base = `http://localhost:${WEB_PORT}`

  // ── the client, at 1440 ──
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })).newPage()
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
  assert.match(side, /X · outside the 1% flood area/)
  assert.doesNotMatch(side, /at the street/, 'the flood zone was read at the parcel, not the street point')
  assert.match(side, /Zoning\s+R-1/)
  // the rules panel: sources and statuses
  const panel = page.getByTestId('rules-panel')
  await panel.locator('summary').click()
  await page.waitForTimeout(400)
  const pt = await panel.innerText()
  assert.match(pt, /Rules used for this lot/i)
  assert.match(pt, /Front setback\s+20 ft\s+from the city code/)
  assert.match(pt, /Side setback\s+5 ft/)
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
  const draftBtn = page.getByRole('button', { name: /Draft my house/ })
  if (!(await draftBtn.isEnabled())) {
    const offer = page.locator('button.linkish', { hasText: /try that|^use /i }).first()
    await offer.click()
    await page.waitForTimeout(800)
  }
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
  // send it: the project saves with the parcel lot, waiting for the drafter
  await page.getByRole('button', { name: 'Send to drafters' }).click()
  await page.waitForTimeout(2500)
  const after = await page.locator('.screen').innerText()
  assert.match(after, /drafter|confirmed your lot|queue/i)

  // ── a commercial lot blocks Send with the office's line ──
  const p2 = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })).newPage()
  await p2.goto(base, { waitUntil: 'domcontentloaded' })
  await p2.locator('#signin-name').fill('Beto Ruiz')
  await p2.locator('#signin-email').fill('beto@example.com')
  await p2.getByRole('button', { name: 'Continue' }).click()
  await p2.locator('#start-address').waitFor()
  await p2.locator('#start-address').fill('1300 N 10th St, McAllen, TX 78501')
  await p2.getByRole('button', { name: 'Find my lot' }).click()
  await p2.getByTestId('parcel-card').waitFor({ timeout: 30000 })
  await p2.getByTestId('parcel-yes').click()
  await p2.waitForTimeout(1500)
  const side2 = await p2.locator('.lot-side').innerText()
  assert.match(side2, /zoned C-3 \(commercial\)\. A house may need a rezoning; the office will call you\./)
  await shot(p2, 'lot-commercial-zoning-390')

  // ── the drafter: inbox lists the parcel lot, the card, the sourced rules, the owner lookup ──
  const dp = await (await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })).newPage()
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
  const dpanel = dp.getByTestId('rules-panel')
  const dpt = await dpanel.innerText()
  assert.match(dpt, /Parcel 255056/)
  assert.match(dpt, /Look up the owner of record/i)
  assert.match(dpt, /ecode360|mcallen\.net/i, 'the drafter sees the sources')
  await dpanel.getByText('Look up the owner of record').click()
  await dp.waitForTimeout(1500)
  assert.match(await dpanel.innerText(), /Owner of record: REDACTED/)
  await shot(dp, 'review-parcel-rules-1440')
  // confirm the lot
  await dp.getByRole('button', { name: 'Confirm lot' }).click()
  await dp.waitForTimeout(1500)
  assert.match(await dp.getByTestId('lot-card').innerText(), /confirmed by maria@drafthouse.test/i)

  // ── the lot confirmed, the client sends again and the summary PDF carries the "Rules used" page (item 9) ──
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
    assert.match(txt.stdout, /Front setback\s+20 ft\s+city code/)
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
