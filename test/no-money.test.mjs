// Round 8, P0b: no money reaches a homeowner. The owner-view JSON on every owner route, the client
// summary PDF and print page, the chat's answer to cost questions (English and Spanish, alone and beside a
// change), the screens at 390 and 1440 px, the absent billing routes, the built bundle, and the office
// grant flow (free changes per plan, the out-of-changes reply, the audit log, the office-only estimate).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { chromePath, startPreview, appContext, freePort } from './browser.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { generateRooms, DEFAULT_PROGRAM, kitFor } from '../src/draft/lib/layout.js'
import { STYLES } from '../src/draft/lib/styles.js'
import { KIT } from '../src/kits/modern-farmhouse.js'
import { buildLot, DEFAULT_LOT } from '../src/draft/lib/lot.js'
import { interpretRequest } from '../src/draft/lib/interpret.js'
import { regexOps, isCostQuestion, COST_REPLY, COST_REPLY_ES } from '../src/draft/lib/ops.js'
import { summaryHTML } from '../src/draft/lib/plan-svg.js'
import { meetingPrepHTML } from '../src/draft/lib/office.js'
import { buildDesign } from '../src/draft/lib/contract.js'
import { auditSummary } from '../src/draft/lib/audit.js'
import { estimate } from '../src/draft/lib/pricing.js'
import { TRUST } from '../src/draft/lib/trust.js'
import { fixtureEnv } from './server-env.mjs'

const style = STYLES.find((s) => s.id === 'farmhouse')
const kit = kitFor(style)
const program = { ...KIT.reference.program }
const j = async (r) => ({ status: r.status, body: await r.json() })

async function startServer(t, env = {}) {
  const port = env.PORT ? +env.PORT : 9500 + Math.floor(Math.random() * 100)
  const base = `http://127.0.0.1:${port}`
  const proc = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, ...fixtureEnv, DRAFTHOUSE_CLAUDE_KEY: '', ANTHROPIC_API_KEY: '', DATABASE_URL: '', SUPABASE_URL: '', RESEND_API_KEY: '', BILLING_ENABLED: '', DRAFTHOUSE_APP_KEY: '', DRAFTHOUSE_WORKER_KEY: 'test-worker-key', DRAFTHOUSE_DRAFTERS: 'maria@drafthouse.test', DRAFTHOUSE_ADMINS: 'rolando@drafthouse.test', PORT: String(port), DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dh-nm-')), ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  proc.stdout.on('data', (c) => (out += c))
  proc.stderr.on('data', (c) => (out += c))
  t.after(() => proc.kill())
  for (let i = 0; i < 80; i++) {
    try {
      await fetch(base + '/api/health')
      return { base, log: () => out }
    } catch {
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  throw new Error('server did not start:\n' + out)
}
async function who(base, email, name) {
  const r = await fetch(base + '/api/auth/dev-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, name }) })
  const { token, user } = await r.json()
  const h = { 'content-type': 'application/json', authorization: `Bearer ${token}` }
  return { user, get: (p) => fetch(base + p, { headers: h }), post: (p, body = {}) => fetch(base + p, { method: 'POST', headers: h, body: JSON.stringify(body) }), put: (p, body = {}) => fetch(base + p, { method: 'PUT', headers: h, body: JSON.stringify(body) }) }
}

// ── the sweep: no money-shaped key, no dollar or price pattern in any string ───────────────────────
// keys are single words: a fire-rated door (fireRated) is not a rate
const MONEY_KEY = /price|estimate|cost|perSf|\brates?\b|^parts$|flatwork|allowance|credit|pricing|^packs?$|amount|currency|checkout/i
const MONEY_TEXT = /\$|\b\d+k\b|\/sf\b|\bcredits?\b|\bbuy\b|\bpurchase\b|credit card/i
function offenders(body, where) {
  const out = []
  const walk = (v, p) => {
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${p}[${i}]`))
    if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (MONEY_KEY.test(k)) out.push(`${where} key ${p}.${k}`)
        walk(x, `${p}.${k}`)
      }
      return
    }
    if (typeof v === 'string' && MONEY_TEXT.test(v)) out.push(`${where} text ${p} = "${v.slice(0, 80)}"`)
  }
  walk(body, '')
  return out
}

const FIXTURES = () => ({
  'default (Lot 514)': { lot: null, program: { ...program } },
  'McAllen 2-car': { lot: buildLot({ kind: 'manual', width: 100, depth: 150, city: 'mcallen', frontStreet: 'E Nolana Ave', setbacks: {} }), program: { ...DEFAULT_PROGRAM, beds: 4, baths: 3, halfBath: true, office: true, garage: 2, sqft: 2800 } },
  'Brownsville (Cameron County)': { lot: buildLot({ kind: 'manual', width: 80, depth: 140, county: 'Cameron County', setbacks: {} }), program: { ...DEFAULT_PROGRAM, beds: 3, baths: 2, halfBath: false, office: false, garage: 2, sqft: 2000 } },
})
const GARZA_STEPS = ['make the house 2,400 sf', 'add a bedroom', 'add a bedroom', 'make the garage 3 cars', 'make the kitchen 2 feet wider']

test('owner view: no $ and no money-shaped key on any owner route (list, detail, create, change, rollback, send) for the default, McAllen 2-car, Brownsville and the Garza 5-step chat', async (t) => {
  const { base } = await startServer(t)
  const ana = await who(base, 'ana@example.com', 'Ana Garza')
  const bad = []
  const me = await j(await ana.get('/api/me'))
  bad.push(...offenders(me.body, 'me'))
  for (const [name, f] of Object.entries(FIXTURES())) {
    const rooms = generateRooms(f.program, style, f.lot || DEFAULT_LOT)
    const made = await j(await ana.post('/api/projects', { lot: f.lot, style: { id: 'farmhouse', name: 'Modern Farmhouse' }, program: f.program, rooms, client: 'Ana Garza' }))
    assert.equal(made.status, 201, `${name}: ${JSON.stringify(made.body).slice(0, 200)}`)
    bad.push(...offenders(made.body, `${name} create`))
    assert.equal(made.body.changesLeft, 10)
    const steps = name.startsWith('default') ? GARZA_STEPS : ['make the kitchen bigger', 'how much does it cost?', 'add an office']
    for (const text of steps) {
      const r = await j(await ana.post(`/api/projects/${made.body.id}/change`, { text }))
      assert.equal(r.status, 200, `${name} "${text}": ${JSON.stringify(r.body).slice(0, 200)}`)
      bad.push(...offenders(r.body, `${name} change "${text}"`))
    }
    bad.push(...offenders((await j(await ana.get(`/api/projects/${made.body.id}`))).body, `${name} detail`))
    bad.push(...offenders((await j(await ana.post(`/api/projects/${made.body.id}/rollback`, { version: 1 }))).body, `${name} rollback`))
    const sent = await j(await ana.post(`/api/projects/${made.body.id}/send`, { design: { contract: 1, client: 'Ana Garza' } }))
    bad.push(...offenders(sent.body, `${name} send (${sent.status})`))
  }
  bad.push(...offenders((await j(await ana.get('/api/projects'))).body, 'list'))
  // the no-account interpreter route answers a cost question with the meeting, no number
  const rooms = generateRooms(program, style, DEFAULT_LOT)
  const it = await j(await fetch(base + '/api/interpret', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'how much will this cost?', rooms: rooms.map((r) => ({ id: r.id, kind: r.kind, name: r.name, w: r.w, d: r.d, x: r.x, y: r.y })), program, kit: { id: kit.id } }) }))
  assert.equal(it.status, 200)
  bad.push(...offenders(it.body, 'interpret'))
  assert.deepEqual(bad, [], bad.join('\n'))
})

// ── chat: 20 cost questions ─────────────────────────────────────────────────────────────────────
const COST_QUESTIONS = [
  ['how much does it cost?', false],
  ['what is the price?', false],
  ["what's the price per square foot?", false],
  ['can we afford this?', false],
  ['what is your estimate for this house', false],
  ['can I get a quote?', false],
  ['what about financing?', false],
  ['is $250k enough for this?', false],
  ['what would the payment be', false],
  ['make it 2,400 sf, how much is that?', 'change'],
  ['make the kitchen bigger and what would that cost', 'change'],
  ['add an office. what is the payment on this?', 'change'],
  ['¿cuánto cuesta?', false],
  ['cuánto cuesta esta casa', false],
  ['¿cuál es el precio?', false],
  ['precio por pie cuadrado', false],
  ['tengo un presupuesto de 300 mil', false],
  ['¿me pueden dar una cotización?', false],
  ['¿cuánto sería el pago mensual?', false],
  ['add a bedroom, ¿cuánto cuesta?', 'change'],
]
const NO_NUMBER = /\$|\d\s?k\b|\/sf/i

test('chat: 20 cost questions (English and Spanish, alone and beside a change) answer with the meeting, no number, the office button, and use no change', async () => {
  const rooms = generateRooms(program, style, DEFAULT_LOT)
  const offline = async () => {
    throw new Error('offline')
  }
  assert.equal(COST_QUESTIONS.length, 20)
  for (const [q, mixed] of COST_QUESTIONS) {
    assert.ok(isCostQuestion(q), `"${q}" is read as a cost question`)
    const r = await interpretRequest(q, rooms, program, style, { lot: DEFAULT_LOT, interpreter: offline, report: false })
    assert.equal(r.askOffice, 'meeting', `"${q}" carries the meeting button: ${r.reply}`)
    const spanish = /cu[aá]nto|precio|presupuesto|cotizaci/i.test(q)
    assert.ok(r.reply.includes(spanish ? COST_REPLY_ES : COST_REPLY), `"${q}" → ${r.reply}`)
    const tail = r.reply.replace(COST_REPLY, '').replace(COST_REPLY_ES, '')
    assert.doesNotMatch(tail, NO_NUMBER, `"${q}" → ${r.reply}`)
    if (mixed) assert.equal(r.applied, true, `"${q}" applies the change beside the question: ${r.reply}`)
    else {
      assert.equal(r.applied, false, `"${q}" changes nothing`)
      assert.deepEqual(r.ops, [], `"${q}" has no ops`)
    }
  }
  // the local rules alone: a cost question is never an op; "how much bigger" is still about size
  assert.deepEqual(regexOps('how much does it cost?', rooms, kit).ops, [])
  assert.ok(regexOps('how much bigger can the kitchen get?', rooms, kit).reply, 'size talk is not a cost question')
  assert.equal(isCostQuestion('make the kitchen bigger'), false)
})

test('chat on the office API: a cost question uses no change and carries the button; the reply never names a number', async (t) => {
  const { base } = await startServer(t)
  const ana = await who(base, 'ana@example.com', 'Ana Garza')
  const rooms = generateRooms(program, style, DEFAULT_LOT)
  const p = (await j(await ana.post('/api/projects', { style: { id: 'farmhouse' }, program, rooms, client: 'Ana Garza' }))).body
  for (const q of ['how much does it cost?', '¿cuánto cuesta?', 'what is the price per square foot']) {
    const r = await j(await ana.post(`/api/projects/${p.id}/change`, { text: q }))
    assert.equal(r.status, 200)
    assert.equal(r.body.applied, false)
    assert.equal(r.body.askOffice, 'meeting')
    assert.equal(r.body.changesLeft, 10, 'no change used')
    assert.doesNotMatch(r.body.reply, NO_NUMBER)
  }
  const mixed = await j(await ana.post(`/api/projects/${p.id}/change`, { text: 'make the kitchen bigger, how much is that?' }))
  assert.equal(mixed.body.applied, true, mixed.body.reply)
  assert.equal(mixed.body.askOffice, 'meeting')
  assert.ok(mixed.body.reply.endsWith(COST_REPLY))
  assert.equal(mixed.body.changesLeft, 9, 'the change beside the question is one change')
})

// ── the office grant flow ───────────────────────────────────────────────────────────────────────
test('office grant: 10 free changes per plan, the 11th gets the out-of-changes reply, a drafter grant of 5 is logged and unblocks it, bad bodies are 400, a homeowner is 403, the owner sees counts only', async (t) => {
  const { base } = await startServer(t)
  const ana = await who(base, 'ana@example.com', 'Ana Garza')
  const maria = await who(base, 'maria@drafthouse.test', 'Maria')
  const rooms = generateRooms(program, style, DEFAULT_LOT)
  const p = (await j(await ana.post('/api/projects', { style: { id: 'farmhouse' }, program, rooms, client: 'Ana Garza' }))).body
  assert.equal(p.changesAllowed, 10)
  assert.equal(p.changesUsed, 0)
  assert.equal(p.changesLeft, 10)
  // ten applied changes: grow and shrink the kitchen and the primary bedroom in turn
  const texts = ['make the kitchen bigger', 'make the kitchen smaller', 'make the primary bedroom bigger', 'make the primary bedroom smaller', 'make the living room bigger', 'make the living room smaller']
  let used = 0
  for (let i = 0; used < 10 && i < 40; i++) {
    const r = (await j(await ana.post(`/api/projects/${p.id}/change`, { text: texts[i % texts.length] }))).body
    if (r.applied) {
      used++
      assert.equal(r.changesLeft, 10 - used)
    }
  }
  assert.equal(used, 10, 'ten changes applied')
  const eleventh = (await j(await ana.post(`/api/projects/${p.id}/change`, { text: 'make the kitchen bigger' }))).body
  assert.equal(eleventh.applied, false)
  assert.equal(eleventh.outOfChanges, true)
  assert.equal(eleventh.askOffice, 'more-changes')
  assert.equal(eleventh.reply, "You've used the free changes on this plan. The office will add more for you. Want me to let them know?")
  assert.equal(eleventh.changesLeft, 0)
  assert.equal((await j(await ana.get(`/api/projects/${p.id}`))).body.version, 11, 'nothing applied')
  // the button: a more-changes request, flagged for the office, in the activity
  const ask = (await j(await ana.post(`/api/projects/${p.id}/meeting-request`, { kind: 'more-changes' }))).body
  assert.equal(ask.ok, true)
  assert.match(ask.message, /^Done\. The office has your request and usually adds more within 1 business day\. You can also call \(956\) 594-6936\.$/)
  const inbox = (await j(await maria.get('/api/review'))).body
  assert.ok(inbox.requests.some((x) => x.id === p.id && x.wantsMoreChanges), 'flagged "wants more changes" for the office')
  assert.ok(inbox.plans.some((x) => x.id === p.id && x.changesUsed === 10 && x.changesAllowed === 10), 'the dashboard list shows 10 of 10 used')
  const events = (await j(await maria.get('/api/admin/overview'))).body.events
  assert.ok(events.some((e) => e.kind === 'request' && /wants more changes/.test(e.message)), 'an office alert in the activity')
  // bad grants
  for (const body of [{ add: 0 }, { add: 51 }, { add: -3 }, { add: '5' }, { add: 2.5 }, {}]) {
    const r = await maria.post(`/api/review/${p.id}/allowance`, body)
    assert.equal(r.status, 400, JSON.stringify(body))
  }
  assert.equal((await ana.post(`/api/review/${p.id}/allowance`, { add: 5 })).status, 403, 'a homeowner cannot grant')
  // the grant
  const g = (await j(await maria.post(`/api/review/${p.id}/allowance`, { add: 5, note: 'called in, happy to help' }))).body
  assert.equal(g.changesAllowed, 15)
  assert.equal(g.changesUsed, 10)
  assert.equal(g.changesLeft, 5)
  assert.equal(g.wantsMoreChanges, false, 'the flag clears')
  const log = g.allowanceLog
  assert.equal(log.length, 1)
  assert.equal(log[0].by, 'maria@drafthouse.test')
  assert.equal(log[0].before, 10)
  assert.equal(log[0].after, 15)
  assert.equal(log[0].add, 5)
  assert.match(log[0].note, /called in/)
  const twelfth = (await j(await ana.post(`/api/projects/${p.id}/change`, { text: 'make the kitchen bigger' }))).body
  assert.equal(twelfth.applied, true, twelfth.reply)
  assert.equal(twelfth.changesLeft, 4)
  // the owner's view: counts, never the log or who granted it
  const own = (await j(await ana.get(`/api/projects/${p.id}`))).body
  assert.equal(own.changesLeft, 4)
  assert.equal(own.changesAllowed, 15)
  assert.equal(own.allowanceLog, undefined)
  assert.ok(!JSON.stringify(own).includes('maria@drafthouse.test'), 'no drafter email in the owner view')
  // the default changes new plans only
  assert.equal((await j(await maria.get('/api/admin/allowance'))).body.default, 10)
  assert.equal((await maria.put('/api/admin/allowance', { default: 0 })).status, 400)
  assert.equal((await j(await maria.put('/api/admin/allowance', { default: 12 }))).body.default, 12)
  const fresh = (await j(await ana.post('/api/projects', { style: { id: 'farmhouse' }, program, rooms, client: 'Ana Garza' }))).body
  assert.equal(fresh.changesAllowed, 12)
  assert.equal((await j(await ana.get(`/api/projects/${p.id}`))).body.changesAllowed, 15, 'the open plan keeps its own')
  // a meeting request from the Send screen
  const m = (await j(await ana.post(`/api/projects/${p.id}/meeting-request`, { kind: 'meeting', note: 'evenings are best' }))).body
  assert.equal(m.message, 'Thanks! The office will reach out within 1 business day. You can also call (956) 594-6936.')
  assert.equal((await ana.post(`/api/projects/${p.id}/meeting-request`, { kind: 'refund' })).status, 400)
  const det = (await j(await maria.get(`/api/review/${p.id}`))).body
  assert.equal(det.meetingRequest.kind, 'meeting')
  assert.equal(det.meetingRequest.note, 'evenings are best')
})

test('the office keeps the numbers: the estimate route answers a drafter with the range and 403 a homeowner; the meeting-prep page carries the price, the client summary never does', async (t) => {
  const { base } = await startServer(t)
  const ana = await who(base, 'ana@example.com', 'Ana Garza')
  const maria = await who(base, 'maria@drafthouse.test', 'Maria')
  const lot = buildLot({ kind: 'manual', width: 100, depth: 150, city: 'mcallen', setbacks: {} })
  const prog = { ...DEFAULT_PROGRAM, garage: 2 }
  const rooms = generateRooms(prog, style, lot)
  const p = (await j(await ana.post('/api/projects', { lot, style: { id: 'farmhouse' }, program: prog, rooms, client: 'Ana Garza' }))).body
  assert.equal((await ana.get(`/api/review/${p.id}/estimate`)).status, 403)
  const est = await j(await maria.get(`/api/review/${p.id}/estimate`))
  assert.equal(est.status, 200, JSON.stringify(est.body).slice(0, 200))
  assert.match(est.body.range, /^\$\d+k–\$\d+k$/)
  assert.match(est.body.rateLine, /\$\d+–\d+\/sf living/)
  assert.equal(est.body.county, 'Hidalgo County')
  assert.ok(est.body.parts.living && est.body.parts.garage && est.body.areas.flatwork > 0)
  assert.match(est.body.internal, /not for the client/i)
  // the pages
  const design = buildDesign({ rooms, program: prog, style, lot, client: 'Ana Garza' })
  const audit = auditSummary(rooms, prog, kit, lot)
  const client = summaryHTML(design, audit, TRUST, kit.titleBlock).replace(/<svg[\s\S]*?<\/svg>/g, '')
  assert.match(client, /we go over cost with you at your meeting with the South Texas Builders office/i)
  assert.doesNotMatch(client, /\$|\b\d+k\b|\/sf|Estimate|Price range/)
  const office = meetingPrepHTML(design, estimate({ rooms, program: prog, style, lot }), audit, TRUST, kit.titleBlock)
  assert.ok(office.includes('Meeting prep') && office.includes('not for the client'))
  assert.match(office, /\$\d+k–\$\d+k/)
})

// ── the screens, as a homeowner, at 1440 and 390 px ─────────────────────────────────────────────
// free ports every run (round 9, item 12): never the developer's :8787 or :4188; the built app is pointed at the
// test's API through localStorage before its first script runs (test/browser.mjs)
const SCREEN_TEXT = /\$|Estimate|Price range|\b(buy|pay|credit|credits|checkout)\b/i
const SHOTS = process.env.SHOTS || ''
const CHROME = chromePath()
const skipBrowser = !CHROME && 'no Chrome found (set CHROME=/path/to/chrome)'
const preview = (t) => startPreview(t)

async function homeownerFlow(browser, app, api, viewport, tag) {
  const ctx = await appContext(browser, api, { viewport, acceptDownloads: true })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  const apiLog = [] // every office API answer, for the message when a step hangs
  page.on('response', (r) => {
    if (r.url().includes('/api/')) apiLog.push(`${r.status()} ${r.request().method()} ${r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 80)}`)
  })
  page.on('requestfailed', (r) => {
    if (r.url().includes('/api/')) apiLog.push(`FAILED ${r.request().method()} ${r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 80)} ${r.failure()?.errorText || ''}`)
  })
  const seen = []
  const shot = async (name) => {
    if (!SHOTS) return
    fs.mkdirSync(SHOTS, { recursive: true })
    await page.waitForTimeout(600)
    await page.screenshot({ path: `${SHOTS}/${tag}-${name}.png`, fullPage: viewport.width < 500 })
  }
  const check = async (screen) => {
    const text = await page.evaluate(() => document.body.innerText)
    seen.push([screen, text])
    const m = text.match(SCREEN_TEXT)
    assert.ok(!m, `${tag} ${screen}: "${m?.[0]}" at …${text.slice(Math.max(0, (m?.index ?? 0) - 60), (m?.index ?? 0) + 60).replace(/\s+/g, ' ')}…`)
    assert.equal(await page.locator('a[href="#/billing"]').count(), 0, `${tag} ${screen}: a billing link`)
  }
  await page.goto(app, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(800)
  await check('start')
  await shot('01-start')
  await page.locator('#signin-name').fill('Ana Garza')
  await page.locator('#signin-email').fill(`ana-${tag}-${Date.now().toString(36)}@example.com`)
  await page.getByRole('button', { name: /Continue|Email me/ }).click()
  await page.locator('#start-address').waitFor({ timeout: 20000 })
  await check('start, signed in')
  await page.locator('#start-address').fill('1300 W Nolana Ave, McAllen, TX 78504')
  await page.getByRole('button', { name: 'Find my lot' }).click()
  await page.locator('#lot-city').waitFor({ timeout: 20000 })
  await page.locator('#lot-city').selectOption('mcallen')
  await page.waitForTimeout(1500)
  await check('lot')
  await shot('02-lot')
  const confirm = page.locator('#lot-confirm')
  if (await confirm.count()) await confirm.check()
  await page.getByRole('button', { name: /pick a style/ }).click()
  await page.waitForTimeout(600)
  await check('style') // round 9, item 1: the Style step said "from $115/sf"
  await shot('02b-style')
  await page.getByRole('button', { name: /Modern Farmhouse/ }).click()
  await page.getByRole('button', { name: /Next, rooms/ }).click()
  await page.waitForTimeout(1500)
  await check('rooms')
  await shot('03-rooms')
  await page.getByRole('button', { name: /Draft my house/ }).click()
  await page.getByText(/changes? left/).first().waitFor({ timeout: 40000 })
  await page.waitForTimeout(1500)
  await check('draft')
  // round 11, item 7: the changes left are said once on the Draft step (they were in the header and on the card)
  const leftLines = ((await page.locator('body').innerText()).match(/\b\d+ changes? left\b/gi) || []).length
  assert.equal(leftLines, 1, `${tag}: "changes left" appears ${leftLines} times on the Draft step`)
  await shot('04-draft')
  const ask = async (text) => {
    await page.getByPlaceholder(/change|Move the laundry|No changes left/).fill(text)
    await page.getByRole('button', { name: 'Change', exact: true }).click()
    try {
      await page.locator('.msg.thinking').waitFor({ state: 'hidden', timeout: 60000 })
    } catch (e) {
      throw new Error(`${tag}: "${text}" did not finish in 60 s. API answers: ${apiLog.slice(-8).join(' | ')}. Messages: ${(await page.locator('.msg').allInnerTexts()).slice(-3).join(' // ').slice(0, 400)}`)
    }
    return (await page.locator('.msg.house').last().textContent()).trim()
  }
  const applied = await ask('make the kitchen bigger')
  assert.doesNotMatch(applied, /\$|credit/i, applied)
  await check('draft after a change')
  const cost = await ask('how much does it cost?')
  assert.ok(cost.includes('Cost is something we go over with you in person'), cost)
  const button = page.getByRole('button', { name: 'Ask the office to set up my meeting' })
  assert.ok(await button.count(), 'the meeting button is in the chat')
  await shot('05-cost-question')
  await button.click()
  await page.getByText(/within 1 business day/).waitFor({ timeout: 20000 })
  const thanks = (await page.locator('.msg.house').last().textContent()).trim()
  assert.ok(thanks.includes('(956) 594-6936'), thanks)
  await check('draft after the meeting request')
  await shot('06-meeting-requested')
  await ask('show me garage options')
  if (await page.locator('.picker').count()) await check('options')
  await shot('07-options')
  await page.getByRole('button', { name: /send to drafters/ }).click()
  await page.waitForTimeout(800)
  await check('send')
  await shot('08-send')
  assert.ok(await page.getByText(/we go over cost with you at your meeting/i).count(), 'the cost sentence on Send')
  // the meeting was asked for from the chat, so Send says so; a plan that has not asked shows the button
  assert.ok((await page.getByRole('button', { name: 'Ask the office to set up my meeting' }).count()) || (await page.getByText(/Meeting requested/).count()), 'the meeting button or the requested line on Send')
  // send it, then the client summary PDF as the button makes it: its text has no money
  await page.getByRole('button', { name: /^Send to drafters$/ }).click()
  await page.getByRole('button', { name: /Download your summary/ }).waitFor({ timeout: 40000 })
  await page.waitForTimeout(800)
  await check('sent')
  await shot('09-sent')
  let pdfText = ''
  const btn = page.getByRole('button', { name: /Download your summary/ })
  if (await btn.count()) {
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }).catch(() => null), btn.click()])
    if (dl) {
      const file = path.join(os.tmpdir(), `dh-summary-${tag}.pdf`)
      await dl.saveAs(file)
      const r = spawnSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' })
      if (r.status === 0) pdfText = r.stdout
    }
  }
  // #/billing is gone: it lands on the house, and nothing links to it
  await page.goto(app + '/#/billing', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(800)
  assert.notEqual(new URL(page.url()).hash, '#/billing', 'the billing route redirects')
  assert.equal(await page.getByText(/Buy changes|Credits on your account/).count(), 0)
  await ctx.close()
  return { errors, seen, pdfText }
}

test('screens: Lot, rooms, Draft, options and Send as a homeowner at 1440 and 390 px carry no $, Estimate, Price range, buy, pay, credit or checkout; the cost question gets the meeting button; #/billing is gone; the summary PDF has no money; the bundle has no Stripe', { skip: skipBrowser, timeout: 400000 }, async (t) => {
  const { chromium } = await import('playwright-core')
  const app = await preview(t)
  const { base: api } = await startServer(t, { PORT: String(await freePort()), DRAFTHOUSE_APP_ORIGIN: app })
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })
  t.after(() => browser.close())
  let pdfChecked = false
  for (const [viewport, tag] of [[{ width: 1440, height: 900 }, 'desktop'], [{ width: 390, height: 844 }, 'phone']]) {
    const r = await homeownerFlow(browser, app, api, viewport, tag)
    assert.deepEqual(r.errors, [], `${tag} page errors`)
    if (r.pdfText) {
      pdfChecked = true
      assert.ok(/we go over cost with you at your meeting/i.test(r.pdfText.replace(/\s+/g, ' ')), 'the PDF carries the meeting sentence')
      assert.doesNotMatch(r.pdfText, /\$|\b\d+k\b|\/sf|Price range|Estimate/, 'no money in the client PDF')
    }
  }
  assert.ok(pdfChecked, 'the summary PDF was generated and read')
  // the built bundle: no Stripe checkout, no billing screen
  const js = fs.readdirSync('dist/assets').filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join('dist/assets', f), 'utf8')).join('\n')
  assert.ok(!js.includes('checkout.stripe.com'), 'no checkout.stripe.com in dist')
  assert.ok(!/Buy changes|Credits on your account|billing=success/.test(js), 'no Billing screen chunk in dist')
  assert.ok(!fs.readdirSync('dist/assets').some((f) => /^Billing-/.test(f)), 'no Billing chunk file')
  // round 9, item 1: the homeowner entry chunk carries no rates at all; the office printables are their own lazy chunk
  const entry = fs.readdirSync('dist/assets').filter((f) => /^index-.*\.js$/.test(f)).map((f) => fs.readFileSync(path.join('dist/assets', f), 'utf8')).join('\n')
  assert.ok(entry.length > 100000, 'the entry chunk was found')
  assert.ok(!/\bRATES\b|drivewayAllowanceSf|estimateLines|windstormCounties/.test(entry), 'no rates table in the homeowner entry chunk')
  assert.ok(!/\$\d+(?:–|-)\d+\/sf|\/sf living|\$\d+\/sf/.test(entry), 'no $/sf line in the homeowner entry chunk (the cost-question detector may name the phrase, never a rate)')
  assert.ok(!/\b115\b[^\n]{0,12}\b120\b|\b120\b[^\n]{0,12}\b130\b/.test(entry), 'no 115/120 or 120/130 rate pair in the homeowner entry chunk')
  assert.ok(!/from \$\d+\/sf/.test(entry), 'the Style step rate line is gone')
  const chunks = fs.readdirSync('dist/assets').filter((f) => f.endsWith('.js'))
  assert.ok(chunks.some((f) => /^(office|Review|Admin)-/.test(f)), `the office code is a separate chunk (${chunks.join(', ')})`)
})

// ── round 8, item 1: the rooms step on a slow phone ─────────────────────────────────────────────
test('rooms step at 390 px with 6x CPU throttling: ten fast taps on bedrooms never block the main thread over 200 ms, and the meter says "Checking the lot…" then the result', { skip: skipBrowser, timeout: 400000 }, async (t) => {
  const { chromium } = await import('playwright-core')
  const app = await preview(t)
  const { base: api } = await startServer(t, { PORT: String(await freePort()), DRAFTHOUSE_APP_ORIGIN: app })
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })
  t.after(() => browser.close())
  const ctx = await appContext(browser, api, { viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(app, { waitUntil: 'domcontentloaded' })
  await page.locator('#signin-name').fill('Ana Garza')
  await page.locator('#signin-email').fill(`ana-slow-${Date.now().toString(36)}@example.com`)
  await page.getByRole('button', { name: /Continue|Email me/ }).click()
  await page.locator('#start-address').waitFor({ timeout: 20000 })
  await page.locator('#start-address').fill('1300 W Nolana Ave, McAllen, TX 78504')
  await page.getByRole('button', { name: 'Find my lot' }).click()
  await page.locator('#lot-city').waitFor({ timeout: 20000 })
  await page.locator('#lot-city').selectOption('mcallen')
  const confirm = page.locator('#lot-confirm')
  if (await confirm.count()) await confirm.check()
  await page.getByRole('button', { name: /pick a style/ }).click()
  await page.getByRole('button', { name: /Modern Farmhouse/ }).click()
  await page.getByRole('button', { name: /Next, rooms/ }).click()
  await page.getByRole('button', { name: 'More Bedrooms' }).waitFor({ timeout: 20000 })
  await page.waitForTimeout(1500)
  // a slow phone: 6x CPU throttling through the devtools protocol, and a long-task observer in the page
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 })
  await page.evaluate(() => {
    window.__long = []
    window.__checking = 0
    new PerformanceObserver((list) => list.getEntries().forEach((e) => window.__long.push(Math.round(e.duration)))).observe({ type: 'longtask', buffered: false })
    const watch = () => {
      if (/Checking the lot…/.test(document.body.innerText)) window.__checking++
      requestAnimationFrame(watch)
    }
    requestAnimationFrame(watch)
  })
  const more = page.getByRole('button', { name: 'More Bedrooms' })
  const fewer = page.getByRole('button', { name: 'Fewer Bedrooms' })
  for (let i = 0; i < 10; i++) {
    await (i % 2 === 0 ? more : fewer).click({ force: true, noWaitAfter: true })
    await page.waitForTimeout(60)
  }
  // the meter settles on a verdict
  await page.locator('.fit-note, .fine').filter({ hasText: /Passes the setback|Does not fit|Fits once trimmed|Checking the lot/ }).first().waitFor({ timeout: 60000 })
  await page.waitForFunction(() => !/Checking the lot…/.test(document.body.innerText), null, { timeout: 90000 })
  await page.waitForTimeout(500)
  const { long, checking } = await page.evaluate(() => ({ long: window.__long, checking: window.__checking }))
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  const worst = Math.max(0, ...long)
  console.log(`  rooms step at 390 px, 6x CPU: ${long.length} long task${long.length === 1 ? '' : 's'}, worst ${worst} ms; "Checking the lot…" seen on ${checking} frame${checking === 1 ? '' : 's'}`)
  assert.ok(worst <= 200, `the main thread was blocked for ${worst} ms (${long.join(', ')})`)
  assert.ok(checking > 0, 'the meter said "Checking the lot…" while the worker ran')
  const text = await page.evaluate(() => document.body.innerText)
  assert.match(text, /Passes the setback|Does not fit this lot|Fits once trimmed/, 'then the result')
  assert.deepEqual(errors, [])
  await ctx.close()
})
