// Round 6: the tandem garage is said as such everywhere the program line shows; the driveway and the
// front walk are in the takeoff and priced as flatwork; a fit offer keeps what the client asked for.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateRooms, DEFAULT_PROGRAM, kitFor, programOf, programLine, isRoom } from '../src/draft/lib/layout.js'
import { optionsFor } from '../src/draft/lib/options.js'
import { takeoff, flatwork } from '../src/draft/lib/takeoff.js'
import { estimate, rateLine, RATES } from '../src/draft/lib/pricing.js'
import { toIFC } from '../src/draft/lib/ifc.js'
import { STYLES } from '../src/draft/lib/styles.js'
import { DEFAULT_LOT } from '../src/draft/lib/lot.js'
import { LOTS } from './helpers.mjs'

const style = STYLES.find((s) => s.id === 'farmhouse')
const kit = kitFor(style)
const offline = async () => {
  throw new Error('no api')
}

test('a tandem third bay is said so: the program line, the IFC program property and the draft suggestions count it as three cars', async () => {
  const lot = DEFAULT_LOT
  const program = { ...DEFAULT_PROGRAM }
  const rooms = generateRooms(program, style, lot)
  const { options } = optionsFor('garage', rooms, program, style, lot)
  const tandemOpt = options.find((o) => /tandem/.test(o.label))
  assert.ok(tandemOpt, options.map((o) => o.label).join(', '))
  assert.match(tandemOpt.label, /tandem: one bay two cars deep/, 'the option says what a tandem bay is')
  const p = programOf(tandemOpt.rooms, program)
  assert.equal(p.garage, 3)
  assert.equal(p.tandem, true)
  assert.match(programLine(p), /3-car \(tandem: one bay two cars deep\)/)
  const ifc = toIFC({ rooms: tandemOpt.rooms, program, kit, style, lot })
  assert.match(ifc.split('\n').find((l) => /IFCPROPERTYSINGLEVALUE\('Program'/.test(l)) || '', /3-car \(tandem/)
  // a plain 3-car says nothing of the kind
  const plain = programOf(generateRooms({ ...DEFAULT_PROGRAM, beds: 5, baths: 4, halfBath: false, garage: 3, sqft: 3500 }, style, DEFAULT_LOT), program)
  assert.equal(plain.tandem, false)
  assert.doesNotMatch(programLine(plain), /tandem/)
})

test('the driveway and the front walk are in the takeoff and priced as flatwork, a CONFIRM rate like the garage and porch rates', () => {
  const lot = LOTS['McAllen 100 x 150']
  const rooms = generateRooms(DEFAULT_PROGRAM, style, lot)
  const f = flatwork(rooms, kit, lot)
  assert.ok(f.driveway > 300 && f.driveway < 1200, `driveway ${f.driveway} sf (a 2-car apron and lane to the street)`)
  assert.ok(f.walk > 50 && f.walk < 400, `walk ${f.walk} sf`)
  const t = takeoff(rooms, DEFAULT_PROGRAM, kit, lot)
  assert.equal(t.areas.flatwork, f.total)
  const e = estimate({ rooms, program: DEFAULT_PROGRAM, style, lot })
  assert.equal(e.areas.flatwork, f.total)
  assert.ok(e.parts.flatwork[0] === f.total * RATES.flatworkPerSf[0] && e.parts.flatwork[1] === f.total * RATES.flatworkPerSf[1])
  assert.ok(e.low >= e.parts.living[0] + e.parts.garage[0] + e.parts.porches[0] + e.parts.flatwork[0] - 1, 'the low end carries the flatwork')
  assert.match(rateLine(e), /driveway and walk \$\d+–\d+\/sf/)
  assert.equal(RATES.confirmed, false, 'every rate stays a placeholder until Rolando confirms them')
  // no garage: the walk alone
  const noG = { ...DEFAULT_PROGRAM, garage: 0 }
  const f0 = flatwork(generateRooms(noG, style, lot), kit, lot)
  assert.equal(f0.driveway, 0)
  assert.ok(f0.walk > 0)
  // with a program alone (the rooms step) the estimate still carries a flatwork allowance
  const e0 = estimate({ program: DEFAULT_PROGRAM, style, lot })
  assert.ok(e0.areas.flatwork > 0 && e0.parts.flatwork[0] > 0)
})

test('a program carries what was asked when a fit offer was taken: the program line of the ask stays readable', () => {
  const asked = { ...DEFAULT_PROGRAM }
  const taken = { ...DEFAULT_PROGRAM, sqft: 2350, asked }
  assert.equal(programLine(taken.asked), programLine(DEFAULT_PROGRAM))
  const rooms = generateRooms(taken, style, LOTS['McAllen 100 x 150'])
  const p = programOf(rooms, taken)
  assert.deepEqual(p.asked, asked, 'programOf keeps the ask beside the as-built counts')
  assert.ok(rooms.filter(isRoom).length > 0)
})
