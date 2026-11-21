// The review's six personas (round 15), used like real customers in a real browser, on live lookups:
//   maria  desktop, English, a normal lot (Kerria); signs out and back in on the rooms step
//   rosa   desktop, Spanish, a normal lot; half baths, "más bonita", typed undo in Spanish
//   jose   the tight pie lot (Kiskadee); sends his lot to the drafter
//   mike   the phone, a normal lot in Mission
//   ana    a plat only, no address typed; types the size printed on the plat
//   then the drafter (drafter.test@drafthouse.local) confirms every lot and opens every plan.
// Each homeowner runs twice: as the review had them, and at the other width in the other language. Every screen is
// pictured; each run is checked against the review's items and scored from 10 (a blocker costs 3, an ugly 1, a
// polish 0.5). The Claude key is used when DRAFTHOUSE_CLAUDE_KEY is set (never printed).
//   NODE_USE_ENV_PROXY=1 OUT=<dir> node scripts/personas.mjs [persona,...]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawn, spawnSync } from 'node:child_process'

const OUT = process.env.OUT || 'docs/personas'
const ONLY = (process.argv[2] || '').split(',').filter(Boolean)
fs.mkdirSync(OUT, { recursive: true })
const key = (process.env.DRAFTHOUSE_CLAUDE_KEY || process.env.ANTHROPIC_API_KEY || '').trim()
const freePort = () => new Promise((ok, no) => { const s = net.createServer(); s.unref(); s.on('error', no); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)) }) })
const procs = []
const start = (cmd, args, env) => { const p = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true }); let out = ''; p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d)); procs.push(p); return { p, log: () => out } }
process.on('exit', () => procs.forEach((p) => { try { process.kill(-p.pid, 'SIGTERM') } catch {} }))
const up = async (url) => { for (let i = 0; i < 200; i++) { try { const r = await fetch(url); if (r.status < 500) return } catch {} await new Promise((r) => setTimeout(r, 100)) } throw new Error(url + ' did not come up') }
if (!fs.existsSync('dist/index.html')) { const b = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], { encoding: 'utf8' }); if (b.status !== 0) throw new Error('vite build failed') }
const [appPort, apiPort] = [await freePort(), await freePort()]
const app = `http://127.0.0.1:${appPort}`
const apiBase = `http://127.0.0.1:${apiPort}`
start(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(appPort), '--strictPort', '--host', '127.0.0.1'], {})
start(process.execPath, ['server/index.mjs'], { PORT: String(apiPort), DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dh-personas-')), DRAFTHOUSE_FIXTURES: '', DRAFTHOUSE_CLAUDE_KEY: key, ANTHROPIC_API_KEY: '', DATABASE_URL: '', SUPABASE_URL: '', RESEND_API_KEY: '', BILLING_ENABLED: '', DRAFTHOUSE_APP_KEY: '', DRAFTHOUSE_WORKER_KEY: 'walk', DRAFTHOUSE_DRAFTERS: 'drafter.test@drafthouse.local', REGRID_API_TOKEN: '', PARCEL_DAILY_CHECK: '0', PLAT_PRUNE: '0', ALLOWED_ORIGINS: '*', NODE_USE_ENV_PROXY: process.env.NODE_USE_ENV_PROXY || '' })
await up(app)
await up(apiBase + '/api/health')
const { chromium } = await import('playwright-core')
const CHROME = [process.env.CHROME, '/opt/pw-browsers/chromium'].find((p) => p && fs.existsSync(p))
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })

const W = { 1440: { width: 1440, height: 900 }, 390: { width: 390, height: 844 } }
const PERSONAS = [
  { id: 'maria', name: 'Maria', address: '1201 Kerria Ave, McAllen, TX 78501', runs: [[1440, 'en'], [390, 'es']], signOut: true, chat: { en: ['Make the kitchen bigger', 'add an office', 'undo that', 'Add a covered patio in the back'], es: ['la cocina más grande', 'agrega una oficina', 'deshaz eso', 'quiero un porche atrás'] } },
  { id: 'rosa', name: 'Rosa', address: '1201 Kerria Ave, McAllen, TX 78501', runs: [[1440, 'es'], [390, 'en']], signOut: true, chat: { es: ['dos baños y medio', 'hazla más bonita', 'deshaz eso', 'la sala 3 pies más ancha'], en: ['two and a half baths', 'make it nicer', 'undo that', 'make the living room 3 ft wider'] } },
  { id: 'jose', name: 'Jose', address: '2002 Kiskadee Ln, Mission, TX 78572', runs: [[1440, 'en'], [390, 'es']], tight: true, chat: { en: ['Send my lot to the drafter please'], es: ['mándale mi lote al dibujante'] } },
  { id: 'mike', name: 'Mike', address: '2218 Royal Palm Dr, Mission, TX 78572', runs: [[390, 'en'], [1440, 'es']], signOut: true, chat: { en: ['Add a covered patio in the back', 'can you undo that?', 'Make the kitchen bigger'], es: ['quiero un porche atrás', '¿puedes deshacer eso?', 'la cocina más grande'] } },
  { id: 'ana', name: 'Ana', plat: 'test/fixtures/garza-site-plan.png', typed: { width: '60', depth: '120', street: 'Showers Rd' }, runs: [[1440, 'en'], [390, 'es']], chat: { en: ['Make the kitchen bigger', 'undo'], es: ['la cocina más grande', 'deshacer'] } },
].filter((p) => !ONLY.length || ONLY.includes(p.id))
const BAD = /\bsetback\b|\bNaN\b|\bundefined\b|\$\s?\d|Lot 514|Villa-Rama|Claude|Census geocoder|Garza residence|Residencia Garza|sign in first/i
const ENGLISH_ON_ES = /\b(Sign out|Bedrooms|changes left|Your lot|Pick a style|Find my lot|Draft my house|Send to drafters|I did not catch|Rear Porch|Porches|Make the|Add a)\b/
const USTED = /\b(usted|toque|dígame|díganos|quiere usted|elija|escriba usted)\b/i
const NOT_UNDERSTOOD = /I did not catch|No le entendí|No te entendí|did not understand/i

const report = { at: new Date().toISOString(), key: !!key, runs: [], drafter: null }
let n = 0
async function homeowner(per, size, lang) {
  const run = { persona: per.id, size, lang, steps: [], chat: [], issues: [], errors: [] }
  report.runs.push(run)
  const issue = (sev, item, what) => run.issues.push({ sev, item, what })
  const ctx = await browser.newContext({ viewport: W[size], deviceScaleFactor: 1, locale: lang === 'es' ? 'es-MX' : 'en-US' })
  await ctx.addInitScript((a) => { try { localStorage.setItem('drafthouse.api', a) } catch {} }, apiBase)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => run.errors.push(String(e.message).slice(0, 200)))
  const email = `drafthouse.test+customer${++n}@example.com`
  const tag = `${per.id}-${size}-${lang}`
  const text = () => page.evaluate(() => document.body.innerText).catch(() => '')
  const step = async (label) => {
    await page.waitForTimeout(600)
    const t = await text()
    const bad = t.match(BAD)
    if (bad) issue('ugly', 'words', `${label}: "${bad[0]}" on screen`)
    if (lang === 'es') {
      const e = t.match(ENGLISH_ON_ES)
      if (e) issue('ugly', 'U15', `${label}: English on a Spanish screen: "${e[0]}"`)
      const u = t.match(USTED)
      if (u) issue('polish', 'U15', `${label}: usted on a Spanish screen: "${u[0]}"`)
    }
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1).catch(() => false)
    if (sideways) issue('ugly', 'phone', `${label}: the page scrolls sideways`)
    const file = `${tag}-${String(run.steps.length + 1).padStart(2, '0')}-${label}.png`
    await page.screenshot({ path: path.join(OUT, file) }).catch(() => {})
    run.steps.push({ label, file, says: t.replace(/\s+/g, ' ').slice(0, 700) })
    return t
  }
  const inFirstScreen = async (loc) => { const b = await loc.boundingBox().catch(() => null); return !!b && b.y >= 0 && b.y + b.height <= W[size].height }
  const signIn = async () => {
    const em = page.locator('#signin-email')
    if (!(await inFirstScreen(em))) issue('ugly', 'U13', 'sign-in is below the first screen')
    await em.scrollIntoViewIfNeeded()
    if (await page.locator('#signin-name').count()) await page.locator('#signin-name').fill(per.name + ' Tester')
    await em.fill(email)
    await page.getByRole('button', { name: /Continue|Email me|Continuar|Enviarme/ }).click()
    await page.locator('#start-address').waitFor({ timeout: 30000 })
  }
  const signOut = async () => {
    if (await page.getByTestId('account').isVisible().catch(() => false)) {
      await page.getByTestId('account').locator('summary').click()
      await page.locator('.dh-account-menu').getByRole('button', { name: /Sign out|Salir/ }).click()
    } else await page.getByRole('button', { name: /Sign out|Salir/ }).first().click()
    await page.locator('#signin-email').waitFor({ timeout: 30000 })
  }
  const waitRooms = async () => {
    await page.getByTestId('lot-strip').waitFor({ timeout: 60000 }).catch(() => {})
    await page.waitForFunction(() => !/Checking the lot…|Revisando el lote…/.test(document.body.innerText), null, { timeout: 120000 }).catch(() => {})
  }
  try {
    await page.goto(app, { waitUntil: 'domcontentloaded' })
    await page.locator('#signin-email').waitFor({ timeout: 30000 })
    await step('first-screen')
    await signIn()
    // the lot
    if (per.plat) await page.locator('.start .drop input[type=file]').setInputFiles(per.plat)
    else await page.locator('#start-address').fill(per.address)
    await page.getByRole('button', { name: /Find my lot|Buscar mi lote/ }).click()
    await page.locator('#lot-city').waitFor({ timeout: 60000 })
    if (per.plat) {
      await page.waitForFunction(() => !/Reading (the|your) plat…|Leyendo (el|tu) plat…/.test(document.body.innerText), null, { timeout: 150000 }).catch(() => {})
      await page.waitForTimeout(1500)
      if (/Lot 514|15,000 sf/.test(await text())) issue('blocker', 'plat', 'another lot shown on the plat-only lot step')
      await step('lot-plat')
      if (await page.getByTestId('plat-saved').count()) {
        await page.locator('#lot-width').fill(per.typed.width)
        await page.locator('#lot-depth').fill(per.typed.depth)
        await page.locator('#lot-street').fill(per.typed.street)
        // a city must be picked when none is known (U18)
        const city = page.locator('#lot-city')
        if (!(await city.inputValue())) await city.selectOption({ index: 1 })
        await page.waitForTimeout(2000)
      }
    } else {
      await Promise.race([page.getByTestId('parcel-card').waitFor({ timeout: 60000 }), page.getByTestId('address-check').waitFor({ timeout: 60000 }), page.getByTestId('parcel-error').waitFor({ timeout: 60000 })]).catch(() => {})
      await page.waitForTimeout(2500)
      const t = await step('lot-found')
      if (await page.getByTestId('parcel-card').count()) {
        if (/15,000 sf|±15,000/.test(t) && !/15,0\d\d sf \(/.test(t)) issue('ugly', 'U8', 'a placeholder 15,000 sf lot is drawn beside the parcel card')
        if (await page.getByTestId('address-yes').count()) await page.getByTestId('address-yes').click()
        await page.getByTestId('parcel-yes').click({ timeout: 30000 }).catch(() => {})
        await page.waitForTimeout(2500)
      } else if (await page.getByTestId('address-yes').count()) {
        await page.getByTestId('address-yes').click()
        await page.getByTestId('parcel-yes').click({ timeout: 60000 }).catch(() => {})
        await page.waitForTimeout(2500)
      }
    }
    await step('lot-taken')
    await page.getByTestId('lot-next').click()
    await page.getByTestId('style-farmhouse').waitFor({ timeout: 30000 })
    await step('style')
    await page.getByTestId('style-farmhouse').click()
    await page.getByRole('button', { name: /Next, rooms|Siguiente: cuartos/ }).click()
    await waitRooms()
    const rooms = await step('rooms')
    const tightCard = page.getByTestId('tight-lot')
    if (per.tight) {
      const btn = page.getByTestId('send-lot-tight')
      if (!(await btn.count())) issue('blocker', 'U1', 'no "Send my lot to the drafter" button on the tight lot')
      else if (!(await inFirstScreen(btn))) issue('ugly', 'U1', 'the "Send my lot to the drafter" button is below the first screen')
      if (/Recent build|Casa reciente|Garza residence/i.test(rooms)) issue('ugly', 'U5', 'a recent build is offered that cannot fit this lot')
    } else {
      if (await tightCard.count()) issue('ugly', 'U16', 'the tight-lot card shows on a lot that fits')
      if (await page.locator('.fitbar.bad, .fit.bad, [data-testid="fit-bad"]').count()) issue('ugly', 'U10', 'a red size bar on the first view of the rooms')
    }
    const before = await page.evaluate(() => document.querySelector('[data-testid="program-summary"]')?.innerText || '').catch(() => '')
    if (per.signOut) {
      const prog = (await text()).match(/(\d) (bed|recámara)/)?.[0] || ''
      await page.waitForTimeout(1500)
      await signOut()
      await signIn()
      await step('signed-back-in')
      if (!(await page.locator('.houses .house').count())) issue('blocker', 'houses', 'the house is not listed after signing back in')
      else {
        await page.locator('.houses .house').first().click()
        await waitRooms()
        const t = await step('resumed')
        if (prog && !t.includes(prog)) issue('ugly', 'U11', `the rooms changed on resume (was "${prog}")`)
      }
    }
    if (per.tight) {
      // Jose sends his lot to the drafter, by the button on the rooms step or by the chat
      const btn = page.getByTestId('send-lot-tight')
      if (await btn.count()) {
        await btn.click()
        await page.waitForTimeout(3000)
        const t = await step('lot-sent')
        if (!/with our drafter|con nuestro dibujante/i.test(t)) issue('ugly', 'U17', 'no confirmation on screen after sending the lot')
        const big = page.locator('button.btn-primary', { hasText: /Draft my house|Dibujar mi casa/ })
        if ((await big.count()) && (await big.isVisible())) issue('ugly', 'U17', '"Draft my house" is still the big primary button after the lot was sent')
      }
    }
    // the draft
    const draft = page.getByRole('button', { name: /Draft my house|Dibujar mi casa/ })
    if (!(await draft.isEnabled().catch(() => false))) {
      const offer = page.locator('button.linkish', { hasText: /try that|^use |probar así|^usar /i }).first()
      if (await offer.count()) { await offer.click(); await waitRooms() }
    }
    if (!(await draft.isEnabled().catch(() => false))) {
      run.outcome = per.tight ? 'lot with the drafter (no ready plan fits)' : 'could not draft'
      if (!per.tight) issue('blocker', 'draft', 'could not reach the draft')
      await ctx.close()
      return
    }
    await draft.click()
    const box = page.getByLabel(/^(Your change|Tu cambio)$/)
    await box.waitFor({ timeout: 90000 })
    await page.waitForTimeout(3500)
    const d = await step('draft')
    if (/a failed request doesn't use one\s*Only|si uno no se puede hacer, no cuenta\s*Solo/.test(d)) issue('polish', 'U14', 'the free-changes text runs together')
    const leftOf = async () => +((await page.getByTestId('changes-left').innerText().catch(() => '')).match(/\d+/)?.[0] ?? NaN)
    for (const [i, ask] of (per.chat[lang] || []).entries()) {
      const was = await leftOf()
      await box.fill(ask)
      await box.press('Enter')
      await page.locator('.log .msg.thinking').waitFor({ timeout: 4000 }).catch(() => {})
      await page.locator('.log .msg.thinking').waitFor({ state: 'detached', timeout: 90000 }).catch(() => {})
      await page.waitForTimeout(700)
      const last = page.locator('.log .msg.house:not(.thinking)').last()
      const reply = (await last.innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
      const now = await leftOf()
      run.chat.push({ ask, reply: reply.slice(0, 400), changesLeft: now })
      await step(`chat-${i + 1}`)
      if (NOT_UNDERSTOOD.test(reply)) issue('ugly', /baños y medio|half baths|bonita|nicer/.test(ask) ? 'U12/B6' : 'chat', `"${ask}" not understood`)
      if (/undo|deshacer|deshaz/i.test(ask) && !(now > was)) issue('blocker', 'undo', `"${ask}" did not give the change back (${was} → ${now})`)
      if (lang === 'es' && /\b(Back to version|There is nothing to undo|Done, the house)\b/.test(reply)) issue('ugly', 'P1', `"${ask}" answered in English`)
      if (/smaller step|paso más chico/i.test(reply) && /office|oficina/i.test(ask)) issue('ugly', 'U4', '"add an office" refused with "a smaller step"')
      if (/baños y medio|half baths/.test(ask) && /4 (full )?bath|4 baños/i.test(reply)) issue('ugly', 'U3', 'half bath read as two full baths')
      if (/send my lot|mándale mi lote/i.test(ask) && !/with our drafter|con nuestro dibujante|drafter|dibujante/i.test(reply)) issue('ugly', 'U2', 'the chat did not send the lot')
    }
    // send
    await page.getByRole('button', { name: /^(I love it, send to drafters|Me encanta, enviar a los dibujantes|Send to drafters|Enviar a los dibujantes)$/i }).first().click().catch(() => {})
    await page.getByText(/Ready to hand off\?|¿Listo para entregarlo\?/).waitFor({ timeout: 30000 }).catch(() => {})
    const s = await step('send')
    const send = page.getByRole('button', { name: /^(Send to drafters|Enviar a los dibujantes)$/ })
    if (!(await send.count())) issue('blocker', 'B4', 'no Send button on the Send step')
    else if (await send.isEnabled()) {
      await send.click()
      await page.getByRole('button', { name: /Download your summary|Descargar tu resumen/ }).waitFor({ timeout: 60000 }).catch(() => {})
      await page.waitForTimeout(1500)
      const after = await step('sent')
      run.outcome = /Download your summary|Descargar tu resumen/.test(after) ? 'sent' : 'pressed Send, no confirmation'
      if (run.outcome !== 'sent') issue('blocker', 'B4', 'Send gave no confirmation')
    } else {
      run.outcome = 'Send off: ' + s.slice(0, 120)
      if (!/zoned|zonificación/.test(s)) issue('blocker', 'B4', 'Send is there but switched off')
    }
  } catch (e) {
    run.failed = String(e.message || e).split('\n')[0].slice(0, 200)
    issue('blocker', 'run', 'the run stopped: ' + run.failed)
    await page.screenshot({ path: path.join(OUT, `${tag}-zz-stopped.png`) }).catch(() => {})
  }
  if (run.errors.length) issue('ugly', 'errors', `${run.errors.length} page errors`)
  await ctx.close().catch(() => {})
}

async function drafter() {
  const ctx = await browser.newContext({ viewport: W[1440], deviceScaleFactor: 1 })
  await ctx.addInitScript((a) => { try { localStorage.setItem('drafthouse.api', a) } catch {} }, apiBase)
  const page = await ctx.newPage()
  const d = { issues: [], rows: [], cards: [], errors: [] }
  report.drafter = d
  page.on('pageerror', (e) => d.errors.push(String(e.message).slice(0, 200)))
  await page.goto(`${app}/#/review`, { waitUntil: 'domcontentloaded' })
  await page.locator('#signin-email').fill('drafter.test@drafthouse.local')
  await page.getByRole('button', { name: /Continue|Email me/ }).click()
  await page.getByText('Review inbox').waitFor({ timeout: 30000 })
  await page.waitForTimeout(2500)
  await page.screenshot({ path: path.join(OUT, `drafter-01-inbox.png`), fullPage: true })
  const inbox = await page.evaluate(() => document.body.innerText)
  d.rows = (await page.locator('.inbox-row').allInnerTexts()).map((r) => r.replace(/\s+/g, ' ').slice(0, 200))
  if (!/Plat not read/.test(inbox)) d.issues.push({ sev: 'blocker', item: 'B5', what: 'the plat-only homeowner is not marked in the queue' })
  if (/Waiting for you \(0\)/i.test(inbox) && /DRAFTING/.test(inbox) && report.runs.some((r) => r.outcome === 'sent')) d.issues.push({ sev: 'ugly', item: 'U19', what: 'plans were sent but "Waiting for you" is 0' })
  // every row: open, confirm the lot, open the plan, approve or note
  for (let i = 0; i < 20; i++) {
    const rows = page.locator('.inbox-row')
    if (i >= (await rows.count())) break
    const label = (await rows.nth(i).innerText()).replace(/\s+/g, ' ').slice(0, 120)
    await rows.nth(i).click()
    await page.getByTestId('review-checklist').waitFor({ timeout: 30000 }).catch(() => {})
    await page.waitForTimeout(1500)
    const card = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ')
    await page.screenshot({ path: path.join(OUT, `drafter-${String(i + 2).padStart(2, '0')}-card.png`) })
    const c = { row: label, confirmed: false, approved: false }
    if (await page.getByTestId('check-confirm-lot').count()) {
      await page.getByTestId('check-confirm-lot').click().catch(() => {})
      await page.waitForTimeout(2500)
      c.confirmed = /Confirmed by drafter\.test@drafthouse\.local/i.test(await page.evaluate(() => document.body.innerText))
    }
    const hall = card.match(/(\d+)'-(\d+)" ?x ?(\d+)'-(\d+)" hall|hall[^.]{0,40}?(\d{2,3}) ft/i)
    if (hall && +(hall[3] || hall[5]) > 35) d.issues.push({ sev: 'ugly', item: 'U19', what: `a hall over 35 ft on ${label.slice(0, 40)}` })
    d.cards.push(c)
    await page.getByRole('button', { name: /Inbox/ }).click().catch(() => {})
    await page.getByText('Review inbox').waitFor({ timeout: 30000 }).catch(() => {})
    await page.waitForTimeout(1200)
  }
  await page.screenshot({ path: path.join(OUT, `drafter-99-inbox-after.png`), fullPage: true })
  if (d.errors.length) d.issues.push({ sev: 'ugly', item: 'errors', what: `${d.errors.length} page errors` })
  await ctx.close()
}

const COST = { blocker: 3, ugly: 1, polish: 0.5 }
const score = (issues) => Math.max(0, 10 - issues.reduce((s, x) => s + COST[x.sev], 0))
for (const per of PERSONAS) for (const [size, lang] of per.runs) {
  await homeowner(per, size, lang)
  const r = report.runs.at(-1)
  r.score = score(r.issues)
  console.log(`${per.id} ${size} ${lang}: ${r.outcome || r.failed || '?'} · score ${r.score} · ${r.issues.map((x) => `${x.sev}:${x.item}`).join(', ') || 'no issues'}`)
}
if (!ONLY.length || ONLY.includes('drafter')) {
  await drafter()
  report.drafter.score = score(report.drafter.issues)
  console.log(`drafter: score ${report.drafter.score} · ${report.drafter.issues.map((x) => `${x.sev}:${x.item}`).join(', ') || 'no issues'}`)
}
fs.writeFileSync(path.join(OUT, 'personas.json'), JSON.stringify(report, null, 1))
await browser.close()
process.exit(0)
