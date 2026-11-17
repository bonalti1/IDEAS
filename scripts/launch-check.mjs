// The launch check: the whole client and office loop against a running Draft House, step by step,
// with a screenshot per step and a green/red list at the end.
//
//   node scripts/launch-check.mjs <outDir>
//
// Environment (defaults suit the local production-like run; point them at the real services for production):
//   APP            the client app URL            (default http://localhost:4173, the built app on vite preview)
//   API            the office API URL            (default http://localhost:8787)
//   APP_KEY        DRAFTHOUSE_APP_KEY            (for API calls the check makes itself)
//   WORKER_KEY     DRAFTHOUSE_WORKER_KEY         (the check pretends to be the office computer unless REAL_WORKER=1)
//   CLIENT_EMAIL / DRAFTER_EMAIL                 sign-ins (local mode; with Supabase, sign in by hand first: SKIP_SIGNIN=1)
//   STRIPE_WEBHOOK_SECRET                        simulate the paid checkout with a signed webhook (unless REAL_STRIPE=1)
//   REAL_STRIPE=1  drive the real Stripe Checkout page with the test card instead of the simulated webhook
//   REAL_WORKER=1  wait for the real office computer to build the model instead of pretending
//   PLAT=1         read the lot from the Garza site plan (needs the Claude key) instead of typing it in
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

const out = process.argv[2] || 'shots/launch'
fs.mkdirSync(out, { recursive: true })
const APP = (process.env.APP || 'http://localhost:4173').replace(/\/$/, '')
const API = (process.env.API || 'http://localhost:8787').replace(/\/$/, '')
const APP_KEY = process.env.APP_KEY || ''
const WORKER_KEY = process.env.WORKER_KEY || ''
// every run signs up its own client, so leftover houses from earlier runs never get picked by mistake
const RUN = Date.now().toString(36).slice(-5)
const CLIENT = process.env.CLIENT_EMAIL || `launch-${RUN}@example.com`
const CLIENT_NAME = `Launch Client ${RUN}`
const DRAFTER = process.env.DRAFTER_EMAIL || 'drafter@drafthouse.local'
const REAL_STRIPE = process.env.REAL_STRIPE === '1'
const REAL_WORKER = process.env.REAL_WORKER === '1'
const WHSEC = process.env.STRIPE_WEBHOOK_SECRET || ''

const results = []
const t0 = Date.now()
let n = 0
const num = () => String(n).padStart(2, '0')
let page, dp, browser
const apiHeaders = (extra = {}) => ({ 'content-type': 'application/json', ...(APP_KEY ? { 'x-api-key': APP_KEY } : {}), ...extra })
const shot = async (p, name) => {
  await p.waitForTimeout(600)
  await p.screenshot({ path: path.join(out, `${num()}-${name}.png`) })
}
async function step(name, fn, { skip } = {}) {
  n++
  if (skip) {
    results.push({ name, status: 'skipped', detail: skip })
    console.log(`  –  ${name}: skipped (${skip})`)
    return null
  }
  const s = Date.now()
  try {
    const detail = await fn()
    results.push({ name, status: 'pass', detail: detail || '', ms: Date.now() - s })
    console.log(`  ✓  ${name}${detail ? ': ' + detail : ''}`)
    return detail
  } catch (e) {
    let file = ''
    try {
      const p = dp && name.toLowerCase().includes('drafter') ? dp : page
      if (p && p.url() !== 'about:blank') {
        file = path.join(out, `${num()}-${name.replace(/\W+/g, '-')}-FAILED.png`)
        await p.screenshot({ path: file })
      }
    } catch {
      /* no page to shoot */
    }
    results.push({ name, status: 'fail', detail: String(e.message || e).split('\n')[0].slice(0, 300), ms: Date.now() - s, screenshot: file })
    console.log(`  ✗  ${name}: ${String(e.message || e).split('\n')[0].slice(0, 200)}`)
    return null
  }
}

console.log(`Launch check · app ${APP} · api ${API} · ${REAL_STRIPE ? 'real Stripe' : 'simulated payment'} · ${REAL_WORKER ? 'real office computer' : 'pretend office computer'}`)
browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium' })
const client = await browser.newContext({ viewport: { width: 1440, height: 900 } })
page = await client.newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(e.message))

// ── 0. the office is up and configured ──
let health
await step('office API answers', async () => {
  const r = await fetch(API + '/api/health', { headers: apiHeaders() })
  health = await r.json()
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  if (!health.checks) throw new Error('health has no checks: the app key is wrong or missing')
  const red = health.checks.filter((c) => !c.ok && !c.id.includes(':')).map((c) => `${c.name} (${c.detail})`)
  return `v${health.version}, store ${health.store}, files ${health.files}, auth ${health.auth}${red.length ? '; red: ' + red.join(', ') : ''}`
})
await step('production settings: keys, database, CORS', async () => {
  const miss = []
  const by = (id) => health?.checks?.find((c) => c.id === id)
  if (!by('auth')?.ok) miss.push('API keys not set')
  if (health?.store !== 'postgres') miss.push(`store is ${health?.store}, not Postgres`)
  if (!/CORS (?!open)/.test(by('auth')?.detail || '')) miss.push('CORS open to any site')
  if (health?.auth !== 'supabase') miss.push('local sign-in (no Supabase)')
  if (!by('billing')?.ok) miss.push('payments not configured')
  if (!by('backup')?.detail?.includes('nightly')) miss.push('backup off')
  if (miss.length) throw new Error('not production grade: ' + miss.join('; '))
  return 'keys, Postgres, CORS, Supabase, Stripe, backups'
})

// ── 1. sign up ──
await step('client signs up', async () => {
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  if (process.env.SKIP_SIGNIN) {
    await page.locator('#start-address').waitFor({ timeout: 20000 })
    return 'already signed in'
  }
  await page.locator('#signin-name').fill(CLIENT_NAME)
  await page.locator('#signin-email').fill(CLIENT)
  await page.getByRole('button', { name: /Continue|Email me/ }).click()
  await page.locator('#start-address').waitFor({ timeout: 20000 })
  await shot(page, 'signed-in')
  return CLIENT
})

// ── 2. the lot ──
await step('enter the lot', async () => {
  await page.locator('#start-address').fill('2554 N FM 2360, Rio Grande City, TX 78582')
  await page.getByRole('button', { name: 'Find my lot' }).click()
  await page.locator('#lot-city').waitFor({ timeout: 20000 })
  await page.locator('#lot-city').selectOption('hidalgo')
  if (process.env.PLAT === '1') {
    await page.getByRole('button', { name: 'From the plat' }).click()
    await page.locator('.lot-side input[type=file]').setInputFiles('test/fixtures/garza-site-plan.png')
    await page.getByText('What we read').waitFor({ timeout: 180000 })
  } else {
    await page.locator('#lot-width').fill('150')
    await page.locator('#lot-depth').fill('260')
    await page.locator('#lot-street').fill('N FM 2360')
    const confirm = page.locator('#lot-confirm')
    if (await confirm.count()) await confirm.check()
  }
  await page.waitForTimeout(2500)
  const flood = await page.locator('.stats').getByText(/Flood zone/).locator('..').textContent().catch(() => '')
  await shot(page, 'lot')
  await page.getByRole('button', { name: /pick a style/ }).click()
  return flood?.replace(/Flood zone/, '').trim() || 'typed in'
})

// ── 3. style and rooms ──
await step('pick a style', async () => {
  await page.getByRole('button', { name: /Modern Farmhouse/ }).click()
  await shot(page, 'style')
  await page.getByRole('button', { name: /Next, rooms/ }).click()
  return 'Modern Farmhouse'
})
await step('set the rooms', async () => {
  await page.getByRole('button', { name: /Start from a recent build/ }).click()
  await shot(page, 'rooms')
  await page.getByRole('button', { name: /Draft my house/ }).click()
  await page.getByText(/changes? left/).waitFor({ timeout: 30000 })
  await page.waitForTimeout(2500)
  await shot(page, 'draft')
  return (await page.locator('.credits').textContent()).trim()
})

// ── 4. three edits and an undo ──
const ask = async (text) => {
  await page.getByPlaceholder(/Move the laundry/).fill(text)
  await page.getByRole('button', { name: 'Change', exact: true }).click()
  await page.locator('.msg.thinking').waitFor({ state: 'hidden', timeout: 60000 })
  const last = page.locator('.msg.house').last()
  return { text: (await last.textContent()).trim(), held: (await last.getAttribute('class')).includes('held') }
}
for (const [i, text] of ['make the kitchen bigger', 'add an office', 'remove the rear porch'].entries()) {
  await step(`edit ${i + 1}: ${text}`, async () => {
    const r = await ask(text)
    if (r.held) throw new Error('refused: ' + r.text)
    return r.text.slice(0, 90)
  })
}
// ── 4b. the fallback is fast: /api/interpret and one chat change answer in under a second when the office has no Claude key ──
await step('fallback timing: /api/interpret and a chat change under 1 s (no Claude key)', async () => {
  const key = await fetch(API + '/api/health').then((r) => r.json()).catch(() => ({}))
  if (key.interpreter && key.interpreter !== 'fallback' && key.interpreter !== 'none') return `skipped: the office has an interpreter (${key.interpreter}); the fallback is not what answers`
  const t0 = Date.now()
  const res = await fetch(API + '/api/interpret', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'make the kitchen bigger', rooms: [], program: {}, kit: { id: 'farmhouse', name: 'Modern Farmhouse', kinds: {}, minSize: {} } }) })
  const ms = Date.now() - t0
  await res.text()
  const t1 = Date.now()
  const r = await ask('make the office bigger')
  const chatMs = Date.now() - t1
  if (ms > 1000 || chatMs > 1000) throw new Error(`/api/interpret ${ms} ms, chat change ${chatMs} ms (target under 1,000 ms each)`)
  return `/api/interpret ${ms} ms (${res.status}), chat change ${chatMs} ms${r.held ? ' (held: ' + r.text.slice(0, 60) + ')' : ''}`
})
await step('undo one edit', async () => {
  const before = (await page.locator('.credits').textContent()).trim()
  await page.getByRole('button', { name: 'Undo last change' }).click()
  await page.getByText(/Back to version/).waitFor({ timeout: 20000 })
  await page.waitForTimeout(800)
  const after = (await page.locator('.credits').textContent()).trim()
  await page.getByRole('button', { name: 'Plan', exact: true }).click()
  await shot(page, 'draft-edited')
  if (after === before) throw new Error(`credit not returned (${before} → ${after})`)
  return `${before} → ${after}`
})

// ── 5. pay in test mode ──
let user
await step('pay for a pack', async () => {
  const login = await fetch(API + '/api/auth/dev-login', { method: 'POST', headers: apiHeaders(), body: JSON.stringify({ email: CLIENT }) })
  if (login.ok) user = (await login.json()).user
  await page.goto(APP + '/#/billing', { waitUntil: 'domcontentloaded' })
  await page.getByText('Buy changes').waitFor({ timeout: 20000 })
  await shot(page, 'billing')
  const before = +((await page.locator('.stats').getByText(/Credits on your account/).locator('..').textContent()).match(/(\d+) change/) || [])[1]
  if (REAL_STRIPE) {
    const [nav] = await Promise.all([page.waitForURL(/checkout\.stripe\.com/, { timeout: 60000 }), page.locator('.pack').first().getByRole('button', { name: 'Buy' }).click()])
    await page.locator('#cardNumber').fill('4242424242424242')
    await page.locator('#cardExpiry').fill('12 / 34')
    await page.locator('#cardCvc').fill('123')
    await page.locator('#billingName').fill(CLIENT_NAME)
    const zip = page.locator('#billingPostalCode')
    if (await zip.count()) await zip.fill('78501')
    await page.locator('button[type=submit]').first().click()
    await page.waitForURL(/billing=success/, { timeout: 120000 })
  } else {
    if (!WHSEC) throw new Error('no STRIPE_WEBHOOK_SECRET to simulate the payment (or set REAL_STRIPE=1)')
    const { default: Stripe } = await import('stripe')
    const stripe = new Stripe('sk_test_unused')
    const bill = await (await fetch(API + '/api/billing', { headers: apiHeaders({ authorization: `Bearer ${(await (await fetch(API + '/api/auth/dev-login', { method: 'POST', headers: apiHeaders(), body: JSON.stringify({ email: CLIENT }) })).json()).token}` }) })).json()
    const pack = bill.pricing.packs[1] || bill.pricing.packs[0]
    const sid = 'cs_test_launch_' + Date.now().toString(36)
    const payload = JSON.stringify({ id: 'evt_' + sid, object: 'event', type: 'checkout.session.completed', livemode: false, data: { object: { object: 'checkout.session', id: sid, mode: 'payment', payment_status: 'paid', currency: bill.pricing.currency, amount_total: pack.amount, client_reference_id: user.id, metadata: { userId: user.id, email: CLIENT, pack: pack.id, credits: String(pack.credits) } } } })
    const r = await fetch(API + '/api/billing/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': stripe.webhooks.generateTestHeaderString({ payload, secret: WHSEC }) }, body: payload })
    if (!r.ok) throw new Error(`webhook ${r.status}: ${await r.text()}`)
    await page.goto(APP + `/?billing=success&session_id=${sid}#/billing`, { waitUntil: 'domcontentloaded' })
  }
  await page.getByText('Thank you').waitFor({ timeout: 30000 })
  await page.waitForTimeout(800)
  const after = +((await page.locator('.stats').getByText(/Credits on your account/).locator('..').textContent()).match(/(\d+) change/) || [])[1]
  await shot(page, 'paid')
  if (!(after > before)) throw new Error(`credits did not go up (${before} → ${after})`)
  return `${before} → ${after} credits${REAL_STRIPE ? ' through Stripe Checkout' : ' (signed webhook)'}`
})

// ── 6. send ──
const office = await browser.newContext({ viewport: { width: 1440, height: 900 } })
dp = await office.newPage()
dp.on('pageerror', (e) => pageErrors.push('drafter: ' + e.message))
const drafterSignIn = async () => {
  await dp.goto(APP + '/#/review', { waitUntil: 'domcontentloaded' })
  if (process.env.SKIP_SIGNIN) return
  const email = dp.locator('#signin-email')
  if (await email.count()) {
    await email.fill(DRAFTER)
    await dp.getByRole('button', { name: /Continue|Email me/ }).click()
  }
}
if (process.env.PLAT === '1') {
  await step('drafter confirms the lot read from the plat', async () => {
    await page.goto(APP, { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: /Modern Farmhouse/ }).first().click()
    await page.getByText(/changes? left/).waitFor({ timeout: 30000 })
    await page.getByRole('button', { name: /send to drafters/ }).click()
    await page.getByRole('button', { name: 'Send to drafters', exact: true }).click()
    await page.getByText(/has not confirmed your lot/).waitFor({ timeout: 30000 })
    await shot(page, 'send-waits-for-lot')
    await drafterSignIn()
    const row = dp.locator('.card', { hasText: 'Lots to confirm' }).locator('.inbox-row', { hasText: CLIENT_NAME }).first()
    await row.waitFor({ timeout: 45000 })
    await row.click()
    await dp.locator('#lot-note').waitFor({ timeout: 20000 })
    await dp.waitForTimeout(2000)
    await shot(dp, 'lot-confirm')
    await dp.locator('#lot-note').fill('Launch check: calls match the site plan.')
    await dp.getByRole('button', { name: 'Confirm lot' }).click()
    await dp.getByText(/confirmed by/).waitFor({ timeout: 20000 })
    await dp.getByRole('button', { name: '← Inbox' }).click()
    return 'send was held until the drafter confirmed the lot'
  })
}
let projectId
await step('send to the drafters', async () => {
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: /Modern Farmhouse/ }).first().click()
  await page.getByText(/changes? left/).waitFor({ timeout: 30000 })
  await page.getByRole('button', { name: /send to drafters/ }).click()
  await page.getByRole('button', { name: 'Send to drafters', exact: true }).click()
  await page.getByText('With the drafting team').waitFor({ timeout: 60000 })
  await shot(page, 'sent')
  const tok = (await (await fetch(API + '/api/auth/dev-login', { method: 'POST', headers: apiHeaders(), body: JSON.stringify({ email: CLIENT }) })).json()).token
  const list = await (await fetch(API + '/api/projects', { headers: apiHeaders({ authorization: `Bearer ${tok}` }) })).json()
  projectId = list.find((p) => p.status === 'in_review')?.id
  return `project ${projectId || '?'} in review`
})

// ── 7. the drafter approves ──
await step('drafter approves', async () => {
  await drafterSignIn()
  // the inbox polls every ten seconds, so wait for the sent house to show under "Waiting for you" (not a recent one)
  const waiting = dp.locator('.card', { hasText: 'Waiting for you' }).locator('.inbox-row', { hasText: CLIENT_NAME }).first()
  await waiting.waitFor({ timeout: 45000 })
  await shot(dp, 'review-inbox')
  await waiting.click()
  await dp.locator('#review-note').waitFor({ timeout: 20000 })
  await dp.waitForTimeout(2000)
  await shot(dp, 'review-open')
  await dp.locator('#review-note').fill('Launch check: approved.')
  await dp.getByRole('button', { name: /Approve, build in Revit/ }).click()
  await dp.getByText('Revit job').waitFor({ timeout: 20000 })
  await shot(dp, 'review-approved')
  return 'approved, Revit job queued'
})

// ── 8. the office computer builds it ──
await step('Revit model ready', async () => {
  if (!REAL_WORKER) {
    // pretend to be the office computer: claim, progress, upload, complete
    const h = { 'content-type': 'application/json', ...(WORKER_KEY ? { 'x-api-key': WORKER_KEY } : {}) }
    await fetch(API + '/api/workers/heartbeat', { method: 'POST', headers: h, body: JSON.stringify({ id: 'launch-check', name: 'Office Revit (launch check)', revit: '2024', checks: [] }) })
    const c = await fetch(API + '/api/jobs/claim', { method: 'POST', headers: h, body: JSON.stringify({ worker: 'launch-check' }) })
    if (c.status !== 200) throw new Error(`claim ${c.status}: ${await c.text()}`)
    const job = await c.json()
    const design = await (await fetch(API + job.designUrl, { headers: h })).json()
    if (design.contract !== 1) throw new Error('design contract is not 1')
    await fetch(API + `/api/jobs/${job.id}/progress`, { method: 'POST', headers: h, body: JSON.stringify({ step: 'walls', message: `${design.walls.length} walls`, pct: 40 }) })
    await fetch(API + `/api/jobs/${job.id}/files/report.json`, { method: 'PUT', headers: h, body: JSON.stringify({ ok: true, counts: { walls: design.walls.length, doors: design.doors.length }, warnings: [], fallbacks: [] }) })
    await fetch(API + `/api/jobs/${job.id}/files/model.rvt`, { method: 'PUT', headers: h, body: 'launch check' })
    await fetch(API + `/api/jobs/${job.id}/complete`, { method: 'POST', headers: h, body: JSON.stringify({ outputs: [{ name: 'model.rvt', url: `/files/${job.designId}/model.rvt` }, { name: 'report.json', url: `/files/${job.designId}/report.json` }], warnings: [], log: 'launch check' }) })
  }
  await page.getByText('Your Revit model is ready').waitFor({ timeout: REAL_WORKER ? 1800000 : 60000 })
  await shot(page, 'built')
  const link = await page.locator('.card.job a').first().getAttribute('href')
  const f = await fetch(link.startsWith('http') ? link : API + link, { headers: apiHeaders() })
  if (!f.ok) throw new Error(`the model file link answers ${f.status}`)
  return REAL_WORKER ? 'built by the office computer' : 'built (pretend office computer), file link works'
})
await step('no JavaScript errors in the client app', async () => {
  if (pageErrors.length) throw new Error(pageErrors[0])
  return 'none'
})
await browser.close()

// ── the list ──
const pass = results.filter((r) => r.status === 'pass').length
const fail = results.filter((r) => r.status === 'fail')
const lines = results.map((r) => `${r.status === 'pass' ? '🟢' : r.status === 'fail' ? '🔴' : '⚪'} ${r.name}${r.detail ? ' — ' + r.detail : ''}`)
const md = `# Launch check\n\n${new Date().toISOString()} · app ${APP} · api ${API}\n\n${lines.join('\n')}\n\n**${pass} green, ${fail.length} red, ${results.length - pass - fail.length} skipped** in ${Math.round((Date.now() - t0) / 1000)} s.\n`
fs.writeFileSync(path.join(out, 'launch-report.md'), md)
fs.writeFileSync(path.join(out, 'launch-report.json'), JSON.stringify({ at: new Date().toISOString(), app: APP, api: API, results }, null, 2))
console.log(`\n${pass} green, ${fail.length} red, ${results.length - pass - fail.length} skipped · report in ${out}/launch-report.md`)
process.exit(fail.length ? 1 : 0)
