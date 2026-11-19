import { Button, RoofIcon } from '../ui.jsx'
import { STYLES } from '../lib/styles.js'
import '../scene.css'

export default function Style({ style, onPick, onNext, onBack }) {
  const ready = STYLES.filter((s) => s.ready)
  // round 12, item I: one style can be drafted today. The others were nine greyed-out cards that each said
  // "coming soon"; they are named once now, as small drawn roof marks under one "More styles soon" line
  const soon = STYLES.filter((s) => !s.ready)
  return (
    <div className="screen padded">
      <div className="screen-head">
        <h2>Pick a style</h2>
        <p className="muted">Each style is a kit our drafters built: roof, materials, and how the rooms like to sit together.</p>
      </div>
      <div className={'grid styles' + (ready.length <= 3 ? ' few' : '')}>
        {ready.map((s) => (
          <button key={s.id} className={'style-card' + (style?.id === s.id ? ' picked' : '')} onClick={() => onPick(s)}>
            <RoofIcon roof={s.roof} />
            <span className="style-name">{s.name}</span>
            <span className="style-blurb">{s.blurb}</span>
            <span className="style-psf">ready to draft</span>
          </button>
        ))}
      </div>
      {soon.length > 0 && (
        <div className="styles-soon" data-testid="styles-soon">
          <span className="styles-soon-head">More styles soon</span>
          <ul>
            {soon.map((s) => (
              <li key={s.id}>
                <RoofIcon roof={s.roof} />
                {s.name}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="fine center-text">
        {ready.length === 1 ? `${ready[0].name} is ready to draft today.` : `${ready.length} styles are ready to draft today.`}
        {!style && ' Pick a style to go on.'}
      </p>
      <div className="actions">
        <Button ghost onClick={onBack}>
          Back
        </Button>
        <Button primary disabled={!style} onClick={onNext} title={style ? '' : 'Pick a style first'}>
          {style ? 'Next, rooms' : 'Pick a style to continue'}
        </Button>
      </div>
    </div>
  )
}
