import { useEffect, useState } from 'react'
import type { BrandingOptions } from '../../../shared/types.ts'
import { Btn, LinkBtn, Screen, Working } from '../ui.tsx'
import { jobState, type StepProps } from './props.ts'

export function ExportStep({ ctl, v }: StepProps) {
  const p = v.project
  const job = jobState(v, 'render', p.id)
  const stored = JSON.stringify(p.branding)
  const [b, setB] = useState<BrandingOptions>(p.branding)
  useEffect(() => setB(JSON.parse(stored)), [stored])
  const dirty = JSON.stringify(b) !== stored
  const set = <K extends keyof BrandingOptions>(k: K, val: BrandingOptions[K]) => setB((x) => ({ ...x, [k]: val }))
  const final = p.finalAssetId ? v.assets[p.finalAssetId] : null
  // Show the finished job as the still before playback starts.
  const lastStage = v.stages.at(-1)
  const lastImage = lastStage && v.candidates.find((c) => c.id === lastStage.approvedCandidateId)?.assetId
  const poster = lastImage ? v.assetUrls[lastImage] : undefined

  const make = async () => {
    if (dirty && !(await ctl.act('PUT', '/branding', b))) return
    await ctl.act('POST', '/render')
  }

  return (
    <Screen title={final ? 'Your video is ready' : 'Make your video'} subtitle={final ? 'Download it, or change the branding and make it again.' : 'We put all your approved clips together and add the Alto Pro branding.'}>
      {job.running && <Working>Putting your video together… about a minute.</Working>}
      {!job.running && final && (
        <div className="split">
          <video className="final" src={v.assetUrls[final.id]} poster={poster} controls playsInline preload="metadata" />
          <div>
            <p className="muted small">
              {final.width}×{final.height} · {final.durationSec?.toFixed(0)} seconds
            </p>
            <div className="actions">
              <a className="btn primary big" href={v.assetUrls[final.id]} download={`${p.name.replace(/[^\w-]+/g, '_')}.mp4`}>
                Download video
              </a>
              <LinkBtn onClick={make}>Make it again</LinkBtn>
            </div>
          </div>
        </div>
      )}
      {!job.running && !final && (
        <div className="actions" style={{ marginTop: 0 }}>
          {job.failed && <p className="err small">{job.failed}</p>}
          <Btn kind="primary" big onClick={make} disabled={ctl.busy || !v.gates.render.ok}>
            Make my video
          </Btn>
        </div>
      )}
      <details className="more">
        <summary>Branding</summary>
        <label className="check">
          <input type="checkbox" checked={b.enabled} onChange={(e) => set('enabled', e.target.checked)} /> Add Alto Pro branding
        </label>
        {b.enabled && (
          <>
            <div className="row">
              <label className="field">
                <span>Opening title</span>
                <input value={b.title} onChange={(e) => set('title', e.target.value)} />
              </label>
              <label className="field">
                <span>Subtitle</span>
                <input value={b.subtitle} onChange={(e) => set('subtitle', e.target.value)} />
              </label>
            </div>
            <label className="field">
              <span>Closing text</span>
              <input value={b.outroText} onChange={(e) => set('outroText', e.target.value)} />
            </label>
            <label className="check">
              <input type="checkbox" checked={b.watermark} onChange={(e) => set('watermark', e.target.checked)} /> Show the Alto Pro logo in the corner
            </label>
            <div className="row">
              <label className="field">
                <span>Opening (seconds)</span>
                <input type="number" min={0} max={10} step={0.5} value={b.introSeconds} onChange={(e) => set('introSeconds', Number(e.target.value))} />
              </label>
              <label className="field">
                <span>Closing (seconds)</span>
                <input type="number" min={0} max={10} step={0.5} value={b.outroSeconds} onChange={(e) => set('outroSeconds', Number(e.target.value))} />
              </label>
              <label className="field">
                <span>Pause on finished job</span>
                <input type="number" min={0} max={10} step={0.5} value={b.holdFinalSeconds} onChange={(e) => set('holdFinalSeconds', Number(e.target.value))} />
              </label>
            </div>
          </>
        )}
        {dirty && <p className="tiny muted">Changes apply the next time you make the video.</p>}
      </details>
    </Screen>
  )
}
