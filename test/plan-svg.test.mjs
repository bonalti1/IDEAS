// The floor plan drawing: dimension strings, a north arrow, a scale, a title, door swings, window
// symbols, fixture symbols, and room labels that never overlap, on the 4 x 4 matrix.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateRooms, kitFor } from '../src/draft/lib/layout.js'
import { fitsLot } from '../src/draft/lib/fit.js'
import { buildDesign } from '../src/draft/lib/contract.js'
import { planSVG, planSheetHTML } from '../src/draft/lib/plan-svg.js'
import { STYLES } from '../src/draft/lib/styles.js'
import { LOTS, PROGRAMS } from './audit.test.mjs'

const style = STYLES.find((s) => s.id === 'farmhouse')
const kit = kitFor(style)
const intersects = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

for (const [lotName, lot] of Object.entries(LOTS).filter(([n]) => !n.startsWith('narrow'))) {
  for (const [progName, program] of Object.entries(PROGRAMS)) {
    test(`floor plan drawing: ${progName} on ${lotName}`, () => {
      const f = fitsLot(program, style, lot)
      const drafted = f.ok ? program : { ...program, sqft: f.maxSqft }
      const rooms = generateRooms(drafted, style, lot)
      const design = buildDesign({ rooms, program: drafted, style, lot, client: 'Test Client' })
      const plan = planSVG(design)
      assert.ok(plan.svg.startsWith('<svg'))
      assert.ok(plan.dims >= 8, `dimension strings: ${plan.dims} segments`)
      assert.ok((plan.svg.match(/class="dimstring"/g) || []).length >= 8, 'four sides, room breaks and overall')
      assert.ok(plan.svg.includes('id="north"') && plan.svg.includes('id="scale"') && plan.svg.includes('id="title"'))
      assert.ok(plan.svg.includes('Test Client') && plan.svg.includes(lot.address || `${lot.spec.width}`.slice(0, 1)))
      assert.equal(plan.labels.length, design.rooms.length, 'a label per room')
      for (let i = 0; i < plan.labels.length; i++) for (let j = i + 1; j < plan.labels.length; j++) assert.ok(!intersects(plan.labels[i], plan.labels[j]), `labels ${plan.labels[i].id} and ${plan.labels[j].id} overlap`)
      assert.equal((plan.svg.match(/class="leaf"/g) || []).length, design.doors.filter((d) => !d.cased && !d.overhead).reduce((n, d) => n + (d.pair ? 2 : 1), 0), 'a leaf per door')
      assert.equal((plan.svg.match(/class="glass"/g) || []).length, design.windows.length, 'a symbol per window')
      assert.ok((plan.svg.match(/class="fixture toilet"/g) || []).length >= 2 && plan.svg.includes('class="fixture range"') && plan.svg.includes('class="fixture fridge"'))
      assert.ok((plan.svg.match(/class="wall exterior"/g) || []).length >= 10)
      const sheet = planSheetHTML(design, kit.titleBlock)
      assert.ok(sheet.includes('@page { size: 17in 11in') && sheet.includes(kit.titleBlock.firm) && /Scale (1\/4|3\/16|1\/8|3\/32|1\/16)&quot; = 1'-0&quot;/.test(sheet))
    })
  }
}
