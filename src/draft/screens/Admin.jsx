// Office dashboard: every connected piece, its health, the queue, and the jobs.
import { useEffect, useState } from 'react'
import { api, API } from '../lib/api.js'
import { Button } from '../ui.jsx'

const fmtAgo = (iso) => {
  if (!iso) return 'never'
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000)
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`
}
const STATUS = { queued: ['wait', 'Queued'], running: ['wait', 'Building'], done: ['good', 'Built'], failed: ['bad', 'Failed'] }

function Pill({ ok, children }) {
  return <span className={'pill ' + (ok === true ? 'good' : ok === false ? 'bad' : 'wait')}>{children}</span>
}

/** The manifold: every piece between the client and the drafter, in the order data flows. */
function Manifold({ h, offline }) {
  const worker = h?.workers?.[0]
  const find = (id) => h?.checks?.find((c) => c.id === id || c.id.endsWith(':' + id))
  const nodes = [
    { name: 'Client app', ok: true, detail: 'this build', sub: window.location.host },
    { name: 'Office API', ok: offline ? false : true, detail: offline ? 'unreachable' : find('api')?.detail, sub: API },
    { name: 'File store', ok: offline ? null : find('store')?.ok, detail: find('store')?.detail, sub: 'designs, IFC, Revit files, PDFs' },
    { name: 'Job queue', ok: offline ? null : find('queue')?.ok, detail: find('queue')?.detail, sub: 'one job per approved design' },
    { name: 'Office computer', ok: offline ? null : worker ? worker.online : false, detail: worker ? (worker.online ? `online, seen ${fmtAgo(worker.lastSeen)}` : `offline, last seen ${fmtAgo(worker.lastSeen)}`) : 'not connected yet', sub: worker ? `${worker.name} · ${worker.host || ''}` : 'install the worker' },
    { name: 'Revit', ok: offline ? null : find('revit-smoke')?.ok ?? (worker ? false : null), detail: find('revit-smoke')?.detail || (worker ? `Revit ${worker.revit}` : ''), sub: worker ? `pyRevit ${worker.pyrevit || '?'}` : '' },
    { name: 'Office template', ok: offline ? null : find('template')?.ok ?? null, detail: find('template')?.detail || '', sub: find('families')?.detail || '' },
    { name: 'Drafters', ok: true, detail: 'open the model from the shared folder', sub: 'finish, review, issue' },
  ]
  return (
    <div className="manifold">
      {nodes.map((n, i) => (
        <div key={n.name} className={'node' + (n.ok === false ? ' down' : '')}>
          <div className="node-head">
            <span className="node-name">{n.name}</span>
            <Pill ok={n.ok}>{n.ok === true ? 'ok' : n.ok === false ? 'down' : 'unknown'}</Pill>
          </div>
          <div className="node-detail">{n.detail || '—'}</div>
          <div className="node-sub">{n.sub}</div>
          {i < nodes.length - 1 && <i className="node-link" />}
        </div>
      ))}
    </div>
  )
}

export default function Admin() {
  const [ov, setOv] = useState(null)
  const [offline, setOffline] = useState(false)
  const [at, setAt] = useState(null)
  const [open, setOpen] = useState(null)
  const refresh = async () => {
    try {
      setOv(await api.overview())
      setOffline(false)
    } catch {
      setOffline(true)
    }
    setAt(new Date())
  }
  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 5000)
    return () => clearInterval(t)
  }, [])
  const h = ov?.health
  const c = ov?.counts
  const worker = h?.workers?.[0]
  const maxDur = Math.max(60, ...(ov?.recentDurations?.map((d) => d.s) || [0]))

  return (
    <div className="screen padded admin">
      <div className="admin-head">
        <div>
          <h2>Office dashboard</h2>
          <p className="muted">
            {offline ? 'Office API unreachable.' : h?.ok ? 'Everything connected and healthy.' : 'Something needs attention.'} Updated {at ? at.toLocaleTimeString() : '…'}, refreshes every 5 s.
          </p>
        </div>
        <Pill ok={offline ? false : h?.ok}>{offline ? 'offline' : h?.ok ? 'all systems go' : 'attention'}</Pill>
      </div>

      <h3>Manifold</h3>
      <Manifold h={h} offline={offline} />

      <div className="admin-grid">
        <div className="card">
          <h3>Queue</h3>
          <div className="tiles">
            {[
              ['Queued', c?.queued ?? '–'],
              ['Building', c?.running ?? '–'],
              ['Built', c?.done ?? '–'],
              ['Failed', c?.failed ?? '–'],
              ['Avg build', c?.avgDurationS != null ? `${Math.round(c.avgDurationS / 60)} min` : '–'],
              ['Designs', c?.designs ?? '–'],
            ].map(([k, v]) => (
              <div key={k} className="tile">
                <span className="tile-v">{v}</span>
                <span className="tile-k">{k}</span>
              </div>
            ))}
          </div>
          {ov?.recentDurations?.length > 0 && (
            <div className="bars" aria-label="Build time of recent jobs">
              <h3>Build time, last {ov.recentDurations.length} jobs</h3>
              {ov.recentDurations.map((d) => (
                <div key={d.id} className="bar-row" title={`${d.client}: ${d.s}s`}>
                  <span className="bar-k">{d.client}</span>
                  <span className="bar-track">
                    <span className="bar-fill" style={{ width: `${(d.s / maxDur) * 100}%` }} />
                  </span>
                  <span className="bar-v">{d.s < 90 ? `${d.s}s` : `${Math.round(d.s / 60)} min`}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-head">
            <h3>Health checks</h3>
            {worker && (
              <Button small ghost onClick={() => api.command(worker.id, 'smoke').then(refresh)}>
                Run Revit check
              </Button>
            )}
          </div>
          <table className="tbl">
            <tbody>
              {(h?.checks || []).map((ck) => (
                <tr key={ck.id}>
                  <td>
                    <Pill ok={ck.ok}>{ck.ok ? 'ok' : 'fail'}</Pill>
                  </td>
                  <td>
                    {ck.name}
                    {ck.worker ? <span className="cmp"> · {ck.worker}</span> : null}
                  </td>
                  <td className="cmp">{ck.detail}</td>
                  <td className="cmp">{fmtAgo(ck.at)}</td>
                </tr>
              ))}
              {offline && (
                <tr>
                  <td>
                    <Pill ok={false}>fail</Pill>
                  </td>
                  <td>Office API</td>
                  <td className="cmp">
                    No answer from {API}. Start it with <code>node server/index.mjs</code> or fix the address.
                  </td>
                  <td />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3>Jobs</h3>
        {!ov?.jobs?.length ? (
          <p className="muted">No jobs yet. Approve a design in the client flow and it shows up here.</p>
        ) : (
          <table className="tbl jobs">
            <thead>
              <tr>
                <th>Status</th>
                <th>Client</th>
                <th>Lot</th>
                <th>Worker</th>
                <th>When</th>
                <th>Time</th>
                <th>Outputs</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {ov.jobs.map((j) => (
                <tr key={j.id} className={open === j.id ? 'open' : ''}>
                  <td>
                    <span className={'pill ' + STATUS[j.status]?.[0]}>{STATUS[j.status]?.[1] || j.status}</span>
                  </td>
                  <td>{j.client}</td>
                  <td className="cmp">{j.address}</td>
                  <td className="cmp">{j.worker || '—'}</td>
                  <td className="cmp">{fmtAgo(j.createdAt)}</td>
                  <td className="cmp">{j.durationS != null ? `${j.durationS}s` : j.status === 'running' ? j.steps?.[j.steps.length - 1]?.message || 'starting' : '—'}</td>
                  <td>
                    {(j.outputs || []).map((o) => (
                      <a key={o.url} className="out" href={api.fileUrl(o.url)} target="_blank" rel="noreferrer">
                        {o.name}
                      </a>
                    ))}
                    {j.warnings?.length ? <span className="pill warn">{j.warnings.length} warnings</span> : null}
                  </td>
                  <td>
                    {j.status === 'failed' && (
                      <Button small ghost onClick={() => api.retry(j.id).then(refresh)}>
                        Retry
                      </Button>
                    )}
                    {(j.log || j.error || j.warnings?.length) && (
                      <button className="linkish" onClick={() => setOpen(open === j.id ? null : j.id)}>
                        {open === j.id ? 'hide' : 'details'}
                      </button>
                    )}
                    {open === j.id && (
                      <pre className="joblog">
                        {j.error ? `error: ${j.error}\n` : ''}
                        {(j.warnings || []).map((w) => `warning: ${w}`).join('\n')}
                        {j.log ? `\n${j.log}` : ''}
                      </pre>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3>Activity</h3>
        <ul className="events">
          {(ov?.events || []).map((e) => (
            <li key={e.id} className={e.kind}>
              <span className="cmp">{fmtAgo(e.at)}</span>
              <span>{e.message}</span>
            </li>
          ))}
          {!ov?.events?.length && <li className="muted">Nothing yet.</li>}
        </ul>
      </div>
    </div>
  )
}
