// Fix round 15, item U9, in the built app at 1440 x 900: the default rooms on 1201 Kerria Ave (the recorded parcel),
// drafted as a homeowner drafts them. The Draft screen's plan view at 100% shows the room names at 12 px or more on the
// main rooms and 10 px on every label (they were about 5 px on the narrow plan), and the 3D view draws the Valley plan
// (4 bed, 3.5 bath, office, 2-car) under its hips. Pictures go to $SHOTS (r15-house-kerria-3d, r15-house-kerria-plan).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromePath, startPreview, appContext, freePort, spawnGroup, shotDir } from './browser.mjs'

const CHROME = chromePath()
const skip = !CHROME && 'no Chrome found (set CHROME=/path/to/chrome)'
const SHOTS = shotDir('round15-house')

async function startServer(t, app) {
  const port = await freePort()
  const base = `http://127.0.0.1:${port}`
  const { log } = spawnGroup(t, process.execPath, ['server/index.mjs'], { env: { DRAFTHOUSE_CLAUDE_KEY: '', ANTHROPIC_API_KEY: '', DATABASE_URL: '', SUPABASE_URL: '', RESEND_API_KEY: '', BILLING_ENABLED: '', DRAFTHOUSE_APP_KEY: '', DRAFTHOUSE_WORKER_KEY: 'test-worker-key', DRAFTHOUSE_DRAFTERS: 'maria@drafthouse.test', PORT: String(port), DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dh-r15-house-')), DRAFTHOUSE_APP_ORIGIN: app } })
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(base + '/api/health')
      return base
    } catch {
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  throw new Error('server did not start:\n' + log())
}

test('U9 in the app (1440 x 900, Kerria): the plan view\'s room labels read at 100%, and the house is the Valley plan with the rooms asked for', { skip, timeout: 400000 }, async (t) => {
  const { chromium } = await import('playwright-core')
  const app = await startPreview(t)
  const api = await startServer(t, app)
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })
  t.after(() => browser.close())
  const ctx = await appContext(browser, api, { viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(app, { waitUntil: 'domcontentloaded' })
  await page.locator('#signin-name').fill('Test Homeowner')
  await page.locator('#signin-email').fill(`r15-house-${Date.now().toString(36)}@example.com`)
  await page.getByRole('button', { name: /Continue|Email me/ }).click()
  await page.locator('#start-address').waitFor({ timeout: 20000 })
  await page.locator('#start-address').fill('1201 Kerria Ave, McAllen, TX 78501')
  await page.getByRole('button', { name: 'Find my lot' }).click()
  await page.getByTestId('parcel-yes').waitFor({ timeout: 30000 })
  await page.getByTestId('parcel-yes').click()
  await page.waitForTimeout(1500)
  const confirm = page.locator('#lot-confirm')
  if ((await confirm.count()) && !(await confirm.isChecked())) await confirm.check()
  await page.getByTestId('lot-next').click()
  await page.getByTestId('style-farmhouse').click()
  await page.getByRole('button', { name: /Next, rooms/ }).click()
  await page.getByRole('button', { name: /Draft my house/ }).waitFor({ timeout: 30000 })
  await page.waitForFunction(() => !/Checking the lot…/.test(document.body.innerText), null, { timeout: 120000 }).catch(() => {})
  await page.waitForTimeout(1000)
  // the default rooms fit this lot as asked: no offer to take instead
  assert.equal(await page.getByRole('button', { name: /Draft my house/ }).isEnabled(), true)
  await page.getByRole('button', { name: /Draft my house/ }).click()
  await page.getByLabel(/^Your change$/).waitFor({ timeout: 90000 })
  await page.waitForTimeout(4000)
  const strip = await page.locator('.viewport-tag, .viewport-stage').first().innerText().catch(() => '')
  assert.match(await page.evaluate(() => document.body.innerText), /4 bed · 3\.5 bath · 2-car/i, strip)
  await page.screenshot({ path: path.join(SHOTS, 'r15-house-kerria-3d-1440.png') })
  await page.locator('.viewport-views button', { hasText: 'Plan' }).click()
  await page.waitForTimeout(1500)
  await page.screenshot({ path: path.join(SHOTS, 'r15-house-kerria-plan-1440.png') })
  const shown = await page.evaluate(() => {
    const svg = document.querySelector('.plan-drawing svg')
    const k = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width
    const frame = document.querySelector('.plan-drawing').getBoundingClientRect()
    return {
      frame: [Math.round(frame.width), Math.round(frame.height)],
      labels: [...svg.querySelectorAll('text.label')].map((t) => {
        const spans = [...t.querySelectorAll('tspan')]
        const name = spans.filter((s) => s.getAttribute('font-weight') === '700')
        const size = spans.find((s) => s.getAttribute('font-weight') !== '700')
        return { id: t.getAttribute('data-id'), name: name.map((s) => s.textContent).join(' '), namePx: +name[0].getAttribute('font-size') * k, sizePx: size ? +size.getAttribute('font-size') * k : null }
      }),
    }
  })
  console.log(`  plan frame ${shown.frame.join(' x ')} px; labels ${shown.labels.map((l) => `${l.name} ${l.namePx.toFixed(1)}${l.sizePx ? '/' + l.sizePx.toFixed(1) : ''}`).join(', ')}`)
  const big = ['LIVING', 'KITCHEN', 'DINING', 'PRIMARY BEDROOM', 'BEDROOM 1', 'BEDROOM 2', 'BEDROOM 3', '2-CAR GARAGE', 'ENTRY', 'FRONT PORCH']
  for (const name of big) {
    const l = shown.labels.find((x) => x.name === name)
    assert.ok(l, `${name} is labelled`)
    assert.ok(l.namePx >= 12 - 0.05, `${name} at ${l.namePx.toFixed(1)} px`)
    assert.ok(l.sizePx >= 10 - 0.05, `${name}'s size at ${l.sizePx?.toFixed(1)} px`)
  }
  for (const l of shown.labels) assert.ok(l.namePx >= 10 - 0.05, `${l.name} at ${l.namePx.toFixed(1)} px`)
  assert.deepEqual(errors, [])
})
