// Round 7, item 8: the audit checks the lot's own rules and names the row and source for each finding:
// coverage (with the paving where the city counts it), height and stories, today's minimum lot, a tract with no
// recorded plat, zoning that is not a house district (blocks Send), the garage door's distance to the street line,
// and the flood zone. Each finding fails on a lot built to trip it and is absent on the default McAllen lot.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { auditPlan, auditSummary, CHECK_GROUPS } from '../src/draft/lib/audit.js'
import { checkRules } from '../src/draft/lib/rules.js'
import { generateRooms, DEFAULT_PROGRAM, kitFor } from '../src/draft/lib/layout.js'
import { buildLot, zoningBlocksSend } from '../src/draft/lib/lot.js'
import { buildDesign } from '../src/draft/lib/contract.js'
import { STYLES } from '../src/draft/lib/styles.js'
import { cityTable } from '../src/draft/lib/cities.js'

const style = STYLES.find((s) => s.id === 'farmhouse')
const kit = kitFor(style)
const program = { ...DEFAULT_PROGRAM, beds: 3, baths: 2, garage: 2, sqft: 2000 }
const ids = (a) => a.findings.filter((f) => ['coverage', 'height', 'min-lot', 'unplatted', 'zoning', 'garage-setback', 'flood'].includes(f.id)).map((f) => f.id)
const byId = (a, id) => a.findings.find((f) => f.id === id)

test('the default McAllen 100 x 150 lot raises none of the lot-rule findings, and the group is listed', () => {
  const lot = buildLot({ kind: 'manual', width: 100, depth: 150, city: 'mcallen', frontStreet: 'Elm St', setbacks: {} })
  const rooms = generateRooms(program, style, lot)
  const a = auditPlan(rooms, program, kit, lot)
  assert.deepEqual(ids(a), [])
  assert.ok(a.measures.coverage && a.measures.coverage.pct > 0 && a.measures.coverage.maxPct === 50, JSON.stringify(a.measures.coverage))
  assert.ok(a.measures.height.ridgeFt > 15 && a.measures.height.maxFt === 35)
  assert.ok(CHECK_GROUPS.some((g) => g.id === 'lot' && g.ids.includes('garage-setback') && g.ids.includes('zoning')))
  const s = auditSummary(rooms, program, kit, lot)
  assert.equal(s.groups.find((g) => g.id === 'lot').state, 'pass')
})

test('coverage: the same house on a small lot trips the limit; where the city counts paving, the driveway and walk count too', () => {
  // a 50 x 80 McAllen lot (4,000 sf) at 40%: 1,600 sf of footprint allowed; the 2,000 sf house with a garage is over
  const small = buildLot({ kind: 'manual', width: 50, depth: 80, city: 'mcallen', frontStreet: 'Elm St', setbacks: { front: 5, side: 3, rear: 5 } })
  const rooms = generateRooms({ ...program, sqft: 1800 }, style, small)
  const a = auditPlan(rooms, { ...program, sqft: 1800 }, kit, small)
  const f = byId(a, 'coverage')
  assert.ok(f, 'coverage finding')
  assert.equal(f.severity, 'error')
  assert.match(f.message, /cover \d+% of the lot/)
  assert.equal(f.rule.id, 'maxCoverage')
  assert.match(f.rule.source || '', /mcallen/i)
  assert.doesNotMatch(f.message, /counting paving/)
  // a city that counts impervious cover: the message says so and the counted area grows by the flatwork
  const table = cityTable()
  const base = buildLot({ kind: 'manual', width: 100, depth: 150, city: 'mcallen', frontStreet: 'Elm St', setbacks: {} }, table)
  const paved = { ...base, rules: { ...base.rules, coverageIncludesImpervious: true } }
  const r2 = generateRooms(program, style, paved)
  const b = auditPlan(r2, program, kit, paved)
  assert.equal(b.measures.coverage.includesImpervious, true)
  assert.ok(b.measures.coverage.flatworkSf > 100, 'the driveway and walk are measured')
  assert.equal(b.measures.coverage.countedSf, b.measures.coverage.footprintSf + b.measures.coverage.flatworkSf)
  assert.equal(auditPlan(r2, program, kit, base).measures.coverage.countedSf, b.measures.coverage.footprintSf, 'without the rule the paving does not count')
  const c = auditPlan(r2, program, kit, { ...paved, areaSf: b.measures.coverage.countedSf / 0.5 - 20 })
  assert.match(byId(c, 'coverage')?.message || '', /counting paving/)
  // the rules check carries the error into the reasons that block Send
  const r = checkRules(rooms, { ...program, sqft: 1800 }, style, small)
  assert.ok(r.reasons.some((x) => /cover .*% of the lot/.test(x)))
})

test('height: two stories where one is allowed is an error; a tall ridge against the limit is a warning for the drafter', () => {
  const lot = buildLot({ kind: 'manual', width: 100, depth: 150, city: 'mcallen', frontStreet: 'Elm St', setbacks: {} })
  const rooms = generateRooms(program, style, lot)
  const one = { ...lot, rules: { ...lot.rules, maxStories: 1 } }
  const a = auditPlan(rooms, { ...program, stories: 2 }, kit, one)
  const f = byId(a, 'height')
  assert.equal(f?.severity, 'error')
  assert.match(f.message, /2 stories; McAllen, TX allows 1 story/)
  assert.equal(f.rule.id, 'maxStories')
  const low = { ...lot, rules: { ...lot.rules, maxHeightFt: 14 } }
  const b = byId(auditPlan(rooms, program, kit, low), 'height')
  assert.equal(b?.severity, 'warn')
  assert.match(b.message, /the limit is 14 ft/)
})

test("today's minimum lot and an unplatted tract are warnings that name the rule; zoning is a warning on the plan and blocks Send only for a confirmed lot", () => {
  const narrow = buildLot({ kind: 'manual', width: 40, depth: 120, city: 'mcallen', frontStreet: 'Elm St', setbacks: {} })
  const rooms = generateRooms({ ...program, garage: 0, sqft: 1400 }, style, narrow)
  const a = auditPlan(rooms, { ...program, garage: 0, sqft: 1400 }, kit, narrow)
  const m = a.findings.filter((f) => f.id === 'min-lot')
  assert.ok(m.length >= 1)
  assert.ok(m.every((f) => f.severity === 'warn'))
  assert.ok(m.some((f) => /minimum lot width/.test(f.message) && f.rule.id === 'minLotWidth'))
  assert.ok(m.some((f) => /minimum lot size/.test(f.message) && f.rule.id === 'minLotSf'))
  const tract = buildLot({ kind: 'manual', width: 300, depth: 726, city: 'riograndecity', frontStreet: 'Ranch Rd', legal: 'ABST 91 SHARE 22 PORCION 76 5.00 AC', setbacks: {} })
  const t = byId(auditPlan(generateRooms(program, style, tract), program, kit, tract), 'unplatted')
  assert.equal(t?.severity, 'warn')
  assert.match(t.message, /platted before a permit/)
  assert.match(t.rule.source, /Local Government Code/)
  const platted = buildLot({ kind: 'manual', width: 100, depth: 150, city: 'mcallen', frontStreet: 'Elm St', legal: 'PALMS LOT 7 BLK 4', setbacks: {} })
  assert.equal(byId(auditPlan(generateRooms(program, style, platted), program, kit, platted), 'unplatted'), undefined)
  // zoning
  const commercial = buildLot({ kind: 'manual', width: 100, depth: 150, city: 'mcallen', frontStreet: 'N 10th St', setbacks: {}, zoning: { status: 'found', district: 'C-3', residential: false, use: 'commercial', layer: 'https://gismap.mcallen.net/arcgis/rest/services/DevelopmentZoning/MapServer/4' } })
  const rz = generateRooms(program, style, commercial)
  const z = byId(auditPlan(rz, program, kit, commercial), 'zoning')
  // decision B6 (round 10, item 4): zoning is a warning on the plan, so Rooms and Draft stay open; Send is what it blocks
  assert.equal(z?.severity, 'warn')
  assert.equal(z.message, 'This lot is zoned C-3 (commercial). A house may need a rezoning; you can keep drafting, and the office will call you before it is sent on.')
  assert.equal(z.rule.value, 'C-3')
  const r = checkRules(rz, program, style, commercial)
  assert.equal(r.ok, true, `the plan still passes the rules with a zoning warning: ${r.reasons.join('; ')}`)
  assert.ok(!r.reasons.some((x) => /zoned C-3/.test(x)))
  // Send: a typed lot with a zoning nobody confirmed is not blocked; once a drafter confirms it, it is; a parcel lot is
  assert.equal(zoningBlocksSend(commercial), false, 'a typed lot, zoning unconfirmed')
  const confirmedZone = buildLot({ ...commercial.spec, zoning: { ...commercial.spec.zoning, confirmedBy: 'maria@drafthouse.test' } })
  assert.equal(zoningBlocksSend(confirmedZone), true, 'a typed lot whose zoning a drafter confirmed')
  const parcelLot = buildLot({ kind: 'parcel', city: 'mcallen', calls: [{ distance: 100, bearing: 'N 90 E' }, { distance: 150, bearing: 'S 0 E' }, { distance: 100, bearing: 'S 90 W' }, { distance: 150, bearing: 'N 0 E' }], front: 2, streets: [{ edge: 2, name: 'N 10th St' }], setbacks: {}, zoning: commercial.spec.zoning })
  assert.equal(zoningBlocksSend(parcelLot), true, 'a parcel lot: the district was read at the parcel')
  const res = buildLot({ kind: 'manual', width: 100, depth: 150, city: 'mcallen', frontStreet: 'Elm St', setbacks: {}, zoning: { status: 'found', district: 'R-1', residential: true, use: 'single-family' } })
  assert.equal(byId(auditPlan(generateRooms(program, style, res), program, kit, res), 'zoning'), undefined)
  assert.equal(zoningBlocksSend(res), false)
  assert.equal(zoningBlocksSend(null), false)
})

test('the garage door sits at least the city distance back from the street line: measured on the lot, an error when it is short', () => {
  const lot = buildLot({ kind: 'manual', width: 100, depth: 150, city: 'mcallen', frontStreet: 'Elm St', setbacks: {} })
  const rooms = generateRooms(program, style, lot)
  const ok = auditPlan(rooms, program, kit, lot)
  assert.equal(byId(ok, 'garage-setback'), undefined)
  assert.ok(ok.measures.garageDoorFt >= 20 - 0.01, `door ${ok.measures.garageDoorFt} ft from the line`)
  assert.ok(ok.measures.garageDoorFt < 60, 'measured to the line, not to the end of the search')
  // a city asking more than the house gives (the door sits about 49 ft back here): the finding names the rule
  const strict = { ...lot, rules: { ...lot.rules, garageFt: 60 }, rulesUsed: lot.rulesUsed.map((u) => (u.id === 'garageFt' ? { ...u, value: '60 ft' } : u)) }
  const bad = auditPlan(rooms, program, kit, strict)
  const f = byId(bad, 'garage-setback')
  assert.ok(f, 'garage-setback finding')
  assert.equal(f.severity, 'error')
  assert.match(f.message, /overhead door is [\d.]+ ft from the property line; McAllen, TX asks 60 ft/)
  assert.equal(f.rule.id, 'garageFt')
  assert.match(f.rule.source || '', /mcallen/i)
  assert.ok(checkRules(rooms, program, style, strict).reasons.some((x) => /overhead door is/.test(x)), 'it blocks Send')
  // Harlingen exempts a side-entry garage from the distance; a front-facing door is still measured
  const hl = buildLot({ kind: 'manual', width: 100, depth: 150, city: 'harlingen', frontStreet: 'Elm St', setbacks: {} })
  assert.equal(hl.rules.garageSideEntryExempt, true)
  const h = auditPlan(generateRooms(program, style, hl), program, kit, { ...hl, rules: { ...hl.rules, garageFt: 60 } })
  assert.ok(byId(h, 'garage-setback'), 'a front-facing door is still measured in Harlingen')
  // no overhead door (no garage): nothing measured
  const none = auditPlan(generateRooms({ ...program, garage: 0 }, style, lot), { ...program, garage: 0 }, kit, lot)
  assert.equal(none.measures.garageDoorFt, undefined)
})

test('flood: no digital FIRM, a special flood hazard area, shaded X, a LOMR and a preliminary change each leave a note for the drafter; zone X leaves none', () => {
  const base = (flood) => buildLot({ kind: 'manual', width: 100, depth: 150, city: 'mcallen', frontStreet: 'Elm St', setbacks: {}, flood })
  const rooms = generateRooms(program, style, base(null))
  const notes = (flood) => auditPlan(rooms, program, kit, base(flood)).findings.filter((f) => f.id === 'flood').map((f) => f.message)
  assert.deepEqual(notes({ status: 'x', zone: 'X', sfha: false }), [])
  assert.match(notes({ status: 'no-digital-firm', zone: null, sfha: null })[0], /no digital flood map/)
  assert.match(notes({ status: 'sfha', zone: 'AE', sfha: true, bfe: 20 })[0], /zone AE, base flood elevation 20 ft/)
  assert.match(notes({ status: 'shaded-x', zone: 'X', sfha: false })[0], /0\.2% annual-chance/)
  assert.match(notes({ status: 'x', zone: 'X', sfha: false, lomr: [{ caseNo: '1' }] })[0], /Letter of Map Revision/)
  assert.match(notes({ status: 'x', zone: 'X', sfha: false, prelim: [{ layer: 21 }] })[0], /preliminary/)
  const a = auditPlan(rooms, program, kit, base({ status: 'sfha', zone: 'AE', sfha: true, bfe: 20 }))
  assert.equal(byId(a, 'flood').severity, 'warn')
  assert.match(byId(a, 'flood').rule.source, /FEMA/)
})

test('item 9: design.json carries the rules used, their sources and the flags; the parcel ids ride along for the drafter', () => {
  const lot = buildLot({ kind: 'manual', width: 60, depth: 131, city: 'pharr', frontStreet: 'Elm St', setbacks: {}, flood: { status: 'x', zone: 'X', sfha: false }, zoning: { status: 'found', district: 'R-1', residential: true, use: 'single-family' } })
  const rooms = generateRooms(program, style, lot)
  const d = buildDesign({ rooms, program, style, lot, client: 'Test' })
  assert.equal(d.lot.rules.rear, 13.1)
  assert.equal(typeof d.lot.rules.coverageIncludesImpervious, 'boolean')
  assert.ok(d.lot.rulesUsed.length >= 19)
  const rear = d.lot.rulesUsed.find((u) => u.id === 'rear')
  assert.ok(rear.source && rear.status)
  assert.ok(d.lot.ruleNotes.some((n) => /13\.1 ft = 10% of 131 ft depth/.test(n)))
  assert.equal(d.lot.zoning.district, 'R-1')
  assert.equal(d.lot.jurisdiction.id, 'pharr')
  assert.equal(d.lot.rules.wind, 'set by the engineer of record')
  assert.ok(Array.isArray(d.lot.flags))
  assert.ok(!JSON.stringify(d).includes('owner'), 'no owner data in a design')
})
