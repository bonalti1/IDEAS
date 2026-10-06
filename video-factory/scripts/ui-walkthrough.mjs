// Drives the running app (npm run dev) through the whole guided flow in a
// headless browser and saves screenshots. Usage:
//   node scripts/ui-walkthrough.mjs <photo.jpg> [outDir]
import fs from 'node:fs'
import { chromium } from 'playwright-core'

const [photo, outDir = 'shots'] = process.argv.slice(2)
const BASE = process.env.APP_URL ?? 'http://localhost:5174'
fs.mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' })
const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 })
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))
page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && console.log('CONSOLE:', m.text()))
page.on('dialog', (d) => d.accept())

let n = 0
const shot = async (name, full = false) => {
  const f = `${outDir}/${String(++n).padStart(2, '0')}-${name}.png`
  await page.screenshot({ path: f, fullPage: full })
  console.log('saved', f)
}
const click = async (name) => {
  const b = page.getByRole('button', { name, exact: true }).first()
  await b.waitFor({ state: 'visible', timeout: 60000 })
  await b.click()
}
const idle = async () => {
  await page.waitForTimeout(500)
  await page.waitForFunction(() => !document.querySelector('.working, .shimmer'), null, { timeout: 180000 })
  await page.waitForTimeout(700)
}

await page.goto(BASE)
await page.waitForTimeout(800)
await shot('home-empty')

await click('Start your first video')
await page.locator('.drop input[type=file]').setInputFiles(photo)
await page.getByPlaceholder('e.g. Smith driveway').fill('Smith driveway')
await page.waitForTimeout(300)
await shot('new-video')
await click('Start')

await idle()
await shot('1-photo')
await click('Looks right')

await idle()
await shot('2-work-area')
await click('Fix the area')
await page.waitForTimeout(300)
await shot('2b-fix-area')
await click('Yes, looks right')

await idle()
await shot('3-plan')
await click('Looks good')

for (let i = 0; i < 4; i++) {
  await idle()
  if (i === 0) await shot('4-instructions')
  await click('Create pictures')
  await idle()
  if (i === 0) await shot('4b-pick-best')
  await click('Use this one')
  await page.waitForTimeout(600)
  if (i === 0) await shot('4c-next-step-starts')
}

await idle()
await shot('5-clips-start')
await page.getByRole('button', { name: /^Animate all/ }).click()
await page.waitForTimeout(1500)
await idle()
await shot('5b-clips-review', true)
for (let i = 0; i < 4; i++) {
  await click('Use this clip')
  await page.waitForTimeout(700)
}
await idle()
await shot('6-make-video')
await click('Make my video')
await page.waitForTimeout(1000)
await idle()
await shot('6b-video-ready')

await page.goto(BASE)
await page.waitForTimeout(800)
await shot('home-projects')

// Phone
await page.setViewportSize({ width: 390, height: 844 })
await page.goto(`${BASE}/#/new`)
await page.waitForTimeout(600)
await shot('phone-new')
const pid = (await page.evaluate(() => fetch('/api/projects').then((r) => r.json())))[0].id
await page.goto(`${BASE}/#/p/${pid}/pictures`)
await page.waitForTimeout(1200)
await shot('phone-pictures', true)
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
console.log('horizontal overflow at 390px:', overflow)
await browser.close()
