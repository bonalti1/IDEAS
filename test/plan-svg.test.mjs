// The floor plan drawing: dimension strings, a north arrow, a scale, a title, door swings, window
// symbols, fixture symbols, and room labels that never overlap, on the 4 x 4 matrix.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateRooms, kitFor } from '../src/draft/lib/layout.js'
import { fitsLot } from '../src/draft/lib/fit.js'
import { buildDesign } from '../src/draft/lib/contract.js'
import { planSVG, planSheetHTML } from '../src/draft/lib/plan-svg.js'
import { STYLES } from '../src/draft/lib/styles.js'
import { LOTS, PROGRAMS, draftable } from './helpers.mjs'

const style = STYLES.find((s) => s.id === 'farmhouse')
const kit = kitFor(style)
const intersects = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

for (const [lotName, lot] of Object.entries(LOTS)) {
  for (const [progName, program] of Object.entries(PROGRAMS)) {
    test(`floor plan drawing: ${progName} on ${lotName}`, () => {
      const drafted = draftable(program, lot)
      assert.ok(drafted)
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
      // every label sits inside its room's walls (unless led out of a room too small for its name) and over no fixture
      const IN = 12
      const fixBoxes = design.fixtures.map((f) => ({ id: f.id, x: (f.x - f.w / 2 - plan.minX) * IN, y: (f.z - f.d / 2 - plan.minZ) * IN, w: f.w * IN, h: f.d * IN }))
      for (const l of plan.labels) {
        if (l.leader) continue
        assert.ok(l.x >= l.room.x - 0.01 && l.y >= l.room.y - 0.01 && l.x + l.w <= l.room.x + l.room.w + 0.01 && l.y + l.h <= l.room.y + l.room.h + 0.01, `label ${l.id} crosses its room's wall`)
        for (const f of fixBoxes) assert.ok(!intersects(l, { x: f.x + plan.originX, y: f.y + plan.originY, w: f.w, h: f.h }), `label ${l.id} sits over fixture ${f.id}`)
      }
      assert.equal((plan.svg.match(/class="leaf"/g) || []).length, design.doors.filter((d) => !d.cased && !d.overhead).reduce((n, d) => n + (d.pair ? 2 : 1), 0), 'a leaf per door')
      assert.equal((plan.svg.match(/class="glass"/g) || []).length, design.windows.length, 'a symbol per window')
      assert.ok((plan.svg.match(/class="fixture toilet"/g) || []).length >= 2 && plan.svg.includes('class="fixture range"') && plan.svg.includes('class="fixture fridge"'))
      assert.ok((plan.svg.match(/class="wall exterior"/g) || []).length >= 10)
      const sheet = planSheetHTML(design, kit.titleBlock)
      // 24 x 36 at 1/4" = 1'-0" (turned portrait when the plan is deeper than wide; the 5/4 with its 3-car garage and
      // longer wing takes 3/16"), the site plan at 1" = 20' on a second sheet
      assert.ok(/@page \{ size: (36in 24in|24in 36in)/.test(sheet) && sheet.includes(kit.titleBlock.firm) && /Scale (1\/4|3\/16)&quot; = 1'-0&quot;/.test(sheet) && /Scale 1&quot; = (10|20|30|40|50)'-0&quot;/.test(sheet) && sheet.includes('Site plan'), sheet.slice(0, 400))
      if (!progName.startsWith('5/4')) assert.ok(sheet.includes('Scale 1/4&quot; = 1\'-0&quot;'), '1/4" for the 3-bed and 4-bed plans')
      const tabloid = planSheetHTML(design, kit.titleBlock, { sheet: 'tabloid' })
      assert.ok(/@page \{ size: (17in 11in|11in 17in)/.test(tabloid) && /Scale (1\/8|3\/32|1\/16)&quot; = 1'-0&quot;/.test(tabloid))
    })
  }
}
