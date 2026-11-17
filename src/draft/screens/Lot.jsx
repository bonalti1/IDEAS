// The lot step: from a plat or survey PDF (read by the office, confirmed by a drafter) or typed
// by hand. City rules give the setbacks; the buildable envelope is drawn on the lot.
import { useEffect, useMemo, useRef, useState } from 'react'
import HouseScene from '../HouseScene.jsx'
import { Button, Stat, sf } from '../ui.jsx'
import { api } from '../lib/api.js'
import { buildLot, traverse } from '../lib/lot.js'
import { cityTable, guessCity, CITY_IDS } from '../lib/cities.js'

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
        if (!dead) setErr('Could not draw the PDF here, but the office read it.')
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

export default function Lot({ intake, lot: saved, onNext, onBack }) {
  const [table, setTable] = useState(cityTable())
  const [mode, setMode] = useState(saved?.spec?.kind === 'plat' ? 'plat' : saved?.spec?.kind === 'manual' ? 'manual' : intake?.file ? 'plat' : 'manual')
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

  useEffect(() => {
    api.cities().then((t) => setTable(t)).catch(() => {})
  }, [])
  useEffect(() => {
    if (!address || flood) return
    api
      .flood(address)
      .then(setFlood)
      .catch((e) => setFloodErr(e.message))
  }, [address])
  // geocode the address for real: the city it is in, the street, and whether we build there
  useEffect(() => {
    if (!address || geo || saved?.spec) return
    api
      .geocode(address)
      .then((g) => {
        setGeo(g)
        if (!g.found) return
        setSpec((sp) => ({ ...sp, city: g.cityId || sp.city, frontStreet: sp.frontStreet || (g.street ? g.street.replace(/\b\w+/g, (w) => (/^(FM|US|TX|N|S|E|W|NE|NW|SE|SW)$/.test(w) ? w : w[0] + w.slice(1).toLowerCase())) : '') }))
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

  const lot = useMemo(() => {
    try {
      const L = buildLot({ ...spec, address, flood }, table)
      return { ...L, plat: read || null, geo: geo || null }
    } catch (e) {
      return null
    }
  }, [spec, table, address, flood, read, geo])
  const city = table[spec.city] || table.hidalgo
  const set = (k, v) => setSpec((s) => ({ ...s, [k]: v }))
  const setSetback = (k, v) => setSpec((s) => ({ ...s, setbacks: { ...(s.setbacks || {}), [k]: v } }))
  const tooSmall = lot && lot.envelopeSf < 1500

  return (
    <div className="screen split">
      <div className="viewport lot-view">
        {mode === 'plat' && file && showPlat && read ? file.type === 'application/pdf' ? <PlatPreview file={file} read={read} /> : <ImagePreview file={file} read={read} /> : <HouseScene view="top" showHouse={false} lot={lot || undefined} />}
        <div className="viewport-tag">{lot ? `${lot.address || 'your lot'} · ${city.name}` : 'Enter the lot'}</div>
        {mode === 'plat' && read && (
          <div className="viewport-views">
            <button className={showPlat ? 'on' : ''} onClick={() => setShowPlat(true)}>
              Plat
            </button>
            <button className={!showPlat ? 'on' : ''} onClick={() => setShowPlat(false)}>
              Lot
            </button>
          </div>
        )}
      </div>
      <aside className="side lot-side">
        <h2>Your lot</h2>
        <p className="muted small">{address || 'No address yet.'}</p>
        {geo?.found && (
          <p className={'fine ' + (geo.cityId ? 'good' : 'warn')}>
            Found: {geo.matched}
            {geo.place ? ` · ${geo.place}, ${geo.county || ''}` : geo.county ? ` · ${geo.county}` : ''}.{geo.note ? ` ${geo.note}` : ` We have the ${table[geo.cityId]?.name} rules.`}
          </p>
        )}
        {geo && !geo.found && <p className="fine warn">{geo.note}</p>}
        {!geo && address && !geoErr && !saved?.spec && <p className="fine">Looking the address up…</p>}
        {geoErr && <p className="fine warn">Could not look the address up ({geoErr}). Pick the city yourself.</p>}
        <div className="tabs small">
          <button className={mode === 'manual' ? 'on' : ''} onClick={() => setMode('manual') || (spec.kind !== 'manual' && setSpec({ kind: 'manual', address, width: 100, depth: 150, city: spec.city, frontStreet: '', corner: '', sideStreet: '', setbacks: {} }))}>
            Type it in
          </button>
          <button className={mode === 'plat' ? 'on' : ''} onClick={() => setMode('plat')}>
            From the plat
          </button>
        </div>

        <label className="field">
          <span>City</span>
          <select id="lot-city" value={spec.city} onChange={(e) => set('city', e.target.value)}>
            {CITY_IDS.map((id) => (
              <option key={id} value={id}>
                {table[id].name}
              </option>
            ))}
          </select>
        </label>

        {mode === 'manual' && (
          <>
            <p className="fine assume">
              We do not have your plat, so the {spec.width} by {spec.depth} ft lot below is an <b>assumption</b>. Put in the real width and depth from your deed or survey, or upload the plat.
            </p>
            <div className="row2">
              <label className="field">
                <span>Width (ft)</span>
                <input id="lot-width" type="number" min="20" value={spec.width} onChange={(e) => set('width', e.target.value)} />
              </label>
              <label className="field">
                <span>Depth (ft)</span>
                <input id="lot-depth" type="number" min="20" value={spec.depth} onChange={(e) => set('depth', e.target.value)} />
              </label>
            </div>
            <label className="field">
              <span>Front street</span>
              <input id="lot-street" placeholder="The street the house faces" value={spec.frontStreet} onChange={(e) => set('frontStreet', e.target.value)} />
            </label>
            <label className="field">
              <span>Corner lot</span>
              <select value={spec.corner || ''} onChange={(e) => set('corner', e.target.value)}>
                <option value="">No, one street</option>
                <option value="left">Yes, second street on the left</option>
                <option value="right">Yes, second street on the right</option>
              </select>
            </label>
            {spec.corner && (
              <label className="field">
                <span>Second street</span>
                <input value={spec.sideStreet || ''} onChange={(e) => set('sideStreet', e.target.value)} />
              </label>
            )}
          </>
        )}

        {mode === 'plat' && (
          <>
            <label className={'drop' + (file ? ' has-file' : '')}>
              <input type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={(e) => readFile(e.target.files?.[0] || null)} hidden />
              <span>{reading ? 'Reading the plat…' : file ? <b>{file.name}</b> : <b>Upload the plat or survey (PDF or photo)</b>}</span>
            </label>
            {readErr && <p className="fine bad">{readErr}</p>}
            {read && (
              <div className="card thin">
                <h3>What we read</h3>
                <p className="small">
                  {read.lotNumber ? `${read.lotNumber}${read.subdivision ? ', ' + read.subdivision : ''}. ` : ''}
                  {read.calls?.length} calls{lot ? `, closes within ${lot.closure} ft, ${sf(lot.areaSf)}` : ''}. Confidence {Math.round((read.confidence || 0) * 100)}%.
                </p>
                <ol className="list small">
                  {read.calls?.map((c, i) => (
                    <li key={i}>{c.curve ? `Curve R ${c.curve.radius}' ${c.curve.arcLength ? `L ${c.curve.arcLength}'` : c.curve.delta ? `Δ ${c.curve.delta}°` : ''}` : `${c.bearing} ${c.distance}'`}</li>
                  ))}
                </ol>
                {read.notes && <p className="fine">{read.notes}</p>}
                <p className="fine warn">A drafter checks this against the plat before anything is built. You can keep going meanwhile.</p>
              </div>
            )}
          </>
        )}

        <details className="setbacks">
          <summary>
            Setbacks · {city.name}
            {city.verified ? '' : ' (office defaults, unverified)'}
          </summary>
          <div className="row2">
            {[
              ['front', 'Front'],
              ['side', 'Side'],
              ['rear', 'Rear'],
              ['streetSide', 'Street side'],
            ].map(([k, l]) => (
              <label key={k} className="field">
                <span>{l} (ft)</span>
                <input type="number" min="0" placeholder={String(city[k])} value={spec.setbacks?.[k] ?? ''} onChange={(e) => setSetback(k, e.target.value)} />
              </label>
            ))}
          </div>
          <p className="fine">Blank uses the city rule. Max coverage {Math.round(city.maxCoverage * 100)}%, height {city.maxHeightFt} ft.</p>
        </details>

        {lot && (
          <div className="stats">
            <Stat k="Lot area" v={sf(lot.areaSf)} />
            <Stat k="Buildable area" v={sf(lot.envelopeSf)} />
            <Stat k="Max coverage" v={`${Math.round(city.maxCoverage * 100)}% · ${sf(lot.areaSf * city.maxCoverage)}`} />
            <Stat k="Flood zone" v={flood ? (flood.zone ? `${flood.zone}${flood.sfha ? ' · special flood hazard area' : ' · outside the 1% flood area'}` : 'not found for this address') : floodErr ? 'lookup unavailable' : address ? 'checking FEMA…' : '—'} />
          </div>
        )}
        {tooSmall && <p className="fine bad">The buildable area is very small. Check the dimensions and the setbacks.</p>}
        <p className="fine">Red is your property line. Green dashed is where the house can sit. {mode === 'plat' ? 'A drafter confirms the lot before the design is sent on.' : 'A drafter double-checks this before anything is final.'}</p>
        {mode === 'manual' && (
          <label className="confirm">
            <input id="lot-confirm" type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            <span>
              The lot is about {spec.width} by {spec.depth} ft and faces {spec.frontStreet || 'the street'}. I know this is my assumption until a drafter checks it.
            </span>
          </label>
        )}
        <div className="actions">
          <Button ghost onClick={onBack}>
            Back
          </Button>
          <Button primary disabled={!lot || tooSmall || reading || (mode === 'manual' && !confirmed)} onClick={() => onNext(lot)} title={mode === 'manual' && !confirmed ? 'Confirm the lot size first' : ''}>
            Looks right, pick a style
          </Button>
        </div>
      </aside>
    </div>
  )
}
