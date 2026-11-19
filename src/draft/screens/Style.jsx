import { Button, RoofIcon } from '../ui.jsx'
import { STYLES } from '../lib/styles.js'

export default function Style({ style, onPick, onNext, onBack }) {
  const ready = STYLES.filter((s) => s.ready)
  return (
    <div className="screen padded">
      <div className="screen-head">
        <h2>Pick a style</h2>
        <p className="muted">Each style is a kit our drafters built: roof, materials, and how the rooms like to sit together.</p>
      </div>
      <div className="grid styles">
        {STYLES.map((s) => (
          <button key={s.id} className={'style-card' + (style?.id === s.id ? ' picked' : '') + (s.ready ? '' : ' soon')} onClick={() => s.ready && onPick(s)} disabled={!s.ready} aria-disabled={!s.ready} title={s.ready ? '' : 'Coming soon: our drafters are finishing this kit'}>
            <RoofIcon roof={s.roof} />
            <span className="style-name">{s.name}</span>
            <span className="style-blurb">{s.blurb}</span>
            <span className={'style-psf' + (s.ready ? '' : ' muted')}>{s.ready ? 'ready to draft' : 'coming soon'}</span>
          </button>
        ))}
      </div>
      <p className="fine center-text">
        {ready.length === 1 ? `${ready[0].name} is ready to draft today; the other styles arrive as our drafters finish their kits.` : `${ready.length} styles are ready to draft; the rest arrive as our drafters finish their kits.`}
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
