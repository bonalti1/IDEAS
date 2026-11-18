// The garage-forward variant of the Modern Farmhouse standard plan, for 70 to 100 ft lots (round 6).
// The standard plan hangs its garage off the laundry wall at the rear-right corner, so the house with
// a 2-car runs 95 ft wide and the driveway passes the whole house; on a 100 ft lot the fit trimmed
// the house to about 2,350 sf. Here the garage stands at the front-right corner, front-load, its
// face 10 ft ahead of the porch line, with the driveway straight to the street; the mud room and the
// laundry sit behind it against the kitchen (the mud room's pocket door into the kitchen is kept),
// the kitchen takes the front gable and the dining room the rear, opening to the rear porch, and the
// primary suite moves to the rear-right behind its gallery. The bedroom wing, the living room, the
// office, the foyer and the porches are the standard plan's; the wing grows the same way.
//
// Drawn in the office from the standard plan's rooms and finishes (CONFIRM: not yet a traced set).

const R = (id, kind, name, x, y, w, d) => ({ id, kind, name, x, y, w, d })

/** The variant, built from the standard plan so the two share every room the variant does not move. */
export function frontGarageVariant(plan) {
  const moved = new Set(['kitchen', 'dining', 'laundry', 'mud', 'pantry', 'halfbath', 'mwic', 'mhall', 'mbath', 'master'])
  const rooms = [
    ...plan.rooms.filter((r) => !moved.has(r.id)).map((r) => ({ ...r })),
    // the public rooms: the kitchen in the front gable, the dining room behind it on the rear porch
    R('kitchen', 'kitchen', 'Kitchen', 44.5, 23.0, 12.5, 15.0),
    R('dining', 'dining', 'Dining', 44.5, 12.25, 12.5, 10.75),
    // the east column, rear to front: the suite, its gallery, the guests' bath and the closet, the pantry,
    // the mud room and laundry, the garage
    R('master', 'master', 'Primary Bedroom', 57.0, -4.0, 15.0, 16.25),
    R('mbath', 'mbath', 'Primary Bath', 61.0, 12.25, 11.0, 7.25),
    R('mhall', 'hall', 'Gallery', 57.0, 12.25, 4.0, 10.75),
    R('halfbath', 'halfbath', 'Half Bath', 61.0, 19.5, 4.25, 8.5),
    R('mwic', 'mwic', 'Primary Closet', 65.25, 19.5, 6.75, 8.5),
    R('pantry', 'pantry', 'Pantry', 57.0, 23.0, 4.0, 5.0),
    R('mud', 'mud', 'Mud Room', 57.0, 28.0, 7.0, 8.0),
    R('laundry', 'laundry', 'Laundry', 64.0, 28.0, 8.0, 8.0),
    R('garage', 'garage', '2-Car Garage', 57.0, 36.0, 22.0, 22.0),
  ]
  const dropMasses = new Set(['laundry', 'master', 'dining', 'awning-dining', 'awning-master'])
  const roof = [
    ...plan.roof.filter((m) => !dropMasses.has(m.id)).map((m) => ({ ...m, ...(m.cuts ? { cuts: m.cuts.map((c) => ({ ...c })) } : {}) })),
    // the front gable, now the kitchen's; the suite's gable at the rear; the garage's gable facing the street
    { id: 'frontgable', kind: 'gable', x0: 44.5, x1: 57, y0: 27, y1: 38, ridge: 'ns', plate: 9, pitch: 10, ends: ['s'] },
    { id: 'master', kind: 'gable', x0: 57, x1: 72, y0: -4, y1: 12.25, ridge: 'ns', plate: 9, pitch: 10, ends: ['n'] },
    { id: 'garage', kind: 'gable', x0: 57, x1: 79, y0: 36, y1: 58, ridge: 'ns', plate: 9.5, pitch: 10, ends: ['s'] },
    { id: 'awning-kitchen', kind: 'shed', x0: 45.5, x1: 55.5, y0: 38, y1: 40.5, high: 'n', plate: 8.5, pitch: 4, material: 'metal awning', overhang: 0 },
  ]
  const dropDoors = new Set(['d-pantry', 'd-kit-mud', 'd-gallery', 'd-mud-ext', 'd-laundry', 'd-halfbath', 'd-mwic', 'd-mbath', 'd-master'])
  const doors = [
    ...plan.doors.filter((d) => !dropDoors.has(d.id)).map((d) => ({ ...d })),
    // off the kitchen: the pantry (its door swings out, the pantry is under 25 sf) and the mud room's pocket door
    { id: 'd-pantry', room: 'pantry', axis: 'v', x: 57, y: 25.5, w: 2.5, swing: -1, hinge: 'start', size: 'interior' },
    { id: 'd-kit-mud', room: 'mud', axis: 'v', x: 57, y: 30.25, w: 2.5, pocket: true, size: 'interior' },
    // the gallery is a cased opening off the dining room; the suite is entered from its end, the guests' bath off its side
    { id: 'd-gallery', room: 'mhall', axis: 'v', x: 57, y: 16.5, w: 3, cased: true },
    { id: 'd-master', room: 'master', axis: 'h', x: 58.7, y: 12.25, w: 2.67, swing: -1, hinge: 'start', size: 'interiorWide' },
    { id: 'd-halfbath', room: 'halfbath', axis: 'v', x: 61, y: 21.25, w: 2.33, swing: 1, hinge: 'start', size: 'bath' },
    // CONFIRM against the Garza set: the closet opens from the primary bath, the bath from the primary bedroom
    { id: 'd-mbath', room: 'mbath', axis: 'h', x: 64.5, y: 12.25, w: 2.5, swing: 1, hinge: 'end', size: 'interior' },
    { id: 'd-mwic', room: 'mwic', axis: 'h', x: 68.5, y: 19.5, w: 2.5, swing: 1, hinge: 'start', size: 'interior' },
    // the service end: the laundry off the mud room, the garage's rated door into the mud room, the overhead door to the street
    { id: 'd-laundry', room: 'laundry', axis: 'v', x: 64, y: 33, w: 3, swing: 1, hinge: 'start', size: 'pantry' },
    { id: 'd-garage', room: 'garage', axis: 'h', x: 60.5, y: 36, w: 2.67, swing: -1, hinge: 'start', size: 'garage' },
    { id: 'd-garage-overhead', room: 'garage', axis: 'h', x: 68, y: 58, w: 16, swing: 1, size: 'overhead', exterior: true },
  ]
  const movedWin = (w) => moved.has(w.room)
  const windows = [
    ...plan.windows.filter((w) => !movedWin(w)).map((w) => ({ ...w })),
    { mark: 'A', room: 'kitchen', axis: 'h', x: 51, y: 38, w: 6 },
    { mark: 'D', room: 'dining', axis: 'h', x: 47.5, y: 12.25, w: 6 },
    { mark: 'A', room: 'master', axis: 'h', x: 62, y: -4, w: 6 },
    { mark: 'A', room: 'master', axis: 'v', x: 72, y: 8.5, w: 3 },
    { mark: 'C', room: 'mbath', axis: 'v', x: 72, y: 16, w: 2 },
    { mark: 'A', room: 'laundry', axis: 'v', x: 72, y: 32, w: 3 },
  ]
  const fixtures = [
    ...plan.fixtures.filter((f) => !moved.has(f.room)).map((f) => ({ ...f })),
    { k: 'bed', room: 'master', x: 64.5, y: 0.5, w: 7, d: 6.5, head: 'e' },
    // primary bath: the vanity along the gallery wall, the shower and the water closet on the far side, the door's leaf clear of all three
    { k: 'vanity', room: 'mbath', x: 61, y: 13.5, w: 2, d: 6, face: 'e' },
    { k: 'shower', room: 'mbath', x: 68, y: 12.5, w: 4, d: 4.5 },
    { k: 'toilet', room: 'mbath', x: 70, y: 17, w: 1.5, d: 2.3, face: 'w' },
    { k: 'linen', room: 'mbath', x: 65.9, y: 12.5, w: 2, d: 1.25 },
    // half bath: the vanity by the door, the water closet at the far end
    { k: 'vanity', room: 'halfbath', x: 63.6, y: 19.8, w: 1.6, d: 2.5, face: 'w' },
    { k: 'toilet', room: 'halfbath', x: 62.4, y: 25.4, w: 1.5, d: 2.3, face: 'n' },
    // kitchen in the front gable: the run under the front window with the range, the fridge on the east wall past
    // the mud room's door, the sink in the island (work triangle about 17 ft)
    { k: 'counter', room: 'kitchen', x: 45.5, y: 35.9, w: 7.5, d: 2.1 },
    { k: 'range', room: 'kitchen', x: 50.5, y: 35.9, w: 2.5, d: 2.1 },
    { k: 'fridge', room: 'kitchen', x: 54.5, y: 33, w: 2.5, d: 3 },
    { k: 'island', room: 'kitchen', x: 48.25, y: 28.5, w: 5.5, d: 3.5 },
    { k: 'sink', room: 'kitchen', x: 49.75, y: 29.25, w: 2.5, d: 1.6 },
    { k: 'table', room: 'dining', x: 48.5, y: 14.5, w: 4.5, d: 6 },
    { k: 'shelves', room: 'pantry', x: 57.3, y: 23.3, w: 3.5, d: 1.25 },
    { k: 'bench', room: 'mud', x: 60.5, y: 28.1, w: 3.5, d: 1.5 },
    { k: 'washer', room: 'laundry', x: 69.75, y: 28.5, w: 2.25, d: 2.5 },
    { k: 'dryer', room: 'laundry', x: 69.75, y: 31.25, w: 2.25, d: 2.5 },
    { k: 'wh', room: 'laundry', x: 64.5, y: 28.3, w: 2, d: 2 },
  ]
  return {
    id: 'frontgarage',
    footprint: { ...plan.footprint },
    facing: plan.facing,
    // the plan is the standard plan's size range; it holds what the standard plan holds
    sqft: [1750, 9000],
    // its wing grows like the standard plan's (the front slot, the rear corner across the hall, then the rear)
    wing: true,
    companions: { ...(plan.companions || {}) },
    fills: { ...(plan.fills || {}) },
    trims: (plan.trims || []).map((t) => ({ ...t })),
    rooms,
    open: [
      ['living', 'kitchen'],
      ['dining', 'kitchen'],
      ['kitchen', 'foyer'],
      ['living', 'foyer'],
      ['living', 'dining'],
      ['hall', 'vest'],
    ],
    roof,
    doors,
    windows,
    fixtures,
  }
}
