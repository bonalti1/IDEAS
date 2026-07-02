// SURVEYED DATA — from the recorded plat of Lot 514, Villa-Rama East Phase V,
// Palmview TX. Treat as exact. Units: feet. x = east, z = south.
import {
  tessellateArc,
  polygonArea,
  polygonCentroid,
  extendPolyline,
} from '../lib/geometry.js'

// Lot boundary corners, clockwise as recorded. Corners [1] -> [2] are the
// PC/PT of the Don St curve and are connected by an arc, not a line.
export const LOT_CORNERS = [
  [0, 0],
  [220.76, 19.22], // PC of curve
  [225.45, 71.37], // PT of curve
  [220.17, 105.25],
  [203.05, 117.77],
  [11.45, 87.92],
  [-9.5, 59.26],
]

// Recorded curve data for the Don St corner
export const ARC_RECORDED = {
  R: 50,
  deltaDeg: 62 + 58 / 60 + 14 / 3600, // 62°58'14"
  arcLength: 55.11,
  chord: 52.23,
}

// Solve the R=50 arc through the recorded PC/PT, bulging away from the lot
export const ARC = tessellateArc(LOT_CORNERS[1], LOT_CORNERS[2], ARC_RECORDED.R, [110, 60], 40)

// Full boundary with the arc tessellated in (closed implicitly)
export const BOUNDARY = [
  LOT_CORNERS[0],
  LOT_CORNERS[1],
  ...ARC.points.slice(1, -1),
  LOT_CORNERS[2],
  LOT_CORNERS[3],
  LOT_CORNERS[4],
  LOT_CORNERS[5],
  LOT_CORNERS[6],
]

export const LOT_AREA_SF = Math.abs(polygonArea(BOUNDARY))
export const LOT_CENTROID = polygonCentroid(BOUNDARY)

// Setback envelope (buildable area), from plat setbacks:
// 6' side (north / Lot 513), 25' Don St, 10' Ida Blvd, 20' Showers Rd
export const SETBACK_CORNERS = [
  [19.0, 7.7],
  [207.5, 24.1],
  [194.7, 106.3],
  [7.9, 77.3],
]

export const SETBACK_EDGE_LABELS = [
  "6' SIDE — LOT 513",
  "25' — DON ST",
  "10' — IDA BLVD",
  "20' — SHOWERS RD",
]

// Street frontages, as polylines along the property line, offset outward to a
// visual band. WIDTHS ARE ILLUSTRATIVE (40') — not surveyed, plat ROW unknown.
export const STREET_WIDTH_ILLUSTRATIVE = 40

export const STREETS = [
  {
    name: 'SHOWERS RD',
    pts: extendPolyline(
      [LOT_CORNERS[5], LOT_CORNERS[6], LOT_CORNERS[0]],
      60,
      60
    ),
  },
  {
    name: 'IDA BLVD',
    pts: extendPolyline([LOT_CORNERS[4], LOT_CORNERS[5]], 40, 60),
  },
  {
    name: 'DON ST',
    pts: extendPolyline(
      [LOT_CORNERS[1], ...ARC.points.slice(1, -1), LOT_CORNERS[2], LOT_CORNERS[3]],
      70,
      55
    ),
  },
]
