/**
 * Job handlers are written once against JobContext. Each `step` must return
 * JSON-serializable data (ids, not buffers): under Inngest every step result
 * is memoized and replayed, so finished steps are not re-run on retry.
 */
export interface JobContext {
  step<T>(name: string, fn: () => Promise<T>): Promise<T>
  sleep(name: string, ms: number): Promise<void>
}

export type ExecuteJob = (jobId: string, ctx: JobContext, attempt: number) => Promise<void>
export type FailJob = (jobId: string, error: Error) => Promise<void>

export interface JobRunner {
  readonly kind: string
  enqueue(jobId: string): Promise<void>
}

/** Errors that retrying cannot fix (gate violations, content-policy refusals, bad input). */
export class PermanentError extends Error {
  readonly permanent = true
}

export const isPermanent = (e: unknown) => !!(e as { permanent?: boolean })?.permanent || (e as { status?: number })?.status === 409

/**
 * In-process runner for local development and tests. Same retry semantics as
 * the Inngest function (exponential backoff, permanent errors fail fast), but
 * jobs do not survive a server restart.
 */
export class InProcessRunner implements JobRunner {
  readonly kind = 'in-process'
  private running = new Set<Promise<void>>()

  constructor(
    private execute: ExecuteJob,
    private fail: FailJob,
    private opts = { retries: 2, backoffMs: 2000 },
  ) {}

  async enqueue(jobId: string) {
    const p = this.run(jobId).finally(() => this.running.delete(p))
    this.running.add(p)
  }

  private async run(jobId: string) {
    const memo = new Map<string, unknown>()
    const ctx: JobContext = {
      step: async (name, fn) => {
        if (memo.has(name)) return memo.get(name) as never
        const v = await fn()
        memo.set(name, v)
        return v
      },
      sleep: (_name, ms) => new Promise((r) => setTimeout(r, ms)),
    }
    for (let attempt = 0; ; attempt++) {
      try {
        await this.execute(jobId, ctx, attempt)
        return
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e))
        if (isPermanent(err) || attempt >= this.opts.retries) {
          await this.fail(jobId, err).catch((x) => console.error('failed to record job failure', x))
          return
        }
        console.warn(`job ${jobId} attempt ${attempt + 1} failed, retrying: ${err.message}`)
        await new Promise((r) => setTimeout(r, this.opts.backoffMs * 2 ** attempt))
      }
    }
  }

  /** Test helper: wait until every queued job has settled. */
  async drain() {
    while (this.running.size) await Promise.allSettled([...this.running])
  }
}
