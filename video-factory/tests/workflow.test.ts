import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { samplePhoto } from '../scripts/make-sample-photo.ts'
import type { ProjectViewDTO } from '../src/shared/types.ts'
import { createApp } from '../src/server/app.ts'
import { loadConfig } from '../src/server/config.ts'
import { InProcessRunner } from '../src/server/jobs/runner.ts'
import { sha256 } from '../src/server/media/images.ts'
import { probe } from '../src/server/media/video.ts'
import { buildServices } from '../src/server/services.ts'
import { LocalStorage } from '../src/server/storage/storage.ts'
import { FileStore } from '../src/server/store/file-store.ts'

// End-to-end run of the whole workflow through the HTTP API with fake
// providers, asserting that every gate refuses out-of-order actions.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-test-'))
for (const k of ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'FAL_KEY', 'SUPABASE_URL', 'R2_ACCOUNT_ID', 'INNGEST_ENABLED']) delete process.env[k]
const base = loadConfig()
const cfg = { ...base, dataDir: tmp, fakeMissingProviders: true, video: { ...base.video, pollIntervalSec: 0.1, durationSec: 4 } }
const svc = buildServices(cfg, { store: new FileStore(null), storage: new LocalStorage(path.join(tmp, 'media')) })
const app = createApp(svc)
const runner = svc.runner as InProcessRunner

async function call(method: string, url: string, body?: unknown) {
  const init: RequestInit = { method }
  if (body instanceof FormData) init.body = body
  else if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers = { 'content-type': 'application/json' }
  }
  const res = await app.request(url, init)
  const json = await res.json()
  return { status: res.status, json }
}

async function ok(method: string, url: string, body?: unknown): Promise<ProjectViewDTO> {
  const r = await call(method, url, body)
  if (r.status >= 300) throw new Error(`${method} ${url} → ${r.status}: ${JSON.stringify(r.json)}`)
  return r.json
}

async function refused(method: string, url: string, body?: unknown, match?: RegExp) {
  const r = await call(method, url, body)
  expect(r.status, `${method} ${url} should be refused`).toBe(409)
  if (match) expect(r.json.error).toMatch(match)
  return r.json.error as string
}

async function settle(pid: string): Promise<ProjectViewDTO> {
  await runner.drain()
  const v = await ok('GET', `/api/projects/${pid}`)
  const failed = v.jobs.filter((j) => j.status === 'failed')
  if (failed.length) throw new Error(`jobs failed: ${failed.map((j) => `${j.type}: ${j.error}`).join('; ')}`)
  return v
}

let upload: Buffer
let pid = ''
let P = ''

beforeAll(async () => {
  upload = await samplePhoto({ rotated: true })
})
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

describe('Alto Video Factory workflow', () => {
  it('creates a project, keeps the original immutable and normalizes orientation', async () => {
    const form = new FormData()
    form.set('name', 'Test driveway')
    form.set('trade', 'concrete_driveway')
    form.set('photo', new File([new Uint8Array(upload)], 'photo.jpg', { type: 'image/jpeg' }))
    const r = await call('POST', '/api/projects', form)
    expect(r.status).toBe(201)
    pid = r.json.id
    P = `/api/projects/${pid}`
    const v = await ok('GET', P)
    const orig = v.assets[v.project.originalAssetId]
    const norm = v.assets[v.project.normalizedAssetId]
    // Original is byte-identical to the upload.
    expect(orig.sha256).toBe(sha256(upload))
    expect(await svc.storage.get(orig.storageKey)).toEqual(upload)
    // Stored rotated with EXIF 6 → normalized is upright (landscape).
    expect([orig.width, orig.height]).toEqual([1200, 1600])
    expect([norm.width, norm.height]).toEqual([1600, 1200])
    expect((await sharp(await svc.storage.get(norm.storageKey)).metadata()).orientation ?? 1).toBe(1)
    expect(v.project.videoAspect).toBe('16:9')
  })

  it('refuses every step before its prerequisite', async () => {
    await refused('POST', `${P}/scene/approve`, undefined, /Analyze the scene/)
    await refused('POST', `${P}/mask/auto`, undefined, /Approve the scene/)
    await refused('POST', `${P}/plan/propose`, undefined, /mask/)
    await refused('POST', `${P}/transitions/prepare`, undefined, /Every stage image/)
    await refused('POST', `${P}/render`)
  })

  it('analyzes the scene, lets the user edit it, then approves', async () => {
    await ok('POST', `${P}/scene/analyze`)
    let v = await settle(pid)
    expect(v.project.scene?.workArea.box.x1).toBeGreaterThan(0)
    v = await ok('PUT', `${P}/scene`, { mustRemainUnchanged: ['house', 'garage door', 'trees'], workArea: { description: 'old asphalt driveway', box: { x0: 0.15, y0: 0.52, x1: 0.86, y1: 1.4 } } })
    expect(v.project.scene!.workArea.box.y1).toBe(1) // clamped
    v = await ok('POST', `${P}/scene/approve`)
    await refused('PUT', `${P}/scene`, { summary: 'x' }, /Reopen/)
    expect(v.gates.autoMask.ok).toBe(true)
  })

  it('creates an automatic mask, accepts a manual edit, and approves it', async () => {
    await refused('POST', `${P}/mask/approve`, undefined, /Create or draw a mask/)
    await ok('POST', `${P}/mask/auto`)
    let v = await settle(pid)
    expect(v.project.maskSource).toBe('auto')
    expect(v.project.maskConfidence).not.toBeNull()
    // Manual mask (any size) is normalized to the photo size, binary.
    const manual = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#000' } })
      .composite([{ input: await sharp({ create: { width: 200, height: 150, channels: 3, background: '#fff' } }).png().toBuffer(), left: 100, top: 150 }])
      .png()
      .toBuffer()
    const form = new FormData()
    form.set('mask', new File([new Uint8Array(manual)], 'mask.png', { type: 'image/png' }))
    v = await ok('PUT', `${P}/mask`, form)
    expect(v.project.maskSource).toBe('manual')
    const m = v.assets[v.project.maskAssetId!]
    expect([m.width, m.height]).toEqual([1600, 1200])
    await ok('POST', `${P}/mask/approve`)
  })

  it('proposes an editable plan and approves it', async () => {
    await ok('POST', `${P}/plan/propose`)
    let v = await settle(pid)
    expect(v.stages.map((s) => s.title)).toEqual(['Prepared base', 'Forms and rebar', 'Concrete placement', 'Finished driveway'])
    const edited = v.stages.map((s) => ({ ...s }))
    edited[0].title = 'Demo and compacted base'
    v = await ok('PUT', `${P}/plan`, { stages: edited })
    expect(v.stages[0].title).toBe('Demo and compacted base')
    expect(v.stages[0].id).toBe(edited[0].id) // ids preserved
    v = await ok('POST', `${P}/plan/approve`)
    await refused('PUT', `${P}/plan`, { stages: edited }, /Reopen/)
  })

  it('runs each stage: prompt → approval → candidates → review → approval, never chaining unapproved output', async () => {
    let v = await ok('GET', P)
    const [s1, s2] = v.stages
    await refused('POST', `${P}/stages/${s2.id}/prompt/compose`, undefined, /Approve an image for/)
    await refused('POST', `${P}/stages/${s1.id}/candidates`, {}, /Approve the prompt/)

    await ok('POST', `${P}/stages/${s1.id}/prompt/compose`)
    v = await settle(pid)
    expect(v.stages[0].prompt).toContain('Demo and compacted base')
    v = await ok('PUT', `${P}/stages/${s1.id}/prompt`, { prompt: `${v.stages[0].prompt}\nKeep the mailbox.` })
    expect(v.stages[0].promptSource).toBe('user')
    await ok('POST', `${P}/stages/${s1.id}/prompt/approve`)

    // Two providers side by side.
    await ok('POST', `${P}/stages/${s1.id}/candidates`, { providers: ['gemini-image', 'openai-image'] })
    v = await settle(pid)
    const c1 = v.candidates.filter((c) => c.stageId === s1.id)
    expect(c1.map((c) => c.provider).sort()).toEqual(['gemini-image', 'openai-image'])
    expect(c1.every((c) => c.status === 'ready' && c.review?.verdict)).toBe(true)
    expect(c1[0].baseAssetId).toBe(v.project.normalizedAssetId)
    // Stage images are pixel-aligned with the original.
    expect([v.assets[c1[0].assetId!].width, v.assets[c1[0].assetId!].height]).toEqual([1600, 1200])

    // Stage 2 still locked until stage 1 has an approved image.
    await refused('POST', `${P}/stages/${s2.id}/prompt/compose`)
    v = await ok('POST', `${P}/stages/${s1.id}/approve`, { candidateId: c1[1].id })
    expect(v.stages[0].approvedCandidateId).toBe(c1[1].id)
    await refused('POST', `${P}/stages/${s1.id}/candidates`, {}, /Reopen/)

    for (const st of v.stages.slice(1)) {
      await ok('POST', `${P}/stages/${st.id}/prompt/compose`)
      await settle(pid)
      await ok('POST', `${P}/stages/${st.id}/prompt/approve`)
      await ok('POST', `${P}/stages/${st.id}/candidates`, {})
      v = await settle(pid)
      const cand = v.candidates.filter((c) => c.stageId === st.id)
      expect(cand).toHaveLength(1)
      // The reference is always the approved image of the previous stage.
      const prev = v.stages[st.index - 1]
      const prevApproved = v.candidates.find((c) => c.id === prev.approvedCandidateId)!
      expect(cand[0].baseAssetId).toBe(prevApproved.assetId)
      expect(cand[0].referenceAssetIds).toEqual([v.project.normalizedAssetId])
      v = await ok('POST', `${P}/stages/${st.id}/approve`, { candidateId: cand[0].id })
    }
    expect(v.gates.prepareTransitions.ok).toBe(true)
  })

  it('reopening a stage invalidates everything downstream and rejects stale candidates', async () => {
    let v = await ok('GET', P)
    const [, s2, s3] = v.stages
    const oldS3 = v.candidates.find((c) => c.id === s3.approvedCandidateId)!
    v = await ok('POST', `${P}/stages/${s2.id}/reopen`)
    expect(v.stages[1].approvedCandidateId).toBeNull()
    expect(v.stages[1].promptApprovedAt).not.toBeNull() // can regenerate straight away
    expect(v.stages.slice(2).every((s) => !s.approvedCandidateId && !s.promptApprovedAt)).toBe(true)

    await ok('POST', `${P}/stages/${s2.id}/candidates`, {})
    v = await settle(pid)
    const fresh = v.candidates.filter((c) => c.stageId === s2.id).at(-1)!
    await ok('POST', `${P}/stages/${s2.id}/approve`, { candidateId: fresh.id })
    // Stage 3's old candidate was generated from the previous stage-2 image.
    await ok('POST', `${P}/stages/${s3.id}/prompt/compose`)
    await settle(pid)
    await ok('POST', `${P}/stages/${s3.id}/prompt/approve`)
    await refused('POST', `${P}/stages/${s3.id}/approve`, { candidateId: oldS3.id }, /outdated reference/)

    for (const st of (await ok('GET', P)).stages.slice(2)) {
      if (!st.promptApprovedAt) {
        await ok('POST', `${P}/stages/${st.id}/prompt/compose`)
        await settle(pid)
        await ok('POST', `${P}/stages/${st.id}/prompt/approve`)
      }
      await ok('POST', `${P}/stages/${st.id}/candidates`, {})
      v = await settle(pid)
      await ok('POST', `${P}/stages/${st.id}/approve`, { candidateId: v.candidates.filter((c) => c.stageId === st.id).at(-1)!.id })
    }
  })

  it('animates approved frames, reviews clips, retries one clip only, and renders', async () => {
    let v = await ok('POST', `${P}/transitions/prepare`)
    expect(v.transitions).toHaveLength(4)
    expect(v.transitions[0].fromAssetId).toBe(v.project.normalizedAssetId)
    expect(v.transitions[3].toAssetId).toBe(v.candidates.find((c) => c.id === v.stages[3].approvedCandidateId)!.assetId)
    await refused('POST', `${P}/render`, undefined, /clip\(s\) still need approval/)

    for (const t of v.transitions) await ok('POST', `${P}/transitions/${t.id}/takes`, { providers: t.index === 1 ? ['veo', 'kling'] : ['veo'] })
    v = await settle(pid)
    expect(v.takes).toHaveLength(5)
    for (const k of v.takes) {
      expect(k.status).toBe('ready')
      expect(k.frameAssetIds).toHaveLength(4)
      expect(k.review?.verdict).toBeDefined()
    }

    // Retry only clip 3.
    const t3 = v.transitions[2]
    await ok('PUT', `${P}/transitions/${t3.id}`, { prompt: `${t3.prompt} Slower pour.` })
    await ok('POST', `${P}/transitions/${t3.id}/takes`, {})
    v = await settle(pid)
    expect(v.takes.filter((k) => k.transitionId === t3.id)).toHaveLength(2)
    expect(v.takes.filter((k) => k.transitionId !== t3.id)).toHaveLength(4)

    for (const t of v.transitions) {
      const take = v.takes.filter((k) => k.transitionId === t.id).at(-1)!
      v = await ok('POST', `${P}/transitions/${t.id}/approve`, { takeId: take.id })
    }
    await ok('PUT', `${P}/branding`, { title: 'Smith Residence', subtitle: 'New concrete driveway', introSeconds: 1, outroSeconds: 1, holdFinalSeconds: 0.5 })
    await ok('POST', `${P}/render`)
    v = await settle(pid)
    const final = v.assets[v.project.finalAssetId!]
    expect(final.kind).toBe('render')
    const f = path.join(tmp, 'final.mp4')
    fs.writeFileSync(f, await svc.storage.get(final.storageKey))
    const meta = await probe(f)
    // 1s intro + 4×4s clips + 0.5s hold + 1s outro
    expect(meta.durationSec).toBeGreaterThan(17.5)
    expect(meta.durationSec).toBeLessThan(19.5)
    expect([meta.width, meta.height]).toEqual([1280, 720])

    // Reopening a clip clears the export.
    v = await ok('POST', `${P}/transitions/${v.transitions[0].id}/reopen`)
    expect(v.project.finalAssetId).toBeNull()
    expect(v.gates.render.ok).toBe(false)
  })

  it('reopening the scene cascades through mask, plan, stages and clips', async () => {
    const v = await ok('POST', `${P}/reopen`, { step: 'scene' })
    expect(v.project.sceneApprovedAt).toBeNull()
    expect(v.project.maskApprovedAt).toBeNull()
    expect(v.project.planApprovedAt).toBeNull()
    expect(v.stages.every((s) => !s.approvedCandidateId && !s.promptApprovedAt)).toBe(true)
    expect(v.transitions).toHaveLength(0)
    // Original still untouched.
    expect(sha256(await svc.storage.get(v.assets[v.project.originalAssetId].storageKey))).toBe(sha256(upload))
  })
})
