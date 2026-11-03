import { Button, RoofIcon } from '../ui.jsx'
import { STYLES } from '../lib/styles.js'

export default function Style({ style, onPick, onNext, onBack }) {
  return (
    <div className="screen padded">
      <div className="screen-head">
        <h2>Pick a style</h2>
        <p className="muted">Each style is a kit our drafters built: roof, materials, and how the rooms like to sit together.</p>
      </div>
      <div className="grid styles">
        {STYLES.map((s) => (
          <button key={s.id} className={'style-card' + (style?.id === s.id ? ' picked' : '')} onClick={() => onPick(s)}>
            <RoofIcon roof={s.roof} />
            <span className="style-name">{s.name}</span>
            <span className="style-blurb">{s.blurb}</span>
            <span className="style-psf">from ${s.psf}/sf</span>
          </button>
        ))}
      </div>
      <div className="actions">
        <Button ghost onClick={onBack}>
          Back
        </Button>
        <Button primary disabled={!style} onClick={onNext}>
          Next, rooms
        </Button>
      </div>
    </div>
  )
}
