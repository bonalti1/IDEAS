import { useState, type ReactNode } from 'react'
import type { ClipReview, ImageReview, ProviderInfo } from '../../shared/types.ts'

export function Btn(p: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  kind?: 'primary' | 'danger'
  big?: boolean
  title?: string
  type?: 'button' | 'submit'
}) {
  return (
    <button type={p.type ?? 'button'} className={`btn ${p.kind ?? ''} ${p.big ? 'big' : ''}`} onClick={p.onClick} disabled={p.disabled} title={p.title}>
      {p.children}
    </button>
  )
}

export function LinkBtn(p: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="link" onClick={p.onClick} disabled={p.disabled}>
      {p.children}
    </button>
  )
}

export function Working({ children }: { children: ReactNode }) {
  return (
    <div className="working" role="status">
      <span className="spinner" />
      <span>{children}</span>
    </div>
  )
}

export function Screen({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <section className="screen">
      <div className="screen-head">
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children}
    </section>
  )
}

export function DoneBanner({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="done-banner">
      <span>✓</span>
      <span className="grow">{children}</span>
      {action}
    </div>
  )
}

const VERDICT = { pass: 'Looks good', warn: 'Check closely', fail: 'Problems found' } as const

/** Compact AI quality check; click to see what the reviewer looked at. */
export function AiCheck({ review, error, kind }: { review: ImageReview | ClipReview | null; error: string | null; kind: 'image' | 'clip' }) {
  const [open, setOpen] = useState(false)
  if (error) return <span className="aicheck warn" title={error}>AI check unavailable</span>
  if (!review) return <span className="aicheck pending">AI checking…</span>
  const rows =
    kind === 'image'
      ? [
          ['Shows the right stage', (review as ImageReview).stagePresent],
          ['Rest of the scene unchanged', (review as ImageReview).sceneConsistent],
          ['Same camera angle', (review as ImageReview).cameraConsistent],
          ['No glitches', review.artifacts],
        ]
      : [
          ['Starts on the right picture', (review as ClipReview).startMatches],
          ['Ends on the right picture', (review as ClipReview).endMatches],
          ['Background stays steady', review.sceneConsistent],
          ['No glitches', review.artifacts],
        ]
  return (
    <div>
      <button type="button" className={`aicheck ${review.verdict}`} onClick={() => setOpen(!open)} aria-expanded={open}>
        {review.verdict === 'pass' ? '✓' : '!'} AI check: {VERDICT[review.verdict]}
      </button>
      {open && (
        <>
          <ul className="check-list">
            {rows.map(([label, c]) => {
              const r = c as { ok: boolean; notes: string }
              return (
                <li key={label as string} className={r.ok ? 'good' : 'bad'}>
                  <b>{r.ok ? '✓' : '✗'} {label as string}</b> <span className="muted">{r.notes}</span>
                </li>
              )
            })}
          </ul>
          <p className="tiny muted" style={{ marginTop: 6 }}>
            Score {Math.round(review.score)} · {review.reviewer.model}
          </p>
        </>
      )}
    </div>
  )
}

export function ProviderChips({ providers, value, onChange, label }: { providers: ProviderInfo[]; value: string[]; onChange: (v: string[]) => void; label: string }) {
  if (providers.length < 2) return null
  return (
    <div className="chips">
      <span className="muted small">{label}</span>
      {providers.map((p) => {
        const on = value.includes(p.id)
        return (
          <button
            key={p.id}
            type="button"
            className={`chip-toggle ${on ? 'on' : ''}`}
            onClick={() => onChange(on ? value.filter((x) => x !== p.id) : [...value, p.id])}
            title={p.model}
          >
            {shortName(p.label)}
          </button>
        )
      })}
    </div>
  )
}

/** "Gemini Nano Banana Pro (fake)" → "Gemini" etc. — full name stays in the tooltip. */
export function shortName(label: string) {
  const l = label.replace(/\s*\(.*?\)\s*/g, ' ').trim()
  if (/gemini/i.test(l)) return 'Google Gemini'
  if (/gpt image|openai/i.test(l)) return 'OpenAI'
  if (/veo/i.test(l)) return 'Google Veo'
  if (/kling/i.test(l)) return 'Kling'
  if (/seedance/i.test(l)) return 'Seedance'
  return l
}

export const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean)
