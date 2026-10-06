import { useEffect, useState } from 'react'
import { approvedImageAssetId, expectedBaseAssetId, hasActiveJob } from '../../shared/gates.ts'
import type { AppConfigDTO, Candidate, ProjectViewDTO, Stage } from '../../shared/types.ts'
import type { ProjectCtl } from '../lib/api.ts'
import { Button, Chip, GateNote, ImageReviewView, ProviderPicker, Spinner } from './ui.tsx'

export function StagesPanel({ ctl, v, config }: { ctl: ProjectCtl; v: ProjectViewDTO; config: AppConfigDTO }) {
  // Open the first stage that is not approved yet.
  const firstOpen = v.stages.find((s) => !s.approvedCandidateId)?.id ?? v.stages.at(-1)?.id
  const [open, setOpen] = useState<string | undefined>(firstOpen)
  useEffect(() => setOpen(firstOpen), [firstOpen])
  if (!v.project.planApprovedAt) return <section className="panel"><GateNote gate={{ ok: false, reason: 'Approve the stage plan first.' }} /></section>

  return (
    <section className="stages">
      <div className="filmstrip">
        <figure>
          <img src={v.assetUrls[v.project.normalizedAssetId]} alt="" />
          <figcaption>Original</figcaption>
        </figure>
        {v.stages.map((s) => {
          const a = approvedImageAssetId(v, s)
          return (
            <figure key={s.id} className={open === s.id ? 'sel' : ''} onClick={() => setOpen(s.id)}>
              {a ? <img src={v.assetUrls[a]} alt="" /> : <div className="ph">{s.index + 1}</div>}
              <figcaption>
                {a ? '✓ ' : ''}
                {s.title}
              </figcaption>
            </figure>
          )
        })}
      </div>
      {v.stages.map((s) => (
        <StageCard key={s.id} ctl={ctl} v={v} stage={s} config={config} open={open === s.id} onToggle={() => setOpen(open === s.id ? undefined : s.id)} />
      ))}
    </section>
  )
}

function stageState(v: ProjectViewDTO, s: Stage) {
  if (s.approvedCandidateId) return { label: 'Approved', tone: 'ok' as const }
  const g = v.gates.stages[s.id]
  if (!g?.composePrompt.ok && !s.prompt) return { label: 'Locked', tone: 'muted' as const }
  if (!s.prompt) return { label: 'Needs prompt', tone: 'warn' as const }
  if (!s.promptApprovedAt) return { label: 'Prompt needs approval', tone: 'warn' as const }
  if (!v.candidates.some((c) => c.stageId === s.id)) return { label: 'Ready to generate', tone: 'info' as const }
  return { label: 'Choose an image', tone: 'warn' as const }
}

function StageCard(p: { ctl: ProjectCtl; v: ProjectViewDTO; stage: Stage; config: AppConfigDTO; open: boolean; onToggle: () => void }) {
  const { ctl, v, stage: s } = p
  const gates = v.gates.stages[s.id]
  const st = stageState(v, s)
  const imageProviders = p.config.providers.filter((x) => x.kind === 'image')
  const [providers, setProviders] = useState<string[]>(() => imageProviders.filter((x) => x.primary).map((x) => x.id))
  const [draft, setDraft] = useState(s.prompt ?? '')
  useEffect(() => setDraft(s.prompt ?? ''), [s.prompt])
  const composing = hasActiveJob(v, 'compose_prompt', s.id)
  const promptDirty = draft !== (s.prompt ?? '')
  const promptEditable = canEdit(v, s) && !composing
  const base = expectedBaseAssetId(v, s)
  const cands = v.candidates.filter((c) => c.stageId === s.id).reverse()

  return (
    <article className={`panel stage-card ${p.open ? 'open' : ''}`}>
      <header className="stage-head" onClick={p.onToggle}>
        <span className="plan-n">{s.index + 1}</span>
        <div className="grow">
          <h3>{s.title}</h3>
          <p className="muted small">{s.description}</p>
        </div>
        <Chip tone={st.tone}>{st.label}</Chip>
      </header>
      {p.open && (
        <div className="stage-body">
          {s.approvedCandidateId ? (
            <Approved ctl={ctl} v={v} s={s} />
          ) : (
            <>
              <GateNote gate={gates.composePrompt.ok || composing ? { ok: true } : gates.composePrompt} />
              <div className="stage-grid">
                <div className="refs">
                  <span className="muted small">Edits this image</span>
                  {base ? <img src={v.assetUrls[base]} alt="" /> : <div className="ph">Previous stage not approved</div>}
                  <span className="muted small">Mask</span>
                  {v.project.maskAssetId && <img className="mask-thumb" src={v.assetUrls[v.project.maskAssetId]} alt="" />}
                </div>
                <div className="prompt-box">
                  <div className="row-between">
                    <strong>1. Prompt</strong>
                    {s.promptApprovedAt ? <Chip tone="ok">Prompt approved</Chip> : s.prompt ? <Chip tone="warn">Not approved</Chip> : null}
                    {s.promptSource && <Chip tone="muted">{s.promptSource === 'ai' ? 'AI-written' : s.promptSource === 'user' ? 'Edited' : 'Template'}</Chip>}
                  </div>
                  <textarea
                    rows={12}
                    value={draft}
                    disabled={!promptEditable}
                    placeholder={composing ? 'Composing…' : 'Compose a prompt from the scene constraints, or write one.'}
                    onChange={(e) => setDraft(e.target.value)}
                  />
                  <div className="actions">
                    <Button gate={gates.composePrompt} busy={ctl.busy || composing} onClick={() => (!s.prompt || confirm('Replace the current prompt?')) && ctl.act('POST', `/stages/${s.id}/prompt/compose`)}>
                      {composing ? 'Composing…' : s.prompt ? 'Recompose' : 'Compose prompt'}
                    </Button>
                    <Button disabled={!promptDirty} busy={ctl.busy} onClick={() => ctl.act('PUT', `/stages/${s.id}/prompt`, { prompt: draft })}>
                      Save edits
                    </Button>
                    <Button kind="approve" gate={promptDirty ? { ok: false, reason: 'Save your edits first.' } : gates.approvePrompt} busy={ctl.busy} onClick={() => ctl.act('POST', `/stages/${s.id}/prompt/approve`)}>
                      Approve prompt
                    </Button>
                  </div>
                </div>
              </div>
              <div className="gen-box">
                <strong>2. Generate candidates</strong>
                <ProviderPicker providers={imageProviders} value={providers} onChange={setProviders} />
                <Button kind="primary" gate={!providers.length ? { ok: false, reason: 'Pick at least one provider.' } : gates.generate} busy={ctl.busy} onClick={() => ctl.act('POST', `/stages/${s.id}/candidates`, { providers })}>
                  Generate {providers.length > 1 ? `${providers.length} candidates` : 'candidate'}
                </Button>
                {!gates.generate.ok && s.prompt && <GateNote gate={gates.generate} />}
              </div>
              {cands.length > 0 && (
                <div className="candidates">
                  <strong>3. Review and approve one image</strong>
                  <div className="cand-grid">
                    {cands.map((c) => (
                      <CandidateCard key={c.id} ctl={ctl} v={v} s={s} c={c} stale={c.baseAssetId !== base || c.prompt !== s.prompt} />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </article>
  )
}

function canEdit(v: ProjectViewDTO, s: Stage) {
  // Same rule as the server's canEditPrompt: plan approved, previous approved, this not approved.
  if (!v.project.planApprovedAt || s.approvedCandidateId) return false
  const prev = v.stages.find((x) => x.index === s.index - 1)
  return !prev || !!approvedImageAssetId(v, prev)
}

function CandidateCard({ ctl, v, s, c, stale }: { ctl: ProjectCtl; v: ProjectViewDTO; s: Stage; c: Candidate; stale: boolean }) {
  const url = c.assetId ? v.assetUrls[c.assetId] : null
  const [compare, setCompare] = useState(false)
  return (
    <div className={`cand ${c.status}`}>
      <div className="cand-head">
        <strong>{c.provider}</strong>
        <span className="muted small mono">{c.model}</span>
        {stale && <Chip tone="muted">older prompt/reference</Chip>}
      </div>
      {c.status === 'pending' && (
        <div className="ph tall">
          <Spinner /> Generating…
        </div>
      )}
      {c.status === 'failed' && <p className="err small">{c.error}</p>}
      {url && (
        <div className="cand-img" onPointerDown={() => setCompare(true)} onPointerUp={() => setCompare(false)} onPointerLeave={() => setCompare(false)} title="Hold to compare with the image it was edited from">
          <img src={compare ? v.assetUrls[c.baseAssetId] : url} alt="" />
          <span className="hint">{compare ? 'BEFORE' : 'hold to compare'}</span>
        </div>
      )}
      {c.status === 'ready' && <ImageReviewView r={c.review} error={c.reviewError} />}
      {c.status === 'ready' && (
        <div className="actions">
          <Button kind="approve" busy={ctl.busy} gate={stale ? { ok: false, reason: 'Generated from an older prompt or reference.' } : { ok: true }} onClick={() => ctl.act('POST', `/stages/${s.id}/approve`, { candidateId: c.id })}>
            Approve this image
          </Button>
          {url && (
            <a className="btn ghost" href={url} target="_blank" rel="noreferrer">
              Full size
            </a>
          )}
        </div>
      )}
    </div>
  )
}

function Approved({ ctl, v, s }: { ctl: ProjectCtl; v: ProjectViewDTO; s: Stage }) {
  const c = v.candidates.find((x) => x.id === s.approvedCandidateId)!
  const later = v.stages.filter((x) => x.index > s.index && (x.approvedCandidateId || x.promptApprovedAt)).length
  return (
    <div className="approved">
      <img src={v.assetUrls[c.assetId!]} alt="" />
      <div>
        <p className="small">
          Approved {new Date(s.approvedAt!).toLocaleString()} · {c.provider} · <span className="mono">{c.model}</span>
        </p>
        <ImageReviewView r={c.review} error={c.reviewError} />
        <details className="small">
          <summary>Prompt used</summary>
          <pre className="prompt-pre">{c.prompt}</pre>
        </details>
        <Button
          kind="danger"
          busy={ctl.busy}
          onClick={() =>
            confirm(later || v.transitions.length ? `Reopen "${s.title}"? ${later} later stage(s) and all clips will need approval again.` : `Reopen "${s.title}"?`) &&
            ctl.act('POST', `/stages/${s.id}/reopen`)
          }
        >
          Reopen stage
        </Button>
      </div>
    </div>
  )
}
