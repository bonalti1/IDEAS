import { allStagesApproved, transitionsCurrent } from '../../shared/gates.ts'
import { getTrade } from '../../shared/trades.ts'
import type { AppConfigDTO, ProjectViewDTO } from '../../shared/types.ts'
import { useProject } from '../lib/api.ts'
import { ClipsPanel } from './ClipsPanel.tsx'
import { ExportPanel } from './ExportPanel.tsx'
import { MaskPanel } from './MaskPanel.tsx'
import { PlanPanel } from './PlanPanel.tsx'
import { ScenePanel } from './ScenePanel.tsx'
import { StagesPanel } from './StagesPanel.tsx'
import { JobLine, Spinner } from './ui.tsx'

type Tab = 'scene' | 'mask' | 'plan' | 'stages' | 'clips' | 'export'

function steps(v: ProjectViewDTO) {
  const p = v.project
  const stagesDone = allStagesApproved(v)
  const clipsDone = stagesDone && transitionsCurrent(v) && v.transitions.every((t) => t.approvedTakeId)
  const approvedStages = v.stages.filter((s) => s.approvedCandidateId).length
  const approvedClips = v.transitions.filter((t) => t.approvedTakeId).length
  return [
    { id: 'scene' as Tab, label: 'Scene', done: !!p.sceneApprovedAt, open: true, note: p.scene ? '' : 'not analyzed' },
    { id: 'mask' as Tab, label: 'Work area', done: !!p.maskApprovedAt, open: !!p.sceneApprovedAt, note: '' },
    { id: 'plan' as Tab, label: 'Stage plan', done: !!p.planApprovedAt, open: !!p.maskApprovedAt, note: v.stages.length ? `${v.stages.length} stages` : '' },
    { id: 'stages' as Tab, label: 'Stage images', done: stagesDone, open: !!p.planApprovedAt, note: v.stages.length ? `${approvedStages}/${v.stages.length}` : '' },
    { id: 'clips' as Tab, label: 'Clips', done: clipsDone, open: stagesDone, note: v.transitions.length ? `${approvedClips}/${v.transitions.length}` : '' },
    { id: 'export' as Tab, label: 'Export', done: !!p.finalAssetId, open: clipsDone, note: '' },
  ]
}

export function ProjectView({ id, tab, config, go }: { id: string; tab?: string; config: AppConfigDTO; go: (p: string) => void }) {
  const ctl = useProject(id)
  const v = ctl.view
  if (!v) return <div className="panel">{ctl.error ? <p className="err">{ctl.error}</p> : <Spinner />}</div>

  const list = steps(v)
  const firstOpen = [...list].reverse().find((s) => s.open && !s.done) ?? list.find((s) => !s.done) ?? list[list.length - 1]
  const current = (list.find((s) => s.id === tab)?.id ?? firstOpen.id) as Tab
  const jobs = v.jobs.filter((j) => j.status !== 'succeeded')

  return (
    <div className="project">
      <header className="project-head">
        <div>
          <h1>{v.project.name}</h1>
          <p className="muted">
            {getTrade(v.project.trade).label} · {v.project.videoAspect} · {v.project.desiredResult}
          </p>
        </div>
      </header>
      <nav className="steps">
        {list.map((s, i) => (
          <button
            key={s.id}
            className={`step ${s.id === current ? 'current' : ''} ${s.done ? 'done' : ''} ${s.open ? '' : 'locked'}`}
            onClick={() => go(`p/${id}/${s.id}`)}
          >
            <span className="step-n">{s.done ? '✓' : s.open ? i + 1 : '🔒'}</span>
            <span>{s.label}</span>
            {s.note && <span className="step-note">{s.note}</span>}
          </button>
        ))}
      </nav>
      {jobs.length > 0 && (
        <div className="jobs">
          {jobs.map((j) => (
            <JobLine key={j.id} job={j} />
          ))}
        </div>
      )}
      {ctl.error && (
        <div className="toast err" onClick={() => ctl.setError(null)}>
          {ctl.error}
        </div>
      )}
      {current === 'scene' && <ScenePanel ctl={ctl} v={v} />}
      {current === 'mask' && <MaskPanel ctl={ctl} v={v} />}
      {current === 'plan' && <PlanPanel ctl={ctl} v={v} />}
      {current === 'stages' && <StagesPanel ctl={ctl} v={v} config={config} />}
      {current === 'clips' && <ClipsPanel ctl={ctl} v={v} config={config} />}
      {current === 'export' && <ExportPanel ctl={ctl} v={v} />}
    </div>
  )
}
