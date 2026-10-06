import { useEffect, useState } from 'react'
import type { AppConfigDTO, Project } from '../shared/types.ts'
import { NewProject } from './components/NewProject.tsx'
import { ProjectView } from './components/ProjectView.tsx'
import { Chip } from './components/ui.tsx'
import { api, useHashRoute } from './lib/api.ts'

export function App() {
  const [route, go] = useHashRoute()
  const [config, setConfig] = useState<AppConfigDTO | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [error, setError] = useState<string | null>(null)

  const loadProjects = () => api.projects().then(setProjects).catch((e) => setError(e.message))
  useEffect(() => {
    api.config().then(setConfig).catch((e) => setError(e.message))
    loadProjects()
  }, [])

  const fakes = config?.providers.filter((p) => p.fake) ?? []
  const [section, id, tab] = route

  return (
    <div className="app">
      <aside className="sidebar">
        <a className="brand" href="#/">
          <span className="brand-mark">ALTO</span> Video Factory
        </a>
        <button className="btn primary block" onClick={() => go('new')}>
          + New project
        </button>
        <nav className="projects">
          {projects.map((p) => (
            <a key={p.id} href={`#/p/${p.id}`} className={id === p.id ? 'active' : ''}>
              <span>{p.name}</span>
              <span className="muted small">{new Date(p.createdAt).toLocaleDateString()}</span>
            </a>
          ))}
          {!projects.length && <p className="muted small">No projects yet.</p>}
        </nav>
        {config && (
          <div className="sys small">
            <div>
              Store: <span className="mono">{config.store}</span>
            </div>
            <div>
              Media: <span className="mono">{config.storage}</span>
            </div>
            <div>
              Jobs: <span className="mono">{config.jobs}</span>
            </div>
            {fakes.length > 0 && (
              <div className="fake-note">
                <Chip tone="fake">{fakes.length} fake provider(s)</Chip>
                <span>Set API keys in .env for real output.</span>
              </div>
            )}
          </div>
        )}
      </aside>
      <main className="content">
        {error && <div className="toast err">{error}</div>}
        {section === 'new' && config && (
          <NewProject
            config={config}
            onCreated={(p) => {
              loadProjects()
              go(`p/${p.id}/scene`)
            }}
          />
        )}
        {section === 'p' && id && config && <ProjectView key={id} id={id} tab={tab} config={config} go={go} />}
        {!section && (
          <div className="empty">
            <h1>Alto Video Factory</h1>
            <p>
              Turn one real project photo into an approved, stage-by-stage construction video. Every prompt, image and clip is reviewed and
              approved before the next step can use it.
            </p>
            <ol className="steps-list">
              <li>Upload a photo and pick the trade</li>
              <li>Approve scene constraints and the work-area mask</li>
              <li>Approve the stage plan</li>
              <li>For each stage: approve the prompt, then one generated image</li>
              <li>Animate between approved images and approve each clip</li>
              <li>Render with Alto branding and export</li>
            </ol>
            <button className="btn primary" onClick={() => go('new')}>
              Start a project
            </button>
          </div>
        )}
      </main>
    </div>
  )
}
