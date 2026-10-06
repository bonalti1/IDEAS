import { useEffect, useState } from 'react'
import { approvedImageAssetId, expectedBaseAssetId } from '../../../shared/gates.ts'
import type { Candidate, Stage } from '../../../shared/types.ts'
import { AiCheck, Btn, DoneBanner, LinkBtn, ProviderChips, Screen, Working } from '../ui.tsx'
import { jobState, type StepProps } from './props.ts'

export function ImagesStep(props: StepProps) {
  const { v } = props
  const firstOpen = v.stages.find((s) => !s.approvedCandidateId) ?? v.stages.at(-1)!
  const [selId, setSelId] = useState(firstOpen.id)
  useEffect(() => setSelId(firstOpen.id), [firstOpen.id])
  const sel = v.stages.find((s) => s.id === selId) ?? firstOpen
  const total = v.stages.length

  return (
    <Screen title={`Step ${sel.index + 1} of ${total}: ${sel.title}`} subtitle={sel.description}>
      <div className="strip" role="tablist">
        <button disabled>
          <div className="thumb">
            <img src={v.assetUrls[v.project.normalizedAssetId]} alt="" />
          </div>
          <div className="cap">Today</div>
        </button>
        {v.stages.map((s) => {
          const img = approvedImageAssetId(v, s)
          const reachable = s.index === 0 || !!approvedImageAssetId(v, v.stages[s.index - 1])
          return (
            <button key={s.id} className={s.id === sel.id ? 'sel' : ''} disabled={!reachable} onClick={() => setSelId(s.id)} role="tab" aria-selected={s.id === sel.id}>
              <div className="thumb">{img ? <img src={v.assetUrls[img]} alt="" /> : s.index + 1}</div>
              <div className="cap">
                {img && <span className="ok">✓ </span>}
                {s.title}
              </div>
            </button>
          )
        })}
      </div>
      <StageBody key={sel.id} {...props} stage={sel} onNextStage={() => {
        const n = v.stages.find((s) => s.index === sel.index + 1)
        if (n) setSelId(n.id)
        else props.next()
      }} />
    </Screen>
  )
}

function StageBody({ ctl, v, config, stage: s, onNextStage }: StepProps & { stage: Stage; onNextStage: () => void }) {
  const imageProviders = config.providers.filter((p) => p.kind === 'image')
  const [providers, setProviders] = useState(() => imageProviders.map((p) => p.id))
  const [mode, setMode] = useState<'auto' | 'instructions'>('auto')
  const compose = jobState(v, 'compose_prompt', s.id)
  const base = expectedBaseAssetId(v, s)
  const mine = v.candidates.filter((c) => c.stageId === s.id)
  const current = mine.filter((c) => c.prompt === s.prompt && c.baseAssetId === base && c.status !== 'failed').reverse()
  const failed = mine.filter((c) => c.status === 'failed' && c.prompt === s.prompt).at(-1)
  const pending = current.filter((c) => c.status === 'pending')
  const ready = current.filter((c) => c.status === 'ready')
  const isLast = s.index === v.stages.length - 1

  const create = async () => {
    const body = { providers: providers.length ? providers : undefined }
    if (!s.promptApprovedAt) await ctl.act('POST', `/stages/${s.id}/prompt/approve`, { ...body, generate: true })
    else await ctl.act('POST', `/stages/${s.id}/candidates`, body)
    setMode('auto')
  }

  // Approved
  if (s.approvedCandidateId) {
    const c = v.candidates.find((x) => x.id === s.approvedCandidateId)!
    return (
      <div className="split">
        <img src={v.assetUrls[c.assetId!]} alt={s.title} />
        <div>
          <DoneBanner>Picture approved</DoneBanner>
          <div className="actions">
            <Btn kind="primary" big onClick={onNextStage}>
              {isLast ? 'Next: make the clips →' : 'Next step →'}
            </Btn>
            <LinkBtn
              onClick={() =>
                confirm(isLast ? 'Redo this picture?' : 'Redo this picture? The steps after it will need new pictures.') && ctl.act('POST', `/stages/${s.id}/reopen`)
              }
            >
              Redo this step
            </LinkBtn>
          </div>
        </div>
      </div>
    )
  }

  if (!base) return <p className="muted">Approve the picture for the previous step first.</p>

  if (compose.running) return <Working>Writing instructions for the AI…</Working>

  if (!s.prompt) {
    return (
      <div className="actions">
        {compose.failed && <p className="err small">{compose.failed}</p>}
        <Btn kind="primary" big onClick={() => ctl.act('POST', `/stages/${s.id}/prompt/compose`)} disabled={ctl.busy}>
          Write instructions
        </Btn>
      </div>
    )
  }

  if (pending.length) {
    return (
      <>
        <Working>Creating {pending.length > 1 ? `${pending.length} pictures` : 'a picture'}… usually under a minute.</Working>
        <div className="picks" style={{ marginTop: 18 }}>
          {[...pending, ...ready].map((c) =>
            c.status === 'ready' ? <Pick key={c.id} c={c} {...{ ctl, v, s }} /> : <div key={c.id} className="ph shimmer" style={{ aspectRatio: '4 / 3' }} />,
          )}
        </div>
      </>
    )
  }

  if (ready.length && s.promptApprovedAt && mode === 'auto') {
    return (
      <>
        <h3 style={{ marginBottom: 14 }}>Pick the best one</h3>
        <div className="picks">
          {ready.map((c) => (
            <Pick key={c.id} c={c} {...{ ctl, v, s }} />
          ))}
        </div>
        <div className="actions">
          <LinkBtn onClick={create}>None are right — try again</LinkBtn>
          <LinkBtn onClick={() => setMode('instructions')}>Change the instructions</LinkBtn>
        </div>
      </>
    )
  }

  return (
    <Instructions
      {...{ ctl, v, s, base }}
      failed={failed?.error ?? null}
      chips={<ProviderChips providers={imageProviders} value={providers} onChange={setProviders} label="Create with" />}
      onCreate={create}
      canCreate={providers.length > 0 && !ctl.busy}
      onCancel={ready.length && s.promptApprovedAt ? () => setMode('auto') : undefined}
    />
  )
}

function Instructions(p: {
  ctl: StepProps['ctl']
  v: StepProps['v']
  s: Stage
  base: string
  failed: string | null
  chips: React.ReactNode
  onCreate: () => void
  canCreate: boolean
  onCancel?: () => void
}) {
  const { ctl, v, s } = p
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(s.prompt ?? '')
  useEffect(() => setDraft(s.prompt ?? ''), [s.prompt])

  return (
    <div className="split media-small">
      <div>
        <img src={v.assetUrls[p.base]} alt="Starting picture" />
        <p className="tiny muted" style={{ marginTop: 6 }}>
          {s.index === 0 ? 'Starting from your photo' : 'Starting from the approved previous step'}
        </p>
      </div>
      <div>
        <h3 style={{ marginBottom: 10 }}>What we'll ask the AI to draw</h3>
        {!editing ? (
          <>
            <div className={`instructions ${open ? 'open' : ''}`}>{s.prompt}</div>
            <div className="actions" style={{ marginTop: 8, gap: 14 }}>
              <LinkBtn onClick={() => setOpen(!open)}>{open ? 'Show less' : 'Show all'}</LinkBtn>
              <LinkBtn onClick={() => (setEditing(true), setOpen(true))}>Edit</LinkBtn>
              <LinkBtn onClick={() => confirm('Rewrite the instructions from scratch?') && ctl.act('POST', `/stages/${s.id}/prompt/compose`)}>Rewrite</LinkBtn>
            </div>
          </>
        ) : (
          <>
            <textarea className="instructions-edit" value={draft} onChange={(e) => setDraft(e.target.value)} />
            <div className="actions" style={{ marginTop: 8 }}>
              <Btn onClick={async () => (await ctl.act('PUT', `/stages/${s.id}/prompt`, { prompt: draft })) && setEditing(false)} disabled={!draft.trim() || draft === s.prompt || ctl.busy}>
                Save instructions
              </Btn>
              <LinkBtn onClick={() => (setDraft(s.prompt ?? ''), setEditing(false))}>Cancel</LinkBtn>
            </div>
          </>
        )}
        <div style={{ marginTop: 18 }}>{p.chips}</div>
        {p.failed && <p className="err small" style={{ marginTop: 12 }}>Last try failed: {p.failed}</p>}
        <div className="actions">
          <Btn kind="primary" big onClick={p.onCreate} disabled={!p.canCreate || editing}>
            Create pictures
          </Btn>
          {p.onCancel && <LinkBtn onClick={p.onCancel}>Back to pictures</LinkBtn>}
        </div>
        <p className="tiny muted" style={{ marginTop: 10 }}>
          By creating pictures you approve these instructions.
        </p>
      </div>
    </div>
  )
}

function Pick({ ctl, v, s, c }: { ctl: StepProps['ctl']; v: StepProps['v']; s: Stage; c: Candidate }) {
  const [before, setBefore] = useState(false)
  return (
    <div className="pick">
      <div className="frame" onPointerDown={() => setBefore(true)} onPointerUp={() => setBefore(false)} onPointerLeave={() => setBefore(false)}>
        <img src={v.assetUrls[before ? c.baseAssetId : c.assetId!]} alt="" />
        <span className="hint">{before ? 'Before' : 'Hold to see before'}</span>
      </div>
      <div className="pick-foot">
        <AiCheck review={c.review} error={c.reviewError} kind="image" />
        <Btn kind="primary" onClick={() => ctl.act('POST', `/stages/${s.id}/approve`, { candidateId: c.id })} disabled={ctl.busy}>
          Use this one
        </Btn>
      </div>
    </div>
  )
}
