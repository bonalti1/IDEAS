const NS = 'http://www.w3.org/2000/svg'

// Glass silhouette: tapered pint glass, viewBox 0 0 200 440.
const GLASS_PATH =
  'M58,20 L142,20 Q148,20 148,28 L138,400 Q137,412 125,412 ' +
  'L75,412 Q63,412 62,400 L52,28 Q52,20 58,20 Z'
const GLASS_HIGHLIGHT_PATH = 'M66,32 Q60,180 68,380 L78,378 Q71,180 76,34 Z'

const CX = 100 // horizontal center of glass, viewBox space
const PIVOT_X = 100
const PIVOT_Y = 400 // rotate the "cup" around near its base
const TOP_INNER = 42 // liquid surface y when full (level = 1)
const BOTTOM_INNER = 398 // liquid surface y when empty (level = 0)

const MAX_DRAIN_RATE = 0.075 // fraction of glass per second at max tilt
const POUR_THRESHOLD_DEG = 6
const MAX_GLASS_TILT = 34
const BUBBLE_COUNT = 12
const LACE_MARKS = 9

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const lerp = (a, b, t) => a + (b - a) * t

function svgEl(tag, attrs) {
  const el = document.createElementNS(NS, tag)
  for (const k in attrs) el.setAttribute(k, attrs[k])
  return el
}

class BeerGlass {
  constructor() {
    this.glassPathClip = document.getElementById('glassPathClip')
    this.glassOutline = document.getElementById('glassOutline')
    this.glassHighlight = document.getElementById('glassHighlight')
    this.tiltGroup = document.getElementById('tiltGroup')
    this.liquidPivot = document.getElementById('liquidPivot')
    this.liquidRotate = document.getElementById('liquidRotate')
    this.foamGroup = document.getElementById('foamGroup')
    this.bubbleGroup = document.getElementById('bubbleGroup')
    this.laceGroup = document.getElementById('laceGroup')
    this.emptyOverlay = document.getElementById('emptyOverlay')
    this.tiltReadout = document.getElementById('tiltReadout')
    this.fillReadout = document.getElementById('fillReadout')

    this.glassPathClip.setAttribute('d', GLASS_PATH)
    this.glassOutline.setAttribute('d', GLASS_PATH)
    this.glassHighlight.setAttribute('d', GLASS_HIGHLIGHT_PATH)

    this.level = 1
    this.minLevelReached = 1
    this.latestBeta = null
    this.latestGamma = null
    this.smoothTilt = 0
    this.smoothGamma = 0
    this.manualOffset = 0
    this.isDragging = false
    this.dragStartY = 0
    this.dragStartOffset = 0
    this.lastT = null
    this.emptyShown = false
    this.emptyAnnounced = false
    this.muted = false
    this.lastGlugAt = 0
    this.audioCtx = null

    this._buildFoam()
    this._buildBubbles()
    this._buildLace()
    this._bindDrag()

    this.render(true)
  }

  _buildFoam() {
    this.foamDots = []
    const n = 9
    for (let i = 0; i < n; i++) {
      const x = -10 + (220 * i) / (n - 1) + (Math.random() * 10 - 5)
      const r = 9 + Math.random() * 7
      const dot = svgEl('circle', { cx: x, cy: -2 + Math.random() * 6, r, fill: '#fbf4e4' })
      this.foamGroup.appendChild(dot)
      this.foamDots.push(dot)
    }
  }

  _buildBubbles() {
    this.bubbles = []
    for (let i = 0; i < BUBBLE_COUNT; i++) {
      const b = {
        x: -60 + Math.random() * 320,
        y: 40 + Math.random() * 500,
        speed: 30 + Math.random() * 45,
        r: 1.2 + Math.random() * 2.2,
      }
      b.el = svgEl('circle', { cx: b.x, cy: b.y, r: b.r, fill: 'rgba(255,255,255,0.55)' })
      this.bubbleGroup.appendChild(b.el)
      this.bubbles.push(b)
    }
  }

  _buildLace() {
    this.laceMarks = []
    for (let i = 0; i < LACE_MARKS; i++) {
      const y = TOP_INNER + 14 + ((BOTTOM_INNER - TOP_INNER - 24) * i) / (LACE_MARKS - 1)
      const el = svgEl('ellipse', {
        cx: CX,
        cy: y,
        rx: 46 - i * 0.6,
        ry: 3.2,
        fill: '#fbf4e4',
        opacity: 0,
        style: 'transition: opacity .6s ease',
      })
      this.laceGroup.appendChild(el)
      this.laceMarks.push({ y, el, triggered: false })
    }
  }

  _bindDrag() {
    const svg = document.getElementById('beerSvg')
    const onDown = (clientY) => {
      this.isDragging = true
      this.dragStartY = clientY
      this.dragStartOffset = this.manualOffset
    }
    const onMove = (clientY) => {
      if (!this.isDragging) return
      const dy = clientY - this.dragStartY
      this.manualOffset = clamp(this.dragStartOffset + dy * 0.55, -20, 100)
    }
    const onUp = () => {
      this.isDragging = false
    }
    svg.addEventListener('pointerdown', (e) => {
      svg.setPointerCapture(e.pointerId)
      onDown(e.clientY)
    })
    svg.addEventListener('pointermove', (e) => onMove(e.clientY))
    svg.addEventListener('pointerup', onUp)
    svg.addEventListener('pointercancel', onUp)
  }

  onOrientation(beta, gamma) {
    this.latestBeta = beta
    this.latestGamma = gamma
  }

  reset() {
    this.level = 1
    this.minLevelReached = 1
    this.emptyShown = false
    this.emptyAnnounced = false
    this.laceMarks.forEach((m) => {
      m.triggered = false
      m.el.setAttribute('opacity', 0)
    })
    this.emptyOverlay.classList.add('hidden')
  }

  _rawTiltAmount() {
    if (this.latestBeta == null) return 0
    const raw = 90 - this.latestBeta
    return clamp(raw, 0, 90)
  }

  _ensureAudio() {
    if (!this.audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext
      this.audioCtx = new Ctx()
    }
    return this.audioCtx
  }

  playGlug() {
    if (this.muted) return
    const ctx = this._ensureAudio()
    const t0 = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(170, t0)
    osc.frequency.exponentialRampToValueAtTime(85, t0 + 0.16)
    gain.gain.setValueAtTime(0.0001, t0)
    gain.gain.exponentialRampToValueAtTime(0.22, t0 + 0.03)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2)
    osc.connect(gain).connect(ctx.destination)
    osc.start(t0)
    osc.stop(t0 + 0.22)
  }

  playCheers() {
    if (this.muted) return
    const ctx = this._ensureAudio()
    ;[523.25, 659.25, 783.99].forEach((f, i) => {
      const t0 = ctx.currentTime + i * 0.09
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'triangle'
      osc.frequency.value = f
      gain.gain.setValueAtTime(0.0001, t0)
      gain.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t0)
      osc.stop(t0 + 0.55)
    })
  }

  step(t) {
    if (this.lastT == null) this.lastT = t
    const dt = Math.min((t - this.lastT) / 1000, 0.05)
    this.lastT = t

    const rawTilt = this._rawTiltAmount() + this.manualOffset
    this.smoothTilt = lerp(this.smoothTilt, clamp(rawTilt, 0, 120), Math.min(dt * 6, 1))

    if (!this.isDragging) {
      this.manualOffset = lerp(this.manualOffset, 0, Math.min(dt * 1.6, 1))
    }

    const gammaRaw = this.latestGamma ?? 0
    this.smoothGamma = lerp(this.smoothGamma, clamp(gammaRaw, -45, 45), Math.min(dt * 4, 1))

    const isPouring = this.smoothTilt > POUR_THRESHOLD_DEG && this.level > 0
    if (isPouring) {
      const rate = MAX_DRAIN_RATE * Math.pow(this.smoothTilt / 90, 1.4)
      this.level = Math.max(0, this.level - rate * dt)
      if (t - this.lastGlugAt > 380) {
        this.lastGlugAt = t
        this.playGlug()
      }
    }
    if (this.level < this.minLevelReached) this.minLevelReached = this.level

    this._updateBubbles(dt, isPouring)
    this.render(false, isPouring)

    if (this.level <= 0 && !this.emptyAnnounced) {
      this.emptyAnnounced = true
      this.emptyShown = true
      this.emptyOverlay.classList.remove('hidden')
      this.playCheers()
    }
  }

  _updateBubbles(dt, isPouring) {
    const speedMul = isPouring ? 1 : 0.15
    for (const b of this.bubbles) {
      b.y -= b.speed * dt * speedMul
      if (b.y < 10) {
        b.y = 560 + Math.random() * 60
        b.x = -60 + Math.random() * 320
        b.el.setAttribute('cx', b.x)
      }
      b.el.setAttribute('cy', b.y)
      b.el.setAttribute('opacity', isPouring ? 0.6 : 0.2)
    }
  }

  render(initial, isPouring) {
    const liquidTopY = BOTTOM_INNER - this.level * (BOTTOM_INNER - TOP_INNER)
    const glassTiltDeg = clamp(-this.smoothTilt * 0.38, -MAX_GLASS_TILT, 0)
    const liquidAngle = clamp(-glassTiltDeg + this.smoothGamma * 0.22, -40, 40)

    this.tiltGroup.setAttribute('transform', `rotate(${glassTiltDeg} ${PIVOT_X} ${PIVOT_Y})`)
    this.liquidPivot.setAttribute('transform', `translate(${CX} ${liquidTopY})`)
    this.liquidRotate.setAttribute('transform', `rotate(${liquidAngle})`)

    for (const m of this.laceMarks) {
      if (!m.triggered && liquidTopY > m.y + 2) {
        m.triggered = true
        m.el.setAttribute('opacity', 0.22)
      }
    }

    if (!initial) {
      this.tiltReadout.textContent = `tilt ${Math.round(this.smoothTilt)}°`
      this.fillReadout.textContent = `${Math.round(this.level * 100)}% full`
    }
  }

  start() {
    const loop = (t) => {
      this.step(t)
      this._raf = requestAnimationFrame(loop)
    }
    this._raf = requestAnimationFrame(loop)
  }
}

function init() {
  const glass = new BeerGlass()
  const startOverlay = document.getElementById('startOverlay')
  const startBtn = document.getElementById('startBtn')
  const startNote = document.getElementById('startNote')
  const newBeerBtn = document.getElementById('newBeerBtn')
  const muteBtn = document.getElementById('muteBtn')

  const hasOrientation = 'DeviceOrientationEvent' in window
  if (!hasOrientation) {
    startNote.textContent = 'No tilt sensor found — drag the glass up/down instead.'
  }

  startBtn.addEventListener('click', async () => {
    glass._ensureAudio()

    if (hasOrientation && typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const result = await DeviceOrientationEvent.requestPermission()
        if (result !== 'granted') {
          startNote.textContent = 'Motion permission denied — drag the glass instead.'
        }
      } catch {
        startNote.textContent = 'Motion permission unavailable — drag the glass instead.'
      }
    }

    window.addEventListener(
      'deviceorientation',
      (e) => glass.onOrientation(e.beta, e.gamma),
      true
    )

    startOverlay.classList.add('hidden')
    glass.start()
  })

  newBeerBtn.addEventListener('click', () => glass.reset())

  muteBtn.addEventListener('click', () => {
    glass.muted = !glass.muted
    muteBtn.textContent = glass.muted ? '🔇' : '🔊'
  })
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}
