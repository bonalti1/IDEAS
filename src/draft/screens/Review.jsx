// Drafter review inbox: designs clients sent, the plan, their requests, approve or return with a note.
import { useEffect, useState } from 'react'
import HouseScene from '../HouseScene.jsx'
import PlanDrawing from '../PlanDrawing.jsx'
import { Button, Stat, sf } from '../ui.jsx'
import { api } from '../lib/api.js'
import { STYLES } from '../lib/styles.js'
import { floorArea, programOf, programLine } from '../lib/layout.js'
import { STATUS } from '../lib/status.js'

const ago = (iso) => {
  if (!iso) return ''
  const m = (Date.now() - Date.parse(iso)) / 60000
  return m < 1 ? 'just now' : m < 60 ? `${Math.round(m)} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`
}

function Row({ p, onOpen }) {
  const s = STATUS[p.status] || { label: p.status, tone: 'wait' }
  return (
    <button className="inbox-row" onClick={() => onOpen(p.id)}>
      <span className="inbox-main">
        <b>{p.client}</b>
        <span className="muted small">
          {p.address || 'no address'} · {p.style?.name} · {programLine(p.asBuilt || p.program || {}, ', ').replace(/, \d story$/, '')} · {p.version - 1} version{p.version - 1 === 1 ? '' : 's'}
        </span>
      </span>
      <span className="inbox-side">
        <span className={'pill ' + s.tone}>{s.label}</span>
        <span className="muted small">{ago(p.sentAt || p.updatedAt)}</span>
      </span>
    </button>
  )
}

export default function Review({ user }) {
  const [inbox, setInbox] = useState(null)
  const [open, setOpen] = useState(null) // project detail
  const [note, setNote] = useState('')
  const [override, setOverride] = useState('') // the office-only note that approves a plan over audit errors
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const refresh = async () => {
    try {
      setInbox(await api.inbox())
      setError('')
    } catch (e) {
      setError(e.message)
    }
  }
  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 10000)
    return () => clearInterval(t)
  }, [])

  const show = async (id) => {
    setOpen(await api.reviewProject(id))
    setNote('')
  }
  const [lotNote, setLotNote] = useState('')
  const [planView, setPlanView] = useState(true)
  const confirmLot = async (confirmed) => {
    if (!open || busy) return
    setBusy(true)
    try {
      const p = await api.confirmLot(open.id, { confirmed, note: lotNote })
      setOpen({ ...open, ...p })
      await refresh()
    } catch (e) {
      setError(e.message)
    }
    setBusy(false)
  }
  const decide = async (decision) => {
    if (!open || busy) return
    setBusy(true)
    try {
      const p = await api.review(open.id, decision, note, override)
      setOpen({ ...open, ...p })
      await refresh()
    } catch (e) {
      setError(e.message)
    }
    setBusy(false)
  }

  if (open) {
    const style = STYLES.find((s) => s.id === open.style?.id) || STYLES.find((s) => s.ready)
    const changes = (open.versions || []).filter((v) => v.kind === 'change')
    const s = STATUS[open.status] || { label: open.status, tone: 'wait' }
    return (
      <div className="screen split">
        <div className="viewport">
          {planView ? <PlanDrawing rooms={open.rooms || []} program={open.program || {}} style={style} lot={open.lot} client={open.client} /> : <HouseScene rooms={open.rooms || []} style={style} view="3d" lot={open.lot} />}
          <div className="viewport-views">
            <button className={planView ? 'on' : ''} onClick={() => setPlanView(true)}>
              Plan
            </button>
            <button className={!planView ? 'on' : ''} onClick={() => setPlanView(false)}>
              3D
            </button>
          </div>
          <div className="viewport-tag">
            {open.client} · {style.name} · {open.address}
          </div>
        </div>
        <aside className="side review">
          <button className="linkish back" onClick={() => setOpen(null)}>
            ← Inbox
          </button>
          <div className="side-head">
            <h2>{open.client}</h2>
            <span className={'pill ' + s.tone}>{s.label}</span>
          </div>
          <p className="muted small">
            {open.email} · sent {ago(open.sentAt)}
          </p>
          <div className="stats">
            <Stat k="Lot" v={open.address || '—'} />
            <Stat k="Style" v={style.name} />
            <Stat k="Rooms" v={programLine(programOf(open.rooms || [], open.program || {}))} />
            <Stat k="Living area" v={sf(floorArea(open.rooms || [], open.program?.stories || 1))} />
            {open.program?.asked && <Stat k="Asked for" v={`${programLine(open.program.asked)} · ${sf(open.program.asked.sqft)} → drafted ${sf(floorArea(open.rooms || [], open.program?.stories || 1))} to fit the lot`} />}
            <Stat k="Changes used" v={`${open.creditsUsed || 0} · ${open.credits ?? 0} left on the account`} />
          </div>
          {open.lot?.spec?.kind === 'plat' && (
            <div className={'card thin lotcard' + (open.lot.spec.confirmed ? '' : ' pending')}>
              <h3>Lot from the plat {open.lot.spec.confirmed ? `· confirmed by ${open.lot.spec.confirmedBy}` : '· needs your confirmation'}</h3>
              <p className="small">
                {open.lot.plat?.lotNumber ? `${open.lot.plat.lotNumber}${open.lot.plat.subdivision ? ', ' + open.lot.plat.subdivision : ''}. ` : ''}
                {open.lot.spec.calls?.length} calls, closes within {open.lot.closure} ft, {Math.round(open.lot.areaSf).toLocaleString()} sf, buildable {Math.round(open.lot.envelopeSf).toLocaleString()} sf. Read with {Math.round((open.lot.plat?.confidence || 0) * 100)}% confidence.
              </p>
              <ol className="list small">
                {open.lot.spec.calls?.map((c, i) => (
                  <li key={i}>
                    {c.curve ? `Curve R ${c.curve.radius}' ${c.curve.arcLength ? `L ${c.curve.arcLength}'` : c.curve.delta ? `Δ ${c.curve.delta}°` : ''} ${c.curve.direction}` : `${c.bearing} ${c.distance}'`}
                    {open.lot.edges?.[i] ? ` · ${open.lot.edges[i].label.toLowerCase()}` : ''}
                  </li>
                ))}
              </ol>
              {open.lot.plat?.notes && <p className="fine">Reader: {open.lot.plat.notes}</p>}
              {open.lot.spec.platId && (
                <p className="fine">
                  <a href={api.platUrl(open.lot.spec.platId)} target="_blank" rel="noreferrer">
                    Open the plat PDF
                  </a>
                </p>
              )}
              {!open.lot.spec.confirmed && (
                <>
                  <label className="field">
                    <span>Note (optional)</span>
                    <input id="lot-note" value={lotNote} onChange={(e) => setLotNote(e.target.value)} placeholder="What you checked, or what is off" />
                  </label>
                  <div className="row2">
                    <Button small ghost disabled={busy} onClick={() => confirmLot(false)}>
                      Not right
                    </Button>
                    <Button small primary disabled={busy} onClick={() => confirmLot(true)}>
                      Confirm lot
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
          {open.audit && (
            <div className={'card thin audit' + (open.audit.ok ? ' pass' : ' fail')}>
              <h3>
                Plan audit · {open.audit.ok ? 'passed' : `${open.audit.errors} error${open.audit.errors === 1 ? '' : 's'}`}
                {open.audit.warnings ? ` · ${open.audit.warnings} warning${open.audit.warnings === 1 ? '' : 's'}` : ''}
              </h3>
              {open.audit.measures?.requestedSf && (
                <p className="small">
                  {Math.round(open.audit.measures.livingSf).toLocaleString()} sf delivered for {open.audit.measures.requestedSf.toLocaleString()} sf asked (
                  {((open.audit.measures.livingSf / open.audit.measures.requestedSf - 1) * 100).toFixed(1)}%)
                  {open.audit.measures.triangle ? ` · work triangle ${open.audit.measures.triangle.total} ft` : ''}
                </p>
              )}
              <ul className="list small checks">
                {open.audit.groups.map((g) => (
                  <li key={g.id} className={g.state === 'fail' ? 'bad' : g.state === 'warn' ? 'warn' : 'ok'}>
                    <span className="mark">{g.state === 'fail' ? '✗' : g.state === 'warn' ? '⚠' : '✓'}</span> {g.name}
                    {g.errors.map((m, i) => (
                      <span key={i} className="fine bad block">
                        {m}
                      </span>
                    ))}
                    {g.warnings.map((m, i) => (
                      <span key={'w' + i} className="fine block">
                        {m}
                      </span>
                    ))}
                  </li>
                ))}
              </ul>
              {open.audit.questions?.length > 0 && (
                <>
                  <h4>Open questions</h4>
                  <ul className="list small">
                    {open.audit.questions.map((q, i) => (
                      <li key={i}>{q}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
          <div className="card thin">
            <h3>What the client asked for</h3>
            {changes.length === 0 ? (
              <p className="muted small">Nothing. They kept the first draft.</p>
            ) : (
              <ol className="list">
                {changes.map((v) => (
                  <li key={v.n} className={v.refunded ? 'muted' : ''}>
                    {v.text}
                    {v.refunded && <span className="small"> (undone)</span>}
                  </li>
                ))}
              </ol>
            )}
            {open.designId && (
              <p className="fine">
                <a href={api.fileUrl(`/api/designs/${open.designId}/design.json`)} target="_blank" rel="noreferrer">
                  design.json
                </a>{' '}
                · <a href={api.fileUrl(`/files/${open.designId}/draft.ifc`)}>draft.ifc</a>
              </p>
            )}
          </div>
          {(open.reviews || []).length > 0 && (
            <div className="card thin">
              <h3>Earlier reviews</h3>
              <ul className="list">
                {open.reviews.map((r) => (
                  <li key={r.id}>
                    <b>{r.decision}</b> {ago(r.at)}
                    {r.note ? `: ${r.note}` : ''}
                    {r.override && (
                      <span className="fine"> · override by {r.override.by}: "{r.override.note}" ({r.override.errors?.length || 0} error{r.override.errors?.length === 1 ? '' : 's'})</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {open.status === 'in_review' ? (
            <>
              <label className="field">
                <span>Note to the client</span>
                <textarea id="review-note" rows={3} placeholder="What to fix, or a word of welcome. The client sees this." value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
              {open.audit && !open.audit.ok && (
                <label className="field">
                  <span>Override note · office only, at least 20 characters</span>
                  <textarea id="review-override" rows={3} placeholder="The plan has audit errors. Say why it can go to Revit anyway. The client never sees this; it is stored with your name, the time and the errors it covers." value={override} onChange={(e) => setOverride(e.target.value)} />
                  <small className={'fine' + (override.trim().length >= 20 ? '' : ' bad')}>{override.trim().length >= 20 ? 'Approve will log this override.' : `Approve is off while the audit has errors: ${20 - override.trim().length} more character${20 - override.trim().length === 1 ? '' : 's'} to override, or fix the plan.`}</small>
                </label>
              )}
              {error && <p className="fine bad">{error}</p>}
              <div className="actions">
                <Button ghost disabled={busy || !note.trim()} onClick={() => decide('returned')} title={note.trim() ? '' : 'A returned design needs a note'}>
                  Return with note
                </Button>
                <Button primary disabled={busy || (open.audit && !open.audit.ok && override.trim().length < 20)} onClick={() => decide('approved')} title={open.audit && !open.audit.ok ? 'An override note of 20 characters or more approves a plan with audit errors' : ''}>
                  {open.audit && !open.audit.ok && override.trim().length >= 20 ? 'Approve with override, build in Revit' : 'Approve, build in Revit'}
                </Button>
              </div>
            </>
          ) : (
            <div className="card thin">
              <h3>{s.label}</h3>
              {open.review && (
                <p className="muted small">
                  {open.review.decision} by {open.review.drafter} {ago(open.review.at)}
                  {open.review.note ? `: "${open.review.note}"` : ''}
                </p>
              )}
              {open.job && (
                <p className="muted small">
                  Revit job: {open.job.status}
                  {open.job.outputs?.length ? ` · ${open.job.outputs.map((o) => o.name).join(', ')}` : ''}
                </p>
              )}
            </div>
          )}
        </aside>
      </div>
    )
  }

  return (
    <div className="screen padded narrow inbox">
      <div className="screen-head">
        <h2>Review inbox</h2>
        <p className="muted">Designs clients sent. Open one, check the plan, approve it for the Revit build or send it back with a note.</p>
      </div>
      {error && <p className="fine bad">{error}</p>}
      <div className="card">
        <h3>Waiting for you {inbox ? `(${inbox.waiting.length})` : ''}</h3>
        {!inbox ? (
          <p className="muted small">Loading…</p>
        ) : inbox.waiting.length === 0 ? (
          <p className="muted small">Nothing waiting. New designs appear here within ten seconds of being sent.</p>
        ) : (
          <div className="inbox-list">
            {inbox.waiting.map((p) => (
              <Row key={p.id} p={p} onOpen={show} />
            ))}
          </div>
        )}
      </div>
      {inbox?.lots?.length > 0 && (
        <div className="card">
          <h3>Lots to confirm ({inbox.lots.length})</h3>
          <p className="muted small">Read from a plat by the office. Open one, compare the calls with the PDF, confirm or send it back.</p>
          <div className="inbox-list">
            {inbox.lots.map((p) => (
              <Row key={p.id} p={p} onOpen={show} />
            ))}
          </div>
        </div>
      )}
      {inbox?.recent?.length > 0 && (
        <div className="card">
          <h3>Recent decisions</h3>
          <div className="inbox-list">
            {inbox.recent.map((p) => (
              <Row key={p.id} p={p} onOpen={show} />
            ))}
          </div>
        </div>
      )}
      <p className="fine">Signed in as {user?.email}.</p>
    </div>
  )
}
