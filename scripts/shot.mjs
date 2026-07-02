import { chromium } from 'playwright-core'
import fs from 'node:fs'

const outDir = process.argv[2] || 'shots'
fs.mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE ERROR:', m.text())
})
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))
await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3500)

const views = ['Top', '3D', 'Showers Rd', 'Ida Blvd', 'Don St']
for (const v of views) {
  await page.getByRole('button', { name: v, exact: true }).click()
  await page.waitForTimeout(900)
  const file = `${outDir}/${v.replace(/\W+/g, '_')}.png`
  await page.screenshot({ path: file })
  console.log('saved', file)
}
await browser.close()
