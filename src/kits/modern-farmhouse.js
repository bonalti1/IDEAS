// MODERN FARMHOUSE KIT
// Extracted from the Garza residence set (plan FD-25083, rev 08, 10.22.26,
// drawn by L.F. for South Texas Builders). Every number here came off those
// nine sheets. Items marked CONFIRM need a drafter's sign-off before this kit
// is used on a client project. Feet and inches unless noted.

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
    showerGlass: { w: 28, h: 84, material: 'glass shower door, obscure glass' },
    exteriorSingle: { w: 36, h: 80, material: 'wood' },
    exteriorPair: { w: 36, h: 96, pair: true, material: 'fiberglass french double door' },
    headerRule: '8\'-0" head unless noted; 4" jamb typ.',
  },
  windows: {
    A: { w: 36, h: 60, type: 'single hung double insulated', material: 'aluminum', head: '7\'-0"' },
    B: { w: 42, h: 36, type: 'fixed double insulated', material: 'aluminum', head: '4\'-6"' },
    C: { w: 24, h: 36, type: 'fixed double insulated', material: 'aluminum', head: '5\'-0"' },
    D: { w: 36, h: 42, type: 'single hung double insulated', material: 'aluminum', head: '7\'-0"' },
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
    frontPorch: { name: 'Front Porch', w: 31.3, d: 5.2, zone: 'front', open: true },
    rearPorch: { name: 'Rear Porch', w: 36.2, d: 4.8, zone: 'rear', open: true },
  },
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
    ['bed', 'bath'],
  ],
  // Private rooms sit on the opposite side from the primary suite (Garza: beds west, primary east).
  layoutRules: ['primary suite away from secondary bedrooms', 'plumbing rooms share 6" walls where possible', 'porches span the public rooms'],


  // ── Reference plan, traced from sheet 200 (feet, x from the left, y from the
  //    rear wall toward the street). This is what the layout engine starts from.
  //    Hallways are real rooms here so the walls come out where the set has them.
  plan: {
    footprint: { w: 72, d: 53 },
    facing: 'street', // front porch faces the lot's front street
    rooms: [
      { id: 'bed2', kind: 'bed', name: 'Bedroom 2', x: 3.75, y: 2.75, w: 12.25, d: 12.5 },
      { id: 'closet2', kind: 'wic', name: 'Closet', x: 15.75, y: 2.75, w: 4.0, d: 7.5 },
      { id: 'linen', kind: 'wic', name: 'Linen', x: 15.75, y: 10.25, w: 4.0, d: 5.0 },
      { id: 'jackjill', kind: 'jackjill', name: 'Jack & Jill', x: 3.75, y: 16.0, w: 12.25, d: 7.75 },
      { id: 'closet1', kind: 'wic', name: 'Closet', x: 3.75, y: 24.25, w: 6.5, d: 3.75 },
      { id: 'hall', kind: 'hall', name: 'Hallway', x: 15.75, y: 15.25, w: 4.0, d: 24.25 },
      { id: 'bed1', kind: 'bed', name: 'Bedroom 1', x: 3.75, y: 28.0, w: 12.25, d: 12.0 },
      { id: 'bath1', kind: 'bath', name: 'Bath 1', x: 0.0, y: 39.75, w: 12.25, d: 6.0 },
      { id: 'suite2', kind: 'suite2', name: 'Mini Primary', x: 12.25, y: 39.75, w: 13.0, d: 12.5 },
      { id: 'wic2', kind: 'wic', name: 'Closet', x: 19.75, y: 31.0, w: 5.25, d: 8.75 },
      { id: 'rearPorch', kind: 'rearPorch', name: 'Rear Porch', x: 19.75, y: 7.75, w: 36.5, d: 4.5 },
      { id: 'living', kind: 'living', name: 'Living', x: 19.75, y: 12.25, w: 15.5, d: 18.5 },
      { id: 'dining', kind: 'dining', name: 'Dining', x: 35.5, y: 12.25, w: 11.0, d: 18.5 },
      { id: 'kitchen', kind: 'kitchen', name: 'Kitchen', x: 46.5, y: 12.25, w: 10.0, d: 18.5 },
      { id: 'office', kind: 'office', name: 'Office', x: 25.25, y: 30.75, w: 10.25, d: 7.25 },
      { id: 'foyer', kind: 'foyer', name: 'Foyer', x: 35.5, y: 30.75, w: 9.0, d: 7.25 },
      { id: 'pantry', kind: 'pantry', name: 'Pantry', x: 44.5, y: 30.75, w: 12.0, d: 7.25 },
      { id: 'frontPorch', kind: 'frontPorch', name: 'Front Porch', x: 25.25, y: 38.0, w: 31.25, d: 5.0 },
      { id: 'laundry', kind: 'laundry', name: 'Laundry', x: 64.25, y: 0.5, w: 7.75, d: 14.75 },
      { id: 'mud', kind: 'mud', name: 'Mud Room', x: 57.0, y: 9.75, w: 7.5, d: 5.5 },
      { id: 'halfbath', kind: 'halfbath', name: 'Half Bath', x: 60.0, y: 15.25, w: 4.25, d: 8.0 },
      { id: 'mwic', kind: 'mwic', name: 'Primary Closet', x: 64.25, y: 15.25, w: 7.75, d: 8.5 },
      { id: 'mbath', kind: 'mbath', name: 'Primary Bath', x: 60.0, y: 23.75, w: 12.0, d: 7.75 },
      { id: 'mhall', kind: 'hall', name: 'Hall', x: 57.0, y: 15.25, w: 3.25, d: 16.25 },
      { id: 'master', kind: 'master', name: 'Primary Bedroom', x: 57.0, y: 31.5, w: 15.0, d: 16.25 },
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

export default KIT
