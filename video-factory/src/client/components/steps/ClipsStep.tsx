import { useEffect, useState } from 'react'
import { transitionsCurrent } from '../../../shared/gates.ts'
import type { Transition } from '../../../shared/types.ts'
import { AiCheck, Btn, DoneBanner, LinkBtn, ProviderChips, Screen, shortName } from '../ui.tsx'
import type { StepProps } from './props.ts'

export function ClipsStep(props: StepProps) {
  const { ctl, v, next } = props
  const ready = transitionsCurrent(v)
  const allApproved = ready && v.transitions.every((t) => t.approvedTakeId)
  const nothingYet = ready && v.takes.length === 0

  const animateAll = async () => {
    for (const t of v.transitions) await ctl.act('POST', `/transitions/${t.id}/takes`, {})
  }

  return (
    <Screen title="Bring it to life" subtitle="Each clip moves smoothly from one approved picture to the next. Approve each one, or try again just the one you don't like.">
      {!ready && (
        <div className="actions">
          <Btn kind="primary" big onClick={() => ctl.act('POST', '/transitions/prepare')} disabled={ctl.busy || !v.gates.prepareTransitions.ok}>
            Get clips ready
          </Btn>
        </div>
      )}
      {nothingYet && (
        <div className="actions" style={{ marginTop: 0, marginBottom: 22 }}>
          <Btn kind="primary" big onClick={animateAll} disabled={ctl.busy}>
            Animate all {v.transitions.length} clips
          </Btn>
          <span className="muted small">Takes a few minutes. You can leave this page open.</span>
        </div>
      )}
      {allApproved && (
        <div style={{ marginBottom: 18 }}>
          <DoneBanner action={<Btn kind="primary" onClick={next}>Next: make the video →</Btn>}>All clips approved</DoneBanner>
        </div>
      )}
      {ready && (
        <div className="clips">
          {v.transitions.map((t) => (
            <Clip key={t.id} {...props} t={t} />
          ))}
        </div>
      )}
    </Screen>
  )
}

function Clip({ ctl, v, config, t }: StepProps & { t: Transition }) {
  const videoProviders = config.providers.filter((p) => p.kind === 'video')
  const takes = v.takes.filter((k) => k.transitionId === t.id)
  const [shownId, setShownId] = useState<string | null>(null)
  const latest = takes.at(-1)
  useEffect(() => setShownId(null), [latest?.id])
  const shown = takes.find((k) => k.id === (shownId ?? t.approvedTakeId)) ?? latest
  const [providers, setProviders] = useState(() => videoProviders.filter((p) => p.primary).map((p) => p.id))
  const [prompt, setPrompt] = useState(t.prompt)
  const [secs, setSecs] = useState(t.durationSec)
  useEffect(() => setPrompt(t.prompt), [t.prompt])
  const job = shown && v.jobs.find((j) => j.id === shown.jobId)
  const from = t.fromStageId ? v.stages.find((s) => s.id === t.fromStageId)!.title : 'Today'
  const to = v.stages.find((s) => s.id === t.toStageId)!.title
  const approved = !!t.approvedTakeId

  const tryAgain = async () => {
    if ((prompt !== t.prompt || secs !== t.durationSec) && !(await ctl.act('PUT', `/transitions/${t.id}`, { prompt, durationSec: secs }))) return
    await ctl.act('POST', `/transitions/${t.id}/takes`, { providers })
  }

  return (
    <div className="clip">
      <div className="pair">
        <img src={v.assetUrls[t.fromAssetId]} alt={from} />
        <span className="arrow">↓</span>
        <img src={v.assetUrls[t.toAssetId]} alt={to} />
      </div>
      <div>
        <h3>
          {t.index + 1}. {from} → {to}
        </h3>
        {!shown && <p className="muted small">Not animated yet.</p>}
        {shown?.status === 'pending' && (
          <div className="ph shimmer">
            <span>{job?.message ?? 'Animating…'}</span>
          </div>
        )}
        {shown?.status === 'failed' && <div className="ph err">This try failed: {shown.error}</div>}
        {shown?.status === 'ready' && (
          <video key={shown.id} src={v.assetUrls[shown.assetId!]} poster={shown.frameAssetIds[0] ? v.assetUrls[shown.frameAssetIds[0]] : undefined} controls loop muted playsInline preload="metadata" />
        )}
        {takes.length > 1 && (
          <div className="chips" style={{ marginTop: 10 }}>
            {takes.map((k, i) => (
              <button key={k.id} className={`chip-toggle ${k.id === shown?.id ? 'on' : ''}`} onClick={() => setShownId(k.id)}>
                Try {i + 1}
                {k.id === t.approvedTakeId ? ' ✓' : ''} · {shortName(videoProviders.find((p) => p.id === k.provider)?.label ?? k.provider)}
              </button>
            ))}
          </div>
        )}
        <div className="clip-foot">
          {shown?.status === 'ready' && <AiCheck review={shown.review} error={shown.reviewError} kind="clip" />}
          <span style={{ flex: 1 }} />
          {approved && shown?.id === t.approvedTakeId ? (
            <>
              <span className="status ok">✓ Approved</span>
              <LinkBtn onClick={() => ctl.act('POST', `/transitions/${t.id}/reopen`)}>Redo</LinkBtn>
            </>
          ) : (
            <>
              {!approved && shown && shown.status !== 'pending' && <LinkBtn onClick={tryAgain} disabled={ctl.busy}>Try again</LinkBtn>}
              {!approved && !shown && (
                <Btn onClick={tryAgain} disabled={ctl.busy}>
                  Animate
                </Btn>
              )}
              {!approved && shown?.status === 'ready' && (
                <Btn kind="primary" onClick={() => ctl.act('POST', `/transitions/${t.id}/approve`, { takeId: shown.id })} disabled={ctl.busy}>
                  Use this clip
                </Btn>
              )}
            </>
          )}
        </div>
        {!approved && (
          <details className="more">
            <summary>More options</summary>
            <label className="field">
              <span>How it should move</span>
              <textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
            </label>
            <div className="row">
              <label className="field" style={{ maxWidth: 140 }}>
                <span>Seconds</span>
                <input type="number" min={2} max={15} value={secs} onChange={(e) => setSecs(Number(e.target.value))} />
              </label>
            </div>
            <ProviderChips providers={videoProviders} value={providers} onChange={setProviders} label="Animate with" />
            <p className="tiny muted" style={{ marginTop: 8 }}>
              Pick more than one to compare side by side. Changes apply on "Try again".
            </p>
          </details>
        )}
      </div>
    </div>
  )
}
