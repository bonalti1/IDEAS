// Walk the Draft House client flow and screenshot each step.
// usage: node scripts/shot-flow.mjs <outDir>   (dev server on :5173)
import { chromium } from 'playwright-core'
import fs from 'node:fs'

const out = process.argv[2] || 'shots/flow'
fs.mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))
page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE ERROR:', m.text()))

const shot = async (n) => {
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${out}/${n}.png` })
  console.log('saved', n)
}

await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' })
await shot('1-start')
await page.getByPlaceholder(/Street address/).fill('Lot 514, Villa-Rama East Phase V, Palmview TX')
await page.getByRole('button', { name: 'Find my lot' }).click()
await page.waitForTimeout(2500)
await shot('2-lot')
await page.getByRole('button', { name: /pick a style/ }).click()
await shot('3-style')
await page.getByRole('button', { name: /Modern Farmhouse/ }).click()
await page.getByRole('button', { name: /Next, rooms/ }).click()
await shot('4-rooms')
await page.getByRole('button', { name: /Draft my house/ }).click()
await page.waitForTimeout(2500)
await shot('5-draft')
await page.getByRole('button', { name: 'Make the kitchen bigger' }).click()
await page.waitForTimeout(600)
await page.getByPlaceholder(/Move the laundry/).fill('add an office')
await page.getByRole('button', { name: 'Change', exact: true }).click()
await page.waitForTimeout(800)
await page.getByRole('button', { name: 'Plan', exact: true }).click()
await shot('6-draft-edited')
await page.getByRole('button', { name: /send to drafters/ }).click()
await shot('7-send')
await page.getByRole('button', { name: 'Send to drafters', exact: true }).click()
await shot('8-sent')
await browser.close()
