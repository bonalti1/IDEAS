import { useEffect, useMemo, useRef, useState } from 'react'
import HouseScene, { camerasFor } from '../HouseScene.jsx'
import PlanDrawing from '../PlanDrawing.jsx'
import { Button, Stat } from '../ui.jsx'
import { floorArea, isRoom, kitFor, programOf, programLine } from '../lib/layout.js'
import { optionTopic, optionsFor, optionsForAsync, TOPIC_NAMES } from '../lib/options.js'
import { interpretRequest } from '../lib/interpret.js'
import { api } from '../lib/api.js'
import { TRUST } from '../lib/trust.js'
import { useLang, says, houseText, programLineEs, optionLabel, phrase } from '../lib/i18n.js'
import { isUndoRequest } from '../lib/ops.js'

// what the office says when a homeowner asks for a meeting or for more changes (round 8, M4/M8)
const MEETING_THANKS = says(['Thanks! The office will reach out within 1 business day. You can also call {phone}.', { phone: TRUST.phone }])
const MORE_CHANGES_THANKS = says(['Done. The office has your request and usually adds more within 1 business day. You can also call {phone}.', { phone: TRUST.phone }])
const OUT_OF_CHANGES = says(["You've used the free changes on this plan. The office will add more for you. Want me to let them know?"])
const ASK_LABEL = { meeting: phrase('Ask the office to set up my meeting'), 'more-changes': phrase('Ask the office for more changes') }

/** Suggestions that fit the plan as it is right now. */
function suggestionsFor(rooms, kit, t = (s) => s) {
  const list = rooms.filter(isRoom)
  const has = (k) => list.some((r) => r.kind === k)
  const out = []
  if (has('kitchen')) out.push(t('Make the kitchen bigger'))
  if (!has('rearPorch')) out.push(t('Add a porch on the back'))
  else out.push(t('Remove the rear porch'))
  const garage = list.find((r) => r.kind === 'garage')
  if (garage) {
    // the same count the options use: a tandem garage already holds three
    const tandem = !!garage.tandem || /tandem/i.test(garage.name || '')
    const cars = tandem ? 3 : Math.max(1, Math.round(Math.max(garage.w, garage.d) / (kit.rooms.garage?.perCar || 11)))
    if (cars < 3) out.push(t('Make the garage {n} cars', { n: cars + 1 }))
  } else out.push(t('Add a 2-car garage'))
  if (list.filter((r) => ['bed', 'master', 'suite2'].includes(r.kind)).length < 5) out.push(t('Add a bedroom'))
  if (!has('office')) out.push(t('Add an office'))
  if (has('mbath')) out.push(t('Bigger primary bath'))
  if (!has('halfbath')) out.push(t('Add a half bath'))
  return [...out.slice(0, 4), t('Show me garage options')]
}

/** The edits still standing in the chat, oldest first: a re-draft (a new size, a garage the plan cannot add in place) puts them back. */
const standingEdits = (history) => history.flatMap((m, i) => (m.who === 'you' && !m.undone && history[i + 1]?.applied && history[i + 1].ops?.length ? [{ text: m.text, ops: history[i + 1].ops }] : []))

// "send my lot to the drafter", "have the drafter design it" and the same in Spanish (round 13)
export const SEND_LOT_RE = /^\s*(please\s+)?((send|give)\s+(my|the|this)\s+lot(\s+to\s+(the|a|your)\s+drafter)?|(have|let|get)\s+(the|a|your)\s+drafter\s+(to\s+)?(design|draw)\s+(it|this|one|my house|a house|the house)(\s+for\s+(me|this lot|my lot))?|i\s+want\s+(the|a)\s+drafter\s+to\s+(design|draw)\s+(it|my house|a house)|(manda|mande|envía|envia|envíe|envie)(le|r)?\s+mi\s+lote(\s+al\s+dibujante)?|que\s+(lo|la)\s+(diseñe|disene|dibuje)\s+(el|un)\s+dibujante|quiero\s+que\s+(el|un)\s+dibujante\s+(me\s+)?(lo|la)?\s*(diseñe|disene|dibuje)(\s+(la|mi|una)\s+casa)?)\s*[.!]?\s*$/i
const UNDO_RE = /^\s*(undo( that| it| the last( change| one)?)?|go back( one| a step)?|put it back|take (that|it) back|revert( that)?)\s*[.!]?\s*$/i
// the same in Spanish (round 13): "deshacer", "deshaz eso", "regresa", "quita el último cambio"
const UNDO_ES = /^\s*(deshacer|deshaz(lo| eso| el [uú]ltimo( cambio)?)?|regr[eé]sa(lo|le)?|quita el [uú]ltimo cambio|d[eé]jalo como estaba)\s*[.!]?\s*$/i

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

export default function Draft({ style, program, rooms, setRooms, changesLeft, setChangesLeft, history, setHistory, onNext, onBack, lot, project, setProject, changesAllowed, onSendLot = null }) {
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
  const { lang, t, say, sf } = useLang()
  // "4 bed · 3.5 bath · 2-car · 1 story", in the homeowner's language
  const pline = (p, sep, opts) => (lang === 'es' ? programLineEs(p, sep, opts) : programLine(p, sep, opts))

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
  const suggestions = useMemo(() => suggestionsFor(rooms, kit, t), [rooms, kit, t])

  // "Ask the office…": a meeting (cost is covered there) or more changes; the office is emailed and the answer carries the phone
  const askOffice = async (kind) => {
    if (busy) return
    if (!project) {
      setHistory((h) => [...h, { who: 'house', ...says(['Sign in with your email first so the office knows which house is yours. Then this button sends your request. You can also call {phone}.', { phone: TRUST.phone }]), applied: false, source: 'undo' }])
      return
    }
    setBusy(true)
    try {
      const r = await api.meetingRequest(project.id, { kind })
      setProject((p) => ({ ...p, meetingRequest: { at: r.at, kind } }))
      // the office answers with the same sentence the app knows; anything else it says is shown as it came
      const thanks = kind === 'more-changes' ? MORE_CHANGES_THANKS : MEETING_THANKS
      setHistory((h) => [...h, { who: 'house', ...(r.message && r.message !== thanks.text ? { text: r.message } : thanks), applied: false, source: 'undo', asked: kind }])
    } catch (e) {
      setHistory((h) => [...h, { who: 'house', ...says(['The office did not get that just now. Try again in a moment, or call {phone}.', { phone: TRUST.phone }]), applied: false, source: 'fallback' }])
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
      setHistory((h) => [...h, { who: 'house', ...says(options.length >= 2 ? ['{n} options for {topic} that pass the checks on this lot. Pick one: that is one change; looking is free.', { n: options.length, topic: { $t: TOPIC_NAMES[topic] } }] : options.length === 1 ? ['Only one sound option for {topic} on this lot.', { topic: { $t: TOPIC_NAMES[topic] } }] : ['No sound option for {topic} on this lot: each one runs too close to an edge of the lot or breaks a plan rule.', { topic: { $t: TOPIC_NAMES[topic] } }]), applied: false, source: 'options', picker: options, others }])
      setBusy(false)
      return
    }
    // round 13: "send my lot to the drafter", "have the drafter design it": the lot goes to the drafter's queue for a
    // house designed for it, exactly as the button on the rooms step does. Nothing is used.
    if (!fix && SEND_LOT_RE.test(q)) {
      setHistory((h) => [...h, { who: 'you', text: q }])
      if (!onSendLot) {
        setHistory((h) => [...h, { who: 'house', ...says(['Sign in first, so we can save your lot and send it to a drafter.']), applied: false, source: 'fallback' }])
        return
      }
      setBusy(true)
      try {
        await onSendLot()
        setHistory((h) => [...h, { who: 'house', ...says(['Your lot is with our drafter now. A drafter designs a house for this lot and emails you, usually within two business days. No change was used.']), applied: false, source: 'fallback' }])
      } catch {
        setHistory((h) => [...h, { who: 'house', ...says(['We could not reach the office. Try again in a minute.']), applied: false, source: 'fallback' }])
      }
      setBusy(false)
      return
    }
    // "undo", "go back": the last change comes off and comes back to the plan; no model, nothing used
    if (!fix && (isUndoRequest(q) || UNDO_RE.test(q) || UNDO_ES.test(q))) {
      setHistory((h) => [...h, { who: 'you', text: q }])
      if (!canUndo) {
        setHistory((h) => [...h, { who: 'house', ...says(['There is nothing to undo yet.']), applied: false, source: 'fallback' }])
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
        const r = await api.change(project.id, q, fix?.ops, lang)
        res = r
        if (r.applied) setProject((p) => ({ ...p, changesLeft: r.changesLeft, changesUsed: r.changesUsed, version: r.version, versions: [...(p.versions || []), { n: r.version, kind: 'change', text: q, used: 1, at: new Date().toISOString() }] }))
      } else {
        const opts = { lot, history: standingEdits(history), lang }
        if (fix) {
          opts.interpreter = async () => ({ ops: fix.ops, reply: '', confidence: 1 }) // the answer says what was done, not the button's question
          opts.report = false
        }
        res = await interpretRequest(q, rooms, program, style, opts)
        // out of changes on this device: nothing applied, nothing used; cost questions and undo still work (M8)
        if (res.applied && changesLeft <= 0) res = { applied: false, reply: OUT_OF_CHANGES.text, i18n: OUT_OF_CHANGES.i18n, source: 'fallback', askOffice: 'more-changes', outOfChanges: true }
      }
    } catch (e) {
      const sorry = says(e.status === 409 ? ['This design is with the drafters now, so it cannot change.'] : ['Something went wrong on our side. Try again in a moment.'])
      res = { applied: false, reply: sorry.text, i18n: sorry.i18n, source: e.status === 409 ? 'claude' : 'fallback' }
    }
    setBusy(false)
    let meta = null
    if (res.applied) {
      const a2 = floorArea(res.rooms, program.stories)
      meta = { sf: a2 - before.area, used: 1 }
    }
    setHistory((h) => [...h, { who: 'house', text: res.reply, i18n: res.i18n, source: res.source, applied: res.applied, fixes: res.applied ? null : res.fixes || null, meta, ops: res.applied ? res.ops : undefined, askOffice: res.askOffice || null, askLabel: res.askLabel || null }])
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
      setHistory((h) => [...h, { who: 'house', ...says(['Back to version {n}.', { n }], p.refunded ? ['{n} {n|change|changes} returned.', { n: p.refunded }] : null), applied: true, source: 'undo' }])
    } catch (e) {
      setHistory((h) => [...h, { who: 'house', ...says(['Could not go back: {error}', { error: e.message }]), applied: false, source: 'fallback' }])
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
      return [...out, { who: 'house', ...says(['Undid "{text}". That change is back on your plan.', { text: snap.text }]), applied: true, source: 'undo' }]
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
                {t('Close')}
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
            {t(style.name)} · {pline(programOf(rooms, program))}
          </div>
          <div className="viewport-hint">{view === 'top' ? t('Floor plan · tap a room for its size · pinch or scroll to zoom · drag to pan') : view === 'site' ? t('Site plan · lot lines, the space kept open, driveway, walk') : t('Drag to turn · scroll to zoom · right-drag to pan')}</div>
        </div>
        <div className="viewport-views">
          <button className={view === 'top' ? 'on' : ''} onClick={() => setCamera('top')}>
            {t('Plan')}
          </button>
          <button className={view === 'site' ? 'on' : ''} onClick={() => setCamera('site')}>
            {t('Site')}
          </button>
          <button className={view === '3d' ? 'on' : ''} onClick={() => setCamera('3d')}>
            {t('3D')}
          </button>
          {view === '3d' && (
            <>
              <button className="fit" onClick={() => setCamera(view)} title={t('Reset the camera')}>
                {t('Reset')}
              </button>
              <label className="check">
                <input type="checkbox" checked={roof} onChange={(e) => setRoof(e.target.checked)} />
                {t('Roof')}
              </label>
              <label className="check" title={t("Shadows on July 15 at 5 pm, from the lot's real orientation")}>
                <input type="checkbox" checked={sun} onChange={(e) => setSun(e.target.checked)} />
                {t('Sun check')}
              </label>
            </>
          )}
        </div>
      </div>
      <aside className="side chat">
        <div className="side-head">
          <h2>{t('Shape it')}</h2>
          {!project && <span className="muted small">{t('not saved')}</span>}
          {/* round 11, item 7: the changes left are said once, in the header (they were here too, twice on one screen) */}
        </div>
        {/* round 13, item 7: what the count in the header means, in one line; the number is the plan's own allowance */}
        <p className="fine changes-note" data-testid="changes-note">
          {t("{n} free {n|change|changes}; a failed request doesn't use one", { n: changesAllowed })}
          {/* the review of PR #12: what counts and what does not */}
          <span className="muted"> {t('Only a change the chat makes to your plan uses one. Choosing your lot and rooms, your first draft and undo are free.')}</span>
        </p>
        <div className="stats row2">
          <Stat k={t('Living area')} v={sf(area)} />
          <Stat k={t('Rooms')} v={lang === 'es' ? programLineEs(programOf(rooms, program), ', ', { stories: false }) : programLine(programOf(rooms, program), ', ').replace(/, \d story$/, '')} />
        </div>
        <div className="log" ref={logRef}>
          {history.length === 0 && (
            <div className="msg house">
              {t('Here is your first draft. Tell me what to change, like you would tell a designer.')}
            </div>
          )}
          {history.map((m, i) => (
            <div key={i} className={'msg ' + m.who + (m.applied === false && m.who === 'house' ? ' held' : '') + (m.undone ? ' undone' : '')}>
              {m.who === 'house' ? houseText(m, lang) : m.text}
              {m.meta && (
                <span className="meta">
                  {Math.round(m.meta.sf) ? <b>{signed(m.meta.sf, ` ${t('sf')}`)}</b> : t('same size')} · {t('{n} change used', { n: m.meta.used ?? 1 })}
                </span>
              )}
              {m.askOffice && !m.asked && (
                <span className="fixes ask-office">
                  <button onClick={() => askOffice(m.askOffice)} disabled={busy}>
                    {/* the office writes the button in the language of the answer above it */}
                    {m.askLabel || t(ASK_LABEL[m.askOffice] || ASK_LABEL.meeting)}
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
                        send(optionLabel(o.label, lang), { ops: o.ops, label: o.label })
                      }}
                      title={o.did.map((d) => say(d)).join('. ')}
                    >
                      <span
                        className="thumb"
                        role="button"
                        aria-label={t('See {label} full size', { label: optionLabel(o.label, lang) })}
                        onClick={(e) => {
                          e.stopPropagation()
                          setBig({ label: optionLabel(o.label, lang), svg: o.svg })
                        }}
                        dangerouslySetInnerHTML={{ __html: o.svg }}
                      />
                      <b>{optionLabel(o.label, lang)}</b>
                      <span className="delta">
                        {signed(o.sf, ` ${t('sf')}`)}
                      </span>
                      <span className="pick">{t('Pick · 1 change')}</span>
                    </button>
                  ))}
                  {m.others && (
                    <span className="more">
                      {t('Also:')}{' '}
                      {m.others.map((k) => (
                        <button key={k} className="linkish" onClick={() => send(t('show me options for {topic}', { topic: t(TOPIC_NAMES[k]) }))} disabled={busy}>
                          {t(TOPIC_NAMES[k])}
                        </button>
                      ))}
                    </span>
                  )}
                </div>
              )}
              {m.fixes?.length > 0 && (
                <span className="fixes">
                  {m.fixes.map((f) => (
                    <button key={f.label} onClick={() => send(say(f.label).replace(/^¿|\?$/g, ''), f)} disabled={busy || changesLeft <= 0}>
                      {say(f.label)}
                    </button>
                  ))}
                </span>
              )}
            </div>
          ))}
          {busy && <div className="msg house thinking">{t('Working on it…')}</div>}
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
          <input
            // on a phone the keyboard covers the bottom of the page: the box is brought back into view once it is up
            onFocus={(e) => {
              const el = e.target
              if (window.innerWidth <= 600) setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300)
            }}
            placeholder={changesLeft > 0 ? t('What would you like to change?') : t('No changes left on this plan. Ask the office for more, or send it.')} value={text} onChange={(e) => setText(e.target.value)} disabled={busy} aria-label={t('Your change')} />
          <Button primary small type="submit" disabled={!text.trim() || busy}>
            {t('Change')}
          </Button>
        </form>
        <div className="chat-tools">
          {project ? (
            <button className="linkish" onClick={() => setShowVersions((v) => !v)} disabled={versions.length < 2}>
              {showVersions ? t('Hide history') : t('History ({n})', { n: versions.length })}
            </button>
          ) : (
            <span className="muted small">
              <a href="#/" onClick={(e) => { e.preventDefault(); window.scrollTo(0, 0); document.querySelector('#signin-email')?.focus() }}>{t('Sign in')}</a> {t('to keep a history')}
            </span>
          )}
          <button className="linkish undo" onClick={undoLast} disabled={busy || !canUndo} title={canUndo ? t('Back one change; it comes back to your plan') : t('Nothing to undo yet')}>
            {t('Undo last change')}
          </button>
        </div>
        {project && showVersions && (
          <ol className="versions">
            {versions.map((v) => (
              <li key={v.n} className={v.n === project.version ? 'now' : ''}>
                <span className="v-n">v{v.n}</span>
                <span className="v-text">
                  {v.kind === 'change' ? v.text : say(v.text)}
                  {v.refunded ? <span className="muted"> · {t('undone')}</span> : v.used || v.credit ? <span className="muted"> · {t('1 change')}</span> : null}
                </span>
                {v.n === project.version ? <span className="muted small">{t('current')}</span> : (
                  <button className="linkish" onClick={() => restore(v.n)} disabled={busy}>
                    {t('Restore')}
                  </button>
                )}
              </li>
            ))}
          </ol>
        )}
        <div className="actions">
          <Button ghost onClick={onBack}>
            {t('Back')}
          </Button>
          <Button primary onClick={onNext}>
            {t('I love it, send to drafters')}
          </Button>
        </div>
      </aside>
    </div>
  )
}
