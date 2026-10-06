import type { AppConfig } from '../config.ts'
import { FakeAnalyst, FakeImageGenerator, FakeSegmenter, FakeVideoGenerator } from './fake.ts'
import { FalSam2Segmenter, FalVideoGenerator, KLING_V3_PRO, SEEDANCE_25 } from './fal.ts'
import { GeminiImageGenerator, VeoVideoGenerator } from './google.ts'
import { OpenAIAnalyst, OpenAIImageGenerator } from './openai.ts'
import type { ImageGenerator, ProviderRegistry, VideoGenerator } from './types.ts'

/**
 * Builds the provider set from config. Swapping or comparing models means
 * changing env vars (or adding an adapter here) — the workflow never names a
 * concrete provider.
 */
export function buildProviders(cfg: AppConfig): ProviderRegistry {
  const fake = cfg.fakeMissingProviders
  const missing = (what: string) => {
    throw new Error(`${what} is not configured and FAKE_MISSING_PROVIDERS=false`)
  }

  const analyst = cfg.openai.apiKey
    ? new OpenAIAnalyst(cfg.openai.apiKey, cfg.openai.visionModel, cfg.openai.visionReasoning)
    : fake
      ? new FakeAnalyst()
      : missing('OPENAI_API_KEY')

  const images: ImageGenerator[] = []
  if (cfg.gemini.apiKey) images.push(new GeminiImageGenerator(cfg.gemini.apiKey, cfg.gemini.imageModel, cfg.gemini.imageSize))
  else if (fake) images.push(new FakeImageGenerator('gemini-image', 'Gemini Nano Banana Pro', true))
  if (cfg.openai.imageEnabled) {
    if (cfg.openai.apiKey) images.push(new OpenAIImageGenerator(cfg.openai.apiKey, cfg.openai.imageModel, cfg.openai.imageQuality))
    else if (fake) images.push(new FakeImageGenerator('openai-image', 'OpenAI GPT Image', false))
  }
  if (!images.length) missing('GEMINI_API_KEY')

  const videos: VideoGenerator[] = []
  if (cfg.gemini.apiKey) videos.push(new VeoVideoGenerator(cfg.gemini.apiKey, cfg.gemini.veoModel, cfg.gemini.veoResolution))
  else if (fake) videos.push(new FakeVideoGenerator('veo', 'Google Veo 3.1', true))
  if (cfg.fal.klingEnabled) {
    if (cfg.fal.key) videos.push(new FalVideoGenerator(cfg.fal.key, KLING_V3_PRO(cfg.fal.klingEndpoint)))
    else if (fake) videos.push(new FakeVideoGenerator('kling', 'Kling 3.0 Pro', false))
  }
  if (cfg.fal.seedanceEnabled) {
    if (cfg.fal.key) videos.push(new FalVideoGenerator(cfg.fal.key, SEEDANCE_25(cfg.fal.seedanceEndpoint)))
    else if (fake) videos.push(new FakeVideoGenerator('seedance', 'Seedance 2.5', false))
  }
  if (!videos.length) missing('GEMINI_API_KEY (Veo)')

  const segmenter = cfg.fal.key ? new FalSam2Segmenter(cfg.fal.key, cfg.fal.sam2Endpoint) : fake ? new FakeSegmenter() : missing('FAL_KEY (SAM 2)')

  return { analyst, images, videos, segmenter }
}

export function pick<T extends { info: { id: string; primary: boolean } }>(list: T[], ids: string[] | undefined, kind: string): T[] {
  if (!ids?.length) return list.filter((p) => p.info.primary).slice(0, 1)
  const chosen = ids.map((id) => {
    const p = list.find((x) => x.info.id === id)
    if (!p) throw Object.assign(new Error(`Unknown ${kind} provider: ${id}`), { status: 400 })
    return p
  })
  return [...new Map(chosen.map((p) => [p.info.id, p])).values()]
}
