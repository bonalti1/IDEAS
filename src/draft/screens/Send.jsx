import { useEffect, useState } from 'react'
import { zoningBlocksSend } from '../lib/lot.js'
import { plainReason } from '../lib/plain.js'
import { Button, Stat, Mark } from '../ui.jsx'
import { kitFor, programOf, programLine } from '../lib/layout.js'
import { takeoff } from '../lib/takeoff.js'
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
import { useLang, says, houseText, programLineEs } from '../lib/i18n.js'

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
  // `t` is the takeoff on this screen, so the words are `tr`
  const { lang, t: tr, say, sf } = useLang()
  const pline = (p, sep, opts) => (lang === 'es' ? programLineEs(p, sep, opts) : programLine(p, sep, opts))
  const callMe = async () => {
    setCallBusy(true)
    try {
      if (project?.id) await api.callMe(project.id, `zoning ${lot?.zoning?.district || ''}: ${lot?.zoning?.use || ''}`)
      setCalled(true)
    } catch (e) {
      setError(tr('Could not reach the office ({error}). Call us instead.', { error: say(e.message) }))
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
  // decision B6: a lot that is not a house district blocks Send (never the draft), and only when the zoning is this lot's
  const zoneBlock = zoningBlocksSend(lot)
  const zoneLine = zoneBlock ? tr('This lot is zoned {district} ({use}). A house may need a rezoning; ask the office to call you.', { district: lot.zoning.district, use: say(lot.zoning.use) }) : null
  // round 12, item C: a parcel or plat lot a drafter has not confirmed yet is the normal next step, not an error. The
  // plan is saved; the Send button comes when the lot is confirmed (the page looks every 20 seconds, and we email).
  const ownLot = lot?.spec?.kind === 'parcel' || lot?.spec?.kind === 'plat'
  const lotConfirmed = !!(project?.lot?.spec ? project.lot.spec.confirmed : lot?.spec?.confirmed)
  const lotWaiting = !!project && ownLot && !lotConfirmed && ['drafting', 'returned'].includes(project.status)
  useEffect(() => {
    if (!lotWaiting || !project?.id) return
    const tm = setInterval(async () => {
      try {
        setProject(await api.project(project.id))
      } catch {
        /* keep last state */
      }
    }, 20000)
    return () => clearInterval(tm)
  }, [lotWaiting, project?.id])
  const ref = kit.reference
  const isRef = ref && JSON.stringify(ref.program) === JSON.stringify(program) && changes.length === 0

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
        // a lot still waiting for its drafter is not a failure: the calm card says so (the project is read again)
        if (e.body?.lotPending) {
          api.project(project.id).then(setProject).catch(() => {})
          setSending(false)
          return
        }
        setError(tr('We could not send it yet: {reason}', { reason: say(plainReason(e.message)) }))
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
      setPdfNote(tr('The PDF could not be built here and the print view was blocked as a pop-up. Allow pop-ups for this site, or try another browser.'))
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
      const doc = await summaryPDF(design, audit, TRUST, kit.titleBlock)
      doc.save(pdfName(design, 'summary'))
    } catch (e) {
      printFallback(summaryHTML(design, audit, TRUST, kit.titleBlock))
    }
    setPdfBusy('')
  }
  // "Ask the office to set up my meeting": cost is covered there (round 8, M4); the office is emailed
  const [asked, setAsked] = useState(project?.meetingRequest ? says(['Meeting requested. The office will reach out within 1 business day. You can also call {phone}.', { phone: TRUST.phone }]) : null)
  const askMeeting = async () => {
    if (!project) return setAsked(says(['Sign in with your email and save your house first, then this button sends your request. You can also call {phone}.', { phone: TRUST.phone }]))
    try {
      const r = await api.meetingRequest(project.id, { kind: 'meeting' })
      // the office answers with the sentence the chat knows; anything else it says is shown as it came
      const thanks = says(['Thanks! The office will reach out within 1 business day. You can also call {phone}.', { phone: TRUST.phone }])
      setAsked(r?.message && r.message !== thanks.text ? { text: r.message } : thanks)
      setProject((p) => ({ ...p, meetingRequest: { at: r.at, kind: 'meeting' } }))
    } catch (e) {
      setAsked(says(['The office did not get that just now. Try again in a moment, or call {phone}.', { phone: TRUST.phone }]))
    }
  }
  const costCard = (
    <div className="card cost">
      <h3>{tr('What it costs')}</h3>
      <p>{tr(TRUST.costLine)}</p>
      {asked ? <p className="fine ok">{houseText(asked, lang)}</p> : (
        <Button small ghost onClick={askMeeting}>
          {tr('Ask the office to set up my meeting')}
        </Button>
      )}
    </div>
  )
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
        <h2>{project.status === 'returned' ? tr('Your drafter sent it back') : project.status === 'built' ? tr('Your Revit model is ready') : project.status === 'approved' ? tr('Approved, building the model') : tr('With the drafting team')}</h2>
        <ol className="timeline">
          {STEPS.map((label, i) => (
            <li key={label} className={i < st.step ? 'done' : i === st.step ? 'now' : ''}>
              <i />
              <span>{tr(label)}</span>
            </li>
          ))}
        </ol>
        {project.status === 'in_review' && <p className="lede">{tr('A drafter checks the plan against the lot and the code, then approves it for the Revit build or sends it back with a note. Usually within a business day.')}</p>}
        <Button ghost onClick={openSummary}>
          {tr('Download your summary (PDF)')}
        </Button>
        {costCard}
        <TrustBlock />
        {project.status === 'returned' && (
          <div className="card note">
            <h3>{project.review?.drafter ? tr('Note from {who}', { who: project.review.drafter }) : tr('Note from your drafter')}</h3>
            <p>{project.review?.note}</p>
            <Button primary onClick={onBackToDraft || onBack}>
              {tr('Back to the draft')}
            </Button>
          </div>
        )}
        {(project.status === 'approved' || project.status === 'built') && (
          <div className="card job">
            <h3>{tr('Office')}</h3>
            <div className="stat">
              <span className="stat-k">{tr('Revit model')}</span>
              <span className={'pill ' + (pj?.status === 'done' ? 'good' : pj?.status === 'failed' ? 'bad' : 'wait')}>{!pj || pj.status === 'queued' ? tr('waiting for the office computer') : pj.status === 'running' ? tr('building in Revit') : pj.status === 'done' ? tr('built') : tr('needs a drafter')}</span>
            </div>
            {pj?.status === 'running' && pj.steps?.length > 0 && <p className="fine">{say(pj.steps[pj.steps.length - 1].message)}</p>}
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
            {project.review?.note && <p className="fine">{tr('Drafter: "{note}"', { note: project.review.note })}</p>}
          </div>
        )}
        <div className="card stats">
          <Stat k={tr('What happens next')} v={project.status === 'built' ? tr('Your drafter finishes the sheets') : tr('Structure, roof, details, and code check')} />
          <Stat k={tr('You will get')} v={tr('{n} sheets: {list}', { n: kit.sheets.length, list: kit.sheets.map((s) => tr(s.title)).filter((v, i, a) => a.indexOf(v) === i).join(', ').toLowerCase() })} />
          <Stat k={tr('Changes after this')} v={tr('Through your drafter')} />
        </div>
        <Button ghost onClick={onRestart}>
          {tr('Start another house')}
        </Button>
      </div>
    )
  }

  if (sent && !project)
    return (
      <div className="screen padded narrow center">
        <Mark size={56} />
        <h2>{tr('Sent to the drafting team')}</h2>
        <p className="lede">{tr('We have your lot, your layout, and every change you made. A drafter will have the first set to you within 5 business days.')}</p>
        <Button ghost onClick={openSummary}>
          {tr('Download your summary (PDF)')}
        </Button>
        {costCard}
        <TrustBlock />
        {job && (
          <div className="card job">
            <h3>{tr('Office')}</h3>
            {job.offline ? (
              <p className="muted">{tr('The office server is not reachable right now, so your design is saved on this device. It will be sent when the office is back.')}</p>
            ) : (
              <>
                <div className="stat">
                  <span className="stat-k">{tr('Revit model')}</span>
                  <span className={'pill ' + (job.status === 'done' ? 'good' : job.status === 'failed' ? 'bad' : 'wait')}>{job.status === 'queued' ? tr('waiting for the office computer') : job.status === 'running' ? tr('building in Revit') : job.status === 'done' ? tr('built') : tr('needs a drafter')}</span>
                </div>
                {job.status === 'running' && job.steps?.length > 0 && <p className="fine">{say(job.steps[job.steps.length - 1].message)}</p>}
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
          <Stat k={tr('What happens next')} v={tr('Structure, roof, details, and code check')} />
          <Stat k={tr('You will get')} v={tr('{n} sheets: {list}', { n: kit.sheets.length, list: kit.sheets.map((s) => tr(s.title)).filter((v, i, a) => a.indexOf(v) === i).join(', ').toLowerCase() })} />
          <Stat k={tr('Changes after this')} v={tr('Through your drafter')} />
        </div>
        <Button ghost onClick={onRestart}>
          {tr('Start another house')}
        </Button>
      </div>
    )

  return (
    <div className="screen padded narrow">
      <div className="screen-head">
        <h2>{tr('Ready to hand off?')}</h2>
        <p className="muted">{tr('Your design locks when you send it. Our drafters take it from here.')}</p>
      </div>
      <div className="tabs">
        {[
          ['summary', tr('Summary')],
          ['package', tr('Drafter package')],
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
              <h3>{tr('Your drafter asked for')}</h3>
              <p>{project.review.note}</p>
            </div>
          )}
          <div className="card stats">
            <Stat k={tr('Lot')} v={lot?.address || (lot?.plat || lot?.spec?.platId ? tr('From your plat, no address yet') : tr('Your lot'))} />
            <Stat k={tr('Style')} v={tr(style.name)} />
            <Stat k={tr('Program')} v={pline(programOf(rooms, program), ' · ', { tandemShort: true })} />
            <Stat k={tr('Living area')} v={sf(t.areas.living)} />
            {program.asked && <Stat k={tr('Asked for')} v={t.areas.living > program.asked.sqft ? tr('{asked} · {size} → now {drafted}', { asked: pline(program.asked), size: sf(program.asked.sqft), drafted: sf(t.areas.living) }) : tr('{asked} · {size} → drafted {drafted} to fit the lot', { asked: pline(program.asked), size: sf(program.asked.sqft), drafted: sf(t.areas.living) })} />}
            <Stat k={tr('Porches')} v={sf(t.areas.frontPorch + t.areas.rearPorch)} />
            {t.areas.flatwork > 0 && <Stat k={tr('Driveway and walk')} v={sf(t.areas.flatwork)} />}
          </div>
          {costCard}
          <div className="card">
            <h3>{tr('Your changes')}</h3>
            {changes.length === 0 ? (
              <p className="muted">{tr('None. You kept the first draft.')}</p>
            ) : (
              <ol className="list">
                {changes.map((c, i) => (
                  <li key={i}>{c.text}</li>
                ))}
              </ol>
            )}
            <p className="fine">{tr('Only changes that went through are listed; drafters see it with the model, so nothing you asked for gets lost.')}</p>
          </div>
          {lotWaiting && !zoneBlock && (
            <div className="card note calm" data-testid="lot-waiting">
              <h3>{tr('Your plan is saved')}</h3>
              <p>{tr("A drafter is checking your lot against the county records, usually within one business day. We'll email you, and then you can send it.")}</p>
              <p className="fine">{tr('Nothing more to do now. You can keep changing the plan in the meantime; this page shows the Send button as soon as the lot is confirmed.')}</p>
            </div>
          )}
          {(!rules.ok || zoneBlock) && (
            <div className="card note bad" data-testid="send-blocked">
              <h3>{tr('This plan cannot be sent yet')}</h3>
              <ul className="list">
                {zoneLine && <li key="zoning">{zoneLine}</li>}
                {(rules.ok ? [] : rules.reasons).map((r) => (
                  <li key={r}>{say(plainReason(r))}</li>
                ))}
              </ul>
              {zoneBlock ? (
                <>
                  <p className="fine">{tr("The lot's zoning, not the plan, is the problem: a house may need a rezoning or a special permit. The office knows the process and will call you.")}</p>
                  <Button small primary disabled={callBusy || called} onClick={callMe} data-testid="call-me">
                    {called ? tr('The office will call you') : callBusy ? tr('Sending…') : tr('Ask the office to call me')}
                  </Button>
                </>
              ) : (
                <p className="fine">{tr('Go back to the draft and fix these first. The drafters only take plans that pass the rules.')}</p>
              )}
            </div>
          )}
          {lot?.rules && <RulesPanel lot={lot} mode="homeowner" />}
        </>
      )}

      {tab === 'package' && (
        <>
          <div className="card">
            <h3>{tr('Building area')}</h3>
            <table className="tbl">
              <tbody>
                <tr><td>{tr('Living area')}</td><td>{n(t.areas.living)} {tr('sf')}</td>{isRef && <td className="cmp">{tr('set:')} {n(ref.livingSf)} · {pct(t.areas.living, ref.livingSf)}</td>}</tr>
                <tr><td>{tr('Front porch')}</td><td>{n(t.areas.frontPorch)} {tr('sf')}</td>{isRef && <td className="cmp">{tr('set:')} {ref.frontPorchSf}</td>}</tr>
                <tr><td>{tr('Rear porch')}</td><td>{n(t.areas.rearPorch)} {tr('sf')}</td>{isRef && <td className="cmp">{tr('set:')} {ref.rearPorchSf}</td>}</tr>
                {t.areas.garage > 0 && <tr><td>{tr('Garage')}</td><td>{n(t.areas.garage)} {tr('sf')}</td></tr>}
                <tr className="total"><td>{tr('Total')}</td><td>{n(t.areas.total)} {tr('sf')}</td>{isRef && <td className="cmp">{tr('set:')} {n(ref.totalSf)} · {pct(t.areas.total, ref.totalSf)}</td>}</tr>
              </tbody>
            </table>
          </div>
          <div className="card">
            <h3>{tr('Material takeoff')}</h3>
            <table className="tbl">
              <tbody>
                <tr><td>{tr(kit.exterior.siding)}</td><td>{n(t.sidingSf)} {tr('sf')}</td>{isRef && <td className="cmp">{tr('set:')} {n(ref.takeoff.boardBattenSf)} · {pct(t.sidingSf, ref.takeoff.boardBattenSf)}</td>}</tr>
                <tr><td>{tr('Stone veneer')}</td><td>{n(t.stoneSf)} {tr('sf')}</td>{isRef && <td className="cmp">{tr('set:')} {n(ref.takeoff.stoneSf)} · {pct(t.stoneSf, ref.takeoff.stoneSf)}</td>}</tr>
                <tr><td>{tr('Shower tile')}</td><td>{n(t.showerTileSf)} {tr('sf')}</td>{isRef && <td className="cmp">{tr('set:')} {n(ref.takeoff.showerTileSf)} · {pct(t.showerTileSf, ref.takeoff.showerTileSf)}</td>}</tr>
                <tr><td>{tr('Exterior wall perimeter')}</td><td>{n(t.envelope.perimeter)} {tr('ft')}</td></tr>
                <tr><td>{tr('Average plate')}</td><td>{t.envelope.avgPlate.toFixed(1)} {tr('ft')}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="card">
            <h3>{tr('Window schedule')}</h3>
            <table className="tbl">
              <thead><tr><th>{tr('Mark')}</th><th>{tr('Size')}</th><th>{tr('Type')}</th><th>{tr('Head')}</th><th>{tr('Qty')}</th></tr></thead>
              <tbody>
                {t.windows.map((w) => (
                  <tr key={w.mark}><td>{w.mark}</td><td>{w.w}" × {w.h}"</td><td>{tr(w.type)}</td><td>{w.head}</td><td>{w.count}</td></tr>
                ))}
                <tr className="total"><td colSpan={4}>{tr('Single hung / fixed')}</td><td>{t.counts.singleHung} / {t.counts.fixed}{isRef && <span className="cmp"> · {tr('set:')} {ref.takeoff.singleHung} / {ref.takeoff.fixed}</span>}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="card">
            <h3>{tr('Door schedule')}</h3>
            <table className="tbl">
              <thead><tr><th>{tr('Size')}</th><th>{tr('Material')}</th><th>{tr('Qty')}</th></tr></thead>
              <tbody>
                {t.doors.map((d) => (
                  <tr key={d.key}><td>{d.pair ? `${tr('Pair')} ` : ''}{d.w}" × {d.h}"</td><td>{tr(d.material)}</td><td>{d.count}</td></tr>
                ))}
                <tr className="total"><td colSpan={2}>{tr('Interior / exterior')}</td><td>{t.counts.interiorDoors} / {t.counts.exteriorDoors}{isRef && <span className="cmp"> · {tr('set:')} {ref.takeoff.interiorDoors} / {ref.takeoff.exteriorDoors}</span>}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="card pdf">
            <h3>{tr('Floor plan and site plan PDF')}</h3>
            <p className="muted">{tr(`Two sheets with the South Texas Builders title block: the floor plan at 1/4" = 1'-0" and the site plan (lot lines, the space the city keeps open, driveway, walk, coverage) at 1" = 20', on 24 × 36. The tabloid version prints at home at 1/8" = 1'-0".`)}</p>
            <div className="row gap">
              <Button onClick={() => downloadPlan('archD')} disabled={!!pdfBusy}>
                {pdfBusy === 'archD' ? tr('Building…') : tr('Download PDF · 24 × 36')}
              </Button>
              <Button ghost onClick={() => downloadPlan('tabloid')} disabled={!!pdfBusy}>
                {pdfBusy === 'tabloid' ? tr('Building…') : '11 × 17'}
              </Button>
            </div>
            {pdfNote && <p className="muted small">{pdfNote}</p>}
          </div>
          <div className="card ifc">
            <h3>{tr('3D model for Revit')}</h3>
            <p className="muted">
              {tr('Walls, floor slabs, and rooms as an IFC file, placed on the lot. Opens in Revit, Archicad, or any free IFC viewer.')}
            </p>
            <Button onClick={() => downloadIFC({ rooms, program, kit, style, lot })}>{tr('Download IFC')}</Button>
          </div>
          <div className="card">
            <h3>{tr('Sheet set the drafter receives')}</h3>
            <table className="tbl">
              <tbody>
                {kit.sheets.map((s) => (
                  <tr key={s.no}><td>{s.no}</td><td>{tr(s.title)}</td><td className="cmp">{tr(s.contents)}</td></tr>
                ))}
              </tbody>
            </table>
            <p className="fine">
              {tr("Plates {a}' and {b}' · roof {pitch} · {overhang} overhang · {ext} exterior, {plumb} plumbing walls.", { a: kit.plates.default, b: kit.plates.public, pitch: kit.roof.pitch, overhang: kit.roof.overhang, ext: kit.walls.exterior.studs, plumb: kit.walls.plumbing.studs })}
            </p>
          </div>
          {isRef && <p className="fine">{tr(`Columns marked "set" are the numbers on the Garza drawings. Differences are the gap between the packer and a drafter's plan.`)}</p>}
        </>
      )}

      {error && <p className="fine bad">{error}</p>}
      <div className="actions">
        <Button ghost onClick={onBack}>
          {tr('Keep editing')}
        </Button>
        {!lotWaiting && (
          <Button primary disabled={sending || !rules.ok || zoneBlock} onClick={send} title={zoneBlock ? tr('The office calls you about the zoning first') : rules.ok ? '' : tr('Fix the problems listed above first')}>
            {sending ? tr('Sending…') : tr('Send to drafters')}
          </Button>
        )}
      </div>
    </div>
  )
}
