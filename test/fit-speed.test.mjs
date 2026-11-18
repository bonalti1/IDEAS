// Round 8: the fit check the rooms step runs on every tap answers fast on every lot and program of the
// matrix (it took 12–20 s on the narrow lot in round 6), and the answer is cached by program and lot.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_PROGRAM, kitFor } from '../src/draft/lib/layout.js'
import { fitsLot, clearFitCache } from '../src/draft/lib/fit.js'
import { STYLES } from '../src/draft/lib/styles.js'
import { LOTS } from './helpers.mjs'

const style = STYLES.find((s) => s.id === 'farmhouse')
const kit = kitFor(style)
const PROGRAMS = {
  '3/2 1,800': { ...DEFAULT_PROGRAM, beds: 3, baths: 2, halfBath: false, office: false, garage: 0, sqft: 1800 },
  '4/3.5 2,800': { ...DEFAULT_PROGRAM },
  '5/4 3-car 3,500': { ...DEFAULT_PROGRAM, beds: 5, baths: 4, halfBath: false, office: true, garage: 3, sqft: 3500 },
  Garza: { ...kit.reference.program },
}
// the mark is 800 ms a cell; the assertion fails the build at 1.5 s, so a slow CI box does not fail on a good change
const LIMIT_MS = 1500

test('every 4 × 4 cell runs fitsLot in under 1.5 s (800 ms is the mark), and a second ask is answered from the cache', () => {
  const table = []
  for (const [ln, lot] of Object.entries(LOTS))
    for (const [pn, program] of Object.entries(PROGRAMS)) {
      clearFitCache()
      const t0 = performance.now()
      const f = fitsLot(program, style, lot)
      const ms = performance.now() - t0
      table.push(`${ln} × ${pn}: ${Math.round(ms)} ms (${f.ok ? 'fits' : f.maxSqft ? `max ${f.maxSqft}` : f.suggestion ? 'offer' : 'no'})`)
      assert.ok(ms < LIMIT_MS, `${ln} × ${pn} took ${Math.round(ms)} ms`)
      const t1 = performance.now()
      const again = fitsLot(program, style, lot)
      assert.equal(again, f, 'the same ask is the same answer object')
      assert.ok(performance.now() - t1 < 5, 'the cached answer is immediate')
    }
  console.log(table.join('\n'))
})
