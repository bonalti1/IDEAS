// The narrow plan of the Modern Farmhouse kit: a 39.5 ft wide house for 50 ft lots (40 ft buildable
// with 5 ft side setbacks). A 4 ft hall runs front to back with bedrooms on both sides, the primary
// suite at the rear, the living room and the front porch at the street, and a front-load 2-car
// garage beside the living room with its driveway straight to the street. Four bedrooms are drawn;
// a 3-bed program drops Bedroom 4 with its closet and the hall shortens. Plan feet: x from the
// left, y toward the street. The footprint is the standard plan's so both share one plan centre.
//
// Drawn in the office from the standard plan's rooms and finishes (CONFIRM: not yet a traced set).

const bed = (room, x, y, head = 'w') => ({ k: 'bed', room, x, y, w: 7, d: 6.5, head })

export const NARROW_PLAN = {
  id: 'narrow',
  footprint: { w: 72, d: 53 },
  facing: 'street',
  // what this plan can hold: the rooms step offers this when a bigger program does not fit the lot
  capacity: { beds: 4, baths: 2, halfBath: false, office: false, garage: 2, suite2: false },
  // rooms that go when their bedroom goes, and what shortens with it
  companions: { bed4: ['closet4'] },
  fills: { closet4: 'closet3' },
  trims: [{ when: 'bed4', room: 'hall', y: 0 }],
  rooms: [
    // west column (15 ft), rear to front
    { id: 'master', kind: 'master', name: 'Primary Bedroom', x: 0, y: 0, w: 15, d: 16 },
    { id: 'mbath', kind: 'mbath', name: 'Primary Bath', x: 0, y: 16, w: 9, d: 9.5 },
    { id: 'mwic', kind: 'mwic', name: 'Primary Closet', x: 9, y: 16, w: 6, d: 7 },
    { id: 'closet2', kind: 'wic', name: 'Closet', x: 9, y: 23, w: 6, d: 2.5 },
    { id: 'bed2', kind: 'bed', name: 'Bedroom 2', x: 0, y: 25.5, w: 15, d: 12.5 },
    { id: 'bath1', kind: 'bath', name: 'Bath 1', x: 0, y: 38, w: 8, d: 9.5 },
    { id: 'hall2', kind: 'hall', name: 'Hall', x: 8, y: 38, w: 7, d: 4 },
    { id: 'laundry', kind: 'laundry', name: 'Laundry', x: 8, y: 42, w: 7, d: 5.5 },
    { id: 'living', kind: 'living', name: 'Living', x: 0, y: 47.5, w: 19, d: 16 },
    // the hall, rear to the living room
    { id: 'hall', kind: 'hall', name: 'Hallway', x: 15, y: -12, w: 4, d: 59.5 },
    // east column (20.5 ft), rear to front
    { id: 'bed3', kind: 'bed', name: 'Bedroom 3', x: 19, y: 2.5, w: 20.5, d: 12.5 },
    { id: 'closet3', kind: 'wic', name: 'Closet', x: 26, y: 0, w: 13.5, d: 2.5 },
    { id: 'linen', kind: 'wic', name: 'Linen', x: 19, y: 15, w: 5, d: 6.5 },
    { id: 'dining', kind: 'dining', name: 'Dining', x: 24, y: 15, w: 15.5, d: 12.5 },
    { id: 'pantry', kind: 'pantry', name: 'Pantry', x: 19, y: 21.5, w: 5, d: 6 },
    { id: 'kitchen', kind: 'kitchen', name: 'Kitchen', x: 19, y: 27.5, w: 20.5, d: 14 },
    // the garage, front-load, beside the living room (dropped when the program has none)
    { id: 'garage', kind: 'garage', name: '2-Car Garage', x: 19, y: 41.5, w: 20.5, d: 22 },
    // the fourth bedroom at the rear (last of the bedrooms, so a 3-bed program drops it)
    { id: 'closet4', kind: 'wic', name: 'Closet', x: 19, y: 0, w: 7, d: 2.5 },
    { id: 'bed4', kind: 'bed', name: 'Bedroom 4', x: 19, y: -12, w: 20.5, d: 12 },
    // porches
    { id: 'frontPorch', kind: 'frontPorch', name: 'Front Porch', x: 0, y: 63.5, w: 19, d: 8 },
    { id: 'rearPorch', kind: 'rearPorch', name: 'Rear Porch', x: 0, y: -10, w: 15, d: 10 },
  ],
  open: [
    ['hall', 'living'],
    ['hall', 'kitchen'],
    ['hall', 'hall2'],
    ['dining', 'kitchen'],
  ],
  roof: [
    { id: 'main', kind: 'gable', x0: 0, x1: 39.5, y0: 0, y1: 63.5, ridge: 'ns', plate: 9, pitch: 10, ends: ['n', 's'] },
    { id: 'bed4', kind: 'gable', x0: 15, x1: 39.5, y0: -12, y1: 0, ridge: 'ns', plate: 9, pitch: 10, ends: ['n'] },
    { id: 'frontPorch', kind: 'shed', x0: 0, x1: 19, y0: 63.5, y1: 71.5, high: 'n', plate: 8, pitch: 3, material: 'metal roof' },
    { id: 'rearPorch', kind: 'shed', x0: 0, x1: 15, y0: -10, y1: 0, high: 's', plate: 8, pitch: 3, material: 'metal roof' },
    // metal awnings over the west windows (the Valley sun)
    { id: 'awning-master', kind: 'shed', x0: -2.5, x1: 0, y0: 4.5, y1: 11.5, high: 'e', plate: 8.5, pitch: 4, material: 'metal awning', overhang: 0 },
    { id: 'awning-bed2', kind: 'shed', x0: -2.5, x1: 0, y0: 28.5, y1: 35.5, high: 'e', plate: 8.5, pitch: 4, material: 'metal awning', overhang: 0 },
    { id: 'awning-living', kind: 'shed', x0: -2.5, x1: 0, y0: 52, y1: 59, high: 'e', plate: 8.5, pitch: 4, material: 'metal awning', overhang: 0 },
  ],
  doors: [
    // suite
    { id: 'd-master', room: 'master', axis: 'v', x: 15, y: 8, w: 2.67, swing: -1, size: 'interiorWide' },
    { id: 'd-mbath', room: 'mbath', axis: 'h', x: 4.5, y: 16, w: 2.5, swing: 1, size: 'interior' },
    { id: 'd-mwic', room: 'mwic', axis: 'v', x: 9, y: 19.5, w: 2.5, swing: 1, size: 'interior' },
    // bedrooms
    { id: 'd-closet2', room: 'closet2', axis: 'h', x: 12, y: 25.5, w: 4, swing: 1, pair: true, size: 'closet' },
    { id: 'd-bed2', room: 'bed2', axis: 'v', x: 15, y: 32, w: 2.5, swing: -1, size: 'interior' },
    { id: 'd-bed4', room: 'bed4', axis: 'v', x: 19, y: -6, w: 2.5, swing: 1, size: 'interior' },
    { id: 'd-closet4', room: 'closet4', axis: 'h', x: 22.5, y: 0, w: 4, swing: -1, pair: true, size: 'closet' },
    { id: 'd-closet3', room: 'closet3', axis: 'h', x: 32.75, y: 2.5, w: 4, swing: 1, pair: true, size: 'closet' },
    { id: 'd-bed3', room: 'bed3', axis: 'v', x: 19, y: 8.75, w: 2.5, swing: 1, size: 'interior' },
    { id: 'd-linen', room: 'linen', axis: 'v', x: 19, y: 18.25, w: 2, swing: -1, size: 'closet' },
    // bath, laundry, pantry
    { id: 'd-hall2', room: 'hall2', axis: 'v', x: 15, y: 40, w: 3.5, cased: true },
    { id: 'd-bath1', room: 'bath1', axis: 'v', x: 8, y: 40, w: 2.33, swing: -1, size: 'bath' },
    { id: 'd-laundry', room: 'laundry', axis: 'h', x: 11.5, y: 42, w: 2.5, swing: 1, size: 'interior' },
    { id: 'd-pantry', room: 'pantry', axis: 'h', x: 21.5, y: 27.5, w: 2.5, swing: -1, size: 'interior' },
    // public openings
    { id: 'd-kitchen', room: 'kitchen', axis: 'v', x: 19, y: 34, w: 5, cased: true },
    { id: 'd-living', room: 'living', axis: 'h', x: 17, y: 47.5, w: 3.5, cased: true },
    // outside
    { id: 'd-front', room: 'living', axis: 'h', x: 5, y: 63.5, w: 6, swing: -1, pair: true, size: 'exteriorPair', exterior: true },
    { id: 'd-rear', room: 'master', axis: 'h', x: 7, y: 0, w: 6, swing: 1, pair: true, size: 'exteriorPair', exterior: true },
    { id: 'd-garage', room: 'garage', axis: 'v', x: 19, y: 44.5, w: 2.67, swing: -1, size: 'garage' },
    { id: 'd-garage-overhead', room: 'garage', axis: 'h', x: 29.25, y: 63.5, w: 16, swing: 1, size: 'overhead', exterior: true },
  ],
  windows: [
    { mark: 'A', room: 'master', axis: 'v', x: 0, y: 8, w: 6 },
    { mark: 'C', room: 'mbath', axis: 'v', x: 0, y: 20.5, w: 2 },
    { mark: 'A', room: 'bed2', axis: 'v', x: 0, y: 32, w: 6 },
    { mark: 'C', room: 'bath1', axis: 'v', x: 0, y: 42.5, w: 2 },
    { mark: 'A', room: 'living', axis: 'v', x: 0, y: 55.5, w: 6 },
    { mark: 'A', room: 'living', axis: 'h', x: 12, y: 63.5, w: 6 },
    { mark: 'A', room: 'kitchen', axis: 'v', x: 39.5, y: 31.5, w: 3 },
    { mark: 'A', room: 'dining', axis: 'v', x: 39.5, y: 21, w: 6 },
    { mark: 'A', room: 'bed3', axis: 'v', x: 39.5, y: 8.75, w: 6 },
    { mark: 'A', room: 'bed4', axis: 'v', x: 39.5, y: -6, w: 3 },
    { mark: 'A', room: 'bed4', axis: 'h', x: 29, y: -12, w: 6 },
  ],
  fixtures: [
    bed('master', 4, 4.5, 'n'),
    bed('bed2', 1, 28.5, 'w'),
    bed('bed4', 26, -11, 'n'),
    bed('bed3', 26, 8, 's'),
    { k: 'shower', room: 'mbath', x: 0.3, y: 16.3, w: 5, d: 3 },
    { k: 'toilet', room: 'mbath', x: 0.5, y: 22.5, w: 1.5, d: 2.3, face: 'e' },
    { k: 'vanity', room: 'mbath', x: 6.8, y: 19.3, w: 2, d: 5.5, face: 'w' },
    { k: 'shower', room: 'bath1', x: 0.3, y: 44.3, w: 5, d: 3 },
    { k: 'toilet', room: 'bath1', x: 0.5, y: 38.5, w: 1.5, d: 2.3, face: 'e' },
    { k: 'vanity', room: 'bath1', x: 5.8, y: 38.8, w: 2, d: 4, face: 'w' },
    { k: 'washer', room: 'laundry', x: 8.3, y: 44.9, w: 2.25, d: 2.5 },
    { k: 'dryer', room: 'laundry', x: 10.8, y: 44.9, w: 2.25, d: 2.5 },
    { k: 'wh', room: 'laundry', x: 12.8, y: 44.9, w: 2, d: 2 },
    // kitchen: a run on the rear wall with the fridge and the range, a short run on the east wall, the sink in the island
    { k: 'fridge', room: 'kitchen', x: 25.5, y: 27.8, w: 3, d: 2.5 },
    { k: 'counter', room: 'kitchen', x: 28.5, y: 27.8, w: 8.9, d: 2.1 },
    { k: 'range', room: 'kitchen', x: 31.5, y: 27.8, w: 2.5, d: 2.1 },
    { k: 'counter', room: 'kitchen', x: 37.4, y: 29.9, w: 2.1, d: 5.6 },
    { k: 'island', room: 'kitchen', x: 26, y: 34, w: 7, d: 3.5 },
    { k: 'sink', room: 'kitchen', x: 28.5, y: 34.5, w: 2.5, d: 1.6 },
    { k: 'shelves', room: 'pantry', x: 19.3, y: 22, w: 1.5, d: 5 },
    { k: 'table', room: 'dining', x: 29.5, y: 18, w: 4.5, d: 6.5 },
    { k: 'sofa', room: 'living', x: 4, y: 53, w: 7, d: 3 },
    { k: 'coffee', room: 'living', x: 5.5, y: 57, w: 3.5, d: 2 },
    { k: 'tv', room: 'living', x: 0.2, y: 51, w: 1.5, d: 8 },
  ],
}
