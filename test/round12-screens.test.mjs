// Fix round 12 on the screens, part two.
//   J and 1  the drafter's card: the four-step checklist is on the first screen at 1440 x 900, the C-2 lot says that
//            confirming it does not unblock Send, and a near match carries its yellow line
//   H        the phone at 390 x 844: nothing in the header overlaps, the step is named, the suggestions are not
//            clipped, the plan sits inside its frame, and the chat is at least 40% of the screen
// The office API answers from the recordings. Skips when no Chrome is found.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromePath, startPreview, appContext, spawnGroup, freePort, shotDir } from './browser.mjs'
import { buildLot } from '../src/draft/lib/lot.js'
import { parcelSpec } from '../src/draft/lib/parcel-spec.js'
import { DEFAULT_PROGRAM } from '../src/draft/lib/layout.js'

const CHROME = chromePath()
const skip = !CHROME && 'no Chrome found (set CHROME=/path/to/chrome)'
const OUT = shotDir('round12')
const enc = encodeURIComponent

async function startApi(t) {
  const port = await freePort()
  const apiBase = `http://127.0.0.1:${port}`
  const api = spawnGroup(t, process.execPath, ['server/index.mjs'], { env: { DRAFTHOUSE_CLAUDE_KEY: '', ANTHROPIC_API_KEY: '', DATABASE_URL: '', SUPABASE_URL: '', RESEND_API_KEY: '', DRAFTHOUSE_APP_KEY: '', DRAFTHOUSE_WORKER_KEY: 'wk', DRAFTHOUSE_DRAFTERS: 'maria@drafthouse.test', REGRID_API_TOKEN: '', PARCEL_DAILY_CHECK: '0', PARCEL_FIELD_CHECK: '0', PORT: String(port), DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dh-r12-scr-')), ALLOWED_ORIGINS: '*' } })
  for (let i = 0; i < 150; i++) {
    try {
      await fetch(`${apiBase}/api/health`)
      return apiBase
    } catch {
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  throw new Error('the office API did not start: ' + api.log().slice(-300))
}
async function who(base, email, name) {
  const { token } = await (await fetch(base + '/api/auth/dev-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, name }) })).json()
  const h = { 'content-type': 'application/json', authorization: `Bearer ${token}` }
  return { get: (p) => fetch(base + p, { headers: h }).then((r) => r.json()), post: (p, b = {}) => fetch(base + p, { method: 'POST', headers: h, body: JSON.stringify(b) }).then((r) => r.json()) }
}
const overlap = (a, b) => a && b && a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5

test('screens J and 1: the drafter\'s card opens on a checklist with its buttons (first screen at 1440 x 900); the C-2 lot says confirming does not unblock Send; a near match has its yellow line', { skip, timeout: 300000 }, async (t) => {
  const appBase = await startPreview(t)
  const apiBase = await startApi(t)
  const small = { ...DEFAULT_PROGRAM, sqft: 1600, beds: 3, baths: 2, halfBath: false, office: false }
  const lotOnly = async (email, name, address, city, county) => {
    const u = await who(apiBase, email, name)
    const parcel = await u.get(`/api/lot/parcel?address=${enc(address)}`)
    const made = await u.post('/api/projects', { lot: buildLot(parcelSpec(parcel, { address, city, county })), program: small, client: name })
    assert.ok(made.id, JSON.stringify(made).slice(0, 200))
    return made
  }
  await lotOnly('pat@example.com', 'Pat Shop', '118 S Cage Blvd, Pharr, TX 78577', 'pharr', 'Hidalgo County')
  await lotOnly('nia@example.com', 'Nia Near', '323 N 11th St, Raymondville, TX 78580', '', 'Willacy County')
  const { chromium } = await import('playwright-core')
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })
  t.after(() => browser.close())
  const dp = await (await appContext(browser, apiBase, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })).newPage()
  const errors = []
  dp.on('pageerror', (e) => errors.push(e.message))
  await dp.goto(`${appBase}/#/review`, { waitUntil: 'domcontentloaded' })
  await dp.locator('#signin-email').fill('maria@drafthouse.test')
  await dp.getByRole('button', { name: /Continue|Email me/ }).click()
  // the C-2 lot
  await dp.getByText(/Pat Shop/).first().click()
  const list = dp.getByTestId('review-checklist')
  await list.waitFor({ timeout: 30000 })
  await dp.waitForTimeout(1200)
  const box = await list.boundingBox()
  assert.ok(box.y >= 0 && box.y + box.height <= 900, `the checklist is on the first screen without scrolling (top ${Math.round(box.y)}, bottom ${Math.round(box.y + box.height)} of 900)`)
  const text = await list.innerText()
  for (const line of [/The lot matches the plat or deed/i, /The zoning is a house district/i, /Flood zone noted/i, /The plan passes the audit/i]) assert.match(text, line)
  assert.match(await dp.getByTestId('zoning-stop').innerText(), /Confirming the lot does not unblock Send: this lot is zoned C-2\. Call the homeowner about a rezoning, or change the zoning if the city map says otherwise\./)
  assert.ok(await dp.getByTestId('check-confirm-lot').isVisible(), 'the lot line has its button')
  assert.ok(await dp.getByTestId('check-change-zoning').isVisible(), 'and the zoning line has its own')
  // the calls, the rules and the sources are behind "details"
  assert.equal(await dp.getByTestId('lot-calls').evaluate((d) => d.open), false)
  assert.equal(await dp.getByTestId('rules-details').evaluate((d) => d.open), false)
  await dp.screenshot({ path: `${OUT}/j-drafter-card-c2-first-screen-1440.png` })
  // confirming the lot: done, and the zoning line still stops
  await dp.getByTestId('check-confirm-lot').click()
  await dp.getByText(/Confirmed by maria@drafthouse\.test/i).first().waitFor({ timeout: 20000 })
  assert.match(await dp.getByTestId('zoning-stop').innerText(), /does not unblock Send/)
  await dp.screenshot({ path: `${OUT}/j-drafter-card-c2-confirmed-1440.png` })
  // the near match
  await dp.getByRole('button', { name: /Inbox/ }).click()
  await dp.getByText(/Nia Near/).first().click()
  const note = dp.getByTestId('lot-match-note')
  await note.waitFor({ timeout: 30000 })
  assert.equal(await note.innerText(), 'Near match: the county lists this parcel as 329 11TH, not 323 N 11th St. Check the deed or plat before confirming.')
  const nb = await note.boundingBox()
  assert.ok(nb.y + nb.height <= 900, 'the near-match line is on the first screen')
  await dp.waitForTimeout(1200)
  await dp.screenshot({ path: `${OUT}/1-drafter-card-near-match-1440.png` })
  assert.deepEqual(errors, [])
})

test('screens H: the phone at 390 x 844: the header does not collide, the step is named, the suggestions are whole, the plan is inside its frame, the chat is at least 40% of the screen', { skip, timeout: 300000 }, async (t) => {
  const appBase = await startPreview(t)
  const apiBase = await startApi(t)
  const { chromium } = await import('playwright-core')
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })
  t.after(() => browser.close())
  const page = await (await appContext(browser, apiBase, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(appBase, { waitUntil: 'domcontentloaded' })
  await page.locator('#signin-name').fill('Ana Maria Garza-Villarreal')
  await page.locator('#signin-email').fill('ana.maria.garza.villarreal@example.com')
  await page.getByRole('button', { name: /Continue|Email me/ }).click()
  await page.locator('#start-address').waitFor({ timeout: 20000 })
  await page.locator('#start-address').fill('1300 W Nolana Ave, McAllen, TX 78504')
  await page.getByRole('button', { name: 'Find my lot' }).click()
  await page.locator('#lot-city').waitFor({ timeout: 20000 })
  await page.locator('#lot-city').selectOption('mcallen')
  const confirm = page.locator('#lot-confirm')
  if (await confirm.count()) await confirm.check()
  // the header on the Lot step: an account button, no email text, the step named
  const head = async (where) => {
    assert.equal(await page.locator('.dh-email').isVisible(), false, `${where}: the email is behind the account button`)
    assert.ok(await page.getByTestId('account').isVisible())
    const parts = [await page.locator('.dh-head .brand').boundingBox(), await page.getByTestId('account').boundingBox()]
    if (await page.getByTestId('changes-left').count()) parts.push(await page.getByTestId('changes-left').boundingBox())
    for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) assert.ok(!overlap(parts[i], parts[j]), `${where}: header parts ${i} and ${j} overlap (${JSON.stringify(parts[i])} / ${JSON.stringify(parts[j])})`)
    for (const b of parts) assert.ok(b.x >= 0 && b.x + b.width <= 390.5, `${where}: a header part runs off the screen (${JSON.stringify(b)})`)
    const steps = await page.locator('.steps li').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ x: r.x, y: r.y, width: r.width, height: r.height })))
    for (let i = 0; i < steps.length; i++) for (let j = i + 1; j < steps.length; j++) assert.ok(!overlap(steps[i], steps[j]), `${where}: steps ${i + 1} and ${j + 1} overlap`)
  }
  await head('lot')
  assert.match(await page.getByTestId('step-name').innerText(), /Step 1 of 5 · Lot/i)
  await page.getByRole('button', { name: /pick a style/ }).click()
  await page.getByRole('button', { name: /Modern Farmhouse/ }).click()
  await page.getByRole('button', { name: /Next, rooms/ }).click()
  assert.match(await page.getByTestId('step-name').innerText(), /Step 3 of 5 · Rooms/i)
  const draft = page.getByRole('button', { name: /Draft my house/ })
  await page.waitForFunction(() => !/Checking the lot…/.test(document.body.innerText), null, { timeout: 60000 })
  await draft.click()
  await page.getByLabel('Your change').waitFor({ timeout: 60000 })
  await page.waitForTimeout(2500)
  await head('draft')
  assert.match(await page.getByTestId('step-name').innerText(), /Step 4 of 5 · Draft/i)
  // the chat: at least 40% of the screen, and every suggestion whole inside the screen
  const chat = await page.locator('.side.chat').boundingBox()
  assert.ok(chat.height >= 0.4 * 844, `the chat panel is ${Math.round(chat.height)} px tall, under 40% of 844`)
  const chips = await page.locator('.side.chat .chips button').evaluateAll((els) => els.map((e) => ({ r: e.getBoundingClientRect(), clipped: e.scrollWidth > e.clientWidth + 1, text: e.innerText })).map((x) => ({ x: x.r.x, right: x.r.right, clipped: x.clipped, text: x.text })))
  assert.ok(chips.length >= 3)
  for (const c of chips) assert.ok(c.x >= 0 && c.right <= 390.5 && !c.clipped, `the suggestion "${c.text}" is cut off (${Math.round(c.x)} to ${Math.round(c.right)} of 390)`)
  await page.screenshot({ path: `${OUT}/h-phone-draft-3d-390.png` })
  await page.locator('.side.chat .chips').scrollIntoViewIfNeeded()
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/h-phone-draft-chat-390.png` })
  // the floor plan: its drawing sits inside its frame, not cropped
  await page.locator('.screen.split').evaluate((el) => el.scrollTo(0, 0))
  await page.getByRole('button', { name: 'Plan', exact: true }).click()
  await page.waitForTimeout(1500)
  const frame = await page.locator('.plan-drawing').boundingBox()
  const svg = await page.locator('.plan-drawing-inner svg').boundingBox()
  assert.ok(svg.x >= frame.x - 1 && svg.y >= frame.y - 1 && svg.x + svg.width <= frame.x + frame.width + 1 && svg.y + svg.height <= frame.y + frame.height + 1, `the plan (${JSON.stringify(svg)}) is cropped by its frame (${JSON.stringify(frame)})`)
  await page.screenshot({ path: `${OUT}/h-phone-draft-plan-390.png` })
  // the account button: the email and Sign out
  await page.getByTestId('account').locator('summary').click()
  const menu = page.locator('.dh-account-menu')
  assert.match(await menu.innerText(), /ana\.maria\.garza\.villarreal@example\.com/)
  const mb = await menu.boundingBox()
  assert.ok(mb.x >= 0 && mb.x + mb.width <= 390.5, 'the account menu is on the screen')
  await page.screenshot({ path: `${OUT}/h-phone-account-menu-390.png` })
  await menu.getByRole('button', { name: 'Sign out' }).click()
  await page.locator('#signin-email').waitFor({ timeout: 20000 })
  assert.deepEqual(errors, [])
})
