import path from 'node:path'
import type { AppConfig } from './config.ts'
import { createInngestRunner } from './jobs/inngest.ts'
import { InProcessRunner, type JobRunner } from './jobs/runner.ts'
import { buildProviders } from './providers/registry.ts'
import type { ProviderRegistry } from './providers/types.ts'
import { LocalStorage, type MediaStorage, R2Storage } from './storage/storage.ts'
import { FileStore } from './store/file-store.ts'
import type { Store } from './store/store.ts'
import { SupabaseStore } from './store/supabase-store.ts'
import { WorkflowService } from './workflow/service.ts'

export interface Services {
  cfg: AppConfig
  store: Store
  storage: MediaStorage
  providers: ProviderRegistry
  runner: JobRunner
  workflow: WorkflowService
  inngestHandler: ((c: never) => Promise<Response>) | null
}

export function buildServices(cfg: AppConfig, overrides: Partial<Pick<Services, 'store' | 'storage' | 'providers'>> = {}): Services {
  const store =
    overrides.store ??
    (cfg.supabase.url && cfg.supabase.serviceRoleKey
      ? new SupabaseStore(cfg.supabase.url, cfg.supabase.serviceRoleKey)
      : new FileStore(path.join(cfg.dataDir, 'db.json')))

  const r2 = cfg.r2
  const storage =
    overrides.storage ??
    (r2.accountId && r2.accessKeyId && r2.secretAccessKey && r2.bucket
      ? new R2Storage({ ...r2 })
      : new LocalStorage(path.join(cfg.dataDir, 'media')))

  const providers = overrides.providers ?? buildProviders(cfg)

  let runner: JobRunner
  let inngestHandler: Services['inngestHandler'] = null
  const workflow = new WorkflowService({ cfg, store, storage, providers, runner: () => runner })
  const execute = (id: string, ctx: Parameters<WorkflowService['executeJob']>[1], attempt: number) => workflow.executeJob(id, ctx, attempt)
  const fail = (id: string, err: Error) => workflow.failJob(id, err)
  if (cfg.inngest.enabled) {
    const inn = createInngestRunner(cfg.inngest.appId, execute, fail)
    runner = inn.runner
    inngestHandler = inn.handler as never
  } else {
    runner = new InProcessRunner(execute, fail)
  }
  return { cfg, store, storage, providers, runner, workflow, inngestHandler }
}
