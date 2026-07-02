import { useMemo } from 'react'
import * as THREE from 'three'
import { Line, Grid } from '@react-three/drei'
import {
  BOUNDARY,
  LOT_CORNERS,
  SETBACK_CORNERS,
  SETBACK_EDGE_LABELS,
  STREETS,
  STREET_WIDTH_ILLUSTRATIVE,
  LOT_AREA_SF,
  LOT_CENTROID,
} from '../data/survey.js'
import { offsetPolyline, stripPositions, polylinePoint } from '../lib/geometry.js'
import { FlatLabel } from './labels.jsx'

export const COLORS = {
  bg: '#dfe2e6',
  lotFill: '#f8f7f2',
  street: '#c7ccd2',
  streetEdge: '#9aa1a9',
  ink: '#1c1e21',
  property: '#c62828',
  setback: '#2e7d32',
}

// draw-order elevations (ft) to avoid z-fighting
const Y = { street: 0.02, lot: 0.06, setback: 0.24, property: 0.3, marker: 0.32 }

function LotFill() {
  const geom = useMemo(() => {
    const shape = new THREE.Shape()
    shape.moveTo(BOUNDARY[0][0], BOUNDARY[0][1])
    for (let i = 1; i < BOUNDARY.length; i++) shape.lineTo(BOUNDARY[i][0], BOUNDARY[i][1])
    shape.closePath()
    const g = new THREE.ShapeGeometry(shape)
    g.rotateX(Math.PI / 2) // shape (x, y) -> world (x, 0, y=z-south)
    return g
  }, [])
  return (
    <mesh geometry={geom} position={[0, Y.lot, 0]}>
      <meshBasicMaterial color={COLORS.lotFill} side={THREE.DoubleSide} />
    </mesh>
  )
}

function PropertyLine() {
  const pts = useMemo(
    () => [...BOUNDARY, BOUNDARY[0]].map(([x, z]) => [x, Y.property, z]),
    []
  )
  return (
    <>
      <Line points={pts} color={COLORS.property} lineWidth={2.5} />
      {LOT_CORNERS.map(([x, z], i) => (
        <mesh key={i} position={[x, Y.marker, z]} rotation-x={-Math.PI / 2}>
          <circleGeometry args={[1.3, 20]} />
          <meshBasicMaterial color={COLORS.property} />
        </mesh>
      ))}
    </>
  )
}

function SetbackEnvelope() {
  const pts = useMemo(
    () => [...SETBACK_CORNERS, SETBACK_CORNERS[0]].map(([x, z]) => [x, Y.setback, z]),
    []
  )
  return (
    <>
      <Line points={pts} color={COLORS.setback} lineWidth={1.5} dashed dashSize={4} gapSize={3} />
      {SETBACK_CORNERS.map(([ax, az], i) => {
        const [bx, bz] = SETBACK_CORNERS[(i + 1) % 4]
        const angle = Math.atan2(bz - az, bx - ax)
        // nudge the label toward lot interior so it sits inside the dashed line
        const nx = -(bz - az)
        const nz = bx - ax
        const l = Math.hypot(nx, nz)
        const toC = (LOT_CENTROID[0] - (ax + bx) / 2) * nx + (LOT_CENTROID[1] - (az + bz) / 2) * nz
        const s = (toC > 0 ? 1 : -1) * 6
        return (
          <FlatLabel
            key={i}
            x={(ax + bx) / 2 + (nx / l) * s}
            z={(az + bz) / 2 + (nz / l) * s}
            angle={angle}
            size={4}
            color={COLORS.setback}
          >
            {SETBACK_EDGE_LABELS[i]}
          </FlatLabel>
        )
      })}
    </>
  )
}

function Street({ street }) {
  const { geom, edgeInner, edgeOuter, label } = useMemo(() => {
    const inner = street.pts
    const outer = offsetPolyline(inner, STREET_WIDTH_ILLUSTRATIVE, LOT_CENTROID)
    const { positions, indices } = stripPositions(inner, outer, 0)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    g.setIndex(new THREE.BufferAttribute(indices, 1))
    const mid = offsetPolyline(inner, STREET_WIDTH_ILLUSTRATIVE / 2, LOT_CENTROID)
    return {
      geom: g,
      edgeInner: inner.map(([x, z]) => [x, Y.street + 0.02, z]),
      edgeOuter: outer.map(([x, z]) => [x, Y.street + 0.02, z]),
      label: polylinePoint(mid, 0.5),
    }
  }, [street])
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
        size={8}
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

export default function SitePlan() {
  return (
    <group>
      <Grid
        position={[100, -0.05, 60]}
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
      {STREETS.map((s) => (
        <Street key={s.name} street={s} />
      ))}
      <LotFill />
      <PropertyLine />
      <SetbackEnvelope />

      {/* Lot identity */}
      <FlatLabel x={LOT_CENTROID[0]} z={LOT_CENTROID[1] - 4} size={11} bold>
        LOT 514
      </FlatLabel>
      <FlatLabel x={LOT_CENTROID[0]} z={LOT_CENTROID[1] + 7} size={4.5} color="#5a6069">
        ±{Math.round(LOT_AREA_SF).toLocaleString()} SF · {(LOT_AREA_SF / 43560).toFixed(2)} AC
      </FlatLabel>

      {/* Neighbor */}
      <FlatLabel x={110} z={-14} angle={Math.atan2(19.22, 220.76)} size={5} color="#7a808a">
        LOT 513 — NEIGHBOR (6' SIDE SETBACK)
      </FlatLabel>

      <NorthArrow />
      <ScaleBar />
    </group>
  )
}
