// Plain-language change requests → ops → rules → applied plan.
// Claude does the interpreting through the office API (key stays server-side);
// the regex fallback takes over when the API is unreachable or unsure.
import { api } from './api.js'
import { kitFor, lotOf, minSizeOf, maxSizeOf, planIdOf, isRoom, programOf, generateRooms, floorArea } from './layout.js'
import { validateOps, applyOps, regexOps, summarizeRooms, normalizeOps, splitClauses, splitCost, costReply } from './ops.js'
import { checkRules } from './rules.js'
import { fitsLot } from './fit.js'

const MIN_CONFIDENCE = 0.5
const MAX_PARTS = 3 // parts applied from one message; one change is used however many applied (round 8, item 29)
// the office said it has no interpreter: do not wait on it again for a while
let offlineUntil = 0

/** Calls the office interpreter. Throws when it cannot. */
export async function claudeInterpreter({ text, rooms, program, kit, lot }) {
  if (Date.now() < offlineUntil) throw Object.assign(new Error('interpreter not configured'), { unconfigured: true })
  let res
  try {
    res = await api.interpret({
    text,
    rooms: summarizeRooms(rooms),
    program,
    lot,
    kit: { id: kit.id, name: kit.name, kinds: Object.fromEntries(Object.entries(kit.rooms).map(([k, t]) => [k, { name: t.name, w: t.w, d: t.d, zone: t.zone }])), minSize: kit.rules?.minSize || {} },
    })
  } catch (e) {
    if (e.status === 503 && /not configured/i.test(e.message || '')) offlineUntil = Date.now() + 5 * 60000
    throw e
  }
  if (!res || !Array.isArray(res.ops)) throw new Error('interpreter returned no ops')
  return res
}

/**
 * @param {object} opts  { interpreter } to override the Claude call (tests), { lot }
 * @returns {{ applied: boolean, rooms, reply: string, source: 'claude'|'fallback', ops, reasons? }}
 */
export async function interpretRequest(text, rooms, program, style, opts = {}) {
  const kit = kitFor(style)
  // a cost question never reaches the model and never uses a change: the answer points to the meeting with
  // the office (round 8, M3); beside a change ("make it 2,400 sf, how much is that?") the change still runs
  const costQ = splitCost(text)
  if (costQ.cost && !costQ.text) return { applied: false, rooms, reply: costReply(costQ), source: 'fallback', ops: [], reasons: ['cost question'], askOffice: 'meeting' }
  text = costQ.text
  // "make the kitchen bigger and then make it smaller": the two parts cancel; say so, use nothing (round 9, item 11)
  const net = netsToNothing(text, rooms, kit)
  if (net) return { applied: false, rooms, reply: net, source: 'fallback', ops: [], reasons: ['no change'], noop: true }
  // what this style cannot do yet, said plainly, before any model is asked: clause by clause, so "make the
  // kitchen bigger and add a pool" does the kitchen and names the pool
  const split = dropUnsupported(text, style)
  if (!split.text) return { applied: false, rooms, reply: split.dropped.map((d) => d.why).join(' '), source: 'fallback', ops: [], unsupported: true, ...(costQ.cost ? { askOffice: 'meeting' } : {}) }
  text = split.text
  const interpreter = opts.interpreter || claudeInterpreter
  let diff
  let source = 'claude'
  try {
    diff = await interpreter({ text, rooms, program, kit, lot: opts.lot ? { spec: opts.lot.spec } : undefined })
    if (diff.source === 'fallback' || diff.source === 'timeout') source = diff.source // the office answered with the basic rules
  } catch (e) {
    diff = regexOps(text, rooms, kit, lotOf(opts.lot))
    source = /abort|timed? ?out|504/i.test(String(e?.name || '') + String(e?.message || '')) ? 'timeout' : 'fallback'
  }
  const result = decide(diff, rooms, program, style, kit, source, lotOf(opts.lot), { history: opts.history || [], unsupported: split.dropped })
  if (costQ.cost) {
    result.reply = `${String(result.reply || '').trim()} ${costReply(costQ)}`.trim()
    result.askOffice = 'meeting'
  }
  if (!opts.interpreter && opts.report !== false) api.verdict({ text, client: opts.lot?.client, source, applied: result.applied, reasons: result.reasons || [], reply: result.reply, ops: result.ops })
  return result
}

/**
 * A request with the clauses this style cannot take set aside: { text: what is left to interpret (joined with
 * "; "), dropped: [{ text, why }] }. With nothing left, text is '' and the answer is the dropped clauses' reasons.
 */
export function dropUnsupported(text, style) {
  const clauses = splitClauses(text)
  if (clauses.length <= 1) {
    const why = unsupported(text, style)
    return why ? { text: '', dropped: [{ text: String(text || '').trim(), why }] } : { text: String(text || '').trim(), dropped: [] }
  }
  const kept = []
  const dropped = []
  for (const c of clauses) {
    const why = unsupported(c, style)
    if (why) dropped.push({ text: c, why: why.replace(` ${CAN_DO}`, '') })
    else kept.push(c)
  }
  return { text: kept.join('; '), dropped }
}

/** What a request can change on a plan, for the answers below. */
export const CAN_DO = 'On the plan I can add or remove rooms and porches, make a room bigger or smaller, move a room beside another, and set the garage to 1, 2 or 3 cars.'

/**
 * A request this style cannot take yet, answered plainly (or null): a second story, colours and
 * finishes, and things no plan here has (a pool, a helipad, a basement). Checked before any model is
 * asked, so the answer is the same on the office server and in the fallback.
 */
export function unsupported(text, style) {
  const t = String(text || '').toLowerCase()
  const oneStory = (style?.stories || 1) === 1
  if (oneStory && /\b(two|2|second|another)[ -]?(story|stories|storey|floor|level)\b|\bupstairs\b|\btwo-story\b|\bsecond floor\b/.test(t)) return `${style?.name || 'This style'} is one story for now; a second story is on the list, not drawn yet. ${CAN_DO}`
  if (/\b(basement|cellar)\b/.test(t)) return `Houses here sit on a slab; there is no basement in this plan. ${CAN_DO}`
  if (/\b(helipad|heliport|pool|swimming|elevator|lift|casita|guest house|barn|workshop|shop building|tennis|bunker|moat|tower|turret)\b/.test(t)) return `That is not something this plan can hold (the lot and the kit draw the house only). ${CAN_DO}`
  if (/\b(paint|painted|colou?r|purple|pink|red|blue|green|yellow|orange|black|white|grey|gray|brick|stucco|stone|siding|shingles?|tile roof|metal roof|countertops?|cabinets?|flooring|carpet|hardwood)\b/.test(t) && !/\b(room|bedroom|bath|kitchen|garage|porch|office|closet|pantry|laundry|dining|living)\b.*\b(bigger|smaller|wider|deeper|add|remove)\b/.test(t)) return `Colours and finishes are picked with the drafter once the plan is set; the kit's finishes (board and batten, stone, shingles) are on the sheet. ${CAN_DO}`
  return null
}

/** Two room lists that draw the same house: same ids, same rectangles (to an inch), same elements. */
export function sameRooms(a, b) {
  const key = (list) => list.map((r) => `${r.id}:${r.kind}:${Math.round((r.x ?? r.local?.[0] ?? 0) * 12)}:${Math.round((r.y ?? r.local?.[1] ?? 0) * 12)}:${Math.round((r.w || 0) * 12)}:${Math.round((r.d || 0) * 12)}:${r.name || ''}`).sort().join('|')
  return a.length === b.length && key(a) === key(b)
}

/** The deterministic part: confidence gate, shape check, apply, rules. */
/**
 * A swap where a room lands in a spot under its new kind's minimum (the dining room in the office's
 * 10 by 7) gets a resize to that minimum right after it, so the swap is one change, not a refusal.
 */
export function growSwaps(ops, rooms, kit) {
  const planId = planIdOf(rooms)
  const byId = Object.fromEntries(rooms.filter(isRoom).map((r) => [r.id, r]))
  return ops.flatMap((o) => {
    if (o.op !== 'swap') return [o]
    const a = byId[o.room]
    const b = byId[o.target]
    if (!a || !b) return [o]
    const grow = (room, kind) => {
      const min = minSizeOf(kit, kind, planId)
      if (!min) return null
      // the minimum turned the way the room lies
      const [mw, md] = room.w >= room.d ? [Math.max(...min), Math.min(...min)] : [Math.min(...min), Math.max(...min)]
      if (room.w >= mw - 0.01 && room.d >= md - 0.01) return null
      return { op: 'resize', room: room.id, w: Math.max(room.w, mw), d: Math.max(room.d, md), auto: true }
    }
    return [o, grow(a, b.kind), grow(b, a.kind)].filter(Boolean)
  })
}

const PLAN_WORDS = { standard: 'standard', compact: 'compact', narrow: 'narrow-lot', frontgarage: 'garage-forward' }
const PROGRAM_KINDS = ['bed', 'bath', 'halfbath', 'jackjill', 'office', 'garage', 'frontPorch', 'rearPorch', 'suite2']
const num = (n) => Math.round(n).toLocaleString()

/**
 * The client's edits still standing, oldest first, from a project's version log: each applied change
 * with its ops. A rollback jumps to the version it restored; a new first draft (the rooms step run
 * again) starts the log over.
 * @returns {{ text: string, ops: object[] }[]}
 */
export function editsOf(versions) {
  const list = (versions || []).filter((v) => v && Number.isFinite(v.n))
  if (!list.length) return []
  const byN = new Map(list.map((v) => [v.n, v]))
  let n = Math.max(...list.map((v) => v.n))
  const out = []
  for (let guard = 0; n >= 1 && byN.has(n) && guard < 500; guard++) {
    const v = byN.get(n)
    if (v.kind === 'rollback' && v.rollbackOf) {
      n = v.rollbackOf
      continue
    }
    if (v.kind === 'initial' || v.kind === 'program') break
    if (v.kind === 'change' && Array.isArray(v.ops) && v.ops.length) out.unshift({ text: v.text, ops: v.ops })
    n -= 1
  }
  return out
}

/** The room-level part of a change: what a new draft at the counted program does not already carry. */
export const roomLevelOps = (ops) => (ops || []).filter((o) => o && o.op !== 'scale' && o.op !== 'redraft' && !((o.op === 'add' || o.op === 'remove') && PROGRAM_KINDS.includes(o.kind)))

/**
 * A fresh draft of the house as it stands (its rooms counted into a program) at another size or with a
 * program change, on the same lot, with the client's room-level edits applied again on top. Each edit
 * is kept only if it still applies and passes; the rest are reported.
 * @param {number|null} sqft  the living area asked for (null: the size it has now)
 * @param {object} over       program fields to change (a 2-car garage: { garage: 2 })
 * @returns {{ ok: true, rooms, program, planId, kept: string[], dropped: {text, why}[] } | { ok: false, max: number|null, reasons: string[] }}
 */
export function redraft(sqft, rooms, program, style, lot, edits = [], over = {}) {
  const L = lotOf(lot)
  const kit = kitFor(style)
  const stories = program.stories || 1
  const counted = programOf(rooms, program)
  const base = { ...program, beds: counted.beds, baths: counted.baths, halfBath: counted.halfBath, office: counted.office, garage: counted.garage, suite2: counted.suite2, frontPorch: counted.frontPorch, rearPorch: counted.rearPorch, stories, sqft: Math.round(sqft || floorArea(rooms, stories)), ...over }
  const fit = fitsLot(base, style, L)
  if (!fit.ok) return { ok: false, max: fit.maxSqft || (fit.draft?.clamped ? fit.draft.minSqft : null), reasons: fit.reasons || [], program: base }
  // under the plan's floor the draft comes out at the floor: that is not the size asked for
  if (fit.draft?.clamped && fit.draft.minSqft && Math.abs(fit.draft.minSqft - base.sqft) / base.sqft > 0.05) return { ok: false, max: fit.draft.minSqft, reasons: [`the smallest this plan goes with these rooms is about ${num(fit.draft.minSqft)} sf`], program: base, floor: true }
  const atFloor = !!fit.draft?.clamped && !!fit.draft.minSqft
  let next = fit.draft?.rooms || generateRooms(base, style, L)
  const kept = []
  const dropped = []
  for (const e of edits || []) {
    const ops = roomLevelOps(e.ops)
    if (!ops.length) continue
    try {
      const v = validateOps(ops, next, kit)
      if (!v.ok) throw new Error(/no room/.test(v.errors[0]) ? 'that room is not in the new draft' : v.errors[0])
      const out = applyOps(ops, next, kit, stories, L)
      const rules = checkRules(out.rooms, base, style, L)
      if (!rules.ok) throw new Error(rules.reasons[0].replace(/\.$/, ''))
      next = out.rooms
      kept.push(e.text)
    } catch (err) {
      dropped.push({ text: e.text, why: String(err.message || err).replace(/\.$/, '') })
    }
  }
  const rules = checkRules(next, base, style, L)
  if (!rules.ok) return { ok: false, max: null, reasons: rules.reasons, program: base }
  return { ok: true, rooms: next, program: base, planId: planIdOf(next), kept, dropped, atFloor, floor: atFloor ? fit.draft.minSqft : null }
}

/** The kept-and-dropped tail of a re-draft reply. */
function editsLine(r) {
  const parts = []
  if (r.kept?.length) parts.push(`Your earlier changes still stand: ${r.kept.map((t) => `"${t}"`).join(', ')}.`)
  if (r.dropped?.length) parts.push(`Could not keep: ${r.dropped.map((d) => `"${d.text}" (${d.why})`).join('; ')}.`)
  return parts.length ? ' ' + parts.join(' ') : ''
}

/** One op in the client's words, for a reply that says which part of a request went through. */
export function describeOp(o, rooms, kit) {
  const name = (id) => rooms.find((r) => r.id === id)?.name?.toLowerCase() || 'that room'
  const kindName = (k) => kit.rooms[k]?.name?.toLowerCase() || k
  switch (o?.op) {
    case 'scale':
      return `the house at ${num(o.sqft)} sf`
    case 'add':
      return `adding ${/^[aeiou]/.test(kindName(o.kind)) ? 'an' : 'a'} ${kindName(o.kind)}`
    case 'remove':
      return `removing the ${name(o.room)}`
    case 'resize':
      return `the ${name(o.room)} at ${ft(o.w)}' by ${ft(o.d)}'`
    case 'move':
      return `moving the ${name(o.room)}`
    case 'moveBeside':
      return `the ${name(o.room)} next to the ${name(o.target)}`
    case 'garage':
      return `a ${o.cars}-car garage${o.tandem ? ' (tandem: one bay two cars deep)' : ''}${o.load ? `, ${o.load}-load` : ''}`
    case 'swap':
      return `swapping the ${name(o.room)} and the ${name(o.target)}`
    case 'redraft':
      return `a new draft${o.program?.garage !== undefined ? ` with a ${o.program.garage}-car garage` : ''}${o.sqft ? ` at ${num(o.sqft)} sf` : ''}`
    default:
      return 'that change'
  }
}

/** The parts of a request: what the fallback split, or each op with the resizes a swap carries. */
const CLAUSE_SPLIT = /\s*(?:;|,(?!\d{3}\b)(?=\s*[A-Za-z])|\band then\b|\bthen\b|\band also\b|\balso\b|\band\b|\bplus\b)\s*/i
const BIGGER = /\b(bigger|larger|wider|deeper|longer)\b/i
const SMALLER = /\b(smaller|narrower|shorter|tighter)\b/i
/**
 * A request whose clauses undo each other on the same room, with no sizes given ("make the kitchen bigger and
 * then make it smaller"): the reply that says it nets out to nothing, or null.
 */
export function netsToNothing(text, rooms, kit) {
  const clauses = String(text || '').split(CLAUSE_SPLIT).map((c) => c.trim()).filter(Boolean)
  if (clauses.length < 2) return null
  const names = rooms.filter((r) => isRoom(r)).map((r) => r.name.toLowerCase())
  const kinds = Object.values(kit?.rooms || {}).map((r) => r.name.toLowerCase())
  const subject = (c) => [...names, ...kinds].find((n) => c.toLowerCase().includes(n)) || null
  for (let i = 0; i < clauses.length - 1; i++) {
    const a = clauses[i]
    const b = clauses[i + 1]
    const pair = (BIGGER.test(a) && SMALLER.test(b)) || (SMALLER.test(a) && BIGGER.test(b))
    if (!pair || /\d/.test(a) || /\d/.test(b)) continue
    const sa = subject(a)
    const sb = subject(b)
    if (sa && (sb === sa || !sb)) return `That nets out to no change: making the ${sa} ${BIGGER.test(a) ? 'bigger and then smaller' : 'smaller and then bigger'} again leaves it as it is. No change was used.`
  }
  return null
}

/**
 * One plain sentence for a change the plan's rules refuse (round 9, item 10), in place of the validator's list
 * ("Jack & Jill door opens to the outside. Closet door opens to the outside. Closet has no door."). The raw list
 * stays in `reasons` for the drafter log.
 */
export function plainRefusal(caused, preexisting, ops, rooms, kit) {
  const first = ops[0] || {}
  const nameOf = (id) => roomWords(id, rooms, kit)
  const what =
    first.op === 'remove' ? `Taking out the ${nameOf(first.room)}` :
    first.op === 'swap' ? `Swapping the ${nameOf(first.a || first.room)} and the ${nameOf(first.target || first.b || first.with)}` :
    first.op === 'resize' ? `Resizing the ${nameOf(first.room)}` :
    first.op === 'move' ? `Moving the ${nameOf(first.room)}` :
    first.op === 'add' ? `Adding ${/^[aeiou]/i.test(kit?.rooms?.[first.kind]?.name || '') ? 'an' : 'a'} ${(kit?.rooms?.[first.kind]?.name || first.kind || 'room').toLowerCase()}` :
    first.op === 'garage' ? `A ${first.cars}-car garage` :
    'That change'
  // round 10, item 8: the homeowner reads what went wrong in plain words, with the room it happens to when the rule
  // names one; the validator's own sentence ("Jack & Jill door opens to the outside") stays in `reasons`, which is
  // what the drafter log keeps, and is never put in the reply
  // a house needs a kitchen, a bedroom, a front door: that rule is already a plain sentence about the house
  const needs = caused.find((c) => /^(a|the|every) (house|home|plan) needs /i.test(c))
  if (needs) return `${needs.replace(/\.$/, '')}, so that one stays. Tell me what you would like changed about it instead.`
  const because = problemWords(caused, rooms, 'verb')
  const suggestion =
    first.op === 'swap' ? 'Try two rooms of about the same size, or tell me what you want next to what and I will redraw it.' :
    first.op === 'remove' ? 'Try one room at a time, or tell me what the space is for and I will redraw it.' :
    first.op === 'resize' ? 'Try a smaller step, or say how big it should be.' :
    'Try a smaller step.'
  const main = because ? `${what} ${because}, so the plan would not work as drawn. ${suggestion}` : `${what} does not work on this plan as it is drawn. ${suggestion}`
  const old = preexisting.length ? problemWords(preexisting, rooms, 'noun') : null
  return preexisting.length ? `${main} The plan also has a problem from before${old ? `: ${old}` : ''}. The drafter sees the details.` : main
}

/** A room for a sentence: "the kitchen", "the Bedroom 3"; an id nobody drew falls back to the kit's name for it, never to "that room". */
function roomWords(id, rooms, kit) {
  const r = rooms.find((x) => x.id === id) || rooms.find((x) => isRoom(x) && x.kind === id)
  const n = r?.name || kit?.rooms?.[id]?.name || (id ? String(id).replace(/\d+$/, '') : 'room')
  // "the kitchen", "the 2-car garage", but "the Bedroom 3" (a numbered room keeps its name as it is on the plan)
  return /\s\d+$/.test(n) ? n : n.toLowerCase()
}
/** The room a validator sentence is about: the last room of the plan it names (the one the problem lands on). */
function roomIn(reason, rooms) {
  const names = [...new Set(rooms.filter((r) => isRoom(r) && r.name).map((r) => r.name))].sort((a, b) => b.length - a.length)
  const text = String(reason || '')
  let best = null
  for (const n of names) {
    const at = text.toLowerCase().lastIndexOf(n.toLowerCase())
    if (at >= 0 && (!best || at > best.at)) best = { at, n }
  }
  if (!best) return null
  return /\s\d+$/.test(best.n) ? best.n : best.n.toLowerCase()
}
/**
 * What a list of validator reasons means, in plain words and without quoting them. 'verb' continues a sentence
 * ("Resizing the kitchen leaves the dining under its minimum size"); 'noun' names a problem the plan already had.
 * null when no reason is of a kind we have words for.
 */
export function problemWords(reasons, rooms, form = 'verb') {
  const kinds = [
    // which setback: "the 20 ft setback from Elm St", "the 5 ft side setback"
    [/would cross the setback at/i, (room, hit) => {
      const m = hit.match(/setback at (\d+(?:\.\d+)?) ft from (.+?)\.?$/i)
      const line = !m ? 'the setbacks on this lot' : /^(side|rear|front|street side)$/i.test(m[2]) ? `the ${m[1]} ft ${m[2].toLowerCase()} setback` : `the ${m[1]} ft setback from ${m[2].replace(/\b[a-z]/g, (c) => c.toUpperCase())}`
      return [`runs past ${line}`, `part of the house is past ${line}`]
    }],
    [/cover .*% of the lot|lot allows|would cover/i, () => ['covers more of the lot than the city allows', 'the house covers more of the lot than the city allows']],
    [/setback|property line/i, () => ['runs past the setbacks on this lot', 'part of the house is past the setbacks']],
    [/run into|overlap|over another|on a porch/i, () => ['runs rooms into each other', 'two rooms run into each other']],
    [/under the .* minimum|under 70 square feet|too small|longer than we can roof|cannot grow that way|at its largest|at its smallest/i, (room) => [room ? `leaves the ${room} under its minimum size` : 'leaves a room under its minimum size', room ? `the ${room} is under its minimum size` : 'a room is under its minimum size']],
    [/egress/i, (room) => [room ? `takes the escape window away from the ${room}` : "takes a bedroom's escape window away", room ? `the ${room} has no escape window` : 'a bedroom has no escape window']],
    [/window/i, (room) => [room ? `leaves the ${room} without a window` : 'leaves a room without a window', room ? `the ${room} has no window` : 'a room has no window']],
    [/plumbing|hot water/i, (room) => [room ? `puts the ${room} too far from the plumbing` : 'puts a wet room too far from the plumbing', 'a wet room is too far from the plumbing']],
    [/door|opens to the outside|no door|reached|reach /i, () => ['leaves rooms without a door or with a door to the outside', 'a room has no door, or a door that opens to the outside']],
  ]
  for (const [re, words] of kinds) {
    const hit = (reasons || []).find((c) => re.test(c))
    if (hit) return words(roomIn(hit, rooms), hit)[form === 'noun' ? 1 : 0]
  }
  return null
}

function partsOf(diff, rooms, kit) {
  if (Array.isArray(diff.parts) && diff.parts.length > 1) return diff.parts.filter((p) => p.ops?.length).map((p) => ({ text: p.text, ops: p.ops }))
  const out = []
  for (const o of diff.ops) {
    if (o.auto && out.length) out[out.length - 1].ops.push(o)
    else out.push({ text: describeOp(o, rooms, kit), ops: [o] })
  }
  return out
}

const GARAGE_WORDS = (why) => {
  const m = why.match(/(\d)-car/)
  const n = m ? m[1] : null
  if (/no free wall at the laundry/.test(why)) return `There is no room for a garage against the laundry on this plan.`
  if (/no sound spot for a/.test(why)) return `There is no room for ${n ? `a ${n}-car` : 'that'} garage${/tandem/.test(why) ? ' with a tandem bay' : ''}${/side-load/.test(why) ? ', side-load,' : /front-load/.test(why) ? ', front-load,' : ''} on this lot.`
  return null
}

/**
 * The verdict on a diff: applied rooms, or a refusal that says why and offers the next best thing.
 * @param {object} opts  { history: the client's edits so far [{text, ops}] (for a re-draft), depth }
 */
export function decide(diff, rooms, program, style, kit, source, lot, opts = {}) {
  const out = decideCore(diff, rooms, program, style, kit, source, lot, opts)
  // what the request asked for that was not done: a clause this style cannot take, or one that was not understood
  const notes = []
  for (const d of opts.unsupported || []) notes.push(`"${d.text}": ${d.why.replace(/\.$/, '')}`)
  for (const u of diff.unread || []) notes.push(`"${u.text}" (say which room, and what to change)`)
  if (!notes.length) return out
  const tail = ` I didn't do: ${notes.join('; ')}.${out.applied ? ' The change counts once, for what was done.' : ''}`
  return { ...out, reply: out.reply.replace(/\s+$/, '') + tail, notDone: notes }
}

function decideCore(diff, rooms, program, style, kit, source, lot, opts = {}) {
  const L = lotOf(lot)
  const depth = opts.depth || 0
  const edits = opts.history || []
  const stories = program.stories || 1
  diff = { ...diff, ops: growSwaps(normalizeOps(diff.ops, rooms), rooms, kit) }
  if ((diff.confidence ?? 1) < MIN_CONFIDENCE || !diff.ops?.length) {
    return { applied: false, rooms, reply: diff.reply || 'I am not sure what to change. Can you say it another way?', source, ops: [] }
  }
  const v = validateOps(diff.ops, rooms, kit)
  if (!v.ok) return { applied: false, rooms, reply: v.errors[0], source, ops: diff.ops, reasons: v.errors }
  // at most three parts a message (round 8, item 29): the rest is named and asked for next
  if (depth === 0) {
    const all = partsOf(diff, rooms, kit)
    if (all.length > MAX_PARTS) {
      const keep = all.slice(0, MAX_PARTS)
      const later = all.slice(MAX_PARTS)
      const trimmed = { ...diff, ops: keep.flatMap((p) => p.ops), parts: Array.isArray(diff.parts) && diff.parts.length > 1 ? diff.parts.filter((p) => p.ops?.length).slice(0, MAX_PARTS) : diff.parts }
      const out = decideCore(trimmed, rooms, program, style, kit, source, lot, { ...opts, depth: 1, capped: later })
      const tail = ` I did the first ${MAX_PARTS}; send "${later.map((p) => p.text).join('", "')}" next.`
      return { ...out, reply: String(out.reply || '').replace(/\s+$/, '') + tail, deferred: later.map((p) => p.text) }
    }
  }
  // a new draft of the house as it stands, with a program change or at a size (what a fix button sends
  // when the plan cannot take the change in place)
  const redraftOp = diff.ops.find((o) => o.op === 'redraft')
  if (redraftOp) {
    const r = redraft(redraftOp.sqft || null, rooms, program, style, L, edits, redraftOp.program || {})
    if (!r.ok) return { applied: false, rooms, reply: `A new draft with that does not fit this lot${r.reasons?.[0] ? `: ${r.reasons[0].replace(/\.$/, '')}` : ''}.`, source, ops: diff.ops, reasons: r.reasons || [], fixes: [] }
    const what = describeOp(redraftOp, rooms, kit)
    const reply = `Drew ${what} on the ${PLAN_WORDS[r.planId] || r.planId || 'same'} plan: ${num(floorArea(r.rooms, stories))} sf of living area.${editsLine(r)}`
    return { applied: true, rooms: r.rooms, reply, source, ops: diff.ops, did: [`New draft: ${what}`], redrafted: true, program: r.program, kept: r.kept, dropped: r.dropped }
  }
  // a resize past the largest the kit draws for that room: out of range, with the largest as the fix
  for (const o of diff.ops) {
    if (o.op !== 'resize') continue
    const r = rooms.find((x) => x.id === o.room)
    if (!r) continue
    const [mw, md] = maxSizeOf(kit, r.kind)
    const [MW, MD] = r.w >= r.d ? [Math.max(mw, md), Math.min(mw, md)] : [Math.min(mw, md), Math.max(mw, md)]
    if (o.w > MW + 0.01 || o.d > MD + 0.01) {
      const capped = { ...o, w: Math.min(o.w, MW), d: Math.min(o.d, MD) }
      const name = r.name.toLowerCase()
      let fix = null
      if (capped.w !== r.w || capped.d !== r.d) {
        try {
          const out = applyOps([capped], rooms, kit, stories, L)
          if (checkRules(out.rooms, program, style, L).ok) fix = { label: `Make the ${name} ${ft(capped.w)}' by ${ft(capped.d)}' instead?`, ops: [capped] }
        } catch {
          fix = null
        }
      }
      return { applied: false, rooms, reply: `The ${name} in this kit goes up to ${ft(MW)}' by ${ft(MD)}'; ${ft(o.w)}' by ${ft(o.d)}' is past that.`, source, ops: diff.ops, reasons: ['out of range'], fixes: fix ? [fix] : [] }
    }
  }

  const scaleOp = diff.ops.length === 1 && diff.ops[0].op === 'scale' ? diff.ops[0] : null
  const now = floorArea(rooms, stories)

  // "make the house N sf" when stretching the rooms as they are fails: a new draft at N with the client's
  // edits put back; or the largest the lot takes, offered as the fix
  const rescale = (why) => {
    const sqft = Math.round(scaleOp.sqft)
    const r = redraft(sqft, rooms, program, style, L, edits)
    if (r.ok) {
      const got = floorArea(r.rooms, stories)
      const plan = PLAN_WORDS[r.planId] || r.planId
      const onPlan = plan && r.planId !== planIdOf(rooms) ? ` on the ${plan} plan` : ''
      // one floor, said once: the plan's (the stretch has its own, which is not the client's concern)
      const reply = r.atFloor
        ? `The smallest this house goes is about ${num(r.floor)} sf; I drew it at ${num(got)}${onPlan}.${editsLine(r)}`
        : `Re-drafted the house at ${num(got)} sf${onPlan}: stretching the rooms as they were ${/smallest/.test(why) ? 'would not work' : why}.${editsLine(r)}`
      return { applied: true, rooms: r.rooms, reply, source, ops: diff.ops, did: [`${num(got)} sf of living area (was ${num(now)}), re-drafted`], redrafted: true, program: r.program, kept: r.kept, dropped: r.dropped }
    }
    // the largest size this lot takes with these rooms, as a fix that is itself checked
    const max = r.max && Math.round(r.max / 10) * 10
    const there = max && Math.abs(max - now) / now < 0.01
    let fix = null
    if (max && !there && depth < 2) {
      const d = decide({ ops: [{ op: 'scale', sqft: max }], reply: '', confidence: 1 }, rooms, program, style, kit, source, L, { ...opts, depth: depth + 1 })
      if (d.applied) fix = { label: `Make it ${num(max)} sf`, ops: [{ op: 'scale', sqft: max }] }
    }
    const reply = r.floor || sqft < now
      ? `At ${num(sqft)} sf the rooms fall under their minimums${max ? `; the smallest this plan goes with these rooms is about ${num(max)} sf${there ? ', which is about where it is now' : ''}` : ''}.`
      : `At ${num(sqft)} sf this plan runs past the setbacks on this lot${max ? `; the largest it fits here with these rooms is about ${num(max)} sf${there ? ', which is about where it is now' : ''}` : r.reasons?.[0] ? ` (${r.reasons[0].replace(/\.$/, '')})` : ''}.`
    return { applied: false, rooms, reply, source, ops: diff.ops, reasons: [why, ...(r.reasons || [])], caused: [why], preexisting: [], fixes: fix ? [fix] : [] }
  }

  // a request in parts, applied one part at a time: what passes goes through, what does not is named
  const inParts = (whole) => {
    const parts = partsOf(diff, rooms, kit)
    if (parts.length < 2 || depth >= 2 + (opts.capped ? 1 : 0)) return null
    let running = rooms
    const kept = []
    const dropped = []
    const ops = []
    const did = []
    for (const part of parts) {
      const d = decide({ ops: part.ops, reply: '', confidence: 1 }, running, program, style, kit, source, L, { ...opts, depth: depth + 1 })
      if (d.applied) {
        running = d.rooms
        kept.push(part.text)
        ops.push(...part.ops)
        did.push(...(d.did || []))
      } else dropped.push({ text: part.text, why: String(d.reply || '').trim() })
    }
    if (!kept.length) return null
    // what was not done is named, and why follows in its own plain sentence, never in brackets (round 10, item 8)
    const whys = [...new Set(dropped.map((d) => d.why).filter(Boolean))]
    const reply = `Done: ${kept.join('; ')}.${dropped.length ? ` Not done: ${dropped.map((d) => d.text).join('; ')}. ${whys.map((w) => (/[.!?]$/.test(w) ? w : w + '.')).join(' ')} This counts as one change, for what was done.` : ''}`
    return { applied: true, rooms: running, reply, source, ops, did, partial: dropped.length > 0, kept, dropped }
  }

  let next
  try {
    next = applyOps(diff.ops, rooms, kit, stories, L)
  } catch (e) {
    // the reason is written for the client: it is the reply
    const why = String(e.message || e)
    const plain = /^[A-Za-z0-9]/.test(why) && !/at .*\.js|undefined|null|TypeError|ReferenceError/.test(why)
    if (scaleOp && plain && !/already about/.test(why)) return rescale('would not work')
    const parts = inParts()
    if (parts) return parts
    let fixes = plain ? suggestFixes(diff.ops, [why], rooms, rooms, program, style, kit, L, true) : []
    let reply = plain ? `I can't do that one. ${why.charAt(0).toUpperCase() + why.slice(1)}.`.replace(/\.\.$/, '.') : 'That change did not work out on this plan. Try a smaller step.'
    // a swap that cannot be drawn (round 10, item 8): the reason is about the two rooms trading places, never about a
    // third room that could not grow to make it fit ("2-Car Garage cannot grow that way: Dining would be too small")
    const swap = diff.ops.find((o) => o.op === 'swap')
    if (swap && plain && !/^There is no |is not in this plan|already/i.test(why)) reply = `Swapping the ${roomWords(swap.room, rooms, kit)} and the ${roomWords(swap.target, rooms, kit)} does not work on this plan: the two rooms are too different in size to trade places. Try two rooms of about the same size, or tell me what you want next to what and I will redraw it.`
    // a garage that has no spot: plain words, then the next best thing (one bay less, a tandem bay, a new draft)
    const gWords = plain && GARAGE_WORDS(why)
    if (gWords) {
      reply = gWords
      fixes = garageFallbacks(diff.ops, rooms, program, style, kit, L, edits, depth)
    }
    const reason = plain ? why : 'that change did not work out on this plan'
    return { applied: false, rooms, reply, source, ops: diff.ops, reasons: [reason], caused: [reason], preexisting: [], fixes }
  }
  // a change that draws the same house is no change: nothing applied, nothing charged
  if (sameRooms(rooms, next.rooms)) {
    const what = diff.ops.map((o) => (o.op === 'resize' ? `${rooms.find((r) => r.id === o.room)?.name || 'that room'} is already ${o.w}' by ${o.d}'` : o.op === 'move' ? 'that room is already there' : o.op === 'garage' ? `the garage is already ${o.cars} cars` : 'the plan already has that')).join('; ')
    return { applied: false, rooms, reply: `That would not change anything: ${what}. No change was used.`, source, ops: diff.ops, reasons: ['no change'], noop: true }
  }
  const rules = checkRules(next.rooms, program, style, L)
  if (!rules.ok) {
    // what the change caused, apart from what the plan already had
    const before = checkRules(rooms, program, style, L).reasons
    const preexisting = rules.reasons.filter((r) => before.includes(r))
    const caused = rules.reasons.filter((r) => !before.includes(r))
    if (scaleOp && caused.length) return rescale(caused.some((r) => /setback|cover|lot/i.test(r)) ? 'would run past the setbacks' : 'would not pass the plan rules')
    const parts = inParts()
    if (parts) return parts
    let fixes = suggestFixes(diff.ops, caused.length ? caused : preexisting, rooms, next.rooms, program, style, kit, L, caused.length > 0)
    // a garage that breaks the rules where it was asked (the garage-forward plan cannot swap its garage in place):
    // one bay less, a tandem bay, or a new draft with that garage come first
    if (caused.length && diff.ops.some((o) => o.op === 'garage' || (o.op === 'add' && o.kind === 'garage'))) fixes = [...garageFallbacks(diff.ops, rooms, program, style, kit, L, edits, depth), ...fixes].filter((f, i, all) => all.findIndex((g) => g.label === f.label) === i).slice(0, 3)
    const reply = caused.length
      ? plainRefusal(caused, preexisting, diff.ops, rooms, kit)
      : `The change itself is fine, but this plan already has a problem that has to go first${problemWords(preexisting, rooms, 'noun') ? `: ${problemWords(preexisting, rooms, 'noun')}` : ''}. Ask me to fix that, or go back one version; the drafter sees the details.`
    return { applied: false, rooms, reply, source, ops: diff.ops, reasons: rules.reasons, caused, preexisting, fixes }
  }
  return { applied: true, rooms: next.rooms, reply: diff.reply || next.did.join('. ') + '.', source, ops: diff.ops, did: next.did }
}

/**
 * When a garage will not go where it was asked: one bay less, a tandem third bay, and a new draft of
 * the house with that garage, each offered only if it applies and passes.
 */
function garageFallbacks(ops, rooms, program, style, kit, L, edits, depth) {
  const stories = program.stories || 1
  const o = ops.find((x) => x.op === 'garage' || (x.op === 'add' && x.kind === 'garage'))
  if (!o) return []
  const cars = o.op === 'garage' ? o.cars : o.w ? Math.max(1, Math.round(o.w / (kit.rooms.garage?.perCar || 11))) : 2
  const has = rooms.some((r) => isRoom(r) && r.kind === 'garage')
  const fixes = []
  const works = (candidate) => {
    try {
      const out = applyOps(candidate, rooms, kit, stories, L)
      return checkRules(out.rooms, program, style, L).ok && !sameRooms(rooms, out.rooms)
    } catch {
      return false
    }
  }
  const asOp = (n, extra = {}) => (has ? [{ op: 'garage', cars: n, ...(o.load ? { load: o.load } : {}), ...extra }] : [{ op: 'add', kind: 'garage', name: `${n}-Car Garage`, w: (kit.rooms.garage?.perCar || 11) * n, d: kit.rooms.garage?.d || 22, near: o.near }])
  if (cars > 1 && works(asOp(cars - 1))) fixes.push({ label: `Make it a ${cars - 1}-car garage instead?`, ops: asOp(cars - 1) })
  if (cars >= 3 && has && !o.tandem && works(asOp(cars, { tandem: true }))) fixes.push({ label: `${cars}-car with a tandem bay (one bay two cars deep)?`, ops: asOp(cars, { tandem: true }) })
  if (depth < 2) {
    const r = redraft(null, rooms, program, style, L, edits, { garage: cars })
    if (r.ok && r.rooms.some((x) => isRoom(x) && x.kind === 'garage')) fixes.push({ label: `Re-draft the house with a ${cars}-car garage${r.dropped.length ? ` (${r.dropped.length} earlier change${r.dropped.length === 1 ? '' : 's'} would not carry over)` : ''}`, ops: [{ op: 'redraft', program: { garage: cars } }] })
    else if (cars > 2) {
      const r2 = redraft(null, rooms, program, style, L, edits, { garage: 2 })
      if (r2.ok && r2.rooms.some((x) => isRoom(x) && x.kind === 'garage')) fixes.push({ label: 'Re-draft the house with a 2-car garage', ops: [{ op: 'redraft', program: { garage: 2 } }] })
    }
  }
  return fixes.slice(0, 3)
}

const ROOM_IN_REASON = (reason, rooms) => rooms.filter((r) => r.name && reason.startsWith(r.name + ' ')).sort((a, b) => b.name.length - a.name.length)[0]
const ft = (v) => (Math.round(v * 4) / 4).toString().replace(/\.0+$/, '')

/**
 * Fixes a client can click: a move that brings an offending room back inside, or a smaller
 * version of the resize that was asked for. Each is checked against the rules before it is offered.
 * @returns {{ label: string, ops: object[] }[]}  at most two
 */
export function suggestFixes(ops, reasons, rooms, nextRooms, program, style, kit, lot, withChange = true) {
  const L = lotOf(lot)
  const stories = program.stories || 1
  const tryOps = (candidate) => {
    try {
      const out = applyOps(candidate, rooms, kit, stories, L)
      return checkRules(out.rooms, program, style, L).ok
    } catch {
      return false
    }
  }
  const fixes = []
  const seen = new Set()
  const offer = (label, candidate) => {
    if (fixes.length >= 2 || seen.has(label)) return
    if (tryOps(candidate)) {
      seen.add(label)
      fixes.push({ label, ops: candidate })
    }
  }
  // the change's ops with stable ids, so a follow-up move can name a room the change adds
  const base = withChange ? ops.map((o, i) => (o.op === 'add' && !o.id ? { ...o, id: `${o.kind}-new-${i}` } : o)) : []
  const added = (o, i) => (o.op === 'add' ? o.id || `${o.kind}-new-${i}` : o.room)
  const idsTouched = new Set(ops.map(added))

  // 2. a resize that went too far: the same room, half way and a quarter of the way
  if (withChange)
    for (const o of ops) {
      if (o.op !== 'resize') continue
      const r = rooms.find((x) => x.id === o.room)
      if (!r) continue
      // the largest step toward what was asked that still passes
      const [mw, md] = maxSizeOf(kit, r.kind)
      const [MW, MD] = r.w >= r.d ? [Math.max(mw, md), Math.min(mw, md)] : [Math.min(mw, md), Math.max(mw, md)]
      for (const part of [0.75, 0.5, 0.25, 0.1]) {
        const w = Math.min(MW, Math.round((r.w + (o.w - r.w) * part) * 4) / 4)
        const d = Math.min(MD, Math.round((r.d + (o.d - r.d) * part) * 4) / 4)
        if (w === r.w && d === r.d) continue
        const n = fixes.length
        offer(`Make the ${r.name.toLowerCase()} ${ft(w)}' by ${ft(d)}' instead?`, ops.map((x) => (x === o ? { ...o, w, d } : x)))
        if (fixes.length > n) break
      }
    }
  // 1. rooms that cross the setback or run into another: nudge them back, a foot at a time. The room
  //    the change touched comes first ("Foyer would run into primary bedroom" is the bedroom's doing).
  const named = reasons.filter((r) => /setback|run into/.test(r)).flatMap((r) => {
    const a = ROOM_IN_REASON(r, nextRooms)
    const m = r.match(/ would run into (.+)\.$/)
    const b = m ? nextRooms.find((x) => x.name && x.name.toLowerCase() === m[1].toLowerCase()) : null
    return [a, b].filter(Boolean)
  })
  const touched = (room) => idsTouched.has(room.id) || ops.some((o) => o.op === 'add' && o.kind === room.kind)
  const offenders = [...new Set(named)].sort((x, y) => (touched(y) ? 1 : 0) - (touched(x) ? 1 : 0))
  for (const room of offenders) {
    const id = room.id.startsWith('garage-') || room.id.startsWith('bed-') || room.id.startsWith('bath-') ? room.id : room.id
    const target = [...idsTouched].find((t) => t === room.id || nextRooms.find((r) => r.id === t)?.name === room.name) || room.id
    const ref = rooms.find((r) => r.id === target) || room
    const exists = rooms.some((r) => r.id === target)
    const idForOps = exists ? target : base.find((o) => o.op === 'add' && (o.id || '').startsWith(room.kind + '-new'))?.id || target
    for (const [dx, dy, word] of [
      [-1, 0, 'west'],
      [1, 0, 'east'],
      [0, -1, 'toward the back'],
      [0, 1, 'toward the street'],
    ]) {
      for (const k of [1, 2, 3, 4, 6, 8]) {
        const label = `Move the ${ref.name.toLowerCase()} ${k} ft ${word}?`
        offer(label, [...base, { op: 'move', room: idForOps, dx: dx * k, dy: dy * k }])
        if (fixes.some((f) => f.label === label)) break
      }
      if (fixes.length >= 2) break
    }
    if (fixes.length >= 2) break
    void id
  }
  return fixes
}
