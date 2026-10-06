import { useEffect, useState } from 'react'
import { hasActiveJob } from '../../shared/gates.ts'
import type { ProjectViewDTO, SceneAnalysis } from '../../shared/types.ts'
import type { ProjectCtl } from '../lib/api.ts'
import { Button, Chip, GateNote, lines, Spinner } from './ui.tsx'

export function ScenePanel({ ctl, v }: { ctl: ProjectCtl; v: ProjectViewDTO }) {
  const p = v.project
  const [draft, setDraft] = useState<SceneAnalysis | null>(p.scene)
  // Reset the draft only when the stored scene actually changes (polls return new objects).
  const sceneKey = JSON.stringify(p.scene)
  useEffect(() => setDraft(p.scene), [sceneKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const approved = !!p.sceneApprovedAt
  const running = hasActiveJob(v, 'analyze_scene', p.id)
  const dirty = JSON.stringify(draft) !== sceneKey
  const box = draft?.workArea.box

  const set = <K extends keyof SceneAnalysis>(k: K, val: SceneAnalysis[K]) => setDraft((d) => (d ? { ...d, [k]: val } : d))
  const setBox = (k: 'x0' | 'y0' | 'x1' | 'y1', val: number) =>
    setDraft((d) => (d ? { ...d, workArea: { ...d.workArea, box: { ...d.workArea.box, [k]: val } } } : d))

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Scene constraints</h2>
        {approved ? <Chip tone="ok">Approved</Chip> : p.scene ? <Chip tone="warn">Needs approval</Chip> : null}
      </div>
      <div className="grid2">
        <div>
          <div className="img-wrap">
            <img src={v.assetUrls[p.normalizedAssetId]} alt="Normalized photo" />
            {box && (
              <div
                className="box-overlay"
                style={{ left: `${box.x0 * 100}%`, top: `${box.y0 * 100}%`, width: `${(box.x1 - box.x0) * 100}%`, height: `${(box.y1 - box.y0) * 100}%` }}
              >
                <span>work area</span>
              </div>
            )}
          </div>
          <p className="muted small">
            Original kept unchanged ({v.assets[p.originalAssetId]?.width}×{v.assets[p.originalAssetId]?.height},{' '}
            <a href={v.assetUrls[p.originalAssetId]} target="_blank" rel="noreferrer">
              open
            </a>
            ). Normalized: {v.assets[p.normalizedAssetId]?.width}×{v.assets[p.normalizedAssetId]?.height}.
          </p>
        </div>
        <div>
          {!p.scene && (
            <div className="callout">
              <p>The vision model reads the photo and proposes the camera position, site layout, work area and everything that must stay unchanged.</p>
              <Button kind="primary" gate={v.gates.analyzeScene} busy={ctl.busy || running} onClick={() => ctl.act('POST', '/scene/analyze')}>
                {running ? 'Analyzing…' : 'Analyze photo'}
              </Button>
              {running && <Spinner />}
            </div>
          )}
          {draft && (
            <fieldset disabled={approved} className="form">
              <p className="small">{draft.summary}</p>
              <label className="field">
                <span>Camera position</span>
                <textarea rows={2} value={draft.cameraPosition} onChange={(e) => set('cameraPosition', e.target.value)} />
              </label>
              <label className="field">
                <span>Site layout</span>
                <textarea rows={2} value={draft.siteLayout} onChange={(e) => set('siteLayout', e.target.value)} />
              </label>
              <label className="field">
                <span>Lighting</span>
                <input value={draft.lighting} onChange={(e) => set('lighting', e.target.value)} />
              </label>
              <label className="field">
                <span>Visible structures (one per line)</span>
                <textarea rows={3} value={draft.visibleStructures.join('\n')} onChange={(e) => set('visibleStructures', lines(e.target.value))} />
              </label>
              <label className="field">
                <span>Work area</span>
                <input value={draft.workArea.description} onChange={(e) => set('workArea', { ...draft.workArea, description: e.target.value })} />
              </label>
              <div className="box-inputs">
                {(['x0', 'y0', 'x1', 'y1'] as const).map((k) => (
                  <label key={k} className="field inline">
                    <span>{k}</span>
                    <input type="number" step={0.01} min={0} max={1} value={draft.workArea.box[k]} onChange={(e) => setBox(k, Number(e.target.value))} />
                  </label>
                ))}
              </div>
              <label className="field">
                <span>Must remain unchanged (one per line)</span>
                <textarea rows={5} value={draft.mustRemainUnchanged.join('\n')} onChange={(e) => set('mustRemainUnchanged', lines(e.target.value))} />
              </label>
              {draft.risks.length > 0 && (
                <div className="risks small">
                  <strong>Risks:</strong>
                  <ul>
                    {draft.risks.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="muted small">
                Analyzed by {draft.analyzedBy.provider} · {draft.analyzedBy.model}
              </p>
            </fieldset>
          )}
          {p.scene && (
            <div className="actions">
              {!approved && (
                <>
                  <Button disabled={!dirty} busy={ctl.busy} onClick={() => ctl.act('PUT', '/scene', draft)}>
                    Save edits
                  </Button>
                  <Button gate={v.gates.analyzeScene} busy={ctl.busy || running} onClick={() => ctl.act('POST', '/scene/analyze')}>
                    Re-analyze
                  </Button>
                  <Button kind="approve" gate={dirty ? { ok: false, reason: 'Save your edits first.' } : v.gates.approveScene} busy={ctl.busy} onClick={() => ctl.act('POST', '/scene/approve')}>
                    Approve scene
                  </Button>
                </>
              )}
              {approved && (
                <Button
                  kind="danger"
                  busy={ctl.busy}
                  onClick={() => confirm('Reopen the scene? This un-approves the mask, the plan, every stage image and every clip.') && ctl.act('POST', '/reopen', { step: 'scene' })}
                >
                  Reopen scene
                </Button>
              )}
            </div>
          )}
          {!approved && p.scene && <GateNote gate={v.gates.approveScene} />}
        </div>
      </div>
    </section>
  )
}
