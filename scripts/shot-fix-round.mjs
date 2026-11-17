// Screenshots for the fix round: the first screen, the lot step, the draft after three successful
// changes, a refused change with its fix buttons, the plan with labels, the Send screen, and every
// step at phone width. Works against the current app or an older build (missing pieces are skipped).
//   node scripts/shot-fix-round.mjs <outDir> [appUrl]     (office API behind the app, local sign-in)
import { chromium } from 'playwright-core'
import fs from 'node:fs'

const out = process.argv[2] || 'shots/fix-round'
const APP = (process.argv[3] || 'http://localhost:4173').replace(/\/$/, '')
const RUN = Date.now().toString(36).slice(-4)
fs.mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium' })
const errors = []

async function flow(viewport, tag) {
  const ctx = await browser.newContext({ viewport })
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
  await shot('01-first-screen', { full: true })
  await page.locator('#signin-name').fill('Fix Round')
  await page.locator('#signin-email').fill(`fix-${RUN}-${tag}@example.com`)
  await page.getByRole('button', { name: /Continue|Email me/ }).click()
  await page.locator('#start-address').waitFor({ timeout: 20000 })
  // a bad address must say what to type instead of greying the button out silently
  await page.locator('#start-address').fill('asdf')
  await page.waitForTimeout(300)
  const hint = await page.locator('#start-address-hint').textContent().catch(() => '')
  console.log(`  ${tag} "asdf" → ${hint ? 'hint: ' + hint : 'NO HINT'}`)
  await shot('01b-address-hint')
  await page.locator('#start-address').fill('1300 W Nolana Ave, McAllen, TX 78504')
  await page.getByRole('button', { name: 'Find my lot' }).click()
  await page.locator('#lot-city').waitFor({ timeout: 20000 })
  await page.waitForTimeout(3500) // geocode and flood
  await shot('02-lot')
  const confirm = page.locator('#lot-confirm')
  if (await has(confirm)) await confirm.check()
  await page.getByRole('button', { name: /pick a style/ }).click()
  await shot('03-style')
  await page.getByRole('button', { name: /Modern Farmhouse/ }).click()
  await page.getByRole('button', { name: /Next, rooms/ }).click()
  await page.waitForTimeout(600)
  await shot('04-rooms', { full: true })
  // the starter program as it comes, not the recent-build preset: this is the case that broke on the live site
  await page.getByRole('button', { name: /Draft my house/ }).click()
  await page.getByText(/changes? left/).waitFor({ timeout: 30000 })
  await page.waitForTimeout(2500)
  await shot('05-draft-first')
  const ask = async (text) => {
    await page.getByPlaceholder(/change|Move the laundry/).fill(text)
    await page.getByRole('button', { name: 'Change', exact: true }).click()
    await page.locator('.msg.thinking').waitFor({ state: 'hidden', timeout: 60000 })
    const last = page.locator('.msg.house').last()
    return { text: (await last.textContent()).trim(), held: (await last.getAttribute('class')).includes('held') }
  }
  const results = []
  for (const t of ['make the kitchen bigger', 'add a half bath', 'make the garage 3 cars']) results.push([t, await ask(t)])
  results.forEach(([t, r]) => console.log(`  ${tag} "${t}" → ${r.held ? 'REFUSED' : 'applied'}: ${r.text.slice(0, 110)}`))
  await shot('06-draft-three-changes')
  // a change that breaks a rule: the refusal should list every problem and offer a fix
  const bad = await ask('make the primary bedroom 40 feet wide')
  console.log(`  ${tag} refusal → ${bad.text.slice(0, 160)}`)
  await shot('07-refusal')
  if (await has(page.locator('.fixes button'))) {
    await page.locator('.fixes button').first().click()
    await page.locator('.msg.thinking').waitFor({ state: 'hidden', timeout: 60000 })
    await shot('07b-fix-applied')
  }
  await page.getByRole('button', { name: 'Plan', exact: true }).click()
  await page.waitForTimeout(800)
  await shot('08-plan-labels')
  if (await has(page.getByRole('button', { name: 'Undo last change' }))) {
    await page.getByRole('button', { name: 'Undo last change' }).click()
    await page.waitForTimeout(1200)
  }
  await page.getByRole('button', { name: /send to drafters/ }).click()
  await page.waitForTimeout(800)
  await shot('09-send', { full: true })
  await ctx.close()
  return results
}

await flow({ width: 1440, height: 900 }, 'desktop')
await flow({ width: 390, height: 844 }, 'phone')
await browser.close()
if (errors.length) {
  console.log('PAGE ERRORS:')
  errors.forEach((e) => console.log('  ' + e))
}
console.log(`done: ${out}`)

// the drafter view and the staff links: a visitor gets the office sign-in, never the project
{
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium' })
  const page = await (await b.newContext({ viewport: { width: 1200, height: 800 } })).newPage()
  await page.goto(APP + '/#/lot514', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)
  const gated = await page.getByText('Office sign-in').count()
  const leaked = await page.getByText(/VILLA-RAMA EAST/).count()
  console.log(`#/lot514 without sign-in: ${gated ? 'office sign-in shown' : 'NO GATE'}, project ${leaked ? 'VISIBLE' : 'hidden'}`)
  await page.screenshot({ path: `${out}/gate-lot514.png` })
  await b.close()
}
