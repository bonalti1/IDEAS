import type { Asset, Candidate, Job, Project, Stage, Take, Transition } from '../../shared/types.ts'

export interface Tables {
  projects: Project
  assets: Asset
  stages: Stage
  candidates: Candidate
  transitions: Transition
  takes: Take
  jobs: Job
}

export type TableName = keyof Tables

/**
 * Minimal row store. Workflow rules live in the service layer (shared/gates.ts),
 * so implementations only need CRUD + equality filters.
 */
export interface Store {
  readonly kind: string
  insert<T extends TableName>(table: T, row: Tables[T]): Promise<Tables[T]>
  get<T extends TableName>(table: T, id: string): Promise<Tables[T] | null>
  update<T extends TableName>(table: T, id: string, patch: Partial<Tables[T]>): Promise<Tables[T]>
  list<T extends TableName>(table: T, where?: Partial<Tables[T]>): Promise<Tables[T][]>
  remove(table: TableName, id: string): Promise<void>
}

export class NotFoundError extends Error {
  status = 404
}

export function matches<R extends object>(row: R, where?: Partial<R>): boolean {
  if (!where) return true
  return Object.entries(where).every(([k, v]) => (row as Record<string, unknown>)[k] === v)
}
