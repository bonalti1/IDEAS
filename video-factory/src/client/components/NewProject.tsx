import { useEffect, useState } from 'react'
import type { AppConfigDTO, Project, TradeId } from '../../shared/types.ts'
import { api } from '../lib/api.ts'
import { Btn, Screen } from './ui.tsx'

export function NewProject({ config, onCreated }: { config: AppConfigDTO; onCreated: (p: Project) => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [trade, setTrade] = useState<TradeId>(config.trades[0].id)
  const [result, setResult] = useState(config.trades[0].defaultResult)
  const [aspect, setAspect] = useState<'auto' | '16:9' | '9:16'>('auto')
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!file) return setPreview(null)
    const u = URL.createObjectURL(file)
    setPreview(u)
    if (!name) setName(file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '))
    return () => URL.revokeObjectURL(u)
  }, [file]) // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file) return setError('Add a photo first.')
    setBusy(true)
    setError(null)
    const form = new FormData()
    form.set('name', name.trim() || 'New video')
    form.set('trade', trade)
    form.set('desiredResult', result)
    if (aspect !== 'auto') form.set('videoAspect', aspect)
    form.set('photo', file)
    try {
      onCreated(await api.createProject(form))
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit}>
      <Screen title="Start a new video" subtitle="Upload one photo of the site as it looks today. We'll take it from there.">
        <div className="split">
          <label
            className={`drop ${over ? 'over' : ''}`}
            onDragOver={(e) => (e.preventDefault(), setOver(true))}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setOver(false)
              const f = e.dataTransfer.files?.[0]
              if (f) setFile(f)
            }}
          >
            <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            {preview ? (
              <>
                <img src={preview} alt="Your photo" />
                <span className="small muted">Click to choose a different photo</span>
              </>
            ) : (
              <>
                <span className="big-icon">📷</span>
                <strong>Drop a photo here</strong>
                <span className="small muted">or click to choose one</span>
              </>
            )}
          </label>
          <div>
            <label className="field">
              <span>What kind of job?</span>
              <select
                value={trade}
                onChange={(e) => {
                  const t = config.trades.find((x) => x.id === e.target.value)!
                  setTrade(t.id)
                  setResult(t.defaultResult)
                }}
              >
                {config.trades.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Name it</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Smith driveway" />
            </label>
            <details className="more">
              <summary>More options</summary>
              <label className="field">
                <span>
                  Finished result <span className="hint">— what the last picture should show</span>
                </span>
                <textarea rows={3} value={result} onChange={(e) => setResult(e.target.value)} />
              </label>
              <label className="field">
                <span>Video shape</span>
                <select value={aspect} onChange={(e) => setAspect(e.target.value as typeof aspect)}>
                  <option value="auto">Match my photo</option>
                  <option value="16:9">Wide (16:9) — YouTube, website</option>
                  <option value="9:16">Tall (9:16) — Reels, TikTok, Shorts</option>
                </select>
              </label>
            </details>
            {error && <p className="err small">{error}</p>}
            <div className="actions">
              <Btn kind="primary" big type="submit" disabled={!file || busy}>
                {busy ? 'Uploading…' : 'Start'}
              </Btn>
            </div>
          </div>
        </div>
      </Screen>
    </form>
  )
}
