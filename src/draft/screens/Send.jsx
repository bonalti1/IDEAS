import { useState } from 'react'
import { Button, Stat, Mark, money, sf } from '../ui.jsx'
import { floorArea } from '../lib/layout.js'

export default function Send({ lot, style, program, rooms, history, onRestart, onBack }) {
  const [sent, setSent] = useState(false)
  const area = floorArea(rooms, program.stories)
  const changes = history.filter((m) => m.who === 'you')

  if (sent)
    return (
      <div className="screen padded narrow center">
        <Mark size={56} />
        <h2>Sent to the drafting team</h2>
        <p className="lede">We have your lot, your layout, and every change you made. A drafter will have the first set to you within 5 business days.</p>
        <div className="card stats">
          <Stat k="What happens next" v="Structure, roof, details, and code check" />
          <Stat k="You will get" v="Floor plans, elevations, a 3D walkthrough" />
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
      <div className="card stats">
        <Stat k="Lot" v={lot?.address} />
        <Stat k="Style" v={style.name} />
        <Stat k="Program" v={`${program.beds} bed · ${program.baths} bath · ${program.garage}-car · ${program.stories} story`} />
        <Stat k="Living area" v={sf(area)} />
        <Stat k="Rough estimate" v={money(area * style.psf + program.garage * 28000)} />
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
        <p className="fine">Drafters see this list with the model, so nothing you asked for gets lost.</p>
      </div>
      <div className="actions">
        <Button ghost onClick={onBack}>
          Keep editing
        </Button>
        <Button primary onClick={() => setSent(true)}>
          Send to drafters
        </Button>
      </div>
    </div>
  )
}
