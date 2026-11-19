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
 * warning; an exact match has none.
 */
export function lotMatchNotes(spec) {
  if (!spec || spec.kind !== 'parcel') return []
  const typed = String(spec.address || '').split(',')[0].trim() || 'the address typed'
  const notes = []
  if (spec.confidence === 'near' && spec.listedAs) notes.push(`Near match: the county lists this parcel as ${spec.listedAs}, not ${typed}. Check the deed or plat before confirming.`)
  if (spec.confidence === 'pick')
    notes.push(
      spec.addressGives
        ? `The address leads to parcel ${spec.addressGives}, but this lot names parcel ${spec.propId}${spec.situs ? ` (listed as ${spec.situs})` : ''}. Check the deed or plat before confirming.`
        : `The address alone did not settle the parcel: this one${spec.situs ? ` (listed as ${spec.situs})` : ''} was picked. Check the deed or plat before confirming.`,
    )
  if (spec.outlineBy === 'browser' || spec.confidence === 'unchecked') notes.push('The county did not answer when this lot was saved, so its outline has not been checked against the county yet. It is checked when you confirm.')
  return notes
}
