// Office dashboard: every connected piece, its health, the queue, and the jobs.
import { useEffect, useState } from 'react'
import { api, API } from '../lib/api.js'
import { Button } from '../ui.jsx'
import { RULE_FIELDS } from '../lib/cities.js'
import { ALL_FIELDS, FIELD_LABELS, statusWords, formatValue } from '../lib/jurisdictions.js'

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

const RULE_LABELS = { front: 'Front', side: 'Side', rear: 'Rear', streetSide: 'Street side', maxCoverage: 'Max coverage', maxHeightFt: 'Max height ft', minLotSf: 'Min lot sf' }

/** The sourced rules table (round 7): every jurisdiction, every field with its value, source, status and date; editable. */
function CityRules() {
  const [table, setTable] = useState(null) // flat rows (cities.js) for the grid
  const [full, setFull] = useState(null) // sourced rows (jurisdictions.js) for the details
  const [edit, setEdit] = useState({}) // id → patch { field: value | { value, source, status }, source, verified }
  const [saved, setSaved] = useState('')
  const [openRow, setOpenRow] = useState(null)
  const load = () => Promise.all([api.cities(), api.jurisdictions()]).then(([t, j]) => { setTable(t); setFull(j) }).catch(() => { setTable({}); setFull({}) })
  useEffect(() => {
    load()
  }, [])
  const save = async (id) => {
    await api.setJurisdiction(id, edit[id] || {})
    await load()
    setEdit((e) => ({ ...e, [id]: undefined }))
    setSaved(id)
    setTimeout(() => setSaved(''), 1500)
  }
  if (!table || !full) return null
  const rows = Object.values(table)
  const chip = (u) => (u?.status === 'verified' ? 'good' : u?.status === 'summary' ? 'warn' : 'bad')
  return (
    <div className="card rules-edit" data-testid="rules-table">
      <h3>Rules table: cities and counties</h3>
      <p className="muted small">
        Setbacks and the garage door distance in feet, coverage as a fraction. Every number carries where it came from and when it was checked; a number not read from the ordinance is a summary the office confirms, an unknown one falls back to the county default and is flagged on the client's lot. Edit a cell and name the source; tick Verified when you read it in the code. Re-check is due 180 days after the date.
      </p>
      <div className="tblwrap">
        <table className="tbl rules">
          <thead>
            <tr>
              <th>Jurisdiction</th>
              {RULE_FIELDS.map((f) => (
                <th key={f}>{RULE_LABELS[f] || FIELD_LABELS[f] || f}</th>
              ))}
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const row = full[c.id] || {}
              const unknown = RULE_FIELDS.filter((f) => !row[f] || row[f].status === 'unknown').length
              const verified = RULE_FIELDS.filter((f) => row[f]?.status === 'verified').length
              return (
                <tr key={c.id} data-testid={`rules-row-${c.id}`}>
                  <td>
                    <b>{c.name}</b>
                    <div className="muted small">{c.zoning}{row.flags?.length ? ` · ${row.flags.join('; ')}` : ''}</div>
                    <button className="linkish small" onClick={() => setOpenRow(openRow === c.id ? null : c.id)}>
                      {openRow === c.id ? 'Hide sources' : 'Sources and every field'}
                    </button>
                  </td>
                  {RULE_FIELDS.map((f) => (
                    <td key={f} title={row[f] ? `${row[f].source || 'no source'}${row[f].checkedAt ? ` · ${row[f].checkedAt}` : ''} · ${statusWords({ status: row[f].status, stale: false })}` : 'unknown'}>
                      <input className={'cell ' + chip(row[f])} type="number" step={f === 'maxCoverage' ? 0.05 : 1} value={edit[c.id]?.[f] ?? (typeof c[f] === 'number' ? c[f] : '')} placeholder={typeof row[f]?.value === 'object' ? 'rule' : 'unknown'} onChange={(e) => setEdit((x) => ({ ...x, [c.id]: { ...(x[c.id] || {}), [f]: e.target.value } }))} />
                    </td>
                  ))}
                  <td>
                    <span className={'pill ' + (unknown ? 'bad' : verified === RULE_FIELDS.length ? 'good' : 'warn')}>{unknown ? `${unknown} unknown` : verified === RULE_FIELDS.length ? 'all from the code' : `${RULE_FIELDS.length - verified} summaries`}</span>
                  </td>
                  <td>
                    <Button small ghost disabled={!edit[c.id]} onClick={() => save(c.id)}>
                      {saved === c.id ? 'Saved' : 'Save'}
                    </Button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {openRow && full[openRow] && (
        <details open className="sources-detail">
          <summary>{full[openRow].name}: every field, its source and status</summary>
          <div className="field-row muted small">
            <span>Field</span>
            <span>Value</span>
            <span>Source · checked</span>
            <span>Status</span>
          </div>
          {ALL_FIELDS.map((k) => {
            const u = full[openRow][k]
            return (
              <div className="field-row" key={k}>
                <span>{FIELD_LABELS[k] || k}</span>
                <span>{k === 'wind' ? (u?.value?.mph ? `${u.value.mph} mph` : 'set by the engineer of record') : k === 'permitChecklist' && Array.isArray(u?.value) ? u.value.join('; ') : formatValue(k, u?.value, u)}</span>
                <span className="muted">
                  {u?.source || 'no source'}
                  {u?.checkedAt ? ` · ${u.checkedAt}` : ''}
                  {u?.by ? ` · ${u.by}` : ''}
                </span>
                <span className={'pill ' + chip(u)}>{u ? statusWords({ status: u.status, stale: false }) : 'unknown'}</span>
              </div>
            )
          })}
          <div className="row2" style={{ marginTop: 8 }}>
            <label className="field" style={{ flex: 1 }}>
              <span>Source for the numbers you edited (the ordinance section, with the date)</span>
              <input className="cell src" placeholder="e.g. McAllen Code §138-xxx, read 2026-11-18" value={edit[openRow]?.source || ''} onChange={(e) => setEdit((x) => ({ ...x, [openRow]: { ...(x[openRow] || {}), source: e.target.value } }))} />
            </label>
            <label className="field">
              <span>Read in the code</span>
              <input type="checkbox" checked={!!edit[openRow]?.verified} onChange={(e) => setEdit((x) => ({ ...x, [openRow]: { ...(x[openRow] || {}), verified: e.target.checked } }))} /> Verified
            </label>
          </div>
        </details>
      )}
    </div>
  )
}

/** The parcel, flood and zoning sources (round 7, item 11): last check, latency, errors, the dormant paid fallbacks. */
function Sources() {
  const [h, setH] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const load = () => api.sources().then(setH).catch((e) => setErr(e.message))
  useEffect(() => {
    load()
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [])
  const check = async () => {
    setBusy(true)
    try {
      await api.sourcesCheck()
      await load()
    } catch (e) {
      setErr(e.message)
    }
    setBusy(false)
  }
  const checkFields = async () => {
    setBusy(true)
    try {
      await api.sourcesFields()
      await load()
    } catch (e) {
      setErr(e.message)
    }
    setBusy(false)
  }
  if (!h) return err ? <div className="card sources"><h3>Sources</h3><p className="fine bad">{err}</p></div> : null
  // round 10, item 5: the columns each source is mapped to, checked against the layer's own field list
  const fieldsOf = (s) => {
    const f = s.fields
    if (s.disabled || s.dormant) return ['dormant', '—']
    if (!f) return ['dormant', 'not checked yet']
    if (f.error) return ['bad', `could not read the layer (${f.error})`]
    if (f.missing?.length || f.wrongType?.length) return ['bad', [...f.missing.map((m) => `no column for ${m}`), ...f.wrongType].join('; ')]
    return ['ok', `all present${f.otherCase?.length ? ` (${f.otherCase.length} spelled in another case on a fallback layer)` : ''}`]
  }
  return (
    <div className="card sources" data-testid="sources">
      <h3>Sources: parcels, roads, flood, zoning</h3>
      <p className="muted small">
        {h.lookups} parcel lookup{h.lookups === 1 ? '' : 's'} since the server started{h.failures ? `, ${h.failures} failed (${h.failureRate}%)` : ''}. Regrid {h.regrid.enabled ? `on: ${h.regrid.used} of ${h.regrid.cap} this month` : 'dormant (no token; turns on if the free sources fail over 5% of lookups or the daily check fails 3 days running)'}. ASCE wind API {h.asce.enabled ? `on: ${h.asce.used} of ${h.asce.cap}` : 'dormant (drafter lookup per city)'}.{h.fixtures ? ' Answering from recorded fixtures.' : ''}
      </p>
      <div className="tblwrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Source</th>
              <th>County</th>
              <th>Last answer</th>
              <th>Mapped columns</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {h.sources.map((s) => (
              <tr key={s.id}>
                <td>
                  {s.name}
                  <div className="muted small">{s.url || s.kind} · checked {s.checkedAt}</div>
                </td>
                <td>{s.county}</td>
                <td className={s.last ? (s.last.ok ? 'ok' : 'bad') : 'dormant'}>{s.last ? `${s.last.ok ? 'ok' : s.last.error} · ${s.last.ms} ms · ${s.last.at.slice(11, 19)}Z` : 'not used yet'}</td>
                <td className={fieldsOf(s)[0]} data-testid={`fields-${s.id}`}>{fieldsOf(s)[1]}</td>
                <td className={s.disabled ? 'bad' : s.dormant ? 'dormant' : s.circuitOpen ? 'bad' : 'ok'}>{s.disabled ? `disabled: ${s.disabled}` : s.dormant ? `dormant: ${s.dormant}` : s.circuitOpen ? 'skipped 10 min after 3 failures' : 'live'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="fine">
        Daily check: {h.daily ? `${h.daily.ok ? 'passed' : 'FAILED'} at ${h.daily.at.slice(0, 16)}Z${h.daily.failedDays ? `, ${h.daily.failedDays} day(s) running` : ''}: ${h.daily.results.map((r) => `${r.address.split(',')[0]} ${r.ok ? 'ok' : `${(r.why || []).join(', ') || r.error || r.match || 'missing ' + (r.missing || []).join('/')}${r.failedDays > 1 ? ` (${r.failedDays} runs running)` : ''}`}`).join('; ')}` : 'not run yet'}.{' '}
        <Button small ghost disabled={busy} onClick={check} data-testid="sources-check">
          {busy ? 'Checking…' : 'Check now'}
        </Button>{' '}
        <Button small ghost disabled={busy} onClick={checkFields} data-testid="sources-fields">
          Check the columns
        </Button>
      </p>
      <p className="fine">
        Mapped columns: {h.fieldCheck ? `${h.fieldCheck.ok ? 'every mapped column is on its layer' : 'a mapped column is MISSING on a layer (the owner lookup or the parcel match fails for that county until it is fixed)'}, checked ${h.fieldCheck.at.slice(0, 16)}Z` : 'not checked yet'}. The street side of a lot is read from the Census TIGERweb roads; when that service is down it falls back to the county address point, then the Census point.
      </p>
      <p className="fine">Zoning layers: {h.zoning.map((z) => z.cityId).join(', ')}; Mission, San Benito and Rio Grande City publish none (the drafter reads the map). {err && <span className="bad">{err}</span>}</p>
    </div>
  )
}

/** The free changes a new plan starts with (office setting), and every open plan's count with a one-click grant. */
function Allowance() {
  const [def, setDef] = useState(null)
  const [draft, setDraft] = useState('')
  const [plans, setPlans] = useState([])
  const [msg, setMsg] = useState('')
  const load = () => {
    api.allowanceDefault().then((r) => { setDef(r.default); setDraft(String(r.default)) }).catch(() => {})
    api.inbox().then((i) => setPlans(i.plans || [])).catch(() => {})
  }
  useEffect(load, [])
  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(''), 3000) }
  const save = async () => {
    try {
      const r = await api.setAllowanceDefault(+draft)
      setDef(r.default)
      flash(`New plans start with ${r.default} free changes. Plans already open keep theirs.`)
    } catch (e) {
      flash(e.message)
    }
  }
  const grant = async (p, n) => {
    try {
      const r = await api.grantAllowance(p.id, n)
      flash(`${p.client}: ${r.changesUsed || 0} of ${r.changesAllowed} used`)
      load()
    } catch (e) {
      flash(e.message)
    }
  }
  if (def === null) return null
  return (
    <div className="card">
      <h3>Free changes</h3>
      <p className="muted small">Plan changes are free to the client. Each plan starts with this many; the office adds more from here or from the review inbox. The client app never shows a price.</p>
      <div className="row grant">
        <span>New plans start with</span>
        <input type="number" min={1} max={50} value={draft} onChange={(e) => setDraft(e.target.value)} style={{ width: 70 }} aria-label="Default free changes" />
        <Button small onClick={save} disabled={!(Number.isInteger(+draft) && +draft >= 1 && +draft <= 50) || +draft === def}>
          Save
        </Button>
        {msg && <span className="fine">{msg}</span>}
      </div>
      {plans.length > 0 && (
        <table className="jobs" style={{ marginTop: 10 }}>
          <thead>
            <tr>
              <th>Client</th>
              <th>Lot</th>
              <th>Status</th>
              <th>Changes</th>
              <th>Asked</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {plans.map((p) => (
              <tr key={p.id}>
                <td>{p.client}</td>
                <td className="muted small">{p.address || '—'}</td>
                <td>{p.status}</td>
                <td>Changes: {p.changesUsed || 0} of {p.changesAllowed} used</td>
                <td className={p.wantsMoreChanges ? 'bad' : ''}>{p.wantsMoreChanges ? 'Wants more changes' : p.meetingRequest?.kind === 'meeting' ? 'Meeting requested' : ''}</td>
                <td>
                  <Button small ghost onClick={() => grant(p, 5)}>
                    Grant 5 more
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export default function Admin() {
  const [ov, setOv] = useState(null)
  const [offline, setOffline] = useState(false)
  const [at, setAt] = useState(null)
  const [open, setOpen] = useState(null)
  const [ilog, setIlog] = useState(null)
  const refresh = async () => {
    try {
      setOv(await api.overview())
      setIlog(await api.interpretLog().catch(() => null))
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
            <span className="row">
              <Button small ghost onClick={() => api.backup().then(refresh)}>
                Back up now
              </Button>
              {worker && (
                <Button small ghost onClick={() => api.command(worker.id, 'smoke').then(refresh)}>
                  Run Revit check
                </Button>
              )}
            </span>
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

      <CityRules />
      <Allowance />
      <Sources />

      <div className="card">
        <h3>Client requests</h3>
        <p className="muted small">
          Every change request the assistant was asked for, with what it cost.{' '}
          {ilog?.calls ? `${ilog.calls} assistant call${ilog.calls === 1 ? '' : 's'} · $${ilog.cost.toFixed(4)} total · $${ilog.perCall.toFixed(4)} per request · ${ilog.avgMs} ms avg` : 'No assistant calls yet (fallback rules only).'}
        </p>
        {ilog?.recent?.length ? (
          <table className="jobs">
            <thead>
              <tr>
                <th>When</th>
                <th>Request</th>
                <th>Path</th>
                <th>Verdict</th>
                <th>Time</th>
                <th>Cost</th>
              </tr>
            </thead>
            <tbody>
              {ilog.recent.slice(0, 20).map((r, i) => (
                <tr key={i}>
                  <td className="cmp">{fmtAgo(r.at)}</td>
                  <td>“{r.request}”{r.reasons?.[0] ? <div className="muted small">{r.reasons[0]}</div> : null}</td>
                  <td>{r.source || (r.cost !== undefined ? 'assistant' : '')}</td>
                  <td className={r.verdict === 'rejected' || r.verdict === 'error' || r.verdict === 'timeout' ? 'bad' : r.verdict === 'unsure' ? 'warn' : ''}>{r.verdict}</td>
                  <td>{r.ms ? `${r.ms} ms` : ''}</td>
                  <td>{r.cost !== undefined ? `$${r.cost.toFixed(4)}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
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
