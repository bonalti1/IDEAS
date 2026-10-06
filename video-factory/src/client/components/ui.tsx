import type { ReactNode } from 'react'
import type { ClipReview, GateResult, ImageReview, Job, ProviderInfo, Verdict } from '../../shared/types.ts'

export function Button(p: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  kind?: 'primary' | 'approve' | 'danger' | 'ghost'
  title?: string
  gate?: GateResult
  busy?: boolean
  type?: 'button' | 'submit'
}) {
  const blocked = p.gate && !p.gate.ok
  return (
    <button
      type={p.type ?? 'button'}
      className={`btn ${p.kind ?? ''}`}
      onClick={p.onClick}
      disabled={p.disabled || blocked || p.busy}
      title={blocked ? (p.gate as { reason: string }).reason : p.title}
    >
      {p.children}
    </button>
  )
}

export function GateNote({ gate }: { gate: GateResult }) {
  if (gate.ok) return null
  return <p className="gate">🔒 {gate.reason}</p>
}

const VERDICT_LABEL: Record<Verdict, string> = { pass: 'Pass', warn: 'Check', fail: 'Fail' }

export function VerdictBadge({ verdict, score }: { verdict: Verdict; score?: number }) {
  return (
    <span className={`badge v-${verdict}`}>
      {VERDICT_LABEL[verdict]}
      {score !== undefined ? ` · ${Math.round(score)}` : ''}
    </span>
  )
}

export function Chip({ children, tone }: { children: ReactNode; tone?: 'ok' | 'warn' | 'muted' | 'fake' | 'info' }) {
  return <span className={`chip ${tone ?? ''}`}>{children}</span>
}

function Check({ label, c }: { label: string; c: { ok: boolean; notes: string } }) {
  return (
    <li className={c.ok ? 'ok' : 'bad'}>
      <strong>{c.ok ? '✓' : '✗'} {label}</strong> {c.notes}
    </li>
  )
}

export function ImageReviewView({ r, error }: { r: ImageReview | null; error: string | null }) {
  if (error) return <p className="err small">Review failed: {error}</p>
  if (!r) return <p className="muted small">Review pending…</p>
  return (
    <div className="review">
      <div className="review-head">
        <VerdictBadge verdict={r.verdict} score={r.score} />
        <span className="muted small">
          {r.reviewer.provider} · {r.reviewer.model}
        </span>
      </div>
      <p className="small">{r.summary}</p>
      <ul className="checks">
        <Check label="Stage present" c={r.stagePresent} />
        <Check label="Scene unchanged" c={r.sceneConsistent} />
        <Check label="Camera unchanged" c={r.cameraConsistent} />
        <Check label="No artifacts" c={r.artifacts} />
      </ul>
    </div>
  )
}

export function ClipReviewView({ r, error }: { r: ClipReview | null; error: string | null }) {
  if (error) return <p className="err small">Review failed: {error}</p>
  if (!r) return <p className="muted small">Review pending…</p>
  return (
    <div className="review">
      <div className="review-head">
        <VerdictBadge verdict={r.verdict} score={r.score} />
        <span className="muted small">
          {r.reviewer.provider} · {r.reviewer.model}
        </span>
      </div>
      <p className="small">{r.summary}</p>
      <ul className="checks">
        <Check label="Starts on approved frame" c={r.startMatches} />
        <Check label="Ends on approved frame" c={r.endMatches} />
        <Check label="Scene stable" c={r.sceneConsistent} />
        <Check label="No artifacts" c={r.artifacts} />
      </ul>
    </div>
  )
}

export function JobLine({ job }: { job: Job }) {
  const pct = Math.round(job.progress * 100)
  return (
    <div className={`job ${job.status}`}>
      <span className="job-type">{job.type.replace(/_/g, ' ')}</span>
      {job.status === 'failed' ? (
        <span className="err small">{job.error}</span>
      ) : (
        <>
          <span className="bar">
            <span style={{ width: `${Math.max(4, pct)}%` }} />
          </span>
          <span className="muted small">{job.message}</span>
        </>
      )}
    </div>
  )
}

export function ProviderPicker(p: {
  providers: ProviderInfo[]
  value: string[]
  onChange: (ids: string[]) => void
}) {
  return (
    <div className="providers">
      {p.providers.map((pr) => (
        <label key={pr.id} className="provider">
          <input
            type="checkbox"
            checked={p.value.includes(pr.id)}
            onChange={(e) => p.onChange(e.target.checked ? [...p.value, pr.id] : p.value.filter((x) => x !== pr.id))}
          />
          <span>
            {pr.label}
            {pr.primary ? <Chip tone="info">primary</Chip> : null}
          </span>
          <span className="muted small mono">{pr.model}</span>
        </label>
      ))}
    </div>
  )
}

export function Spinner() {
  return <span className="spinner" aria-label="working" />
}

export const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean)
