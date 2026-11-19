import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Stepper, Stat } from '../ui.jsx'
import { kitFor, lotOf, programLimits } from '../lib/layout.js'
import { fitsLot, startFrom } from '../lib/fit.js'
import { turnLot, insideRect } from '../lib/lot.js'
import { plainReason } from '../lib/plain.js'
import { floorArea } from '../lib/layout.js'
import { useLang, phrase } from '../lib/i18n.js'

const EXTRAS = [
  ['office', phrase('Office')],
  ['suite2', phrase('Second suite')],
  ['halfBath', phrase('Half bath')],
  ['frontPorch', phrase('Front porch')],
  ['rearPorch', phrase('Rear porch')],
]

// one worker for the screen; a fit check that is still running when the next tap comes is simply ignored
let worker = null
let seq = 0
const pending = new Map()
function workerFor() {
  if (worker !== null) return worker
  try {
    if (typeof Worker === 'undefined') throw new Error('no Worker')
    worker = new Worker(new URL('../lib/fit.worker.js', import.meta.url), { type: 'module' })
    worker.onmessage = (e) => {
      const p = pending.get(e.data?.id)
      if (!p) return
      pending.delete(e.data.id)
      e.data.error ? p.reject(new Error(e.data.error)) : p.resolve(e.data.check)
    }
    worker.onerror = () => {
      // the worker could not load (an old browser, a blocked script): every waiting check falls back to the main thread
      for (const p of pending.values()) p.reject(new Error('worker failed'))
      pending.clear()
      worker = false
    }
  } catch {
    worker = false
  }
  return worker
}
const checkInWorker = (program, style, lot) =>
  new Promise((resolve, reject) => {
    const w = workerFor()
    if (!w) return reject(new Error('no worker'))
    const id = ++seq
    pending.set(id, { resolve, reject })
    w.postMessage({ id, program, styleId: style?.id, lot })
  })

/**
 * The fit check for the rooms step, run in a worker so the screen keeps painting: { check, checking }.
 * The last answer stays on screen while the next one is drawn; with no worker the check runs inline.
 */
function useFitCheck(program, style, L) {
  const [state, setState] = useState({ check: null, checking: true })
  const latest = useRef(0)
  useEffect(() => {
    const n = ++latest.current
    let alive = true
    setState((s) => ({ ...s, checking: true }))
    checkInWorker(program, style, L)
      .catch(() => fitsLot(program, style, L))
      .then((check) => {
        if (alive && latest.current === n) setState({ check, checking: false })
      })
    return () => {
      alive = false
    }
  }, [program, style, L])
  return state
}

/**
 * The lot, drawn small: its outline, the space the city lets you build on (dashed) and the street side. The rooms
 * step had no picture of the lot at all; a homeowner who comes back to a saved lot sees it is theirs (round 12, item B).
 */
function LotThumb({ lot }) {
  const { t } = useLang()
  const B = lot?.boundary || []
  if (B.length < 3) return null
  const xs = B.map((p) => p[0])
  const zs = B.map((p) => p[1])
  const pad = 6
  const x0 = Math.min(...xs) - pad
  const z0 = Math.min(...zs) - pad
  const w = Math.max(...xs) - Math.min(...xs) + pad * 2
  const h = Math.max(...zs) - Math.min(...zs) + pad * 2
  const pts = (poly) => poly.map(([x, z]) => `${(x - x0).toFixed(1)},${(z - z0).toFixed(1)}`).join(' ')
  const fronts = (lot.edges || []).filter((e) => e.kind === 'front')
  const stroke = Math.max(w, h) / 90
  return (
    <svg className="lot-thumb" data-testid="lot-thumb" viewBox={`0 0 ${w.toFixed(1)} ${h.toFixed(1)}`} role="img" aria-label={t('Your lot, drawn from above')}>
      <polygon points={pts(B)} fill="#eceae5" stroke="#c8102e" strokeWidth={stroke} strokeLinejoin="round" />
      {(lot.envelope || []).length >= 3 && <polygon points={pts(lot.envelope)} fill="#f7f5ef" stroke="#1f8a3b" strokeWidth={stroke * 0.8} strokeDasharray={`${stroke * 4} ${stroke * 3}`} />}
      {fronts.map((e) => {
        const a = (lot.corners || B)[e.index]
        const b = (lot.corners || B)[(e.index + 1) % (lot.corners || B).length]
        return a && b ? <line key={e.index} x1={a[0] - x0} y1={a[1] - z0} x2={b[0] - x0} y2={b[1] - z0} stroke="#3b3f4a" strokeWidth={stroke * 2.2} strokeLinecap="round" /> : null
      })}
    </svg>
  )
}

export default function Program({ program, style, lot, onChange, onNext, onBack, project = null, onSendLot = null, pristine = false, onAuto = null, autoNote = false }) {
  // the fit always starts from the lot square to the street and says what turn (if any) makes the plan fit (round 12, item A)
  const { t, say, sf } = useLang()
  const L = useMemo(() => turnLot(lotOf(lot), 0), [lot])
  const [sendState, setSendState] = useState(project?.needsCustom ? 'sent' : 'idle') // idle | sending | sent | an error line
  const sendLot = async () => {
    if (!onSendLot) return setSendState(t('Sign in first, so we can save your lot and send it to a drafter.'))
    setSendState('sending')
    try {
      await onSendLot()
      setSendState('sent')
    } catch (e) {
      setSendState(say(e.message) || t('We could not reach the office. Try again in a minute.'))
    }
  }
  const kit = kitFor(style)
  const limits = programLimits(style)
  const footprint = program.sqft / program.stories + (program.garage ? 22 * kit.rooms.garage.perCar * program.garage : 0)
  const maxFootprint = Math.min(L.envelopeSf, L.areaSf * (L.rules?.maxCoverage ?? 0.5))
  const fit = footprint / maxFootprint
  const set = (k) => (v) => onChange({ ...program, [k]: v })
  const toggle = (k) => () => onChange({ ...program, [k]: !program[k] })
  const ref = kit.reference
  const matchesRef = !!ref && ['beds', 'baths', 'halfBath', 'suite2', 'office', 'garage', 'stories', 'sqft', 'frontPorch', 'rearPorch'].every((k) => (program[k] ?? false) === (ref.program[k] ?? false))
  // the real check: the first draft is drafted and run through the rules on this lot, in a worker (round 8: the
  // narrow lot's check took seconds and froze every tap); until the first answer the meter says it is checking
  const { check: checked, checking } = useFitCheck(program, style, L)
  const check = checked || { ok: false, checking: true, reasons: [], draft: { minSqft: 0, clamped: false, fitScale: 1, rooms: [] }, maxSqft: null, suggestion: null, need: null }
  // the sample card shows what its draft comes out to, not the sheet's number
  const sample = useMemo(() => (ref ? fitsLot({ ...ref.program }, style, L) : null), [ref, style, L])
  // round 12, item E: the rooms nobody has chosen yet start at what fits this lot. Until the homeowner changes
  // something, a default that does not fit is replaced by the fit's own answer, and never shown as "does not fit".
  const startWith = pristine && checked && !checking ? startFrom(checked, program) : null
  useEffect(() => {
    if (startWith && onAuto) onAuto(startWith)
  }, [startWith && JSON.stringify(startWith)])
  const settling = pristine && (!checked || checking || !!startWith)
  const minSqft = check.draft.minSqft || limits.sqft[0]
  const trimmed = check.ok && check.draft.fitScale < 0.995 ? Math.round((1 - check.draft.fitScale) * 100) : 0
  const oneStory = limits.stories[1] === 1
  const room = useMemo(() => insideRect(L), [L])

  return (
    <div className="screen padded narrow">
      <div className="screen-head">
        <h2>{t('What goes in the house?')}</h2>
        <p className="muted">{t('{style}. Change anything later in plain language.', { style: t(style.name) })}</p>
      </div>
      {lot?.spec && lot.spec.kind !== 'reference' && (
        <div className="lot-strip" data-testid="lot-strip">
          <LotThumb lot={lot} />
          <div>
            <b>{String(lot.address || lot.spec.address || t('Your lot')).split(',')[0]}</b>
            <p className="muted small">
              {t('{area} sf lot. The largest house that fits the space you can build on is about {w} by {d} ft.', { area: Math.round(lot.areaSf).toLocaleString(), w: Math.floor(room.w), d: Math.floor(room.d) })}
            </p>
          </div>
        </div>
      )}
      {ref && (
        <button className={'preset' + (matchesRef ? ' on' : '')} onClick={() => onChange({ ...ref.program })} aria-pressed={matchesRef}>
          <span>{matchesRef ? t('Rooms set to a recent build') : t('Use the rooms of a recent build')}</span>
          <b>{t(ref.name)}</b>
          <small>
            {[t('{n} bed', { n: ref.program.beds }), t('{n} bath', { n: `${ref.program.baths}${ref.program.halfBath ? '.5' : ''}` }), ref.program.suite2 ? t('mini primary') : null, ref.program.office ? t('office') : null, ref.program.garage ? t('{n}-car garage', { n: ref.program.garage }) : t('no garage'), ref.program.frontPorch && ref.program.rearPorch ? t('front and rear porches') : ref.program.frontPorch ? t('front porch') : ref.program.rearPorch ? t('rear porch') : null, ref.program.stories === 2 ? t('two story') : t('one story')].filter(Boolean).join(' · ')}
            {sample?.ok && sample.draft?.rooms?.length ? ` · ${sf(floorArea(sample.draft.rooms, ref.program.stories || 1))}` : ` · ${sf(ref.livingSf)}`}
            {matchesRef ? ` · ${t('this is what you will get')}` : ` · ${t('tap to set the rooms below to this; the rooms below are what you will get')}`}
          </small>
        </button>
      )}
      <div className="card">
        <Stepper label={t('Bedrooms')} value={program.beds} min={limits.beds[0]} max={limits.beds[1]} onChange={set('beds')} />
        <Stepper label={t('Full bathrooms')} value={program.baths} min={limits.baths[0]} max={limits.baths[1]} onChange={set('baths')} />
        <Stepper label={t('Garage')} value={program.garage} min={limits.garage[0]} max={limits.garage[1]} suffix={t('{n|-car|-car}', { n: program.garage })} onChange={set('garage')} />
        {oneStory ? (
          <div className="stepper">
            <span className="stepper-label">{t('Stories')}</span>
            <span className="muted small">{t("1 · this style's kit is a one-story plan; two-story styles come with their kits")}</span>
          </div>
        ) : (
          <Stepper label={t('Stories')} value={program.stories} min={limits.stories[0]} max={limits.stories[1]} onChange={set('stories')} />
        )}
        <div className="stepper">
          <span className="stepper-label">{t('Living area')}</span>
          <div className="stepper-ctl wide">
            <input type="range" min={limits.sqft[0]} max={limits.sqft[1]} step={50} value={program.sqft} onChange={(e) => set('sqft')(+e.target.value)} aria-label={t('Living area')} />
            <span className="stepper-val">{sf(program.sqft)}</span>
          </div>
        </div>
        {check.draft.clamped && (
          <p className="fine warn">
            {t('With these rooms the plan does not go under {size}; that is what we will draft.', { size: sf(minSqft) })}{' '}
            <button className="linkish" onClick={() => set('sqft')(minSqft)}>
              {t('Set {size}', { size: sf(minSqft) })}
            </button>
          </p>
        )}
        <div className="stepper extras">
          <span className="stepper-label">{t('Extras')}</span>
          <div className="chips">
            {EXTRAS.map(([k, label]) => (
              <button key={k} className={program[k] ? 'on' : ''} onClick={toggle(k)}>
                {t(label)}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="card stats">
        <Stat k={t('Footprint on lot')} v={sf(footprint)} />
        <div className="meter" aria-label={t('Lot fit')}>
          <div className={'meter-fill' + (!check.ok ? ' over' : fit > 0.85 || trimmed ? ' tight' : '')} style={{ width: Math.min(100, fit * 100) + '%' }} />
        </div>
        {/* the last clause: right after we started the homeowner with what fits, the answer still on hand is the one for
            the rooms we replaced; its "does not fit, try that" must not flash while the new rooms are checked */}
        {(checking && !checked) || (settling && !check.ok && !check.deadEnd) || (checking && autoNote && !check.ok && !check.deadEnd) ? (
          <p className="muted fit-note">{t('Checking the lot…')}</p>
        ) : check.ok ? (
          <p className="fine">
            {trimmed ? t('Fits once trimmed about {pct}% to keep the space the city requires along the edges of this lot.', { pct: trimmed }) : t("Fits this lot and the city's rules for it.")}
            {check.turn ? ` ${t('The house is turned {deg}° from square to the street, to sit in the widest part of your lot.', { deg: Math.abs(check.turn) })}` : ''}
            {autoNote && <span data-testid="auto-start"> {t('We started you with what fits this lot; you can change it.')}</span>}
            {checking && <span className="muted fit-note"> {t('Checking the lot…')}</span>}
          </p>
        ) : (
          <p className="fine bad">
            {checking && <span className="muted fit-note">{t('Checking the lot…')} </span>}
            {t('Does not fit this lot: {reason}', { reason: say(plainReason(check.reasons[0])) })}
            {check.maxSqft ? (
              <>
                {' '}
                {t('The largest this plan fits here is {size}.', { size: sf(check.maxSqft) })}{' '}
                <button className="linkish" onClick={() => onChange({ ...program, sqft: check.maxSqft, asked: program.asked || { ...program, asked: undefined } })}>
                  {t('Use {size}', { size: sf(check.maxSqft) })}
                </button>
              </>
            ) : check.suggestion ? (
              <>
                {' '}
                {t('It fits {how}.', { how: say(check.suggestion.label) })}{' '}
                <button className="linkish" onClick={() => onChange({ ...check.suggestion.program, asked: program.asked || { ...program, asked: undefined } })}>
                  {t('Try that')}
                </button>
              </>
            ) : check.need ? (
              ` ${t('Our smallest plan is about {hw} by {hd} ft, and the largest house that fits the space you can build on here is about {lw} by {ld} ft.', { hw: check.need.houseWidth, hd: check.need.houseDepth, lw: check.need.lotWidth, ld: check.need.lotDepth })}`
            ) : lot?.spec?.noStreetGarage && program.garage > 0 ? (
              ` ${t('With the deed restriction (no garage facing the street) the garage has to load from the side or a side street, and that needs a wider lot. Try fewer cars, or no garage.')}`
            ) : (
              ` ${t('Try fewer rooms or a smaller garage.')}`
            )}
          </p>
        )}
      </div>
      {/* round 12, item A: never a dead end. When none of our plans fits the lot, the lot goes to a drafter with the rooms asked for */}
      {!check.ok && !checking && check.deadEnd && (
        <div className="card thin custom-lot" data-testid="custom-lot">
          {sendState === 'sent' ? (
            <>
              <h3>{t('Your lot is with our drafter')}</h3>
              <p className="small">{t('We saved your lot and the rooms you asked for. A drafter designs a house for this lot and emails you, usually within two business days. You can keep changing the rooms here; the drafter sees the latest.')}</p>
            </>
          ) : (
            <>
              <h3>{t('This lot needs a house designed for it')}</h3>
              <p className="small">{t('None of our ready plans fits the space you can build on here. That happens on narrow, shallow and pie-shaped lots. Send it to our drafter, who designs for this lot with the rooms you chose above.')}</p>
              <Button primary disabled={sendState === 'sending'} onClick={sendLot} data-testid="send-lot">
                {sendState === 'sending' ? t('Sending…') : t('Send my lot to the drafter')}
              </Button>
              {sendState !== 'idle' && sendState !== 'sending' && <p className="fine bad">{sendState}</p>}
            </>
          )}
        </div>
      )}
      <div className="actions">
        <Button ghost onClick={onBack}>
          {t('Back')}
        </Button>
        <Button
          primary
          disabled={!check.ok || checking}
          onClick={() => {
            // the plan does not go under its smallest size: that is what gets drafted, and the ask says so
            if (check.draft.clamped && program.sqft < minSqft) onChange({ ...program, sqft: minSqft })
            onNext({ turn: check.turn || 0 })
          }}
          title={check.ok ? '' : t('Make it fit the lot first')}
        >
          {t('Draft my house')}{check.draft.clamped && program.sqft < minSqft ? ` ${t('at {size}', { size: sf(minSqft) })}` : ''}
        </Button>
      </div>
    </div>
  )
}
