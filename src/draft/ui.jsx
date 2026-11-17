// Small shared UI pieces for the Draft House flow.
export function Mark({ size = 28 }) {
  return <img src="/brand/mark.svg" alt="" style={{ height: size, width: 'auto', display: 'block' }} />
}

export function Button({ children, primary, ghost, small, ...rest }) {
  const cls = ['btn', primary && 'btn-primary', ghost && 'btn-ghost', small && 'btn-small'].filter(Boolean).join(' ')
  return (
    <button className={cls} {...rest}>
      {children}
    </button>
  )
}

export function Stepper({ label, value, min, max, onChange, suffix = '' }) {
  return (
    <div className="stepper">
      <span className="stepper-label">{label}</span>
      <div className="stepper-ctl">
        <button onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label={`Fewer ${label}`}>
          −
        </button>
        <span className="stepper-val">
          {value}
          {suffix}
        </span>
        <button onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label={`More ${label}`}>
          +
        </button>
      </div>
    </div>
  )
}

export function Stat({ k, v, muted }) {
  return (
    <div className={'stat' + (muted ? ' muted' : '')}>
      <span className="stat-k">{k}</span>
      <span className="stat-v">{v}</span>
    </div>
  )
}

export const money = (n) => '$' + Math.round(n).toLocaleString()
export const sf = (n) => Math.round(n).toLocaleString() + ' sf'

/** Line-art roof silhouette for a style card. Brown stroke, no fill. */
export function RoofIcon({ roof }) {
  const paths = {
    flat: 'M6 40 H74 M10 40 V22 H44 V12 H70 V40',
    gable: 'M6 40 H74 M12 40 V26 L40 8 L68 26 V40 M26 40 V32 H34 V40',
    hip: 'M6 40 H74 M10 40 V24 L24 12 H56 L70 24 V40 M10 24 H70',
    shed: 'M6 40 H74 M12 40 V26 L68 14 V40 M50 20 V14 H58',
  }
  return (
    <svg viewBox="0 0 80 48" className="roof" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round">
      <path d={paths[roof] || paths.gable} />
    </svg>
  )
}
