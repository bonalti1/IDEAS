import { useState } from 'react'
import { Button, Mark } from '../ui.jsx'

export default function Start({ onNext }) {
  const [address, setAddress] = useState('')
  const [name, setName] = useState('')
  const [file, setFile] = useState(null)
  const ready = address.trim().length > 4 || file

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

      <div className="card start-card">
        <label className="field">
          <span>Your name</span>
          <input placeholder="First and last name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label className="field">
          <span>Where is the lot?</span>
          <input
            placeholder="Street address, or lot and subdivision"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
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
        <Button primary disabled={!ready} onClick={() => onNext({ address: address || 'Lot 514, Villa-Rama East Phase V', file, client: name.trim() || 'Client' })}>
          Find my lot
        </Button>
        <p className="fine">We read the plat, pull the city setbacks, and draw your buildable area. Nothing is sent to a drafter yet.</p>
      </div>
    </div>
  )
}
