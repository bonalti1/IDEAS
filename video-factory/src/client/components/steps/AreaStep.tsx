import { useCallback, useEffect, useRef, useState } from 'react'
import { Btn, DoneBanner, LinkBtn, Screen, Working } from '../ui.tsx'
import { jobState, type StepProps } from './props.ts'

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
 * The work area is an alpha canvas (opaque = may change) at full photo
 * resolution, exported as a white-on-black PNG.
 */
export function AreaStep({ ctl, v, next }: StepProps) {
  const p = v.project
  const job = jobState(v, 'auto_mask', p.id)
  const approved = !!p.maskApprovedAt
  const canEdit = v.gates.autoMask.ok

  const view = useRef<HTMLCanvasElement>(null)
  const mask = useRef<HTMLCanvasElement | null>(null)
  const photo = useRef<HTMLImageElement | null>(null)
  const undo = useRef<ImageData[]>([])
  const drawing = useRef(false)
  const [fixing, setFixing] = useState(false)
  const [tool, setTool] = useState<'paint' | 'erase'>('paint')
  const [brush, setBrush] = useState(0.04)
  const [dirty, setDirty] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const redraw = useCallback(() => {
    const c = view.current
    const m = mask.current
    const img = photo.current
    if (!c || !m || !img) return
    const ctx = c.getContext('2d')!
    ctx.globalAlpha = 1
    ctx.drawImage(img, 0, 0)
    const tint = document.createElement('canvas')
    tint.width = m.width
    tint.height = m.height
    const t = tint.getContext('2d')!
    t.drawImage(m, 0, 0)
    t.globalCompositeOperation = 'source-in'
    t.fillStyle = '#f59e0b'
    t.fillRect(0, 0, m.width, m.height)
    ctx.globalAlpha = 0.55
    ctx.drawImage(tint, 0, 0)
    ctx.globalAlpha = 1
  }, [])

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
  const stroke = (e: React.PointerEvent) => {
    const c = view.current!
    const m = mask.current!
    const r = c.getBoundingClientRect()
    const x = ((e.clientX - r.left) / r.width) * c.width
    const y = ((e.clientY - r.top) / r.height) * c.height
    const ctx = m.getContext('2d')!
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
  const doUndo = () => {
    const last = undo.current.pop()
    if (!last || !mask.current) return
    mask.current.getContext('2d')!.putImageData(last, 0, 0)
    setDirty(true)
    redraw()
  }
  const saveMask = async () => {
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
    return ctl.act('PUT', '/mask', form)
  }
  const approve = async () => {
    if (dirty && !(await saveMask())) return
    if (await ctl.act('POST', '/mask/approve')) next()
  }

  const unsure = p.maskSource === 'auto' && (p.maskConfidence ?? 0) < LOW_CONFIDENCE

  return (
    <Screen title="Is the orange area where the work happens?" subtitle="Only the orange area will change in the pictures. Everything else stays exactly as it is in your photo.">
      {loadError && <p className="err">{loadError}</p>}
      {fixing && canEdit && (
        <div className="toolbar">
          <div className="seg">
            <button className={tool === 'paint' ? 'on' : ''} onClick={() => setTool('paint')}>
              Add
            </button>
            <button className={tool === 'erase' ? 'on' : ''} onClick={() => setTool('erase')}>
              Remove
            </button>
          </div>
          <label className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            Brush
            <input type="range" min={0.01} max={0.12} step={0.005} value={brush} onChange={(e) => setBrush(Number(e.target.value))} />
          </label>
          <Btn onClick={doUndo}>Undo</Btn>
          <Btn
            onClick={() =>
              op((ctx, m) => {
                const b = p.scene!.workArea.box
                ctx.clearRect(0, 0, m.width, m.height)
                ctx.fillStyle = '#fff'
                ctx.fillRect(b.x0 * m.width, b.y0 * m.height, (b.x1 - b.x0) * m.width, (b.y1 - b.y0) * m.height)
              })
            }
          >
            Start over
          </Btn>
        </div>
      )}
      <canvas
        ref={view}
        className={`mask-canvas ${fixing && canEdit ? 'editable' : ''}`}
        onPointerDown={(e) => {
          if (!fixing || !canEdit || !mask.current) return
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
      {fixing && <p className="tiny muted" style={{ marginTop: 8 }}>Paint with your finger or mouse. "Add" grows the orange area, "Remove" shrinks it.</p>}
      {job.running && (
        <div className="actions">
          <Working>Finding the work area…</Working>
        </div>
      )}
      {!job.running && !p.maskAssetId && (
        <div className="actions">
          {job.failed && <p className="err small">{job.failed}</p>}
          <Btn kind="primary" big onClick={() => ctl.act('POST', '/mask/auto')} disabled={ctl.busy}>
            Find the work area
          </Btn>
        </div>
      )}
      {!approved && p.maskAssetId && !job.running && (
        <>
          {unsure && !fixing && <div className="note" style={{ marginTop: 16 }}>We're not fully sure about this area. Take a close look, and fix it if anything is off.</div>}
          <div className="actions">
            <Btn kind="primary" big onClick={approve} disabled={ctl.busy}>
              {dirty ? 'Save and continue' : 'Yes, looks right'}
            </Btn>
            {!fixing ? <LinkBtn onClick={() => setFixing(true)}>Fix the area</LinkBtn> : dirty && <LinkBtn onClick={() => saveMask().then(() => setFixing(false))}>Save changes</LinkBtn>}
          </div>
        </>
      )}
      {approved && (
        <div className="actions">
          <DoneBanner action={<LinkBtn onClick={() => confirm('Change the work area? Everything after this step will need approving again.') && ctl.act('POST', '/reopen', { step: 'mask' })}>Change</LinkBtn>}>
            Work area set
          </DoneBanner>
        </div>
      )}
    </Screen>
  )
}
