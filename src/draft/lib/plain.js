// Plain words for the homeowner's screens (round 12, item D). The rules, the drafter's card and the office keep the
// word "setback"; a homeowner reads what it means: the space the city keeps open along each edge of the lot.

const edgeWords = (edge) => {
  const e = String(edge || '').trim().toLowerCase()
  if (e === 'side') return 'the side of the lot'
  if (e === 'rear') return 'the back of the lot'
  if (e === 'front') return 'the street'
  // a street's name: the street side
  return `the street side (${e.replace(/\b\w/g, (c) => c.toUpperCase())})`
}

/** A rule's reason, or any line written for the office, in a homeowner's words: never "setback". */
export function plainReason(text) {
  let t = String(text ?? '')
  if (!/setback/i.test(t)) return t
  // "Bedroom 2 would cross the setback at 6 ft from side." → "Bedroom 2 would sit too close to the side of the lot (the city keeps 6 ft open there)."
  t = t.replace(/would cross the setback at (\d+(?:\.\d+)?) ft from ([^.]+)\./gi, (_, ft, edge) => `would sit too close to ${edgeWords(edge)} (the city keeps ${ft} ft open there).`)
  t = t.replace(/does not fit the setbacks/gi, 'does not fit in the space left by the city’s rules')
  t = t.replace(/(inside|within) the setbacks/gi, 'inside the space the city lets you build on')
  t = t.replace(/the setbacks leave no buildable area/gi, 'the space the city keeps open along the edges leaves no room to build')
  t = t.replace(/the setbacks/gi, 'the space the city keeps open along the edges of the lot')
  t = t.replace(/setbacks/gi, 'the space the city keeps open along the edges of the lot')
  t = t.replace(/\b(a|the) setback\b/gi, 'the space the city keeps open along that edge')
  t = t.replace(/setback/gi, 'space the city keeps open')
  return t
}
