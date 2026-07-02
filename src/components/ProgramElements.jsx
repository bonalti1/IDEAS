import { useMemo } from 'react'
import * as THREE from 'three'
import { Edges, Line } from '@react-three/drei'
import { PROGRAM, MURO_VERDE, LOT_ANGLE } from '../data/program.js'
import { ARC } from '../data/survey.js'
import { FlatLabel } from './labels.jsx'

const INK = '#1c1e21'

function dims(e) {
  return `±${e.w}'×${e.d}' EST`
}

/** name + dims, flat on top of an element; text sized to fit the footprint */
function ElementLabel({ e, y }) {
  const [x, z] = e.center
  const nameSize = Math.min(3.4, Math.max(2.0, (e.w - 1) / (e.name.length * 0.62)))
  return (
    <group>
      <FlatLabel x={x} z={z - 2.2} y={y} angle={LOT_ANGLE} size={nameSize} bold>
        {e.name}
      </FlatLabel>
      {e.sub && (
        <FlatLabel x={x} z={z + 1.8} y={y} angle={LOT_ANGLE} size={2.4} color="#5a6069">
          {e.sub}
        </FlatLabel>
      )}
      <FlatLabel x={x} z={z + (e.sub ? 5.4 : 2.6)} y={y} angle={LOT_ANGLE} size={2.4} color="#8a6d3b">
        {dims(e)}
      </FlatLabel>
    </group>
  )
}

function Building({ e }) {
  const [x, z] = e.center
  return (
    <group position={[x, 0, z]} rotation-y={-LOT_ANGLE}>
      <mesh position={[0, e.h / 2, 0]}>
        <boxGeometry args={[e.w, e.h, e.d]} />
        <meshLambertMaterial color="#ece7dc" />
        <Edges color={INK} threshold={15} />
      </mesh>
      <ElementLabel e={{ ...e, center: [0, 0] }} y={e.h + 0.15} />
    </group>
  )
}

function Slab({ e }) {
  const [x, z] = e.center
  return (
    <group position={[x, 0, z]} rotation-y={-LOT_ANGLE}>
      <mesh position={[0, e.h / 2, 0]}>
        <boxGeometry args={[e.w, e.h, e.d]} />
        <meshLambertMaterial color="#d8d3c8" />
        <Edges color={INK} threshold={15} />
      </mesh>
      <ElementLabel e={{ ...e, center: [0, 0] }} y={e.h + 0.15} />
    </group>
  )
}

function Pool({ e }) {
  const [x, z] = e.center
  const dw = e.w + 2 * e.deck
  const dd = e.d + 2 * e.deck
  const deckH = 0.7
  const waterOutline = useMemo(() => {
    const hw = e.w / 2
    const hd = e.d / 2
    return [
      [-hw, deckH + 0.06, -hd],
      [hw, deckH + 0.06, -hd],
      [hw, deckH + 0.06, hd],
      [-hw, deckH + 0.06, hd],
      [-hw, deckH + 0.06, -hd],
    ]
  }, [e.w, e.d])
  return (
    <group position={[x, 0, z]} rotation-y={-LOT_ANGLE}>
      <mesh position={[0, deckH / 2, 0]}>
        <boxGeometry args={[dw, deckH, dd]} />
        <meshLambertMaterial color="#e3dfd4" />
        <Edges color={INK} threshold={15} />
      </mesh>
      <mesh position={[0, deckH + 0.02, 0]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[e.w, e.d]} />
        <meshBasicMaterial color="#8fd8e2" />
      </mesh>
      <Line points={waterOutline} color="#2b7a8c" lineWidth={1.5} />
      <FlatLabel x={0} z={-3} y={deckH + 0.1} angle={LOT_ANGLE} size={3.4} color="#19606e" bold>
        POOL
      </FlatLabel>
      <FlatLabel x={0} z={1.5} y={deckH + 0.1} angle={LOT_ANGLE} size={2.4} color="#19606e">
        ±40'×28' WATER EST
      </FlatLabel>
      <FlatLabel
        x={0}
        z={e.d / 2 + e.deck / 2}
        y={deckH + 0.1}
        angle={LOT_ANGLE}
        size={2.2}
        color="#5a6069"
      >
        DECK — WIDTH ASSUMED {e.deck}'
      </FlatLabel>
    </group>
  )
}

function KidsArea({ e }) {
  const [x, z] = e.center
  const hw = e.w / 2
  const hd = e.d / 2
  const outline = [
    [-hw, 0.14, -hd],
    [hw, 0.14, -hd],
    [hw, 0.14, hd],
    [-hw, 0.14, hd],
    [-hw, 0.14, -hd],
  ]
  return (
    <group position={[x, 0, z]} rotation-y={-LOT_ANGLE}>
      <mesh position={[0, 0.12, 0]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[e.w, e.d]} />
        <meshBasicMaterial color="#d9e7d2" />
      </mesh>
      <Line points={outline} color="#4a7c43" lineWidth={1.2} dashed dashSize={2.5} gapSize={2} />
      <ElementLabel e={{ ...e, center: [0, 0] }} y={0.2} />
    </group>
  )
}

/** Green wall following the Don St curve, offset inside the property line */
function MuroVerde() {
  const { geom, label } = useMemo(() => {
    // arc points sit at radius R from ARC.center; pull the wall radially inward
    const [ccx, ccz] = ARC.center
    const radial = (p, dist) => {
      const dx = p[0] - ccx
      const dz = p[1] - ccz
      const l = Math.hypot(dx, dz)
      const r = (l - dist) / l
      return [ccx + dx * r, ccz + dz * r]
    }
    const outer = ARC.points.map((p) => radial(p, MURO_VERDE.inset))
    const inner = ARC.points.map((p) => radial(p, MURO_VERDE.inset + MURO_VERDE.thickness))
    const shape = new THREE.Shape()
    const ring = [...outer, ...inner.reverse()]
    shape.moveTo(ring[0][0], -ring[0][1])
    for (let i = 1; i < ring.length; i++) shape.lineTo(ring[i][0], -ring[i][1])
    shape.closePath()
    const g = new THREE.ExtrudeGeometry(shape, { depth: MURO_VERDE.height, bevelEnabled: false })
    g.rotateX(-Math.PI / 2) // shape (x, -z, h) -> world (x, h, z)
    const mid = ARC.points[Math.floor(ARC.points.length / 2)]
    const prev = ARC.points[Math.floor(ARC.points.length / 2) - 2]
    const next = ARC.points[Math.floor(ARC.points.length / 2) + 2]
    const angle = Math.atan2(next[1] - prev[1], next[0] - prev[0])
    // label offset toward lot interior
    const dxm = ARC.center[0] - mid[0]
    const dzm = ARC.center[1] - mid[1]
    const lm = Math.hypot(dxm, dzm)
    return {
      geom: g,
      label: { x: mid[0] + (dxm / lm) * 18, z: mid[1] + (dzm / lm) * 18, angle },
    }
  }, [])
  return (
    <group>
      <mesh geometry={geom}>
        <meshLambertMaterial color="#7fae7a" />
        <Edges color="#3e5c3a" threshold={20} />
      </mesh>
      <FlatLabel x={label.x} z={label.z} angle={label.angle} size={2.8} color="#3e5c3a" bold>
        MURO VERDE — 9' TALL
      </FlatLabel>
    </group>
  )
}

export default function ProgramElements() {
  return (
    <group>
      {PROGRAM.map((e) => {
        if (e.kind === 'building') return <Building key={e.id} e={e} />
        if (e.kind === 'slab') return <Slab key={e.id} e={e} />
        if (e.kind === 'pool') return <Pool key={e.id} e={e} />
        if (e.kind === 'area') return <KidsArea key={e.id} e={e} />
        return null
      })}
      <MuroVerde />
    </group>
  )
}
