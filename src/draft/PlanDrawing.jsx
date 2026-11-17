// The floor plan drawing (SVG from design.json) and the site plan, with wheel zoom, drag pan, pinch
// zoom on a phone, a tap on a room for its name and size, and a double tap to fit. `api` ref gets { fit }.
import { useEffect, useMemo, useRef, useState } from 'react'
import { buildDesign } from './lib/contract.js'
import { planSVG, sitePlanSVG } from './lib/plan-svg.js'

export default function PlanDrawing({ rooms, program, style, lot, client, api, highlightKind, mode = 'plan' }) {
  const { svg, design } = useMemo(() => {
    try {
      const design = buildDesign({ rooms, program, style, lot, client })
      return { svg: (mode === 'site' ? sitePlanSVG(design) : planSVG(design)).svg, design }
    } catch (e) {
      return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text font-size="2" y="5">${String(e.message)}</text></svg>`, design: null }
    }
  }, [rooms, program, style, lot, client, mode])
  const [t, setT] = useState({ k: 1, x: 0, y: 0 })
  const [tip, setTip] = useState(null) // { x, y, name, size }
  const pointers = useRef(new Map())
  const drag = useRef(null)
  const pinch = useRef(null)
  const lastTap = useRef(0)
  const box = useRef(null)
  const fit = () => {
    setT({ k: 1, x: 0, y: 0 })
    setTip(null)
  }
  useEffect(() => {
    if (api) api.current = { fit }
  }, [api])
  useEffect(() => setTip(null), [mode, rooms])
  const zoomAt = (px, py, f) =>
    setT((s) => {
      const k = Math.min(8, Math.max(0.5, s.k * f))
      const ff = k / s.k
      return { k, x: px - (px - s.x) * ff, y: py - (py - s.y) * ff }
    })
  const onWheel = (e) => {
    e.preventDefault()
    const r = box.current.getBoundingClientRect()
    zoomAt(e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2, e.deltaY < 0 ? 1.12 : 1 / 1.12)
  }
  const onDown = (e) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    e.currentTarget.setPointerCapture(e.pointerId)
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), t }
      drag.current = null
      return
    }
    // the room under the finger, read now: once the pointer is captured, later events target the frame
    drag.current = { x: e.clientX, y: e.clientY, t, moved: false, hit: e.target.closest?.('[data-id]') || null }
  }
  const onMove = (e) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      const r = box.current.getBoundingClientRect()
      const mx = (a.x + b.x) / 2 - r.left - r.width / 2
      const my = (a.y + b.y) / 2 - r.top - r.height / 2
      const k = Math.min(8, Math.max(0.5, pinch.current.t.k * (dist / pinch.current.dist)))
      const f = k / pinch.current.t.k
      setT({ k, x: mx - (mx - pinch.current.t.x) * f, y: my - (my - pinch.current.t.y) * f })
      return
    }
    if (!drag.current) return
    const d = drag.current
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) d.moved = true
    setT({ ...d.t, x: d.t.x + e.clientX - d.x, y: d.t.y + e.clientY - d.y })
  }
  const onUp = (e) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    const d = drag.current
    drag.current = null
    if (!d || d.moved) return
    // a tap: a double tap fits; a tap on a room names it with its size
    const now = Date.now()
    if (now - lastTap.current < 320) {
      lastTap.current = 0
      fit()
      return
    }
    lastTap.current = now
    const id = d.hit?.getAttribute('data-id')
    const room = id && design?.rooms?.find((r) => r.id === id)
    if (!room) {
      setTip(null)
      return
    }
    const r = box.current.getBoundingClientRect()
    const ft = (v) => {
      const total = Math.round(v * 12)
      const f = Math.floor(total / 12)
      const i = total - f * 12
      return i ? `${f}'-${i}"` : `${f}'`
    }
    setTip({ x: e.clientX - r.left, y: e.clientY - r.top, name: room.name, size: `${ft(room.w)} × ${ft(room.d)} · ${Math.round(room.w * room.d)} sf` })
  }
  return (
    <div ref={box} className={'plan-drawing' + (highlightKind ? ' hl-' + highlightKind : '') + (mode === 'site' ? ' site' : '')} onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      <div className="plan-drawing-inner" style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.k})` }} dangerouslySetInnerHTML={{ __html: svg }} />
      {tip && (
        <div className="plan-tip" style={{ left: tip.x, top: tip.y }}>
          <b>{tip.name}</b>
          <span>{tip.size}</span>
        </div>
      )}
    </div>
  )
}
