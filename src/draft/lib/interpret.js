// Plain-language change requests → ops → rules → applied plan.
// Claude does the interpreting through the office API (key stays server-side);
// the regex fallback takes over when the API is unreachable or unsure.
import { api } from './api.js'
import { kitFor, lotOf } from './layout.js'
import { validateOps, applyOps, regexOps, summarizeRooms } from './ops.js'
import { checkRules } from './rules.js'

const MIN_CONFIDENCE = 0.5
// the office said it has no interpreter: do not wait on it again for a while
let offlineUntil = 0

/** Calls the office interpreter. Throws when it cannot. */
export async function claudeInterpreter({ text, rooms, program, kit }) {
  if (Date.now() < offlineUntil) throw Object.assign(new Error('interpreter not configured'), { unconfigured: true })
  let res
  try {
    res = await api.interpret({
    text,
    rooms: summarizeRooms(rooms),
    program,
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
  const interpreter = opts.interpreter || claudeInterpreter
  let diff
  let source = 'claude'
  try {
    diff = await interpreter({ text, rooms, program, kit })
  } catch (e) {
    diff = regexOps(text, rooms, kit, lotOf(opts.lot))
    source = /abort|timed? ?out|504/i.test(String(e?.name || '') + String(e?.message || '')) ? 'timeout' : 'fallback'
  }
  const result = decide(diff, rooms, program, style, kit, source, lotOf(opts.lot))
  if (!opts.interpreter && opts.report !== false) api.verdict({ text, client: opts.lot?.client, source, applied: result.applied, reasons: result.reasons || [], reply: result.reply, ops: result.ops })
  return result
}

/** The deterministic part: confidence gate, shape check, apply, rules. */
export function decide(diff, rooms, program, style, kit, source, lot) {
  const L = lotOf(lot)
  if ((diff.confidence ?? 1) < MIN_CONFIDENCE || !diff.ops?.length) {
    return { applied: false, rooms, reply: diff.reply || 'I am not sure what to change. Can you say it another way?', source, ops: [] }
  }
  const v = validateOps(diff.ops, rooms, kit)
  if (!v.ok) return { applied: false, rooms, reply: `I could not apply that: ${v.errors[0]}.`, source, ops: diff.ops, reasons: v.errors }

  let next
  try {
    next = applyOps(diff.ops, rooms, kit, program.stories || 1, L)
  } catch (e) {
    return { applied: false, rooms, reply: 'That change did not work out on this plan. Try a smaller step.', source, ops: diff.ops, reasons: [String(e.message || e)] }
  }
  const rules = checkRules(next.rooms, program, style, L)
  if (!rules.ok) {
    // what the change caused, apart from what the plan already had
    const before = checkRules(rooms, program, style, L).reasons
    const preexisting = rules.reasons.filter((r) => before.includes(r))
    const caused = rules.reasons.filter((r) => !before.includes(r))
    const fixes = suggestFixes(diff.ops, caused.length ? caused : preexisting, rooms, next.rooms, program, style, kit, L, caused.length > 0)
    const reply = caused.length
      ? `I can't do that one. ${caused.join(' ')}${preexisting.length ? ` The plan also has a problem from before: ${preexisting.join(' ')}` : ''}`
      : `The change itself is fine, but this plan already has a problem that has to go first: ${preexisting.join(' ')}`
    return { applied: false, rooms, reply, source, ops: diff.ops, reasons: rules.reasons, caused, preexisting, fixes }
  }
  return { applied: true, rooms: next.rooms, reply: diff.reply || next.did.join('. ') + '.', source, ops: diff.ops, did: next.did }
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
      for (const part of [0.75, 0.5, 0.25, 0.1]) {
        const w = Math.round((r.w + (o.w - r.w) * part) * 4) / 4
        const d = Math.round((r.d + (o.d - r.d) * part) * 4) / 4
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
