// Mock layout engine. Turns a program (beds, baths, garage, stories, sqft)
// into room blocks sitting inside the lot's setback envelope.
// Real version: constraint solver per style kit. This one packs two rows.
import { LOT_ANGLE } from '../../data/program.js'
import { SETBACK_CORNERS } from '../../data/survey.js'

const ENVELOPE_CENTER = [
  SETBACK_CORNERS.reduce((s, p) => s + p[0], 0) / 4,
  SETBACK_CORNERS.reduce((s, p) => s + p[1], 0) / 4,
]

export const DEFAULT_PROGRAM = { beds: 4, baths: 3, garage: 2, stories: 1, sqft: 2800 }

let uid = 0
const room = (kind, name, w, d, opts = {}) => ({ id: `${kind}-${uid++}`, kind, name, w, d, ...opts })

export function generateRooms(program, style) {
  uid = 0
  const scale = Math.sqrt(program.sqft / 2800)
  const s = (n) => Math.round(n * scale)
  const porchDeep = style?.id === 'farmhouse' || style?.id === 'craftsman' || style?.id === 'ranch'

  const publicRow = [
    room('garage', `${program.garage}-Car Garage`, 10 + program.garage * 11, 22, { fill: '#dcd7cf' }),
    room('living', 'Living', s(20), s(18)),
    room('kitchen', 'Kitchen', s(16), s(14)),
    room('dining', 'Dining', s(13), s(14)),
  ]
  if (porchDeep) publicRow.push(room('porch', 'Porch', s(14), s(10), { fill: '#e6e1d8', h: 0.6 }))

  const privateRow = [room('master', 'Primary Suite', s(18), s(16)), room('mbath', 'Primary Bath', s(11), s(12))]
  for (let i = 2; i <= program.beds; i++) privateRow.push(room('bed', `Bedroom ${i}`, s(12), s(13)))
  for (let i = 2; i <= program.baths; i++) privateRow.push(room('bath', i === 2 ? 'Bath 2' : `Bath ${i}`, s(8), s(10)))
  privateRow.push(room('laundry', 'Laundry', s(8), s(8)))

  // Scale living rooms so the plan's floor area matches what the client set.
  const living = [...publicRow, ...privateRow].filter((r) => r.kind !== 'garage' && r.kind !== 'porch')
  const base = living.reduce((a, r) => a + r.w * r.d, 0) * program.stories
  const k = Math.sqrt(program.sqft / base)
  living.forEach((r) => {
    r.w = Math.round(r.w * k)
    r.d = Math.round(r.d * k)
  })
  return place([publicRow, privateRow], program.stories)
}

/** Lay rows end to end, centered on the envelope, rotated to the lot. */
export function place(rows, stories = 1) {
  const rowDepth = rows.map((r) => Math.max(...r.map((x) => x.d)))
  const rowWidth = rows.map((r) => r.reduce((s, x) => s + x.w, 0))
  const totalD = rowDepth.reduce((a, b) => a + b, 0)
  const out = []
  let zCursor = -totalD / 2
  rows.forEach((r, ri) => {
    let xCursor = -rowWidth[ri] / 2
    r.forEach((x) => {
      const lx = xCursor + x.w / 2
      const lz = zCursor + rowDepth[ri] / 2
      const cos = Math.cos(LOT_ANGLE)
      const sin = Math.sin(LOT_ANGLE)
      out.push({
        ...x,
        h: x.h ?? (x.kind === 'garage' ? 11 : 10 * stories),
        center: [ENVELOPE_CENTER[0] + lx * cos - lz * sin, ENVELOPE_CENTER[1] + lx * sin + lz * cos],
        row: ri,
      })
      xCursor += x.w
    })
    zCursor += rowDepth[ri]
  })
  return out
}

export function floorArea(rooms, stories = 1) {
  return rooms.filter((r) => r.kind !== 'garage' && r.kind !== 'porch').reduce((s, r) => s + r.w * r.d, 0) * stories
}

/**
 * Mock interpreter for plain-language change requests.
 * Returns { rooms, reply, applied } without any network call.
 * The real version sends the request and the current rooms to Claude and
 * gets a structured diff back, then runs it through the rules engine.
 */
export function applyRequest(text, rooms, stories) {
  const t = text.toLowerCase()
  const grow = /\b(bigger|larger|wider|more room|expand|increase)\b/.test(t)
  const shrink = /\b(smaller|tighter|reduce|shrink|less)\b/.test(t)
  const add = /\b(add|another|extra|one more)\b/.test(t)
  const remove = /\b(remove|delete|drop|get rid of|without)\b/.test(t)

  const kinds = [
    ['master', /(primary|master)(?! bath)/],
    ['mbath', /(primary|master) bath/],
    ['kitchen', /kitchen/],
    ['living', /living|family room|great room/],
    ['dining', /dining/],
    ['garage', /garage/],
    ['bed', /bedroom|bed\b/],
    ['bath', /\bbath/],
    ['laundry', /laundry|utility/],
    ['porch', /porch|patio/],
    ['office', /office|study/],
  ]
  const kind = kinds.find(([, re]) => re.test(t))?.[0]
  const flat = rooms.map((r) => ({ ...r }))

  if (kind && add) {
    const names = { bed: 'Bedroom', bath: 'Bath', office: 'Office', porch: 'Porch' }
    const n = flat.filter((r) => r.kind === kind).length + (kind === 'bed' || kind === 'bath' ? 2 : 1)
    const sizes = { bed: [12, 13], bath: [8, 10], office: [11, 12], porch: [14, 10] }
    const [w, d] = sizes[kind] || [12, 12]
    const label = names[kind] ? `${names[kind]}${kind === 'office' ? '' : ' ' + n}` : kind
    flat.push({ id: `${kind}-new-${Date.now()}`, kind, name: label, w, d, row: 1 })
    return relayout(flat, stories, `Added ${label.toLowerCase()}, ${w}' by ${d}'. Square footage and estimate updated.`)
  }
  if (kind && remove) {
    const idx = flat.map((r) => r.kind).lastIndexOf(kind)
    if (idx === -1) return { rooms, reply: `There is no ${kind} in the plan to remove.`, applied: false }
    const gone = flat.splice(idx, 1)[0]
    return relayout(flat, stories, `Removed ${gone.name.toLowerCase()}.`)
  }
  if (kind && (grow || shrink)) {
    const f = grow ? 1.15 : 0.87
    let hit = 0
    flat.forEach((r) => {
      if (r.kind === kind) {
        r.w = Math.round(r.w * f)
        r.d = Math.round(r.d * f)
        hit++
      }
    })
    if (!hit) return { rooms, reply: `I could not find a ${kind} to change.`, applied: false }
    return relayout(flat, stories, `${grow ? 'Enlarged' : 'Reduced'} the ${kind === 'bed' ? 'bedrooms' : kind} by about 15 percent. Still inside the setback envelope.`)
  }
  return {
    rooms,
    applied: false,
    reply: 'In the real app this goes to the design assistant. For now try "make the kitchen bigger", "add an office", or "remove the porch".',
  }
}

function relayout(flat, stories, reply) {
  const rows = [flat.filter((r) => r.row === 0), flat.filter((r) => r.row !== 0)]
  return { rooms: place(rows, stories), reply, applied: true }
}
