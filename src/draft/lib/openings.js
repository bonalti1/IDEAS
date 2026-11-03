// Cut door and window openings into wall segments. Shared by the app scene,
// the IFC export, and the standalone viewer. Local plan feet throughout.
import { WINDOW_SILL, WINDOW_HEAD, DOOR_HEAD } from '../../kits/modern-farmhouse.js'

/** Which wall hosts this opening, and where along it (t from a). */
export function hostWall(walls, e) {
  const p = e.local
  let best = null
  walls.forEach((w, i) => {
    const dx = w.b[0] - w.a[0]
    const dz = w.b[1] - w.a[1]
    const len = Math.hypot(dx, dz)
    const t = ((p[0] - w.a[0]) * dx + (p[1] - w.a[1]) * dz) / len
    if (t < -0.2 || t > len + 0.2) return
    const perp = Math.abs((p[0] - w.a[0]) * dz - (p[1] - w.a[1]) * dx) / len
    const alongOk = e.axis === 'h' ? Math.abs(dz) < 0.01 : Math.abs(dx) < 0.01
    if (!alongOk || perp > 0.9) return
    if (!best || perp < best.perp) best = { i, t, perp, len }
  })
  return best
}

/**
 * Returns box segments: { a, b, thicknessIn, plate, exterior, plumbing, y0, h, kind }
 * Full-height pieces between openings, headers above doors and windows,
 * sills below windows. Walls with no opening pass through unchanged.
 */
export function splitWalls(walls, elements) {
  const cuts = walls.map(() => [])
  elements
    .filter((e) => (e.kind === 'door' || e.kind === 'window') && !e.dormer)
    .forEach((e) => {
      const h = hostWall(walls, e)
      if (!h) return
      const sill = e.kind === 'window' ? e.sill ?? WINDOW_SILL[e.mark] ?? 2 : 0
      const head = e.kind === 'window' ? e.head ?? WINDOW_HEAD[e.mark] ?? 7 : DOOR_HEAD
      cuts[h.i].push({ t0: Math.max(0, h.t - e.span / 2), t1: Math.min(h.len, h.t + e.span / 2), sill, head })
      // a near-duplicate wall on the other side of a tracing gap gets the same cut
      walls.forEach((w, j) => {
        if (j === h.i) return
        const h2 = hostWall([w], e)
        if (h2 && h2.perp <= 0.9) cuts[j].push({ t0: Math.max(0, h2.t - e.span / 2), t1: Math.min(h2.len, h2.t + e.span / 2), sill, head })
      })
    })
  const out = []
  walls.forEach((w, i) => {
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1])
    const ux = (w.b[0] - w.a[0]) / len
    const uz = (w.b[1] - w.a[1]) / len
    const at = (t) => [w.a[0] + ux * t, w.a[1] + uz * t]
    const base = w.base || 0
    const seg = (t0, t1, y0, h, kind) => {
      if (t1 - t0 < 0.05 || h < 0.05) return
      out.push({ ...w, a: at(t0), b: at(t1), y0, h, kind })
    }
    const list = cuts[i].sort((p, q) => p.t0 - q.t0)
    let t = 0
    list.forEach((c) => {
      if (c.t0 <= t && c.t1 <= t) return
      seg(t, Math.max(t, c.t0), base, w.plate - base, 'wall')
      const s0 = Math.max(t, c.t0)
      if (c.sill > base) seg(s0, c.t1, base, c.sill - base, 'sill')
      seg(s0, c.t1, c.head, w.plate - c.head, 'header')
      t = Math.max(t, c.t1)
    })
    seg(t, len, base, w.plate - base, 'wall')
  })
  return out
}
