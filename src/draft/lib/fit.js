// Does a program fit a lot? The rooms step asks this before "Draft my house", so the first draft
// a client sees always passes the rules. When it does not fit, the largest living area that does.
import { starterDraft, isRoom, lotOf, kitFor, programWithin, planIdOf, planHolds, envelopeWidth, fromPlan, fitsEnvelope, normalizeProgram } from './layout.js'
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
const PROGRAM_KEYS = ['beds', 'baths', 'halfBath', 'suite2', 'office', 'garage', 'stories', 'sqft', 'frontPorch', 'rearPorch', 'wingSplit', 'tandem']
/** One line for a program's drafting fields, in a fixed order (what a draft depends on). */
export const programKey = (program) => PROGRAM_KEYS.map((k) => `${k}=${program?.[k] ?? ''}`).join('|')
/** One line for a lot: its spec and boundary (what a draft depends on), not the object identity. */
export const lotKey = (lot) => {
  const L = lotOf(lot)
  return JSON.stringify([L.spec || null, L.boundary || null, L.envelope || null, L.rules?.id || null, L.angle || 0])
}
// the drafts one fit check needs, drawn once each: the offers and the size searches ask for the same
// program at the same size again and again (the narrow 5/4 drew 300 drafts for one answer)
let memo = null
const draftOnce = (program, style, lot) => {
  if (!memo) return starterDraft(program, style, lot)
  const k = programKey(program) + '|' + (style?.id || '')
  let d = memo.get(k)
  if (!d) {
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0
    d = starterDraft(program, style, lot)
    if (typeof process !== 'undefined' && process.env?.FIT_DEBUG) console.error(`[fit] draft ${Math.round(performance.now() - t0)} ms ${k}`)
    memo.set(k, d)
  }
  return d
}
// fit answers by program and lot: the rooms step asks the same question on every tap
const RESULTS = new Map()
const RESULTS_MAX = 60
export const clearFitCache = () => RESULTS.clear()

const passes = (program, style, lot) => {
  const draft = draftOnce(program, style, lot)
  const rules = checkRules(draft.rooms, program, style, lot)
  // a garage asked for that found no spot a car can reach is a miss, not a quiet 0-car draft
  if (program.garage > 0 && !draft.rooms.some((r) => isRoom(r) && r.kind === 'garage')) {
    rules.ok = false
    rules.reasons = [...(rules.reasons || []), `A ${program.garage}-car garage has no spot on this lot that a car can be driven to (front-load does not fit the setbacks, and a side driveway has no room to turn).`]
  }
  // the lot's width capped the plan short of the area asked: that is a smaller house, not a fit
  if (draft.capped) {
    rules.ok = false
    rules.reasons = [...(rules.reasons || []), `The lot's width caps this plan at about ${draft.capped.toLocaleString()} sf.`]
  }
  return { ...rules, ok: rules.ok && draft.fitScale >= TRIM - 1e-9, draft }
}

/**
 * @returns {{ ok: boolean, reasons: string[], draft: object, maxSqft: number|null }}
 *   draft is what starterDraft returned (minSqft, clamped, fitScale); maxSqft is the largest living
 *   area with these rooms that passes on this lot, or null when none does.
 */
export function fitsLot(programIn, style, lot = DEFAULT_LOT, { depth = 0 } = {}) {
  const program = normalizeProgram(programIn)
  if (depth === 0) {
    const key = programKey(program) + '|' + (style?.id || '') + '|' + lotKey(lot)
    const hit = RESULTS.get(key)
    if (hit) return hit
    memo = new Map()
    try {
      const out = fitsLotNow(program, style, lot, { depth })
      if (RESULTS.size >= RESULTS_MAX) RESULTS.delete(RESULTS.keys().next().value)
      RESULTS.set(key, out)
      return out
    } finally {
      memo = null
    }
  }
  return fitsLotNow(program, style, lot, { depth })
}

/** Could any of the kit's plans that hold this program be as narrow as the lot? (The standard plan at 85% counts.) */
function anyPlanFits(kit, program, lot) {
  const envW = envelopeWidth(lot)
  if (!Number.isFinite(envW)) return true
  const standardMin = (kit.plan?.minWidth || (kit.plan?.footprint?.w || 72) * 0.85)
  if (standardMin <= envW + 0.01) return true
  return Object.values(kit.plans || {}).some((plan) => planHolds(plan, program) && (!plan.minWidth || plan.minWidth <= envW + 0.01))
}

function fitsLotNow(program, style, lot = DEFAULT_LOT, { depth = 0 } = {}) {
  const kitNow = kitFor(style)
  const hopeless = !anyPlanFits(kitNow, program, lot)
  const rules = passes(program, style, lot)
  const draft = rules.draft
  if (rules.ok === false && !rules.reasons.length) rules.reasons.push(`This plan has to be trimmed to ${Math.round(draft.fitScale * 100)}% to fit the lot.`)
  let maxSqft = null
  if (!rules.ok && !hopeless) {
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
    // a narrow lot wants the narrow plan first; a wide one keeps the rooms asked for and gives up the garage before the plan
    const narrowLot = envelopeSize(lot)[0] < 60
    const otherPlans = plansByFit.map((plan) => {
      const within = inRange(plan) ? programWithin(plan, program) : { ...programWithin(plan, program), sqft: Math.min(Math.max(program.sqft, plan.sqft[0]), plan.sqft[1]) }
      const same = JSON.stringify(within) === JSON.stringify(program)
      // the plan holds the very program asked for, only smaller: on a narrow lot that is the offer (the 4/2 at
      // 2,350 sf on the 50 ft lot comes back as the narrow plan's 4/2 at 2,200); elsewhere the fit search names the size
      if (same && !narrowLot) return null
      return { label: same ? `smaller, as the ${plan.id} plan draws it` : `as ${within.beds} bed, ${within.baths}${within.halfBath ? '.5' : ''} bath${within.garage ? `, ${within.garage}-car` : ', no garage'}${within.office ? '' : program.office ? ', no office' : ''} (what the ${plan.id} plan holds)`, program: within, plan: plan.id }
    })
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
      let offered
      if (!t.plan && !anyPlanFits(kit, t.program, lot)) continue
      if (t.plan) {
        // the offer drafts on the plan it names: above what the plan takes on this lot another plan is
        // drawn instead, so the size comes down the plan's range until this plan comes out and passes
        // (the 4/2 the narrow plan holds is offered at 2,200 sf on the 50 ft lot, not refused at 2,800).
        // A plan wider than the lot at its smallest is not tried; the size is found by bisection, a
        // draft a step, not 50 sf at a time (that was 40 drafts a plan and a 20 s rooms step)
        const plan = kit.plans[t.plan]
        if (plan.footprint && plan.minWidth && plan.minWidth > envelopeSize(lot)[0] + 0.01) continue
        const [floor, top] = plan.sqft || [0, Infinity]
        // the search draws the named plan alone (a full draft tries the standard plan and the variant first); the
        // size it lands on is then checked once the way the app will draw it
        const onPlan = (p) => {
          const d = fromPlan(p, kit, lot, t.plan)
          if (d.capped || d.fitScale < TRIM - 1e-9 || !fitsEnvelope(d.rooms, kit, lot)) return false
          if (p.garage > 0 && !d.rooms.some((r) => isRoom(r) && r.kind === 'garage')) return false
          return checkRules(d.rooms, p, style, lot).ok
        }
        const good = (p) => {
          const r = passes(p, style, lot)
          return r.ok && planIdOf(r.draft.rooms) === t.plan
        }
        const at = (sqft) => ({ ...t.program, sqft })
        let hi = Math.min(t.program.sqft, top)
        let found = onPlan(at(hi)) ? hi : null
        if (found === null && floor < hi) {
          let lo = floor
          if (!onPlan(at(lo))) continue
          found = lo
          for (let i = 0; i < 8 && hi - lo > 50; i++) {
            const mid = Math.round((lo + hi) / 2 / 50) * 50
            if (mid <= lo || mid >= hi) break
            if (onPlan(at(mid))) {
              lo = mid
              found = mid
            } else hi = mid
          }
        }
        if (found === null) continue
        // the app draws with starterDraft: the size must come out on this plan that way too (else step down once)
        if (!good(at(found))) {
          if (found - 50 >= floor && good(at(found - 50))) found -= 50
          else continue
        }
        offered = at(found)
      } else {
        // one level only: an offer is checked at its size, it does not go looking for offers of its own
        const f = fitsLot(t.program, style, lot, { depth: depth + 1 })
        if (!(f.ok || f.maxSqft)) continue
        offered = f.ok ? t.program : { ...t.program, sqft: f.maxSqft }
      }
      suggestion = { label: t.label, program: offered }
      break
    }
  }
  // when nothing helps: how wide this style's smallest plan is against the lot
  let need = null
  if (!rules.ok && maxSqft == null && !suggestion) {
    const least = { ...program, garage: 0, office: false, suite2: false, beds: Math.min(program.beds, 3), baths: Math.min(program.baths, 2), sqft: draft.minSqft || program.sqft }
    const [w, d] = houseSize(draftOnce(least, style, lot).rooms)
    const [ew, ed] = envelopeSize(lot)
    need = { houseWidth: Math.round(w), houseDepth: Math.round(d), lotWidth: Math.round(ew), lotDepth: Math.round(ed) }
  }
  return { ok: rules.ok, reasons: rules.reasons, draft, maxSqft, suggestion, need }
}
