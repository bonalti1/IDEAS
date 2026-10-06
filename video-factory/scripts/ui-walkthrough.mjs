// Drives the running app (npm run dev) through the whole workflow in a
// headless browser and saves screenshots. Usage:
//   node scripts/ui-walkthrough.mjs <photo.jpg> [outDir]
import fs from 'node:fs'
import { chromium } from 'playwright-core'

const [photo, outDir = 'shots'] = process.argv.slice(2)
const BASE = process.env.APP_URL ?? 'http://localhost:5174'
fs.mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))
page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE:', m.text()))
page.on('dialog', (d) => d.accept())

let n = 0
const shot = async (name, full = true) => {
  const f = `${outDir}/${String(++n).padStart(2, '0')}-${name}.png`
  await page.screenshot({ path: f, fullPage: full })
  console.log('saved', f)
}
const btn = (name) => page.getByRole('button', { name, exact: true })
const click = async (name, idx = 0) => {
  const b = btn(name).nth(idx)
  await b.waitFor({ state: 'visible', timeout: 15000 })
  await b.click()
}
const idle = async () => {
  await page.waitForTimeout(400)
  await page.waitForFunction(() => !document.querySelector('.job.running, .job.queued'), null, { timeout: 120000 })
  await page.waitForTimeout(1600) // allow the next poll to refresh
}
const tab = (name) => page.locator('.step', { hasText: name }).click()

await page.goto(BASE)
await shot('home', false)

await click('+ New project')
await page.getByPlaceholder('e.g. Smith residence driveway').fill('Smith residence driveway')
await page.locator('input[type=file]').setInputFiles(photo)
await shot('new-project', false)
await click('Create project')

await click('Analyze photo')
await idle()
await shot('scene-analyzed')
await click('Approve scene')
await page.waitForTimeout(500)

await tab('Work area')
await click('Automatic mask (SAM 2)')
await idle()
await shot('mask-auto')
// Manual correction: paint a stroke onto the canvas, then save.
const c = await page.locator('canvas.mask-canvas').boundingBox()
await page.mouse.move(c.x + c.width * 0.25, c.y + c.height * 0.5)
await page.mouse.down()
await page.mouse.move(c.x + c.width * 0.75, c.y + c.height * 0.52, { steps: 12 })
await page.mouse.up()
await click('Save manual mask')
await page.waitForTimeout(1500)
await shot('mask-manual')
await click('Approve mask')
await page.waitForTimeout(500)

await tab('Stage plan')
await click('Propose stages with AI')
await idle()
await shot('plan')
await click('Approve plan')
await page.waitForTimeout(500)

await tab('Stage images')
for (let i = 0; i < 4; i++) {
  await click('Compose prompt')
  await idle()
  if (i === 0) await shot('stage1-prompt')
  await click('Approve prompt')
  await page.waitForTimeout(400)
  if (i === 0) {
    // Side-by-side: tick the second image provider.
    await page.locator('.gen-box .provider input').nth(1).check()
  }
  await click(i === 0 ? 'Generate 2 candidates' : 'Generate candidate')
  await idle()
  if (i === 0) await shot('stage1-candidates')
  await click('Approve this image')
  await page.waitForTimeout(1200)
}
await shot('stages-approved')

await tab('Clips')
await click('Prepare clips from approved images')
await page.waitForTimeout(800)
for (let i = 0; i < 4; i++) await click('Animate', 0)
await idle()
await shot('clips-generated')
for (let i = 0; i < 4; i++) {
  await click('Approve this clip', 0)
  await page.waitForTimeout(900)
}

await tab('Export')
await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Smith Residence')
await click('Save branding')
await page.waitForTimeout(600)
await click('Render final video')
await idle()
await page.waitForTimeout(800)
await shot('export')

// Mobile layout check.
await page.setViewportSize({ width: 390, height: 844 })
await tab('Stage images')
await page.waitForTimeout(800)
await shot('mobile-stages', false)
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
console.log('horizontal overflow at 390px:', overflow)
await browser.close()
