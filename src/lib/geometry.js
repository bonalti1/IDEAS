// 2D geometry helpers. All points are [x, z] in plat feet (x = east, z = south).

/**
 * Fit a circular arc of radius R through p1 -> p2, bulging AWAY from `insidePoint`.
 * Sweeps the minor arc (delta < 180 deg). Returns tessellated points plus
 * diagnostics so the render can be checked against the recorded curve data.
 */
export function tessellateArc(p1, p2, R, insidePoint, segments = 40) {
  const [x1, z1] = p1
  const [x2, z2] = p2
  const dx = x2 - x1
  const dz = z2 - z1
  const chord = Math.hypot(dx, dz)
  if (chord > 2 * R) {
    throw new Error(`Arc impossible: chord ${chord.toFixed(2)} > diameter ${2 * R}`)
  }
  const mx = (x1 + x2) / 2
  const mz = (z1 + z2) / 2
  const h = Math.sqrt(R * R - (chord / 2) ** 2)
  const px = -dz / chord
  const pz = dx / chord
  const candA = [mx + px * h, mz + pz * h]
  const candB = [mx - px * h, mz - pz * h]
  const dA = Math.hypot(candA[0] - insidePoint[0], candA[1] - insidePoint[1])
  const dB = Math.hypot(candB[0] - insidePoint[0], candB[1] - insidePoint[1])
  // center sits on the inside; the arc bulges away from it
  const [cx, cz] = dA < dB ? candA : candB

  const a1 = Math.atan2(z1 - cz, x1 - cx)
  const a2 = Math.atan2(z2 - cz, x2 - cx)
  let sweep = a2 - a1
  while (sweep > Math.PI) sweep -= 2 * Math.PI
  while (sweep < -Math.PI) sweep += 2 * Math.PI

  const points = []
  for (let i = 0; i <= segments; i++) {
    const a = a1 + (sweep * i) / segments
    points.push([cx + R * Math.cos(a), cz + R * Math.sin(a)])
  }
  return {
    points,
    center: [cx, cz],
    deltaDeg: (Math.abs(sweep) * 180) / Math.PI,
    arcLength: Math.abs(sweep) * R,
    chord,
  }
}

/** Signed shoelace area (feet^2). Sign depends on winding; use Math.abs for area. */
export function polygonArea(pts) {
  let s = 0
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i]
    const [x2, z2] = pts[(i + 1) % pts.length]
    s += x1 * z2 - x2 * z1
  }
  return s / 2
}

export function polygonCentroid(pts) {
  const a = polygonArea(pts)
  let cx = 0
  let cz = 0
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i]
    const [x2, z2] = pts[(i + 1) % pts.length]
    const w = x1 * z2 - x2 * z1
    cx += (x1 + x2) * w
    cz += (z1 + z2) * w
  }
  return [cx / (6 * a), cz / (6 * a)]
}

/** Extend a polyline beyond its endpoints along the end-segment directions. */
export function extendPolyline(pts, startExt, endExt) {
  const out = pts.map((p) => [...p])
  if (startExt > 0) {
    const [ax, az] = pts[0]
    const [bx, bz] = pts[1]
    const dl = Math.hypot(bx - ax, bz - az)
    out.unshift([ax - ((bx - ax) / dl) * startExt, az - ((bz - az) / dl) * startExt])
  }
  if (endExt > 0) {
    const [cx, cz] = pts[pts.length - 2]
    const [ex, ez] = pts[pts.length - 1]
    const dl2 = Math.hypot(ex - cx, ez - cz)
    out.push([ex + ((ex - cx) / dl2) * endExt, ez + ((ez - cz) / dl2) * endExt])
  }
  return out
}

/**
 * Offset each vertex of a polyline perpendicular to the path by `dist`,
 * on the side pointing away from `awayFrom` (miter joins, clamped).
 */
export function offsetPolyline(pts, dist, awayFrom) {
  const n = pts.length
  const segNormals = []
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0]
    const dz = pts[i + 1][1] - pts[i][1]
    const l = Math.hypot(dx, dz)
    segNormals.push([-dz / l, dx / l])
  }
  // pick the sign that moves the polyline midpoint away from `awayFrom`
  const mid = pts[Math.floor(n / 2)]
  const nm = segNormals[Math.min(Math.floor(n / 2), n - 2)]
  const toward = (mid[0] + nm[0] - awayFrom[0]) ** 2 + (mid[1] + nm[1] - awayFrom[1]) ** 2
  const away = (mid[0] - nm[0] - awayFrom[0]) ** 2 + (mid[1] - nm[1] - awayFrom[1]) ** 2
  const sign = toward > away ? 1 : -1

  const out = []
  for (let i = 0; i < n; i++) {
    const prev = segNormals[Math.max(i - 1, 0)]
    const next = segNormals[Math.min(i, n - 2)]
    let nx = prev[0] + next[0]
    let nz = prev[1] + next[1]
    const l = Math.hypot(nx, nz)
    nx /= l
    nz /= l
    // miter length, clamped to avoid spikes at sharp corners
    const dot = nx * next[0] + nz * next[1]
    const miter = Math.min(1 / Math.max(dot, 0.3), 3)
    out.push([pts[i][0] + sign * nx * dist * miter, pts[i][1] + sign * nz * dist * miter])
  }
  return out
}

/** Triangle-strip BufferGeometry attributes between two equal-length polylines, at elevation y. */
export function stripPositions(inner, outer, y = 0) {
  const positions = new Float32Array(inner.length * 2 * 3)
  for (let i = 0; i < inner.length; i++) {
    positions.set([inner[i][0], y, inner[i][1]], i * 6)
    positions.set([outer[i][0], y, outer[i][1]], i * 6 + 3)
  }
  const indices = []
  for (let i = 0; i < inner.length - 1; i++) {
    const a = i * 2
    indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
  }
  return { positions, indices: new Uint16Array(indices) }
}

/** Point at parameter t (0..1 by arc length) along a polyline. */
export function polylinePoint(pts, t) {
  const lens = []
  let total = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
    lens.push(l)
    total += l
  }
  let d = t * total
  for (let i = 0; i < lens.length; i++) {
    if (d <= lens[i]) {
      const f = d / lens[i]
      return {
        point: [
          pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f,
          pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f,
        ],
        angle: Math.atan2(pts[i + 1][1] - pts[i][1], pts[i + 1][0] - pts[i][0]),
      }
    }
    d -= lens[i]
  }
  const i = pts.length - 2
  return {
    point: [...pts[pts.length - 1]],
    angle: Math.atan2(pts[i + 1][1] - pts[i][1], pts[i + 1][0] - pts[i][0]),
  }
}
