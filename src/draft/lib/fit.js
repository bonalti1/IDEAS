// Does a program fit a lot? The rooms step asks this before "Draft my house", so the first draft
// a client sees always passes the rules. When it does not fit, the largest living area that does.
import { starterDraft, isRoom, lotOf } from './layout.js'
import { checkRules } from './rules.js'
import { DEFAULT_LOT } from './lot.js'

/** Width and depth of the lot's setback envelope in the house frame, feet. */
export function envelopeSize(lot) {
  const L = lotOf(lot)
  const cos = Math.cos(L.angle)
  const sin = Math.sin(L.angle)
  const pts = (L.envelope || []).map(([X, Z]) => [(X - L.centre[0]) * cos + (Z - L.centre[1]) * sin, -(X - L.centre[0]) * sin + (Z - L.centre[1]) * cos])
  if (!pts.length) return [0, 0]
  const xs = pts.map((p) => p[0])
  const zs = pts.map((p) => p[1])
  return [Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)]
}
/** Width and depth of the enclosed house, feet. */
export function houseSize(rooms) {
  const solid = rooms.filter((r) => isRoom(r) && !r.open && r.local)
  if (!solid.length) return [0, 0]
  const xs = solid.flatMap((r) => [r.local[0] - r.w / 2, r.local[0] + r.w / 2])
  const zs = solid.flatMap((r) => [r.local[1] - r.d / 2, r.local[1] + r.d / 2])
  return [Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)]
}

// a draft fits when it passes the rules at (nearly) the size asked: a trim under 95% is a smaller house
const TRIM = 0.95
const passes = (program, style, lot) => {
  const draft = starterDraft(program, style, lot)
  const rules = checkRules(draft.rooms, program, style, lot)
  return { ...rules, ok: rules.ok && draft.fitScale >= TRIM - 1e-9, draft }
}

/**
 * @returns {{ ok: boolean, reasons: string[], draft: object, maxSqft: number|null }}
 *   draft is what starterDraft returned (minSqft, clamped, fitScale); maxSqft is the largest living
 *   area with these rooms that passes on this lot, or null when none does.
 */
export function fitsLot(program, style, lot = DEFAULT_LOT) {
  const rules = passes(program, style, lot)
  const draft = rules.draft
  if (rules.ok === false && !rules.reasons.length) rules.reasons.push(`This plan has to be trimmed to ${Math.round(draft.fitScale * 100)}% to fit the lot.`)
  let maxSqft = null
  if (!rules.ok) {
    let lo = Math.max(draft.minSqft || 0, 800)
    let hi = program.sqft
    if (lo < hi && passes({ ...program, sqft: lo }, style, lot).ok) {
      for (let i = 0; i < 8; i++) {
        const mid = Math.round((lo + hi) / 2 / 50) * 50
        if (mid <= lo || mid >= hi) break
        if (passes({ ...program, sqft: mid }, style, lot).ok) lo = mid
        else hi = mid
      }
      maxSqft = lo
    }
  }
  // nothing fits at any size: the first of a few smaller programs that does
  let suggestion = null
  if (!rules.ok && maxSqft == null) {
    const tries = [
      program.office && { label: 'without the office', program: { ...program, office: false } },
      program.suite2 && { label: 'without the second suite', program: { ...program, suite2: false } },
      program.garage > 1 && { label: `with a ${program.garage - 1}-car garage`, program: { ...program, garage: program.garage - 1 } },
      program.garage > 0 && { label: 'without the garage', program: { ...program, garage: 0 } },
      program.beds > 3 && { label: `with ${program.beds - 1} bedrooms`, program: { ...program, beds: program.beds - 1, baths: Math.min(program.baths, program.beds - 1) } },
      program.office && program.garage > 0 && { label: 'without the office or the garage', program: { ...program, office: false, garage: 0 } },
    ].filter(Boolean)
    for (const t of tries) {
      const f = fitsLot(t.program, style, lot)
      if (f.ok || f.maxSqft) {
        suggestion = { label: t.label, program: f.ok ? t.program : { ...t.program, sqft: f.maxSqft } }
        break
      }
    }
  }
  // when nothing helps: how wide this style's smallest plan is against the lot
  let need = null
  if (!rules.ok && maxSqft == null && !suggestion) {
    const least = { ...program, garage: 0, office: false, suite2: false, beds: Math.min(program.beds, 3), baths: Math.min(program.baths, 2), sqft: draft.minSqft || program.sqft }
    const [w, d] = houseSize(starterDraft(least, style, lot).rooms)
    const [ew, ed] = envelopeSize(lot)
    need = { houseWidth: Math.round(w), houseDepth: Math.round(d), lotWidth: Math.round(ew), lotDepth: Math.round(ed) }
  }
  return { ok: rules.ok, reasons: rules.reasons, draft, maxSqft, suggestion, need }
}
