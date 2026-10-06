import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { samplePhoto } from '../scripts/make-sample-photo.ts'
import type { ProjectViewDTO } from '../src/shared/types.ts'
import { createApp } from '../src/server/app.ts'
import { loadConfig } from '../src/server/config.ts'
import type { InProcessRunner } from '../src/server/jobs/runner.ts'
import { buildServices } from '../src/server/services.ts'
import { LocalStorage } from '../src/server/storage/storage.ts'
import { FileStore } from '../src/server/store/file-store.ts'

// Guided mode: after each approval the next proposal is prepared
// automatically, but nothing is ever approved on the user's behalf.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-auto-'))
for (const k of ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'FAL_KEY', 'SUPABASE_URL', 'R2_ACCOUNT_ID', 'INNGEST_ENABLED']) delete process.env[k]
const base = loadConfig()
const cfg = { ...base, dataDir: tmp, fakeMissingProviders: true, autoAdvance: true, video: { ...base.video, pollIntervalSec: 0.1, durationSec: 3 } }
const svc = buildServices(cfg, { store: new FileStore(null), storage: new LocalStorage(path.join(tmp, 'media')) })
const app = createApp(svc)
const runner = svc.runner as InProcessRunner
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

async function post(url: string, body?: unknown): Promise<ProjectViewDTO> {
  const res = await app.request(url, { method: 'POST', body: body ? JSON.stringify(body) : undefined, headers: { 'content-type': 'application/json' } })
  const json = await res.json()
  if (!res.ok) throw new Error(`${url} → ${res.status} ${JSON.stringify(json)}`)
  return json
}
async function settled(P: string): Promise<ProjectViewDTO> {
  await runner.drain()
  const v = (await (await app.request(P)).json()) as ProjectViewDTO
  expect(v.jobs.filter((j) => j.status === 'failed')).toEqual([])
  return v
}

describe('auto-advance', () => {
  it('prepares each next proposal but never approves', async () => {
    const form = new FormData()
    form.set('name', 'Auto')
    form.set('photo', new File([new Uint8Array(await samplePhoto())], 'p.jpg', { type: 'image/jpeg' }))
    const created = await (await app.request('/api/projects', { method: 'POST', body: form })).json()
    const P = `/api/projects/${created.id}`

    let v = await settled(P)
    expect(v.project.scene).not.toBeNull() // analyzed automatically
    expect(v.project.sceneApprovedAt).toBeNull()

    await post(`${P}/scene/approve`)
    v = await settled(P)
    expect(v.project.maskAssetId).not.toBeNull()
    expect(v.project.maskApprovedAt).toBeNull()

    await post(`${P}/mask/approve`)
    v = await settled(P)
    expect(v.stages).toHaveLength(4)
    expect(v.project.planApprovedAt).toBeNull()

    await post(`${P}/plan/approve`)
    v = await settled(P)
    expect(v.stages[0].prompt).toBeTruthy()
    expect(v.stages[0].promptApprovedAt).toBeNull()
    expect(v.stages[1].prompt).toBeNull()

    // One click: approve the prompt and generate.
    await post(`${P}/stages/${v.stages[0].id}/prompt/approve`, { generate: true, providers: ['gemini-image', 'openai-image'] })
    v = await settled(P)
    const cands = v.candidates.filter((c) => c.stageId === v.stages[0].id)
    expect(cands).toHaveLength(2)
    expect(v.stages[0].approvedCandidateId).toBeNull()

    await post(`${P}/stages/${v.stages[0].id}/approve`, { candidateId: cands[0].id })
    v = await settled(P)
    expect(v.stages[1].prompt).toBeTruthy() // next stage prompt drafted
    expect(v.stages[1].promptApprovedAt).toBeNull()

    for (const st of v.stages.slice(1)) {
      await post(`${P}/stages/${st.id}/prompt/approve`, { generate: true })
      v = await settled(P)
      await post(`${P}/stages/${st.id}/approve`, { candidateId: v.candidates.filter((c) => c.stageId === st.id)[0].id })
      v = await settled(P)
    }
    expect(v.transitions).toHaveLength(4) // clips prepared, not generated
    expect(v.takes).toHaveLength(0)
  })
})
