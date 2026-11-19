import { useMemo } from 'react'
import * as THREE from 'three'
import { Line, Grid } from '@react-three/drei'
import { STREET_WIDTH_ILLUSTRATIVE } from '../data/survey.js'
import { DEFAULT_LOT } from '../draft/lib/lot.js'
import { offsetPolyline, stripPositions, polylinePoint } from '../lib/geometry.js'
import { FlatLabel } from './labels.jsx'

export const COLORS = {
  bg: '#dfe2e6',
  lotFill: '#f8f7f2',
  lotBad: '#f6d5d2', // a lot the setbacks leave no room on (round 10, item 1)
  street: '#c7ccd2',
  streetEdge: '#9aa1a9',
  ink: '#1c1e21',
  property: '#c62828',
  setback: '#2e7d32',
}

// draw-order elevations (ft) to avoid z-fighting
const Y = { street: 0.02, lot: 0.06, setback: 0.24, property: 0.3, marker: 0.32 }

function LotFill({ lot, bad = false }) {
  const geom = useMemo(() => {
    const B = lot.boundary
    const shape = new THREE.Shape()
    shape.moveTo(B[0][0], B[0][1])
    for (let i = 1; i < B.length; i++) shape.lineTo(B[i][0], B[i][1])
    shape.closePath()
    const g = new THREE.ShapeGeometry(shape)
    g.rotateX(Math.PI / 2) // shape (x, y) -> world (x, 0, y=z-south)
    return g
  }, [lot])
  return (
    <mesh geometry={geom} position={[0, Y.lot, 0]}>
      <meshBasicMaterial color={bad ? COLORS.lotBad : COLORS.lotFill} side={THREE.DoubleSide} />
    </mesh>
  )
}

function PropertyLine({ lot }) {
  const pts = useMemo(() => [...lot.boundary, lot.boundary[0]].map(([x, z]) => [x, Y.property, z]), [lot])
  return (
    <>
      <Line points={pts} color={COLORS.property} lineWidth={2.5} />
      {lot.corners.map(([x, z], i) => (
        <mesh key={i} position={[x, Y.marker, z]} rotation-x={-Math.PI / 2}>
          <circleGeometry args={[1.3, 20]} />
          <meshBasicMaterial color={COLORS.property} />
        </mesh>
      ))}
    </>
  )
}

// the label of the lot edge nearest a point (arcs make more envelope edges than lot edges)
function nearestLabel(lot, p) {
  let best = ''
  let bd = Infinity
  lot.corners.forEach((a, i) => {
    const b = lot.corners[(i + 1) % lot.corners.length]
    const len2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 || 1
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / len2))
    const d = Math.hypot(p[0] - (a[0] + (b[0] - a[0]) * t), p[1] - (a[1] + (b[1] - a[1]) * t))
    if (d < bd) {
      bd = d
      best = lot.edges?.[i]?.label || lot.envelopeLabels?.[i] || ''
    }
  })
  return best
}

function SetbackEnvelope({ lot, textScale = 1 }) {
  const E = lot.envelope || []
  // an empty envelope (the setbacks meet in the middle of a sliver lot) draws nothing here; the lot itself still shows
  const pts = useMemo(() => (E.length < 3 ? [] : [...E, E[0]].map(([x, z]) => [x, Y.setback, z])), [lot])
  if (E.length < 3) return null
  const C = lot.centroid
  return (
    <>
      <Line points={pts} color={COLORS.setback} lineWidth={1.5} dashed dashSize={4} gapSize={3} />
      {E.map(([ax, az], i) => {
        const [bx, bz] = E[(i + 1) % E.length]
        if (Math.hypot(bx - ax, bz - az) < 18) return null
        const angle = Math.atan2(bz - az, bx - ax)
        // nudge the label outward so it sits between the dashed line and the
        // property line, clear of the buildable area
        const nx = -(bz - az)
        const nz = bx - ax
        const l = Math.hypot(nx, nz)
        const toC = (C[0] - (ax + bx) / 2) * nx + (C[1] - (az + bz) / 2) * nz
        const s = (toC > 0 ? -1 : 1) * Math.max(2, 4 * textScale)
        return (
          <FlatLabel
            key={i}
            x={(ax + bx) / 2 + (nx / l) * s}
            z={(az + bz) / 2 + (nz / l) * s}
            angle={angle}
            size={4 * textScale}
            color={COLORS.setback}
          >
            {nearestLabel(lot, [(ax + bx) / 2, (az + bz) / 2])}
          </FlatLabel>
        )
      })}
    </>
  )
}

function Street({ street, lot, textScale = 1 }) {
  const { geom, edgeInner, edgeOuter, label } = useMemo(() => {
    const inner = street.pts
    const outer = offsetPolyline(inner, STREET_WIDTH_ILLUSTRATIVE, lot.centroid)
    const { positions, indices } = stripPositions(inner, outer, 0)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    g.setIndex(new THREE.BufferAttribute(indices, 1))
    const mid = offsetPolyline(inner, STREET_WIDTH_ILLUSTRATIVE / 2, lot.centroid)
    return {
      geom: g,
      edgeInner: inner.map(([x, z]) => [x, Y.street + 0.02, z]),
      edgeOuter: outer.map(([x, z]) => [x, Y.street + 0.02, z]),
      label: polylinePoint(mid, 0.5),
    }
  }, [street, lot])
  return (
    <group position={[0, Y.street, 0]}>
      <mesh geometry={geom}>
        <meshBasicMaterial color={COLORS.street} side={THREE.DoubleSide} />
      </mesh>
      <Line points={edgeInner} color={COLORS.streetEdge} lineWidth={1} />
      <Line points={edgeOuter} color={COLORS.streetEdge} lineWidth={1} />
      <FlatLabel
        x={label.point[0]}
        z={label.point[1]}
        angle={label.angle}
        size={8 * textScale}
        color="#4c525a"
        letterSpacing={0.25}
        bold
      >
        {street.name}
      </FlatLabel>
    </group>
  )
}

function NorthArrow({ x = -50, z = -28 }) {
  return (
    <group position={[x, Y.marker, z]}>
      <Line
        points={[
          [0, 0, 14],
          [0, 0, -2],
        ]}
        color={COLORS.ink}
        lineWidth={1.5}
      />
      {/* arrowhead pointing north (-z) */}
      <mesh position={[0, 0, -4]} rotation-x={-Math.PI / 2}>
        <coneGeometry args={[3.2, 9, 12]} />
        <meshBasicMaterial color={COLORS.ink} />
      </mesh>
      <FlatLabel x={0} z={-13} size={8} bold>
        N
      </FlatLabel>
    </group>
  )
}

function ScaleBar({ x0 = 20, z0 = 175 }) {
  const seg = 25
  const h = 3.5
  return (
    <group>
      {[0, 1, 2, 3].map((i) => (
        <mesh key={i} position={[x0 + seg * i + seg / 2, Y.marker, z0]} rotation-x={-Math.PI / 2}>
          <planeGeometry args={[seg, h]} />
          <meshBasicMaterial color={i % 2 === 0 ? COLORS.ink : '#ffffff'} />
        </mesh>
      ))}
      <Line
        points={[
          [x0, Y.marker + 0.02, z0 - h / 2],
          [x0 + 100, Y.marker + 0.02, z0 - h / 2],
          [x0 + 100, Y.marker + 0.02, z0 + h / 2],
          [x0, Y.marker + 0.02, z0 + h / 2],
          [x0, Y.marker + 0.02, z0 - h / 2],
        ]}
        color={COLORS.ink}
        lineWidth={1}
      />
      {[0, 25, 50, 75, 100].map((d) => (
        <FlatLabel key={d} x={x0 + d} z={z0 - 6.5} size={4} color="#5a6069">
          {d === 100 ? "100'" : String(d)}
        </FlatLabel>
      ))}
      <FlatLabel x={x0 + 50} z={z0 + 8} size={4} color="#5a6069" letterSpacing={0.2}>
        SCALE IN FEET
      </FlatLabel>
    </group>
  )
}

/**
 * `textScale` (round 12, item I) sizes the words drawn on the ground: 1 where the picture is the lot itself (the Lot
 * step's top view), smaller beside a house in the 3D view, where full-size lettering was as tall as a door.
 */
export default function SitePlan({ lot = DEFAULT_LOT, problem = '', northArrow = true, textScale = 1 }) {
  const ts = textScale
  const [cx, cz] = lot.centroid
  const xs = lot.boundary.map((p) => p[0])
  const zs = lot.boundary.map((p) => p[1])
  const minX = Math.min(...xs)
  const maxZ = Math.max(...zs)
  const minZ = Math.min(...zs)
  const isRef = lot.kind === 'reference'
  // the lot's own line of text sits on the side away from the front street, so it never runs across the street's name
  // (round 10: a parcel can front north, east or west; the label used to sit north of the lot whatever the street did)
  const frontEdge = (lot.edges || []).find((e) => e.kind === 'front')
  let streetNorth = false
  if (frontEdge && lot.corners?.length > frontEdge.index) {
    const a = lot.corners[frontEdge.index]
    const b = lot.corners[(frontEdge.index + 1) % lot.corners.length]
    streetNorth = (a[1] + b[1]) / 2 < cz - 1
  }
  const anyStreetNorth = streetNorth || (lot.streets || []).some((st) => st.pts?.some((p) => p[1] < minZ - 4))
  // smaller text sits closer to the lot line it belongs to
  const near = Math.max(ts, 0.6)
  const labelZ = anyStreetNorth ? maxZ + 9 * near : minZ - 8 * near
  return (
    <group>
      <Grid
        position={[cx, -0.05, cz]}
        args={[2000, 2000]}
        cellSize={10}
        cellColor="#ccd0d5"
        cellThickness={0.6}
        sectionSize={50}
        sectionColor="#b9bec5"
        sectionThickness={1}
        fadeDistance={1600}
        fadeStrength={1}
        followCamera={false}
      />
      {(lot.streets || []).map((s) => (
        <Street key={s.name + (s.edge ?? '')} street={s} lot={lot} textScale={ts} />
      ))}
      <LotFill lot={lot} bad={!!problem} />
      <PropertyLine lot={lot} />
      <SetbackEnvelope lot={lot} textScale={ts} />
      {problem && !isRef ? (
        <FlatLabel x={cx} z={anyStreetNorth ? maxZ + 22 : maxZ + 9} angle={0} size={3.6 * ts} color={COLORS.property} bold>
          {String(problem).toUpperCase().slice(0, 64)}
        </FlatLabel>
      ) : null}

      {isRef ? (
        <>
          <FlatLabel x={150} z={27} angle={lot.angle} size={7 * ts} bold>
            LOT 514
          </FlatLabel>
          <FlatLabel x={151} z={27 + 6 * Math.max(ts, 0.6)} angle={lot.angle} size={3.2 * ts} color="#5a6069">
            ±{Math.round(lot.areaSf).toLocaleString()} SF · {(lot.areaSf / 43560).toFixed(2)} AC
          </FlatLabel>
          <FlatLabel x={110} z={-14} angle={lot.angle} size={5 * ts} color="#7a808a">
            LOT 513 — NEIGHBOR (6' SIDE SETBACK)
          </FlatLabel>
        </>
      ) : (
        <>
          {/* two short lines, so the text stays inside the picture on a narrow lot (round 10) */}
          <FlatLabel x={cx} z={labelZ} angle={0} size={3.6 * ts} color="#5a6069">
            {lot.address ? lot.address.split(',')[0].toUpperCase().slice(0, 40) + ' · ' : ''}±{Math.round(lot.areaSf).toLocaleString()} SF · {(lot.areaSf / 43560).toFixed(2)} AC
          </FlatLabel>
          {lot.confirmed === false && (
            <FlatLabel x={cx} z={labelZ + (anyStreetNorth ? 6 : -6) * Math.max(ts, 0.6)} angle={0} size={3 * ts} color="#5a6069">
              LOT PENDING DRAFTER CONFIRMATION
            </FlatLabel>
          )}
        </>
      )}

      {/* the top view is always north-up, so its north arrow is a fixed mark in the corner of the picture (HouseScene);
          drawn here it fell outside a phone's frame (round 11, item 7). The 3D view turns, so it keeps this one. */}
      {northArrow && <NorthArrow x={minX - 40} z={minZ - 10} />}
      <ScaleBar x0={minX + 20} z0={maxZ + 58} />
    </group>
  )
}
