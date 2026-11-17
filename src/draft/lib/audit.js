// The plan audit: one checker every plan must pass before a client sees it, before a change is
// applied, before it is sent, and in the drafter's review. Checks what a licensed architect and a
// plan reviewer look for first: every room reachable from the front door without crossing a
// bedroom, bath or closet; doors on walls the two spaces share; windows on outside walls; bedroom
// egress (IRC R310); hallways 36" clear; no overlaps beyond the wall; bath fixture clearances
// (IRC R307); closets 24" clear and walk-ins 5' x 5'; halls under 12% of the area and none dead-ending; no enclosed voids or jogs under 2 ft; service rooms off the front; the suite entered away from the service hall; the garage attached, with a rated door into the mud room, laundry or hall and an
// overhead door toward the street; the kitchen work triangle; the primary suite; the living area.
// Plan feet throughout (x from the left, y toward the street). Returns readable findings.
import { isRoom, kitFor, insideLot, lotOf } from './layout.js'
import { withPlanCoords } from './ops.js'

const BEDROOMS = ['bed', 'master', 'suite2']
const BATHS = ['bath', 'mbath', 'jackjill', 'halfbath']
const CLOSETS = ['wic', 'mwic']
const PRIVATE = [...BEDROOMS, ...BATHS, ...CLOSETS, 'garage'] // a garage is entered, never passed through
const GARAGE_DOOR_ROOMS = ['mud', 'laundry', 'hall', 'foyer']
const SERVICE = ['pantry', 'laundry', 'mud', 'bath', 'mbath', 'jackjill', 'halfbath', 'wic', 'mwic']
const SERVICE_HALL = ['mud', 'laundry', 'halfbath']
export const EGRESS = { sf: 5.7, heightIn: 24, widthIn: 20, sillIn: 44 }
export const CLEAR = { hallFt: 3.5, closetIn: 24, walkInFt: 5, deadEndFt: 10, circulationWarn: 0.12, circulationFail: 0.18, jogFt: 2, voidSf: 4, toiletFrontIn: 21, toiletSideIn: 15, showerFrontIn: 24, aisleIn: 42, triangleMaxFt: 26, legMinFt: 4, legMaxFt: 9 }

const centre = (e) => [e.x + e.w / 2, e.y + e.d / 2]
const inside = (r, [x, y], tol = 0.05) => x > r.x + tol && x < r.x + r.w - tol && y > r.y + tol && y < r.y + r.d - tol
const intrusion = (a, b) => Math.min(Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)), Math.max(0, Math.min(a.y + a.d, b.y + b.d) - Math.max(a.y, b.y)))
const onEdge = (r, [x, y], tol = 0.35) => {
  const onX = x >= r.x - tol && x <= r.x + r.w + tol
  const onY = y >= r.y - tol && y <= r.y + r.d + tol
  return (onY && (Math.abs(x - r.x) <= tol || Math.abs(x - (r.x + r.w)) <= tol)) || (onX && (Math.abs(y - r.y) <= tol || Math.abs(y - (r.y + r.d)) <= tol))
}
const sharedEdge = (a, b) => {
  const touchX = (p, q) => Math.abs(p - q) < 0.6
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const oy = Math.min(a.y + a.d, b.y + b.d) - Math.max(a.y, b.y)
  if (ox > 0.5 && (touchX(a.y, b.y + b.d) || touchX(a.y + a.d, b.y))) return ox
  if (oy > 0.5 && (touchX(a.x, b.x + b.w) || touchX(a.x + a.w, b.x))) return oy
  return 0
}

/**
 * @param {object[]} rooms   placed rooms and elements, as the app holds them
 * @param {object} program
 * @param {object} kit
 * @param {object} [lot]
 * @returns {{ ok: boolean, errors: object[], warnings: object[], findings: object[], measures: object }}
 */
export function auditPlan(rooms, program, kit, lot) {
  const K = kit?.rooms ? kit : kitFor(kit)
  const { rooms: flat } = withPlanCoords(rooms, K)
  const R = flat.filter((r) => isRoom(r) && !r.open)
  const porches = flat.filter((r) => isRoom(r) && r.open)
  const doors = flat.filter((e) => e.kind === 'door')
  const windows = flat.filter((e) => e.kind === 'window' && !e.dormer)
  const fixtures = flat.filter((e) => e.kind === 'fixture')
  const findings = []
  const say = (id, severity, room, message) => findings.push({ id, severity, room: room?.name || room || null, message })
  const roomAt = (pt) => R.find((r) => inside(r, pt))
  const byId = Object.fromEntries(R.map((r) => [r.id, r]))
  const wallFt = (K.walls?.interior?.thicknessIn || 4) / 12
  const openPairs = new Set((K.plan?.open || []).flatMap(([a, b]) => [a + '|' + b, b + '|' + a]))

  // ── doors: what each one connects ──
  const link = (d) => {
    const [cx, cy] = centre(d)
    const probe = 0.7
    const p1 = d.axis === 'h' ? [cx, cy - probe] : [cx - probe, cy]
    const p2 = d.axis === 'h' ? [cx, cy + probe] : [cx + probe, cy]
    return { a: roomAt(p1), b: roomAt(p2), p1, p2 }
  }
  const links = doors.map((d) => ({ d, ...link(d) }))

  // b) every door sits on a wall shared by the two spaces it connects
  links.forEach(({ d, a, b }) => {
    const owner = byId[d.room]
    const label = `${owner?.name || d.room || 'A'} door`
    if (!a && !b) return say('door-nowall', 'error', owner, `${label} is on no wall.`)
    if (!a || !b) {
      if (d.exterior) return
      if (d.size === 'overhead') return
      return say('door-outside', 'error', owner, `${label} opens to the outside.`)
    }
    if (d.exterior && d.size !== 'overhead') say('door-exterior-inside', 'error', owner, `${label} is marked exterior but sits between ${a.name} and ${b.name}.`)
    if (owner && owner !== a && owner !== b) say('door-room', 'error', owner, `${label} sits between ${a.name} and ${b.name}, not on its own wall.`)
    const shared = sharedEdge(a, b)
    const span = d.span || Math.max(d.w, d.d)
    if (shared < span - 0.15) say('door-partial', 'error', owner, `${label} is wider than the wall ${a.name} and ${b.name} share (${shared.toFixed(1)} ft).`)
  })

  // a) every enclosed room reachable from the front door through doors, without passing through a bedroom, bath or closet
  const front = links.find(({ d, a, b }) => d.exterior && d.size !== 'overhead' && ((a && !b) || (b && !a)) && (byId[d.room]?.kind === 'foyer' || byId[d.room]?.kind === 'living')) || links.find(({ d, a, b }) => d.exterior && d.size !== 'overhead' && ((a && !b) || (b && !a)))
  if (!front) say('front-door', 'error', null, 'There is no exterior front door into the house.')
  else {
    const start = front.a || front.b
    const adj = new Map(R.map((r) => [r.id, []]))
    links.forEach(({ d, a, b }) => {
      if (a && b && a !== b && d.size !== 'overhead') {
        adj.get(a.id).push(b)
        adj.get(b.id).push(a)
      }
    })
    R.forEach((r) => R.forEach((o) => {
      if (r !== o && (openPairs.has(r.id + '|' + o.id) || openPairs.has(r.kind + '|' + o.kind)) && sharedEdge(r, o) > 0) adj.get(r.id).push(o)
    }))
    const seen = new Set([start.id])
    const queue = [start]
    while (queue.length) {
      const r = queue.shift()
      const privateRoom = PRIVATE.includes(r.kind)
      for (const o of adj.get(r.id)) {
        if (seen.has(o.id)) continue
        // from a bedroom only into its own bath or closet; from a bath only into a closet; never through a closet
        if (privateRoom) {
          if (CLOSETS.includes(r.kind) || r.kind === 'garage') continue
          if (BEDROOMS.includes(r.kind) && ![...BATHS, ...CLOSETS].includes(o.kind)) continue
          if (BATHS.includes(r.kind) && !CLOSETS.includes(o.kind)) continue
        }
        seen.add(o.id)
        queue.push(o)
      }
    }
    R.filter((r) => !seen.has(r.id)).forEach((r) => {
      const via = adj.get(r.id).find((o) => PRIVATE.includes(o.kind))
      say('reach', 'error', r, via ? `${r.name} can only be reached through ${via.name}.` : adj.get(r.id).length ? `${r.name} cannot be reached from the front door.` : `${r.name} has no door.`)
    })
  }

  // c) habitable rooms: a window on an outside wall; no window facing into another room
  const habitable = K.rules?.habitable || ['bed', 'master', 'suite2', 'kitchen', 'living', 'dining', 'office']
  const farSide = (win) => {
    const [cx, cy] = centre(win)
    const home = byId[win.room]
    if (!home) return { ok: false }
    const probe = 0.7
    const cands = win.axis === 'h' ? [[cx, cy - probe], [cx, cy + probe]] : [[cx - probe, cy], [cx + probe, cy]]
    const outsidePt = cands.find((p) => !inside(home, p)) || cands[0]
    return { home, blocked: roomAt(outsidePt), onEdge: onEdge(home, [cx, cy]) }
  }
  const exteriorWindows = (r) => windows.filter((w) => w.room === r.id).filter((w) => {
    const f = farSide(w)
    return f.onEdge && !f.blocked
  })
  windows.forEach((w) => {
    const f = farSide(w)
    if (f.blocked) say('window-blocked', 'error', f.home, `${f.home.name}'s window faces into ${f.blocked.name}.`)
    else if (f.home && !f.onEdge) say('window-wall', 'error', f.home, `${f.home.name}'s window ${w.mark || ''} is not on one of its walls.`)
  })
  const glazedDoor = (r) => links.some(({ d, a, b }) => d.exterior && /pair|french|glass/i.test(d.size || '') && ((a === r && !b) || (b === r && !a)))
  R.filter((r) => habitable.includes(r.kind)).forEach((r) => {
    if (!exteriorWindows(r).length && !glazedDoor(r)) say('window', 'error', r, `${r.name} has no window on an outside wall.`)
  })

  // d) bedroom egress: IRC R310 net clear opening
  const egressOk = (w) => {
    const spec = K.windows?.[w.mark]
    if (!spec || !/single hung|casement|slider/i.test(spec.type || '')) return false
    const clearW = spec.w - 4
    const clearH = /single hung/i.test(spec.type) ? spec.h / 2 - 3 : spec.h - 4
    const headFt = w.head ?? 7
    const sillIn = Math.round((headFt - spec.h / 12) * 12)
    return (clearW * clearH) / 144 >= EGRESS.sf && clearH >= EGRESS.heightIn && clearW >= EGRESS.widthIn && sillIn <= EGRESS.sillIn
  }
  R.filter((r) => BEDROOMS.includes(r.kind)).forEach((r) => {
    const ext = exteriorWindows(r)
    if (ext.length && !ext.some(egressOk)) say('egress', 'error', r, `${r.name}'s window is too small for emergency exit (needs 5.7 sf clear, 24" high, 20" wide, sill under 44").`)
  })

  // e) hallways 42" clear
  R.filter((r) => r.kind === 'hall').forEach((r) => {
    const clear = Math.min(r.w, r.d) - wallFt
    if (clear < CLEAR.hallFt - 0.1) say('hall', 'error', r, `${r.name} is ${Math.round(clear * 12)}" clear; hallways need ${CLEAR.hallFt * 12}".`)
  })

  // f) overlaps beyond the wall thickness; enclosed rooms on a porch
  const maxIntrusion = (K.walls?.plumbing?.thicknessIn || 6) / 12 + 0.05
  for (let i = 0; i < R.length; i++)
    for (let j = i + 1; j < R.length; j++) {
      const v = intrusion(R[i], R[j])
      if (v > maxIntrusion) say('overlap', 'error', R[i], `${R[i].name} overlaps ${R[j].name} by ${v.toFixed(1)} ft.`)
    }
  R.forEach((r) => porches.forEach((p) => {
    if (intrusion(r, p) > maxIntrusion) say('porch', 'error', r, `${r.name} sits on the ${p.name.toLowerCase()}.`)
  }))

  // g) bath fixture clearances (IRC R307)
  const fixIn = (r) => fixtures.filter((f) => f.room === r.id)
  const free = (r, pt, except) => inside(r, pt, 0.02) && !fixIn(r).some((f) => f !== except && inside({ x: f.x - 0.02, y: f.y - 0.02, w: f.w + 0.04, d: f.d + 0.04 }, pt, 0))
  R.filter((r) => BATHS.includes(r.kind)).forEach((r) => {
    fixIn(r).forEach((f) => {
      const [cx, cy] = centre(f)
      if (f.fixture === 'toilet') {
        const face = f.face || (f.d > f.w ? 'e' : 's')
        const frontPt = face === 'e' ? [f.x + f.w + CLEAR.toiletFrontIn / 12, cy] : face === 'w' ? [f.x - CLEAR.toiletFrontIn / 12, cy] : face === 'n' ? [cx, f.y - CLEAR.toiletFrontIn / 12] : [cx, f.y + f.d + CLEAR.toiletFrontIn / 12]
        if (!free(r, frontPt, f)) say('toilet-front', 'error', r, `${r.name}: less than ${CLEAR.toiletFrontIn}" in front of the toilet.`)
        const sideways = face === 'e' || face === 'w'
        const need = CLEAR.toiletSideIn / 12
        const sides = sideways ? [[cx, cy - need], [cx, cy + need]] : [[cx - need, cy], [cx + need, cy]]
        if (!sides.every((p) => free(r, p, f))) say('toilet-side', 'error', r, `${r.name}: the toilet needs ${CLEAR.toiletSideIn}" from its centreline to each side.`)
      }
      if (f.fixture === 'shower') {
        // the opening faces the room: the side with the most room beyond it
        const sides = [
          ['e', [f.x + f.w + CLEAR.showerFrontIn / 12, cy], r.x + r.w - (f.x + f.w)],
          ['w', [f.x - CLEAR.showerFrontIn / 12, cy], f.x - r.x],
          ['s', [cx, f.y + f.d + CLEAR.showerFrontIn / 12], r.y + r.d - (f.y + f.d)],
          ['n', [cx, f.y - CLEAR.showerFrontIn / 12], f.y - r.y],
        ].sort((p, q) => q[2] - p[2])
        if (!free(r, sides[0][1], f)) say('shower-front', 'error', r, `${r.name}: less than ${CLEAR.showerFrontIn}" in front of the shower.`)
      }
    })
  })

  // g2) no two doors on a wall overlap
  doors.forEach((a, i) => {
    doors.slice(i + 1).forEach((b) => {
      if (a.axis !== b.axis) return
      const along = a.axis === 'h' ? 'x' : 'y'
      const size = a.axis === 'h' ? 'w' : 'd'
      const across = a.axis === 'h' ? 'y' : 'x'
      const sameWall = Math.abs(a[across] + a[a.axis === 'h' ? 'd' : 'w'] / 2 - (b[across] + b[b.axis === 'h' ? 'd' : 'w'] / 2)) < 0.6
      if (!sameWall) return
      const overlap = Math.min(a[along] + a[size], b[along] + b[size]) - Math.max(a[along], b[along])
      if (overlap > 0.05) say('doors-overlap', 'error', byId[a.room], `${byId[a.room]?.name || 'A'} doors ${a.id} and ${b.id} overlap by ${overlap.toFixed(1)} ft on the same wall.`)
    })
  })

  // h) the garage
  const garages = R.filter((r) => r.kind === 'garage')
  garages.forEach((g) => {
    const house = R.filter((r) => r.kind !== 'garage')
    const attached = house.some((r) => sharedEdge(g, r) >= 3)
    if (!attached) say('garage-detached', 'error', g, `${g.name} is not attached to the house.`)
    const houseDoor = links.find(({ d, a, b }) => d.size !== 'overhead' && a && b && (a === g || b === g))
    if (!houseDoor) say('garage-door', 'error', g, `${g.name} has no door into the house.`)
    else {
      const other = houseDoor.a === g ? houseDoor.b : houseDoor.a
      if (!GARAGE_DOOR_ROOMS.includes(other.kind)) say('garage-door-room', 'error', g, `${g.name}'s house door opens into ${other.name}; it must open into a mud room, laundry or hall.`)
      if (!houseDoor.d.fireRated) say('garage-door-rating', 'error', g, `${g.name}'s house door must be solid or 20-minute rated and self-closing (R302.5.1).`)
    }
    const overhead = doors.filter((d) => (d.size === 'overhead' || d.size === 'overheadSingle') && d.room === g.id)
    const carsNamed = +(g.name.match(/^(\d+)-Car/) || [])[1] || 0
    const bays = Math.max(1, Math.round(Math.max(g.w, g.d) / (K.rooms?.garage?.perCar || 11)))
    if (carsNamed && carsNamed !== bays) say('garage-name', 'error', g, `${g.name} is ${g.w}' wide, ${bays} bay${bays === 1 ? '' : 's'}; the name says ${carsNamed}.`)
    if (!overhead.length) say('garage-overhead', 'error', g, `${g.name} has no overhead door.`)
    else {
      // the doors cover the bays: at least 8 ft of door per car
      const doorFt = overhead.reduce((a, d) => a + d.span, 0)
      if (doorFt < bays * 8 - 0.01) say('garage-bays', 'error', g, `${g.name} has ${Math.round(doorFt)}' of overhead door for ${bays} bays; it needs at least 8' per car.`)
      // the overhead doors' wall must be an outside wall with a driveway on the lot to the street
      const L = lotOf(lot)
      const facing = (d) => {
        const [cx, cy] = centre(d)
        return d.axis === 'h' ? (Math.abs(cy - (g.y + g.d)) < 0.4 ? 's' : 'n') : Math.abs(cx - (g.x + g.w)) < 0.4 ? 'e' : 'w'
      }
      const reasons = overhead.map((d) => {
        const [cx, cy] = centre(d)
        const side = facing(d)
        const outPt = side === 's' ? [cx, cy + 0.7] : side === 'n' ? [cx, cy - 0.7] : side === 'e' ? [cx + 0.7, cy] : [cx - 0.7, cy]
        if (roomAt(outPt)) return 'opens into a room'
        if (side === 'n' && !L.alley) return 'faces the rear yard, and this lot has no alley'
        if (side === 's') {
          // front-load: the driveway from the door to the street, inside the lot and clear of rooms
          const strip = { x: cx - 5, y: g.y + g.d, w: 10, d: 24 }
          if (house.some((r) => intrusion(r, strip) > 0.5)) return 'has a room in front of it'
          let y = g.y + g.d + 1
          while (y < g.y + g.d + 200 && insideLot(L, K, cx, y)) y += 1
          if (!insideLot(L, K, cx - 5, y - 2) || !insideLot(L, K, cx + 5, y - 2)) return 'its driveway leaves the lot before the street'
          return null
        }
        // side-load: 25 ft of apron from the door, inside the lot and clear of rooms, and a driveway to the
        // street: straight down from the apron, or down the side yard the apron reaches (10 ft wide)
        const dir = side === 'e' ? 1 : -1
        const face = side === 'e' ? g.x + g.w : g.x
        const apron = { x: side === 'e' ? face : face - 25, y: g.y, w: 25, d: g.d }
        const inApron = house.find((r) => intrusion(r, apron) > 0.5)
        if (inApron) return `has ${inApron.name} in front of it; a car needs 25' to turn in`
        for (const t of [8, 16, 25]) if (!insideLot(L, K, face + dir * t, cy)) return `has ${t - 1}' or less to the lot line; a car needs 25' to turn in`
        const front = Math.max(...house.map((r) => r.y + r.d))
        const straight = { x: apron.x, y: g.y, w: 25, d: front + 30 - g.y }
        if (!house.some((r) => intrusion(r, straight) > 0.5)) return null
        // the driveway down a side yard: 10 ft between the house and the lot line, from the apron's row to the street
        for (const edge of [Math.max(...house.map((r) => r.x + r.w)), Math.min(...house.map((r) => r.x))]) {
          const out = edge > g.x ? 1 : -1
          let ok = true
          for (let y = g.y; y <= front + 1 && ok; y += 5) ok = insideLot(L, K, edge + out * 10, y) && insideLot(L, K, edge + out * 1, y)
          if (ok) return null
        }
        return 'has no 10 ft driveway to the street'
      })
      const bad = reasons.find((r) => r)
      if (!reasons.some((r) => r === null)) say('garage-street', 'error', g, `${g.name}'s overhead door ${bad}.`)
    }
    // the garage must not cover another room's window or door
    windows.forEach((w) => {
      if (w.room !== g.id && inside({ x: g.x - 0.3, y: g.y - 0.3, w: g.w + 0.6, d: g.d + 0.6 }, centre(w), 0)) say('garage-covers', 'error', g, `${g.name} covers ${byId[w.room]?.name || 'a'} window.`)
    })
  })

  // the primary suite: bath from the bedroom, closet from the bedroom or the bath
  const master = R.find((r) => r.kind === 'master')
  const mbath = R.find((r) => r.kind === 'mbath')
  const mwic = R.find((r) => r.kind === 'mwic')
  const connected = (p, q) => links.some(({ a, b }) => (a === p && b === q) || (a === q && b === p))
  if (master && mbath && !connected(master, mbath)) say('suite-bath', 'error', mbath, `${mbath.name} does not open from the ${master.name.toLowerCase()}.`)
  if (master && mwic && !connected(master, mwic) && !(mbath && connected(mbath, mwic))) say('suite-closet', 'error', mwic, `${mwic.name} does not open from the ${master.name.toLowerCase()} or its bath.`)

  // the kitchen: work triangle and aisles
  const measures = {}
  const kitchen = R.find((r) => r.kind === 'kitchen')
  if (kitchen) {
    const pick = (k) => fixtures.find((f) => f.room === kitchen.id && f.fixture === k)
    const sink = pick('sink')
    const range = pick('range')
    const fridge = pick('fridge')
    if (sink && range && fridge) {
      const legs = [[sink, range], [range, fridge], [fridge, sink]].map(([p, q]) => Math.hypot(centre(p)[0] - centre(q)[0], centre(p)[1] - centre(q)[1]))
      const total = legs.reduce((a, b) => a + b, 0)
      measures.triangle = { legs: legs.map((l) => +l.toFixed(1)), total: +total.toFixed(1) }
      if (total > CLEAR.triangleMaxFt || legs.some((l) => l < CLEAR.legMinFt || l > CLEAR.legMaxFt)) say('triangle', 'error', kitchen, `Kitchen work triangle is ${total.toFixed(1)} ft (legs ${legs.map((l) => l.toFixed(1)).join(', ')}); it should be ${CLEAR.triangleMaxFt} ft or less with each leg ${CLEAR.legMinFt} to ${CLEAR.legMaxFt} ft.`)
    } else say('triangle', 'warn', kitchen, 'Kitchen has no sink, range and refrigerator to check the work triangle.')
    // aisles: an island's free sides need 42" to the facing counter or wall
    const counters = fixtures.filter((f) => f.room === kitchen.id && ['counter', 'fridge', 'range', 'sink'].includes(f.fixture))
    fixtures.filter((f) => f.room === kitchen.id && f.fixture === 'island').forEach((isl) => {
      const need = CLEAR.aisleIn / 12
      const gapTo = (side) => {
        const touchesWall = side === 'w' ? isl.x - kitchen.x < 0.5 : side === 'e' ? kitchen.x + kitchen.w - (isl.x + isl.w) < 0.5 : side === 'n' ? isl.y - kitchen.y < 0.5 : kitchen.y + kitchen.d - (isl.y + isl.d) < 0.5
        if (touchesWall) return Infinity
        const facing = counters.filter((c) => (side === 'w' || side === 'e' ? Math.min(c.y + c.d, isl.y + isl.d) - Math.max(c.y, isl.y) > 0.5 : Math.min(c.x + c.w, isl.x + isl.w) - Math.max(c.x, isl.x) > 0.5))
        const dist = facing.map((c) => (side === 'w' ? isl.x - (c.x + c.w) : side === 'e' ? c.x - (isl.x + isl.w) : side === 'n' ? isl.y - (c.y + c.d) : c.y - (isl.y + isl.d))).filter((v) => v >= -0.01)
        const wall = side === 'w' ? isl.x - kitchen.x : side === 'e' ? kitchen.x + kitchen.w - (isl.x + isl.w) : side === 'n' ? isl.y - kitchen.y : kitchen.y + kitchen.d - (isl.y + isl.d)
        return Math.min(wall, ...dist)
      }
      const tight = ['w', 'e', 'n', 's'].map((s) => [s, gapTo(s)]).filter(([, g]) => g < need - 0.05)
      if (tight.length) say('aisle', 'error', kitchen, `Kitchen aisle by the island is ${Math.round(tight[0][1] * 12)}"; aisles need ${CLEAR.aisleIn}".`)
    })
  }

  // i) living area within 3% of what was asked
  // what is drawn, nothing more: the conditioned rooms' area (walls and halls are rooms of their own)
  const living = R.filter((r) => !r.open && r.kind !== 'garage').reduce((s, r) => s + r.w * r.d, 0) * (program?.stories || 1)
  measures.livingSf = Math.round(living)
  if (program?.sqft) {
    const off = (living - program.sqft) / program.sqft
    measures.requestedSf = program.sqft
    if (Math.abs(off) > 0.03) say('area', 'warn', null, `Living area is ${Math.round(living).toLocaleString()} sf, ${Math.abs(Math.round(off * 100))}% ${off > 0 ? 'over' : 'under'} the ${program.sqft.toLocaleString()} sf asked for.`)
  }

  // west-facing glass over 40 sf with nothing to shade it (RGV sun)
  // an awning (a shed roof mass against the wall) or a porch over the window shades it
  const roofEl = flat.find((r) => r.kind === 'roof')
  const massRect = (m) => {
    const k = roofEl.scale || 1
    const off = roofEl.offset || [0, 0]
    const c = roofEl.centre || [0, 0]
    const px = (v) => c[0] + (v - c[0]) * k + off[0]
    const py = (v) => c[1] + (v - c[1]) * k + off[1]
    return { x0: px(m.x0), x1: px(m.x1), y0: py(m.y0), y1: py(m.y1) }
  }
  const awnings = (roofEl?.masses || []).filter((m) => m.kind === 'shed' && m.x0 !== undefined).map(massRect)
  const shaded = (w, home) => {
    const [cx, cy] = centre(w)
    const half = (w.span || 3) / 2
    return awnings.some((a) => a.x0 <= home.x + 0.5 && a.x1 >= home.x - 0.5 && a.y0 <= cy - half + 0.5 && a.y1 >= cy + half - 0.5) || porches.some((p) => p.x + p.w >= home.x - 0.5 && p.x <= home.x && p.y <= cy - half && p.y + p.d >= cy + half)
  }
  const westGlass = windows.filter((w) => {
    const home = byId[w.room]
    return home && w.axis === 'v' && Math.abs(centre(w)[0] - home.x) < 0.4 && !shaded(w, home)
  })
  const westSf = westGlass.reduce((s, w) => s + ((K.windows?.[w.mark]?.w || 36) * (K.windows?.[w.mark]?.h || 60) * (w.span >= 5 ? 2 : 1)) / 144, 0)
  if (westSf > 40) say('west-glass', 'warn', null, `${Math.round(westSf)} sf of west-facing glass with no porch or awning over it.`)

  // j) circulation: the halls as a share of the living area, and no hall that runs on past its last door
  const halls = R.filter((r) => r.kind === 'hall')
  const hallSf = halls.reduce((s, r) => s + r.w * r.d, 0)
  const livingAll = R.filter((r) => r.kind !== 'garage').reduce((s, r) => s + r.w * r.d, 0)
  measures.circulation = { sf: Math.round(hallSf), pct: livingAll ? Math.round((hallSf / livingAll) * 1000) / 10 : 0 }
  if (livingAll && hallSf / livingAll > CLEAR.circulationFail) say('circulation', 'error', null, `Halls take ${measures.circulation.pct}% of the living area (${Math.round(hallSf)} sf); over ${CLEAR.circulationFail * 100}% is a corridor plan.`)
  else if (livingAll && hallSf / livingAll > CLEAR.circulationWarn) say('circulation', 'warn', null, `Halls take ${measures.circulation.pct}% of the living area (${Math.round(hallSf)} sf); under ${CLEAR.circulationWarn * 100}% is the mark.`)
  const deadEnds = {}
  halls.forEach((h) => {
    const along = h.d >= h.w ? 'y' : 'x'
    const size = along === 'y' ? 'd' : 'w'
    const h0 = h[along]
    const h1 = h[along] + h[size]
    // what opens onto this hall: its doors (on a side wall, their span along the hall; on an end wall, that end) and the rooms it is open to
    const spans = []
    links.forEach(({ d, a, b }) => {
      if (a !== h && b !== h) return
      const endWall = (along === 'y') === (d.axis === 'h')
      if (endWall) spans.push(Math.abs(centre(d)[along === 'y' ? 1 : 0] - h0) < Math.abs(centre(d)[along === 'y' ? 1 : 0] - h1) ? [h0, h0] : [h1, h1])
      else spans.push([d[along], d[along] + d[size]])
    })
    R.forEach((o) => {
      if (o !== h && (openPairs.has(h.id + '|' + o.id) || openPairs.has(h.kind + '|' + o.kind)) && sharedEdge(h, o) > 0) {
        const lo = Math.max(h[along], o[along])
        const hi = Math.min(h[along] + h[size], o[along] + o[size])
        if (hi - lo > 0.5) spans.push([lo, hi])
        else spans.push(Math.abs(o[along] + o[size] - h0) < 0.6 || Math.abs(o[along] - h0) < 0.6 ? [h0, h0] : [h1, h1])
      }
    })
    if (!spans.length) return
    const dead = Math.max(Math.min(...spans.map((s) => s[0])) - h0, h1 - Math.max(...spans.map((s) => s[1])))
    deadEnds[h.id] = Math.round(dead * 10) / 10
    if (dead > CLEAR.deadEndFt + 0.05) say('dead-end', 'error', h, `${h.name} runs ${dead.toFixed(1)} ft past its last door; a hall should end within ${CLEAR.deadEndFt} ft of one.`)
  })

  // k) the primary suite is entered from a private hall or the living side, never from the service hall
  if (master) {
    links.forEach(({ d, a, b }) => {
      if (a !== master && b !== master) return
      const hall = a === master ? b : a
      if (!hall || hall.kind !== 'hall') return
      const service = R.filter((o) => o !== hall && SERVICE_HALL.includes(o.kind) && (links.some(({ a: p, b: q }) => (p === hall && q === o) || (p === o && q === hall)) || ((openPairs.has(hall.id + '|' + o.id) || openPairs.has(hall.kind + '|' + o.kind)) && sharedEdge(hall, o) > 0)))
      if (service.length) say('suite-entry', 'warn', master, `${master.name}'s door shares ${hall.name.toLowerCase()} with the ${service.map((o) => o.name.toLowerCase()).join(' and ')}; enter the suite from a private vestibule or the living side.`)
    })
  }

  // l) the street front is for living rooms: no pantry, laundry, mud room, bath or closet with a window toward the street
  windows.forEach((w) => {
    const home = byId[w.room]
    if (!home || !SERVICE.includes(home.kind)) return
    const [cx, cy] = centre(w)
    if (w.axis !== 'h' || Math.abs(cy - (home.y + home.d)) > 0.4) return
    const f = farSide(w)
    if (f.blocked) return
    const ahead = R.some((r) => r !== home && r.y + r.d > home.y + home.d + 0.5 && r.x < cx + 0.5 && r.x + r.w > cx - 0.5)
    if (!ahead) say('service-front', 'warn', home, `${home.name} has a window on the street front; keep the service rooms off the front wall.`)
  })

  // m) closets you can use: a reach-in 24" clear, a walk-in 5' x 5'
  R.filter((r) => CLOSETS.includes(r.kind)).forEach((r) => {
    const walkIn = r.kind === 'mwic' || /walk|primary/i.test(r.name)
    if (walkIn) {
      if (Math.min(r.w, r.d) < CLEAR.walkInFt - 0.01) say('walk-in', 'error', r, `${r.name} is ${r.w.toFixed(1)}' x ${r.d.toFixed(1)}'; a walk-in closet needs ${CLEAR.walkInFt}' x ${CLEAR.walkInFt}'.`)
    } else {
      const clear = Math.min(r.w, r.d) - wallFt
      if (clear < CLEAR.closetIn / 12 - 0.01) say('closet', 'error', r, `${r.name} is ${Math.round(clear * 12)}" deep clear; a reach-in closet needs ${CLEAR.closetIn}" (draw it 2'-4" to 2'-6").`)
    }
  })

  // n) no voids, no jogs: every enclosed space is a room, and the outside wall does not step less than 2 ft
  {
    const pad = 0.3 // half a wall: rooms drawn edge to edge, or a hair apart, close up
    const r2 = (v) => Math.round(v * 100) / 100
    // wall lines within 0.4 ft of each other (a tracing offset, a rounding) read as one line
    const cluster = (vals) => {
      const sorted = [...new Set(vals.map(r2))].sort((a, b) => a - b)
      const map = new Map()
      let start = null
      let group = []
      const flush = () => {
        if (!group.length) return
        const v = r2(group.reduce((s2, g) => s2 + g, 0) / group.length)
        group.forEach((g) => map.set(g, v))
      }
      sorted.forEach((v) => {
        if (start === null || v - start > 0.4) {
          flush()
          start = v
          group = [v]
        } else group.push(v)
      })
      flush()
      return (v) => map.get(r2(v)) ?? r2(v)
    }
    const cx2 = cluster(R.flatMap((r) => [r.x, r.x + r.w]))
    const cy2 = cluster(R.flatMap((r) => [r.y, r.y + r.d]))
    const boxes = R.map((r) => ({ r, x0: r2(cx2(r.x) - pad), x1: r2(cx2(r.x + r.w) + pad), y0: r2(cy2(r.y) - pad), y1: r2(cy2(r.y + r.d) + pad) }))
    if (boxes.length) {
      const xs = [...new Set(boxes.flatMap((b) => [b.x0, b.x1]))].sort((a, b) => a - b)
      const ys = [...new Set(boxes.flatMap((b) => [b.y0, b.y1]))].sort((a, b) => a - b)
      const nx = xs.length - 1
      const ny = ys.length - 1
      const cell = (i, j) => boxes.find((b) => b.x0 <= xs[i] + 1e-6 && b.x1 >= xs[i + 1] - 1e-6 && b.y0 <= ys[j] + 1e-6 && b.y1 >= ys[j + 1] - 1e-6)
      const covered = []
      for (let i = 0; i < nx; i++) {
        covered.push([])
        for (let j = 0; j < ny; j++) covered[i].push(!!cell(i, j))
      }
      // flood the outside in from the edges; what is left uncovered is enclosed
      const outside = covered.map((col) => col.map(() => false))
      const stack = []
      for (let i = 0; i < nx; i++) for (const j of [0, ny - 1]) if (!covered[i][j]) stack.push([i, j])
      for (let j = 0; j < ny; j++) for (const i of [0, nx - 1]) if (!covered[i][j]) stack.push([i, j])
      while (stack.length) {
        const [i, j] = stack.pop()
        if (i < 0 || j < 0 || i >= nx || j >= ny || covered[i][j] || outside[i][j]) continue
        outside[i][j] = true
        stack.push([i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1])
      }
      const seen = covered.map((col) => col.map(() => false))
      for (let i = 0; i < nx; i++)
        for (let j = 0; j < ny; j++) {
          if (covered[i][j] || outside[i][j] || seen[i][j]) continue
          // one enclosed pocket
          const cells = []
          const q = [[i, j]]
          while (q.length) {
            const [a, b] = q.pop()
            if (a < 0 || b < 0 || a >= nx || b >= ny || covered[a][b] || outside[a][b] || seen[a][b]) continue
            seen[a][b] = true
            cells.push([a, b])
            q.push([a + 1, b], [a - 1, b], [a, b + 1], [a, b - 1])
          }
          const bx0 = Math.min(...cells.map(([a]) => xs[a])) - pad
          const bx1 = Math.max(...cells.map(([a]) => xs[a + 1])) + pad
          const by0 = Math.min(...cells.map(([, b]) => ys[b])) - pad
          const by1 = Math.max(...cells.map(([, b]) => ys[b + 1])) + pad
          const sf = cells.reduce((s2, [a, b]) => s2 + (xs[a + 1] - xs[a]) * (ys[b + 1] - ys[b]), 0) + pad * 2 * (bx1 - bx0 + by1 - by0) / 2
          if (sf <= CLEAR.voidSf) continue
          const around = R.filter((r) => r.x < bx1 + 0.1 && r.x + r.w > bx0 - 0.1 && r.y < by1 + 0.1 && r.y + r.d > by0 - 0.1).map((r) => r.name)
          say('void', 'error', null, `An enclosed ${Math.round(sf)} sf space between ${around.slice(0, 3).join(', ') || 'the rooms'} is no room; give it to a room or a closet.`)
        }
      // the outside wall: runs of cell edges between covered and uncovered; a run under 2 ft is a jog
      const runs = []
      const at = (i, j) => i >= 0 && j >= 0 && i < nx && j < ny && covered[i][j]
      for (let i = 0; i < nx; i++)
        for (let j = 0; j < ny; j++) {
          if (!covered[i][j]) continue
          if (!at(i, j - 1)) runs.push({ axis: 'h', c: ys[j], a: xs[i], b: xs[i + 1], i, j })
          if (!at(i, j + 1)) runs.push({ axis: 'h', c: ys[j + 1], a: xs[i], b: xs[i + 1], i, j })
          if (!at(i - 1, j)) runs.push({ axis: 'v', c: xs[i], a: ys[j], b: ys[j + 1], i, j })
          if (!at(i + 1, j)) runs.push({ axis: 'v', c: xs[i + 1], a: ys[j], b: ys[j + 1], i, j })
        }
      const merged = []
      runs.sort((p, q2) => (p.axis < q2.axis ? -1 : p.axis > q2.axis ? 1 : p.c - q2.c || p.a - q2.a))
      runs.forEach((r) => {
        const last = merged[merged.length - 1]
        if (last && last.axis === r.axis && Math.abs(last.c - r.c) < 1e-6 && Math.abs(last.b - r.a) < 1e-6 && last.side === (r.axis === 'h' ? (at(r.i, r.j - 1) ? 's' : 'n') : at(r.i - 1, r.j) ? 'e' : 'w')) last.b = r.b
        else merged.push({ ...r, side: r.axis === 'h' ? (at(r.i, r.j - 1) ? 's' : 'n') : at(r.i - 1, r.j) ? 'e' : 'w' })
      })
      const jogged = new Set()
      merged.forEach((m) => {
        const len = m.b - m.a
        if (len < 0.4 || len >= CLEAR.jogFt - 0.01) return
        const mid = m.axis === 'h' ? [(m.a + m.b) / 2, m.c] : [m.c, (m.a + m.b) / 2]
        const room = R.find((r) => mid[0] > r.x - pad - 0.05 && mid[0] < r.x + r.w + pad + 0.05 && mid[1] > r.y - pad - 0.05 && mid[1] < r.y + r.d + pad + 0.05)
        const key = room?.id || 'x'
        if (jogged.has(key)) return
        jogged.add(key)
        say('jog', 'warn', room, `The outside wall steps ${len.toFixed(1)} ft at ${room?.name || 'the house'}; a jog under ${CLEAR.jogFt} ft costs a corner for nothing.`)
      })
    }
  }

  measures.halls = R.filter((r) => r.kind === 'hall').map((r) => ({ name: r.name, clearIn: Math.round((Math.min(r.w, r.d) - wallFt) * 12), deadEndFt: deadEnds[r.id] ?? null }))
  measures.doors = doors.filter((d) => !d.cased).map((d) => ({ id: d.id, room: byId[d.room]?.name || d.room, widthIn: Math.round((d.span || Math.max(d.w, d.d)) * 12), size: d.size || null }))
  const errors = findings.filter((f) => f.severity === 'error')
  const warnings = findings.filter((f) => f.severity === 'warn')
  return { ok: errors.length === 0, errors, warnings, findings, measures }
}

/** The audit for a design.json (the office's contract): rooms and elements come back to plan coordinates. */
export function auditDesign(design, kit) {
  const K = kit?.rooms ? kit : kitFor(kit)
  const xs = design.rooms.map((r) => r.x - r.w / 2)
  const zs = design.rooms.map((r) => r.z - r.d / 2)
  const ox = Math.min(...xs)
  const oz = Math.min(...zs)
  const rooms = design.rooms.map((r) => ({ ...r, x: r.x - r.w / 2 - ox, y: r.z - r.d / 2 - oz, local: [r.x, r.z] }))
  const doors = design.doors.map((d) => ({ ...d, kind: 'door', element: true, w: d.axis === 'h' ? d.width : 0.6, d: d.axis === 'h' ? 0.6 : d.width, x: d.x - ox - (d.axis === 'h' ? d.width / 2 : 0.3), y: d.z - oz - (d.axis === 'h' ? 0.3 : d.width / 2), span: d.width, fireRated: d.fireRated ?? !!K.doors?.[d.size]?.fireRated, selfClosing: d.selfClosing ?? !!K.doors?.[d.size]?.selfClosing }))
  const windows = design.windows.map((w) => ({ ...w, kind: 'window', element: true, w: w.axis === 'h' ? w.width : 0.6, d: w.axis === 'h' ? 0.6 : w.width, x: w.x - ox - (w.axis === 'h' ? w.width / 2 : 0.3), y: w.z - oz - (w.axis === 'h' ? 0.3 : w.width / 2), span: w.width }))
  const fixtures = design.fixtures.map((f) => ({ ...f, kind: 'fixture', element: true, fixture: f.kind, x: f.x - f.w / 2 - ox, y: f.z - f.d / 2 - oz }))
  return auditPlan([...rooms, ...doors, ...windows, ...fixtures], design.program, K, null)
}

/** The checks a drafter reads, grouped: [{ id, name, ok, findings: [message] }], plus the measures. */
export const CHECK_GROUPS = [
  { id: 'doors', name: 'Every door on a wall its room shares, no two overlapping', ids: ['door-nowall', 'door-outside', 'door-exterior-inside', 'door-room', 'door-partial', 'doors-overlap'] },
  { id: 'reach', name: 'Every room reached from the front door, never through a bedroom or bath', ids: ['reach'] },
  { id: 'windows', name: 'Windows on outside walls; egress in every bedroom', ids: ['window', 'window-blocked', 'window-wall', 'egress'] },
  { id: 'halls', name: 'Halls 42" clear, none running past its last door, under 12% of the living area', ids: ['hall', 'dead-end', 'circulation'] },
  { id: 'overlap', name: 'No room over another or on a porch; no enclosed void, no jog under 2 ft', ids: ['overlap', 'porch', 'void', 'jog'] },
  { id: 'fixtures', name: 'Toilet and shower clearances', ids: ['toilet-front', 'toilet-side', 'shower-front'] },
  { id: 'garage', name: 'Garage attached, fire-rated house door, overhead doors for every bay, a driveway on the lot to the street', ids: ['garage-detached', 'garage-door', 'garage-door-room', 'garage-door-rating', 'garage-overhead', 'garage-street', 'garage-covers', 'garage-bays', 'garage-name'] },
  { id: 'suite', name: 'Primary bath and closet from the bedroom; the suite entered away from the service hall', ids: ['suite-bath', 'suite-closet', 'suite-entry'] },
  { id: 'closets', name: 'Reach-in closets 24" clear, walk-ins 5\' x 5\'', ids: ['closet', 'walk-in'] },
  { id: 'front', name: 'Service rooms off the street front', ids: ['service-front'] },
  { id: 'kitchen', name: 'Kitchen work triangle 26 ft or less, aisles 42"', ids: ['triangle', 'aisle'] },
  { id: 'area', name: 'Living area within 3% of the request', ids: ['area'] },
  { id: 'west', name: 'West glass over 40 sf shaded', ids: ['west-glass'] },
]
export function auditSummary(rooms, program, kit, lot) {
  const a = auditPlan(rooms, program, kit, lot)
  const groups = CHECK_GROUPS.map((g) => {
    const errors = a.errors.filter((f) => g.ids.includes(f.id)).map((f) => f.message)
    const warnings = a.warnings.filter((f) => g.ids.includes(f.id)).map((f) => f.message)
    return { id: g.id, name: g.name, ok: errors.length === 0, state: errors.length ? 'fail' : warnings.length ? 'warn' : 'pass', errors, warnings }
  })
  return { ok: a.ok, errors: a.errors.length, warnings: a.warnings.length, groups, measures: a.measures }
}
