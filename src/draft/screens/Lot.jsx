// The lot step: from a plat or survey PDF (read by the office, confirmed by a drafter) or typed
// by hand. City rules give the setbacks; the buildable envelope is drawn on the lot.
import { useEffect, useMemo, useRef, useState } from 'react'
import HouseScene from '../HouseScene.jsx'
import { Button, Stat } from '../ui.jsx'
import { api } from '../lib/api.js'
import { buildLot, traverse, lotProblem } from '../lib/lot.js'
import { COUNTIES, geoMessage } from '../lib/cities.js'
import { cityTable, guessCity, CITY_IDS } from '../lib/cities.js'
import RulesPanel from '../RulesPanel.jsx'
import { parcelSpec } from '../lib/parcel-spec.js'
import { plainReason } from '../lib/plain.js'
import { useLang, placeName } from '../lib/i18n.js'

export { parcelSpec }

const fileToBase64 = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1])
    r.onerror = reject
    r.readAsDataURL(file)
  })

/** Polygon points on the page: plat feet rotated so north matches the sheet, fitted into the box the reader pointed at. Approximate by design. */
function overlayPoints(read, size) {
  if (!read?.calls?.length) return null
  let t
  try {
    t = traverse(read.calls)
  } catch {
    return null
  }
  const box = read.pageBox || { x0: 0.05, y0: 0.05, x1: 0.6, y1: 0.95 }
  const a = ((read.northAngleDeg || 0) * Math.PI) / 180 // north on the page, clockwise from up
  const rot = t.boundary.map(([x, z]) => [x * Math.cos(a) - z * Math.sin(a), x * Math.sin(a) + z * Math.cos(a)])
  const xs = rot.map((p) => p[0])
  const zs = rot.map((p) => p[1])
  const bw = Math.max(...xs) - Math.min(...xs) || 1
  const bh = Math.max(...zs) - Math.min(...zs) || 1
  const W = (box.x1 - box.x0) * size.w
  const H = (box.y1 - box.y0) * size.h
  const s = Math.min(W / bw, H / bh)
  const ox = box.x0 * size.w + (W - bw * s) / 2 - Math.min(...xs) * s
  const oy = box.y0 * size.h + (H - bh * s) / 2 - Math.min(...zs) * s
  return rot.map(([x, z]) => `${(ox + x * s).toFixed(1)},${(oy + z * s).toFixed(1)}`).join(' ')
}

/** The plat page with the lot polygon the office read drawn over it. */
function PlatPreview({ file, read }) {
  const canvas = useRef()
  const [size, setSize] = useState(null)
  const [err, setErr] = useState('')
  const { t } = useLang()
  useEffect(() => {
    let dead = false
    ;(async () => {
      try {
        const pdfjs = await import('pdfjs-dist')
        pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
        const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
        const page = await doc.getPage(Math.min(doc.numPages, Math.max(1, read?.page || 1)))
        const base = page.getViewport({ scale: 1 })
        const scale = Math.min(1.6, 1100 / base.width)
        const vp = page.getViewport({ scale })
        if (dead || !canvas.current) return
        canvas.current.width = vp.width
        canvas.current.height = vp.height
        await page.render({ canvasContext: canvas.current.getContext('2d'), viewport: vp }).promise
        if (!dead) setSize({ w: vp.width, h: vp.height })
      } catch (e) {
        if (!dead) setErr(t('Could not draw the PDF here, but the office read it.'))
      }
    })()
    return () => {
      dead = true
    }
  }, [file, read?.page])

  const poly = useMemo(() => (size ? overlayPoints(read, size) : null), [size, read])

  return (
    <div className="plat-preview">
      <canvas ref={canvas} />
      {size && poly && (
        <svg viewBox={`0 0 ${size.w} ${size.h}`} className="plat-overlay" aria-hidden="true">
          <polygon points={poly} fill="rgba(46,107,58,0.18)" stroke="#2e6b3a" strokeWidth="3" strokeDasharray="10 6" />
        </svg>
      )}
      {err && <p className="fine bad">{err}</p>}
    </div>
  )
}

/** A photo of the plat with the polygon over it. */
function ImagePreview({ file, read }) {
  const [url, setUrl] = useState(null)
  const [size, setSize] = useState(null)
  useEffect(() => {
    const u = URL.createObjectURL(file)
    setUrl(u)
    const im = new Image()
    im.onload = () => setSize({ w: im.naturalWidth, h: im.naturalHeight })
    im.src = u
    return () => URL.revokeObjectURL(u)
  }, [file])
  const poly = useMemo(() => (size ? overlayPoints(read, size) : null), [size, read])
  return (
    <div className="plat-preview">
      {url && <img src={url} alt="" style={{ display: 'block', maxWidth: '100%', margin: '0 auto' }} />}
      {size && poly && (
        <svg viewBox={`0 0 ${size.w} ${size.h}`} className="plat-overlay" aria-hidden="true">
          <polygon points={poly} fill="rgba(46,107,58,0.18)" stroke="#2e6b3a" strokeWidth={Math.max(2, size.w / 400)} strokeDasharray="10 6" />
        </svg>
      )}
    </div>
  )
}

/** A service's own plain line as it came ("FEMA did not answer; the office checks the flood zone"), anything else wrapped; one full stop. */
const plain = (err, wrap, say = (s) => s) => {
  const t = /did not answer|didn't answer|Too many/.test(err) ? say(err) : wrap(say(err))
  const s = String(t).replace(/\.+$/, '')
  return s[0].toUpperCase() + s.slice(1) + '.'
}

export default function Lot({ intake, lot: saved, onNext, onBack }) {
  const [table, setTable] = useState(cityTable())
  const [mode, setMode] = useState(saved?.spec?.kind === 'plat' ? 'plat' : saved?.spec?.kind === 'manual' ? 'manual' : saved?.spec?.kind === 'parcel' ? 'parcel' : intake?.file ? 'plat' : 'manual')
  const address = saved?.address || intake?.address || ''
  const [spec, setSpec] = useState(() => (saved?.spec && saved.spec.kind !== 'reference' ? saved.spec : { kind: 'manual', address, width: 100, depth: 150, city: guessCity(address), frontStreet: '', corner: '', sideStreet: '', setbacks: {} }))
  const [file, setFile] = useState(intake?.file || null)
  const [read, setRead] = useState(saved?.plat || null) // what the office read from the PDF
  const [reading, setReading] = useState(false)
  const [readErr, setReadErr] = useState('')
  const [flood, setFlood] = useState(saved?.flood || null)
  const [floodErr, setFloodErr] = useState('')
  const [showPlat, setShowPlat] = useState(true)
  const [geo, setGeo] = useState(saved?.geo || null) // where the address really is
  const [geoErr, setGeoErr] = useState('')
  const [confirmed, setConfirmed] = useState(!!saved?.spec && saved.spec.kind !== 'reference') // the typed lot is an assumption until the client says it is right
  // round 7: the parcel from the appraisal district, offered as "Is this your lot?"
  const [parcel, setParcel] = useState(null) // { match: 'one', ... } | { match: 'none', candidates } | null
  const [parcelErr, setParcelErr] = useState('')
  const [parcelBusy, setParcelBusy] = useState(false)
  const [parcelAnswer, setParcelAnswer] = useState(saved?.spec?.kind === 'parcel' ? 'yes' : null) // 'yes' | 'no' | null
  const [zoning, setZoning] = useState(saved?.spec?.zoning || saved?.zoning || null)
  const [zoningErr, setZoningErr] = useState('')
  // round 10, item 3: the geocoder found another address than the one typed (W typed, E found); nothing is looked up
  // at the found address until the homeowner says it is theirs
  const [addressOk, setAddressOk] = useState(null) // true: "yes, that is right"; false: "no"; null: not asked or not answered
  const mismatch = geo?.found && geo.mismatch ? geo.mismatch : null
  const addressHeld = !!mismatch && addressOk !== true
  const { lang, t, rich, say, sf } = useLang()

  useEffect(() => {
    api.cities().then((t) => setTable(t)).catch(() => {})
  }, [])
  // the flood zone is read at the parcel's interior point once the parcel is known; the street point only when it is not
  useEffect(() => {
    if (!address || flood || saved?.spec || addressHeld) return
    if (parcelBusy || parcel?.match === 'one') return
    if (parcel && parcel.match !== 'one' && parcel.match !== 'confirm-address') api.flood(address).then(setFlood).catch((e) => setFloodErr(e.message))
  }, [address, parcel, parcelBusy, addressHeld])
  // look the parcel up once the address is known to be the homeowner's (and there is no saved lot yet): after the
  // geocoder answered, and, when it found another address than the one typed, after the homeowner agreed to it
  useEffect(() => {
    if (!address || saved?.spec || (parcel && parcel.match !== 'confirm-address')) return
    if (!geo && !geoErr) return
    if (addressHeld) return
    setParcelBusy(true)
    api
      .parcel(address, addressOk === true)
      .then(async (p) => {
        setParcel(p)
        if (p.match === 'one' && p.interior) {
          api.floodAt(p.interior.lat, p.interior.lon, address).then(setFlood).catch((e) => setFloodErr(e.message))
        }
      })
      .catch((e) => {
        setParcelErr(e.message)
        setParcel({ match: 'error' })
      })
      .finally(() => setParcelBusy(false))
  }, [address, geo, geoErr, addressOk])
  // zoning at the parcel's interior point, for the city we resolved
  useEffect(() => {
    if (!parcel || parcel.match !== 'one' || !parcel.interior || !geo?.found || zoning) return
    api
      .zoning(geo.cityId || '', parcel.interior.lat, parcel.interior.lon)
      .then(setZoning)
      .catch((e) => setZoningErr(e.message))
  }, [parcel, geo])
  const takeParcel = (p) => {
    // the client's yes is recorded; `confirmed` stays false until a drafter checks the parcel against the plat (like a plat read)
    const sp = { ...parcelSpec(p, { address, city: geo?.cityId || spec.city || '', county: geo?.county || p.county || spec.county || '', geo, flood, zoning, confirmed: false }), clientConfirmed: true, clientConfirmedAt: new Date().toISOString() }
    setSpec(sp)
    setMode('parcel')
    setParcelAnswer('yes')
    setConfirmed(true)
  }
  const pickCandidate = async (c) => {
    setParcelBusy(true)
    try {
      const p = await api.parcelById(parcel.county, c.propId)
      setParcel(p)
      if (p.interior) api.floodAt(p.interior.lat, p.interior.lon, address).then(setFlood).catch(() => {})
    } catch (e) {
      setParcelErr(e.message)
    }
    setParcelBusy(false)
  }
  // geocode the address for real: the city it is in, the street, and whether we build there
  useEffect(() => {
    if (!address || geo || saved?.spec) return
    api
      .geocode(address)
      .then((g) => {
        setGeo(g)
        if (!g.found) return
        // when the geocoder found another address than the one typed, the street name on the typed lot stays the typed one
        const typedStreet = String(address).split(',')[0].replace(/^\s*\d+[A-Za-z]?\s+/, '').trim()
        setSpec((sp) => ({ ...sp, city: g.cityId || (g.found ? '' : sp.city), county: g.cityId ? '' : (sp.county || (g.county && COUNTIES.includes(g.county) ? g.county : '')), frontStreet: sp.frontStreet || (g.mismatch ? typedStreet : g.street ? g.street.replace(/\b\w+/g, (w) => (/^(FM|US|TX|N|S|E|W|NE|NW|SE|SW)$/.test(w) ? w : w[0] + w.slice(1).toLowerCase())) : '') }))
      })
      .catch((e) => setGeoErr(e.message))
  }, [address])

  const readFile = async (f) => {
    if (!f) return
    setFile(f)
    setReading(true)
    setReadErr('')
    try {
      const res = await api.readPlat({ name: f.name, data: await fileToBase64(f) })
      setRead(res)
      setSpec({ kind: 'plat', address, city: res.city && table[res.city] ? res.city : guessCity(address + ' ' + (res.address || '')), calls: res.calls, streets: res.streets || [], front: res.front ?? 0, kinds: res.kinds || undefined, setbacks: {}, platId: res.platId, confirmed: false, readConfidence: res.confidence, readNotes: res.notes })
      setMode('plat')
    } catch (e) {
      setReadErr(e.message)
    }
    setReading(false)
  }
  useEffect(() => {
    if (intake?.file && !read && !saved?.spec) readFile(intake.file)
  }, [])

  const built = useMemo(() => {
    try {
      // decision B6 (round 10, item 4): the zoning read at the county parcel belongs to the lot only once the homeowner
      // takes that parcel; a typed lot carries a zoning only when a drafter confirmed one
      const L = buildLot({ ...spec, address, flood, zoning: spec.kind === 'parcel' ? zoning || spec.zoning || null : spec.zoning?.confirmedBy ? spec.zoning : null }, table)
      return { ...L, plat: read || null, geo: geo || null }
    } catch (e) {
      return null
    }
  }, [spec, table, address, flood, read, geo, zoning])
  // what is wrong with the lot as typed; the last good lot stays on the screen until it is right
  const problem = lotProblem(spec, built, lang)
  const lastGood = useRef(null)
  if (!problem && built) lastGood.current = built
  const lot = problem ? null : built
  // a typed lot keeps the last good drawing while a number is half typed; a parcel or a plat is always the one drawn,
  // even when the setbacks leave no room on it: a previous lot must never stay on the screen (round 10, item 1)
  const drawAnyway = built && (spec.kind === 'parcel' || spec.kind === 'plat') && built.boundary?.length >= 3
  const shown = lot || (drawAnyway ? built : lastGood.current)
  const city = table[spec.city] || { name: t('No city rules yet'), county: null }
  const set = (k, v) => setSpec((s) => ({ ...s, [k]: v }))
  const setSetback = (k, v) => setSpec((s) => ({ ...s, setbacks: { ...(s.setbacks || {}), [k]: v } }))
  const tooSmall = !!problem
  // round 12, item F: a lot with no city row has no coverage figure; the rules use 50%, and the screen says so (it said "NaN% · NaN sf")
  const hasCover = Number.isFinite(+city?.maxCoverage) && +city.maxCoverage > 0
  const cover = hasCover ? +city.maxCoverage : 0.5
  const coverLine = hasCover ? `${Math.round(cover * 100)}%` : t('50% (county default, the drafter confirms)')

  return (
    <div className="screen split">
      <div className="viewport lot-view">
        {mode === 'plat' && file && showPlat && read ? file.type === 'application/pdf' ? <PlatPreview file={file} read={read} /> : <ImagePreview file={file} read={read} /> : <HouseScene view="top" showHouse={false} lot={shown || undefined} lotProblem={problem && drawAnyway ? (built.envelopeSf > 0 ? t('Very little room to build on this lot') : t('No room to build on this lot')) : ''} />}
        <div className={'viewport-tag' + (problem && drawAnyway ? ' bad' : '')} data-testid="lot-tag">
          {shown ? `${shown.address || t('your lot')} · ${placeName(city.name, lang)}` : t('Enter the lot')}
          {problem && drawAnyway ? ` · ${built.envelopeSf > 0 ? t('very little room to build') : t('no room to build')}` : ''}
        </div>
        {mode === 'plat' && read && (
          <div className="viewport-views">
            <button className={showPlat ? 'on' : ''} onClick={() => setShowPlat(true)}>
              {t('Plat')}
            </button>
            <button className={!showPlat ? 'on' : ''} onClick={() => setShowPlat(false)}>
              {t('Lot')}
            </button>
          </div>
        )}
      </div>
      <aside className="side lot-side">
        <h2>{t('Your lot')}</h2>
        <p className="muted small">{address || t('No address yet.')}</p>
        {geo?.found && !mismatch && (
          <p className={'fine ' + (geo.cityId ? 'good' : 'warn')}>
            {t('Found: {address}', { address: geo.matched })}
            {geo.place ? ` · ${geo.place}, ${placeName(geo.county || '', lang)}` : geo.county ? ` · ${placeName(geo.county, lang)}` : ''}. {geoMessage(geo, table, lang)}
          </p>
        )}
        {mismatch && (
          <div className="card thin address-check" data-testid="address-check">
            <p className="fine warn">
              {mismatch.what.length === 1 && mismatch.what[0] === 'direction' ? (
                <>
                  {rich('We found {number} {direction} {street}, not {typed}. Is that right?', { number: mismatch.found.split(' ')[0], direction: <b>{mismatch.foundDirection}</b>, street: mismatch.found.split(' ').slice(2).join(' '), typed: mismatch.typedDirection })}
                </>
              ) : (
                <>
                  {rich('We found {found}, not {typed}. Is that right?', { found: <b>{mismatch.found}</b>, typed: mismatch.typed })}
                </>
              )}
            </p>
            {addressOk === null && (
              <div className="row2">
                <Button small primary onClick={() => setAddressOk(true)} data-testid="address-yes">
                  {t('Yes, that is my address')}
                </Button>
                <Button small ghost onClick={() => setAddressOk(false)} data-testid="address-no">
                  {t('No')}
                </Button>
              </div>
            )}
            {addressOk === true && (
              <p className="fine">
                {t('Using {address}', { address: mismatch.found })}
                {geo.place ? ` · ${geo.place}, ${placeName(geo.county || '', lang)}` : ''}. {geoMessage(geo, table, lang)}
              </p>
            )}
            {addressOk === false && <p className="fine">{t('Then we did not find your address. Type the lot in below, or go back and check the street number and the direction (N, S, E, W).')}</p>}
          </div>
        )}
        {geo && !geo.found && <p className="fine warn">{say(geo.note)}</p>}
        {!geo && address && !geoErr && !saved?.spec && <p className="fine">{t('Looking the address up…')}</p>}
        {geoErr && <p className="fine warn">{t('Could not look the address up ({error}). Pick the city yourself.', { error: say(geoErr) })}</p>}
        {/* round 7: the parcel from the county appraisal district, offered before anything is typed */}
        {address && !saved?.spec && parcelBusy && !parcel && <p className="fine">{t('Looking the lot up at the county appraisal district…')}</p>}
        {parcel?.match === 'one' && parcelAnswer !== 'no' && (
          <div className="card thin parcel-card" data-testid="parcel-card">
            <h3>{parcelAnswer === 'yes' ? t('Your lot, from the county parcel map') : t('Is this your lot?')}</h3>
            <p className="small">
              {parcel.legal ? <b>{parcel.legal}</b> : <b>{t('Parcel {id}', { id: parcel.propId })}</b>}
              {parcel.situs ? ` · ${parcel.situs}` : ''}. {t('{n} sides, about {area} sf ({acres} acres)', { n: parcel.edges?.length, area: Math.round(parcel.areaSf).toLocaleString(), acres: parcel.acres })}
              {parcel.cleaned?.short || parcel.cleaned?.straight ? `; ${t('{n} sliver {n|corner|corners} under a foot removed', { n: (parcel.cleaned.short || 0) + (parcel.cleaned.straight || 0) })}` : ''}.
            </p>
            {parcel.large || zoning?.residential === false ? (
              <p className="fine warn">
                {parcel.large ? t('A large tract ({acres} acres, {n} sides): the office draws this one.', { acres: parcel.acres, n: parcel.edges?.length }) : t('Not a house district: the sides are not drawn.')} {zoning?.residential === false ? say(zoning.message) : ''}
              </p>
            ) : (
              <div className="edges">
                {parcel.edges?.map((e, i) => {
                  const st = (parcel.streets || []).find((s) => s.edge === i && s.role !== 'rear')
                  // a curved frontage (round 11): its chords are one street side, said once with their total
                  const curved = (parcel.frontChords || 1) > 1
                  if (curved && parcel.edgeKinds?.[i] === 'front' && i !== (parcel.frontEdge ?? 0)) return null
                  if (curved && i === (parcel.frontEdge ?? 0))
                    return (
                      <span key={i} className="front">
                        {t("street side{name} {width}' along the curve, in {n} pieces", { name: st ? ` (${st.name})` : '', width: parcel.frontWidthFt, n: parcel.frontChords })}
                      </span>
                    )
                  return (
                    <span key={i} className={i === (parcel.frontEdge ?? 0) ? 'front' : ''}>
                      {i === (parcel.frontEdge ?? 0) ? `${t('street side')}${st ? ` (${st.name})` : ''} ` : st ? `${t('side street')} (${st.name}) ` : ''}
                      {e.lengthFt}' {e.bearing}
                    </span>
                  )
                })}
              </div>
            )}
            {parcel.confidence === 'near' && parcel.listedAs && <p className="fine warn" data-testid="listed-as">{t('The county address map puts {address} on this parcel; the appraisal district lists it as {listed}. Check that it is your lot; the drafter checks it too.', { address: String(address).split(',')[0], listed: parcel.listedAs })}</p>}
            {!parcel.large && parcel.corner && <p className="fine">{t('A corner lot: the side on {streets} keeps the wider open space the city asks for along a street.', { streets: (parcel.streets || []).filter((s) => s.role === 'side').map((s) => s.name).join(` ${t('and')} `) })}</p>}
            {!parcel.large && parcel.frontBy && parcel.frontBy !== 'named-road' && <p className="fine warn">{t('The street map did not show which side faces the street, so the street side is our best guess; the drafter checks it.')}</p>}
            <p className="fine">
              {t('From the {source}', { source: parcel.source?.name || t('county appraisal district') })}
              {parcel.source?.fetchedAt ? `, ${t('read {date}', { date: String(parcel.source.fetchedAt).slice(0, 10) })}` : ''}. {t('The parcel map is advisory: a drafter checks it against the recorded plat or your survey before anything is built.')}
            </p>
            {parcelAnswer !== 'yes' && (
              <div className="row2">
                <Button small primary onClick={() => takeParcel(parcel)} data-testid="parcel-yes">
                  {t('Yes, this is my lot')}
                </Button>
                <Button small ghost onClick={() => setParcelAnswer('no')} data-testid="parcel-no">
                  {t('Not my lot')}
                </Button>
                <Button
                  small
                  ghost
                  onClick={() => {
                    setParcelAnswer('no')
                    setMode('manual')
                  }}
                >
                  {t('Type it in')}
                </Button>
              </div>
            )}
            {parcelAnswer === 'yes' && (
              <button className="linkish" onClick={() => setParcelAnswer('no') || setMode('manual') || setSpec({ kind: 'manual', address, width: 100, depth: 150, city: spec.city, county: spec.county, frontStreet: spec.streets?.[0]?.name || '', corner: '', sideStreet: '', setbacks: {} })}>
                {t('Not my lot after all')}
              </button>
            )}
          </div>
        )}
        {parcel?.match === 'none' && parcel.candidates?.length > 0 && parcelAnswer !== 'no' && (
          <div className="card thin parcel-card candidates" data-testid="parcel-candidates">
            <h3>{t('Which of these is your lot?')}</h3>
            <p className="small">{t('The county map has {n} parcels near this address; none carries it exactly. Tap yours, or type the lot in.', { n: parcel.candidates.length })}</p>
            <ul className="candidates">
              {parcel.candidates.map((c) => (
                <li key={c.propId}>
                  <span>
                    <b>{c.situs || t('Parcel {id}', { id: c.propId })}</b>
                    {c.legal ? <span className="muted small"> · {c.legal}</span> : ''}
                    {c.distanceFt != null ? <span className="muted small"> · {t('{n} ft away', { n: c.distanceFt })}</span> : ''}
                  </span>
                  <Button small ghost disabled={parcelBusy} onClick={() => pickCandidate(c)}>
                    {t('This one')}
                  </Button>
                </li>
              ))}
            </ul>
            <button className="linkish" onClick={() => setParcelAnswer('no')}>
              {t('None of these, type it in')}
            </button>
          </div>
        )}
        {parcel && parcel.match !== 'one' && !parcel.candidates?.length && parcel.match !== 'error' && !saved?.spec && <p className="fine warn">{parcel.reason === 'the address was not found' ? t('The county parcel map did not find this address; type the lot in or upload the plat.') : t('The county parcel map has no entry we could match ({reason}); type the lot in or upload the plat.', { reason: say(parcel.reason) || t('no match') })}</p>}
        {/* round 10, item 6: an outside service that did not answer is said in a plain line, never left blank */}
        {parcelErr && <p className="fine warn" data-testid="parcel-error">{plain(parcelErr, (e) => t('Could not reach the county parcel map ({error}). Type the lot in or upload the plat; the drafter pulls the parcel later', { error: e }), say)}</p>}
        {floodErr && <p className="fine warn" data-testid="flood-error">{plain(floodErr, (e) => t('The flood map could not be read ({error}); the office checks the flood zone', { error: e }), say)}</p>}
        {zoningErr && <p className="fine warn" data-testid="zoning-error">{plain(zoningErr, (e) => t('The zoning map could not be read ({error}); the drafter reads the zoning', { error: e }), say)}</p>}
        <div className="tabs small">
          <button className={mode === 'manual' ? 'on' : ''} onClick={() => setMode('manual') || (spec.kind !== 'manual' && setSpec({ kind: 'manual', address, width: 100, depth: 150, city: spec.city, county: spec.county, frontStreet: '', corner: '', sideStreet: '', setbacks: {} }))}>
            {t('Type it in')}
          </button>
          <button className={mode === 'plat' ? 'on' : ''} onClick={() => setMode('plat')}>
            {t('From the plat')}
          </button>
          {spec.kind === 'parcel' && (
            <button className={mode === 'parcel' ? 'on' : ''} onClick={() => setMode('parcel')}>
              {t('County parcel')}
            </button>
          )}
        </div>

        <label className="field">
          <span>{t('City')}</span>
          <select id="lot-city" value={spec.city || ''} onChange={(e) => set('city', e.target.value)}>
            <option value="">{t('No rules for this city yet (county defaults, a drafter checks them)')}</option>
            {CITY_IDS.map((id) => (
              <option key={id} value={id}>
                {placeName(table[id].name, lang)}
              </option>
            ))}
          </select>
        </label>
        {!table[spec.city] && (
          <label className="field">
            <span>{t('County')}</span>
            <select id="lot-county" value={spec.county || ''} onChange={(e) => set('county', e.target.value)}>
              <option value="">{t('Pick the county')}</option>
              {COUNTIES.map((c) => (
                <option key={c} value={c}>
                  {placeName(c, lang)}
                </option>
              ))}
            </select>
            <small className="fine">{t('We use the county to look up the building rules.')}</small>
          </label>
        )}

        {mode === 'manual' && (
          <>
            <p className="fine assume">
              {rich('We do not have your plat, so the {width} by {depth} ft lot below is an <b>assumption</b>. Put in the real width and depth from your deed or survey, or upload the plat.', { width: spec.width, depth: spec.depth })}
            </p>
            <div className="row2">
              <label className="field">
                <span>{t('Width (ft)')}</span>
                <input id="lot-width" type="number" min="20" value={spec.width} onChange={(e) => set('width', e.target.value)} />
              </label>
              <label className="field">
                <span>{t('Depth (ft)')}</span>
                <input id="lot-depth" type="number" min="20" value={spec.depth} onChange={(e) => set('depth', e.target.value)} />
              </label>
            </div>
            <label className="field">
              <span>{t('Front street')}</span>
              <input id="lot-street" placeholder={t('The street the house faces')} value={spec.frontStreet} onChange={(e) => set('frontStreet', e.target.value)} />
            </label>
            <label className="field">
              <span>{t('Corner lot')}</span>
              <select value={spec.corner || ''} onChange={(e) => set('corner', e.target.value)}>
                <option value="">{t('No, one street')}</option>
                <option value="left">{t('Yes, second street on the left')}</option>
                <option value="right">{t('Yes, second street on the right')}</option>
              </select>
            </label>
            {spec.corner && (
              <label className="field">
                <span>{t('Second street')}</span>
                <input value={spec.sideStreet || ''} onChange={(e) => set('sideStreet', e.target.value)} />
              </label>
            )}
            <label className="confirm deed">
              <input id="lot-no-street-garage" type="checkbox" checked={!!spec.noStreetGarage} onChange={(e) => set('noStreetGarage', e.target.checked)} />
              <span>
                {t('Deed restrictions: the garage may not face the street.')} <small className="fine">{t('Some subdivisions require rear or side entry; the drafter checks the recorded restrictions.')}</small>
              </span>
            </label>
          </>
        )}

        {mode === 'plat' && (
          <>
            <label className={'drop' + (file ? ' has-file' : '')}>
              <input type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={(e) => readFile(e.target.files?.[0] || null)} hidden />
              <span>{reading ? t('Reading the plat…') : file ? <b>{file.name}</b> : <b>{t('Upload the plat or survey (PDF or photo)')}</b>}</span>
            </label>
            {readErr && <p className="fine bad">{say(readErr)}</p>}
            {read && (
              <div className="card thin">
                <h3>{t('What we read')}</h3>
                <p className="small">
                  {read.lotNumber ? `${read.lotNumber}${read.subdivision ? ', ' + read.subdivision : ''}. ` : ''}
                  {t('{n} calls', { n: read.calls?.length })}{lot ? `, ${t('closes within {ft} ft', { ft: lot.closure })}, ${sf(lot.areaSf)}` : ''}. {t('Confidence {pct}%.', { pct: Math.round((read.confidence || 0) * 100) })}
                </p>
                <ol className="list small">
                  {read.calls?.map((c, i) => (
                    <li key={i}>{c.curve ? `${t('Curve')} R ${c.curve.radius}' ${c.curve.arcLength ? `L ${c.curve.arcLength}'` : c.curve.delta ? `Δ ${c.curve.delta}°` : ''}` : `${c.bearing} ${c.distance}'`}</li>
                  ))}
                </ol>
                {read.notes && <p className="fine">{say(read.notes)}</p>}
                <p className="fine warn">{t('A drafter checks this against the plat before anything is built. You can keep going meanwhile.')}</p>
              </div>
            )}
          </>
        )}

        <details className="setbacks">
          <summary>
            {t('Space the city keeps open along each edge')} · {placeName(city.name, lang)}
            {city.verified ? '' : ` ${t('(office defaults, unverified)')}`}
          </summary>
          <div className="row2">
            {[
              ['front', t('Front')],
              ['side', t('Side')],
              ['rear', t('Rear')],
              ['streetSide', t('Street side')],
            ].map(([k, l]) => (
              <label key={k} className="field">
                <span>{t('{label} (ft)', { label: l })}</span>
                <input type="number" min="0" placeholder={city[k] != null && Number.isFinite(+city[k]) ? String(city[k]) : ''} value={spec.setbacks?.[k] ?? ''} onChange={(e) => setSetback(k, e.target.value)} />
              </label>
            ))}
          </div>
          <p className="fine">
            {t('Blank uses the city rule. A house may cover {cover} of the lot; height: {height}.', { cover: coverLine, height: Number.isFinite(+city.maxHeightFt) ? t('{n} ft', { n: city.maxHeightFt }) : t('the drafter confirms') })}
          </p>
        </details>

        {lot && (
          <div className="stats">
            <Stat k={t('Lot area')} v={sf(lot.areaSf)} />
            <Stat k={t('Buildable area')} v={sf(lot.envelopeSf)} />
            <Stat k={t('Max coverage')} v={`${coverLine} · ${sf(lot.areaSf * cover)}`} />
            <Stat k={t('Flood zone')} v={flood ? (flood.status === 'no-digital-firm' ? t('no digital FEMA map here · the county decides') : flood.zone ? `${flood.zone}${flood.sfha ? ` · ${t('special flood hazard area')}` : flood.status === 'shaded-x' ? ` · ${t('0.2% flood area')}` : ` · ${t('outside the 1% flood area')}`}${flood.where && /street/.test(flood.where) ? ` ${t('(at the street; the parcel point once the lot is picked)')}` : ''}` : flood.status === 'no-address' ? t('not found for this address') : t('no zone polygon at this point')) : floodErr ? t('FEMA did not answer · the office checks') : addressHeld ? t('after the address is settled') : address ? t('checking FEMA…') : '—'} />
            {zoning?.status === 'found' && <Stat k={t('Zoning')} v={`${zoning.district} · ${say(zoning.use)}`} />}
          </div>
        )}
        {lot && <RulesPanel lot={lot} mode="homeowner" />}
        {lot?.zoning?.residential === false && <p className="fine bad">{say(lot.zoning.message)}</p>}
        {problem && <p className="fine bad">{plainReason(problem)}</p>}
        <p className="fine">{t('Red is your property line. Green dashed is where the house can sit.')} {mode === 'plat' || spec.kind === 'parcel' ? t('A drafter confirms the lot before the design is sent on.') : t('A drafter double-checks this before anything is final.')}</p>
        {mode === 'manual' && (
          <label className="confirm">
            <input id="lot-confirm" type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            <span>
              {t('The lot is about {width} by {depth} ft and faces {street}. I know this is my assumption until a drafter checks it.', { width: spec.width, depth: spec.depth, street: spec.frontStreet || t('the street') })}
            </span>
          </label>
        )}
        <div className="actions">
          <Button ghost onClick={onBack}>
            {t('Back')}
          </Button>
          <Button primary disabled={!lot || tooSmall || reading || (mode === 'manual' && !confirmed)} onClick={() => onNext(lot)} title={mode === 'manual' && !confirmed ? t('Confirm the lot size first') : ''} data-testid="lot-next">
            {t('Looks right, pick a style')}
          </Button>
        </div>
      </aside>
    </div>
  )
}
