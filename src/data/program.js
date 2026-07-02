// PROGRAM — footprints are ESTIMATES from an undimensioned architect plan.
// Positions follow the plan's rough layout (service block along north, supplier
// bay east of it, pool mid-lot west, kiosk center, dance floor + lounge east).
// Everything here is editable; Phase 3 makes these draggable.
// Heights are ASSUMED for visualization only (not from any document),
// except the muro verde, specified ~9' tall.

// Structures are rotated to sit parallel to the north lot line
export const LOT_ANGLE = Math.atan2(19.22, 220.76)

export const PROGRAM = [
  {
    id: 'service',
    name: 'SERVICE BLOCK',
    sub: 'BODEGA / COCINA / BAR',
    kind: 'building',
    w: 55,
    d: 16,
    h: 12,
    center: [80, 24],
  },
  {
    id: 'supplier',
    name: 'SUPPLIER',
    sub: 'BAY',
    kind: 'building',
    w: 13,
    d: 14,
    h: 10,
    center: [120, 28],
  },
  {
    id: 'wc-a',
    name: 'RESTROOM A',
    kind: 'building',
    w: 18,
    d: 13,
    h: 10,
    center: [98, 42],
  },
  {
    id: 'wc-b',
    name: 'RESTROOM B',
    kind: 'building',
    w: 18,
    d: 13,
    h: 10,
    center: [98, 60],
  },
  {
    id: 'kiosk',
    name: 'KIOSK',
    sub: 'DISTRIBUTION',
    kind: 'building',
    w: 18,
    d: 16,
    h: 10,
    center: [122, 62],
  },
  {
    id: 'pool',
    name: 'POOL',
    sub: "40'×28' WATER",
    kind: 'pool',
    w: 40,
    d: 28,
    deck: 8, // deck width around water — ASSUMED 8', not from plan
    center: [60, 50],
  },
  {
    id: 'dance',
    name: 'DANCE FLOOR',
    kind: 'slab',
    w: 30,
    d: 55,
    h: 0.6,
    center: [170, 66],
  },
  {
    id: 'lounge',
    name: 'LOUNGE',
    kind: 'slab',
    w: 14,
    d: 18,
    h: 0.6,
    center: [146, 80],
  },
  {
    id: 'kids',
    name: 'KIDS PLAY',
    kind: 'area',
    w: 30,
    d: 20,
    center: [100, 80],
  },
]

// Muro verde (green wall) — follows the Don St curve, ~9' tall (specified).
// Offset inside the property line; thickness assumed 1.5'.
export const MURO_VERDE = { inset: 2.5, thickness: 1.5, height: 9 }

// Covered area = roofed structures only (slabs/pool/areas excluded)
export const COVERED_AREA_SF = PROGRAM.filter((e) => e.kind === 'building').reduce(
  (s, e) => s + e.w * e.d,
  0
)
