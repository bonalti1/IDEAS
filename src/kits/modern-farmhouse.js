// MODERN FARMHOUSE KIT
// Extracted from the Garza residence set (plan FD-25083, rev 08, 10.22.26,
// drawn by L.F. for South Texas Builders). Every number here came off those
// nine sheets. Items marked CONFIRM need a drafter's sign-off before this kit
// is used on a client project. Feet and inches unless noted.

import { NARROW_PLAN } from './farmhouse-narrow.js'
import { COMPACT_PLAN } from './farmhouse-compact.js'
import { frontGarageVariant } from './farmhouse-front-garage.js'

export const KIT = {
  id: 'farmhouse',
  name: 'Modern Farmhouse',
  source: { plan: 'FD-25083', rev: '08', date: '2026-10-22', drawnBy: 'L.F.', sheets: 9 },

  // ── Structure & envelope (sheets 300, 100, 101) ───────────────────────────
  walls: {
    exterior: { studs: '2x4 @ 16" o.c.', thicknessIn: 4, insulation: 'R-15 batt', sheathing: '1/2" plywood or OSB', wrap: 'Tyvek' },
    interior: { studs: '2x4 @ 16" o.c.', thicknessIn: 4 },
    plumbing: { studs: '2x6 @ 16" o.c.', thicknessIn: 6 },
    // Walls over 10'-0" that are not built with 2x6 must be double 2x4 at 12" o.c. (roof note 9)
    tallWallRule: 'over 10\'-0" use 2x6 or double 2x4 @ 12" o.c.',
  },
  plates: {
    default: 9, // 9' PLT at bedrooms, baths, service rooms
    public: 10, // 10' PLT at living, kitchen, dining, foyer
    vaulted: 14, // 14' PLT HT at the living room vault
    dormer: 18, // 18' PLATE at the front dormer
    byRoom: { living: 10, kitchen: 10, dining: 10, foyer: 10, pantry: 10 },
  },
  roof: {
    pitch: '10:12',
    rafters: '2x6 @ 24" o.c.',
    ceilingJoists: '2x6 @ 16" o.c.',
    overhang: '1\'-4"',
    material: 'architectural roofing shingles over 1 layer #30 felt on 5/8" OSB',
    fascia: '1x8 cedar',
    gravelGuard: '1x4 cedar',
    soffitVents: '8" x 16" vents @ 8\'-0" o.c. on 1/4" soffit',
    awnings: 'metal awnings over front and side windows',
    spanTable: 'IRC 2018 R802.4.1(1) and R802.5(1), 10 psf dead, 20 psf live', // CONFIRM current code year
  },
  foundation: {
    slab: '4" concrete, 3000 psi @ 28 days, #3 bars @ 16" o.c. both ways, 6 mil poly vapor barrier',
    perimeterBeam: '4-#5 bars continuous, #3 stirrups @ 24" o.c.',
    anchorBolts: '5/8" dia x 12" L @ 48" o.c. max, 12" from splices and ends',
    stoneLedge: '1.5" at stone veneer walls',
    showerRecess: '1 1/2" below finished floor, 1/4" per 12" slope',
    garageDrop: 'garage slab raised to finished floor; CONFIRM for plans with garage',
  },
  exterior: {
    siding: 'board and batten, 8" Hardie planks',
    accent: 'applied stone veneer at front columns and gable bases',
    stoneWainscotFt: 3.33, // 240 sf stone / 72' front on the Garza plan
    columns: '8x8 wood columns at porches',
    trim: '4" trim at windows, 1x2 Hardie trim',
  },

  // ── Standard openings (sheet 200 schedules) ───────────────────────────────
  doors: {
    interior: { w: 30, h: 80, material: 'wood hollow core' },
    interiorWide: { w: 32, h: 80, material: 'wood hollow core' }, // primary, office
    closet: { w: 24, h: 80, material: 'wood hollow core' },
    barn: { w: 30, h: 96, material: 'wood hollow core barn door', slide: true },
    pantry: { w: 36, h: 80, material: 'wood hollow core' },
    utility: { w: 24, h: 80, material: 'wood hollow core' },
    bath: { w: 28, h: 80, material: 'wood hollow core' }, // baths and half baths: 28" minimum
    garage: { w: 32, h: 80, material: 'solid core, 20-minute rated, self-closing (R302.5.1)', fireRated: true, selfClosing: true },
    overhead: { w: 192, h: 84, material: 'sectional overhead door', overhead: true }, // 16 ft double; a single bay is 9 ft
    overheadSingle: { w: 108, h: 84, material: 'sectional overhead door', overhead: true },
    showerGlass: { w: 28, h: 84, material: 'glass shower door, obscure glass' },
    exteriorSingle: { w: 36, h: 80, material: 'wood' },
    exteriorPair: { w: 36, h: 96, pair: true, material: 'fiberglass french double door' },
    headerRule: '8\'-0" head unless noted; 4" jamb typ.',
  },
  windows: {
    A: { w: 36, h: 60, type: 'single hung double insulated', material: 'aluminum', head: '7\'-0"', uFactor: 0.4, shgc: 0.25, energy: 'CONFIRM' },
    B: { w: 42, h: 36, type: 'fixed double insulated', material: 'aluminum', head: '4\'-6"', uFactor: 0.4, shgc: 0.25, energy: 'CONFIRM' },
    C: { w: 24, h: 36, type: 'fixed double insulated', material: 'aluminum', head: '5\'-0"', uFactor: 0.4, shgc: 0.25, energy: 'CONFIRM' },
    D: { w: 36, h: 42, type: 'single hung double insulated', material: 'aluminum', head: '7\'-0"', uFactor: 0.4, shgc: 0.25, energy: 'CONFIRM' },
    // IECC 2021 climate zone 2: U-factor 0.40 or less, SHGC 0.25 or less. CONFIRM the supplier's ratings.
    energyCode: { zone: 2, maxU: 0.4, maxShgc: 0.25 },
    bathGlass: 'obscured glass at bathrooms',
  },
  // Windows per room kind, by schedule mark. From the Garza plan counts (16 A, 2 D, 3 fixed).
  windowsByRoom: {
    living: ['A', 'A', 'A', 'A'],
    dining: ['A', 'A'],
    kitchen: ['A'],
    master: ['A', 'A'],
    suite2: ['A', 'A'],
    bed: ['A', 'A'],
    office: ['A'],
    mbath: ['D'],
    bath: ['C'],
    halfbath: [],
    laundry: ['B'],
    mud: [],
    foyer: ['B'],
    hall: [],
    wic: [],
    mwic: [],
    pantry: [],
  },

  // ── Room templates (cover sheet + sheet 200, Garza plan) ──────────────────
  // w = along the front, d = front to back. Zone decides which row it packs into.
  rooms: {
    living: { name: 'Living', w: 18, d: 14, zone: 'public', vaulted: true },
    kitchen: { name: 'Kitchen', w: 18, d: 11.5, zone: 'public', plumbing: true },
    dining: { name: 'Dining', w: 18, d: 11, zone: 'public' },
    foyer: { name: 'Foyer', w: 9, d: 7, zone: 'public' },
    pantry: { name: 'Pantry', w: 11, d: 7, zone: 'public' },
    office: { name: 'Office', w: 11, d: 7, zone: 'public' },
    master: { name: 'Primary Bedroom', w: 15, d: 15, zone: 'private' },
    mbath: { name: 'Primary Bath', w: 11.2, d: 8.8, zone: 'private', plumbing: true },
    mwic: { name: 'Primary Closet', w: 7.3, d: 9.8, zone: 'private' },
    suite2: { name: 'Mini Primary', w: 12, d: 12, zone: 'private' },
    bed: { name: 'Bedroom', w: 12, d: 12, zone: 'private' },
    bath: { name: 'Bath', w: 11.3, d: 5.5, zone: 'private', plumbing: true },
    jackjill: { name: 'Jack & Jill', w: 11.8, d: 11.2, zone: 'private', plumbing: true },
    halfbath: { name: 'Half Bath', w: 3.5, d: 7.7, zone: 'service', plumbing: true },
    laundry: { name: 'Laundry', w: 6.7, d: 11, zone: 'service', plumbing: true },
    mud: { name: 'Mud Room', w: 7.3, d: 5.5, zone: 'service' },
    wic: { name: 'Closet', w: 4.5, d: 9, zone: 'private' },
    hall: { name: 'Hall', w: 4, d: 12, zone: 'private' },
    garage: { name: 'Garage', w: 22, d: 22, zone: 'service', perCar: 11 }, // CONFIRM: Garza plan has no garage
    frontPorch: { name: 'Front Porch', w: 31.3, d: 10, zone: 'front', open: true },
    rearPorch: { name: 'Rear Porch', w: 36.2, d: 10, zone: 'rear', open: true },
  },
  hallWidthFt: 4, // 42" clear between 4" walls
  porch: { depthFt: 10, minDepthFt: 8 }, // deep porches for the Valley sun; the traced Garza porches were 4.5 and 5 ft
  showers: {
    master: { w: 6.5, d: 3, tileWallSf: 108, tileFloorSf: 17.5 },
    bath: { w: 3, d: 5.5, tileWallSf: 103.5, tileFloorSf: 16.5 },
    jackjill: { w: 4.3, d: 5, tileWallSf: 112.5, tileFloorSf: 19.5 },
    niche: '30" x 16"',
  },
  adjacency: [
    ['kitchen', 'dining'],
    ['kitchen', 'pantry'],
    ['dining', 'living'],
    ['foyer', 'living'],
    ['master', 'mbath'],
    ['mbath', 'mwic'],
    ['laundry', 'mud'],
    ['mud', 'garage'],
    ['mud', 'halfbath'],
    ['bed', 'bath'],
  ],
  // Private rooms sit on the opposite side from the primary suite (Garza: beds west, primary east).
  layoutRules: ['primary suite away from secondary bedrooms', 'plumbing rooms share 6" walls where possible', 'porches span the public rooms'],


  // ── Reference plan, traced from sheet 200 (feet, x from the left, y from the
  //    rear wall toward the street). This is what the layout engine starts from.
  //    Hallways are real rooms here so the walls come out where the set has them.
  // the narrow plan for 50 ft lots (src/kits/farmhouse-narrow.js); the drafter picks the one that fits the lot
  plans: { compact: COMPACT_PLAN, narrow: NARROW_PLAN },
  // the standard plan is drawn for 1,850 sf and up; the compact one (src/kits/farmhouse-compact.js) for 1,300 to 1,750
  planSqft: [1750, Infinity],
  plan: {
    footprint: { w: 72, d: 53 },
    facing: 'street', // front porch faces the lot's front street
    // Round 4 re-plan of the traced set (CONFIRM with the drafter): the pantry is inside, the dining room
    // takes the front gable the pantry had; Bath 1 sits in the wing line with its window on the side;
    // halls are 4 ft (42" clear); closets 2'-6".
    // Round 5: the primary suite is entered through a gallery off the dining room, away from the kitchen;
    // the half bath (the guests' bath) opens off that gallery, not the mud room; the pantry opens off the
    // gallery's end; the mud room has a pocket door to the kitchen so no two swings meet and the bench
    // sits on a wall with no door; the fridge moved to the kitchen's east wall (work triangle 18 ft).
    rooms: [
      { id: 'bed2', kind: 'bed', name: 'Bedroom 2', x: 3.75, y: 2.75, w: 12.25, d: 12.75 },
      { id: 'closet2', kind: 'wic', name: 'Closet', x: 15.75, y: 2.75, w: 4.0, d: 4.5 },
      { id: 'linen', kind: 'wic', name: 'Linen', x: 15.75, y: 7.25, w: 4.0, d: 3.0 },
      { id: 'jackjill', kind: 'jackjill', name: 'Jack & Jill', x: 3.75, y: 15.5, w: 12.25, d: 8.25 },
      { id: 'closet1', kind: 'wic', name: 'Closet', x: 3.75, y: 23.75, w: 6.5, d: 4.25 },
      { id: 'hall', kind: 'hall', name: 'Hallway', x: 15.75, y: 10.25, w: 4.0, d: 27.75 },
      { id: 'vest', kind: 'hall', name: 'Vestibule', x: 10.25, y: 23.75, w: 5.5, d: 4.25 },
      { id: 'bed1', kind: 'bed', name: 'Bedroom 1', x: 3.75, y: 28.0, w: 12.25, d: 12.25 },
      { id: 'bath1', kind: 'bath', name: 'Bath 1', x: 3.75, y: 40.25, w: 12.25, d: 6.0 },
      { id: 'suite2', kind: 'suite2', name: 'Mini Primary', x: 16.0, y: 38.0, w: 13.0, d: 12.5 },
      { id: 'wic2', kind: 'wic', name: 'Closet', x: 19.75, y: 31.0, w: 5.25, d: 7.0 },
      { id: 'rearPorch', kind: 'rearPorch', name: 'Rear Porch', x: 19.75, y: 2.25, w: 36.5, d: 10 },
      { id: 'living', kind: 'living', name: 'Living', x: 19.75, y: 12.25, w: 24.75, d: 18.5 },
      { id: 'kitchen', kind: 'kitchen', name: 'Kitchen', x: 44.5, y: 12.25, w: 12.5, d: 14.75 },
      { id: 'dining', kind: 'dining', name: 'Dining', x: 44.5, y: 27.0, w: 12.5, d: 11.0 },
      { id: 'office', kind: 'office', name: 'Office', x: 25.25, y: 30.75, w: 10.25, d: 7.25 },
      { id: 'foyer', kind: 'foyer', name: 'Foyer', x: 35.5, y: 30.75, w: 9.0, d: 7.25 },
      { id: 'frontPorch', kind: 'frontPorch', name: 'Front Porch', x: 29.0, y: 38.0, w: 28.0, d: 10 },
      { id: 'laundry', kind: 'laundry', name: 'Laundry', x: 64.25, y: 0.5, w: 7.75, d: 14.75 },
      { id: 'mud', kind: 'mud', name: 'Mud Room', x: 57.0, y: 9.75, w: 7.25, d: 5.5 },
      { id: 'pantry', kind: 'pantry', name: 'Pantry', x: 57.0, y: 15.25, w: 4.0, d: 4.5 },
      { id: 'halfbath', kind: 'halfbath', name: 'Half Bath', x: 61.0, y: 15.25, w: 4.25, d: 8.5 },
      { id: 'mwic', kind: 'mwic', name: 'Primary Closet', x: 65.25, y: 15.25, w: 6.75, d: 8.5 },
      { id: 'mhall', kind: 'hall', name: 'Gallery', x: 57.0, y: 19.75, w: 4.0, d: 11.75 },
      { id: 'mbath', kind: 'mbath', name: 'Primary Bath', x: 61.0, y: 23.75, w: 11.0, d: 7.75 },
      { id: 'master', kind: 'master', name: 'Primary Bedroom', x: 57.0, y: 31.5, w: 15.0, d: 16.25 },
    ],
    // a room that goes takes a neighbour with it, and a neighbour grows into the space it leaves
    companions: { bed1: ['closet1'] },
    fills: { halfbath: 'mwic' },
    // without the mini primary the hallway runs on to Bedroom 1's front wall (no notch at its end)
    trims: [{ when: 'suite2', room: 'hall', y1: 40.25 }],

    // Roof masses from sheet 100. Rectangles in plan feet (x0..x1, y0..y1),
    // ridge direction, plate height at the eave, pitch rise per 12.
    // 'ends' lists which ends are gables; the other end dies into a neighbour.
    roof: [
      // main body: one east-west ridge, 9.5 ft eave at the rear, 14 ft plate at the front wall (the entry),
      // gable ends both sides. The office and dining gables sit in front of it, so their footprints are cut out.
      { id: 'main', kind: 'gable', x0: 19.75, x1: 72, y0: 12.25, y1: 38, ridge: 'ew', plate: 9.5, plate2: 14, pitch: 10, ends: ['w', 'e'],
        cuts: [{ x0: 25.25, x1: 35.5, y0: 30.75, y1: 39.5 }, { x0: 44.5, x1: 57, y0: 27, y1: 39.5 }] },
      // left wing: bath 1 and the mini primary share one tall gable facing the street
      { id: 'leftwing', kind: 'gable', x0: 3.75, x1: 29, y0: 38, y1: 50.5, ridge: 'ns', plate: 9.5, pitch: 10, ends: ['s'] },
      // the bedroom wing; without the mini primary its gable runs on over Bath 1
      { id: 'bedwing', kind: 'gable', x0: 3.75, x1: 19.75, y0: 2.75, y1: 40.25, ridge: 'ns', plate: 9, pitch: 10, ends: ['n'], absent: { suite2: { y1: 46.25, ends: ['n', 's'] } } },
      { id: 'laundry', kind: 'gable', x0: 64.25, x1: 72, y0: 0.5, y1: 15.25, ridge: 'ns', plate: 9, pitch: 10, ends: ['n'] },
      { id: 'master', kind: 'gable', x0: 57, x1: 72, y0: 31.5, y1: 47.75, ridge: 'ns', plate: 9, pitch: 10, ends: ['s'] },
      // the two stone gables flanking the entry, 9 ft plate
      { id: 'office', kind: 'gable', x0: 25.25, x1: 35.5, y0: 30.75, y1: 38, ridge: 'ns', plate: 9, pitch: 10, ends: ['s'] },
      { id: 'dining', kind: 'gable', x0: 44.5, x1: 57, y0: 27, y1: 38, ridge: 'ns', plate: 9, pitch: 10, ends: ['s'] },
      // shed dormer over the entry: vertical face at the front wall up to the 18 ft plate, metal roof rising back
      { id: 'dormer', kind: 'dormer', x0: 35.5, x1: 44.5, face: 38, plate: 18, base: 13, depth: 9, pitch: 4, material: 'metal roof' },
      // porch roof between the two gables, and metal awnings over the windows
      { id: 'frontPorch', kind: 'shed', x0: 35.5, x1: 44.5, y0: 38, y1: 48, high: 'n', plate: 8, pitch: 3, material: 'metal roof' },
      { id: 'rearPorch', kind: 'shed', x0: 19.75, x1: 56.25, y0: 2.25, y1: 12.25, high: 's', plate: 8, pitch: 3, material: 'metal roof' },
      { id: 'awning-office', kind: 'shed', x0: 26.5, x1: 34.5, y0: 38, y1: 40.5, high: 'n', plate: 8.5, pitch: 4, material: 'metal awning', overhang: 0 },
      { id: 'awning-dining', kind: 'shed', x0: 45.5, x1: 55.5, y0: 38, y1: 40.5, high: 'n', plate: 8.5, pitch: 4, material: 'metal awning', overhang: 0 },
      { id: 'awning-suite2', kind: 'shed', x0: 18.75, x1: 27.75, y0: 50.5, y1: 53, high: 'n', plate: 8.5, pitch: 4, material: 'metal awning', overhang: 0 },
      // awnings over the side windows too (the set: "metal awnings over front and side windows"): the west sun
      { id: 'awning-bed1', kind: 'shed', x0: 1.25, x1: 3.75, y0: 32, y1: 36, high: 'e', plate: 8.5, pitch: 4, material: 'metal awning', overhang: 0 },
      { id: 'awning-bath1', kind: 'shed', x0: 1.25, x1: 3.75, y0: 40.5, y1: 44.5, high: 'e', plate: 8.5, pitch: 4, material: 'metal awning', overhang: 0 },
      { id: 'awning-master', kind: 'shed', x0: 58.5, x1: 66.5, y0: 47.75, y1: 50.25, high: 'n', plate: 8.5, pitch: 4, material: 'metal awning', overhang: 0 },
    ],
    // Rooms that share an edge with no wall between them (one open space).
    open: [
      ['living', 'kitchen'],
      ['dining', 'kitchen'],
      ['dining', 'foyer'],
      ['living', 'foyer'],
      ['hall', 'vest'],
    ],
    // Doors: centre on the wall line. axis 'h' = wall runs along x, 'v' = along y.
    // swing +1 opens toward +y (h) or +x (v); hinge 'start' = lower x or y end.
    doors: [
      { id: 'd-bed2', room: 'bed2', axis: 'v', x: 15.75, y: 12, w: 2.67, swing: -1, hinge: 'start', size: 'interiorWide' },
      { id: 'd-closet2', room: 'closet2', axis: 'v', x: 15.75, y: 5, w: 4, swing: -1, pair: true, size: 'closet' },
      { id: 'd-linen', room: 'linen', axis: 'h', x: 17.75, y: 10.25, w: 2, swing: 1, hinge: 'start', size: 'closet' },
      { id: 'd-jj-n', room: 'jackjill', axis: 'h', x: 13, y: 15.5, w: 2.5, swing: -1, hinge: 'end', size: 'interior' },
      { id: 'd-jj-s', room: 'jackjill', axis: 'h', x: 12.25, y: 23.75, w: 2.5, swing: 1, hinge: 'end', size: 'interior' },
      { id: 'd-closet1', room: 'closet1', axis: 'h', x: 7, y: 28, w: 4, swing: 1, pair: true, size: 'closet' },
      { id: 'd-bed1', room: 'bed1', axis: 'v', x: 16, y: 36.5, w: 2.67, swing: -1, hinge: 'start', size: 'interiorWide' },
      // Bath 1 serves the mini primary; without it, the door moves to Bedroom 1's wall (layout.js)
      { id: 'd-bath1', room: 'bath1', axis: 'v', x: 16, y: 44.75, w: 2.33, swing: -1, hinge: 'start', size: 'bath' },
      { id: 'd-suite2', room: 'suite2', axis: 'h', x: 18.3, y: 38, w: 2.67, swing: 1, hinge: 'start', size: 'interiorWide' },
      { id: 'd-wic2', room: 'wic2', axis: 'h', x: 23, y: 38, w: 2, swing: -1, hinge: 'end', size: 'closet' },
      { id: 'd-office', room: 'office', axis: 'h', x: 28.75, y: 30.75, w: 2.5, swing: 1, hinge: 'start', size: 'interior' },
      { id: 'd-front', room: 'foyer', axis: 'h', x: 40, y: 38, w: 6, swing: -1, pair: true, size: 'exteriorPair', exterior: true },
      { id: 'd-rear', room: 'living', axis: 'h', x: 38, y: 12.25, w: 6, swing: 1, pair: true, size: 'exteriorPair', exterior: true },
      // the mud room opens off the kitchen through a pocket door (no leaf to meet the back door's);
      // the gallery is a cased opening off the dining room; the pantry opens off the gallery's end
      { id: 'd-pantry', room: 'pantry', axis: 'h', x: 59, y: 19.75, w: 2.5, pocket: true, size: 'interior' },
      { id: 'd-kit-mud', room: 'mud', axis: 'v', x: 57, y: 13.75, w: 2.5, pocket: true, size: 'interior' },
      { id: 'd-gallery', room: 'mhall', axis: 'v', x: 57, y: 29.25, w: 3, cased: true },
      { id: 'd-hall-liv-n', room: 'living', axis: 'v', x: 19.75, y: 14.75, w: 2.5, cased: true },
      { id: 'd-hall-liv-s', room: 'living', axis: 'v', x: 19.75, y: 28.75, w: 3.5, cased: true },
      { id: 'd-mud-ext', room: 'mud', axis: 'h', x: 59.5, y: 9.75, w: 3, swing: 1, hinge: 'start', size: 'exteriorSingle', exterior: true },
      { id: 'd-laundry', room: 'laundry', axis: 'v', x: 64.25, y: 11.5, w: 3, swing: 1, hinge: 'start', size: 'pantry' },
      { id: 'd-halfbath', room: 'halfbath', axis: 'v', x: 61, y: 21.5, w: 2.33, swing: 1, hinge: 'start', size: 'bath' },
      // CONFIRM against the Garza set: the closet opens from the primary bath, the bath from the primary bedroom
      { id: 'd-mwic', room: 'mwic', axis: 'h', x: 66.75, y: 23.75, w: 2.5, swing: -1, hinge: 'start', size: 'interior' },
      { id: 'd-mbath', room: 'mbath', axis: 'h', x: 64.5, y: 31.5, w: 2.5, swing: -1, hinge: 'end', size: 'interior' },
      { id: 'd-master', room: 'master', axis: 'h', x: 58.7, y: 31.5, w: 2.67, swing: 1, hinge: 'start', size: 'interiorWide' },
    ],
    // Windows: centre on the wall line, w = rough opening width (twins are 6 ft).
    windows: [
      { mark: 'A', room: 'bed2', axis: 'h', x: 11.5, y: 2.75, w: 6 },
      { mark: 'A', room: 'bed1', axis: 'v', x: 3.75, y: 34, w: 3 },
      { mark: 'A', room: 'bath1', axis: 'v', x: 3.75, y: 42.5, w: 3 },
      { mark: 'A', room: 'suite2', axis: 'h', x: 22, y: 50.5, w: 6 },
      { mark: 'A', room: 'office', axis: 'h', x: 30, y: 38, w: 6 },
      { mark: 'A', room: 'dining', axis: 'h', x: 51, y: 38, w: 6 },
      { mark: 'A', room: 'living', axis: 'h', x: 26, y: 12.25, w: 6 },
      { mark: 'A', room: 'laundry', axis: 'h', x: 67.5, y: 0.5, w: 3 },
      { mark: 'A', room: 'master', axis: 'h', x: 62, y: 47.75, w: 6 },
      { mark: 'A', room: 'master', axis: 'h', x: 68.5, y: 47.75, w: 3 },
      { mark: 'D', room: 'kitchen', axis: 'h', x: 47.5, y: 12.25, w: 6 },
      { mark: 'C', room: 'mbath', axis: 'v', x: 72, y: 30, w: 2 },
      { mark: 'B', room: 'dormer', axis: 'h', x: 38.25, y: 38, w: 3.5, sill: 14.5, head: 17.5 },
      { mark: 'B', room: 'dormer', axis: 'h', x: 41.75, y: 38, w: 3.5, sill: 14.5, head: 17.5 },
    ],
    // Fixtures and furniture: x, y top-left in plan feet. Heights by kind in FIXTURE_H.
    fixtures: [
      { k: 'bed', room: 'bed2', x: 4, y: 6, w: 7, d: 6.5, head: 'w' },
      { k: 'bed', room: 'bed1', x: 4, y: 30.5, w: 7, d: 6.5, head: 'w' },
      { k: 'bed', room: 'suite2', x: 19, y: 42.75, w: 6.5, d: 7, head: 's' },
      { k: 'bed', room: 'master', x: 64.5, y: 34, w: 7, d: 6.5, head: 'e' },
      { k: 'shower', room: 'jackjill', x: 4, y: 16.25, w: 6.5, d: 3 },
      { k: 'toilet', room: 'jackjill', x: 4.5, y: 21, w: 1.5, d: 2.3, face: 'e' },
      { k: 'vanity', room: 'jackjill', x: 13.5, y: 18.5, w: 2, d: 4, face: 'w' },
      // bath 1: vanity by the side window, the toilet across from it, the shower mid-room so both doors clear it
      { k: 'vanity', room: 'bath1', x: 4.05, y: 40.55, w: 3, d: 2, face: 's' },
      { k: 'toilet', room: 'bath1', x: 4.5, y: 44.7, w: 2.3, d: 1.5, face: 'n' },
      { k: 'shower', room: 'bath1', x: 8, y: 40.55, w: 3, d: 5.4 },
      // half bath: toilet at the far end, vanity by the door, both clear of its swing
      { k: 'toilet', room: 'halfbath', x: 62.35, y: 15.5, w: 1.5, d: 2.3, face: 's' },
      { k: 'vanity', room: 'halfbath', x: 63.6, y: 21, w: 1.6, d: 2.5, face: 'w' },
      { k: 'vanity', room: 'mbath', x: 61, y: 24, w: 2, d: 6, face: 'e' },
      { k: 'shower', room: 'mbath', x: 68, y: 24, w: 4, d: 4.5 },
      { k: 'toilet', room: 'mbath', x: 69.75, y: 28.9, w: 1.5, d: 2.3, face: 'w' },
      { k: 'linen', room: 'mbath', x: 61, y: 30.25, w: 2, d: 1.25 },
      // work triangle (18 ft): the range on the rear run beside the window, the fridge on the east wall
      // past the mud room's door, the sink in the island
      { k: 'counter', room: 'kitchen', x: 45.5, y: 12.25, w: 7.5, d: 2.1 },
      { k: 'range', room: 'kitchen', x: 50.5, y: 12.25, w: 2.5, d: 2.1 },
      { k: 'fridge', room: 'kitchen', x: 54.5, y: 15.5, w: 2.5, d: 3 },
      { k: 'island', room: 'kitchen', x: 48, y: 19, w: 5.5, d: 3.5 },
      { k: 'sink', room: 'kitchen', x: 49.5, y: 19.75, w: 2.5, d: 1.6 },
      { k: 'table', room: 'dining', x: 48.5, y: 29.5, w: 4.5, d: 6 },
      { k: 'tv', room: 'living', x: 20, y: 17, w: 1.5, d: 8 },
      { k: 'sofa', room: 'living', x: 28.5, y: 15, w: 3, d: 7 },
      { k: 'sofa', room: 'living', x: 22, y: 23, w: 7, d: 3 },
      { k: 'coffee', room: 'living', x: 24, y: 18, w: 3.5, d: 2 },
      { k: 'desk', room: 'office', x: 33.5, y: 32, w: 2, d: 5 },
      { k: 'shelves', room: 'pantry', x: 57.25, y: 15.5, w: 3.5, d: 1.25 },
      { k: 'washer', room: 'laundry', x: 69.75, y: 7.5, w: 2.25, d: 2.5 },
      { k: 'dryer', room: 'laundry', x: 69.75, y: 10.25, w: 2.25, d: 2.5 },
      { k: 'wh', room: 'laundry', x: 64.5, y: 1, w: 2, d: 2 },
      { k: 'bench', room: 'mud', x: 60.5, y: 13.75, w: 3.5, d: 1.5 },
    ],
  },


  // ── Reference program: the Garza house, for comparing app output to sheet 200
  reference: {
    name: 'Garza residence, Rio Grande City',
    livingSf: 2533,
    frontPorchSf: 162,
    rearPorchSf: 175,
    totalSf: 2870,
    footprint: { w: 72, d: 53 },
    program: { beds: 3, baths: 3, halfBath: true, suite2: true, office: true, garage: 0, stories: 1, sqft: 2533, frontPorch: true, rearPorch: true },
    takeoff: { boardBattenSf: 2528.75, stoneSf: 240.38, showerTileSf: 377.5, interiorDoors: 22, exteriorDoors: 3, singleHung: 18, fixed: 3 },
  },

  // ── Electrical rules (sheet 400) ──────────────────────────────────────────
  electrical: [
    'Receptacles so no point along a wall is more than 6\'-0" from an outlet; no wall wider than 12" skipped',
    'GFCI at bathrooms, garage, and outdoors (WP)',
    'Smoke detectors in every sleeping room, within 12" of ceiling, min 3\'-0" from door openings, interconnected',
    'Switch plates 42" AFF to center',
    'Kitchen counter outlets 48" AFF, max 48" apart, within 6 ft of a water source GFCI',
    'Two 20 amp small appliance circuits for kitchen and breakfast',
    'Ceiling fan with light at each bedroom and living; chandelier at dining; soffit spotlights front and rear',
    'Dedicated power for A/C unit in attic, range exhaust, ACCU disconnect',
  ],

  // ── Code review keynotes (sheet 500) ──────────────────────────────────────
  code: [
    'R308.1 safety glazing identification',
    'R308.4 safety glazing at tubs, showers, and within 24" of doors',
    'R302.6 garage separation: 1/2" gyp walls, 5/8" type X at ceiling',
    'R311.3 landings at exterior doors, 36" min, 7 3/4" max step',
    'R302.11 fireblocking at concealed draft openings',
    'E4101.5 HVAC disconnecting means within sight',
    'E3901.12 120V outlet within 25 ft of HVAC equipment',
    'Table R302.6 dwelling-garage separation; E4101.5 disconnecting means',
  ],

  // ── Sheet set (cover sheet list) ──────────────────────────────────────────
  sheets: [
    { no: 'CVR', title: 'Cover Sheet', contents: 'rendered plan, material takeoff, door and window counts, building area' },
    { no: '99', title: 'Site Plan', contents: 'lot, setbacks, driveway, concrete takeoff, paving details' },
    { no: '100', title: 'Roof Plan', contents: 'ridges, gables, pitches, overhangs, rafter span table' },
    { no: '101', title: 'Foundation Plan and Details', contents: 'beams, slab, plumbing drops, details A-N' },
    { no: '200', title: 'Floor Plan', contents: 'dimensioned plan, door and window schedules, shower niche detail, notes' },
    { no: '300', title: 'Exterior Elevations', contents: 'front and rear, typical wall section' },
    { no: '301', title: 'Exterior Elevations', contents: 'left and right' },
    { no: '400', title: 'Electrical Plan', contents: 'fixtures, outlets, circuits, mounting heights' },
    { no: '500', title: 'Code Review Plan', contents: 'IRC keynotes, fireblocking, landing details' },
  ],
  // Rules the change interpreter checks before any client edit is applied.
  rules: {
    // minimum outside dimensions in feet by room kind; habitable rooms also need 70 sf (IRC R304)
    minSize: { bed: [10, 10], master: [12, 12], suite2: [11, 11], bath: [5, 8], mbath: [6, 8], jackjill: [5, 8], halfbath: [3, 5], kitchen: [9, 9], living: [12, 12], dining: [9, 9], office: [7, 7], laundry: [5, 6], mud: [4, 5], pantry: [3, 3], wic: [2, 3], mwic: [4, 5], foyer: [4, 4], hall: [3, 3], garage: [11, 20] },
    habitable: ['bed', 'master', 'suite2', 'kitchen', 'living', 'dining', 'office'],
    bedrooms: ['bed', 'master', 'suite2'],
    wet: ['bath', 'mbath', 'jackjill', 'halfbath', 'kitchen', 'laundry'],
    wetDistanceFt: 40, // the Garza bed wing's baths sit 31 to 35 ft from the kitchen; 40 still catches a bath at the far end of a garage
    required: [['kitchen'], ['living'], ['bed', 'master', 'suite2'], ['bath', 'mbath', 'jackjill']],
    maxRoomFt: 40,
    // the largest each kind is drawn, [w, d]: a resize past this is out of range, and a fix offer never goes beyond it
    maxSize: { bed: [20, 18], master: [24, 22], suite2: [20, 18], bath: [12, 14], mbath: [16, 14], jackjill: [12, 14], halfbath: [8, 8], kitchen: [24, 20], living: [30, 26], dining: [20, 18], office: [16, 16], laundry: [12, 14], mud: [12, 12], pantry: [10, 10], wic: [10, 12], mwic: [12, 14], foyer: [12, 12], hall: [10, 60], garage: [48, 48], frontPorch: [60, 12], rearPorch: [60, 16] },
  },

  // Revit names in the office template. The worker looks these up by name and
  // falls back to the template defaults when a name is missing. CONFIRM with the drafter.
  revit: {
    template: 'STB Residential.rte',
    wallTypes: { exterior: 'Exterior - 2x4 Board and Batten', interior: 'Interior - 2x4', plumbing: 'Interior - 2x6 Plumbing' },
    floorType: 'Slab on Grade - 4in',
    roofTypes: { shingles: 'Architectural Shingles on 2x6', 'metal roof': 'Standing Seam Metal', 'metal awning': 'Standing Seam Metal' },
    doors: { interior: 'Single-Flush : 30" x 80"', interiorWide: 'Single-Flush : 32" x 80"', closet: 'Single-Flush : 24" x 80"', bath: 'Single-Flush : 28" x 80"', barn: 'Sliding-Barn : 30" x 96"', pantry: 'Single-Flush : 36" x 80"', utility: 'Single-Flush : 24" x 80"', garage: 'Single-Flush - 20 min : 32" x 80"', overhead: 'Overhead-Sectional : 192" x 84"', overheadSingle: 'Overhead-Sectional : 108" x 84"', exteriorSingle: 'Exterior - Single : 36" x 80"', exteriorPair: 'Exterior - French Pair : 72" x 96"' },
    windows: { A: 'Single Hung : 36" x 60"', B: 'Fixed : 42" x 36"', C: 'Fixed : 24" x 36"', D: 'Single Hung : 36" x 42"' },
    fixtures: { toilet: 'Toilet - Standard', shower: 'Shower Pan', vanity: 'Vanity - Single', sink: 'Sink - Kitchen', fridge: 'Refrigerator', range: 'Range', washer: 'Washer', dryer: 'Dryer', wh: 'Water Heater', bed: 'Bed - Queen', sofa: 'Sofa', table: 'Table - Dining', desk: 'Desk', counter: 'Base Cabinet - Run', island: 'Island', shelves: 'Shelving', linen: 'Linen Cabinet', bench: 'Bench', tv: 'Media Wall', coffee: 'Coffee Table' },
    titleBlockFamily: 'STB Title Block : 24x36',
    viewTemplates: { plan: 'Floor Plan - Residential', elevation: 'Exterior Elevation' },
  },
  titleBlock: {
    firm: 'South Texas Builders, LLC',
    address: '4900 W Expy 83 Suite 222, McAllen, TX 78501',
    phone: '956-594-6936',
    web: 'south-texasbuilders.com',
    planNoFormat: 'FD-YYNNN',
    submittal: 'PERMIT / CONSTRUCTION SET',
  },
  generalNotes: [
    'Builder or contractor must verify all dimensions prior to proceeding with construction.',
    'Builder or contractor must verify compliance with all local building codes of the area where the structure is to be constructed and located.',
    'Plans indicate locations only; engineering aspects should incorporate actual site conditions.',
  ],
}

// Heights (ft) and labels for fixtures, shared by the viewers and the IFC export.
// the garage-forward variant for 70 to 100 ft lots (src/kits/farmhouse-front-garage.js): the standard plan with the
// garage at the front-right corner; the drafter picks it when the standard plan's garage does not fit beside the house
KIT.plans.frontgarage = frontGarageVariant(KIT.plan)

export const FIXTURE_H = { bed: 2, sofa: 2.3, coffee: 1.5, table: 2.5, desk: 2.5, tv: 2.2, counter: 3, island: 3, sink: 3.1, range: 3, fridge: 6, washer: 3, dryer: 3, wh: 5, toilet: 1.4, shower: 0.3, vanity: 2.8, linen: 6, shelves: 6, bench: 1.5 }
export const FIXTURE_NAME = { bed: 'Bed', sofa: 'Sofa', coffee: 'Coffee table', table: 'Dining table', desk: 'Desk', tv: 'Media wall', counter: 'Counter', island: 'Island', sink: 'Sink', range: 'Range', fridge: 'Refrigerator', washer: 'Washer', dryer: 'Dryer', wh: 'Water heater', toilet: 'Water closet', shower: 'Shower', vanity: 'Vanity', linen: 'Linen cabinet', shelves: 'Shelving', bench: 'Bench' }
// Window sill heights from the schedule heads (ft): A 7'-0" head, 60" tall, etc.
export const WINDOW_SILL = { A: 2, B: 1.5, C: 2, D: 3.5 }
export const WINDOW_HEAD = { A: 7, B: 4.5, C: 5, D: 7 }
export const DOOR_HEAD = 6.67

export default KIT
