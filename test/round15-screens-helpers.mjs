// Shared by the round 15 screen tests (test/round15-screens*.test.mjs): the office API on the recordings, a browser,
// sign-in, and the walk from the first screen to the rooms step. Nothing reaches the internet.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromePath, startPreview, appContext, spawnGroup, freePort, shotDir } from './browser.mjs'
import { fixtureEnv } from './server-env.mjs'

export const CHROME = chromePath()
export const skip = !CHROME && 'no Chrome found (set CHROME=/path/to/chrome)'
export const OUT = shotDir('round15-screens')
export const KISKADEE = '2002 Kiskadee Ln, Mission, TX 78572'
export const KERRIA = '1201 Kerria Ave, McAllen, TX 78501'
export const PLAT = 'test/fixtures/garza-site-plan.png'

export async function startApi(t, env = {}) {
  const port = await freePort()
  const apiBase = `http://127.0.0.1:${port}`
  spawnGroup(t, process.execPath, ['server/index.mjs'], { env: { ...fixtureEnv, DRAFTHOUSE_CLAUDE_KEY: '', ANTHROPIC_API_KEY: '', DATABASE_URL: '', SUPABASE_URL: '', RESEND_API_KEY: '', DRAFTHOUSE_APP_KEY: '', DRAFTHOUSE_WORKER_KEY: 'wk', DRAFTHOUSE_DRAFTERS: 'maria@drafthouse.test', REGRID_API_TOKEN: '', PARCEL_DAILY_CHECK: '0', PARCEL_FIELD_CHECK: '0', PORT: String(port), DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dh-r15-screens-')), ALLOWED_ORIGINS: '*', ...env } })
  for (let i = 0; i < 150; i++) {
    try {
      await fetch(`${apiBase}/api/health`)
      return apiBase
    } catch {
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  throw new Error('the office API did not start')
}

/** The built app, the office API and a browser; `open(size, opts)` gives a fresh page pointed at that API. */
export async function setup(t) {
  const appBase = await startPreview(t)
  const apiBase = await startApi(t)
  const { chromium } = await import('playwright-core')
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
  t.after(() => browser.close())
  const errors = []
  const open = async ([w, h], { lang = 'en', phone = w < 600 } = {}) => {
    const ctx = await appContext(browser, apiBase, { viewport: { width: w, height: h }, deviceScaleFactor: 1, locale: lang === 'es' ? 'es-MX' : 'en-US', ...(phone ? { isMobile: true, hasTouch: true } : {}) })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(appBase, { waitUntil: 'domcontentloaded' })
    return page
  }
  return { appBase, apiBase, browser, open, errors }
}

export const signIn = async (page, name, email) => {
  await page.locator('#signin-email').waitFor({ timeout: 20000 })
  if (await page.locator('#signin-name').count()) await page.locator('#signin-name').fill(name)
  await page.locator('#signin-email').fill(email)
  await page.locator('#signin-email').press('Enter')
  await page.locator('#start-address').waitFor({ timeout: 20000 })
}
export const signOut = async (page) => {
  if (await page.getByTestId('account').isVisible().catch(() => false)) {
    await page.getByTestId('account').locator('summary').click()
    await page.locator('.dh-account-menu').locator('button.linkish').first().click()
  } else await page.locator('.dh-signout').first().click()
  await page.locator('#signin-email').waitFor({ timeout: 20000 })
}
/** From the signed-in first screen: the address, the county parcel taken, the style, and on to the rooms step. */
export async function toRooms(page, address) {
  await page.locator('#start-address').fill(address)
  await page.locator('#start-address').locator('xpath=ancestor::*[contains(@class,"card")][1]').locator('button.btn-primary').last().click()
  await page.getByTestId('parcel-card').waitFor({ timeout: 30000 })
  await page.getByTestId('parcel-yes').click()
  await page.waitForTimeout(600)
  await page.getByTestId('lot-next').click()
  await page.getByTestId('style-farmhouse').click()
  await page.locator('.actions button.btn-primary').last().click()
  await page.getByTestId('lot-strip').waitFor({ timeout: 20000 })
}
/** Records, from now on, whether the size bar on the rooms step ever turned red or "Does not fit" was ever said. */
export const watchRooms = (page) =>
  page.evaluate(() => {
    window.__red = []
    const look = () => {
      const fill = document.querySelector('.meter-fill.over')
      if (fill) window.__red.push('red bar')
      const bad = document.querySelector('.stats .fine.bad')
      if (bad && bad.textContent.trim()) window.__red.push('said: ' + bad.textContent.trim().slice(0, 80))
    }
    look()
    new MutationObserver(look).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true })
  })
/** Waits until the rooms step has its answer (the Draft button can be pressed, or a card says why not). */
export async function roomsSettled(page) {
  const draft = page.getByTestId('draft-my-house').or(page.locator('.actions button').last())
  for (let i = 0; i < 480; i++) {
    const checking = await page.locator('.fit-note').count()
    if (!checking && ((await draft.first().isEnabled()) || (await page.getByTestId('tight-lot').count()) || (await page.getByTestId('custom-lot').count()))) break
    await page.waitForTimeout(250)
  }
  await page.waitForTimeout(400)
}
/** Every word a homeowner can read on the page right now, with attributes they can hear or hover. */
export const pageWords = (page) =>
  page.evaluate(() => {
    const out = []
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement
      if (!el || el.closest('script, style')) continue
      const r = el.getBoundingClientRect()
      if (!(r.width > 0 && r.height > 0)) continue
      const text = n.textContent.replace(/\s+/g, ' ').trim()
      if (text) out.push(text)
    }
    for (const el of document.querySelectorAll('[title], [placeholder], [aria-label], [alt]')) for (const a of ['title', 'placeholder', 'aria-label', 'alt']) if (el.getAttribute(a)) out.push(el.getAttribute(a))
    return out.join('\n')
  })
