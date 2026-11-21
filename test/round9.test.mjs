// Round 9: what the architect review found live, each with a test that failed before the fix.
//   2  integer prop_id goes out unquoted (test/parcels.test.mjs has the where clause and the fixture server's 400)
//   5  the address point's parcel is checked against the situs (parcels.test)
//   6  the front edge: the Census point off a corner, a 31 x 300 sliver
//   7  the recorder's allow-list (parcels.test)
//   8  signed-in, rate-limited parcel routes (parcels.test)
//  10  plan-rule refusals are one plain sentence; the raw list stays for the drafter
//  11  "bigger and then smaller" nets to nothing; a full plan says so
//  14  Edinburg's 60% is impervious cover: its own field and its own finding
//  15  a large tract is flagged
//  16  "baths": 3.5 is 3 baths and a half bath at every entry point; the audit script does not crash
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { pickFrontEdge, projectRing, cleanRing, ringToCalls } from '../server/parcels.mjs'
import { interpretRequest, plainRefusal, netsToNothing } from '../src/draft/lib/interpret.js'
import { generateRooms, DEFAULT_PROGRAM, kitFor, normalizeProgram, programOf } from '../src/draft/lib/layout.js'
import { fitsLot } from '../src/draft/lib/fit.js'
import { auditPlan, CHECK_GROUPS } from '../src/draft/lib/audit.js'
import { buildLot } from '../src/draft/lib/lot.js'
import { STYLES } from '../src/draft/lib/styles.js'
import { JURISDICTIONS, resolveRules, FIELD_LABELS, ALL_FIELDS } from '../src/draft/lib/jurisdictions.js'
import { cityTable } from '../src/draft/lib/cities.js'
import { loadFixtures } from '../server/fixtures.mjs'

const style = STYLES.find((s) => s.id === 'farmhouse')
const kit = kitFor(style)
const offline = async () => {
  throw new Error('offline')
}

test('6: the front edge faces the street point: a point off the corner no longer ties the long side first; a 31 x 300 sliver fronts on its 31 ft end', () => {
  // Kerria: 80 wide (south, on the street) by 130 deep; the Census point 25 ft out in the street, 2 ft past the corner
  const kerria = [[0, 0], [80, 0], [80, 130], [0, 130]].reverse() // clockwise with north up: y grows north
  const ring = cleanRing(kerria).pts
  const lenOf = (i) => Math.hypot(ring[(i + 1) % 4][0] - ring[i][0], ring[(i + 1) % 4][1] - ring[i][1])
  for (const ref of [[40, -25], [-2, -25], [82, -25], [0, -30]]) assert.equal(Math.round(lenOf(pickFrontEdge(ring, ref))), 80, `street point ${ref}: the 80 ft side`)
  assert.equal(Math.round(lenOf(pickFrontEdge(ring, [-30, 65]))), 130, 'a point west of the lot: the west side')
  // the sliver: 31.6 wide by 300 deep, the street point in front of the short end
  const sliver = cleanRing([[0, 0], [31.6, 0], [31.6, 300], [0, 300]].reverse()).pts
  const lenS = (i) => Math.hypot(sliver[(i + 1) % 4][0] - sliver[i][0], sliver[(i + 1) % 4][1] - sliver[i][1])
  assert.ok(Math.abs(lenS(pickFrontEdge(sliver, [15.8, -24])) - 31.6) < 0.01, 'the 31 ft end')
  assert.ok(Math.abs(lenS(pickFrontEdge(sliver, [-1, -24])) - 31.6) < 0.01, 'even off the corner (the old pick took the 300 ft side)')
  // no street point: the edge facing south
  assert.equal(Math.round(lenOf(pickFrontEdge(ring, null))), 80)
  // on the live recordings (round 10, item 1) the Census point alone is not enough: for 5435 Curtis Clark Dr it sits
  // hundreds of feet down the street and this rule picks the 300 ft side. The pipeline reads the named road instead
  // (test/round10.test.mjs); this rule is only the fallback when the road map does not answer.
  const FIX = loadFixtures()
  const cf = FIX.find((f) => f.slug === 'curtis-clark-5435-corpus-christi')
  const lotOf = (fx) => fx.parcels.find((p) => String(p.properties.prop_id) === String(fx.expect.propId))
  const P = projectRing(lotOf(cf).geometry.coordinates[0])
  const cc = cleanRing(P.pts).pts
  const byCensus = ringToCalls(cc)[pickFrontEdge(cc, P.toFt([cf.census.coordinates.x, cf.census.coordinates.y]))].distance
  assert.ok(byCensus > 290, `the Census point alone gives the ${byCensus} ft side on the recorded lot`)
  assert.ok(Math.abs(cf.expect.frontFt - 31.15) < 0.5, 'the recorded pipeline answer is the 31 ft end')
})

test('10: a plan-rule refusal is one plain sentence with a suggestion; the validator list stays in reasons for the drafter', async () => {
  const lot = buildLot({ kind: 'manual', width: 100, depth: 150, city: 'mcallen', setbacks: {} })
  const rooms = generateRooms(DEFAULT_PROGRAM, style, lot)
  const r = await interpretRequest('remove all the bedrooms', rooms, DEFAULT_PROGRAM, style, { lot, interpreter: offline, report: false })
  assert.equal(r.applied, false)
  // one plain sentence and a suggestion; since round 10 (item 8) nothing of the validator's text, not even in brackets
  assert.equal(r.reply, `Taking out the ${r.reply.match(/Bedroom \d/)[0]} leaves rooms without a door or with a door to the outside, so the plan would not work as drawn. Try one room at a time, or tell me what the space is for and I will redraw it.`)
  assert.doesNotMatch(r.reply, /[()]/, 'no parenthetical')
  for (const raw of r.reasons) assert.ok(!r.reply.includes(raw.replace(/\.$/, '')), `the validator sentence is not in the reply: ${raw}`)
  assert.ok(r.reasons.length >= 2 && r.reasons.some((x) => /door/.test(x)), 'the raw list is kept for the drafter log')
  // the sentence builder, case by case
  const kitchen = rooms.find((x) => x.kind === 'kitchen')
  assert.equal(plainRefusal(['Living would cross the setback at 5 ft from side.'], [], [{ op: 'resize', room: kitchen.id, w: 30, d: 20 }], rooms, kit), 'Resizing the kitchen runs past the 5 ft side setback, so the plan would not work as drawn. Try a smaller step, or say how big it should be.')
  assert.match(plainRefusal(['Kitchen would cross the setback at 20 ft from elm st.'], [], [{ op: 'move', room: kitchen.id }], rooms, kit), /^Moving the kitchen runs past the 20 ft setback from Elm St, so/)
  assert.match(plainRefusal(['Kitchen would run into dining.'], [], [{ op: 'move', room: kitchen.id }], rooms, kit), /^Moving the kitchen runs rooms into each other/)
  assert.equal(plainRefusal(['Bedroom 2 has no egress window.'], ['Closet has no door.'], [{ op: 'add', kind: 'bath' }], rooms, kit), 'Adding a bath takes the escape window away from the Bedroom 2, so the plan would not work as drawn. Tell me which room could give up some space for it. The plan also has a problem from before: a room has no door, or a door that opens to the outside. The drafter sees the details.')
  assert.equal(plainRefusal(['Kitchen has no window.'], [], [{ op: 'swap', room: kitchen.id, target: 'dining' }], rooms, kit), 'Swapping the kitchen and the dining leaves the kitchen without a window, so the plan would not work as drawn. Try two rooms of about the same size, or tell me what you want next to what and I will redraw it.')
  assert.equal(plainRefusal(['Every house needs a kitchen.'], [], [{ op: 'remove', room: kitchen.id }], rooms, kit), 'Every house needs a kitchen, so that one stays. Tell me what you would like changed about it instead.')
  // a reason of no known kind: still plain, the validator sentence is not quoted and nothing sits in brackets
  const odd = plainRefusal(['Something odd.', 'Another odd thing.'], [], [{ op: 'swap', room: kitchen.id, target: 'garage' }], rooms, kit)
  assert.match(odd, /^Swapping the kitchen and the (2-car )?garage does not work on this plan as it is drawn\. Try two rooms/)
  assert.doesNotMatch(odd, /Something odd|[()]|that room/)
})

test('11: "make the kitchen bigger and then make it smaller" nets to no change and uses nothing; "add 10 bedrooms" on a full plan says the plan is full', async () => {
  const lot = buildLot({ kind: 'manual', width: 100, depth: 150, city: 'mcallen', setbacks: {} })
  const rooms = generateRooms(DEFAULT_PROGRAM, style, lot)
  for (const q of ['make the kitchen bigger and then make it smaller', 'make the kitchen bigger, then make the kitchen smaller', 'make the living room smaller and then bigger']) {
    const r = await interpretRequest(q, rooms, DEFAULT_PROGRAM, style, { lot, interpreter: offline, report: false })
    assert.equal(r.applied, false, q)
    assert.equal(r.noop, true, q)
    assert.match(r.reply, /nets out to no change/, q)
    assert.match(r.reply, /No change was used/)
  }
  assert.equal(netsToNothing('make the kitchen bigger and add a bedroom', rooms, kit), null)
  assert.equal(netsToNothing('make the kitchen 2 feet wider and then 1 foot narrower', rooms, kit), null, 'with sizes it is a real change, applied in order')
  assert.equal(netsToNothing('make the kitchen bigger and then make the office smaller', rooms, kit), null, 'two rooms: two changes')
  const both = await interpretRequest('make the kitchen bigger and then make the office smaller', rooms, DEFAULT_PROGRAM, style, { lot, interpreter: offline, report: false })
  assert.equal(both.applied, true, both.reply)
  const full = { ...DEFAULT_PROGRAM, beds: 6 }
  const r6 = generateRooms(full, style, lot)
  const cap = await interpretRequest('add 10 bedrooms', r6, full, style, { lot, interpreter: offline, report: false })
  assert.equal(cap.reply, 'This plan already has the most bedrooms this lot holds (6).')
  assert.doesNotMatch(cap.reply, /0 more/)
  const some = await interpretRequest('add 10 bedrooms', rooms, DEFAULT_PROGRAM, style, { lot, interpreter: offline, report: false })
  assert.match(some.reply, /Ask for 2 more at most\.$/)
})

test('14: Edinburg carries a 60% impervious-cover cap in its own field; building coverage is marked unknown; the audit measures paving against it', () => {
  const e = JURISDICTIONS.edinburg
  assert.equal(e.imperviousMax.value, 0.6)
  assert.equal(e.maxCoverage.status, 'unknown', 'the 60% was never building coverage')
  assert.equal(e.coverageIncludesImpervious.value, false)
  assert.ok(ALL_FIELDS.includes('imperviousMax') && FIELD_LABELS.imperviousMax === 'Max impervious cover')
  const r = resolveRules(e, {}, { width: 100, depth: 150 })
  assert.equal(r.imperviousMax, 0.6)
  assert.equal(r.maxCoverage, 0.5, 'the county default stands in, flagged')
  assert.ok(r.used.find((u) => u.id === 'imperviousMax').value.startsWith('60%'))
  assert.equal(cityTable().edinburg.imperviousMax, 0.6)
  const lot = buildLot({ kind: 'manual', width: 60, depth: 100, city: 'edinburg', setbacks: { front: 10, side: 3, rear: 5 } })
  const program = { ...DEFAULT_PROGRAM, beds: 3, baths: 2, garage: 2, sqft: 2000 }
  const rooms = generateRooms(program, style, lot)
  const a = auditPlan(rooms, program, kit, lot)
  assert.ok(a.measures.impervious && a.measures.impervious.maxPct === 60, JSON.stringify(a.measures.impervious))
  assert.ok(a.measures.impervious.sf > a.measures.coverage.footprintSf, 'paving is in the impervious number')
  const f = a.findings.find((x) => x.id === 'impervious')
  if (a.measures.impervious.pct > 60) {
    assert.ok(f, 'over 60%: the impervious finding')
    assert.match(f.message, /impervious cover/)
    assert.equal(f.rule.id, 'imperviousMax')
  }
  // the same house on a lot with no impervious cap has no such finding or measure
  const mc = buildLot({ kind: 'manual', width: 60, depth: 100, city: 'mcallen', setbacks: { front: 10, side: 3, rear: 5 } })
  const b = auditPlan(generateRooms(program, style, mc), program, kit, mc)
  assert.equal(b.measures.impervious, undefined)
  assert.ok(CHECK_GROUPS.find((g) => g.id === 'lot').ids.includes('impervious'))
})

test('16: "baths": 3.5 is 3 baths and a half bath everywhere; the audit script does not crash on it', () => {
  assert.deepEqual(normalizeProgram({ beds: 4, baths: 3.5 }), { beds: 4, baths: 3, halfBath: true, garage: 0, stories: 1 })
  assert.equal(normalizeProgram({ baths: 2.75 }).baths, 2)
  assert.equal(normalizeProgram({ baths: '3' }).baths, 3)
  assert.equal(normalizeProgram({ beds: -2, baths: 2 }).beds, 0)
  assert.equal(normalizeProgram({ baths: 2, stories: 0 }).stories, 1)
  const lot = buildLot({ kind: 'manual', width: 100, depth: 150, city: 'mcallen', setbacks: {} })
  const rooms = generateRooms({ ...DEFAULT_PROGRAM, baths: 3.5, halfBath: false }, style, lot)
  const drawn = programOf(rooms, DEFAULT_PROGRAM)
  assert.equal(drawn.baths, 3)
  assert.equal(drawn.halfBath, true)
  assert.ok(fitsLot({ ...DEFAULT_PROGRAM, baths: 3.5 }, style, lot).ok !== undefined, 'the fit check takes it')
  const r = spawnSync(process.execPath, ['scripts/plan-audit.mjs', '--program', '{"baths":3.5}'], { encoding: 'utf8', timeout: 120000 })
  assert.equal(r.status, 0, (r.stderr || '').slice(-300))
  assert.doesNotMatch(r.stderr || '', /RangeError|Invalid array length/)
  assert.match(r.stdout, /3\.5 bath/)
})

test('15: a tract over two acres or with many edges is flagged large (the client sees the block, not 400 edges)', async () => {
  const { makeParcels } = await import('../server/parcels.mjs')
  const { fixtureFetch } = await import('../server/fixtures.mjs')
  const { makeLots } = await import('../server/lots.mjs')
  const m = new Map()
  const store = { meta: { get: async (k) => m.get(k) ?? null, set: async (k, v) => m.set(k, v) } }
  const fetchImpl = fixtureFetch(loadFixtures())
  const lots = makeLots({ store, fetchImpl, files: {}, interpreter: {}, event: async () => {} })
  const parcels = makeParcels({ store, fetchImpl, geocode: (a) => lots.geocode(a), log: () => {}, event: async () => {} })
  const ranch = await parcels.lookup({ address: '4400 Ranch Rd, Rio Grande City, TX 78582' })
  assert.equal(ranch.large, true, '5 acres')
  const kerria = await parcels.lookup({ address: '1201 Kerria Ave, McAllen, TX 78501' })
  assert.equal(kerria.large, false)
})
