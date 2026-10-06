import OpenAI, { toFile } from 'openai'
import type { ResponseInputContent } from 'openai/resources/responses/responses'
import type { ClipReview, ImageReview, ProviderInfo } from '../../shared/types.ts'
import { forVision, toAlphaEditMask } from '../media/images.ts'
import { type Analyst, dataUrl, type ImageGenerator, type ImageInput, type MediaOutput } from './types.ts'

// ---- JSON schemas (strict structured outputs) -----------------------------------

const str = { type: 'string' }
const strArr = { type: 'array', items: str }
const obj = (properties: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
})
const check = obj({ ok: { type: 'boolean' }, notes: str })
const verdict = { type: 'string', enum: ['pass', 'warn', 'fail'] }
const unit = { type: 'number' } // 0..1, clamped by the caller

const SCENE_SCHEMA = obj({
  summary: str,
  cameraPosition: str,
  siteLayout: str,
  visibleStructures: strArr,
  workArea: obj({ description: str, box: obj({ x0: unit, y0: unit, x1: unit, y1: unit }) }),
  mustRemainUnchanged: strArr,
  lighting: str,
  risks: strArr,
})

const PLAN_SCHEMA = obj({
  stages: { type: 'array', items: obj({ title: str, description: str, checklist: strArr, motionHint: str }) },
})

const PROMPT_SCHEMA = obj({ prompt: str })

const IMAGE_REVIEW_SCHEMA = obj({
  verdict,
  score: { type: 'number' },
  stagePresent: check,
  sceneConsistent: check,
  cameraConsistent: check,
  artifacts: check,
  summary: str,
})

const CLIP_REVIEW_SCHEMA = obj({
  verdict,
  score: { type: 'number' },
  startMatches: check,
  endMatches: check,
  sceneConsistent: check,
  artifacts: check,
  summary: str,
})

// ---- Analyst -------------------------------------------------------------------

export class OpenAIAnalyst implements Analyst {
  readonly info: ProviderInfo
  private client: OpenAI

  constructor(apiKey: string, private model: string, private reasoning: 'low' | 'medium' | 'high') {
    this.client = new OpenAI({ apiKey })
    this.info = { id: 'openai-vision', label: 'OpenAI vision', kind: 'analyst', model, configured: true, primary: true, fake: false }
  }

  private async ask<T>(name: string, schema: object, instructions: string, parts: (string | { label: string; image: ImageInput })[]): Promise<T> {
    const content: ResponseInputContent[] = []
    for (const p of parts) {
      if (typeof p === 'string') content.push({ type: 'input_text', text: p })
      else {
        const small = await forVision(p.image)
        content.push({ type: 'input_text', text: `[${p.label}]` })
        content.push({ type: 'input_image', image_url: dataUrl(small), detail: 'high' })
      }
    }
    const res = await this.client.responses.create({
      model: this.model,
      reasoning: { effort: this.reasoning },
      instructions,
      input: [{ role: 'user', content }],
      text: { format: { type: 'json_schema', name, schema: schema as Record<string, unknown>, strict: true } },
    })
    if (!res.output_text) throw new Error(`${this.model} returned no output (${res.status})`)
    return JSON.parse(res.output_text) as T
  }

  analyzeScene: Analyst['analyzeScene'] = async ({ image, trade, desiredResult }) =>
    this.ask('scene_analysis', SCENE_SCHEMA, ANALYST_ROLE, [
      `Trade: ${trade.label}. Desired result: ${desiredResult}`,
      `Identify the work area (${trade.workAreaHint}). Give its bounding box in normalized 0..1 coordinates (x0,y0 top-left; x1,y1 bottom-right), tight but fully covering the surface to be rebuilt.`,
      'List concrete, checkable details that must remain unchanged in every generated stage (house facade, windows, roofline, landscaping, neighbouring property, sky, street, shadows direction, etc.).',
      'Describe the camera position precisely enough that a reviewer can tell if it moved. List risks that could make image editing hard (occlusions, cars on the driveway, reflections).',
      { label: 'Original photo', image },
    ])

  proposePlan: Analyst['proposePlan'] = async ({ image, scene, trade, desiredResult }) => {
    const out = await this.ask<{ stages: { title: string; description: string; checklist: string[]; motionHint: string }[] }>(
      'stage_plan',
      PLAN_SCHEMA,
      ANALYST_ROLE,
      [
        `Trade: ${trade.label}. Desired result: ${desiredResult}`,
        `Scene: ${JSON.stringify({ workArea: scene.workArea.description, layout: scene.siteLayout, risks: scene.risks })}`,
        'Adapt this standard stage sequence to the photo. Keep the order, 3–6 stages, the final stage must be the finished result. Each description must describe only what is VISIBLE in a still photo of the work area at the end of that stage. checklist = 3–5 short visual details a reviewer can verify. motionHint = what visibly changes in a time-lapse from the previous stage to this one.',
        JSON.stringify(trade.stages),
        { label: 'Original photo', image },
      ],
    )
    return out.stages
  }

  composeStagePrompt: Analyst['composeStagePrompt'] = async (i) => {
    const parts: (string | { label: string; image: ImageInput })[] = [
      `Write the image-editing prompt for stage ${i.stage.index + 1} of ${i.stages.length}: "${i.stage.title}".`,
      'Start from the baseline prompt below. Keep every constraint in it; make the stage description specific to what you see in these images (materials, edges, where the work area meets the house/lawn/street). Plain text, under 220 words, no markdown headings.',
      `Baseline prompt:\n${i.templatePrompt}`,
      { label: 'Original photo (scene that must stay unchanged)', image: i.original },
    ]
    if (i.previous) parts.push({ label: 'Approved previous stage (edit this image)', image: i.previous })
    parts.push({ label: 'Work-area mask (white = editable)', image: i.mask })
    const out = await this.ask<{ prompt: string }>('stage_prompt', PROMPT_SCHEMA, ANALYST_ROLE, parts)
    return out.prompt.trim()
  }

  reviewStageImage: Analyst['reviewStageImage'] = async (i) =>
    this.ask<Omit<ImageReview, 'reviewer'>>('stage_review', IMAGE_REVIEW_SCHEMA, REVIEWER_ROLE, [
      `Requested stage: "${i.stage.title}" — ${i.stage.description}`,
      `Checklist that must be visible: ${i.stage.checklist.join('; ')}`,
      `Must remain unchanged: ${i.scene.mustRemainUnchanged.join('; ')}. Camera: ${i.scene.cameraPosition}`,
      'Compare the CANDIDATE with the ORIGINAL and the BASE it was edited from. stagePresent: is the requested work stage clearly shown in the work area? sceneConsistent: did anything outside the work area change (buildings, landscaping, sky, objects added/removed)? cameraConsistent: same viewpoint, framing, lens, lighting direction? artifacts: warped geometry, melted edges, duplicated objects, text, people, smears. verdict: fail if any check is clearly broken, warn if minor, pass otherwise. score 0–100.',
      { label: 'ORIGINAL', image: i.original },
      { label: 'BASE', image: i.base },
      { label: 'CANDIDATE', image: i.candidate },
    ])

  reviewClip: Analyst['reviewClip'] = async (i) =>
    this.ask<Omit<ClipReview, 'reviewer'>>('clip_review', CLIP_REVIEW_SCHEMA, REVIEWER_ROLE, [
      `This is a short construction time-lapse clip that should go from the FROM image to the TO image ("${i.toStage.title}").`,
      `Must remain unchanged: ${i.scene.mustRemainUnchanged.join('; ')}. Camera: ${i.scene.cameraPosition}`,
      'Sampled frames are in time order. startMatches: does frame 1 match FROM? endMatches: does the last frame match TO? sceneConsistent: does the background/camera stay stable across frames (no camera drift, no morphing house)? artifacts: flicker, warping, objects popping, people, text. verdict + score 0–100.',
      { label: 'FROM (approved)', image: i.from },
      { label: 'TO (approved)', image: i.to },
      ...i.frames.map((f, n) => ({ label: `Clip frame ${n + 1}/${i.frames.length}`, image: f })),
    ])
}

const ANALYST_ROLE =
  'You are a construction visualization lead at Alto Pro. You plan photorealistic before/after construction sequences from a single real site photo. Be concrete and visual. Return only the requested JSON.'

const REVIEWER_ROLE =
  'You are a strict quality reviewer for AI-edited construction photos and clips. Judge only what is visible. Be specific in notes (what and where). Return only the requested JSON.'

// ---- Image generation (GPT Image edits) -----------------------------------------

export class OpenAIImageGenerator implements ImageGenerator {
  readonly info: ProviderInfo
  private client: OpenAI

  constructor(apiKey: string, private model: string, private quality: string) {
    this.client = new OpenAI({ apiKey })
    this.info = { id: 'openai-image', label: 'OpenAI GPT Image', kind: 'image', model, configured: true, primary: false, fake: false }
  }

  async generate({ prompt, base, references, mask }: Parameters<ImageGenerator['generate']>[0]): Promise<MediaOutput> {
    // The edit target must come first; the mask applies to it.
    const images = [base, ...references]
    const files = await Promise.all(
      images.map((img, i) => toFile(img.bytes, `image-${i}.${img.mimeType.split('/')[1] ?? 'png'}`, { type: img.mimeType })),
    )
    const alphaMask = await toAlphaEditMask(mask.bytes, base.width, base.height)
    const res = await this.client.images.edit({
      model: this.model,
      image: files,
      mask: await toFile(alphaMask, 'mask.png', { type: 'image/png' }),
      prompt,
      size: 'auto',
      quality: this.quality as 'high',
      input_fidelity: 'high',
      output_format: 'png',
    })
    const b64 = res.data?.[0]?.b64_json
    if (!b64) throw new Error(`${this.model} returned no image`)
    return { bytes: Buffer.from(b64, 'base64'), mimeType: 'image/png' }
  }
}
