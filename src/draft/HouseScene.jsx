// 3D scene for the Draft step: the lot plus the generated house massing.
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Edges } from '@react-three/drei'
import SitePlan from '../components/SitePlan.jsx'
import { FlatLabel } from '../components/labels.jsx'
import { LOT_ANGLE } from '../data/program.js'
import { LOT_CENTROID } from '../data/survey.js'

const [CX, CZ] = LOT_CENTROID
export const CAMERAS = {
  top: { position: [CX, 380, CZ + 2], target: [CX, 0, CZ] },
  '3d': { position: [CX - 95, 85, CZ + 125], target: [CX, 0, CZ] },
}

function Room({ r, highlight }) {
  const [x, z] = r.center
  const nameSize = Math.min(3, Math.max(1.8, (r.w - 1) / (r.name.length * 0.62)))
  return (
    <group position={[x, 0, z]} rotation-y={-LOT_ANGLE}>
      <mesh position={[0, r.h / 2, 0]}>
        <boxGeometry args={[r.w, r.h, r.d]} />
        <meshLambertMaterial color={highlight ? '#e9dccf' : r.fill || '#f1ede6'} />
        <Edges color={highlight ? '#4e3c30' : '#2a2520'} threshold={15} />
      </mesh>
      <FlatLabel x={0} z={-1.6} y={r.h + 0.15} angle={LOT_ANGLE} size={nameSize} bold>
        {r.name.toUpperCase()}
      </FlatLabel>
      {r.w >= 10 && (
        <FlatLabel x={0} z={2.2} y={r.h + 0.15} angle={LOT_ANGLE} size={2.1} color="#7a6558">
          {r.w}' × {r.d}'
        </FlatLabel>
      )}
    </group>
  )
}

export default function HouseScene({ rooms = [], view = '3d', highlightKind, controlsRef, showHouse = true }) {
  const cam = CAMERAS[view] || CAMERAS['3d']
  return (
    <Canvas
      camera={{ position: cam.position, fov: 42, near: 1, far: 6000 }}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
    >
      <color attach="background" args={['#ebe9e5']} />
      <ambientLight intensity={2.0} />
      <directionalLight position={[-150, 300, -200]} intensity={1.4} />
      <SitePlan />
      {showHouse && rooms.map((r) => <Room key={r.id} r={r} highlight={r.kind === highlightKind} />)}
      <OrbitControls
        ref={controlsRef}
        makeDefault
        target={cam.target}
        maxPolarAngle={Math.PI / 2 - 0.04}
        minDistance={20}
        maxDistance={1200}
      />
    </Canvas>
  )
}
