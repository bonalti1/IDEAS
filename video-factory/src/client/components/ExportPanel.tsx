import { useEffect, useState } from 'react'
import { hasActiveJob } from '../../shared/gates.ts'
import type { BrandingOptions, ProjectViewDTO } from '../../shared/types.ts'
import type { ProjectCtl } from '../lib/api.ts'
import { Button, GateNote, Spinner } from './ui.tsx'

export function ExportPanel({ ctl, v }: { ctl: ProjectCtl; v: ProjectViewDTO }) {
  const p = v.project
  const stored = JSON.stringify(p.branding)
  const [b, setB] = useState<BrandingOptions>(p.branding)
  useEffect(() => setB(JSON.parse(stored)), [stored])
  const dirty = JSON.stringify(b) !== stored
  const rendering = hasActiveJob(v, 'render', p.id)
  const set = <K extends keyof BrandingOptions>(k: K, val: BrandingOptions[K]) => setB((x) => ({ ...x, [k]: val }))
  const final = p.finalAssetId ? v.assets[p.finalAssetId] : null

  return (
    <section className="panel">
      <h2>Assemble and export</h2>
      <GateNote gate={rendering ? { ok: true } : v.gates.render} />
      <div className="grid2">
        <fieldset className="form">
          <label className="check">
            <input type="checkbox" checked={b.enabled} onChange={(e) => set('enabled', e.target.checked)} /> Alto branding
          </label>
          <fieldset disabled={!b.enabled} className="form">
            <label className="field">
              <span>Title</span>
              <input value={b.title} onChange={(e) => set('title', e.target.value)} />
            </label>
            <label className="field">
              <span>Subtitle</span>
              <input value={b.subtitle} onChange={(e) => set('subtitle', e.target.value)} />
            </label>
            <label className="field">
              <span>Outro text</span>
              <input value={b.outroText} onChange={(e) => set('outroText', e.target.value)} />
            </label>
            <div className="row">
              <label className="field inline">
                <span>Intro s</span>
                <input type="number" min={0} max={10} step={0.5} value={b.introSeconds} onChange={(e) => set('introSeconds', Number(e.target.value))} />
              </label>
              <label className="field inline">
                <span>Outro s</span>
                <input type="number" min={0} max={10} step={0.5} value={b.outroSeconds} onChange={(e) => set('outroSeconds', Number(e.target.value))} />
              </label>
              <label className="field inline">
                <span>Hold final s</span>
                <input type="number" min={0} max={10} step={0.5} value={b.holdFinalSeconds} onChange={(e) => set('holdFinalSeconds', Number(e.target.value))} />
              </label>
            </div>
            <label className="check">
              <input type="checkbox" checked={b.watermark} onChange={(e) => set('watermark', e.target.checked)} /> Alto Pro watermark on clips
            </label>
          </fieldset>
          <div className="actions">
            <Button disabled={!dirty} busy={ctl.busy} onClick={() => ctl.act('PUT', '/branding', b)}>
              Save branding
            </Button>
            <Button kind="primary" gate={dirty ? { ok: false, reason: 'Save branding first.' } : v.gates.render} busy={ctl.busy || rendering} onClick={() => ctl.act('POST', '/render')}>
              {rendering ? 'Rendering…' : final ? 'Render again' : 'Render final video'}
            </Button>
          </div>
        </fieldset>
        <div>
          {rendering && (
            <div className="ph tall">
              <Spinner /> Rendering…
            </div>
          )}
          {final && !rendering && (
            <>
              <video className="final" src={v.assetUrls[final.id]} controls playsInline />
              <p className="small">
                {final.width}×{final.height} · {final.durationSec?.toFixed(1)} s · {(final.bytes / 1e6).toFixed(1)} MB
              </p>
              <a className="btn primary" href={v.assetUrls[final.id]} download={`${p.name.replace(/[^\w-]+/g, '_')}.mp4`}>
                Download MP4
              </a>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
