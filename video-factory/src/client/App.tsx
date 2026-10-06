import { useEffect, useState } from 'react'
import type { AppConfigDTO, ProjectSummaryDTO } from '../shared/types.ts'
import { NewProject } from './components/NewProject.tsx'
import { ProjectView } from './components/ProjectView.tsx'
import { Btn } from './components/ui.tsx'
import { api, useHashRoute } from './lib/api.ts'

export function App() {
  const [route, go] = useHashRoute()
  const [config, setConfig] = useState<AppConfigDTO | null>(null)
  const [projects, setProjects] = useState<ProjectSummaryDTO[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [section, id, tab] = route

  useEffect(() => {
    api.config().then(setConfig).catch((e) => setError(e.message))
  }, [])
  useEffect(() => {
    if (!section) api.projects().then(setProjects).catch((e) => setError(e.message))
  }, [section])

  const fakes = config?.providers.filter((p) => p.fake).length ?? 0

  return (
    <>
      <header className="topbar">
        <a className="brand" href="#/">
          <span className="brand-mark">ALTO</span> Video Factory
        </a>
        <span className="spacer" />
        {fakes > 0 && (
          <span className="tiny muted" title="Add API keys in .env to use the real AI models">
            Demo mode
          </span>
        )}
        {section !== 'new' && (
          <Btn kind="primary" onClick={() => go('new')}>
            + New video
          </Btn>
        )}
      </header>
      <main className="page">
        {error && (
          <div className="toast" onClick={() => setError(null)}>
            {error}
          </div>
        )}
        {section === 'new' && config && <NewProject config={config} onCreated={(p) => go(`p/${p.id}`)} />}
        {section === 'p' && id && config && <ProjectView key={id} id={id} tab={tab} config={config} go={go} />}
        {!section && <Home projects={projects} onNew={() => go('new')} />}
      </main>
    </>
  )
}

function Home({ projects, onNew }: { projects: ProjectSummaryDTO[] | null; onNew: () => void }) {
  if (!projects) return null
  if (!projects.length) {
    return (
      <div className="screen empty-state">
        <h1>Turn one job-site photo into a build video</h1>
        <p className="muted">You approve every picture and clip. Nothing moves on without you.</p>
        <div className="how">
          <div>
            <b>1. Upload a photo</b>
            <span className="muted small">One real photo of the site, as it is today.</span>
          </div>
          <div>
            <b>2. Approve each stage</b>
            <span className="muted small">The AI draws each step of the build. You pick the best one.</span>
          </div>
          <div>
            <b>3. Get your video</b>
            <span className="muted small">Approved pictures become a smooth, branded video.</span>
          </div>
        </div>
        <Btn kind="primary" big onClick={onNew}>
          Start your first video
        </Btn>
      </div>
    )
  }
  return (
    <>
      <div className="hero">
        <div>
          <h1>Your videos</h1>
          <p>Pick up where you left off, or start a new one.</p>
        </div>
      </div>
      <div className="cards">
        {projects.map((p) => (
          <a key={p.id} className="pcard" href={`#/p/${p.id}`}>
            {p.thumbUrl ? <img src={p.thumbUrl} alt="" /> : <div className="ph" />}
            <div className="body">
              <strong>{p.name}</strong>
              <span className="small muted">{p.finalAssetId ? '✓ Video ready' : 'In progress'} · {new Date(p.createdAt).toLocaleDateString()}</span>
            </div>
          </a>
        ))}
      </div>
    </>
  )
}
