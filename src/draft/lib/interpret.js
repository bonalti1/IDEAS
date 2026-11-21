// Plain-language change requests → ops → rules → applied plan.
// Claude does the interpreting through the office API (key stays server-side);
// the regex fallback takes over when the API is unreachable or unsure.
import { api } from './api.js'
import { kitFor, lotOf, minSizeOf, maxSizeOf, planIdOf, isRoom, programOf, programLimits, generateRooms, floorArea } from './layout.js'
import { validateOps, applyOps, regexOps, summarizeRooms, normalizeOps, splitClauses, splitCost, costReply, withPlanCoords, OPEN_ASK, isUndoRequest, tradeOffAsk, unclearAsk, countAsk } from './ops.js'
import { checkRules } from './rules.js'
import { fitsLot } from './fit.js'
import { isSpanish, fromSpanish, toSpanish, untranslated, ASK_LABEL_ES, hasUsted } from './es.js'
import { isSendLot, wantsNicer } from './intents.js'

const MIN_CONFIDENCE = 0.5
const MAX_PARTS = 3 // parts applied from one message; one change is used however many applied (round 8, item 29)
// the office said it has no interpreter: do not wait on it again for a while
let offlineUntil = 0

/** Calls the office interpreter. Throws when it cannot. */
export async function claudeInterpreter({ text, rooms, program, kit, lot, lang }) {
  if (Date.now() < offlineUntil) throw Object.assign(new Error('interpreter not configured'), { unconfigured: true })
  let res
  try {
    res = await api.interpret({
    text,
    rooms: summarizeRooms(rooms),
    program,
    lot,
    ...(lang ? { lang } : {}),
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
 * @param {object} opts  { interpreter } to override the Claude call (tests), { lot }, { history }, { lang: 'es' | 'en' }
 *   the language of the screen (the answer is Spanish when it is 'es' or the request is Spanish), { fixOps } the ops
 *   of a button the client tapped
 * @returns {{ applied: boolean, rooms, reply: string, source: 'claude'|'fallback', ops, reasons? }}
 */
export async function interpretRequest(text, rooms, program, style, opts = {}) {
  const kit = kitFor(style)
  // round 13: a request in Spanish is read as the English it means (the basic rules and the checks below read
  // that), and every answer leaves in the homeowner's language: Spanish when they wrote Spanish, or when the
  // screen is in Spanish (opts.lang 'es')
  const asked = String(text ?? '')
  const said = isSpanish(asked) ? fromSpanish(asked) : null
  const lang = opts.lang === 'es' || said ? 'es' : 'en'
  const own = (t) => (said ? said.back(t) : t) // a clause in the client's own words
  const say = (result) => localize(result, lang)
  // a button the client tapped (opts.fixOps): its ops are taken as given and only the rules run; the label is not read
  if (Array.isArray(opts.fixOps) && opts.fixOps.length) return say(decide({ ops: opts.fixOps.slice(0, 8), reply: '', confidence: 1 }, rooms, program, style, kit, 'fix', lotOf(opts.lot), { history: opts.history || [] }))
  // round 15, U2: "send my lot to the drafter" is not a change: with no account there is no saved lot to send yet
  // (the Draft screen sends it itself when someone is signed in, and so does the office)
  if (isSendLot(asked)) return say({ applied: false, sendLot: true, rooms, reply: 'Sign in first, so we can save your lot and send it to a drafter. No change was used.', source: 'fallback', ops: [], reasons: ['send lot'] })
  // "undo", "go back to how it was", "deshaz eso": the Undo button's job; the screen keeps the versions, so here the
  // answer only points to it (the office API does the undo itself for a saved plan)
  if (isUndoRequest(asked)) return say({ applied: false, undo: true, rooms, reply: opts.history?.length ? 'Tap Undo below the chat to take the last change off; it comes back to your plan.' : 'There is nothing to undo yet. No change was used.', source: 'fallback', ops: [], reasons: ['undo'] })
  text = said ? said.text : asked
  // a cost question never reaches the model and never uses a change: the answer points to the meeting with
  // the office (round 8, M3); beside a change ("make it 2,400 sf, how much is that?") the change still runs
  const costQ = splitCost(text)
  if (costQ.cost && !costQ.text) return say({ applied: false, rooms, reply: costReply(costQ), source: 'fallback', ops: [], reasons: ['cost question'], askOffice: 'meeting' })
  text = costQ.text
  // "make the kitchen bigger and then make it smaller": the two parts cancel; say so, use nothing (round 9, item 11)
  const net = netsToNothing(text, rooms, kit)
  if (net) return say({ applied: false, rooms, reply: net, source: 'fallback', ops: [], reasons: ['no change'], noop: true })
  // what this style cannot do yet, said plainly, before any model is asked: clause by clause, so "make the
  // kitchen bigger and add a pool" does the kitchen and names the pool
  const split = dropUnsupported(text, style)
  if (!split.text) return say({ applied: false, rooms, reply: split.dropped.map((d) => d.why).join(' '), source: 'fallback', ops: [], unsupported: true, ...(costQ.cost ? { askOffice: 'meeting' } : {}) })
  const withCost = (result) => {
    if (!costQ.cost) return result
    return { ...result, reply: `${String(result.reply || '').trim()} ${costReply(costQ)}`.trim(), askOffice: 'meeting' }
  }
  // "make the house smaller but add 2 bedrooms": the trade-off is explained and one option that applies is offered,
  // before any model is asked, so the answer is the same in both modes (round 13)
  const trade = tradeOffAsk(split.text)
  const offer = trade ? tradeOffer(trade, rooms, program, style, kit, 'fallback', lotOf(opts.lot), opts.history || []) : null
  if (offer) return say(withCost(offer))
  // "make it nicer", "hazla más bonita": three things that do that, as buttons, the same in both modes (round 15, B6)
  if (wantsNicer(asked) || wantsNicer(split.text)) return say(withCost(nicerOffer(rooms, program, style, kit, 'fallback', opts.lot, opts.history || [])))
  text = own(split.text)
  const interpreter = opts.interpreter || claudeInterpreter
  let diff
  let source = 'claude'
  // "2.5 baths", "dos baños y medio": read here in both modes, so the model never turns it into 3 or 4 full baths
  const halves = halfCountDiff(split.text)
  try {
    if (halves) {
      diff = halves
      source = 'fallback'
    } else diff = await interpreter({ text, rooms, program, kit, lot: opts.lot ? { spec: opts.lot.spec } : undefined, lang })
    if (diff.source === 'fallback' || diff.source === 'timeout') source = diff.source // the office answered with the basic rules
  } catch (e) {
    diff = regexOps(text, rooms, kit, lotOf(opts.lot))
    source = /abort|timed? ?out|504/i.test(String(e?.name || '') + String(e?.message || '')) ? 'timeout' : 'fallback'
  }
  diff = markUnclear(diff, split.text)
  const result = withCost(decide(diff, rooms, program, style, kit, source, lotOf(opts.lot), { history: opts.history || [], unsupported: split.dropped.map((d) => ({ ...d, text: own(d.text) })) }))
  if (!opts.interpreter && opts.report !== false) api.verdict({ text, client: opts.lot?.client, source, applied: result.applied, reasons: result.reasons || [], reply: result.reply, ops: result.ops })
  return say(result)
}

/**
 * A request that asks for a number of baths with a half in it ("2.5 baths", "two and a half baths", "dos baños y
 * medio", "3 bedrooms 2.5 baths"): the count ops the basic rules read, taken as they are in both chat modes (round
 * 15, U3), or null.
 */
export function halfCountDiff(text) {
  const counts = countAsk(text)
  if (!counts.some((c) => c.half)) return null
  return { ops: counts.map((c) => ({ op: 'count', kind: c.kind, count: c.count, ...(c.half ? { half: 1 } : {}) })), reply: '', confidence: 1 }
}

/**
 * A diff that came back with nothing to do, for a message with nothing in it the chat acts on ("asdf", "make it
 * nicer", "hmm"), is marked so the verdict answers with changes that work on this plan (round 13). A question the
 * model asked about a real request ("which bedroom?") is left as it is.
 * @param {string} text  the request as the basic rules read it (English, or Spanish: it is read either way)
 */
export function markUnclear(diff, text) {
  if (!diff || !Array.isArray(diff.ops) || diff.ops.length || diff.intent === 'open' || diff.intent === 'unclear') return diff
  return unclearAsk(text) ? { ...diff, intent: 'unclear' } : diff
}

export const ASK_LABEL = { meeting: 'Ask the office to set up my meeting', 'more-changes': 'Ask the office for more changes' }
/**
 * A chat answer in the homeowner's language (round 13). In Spanish the reply and every button label are
 * translated; a sentence that has no Spanish (the model answered in English, a validator's own line) is replaced:
 * what was done is said from the plan code's own description, a refusal falls back to one plain sentence. Either
 * way the answer carries `askLabel`, the words for its "ask the office" button, when it has one.
 */
export function localize(result, lang = 'en') {
  if (!result) return result
  const labels = lang === 'es' ? ASK_LABEL_ES : ASK_LABEL
  const ask = result.askOffice ? { askLabel: labels[result.askOffice] || labels.meeting } : {}
  if (lang !== 'es') return { ...result, ...ask }
  const reply = String(result.reply || '')
  let es = toSpanish(reply)
  // round 15, U15: the chat says tú; a reply that came back in usted (the model's own Spanish) is said again from the
  // plan code's own words, like a reply with English left in it
  if (untranslated(reply).length || hasUsted(es)) {
    const did = result.applied && result.did?.length ? `${result.did.join('. ')}.` : null
    const plain = result.applied ? 'El cambio quedó hecho.' : result.ops?.length ? 'No pude hacer ese cambio en este plano. Dímelo de otra manera.' : 'No estoy seguro de qué cambiar. ¿Me lo puedes decir de otra manera?'
    es = did && !untranslated(did).length ? toSpanish(did) : hasUsted(es) ? plain : toSpanish(reply, { fallback: plain })
  }
  return { ...result, reply: es, ...(result.fixes ? { fixes: result.fixes.map((f) => ({ ...f, label: toSpanish(f.label) })) } : {}), ...ask, lang: 'es' }
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
export const roomLevelOps = (ops) => (ops || []).filter((o) => o && o.op !== 'scale' && o.op !== 'redraft' && o.op !== 'count' && !((o.op === 'add' || o.op === 'remove') && PROGRAM_KINDS.includes(o.kind)))

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
    case 'count':
      return countWords(o.kind, o.count, o.half)
    case 'windows':
      return 'wider windows'
    case 'redraft': {
      const p = o.program || {}
      const withs = [p.garage !== undefined ? `a ${p.garage}-car garage` : null, p.beds !== undefined ? countWords('bed', p.beds) : null, p.baths !== undefined ? countWords('bath', p.baths, p.halfBath === true ? 1 : 0) : null, p.rearPorch === true ? 'a covered porch at the back' : null, p.frontPorch === true ? 'a front porch' : null].filter(Boolean)
      return `a new draft${withs.length ? ` with ${withs.join(' and ')}` : ''}${o.sqft ? ` at ${num(o.sqft)} sf` : ''}`
    }
    default:
      return 'that change'
  }
}

/** The parts of a request: what the fallback split, or each op with the resizes a swap carries. */
const CLAUSE_SPLIT = /\s*(?:;|,(?!\d{3}\b)(?=\s*[A-Za-z])|\band then\b|\bthen\b|\band also\b|\balso\b|\band\b(?!\s+(?:a\s+)?half\b)|\bplus\b)\s*/i
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
    // round 15, U4: a room, a garage, a move have no "smaller step"
    first.op === 'add' ? 'Tell me which room could give up some space for it.' :
    first.op === 'move' ? 'Tell me where you would like it instead.' :
    'Tell me what you would like instead.'
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
  if (/no sound spot for a/.test(why) && /garage/.test(why)) return `There is no room for ${n ? `a ${n}-car` : 'that'} garage${/tandem/.test(why) ? ' with a tandem bay' : ''}${/side-load/.test(why) ? ', side-load,' : /front-load/.test(why) ? ', front-load,' : ''} on this lot.`
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
  for (const u of diff.unread || []) notes.push(u.hint ? `"${u.text}": ${u.hint}` : `"${u.text}" (say which room, and what to change)`)
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
  // "make it feel more open": nothing is changed on a guess; what is open already is said, and what applies is offered
  if (diff.intent === 'open' && !diff.ops?.length) return openOffer(rooms, program, style, kit, source, L)
  // "asdf", "make it nicer", "hmm": said plainly, with changes that work on this plan as buttons (round 13)
  if (diff.intent === 'unclear' && !diff.ops?.length) return unclearOffer(rooms, program, style, kit, source, L)
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
      // round 15, U12 and P3: a room asked to grow past the largest this style draws gets one sentence and, as the
      // button, the most it can grow here (the widest that fits, for "3 ft wider")
      const grows = diff.ops.filter((x) => !x.auto).length === 1 && o.w >= r.w - 0.01 && o.d >= r.d - 0.01
      if (grows) {
        const best = closestGrow(r, Math.min(o.w, MW), Math.min(o.d, MD), rooms, program, style, kit, L, { exact: true })
        const limit = `it is drawn at most ${ft(MW)} ft by ${ft(MD)} ft in this style`
        const name = theRoom(r.name)
        const reply = best ? `${cap1(name)} can only grow ${grewWords(best.a, best.b)} here: ${limit}.` : `${cap1(name)} cannot get bigger here: ${limit}.`
        return { applied: false, rooms, reply, source, ops: diff.ops, reasons: ['out of range'], fixes: best ? [{ label: `Make ${name} ${grewWords(best.a, best.b)}`, ops: best.ops }] : [] }
      }
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
    const done = [] // the parts kept so far, as edits: a part that draws the house again puts them back
    for (const part of parts) {
      const d = decide({ ops: part.ops, reply: '', confidence: 1 }, running, program, style, kit, source, L, { ...opts, depth: depth + 1, history: [...edits, ...done] })
      if (d.applied) {
        running = d.rooms
        // a new draft that could not keep an earlier part of this same message: that part is not done after all
        for (const lost of d.dropped || []) {
          const at = kept.indexOf(lost.text)
          if (at < 0 || !done.some((e) => e.text === lost.text)) continue
          kept.splice(at, 1)
          dropped.push({ text: lost.text, why: 'It could not be kept on the new draft.' })
        }
        kept.push(part.text)
        done.push({ text: part.text, ops: part.ops })
        // a count ("4 bedrooms") is logged as what it did: the rooms added, or the new draft
        ops.push(...(part.ops.some((o) => o.op === 'count') && d.ops?.length ? d.ops : part.ops))
        did.push(...(d.did || []))
      } else dropped.push({ text: part.text, why: String(d.reply || '').trim().replace(/\s*No change was used\.$/, '') }) // the message as a whole says what was used
    }
    if (!kept.length) return null
    // what was not done is named, and why follows in its own plain sentence, never in brackets (round 10, item 8)
    const whys = [...new Set(dropped.map((d) => d.why).filter(Boolean))]
    const reply = `Done: ${kept.join('; ')}.${dropped.length ? ` Not done: ${dropped.map((d) => d.text).join('; ')}. ${whys.map((w) => (/[.!?]$/.test(w) ? w : w + '.')).join(' ')} This counts as one change, for what was done.` : ''}`
    return { applied: true, rooms: running, reply, source, ops, did, partial: dropped.length > 0, kept, dropped }
  }

  // "I want 4 bedrooms": the count is reached with rooms added in place, or a new draft; beside other parts it is
  // taken as its own part
  const countOp = diff.ops.find((o) => o.op === 'count')
  if (countOp) {
    if (diff.ops.length === 1) return setCount(countOp, rooms, program, style, kit, source, L, edits, depth)
    const parts = inParts()
    if (parts) return parts
    // nothing went through: each part answers for itself, in the order asked
    const each = partsOf(diff, rooms, kit).map((p) => decide({ ops: p.ops, reply: '', confidence: 1 }, rooms, program, style, kit, source, L, { ...opts, depth: depth + 1 }))
    const nothing = each.every((d) => d.noop)
    const reply = each.map((d) => String(d.reply || '').trim().replace(/\s*No change was used\.$/, '')).filter(Boolean).join(' ') + (nothing ? ' No change was used.' : '')
    return { applied: false, rooms, reply, source, ops: diff.ops, reasons: each.flatMap((d) => d.reasons || []), ...(nothing ? { noop: true } : {}), fixes: each.flatMap((d) => d.fixes || []).filter((f, i, all) => all.findIndex((g) => g.label === f.label) === i).slice(0, 3) }
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
    let reply = plain ? `I can't do that one. ${why.charAt(0).toUpperCase() + why.slice(1)}.`.replace(/\.\.$/, '.') : 'That change did not work out on this plan. Tell me what you would like instead.'
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
    // round 12: a room that cannot grow as asked, and a porch or patio with no wall for it, say why in plain words
    // and offer the closest thing that does work as the button
    const plainer = plain ? growRefusal(diff.ops, why, [], rooms, program, style, kit, L) || porchRefusal(diff.ops, why, [], null, rooms, program, style, kit, L, edits, depth) || addRefusal(diff.ops, why, [], rooms, program, style, kit, L, edits, depth) : null
    if (plainer) {
      reply = plainer.reply
      fixes = plainer.fixes
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
    let reply = caused.length
      ? plainRefusal(caused, preexisting, diff.ops, rooms, kit)
      : `The change itself is fine, but this plan already has a problem that has to go first${problemWords(preexisting, rooms, 'noun') ? `: ${problemWords(preexisting, rooms, 'noun')}` : ''}. Ask me to fix that, or go back one version; the drafter sees the details.`
    // round 12: the same plain words and button when it is the rules that refuse a bigger room or a patio
    const plainer = caused.length ? growRefusal(diff.ops, null, caused, rooms, program, style, kit, L) || porchRefusal(diff.ops, null, caused, next.rooms, rooms, program, style, kit, L, edits, depth) || addRefusal(diff.ops, null, caused, rooms, program, style, kit, L, edits, depth) : null
    if (plainer) {
      reply = plainer.reply
      fixes = plainer.fixes
    }
    // a bedroom that cannot come out in place (its closet and bath would lose their door): one bedroom fewer, as a new draft
    const out1 = diff.ops.length === 1 && diff.ops[0].op === 'remove' ? rooms.find((r) => r.id === diff.ops[0].room) : null
    if (caused.length && out1 && ['bed', 'suite2'].includes(out1.kind) && depth === 0) {
      const fewer = programOf(rooms, program).beds - 1
      const fix = fewer >= 1 ? countFix('bed', fewer, rooms, program, style, kit, source, L, edits, depth) : null
      if (fix) fixes = [fix, ...fixes].slice(0, 3)
    }
    return { applied: false, rooms, reply, source, ops: diff.ops, reasons: rules.reasons, caused, preexisting, fixes }
  }
  return { applied: true, rooms: next.rooms, reply: diff.reply || next.did.join('. ') + '.', source, ops: diff.ops, did: next.did }
}

// ── round 12, item G: four requests a customer test found, in plain words, each with a button that works ──────

/** "4 bedrooms", "1 bathroom", "2 bathrooms and a half bath". */
function countWords(kind, n, half = 0) {
  return `${n} ${kind === 'bed' ? 'bedroom' : 'bathroom'}${n === 1 ? '' : 's'}${kind === 'bath' && half ? ' and a half bath' : ''}`
}
/** A room for a sentence, the way a homeowner says it: "living room", "dining room", "kitchen", "Bedroom 3". */
function plainName(name) {
  const n = String(name || 'room').trim()
  if (/^living$/i.test(n)) return 'living room'
  if (/^dining$/i.test(n)) return 'dining room'
  return /\s\d+$/.test(n) ? n : n.toLowerCase()
}
/** The same with its article: "the kitchen", "the living room", but "Bedroom 3" (a numbered room is called by its name). */
const theRoom = (name) => (/\s\d+$/.test(String(name || '').trim()) ? String(name).trim() : `the ${plainName(name)}`)
/**
 * Why the lot refuses a change, in a homeowner's words: which edge of the lot and how much the city keeps open
 * there, or how much of the lot the house would cover. null when the reasons are not about the lot.
 */
export function lotWords(reasons, subject = null) {
  const list = reasons || []
  const edge = list.find((c) => /would cross the setback at/i.test(c))
  const m = edge && edge.match(/^(.*?) would cross the setback at (\d+(?:\.\d+)?) ft from (.+?)\.?$/i)
  if (m) {
    const side = m[3].toLowerCase()
    const where = side === 'side' ? 'the side of the lot' : side === 'rear' ? 'the back of the lot' : side === 'front' ? 'the street' : side === 'street side' ? 'the side street' : m[3].replace(/\b[a-z]/g, (c) => c.toUpperCase())
    return `${subject || theRoom(m[1])} would end up too close to ${where}, where the city keeps ${m[2]} ft open`
  }
  const cover = list.find((c) => /cover \d+% of the lot/i.test(c))
  const c = cover && cover.match(/cover (\d+)% of the lot.*?;\s*(.+?) allows (\d+)%/i)
  if (c) return c[1] === c[3] ? `the house and porches would cover just over the ${c[3]} percent of the lot that ${c[2]} allows` : `the house and porches would cover ${c[1]} percent of the lot, more than the ${c[3]} percent ${c[2]} allows`
  if (cover || list.some((x) => /would cover .* square feet of the lot|lot allows/i.test(x))) return 'the house would cover more of the lot than is allowed here'
  if (list.some((x) => /setback|property line|trimmed to .* to fit the lot/i.test(x))) return 'part of the house would end up too close to the edge of the lot, inside the space the city keeps open along each edge'
  return null
}
/** A list of ops that applies and passes every rule on this plan: what it draws ({ rooms, did }), or null. */
function passes(ops, rooms, program, style, kit, L) {
  // a size past the largest the kit draws for that room is refused before anything is drawn
  for (const o of ops) {
    const r = o.op === 'resize' ? rooms.find((x) => x.id === o.room) : null
    if (!r) continue
    const [mw, md] = maxSizeOf(kit, r.kind)
    const [MW, MD] = r.w >= r.d ? [Math.max(mw, md), Math.min(mw, md)] : [Math.min(mw, md), Math.max(mw, md)]
    if (o.w > MW + 0.01 || o.d > MD + 0.01) return null
  }
  try {
    const out = applyOps(ops, rooms, kit, program.stories || 1, L)
    return checkRules(out.rooms, program, style, L).ok && !sameRooms(rooms, out.rooms) ? out : null
  } catch {
    return null
  }
}
/** A button's words for a new draft at another size: "Draw a smaller house, about 2,200 sf, with 5 bedrooms". */
const newDraftWords = (sqft, now, withWhat) => (sqft ? `Draw a ${sqft < now ? 'smaller' : 'larger'} house, about ${num(sqft)} sf, with ${withWhat}` : `Draw the house again with ${withWhat}`)
const grewWords = (a, b) => [a ? `${ft(a)} ft wider` : null, b ? `${ft(b)} ft longer` : null].filter(Boolean).join(' and ')
/**
 * The most a room can grow toward a size, in whole feet each way, that applies and passes: { a, b, ops } (a feet
 * wider, b feet longer) or null. The steps tried run from the size asked down to one foot on one side.
 */
function closestGrow(r, askW, askD, rooms, program, style, kit, L, { exact = false } = {}) {
  const [mw, md] = maxSizeOf(kit, r.kind)
  const [MW, MD] = r.w >= r.d ? [Math.max(mw, md), Math.min(mw, md)] : [Math.min(mw, md), Math.max(mw, md)]
  // the room to grow each way, to a quarter foot ("30 ft wide at most" from 27.5 is 2.5 ft)
  const roomA = Math.max(0, Math.floor((Math.min(askW, MW) - r.w + 0.01) * 4) / 4)
  const roomB = Math.max(0, Math.floor((Math.min(askD, MD) - r.d + 0.01) * 4) / 4)
  // one way only ("3 ft wider"): every whole foot down from the most, so the widest that fits is found (round 15,
  // P3); both ways: the most, half of it and a foot, each way
  const steps = (max, other) => [...new Set([max, ...(other ? [Math.ceil(max / 2), Math.min(1, max)] : Array.from({ length: Math.floor(max) }, (_, i) => Math.floor(max) - i)), 0])]
  const asked = (a, b) => !exact && Math.abs(r.w + a - askW) < 0.01 && Math.abs(r.d + b - askD) < 0.01
  const tryGrow = (a, b) => {
    if (!(a || b) || asked(a, b)) return null
    const ops = [{ op: 'resize', room: r.id, w: r.w + a, d: r.d + b }]
    return passes(ops, rooms, program, style, kit, L) ? { a, b, ops } : null
  }
  // one way only: the widest that fits, to a quarter foot (the most whole feet that fit, then the quarters above)
  if (!roomA !== !roomB) {
    const max = roomA || roomB
    const at = (v) => (roomA ? tryGrow(v, 0) : tryGrow(0, v))
    let best = null
    for (const v of steps(max, 0)) if (v && (best = at(v))) break
    const base = best ? best.a || best.b : 0
    if (base < max) for (const f of [0.75, 0.5, 0.25]) if (base + f < max - 0.01) {
      const finer = at(base + f)
      if (finer) return finer
    }
    return best
  }
  const cands = []
  for (const a of steps(roomA, roomB)) for (const b of steps(roomB, roomA)) if ((a || b) && !asked(a, b)) cands.push([a, b])
  cands.sort((p, q) => (r.w + q[0]) * (r.d + q[1]) - (r.w + p[0]) * (r.d + p[1]))
  for (const [a, b] of cands.slice(0, 16)) {
    const got = tryGrow(a, b)
    if (got) return got
  }
  return null
}
/**
 * "Make the kitchen bigger" that the plan or the lot refuses: the real reason in plain words and the closest
 * growth that does work ("2 ft longer") as the button. null when the change is not one room growing.
 * @param {string|null} why   what applying it threw ("Kitchen cannot grow that way: ..."), or null
 * @param {string[]} caused   the rules it broke, when it applied and then failed them
 */
function growRefusal(ops, why, caused, rooms, program, style, kit, L) {
  const real = ops.filter((o) => !o.auto)
  if (real.length !== 1 || real[0].op !== 'resize') return null
  const o = real[0]
  const r = rooms.find((x) => x.id === o.room)
  if (!r || o.w < r.w - 0.01 || o.d < r.d - 0.01 || (o.w <= r.w + 0.01 && o.d <= r.d + 0.01)) return null
  const name = theRoom(r.name)
  let because
  if (why) {
    const inner = String(why).replace(/^.*? cannot grow that way:\s*/, '').replace(/\.$/, '')
    let m
    if ((m = inner.match(/^(.+?) would cross the setback$/i))) because = `${m[1] === r.name ? 'it' : theRoom(m[1])} would end up too close to the edge of the lot, inside the space the city keeps open along each edge`
    else if ((m = inner.match(/^(.+?) would be too small$/i))) because = `${theRoom(m[1])} next to it would be left too small`
    else if ((m = inner.match(/^(.+?) in the (.+?) is in the way$/i))) because = `the ${m[1].toLowerCase()} in ${theRoom(m[2])} is in the way`
    else if ((m = inner.match(/^(.+?) is in the way$/i))) because = `${theRoom(m[1])} is in the way`
    else if ((m = inner.match(/^(.+?) would run into the (.+)$/i))) because = `${theRoom(m[1])} would run into ${theRoom(m[2])}`
    else because = 'the rooms around it would no longer work as drawn'
  } else {
    const words = problemWords(caused, rooms, 'verb')
    because = lotWords(caused) || (words ? `that ${words}` : 'the rooms around it would no longer work as drawn')
  }
  const best = closestGrow(r, o.w, o.d, rooms, program, style, kit, L)
  const fixes = best ? [{ label: `Make ${name} ${grewWords(best.a, best.b)}`, ops: best.ops }] : []
  // round 15, U12: one sentence, and the most that fits as the button (never a rule speech)
  const reply = best ? `${cap1(name)} can only grow ${grewWords(best.a, best.b)} here: ${because}.` : `${cap1(name)} cannot get bigger where it sits: ${because}.`
  return { reply, fixes }
}
const cap1 = (s) => String(s).replace(/^\p{Ll}/u, (c) => c.toUpperCase())
/**
 * A porch or a covered patio the plan or the lot refuses: why, in plain words, and what does work as buttons: the
 * same porch smaller, the room behind it a little shorter, or a new draft of the house with one. Each is checked.
 * null when the change is not one porch being added (or the plan already has it).
 * @param {object[]|null} next  the rooms as drawn with the porch, when it applied and then broke a rule
 */
function porchRefusal(ops, why, caused, next, rooms, program, style, kit, L, edits, depth) {
  const real = ops.filter((o) => !o.auto)
  if (real.length !== 1 || real[0].op !== 'add' || !['rearPorch', 'frontPorch'].includes(real[0].kind)) return null
  if (why && /already has/i.test(why)) return null
  const o = real[0]
  const rear = o.kind === 'rearPorch'
  const what = /patio|lanai/i.test(o.name || '') ? 'covered patio' : rear ? 'rear porch' : 'front porch'
  const where = rear ? 'at the back' : 'at the front'
  const list = rooms.filter(isRoom)
  const fixes = []
  // 1. the same porch, smaller: the widest and deepest that passes
  const drawn = (next || []).find((r) => isRoom(r) && r.kind === o.kind)
  if (drawn) {
    const minD = kit.porch?.minDepthFt || 8
    const sizes = []
    for (const part of [1, 0.75, 0.6, 0.5]) for (const d of [Math.floor(drawn.d), minD]) {
      const w = Math.max(8, Math.floor(drawn.w * part))
      if (w * d < drawn.w * drawn.d - 1 && !sizes.some((s) => s[0] === w && s[1] === d)) sizes.push([w, d])
    }
    sizes.sort((p, q) => q[0] * q[1] - p[0] * p[1])
    for (const [w, d] of sizes) {
      const cand = [{ ...o, w, d }]
      if (!passes(cand, rooms, program, style, kit, L)) continue
      fixes.push({ label: `Add a smaller ${what}, ${ft(w)} ft by ${ft(d)} ft`, ops: cand })
      break
    }
  }
  // 2. the room it goes behind gives up a little depth to make room
  // (the room the porch was drawn against when it was drawn; else the living room, the dining room, the foyer)
  const against = drawn && drawn.x !== undefined ? (next || []).find((r) => isRoom(r) && !r.open && ['living', 'dining', 'foyer'].includes(r.kind) && Math.min(r.x + r.w, drawn.x + drawn.w) - Math.max(r.x, drawn.x) > 1 && Math.abs(rear ? r.y - (drawn.y + drawn.d) : r.y + r.d - drawn.y) < 0.6) : null
  const host = (against && list.find((r) => r.id === against.id)) || (rear ? list.find((r) => r.kind === 'living') || list.find((r) => r.kind === 'dining') : list.find((r) => r.kind === 'foyer') || list.find((r) => r.kind === 'living'))
  if (host && depth < 2 && fixes.length < 2)
    for (const cut of [2, 4]) {
      const cand = [{ op: 'resize', room: host.id, w: host.w, d: host.d - cut }, o]
      if (!passes(cand, rooms, program, style, kit, L)) continue
      fixes.push({ label: `Make ${theRoom(host.name)} ${cut} ft shorter to make room for the ${what}`, ops: cand })
      break
    }
  // 3. the house drawn again with the porch, at the size it is or the largest that fits with one (when nothing smaller does)
  if (depth === 0 && !fixes.length) {
    const over = { [rear ? 'rearPorch' : 'frontPorch']: true }
    const has = (r) => r.ok && r.rooms.some((x) => isRoom(x) && x.kind === o.kind)
    let sqft = null
    let r = redraft(null, rooms, program, style, L, edits, over)
    if (!has(r) && r.max) {
      sqft = Math.floor(r.max / 50) * 50
      r = Math.abs(sqft - floorArea(rooms, program.stories || 1)) > 25 ? redraft(sqft, rooms, program, style, L, edits, over) : { ok: false }
    }
    if (has(r)) fixes.push({ label: newDraftWords(sqft, floorArea(rooms, program.stories || 1), `a ${what} ${where}`), ops: [{ op: 'redraft', ...(sqft ? { sqft } : {}), program: over }] })
  }
  let because
  if (why) because = rear ? 'there is no open stretch of wall at the back of the house for it on this plan, because other rooms sit behind the living room and the dining room' : 'there is no open stretch of wall at the front of the house for it on this plan'
  else {
    const words = problemWords(caused, rooms, 'verb')
    because = lotWords(caused) || (words ? `that ${words}` : 'the plan would not work as drawn with it')
  }
  const reply = `A ${what} ${where} does not fit as asked: ${because}. ${fixes.length ? 'Here is what would work:' : 'Tell me which room could give up some space, or ask for a smaller house.'}`
  return { reply, fixes }
}
// where a room that will not go where it was asked is tried next, in this order
const ADD_HOSTS = ['hall', 'foyer', 'living', 'dining', 'kitchen', 'laundry', 'mud']
// the rooms a new draft carries as a program flag
const PROGRAM_FLAG = { office: { office: true }, halfbath: { halfBath: true }, suite2: { suite2: true } }
/**
 * Round 15, U4: a room added ("add an office", "add a half bath", "add a bedroom") that the plan or the lot refuses.
 * The real reason in one plain sentence, and the one thing that does work as the button: the same room beside
 * another room, a new draft of the house with it (at the size it is, or the largest that fits), an office in place
 * of a bedroom; or, when nothing does, the plain words that there is no room for it. Never "a smaller step": a room
 * has none. null when the change is not one room being added (a garage and a porch have their own answers).
 */
function addRefusal(ops, why, caused, rooms, program, style, kit, L, edits, depth) {
  const real = ops.filter((o) => !o.auto)
  if (real.length !== 1 || real[0].op !== 'add') return null
  const o = real[0]
  if (['garage', 'rearPorch', 'frontPorch'].includes(o.kind) || (why && /already has/i.test(why))) return null
  const stories = program.stories || 1
  const kindName = String(kit.rooms[o.kind]?.name || o.kind).toLowerCase()
  const a = `${/^[aeiou]/.test(kindName) ? 'an' : 'a'} ${kindName}`
  const list = rooms.filter(isRoom)
  const fixes = []
  // 1. the same room beside another room
  for (const k of ADD_HOSTS) {
    const host = list.find((r) => r.kind === k)
    if (!host || host.id === o.near) continue
    const cand = [{ ...o, near: host.id }]
    if (!passes(cand, rooms, program, style, kit, L)) continue
    fixes.push({ label: `Add ${a} next to ${theRoom(host.name)}`, ops: cand })
    break
  }
  // 2. the house drawn again with it: one more bedroom or bath by count, or the room as part of the program
  if (!fixes.length && depth === 0) {
    const now = floorArea(rooms, stories)
    if (o.kind === 'bed' || o.kind === 'bath') {
      const fix = countFix(o.kind, programOf(rooms, program)[o.kind === 'bed' ? 'beds' : 'baths'] + 1, rooms, program, style, kit, 'fallback', L, edits, depth)
      if (fix) fixes.push(fix)
    } else if (PROGRAM_FLAG[o.kind]) {
      const over = PROGRAM_FLAG[o.kind]
      const has = (r) => r.ok && r.rooms.some((x) => isRoom(x) && x.kind === o.kind)
      let sqft = null
      let r = redraft(null, rooms, program, style, L, edits, over)
      if (!has(r) && r.max) {
        sqft = Math.floor(r.max / 50) * 50
        r = Math.abs(sqft - now) > 25 ? redraft(sqft, rooms, program, style, L, edits, over) : { ok: false }
      }
      if (has(r)) fixes.push({ label: newDraftWords(sqft, now, a), ops: [{ op: 'redraft', ...(sqft ? { sqft } : {}), program: over }] })
      // 3. an office in place of a bedroom, when the house keeps at least two
      const beds = programOf(rooms, program).beds
      if (!fixes.length && o.kind === 'office' && beds > 2) {
        const swap = { office: true, beds: beds - 1 }
        if (has(redraft(null, rooms, program, style, L, edits, swap))) fixes.push({ label: 'Draw the house again with an office in place of a bedroom', ops: [{ op: 'redraft', program: swap }] })
      }
    }
  }
  let because
  if (why) because = lotWords([why]) || problemWords([why], rooms, 'noun') || 'there is no free wall for it where the rooms are'
  else because = lotWords(caused) || problemWords(caused, rooms, 'noun') || 'the rooms around it would no longer work as drawn'
  const reply = fixes.length ? `There is no room for ${a} where it would go: ${because}.` : `There is no room for ${a} on this lot: ${because}.`
  return { reply, fixes }
}
/** A button that sets the house to a number of bedrooms or bathrooms, when that goes through: { label, ops } or null. */
function countFix(kind, n, rooms, program, style, kit, source, L, edits, depth, half = 0) {
  const ops = [{ op: 'count', kind, count: n, ...(half ? { half: 1 } : {}) }]
  const d = decide({ ops, reply: '', confidence: 1 }, rooms, program, style, kit, source, L, { history: edits, depth: depth + 1 })
  return d.applied ? { label: `${d.redrafted ? 'Draw the house again with' : 'Make it'} ${countWords(kind, n, half)}`, ops } : null
}
/**
 * "I want 4 bedrooms", "make it 3 bathrooms": the house is set to that many. More: the rooms are added where the
 * plan grows (the bedroom wing), and when that does not pass, the house is drawn again with that many; fewer: a
 * new draft (a bedroom cannot come out in place without its closet and bath losing their door). The client's
 * room edits are put back on a new draft. Refused in plain words, with the nearest count that works, when the lot
 * or the style cannot take it.
 */
function setCount(o, rooms, program, style, kit, source, L, edits, depth) {
  const stories = program.stories || 1
  const key = o.kind === 'bed' ? 'beds' : 'baths'
  const n = o.count
  const ops = [o]
  const counted = programOf(rooms, program)
  const have = counted[key]
  // "2.5 baths", "dos baños y medio" (round 15, U3): n full baths and a half bath
  const half = o.kind === 'bath' && o.half ? 1 : 0
  const haveHalf = counted.halfBaths || 0
  const needHalf = half && !haveHalf
  const say = (k, h = half) => countWords(o.kind, k, h)
  // what the plan has now, said the way the ask was: "2" for a plain count, "2 bathrooms" beside a half bath
  const had = half ? say(have, haveHalf) : String(have)
  const reached = (list, prog) => {
    const c = programOf(list, prog)
    return c[key] === n && (!half || c.halfBaths > 0)
  }
  const over = { [key]: n, ...(half ? { halfBath: true } : {}) }
  if (n === have && !needHalf) return { applied: false, rooms, reply: `This plan already has ${say(n)}. No change was used.`, source, ops, reasons: ['no change'], noop: true }
  const [lo, hi] = programLimits(style)[key] || [1, 6]
  if (n < lo || n > hi) {
    const near = n < lo ? lo : hi
    const fix = near !== have && depth < 2 ? countFix(o.kind, near, rooms, program, style, kit, source, L, edits, depth, half) : null
    return { applied: false, rooms, reply: `${style?.name || 'This style'} is drawn with ${lo} to ${hi} ${o.kind === 'bed' ? 'bedrooms' : 'bathrooms'}, so ${say(n, 0)} is outside what I can draw. This plan has ${have}.`, source, ops, reasons: ['out of range'], fixes: fix ? [fix] : [] }
  }
  // more (or the half bath only): added in place first, the way "add a bedroom" does it
  if (n >= have) {
    const adds = [...Array.from({ length: n - have }, () => ({ op: 'add', kind: o.kind })), ...(needHalf ? [{ op: 'add', kind: 'halfbath' }] : [])]
    const out = passes(adds, rooms, program, style, kit, L)
    if (out && reached(out.rooms, program)) {
      return { applied: true, rooms: out.rooms, reply: `The house now has ${say(n)}; it had ${had}. ${out.did.join('. ')}.`, source, ops: adds, did: out.did }
    }
  }
  // a new draft of the house as it stands, with that many
  const r = redraft(null, rooms, program, style, L, edits, over)
  if (r.ok && reached(r.rooms, r.program)) {
    const plan = PLAN_WORDS[r.planId] || r.planId || 'same'
    const reply = `Drew the house again with ${say(n)}; it had ${had}. It is ${num(floorArea(r.rooms, stories))} sf of living area on the ${plan} plan.${editsLine(r)}`
    return { applied: true, rooms: r.rooms, reply, source, ops: [{ op: 'redraft', program: over }], did: [`${say(n)} (was ${had})`], redrafted: true, program: r.program, kept: r.kept, dropped: r.dropped }
  }
  // refused: why, and the nearest thing that goes through
  const fixes = []
  if (depth === 0) {
    const max = r.max ? Math.floor(r.max / 50) * 50 : null
    if (max && Math.abs(max - floorArea(rooms, stories)) > 25) {
      const r2 = redraft(max, rooms, program, style, L, edits, over)
      if (r2.ok && reached(r2.rooms, r2.program)) fixes.push({ label: newDraftWords(max, floorArea(rooms, stories), say(n)), ops: [{ op: 'redraft', sqft: max, program: over }] })
    }
    const step = half ? n : n > have ? n - 1 : n + 1
    if (step !== have && fixes.length < 2) {
      const fix = countFix(o.kind, step, rooms, program, style, kit, source, L, edits, depth)
      if (fix) fixes.push(fix)
    }
  }
  const because = lotWords(r.reasons, 'the house') || 'the rooms do not all fit on this lot at a size that works'
  const reply = `${say(n).replace(/^./, (ch) => ch.toUpperCase())} ${n === 1 && !half ? 'does' : 'do'} not fit on this lot: ${because}. This plan has ${had}.${fixes.length ? ' Here is what would work:' : ''}`
  return { applied: false, rooms, reply, source, ops, reasons: r.reasons?.length ? r.reasons : ['does not fit'], caused: r.reasons || [], preexisting: [], fixes }
}
/** The rooms open to a room on this plan (no wall between them), the way the audit reads the kit: a set of room ids. */
function openTo(from, rooms, kit) {
  const planId = planIdOf(rooms)
  const pairs = (planId && planId !== 'standard' && kit.plans?.[planId]?.open) || kit.plan?.open || []
  const open = new Set(pairs.flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]))
  const { rooms: flat } = withPlanCoords(rooms, kit)
  const list = flat.filter(isRoom)
  const shared = (a, b) => {
    const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
    const oy = Math.min(a.y + a.d, b.y + b.d) - Math.max(a.y, b.y)
    return (ox > 1 && Math.abs(oy) < 0.75) || (oy > 1 && Math.abs(ox) < 0.75)
  }
  const seen = new Set([from.id])
  const queue = [list.find((r) => r.id === from.id)].filter(Boolean)
  while (queue.length) {
    const a = queue.shift()
    for (const b of list) {
      if (seen.has(b.id) || !(open.has(`${a.id}|${b.id}`) || open.has(`${a.kind}|${b.kind}`)) || !shared(a, b)) continue
      seen.add(b.id)
      queue.push(b)
    }
  }
  return seen
}
/**
 * "Make it feel more open": what is true of the plan (the public rooms the kit already draws as one space, their
 * ceiling height), what cannot be drawn from the chat (a wall taken out, a taller ceiling: the plan code has no
 * such change), and the changes that do apply as buttons: more room for the living room, the kitchen and the
 * dining room, each checked on this plan and this lot. Nothing is changed and no change is used.
 */
function openOffer(rooms, program, style, kit, source, L) {
  const list = rooms.filter(isRoom)
  const pub = ['kitchen', 'dining', 'living'].map((k) => list.find((r) => r.kind === k)).filter(Boolean)
  const kitchen = pub.find((r) => r.kind === 'kitchen') || pub[0]
  const joined = kitchen ? openTo(kitchen, rooms, kit) : new Set()
  const inSpace = pub.filter((r) => joined.has(r.id))
  const apart = pub.filter((r) => !joined.has(r.id))
  const names = (rs) => rs.map((r) => theRoom(r.name)).join(', ').replace(/, ([^,]*)$/, ' and $1')
  const said = []
  if (inSpace.length >= 2) {
    const heights = [...new Set(inSpace.map((r) => kit.plates?.byRoom?.[r.kind] || kit.plates?.default))]
    const base = kit.plates?.default
    const tall = heights.length === 1 && heights[0] && base && heights[0] > base ? `, and the ceilings there are ${heights[0]} ft where the bedrooms have ${base}` : ''
    said.push(`${names(inSpace).replace(/^t/, 'T')} on this plan are already ${inSpace.length > 2 ? 'one open space, with no walls between them' : 'open to each other, with no wall between them'}${tall}.`)
  }
  if (apart.length && inSpace.length >= 2) said.push(`${names(apart).replace(/^t/, 'T')} ${apart.length > 1 ? 'have their' : 'has its'} own walls on this plan.`)
  said.push(`Taking out ${inSpace.length >= 2 ? 'other walls' : 'a wall'} or raising a ceiling is not something I can draw from here; bring that up with the office.`)
  const fixes = []
  const q4 = (v) => Math.round(v * 4) / 4
  for (const r of pub) {
    const name = theRoom(r.name)
    // "bigger" the way the chat reads it (about 15 percent each way), never past the largest the kit draws
    const [mw, md] = maxSizeOf(kit, r.kind)
    const [MW, MD] = r.w >= r.d ? [Math.max(mw, md), Math.min(mw, md)] : [Math.min(mw, md), Math.max(mw, md)]
    const bigger = [{ op: 'resize', room: r.id, w: Math.max(r.w, Math.min(q4(r.w * 1.15), MW)), d: Math.max(r.d, Math.min(q4(r.d * 1.15), MD)), soft: true }]
    if (passes(bigger, rooms, program, style, kit, L)) {
      fixes.push({ label: `Make ${name} bigger`, ops: bigger })
      continue
    }
    const best = closestGrow(r, q4(r.w * 1.15), q4(r.d * 1.15), rooms, program, style, kit, L)
    if (best) fixes.push({ label: `Make ${name} ${grewWords(best.a, best.b)}`, ops: best.ops })
  }
  said.push(fixes.length ? 'What I can do now is give that space more room. Pick one below; a change is used only when you pick.' : pub.length ? 'I also tried giving those rooms more space, and none of them can grow where it sits on this lot.' : OPEN_ASK)
  return { applied: false, rooms, reply: said.join(' '), source, ops: [], reasons: ['open plan offer'], offer: 'open', fixes }
}

// ── round 13: a request nobody could read, and two wishes that pull against each other ────────────────────────

/**
 * Changes that work on this plan right now, as buttons: the same suggestions the Draft screen shows under the
 * chat (a bigger kitchen, a porch on the back, one more car, a bedroom, an office, a bigger primary bath, a half
 * bath), then a few more for a plan where those do not fit. Each is read the way typing it would be read, and is
 * kept only if it applies and passes every rule; a "bigger" that does not fit becomes the growth that does.
 * @returns {{ label: string, ops: object[] }[]}  at most `want`
 */
export function exampleFixes(rooms, program, style, kit, lot, want = 3) {
  const L = lotOf(lot)
  const list = rooms.filter(isRoom)
  const has = (k) => list.some((r) => r.kind === k)
  const cands = []
  if (has('kitchen')) cands.push('Make the kitchen bigger')
  cands.push(has('rearPorch') ? 'Remove the rear porch' : 'Add a porch on the back')
  const garage = list.find((r) => r.kind === 'garage')
  if (garage) {
    const cars = garage.tandem || /tandem/i.test(garage.name || '') ? 3 : Math.max(1, Math.round(Math.max(garage.w, garage.d) / (kit.rooms.garage?.perCar || 11)))
    if (cars < 3) cands.push(`Make the garage ${cars + 1} cars`)
  } else cands.push('Add a 2-car garage')
  if (list.filter((r) => ['bed', 'master', 'suite2'].includes(r.kind)).length < 5) cands.push('Add a bedroom')
  if (!has('office')) cands.push('Add an office')
  if (has('mbath')) cands.push('Make the primary bath bigger')
  if (!has('halfbath')) cands.push('Add a half bath')
  if (has('living')) cands.push('Make the living room bigger')
  if (has('master')) cands.push('Make the primary bedroom bigger')
  if (has('dining')) cands.push('Make the dining room bigger')
  if (has('office')) cands.push('Remove the office')
  if (has('halfbath')) cands.push('Remove the half bath')
  if (!has('pantry')) cands.push('Add a pantry')
  if (has('laundry')) cands.push('Make the laundry bigger')
  const out = []
  for (const label of cands) {
    if (out.length >= want) break
    const read = regexOps(label, rooms, kit, L, { split: false })
    if (!read.ops?.length) continue
    const ops = growSwaps(normalizeOps(read.ops, rooms), rooms, kit)
    if (!validateOps(ops, rooms, kit).ok) continue
    if (passes(ops, rooms, program, style, kit, L)) {
      out.push({ label, ops })
      continue
    }
    // "bigger" that does not fit as a whole: the most that room can grow, said as what it is
    const o = ops.length === 1 && ops[0].op === 'resize' && ops[0].soft ? ops[0] : null
    const r = o && rooms.find((x) => x.id === o.room)
    const best = r && o.w >= r.w && o.d >= r.d ? closestGrow(r, o.w, o.d, rooms, program, style, kit, L) : null
    if (best) out.push({ label: `Make ${theRoom(r.name)} ${grewWords(best.a, best.b)}`, ops: best.ops })
  }
  return out
}

/**
 * "Make it nicer", "hazla más bonita", "más bonita" (round 15, B6): three things that make a house look nicer, as
 * buttons, each checked on this plan: bigger windows, a front porch (or a deeper one, or a smaller one that fits),
 * and another style (the style step; nothing is used). Nothing is changed until a button is tapped.
 */
export function nicerOffer(rooms, program, style, kit, source, lot, edits = []) {
  const L = lotOf(lot)
  const fixes = []
  const windows = [{ op: 'windows', grow: 2 }]
  if (passes(windows, rooms, program, style, kit, L)) fixes.push({ label: 'Make the windows bigger', ops: windows })
  else if (passes([{ op: 'windows', grow: 1 }], rooms, program, style, kit, L)) fixes.push({ label: 'Make the windows bigger', ops: [{ op: 'windows', grow: 1 }] })
  const porch = rooms.find((r) => isRoom(r) && r.kind === 'frontPorch')
  if (porch) {
    for (const more of [2, 1]) {
      const ops = [{ op: 'resize', room: porch.id, w: porch.w, d: porch.d + more }]
      if (!passes(ops, rooms, program, style, kit, L)) continue
      fixes.push({ label: `Make the front porch ${more} ft deeper`, ops })
      break
    }
  } else {
    const t = kit.rooms.frontPorch || {}
    const sizes = [null, [Math.max(10, Math.floor((t.w || 16) * 0.75)), Math.max(6, kit.porch?.minDepthFt || 6)], [10, Math.max(5, kit.porch?.minDepthFt || 5)]]
    for (const size of sizes) {
      const ops = [{ op: 'add', kind: 'frontPorch', ...(size ? { w: size[0], d: size[1] } : {}) }]
      if (!passes(ops, rooms, program, style, kit, L)) continue
      fixes.push({ label: size ? `Add a front porch, ${ft(size[0])} ft by ${ft(size[1])} ft` : 'Add a front porch', ops })
      break
    }
    if (!fixes.some((f) => /porch/.test(f.label))) {
      const over = { frontPorch: true }
      const r = redraft(null, rooms, program, style, L, edits, over)
      if (r.ok && r.rooms.some((x) => isRoom(x) && x.kind === 'frontPorch')) fixes.push({ label: 'Draw the house again with a front porch', ops: [{ op: 'redraft', program: over }] })
    }
  }
  fixes.push({ label: 'Choose another style', goto: 'style', ops: [] })
  const reply = fixes.length > 1 ? 'Here are some ways to make it nicer on this plan. Tap one; choosing a style is free, and a change is used only when the plan changes.' : 'The windows and the porch cannot grow on this plan as it sits on this lot; another style is the way to change its look. Choosing a style is free.'
  return { applied: false, rooms, reply, source, ops: [], reasons: ['nicer'], offer: 'nicer', fixes }
}

/** "asdf", "hmm": the chat says it did not catch that and shows changes that work here. Nothing is used. */
function unclearOffer(rooms, program, style, kit, source, L) {
  const fixes = exampleFixes(rooms, program, style, kit, L)
  const reply = fixes.length
    ? 'I did not catch that. Here are some changes that work on this plan. Tap one, or tell me in your own words what you would like; a change is used only when you tap one.'
    : 'I did not catch that. Tell me what you would like to change, like "make the kitchen bigger" or "add an office".'
  return { applied: false, rooms, reply, source, ops: [], reasons: ['unclear'], offer: 'examples', fixes }
}

/**
 * "Make the house smaller but add 2 bedrooms": the two wishes pull against each other, so nothing is guessed. The
 * answer says why in plain words and offers ONE option that applies on this lot and passes every rule: a house a
 * little smaller with the bedrooms asked for (or one more, when that is what fits), drawn again with the client's
 * room edits put back; failing that, the house at the size it is with one more. null when the request is not a
 * trade-off after all (the plan already has that many).
 * @param {{ kind: 'bed' | 'bath', add?: number, count?: number }} ask  from tradeOffAsk()
 */
export function tradeOffer(ask, rooms, program, style, kit, source, lot, edits = []) {
  const L = lotOf(lot)
  const stories = program.stories || 1
  const key = ask.kind === 'bed' ? 'beds' : 'baths'
  const have = programOf(rooms, program)[key]
  const asked = ask.count ?? have + (ask.add || 1)
  if (asked <= have) return null
  const [, hi] = programLimits(style)[key] || [1, 6]
  const now = floorArea(rooms, stories)
  const say = (n) => countWords(ask.kind, n)
  const head = `A smaller house with more ${ask.kind === 'bed' ? 'bedrooms' : 'bathrooms'} is two wishes that pull against each other: every ${ask.kind === 'bed' ? 'bedroom' : 'bathroom'} needs floor area of its own, so the other rooms have to give some up. This plan is ${num(now)} sf with ${say(have)}.`
  const tap = 'Tap the button to see it; a change is used only when you tap.'
  const reasons = ['trade-off']
  if (have >= hi) return { applied: false, rooms, reply: `${head} This plan already has ${say(have)}, the most this style is drawn with.`, source, ops: [], reasons, offer: 'trade-off', fixes: [] }
  // a house a little smaller with the bedrooms asked for; then with one more than it has
  const targets = [...new Set([Math.min(asked, hi), have + 1])]
  for (const n of targets) {
    for (const part of [0.95, 0.9]) {
      const sqft = Math.round((now * part) / 50) * 50
      if (now - sqft < 40) continue
      const r = redraft(sqft, rooms, program, style, L, edits, { [key]: n })
      if (!r.ok || programOf(r.rooms, r.program)[key] !== n) continue
      const got = floorArea(r.rooms, stories)
      if (got > now - 25) continue
      const short = n < asked ? ` ${say(asked).replace(/^./, (c) => c.toUpperCase())} ${asked === 1 ? 'does' : 'do'} not fit in a smaller house on this lot.` : ''
      const fix = { label: newDraftWords(sqft, now, say(n)), ops: [{ op: 'redraft', sqft, program: { [key]: n } }] }
      return { applied: false, rooms, reply: `${head} What I can draw is a house a little smaller, about ${num(got)} sf, with ${say(n)}.${short} ${tap}`, source, ops: [], reasons, offer: 'trade-off', fixes: [fix] }
    }
  }
  // no smaller house holds them: the house at the size it is, with one more
  const n = have + 1
  const same = countFix(ask.kind, n, rooms, program, style, kit, source, L, edits, 0)
  if (same) return { applied: false, rooms, reply: `${head} A smaller house with ${say(n)} does not fit on this lot at room sizes that work. What I can do is keep the house about the size it is, with ${say(n)}. ${tap}`, source, ops: [], reasons, offer: 'trade-off', fixes: [{ label: `Keep the house about this size, with ${say(n)}`, ops: same.ops }] }
  // more of them fit nowhere on this lot: the smaller house, with the rooms it has, is the wish that can be drawn
  for (const part of [0.95, 0.9]) {
    const sqft = Math.round((now * part) / 50) * 50
    if (now - sqft < 40) continue
    const ops = [{ op: 'scale', sqft }]
    const d = decide({ ops, reply: '', confidence: 1 }, rooms, program, style, kit, source, L, { history: edits, depth: 1 })
    if (!d.applied || floorArea(d.rooms, stories) > now - 25 || programOf(d.rooms, d.program || program)[key] !== have) continue
    return { applied: false, rooms, reply: `${head} More ${ask.kind === 'bed' ? 'bedrooms' : 'bathrooms'} do not fit on this lot, in a smaller house or in this one. What I can draw is the smaller house, about ${num(floorArea(d.rooms, stories))} sf, with the ${say(have)} it has now. ${tap}`, source, ops: [], reasons, offer: 'trade-off', fixes: [{ label: `Make the house smaller, about ${num(sqft)} sf, and keep ${say(have)}`, ops }] }
  }
  return { applied: false, rooms, reply: `${head} I could not find a way to draw both on this lot. Tell me which matters more, the smaller house or the ${ask.kind === 'bed' ? 'bedrooms' : 'bathrooms'}, and I will draw that.`, source, ops: [], reasons, offer: 'trade-off', fixes: [] }
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
