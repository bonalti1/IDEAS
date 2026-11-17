// Screenshots for fix round 4, at 1440 and at a true 390 x 844: the site plan tab, the 3-car garage
// after "make the garage 3 cars", the 50 ft lot plan, Send and Review after "add a bedroom" and
// "3 cars" (the counts follow the plan), the options picker, and the Review audit panel with a ⚠.
//   node scripts/shot-round-4.mjs <outDir> [appUrl]     (office API behind the app, local sign-in)
import { chromium } from 'playwright-core'
import fs from 'node:fs'

const out = process.argv[2] || 'shots/round-4'
const APP = (process.argv[3] || 'http://localhost:4173').replace(/\/$/, '')
const RUN = Date.now().toString(36).slice(-4)
fs.mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium' })
const errors = []
const ctxFor = (viewport) => browser.newContext({ viewport, deviceScaleFactor: viewport.width < 500 ? 2 : 1, isMobile: viewport.width < 500, hasTouch: viewport.width < 500 })

async function signIn(page, tag, who = 'Round Four') {
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)
  await page.locator('#signin-name').fill(who)
  await page.locator('#signin-email').fill(`r4-${RUN}-${tag}@example.com`)
  await page.getByRole('button', { name: /Continue|Email me/ }).click()
  await page.locator('#start-address').waitFor({ timeout: 20000 })
}
async function toLot(page, address) {
  await page.locator('#start-address').fill(address)
  await page.getByRole('button', { name: 'Find my lot' }).click()
  await page.locator('#lot-city').waitFor({ timeout: 20000 })
  await page.waitForTimeout(3000)
}
async function toDraft(page) {
  const confirm = page.locator('#lot-confirm')
  if (await confirm.count()) await confirm.check()
  await page.getByRole('button', { name: /pick a style/ }).click()
  await page.getByRole('button', { name: /Modern Farmhouse/ }).click()
  await page.getByRole('button', { name: /Next, rooms/ }).click()
  await page.waitForTimeout(600)
  const tryThat = page.getByRole('button', { name: 'Try that' })
  if (await tryThat.count()) await tryThat.click()
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: /Draft my house/ }).click()
  await page.getByText(/changes? left/).waitFor({ timeout: 30000 })
  await page.waitForTimeout(2500)
}
const ask = async (page, text) => {
  await page.getByPlaceholder(/change|Move the laundry/).fill(text)
  await page.getByRole('button', { name: 'Change', exact: true }).click()
  await page.locator('.msg.thinking').waitFor({ state: 'hidden', timeout: 90000 })
  await page.waitForTimeout(900)
  const last = page.locator('.msg.house').last()
  return { text: (await last.textContent()).trim(), held: (await last.getAttribute('class')).includes('held') }
}

async function flow(viewport, tag) {
  const ctx = await ctxFor(viewport)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`))
  const shot = async (name, opts = {}) => {
    await page.waitForTimeout(opts.wait ?? 900)
    await page.screenshot({ path: `${out}/${tag}-${name}.png`, fullPage: !!opts.full })
    console.log('saved', `${tag}-${name}`)
  }
  await signIn(page, tag)
  await toLot(page, '1300 W Nolana Ave, McAllen, TX 78504')
  await toDraft(page)
  await page.getByRole('button', { name: 'Site', exact: true }).click()
  await shot('01-site-plan', { wait: 1400 })
  const r1 = await ask(page, 'add a bedroom')
  console.log(`  ${tag} "add a bedroom" → ${r1.held ? 'REFUSED' : 'applied'}: ${r1.text.slice(0, 100)}`)
  const r2 = await ask(page, 'make the garage 3 cars')
  console.log(`  ${tag} "make the garage 3 cars" → ${r2.held ? 'REFUSED' : 'applied'}: ${r2.text.slice(0, 100)}`)
  await page.getByRole('button', { name: 'Plan', exact: true }).click()
  await shot('02-plan-3-car', { wait: 1400 })
  await page.getByRole('button', { name: '3D', exact: true }).click()
  await shot('03-3d-3-car', { wait: 1600 })
  const r3 = await ask(page, 'show me garage options')
  console.log(`  ${tag} "show me garage options" → ${(await page.locator('.picker .option').count())} options: ${r3.text.slice(0, 100)}`)
  await shot('04-options-picker')
  const header = await page.locator('.viewport-tag').textContent().catch(() => '')
  await page.getByRole('button', { name: /send to drafters/ }).click()
  await page.waitForTimeout(800)
  await shot('05-send-counts', { full: true })
  const program = await page.locator('.stat').filter({ hasText: 'Program' }).textContent().catch(() => '')
  console.log(`  ${tag} header "${header.trim()}" · Send ${program.replace(/\s+/g, ' ').trim()}`)
  const sendBtn = page.getByRole('button', { name: 'Send to drafters', exact: true })
  let sent = false
  if ((await sendBtn.count()) && (await sendBtn.isEnabled())) {
    await sendBtn.click()
    await page.waitForTimeout(2500)
    sent = true
  } else console.log(`  ${tag} Send is disabled: ${await page.locator('.rules, .problems').first().textContent().catch(() => '(no reason shown)')}`)
  await ctx.close()
  return { sent }
}

async function narrowLot(viewport, tag) {
  const ctx = await ctxFor(viewport)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`${tag} narrow: ${e.message}`))
  await signIn(page, tag + '-n', 'Narrow Lot')
  await toLot(page, '500 S Cage Blvd, Pharr, TX 78577')
  // the lot step opens on "Type it in" when there is no plat; the fields take the real size
  const typeIn = page.getByRole('button', { name: 'Type it in' })
  if ((await typeIn.count()) && !(await typeIn.getAttribute('class') || '').includes('on')) await typeIn.click({ force: true })
  await page.locator('#lot-width').fill('50')
  await page.locator('#lot-depth').fill('120')
  await page.locator('#lot-city').selectOption('pharr')
  await page.waitForTimeout(600)
  await toDraft(page)
  await page.getByRole('button', { name: 'Plan', exact: true }).click()
  await page.waitForTimeout(1400)
  await page.screenshot({ path: `${out}/${tag}-06-narrow-lot-plan.png` })
  console.log('saved', `${tag}-06-narrow-lot-plan`, '·', (await page.locator('.viewport-tag').textContent().catch(() => '')).trim())
  await page.getByRole('button', { name: 'Site', exact: true }).click()
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${out}/${tag}-07-narrow-lot-site.png` })
  console.log('saved', `${tag}-07-narrow-lot-site`)
  await ctx.close()
}

// ONLY=narrow or ONLY=review reruns one part (the main flows leave their sent designs in the inbox)
const ONLY = process.env.ONLY || ''
const desktop = ONLY ? { sent: true } : await flow({ width: 1440, height: 900 }, 'desktop')
const phone = ONLY ? { sent: true } : await flow({ width: 390, height: 844 }, 'phone')
if (!ONLY || ONLY === 'narrow') {
  await narrowLot({ width: 1440, height: 900 }, 'desktop')
  await narrowLot({ width: 390, height: 844 }, 'phone')
}

// the drafter: the review with its audit panel (the ⚠ rows are warnings)
for (const [viewport, tag] of ONLY && ONLY !== 'review' ? [] : [[{ width: 1440, height: 900 }, 'desktop'], [{ width: 390, height: 844 }, 'phone']]) {
  const ctx = await ctxFor(viewport)
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
    await page.waitForTimeout(2200)
    await page.screenshot({ path: `${out}/${tag}-08-review-counts-audit.png`, fullPage: true })
    const warn = await page.locator('.checks li.warn').count()
    const audit = await page.locator('.card.audit h3').first().textContent().catch(() => null)
    console.log('saved', `${tag}-08-review-counts-audit`, `· ${audit || 'NO AUDIT PANEL'} · ${warn} ⚠ row${warn === 1 ? '' : 's'}`)
  } else console.log(`  ${tag} review inbox is empty (sent: ${desktop.sent}/${phone.sent})`)
  await ctx.close()
}
await browser.close()
if (errors.length) {
  console.log('PAGE ERRORS:')
  errors.forEach((e) => console.log('  ' + e))
}
console.log(`done: ${out}`)
