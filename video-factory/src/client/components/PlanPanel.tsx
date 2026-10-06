import { useEffect, useState } from 'react'
import { hasActiveJob } from '../../shared/gates.ts'
import type { PlanStageInput, ProjectViewDTO } from '../../shared/types.ts'
import type { ProjectCtl } from '../lib/api.ts'
import { Button, Chip, GateNote, lines } from './ui.tsx'

type Row = PlanStageInput & { id?: string }

const toRows = (v: ProjectViewDTO): Row[] =>
  v.stages.map((s) => ({ id: s.id, title: s.title, description: s.description, checklist: s.checklist, motionHint: s.motionHint }))

export function PlanPanel({ ctl, v }: { ctl: ProjectCtl; v: ProjectViewDTO }) {
  const p = v.project
  const approved = !!p.planApprovedAt
  const running = hasActiveJob(v, 'propose_plan', p.id)
  const stored = JSON.stringify(toRows(v))
  const [rows, setRows] = useState<Row[]>(() => toRows(v))
  useEffect(() => setRows(JSON.parse(stored)), [stored])
  const dirty = JSON.stringify(rows) !== stored
  const editable = v.gates.editPlan.ok

  const update = (i: number, patch: Partial<Row>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const move = (i: number, d: -1 | 1) =>
    setRows((r) => {
      const n = [...r]
      const j = i + d
      if (j < 0 || j >= n.length) return r
      ;[n[i], n[j]] = [n[j], n[i]]
      return n
    })

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Stage plan</h2>
        {approved ? <Chip tone="ok">Approved</Chip> : rows.length ? <Chip tone="warn">Needs approval</Chip> : null}
      </div>
      <GateNote gate={editable || approved ? { ok: true } : v.gates.editPlan} />
      <p className="muted small">
        Each stage becomes one approved still image. The video animates between consecutive stills, starting from the original photo.
      </p>
      <ol className="plan">
        <li className="plan-row original">
          <img src={v.assetUrls[p.normalizedAssetId]} alt="" />
          <div>
            <strong>Original photo</strong>
            <p className="muted small">Starting frame</p>
          </div>
        </li>
        {rows.map((r, i) => (
          <li key={r.id ?? `new-${i}`} className="plan-row">
            <span className="plan-n">{i + 1}</span>
            <fieldset disabled={!editable} className="plan-fields">
              <input className="title" value={r.title} placeholder="Stage title" onChange={(e) => update(i, { title: e.target.value })} />
              <textarea rows={2} value={r.description} placeholder="What is visible at the end of this stage" onChange={(e) => update(i, { description: e.target.value })} />
              <div className="grid2 tight">
                <label className="field">
                  <span>Reviewer checklist (one per line)</span>
                  <textarea rows={3} value={r.checklist.join('\n')} onChange={(e) => update(i, { checklist: lines(e.target.value) })} />
                </label>
                <label className="field">
                  <span>Motion into this stage</span>
                  <textarea rows={3} value={r.motionHint} onChange={(e) => update(i, { motionHint: e.target.value })} />
                </label>
              </div>
            </fieldset>
            {editable && (
              <div className="row-tools">
                <button onClick={() => move(i, -1)} disabled={i === 0} title="Move up">
                  ↑
                </button>
                <button onClick={() => move(i, 1)} disabled={i === rows.length - 1} title="Move down">
                  ↓
                </button>
                <button onClick={() => setRows((x) => x.filter((_, j) => j !== i))} title="Remove">
                  ✕
                </button>
              </div>
            )}
          </li>
        ))}
      </ol>
      <div className="actions">
        {!approved ? (
          <>
            <Button gate={v.gates.proposePlan} busy={ctl.busy || running} onClick={() => (!rows.length || confirm('Replace the current plan with a new AI proposal?')) && ctl.act('POST', '/plan/propose')}>
              {running ? 'Proposing…' : rows.length ? 'Re-propose with AI' : 'Propose stages with AI'}
            </Button>
            <Button disabled={!editable} onClick={() => setRows((r) => [...r, { title: '', description: '', checklist: [], motionHint: '' }])}>
              + Add stage
            </Button>
            <Button disabled={!dirty} busy={ctl.busy} onClick={() => ctl.act('PUT', '/plan', { stages: rows })}>
              Save plan
            </Button>
            <Button kind="approve" gate={dirty ? { ok: false, reason: 'Save the plan first.' } : v.gates.approvePlan} busy={ctl.busy} onClick={() => ctl.act('POST', '/plan/approve')}>
              Approve plan
            </Button>
          </>
        ) : (
          <Button
            kind="danger"
            busy={ctl.busy}
            onClick={() => confirm('Reopen the plan? This un-approves every stage image and every clip.') && ctl.act('POST', '/reopen', { step: 'plan' })}
          >
            Reopen plan
          </Button>
        )}
      </div>
      {!approved && rows.length > 0 && !dirty && <GateNote gate={v.gates.approvePlan} />}
    </section>
  )
}
