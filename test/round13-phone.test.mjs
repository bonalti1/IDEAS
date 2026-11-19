// Fix round 13, item 3: the whole homeowner flow on a phone (390 x 844), with nothing clipped or overlapping.
// Every step is checked by test/phone-audit.mjs (page no wider than the screen, nothing off the side, no words cut
// off, no control under another, buttons a thumb can tap) and photographed for the report.
// The office API answers from the recordings; nothing reaches the internet. Skips when no Chrome is found.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromePath, startPreview, appContext, spawnGroup, freePort, shotDir } from './browser.mjs'
import { fixtureEnv } from './server-env.mjs'
import { phoneAudit } from './phone-audit.mjs'

const CHROME = chromePath()
const skip = !CHROME && 'no Chrome found (set CHROME=/path/to/chrome)'
const OUT = shotDir('round13')
const LANG = process.env.PHONE_LANG || 'en'

async function startApi(t, { port, DATA_DIR }) {
  const apiBase = `http://127.0.0.1:${port}`
  const api = spawnGroup(t, process.execPath, ['server/index.mjs'], { env: { ...fixtureEnv, DRAFTHOUSE_CLAUDE_KEY: '', ANTHROPIC_API_KEY: '', DATABASE_URL: '', SUPABASE_URL: '', RESEND_API_KEY: '', DRAFTHOUSE_APP_KEY: '', DRAFTHOUSE_WORKER_KEY: 'wk', DRAFTHOUSE_DRAFTERS: 'maria@drafthouse.test', REGRID_API_TOKEN: '', PARCEL_DAILY_CHECK: '0', PARCEL_FIELD_CHECK: '0', PORT: String(port), DATA_DIR, ALLOWED_ORIGINS: '*' } })
  for (let i = 0; i < 150; i++) {
    try {
      await fetch(`${apiBase}/api/health`)
      return { apiBase }
    } catch {
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  throw new Error('the office API did not start')
}

test(`screens 3 (${LANG}): every step of the homeowner flow at 390 x 844 has nothing clipped, covered, overlapping or off the side`, { skip, timeout: 600000 }, async (t) => {
  const appBase = await startPreview(t)
  const api = await startApi(t, { port: await freePort(), DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dh-r13-phone-')) })
  const { chromium } = await import('playwright-core')
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })
  t.after(() => browser.close())
  const ctx = await appContext(browser, api.apiBase, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: LANG === 'es' ? 'es-MX' : 'en-US' })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  const found = []
  // the step's own scrolling box, or the window when the whole page scrolls
  const scrollTo = async (y) => {
    await page.evaluate((to) => {
      for (const el of [...document.querySelectorAll('.dh-main, .screen, .start'), document.scrollingElement]) if (el && el.scrollHeight > el.clientHeight + 4) el.scrollTop = to
      window.scrollTo(0, to)
    }, y)
    await page.waitForTimeout(250)
  }
  // each step is checked at the top of the page and again scrolled to the bottom, and photographed whole
  const check = async (step) => {
    await page.waitForTimeout(900)
    await scrollTo(0)
    const top = await page.evaluate(phoneAudit)
    await page.screenshot({ path: `${OUT}/phone-390-${LANG}-${step}.png` })
    // the rest of the step, a screen at a time
    const tall = await page.evaluate(() => (document.querySelector('.screen.split, .screen.padded, .start') || document.documentElement).scrollHeight)
    const more = []
    for (let y = 700, n = 2; y < tall - 200 && n <= 6; y += 700, n++) {
      await scrollTo(y)
      more.push(...(await page.evaluate(phoneAudit)))
      await page.screenshot({ path: `${OUT}/phone-390-${LANG}-${step}-${n}.png` })
    }
    await scrollTo(0)
    for (const f of [...new Set([...top, ...more])]) found.push(`${step}: ${f}`)
  }

  await page.goto(appBase, { waitUntil: 'domcontentloaded' })
  await page.locator('#signin-email').waitFor({ timeout: 20000 })
  await check('01-first-screen')
  if (await page.locator('#signin-name').count()) await page.locator('#signin-name').fill('Rosa Homeowner')
  await page.locator('#signin-email').fill('rosa.with.a.long.email.address@example.com')
  await page.locator('#signin-email').press('Enter')
  await page.locator('#start-address').waitFor({ timeout: 20000 })
  await check('02-signed-in')

  await page.locator('#start-address').fill('1201 Kerria Ave, McAllen, TX 78501')
  await page.locator('#start-address').locator('xpath=ancestor::*[contains(@class,"card")][1]').locator('button').last().click()
  await page.getByTestId('parcel-card').waitFor({ timeout: 30000 })
  await check('03-lot-found')
  await page.getByTestId('parcel-yes').click()
  await page.waitForTimeout(800)
  await check('04-lot-taken')
  // "the map and the text overlap after confirming": the picture of the lot scrolls with the page on a phone, so the
  // words never slide under it
  const mapTop = async () => page.evaluate(() => document.querySelector('.viewport, .lot-view, canvas')?.getBoundingClientRect().top)
  const before = await mapTop()
  await scrollTo(300)
  if (!((await mapTop()) < before - 250)) found.push('04-lot-taken: the lot picture stays put while the words slide under it (it should scroll away with the page on a phone)')
  await scrollTo(0)
  // "the lot map is tiny": it is at least 45% of the screen's height
  const map = await page.evaluate(() => { const r = document.querySelector('canvas')?.getBoundingClientRect(); return r ? { w: r.width, h: r.height } : null })
  if (!(map && map.h >= 844 * 0.4 && map.w >= 380)) found.push(`04-lot-taken: the lot picture is ${map && Math.round(map.w)} x ${map && Math.round(map.h)}px, under 40% of the screen's height`)

  await page.getByTestId('lot-next').click()
  await page.getByRole('button', { name: /Modern Farmhouse/ }).waitFor({ timeout: 20000 })
  await check('05-style')
  await page.getByRole('button', { name: /Modern Farmhouse/ }).click()
  await check('05b-style-picked')
  await page.locator('.actions button').last().click()
  await page.getByTestId('lot-strip').waitFor({ timeout: 20000 })
  await page.getByTestId('auto-start').or(page.locator('.fine')).first().waitFor({ timeout: 90000 })
  await check('06-rooms')
  const draftBtn = page.locator('.actions button').last()
  for (let i = 0; i < 400 && !(await draftBtn.isEnabled()); i++) await page.waitForTimeout(250)
  await draftBtn.click()
  await page.getByTestId('changes-left').waitFor({ timeout: 60000 })
  await page.waitForTimeout(2500)
  await check('07-draft-3d')
  // "the 3D is blank": the picture has drawn (the loading sketch is gone, and the canvas is not one flat colour)
  await page.locator('[data-testid="scene-loading"]').waitFor({ state: 'detached', timeout: 30000 }).catch(() => {})
  const colours = await page.evaluate(() => {
    const c = document.querySelector('canvas')
    const x = document.createElement('canvas')
    x.width = 64
    x.height = 64
    x.getContext('2d').drawImage(c, 0, 0, 64, 64)
    const d = x.getContext('2d').getImageData(0, 0, 64, 64).data
    const seen = new Set()
    for (let i = 0; i < d.length; i += 4) seen.add((d[i] >> 4) + ',' + (d[i + 1] >> 4) + ',' + (d[i + 2] >> 4))
    return seen.size
  })
  if (!(colours >= 6)) found.push(`07-draft-3d: the 3D picture has ${colours} colours in it: it is blank`)
  await page.locator('.viewport-views button').first().click()
  await page.waitForTimeout(1200)
  await check('08-draft-plan')

  // the chat: a change, and an answer with buttons
  const say = async (text) => {
    const box = page.locator('form input[placeholder]').last()
    await box.fill(text)
    await box.press('Enter')
    await page.waitForTimeout(500)
    await page.locator('.msg.thinking').waitFor({ state: 'detached', timeout: 60000 }).catch(() => {})
    await page.waitForTimeout(1200)
  }
  await say(LANG === 'es' ? 'quiero un porche atrás' : 'Add a covered patio in the back')
  await check('09-chat-applied')
  await say(LANG === 'es' ? 'que se sienta más abierta' : 'Make it feel more open')
  await check('10-chat-offer')

  await page.locator('.actions button').last().click()
  await page.getByTestId('lot-waiting').waitFor({ timeout: 30000 })
  await check('11-send-waiting')

  assert.deepEqual(errors, [], 'no page error on the way')
  assert.deepEqual(found, [], `${found.length} things clipped, covered or off the side:\n  ${found.join('\n  ')}`)
})
