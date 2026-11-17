// The floor plan drawing (SVG from design.json) with wheel zoom and drag pan. `api` ref gets { fit }.
import { useEffect, useMemo, useRef, useState } from 'react'
import { buildDesign } from './lib/contract.js'
import { planSVG } from './lib/plan-svg.js'

export default function PlanDrawing({ rooms, program, style, lot, client, api, highlightKind }) {
  const { svg } = useMemo(() => {
    try {
      return planSVG(buildDesign({ rooms, program, style, lot, client }))
    } catch (e) {
      return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text font-size="2" y="5">${String(e.message)}</text></svg>` }
    }
  }, [rooms, program, style, lot, client])
  const [t, setT] = useState({ k: 1, x: 0, y: 0 })
  const drag = useRef(null)
  const box = useRef(null)
  const fit = () => setT({ k: 1, x: 0, y: 0 })
  useEffect(() => {
    if (api) api.current = { fit }
  }, [api])
  const onWheel = (e) => {
    e.preventDefault()
    const r = box.current.getBoundingClientRect()
    const px = e.clientX - r.left - r.width / 2
    const py = e.clientY - r.top - r.height / 2
    setT((s) => {
      const k = Math.min(8, Math.max(0.5, s.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12)))
      const f = k / s.k
      return { k, x: px - (px - s.x) * f, y: py - (py - s.y) * f }
    })
  }
  const onDown = (e) => {
    drag.current = { x: e.clientX, y: e.clientY, t }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onMove = (e) => {
    if (!drag.current) return
    const d = drag.current
    setT({ ...d.t, x: d.t.x + e.clientX - d.x, y: d.t.y + e.clientY - d.y })
  }
  const onUp = () => (drag.current = null)
  return (
    <div ref={box} className={'plan-drawing' + (highlightKind ? ' hl-' + highlightKind : '')} onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      <div className="plan-drawing-inner" style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.k})` }} dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  )
}
