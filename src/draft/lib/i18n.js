// English and Spanish for the homeowner's screens (round 13, item 1).
//
// How it works:
//  - The English sentence is the key: `t('Find my lot')`. In English `t` gives the key back, so the English a
//    homeowner reads is exactly what is written in the screen, and every test that pins it keeps passing.
//    In Spanish `t` looks the sentence up in `es` (i18n-es.js); a sentence missing there falls back to English
//    (test/round13-i18n.test.mjs fails when a screen uses one that is missing).
//  - `{name}` is filled from the params; `{n|change|changes}` picks the first form when n is 1, the second otherwise.
//  - `rich(...)` is `t` for a sentence with a bold word or a link in it: params may be React nodes, `<b>…</b>` is bold.
//  - The language is the homeowner's choice when they tapped the switch (remembered on the device), else the
//    browser's: Spanish when it starts with "es", English otherwise. The office screens are always English.
//  - `sentence(text, lang)` is for the sentences the plan code writes (chat replies, rule reasons, notes from the
//    office API). ONE place below plugs in `toSpanish` from ./es.js when that file lands.
import { createElement, Fragment, useEffect, useState, useSyncExternalStore } from 'react'
import { toSpanish } from './es.js'
import { plainReason } from './plain.js'
import { es } from './i18n-es.js'

export { es }
/** The English side: every sentence is its own key, so it is exactly the keys of `es`. */
export const en = Object.fromEntries(Object.keys(es).map((k) => [k, k]))

export const LANGS = ['en', 'es']
export const LANG_KEY = 'dh.lang'

const storage = () => {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    return null
  }
}

/** Spanish when the browser's first language starts with "es" (es, es-MX, es-US, es-419), English otherwise. */
export function detectLang(nav = typeof navigator !== 'undefined' ? navigator : null) {
  const first = nav ? (Array.isArray(nav.languages) && nav.languages.length ? nav.languages[0] : nav.language) : ''
  return /^es\b/i.test(String(first || '')) ? 'es' : 'en'
}

/** The language the homeowner chose with the switch on this device, or null. */
export function rememberedLang(store = storage()) {
  try {
    const v = store?.getItem(LANG_KEY)
    return LANGS.includes(v) ? v : null
  } catch {
    return null
  }
}

/** Keeps the choice on this device; a private window that refuses just keeps it for the page. */
export function rememberLang(lang, store = storage()) {
  try {
    store?.setItem(LANG_KEY, lang)
  } catch {
    /* the choice lasts the page */
  }
}

/** The language to open in: the remembered choice wins over the browser. */
export const initialLang = (nav, store) => rememberedLang(store) || detectLang(nav)

// ── the words ────────────────────────────────────────────────────────────────────────────────────────

const PLURAL = /\{(\w+)\|([^|{}]*)\|([^|{}]*)\}/g
const NAME = /\{(\w+)\}/g
const isOne = (v) => Number(String(v).replace(/,/g, '')) === 1

/** A param that is itself a sentence to translate: { $t: 'the garage' }. */
const paramText = (lang, v) => (v && typeof v === 'object' && typeof v.$t === 'string' ? translate(lang, v.$t, v.params) : v)

function fill(lang, template, params) {
  if (!params) return template.replace(PLURAL, (m, k, one, many) => many)
  return template
    .replace(PLURAL, (m, k, one, many) => (isOne(paramText(lang, params[k])) ? one : many))
    .replace(NAME, (m, k) => (params[k] === undefined || params[k] === null ? (k in params ? '' : m) : String(paramText(lang, params[k]))))
}

/** The sentence in `lang`, with its params filled in. Anything that is not a string comes back as it is. */
export function translate(lang, text, params) {
  if (typeof text !== 'string') return text
  const template = lang === 'es' && Object.prototype.hasOwnProperty.call(es, text) ? es[text] : text
  return /[{]/.test(template) ? fill(lang, template, params) : template
}

/**
 * Marks a sentence that is written where `t` cannot be called (a list at the top of a file, a default) and is
 * handed to `t` where it is drawn: `const EXTRAS = [['office', phrase('Office')]]` … `{t(label)}`. It gives the
 * sentence back unchanged; the test that reads the screens checks the Spanish dictionary has it.
 */
export const phrase = (text) => text

/** `translate` for a sentence with React nodes in it: a list of strings and nodes, `<b>…</b>` made bold. */
export function translateRich(lang, text, params = {}) {
  const template = (lang === 'es' && Object.prototype.hasOwnProperty.call(es, text) ? es[text] : text).replace(PLURAL, (m, k, one, many) => (isOne(params[k]) ? one : many))
  const out = []
  let bold = null
  const push = (v) => (bold ? bold.push(v) : out.push(v))
  template.split(/(\{\w+\}|<b>|<\/b>)/).forEach((part, i) => {
    if (part === '') return
    if (part === '<b>') bold = []
    else if (part === '</b>') {
      const inner = bold || []
      bold = null
      out.push(createElement('b', { key: 'b' + i }, ...inner))
    } else if (/^\{\w+\}$/.test(part)) {
      const k = part.slice(1, -1)
      const v = k in params ? paramText(lang, params[k]) : part
      push(v !== null && typeof v === 'object' ? createElement(Fragment, { key: 'p' + i }, v) : v === null || v === undefined ? '' : String(v))
    } else push(part)
  })
  return out
}

// ── sentences the plan code writes ───────────────────────────────────────────────────────────────────

// The sentences the plan code writes (chat replies, rule and fit reasons, button labels) are put into Spanish by
// lib/es.js. A sentence it has no words for is left as written; Spanish that the office already sent stays as it is.
const planSentence = (text) => {
  try {
    return toSpanish(text)
  } catch {
    return text
  }
}

/**
 * A sentence written by the plan code, the rules or the office API, in the homeowner's language. English comes
 * back unchanged. In Spanish: a sentence the dictionary has word for word is taken from it; the rest goes to
 * `toSpanish` (see above), which today leaves it as it is.
 */
export function sentence(text, lang) {
  if (lang !== 'es' || typeof text !== 'string' || !text) return text
  if (Object.prototype.hasOwnProperty.call(es, text) && !/[{]/.test(text)) return es[text]
  return planSentence(text)
}

/**
 * A chat line the screens write themselves: `says(['Back to version {n}.', { n: 2 }], [...])` gives
 * { text, i18n }. `text` is the English line exactly as before (what the drafter's package and the tests read);
 * `i18n` lets the chat show it in the language chosen now, even after the homeowner taps the switch.
 */
export function says(...parts) {
  const list = parts.filter(Boolean)
  return { text: list.map(([k, p]) => translate('en', k, p)).join(' '), i18n: list }
}

/** What a chat line from the house says in `lang`: its own parts when it has them, else the plan's sentence. */
export function houseText(m, lang) {
  if (lang !== 'en' && Array.isArray(m?.i18n) && m.i18n.length) return plainReason(m.i18n.map(([k, p]) => translate(lang, k, p)).join(' '))
  return sentence(plainReason(m?.text), lang)
}

// ── words that come from the plan's data ─────────────────────────────────────────────────────────────

/** "Hidalgo County" → "Condado de Hidalgo"; "Hidalgo County (unincorporated)" → "Condado de Hidalgo (fuera de la ciudad)". */
export function placeName(name, lang) {
  if (lang !== 'es' || typeof name !== 'string') return name
  return name.replace(/^(.+?) County( \(unincorporated\))?$/, (m, c, u) => `Condado de ${c}${u ? ' (fuera de los límites de la ciudad)' : ''}`)
}

/** A room's name from the kit ("Bedroom 2", "Primary Bath") in the homeowner's language. */
export function roomName(name, lang) {
  if (lang !== 'es' || typeof name !== 'string') return name
  if (Object.prototype.hasOwnProperty.call(es, name)) return es[name]
  const g = name.match(/^(\d)-Car Garage( \(tandem\))?$/)
  if (g) return `Cochera para ${g[1]} ${isOne(g[1]) ? 'carro' : 'carros'}${g[2] ? ' (en fila)' : ''}`
  const m = name.match(/^(.*\S)\s+(\d+)$/)
  return m && Object.prototype.hasOwnProperty.call(es, m[1]) ? `${es[m[1]]} ${m[2]}` : name
}

/** "4 bed · 3.5 bath · 2-car · 1 story" in Spanish (layout.js `programLine` writes the English one). */
export function programLineEs(p, sep = ' · ', { tandemShort = false, stories = true } = {}) {
  const baths = `${p.baths}${p.halfBaths > 1 ? `.${p.halfBaths}` : p.halfBath ? '.5' : ''}`
  const n = (count, one, many) => `${count} ${isOne(count) ? one : many}`
  return [
    `${n(p.beds, 'recámara', 'recámaras')}${p.flex ? ` + ${n(p.flex, 'cuarto flexible', 'cuartos flexibles')}` : ''}`,
    n(baths, 'baño', 'baños'),
    p.garage ? `cochera para ${n(p.garage, 'carro', 'carros')}${p.tandem ? (tandemShort ? ' en fila' : ' (en fila: un espacio para dos carros, uno detrás del otro)') : ''}` : null,
    stories && p.stories ? n(p.stories, 'piso', 'pisos') : '',
  ]
    .filter(Boolean)
    .join(sep)
}

// The office's short notes beside a rule ("county default; unknown, confirm with city", "20 on a cul-de-sac") and
// the lines under the table ("rear 14 ft = 10% of 140 ft depth (at least 9, at most 15)"): a small set of phrases
// from lib/jurisdictions.js and lib/lot.js, said in Spanish here. A note this list does not know goes on to the
// plan's sentences (`sentence`), so nothing is lost.
const RULE_NAMES_ES = { front: 'Hacia la calle', side: 'A cada lado', rear: 'Al fondo', streetSide: 'Hacia una calle lateral', garageFt: 'De la puerta de la cochera a la calle', maxCoverage: 'Cuánto del lote puede cubrir una casa', maxHeightFt: 'Altura máxima', minLotSf: 'Área mínima del lote', minLotWidth: 'Ancho mínimo del lote' }
const NOTE_PHRASES_ES = [
  [/unknown, confirm with city \(county default used\)/g, 'no se sabe; confirmar con la ciudad (se usa el valor del condado)'],
  [/county default; unknown, confirm with city/g, 'lo que usa el condado; no se sabe, confirmar con la ciudad'],
  [/unknown, confirm with city/g, 'no se sabe; confirmar con la ciudad'],
  [/county subdivision rules/g, 'reglas de subdivisión del condado'],
  [/\bnew UDO\b/g, 'código nuevo, UDO'],
  [/(\d+) on a cul-de-sac or irregular lot/g, '$1 en una calle cerrada (cul-de-sac) o en un lote irregular'],
  [/(\d+) on a cul-de-sac/g, '$1 en una calle cerrada (cul-de-sac)'],
  [/(\d+) on an arterial or collector/g, '$1 sobre una arteria o una calle colectora'],
  [/minor arterial/g, 'arteria menor'],
  [/major arterial/g, 'arteria mayor'],
  [/\barterial\b/g, 'arteria'],
  [/\bcollector\b/g, 'calle colectora'],
  [/cul-de-sac (\d+)/g, 'calle cerrada $1'],
  [/side-entry garages exempt/g, 'no aplica a las cocheras con entrada por un lado'],
  [/including accessory buildings/g, 'contando las construcciones secundarias'],
  [/open space at least (\d+%)/g, 'por lo menos $1 de espacio abierto'],
  [/\+1 ft of (setback|space the city keeps open) per ft above (\d+)/g, '1 pie más de espacio libre por cada pie de altura arriba de $2'],
  [/\bcorner ([\d,]+)/g, 'de esquina $1'],
  [/(\d+) if the lot is (\d+) ft or narrower; (\d+) if (\d+) ft or narrower/g, '$1 si el lote mide $2 pies de ancho o menos; $3 si mide $4 pies o menos'],
  [/or per the plat/g, 'o lo que diga el plat'],
  [/(\d+) ft total/g, '$1 pies en total'],
  [/^adopted (\d{4})$/, 'adoptado en $1'],
  [/, adopted ([A-Z][a-z]+ \d+, \d{4})/g, ', adoptada: $1'],
  [/ with amendments/g, ' con enmiendas'],
  [/PE-designed structure required/g, 'se requiere estructura diseñada por un ingeniero (PE)'],
  [/engineered sealed windstorm plan required/g, 'se requiere plano de viento sellado por un ingeniero'],
  [/Municode’s "2000 IRC" is a stale codification/g, 'el «2000 IRC» de Municode es una versión vieja del código'],
  [/IRC per LGC/g, 'IRC según LGC'],
  [/edition not stated/g, 'sin indicar la edición'],
  [/= half the (\d+) ft right of way \(ROW unknown: (\d+) ft assumed, confirm\), at most (\d+)/g, '= la mitad de los $1 pies del derecho de vía (no se sabe el derecho de vía: se suponen $2 pies, por confirmar), máximo $3'],
  [/= half the (\d+) ft right of way/g, '= la mitad de los $1 pies del derecho de vía'],
  [/= the lesser of ([\d.]+) ft and (\d+%) of ([\d.]+) ft (width|depth)/g, (m, a, pct, x, side) => `= lo que sea menor entre ${a} pies y el ${pct} de los ${x} pies de ${side === 'width' ? 'ancho' : 'fondo'}`],
  [/= (\d+%) of ([\d.]+) ft (width|depth)/g, (m, pct, x, side) => `= el ${pct} de los ${x} pies de ${side === 'width' ? 'ancho' : 'fondo'}`],
  [/at least ([\d.]+), at most ([\d.]+)/g, 'mínimo $1, máximo $2'],
  [/, at most ([\d.]+)/g, ', máximo $1'],
  [/lot of record under the ([\d.]+) ft minimum/g, 'lote registrado antes de las reglas de hoy, por debajo del mínimo de $1 pies'],
  [/^narrow lot of record$/, 'lote angosto, registrado antes de las reglas de hoy'],
  [/^below today's minimum lot size \(([\d,]+) sf, the district asks ([\d,]+) sf\)/, 'más chico que el mínimo de hoy ($1 pies²; la zona pide $2 pies²)'],
  [/^below today's minimum lot width \(([\d.]+) ft, the district asks ([\d.]+) ft\)/, 'más angosto que el mínimo de hoy ($1 pies; la zona pide $2 pies)'],
  [/; lots of record usually still build\. The drafter confirms\./, '; en los lotes ya registrados por lo general sí se puede construir. El dibujante lo confirma.'],
  [/^code change pending$/, 'hay un cambio de código en trámite'],
  [/^code just changed, re-check$/, 'el código acaba de cambiar; hay que volver a revisar'],
  [/([\d,.]+) sf\b/g, '$1 pies²'],
  [/([\d,.]+) ft\b/g, '$1 pies'],
]
/** A note or a flag of the rules panel in the homeowner's language; English comes back unchanged. */
export function ruleNote(text, lang) {
  if (lang !== 'es' || typeof text !== 'string' || !text) return text
  if (Object.prototype.hasOwnProperty.call(es, text) && !/[{]/.test(text)) return es[text]
  // "garageFt 18 ft: …", "rear: unknown, …": the rule by the name a homeowner would use
  let out = text.replace(/^(front|side|rear|streetSide|garageFt|maxCoverage|maxHeightFt|minLotSf|minLotWidth)\b( [\d.]+ ft)?(:| =)/, (m, id, n, sep) => `${RULE_NAMES_ES[id]}${n ? `,${n}` : ''}${sep}`)
  for (const [re, to] of NOTE_PHRASES_ES) out = out.replace(re, to)
  return out === text ? sentence(text, lang) : out
}

/** A value in the rules panel ("20 ft", "9,000 sf", "yes (TDI catastrophe area)") in the homeowner's language. */
export function ruleValue(value, lang) {
  if (lang !== 'es' || typeof value !== 'string') return value
  if (Object.prototype.hasOwnProperty.call(es, value)) return es[value]
  // "20 ft (corner lots 25)": the number in Spanish, the office's note beside it through the notes above
  const m = value.match(/^([\d,.]+) (ft|sf)( \((.+)\))?$/)
  if (m) return `${m[1]} ${m[2] === 'ft' ? 'pies' : 'pies²'}${m[4] ? ` (${ruleNote(m[4], lang)})` : ''}`
  const pct = value.match(/^(\d+%) \((.+)\)$/)
  if (pct) return `${pct[1]} (${ruleNote(pct[2], lang)})`
  const noted = value.match(/^([^()]+) \((.+)\)$/)
  if (noted) return `${ruleNote(noted[1], lang)} (${ruleNote(noted[2], lang)})`
  return ruleNote(value, lang)
}

/** An option in the chat's picker ("2-car, side-load", "Rear porch 12 ft deep") in the homeowner's language. */
export function optionLabel(label, lang) {
  if (lang !== 'es' || typeof label !== 'string') return label
  if (Object.prototype.hasOwnProperty.call(es, label)) return es[label]
  const car = (c) => `${c} ${isOne(c) ? 'carro' : 'carros'}`
  const rules = [
    [/^(\d)-car, side-load$/, (m) => `Para ${car(m[1])}, entrada por un lado`],
    [/^(\d)-car, front-load$/, (m) => `Para ${car(m[1])}, entrada por el frente`],
    [/^(\d)-car garage \(new draft\)$/, (m) => `Cochera para ${car(m[1])} (plano nuevo)`],
    [/^(\d)-car garage$/, (m) => `Cochera para ${car(m[1])}`],
    [/^Re-draft with a (\d)-car garage$/, (m) => `Dibujar de nuevo con cochera para ${car(m[1])}`],
    [/^Rear porch,? (\d+) ft deep$/, (m) => `Porche de atrás de ${m[1]} pies de fondo`],
    [/^Front porch,? (deeper, )?(\d+) ft deep$/, (m) => `Porche del frente${m[1] ? ' más profundo,' : ''} de ${m[2]} pies de fondo`],
    [/^(.+) 2 ft deeper$/, (m) => `${roomName(m[1], lang)} 2 pies más de fondo`],
  ]
  for (const [re, write] of rules) {
    const m = label.match(re)
    if (m) return write(m)
  }
  return sentence(label, lang)
}

/** The words drawn on the ground of the 3D lot ("SCALE IN FEET", "25' — REAR") in the homeowner's language. */
export function groundWords(text, lang) {
  if (lang !== 'es' || typeof text !== 'string') return text
  if (Object.prototype.hasOwnProperty.call(es, text)) return es[text]
  return text
    .replace(/(' — )SIDE$/, '$1LADO')
    .replace(/(' — )REAR$/, '$1FONDO')
    .replace(/(' — )FRONT$/, '$1FRENTE')
    .replace(/ SF · /, ' PIES² · ')
}

// ── the language on this device ──────────────────────────────────────────────────────────────────────

// one language for the whole page: `chosen` is the homeowner's (the switch, else the browser); `forced` is set on
// the office screens, which are English whatever the browser says
const state = { chosen: null, forced: null }
const listeners = new Set()
const emit = () => listeners.forEach((fn) => fn())
const subscribe = (fn) => (listeners.add(fn), () => listeners.delete(fn))
/** The language the page reads in right now. */
export const currentLang = () => state.forced || (state.chosen ??= initialLang())

/** The homeowner's own language (the switch, else the browser), whatever screen is open. */
export const homeownerLang = () => (state.chosen ??= initialLang())
/**
 * Called while the app draws, before `useLang()`: the office screens are English whatever the browser says
 * (`forceLang('en')`), the homeowner's screens follow the homeowner (`forceLang(null)`).
 */
export function forceLang(lang) {
  const want = LANGS.includes(lang) ? lang : null
  if (state.forced !== want) state.forced = want
}

/** The homeowner taps the switch: the page changes at once and the choice is remembered on this device. */
export function setLang(lang) {
  if (!LANGS.includes(lang)) return
  state.chosen = lang
  rememberLang(lang)
  emit()
}

const bundles = {}
/** Everything a screen needs in one language: { lang, setLang, t, rich, say, sf }. */
export function wordsFor(lang) {
  return (bundles[lang] ||= {
    lang,
    setLang,
    t: (text, params) => translate(lang, text, params),
    rich: (text, params) => translateRich(lang, text, params),
    /** a sentence the plan code or the office wrote */
    say: (text) => sentence(text, lang),
    /** "1,950 sf" · "1,950 pies²" */
    sf: (n) => Math.round(n).toLocaleString() + (lang === 'es' ? ' pies²' : ' sf'),
  })
}
/** The English words, for code that runs outside a screen (the default of every `words` parameter). */
export const EN = wordsFor('en')

/** `const { lang, setLang, t } = useLang()`: the language of the page and its words; the screen redraws when it changes. */
export function useLang() {
  const lang = useSyncExternalStore(subscribe, currentLang, () => 'en')
  return wordsFor(lang)
}

/**
 * Mounted once around the app. `force="en"` on the office screens (they are English only). Keeps `<html lang>`
 * in step with the page, so a screen reader and the browser's own translate button know what they are reading.
 */
export function LangProvider({ force = null, children }) {
  const want = LANGS.includes(force) ? force : null
  // set while rendering, so the screens below read the right language on their first draw
  forceLang(want)
  const { lang } = useLang()
  useEffect(() => {
    emit() // a screen drawn before the office route was entered or left
  }, [want])
  useEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.lang = lang
  }, [lang])
  return children
}

function usePhone() {
  const query = '(max-width: 600px)'
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(query).matches)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia(query)
    const on = () => setPhone(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return phone
}

/**
 * The ES/EN switch: one button, the language in use is the dark half, a tap changes to the other one.
 * `place="head"` sits in the header; on a phone with someone signed in (`tucked`) it leaves the header, where
 * there is no room, and `place="menu"` shows it inside the account menu. Exactly one is on the page at a time.
 * Not shown on the office screens.
 */
export function LangSwitch({ place = 'head', tucked = false }) {
  const { lang } = useLang()
  const phone = usePhone()
  if (state.forced) return null
  if (place === 'menu' ? !phone : phone && tucked) return null
  const other = lang === 'es' ? 'en' : 'es'
  // said in the language it changes to, so the person who needs it can read it
  const label = other === 'en' ? 'Switch to English' : 'Cambiar a español'
  return createElement(
    'button',
    { type: 'button', className: 'lang-switch' + (place === 'menu' ? ' in-menu' : ''), 'data-testid': 'lang-switch', 'data-lang': lang, 'aria-label': label, title: label, onClick: () => setLang(other) },
    createElement('span', { className: lang === 'es' ? 'on' : '', lang: 'es' }, 'ES'),
    createElement('span', { className: lang === 'en' ? 'on' : '', lang: 'en' }, 'EN'),
  )
}
