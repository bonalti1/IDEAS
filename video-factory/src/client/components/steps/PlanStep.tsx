import { useEffect, useState } from 'react'
import type { PlanStageInput } from '../../../shared/types.ts'
import { Btn, DoneBanner, LinkBtn, Screen, Working } from '../ui.tsx'
import { jobState, type StepProps } from './props.ts'

type Row = PlanStageInput & { id?: string }

export function PlanStep({ ctl, v, next }: StepProps) {
  const p = v.project
  const job = jobState(v, 'propose_plan', p.id)
  const approved = !!p.planApprovedAt
  const stored = JSON.stringify(v.stages.map((s) => ({ id: s.id, title: s.title, description: s.description, checklist: s.checklist, motionHint: s.motionHint })))
  const [rows, setRows] = useState<Row[]>(() => JSON.parse(stored))
  const [editing, setEditing] = useState(false)
  useEffect(() => setRows(JSON.parse(stored)), [stored])
  const dirty = JSON.stringify(rows) !== stored

  const update = (i: number, patch: Partial<Row>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const move = (i: number, d: number) =>
    setRows((r) => {
      const n = [...r]
      const j = i + d
      if (j < 0 || j >= n.length) return r
      ;[n[i], n[j]] = [n[j], n[i]]
      return n
    })

  const approve = async () => {
    if (dirty && !(await ctl.act('PUT', '/plan', { stages: rows }))) return
    if (await ctl.act('POST', '/plan/approve')) next()
  }

  return (
    <Screen title="Here's the plan" subtitle="Each step becomes one picture. The video moves from your photo through every step to the finished job.">
      {job.running && <Working>Planning the steps…</Working>}
      {!job.running && !v.stages.length && (
        <div className="actions">
          {job.failed && <p className="err small">{job.failed}</p>}
          <Btn kind="primary" big onClick={() => ctl.act('POST', '/plan/propose')} disabled={ctl.busy}>
            Plan the steps
          </Btn>
        </div>
      )}
      {!editing && v.stages.length > 0 && (
        <div className="timeline">
          <div className="tcard">
            <img src={v.assetUrls[p.normalizedAssetId]} alt="" />
            <strong>Today</strong>
            <p>Your photo</p>
          </div>
          {v.stages.map((s) => (
            <div key={s.id} className="tcard">
              <span className="num">{s.index + 1}</span>
              <strong>{s.title}</strong>
              <p>{s.description}</p>
            </div>
          ))}
        </div>
      )}
      {editing && (
        <div className="plan-edit">
          {rows.map((r, i) => (
            <div key={r.id ?? `new-${i}`} className="item">
              <span className="num">{i + 1}</span>
              <div>
                <input value={r.title} placeholder="Step name" onChange={(e) => update(i, { title: e.target.value })} style={{ fontWeight: 600, marginBottom: 8 }} />
                <textarea rows={2} value={r.description} placeholder="What the picture should show at the end of this step" onChange={(e) => update(i, { description: e.target.value })} />
              </div>
              <div className="icon-btns">
                <button onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
                <button onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label="Move down">↓</button>
                <button onClick={() => setRows((x) => x.filter((_, j) => j !== i))} aria-label="Remove">✕</button>
              </div>
            </div>
          ))}
          <div>
            <LinkBtn onClick={() => setRows((r) => [...r, { title: '', description: '', checklist: [], motionHint: '' }])}>+ Add a step</LinkBtn>
          </div>
        </div>
      )}
      {!approved && v.stages.length > 0 && !job.running && (
        <div className="actions">
          <Btn kind="primary" big onClick={approve} disabled={ctl.busy || rows.some((r) => !r.title.trim() || !r.description.trim())}>
            {dirty ? 'Save and continue' : 'Looks good'}
          </Btn>
          {!editing ? (
            <LinkBtn onClick={() => setEditing(true)}>Edit the steps</LinkBtn>
          ) : (
            <LinkBtn onClick={() => (setRows(JSON.parse(stored)), setEditing(false))}>Cancel</LinkBtn>
          )}
        </div>
      )}
      {approved && (
        <div className="actions">
          <DoneBanner action={<LinkBtn onClick={() => confirm('Change the plan? All pictures and clips will need approving again.') && ctl.act('POST', '/reopen', { step: 'plan' })}>Change</LinkBtn>}>
            Plan approved
          </DoneBanner>
        </div>
      )}
    </Screen>
  )
}
