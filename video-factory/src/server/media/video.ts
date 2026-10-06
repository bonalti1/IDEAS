import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import type { BrandingOptions } from '../../shared/types.ts'

export function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (err += d))
    p.on('error', reject)
    p.on('close', (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}: ${err.split('\n').slice(-6).join('\n')}`)),
    )
  })
}

const ff = (args: string[]) => run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args])

export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-'))
  try {
    return await fn(dir)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}

export async function probe(file: string) {
  const out = await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file])
  const j = JSON.parse(out) as { format: { duration?: string }; streams: { codec_type: string; width?: number; height?: number }[] }
  const v = j.streams.find((s) => s.codec_type === 'video')
  if (!v) throw new Error('No video stream')
  return { durationSec: Number(j.format.duration ?? 0), width: v.width ?? 0, height: v.height ?? 0 }
}

export async function probeBytes(bytes: Buffer) {
  return withTempDir(async (dir) => {
    const f = path.join(dir, 'in.mp4')
    await fs.writeFile(f, bytes)
    return probe(f)
  })
}

/** Evenly spaced frames from first to (almost) last, as JPEGs. */
export async function sampleFrames(video: Buffer, count: number): Promise<Buffer[]> {
  return withTempDir(async (dir) => {
    const f = path.join(dir, 'in.mp4')
    await fs.writeFile(f, video)
    const { durationSec } = await probe(f)
    const n = Math.max(2, count)
    const frames: Buffer[] = []
    for (let i = 0; i < n; i++) {
      const t = i === n - 1 ? Math.max(0, durationSec - 0.1) : (durationSec * i) / (n - 1)
      const out = path.join(dir, `f${i}.jpg`)
      await ff(['-ss', t.toFixed(3), '-i', f, '-frames:v', '1', '-q:v', '2', out])
      frames.push(await fs.readFile(out))
    }
    return frames
  })
}

/** Cross-dissolve between two stills. Used by the fake video provider. */
export async function crossfadeStills(a: Buffer, b: Buffer, durationSec: number, w: number, h: number): Promise<Buffer> {
  return withTempDir(async (dir) => {
    const fa = path.join(dir, 'a.png')
    const fb = path.join(dir, 'b.png')
    await fs.writeFile(fa, await sharp(a).resize(w, h, { fit: 'cover' }).png().toBuffer())
    await fs.writeFile(fb, await sharp(b).resize(w, h, { fit: 'cover' }).png().toBuffer())
    const out = path.join(dir, 'out.mp4')
    const fade = Math.max(0.5, durationSec * 0.7)
    const offset = (durationSec - fade) / 2
    await ff([
      '-loop', '1', '-t', String(durationSec), '-i', fa,
      '-loop', '1', '-t', String(durationSec), '-i', fb,
      '-filter_complex', `[0][1]xfade=transition=fade:duration=${fade}:offset=${offset},fps=24,format=yuv420p[v]`,
      '-map', '[v]', '-t', String(durationSec), '-c:v', 'libx264', '-crf', '20', '-movflags', '+faststart', out,
    ])
    return fs.readFile(out)
  })
}

// ---- assembly ------------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export async function titleCard(w: number, h: number, title: string, subtitle: string): Promise<Buffer> {
  const s = Math.min(w, h)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <rect width="100%" height="100%" fill="#0f1720"/>
  <rect x="${w * 0.08}" y="${h * 0.5 - s * 0.004}" width="${s * 0.12}" height="${s * 0.008}" fill="#f59e0b"/>
  <text x="${w * 0.08}" y="${h * 0.5 - s * 0.05}" font-family="Inter, DejaVu Sans, sans-serif" font-weight="700" font-size="${s * 0.075}" fill="#ffffff">${esc(title)}</text>
  <text x="${w * 0.08}" y="${h * 0.5 + s * 0.07}" font-family="Inter, DejaVu Sans, sans-serif" font-size="${s * 0.04}" fill="#cbd5e1">${esc(subtitle)}</text>
  <text x="${w * 0.92}" y="${h * 0.92}" text-anchor="end" font-family="Inter, DejaVu Sans, sans-serif" font-weight="700" letter-spacing="${s * 0.004}" font-size="${s * 0.03}" fill="#f59e0b">ALTO PRO</text>
</svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

export async function watermarkPng(w: number, h: number, logoFile?: string): Promise<Buffer> {
  const s = Math.min(w, h)
  if (logoFile) {
    return sharp(logoFile).resize({ height: Math.round(s * 0.07) }).png().toBuffer()
  }
  const tw = Math.round(s * 0.26)
  const th = Math.round(s * 0.07)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${tw}" height="${th}">
  <rect width="100%" height="100%" rx="${th * 0.2}" fill="#0f1720" fill-opacity="0.55"/>
  <text x="50%" y="66%" text-anchor="middle" font-family="Inter, DejaVu Sans, sans-serif" font-weight="700" letter-spacing="${s * 0.003}" font-size="${th * 0.5}" fill="#ffffff">ALTO PRO</text>
</svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

export interface AssembleInput {
  clips: Buffer[] // approved clips, in order
  width: number
  height: number
  fps?: number
  branding: BrandingOptions
  logoFile?: string
  /** Pre-rendered intro/outro segments (e.g. from Remotion). Overrides the built-in cards. */
  introVideo?: Buffer
  outroVideo?: Buffer
}

/**
 * Normalizes every clip to one size/fps/codec, optionally overlays the Alto
 * watermark, holds the final frame, adds intro/outro cards and concatenates.
 * Audio is dropped: providers differ in whether they return audio at all.
 */
export async function assemble(i: AssembleInput): Promise<Buffer> {
  const fps = i.fps ?? 30
  const { width: W, height: H, branding: b } = i
  return withTempDir(async (dir) => {
    const parts: string[] = []
    const enc = ['-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-r', String(fps), '-an']
    const scale = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${fps}`

    const card = async (name: string, png: Buffer, sec: number) => {
      const f = path.join(dir, `${name}.png`)
      await fs.writeFile(f, png)
      const out = path.join(dir, `${name}.mp4`)
      const fadeOut = Math.max(0, sec - 0.5)
      await ff(['-loop', '1', '-t', String(sec), '-i', f, '-vf', `${scale},fade=t=in:st=0:d=0.4,fade=t=out:st=${fadeOut}:d=0.5`, ...enc, out])
      return out
    }
    const segment = async (name: string, bytes: Buffer) => {
      const src = path.join(dir, `${name}-src.mp4`)
      await fs.writeFile(src, bytes)
      const out = path.join(dir, `${name}.mp4`)
      await ff(['-i', src, '-vf', scale, ...enc, out])
      return out
    }

    if (b.enabled && b.introSeconds > 0) {
      parts.push(i.introVideo ? await segment('intro', i.introVideo) : await card('intro', await titleCard(W, H, b.title, b.subtitle), b.introSeconds))
    }

    const wm = b.enabled && b.watermark ? path.join(dir, 'wm.png') : null
    if (wm) await fs.writeFile(wm, await watermarkPng(W, H, i.logoFile))
    for (let n = 0; n < i.clips.length; n++) {
      const src = path.join(dir, `clip${n}-src.mp4`)
      await fs.writeFile(src, i.clips[n])
      const out = path.join(dir, `clip${n}.mp4`)
      const last = n === i.clips.length - 1
      const hold = last && b.holdFinalSeconds > 0 ? `,tpad=stop_mode=clone:stop_duration=${b.holdFinalSeconds}` : ''
      const margin = Math.round(Math.min(W, H) * 0.03)
      const args = wm
        ? ['-i', src, '-i', wm, '-filter_complex', `[0:v]${scale}${hold}[b];[b][1:v]overlay=W-w-${margin}:H-h-${margin}[v]`, '-map', '[v]']
        : ['-i', src, '-vf', `${scale}${hold}`]
      await ff([...args, ...enc, out])
      parts.push(out)
    }

    if (b.enabled && b.outroSeconds > 0) {
      parts.push(i.outroVideo ? await segment('outro', i.outroVideo) : await card('outro', await titleCard(W, H, b.outroText, b.title), b.outroSeconds))
    }

    const list = path.join(dir, 'list.txt')
    await fs.writeFile(list, parts.map((p) => `file '${p}'`).join('\n'))
    const final = path.join(dir, 'final.mp4')
    await ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', final])
    return fs.readFile(final)
  })
}
