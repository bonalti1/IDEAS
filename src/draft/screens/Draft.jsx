import { useEffect, useRef, useState } from 'react'
import HouseScene, { CAMERAS } from '../HouseScene.jsx'
import { Button, Stat, money, sf } from '../ui.jsx'
import { floorArea } from '../lib/layout.js'
import { interpretRequest } from '../lib/interpret.js'
import { api } from '../lib/api.js'

const SUGGESTIONS = ['Make the kitchen bigger', 'Add a bedroom', 'Bigger primary bath', 'Remove the rear porch', 'Add a half bath']

export default function Draft({ style, program, rooms, setRooms, credits, setCredits, history, setHistory, onNext, onBack, lot, project, setProject }) {
  const [text, setText] = useState('')
  const [view, setView] = useState('3d')
  const [highlight, setHighlight] = useState(null)
  const [busy, setBusy] = useState(false)
  const [undo, setUndo] = useState([]) // snapshots before each applied change: { rooms, credits, text }
  const [roof, setRoof] = useState(true)
  const [showVersions, setShowVersions] = useState(false)
  const controls = useRef()
  const logRef = useRef()

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [history])

  const setCamera = (name) => {
    setView(name)
    const c = controls.current
    if (!c) return
    const { position, target } = CAMERAS[name]
    c.object.position.set(...position)
    c.target.set(...target)
    c.update()
  }

  const send = async (msg) => {
    const q = (msg ?? text).trim()
    if (!q || credits <= 0 || busy) return
    setText('')
    setBusy(true)
    setHistory((h) => [...h, { who: 'you', text: q }])
    let res
    try {
      if (project) {
        // the office runs the change, checks the rules and takes the credit only when it applies
        const r = await api.change(project.id, q)
        res = r
        if (r.applied) setProject((p) => ({ ...p, credits: r.credits, version: r.version, versions: [...(p.versions || []), { n: r.version, kind: 'change', text: q, credit: 1, at: new Date().toISOString() }] }))
      } else res = await interpretRequest(q, rooms, program, style, { lot })
    } catch (e) {
      res = e.status === 402 ? { applied: false, reply: 'No changes left on this design.', source: 'claude', credits: 0 } : e.status === 409 ? { applied: false, reply: 'This design is with the drafters now, so it cannot change.', source: 'claude' } : { applied: false, reply: 'Something went wrong on our side. Try again in a moment.', source: 'fallback' }
    }
    setBusy(false)
    setHistory((h) => [...h, { who: 'house', text: res.reply, source: res.source, applied: res.applied }])
    if (res.credits !== undefined) setCredits(res.credits)
    if (res.applied) {
      if (!project) {
        setUndo((u) => [...u, { rooms, credits, text: q }])
        setCredits((c) => c - 1)
      }
      setRooms(res.rooms)
      const kind = res.ops?.[0]?.op === 'add' ? res.ops[0].kind : rooms.find((r) => r.id === res.ops?.[0]?.room)?.kind
      setHighlight(kind || null)
      setTimeout(() => setHighlight(null), 1800)
    }
  }

  // back to an earlier saved version; credits spent after it come back
  const restore = async (n) => {
    if (!project || busy) return
    setBusy(true)
    try {
      const p = await api.rollback(project.id, n)
      setProject(p)
      setRooms(p.rooms)
      setCredits(p.credits)
      setHistory((h) => [...h, { who: 'house', text: `Back to version ${n}.${p.refunded ? ` ${p.refunded} credit${p.refunded === 1 ? '' : 's'} returned.` : ''}`, applied: true, source: 'undo' }])
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
    setCredits(snap.credits) // the credit comes back
    setHistory((h) => [...h, { who: 'house', text: `Undid "${snap.text}". Credit returned.`, applied: true, source: 'undo' }])
  }

  const area = floorArea(rooms, program.stories)
  const estimate = area * style.psf + program.garage * 28000

  return (
    <div className="screen split">
      <div className="viewport">
        <HouseScene rooms={rooms} style={style} view={view} highlightKind={highlight} controlsRef={controls} showRoof={roof} />
        <div className="viewport-tag">
          {style.name} · {program.beds} bed · {program.baths}
          {program.halfBath ? '.5' : ''} bath · {program.stories === 2 ? 'two story' : 'one story'}
        </div>
        <div className="viewport-views">
          <button className={view === 'top' ? 'on' : ''} onClick={() => setCamera('top')}>
            Plan
          </button>
          <button className={view === '3d' ? 'on' : ''} onClick={() => setCamera('3d')}>
            3D
          </button>
          <label className={'check' + (view === 'top' ? ' off' : '')}>
            <input type="checkbox" checked={roof} onChange={(e) => setRoof(e.target.checked)} disabled={view === 'top'} />
            Roof
          </label>
        </div>
      </div>
      <aside className="side chat">
        <div className="side-head">
          <h2>Shape it</h2>
          {!project && <span className="muted small">not saved</span>}
          <span className={'credits' + (credits <= 2 ? ' low' : '')}>
            {credits} change{credits === 1 ? '' : 's'} left
          </span>
        </div>
        <div className="stats row2">
          <Stat k="Living area" v={sf(area)} />
          <Stat k="Estimate" v={money(estimate)} />
        </div>
        <div className="log" ref={logRef}>
          {history.length === 0 && (
            <div className="msg house">
              Here is your first draft. Tell me what to change, like you would tell a designer.
            </div>
          )}
          {history.map((m, i) => (
            <div key={i} className={'msg ' + m.who + (m.applied === false && m.who === 'house' ? ' held' : '')}>
              {m.text}
              {m.who === 'house' && m.source === 'fallback' && <span className="src"> · basic rules, assistant offline</span>}
              {m.who === 'house' && m.source === 'timeout' && <span className="src"> · basic rules, assistant took too long</span>}
            </div>
          ))}
          {busy && <div className="msg house thinking">Working on it…</div>}
        </div>
        <div className="chips">
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => send(s)} disabled={credits <= 0}>
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
            placeholder={credits > 0 ? 'Move the laundry next to the primary closet…' : 'No changes left. Approve or buy more.'}
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={credits <= 0 || busy}
          />
          <Button primary small type="submit" disabled={!text.trim() || credits <= 0 || busy}>
            Change
          </Button>
        </form>
        <div className="chat-tools">
          {project && versions.length > 1 && (
            <button className="linkish" onClick={() => setShowVersions((v) => !v)}>
              {showVersions ? 'Hide history' : `History (${versions.length})`}
            </button>
          )}
          {canUndo && (
            <button className="linkish undo" onClick={undoLast} disabled={busy}>
              Undo last change
            </button>
          )}
        </div>
        {project && showVersions && (
          <ol className="versions">
            {versions.map((v) => (
              <li key={v.n} className={v.n === project.version ? 'now' : ''}>
                <span className="v-n">v{v.n}</span>
                <span className="v-text">
                  {v.text}
                  {v.refunded ? <span className="muted"> · undone</span> : v.credit ? <span className="muted"> · 1 credit</span> : null}
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
