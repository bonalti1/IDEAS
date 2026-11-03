import { useEffect, useRef, useState } from 'react'
import HouseScene, { CAMERAS } from '../HouseScene.jsx'
import { Button, Stat, money, sf } from '../ui.jsx'
import { applyRequest, floorArea } from '../lib/layout.js'

const SUGGESTIONS = ['Make the kitchen bigger', 'Add a bedroom', 'Bigger primary bath', 'Remove the rear porch', 'Add a half bath']

export default function Draft({ style, program, rooms, setRooms, credits, setCredits, history, setHistory, onNext, onBack }) {
  const [text, setText] = useState('')
  const [view, setView] = useState('3d')
  const [highlight, setHighlight] = useState(null)
  const [roof, setRoof] = useState(true)
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

  const send = (msg) => {
    const q = (msg ?? text).trim()
    if (!q || credits <= 0) return
    const res = applyRequest(q, rooms, program.stories, style)
    setHistory((h) => [...h, { who: 'you', text: q }, { who: 'house', text: res.reply }])
    if (res.applied) {
      setRooms(res.rooms)
      setCredits((c) => c - 1)
      const k = q.toLowerCase()
      const kind = [['primary bath', 'mbath'], ['master bath', 'mbath'], ['primary', 'master'], ['master', 'master'], ['kitchen', 'kitchen'], ['garage', 'garage'], ['living', 'living'], ['dining', 'dining'], ['laundry', 'laundry'], ['rear porch', 'rearPorch'], ['front porch', 'frontPorch'], ['office', 'office'], ['half bath', 'halfbath'], ['bath', 'bath'], ['bed', 'bed']].find(([x]) => k.includes(x))?.[1]
      setHighlight(kind)
      setTimeout(() => setHighlight(null), 1800)
    }
    setText('')
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
            <div key={i} className={'msg ' + m.who}>
              {m.text}
            </div>
          ))}
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
            disabled={credits <= 0}
          />
          <Button primary small type="submit" disabled={!text.trim() || credits <= 0}>
            Change
          </Button>
        </form>
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
