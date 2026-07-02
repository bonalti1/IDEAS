import { useRef, useCallback } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import SitePlan, { COLORS } from './components/SitePlan.jsx'
import ProgramElements from './components/ProgramElements.jsx'
import Panel from './components/Panel.jsx'
import { LOT_CENTROID } from './data/survey.js'

const [CX, CZ] = LOT_CENTROID

export const VIEW_PRESETS = {
  Top: { position: [CX, 420, CZ + 2], target: [CX, 0, CZ] },
  '3D': { position: [CX - 160, 190, CZ + 220], target: [CX, 0, CZ] },
  'Showers Rd': { position: [-140, 45, CZ + 10], target: [CX, 0, CZ] },
  'Ida Blvd': { position: [CX, 45, CZ + 200], target: [CX, 0, CZ] },
  'Don St': { position: [CX + 250, 45, CZ], target: [CX, 0, CZ] },
}

export default function App() {
  const controlsRef = useRef()

  const applyView = useCallback((name) => {
    const c = controlsRef.current
    if (!c) return
    const { position, target } = VIEW_PRESETS[name]
    c.object.position.set(...position)
    c.target.set(...target)
    c.update()
  }, [])

  return (
    <div className="app">
      <header className="titlebar">
        <span className="title">LOT 514 · VILLA-RAMA EAST PHASE V · PALMVIEW, TX</span>
        <span className="subtitle">SITE PLAN REVIEW — PHASE 2: PROGRAM LAYOUT (FOOTPRINTS ESTIMATED)</span>
        <nav className="views">
          {Object.keys(VIEW_PRESETS).map((name) => (
            <button key={name} onClick={() => applyView(name)}>
              {name}
            </button>
          ))}
        </nav>
      </header>
      <div className="main">
        <Canvas
          camera={{ position: VIEW_PRESETS['3D'].position, fov: 45, near: 1, far: 6000 }}
          gl={{ antialias: true, preserveDrawingBuffer: true }}
        >
          <color attach="background" args={[COLORS.bg]} />
          <ambientLight intensity={2.1} />
          <directionalLight position={[-150, 300, -200]} intensity={1.4} />
          <SitePlan />
          <ProgramElements />
          <OrbitControls
            ref={controlsRef}
            makeDefault
            target={VIEW_PRESETS['3D'].target}
            maxPolarAngle={Math.PI / 2 - 0.04}
            minDistance={20}
            maxDistance={1200}
          />
        </Canvas>
        <Panel />
      </div>
    </div>
  )
}
