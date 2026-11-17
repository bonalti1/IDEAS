// "Show me options": two or three valid ways to change the garage, the porches or the bedroom wing,
// side by side, each with what it does to the area and the price. Every option is applied to a copy
// of the plan and run through the rules and the architect's audit before it is offered; picking one
// is one ordinary change (one credit), the others cost nothing. Pure: the screen renders the result.
import { kitFor, floorArea, isRoom, lotOf, garageFacing } from './layout.js'
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
    const tandem = !!garage?.tandem || /tandem/i.test(garage?.name || '')
    const cars = garage ? (tandem ? 3 : Math.max(1, Math.round(Math.max(garage.w, garage.d) / perCar))) : 0
    const out = []
    if (garage) {
      // the way it loads: the doors face the street (front-load) or the side yard (side-load)
      const facing = garageFacing(garage, list) || 's'
      const front = facing === 's'
      out.push({ id: front ? 'garage-side' : 'garage-front', label: front ? `${cars}-car, side-load` : `${cars}-car, front-load`, ops: [{ op: 'garage', cars, load: front ? 'side' : 'front' }] })
      // the third car in a tandem bay: two bays wide, two cars deep
      if (!tandem) out.push({ id: 'garage-tandem', label: '3-car, third bay tandem', ops: [{ op: 'garage', cars: 3, tandem: true }] })
      if (cars < 3) out.push({ id: `garage-${cars + 1}`, label: `${cars + 1}-car garage`, ops: [{ op: 'garage', cars: cars + 1 }] })
      if (cars > 1) out.push({ id: `garage-${cars - 1}`, label: `${cars - 1}-car garage`, ops: [{ op: 'garage', cars: cars - 1 }] })
      out.push({ id: 'garage-none', label: 'No garage', ops: [{ op: 'remove', room: garage.id }] })
      return out
    }
    for (const n of [2, 1, 3]) out.push({ id: `garage-${n}`, label: `${n}-car garage`, ops: [{ op: 'add', kind: 'garage', w: perCar * n }] })
    return out
  }
  if (topic === 'porch') {
    const out = []
    if (!rear) {
      out.push({ id: 'rear-10', label: 'Rear porch, 10 ft deep', ops: [{ op: 'add', kind: 'rearPorch' }] })
    } else {
      // 10 ft (a table and chairs) or 12 ft (an outdoor kitchen), then none
      for (const depth of [10, 12, 8]) if (Math.abs(rear.d - depth) > 0.3) out.push({ id: `rear-${depth}`, label: `Rear porch ${depth} ft deep`, ops: [{ op: 'resize', room: rear.id, w: rear.w, d: depth }] })
      out.push({ id: 'rear-none', label: 'No rear porch', ops: [{ op: 'remove', room: rear.id }] })
    }
    if (front) out.push({ id: 'front-12', label: `Front porch ${front.d < 12 ? 'deeper, ' : ''}12 ft deep`, ops: [{ op: 'resize', room: front.id, w: front.w, d: 12 }] })
    else out.push({ id: 'front-10', label: 'Front porch, 10 ft deep', ops: [{ op: 'add', kind: 'frontPorch' }] })
    return out
  }
  // the bedroom wing
  const beds = list.filter((r) => ['bed', 'master', 'suite2'].includes(r.kind)).length
  const out = []
  // the next bedroom in line with the wing, or split across the hall from it
  if (beds < 6) out.push({ id: 'wing-bed', label: 'One more bedroom, in line', ops: [{ op: 'add', kind: 'bed', side: 'west' }] })
  if (beds < 6) out.push({ id: 'wing-bed-east', label: 'One more bedroom, across the hall', ops: [{ op: 'add', kind: 'bed', side: 'east' }] })
  out.push({ id: 'wing-bath', label: 'One more full bath, across the hall', ops: [{ op: 'add', kind: 'bath', side: 'east' }] })
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
    if (options.length >= 4) break
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
    // a variant that draws the same house as one already offered is not another option
    if (options.some((o) => sameShape(o.rooms, res.rooms))) continue
    const sf = floorArea(res.rooms, program.stories || 1)
    const cost = estimate({ rooms: res.rooms, program, style, lot }).mid
    options.push({ id: c.id, label: c.label, ops, rooms: res.rooms, sf: Math.round(sf - before.sf), cost: Math.round(cost - before.cost), did: res.did || [], warnings: audit.warnings.length, svg: thumbnail(res.rooms, program, style, lot) })
  }
  return { topic, options }
}

const sameShape = (a, b) => {
  const key = (list) => list.filter(isRoom).map((r) => `${r.kind}:${Math.round((r.local?.[0] ?? r.x ?? 0) * 4)}:${Math.round((r.local?.[1] ?? r.y ?? 0) * 4)}:${Math.round(r.w * 4)}:${Math.round(r.d * 4)}`).sort().join('|')
  return key(a) === key(b)
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
