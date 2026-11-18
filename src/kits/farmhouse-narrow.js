// The narrow plan of the Modern Farmhouse kit: a 39.5 ft wide house for 50 ft lots (40 ft buildable
// with 5 ft side setbacks). A 4 ft hall runs front to back with bedrooms on both sides, the primary
// suite at the rear-left, the living room and the front porch at the street, and a front-load 2-car
// garage beside the living room with its driveway straight to the street. Round 6: the dining room
// and the kitchen take the rear-right, the dining room's French door opening onto the rear porch (the
// family rooms' way to the back yard; the 5 ft side yards get no doors); Bedroom 3 is Bedroom 2's size
// and sits at the front-right beside the garage, off a short hall with the hall bath and the pantry;
// the fourth bedroom goes behind the primary suite at the rear-left. Plan feet: x from the left, y
// toward the street. The footprint is the standard plan's so the plans share one plan centre.
//
// Drawn in the office from the standard plan's rooms and finishes (CONFIRM: not yet a traced set).

const bed = (room, x, y, head = 'w') => ({ k: 'bed', room, x, y, w: 7, d: 6.5, head })
const awning = (id, cy) => ({ id: `awning-${id}`, kind: 'shed', x0: -2.5, x1: 0, y0: cy - 3.5, y1: cy + 3.5, high: 'e', plate: 8.5, pitch: 4, material: 'metal awning', overhang: 0 })

export const NARROW_PLAN = {
  id: 'narrow',
  footprint: { w: 72, d: 53 },
  facing: 'street',
  // what this plan can hold: the rooms step offers this when a bigger program does not fit the lot
  capacity: { beds: 4, baths: 2, halfBath: false, office: false, garage: 2, suite2: false },
  // drawn for about 1,900 sf; smaller programs take the compact plan
  sqft: [1750, 3200],
  // rooms that go when their bedroom goes, and what shortens with it (the hall starts at the dining room)
  companions: { bed4: ['closet4'] },
  fills: {},
  trims: [{ when: 'bed4', room: 'hall', y: 0 }],
  rooms: [
    // west column (15 ft), rear to front: the suite, Bedroom 2, the service rooms, the living room (the fourth bedroom,
    // behind the suite, is last in the list: a 3-bed program drops the last bedroom)
    { id: 'master', kind: 'master', name: 'Primary Bedroom', x: 0, y: 0, w: 15, d: 15 },
    { id: 'mbath', kind: 'mbath', name: 'Primary Bath', x: 0, y: 15, w: 9, d: 9.5 },
    { id: 'mwic', kind: 'mwic', name: 'Primary Closet', x: 9, y: 15, w: 6, d: 7 },
    { id: 'closet2', kind: 'wic', name: 'Closet', x: 9, y: 22, w: 6, d: 2.5 },
    { id: 'bed2', kind: 'bed', name: 'Bedroom 2', x: 0, y: 24.5, w: 15, d: 12 },
    // the laundry and a drop zone off a short cross hall, across the main hall from the garage door
    { id: 'laundry', kind: 'laundry', name: 'Laundry', x: 0, y: 36.5, w: 8, d: 9 },
    { id: 'hall2', kind: 'hall', name: 'Hall', x: 8, y: 36.5, w: 7, d: 4 },
    { id: 'mud', kind: 'mud', name: 'Drop Zone', x: 8, y: 40.5, w: 7, d: 5 },
    { id: 'living', kind: 'living', name: 'Living', x: 0, y: 45.5, w: 19, d: 16 },
    // the hall, rear to the living room; open to the dining room, the kitchen and the living room along the way
    { id: 'hall', kind: 'hall', name: 'Hallway', x: 15, y: -6.5, w: 4, d: 52 },
    // east column (20.5 ft), rear to front: the dining room on the rear porch, the kitchen, a short hall with the
    // pantry and the hall bath off it and Bedroom 3 beside them, the garage
    { id: 'dining', kind: 'dining', name: 'Dining', x: 19, y: 0, w: 20.5, d: 11 },
    { id: 'kitchen', kind: 'kitchen', name: 'Kitchen', x: 19, y: 11, w: 20.5, d: 13 },
    { id: 'hall3', kind: 'hall', name: 'Hall', x: 19, y: 24, w: 5, d: 4 },
    { id: 'pantry', kind: 'pantry', name: 'Pantry', x: 19, y: 28, w: 5, d: 3 },
    { id: 'bath2', kind: 'bath', name: 'Bath 2', x: 19, y: 31, w: 5, d: 8.5 },
    { id: 'bed3', kind: 'bed', name: 'Bedroom 3', x: 24, y: 24, w: 15.5, d: 12.5 },
    { id: 'closet3', kind: 'wic', name: 'Closet', x: 24, y: 36.5, w: 15.5, d: 3 },
    // the garage, front-load, beside the living room (dropped when the program has none)
    { id: 'garage', kind: 'garage', name: '2-Car Garage', x: 19, y: 39.5, w: 20.5, d: 22 },
    // the fourth bedroom behind the suite (last of the bedrooms, so a 3-bed program drops it and the hall starts at the dining room)
    { id: 'bed4', kind: 'bed', name: 'Bedroom 4', x: 0, y: -13.5, w: 15, d: 11 },
    { id: 'closet4', kind: 'wic', name: 'Closet', x: 0, y: -2.5, w: 15, d: 2.5 },
    // porches: the rear porch behind the dining room
    { id: 'frontPorch', kind: 'frontPorch', name: 'Front Porch', x: 0, y: 61.5, w: 19, d: 8 },
    { id: 'rearPorch', kind: 'rearPorch', name: 'Rear Porch', x: 19, y: -10, w: 20.5, d: 10 },
  ],
  open: [
    ['hall', 'living'],
    ['hall', 'kitchen'],
    ['hall', 'dining'],
    ['hall', 'hall2'],
    ['hall', 'hall3'],
    ['dining', 'kitchen'],
  ],
  roof: [
    { id: 'main', kind: 'gable', x0: 0, x1: 39.5, y0: 0, y1: 61.5, ridge: 'ns', plate: 9, pitch: 10, ends: ['n', 's'] },
    { id: 'bed4', kind: 'gable', x0: 0, x1: 19, y0: -13.5, y1: 0, ridge: 'ns', plate: 9, pitch: 10, ends: ['n'] },
    { id: 'frontPorch', kind: 'shed', x0: 0, x1: 19, y0: 61.5, y1: 69.5, high: 'n', plate: 8, pitch: 3, material: 'metal roof' },
    { id: 'rearPorch', kind: 'shed', x0: 19, x1: 39.5, y0: -10, y1: 0, high: 's', plate: 8, pitch: 3, material: 'metal roof' },
    // metal awnings over the west windows (the Valley sun)
    awning('bed4', -8),
    awning('master', 7.5),
    awning('bed2', 30.5),
    awning('living', 53.5),
  ],
  doors: [
    // the suite and the fourth bedroom
    { id: 'd-master', room: 'master', axis: 'v', x: 15, y: 6.5, w: 2.67, swing: -1, hinge: 'start', size: 'interiorWide' },
    { id: 'd-mbath', room: 'mbath', axis: 'h', x: 7.75, y: 15, w: 2.5, swing: 1, hinge: 'end', size: 'interior' },
    { id: 'd-mwic', room: 'mwic', axis: 'v', x: 9, y: 19, w: 2.5, swing: 1, hinge: 'start', size: 'interior' },
    { id: 'd-bed4', room: 'bed4', axis: 'v', x: 15, y: -5, w: 2.5, swing: -1, hinge: 'start', size: 'interior' },
    { id: 'd-closet4', room: 'closet4', axis: 'h', x: 7, y: -2.5, w: 4, swing: -1, pair: true, size: 'closet' },
    // bedrooms
    { id: 'd-closet2', room: 'closet2', axis: 'h', x: 12, y: 24.5, w: 4, swing: 1, pair: true, size: 'closet' },
    { id: 'd-bed2', room: 'bed2', axis: 'v', x: 15, y: 31, w: 2.5, swing: -1, size: 'interior' },
    { id: 'd-bed3', room: 'bed3', axis: 'v', x: 24, y: 26, w: 2.5, swing: 1, hinge: 'start', size: 'interior' },
    { id: 'd-closet3', room: 'closet3', axis: 'h', x: 32, y: 36.5, w: 4, swing: -1, pair: true, size: 'closet' },
    // the hall bath off the main hall, hinged on the front jamb so the leaf clears the vanity
    { id: 'd-bath2', room: 'bath2', axis: 'v', x: 19, y: 38.2, w: 2.33, swing: 1, hinge: 'end', size: 'bath' },
    // laundry, drop zone, pantry (the pantry is under 25 sf: its door swings out, into the short hall)
    { id: 'd-hall2', room: 'hall2', axis: 'v', x: 15, y: 38.5, w: 3.5, cased: true },
    { id: 'd-laundry', room: 'laundry', axis: 'v', x: 8, y: 38.5, w: 2.5, swing: -1, hinge: 'start', size: 'interior' },
    { id: 'd-mud', room: 'mud', axis: 'h', x: 11.5, y: 40.5, w: 2.5, swing: 1, hinge: 'start', size: 'interior' },
    { id: 'd-pantry', room: 'pantry', axis: 'h', x: 21.5, y: 28, w: 2.5, swing: -1, hinge: 'start', size: 'interior' },
    // public openings
    { id: 'd-dining', room: 'dining', axis: 'v', x: 19, y: 5.5, w: 4, cased: true },
    { id: 'd-kitchen', room: 'kitchen', axis: 'v', x: 19, y: 17.5, w: 5, cased: true },
    { id: 'd-hall3', room: 'hall3', axis: 'v', x: 19, y: 26, w: 3, cased: true },
    { id: 'd-living', room: 'living', axis: 'h', x: 17, y: 45.5, w: 3.5, cased: true },
    // outside: the front door, the dining room's French door to the rear porch, the garage
    { id: 'd-front', room: 'living', axis: 'h', x: 5, y: 61.5, w: 6, swing: -1, pair: true, size: 'exteriorPair', exterior: true },
    { id: 'd-rear', room: 'dining', axis: 'h', x: 29.25, y: 0, w: 6, swing: 1, pair: true, size: 'exteriorPair', exterior: true },
    { id: 'd-garage', room: 'garage', axis: 'v', x: 19, y: 42.5, w: 2.67, swing: -1, size: 'garage' },
    { id: 'd-garage-overhead', room: 'garage', axis: 'h', x: 29.25, y: 61.5, w: 16, swing: 1, size: 'overhead', exterior: true },
  ],
  windows: [
    { mark: 'A', room: 'bed4', axis: 'v', x: 0, y: -8, w: 6 },
    { mark: 'A', room: 'master', axis: 'v', x: 0, y: 7.5, w: 6 },
    // the suite's rear window stands in for the old French door; with a fourth bedroom behind it, it goes
    { mark: 'A', room: 'master', axis: 'h', x: 7, y: 0, w: 6, unless: 'bed4' },
    { mark: 'C', room: 'mbath', axis: 'v', x: 0, y: 19.5, w: 2 },
    { mark: 'A', room: 'bed2', axis: 'v', x: 0, y: 30.5, w: 6 },
    { mark: 'A', room: 'living', axis: 'v', x: 0, y: 53.5, w: 6 },
    { mark: 'A', room: 'living', axis: 'h', x: 12, y: 61.5, w: 6 },
    { mark: 'A', room: 'dining', axis: 'v', x: 39.5, y: 5.5, w: 6 },
    { mark: 'A', room: 'kitchen', axis: 'v', x: 39.5, y: 17.5, w: 3 },
    { mark: 'A', room: 'bed3', axis: 'v', x: 39.5, y: 30.25, w: 6 },
  ],
  fixtures: [
    bed('bed4', 4, -13.2, 'n'),
    bed('master', 4, 4.5, 'n'),
    bed('bed2', 1, 27.5, 'w'),
    bed('bed3', 32.5, 27, 'e'),
    // primary bath: shower and toilet on the far wall, the vanity under the side window, both doors clear
    { k: 'vanity', room: 'mbath', x: 0.3, y: 16, w: 2, d: 4, face: 'e' },
    { k: 'shower', room: 'mbath', x: 0.3, y: 21.3, w: 5, d: 2.9 },
    { k: 'toilet', room: 'mbath', x: 6.5, y: 21.9, w: 1.5, d: 2.3, face: 'n' },
    // hall bath: the shower across the rear wall, the water closet below it, the vanity by the door's far jamb
    { k: 'shower', room: 'bath2', x: 19.3, y: 31.3, w: 4.4, d: 2.7 },
    { k: 'toilet', room: 'bath2', x: 19.5, y: 34.5, w: 1.5, d: 2.3, face: 'e' },
    { k: 'vanity', room: 'bath2', x: 22, y: 37.3, w: 2, d: 2, face: 'w' },
    { k: 'washer', room: 'laundry', x: 0.3, y: 42.9, w: 2.25, d: 2.5 },
    { k: 'dryer', room: 'laundry', x: 2.8, y: 42.9, w: 2.25, d: 2.5 },
    { k: 'wh', room: 'laundry', x: 5.5, y: 43.4, w: 2, d: 2 },
    { k: 'bench', room: 'mud', x: 13.5, y: 41.7, w: 1.5, d: 3.5 },
    // kitchen: the sink under the side window on the east run, the fridge and the range on the run along the
    // bedroom wall, the island between them (work triangle about 19 ft)
    { k: 'counter', room: 'kitchen', x: 37.4, y: 11.5, w: 2.1, d: 11.5 },
    { k: 'sink', room: 'kitchen', x: 37.7, y: 16.75, w: 1.6, d: 2.5 },
    { k: 'fridge', room: 'kitchen', x: 30, y: 21, w: 2.5, d: 3 },
    { k: 'counter', room: 'kitchen', x: 32.5, y: 21.9, w: 4.9, d: 2.1 },
    { k: 'range', room: 'kitchen', x: 34.9, y: 21.9, w: 2.5, d: 2.1 },
    { k: 'island', room: 'kitchen', x: 26, y: 15, w: 7, d: 3 },
    { k: 'shelves', room: 'pantry', x: 19.3, y: 29.75, w: 4.4, d: 1.25 },
    { k: 'table', room: 'dining', x: 27, y: 5, w: 4.5, d: 5 },
    { k: 'sofa', room: 'living', x: 4, y: 51, w: 7, d: 3 },
    { k: 'coffee', room: 'living', x: 5.5, y: 55, w: 3.5, d: 2 },
    { k: 'tv', room: 'living', x: 0.2, y: 49, w: 1.5, d: 8 },
  ],
}
