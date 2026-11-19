// Roof masses → planar sheets → visible surfaces with real valleys and hips.
// Every roof plane only shows where it is the highest surface. The line
// where two planes meet is the valley or hip. Computed with polygon clipping
// in plan, then lifted onto each plane. Shared by the app scene, the viewer
// export, and the IFC writer. Plan feet in, local feet out (x along the
// front, y up, z toward the street).
import polygonClipping from 'polygon-clipping'

const OVERHANG = 1.33
const EPS = 0.02
// a roof that dies into a neighbour runs on under it until the planes meet (the valley)
const RUN_INTO = 20
// MultiPolygon with one ring, the shape polygon-clipping works with
const rect = (x0, z0, x1, z1) => [
  [
    [
      [x0, z0],
      [x1, z0],
      [x1, z1],
      [x0, z1],
      [x0, z0],
    ],
  ],
]

/** Scale a plan rectangle about the plan centre, shift it (plan feet), and move to local coords. */
function local(m, k, centre, offset = [0, 0]) {
  const sx = (v) => centre[0] + (v - centre[0]) * k + offset[0] - centre[0]
  const sz = (v) => centre[1] + (v - centre[1]) * k + offset[1] - centre[1]
  return { x0: sx(m.x0), x1: sx(m.x1), z0: sz(m.y0 ?? m.face), z1: sz(m.y1 ?? m.face), face: m.face !== undefined ? sz(m.face) : undefined, cuts: (m.cuts || []).map((c) => ({ x0: sx(c.x0), x1: sx(c.x1), z0: sz(c.y0), z1: sz(c.y1) })) }
}

/** A gable mass in local feet: across the ridge it runs lo..hi with the ridge at r (height hr); along it, wall w0..w1. */
function gableGeo(m, L, oh) {
  const ew = m.ridge === 'ew'
  const s = m.pitch / 12
  const plateA = m.plate // near side: north for ew, west for ns
  const plateB = m.plate2 ?? m.plate // far side: south for ew, east for ns
  const lo = ew ? L.z0 : L.x0
  const hi = ew ? L.z1 : L.x1
  // ridge position from the two eave heights
  const r = (plateB - plateA) / (2 * s) + (lo + hi) / 2
  const hr = plateA + (r - lo) * s
  return { m, L, oh, ew, s, plateA, plateB, lo, hi, r, hr, w0: ew ? L.x0 : L.z0, w1: ew ? L.x1 : L.z1 }
}
/** The height of a gable roof at a plan point inside its own walls and overhangs (not in a cut-out), else -Infinity. */
function heightOnGable(g, x, z) {
  const u = g.ew ? z : x
  const t = g.ew ? x : z
  if (u < g.lo - g.oh || u > g.hi + g.oh || t < g.w0 - g.oh || t > g.w1 + g.oh) return -Infinity
  if (g.L.cuts.some((c) => x > c.x0 && x < c.x1 && z > c.z0 && z < c.z1)) return -Infinity
  return Math.min(g.plateA + (u - g.lo) * g.s, g.plateB + (g.hi - u) * g.s)
}

/**
 * Sheets: { id, mass, kind, plane: {a, b, c} with h = a x + b z + c,
 * footprint: MultiPolygon in plan, edges: outer eave/rake lines for fascia,
 * material }. Ends: vertical gable triangles { id, mass, kind: 'end', axis, at, tri }.
 */
export function roofSheets(masses, k, centre, offset = [0, 0]) {
  const sheets = []
  const ends = []
  const cutEdges = [] // { mass, a: [x, z], b: [x, z], out: [nx, nz] } edges of cut-outs, normal pointing into the remaining roof
  // every gable's own geometry first: an end of one roof is decided by the roofs around it
  const geos = masses.map((m) => (m.kind === 'gable' ? gableGeo(m, local(m, k, centre, offset), m.overhang ?? OVERHANG) : null))
  masses.forEach((m) => {
    const L = local(m, k, centre, offset)
    L.cuts.forEach((c) => {
      cutEdges.push({ mass: m.id, a: [c.x0, c.z0], b: [c.x1, c.z0], out: [0, -1] })
      cutEdges.push({ mass: m.id, a: [c.x0, c.z0], b: [c.x0, c.z1], out: [-1, 0] })
      cutEdges.push({ mass: m.id, a: [c.x1, c.z0], b: [c.x1, c.z1], out: [1, 0] })
      cutEdges.push({ mass: m.id, a: [c.x0, c.z1], b: [c.x1, c.z1], out: [0, 1] })
    })
    const oh = m.overhang ?? OVERHANG
    const s = m.pitch / 12
    const mat = m.material || 'shingles'
    const cut = (poly) => (L.cuts.length ? polygonClipping.difference(poly, ...L.cuts.map((c) => rect(c.x0, c.z0, c.x1, c.z1))) : poly)
    if (m.kind === 'gable') {
      const g = gableGeo(m, L, oh)
      const { ew, lo, hi, r, hr, plateA, plateB, w0, w1 } = g
      const endsList = m.ends || []
      // each end of the ridge is one of three things (round 11, item 7):
      //   'gable'  a listed gable end: the roof stops at the wall with its overhang and a vertical triangle
      //   'dies'   the ridge runs on and meets a roof that is as high or higher within 20 ft: the roof runs in under
      //            it, but only over other roofs (it used to run 20 ft on over open ground and lower roofs too), and
      //            a triangle at its own wall closes whatever stays exposed
      //   'hip'    nothing higher to meet: the end is closed with a hip, never left as a cut 20 ft out
      const others = geos.filter((o) => o && o.m !== m)
      const kindOf = (which) => {
        if (endsList.includes(which === 'start' ? (ew ? 'w' : 'n') : ew ? 'e' : 's')) return 'gable'
        for (let d = 0.5; d <= RUN_INTO; d += 0.5) {
          const t = which === 'start' ? w0 - d : w1 + d
          const [x, z] = ew ? [t, r] : [r, t]
          if (others.some((o) => heightOnGable(o, x, z) >= hr - 0.05)) return 'dies'
        }
        return 'hip'
      }
      const kStart = kindOf('start')
      const kEnd = kindOf('end')
      const pH = Math.min(plateA, plateB)
      const dA = (plateA - pH) / s
      const dB = (plateB - pH) / s
      const tApex = (hi - lo + dA + dB) / 2 // how far in from its eave a hip reaches the ridge
      const uApex = (lo + hi + dB - dA) / 2
      // a hip's eave sits at the wall; on a wing shallower than its own half span it moves out (at most the run-in)
      // so that 4 ft of ridge stay behind the gable at the other end
      let eStart = w0
      let eEnd = w1
      if (kStart === 'hip' && kEnd === 'gable') eStart = Math.max(w0 - RUN_INTO, Math.min(w0, w1 - 4 - tApex))
      if (kEnd === 'hip' && kStart === 'gable') eEnd = Math.min(w1 + RUN_INTO, Math.max(w1, w0 + 4 + tApex))
      const a0 = kStart === 'gable' ? w0 - oh : kStart === 'hip' ? eStart - oh : w0
      const a1 = kEnd === 'gable' ? w1 + oh : kEnd === 'hip' ? eEnd + oh : w1
      // plan rectangles in (across u, along t) → world
      const R = (u0, u1, t0, t1) => (ew ? rect(t0, u0, t1, u1) : rect(u0, t0, u1, t1))
      const P = (u, t) => (ew ? [t, u] : [u, t])
      let sideA = R(lo - oh, r, a0, a1)
      let sideB = R(r, hi + oh, a0, a1)
      // the run-in under a higher roof: only where another roof's own footprint is
      const othersPlan = others.map((o) => rect(o.L.x0 - o.oh, o.L.z0 - o.oh, o.L.x1 + o.oh, o.L.z1 + o.oh))
      const runIn = (side, t0, t1) => {
        if (!othersPlan.length) return side
        try {
          const ext = polygonClipping.intersection(side === 'A' ? R(lo - oh, r, t0, t1) : R(r, hi + oh, t0, t1), polygonClipping.union(...othersPlan))
          return ext
        } catch (e) {
          return []
        }
      }
      const join = (base, extra) => {
        if (!extra || !extra.length) return base
        try {
          return polygonClipping.union(base, extra)
        } catch (e) {
          return base
        }
      }
      if (kStart === 'dies') {
        sideA = join(sideA, runIn('A', w0 - RUN_INTO, w0))
        sideB = join(sideB, runIn('B', w0 - RUN_INTO, w0))
      }
      if (kEnd === 'dies') {
        sideA = join(sideA, runIn('A', w1, w1 + RUN_INTO))
        sideB = join(sideB, runIn('B', w1, w1 + RUN_INTO))
      }
      const planeA = ew ? { a: 0, b: s, c: hr - r * s } : { a: s, b: 0, c: hr - r * s }
      const planeB = ew ? { a: 0, b: -s, c: hr + r * s } : { a: -s, b: 0, c: hr + r * s }
      // hips: the triangle (a pentagon when the two eaves differ) where the hip plane is the lowest of the three
      const hips = []
      const mid = (eStart + eEnd) / 2
      const hipAt = (which) => {
        const e = which === 'start' ? eStart : eEnd
        const dir = which === 'start' ? 1 : -1 // t grows into the roof
        const at = (t) => e + dir * t
        let ring = [P(lo - oh, at(-oh)), P(hi + oh, at(-oh)), ...(dB > 0.01 ? [P(hi + oh, at(-oh + dB))] : []), P(uApex, at(tApex)), ...(dA > 0.01 ? [P(lo - oh, at(-oh + dA))] : [])]
        ring.push(ring[0])
        let poly = [[ring]]
        // two hips on a short roof meet in the middle (a pyramid), neither runs past the other
        if (kStart === 'hip' && kEnd === 'hip') {
          try {
            poly = polygonClipping.intersection(poly, which === 'start' ? R(lo - oh - 1, hi + oh + 1, e - oh - 1, mid) : R(lo - oh - 1, hi + oh + 1, mid, e + oh + 1))
          } catch (err) {}
        }
        const plane = ew ? { a: dir * s, b: 0, c: pH - dir * s * e } : { a: 0, b: dir * s, c: pH - dir * s * e }
        hips.push({ which, poly, plane, eave: at(-oh) })
      }
      if (kStart === 'hip') hipAt('start')
      if (kEnd === 'hip') hipAt('end')
      hips.forEach((h) => {
        try {
          sideA = polygonClipping.difference(sideA, h.poly)
          sideB = polygonClipping.difference(sideB, h.poly)
        } catch (err) {}
      })
      const rakeAxis = ew ? 'x' : 'z'
      const eaveAxis = ew ? 'z' : 'x'
      // the eave edge carries fascia across the roof itself, its overhangs and its hips, not across a run-in
      const eaveSpan = [kStart === 'dies' ? w0 : a0, kEnd === 'dies' ? w1 : a1]
      const edgesA = [{ axis: eaveAxis, at: lo - oh, span: eaveSpan }, kStart === 'gable' && { axis: rakeAxis, at: a0 }, kEnd === 'gable' && { axis: rakeAxis, at: a1 }]
      const edgesB = [{ axis: eaveAxis, at: hi + oh, span: eaveSpan }, kStart === 'gable' && { axis: rakeAxis, at: a0 }, kEnd === 'gable' && { axis: rakeAxis, at: a1 }]
      sheets.push({ id: m.id + '-a', mass: m.id, kind: 'slope', plane: planeA, footprint: cut(sideA), edges: edgesA.filter(Boolean), material: mat })
      sheets.push({ id: m.id + '-b', mass: m.id, kind: 'slope', plane: planeB, footprint: cut(sideB), edges: edgesB.filter(Boolean), material: mat })
      hips.forEach((h) => sheets.push({ id: m.id + '-hip-' + h.which, mass: m.id, kind: 'slope', hip: true, plane: h.plane, footprint: cut(h.poly), edges: [{ axis: rakeAxis, at: h.eave, span: [lo - oh, hi + oh] }], material: mat }))
      // gable end triangles at listed ends; at a run-in end a triangle at the wall itself, which the roofs it runs
      // under hide, so only the part left in the open shows
      const tri = (at, axis, wall = false) => ({
        id: m.id + '-' + axis + at.toFixed(1),
        mass: m.id,
        kind: 'end',
        axis, // 'x' means the end wall is at x = at and runs along z
        at,
        tri: wall
          ? [
              [lo, plateA],
              [r, hr],
              [hi, plateB],
            ]
          : [
              [lo - oh, plateA - oh * s],
              [r, hr],
              [hi + oh, plateB - oh * s],
            ],
      })
      if (kStart === 'gable') ends.push(tri(a0, rakeAxis))
      if (kEnd === 'gable') ends.push(tri(a1, rakeAxis))
      if (kStart === 'dies') ends.push(tri(w0 - 0.03, rakeAxis, true))
      if (kEnd === 'dies') ends.push(tri(w1 + 0.03, rakeAxis, true))
    } else if (m.kind === 'dormer') {
      const top = m.plate
      // plane rises away from the street from the face; extends far enough to die into the main roof
      const depth = m.depth ?? 12
      sheets.push({
        id: m.id,
        mass: m.id,
        kind: 'slope',
        plane: { a: 0, b: -s, c: top + L.face * s },
        footprint: rect(L.x0, L.face - depth, L.x1, L.face + oh),
        edges: [{ axis: 'z', at: L.face + oh }, { axis: 'x', at: L.x0 }, { axis: 'x', at: L.x1 }],
        material: m.material || 'metal roof',
        dormer: { x0: L.x0, x1: L.x1, face: L.face, top, base: m.base ?? 10 },
      })
    } else {
      // shed: high side at the house wall
      const alongX = m.high === 'n' || m.high === 's'
      const depth = alongX ? L.z1 - L.z0 : L.x1 - L.x0
      const highH = m.plate + depth * s
      let plane
      let fp
      let edges
      if (m.high === 'n') {
        plane = { a: 0, b: -s, c: highH + L.z0 * s }
        fp = rect(L.x0 - oh, L.z0, L.x1 + oh, L.z1 + oh)
        edges = [{ axis: 'z', at: L.z1 + oh }, { axis: 'x', at: L.x0 - oh }, { axis: 'x', at: L.x1 + oh }]
      } else if (m.high === 's') {
        plane = { a: 0, b: s, c: highH - L.z1 * s }
        fp = rect(L.x0 - oh, L.z0 - oh, L.x1 + oh, L.z1)
        edges = [{ axis: 'z', at: L.z0 - oh }, { axis: 'x', at: L.x0 - oh }, { axis: 'x', at: L.x1 + oh }]
      } else if (m.high === 'w') {
        plane = { a: -s, b: 0, c: highH + L.x0 * s }
        fp = rect(L.x0, L.z0 - oh, L.x1 + oh, L.z1 + oh)
        edges = [{ axis: 'x', at: L.x1 + oh }, { axis: 'z', at: L.z0 - oh }, { axis: 'z', at: L.z1 + oh }]
      } else {
        plane = { a: s, b: 0, c: highH - L.x1 * s }
        fp = rect(L.x0 - oh, L.z0 - oh, L.x1, L.z1 + oh)
        edges = [{ axis: 'x', at: L.x0 - oh }, { axis: 'z', at: L.z0 - oh }, { axis: 'z', at: L.z1 + oh }]
      }
      sheets.push({ id: m.id, mass: m.id, kind: 'slope', plane, footprint: fp, edges, material: m.material || 'metal roof' })
    }
  })
  return { sheets, ends, cutEdges }
}

const hAt = (p, x, z) => p.a * x + p.b * z + p.c

/** Clip a ring by the half-plane f(x,z) = fa x + fb z + fc > 0 (Sutherland–Hodgman). */
function clipRing(ring, fa, fb, fc) {
  const out = []
  const f = ([x, z]) => fa * x + fb * z + fc
  for (let i = 0; i < ring.length - 1; i++) {
    const P = ring[i]
    const Q = ring[i + 1]
    const fp = f(P)
    const fq = f(Q)
    if (fp > 0) out.push(P)
    if ((fp > 0) !== (fq > 0)) {
      const t = fp / (fp - fq)
      out.push([P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t])
    }
  }
  if (out.length < 3) return null
  out.push(out[0])
  return out
}
function clipMulti(mp, fa, fb, fc) {
  const res = []
  mp.forEach((poly) => {
    const outer = clipRing(poly[0], fa, fb, fc)
    if (!outer) return
    const holes = poly.slice(1).map((h) => clipRing(h, fa, fb, fc)).filter(Boolean)
    res.push([outer, ...holes])
  })
  return res
}

/**
 * Visible surfaces: for each sheet, its footprint minus every region where
 * another mass's sheet is higher. Returns faces with 3D rings.
 */
export function roofSurfaces(masses, k, centre, offset = [0, 0]) {
  const { sheets, ends, cutEdges } = roofSheets(masses, k, centre, offset)
  const faces = []
  sheets.forEach((A) => {
    const hidden = []
    sheets.forEach((B) => {
      if (B.mass === A.mass) return
      // region of B where h_B > h_A + eps
      const fa = B.plane.a - A.plane.a
      const fb = B.plane.b - A.plane.b
      const fc = B.plane.c - A.plane.c - EPS
      const region = fa === 0 && fb === 0 ? (fc > 0 ? B.footprint : []) : clipMulti(B.footprint, fa, fb, fc)
      if (region.length) hidden.push(region)
    })
    let visible = A.footprint
    try {
      if (hidden.length) visible = polygonClipping.difference(A.footprint, ...hidden)
    } catch (e) {
      visible = A.footprint
    }
    visible.forEach((poly) => {
      const rings = poly.map((ring) => ring.slice(0, -1).map(([x, z]) => [x, hAt(A.plane, x, z), z]))
      faces.push({ id: A.id, mass: A.mass, kind: 'slope', material: A.material, rings, plane: A.plane })
      // fascia along outer eave and rake edges
      const outer = rings[0]
      for (let i = 0; i < outer.length; i++) {
        const P = outer[i]
        const Q = outer[(i + 1) % outer.length]
        const onEdge = A.edges.some((e) => {
          const on = e.axis === 'x' ? Math.abs(P[0] - e.at) < 0.05 && Math.abs(Q[0] - e.at) < 0.05 : Math.abs(P[2] - e.at) < 0.05 && Math.abs(Q[2] - e.at) < 0.05
          if (!on || !e.span) return on
          const along = e.axis === 'x' ? [P[2], Q[2]] : [P[0], Q[0]]
          return Math.min(...along) >= e.span[0] - 0.05 && Math.max(...along) <= e.span[1] + 0.05
        })
        if (onEdge && Math.hypot(Q[0] - P[0], Q[2] - P[2]) > 0.3) {
          faces.push({ id: A.id + '-fascia', mass: A.mass, kind: 'fascia', material: 'fascia', rings: [[P, Q, [Q[0], Q[1] - 0.6, Q[2]], [P[0], P[1] - 0.6, P[2]]]] })
        }
      }
    })
  })
  // gable end triangles, clipped by every other mass's roof along the end line
  ends.forEach((E) => {
    const ring = E.tri.map(([t, y]) => [t, y])
    ring.push(ring[0])
    const tri = [[ring]] // MultiPolygon
    const hidden = []
    sheets.forEach((B) => {
      if (B.mass === E.mass) return
      // the end line in plan, as a thin strip, intersected with B's footprint
      const strip = E.axis === 'x' ? rect(E.at - 0.01, -500, E.at + 0.01, 500) : rect(-500, E.at - 0.01, 500, E.at + 0.01)
      let pieces = []
      try {
        pieces = polygonClipping.intersection(B.footprint, strip)
      } catch (e) {
        pieces = []
      }
      pieces.forEach((poly) => {
        const ts = poly[0].map(([x, z]) => (E.axis === 'x' ? z : x))
        const t0 = Math.min(...ts)
        const t1 = Math.max(...ts)
        if (t1 - t0 < 0.05) return
        const yAt = (t) => (E.axis === 'x' ? hAt(B.plane, E.at, t) : hAt(B.plane, t, E.at))
        hidden.push([
          [
            [
              [t0, -5],
              [t1, -5],
              [t1, yAt(t1) + EPS],
              [t0, yAt(t0) + EPS],
              [t0, -5],
            ],
          ],
        ])
      })
    })
    let visible = tri
    try {
      if (hidden.length) visible = polygonClipping.difference(tri, ...hidden)
    } catch (e) {
      visible = tri
    }
    visible.forEach((poly) => {
      const rings = poly.map((ring) => ring.slice(0, -1).map(([t, y]) => (E.axis === 'x' ? [E.at, y, t] : [t, y, E.at])))
      faces.push({ id: E.id, mass: E.mass, kind: 'end', material: 'siding', rings })
    })
  })
  // dormer cheeks: vertical sides from the roof it sits on up to its own roof
  sheets
    .filter((A) => A.dormer)
    .forEach((A) => {
      const d = A.dormer
      const others = sheets.filter((B) => B.mass !== A.mass)
      const ground = (x, z) => {
        let h = -Infinity
        others.forEach((B) => {
          if (B.footprint.some((poly) => insideRing(poly[0], x, z) && !poly.slice(1).some((hole) => insideRing(hole, x, z)))) h = Math.max(h, hAt(B.plane, x, z))
        })
        return h
      }
      ;[d.x0, d.x1].forEach((x, side) => {
        const xs = x + (side === 0 ? 0.05 : -0.05)
        const top = []
        const bottom = []
        for (let z = d.face; z > d.face - 40; z -= 0.25) {
          const hd = hAt(A.plane, xs, z)
          const hg = ground(xs, z)
          if (hg >= hd - EPS) {
            top.push([x, hd, z])
            bottom.push([x, hg, z])
            break
          }
          top.push([x, hd, z])
          bottom.push([x, Math.max(hg, d.base), z])
        }
        const ring = [...top, ...bottom.reverse()]
        if (ring.length >= 3) faces.push({ id: A.id + '-cheek', mass: A.mass, kind: 'end', material: 'siding', rings: [ring] })
      })
    })
  // notch walls: where a roof is cut back for a lower roof, a wall rises from
  // the lower roof to the edge of the higher one
  const heightOf = (list, x, z) => {
    let h = -Infinity
    list.forEach((B) => {
      if (B.footprint.some((poly) => insideRing(poly[0], x, z) && !poly.slice(1).some((hole) => insideRing(hole, x, z)))) h = Math.max(h, hAt(B.plane, x, z))
    })
    return h
  }
  cutEdges.forEach((e) => {
    const mine = sheets.filter((B) => B.mass === e.mass)
    const others = sheets.filter((B) => B.mass !== e.mass)
    const len = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1])
    const n = Math.max(2, Math.round(len / 0.5))
    const top = []
    const bottom = []
    for (let i = 0; i <= n; i++) {
      const t = i / n
      const x = e.a[0] + (e.b[0] - e.a[0]) * t
      const z = e.a[1] + (e.b[1] - e.a[1]) * t
      const hi = heightOf(mine, x + e.out[0] * 0.1, z + e.out[1] * 0.1)
      const lo = Math.max(heightOf(others, x - e.out[0] * 0.1, z - e.out[1] * 0.1), 9)
      if (!isFinite(hi) || hi <= lo + 0.05) {
        if (top.length >= 2) faces.push({ id: e.mass + '-notch', mass: e.mass, kind: 'end', material: 'siding', rings: [[...top, ...bottom.slice().reverse()]] })
        top.length = 0
        bottom.length = 0
        continue
      }
      top.push([x, hi, z])
      bottom.push([x, lo, z])
    }
    if (top.length >= 2) faces.push({ id: e.mass + '-notch', mass: e.mass, kind: 'end', material: 'siding', rings: [[...top, ...bottom.slice().reverse()]] })
  })
  return faces
}

function insideRing(r, x, z) {
  let c = false
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    if (r[i][1] > z !== r[j][1] > z && x < ((r[j][0] - r[i][0]) * (z - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) c = !c
  }
  return c
}

/** Dormer faces as walls: { x0, x1, face, top, base } in local feet. */
export function dormerWalls(masses, k, centre, offset = [0, 0]) {
  return roofSheets(masses, k, centre, offset).sheets.filter((s) => s.dormer).map((s) => s.dormer)
}
