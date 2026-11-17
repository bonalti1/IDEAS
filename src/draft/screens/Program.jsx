import { useMemo } from 'react'
import { Button, Stepper, Stat, money, sf } from '../ui.jsx'
import { kitFor, lotOf, programLimits } from '../lib/layout.js'
import { fitsLot } from '../lib/fit.js'
import { estimate as priceOf, range, rateLine } from '../lib/pricing.js'

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
  const limits = programLimits(style)
  const footprint = program.sqft / program.stories + (program.garage ? 22 * kit.rooms.garage.perCar * program.garage : 0)
  const maxFootprint = Math.min(L.envelopeSf, L.areaSf * (L.rules?.maxCoverage ?? 0.5))
  const fit = footprint / maxFootprint
  const price = priceOf({ program, style, lot })
  const set = (k) => (v) => onChange({ ...program, [k]: v })
  const toggle = (k) => () => onChange({ ...program, [k]: !program[k] })
  const ref = kit.reference
  const matchesRef = !!ref && ['beds', 'baths', 'halfBath', 'suite2', 'office', 'garage', 'stories', 'sqft', 'frontPorch', 'rearPorch'].every((k) => (program[k] ?? false) === (ref.program[k] ?? false))
  // the real check: the first draft is drafted and run through the rules on this lot
  const check = useMemo(() => fitsLot(program, style, L), [program, style, L])
  const minSqft = check.draft.minSqft || limits.sqft[0]
  const trimmed = check.ok && check.draft.fitScale < 0.995 ? Math.round((1 - check.draft.fitScale) * 100) : 0
  const oneStory = limits.stories[1] === 1

  return (
    <div className="screen padded narrow">
      <div className="screen-head">
        <h2>What goes in the house?</h2>
        <p className="muted">{style.name}. Change anything later in plain language.</p>
      </div>
      {ref && (
        <button className={'preset' + (matchesRef ? ' on' : '')} onClick={() => onChange({ ...ref.program })} aria-pressed={matchesRef}>
          <span>{matchesRef ? 'Rooms set to a recent build' : 'Use the rooms of a recent build'}</span>
          <b>{ref.name}</b>
          <small>
            {ref.program.beds} bed · {ref.program.baths}
            {ref.program.halfBath ? '.5' : ''} bath · {ref.program.garage ? `${ref.program.garage}-car · ` : 'no garage · '}
            {sf(ref.livingSf)}
            {matchesRef ? ' · this is what you will get' : ' · tap to set the rooms below to this; the rooms below are what you will get'}
          </small>
        </button>
      )}
      <div className="card">
        <Stepper label="Bedrooms" value={program.beds} min={limits.beds[0]} max={limits.beds[1]} onChange={set('beds')} />
        <Stepper label="Full bathrooms" value={program.baths} min={limits.baths[0]} max={limits.baths[1]} onChange={set('baths')} />
        <Stepper label="Garage" value={program.garage} min={limits.garage[0]} max={limits.garage[1]} suffix="-car" onChange={set('garage')} />
        {oneStory ? (
          <div className="stepper">
            <span className="stepper-label">Stories</span>
            <span className="muted small">1 · this style's kit is a one-story plan; two-story styles come with their kits</span>
          </div>
        ) : (
          <Stepper label="Stories" value={program.stories} min={limits.stories[0]} max={limits.stories[1]} onChange={set('stories')} />
        )}
        <div className="stepper">
          <span className="stepper-label">Living area</span>
          <div className="stepper-ctl wide">
            <input type="range" min={limits.sqft[0]} max={limits.sqft[1]} step={50} value={program.sqft} onChange={(e) => set('sqft')(+e.target.value)} aria-label="Living area" />
            <span className="stepper-val">{sf(program.sqft)}</span>
          </div>
        </div>
        {check.draft.clamped && (
          <p className="fine warn">
            With these rooms the plan does not go under {sf(minSqft)}; that is what we will draft.{' '}
            <button className="linkish" onClick={() => set('sqft')(minSqft)}>
              Set {sf(minSqft)}
            </button>
          </p>
        )}
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
          <div className={'meter-fill' + (!check.ok ? ' over' : fit > 0.85 || trimmed ? ' tight' : '')} style={{ width: Math.min(100, fit * 100) + '%' }} />
        </div>
        {check.ok ? (
          <p className="fine">{trimmed ? `Fits once trimmed about ${trimmed}% to stay inside the setbacks on this lot.` : 'Passes the setback, size and coverage rules on this lot.'}</p>
        ) : (
          <p className="fine bad">
            Does not fit this lot: {check.reasons[0]}
            {check.maxSqft ? (
              <>
                {' '}
                The largest this plan fits here is {sf(check.maxSqft)}.{' '}
                <button className="linkish" onClick={() => set('sqft')(check.maxSqft)}>
                  Use {sf(check.maxSqft)}
                </button>
              </>
            ) : check.suggestion ? (
              <>
                {' '}
                It fits {check.suggestion.label}.{' '}
                <button className="linkish" onClick={() => onChange(check.suggestion.program)}>
                  Try that
                </button>
              </>
            ) : check.need ? (
              ` This style's smallest plan is about ${check.need.houseWidth} by ${check.need.houseDepth} ft; the buildable area here is ${check.need.lotWidth} by ${check.need.lotDepth} ft. It needs a wider lot, or another style once more kits are ready.`
            ) : (
              ' Try fewer rooms or a smaller garage.'
            )}
          </p>
        )}
        <Stat k={price.confirmed ? 'Price range' : 'Estimate'} v={range(price)} />
        <p className="fine">
          {rateLine(price)} · {price.county}. {price.note}
        </p>
      </div>
      <div className="actions">
        <Button ghost onClick={onBack}>
          Back
        </Button>
        <Button primary disabled={!check.ok} onClick={onNext} title={check.ok ? '' : 'Make it fit the lot first'}>
          Draft my house
        </Button>
      </div>
    </div>
  )
}
