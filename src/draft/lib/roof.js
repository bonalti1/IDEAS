// Roof masses → prisms → faces. Shared by the app scene, the viewer export,
// and the IFC writer. Plan feet in, local feet out (x along the front,
// y up, z toward the street), same frame as the room blocks.
const OVERHANG = 1.33

/**
 * A prism: origin O (local x, z at the start end), unit direction along the
 * ridge, length, and a closed profile of (u, v) points where u runs along
 * perp = (-dir.z, dir.x) and v is up.
 */
export function roofPrisms(masses, k, centre) {
  const out = []
  masses.forEach((m) => {
    const x0 = centre[0] + (m.x0 - centre[0]) * k - centre[0]
    const x1 = centre[0] + (m.x1 - centre[0]) * k - centre[0]
    const z0 = centre[1] + (m.y0 - centre[1]) * k - centre[1]
    const z1 = centre[1] + (m.y1 - centre[1]) * k - centre[1]
    const oh = m.overhang ?? OVERHANG
    const s = m.pitch / 12
    if (m.kind === 'gable') {
      const ew = m.ridge === 'ew'
      const hw = (ew ? z1 - z0 : x1 - x0) / 2
      const ends = m.ends || []
      const startOh = ends.includes(ew ? 'w' : 'n') ? oh : 0
      const endOh = ends.includes(ew ? 'e' : 's') ? oh : 0
      const dir = ew ? [1, 0] : [0, 1]
      const O = ew ? [x0 - startOh, (z0 + z1) / 2] : [(x0 + x1) / 2, z0 - startOh]
      const len = (ew ? x1 - x0 : z1 - z0) + startOh + endOh
      const eave = m.plate - oh * s
      const ridge = m.plate + hw * s
      const t = 0.7 // roof thickness along the slope, drawn as the underside
      out.push({
        id: m.id,
        kind: 'gable',
        material: m.material || 'shingles',
        O,
        dir,
        len,
        profile: [
          [-hw - oh, eave],
          [0, ridge],
          [hw + oh, eave],
          [hw + oh, eave - t],
          [0, ridge - t],
          [-hw - oh, eave - t],
        ],
      })
    } else {
      // shed: high side at the house wall, slopes down away from it
      const alongX = m.high === 'n' || m.high === 's'
      const depth = alongX ? z1 - z0 : x1 - x0
      const dir = alongX ? [1, 0] : [0, 1]
      const len = (alongX ? x1 - x0 : z1 - z0) + 2 * oh
      const O = alongX ? [x0 - oh, m.high === 'n' ? z0 : z1] : [m.high === 'w' ? x0 : x1, z0 - oh]
      // u runs along perp = (-dir.z, dir.x): for dir (1,0) perp = (0,1) = +z (toward street)
      const sign = m.high === 'n' || m.high === 'w' ? 1 : -1
      const highH = m.plate + depth * s
      out.push({
        id: m.id,
        kind: 'shed',
        material: m.material || 'metal roof',
        O,
        dir,
        len,
        profile: [
          [0, highH],
          [sign * (depth + oh), m.plate - oh * s],
          [sign * (depth + oh), m.plate - oh * s - 0.4],
          [0, highH - 0.4],
        ],
      })
    }
  })
  return out
}

/** Faces of a prism as polygons of [x, y, z] in local feet. */
export function prismFaces(p) {
  const perp = [-p.dir[1], p.dir[0]]
  const P = (u, v, t) => [p.O[0] + p.dir[0] * t + perp[0] * u, v, p.O[1] + p.dir[1] * t + perp[1] * u]
  const n = p.profile.length
  const faces = []
  faces.push({ pts: p.profile.map(([u, v]) => P(u, v, 0)), kind: 'end' })
  faces.push({ pts: p.profile.map(([u, v]) => P(u, v, p.len)).reverse(), kind: 'end' })
  for (let i = 0; i < n; i++) {
    const [u0, v0] = p.profile[i]
    const [u1, v1] = p.profile[(i + 1) % n]
    const top = p.kind === 'gable' ? i < 2 : i === 0
    faces.push({ pts: [P(u0, v0, 0), P(u1, v1, 0), P(u1, v1, p.len), P(u0, v0, p.len)], kind: top ? 'slope' : 'under' })
  }
  return faces
}

export function roofFaces(prisms) {
  return prisms.flatMap((p) => prismFaces(p).map((f) => ({ ...f, id: p.id, material: p.material })))
}
