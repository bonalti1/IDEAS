// 3D scene for the Draft step: the lot plus the house as walls, floor slabs,
// doors with swings, windows, and fixtures, all from the kit plan.
import { useMemo } from 'react'
import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Edges, Line, Html } from '@react-three/drei'
import SitePlan from '../components/SitePlan.jsx'
import { FlatLabel } from '../components/labels.jsx'
import { DEFAULT_LOT } from './lib/lot.js'
import { wallsFrom } from './lib/ifc.js'
import { splitWalls } from './lib/openings.js'
import { kitFor, isRoom } from './lib/layout.js'
import { WINDOW_SILL, WINDOW_HEAD, DOOR_HEAD } from '../kits/modern-farmhouse.js'

/**
 * Camera presets. With rooms, the plan view frames the house (readable labels) and the 3D view
 * looks at it from the street; without rooms, both frame the lot.
 */
export function camerasFor(lot = DEFAULT_LOT, rooms = []) {
  const solid = rooms.filter((r) => isRoom(r) && r.center)
  let CX, CZ, span
  if (solid.length) {
    const xs = solid.flatMap((r) => [r.center[0] - r.w / 2 - r.d / 2, r.center[0] + r.w / 2 + r.d / 2])
    const zs = solid.flatMap((r) => [r.center[1] - r.w / 2 - r.d / 2, r.center[1] + r.w / 2 + r.d / 2])
    CX = (Math.min(...xs) + Math.max(...xs)) / 2
    CZ = (Math.min(...zs) + Math.max(...zs)) / 2
    const ext = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs))
    span = Math.max(70, ext * 0.95)
  } else {
    ;[CX, CZ] = lot.centroid || lot.centre
    const xs = (lot.boundary || []).map((p) => p[0])
    const zs = (lot.boundary || []).map((p) => p[1])
    const extent = xs.length ? Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) : 200
    span = Math.max(140, extent * 1.35)
  }
  const cos = Math.cos(lot.angle || 0)
  const sin = Math.sin(lot.angle || 0)
  // the 3D view looks from the street side (local +z) toward the rear
  const back = (lx, lz) => [CX + lx * cos - lz * sin, CZ + lx * sin + lz * cos]
  const d3 = solid.length ? Math.max(120, span * 1.3) : span
  const [px, pz] = back(-d3 * 0.55, d3 * 0.75)
  return {
    top: { position: [CX, span * 1.25, CZ + 0.5], target: [CX, 0, CZ] },
    '3d': { position: [px, d3 * 0.55, pz], target: [CX, 0, CZ] },
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
      <mesh position={[0, y0 + h / 2, 0]} castShadow receiveShadow>
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
  if (e.size === 'overhead' || e.size === 'overheadSingle') {
    // an overhead sectional door: a white slab set into the wall with four panel lines
    const h = e.h && e.h !== 6.67 ? e.h : 7
    return (
      <group position={[x, 0, z]} rotation-y={-rot}>
        <mesh position={[0, h / 2, 0]} castShadow>
          <boxGeometry args={[e.span, h, 0.3]} />
          <meshLambertMaterial color="#f7f5f0" />
          <Edges color={INK} threshold={15} />
        </mesh>
        {[1, 2, 3].map((i) => (
          <Line key={i} points={[[-e.span / 2, (h * i) / 4, 0.17], [e.span / 2, (h * i) / 4, 0.17]]} color="#b9b4ab" lineWidth={1} />
        ))}
      </group>
    )
  }
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
      <mesh geometry={shingles} castShadow receiveShadow>
        <meshLambertMaterial color="#6f655c" side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={metal} castShadow receiveShadow>
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

/** 8x8 posts along a porch's open sides: the corners and every 8 ft between. */
function PorchColumns({ r, rooms, lot }) {
  const posts = useMemo(() => {
    const solid = rooms.filter((o) => isRoom(o) && !o.open && o.local)
    const x0 = r.local[0] - r.w / 2
    const x1 = r.local[0] + r.w / 2
    const z0 = r.local[1] - r.d / 2
    const z1 = r.local[1] + r.d / 2
    const touches = (side) =>
      solid.some((o) => {
        const ox0 = o.local[0] - o.w / 2
        const ox1 = o.local[0] + o.w / 2
        const oz0 = o.local[1] - o.d / 2
        const oz1 = o.local[1] + o.d / 2
        const xo = Math.min(x1, ox1) - Math.max(x0, ox0) > 2
        const zo = Math.min(z1, oz1) - Math.max(z0, oz0) > 2
        return side === 'n' ? xo && Math.abs(oz1 - z0) < 1 : side === 's' ? xo && Math.abs(oz0 - z1) < 1 : side === 'w' ? zo && Math.abs(ox1 - x0) < 1 : zo && Math.abs(ox0 - x1) < 1
      })
    const open = ['n', 's', 'w', 'e'].filter((side) => !touches(side))
    const pts = []
    const inset = 0.5
    const line = (ax, az, bx, bz) => {
      const len = Math.hypot(bx - ax, bz - az)
      const n = Math.max(1, Math.round(len / 8))
      for (let i = 0; i <= n; i++) pts.push([ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n])
    }
    if (open.includes('s')) line(x0 + inset, z1 - inset, x1 - inset, z1 - inset)
    if (open.includes('n')) line(x0 + inset, z0 + inset, x1 - inset, z0 + inset)
    if (open.includes('w')) line(x0 + inset, z0 + inset, x0 + inset, z1 - inset)
    if (open.includes('e')) line(x1 - inset, z0 + inset, x1 - inset, z1 - inset)
    // one post per spot
    const seen = new Set()
    return pts.filter((p) => {
      const k = `${p[0].toFixed(1)},${p[1].toFixed(1)}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
  }, [r, rooms])
  const centre = useMemo(() => {
    const cos = Math.cos(lot.angle)
    const sin = Math.sin(lot.angle)
    return [r.center[0] - (r.local[0] * cos - r.local[1] * sin), r.center[1] - (r.local[0] * sin + r.local[1] * cos)]
  }, [r, lot])
  return posts.map((p, i) => {
    const [x, z] = toWorld(p[0], p[1], centre, lot)
    return <Box key={i} cx={x} cz={z} w={0.67} d={0.67} h={8} rot={lot.angle} color="#f7f5f0" />
  })
}

/** The driveway: from the garage's overhead door to the street, on the ground. */
function Driveway({ rooms, centre, lot }) {
  const slabs = useMemo(() => {
    const garage = rooms.find((r) => isRoom(r) && r.kind === 'garage' && r.local)
    const door = rooms.find((e) => e.kind === 'door' && (e.size === 'overhead' || e.size === 'overheadSingle') && e.local)
    if (!garage || !door) return []
    // the lot's street edge in the house frame: the largest local z of the boundary
    const cos = Math.cos(lot.angle)
    const sin = Math.sin(lot.angle)
    const toLocal = (p) => [(p[0] - centre[0]) * cos + (p[1] - centre[1]) * sin, -(p[0] - centre[0]) * sin + (p[1] - centre[1]) * cos]
    const zs = (lot.boundary || []).map((p) => toLocal(p)[1])
    const street = zs.length ? Math.max(...zs) : garage.local[1] + garage.d / 2 + 30
    const out = []
    if (door.axis === 'h') {
      // front-load: straight out to the street
      const z0 = door.local[1]
      out.push({ x: door.local[0], z: (z0 + street) / 2, w: door.span + 2, d: street - z0 })
    } else if (garage.driveway === 'courtyard' || door.local[0] < garage.local[0]) {
      // the courtyard way: a 25 ft apron off the west-facing doors, across the rear to the east side yard, then down to the street
      const x0 = door.local[0]
      const solid = rooms.filter((r) => isRoom(r) && !r.open && r.local)
      const east = Math.max(...solid.map((r) => r.local[0] + r.w / 2))
      const apron = { x: x0 - 12.5, z: garage.local[1], w: 25, d: garage.d }
      out.push(apron)
      const legZ = garage.local[1] - garage.d / 2 + 6
      out.push({ x: (x0 - 25 + east + 10) / 2, z: legZ, w: east + 10 - (x0 - 25), d: 12 })
      out.push({ x: east + 5, z: (legZ + street) / 2, w: 10, d: street - legZ })
    } else {
      // side-load: 25 ft of apron off the door face, then down to the street
      const dir = door.local[0] > garage.local[0] ? 1 : -1
      const x0 = door.local[0]
      const apron = { x: x0 + dir * 12.5, z: garage.local[1], w: 25, d: garage.d }
      out.push(apron)
      const z1 = garage.local[1] + garage.d / 2
      out.push({ x: x0 + dir * 12, z: (z1 + street) / 2, w: 12, d: street - z1 })
    }
    return out
  }, [rooms, centre, lot])
  return slabs.map((s, i) => {
    const [x, z] = toWorld(s.x, s.z, centre, lot)
    return <Box key={i} cx={x} cz={z} w={s.w} d={s.d} y0={-0.3} h={0.32} rot={lot.angle} color="#d9d5cc" edges={false} />
  })
}

function Room({ r, highlight, labels, lot }) {
  const [x, z] = r.center
  // labels sit above the walls and furniture, where the plan view can read them
  const LY = 10.2
  // every room gets its name and size, sized to fit inside the room (plan view only)
  const sideways = r.d > r.w * 1.4
  const along = sideways ? r.d : r.w
  const nameSize = Math.min(1.9, Math.max(0.9, (along - 1.5) / (r.name.length * 0.62)))
  const dimSize = Math.min(1.2, Math.max(0.8, nameSize * 0.7))
  return (
    <group position={[x, 0, z]} rotation-y={-lot.angle}>
      <mesh position={[0, -0.17, 0]} receiveShadow>
        <boxGeometry args={[r.w, 0.34, r.d]} />
        <meshLambertMaterial color={highlight ? '#e9dccf' : r.open ? '#e6e1d8' : '#efeae2'} />
        <Edges color={highlight ? '#4e3c30' : '#b9b4ab'} threshold={15} />
      </mesh>
      {labels && (
        <>
          <FlatLabel x={sideways ? -0.9 : 0} z={sideways ? 0 : -0.9} y={LY} angle={lot.angle + (sideways ? Math.PI / 2 : 0)} size={nameSize} bold color={highlight ? '#4e3c30' : '#2a2520'}>
            {r.name.toUpperCase()}
          </FlatLabel>
          {Math.min(r.w, r.d) >= 4 && (
            <FlatLabel x={sideways ? 1.1 : 0} z={sideways ? 0 : 1.1} y={LY} angle={lot.angle + (sideways ? Math.PI / 2 : 0)} size={dimSize} color="#7a6558">
              {Math.round(r.w * 4) / 4}' × {Math.round(r.d * 4) / 4}'
            </FlatLabel>
          )}
        </>
      )}
    </group>
  )
}

/** A room's name in the 3D view: a small tag above the room that always faces the viewer. */
function RoomTag({ r, highlight, showRoof }) {
  const [x, z] = r.center
  const y = r.open ? 2 : showRoof ? (r.plate || 9) + 7 : (r.plate || 9) + 1.5
  return (
    <Html position={[x, y, z]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
      <span className={'room-tag' + (highlight ? ' on' : '') + (r.open ? ' open' : '')}>{r.name}</span>
    </Html>
  )
}

/** Where the sun is on July 15 at 5 pm in the Rio Grande Valley (26°N): azimuth about 275°, 28° up. World north is -z when the lot angle is 0. */
function sunPosition(lot, dist = 700) {
  const az = (275 * Math.PI) / 180
  const alt = (28 * Math.PI) / 180
  const dx = Math.sin(az) * Math.cos(alt)
  const dz = -Math.cos(az) * Math.cos(alt)
  const dy = Math.sin(alt)
  // the lot's bearing turns the compass
  const a = lot.angle || 0
  const wx = dx * Math.cos(a) - dz * Math.sin(a)
  const wz = dx * Math.sin(a) + dz * Math.cos(a)
  return [wx * dist, dy * dist, wz * dist]
}

export default function HouseScene({ rooms = [], style, view = '3d', highlightKind, controlsRef, showHouse = true, showRoof = true, lot = DEFAULT_LOT, tags = true, sun = false }) {
  const L = lot && lot.envelope ? lot : DEFAULT_LOT
  const cams = useMemo(() => camerasFor(L, rooms), [L, rooms.length])
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
    <Canvas shadows camera={{ position: cam.position, fov: 42, near: 1, far: 6000 }} gl={{ antialias: true, preserveDrawingBuffer: true }}>
      <color attach="background" args={[sun ? '#f3e9d6' : '#ebe9e5']} />
      <ambientLight intensity={sun ? 1.1 : 2.0} />
      <directionalLight position={sun ? sunPosition(L) : [-150, 300, -200]} intensity={sun ? 2.2 : 1.4} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-220} shadow-camera-right={220} shadow-camera-top={220} shadow-camera-bottom={-220} shadow-camera-near={10} shadow-camera-far={2000} shadow-bias={-0.0004} />
      <SitePlan lot={L} />
      <mesh rotation-x={-Math.PI / 2} position={[L.centre[0], -0.36, L.centre[1]]} receiveShadow>
        <planeGeometry args={[2000, 2000]} />
        <shadowMaterial transparent opacity={sun ? 0.35 : 0.18} />
      </mesh>
      {showHouse && roomList.map((r) => <Room key={r.id} r={r} highlight={r.kind === highlightKind} labels={view === 'top'} lot={L} />)}
      {showHouse && tags && view !== 'top' && roomList.filter((r) => Math.min(r.w, r.d) >= 5).map((r) => <RoomTag key={'tag-' + r.id} r={r} highlight={r.kind === highlightKind} showRoof={showRoof} />)}
      {showHouse && roomList.length > 0 && <Walls rooms={rooms} kit={kit} centre={centre} lot={L} />}
      {showHouse && view !== 'top' && roomList.filter((r) => r.open && r.local).map((r) => <PorchColumns key={'col-' + r.id} r={r} rooms={rooms} lot={L} />)}
      {showHouse && hasPlan && <Driveway rooms={rooms} centre={centre} lot={L} />}
      {showHouse && hasPlan && rooms.filter((e) => e.kind === 'door').map((e) => <Door key={e.id} e={e} centre={centre} lot={L} />)}
      {showHouse && hasPlan && rooms.filter((e) => e.kind === 'window').map((e) => <Window key={e.id} e={e} centre={centre} lot={L} />)}
      {showHouse && hasPlan && rooms.filter((e) => e.kind === 'fixture').map((e) => <Fixture key={e.id} e={e} centre={centre} lot={L} />)}
      {showHouse && showRoof && view !== 'top' && rooms.filter((e) => e.kind === 'roof').map((e) => <Roof key={e.id} roof={e} centre={centre} lot={L} />)}
      <OrbitControls key={L.centre.join(',')} ref={controlsRef} makeDefault target={cam.target} maxPolarAngle={Math.PI / 2 - 0.04} minDistance={15} maxDistance={1200} enableRotate={view !== 'top'} screenSpacePanning />
    </Canvas>
  )
}
