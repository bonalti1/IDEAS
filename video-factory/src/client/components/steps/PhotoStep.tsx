import { useEffect, useState } from 'react'
import type { SceneAnalysis } from '../../../shared/types.ts'
import { Btn, DoneBanner, LinkBtn, lines, Screen, Working } from '../ui.tsx'
import { jobState, type StepProps } from './props.ts'

export function PhotoStep({ ctl, v, next }: StepProps) {
  const p = v.project
  const job = jobState(v, 'analyze_scene', p.id)
  const approved = !!p.sceneApprovedAt
  const [editing, setEditing] = useState(false)
  const sceneKey = JSON.stringify(p.scene)
  const [draft, setDraft] = useState<SceneAnalysis | null>(p.scene)
  useEffect(() => setDraft(p.scene), [sceneKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const box = (editing ? draft : p.scene)?.workArea.box

  const approve = async () => {
    if (editing && JSON.stringify(draft) !== sceneKey && !(await ctl.act('PUT', '/scene', draft))) return
    if (await ctl.act('POST', '/scene/approve')) next()
  }

  return (
    <Screen title="Check the photo" subtitle="We read your photo to learn what must stay exactly the same in every picture.">
      <div className="split">
        <div className="img-wrap">
          <img src={v.assetUrls[p.normalizedAssetId]} alt="Your site photo" />
          {box && (
            <div
              className="box-overlay"
              style={{ left: `${box.x0 * 100}%`, top: `${box.y0 * 100}%`, width: `${(box.x1 - box.x0) * 100}%`, height: `${(box.y1 - box.y0) * 100}%` }}
            />
          )}
        </div>
        <div>
          {job.running && <Working>Reading your photo… this takes a few seconds.</Working>}
          {!job.running && !p.scene && (
            <>
              {job.failed && <p className="err small">{job.failed}</p>}
              <div className="actions">
                <Btn kind="primary" big onClick={() => ctl.act('POST', '/scene/analyze')} disabled={ctl.busy}>
                  {job.failed ? 'Try again' : 'Read my photo'}
                </Btn>
              </div>
            </>
          )}
          {p.scene && !editing && (
            <div className="facts">
              <div className="fact">
                <h3>We'll build here</h3>
                <p>{p.scene.workArea.description}</p>
                <p className="tiny muted">Outlined in orange on the photo.</p>
              </div>
              <div className="fact">
                <h3>Stays exactly the same</h3>
                <ul>
                  {p.scene.mustRemainUnchanged.slice(0, 6).map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </div>
              {p.scene.risks.length > 0 && <div className="note">⚠ {p.scene.risks[0]}</div>}
            </div>
          )}
          {p.scene && editing && draft && <SceneForm draft={draft} setDraft={setDraft} />}
          {p.scene && !approved && (
            <div className="actions">
              <Btn kind="primary" big onClick={approve} disabled={ctl.busy || job.running}>
                Looks right
              </Btn>
              {!editing ? <LinkBtn onClick={() => setEditing(true)}>Edit details</LinkBtn> : <LinkBtn onClick={() => (setDraft(p.scene), setEditing(false))}>Cancel</LinkBtn>}
            </div>
          )}
          {approved && (
            <div className="actions">
              <DoneBanner
                action={
                  <LinkBtn onClick={() => confirm('Change the photo details? Everything after this step will need approving again.') && ctl.act('POST', '/reopen', { step: 'scene' })}>
                    Change
                  </LinkBtn>
                }
              >
                Photo checked
              </DoneBanner>
            </div>
          )}
        </div>
      </div>
    </Screen>
  )
}

function SceneForm({ draft, setDraft }: { draft: SceneAnalysis; setDraft: (s: SceneAnalysis) => void }) {
  const set = <K extends keyof SceneAnalysis>(k: K, val: SceneAnalysis[K]) => setDraft({ ...draft, [k]: val })
  const setBox = (k: 'x0' | 'y0' | 'x1' | 'y1', val: number) => setDraft({ ...draft, workArea: { ...draft.workArea, box: { ...draft.workArea.box, [k]: val } } })
  return (
    <div>
      <label className="field">
        <span>Where we'll build</span>
        <input value={draft.workArea.description} onChange={(e) => set('workArea', { ...draft.workArea, description: e.target.value })} />
      </label>
      <label className="field">
        <span>
          Stays the same <span className="hint">— one per line</span>
        </span>
        <textarea rows={5} value={draft.mustRemainUnchanged.join('\n')} onChange={(e) => set('mustRemainUnchanged', lines(e.target.value))} />
      </label>
      <label className="field">
        <span>Camera position</span>
        <textarea rows={2} value={draft.cameraPosition} onChange={(e) => set('cameraPosition', e.target.value)} />
      </label>
      <label className="field">
        <span>Lighting</span>
        <input value={draft.lighting} onChange={(e) => set('lighting', e.target.value)} />
      </label>
      <div className="row">
        {(['x0', 'y0', 'x1', 'y1'] as const).map((k) => (
          <label key={k} className="field">
            <span>
              Box {k} <span className="hint">0–1</span>
            </span>
            <input type="number" step={0.01} min={0} max={1} value={draft.workArea.box[k]} onChange={(e) => setBox(k, Number(e.target.value))} />
          </label>
        ))}
      </div>
    </div>
  )
}
