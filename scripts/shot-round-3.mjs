// Screenshots for fix round 3, at 1440 and at a true 390 x 844: the first draft's floor plan drawing,
// the price range on the rooms step, the plan after the 10 requests (with each request's outcome),
// 3D after "add a bedroom" and "make the garage 3 cars", the Send screen with the price range and
// the PDF button, and the drafter's Review with its audit panel. Works against an older build too
// (missing pieces are skipped and said so).
//   node scripts/shot-round-3.mjs <outDir> [appUrl]     (office API behind the app, local sign-in)
import { chromium } from 'playwright-core'
import fs from 'node:fs'

const out = process.argv[2] || 'shots/round-3'
const APP = (process.argv[3] || 'http://localhost:4173').replace(/\/$/, '')
const RUN = Date.now().toString(36).slice(-4)
fs.mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium' })
const errors = []
const REQUESTS = ['add a bedroom', 'make the garage 3 cars', 'make the kitchen 2 feet wider', 'make the living room 3 feet deeper', 'make the dining room bigger', 'make the primary bedroom bigger', 'make the primary closet bigger', 'add a porch on the back', 'make the pantry smaller', 'make bedroom 2 bigger']

async function flow(viewport, tag) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: viewport.width < 500 ? 2 : 1, isMobile: viewport.width < 500, hasTouch: viewport.width < 500 })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`))
  const shot = async (name, opts = {}) => {
    await page.waitForTimeout(opts.wait ?? 900)
    await page.screenshot({ path: `${out}/${tag}-${name}.png`, fullPage: !!opts.full })
    console.log('saved', `${tag}-${name}`)
  }
  const has = async (loc) => (await loc.count()) > 0
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)
  await page.locator('#signin-name').fill('Round Three')
  await page.locator('#signin-email').fill(`r3-${RUN}-${tag}@example.com`)
  await page.getByRole('button', { name: /Continue|Email me/ }).click()
  await page.locator('#start-address').waitFor({ timeout: 20000 })
  await page.locator('#start-address').fill('1300 W Nolana Ave, McAllen, TX 78504')
  await page.getByRole('button', { name: 'Find my lot' }).click()
  await page.locator('#lot-city').waitFor({ timeout: 20000 })
  await page.waitForTimeout(3500)
  const confirm = page.locator('#lot-confirm')
  if (await has(confirm)) await confirm.check()
  await page.getByRole('button', { name: /pick a style/ }).click()
  await page.getByRole('button', { name: /Modern Farmhouse/ }).click()
  await page.getByRole('button', { name: /Next, rooms/ }).click()
  await page.waitForTimeout(600)
  await shot('01-rooms-price', { full: true })
  await page.getByRole('button', { name: /Draft my house/ }).click()
  await page.getByText(/changes? left/).waitFor({ timeout: 30000 })
  await page.waitForTimeout(2500)
  await shot('02-draft-3d-first')
  await page.getByRole('button', { name: 'Plan', exact: true }).click()
  await shot('03-plan-first', { wait: 1200 })
  const ask = async (text) => {
    await page.getByPlaceholder(/change|Move the laundry/).fill(text)
    await page.getByRole('button', { name: 'Change', exact: true }).click()
    await page.locator('.msg.thinking').waitFor({ state: 'hidden', timeout: 90000 })
    const last = page.locator('.msg.house').last()
    return { text: (await last.textContent()).trim(), held: (await last.getAttribute('class')).includes('held') }
  }
  const results = []
  for (const t of REQUESTS) {
    results.push([t, await ask(t)])
    if (t === 'make the garage 3 cars') {
      await page.getByRole('button', { name: '3D', exact: true }).click()
      await shot('04-3d-bedroom-garage', { wait: 1500 })
      await page.getByRole('button', { name: 'Plan', exact: true }).click()
    }
  }
  results.forEach(([t, r]) => console.log(`  ${tag} "${t}" → ${r.held ? 'REFUSED' : 'applied'}: ${r.text.slice(0, 120)}`))
  await shot('05-plan-after-10', { wait: 1200 })
  await page.getByRole('button', { name: '3D', exact: true }).click()
  await shot('06-3d-after-10', { wait: 1500 })
  await page.getByRole('button', { name: /send to drafters/ }).click()
  await page.waitForTimeout(800)
  await shot('07-send-price', { full: true })
  const sendBtn = page.getByRole('button', { name: 'Send to drafters', exact: true })
  let sent = false
  if ((await has(sendBtn)) && (await sendBtn.isEnabled())) {
    await sendBtn.click()
    await page.waitForTimeout(2500)
    sent = true
    await shot('08-sent')
  } else console.log(`  ${tag} Send is disabled: ${await page.locator('.rules, .problems').first().textContent().catch(() => '(no reason shown)')}`)
  await ctx.close()
  return { results, sent }
}

const desktop = await flow({ width: 1440, height: 900 }, 'desktop')
const phone = await flow({ width: 390, height: 844 }, 'phone')

// the drafter: review inbox, the project, the audit panel
for (const [viewport, tag] of [[{ width: 1440, height: 900 }, 'desktop'], [{ width: 390, height: 844 }, 'phone']]) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: viewport.width < 500 ? 2 : 1, isMobile: viewport.width < 500 })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`review ${tag}: ${e.message}`))
  await page.goto(APP + '/#/review', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  if (await page.locator('#signin-email').count()) {
    await page.locator('#signin-email').fill('maria@drafthouse.test')
    await page.getByRole('button', { name: /Continue|Email me|Sign in/ }).click()
    await page.waitForTimeout(1500)
  }
  const rows = page.locator('.inbox-row')
  if (await rows.count()) {
    await rows.first().click()
    await page.waitForTimeout(2000)
    await page.screenshot({ path: `${out}/${tag}-09-review-audit.png`, fullPage: true })
    console.log('saved', `${tag}-09-review-audit`)
    const audit = await page.locator('.card.audit h3').first().textContent().catch(() => null)
    console.log(`  ${tag} review audit: ${audit || 'NO AUDIT PANEL'}`)
  } else {
    await page.screenshot({ path: `${out}/${tag}-09-review-empty.png`, fullPage: true })
    console.log(`  ${tag} review inbox is empty (sent: ${desktop.sent}/${phone.sent})`)
  }
  await ctx.close()
}
await browser.close()
if (errors.length) {
  console.log('PAGE ERRORS:')
  errors.forEach((e) => console.log('  ' + e))
}
console.log(`done: ${out}`)
