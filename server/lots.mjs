// Lots on the server: the city rules table (editable on the dashboard), reading a plat PDF with
// Claude into calls, and the FEMA flood zone for an address.
import crypto from 'node:crypto'
import { cityTable, CITY_IDS, RULE_FIELDS } from '../src/draft/lib/cities.js'
import { jurisdictionTable, jurisdictionFor, geoMessage, countyRowId, ALL_FIELDS } from '../src/draft/lib/jurisdictions.js'
const pick = (o) => Object.fromEntries(Object.entries(o || {}).filter(([k]) => /^(CASE_NO|EFF_DATE|STATUS|FLD_ZONE|ZONE_SUBTY|SFHA_TF|STATIC_BFE|FIRM_PAN|PANEL|DFIRM_ID|PRELIM_DATE|PRE_DATE)$/i.test(k)))
import { buildLot, traverse } from '../src/draft/lib/lot.js'

const fail = (status, error) => Object.assign(new Error(error), { status })

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

export function makeLots({ env = process.env, store, files, interpreter, event, log = console.log, fetchImpl = globalThis.fetch }) {
  const now = () => new Date().toISOString()
  const fetch = fetchImpl
  const NFHL = 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer'
  /** One NFHL layer at a point: the features' attributes (empty when none). */
  async function nfhl(layer, lon, lat, outFields) {
    const q = new URLSearchParams({ geometry: `${lon},${lat}`, geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields, returnGeometry: 'false', f: 'json' })
    const r = await fetch(`${NFHL}/${layer}/query?${q}`, { signal: AbortSignal.timeout(15000) })
    if (!r.ok) throw fail(502, `FEMA answered ${r.status}`)
    const body = await r.json()
    if (body.error) throw fail(502, `FEMA: ${body.error.message || 'query error'}`)
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

    /** Where an address is: the Census geocoder's match, with city, county, state and the street name. */
    async geocode(address) {
      const a = String(address || '').trim()
      if (a.length < 6) throw fail(400, 'address required')
      const key = 'geo:' + a.toLowerCase().replace(/\s+/g, ' ')
      const cached = await store.meta.get(key)
      if (cached && Date.now() - Date.parse(cached.at) < 30 * 86400000) return cached
      const geo = await fetch(`https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress?address=${encodeURIComponent(a)}&benchmark=Public_AR_Current&vintage=Current_Current&layers=Counties,Incorporated%20Places&format=json`, { signal: AbortSignal.timeout(12000) })
      if (!geo.ok) throw fail(502, `geocoder answered ${geo.status}`)
      const match = (await geo.json()).result?.addressMatches?.[0]
      const table = await this.table()
      let rec
      if (!match) rec = { address: a, found: false, note: 'The Census geocoder did not find this address. Check the street number and the city, or type the lot in.', at: now() }
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
        const geo = { address: a, found: true, matched: match.matchedAddress, lat: match.coordinates.y, lon: match.coordinates.x, place: placeName || null, county: county || null, state: c.state || null, zip: c.zip || null, street: street || null, cityId, countyRow: j?.type === 'county' ? j.id : cityId ? null : countyRowId(county), jurisdiction: j, supported: !!j }
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
      if (cached && Date.now() - Date.parse(cached.at) < 30 * 86400000) return { ...cached, address, matched }
      const base = { address, matched, lat: +lat, lon: +lon, where, source: 'FEMA National Flood Hazard Layer (layers 0, 28, 3, 21, 34) at the parcel interior point', at: now() }
      const avail = await nfhl(0, lon, lat, 'DFIRM_ID,ST_FIPS,CO_FIPS,STUDY_TYP,EFF_DATE')
      if (!avail.length) {
        const rec = { ...base, status: 'no-digital-firm', zone: null, subtype: null, sfha: null, bfe: null, firm: null, lomr: null, prelim: null, note: 'FEMA has no digital flood map (FIRM) for this spot, so no zone can be read here. The county floodplain administrator and the paper map decide; the office checks before the slab height is set.' }
        await store.meta.set(key, rec)
        return rec
      }
      const [zones, lomrs, prelimA, prelimB] = await Promise.all([nfhl(28, lon, lat, 'FLD_ZONE,ZONE_SUBTY,SFHA_TF,STATIC_BFE,DFIRM_ID,FLD_AR_ID,DEPTH'), nfhl(3, lon, lat, 'CASE_NO,EFF_DATE,STATUS,SCALE').catch(() => []), nfhl(21, lon, lat, '*').catch(() => []), nfhl(34, lon, lat, '*').catch(() => [])])
      const f = zones[0] || null
      const sfha = f ? f.SFHA_TF === 'T' : null
      const shadedX = !!f && f.FLD_ZONE === 'X' && /0\.2 PCT|LEVEE|FLOODWAY/i.test(f.ZONE_SUBTY || '')
      const lomr = lomrs.filter((l) => !l.STATUS || /effective/i.test(l.STATUS)).map((l) => ({ caseNo: l.CASE_NO || null, effective: l.EFF_DATE ? new Date(+l.EFF_DATE || l.EFF_DATE).toISOString().slice(0, 10) : null }))
      const prelim = [...prelimA.map((p) => ({ layer: 21, ...pick(p) })), ...prelimB.map((p) => ({ layer: 34, ...pick(p) }))]
      const status = !f ? 'unmapped' : sfha ? 'sfha' : shadedX ? 'shaded-x' : 'x'
      const notes = []
      if (!f) notes.push('A digital map covers this area but no flood zone polygon sits on this point; the drafter reads the FIRM panel.')
      else if (sfha) notes.push(`Inside a FEMA special flood hazard area (zone ${f.FLD_ZONE}${f.ZONE_SUBTY ? ', ' + f.ZONE_SUBTY.toLowerCase() : ''}): the slab elevation and flood insurance follow the base flood elevation${f.STATIC_BFE != null && f.STATIC_BFE > -9000 ? ` (${f.STATIC_BFE} ft)` : ''}.`)
      else if (shadedX) notes.push('Zone X (shaded): the 0.2% annual-chance flood area. Outside the 1% area, but lenders and the city may still ask for an elevation certificate.')
      else notes.push('Zone X: outside the 1% annual-chance flood area on the current FEMA map.')
      if (lomr.length) notes.push(`A Letter of Map Revision changed the map here (case ${lomr.map((l) => l.caseNo).filter(Boolean).join(', ') || 'on file'}${lomr[0].effective ? `, effective ${lomr[0].effective}` : ''}); the drafter reads the LOMR, which wins over the panel.`)
      if (prelim.length) notes.push('FEMA has a preliminary map change in progress for this area; the zone may change before the permit. The drafter checks the preliminary panel.')
      const rec = { ...base, status, zone: f?.FLD_ZONE || null, subtype: f?.ZONE_SUBTY || null, sfha, bfe: f?.STATIC_BFE != null && f.STATIC_BFE > -9000 ? f.STATIC_BFE : null, firm: f?.DFIRM_ID || avail[0]?.DFIRM_ID || null, firmEffective: avail[0]?.EFF_DATE ? new Date(+avail[0].EFF_DATE || avail[0].EFF_DATE).toISOString().slice(0, 10) : null, lomr: lomr.length ? lomr : null, prelim: prelim.length ? prelim : null, note: notes.join(' ') }
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
