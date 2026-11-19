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
  const raw = String(text ?? '')
  if (!/setback/i.test(raw)) return raw
  // a sentence that began with the word keeps its capital letter
  const out = swap(raw)
  return out.replace(/(^|[.!?]\s+)([a-z])/g, (m, lead, ch, at) => (at === 0 || /[.!?]\s+$/.test(lead) ? lead + ch.toUpperCase() : m))
}
function swap(text) {
  let t = text
  // "Bedroom 2 would cross the setback at 6 ft from side." → "Bedroom 2 would sit too close to the side of the lot (the city keeps 6 ft open there)."
  t = t.replace(/would cross the setback at (\d+(?:\.\d+)?) ft from ([^.]+)\./gi, (_, ft, edge) => `would sit too close to ${edgeWords(edge)} (the city keeps ${ft} ft open there).`)
  // the chat's phrasings: "the 6 ft side setback", "the 20 ft setback from Kiskadee Ln", "runs past the setbacks on this lot"
  t = t.replace(/the (\d+(?:\.\d+)?) ft (side|rear|front|street[- ]side) setback/gi, (_, ft, edge) => `the ${ft} ft the city keeps open ${/side/i.test(edge) && !/street/i.test(edge) ? 'on the side of the lot' : /rear/i.test(edge) ? 'at the back of the lot' : 'along the street'}`)
  t = t.replace(/the (\d+(?:\.\d+)?) ft setback from ([^.,;]+)/gi, (_, ft, edge) => `the ${ft} ft the city keeps open along ${edge.trim()}`)
  t = t.replace(/(runs?|run) past the setbacks(?: on this lot)?/gi, (_, v) => `${v} past the space the city lets you build on`)
  t = t.replace(/past the setbacks/gi, 'past the space the city lets you build on')
  t = t.replace(/street-side setback/gi, 'wider open space along the side street')
  t = t.replace(/does not fit the setbacks/gi, 'does not fit in the space left by the city’s rules')
  t = t.replace(/(inside|within) the setbacks/gi, 'inside the space the city lets you build on')
  t = t.replace(/the setbacks leave no buildable area/gi, 'the space the city keeps open along the edges leaves no room to build')
  t = t.replace(/the setbacks/gi, 'the space the city keeps open along the edges of the lot')
  t = t.replace(/setbacks/gi, 'the space the city keeps open along the edges of the lot')
  t = t.replace(/\b(a|the) setback\b/gi, 'the space the city keeps open along that edge')
  t = t.replace(/setback/gi, 'space the city keeps open')
  return t
}

// the rules by the names a homeowner would use (the drafter's panel and the office keep "Front setback" and the rest)
const HOME_LABELS = { front: 'Kept open at the street', side: 'Kept open on each side', rear: 'Kept open at the back', streetSide: 'Kept open on a side street', garageFt: 'Garage door from the street', maxCoverage: 'Lot a house may cover' }
/** A rule's name on a homeowner's screen or summary. */
export const homeLabel = (id, label) => HOME_LABELS[id] || plainReason(label || id)
