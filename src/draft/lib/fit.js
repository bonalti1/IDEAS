// Does a program fit a lot? The rooms step asks this before "Draft my house", so the first draft
// a client sees always passes the rules. When it does not fit, the largest living area that does.
import { starterDraft, isRoom, lotOf, kitFor, programWithin, planIdOf } from './layout.js'
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
  // a garage asked for that found no spot a car can reach is a miss, not a quiet 0-car draft
  if (program.garage > 0 && !draft.rooms.some((r) => isRoom(r) && r.kind === 'garage')) {
    rules.ok = false
    rules.reasons = [...(rules.reasons || []), `A ${program.garage}-car garage has no spot on this lot that a car can be driven to (front-load does not fit the setbacks, and a side driveway has no room to turn).`]
  }
  return { ...rules, ok: rules.ok && draft.fitScale >= TRIM - 1e-9, draft }
}

/**
 * @returns {{ ok: boolean, reasons: string[], draft: object, maxSqft: number|null }}
 *   draft is what starterDraft returned (minSqft, clamped, fitScale); maxSqft is the largest living
 *   area with these rooms that passes on this lot, or null when none does.
 */
export function fitsLot(program, style, lot = DEFAULT_LOT, { depth = 0 } = {}) {
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
  if (!rules.ok && maxSqft == null && depth === 0) {
    const kit = kitFor(style)
    // what the kit's other plans (the narrow one) can hold on this lot
    // the plans drawn for this living area first; one drawn for another is offered at the edge of its range
    const inRange = (plan) => !plan.sqft || !program.sqft || (program.sqft >= plan.sqft[0] && program.sqft <= plan.sqft[1])
    const gap = (plan) => (!plan.sqft || !program.sqft ? 0 : program.sqft < plan.sqft[0] ? plan.sqft[0] - program.sqft : program.sqft > plan.sqft[1] ? program.sqft - plan.sqft[1] : 0)
    const plansByFit = Object.values(kit.plans || {}).sort((a, b) => inRange(b) - inRange(a) || gap(a) - gap(b))
    const otherPlans = plansByFit.map((plan) => {
      const within = inRange(plan) ? programWithin(plan, program) : { ...programWithin(plan, program), sqft: Math.min(Math.max(program.sqft, plan.sqft[0]), plan.sqft[1]) }
      const same = JSON.stringify(within) === JSON.stringify(program)
      return same ? null : { label: `as ${within.beds} bed, ${within.baths}${within.halfBath ? '.5' : ''} bath${within.garage ? `, ${within.garage}-car` : ', no garage'}${within.office ? '' : program.office ? ', no office' : ''} (what the ${plan.id} plan holds)`, program: within, plan: plan.id }
    })
    // a narrow lot wants the narrow plan first; a wide one keeps the rooms asked for and gives up the garage before the plan
    const narrowLot = envelopeSize(lot)[0] < 60
    const tries = [
      // one bay less first: it keeps every room the client asked for
      program.garage > 1 && { label: `with a ${program.garage - 1}-car garage`, program: { ...program, garage: program.garage - 1 } },
      ...(narrowLot ? otherPlans : []),
      program.office && { label: 'without the office', program: { ...program, office: false } },
      program.suite2 && { label: 'without the second suite', program: { ...program, suite2: false } },
      program.garage > 0 && { label: 'without the garage', program: { ...program, garage: 0 } },
      ...(narrowLot ? [] : otherPlans),
      program.beds > 3 && { label: `with ${program.beds - 1} bedrooms`, program: { ...program, beds: program.beds - 1, baths: Math.min(program.baths, program.beds - 1) } },
      program.office && program.garage > 0 && { label: 'without the office or the garage', program: { ...program, office: false, garage: 0 } },
    ].filter(Boolean)
    for (const t of tries) {
      // one level only: an offer is checked at its size, it does not go looking for offers of its own
      const f = fitsLot(t.program, style, lot, { depth: depth + 1 })
      if (!(f.ok || f.maxSqft)) continue
      let offered = f.ok ? t.program : { ...t.program, sqft: f.maxSqft }
      if (t.plan) {
        // the offer drafts on the plan it names: at the top of a plan's range the next plan is drawn
        // instead, so the size steps down the range until this plan comes out and passes
        const drawn = (p) => planIdOf(starterDraft(p, style, lot).rooms)
        const floor = kit.plans[t.plan].sqft?.[0] || 0
        let p = offered
        for (let i = 0; i < 12 && drawn(p) !== t.plan && p.sqft - 50 >= floor; i++) p = { ...p, sqft: p.sqft - 50 }
        if (drawn(p) !== t.plan || !passes(p, style, lot).ok) continue
        offered = p
      }
      suggestion = { label: t.label, program: offered }
      break
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
