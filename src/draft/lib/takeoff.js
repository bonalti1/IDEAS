// Takeoff and schedules from the room list, using the kit's standard openings.
// This reproduces what the cover sheet and sheet 200 carry by hand today.
import { floorArea, outline, isConditioned } from './layout.js'

const sfOf = (o) => (o.w * o.h) / 144

export function windowSchedule(rooms, kit) {
  const counts = {}
  const traced = rooms.filter((r) => r.kind === 'window')
  if (traced.length) {
    traced.forEach((w) => (counts[w.mark] = (counts[w.mark] || 0) + (w.span >= 5 ? 2 : 1))) // twins are two units
    return Object.entries(counts).map(([mark, count]) => ({ mark, ...kit.windows[mark], count }))
  }
  rooms.forEach((r) => {
    const marks = kit.windowsByRoom[r.kind] || (r.kind === 'suite2' ? kit.windowsByRoom.bed : [])
    marks.forEach((m) => (counts[m] = (counts[m] || 0) + 1))
  })
  return Object.entries(counts).map(([mark, count]) => ({ mark, ...kit.windows[mark], count }))
}

const DOOR_FOR = {
  bed: 'interior', suite2: 'interiorWide', master: 'interiorWide', office: 'interiorWide',
  bath: 'interior', jackjill: 'interior', halfbath: 'interior', mbath: 'barn',
  mwic: 'barn', wic: 'closet', pantry: 'pantry', laundry: 'utility', mud: 'interior',
}

export function doorSchedule(rooms, kit) {
  const counts = {}
  const bump = (key, n = 1) => (counts[key] = (counts[key] || 0) + n)
  const traced = rooms.filter((r) => r.kind === 'door' && !r.cased)
  if (traced.length) {
    traced.forEach((d) => bump(d.size, d.pair && d.size !== 'exteriorPair' ? 2 : 1))
    rooms.filter((r) => r.kind === 'fixture' && r.fixture === 'shower').forEach(() => bump('showerGlass'))
    return Object.entries(counts).map(([key, count]) => ({ key, ...kit.doors[key], count }))
  }
  rooms.forEach((r) => {
    const k = DOOR_FOR[r.kind]
    if (k) bump(k)
    if (r.kind === 'jackjill') bump('interior') // second door
    if (r.kind === 'bed') bump('closet')
    if (['mbath', 'jackjill'].includes(r.kind)) bump('interior') // water closet
    if (['mbath', 'bath', 'jackjill'].includes(r.kind)) bump('showerGlass')
  })
  bump('closet') // hall linen
  bump('exteriorPair') // front entry
  if (rooms.some((r) => r.kind === 'rearPorch')) bump('exteriorPair')
  if (rooms.some((r) => r.kind === 'mud' || r.kind === 'garage')) bump('exteriorSingle')
  return Object.entries(counts).map(([key, count]) => ({ key, ...kit.doors[key], count }))
}

export function takeoff(rooms, program, kit) {
  const o = outline(rooms)
  const windows = windowSchedule(rooms, kit)
  const doors = doorSchedule(rooms, kit)
  const cond = rooms.filter(isConditioned)
  const avgPlate = cond.reduce((s, r) => s + r.plate * r.w * r.d, 0) / cond.reduce((s, r) => s + r.w * r.d, 0)
  const wallSf = o.perimeter * avgPlate * program.stories
  // Gable ends: four wing gables about 16 ft wide at 10:12, as on sheets 300 and 301.
  const gableW = 16
  const gableSf = 4 * ((gableW * ((gableW / 2) * (10 / 12))) / 2)
  const windowSf = windows.reduce((s, w) => s + sfOf(w) * w.count, 0)
  const extDoorSf = doors.filter((d) => d.key.startsWith('exterior')).reduce((s, d) => s + sfOf(d) * (d.pair ? 2 : 1) * d.count, 0)
  const stoneSf = o.frontWidth * kit.exterior.stoneWainscotFt
  const sidingSf = Math.max(0, wallSf + gableSf - windowSf - extDoorSf - stoneSf)

  const showerTileSf = rooms.filter((r) => !r.element).reduce((s, r) => {
    const sh = r.kind === 'mbath' ? kit.showers.master : r.kind === 'jackjill' ? kit.showers.jackjill : r.kind === 'bath' ? kit.showers.bath : null
    return sh ? s + sh.tileWallSf + sh.tileFloorSf : s
  }, 0)

  const porch = (kind) => rooms.filter((r) => r.kind === kind && !r.element).reduce((s, r) => s + r.w * r.d, 0)
  const living = floorArea(rooms, program.stories)
  const front = porch('frontPorch')
  const rear = porch('rearPorch')
  const garage = porch('garage')

  return {
    areas: { living, frontPorch: front, rearPorch: rear, garage, total: living + front + rear + garage },
    envelope: { ...o, avgPlate },
    sidingSf,
    stoneSf,
    showerTileSf,
    windows,
    doors,
    counts: {
      interiorDoors: doors.filter((d) => !d.key.startsWith('exterior') && d.key !== 'showerGlass').reduce((s, d) => s + d.count, 0),
      exteriorDoors: doors.filter((d) => d.key.startsWith('exterior')).reduce((s, d) => s + d.count, 0),
      singleHung: windows.filter((w) => w.type.startsWith('single')).reduce((s, w) => s + w.count, 0),
      fixed: windows.filter((w) => w.type.startsWith('fixed')).reduce((s, w) => s + w.count, 0),
    },
  }
}

export const inches = (n) => `${n}"`
