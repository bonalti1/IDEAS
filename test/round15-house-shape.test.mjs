// Fix round 15, item U9: "The house looks like a motel: a long narrow strip, one giant dark roof, a row of identical
// windows; the plan is a narrow tube with tiny labels." The target is a typical Rio Grande Valley one-story. Measured on
// the first draft of the default rooms (4 bed, 3.5 bath, office, 2-car, 2,800 sf) on 1201 Kerria Ave, McAllen (65 ft
// buildable) and on a typed 100 x 150 lot, the way the app drafts them:
//   1  the footprint: on Kerria (and the other recorded 60 to 80 ft lots) 1.3 to 1.8 times as deep as wide, with the
//      rooms asked for (round 14: the narrow plan's 4/2 with no office, 43 x 85 ft, 1.98); on 100 x 150 no strip
//   2  the garage forward of the house (or beside it), never more than 12 ft ahead (no snout)
//   3  the roof: a hip main roof whose ridge is the highest and longest, and lower roofs with ridges of their own (a
//      broken ridge line); every room under it; no two ridges crossing at one height; a light shingle in 3D
//   4  windows by room: the family rooms' window wider than a bedroom's, the kitchen's set higher (over the counter),
//      the baths' smaller; bedrooms keep an egress window
//   5  a covered porch at the front, the front door on it
//   6  room labels in the plan view read at 100%: names 12 px or more on the main rooms (10 px on every room that holds
//      its label), sizes 10 px or more, in the Draft screen's plan frame at 1440 x 900
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { isRoom, DEFAULT_PROGRAM } from '../src/draft/lib/layout.js'
import { roofSheets } from '../src/draft/lib/roof.js'
import { auditPlan } from '../src/draft/lib/audit.js'
import { buildDesign } from '../src/draft/lib/contract.js'
import { planSVG, fitScale, planForFrame } from '../src/draft/lib/plan-svg.js'
import { WINDOW_SILL } from '../src/kits/modern-farmhouse.js'
import { recordedLots, typedLot, firstDraft, footprint, style } from './round15-house-lots.mjs'

const kerria = async () => firstDraft((await recordedLots())['1201 Kerria Ave'])
const wide = () => firstDraft(typedLot(100, 150))
const solid = (rooms) => rooms.filter((r) => isRoom(r) && !r.open)

// ── 1. the footprint ─────────────────────────────────────────────────────────────────────────────────────────
test('U9 1: on Kerria the first draft keeps the rooms asked for and is 1.3 to 1.8 times as deep as wide (it was a 43 x 85 ft tube, 1.98)', async () => {
  const f = await kerria()
  assert.equal(f.check.ok, true, `the default rooms fit as asked: ${f.check.reasons.join(' | ')}`)
  assert.deepEqual([f.program.beds, f.program.baths, f.program.halfBath, f.program.office, f.program.garage, f.program.sqft], [4, 3, true, true, 2, 2800])
  const fp = footprint(f.rooms)
  console.log(`  Kerria: ${f.plan} plan, ${fp.w.toFixed(1)} x ${fp.d.toFixed(1)} ft, depth/width ${fp.ratio.toFixed(2)}`)
  assert.ok(fp.ratio >= 1.3 && fp.ratio <= 1.8, `depth/width ${fp.ratio.toFixed(2)} (${fp.w.toFixed(1)} x ${fp.d.toFixed(1)})`)
  assert.ok(fp.w >= 45, `${fp.w.toFixed(1)} ft wide: the lot's 65 ft is used, not a 40 ft tube`)
})

test('U9 1: the other recorded 60 to 80 ft lots draft the same house, 1.3 to 1.8; the 100 x 150 lot is no strip (its long side under 1.8 times the short)', async () => {
  const lots = await recordedLots()
  for (const name of ['3305 N 27th St', '36 Melissa Dr', '1534 Armagoza Dr', '2218 Royal Palm Dr']) {
    const f = firstDraft(lots[name])
    const fp = footprint(f.rooms)
    assert.ok(fp.ratio >= 1.3 && fp.ratio <= 1.8, `${name}: ${f.plan} ${fp.w.toFixed(1)} x ${fp.d.toFixed(1)} (${fp.ratio.toFixed(2)})`)
  }
  const f = wide()
  const fp = footprint(f.rooms)
  console.log(`  100 x 150: ${f.plan} plan, ${fp.w.toFixed(1)} x ${fp.d.toFixed(1)} ft, depth/width ${fp.ratio.toFixed(2)}`)
  assert.ok(Math.max(fp.w, fp.d) / Math.min(fp.w, fp.d) <= 1.8, `${fp.w.toFixed(1)} x ${fp.d.toFixed(1)}`)
})

// ── 2. the garage ────────────────────────────────────────────────────────────────────────────────────────────
test('U9 2: the garage stands forward of the house or beside it, at most 12 ft ahead of the front wall', async () => {
  for (const f of [await kerria(), wide()]) {
    const rooms = solid(f.rooms)
    const garage = rooms.find((r) => r.kind === 'garage')
    assert.ok(garage, 'a garage')
    const houseFront = Math.max(...rooms.filter((r) => r.kind !== 'garage').map((r) => r.y + r.d))
    const ahead = garage.y + garage.d - houseFront
    assert.ok(ahead >= -0.1 && ahead <= 12.05, `${f.plan}: the garage's face is ${ahead.toFixed(1)} ft ahead of the house`)
    const a = auditPlan(f.rooms, f.program, style.kit, f.lot)
    assert.ok(!a.warnings.some((w) => w.id === 'garage-snout') && !a.errors.length, a.errors.map((e) => e.message).join(' | '))
  }
})

// ── 3. the roof ──────────────────────────────────────────────────────────────────────────────────────────────
const inRing = (ring, x, z, zi) => {
  let c = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) if (ring[i][zi] > z !== ring[j][zi] > z && x < ((ring[j][0] - ring[i][0]) * (z - ring[i][zi])) / (ring[j][zi] - ring[i][zi]) + ring[i][0]) c = !c
  return c
}
const underFace = (f, x, z) => inRing(f.rings[0], x, z, 2) && !f.rings.slice(1).some((hole) => inRing(hole, x, z, 2))
/** The ridges as they show on the visible slopes (round 12's measure): { mass, h, along, at, runs, length }. */
function ridges(sheets, slopes) {
  return [...new Set(sheets.filter((s) => s.ridge).map((s) => s.mass))].map((mass) => {
    const { along, at, h } = sheets.find((s) => s.mass === mass && s.ridge).ridge
    const runs = []
    slopes.filter((f) => f.mass === mass).forEach((f) => {
      const ring = f.rings[0]
      ring.forEach((P, i) => {
        const Q = ring[(i + 1) % ring.length]
        const onTop = Math.abs(P[1] - h) < 0.06 && Math.abs(Q[1] - h) < 0.06
        const onLine = along === 'x' ? Math.abs(P[2] - at) < 0.06 && Math.abs(Q[2] - at) < 0.06 : Math.abs(P[0] - at) < 0.06 && Math.abs(Q[0] - at) < 0.06
        if (onTop && onLine) runs.push(along === 'x' ? [Math.min(P[0], Q[0]), Math.max(P[0], Q[0])] : [Math.min(P[2], Q[2]), Math.max(P[2], Q[2])])
      })
    })
    runs.sort((a, b) => a[0] - b[0])
    const merged = []
    runs.forEach((r) => {
      const last = merged[merged.length - 1]
      if (last && r[0] <= last[1] + 0.05) last[1] = Math.max(last[1], r[1])
      else merged.push([...r])
    })
    return { mass, h, along, at, runs: merged, length: merged.reduce((a, r) => a + r[1] - r[0], 0) }
  }).filter((r) => r.length > 0.5)
}
function roofOf(f) {
  const roof = f.rooms.find((r) => r.kind === 'roof')
  const { sheets } = roofSheets(roof.masses, roof.scale || 1, roof.centre, roof.offset)
  const slopes = roof.faces.filter((x) => x.kind === 'slope')
  return { roof, sheets, slopes, ridges: ridges(sheets, slopes) }
}

test('U9 3: on Kerria the main roof is a hip, its ridge the highest and the longest, and lower roofs carry ridges of their own (a broken ridge line, not one slab)', async () => {
  const { sheets, ridges: rs } = roofOf(await kerria())
  const main = sheets.filter((s) => s.main)
  assert.equal(new Set(main.map((s) => s.mass)).size, 1, 'one main roof')
  const mass = main[0].mass
  assert.ok(sheets.some((s) => s.mass === mass && s.hip), 'the main roof closes with hips, not gable ends')
  const top = rs.find((r) => r.mass === mass)
  const others = rs.filter((r) => r !== top)
  assert.ok(others.length >= 2, `${others.length} other ridges`)
  for (const r of others) {
    assert.ok(r.h < top.h - 1, `${r.mass} at ${r.h.toFixed(1)} ft against the main ridge at ${top.h.toFixed(1)}`)
    assert.ok(r.length < top.length, `${r.mass}'s ridge ${r.length.toFixed(1)} ft against the main ridge's ${top.length.toFixed(1)}`)
  }
  assert.ok(rs.length >= 3 && new Set(rs.map((r) => r.h.toFixed(0))).size >= 2, `ridges at ${rs.map((r) => r.h.toFixed(1)).join(', ')} ft`)
  console.log(`  Kerria roof: ${rs.map((r) => `${r.mass} ridge ${r.length.toFixed(1)} ft at ${r.h.toFixed(1)} ft`).join('; ')}`)
})

test('U9 3: every room is under the roof and no two ridges of different roofs cross at one height (Kerria and 100 x 150)', async () => {
  for (const f of [await kerria(), wide()]) {
    const { slopes, ridges: rs } = roofOf(f)
    const bare = []
    f.rooms.filter((r) => isRoom(r) && !r.open && r.local).forEach((r) => {
      for (let x = -r.w / 2 + 1; x < r.w / 2; x += 2) for (let z = -r.d / 2 + 1; z < r.d / 2; z += 2) if (!slopes.some((s) => underFace(s, r.local[0] + x, r.local[1] + z))) bare.push(`${r.name} at ${x.toFixed(0)},${z.toFixed(0)}`)
    })
    assert.deepEqual(bare, [], `${f.plan}: rooms with no roof over them`)
    const seg = (r) => r.runs.map(([a, b]) => (r.along === 'x' ? { a: [a, r.at], b: [b, r.at], h: r.h, mass: r.mass } : { a: [r.at, a], b: [r.at, b], h: r.h, mass: r.mass }))
    const all = rs.flatMap(seg)
    const side = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]))
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      const [p, q] = [all[i], all[j]]
      if (p.mass === q.mass || Math.abs(p.h - q.h) > 1) continue
      const cross = side(p.a, p.b, q.a) * side(p.a, p.b, q.b) < 0 && side(q.a, q.b, p.a) * side(q.a, q.b, p.b) < 0
      assert.ok(!cross, `${p.mass} and ${q.mass} cross`)
    }
    assert.ok(rs.length >= 2, `${f.plan}: ${rs.length} ridges`)
  }
})

test('U9 3: the 3D roof is a light shingle, not one dark slab (the porch and awning metal is the darker accent)', () => {
  const src = fs.readFileSync('src/draft/HouseScene.jsx', 'utf8')
  const hex = (name) => (src.match(new RegExp(`const ${name} = '#([0-9a-f]{6})'`, 'i')) || [])[1]
  const lum = (h) => {
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const shingles = hex('SHINGLES')
  assert.ok(shingles, 'the shingle colour is a constant')
  assert.ok(lum(shingles) >= 0.2, `#${shingles} has a luminance of ${lum(shingles).toFixed(2)} (round 14's #4a4541 is 0.06)`)
  const metal = hex('METAL')
  assert.ok(metal && lum(metal) < lum(shingles), 'the metal is darker than the shingles')
})

// ── 4. windows by room ───────────────────────────────────────────────────────────────────────────────────────
test('U9 4: windows are sized by room, not one window repeated: the family rooms\' widest, the kitchen\'s over the counter, the baths\' small (Kerria and 100 x 150)', async () => {
  for (const f of [await kerria(), wide()]) {
    const rooms = f.rooms.filter(isRoom)
    const kindOf = (w) => rooms.find((r) => r.id === w.room)?.kind
    const wins = f.rooms.filter((e) => e.kind === 'window' && !e.dormer)
    const of = (...kinds) => wins.filter((w) => kinds.includes(kindOf(w)))
    const sill = (w) => w.sill ?? WINDOW_SILL[w.mark] ?? 2
    const bed = of('bed', 'master')
    const family = of('living', 'foyer', 'dining')
    const kitchen = of('kitchen')
    const bath = of('bath', 'mbath', 'jackjill', 'halfbath')
    assert.ok(bed.length && family.length && kitchen.length && bath.length, `${f.plan}: windows in every kind`)
    const widest = (list) => Math.max(...list.map((w) => w.span))
    assert.ok(widest(family) > widest(bed) + 0.4, `${f.plan}: the family rooms' widest window ${widest(family)} ft against a bedroom's ${widest(bed)} ft`)
    assert.ok(kitchen.every((w) => sill(w) > Math.max(...bed.map(sill)) + 0.5), `${f.plan}: the kitchen window sits over the counter`)
    assert.ok(widest(bath) < Math.min(...bed.map((w) => w.span)), `${f.plan}: bath windows smaller than any bedroom's`)
    const widths = new Set([...bed, ...family, ...kitchen, ...bath].map((w) => w.span.toFixed(1)))
    assert.ok(widths.size >= 4, `${f.plan}: ${[...widths].join(', ')} ft`)
    // every bedroom still has its egress window (the audit's rule)
    const a = auditPlan(f.rooms, f.program, style.kit, f.lot)
    assert.ok(!a.errors.some((e) => e.id === 'egress' || e.id === 'window'), a.errors.map((e) => e.message).join(' | '))
  }
})

// ── 5. the porch ─────────────────────────────────────────────────────────────────────────────────────────────
test('U9 5: a covered porch at the front, the front door on it (Kerria and 100 x 150)', async () => {
  for (const f of [await kerria(), wide()]) {
    const porch = f.rooms.find((r) => isRoom(r) && r.kind === 'frontPorch')
    assert.ok(porch, `${f.plan}: a front porch`)
    // nothing of the house stands in front of it
    assert.ok(!solid(f.rooms).some((r) => r.x < porch.x + porch.w - 0.1 && r.x + r.w > porch.x + 0.1 && r.y >= porch.y + porch.d - 0.1), `${f.plan}: the porch is at the street side`)
    const door = f.rooms.find((e) => e.kind === 'door' && e.exterior && e.axis === 'h' && Math.abs(e.y + e.d / 2 - porch.y) < 0.5 && e.x + e.w / 2 > porch.x && e.x + e.w / 2 < porch.x + porch.w && e.size !== 'overhead')
    assert.ok(door, `${f.plan}: the front door opens onto the porch`)
    const roof = f.rooms.find((r) => r.kind === 'roof')
    assert.ok(roof.masses.some((m) => m.id === 'frontPorch'), `${f.plan}: the porch has its own roof`)
  }
})

// ── 6. the plan's labels at 100% ─────────────────────────────────────────────────────────────────────────────
// The Draft screen's plan frame at 1440 x 900 is 1020 x 844 px (measured in the built app: the viewport beside the
// chat); the drawing fits it at 96% (PlanDrawing), and the labels are drawn for that scale.
const FRAME = { w: 1020, h: 844 }
// the main rooms: the bedrooms, the family rooms, the garage and the porch, 120 sf and up
const MAIN = ['bed', 'master', 'living', 'kitchen', 'dining', 'garage', 'office', 'foyer', 'frontPorch']
function labelsAt100(f, sized = true) {
  const design = buildDesign({ rooms: f.rooms, program: f.program, style, lot: f.lot, client: 'Test' })
  // what PlanDrawing draws in that frame (round 14 drew planSVG(design) whatever the frame)
  const plan = sized ? planForFrame(design, FRAME) : planSVG(design)
  // the scale on the screen is the final drawing's
  const shown = fitScale(FRAME, plan.width, plan.height)
  const main = (id) => { const r = design.rooms.find((x) => x.id === id); return !!r && MAIN.includes(r.kind) && r.w * r.d >= 120 }
  return { plan, shown, main }
}
test('U9 6: in the plan view at 100% (1440 x 900) room names are 12 px or more on the main rooms and 10 px on every room that holds its label; sizes 10 px or more', async () => {
  for (const f of [await kerria(), wide()]) {
    const { plan, shown, main } = labelsAt100(f)
    const px = (l) => l.font * shown
    for (const l of plan.labels) {
      if (l.leader) continue
      assert.ok(px(l) >= 10 - 0.05, `${f.plan}: ${l.text} at ${px(l).toFixed(1)} px`)
      if (main(l.id)) {
        assert.ok(px(l) >= 12 - 0.05, `${f.plan}: ${l.text} at ${px(l).toFixed(1)} px`)
        assert.match(l.text, /\d+'(-\d+")? × \d+'/, `${f.plan}: ${l.text} carries its size`)
        assert.ok(px(l) * 0.85 >= 10 - 0.05, `${f.plan}: the size under ${l.text} at ${(px(l) * 0.85).toFixed(1)} px`)
      }
    }
    // the leaders are few: the small rooms crowded with fixtures only
    assert.ok(plan.labels.filter((l) => l.leader).length <= 4, plan.labels.filter((l) => l.leader).map((l) => l.text).join(', '))
    const sizes = plan.labels.filter((l) => !l.leader).map(px)
    console.log(`  ${f.plan} plan labels at 100%: ${Math.min(...sizes).toFixed(1)} to ${Math.max(...sizes).toFixed(1)} px (round 14: ${(9 * labelsAt100(f, false).shown).toFixed(1)} px)`)
    // no two labels overlap
    const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
    for (let i = 0; i < plan.labels.length; i++) for (let j = i + 1; j < plan.labels.length; j++) assert.ok(!hit(plan.labels[i], plan.labels[j]), `${plan.labels[i].text} and ${plan.labels[j].text} overlap`)
  }
})

test('U9: the default program is the one the rooms step starts from', () => {
  assert.deepEqual([DEFAULT_PROGRAM.beds, DEFAULT_PROGRAM.baths, DEFAULT_PROGRAM.halfBath, DEFAULT_PROGRAM.office, DEFAULT_PROGRAM.garage, DEFAULT_PROGRAM.sqft], [4, 3, true, true, 2, 2800])
})
