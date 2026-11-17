// Who stands behind the plans: the team line, the drafter, the code check, what happens next, and
// a link to built homes. On the welcome screen (compact) and on the Send screen (full).
import { TRUST, monogram } from './lib/trust.js'

export default function TrustBlock({ compact = false }) {
  const d = TRUST.drafter
  return (
    <div className={'trust' + (compact ? ' compact' : '')}>
      <div className="trust-head">
        {d.photo ? <img className="trust-photo" src={d.photo} alt={d.name} /> : <span className="trust-photo mono" aria-hidden="true">{monogram(d.name)}</span>}
        <div>
          <b>{TRUST.team}</b>
          <span className="muted small">
            {d.name}
            {d.placeholder ? '' : ''} · {d.title}
          </span>
        </div>
      </div>
      <p className="small">{TRUST.checked}</p>
      {!compact && (
        <ol className="trust-next">
          {TRUST.next.map((n) => (
            <li key={n.when}>
              <b>{n.when}</b>
              <span>{n.what}</span>
            </li>
          ))}
        </ol>
      )}
      <a className="small" href={TRUST.builtHomes.url} target="_blank" rel="noreferrer">
        {TRUST.builtHomes.label} →
      </a>
    </div>
  )
}
