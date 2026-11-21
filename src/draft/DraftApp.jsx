// Draft House client flow. Five steps after the start screen. With an account the project is
// saved on the office API (every version, credits, status); without one it lives in this tab.
import React, { Suspense, lazy, useEffect, useRef, useState } from 'react'
import App from '../App.jsx'
import { Mark } from './ui.jsx'
import Start from './screens/Start.jsx'
import Lot from './screens/Lot.jsx'
import Style from './screens/Style.jsx'
import Program, { prefetchFit } from './screens/Program.jsx'
import Draft from './screens/Draft.jsx'
import Send from './screens/Send.jsx'
// the office screens are their own chunk: the homeowner app never downloads the review, the dashboard or the rates (round 9, item 1)
const Admin = lazy(() => import('./screens/Admin.jsx'))
const Review = lazy(() => import('./screens/Review.jsx'))
import SignIn from './screens/SignIn.jsx'
import { DEFAULT_PROGRAM, starterDraft } from './lib/layout.js'
import { turnLot } from './lib/lot.js'
import { STYLES } from './lib/styles.js'
import { api } from './lib/api.js'
import { stepHash, readHash, reach, saveTab, loadTab } from './lib/route.js'
import { currentUser, onAuthChange, signOut } from './lib/auth.js'
import { EDITABLE, historyFrom } from './lib/status.js'
import { LangProvider, LangSwitch, useLang, says, phrase, forceLang, homeownerLang, wordsFor } from './lib/i18n.js'
import './draft.css'

const STEPS = [phrase('Lot'), phrase('Style'), phrase('Rooms'), phrase('Draft'), phrase('Send')]

/** A step that throws shows what happened and a way back, instead of a blank page. */
class StepBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  componentDidUpdate(prev) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }
  render() {
    if (!this.state.error)
      return this.props.children
    const t = this.props.t || ((s) => s)
    return (
      <div className="screen padded narrow center">
        <div className="card signin">
          <h3>{t('Something went wrong on this step')}</h3>
          <p className="muted small">{String(this.state.error?.message || this.state.error)}</p>
          <button className="btn btn-primary" onClick={() => this.setState({ error: null })}>
            {t('Try again')}
          </button>{' '}
          <button className="btn btn-ghost" onClick={() => this.props.onBack?.()}>
            {t('Go back a step')}
          </button>
        </div>
      </div>
    )
  }
}
// free changes on a plan drafted on this device without an account: the same default the office uses (round 8, M7)
const CHANGES_PER_PLAN = 10
const isDrafter = (u) => u && (u.role === 'drafter' || u.role === 'admin')

/** Office screens need a drafter. */
function OfficeGate({ user, onUser, children }) {
  if (user === undefined) return <div className="screen padded narrow center"><p className="muted">Loading…</p></div>
  if (!user)
    return (
      <div className="screen padded narrow center">
        <SignIn title="Office sign-in" lede="Drafters and admins only." askName={false} onSignedIn={onUser} />
        <p className="center-text">
          <a className="linkish" href="#/" data-testid="office-to-home">
            Planning your own house? Start here
          </a>
        </p>
      </div>
    )
  // a homeowner never stays on an office page (round 13, item 2: the browser's Back left one on "Not a drafter
  // account"): the address is replaced with their own first screen, so Back cannot return here either
  if (!isDrafter(user)) return <HomeAgain />
  return children
}
function HomeAgain() {
  // the office pages are English; this line is for a homeowner who landed on one, so it is in their language
  const { t } = wordsFor(homeownerLang())
  useEffect(() => {
    window.location.replace(window.location.pathname + window.location.search + '#/')
  }, [])
  return (
    <div className="screen padded narrow center" data-testid="home-again">
      <p className="muted">{t('Taking you to your house…')}</p>
    </div>
  )
}

export default function DraftApp({ admin = false, review = false, lot514 = false }) {
  const [user, setUser] = useState(undefined) // undefined: still checking
  const [projects, setProjects] = useState([])
  const [project, setProject] = useState(null) // the saved project, when signed in and the office is reachable
  const [step, setStep] = useState(0)
  const [intake, setIntake] = useState(null) // what the start screen collected: address, file, client name
  const [lot, setLot] = useState(null) // the built lot from the Lot step
  const [style, setStyle] = useState(null)
  const [program, setProgram] = useState(DEFAULT_PROGRAM)
  const [rooms, setRooms] = useState([])
  const [changesLeft, setChangesLeft] = useState(CHANGES_PER_PLAN) // free changes left on the open plan
  const [history, setHistory] = useState([])
  const [returnSeen, setReturnSeen] = useState(false) // the client read the drafter's note and went back to the draft
  // round 12, item E: the rooms start at what fits the lot until the homeowner chooses (touched); autoNote says we did that
  const [touched, setTouched] = useState(false)
  const [autoNote, setAutoNote] = useState(false)
  // round 13, item 1: the homeowner's screens follow the homeowner's language; the office screens are English
  forceLang(admin || review || lot514 ? 'en' : null)
  const { t } = useLang()

  const loadUser = async () => {
    const u = await currentUser()
    setUser(u)
    if (u) api.projects().then(setProjects).catch(() => setProjects([]))
    else setProjects([])
  }
  useEffect(() => {
    loadUser()
    return onAuthChange(loadUser)
  }, [])

  const go = (n) => setStep(n)
  const stepRef = useRef(0)
  stepRef.current = step
  const restart = () => {
    setStep(0)
    projectRef.current = null
    setProject(null)
    setIntake(null)
    setLot(null)
    setStyle(null)
    setProgram(DEFAULT_PROGRAM)
    setRooms([])
    setChangesLeft(CHANGES_PER_PLAN)
    setHistory([])
    setReturnSeen(false)
    setTouched(false)
    setAutoNote(false)
    if (user) api.projects().then(setProjects).catch(() => {})
  }
  const noteMessage = (p) => ({ who: 'house', ...says(p.review?.drafter ? ['Note from {who}: {note}', { who: p.review.drafter, note: p.review?.note }] : ['Note from your drafter: {note}', { note: p.review?.note }]), applied: true, source: 'undo' })
  const backToDraft = () => {
    setReturnSeen(true)
    if (project?.review?.note) setHistory((h) => [...h, noteMessage(project)])
    go(4)
  }
  const logout = async () => {
    await signOut()
    setUser(null)
    restart()
  }

  // Round 12, item B: the project is saved as soon as a lot is taken, and again on every step. Before this, the
  // address, the chosen parcel, the style and the rooms lived only in this tab until the Draft step: a homeowner
  // who signed out lost them, and a drafter never saw the lot. `patch` is what changed; `stage` is the step to
  // resume on. With no account, or the office unreachable, the plan keeps going in this tab as before.
  const projectRef = useRef(null)
  projectRef.current = project
  const saving = useRef(Promise.resolve())
  const saveDraft = (patch, stage, clientName = null) => {
    if (!user) return Promise.resolve(null)
    const run = async () => {
      const cur = projectRef.current
      try {
        const body = { ...patch, stage, client: clientName || intake?.client || user.name }
        const p = cur && EDITABLE.includes(cur.status) ? await api.updateProject(cur.id, body) : cur ? cur : await api.createProject(body)
        projectRef.current = p
        setProject(p)
        setChangesLeft(p.changesLeft ?? CHANGES_PER_PLAN)
        api.projects().then(setProjects).catch(() => {})
        return p
      } catch {
        return cur // the office did not answer: nothing is lost in this tab, and the next step tries again
      }
    }
    // one save at a time, in order: the lot is created before the style or the rooms are added to it
    saving.current = saving.current.then(run, run)
    return saving.current
  }
  // the rooms chosen so far are saved a moment after the last tap on the Rooms step
  useEffect(() => {
    if (step !== 3 || !user || !projectRef.current || projectRef.current.version) return
    const t = setTimeout(() => saveDraft({ program }, 'rooms'), 900)
    return () => clearTimeout(t)
  }, [program, step])
  // "Send my lot to the drafter" (item A): no plan of ours fits; the lot and the rooms asked for go to the drafter's queue
  const sendLotToDrafter = async (note = '') => {
    const p = (await saveDraft({ lot, program, ...(style ? { style: { id: style.id, name: style.name } } : {}) }, 'rooms')) || projectRef.current
    if (!p?.id) throw new Error(t('Sign in so we can save your lot and send it to a drafter.'))
    const out = await api.customProject(p.id, { note, program })
    projectRef.current = out
    setProject(out)
    api.projects().then(setProjects).catch(() => {})
    return out
  }

  // Rooms → Draft: a fresh layout; saved as a project (or a new free version of one) when signed in
  const enterDraft = async (opts = {}) => {
    // the fit may have turned the house to sit in the widest part of a wedge-shaped lot (round 12, item A): the lot
    // carries that turn from here on, and the office rebuilds it the same way from the spec
    const onLot = Number.isFinite(opts?.turn) && lot?.spec ? turnLot(lot, opts.turn) : lot
    if (onLot !== lot) setLot(onLot)
    const d = starterDraft(program, style, onLot)
    const next = d.rooms
    // what the draft had to do to fit: said once, up front
    const notes = []
    if (d.clamped) notes.push(['With these rooms the plan does not go under {n} sf, so that is the size you see.', { n: Math.round(d.minSqft).toLocaleString() }])
    if (d.fitScale < 0.995) notes.push(['We trimmed it about {pct}% to keep the space the city requires along the edges of this lot.', { pct: Math.round((1 - d.fitScale) * 100) }])
    if (onLot?.spec?.turn) notes.push(['The house is turned {deg}° from square to the street, to sit in the widest part of your lot.', { deg: Math.abs(onLot.spec.turn) }])
    const intro = notes.length ? [{ who: 'house', ...says(['Here is your first draft.'], ...notes), applied: true, source: 'undo' }] : []
    setRooms(next)
    setHistory(intro)
    if (user) {
      try {
        await saving.current.catch(() => {}) // the lot-only save, if one is still on its way
        const cur = projectRef.current
        const body = { lot: onLot, style: { id: style.id, name: style.name }, program, rooms: next, client: intake?.client || user.name }
        const p = cur && EDITABLE.includes(cur.status) ? await api.updateProject(cur.id, { ...body, note: 'Rooms changed' }) : await api.createProject(body)
        projectRef.current = p
        setProject(p)
        setChangesLeft(p.changesLeft ?? CHANGES_PER_PLAN)
        setHistory([...historyFrom(p.versions), ...intro])
        // a lot once sent for a custom design that now has a plan of ours: the request is taken back
        if (p.needsCustom) api.customProject(p.id, { clear: true }).then((q) => ((projectRef.current = q), setProject(q))).catch(() => {})
      } catch {
        setProject(null) // office unreachable: keep drafting in this tab
      }
    }
    go(4)
  }

  // open a saved house where it was left
  const resume = async (id, want = null) => {
    try {
      const p = await api.project(id)
      projectRef.current = p
      setProject(p)
      setIntake({ address: p.address, client: p.client })
      setLot(p.lot && p.lot.envelope ? p.lot : null)
      setStyle(STYLES.find((s) => s.id === p.style?.id) || STYLES.find((s) => s.ready))
      setProgram(p.program && Object.keys(p.program).length ? p.program : DEFAULT_PROGRAM)
      // rooms a homeowner chose are theirs; a saved lot still on the app's default starts at what fits.
      // Round 15 (U11): rooms saved from the rooms step are the ones the homeowner chose and saw, even when they are
      // our default rooms (4 bed, 3 bath, 2,800 sf, office, half bath): they come back exactly, never re-fitted
      const same = ['beds', 'baths', 'garage', 'sqft', 'office', 'halfBath', 'suite2'].every((k) => (p.program?.[k] ?? DEFAULT_PROGRAM[k]) === DEFAULT_PROGRAM[k])
      const chosen = !!p.program && Object.keys(p.program).length > 0 && (p.stage === 'rooms' || p.stage === 'draft')
      setTouched(!!p.version || !same || chosen)
      setAutoNote(false)
      setRooms(p.rooms || [])
      setChangesLeft(p.changesLeft ?? CHANGES_PER_PLAN)
      setHistory(p.status === 'returned' && p.review?.note ? [...historyFrom(p.versions), noteMessage(p)] : historyFrom(p.versions))
      setReturnSeen(p.status === 'returned')
      // a lot saved on its own (round 12, item B) opens where it was left: the style step, or the rooms once a style is chosen
      // (one ready style today: the rooms step, with the lot drawn; with more, the style step until one is chosen)
      const hasLot = !!(p.lot && p.lot.envelope)
      const left = !p.rooms?.length ? (!hasLot ? 1 : (p.style?.id && p.stage === 'rooms') || STYLES.filter((x) => x.ready).length === 1 ? 3 : 2) : EDITABLE.includes(p.status) ? 4 : 5
      // opened from the address bar (a reload, or the browser's Back into another house): the step asked for, as far
      // as this house has got
      go(Number.isInteger(want) && want > 0 ? reach(want, { intake: true, lot: hasLot, style: true, rooms: !!p.rooms?.length, locked: !EDITABLE.includes(p.status) }) : left)
      return true
    } catch (e) {
      if (want === null) alert(t('Could not open that house: {error}', { error: e.message }))
      return false
    }
  }

  // Round 13, item 2: every step has its own address. The browser's Back and Forward move between the homeowner's
  // own steps, and a reload opens the step that was on screen: a saved house from the office, anything earlier
  // from what this tab kept.
  const routed = useRef(false)
  const has = () => ({ intake: !!intake, lot: !!lot, style: !!style, rooms: rooms.length > 0, locked: !!projectRef.current && !EDITABLE.includes(projectRef.current.status) })
  const hasRef = useRef(has)
  hasRef.current = has
  const userRef = useRef(user)
  userRef.current = user
  const fromAddress = async () => {
    const r = readHash(window.location.hash)
    if (r.office) return
    const home = () => window.history.replaceState(null, '', stepHash(0))
    if (r.id && r.id !== projectRef.current?.id) {
      if (!userRef.current || !(await resume(r.id, r.step))) {
        home()
        setStep(0)
      }
      return
    }
    let n = reach(r.step, hasRef.current())
    if (r.step > 0 && n === 0 && !projectRef.current) {
      // nothing in memory (a reload before a house was saved): what the tab kept
      const kept = loadTab()
      if (kept) {
        const st = STYLES.find((x) => x.id === kept.styleId) || null
        setIntake(kept.intake || null)
        setLot(kept.lot && kept.lot.envelope ? kept.lot : null)
        setStyle(st)
        setProgram(kept.program || DEFAULT_PROGRAM)
        setRooms(Array.isArray(kept.rooms) ? kept.rooms : [])
        setHistory(Array.isArray(kept.history) ? kept.history : [])
        setTouched(!!kept.touched)
        if (Number.isFinite(kept.changesLeft)) setChangesLeft(kept.changesLeft)
        n = reach(r.step, { intake: !!kept.intake, lot: !!(kept.lot && kept.lot.envelope), style: !!st, rooms: Array.isArray(kept.rooms) && kept.rooms.length > 0 })
      }
    }
    if (n !== r.step) window.history.replaceState(null, '', stepHash(n, projectRef.current?.id))
    setStep(n)
  }
  useEffect(() => {
    if (user === undefined || routed.current || office) return
    routed.current = true
    fromAddress()
  }, [user === undefined])
  useEffect(() => {
    const on = () => routed.current && fromAddress()
    window.addEventListener('popstate', on)
    return () => window.removeEventListener('popstate', on)
  }, [])
  // the address follows the step: a new entry when the step changes, the same entry when only the house's id arrived
  useEffect(() => {
    if (office || !routed.current) return
    const want = stepHash(step, project?.id)
    const now = window.location.hash
    if (now === want || (step === 0 && (now === '' || now === '#'))) return
    const cur = readHash(now)
    if (cur.office) return
    if (cur.step === step) window.history.replaceState(null, '', want)
    else window.history.pushState(null, '', want)
  }, [step, project?.id])
  // what this tab holds is kept for a reload until the house is saved at the office
  useEffect(() => {
    if (office || !routed.current) return
    if (project?.id || step === 0) return saveTab(null)
    // at once, not a moment later: a reload right after a step is taken must find it
    saveTab({ intake: intake ? { address: intake.address, client: intake.client } : null, lot, styleId: style?.id || null, program, rooms, history, touched, changesLeft })
  }, [step, intake, lot, style, program, rooms, history, project?.id])

  const office = admin || review || lot514
  // the Lot 514 site plan review is a real project: drafters and admins only
  if (lot514 && isDrafter(user)) return <App />
  return (
    <LangProvider force={office ? 'en' : null}>
    <div className="dh">
      {/* round 15 (U13): on the Draft and Send steps a phone's header is one short row and the step's name */}
      <header className={'dh-head' + (!office && (step === 4 || step === 5) ? ' at-plan' : '')}>
        <a className="brand" translate="no" href="#" onClick={(e) => (e.preventDefault(), restart())}>
          <Mark size={24} />
          <span>Draft House</span>
        </a>
        {!office && step > 0 && (
          <ol className="steps">
            {STEPS.map((s, i) => {
              const n = i + 1
              return (
                <li key={s} className={n === step ? 'now' : n < step ? 'done' : ''} onClick={() => n < step && go(n)}>
                  <i>{n}</i>
                  <span>{t(s)}</span>
                </li>
              )
            })}
          </ol>
        )}
        {/* phone: the step names are hidden to fit five numbers; the current one is named under them (round 12, item H) */}
        {!office && step > 0 && (
          <div className="step-name" data-testid="step-name">
            {t('Step {n} of {total} · {name}', { n: step, total: STEPS.length, name: t(STEPS[step - 1]) })}
          </div>
        )}
        <nav className="dh-links">
          <LangSwitch tucked={!!user} />
          {user && (
            <span className="dh-user">
              {!office && (step === 4 || step === 5) && (
                <span className={'dh-credits' + (changesLeft <= 2 ? ' low' : '')} data-testid="changes-left" title={t('Free changes left on this plan. The office adds more.')}>
                  {t('{n} {n|change|changes} left on this plan', { n: changesLeft })}
                </span>
              )}
              <span className="dh-email">{user.email}</span>
              <button className="linkish dh-signout" onClick={logout}>
                {t('Sign out')}
              </button>
              {/* phone (round 12, item H): the email collided with "Sign out"; both sit behind an account button */}
              <details className="dh-account" data-testid="account">
                <summary aria-label={t('Your account')}>
                  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                    <circle cx="12" cy="8.5" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
                    <path d="M4.5 20c.8-3.8 3.9-5.6 7.5-5.6s6.7 1.8 7.5 5.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                </summary>
                <div className="dh-account-menu">
                  <span className="dh-account-email">{user.email}</span>
                  <button className="linkish" onClick={logout}>
                    {t('Sign out')}
                  </button>
                  <LangSwitch place="menu" />
                </div>
              </details>
            </span>
          )}
          {isDrafter(user) && (
            <a className={'dh-link' + (review ? ' on' : '')} href="#/review">
              Review
            </a>
          )}
          {isDrafter(user) && (
            <a className={'dh-link' + (admin ? ' on' : '')} href="#/admin">
              Office
            </a>
          )}
          {isDrafter(user) && (
            <a className={'dh-link' + (lot514 ? ' on' : '')} href="#/lot514" title="The original Lot 514 event-venue site plan (pool, dance floor). A legacy demo, not a client project.">
              Legacy demo
            </a>
          )}
        </nav>
      </header>
      <main className="dh-main">
        <StepBoundary resetKey={step} t={t} onBack={() => go(Math.max(0, step - 1))}>
        {admin && (
          <OfficeGate user={user} onUser={setUser}>
            <Suspense fallback={<p className="muted center-text">Loading the office…</p>}>
              <Admin />
            </Suspense>
          </OfficeGate>
        )}
        {review && (
          <OfficeGate user={user} onUser={setUser}>
            <Suspense fallback={<p className="muted center-text">Loading the review…</p>}>
              <Review user={user} />
            </Suspense>
          </OfficeGate>
        )}
        {lot514 && (
          <OfficeGate user={user} onUser={setUser}>
            <App />
          </OfficeGate>
        )}
        {!office && step === 0 && (
          <Start
            user={user}
            projects={projects}
            onSignedIn={(u) => {
              setUser(u)
              api.projects().then(setProjects).catch(() => {})
            }}
            onSkip={() => {}}
            onResume={resume}
            onNext={(l) => {
              setIntake(l)
              go(1)
              // round 13: the address is saved before a lot is taken, so signing out here loses nothing. One already
              // saved for this address (typed before, never taken) is opened again, not doubled.
              if (user && !l.file && l.address) {
                const same = projects.find((p) => !p.version && !p.lot && String(p.address || '').trim().toLowerCase() === String(l.address).trim().toLowerCase())
                if (same) {
                  projectRef.current = same
                  setProject(same)
                } else saveDraft({ address: l.address }, 'lot', l.client)
              }
            }}
          />
        )}
        {!office && step === 1 && (
          <Lot
            user={user}
            intake={intake}
            lot={lot}
            onNext={(l) => {
              const taken = { ...l, client: intake?.client }
              setLot(taken)
              // another lot: rooms nobody chose go back to the default and are fitted to this lot on the rooms step
              if (!touched) {
                setProgram(DEFAULT_PROGRAM)
                setAutoNote(false)
              }
              go(2)
              // round 15 (U10): the rooms that fit this lot are worked out while the style is picked
              prefetchFit(taken, style || STYLES.find((x) => x.ready))
              // saved now, not at the Draft step: the lot is the homeowner's from here, and a parcel or plat lot is in the drafter's queue
              saveDraft({ lot: taken, program, ...(style ? { style: { id: style.id, name: style.name } } : {}) }, 'style')
            }}
            onBack={() => go(0)}
            onPlatSaved={(platId) => {
              // round 15, B5: a plat uploaded with nothing typed is a house in the drafter's queue at once; a house
              // saved with its address only gets the plat too. A lot already taken keeps its own (it goes with the lot).
              if (!user || projectRef.current?.lot) return
              saveDraft({ platId, ...(intake?.address && !projectRef.current ? { address: intake.address } : {}) }, 'lot')
            }}
          />
        )}
        {!office && step === 2 && (
          <Style
            style={style}
            onPick={setStyle}
            onNext={() => {
              go(3)
              const st = style || STYLES.find((x) => x.ready)
              saveDraft({ lot, program, ...(st ? { style: { id: st.id, name: st.name } } : {}) }, 'rooms')
            }}
            onBack={() => go(1)}
          />
        )}
        {!office && step === 3 && <Program program={program} style={style} lot={lot} onChange={(p) => (setTouched(true), setAutoNote(false), setProgram(p))} onBack={() => go(2)} onNext={enterDraft} project={project} onSendLot={user ? sendLotToDrafter : null} pristine={!touched && !autoNote && !project?.version} autoNote={autoNote} onAuto={(p) => (setProgram(p), setAutoNote(true))} />}
        {!office && step === 4 && (
          <Draft
            style={style}
            program={program}
            rooms={rooms}
            setRooms={setRooms}
            changesLeft={changesLeft}
            setChangesLeft={setChangesLeft}
            history={history}
            setHistory={setHistory}
            project={project}
            setProject={setProject}
            onBack={() => go(3)}
            onNext={() => go(5)}
            lot={lot}
            changesAllowed={project?.changesAllowed ?? CHANGES_PER_PLAN}
            onSendLot={user ? sendLotToDrafter : null}
          />
        )}
        {!office && step === 5 && <Send lot={lot} style={style} program={program} rooms={rooms} history={history} project={project} setProject={setProject} returnSeen={returnSeen} onBackToDraft={backToDraft} onBack={() => go(4)} onRestart={restart} />}
        </StepBoundary>
      </main>
    </div>
    </LangProvider>
  )
}
