// Round 12, item G: four requests a customer test found the chat missing, in both modes (the basic rules with no
// Claude key, and the Claude interpreter with its answer stubbed so nothing leaves the machine):
//   1. "I want 4 bedrooms" sets the bedroom count (it was read as a room command);
//   2. "Add a covered patio in the back" is a rear porch, and when it does not fit the fix is a button;
//   3. "Make the kitchen bigger" refused on a real lot says why in plain words and offers what does fit;
//   4. "Make it feel more open" says what the plan already has open and offers the changes that apply.
// A refusal or an offer uses no change; every button offered applies cleanly when tapped; no reply carries money
// words, the word "setback", validator text or a bracket.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { generateRooms, DEFAULT_PROGRAM, kitFor, programOf, isRoom, planIdOf } from '../src/draft/lib/layout.js'
import { interpretRequest, decide, lotWords } from '../src/draft/lib/interpret.js'
import { regexOps, validateOps, countAsk, wantsOpen, summarizeRooms, withPlanCoords, OPS } from '../src/draft/lib/ops.js'
import { checkRules } from '../src/draft/lib/rules.js'
import { fitsLot } from '../src/draft/lib/fit.js'
import { STYLES } from '../src/draft/lib/styles.js'
import { buildLot } from '../src/draft/lib/lot.js'
import { makeInterpreter, backstop, tidy, DIFF_SCHEMA, INTERPRET_SYSTEM } from '../server/interpreter.mjs'
import { makeProjects } from '../server/projects.mjs'
import { openStore } from '../server/store/index.mjs'

const style = STYLES.find((s) => s.id === 'farmhouse')
const kit = kitFor(style)
const offline = async () => {
  throw new Error('no api')
}

// ── the plans: the default program on a 100 x 150 lot, the same with three bedrooms, and two tight lots ──────
const ROOMY = buildLot({ kind: 'manual', width: 100, depth: 150, city: 'mcallen', frontStreet: 'E Nolana Ave', setbacks: {} })
const TIGHT = buildLot({ kind: 'manual', width: 60, depth: 110, city: 'mcallen', setbacks: {} })
const SMALL = buildLot({ kind: 'manual', width: 70, depth: 100, city: 'mcallen', setbacks: {} })
/** What the rooms step drafts for a program on a lot (the program itself, or what the fit offers in its place). */
function draft(program, lot) {
  const f = fitsLot(program, style, lot)
  const p = f.ok ? program : f.maxSqft ? { ...program, sqft: f.maxSqft } : f.suggestion?.program
  assert.ok(p, 'the lot takes a draft')
  const rooms = generateRooms(p, style, lot)
  assert.deepEqual(checkRules(rooms, p, style, lot).reasons, [], 'the first draft passes the rules')
  return { program: p, rooms, lot }
}
const roomy = draft(DEFAULT_PROGRAM, ROOMY) // 4 bedrooms, 3 baths, about 2,800 sf, garage-forward plan
const three = draft({ ...DEFAULT_PROGRAM, beds: 3, baths: 2 }, ROOMY)
const tight = draft(DEFAULT_PROGRAM, TIGHT) // the narrow-lot plan: living room at the front, dining room at the back
const small = draft(DEFAULT_PROGRAM, SMALL) // the compact plan, 3 bedrooms

// ── what a reply may never carry ─────────────────────────────────────────────────────────────────────────────
const MONEY = /\$|\b\d+k\b|\/sf\b|\bcredits?\b|\bbuy\b|\bpurchase\b|\bprices?\b|\bpricing\b|\brates?\b|\bcosts?\b|\bbilling\b|\bbill\b|\bpay(ment)?s?\b|\bfees?\b|\bdollars?\b|\bcharged?\b|\bfree\b/i
const JARGON = /setback|cannot grow that way|would cross|opens to the outside|egress|validator|undefined|null\b|NaN|\[object/i
function plain(reply, what) {
  assert.equal(typeof reply, 'string', what)
  assert.ok(reply.trim().length > 20, `${what}: a real sentence: "${reply}"`)
  assert.doesNotMatch(reply, MONEY, `${what}: no money words: "${reply}"`)
  assert.doesNotMatch(reply, JARGON, `${what}: plain words: "${reply}"`)
}
/** A refusal or an offer: plain, no bracket, and nothing applied. */
function held(r, what) {
  assert.equal(r.applied, false, `${what}: not applied: ${r.reply}`)
  plain(r.reply, what)
  assert.doesNotMatch(r.reply, /[()[\]]/, `${what}: no brackets: "${r.reply}"`)
}

const ask = (text, plan) => interpretRequest(text, plan.rooms, plan.program, style, { lot: plan.lot, interpreter: offline, report: false })
/** A tap on an offered button, the way the Draft screen sends it with no account: the button's ops, taken as given. */
const tap = (fix, plan) => interpretRequest(fix.label.replace(/\?$/, ''), plan.rooms, plan.program, style, { lot: plan.lot, interpreter: async () => ({ ops: fix.ops, reply: '', confidence: 1 }), report: false })
const beds = (rooms, program) => programOf(rooms, program).beds
const baths = (rooms, program) => programOf(rooms, program).baths
const sound = (rooms, plan, what) => assert.deepEqual(checkRules(rooms, plan.program, style, plan.lot).reasons, [], `${what}: the plan passes every rule`)
const room = (rooms, kind) => rooms.find((r) => isRoom(r) && r.kind === kind)
/** Every offered button: a label, ops the plan code knows, and it applies cleanly when tapped. */
async function tapAll(r, plan, what) {
  const out = []
  for (const f of r.fixes || []) {
    assert.ok(f.label && f.ops?.length, `${what}: a button has a label and ops`)
    assert.doesNotMatch(f.label, MONEY, `${what}: "${f.label}"`)
    assert.doesNotMatch(f.label, JARGON, `${what}: "${f.label}"`)
    assert.ok(f.ops.every((o) => OPS.includes(o.op)), `${what}: "${f.label}" uses only ops the plan code has: ${JSON.stringify(f.ops)}`)
    assert.deepEqual(validateOps(f.ops, plan.rooms, kit).errors, [], `${what}: "${f.label}"`)
    const d = await tap(f, plan)
    assert.equal(d.applied, true, `${what}: the button "${f.label}" applies: ${d.reply}`)
    sound(d.rooms, plan, `${what}: after "${f.label}"`)
    plain(d.reply, `${what}: the answer to "${f.label}"`)
    out.push(d)
  }
  return out
}

// ── 1. "I want 4 bedrooms" ───────────────────────────────────────────────────────────────────────────────────
test('1 (basic rules): "I want 4 bedrooms" and its close phrasings are a count, never a room command; other requests with a number in them are not', () => {
  const count = (text) => regexOps(text, roomy.rooms, kit, roomy.lot).ops
  assert.deepEqual(count('I want 4 bedrooms'), [{ op: 'count', kind: 'bed', count: 4 }])
  assert.deepEqual(count('make it 4 bedrooms'), [{ op: 'count', kind: 'bed', count: 4 }])
  assert.deepEqual(count('we need 5 bedrooms'), [{ op: 'count', kind: 'bed', count: 5 }])
  assert.deepEqual(count('3 bedrooms please'), [{ op: 'count', kind: 'bed', count: 3 }])
  assert.deepEqual(count('I want five bedrooms'), [{ op: 'count', kind: 'bed', count: 5 }])
  assert.deepEqual(count('make it a 3-bedroom house'), [{ op: 'count', kind: 'bed', count: 3 }])
  assert.deepEqual(count('I want 4 bathrooms'), [{ op: 'count', kind: 'bath', count: 4 }])
  assert.deepEqual(count('make it 2 baths'), [{ op: 'count', kind: 'bath', count: 2 }])
  assert.deepEqual(count('4 bed 3 bath'), [{ op: 'count', kind: 'bed', count: 4 }, { op: 'count', kind: 'bath', count: 3 }])
  for (const text of ['I want 4 bedrooms', 'make it 4 bedrooms', 'we need 5 bedrooms', '3 bedrooms please']) assert.doesNotMatch(regexOps(text, roomy.rooms, kit, roomy.lot).reply, /Tell me what to do with that room/, text)
  // not a count: two more, a room called by its number, the rooms as they are, a half bath, a size
  assert.deepEqual(count('add 2 bedrooms').map((o) => o.op), ['add', 'add'])
  assert.deepEqual(count('I want 2 more bedrooms').map((o) => o.op), ['add', 'add'])
  assert.deepEqual(count('make bedroom 2 bigger').map((o) => o.op), ['resize'])
  assert.deepEqual(countAsk('make the 3 bedrooms bigger'), [])
  assert.deepEqual(countAsk('3 bedrooms and 2.5 baths'), [])
  assert.deepEqual(countAsk('remove 2 bedrooms'), [])
  assert.deepEqual(countAsk('a 4 bedroom house at 2,400 sf'), [])
  assert.deepEqual(validateOps([{ op: 'count', kind: 'bed', count: 4 }], roomy.rooms, kit).errors, [])
  assert.deepEqual(validateOps([{ op: 'count', kind: 'garage', count: 4 }, { op: 'count', kind: 'bed', count: 0 }], roomy.rooms, kit).errors, ['Say how many bedrooms or bathrooms the house should have, like "4 bedrooms".', 'Say how many bedrooms or bathrooms the house should have, like "4 bedrooms".'])
})

test('1 (basic rules): on a 3-bedroom plan "I want 4 bedrooms" adds the bedroom; on a 4-bedroom plan it says so and uses nothing; fewer is a new draft; bathrooms the same', async () => {
  assert.equal(beds(three.rooms, three.program), 3)
  const up = await ask('I want 4 bedrooms', three)
  assert.equal(up.applied, true, up.reply)
  assert.equal(beds(up.rooms, three.program), 4)
  sound(up.rooms, three, 'I want 4 bedrooms')
  assert.match(up.reply, /^The house now has 4 bedrooms; it had 3\./)
  plain(up.reply, 'I want 4 bedrooms')
  assert.deepEqual(up.ops, [{ op: 'add', kind: 'bed' }], 'logged as what it did')

  assert.equal(beds(roomy.rooms, roomy.program), 4)
  const same = await ask('I want 4 bedrooms', roomy)
  held(same, 'already 4')
  assert.equal(same.reply, 'This plan already has 4 bedrooms. No change was used.')
  assert.equal(same.noop, true)

  for (const text of ['make it 5 bedrooms', 'we need 5 bedrooms']) {
    const five = await ask(text, roomy)
    assert.equal(five.applied, true, `${text}: ${five.reply}`)
    assert.equal(beds(five.rooms, roomy.program), 5, text)
    sound(five.rooms, roomy, text)
  }
  const down = await ask('3 bedrooms please', roomy)
  assert.equal(down.applied, true, down.reply)
  assert.equal(beds(down.rooms, down.program), 3)
  sound(down.rooms, { ...roomy, program: down.program }, '3 bedrooms please')
  assert.match(down.reply, /^Drew the house again with 3 bedrooms; it had 4\. It is [\d,]+ sf of living area on the /)
  assert.deepEqual(down.ops, [{ op: 'redraft', program: { beds: 3 } }])
  assert.equal(down.redrafted, true)

  const bath = await ask('I want 4 bathrooms', roomy)
  assert.equal(bath.applied, true, bath.reply)
  assert.equal(baths(bath.rooms, roomy.program), 4)
  sound(bath.rooms, roomy, 'I want 4 bathrooms')
  const fewer = await ask('make it 2 bathrooms', roomy)
  assert.equal(fewer.applied, true, fewer.reply)
  assert.equal(baths(fewer.rooms, fewer.program), 2)
})

test('1 (basic rules): a count the lot or the style cannot take is refused in plain words, uses nothing, and the button offered applies', async () => {
  const many = await ask('I want 5 bedrooms', tight)
  held(many, '5 bedrooms on the tight lot')
  assert.match(many.reply, /^5 bedrooms do not fit on this lot: the house would end up too close to the side of the lot, where the city keeps 5 ft open\. This plan has 4\./)
  await tapAll(many, tight, '5 bedrooms on the tight lot')

  const few = await ask('we need 2 bedrooms', roomy)
  held(few, '2 bedrooms')
  assert.equal(few.reply, 'Modern Farmhouse is drawn with 3 to 6 bedrooms, so 2 bedrooms is outside what I can draw. This plan has 4.')
  assert.deepEqual(few.fixes.map((f) => f.label), ['Draw the house again with 3 bedrooms'])
  const [done] = await tapAll(few, roomy, '2 bedrooms')
  assert.equal(beds(done.rooms, done.program), 3)

  // beside another part: each part is answered; the count is logged as what it did
  const both = await ask('I want 5 bedrooms and make the kitchen bigger', roomy)
  assert.equal(both.applied, true, both.reply)
  assert.equal(beds(both.rooms, roomy.program), 5)
  assert.ok(room(both.rooms, 'kitchen').w * room(both.rooms, 'kitchen').d > room(roomy.rooms, 'kitchen').w * room(roomy.rooms, 'kitchen').d)
  assert.ok(both.ops.some((o) => o.op === 'add' && o.kind === 'bed') && both.ops.every((o) => o.op !== 'count'))
  const none = await ask('4 bed 3 bath', roomy)
  held(none, '4 bed 3 bath')
  assert.equal(none.reply, 'This plan already has 4 bedrooms. This plan already has 3 bathrooms. No change was used.')
})

// ── 2. "Add a covered patio in the back" ─────────────────────────────────────────────────────────────────────
test('2 (basic rules): a patio is the rear porch: it is added on the 100 x 150 lot, with the size when one is given', async () => {
  for (const text of ['Add a covered patio in the back', 'add a patio', 'put in a covered patio out back']) assert.deepEqual(regexOps(text, roomy.rooms, kit, roomy.lot).ops, [{ op: 'add', kind: 'rearPorch', name: 'Covered Patio' }], text)
  const r = await ask('Add a covered patio in the back', roomy)
  assert.equal(r.applied, true, r.reply)
  assert.equal(r.reply, 'Adding a covered patio at the back of the house. On the plan it is labelled Rear Porch.')
  const porch = room(r.rooms, 'rearPorch')
  assert.ok(porch && porch.open && porch.w >= 8 && porch.d >= 8, 'a rear porch 8 ft deep or more')
  sound(r.rooms, roomy, 'covered patio')
  const sized = await ask('add a 12 by 14 covered patio', roomy)
  assert.equal(sized.applied, true, sized.reply)
  assert.equal(room(sized.rooms, 'rearPorch').w, 12)
  assert.equal(room(sized.rooms, 'rearPorch').d, 14)
  sound(sized.rooms, roomy, '12 by 14 patio')
})

test('2 (basic rules): where the living room is at the front (the compact plan) the patio goes behind the dining room instead of "no free wall"', async () => {
  assert.equal(planIdOf(small.rooms), 'compact')
  const r = await ask('Add a covered patio in the back', small)
  assert.equal(r.applied, true, r.reply)
  const { rooms: flat } = withPlanCoords(r.rooms, kit)
  const porch = room(flat, 'rearPorch')
  const dining = room(flat, 'dining')
  assert.ok(Math.abs(porch.y + porch.d - dining.y) < 0.6 && porch.x >= dining.x - 0.6 && porch.x + porch.w <= dining.x + dining.w + 0.6, 'the porch sits on the dining room\'s back wall')
  assert.ok(r.rooms.some((e) => e.kind === 'door' && e.exterior && e.room === dining.id), 'a door from the dining room')
  sound(r.rooms, small, 'patio on the compact plan')
})

test('2 (basic rules): on the tight lot the patio is refused for the real reason, uses nothing, and each button offered adds one', async () => {
  assert.equal(planIdOf(tight.rooms), 'narrow')
  const r = await ask('Add a covered patio in the back', tight)
  held(r, 'patio on the tight lot')
  assert.equal(r.reply, 'A covered patio at the back does not fit as asked: the house and porches would cover 51 percent of the lot, more than the 50 percent McAllen, TX allows. Here is what would work:')
  assert.doesNotMatch(r.reply, /free wall/)
  assert.ok(r.fixes.length >= 1, 'at least one button')
  assert.match(r.fixes[0].label, /^Add a smaller covered patio, \d+ ft by \d+ ft$/)
  const done = await tapAll(r, tight, 'patio on the tight lot')
  for (const d of done) assert.ok(room(d.rooms, 'rearPorch'), 'the button adds the patio')
})

test('2 (basic rules): with no wall free at all, the answer says so plainly and the button draws the house again with a patio', async () => {
  // the tight plan with a room drawn against the dining room's back wall (the living room's is taken already)
  const { rooms: flat } = withPlanCoords(tight.rooms, kit)
  const dining = room(flat, 'dining')
  const blocked = { ...tight, rooms: [...tight.rooms, { id: 'store-x', kind: 'wic', name: 'Storage', x: dining.x, y: dining.y - 6, w: dining.w, d: 6, zone: 'private', open: false, plumbing: false }] }
  const r = decide({ ops: [{ op: 'add', kind: 'rearPorch', name: 'Covered Patio' }], reply: '', confidence: 0.7 }, blocked.rooms, blocked.program, style, kit, 'fallback', blocked.lot)
  held(r, 'no free wall')
  assert.match(r.reply, /^A covered patio at the back does not fit as asked: there is no open stretch of wall at the back of the house for it on this plan, because other rooms sit behind the living room and the dining room\. Here is what would work:$/)
  assert.equal(r.fixes.length, 1)
  assert.match(r.fixes[0].label, /^(Draw the house again with|Draw a smaller house, about [\d,]+ sf, with) a covered patio at the back$/)
  const d = decide({ ops: r.fixes[0].ops, reply: '', confidence: 1 }, blocked.rooms, blocked.program, style, kit, 'fix', blocked.lot)
  assert.equal(d.applied, true, d.reply)
  assert.ok(room(d.rooms, 'rearPorch'))
  sound(d.rooms, { ...tight, program: d.program }, 'the new draft with a patio')
})

// ── 3. "Make the kitchen bigger" ─────────────────────────────────────────────────────────────────────────────
test('3 (basic rules): on the 100 x 150 lot the kitchen grows; on the tight lot the refusal says why and offers what fits', async () => {
  const ok = await ask('Make the kitchen bigger', roomy)
  assert.equal(ok.applied, true, ok.reply)
  sound(ok.rooms, roomy, 'kitchen bigger')

  const r = await ask('Make the kitchen bigger', tight)
  held(r, 'kitchen on the tight lot')
  assert.equal(r.reply, 'The kitchen cannot get that much bigger here: the primary bedroom would end up too close to the edge of the lot, inside the space the city keeps open along each edge. What does fit is 1 ft longer.')
  assert.deepEqual(r.fixes.map((f) => f.label), ['Make the kitchen 1 ft longer'])
  assert.ok(r.reasons.length >= 1, 'the raw reason stays for the drafter log')
  const [d] = await tapAll(r, tight, 'kitchen on the tight lot')
  const before = room(tight.rooms, 'kitchen')
  const after = room(d.rooms, 'kitchen')
  assert.equal(after.d, before.d + 1)
  assert.equal(after.w, before.w)
})

test('3 (basic rules): a size the rules refuse after it is drawn names the edge of the lot in plain words; a room with no step that fits says so', async () => {
  assert.equal(lotWords(['Kitchen would cross the setback at 5 ft from side.']), 'the kitchen would end up too close to the side of the lot, where the city keeps 5 ft open')
  assert.equal(lotWords(['Bedroom 4 would cross the setback at 10 ft from rear.']), 'Bedroom 4 would end up too close to the back of the lot, where the city keeps 10 ft open')
  assert.equal(lotWords(['Living would cross the setback at 20 ft from e nolana ave.']), 'the living room would end up too close to E Nolana Ave, where the city keeps 20 ft open')
  assert.equal(lotWords(['The house and porches cover 52% of the lot (3,404 of 6,600 sf); McAllen, TX allows 50%.']), 'the house and porches would cover 52 percent of the lot, more than the 50 percent McAllen, TX allows')
  assert.equal(lotWords(['Bath 1 has no door.']), null)
  const stuck = await ask('Make the kitchen bigger', small)
  held(stuck, 'kitchen on the compact plan')
  assert.equal(stuck.reply, 'The kitchen cannot get that much bigger here: the hallway next to it would be left too small. I tried smaller steps down to 1 ft and none fits where it sits. Tell me which room next to it could give up some space.')
  assert.deepEqual(stuck.fixes, [])
  // a shrink keeps its own words (a minimum is a minimum)
  const tiny = decide({ ops: [{ op: 'resize', room: 'kitchen', w: 6, d: 6 }], reply: '', confidence: 1 }, roomy.rooms, roomy.program, style, kit, 'claude', roomy.lot)
  assert.equal(tiny.applied, false)
  assert.match(tiny.reply, /minimum|too small/)
})

// ── 4. "Make it feel more open" ──────────────────────────────────────────────────────────────────────────────
test('4 (basic rules): "make it feel more open" changes nothing, says what is already open, and offers changes that apply', async () => {
  for (const text of ['Make it feel more open', 'open it up', 'I want an open concept', 'open the kitchen to the living room', 'remove the dining wall', 'take out the wall between the kitchen and the living room', 'taller ceilings please', 'it feels cramped']) {
    assert.equal(wantsOpen(text), true, text)
    const d = regexOps(text, roomy.rooms, kit, roomy.lot)
    assert.deepEqual(d.ops, [], `${text}: no room is removed or resized on a guess`)
    assert.equal(d.intent, 'open', text)
  }
  for (const text of ['make the kitchen bigger', 'add an office', 'remove the dining room', 'open the door', 'move the office next to the laundry', 'make the primary bedroom more spacious']) assert.equal(wantsOpen(text), false, text)

  const r = await ask('Make it feel more open', roomy)
  held(r, 'more open')
  assert.equal(r.reply, 'The kitchen, the dining room and the living room on this plan are already one open space, with no walls between them, and the ceilings there are 10 ft where the bedrooms have 9. Taking out other walls or raising a ceiling is not something I can draw from here; bring that up with the office. What I can do now is give that space more room. Pick one below; a change is used only when you pick.')
  assert.deepEqual(r.ops, [])
  assert.deepEqual(r.fixes.map((f) => f.label), ['Make the kitchen bigger', 'Make the dining room bigger', 'Make the living room bigger'])
  // what the reply says is what the kit draws: the three rooms open to each other, 10 ft where the bedrooms have 9
  assert.equal(kit.plates.byRoom.kitchen, 10)
  assert.equal(kit.plates.byRoom.living, 10)
  assert.equal(kit.plates.byRoom.dining, 10)
  assert.equal(kit.plates.default, 9)
  // only changes the plan code has are offered: no wall op, no ceiling op
  assert.ok(r.fixes.every((f) => f.ops.every((o) => o.op === 'resize')))
  const done = await tapAll(r, roomy, 'more open')
  for (const [i, kind] of ['kitchen', 'dining', 'living'].entries()) assert.ok(room(done[i].rooms, kind).w * room(done[i].rooms, kind).d > room(roomy.rooms, kind).w * room(roomy.rooms, kind).d, `${kind} got bigger`)

  const wall = await ask('remove the dining wall', roomy)
  held(wall, 'remove the dining wall')
  assert.equal(wall.reply, r.reply)
  assert.ok(room(wall.rooms, 'dining'), 'the dining room is still there')
})

test('4 (basic rules): on tight lots the offer holds only what fits there, and with nothing that fits it says so and offers nothing', async () => {
  const r = await ask('Make it feel more open', tight)
  held(r, 'more open on the tight lot')
  assert.match(r.reply, /^The kitchen, the dining room and the living room on this plan are already one open space/)
  assert.ok(r.fixes.length >= 1 && r.fixes.length <= 3)
  await tapAll(r, tight, 'more open on the tight lot')
  const none = await ask('Make it feel more open', small)
  held(none, 'more open on the compact plan')
  assert.deepEqual(none.fixes, [])
  assert.match(none.reply, /I also tried giving those rooms more space, and none of them can grow where it sits on this lot\.$/)
  // beside another request it is named, not guessed at
  const mixed = await ask('make it feel more open and add an office', roomy)
  assert.equal(mixed.applied, true, mixed.reply)
  assert.match(mixed.reply, /I didn't do: "make it feel more open": send that on its own and I will show what can be done\./)
})

// ── the office API: a refusal or an offer uses no change, a tap uses one ─────────────────────────────────────
const SENTENCES = ['I want 4 bedrooms', 'Add a covered patio in the back', 'Make the kitchen bigger', 'Make it feel more open']
async function office(interpreter) {
  const store = openStore({ databaseUrl: '', dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'dh-r12g-')) })
  const log = []
  const projects = makeProjects({ store, interpreter, event: async () => {}, logInterpret: (rec) => log.push(rec), lots: { lotOfProject: async (p) => buildLot(p.lot.spec) } })
  const user = { id: 'u-ana', email: 'ana@example.com', name: 'Ana Garza' }
  await store.users.put(user)
  const start = async (plan) => {
    const made = await projects.create(user, { style: { id: 'farmhouse', name: 'Modern Farmhouse' }, program: plan.program, rooms: plan.rooms, client: 'Ana Garza', lot: { address: 'test lot', spec: plan.lot.spec } })
    return made.id
  }
  const change = async (id, text, ops) => projects.change(await projects.load(user, id), text, ops)
  const used = async (id) => (await projects.load(user, id)).changesUsed
  return { start, change, used, log }
}
const noKey = { model: 'none', ask: async () => { throw Object.assign(new Error('interpreter not configured'), { status: 503, unconfigured: true }) } }

test('office API, no Claude key: the four sentences on the 100 x 150 lot and the tight lot; refusals and offers leave 10 of 10 changes, a tapped button uses one', async () => {
  const o = await office(noKey)
  // the 100 x 150 lot, a 3-bedroom plan: the count and the patio apply, the kitchen applies, "more open" offers
  const a = await o.start(three)
  const bedsUp = await o.change(a, 'I want 4 bedrooms')
  assert.equal(bedsUp.applied, true, bedsUp.reply)
  assert.equal(bedsUp.source, 'fallback')
  assert.equal(bedsUp.changesUsed, 1)
  assert.equal(beds(bedsUp.rooms, three.program), 4)
  const again = await o.change(a, 'I want 4 bedrooms')
  assert.equal(again.applied, false)
  assert.equal(again.reply, 'This plan already has 4 bedrooms. No change was used.')
  assert.equal(again.changesUsed, 1, 'already 4: nothing used')
  const patio = await o.change(a, 'Add a covered patio in the back')
  assert.equal(patio.applied, true, patio.reply)
  assert.equal(patio.changesUsed, 2)
  const open = await o.change(a, 'Make it feel more open')
  assert.equal(open.applied, false)
  assert.equal(open.changesUsed, 2, 'an offer uses nothing')
  assert.equal(open.changesLeft, 8)
  assert.ok(open.fixes.length >= 1)
  plain(open.reply, 'office: more open')
  const picked = await o.change(a, open.fixes[0].label, open.fixes[0].ops)
  assert.equal(picked.applied, true, picked.reply)
  assert.equal(picked.source, 'fix')
  assert.equal(picked.changesUsed, 3, 'the tap is the change')

  // the tight lot: the patio and the kitchen are refused with a button; nothing is used until one is tapped
  const b = await o.start(tight)
  for (const text of ['Add a covered patio in the back', 'Make the kitchen bigger', 'Make it feel more open', 'I want 5 bedrooms', 'I want 4 bedrooms']) {
    const r = await o.change(b, text)
    assert.equal(r.applied, false, `${text}: ${r.reply}`)
    plain(r.reply, `office, tight lot: ${text}`)
    assert.doesNotMatch(r.reply, /[()[\]]/, `${text}: "${r.reply}"`)
    assert.equal(r.changesUsed, 0, `${text}: no change used`)
    assert.equal(r.changesLeft, 10, text)
    assert.equal(await o.used(b), 0, text)
    assert.doesNotMatch(JSON.stringify(r.fixes), MONEY, text)
  }
  const kitchen = await o.change(b, 'Make the kitchen bigger')
  assert.deepEqual(kitchen.fixes.map((f) => f.label), ['Make the kitchen 1 ft longer'])
  const k1 = await o.change(b, kitchen.fixes[0].label, kitchen.fixes[0].ops)
  assert.equal(k1.applied, true, k1.reply)
  assert.equal(k1.changesUsed, 1)
  const porch = await o.change(b, 'Add a covered patio in the back')
  assert.equal(porch.applied, false)
  assert.ok(porch.fixes.length >= 1, porch.reply)
  const p1 = await o.change(b, porch.fixes[0].label, porch.fixes[0].ops)
  assert.equal(p1.applied, true, p1.reply)
  assert.ok(room(p1.rooms, 'rearPorch'))
  assert.equal(p1.changesUsed, 2)
  assert.equal(await o.used(b), 2)
})

// ── the Claude interpreter, its answer stubbed: the same four sentences through server/interpreter.mjs ──────
/** An interpreter whose model call is a stand-in: `answer(request, rooms)` is what Claude would send back. */
function claude(answer) {
  const calls = []
  const client = {
    messages: {
      parse: async (params) => {
        calls.push(params)
        const input = JSON.parse(params.messages[0].content)
        return { stop_reason: 'end_turn', usage: { input_tokens: 900, output_tokens: 60 }, parsed_output: answer(input.request, input.rooms, input) }
      },
    },
  }
  const interpreter = makeInterpreter({ env: {}, log: () => {}, client })
  return { interpreter, calls }
}
/** What the prompt asks Claude to send for each of the four sentences, in the shape the schema gives it (every field of an op written, null where nothing was given). */
function asPrompted(request, rooms) {
  const kitchen = rooms.find((r) => r.kind === 'kitchen')
  if (/4 bedrooms/i.test(request)) return { ops: [{ op: 'count', kind: 'bed', count: 4 }], reply: 'Set the house to four bedrooms.', confidence: 0.95, intent: 'none' }
  if (/patio/i.test(request)) return { ops: [{ op: 'add', kind: 'rearPorch', name: 'Covered Patio', w: null, d: null, near: null, side: null }], reply: 'Added a covered patio at the back of the house.', confidence: 0.95, intent: 'none' }
  if (/kitchen bigger/i.test(request)) return { ops: [{ op: 'resize', room: kitchen.id, w: Math.round(kitchen.w * 1.15 * 4) / 4, d: Math.round(kitchen.d * 1.15 * 4) / 4, soft: true }], reply: 'Made the kitchen about 15 percent bigger.', confidence: 0.9, intent: 'none' }
  if (/more open/i.test(request)) return { ops: [], reply: 'Here is what can make it feel more open.', confidence: 0.9, intent: 'open' }
  return { ops: [], reply: 'Could you say that another way?', confidence: 0.2, intent: 'none' }
}

test('Claude path: the prompt and the schema carry the four requests (count op, patio as rearPorch, soft resize, intent "open"), and the model is sent them as written', async () => {
  // one shape per op, and no optional field anywhere: the API refused the old single shape as "Schema is too
  // complex" once it had the two fields this round adds (16 optional), and a 14-optional variant took over two
  // minutes to compile on its first call
  const shapes = DIFF_SCHEMA.properties.ops.items.anyOf
  assert.deepEqual(shapes.map((s) => s.properties.op.enum[0]), ['resize', 'add', 'remove', 'move', 'moveBeside', 'garage', 'scale', 'swap', 'count'])
  for (const s of [...shapes, DIFF_SCHEMA]) {
    assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort(), 'every field is required')
    assert.equal(s.additionalProperties, false)
  }
  const shapeOf = (op) => shapes.find((s) => s.properties.op.enum[0] === op).properties
  assert.deepEqual(shapeOf('count').kind.enum, ['bed', 'bath'])
  assert.equal(shapeOf('count').count.type, 'number')
  assert.equal(shapeOf('resize').soft.type, 'boolean')
  assert.deepEqual(DIFF_SCHEMA.properties.intent.enum, ['open', 'none'])
  assert.doesNotMatch(JSON.stringify(DIFF_SCHEMA), /"minimum"|"maximum"|"minLength"|"maxLength"|"multipleOf"/, 'only keywords the API takes')
  // what the plan code gets: nulls and false flags dropped, intent kept only when it is "open"
  assert.deepEqual(tidy({ ops: [{ op: 'add', kind: 'rearPorch', name: 'Covered Patio', w: null, d: null, near: null, side: null }, { op: 'garage', cars: null, load: 'side', tandem: false }, { op: 'resize', room: 'kitchen', w: 16, d: 16, soft: false }], reply: 'Done.', confidence: 1.4, intent: 'none' }), { ops: [{ op: 'add', kind: 'rearPorch', name: 'Covered Patio' }, { op: 'garage', load: 'side' }, { op: 'resize', room: 'kitchen', w: 16, d: 16 }], reply: 'Done.', confidence: 1 })
  assert.equal(tidy({ ops: [], reply: 'x', confidence: 0.9, intent: 'open' }).intent, 'open')
  assert.match(INTERPRET_SYSTEM, /"I want 4 bedrooms".*one count op with kind "bed" or "bath"/)
  assert.match(INTERPRET_SYSTEM, /A patio, a covered patio, a lanai or a back porch is the kit's rearPorch: an add op with kind "rearPorch"/)
  assert.match(INTERPRET_SYSTEM, /"Bigger" or "smaller" with no size given: set soft true/)
  assert.match(INTERPRET_SYSTEM, /"Make it feel more open".*Return no ops, intent "open"/)
  assert.match(INTERPRET_SYSTEM, /Never use the word "setback" in it/)
  assert.match(INTERPRET_SYSTEM, /Never state or estimate any price/)
  const { interpreter, calls } = claude(asPrompted)
  assert.equal(interpreter.configured, true)
  const out = await interpreter.ask({ request: 'I want 4 bedrooms', program: three.program, kit: { id: kit.id, name: kit.name, kinds: {} }, rooms: summarizeRooms(three.rooms) })
  assert.deepEqual(out.ops, [{ op: 'count', kind: 'bed', count: 4 }])
  assert.equal(calls.length, 1)
  assert.equal(calls[0].system[0].text, INTERPRET_SYSTEM)
  assert.deepEqual(calls[0].output_config.format.schema, DIFF_SCHEMA, 'the schema is sent as written')
  assert.equal(calls[0].output_config.effort, 'low')
  assert.ok(JSON.parse(calls[0].messages[0].content).rooms.some((r) => r.kind === 'kitchen'), 'the rooms go with the request')
})

test('Claude path: the four sentences through the office API with Claude answering as prompted give the same outcomes as the basic rules', async () => {
  const { interpreter } = claude(asPrompted)
  const o = await office(interpreter)
  const a = await o.start(three)
  const bedsUp = await o.change(a, 'I want 4 bedrooms')
  assert.equal(bedsUp.source, 'claude')
  assert.equal(bedsUp.applied, true, bedsUp.reply)
  assert.equal(beds(bedsUp.rooms, three.program), 4)
  assert.match(bedsUp.reply, /^The house now has 4 bedrooms; it had 3\./)
  assert.equal(bedsUp.changesUsed, 1)
  const patio = await o.change(a, 'Add a covered patio in the back')
  assert.equal(patio.source, 'claude')
  assert.equal(patio.applied, true, patio.reply)
  assert.ok(room(patio.rooms, 'rearPorch'))
  const kitchen = await o.change(a, 'Make the kitchen bigger')
  assert.equal(kitchen.applied, true, kitchen.reply)
  assert.equal(kitchen.changesUsed, 3)
  const open = await o.change(a, 'Make it feel more open')
  assert.equal(open.source, 'claude')
  assert.equal(open.applied, false)
  assert.match(open.reply, /^The kitchen, the dining room and the living room on this plan are already one open space/)
  assert.ok(open.fixes.length >= 1)
  assert.equal(open.changesUsed, 3, 'the offer uses nothing')
  const picked = await o.change(a, open.fixes[0].label, open.fixes[0].ops)
  assert.equal(picked.applied, true, picked.reply)
  assert.equal(picked.changesUsed, 4)

  // the tight lot: Claude's ops are refused by the same code, with the same words and buttons as the basic rules
  const b = await o.start(tight)
  const basic = {}
  for (const text of SENTENCES) basic[text] = await ask(text, tight)
  for (const text of SENTENCES) {
    const r = await o.change(b, text)
    assert.equal(r.source, 'claude', text)
    assert.equal(r.applied, false, `${text}: ${r.reply}`)
    assert.equal(r.reply, basic[text].reply, `${text}: the same answer in both modes`)
    assert.deepEqual(r.fixes.map((f) => f.label), basic[text].fixes?.map((f) => f.label) || [], text)
    plain(r.reply, `claude, tight lot: ${text}`)
    assert.equal(r.changesUsed, 0, `${text}: no change used`)
  }
  const porch = await o.change(b, 'Add a covered patio in the back')
  const p1 = await o.change(b, porch.fixes[0].label, porch.fixes[0].ops)
  assert.equal(p1.applied, true, p1.reply)
  assert.equal(p1.changesUsed, 1)
})

test('Claude path: when the model comes back with nothing to do, a plain count and a wish for a more open house still get the right answer', async () => {
  const unsure = { ops: [], reply: 'Which room do you mean?', confidence: 0.3 }
  const raw = { ...unsure, intent: 'none' } // as the model sends it
  assert.deepEqual(backstop('I want 4 bedrooms', unsure).ops, [{ op: 'count', kind: 'bed', count: 4 }])
  assert.ok(backstop('I want 4 bedrooms', unsure).confidence >= 0.5)
  assert.equal(backstop('Make it feel more open', unsure).intent, 'open')
  assert.deepEqual(backstop('Make it feel more open', unsure).ops, [])
  assert.deepEqual(backstop('make it nicer', unsure), unsure, 'anything else is left as the model answered')
  assert.deepEqual(backstop('I want 4 bedrooms but where would the fourth one go, what do you suggest?', unsure), unsure, 'a question is left as a question')
  const real = { ops: [{ op: 'add', kind: 'bed' }], reply: 'Added a bedroom.', confidence: 0.9 }
  const rawAdd = { ops: [{ op: 'add', kind: 'bed', name: null, w: null, d: null, near: null, side: null }], reply: 'Added a bedroom.', confidence: 0.9, intent: 'none' }
  assert.deepEqual(backstop('I want 4 bedrooms', real), real, 'a diff with ops is left as the model wrote it')

  const { interpreter } = claude(() => raw)
  const o = await office(interpreter)
  const a = await o.start(three)
  const bedsUp = await o.change(a, 'I want 4 bedrooms')
  assert.equal(bedsUp.source, 'claude')
  assert.equal(bedsUp.applied, true, bedsUp.reply)
  assert.equal(beds(bedsUp.rooms, three.program), 4)
  const open = await o.change(a, 'Make it feel more open')
  assert.equal(open.applied, false)
  assert.match(open.reply, /already one open space/)
  assert.ok(open.fixes.length >= 1)
  assert.equal(open.changesUsed, 1)
  // Claude adding the bedroom itself, or taking one out, lands in the same place
  const adds = claude(() => rawAdd)
  const o2 = await office(adds.interpreter)
  const c = await o2.start(three)
  const added = await o2.change(c, 'I want 4 bedrooms')
  assert.equal(added.applied, true, added.reply)
  assert.equal(beds(added.rooms, three.program), 4)
  const bed = roomy.rooms.find((r) => isRoom(r) && r.kind === 'bed')
  const takes = claude(() => ({ ops: [{ op: 'remove', room: bed.id }], reply: 'Removed a bedroom.', confidence: 0.9, intent: 'none' }))
  const o3 = await office(takes.interpreter)
  const e = await o3.start(roomy)
  const out = await o3.change(e, 'make it 3 bedrooms')
  assert.equal(out.applied, false, 'a bedroom cannot come out in place')
  assert.deepEqual(out.fixes.map((f) => f.label), ['Draw the house again with 3 bedrooms'])
  const redo = await o3.change(e, out.fixes[0].label, out.fixes[0].ops)
  assert.equal(redo.applied, true, redo.reply)
  assert.equal(beds(redo.rooms, roomy.program), 3)
  assert.equal(redo.changesUsed, 1)
})

test('Claude path through interpretRequest (the no-account app): a stubbed Claude diff for each sentence is judged by the same code', async () => {
  const viaClaude = (text, plan) => interpretRequest(text, plan.rooms, plan.program, style, { lot: plan.lot, interpreter: async ({ text: t, rooms }) => tidy(asPrompted(t, summarizeRooms(rooms))), report: false })
  for (const text of SENTENCES) {
    const c = await viaClaude(text, tight)
    const b = await ask(text, tight)
    assert.equal(c.source, 'claude', text)
    assert.equal(c.applied, b.applied, text)
    assert.equal(c.reply, b.reply, text)
    assert.deepEqual((c.fixes || []).map((f) => f.label), (b.fixes || []).map((f) => f.label), text)
  }
})
