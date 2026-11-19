// What "nothing clipped or overlapping" means on a phone, as checks a browser can run (round 13, item 3).
// `phoneAudit` runs inside the page and returns a list of plain findings; an empty list is a clean screen.
export function phoneAudit() {
  const vw = document.documentElement.clientWidth
  const vh = window.innerHeight
  const out = []
  const shown = (el) => {
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) return false
    // inside a closed <details>, or otherwise not drawn
    if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, contentVisibilityAuto: true })) return false
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n)
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) return false
    }
    return true
  }
  const label = (el) => `<${el.tagName.toLowerCase()}${el.getAttribute('data-testid') ? ' ' + el.getAttribute('data-testid') : el.id ? ' #' + el.id : el.className && typeof el.className === 'string' ? ' .' + el.className.split(' ')[0] : ''}> "${(el.innerText || el.value || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 44)}"`
  // inside something that scrolls sideways on purpose (a row of chips, the plan), sticking out is not a fault
  const scrollsSideways = (el) => {
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n)
      if (/(auto|scroll)/.test(cs.overflowX) || (cs.overflowX === 'hidden' && n.matches('.viewport, .plan-frame, .scene, canvas, svg'))) return true
    }
    return false
  }
  const fixedOver = (el) => {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) if (/(fixed|sticky)/.test(getComputedStyle(n).position)) return true
    return false
  }
  // the part of an element that is on the screen: its box, cut by every scrolling box it sits in
  const seen = (el) => {
    const r = el.getBoundingClientRect()
    const box = { left: r.left, right: r.right, top: r.top, bottom: r.bottom }
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n)
      if (!/(auto|scroll|hidden)/.test(cs.overflowY + cs.overflowX)) continue
      const b = n.getBoundingClientRect()
      box.left = Math.max(box.left, b.left)
      box.right = Math.min(box.right, b.right)
      box.top = Math.max(box.top, b.top)
      box.bottom = Math.min(box.bottom, b.bottom)
    }
    return box
  }
  // 1. the page is no wider than the screen
  if (document.documentElement.scrollWidth > vw + 1) out.push(`the page is ${document.documentElement.scrollWidth}px wide on a ${vw}px screen`)
  const all = [...document.querySelectorAll('body *')].filter((el) => !el.closest('svg, canvas') && shown(el))
  for (const el of all) {
    const r = el.getBoundingClientRect()
    // 2. nothing sticks out of the screen to the left or right
    if ((r.right > vw + 1 || r.left < -1) && !scrollsSideways(el) && el.children.length === 0) out.push(`off the side of the screen: ${label(el)} (${Math.round(r.left)} to ${Math.round(r.right)})`)
    // 3. words cut off inside their own box
    const cs = getComputedStyle(el)
    const text = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
    if (text && (cs.overflowX !== 'visible' || cs.textOverflow === 'ellipsis') && el.scrollWidth > el.clientWidth + 1) out.push(`words cut off: ${label(el)} (${el.scrollWidth}px of words in ${el.clientWidth}px)`)
    if (text && cs.overflowY === 'hidden' && el.scrollHeight > el.clientHeight + 2 && !/(auto|scroll)/.test(cs.overflowY)) out.push(`words cut off below: ${label(el)}`)
  }
  // 3b. nothing is cut off above the top of a box that is scrolled all the way up (no scrolling can bring it back)
  for (const box of document.querySelectorAll('.dh-main, .screen, .start, .side')) {
    const cs = getComputedStyle(box)
    if (!/(auto|scroll)/.test(cs.overflowY) || box.scrollTop > 0) continue
    const b = box.getBoundingClientRect()
    for (const el of box.querySelectorAll('h1, h2, h3, p, button, input, .card, svg, img')) {
      if (!shown(el)) continue
      const r = el.getBoundingClientRect()
      if (r.top < b.top - 2) {
        out.push(`cut off above the top of the screen: ${label(el)} starts ${Math.round(b.top - r.top)}px above where the page begins`)
        break
      }
    }
  }
  // 4. a control on the screen is not under something else (content under the fixed header is the page scrolling, not a fault)
  const controls = [...document.querySelectorAll('button, a[href], input, select, textarea, summary, [role="button"]')].filter(shown)
  for (const el of controls) {
    const r = el.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    if (cx < 0 || cx > vw || cy < 0 || cy > vh) continue
    // scrolled out of its own scrolling box: not on the screen at all
    let clipped = false
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      if (!/(auto|scroll|hidden)/.test(getComputedStyle(n).overflowY)) continue
      const b = n.getBoundingClientRect()
      if (cy < b.top || cy > b.bottom) clipped = true
    }
    if (clipped) continue
    const top = document.elementFromPoint(cx, cy)
    if (!top || top === el || el.contains(top) || top.contains(el)) continue
    if (fixedOver(top) && !fixedOver(el)) continue
    if (top.closest('label') && top.closest('label').contains(el)) continue
    out.push(`covered: ${label(el)} is under ${label(top)}`)
  }
  // 5. two controls do not share the same patch of screen
  for (let i = 0; i < controls.length; i++) {
    for (let j = i + 1; j < controls.length; j++) {
      const a = controls[i]
      const b = controls[j]
      if (a.contains(b) || b.contains(a)) continue
      if (fixedOver(a) !== fixedOver(b)) continue
      const p = seen(a)
      const q = seen(b)
      const w = Math.min(p.right, q.right) - Math.max(p.left, q.left)
      const h = Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top)
      if (w > 2 && h > 2) out.push(`overlapping: ${label(a)} and ${label(b)} share ${Math.round(w)} x ${Math.round(h)}px`)
    }
  }
  // 6. a button is big enough for a thumb, and has air around it
  for (const el of controls) {
    if (!el.matches('button, [role="button"], a.btn, summary')) continue
    const r = el.getBoundingClientRect()
    if (r.height < 40 && !el.matches('.linkish, .linkish *, .stepper-ctl button, .dh-account > summary')) out.push(`too small to tap: ${label(el)} is ${Math.round(r.height)}px tall`)
  }
  return [...new Set(out)]
}
