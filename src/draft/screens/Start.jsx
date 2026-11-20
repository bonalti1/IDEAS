import { useState } from 'react'
import { Button, Mark } from '../ui.jsx'
import SignIn from './SignIn.jsx'
import { STATUS } from '../lib/status.js'
import TrustBlock from '../TrustBlock.jsx'
import { useLang } from '../lib/i18n.js'

const ago = (iso, t) => {
  const d = (Date.now() - Date.parse(iso)) / 60000
  return d < 60 ? t('{n} min ago', { n: Math.max(1, Math.round(d)) }) : d < 1440 ? t('{n} h ago', { n: Math.round(d / 60) }) : t('{n} d ago', { n: Math.round(d / 1440) })
}

export default function Start({ user, projects = [], onSignedIn, onSkip, onResume, onNext }) {
  const [address, setAddress] = useState('')
  const [name, setName] = useState(user?.name || '')
  const [file, setFile] = useState(null)
  const [guest, setGuest] = useState(false)
  const { t } = useLang()
  // a street address (number, street, city) or a lot and subdivision; anything shorter gets a hint
  const a = address.trim()
  const looksLikeAddress = (/\d/.test(a) && /\s/.test(a) && a.length >= 8) || /\blot\b/i.test(a)
  const ready = looksLikeAddress || !!file
  const hint = a && !looksLikeAddress && !file ? (a.length < 8 ? t('Type the full street address with the city, like 1300 W Nolana Ave, McAllen, TX.') : t('Add the street number and the city, like 1300 W Nolana Ave, McAllen, TX. Or upload the plat.')) : ''
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
        <p className="lede">{t('Your lot. Your style. A real house plan in minutes, finished by our drafters.')}</p>
      </div>
      <TrustBlock compact />

      {!canStart && (
        <div className="preview" aria-label={t('What you get')}>
          <figure>
            <img src="/preview/house.jpg" alt={t('A farmhouse drafted in 3D on its lot')} loading="lazy" />
            <figcaption>{t('Your house on your lot, in 3D')}</figcaption>
          </figure>
          <figure>
            <img src="/preview/plan.jpg" alt={t('The floor plan drawn on the lot, with the space the city keeps open along its edges')} loading="lazy" />
            <figcaption>{t('A real floor plan you change by chatting')}</figcaption>
          </figure>
        </div>
      )}
      {!canStart && <p className="fine credits-line">{t('Your first draft and 10 changes come with every plan. Need more? The office adds them.')}</p>}

      {!canStart && user !== undefined && (
        <SignIn
          title={t('Start with your email')}
          lede={t('Your house and every change are saved to it, on any device.')}
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
          <h3>{t('Your houses')}</h3>
          <ul className="houses-list">
            {projects.map((p) => (
              <li key={p.id}>
                <button className="house" onClick={() => onResume(p.id)}>
                  <span className="house-main">
                    <b>{t(p.style?.name) || (p.address ? String(p.address).split(',')[0] : t('Your lot'))}</b>
                    <span className="muted small">{p.address || t('lot to be set')} · {ago(p.updatedAt, t)}</span>
                  </span>
                  {/* a lot saved before any rooms were chosen (round 12, item B), or one sent to the drafter for a custom design (item A) */}
                  {p.needsCustom ? (
                    <span className="pill wait" data-testid="house-custom">{t('With a drafter: a design for your lot')}</span>
                  ) : !p.version && !p.lot ? (
                    <span className="pill" data-testid="house-address-only">{t('Address saved, lot not chosen yet')}</span>
                  ) : !p.version ? (
                    <span className="pill" data-testid="house-lot-only">{t('Lot saved, rooms not chosen yet')}</span>
                  ) : (
                    <span className={'pill ' + STATUS[p.status]?.tone}>{t(STATUS[p.status]?.label)}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {canStart && (
        <div className="card start-card">
          <h3>{projects.length ? t('Start another house') : t('Where is the lot?')}</h3>
          {!user?.name && (
            <label className="field">
              <span>{t('Your name')}</span>
              <input placeholder={t('First and last name')} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </label>
          )}
          <label className="field">
            <span>{t('Address')}</span>
            <input id="start-address" placeholder={t('Street address, or lot and subdivision')} value={address} onChange={(e) => setAddress(e.target.value)} aria-describedby="start-address-hint" />
          </label>
          {hint && (
            <p id="start-address-hint" className="fine warn" style={{ marginTop: -6 }}>
              {hint}
            </p>
          )}
          <div className="or">{t('or')}</div>
          <label className={'drop' + (file ? ' has-file' : '')}>
            <input type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={(e) => setFile(e.target.files?.[0] || null)} hidden />
            {file ? (
              <span>
                <b>{file.name}</b> · {t('ready to read')}
              </span>
            ) : (
              <span>
                <b>{t('Upload the survey or plat')}</b> · {t('PDF or photo')}
              </span>
            )}
          </label>
          {file && !a && <p className="fine" data-testid="start-file-only">{t('Add the address too if the lot has one. With it we find the lot on the county map and check the flood map.')}</p>}
          <Button primary disabled={!ready} onClick={() => onNext({ address: a, file, client: (name || user?.name || '').trim() || user?.email || 'Client' })}>
            {t('Find my lot')}
          </Button>
          <p className="fine">{t("We read the plat, look up the city's rules, and draw the space you can build on. Nothing is sent to a drafter yet.")}{!user && ` ${t('Without an account, nothing is saved when you close this page.')}`}</p>
        </div>
      )}
    </div>
  )
}
