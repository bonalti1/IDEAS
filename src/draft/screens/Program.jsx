import { Button, Stepper, Stat, money, sf } from '../ui.jsx'
import { kitFor, lotOf } from '../lib/layout.js'

const EXTRAS = [
  ['office', 'Office'],
  ['suite2', 'Second suite'],
  ['halfBath', 'Half bath'],
  ['frontPorch', 'Front porch'],
  ['rearPorch', 'Rear porch'],
]

export default function Program({ program, style, lot, onChange, onNext, onBack }) {
  const L = lotOf(lot)
  const kit = kitFor(style)
  const footprint = program.sqft / program.stories + (program.garage ? 22 * kit.rooms.garage.perCar * program.garage : 0)
  const maxFootprint = Math.min(L.envelopeSf, L.areaSf * (L.rules?.maxCoverage ?? 0.5))
  const fit = footprint / maxFootprint
  const estimate = program.sqft * style.psf + program.garage * 28000
  const set = (k) => (v) => onChange({ ...program, [k]: v })
  const toggle = (k) => () => onChange({ ...program, [k]: !program[k] })
  const ref = kit.reference

  return (
    <div className="screen padded narrow">
      <div className="screen-head">
        <h2>What goes in the house?</h2>
        <p className="muted">{style.name}. Change anything later in plain language.</p>
      </div>
      {ref && (
        <button className="preset" onClick={() => onChange({ ...ref.program })}>
          <span>Start from a recent build</span>
          <b>{ref.name}</b>
          <small>
            {ref.program.beds} bed · {ref.program.baths}.5 bath · {sf(ref.livingSf)}
          </small>
        </button>
      )}
      <div className="card">
        <Stepper label="Bedrooms" value={program.beds} min={1} max={7} onChange={set('beds')} />
        <Stepper label="Full bathrooms" value={program.baths} min={1} max={6} onChange={set('baths')} />
        <Stepper label="Garage" value={program.garage} min={0} max={4} suffix="-car" onChange={set('garage')} />
        <Stepper label="Stories" value={program.stories} min={1} max={2} onChange={set('stories')} />
        <div className="stepper">
          <span className="stepper-label">Living area</span>
          <div className="stepper-ctl wide">
            <input type="range" min={1400} max={6000} step={50} value={program.sqft} onChange={(e) => set('sqft')(+e.target.value)} />
            <span className="stepper-val">{sf(program.sqft)}</span>
          </div>
        </div>
        <div className="stepper extras">
          <span className="stepper-label">Extras</span>
          <div className="chips">
            {EXTRAS.map(([k, label]) => (
              <button key={k} className={program[k] ? 'on' : ''} onClick={toggle(k)}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="card stats">
        <Stat k="Footprint on lot" v={sf(footprint)} />
        <div className="meter" aria-label="Lot fit">
          <div className={'meter-fill' + (fit > 1 ? ' over' : fit > 0.85 ? ' tight' : '')} style={{ width: Math.min(100, fit * 100) + '%' }} />
        </div>
        <p className="fine">
          {fit > 1 ? 'Too big for the buildable area. Go up a story or trim square footage.' : fit > 0.85 ? 'Fits, but tight. Yard will be small.' : 'Fits comfortably with yard to spare.'}
        </p>
        <Stat k="Rough estimate" v={money(estimate)} />
        <p className="fine">Based on our recent builds in this style. Lot, permits, and site work not included.</p>
      </div>
      <div className="actions">
        <Button ghost onClick={onBack}>
          Back
        </Button>
        <Button primary disabled={fit > 1} onClick={onNext}>
          Draft my house
        </Button>
      </div>
    </div>
  )
}
