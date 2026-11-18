// Real PDF files, made in the browser: the floor plan sheet (24 x 36 at 1/4" = 1'-0", or tabloid at
// 1/8") with the site plan on a second sheet, and the homeowner's summary (letter). The drawings are
// the same SVG the plan tab shows, placed at true scale with jsPDF and svg2pdf. No pop-up, no print
// dialog: the file downloads. The libraries load on first use so the app's bundle stays small.
import { planSVG, sitePlanSVG, sheetFor, siteScaleFor, lotTitle, cropSVG } from './plan-svg.js'

let libs
async function load() {
  if (!libs) {
    const [{ jsPDF }] = await Promise.all([import('jspdf'), import('svg2pdf.js')])
    libs = { jsPDF }
  }
  return libs
}

// the drawing's sans font, embedded so labels never fall back to a serif: Liberation Sans (metric-compatible
// with Arial, SIL Open Font License) from public/fonts; when it cannot be fetched the PDF uses Helvetica
export const FONT = 'LiberationSans'
let fontFiles = null
const toBase64 = (buf) => {
  const bytes = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
async function fontData() {
  if (!fontFiles) {
    fontFiles = Promise.all(
      ['Regular', 'Bold'].map(async (style) => {
        const res = await fetch(`/fonts/LiberationSans-${style}.ttf`)
        if (!res.ok) throw new Error(`font ${style}: ${res.status}`)
        return toBase64(await res.arrayBuffer())
      }),
    ).catch((e) => {
      fontFiles = null
      throw e
    })
  }
  return fontFiles
}
/** Registers the embedded font on a document and makes it the current font; returns its name ('helvetica' when offline). */
export async function useFont(doc) {
  try {
    const [regular, bold] = await fontData()
    doc.addFileToVFS('LiberationSans-Regular.ttf', regular)
    doc.addFont('LiberationSans-Regular.ttf', FONT, 'normal')
    doc.addFileToVFS('LiberationSans-Bold.ttf', bold)
    doc.addFont('LiberationSans-Bold.ttf', FONT, 'bold')
    doc.setFont(FONT, 'normal')
    return FONT
  } catch (e) {
    doc.setFont('helvetica', 'normal')
    return 'helvetica'
  }
}

/** An SVG string → a live element the converter can measure (off screen, removed after). */
function mount(svgText) {
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-20000px;top:0;width:1px;height:1px;overflow:hidden;opacity:0'
  host.innerHTML = svgText
  document.body.appendChild(host)
  return { el: host.firstElementChild, done: () => host.remove() }
}

async function drawSVG(doc, svgText, x, y, w, h) {
  const { el, done } = mount(svgText)
  try {
    await doc.svg(el, { x, y, width: w, height: h })
  } finally {
    done()
  }
}

function titleBlock(doc, S, titleBlockInfo, design, what, scaleText, number, font = 'helvetica') {
  const { pageW, pageH, margin, blockH } = S
  const ab = design.asBuilt || design.program || {}
  const date = new Date(design.createdAt || Date.now()).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  const x0 = margin
  const x1 = pageW - margin
  const y1 = pageH - margin
  const y0 = y1 - blockH
  doc.setDrawColor(26, 26, 26)
  doc.setLineWidth(0.02)
  doc.rect(margin, margin, pageW - 2 * margin, pageH - 2 * margin)
  doc.line(x0, y0, x1, y0)
  const cols = [2.2, 2, 1.4, 1]
  const total = cols.reduce((a, b) => a + b, 0)
  let cx = x0
  const big = S.id === 'archD' ? 13 : 11
  const small = S.id === 'archD' ? 9 : 7.5
  const cells = [
    [titleBlockInfo.firm || 'South Texas Builders', [titleBlockInfo.address || '', titleBlockInfo.phone || '']],
    [design.client || 'Client', [lotTitle(design), `${design.style?.name || ''} · ${ab.beds} bed, ${ab.baths}${ab.halfBath ? '.5' : ''} bath${ab.garage ? `, ${ab.garage}-car` : ''}`]],
    [what, [`Scale ${scaleText}`, date]],
    [number, [`Draft House ${design.contract ? 'v' + design.contract : ''} · ${S.name}`, 'preliminary, not for construction']],
  ]
  cells.forEach(([head, lines], i) => {
    const w = ((x1 - x0) * cols[i]) / total
    if (i) doc.line(cx, y0, cx, y1)
    doc.setFont(font, 'bold')
    doc.setFontSize(big)
    doc.setTextColor(26, 26, 26)
    doc.text(String(head), cx + 0.14, y0 + 0.3, { maxWidth: w - 0.28 })
    doc.setFont(font, 'normal')
    doc.setFontSize(small)
    doc.setTextColor(85, 85, 85)
    lines.forEach((l, j) => doc.text(String(l), cx + 0.14, y0 + 0.3 + (j + 1) * (small / 72) * 1.5, { maxWidth: w - 0.28 }))
    cx += w
  })
}

/**
 * The floor plan and site plan sheets as a jsPDF document.
 * @param {object} design design.json
 * @param {object} info   kit.titleBlock
 * @param {{ sheet?: 'archD'|'tabloid' }} opts
 */
export async function planPDF(design, info = {}, opts = {}) {
  const { jsPDF } = await load()
  const plan = planSVG(design)
  const site = sitePlanSVG(design)
  const S = sheetFor(plan, opts.sheet)
  const doc = new jsPDF({ orientation: S.orientation, unit: 'in', format: [Math.min(S.pageW, S.pageH), Math.max(S.pageW, S.pageH)], compress: true })
  const font = await useFont(doc)
  const place = async (drawing, sc, what, label, number) => {
    const w = (drawing.width / 12) * sc
    const h = (drawing.height / 12) * sc
    // a drawing too big for the scale is drawn to fit (the sheet says so)
    const k = Math.min(1, S.availW / w, S.availH / h)
    await drawSVG(doc, drawing.svg, S.margin + (S.availW - w * k) / 2, S.margin + Math.max(0, S.availH - h * k) / 2, w * k, h * k)
    titleBlock(doc, S, info, design, what, k < 1 ? `${label} (reduced to fit)` : label, number, font)
  }
  if (S.split) {
    // two sheets at the sheet's scale (1/4" on 24 x 36, 1/8" on tabloid), the plan split where it overflows, 2 ft of overlap and a match line on each
    const lap = 24
    const rows = S.split === 'rows'
    const mid = rows ? plan.height / 2 : plan.width / 2
    const halves = rows
      ? [{ box: { x: 0, y: 0, w: plan.width, h: mid + lap }, match: { side: 's', at: mid, note: 'MATCH LINE · SEE SHEET A-201' } }, { box: { x: 0, y: mid - lap, w: plan.width, h: plan.height - mid + lap }, match: { side: 'n', at: mid, note: 'MATCH LINE · SEE SHEET A-200' } }]
      : [{ box: { x: 0, y: 0, w: mid + lap, h: plan.height }, match: { side: 'e', at: mid, note: 'MATCH LINE · SEE SHEET A-201' } }, { box: { x: mid - lap, y: 0, w: plan.width - mid + lap, h: plan.height }, match: { side: 'w', at: mid, note: 'MATCH LINE · SEE SHEET A-200' } }]
    for (let i = 0; i < halves.length; i++) {
      if (i) doc.addPage([Math.min(S.pageW, S.pageH), Math.max(S.pageW, S.pageH)], S.orientation)
      const { box, match } = halves[i]
      await place({ svg: cropSVG(plan.svg, box, match), width: box.w, height: box.h }, S.plan[0], `Floor plan (${i + 1} of 2)`, S.plan[1], i ? 'A-201' : 'A-200')
    }
  } else await place(plan, S.plan[0], 'Floor plan', S.plan[1], 'A-200')
  doc.addPage([Math.min(S.pageW, S.pageH), Math.max(S.pageW, S.pageH)], S.orientation)
  const siteScale = siteScaleFor(site, S)
  await place(site, siteScale[0], 'Site plan', siteScale[1], S.split ? 'A-100' : 'A-100')
  return doc
}

/** The homeowner's summary (letter portrait): the plan, the price range, the checks, what happens next. */
export async function summaryPDF(design, price, audit, trust, info = {}) {
  const { jsPDF } = await load()
  const doc = new jsPDF({ orientation: 'portrait', unit: 'in', format: 'letter', compress: true })
  const font = await useFont(doc)
  const ab = design.asBuilt || design.program || {}
  const M = 0.6
  const W = 8.5 - 2 * M
  let y = M
  const k = (n) => '$' + Math.round(n / 1000).toLocaleString() + 'k'
  const date = new Date(design.createdAt || Date.now()).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  doc.setTextColor(26, 26, 26)
  doc.setFont(font, 'bold')
  doc.setFontSize(20)
  doc.text(design.client || 'Your house', M, y + 0.28)
  y += 0.42
  doc.setFont(font, 'normal')
  doc.setFontSize(10)
  doc.setTextColor(85, 85, 85)
  doc.text(`${lotTitle(design)} · ${design.style?.name || ''} · ${ab.beds} bed, ${ab.baths}${ab.halfBath ? '.5' : ''} bath${ab.garage ? `, ${ab.garage}-car garage` : ''} · ${design.livingSf ? design.livingSf.toLocaleString() + ' sf' : ''} · ${date}`, M, y, { maxWidth: W })
  y += 0.25
  const plan = planSVG(design)
  const ph = Math.min(4.2, (W * plan.height) / plan.width)
  const pw = (ph * plan.width) / plan.height
  await drawSVG(doc, plan.svg, M + (W - pw) / 2, y, pw, ph)
  doc.setDrawColor(221, 221, 221)
  doc.rect(M + (W - pw) / 2, y, pw, ph)
  y += ph + 0.3
  const h2 = (t) => {
    doc.setFont(font, 'bold')
    doc.setFontSize(11)
    doc.setTextColor(26, 26, 26)
    doc.text(t.toUpperCase(), M, y)
    y += 0.22
  }
  h2('Price range')
  doc.setFontSize(20)
  doc.text(price ? `${k(price.low)}–${k(price.high)}` : '—', M, y + 0.1)
  y += 0.32
  doc.setFont(font, 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(85, 85, 85)
  if (price) {
    const garageRate = price.areas?.garage ? `garage $${Math.round(price.parts.garage[0] / price.areas.garage)}–${Math.round(price.parts.garage[1] / price.areas.garage)}/sf · ` : ''
    const line = `$${price.perSf[0]}–${price.perSf[1]}/sf living · ${garageRate}${price.county}. ${price.note}${price.confirmed ? '' : ' Rates to be confirmed by South Texas Builders.'}`
    const lines = doc.splitTextToSize(line, W)
    doc.text(lines, M, y)
    y += lines.length * 0.15 + 0.1
  }
  h2('Checked before you saw it')
  doc.setFontSize(9)
  const groups = audit?.groups || []
  // a check or a cross drawn in lines (Helvetica has no such glyphs), the name wrapped beside it
  groups.forEach((g) => {
    const ok = g.ok
    const warn = g.state === 'warn'
    doc.setDrawColor(ok ? (warn ? 176 : 42) : 179, ok ? (warn ? 120 : 122) : 38, ok ? (warn ? 20 : 59) : 30)
    doc.setLineWidth(0.015)
    if (ok) doc.lines([[0.05, 0.06], [0.1, -0.1]], M + 0.02, y - 0.09)
    else {
      doc.line(M + 0.02, y - 0.12, M + 0.14, y)
      doc.line(M + 0.14, y - 0.12, M + 0.02, y)
    }
    doc.setTextColor(ok ? (warn ? 140 : 42) : 179, ok ? (warn ? 95 : 122) : 38, ok ? (warn ? 10 : 59) : 30)
    const lines = doc.splitTextToSize(g.name + (warn ? ' (a note for the drafter)' : ''), W - 0.3)
    doc.text(lines, M + 0.24, y)
    y += lines.length * 0.15 + 0.03
  })
  y += 0.12
  // the rules this lot was drafted to (round 7, item 9): each with its source and status, the way the panel shows them
  const used = design.lot?.rulesUsed || []
  if (used.length) {
    if (y > 8.6) {
      doc.addPage()
      y = M
    }
    h2('Rules used for this lot')
    doc.setFontSize(8.5)
    doc.setFont(font, 'normal')
    doc.setTextColor(85, 85, 85)
    const head = `${design.lot?.jurisdiction?.name || design.lot?.cityName || ''}${design.lot?.zoning?.district ? ` · zoned ${design.lot.zoning.district}` : ''}${design.lot?.flood?.zone ? ` · FEMA zone ${design.lot.flood.zone}` : design.lot?.flood?.status === 'no-digital-firm' ? ' · no digital FEMA map here' : ''}. A drafter confirms every line before anything is built.`
    const hl = doc.splitTextToSize(head, W)
    doc.text(hl, M, y)
    y += hl.length * 0.14 + 0.06
    const rows = used.filter((u) => ['front', 'side', 'rear', 'streetSide', 'garageFt', 'maxCoverage', 'maxHeightFt', 'minLotSf', 'district', 'irc', 'windstorm', 'wind'].includes(u.id))
    rows.forEach((u) => {
      if (y > 10.1) {
        doc.addPage()
        y = M
      }
      const status = u.status === 'verified' ? (u.stale ? 'city code, re-check due' : 'city code') : u.status === 'summary' ? 'summary, office confirms' : 'unknown, confirm with city'
      doc.setFont(font, 'bold')
      doc.setTextColor(26, 26, 26)
      doc.text(String(u.label || u.id), M, y)
      doc.setFont(font, 'normal')
      doc.text(String(u.value ?? ''), M + 1.5, y, { maxWidth: 1.7 })
      doc.setTextColor(85, 85, 85)
      const src = doc.splitTextToSize(`${status}${u.source ? ` · ${u.source}` : ''}${u.checkedAt ? ` · ${u.checkedAt}` : ''}`, W - 3.4)
      doc.text(src, M + 3.4, y)
      y += Math.max(1, src.length) * 0.14 + 0.04
    })
    ;(design.lot?.ruleNotes || []).forEach((n) => {
      const l = doc.splitTextToSize(n, W)
      doc.text(l, M, y)
      y += l.length * 0.14 + 0.02
    })
    y += 0.12
  }
  if (y > 9.4) {
    doc.addPage()
    y = M
  }
  h2('What happens next')
  doc.setFontSize(10)
  ;(trust?.next || []).forEach((n, i) => {
    doc.setFont(font, 'bold')
    doc.setTextColor(26, 26, 26)
    doc.text(`${i + 1}. ${n.when}`, M, y)
    doc.setFont(font, 'normal')
    const lines = doc.splitTextToSize(String(n.what), W - 2.1)
    doc.text(lines, M + 2.1, y)
    y += lines.length * 0.16 + 0.06
  })
  const fy = 11 - M
  doc.setDrawColor(26, 26, 26)
  doc.line(M, fy - 0.2, 8.5 - M, fy - 0.2)
  doc.setFontSize(8.5)
  doc.setTextColor(85, 85, 85)
  doc.text(`${info.firm || 'South Texas Builders'} · ${info.phone || ''}`, M, fy)
  doc.text('preliminary, not for construction', 8.5 - M, fy, { align: 'right' })
  return doc
}

/** A file name a client recognises: "Garza floor plan 24x36.pdf". */
export const pdfName = (design, what) => `${(design.client || 'Draft House').replace(/[^\w .-]+/g, '')} ${what}.pdf`
