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
