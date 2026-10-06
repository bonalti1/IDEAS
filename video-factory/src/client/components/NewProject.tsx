import { useEffect, useState } from 'react'
import type { AppConfigDTO, Project, TradeId } from '../../shared/types.ts'
import { api } from '../lib/api.ts'
import { Button } from './ui.tsx'

export function NewProject({ config, onCreated }: { config: AppConfigDTO; onCreated: (p: Project) => void }) {
  const [name, setName] = useState('')
  const [trade, setTrade] = useState<TradeId>(config.trades[0].id)
  const [result, setResult] = useState(config.trades[0].defaultResult)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [aspect, setAspect] = useState<'auto' | '16:9' | '9:16'>('auto')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!file) return setPreview(null)
    const u = URL.createObjectURL(file)
    setPreview(u)
    return () => URL.revokeObjectURL(u)
  }, [file])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file) return setError('Choose a project photo.')
    setBusy(true)
    setError(null)
    const form = new FormData()
    form.set('name', name || file.name.replace(/\.[^.]+$/, ''))
    form.set('trade', trade)
    form.set('desiredResult', result)
    if (aspect !== 'auto') form.set('videoAspect', aspect)
    form.set('photo', file)
    try {
      onCreated(await api.createProject(form))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="panel new-project" onSubmit={submit}>
      <h1>New project</h1>
      <div className="grid2">
        <div>
          <label className="field">
            <span>Project name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Smith residence driveway" />
          </label>
          <label className="field">
            <span>Trade / workflow</span>
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
            <span>Desired result</span>
            <textarea rows={3} value={result} onChange={(e) => setResult(e.target.value)} />
          </label>
          <label className="field">
            <span>Video format</span>
            <select value={aspect} onChange={(e) => setAspect(e.target.value as typeof aspect)}>
              <option value="auto">Match photo (landscape → 16:9, portrait → 9:16)</option>
              <option value="16:9">16:9 landscape</option>
              <option value="9:16">9:16 vertical</option>
            </select>
          </label>
        </div>
        <div>
          <label className="field">
            <span>Project photo</span>
            <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          {preview ? <img className="preview" src={preview} alt="Selected photo" /> : <div className="drop muted">One real photo of the site, as taken.</div>}
          <p className="muted small">
            The upload is stored unchanged. A normalized copy (orientation and format only) is used for processing.
          </p>
        </div>
      </div>
      {error && <p className="err">{error}</p>}
      <Button kind="primary" type="submit" busy={busy}>
        {busy ? 'Uploading…' : 'Create project'}
      </Button>
    </form>
  )
}
