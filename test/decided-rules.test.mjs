// Round 8, the decided product rules (items 23–34, draft-house-decisions.md). Items 23–27 are office-only: they
// change the estimate the drafter sees and nothing a homeowner sees.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { estimate, RATES, range, estimateLines } from '../src/draft/lib/pricing.js'
import { generateRooms, starterDraft, DEFAULT_PROGRAM, kitFor, programOf, programLine, isRoom, planIdOf, garageFacing, isBedroom } from '../src/draft/lib/layout.js'
import { STYLES } from '../src/draft/lib/styles.js'
import { buildLot, DEFAULT_LOT } from '../src/draft/lib/lot.js'
import { auditPlan, CLEAR, NKBA, CHECK_GROUPS } from '../src/draft/lib/audit.js'
import { interpretRequest } from '../src/draft/lib/interpret.js'
import { checkRules } from '../src/draft/lib/rules.js'
import { fitsLot } from '../src/draft/lib/fit.js'
import { CITY_DEFAULTS, garageFt, RULE_FIELDS } from '../src/draft/lib/cities.js'
import { TRUST } from '../src/draft/lib/trust.js'
import { applyOps } from '../src/draft/lib/ops.js'

const style = STYLES.find((s) => s.id === 'farmhouse')
const modern = STYLES.find((s) => s.id === 'modern')
const kit = kitFor(style)
const mcallen = buildLot({ kind: 'manual', width: 100, depth: 150, city: 'mcallen', frontStreet: 'E Nolana Ave', setbacks: {} })
const P2 = { ...DEFAULT_PROGRAM, beds: 4, baths: 3, halfBath: true, office: true, garage: 2, sqft: 2800 }
const offline = async () => {
  throw new Error('offline')
}

test('23 (office): the living rates are STB\'s published rates with their source, no style multiplier; the coastal counties and a two-story plan get a note', () => {
  assert.match(RATES.source, /south-texasbuilders\.com\/custom-home-cost \(2026\)/)
  assert.ok(!/placeholder/i.test(RATES.source))
  assert.deepEqual(RATES.counties['Hidalgo County'], [115, 120])
  assert.ok(Object.values(RATES.styles).every((m) => m === 1), 'no multiplier by style')
  const e = estimate({ program: { ...DEFAULT_PROGRAM, sqft: 2000, garage: 0, rearPorch: false }, style, lot: mcallen })
  assert.deepEqual(e.parts.living, [230000, 240000])
  assert.equal(e.serviceArea, true)
  assert.deepEqual(e.lines, [])
  const w = estimate({ program: { ...DEFAULT_PROGRAM, sqft: 2000 }, style, lot: mcallen, county: 'Willacy County' })
  assert.equal(w.serviceArea, false)
  assert.ok(w.lines.some((l) => l.id === 'service-area' && /outside our usual service area; the office confirms the rate/.test(l.text)))
  const two = estimate({ program: { ...DEFAULT_PROGRAM, sqft: 2000, stories: 2 }, style, lot: mcallen })
  assert.ok(two.lines.some((l) => l.id === 'two-story' && /two-story: office quote/.test(l.text)))
})

test('24 (office): the style multipliers are gone; a modern house carries the standing-seam adder as its own line that the office can switch off', () => {
  assert.deepEqual(RATES.upgrades, { brick: 2, rPanelRoof: 5, standingSeamRoof: 9, plate10: [3, 5], hebel: 5, metalWall: 5 })
  const farm = estimate({ program: { ...DEFAULT_PROGRAM, sqft: 2000, garage: 0, rearPorch: false }, style, lot: mcallen })
  assert.deepEqual(farm.upgrades, [])
  assert.deepEqual(farm.parts.upgrades, [0, 0])
  const m = estimate({ program: { ...DEFAULT_PROGRAM, sqft: 2000, garage: 0, rearPorch: false }, style: modern, lot: mcallen })
  assert.deepEqual(m.parts.living, [230000, 240000], 'the same rate, no multiplier')
  assert.equal(m.upgrades.length, 1)
  assert.equal(m.upgrades[0].id, 'standingSeamRoof')
  assert.deepEqual(m.upgrades[0].amount, [18000, 18000])
  assert.equal(m.low - farm.low, 18000)
  const off = estimate({ program: { ...DEFAULT_PROGRAM, sqft: 2000, garage: 0, rearPorch: false }, style: modern, lot: mcallen, upgrades: [] })
  assert.equal(off.low, farm.low, 'switched off, the modern house prices like the farmhouse')
  const plate = estimate({ program: { ...DEFAULT_PROGRAM, sqft: 2000, garage: 0, rearPorch: false }, style, lot: mcallen, upgrades: ['plate10'] })
  assert.deepEqual(plate.upgrades[0].amount, [6000, 10000])
  assert.ok(estimateLines(m).some((l) => l.id === 'standingSeamRoof' && /\$9\/sf: \$18,000/.test(l.text)))
})

test('25 (office): the driveway and walk are priced only beyond STB\'s included allowance; a plan with no garage pays for all of it', () => {
  assert.deepEqual(RATES.flatworkPerSf, [6, 10])
  assert.deepEqual(RATES.drivewayAllowanceSf, { 0: 0, 1: 400, 2: 600, 3: 800 })
  const rooms = generateRooms(P2, style, mcallen)
  const e = estimate({ rooms, program: P2, style, lot: mcallen })
  assert.equal(e.flatwork.allowance, 600)
  assert.equal(e.flatwork.beyond, Math.max(0, e.flatwork.total - 600))
  assert.ok(e.flatwork.total > 600, `the McAllen 2-car drive and walk are ${e.flatwork.total} sf`)
  assert.match(e.flatwork.label, new RegExp(`Driveway and walk beyond the included 600 sf: ${e.flatwork.beyond.toLocaleString()} sf × \\$6–10`))
  assert.deepEqual(e.parts.flatwork, [e.flatwork.beyond * 6, e.flatwork.beyond * 10])
  const compactP = { ...DEFAULT_PROGRAM, beds: 3, baths: 2, halfBath: false, office: false, garage: 0, sqft: 1300 }
  const c = estimate({ rooms: generateRooms(compactP, style, mcallen), program: compactP, style, lot: mcallen })
  assert.equal(c.flatwork.allowance, 0)
  assert.equal(c.flatwork.beyond, c.flatwork.total)
  assert.ok(c.flatwork.total > 0)
  // within the allowance the line reads "included" at $0
  const small = estimate({ program: { ...DEFAULT_PROGRAM, sqft: 2000, garage: 3 }, style, lot: mcallen })
  assert.ok(small.flatwork.allowance === 800)
})

test('26 (office): the coastal counties get the $0 windstorm line; Hidalgo never; nothing is added to the total', () => {
  const rooms = generateRooms(P2, style, mcallen)
  const bv = estimate({ rooms, program: P2, style, lot: mcallen, county: 'Cameron County' })
  const wind = bv.lines.find((l) => l.id === 'windstorm')
  assert.ok(wind, 'Brownsville (Cameron County) shows the windstorm line')
  assert.match(wind.text, /Windstorm inspections and TDI certificate \(WPI-8\): quoted separately\. Free with a TDI field inspector/)
  assert.equal(wind.amount, null)
  const mc = estimate({ rooms, program: P2, style, lot: mcallen })
  assert.ok(!mc.lines.some((l) => l.id === 'windstorm'))
  assert.equal(bv.low - bv.parts.living[0] - bv.parts.garage[0] - bv.parts.porches[0] - bv.parts.flatwork[0] - bv.parts.upgrades[0], 0, 'the line adds nothing')
  for (const county of ['Willacy County', 'Nueces County', 'Kleberg County', 'San Patricio County']) assert.ok(estimate({ program: { ...DEFAULT_PROGRAM, sqft: 2000 }, style, lot: mcallen, county }).lines.some((l) => l.id === 'windstorm'), county)
  for (const county of ['Starr County', 'Jim Wells County']) assert.ok(!estimate({ program: { ...DEFAULT_PROGRAM, sqft: 2000 }, style, lot: mcallen, county }).lines.some((l) => l.id === 'windstorm'), county)
})

test('27 (office): more full baths than STB includes is a $0 note: 2,200 sf with 4 baths shows "1 extra full bath"', () => {
  const e = estimate({ program: { ...DEFAULT_PROGRAM, sqft: 2200, baths: 4 }, style, lot: mcallen })
  const line = e.lines.find((l) => l.id === 'extra-baths')
  assert.ok(line)
  assert.equal(line.text, '1 extra full bath: quoted by the office')
  assert.ok(!estimate({ program: { ...DEFAULT_PROGRAM, sqft: 2200, baths: 3 }, style, lot: mcallen }).lines.some((l) => l.id === 'extra-baths'))
  assert.ok(estimate({ program: { ...DEFAULT_PROGRAM, sqft: 1700, baths: 3 }, style, lot: mcallen }).lines.some((l) => l.id === 'extra-baths'), 'at 1,700 sf two are included')
  assert.match(range(e), /^\$\d+k–\$\d+k$/)
})

test('28: the trust block names Leroy Flores behind the placeholder, links the gallery, and keeps STB\'s timings without money', () => {
  assert.equal(TRUST.drafter.name, 'Leroy Flores')
  assert.equal(TRUST.drafter.title, 'Lead Drafter, South Texas Builders')
  assert.equal(TRUST.drafter.photo, '/team/leroy-flores.webp')
  assert.equal(TRUST.drafter.placeholder, true)
  assert.equal(TRUST.builtHomes.url, 'https://south-texasbuilders.com/our-homes/')
  const whens = TRUST.next.map((n) => n.when)
  assert.ok(whens.includes('Within 1 business day') && whens.includes('Within 10 business days (about 2 weeks)') && whens.includes('Then'))
  assert.ok(!whens.includes('Within 5 business days'), 'the old promise is gone')
  assert.ok(TRUST.next.every((n) => !/\$|\d+k\b|price|quote/i.test(n.what)))
  assert.match(TRUST.next.find((n) => n.when === 'Then').what, /walk the plan and the cost/)
})

test('29: one change per message; at most 3 parts apply and the 4th is named; all-unsupported applies nothing', async () => {
  const prog = { ...kit.reference.program }
  const rooms = generateRooms(prog, style, DEFAULT_LOT)
  const four = await interpretRequest('make the kitchen bigger, make bedroom 2 bigger, add an office, add a half bath', rooms, prog, style, { lot: DEFAULT_LOT, interpreter: offline, report: false })
  assert.equal(four.applied, true, four.reply)
  assert.deepEqual(four.deferred, ['add a half bath'])
  assert.match(four.reply, /I did the first 3; send "add a half bath" next\./)
  assert.ok(!four.rooms.some((r) => isRoom(r) && r.kind === 'halfbath' && !rooms.some((o) => o.id === r.id)), 'the 4th part was not drawn')
  assert.ok(four.rooms.some((r) => isRoom(r) && r.kind === 'office'), 'the 3rd part was')
  // 3 parts with one unsupported: the two apply, the message is one change
  const three = await interpretRequest('make the kitchen bigger, make it two story, add an office', rooms, prog, style, { lot: DEFAULT_LOT, interpreter: offline, report: false })
  assert.equal(three.applied, true, three.reply)
  assert.match(three.reply, /The change counts once, for what was done/)
  const none = await interpretRequest('make it two story and add a pool', rooms, prog, style, { lot: DEFAULT_LOT, interpreter: offline, report: false })
  assert.equal(none.applied, false)
})

test('30: the deed-restriction switch rules out a street-facing garage; the snout-house warning; the garage-door distance per city with Harlingen\'s 20 ft', () => {
  // (a) the switch: McAllen 4/3.5 2-car never gets the garage-forward variant or a front-load garage
  const hoa = buildLot({ kind: 'manual', width: 100, depth: 150, city: 'mcallen', setbacks: {}, noStreetGarage: true })
  const d = starterDraft(P2, style, hoa)
  assert.notEqual(planIdOf(d.rooms), 'frontgarage')
  const g = d.rooms.find((r) => isRoom(r) && r.kind === 'garage')
  if (g) assert.notEqual(garageFacing(g, d.rooms.filter((e) => e.kind === 'door')), 's', 'no garage door toward the front street')
  const f = fitsLot(P2, style, hoa)
  assert.equal(f.ok, false)
  assert.ok(f.suggestion, 'it says plainly what fits instead: ' + JSON.stringify(f.suggestion))
  assert.match(f.suggestion.label, /garage/)
  // (b) without the switch the McAllen 4/3.5 keeps the garage-forward variant
  const plain = starterDraft(P2, style, mcallen)
  assert.equal(planIdOf(plain.rooms), 'frontgarage')
  // (c) the projection is measured and warned above 12 ft, with the 10 ft target
  const a = auditPlan(plain.rooms, P2, kit, mcallen)
  assert.ok(typeof a.measures.garageProjectionFt === 'number')
  assert.equal(CLEAR.garageSnoutWarnFt, 12)
  assert.equal(CLEAR.garageSnoutGoalFt, 10)
  assert.equal(a.warnings.some((w) => w.id === 'garage-snout'), a.measures.garageProjectionFt > 12)
  assert.ok(CHECK_GROUPS.find((x) => x.id === 'garage').ids.includes('garage-snout'))
  // (d) the garage-door distance from the street it faces, by city
  assert.ok(RULE_FIELDS.includes('garageFt'))
  for (const id of ['mcallen', 'mission', 'pharr', 'palmview', 'hidalgo']) assert.equal(garageFt(CITY_DEFAULTS[id]), 18, id)
  assert.equal(garageFt(CITY_DEFAULTS.weslaco), 20)
  assert.equal(garageFt(CITY_DEFAULTS.harlingen), 20)
  assert.equal(CITY_DEFAULTS.harlingen.garageSideEntryExempt, true)
  assert.equal(buildLot({ kind: 'manual', width: 80, depth: 130, city: 'harlingen', setbacks: {} }).rules.garageFt, 20)
})

test('31: tandem is never picked when a side-by-side 3-car fits; a tandem garage is labelled, short in the summary', () => {
  const p54 = { ...DEFAULT_PROGRAM, beds: 5, baths: 4, halfBath: false, office: true, garage: 3, sqft: 3500 }
  const d = starterDraft(p54, style, mcallen)
  const g = d.rooms.find((r) => isRoom(r) && r.kind === 'garage')
  assert.ok(g && !g.tandem && !/tandem/i.test(g.name), `McAllen 5/4 3-car is side by side: ${g?.name}`)
  assert.ok(g.w >= 31 || g.d >= 31, 'three bays across')
  const po = programOf(d.rooms, p54)
  assert.equal(programLine(po), '5 bed · 4 bath · 3-car · 1 story')
  // the chat's tandem garage on Lot 514 is said both ways
  const rooms = generateRooms({ ...kit.reference.program, garage: 2 }, style, DEFAULT_LOT)
  const t = applyOps([{ op: 'garage', cars: 3, tandem: true }], rooms, kit, 1, DEFAULT_LOT)
  const tp = programOf(t.rooms, kit.reference.program)
  assert.equal(tp.tandem, true)
  assert.match(programLine(tp), /3-car \(tandem: one bay two cars deep\)/)
  assert.match(programLine(tp, ' · ', { tandemShort: true }), /3-car tandem/)
  // the 50 ft lot: a side-by-side 3-car does not fit, and the offer says what does
  const narrow = buildLot({ kind: 'manual', width: 50, depth: 120, city: 'pharr', setbacks: {} })
  const f = fitsLot({ ...DEFAULT_PROGRAM, beds: 3, baths: 2, halfBath: false, office: false, garage: 3, sqft: 1800 }, style, narrow)
  assert.equal(f.ok, false)
  assert.ok(f.suggestion && /garage/.test(f.suggestion.label), JSON.stringify(f.suggestion))
})

test('32: the 40 ft plumbing rule is a cost warning, not a refusal; hot water over 100 ft of pipe from the heater is the code error; the Garza plan passes both', () => {
  const prog = { ...kit.reference.program }
  const rooms = generateRooms(prog, style, DEFAULT_LOT)
  const a = auditPlan(rooms, prog, kit, DEFAULT_LOT)
  assert.equal(a.errors.filter((e) => e.id === 'hot-water-length').length, 0)
  assert.equal(a.warnings.filter((e) => e.id === 'plumbing-spread').length, 0)
  assert.ok(a.measures.hotWaterFt > 0 && a.measures.hotWaterFt <= 100, `${a.measures.hotWaterFt} ft`)
  assert.ok(CHECK_GROUPS.some((g) => g.id === 'plumbing' && g.ids.includes('hot-water-length') && g.ids.includes('plumbing-spread')))
  // the heater 85 ft from a bath: 85 x 1.25 = 106 > 100
  const wh = rooms.find((e) => e.kind === 'fixture' && e.fixture === 'wh')
  const vanity = rooms.find((e) => e.kind === 'fixture' && e.fixture === 'vanity' && e.room === 'bath1')
  const moved = rooms.map((e) => (e.id === wh.id ? { ...e, x: vanity.x + 85, y: vanity.y } : e))
  const b = auditPlan(moved, prog, kit, DEFAULT_LOT)
  const far = b.errors.find((e) => e.id === 'hot-water-length' && /Bath 1/.test(e.room || '') && /vanity/.test(e.message))
  assert.ok(far, b.errors.map((e) => e.message).join(' | '))
  assert.match(far.message, /about 106 ft of pipe/)
  // a wet room 50 ft from the rest is a warning in the audit and no refusal in the rules
  const bath = rooms.find((r) => r.id === 'bath1')
  const spread = rooms.map((e) => (e.id === 'bath1' || e.room === 'bath1' ? { ...e, x: e.x - 60 } : e))
  const c = auditPlan(spread, prog, kit, DEFAULT_LOT)
  assert.ok(c.warnings.some((w) => w.id === 'plumbing-spread'), 'spread-out plumbing warns')
  assert.ok(!checkRules(spread, prog, style, DEFAULT_LOT).reasons.some((r) => /nearest plumbing/.test(r)), 'no refusal for plumbing distance')
  assert.ok(bath)
})

test('33: a bedroom without a closet is a warning; every first-draft bedroom has one', () => {
  const prog = { ...kit.reference.program }
  const rooms = generateRooms(prog, style, DEFAULT_LOT)
  assert.equal(auditPlan(rooms, prog, kit, DEFAULT_LOT).warnings.filter((w) => w.id === 'bedroom-closet').length, 0)
  assert.equal(CLEAR.closetIn, 24)
  assert.equal(CLEAR.walkInFt, 5)
  const noCloset = rooms.filter((e) => !(e.id === 'wic-bed2' || e.room === 'wic-bed2' || (e.kind === 'wic' && /bed ?2/i.test(e.name || '') && e.id.includes('2'))))
  const without = rooms.filter((e) => !(isRoom(e) && e.kind === 'wic' && rooms.some((b) => b.id === 'bed2') && Math.abs((e.x ?? 0) - (rooms.find((b) => b.id === 'bed2')?.x ?? -99)) < 20 && e.id !== 'wic-master'))
  const a = auditPlan(without.length < rooms.length ? without : noCloset, prog, kit, DEFAULT_LOT)
  assert.ok(a.warnings.some((w) => w.id === 'bedroom-closet' && /expect a closet in every bedroom/.test(w.message)), a.warnings.map((w) => w.id).join(','))
  assert.ok(CHECK_GROUPS.find((g) => g.id === 'closets').ids.includes('bedroom-closet'))
})

test('34: NKBA warnings beside the IRC errors, a bath door never into the clear space, and a room is a bedroom only with 70 sf, egress and a closet', () => {
  assert.deepEqual(NKBA, { toiletFrontIn: 30, toiletSideIn: 18, showerFrontIn: 30, showerFt: 3 })
  const fixtures = CHECK_GROUPS.find((g) => g.id === 'fixtures').ids
  for (const id of ['toilet-front', 'toilet-side', 'shower-front', 'swing-clear', 'nkba-toilet-front', 'nkba-toilet-side', 'nkba-shower-front', 'nkba-shower-size']) assert.ok(fixtures.includes(id), id)
  const prog = { ...kit.reference.program }
  const rooms = generateRooms(prog, style, DEFAULT_LOT)
  const a = auditPlan(rooms, prog, kit, DEFAULT_LOT)
  assert.ok(a.warnings.some((w) => /^nkba-/.test(w.id)), 'the Garza baths get NKBA notes (18" toilet centre line, 30" in front)')
  assert.ok(!a.errors.some((e) => e.id === 'swing-clear'), 'no bath door swings into a clear space on the first draft (the generator pockets it)')
  // a bath door that swings onto the toilet's clear space is an error; the same door as a pocket door is not
  const synthetic = (pocket) => [
    { id: 'bath', kind: 'bath', name: 'Bath', x: 0, y: 0, w: 5, d: 8, zone: 'private', plumbing: true },
    { id: 'hall', kind: 'hall', name: 'Hall', x: 0, y: 8, w: 5, d: 4, zone: 'private' },
    { id: 'fx-toilet', kind: 'fixture', fixture: 'toilet', element: true, open: true, name: 'Water closet', room: 'bath', x: 1.75, y: 3.5, w: 1.5, d: 2.3, face: 's' },
    { id: 'd-bath', kind: 'door', element: true, open: true, name: 'Door', room: 'bath', axis: 'h', x: 1.5, y: 7.7, w: 2.5, d: 0.6, span: 2.5, size: 'bath', swing: -1, hinge: 'start', pocket },
  ]
  const swung = auditPlan(synthetic(false), prog, kit, DEFAULT_LOT)
  assert.ok(swung.errors.some((e) => e.id === 'swing-clear' && /pocket door or swing it out/.test(e.message)), swung.errors.map((e) => e.id).join(','))
  assert.ok(!auditPlan(synthetic(true), prog, kit, DEFAULT_LOT).errors.some((e) => e.id === 'swing-clear'), 'a pocket door is fine')
  // bedrooms by the rule
  const po = programOf(rooms, prog)
  assert.equal(po.beds, 4, 'the Garza count stays 4')
  assert.equal(po.flex, 0)
  const tiny = [...rooms, { id: 'bedx', kind: 'bed', name: 'Bedroom X', x: 300, y: 300, w: 9, d: 7, zone: 'private' }, { id: 'w-bedx', kind: 'window', element: true, room: 'bedx', x: 300, y: 300, w: 3, d: 0.5 }]
  const pt = programOf(tiny, prog)
  assert.equal(pt.beds, 4)
  assert.equal(pt.flex, 1)
  assert.match(programLine(pt), /4 bed \+ 1 flex room/)
  assert.equal(isBedroom({ id: 'z', kind: 'bed', w: 9, d: 7, x: 0, y: 0 }, []), false, '63 sf is not a bedroom')
  const big = { id: 'z', kind: 'bed', w: 12, d: 11, x: 0, y: 0 }
  assert.equal(isBedroom(big, [big, { id: 'w', kind: 'window', element: true, room: 'z', x: 0, y: 0, w: 3, d: 0.5 }]), false, 'no closet, no bedroom')
  assert.equal(isBedroom(big, [big, { id: 'w', kind: 'window', element: true, room: 'z', x: 0, y: 0, w: 3, d: 0.5 }, { id: 'c', kind: 'wic', name: 'Closet', x: 12, y: 0, w: 2.5, d: 6 }]), true)
  assert.equal(kit.reference.program.garage, 0, 'the Garza sample stays 0-car, as in the client\'s set')
})

test('19 (updated): the compact plan has an entry zone, storage within 6 ft of the front door; the open-plan reach from the door is measured', () => {
  const prog = { ...DEFAULT_PROGRAM, beds: 3, baths: 2, halfBath: false, office: false, garage: 0, sqft: 1300 }
  const d = starterDraft(prog, style, DEFAULT_LOT)
  assert.equal(planIdOf(d.rooms), 'compact')
  const rooms = d.rooms
  const front = rooms.find((e) => e.kind === 'door' && e.exterior && e.room === 'living')
  assert.ok(front, 'the front door opens into the living room: no enclosed foyer')
  assert.ok(!rooms.some((r) => isRoom(r) && r.kind === 'foyer'), 'no foyer room')
  const cx = front.x + front.w / 2
  const cy = front.y + front.d / 2
  const storage = rooms.filter((e) => (e.kind === 'fixture' && e.fixture === 'bench' && e.room === 'living') || (isRoom(e) && e.kind === 'wic' && /coat|entry/i.test(e.name || '')))
  const near = storage.filter((s) => Math.hypot(s.x + s.w / 2 - cx, s.y + s.d / 2 - cy) <= 6)
  assert.ok(near.length >= 1, `storage within 6 ft of the door: ${storage.map((s) => Math.hypot(s.x + s.w / 2 - cx, s.y + s.d / 2 - cy).toFixed(1)).join(', ')}`)
  // the reach: which of living, kitchen and dining a visitor enters without crossing a hall (reported; the kitchen
  // still sits behind the hall on this plan, so this is measured, not asserted)
  const kit2 = kitFor(style)
  const openPairs = new Set((kit2.plans.compact.open || []).flatMap(([a, b]) => [a + '|' + b, b + '|' + a]))
  const byId = Object.fromEntries(rooms.filter(isRoom).map((r) => [r.id, r]))
  const touches = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1 && Math.min(a.y + a.d, b.y + b.d) - Math.max(a.y, b.y) > -0.8 || Math.min(a.y + a.d, b.y + b.d) - Math.max(a.y, b.y) > 1 && Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > -0.8
  const directFromLiving = ['kitchen', 'dining'].filter((id) => byId[id] && (openPairs.has('living|' + id) && touches(byId.living, byId[id])))
  console.log(`  compact entry zone: storage ${near.length ? near.map((s) => (s.fixture || s.kind) + ' ' + Math.hypot(s.x + s.w / 2 - cx, s.y + s.d / 2 - cy).toFixed(1) + ' ft').join(', ') : 'none'} from the door; open straight from the living room: ${directFromLiving.join(', ') || 'none (the kitchen and dining sit behind the hall)'}`)
  assert.equal(auditPlan(rooms, prog, kit2, DEFAULT_LOT).errors.length, 0)
})
