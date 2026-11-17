// 3D scene for the Draft step: the lot plus the house as walls, floor slabs,
// doors with swings, windows, and fixtures, all from the kit plan.
import { useMemo } from 'react'
import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Edges, Line } from '@react-three/drei'
import SitePlan from '../components/SitePlan.jsx'
import { FlatLabel } from '../components/labels.jsx'
import { DEFAULT_LOT } from './lib/lot.js'
import { wallsFrom } from './lib/ifc.js'
import { splitWalls } from './lib/openings.js'
import { kitFor, isRoom } from './lib/layout.js'
import { WINDOW_SILL, WINDOW_HEAD, DOOR_HEAD } from '../kits/modern-farmhouse.js'

/** Camera presets centred on a lot, scaled to its size. */
export function camerasFor(lot = DEFAULT_LOT) {
  const [CX, CZ] = lot.centroid || lot.centre
  const xs = (lot.boundary || []).map((p) => p[0])
  const zs = (lot.boundary || []).map((p) => p[1])
  const extent = xs.length ? Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) : 200
  const span = Math.max(140, extent * 1.35)
  const cos = Math.cos(lot.angle || 0)
  const sin = Math.sin(lot.angle || 0)
  // the 3D view looks from the street side (local +z) toward the rear
  const back = (lx, lz) => [CX + lx * cos - lz * sin, CZ + lx * sin + lz * cos]
  const [px, pz] = back(-span * 0.55, span * 0.75)
  return {
    top: { position: [CX, span * 1.25, CZ + 2], target: [CX, 0, CZ] },
    '3d': { position: [px, span * 0.55, pz], target: [CX, 0, CZ] },
  }
}
export const CAMERAS = camerasFor(DEFAULT_LOT)
const INK = '#2a2520'
const FIX_COLOR = { bed: '#cfc4b6', sofa: '#c9bfb2', coffee: '#b9ad9c', table: '#b9ad9c', desk: '#b9ad9c', tv: '#8f8478', counter: '#e2ddd3', island: '#e2ddd3', sink: '#f7f7f7', range: '#8f8478', fridge: '#d6d3cd', washer: '#d6d3cd', dryer: '#d6d3cd', wh: '#b9b4ab', toilet: '#f7f7f7', shower: '#d9e6ea', vanity: '#e2ddd3', linen: '#d9d2c6', shelves: '#d9d2c6', bench: '#b9ad9c' }

/** local plan feet → world. */
function toWorld(lx, lz, centre, lot) {
  const cos = Math.cos(lot.angle)
  const sin = Math.sin(lot.angle)
  return [centre[0] + lx * cos - lz * sin, centre[1] + lx * sin + lz * cos]
}

function Box({ cx, cz, w, d, y0 = 0, h, rot = 0, color, opacity = 1, edges = true }) {
  return (
    <group position={[cx, 0, cz]} rotation-y={-rot}>
      <mesh position={[0, y0 + h / 2, 0]}>
        <boxGeometry args={[w, h, d]} />
        <meshLambertMaterial color={color} transparent={opacity < 1} opacity={opacity} />
        {edges && <Edges color={INK} threshold={15} />}
      </mesh>
    </group>
  )
}

function Walls({ rooms, kit, centre, lot }) {
  const pieces = useMemo(() => splitWalls(wallsFrom(rooms, kit), rooms.filter((r) => r.element)), [rooms, kit])
  return pieces.map((w, i) => {
    const t = w.thicknessIn / 12
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1])
    const mid = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2]
    const [x, z] = toWorld(mid[0], mid[1], centre, lot)
    const ang = Math.atan2(w.b[1] - w.a[1], w.b[0] - w.a[0])
    return <Box key={i} cx={x} cz={z} w={len} d={t} y0={w.y0} h={w.h} rot={lot.angle + ang} color={w.exterior ? '#efe9df' : '#f4f1ec'} />
  })
}

function Door({ e, centre, lot }) {
  const [x, z] = toWorld(e.local[0], e.local[1], centre, lot)
  const rot = lot.angle + (e.axis === 'h' ? 0 : Math.PI / 2)
  if (e.cased) return <Box cx={x} cz={z} w={e.span} d={0.7} y0={DOOR_HEAD} h={0.4} rot={rot} color="#f4f1ec" />
  const leaves = e.pair ? 2 : 1
  const leafW = e.span / leaves
  const dir = e.swing || 1
  const parts = []
  for (let i = 0; i < leaves; i++) {
    const hingeAtStart = e.pair ? i === 0 : e.hinge !== 'end'
    const h0 = hingeAtStart ? -e.span / 2 + i * leafW : e.span / 2
    const sign = hingeAtStart ? 1 : -1
    const pts = []
    for (let k = 0; k <= 12; k++) {
      const a = (Math.PI / 2) * (k / 12)
      pts.push([h0 + sign * leafW * Math.cos(a), 0.3, dir * leafW * Math.sin(a)])
    }
    pts.push([h0, 0.3, 0])
    parts.push(
      <group key={i}>
        <Line points={pts} color="#8a6d3b" lineWidth={1} />
        <mesh position={[h0, DOOR_HEAD / 2, (dir * leafW) / 2]}>
          <boxGeometry args={[0.15, DOOR_HEAD, leafW]} />
          <meshLambertMaterial color="#a8927c" />
          <Edges color={INK} threshold={15} />
        </mesh>
      </group>
    )
  }
  return (
    <group position={[x, 0, z]} rotation-y={-rot}>
      <mesh position={[0, DOOR_HEAD + 1.2, 0]}>
        <boxGeometry args={[e.span, 2.4, 0.4]} />
        <meshLambertMaterial color="#f4f1ec" />
      </mesh>
      {parts}
    </group>
  )
}

function Window({ e, centre, lot }) {
  if (e.dormer) return null
  const [x, z] = toWorld(e.local[0], e.local[1], centre, lot)
  const rot = lot.angle + (e.axis === 'h' ? 0 : Math.PI / 2)
  const sill = e.sill ?? WINDOW_SILL[e.mark] ?? 2
  const head = e.head ?? WINDOW_HEAD[e.mark] ?? 7
  return (
    <group position={[x, 0, z]} rotation-y={-rot}>
      <mesh position={[0, (sill + head) / 2, 0]}>
        <boxGeometry args={[e.span, head - sill, 0.5]} />
        <meshLambertMaterial color="#9ec3cc" transparent opacity={0.55} />
        <Edges color={INK} threshold={15} />
      </mesh>
      <mesh position={[0, sill / 2, 0]}>
        <boxGeometry args={[e.span, sill, 0.42]} />
        <meshLambertMaterial color="#efe9df" />
      </mesh>
    </group>
  )
}

function Fixture({ e, centre, lot }) {
  const [x, z] = toWorld(e.local[0], e.local[1], centre, lot)
  return <Box cx={x} cz={z} w={e.w} d={e.d} h={e.h} rot={lot.angle} color={FIX_COLOR[e.fixture] || '#cfc4b6'} />
}

function Roof({ roof, centre, lot }) {
  const { shingles, metal, siding, edges } = useMemo(() => {
    const cos = Math.cos(lot.angle)
    const sin = Math.sin(lot.angle)
    const W = ([x, y, z]) => [centre[0] + x * cos - z * sin, y, centre[1] + x * sin + z * cos]
    const buckets = { shingles: [], metal: [], siding: [] }
    const lines = []
    roof.faces.forEach((f) => {
      const bucket = f.kind === 'end' ? 'siding' : f.kind === 'fascia' ? 'siding' : /metal/.test(f.material) ? 'metal' : 'shingles'
      // triangulate in the face's own 2D frame: plan (x, z) for slopes, (along, y) for vertical faces
      const is2d = f.kind === 'slope' ? (p) => new THREE.Vector2(p[0], p[2]) : Math.abs(f.rings[0][0][0] - f.rings[0][1][0]) < 0.01 && Math.abs(f.rings[0][0][0] - f.rings[0][2][0]) < 0.01 ? (p) => new THREE.Vector2(p[2], p[1]) : (p) => new THREE.Vector2(p[0], p[1])
      const contour = f.rings[0].map(is2d)
      const holes = f.rings.slice(1).map((r) => r.map(is2d))
      const all3d = f.rings.flat()
      let tris
      try {
        tris = THREE.ShapeUtils.triangulateShape(contour, holes)
      } catch (e) {
        tris = []
      }
      tris.forEach((t) => t.forEach((i) => buckets[bucket].push(...W(all3d[i]))))
      if (f.kind !== 'fascia') for (let i = 0; i < f.rings[0].length; i++) lines.push(...W(f.rings[0][i]), ...W(f.rings[0][(i + 1) % f.rings[0].length]))
    })
    const geo = (arr) => {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3))
      g.computeVertexNormals()
      return g
    }
    const e = new THREE.BufferGeometry()
    e.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3))
    return { shingles: geo(buckets.shingles), metal: geo(buckets.metal), siding: geo(buckets.siding), edges: e }
  }, [roof, centre])
  return (
    <group>
      <mesh geometry={shingles}>
        <meshLambertMaterial color="#6f655c" side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={metal}>
        <meshLambertMaterial color="#8e8a84" side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={siding}>
        <meshLambertMaterial color="#efe9df" side={THREE.DoubleSide} />
      </mesh>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color={INK} />
      </lineSegments>
    </group>
  )
}

function Room({ r, highlight, labels, lot }) {
  const [x, z] = r.center
  const nameSize = Math.min(2.6, Math.max(1.5, (r.w - 1) / (r.name.length * 0.62)))
  return (
    <group position={[x, 0, z]} rotation-y={-lot.angle}>
      <mesh position={[0, -0.17, 0]}>
        <boxGeometry args={[r.w, 0.34, r.d]} />
        <meshLambertMaterial color={highlight ? '#e9dccf' : r.open ? '#e6e1d8' : '#efeae2'} />
        <Edges color={highlight ? '#4e3c30' : '#b9b4ab'} threshold={15} />
      </mesh>
      {labels && (
        <>
          <FlatLabel x={0} z={-1.4} y={0.02} angle={lot.angle} size={nameSize} bold color={highlight ? '#4e3c30' : '#2a2520'}>
            {r.name.toUpperCase()}
          </FlatLabel>
          {r.w >= 8 && (
            <FlatLabel x={0} z={1.8} y={0.02} angle={lot.angle} size={1.8} color="#7a6558">
              {r.w}' × {r.d}'
            </FlatLabel>
          )}
        </>
      )}
    </group>
  )
}

export default function HouseScene({ rooms = [], style, view = '3d', highlightKind, controlsRef, showHouse = true, showRoof = true, lot = DEFAULT_LOT }) {
  const L = lot && lot.envelope ? lot : DEFAULT_LOT
  const cams = useMemo(() => camerasFor(L), [L])
  const cam = cams[view] || cams['3d']
  const kit = kitFor(style)
  const centre = useMemo(() => {
    const r = rooms.find((x) => x.local && x.center && !x.element)
    if (!r) return L.centre
    // world centre = room centre minus its local offset, rotated
    const cos = Math.cos(L.angle)
    const sin = Math.sin(L.angle)
    return [r.center[0] - (r.local[0] * cos - r.local[1] * sin), r.center[1] - (r.local[0] * sin + r.local[1] * cos)]
  }, [rooms, L])
  const roomList = rooms.filter(isRoom)
  const hasPlan = rooms.some((r) => r.element)
  return (
    <Canvas camera={{ position: cam.position, fov: 42, near: 1, far: 6000 }} gl={{ antialias: true, preserveDrawingBuffer: true }}>
      <color attach="background" args={['#ebe9e5']} />
      <ambientLight intensity={2.0} />
      <directionalLight position={[-150, 300, -200]} intensity={1.4} />
      <SitePlan lot={L} />
      {showHouse && roomList.map((r) => <Room key={r.id} r={r} highlight={r.kind === highlightKind} labels lot={L} />)}
      {showHouse && roomList.length > 0 && <Walls rooms={rooms} kit={kit} centre={centre} lot={L} />}
      {showHouse && hasPlan && rooms.filter((e) => e.kind === 'door').map((e) => <Door key={e.id} e={e} centre={centre} lot={L} />)}
      {showHouse && hasPlan && rooms.filter((e) => e.kind === 'window').map((e) => <Window key={e.id} e={e} centre={centre} lot={L} />)}
      {showHouse && hasPlan && rooms.filter((e) => e.kind === 'fixture').map((e) => <Fixture key={e.id} e={e} centre={centre} lot={L} />)}
      {showHouse && showRoof && view !== 'top' && rooms.filter((e) => e.kind === 'roof').map((e) => <Roof key={e.id} roof={e} centre={centre} lot={L} />)}
      <OrbitControls key={L.centre.join(',')} ref={controlsRef} makeDefault target={cam.target} maxPolarAngle={Math.PI / 2 - 0.04} minDistance={20} maxDistance={1200} />
    </Canvas>
  )
}
