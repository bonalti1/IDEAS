// Round 15, U15: the words inside the floor plan and the site plan a homeowner sees on the Draft step, in Spanish.
// The drawings are written in English by lib/plan-svg.js (the drafter's sheets stay English); on a Spanish screen
// the text between the drawing's tags is read here, phrase by phrase: room names ("PRIMARY BEDROOM" → "RECÁMARA
// PRINCIPAL"), the title lines, the scale, the lot coverage, the space kept open along each edge, the driveway.
// Numbers, feet-and-inches and street names are left as they are. Nothing but text between tags is touched.
import { roomName, es } from './i18n.js'
import { STYLES } from './styles.js'

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
const encode = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const title = (s) => s.toLowerCase().replace(/(^|[\s-])([a-z])/g, (m, a, b) => a + b.toUpperCase()).replace(/ & /g, ' & ')
const EDGE_ES = { side: 'al lado', 'street side': 'hacia la calle lateral', front: 'al frente', rear: 'al fondo' }

/** One piece of drawing text in Spanish (the room names come in capitals or as written). */
export function drawingWordsEs(text) {
  let s = text
  // a room's name, as the plan writes it (capitals) or as the site plan writes it
  const asRoom = (name) => {
    const t = title(name).replace(/^(\d)-car Garage/i, '$1-Car Garage').replace(/Jack & jill/i, 'Jack & Jill')
    const es = roomName(t, 'es')
    return es !== t ? es : null
  }
  const whole = s.trim()
  if (/^[A-Z0-9 &'-]+$/.test(whole) && /[A-Z]{3}/.test(whole)) {
    const es = asRoom(whole)
    if (es) return s.replace(whole, es.toUpperCase())
  }
  if (/^[A-Z][a-z]+(?: [A-Z][a-z]+)*$|^\d-Car Garage$/.test(whole)) {
    const es = asRoom(whole)
    if (es) return s.replace(whole, es)
  }
  s = s
    .replace(/^FLOOR PLAN\b/, 'PLANO DE LA CASA')
    .replace(/^SITE PLAN\b/, 'PLANO DEL LOTE')
    .replace(/graphic scale, feet/g, 'escala gráfica, en pies')
    .replace(/lot coverage (\d+(?:\.\d+)?)% \(([\d,]+) sf of ([\d,]+) sf\)/g, 'la casa cubre $1% del lote ($2 pies² de $3 pies²)')
    .replace(/(\d+)' (side|street side|front|rear) setback/gi, (m, n, k) => `${n}' libres ${EDGE_ES[k.toLowerCase()]}`)
    .replace(/^driveway$/, 'entrada de carros')
    .replace(/^LOT (\d+)$/, 'LOTE $1')
    .replace(/\b(\d+) bed\b/g, '$1 rec.')
    .replace(/\b(\d+(?:\.5)?) bath\b/g, '$1 baños')
    .replace(/\b(\d)-car\b/g, '$1 carros')
    .replace(/\bno garage\b/g, 'sin cochera')
    .replace(/([\d,]+) sf\b/g, '$1 pies²')
  for (const name of STYLES.map((x) => x.name).sort((a, b) => b.length - a.length)) if (es[name] && s.includes(name)) s = s.split(name).join(es[name])
  return s
}

/** The drawing's SVG with every text between tags in Spanish. */
export function drawingEs(svg) {
  if (typeof svg !== 'string') return svg
  return svg.replace(/>([^<>]+)</g, (m, text) => (/[A-Za-z]/.test(text) ? `>${encode(drawingWordsEs(decode(text)))}<` : m))
}
