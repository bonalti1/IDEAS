import { useCallback, useEffect, useRef, useState } from 'react'
import { hasActiveJob } from '../../shared/gates.ts'
import type { ProjectViewDTO } from '../../shared/types.ts'
import type { ProjectCtl } from '../lib/api.ts'
import { Button, Chip, GateNote, Spinner } from './ui.tsx'

type Tool = 'paint' | 'erase'
const LOW_CONFIDENCE = 0.6

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous' // R2 signed URLs need CORS for canvas read-back
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Could not load ${src}`))
    img.src = src
  })
}

/**
 * Mask editor. Internally the mask is an alpha canvas (opaque = work area) at
 * the photo's full resolution; it is exported as a white-on-black PNG.
 */
export function MaskPanel({ ctl, v }: { ctl: ProjectCtl; v: ProjectViewDTO }) {
  const p = v.project
  const approved = !!p.maskApprovedAt
  const running = hasActiveJob(v, 'auto_mask', p.id)
  const editable = v.gates.autoMask.ok

  const view = useRef<HTMLCanvasElement>(null)
  const mask = useRef<HTMLCanvasElement | null>(null)
  const photo = useRef<HTMLImageElement | null>(null)
  const undo = useRef<ImageData[]>([])
  const drawing = useRef(false)
  const [tool, setTool] = useState<Tool>('paint')
  const [brush, setBrush] = useState(0.04)
  const [dirty, setDirty] = useState(false)
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const redraw = useCallback(() => {
    const c = view.current
    const m = mask.current
    const img = photo.current
    if (!c || !m || !img) return
    const ctx = c.getContext('2d')!
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    ctx.drawImage(img, 0, 0)
    const tint = document.createElement('canvas')
    tint.width = m.width
    tint.height = m.height
    const t = tint.getContext('2d')!
    t.drawImage(m, 0, 0)
    t.globalCompositeOperation = 'source-in'
    t.fillStyle = '#f59e0b'
    t.fillRect(0, 0, m.width, m.height)
    ctx.globalAlpha = 0.5
    ctx.drawImage(tint, 0, 0)
    ctx.globalAlpha = 1
  }, [])

  // Load photo + current mask whenever the stored mask changes.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const img = await loadImage(v.assetUrls[p.normalizedAssetId])
        const m = document.createElement('canvas')
        m.width = img.naturalWidth
        m.height = img.naturalHeight
        if (p.maskAssetId && v.assetUrls[p.maskAssetId]) {
          const mi = await loadImage(v.assetUrls[p.maskAssetId])
          const ctx = m.getContext('2d', { willReadFrequently: true })!
          ctx.drawImage(mi, 0, 0, m.width, m.height)
          const d = ctx.getImageData(0, 0, m.width, m.height)
          for (let i = 0; i < d.data.length; i += 4) {
            const on = d.data[i] > 127
            d.data[i] = d.data[i + 1] = d.data[i + 2] = 255
            d.data[i + 3] = on ? 255 : 0
          }
          ctx.putImageData(d, 0, 0)
        }
        if (cancelled) return
        photo.current = img
        mask.current = m
        undo.current = []
        if (view.current) {
          view.current.width = m.width
          view.current.height = m.height
        }
        setDirty(false)
        setReady(true)
        redraw()
      } catch (e) {
        if (!cancelled) setLoadError((e as Error).message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [p.maskAssetId, p.normalizedAssetId]) // eslint-disable-line react-hooks/exhaustive-deps

  const snapshot = () => {
    const m = mask.current!
    undo.current.push(m.getContext('2d')!.getImageData(0, 0, m.width, m.height))
    if (undo.current.length > 25) undo.current.shift()
  }

  const toCanvas = (e: React.PointerEvent) => {
    const c = view.current!
    const r = c.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height }
  }

  const stroke = (e: React.PointerEvent) => {
    const m = mask.current!
    const ctx = m.getContext('2d')!
    const { x, y } = toCanvas(e)
    ctx.globalCompositeOperation = tool === 'paint' ? 'source-over' : 'destination-out'
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    ctx.arc(x, y, brush * m.width, 0, Math.PI * 2)
    ctx.fill()
    redraw()
  }

  const op = (fn: (ctx: CanvasRenderingContext2D, m: HTMLCanvasElement) => void) => {
    const m = mask.current
    if (!m) return
    snapshot()
    const ctx = m.getContext('2d')!
    ctx.globalCompositeOperation = 'source-over'
    fn(ctx, m)
    setDirty(true)
    redraw()
  }

  const fillBox = () =>
    op((ctx, m) => {
      const b = p.scene!.workArea.box
      ctx.fillStyle = '#fff'
      ctx.fillRect(b.x0 * m.width, b.y0 * m.height, (b.x1 - b.x0) * m.width, (b.y1 - b.y0) * m.height)
    })
  const clear = () => op((ctx, m) => ctx.clearRect(0, 0, m.width, m.height))
  const invert = () =>
    op((ctx, m) => {
      const d = ctx.getImageData(0, 0, m.width, m.height)
      for (let i = 3; i < d.data.length; i += 4) d.data[i] = d.data[i] > 127 ? 0 : 255
      for (let i = 0; i < d.data.length; i += 4) d.data[i] = d.data[i + 1] = d.data[i + 2] = 255
      ctx.putImageData(d, 0, 0)
    })
  const doUndo = () => {
    const last = undo.current.pop()
    if (!last || !mask.current) return
    mask.current.getContext('2d')!.putImageData(last, 0, 0)
    setDirty(true)
    redraw()
  }

  const save = async () => {
    const m = mask.current!
    const out = document.createElement('canvas')
    out.width = m.width
    out.height = m.height
    const ctx = out.getContext('2d')!
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, m.width, m.height)
    ctx.drawImage(m, 0, 0)
    const blob = await new Promise<Blob>((r) => out.toBlob((b) => r(b!), 'image/png'))
    const form = new FormData()
    form.set('mask', new File([blob], 'mask.png', { type: 'image/png' }))
    await ctl.act('PUT', '/mask', form)
  }

  const lowConfidence = p.maskSource === 'auto' && (p.maskConfidence ?? 0) < LOW_CONFIDENCE

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Work-area mask</h2>
        {approved ? <Chip tone="ok">Approved</Chip> : p.maskAssetId ? <Chip tone="warn">Needs approval</Chip> : null}
        {p.maskSource && <Chip tone="muted">{p.maskSource === 'auto' ? `SAM 2 · confidence ${Math.round((p.maskConfidence ?? 0) * 100)}%` : 'Manual'}</Chip>}
      </div>
      <GateNote gate={v.gates.autoMask.ok || approved ? { ok: true } : v.gates.autoMask} />
      {lowConfidence && !approved && (
        <p className="warn-box">Automatic segmentation is uncertain. Check the orange area carefully and correct it with the brush before approving.</p>
      )}
      <div className="mask-layout">
        <div className="mask-canvas-wrap">
          {loadError && <p className="err">{loadError}</p>}
          {!ready && !loadError && <Spinner />}
          <canvas
            ref={view}
            className={`mask-canvas ${editable ? 'editable' : ''}`}
            onPointerDown={(e) => {
              if (!editable || !ready) return
              ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
              snapshot()
              drawing.current = true
              setDirty(true)
              stroke(e)
            }}
            onPointerMove={(e) => drawing.current && stroke(e)}
            onPointerUp={() => (drawing.current = false)}
            onPointerLeave={() => (drawing.current = false)}
          />
          <p className="muted small">Orange = work area the image models may change. Everything else must stay identical.</p>
        </div>
        <div className="mask-tools">
          <Button kind="primary" gate={v.gates.autoMask} busy={ctl.busy || running} onClick={() => ctl.act('POST', '/mask/auto')}>
            {running ? 'Segmenting…' : p.maskAssetId ? 'Re-run automatic mask' : 'Automatic mask (SAM 2)'}
          </Button>
          <div className="tool-group">
            <span className="muted small">Manual edit</span>
            <div className="seg">
              <button className={tool === 'paint' ? 'on' : ''} disabled={!editable} onClick={() => setTool('paint')}>
                Paint
              </button>
              <button className={tool === 'erase' ? 'on' : ''} disabled={!editable} onClick={() => setTool('erase')}>
                Erase
              </button>
            </div>
            <label className="field inline">
              <span>Brush</span>
              <input type="range" min={0.005} max={0.12} step={0.005} value={brush} disabled={!editable} onChange={(e) => setBrush(Number(e.target.value))} />
            </label>
            <div className="btn-row">
              <Button disabled={!editable || !p.scene} onClick={fillBox}>
                Fill scene box
              </Button>
              <Button disabled={!editable} onClick={invert}>
                Invert
              </Button>
              <Button disabled={!editable} onClick={clear}>
                Clear
              </Button>
              <Button disabled={!editable || !undo.current.length} onClick={doUndo}>
                Undo
              </Button>
            </div>
            <Button disabled={!editable || !dirty} busy={ctl.busy} onClick={save}>
              Save manual mask
            </Button>
          </div>
          <div className="actions">
            {!approved ? (
              <Button kind="approve" gate={dirty ? { ok: false, reason: 'Save the manual mask first.' } : v.gates.approveMask} busy={ctl.busy} onClick={() => ctl.act('POST', '/mask/approve')}>
                Approve mask
              </Button>
            ) : (
              <Button
                kind="danger"
                busy={ctl.busy}
                onClick={() => confirm('Reopen the mask? This un-approves the plan, every stage image and every clip.') && ctl.act('POST', '/reopen', { step: 'mask' })}
              >
                Reopen mask
              </Button>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
