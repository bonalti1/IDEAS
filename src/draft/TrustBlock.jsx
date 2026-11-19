// Who stands behind the plans: the team line, the drafter, the code check, what happens next, and
// a link to built homes. On the welcome screen (compact) and on the Send screen (full).
import { useState } from 'react'
import { TRUST, CHECKED, monogram } from './lib/trust.js'
import { CHECK_GROUPS } from './lib/audit.js'
import { useLang } from './lib/i18n.js'

export default function TrustBlock({ compact = false }) {
  const d = TRUST.drafter
  // the photo shows only once Rolando OKs it (placeholder off) and the file is in public/team/; the monogram otherwise
  const [photoOk, setPhotoOk] = useState(true)
  const { t } = useLang()
  const showName = d.placeholder ? t(d.placeholderName || 'The STB design team') : d.name
  return (
    <div className={'trust' + (compact ? ' compact' : '')}>
      <div className="trust-head">
        {d.photo && !d.placeholder && photoOk ? <img className="trust-photo" src={d.photo} alt={d.name} onError={() => setPhotoOk(false)} /> : <span className="trust-photo mono" aria-hidden="true">{d.placeholder ? 'STB' : monogram(d.name)}</span>}
        <div>
          <b>{t(TRUST.team)}</b>
          <span className="muted small">
            {showName} · {t(d.title)}
          </span>
        </div>
      </div>
      <p className="small">{t(CHECKED, { count: CHECK_GROUPS.length })}</p>
      {!compact && (
        <ol className="trust-next">
          {TRUST.next.map((n) => (
            <li key={n.when}>
              <b>{t(n.when)}</b>
              <span>{t(n.what)}</span>
            </li>
          ))}
        </ol>
      )}
      <a className="small" href={TRUST.builtHomes.url} target="_blank" rel="noreferrer">
        {t(TRUST.builtHomes.label)} →
      </a>
    </div>
  )
}
