import crypto from 'node:crypto'
import sharp from 'sharp'
import type { ImageInput } from '../providers/types.ts'

export const sha256 = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex')

export async function toImageInput(bytes: Buffer, mimeType?: string): Promise<ImageInput> {
  const meta = await sharp(bytes).metadata()
  return {
    bytes,
    mimeType: mimeType ?? `image/${meta.format === 'jpeg' ? 'jpeg' : meta.format}`,
    width: meta.width ?? 0,
    height: meta.height ?? 0,
  }
}

/**
 * Normalize orientation and format without changing content: applies the
 * EXIF orientation, converts to sRGB JPEG (q95) or keeps lossless PNG, and
 * strips metadata. Pixels are never resized or edited.
 */
export async function normalizePhoto(bytes: Buffer): Promise<{ bytes: Buffer; mimeType: string; width: number; height: number }> {
  const img = sharp(bytes, { failOn: 'error' })
  const meta = await img.metadata()
  if (!meta.format || !['jpeg', 'png', 'webp', 'heif', 'tiff', 'avif'].includes(meta.format)) {
    throw new Error(`Unsupported photo format: ${meta.format ?? 'unknown'}`)
  }
  const upright = (meta.orientation ?? 1) === 1
  const srgb = !meta.space || meta.space === 'srgb'
  if (upright && srgb && (meta.format === 'jpeg' || meta.format === 'png')) {
    // Already upright in a supported format: keep the exact bytes.
    return { bytes, mimeType: `image/${meta.format}`, width: meta.width!, height: meta.height! }
  }
  const keepPng = meta.format === 'png'
  const pipeline = img.rotate().toColourspace('srgb')
  const out = keepPng
    ? await pipeline.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true })
    : await pipeline.jpeg({ quality: 95, chromaSubsampling: '4:4:4', mozjpeg: true }).toBuffer({ resolveWithObject: true })
  return {
    bytes: out.data,
    mimeType: keepPng ? 'image/png' : 'image/jpeg',
    width: out.info.width,
    height: out.info.height,
  }
}

/** Downscaled JPEG for vision models (token cost); never stored. */
export async function forVision(img: ImageInput, maxSide = 1536): Promise<ImageInput> {
  const out = await sharp(img.bytes)
    .resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer({ resolveWithObject: true })
  return { bytes: out.data, mimeType: 'image/jpeg', width: out.info.width, height: out.info.height }
}

/** Resize any image (e.g. a provider output) to exactly w×h, cropping to fill. */
export async function fitExactly(bytes: Buffer, w: number, h: number, format: 'png' | 'jpeg' = 'png') {
  const p = sharp(bytes).rotate().resize(w, h, { fit: 'cover', position: 'centre' })
  return format === 'png' ? p.png().toBuffer() : p.jpeg({ quality: 95 }).toBuffer()
}

/** Normalize a mask to a binary white-on-black PNG with the given size. */
export async function normalizeMask(bytes: Buffer, w: number, h: number): Promise<Buffer> {
  return sharp(bytes)
    .resize(w, h, { fit: 'fill' })
    .flatten({ background: '#000' })
    .greyscale()
    .threshold(128)
    .png()
    .toBuffer()
}

/** Fraction of mask pixels that are white. */
export async function maskCoverage(mask: Buffer): Promise<number> {
  const { data, info } = await sharp(mask).greyscale().raw().toBuffer({ resolveWithObject: true })
  let on = 0
  for (let i = 0; i < data.length; i += info.channels) if (data[i] > 127) on++
  return on / (info.width * info.height)
}

/** Rectangle mask (white inside box) — used as SAM fallback and by the fake segmenter. */
export async function boxMask(w: number, h: number, box: { x0: number; y0: number; x1: number; y1: number }) {
  const x = Math.round(box.x0 * w)
  const y = Math.round(box.y0 * h)
  const bw = Math.max(1, Math.round((box.x1 - box.x0) * w))
  const bh = Math.max(1, Math.round((box.y1 - box.y0) * h))
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#000"/><rect x="${x}" y="${y}" width="${bw}" height="${bh}" fill="#fff"/></svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

/**
 * OpenAI image-edit masks are RGBA PNGs where *transparent* pixels are the
 * area to edit. Convert our white-on-black mask accordingly.
 */
export async function toAlphaEditMask(mask: Buffer, w: number, h: number) {
  const alpha = await sharp(mask).resize(w, h, { fit: 'fill' }).greyscale().negate().raw().toBuffer()
  return sharp({ create: { width: w, height: h, channels: 3, background: '#000' } })
    .joinChannel(alpha, { raw: { width: w, height: h, channels: 1 } })
    .png()
    .toBuffer()
}

/** Center-crop (cover) to a video aspect ratio, e.g. for Veo's 16:9 / 9:16 frames. */
export async function cropToAspect(bytes: Buffer, aspect: '16:9' | '9:16', longSide = 1920) {
  const [aw, ah] = aspect === '16:9' ? [16, 9] : [9, 16]
  const w = aspect === '16:9' ? longSide : Math.round((longSide * aw) / ah)
  const h = aspect === '16:9' ? Math.round((longSide * ah) / aw) : longSide
  const out = await sharp(bytes).resize(w, h, { fit: 'cover', position: 'centre' }).jpeg({ quality: 95 }).toBuffer()
  return { bytes: out, mimeType: 'image/jpeg', width: w, height: h }
}

/** Nearest aspect ratio supported by Gemini image models. */
export function nearestImageAspect(w: number, h: number): string {
  const options = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']
  const r = w / h
  let best = options[0]
  let bestErr = Infinity
  for (const o of options) {
    const [a, b] = o.split(':').map(Number)
    const err = Math.abs(Math.log(r / (a / b)))
    if (err < bestErr) {
      bestErr = err
      best = o
    }
  }
  return best
}
