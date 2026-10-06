import { Inngest, NonRetriableError } from 'inngest'
import { serve } from 'inngest/hono'
import { type ExecuteJob, type FailJob, isPermanent, type JobContext, type JobRunner } from './runner.ts'

const EVENT = 'alto/video-factory.job.requested'

/**
 * Durable runner: every job is one Inngest function run. `ctx.step` maps to
 * `step.run` (memoized across retries) and `ctx.sleep` to `step.sleep`, so a
 * 10-minute Veo render polls without holding a server request open.
 */
export function createInngestRunner(appId: string, execute: ExecuteJob, fail: FailJob) {
  const inngest = new Inngest({ id: appId })

  const runJob = inngest.createFunction(
    {
      id: 'run-job',
      retries: 3,
      triggers: [{ event: EVENT }],
      concurrency: { limit: 8 },
      onFailure: async ({ event, error }) => {
        const jobId = (event.data.event.data as { jobId: string }).jobId
        await fail(jobId, error)
      },
    },
    async ({ event, step, attempt }) => {
      const jobId = (event.data as { jobId: string }).jobId
      const ctx: JobContext = {
        step: (name, fn) => step.run(name, fn) as never,
        sleep: (name, ms) => step.sleep(name, `${Math.max(1, Math.round(ms / 1000))}s`),
      }
      try {
        await execute(jobId, ctx, attempt)
      } catch (e) {
        if (isPermanent(e)) throw new NonRetriableError((e as Error).message, { cause: e })
        throw e
      }
    },
  )

  const runner: JobRunner = {
    kind: `inngest (${appId})`,
    async enqueue(jobId) {
      await inngest.send({ name: EVENT, data: { jobId } })
    },
  }

  const handler = serve({ client: inngest, functions: [runJob] })
  return { runner, handler }
}
