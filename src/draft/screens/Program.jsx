import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Stepper, Stat } from '../ui.jsx'
import { kitFor, lotOf, programLimits, DEFAULT_PROGRAM } from '../lib/layout.js'
import { fitsLot, startFrom } from '../lib/fit.js'
import { turnLot, insideRect } from '../lib/lot.js'
import { plainReason } from '../lib/plain.js'
import { floorArea } from '../lib/layout.js'
import { useLang, phrase } from '../lib/i18n.js'
import { buildCouldFit, recentBuildOffer, lotIsTight, sameRooms } from '../lib/rooms-offer.js'

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
 * No program (null): nothing is checked.
 */
function useFitCheck(program, style, L) {
  const [state, setState] = useState({ check: null, checking: !!program, of: null })
  const latest = useRef(0)
  useEffect(() => {
    const n = ++latest.current
    let alive = true
    if (!program) {
      setState({ check: null, checking: false, of: null })
      return
    }
    setState((s) => ({ ...s, checking: true }))
    checkInWorker(program, style, L)
      .catch(() => fitsLot(program, style, L))
      .then((check) => {
        if (alive && latest.current === n) setState({ check, checking: false, of: program })
      })
    return () => {
      alive = false
    }
  }, [program, style, L])
  // round 15 (U10): an answer is for the rooms it was asked about. In the paint between new rooms and their check
  // starting, the last answer (for the rooms just replaced) is still "checking", so its "does not fit" never flashes red
  return { check: state.check, checking: state.checking || (!!program && state.of !== program) }
}

/**
 * Round 15 (U10): the checks the rooms step will ask for, started as soon as the lot is taken, so the rooms that fit
 * are ready when the homeowner gets there (the worker keeps each answer). Nothing is shown; a failure is ignored.
 */
export function prefetchFit(lot, style) {
  try {
    if (!lot?.envelope) return
    const L = turnLot(lotOf(lot), 0)
    checkInWorker(DEFAULT_PROGRAM, style, L).catch(() => {})
    const ref = kitFor(style).reference
    if (ref && buildCouldFit(ref, L)) checkInWorker({ ...ref.program }, style, L).catch(() => {})
  } catch {
    /* the rooms step checks on its own */
  }
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
  const sent = sendState === 'sent'
  const kit = kitFor(style)
  const limits = programLimits(style)
  const footprint = program.sqft / program.stories + (program.garage ? 22 * kit.rooms.garage.perCar * program.garage : 0)
  const maxFootprint = Math.min(L.envelopeSf, L.areaSf * (L.rules?.maxCoverage ?? 0.5))
  const fit = footprint / maxFootprint
  const set = (k) => (v) => onChange({ ...program, [k]: v })
  const toggle = (k) => () => onChange({ ...program, [k]: !program[k] })
  // the real check: the first draft is drafted and run through the rules on this lot, in a worker (round 8: the
  // narrow lot's check took seconds and froze every tap); until the first answer the meter says it is checking
  const { check: checked, checking } = useFitCheck(program, style, L)
  const check = checked || { ok: false, checking: true, reasons: [], draft: { minSqft: 0, clamped: false, fitScale: 1, rooms: [] }, maxSqft: null, suggestion: null, need: null }
  // round 15 (U16): whether the lot is tight for our ready plans is the lot's answer, from our default rooms on it,
  // not whatever rooms are on screen (a Kerria start trimmed to the narrow plan's 4 bed, 2 bath was called "tight")
  const { check: lotCheck } = useFitCheck(DEFAULT_PROGRAM, style, L)
  const tight = !!lotCheck && lotIsTight(lotCheck)
  // round 15 (U5): the recent build is offered only where its house fits the lot. Its footprint is measured first
  // (Kiskadee's largest house is about 37 by 43 ft: no card, no draft); then its rooms are checked in the worker
  // (it was drafted here on the main thread, which froze a wedge lot's rooms step for seconds)
  const ref = kit.reference
  const refProgram = useMemo(() => (ref && buildCouldFit(ref, L) ? { ...ref.program } : null), [ref, L])
  const { check: refCheck, checking: refChecking } = useFitCheck(refProgram, style, L)
  const offer = refProgram && !refChecking ? recentBuildOffer(ref, refCheck) : null
  const matchesRef = !!offer && sameRooms(program, offer.program)
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
  // round 15 (U10): the size bar is neutral until there is a real problem: red only once the check of the rooms on
  // screen has answered that they do not fit (never while the rooms that fit are being found)
  const realProblem = !check.ok && !checking && !settling && !!checked
  const sentCard = (
    <>
      <h3>{t('Your lot is with our drafter')}</h3>
      <p className="small">{t('We saved your lot and the rooms you asked for. A drafter designs a house for this lot and emails you, usually within two business days. You can keep changing the rooms here; the drafter sees the latest.')}</p>
    </>
  )

  return (
    <div className="screen padded narrow rooms-step">
      <div className="screen-head">
        <h2>{t('What goes in the house?')}</h2>
        <p className="muted">{t('{style}. Change anything later in plain language.', { style: t(style.name) })}</p>
      </div>
      {/* round 12, item A: never a dead end. When none of our plans fits the lot, the lot goes to a drafter with the
          rooms asked for. Round 15 (U1): this card, and the tight-lot one, are the first thing on the step */}
      {!check.ok && !checking && check.deadEnd && (
        <div className="card thin custom-lot" data-testid="custom-lot">
          {sent ? (
            sentCard
          ) : (
            <>
              <h3>{t('This lot needs a house designed for it')}</h3>
              <p className="small">{t('None of our ready plans fits the space you can build on here. That happens on narrow, shallow and pie-shaped lots. Send it to our drafter, who designs for this lot with the rooms you choose on this page.')}</p>
              <Button primary disabled={sendState === 'sending'} onClick={sendLot} data-testid="send-lot">
                {sendState === 'sending' ? t('Sending…') : t('Send my lot to the drafter')}
              </Button>
              {sendState !== 'idle' && sendState !== 'sending' && <p className="fine bad">{sendState}</p>}
            </>
          )}
        </div>
      )}
      {/* round 13: a lot our plans fit only just offers the drafter, as a button a homeowner can see. Round 15: only
          when the lot really is tight (U16), at the top of the step where the first screen shows it (U1, U17) */}
      {!(check.deadEnd && !check.ok && !checking) && (tight || (sent && !check.deadEnd)) && (
        <div className="card thin custom-lot tight" data-testid="tight-lot">
          {sent ? (
            sentCard
          ) : (
            <>
              <h3>{t('A tight lot for our ready plans')}</h3>
              <p className="small">{t('You can go on with what fits here, or have our drafter design a house for this lot with the rooms you want.')}</p>
              <Button primary disabled={sendState === 'sending'} onClick={sendLot} data-testid="send-lot-tight">
                {sendState === 'sending' ? t('Sending…') : t('Send my lot to the drafter')}
              </Button>
              {sendState !== 'idle' && sendState !== 'sending' && <p className="fine bad">{sendState}</p>}
            </>
          )}
        </div>
      )}
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
      {offer && (
        <button className={'preset' + (matchesRef ? ' on' : '')} onClick={() => onChange({ ...offer.program })} aria-pressed={matchesRef} data-testid="recent-build">
          <span>{matchesRef ? t('Rooms set to a recent build') : t('Use the rooms of a recent build')}</span>
          <b>{t(ref.name)}</b>
          <small>
            {[t('{n} bed', { n: offer.program.beds }), t('{n} bath', { n: `${offer.program.baths}${offer.program.halfBath ? '.5' : ''}` }), offer.program.suite2 ? t('mini primary') : null, offer.program.office ? t('office') : null, offer.program.garage ? t('{n}-car garage', { n: offer.program.garage }) : t('no garage'), offer.program.frontPorch && offer.program.rearPorch ? t('front and rear porches') : offer.program.frontPorch ? t('front porch') : offer.program.rearPorch ? t('rear porch') : null, offer.program.stories === 2 ? t('two story') : t('one story')].filter(Boolean).join(' · ')}
            {refCheck?.ok && refCheck.draft?.rooms?.length ? ` · ${sf(floorArea(refCheck.draft.rooms, offer.program.stories || 1))}` : ` · ${sf(offer.program.sqft)}`}
          </small>
          {offer.without && <small className="fitted">{t('Fitted to your lot: {how}.', { how: say(offer.without) })}</small>}
          <small>{matchesRef ? t('this is what you will get') : t('tap to set the rooms below to this; the rooms below are what you will get')}</small>
        </button>
      )}
      <div className={'card' + (settling ? ' settling' : '')} aria-busy={settling}>
        {settling && <p className="muted fit-note settling-note">{t('Fitting the rooms to your lot…')}</p>}
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
        {check.draft.clamped && !settling && (
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
          <div className={'meter-fill' + (realProblem ? ' over' : '')} style={{ width: Math.min(100, fit * 100) + '%' }} />
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
      <div className="actions">
        <Button ghost onClick={onBack}>
          {t('Back')}
        </Button>
        {/* round 15 (U17): once the lot is with the drafter, drafting one of our plans anyway is the quiet choice */}
        <Button
          primary={!sent}
          ghost={sent}
          disabled={!check.ok || checking}
          data-testid="draft-my-house"
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
