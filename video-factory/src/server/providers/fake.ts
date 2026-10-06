// Local stand-ins for every provider slot. They exercise the full workflow
// (jobs, storage, gates, UI) without network access or API spend, and are
// clearly labelled "fake" everywhere they appear.

import sharp from 'sharp'
import type { ProviderInfo } from '../../shared/types.ts'
import { boxMask } from '../media/images.ts'
import { crossfadeStills } from '../media/video.ts'
import type { Analyst, ImageGenerator, Segmenter, VideoGenerator, VideoPoll } from './types.ts'

const info = (id: string, label: string, kind: ProviderInfo['kind'], primary = true): ProviderInfo => ({
  id,
  label: `${label} (fake)`,
  kind,
  model: 'local-fake',
  configured: true,
  primary,
  fake: true,
})

export class FakeAnalyst implements Analyst {
  readonly info: ProviderInfo
  constructor(id = 'openai-vision') {
    this.info = info(id, 'OpenAI vision', 'analyst')
  }

  analyzeScene: Analyst['analyzeScene'] = async ({ image, trade }) => ({
    summary: `Ground-level photo of a residential property (${image.width}×${image.height}). Placeholder analysis from the fake analyst.`,
    cameraPosition: 'Standing at the street edge, eye level (~1.6 m), facing the house, slight downward tilt.',
    siteLayout: 'Driveway runs from the street (bottom of frame) to the garage (centre). Lawn on both sides.',
    visibleStructures: ['house facade', 'garage door', 'lawn', 'street curb'],
    workArea: { description: trade.workAreaHint, box: { x0: 0.2, y0: 0.55, x1: 0.8, y1: 0.98 } },
    mustRemainUnchanged: ['house facade and roofline', 'windows and doors', 'lawn and landscaping', 'sky', 'street and curb'],
    lighting: 'Daylight, soft shadows',
    risks: ['Fake analysis — verify the work-area box by hand.'],
  })

  proposePlan: Analyst['proposePlan'] = async ({ trade }) => structuredClone(trade.stages)

  composeStagePrompt: Analyst['composeStagePrompt'] = async ({ templatePrompt }) => templatePrompt

  reviewStageImage: Analyst['reviewStageImage'] = async ({ stage }) => ({
    verdict: 'pass',
    score: 80,
    stagePresent: { ok: true, notes: `Fake review: assumed "${stage.title}" is present.` },
    sceneConsistent: { ok: true, notes: 'Fake review: not actually checked.' },
    cameraConsistent: { ok: true, notes: 'Fake review: not actually checked.' },
    artifacts: { ok: true, notes: 'Fake review: not actually checked.' },
    summary: 'Placeholder review. Configure OPENAI_API_KEY for real quality review.',
  })

  reviewClip: Analyst['reviewClip'] = async ({ frames }) => ({
    verdict: 'pass',
    score: 80,
    startMatches: { ok: true, notes: 'Fake review.' },
    endMatches: { ok: true, notes: 'Fake review.' },
    sceneConsistent: { ok: true, notes: `Fake review of ${frames.length} sampled frames.` },
    artifacts: { ok: true, notes: 'Fake review.' },
    summary: 'Placeholder clip review. Configure OPENAI_API_KEY for real quality review.',
  })
}

const STAGE_TINTS = ['#9ca3af', '#b45309', '#6b7280', '#d6d3d1', '#78716c', '#a8a29e']

export class FakeImageGenerator implements ImageGenerator {
  readonly info: ProviderInfo
  private n = 0
  constructor(id: string, label: string, primary: boolean) {
    this.info = info(id, label, 'image', primary)
  }

  /** Tints the masked work area and stamps the stage title from the prompt. */
  async generate({ prompt, base, mask }: Parameters<ImageGenerator['generate']>[0]) {
    const { width: w, height: h } = base
    const m = /stage "([^"]+)"/.exec(prompt)
    const title = m?.[1] ?? 'Stage'
    const tint = STAGE_TINTS[this.n++ % STAGE_TINTS.length]
    const maskAlpha = await sharp(mask.bytes).resize(w, h, { fit: 'fill' }).greyscale().raw().toBuffer()
    const fill = await sharp({ create: { width: w, height: h, channels: 3, background: tint } })
      .joinChannel(maskAlpha, { raw: { width: w, height: h, channels: 1 } })
      .png()
      .toBuffer()
    const fs = Math.round(Math.min(w, h) * 0.045)
    const label = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect x="${fs}" y="${fs}" width="${fs * (title.length * 0.62 + 6)}" height="${fs * 1.8}" rx="${fs * 0.3}" fill="#000" fill-opacity="0.6"/><text x="${fs * 1.6}" y="${fs * 2.2}" font-family="DejaVu Sans, sans-serif" font-size="${fs}" fill="#fff">FAKE · ${title.replace(/[<&>]/g, '')} · ${this.info.id}</text></svg>`,
    )
    const bytes = await sharp(base.bytes)
      .resize(w, h)
      .composite([{ input: fill, blend: 'over' }, { input: label }])
      .png()
      .toBuffer()
    return { bytes, mimeType: 'image/png' }
  }
}

export class FakeVideoGenerator implements VideoGenerator {
  readonly info: ProviderInfo
  private ops = new Map<string, Promise<Buffer>>()
  private done = new Map<string, Buffer | Error>()
  constructor(id: string, label: string, primary: boolean) {
    this.info = info(id, label, 'video', primary)
  }

  async start({ firstFrame, lastFrame, durationSec }: Parameters<VideoGenerator['start']>[0]) {
    const id = `fake-${this.info.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    // Short, low-res placeholder clip; real clip length comes from the provider.
    const p = crossfadeStills(firstFrame.bytes, lastFrame.bytes, Math.min(durationSec, 4), firstFrame.width >= firstFrame.height ? 640 : 360, firstFrame.width >= firstFrame.height ? 360 : 640)
    this.ops.set(id, p)
    p.then((b) => this.done.set(id, b)).catch((e) => this.done.set(id, e as Error))
    return id
  }

  async poll(id: string): Promise<VideoPoll> {
    if (!this.ops.has(id)) return { done: true, error: 'Unknown fake operation (server restarted?)' }
    const r = this.done.get(id)
    if (!r) return { done: false }
    if (r instanceof Error) return { done: true, error: r.message }
    return { done: true, video: { bytes: r, mimeType: 'video/mp4' } }
  }
}

export class FakeSegmenter implements Segmenter {
  readonly info: ProviderInfo = info('sam2', 'SAM 2', 'segmenter')
  async segment({ image, box }: Parameters<Segmenter['segment']>[0]) {
    return { mask: await boxMask(image.width, image.height, box), confidence: 0.4 }
  }
}
