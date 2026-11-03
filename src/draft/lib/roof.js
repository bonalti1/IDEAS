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

/** Scale a plan rectangle about the plan centre and move to local coords. */
function local(m, k, centre) {
  const sx = (v) => centre[0] + (v - centre[0]) * k - centre[0]
  const sz = (v) => centre[1] + (v - centre[1]) * k - centre[1]
  return { x0: sx(m.x0), x1: sx(m.x1), z0: sz(m.y0 ?? m.face), z1: sz(m.y1 ?? m.face), face: m.face !== undefined ? sz(m.face) : undefined, cuts: (m.cuts || []).map((c) => ({ x0: sx(c.x0), x1: sx(c.x1), z0: sz(c.y0), z1: sz(c.y1) })) }
}

/**
 * Sheets: { id, mass, kind, plane: {a, b, c} with h = a x + b z + c,
 * footprint: MultiPolygon in plan, edges: outer eave/rake lines for fascia,
 * material }. Ends: vertical gable triangles { id, mass, kind: 'end', axis, at, tri }.
 */
export function roofSheets(masses, k, centre) {
  const sheets = []
  const ends = []
  const cutEdges = [] // { mass, a: [x, z], b: [x, z], out: [nx, nz] } edges of cut-outs, normal pointing into the remaining roof
  masses.forEach((m) => {
    const L = local(m, k, centre)
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
      const ew = m.ridge === 'ew'
      const plateA = m.plate // near side: north for ew, west for ns
      const plateB = m.plate2 ?? m.plate // far side: south for ew, east for ns
      const lo = ew ? L.z0 : L.x0
      const hi = ew ? L.z1 : L.x1
      // ridge position from the two eave heights
      const r = (plateB - plateA) / (2 * s) + (lo + hi) / 2
      const hr = plateA + (r - lo) * s
      const endsList = m.ends || []
      const startOh = endsList.includes(ew ? 'w' : 'n') ? oh : 0
      const endOh = endsList.includes(ew ? 'e' : 's') ? oh : 0
      const startExt = startOh || RUN_INTO
      const endExt = endOh || RUN_INTO
      const [a0, a1] = ew ? [L.x0 - startExt, L.x1 + endExt] : [L.z0 - startExt, L.z1 + endExt]
      // two sheets either side of the ridge
      const sideA = ew ? rect(a0, lo - oh, a1, r) : rect(lo - oh, a0, r, a1)
      const sideB = ew ? rect(a0, r, a1, hi + oh) : rect(r, a0, hi + oh, a1)
      const planeA = ew ? { a: 0, b: s, c: hr - r * s } : { a: s, b: 0, c: hr - r * s }
      const planeB = ew ? { a: 0, b: -s, c: hr + r * s } : { a: -s, b: 0, c: hr + r * s }
      const edgesA = ew ? [{ axis: 'z', at: lo - oh }, startOh && { axis: 'x', at: a0 }, endOh && { axis: 'x', at: a1 }] : [{ axis: 'x', at: lo - oh }, startOh && { axis: 'z', at: a0 }, endOh && { axis: 'z', at: a1 }]
      const edgesB = ew ? [{ axis: 'z', at: hi + oh }, startOh && { axis: 'x', at: a0 }, endOh && { axis: 'x', at: a1 }] : [{ axis: 'x', at: hi + oh }, startOh && { axis: 'z', at: a0 }, endOh && { axis: 'z', at: a1 }]
      // the eave edge only carries fascia across the room itself plus its overhangs, not the run-in
      const eaveSpan = ew ? [L.x0 - startOh, L.x1 + endOh] : [L.z0 - startOh, L.z1 + endOh]
      edgesA[0].span = eaveSpan
      edgesB[0].span = eaveSpan
      sheets.push({ id: m.id + '-a', mass: m.id, kind: 'slope', plane: planeA, footprint: cut(sideA), edges: edgesA.filter(Boolean), material: mat })
      sheets.push({ id: m.id + '-b', mass: m.id, kind: 'slope', plane: planeB, footprint: cut(sideB), edges: edgesB.filter(Boolean), material: mat })
      // gable end triangles at listed ends
      const tri = (at, axis) => ({
        id: m.id + '-' + axis + at.toFixed(1),
        mass: m.id,
        kind: 'end',
        axis, // 'x' means the end wall is at x = at and runs along z
        at,
        tri: [
          [lo - oh, plateA - oh * s],
          [r, hr],
          [hi + oh, plateB - oh * s],
        ],
      })
      if (startOh) ends.push(tri(a0, ew ? 'x' : 'z'))
      if (endOh) ends.push(tri(a1, ew ? 'x' : 'z'))
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
export function roofSurfaces(masses, k, centre) {
  const { sheets, ends, cutEdges } = roofSheets(masses, k, centre)
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
export function dormerWalls(masses, k, centre) {
  return roofSheets(masses, k, centre).sheets.filter((s) => s.dormer).map((s) => s.dormer)
}
