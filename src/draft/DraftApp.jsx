// Draft House client flow. Six steps, all state in memory for now.
// Backend phase replaces: survey parsing, style kits, layout solver,
// the change interpreter, credits, and the drafter handoff.
import { useState } from 'react'
import { Mark } from './ui.jsx'
import Start from './screens/Start.jsx'
import Lot from './screens/Lot.jsx'
import Style from './screens/Style.jsx'
import Program from './screens/Program.jsx'
import Draft from './screens/Draft.jsx'
import Send from './screens/Send.jsx'
import { DEFAULT_PROGRAM, generateRooms } from './lib/layout.js'
import './draft.css'

const STEPS = ['Lot', 'Style', 'Rooms', 'Draft', 'Send']
const CREDITS = 10

export default function DraftApp() {
  const [step, setStep] = useState(0)
  const [lot, setLot] = useState(null)
  const [style, setStyle] = useState(null)
  const [program, setProgram] = useState(DEFAULT_PROGRAM)
  const [rooms, setRooms] = useState([])
  const [credits, setCredits] = useState(CREDITS)
  const [history, setHistory] = useState([])

  const go = (n) => setStep(n)
  const restart = () => {
    setStep(0)
    setLot(null)
    setStyle(null)
    setProgram(DEFAULT_PROGRAM)
    setRooms([])
    setCredits(CREDITS)
    setHistory([])
  }

  return (
    <div className="dh">
      <header className="dh-head">
        <a className="brand" href="#" onClick={(e) => (e.preventDefault(), restart())}>
          <Mark size={24} />
          <span>Draft House</span>
        </a>
        {step > 0 && (
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
        <a className="dh-link" href="#/lot514">
          Drafter view
        </a>
      </header>
      <main className="dh-main">
        {step === 0 && (
          <Start
            onNext={(l) => {
              setLot(l)
              go(1)
            }}
          />
        )}
        {step === 1 && <Lot lot={lot} onNext={() => go(2)} onBack={() => go(0)} />}
        {step === 2 && <Style style={style} onPick={setStyle} onNext={() => go(3)} onBack={() => go(1)} />}
        {step === 3 && (
          <Program
            program={program}
            style={style}
            onChange={setProgram}
            onBack={() => go(2)}
            onNext={() => {
              setRooms(generateRooms(program, style))
              setHistory([])
              go(4)
            }}
          />
        )}
        {step === 4 && (
          <Draft
            style={style}
            program={program}
            rooms={rooms}
            setRooms={setRooms}
            credits={credits}
            setCredits={setCredits}
            history={history}
            setHistory={setHistory}
            onBack={() => go(3)}
            onNext={() => go(5)}
          />
        )}
        {step === 5 && <Send lot={lot} style={style} program={program} rooms={rooms} history={history} onBack={() => go(4)} onRestart={restart} />}
      </main>
    </div>
  )
}
