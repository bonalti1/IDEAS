import { nanoid } from 'nanoid'
import sharp from 'sharp'
import * as G from '../../shared/gates.ts'
import { getTrade, TRADES } from '../../shared/trades.ts'
import type {
  Asset,
  AssetKind,
  BrandingOptions,
  Candidate,
  GateResult,
  ImageReview,
  ClipReview,
  Job,
  JobType,
  PlanStageInput,
  Project,
  ProjectSnapshot,
  ProjectViewDTO,
  SceneAnalysis,
  Stage,
  Take,
  TradeId,
  Transition,
  VideoAspect,
} from '../../shared/types.ts'
import type { AppConfig } from '../config.ts'
import type { JobContext, JobRunner } from '../jobs/runner.ts'
import { PermanentError } from '../jobs/runner.ts'
import { cropToAspect, fitExactly, normalizeMask, normalizePhoto, sha256, toImageInput } from '../media/images.ts'
import { assemble, probeBytes, sampleFrames } from '../media/video.ts'
import { pick } from '../providers/registry.ts'
import type { ImageInput, ProviderRegistry } from '../providers/types.ts'
import type { MediaStorage } from '../storage/storage.ts'
import type { Store } from '../store/store.ts'
import { templateStagePrompt, templateTransitionPrompt } from './prompts.ts'

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

/** Gate violation → 409 for the API, permanent failure for a job. */
export class GateError extends HttpError {
  readonly permanent = true
  constructor(reason: string) {
    super(409, reason)
  }
}

function assertGate(g: GateResult) {
  if (!g.ok) throw new GateError(g.reason)
}

const now = () => new Date().toISOString()
const id = (prefix: string) => `${prefix}_${nanoid(14)}`
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo))

export const DEFAULT_BRANDING: BrandingOptions = {
  enabled: true,
  title: 'Alto Pro',
  subtitle: '',
  introSeconds: 2.5,
  outroSeconds: 3,
  outroText: 'Built by Alto Pro',
  watermark: true,
  holdFinalSeconds: 1.5,
}

export interface Deps {
  cfg: AppConfig
  store: Store
  storage: MediaStorage
  providers: ProviderRegistry
  runner: () => JobRunner
}

export class WorkflowService {
  constructor(private d: Deps) {}

  // ---- reads ---------------------------------------------------------------------

  async snapshot(projectId: string): Promise<ProjectSnapshot> {
    const project = await this.d.store.get('projects', projectId)
    if (!project) throw new HttpError(404, 'Project not found')
    const [stages, candidates, transitions, takes, jobs] = await Promise.all([
      this.d.store.list('stages', { projectId }),
      this.d.store.list('candidates', { projectId }),
      this.d.store.list('transitions', { projectId }),
      this.d.store.list('takes', { projectId }),
      this.d.store.list('jobs', { projectId }),
    ])
    const byTime = <T extends { createdAt: string }>(a: T, b: T) => a.createdAt.localeCompare(b.createdAt)
    return {
      project,
      stages: stages.sort((a, b) => a.index - b.index),
      candidates: candidates.sort(byTime),
      transitions: transitions.sort((a, b) => a.index - b.index),
      takes: takes.sort(byTime),
      jobs: jobs.sort(byTime),
    }
  }

  async view(projectId: string): Promise<ProjectViewDTO> {
    const s = await this.snapshot(projectId)
    const assets = await this.d.store.list('assets', { projectId })
    const assetMap: Record<string, Asset> = {}
    const assetUrls: Record<string, string> = {}
    await Promise.all(
      assets.map(async (a) => {
        assetMap[a.id] = a
        assetUrls[a.id] = await this.d.storage.url(a.storageKey)
      }),
    )
    // Only recent jobs matter to the UI.
    const jobs = s.jobs.filter((j) => j.status === 'queued' || j.status === 'running' || Date.now() - Date.parse(j.updatedAt) < 10 * 60_000)
    return { ...s, jobs, assets: assetMap, assetUrls, gates: G.summarizeGates(s) }
  }

  async listProjects() {
    const ps = await this.d.store.list('projects')
    return ps.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  // ---- assets --------------------------------------------------------------------

  private async putAsset(projectId: string, kind: AssetKind, bytes: Buffer, mimeType: string, extra: Partial<Asset> = {}) {
    const assetId = id('ast')
    const ext = mimeType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'bin'
    const key = `projects/${projectId}/${kind}/${assetId}.${ext}`
    await this.d.storage.put(key, bytes, mimeType)
    const asset: Asset = {
      id: assetId,
      projectId,
      kind,
      storageKey: key,
      mimeType,
      bytes: bytes.length,
      sha256: sha256(bytes),
      width: null,
      height: null,
      durationSec: null,
      immutable: true,
      createdAt: now(),
      ...extra,
    }
    return this.d.store.insert('assets', asset)
  }

  private async asset(assetId: string) {
    const a = await this.d.store.get('assets', assetId)
    if (!a) throw new HttpError(404, `Asset ${assetId} not found`)
    return a
  }

  private async bytes(assetId: string) {
    return this.d.storage.get((await this.asset(assetId)).storageKey)
  }

  private async image(assetId: string): Promise<ImageInput> {
    const a = await this.asset(assetId)
    return toImageInput(await this.d.storage.get(a.storageKey), a.mimeType)
  }

  // ---- jobs ----------------------------------------------------------------------

  private async startJob(projectId: string, type: JobType, targetId: string | null): Promise<Job> {
    const job: Job = {
      id: id('job'),
      projectId,
      type,
      targetId,
      status: 'queued',
      progress: 0,
      message: 'Queued',
      error: null,
      attempts: 0,
      createdAt: now(),
      updatedAt: now(),
    }
    await this.d.store.insert('jobs', job)
    await this.d.runner().enqueue(job.id)
    return job
  }

  private progress(jobId: string, progress: number, message: string) {
    return this.d.store.update('jobs', jobId, { progress, message, updatedAt: now() })
  }

  // ---- project + upload ----------------------------------------------------------

  async createProject(i: { name: string; trade: TradeId; desiredResult?: string; photo: Buffer; videoAspect?: VideoAspect }) {
    const trade = TRADES[i.trade]
    if (!trade) throw new HttpError(400, `Unknown trade: ${i.trade}`)
    if (!i.photo?.length) throw new HttpError(400, 'A project photo is required')
    let norm
    try {
      norm = await normalizePhoto(i.photo)
    } catch (e) {
      throw new HttpError(400, (e as Error).message)
    }
    const projectId = id('prj')
    const t = now()
    const project: Project = {
      id: projectId,
      name: i.name.trim() || 'Untitled project',
      trade: trade.id,
      desiredResult: i.desiredResult?.trim() || trade.defaultResult,
      originalAssetId: '',
      normalizedAssetId: '',
      scene: null,
      sceneApprovedAt: null,
      maskAssetId: null,
      maskSource: null,
      maskConfidence: null,
      maskApprovedAt: null,
      planApprovedAt: null,
      videoAspect: i.videoAspect ?? (norm.width >= norm.height ? '16:9' : '9:16'),
      branding: { ...DEFAULT_BRANDING, subtitle: trade.label },
      finalAssetId: null,
      createdAt: t,
      updatedAt: t,
    }
    await this.d.store.insert('projects', project)
    // The upload is stored byte-for-byte and never touched again.
    const meta = await sharp(i.photo).metadata()
    const original = await this.putAsset(projectId, 'original', i.photo, `image/${meta.format}`, { width: meta.width ?? null, height: meta.height ?? null })
    const normalized = await this.putAsset(projectId, 'normalized', norm.bytes, norm.mimeType, { width: norm.width, height: norm.height })
    return this.d.store.update('projects', projectId, { originalAssetId: original.id, normalizedAssetId: normalized.id, updatedAt: now() })
  }

  private touch(projectId: string, patch: Partial<Project> = {}) {
    return this.d.store.update('projects', projectId, { ...patch, updatedAt: now() })
  }

  // ---- scene ---------------------------------------------------------------------

  async analyzeScene(projectId: string) {
    const s = await this.snapshot(projectId)
    assertGate(G.canAnalyzeScene(s))
    return this.startJob(projectId, 'analyze_scene', projectId)
  }

  async updateScene(projectId: string, scene: Partial<SceneAnalysis>) {
    const s = await this.snapshot(projectId)
    assertGate(G.canEditScene(s))
    const merged = sanitizeScene({ ...s.project.scene!, ...scene, analyzedBy: s.project.scene!.analyzedBy })
    return this.touch(projectId, { scene: merged })
  }

  async approveScene(projectId: string) {
    assertGate(G.canApproveScene(await this.snapshot(projectId)))
    return this.touch(projectId, { sceneApprovedAt: now() })
  }

  // ---- mask ----------------------------------------------------------------------

  async autoMask(projectId: string) {
    assertGate(G.canEditMask(await this.snapshot(projectId)))
    return this.startJob(projectId, 'auto_mask', projectId)
  }

  async saveManualMask(projectId: string, png: Buffer) {
    const s = await this.snapshot(projectId)
    assertGate(G.canEditMask(s))
    const base = await this.asset(s.project.normalizedAssetId)
    const mask = await normalizeMask(png, base.width!, base.height!)
    const a = await this.putAsset(projectId, 'mask', mask, 'image/png', { width: base.width, height: base.height })
    return this.touch(projectId, { maskAssetId: a.id, maskSource: 'manual', maskConfidence: null })
  }

  async approveMask(projectId: string) {
    assertGate(G.canApproveMask(await this.snapshot(projectId)))
    return this.touch(projectId, { maskApprovedAt: now() })
  }

  // ---- plan ----------------------------------------------------------------------

  async proposePlan(projectId: string) {
    assertGate(G.canEditPlan(await this.snapshot(projectId)))
    return this.startJob(projectId, 'propose_plan', projectId)
  }

  /** Replace the plan. Stages keep their id (and prompt) when `id` is passed back. */
  async savePlan(projectId: string, input: (PlanStageInput & { id?: string })[]) {
    const s = await this.snapshot(projectId)
    assertGate(G.canEditPlan(s))
    await this.writePlan(s, input)
    return this.snapshot(projectId)
  }

  private async writePlan(s: ProjectSnapshot, input: (PlanStageInput & { id?: string })[]) {
    if (input.length > 12) throw new HttpError(400, 'A plan can have at most 12 stages')
    const keep = new Set(input.map((x) => x.id).filter(Boolean))
    for (const st of s.stages) {
      if (keep.has(st.id)) continue
      for (const c of s.candidates.filter((c) => c.stageId === st.id)) await this.d.store.remove('candidates', c.id)
      await this.d.store.remove('stages', st.id)
    }
    for (const [index, x] of input.entries()) {
      const fields = {
        index,
        title: String(x.title ?? '').trim(),
        description: String(x.description ?? '').trim(),
        checklist: (x.checklist ?? []).map(String).map((c) => c.trim()).filter(Boolean),
        motionHint: String(x.motionHint ?? '').trim(),
        updatedAt: now(),
      }
      const existing = x.id ? s.stages.find((st) => st.id === x.id) : undefined
      if (existing) {
        const changed = existing.title !== fields.title || existing.description !== fields.description || existing.index !== index
        // Changing what a stage is invalidates its prompt.
        await this.d.store.update('stages', existing.id, changed ? { ...fields, prompt: null, promptSource: null, promptApprovedAt: null } : fields)
      } else {
        await this.d.store.insert('stages', {
          id: id('stg'),
          projectId: s.project.id,
          ...fields,
          prompt: null,
          promptSource: null,
          promptApprovedAt: null,
          approvedCandidateId: null,
          approvedAt: null,
        })
      }
    }
  }

  async approvePlan(projectId: string) {
    assertGate(G.canApprovePlan(await this.snapshot(projectId)))
    return this.touch(projectId, { planApprovedAt: now() })
  }

  // ---- reopen (explicit, cascading invalidation) ------------------------------------

  async reopen(projectId: string, step: 'scene' | 'mask' | 'plan') {
    const s = await this.snapshot(projectId)
    const patch: Partial<Project> = { planApprovedAt: null, finalAssetId: null }
    if (step === 'scene' || step === 'mask') patch.maskApprovedAt = null
    if (step === 'scene') patch.sceneApprovedAt = null
    await this.invalidateStagesFrom(s, 0, { clearPrompts: true })
    return this.touch(projectId, patch)
  }

  /** Clears approvals of every stage with index >= from, and all clips. */
  private async invalidateStagesFrom(s: ProjectSnapshot, from: number, o: { clearPrompts: boolean }) {
    for (const st of s.stages.filter((x) => x.index >= from)) {
      const patch: Partial<Stage> = { approvedCandidateId: null, approvedAt: null, updatedAt: now() }
      if (o.clearPrompts || st.index > from) patch.promptApprovedAt = null
      if (st.approvedCandidateId || patch.promptApprovedAt === null) await this.d.store.update('stages', st.id, patch)
    }
    await this.clearTransitions(s)
  }

  private async clearTransitions(s: ProjectSnapshot) {
    for (const tk of s.takes) await this.d.store.remove('takes', tk.id)
    for (const t of s.transitions) await this.d.store.remove('transitions', t.id)
    if (s.project.finalAssetId) await this.touch(s.project.id, { finalAssetId: null })
  }

  // ---- stages: prompt ------------------------------------------------------------------

  private async stageCtx(projectId: string, stageId: string) {
    const s = await this.snapshot(projectId)
    const stage = s.stages.find((x) => x.id === stageId)
    if (!stage) throw new HttpError(404, 'Stage not found')
    return { s, stage }
  }

  async composePrompt(projectId: string, stageId: string) {
    const { s, stage } = await this.stageCtx(projectId, stageId)
    assertGate(G.canComposePrompt(s, stage))
    await this.d.store.update('stages', stage.id, { promptApprovedAt: null, updatedAt: now() })
    return this.startJob(projectId, 'compose_prompt', stage.id)
  }

  async editPrompt(projectId: string, stageId: string, prompt: string) {
    const { s, stage } = await this.stageCtx(projectId, stageId)
    assertGate(G.canEditPrompt(s, stage))
    if (G.hasActiveJob(s, 'compose_prompt', stage.id)) throw new GateError('Prompt is being composed.')
    return this.d.store.update('stages', stage.id, { prompt: prompt.trim(), promptSource: 'user', promptApprovedAt: null, updatedAt: now() })
  }

  async approvePrompt(projectId: string, stageId: string) {
    const { s, stage } = await this.stageCtx(projectId, stageId)
    assertGate(G.canApprovePrompt(s, stage))
    if (G.hasActiveJob(s, 'compose_prompt', stage.id)) throw new GateError('Prompt is being composed.')
    return this.d.store.update('stages', stage.id, { promptApprovedAt: now(), updatedAt: now() })
  }

  // ---- stages: candidates -----------------------------------------------------------

  async generateCandidates(projectId: string, stageId: string, providerIds?: string[]) {
    const { s, stage } = await this.stageCtx(projectId, stageId)
    assertGate(G.canGenerateCandidates(s, stage))
    const gens = pick(this.d.providers.images, providerIds, 'image')
    const base = G.expectedBaseAssetId(s, stage)!
    const refs = stage.index > 0 ? [s.project.normalizedAssetId] : []
    const created: Candidate[] = []
    for (const g of gens) {
      const c: Candidate = {
        id: id('cnd'),
        projectId,
        stageId: stage.id,
        provider: g.info.id,
        model: g.info.model,
        prompt: stage.prompt!,
        baseAssetId: base,
        referenceAssetIds: refs,
        maskAssetId: s.project.maskAssetId,
        assetId: null,
        status: 'pending',
        error: null,
        review: null,
        reviewError: null,
        jobId: null,
        createdAt: now(),
      }
      await this.d.store.insert('candidates', c)
      const job = await this.startJob(projectId, 'generate_candidate', c.id)
      created.push(await this.d.store.update('candidates', c.id, { jobId: job.id }))
    }
    return created
  }

  async approveCandidate(projectId: string, stageId: string, candidateId: string) {
    const { s, stage } = await this.stageCtx(projectId, stageId)
    const cand = s.candidates.find((c) => c.id === candidateId)
    if (!cand) throw new HttpError(404, 'Candidate not found')
    assertGate(G.canApproveCandidate(s, stage, cand))
    // Defensive: nothing downstream may survive a change to this stage.
    await this.invalidateStagesFrom(s, stage.index + 1, { clearPrompts: true })
    return this.d.store.update('stages', stage.id, { approvedCandidateId: cand.id, approvedAt: now(), updatedAt: now() })
  }

  async reopenStage(projectId: string, stageId: string) {
    const { s, stage } = await this.stageCtx(projectId, stageId)
    assertGate(G.canReopenStage(s, stage))
    await this.invalidateStagesFrom(s, stage.index, { clearPrompts: false })
    return this.snapshot(projectId)
  }

  // ---- transitions / clips --------------------------------------------------------

  async prepareTransitions(projectId: string) {
    const s = await this.snapshot(projectId)
    assertGate(G.canPrepareTransitions(s))
    await this.clearTransitions(s)
    const titles = new Map(s.stages.map((st) => [st.id, st.title]))
    for (const [index, f] of G.expectedTransitionFrames(s).entries()) {
      const toStage = s.stages.find((st) => st.id === f.toStageId)!
      const t: Transition = {
        id: id('trn'),
        projectId,
        index,
        ...f,
        prompt: templateTransitionPrompt({ scene: s.project.scene!, fromTitle: f.fromStageId ? titles.get(f.fromStageId)! : 'Original site', toStage }),
        durationSec: this.d.cfg.video.durationSec,
        approvedTakeId: null,
        approvedAt: null,
        createdAt: now(),
      }
      await this.d.store.insert('transitions', t)
    }
    return this.snapshot(projectId)
  }

  private async transitionCtx(projectId: string, transitionId: string) {
    const s = await this.snapshot(projectId)
    const t = s.transitions.find((x) => x.id === transitionId)
    if (!t) throw new HttpError(404, 'Clip not found')
    return { s, t }
  }

  async editTransition(projectId: string, transitionId: string, patch: { prompt?: string; durationSec?: number }) {
    const { s, t } = await this.transitionCtx(projectId, transitionId)
    assertGate(G.canEditTransition(s, t))
    return this.d.store.update('transitions', t.id, {
      ...(patch.prompt !== undefined ? { prompt: patch.prompt.trim() } : {}),
      ...(patch.durationSec !== undefined ? { durationSec: clamp(patch.durationSec, 2, 15) } : {}),
    })
  }

  async generateTakes(projectId: string, transitionId: string, providerIds?: string[]) {
    const { s, t } = await this.transitionCtx(projectId, transitionId)
    assertGate(G.canGenerateTake(s, t))
    if (!t.prompt.trim()) throw new GateError('The clip needs a prompt.')
    const gens = pick(this.d.providers.videos, providerIds, 'video')
    const out: Take[] = []
    for (const g of gens) {
      const take: Take = {
        id: id('tak'),
        projectId,
        transitionId: t.id,
        provider: g.info.id,
        model: g.info.model,
        prompt: t.prompt,
        operationId: null,
        assetId: null,
        frameAssetIds: [],
        status: 'pending',
        error: null,
        review: null,
        reviewError: null,
        jobId: null,
        createdAt: now(),
      }
      await this.d.store.insert('takes', take)
      const job = await this.startJob(projectId, 'generate_take', take.id)
      out.push(await this.d.store.update('takes', take.id, { jobId: job.id }))
    }
    return out
  }

  async approveTake(projectId: string, transitionId: string, takeId: string) {
    const { s, t } = await this.transitionCtx(projectId, transitionId)
    const take = s.takes.find((x) => x.id === takeId)
    if (!take) throw new HttpError(404, 'Take not found')
    assertGate(G.canApproveTake(s, t, take))
    await this.touch(projectId, { finalAssetId: null })
    return this.d.store.update('transitions', t.id, { approvedTakeId: take.id, approvedAt: now() })
  }

  async reopenTransition(projectId: string, transitionId: string) {
    const { s, t } = await this.transitionCtx(projectId, transitionId)
    assertGate(G.canReopenTransition(s, t))
    await this.touch(projectId, { finalAssetId: null })
    return this.d.store.update('transitions', t.id, { approvedTakeId: null, approvedAt: null })
  }

  // ---- export --------------------------------------------------------------------

  async updateBranding(projectId: string, b: Partial<BrandingOptions>) {
    const p = (await this.snapshot(projectId)).project
    const next: BrandingOptions = {
      ...p.branding,
      ...b,
      introSeconds: clamp(b.introSeconds ?? p.branding.introSeconds, 0, 10),
      outroSeconds: clamp(b.outroSeconds ?? p.branding.outroSeconds, 0, 10),
      holdFinalSeconds: clamp(b.holdFinalSeconds ?? p.branding.holdFinalSeconds, 0, 10),
    }
    return this.touch(projectId, { branding: next })
  }

  async render(projectId: string) {
    assertGate(G.canRender(await this.snapshot(projectId)))
    return this.startJob(projectId, 'render', projectId)
  }

  // =================================================================================
  // Job execution. Every handler re-checks its gate before writing results, so a
  // job that finishes after the user reopened a step cannot sneak output back in.
  // =================================================================================

  async executeJob(jobId: string, ctx: JobContext, attempt: number) {
    const job = await this.d.store.get('jobs', jobId)
    if (!job) throw new PermanentError(`Job ${jobId} not found`)
    if (job.status === 'succeeded') return
    await this.d.store.update('jobs', jobId, { status: 'running', attempts: attempt + 1, message: 'Running', updatedAt: now() })
    switch (job.type) {
      case 'analyze_scene':
        await this.runAnalyzeScene(job)
        break
      case 'auto_mask':
        await this.runAutoMask(job)
        break
      case 'propose_plan':
        await this.runProposePlan(job)
        break
      case 'compose_prompt':
        await this.runComposePrompt(job)
        break
      case 'generate_candidate':
        await this.runGenerateCandidate(job, ctx)
        break
      case 'generate_take':
        await this.runGenerateTake(job, ctx)
        break
      case 'render':
        await this.runRender(job, ctx)
        break
      default:
        throw new PermanentError(`Unknown job type ${(job as Job).type}`)
    }
    await this.d.store.update('jobs', jobId, { status: 'succeeded', progress: 1, message: 'Done', error: null, updatedAt: now() })
  }

  async failJob(jobId: string, err: Error) {
    const job = await this.d.store.get('jobs', jobId)
    if (!job) return
    console.error(`job ${job.type} ${jobId} failed: ${err.message}`)
    await this.d.store.update('jobs', jobId, { status: 'failed', error: err.message, message: 'Failed', updatedAt: now() })
    if (job.type === 'generate_candidate' && job.targetId) {
      await this.d.store.update('candidates', job.targetId, { status: 'failed', error: err.message }).catch(() => {})
    }
    if (job.type === 'generate_take' && job.targetId) {
      await this.d.store.update('takes', job.targetId, { status: 'failed', error: err.message }).catch(() => {})
    }
  }

  private async runAnalyzeScene(job: Job) {
    const s = await this.snapshot(job.projectId)
    const img = await this.image(s.project.normalizedAssetId)
    const a = this.d.providers.analyst
    const scene = await a.analyzeScene({ image: img, trade: getTrade(s.project.trade), desiredResult: s.project.desiredResult })
    const fresh = await this.snapshot(job.projectId)
    if (fresh.project.sceneApprovedAt) throw new GateError('Scene was approved while analysis ran; result discarded.')
    await this.touch(job.projectId, { scene: sanitizeScene({ ...scene, analyzedBy: { provider: a.info.id, model: a.info.model } }) })
  }

  private async runAutoMask(job: Job) {
    const s = await this.snapshot(job.projectId)
    if (!s.project.scene) throw new GateError('Analyze the scene first.')
    const img = await this.image(s.project.normalizedAssetId)
    const seg = this.d.providers.segmenter
    await this.progress(job.id, 0.2, `Segmenting with ${seg.info.label}`)
    const { mask, confidence } = await seg.segment({ image: img, box: s.project.scene.workArea.box, hint: s.project.scene.workArea.description })
    const fresh = await this.snapshot(job.projectId)
    if (!fresh.project.sceneApprovedAt || fresh.project.maskApprovedAt) throw new GateError('Mask step is no longer editable; result discarded.')
    const a = await this.putAsset(job.projectId, 'mask', await normalizeMask(mask, img.width, img.height), 'image/png', { width: img.width, height: img.height })
    await this.touch(job.projectId, { maskAssetId: a.id, maskSource: 'auto', maskConfidence: confidence })
  }

  private async runProposePlan(job: Job) {
    const s = await this.snapshot(job.projectId)
    if (!s.project.scene) throw new GateError('Analyze the scene first.')
    const plan = await this.d.providers.analyst.proposePlan({
      image: await this.image(s.project.normalizedAssetId),
      scene: s.project.scene,
      trade: getTrade(s.project.trade),
      desiredResult: s.project.desiredResult,
    })
    const fresh = await this.snapshot(job.projectId)
    if (fresh.project.planApprovedAt) throw new GateError('Plan was approved while the proposal ran; result discarded.')
    if (!plan.length) throw new PermanentError('The analyst returned an empty plan.')
    await this.writePlan(fresh, plan.slice(0, 8))
  }

  private async runComposePrompt(job: Job) {
    const { s, stage } = await this.stageCtx(job.projectId, job.targetId!)
    const trade = getTrade(s.project.trade)
    const scene = s.project.scene!
    const prev = G.previousStage(s, stage)
    const template = templateStagePrompt({ trade, scene, stage, stages: s.stages, hasPrevious: !!prev })
    const a = this.d.providers.analyst
    let prompt = template
    let source: Stage['promptSource'] = 'template'
    if (!a.info.fake) {
      prompt = await a.composeStagePrompt({
        original: await this.image(s.project.normalizedAssetId),
        previous: prev ? await this.image(G.approvedImageAssetId(s, prev)!) : null,
        mask: await this.image(s.project.maskAssetId!),
        scene,
        trade,
        stage,
        stages: s.stages,
        templatePrompt: template,
      })
      source = 'ai'
    }
    const fresh = await this.stageCtx(job.projectId, stage.id)
    assertGate(G.canEditPrompt(fresh.s, fresh.stage))
    await this.d.store.update('stages', stage.id, { prompt, promptSource: source, promptApprovedAt: null, updatedAt: now() })
  }

  private async runGenerateCandidate(job: Job, ctx: JobContext) {
    const cand = await this.d.store.get('candidates', job.targetId!)
    if (!cand) throw new PermanentError('Candidate not found')
    const gen = this.d.providers.images.find((g) => g.info.id === cand.provider)
    if (!gen) throw new PermanentError(`Image provider ${cand.provider} is no longer configured`)
    const { stage } = await this.stageCtx(job.projectId, cand.stageId)

    const assetId = await ctx.step('generate', async () => {
      await this.progress(job.id, 0.1, `Generating with ${gen.info.label}`)
      const base = await this.image(cand.baseAssetId)
      const refs = await Promise.all(cand.referenceAssetIds.map((r) => this.image(r)))
      const mask = await this.image(cand.maskAssetId!)
      const out = await gen.generate({ prompt: cand.prompt, base, references: refs, mask })
      // Keep every stage frame pixel-aligned with the original photo.
      const aligned = await fitExactly(out.bytes, base.width, base.height, 'png')
      const a = await this.putAsset(job.projectId, 'stage_image', aligned, 'image/png', { width: base.width, height: base.height })
      await this.d.store.update('candidates', cand.id, { assetId: a.id, status: 'ready', error: null })
      return a.id
    })

    await ctx.step('review', async () => {
      await this.progress(job.id, 0.7, 'Reviewing with vision model')
      const s = await this.snapshot(job.projectId)
      const a = this.d.providers.analyst
      try {
        const r = await a.reviewStageImage({
          original: await this.image(s.project.normalizedAssetId),
          base: await this.image(cand.baseAssetId),
          candidate: await this.image(assetId),
          scene: s.project.scene!,
          stage,
        })
        const review: ImageReview = { ...r, score: clamp(r.score, 0, 100), reviewer: { provider: a.info.id, model: a.info.model } }
        await this.d.store.update('candidates', cand.id, { review, reviewError: null })
      } catch (e) {
        // A failed review never hides the image: the user still decides.
        await this.d.store.update('candidates', cand.id, { reviewError: (e as Error).message })
      }
      return true
    })
  }

  private async runGenerateTake(job: Job, ctx: JobContext) {
    const take = await this.d.store.get('takes', job.targetId!)
    if (!take) throw new PermanentError('Take not found')
    const gen = this.d.providers.videos.find((g) => g.info.id === take.provider)
    if (!gen) throw new PermanentError(`Video provider ${take.provider} is no longer configured`)
    const { s, t } = await this.transitionCtx(job.projectId, take.transitionId)
    const aspect = s.project.videoAspect

    // 1. Frames: center-crop both approved images to the video aspect (same crop for every provider).
    const frames = await ctx.step('prepare-frames', async () => {
      const from = await cropToAspect(await this.bytes(t.fromAssetId), aspect)
      const to = await cropToAspect(await this.bytes(t.toAssetId), aspect)
      const fa = await this.putAsset(job.projectId, 'video_frame', from.bytes, from.mimeType, { width: from.width, height: from.height })
      const ta = await this.putAsset(job.projectId, 'video_frame', to.bytes, to.mimeType, { width: to.width, height: to.height })
      return { from: fa.id, to: ta.id }
    })

    // 2. Start the provider operation (memoized: a retry never double-bills).
    const operationId = await ctx.step('start', async () => {
      await this.progress(job.id, 0.05, `Starting ${gen.info.label}`)
      const op = await gen.start({
        prompt: take.prompt,
        firstFrame: await this.image(frames.from),
        lastFrame: await this.image(frames.to),
        durationSec: t.durationSec,
        aspectRatio: aspect,
      })
      await this.d.store.update('takes', take.id, { operationId: op })
      return op
    })

    // 3. Poll until done.
    const { pollIntervalSec, maxPolls } = this.d.cfg.video
    let clipId: string | null = null
    for (let n = 0; n < maxPolls && !clipId; n++) {
      if (n > 0) await ctx.sleep(`wait-${n}`, pollIntervalSec * 1000)
      const r = await ctx.step(`poll-${n}`, async () => {
        const p = await gen.poll(operationId)
        if (!p.done) {
          await this.progress(job.id, Math.min(0.75, 0.1 + (n / maxPolls) * 0.65), `Rendering on ${gen.info.label}…`)
          return { done: false as const }
        }
        if ('error' in p) return { done: true as const, error: p.error }
        const meta = await probeBytes(p.video.bytes)
        const a = await this.putAsset(job.projectId, 'clip', p.video.bytes, 'video/mp4', meta)
        await this.d.store.update('takes', take.id, { assetId: a.id, status: 'ready', error: null })
        return { done: true as const, assetId: a.id }
      })
      if (r.done && 'error' in r) throw new PermanentError(r.error!)
      if (r.done) clipId = r.assetId!
    }
    if (!clipId) throw new PermanentError(`${gen.info.label} did not finish after ${maxPolls} polls`)

    // 4. Sample frames and review against the approved stage images.
    const frameIds = await ctx.step('sample-frames', async () => {
      await this.progress(job.id, 0.8, 'Sampling frames for review')
      const shots = await sampleFrames(await this.bytes(clipId!), this.d.cfg.video.reviewFrames)
      const ids: string[] = []
      for (const b of shots) ids.push((await this.putAsset(job.projectId, 'clip_frame', b, 'image/jpeg')).id)
      await this.d.store.update('takes', take.id, { frameAssetIds: ids })
      return ids
    })

    await ctx.step('review', async () => {
      await this.progress(job.id, 0.9, 'Reviewing clip')
      const a = this.d.providers.analyst
      const toStage = s.stages.find((st) => st.id === t.toStageId)!
      try {
        const r = await a.reviewClip({
          from: await this.image(frames.from),
          to: await this.image(frames.to),
          frames: await Promise.all(frameIds.map((f) => this.image(f))),
          scene: s.project.scene!,
          transition: t,
          toStage,
        })
        const review: ClipReview = { ...r, score: clamp(r.score, 0, 100), reviewer: { provider: a.info.id, model: a.info.model } }
        await this.d.store.update('takes', take.id, { review, reviewError: null })
      } catch (e) {
        await this.d.store.update('takes', take.id, { reviewError: (e as Error).message })
      }
      return true
    })
  }

  private async runRender(job: Job, ctx: JobContext) {
    await ctx.step('render', async () => {
      const s = await this.snapshot(job.projectId)
      assertGate(G.canRender({ ...s, jobs: s.jobs.filter((j) => j.id !== job.id) }))
      const takes = G.sortedTransitions(s).map((t) => s.takes.find((k) => k.id === t.approvedTakeId)!)
      await this.progress(job.id, 0.1, `Assembling ${takes.length} clips`)
      const clips = await Promise.all(takes.map((k) => this.bytes(k.assetId!)))
      const first = await probeBytes(clips[0])
      const landscape = s.project.videoAspect === '16:9'
      // Upscale small (fake / 720p) clips to at least 720p on the short side.
      const short = Math.max(720, Math.min(first.width, first.height) - (Math.min(first.width, first.height) % 2))
      const W = landscape ? Math.round((short * 16) / 9 / 2) * 2 : short
      const H = landscape ? short : Math.round((short * 16) / 9 / 2) * 2
      let intro: Buffer | undefined
      let outro: Buffer | undefined
      if (this.d.cfg.render.engine === 'remotion' && s.project.branding.enabled) {
        await this.progress(job.id, 0.2, 'Rendering branded cards with Remotion')
        const { renderBrandCards } = await import('../media/remotion.ts')
        ;({ intro, outro } = await renderBrandCards({ branding: s.project.branding, width: W, height: H, browserExecutable: this.d.cfg.render.browserExecutable }))
      }
      await this.progress(job.id, 0.5, 'Encoding final video')
      const out = await assemble({ clips, width: W, height: H, branding: s.project.branding, logoFile: this.d.cfg.render.logoFile, introVideo: intro, outroVideo: outro })
      const meta = await probeBytes(out)
      const a = await this.putAsset(job.projectId, 'render', out, 'video/mp4', meta)
      await this.touch(job.projectId, { finalAssetId: a.id })
      return a.id
    })
  }
}

function sanitizeScene(x: SceneAnalysis): SceneAnalysis {
  const b = x.workArea?.box ?? { x0: 0, y0: 0, x1: 1, y1: 1 }
  const [x0, x1] = [clamp(Math.min(b.x0, b.x1), 0, 1), clamp(Math.max(b.x0, b.x1), 0, 1)]
  const [y0, y1] = [clamp(Math.min(b.y0, b.y1), 0, 1), clamp(Math.max(b.y0, b.y1), 0, 1)]
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String).map((s) => s.trim()).filter(Boolean) : [])
  return {
    summary: String(x.summary ?? ''),
    cameraPosition: String(x.cameraPosition ?? ''),
    siteLayout: String(x.siteLayout ?? ''),
    visibleStructures: list(x.visibleStructures),
    workArea: { description: String(x.workArea?.description ?? ''), box: { x0, y0, x1, y1 } },
    mustRemainUnchanged: list(x.mustRemainUnchanged),
    lighting: String(x.lighting ?? ''),
    risks: list(x.risks),
    analyzedBy: x.analyzedBy,
  }
}
