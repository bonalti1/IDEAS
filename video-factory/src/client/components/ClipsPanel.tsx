import { useEffect, useState } from 'react'
import { transitionsCurrent } from '../../shared/gates.ts'
import type { AppConfigDTO, ProjectViewDTO, Take, Transition } from '../../shared/types.ts'
import type { ProjectCtl } from '../lib/api.ts'
import { Button, Chip, ClipReviewView, GateNote, ProviderPicker, Spinner } from './ui.tsx'

export function ClipsPanel({ ctl, v, config }: { ctl: ProjectCtl; v: ProjectViewDTO; config: AppConfigDTO }) {
  const current = transitionsCurrent(v)
  return (
    <section className="clips">
      <div className="panel">
        <div className="panel-head">
          <h2>Transitions</h2>
          {current && <Chip tone="muted">{v.transitions.filter((t) => t.approvedTakeId).length} / {v.transitions.length} approved</Chip>}
        </div>
        <p className="muted small">
          One short clip per pair of adjacent approved frames, using first-frame / last-frame control. Frames are center-cropped to {v.project.videoAspect}. Retry only the clip that needs work; Kling and Seedance are optional challengers.
        </p>
        {!current && (
          <>
            <GateNote gate={v.gates.prepareTransitions} />
            <Button kind="primary" gate={v.gates.prepareTransitions} busy={ctl.busy} onClick={() => ctl.act('POST', '/transitions/prepare')}>
              Prepare clips from approved images
            </Button>
          </>
        )}
      </div>
      {current && v.transitions.map((t) => <TransitionCard key={t.id} ctl={ctl} v={v} t={t} config={config} />)}
    </section>
  )
}

function title(v: ProjectViewDTO, stageId: string | null) {
  return stageId ? (v.stages.find((s) => s.id === stageId)?.title ?? '?') : 'Original'
}

function TransitionCard({ ctl, v, t, config }: { ctl: ProjectCtl; v: ProjectViewDTO; t: Transition; config: AppConfigDTO }) {
  const videoProviders = config.providers.filter((x) => x.kind === 'video')
  const [providers, setProviders] = useState<string[]>(() => videoProviders.filter((x) => x.primary).map((x) => x.id))
  const [prompt, setPrompt] = useState(t.prompt)
  const [duration, setDuration] = useState(t.durationSec)
  useEffect(() => setPrompt(t.prompt), [t.prompt])
  useEffect(() => setDuration(t.durationSec), [t.durationSec])
  const dirty = prompt !== t.prompt || duration !== t.durationSec
  const takes = v.takes.filter((k) => k.transitionId === t.id).reverse()
  const approved = !!t.approvedTakeId
  const approvedTake = takes.find((k) => k.id === t.approvedTakeId)

  return (
    <article className="panel clip-card">
      <header className="row-between">
        <h3>
          Clip {t.index + 1}: {title(v, t.fromStageId)} → {title(v, t.toStageId)}
        </h3>
        {approved ? <Chip tone="ok">Approved</Chip> : takes.some((k) => k.status === 'ready') ? <Chip tone="warn">Choose a take</Chip> : <Chip tone="info">Ready to animate</Chip>}
      </header>
      <div className="pair">
        <figure>
          <img src={v.assetUrls[t.fromAssetId]} alt="" />
          <figcaption>First frame</figcaption>
        </figure>
        <span className="arrow">→</span>
        <figure>
          <img src={v.assetUrls[t.toAssetId]} alt="" />
          <figcaption>Last frame</figcaption>
        </figure>
      </div>
      {approved && approvedTake ? (
        <div className="approved">
          <video src={v.assetUrls[approvedTake.assetId!]} poster={v.assetUrls[approvedTake.frameAssetIds[0]]} preload="metadata" controls loop muted playsInline />
          <div>
            <p className="small">
              {approvedTake.provider} · <span className="mono">{approvedTake.model}</span>
            </p>
            <ClipReviewView r={approvedTake.review} error={approvedTake.reviewError} />
            <Button kind="danger" busy={ctl.busy} onClick={() => ctl.act('POST', `/transitions/${t.id}/reopen`)}>
              Reopen clip
            </Button>
          </div>
        </div>
      ) : (
        <>
          <label className="field">
            <span>Motion prompt</span>
            <textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          </label>
          <div className="row">
            <label className="field inline">
              <span>Seconds</span>
              <input type="number" min={2} max={15} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
            </label>
            <Button disabled={!dirty} busy={ctl.busy} onClick={() => ctl.act('PUT', `/transitions/${t.id}`, { prompt, durationSec: duration })}>
              Save
            </Button>
          </div>
          <ProviderPicker providers={videoProviders} value={providers} onChange={setProviders} />
          <Button
            kind="primary"
            gate={dirty ? { ok: false, reason: 'Save your edits first.' } : !providers.length ? { ok: false, reason: 'Pick a provider.' } : { ok: true }}
            busy={ctl.busy}
            onClick={() => ctl.act('POST', `/transitions/${t.id}/takes`, { providers })}
          >
            {takes.length ? 'Generate another take' : 'Animate'}
          </Button>
          {takes.length > 0 && (
            <div className="cand-grid">
              {takes.map((k) => (
                <TakeCard key={k.id} ctl={ctl} v={v} t={t} k={k} />
              ))}
            </div>
          )}
        </>
      )}
    </article>
  )
}

function TakeCard({ ctl, v, t, k }: { ctl: ProjectCtl; v: ProjectViewDTO; t: Transition; k: Take }) {
  const job = v.jobs.find((j) => j.id === k.jobId)
  return (
    <div className={`cand ${k.status}`}>
      <div className="cand-head">
        <strong>{k.provider}</strong>
        <span className="muted small mono">{k.model}</span>
        {k.prompt !== t.prompt && <Chip tone="muted">older prompt</Chip>}
      </div>
      {k.status === 'pending' && (
        <div className="ph tall">
          <Spinner /> {job?.message ?? 'Queued…'}
        </div>
      )}
      {k.status === 'failed' && <p className="err small">{k.error}</p>}
      {k.assetId && <video src={v.assetUrls[k.assetId]} poster={k.frameAssetIds[0] ? v.assetUrls[k.frameAssetIds[0]] : undefined} preload="metadata" controls loop muted playsInline />}
      {k.frameAssetIds.length > 0 && (
        <div className="frames">
          {k.frameAssetIds.map((f) => (
            <img key={f} src={v.assetUrls[f]} alt="" />
          ))}
        </div>
      )}
      {k.status === 'ready' && <ClipReviewView r={k.review} error={k.reviewError} />}
      {k.status === 'ready' && (
        <Button kind="approve" busy={ctl.busy} onClick={() => ctl.act('POST', `/transitions/${t.id}/approve`, { takeId: k.id })}>
          Approve this clip
        </Button>
      )}
    </div>
  )
}
