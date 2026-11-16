// Pricing and payments. Credits live on the account. Stripe Checkout takes the payment; the
// webhook (checkout.session.completed) is the only thing that adds credits, once per session id.
// Needs STRIPE_SECRET_KEY (sk_test_... first) and STRIPE_WEBHOOK_SECRET (whsec_...). Without them
// checkout answers 503 and the office can still grant credits by hand.
import Stripe from 'stripe'

const fail = (status, error, extra = {}) => Object.assign(new Error(error), { status, ...extra })
const now = () => new Date().toISOString()

// Placeholders until the office sets prices on the dashboard (PUT /api/admin/pricing). Amounts in cents.
export const PRICING_DEFAULTS = {
  currency: 'usd',
  placeholder: true,
  packs: [
    { id: 'house', name: 'New house', blurb: 'The first draft and 10 changes', credits: 10, amount: 29900 },
    { id: 'pack5', name: '5 more changes', blurb: 'For a plan that is almost there', credits: 5, amount: 4900 },
    { id: 'pack15', name: '15 more changes', blurb: 'Best value', credits: 15, amount: 9900 },
  ],
}

export function makeBilling({ env = process.env, store, event, log = console.log }) {
  const secretKey = (env.STRIPE_SECRET_KEY || '').trim()
  const webhookSecret = (env.STRIPE_WEBHOOK_SECRET || '').trim()
  const stripe = new Stripe(secretKey || 'sk_test_unset', { apiVersion: '2025-09-30.clover', maxNetworkRetries: 1, timeout: 20000 })
  const mode = !secretKey ? 'off' : secretKey.startsWith('sk_live_') ? 'live' : 'test'
  const appUrl = (env.APP_URL || (env.DRAFTHOUSE_APP_ORIGIN || '').split(',')[0] || '').trim().replace(/\/$/, '')

  async function pricing() {
    const saved = await store.meta.get('pricing')
    const p = saved ? { ...PRICING_DEFAULTS, ...saved, placeholder: false } : PRICING_DEFAULTS
    return { ...p, packs: (p.packs || []).filter((x) => x.credits > 0 && x.amount >= 50) }
  }
  const money = (amount, currency = 'usd') => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount / 100)

  async function record(pay) {
    const added = await store.payments.add(pay)
    if (!added) return null // seen before: the webhook retried
    await store.users.addCredits(pay.userId, pay.credits, now())
    await event('payment', `${pay.email || pay.userId}: ${pay.status === 'granted' ? 'granted' : 'bought'} ${pay.credits} credit${pay.credits === 1 ? '' : 's'}${pay.amount ? ` for ${money(pay.amount, pay.currency)}` : ''}${pay.note ? ` (${pay.note})` : ''}`, { userId: pay.userId })
    return pay
  }

  return {
    mode,
    configured: mode !== 'off',
    webhookConfigured: !!webhookSecret,
    pricing,
    money,
    describe: () => ({ ok: mode !== 'off' && !!webhookSecret, detail: mode === 'off' ? 'no STRIPE_SECRET_KEY: clients cannot buy credits, the office can grant them' : `Stripe ${mode} mode${webhookSecret ? ', webhook secret set' : ', NO STRIPE_WEBHOOK_SECRET (payments will not add credits)'}` }),

    async setPricing(patch, who) {
      const cur = await pricing()
      const next = { currency: patch.currency || cur.currency || 'usd', packs: [] }
      for (const p of patch.packs || cur.packs) {
        const id = String(p.id || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 24)
        if (!id) continue
        next.packs.push({ id, name: String(p.name || id).slice(0, 60), blurb: String(p.blurb || '').slice(0, 120), credits: Math.max(0, Math.round(+p.credits || 0)), amount: Math.max(0, Math.round(+p.amount || 0)) })
      }
      next.updatedAt = now()
      next.updatedBy = who?.email || null
      await store.meta.set('pricing', next)
      await event('worker', `${who?.email || 'office'} updated the pricing (${next.packs.map((p) => `${p.name} ${money(p.amount, next.currency)}`).join(', ')})`)
      return pricing()
    },

    // a Checkout Session for one pack; the browser is sent to its url
    async checkout(user, packId, origin) {
      if (mode === 'off') throw fail(503, 'payments are not set up yet; ask the office for credits')
      const p = await pricing()
      const pack = p.packs.find((x) => x.id === packId)
      if (!pack) throw fail(404, 'no such pack')
      const base = appUrl || origin
      if (!base) throw fail(400, 'no app URL to return to; set APP_URL')
      let session
      try {
        session = await stripe.checkout.sessions.create({
          mode: 'payment',
          customer_email: user.email,
          client_reference_id: user.id,
          line_items: [{ quantity: 1, price_data: { currency: p.currency, unit_amount: pack.amount, product_data: { name: `Draft House: ${pack.name}`, description: `${pack.credits} change${pack.credits === 1 ? '' : 's'} on your house plans` } } }],
          metadata: { userId: user.id, email: user.email, pack: pack.id, credits: String(pack.credits) },
          success_url: `${base}/?billing=success&session_id={CHECKOUT_SESSION_ID}#/billing`,
          cancel_url: `${base}/?billing=cancel#/billing`,
          allow_promotion_codes: true,
        })
      } catch (e) {
        log(`stripe checkout: ${e.message}`)
        throw fail(502, `Stripe did not accept the checkout: ${e.message}`)
      }
      await event('payment', `${user.email}: checkout started for ${pack.name} (${money(pack.amount, p.currency)})`, { userId: user.id })
      return { url: session.url, id: session.id, pack }
    },

    // the signed webhook body; only a paid checkout.session.completed adds credits, once
    async webhook(rawBody, signature) {
      if (!webhookSecret) throw fail(503, 'STRIPE_WEBHOOK_SECRET is not set')
      let ev
      try {
        ev = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)
      } catch (e) {
        throw fail(400, `webhook signature: ${e.message}`)
      }
      if (ev.type !== 'checkout.session.completed' && ev.type !== 'checkout.session.async_payment_succeeded') return { received: true, ignored: ev.type }
      const s = ev.data.object
      if (s.payment_status !== 'paid') return { received: true, ignored: `payment_status ${s.payment_status}` }
      const userId = s.metadata?.userId || s.client_reference_id
      const credits = +(s.metadata?.credits || 0)
      if (!userId || !credits) {
        log(`webhook: session ${s.id} without userId/credits metadata`)
        return { received: true, ignored: 'no metadata' }
      }
      let receiptUrl = null
      if (mode !== 'off' && s.payment_intent) {
        try {
          const pi = await stripe.paymentIntents.retrieve(String(s.payment_intent), { expand: ['latest_charge'] })
          receiptUrl = pi.latest_charge?.receipt_url || null
        } catch (e) {
          log(`webhook: no receipt url (${e.message})`)
        }
      }
      const pay = { id: s.id, userId, email: s.metadata?.email || s.customer_details?.email || null, pack: s.metadata?.pack || null, credits, amount: s.amount_total || 0, currency: s.currency || 'usd', status: 'paid', receiptUrl, paymentIntent: s.payment_intent || null, at: now(), livemode: !!ev.livemode }
      const added = await record(pay)
      return { received: true, credited: !!added, credits: added ? credits : 0, duplicate: !added }
    },

    // after the redirect: what did this session buy, and has the webhook landed yet?
    async session(user, id) {
      const pay = await store.payments.get(id)
      if (pay) {
        if (pay.userId !== user.id) throw fail(404, 'not your session')
        return { paid: true, credited: true, pay }
      }
      if (mode === 'off') return { paid: false, credited: false }
      try {
        const s = await stripe.checkout.sessions.retrieve(id)
        if ((s.metadata?.userId || s.client_reference_id) !== user.id) throw fail(404, 'not your session')
        return { paid: s.payment_status === 'paid', credited: false, pack: s.metadata?.pack, credits: +(s.metadata?.credits || 0), amount: s.amount_total, currency: s.currency }
      } catch (e) {
        if (e.status) throw e
        throw fail(502, `Stripe: ${e.message}`)
      }
    },

    async history(user) {
      return store.payments.listForUser(user.id)
    },

    // the office gives credits (comp, support, a phone order)
    async grant(admin, userId, credits, note) {
      const n = Math.round(+credits)
      if (!n || Math.abs(n) > 500) throw fail(400, 'credits must be between -500 and 500')
      const u = await store.users.get(userId)
      if (!u) throw fail(404, 'no such account')
      const pay = { id: `grant_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`, userId, email: u.email, pack: null, credits: n, amount: 0, currency: 'usd', status: 'granted', receiptUrl: null, note: String(note || '').slice(0, 200), by: admin.email, at: now() }
      await record(pay)
      return store.users.get(userId)
    },
  }
}
