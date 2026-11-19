// The homeowner's steps in the address bar (round 13, item 2). Each step has its own address, so the browser's
// Back and Forward move between the homeowner's own steps and a reload opens the step that was on screen.
//   #/            the first screen
//   #/lot         the lot, before one is taken
//   #/style/<id>  a step of a saved house (the id is the house's)
// The office's pages keep their own addresses and are never part of a homeowner's history.

export const STEP_NAMES = ['', 'lot', 'style', 'rooms', 'draft', 'send']
export const OFFICE_ROUTES = ['#/admin', '#/review', '#/office', '#/drafter', '#/lot514']

/** The address of a step; a saved house's id rides along from the lot step on. */
export function stepHash(step, id) {
  const name = STEP_NAMES[step] || ''
  return '#/' + name + (name && id ? '/' + id : '')
}

/** What an address means: an office page, or a homeowner step (0 for anything unknown) with a house id if it carries one. */
export function readHash(hash) {
  const h = String(hash || '')
  if (OFFICE_ROUTES.includes(h)) return { office: h.slice(2), step: 0, id: null }
  const m = h.match(/^#\/(lot|style|rooms|draft|send)(?:\/([A-Za-z0-9_-]{1,64}))?$/)
  if (!m) return { office: null, step: 0, id: null }
  return { office: null, step: STEP_NAMES.indexOf(m[1]), id: m[2] || null }
}

/**
 * The step to show when the address asks for `want`: never past what there is to show (no rooms step without a
 * lot, no draft without rooms), and a plan already with the drafters stays on its last step.
 */
export function reach(want, has = {}) {
  const w = Number.isInteger(want) && want >= 0 && want <= 5 ? want : 0
  if (has.rooms && has.locked) return w === 0 ? 0 : 5
  let max = 0
  if (has.intake || has.lot) max = 1
  if (has.lot) max = 2
  if (has.lot && has.style) max = 3
  if (has.lot && has.style && has.rooms) max = 5
  return Math.min(w, max)
}

const TAB_KEY = 'drafthouse.tab'
/** What this tab holds before a house is saved (no account, or no lot taken yet), kept so a reload does not lose it. */
export function saveTab(state) {
  try {
    if (!state) sessionStorage.removeItem(TAB_KEY)
    else sessionStorage.setItem(TAB_KEY, JSON.stringify(state))
  } catch {
    /* private window or storage full: the tab simply does not survive a reload */
  }
}
export function loadTab() {
  try {
    const s = JSON.parse(sessionStorage.getItem(TAB_KEY) || 'null')
    return s && typeof s === 'object' ? s : null
  } catch {
    return null
  }
}
