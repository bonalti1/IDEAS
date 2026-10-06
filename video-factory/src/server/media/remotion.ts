import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BrandingOptions } from '../../shared/types.ts'
import { withTempDir } from './video.ts'

let bundled: Promise<string> | null = null

/** Bundles src/remotion once per process. */
function bundleOnce() {
  bundled ??= (async () => {
    const { bundle } = await import('@remotion/bundler')
    const entry = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../remotion/Root.tsx')
    return bundle({ entryPoint: entry })
  })()
  return bundled
}

/** Renders the Alto intro/outro cards with Remotion (used when RENDER_ENGINE=remotion). */
export async function renderBrandCards(i: { branding: BrandingOptions; width: number; height: number; browserExecutable?: string }) {
  const { renderMedia, selectComposition } = await import('@remotion/renderer')
  const serveUrl = await bundleOnce()
  const b = i.branding
  const render = (props: Record<string, unknown>) =>
    withTempDir(async (dir) => {
      const inputProps = { ...props, w: i.width, h: i.height }
      const composition = await selectComposition({ serveUrl, id: 'BrandCard', inputProps, browserExecutable: i.browserExecutable ?? null })
      const out = path.join(dir, 'card.mp4')
      await renderMedia({ composition, serveUrl, codec: 'h264', outputLocation: out, inputProps, browserExecutable: i.browserExecutable ?? null, muted: true })
      return fs.readFile(out)
    })
  const intro = b.introSeconds > 0 ? await render({ title: b.title, subtitle: b.subtitle, kicker: 'ALTO PRO', seconds: b.introSeconds }) : undefined
  const outro = b.outroSeconds > 0 ? await render({ title: b.outroText, subtitle: b.title, kicker: 'ALTO PRO', seconds: b.outroSeconds }) : undefined
  return { intro, outro }
}
