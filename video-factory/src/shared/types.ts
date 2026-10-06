// Domain records shared by the server and the UI.
// Every record is stored as one row; JSON-shaped fields map to jsonb columns.

export type TradeId = 'concrete_driveway'

export type AssetKind =
  | 'original' // the upload, byte-for-byte, never modified
  | 'normalized' // orientation/format normalized copy used for processing
  | 'mask'
  | 'stage_image'
  | 'video_frame' // first/last frame prepared for a video provider
  | 'clip'
  | 'clip_frame' // frame sampled from a clip for review
  | 'render'

export interface Asset {
  id: string
  projectId: string
  kind: AssetKind
  storageKey: string
  mimeType: string
  bytes: number
  sha256: string
  width: number | null
  height: number | null
  durationSec: number | null
  immutable: boolean
  createdAt: string
}

export interface Box {
  // normalized 0..1 image coordinates
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface SceneAnalysis {
  summary: string
  cameraPosition: string
  siteLayout: string
  visibleStructures: string[]
  workArea: { description: string; box: Box }
  mustRemainUnchanged: string[]
  lighting: string
  risks: string[]
  analyzedBy: ProviderRef
}

export interface ProviderRef {
  provider: string
  model: string
}

export interface BrandingOptions {
  enabled: boolean
  title: string
  subtitle: string
  introSeconds: number
  outroSeconds: number
  outroText: string
  watermark: boolean
  holdFinalSeconds: number
}

export type VideoAspect = '16:9' | '9:16'

export interface Project {
  id: string
  name: string
  trade: TradeId
  desiredResult: string
  originalAssetId: string
  normalizedAssetId: string
  scene: SceneAnalysis | null
  sceneApprovedAt: string | null
  maskAssetId: string | null
  maskSource: 'auto' | 'manual' | null
  maskConfidence: number | null
  maskApprovedAt: string | null
  planApprovedAt: string | null
  videoAspect: VideoAspect
  branding: BrandingOptions
  finalAssetId: string | null
  createdAt: string
  updatedAt: string
}

export interface Stage {
  id: string
  projectId: string
  index: number // 0-based order in the plan
  title: string
  description: string
  checklist: string[] // details the reviewer must see
  motionHint: string // how the transition into this stage should move
  prompt: string | null
  promptSource: 'ai' | 'template' | 'user' | null
  promptApprovedAt: string | null
  approvedCandidateId: string | null
  approvedAt: string | null
  updatedAt: string
}

export type Verdict = 'pass' | 'warn' | 'fail'

export interface ReviewCheck {
  ok: boolean
  notes: string
}

export interface ImageReview {
  verdict: Verdict
  score: number // 0..100
  stagePresent: ReviewCheck
  sceneConsistent: ReviewCheck
  cameraConsistent: ReviewCheck
  artifacts: ReviewCheck
  summary: string
  reviewer: ProviderRef
}

export interface ClipReview {
  verdict: Verdict
  score: number
  startMatches: ReviewCheck
  endMatches: ReviewCheck
  sceneConsistent: ReviewCheck
  artifacts: ReviewCheck
  summary: string
  reviewer: ProviderRef
}

export type OutputStatus = 'pending' | 'ready' | 'failed'

export interface Candidate {
  id: string
  projectId: string
  stageId: string
  provider: string
  model: string
  prompt: string
  baseAssetId: string // image that was edited
  referenceAssetIds: string[]
  maskAssetId: string | null
  assetId: string | null
  status: OutputStatus
  error: string | null
  review: ImageReview | null
  reviewError: string | null
  jobId: string | null
  createdAt: string
}

export interface Transition {
  id: string
  projectId: string
  index: number
  fromStageId: string | null // null = original photo
  toStageId: string
  fromAssetId: string // approved image snapshot at preparation time
  toAssetId: string
  prompt: string
  durationSec: number
  approvedTakeId: string | null
  approvedAt: string | null
  createdAt: string
}

export interface Take {
  id: string
  projectId: string
  transitionId: string
  provider: string
  model: string
  prompt: string
  operationId: string | null
  assetId: string | null
  frameAssetIds: string[]
  status: OutputStatus
  error: string | null
  review: ClipReview | null
  reviewError: string | null
  jobId: string | null
  createdAt: string
}

export type JobType =
  | 'analyze_scene'
  | 'auto_mask'
  | 'propose_plan'
  | 'compose_prompt'
  | 'generate_candidate'
  | 'generate_take'
  | 'render'

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed'

export interface Job {
  id: string
  projectId: string
  type: JobType
  targetId: string | null
  status: JobStatus
  progress: number // 0..1
  message: string
  error: string | null
  attempts: number
  createdAt: string
  updatedAt: string
}

export interface ProjectSnapshot {
  project: Project
  stages: Stage[]
  candidates: Candidate[]
  transitions: Transition[]
  takes: Take[]
  jobs: Job[]
}

// ---- API DTOs ---------------------------------------------------------------

export interface ProviderInfo {
  id: string
  label: string
  kind: 'analyst' | 'image' | 'video' | 'segmenter'
  model: string
  configured: boolean
  primary: boolean
  fake: boolean
}

export interface AppConfigDTO {
  providers: ProviderInfo[]
  trades: { id: TradeId; label: string; defaultResult: string }[]
  storage: string
  store: string
  jobs: string
}

export interface ProjectSummaryDTO extends Project {
  thumbUrl: string | null
}

export interface ProjectViewDTO extends ProjectSnapshot {
  assetUrls: Record<string, string>
  assets: Record<string, Asset>
  gates: GateSummary
}

export interface GateSummary {
  analyzeScene: GateResult
  approveScene: GateResult
  autoMask: GateResult
  approveMask: GateResult
  proposePlan: GateResult
  editPlan: GateResult
  approvePlan: GateResult
  prepareTransitions: GateResult
  render: GateResult
  stages: Record<string, { composePrompt: GateResult; approvePrompt: GateResult; generate: GateResult }>
}

export type GateResult = { ok: true } | { ok: false; reason: string }

export interface PlanStageInput {
  title: string
  description: string
  checklist: string[]
  motionHint: string
}
