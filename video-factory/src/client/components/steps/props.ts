import type { AppConfigDTO, JobType, ProjectViewDTO } from '../../../shared/types.ts'
import type { ProjectCtl } from '../../lib/api.ts'

export interface StepProps {
  ctl: ProjectCtl
  v: ProjectViewDTO
  config: AppConfigDTO
  /** Go to whatever needs attention next. */
  next: () => void
}

export function jobState(v: ProjectViewDTO, type: JobType, targetId: string | null) {
  const jobs = v.jobs.filter((j) => j.type === type && j.targetId === targetId)
  const last = jobs.at(-1)
  return {
    running: jobs.some((j) => j.status === 'queued' || j.status === 'running'),
    failed: last?.status === 'failed' ? last.error ?? 'Something went wrong.' : null,
    message: last?.message,
  }
}
