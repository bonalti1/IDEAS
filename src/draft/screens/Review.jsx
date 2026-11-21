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
import { pdfName } from '../lib/pdf.js'
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
import RulesPanel from '../RulesPanel.jsx'
import { lotMatchNotes, isUnchecked, UNCHECKED_LINE } from '../lib/parcel-spec.js'

// the flood zone in one line for the checklist (the rules panel below has the detail)
const floodLine = (flood) => {
  if (!flood) return 'No flood zone was read for this lot: check the FEMA map.'
  if (flood.status === 'no-digital-firm') return 'No digital FEMA map here: the county floodplain administrator decides.'
  if (flood.sfha) return `Zone ${flood.zone}: a special flood hazard area${flood.bfe != null ? `, base flood elevation ${flood.bfe} ft` : ''}${flood.firm ? ` (FIRM ${flood.firm})` : ''}. The slab height follows it.`
  if (flood.zone) return `Zone ${flood.zone}${flood.firm ? ` (FIRM ${flood.firm})` : ''}: outside the 1% flood area.`
  return flood.note || 'Not read: check the FEMA map.'
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
          {p.address || (p.lot?.plat?.address ? `${String(p.lot.plat.address).slice(0, 80)} (printed on the plat)` : p.lot?.plat ? `no address · ${p.lot.plat.ext === 'pdf' ? 'Plat (PDF)' : 'Plat (photo)'}${p.lot.plat.at ? `, ${String(p.lot.plat.at).slice(0, 10)}` : ''}` : 'no address')} ·{' '}
          {p.version ? `${p.style?.name || 'style to be chosen'} · ${programLine(p.asBuilt || p.program || {}, ', ').replace(/, \d story$/, '')} · ${p.version === 1 ? 'first draft' : `${p.version - 1} version${p.version - 1 === 1 ? '' : 's'} after the first draft`}` : 'lot saved, the homeowner has not chosen rooms yet'}
        </span>
      </span>
      <span className="inbox-side">
        <Asks p={p} />
        {p.needsCustom && <span className="pill ask">Needs a house designed</span>}
        {p.status === 'in_review' && (p.lot?.spec?.kind === 'plat' || p.lot?.spec?.kind === 'parcel') && !p.lot.spec.confirmed && (
          <span className="pill stop" data-testid="row-lot-and-plan">
            Lot to confirm + plan
          </span>
        )}
        {isUnchecked(p.lot?.spec) && !p.lot.spec.confirmed && (
          <span className="pill stop" data-testid="row-unchecked">
            Outline not checked
          </span>
        )}
        {p.lot?.spec?.confidence === 'near' && !p.lot.spec.confirmed && (
          <span className="pill ask" data-testid="row-near">
            Near match: check the address
          </span>
        )}
        {p.lot?.spec?.confidence === 'pick' && !p.lot.spec.confirmed && <span className="pill ask">Parcel picked by hand</span>}
        {(p.lot?.spec?.typedBy === 'homeowner' || p.lot?.plat?.unread) && !p.lot.spec.confirmed && (
          <span className="pill stop" data-testid="row-plat-unread">
            {p.lot?.plat?.unread || p.lot?.spec?.outlineGapFt === undefined ? `Plat not read${p.lot?.spec?.typed?.width ? `, homeowner typed ${p.lot.spec.typed.width} × ${p.lot.spec.typed.depth}` : ''}` : 'Outline differs from the plat'}
          </span>
        )}
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
    setCountyDown(false)
    setSelfChecked(false)
    setLotError('')
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
    // the office printables and the rates load on demand (their own chunk); the homeowner app never asks for them
    const { meetingPrepPDF, meetingPrepHTML } = await import('../lib/office.js')
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
  // round 13, M1: the county did not answer when Confirm asked it again; the drafter may confirm on their own check
  const [countyDown, setCountyDown] = useState(false)
  const [selfChecked, setSelfChecked] = useState(false)
  const [lotError, setLotError] = useState('') // why Confirm lot did not go through, said beside its button
  const [owner, setOwner] = useState(null) // the owner of record, drafter-only, fetched on demand
  const lookupOwner = async () => {
    try {
      const p = await api.parcelById(open.lot.spec.county, open.lot.spec.propId)
      setOwner({ owner: p.owner, mailing: p.mailing })
    } catch (e) {
      setOwner({ owner: `lookup failed: ${e.message}` })
    }
  }
  const [planView, setPlanView] = useState(true)
  // round 10, item 4: a typed lot carries no zoning of its own; the drafter reads the city map and says what it is
  const [zoneDistrict, setZoneDistrict] = useState('')
  const [zoneHouse, setZoneHouse] = useState(true)
  const [zoneEdit, setZoneEdit] = useState(false)
  const confirmZoning = async (clear = false) => {
    setBusy(true)
    setError('')
    try {
      // `as` confirms the district the server read, as it stands (round 12, item 3)
      const p = await api.confirmZoning(open.id, clear === true ? { clear: true } : clear && clear.district ? { district: clear.district, residential: clear.residential !== false, use: clear.use || undefined } : { district: zoneDistrict, residential: zoneHouse })
      setOpen(p)
      setZoneDistrict('')
      setZoneEdit(false)
    } catch (e) {
      setError(e.message)
    }
    setBusy(false)
  }
  const confirmLot = async (confirmed) => {
    if (!open || busy) return
    setBusy(true)
    try {
      const p = await api.confirmLot(open.id, { confirmed, note: lotNote, ...(confirmed && selfChecked ? { checked: true } : {}) })
      setOpen({ ...open, ...p })
      setCountyDown(false)
      setSelfChecked(false)
      setLotError('')
      await refresh()
    } catch (e) {
      // round 13, M1: the county still does not answer. The drafter may confirm on their own check of the outline,
      // and has to say so.
      if (e.body?.unchecked) setCountyDown(true)
      setLotError(e.message)
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
          {!(open.rooms || []).length ? <HouseScene view="top" showHouse={false} lot={open.lot || undefined} /> : planView ? <PlanDrawing rooms={open.rooms || []} program={open.program || {}} style={style} lot={open.lot} client={open.client} /> : <HouseScene rooms={open.rooms || []} style={style} view="3d" lot={open.lot} />}
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
            {open.email} · {open.sentAt ? `sent ${ago(open.sentAt)}` : open.version ? 'not sent yet' : 'lot saved, no rooms yet'}
          </p>
          {(() => {
            // round 12, item J: what to do on this plan, in order, each line with its button; the detail is below
            const spec = open.lot?.spec
            const own = spec && (spec.kind === 'plat' || spec.kind === 'parcel')
            const z = open.lot?.zoning
            const hasRooms = (open.rooms || []).length > 0
            return (
              <div className="card thin checklist" data-testid="review-checklist">
                <h3>Check this plan, in order</h3>
                {open.needsCustom && (
                  <p className="small warnline" data-testid="needs-custom">
                    The homeowner sent this lot for a house designed for it: none of the ready plans fits. They asked for {programLine(open.program || {})} at about {sf(open.program?.sqft || 0)}.{open.needsCustom.note ? ` Note: "${open.needsCustom.note}"` : ''}
                  </p>
                )}
                <ol className="checks">
                  <li className={!own || spec.confirmed ? 'done' : 'todo'}>
                    <div className="check-row">
                      <span>
                        <b>The lot matches the plat or deed.</b>{' '}
                        {!own ? 'Typed in by the homeowner: nothing to confirm.' : spec.confirmed ? `Confirmed by ${spec.confirmedBy}.` : spec.kind === 'parcel' ? 'From the county parcel map: compare the outline with the recorded plat or the deed.' : spec.typedBy === 'homeowner' && spec.outlineGapFt !== undefined && !open.lot?.plat?.unread ? 'The outline sent is not the one the office read from the plat. Open the plat and check the outline.' : spec.typedBy === 'homeowner' ? `Plat not read by the office: the homeowner typed ${spec.typed?.width} by ${spec.typed?.depth} ft from it. Open the plat and check the outline.` : 'Read from the plat: compare the calls with the plat.'}
                      </span>
                      {own && !spec.confirmed && (
                        <Button small primary disabled={busy} onClick={() => confirmLot(true)} data-testid="check-confirm-lot">
                          Confirm lot
                        </Button>
                      )}
                    </div>
                    {lotMatchNotes(open.lot.spec).map((line, i) =>
                      line === UNCHECKED_LINE ? null : (
                        <p key={i} className="small warnline" data-testid="lot-match-note">
                          {line}
                        </p>
                      ),
                    )}
                    {/* round 13, M1: an outline the county could not check is said in red, not as one more yellow note */}
                    {isUnchecked(open.lot.spec) && (
                      <p className="small warnline stopline" data-testid="lot-unchecked">
                        {UNCHECKED_LINE}
                      </p>
                    )}
                    {own && !spec.confirmed && lotError && (
                      <p className="small fine bad" data-testid="lot-confirm-error">
                        {lotError}
                      </p>
                    )}
                    {own && !spec.confirmed && countyDown && isUnchecked(spec) && (
                      <label className="check small" data-testid="self-checked">
                        <input type="checkbox" checked={selfChecked} onChange={(e) => setSelfChecked(e.target.checked)} /> The county still does not answer. I checked the outline myself against the plat or deed.
                      </label>
                    )}
                  </li>
                  <li className={z?.residential === false ? 'stop' : z?.confirmedBy ? 'done' : 'todo'}>
                    <div className="check-row">
                      <span>
                        <b>The zoning is a house district.</b>{' '}
                        {z?.district ? `${z.district}${z.use ? ` (${z.use})` : ''}${z.confirmedBy ? `, confirmed by ${z.confirmedBy}.` : ', read from the city map: confirm or change.'}` : own && spec.kind === 'plat' && !spec.confirmed ? 'Read when you confirm the lot.' : 'Not read: enter the district from the city map.'}
                      </span>
                      <span className="check-buttons">
                        {z?.district && !z.confirmedBy && (
                          <Button small primary disabled={busy} onClick={() => confirmZoning(z)} data-testid="check-confirm-zoning">
                            Confirm {z.district}
                          </Button>
                        )}
                        <Button
                          small
                          ghost
                          disabled={busy}
                          data-testid="check-change-zoning"
                          onClick={() => {
                            setZoneEdit(true)
                            setTimeout(() => document.getElementById('zoning-card')?.scrollIntoView({ block: 'center' }), 50)
                          }}
                        >
                          {z?.district ? 'Change' : 'Enter zoning'}
                        </Button>
                      </span>
                    </div>
                    {z?.residential === false && (
                      <p className="small warnline" data-testid="zoning-stop">
                        Confirming the lot does not unblock Send: this lot is zoned {z.district}. Call the homeowner about a rezoning, or change the zoning if the city map says otherwise.
                      </p>
                    )}
                  </li>
                  <li className="note">
                    <div className="check-row">
                      <span>
                        <b>Flood zone noted.</b> {floodLine(spec?.flood || open.lot?.flood)}
                      </span>
                    </div>
                  </li>
                  <li className={!hasRooms ? 'todo' : open.audit?.ok === false ? 'stop' : 'done'}>
                    <div className="check-row">
                      <span>
                        <b>The plan passes the audit.</b>{' '}
                        {!hasRooms
                          ? open.needsCustom
                            ? 'No plan yet: this lot needs one designed for it.'
                            : 'No rooms yet: the homeowner is still choosing. You can confirm the lot meanwhile.'
                          : !open.audit
                            ? 'Not run.'
                            : open.audit.ok
                              ? `Passed${open.audit.warnings ? `, ${open.audit.warnings} warning${open.audit.warnings === 1 ? '' : 's'}` : ''}.`
                              : `${open.audit.errors} error${open.audit.errors === 1 ? '' : 's'}: see the audit below.`}
                      </span>
                    </div>
                  </li>
                </ol>
              </div>
            )
          })()}
          <div className="stats">
            <Stat k="Lot" v={open.address || '—'} />
            <Stat k="Style" v={style.name} />
            {(open.rooms || []).length > 0 ? (
              <>
                <Stat k="Rooms" v={programLine(programOf(open.rooms || [], open.program || {}))} />
                <Stat k="Living area" v={sf(floorArea(open.rooms || [], open.program?.stories || 1))} />
              </>
            ) : (
              <Stat k="Rooms" v={open.program?.beds ? `asked: ${programLine(open.program)}, about ${sf(open.program.sqft || 0)} (no plan drawn yet)` : 'not chosen yet'} />
            )}
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
          {(open.lot?.spec?.kind === 'plat' || open.lot?.spec?.kind === 'parcel') && (
            <div className={'card thin lotcard' + (open.lot.spec.confirmed ? '' : ' pending')} data-testid="lot-card">
              <h3>
                {open.lot.spec.kind === 'parcel' ? 'Lot from the county parcel map' : 'Lot from the plat'} {open.lot.spec.confirmed ? `· confirmed by ${open.lot.spec.confirmedBy}` : '· needs your confirmation'}
              </h3>
              <p className="small">
                {open.lot.spec.kind === 'parcel' ? `${open.lot.spec.legal || `Parcel ${open.lot.spec.propId}`}${open.lot.spec.geoId ? ` (geo id ${open.lot.spec.geoId})` : ''}, ${open.lot.spec.source?.name || 'county appraisal district'}${open.lot.spec.parcelFetchedAt ? `, fetched ${String(open.lot.spec.parcelFetchedAt).slice(0, 10)}` : ''}, matched by ${open.lot.spec.matchedBy || 'address'}. ` : open.lot.plat?.lotNumber ? `${open.lot.plat.lotNumber}${open.lot.plat.subdivision ? ', ' + open.lot.plat.subdivision : ''}. ` : ''}
                {open.lot.spec.calls?.length} calls, closes within {open.lot.closure} ft, {Math.round(open.lot.areaSf).toLocaleString()} sf, buildable {Math.round(open.lot.envelopeSf).toLocaleString()} sf.{open.lot.spec.kind !== 'plat' ? ' The parcel map is advisory: check it against the recorded plat or the survey.' : open.lot.spec.typedBy === 'homeowner' ? '' : ` Read with ${Math.round((open.lot.plat?.confidence || 0) * 100)}% confidence.`}
              </p>
              {/* round 14: a plat the office could not read. The outline is only what the homeowner typed off it. */}
              {open.lot.spec.kind === 'plat' && open.lot.spec.typedBy === 'homeowner' && (open.lot.plat?.unread || open.lot.spec.outlineGapFt === undefined) && (
                <p className="warnline stopline" data-testid="plat-unread">
                  Plat not read by the office. The homeowner typed {open.lot.spec.typed?.width} by {open.lot.spec.typed?.depth} ft from it: open the plat and check the outline before confirming.
                </p>
              )}
              {open.lot.spec.kind === 'plat' && open.lot.spec.typedBy === 'homeowner' && !open.lot.plat?.unread && open.lot.spec.outlineGapFt !== undefined && (
                <p className="warnline stopline" data-testid="plat-outline-differs">
                  The outline sent is not the one the office read from the plat{open.lot.spec.outlineGapFt != null ? ` (corners up to ${open.lot.spec.outlineGapFt} ft apart)` : ' (a different number of sides)'}{open.lot.spec.platAreaSf ? `; the plat reads ${Math.round(open.lot.spec.platAreaSf).toLocaleString()} sf` : ''}. Open the plat and check the outline before confirming.
                </p>
              )}
              {open.lot.spec.kind === 'parcel' && open.lot.plat?.unread && (
                <p className="fine warn" data-testid="plat-unread">
                  The homeowner also sent a plat the office could not read: check the county outline against it.
                </p>
              )}
              <details className="more" data-testid="lot-calls">
                <summary>The {open.lot.spec.calls?.length || 0} calls of the outline</summary>
              <ol className="list small">
                {open.lot.spec.calls?.map((c, i) => (
                  <li key={i}>
                    {c.curve ? `Curve R ${c.curve.radius}' ${c.curve.arcLength ? `L ${c.curve.arcLength}'` : c.curve.delta ? `Δ ${c.curve.delta}°` : ''} ${c.curve.direction}` : `${c.bearing} ${c.distance}'`}
                    {open.lot.edges?.[i] ? ` · ${open.lot.edges[i].label.toLowerCase()}` : ''}
                  </li>
                ))}
              </ol>
              </details>
              {open.lot.plat?.notes && <p className="fine">Reader: {open.lot.plat.notes}</p>}
              {open.lot.spec.platId && (
                <p className="fine">
                  <button className="linkish" data-testid="open-plat" onClick={() => api.openPlat(open.lot.spec.platId).catch((e) => setLotError(e.message))}>
                    {open.lot.plat?.ext && open.lot.plat.ext !== 'pdf' ? 'Open the plat photo' : 'Open the plat PDF'}
                  </button>
                  {open.platFile?.name ? <span className="muted"> · uploaded as "{open.platFile.name}"</span> : null}
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
          {(open.lot?.spec?.kind === 'plat' || open.lot?.spec?.kind === 'parcel') && (
            <div id="zoning-card" className={'card thin' + (open.lot.zoning?.residential === false ? ' pending' : '')} data-testid="zoning-read">
              <h3>Zoning</h3>
              {open.lot.zoning?.district ? (
                <p className="small">
                  <b>{open.lot.zoning.district}</b>
                  {open.lot.zoning.use ? ` (${open.lot.zoning.use})` : ''},{' '}
                  {open.lot.zoning.confirmedBy
                    ? `confirmed by ${open.lot.zoning.confirmedBy}`
                    : open.lot.spec.kind === 'plat'
                      ? "read from the city map at the address's map point, which can sit on the street or on the lot next door: confirm or change"
                      : 'read from the city map at the parcel; it is confirmed with the lot'}
                  . {open.lot.zoning.residential === false ? 'Send is blocked for this plan until the office has called the client.' : 'A house district: nothing blocked.'}
                </p>
              ) : (
                <p className="fine">
                  {open.lot.spec.kind === 'plat' && !open.lot.spec.confirmed ? 'The zoning of a plat lot is read when you confirm the lot.' : `No zoning was read for this lot${open.lot.zoning?.reason ? ` (${open.lot.zoning.reason})` : ''}.`} You can read the city zoning map and enter the district here.
                </p>
              )}
              {zoneEdit || !open.lot.zoning?.district ? (
                <>
                  <div className="row2">
                    <label className="field">
                      <span>District</span>
                      <input id="zone-district" value={zoneDistrict} onChange={(e) => setZoneDistrict(e.target.value)} placeholder="R-1, C-3…" />
                    </label>
                    <label className="confirm">
                      <input id="zone-house" type="checkbox" checked={zoneHouse} onChange={(e) => setZoneHouse(e.target.checked)} />
                      <span>A house district</span>
                    </label>
                  </div>
                  <Button small primary disabled={busy || !zoneDistrict.trim()} onClick={() => confirmZoning(false)}>
                    Confirm zoning
                  </Button>
                </>
              ) : (
                <div className="row2">
                  {!open.lot.zoning.confirmedBy && (
                    <Button small primary disabled={busy} onClick={() => confirmZoning(open.lot.zoning)} data-testid="zoning-as-read">
                      Confirm {open.lot.zoning.district}
                    </Button>
                  )}
                  <Button small ghost disabled={busy} onClick={() => setZoneEdit(true)} data-testid="zoning-change">
                    Change
                  </Button>
                </div>
              )}
            </div>
          )}
          {open.lot?.spec?.kind === 'manual' && (
            <div id="zoning-card" className="card thin" data-testid="zoning-confirm">
              <h3>Zoning (typed lot)</h3>
              {open.lot.zoning?.confirmedBy ? (
                <p className="small">
                  <b>{open.lot.zoning.district}</b> ({open.lot.zoning.use}), confirmed by {open.lot.zoning.confirmedBy}. {open.lot.zoning.residential === false ? 'Send is blocked for this plan until the office has called the client.' : 'A house district: nothing blocked.'}{' '}
                  <button className="linkish" disabled={busy} onClick={() => confirmZoning(true)}>
                    Clear
                  </button>
                </p>
              ) : (
                <>
                  <p className="fine">The homeowner typed this lot in, so no zoning was read for it. Read the city zoning map and enter the district; only a district you confirm here can block Send.</p>
                  <div className="row2">
                    <label className="field">
                      <span>District</span>
                      <input id="zone-district" value={zoneDistrict} onChange={(e) => setZoneDistrict(e.target.value)} placeholder="R-1, C-3…" />
                    </label>
                    <label className="confirm">
                      <input id="zone-house" type="checkbox" checked={zoneHouse} onChange={(e) => setZoneHouse(e.target.checked)} />
                      <span>A house district</span>
                    </label>
                  </div>
                  <Button small primary disabled={busy || !zoneDistrict.trim()} onClick={() => confirmZoning(false)}>
                    Confirm zoning
                  </Button>
                </>
              )}
            </div>
          )}
          {open.lot?.rules && (
            <details className="more card thin" data-testid="rules-details">
              <summary>Rules and sources used for this lot</summary>
              <RulesPanel lot={open.lot} mode="drafter" open title="Rules used for this lot" onLookupOwner={open.lot.spec?.kind === 'parcel' && open.lot.spec.county && open.lot.spec.propId ? lookupOwner : null} owner={owner} />
            </details>
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
                {/* round 15, B4: a plan sent before its lot was checked is approved after the lot is confirmed */}
                {(open.lot?.spec?.kind === 'plat' || open.lot?.spec?.kind === 'parcel') && !open.lot.spec.confirmed && (
                  <small className="fine bad" data-testid="approve-needs-lot">Confirm the lot first (above): this plan was sent before its lot was checked.</small>
                )}
                <Button primary disabled={busy || ((open.lot?.spec?.kind === 'plat' || open.lot?.spec?.kind === 'parcel') && !open.lot.spec.confirmed) || (open.audit && !open.audit.ok && override.trim().length < 20)} onClick={() => decide('approved')} title={open.audit && !open.audit.ok ? 'An override note of 20 characters or more approves a plan with audit errors' : ''}>
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
      {inbox?.custom?.length > 0 && (
        <div className="card" data-testid="inbox-custom">
          <h3>Lots that need a house designed ({inbox.custom.length})</h3>
          <p className="muted small">None of the ready plans fits these lots (narrow, shallow or pie-shaped). The homeowner sent the lot with the rooms they want. Open one, confirm the lot, and design for it.</p>
          <div className="inbox-list">
            {inbox.custom.map((p) => (
              <Row key={p.id} p={p} onOpen={show} />
            ))}
          </div>
        </div>
      )}
      {inbox?.lots?.length > 0 && (
        <div className="card">
          <h3>Lots to confirm ({inbox.lots.length})</h3>
          <p className="muted small">Read from a plat by the office, or taken from the county parcel map. Open one, compare the calls with the plat or the survey, confirm or send it back.</p>
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
