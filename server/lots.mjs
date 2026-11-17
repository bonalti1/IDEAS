// Lots on the server: the city rules table (editable on the dashboard), reading a plat PDF with
// Claude into calls, and the FEMA flood zone for an address.
import crypto from 'node:crypto'
import { cityTable, CITY_IDS, RULE_FIELDS } from '../src/draft/lib/cities.js'
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

export function makeLots({ env = process.env, store, files, interpreter, event, log = console.log }) {
  const now = () => new Date().toISOString()

  return {
    async table() {
      return cityTable((await store.meta.get('cities')) || {})
    },
    async setCity(id, patch, who) {
      if (!CITY_IDS.includes(id)) throw fail(404, 'unknown city')
      const saved = (await store.meta.get('cities')) || {}
      const cur = saved[id] || {}
      for (const k of RULE_FIELDS) if (patch[k] !== undefined && patch[k] !== '') cur[k] = +patch[k]
      if (patch.verified !== undefined) cur.verified = !!patch.verified
      if (patch.zoning !== undefined) cur.zoning = String(patch.zoning).slice(0, 80)
      if (patch.note !== undefined) cur.note = String(patch.note).slice(0, 300)
      cur.updatedAt = now()
      cur.updatedBy = who?.email || null
      saved[id] = cur
      await store.meta.set('cities', saved)
      await event('worker', `${who?.email || 'office'} updated the ${id} city rules`)
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
        const cityId = Object.keys(table).find((id) => id !== 'hidalgo' && table[id].name.split(',')[0].toLowerCase() === String(place).toLowerCase()) || null
        const inCounty = /hidalgo/i.test(county)
        const placeName = cityId ? table[cityId].name.split(',')[0] : place
        rec = { address: a, found: true, matched: match.matchedAddress, lat: match.coordinates.y, lon: match.coordinates.x, place: placeName || null, county: county || null, state: c.state || null, zip: c.zip || null, street: street || null, cityId, supported: !!cityId || inCounty, note: cityId ? null : inCounty ? `${place || 'This address'} is in ${county} but not one of the cities we have rules for; county rules are used and a drafter checks them.` : `${place ? place + ', ' + (c.state || '') : 'This address'} is outside the area we build in (${Object.values(table).map((t) => t.name.split(',')[0]).filter((n) => !/County/.test(n)).join(', ')} and Hidalgo County). You can still draft; the setbacks shown are our county defaults.`, at: now() }
      }
      await store.meta.set(key, rec)
      return rec
    },

    /** FEMA flood zone for an address: Census geocoder, then the National Flood Hazard Layer. */
    async flood(address) {
      const a = String(address || '').trim()
      if (a.length < 6) throw fail(400, 'address required')
      const key = 'flood:' + a.toLowerCase().replace(/\s+/g, ' ')
      const cached = await store.meta.get(key)
      if (cached && Date.now() - Date.parse(cached.at) < 30 * 86400000) return cached
      const geo = await fetch(`https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(a)}&benchmark=Public_AR_Current&format=json`, { signal: AbortSignal.timeout(12000) })
      if (!geo.ok) throw fail(502, `geocoder answered ${geo.status}`)
      const match = (await geo.json()).result?.addressMatches?.[0]
      if (!match) {
        const rec = { address: a, matched: null, zone: null, sfha: false, note: 'The Census geocoder did not find this address. Try the full street address with the city.', at: now() }
        await store.meta.set(key, rec)
        return rec
      }
      const { x: lon, y: lat } = match.coordinates
      const q = new URLSearchParams({ geometry: `${lon},${lat}`, geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: 'FLD_ZONE,ZONE_SUBTY,SFHA_TF,STATIC_BFE,DFIRM_ID', returnGeometry: 'false', f: 'json' })
      const fema = await fetch(`https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query?${q}`, { signal: AbortSignal.timeout(15000) })
      if (!fema.ok) throw fail(502, `FEMA answered ${fema.status}`)
      const f = (await fema.json()).features?.[0]?.attributes
      const rec = {
        address: a,
        matched: match.matchedAddress,
        lat,
        lon,
        zone: f?.FLD_ZONE || null,
        subtype: f?.ZONE_SUBTY || null,
        sfha: f?.SFHA_TF === 'T',
        bfe: f?.STATIC_BFE != null && f.STATIC_BFE > -9000 ? f.STATIC_BFE : null,
        firm: f?.DFIRM_ID || null,
        note: f ? (f.SFHA_TF === 'T' ? 'Inside a FEMA special flood hazard area: the slab elevation and flood insurance follow the base flood elevation.' : 'Outside the 1% annual-chance flood area on the current FEMA map.') : 'No FEMA flood zone polygon at this point (unmapped area).',
        source: 'FEMA NFHL layer 28 via Census geocoder',
        at: now(),
      }
      await store.meta.set(key, rec)
      return rec
    },

    /** Rebuild a project's lot from its spec, so geometry from a browser is never trusted. */
    async lotOfProject(p) {
      const table = await this.table()
      return p.lot?.spec && p.lot.spec.kind !== 'reference' ? { ...buildLot(p.lot.spec, table), plat: p.lot.plat || null } : buildLot({ kind: 'reference' })
    },
  }
}
