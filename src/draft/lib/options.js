// "Show me options": two or three valid ways to change the garage, the porches or the bedroom wing,
// side by side, each with what it does to the area and the price. Every option is applied to a copy
// of the plan and run through the rules and the architect's audit before it is offered; picking one
// is one ordinary change (one credit), the others cost nothing. Pure: the screen renders the result.
import { kitFor, floorArea, isRoom, lotOf } from './layout.js'
import { decide } from './interpret.js'
import { auditPlan } from './audit.js'
import { estimate } from './pricing.js'
import { buildDesign } from './contract.js'
import { planSVG } from './plan-svg.js'

export const OPTION_TOPICS = ['garage', 'porch', 'wing']

/** Which topic a request names, or null: "show me options for the garage", "porch options", "what are my choices for the bedrooms". */
export function optionTopic(text) {
  const t = String(text || '').toLowerCase()
  if (!/\b(options?|choices|alternatives|possibilities|what (could|can) (i|we) do|show me)\b/.test(t)) return null
  if (/\bgarage|cars?\b/.test(t)) return 'garage'
  if (/\bporch|patio\b/.test(t)) return 'porch'
  if (/\bbed(room)?s?|wing|bath/.test(t)) return 'wing'
  return null
}

/** The candidate changes for a topic, as ops with a label. */
function candidates(topic, rooms, kit) {
  const list = rooms.filter(isRoom)
  const garage = list.find((r) => r.kind === 'garage')
  const perCar = kit.rooms.garage?.perCar || 11
  const rear = list.find((r) => r.kind === 'rearPorch')
  const front = list.find((r) => r.kind === 'frontPorch')
  if (topic === 'garage') {
    const cars = garage ? Math.max(1, Math.round(Math.max(garage.w, garage.d) / perCar)) : 0
    const out = []
    for (const n of [1, 2, 3]) if (n !== cars) out.push({ id: `garage-${n}`, label: `${n}-car garage`, ops: garage ? [{ op: 'garage', cars: n }] : [{ op: 'add', kind: 'garage', w: perCar * n }] })
    if (garage) out.push({ id: 'garage-none', label: 'No garage', ops: [{ op: 'remove', room: garage.id }] })
    return out
  }
  if (topic === 'porch') {
    const out = []
    if (!rear) {
      out.push({ id: 'rear-10', label: 'Rear porch, 10 ft deep', ops: [{ op: 'add', kind: 'rearPorch' }] })
    } else {
      out.push({ id: 'rear-none', label: 'No rear porch', ops: [{ op: 'remove', room: rear.id }] })
      out.push({ id: 'rear-12', label: `Rear porch ${rear.d < 12 ? 'deeper, ' : ''}12 ft deep`, ops: [{ op: 'resize', room: rear.id, w: rear.w, d: 12 }] })
      out.push({ id: 'rear-8', label: 'Rear porch 8 ft deep', ops: [{ op: 'resize', room: rear.id, w: rear.w, d: 8 }] })
    }
    if (front) out.push({ id: 'front-12', label: `Front porch ${front.d < 12 ? 'deeper, ' : ''}12 ft deep`, ops: [{ op: 'resize', room: front.id, w: front.w, d: 12 }] })
    else out.push({ id: 'front-10', label: 'Front porch, 10 ft deep', ops: [{ op: 'add', kind: 'frontPorch' }] })
    return out
  }
  // the bedroom wing
  const beds = list.filter((r) => ['bed', 'master', 'suite2'].includes(r.kind)).length
  const out = []
  if (beds < 6) out.push({ id: 'wing-bed', label: 'One more bedroom', ops: [{ op: 'add', kind: 'bed' }] })
  out.push({ id: 'wing-bath', label: 'One more full bath', ops: [{ op: 'add', kind: 'bath' }] })
  if (beds < 6) out.push({ id: 'wing-both', label: 'A bedroom and a bath', ops: [{ op: 'add', kind: 'bed' }, { op: 'add', kind: 'bath' }] })
  const smallest = list.filter((r) => r.kind === 'bed').sort((a, b) => a.w * a.d - b.w * b.d)[0]
  if (smallest) out.push({ id: 'wing-bigger', label: `${smallest.name} 2 ft deeper`, ops: [{ op: 'resize', room: smallest.id, w: smallest.w, d: smallest.d + 2 }] })
  return out
}

/**
 * The options for a topic on this plan: at most three that apply and pass the rules and the audit,
 * each with its rooms, its area and price change, and the ops that make it (so picking one is the
 * same change a fix button sends).
 * @returns {{ topic, options: { id, label, ops, rooms, sf, cost, did }[] }}
 */
export function optionsFor(topic, rooms, program, style, lot) {
  const kit = kitFor(style)
  const L = lotOf(lot)
  const before = { sf: floorArea(rooms, program.stories || 1), cost: estimate({ rooms, program, style, lot }).mid }
  const options = []
  for (const c of candidates(topic, rooms, kit)) {
    if (options.length >= 3) break
    // a resize right after an add names the room the add made: give the add that id first
    const ops = c.ops.map((o) => ({ ...o }))
    let res
    try {
      res = decide({ ops, reply: c.label, confidence: 1 }, rooms, program, style, kit, 'fix', L)
    } catch (e) {
      continue
    }
    if (!res.applied) continue
    const audit = auditPlan(res.rooms, program, kit, L)
    if (audit.errors.length) continue
    const sf = floorArea(res.rooms, program.stories || 1)
    const cost = estimate({ rooms: res.rooms, program, style, lot }).mid
    options.push({ id: c.id, label: c.label, ops, rooms: res.rooms, sf: Math.round(sf - before.sf), cost: Math.round(cost - before.cost), did: res.did || [], warnings: audit.warnings.length, svg: thumbnail(res.rooms, program, style, lot) })
  }
  return { topic, options }
}

/** A small plan drawing of an option, for the picker (no fixtures, no dimensions needed to compare). */
export function thumbnail(rooms, program, style, lot) {
  try {
    return planSVG(buildDesign({ rooms, program, style, lot, client: '' }), { showFixtures: false, title: ' ' }).svg
  } catch (e) {
    return ''
  }
}

/** What the picker says when a topic has fewer than two sound options on this lot. */
export const TOPIC_NAMES = { garage: 'the garage', porch: 'the porches', wing: 'the bedroom wing' }
