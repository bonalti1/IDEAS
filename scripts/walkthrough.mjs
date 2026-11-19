// The real-browser customer walkthrough (round 12's acceptance rule). It starts the built client and the office API on
// this machine with LIVE county, FEMA and zoning lookups, billing off and no email, then uses a desktop browser like a
// customer would: a homeowner at 1440 px and at 390 px from sign-in to Send on five lots, signing out and back in
// mid-way, and a drafter confirming the lots and reading the review card.
//
//   node scripts/walkthrough.mjs basic     the chat's own rules (no Claude key)
//   node scripts/walkthrough.mjs claude    the real Claude interpreter (DRAFTHOUSE_CLAUDE_KEY from the environment)
//   NODE_USE_ENV_PROXY=1 in front on a machine behind a proxy; OUT=dir for the pictures (default docs/walkthrough)
//
// It writes one picture per step and walkthrough-<mode>.json with what each screen said, every chat reply, every
// page error and how long each step took. It asserts nothing: a person (or the round's report) reads the result and
// rates it. Owner names are never read or written: the drafter's card is opened, the owner lookup is not pressed.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawn, spawnSync } from 'node:child_process'

const mode = process.argv[2] === 'claude' ? 'claude' : 'basic'
const OUT = process.env.OUT || 'docs/walkthrough'
const ONLY = (process.argv[3] || '').split(',').filter(Boolean)
fs.mkdirSync(OUT, { recursive: true })
const key = (process.env.DRAFTHOUSE_CLAUDE_KEY || process.env.ANTHROPIC_API_KEY || '').trim()
if (mode === 'claude' && !key) {
  console.error('walkthrough: no DRAFTHOUSE_CLAUDE_KEY in the environment; the claude run needs one')
  process.exit(2)
}
const freePort = () => new Promise((ok, no) => { const s = net.createServer(); s.unref(); s.on('error', no); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)) }) })
const procs = []
const start = (cmd, args, env) => { const p = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true }); let out = ''; p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d)); procs.push(p); return { p, log: () => out } }
const stopAll = () => procs.forEach((p) => { try { process.kill(-p.pid, 'SIGTERM') } catch {} })
process.on('exit', stopAll)
const up = async (url) => { for (let i = 0; i < 200; i++) { try { const r = await fetch(url); if (r.status < 500) return } catch {} await new Promise((r) => setTimeout(r, 100)) } throw new Error(url + ' did not come up') }

if (!fs.existsSync('dist/index.html')) { const b = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], { encoding: 'utf8' }); if (b.status !== 0) throw new Error('vite build failed') }
const appPort = await freePort()
const apiPort = await freePort()
const app = `http://127.0.0.1:${appPort}`
const apiBase = `http://127.0.0.1:${apiPort}`
start(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(appPort), '--strictPort', '--host', '127.0.0.1'], {})
// live lookups (no fixtures), billing off, no email, its own data folder; the Claude key only in the claude run
const api = start(process.execPath, ['server/index.mjs'], { PORT: String(apiPort), DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), `dh-walk-${mode}-`)), DRAFTHOUSE_FIXTURES: '', DRAFTHOUSE_CLAUDE_KEY: mode === 'claude' ? key : '', ANTHROPIC_API_KEY: '', DATABASE_URL: '', SUPABASE_URL: '', RESEND_API_KEY: '', BILLING_ENABLED: '', DRAFTHOUSE_APP_KEY: '', DRAFTHOUSE_WORKER_KEY: 'walk', DRAFTHOUSE_DRAFTERS: 'drafter@walk.test', REGRID_API_TOKEN: '', PARCEL_DAILY_CHECK: '0', ALLOWED_ORIGINS: '*', NODE_USE_ENV_PROXY: process.env.NODE_USE_ENV_PROXY || '' })
await up(app)
await up(apiBase + '/api/health')

const { chromium } = await import('playwright-core')
const CHROME = [process.env.CHROME, '/opt/pw-browsers/chromium'].find((p) => p && fs.existsSync(p))
const browser = await chromium.launch(CHROME && fs.statSync(CHROME).isFile() ? { executablePath: CHROME, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] })

const LOTS = [
  { id: 'normal', address: '1201 Kerria Ave, McAllen, TX 78501', what: 'a normal lot' },
  { id: 'curved', address: '2002 Kiskadee Ln, Mission, TX 78572', what: 'the curved pie lot' },
  { id: 'near', address: '323 N 11th St, Raymondville, TX 78580', what: 'the near match' },
  { id: 'c2', address: '118 S Cage Blvd, Pharr, TX 78577', what: 'the C-2 lot' },
  { id: 'we', address: '1300 W Nolana Ave, McAllen, TX 78504', what: 'the W/E mismatch' },
].filter((l) => !ONLY.length || ONLY.includes(l.id))
const SIZES = [
  { name: '1440', viewport: { width: 1440, height: 900 } },
  { name: '390', viewport: { width: 390, height: 844 } },
]
const CHAT = ['I want 4 bedrooms', 'Add a covered patio in the back', 'Make the kitchen bigger', 'Make it feel more open']
const report = { mode, at: new Date().toISOString(), runs: [], drafter: [] }
const BAD = /setback|\bNaN\b|\bundefined\b|\$\s?\d|could not send/i

async function homeowner(lot, size, signOutMidway) {
  const run = { lot: lot.id, what: lot.what, size: size.name, steps: [], chat: [], errors: [], badWords: [], reached: 'start' }
  report.runs.push(run)
  const ctx = await browser.newContext({ viewport: size.viewport, deviceScaleFactor: 2 })
  await ctx.addInitScript((a) => { try { localStorage.setItem('drafthouse.api', a) } catch {} }, apiBase)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => run.errors.push(String(e.message).slice(0, 200)))
  const email = `walk-${mode}-${lot.id}-${size.name}@example.com`
  const name = 'Walk Tester'
  const step = async (label, t0) => {
    await page.waitForTimeout(700)
    const text = await page.evaluate(() => document.body.innerText).catch(() => '')
    const bad = text.match(BAD)
    if (bad) run.badWords.push(`${label}: "${bad[0]}"`)
    const file = `walk-${mode}-${size.name}-${lot.id}-${label}.png`
    await page.screenshot({ path: path.join(OUT, file) }).catch(() => {})
    run.steps.push({ label, ms: t0 ? Date.now() - t0 : null, file, says: text.replace(/\s+/g, ' ').slice(0, 900) })
    run.reached = label
    return text
  }
  const signIn = async () => {
    await page.locator('#signin-email').waitFor({ timeout: 30000 })
    if (await page.locator('#signin-name').count()) await page.locator('#signin-name').fill(name)
    await page.locator('#signin-email').fill(email)
    await page.getByRole('button', { name: /Continue|Email me/ }).click()
    await page.locator('#start-address').waitFor({ timeout: 30000 })
  }
  const signOut = async () => {
    if (size.name === '390') {
      await page.getByTestId('account').locator('summary').click()
      await page.locator('.dh-account-menu').getByRole('button', { name: 'Sign out' }).click()
    } else await page.getByRole('button', { name: 'Sign out' }).first().click()
  }
  try {
    let t = Date.now()
    await page.goto(app, { waitUntil: 'domcontentloaded' })
    await signIn()
    await step('01-start', t)
    t = Date.now()
    await page.locator('#start-address').fill(lot.address)
    await page.getByRole('button', { name: 'Find my lot' }).click()
    await page.locator('#lot-city').waitFor({ timeout: 60000 })
    // the lot step: the address question (W typed, E matched), or the parcel
    await Promise.race([page.getByTestId('parcel-card').waitFor({ timeout: 60000 }), page.getByTestId('address-check').waitFor({ timeout: 60000 }), page.getByTestId('parcel-error').waitFor({ timeout: 60000 })]).catch(() => {})
    await page.waitForTimeout(2500)
    await step('02-lot-found', t)
    if (await page.getByTestId('address-no').count()) {
      await page.getByTestId('address-no').click()
      await page.waitForTimeout(1500)
      const confirm = page.locator('#lot-confirm')
      if (await confirm.count()) await confirm.check()
    } else if (await page.getByTestId('parcel-yes').count()) {
      await page.getByTestId('parcel-yes').click()
      await page.waitForTimeout(2500)
    } else {
      const confirm = page.locator('#lot-confirm')
      if (await confirm.count()) await confirm.check()
    }
    await step('03-lot-taken', null)
    t = Date.now()
    await page.getByTestId('lot-next').click()
    await page.getByRole('button', { name: /Modern Farmhouse/ }).waitFor({ timeout: 30000 })
    await step('04-style', t)
    await page.getByRole('button', { name: /Modern Farmhouse/ }).click()
    t = Date.now()
    await page.getByRole('button', { name: /Next, rooms/ }).click()
    await page.getByRole('button', { name: 'More Bedrooms' }).waitFor({ timeout: 30000 })
    await page.waitForFunction(() => !/Checking the lot…/.test(document.body.innerText), null, { timeout: 120000 }).catch(() => {})
    await step('05-rooms', t)
    if (signOutMidway) {
      t = Date.now()
      await signOut()
      await signIn()
      await step('06-signed-back-in-your-houses', t)
      run.houseListed = (await page.locator('.houses .house').count()) > 0
      if (run.houseListed) {
        t = Date.now()
        await page.locator('.houses .house').first().click()
        await page.getByRole('button', { name: 'More Bedrooms' }).waitFor({ timeout: 30000 }).catch(() => {})
        await page.waitForFunction(() => !/Checking the lot…/.test(document.body.innerText), null, { timeout: 120000 }).catch(() => {})
        await step('07-resumed', t)
      }
    }
    // a lot none of our plans fits: the drafter is offered
    if (await page.getByTestId('send-lot').count()) {
      t = Date.now()
      await page.getByTestId('send-lot').click()
      await page.getByText(/Your lot is with our drafter/i).waitFor({ timeout: 30000 }).catch(() => {})
      await step('08-lot-sent-to-drafter', t)
      run.outcome = 'no plan fits: lot sent to the drafter'
      await ctx.close()
      return
    }
    const draft = page.getByRole('button', { name: /Draft my house/ })
    if (!(await draft.isEnabled())) {
      const offer = page.locator('button.linkish', { hasText: /try that|^use /i }).first()
      if (await offer.count()) {
        await offer.click()
        await page.waitForFunction(() => !/Checking the lot…/.test(document.body.innerText), null, { timeout: 120000 }).catch(() => {})
      }
    }
    t = Date.now()
    await draft.click()
    await page.getByLabel('Your change').waitFor({ timeout: 90000 })
    await page.waitForTimeout(3500)
    await step('08-draft-3d', t)
    await page.getByRole('button', { name: 'Plan', exact: true }).click()
    await page.waitForTimeout(1500)
    await step('09-draft-plan', null)
    await page.getByRole('button', { name: '3D', exact: true }).click()
    // the chat: the four sentences of the customer test
    for (const [i, ask] of CHAT.entries()) {
      t = Date.now()
      await page.getByLabel('Your change').fill(ask)
      await page.getByRole('button', { name: 'Change', exact: true }).click()
      // "Working on it…" shows while the office answers; the reply is there when it is gone
      await page.locator('.log .msg.thinking').waitFor({ timeout: 4000 }).catch(() => {})
      await page.locator('.log .msg.thinking').waitFor({ state: 'detached', timeout: 90000 }).catch(() => {})
      const replyMs = Date.now() - t
      await page.waitForTimeout(500)
      const last = page.locator('.log .msg.house:not(.thinking)').last()
      const reply = (await last.innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
      const buttons = await last.locator('button').allInnerTexts().catch(() => [])
      const left = await page.getByTestId('changes-left').innerText().catch(() => '')
      run.chat.push({ ask, reply, buttons, ms: replyMs, changesLeft: left.replace(/\s+/g, ' ') })
      await step(`10-chat-${i + 1}`, t)
    }
    t = Date.now()
    await page.getByRole('button', { name: /send to drafters/i }).first().click()
    await page.getByText('Ready to hand off?').waitFor({ timeout: 30000 })
    await page.waitForTimeout(1500)
    const send = await step('11-send-before-confirm', t)
    run.sendBefore = /Your plan is saved/i.test(send) ? 'calm card: lot with a drafter' : /cannot be sent yet/i.test(send) ? 'blocked: ' + (send.match(/This lot is zoned [^.]+\./)?.[0] || 'rules') : (await page.getByRole('button', { name: 'Send to drafters' }).count()) ? 'Send button shown' : 'unclear'
    run.page = page
    run.ctx = ctx
    run.email = email
  } catch (e) {
    run.failed = String(e.message || e).split('\n')[0].slice(0, 300)
    await page.screenshot({ path: path.join(OUT, `walk-${mode}-${size.name}-${lot.id}-FAILED.png`) }).catch(() => {})
    await ctx.close().catch(() => {})
  }
}

async function drafter() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
  await ctx.addInitScript((a) => { try { localStorage.setItem('drafthouse.api', a) } catch {} }, apiBase)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)))
  await page.goto(`${app}/#/review`, { waitUntil: 'domcontentloaded' })
  await page.locator('#signin-email').fill('drafter@walk.test')
  await page.getByRole('button', { name: /Continue|Email me/ }).click()
  await page.getByText('Review inbox').waitFor({ timeout: 30000 })
  await page.waitForTimeout(2500)
  await page.screenshot({ path: path.join(OUT, `walk-${mode}-drafter-inbox.png`), fullPage: true })
  const inbox = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ')
  report.drafterInbox = inbox.slice(0, 1500)
  // every lot to confirm: open it, read the card, confirm the lot
  for (let guard = 0; guard < 14; guard++) {
    const rows = page.locator('.card', { hasText: /Lots to confirm/ }).locator('.inbox-row')
    if (!(await rows.count())) break
    const label = (await rows.first().innerText()).replace(/\s+/g, ' ').slice(0, 140)
    await rows.first().click()
    const list = page.getByTestId('review-checklist')
    await list.waitFor({ timeout: 30000 })
    await page.waitForTimeout(1800)
    const box = await list.boundingBox()
    const card = (await list.innerText()).replace(/\s+/g, ' ')
    const tag = label.replace(/[^a-z0-9]+/gi, '-').slice(0, 40)
    await page.screenshot({ path: path.join(OUT, `walk-${mode}-drafter-card-${guard + 1}-${tag}.png`) })
    const t = Date.now()
    await page.getByTestId('check-confirm-lot').click()
    await page.getByText(/Confirmed by drafter@walk\.test/i).first().waitFor({ timeout: 60000 }).catch(() => {})
    await page.waitForTimeout(1200)
    const after = (await list.innerText()).replace(/\s+/g, ' ')
    await page.screenshot({ path: path.join(OUT, `walk-${mode}-drafter-card-${guard + 1}-${tag}-confirmed.png`) })
    report.drafter.push({ row: label, checklistOnFirstScreen: !!box && box.y >= 0 && box.y + box.height <= 900, card: card.slice(0, 900), afterConfirm: after.slice(0, 900), confirmMs: Date.now() - t })
    await page.getByRole('button', { name: /Inbox/ }).click()
    await page.getByText('Review inbox').waitFor({ timeout: 30000 })
    await page.waitForTimeout(1500)
  }
  report.drafterErrors = errors
  await ctx.close()
}

async function finish(run) {
  // back on the homeowner's Send page after the drafter confirmed: the button appears on its own; send it
  const page = run.page
  if (!page) return
  try {
    const t = Date.now()
    const btn = page.getByRole('button', { name: 'Send to drafters' })
    await btn.waitFor({ timeout: 50000 }).catch(() => {})
    const text = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ')
    if ((await btn.count()) && (await btn.isEnabled())) {
      await btn.click()
      await page.getByRole('button', { name: /Download your summary/ }).waitFor({ timeout: 60000 }).catch(() => {})
      await page.waitForTimeout(1500)
      run.outcome = /Download your summary/i.test(await page.evaluate(() => document.body.innerText)) ? 'sent to the drafters' : 'pressed Send; no confirmation seen'
    } else run.outcome = /zoned/i.test(text) ? 'Send blocked by the zoning: ' + (text.match(/This lot is zoned [^.]+\.[^.]*\./)?.[0] || '') : 'Send not available: ' + text.slice(0, 200)
    const file = `walk-${mode}-${run.size}-${run.lot}-12-send-after-confirm.png`
    await page.screenshot({ path: path.join(OUT, file) })
    run.steps.push({ label: '12-send-after-confirm', ms: Date.now() - t, file, says: (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 900) })
  } catch (e) {
    run.failed = (run.failed ? run.failed + ' | ' : '') + String(e.message || e).split('\n')[0].slice(0, 200)
  }
  await run.ctx.close().catch(() => {})
  delete run.page
  delete run.ctx
}

try {
  for (const size of SIZES) for (const [i, lot] of LOTS.entries()) {
    // signing out and back in mid-way: the normal lot on the desktop, the curved lot on the phone
    await homeowner(lot, size, (size.name === '1440' && lot.id === 'normal') || (size.name === '390' && lot.id === 'curved') || (LOTS.length === 1 && i === 0))
    const r = report.runs[report.runs.length - 1]
    console.log(`${mode} ${size.name} ${lot.id}: reached ${r.reached}${r.failed ? ' FAILED ' + r.failed : ''}${r.sendBefore ? ' · ' + r.sendBefore : ''}${r.outcome ? ' · ' + r.outcome : ''}`)
  }
  await drafter()
  console.log(`${mode} drafter: ${report.drafter.length} lots confirmed`)
  for (const run of report.runs) await finish(run)
} finally {
  for (const run of report.runs) { delete run.page; delete run.ctx }
  report.apiLogTail = api.log().split('\n').filter((l) => /error|alert|proxy chain|flood:|parcels:|interpret/i.test(l)).slice(-40).map((l) => l.replace(/[\w.+-]+@[\w.-]+/g, '<email>').slice(0, 220))
  fs.writeFileSync(path.join(OUT, `walkthrough-${mode}.json`), JSON.stringify(report, null, 1))
  await browser.close().catch(() => {})
  stopAll()
}
for (const r of report.runs) console.log(`${r.size} ${r.lot}: ${r.outcome || r.failed || r.reached}${r.badWords.length ? ' · words: ' + r.badWords.join('; ') : ''}${r.errors.length ? ' · page errors: ' + r.errors.length : ''}`)
process.exit(0)
