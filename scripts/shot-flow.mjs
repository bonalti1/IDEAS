// Walk the Draft House client flow and screenshot each step, then the drafter review and the office.
// usage: node scripts/shot-flow.mjs <outDir>   (dev server on :5173 with the office API behind it, local sign-in)
import { chromium } from 'playwright-core'
import fs from 'node:fs'

const out = process.argv[2] || 'shots/flow'
fs.mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const watch = (page) => {
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))
  page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE ERROR:', m.text()))
}
// the client and the drafter each get their own browser (own sign-in)
const client = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await client.newPage()
watch(page)

const shot = async (p, n, opts = {}) => {
  await p.waitForTimeout(1200)
  await p.screenshot({ path: `${out}/${n}.png`, ...opts })
  console.log('saved', n)
}

// ── client: sign in, lot, style, rooms, draft ──
await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' })
await shot(page, '1-start')
await page.locator('#signin-name').fill('Edgar Garza')
await page.locator('#signin-email').fill('edgar@example.com')
await page.getByRole('button', { name: 'Continue' }).click()
await page.locator('#start-address').waitFor()
await shot(page, '1b-signed-in')
await page.locator('#start-address').fill('2554 N FM 2360, Rio Grande City, TX 78582')
await page.getByRole('button', { name: 'Find my lot' }).click()
await page.locator('#lot-city').waitFor()
// the lot step: typed in by default; SHOT_PLAT=1 uploads the Garza site plan and lets the office read it (needs the Claude key)
const PLAT = process.env.SHOT_PLAT === '1'
await page.locator('#lot-city').selectOption('hidalgo')
if (PLAT) {
  await page.getByRole('button', { name: 'From the plat' }).click()
  await page.locator('.lot-side input[type=file]').setInputFiles('test/fixtures/garza-site-plan.png')
  await page.getByText('What we read').waitFor({ timeout: 180000 })
  await page.waitForTimeout(2500)
  await shot(page, '2-lot-plat-read')
  await page.getByRole('button', { name: 'Lot', exact: true }).click()
  await page.waitForTimeout(2500)
  await shot(page, '2b-lot-from-plat')
} else {
  await page.locator('#lot-width').fill('150')
  await page.locator('#lot-depth').fill('260')
  await page.locator('#lot-street').fill('N FM 2360')
  await page.waitForTimeout(2500)
  await shot(page, '2-lot')
  // the typed lot is an assumption the client confirms
  if (await page.locator('#lot-confirm').count()) await page.locator('#lot-confirm').check()
}
await page.getByRole('button', { name: /pick a style/ }).click()
await shot(page, '3-style')
await page.getByRole('button', { name: /Modern Farmhouse/ }).click()
await page.getByRole('button', { name: /Next, rooms/ }).click()
await page.getByRole('button', { name: /Start from a recent build/ }).click()
await shot(page, '4-rooms')
await page.getByRole('button', { name: /Draft my house/ }).click()
await page.waitForTimeout(2500)
await shot(page, '5-draft')
const ask = async (text) => {
  await page.getByPlaceholder(/change|Move the laundry/).fill(text)
  await page.getByRole('button', { name: 'Change', exact: true }).click()
  await page.locator('.msg.thinking').waitFor({ state: 'hidden', timeout: 30000 })
}
await page.getByRole('button', { name: 'Make the kitchen bigger' }).click()
await page.locator('.msg.thinking').waitFor({ state: 'hidden', timeout: 30000 })
await ask('add an office')
await ask('remove the kitchen')
await page.getByRole('button', { name: 'Plan', exact: true }).click()
await shot(page, '6-draft-edited')
await page.getByRole('button', { name: 'Undo last change' }).click()
await page.waitForTimeout(800)
await page.getByRole('button', { name: /History/ }).click()
await shot(page, '6b-draft-undo')

// ── reload: the house, its credits and its versions come back from the office ──
await page.reload({ waitUntil: 'domcontentloaded' })
await page.getByRole('button', { name: /Modern Farmhouse/ }).first().click()
await page.waitForTimeout(2500)
await shot(page, '6c-resumed')

// ── send ──
await page.getByRole('button', { name: /send to drafters/ }).click()
await shot(page, '7-send')
await page.getByRole('button', { name: 'Drafter package' }).click()
await page.screenshot({ path: `${out}/7b-package.png`, fullPage: true })
await page.getByRole('button', { name: 'Summary' }).click()
const office = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const dp = await office.newPage()
watch(dp)
if (PLAT) {
  // blocked until a drafter confirms the lot read from the plat
  await page.getByRole('button', { name: 'Send to drafters', exact: true }).click()
  await page.getByText(/has not confirmed your lot/).waitFor({ timeout: 30000 })
  await shot(page, '7c-send-blocked-lot')
  await dp.goto('http://localhost:5173/#/review', { waitUntil: 'domcontentloaded' })
  await dp.locator('#signin-email').fill('drafter@drafthouse.local')
  await dp.getByRole('button', { name: 'Continue' }).click()
  await dp.getByText('Lots to confirm').waitFor({ timeout: 15000 })
  await shot(dp, '9d-lots-to-confirm')
  await dp.locator('.inbox-row').first().click()
  await dp.locator('#lot-note').waitFor()
  await dp.waitForTimeout(2500)
  await shot(dp, '9e-lot-confirm')
  await dp.locator('#lot-note').fill('Checked against the site plan. Calls match.')
  await dp.getByRole('button', { name: 'Confirm lot' }).click()
  await dp.getByText(/confirmed by/).waitFor({ timeout: 15000 })
  await dp.getByRole('button', { name: '← Inbox' }).click()
}
await page.getByRole('button', { name: 'Send to drafters', exact: true }).click()
await page.getByText('With the drafting team').waitFor({ timeout: 30000 })
await shot(page, '8-sent-in-review')

// ── drafter: review inbox, open, return with a note ──
if (!PLAT) {
  await dp.goto('http://localhost:5173/#/review', { waitUntil: 'domcontentloaded' })
  await dp.locator('#signin-email').fill('drafter@drafthouse.local')
  await dp.getByRole('button', { name: 'Continue' }).click()
}
await dp.getByText('Waiting for you (1)').waitFor({ timeout: 15000 })
await dp.waitForTimeout(500)
await shot(dp, '9-review-inbox')
await dp.locator('.inbox-row').first().click()
await dp.locator('#review-note').waitFor()
await dp.waitForTimeout(2500)
await shot(dp, '9b-review-open')
await dp.locator('#review-note').fill('Nice plan. Give the office a window on the outside wall and send it back.')
await dp.getByRole('button', { name: 'Return with note' }).click()
await dp.getByText('Back to you').first().waitFor()

// ── client sees the note, sends again; drafter approves; the office builds it ──
await page.getByText('Your drafter sent it back').waitFor({ timeout: 15000 })
await shot(page, '8b-returned')
await page.getByRole('button', { name: 'Back to the draft' }).click()
await page.waitForTimeout(1500)
await page.getByRole('button', { name: /send to drafters/ }).click()
await page.getByRole('button', { name: 'Send to drafters', exact: true }).click()
await page.getByText('With the drafting team').waitFor({ timeout: 30000 })
await dp.getByRole('button', { name: '← Inbox' }).click()
await dp.getByText('Waiting for you (1)').waitFor({ timeout: 15000 })
await dp.locator('.inbox-row').first().click()
await dp.locator('#review-note').waitFor()
await dp.locator('#review-note').fill('Approved. Building the model now.')
await dp.getByRole('button', { name: /Approve, build in Revit/ }).click()
await dp.getByText('Revit job').waitFor({ timeout: 15000 })
await shot(dp, '9c-review-approved')
await page.getByText('Your Revit model is ready').waitFor({ timeout: 60000 })
await shot(page, '8c-built')

// ── office dashboard (same drafter sign-in) ──
await dp.goto('http://localhost:5173/#/admin', { waitUntil: 'domcontentloaded' })
await dp.waitForTimeout(3000)
await dp.screenshot({ path: `${out}/10-admin.png`, fullPage: true })
console.log('saved 10-admin')
await browser.close()
