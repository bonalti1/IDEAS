// The compact plan of the Modern Farmhouse kit: a 37.5 ft wide 3 bed, 2 bath starter of about
// 1,450 sf (drawn), for 1,200 to 1,750 sf programs on any lot a 40 ft house fits. The primary suite
// at the rear-west, two bedrooms and a hall bath off a 33 ft hall, the kitchen and dining at the
// rear-east with a French door to the yard, the living room across the front, the pantry, mud room
// and laundry between the kitchen and a front-load garage (with no garage the mud room opens to the
// yard through its back wall). No office, no second suite, no half
// bath: the rooms step offers the standard plan for those. Plan feet: x from the left, y toward the
// street. The footprint is the standard plan's so the three plans share one plan centre.
//
// Drawn in the office from the standard plan's rooms and finishes (CONFIRM: not yet a traced set).

const bed = (room, x, y, head = 'w') => ({ k: 'bed', room, x, y, w: 7, d: 6.5, head })
const awning = (id, cy) => ({ id: `awning-${id}`, kind: 'shed', x0: -2.5, x1: 0, y0: cy - 3.5, y1: cy + 3.5, high: 'e', plate: 8.5, pitch: 4, material: 'metal awning', overhang: 0 })

export const COMPACT_PLAN = {
  id: 'compact',
  footprint: { w: 72, d: 53 },
  minWidth: 36, // the narrowest the house goes at this plan's smallest size (the fit does not try it on a lot tighter than this)
  facing: 'street',
  // what this plan can hold, and the living area it is drawn for
  capacity: { beds: 3, baths: 2, halfBath: false, office: false, garage: 2, suite2: false },
  sqft: [1200, 1750],
  // a starter's rooms run smaller than the standard plan's: these floors replace the kit's for this plan
  minSize: { bed: [9.5, 9.5], master: [11.5, 11.5], dining: [8, 8], living: [11, 11], kitchen: [8, 8] },
  companions: { bed3: ['closet3'] },
  fills: {},
  trims: [],
  rooms: [
    // west column (13 ft), rear to front
    { id: 'master', kind: 'master', name: 'Primary Bedroom', x: 0, y: 0, w: 13, d: 13.5 },
    { id: 'mbath', kind: 'mbath', name: 'Primary Bath', x: 0, y: 13.5, w: 8, d: 7 },
    { id: 'mwic', kind: 'mwic', name: 'Primary Closet', x: 8, y: 13.5, w: 5, d: 7 },
    { id: 'bed2', kind: 'bed', name: 'Bedroom 2', x: 0, y: 20.5, w: 13, d: 10.5 },
    { id: 'closet2', kind: 'wic', name: 'Closet', x: 0, y: 31, w: 5, d: 5 },
    { id: 'bath1', kind: 'bath', name: 'Bath 1', x: 5, y: 31, w: 8, d: 5 },
    { id: 'living', kind: 'living', name: 'Living', x: 0, y: 36, w: 17, d: 15 },
    // the hall, a linen closet at its rear end
    // round 15, item U19: the linen closet takes the hall's first 7 ft, so the hall is 29 ft drawn (it was 32, and 36
    // at 1,750 sf, over the 35 ft a hall may run)
    { id: 'linen', kind: 'wic', name: 'Linen', x: 13, y: 0, w: 4, d: 7 },
    { id: 'hall', kind: 'hall', name: 'Hallway', x: 13, y: 7, w: 4, d: 29 },
    // east column (20.5 ft), rear to front
    { id: 'bed3', kind: 'bed', name: 'Bedroom 3', x: 17, y: 0, w: 11.5, d: 11 },
    { id: 'closet3', kind: 'wic', name: 'Closet', x: 17, y: 11, w: 11.5, d: 2.5 },
    { id: 'dining', kind: 'dining', name: 'Dining', x: 28.5, y: 0, w: 9, d: 13.5 },
    { id: 'kitchen', kind: 'kitchen', name: 'Kitchen', x: 17, y: 13.5, w: 20.5, d: 10.5 },
    { id: 'pantry', kind: 'pantry', name: 'Pantry', x: 17, y: 24, w: 3.5, d: 5 },
    { id: 'mud', kind: 'mud', name: 'Mud Room', x: 20.5, y: 24, w: 7, d: 5 },
    { id: 'laundry', kind: 'laundry', name: 'Laundry', x: 27.5, y: 24, w: 7.5, d: 5 },
    // the garage, front-load, beside the living room (dropped when the program has none; a 1-car narrows it);
    // the 2.5 x 5 ft notch beside the laundry, outside, takes the condenser
    { id: 'garage', kind: 'garage', name: '2-Car Garage', x: 17, y: 29, w: 20.5, d: 22 },
    // porches
    { id: 'frontPorch', kind: 'frontPorch', name: 'Front Porch', x: 0, y: 51, w: 17, d: 8 },
    { id: 'rearPorch', kind: 'rearPorch', name: 'Rear Porch', x: 0, y: -8, w: 13, d: 8 },
  ],
  open: [
    ['hall', 'living'],
    ['hall', 'kitchen'],
    ['dining', 'kitchen'],
  ],
  roof: [
    { id: 'main', kind: 'gable', x0: 0, x1: 37.5, y0: 0, y1: 51, ridge: 'ns', plate: 9, pitch: 8, ends: ['n', 's'] },
    { id: 'frontPorch', kind: 'shed', x0: 0, x1: 17, y0: 51, y1: 59, high: 'n', plate: 8, pitch: 3, material: 'metal roof' },
    { id: 'rearPorch', kind: 'shed', x0: 0, x1: 13, y0: -8, y1: 0, high: 's', plate: 8, pitch: 3, material: 'metal roof' },
    // metal awnings over the west windows (the Valley sun)
    awning('bed2', 25.75),
    awning('living', 43.5),
  ],
  doors: [
    // suite: the bath and the closet from the bedroom
    { id: 'd-master', room: 'master', axis: 'v', x: 13, y: 9, w: 2.67, swing: -1, hinge: 'start', size: 'interiorWide' },
    { id: 'd-mbath', room: 'mbath', axis: 'h', x: 6, y: 13.5, w: 2.5, swing: 1, hinge: 'end', size: 'interior' },
    { id: 'd-mwic', room: 'mwic', axis: 'h', x: 10.5, y: 13.5, w: 2.5, swing: 1, hinge: 'start', size: 'interior' },
    // bedrooms, closets, the hall bath, the linen
    { id: 'd-bed2', room: 'bed2', axis: 'v', x: 13, y: 26, w: 2.67, swing: -1, hinge: 'start', size: 'interiorWide' },
    { id: 'd-closet2', room: 'closet2', axis: 'h', x: 2.5, y: 31, w: 4, swing: -1, hinge: 'start', pair: true, size: 'closet' },
    { id: 'd-bath1', room: 'bath1', axis: 'v', x: 13, y: 34.8, w: 2.33, swing: -1, hinge: 'end', size: 'bath' },
    { id: 'd-linen', room: 'linen', axis: 'h', x: 15, y: 7, w: 2, swing: 1, hinge: 'start', size: 'closet' },
    { id: 'd-bed3', room: 'bed3', axis: 'v', x: 17, y: 8.5, w: 2.67, swing: 1, hinge: 'start', size: 'interiorWide' },
    { id: 'd-closet3', room: 'closet3', axis: 'h', x: 24.5, y: 11, w: 4, swing: -1, hinge: 'start', pair: true, size: 'closet' },
    // kitchen side: the pantry, mud room and laundry off the kitchen's south wall; the garage into the mud room
    // the pantry is under 25 sf: its door swings out into the kitchen
    { id: 'd-pantry', room: 'pantry', axis: 'h', x: 18.75, y: 24, w: 2.5, swing: -1, hinge: 'start', size: 'interior' },
    { id: 'd-mud', room: 'mud', axis: 'h', x: 22.5, y: 24, w: 2.5, pocket: true, size: 'interior' },
    { id: 'd-laundry', room: 'laundry', axis: 'h', x: 31.5, y: 24, w: 2.5, swing: 1, hinge: 'end', size: 'interior' },
    { id: 'd-garage', room: 'garage', axis: 'h', x: 26, y: 29, w: 2.67, swing: -1, hinge: 'start', size: 'garage' },
    // with no garage the mud room's back wall is outside: it keeps a door to the yard (a drop zone, not a closet)
    { id: 'd-mud-ext', room: 'mud', axis: 'h', x: 24, y: 29, w: 3, swing: -1, hinge: 'start', size: 'exteriorSingle', exterior: true, unless: 'garage' },
    // public openings
    { id: 'd-kitchen', room: 'kitchen', axis: 'v', x: 17, y: 18.5, w: 4, cased: true },
    { id: 'd-living', room: 'living', axis: 'h', x: 15, y: 36, w: 3.5, cased: true },
    // outside: the front door, the dining room's French door to the yard, the overhead door
    { id: 'd-front', room: 'living', axis: 'h', x: 12, y: 51, w: 6, swing: -1, pair: true, size: 'exteriorPair', exterior: true },
    { id: 'd-rear', room: 'dining', axis: 'h', x: 33, y: 0, w: 6, swing: 1, pair: true, size: 'exteriorPair', exterior: true },
    { id: 'd-garage-overhead', room: 'garage', axis: 'h', x: 27.25, y: 51, w: 16, swing: 1, size: 'overhead', exterior: true },
  ],
  windows: [
    { mark: 'A', room: 'master', axis: 'h', x: 6.5, y: 0, w: 6 },
    { mark: 'C', room: 'mbath', axis: 'v', x: 0, y: 17.5, w: 2 },
    { mark: 'A', room: 'bed2', axis: 'v', x: 0, y: 25.75, w: 6 },
    { mark: 'A', room: 'living', axis: 'v', x: 0, y: 43.5, w: 6 },
    { mark: 'A', room: 'living', axis: 'h', x: 4.5, y: 51, w: 6 },
    { mark: 'A', room: 'bed3', axis: 'h', x: 22.75, y: 0, w: 6 },
    { mark: 'A', room: 'dining', axis: 'v', x: 37.5, y: 7, w: 6 },
    { mark: 'A', room: 'kitchen', axis: 'v', x: 37.5, y: 18.3, w: 3 },
  ],
  fixtures: [
    // beds by the rear walls, clear of every door's swing and of the 30" in front of the closet doors
    bed('master', 3, 1, 'n'),
    bed('bed2', 3, 20.5, 'n'),
    bed('bed3', 21, 0.3, 'n'),
    // primary bath: vanity under the side window, the shower opening east, the toilet past the door's swing
    { k: 'vanity', room: 'mbath', x: 0.3, y: 15.5, w: 2, d: 4, face: 'e' },
    { k: 'shower', room: 'mbath', x: 2.3, y: 16.1, w: 2.8, d: 4.1 },
    { k: 'toilet', room: 'mbath', x: 5.3, y: 18.8, w: 2.3, d: 1.5, face: 'n' },
    // hall bath: shower at the far end, the toilet across from the vanity, the door at the front end
    { k: 'shower', room: 'bath1', x: 5.3, y: 31.3, w: 2.5, d: 4.4 },
    { k: 'toilet', room: 'bath1', x: 9.85, y: 31.2, w: 1.5, d: 2.3, face: 's' },
    { k: 'vanity', room: 'bath1', x: 8.3, y: 34, w: 2, d: 2, face: 'n' },
    // kitchen: an L of counters, the fridge and range on the east wall either side of the window, the sink on the rear run (18 ft triangle)
    { k: 'counter', room: 'kitchen', x: 35.4, y: 13.8, w: 2.1, d: 9.9 },
    { k: 'counter', room: 'kitchen', x: 17.3, y: 13.8, w: 18.1, d: 2.1 },
    { k: 'fridge', room: 'kitchen', x: 35, y: 13.8, w: 2.5, d: 3 },
    { k: 'range', room: 'kitchen', x: 35, y: 20, w: 2.5, d: 2.5 },
    { k: 'sink', room: 'kitchen', x: 30.5, y: 13.8, w: 2.5, d: 1.6 },
    { k: 'table', room: 'dining', x: 31, y: 3.5, w: 3.5, d: 5.5 },
    { k: 'shelves', room: 'pantry', x: 17.3, y: 27.75, w: 2.9, d: 1.25 },
    { k: 'bench', room: 'mud', x: 20.5, y: 26.6, w: 1.2, d: 2.4 },
    // the entry zone (round 8, item 19): a bench-and-hook wall inside the front door, no foyer
    { k: 'bench', room: 'living', x: 15.5, y: 47.5, w: 1.5, d: 3.5 },
    { k: 'washer', room: 'laundry', x: 27.8, y: 26.5, w: 2.25, d: 2.5 },
    { k: 'dryer', room: 'laundry', x: 30.05, y: 26.5, w: 2.25, d: 2.5 },
    { k: 'wh', room: 'laundry', x: 33, y: 27, w: 2, d: 2 },
    { k: 'tv', room: 'living', x: 3, y: 36.2, w: 8, d: 1.5 },
    { k: 'coffee', room: 'living', x: 4.5, y: 41.5, w: 3.5, d: 2 },
    { k: 'sofa', room: 'living', x: 3, y: 44.5, w: 7, d: 3 },
  ],
}
