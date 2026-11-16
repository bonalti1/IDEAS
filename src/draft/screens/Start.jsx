import { useState } from 'react'
import { Button, Mark } from '../ui.jsx'
import SignIn from './SignIn.jsx'
import { STATUS } from '../lib/status.js'

const ago = (iso) => {
  const d = (Date.now() - Date.parse(iso)) / 60000
  return d < 60 ? `${Math.max(1, Math.round(d))} min ago` : d < 1440 ? `${Math.round(d / 60)} h ago` : `${Math.round(d / 1440)} d ago`
}

export default function Start({ user, projects = [], onSignedIn, onSkip, onResume, onNext }) {
  const [address, setAddress] = useState('')
  const [name, setName] = useState(user?.name || '')
  const [file, setFile] = useState(null)
  const [guest, setGuest] = useState(false)
  const ready = address.trim().length > 4 || file
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

      {!canStart && user !== undefined && (
        <SignIn
          title="Start with your email"
          lede="Your house, every change and your credits are saved to it, on any device."
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
                    <b>{p.style?.name}</b>
                    <span className="muted small">{p.address || 'lot to be set'} · {ago(p.updatedAt)}</span>
                  </span>
                  <span className={'pill ' + STATUS[p.status]?.tone}>{STATUS[p.status]?.label}</span>
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
            <input id="start-address" placeholder="Street address, or lot and subdivision" value={address} onChange={(e) => setAddress(e.target.value)} />
          </label>
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
          <p className="fine">We read the plat, pull the city setbacks, and draw your buildable area. Nothing is sent to a drafter yet.{!user && ' Without an account, nothing is saved when you close this page.'}</p>
        </div>
      )}
    </div>
  )
}
