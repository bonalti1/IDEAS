import fs from 'node:fs/promises'
import path from 'node:path'
import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { TRADES } from '../shared/trades.ts'
import type { AppConfigDTO, TradeId, VideoAspect } from '../shared/types.ts'
import type { Services } from './services.ts'
import { LocalStorage } from './storage/storage.ts'
import { HttpError } from './workflow/service.ts'

const MAX_UPLOAD = 40 * 1024 * 1024

export function createApp(svc: Services) {
  const app = new Hono()
  const wf = svc.workflow

  app.onError((err, c) => {
    const status = (err as HttpError).status ?? 500
    if (status >= 500) console.error(err)
    return c.json({ error: err.message }, status as 400)
  })

  // Optional shared token for the internal API (media and Inngest are exempt).
  if (svc.cfg.apiToken) {
    app.use('/api/*', async (c, next) => {
      if (c.req.path.startsWith('/api/inngest')) return next()
      if (c.req.header('authorization') !== `Bearer ${svc.cfg.apiToken}`) throw new HttpError(401, 'Unauthorized')
      return next()
    })
  }

  const json = async <T>(c: Context): Promise<T> => {
    try {
      return (await c.req.json()) as T
    } catch {
      return {} as T
    }
  }
  const pid = (c: Context) => c.req.param('projectId')!
  const view = (c: Context) => wf.view(pid(c)).then((v) => c.json(v))

  app.get('/api/health', (c) => c.json({ ok: true }))

  app.get('/api/config', (c) => {
    const p = svc.providers
    const dto: AppConfigDTO = {
      providers: [p.analyst.info, ...p.images.map((x) => x.info), ...p.videos.map((x) => x.info), p.segmenter.info],
      trades: Object.values(TRADES).map((t) => ({ id: t.id, label: t.label, defaultResult: t.defaultResult })),
      storage: svc.storage.kind,
      store: svc.store.kind,
      jobs: svc.runner.kind,
    }
    return c.json(dto)
  })

  app.get('/api/projects', async (c) => c.json(await wf.listProjects()))

  app.post('/api/projects', bodyLimit({ maxSize: MAX_UPLOAD }), async (c) => {
    const form = await c.req.formData()
    const photo = form.get('photo')
    if (!(photo instanceof File)) throw new HttpError(400, 'photo file is required')
    const p = await wf.createProject({
      name: String(form.get('name') ?? ''),
      trade: String(form.get('trade') ?? 'concrete_driveway') as TradeId,
      desiredResult: String(form.get('desiredResult') ?? ''),
      videoAspect: (form.get('videoAspect') || undefined) as VideoAspect | undefined,
      photo: Buffer.from(await photo.arrayBuffer()),
    })
    return c.json(p, 201)
  })

  app.get('/api/projects/:projectId', view)

  // scene
  app.post('/api/projects/:projectId/scene/analyze', async (c) => (await wf.analyzeScene(pid(c)), view(c)))
  app.put('/api/projects/:projectId/scene', async (c) => (await wf.updateScene(pid(c), await json(c)), view(c)))
  app.post('/api/projects/:projectId/scene/approve', async (c) => (await wf.approveScene(pid(c)), view(c)))

  // mask
  app.post('/api/projects/:projectId/mask/auto', async (c) => (await wf.autoMask(pid(c)), view(c)))
  app.put('/api/projects/:projectId/mask', bodyLimit({ maxSize: MAX_UPLOAD }), async (c) => {
    const form = await c.req.formData()
    const mask = form.get('mask')
    if (!(mask instanceof File)) throw new HttpError(400, 'mask PNG is required')
    await wf.saveManualMask(pid(c), Buffer.from(await mask.arrayBuffer()))
    return view(c)
  })
  app.post('/api/projects/:projectId/mask/approve', async (c) => (await wf.approveMask(pid(c)), view(c)))

  // plan
  app.post('/api/projects/:projectId/plan/propose', async (c) => (await wf.proposePlan(pid(c)), view(c)))
  app.put('/api/projects/:projectId/plan', async (c) => {
    const body = await json<{ stages?: [] }>(c)
    if (!Array.isArray(body.stages)) throw new HttpError(400, 'stages[] is required')
    await wf.savePlan(pid(c), body.stages)
    return view(c)
  })
  app.post('/api/projects/:projectId/plan/approve', async (c) => (await wf.approvePlan(pid(c)), view(c)))

  app.post('/api/projects/:projectId/reopen', async (c) => {
    const { step } = await json<{ step: 'scene' | 'mask' | 'plan' }>(c)
    if (!['scene', 'mask', 'plan'].includes(step)) throw new HttpError(400, 'step must be scene, mask or plan')
    await wf.reopen(pid(c), step)
    return view(c)
  })

  // stages
  const sid = (c: Context) => c.req.param('stageId')!
  app.post('/api/projects/:projectId/stages/:stageId/prompt/compose', async (c) => (await wf.composePrompt(pid(c), sid(c)), view(c)))
  app.put('/api/projects/:projectId/stages/:stageId/prompt', async (c) => {
    const { prompt } = await json<{ prompt?: string }>(c)
    if (typeof prompt !== 'string') throw new HttpError(400, 'prompt is required')
    await wf.editPrompt(pid(c), sid(c), prompt)
    return view(c)
  })
  app.post('/api/projects/:projectId/stages/:stageId/prompt/approve', async (c) => {
    const body = await json<{ generate?: boolean; providers?: string[] }>(c)
    await wf.approvePrompt(pid(c), sid(c), body)
    return view(c)
  })
  app.post('/api/projects/:projectId/stages/:stageId/candidates', async (c) => {
    const { providers } = await json<{ providers?: string[] }>(c)
    await wf.generateCandidates(pid(c), sid(c), providers)
    return view(c)
  })
  app.post('/api/projects/:projectId/stages/:stageId/approve', async (c) => {
    const { candidateId } = await json<{ candidateId?: string }>(c)
    if (!candidateId) throw new HttpError(400, 'candidateId is required')
    await wf.approveCandidate(pid(c), sid(c), candidateId)
    return view(c)
  })
  app.post('/api/projects/:projectId/stages/:stageId/reopen', async (c) => (await wf.reopenStage(pid(c), sid(c)), view(c)))

  // clips
  const tid = (c: Context) => c.req.param('transitionId')!
  app.post('/api/projects/:projectId/transitions/prepare', async (c) => (await wf.prepareTransitions(pid(c)), view(c)))
  app.put('/api/projects/:projectId/transitions/:transitionId', async (c) => (await wf.editTransition(pid(c), tid(c), await json(c)), view(c)))
  app.post('/api/projects/:projectId/transitions/:transitionId/takes', async (c) => {
    const { providers } = await json<{ providers?: string[] }>(c)
    await wf.generateTakes(pid(c), tid(c), providers)
    return view(c)
  })
  app.post('/api/projects/:projectId/transitions/:transitionId/approve', async (c) => {
    const { takeId } = await json<{ takeId?: string }>(c)
    if (!takeId) throw new HttpError(400, 'takeId is required')
    await wf.approveTake(pid(c), tid(c), takeId)
    return view(c)
  })
  app.post('/api/projects/:projectId/transitions/:transitionId/reopen', async (c) => (await wf.reopenTransition(pid(c), tid(c)), view(c)))

  // export
  app.put('/api/projects/:projectId/branding', async (c) => (await wf.updateBranding(pid(c), await json(c)), view(c)))
  app.post('/api/projects/:projectId/render', async (c) => (await wf.render(pid(c)), view(c)))

  if (svc.inngestHandler) app.on(['GET', 'POST', 'PUT'], '/api/inngest', svc.inngestHandler as never)

  // Local media (when not using R2).
  if (svc.storage instanceof LocalStorage) {
    const local = svc.storage
    app.get('/media/*', async (c) => {
      const key = decodeURIComponent(c.req.path.slice('/media/'.length))
      let file: string
      try {
        file = local.filePath(key)
      } catch {
        throw new HttpError(400, 'Bad key')
      }
      const data = await fs.readFile(file).catch(() => null)
      if (!data) throw new HttpError(404, 'Not found')
      const type = MIME[path.extname(file).slice(1)] ?? 'application/octet-stream'
      return c.body(new Uint8Array(data), 200, { 'content-type': type, 'cache-control': 'private, max-age=31536000, immutable' })
    })
  }

  return app
}

const MIME: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', mp4: 'video/mp4', heif: 'image/heif', avif: 'image/avif', tiff: 'image/tiff' }
