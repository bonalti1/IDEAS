import { useEffect } from 'react'
import { allStagesApproved, transitionsCurrent } from '../../shared/gates.ts'
import type { AppConfigDTO, ProjectViewDTO } from '../../shared/types.ts'
import { useProject } from '../lib/api.ts'
import { AreaStep } from './steps/AreaStep.tsx'
import { ClipsStep } from './steps/ClipsStep.tsx'
import { ExportStep } from './steps/ExportStep.tsx'
import { ImagesStep } from './steps/ImagesStep.tsx'
import { PlanStep } from './steps/PlanStep.tsx'
import { PhotoStep } from './steps/PhotoStep.tsx'
import { Working } from './ui.tsx'

export type StepId = 'photo' | 'area' | 'plan' | 'pictures' | 'clips' | 'video'

export function stepList(v: ProjectViewDTO) {
  const p = v.project
  const picturesDone = allStagesApproved(v)
  const clipsDone = picturesDone && transitionsCurrent(v) && v.transitions.every((t) => t.approvedTakeId)
  return [
    { id: 'photo' as StepId, label: 'Photo', done: !!p.sceneApprovedAt, open: true },
    { id: 'area' as StepId, label: 'Work area', done: !!p.maskApprovedAt, open: !!p.sceneApprovedAt },
    { id: 'plan' as StepId, label: 'Plan', done: !!p.planApprovedAt, open: !!p.maskApprovedAt },
    { id: 'pictures' as StepId, label: 'Pictures', done: picturesDone, open: !!p.planApprovedAt },
    { id: 'clips' as StepId, label: 'Clips', done: clipsDone, open: picturesDone },
    { id: 'video' as StepId, label: 'Video', done: !!p.finalAssetId, open: clipsDone },
  ]
}

export function ProjectView({ id, tab, config, go }: { id: string; tab?: string; config: AppConfigDTO; go: (p: string) => void }) {
  const ctl = useProject(id)
  const v = ctl.view
  const steps = v ? stepList(v) : []
  const nextStep = steps.find((s) => s.open && !s.done) ?? steps[steps.length - 1]
  const current = steps.find((s) => s.id === tab && s.open) ?? nextStep
  // New step on screen → start at the top.
  useEffect(() => window.scrollTo({ top: 0 }), [current?.id])
  if (!v || !current) return ctl.error ? <div className="toast">{ctl.error}</div> : <Working>Loading…</Working>

  // After an approval, jump to whatever needs attention next.
  const next = () => go(`p/${id}`)
  const props = { ctl, v, config, next }

  return (
    <>
      <div className="project-head">
        <h1>{v.project.name}</h1>
        <a className="muted" href="#/">
          All videos
        </a>
      </div>
      <nav className="stepper" aria-label="Progress">
        {steps.map((s, i) => (
          <button
            key={s.id}
            className={`step ${s.done ? 'done' : ''} ${s.id === current.id ? 'current' : ''}`}
            disabled={!s.open}
            onClick={() => go(`p/${id}/${s.id}`)}
            aria-current={s.id === current.id ? 'step' : undefined}
          >
            <span className="bar" />
            <span className="label">
              <span className="n">{s.done ? '✓' : i + 1}</span>
              <span className="t">{s.label}</span>
            </span>
          </button>
        ))}
      </nav>
      {ctl.error && (
        <div className="toast" onClick={() => ctl.setError(null)}>
          {ctl.error} <span className="tiny">(click to dismiss)</span>
        </div>
      )}
      {current.id === 'photo' && <PhotoStep {...props} />}
      {current.id === 'area' && <AreaStep {...props} />}
      {current.id === 'plan' && <PlanStep {...props} />}
      {current.id === 'pictures' && <ImagesStep {...props} />}
      {current.id === 'clips' && <ClipsStep {...props} />}
      {current.id === 'video' && <ExportStep {...props} />}
    </>
  )
}
