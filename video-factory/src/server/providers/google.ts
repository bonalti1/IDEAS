import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { GenerateVideosOperation, GoogleGenAI } from '@google/genai'
import type { ProviderInfo } from '../../shared/types.ts'
import { nearestImageAspect } from '../media/images.ts'
import type { ImageGenerator, MediaOutput, VideoGenerator, VideoPoll } from './types.ts'

// ---- Nano Banana Pro (Gemini image) ----------------------------------------------

export class GeminiImageGenerator implements ImageGenerator {
  readonly info: ProviderInfo
  private ai: GoogleGenAI

  constructor(apiKey: string, private model: string, private imageSize: string) {
    this.ai = new GoogleGenAI({ apiKey })
    this.info = { id: 'gemini-image', label: 'Gemini Nano Banana Pro', kind: 'image', model, configured: true, primary: true, fake: false }
  }

  async generate({ prompt, base, references, mask }: Parameters<ImageGenerator['generate']>[0]): Promise<MediaOutput> {
    // Gemini has no mask parameter: the mask is passed as a labelled reference image.
    const inline = (b: { bytes: Buffer; mimeType: string }) => ({ inlineData: { mimeType: b.mimeType, data: b.bytes.toString('base64') } })
    const res = await this.ai.models.generateContent({
      model: this.model,
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            { text: 'Image 1 — edit this image:' },
            inline(base),
            ...references.flatMap((r, i) => [{ text: `Reference ${i + 1} — original site photo, keep everything outside the work area identical to it:` }, inline(r)]),
            { text: 'Work-area mask — only change pixels in the white region, leave black regions untouched:' },
            inline(mask),
          ],
        },
      ],
      config: {
        responseModalities: ['IMAGE'],
        imageConfig: { aspectRatio: nearestImageAspect(base.width, base.height), imageSize: this.imageSize },
      },
    })
    const parts = res.candidates?.[0]?.content?.parts ?? []
    const img = parts.find((p) => p.inlineData?.data)
    if (!img?.inlineData?.data) {
      const reason = res.candidates?.[0]?.finishReason ?? res.promptFeedback?.blockReason ?? 'no image returned'
      const text = parts.map((p) => p.text).filter(Boolean).join(' ')
      throw new Error(`${this.model}: ${reason}${text ? ` — ${text.slice(0, 300)}` : ''}`)
    }
    return { bytes: Buffer.from(img.inlineData.data, 'base64'), mimeType: img.inlineData.mimeType ?? 'image/png' }
  }
}

// ---- Veo 3.1 (first frame → last frame) -------------------------------------------

export class VeoVideoGenerator implements VideoGenerator {
  readonly info: ProviderInfo
  private ai: GoogleGenAI

  constructor(apiKey: string, private model: string, private resolution: string) {
    this.ai = new GoogleGenAI({ apiKey })
    this.info = { id: 'veo', label: 'Google Veo 3.1', kind: 'video', model, configured: true, primary: true, fake: false }
  }

  async start({ prompt, firstFrame, lastFrame, durationSec, aspectRatio }: Parameters<VideoGenerator['start']>[0]) {
    const op = await this.ai.models.generateVideos({
      model: this.model,
      prompt,
      image: { imageBytes: firstFrame.bytes.toString('base64'), mimeType: firstFrame.mimeType },
      config: {
        lastFrame: { imageBytes: lastFrame.bytes.toString('base64'), mimeType: lastFrame.mimeType },
        durationSeconds: durationSec,
        aspectRatio,
        resolution: this.resolution,
        numberOfVideos: 1,
        negativePrompt: 'camera movement, zoom, people, text, watermark, morphing buildings',
      },
    })
    if (!op.name) throw new Error('Veo returned no operation name')
    return op.name
  }

  async poll(operationId: string): Promise<VideoPoll> {
    const ref = new GenerateVideosOperation()
    ref.name = operationId
    const op = await this.ai.operations.getVideosOperation({ operation: ref })
    if (!op.done) return { done: false }
    if (op.error) return { done: true, error: `Veo: ${JSON.stringify(op.error)}` }
    const filtered = op.response?.raiMediaFilteredReasons
    const video = op.response?.generatedVideos?.[0]?.video
    if (!video) return { done: true, error: `Veo returned no video${filtered?.length ? `: ${filtered.join('; ')}` : ''}` }
    if (video.videoBytes) return { done: true, video: { bytes: Buffer.from(video.videoBytes, 'base64'), mimeType: 'video/mp4' } }
    // Download through the SDK so the API key is attached.
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veo-'))
    const file = path.join(dir, 'clip.mp4')
    try {
      await this.ai.files.download({ file: video, downloadPath: file })
      return { done: true, video: { bytes: await fs.readFile(file), mimeType: 'video/mp4' } }
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  }
}
