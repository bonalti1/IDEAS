// The floor plan as an architectural drawing, built from design.json: wall poché at true thickness,
// door swings, window symbols, fixture symbols, exterior dimension strings, room labels that never
// overlap, a north arrow, a graphic scale and a title. Pure: a string of SVG, plus the label boxes
// so a test can prove no two overlap. Units inside the SVG are inches of the house (1 ft = 12).
//
// The frame is design.json's: x along the front, z toward the street (down the page).

import { drivewaySlabs, walkSlabs, lotCoverage } from './site.js'

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
      return `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" ${thin}/><text x="${r1(cx)}" y="${r1(cy + 2.5)}" font-size="6" text-anchor="middle" fill="#333" font-family="LiberationSans, Helvetica, Arial, sans-serif">REF</text>`
    case 'washer':
    case 'dryer':
      return `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" ${thin}/><circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(Math.min(w, h) * 0.3)}" ${thin}/><text x="${r1(cx)}" y="${r1(cy + 2)}" font-size="5" text-anchor="middle" fill="#333" font-family="LiberationSans, Helvetica, Arial, sans-serif">${f.kind === 'washer' ? 'W' : 'D'}</text>`
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
/** A font size at which `text` fits `avail` units wide (no smaller than `min`); k is the mean glyph width as a share of the size. */
export function fitFont(text, size, avail, min = size * 0.6, k = 0.6) {
  const need = Math.max(1, String(text).length) * k
  return Math.max(min, Math.min(size, avail / need))
}

/**
 * The same drawing cropped to a box (drawing units): its viewBox narrows to the box, and a match line
 * with its note is drawn on the edge named (for a plan split over two tabloid sheets).
 * @param {string} svgText  a planSVG().svg
 * @param {{x:number,y:number,w:number,h:number}} box
 * @param {{ side: 'e'|'w'|'n'|'s', at: number, note: string }|null} match
 */
export function cropSVG(svgText, box, match = null) {
  const head = (svgText.match(/^<svg[^>]*>/) || [''])[0]
  if (!head) return svgText
  const rest = svgText.slice(head.length)
  const newHead = head
    .replace(/viewBox="[^"]*"/, `viewBox="${r1(box.x)} ${r1(box.y)} ${r1(box.w)} ${r1(box.h)}"`)
    .replace(/ width="[^"]*"/, ` width="${r1(box.w)}"`)
    .replace(/ height="[^"]*"/, ` height="${r1(box.h)}"`)
  let extra = ''
  if (match) {
    const vertical = match.side === 'e' || match.side === 'w'
    const a = match.at
    const line = vertical
      ? `<line x1="${r1(a)}" y1="${r1(box.y)}" x2="${r1(a)}" y2="${r1(box.y + box.h)}" stroke="#1a1a1a" stroke-width="1.4" stroke-dasharray="14 7"/>`
      : `<line x1="${r1(box.x)}" y1="${r1(a)}" x2="${r1(box.x + box.w)}" y2="${r1(a)}" stroke="#1a1a1a" stroke-width="1.4" stroke-dasharray="14 7"/>`
    const tx = vertical ? a + (match.side === 'e' ? -6 : 10) : box.x + box.w / 2
    const ty = vertical ? box.y + box.h / 2 : a + (match.side === 's' ? -5 : 11)
    const text = `<text x="${r1(tx)}" y="${r1(ty)}" font-size="9" font-weight="700" letter-spacing="0.12em" text-anchor="middle" font-family="LiberationSans, Helvetica, Arial, sans-serif" fill="#1a1a1a"${vertical ? ` transform="rotate(-90 ${r1(tx)} ${r1(ty)})"` : ''}>${esc(match.note)}</text>`
    extra = `<g class="match-line">${line}${text}</g>`
  }
  return newHead + rest.replace(/<\/svg>\s*$/, extra + '</svg>')
}

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
  const font = 'font-family="LiberationSans, Helvetica, Arial, sans-serif"'

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
    if (d.pocket || d.barn) {
      // a pocket door: the leaf drawn half into its pocket in the wall; a barn door: the leaf on the wall face
      if (d.axis === 'h') out.push(`<line class="leaf" x1="${r1(gx + wIn / 2)}" y1="${r1(gy + t / 2 + (d.barn ? (d.swing === -1 ? -t : t) : 0))}" x2="${r1(gx + wIn + (d.barn ? 0 : wIn / 2))}" y2="${r1(gy + t / 2 + (d.barn ? (d.swing === -1 ? -t : t) : 0))}" stroke="#333" stroke-width="1"${d.pocket ? ' stroke-dasharray="3 2"' : ''}/>`)
      else out.push(`<line class="leaf" x1="${r1(gx + t / 2 + (d.barn ? (d.swing === -1 ? -t : t) : 0))}" y1="${r1(gy + wIn / 2)}" x2="${r1(gx + t / 2 + (d.barn ? (d.swing === -1 ? -t : t) : 0))}" y2="${r1(gy + wIn + (d.barn ? 0 : wIn / 2))}" stroke="#333" stroke-width="1"${d.pocket ? ' stroke-dasharray="3 2"' : ''}/>`)
      return
    }
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

  // ── room labels: name and size inside the room, on a spot clear of its fixtures and of other labels
  // (the centre first, then outward), shrunk when the room is tight, a leader when nothing fits ──
  const labels = []
  const baseFont = opts.labelFont || 9
  const textW = (s, size) => s.length * size * 0.6
  const placed = []
  const fixBoxes = fixtures.map((f) => ({ room: f.room, x: X(f.x - f.w / 2), y: Y(f.z - f.d / 2), w: f.w * IN, h: f.d * IN }))
  rooms
    .slice()
    .sort((a, b) => b.w * b.d - a.w * a.d)
    .forEach((r) => {
      const name = r.name.toUpperCase()
      const size = `${fmt(r.w)} × ${fmt(r.d)}`
      const inner = { x: X(r.x - r.w / 2) + 4, y: Y(r.z - r.d / 2) + 4, w: r.w * IN - 8, h: r.d * IN - 8 }
      const mine = fixBoxes.filter((b) => b.room === r.id)
      const clearAt = (box) => box.x >= inner.x - 0.01 && box.y >= inner.y - 0.01 && box.x + box.w <= inner.x + inner.w + 0.01 && box.y + box.h <= inner.y + inner.h + 0.01 && !mine.some((b) => overlapBox(b, box)) && !placed.some((p) => overlapBox(p.box, box))
      const cx = X(r.x)
      const cy = Y(r.z)
      // a spot for a w x h box: the centre, then rings of offsets inside the room's walls
      const spotFor = (w, h) => {
        if (w > inner.w + 0.01 || h > inner.h + 0.01) return null
        const sx = Math.max(6, w * 0.25)
        const sy = Math.max(4, h * 0.5)
        const nx = Math.ceil((inner.w - w) / 2 / sx)
        const ny = Math.ceil((inner.h - h) / 2 / sy)
        const seen = new Set()
        for (let ring = 0; ring <= Math.max(nx, ny); ring++) {
          for (let j = 0; j <= Math.min(ring, ny); j++) {
            for (let i = 0; i <= Math.min(ring, nx); i++) {
              if (Math.max(i, j) !== ring) continue
              for (const [si, sj] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
                const dx = i * si * sx
                const dy = j * sj * sy
                const key = dx + ',' + dy
                if (seen.has(key)) continue
                seen.add(key)
                const box = { x: Math.min(Math.max(cx - w / 2 + dx, inner.x), inner.x + inner.w - w), y: Math.min(Math.max(cy - h / 2 + dy, inner.y), inner.y + inner.h - h), w, h }
                if (clearAt(box)) return box
              }
            }
          }
        }
        return null
      }
      let f = baseFont
      let lines = [name, size]
      let box = null
      let w = 0
      let h = 0
      for (let size2 = baseFont; size2 >= 6 && !box; size2 -= 0.5) {
        f = size2
        w = Math.max(textW(name, f), textW(size, f * 0.85))
        h = f * 2.3
        box = spotFor(w, h)
      }
      if (!box) {
        lines = [name]
        for (let size2 = baseFont - 1; size2 >= 5 && !box; size2 -= 0.5) {
          f = size2
          w = textW(name, f)
          h = f * 1.2
          box = spotFor(w, h)
        }
      }
      let leader = null
      if (!box) {
        // nothing fits inside: the name outside the house with a leader, below the plan
        f = 6
        w = textW(name, f)
        h = f * 1.2
        const lx = cx
        const ly = Y(maxZ) + 30 + placed.filter((p) => p.leader).length * 12
        box = { x: lx - w / 2, y: ly - h / 2, w, h }
        for (let tries = 0; tries < 40 && placed.some((p) => overlapBox(p.box, box)); tries++) box = { ...box, y: box.y + 3 }
        leader = [cx, cy, lx, box.y]
      }
      placed.push({ r, box, f, lines, leader, room: { x: inner.x - 4, y: inner.y - 4, w: inner.w + 8, h: inner.h + 8 } })
    })
  placed.forEach(({ r, box, f, lines, leader, room }) => {
    const cx = box.x + box.w / 2
    const y0 = box.y + f
    labels.push({ id: r.id, x: box.x, y: box.y, w: box.w, h: box.h, text: lines.join(' '), leader: !!leader, room })
    if (leader) out.push(`<line class="leader" x1="${r1(leader[0])}" y1="${r1(leader[1])}" x2="${r1(leader[2])}" y2="${r1(leader[3])}" stroke="#555" stroke-width="0.6"/>`)
    out.push(`<text class="label" data-id="${esc(r.id)}" x="${r1(cx)}" y="${r1(y0)}" text-anchor="middle" ${font} fill="#1a1a1a"><tspan font-size="${f}" font-weight="700" letter-spacing="0.06em">${esc(lines[0])}</tspan>${lines[1] ? `<tspan x="${r1(cx)}" dy="${r1(f * 1.1)}" font-size="${r1(f * 0.85)}">${esc(lines[1])}</tspan>` : ''}</text>`)
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
  const availT = width - X(minX) - 36
  const tf = fitFont(title, 13, availT, 8, 0.62)
  const sf2 = fitFont(`FLOOR PLAN · ${sub}`, 8, availT, 5.5, 0.56)
  out.push(`<g id="title" class="title"><text x="${r1(X(minX))}" y="${r1(Y(minZ) - 6.6 * IN)}" font-size="${r1(tf)}" font-weight="700" ${font} fill="#1a1a1a">${esc(title)}</text><text x="${r1(X(minX))}" y="${r1(Y(minZ) - 6.6 * IN + 15)}" font-size="${r1(sf2)}" ${font} fill="#555">FLOOR PLAN · ${esc(sub)}</text></g>`)

  const defs = `<defs><pattern id="porchHatch" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="8" stroke="#d8d3c8" stroke-width="1"/></pattern></defs>`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r1(width)} ${r1(height)}" width="${r1(width)}" height="${r1(height)}" class="floor-plan"><rect width="${r1(width)}" height="${r1(height)}" fill="#fff"/>${defs}${out.join('')}</svg>`
  return { svg, width, height, labels, dims, minX, minZ, originX: X(minX), originY: Y(minZ), scaleNote: 'drawn in inches of the house: 1 ft = 12 units' }
}


/**
 * The site plan from design.json: lot lines with their lengths, the setback envelope (dashed) with each
 * setback labelled, the house footprint on the lot, the driveway and the front walk, the street name(s),
 * a north arrow, a graphic scale, and the lot coverage. World feet on the page (north up): 1 ft = 12 units
 * like the floor plan, so the same sheet scales apply.
 */
export function sitePlanSVG(design, opts = {}) {
  const lot = design.lot
  const rooms = design.rooms || []
  if (!lot?.boundary?.length || !rooms.length) return { svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>', width: 10, height: 10, coverage: null, slabs: [] }
  const angle = lot.angle || 0
  const c = lot.centre || [0, 0]
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const world = (lx, lz) => [c[0] + lx * cos - lz * sin, c[1] + lx * sin + lz * cos]
  const boundary = lot.boundary
  const envelope = lot.envelope || []
  const xs = boundary.map((p) => p[0])
  const zs = boundary.map((p) => p[1])
  const M = 24 // margin feet for labels, the street and the north arrow
  const F = 4.5 // lettering is sized for 1" = 20': 4.5 times the floor plan's
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minZ = Math.min(...zs)
  const maxZ = Math.max(...zs)
  const TOP = 24
  const X = (ft) => (ft - minX + M) * IN
  const Y = (ft) => (ft - minZ + M + TOP) * IN
  const width = (maxX - minX + 2 * M) * IN
  const height = (maxZ - minZ + 2 * M + TOP) * IN
  const font = 'font-family="LiberationSans, Helvetica, Arial, sans-serif"'
  const out = []
  const poly = (pts) => pts.map((p) => `${r1(X(p[0]))},${r1(Y(p[1]))}`).join(' ')
  // a rotated rectangle in the house frame → world polygon
  const rectPoly = (x, z, w, d) => [[x - w / 2, z - d / 2], [x + w / 2, z - d / 2], [x + w / 2, z + d / 2], [x - w / 2, z + d / 2]].map(([lx, lz]) => world(lx, lz))

  // ── the lot, the envelope ──
  out.push(`<polygon id="lot-lines" points="${poly(boundary)}" fill="#f6f5f0" stroke="#1a1a1a" stroke-width="3"/>`)
  if (envelope.length >= 3) out.push(`<polygon id="setbacks" points="${poly(envelope)}" fill="none" stroke="#7a7266" stroke-width="1.8" stroke-dasharray="24 12"/>`)
  // ── the driveway and the walk, then the house ──
  const slabs = drivewaySlabs(rooms, design.doors || [], lot)
  const walk = walkSlabs(rooms, design.doors || [], lot, slabs)
  slabs.forEach((sl) => out.push(`<polygon class="driveway" points="${poly(rectPoly(sl.x, sl.z, sl.w, sl.d))}" fill="#e3dfd6" stroke="#8d8578" stroke-width="1.5"/>`))
  walk.forEach((sl) => out.push(`<polygon class="walk" points="${poly(rectPoly(sl.x, sl.z, sl.w, sl.d))}" fill="#e3dfd6" stroke="#8d8578" stroke-width="1.5"/>`))
  rooms.forEach((r) => {
    out.push(`<polygon class="footprint ${r.open ? 'porch' : r.kind}" points="${poly(rectPoly(r.x, r.z, r.w, r.d))}" fill="${r.open ? 'url(#porchHatch)' : r.kind === 'garage' ? '#ebe8e1' : '#fbfaf7'}" stroke="#1a1a1a" stroke-width="${r.open ? 1 : 2}"/>`)
  })
  // the house, named once at its centre; the garage and the porches named small
  const solid = rooms.filter((r) => !r.open)
  const hx = solid.reduce((s2, r) => s2 + r.x * r.w * r.d, 0) / solid.reduce((s2, r) => s2 + r.w * r.d, 0)
  const hz = solid.reduce((s2, r) => s2 + r.z * r.w * r.d, 0) / solid.reduce((s2, r) => s2 + r.w * r.d, 0)
  const [hwx, hwz] = world(hx, hz)
  const ab = design.asBuilt || design.program || {}
  out.push(`<text x="${r1(X(hwx))}" y="${r1(Y(hwz))}" font-size="${9 * F}" font-weight="700" text-anchor="middle" ${font} fill="#1a1a1a" transform="rotate(${r1((angle * 180) / Math.PI)} ${r1(X(hwx))} ${r1(Y(hwz))})">${esc(design.style?.name || 'House')} · ${design.livingSf ? design.livingSf.toLocaleString() + ' sf' : ''}</text>`)
  rooms.filter((r) => r.open || r.kind === 'garage').forEach((r) => {
    const [wx, wz] = world(r.x, r.z)
    out.push(`<text x="${r1(X(wx))}" y="${r1(Y(wz) + 2 * F)}" font-size="${5.5 * F}" text-anchor="middle" ${font} fill="#555">${esc(r.name)}</text>`)
  })
  slabs.filter((sl) => sl.part === 'drive').slice(-1).forEach((sl) => {
    const [wx, wz] = world(sl.x, sl.z)
    out.push(`<text x="${r1(X(wx))}" y="${r1(Y(wz) + 2 * F)}" font-size="${5.5 * F}" text-anchor="middle" ${font} fill="#555" transform="rotate(${r1((angle * 180) / Math.PI + (sl.d > sl.w ? 90 : 0))} ${r1(X(wx))} ${r1(Y(wz))})">driveway</text>`)
  })

  // ── lot lines: length on each edge, the street names and setbacks ──
  const corners = lot.corners && lot.corners.length >= 3 ? lot.corners : boundary
  const edges = lot.edges || []
  const cx0 = corners.reduce((s2, p) => s2 + p[0], 0) / corners.length
  const cz0 = corners.reduce((s2, p) => s2 + p[1], 0) / corners.length
  corners.forEach((a, i) => {
    const b = corners[(i + 1) % corners.length]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    const mx = (a[0] + b[0]) / 2
    const mz = (a[1] + b[1]) / 2
    // outward: away from the lot's centre
    let nx = -(b[1] - a[1]) / len
    let nz = (b[0] - a[0]) / len
    if ((mx - cx0) * nx + (mz - cz0) * nz < 0) {
      nx = -nx
      nz = -nz
    }
    let deg = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI
    if (deg > 90 || deg < -90) deg += 180
    const lx = X(mx + nx * 4)
    const ly = Y(mz + nz * 4)
    out.push(`<text class="lot-dim" x="${r1(lx)}" y="${r1(ly + 2)}" font-size="${6.5 * F}" text-anchor="middle" ${font} fill="#1a1a1a" transform="rotate(${r1(deg)} ${r1(lx)} ${r1(ly)})">${fmt(len)}</text>`)
    const e = edges[i]
    if (e?.street) {
      const sx = X(mx + nx * 11)
      const sy = Y(mz + nz * 11)
      out.push(`<text class="street" x="${r1(sx)}" y="${r1(sy + 3)}" font-size="${8 * F}" letter-spacing="${2 * F}" text-anchor="middle" ${font} fill="#1a1a1a" transform="rotate(${r1(deg)} ${r1(sx)} ${r1(sy)})">${esc(String(e.street).toUpperCase())}</text>`)
    }
    if (e?.setback) {
      const ix = X(mx - nx * (e.setback / 2))
      const iy = Y(mz - nz * (e.setback / 2))
      out.push(`<text class="setback" x="${r1(ix)}" y="${r1(iy + 2)}" font-size="${5 * F}" text-anchor="middle" ${font} fill="#7a7266" transform="rotate(${r1(deg)} ${r1(ix)} ${r1(iy)})">${e.setback}' ${e.kind === 'front' ? 'front' : e.kind === 'rear' ? 'rear' : e.kind === 'streetSide' ? 'street side' : 'side'} setback</text>`)
    }
  })

  // ── north arrow, scale, coverage, title ──
  const nx = X(maxX) + 14 * IN
  const ny = Y(minZ) + 6 * IN
  out.push(`<g id="north" class="north" transform="translate(${r1(nx)} ${r1(ny)}) scale(${F})"><circle r="14" fill="none" stroke="#1a1a1a" stroke-width="0.8"/><polygon points="0,-13 -5,4 0,0 5,4" fill="#1a1a1a"/><text y="-17" font-size="8" text-anchor="middle" ${font} font-weight="700" fill="#1a1a1a">N</text></g>`)
  const sx = X(minX)
  const sy = Y(maxZ) + 18 * IN
  out.push(`<g id="scale" class="scale">${[0, 10, 20].map((a, i) => `<rect x="${r1(sx + a * IN)}" y="${r1(sy)}" width="${r1(([10, 20, 40][i] - a) * IN)}" height="${4 * F}" fill="${i % 2 ? '#fff' : '#1a1a1a'}" stroke="#1a1a1a" stroke-width="1.5"/>`).join('')}${[0, 10, 20, 40].map((a) => `<text x="${r1(sx + a * IN)}" y="${r1(sy + 12 * F)}" font-size="${6 * F}" text-anchor="middle" ${font} fill="#1a1a1a">${a}'</text>`).join('')}<text x="${r1(sx + 40 * IN + 14 * F)}" y="${r1(sy + 5 * F)}" font-size="${6 * F}" ${font} fill="#1a1a1a">graphic scale, feet</text></g>`)
  const cover = lotCoverage(rooms, lot)
  const date = opts.date || new Date(design.createdAt || Date.now()).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  const title = opts.title || `${design.client || 'Draft'} · ${lotTitle(design)}`
  const coverText = cover.pct !== null ? `lot coverage ${cover.pct}% (${cover.footprintSf.toLocaleString()} sf of ${cover.lotSf.toLocaleString()} sf)` : `${cover.footprintSf.toLocaleString()} sf footprint`
  const subSite = `SITE PLAN · ${lot.cityName || lot.city || ''} · ${ab.beds} bed, ${ab.baths}${ab.halfBath ? '.5' : ''} bath${ab.garage ? `, ${ab.garage}-car` : ''} · ${date}`
  const availS = width - X(minX) - 10 * F
  const tfS = fitFont(title, 13 * F, availS, 8 * F, 0.62)
  const sfS = fitFont(subSite, 8 * F, availS, 5.5 * F, 0.56)
  const cfS = fitFont(coverText, 8 * F, availS, 5.5 * F, 0.56)
  out.push(`<g id="title" class="title"><text x="${r1(X(minX))}" y="${r1(Y(minZ) - 20 * IN)}" font-size="${r1(tfS)}" font-weight="700" ${font} fill="#1a1a1a">${esc(title)}</text><text x="${r1(X(minX))}" y="${r1(Y(minZ) - 20 * IN + 15 * F)}" font-size="${r1(sfS)}" ${font} fill="#555">${esc(subSite)}</text><text x="${r1(X(minX))}" y="${r1(Y(minZ) - 20 * IN + 28 * F)}" font-size="${r1(cfS)}" ${font} fill="#555" id="coverage">${esc(coverText)}</text></g>`)
  const defs = `<defs><pattern id="porchHatch" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="8" stroke="#d8d3c8" stroke-width="1"/></pattern></defs>`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r1(width)} ${r1(height)}" width="${r1(width)}" height="${r1(height)}" class="site-plan"><rect width="${r1(width)}" height="${r1(height)}" fill="#fff"/>${defs}${out.join('')}</svg>`
  return { svg, width, height, coverage: cover, slabs: [...slabs, ...walk] }
}

/**
 * Sheet sizes and the scales a builder or a bank reads: 1/4" = 1'-0" on 24 x 36 (ARCH D), 1/8" on
 * tabloid (17 x 11). The site plan goes at 1" = 20' (engineering) on either. The drawing is 12 units
 * per foot, so `scale` is inches of paper per foot of house.
 */
export const SHEETS = {
  archD: { id: 'archD', name: '24 × 36 (ARCH D)', pageW: 36, pageH: 24, margin: 0.75, blockH: 1.4, plan: [0.25, '1/4" = 1\'-0"'], site: [1 / 20, '1" = 20\'-0"'] },
  tabloid: { id: 'tabloid', name: '11 × 17 (tabloid)', pageW: 17, pageH: 11, margin: 0.3, blockH: 0.9, plan: [0.125, '1/8" = 1\'-0"'], site: [1 / 40, '1" = 40\'-0"'] },
}
/** The site plan's scale on a sheet: the largest engineering scale (1" = 10', 20', 30', 40', 50') the lot fits at. */
export function siteScaleFor(site, S) {
  const w = site.width / 12
  const h = site.height / 12
  const scales = [[1 / 10, '1" = 10\'-0"'], [1 / 20, '1" = 20\'-0"'], [1 / 30, '1" = 30\'-0"'], [1 / 40, '1" = 40\'-0"'], [1 / 50, '1" = 50\'-0"']]
  return scales.find(([sc]) => w * sc <= S.availW && h * sc <= S.availH) || scales[scales.length - 1]
}
/**
 * The sheet a plan fits at its scale: ARCH D at 1/4" (two sheets with a match line when the house is long) unless asked for
 * tabloid, which is always 1/8": a plan too deep or too wide for one tabloid sheet goes on two, split
 * across the overflowing axis with a match line (`split: 'rows'` top and bottom, `'cols'` left and right).
 */
export function sheetFor(plan, sheetId = 'archD') {
  const S = SHEETS[sheetId] || SHEETS.archD
  // one scale a builder reads per sheet: 1/4" on 24 x 36, 1/8" on tabloid; a plan that runs past one sheet goes on two
  const scales = S.id === 'archD' ? [[0.25, '1/4" = 1\'-0"']] : [[0.125, '1/8" = 1\'-0"']]
  const w = plan.width / 12
  const h = plan.height / 12
  // the sheet's own scale, landscape; else turned portrait; else the next scale down, each a scale a builder reads
  for (const [scale, label] of scales) {
    for (const orientation of ['landscape', 'portrait']) {
      const pageW = orientation === 'landscape' ? Math.max(S.pageW, S.pageH) : Math.min(S.pageW, S.pageH)
      const pageH = orientation === 'landscape' ? Math.min(S.pageW, S.pageH) : Math.max(S.pageW, S.pageH)
      const availW = pageW - 2 * S.margin
      const availH = pageH - 2 * S.margin - S.blockH
      if (w * scale <= availW && h * scale <= availH) return { ...S, pageW, pageH, orientation, availW, availH, plan: [scale, label], fits: true }
    }
  }
  const availW = S.pageW - 2 * S.margin
  const availH = S.pageH - 2 * S.margin - S.blockH
  const [sc, label] = scales[0]
  const split = h * sc > availH ? 'rows' : 'cols'
  return { ...S, orientation: 'landscape', availW, availH, plan: [sc, label], fits: true, split }
}

/**
 * Printable sheets: the floor plan at 1/4" = 1'-0" on 24 x 36 (ARCH D), or 1/8" on tabloid when asked,
 * and the site plan at 1" = 20' (1" = 40' on tabloid), each with the title block. A complete HTML
 * document (the print preview; the PDF file is built by pdf.js from the same drawings).
 */
export function planSheetHTML(design, titleBlock = {}, opts = {}) {
  const plan = planSVG(design, opts)
  const site = sitePlanSVG(design, opts)
  const S = sheetFor(plan, opts.sheet)
  const { pageW, pageH, margin, blockH, availW, availH } = S
  const [scale, scaleLabel] = S.plan
  const [siteScale, siteLabel] = siteScaleFor(site, S)
  const date = new Date(design.createdAt || Date.now()).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  const ab = design.asBuilt || design.program || {}
  const place = (drawing, sc) => {
    const w = (drawing.width / 12) * sc
    const h = (drawing.height / 12) * sc
    return `left: ${((availW - w) / 2).toFixed(3)}in; top: ${(Math.max(0, availH - h) / 2).toFixed(3)}in; width: ${w.toFixed(3)}in; height: ${h.toFixed(3)}in;`
  }
  const block = (what, scaleText, number) => `<div class="block">
    <div><b>${esc(titleBlock.firm || 'South Texas Builders')}</b><small>${esc(titleBlock.address || '')}</small><small>${esc(titleBlock.phone || '')}</small></div>
    <div><b>${esc(design.client || 'Client')}</b><small>${esc(lotTitle(design))}</small><small>${esc(design.style?.name || '')} · ${ab.beds} bed, ${ab.baths}${ab.halfBath ? '.5' : ''} bath${ab.garage ? `, ${ab.garage}-car` : ''}</small></div>
    <div><b>${esc(what)}</b><small>Scale ${esc(scaleText)}</small><small>${esc(date)}</small></div>
    <div><b>${esc(number)}</b><small>Draft House ${design.contract ? 'v' + design.contract : ''} · ${esc(S.name)}</small><small>preliminary, not for construction</small></div>
  </div>`
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(design.client || 'Draft')} floor plan</title>
<style>
  @page { size: ${pageW}in ${pageH}in; margin: ${margin}in; }
  html, body { margin: 0; background: #fff; font-family: LiberationSans, Helvetica, Arial, sans-serif; color: #1a1a1a; }
  .sheet { width: ${availW}in; height: ${pageH - 2 * margin}in; position: relative; margin: ${margin}in auto; box-sizing: border-box; border: 1.5px solid #1a1a1a; page-break-after: always; }
  .sheet:last-child { page-break-after: auto; }
  .drawing { position: absolute; }
  .drawing svg { width: 100%; height: 100%; }
  .block { position: absolute; left: 0; right: 0; bottom: 0; height: ${blockH}in; border-top: 1.5px solid #1a1a1a; display: grid; grid-template-columns: 2.2fr 2fr 1.4fr 1fr; font-size: ${S.id === 'archD' ? 11 : 9}pt; background: #fff; }
  .block > div { padding: 0.08in 0.14in; border-right: 1px solid #1a1a1a; }
  .block > div:last-child { border-right: 0; }
  .block b { display: block; font-size: ${S.id === 'archD' ? 13 : 11}pt; margin-bottom: 2px; }
  .block small { color: #555; font-size: ${S.id === 'archD' ? 9 : 7.5}pt; display: block; }
  .note { position: absolute; left: 0.2in; bottom: ${blockH + 0.1}in; font-size: 8pt; color: #b3261e; }
  @media screen { body { background: #e9e6df; } .sheet { background: #fff; box-shadow: 0 2px 12px rgba(0,0,0,0.2); } .print-hint { text-align: center; font-size: 12px; color: #555; margin: 6px 0 14px; } }
  @media print { .print-hint { display: none; } }
</style></head>
<body>
<p class="print-hint">Print this page and choose "Save as PDF" (${esc(S.name)}, landscape). Floor plan at ${esc(scaleLabel)}, site plan at ${esc(siteLabel)}.</p>
<div class="sheet">
  <div class="drawing" style="${place(plan, scale)}">${plan.svg}</div>
  ${S.fits ? '' : `<p class="note">This plan is too large for ${esc(scaleLabel)} on ${esc(S.name)}; it is drawn to fit.</p>`}
  ${block('Floor plan', scaleLabel, 'A-200')}
</div>
<div class="sheet">
  <div class="drawing" style="${place(site, siteScale)}">${site.svg}</div>
  ${block('Site plan', siteLabel, 'A-100')}
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
/** The client's printable summary: the plan, the checks, what happens next; no money (round 8, P0b). */
export function summaryHTML(design, audit, trust, titleBlock = {}) {
  return summaryPage(design, null, audit, trust, titleBlock, { internal: false })
}
/** The office's printable "Meeting prep" page: the summary with the estimate block, marked internal. */
export function meetingPrepHTML(design, price, audit, trust, titleBlock = {}) {
  return summaryPage(design, price, audit, trust, titleBlock, { internal: true })
}
function summaryPage(design, price, audit, trust, titleBlock = {}, { internal = false } = {}) {
  const plan = planSVG(design)
  const ab = design.asBuilt || design.program || {}
  const k = (n) => '$' + Math.round(n / 1000).toLocaleString() + 'k'
  const date = new Date(design.createdAt || Date.now()).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  const checks = (audit?.groups || []).map((g) => `<li class="${g.ok ? 'ok' : 'bad'}">${g.ok ? '✓' : '✗'} ${esc(g.name)}</li>`).join('')
  const next = (trust?.next || []).map((n) => `<li><b>${esc(n.when)}</b> ${esc(n.what)}</li>`).join('')
  const money = internal && price
  const parts = money ? ['living', 'garage', 'porches', 'flatwork'].filter((x) => price.parts?.[x] && price.areas?.[x]).map((x) => `${x === 'flatwork' ? 'driveway and walk' : x} $${Math.round(price.parts[x][0]).toLocaleString()}–${Math.round(price.parts[x][1]).toLocaleString()}`) : []
  const extra = money ? (price.lines || []).map((l) => esc(`${l.label} ${l.amount || l.text || ''}`.trim())) : []
  const priceLine = money ? `$${price.perSf[0]}–${price.perSf[1]}/sf living · ${esc(price.county || 'county not set')}. ${parts.map(esc).join(' · ')}${extra.length ? ' · ' + extra.join(' · ') : ''}. ${esc(price.note)}${price.confirmed ? '' : ' Rates to be confirmed by South Texas Builders.'}` : ''
  const costBlock = money
    ? `<h2>${price.confirmed ? 'Price range (office)' : 'Estimate (office)'}</h2>\n  <p class="price">${price.needsCounty ? 'county not set' : `${k(price.low)}–${k(price.high)}`}</p>\n  <p class="fine">${priceLine}</p>`
    : `<h2>What it costs</h2>\n  <p>${esc(String(trust?.costLine || 'We go over cost with you at your meeting with the South Texas Builders office.'))}</p>`
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(design.client || 'Your house')} · summary</title>
<style>
  @page { size: letter portrait; margin: 0.5in; }
  body { margin: 0; font-family: LiberationSans, Helvetica, Arial, sans-serif; color: #1a1a1a; background: #fff; }
  .page { max-width: 7.5in; margin: 0 auto; padding: 0.3in 0; }
  h1 { font-size: 20pt; margin: 0 0 2px; } h2 { font-size: 12pt; margin: 18px 0 6px; letter-spacing: 0.06em; text-transform: uppercase; }
  .sub { color: #555; font-size: 10pt; margin: 0 0 10px; }
  .plan svg { width: 100%; height: auto; border: 1px solid #ddd; }
  .price { font-size: 22pt; font-weight: 700; margin: 2px 0; }
  .internal { color: #b3261e; font-size: 9pt; letter-spacing: 0.08em; text-transform: uppercase; margin: 0 0 4px; font-weight: 700; }
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
  ${internal ? '<p class="internal">Meeting prep · internal: not for the client</p>' : ''}
  <h1>${esc(design.client || 'Your house')}</h1>
  <p class="sub">${esc(lotTitle(design))} · ${esc(design.style?.name || '')} · ${ab.beds} bed, ${ab.baths}${ab.halfBath ? '.5' : ''} bath${ab.garage ? `, ${ab.garage}-car garage` : ''} · ${design.livingSf ? design.livingSf.toLocaleString() + ' sf' : ''} · ${esc(date)}</p>
  <div class="plan">${plan.svg}</div>
  ${costBlock}
  <h2>Checked before you saw it</h2>
  <ul class="checks">${checks}</ul>
  <h2>What happens next</h2>
  <ol class="next">${next}</ol>
  <div class="foot"><span>${esc(titleBlock.firm || 'South Texas Builders')} · ${esc(titleBlock.phone || '')}</span><span>${esc(trust?.team || '')}</span><span>${internal ? 'internal: not for the client · ' : ''}preliminary, not for construction</span></div>
</div>
</body></html>`
}
