import { Button, RoofIcon } from '../ui.jsx'
import { STYLES } from '../lib/styles.js'
import '../scene.css'
import { useLang } from '../lib/i18n.js'

export default function Style({ style, onPick, onNext, onBack }) {
  const { t } = useLang()
  const ready = STYLES.filter((s) => s.ready)
  // round 12, item I: one style can be drafted today. The others were nine greyed-out cards that each said
  // "coming soon"; they are named once now, as small drawn roof marks under one "More styles soon" line
  const soon = STYLES.filter((s) => !s.ready)
  return (
    <div className="screen padded">
      <div className="screen-head">
        <h2>{t('Pick a style')}</h2>
        <p className="muted">{t('Each style is a kit our drafters built: roof, materials, and how the rooms like to sit together.')}</p>
      </div>
      <div className={'grid styles' + (ready.length <= 3 ? ' few' : '')}>
        {ready.map((s) => (
          <button key={s.id} className={'style-card' + (style?.id === s.id ? ' picked' : '')} data-testid={'style-' + s.id} onClick={() => onPick(s)}>
            <RoofIcon roof={s.roof} />
            <span className="style-name">{t(s.name)}</span>
            <span className="style-blurb">{t(s.blurb)}</span>
            <span className="style-psf">{t('ready to draft')}</span>
          </button>
        ))}
      </div>
      {soon.length > 0 && (
        <div className="styles-soon" data-testid="styles-soon">
          <span className="styles-soon-head">{t('More styles soon')}</span>
          <ul>
            {soon.map((s) => (
              <li key={s.id}>
                <RoofIcon roof={s.roof} />
                {t(s.name)}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="fine center-text">
        {ready.length === 1 ? t('{name} is ready to draft today.', { name: t(ready[0].name) }) : t('{n} styles are ready to draft today.', { n: ready.length })}
        {!style && ` ${t('Pick a style to go on.')}`}
      </p>
      <div className="actions">
        <Button ghost onClick={onBack}>
          {t('Back')}
        </Button>
        <Button primary disabled={!style} onClick={onNext} title={style ? '' : t('Pick a style first')}>
          {style ? t('Next, rooms') : t('Pick a style to continue')}
        </Button>
      </div>
    </div>
  )
}
