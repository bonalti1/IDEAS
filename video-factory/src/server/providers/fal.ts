import { createFalClient, type FalClient } from '@fal-ai/client'
import sharp from 'sharp'
import type { ProviderInfo } from '../../shared/types.ts'
import { boxMask, normalizeMask } from '../media/images.ts'
import type { ImageInput, Segmenter, VideoGenerator, VideoPoll } from './types.ts'

const upload = (fal: FalClient, img: { bytes: Buffer; mimeType: string }) =>
  fal.storage.upload(new Blob([new Uint8Array(img.bytes)], { type: img.mimeType }))

async function fetchBytes(url: string) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`download ${url}: HTTP ${r.status}`)
  return Buffer.from(await r.arrayBuffer())
}

/**
 * How each fal model names its start/end frame inputs and durations.
 * Kling v3 Pro is typed in @fal-ai/client; Seedance 2.5 is not yet, so its
 * field names follow fal's model page (image_url / end_image_url).
 */
export interface FalVideoModel {
  id: string
  label: string
  endpoint: string
  startField: string
  endField: string
  durations: number[]
  aspectField?: string // omitted when the model takes its aspect from the start frame
  extra?: Record<string, unknown>
}

export const KLING_V3_PRO = (endpoint: string): FalVideoModel => ({
  id: 'kling',
  label: 'Kling 3.0 Pro (fal)',
  endpoint,
  startField: 'start_image_url',
  endField: 'end_image_url',
  durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  extra: { generate_audio: false, negative_prompt: 'camera movement, zoom, people, text, watermark, blur' },
})

export const SEEDANCE_25 = (endpoint: string): FalVideoModel => ({
  id: 'seedance',
  label: 'Seedance 2.5 (fal)',
  endpoint,
  startField: 'image_url',
  endField: 'end_image_url',
  durations: [4, 5, 6, 8, 10, 12],
  aspectField: 'aspect_ratio',
  extra: { generate_audio: false },
})

const nearest = (xs: number[], v: number) => xs.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a))

export class FalVideoGenerator implements VideoGenerator {
  readonly info: ProviderInfo
  private fal: FalClient

  constructor(key: string, private m: FalVideoModel) {
    this.fal = createFalClient({ credentials: key })
    this.info = { id: m.id, label: m.label, kind: 'video', model: m.endpoint, configured: true, primary: false, fake: false }
  }

  async start({ prompt, firstFrame, lastFrame, durationSec, aspectRatio }: Parameters<VideoGenerator['start']>[0]) {
    const [start, end] = await Promise.all([upload(this.fal, firstFrame), upload(this.fal, lastFrame)])
    const input = {
      prompt,
      [this.m.startField]: start,
      [this.m.endField]: end,
      duration: String(nearest(this.m.durations, durationSec)),
      ...(this.m.aspectField ? { [this.m.aspectField]: aspectRatio } : {}),
      ...this.m.extra,
    }
    const { request_id } = await this.fal.queue.submit(this.m.endpoint as 'fal-ai/kling-video/v3/pro/image-to-video', {
      input: input as never,
    })
    return request_id
  }

  async poll(requestId: string): Promise<VideoPoll> {
    const st = await this.fal.queue.status(this.m.endpoint, { requestId, logs: false })
    if (st.status !== 'COMPLETED') return { done: false }
    try {
      const res = await this.fal.queue.result(this.m.endpoint as 'fal-ai/kling-video/v3/pro/image-to-video', { requestId })
      const url = (res.data as { video?: { url?: string } }).video?.url
      if (!url) return { done: true, error: `${this.m.endpoint} returned no video` }
      return { done: true, video: { bytes: await fetchBytes(url), mimeType: 'video/mp4' } }
    } catch (e) {
      return { done: true, error: `${this.m.endpoint}: ${(e as Error).message}` }
    }
  }
}

/** SAM 2 on fal: box prompt (from the scene analysis) → binary work-area mask. */
export class FalSam2Segmenter implements Segmenter {
  readonly info: ProviderInfo
  private fal: FalClient

  constructor(key: string, private endpoint: string) {
    this.fal = createFalClient({ credentials: key })
    this.info = { id: 'sam2', label: 'SAM 2 (fal)', kind: 'segmenter', model: endpoint, configured: true, primary: true, fake: false }
  }

  async segment({ image, box }: { image: ImageInput; box: { x0: number; y0: number; x1: number; y1: number } }) {
    const url = await upload(this.fal, image)
    const px = (v: number, n: number) => Math.round(Math.min(1, Math.max(0, v)) * n)
    const res = await this.fal.subscribe('fal-ai/sam2/image', {
      input: {
        image_url: url,
        box_prompts: [
          {
            x_min: px(box.x0, image.width),
            y_min: px(box.y0, image.height),
            x_max: px(box.x1, image.width),
            y_max: px(box.y1, image.height),
          },
        ],
        // A point in the box centre helps SAM pick the surface rather than an object on it.
        prompts: [{ x: px((box.x0 + box.x1) / 2, image.width), y: px((box.y0 + box.y1) / 2, image.height), label: '1' }],
        apply_mask: false,
        output_format: 'png',
      },
    })
    const maskUrl = res.data.image?.url
    if (!maskUrl) throw new Error('SAM 2 returned no mask')
    const mask = await normalizeMask(await fetchBytes(maskUrl), image.width, image.height)
    // SAM 2 on fal does not return a score. Estimate confidence as the share of
    // the prompted box the mask fills; the UI asks for a manual check when low.
    const boxM = await boxMask(image.width, image.height, box)
    const confidence = await overlapRatio(mask, boxM)
    return { mask, confidence }
  }
}

async function overlapRatio(mask: Buffer, box: Buffer) {
  const a = await sharp(mask).greyscale().raw().toBuffer()
  const b = await sharp(box).greyscale().raw().toBuffer()
  let inBox = 0
  let hit = 0
  let outside = 0
  for (let i = 0; i < b.length; i++) {
    if (b[i] > 127) {
      inBox++
      if (a[i] > 127) hit++
    } else if (a[i] > 127) outside++
  }
  if (!inBox) return 0
  const fill = hit / inBox
  const spill = outside / Math.max(1, hit + outside)
  return Math.max(0, Math.min(1, fill * (1 - spill)))
}
