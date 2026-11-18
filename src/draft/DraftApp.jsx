// Draft House client flow. Five steps after the start screen. With an account the project is
// saved on the office API (every version, credits, status); without one it lives in this tab.
import React, { useEffect, useState } from 'react'
import App from '../App.jsx'
import { Mark } from './ui.jsx'
import Start from './screens/Start.jsx'
import Lot from './screens/Lot.jsx'
import Style from './screens/Style.jsx'
import Program from './screens/Program.jsx'
import Draft from './screens/Draft.jsx'
import Send from './screens/Send.jsx'
import Admin from './screens/Admin.jsx'
import Review from './screens/Review.jsx'
import SignIn from './screens/SignIn.jsx'
import { DEFAULT_PROGRAM, starterDraft } from './lib/layout.js'
import { STYLES } from './lib/styles.js'
import { api } from './lib/api.js'
import { currentUser, onAuthChange, signOut } from './lib/auth.js'
import { EDITABLE, historyFrom } from './lib/status.js'
import './draft.css'

const STEPS = ['Lot', 'Style', 'Rooms', 'Draft', 'Send']

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
    return (
      <div className="screen padded narrow center">
        <div className="card signin">
          <h3>Something went wrong on this step</h3>
          <p className="muted small">{String(this.state.error?.message || this.state.error)}</p>
          <button className="btn btn-primary" onClick={() => this.setState({ error: null })}>
            Try again
          </button>{' '}
          <button className="btn btn-ghost" onClick={() => this.props.onBack?.()}>
            Go back a step
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
      </div>
    )
  if (!isDrafter(user))
    return (
      <div className="screen padded narrow center">
        <div className="card signin">
          <h3>Not a drafter account</h3>
          <p className="muted small">{user.email} is a client account. Ask the office to make it a drafter, or sign in with another email.</p>
          <button className="linkish" onClick={() => signOut().then(() => onUser(null))}>
            Sign out
          </button>
        </div>
      </div>
    )
  return children
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
  const restart = () => {
    setStep(0)
    setProject(null)
    setIntake(null)
    setLot(null)
    setStyle(null)
    setProgram(DEFAULT_PROGRAM)
    setRooms([])
    setChangesLeft(CHANGES_PER_PLAN)
    setHistory([])
    setReturnSeen(false)
    if (user) api.projects().then(setProjects).catch(() => {})
  }
  const noteMessage = (p) => ({ who: 'house', text: `Note from ${p.review?.drafter || 'your drafter'}: ${p.review?.note}`, applied: true, source: 'undo' })
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

  // Rooms → Draft: a fresh layout; saved as a project (or a new free version of one) when signed in
  const enterDraft = async () => {
    const d = starterDraft(program, style, lot)
    const next = d.rooms
    // what the draft had to do to fit: said once, up front
    const notes = []
    if (d.clamped) notes.push(`With these rooms the plan does not go under ${Math.round(d.minSqft).toLocaleString()} sf, so that is the size you see.`)
    if (d.fitScale < 0.995) notes.push(`We trimmed it about ${Math.round((1 - d.fitScale) * 100)}% to keep it inside the setbacks on this lot.`)
    const intro = notes.length ? [{ who: 'house', text: `Here is your first draft. ${notes.join(' ')}`, applied: true, source: 'undo' }] : []
    setRooms(next)
    setHistory(intro)
    if (user) {
      try {
        const body = { lot, style: { id: style.id, name: style.name }, program, rooms: next, client: intake?.client || user.name }
        const p = project && EDITABLE.includes(project.status) ? await api.updateProject(project.id, { ...body, note: 'Rooms changed' }) : await api.createProject(body)
        setProject(p)
        setChangesLeft(p.changesLeft ?? CHANGES_PER_PLAN)
        setHistory([...historyFrom(p.versions), ...intro])
      } catch {
        setProject(null) // office unreachable: keep drafting in this tab
      }
    }
    go(4)
  }

  // open a saved house where it was left
  const resume = async (id) => {
    try {
      const p = await api.project(id)
      setProject(p)
      setIntake({ address: p.address, client: p.client })
      setLot(p.lot && p.lot.envelope ? p.lot : null)
      setStyle(STYLES.find((s) => s.id === p.style?.id) || STYLES.find((s) => s.ready))
      setProgram(p.program || DEFAULT_PROGRAM)
      setRooms(p.rooms)
      setChangesLeft(p.changesLeft ?? CHANGES_PER_PLAN)
      setHistory(p.status === 'returned' && p.review?.note ? [...historyFrom(p.versions), noteMessage(p)] : historyFrom(p.versions))
      setReturnSeen(p.status === 'returned')
      go(EDITABLE.includes(p.status) ? 4 : 5)
    } catch (e) {
      alert(`Could not open that house: ${e.message}`)
    }
  }

  const office = admin || review || lot514
  // the Lot 514 site plan review is a real project: drafters and admins only
  if (lot514 && isDrafter(user)) return <App />
  return (
    <div className="dh">
      <header className="dh-head">
        <a className="brand" href="#" onClick={(e) => (e.preventDefault(), restart())}>
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
                  <span>{s}</span>
                </li>
              )
            })}
          </ol>
        )}
        <nav className="dh-links">
          {user && (
            <span className="dh-user">
              {!office && (step === 4 || step === 5) && (
                <span className="dh-credits" title="Free changes left on this plan. The office adds more.">
                  {changesLeft} change{changesLeft === 1 ? '' : 's'} left on this plan
                </span>
              )}
              {user.email}
              <button className="linkish" onClick={logout}>
                Sign out
              </button>
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
        <StepBoundary resetKey={step} onBack={() => go(Math.max(0, step - 1))}>
        {admin && (
          <OfficeGate user={user} onUser={setUser}>
            <Admin />
          </OfficeGate>
        )}
        {review && (
          <OfficeGate user={user} onUser={setUser}>
            <Review user={user} />
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
            }}
          />
        )}
        {!office && step === 1 && (
          <Lot
            intake={intake}
            lot={lot}
            onNext={(l) => {
              setLot({ ...l, client: intake?.client })
              go(2)
            }}
            onBack={() => go(0)}
          />
        )}
        {!office && step === 2 && <Style style={style} onPick={setStyle} onNext={() => go(3)} onBack={() => go(1)} />}
        {!office && step === 3 && <Program program={program} style={style} lot={lot} onChange={setProgram} onBack={() => go(2)} onNext={enterDraft} />}
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
          />
        )}
        {!office && step === 5 && <Send lot={lot} style={style} program={program} rooms={rooms} history={history} project={project} setProject={setProject} returnSeen={returnSeen} onBackToDraft={backToDraft} onBack={() => go(4)} onRestart={restart} />}
        </StepBoundary>
      </main>
    </div>
  )
}
