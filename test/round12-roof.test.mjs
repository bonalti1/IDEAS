// Round 12, item 7c: one main roof. The architect's review of round 11: "The default 2,800 sf plan still reads as
// many separate roofs with crossing ridges and a gap over the foyer. The next step is a single main ridge with wings
// tying into it." On the default plan, the 3/2 at 1,800 sf and the 5/4 3-car at 3,500 sf:
//   a  exactly one pair of sheets is the main roof, and its ridge is the highest and the longest
//   b  no enclosed room has plan area with no roof over it (a 2 ft grid inside every room)
//   c  no two ridges of different roofs cross in plan at heights within 1 ft of each other
//   d  the round 11 ends still hold (a hip, a listed gable, or a run-in under a higher roof), and a run-in stops
//      where its ridge meets the higher roof
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateRooms, DEFAULT_PROGRAM, isRoom, kitFor } from '../src/draft/lib/layout.js'
import { roofSheets, roofSurfaces } from '../src/draft/lib/roof.js'
import { STYLES } from '../src/draft/lib/styles.js'
import { buildLot } from '../src/draft/lib/lot.js'

const style = STYLES.find((s) => s.id === 'farmhouse')
const kit = kitFor(style)
const lot = buildLot({ kind: 'manual', width: 100, depth: 150, city: 'mcallen', setbacks: {} })
const PROGRAMS = {
  '4/3.5 2,800 (the default)': { ...DEFAULT_PROGRAM },
  '3/2 1,800': { ...DEFAULT_PROGRAM, beds: 3, baths: 2, halfBath: false, office: false, garage: 0, sqft: 1800 },
  '5/4 3-car 3,500': { ...DEFAULT_PROGRAM, beds: 5, baths: 4, halfBath: false, office: true, garage: 3, sqft: 3500 },
}

const inRing = (ring, x, z, zi) => {
  let c = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    if (ring[i][zi] > z !== ring[j][zi] > z && x < ((ring[j][0] - ring[i][0]) * (z - ring[i][zi])) / (ring[j][zi] - ring[i][zi]) + ring[i][0]) c = !c
  }
  return c
}
/** Is the plan point inside a sheet's footprint (a MultiPolygon of [x, z] rings)? */
const inFootprint = (fp, x, z) => fp.some((poly) => inRing(poly[0], x, z, 1) && !poly.slice(1).some((hole) => inRing(hole, x, z, 1)))
/** Is the plan point under a visible face (rings of [x, y, z])? */
const underFace = (f, x, z) => inRing(f.rings[0], x, z, 2) && !f.rings.slice(1).some((hole) => inRing(hole, x, z, 2))

/** The house of a program: its rooms, its roof, the sheets and the visible slopes. */
function house(program) {
  const rooms = generateRooms(program, style, lot)
  const roof = rooms.find((r) => r.kind === 'roof')
  const { sheets, ends } = roofSheets(roof.masses, roof.scale || 1, roof.centre, roof.offset)
  const slopes = roof.faces.filter((f) => f.kind === 'slope')
  return { rooms, roof, sheets, ends, slopes }
}

/**
 * The ridges as they show: for every gable (a mass with two sheets that carry a ridge), the edges of its visible
 * slopes that lie at its top. Measured on the faces, not read from the sheet, so a ridge hidden under a higher
 * roof does not count. Each: { mass, h, along: 'x' | 'z', at, runs: [[t0, t1], ...], length }.
 */
function ridges(sheets, slopes) {
  const gables = [...new Set(sheets.filter((s) => s.ridge).map((s) => s.mass))]
  return gables.map((mass) => {
    const { along, at, h } = sheets.find((s) => s.mass === mass && s.ridge).ridge
    const runs = []
    slopes.filter((f) => f.mass === mass).forEach((f) => {
      const ring = f.rings[0]
      ring.forEach((P, i) => {
        const Q = ring[(i + 1) % ring.length]
        const onTop = Math.abs(P[1] - h) < 0.06 && Math.abs(Q[1] - h) < 0.06
        const onLine = along === 'x' ? Math.abs(P[2] - at) < 0.06 && Math.abs(Q[2] - at) < 0.06 : Math.abs(P[0] - at) < 0.06 && Math.abs(Q[0] - at) < 0.06
        if (!onTop || !onLine) return
        const t = along === 'x' ? [P[0], Q[0]] : [P[2], Q[2]]
        runs.push([Math.min(...t), Math.max(...t)])
      })
    })
    // the two sides share the ridge: merge what overlaps
    runs.sort((a, b) => a[0] - b[0])
    const merged = []
    runs.forEach((r) => {
      const last = merged[merged.length - 1]
      if (last && r[0] <= last[1] + 0.05) last[1] = Math.max(last[1], r[1])
      else merged.push([...r])
    })
    return { mass, h, along, at, runs: merged, length: merged.reduce((a, r) => a + r[1] - r[0], 0) }
  })
}

for (const [name, program] of Object.entries(PROGRAMS)) {
  test(`7c ${name}: one pair of sheets is the main roof, and its ridge is the highest and the longest`, () => {
    const { roof, sheets, slopes } = house(program)
    const main = sheets.filter((s) => s.main)
    assert.equal(main.length, 2, `the main roof is ${main.map((s) => s.id).join(', ')}`)
    assert.equal(new Set(main.map((s) => s.mass)).size, 1, 'both sides of one mass')
    assert.ok(main.every((s) => s.kind === 'slope' && !s.hip && s.ridge))
    // one ridge, the two sides mirror each other about it: both eaves at one height (the kit's 14 ft entry plate is gone)
    const [a, b] = main
    assert.ok(Math.abs(a.plane.a + b.plane.a) < 1e-9 && Math.abs(a.plane.b + b.plane.b) < 1e-9, 'one pitch both ways')
    const mass = roof.masses.find((m) => m.id === main[0].mass)
    assert.ok(mass && mass.kind === 'gable')
    const all = ridges(sheets, slopes)
    const mine = all.find((r) => r.mass === main[0].mass)
    assert.equal(mine.runs.length, 1, `the main ridge shows as one line, not ${mine.runs.length}`)
    for (const r of all) {
      if (r === mine) continue
      assert.ok(r.h < mine.h - 1, `${r.mass} peaks at ${r.h.toFixed(1)} ft, the main ridge at ${mine.h.toFixed(1)} ft`)
      assert.ok(r.length < mine.length, `${r.mass}'s ridge shows for ${r.length.toFixed(1)} ft, the main ridge for ${mine.length.toFixed(1)} ft`)
    }
    // the highest point of the whole roof is on the main ridge
    const top = Math.max(...slopes.flatMap((f) => f.rings[0].map((p) => p[1])))
    assert.ok(top <= mine.h + 0.1, `something reaches ${top.toFixed(1)} ft, above the main ridge at ${mine.h.toFixed(1)} ft`)
    console.log(`  ${name}: main ridge ${mine.length.toFixed(1)} ft long at ${mine.h.toFixed(1)} ft; ${all.filter((r) => r !== mine).map((r) => `${r.mass} ${r.h.toFixed(1)}`).join(', ')}`)
  })

  test(`7c ${name}: every enclosed room is under a roof (a 2 ft grid inside each room)`, () => {
    const { rooms, sheets, slopes } = house(program)
    const covering = sheets.filter((s) => s.kind === 'slope')
    let points = 0
    for (const r of rooms.filter((x) => isRoom(x) && !x.open)) {
      const xs = []
      const zs = []
      for (let x = r.local[0] - r.w / 2 + 1; x < r.local[0] + r.w / 2 - 0.5; x += 2) xs.push(x)
      for (let z = r.local[1] - r.d / 2 + 1; z < r.local[1] + r.d / 2 - 0.5; z += 2) zs.push(z)
      // and the four corners, a foot in: a bump-out's far corner is where a roof stops short
      xs.push(r.local[0] + r.w / 2 - 1)
      zs.push(r.local[1] + r.d / 2 - 1)
      for (const x of xs)
        for (const z of zs) {
          points++
          assert.ok(covering.some((s) => inFootprint(s.footprint, x, z)), `${r.name}: no roof sheet over (${x.toFixed(1)}, ${z.toFixed(1)})`)
          // and what shows there is a roof above the walls, not a hole between two faces
          const h = Math.max(-Infinity, ...slopes.filter((f) => underFace(f, x, z)).map((f) => f.plane.a * x + f.plane.b * z + f.plane.c))
          assert.ok(h > 8, `${r.name}: the roof over (${x.toFixed(1)}, ${z.toFixed(1)}) is at ${h} ft`)
        }
    }
    assert.ok(points > 300, `${points} points`)
  })

  test(`7c ${name}: no two ridges of different roofs cross at heights within 1 ft of each other`, () => {
    const { sheets, slopes } = house(program)
    const all = ridges(sheets, slopes)
    const segs = all.flatMap((r) => r.runs.map(([t0, t1]) => ({ mass: r.mass, h: r.h, a: r.along === 'x' ? [t0, r.at] : [r.at, t0], b: r.along === 'x' ? [t1, r.at] : [r.at, t1] })))
    assert.ok(segs.length >= 2)
    const side = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
    // a crossing: each runs on at least 3 in past the other (a ridge that ends on another one is a tie-in, not a crossing)
    const shrink = (s) => {
      const len = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1])
      if (len < 0.6) return null
      const u = [(s.b[0] - s.a[0]) / len, (s.b[1] - s.a[1]) / len]
      return { a: [s.a[0] + u[0] * 0.25, s.a[1] + u[1] * 0.25], b: [s.b[0] - u[0] * 0.25, s.b[1] - u[1] * 0.25] }
    }
    for (let i = 0; i < segs.length; i++)
      for (let j = i + 1; j < segs.length; j++) {
        const s = segs[i]
        const t = segs[j]
        if (s.mass === t.mass || Math.abs(s.h - t.h) > 1) continue
        const p = shrink(s)
        const q = shrink(t)
        if (!p || !q) continue
        const cross = side(p.a, p.b, q.a) * side(p.a, p.b, q.b) < 0 && side(q.a, q.b, p.a) * side(q.a, q.b, p.b) < 0
        assert.ok(!cross, `${s.mass} (${s.h.toFixed(1)} ft) and ${t.mass} (${t.h.toFixed(1)} ft) cross`)
      }
  })

  test(`7c ${name}: a wing that runs in under the main roof stops where its ridge meets it (it showed again on the far slope)`, () => {
    const { roof, sheets, slopes } = house(program)
    const mainSheet = sheets.find((s) => s.main)
    const { along, at } = mainSheet.ridge
    const k = roof.scale || 1
    const local = (m) => {
      const c = along === 'x' ? 1 : 0
      const f = (v) => roof.centre[c] + (v - roof.centre[c]) * k + (roof.offset?.[c] || 0) - roof.centre[c]
      return along === 'x' ? [f(m.y0), f(m.y1)] : [f(m.x0), f(m.x1)]
    }
    let wings = 0
    for (const m of roof.masses.filter((x) => x.kind === 'gable' && x.id !== mainSheet.mass)) {
      const [lo, hi] = local(m)
      // a wing that stands wholly on one side of the main ridge shows on that side only
      const sideOf = lo >= at - 0.01 ? 1 : hi <= at + 0.01 ? -1 : 0
      if (!sideOf) continue
      wings++
      for (const f of slopes.filter((x) => x.mass === m.id))
        for (const p of f.rings[0]) {
          const v = along === 'x' ? p[2] : p[0]
          assert.ok((v - at) * sideOf > -0.5, `${m.id} shows ${Math.abs(v - at).toFixed(1)} ft past the main ridge`)
        }
    }
    assert.ok(wings >= 2, `${wings} wings on one side of the main ridge`)
  })
}

test('7c the default plan: the wings tie into the main roof, the foyer is closed, and the round 11 ends still hold', () => {
  const { rooms, roof, sheets, ends, slopes } = house(DEFAULT_PROGRAM)
  const ids = sheets.map((s) => s.id)
  // the main roof is one face each side of the ridge at the back; the dormer over the entry parts the street side in two
  assert.equal(slopes.filter((f) => f.id === 'main-a').length, 1)
  assert.ok(slopes.filter((f) => f.id === 'main-b').length <= 2)
  // nothing is cut out of it any more: the gables in front of it meet it in valleys
  const main = sheets.filter((s) => s.main)
  assert.ok(main.every((s) => s.footprint.every((poly) => poly.length === 1)), 'no hole in a main sheet')
  assert.ok(!roof.faces.some((f) => /-notch$/.test(f.id)), 'no notch wall: no cut-out')
  // the garage, the primary suite and the two gables by the porch run in under the main roof: each ends in a wall
  // triangle at its own wall, which the main roof hides where it covers it (round 11), and none of them in a hip
  for (const id of ['garage', 'master', 'office', 'frontgable']) {
    assert.ok(ends.filter((e) => e.mass === id).length === 2, `${id}: a gable end and a run-in`)
    assert.ok(!ids.some((s) => s.startsWith(id + '-hip-')), `${id} has no hip`)
    // a valley: its visible roof reaches the main roof's surface (a vertex on both planes)
    const onMain = slopes.filter((f) => f.mass === id).flatMap((f) => f.rings[0]).filter(([x, y, z]) => main.some((s) => Math.abs(s.plane.a * x + s.plane.b * z + s.plane.c - y) < 0.05 && inFootprint(s.footprint, x, z)))
    assert.ok(onMain.length >= 1, `${id} meets the main roof`)
  }
  // the listed gable ends are all still there, and the left wing still closes with its hip (round 11)
  for (const id of ['main', 'leftwing', 'bedwing', 'office', 'frontgable', 'master', 'garage']) assert.ok(ends.some((e) => e.mass === id), id)
  assert.ok(ids.includes('leftwing-hip-start'))
  // the gap over the foyer: the main roof's street eave was at 14 ft over 10 ft walls, and the dormer's face began
  // at 13 ft. The eave is on the walls now, and the dormer's face stands on the roof
  const foyer = rooms.find((r) => r.id === 'foyer')
  const front = foyer.local[1] + foyer.d / 2
  const wallTop = kit.plates.byRoom.foyer || kit.plates.default
  const eaveAtWall = Math.min(...main.map((s) => s.plane.a * foyer.local[0] + s.plane.b * front + s.plane.c))
  assert.ok(eaveAtWall <= wallTop + 0.01, `the main roof is at ${eaveAtWall.toFixed(1)} ft over the foyer's ${wallTop} ft front wall`)
  assert.equal(roof.dormers.length, 1)
  assert.ok(roof.dormers[0].base <= wallTop + 0.01, `the dormer's face starts at ${roof.dormers[0].base} ft`)
  // the dormer's roof springs from the main ridge: it does not float over it or stop short in the air
  const dormer = slopes.filter((f) => f.mass === 'dormer')
  const ridgeH = main[0].ridge.h
  const dTop = Math.max(...dormer.flatMap((f) => f.rings[0].map((p) => p[1])))
  assert.ok(dTop <= ridgeH + 0.1 && dTop > ridgeH - 0.5, `the dormer tops out at ${dTop.toFixed(1)} ft, the ridge is at ${ridgeH.toFixed(1)} ft`)
  // its cheeks stop at the roof (they ran 40 ft up when nothing met the dormer's roof behind it)
  const cheeks = roof.faces.filter((f) => f.id === 'dormer-cheek')
  assert.equal(cheeks.length, 2)
  assert.ok(Math.max(...cheeks.flatMap((f) => f.rings[0].map((p) => p[1]))) <= ridgeH + 0.1)
})

test('7c the 1,800 sf plan: the mud room\'s bump-out behind the main roof has a lean-to of its own', () => {
  const { rooms, roof } = house(PROGRAMS['3/2 1,800'])
  const mud = rooms.find((r) => r.id === 'mud')
  const lean = roof.masses.find((m) => m.id === 'mud')
  assert.ok(mud && lean, 'a mass for the mud room')
  assert.equal(lean.kind, 'shed')
  assert.equal(lean.high, 's', 'high against the main roof')
  assert.ok(roof.faces.some((f) => f.mass === 'mud' && f.kind === 'slope'), 'and it shows')
  // a plan with no such room part gets none
  const def = house(DEFAULT_PROGRAM)
  assert.ok(!def.roof.masses.some((m) => m.kind === 'shed' && !/^awning-|Porch$/.test(m.id)), 'no lean-to on the default plan')
})

test('7c the masses the plan stores are the kit\'s own: the one main roof is how they are drawn, and the same masses give the same roof', () => {
  const { roof } = house(DEFAULT_PROGRAM)
  const main = roof.masses.find((m) => m.id === 'main')
  assert.equal(main.plate2, 14, 'the stored mass keeps the kit\'s plates')
  assert.ok(main.cuts.length >= 1)
  const args = [roof.masses, roof.scale || 1, roof.centre, roof.offset || [0, 0]]
  assert.deepEqual(roofSurfaces(...args), roof.faces)
  assert.equal(roofSheets(...args), roofSheets(...args), 'kept: the same answer object for the same masses')
})
