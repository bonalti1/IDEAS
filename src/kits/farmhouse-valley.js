// The Valley plan of the Modern Farmhouse kit (round 15, item U9): the house a 60 to 80 ft lot in the Rio Grande
// Valley gets, about 51 ft wide and 60 ft deep as drawn (deeper once it grows: it grows deeper before it grows wider),
// with the 2-car garage forward at the front-right and a covered porch tucked in beside it. Before it, such a lot
// (1201 Kerria Ave, McAllen: 65 ft buildable) got the narrow plan grown to 43 x 85 ft, a tube under one long roof
// with a 55 ft hall, and lost the office and a bath on the way.
//   the bedroom wing (left): the standard plan's two bedrooms and Jack & Jill off a 24.5 ft hall with a linen closet at each end;
//     the third bedroom at the front-left, off the entry, with its own bath and closet; the guests' half bath
//   the middle: the kitchen on the yard (French door to the rear porch), the dining room open to it, the living room
//     open to both and to the entry, whose picture window on the porch lights them
//   the right: the pantry off the kitchen; a gallery off the dining room to the primary suite at the rear-right and
//     the office; the mud room behind the garage with the laundry off it
// The roof: a hip over the middle and the suite, lower hips over the bedroom wing and the garage, a small hip over the
// office, so the ridge line steps instead of running as one slab.
// Plan feet: x from the left, y toward the street.
//
// Drawn in the office from the standard plan's rooms and finishes (CONFIRM: not yet a traced set).

const bed = (room, x, y, head = 'w') => ({ k: 'bed', room, x, y, w: 7, d: 6.5, head })
const awning = (id, cy, half = 3.5) => ({ id: `awning-${id}`, kind: 'shed', x0: -2.5, x1: 0, y0: cy - half, y1: cy + half, high: 'e', plate: 8.5, pitch: 4, material: 'metal awning', overhang: 0 })

export const VALLEY_PLAN = {
  id: 'valley',
  // the standard plan's footprint, so the plans share one plan centre (the fit places every plan about it); the house
  // itself is 51 x 60 ft as drawn
  footprint: { w: 72, d: 53 },
  // it does not narrow (its baths, closets, halls, entry, office and laundry keep their size), so the fit does not try it
  // on a lot under 51 ft buildable (a 60 ft lot with 5 ft side yards keeps the narrow plan)
  minWidth: 51,
  // and it is the plan for lots narrower than the garage-forward plan takes (66 ft buildable); a wider lot keeps that one
  maxEnvelope: 66,
  facing: 'street',
  // what this plan can hold (the app's default rooms), and the living area it is drawn for
  capacity: { beds: 4, baths: 3, halfBath: true, office: true, garage: 2, suite2: false },
  sqft: [2300, 3200],
  // the house grows deeper before it grows wider: each step of width buys up to 1.2 times the depth
  growDeep: 1.2,
  companions: { bed3: ['closet3', 'bath1'] },
  fills: {},
  // without an office the gallery stops at the suite's closet wall (it ran on to the office's door)
  trims: [{ when: 'office', room: 'mhall', y1: 24 }],
  rooms: [
    // the bedroom wing, rear to front: Bedroom 2, the Jack & Jill, Bedroom 1 off the hall
    { id: 'bed2', kind: 'bed', name: 'Bedroom 2', x: 0, y: 0, w: 11, d: 12.5 },
    { id: 'closet2', kind: 'wic', name: 'Closet', x: 11, y: 0, w: 4, d: 4.5 },
    { id: 'linen', kind: 'wic', name: 'Linen', x: 11, y: 4.5, w: 4, d: 4 },
    { id: 'jackjill', kind: 'jackjill', name: 'Jack & Jill', x: 0, y: 12.5, w: 11, d: 8.5 },
    { id: 'closet1', kind: 'wic', name: 'Closet', x: 0, y: 21, w: 6, d: 4 },
    { id: 'vest', kind: 'hall', name: 'Vestibule', x: 6, y: 21, w: 5, d: 4 },
    { id: 'hall', kind: 'hall', name: 'Hallway', x: 11, y: 8.5, w: 4, d: 24.5 },
    { id: 'linen2', kind: 'wic', name: 'Linen', x: 11, y: 33, w: 4, d: 4.5 },
    { id: 'bed1', kind: 'bed', name: 'Bedroom 1', x: 0, y: 25, w: 11, d: 12.5 },
    // the third bedroom at the front-left, off the entry, with its bath and closet behind it; the guests' half bath
    { id: 'bath1', kind: 'bath', name: 'Bath 1', x: 0, y: 37.5, w: 8, d: 6 },
    { id: 'closet3', kind: 'wic', name: 'Closet', x: 8, y: 37.5, w: 3, d: 6 },
    { id: 'halfbath', kind: 'halfbath', name: 'Half Bath', x: 11, y: 37.5, w: 4, d: 6 },
    { id: 'bed3', kind: 'bed', name: 'Bedroom 3', x: 0, y: 43.5, w: 11, d: 12.5 },
    // the entry: in from the porch, open to the living room behind it (its picture window lights both)
    { id: 'foyer', kind: 'foyer', name: 'Entry', x: 11, y: 43.5, w: 19, d: 9 },
    // the middle: the kitchen on the yard, the dining room, the living room on the porch
    { id: 'kitchen', kind: 'kitchen', name: 'Kitchen', x: 15, y: 0, w: 19, d: 13 },
    { id: 'dining', kind: 'dining', name: 'Dining', x: 15, y: 13, w: 19, d: 11 },
    { id: 'living', kind: 'living', name: 'Living', x: 15, y: 24, w: 15, d: 19.5 },
    // the right: the pantry, the gallery to the suite and the office, the mud room and the laundry, the garage
    { id: 'pantry', kind: 'pantry', name: 'Pantry', x: 34, y: 0, w: 4, d: 6 },
    { id: 'mhall', kind: 'hall', name: 'Gallery', x: 34, y: 6, w: 4, d: 26 },
    { id: 'master', kind: 'master', name: 'Primary Bedroom', x: 38, y: 0, w: 13, d: 15 },
    { id: 'mwic', kind: 'mwic', name: 'Primary Closet', x: 38, y: 15, w: 5, d: 9 },
    { id: 'mbath', kind: 'mbath', name: 'Primary Bath', x: 43, y: 15, w: 8, d: 9 },
    { id: 'office', kind: 'office', name: 'Office', x: 38, y: 24, w: 13, d: 8 },
    { id: 'mud', kind: 'mud', name: 'Mud Room', x: 30, y: 24, w: 4, d: 14 },
    { id: 'laundry', kind: 'laundry', name: 'Laundry', x: 34, y: 32, w: 17, d: 6 },
    { id: 'garage', kind: 'garage', name: '2-Car Garage', x: 30, y: 38, w: 21, d: 22 },
    // porches: the front porch between the third bedroom and the garage, flush with the garage's face; the rear
    // porch on the kitchen
    { id: 'frontPorch', kind: 'frontPorch', name: 'Front Porch', x: 11, y: 52.5, w: 19, d: 7.5 },
    { id: 'rearPorch', kind: 'rearPorch', name: 'Rear Porch', x: 15, y: -10, w: 19, d: 10 },
  ],
  open: [
    ['kitchen', 'dining'],
    ['dining', 'living'],
    ['living', 'foyer'],
    ['hall', 'vest'],
  ],
  roof: [
    // the main roof: one hip over the bedroom wing and the family rooms, its north-south ridge the highest and the
    // longest; a lower hip over the suite at the rear-right and another over the garage at the front: three hips
    // stepping down, so the ridge line breaks (the third bedroom's bump-out gets a lean-to from the layout)
    { id: 'main', kind: 'gable', x0: 0, x1: 34, y0: 0, y1: 52.5, ridge: 'ns', plate: 9, pitch: 7, ends: [] },
    { id: 'suite', kind: 'gable', x0: 31, x1: 51, y0: 0, y1: 34, ridge: 'ns', plate: 9, pitch: 6, ends: [] },
    { id: 'garage', kind: 'gable', x0: 30, x1: 51, y0: 31, y1: 60, ridge: 'ns', plate: 9.5, pitch: 6, ends: [] },
    { id: 'frontPorch', kind: 'shed', x0: 11, x1: 30, y0: 52.5, y1: 60, high: 'n', plate: 8.5, pitch: 3, material: 'metal roof' },
    { id: 'rearPorch', kind: 'shed', x0: 15, x1: 34, y0: -10, y1: 0, high: 's', plate: 8, pitch: 3, material: 'metal roof' },
    // metal awnings over the west windows (the Valley sun)
    awning('bed2', 6.25),
    awning('bed1', 31.25),
    awning('bed3', 50, 2.5),
  ],
  doors: [
    // the wing
    { id: 'd-closet2', room: 'closet2', axis: 'v', x: 11, y: 2.25, w: 4, swing: -1, pair: true, size: 'closet' },
    { id: 'd-linen', room: 'linen', axis: 'h', x: 13, y: 8.5, w: 2, swing: 1, hinge: 'start', size: 'closet' },
    { id: 'd-bed2', room: 'bed2', axis: 'v', x: 11, y: 10.25, w: 2.67, swing: -1, hinge: 'start', size: 'interiorWide' },
    { id: 'd-jj-n', room: 'jackjill', axis: 'h', x: 5.5, y: 12.5, w: 2.5, swing: -1, hinge: 'end', size: 'interior' },
    { id: 'd-jj-s', room: 'jackjill', axis: 'h', x: 8.5, y: 21, w: 2.5, swing: 1, hinge: 'end', size: 'interior' },
    { id: 'd-closet1', room: 'closet1', axis: 'h', x: 3, y: 25, w: 4, swing: 1, pair: true, size: 'closet' },
    { id: 'd-bed1', room: 'bed1', axis: 'v', x: 11, y: 29, w: 2.67, swing: -1, hinge: 'start', size: 'interiorWide' },
    { id: 'd-linen2', room: 'linen2', axis: 'h', x: 13, y: 33, w: 2, swing: -1, hinge: 'start', size: 'closet' },
    { id: 'd-hall-liv', room: 'living', axis: 'v', x: 15, y: 30.5, w: 3.5, cased: true },
    // the front: the third bedroom and the half bath off the entry; Bath 1 and the closet from the bedroom
    { id: 'd-bed3', room: 'bed3', axis: 'v', x: 11, y: 48, w: 2.67, swing: -1, hinge: 'end', size: 'interiorWide' },
    { id: 'd-bath1', room: 'bath1', axis: 'h', x: 5, y: 43.5, w: 2.33, swing: 1, hinge: 'end', size: 'bath' },
    { id: 'd-closet3', room: 'closet3', axis: 'h', x: 9.5, y: 43.5, w: 2.5, swing: 1, hinge: 'start', size: 'closet' },
    { id: 'd-halfbath', room: 'halfbath', axis: 'h', x: 12.2, y: 43.5, w: 2.33, pocket: true, size: 'bath' },
    // the right: the pantry off the kitchen, the gallery off the dining room, the suite and the office off the gallery
    { id: 'd-pantry', room: 'pantry', axis: 'v', x: 34, y: 3, w: 2.5, pocket: true, size: 'interior' },
    { id: 'd-gallery', room: 'mhall', axis: 'v', x: 34, y: 18.5, w: 3, cased: true },
    { id: 'd-master', room: 'master', axis: 'v', x: 38, y: 10.5, w: 2.67, swing: 1, hinge: 'end', size: 'interiorWide' },
    { id: 'd-mwic', room: 'mwic', axis: 'h', x: 40.5, y: 15, w: 2.5, swing: 1, hinge: 'start', size: 'interior' },
    { id: 'd-mbath', room: 'mbath', axis: 'h', x: 45.5, y: 15, w: 2.5, swing: 1, hinge: 'start', size: 'interior' },
    { id: 'd-office', room: 'office', axis: 'v', x: 38, y: 28, w: 2.67, swing: 1, hinge: 'start', size: 'interiorWide' },
    // service: the mud room off the dining room, the laundry off it, the garage's rated door into it
    { id: 'd-mud', room: 'mud', axis: 'h', x: 32, y: 24, w: 2.5, pocket: true, size: 'interior' },
    { id: 'd-laundry', room: 'laundry', axis: 'v', x: 34, y: 35, w: 3, swing: 1, hinge: 'start', size: 'pantry' },
    { id: 'd-garage', room: 'garage', axis: 'h', x: 32, y: 38, w: 2.67, swing: -1, hinge: 'start', size: 'garage' },
    // outside: the front door into the entry, the kitchen's French door to the rear porch, the overhead door
    { id: 'd-front', room: 'foyer', axis: 'h', x: 13, y: 52.5, w: 3, swing: -1, hinge: 'end', size: 'exteriorSingle', exterior: true },
    { id: 'd-rear', room: 'kitchen', axis: 'h', x: 28.5, y: 0, w: 6, swing: 1, pair: true, size: 'exteriorPair', exterior: true },
    { id: 'd-garage-overhead', room: 'garage', axis: 'h', x: 40.5, y: 60, w: 16, swing: 1, size: 'overhead', exterior: true },
  ],
  // windows by room, so the house does not read as a row of the same window: the bedrooms a pair of 3 x 5
  // single-hungs (the egress window), the living room a 7 x 5 picture window on the porch, the office one 3 x 5, the
  // kitchen a 3 x 3.5 over the counter, the baths a 2 x 3 fixed, the laundry a 3.5 x 3 fixed
  windows: [
    { mark: 'A', room: 'bed2', axis: 'v', x: 0, y: 6.25, w: 6 },
    { mark: 'C', room: 'jackjill', axis: 'v', x: 0, y: 17, w: 2 },
    { mark: 'A', room: 'bed1', axis: 'v', x: 0, y: 31.25, w: 6 },
    { mark: 'C', room: 'bath1', axis: 'v', x: 0, y: 40.5, w: 2 },
    { mark: 'A', room: 'bed3', axis: 'h', x: 5.5, y: 56, w: 6 },
    { mark: 'A', room: 'bed3', axis: 'v', x: 0, y: 50, w: 3 },
    { mark: 'E', room: 'foyer', axis: 'h', x: 23, y: 52.5, w: 7 },
    { mark: 'D', room: 'kitchen', axis: 'h', x: 18.25, y: 0, w: 3 },
    { mark: 'A', room: 'master', axis: 'h', x: 44.5, y: 0, w: 6 },
    { mark: 'A', room: 'master', axis: 'v', x: 51, y: 7.5, w: 3 },
    { mark: 'C', room: 'mbath', axis: 'v', x: 51, y: 22, w: 2 },
    { mark: 'A', room: 'office', axis: 'v', x: 51, y: 28, w: 3 },
    { mark: 'B', room: 'laundry', axis: 'v', x: 51, y: 35, w: 3.5 },
  ],
  fixtures: [
    bed('bed2', 0.3, 3, 'w'),
    bed('bed1', 0.3, 28.5, 'w'),
    bed('bed3', 0.3, 48.5, 'w'),
    bed('master', 43.7, 4, 'e'),
    // the Jack & Jill (11 x 8.5): the shower along the back, the water closet on the outside wall, the vanity by the doors
    { k: 'shower', room: 'jackjill', x: 0.3, y: 15.5, w: 3, d: 5.2 },
    { k: 'toilet', room: 'jackjill', x: 4.2, y: 18.4, w: 1.5, d: 2.3, face: 'n' },
    { k: 'vanity', room: 'jackjill', x: 8.7, y: 14.8, w: 2, d: 3.4, face: 'w' },
    // Bath 1 (8 x 6): the shower across the back, the water closet facing in, the vanity on the far wall from the door
    { k: 'shower', room: 'bath1', x: 0.3, y: 37.8, w: 6, d: 2.6 },
    { k: 'toilet', room: 'bath1', x: 0.3, y: 41, w: 2.3, d: 1.5, face: 'e' },
    { k: 'vanity', room: 'bath1', x: 6.2, y: 40.8, w: 1.6, d: 2.4, face: 'w' },
    // the half bath (4 x 6): the water closet at the back, the vanity on the side away from the door
    { k: 'toilet', room: 'halfbath', x: 12.25, y: 37.8, w: 1.5, d: 2.3, face: 's' },
    { k: 'vanity', room: 'halfbath', x: 13.5, y: 40.3, w: 1.4, d: 1.8, face: 'w' },
    // the primary bath (8 x 9): the shower across the back, the water closet facing in, the vanity on the outside wall
    { k: 'shower', room: 'mbath', x: 43.3, y: 20.7, w: 7.4, d: 3 },
    { k: 'toilet', room: 'mbath', x: 43.3, y: 17.7, w: 2.3, d: 1.5, face: 'e' },
    { k: 'vanity', room: 'mbath', x: 49.2, y: 15.3, w: 1.5, d: 4.2, face: 'w' },
    // the kitchen (19 x 13): the run on the back wall under the window with the range, the fridge on the west wall,
    // the sink in the island (work triangle about 19 ft)
    { k: 'counter', room: 'kitchen', x: 15.3, y: 0.3, w: 9.5, d: 2.1 },
    { k: 'range', room: 'kitchen', x: 21, y: 0.3, w: 2.5, d: 2.1 },
    { k: 'fridge', room: 'kitchen', x: 15.3, y: 4.5, w: 3, d: 2.5, face: 'e' },
    { k: 'island', room: 'kitchen', x: 21.8, y: 4.8, w: 6, d: 3 },
    { k: 'sink', room: 'kitchen', x: 23.55, y: 5, w: 2.5, d: 1.6 },
    { k: 'shelves', room: 'pantry', x: 36.5, y: 0.3, w: 1.25, d: 5.4 },
    { k: 'table', room: 'dining', x: 21.5, y: 15.5, w: 4.5, d: 6 },
    { k: 'sofa', room: 'living', x: 16, y: 33.5, w: 3, d: 7 },
    { k: 'coffee', room: 'living', x: 20, y: 35, w: 2, d: 3.5 },
    { k: 'tv', room: 'living', x: 28.3, y: 33, w: 1.5, d: 8 },
    { k: 'desk', room: 'office', x: 48.7, y: 24.8, w: 2, d: 5 },
    { k: 'bench', room: 'mud', x: 30.3, y: 27.5, w: 1.5, d: 3.5 },
    { k: 'washer', room: 'laundry', x: 41, y: 35.4, w: 2.5, d: 2.3 },
    { k: 'dryer', room: 'laundry', x: 43.7, y: 35.4, w: 2.5, d: 2.3 },
    { k: 'wh', room: 'laundry', x: 48.7, y: 35.7, w: 2, d: 2 },
  ],
}
