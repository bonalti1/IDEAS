// The price range comes from one config and one function, by county and style.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { estimate, RATES, countyOf, range } from '../src/draft/lib/pricing.js'
import { generateRooms, DEFAULT_PROGRAM } from '../src/draft/lib/layout.js'
import { STYLES } from '../src/draft/lib/styles.js'
import { buildLot } from '../src/draft/lib/lot.js'

const style = STYLES.find((s) => s.id === 'farmhouse')
const mcallen = buildLot({ kind: 'manual', width: 100, depth: 150, city: 'mcallen', setbacks: {} })

test('2,000 sf in McAllen prices the living area at $230k to $240k, construction only', () => {
  const e = estimate({ program: { ...DEFAULT_PROGRAM, sqft: 2000, garage: 0, rearPorch: false }, style, lot: mcallen })
  assert.equal(e.county, 'Hidalgo County')
  assert.deepEqual(e.perSf, [115, 120])
  assert.deepEqual(e.parts.living, [230000, 240000])
  assert.match(e.note, /construction only/i)
  assert.equal(e.confirmed, false, 'rates are not confirmed until Rolando signs off')
})

test('the same plan costs more in Cameron County, and the garage and porches are priced per sf', () => {
  const program = { ...DEFAULT_PROGRAM, sqft: 2400, garage: 2 }
  const rooms = generateRooms(program, style, mcallen)
  const hidalgo = estimate({ rooms, program, style, lot: mcallen })
  assert.equal(countyOf({ city: 'brownsville' }), RATES.defaultCounty, 'a city without a preset falls back to the default county')
  const cameron = estimate({ rooms, program, style, lot: mcallen, county: 'Cameron County' })
  assert.deepEqual(cameron.perSf, [120, 130])
  assert.ok(cameron.low > hidalgo.low && cameron.high > hidalgo.high, `${cameron.low} > ${hidalgo.low}`)
  assert.ok(hidalgo.areas.garage > 400, 'garage area from the plan')
  assert.ok(hidalgo.areas.porches > 200, 'porch area from the plan')
  assert.equal(hidalgo.parts.garage[0], hidalgo.areas.garage * RATES.garagePerSf[0])
  assert.equal(hidalgo.parts.porches[1], hidalgo.areas.porches * RATES.porchPerSf[1])
  assert.equal(hidalgo.low, hidalgo.parts.living[0] + hidalgo.parts.garage[0] + hidalgo.parts.porches[0])
  assert.match(range(hidalgo), /^\$\d+k–\$\d+k$/)
})

test('the rooms step (program only) and the draft (rooms) agree on the living rate, and every county has a rate', () => {
  const program = { ...DEFAULT_PROGRAM }
  const fromProgram = estimate({ program, style, lot: mcallen })
  const fromRooms = estimate({ rooms: generateRooms(program, style, mcallen), program, style, lot: mcallen })
  assert.deepEqual(fromProgram.perSf, fromRooms.perSf)
  assert.ok(Math.abs(fromProgram.areas.living - fromRooms.areas.living) / fromRooms.areas.living < 0.05, 'the program sf and the drawn sf agree within 5%')
  Object.values(RATES.counties).forEach(([lo, hi]) => assert.ok(lo >= 100 && hi >= lo))
})
