// Round 15, item U9: pictures of the house itself. The default rooms on 1201 Kerria Ave, McAllen (the recorded parcel)
// and on a typed 100 x 150 lot in McAllen, drafted the way a homeowner drafts them, at 1440 x 900: the 3D view as it
// opens (from the street) and the floor plan at 100%. It also measures the plan's room labels as they show on the
// screen (the name and the size line, in CSS pixels) and writes them to labels.json beside the pictures.
//
//   node scripts/shot-round-15-house.mjs <outDir> [prefix]
//
// It runs the built app (vite build when dist/ is missing) and the office API on the recorded fixtures from the
// current directory, so the same script takes the "before" pictures when run from an older checkout. Signs in as
// a test homeowner; no owner name is read or drawn.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawn, spawnSync } from 'node:child_process'
import { chromium } from 'playwright-core'

const OUT = process.argv[2] || 'shots/round-15-house'
const PREFIX = process.argv[3] || 'after'
fs.mkdirSync(OUT, { recursive: true })
const freePort = () => new Promise((ok, no) => { const s = net.createServer(); s.unref(); s.on('error', no); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)) }) })
const procs = []
const start = (cmd, args, env) => { const p = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true }); let out = ''; p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d)); procs.push(p); return { p, log: () => out } }
const stopAll = () => procs.forEach((p) => { try { process.kill(-p.pid, 'SIGTERM') } catch {} })
process.on('exit', stopAll)
const up = async (url) => { for (let i = 0; i < 300; i++) { try { const r = await fetch(url); if (r.status < 500) return } catch {} await new Promise((r) => setTimeout(r, 100)) } throw new Error(url + ' did not come up') }

if (!fs.existsSync('dist/index.html')) {
  const b = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], { encoding: 'utf8' })
  if (b.status !== 0) throw new Error('vite build failed: ' + (b.stderr || '').slice(-400))
}
const appPort = await freePort()
const apiPort = await freePort()
const app = `http://127.0.0.1:${appPort}`
const apiBase = `http://127.0.0.1:${apiPort}`
start(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(appPort), '--strictPort', '--host', '127.0.0.1'], {})
start(process.execPath, ['server/index.mjs'], { PORT: String(apiPort), DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dh-r15-house-')), DRAFTHOUSE_FIXTURES: '1', DRAFTHOUSE_CLAUDE_KEY: '', ANTHROPIC_API_KEY: '', DATABASE_URL: '', SUPABASE_URL: '', RESEND_API_KEY: '', BILLING_ENABLED: '', DRAFTHOUSE_APP_KEY: '', DRAFTHOUSE_WORKER_KEY: 'shots', DRAFTHOUSE_DRAFTERS: 'drafter.test@drafthouse.local', REGRID_API_TOKEN: '', PARCEL_DAILY_CHECK: '0', ALLOWED_ORIGINS: '*', DRAFTHOUSE_APP_ORIGIN: app })
await up(app)
await up(apiBase + '/api/health')

const CHROME = [process.env.CHROME, '/opt/pw-browsers/chromium'].find((p) => p && fs.existsSync(p) && fs.statSync(p).isFile())
const browser = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : {}), args: ['--no-sandbox'] })
const LOTS = [
  { id: 'kerria', address: '1201 Kerria Ave, McAllen, TX 78501' },
  { id: '100x150', address: '1300 W Nolana Ave, McAllen, TX 78504', typed: { width: '100', depth: '150' } },
]
const labels = {}
let n = 0
for (const lot of LOTS) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript((a) => { try { localStorage.setItem('drafthouse.api', a) } catch {} }, apiBase)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(app, { waitUntil: 'domcontentloaded' })
  await page.locator('#signin-email').waitFor({ timeout: 30000 })
  if (await page.locator('#signin-name').count()) await page.locator('#signin-name').fill('House Pictures')
  await page.locator('#signin-email').fill(`drafthouse.test+house${++n}-${Date.now().toString(36)}@example.com`)
  await page.getByRole('button', { name: /Continue|Email me/ }).click()
  await page.locator('#start-address').waitFor({ timeout: 30000 })
  await page.locator('#start-address').fill(lot.address)
  await page.getByRole('button', { name: /Find my lot/ }).click()
  await page.locator('#lot-city').waitFor({ timeout: 60000 })
  await Promise.race([page.getByTestId('parcel-card').waitFor({ timeout: 30000 }), page.getByTestId('address-check').waitFor({ timeout: 30000 }), page.getByTestId('parcel-error').waitFor({ timeout: 30000 })]).catch(() => {})
  await page.waitForTimeout(2000)
  if (lot.typed) {
    // the lot typed in: answer "no" to a parcel the app offers, then the width and depth
    if (await page.getByTestId('address-no').count()) await page.getByTestId('address-no').click()
    else if (await page.getByTestId('parcel-no').count()) await page.getByTestId('parcel-no').click()
    await page.waitForTimeout(800)
    await page.locator('#lot-city').selectOption('mcallen').catch(() => {})
    if (await page.locator('#lot-width').count()) {
      await page.locator('#lot-width').fill(lot.typed.width)
      await page.locator('#lot-depth').fill(lot.typed.depth)
    }
    await page.waitForTimeout(1200)
  } else if (await page.getByTestId('parcel-yes').count()) {
    await page.getByTestId('parcel-yes').click()
    await page.waitForTimeout(2000)
  }
  const confirm = page.locator('#lot-confirm')
  if ((await confirm.count()) && !(await confirm.isChecked())) await confirm.check()
  await page.getByTestId('lot-next').click()
  await page.getByTestId('style-farmhouse').waitFor({ timeout: 30000 })
  await page.getByTestId('style-farmhouse').click()
  await page.getByRole('button', { name: /Next, rooms/ }).click()
  await page.getByRole('button', { name: /Draft my house/ }).waitFor({ timeout: 30000 })
  await page.waitForFunction(() => !/Checking the lot…/.test(document.body.innerText), null, { timeout: 120000 }).catch(() => {})
  await page.waitForTimeout(1500)
  const draft = page.getByRole('button', { name: /Draft my house/ })
  if (!(await draft.isEnabled())) {
    const offer = page.locator('button.linkish', { hasText: /try that|^use /i }).first()
    if (await offer.count()) {
      await offer.click()
      await page.waitForFunction(() => !/Checking the lot…/.test(document.body.innerText), null, { timeout: 120000 }).catch(() => {})
    }
  }
  await draft.click()
  await page.getByLabel(/^Your change$/).waitFor({ timeout: 90000 })
  await page.waitForTimeout(5000)
  await page.screenshot({ path: path.join(OUT, `${PREFIX}-${lot.id}-3d-street-1440.png`) })
  await page.locator('.viewport-views button', { hasText: 'Plan' }).click()
  await page.waitForTimeout(2000)
  await page.screenshot({ path: path.join(OUT, `${PREFIX}-${lot.id}-plan-100pct-1440.png`) })
  // every room label as it shows: font size in CSS pixels = its SVG size x the drawing's scale on the screen
  labels[lot.id] = await page.evaluate(() => {
    const svg = document.querySelector('.plan-drawing svg')
    if (!svg) return null
    const k = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width
    const rows = [...svg.querySelectorAll('text.label')].map((t) => {
      // the name's lines are bold; the size line is the last tspan when it is not bold (older builds have no class on it)
      const spans = [...t.querySelectorAll('tspan')]
      const names = spans.filter((s) => s.getAttribute('font-weight') === '700')
      const sizeSpan = spans.find((s) => s.getAttribute('font-weight') !== '700')
      const px = (s) => Math.round(+(s?.getAttribute('font-size') || 0) * k * 10) / 10
      return { id: t.getAttribute('data-id'), name: names.map((s) => s.textContent).join(' ') || t.textContent, namePx: px(names[0] || spans[0]), sizePx: sizeSpan ? px(sizeSpan) : null, size: sizeSpan?.textContent || null }
    })
    return { scale: Math.round(k * 1000) / 1000, labels: rows }
  })
  labels[lot.id].errors = errors
  console.log(lot.id, 'labels', JSON.stringify(labels[lot.id].labels.map((l) => `${l.name} ${l.namePx}/${l.sizePx}`)))
  await ctx.close()
}
fs.writeFileSync(path.join(OUT, `${PREFIX}-labels.json`), JSON.stringify(labels, null, 2))
await browser.close()
stopAll()
process.exit(0)
