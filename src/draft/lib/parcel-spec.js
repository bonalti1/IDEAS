import { traverse } from './lot.js'
// The lot spec of a county parcel (round 7, item 7; round 10, item 1), apart from the Lot screen so the server-side tests can build the same lot the screen does.

/** A parcel from the appraisal district as a lot spec: its calls, the front edge on the street, the ids the drafter needs. */
export function parcelSpec(parcel, { address, city, county, geo, flood, zoning, confirmed = false }) {
  const n = parcel.calls.length
  const front = parcel.frontEdge ?? 0
  // round 10, item 1: the front, the street side of a corner lot and the rear come from the parcel lookup (the edge on
  // the named road); an older record without them falls back to the front and the edge opposite it
  const kinds = parcel.edgeKinds?.length === n ? parcel.edgeKinds : parcel.calls.map((_, i) => (i === front ? 'front' : i === (front + Math.floor(n / 2)) % n ? 'rear' : 'side'))
  const nice = (t) => String(t || '').replace(/\b\w+/g, (w) => (/^(FM|US|TX|N|S|E|W|NE|NW|SE|SW)$/.test(w) ? w : w[0] + w.slice(1).toLowerCase()))
  const named = (parcel.streets || []).filter((s) => s.role === 'front' || s.role === 'side').map((s) => ({ edge: s.edge, name: s.name }))
  return {
    kind: 'parcel',
    address,
    city: city || '',
    county: county || parcel.county || '',
    calls: parcel.calls,
    streets: named.length ? named : [{ edge: front, name: geo?.street ? nice(geo.street) : 'street' }],
    front,
    kinds,
    cornerLot: !!parcel.corner,
    frontBy: parcel.frontBy || null,
    frontWidthFt: parcel.frontWidthFt || null,
    setbacks: {},
    confirmed,
    propId: parcel.propId,
    geoId: parcel.geoId,
    legal: parcel.legal,
    acres: parcel.acres,
    source: parcel.source,
    parcelFetchedAt: parcel.source?.fetchedAt || null,
    matchedBy: parcel.matchedBy,
    confidence: parcel.confidence,
    interior: parcel.interior,
    flood: flood || null,
    zoning: zoning || null,
  }
}

/**
 * What the drafter must know about how a parcel lot was matched before confirming it (round 12, item 1). The
 * fields are stamped by the server from its own parcel record, never taken from the browser. Plain lines, each a
 * warning; an exact match has none. `lang` 'es' gives the same lines in Spanish (round 13); the drafter's card is English.
 */
export function lotMatchNotes(spec, lang = 'en') {
  if (!spec || spec.kind !== 'parcel') return []
  if (lang === 'es') return lotMatchNotesEs(spec)
  const typed = String(spec.address || '').split(',')[0].trim() || 'the address typed'
  const notes = []
  if (spec.confidence === 'near' && spec.listedAs) notes.push(`Near match: the county lists this parcel as ${spec.listedAs}, not ${typed}. Check the deed or plat before confirming.`)
  if (spec.confidence === 'pick')
    notes.push(
      spec.addressGives
        ? `The address leads to parcel ${spec.addressGives}, but this lot names parcel ${spec.propId}${spec.situs ? ` (listed as ${spec.situs})` : ''}. Check the deed or plat before confirming.`
        : `The address alone did not settle the parcel: this one${spec.situs ? ` (listed as ${spec.situs})` : ''} was picked. Check the deed or plat before confirming.`,
    )
  if (spec.outlineBy === 'browser' || spec.confidence === 'unchecked') notes.push(UNCHECKED_LINE)
  return notes
}
/** Round 13, M1: the drafter's red line on a parcel lot whose outline the server could not check against the county. */
export const UNCHECKED_LINE = 'Lot outline not checked against the county (county did not answer). Check it before confirming.'
export const isUnchecked = (spec) => !!spec && spec.kind === 'parcel' && (spec.outlineBy === 'browser' || spec.confidence === 'unchecked')

function lotMatchNotesEs(spec) {
  const typed = String(spec.address || '').split(',')[0].trim() || 'la dirección que se escribió'
  const notes = []
  if (spec.confidence === 'near' && spec.listedAs) notes.push(`Coincidencia cercana: el condado tiene este lote como ${spec.listedAs}, no como ${typed}. Revisa la escritura o el plat antes de confirmar.`)
  if (spec.confidence === 'pick')
    notes.push(
      spec.addressGives
        ? `La dirección lleva al lote ${spec.addressGives} del condado, pero este es el lote ${spec.propId}${spec.situs ? ` (registrado como ${spec.situs})` : ''}. Revisa la escritura o el plat antes de confirmar.`
        : `La dirección sola no bastó para saber cuál es el lote: se eligió este${spec.situs ? ` (registrado como ${spec.situs})` : ''}. Revisa la escritura o el plat antes de confirmar.`,
    )
  if (spec.outlineBy === 'browser' || spec.confidence === 'unchecked') notes.push('El condado no respondió cuando se guardó este lote, así que su contorno todavía no se ha revisado con el condado. Se revisa cuando confirmes.')
  return notes
}

/**
 * Round 13: the sides of a county parcel the way a homeowner says them, not as a surveyor's bearings: the front,
 * the left and right sides as seen from the street, and the back, each with its length in whole feet. A curved
 * front is one side with the total of its pieces; small corner cuts belong to the side they sit on.
 * Returns [{ key: 'front' | 'left' | 'right' | 'back', ft, pieces, street }] in that order, or [] when the record
 * cannot be read that way (the Lot step then says only the number of sides and the area).
 */
export function lotSides(parcel) {
  try {
    const edges = parcel?.edges || []
    const kinds = parcel?.edgeKinds || []
    const n = edges.length
    if (n < 3 || kinds.length !== n || !Array.isArray(parcel.calls) || parcel.calls.length !== n) return []
    const isFront = (i) => kinds[i] === 'front'
    if (!kinds.some((k) => k === 'front')) return []
    // the front run: from the first front piece after a piece that is not front, around to the last
    let fs = 0
    for (let i = 0; i < n; i++) if (isFront(i) && !isFront((i - 1 + n) % n)) fs = i
    let len = 0
    while (len < n && isFront((fs + len) % n)) len++
    if (len >= n) return []
    const pts = traverse(parcel.calls).corners
    const a = pts[fs]
    const b = pts[(fs + len) % n] || pts[0]
    const cx = pts.slice(0, n).reduce((t, q) => t + q[0], 0) / n
    const cz = pts.slice(0, n).reduce((t, q) => t + q[1], 0) / n
    // facing the lot from the street: which hand the end of the front is on (x east, z south)
    const f = [cx - (a[0] + b[0]) / 2, cz - (a[1] + b[1]) / 2]
    const endOnRight = (b[0] - a[0]) * -f[1] + (b[1] - a[1]) * f[0] > 0
    const rest = []
    for (let k = 0; k < n - len; k++) rest.push((fs + len + k) % n)
    const rearAt = rest.findIndex((i) => kinds[i] === 'rear')
    const lastRear = rest.length - 1 - [...rest].reverse().findIndex((i) => kinds[i] === 'rear')
    const side = { front: { ft: 0, pieces: 0 }, left: { ft: 0, pieces: 0 }, right: { ft: 0, pieces: 0 }, back: { ft: 0, pieces: 0 } }
    const add = (key, i) => {
      side[key].ft += +edges[i].lengthFt || 0
      side[key].pieces++
      const st = (parcel.streets || []).find((x) => x.edge === i && x.role !== 'rear')
      if (st && !side[key].street) side[key].street = st.name
    }
    for (let k = 0; k < len; k++) add('front', (fs + k) % n)
    const firstHand = endOnRight ? 'right' : 'left'
    const secondHand = endOnRight ? 'left' : 'right'
    rest.forEach((i, at) => {
      if (kinds[i] === 'rear') return add('back', i)
      if (rearAt < 0) return add(at < rest.length / 2 ? firstHand : secondHand, i)
      add(at < rearAt ? firstHand : at > lastRear ? secondHand : 'back', i)
    })
    if (!side.front.street) side.front.street = (parcel.streets || []).find((x) => x.role === 'front')?.name || parcel.frontStreet || null
    return ['front', 'left', 'right', 'back'].filter((k) => side[k].pieces).map((k) => ({ key: k, ft: Math.round(side[k].ft), pieces: side[k].pieces, street: side[k].street || null }))
  } catch {
    return []
  }
}
