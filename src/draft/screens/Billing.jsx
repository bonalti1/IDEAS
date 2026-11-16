// Billing: the credit balance, the packs to buy through Stripe Checkout, and every payment with its receipt.
import { useEffect, useState } from 'react'
import { Button, Stat } from '../ui.jsx'
import { api } from '../lib/api.js'

const money = (amount, currency = 'usd') => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format((amount || 0) / 100)
const when = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

export default function Billing({ user, onCredits }) {
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [outcome, setOutcome] = useState(null) // after the Stripe redirect

  const load = async () => {
    try {
      const d = await api.billing()
      setData(d)
      onCredits?.(d.credits)
    } catch (e) {
      setError(e.message)
    }
  }
  useEffect(() => {
    load()
    // back from Stripe: ?billing=success&session_id=... (the hash router keeps the query on the page)
    const q = new URLSearchParams(window.location.search)
    const status = q.get('billing')
    const sid = q.get('session_id')
    if (status === 'cancel') setOutcome({ cancelled: true })
    if (status === 'success' && sid) {
      let tries = 0
      const poll = async () => {
        try {
          const s = await api.billingSession(sid)
          setOutcome(s)
          if (s.credited) {
            load()
            return
          }
        } catch (e) {
          setOutcome({ error: e.message })
          return
        }
        if (++tries < 10) setTimeout(poll, 2000) // the webhook usually lands within seconds
      }
      poll()
    }
    if (status) window.history.replaceState(null, '', window.location.pathname + window.location.hash)
  }, [])

  const buy = async (pack) => {
    setBusy(pack.id)
    setError('')
    try {
      const { url } = await api.checkout(pack.id)
      window.location.href = url
    } catch (e) {
      setError(e.message)
      setBusy('')
    }
  }

  return (
    <div className="screen padded narrow billing">
      <div className="screen-head">
        <h2>Changes and billing</h2>
        <p className="muted">Each change you apply to a house uses one credit. Credits stay on your account across every house and never expire.</p>
      </div>
      {outcome?.credited && (
        <div className="card note good">
          <h3>Thank you</h3>
          <p>
            {outcome.pay?.credits} credit{outcome.pay?.credits === 1 ? '' : 's'} added{outcome.pay?.amount ? ` for ${money(outcome.pay.amount, outcome.pay.currency)}` : ''}.
            {outcome.pay?.receiptUrl && (
              <>
                {' '}
                <a href={outcome.pay.receiptUrl} target="_blank" rel="noreferrer">
                  Receipt
                </a>
              </>
            )}
          </p>
        </div>
      )}
      {outcome && !outcome.credited && outcome.paid && (
        <div className="card note">
          <h3>Payment received</h3>
          <p>Stripe confirmed the payment. The credits appear here within a few seconds; if they do not, the office has your payment on file and will add them.</p>
        </div>
      )}
      {outcome?.cancelled && (
        <div className="card note">
          <p>Checkout was cancelled. Nothing was charged.</p>
        </div>
      )}
      {outcome?.error && <p className="fine bad">{outcome.error}</p>}

      <div className="card stats">
        <Stat k="Signed in as" v={user?.email} />
        <Stat k="Credits on your account" v={data ? `${data.credits} change${data.credits === 1 ? '' : 's'}` : '…'} />
      </div>

      <div className="card">
        <h3>Buy changes</h3>
        {data?.mode === 'off' && <p className="muted small">Online payment is not switched on yet. Call the office and they add credits to your account.</p>}
        {data?.pricing?.placeholder && <p className="fine warn">Prices shown are placeholders until the office sets them.</p>}
        <div className="packs">
          {(data?.pricing?.packs || []).map((p) => (
            <div key={p.id} className="pack">
              <div className="pack-head">
                <b>{p.name}</b>
                <span className="pack-price">{money(p.amount, data.pricing.currency)}</span>
              </div>
              <p className="muted small">
                {p.credits} change{p.credits === 1 ? '' : 's'}
                {p.blurb ? ` · ${p.blurb}` : ''}
              </p>
              <Button small primary disabled={!!busy || data?.mode === 'off'} onClick={() => buy(p)}>
                {busy === p.id ? 'Opening checkout…' : 'Buy'}
              </Button>
            </div>
          ))}
        </div>
        {error && <p className="fine bad">{error}</p>}
        <p className="fine">Payments are handled by Stripe. Card details never touch our servers. {data?.mode === 'test' ? 'Test mode: use card 4242 4242 4242 4242 with any future date.' : ''}</p>
      </div>

      <div className="card">
        <h3>Payments</h3>
        {!data?.history?.length ? (
          <p className="muted small">None yet.</p>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Date</th>
                <th>What</th>
                <th>Credits</th>
                <th>Amount</th>
                <th>Receipt</th>
              </tr>
            </thead>
            <tbody>
              {data.history.map((h) => (
                <tr key={h.id}>
                  <td>{when(h.at)}</td>
                  <td>{h.status === 'granted' ? `Added by the office${h.note ? `: ${h.note}` : ''}` : (data.pricing.packs.find((p) => p.id === h.pack) || {}).name || h.pack || 'Purchase'}</td>
                  <td>{h.credits > 0 ? '+' : ''}{h.credits}</td>
                  <td>{h.amount ? money(h.amount, h.currency) : '—'}</td>
                  <td>
                    {h.receiptUrl ? (
                      <a href={h.receiptUrl} target="_blank" rel="noreferrer">
                        receipt
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="fine">
        <a href="#">Back to your houses</a>
      </p>
    </div>
  )
}
