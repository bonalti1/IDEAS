// Plain-language change requests → ops → rules → applied plan.
// Claude does the interpreting through the office API (key stays server-side);
// the regex fallback takes over when the API is unreachable or unsure.
import { api } from './api.js'
import { kitFor } from './layout.js'
import { validateOps, applyOps, regexOps, summarizeRooms } from './ops.js'
import { checkRules } from './rules.js'

const MIN_CONFIDENCE = 0.5

/** Calls the office interpreter. Throws when it cannot. */
export async function claudeInterpreter({ text, rooms, program, kit }) {
  const res = await api.interpret({
    text,
    rooms: summarizeRooms(rooms),
    program,
    kit: { id: kit.id, name: kit.name, kinds: Object.fromEntries(Object.entries(kit.rooms).map(([k, t]) => [k, { name: t.name, w: t.w, d: t.d, zone: t.zone }])), minSize: kit.rules?.minSize || {} },
  })
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
    diff = regexOps(text, rooms, kit)
    source = 'fallback'
  }
  if ((diff.confidence ?? 1) < MIN_CONFIDENCE || !diff.ops?.length) {
    return { applied: false, rooms, reply: diff.reply || 'I am not sure what to change. Can you say it another way?', source, ops: [] }
  }
  const v = validateOps(diff.ops, rooms, kit)
  if (!v.ok) return { applied: false, rooms, reply: `I could not apply that: ${v.errors[0]}.`, source, ops: diff.ops, reasons: v.errors }

  let next
  try {
    next = applyOps(diff.ops, rooms, kit, program.stories || 1)
  } catch (e) {
    return { applied: false, rooms, reply: 'That change did not work out on this plan. Try a smaller step.', source, ops: diff.ops, reasons: [String(e.message || e)] }
  }
  const rules = checkRules(next.rooms, program, style)
  if (!rules.ok) {
    return { applied: false, rooms, reply: `I can't do that one. ${rules.reasons[0]}${rules.reasons.length > 1 ? ` (${rules.reasons.length - 1} more issue${rules.reasons.length > 2 ? 's' : ''}.)` : ''}`, source, ops: diff.ops, reasons: rules.reasons }
  }
  return { applied: true, rooms: next.rooms, reply: diff.reply || next.did.join('. ') + '.', source, ops: diff.ops, did: next.did }
}
