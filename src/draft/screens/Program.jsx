import { Button, Stepper, Stat, money, sf } from '../ui.jsx'
import { LOT_AREA_SF, SETBACK_CORNERS } from '../../data/survey.js'
import { polygonArea } from '../../lib/geometry.js'
import { CITIES } from '../lib/styles.js'

const ENVELOPE_SF = Math.abs(polygonArea(SETBACK_CORNERS))

export default function Program({ program, style, onChange, onNext, onBack }) {
  const city = CITIES.palmview
  const footprint = program.sqft / program.stories + 22 * (10 + program.garage * 11)
  const maxFootprint = Math.min(ENVELOPE_SF, LOT_AREA_SF * city.maxCoverage)
  const fit = footprint / maxFootprint
  const estimate = program.sqft * style.psf + program.garage * 28000
  const set = (k) => (v) => onChange({ ...program, [k]: v })

  return (
    <div className="screen padded narrow">
      <div className="screen-head">
        <h2>What goes in the house?</h2>
        <p className="muted">{style.name}. Change anything later in plain language.</p>
      </div>
      <div className="card">
        <Stepper label="Bedrooms" value={program.beds} min={1} max={7} onChange={set('beds')} />
        <Stepper label="Bathrooms" value={program.baths} min={1} max={6} onChange={set('baths')} />
        <Stepper label="Garage" value={program.garage} min={0} max={4} suffix="-car" onChange={set('garage')} />
        <Stepper label="Stories" value={program.stories} min={1} max={2} onChange={set('stories')} />
        <div className="stepper">
          <span className="stepper-label">Living area</span>
          <div className="stepper-ctl wide">
            <input type="range" min={1400} max={6000} step={100} value={program.sqft} onChange={(e) => set('sqft')(+e.target.value)} />
            <span className="stepper-val">{sf(program.sqft)}</span>
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
