import { useEffect, useMemo, useRef, useState } from 'react'
import HouseScene, { camerasFor } from '../HouseScene.jsx'
import PlanDrawing from '../PlanDrawing.jsx'
import { Button, Stat, sf } from '../ui.jsx'
import { floorArea, isRoom, kitFor, programOf, programLine } from '../lib/layout.js'
import { optionTopic, optionsFor, optionsForAsync, TOPIC_NAMES } from '../lib/options.js'
import { interpretRequest } from '../lib/interpret.js'
import { api } from '../lib/api.js'
import { TRUST } from '../lib/trust.js'

// what the office says when a homeowner asks for a meeting or for more changes (round 8, M4/M8)
const MEETING_THANKS = `Thanks! The office will reach out within 1 business day. You can also call ${TRUST.phone}.`
const MORE_CHANGES_THANKS = `Done. The office has your request and usually adds more within 1 business day. You can also call ${TRUST.phone}.`
const OUT_OF_CHANGES = "You've used the free changes on this plan. The office will add more for you. Want me to let them know?"
const ASK_LABEL = { meeting: 'Ask the office to set up my meeting', 'more-changes': 'Ask the office for more changes' }

/** Suggestions that fit the plan as it is right now. */
function suggestionsFor(rooms, kit) {
  const list = rooms.filter(isRoom)
  const has = (k) => list.some((r) => r.kind === k)
  const out = []
  if (has('kitchen')) out.push('Make the kitchen bigger')
  if (!has('rearPorch')) out.push('Add a porch on the back')
  else out.push('Remove the rear porch')
  const garage = list.find((r) => r.kind === 'garage')
  if (garage) {
    // the same count the options use: a tandem garage already holds three
    const tandem = !!garage.tandem || /tandem/i.test(garage.name || '')
    const cars = tandem ? 3 : Math.max(1, Math.round(Math.max(garage.w, garage.d) / (kit.rooms.garage?.perCar || 11)))
    if (cars < 3) out.push(`Make the garage ${cars + 1} cars`)
  } else out.push('Add a 2-car garage')
  if (list.filter((r) => ['bed', 'master', 'suite2'].includes(r.kind)).length < 5) out.push('Add a bedroom')
  if (!has('office')) out.push('Add an office')
  if (has('mbath')) out.push('Bigger primary bath')
  if (!has('halfbath')) out.push('Add a half bath')
  return [...out.slice(0, 4), 'Show me garage options']
}

/** The edits still standing in the chat, oldest first: a re-draft (a new size, a garage the plan cannot add in place) puts them back. */
const standingEdits = (history) => history.flatMap((m, i) => (m.who === 'you' && !m.undone && history[i + 1]?.applied && history[i + 1].ops?.length ? [{ text: m.text, ops: history[i + 1].ops }] : []))

const UNDO_RE = /^\s*(undo( that| it| the last( change| one)?)?|go back( one| a step)?|put it back|take (that|it) back|revert( that)?)\s*[.!]?\s*$/i

/** A phone-width screen: no 3D tags, they pile up. */
function useNarrow() {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 700px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 700px)')
    const on = () => setNarrow(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return narrow
}

const signed = (n, unit = '') => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(Math.round(n)).toLocaleString() + unit

export default function Draft({ style, program, rooms, setRooms, changesLeft, setChangesLeft, history, setHistory, onNext, onBack, lot, project, setProject }) {
  const [text, setText] = useState('')
  const [view, setView] = useState('3d')
  const [big, setBig] = useState(null) // an option drawing opened full size
  const [sun, setSun] = useState(false)
  const [highlight, setHighlight] = useState(null)
  const [busy, setBusy] = useState(false)
  const [undo, setUndo] = useState([]) // snapshots before each applied change: { rooms, changesLeft, text }
  const [roof, setRoof] = useState(true)
  const [showVersions, setShowVersions] = useState(false)
  const controls = useRef()
  const logRef = useRef()
  const kit = kitFor(style)

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [history])

  // a camera preset framed on the house, not the whole lot
  const plan = useRef(null)
  const setCamera = (name) => {
    setView(name)
    if (name === 'top' || name === 'site') {
      plan.current?.fit()
      return
    }
    const c = controls.current
    if (!c) return
    const { position, target } = camerasFor(lot, rooms)[name]
    c.object.position.set(...position)
    c.target.set(...target)
    c.update()
  }

  const area = floorArea(rooms, program.stories)
  const suggestions = useMemo(() => suggestionsFor(rooms, kit), [rooms, kit])

  // "Ask the office…": a meeting (cost is covered there) or more changes; the office is emailed and the answer carries the phone
  const askOffice = async (kind) => {
    if (busy) return
    if (!project) {
      setHistory((h) => [...h, { who: 'house', text: `Sign in with your email first so the office knows which house is yours. Then this button sends your request. You can also call ${TRUST.phone}.`, applied: false, source: 'undo' }])
      return
    }
    setBusy(true)
    try {
      const r = await api.meetingRequest(project.id, { kind })
      setProject((p) => ({ ...p, meetingRequest: { at: r.at, kind } }))
      setHistory((h) => [...h, { who: 'house', text: r.message || (kind === 'more-changes' ? MORE_CHANGES_THANKS : MEETING_THANKS), applied: false, source: 'undo', asked: kind }])
    } catch (e) {
      setHistory((h) => [...h, { who: 'house', text: `The office did not get that just now. Try again in a moment, or call ${TRUST.phone}.`, applied: false, source: 'fallback' }])
    }
    setBusy(false)
  }

  /**
   * One request to the office, or a fix the client clicked (ops already decided).
   * The reply carries what changed in square feet and that one change was used. Never a dollar.
   */
  const narrow = useNarrow()
  const send = async (msg, fix = null) => {
    const q = (msg ?? text).trim()
    if (!q || busy) return
    setText('')
    // "show me options for the garage": two or three sound options side by side, nothing used until one is picked
    const topic = !fix && optionTopic(q)
    if (topic) {
      setBusy(true)
      setHistory((h) => [...h, { who: 'you', text: q }])
      await new Promise((r) => setTimeout(r, 30))
      // built one candidate a turn, so the spinner paints between them instead of the page freezing
      const { options } = await optionsForAsync(topic, rooms, program, style, lot, { history: standingEdits(history) })
      const others = Object.keys(TOPIC_NAMES).filter((k) => k !== topic)
      setHistory((h) => [...h, { who: 'house', text: options.length >= 2 ? `${options.length} options for ${TOPIC_NAMES[topic]} that pass the checks on this lot. Pick one: that is one change; looking is free.` : options.length === 1 ? `Only one sound option for ${TOPIC_NAMES[topic]} on this lot.` : `No sound option for ${TOPIC_NAMES[topic]} on this lot: the setbacks or the rules refuse each one.`, applied: false, source: 'options', picker: options, others }])
      setBusy(false)
      return
    }
    // "undo", "go back": the last change comes off and comes back to the plan; no model, nothing used
    if (!fix && UNDO_RE.test(q)) {
      setHistory((h) => [...h, { who: 'you', text: q }])
      if (!canUndo) {
        setHistory((h) => [...h, { who: 'house', text: 'There is nothing to undo yet.', applied: false, source: 'fallback' }])
        return
      }
      undoLast()
      return
    }
    setBusy(true)
    setHistory((h) => [...h, { who: 'you', text: q }])
    const before = { area, rooms, changesLeft }
    let res
    try {
      if (project) {
        // the office runs the change, checks the rules and uses one of the plan's changes only when it applies
        const r = await api.change(project.id, q, fix?.ops)
        res = r
        if (r.applied) setProject((p) => ({ ...p, changesLeft: r.changesLeft, changesUsed: r.changesUsed, version: r.version, versions: [...(p.versions || []), { n: r.version, kind: 'change', text: q, used: 1, at: new Date().toISOString() }] }))
      } else {
        const opts = { lot, history: standingEdits(history) }
        if (fix) {
          opts.interpreter = async () => ({ ops: fix.ops, reply: '', confidence: 1 }) // the answer says what was done, not the button's question
          opts.report = false
        }
        res = await interpretRequest(q, rooms, program, style, opts)
        // out of changes on this device: nothing applied, nothing used; cost questions and undo still work (M8)
        if (res.applied && changesLeft <= 0) res = { applied: false, reply: OUT_OF_CHANGES, source: 'fallback', askOffice: 'more-changes', outOfChanges: true }
      }
    } catch (e) {
      res = e.status === 409 ? { applied: false, reply: 'This design is with the drafters now, so it cannot change.', source: 'claude' } : { applied: false, reply: 'Something went wrong on our side. Try again in a moment.', source: 'fallback' }
    }
    setBusy(false)
    let meta = null
    if (res.applied) {
      const a2 = floorArea(res.rooms, program.stories)
      meta = { sf: a2 - before.area, used: 1 }
    }
    setHistory((h) => [...h, { who: 'house', text: res.reply, source: res.source, applied: res.applied, fixes: res.applied ? null : res.fixes || null, meta, ops: res.applied ? res.ops : undefined, askOffice: res.askOffice || null }])
    if (res.changesLeft !== undefined) setChangesLeft(res.changesLeft)
    if (res.applied) {
      if (!project) {
        setUndo((u) => [...u, { rooms, changesLeft, text: q }])
        setChangesLeft((c) => c - 1)
      }
      setRooms(res.rooms)
      const kind = res.ops?.[0]?.op === 'add' ? res.ops[0].kind : rooms.find((r) => r.id === res.ops?.[0]?.room)?.kind
      setHighlight(kind || null)
      setTimeout(() => setHighlight(null), 1800)
    }
  }

  // back to an earlier saved version; the changes used after it come back to the plan
  const restore = async (n) => {
    if (!project || busy) return
    setBusy(true)
    try {
      const p = await api.rollback(project.id, n)
      setProject(p)
      setRooms(p.rooms)
      setChangesLeft(p.changesLeft)
      setHistory((h) => [...h, { who: 'house', text: `Back to version ${n}.${p.refunded ? ` ${p.refunded} change${p.refunded === 1 ? '' : 's'} returned.` : ''}`, applied: true, source: 'undo' }])
    } catch (e) {
      setHistory((h) => [...h, { who: 'house', text: `Could not go back: ${e.message}`, applied: false, source: 'fallback' }])
    }
    setBusy(false)
  }
  const versions = project?.versions || []
  const current = versions[versions.length - 1]
  const canUndo = project ? current?.kind === 'change' && current.n > 1 : undo.length > 0

  const undoLast = () => {
    if (project) return restore(current.n - 1)
    const snap = undo[undo.length - 1]
    if (!snap) return
    setUndo((u) => u.slice(0, -1))
    setRooms(snap.rooms)
    setChangesLeft(snap.changesLeft) // the change comes back to the plan
    setHistory((h) => {
      // the last applied request is marked undone, so the send step does not list it
      const out = [...h]
      for (let i = out.length - 1; i >= 0; i--) {
        if (out[i].who === 'you' && out[i + 1]?.applied && !out[i].undone) {
          out[i] = { ...out[i], undone: true }
          break
        }
      }
      return [...out, { who: 'house', text: `Undid "${snap.text}". That change is back on your plan.`, applied: true, source: 'undo' }]
    })
  }

  return (
    <div className="screen split">
      {big && (
        <div className="lightbox" role="dialog" aria-label={big.label} onClick={() => setBig(null)}>
          <div className="lightbox-card" onClick={(e) => e.stopPropagation()}>
            <div className="lightbox-head">
              <b>{big.label}</b>
              <button className="linkish" onClick={() => setBig(null)}>
                Close
              </button>
            </div>
            <div className="lightbox-svg" dangerouslySetInnerHTML={{ __html: big.svg }} />
          </div>
        </div>
      )}
      <div className="viewport">
        <div className="viewport-stage">
          {view === 'top' || view === 'site' ? (
            <PlanDrawing mode={view === 'site' ? 'site' : 'plan'} rooms={rooms} program={program} style={style} lot={lot} client={project?.client} api={plan} highlightKind={highlight} />
          ) : (
            <HouseScene rooms={rooms} style={style} view={view} highlightKind={highlight} controlsRef={controls} showRoof={roof} lot={lot} sun={sun} tags={!narrow} />
          )}
          <div className="viewport-tag">
            {style.name} · {programLine(programOf(rooms, program))}
          </div>
          <div className="viewport-hint">{view === 'top' ? 'Floor plan · tap a room for its size · pinch or scroll to zoom · drag to pan' : view === 'site' ? 'Site plan · lot lines, setbacks, driveway, walk' : 'Drag to turn · scroll to zoom · right-drag to pan'}</div>
        </div>
        <div className="viewport-views">
          <button className={view === 'top' ? 'on' : ''} onClick={() => setCamera('top')}>
            Plan
          </button>
          <button className={view === 'site' ? 'on' : ''} onClick={() => setCamera('site')}>
            Site
          </button>
          <button className={view === '3d' ? 'on' : ''} onClick={() => setCamera('3d')}>
            3D
          </button>
          {view === '3d' && (
            <>
              <button className="fit" onClick={() => setCamera(view)} title="Reset the camera">
                Reset
              </button>
              <label className="check">
                <input type="checkbox" checked={roof} onChange={(e) => setRoof(e.target.checked)} />
                Roof
              </label>
              <label className="check" title="Shadows on July 15 at 5 pm, from the lot's real orientation">
                <input type="checkbox" checked={sun} onChange={(e) => setSun(e.target.checked)} />
                Sun check
              </label>
            </>
          )}
        </div>
      </div>
      <aside className="side chat">
        <div className="side-head">
          <h2>Shape it</h2>
          {!project && <span className="muted small">not saved</span>}
          {/* round 11, item 7: the changes left are said once, in the header (they were here too, twice on one screen) */}
        </div>
        <div className="stats row2">
          <Stat k="Living area" v={sf(area)} />
          <Stat k="Rooms" v={programLine(programOf(rooms, program), ', ').replace(/, \d story$/, '')} />
        </div>
        <div className="log" ref={logRef}>
          {history.length === 0 && (
            <div className="msg house">
              Here is your first draft. Tell me what to change, like you would tell a designer.
            </div>
          )}
          {history.map((m, i) => (
            <div key={i} className={'msg ' + m.who + (m.applied === false && m.who === 'house' ? ' held' : '') + (m.undone ? ' undone' : '')}>
              {m.text}
              {m.meta && (
                <span className="meta">
                  {Math.round(m.meta.sf) ? <b>{signed(m.meta.sf, ' sf')}</b> : 'same size'} · {m.meta.used ?? 1} change used
                </span>
              )}
              {m.askOffice && !m.asked && (
                <span className="fixes ask-office">
                  <button onClick={() => askOffice(m.askOffice)} disabled={busy}>
                    {ASK_LABEL[m.askOffice] || ASK_LABEL.meeting}
                  </button>
                </span>
              )}
              {m.picker && (
                <div className="picker">
                  {m.picker.map((o) => (
                    <button
                      key={o.id}
                      className="option"
                      aria-disabled={busy || changesLeft <= 0}
                      onClick={() => {
                        if (busy || changesLeft <= 0) return
                        send(o.label, { ops: o.ops, label: o.label })
                      }}
                      title={o.did.join('. ')}
                    >
                      <span
                        className="thumb"
                        role="button"
                        aria-label={`See ${o.label} full size`}
                        onClick={(e) => {
                          e.stopPropagation()
                          setBig({ label: o.label, svg: o.svg })
                        }}
                        dangerouslySetInnerHTML={{ __html: o.svg }}
                      />
                      <b>{o.label}</b>
                      <span className="delta">
                        {signed(o.sf, ' sf')}
                      </span>
                      <span className="pick">Pick · 1 change</span>
                    </button>
                  ))}
                  {m.others && (
                    <span className="more">
                      Also:{' '}
                      {m.others.map((k) => (
                        <button key={k} className="linkish" onClick={() => send(`show me options for ${TOPIC_NAMES[k]}`)} disabled={busy}>
                          {TOPIC_NAMES[k]}
                        </button>
                      ))}
                    </span>
                  )}
                </div>
              )}
              {m.fixes?.length > 0 && (
                <span className="fixes">
                  {m.fixes.map((f) => (
                    <button key={f.label} onClick={() => send(f.label.replace(/\?$/, ''), f)} disabled={busy || changesLeft <= 0}>
                      {f.label}
                    </button>
                  ))}
                </span>
              )}
            </div>
          ))}
          {busy && <div className="msg house thinking">Working on it…</div>}
        </div>
        <div className="chips">
          {suggestions.map((s) => (
            <button key={s} onClick={() => send(s)} disabled={changesLeft <= 0 || busy}>
              {s}
            </button>
          ))}
        </div>
        <form
          className="ask"
          onSubmit={(e) => {
            e.preventDefault()
            send()
          }}
        >
          <input placeholder={changesLeft > 0 ? 'What would you like to change?' : 'No changes left on this plan. Ask the office for more, or send it.'} value={text} onChange={(e) => setText(e.target.value)} disabled={busy} aria-label="Your change" />
          <Button primary small type="submit" disabled={!text.trim() || busy}>
            Change
          </Button>
        </form>
        <div className="chat-tools">
          {project ? (
            <button className="linkish" onClick={() => setShowVersions((v) => !v)} disabled={versions.length < 2}>
              {showVersions ? 'Hide history' : `History (${versions.length})`}
            </button>
          ) : (
            <span className="muted small">
              <a href="#/" onClick={(e) => { e.preventDefault(); window.scrollTo(0, 0); document.querySelector('#signin-email')?.focus() }}>Sign in</a> to keep a history
            </span>
          )}
          <button className="linkish undo" onClick={undoLast} disabled={busy || !canUndo} title={canUndo ? 'Back one change; it comes back to your plan' : 'Nothing to undo yet'}>
            Undo last change
          </button>
        </div>
        {project && showVersions && (
          <ol className="versions">
            {versions.map((v) => (
              <li key={v.n} className={v.n === project.version ? 'now' : ''}>
                <span className="v-n">v{v.n}</span>
                <span className="v-text">
                  {v.text}
                  {v.refunded ? <span className="muted"> · undone</span> : v.used || v.credit ? <span className="muted"> · 1 change</span> : null}
                </span>
                {v.n === project.version ? <span className="muted small">current</span> : (
                  <button className="linkish" onClick={() => restore(v.n)} disabled={busy}>
                    Restore
                  </button>
                )}
              </li>
            ))}
          </ol>
        )}
        <div className="actions">
          <Button ghost onClick={onBack}>
            Back
          </Button>
          <Button primary onClick={onNext}>
            I love it, send to drafters
          </Button>
        </div>
      </aside>
    </div>
  )
}
