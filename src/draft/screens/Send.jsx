import { useEffect, useState } from 'react'
import { Button, Stat, Mark, money, sf } from '../ui.jsx'
import { kitFor, programOf, programLine } from '../lib/layout.js'
import { takeoff } from '../lib/takeoff.js'
import { estimate as priceOf, range, rateLine } from '../lib/pricing.js'
import { downloadIFC, toIFC } from '../lib/ifc.js'
import { buildDesign } from '../lib/contract.js'
import { planSheetHTML, summaryHTML } from '../lib/plan-svg.js'
import { planPDF, summaryPDF, pdfName } from '../lib/pdf.js'
import { auditSummary } from '../lib/audit.js'
import { TRUST } from '../lib/trust.js'
import TrustBlock from '../TrustBlock.jsx'
import { checkRules } from '../lib/rules.js'
import RulesPanel from '../RulesPanel.jsx'
import { api } from '../lib/api.js'
import { STATUS, STEPS, EDITABLE } from '../lib/status.js'

const n = (x) => Math.round(x).toLocaleString()
const pct = (a, b) => (b ? `${a - b >= 0 ? '+' : ''}${Math.round(((a - b) / b) * 100)}%` : '')

export default function Send({ lot, style, program, rooms, history, project, setProject, returnSeen, onBackToDraft, onRestart, onBack }) {
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [job, setJob] = useState(null) // { id, status, steps, outputs } or { offline: true }
  const [sending, setSending] = useState(false)
  const [tab, setTab] = useState('summary')
  const [callBusy, setCallBusy] = useState(false)
  const [called, setCalled] = useState(false)
  const callMe = async () => {
    setCallBusy(true)
    try {
      if (project?.id) await api.callMe(project.id, `zoning ${lot?.zoning?.district || ''}: ${lot?.zoning?.use || ''}`)
      setCalled(true)
    } catch (e) {
      setError(`Could not reach the office (${e.message}). Call us instead.`)
    }
    setCallBusy(false)
  }
  const kit = kitFor(style)
  const t = takeoff(rooms, program, kit, lot)
  // only changes that were applied and not undone: from the saved versions, or from the chat pairs
  const changes = project?.versions?.length
    ? project.versions.filter((v) => v.kind === 'change' && !v.refunded && v.n <= project.version).map((v) => ({ text: v.text }))
    : history.filter((m, i) => m.who === 'you' && history[i + 1]?.who === 'house' && history[i + 1].applied && !m.undone)
  const rules = checkRules(rooms, program, style, lot)
  const ref = kit.reference
  const isRef = ref && JSON.stringify(ref.program) === JSON.stringify(program) && changes.length === 0
  const price = priceOf({ rooms, program, style, lot })

  // a saved project: follow its status while the drafters and the office computer work on it
  const tracked = project && (['in_review', 'approved', 'built'].includes(project.status) || (project.status === 'returned' && !returnSeen))
  useEffect(() => {
    if (!project || !['in_review', 'approved'].includes(project.status)) return
    const tm = setInterval(async () => {
      try {
        setProject(await api.project(project.id))
      } catch {
        /* keep last state */
      }
    }, 5000)
    return () => clearInterval(tm)
  }, [project?.id, project?.status])

  useEffect(() => {
    if (!job?.id || ['done', 'failed'].includes(job.status)) return
    const tm = setInterval(async () => {
      try {
        setJob(await api.job(job.id))
      } catch {
        /* keep last state */
      }
    }, 3000)
    return () => clearInterval(tm)
  }, [job?.id, job?.status])

  const send = async () => {
    setSending(true)
    setError('')
    const design = buildDesign({ rooms, program, style, lot, history, client: lot?.client })
    const ifc = toIFC({ rooms, program, kit, style, lot })
    try {
      if (project) setProject(await api.sendProject(project.id, design, ifc))
      else setJob((await api.sendDesign(design, ifc)).job)
    } catch (e) {
      if (project) {
        setError(`Could not send: ${e.message}`)
        setSending(false)
        return
      }
      setJob({ offline: true, error: String(e.message || e) })
    }
    setSending(false)
    setSent(true)
  }

  // the print view, only when a PDF cannot be built in this browser
  const printFallback = (html) => {
    const w = window.open('', '_blank')
    if (!w) {
      setPdfNote('The PDF could not be built here and the print view was blocked as a pop-up. Allow pop-ups for this site, or try another browser.')
      return
    }
    w.document.open()
    w.document.write(html)
    w.document.close()
    setTimeout(() => w.print(), 400)
  }
  const [pdfNote, setPdfNote] = useState('')
  const [pdfBusy, setPdfBusy] = useState('')
  const openSummary = async () => {
    const design = buildDesign({ rooms, program, style, lot, history, client: project?.client || lot?.client })
    const audit = auditSummary(rooms, program, kit, lot)
    setPdfBusy('summary')
    setPdfNote('')
    try {
      const doc = await summaryPDF(design, price, audit, TRUST, kit.titleBlock)
      doc.save(pdfName(design, 'summary'))
    } catch (e) {
      printFallback(summaryHTML(design, price, audit, TRUST, kit.titleBlock))
    }
    setPdfBusy('')
  }
  const downloadPlan = async (sheet) => {
    const design = buildDesign({ rooms, program, style, lot, client: project?.client })
    setPdfBusy(sheet)
    setPdfNote('')
    try {
      const doc = await planPDF(design, kit.titleBlock, { sheet })
      doc.save(pdfName(design, sheet === 'tabloid' ? 'floor plan 11x17' : 'floor plan 24x36'))
    } catch (e) {
      printFallback(planSheetHTML(design, kit.titleBlock, { sheet }))
    }
    setPdfBusy('')
  }

  if (tracked) {
    const st = STATUS[project.status] || STATUS.in_review
    const pj = project.job
    return (
      <div className="screen padded narrow center">
        <Mark size={56} />
        <h2>{project.status === 'returned' ? 'Your drafter sent it back' : project.status === 'built' ? 'Your Revit model is ready' : project.status === 'approved' ? 'Approved, building the model' : 'With the drafting team'}</h2>
        <ol className="timeline">
          {STEPS.map((label, i) => (
            <li key={label} className={i < st.step ? 'done' : i === st.step ? 'now' : ''}>
              <i />
              <span>{label}</span>
            </li>
          ))}
        </ol>
        {project.status === 'in_review' && <p className="lede">A drafter checks the plan against the lot and the code, then approves it for the Revit build or sends it back with a note. Usually within a business day.</p>}
        <Button ghost onClick={openSummary}>
          Download your summary (PDF)
        </Button>
        <TrustBlock />
        {project.status === 'returned' && (
          <div className="card note">
            <h3>Note from {project.review?.drafter || 'your drafter'}</h3>
            <p>{project.review?.note}</p>
            <Button primary onClick={onBackToDraft || onBack}>
              Back to the draft
            </Button>
          </div>
        )}
        {(project.status === 'approved' || project.status === 'built') && (
          <div className="card job">
            <h3>Office</h3>
            <div className="stat">
              <span className="stat-k">Revit model</span>
              <span className={'pill ' + (pj?.status === 'done' ? 'good' : pj?.status === 'failed' ? 'bad' : 'wait')}>{!pj || pj.status === 'queued' ? 'waiting for the office computer' : pj.status === 'running' ? 'building in Revit' : pj.status === 'done' ? 'built' : 'needs a drafter'}</span>
            </div>
            {pj?.status === 'running' && pj.steps?.length > 0 && <p className="fine">{pj.steps[pj.steps.length - 1].message}</p>}
            {pj?.status === 'done' && pj.outputs?.length > 0 && (
              <ul className="list">
                {pj.outputs.map((o) => (
                  <li key={o.url}>
                    <a href={api.fileUrl(o.url)} target="_blank" rel="noreferrer">
                      {o.name}
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {project.review?.note && <p className="fine">Drafter: "{project.review.note}"</p>}
          </div>
        )}
        <div className="card stats">
          <Stat k="What happens next" v={project.status === 'built' ? 'Your drafter finishes the sheets' : 'Structure, roof, details, and code check'} />
          <Stat k="You will get" v={`${kit.sheets.length} sheets: ${kit.sheets.map((s) => s.title).filter((v, i, a) => a.indexOf(v) === i).join(', ').toLowerCase()}`} />
          <Stat k="Changes after this" v="Through your drafter, at drafting rates" />
        </div>
        <Button ghost onClick={onRestart}>
          Start another house
        </Button>
      </div>
    )
  }

  if (sent && !project)
    return (
      <div className="screen padded narrow center">
        <Mark size={56} />
        <h2>Sent to the drafting team</h2>
        <p className="lede">We have your lot, your layout, and every change you made. A drafter will have the first set to you within 5 business days.</p>
        <Button ghost onClick={openSummary}>
          Download your summary (PDF)
        </Button>
        <TrustBlock />
        {job && (
          <div className="card job">
            <h3>Office</h3>
            {job.offline ? (
              <p className="muted">The office server is not reachable right now, so your design is saved on this device. It will be sent when the office is back.</p>
            ) : (
              <>
                <div className="stat">
                  <span className="stat-k">Revit model</span>
                  <span className={'pill ' + (job.status === 'done' ? 'good' : job.status === 'failed' ? 'bad' : 'wait')}>{job.status === 'queued' ? 'waiting for the office computer' : job.status === 'running' ? 'building in Revit' : job.status === 'done' ? 'built' : 'needs a drafter'}</span>
                </div>
                {job.status === 'running' && job.steps?.length > 0 && <p className="fine">{job.steps[job.steps.length - 1].message}</p>}
                {job.status === 'done' && job.outputs?.length > 0 && (
                  <ul className="list">
                    {job.outputs.map((o) => (
                      <li key={o.url}>
                        <a href={api.fileUrl(o.url)} target="_blank" rel="noreferrer">
                          {o.name}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        )}
        <div className="card stats">
          <Stat k="What happens next" v="Structure, roof, details, and code check" />
          <Stat k="You will get" v={`${kit.sheets.length} sheets: ${kit.sheets.map((s) => s.title).filter((v, i, a) => a.indexOf(v) === i).join(', ').toLowerCase()}`} />
          <Stat k="Changes after this" v="Through your drafter, at drafting rates" />
        </div>
        <Button ghost onClick={onRestart}>
          Start another house
        </Button>
      </div>
    )

  return (
    <div className="screen padded narrow">
      <div className="screen-head">
        <h2>Ready to hand off?</h2>
        <p className="muted">Your design locks when you send it. Our drafters take it from here.</p>
      </div>
      <div className="tabs">
        {[
          ['summary', 'Summary'],
          ['package', 'Drafter package'],
        ].map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>

      {tab === 'summary' && (
        <>
          {project?.status === 'returned' && project.review?.note && (
            <div className="card note">
              <h3>Your drafter asked for</h3>
              <p>{project.review.note}</p>
            </div>
          )}
          <div className="card stats">
            <Stat k="Lot" v={lot?.address} />
            <Stat k="Style" v={style.name} />
            <Stat k="Program" v={programLine(programOf(rooms, program))} />
            <Stat k="Living area" v={sf(t.areas.living)} />
            {program.asked && <Stat k="Asked for" v={`${programLine(program.asked)} · ${sf(program.asked.sqft)} → drafted ${sf(t.areas.living)} to fit the lot`} />}
            <Stat k="Porches" v={sf(t.areas.frontPorch + t.areas.rearPorch)} />
            {t.areas.flatwork > 0 && <Stat k="Driveway and walk" v={sf(t.areas.flatwork)} />}
            <Stat k={price.confirmed ? 'Price range' : 'Estimate'} v={range(price)} />
            <p className="fine">
              {rateLine(price)} · {price.county}. Living {money(price.parts.living[0])}–{money(price.parts.living[1])}
              {price.areas.garage ? `, garage ${money(price.parts.garage[0])}–${money(price.parts.garage[1])}` : ''}
              {price.areas.porches ? `, porches ${money(price.parts.porches[0])}–${money(price.parts.porches[1])}` : ''}
              {price.areas.flatwork ? `, driveway and walk ${money(price.parts.flatwork[0])}–${money(price.parts.flatwork[1])}` : ''}. {price.note}
            </p>
          </div>
          <div className="card">
            <h3>Your changes</h3>
            {changes.length === 0 ? (
              <p className="muted">None. You kept the first draft.</p>
            ) : (
              <ol className="list">
                {changes.map((c, i) => (
                  <li key={i}>{c.text}</li>
                ))}
              </ol>
            )}
            <p className="fine">Only changes that went through are listed; drafters see it with the model, so nothing you asked for gets lost.</p>
          </div>
          {!rules.ok && (
            <div className="card note bad">
              <h3>This plan cannot be sent yet</h3>
              <ul className="list">
                {rules.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              {lot?.zoning?.residential === false ? (
                <>
                  <p className="fine">The lot's zoning, not the plan, is the problem: a house may need a rezoning or a special permit. The office knows the process and will call you.</p>
                  <Button small primary disabled={callBusy || called} onClick={callMe} data-testid="call-me">
                    {called ? 'The office will call you' : callBusy ? 'Sending…' : 'Ask the office to call me'}
                  </Button>
                </>
              ) : (
                <p className="fine">Go back to the draft and fix these first. The drafters only take plans that pass the rules.</p>
              )}
            </div>
          )}
          {lot?.rules && <RulesPanel lot={lot} mode="homeowner" />}
        </>
      )}

      {tab === 'package' && (
        <>
          <div className="card">
            <h3>Building area</h3>
            <table className="tbl">
              <tbody>
                <tr><td>Living area</td><td>{n(t.areas.living)} sf</td>{isRef && <td className="cmp">set: {n(ref.livingSf)} · {pct(t.areas.living, ref.livingSf)}</td>}</tr>
                <tr><td>Front porch</td><td>{n(t.areas.frontPorch)} sf</td>{isRef && <td className="cmp">set: {ref.frontPorchSf}</td>}</tr>
                <tr><td>Rear porch</td><td>{n(t.areas.rearPorch)} sf</td>{isRef && <td className="cmp">set: {ref.rearPorchSf}</td>}</tr>
                {t.areas.garage > 0 && <tr><td>Garage</td><td>{n(t.areas.garage)} sf</td></tr>}
                <tr className="total"><td>Total</td><td>{n(t.areas.total)} sf</td>{isRef && <td className="cmp">set: {n(ref.totalSf)} · {pct(t.areas.total, ref.totalSf)}</td>}</tr>
              </tbody>
            </table>
          </div>
          <div className="card">
            <h3>Material takeoff</h3>
            <table className="tbl">
              <tbody>
                <tr><td>{kit.exterior.siding}</td><td>{n(t.sidingSf)} sf</td>{isRef && <td className="cmp">set: {n(ref.takeoff.boardBattenSf)} · {pct(t.sidingSf, ref.takeoff.boardBattenSf)}</td>}</tr>
                <tr><td>Stone veneer</td><td>{n(t.stoneSf)} sf</td>{isRef && <td className="cmp">set: {n(ref.takeoff.stoneSf)} · {pct(t.stoneSf, ref.takeoff.stoneSf)}</td>}</tr>
                <tr><td>Shower tile</td><td>{n(t.showerTileSf)} sf</td>{isRef && <td className="cmp">set: {n(ref.takeoff.showerTileSf)} · {pct(t.showerTileSf, ref.takeoff.showerTileSf)}</td>}</tr>
                <tr><td>Exterior wall perimeter</td><td>{n(t.envelope.perimeter)} ft</td></tr>
                <tr><td>Average plate</td><td>{t.envelope.avgPlate.toFixed(1)} ft</td></tr>
              </tbody>
            </table>
          </div>
          <div className="card">
            <h3>Window schedule</h3>
            <table className="tbl">
              <thead><tr><th>Mark</th><th>Size</th><th>Type</th><th>Head</th><th>Qty</th></tr></thead>
              <tbody>
                {t.windows.map((w) => (
                  <tr key={w.mark}><td>{w.mark}</td><td>{w.w}" × {w.h}"</td><td>{w.type}</td><td>{w.head}</td><td>{w.count}</td></tr>
                ))}
                <tr className="total"><td colSpan={4}>Single hung / fixed</td><td>{t.counts.singleHung} / {t.counts.fixed}{isRef && <span className="cmp"> · set: {ref.takeoff.singleHung} / {ref.takeoff.fixed}</span>}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="card">
            <h3>Door schedule</h3>
            <table className="tbl">
              <thead><tr><th>Size</th><th>Material</th><th>Qty</th></tr></thead>
              <tbody>
                {t.doors.map((d) => (
                  <tr key={d.key}><td>{d.pair ? 'Pair ' : ''}{d.w}" × {d.h}"</td><td>{d.material}</td><td>{d.count}</td></tr>
                ))}
                <tr className="total"><td colSpan={2}>Interior / exterior</td><td>{t.counts.interiorDoors} / {t.counts.exteriorDoors}{isRef && <span className="cmp"> · set: {ref.takeoff.interiorDoors} / {ref.takeoff.exteriorDoors}</span>}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="card pdf">
            <h3>Floor plan and site plan PDF</h3>
            <p className="muted">Two sheets with the South Texas Builders title block: the floor plan at 1/4" = 1'-0" and the site plan (lot lines, setbacks, driveway, walk, coverage) at 1" = 20', on 24 × 36. The tabloid version prints at home at 1/8" = 1'-0".</p>
            <div className="row gap">
              <Button onClick={() => downloadPlan('archD')} disabled={!!pdfBusy}>
                {pdfBusy === 'archD' ? 'Building…' : 'Download PDF · 24 × 36'}
              </Button>
              <Button ghost onClick={() => downloadPlan('tabloid')} disabled={!!pdfBusy}>
                {pdfBusy === 'tabloid' ? 'Building…' : '11 × 17'}
              </Button>
            </div>
            {pdfNote && <p className="muted small">{pdfNote}</p>}
          </div>
          <div className="card ifc">
            <h3>3D model for Revit</h3>
            <p className="muted">
              Walls, floor slabs, and rooms as an IFC file, placed on the lot. Opens in Revit, Archicad, or any free IFC viewer.
            </p>
            <Button onClick={() => downloadIFC({ rooms, program, kit, style, lot })}>Download IFC</Button>
          </div>
          <div className="card">
            <h3>Sheet set the drafter receives</h3>
            <table className="tbl">
              <tbody>
                {kit.sheets.map((s) => (
                  <tr key={s.no}><td>{s.no}</td><td>{s.title}</td><td className="cmp">{s.contents}</td></tr>
                ))}
              </tbody>
            </table>
            <p className="fine">
              Plates {kit.plates.default}' and {kit.plates.public}' · roof {kit.roof.pitch} · {kit.roof.overhang} overhang · {kit.walls.exterior.studs} exterior, {kit.walls.plumbing.studs} plumbing walls.
            </p>
          </div>
          {isRef && <p className="fine">Columns marked "set" are the numbers on the Garza drawings. Differences are the gap between the packer and a drafter's plan.</p>}
        </>
      )}

      {error && <p className="fine bad">{error}</p>}
      <div className="actions">
        <Button ghost onClick={onBack}>
          Keep editing
        </Button>
        <Button primary disabled={sending || !rules.ok} onClick={send} title={rules.ok ? '' : 'Fix the problems listed above first'}>
          {sending ? 'Sending…' : 'Send to drafters'}
        </Button>
      </div>
    </div>
  )
}
