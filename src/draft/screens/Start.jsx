import { useState } from 'react'
import { Button, Mark } from '../ui.jsx'
import SignIn from './SignIn.jsx'
import { STATUS } from '../lib/status.js'
import TrustBlock from '../TrustBlock.jsx'

const ago = (iso) => {
  const d = (Date.now() - Date.parse(iso)) / 60000
  return d < 60 ? `${Math.max(1, Math.round(d))} min ago` : d < 1440 ? `${Math.round(d / 60)} h ago` : `${Math.round(d / 1440)} d ago`
}

export default function Start({ user, projects = [], onSignedIn, onSkip, onResume, onNext }) {
  const [address, setAddress] = useState('')
  const [name, setName] = useState(user?.name || '')
  const [file, setFile] = useState(null)
  const [guest, setGuest] = useState(false)
  // a street address (number, street, city) or a lot and subdivision; anything shorter gets a hint
  const a = address.trim()
  const looksLikeAddress = (/\d/.test(a) && /\s/.test(a) && a.length >= 8) || /\blot\b/i.test(a)
  const ready = looksLikeAddress || !!file
  const hint = a && !looksLikeAddress && !file ? (a.length < 8 ? 'Type the full street address with the city, like 1300 W Nolana Ave, McAllen, TX.' : 'Add the street number and the city, like 1300 W Nolana Ave, McAllen, TX. Or upload the plat.') : ''
  const canStart = !!user || guest

  return (
    <div className="screen start">
      <div className="hero">
        <Mark size={64} />
        <h1 className="wordmark-text">
          <span>Draft</span>
          <i className="rule" />
          <span>House</span>
        </h1>
        <p className="lede">Your lot. Your style. A real house plan in minutes, finished by our drafters.</p>
      </div>
      <TrustBlock compact />

      {!canStart && (
        <div className="preview" aria-label="What you get">
          <figure>
            <img src="/preview/house.jpg" alt="A farmhouse drafted in 3D on its lot" loading="lazy" />
            <figcaption>Your house on your lot, in 3D</figcaption>
          </figure>
          <figure>
            <img src="/preview/plan.jpg" alt="The floor plan drawn on the lot, with the space the city keeps open along its edges" loading="lazy" />
            <figcaption>A real floor plan you change by chatting</figcaption>
          </figure>
        </div>
      )}
      {!canStart && <p className="fine credits-line">Your first draft and 10 changes come with every plan. Need more? The office adds them.</p>}

      {!canStart && user !== undefined && (
        <SignIn
          title="Start with your email"
          lede="Your house and every change are saved to it, on any device."
          onSignedIn={onSignedIn}
          onSkip={
            onSkip &&
            (() => {
              setGuest(true)
              onSkip()
            })
          }
        />
      )}

      {user && projects.length > 0 && (
        <div className="card start-card houses">
          <h3>Your houses</h3>
          <ul className="houses-list">
            {projects.map((p) => (
              <li key={p.id}>
                <button className="house" onClick={() => onResume(p.id)}>
                  <span className="house-main">
                    <b>{p.style?.name || (p.address ? String(p.address).split(',')[0] : 'Your lot')}</b>
                    <span className="muted small">{p.address || 'lot to be set'} · {ago(p.updatedAt)}</span>
                  </span>
                  {/* a lot saved before any rooms were chosen (round 12, item B), or one sent to the drafter for a custom design (item A) */}
                  {p.needsCustom ? (
                    <span className="pill wait" data-testid="house-custom">With a drafter: a design for your lot</span>
                  ) : !p.version ? (
                    <span className="pill" data-testid="house-lot-only">Lot saved, rooms not chosen yet</span>
                  ) : (
                    <span className={'pill ' + STATUS[p.status]?.tone}>{STATUS[p.status]?.label}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {canStart && (
        <div className="card start-card">
          <h3>{projects.length ? 'Start another house' : 'Where is the lot?'}</h3>
          {!user?.name && (
            <label className="field">
              <span>Your name</span>
              <input placeholder="First and last name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </label>
          )}
          <label className="field">
            <span>Address</span>
            <input id="start-address" placeholder="Street address, or lot and subdivision" value={address} onChange={(e) => setAddress(e.target.value)} aria-describedby="start-address-hint" />
          </label>
          {hint && (
            <p id="start-address-hint" className="fine warn" style={{ marginTop: -6 }}>
              {hint}
            </p>
          )}
          <div className="or">or</div>
          <label className={'drop' + (file ? ' has-file' : '')}>
            <input type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={(e) => setFile(e.target.files?.[0] || null)} hidden />
            {file ? (
              <span>
                <b>{file.name}</b> · ready to read
              </span>
            ) : (
              <span>
                <b>Upload the survey or plat</b> · PDF or photo
              </span>
            )}
          </label>
          <Button primary disabled={!ready} onClick={() => onNext({ address: address || 'Lot 514, Villa-Rama East Phase V', file, client: (name || user?.name || '').trim() || user?.email || 'Client' })}>
            Find my lot
          </Button>
          <p className="fine">We read the plat, look up the city's rules, and draw the space you can build on. Nothing is sent to a drafter yet.{!user && ' Without an account, nothing is saved when you close this page.'}</p>
        </div>
      )}
    </div>
  )
}
