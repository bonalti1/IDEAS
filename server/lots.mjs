// Lots on the server: the city rules table (editable on the dashboard), reading a plat PDF with
// Claude into calls, and the FEMA flood zone for an address.
import crypto from 'node:crypto'
import { streetCore } from './parcels.mjs'
import { cityTable, CITY_IDS, RULE_FIELDS } from '../src/draft/lib/cities.js'
import { jurisdictionTable, jurisdictionFor, geoMessage, countyRowId, ALL_FIELDS } from '../src/draft/lib/jurisdictions.js'
import { buildLot, traverse } from '../src/draft/lib/lot.js'

const fail = (status, error, extra = {}) => Object.assign(new Error(error), { status, ...extra })

export const PLAT_SCHEMA = {
  type: 'object',
  properties: {
    lotNumber: { type: 'string' },
    subdivision: { type: 'string' },
    address: { type: 'string' },
    city: { type: 'string', description: 'one of mission, mcallen, edinburg, pharr, palmview, weslaco, hidalgo, or empty' },
    calls: {
      type: 'array',
      description: 'the boundary, one call per side, in order around the lot (clockwise as drawn), starting at any corner',
      items: {
        type: 'object',
        properties: {
          bearing: { type: 'string', description: 'quadrant bearing such as N 05°00\'00" E. If the plat gives none, infer it from the drawing (a side drawn straight up the page with north up is N 00°00\'00" E)' },
          distance: { type: 'number', description: 'feet' },
          curve: {
            type: 'object',
            properties: {
              radius: { type: 'number' },
              arcLength: { type: 'number' },
              delta: { type: 'number', description: 'central angle in decimal degrees' },
              chord: { type: 'number' },
              chordBearing: { type: 'string' },
              direction: { type: 'string', enum: ['left', 'right'], description: 'which way the boundary turns along the curve when walked in call order' },
            },
            required: ['radius', 'direction'],
            additionalProperties: false,
          },
        },
        additionalProperties: false,
      },
    },
    streets: { type: 'array', items: { type: 'object', properties: { edge: { type: 'integer', description: 'index into calls' }, name: { type: 'string' } }, required: ['edge', 'name'], additionalProperties: false } },
    front: { type: 'integer', description: 'index of the call along the street the house faces' },
    kinds: { type: 'array', items: { type: 'string', enum: ['front', 'side', 'rear', 'streetSide'] }, description: 'one per call, when the plat or site plan makes it clear; else empty' },
    setbacks: { type: 'object', properties: { front: { type: 'number' }, side: { type: 'number' }, rear: { type: 'number' }, streetSide: { type: 'number' } }, additionalProperties: false, description: 'only setbacks printed on the sheet' },
    pageBox: { type: 'object', properties: { x0: { type: 'number' }, y0: { type: 'number' }, x1: { type: 'number' }, y1: { type: 'number' } }, required: ['x0', 'y0', 'x1', 'y1'], additionalProperties: false, description: 'where the lot drawing sits on the page, as fractions of width and height from the top-left' },
    northAngleDeg: { type: 'number', description: 'direction of the north arrow on the page, degrees clockwise from straight up' },
    page: { type: 'integer', description: '1-based page the lot was read from' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    notes: { type: 'string', description: 'what was unclear, assumed or missing, in one or two sentences' },
  },
  required: ['calls', 'streets', 'front', 'confidence', 'notes', 'pageBox', 'northAngleDeg', 'page'],
  additionalProperties: false,
}

export const PLAT_SYSTEM = `You read recorded plats, surveys and site plans of residential lots in Texas and return the lot boundary as surveyor's calls.
- Walk the boundary in order around the lot. Each call is a line (bearing and distance in feet) or a curve (radius, and arc length or central angle, with the chord and chord bearing when printed, and which way the boundary turns).
- Use the printed bearings and distances exactly. When a sheet prints distances but no bearings (a site plan), infer bearings from the drawing with north up unless a north arrow says otherwise, and say so in notes.
- Feet and inches such as 147'-7" become decimal feet (147.58).
- Name the streets along each side and say which side the house faces (front). Mark the side kinds only when the sheet makes them clear (a printed setback label, a street, a rear lot line).
- Copy only setbacks printed on the sheet.
- pageBox is the box on the page that holds the lot drawing, as fractions from the top-left corner. northAngleDeg is the north arrow's direction, clockwise from straight up.
- Confidence below 0.6 when bearings were inferred, text was hard to read, or the calls do not close.`

export const FEMA_DOWN = 'FEMA did not answer; the office checks the flood zone'
export const CENSUS_DOWN = "the address service didn't answer; try again in a moment or type the lot in"
const DIRS = { N: 'N', S: 'S', E: 'E', W: 'W', NE: 'NE', NW: 'NW', SE: 'SE', SW: 'SW', NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W', NORTHEAST: 'NE', NORTHWEST: 'NW', SOUTHEAST: 'SE', SOUTHWEST: 'SW' }
/** The number, the direction before the street, and the street's core name from the first line of an address. */
export function addressParts(line) {
  const words = String(line || '').split(',')[0].toUpperCase().replace(/[.#]/g, ' ').split(/\s+/).filter(Boolean)
  const number = /^\d+[A-Z]?$/.test(words[0] || '') ? words.shift() : null
  const pre = words.length > 1 && DIRS[words[0]] ? DIRS[words.shift()] : null
  return { number, pre, street: streetCore(words.join(' ')) }
}
const titleCase = (t) => String(t || '').toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\b(Ne|Nw|Se|Sw|Fm|Us|Tx)\b/g, (w) => w.toUpperCase())
/**
 * Round 10, item 3: did the geocoder match the address that was typed? Compares the house number, the direction
 * before the street name (only when both have one) and the street's name. null when they agree; else what differs
 * and the yellow line the Lot step shows: "We found 1300 E Nolana Ave, not W. Is that right?"
 */
export function addressMismatch(typed, matched) {
  const a = addressParts(typed)
  const b = addressParts(matched)
  if (!a.number && !a.street) return null
  const what = []
  if (a.number && b.number && a.number !== b.number) what.push('number')
  if (a.pre && b.pre && a.pre !== b.pre) what.push('direction')
  if (a.street && b.street && a.street !== b.street) what.push('street')
  if (!what.length) return null
  const found = titleCase(String(matched || '').split(',')[0])
  const not = what.includes('street') || what.includes('number') ? titleCase(String(typed || '').split(',')[0]) : a.pre
  return { what, typed: titleCase(String(typed || '').split(',')[0]), found, typedDirection: a.pre, foundDirection: b.pre, message: `We found ${found}, not ${not}. Is that right?` }
}

export function makeLots({ env = process.env, store, files, interpreter, event, log = console.log, fetchImpl = globalThis.fetch }) {
  // the waits between FEMA tries; FEMA_BACKOFF_MS="5,10" shortens them for a test server
  const femaBackoffMs = String(env.FEMA_BACKOFF_MS || '1000,3000').split(',').map((x) => Math.max(0, +x || 0)).slice(0, 4)
  const now = () => new Date().toISOString()
  const fetch = fetchImpl
  const NFHL = 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer'
  let toldGone = false // one alert per process when FEMA's service is gone, not one per lookup
  /** One NFHL layer at a point: the features' attributes (empty when none). */
  async function nfhl(layer, lon, lat, outFields, { soft = false } = {}) {
    const q = new URLSearchParams({ geometry: `${lon},${lat}`, geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields, returnGeometry: 'false', f: 'json' })
    // a dropped connection, a timeout or a bad answer from FEMA is a 502 with a plain line, never a 500 (round 10, item 6)
    // FEMA drops a connection now and then, and sometimes for a minute (ECONNRESET, a connect timeout, a 504): two
    // more tries, after 1 s and after 3 s, then the plain line (round 11, item 4). Each try has 8 s, so the whole
    // read stays inside the Lot step's 30 s.
    let body
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await fetch(`${NFHL}/${layer}/query?${q}`, { signal: AbortSignal.timeout(8000) })
        // round 12, item 6: an outage (a reset, a timeout, a 5xx) is worth another try and passes; an answer that
        // says the address or the layer is not there (a 4xx, or ArcGIS's own error for a layer or a field) is FEMA
        // having moved its service, which waiting does not mend
        if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { gone: r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429 })
        body = await r.json()
        if (body.error) throw Object.assign(new Error(body.error.message || 'query error'), { gone: !(+body.error.code >= 500) })
        break
      } catch (e) {
        if (e?.code === 'DH_NETWORK_GUARD') throw e
        const gone = e?.gone === true
        const last = soft || gone || attempt >= femaBackoffMs.length // a soft layer (availability, LOMRs, LOMAs) gets one try
        const detail = String(e?.cause?.code || e?.message || e).slice(0, 80)
        log(`flood: FEMA NFHL layer ${layer} ${gone ? 'answered, but not with data' : 'did not answer'} (${detail})${last ? '' : `; trying again in ${femaBackoffMs[attempt]} ms`}`)
        if (gone && !soft && !toldGone) {
          toldGone = true
          await event('alert', `FEMA's flood map service answered layer ${layer} with "${detail}": the service has moved or a layer is gone, and every flood lookup fails until server/lots.mjs is pointed at the new one`).catch(() => {})
        }
        if (last) throw fail(502, FEMA_DOWN, { upstream: 'fema', why: gone ? 'gone' : 'outage', detail: `layer ${layer}: ${detail}` })
        await new Promise((ok) => setTimeout(ok, femaBackoffMs[attempt]))
      }
    }
    return (body.features || []).map((f) => f.attributes || {})
  }

  return {
    async table() {
      return cityTable((await store.meta.get('cities')) || {})
    },
    /** The sourced jurisdiction table (round 7): every field with its value, source, status and date, plus the office's edits. */
    async jurisdictions() {
      return jurisdictionTable((await store.meta.get('cities')) || {})
    },
    /**
     * A drafter's edit to one jurisdiction. A number for a rule field becomes { value, source, status, checkedAt, by };
     * a field object is taken as sent (value, source, status); `verified` marks the edited fields verified today;
     * `flags` replaces the row's flags. Nothing is deleted: a cleared field falls back to the seed row.
     */
    async setCity(id, patch, who) {
      if (!CITY_IDS.includes(id)) throw fail(404, 'unknown city')
      if (!patch || typeof patch !== 'object') throw fail(400, 'a patch object is required')
      const saved = (await store.meta.get('cities')) || {}
      const cur = saved[id] || {}
      const stamp = { checkedAt: now().slice(0, 10), by: who?.email || null }
      const status = patch.verified ? 'verified' : undefined
      for (const k of ALL_FIELDS) {
        const v = patch[k]
        if (v === undefined || v === '') continue
        if (v === null) {
          delete cur[k]
          continue
        }
        if (v && typeof v === 'object' && !Array.isArray(v) && 'value' in v) cur[k] = { ...(cur[k] || {}), ...v, source: v.source ? String(v.source).slice(0, 200) : cur[k]?.source, status: ['verified', 'summary', 'unknown'].includes(v.status) ? v.status : status || cur[k]?.status || 'summary', ...stamp }
        else if (RULE_FIELDS.includes(k)) {
          if (!Number.isFinite(+v)) throw fail(400, `${k} must be a number`)
          cur[k] = { ...(cur[k] || {}), value: +v, source: patch.source ? String(patch.source).slice(0, 200) : cur[k]?.source, status: status || cur[k]?.status || 'summary', ...stamp }
        } else cur[k] = { ...(cur[k] || {}), value: typeof v === 'string' ? v.slice(0, 300) : v, source: patch.source ? String(patch.source).slice(0, 200) : cur[k]?.source, status: status || cur[k]?.status || 'summary', ...stamp }
      }
      if (patch.verified !== undefined) cur.verified = !!patch.verified
      if (Array.isArray(patch.flags)) cur.flags = patch.flags.map((f) => String(f).slice(0, 120)).slice(0, 12)
      if (patch.zoning !== undefined) cur.zoning = String(patch.zoning).slice(0, 80)
      if (patch.note !== undefined) cur.note = String(patch.note).slice(0, 300)
      cur.updatedAt = now()
      cur.updatedBy = who?.email || null
      saved[id] = cur
      await store.meta.set('cities', saved)
      await event('worker', `${who?.email || 'office'} updated the ${id} rules${patch.source ? ` (${String(patch.source).slice(0, 80)})` : ''}`)
      return (await this.table())[id]
    },

    /** A plat PDF → calls, streets, front, confidence; the PDF is kept for the drafter. */
    async readPlat({ name, data, page, mediaType }) {
      if (!interpreter.configured) throw fail(503, 'the plat reader needs the office Claude key')
      if (!data) throw fail(400, 'file data required')
      const buf = Buffer.from(data, 'base64')
      if (buf.length > 12 * 1024 * 1024) throw fail(413, 'file over 12 MB; export just the plat page')
      const isPdf = buf.subarray(0, 4).toString() === '%PDF'
      const isPng = buf[0] === 0x89 && buf.subarray(1, 4).toString() === 'PNG'
      const isJpg = buf[0] === 0xff && buf[1] === 0xd8
      if (!isPdf && !isPng && !isJpg) throw fail(400, 'upload a PDF, PNG or JPEG')
      const type = isPdf ? 'application/pdf' : isPng ? 'image/png' : 'image/jpeg'
      const ext = isPdf ? 'pdf' : isPng ? 'png' : 'jpg'
      const platId = 'plat_' + crypto.randomBytes(5).toString('hex')
      await files.putRaw(`plats/${platId}.${ext}`, buf, type)
      const out = await interpreter.parseDocument({
        data,
        mediaType: type,
        system: PLAT_SYSTEM,
        prompt: `Read the lot boundary from this ${name || 'plat'}${page ? `, page ${page}` : ''}. Return the calls, streets, front side, setbacks printed on it, the page box and north direction.`,
        schema: PLAT_SCHEMA,
        maxTokens: 3000,
      })
      let closure = null
      let areaSf = null
      let error = null
      try {
        const t = traverse(out.calls)
        closure = t.closure
        areaSf = Math.round(t.areaSf)
      } catch (e) {
        error = e.message
      }
      const rec = { platId, name, ext, ...out, closure, areaSf, traverseError: error, usage: out.usage, cost: out.cost, ms: out.ms, at: now() }
      await store.meta.set(`plat:${platId}`, rec)
      await event('design', `plat "${name || platId}" read: ${out.calls?.length || 0} calls, ${areaSf ? `${areaSf.toLocaleString()} sf` : 'does not traverse'}, confidence ${Math.round((out.confidence || 0) * 100)}%, $${(out.cost || 0).toFixed(3)}`)
      return rec
    },
    async plat(platId) {
      return store.meta.get(`plat:${platId}`)
    },

    /** The geocode already made for an address, from the cache only (no outside call), or null. */
    async geocodeCached(address) {
      const a = String(address || '').trim()
      if (a.length < 6) return null
      const hit = await store.meta.get('geo:' + a.toLowerCase().replace(/\s+/g, ' '))
      return hit && hit.v === 2 && Date.now() - Date.parse(hit.at) < 30 * 86400000 ? hit : null
    },
    /** Where an address is: the Census geocoder's match, with city, county, state and the street name. */
    async geocode(address) {
      const a = String(address || '').trim()
      if (a.length < 6) throw fail(400, 'address required')
      if (a.length > 200) throw fail(400, 'the address is too long (200 characters at most)')
      const key = 'geo:' + a.toLowerCase().replace(/\s+/g, ' ')
      const cached = await store.meta.get(key)
      if (cached && cached.v === 2 && Date.now() - Date.parse(cached.at) < 30 * 86400000) return { ...cached, cached: true }
      let geo
      try {
        geo = await fetch(`https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress?address=${encodeURIComponent(a)}&benchmark=Public_AR_Current&vintage=Current_Current&layers=Counties,Incorporated%20Places&format=json`, { signal: AbortSignal.timeout(12000) })
      } catch (e) {
        if (e?.code === 'DH_NETWORK_GUARD') throw e
        throw fail(502, CENSUS_DOWN, { upstream: 'census' })
      }
      if (!geo.ok) throw fail(502, CENSUS_DOWN, { upstream: 'census' })
      let match
      try {
        match = (await geo.json()).result?.addressMatches?.[0]
      } catch (e) {
        throw fail(502, CENSUS_DOWN, { upstream: 'census' })
      }
      const table = await this.table()
      let rec
      if (!match) rec = { v: 2, address: a, found: false, note: 'The Census geocoder did not find this address. Check the street number and the city, or type the lot in.', at: now() }
      else {
        const c = match.addressComponents || {}
        const title = (t) => String(t || '').replace(/\b\w+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
        const incorporated = match.geographies?.['Incorporated Places']?.[0]?.NAME // "McAllen city": the Census appends the kind
        const place = incorporated ? title(incorporated.replace(/ (city|town|village|CDP|municipality)$/i, '')) : title(c.city)
        const county = match.geographies?.Counties?.[0]?.NAME || ''
        const street = [c.preDirection, c.streetName, c.suffixType, c.suffixDirection].filter(Boolean).join(' ')
        // the jurisdiction (round 7, item 2): a city row when we have one, the county's row inside the eight counties, else none
        const j = jurisdictionFor({ place, county })
        const cityId = j?.type === 'city' ? j.id : null
        const placeName = cityId ? table[cityId].name.split(',')[0] : place
        // round 10, item 3: 1300 W Nolana typed, 1300 E NOLANA matched: say so, and offer no parcel until the homeowner agrees
        const mismatch = addressMismatch(a, match.matchedAddress)
        const geo = { v: 2, address: a, found: true, mismatch, matched: match.matchedAddress, lat: match.coordinates.y, lon: match.coordinates.x, place: placeName || null, county: county || null, state: c.state || null, zip: c.zip || null, street: street || null, cityId, countyRow: j?.type === 'county' ? j.id : cityId ? null : countyRowId(county), jurisdiction: j, supported: !!j }
        rec = { ...geo, note: geoMessage(geo), at: now() }
      }
      await store.meta.set(key, rec)
      return rec
    },

    /**
     * FEMA flood zone at a point (round 7, item 4): first whether a digital FIRM covers the spot at all (NFHL layer 0);
     * when none does the answer is 'no-digital-firm' with sfha null, never "outside the flood area". Then the zone
     * (layer 28), any effective Letter of Map Revision (layer 3), and preliminary changes (layers 21 and 34).
     * The point should be inside the parcel (the parcel's interior point), not the street point.
     */
    async floodAt({ lat, lon, address = null, matched = null, where = 'the parcel' }) {
      if (!(Number.isFinite(+lat) && Number.isFinite(+lon))) throw fail(400, 'lat and lon required')
      const key = `flood:@${(+lat).toFixed(5)},${(+lon).toFixed(5)}`
      const cached = await store.meta.get(key)
      if (cached && cached.v === 2 && Date.now() - Date.parse(cached.at) < 30 * 86400000) return { ...cached, address, matched, cached: true }
      // NFHL layers as the service publishes them (round 9, item 3): 3 FIRM Panels (DFIRM_ID, FIRM_PAN, EFF_DATE), 28 Flood
      // Hazard Zones, 1 LOMRs, 34 LOMAs. Layer 0 (NFHL Availability) only has STUDY_ID. Preliminary data is not in the
      // public NFHL MapServer: not queried, and the record says so.
      const base = { v: 2, address, matched, lat: +lat, lon: +lon, where, source: 'FEMA National Flood Hazard Layer (FIRM panels layer 3, zones 28, LOMRs 1, LOMAs 34) at the parcel interior point', prelim: null, prelimNote: 'Preliminary maps are not in the public NFHL service; the drafter checks FEMA\'s preliminary viewer before the permit set.', at: now() }
      // the two layers the answer stands on first (3 FIRM panels, 28 zones); the soft ones (0 availability, 1 LOMRs,
      // 34 LOMAs) only after those answered, so a bad minute at FEMA costs two calls, not five (round 11, item 4)
      const [panels, zones] = await Promise.all([nfhl(3, lon, lat, 'DFIRM_ID,FIRM_PAN,EFF_DATE,PANEL_TYP'), nfhl(28, lon, lat, 'FLD_ZONE,ZONE_SUBTY,SFHA_TF,STATIC_BFE,DFIRM_ID,FLD_AR_ID,DEPTH')])
      const avail = panels.length || zones.length ? [] : await nfhl(0, lon, lat, 'STUDY_ID', { soft: true }).catch(() => [])
      if (!panels.length && !zones.length && !avail.length) {
        const rec = { ...base, status: 'no-digital-firm', zone: null, subtype: null, sfha: null, bfe: null, firm: null, panel: null, lomr: null, loma: null, note: 'FEMA has no digital flood map (FIRM) for this spot, so no zone can be read here. The county floodplain administrator and the paper map decide; the office checks before the slab height is set.' }
        await store.meta.set(key, rec)
        return rec
      }
      const [lomrs, lomas] = await Promise.all([nfhl(1, lon, lat, 'CASE_NO,EFF_DATE,STATUS,LOMR_ID', { soft: true }).catch(() => []), nfhl(34, lon, lat, 'CASENUMBER,STATUS,DETERMINATIONTYPE,DATEENDED', { soft: true }).catch(() => [])])
      const f = zones[0] || null
      const sfha = f ? f.SFHA_TF === 'T' : null
      const shadedX = !!f && f.FLD_ZONE === 'X' && /0\.2 PCT|LEVEE|FLOODWAY/i.test(f.ZONE_SUBTY || '')
      const date = (d) => (d ? new Date(+d || d).toISOString().slice(0, 10) : null)
      const lomr = lomrs.filter((l) => !l.STATUS || /effective/i.test(l.STATUS)).map((l) => ({ caseNo: l.CASE_NO || null, effective: date(l.EFF_DATE), id: l.LOMR_ID || null }))
      const loma = lomas.map((l) => ({ caseNo: l.CASENUMBER || null, status: l.STATUS || null, determination: l.DETERMINATIONTYPE || null, ended: date(l.DATEENDED) }))
      const status = !f ? 'unmapped' : sfha ? 'sfha' : shadedX ? 'shaded-x' : 'x'
      const notes = []
      if (!f) notes.push('A digital map covers this area but no flood zone polygon sits on this point; the drafter reads the FIRM panel.')
      else if (sfha) notes.push(`Inside a FEMA special flood hazard area (zone ${f.FLD_ZONE}${f.ZONE_SUBTY ? ', ' + f.ZONE_SUBTY.toLowerCase() : ''}): the slab elevation and flood insurance follow the base flood elevation${f.STATIC_BFE != null && f.STATIC_BFE > -9000 ? ` (${f.STATIC_BFE} ft)` : ''}.`)
      else if (shadedX) notes.push('Zone X (shaded): the 0.2% annual-chance flood area. Outside the 1% area, but lenders and the city may still ask for an elevation certificate.')
      else notes.push('Zone X: outside the 1% annual-chance flood area on the current FEMA map.')
      if (lomr.length) notes.push(`A Letter of Map Revision changed the map here (case ${lomr.map((l) => l.caseNo).filter(Boolean).join(', ') || 'on file'}${lomr[0].effective ? `, effective ${lomr[0].effective}` : ''}); the drafter reads the LOMR, which wins over the panel.`)
      if (loma.length) notes.push(`A Letter of Map Amendment is on file at this spot (LOMA case ${loma.map((l) => l.caseNo).filter(Boolean).join(', ') || 'on file'}${loma[0].determination ? `, ${loma[0].determination}` : ''}); it removes a structure or lot from the flood zone on paper, and the drafter reads it.`)
      const rec = { ...base, status, zone: f?.FLD_ZONE || null, subtype: f?.ZONE_SUBTY || null, sfha, bfe: f?.STATIC_BFE != null && f.STATIC_BFE > -9000 ? f.STATIC_BFE : null, firm: f?.DFIRM_ID || panels[0]?.DFIRM_ID || avail[0]?.STUDY_ID || null, panel: panels[0]?.FIRM_PAN || null, firmEffective: date(panels[0]?.EFF_DATE), lomr: lomr.length ? lomr : null, loma: loma.length ? loma : null, note: notes.join(' ') }
      await store.meta.set(key, rec)
      return rec
    },
    /** FEMA flood zone for an address: the Census street point (a parcel's interior point is better; the Lot step sends one when it has the parcel). */
    async flood(address) {
      const a = String(address || '').trim()
      if (a.length < 6) throw fail(400, 'address required')
      const geo = await this.geocode(a)
      if (!geo.found) return { address: a, matched: null, status: 'no-address', zone: null, sfha: null, note: 'The Census geocoder did not find this address. Try the full street address with the city.', at: now() }
      return this.floodAt({ lat: geo.lat, lon: geo.lon, address: a, matched: geo.matched, where: 'the street point in front of the lot (no parcel yet)' })
    },

    /** Rebuild a project's lot from its spec, so geometry from a browser is never trusted. */
    async lotOfProject(p) {
      const table = await this.table()
      return p.lot?.spec && p.lot.spec.kind !== 'reference' ? { ...buildLot(p.lot.spec, table), plat: p.lot.plat || null } : buildLot({ kind: 'reference' })
    },
  }
}
