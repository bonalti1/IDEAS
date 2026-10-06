import type { TradeWorkflow } from '../../shared/trades.ts'
import type {
  Box,
  ClipReview,
  ImageReview,
  PlanStageInput,
  ProviderInfo,
  SceneAnalysis,
  Stage,
  Transition,
} from '../../shared/types.ts'

export interface ImageInput {
  bytes: Buffer
  mimeType: string
  width: number
  height: number
}

export interface MediaOutput {
  bytes: Buffer
  mimeType: string
}

interface ProviderBase {
  readonly info: ProviderInfo
}

/** Scene understanding, planning, prompt writing and quality review (OpenAI vision). */
export interface Analyst extends ProviderBase {
  analyzeScene(i: { image: ImageInput; trade: TradeWorkflow; desiredResult: string }): Promise<Omit<SceneAnalysis, 'analyzedBy'>>

  proposePlan(i: {
    image: ImageInput
    scene: SceneAnalysis
    trade: TradeWorkflow
    desiredResult: string
  }): Promise<PlanStageInput[]>

  composeStagePrompt(i: {
    original: ImageInput
    previous: ImageInput | null // approved image of the previous stage
    mask: ImageInput
    scene: SceneAnalysis
    trade: TradeWorkflow
    stage: Stage
    stages: Stage[]
    templatePrompt: string
  }): Promise<string>

  reviewStageImage(i: {
    original: ImageInput
    base: ImageInput // the approved prior stage (or original) it was generated from
    candidate: ImageInput
    scene: SceneAnalysis
    stage: Stage
  }): Promise<Omit<ImageReview, 'reviewer'>>

  reviewClip(i: {
    from: ImageInput
    to: ImageInput
    frames: ImageInput[] // sampled from the generated clip, in time order
    scene: SceneAnalysis
    transition: Transition
    toStage: Stage
  }): Promise<Omit<ClipReview, 'reviewer'>>
}

export interface ImageGenerator extends ProviderBase {
  /** Edit `base` into the requested stage. `references` carries the original photo for consistency. */
  generate(i: {
    prompt: string
    base: ImageInput
    references: ImageInput[]
    mask: ImageInput // white = work area
  }): Promise<MediaOutput>
}

export type VideoPoll =
  | { done: false; progress?: number }
  | { done: true; video: MediaOutput }
  | { done: true; error: string }

export interface VideoGenerator extends ProviderBase {
  /** Starts a first-frame → last-frame transition. Returns a provider operation id. */
  start(i: {
    prompt: string
    firstFrame: ImageInput
    lastFrame: ImageInput
    durationSec: number
    aspectRatio: '16:9' | '9:16'
  }): Promise<string>
  poll(operationId: string): Promise<VideoPoll>
}

export interface Segmenter extends ProviderBase {
  /** Returns a single-channel-looking PNG (white = work area) at the image size. */
  segment(i: { image: ImageInput; box: Box; hint: string }): Promise<{ mask: Buffer; confidence: number | null }>
}

export interface ProviderRegistry {
  analyst: Analyst
  images: ImageGenerator[]
  videos: VideoGenerator[]
  segmenter: Segmenter
}

export function dataUrl(img: { bytes: Buffer; mimeType: string }) {
  return `data:${img.mimeType};base64,${img.bytes.toString('base64')}`
}
