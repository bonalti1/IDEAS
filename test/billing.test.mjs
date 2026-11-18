// Stripe billing is dormant (round 8, P0b): the client app never talks about money and plan changes come
// from an office-granted allowance. These tests cover the dormant code and run only with BILLING_ENABLED=1
// (the server is started with it too). Without the flag the only test here proves the routes are absent.
// A real Checkout Session in Stripe test mode runs only with STRIPE_SECRET_KEY set (LIVE=1).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Stripe from 'stripe'
import { generateRooms } from '../src/draft/lib/layout.js'
import { STYLES } from '../src/draft/lib/styles.js'
import { KIT } from '../src/kits/modern-farmhouse.js'

const BILLING = /^(1|true|yes)$/i.test(process.env.BILLING_ENABLED || '')
const style = STYLES.find((s) => s.id === 'farmhouse')
const program = { ...KIT.reference.program }
const WHSEC = 'whsec_test_secret_for_the_suite'
const stripe = new Stripe('sk_test_unused', { apiVersion: '2025-09-30.clover' })

async function startServer(t, env = {}) {
  const port = 9100 + Math.floor(Math.random() * 100)
  const base = `http://127.0.0.1:${port}`
  const proc = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, DRAFTHOUSE_CLAUDE_KEY: '', ANTHROPIC_API_KEY: '', DATABASE_URL: '', SUPABASE_URL: '', STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: WHSEC, DRAFTHOUSE_ADMINS: 'rolando@drafthouse.test', BILLING_ENABLED: BILLING ? '1' : '', PORT: String(port), DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dh-')), ...env }, stdio: 'ignore' })
  t.after(() => proc.kill())
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(base + '/api/health')
      return base
    } catch {
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  throw new Error('server did not start')
}
const who = async (base, email) => {
  const { token, user } = await (await fetch(base + '/api/auth/dev-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) })).json()
  const h = { 'content-type': 'application/json', authorization: `Bearer ${token}` }
  return { user, get: (p) => fetch(base + p, { headers: h }), post: (p, b = {}) => fetch(base + p, { method: 'POST', headers: h, body: JSON.stringify(b) }), put: (p, b = {}) => fetch(base + p, { method: 'PUT', headers: h, body: JSON.stringify(b) }) }
}
const j = async (r) => ({ status: r.status, body: await r.json() })

// a checkout.session.completed event signed the way Stripe signs it
function signedEvent(base, session) {
  const payload = JSON.stringify({ id: 'evt_' + session.id, object: 'event', type: 'checkout.session.completed', livemode: false, data: { object: { object: 'checkout.session', mode: 'payment', payment_status: 'paid', currency: 'usd', ...session } } })
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: WHSEC })
  return fetch(base + '/api/billing/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': header }, body: payload })
}

test('with BILLING_ENABLED unset there is no billing: every billing and pricing route is 404, and no homeowner payload carries a pack, amount, currency or checkout', { skip: BILLING ? 'BILLING_ENABLED=1: billing is on in this run' : false }, async (t) => {
  const base = await startServer(t)
  const ana = await who(base, 'ana@example.com')
  assert.equal((await ana.get('/api/billing')).status, 404)
  assert.equal((await ana.post('/api/billing/checkout', { pack: 'pack5' })).status, 404)
  assert.equal((await ana.get('/api/billing/session/x')).status, 404)
  assert.equal((await fetch(base + '/api/billing/webhook', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 404)
  const rolando = await who(base, 'rolando@drafthouse.test')
  assert.equal((await rolando.get('/api/admin/pricing')).status, 404)
  assert.equal((await rolando.put('/api/admin/pricing', { packs: [] })).status, 404)
  assert.equal((await rolando.get('/api/admin/payments')).status, 404)
  assert.equal((await rolando.post('/api/admin/users/u1/credits', { credits: 5 })).status, 404)
  const me = await (await ana.get('/api/me')).json()
  const rooms = generateRooms(program, style)
  const a = (await j(await ana.post('/api/projects', { style: { id: 'farmhouse' }, program, rooms }))).body
  const list = (await j(await ana.get('/api/projects'))).body
  for (const [name, body] of [['me', me], ['project', a], ['list', list]]) {
    const keys = []
    JSON.stringify(body, (k, v) => (keys.push(k), v))
    assert.ok(!keys.some((k) => /^(pricing|pack|packs|amount|currency|checkout|credits|freeCredits)$/.test(k)), `${name} carries ${keys.filter((k) => /^(pricing|pack|packs|amount|currency|checkout|credits|freeCredits)$/.test(k)).join(', ')}`)
  }
  const h = await (await fetch(base + '/api/health', { headers: { 'x-api-key': '' } })).json()
  assert.ok(!(h.checks || []).some((c) => c.id === 'billing'), 'no Payments row in the health list')
})

test('BILLING_ENABLED=1 (dormant code): the webhook adds credits to the account record once, signed only, and the session lookup finds the receipt', { skip: BILLING ? false : 'set BILLING_ENABLED=1 to run the dormant billing code' }, async (t) => {
  const base = await startServer(t)
  const ana = await who(base, 'ana@example.com')
  const rolando = await who(base, 'rolando@drafthouse.test')
  const balance = async () => (await (await rolando.get('/api/admin/users')).json()).find((u) => u.id === ana.user.id)?.credits || 0
  // the billing page: packs, empty history, no Stripe → checkout refused
  const bill = (await j(await ana.get('/api/billing'))).body
  assert.equal(bill.mode, 'off')
  assert.ok(bill.pricing.packs.length >= 2)
  assert.equal(bill.pricing.placeholder, true)
  assert.deepEqual(bill.history, [])
  assert.equal((await ana.post('/api/billing/checkout', { pack: 'pack5' })).status, 503)

  // a paid checkout, signed by Stripe, adds the pack's credits once
  const pack = bill.pricing.packs.find((p) => p.id === 'pack5')
  const session = { id: 'cs_test_abc123', client_reference_id: ana.user.id, amount_total: pack.amount, metadata: { userId: ana.user.id, email: 'ana@example.com', pack: pack.id, credits: String(pack.credits) }, customer_details: { email: 'ana@example.com' } }
  const w1 = await j(await signedEvent(base, session))
  assert.equal(w1.status, 200, JSON.stringify(w1.body))
  assert.equal(w1.body.credited, true)
  assert.equal(w1.body.credits, 5)
  assert.equal(await balance(), 5)
  // Stripe retries: the same session never credits twice
  const w2 = await j(await signedEvent(base, session))
  assert.equal(w2.body.duplicate, true)
  assert.equal(await balance(), 5)
  // the history shows the purchase; the session lookup after the redirect finds it
  const bill2 = (await j(await ana.get('/api/billing'))).body
  assert.equal(bill2.history.length, 1)
  assert.equal(bill2.history[0].amount, pack.amount)
  assert.equal(bill2.history[0].status, 'paid')
  const s = (await j(await ana.get('/api/billing/session/cs_test_abc123'))).body
  assert.equal(s.credited, true)
  assert.equal(s.pay.credits, 5)

  // a tampered or unsigned event is refused and adds nothing
  const bad = await fetch(base + '/api/billing/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=nope' }, body: JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_evil', payment_status: 'paid', metadata: { userId: ana.user.id, credits: '999' } } } }) })
  assert.equal(bad.status, 400)
  assert.equal(await balance(), 5)
  // an unpaid session is ignored
  const unpaid = await j(await signedEvent(base, { ...session, id: 'cs_test_unpaid', payment_status: 'unpaid' }))
  assert.match(unpaid.body.ignored, /payment_status/)
  assert.equal(await balance(), 5)
  // another client's session id is not theirs to look at
  const ben = await who(base, 'ben@example.com')
  assert.equal((await ben.get('/api/billing/session/cs_test_abc123')).status, 404)
})

test('BILLING_ENABLED=1 (dormant code): pricing is set by an admin, and an admin can grant credits to the account record', { skip: BILLING ? false : 'set BILLING_ENABLED=1 to run the dormant billing code' }, async (t) => {
  const base = await startServer(t, { DRAFTHOUSE_DRAFTERS: 'maria@drafthouse.test' })
  const ana = await who(base, 'ana@example.com')
  const maria = await who(base, 'maria@drafthouse.test')
  const rolando = await who(base, 'rolando@drafthouse.test')
  assert.equal((await ana.put('/api/admin/pricing', { packs: [] })).status, 403)
  assert.equal((await maria.put('/api/admin/pricing', { packs: [] })).status, 403, 'drafters read prices, admins set them')
  const set = (await j(await rolando.put('/api/admin/pricing', { currency: 'usd', packs: [{ id: 'house', name: 'New house', credits: 12, amount: 34900 }, { id: 'pack10', name: '10 changes', credits: 10, amount: 7900 }, { id: 'bad', name: 'free', credits: 0, amount: 0 }] }))).body
  assert.equal(set.placeholder, false)
  assert.deepEqual(set.packs.map((p) => [p.id, p.credits, p.amount]), [['house', 12, 34900], ['pack10', 10, 7900]], 'a pack with no credits or no price is dropped')
  assert.equal((await (await maria.get('/api/admin/pricing')).json()).packs.length, 2)
  assert.equal((await (await ana.get('/api/billing')).json()).pricing.packs[0].amount, 34900)
  // grants
  assert.equal((await maria.post(`/api/admin/users/${ana.user.id}/credits`, { credits: 5 })).status, 403)
  const g = (await j(await rolando.post(`/api/admin/users/${ana.user.id}/credits`, { credits: 5, note: 'phone order, paid by check' }))).body
  assert.equal(g.credits, 5)
  const bill = (await j(await ana.get('/api/billing'))).body
  assert.equal(bill.credits, 5)
  assert.equal(bill.history[0].status, 'granted')
  assert.match(bill.history[0].note, /phone order/)
  assert.equal((await rolando.post(`/api/admin/users/${ana.user.id}/credits`, { credits: 9999 })).status, 400)
  const all = (await j(await maria.get('/api/admin/payments'))).body
  assert.equal(all.length, 1)
})

test('live: a Checkout Session is created in Stripe test mode', { skip: !(BILLING && process.env.LIVE && process.env.STRIPE_SECRET_KEY) && 'set BILLING_ENABLED=1, LIVE=1 and STRIPE_SECRET_KEY (sk_test_...)' }, async (t) => {
  const base = await startServer(t, { STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY, APP_URL: 'https://example.com' })
  const ana = await who(base, 'ana@example.com')
  const r = await j(await ana.post('/api/billing/checkout', { pack: 'pack5' }))
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.match(r.body.url, /^https:\/\/checkout\.stripe\.com\//)
  assert.match(r.body.id, /^cs_test_/)
  const s = (await j(await ana.get(`/api/billing/session/${r.body.id}`))).body
  assert.equal(s.paid, false)
  assert.equal(s.credits, 5)
})
