// The floor plan as an architectural drawing, built from design.json: wall poché at true thickness,
// door swings, window symbols, fixture symbols, exterior dimension strings, room labels that never
// overlap, a north arrow, a graphic scale and a title. Pure: a string of SVG, plus the label boxes
// so a test can prove no two overlap. Units inside the SVG are inches of the house (1 ft = 12).
//
// The frame is design.json's: x along the front, z toward the street (down the page).

const IN = 12
const fmt = (ft) => {
  const total = Math.round(ft * 12)
  const f = Math.floor(total / 12)
  const i = total - f * 12
  return i ? `${f}'-${i}"` : `${f}'-0"`
}
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const r1 = (v) => Math.round(v * 10) / 10

const overlapBox = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

/** The lot's name for a title: its address, or "100 × 150 lot, McAllen" for a typed-in lot. */
export function lotTitle(design) {
  const lot = design.lot || {}
  if (lot.address) return lot.address
  const spec = lot.spec || {}
  const city = lot.cityName || (lot.city ? lot.city.charAt(0).toUpperCase() + lot.city.slice(1) : '')
  if (spec.width && spec.depth) return `${spec.width} × ${spec.depth} lot${city ? `, ${city.replace(/, TX$/, '')}` : ''}`
  return city ? `lot in ${city}` : 'lot'
}

/** Fixture symbols, drawn in a box (x, y, w, h) in SVG units. */
function fixtureSymbol(f, x, y, w, h) {
  const cx = x + w / 2
  const cy = y + h / 2
  const thin = 'fill="none" stroke="#333" stroke-width="0.8"'
  switch (f.kind) {
    case 'toilet': {
      // tank against the wall it faces away from, bowl toward the room
      const horiz = f.face === 'n' || f.face === 's'
      const tankH = horiz ? h * 0.3 : w * 0.3
      const tank = horiz ? (f.face === 's' ? [x, y, w, tankH] : [x, y + h - tankH, w, tankH]) : f.face === 'e' ? [x, y, tankH, h] : [x + w - tankH, y, tankH, h]
      const bowl = horiz ? [cx, f.face === 's' ? y + tankH + (h - tankH) / 2 : y + (h - tankH) / 2, w * 0.4, (h - tankH) * 0.45] : [f.face === 'e' ? x + tankH + (w - tankH) / 2 : x + (w - tankH) / 2, cy, (w - tankH) * 0.45, h * 0.4]
      return `<rect x="${r1(tank[0])}" y="${r1(tank[1])}" width="${r1(tank[2])}" height="${r1(tank[3])}" ${thin}/><ellipse cx="${r1(bowl[0])}" cy="${r1(bowl[1])}" rx="${r1(bowl[2])}" ry="${r1(bowl[3])}" ${thin}/>`
    }
    case 'shower':
      return `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" ${thin}/><line x1="${r1(x)}" y1="${r1(y)}" x2="${r1(x + w)}" y2="${r1(y + h)}" ${thin}/><line x1="${r1(x + w)}" y1="${r1(y)}" x2="${r1(x)}" y2="${r1(y + h)}" ${thin}/><circle cx="${r1(cx)}" cy="${r1(cy)}" r="1.5" ${thin}/>`
    case 'tub':
      return `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" ${thin}/><rect x="${r1(x + 4)}" y="${r1(y + 4)}" width="${r1(w - 8)}" height="${r1(h - 8)}" rx="6" ${thin}/>`
    case 'vanity':
    case 'sink':
      return `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" ${thin}/><ellipse cx="${r1(cx)}" cy="${r1(cy)}" rx="${r1(Math.min(w, h) * 0.3)}" ry="${r1(Math.min(w, h) * 0.22)}" ${thin}/>`
    case 'range': {
      const rx = Math.min(w, h) * 0.17
      return `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" ${thin}/>${[[0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]].map(([a, b]) => `<circle cx="${r1(x + w * a)}" cy="${r1(y + h * b)}" r="${r1(rx)}" ${thin}/>`).join('')}`
    }
    case 'fridge':
      return `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" ${thin}/><text x="${r1(cx)}" y="${r1(cy + 2.5)}" font-size="6" text-anchor="middle" fill="#333" font-family="Helvetica, Arial, sans-serif">REF</text>`
    case 'washer':
    case 'dryer':
      return `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" ${thin}/><circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(Math.min(w, h) * 0.3)}" ${thin}/><text x="${r1(cx)}" y="${r1(cy + 2)}" font-size="5" text-anchor="middle" fill="#333" font-family="Helvetica, Arial, sans-serif">${f.kind === 'washer' ? 'W' : 'D'}</text>`
    case 'bed':
      return `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" ${thin}/><rect x="${r1(x + 3)}" y="${r1(y + 3)}" width="${r1(w - 6)}" height="${r1(Math.min(h * 0.18, 12))}" ${thin}/>`
    case 'counter':
    case 'island':
    case 'desk':
    case 'table':
    case 'shelves':
    case 'linen':
    case 'bench':
    case 'sofa':
    case 'coffee':
    case 'tv':
    case 'wh':
      return `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" fill="none" stroke="#777" stroke-width="0.6"/>`
    default:
      return `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" fill="none" stroke="#999" stroke-width="0.5" stroke-dasharray="2 2"/>`
  }
}

/**
 * @param {object} design  design.json (contract 1)
 * @param {object} opts    { title, date, labelFont (default 9), showFixtures (default true) }
 * @returns {{ svg: string, width: number, height: number, labels: Array<{id, x, y, w, h, text}>, dims: number, scaleNote: string }}
 */
export function planSVG(design, opts = {}) {
  const rooms = design.rooms || []
  const walls = design.walls || []
  const doors = design.doors || []
  const windows = design.windows || []
  const fixtures = opts.showFixtures === false ? [] : design.fixtures || []
  const solid = rooms.filter((r) => !r.open)
  if (!rooms.length) return { svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>', width: 10, height: 10, labels: [], dims: 0, scaleNote: '' }

  // the drawing's extents in frame feet, with room for three dimension strings and the title
  const minX = Math.min(...rooms.map((r) => r.x - r.w / 2))
  const maxX = Math.max(...rooms.map((r) => r.x + r.w / 2))
  const minZ = Math.min(...rooms.map((r) => r.z - r.d / 2))
  const maxZ = Math.max(...rooms.map((r) => r.z + r.d / 2))
  const M = 7.5 // margin feet for dimensions
  const TOP = 4 // title band, feet
  const X = (ft) => (ft - minX + M) * IN
  const Y = (ft) => (ft - minZ + M + TOP) * IN
  const width = (maxX - minX + 2 * M) * IN
  const height = (maxZ - minZ + 2 * M + TOP) * IN
  const out = []
  const font = 'font-family="Helvetica, Arial, sans-serif"'

  // ── rooms: floor fill, porches hatched ──
  rooms.forEach((r) => {
    const x = X(r.x - r.w / 2)
    const y = Y(r.z - r.d / 2)
    out.push(`<rect class="room ${r.open ? 'porch' : r.kind}" data-id="${esc(r.id)}" x="${r1(x)}" y="${r1(y)}" width="${r1(r.w * IN)}" height="${r1(r.d * IN)}" fill="${r.open ? 'url(#porchHatch)' : r.kind === 'garage' ? '#f1efe9' : '#fbfaf7'}" stroke="none"/>`)
  })

  // ── walls: poché at true thickness ──
  walls.forEach((w) => {
    if (w.dormer) return
    const t = (w.thicknessIn || 4) // inches
    const ax = X(w.a[0])
    const ay = Y(w.a[1])
    const bx = X(w.b[0])
    const by = Y(w.b[1])
    const len = Math.hypot(bx - ax, by - ay)
    if (len < 1) return
    const ux = (bx - ax) / len
    const uy = (by - ay) / len
    const nx = -uy * (t / 2)
    const ny = ux * (t / 2)
    // extend half a thickness at each end so corners close
    const ex = ux * (t / 2)
    const ey = uy * (t / 2)
    const pts = [[ax - ex + nx, ay - ey + ny], [bx + ex + nx, by + ey + ny], [bx + ex - nx, by + ey - ny], [ax - ex - nx, ay - ey - ny]]
    out.push(`<polygon class="wall ${w.exterior ? 'exterior' : 'interior'}" points="${pts.map((p) => `${r1(p[0])},${r1(p[1])}`).join(' ')}" fill="#2b2b2b" stroke="none"/>`)
  })

  // ── openings: a white gap in the wall, then the door leaf and swing, or the window glass ──
  const wallAt = (x, z, axis) => {
    // the thickest wall through the opening's point along its axis
    let best = null
    walls.forEach((w) => {
      if (w.dormer) return
      const horizontal = Math.abs(w.a[1] - w.b[1]) < 0.01
      if ((axis === 'h') !== horizontal) return
      const along = horizontal ? [Math.min(w.a[0], w.b[0]), Math.max(w.a[0], w.b[0])] : [Math.min(w.a[1], w.b[1]), Math.max(w.a[1], w.b[1])]
      const at = horizontal ? w.a[1] : w.a[0]
      const p = horizontal ? x : z
      const q = horizontal ? z : x
      if (p < along[0] - 0.2 || p > along[1] + 0.2 || Math.abs(q - at) > 0.6) return
      if (!best || Math.abs(q - at) < best.off) best = { w, off: Math.abs(q - at), at }
    })
    return best
  }
  doors.forEach((d) => {
    const host = wallAt(d.x, d.z, d.axis)
    const t = (host?.w.thicknessIn || 4) + 1
    const wIn = d.width * IN
    const cx = X(d.x)
    const cy = Y(d.z)
    // snap the gap onto the wall line
    const gx = d.axis === 'h' ? cx - wIn / 2 : host ? X(host.at) - t / 2 : cx - t / 2
    const gy = d.axis === 'h' ? (host ? Y(host.at) - t / 2 : cy - t / 2) : cy - wIn / 2
    out.push(`<rect class="opening door" data-id="${esc(d.id)}" x="${r1(gx)}" y="${r1(gy)}" width="${r1(d.axis === 'h' ? wIn : t)}" height="${r1(d.axis === 'h' ? t : wIn)}" fill="#fbfaf7" stroke="none"/>`)
    if (d.cased || d.overhead) {
      // a cased opening or an overhead door: dashed head line
      out.push(`<line x1="${r1(gx)}" y1="${r1(d.axis === 'h' ? gy + t / 2 : gy)}" x2="${r1(d.axis === 'h' ? gx + wIn : gx + t / 2)}" y2="${r1(d.axis === 'h' ? gy + t / 2 : gy + wIn)}" stroke="#555" stroke-width="0.8" stroke-dasharray="4 3"/>`)
      return
    }
    // leaf and swing: a quarter arc from the hinge
    const swing = d.swing === -1 ? -1 : 1 // which side of the wall the door opens to
    const hingeEnd = d.hinge === 'end' ? 1 : 0
    const leaves = d.pair ? 2 : 1
    const leafLen = wIn / leaves
    for (let i = 0; i < leaves; i++) {
      // hinge point for this leaf
      let hx
      let hy
      let dirX
      let dirY
      if (d.axis === 'h') {
        const left = i === 0 ? hingeEnd === 0 : hingeEnd !== 0
        hx = d.pair ? (i === 0 ? cx - wIn / 2 : cx + wIn / 2) : left ? cx - wIn / 2 : cx + wIn / 2
        hy = Y(host ? host.at : d.z)
        dirX = hx < cx ? 1 : -1
        dirY = 0
      } else {
        const top = i === 0 ? hingeEnd === 0 : hingeEnd !== 0
        hy = d.pair ? (i === 0 ? cy - wIn / 2 : cy + wIn / 2) : top ? cy - wIn / 2 : cy + wIn / 2
        hx = X(host ? host.at : d.x)
        dirX = 0
        dirY = hy < cy ? 1 : -1
      }
      // leaf open 90°: perpendicular to the wall, on the swing side
      const px = d.axis === 'h' ? 0 : swing
      const py = d.axis === 'h' ? swing : 0
      const lx = hx + px * leafLen
      const ly = hy + py * leafLen
      // arc from the leaf tip to the wall line
      const ex = hx + dirX * leafLen
      const ey = hy + dirY * leafLen
      const sweep = (d.axis === 'h' ? dirX * swing : -dirY * swing) > 0 ? 1 : 0
      out.push(`<line class="leaf" x1="${r1(hx)}" y1="${r1(hy)}" x2="${r1(lx)}" y2="${r1(ly)}" stroke="#333" stroke-width="1"/>`)
      out.push(`<path class="swing" d="M ${r1(lx)} ${r1(ly)} A ${r1(leafLen)} ${r1(leafLen)} 0 0 ${sweep} ${r1(ex)} ${r1(ey)}" fill="none" stroke="#777" stroke-width="0.5"/>`)
    }
  })
  windows.forEach((wn) => {
    const host = wallAt(wn.x, wn.z, wn.axis)
    const t = host?.w.thicknessIn || 6
    const wIn = wn.width * IN
    const cx = X(wn.x)
    const cy = Y(wn.z)
    const at = host ? (wn.axis === 'h' ? Y(host.at) : X(host.at)) : wn.axis === 'h' ? cy : cx
    if (wn.axis === 'h') {
      out.push(`<rect class="opening window" data-id="${esc(wn.id)}" x="${r1(cx - wIn / 2)}" y="${r1(at - t / 2 - 0.5)}" width="${r1(wIn)}" height="${r1(t + 1)}" fill="#fbfaf7" stroke="none"/>`)
      out.push(`<g class="glass" stroke="#333" stroke-width="0.7"><line x1="${r1(cx - wIn / 2)}" y1="${r1(at - t / 2)}" x2="${r1(cx + wIn / 2)}" y2="${r1(at - t / 2)}"/><line x1="${r1(cx - wIn / 2)}" y1="${r1(at)}" x2="${r1(cx + wIn / 2)}" y2="${r1(at)}"/><line x1="${r1(cx - wIn / 2)}" y1="${r1(at + t / 2)}" x2="${r1(cx + wIn / 2)}" y2="${r1(at + t / 2)}"/><line x1="${r1(cx - wIn / 2)}" y1="${r1(at - t / 2)}" x2="${r1(cx - wIn / 2)}" y2="${r1(at + t / 2)}"/><line x1="${r1(cx + wIn / 2)}" y1="${r1(at - t / 2)}" x2="${r1(cx + wIn / 2)}" y2="${r1(at + t / 2)}"/></g>`)
    } else {
      out.push(`<rect class="opening window" data-id="${esc(wn.id)}" x="${r1(at - t / 2 - 0.5)}" y="${r1(cy - wIn / 2)}" width="${r1(t + 1)}" height="${r1(wIn)}" fill="#fbfaf7" stroke="none"/>`)
      out.push(`<g class="glass" stroke="#333" stroke-width="0.7"><line x1="${r1(at - t / 2)}" y1="${r1(cy - wIn / 2)}" x2="${r1(at - t / 2)}" y2="${r1(cy + wIn / 2)}"/><line x1="${r1(at)}" y1="${r1(cy - wIn / 2)}" x2="${r1(at)}" y2="${r1(cy + wIn / 2)}"/><line x1="${r1(at + t / 2)}" y1="${r1(cy - wIn / 2)}" x2="${r1(at + t / 2)}" y2="${r1(cy + wIn / 2)}"/><line x1="${r1(at - t / 2)}" y1="${r1(cy - wIn / 2)}" x2="${r1(at + t / 2)}" y2="${r1(cy - wIn / 2)}"/><line x1="${r1(at - t / 2)}" y1="${r1(cy + wIn / 2)}" x2="${r1(at + t / 2)}" y2="${r1(cy + wIn / 2)}"/></g>`)
    }
  })

  // ── fixtures ──
  fixtures.forEach((f) => {
    out.push(`<g class="fixture ${esc(f.kind)}" data-id="${esc(f.id)}">${fixtureSymbol(f, X(f.x - f.w / 2), Y(f.z - f.d / 2), f.w * IN, f.d * IN)}</g>`)
  })

  // ── room labels: name and size, shrunk to fit, nudged apart, a leader when the room is too small ──
  const labels = []
  const baseFont = opts.labelFont || 9
  const textW = (s, size) => s.length * size * 0.58
  const placed = []
  rooms
    .slice()
    .sort((a, b) => b.w * b.d - a.w * a.d)
    .forEach((r) => {
      const name = r.name.toUpperCase()
      const size = `${fmt(r.w)} × ${fmt(r.d)}`
      const innerW = r.w * IN - 8
      const innerH = r.d * IN - 8
      let f = baseFont
      let lines = [name, size]
      let w = Math.max(textW(name, f), textW(size, f * 0.85))
      let h = f * 2.3
      while ((w > innerW || h > innerH) && f > 6) {
        f -= 0.5
        w = Math.max(textW(name, f), textW(size, f * 0.85))
        h = f * 2.3
      }
      if (w > innerW || h > innerH) {
        lines = [name]
        w = textW(name, f)
        h = f * 1.2
        while (w > innerW && f > 5) {
          f -= 0.5
          w = textW(name, f)
          h = f * 1.2
        }
      }
      const cx = X(r.x)
      const cy = Y(r.z)
      let box = { x: cx - w / 2, y: cy - h / 2, w, h }
      let leader = null
      if (w > innerW + 0.01 || h > innerH + 0.01) {
        // too small even for the name: label outside the house with a leader, below the plan
        const lx = cx
        const ly = Y(maxZ) + 30 + placed.filter((p) => p.leader).length * 12
        box = { x: lx - w / 2, y: ly - h / 2, w, h }
        leader = [cx, cy, lx, ly - h / 2]
      }
      // nudge down until it overlaps no earlier label
      for (let tries = 0; tries < 40 && placed.some((p) => overlapBox(p.box, box)); tries++) box = { ...box, y: box.y + 3 }
      placed.push({ r, box, f, lines, leader })
    })
  placed.forEach(({ r, box, f, lines, leader }) => {
    const cx = box.x + box.w / 2
    const y0 = box.y + f
    labels.push({ id: r.id, x: box.x, y: box.y, w: box.w, h: box.h, text: lines.join(' ') })
    if (leader) out.push(`<line class="leader" x1="${r1(leader[0])}" y1="${r1(leader[1])}" x2="${r1(leader[2])}" y2="${r1(leader[3])}" stroke="#555" stroke-width="0.6"/>`)
    out.push(`<text class="label" data-id="${esc(r.id)}" x="${r1(cx)}" y="${r1(y0)}" text-anchor="middle" ${font} fill="#1a1a1a"><tspan font-size="${f}" font-weight="600" letter-spacing="0.06em">${esc(lines[0])}</tspan>${lines[1] ? `<tspan x="${r1(cx)}" dy="${r1(f * 1.1)}" font-size="${r1(f * 0.85)}">${esc(lines[1])}</tspan>` : ''}</text>`)
  })

  // ── exterior dimension strings: room breaks on each side, then the overall ──
  let dims = 0
  const tick = (x1, y1, x2, y2) => `<line x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}" stroke="#1a1a1a" stroke-width="0.6"/>`
  const dimLine = (pts, horizontal, at, textAbove) => {
    const g = []
    const ticks = [...new Set(pts.map((v) => Math.round(v * 24) / 24))].sort((a, b) => a - b)
    if (ticks.length < 2) return ''
    const A = horizontal ? X(ticks[0]) : Y(ticks[0])
    const B = horizontal ? X(ticks[ticks.length - 1]) : Y(ticks[ticks.length - 1])
    g.push(horizontal ? tick(A, at, B, at) : tick(at, A, at, B))
    for (let i = 0; i < ticks.length; i++) {
      const p = horizontal ? X(ticks[i]) : Y(ticks[i])
      g.push(horizontal ? tick(p - 2, at + 2, p + 2, at - 2) : tick(at - 2, p + 2, at + 2, p - 2))
      g.push(horizontal ? tick(p, at - 4, p, at + 4) : tick(at - 4, p, at + 4, p))
      if (i > 0) {
        const span = ticks[i] - ticks[i - 1]
        if (span < 0.5) continue
        const mid = (p + (horizontal ? X(ticks[i - 1]) : Y(ticks[i - 1]))) / 2
        const label = fmt(span)
        if (horizontal) g.push(`<text class="dim" x="${r1(mid)}" y="${r1(at + (textAbove ? -3 : 9))}" font-size="7" text-anchor="middle" ${font} fill="#1a1a1a">${label}</text>`)
        else g.push(`<text class="dim" x="${r1(at + (textAbove ? -3 : 3))}" y="${r1(mid)}" font-size="7" text-anchor="middle" ${font} fill="#1a1a1a" transform="rotate(-90 ${r1(at + (textAbove ? -3 : 3))} ${r1(mid)})">${label}</text>`)
        dims++
      }
    }
    return `<g class="dimstring">${g.join('')}</g>`
  }
  // the rooms that touch each face of the house: their edges are the breaks
  const tol = 0.6
  const faceRooms = {
    s: solid.filter((r) => !solid.some((o) => o !== r && o.z - o.d / 2 > r.z + r.d / 2 - tol && o.x - o.w / 2 < r.x + r.w / 2 - tol && o.x + o.w / 2 > r.x - r.w / 2 + tol)),
    n: solid.filter((r) => !solid.some((o) => o !== r && o.z + o.d / 2 < r.z - r.d / 2 + tol && o.x - o.w / 2 < r.x + r.w / 2 - tol && o.x + o.w / 2 > r.x - r.w / 2 + tol)),
    w: solid.filter((r) => !solid.some((o) => o !== r && o.x + o.w / 2 < r.x - r.w / 2 + tol && o.z - o.d / 2 < r.z + r.d / 2 - tol && o.z + o.d / 2 > r.z - r.d / 2 + tol)),
    e: solid.filter((r) => !solid.some((o) => o !== r && o.x - o.w / 2 > r.x + r.w / 2 - tol && o.z - o.d / 2 < r.z + r.d / 2 - tol && o.z + o.d / 2 > r.z - r.d / 2 + tol)),
  }
  const sMinX = Math.min(...solid.map((r) => r.x - r.w / 2))
  const sMaxX = Math.max(...solid.map((r) => r.x + r.w / 2))
  const sMinZ = Math.min(...solid.map((r) => r.z - r.d / 2))
  const sMaxZ = Math.max(...solid.map((r) => r.z + r.d / 2))
  const south = Y(maxZ) + 2.5 * IN
  const north = Y(minZ) - 2.5 * IN
  const west = X(minX) - 2.5 * IN
  const east = X(maxX) + 2.5 * IN
  out.push(dimLine(faceRooms.s.flatMap((r) => [r.x - r.w / 2, r.x + r.w / 2]), true, south, false))
  out.push(dimLine([sMinX, sMaxX], true, south + 1.5 * IN, false))
  out.push(dimLine(faceRooms.n.flatMap((r) => [r.x - r.w / 2, r.x + r.w / 2]), true, north, true))
  out.push(dimLine([sMinX, sMaxX], true, north - 1.5 * IN, true))
  out.push(dimLine(faceRooms.w.flatMap((r) => [r.z - r.d / 2, r.z + r.d / 2]), false, west, true))
  out.push(dimLine([sMinZ, sMaxZ], false, west - 1.5 * IN, true))
  out.push(dimLine(faceRooms.e.flatMap((r) => [r.z - r.d / 2, r.z + r.d / 2]), false, east, false))
  out.push(dimLine([sMinZ, sMaxZ], false, east + 1.5 * IN, false))

  // ── north arrow, graphic scale, title ──
  // the frame's z points at the street; north is up when the lot angle is 0, else turned by it
  const angleDeg = -((design.lot?.angle || 0) * 180) / Math.PI
  const nx = X(maxX) + 4.5 * IN
  const ny = Y(minZ) - 5 * IN
  out.push(`<g id="north" class="north" transform="translate(${r1(nx)} ${r1(ny)}) rotate(${r1(angleDeg)})"><circle r="14" fill="none" stroke="#1a1a1a" stroke-width="0.8"/><polygon points="0,-13 -5,4 0,0 5,4" fill="#1a1a1a"/><text y="-17" font-size="8" text-anchor="middle" ${font} font-weight="700" fill="#1a1a1a">N</text></g>`)
  const sx = X(minX)
  const sy = Y(maxZ) + 5 * IN
  out.push(`<g id="scale" class="scale">${[0, 5, 10, 20].slice(0, -1).map((a, i, arr) => `<rect x="${r1(sx + a * IN)}" y="${r1(sy)}" width="${r1(([5, 10, 20][i] - a) * IN)}" height="4" fill="${i % 2 ? '#fff' : '#1a1a1a'}" stroke="#1a1a1a" stroke-width="0.6"/>`).join('')}${[0, 5, 10, 20].map((a) => `<text x="${r1(sx + a * IN)}" y="${r1(sy + 12)}" font-size="6" text-anchor="middle" ${font} fill="#1a1a1a">${a}'</text>`).join('')}<text x="${r1(sx + 20 * IN + 14)}" y="${r1(sy + 5)}" font-size="6" ${font} fill="#1a1a1a">graphic scale, feet</text></g>`)
  const date = opts.date || new Date(design.createdAt || Date.now()).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  const title = opts.title || `${design.client || 'Draft'} · ${lotTitle(design)}`
  const ab = design.asBuilt || design.program || {}
  const sub = `${design.style?.name || ''} · ${ab.beds} bed, ${ab.baths}${ab.halfBath ? '.5' : ''} bath${ab.garage ? `, ${ab.garage}-car` : ''} · ${design.livingSf ? design.livingSf.toLocaleString() + ' sf' : ''} · ${date}`
  out.push(`<g id="title" class="title"><text x="${r1(X(minX))}" y="${r1(Y(minZ) - 6.6 * IN)}" font-size="13" font-weight="700" ${font} fill="#1a1a1a">${esc(title)}</text><text x="${r1(X(minX))}" y="${r1(Y(minZ) - 6.6 * IN + 15)}" font-size="8" ${font} fill="#555">FLOOR PLAN · ${esc(sub)}</text></g>`)

  const defs = `<defs><pattern id="porchHatch" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="8" stroke="#d8d3c8" stroke-width="1"/></pattern></defs>`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r1(width)} ${r1(height)}" width="${r1(width)}" height="${r1(height)}" class="floor-plan"><rect width="${r1(width)}" height="${r1(height)}" fill="#fff"/>${defs}${out.join('')}</svg>`
  return { svg, width, height, labels, dims, scaleNote: 'drawn in inches of the house: 1 ft = 12 units' }
}

/**
 * A printable sheet: the plan at 1/4" = 1'-0" on a tabloid (17 x 11 in) page when it fits, else
 * 3/16" or 1/8", with the title block. Returns a complete HTML document.
 */
export function planSheetHTML(design, titleBlock = {}, opts = {}) {
  const plan = planSVG(design, opts)
  const pageW = 17
  const pageH = 11
  const margin = 0.4
  const blockH = 1.1
  const availW = pageW - 2 * margin
  const availH = pageH - 2 * margin - blockH
  // scale in inches of paper per foot of house; the drawing is 12 units per foot
  const options = [[0.25, '1/4" = 1\'-0"'], [0.1875, '3/16" = 1\'-0"'], [0.125, '1/8" = 1\'-0"'], [0.09375, '3/32" = 1\'-0"'], [0.0625, '1/16" = 1\'-0"']]
  const pick = options.find(([s]) => (plan.width / 12) * s <= availW && (plan.height / 12) * s <= availH) || options[options.length - 1]
  const [scale, scaleLabel] = pick
  const drawW = (plan.width / 12) * scale
  const drawH = (plan.height / 12) * scale
  const date = new Date(design.createdAt || Date.now()).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  const ab = design.asBuilt || design.program || {}
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(design.client || 'Draft')} floor plan</title>
<style>
  @page { size: ${pageW}in ${pageH}in; margin: ${margin}in; }
  html, body { margin: 0; background: #fff; font-family: Helvetica, Arial, sans-serif; color: #1a1a1a; }
  .sheet { width: ${availW}in; height: ${pageH - 2 * margin}in; position: relative; margin: ${margin}in auto; box-sizing: border-box; border: 1.5px solid #1a1a1a; }
  .drawing { position: absolute; left: ${((availW - drawW) / 2).toFixed(3)}in; top: ${((availH - drawH) / 2).toFixed(3)}in; width: ${drawW.toFixed(3)}in; height: ${drawH.toFixed(3)}in; }
  .drawing svg { width: 100%; height: 100%; }
  .block { position: absolute; left: 0; right: 0; bottom: 0; height: ${blockH}in; border-top: 1.5px solid #1a1a1a; display: grid; grid-template-columns: 2.2fr 2fr 1.4fr 1fr; font-size: 9pt; }
  .block > div { padding: 0.08in 0.14in; border-right: 1px solid #1a1a1a; }
  .block > div:last-child { border-right: 0; }
  .block b { display: block; font-size: 11pt; margin-bottom: 2px; }
  .block small { color: #555; font-size: 7.5pt; display: block; }
  @media screen { body { background: #e9e6df; } .sheet { background: #fff; box-shadow: 0 2px 12px rgba(0,0,0,0.2); } .print-hint { text-align: center; font-size: 12px; color: #555; margin: 6px 0 14px; } }
  @media print { .print-hint { display: none; } }
</style></head>
<body>
<p class="print-hint">Print this page and choose "Save as PDF" (tabloid 17 × 11, landscape). Scale ${esc(scaleLabel)}.</p>
<div class="sheet">
  <div class="drawing">${plan.svg}</div>
  <div class="block">
    <div><b>${esc(titleBlock.firm || 'South Texas Builders')}</b><small>${esc(titleBlock.address || '')}</small><small>${esc(titleBlock.phone || '')}</small></div>
    <div><b>${esc(design.client || 'Client')}</b><small>${esc(lotTitle(design))}</small><small>${esc(design.style?.name || '')} · ${ab.beds} bed, ${ab.baths}${ab.halfBath ? '.5' : ''} bath${ab.garage ? `, ${ab.garage}-car` : ''}</small></div>
    <div><b>Floor plan</b><small>Scale ${esc(scaleLabel)}</small><small>${esc(date)}</small></div>
    <div><b>A-200</b><small>Draft House ${design.contract ? 'v' + design.contract : ''}</small><small>preliminary, not for construction</small></div>
  </div>
</div>
</body></html>`
}

/**
 * The homeowner's summary after sending: the plan, the price range, what the audit checked (the
 * "passed" list), what happens next. A complete HTML document to print as a PDF.
 * @param {object} design  design.json
 * @param {object} price   from pricing.estimate()
 * @param {object} audit   from audit.auditSummary() (groups with ok)
 * @param {object} trust   TRUST (team, drafter, next)
 */
export function summaryHTML(design, price, audit, trust, titleBlock = {}) {
  const plan = planSVG(design)
  const ab = design.asBuilt || design.program || {}
  const k = (n) => '$' + Math.round(n / 1000).toLocaleString() + 'k'
  const date = new Date(design.createdAt || Date.now()).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  const checks = (audit?.groups || []).map((g) => `<li class="${g.ok ? 'ok' : 'bad'}">${g.ok ? '✓' : '✗'} ${esc(g.name)}</li>`).join('')
  const next = (trust?.next || []).map((n) => `<li><b>${esc(n.when)}</b> ${esc(n.what)}</li>`).join('')
  const garageRate = price && price.areas.garage ? `garage $${Math.round(price.parts.garage[0] / price.areas.garage)}–${Math.round(price.parts.garage[1] / price.areas.garage)}/sf · ` : ''
  const priceLine = price ? `$${price.perSf[0]}–${price.perSf[1]}/sf living · ${garageRate}${esc(price.county)}. ${esc(price.note)}${price.confirmed ? '' : ' Rates to be confirmed by South Texas Builders.'}` : ''
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(design.client || 'Your house')} · summary</title>
<style>
  @page { size: letter portrait; margin: 0.5in; }
  body { margin: 0; font-family: Helvetica, Arial, sans-serif; color: #1a1a1a; background: #fff; }
  .page { max-width: 7.5in; margin: 0 auto; padding: 0.3in 0; }
  h1 { font-size: 20pt; margin: 0 0 2px; } h2 { font-size: 12pt; margin: 18px 0 6px; letter-spacing: 0.06em; text-transform: uppercase; }
  .sub { color: #555; font-size: 10pt; margin: 0 0 10px; }
  .plan svg { width: 100%; height: auto; border: 1px solid #ddd; }
  .price { font-size: 22pt; font-weight: 700; margin: 2px 0; }
  .fine { font-size: 8.5pt; color: #555; }
  ul.checks { list-style: none; padding: 0; margin: 0; columns: 2; font-size: 9.5pt; } ul.checks li { margin: 2px 0; } ul.checks li.ok { color: #2a7a3b; } ul.checks li.bad { color: #b3261e; }
  ol.next { padding-left: 18px; font-size: 10pt; } ol.next b { display: inline-block; min-width: 150px; }
  .foot { margin-top: 18px; border-top: 1px solid #1a1a1a; padding-top: 6px; font-size: 8.5pt; color: #555; display: flex; justify-content: space-between; }
  @media screen { body { background: #e9e6df; } .page { background: #fff; padding: 0.5in; box-shadow: 0 2px 12px rgba(0,0,0,0.2); margin: 20px auto; } .print-hint { text-align: center; font-size: 12px; color: #555; margin: 6px 0; } }
  @media print { .print-hint { display: none; } }
</style></head>
<body>
<p class="print-hint">Print this page and choose "Save as PDF".</p>
<div class="page">
  <h1>${esc(design.client || 'Your house')}</h1>
  <p class="sub">${esc(lotTitle(design))} · ${esc(design.style?.name || '')} · ${ab.beds} bed, ${ab.baths}${ab.halfBath ? '.5' : ''} bath${ab.garage ? `, ${ab.garage}-car garage` : ''} · ${design.livingSf ? design.livingSf.toLocaleString() + ' sf' : ''} · ${esc(date)}</p>
  <div class="plan">${plan.svg}</div>
  <h2>Price range</h2>
  <p class="price">${price ? `${k(price.low)}–${k(price.high)}` : '—'}</p>
  <p class="fine">${priceLine}</p>
  <h2>Checked before you saw it</h2>
  <ul class="checks">${checks}</ul>
  <h2>What happens next</h2>
  <ol class="next">${next}</ol>
  <div class="foot"><span>${esc(titleBlock.firm || 'South Texas Builders')} · ${esc(titleBlock.phone || '')}</span><span>${esc(trust?.team || '')}</span><span>preliminary, not for construction</span></div>
</div>
</body></html>`
}
