// Pure approval gates. The server calls these before every mutating action
// (and returns 409 on failure); the UI uses the same results to lock controls.
// Nothing here touches I/O, so the rules are unit-testable in isolation.

import type {
  Candidate,
  GateResult,
  GateSummary,
  ProjectSnapshot,
  Stage,
  Take,
  Transition,
} from './types.ts'

const OK: GateResult = { ok: true }
const no = (reason: string): GateResult => ({ ok: false, reason })

export function sortedStages(s: ProjectSnapshot): Stage[] {
  return [...s.stages].sort((a, b) => a.index - b.index)
}

export function sortedTransitions(s: ProjectSnapshot): Transition[] {
  return [...s.transitions].sort((a, b) => a.index - b.index)
}

export function approvedCandidate(s: ProjectSnapshot, stage: Stage): Candidate | null {
  if (!stage.approvedCandidateId) return null
  return s.candidates.find((c) => c.id === stage.approvedCandidateId) ?? null
}

export function approvedImageAssetId(s: ProjectSnapshot, stage: Stage): string | null {
  return approvedCandidate(s, stage)?.assetId ?? null
}

export function previousStage(s: ProjectSnapshot, stage: Stage): Stage | null {
  const list = sortedStages(s)
  const i = list.findIndex((x) => x.id === stage.id)
  return i > 0 ? list[i - 1] : null
}

/**
 * The image a stage must be generated from: the normalized original for the
 * first stage, otherwise the *approved* image of the previous stage. Returns
 * null when the previous stage is not approved, so unapproved outputs can
 * never be chained.
 */
export function expectedBaseAssetId(s: ProjectSnapshot, stage: Stage): string | null {
  const prev = previousStage(s, stage)
  if (!prev) return s.project.normalizedAssetId
  return approvedImageAssetId(s, prev)
}

export function hasActiveJob(s: ProjectSnapshot, type: string, targetId: string | null = null): boolean {
  return s.jobs.some(
    (j) => j.type === type && j.targetId === targetId && (j.status === 'queued' || j.status === 'running'),
  )
}

// ---- upstream steps -----------------------------------------------------------

export function canAnalyzeScene(s: ProjectSnapshot): GateResult {
  if (s.project.sceneApprovedAt) return no('Scene is approved. Reopen it to analyze again.')
  if (hasActiveJob(s, 'analyze_scene', s.project.id)) return no('Scene analysis is already running.')
  return OK
}

export function canEditScene(s: ProjectSnapshot): GateResult {
  if (!s.project.scene) return no('Analyze the scene first.')
  if (s.project.sceneApprovedAt) return no('Scene is approved. Reopen it to edit.')
  return OK
}

export function canApproveScene(s: ProjectSnapshot): GateResult {
  return canEditScene(s)
}

export function canEditMask(s: ProjectSnapshot): GateResult {
  if (!s.project.sceneApprovedAt) return no('Approve the scene constraints before creating the mask.')
  if (s.project.maskApprovedAt) return no('Mask is approved. Reopen it to change.')
  if (hasActiveJob(s, 'auto_mask', s.project.id)) return no('Automatic segmentation is already running.')
  return OK
}

export function canApproveMask(s: ProjectSnapshot): GateResult {
  const g = canEditMask(s)
  if (!g.ok) return g
  if (!s.project.maskAssetId) return no('Create or draw a mask first.')
  return OK
}

export function canEditPlan(s: ProjectSnapshot): GateResult {
  if (!s.project.maskApprovedAt) return no('Approve the work-area mask before planning stages.')
  if (s.project.planApprovedAt) return no('Plan is approved. Reopen it to edit.')
  if (hasActiveJob(s, 'propose_plan', s.project.id)) return no('A plan proposal is already running.')
  return OK
}

export function canApprovePlan(s: ProjectSnapshot): GateResult {
  const g = canEditPlan(s)
  if (!g.ok) return g
  if (s.stages.length === 0) return no('The plan has no stages.')
  if (s.stages.some((st) => !st.title.trim() || !st.description.trim()))
    return no('Every stage needs a title and a description.')
  return OK
}

// ---- stage steps ---------------------------------------------------------------

function stageUnlocked(s: ProjectSnapshot, stage: Stage): GateResult {
  if (!s.project.planApprovedAt) return no('Approve the stage plan first.')
  const prev = previousStage(s, stage)
  if (prev && !approvedImageAssetId(s, prev)) return no(`Approve an image for "${prev.title}" first.`)
  if (stage.approvedCandidateId) return no('Stage is approved. Reopen it to change.')
  return OK
}

export function canComposePrompt(s: ProjectSnapshot, stage: Stage): GateResult {
  const g = stageUnlocked(s, stage)
  if (!g.ok) return g
  if (hasActiveJob(s, 'compose_prompt', stage.id)) return no('Prompt is already being composed.')
  return OK
}

export function canEditPrompt(s: ProjectSnapshot, stage: Stage): GateResult {
  return stageUnlocked(s, stage)
}

export function canApprovePrompt(s: ProjectSnapshot, stage: Stage): GateResult {
  const g = stageUnlocked(s, stage)
  if (!g.ok) return g
  if (!stage.prompt?.trim()) return no('Write or compose a prompt first.')
  if (stage.promptApprovedAt) return no('Prompt is already approved.')
  return OK
}

export function canGenerateCandidates(s: ProjectSnapshot, stage: Stage): GateResult {
  const g = stageUnlocked(s, stage)
  if (!g.ok) return g
  if (!stage.promptApprovedAt) return no('Approve the prompt before generating images.')
  return OK
}

export function canApproveCandidate(s: ProjectSnapshot, stage: Stage, cand: Candidate): GateResult {
  const g = stageUnlocked(s, stage)
  if (!g.ok) return g
  if (cand.stageId !== stage.id) return no('Candidate belongs to a different stage.')
  if (cand.status !== 'ready' || !cand.assetId) return no('Candidate is not ready.')
  if (!stage.promptApprovedAt) return no('Prompt is not approved.')
  if (cand.prompt !== stage.prompt) return no('Candidate was generated from an older prompt. Generate a new one.')
  if (cand.baseAssetId !== expectedBaseAssetId(s, stage))
    return no('Candidate was generated from an outdated reference image. Generate a new one.')
  return OK
}

export function canReopenStage(s: ProjectSnapshot, stage: Stage): GateResult {
  if (!stage.approvedCandidateId) return no('Stage is not approved.')
  return OK
}

// ---- clips --------------------------------------------------------------------

export function allStagesApproved(s: ProjectSnapshot): boolean {
  return s.stages.length > 0 && s.stages.every((st) => approvedImageAssetId(s, st))
}

/** Expected (from, to) frame pairs: original → stage 1 → stage 2 → … */
export function expectedTransitionFrames(s: ProjectSnapshot): { fromStageId: string | null; toStageId: string; fromAssetId: string; toAssetId: string }[] {
  const list = sortedStages(s)
  const out = []
  let fromStageId: string | null = null
  let fromAssetId = s.project.normalizedAssetId
  for (const st of list) {
    const to = approvedImageAssetId(s, st)
    if (!to) return []
    out.push({ fromStageId, toStageId: st.id, fromAssetId, toAssetId: to })
    fromStageId = st.id
    fromAssetId = to
  }
  return out
}

export function transitionsCurrent(s: ProjectSnapshot): boolean {
  const expected = expectedTransitionFrames(s)
  const actual = sortedTransitions(s)
  if (expected.length === 0 || expected.length !== actual.length) return false
  return expected.every((e, i) => actual[i].fromAssetId === e.fromAssetId && actual[i].toAssetId === e.toAssetId)
}

export function canPrepareTransitions(s: ProjectSnapshot): GateResult {
  if (!allStagesApproved(s)) return no('Every stage image must be approved before animating.')
  if (transitionsCurrent(s)) return no('Clips are already prepared for the approved images.')
  return OK
}

function transitionUnlocked(s: ProjectSnapshot, t: Transition): GateResult {
  if (!allStagesApproved(s)) return no('Every stage image must be approved before animating.')
  if (!transitionsCurrent(s)) return no('Approved images changed. Prepare the clips again.')
  if (!s.transitions.some((x) => x.id === t.id)) return no('Unknown clip.')
  return OK
}

export function canEditTransition(s: ProjectSnapshot, t: Transition): GateResult {
  const g = transitionUnlocked(s, t)
  if (!g.ok) return g
  if (t.approvedTakeId) return no('Clip is approved. Reopen it to change.')
  return OK
}

export function canGenerateTake(s: ProjectSnapshot, t: Transition): GateResult {
  return canEditTransition(s, t)
}

export function canApproveTake(s: ProjectSnapshot, t: Transition, take: Take): GateResult {
  const g = canEditTransition(s, t)
  if (!g.ok) return g
  if (take.transitionId !== t.id) return no('Take belongs to a different clip.')
  if (take.status !== 'ready' || !take.assetId) return no('Take is not ready.')
  return OK
}

export function canReopenTransition(s: ProjectSnapshot, t: Transition): GateResult {
  if (!t.approvedTakeId) return no('Clip is not approved.')
  return OK
}

export function canRender(s: ProjectSnapshot): GateResult {
  if (!allStagesApproved(s)) return no('Every stage image must be approved.')
  if (!transitionsCurrent(s)) return no('Prepare the clips first.')
  const pending = s.transitions.filter((t) => !t.approvedTakeId)
  if (pending.length) return no(`${pending.length} clip(s) still need approval.`)
  if (hasActiveJob(s, 'render', s.project.id)) return no('A render is already running.')
  return OK
}

export function summarizeGates(s: ProjectSnapshot): GateSummary {
  const stages: GateSummary['stages'] = {}
  for (const st of s.stages) {
    stages[st.id] = {
      composePrompt: canComposePrompt(s, st),
      approvePrompt: canApprovePrompt(s, st),
      generate: canGenerateCandidates(s, st),
    }
  }
  return {
    analyzeScene: canAnalyzeScene(s),
    approveScene: canApproveScene(s),
    autoMask: canEditMask(s),
    approveMask: canApproveMask(s),
    proposePlan: canEditPlan(s),
    editPlan: canEditPlan(s),
    approvePlan: canApprovePlan(s),
    prepareTransitions: canPrepareTransitions(s),
    render: canRender(s),
    stages,
  }
}
