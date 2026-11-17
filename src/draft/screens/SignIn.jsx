// Email sign-in card. Local mode signs in at once; Supabase mode emails a link.
import { useState } from 'react'
import { Button } from '../ui.jsx'
import { AUTH_MODE, signIn } from '../lib/auth.js'

export default function SignIn({ title = 'Sign in', lede, askName = true, onSignedIn, onSkip }) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const valid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())

  const go = async (e) => {
    e?.preventDefault()
    if (busy) return
    if (!valid) {
      setError(email.trim() ? 'That email does not look right. Check it and try again.' : 'Enter your email to continue.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const res = await signIn(email.trim(), name.trim())
      if (res.sent) setSent(true)
      else onSignedIn?.(res.user)
    } catch (err) {
      setError(/sign in|401|403|404/i.test(err.message) ? err.message : 'Could not reach the office. Check the connection and try again.')
    }
    setBusy(false)
  }

  if (sent)
    return (
      <div className="card signin">
        <h3>Check your email</h3>
        <p className="muted small">We sent a sign-in link to <b>{email}</b>. Open it on this device and you are in. No password to remember.</p>
        <button className="linkish" onClick={() => setSent(false)}>
          Use another email
        </button>
      </div>
    )

  return (
    <form className="card signin" onSubmit={go} noValidate>
      <h3>{title}</h3>
      {lede && <p className="muted small">{lede}</p>}
      {askName && (
        <label className="field">
          <span>Your name</span>
          <input id="signin-name" placeholder="First and last name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </label>
      )}
      <label className="field">
        <span>Email</span>
        <input
          id="signin-email"
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            if (error) setError('')
          }}
          autoComplete="email"
          autoFocus={!askName}
        />
      </label>
      {error && <p className="fine bad">{error}</p>}
      <Button primary type="submit" disabled={busy}>
        {busy ? 'One moment…' : AUTH_MODE === 'local' ? 'Continue' : 'Email me a sign-in link'}
      </Button>
      {onSkip && (
        <Button type="button" ghost onClick={onSkip}>
          Try it without an account
        </Button>
      )}
    </form>
  )
}
