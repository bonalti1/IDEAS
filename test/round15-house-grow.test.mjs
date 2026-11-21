// Fix round 15, U9 follow-up: on the Valley plan (Kerria's first draft) the chat could not grow the kitchen or deepen
// the front porch. Every wall move ran settleDoors, which keeps a door 3 in clear of its wall's ends: the half bath's
// pocket door sat 0.04 ft from the end, was slid 0.26 ft along, and stood in front of the lavatory. The audit then
// refused the change as "the rooms around it would no longer work as drawn" (or blamed the closet or the hall). The
// half bath's door now sits well in from the wall's ends and the lavatory is on the wall away from it.
//   1  "make the kitchen bigger" and "make the kitchen 1 ft deeper" apply on Kerria and the plan passes every rule
//   2  "make the front porch deeper" and "make the front porch 2 ft deeper" apply (the 20 ft front yard has the room)
//   3  any one wall of the kitchen or the porch moved a foot leaves no door in front of a fixture (the cause)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { interpretRequest } from '../src/draft/lib/interpret.js'
import { kitFor } from '../src/draft/lib/layout.js'
import { pushWall } from '../src/draft/lib/ops.js'
import { auditPlan } from '../src/draft/lib/audit.js'
import { checkRules } from '../src/draft/lib/rules.js'
import { plans, style } from './round15-lots.mjs'

const kit = kitFor(style)
const offline = async () => {
  throw new Error('no api')
}
const ask = (text, plan) => interpretRequest(text, plan.rooms, plan.program, style, { lot: plan.lot, interpreter: offline, report: false })
const room = (rooms, id) => rooms.find((r) => r.id === id)

test('grow 1: on Kerria (the Valley plan) the kitchen grows, by the chat\'s step or by a foot, and the plan passes every rule', async () => {
  const kerria = (await plans()).kerria
  assert.equal(kerria.rooms.find((r) => r.kind === 'roof')?.plan, 'valley')
  const k0 = room(kerria.rooms, 'kitchen')
  for (const text of ['make the kitchen bigger', 'make the kitchen 1 ft deeper']) {
    const r = await ask(text, kerria)
    assert.equal(r.applied, true, `"${text}": ${r.reply}`)
    const k1 = room(r.rooms, 'kitchen')
    assert.ok(k1.w * k1.d >= k0.w * k0.d + 18.9, `"${text}": ${k0.w} x ${k0.d} → ${k1.w} x ${k1.d}`)
    assert.deepEqual(checkRules(r.rooms, r.program || kerria.program, style, kerria.lot).reasons, [], text)
  }
})

test('grow 2: on Kerria the front porch gets deeper (the lot has the front yard for it), and the plan passes every rule', async () => {
  const kerria = (await plans()).kerria
  const p0 = room(kerria.rooms, 'frontPorch')
  for (const text of ['make the front porch deeper', 'make the front porch 2 ft deeper']) {
    const r = await ask(text, kerria)
    assert.equal(r.applied, true, `"${text}": ${r.reply}`)
    const p1 = room(r.rooms, 'frontPorch')
    assert.ok(p1.d > p0.d + 0.9, `"${text}": ${p0.d} → ${p1.d} ft deep`)
    assert.deepEqual(checkRules(r.rooms, r.program || kerria.program, style, kerria.lot).reasons, [], text)
  }
})

test('grow 3: moving the kitchen\'s or the porch\'s front or back wall a foot leaves every door clear of the fixtures (the half bath\'s door stays clear of its lavatory)', async () => {
  const kerria = (await plans()).kerria
  for (const [id, side] of [['kitchen', 'n'], ['kitchen', 's'], ['frontPorch', 'n'], ['frontPorch', 's']]) {
    const flat = kerria.rooms.map((r) => ({ ...r, ...(r.masses ? { masses: r.masses.map((m) => ({ ...m })) } : {}) }))
    assert.equal(pushWall(flat, id, side, 1, kit), true, `${id} ${side}`)
    const a = auditPlan(flat, kerria.program, kit, kerria.lot)
    assert.deepEqual(a.errors.filter((e) => /approach|swing/.test(e.id)).map((e) => e.message), [], `${id} ${side}`)
  }
})

// "add a porch on the back" on Kerria was refused ("no open stretch of wall at the back of the house … other rooms sit
// behind the living room and the dining room"): the Valley plan's kitchen has the back wall, with its French door. A
// rear porch now goes on the back wall of the family room on the yard, the kitchen included.
test('grow 4: on Kerria "add a porch on the back" goes on in place behind the kitchen, its French door onto it, inside the rear setback', async () => {
  const kerria = (await plans()).kerria
  for (const text of ['add a porch on the back', 'Add a covered patio in the back']) {
    const r = await ask(text, kerria)
    assert.equal(r.applied, true, `"${text}": ${r.reply}`)
    const porch = room(r.rooms, 'rearPorch')
    const kitchen = room(r.rooms, 'kitchen')
    assert.ok(porch && Math.abs(porch.y + porch.d - kitchen.y) < 0.3 && porch.d >= 8, `"${text}": the porch is on the kitchen's back wall`)
    assert.ok(porch.x < kitchen.x + kitchen.w && porch.x + porch.w > kitchen.x, 'behind the kitchen')
    const door = r.rooms.find((e) => e.kind === 'door' && e.exterior && e.room === 'kitchen')
    assert.ok(door && door.x + door.w / 2 > porch.x && door.x + door.w / 2 < porch.x + porch.w, 'the French door opens onto the porch')
    assert.deepEqual(checkRules(r.rooms, r.program || kerria.program, style, kerria.lot).reasons, [], text)
    // the living area is the same: a porch is not floor area
    assert.equal(Math.round(r.rooms.filter((x) => !x.element && !x.open && x.kind !== 'garage').reduce((a, x) => a + x.w * x.d, 0)), Math.round(kerria.rooms.filter((x) => !x.element && !x.open && x.kind !== 'garage').reduce((a, x) => a + x.w * x.d, 0)))
  }
})
