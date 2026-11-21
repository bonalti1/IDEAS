// Round 12, item I: the style step and the first look at the 3D view, as a homeowner in the built app.
//   1  one style can be drafted today: the step says "More styles soon" once (it was nine greyed-out "coming soon" cards)
//   2  room names in the 3D view show with the roof off only, never more than 8 (the largest rooms)
//   3  the words drawn on the ground are small beside the house in the 3D view (source check: they are canvas text)
//   4  the first paint is not blank: a sketch of the plan stands in the viewport until the canvas has drawn
// Pictures go to $SHOTS (r12-style-1440, r12-3d-first-paint-1440, r12-3d-roof-on-1440, r12-3d-roof-off-1440,
// r12-3d-roof-on-390).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromePath, startPreview, appContext, freePort, spawnGroup, shotDir } from './browser.mjs'
import { STYLES } from '../src/draft/lib/styles.js'

const CHROME = chromePath()
const skipBrowser = !CHROME && 'no Chrome found (set CHROME=/path/to/chrome)'
const SHOTS = shotDir('r12-3d')
// the words no homeowner screen carries (the same list test/no-money.test.mjs reads the screens with)
const MONEY = /\$|Estimate|Price range|\b(buy|pay|credit|credits|checkout)\b/i

/** The office API on the fixtures, on a free port (spawnGroup adds the fixture switch and stops it with the test). */
async function startServer(t, app) {
  const port = await freePort()
  const base = `http://127.0.0.1:${port}`
  const { log } = spawnGroup(t, process.execPath, ['server/index.mjs'], { env: { DRAFTHOUSE_CLAUDE_KEY: '', ANTHROPIC_API_KEY: '', DATABASE_URL: '', SUPABASE_URL: '', RESEND_API_KEY: '', BILLING_ENABLED: '', DRAFTHOUSE_APP_KEY: '', DRAFTHOUSE_WORKER_KEY: 'test-worker-key', DRAFTHOUSE_DRAFTERS: 'maria@drafthouse.test', DRAFTHOUSE_ADMINS: 'rolando@drafthouse.test', PORT: String(port), DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dh-r12-3d-')), DRAFTHOUSE_APP_ORIGIN: app } })
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

/** Sign in and walk Lot → Style; returns on the Style step. */
async function toStyle(page, app, tag) {
  await page.goto(app, { waitUntil: 'domcontentloaded' })
  await page.locator('#signin-name').fill('Test Homeowner')
  await page.locator('#signin-email').fill(`r12-${tag}-${Date.now().toString(36)}@example.com`)
  await page.getByRole('button', { name: /Continue|Email me/ }).click()
  await page.locator('#start-address').waitFor({ timeout: 20000 })
  await page.locator('#start-address').fill('1300 W Nolana Ave, McAllen, TX 78504')
  await page.getByRole('button', { name: 'Find my lot' }).click()
  await page.locator('#lot-city').waitFor({ timeout: 20000 })
  await page.locator('#lot-city').selectOption('mcallen')
  await page.waitForTimeout(1500)
  const confirm = page.locator('#lot-confirm')
  if (await confirm.count()) await confirm.check()
  await page.getByRole('button', { name: /pick a style/ }).click()
  await page.getByRole('heading', { name: 'Pick a style' }).waitFor({ timeout: 20000 })
  await page.waitForTimeout(400)
}

/** Style → Rooms; returns with the "Draft my house" button on the screen. */
async function toRooms(page) {
  await page.getByRole('button', { name: /Modern Farmhouse/ }).click()
  await page.getByRole('button', { name: /Next, rooms/ }).click()
  await page.getByRole('button', { name: /Draft my house/ }).waitFor({ timeout: 20000 })
  await page.waitForTimeout(1500)
}

/**
 * Watches the Draft step's viewport from inside the page: when the loading picture first stands in it, whether the
 * canvas has drawn anything by then, and whether it has when the picture goes. A WebGL canvas that has never drawn
 * reads back fully transparent (the scene keeps its drawing buffer, so one that has drawn does not).
 */
function watchFirstPaint() {
  const blank = (canvas) => {
    if (!canvas || !canvas.width || !canvas.height) return true
    const c = document.createElement('canvas')
    c.width = 16
    c.height = 16
    const g = c.getContext('2d')
    try {
      g.drawImage(canvas, 0, 0, 16, 16)
    } catch {
      return true
    }
    const px = g.getImageData(0, 0, 16, 16).data
    for (let i = 3; i < px.length; i += 4) if (px[i] !== 0) return false
    return true
  }
  const state = (window.__r12 = { seen: false, blankWhenSeen: null, gone: false, drawnWhenGone: null })
  const look = () => {
    const el = document.querySelector('.viewport-stage [data-testid="scene-loading"]')
    const canvas = document.querySelector('.viewport-stage canvas')
    if (el && !state.seen) {
      state.seen = true
      state.blankWhenSeen = blank(canvas)
    }
    if (!el && state.seen && !state.gone) {
      state.gone = true
      state.drawnWhenGone = !blank(canvas)
    }
  }
  new MutationObserver(look).observe(document.body, { childList: true, subtree: true })
  look()
}

test('I: the style step says "More styles soon" once; the 3D view opens on a sketch of the plan, shows no room names with the roof on and at most 8 with it off (1440 px)', { skip: skipBrowser, timeout: 400000 }, async (t) => {
  const { chromium } = await import('playwright-core')
  const app = await startPreview(t)
  const api = await startServer(t, app)
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })
  t.after(() => browser.close())
  const ctx = await appContext(browser, api, { viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))

  // ── 1: the style step ──────────────────────────────────────────────────────────────────────────────
  await toStyle(page, app, 'desktop')
  const styleText = await page.evaluate(() => document.body.innerText)
  assert.equal((styleText.match(/more styles soon/gi) || []).length, 1, 'said once')
  assert.equal((styleText.match(/coming soon/gi) || []).length, 0, 'not on every card')
  assert.doesNotMatch(styleText, MONEY)
  const ready = STYLES.filter((s) => s.ready)
  const soon = STYLES.filter((s) => !s.ready)
  // the styles that can be drafted are the only buttons to pick; the others are named under the one line, each with a drawn mark
  assert.equal(await page.locator('.style-card').count(), ready.length)
  assert.equal(await page.locator('.style-card:disabled').count(), 0)
  assert.equal(await page.locator('[data-testid="styles-soon"] li').count(), soon.length)
  assert.equal(await page.locator('[data-testid="styles-soon"] li svg').count(), soon.length, 'a drawn mark each')
  assert.equal(await page.locator('[data-testid="styles-soon"] img').count(), 0, 'no photographs of styles that are not built')
  for (const s of soon) assert.ok(styleText.toLowerCase().includes(s.name.toLowerCase()), s.name)
  await page.screenshot({ path: path.join(SHOTS, 'r12-style-1440.png') })

  // ── 4: the first paint of the 3D view ──────────────────────────────────────────────────────────────
  await toRooms(page)
  await page.evaluate(watchFirstPaint)
  // the moment between the step mounting and the first frame is a few hundredths of a second on a fast machine and
  // seconds on a slow phone. To look at it for as long as the checks and the picture take, the page's animation
  // frames are held: the canvas cannot draw until they are let go (the page itself still lays out and paints)
  await page.evaluate(() => {
    const real = window.requestAnimationFrame.bind(window)
    const held = []
    window.__frames = {
      held,
      release() {
        window.requestAnimationFrame = real
        held.splice(0).forEach((cb) => real(cb))
      },
    }
    window.requestAnimationFrame = (cb) => -held.push(cb)
  })
  await page.getByRole('button', { name: /Draft my house/ }).click()
  const loading = page.locator('.viewport-stage [data-testid="scene-loading"]')
  await loading.waitFor({ state: 'visible', timeout: 30000 })
  await page.locator('.viewport-stage canvas').waitFor({ state: 'attached', timeout: 30000 })
  await page.waitForTimeout(600)
  const first = await page.evaluate(() => {
    const el = document.querySelector('.viewport-stage [data-testid="scene-loading"]')
    const stage = document.querySelector('.viewport-stage')
    if (!el || !stage) return null
    const a = el.getBoundingClientRect()
    const b = stage.getBoundingClientRect()
    return { covers: (a.width * a.height) / (b.width * b.height), rooms: el.querySelectorAll('svg rect').length, text: el.innerText, opaque: getComputedStyle(el).backgroundColor }
  })
  await page.screenshot({ path: path.join(SHOTS, 'r12-3d-first-paint-1440.png') })
  const afterShot = await page.evaluate(() => ({ ...window.__r12, heldFrames: window.__frames.held.length }))
  assert.ok(first, 'the loading picture is in the viewport as the Draft step mounts')
  assert.ok(first.covers > 0.98, `it covers the viewport (${first.covers})`)
  assert.ok(first.rooms >= 10, `a sketch of the plan: ${first.rooms} rooms drawn`)
  assert.match(first.text, /Drawing your house/i)
  assert.doesNotMatch(first.opaque, /rgba\(.*, 0\)|transparent/, 'not see-through: the blank canvas is behind it')
  assert.equal(afterShot.seen, true)
  assert.equal(afterShot.blankWhenSeen, true, 'it stood there before the canvas had drawn anything')
  assert.equal(afterShot.gone, false, 'and stands there for as long as the canvas has not drawn')
  assert.ok(afterShot.heldFrames >= 1, 'the scene is waiting for its first frame')
  // the frames let go: the canvas draws, and only then does the picture go
  await page.evaluate(() => window.__frames.release())
  await loading.waitFor({ state: 'detached', timeout: 90000 })
  const done = await page.evaluate(() => ({ ...window.__r12 }))
  assert.equal(done.gone, true)
  assert.equal(done.drawnWhenGone, true, 'the canvas had drawn when the picture went')
  await page.getByText(/changes? left/).first().waitFor({ timeout: 40000 })
  await page.waitForTimeout(2000)

  // ── 2: room names ──────────────────────────────────────────────────────────────────────────────────
  const tags = page.locator('[data-testid="room-tag"]')
  assert.equal(await page.getByLabel('Roof').isChecked(), true, 'the 3D view opens with the roof on')
  assert.equal(await tags.count(), 0, 'no room names on the roofs')
  assert.equal(await page.locator('[data-testid="scene-loading"]').count(), 0)
  assert.doesNotMatch(await page.evaluate(() => document.body.innerText), MONEY)
  await page.screenshot({ path: path.join(SHOTS, 'r12-3d-roof-on-1440.png') })
  await page.getByLabel('Roof').uncheck()
  await tags.first().waitFor({ timeout: 20000 })
  await page.waitForTimeout(1500)
  const names = await tags.allInnerTexts()
  assert.ok(names.length >= 1 && names.length <= 8, `${names.length} room names with the roof off: ${names.join(', ')}`)
  assert.equal(new Set(names).size, names.length, 'each once')
  // the largest rooms: the living room and the garage are among them, a closet is not
  assert.ok(names.some((n) => /living/i.test(n)), names.join(', '))
  assert.ok(names.some((n) => /garage/i.test(n)), names.join(', '))
  assert.ok(!names.some((n) => /closet|linen|pantry/i.test(n)), names.join(', '))
  await page.screenshot({ path: path.join(SHOTS, 'r12-3d-roof-off-1440.png') })
  // the roof back on: the names go again
  await page.getByLabel('Roof').check()
  await page.waitForTimeout(800)
  assert.equal(await tags.count(), 0)
  assert.deepEqual(errors, [], 'page errors')
  await ctx.close()
})

test('I: the Draft step at 390 px opens on the same sketch and carries no room names on the roofs', { skip: skipBrowser, timeout: 400000 }, async (t) => {
  const { chromium } = await import('playwright-core')
  const app = await startPreview(t)
  const api = await startServer(t, app)
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })
  t.after(() => browser.close())
  const ctx = await appContext(browser, api, { viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await toStyle(page, app, 'phone')
  const styleText = await page.evaluate(() => document.body.innerText)
  assert.equal((styleText.match(/more styles soon/gi) || []).length, 1)
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'the style step does not scroll sideways')
  await toRooms(page)
  await page.evaluate(watchFirstPaint)
  await page.getByRole('button', { name: /Draft my house/ }).click()
  await page.getByText(/changes? left/).first().waitFor({ timeout: 40000 })
  await page.waitForFunction(() => window.__r12.gone, null, { timeout: 90000 })
  const seen = await page.evaluate(() => ({ ...window.__r12 }))
  assert.equal(seen.blankWhenSeen, true, 'the sketch stood in the viewport before the canvas had drawn')
  assert.equal(seen.drawnWhenGone, true)
  await page.waitForTimeout(2000)
  assert.equal(await page.locator('[data-testid="room-tag"]').count(), 0)
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'the Draft step does not scroll sideways')
  assert.doesNotMatch(await page.evaluate(() => document.body.innerText), MONEY)
  await page.screenshot({ path: path.join(SHOTS, 'r12-3d-roof-on-390.png') })
  assert.deepEqual(errors, [], 'page errors')
  await ctx.close()
})

test('I: the words on the ground are sized by the scene, and small beside a house in the 3D view (source check)', () => {
  const scene = fs.readFileSync('src/draft/HouseScene.jsx', 'utf8')
  const site = fs.readFileSync('src/components/SitePlan.jsx', 'utf8')
  // the 3D view with a house passes a scale under a half; the Lot step's top view of the lot keeps full size
  // (round 15: the scale moved to camera.js's groundTextScale, which also draws it half as big again on a phone)
  assert.match(scene, /const groundText = groundTextScale\(\{ house: showHouse && roomList\.length > 0, view, phone \}\)/)
  const m = fs.readFileSync('src/draft/lib/camera.js', 'utf8').match(/if \(house && view !== 'top'\) return ([\d.]+)/)
  assert.ok(m, 'the scene sets the ground text scale')
  assert.ok(+m[1] > 0.2 && +m[1] <= 0.5, `the scale is ${m[1]}`)
  assert.match(scene, /<SitePlan lot=\{L\} problem=\{lotProblem\} northArrow=\{view !== 'top'\} textScale=\{groundText\} \/>/)
  // every line of lot text takes it: the address and area, the pending line, the problem line, the setbacks, the street
  assert.match(site, /size=\{3\.6 \* ts\} color="#5a6069">/)
  assert.match(site, /size=\{3 \* ts\} color="#5a6069">\s*LOT PENDING DRAFTER CONFIRMATION/)
  assert.match(site, /size=\{3\.6 \* ts\} color=\{COLORS\.property\} bold>/)
  assert.match(site, /size=\{4 \* textScale\}\s*color=\{COLORS\.setback\}/)
  assert.match(site, /size=\{8 \* textScale\}\s*color="#4c525a"/)
  assert.match(site, /export default function SitePlan\(\{ lot = DEFAULT_LOT, problem = '', northArrow = true, textScale = 1 \}\)/, 'full size unless a scene asks')
  // the room names: with the roof off only, the largest eight, each findable by the tests
  assert.match(scene, /export const MAX_TAGS = 8/)
  assert.match(scene, /showHouse && tags && view !== 'top' && !showRoof && <RoomTags rooms=\{tagged\}/)
  assert.match(scene, /data-testid="room-tag"/)
  // the north mark on the top view is as it was (round 11)
  assert.match(scene, /className="compass" data-testid="north"/)
  // new styles are in scene.css; it adds no money words either
  const css = fs.readFileSync('src/draft/scene.css', 'utf8')
  assert.match(css, /\.scene-loading \{ position: absolute; inset: 0;/)
  assert.match(scene, /import '\.\/scene\.css'/)
})
