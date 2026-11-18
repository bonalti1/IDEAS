// Drafter review inbox: designs clients sent, the plan, their requests, approve or return with a note.
import { useEffect, useState } from 'react'
import HouseScene from '../HouseScene.jsx'
import PlanDrawing from '../PlanDrawing.jsx'
import { Button, Stat, sf } from '../ui.jsx'
import { api } from '../lib/api.js'
import { STYLES } from '../lib/styles.js'
import { floorArea, programOf, programLine, kitFor } from '../lib/layout.js'
import { STATUS } from '../lib/status.js'
import { buildDesign } from '../lib/contract.js'
import { auditSummary } from '../lib/audit.js'
import { meetingPrepPDF, pdfName } from '../lib/pdf.js'
import { meetingPrepHTML } from '../lib/plan-svg.js'
import { TRUST } from '../lib/trust.js'

const money = (n) => '$' + Math.round(n).toLocaleString()
/** The flags the office reads at a glance: a meeting asked for, more changes wanted. */
function Asks({ p }) {
  return (
    <>
      {p.wantsMoreChanges && <span className="pill ask">Wants more changes</span>}
      {p.meetingRequest?.kind === 'meeting' && <span className="pill ask">Meeting requested</span>}
    </>
  )
}

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
        <Asks p={p} />
        <span className={'pill ' + s.tone}>{s.label}</span>
        <span className="muted small">
          {p.changesAllowed !== undefined ? `changes ${p.changesUsed || 0} of ${p.changesAllowed} · ` : ''}
          {ago(p.sentAt || p.updatedAt)}
        </span>
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
  const [estimate, setEstimate] = useState(null) // the office estimate of the open plan (never sent to the client)
  const [grant, setGrant] = useState({ add: 5, note: '' })
  const [msg, setMsg] = useState('')

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
    setEstimate(null)
    api.estimate(id).then(setEstimate).catch(() => setEstimate({ error: true }))
  }
  // the office switches an upgrade adder on or off (the style's own are on by default); the client never sees these
  const toggleUpgrade = async (id) => {
    if (!open || !estimate || estimate.error) return
    const on = (estimate.upgradeChoices || []).filter((u) => u.on).map((u) => u.id)
    const next = on.includes(id) ? on.filter((x) => x !== id) : [...on, id]
    try {
      setEstimate(await api.estimate(open.id, next))
    } catch {
      /* keep the last estimate */
    }
  }
  // the office adds changes to the plan: a one-click 5, or a custom 1–50 with a note; logged with who, before and after
  const addChanges = async (n, note = '') => {
    if (!open || busy) return
    setBusy(true)
    try {
      const p = await api.grantAllowance(open.id, n, note)
      setOpen(p)
      setMsg(`Added ${n}: ${p.changesUsed || 0} of ${p.changesAllowed} used`)
      setGrant({ add: 5, note: '' })
      refresh()
    } catch (e) {
      setMsg(e.message)
    }
    setBusy(false)
    setTimeout(() => setMsg(''), 3000)
  }
  // the "Meeting prep" sheet: the client summary layout with the estimate, marked internal
  const meetingPrep = async () => {
    if (!open || !estimate || estimate.error) return
    const style = STYLES.find((x) => x.id === open.style?.id) || STYLES.find((x) => x.ready)
    const kit = kitFor(style)
    const design = buildDesign({ rooms: open.rooms || [], program: open.program || {}, style, lot: open.lot, client: open.client })
    const audit = auditSummary(open.rooms || [], open.program || {}, kit, open.lot)
    try {
      const doc = await meetingPrepPDF(design, estimate, audit, TRUST, kit.titleBlock)
      doc.save(pdfName(design, 'meeting prep (internal)'))
    } catch {
      const w = window.open('', '_blank')
      if (w) {
        w.document.write(meetingPrepHTML(design, estimate, audit, TRUST, kit.titleBlock))
        w.document.close()
      }
    }
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
            <Stat k="Changes" v={`${open.changesUsed || 0} of ${open.changesAllowed ?? 10} used · ${open.changesLeft ?? Math.max(0, (open.changesAllowed ?? 10) - (open.changesUsed || 0))} left`} />
          </div>
          {(open.meetingRequest?.kind === 'meeting' || open.wantsMoreChanges) && (
            <div className="card thin">
              <h3>
                <Asks p={open} />
              </h3>
              <p className="small">
                {open.wantsMoreChanges ? 'The client ran out of changes and asked for more. Add some below; the flag clears when you do.' : `The client asked for a meeting ${ago(open.meetingRequest.at)}. Cost is covered there; the client app shows no numbers.`}
                {open.meetingRequest?.note ? ` Note: "${open.meetingRequest.note}"` : ''}
              </p>
            </div>
          )}
          <div className="card thin allowance">
            <h3>Free changes on this plan</h3>
            <div className="row">
              <Button small primary disabled={busy} onClick={() => addChanges(5)}>
                Grant 5 more
              </Button>
              <input id="allowance-add" type="number" min={1} max={50} value={grant.add} onChange={(e) => setGrant({ ...grant, add: e.target.value })} aria-label="How many changes to add" />
              <input className="note" placeholder="Note (optional)" value={grant.note} onChange={(e) => setGrant({ ...grant, note: e.target.value })} aria-label="Note" />
              <Button small ghost disabled={busy || !(Number.isInteger(+grant.add) && +grant.add >= 1 && +grant.add <= 50)} onClick={() => addChanges(+grant.add, grant.note)}>
                Add
              </Button>
            </div>
            {msg && <p className="fine">{msg}</p>}
            {(open.allowanceLog || []).length > 0 && (
              <ul className="list small">
                {open.allowanceLog.slice().reverse().map((g, i) => (
                  <li key={i}>
                    +{g.add} by {g.by} {ago(g.at)} ({g.before} → {g.after}){g.note ? `: ${g.note}` : ''}
                  </li>
                ))}
              </ul>
            )}
            <p className="fine">The client sees only how many are left. Never a price.</p>
          </div>
          <div className="card thin estimate">
            <h3>
              Office estimate <span className="internal">internal: not for the client</span>
            </h3>
            {!estimate ? (
              <p className="muted small">Loading…</p>
            ) : estimate.error ? (
              <p className="fine bad">The estimate could not be loaded.</p>
            ) : (
              <>
                <p className="big">{estimate.range}</p>
                <p className="small">
                  {estimate.rateLine} · {estimate.county || 'county not set'}.
                  {estimate.parts?.living ? ` Living ${money(estimate.parts.living[0])}–${money(estimate.parts.living[1])}` : ''}
                  {estimate.areas?.garage ? `, garage ${money(estimate.parts.garage[0])}–${money(estimate.parts.garage[1])}` : ''}
                  {estimate.areas?.porches ? `, porches ${money(estimate.parts.porches[0])}–${money(estimate.parts.porches[1])}` : ''}
                  {estimate.areas?.flatwork ? `, driveway and walk ${money(estimate.parts.flatwork[0])}–${money(estimate.parts.flatwork[1])}` : ''}.
                </p>
                {(estimate.lines || []).length > 0 && (
                  <ul className="list small">
                    {estimate.lines.map((l, i) => (
                      <li key={i}>
                        {l.label}: {l.text}
                      </li>
                    ))}
                  </ul>
                )}
                {(estimate.upgradeChoices || []).length > 0 && (
                  <p className="small upgrades">
                    Upgrade adders ($/sf of living, STB's What's Included):{' '}
                    {estimate.upgradeChoices.map((u) => (
                      <label key={u.id} className="check">
                        <input type="checkbox" checked={u.on} onChange={() => toggleUpgrade(u.id)} /> {u.label} ${u.perSf[0]}{u.perSf[1] !== u.perSf[0] ? `–${u.perSf[1]}` : ''}
                      </label>
                    ))}
                  </p>
                )}
                {!estimate.serviceArea && <p className="fine">{estimate.county}: outside our usual service area; the office confirms the rate.</p>}
                <p className="fine">{estimate.note}{estimate.confirmed ? '' : ' Rates to be confirmed by South Texas Builders.'}</p>
                <Button small ghost onClick={meetingPrep}>
                  Meeting prep (PDF, internal)
                </Button>
              </>
            )}
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
      {inbox?.requests?.length > 0 && (
        <div className="card">
          <h3>Clients asking for the office ({inbox.requests.length})</h3>
          <p className="muted small">A meeting (cost is covered there) or more changes on the plan. Open one to add changes; the office was emailed too.</p>
          <div className="inbox-list">
            {inbox.requests.map((p) => (
              <Row key={p.id} p={p} onOpen={show} />
            ))}
          </div>
        </div>
      )}
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
