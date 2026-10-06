import { describe, expect, it } from 'vitest'
import * as G from '../src/shared/gates.ts'
import type { Candidate, Job, Project, ProjectSnapshot, Stage } from '../src/shared/types.ts'

const t = '2026-10-06T00:00:00.000Z'

function snap(over: { project?: Partial<Project>; stages?: Partial<Stage>[]; candidates?: Partial<Candidate>[]; jobs?: Partial<Job>[] } = {}): ProjectSnapshot {
  const project = {
    id: 'p',
    normalizedAssetId: 'norm',
    scene: {},
    sceneApprovedAt: t,
    maskAssetId: 'mask',
    maskApprovedAt: t,
    planApprovedAt: t,
    ...over.project,
  } as Project
  const stages = (over.stages ?? [{}, {}, {}]).map((s, i) => ({ id: `s${i}`, index: i, title: `S${i}`, description: 'd', prompt: 'p', promptApprovedAt: t, approvedCandidateId: null, ...s }) as Stage)
  const candidates = (over.candidates ?? []).map((c) => ({ status: 'ready', ...c }) as Candidate)
  const jobs = (over.jobs ?? []) as Job[]
  return { project, stages, candidates, transitions: [], takes: [], jobs }
}

describe('gates', () => {
  it('locks later stages until the previous one has an approved image', () => {
    const s = snap()
    expect(G.canComposePrompt(s, s.stages[0]).ok).toBe(true)
    expect(G.canComposePrompt(s, s.stages[1])).toEqual({ ok: false, reason: 'Approve an image for "S0" first.' })
    expect(G.expectedBaseAssetId(s, s.stages[0])).toBe('norm')
    expect(G.expectedBaseAssetId(s, s.stages[1])).toBeNull()
  })

  it('chains only approved images', () => {
    const s = snap({
      stages: [{ approvedCandidateId: 'c0' }, {}, {}],
      candidates: [
        { id: 'c0', stageId: 's0', assetId: 'img0', baseAssetId: 'norm' },
        { id: 'cx', stageId: 's0', assetId: 'img-unapproved', baseAssetId: 'norm' },
        { id: 'c1-bad', stageId: 's1', assetId: 'img1', baseAssetId: 'img-unapproved' },
        { id: 'c1', stageId: 's1', assetId: 'img1b', baseAssetId: 'img0', prompt: 'p' },
        { id: 'c1-old', stageId: 's1', assetId: 'img1c', baseAssetId: 'img0', prompt: 'older prompt' },
      ],
    })
    expect(G.expectedBaseAssetId(s, s.stages[1])).toBe('img0')
    const bad = s.candidates.find((c) => c.id === 'c1-bad')!
    expect(G.canApproveCandidate(s, s.stages[1], bad).ok).toBe(false)
    const good = s.candidates.find((c) => c.id === 'c1')!
    expect(G.canApproveCandidate(s, s.stages[1], good).ok).toBe(true)
    const old = s.candidates.find((c) => c.id === 'c1-old')!
    expect(G.canApproveCandidate(s, s.stages[1], old)).toEqual({ ok: false, reason: 'Candidate was generated from an older prompt. Generate a new one.' })
  })

  it('requires an approved prompt before generating or approving', () => {
    const s = snap({ stages: [{ promptApprovedAt: null }] })
    expect(G.canGenerateCandidates(s, s.stages[0]).ok).toBe(false)
    expect(G.canApprovePrompt(s, snap({ stages: [{ promptApprovedAt: null, prompt: '  ' }] }).stages[0]).ok).toBe(false)
  })

  it('blocks animation until every stage image is approved, and render until every clip is', () => {
    const partial = snap({ stages: [{ approvedCandidateId: 'c0' }, {}], candidates: [{ id: 'c0', stageId: 's0', assetId: 'a0' }] })
    expect(G.canPrepareTransitions(partial).ok).toBe(false)
    const all = snap({
      stages: [{ approvedCandidateId: 'c0' }, { approvedCandidateId: 'c1' }],
      candidates: [
        { id: 'c0', stageId: 's0', assetId: 'a0' },
        { id: 'c1', stageId: 's1', assetId: 'a1' },
      ],
    })
    expect(G.canPrepareTransitions(all).ok).toBe(true)
    expect(G.expectedTransitionFrames(all).map((f) => [f.fromAssetId, f.toAssetId])).toEqual([
      ['norm', 'a0'],
      ['a0', 'a1'],
    ])
    expect(G.canRender(all).ok).toBe(false)
  })

  it('refuses duplicate concurrent jobs', () => {
    const s = snap({ project: { sceneApprovedAt: null }, jobs: [{ type: 'analyze_scene', targetId: 'p', status: 'running' }] })
    expect(G.canAnalyzeScene(s).ok).toBe(false)
  })

  it('enforces upstream order: scene → mask → plan', () => {
    expect(G.canEditMask(snap({ project: { sceneApprovedAt: null, maskApprovedAt: null, planApprovedAt: null } })).ok).toBe(false)
    expect(G.canEditPlan(snap({ project: { maskApprovedAt: null, planApprovedAt: null } })).ok).toBe(false)
    expect(G.canApprovePlan(snap({ project: { planApprovedAt: null }, stages: [{ title: '' }] })).ok).toBe(false)
  })
})
