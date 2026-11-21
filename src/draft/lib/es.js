// Spanish for the chat (round 13). Three things live here, and nothing else imports into this file:
//   isSpanish(text)    is this request written in Spanish? (casual Rio Grande Valley Spanish, accents or not)
//   fromSpanish(text)  a Spanish request as the request the basic rules already read ("quiero 3 recámaras" →
//                      "3 bedrooms"), clause by clause, with each clause's own words kept so a reply can quote them
//   toSpanish(text)    any sentence the plan code writes for a homeowner (chat replies, refusals, button labels,
//                      rule reasons as plain.js words them, fit messages) in Spanish
// The plan code keeps writing English from its finite set of templates; the office log stays English. A homeowner
// who writes Spanish, or whose screen is in Spanish, reads toSpanish() of it. Feet stay feet ("pies"), sf is
// "pies²", and the space the city keeps open along the edges of the lot is said that way, never as a trade word.

// ── reading Spanish ──────────────────────────────────────────────────────────────────────────────────────────
/** One character with its accent taken off, lower case: á → a, ñ → n, ¿ → space. Always one character back. */
function fold1(ch) {
  if (ch === '¿' || ch === '¡') return ' '
  const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  return base.length === 1 ? base : ch.length === 1 ? ch.toLowerCase() : ' '
}
/** A text folded for matching, and its characters (same count), so a match can be cut out of the original. */
function folded(text) {
  const chars = [...String(text ?? '').normalize('NFC')]
  return { chars, f: chars.map(fold1).join('') }
}
export const fold = (text) => folded(text).f

const ES_STRONG = /\b(?:no se|nose|no lo se|agrand\w+|achic\w+|ensanch\w+|alarg\w+|quiero|quisiera|queremos|necesit[oa]\w*|ocup[oa]\w*|agreg\w+|anad\w+|ponle|ponme|ponga\w*|quit[ae]\w*|elimin\w+|borr[ae]\w*|haz\w*|hag[ao]\w*|deshaz\w*|deshac\w+|regres\w+|vuelv\w+|volver|co[cs]ina|re[cs]amar\w*|recamr\w+|h?abitaci?on(?:es)?|dormitorios?|cuart(?:o|os|ito|itos)|[bv]anos?|sala|comedor|cochera|garaje|ofi[cs]ina|lavanderia|despensa|porche|portico|techad[oa]|pasillo|casa|carros?|coches?|grandes?|chi(?:c|qu)[oa]s?|chiquit[oa]s?|pequen[oa]s?|anch[oa]|larg[oa]|mas|menos|cuant[oa]s?|cuesta|precio|costo|abiert[oa]|atras|adelante|enfrente|junto|lado|cambi[oae]\w*|muev\w+|mover|pared(?:es)?|techos?|pisos?|segundo|alberca|piscina|sotano|hola|gracias|estaba|dibuj\w+|hacer|dejar\w*|pedir|mejor|bonit[oa]|entiendo|nada|esto|eso|esa|ese|tambien|ahora|toda|muy|quede|sienta|ultimo|anterior|pero|donde|porque|usted|puede|puedo|pies)\b/
const ES_WEAK = /\b(?:la|el|los|las|un|una|unos|unas|de|del|al|que|con|sin|para|por|y|es|se|lo|mi|su|en|le|ya|mis|sus)\b/g
/** True when a request (or a button's label) is written in Spanish. English requests never are. */
export function isSpanish(text) {
  const raw = String(text ?? '')
  if (!raw.trim()) return false
  if (/[áéíóúñ¿¡]/i.test(raw)) return true
  const f = fold(raw)
  if (ES_STRONG.test(f)) return true
  return new Set(f.match(ES_WEAK) || []).size >= 2
}

// the rooms a homeowner names, most specific first: [pattern on the folded text, the English the basic rules read]
const BED = String.raw`(?:re[cs]amar[ae]?|recamra|cuarto|h?abitaci?on|dormitorio|alcoba)`
const BATH = String.raw`(?:[bv]ano|[bv]anio)`
const PORCH = String.raw`(?:porche|portico|porch|terraza|corredor)`
const ROOM_WORDS = [
  [String.raw`${BATH} (?:principal|master|de la (?:${BED} )?principal)`, 'primary bath'],
  [String.raw`(?:closet|vestidor|ropero|guardarropa) (?:principal|master|de la (?:${BED} )?principal)|vestidor`, 'primary closet'],
  [String.raw`(?:${BED}|suite) (?:principal|master|maestr[ao]|matrimonial)|\bmaster\b|\bla principal\b`, 'primary bedroom'],
  [String.raw`medios? ${BATH}s?|${BATH} de (?:visitas?|cortesia|invitados)`, 'half bath'],
  [String.raw`${BATH} compartido|jack (?:and|y|&|n) jill`, 'jack & jill'],
  [String.raw`cuarto de (?:lavado|lavar|lavanderia)|area de lavado|lavanderia|lavandero|laundry`, 'laundry'],
  [String.raw`cuarto de ${BATH}`, 'bathroom'],
  [String.raw`${BED} (?:numero |num\.? |#|no\.? )?(\d)\b(?! ?(?:pies?|ft|carros?|por|x)\b)`, 'bedroom #'],
  [String.raw`${BATH} (?:numero |num\.? |#|no\.? )?(\d)\b(?! ?(?:pies?|ft|por|x)\b)`, 'bath #'],
  [String.raw`sala de estar|sala familiar|cuarto de tele(?:vision)?|sala|estancia|living|family room`, 'living room'],
  [String.raw`comedor`, 'dining room'],
  [String.raw`co[cs]ina|kitchen`, 'kitchen'],
  [String.raw`cochera|cochra|garaje|garage|garach\w*|marquesina|carport`, 'garage'],
  [String.raw`ofi[cs]ina|estudio|despacho`, 'office'],
  [String.raw`despensa|alacena|pantry`, 'pantry'],
  [String.raw`patio(?: (?:techado|cubierto|con techo|trasero|de atras|atras))*|lanai|palapa`, 'covered patio'],
  [String.raw`${PORCH}(?: techad[oa]| cubiert[oa])? (?:(?:de|del|en|al|a|por|hacia|para) )?(?:(?:la|el) )?(?:parte )?(?:de )?(?:atras|trasero|trasera|posterior|fondo)`, 'back porch'],
  [String.raw`${PORCH}(?: techad[oa]| cubiert[oa])? (?:(?:de|del|en|al|a|por|hacia|para) )?(?:(?:la|el) )?(?:parte )?(?:de )?(?:enfrente|frente|adelante|delantero|delantera|entrada)`, 'front porch'],
  [String.raw`${PORCH}(?: techad[oa]| cubiert[oa])?`, 'porch'],
  [String.raw`mud ?room|cuarto de entrada|entrada de servicio`, 'mud room'],
  [String.raw`recibidor|vestibulo|foyer|entrada principal`, 'foyer'],
  [String.raw`closet|ropero`, 'closet'],
  [String.raw`re[cs]amar[ae]?s?|recamras?|cuart(?:o|os|ito|itos)|h?abitaci?on(?:es)?|dormitorios?|alcobas?`, 'bedroom'],
  [String.raw`${BATH}s?(?: completos?)?`, 'bathroom'],
  [String.raw`toda la casa|la casa entera|casa|hogar|vivienda`, 'house'],
].map(([src, en]) => [new RegExp(String.raw`\b(?:${src})(?![a-z0-9])`, 'g'), en])

const NUM_WORDS = { dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 }
const an = (noun) => (/^[aeiou]/.test(noun) ? 'an' : 'a')
const plural = (noun) => (noun === 'bedroom' ? 'bedrooms' : noun === 'bathroom' ? 'bathrooms' : noun === 'half bath' ? 'half baths' : noun.endsWith('s') ? noun : `${noun}s`)

const RE = {
  open: /\bmas abiert[oa]s?\b|\b(?:concepto|espacio|plano|planta) abiert[oa]\b|\babr(?:e|ir|an|ele|irle|a)\b|\btechos? (?:mas )?alt[oa]s?\b|\bsub(?:e|ir|ele|irle|a) (?:el|los) techos?\b|\b(?:quit\w+|tumb\w+|tir\w+|sin|elimin\w+|menos) (?:la |las |una |esa |esas |tantas )?pared(?:es)?\b|\b(?:encerrad[oa]|apretad[oa]|amontonad[oa]|sofocad[oa])\b|\bmas (?:amplitud|ventilad[oa]|airead[oa])\b/,
  feelsBig: /\b(?:se )?(?:sient[ae]|vea|ve|sentir)\b.*\bmas (?:ampli[oa]|grande|espacios[oa])\b/,
  cost: /\$|\bcuant[oa]s? (?:cuesta|costaria|costara|sale|saldria|me sale|me saldria|va a (?:costar|salir)|seria|cobran|tengo que pagar|hay que pagar)\b|\b(?:precios?|costos?|presupuesto|cotiza\w*|estimado|mensualidad\w*|pagos?|pagar|enganche|financia\w+|hipoteca|credito|dinero|dolares)\b|\bcuanto\b(?!\s+(?:mas|menos|mide|miden|espacio|pies|cuartos|recamaras|banos|es de|tiene))/,
  story: /\b(?:segundo|otro|2do|2o) piso\b|\b(?:dos|2) (?:pisos|plantas|niveles)\b|\bsegunda planta\b|\bplanta alta\b|\bde arriba\b/,
  pool: /\balberca|piscina|pileta\b/,
  basement: /\bsotano\b/,
  casita: /\bcasita\b|\bcasa de huespedes\b|\btaller\b|\bgranero\b/,
  finish: /\b(?:pint\w+|color(?:es)?|ladrillo|estuco|piedra|tejas?|gabinetes?|encimeras?|granito|alfombra|azulejos?|loseta|pisos? de)\b/,
  swap: /\b(?:intercambi\w+|cambi\w+ de lugar|volte\w+)\b/,
  swapWith: /\bcambi\w+ (?:el |la |mi )?§a§ (?:por|con) (?:el |la |mi )?§b§/,
  remove: /\b(?:quit\w+|elimin\w+|borr\w+|sac[ao]\w*|sin|no quiero|ya no quiero|no necesit\w+|no ocup\w+|deshazte de)\b/,
  addVerb: /\b(?:agreg\w+|anad\w+|pon|ponle|ponme|pongan?|ponga\w*|poner\w*|mete\w*|inclu\w+|falta\w*)\b/,
  want: /\b(?:quiero|quisiera|queremos|necesit\w+|ocup\w+|me gustaria|nos gustaria|con|otr[ao]s?|un|una|unos|unas|tambien)\b/,
  more: /\botr[ao]s?\b|§[a-z]§ mas\b|\bmas §[a-z]§/,
  beside: /\b(?:junt(?:o|ito) al?|al lado del?|a un lado del?|a lado del?|cerca del?|pegad[oa] al?|enseguida del?)\b/,
  moveVerb: /\b(?:muev\w+|mover|pas[ae]\w*|cambi\w+|recorr\w+|reubic\w+|traslad\w+|llev\w+|empuj\w+|corr[ae]\w*)\b/,
  grow: /\bmas (?:grandes?|grandot[ae]|ampli[oa]s?|espacios[oa]s?|anch[oa]s?|larg[oa]s?|profund[oa]s?|hond[oa]s?|comod[oa]s?)\b|\b(?:agrand\w+|ampli(?:a|ar|ale|e|en)|ensanch\w+|alarg\w+|extiend\w+|extend\w+|crec\w+|aument\w+)\b|\bmas (?:espacio|lugar|area|tamano)\b|\bmas de (?:ancho|largo|fondo)\b/,
  shrink: /\bmas (?:chi(?:c|qu)[oa]s?|chiquit[oa]s?|pequen[oa]s?|angost[oa]s?|cort[oa]s?|reducid[oa]s?|compact[oa]s?)\b|\bmenos (?:grande|anch[oa]|larg[oa]|espacio)\b|\b(?:achic\w+|reduc\w+|encog\w+|recort\w+|acort\w+)\b|\bmenos de (?:ancho|largo|fondo)\b/,
  wide: /\banch[oa]s?\b|\bensanch|\bde ancho\b/,
  deep: /\blarg[oa]s?\b|\bprofund|\bhond[oa]|\balarg|\bde (?:largo|fondo|profundidad)\b/,
  // round 15: "más angosta" is narrower, "más corta" shorter (one way), not smaller each way
  narrow: /\bangost[oa]s?\b|\bmenos anch[oa]\b|\bmenos de ancho\b/,
  short: /\bcort[oa]s?\b|\bacort\w+|\bmenos larg[oa]\b|\bmenos de (?:largo|fondo)\b/,
  much: /\bmuch(?:o|isimo) mas\b|\bbastante mas\b|\bel doble\b|\bmucho\b/,
  cars: /\b(\d|un|una)\s*(?:carros?|coches?|autos?|automoviles?|vehiculos?|trocas?|camionetas?)\b/,
  side: /\b(?:de lado|de ladito|lateral|por (?:el|un) lado|por (?:el|un) costado|de costado|entrada (?:lateral|de lado|por (?:el|un) lado))\b/,
  front: /\b(?:de frente|al frente|por (?:el |en)?frente|hacia la calle|a la calle)\b/,
  tandem: /\btandem\b|\ben fila\b|\buno (?:detras|atras) del otro\b/,
  back: /\b(?:atras|trasero|trasera|posterior|al fondo|en el fondo)\b/,
  ahead: /\b(?:enfrente|al frente|del frente|adelante|delantero|delantera)\b/,
  by: /(\d+(?:\.\d+)?)\s*(?:pies?\s*)?(?:por|x)\s*(\d+(?:\.\d+)?)/,
  absolute: /(\d+(?:\.\d+)?)\s*(?:pies?|ft)?\s*de (ancho|largo|fondo|profundidad)\b/,
  feet: /(\d+(?:\.\d+)?)\s*(?:pies?|ft)\b/,
  sqft: /(\d[\d,.]*)\s*(mil\b)?\s*(\d{3})?\s*(pies? ?cuadrados?|pies ?2|pies²|p2|ft2|sq\.? ?ft|sqft|sf\b|pc\b|pies?\b)?/g,
  toward: /(\d+(?:\.\d+)?)\s*(?:pies?|ft)\s*(?:(?:hacia|para|a|al) )?(?:(?:la|el) )?(calle|frente|enfrente|adelante|atras|fondo|derecha|izquierda|este|oeste)\b/,
}

/** The living area a clause states ("2,500 pies", "2500 pies cuadrados", "3 mil pies"), or null: feet under 400 are a length. */
function areaSaid(s) {
  for (const m of s.matchAll(RE.sqft)) {
    let n = +String(m[1]).replace(/[,.](?=\d{3}\b)/g, '').replace(/,/g, '')
    if (!Number.isFinite(n)) continue
    if (m[2]) n = n * 1000 + (m[3] ? +m[3] : 0)
    const unit = m[4] || ''
    if (/cuadrad|2|²|sq|sf|pc/.test(unit) ? n >= 100 : (unit || m[2]) && n >= 400) return Math.round(n)
  }
  return null
}

/** One Spanish clause (folded) as the English the basic rules read, or null when it says nothing they know. */
function clauseEn(clause, ctx) {
  const found = []
  let s = ` ${clause} `.replace(/\s+/g, ' ')
  for (const [w, n] of Object.entries(NUM_WORDS)) s = s.replace(new RegExp(String.raw`\b${w}\b`, 'g'), String(n))
  // "dos baños y medio", "2 y medio baños", "2.5 baños": that many full baths and a half bath (round 15, U3)
  const half = s.match(/\b(\d{1,2})(?: [bv]ani?os?(?: completos?)? y medio| y medio [bv]ani?os?|[.,]5 [bv]ani?os?)\b/)
  if (half && !RE.remove.test(s) && !RE.addVerb.test(s)) return `${half[1]}.5 bathrooms`
  for (const [re, en] of ROOM_WORDS) {
    s = s.replace(re, (m, digit) => {
      const many = /s$/.test(m.split(' ')[0]) && (en === 'bedroom' || en === 'bathroom' || en === 'half bath')
      found.push({ en: en.replace('#', digit || ''), many, named: en.includes('#') })
      return `§${found.length - 1}§`
    })
  }
  // in the order the client said them; a room is marked §a§, §b§, … so no digit of ours is read as a number
  const order = [...s.matchAll(/§(\d+)§/g)].map((m) => +m[1])
  const rooms = order.map((i) => found[i])
  const mark = (k) => `§${String.fromCharCode(97 + k)}§`
  order.forEach((i, k) => (s = s.replace(`§${i}§`, `¤${k}¤`)))
  s = s.replace(/¤(\d+)¤/g, (m, k) => mark(+k))
  const first = rooms[0]
  const second = rooms[1]
  const before = (k) => (s.slice(0, s.indexOf(mark(k))).trim().split(' ').pop() || '')
  const say = (en, action) => {
    if (action) ctx.last = ctx.set = action
    return en
  }

  // the house as a whole, and things no plan here has
  if (RE.open.test(s) || (RE.feelsBig.test(s) && !rooms.some((r) => r.en !== 'house'))) return say('make it feel more open')
  if (RE.cost.test(s)) return say('how much does it cost?')
  if (RE.story.test(s)) return say('add a second story')
  if (RE.pool.test(s)) return say('add a pool')
  if (RE.basement.test(s)) return say('add a basement')
  if (RE.casita.test(s)) return say('add a casita')
  if (RE.finish.test(s) && !RE.grow.test(s) && !RE.shrink.test(s)) return say('change the paint colour')

  const removing = RE.remove.test(s)
  const growing = RE.grow.test(s)
  const shrinking = RE.shrink.test(s) && !growing
  const besides = RE.beside.test(s)

  // two rooms trade places
  if (rooms.length >= 2 && (RE.swap.test(s) || RE.swapWith.test(s))) return say(`swap the ${first.en} and the ${second.en}`)

  // the garage: cars, which way its doors face, a tandem bay
  const cars = s.match(RE.cars)
  const garage = rooms.find((r) => r.en === 'garage')
  if ((garage || cars) && !removing && !(besides && rooms.length >= 2)) {
    const n = cars ? (/\d/.test(cars[1]) ? +cars[1] : 1) : null
    const load = garage && RE.side.test(s) ? ' side-load' : garage && RE.front.test(s) ? ' front-load' : ''
    const tandem = RE.tandem.test(s) ? ' tandem' : ''
    // "agrega una cochera para 2 carros": a garage for a plan that has none
    if (n && !load && !tandem && /\b(?:agreg\w+|anad\w+)\b/.test(s)) return say(`add a ${n}-car garage`, { kind: 'add' })
    if (n || load || tandem) return say(`make the garage${n ? ` ${n} car${n === 1 ? '' : 's'}` : ''}${load}${tandem}`)
  }

  // the size of the whole house
  const area = areaSaid(s)
  if (area && (!first || first.en === 'house')) return say(`make the house ${area.toLocaleString('en-US')} sf`)

  const others = rooms.filter((r) => r.en !== 'house')
  const numberBefore = (k) => {
    const m = s.match(new RegExp(String.raw`(\d{1,2})\s*${mark(k)}`))
    return m ? +m[1] : null
  }
  const countable = (r) => r && !r.named && (r.en === 'bedroom' || r.en === 'bathroom')

  if (removing && others.length) return say(others.map((r) => `remove the ${r.en}`).join(' and '), { kind: 'remove' })

  // "quiero 4 recámaras", "3 baños": how many the house should have; "2 recámaras más", "otra recámara": that many more
  const counts = rooms.map((r, k) => (countable(r) ? { r, n: numberBefore(k) } : null)).filter((c) => c && c.n)
  if (counts.length && !growing && !shrinking) {
    if (RE.addVerb.test(s) || RE.more.test(s)) return say(counts.map((c) => `add ${c.n} ${plural(c.r.en)}`).join(' and '), { kind: 'add' })
    return say(counts.map((c) => `${c.n} ${c.n === 1 ? c.r.en : plural(c.r.en)}`).join(' and '))
  }

  // a room moves: beside another, or a distance
  const definite = (k) => /^(?:la|el|mi|nuestra|nuestro|esa|ese)$/.test(before(k))
  if (others.length >= 2 && besides && (definite(rooms.indexOf(others[0])) || (RE.moveVerb.test(s) && !RE.addVerb.test(s)))) return say(`move the ${others[0].en} next to the ${others[1].en}`)
  const toward = s.match(RE.toward)
  if (others.length && toward && RE.moveVerb.test(s)) {
    const way = /calle|frente|adelante/.test(toward[2]) ? 'toward the street' : /atras|fondo/.test(toward[2]) ? 'toward the back' : toward[2] === 'derecha' ? 'right' : toward[2] === 'izquierda' ? 'left' : toward[2] === 'este' ? 'east' : 'west'
    return say(`move the ${others[0].en} ${toward[1]} ft ${way}`)
  }

  // a room changes size: a size said outright, so many feet, or just bigger or smaller
  const size = s.match(RE.by)
  const absolute = s.match(RE.absolute)
  const adding = RE.addVerb.test(s) || (RE.want.test(s) && others.length && !definite(rooms.indexOf(others[0])))
  const porch = others.find((r) => /porch|patio/.test(r.en))
  if ((growing || shrinking || absolute || (size && !(adding && porch))) && !(adding && !growing && !shrinking && !absolute && !size)) {
    const target = others[0] ? `the ${others[0].en}` : first ? 'the house' : 'it'
    const feet = s.match(RE.feet)
    const by = feet && +feet[1] < 400 ? `${feet[1]} ft ` : ''
    let how
    if (size) how = `${size[1]} by ${size[2]}`
    else if (absolute && !growing && !shrinking) how = `${absolute[1]} ft ${absolute[2] === 'ancho' ? 'wide' : 'deep'}`
    else how = `${RE.much.test(s) && !by ? 'much ' : ''}${by}${growing ? (RE.wide.test(s) ? 'wider' : RE.deep.test(s) ? 'deeper' : 'bigger') : RE.narrow.test(s) ? 'narrower' : RE.short.test(s) ? 'shorter' : 'smaller'}`
    const action = { kind: 'resize', how }
    if (others.length > 1 && !size && !absolute) return say(others.map((r) => `make the ${r.en} ${how}`).join(' and '), action)
    return say(`make ${target} ${how}`, action)
  }

  // a room is added: "agrega una oficina", "quiero un porche atrás", "un patio techado", "otra recámara"
  if (others.length && adding) {
    const r = others[0]
    let noun = r.en
    if (noun === 'porch') noun = RE.back.test(s) ? 'back porch' : RE.ahead.test(s) ? 'front porch' : 'porch'
    const near = besides && others[1] ? ` next to the ${others[1].en}` : ''
    const dims = size && porch ? ` ${size[1]} by ${size[2]}` : ''
    return say(`add ${an(noun)}${dims} ${noun}${near}`, { kind: 'add' })
  }

  // a room on its own takes what the clause before it asked for: "quita la oficina y el medio baño"
  if (others.length && ctx.last) {
    const r = others[0].en
    if (ctx.last.kind === 'remove') return `remove the ${r}`
    if (ctx.last.kind === 'add') return `add ${an(r)} ${r}`
    if (ctx.last.kind === 'resize') return `make the ${r} ${ctx.last.how}`
  }
  if (others.length) return `the ${others[0].en}`
  return null
}

const SPLIT_ES = /\s*(?:;|,(?!\d{3}\b)|\by luego\b|\by despues\b|\bluego\b|\bdespues\b|\by tambien\b|\by ademas\b|\bademas\b|\bpero\b|\baunque\b|\by\b|\be\b)\s*/g
/**
 * A Spanish request as the English the basic rules read, clause by clause.
 * @returns {{ text: string, pairs: [string, string][], back: (english: string) => string }}  pairs: [the English
 *   clause, the client's own words for it]; back(): an English text with each clause put back in the client's words
 */
export function fromSpanish(text) {
  const raw = String(text ?? '').trim()
  const { chars, f } = folded(raw)
  // one request that only reads whole: two rooms trading places, a wall between two rooms
  const whole = RE.swap.test(f) || /\bentre\b/.test(f)
  const cuts = []
  // "dos baños y medio", "2 y medio baños" (round 15, U3): one count, never "2 bathrooms" and a "medio" nobody read
  const halfJoin = (m) => /^\s*y\s*$/.test(m[0]) && ((/\b(?:\d{1,2}|un|uno|dos|tres|cuatro|cinco|seis) [bv]ani?os?(?: completos?)?$/.test(f.slice(0, m.index)) && /^medio\b(?! [bv]an)/.test(f.slice(m.index + m[0].length))) || (/\b(?:\d{1,2}|dos|tres|cuatro|cinco|seis)$/.test(f.slice(0, m.index)) && /^medio [bv]an/.test(f.slice(m.index + m[0].length))))
  if (!whole) for (const m of f.matchAll(SPLIT_ES)) if (!halfJoin(m)) cuts.push([m.index, m.index + m[0].length, /luego|despues/.test(m[0]) ? ' and then ' : /;/.test(m[0]) ? '; ' : ' and '])
  const pieces = []
  let at = 0
  let join = ''
  for (const [a, b, j] of [...cuts, [f.length, f.length, '']]) {
    const own = chars.slice(at, a).join('').trim()
    if (own) pieces.push({ own, f: f.slice(at, a).trim(), join })
    join = j
    at = b
  }
  const ctx = { last: null }
  const pairs = []
  let out = ''
  const read = pieces.map((p) => {
    ctx.set = null
    const en = clauseEn(p.f, ctx)
    return { p, en, action: ctx.set }
  })
  // a room named before what is asked of it takes that from the clause after: "que la cocina y la sala sean más grandes"
  for (let i = read.length - 2; i >= 0; i--) {
    const alone = read[i].en && /^the (.+)$/.exec(read[i].en)
    const next = read[i + 1].action
    if (!alone || read[i].action || !next || (i > 0 && read[i - 1].action)) continue
    read[i].en = next.kind === 'remove' ? `remove the ${alone[1]}` : next.kind === 'resize' ? `make the ${alone[1]} ${next.how}` : read[i].en
    if (next.kind === 'remove' || next.kind === 'resize') read[i].action = next
  }
  for (const { p, en: found } of read) {
    const en = found || p.own
    pairs.push([en, p.own])
    out += (out ? p.join || ' and ' : '') + en
  }
  const back = (english) => {
    let t = String(english ?? '')
    // longest first, so "add an office next to the laundry" is not cut by "add an office"
    for (const [en, own] of [...pairs].sort((x, y) => y[0].length - x[0].length)) if (en !== own) t = t.split(en).join(own)
    return t
  }
  return { text: out || raw, pairs, back }
}

const UNDO_ES = /^(?:por favor,? )?(?:(?:me |nos |lo )?(?:puedes|puede|pueden|podrias|podria|podrian|quieres|quiere) (?:por favor )?)?(?:(?:control|ctrl) ?z|(?:deshaz|deshace|deshacer|deshaga|deshazme)(?:lo|la)?(?: (?:eso|esto|el (?:ultimo )?cambio|ese cambio|lo ultimo|lo anterior|el cambio anterior|lo que (?:hice|hiciste|hicimos|pedi)))?|(?:regresa|regresar|regrese|regresalo|regresala|regresame|vuelve|volver|vuelva|vuelvelo|dejalo|dejala|ponlo|ponla|quiero regresar|quiero volver)(?: (?:todo )?(?:a )?(?:como estaba|como antes|como estaba antes|atras|a la version anterior|al anterior|a lo anterior|una version|un paso|un cambio|para atras|pa tras|patras|a como estaba))?|quita(?:r|le)? (?:el |ese |este |mi )?(?:ultimo )?cambio|quita lo ultimo|cancela(?:r)? (?:eso|el (?:ultimo )?cambio|ese cambio|lo ultimo)|como estaba(?: antes)?|(?:para )?atras)(?:,? por favor)?$/
/** "deshaz eso", "regresa como estaba", "quita el último cambio": the last change comes off. */
export function isUndoEs(text) {
  const f = fold(text).replace(/[.!?]+\s*$/, '').replace(/\s+/g, ' ').trim()
  return !!f && !/^(?:dejalo|dejala|ponlo|ponla)$/.test(f) && UNDO_ES.test(f)
}

// ── writing Spanish ──────────────────────────────────────────────────────────────────────────────────────────
// the rooms and what stands in them: [Spanish, gender]
const ROOM_ES = {
  living: ['sala', 'f'], 'living room': ['sala', 'f'], 'family room': ['sala', 'f'], 'great room': ['sala', 'f'],
  kitchen: ['cocina', 'f'], dining: ['comedor', 'm'], 'dining room': ['comedor', 'm'],
  foyer: ['recibidor', 'm'], pantry: ['despensa', 'f'], office: ['oficina', 'f'],
  'primary bedroom': ['recámara principal', 'f'], 'primary bath': ['baño principal', 'm'], 'primary closet': ['clóset principal', 'm'],
  'mini primary': ['segunda recámara principal', 'f'], 'second suite': ['segunda recámara principal', 'f'],
  bedroom: ['recámara', 'f'], bed: ['recámara', 'f'], bath: ['baño', 'm'], bathroom: ['baño', 'm'],
  'jack & jill': ['baño compartido', 'm'], 'half bath': ['medio baño', 'm'], laundry: ['lavandería', 'f'],
  'mud room': ['entrada de servicio', 'f'], closet: ['clóset', 'm'], hall: ['pasillo', 'm'], hallway: ['pasillo', 'm'],
  garage: ['cochera', 'f'], 'front porch': ['porche del frente', 'm'], 'rear porch': ['porche de atrás', 'm'], 'back porch': ['porche de atrás', 'm'],
  porch: ['porche', 'm'], 'covered patio': ['patio techado', 'm'], linen: ['clóset de blancos', 'm'], storage: ['bodega', 'f'],
  vestibule: ['vestíbulo', 'm'], gallery: ['galería', 'f'], 'drop zone': ['área de entrada', 'f'],
  house: ['casa', 'f'], room: ['habitación', 'f'], 'that room': ['esa habitación', 'f'], 'such room': ['esa habitación', 'f'],
}
const FIXTURE_ES = {
  bed: ['cama', 'f'], sofa: ['sofá', 'm'], 'coffee table': ['mesa de centro', 'f'], 'dining table': ['mesa del comedor', 'f'], desk: ['escritorio', 'm'],
  'media wall': ['mueble de la tele', 'm'], counter: ['barra', 'f'], island: ['isla', 'f'], sink: ['fregadero', 'm'], range: ['estufa', 'f'],
  refrigerator: ['refrigerador', 'm'], washer: ['lavadora', 'f'], dryer: ['secadora', 'f'], 'water heater': ['calentador de agua', 'm'],
  'water closet': ['inodoro', 'm'], toilet: ['inodoro', 'm'], shower: ['regadera', 'f'], vanity: ['lavabo', 'm'], 'linen cabinet': ['mueble de blancos', 'm'],
  shelving: ['repisas', 'f'], bench: ['banca', 'f'], fixture: ['mueble', 'm'],
}
const cap = (s) => String(s).replace(/^(\s*[¿¡"«]?)(\p{L})/u, (m, lead, ch) => lead + ch.toUpperCase())
/** A room's name in Spanish: { es, g: 'f' | 'm', own: a room called by its name ("Recámara 3"), foreign: a name we have no word for }. */
export function roomEs(name) {
  const raw = String(name ?? '').trim().replace(/^(?:the|an?)\s+/i, '')
  const key = raw.toLowerCase()
  if (ROOM_ES[key]) return { es: ROOM_ES[key][0], g: ROOM_ES[key][1] }
  let m
  if ((m = key.match(/^(\d)-car garage$/))) return { es: `cochera para ${m[1]} carro${m[1] === '1' ? '' : 's'}`, g: 'f' }
  if ((m = key.match(/^(.+?)s? (\d+)$/)) && ROOM_ES[m[1]]) return { es: `${cap(ROOM_ES[m[1]][0])} ${m[2]}`, g: ROOM_ES[m[1]][1], own: true }
  if ((m = key.match(/^(.+?)s$/)) && ROOM_ES[m[1]]) return { es: pluralEs(ROOM_ES[m[1]][0]), g: ROOM_ES[m[1]][1], many: true }
  return { es: raw || 'habitación', g: raw ? 'm' : 'f', foreign: !!raw }
}
const pluralEs = (noun) => noun.split(' ').map((w, i) => (i === 0 || w === 'principal' || w === 'compartido' || w === 'techado' ? (/[aeiouáéíóú]$/.test(w) ? `${w}s` : /s$/.test(w) ? w : `${w}es`) : w)).join(' ').replace('medios baño', 'medios baños')
const el = (name) => {
  const r = roomEs(name)
  return `${r.many ? (r.g === 'f' ? 'las' : 'los') : r.g === 'f' ? 'la' : 'el'} ${r.es}`
}
const del = (name) => el(name).replace(/^el /, 'del ').replace(/^(la|las|los) /, 'de $1 ')
const al = (name) => el(name).replace(/^el /, 'al ').replace(/^(la|las|los) /, 'a $1 ')
const un = (name) => {
  const r = roomEs(name)
  return r.own ? `${r.g === 'f' ? 'la' : 'el'} ${r.es}` : `${r.g === 'f' ? 'una' : 'un'} ${r.es}`
}
const bare = (name) => roomEs(name).es
const fem = (name) => roomEs(name).g === 'f'
const fixtureEs = (name) => {
  const f = FIXTURE_ES[String(name ?? '').trim().toLowerCase()]
  return f ? `${f[1] === 'f' ? 'la' : 'el'} ${f[0]}` : 'un mueble'
}
const pies = (n) => (String(n) === '1' ? '1 pie' : `${n} pies`)
const countEs = (n, kind) => `${n} ${/bed/i.test(kind) ? (String(n) === '1' ? 'recámara' : 'recámaras') : String(n) === '1' ? 'baño' : 'baños'}`
/** "the 4 bedrooms", "the 1 bathroom": "las 4 recámaras", "el baño". */
const theCountEs = (n, kind) => (String(n) === '1' ? (/bed/i.test(kind) ? 'la recámara' : 'el baño') : `${/bed/i.test(kind) ? 'las' : 'los'} ${countEs(n, kind)}`)
// "2 bathrooms and a half bath" (round 15, U3): "2 baños y medio"
const COUNT = String.raw`(\d+) (bed|bath)rooms?( and a half bath)?`
const HAD = String.raw`(\d+)( (?:bed|bath)rooms?)?( and a half bath)?` // "it had 2", "it had 2 bathrooms", "it had 2 bathrooms and a half bath"
const countHalfEs = (n, kind, half) => `${countEs(n, kind)}${half ? ' y medio' : ''}`
const hadEs = (n, kind, named, half) => (named || half ? countHalfEs(n, kind, half) : n)
// the styles by the names the style step shows in Spanish (round 15, U15: no English name in a Spanish reply)
const STYLE_ES = { 'Modern Farmhouse': 'Farmhouse moderno', Modern: 'Moderno', Spanish: 'Español', Ranch: 'Rancho', Transitional: 'Transicional', Tuscan: 'Toscano', Coastal: 'Costero', 'This style': 'este' }
const styleEs = (name) => STYLE_ES[String(name).trim()] || String(name).trim()
const carsEs = (n) => `cochera para ${n} carro${String(n) === '1' ? '' : 's'}`
const PLAN_ES = { standard: 'el plano estándar', compact: 'el plano compacto', 'narrow-lot': 'el plano para lote angosto', narrow: 'el plano para lote angosto', 'garage-forward': 'el plano con la cochera al frente', frontgarage: 'el plano con la cochera al frente', Valley: 'el plano del Valle', valley: 'el plano del Valle', same: 'el mismo plano' }
const planEs = (p) => PLAN_ES[p] || `el plano ${p}`
const WAY_ES = { east: 'hacia el este', west: 'hacia el oeste', 'toward the street': 'hacia la calle', 'toward the back': 'hacia atrás', left: 'a la izquierda', right: 'a la derecha', north: 'hacia atrás', south: 'hacia la calle', street: 'hacia la calle', back: 'hacia atrás', front: 'hacia la calle', rear: 'hacia atrás' }
const wayEs = (w) => WAY_ES[String(w).trim().toLowerCase()] || String(w)
const loadEs = (l) => (l === 'side' ? 'con entrada lateral' : 'con entrada de frente')
/** "the kitchen, the dining room and the living room" → "la cocina, el comedor y la sala". */
const listEs = (names) => {
  const all = String(names).split(/,\s*|\s+and\s+/).map((n) => n.trim()).filter(Boolean).map(el)
  return all.length > 1 ? `${all.slice(0, -1).join(', ')} ${/^(?:i|hi)/i.test(all[all.length - 1]) ? 'e' : 'y'} ${all[all.length - 1]}` : all[0] || ''
}
/** "1 ft wider and 2 ft longer" → "1 pie más de ancho y 2 pies más de largo". */
const grewEs = (text) => String(text).split(' and ').map((p) => {
  const m = p.match(/^([\d.]+) ft (wider|longer)$/)
  return m ? `${pies(m[1])} más de ${m[2] === 'wider' ? 'ancho' : 'largo'}` : p
}).join(' y ')
const KEPT_OPEN = 'el espacio que la ciudad mantiene libre a lo largo de cada orilla del lote'
const KEPT_DEL = `d${KEPT_OPEN}` // "se pasa del espacio que …"
const N = String.raw`\d[\d,]*(?:\.\d+)?`
const edgeEs = (edge) => {
  const e = String(edge).trim().toLowerCase()
  if (e === 'side' || e === 'the side of the lot') return 'del costado del lote'
  if (e === 'rear' || e === 'the back of the lot') return 'del fondo del lote'
  if (e === 'front' || e === 'the street') return 'de la calle'
  if (e === 'street side' || e === 'the side street') return 'de la calle lateral'
  const named = String(edge).trim().match(/^the street side \((.+)\)$/i)
  return `de ${(named ? named[1] : String(edge).trim()).replace(/\b[a-z]/g, (c) => c.toUpperCase())}`
}
const keptAt = (ft, edge) => {
  const e = String(edge).trim().toLowerCase()
  const where = /^(side|on the side of the lot)$/.test(e) ? 'en el costado del lote' : /^(rear|at the back of the lot)$/.test(e) ? 'al fondo del lote' : /^(front|along the street)$/.test(e) ? 'del lado de la calle' : /^street[- ]side$/.test(e) ? 'del lado de la calle lateral' : `a lo largo de ${String(edge).trim().replace(/^along /i, '').replace(/\b[a-z]/g, (c) => c.toUpperCase())}`
  return `los ${pies(ft)} que la ciudad mantiene libres ${where}`
}

// what a change runs into, as the plan code words it after "that", after a subject, or on its own: [pattern, Spanish]
const VERBS = [
  [String.raw`runs past the (${N}) ft (side|rear|front|street[- ]side) setback`, (m) => `se pasa de ${keptAt(m[1], m[2])}`],
  [String.raw`runs past the (${N}) ft setback from (.+)`, (m) => `se pasa de ${keptAt(m[1], m[2])}`],
  [String.raw`runs past the (${N}) ft the city keeps open (on the side of the lot|at the back of the lot|along the street|along .+)`, (m) => `se pasa de ${keptAt(m[1], m[2])}`],
  [String.raw`runs past (?:the setbacks on this lot|the setbacks|the space the city lets you build on)`, () => `se pasa ${KEPT_DEL}`],
  [String.raw`covers more of the lot than the city allows`, () => 'cubre más parte del lote de lo que permite la ciudad'],
  [String.raw`runs rooms into each other`, () => 'hace que unas habitaciones choquen con otras'],
  [String.raw`leaves the (.+) under its minimum size`, (m) => `deja ${el(m[1])} por debajo de su tamaño mínimo`],
  [String.raw`leaves a room under its minimum size`, () => 'deja una habitación por debajo de su tamaño mínimo'],
  [String.raw`takes the escape window away from the (.+)`, (m) => `deja ${el(m[1])} sin su ventana de salida de emergencia`],
  [String.raw`takes a bedroom's escape window away`, () => 'deja una recámara sin su ventana de salida de emergencia'],
  [String.raw`leaves the (.+) without a window`, (m) => `deja ${el(m[1])} sin ventana`],
  [String.raw`leaves a room without a window`, () => 'deja una habitación sin ventana'],
  [String.raw`puts the (.+) too far from the plumbing`, (m) => `deja ${el(m[1])} demasiado lejos de la plomería`],
  [String.raw`puts a wet room too far from the plumbing`, () => 'deja un baño o un área con agua demasiado lejos de la plomería'],
  [String.raw`leaves rooms without a door or with a door to the outside`, () => 'deja habitaciones sin puerta o con una puerta que da hacia afuera'],
].map(([src, fn]) => [new RegExp(`^(?:${src})$`), fn])
const verbEs = (text) => {
  for (const [re, fn] of VERBS) {
    const m = re.exec(String(text).trim())
    if (m) return fn(m)
  }
  return null
}
const AROUND = 'las habitaciones de alrededor ya no funcionarían como están dibujadas'
// the reasons after a colon ("… cannot get that much bigger here: <this>."), no capital letter, no full stop
const CLAUSES = [
  [String.raw`(.+?) would end up too close to (.+?), where the city keeps (${N}) ft open`, (m) => `${m[1] === 'it' ? '' : `${el(m[1])} `}quedaría demasiado cerca ${edgeEs(m[2])}, donde la ciudad mantiene ${pies(m[3])} libres`],
  [String.raw`the house and porches would cover just over the (${N}) percent of the lot that (.+) allows`, (m) => `la casa y los porches cubrirían un poco más del ${m[1]} por ciento del lote que permite ${m[2]}`],
  [String.raw`the house and porches would cover (${N}) percent of the lot, more than the (${N}) percent (.+) allows`, (m) => `la casa y los porches cubrirían el ${m[1]} por ciento del lote, más del ${m[2]} por ciento que permite ${m[3]}`],
  [String.raw`the house would cover more of the lot than is allowed here`, () => 'la casa cubriría más parte del lote de lo que aquí se permite'],
  [String.raw`(part of the house|it|.+?) would end up too close to the edge of the lot, inside the space the city keeps open along each edge`, (m) => `${m[1] === 'it' ? '' : m[1] === 'part of the house' ? 'parte de la casa ' : `${el(m[1])} `}quedaría demasiado cerca de la orilla del lote, dentro del espacio que la ciudad mantiene libre a lo largo de cada orilla`],
  [String.raw`the rooms do not all fit on this lot at a size that works`, () => 'no todas las habitaciones caben en este lote con un tamaño que funcione'],
  [String.raw`(.+?) next to it would be left too small`, (m) => `${el(m[1])} de al lado se quedaría con muy poco espacio`],
  [String.raw`the (.+?) in (.+?) is in the way`, (m) => `${fixtureEs(m[1])} ${del(m[2])} estorba`],
  [String.raw`(.+?) in the (.+?) is in the way`, (m) => `${fixtureEs(m[1])} ${del(m[2])} estorba`],
  [String.raw`(.+?) is in the way`, (m) => `${el(m[1])} estorba`],
  [String.raw`(.+?) would run into (.+)`, (m) => `${el(m[1])} chocaría con ${el(m[2])}`],
  [String.raw`(.+?) would be too small`, (m) => `${el(m[1])} se quedaría con muy poco espacio`],
  [String.raw`(.+?) would cross the setback`, (m) => `${el(m[1])} quedaría dentro del espacio que la ciudad mantiene libre a lo largo de cada orilla del lote`],
  [String.raw`the rooms around it would no longer work as drawn`, () => AROUND],
  [String.raw`there is no open stretch of wall at the back of the house for it on this plan, because other rooms sit behind the living room and the dining room`, () => 'en este plano no hay un tramo de pared libre en la parte de atrás de la casa, porque hay otras habitaciones detrás de la sala y del comedor'],
  [String.raw`there is no open stretch of wall at the front of the house for it on this plan`, () => 'en este plano no hay un tramo de pared libre al frente de la casa'],
  [String.raw`the plan would not work as drawn with it`, () => 'el plano no funcionaría como está dibujado'],
  // round 15: the largest this style draws a room, and a room with no wall for it
  [String.raw`it is drawn at most (${N}) ft by (${N}) ft in this style`, (m) => `en este estilo se dibuja de ${m[1]} por ${m[2]} pies como máximo`],
  [String.raw`there is no free wall for it where the rooms are`, () => 'no hay una pared libre para eso donde están las habitaciones'],
  [String.raw`that room is not in the new draft`, () => 'esa habitación no está en el nuevo dibujo'],
  [String.raw`It could not be kept on the new draft\.?`, () => 'no se pudo conservar en el nuevo dibujo'],
  // a problem the plan had before the change
  [String.raw`part of the house is past the (${N}) ft (side|rear|front|street[- ]side) setback`, (m) => `parte de la casa se pasa de ${keptAt(m[1], m[2])}`],
  [String.raw`part of the house is past the (${N}) ft setback from (.+)`, (m) => `parte de la casa se pasa de ${keptAt(m[1], m[2])}`],
  [String.raw`part of the house is past .*`, () => `parte de la casa se pasa ${KEPT_DEL}`],
  [String.raw`the house covers more of the lot than the city allows`, () => 'la casa cubre más parte del lote de lo que permite la ciudad'],
  [String.raw`two rooms run into each other`, () => 'dos habitaciones chocan entre sí'],
  [String.raw`the (.+) is under its minimum size`, (m) => `${el(m[1])} está por debajo de su tamaño mínimo`],
  [String.raw`a room is under its minimum size`, () => 'una habitación está por debajo de su tamaño mínimo'],
  [String.raw`the (.+) has no escape window`, (m) => `${el(m[1])} no tiene ventana de salida de emergencia`],
  [String.raw`a bedroom has no escape window`, () => 'una recámara no tiene ventana de salida de emergencia'],
  [String.raw`the (.+) has no window`, (m) => `${el(m[1])} no tiene ventana`],
  [String.raw`a room has no window`, () => 'una habitación no tiene ventana'],
  [String.raw`a wet room is too far from the plumbing`, () => 'un baño o un área con agua está demasiado lejos de la plomería'],
  [String.raw`a room has no door, or a door that opens to the outside`, () => 'una habitación no tiene puerta, o tiene una puerta que da hacia afuera'],
].map(([src, fn]) => [new RegExp(`^(?:${src})$`, 'i'), fn])
/** A reason in Spanish; one the plan code has no homeowner's words for becomes the general one, never English. */
function becauseEs(text, otherwise = AROUND) {
  const t = String(text ?? '').trim().replace(/\.$/, '').replace(/^.*? cannot grow that way:\s*/, '')
  if (!t) return otherwise
  for (const [re, fn] of CLAUSES) {
    const m = re.exec(t)
    if (m) return fn(m)
  }
  const verb = verbEs(t.replace(/^that /, ''))
  if (verb) return `eso ${verb}`
  if (looksSpanish(t)) return t
  // a whole sentence the rules write ("Kitchen would be 6' by 6', under the 9' by 10' minimum")
  const whole = run(`${cap(t)}.`)
  if (!whole.missed.length) return whole.out.replace(/\.$/, '').replace(/^(\p{Lu})(?=\p{Ll})/u, (c) => c.toLowerCase())
  return otherwise
}

/** What one part of a request was, in the client's own words or as the plan code names an op. */
function partEs(text) {
  const t = String(text ?? '').trim()
  let m
  if ((m = t.match(new RegExp(`^the house at (${N}) sf$`)))) return `la casa con ${m[1]} pies²`
  if ((m = t.match(/^adding an? (.+)$/))) return `agregar ${un(m[1])}`
  if ((m = t.match(/^removing the (.+)$/))) return `quitar ${el(m[1])}`
  if ((m = t.match(new RegExp(`^the (.+) at (${N})' by (${N})'$`)))) return `${el(m[1])} de ${m[2]} por ${m[3]} pies`
  if ((m = t.match(/^moving the (.+)$/))) return `mover ${el(m[1])}`
  if ((m = t.match(/^swapping the (.+) and the (.+)$/))) return `intercambiar ${el(m[1])} y ${el(m[2])}`
  if ((m = t.match(/^the (.+) next to the (.+)$/))) return `${el(m[1])} junto ${al(m[2])}`
  if ((m = t.match(/^a (\d)-car garage( \(tandem: one bay two cars deep\))?(?:, (side|front)-load)?$/))) return `${carsEs(m[1])}${m[2] ? ' (con un lugar en fila: dos carros, uno detrás del otro)' : ''}${m[3] ? `, ${loadEs(m[3])}` : ''}`
  if ((m = t.match(/^(\d+) (bed|bath)rooms?( and a half bath)?$/))) return countHalfEs(m[1], m[2], m[3])
  if (/^a new draft/.test(t)) return newDraftEs(t)
  if (t === 'that change') return 'ese cambio'
  if (t === 'wider windows') return 'ventanas más anchas'
  return t
}
/** "a new draft with a 3-car garage and 4 bedrooms at 2,400 sf" → "un nuevo dibujo con cochera para 3 carros y 4 recámaras, de 2,400 pies²". */
function newDraftEs(text) {
  const m = String(text).match(new RegExp(`^a new draft(?: with (.+?))?(?: at (${N}) sf)?$`))
  if (!m) return 'un nuevo dibujo'
  const withs = m[1] ? m[1].split(/ and (?!a half bath)/).map(withEs) : []
  return `un nuevo dibujo${withs.length ? ` con ${withs.join(' y ')}` : ''}${m[2] ? `, de ${m[2]} pies²` : ''}`
}
/** What a new draft carries: "a 3-car garage", "5 bedrooms", "a covered patio at the back". */
function withEs(text) {
  const t = String(text).trim()
  let m
  if ((m = t.match(/^a (\d)-car garage$/))) return carsEs(m[1])
  if ((m = t.match(/^(\d+) (bed|bath)rooms?( and a half bath)?$/))) return countHalfEs(m[1], m[2], m[3])
  if (t === 'a covered porch at the back') return 'un porche techado atrás'
  if (t === 'a front porch') return 'un porche al frente'
  if ((m = t.match(/^an? (office|half bath|second suite|mini primary|bedroom|bathroom|pantry)$/))) return un(m[1])
  if ((m = t.match(/^a (covered patio|rear porch|front porch) at the (back|front)$/))) return porchEs(m[1])
  return t
}
/** What the rooms step offers in place of a program that does not fit: "with a 2-car garage", "without the office", "as 3 bed, 2 bath, no garage (what the narrow-lot plan holds)". */
function fitLabelEs(label) {
  const t = String(label).trim()
  let m
  if ((m = t.match(/^with a (\d)-car garage$/))) return `con ${carsEs(m[1])}`
  if ((m = t.match(/^with (\d+) bedrooms$/))) return `con ${countEs(m[1], 'bed')}`
  if (t === 'without the office or the garage') return 'sin la oficina ni la cochera'
  if (t === 'without the office') return 'sin la oficina'
  if (t === 'without the second suite') return 'sin la segunda recámara principal'
  if (t === 'without the garage') return 'sin la cochera'
  if ((m = t.match(/^smaller, as the (\S+) plan draws it$/))) return `más chica, como la dibuja ${planEs(m[1])}`
  if ((m = t.match(/^as (\d+) bed, (\d+)(\.5)? bath(?:, (\d)-car|, no garage)(, no office)? \(what the (\S+) plan holds\)$/))) return `con ${countEs(m[1], 'bed')}, ${countEs(m[2], 'bath')}${m[3] ? ' y medio' : ''}${m[4] ? `, ${carsEs(m[4])}` : ', sin cochera'}${m[5] ? ', sin oficina' : ''} (lo que lleva ${planEs(m[6])})`
  if ((m = t.match(/^as a (\d+) bed, (\d+) bath starter( with no garage)?/i))) return `como una casa sencilla de ${countEs(m[1], 'bed')} y ${countEs(m[2], 'bath')}${m[3] ? ', sin cochera' : ''}`
  const whole = run(t)
  return whole.missed.length ? 'con menos habitaciones' : whole.out
}
const porchEs = (what) => (what === 'covered patio' ? 'un patio techado atrás' : what === 'rear porch' ? 'un porche atrás' : 'un porche al frente')

const RULES = []
/** A sentence the plan code writes, from its start to its full stop, and how it reads in Spanish. */
const S = (src, fn) => RULES.push([new RegExp(`^(?:${src})(?=\\s|$)`), typeof fn === 'string' ? () => fn : fn])
const Q = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** A sentence that never changes. */
const F = (english, spanish) => S(Q(english), spanish)

const EN_COST = "Great question. Cost is something we go over with you in person at your meeting with the South Texas Builders office, so it's based on your exact plan, lot and selections. Want me to ask the office to set up that meeting?"
export const COST_REPLY_ES = 'Buena pregunta. El costo lo revisamos contigo en persona en tu reunión con la oficina de South Texas Builders, porque depende de tu plano exacto, tu lote y tus selecciones. ¿Quieres que le pida a la oficina que programe esa reunión?'
export const ASK_LABEL_ES = { meeting: 'Pídele a la oficina que programe mi reunión', 'more-changes': 'Pídele más cambios a la oficina' }
const CAN_DO_ES = 'En el plano puedo agregar o quitar habitaciones y porches, hacer una habitación más grande o más chica, mover una habitación junto a otra y dejar la cochera para 1, 2 o 3 carros.'
const NO_STEP = 'Intenta con un paso más chico.'

// what leads a rule's reason on the rooms step, ahead of every sentence that starts with a room's name
S(String.raw`Does not fit this lot:`, 'No cabe en este lote:')
// ── fixed sentences ──
F(EN_COST, COST_REPLY_ES)
F('On the plan I can add or remove rooms and porches, make a room bigger or smaller, move a room beside another, and set the garage to 1, 2 or 3 cars.', CAN_DO_ES)
F('I am not sure what to change. Can you say it another way?', 'No estoy seguro de qué cambiar. ¿Me lo puedes decir de otra manera?')
F('No change was used.', 'No se usó ningún cambio.')
F('No change used.', 'No se usó ningún cambio.')
F('This counts as one change, for what was done.', 'Esto cuenta como un solo cambio, por lo que sí se hizo.')
F('The change counts once, for what was done.', 'El cambio cuenta una sola vez, por lo que sí se hizo.')
F('Here is what would work:', 'Esto es lo que sí funcionaría:')
F('Tell me which room could give up some space, or ask for a smaller house.', 'Dime qué habitación podría ceder un poco de espacio, o pide una casa más chica.')
F('Tell me which room next to it could give up some space.', 'Dime qué habitación de al lado podría ceder un poco de espacio.')
F('I tried smaller steps down to 1 ft and none fits where it sits.', 'Probé con pasos más chicos, hasta de 1 pie, y ninguno cabe donde está.')
F('Try a smaller step, or say how big it should be.', 'Intenta con un paso más chico, o dime el tamaño que quieres.')
F('Try a smaller step.', NO_STEP)
F('Try one room at a time, or tell me what the space is for and I will redraw it.', 'Intenta con una habitación a la vez, o dime para qué quieres el espacio y lo vuelvo a dibujar.')
F('Try two rooms of about the same size, or tell me what you want next to what and I will redraw it.', 'Intenta con dos habitaciones de tamaño parecido, o dime qué quieres junto a qué y lo vuelvo a dibujar.')
F('That change did not work out on this plan.', 'Ese cambio no funcionó en este plano.')
F('Tell me what you would like changed about it instead.', 'Mejor dime qué te gustaría cambiarle.')
F('The drafter sees the details.', 'El dibujante ve los detalles.')
F('Front porch or back porch?', '¿El porche del frente o el de atrás?')
F('Tell me what to do with that room: bigger, smaller, add one, or remove it.', 'Dime qué hacer con esa habitación: hacerla más grande, más chica, agregar otra o quitarla.')
F('Which two rooms should trade places? Say it like "swap the office and the dining room".', '¿Cuáles dos habitaciones quieres intercambiar? Dilo así: "cambia de lugar la oficina y el comedor".')
F('I did not catch which room you mean. Try "make the kitchen bigger", "add an office", "make the house 2,400 sf", or "swap the office and the dining room".', 'No entendí a qué habitación te refieres. Intenta con "haz la cocina más grande", "agrega una oficina", "que la casa sea de 2,400 pies²" o "cambia de lugar la oficina y el comedor".')
F('How big should the house be? Tell me the living area you want, like "make the house 2,400 sf".', '¿De qué tamaño quieres la casa? Dime el área habitable que quieres, por ejemplo "que la casa sea de 2,400 pies²".')
F('A size below zero? Say the living area you want, like "make the house 2,400 sf".', '¿Un tamaño menor que cero? Dime el área habitable que quieres, por ejemplo "que la casa sea de 2,400 pies²".')
F('Give a size between 600 and 10,000 sf.', 'Da un tamaño entre 600 y 10,000 pies².')
F('That change did not come through as a list of steps.', 'Ese cambio no llegó completo.')
F('That change did not come through whole.', 'Ese cambio no llegó completo.')
F('That change is not valid.', 'Ese cambio no es válido.')
F('Say how many bedrooms or bathrooms the house should have, like "4 bedrooms".', 'Dime cuántas recámaras o baños debe tener la casa, por ejemplo "4 recámaras".')
F('A resize needs a width and a depth in feet.', 'Para cambiar el tamaño necesito el ancho y el largo en pies.')
F('A garage can hold 1 to 4 cars.', 'La cochera puede ser para 1 a 4 carros.')
F('A move needs a distance east or west and toward the street or the back.', 'Para mover una habitación necesito la distancia hacia el este o el oeste, y hacia la calle o hacia atrás.')
F('A new draft needs a program.', 'Para un nuevo dibujo necesito saber qué habitaciones lleva.')
F('Houses here sit on a slab; there is no basement in this plan.', 'Aquí las casas van sobre una losa de concreto; este plano no lleva sótano.')
F('That is not something this plan can hold (the lot and the kit draw the house only).', 'Eso no es algo que este plano pueda llevar: aquí solo se dibuja la casa.')
F("Colours and finishes are picked with the drafter once the plan is set; the kit's finishes (board and batten, stone, shingles) are on the sheet.", 'Los colores y los acabados se escogen con el dibujante cuando el plano ya está definido; los acabados del estilo (tabla y listón, piedra, tejas) vienen en la hoja.')
F("You've used the free changes on this plan. The office will add more for you. Want me to let them know?", 'Ya usaste los cambios incluidos en este plano. La oficina te agrega más. ¿Quieres que les avise?')
F('There is nothing to undo yet.', 'Todavía no hay nada que deshacer.')
F('That change is back on your plan.', 'Ese cambio regresó a tu plano.')
F('Tap Undo below the chat to take the last change off; it comes back to your plan.', 'Toca Deshacer, debajo del chat, para quitar el último cambio; ese cambio regresa a tu plano.')
F('Something went wrong on our side. Try again in a moment.', 'Algo salió mal de nuestro lado. Intenta de nuevo en un momento.')
F('This design is with the drafters now, so it cannot change.', 'Este diseño ya está con los dibujantes, así que no se puede cambiar.')
F('Ask the office to set up my meeting', ASK_LABEL_ES.meeting)
F('Ask the office for more changes', ASK_LABEL_ES['more-changes'])
F('same size', 'mismo tamaño')
F('Next to which room?', '¿Junto a cuál habitación?')
F('What I can do now is give that space more room. Pick one below; a change is used only when you pick.', 'Lo que sí puedo hacer ahora es darle más espacio a esa área. Escoge una opción abajo; solo se usa un cambio cuando escoges.')
F('I also tried giving those rooms more space, and none of them can grow where it sits on this lot.', 'También probé darles más espacio a esas habitaciones, y ninguna puede crecer donde está en este lote.')
F('Tell me which room should get more space and I will make it bigger.', 'Dime a qué habitación quieres darle más espacio y la hago más grande.')
F("I can't do that one.", 'Eso no lo puedo hacer.')
F('There is no garage in this plan; say "add a garage".', 'Este plano no tiene cochera; di "agrega una cochera".')
F('That is the same room twice.', 'Es la misma habitación dos veces.')
F('A porch and a room cannot trade places.', 'Un porche y una habitación no pueden cambiar de lugar.')
F('The plan already has a garage.', 'El plano ya tiene cochera.')
F('There is no free wall at the laundry for a garage.', 'No hay una pared libre junto a la lavandería para una cochera.')
F('There is no room for a garage against the laundry on this plan.', 'En este plano no hay espacio para una cochera junto a la lavandería.')
F('There is no exterior front door into the house.', 'La casa no tiene puerta principal hacia afuera.')
// round 13: a request nobody could read, and two wishes that pull against each other
F('I did not catch that.', 'No te entendí.')
F('Here are some changes that work on this plan. Tap one, or tell me in your own words what you would like; a change is used only when you tap one.', 'Aquí hay algunos cambios que sí funcionan en este plano. Toca uno, o dime con tus palabras qué te gustaría; solo se usa un cambio cuando tocas uno.')
F('Tell me what you would like to change, like "make the kitchen bigger" or "add an office".', 'Dime qué te gustaría cambiar, por ejemplo "haz la cocina más grande" o "agrega una oficina".')
F('Tap the button to see it; a change is used only when you tap.', 'Toca el botón para verla; solo se usa un cambio cuando lo tocas.')
S(String.raw`A smaller house with more (bed|bath)rooms is two wishes that pull against each other: every (?:bed|bath)room needs floor area of its own, so the other rooms have to give some up\.`, (m) => `Una casa más chica y con más ${m[1] === 'bed' ? 'recámaras' : 'baños'} son dos deseos que jalan cada uno para su lado: ${m[1] === 'bed' ? 'cada recámara' : 'cada baño'} necesita su propio espacio, así que las demás habitaciones tienen que ceder un poco.`)
S(String.raw`This plan is (${N}) sf with (\d+) (bed|bath)rooms?\.`, (m) => `Este plano tiene ${m[1]} pies² con ${countEs(m[2], m[3])}.`)
S(String.raw`What I can draw is a house a little smaller, about (${N}) sf, with (\d+) (bed|bath)rooms?\.`, (m) => `Lo que sí puedo dibujar es una casa un poco más chica, de unos ${m[1]} pies², con ${countEs(m[2], m[3])}.`)
S(String.raw`(\d+) (bed|bath)rooms? do(?:es)? not fit in a smaller house on this lot\.`, (m) => `${cap(countEs(m[1], m[2]))} no caben en una casa más chica en este lote.`)
S(String.raw`A smaller house with (\d+) (bed|bath)rooms? does not fit on this lot at room sizes that work\.`, (m) => `Una casa más chica con ${countEs(m[1], m[2])} no cabe en este lote con habitaciones de un tamaño que funcione.`)
S(String.raw`What I can do is keep the house about the size it is, with (\d+) (bed|bath)rooms?\.`, (m) => `Lo que sí puedo hacer es dejar la casa más o menos del tamaño que tiene, con ${countEs(m[1], m[2])}.`)
S(String.raw`More (bed|bath)rooms do not fit on this lot, in a smaller house or in this one\.`, (m) => `Más ${m[1] === 'bed' ? 'recámaras' : 'baños'} no caben en este lote, ni en una casa más chica ni en esta.`)
S(String.raw`What I can draw is the smaller house, about (${N}) sf, with the (\d+) (bed|bath)rooms? it has now\.`, (m) => `Lo que sí puedo dibujar es la casa más chica, de unos ${m[1]} pies², con ${theCountEs(m[2], m[3])} que tiene ahora.`)
S(String.raw`I could not find a way to draw both on this lot\. Tell me which matters more, the smaller house or the (bed|bath)rooms, and I will draw that\.`, (m) => `No encontré la manera de dibujar las dos cosas en este lote. Dime qué te importa más, la casa más chica o ${m[1] === 'bed' ? 'las recámaras' : 'los baños'}, y dibujo eso.`)
S(String.raw`This plan already has (\d+) (bed|bath)rooms?, the most this style is drawn with\.`, (m) => `Este plano ya tiene ${countEs(m[1], m[2])}, lo máximo con que se dibuja este estilo.`)

// ── a change the plan's rules refuse (ahead of the sentences for a change that went through: "Adding an office runs past …") ──
const WHAT = String.raw`(Taking out the|Resizing the|Moving the|Adding an?|Swapping the|A \d-car garage|That change)( [^.]+?)?`
const whatEs = (kind, rest) => {
  const r = String(rest || '').trim()
  if (kind === 'Taking out the') return `Quitar ${el(r)}`
  if (kind === 'Resizing the') return `Cambiar el tamaño ${del(r)}`
  if (kind === 'Moving the') return `Mover ${el(r)}`
  if (/^Adding/.test(kind)) return `Agregar ${un(r)}`
  if (kind === 'Swapping the') return `Intercambiar ${r.split(' and the ').map(el).join(' y ')}`
  if (/garage/.test(kind)) return `Una ${carsEs(kind.match(/\d/)[0])}`
  return 'Ese cambio'
}
S(String.raw`${WHAT} (runs past .+?|covers more .+?|runs rooms .+?|leaves .+?|takes .+?|puts .+?), so the plan would not work as drawn\.`, (m) => `${whatEs(m[1], m[2])} ${verbEs(m[3]) || 'rompe una regla del plano'}, así que el plano no funcionaría como está dibujado.`)
S(String.raw`${WHAT} does not work on this plan as it is drawn\.`, (m) => `${whatEs(m[1], m[2])} no funciona en este plano tal como está dibujado.`)
S(String.raw`Every house needs an? (.+?), so that one stays\.`, (m) => `Toda casa necesita ${un(m[1])}, así que ${fem(m[1]) ? 'esa' : 'ese'} se queda.`)
S(String.raw`The plan also has a problem from before(?:: (.+?))?\.(?= The drafter sees)`, (m) => `Además, el plano ya traía un problema${m[1] ? `: ${becauseEs(m[1], 'una regla del plano no se cumple')}` : ''}.`)
S(String.raw`The change itself is fine, but this plan already has a problem that has to go first(?:: (.+?))?\. Ask me to fix that, or go back one version; the drafter sees the details\.`, (m) => `El cambio en sí está bien, pero este plano ya trae un problema que hay que resolver primero${m[1] ? `: ${becauseEs(m[1], 'una regla del plano no se cumple')}` : ''}. Pídeme que lo arregle, o regresa una versión; el dibujante ve los detalles.`)

// ── undo, the office ──
S(String.raw`Back to version (\d+)\.`, (m) => `Regresé a la versión ${m[1]}.`)
F('Done, the house is back to how it was.', 'Listo, la casa quedó como estaba.')
S(String.raw`(\d+) changes? returned\.`, (m) => `Te devolvimos ${m[1]} ${m[1] === '1' ? 'cambio' : 'cambios'}.`)
S(String.raw`(\d+) changes? used`, (m) => (m[1] === '1' ? '1 cambio usado' : `${m[1]} cambios usados`))
S(String.raw`Undid "([^"]*)"\.`, (m) => `Deshice "${m[1]}".`)
S(String.raw`Could not go back: .*`, () => 'No se pudo regresar a esa versión.')
S(String.raw`Thanks! The office will reach out within 1 business day\. You can also call ([^.]+)\.`, (m) => `¡Gracias! La oficina se comunicará contigo en 1 día hábil. También puedes llamar al ${m[1]}.`)
S(String.raw`Done\. The office has your request and usually adds more within 1 business day\. You can also call ([^.]+)\.`, (m) => `Listo. La oficina ya tiene tu solicitud y normalmente agrega más cambios en 1 día hábil. También puedes llamar al ${m[1]}.`)
S(String.raw`Sign in with your email first so the office knows which house is yours\. Then this button sends your request\. You can also call ([^.]+)\.`, (m) => `Primero inicia sesión con tu correo para que la oficina sepa cuál casa es la tuya. Después este botón envía tu solicitud. También puedes llamar al ${m[1]}.`)
S(String.raw`The office did not get that just now\. Try again in a moment, or call ([^.]+)\.`, (m) => `La oficina no recibió eso en este momento. Intenta de nuevo en un momento, o llama al ${m[1]}.`)

// round 15, B6: "make it nicer"
F('Here are some ways to make it nicer on this plan. Tap one; choosing a style is free, and a change is used only when the plan changes.', 'Aquí tienes algunas maneras de dejarla más bonita en este plano. Toca una; escoger otro estilo no usa nada, y solo se usa un cambio cuando el plano cambia.')
F('The windows and the porch cannot grow on this plan as it sits on this lot; another style is the way to change its look. Choosing a style is free.', 'Las ventanas y el porche no pueden crecer en este plano tal como queda en este lote; otro estilo es la manera de cambiar cómo se ve. Escoger un estilo no usa nada.')
F('Make the windows bigger', 'Haz las ventanas más grandes')
F('Making the windows wider.', 'Hice las ventanas más anchas.')
F('Choose another style', 'Escoge otro estilo para la casa')
F('Add a front porch', 'Agrega un porche al frente')
S(String.raw`Add a front porch, (${N}) ft by (${N}) ft`, (m) => `Agrega un porche al frente, de ${m[1]} por ${m[2]} pies`)
S(String.raw`Make the front porch (${N}) ft deeper`, (m) => `Haz el porche del frente ${pies(m[1])} más profundo`)
S(String.raw`Made (\d+) windows? wider \((.+?)\)\.`, (m) => `Hice ${m[1] === '1' ? 'una ventana más ancha' : `${m[1]} ventanas más anchas`} (${listEs(m[2])}).`)

// round 15, U2: "send my lot to the drafter"
F('Your lot is with our drafter now. A drafter designs a house for this lot and emails you, usually within two business days.', 'Tu lote ya está con nuestro dibujante. Un dibujante diseña una casa para este lote y te escribe por correo, por lo general en dos días hábiles.')
F('This plan has no lot of its own yet. Choose your lot first, and then a drafter can design a house for it.', 'Este plano todavía no tiene un lote propio. Primero escoge tu lote, y después un dibujante puede diseñar una casa para él.')
F('Sign in first, so we can save your lot and send it to a drafter.', 'Primero inicia sesión, para que podamos guardar tu lote y enviarlo a un dibujante.')
F('We could not reach the office. Try again in a minute.', 'No pudimos comunicarnos con la oficina. Intenta de nuevo en un minuto.')

// ── what the chat cannot take ──
S(String.raw`(.+?) is one story for now; a second story is on the list, not drawn yet\.`, (m) => `Por ahora el estilo ${styleEs(m[1])} es de un solo piso; el segundo piso está en la lista, pero todavía no se dibuja.`)
S(String.raw`That nets out to no change: making the (.+?) (bigger and then smaller|smaller and then bigger) again leaves it as it is\.`, (m) => `Eso se cancela solo: ${m[2].startsWith('bigger') ? 'agrandar y luego achicar' : 'achicar y luego agrandar'} ${el(m[1])} ${fem(m[1]) ? 'la' : 'lo'} deja como está.`)
S(String.raw`I do not know how to "[^"]*" a room\.`, () => 'No sé cómo hacer ese cambio en una habitación.')
S(String.raw`There is no room "([^"]*)" (?:in this plan|to swap with|to move next to)\.`, (m) => `No hay ninguna habitación "${m[1]}" en este plano.`)
S(String.raw`The .+? kit has no "[^"]*" room\.`, () => 'Este estilo no tiene ese tipo de habitación.')
S(String.raw`The .+? kit does not have that room yet\.`, () => 'Este estilo todavía no tiene esa habitación.')

// ── counts ──
S(String.raw`This plan already has ${COUNT}\.`, (m) => `Este plano ya tiene ${countHalfEs(m[1], m[2], m[3])}.`)
S(String.raw`(.+?) is drawn with (\d+) to (\d+) (bed|bath)rooms, so (\d+) (?:bed|bath)rooms? is outside what I can draw\. This plan has (\d+)\.`, (m) => `El estilo ${styleEs(m[1])} se dibuja con ${m[2]} a ${countEs(m[3], m[4])}, así que ${countEs(m[5], m[4])} queda fuera de lo que puedo dibujar. Este plano tiene ${m[6]}.`)
S(String.raw`The house now has ${COUNT}; it had ${HAD}\.`, (m) => `Ahora la casa tiene ${countHalfEs(m[1], m[2], m[3])}; antes tenía ${hadEs(m[4], m[2], m[5], m[6])}.`)
S(String.raw`Drew the house again with ${COUNT}; it had ${HAD}\. It is (${N}) sf of living area on the (\S+) plan\.`, (m) => `Volví a dibujar la casa con ${countHalfEs(m[1], m[2], m[3])}; antes tenía ${hadEs(m[4], m[2], m[5], m[6])}. Quedó de ${m[7]} pies² de área habitable, en ${planEs(m[8])}.`)
S(String.raw`${COUNT} do(?:es)? not fit on this lot: (.+?)\. This plan has ${HAD}\.`, (m) => `${cap(countHalfEs(m[1], m[2], m[3]))} no ${m[1] === '1' && !m[3] ? 'cabe' : 'caben'} en este lote: ${becauseEs(m[4])}. Este plano tiene ${hadEs(m[5], m[2], m[6], m[7])}.`)
S(String.raw`Setting the house to (.+?)\.`, (m) => `La casa queda con ${m[1].replace(/ and a half bath/g, ' y medio').split(' and ').map((c) => { const k = c.match(/^(\d+) (bed|bath)\w*( y medio)?/); return k ? countHalfEs(k[1], k[2], k[3]) : c }).join(' y ')}.`)
S(String.raw`There is no (Bedroom|Bath) (\d+); this plan has (?:(?:Bedrooms|Baths) (\d+)–(\d+)|(?:Bedroom|Bath) (\d+)|no (?:bedroom|bath) by number)\.`, (m) => {
  const bed = m[1] === 'Bedroom'
  const has = m[3] ? `${bed ? 'las Recámaras' : 'los Baños'} ${m[3]} a ${m[4]}` : m[5] ? `${bed ? 'la Recámara' : 'el Baño'} ${m[5]}` : null
  return `No hay ${bed ? 'Recámara' : 'Baño'} ${m[2]}; este plano ${has ? `tiene ${has}` : `no tiene ${bed ? 'recámaras' : 'baños'} con número`}.`
})
S(String.raw`This plan already has the most (.+?)s this lot holds \((\d+)\)\.`, (m) => `Este plano ya tiene el máximo de ${pluralEs(bare(m[1]))} que caben en este lote (${m[2]}).`)
S(String.raw`This plan holds up to (\d+) (.+?)s( on this lot)?; it has (\d+)\. Ask for (\d+) more at most(?: \(one\))?\.`, (m) => `Este plano admite hasta ${m[1]} ${pluralEs(bare(m[2]))}${m[3] ? ' en este lote' : ''}; tiene ${m[4]}. Pide cuando mucho ${m[5]} más.`)

// ── a porch, a patio ──
S(String.raw`A (covered patio|rear porch|front porch) at the (?:back|front) does not fit as asked: (.+?)\.(?= (?:Here is what would work:|Tell me which room could))`, (m) => `${cap(porchEs(m[1]))} no cabe como lo pediste: ${becauseEs(m[2], 'el plano no funcionaría como está dibujado')}.`)
S(String.raw`Adding a covered patio at the (back|front) of the house(?:, (${N}) by (${N}) feet)?\. On the plan it is labelled (Rear Porch|Front Porch)\.`, (m) => `Agregué un patio techado ${m[1] === 'back' ? 'en la parte de atrás' : 'al frente'} de la casa${m[2] ? `, de ${m[2]} por ${m[3]} pies` : ''}. En el plano aparece como ${m[4] === 'Rear Porch' ? 'porche de atrás' : 'porche del frente'}.`)
S(String.raw`Adding a (rear porch|front porch)(?:, (${N}) by (${N}) feet)?\.`, (m) => `Agregué ${m[1] === 'rear porch' ? 'un porche atrás' : 'un porche al frente'}${m[2] ? `, de ${m[2]} por ${m[3]} pies` : ''}.`)

// ── bigger, smaller ──
S(String.raw`(.+?) cannot get that much bigger here: (.+?)\.(?= (?:What does fit is|I tried smaller steps|Tell me which room next to it))`, (m) => `${cap(el(m[1]))} no puede crecer tanto aquí: ${becauseEs(m[2])}.`)
S(String.raw`What does fit is (.+?)\.`, (m) => `Lo que sí cabe es ${grewEs(m[1])}.`)
// round 15, U12: a room that cannot grow as asked, in one sentence
S(String.raw`(.+?) can only grow ((?:${N} ft (?:wider|longer))(?: and ${N} ft (?:wider|longer))?) here: (.+?)\.`, (m) => `${cap(el(m[1]))} solo puede crecer ${grewEs(m[2])} aquí: ${becauseEs(m[3])}.`)
S(String.raw`(.+?) cannot get bigger (where it sits|here): (.+?)\.`, (m) => `${cap(el(m[1]))} no puede crecer ${m[2] === 'here' ? 'más' : 'donde está'}: ${becauseEs(m[3])}.`)
// round 15, U4: a room added that has no room where it would go
S(String.raw`There is no room for an? (.+?) (where it would go|on this lot): (.+?)\.`, (m) => `No hay espacio para ${un(m[1])} ${m[2] === 'on this lot' ? 'en este lote' : 'donde iría'}: ${becauseEs(m[3])}.`)
F('Tell me which room could give up some space for it.', 'Dime qué habitación podría ceder un poco de espacio.')
F('Tell me where you would like it instead.', 'Dime dónde la quieres mejor.')
F('Tell me what you would like instead.', 'Dime qué te gustaría mejor.')
F('That change did not work out on this plan. Tell me what you would like instead.', 'Ese cambio no funcionó en este plano. Dime qué te gustaría mejor.')
S(String.raw`The (.+?) in this kit goes up to (${N})' by (${N})'; (${N})' by (${N})' is past that\.`, (m) => `En este estilo ${el(m[1])} llega hasta ${m[2]} por ${m[3]} pies; ${m[4]} por ${m[5]} pies se pasa de eso.`)
S(String.raw`Making the (.+?) about (\d+) percent (bigger|smaller)\.`, (m) => `Hice ${el(m[1])} más o menos un ${m[2]} por ciento más ${m[3] === 'bigger' ? 'grande' : fem(m[1]) ? 'chica' : 'chico'}.`)
S(String.raw`Making the (.+?) (${N}) (?:feet|foot) (wider|deeper|narrower|shorter|bigger each way|smaller each way)\.`, (m) => `Hice ${el(m[1])} ${pies(m[2])} ${m[3] === 'wider' ? `más ${fem(m[1]) ? 'ancha' : 'ancho'}` : m[3] === 'deeper' ? `más ${fem(m[1]) ? 'larga' : 'largo'}` : m[3] === 'narrower' ? `más ${fem(m[1]) ? 'angosta' : 'angosto'}` : m[3] === 'shorter' ? `más ${fem(m[1]) ? 'corta' : 'corto'}` : m[3].startsWith('bigger') ? 'más grande por cada lado' : `más ${fem(m[1]) ? 'chica' : 'chico'} por cada lado`}.`)
S(String.raw`Making the (.+?) (${N}) by (${N}) feet\.`, (m) => `Dejé ${el(m[1])} de ${m[2]} por ${m[3]} pies.`)
S(String.raw`(.+?) is now (${N})' by (${N})' \(was (${N})' by (${N})'\)\.`, (m) => `${cap(el(m[1]))} ahora mide ${m[2]} por ${m[3]} pies (antes ${m[4]} por ${m[5]}).`)

// ── the garage ──
S(String.raw`There is no room for (?:a (\d)-car|that) garage( with a tandem bay)?(?:, (side|front)-load,)? on this lot\.`, (m) => `En este lote no hay espacio para ${m[1] ? `una ${carsEs(m[1])}` : 'esa cochera'}${m[2] ? ' con un lugar en fila' : ''}${m[3] ? ` ${loadEs(m[3])}` : ''}.`)
S(String.raw`Making the garage (\d) cars?( with a tandem bay)?(?:, (side|front)-load)?\.`, (m) => `Dejé la ${carsEs(m[1])}${m[2] ? ' con un lugar en fila' : ''}${m[3] ? `, ${loadEs(m[3])}` : ''}.`)
S(String.raw`Making the garage (\d) cars?, (${N}) feet wide\.`, (m) => `Dejé la ${carsEs(m[1])}, de ${m[2]} pies de ancho.`)
S(String.raw`Adding a (\d)-car garage\.`, (m) => `Agregué una ${carsEs(m[1])}.`)
S(String.raw`(Garage is now|Added a) (\d)-car garage( \(tandem: one bay two cars deep\))?(?:, (side|front)-load)?, (${N})' wide\.`, (m) => `${m[1] === 'Added a' ? 'Agregué una' : 'La cochera ahora es una'} ${carsEs(m[2])}${m[3] ? ' (con un lugar en fila: dos carros, uno detrás del otro)' : ''}${m[4] ? `, ${loadEs(m[4])}` : ''}, de ${m[5]} pies de ancho.`)

// ── the size of the house ──
S(String.raw`Sizing the house to about (${N}) square feet\.`, (m) => `Dejé la casa en unos ${m[1]} pies².`)
S(String.raw`(${N}) sf of living area \(was (${N})\)\.`, (m) => `${m[1]} pies² de área habitable (antes ${m[2]}).`)
S(String.raw`The house is already about (${N}) sf\.`, (m) => `La casa ya mide alrededor de ${m[1]} pies².`)
S(String.raw`This plan draws (${N}) to (${N}) sf; (${N}) is outside that\.`, (m) => `Este plano se dibuja de ${m[1]} a ${m[2]} pies²; ${m[3]} queda fuera de eso.`)
S(String.raw`The smallest this plan goes with these rooms is about (${N}) sf\.`, (m) => `Lo más chico que llega este plano con estas habitaciones es alrededor de ${m[1]} pies².`)
S(String.raw`The smallest this house goes is about (${N}) sf; I drew it at (${N})(?: on the (\S+) plan)?\.`, (m) => `Lo más chico que llega esta casa es alrededor de ${m[1]} pies²; la dibujé de ${m[2]}${m[3] ? ` en ${planEs(m[3])}` : ''}.`)
S(String.raw`Re-drafted the house at (${N}) sf(?: on the (\S+) plan)?: stretching the rooms as they were (would not work|would run past the setbacks|would run past the space the city lets you build on|would not pass the plan rules)\.`, (m) => `Volví a dibujar la casa con ${m[1]} pies²${m[2] ? ` en ${planEs(m[2])}` : ''}: estirar las habitaciones como estaban ${m[3] === 'would not work' ? 'no funcionaría' : m[3] === 'would not pass the plan rules' ? 'no cumpliría las reglas del plano' : `se pasaría ${KEPT_DEL}`}.`)
S(String.raw`At (${N}) sf the rooms fall under their minimums(?:; the smallest this plan goes with these rooms is about (${N}) sf(, which is about where it is now)?)?\.`, (m) => `Con ${m[1]} pies² las habitaciones quedarían por debajo de sus tamaños mínimos${m[2] ? `; lo más chico que llega este plano con estas habitaciones es alrededor de ${m[2]} pies²${m[3] ? ', que es más o menos donde está ahora' : ''}` : ''}.`)
S(String.raw`At (${N}) sf this plan runs past (?:the setbacks on this lot|the space the city lets you build on)(?:; the largest it fits here with these rooms is about (${N}) sf(, which is about where it is now)?| \(.*?\))?\.`, (m) => `Con ${m[1]} pies² este plano se pasa ${KEPT_DEL}${m[2] ? `; lo más grande que cabe aquí con estas habitaciones es alrededor de ${m[2]} pies²${m[3] ? ', que es más o menos donde está ahora' : ''}` : ''}.`)
S(String.raw`A new draft with that does not fit this lot(?:: (.+?))?\.`, (m) => `Un nuevo dibujo con eso no cabe en este lote${m[1] ? `: ${becauseEs(m[1], 'las habitaciones no caben todas con un tamaño que funcione')}` : ''}.`)
S(String.raw`Drew (a new draft.*?) on the (\S+) plan: (${N}) sf of living area\.`, (m) => `Hice ${newDraftEs(m[1])} en ${planEs(m[2])}: ${m[3]} pies² de área habitable.`)
S(String.raw`Your earlier changes still stand: (.+?)\.(?=\s|$)`, (m) => `Sus cambios anteriores siguen en pie: ${m[1]}.`)
S(String.raw`Could not keep: (.+)\.(?=\s|$)`, (m) => `No se pudo conservar: ${[...m[1].matchAll(/"([^"]*)" \((.*?)\)(?=; "|$)/g)].map((k) => `"${k[1]}" (${becauseEs(k[2], 'no cupo en el nuevo dibujo')})`).join('; ') || 'un cambio anterior'}.`)
S(String.raw`The house moved (${N})' (east|west|toward the street|toward the back) on the lot to stay clear of the space the city keeps open along each edge\.`, (m) => `La casa se recorrió ${pies(m[1])} ${wayEs(m[2])} en el lote para no invadir el espacio que la ciudad mantiene libre a lo largo de cada orilla.`)

// ── add, remove, move, swap ──
S(String.raw`Adding (\d+) (.+?)s( next to the .+?)?\.`, (m) => `Agregué ${m[1]} ${pluralEs(bare(m[2]))}${m[3] ? ` junto ${al(m[3].replace(' next to the ', ''))}` : ''}.`)
S(String.raw`Adding an? ([^.]+?)(?: next to the ([^.]+?))?\.`, (m) => `Agregué ${un(m[1])}${m[2] ? ` junto ${al(m[2])}` : ''}.`)
S(String.raw`Removing the ([^.]+?)\.`, (m) => `Quité ${el(m[1])}.`)
S(String.raw`Removed ([^.]+?)\.`, (m) => `Quité ${el(m[1])}.`)
S(String.raw`Added (.+?), (${N})' by (${N})' \((${N}) sf\)(?: next to the (.+?)| (off the hallway))?\.`, (m) => `Agregué ${un(m[1])}, de ${m[2]} por ${m[3]} pies (${m[4]} pies²)${m[5] ? ` junto ${al(m[5])}` : m[6] ? ', por el pasillo' : ''}.`)
S(String.raw`Moving the (.+?) (${N}) feet (toward the street|toward the back|east|west|left|right|north|south)\.`, (m) => `Moví ${el(m[1])} ${pies(m[2])} ${wayEs(m[3])}.`)
S(String.raw`Moving the (.+?) next to the ([^.]+?)\.`, (m) => `Moví ${el(m[1])} junto ${al(m[2])}.`)
S(String.raw`Moved (.+?) next to the ([^.]+?)\.`, (m) => `Moví ${el(m[1])} junto ${al(m[2])}.`)
S(String.raw`Moved (.+?) (${N})' (east|west|toward the street|toward the back)\.`, (m) => `Moví ${el(m[1])} ${pies(m[2])} ${wayEs(m[3])}.`)
S(String.raw`The (.+?) is already next to the ([^.]+?)\.`, (m) => `${cap(el(m[1]))} ya está junto ${al(m[2])}.`)
S(String.raw`Swapping the (.+?) and the (.+?) does not work on this plan: the two rooms are too different in size to trade places\.`, (m) => `Intercambiar ${el(m[1])} y ${el(m[2])} no funciona en este plano: las dos habitaciones son de tamaños demasiado distintos para cambiar de lugar.`)
S(String.raw`Swapping the ([^.]+?) and the ([^.]+?)\.`, (m) => `Intercambié ${el(m[1])} y ${el(m[2])}.`)
S(String.raw`Swapped the ([^.]+?) and the ([^.]+?)\.`, (m) => `Intercambié ${el(m[1])} y ${el(m[2])}.`)
S(String.raw`There is no (.+?) in this plan to swap\.`, (m) => `En este plano no hay ${bare(m[1])} para intercambiar.`)
S(String.raw`There is no ([^.;]+?) in this plan\.`, (m) => `En este plano no hay ${bare(m[1])}.`)
S(String.raw`There is no sound spot for the (.+?) against the ([^.:]+?)(: it would only open into the .+?, and it needs a door from the house)?\.`, (m) => `No hay un lugar adecuado para ${el(m[1])} junto ${al(m[2])}${m[3] ? `: solo tendría entrada por ${el(m[2])}, y necesita una puerta desde la casa` : ''}.`)
S(String.raw`There is no sound spot for an? ([^.]+?)\.`, (m) => `No hay un lugar adecuado para ${un(m[1])}.`)
S(String.raw`The plan already has an? ([^.]+?)\.`, (m) => `El plano ya tiene ${un(m[1])}.`)
S(String.raw`There is no free wall for an? ([^.]+?)\.`, (m) => `No hay una pared libre para ${un(m[1])}.`)
S(String.raw`(.+?) cannot grow that way: (.+?)\.(?=\s|$)`, (m) => `${cap(el(m[1]))} no puede cambiar así: ${becauseEs(m[2])}.`)
S(String.raw`That would not change anything: (.+?)\.(?=\s|$)`, (m) => `Eso no cambiaría nada: ${[...new Set(m[1].split('; ').map((it) => {
  let k
  if ((k = it.match(new RegExp(`^(.+) is already (${N})' by (${N})'$`)))) return `${el(k[1])} ya mide ${k[2]} por ${k[3]} pies`
  if ((k = it.match(/^the garage is already (\d) cars$/))) return `la cochera ya es para ${k[1]} carro${k[1] === '1' ? '' : 's'}`
  if (it === 'that room is already there') return 'esa habitación ya está ahí'
  return 'el plano ya tiene eso'
}))].join('; ')}.`)

// ── a request in parts ──
S(String.raw`Done: (.+?)\.(?=\s+(?:Not done:|I did the first|I didn't do:|Great question)|\s*$)`, (m) => `Hecho: ${m[1].split('; ').map(partEs).join('; ')}.`)
S(String.raw`Not done: (.+?)\.(?=\s)`, (m) => `No se hizo: ${m[1].split('; ').map(partEs).join('; ')}.`)
S(String.raw`I did the first (\d+); send (".*") next\.`, (m) => `Hice los primeros ${m[1]}; después manda ${m[2].replace(/"([^"]*)"/g, (q, t) => `"${partEs(t)}"`)}.`)
S(String.raw`I didn't do: (.+?)\.(?=\s+The change counts once|\s*$)`, (m) => {
  const notes = [...m[1].matchAll(/"([^"]*)"(?:: (.*?)| \(say which room, and what to change\))(?=; "|$)/g)].map((k) => {
    if (k[2] === undefined) return `"${k[1]}" (di qué habitación y qué quieres cambiarle)`
    if (k[2] === 'send that on its own and I will show what can be done') return `"${k[1]}": mándalo aparte y te muestro lo que se puede hacer`
    const why = run(`${k[2]}.`)
    return `"${k[1]}": ${why.missed.length ? 'eso no lo puede llevar este plano' : why.out.replace(/\.$/, '').replace(/^(\p{Lu})(?=\p{Ll})/u, (c) => c.toLowerCase())}`
  })
  return `No hice: ${notes.join('; ') || 'una parte de lo que pediste'}.`
})

// ── more open ──
S(String.raw`(The .+?) on this plan are already (one open space, with no walls between them|open to each other, with no wall between them)(?:, and the ceilings there are (${N}) ft where the bedrooms have (${N}))?\.`, (m) => `${cap(listEs(m[1]))} de este plano ya son ${m[2].startsWith('one') ? 'un solo espacio abierto, sin paredes de por medio' : 'un espacio abierto entre sí, sin pared de por medio'}${m[3] ? `, y ahí los techos son de ${m[3]} pies, mientras que en las recámaras son de ${m[4]}` : ''}.`)
S(String.raw`(The .+?|[A-Z].+?) (have their|has its) own walls on this plan\.`, (m) => `${cap(listEs(m[1]))} ${m[2] === 'has its' ? 'tiene' : 'tienen'} sus propias paredes en este plano.`)
S(String.raw`Taking out (other walls|a wall) or raising a ceiling is not something I can draw from here; bring that up with the office\.`, (m) => `Quitar ${m[1] === 'a wall' ? 'una pared' : 'otras paredes'} o subir un techo no es algo que yo pueda dibujar desde aquí; coméntalo con la oficina.`)

// ── the rules, as plain.js words them, and the fit ──
S(String.raw`(.+?) would (?:sit|end up) too close to (the side of the lot|the back of the lot|the street|the side street|the street side \(.+?\)) \(the city keeps (${N}) ft open there\)\.`, (m) => `${cap(el(m[1]))} quedaría demasiado cerca ${edgeEs(m[2])} (ahí la ciudad mantiene ${pies(m[3])} libres).`)
S(String.raw`(.+?) would cross the setback at (${N}) ft from ([^.]+)\.`, (m) => `${cap(el(m[1]))} quedaría demasiado cerca ${edgeEs(m[3])} (ahí la ciudad mantiene ${pies(m[2])} libres).`)
S(String.raw`(.+?) would cross the (?:setback|space the city keeps open along that edge)[^.]*\.`, (m) => `${cap(el(m[1]))} quedaría dentro del espacio que la ciudad mantiene libre a lo largo de cada orilla del lote.`)
S(String.raw`(.+?) would run into ([^.]+?)\.`, (m) => `${cap(el(m[1]))} chocaría con ${el(m[2])}.`)
S(String.raw`(.+?) would be (${N})' by (${N})', under the (${N})' by (${N})' minimum\.`, (m) => `${cap(el(m[1]))} quedaría de ${m[2]} por ${m[3]} pies, por debajo del mínimo de ${m[4]} por ${m[5]} pies.`)
S(String.raw`(.+?) would be under 70 square feet, the code minimum for a living space\.`, (m) => `${cap(el(m[1]))} quedaría con menos de 70 pies², el mínimo que pide el reglamento para un espacio habitable.`)
S(String.raw`(.+?) at (${N})' is longer than we can roof in this style \((${N})' max\)\.`, (m) => `${cap(el(m[1]))}, con ${m[2]} pies, es más larga de lo que podemos techar en este estilo (máximo ${m[3]} pies).`)
S(String.raw`The house would cover (${N}) square feet of the lot; this lot allows (${N})\.`, (m) => `La casa cubriría ${m[1]} pies² del lote; este lote permite ${m[2]}.`)
S(String.raw`Every house needs an? ([^.]+?)\.`, (m) => `Toda casa necesita ${un(m[1])}.`)
S(String.raw`The house(, driveway and walk| and porches) cover (${N})% of the lot \((${N}) of (${N}) sf\); (.+?) allows (${N})%[^.]*\.`, (m) => `La casa${m[1].startsWith(',') ? ', la entrada de carros y la banqueta' : ' y los porches'} cubren el ${m[2]}% del lote (${m[3]} de ${m[4]} pies²); ${m[5] === 'the city' ? 'la ciudad' : m[5]} permite el ${m[6]}%.`)
S(String.raw`The house, porches, driveway and walk pave (${N})% of the lot \((${N}) of (${N}) sf\); (.+?) allows (${N})% impervious cover\.`, (m) => `La casa, los porches, la entrada de carros y la banqueta cubren con piso el ${m[1]}% del lote (${m[2]} de ${m[3]} pies²); ${m[4] === 'the city' ? 'la ciudad' : m[4]} permite el ${m[5]}%.`)
S(String.raw`(\d+) stories; (.+?) allows (\d+) stor(?:y|ies) here\.`, (m) => `${m[1]} pisos; ${m[2] === 'the city' ? 'la ciudad' : m[2]} permite ${m[3]} aquí.`)
S(String.raw`(.+?)'s overhead door is (${N}) ft from the property line; (.+?) asks (${N}) ft so a car can park outside the door\.`, (m) => `El portón ${del(m[1])} queda a ${pies(m[2])} de la línea del terreno; ${m[3] === 'the city' ? 'la ciudad' : m[3]} pide ${pies(m[4])} para que un carro se pueda estacionar afuera.`)
S(String.raw`(.+?) can only be reached through ([^.]+?)\.`, (m) => `A ${el(m[1])} solo se puede llegar pasando por ${el(m[2])}.`)
S(String.raw`(.+?) cannot be reached from the front door\.`, (m) => `No se puede llegar a ${el(m[1])} desde la puerta principal.`)
S(String.raw`(.+?) has no door into the house\.`, (m) => `${cap(el(m[1]))} no tiene puerta hacia la casa.`)
S(String.raw`(.+?) has no overhead door\.`, (m) => `${cap(el(m[1]))} no tiene portón.`)
S(String.raw`(.+?) has no door\.`, (m) => `${cap(el(m[1]))} no tiene puerta.`)
S(String.raw`(.+?) has no window on an outside wall(, and is not open to a room that has one)?\.`, (m) => `${cap(el(m[1]))} no tiene ventana en una pared exterior${m[2] ? ', y no está abierta a una habitación que la tenga' : ''}.`)
S(String.raw`(.+?)'s window is too small for emergency exit \(.*?\)\.`, (m) => `La ventana ${del(m[1])} es demasiado chica para una salida de emergencia.`)
S(String.raw`(.+?) is not attached to the house\.`, (m) => `${cap(el(m[1]))} no está pegada a la casa.`)
S(String.raw`(.+?) does not open from the ([^.]+?)\.`, (m) => `A ${el(m[1])} no se entra desde ${el(m[2].replace(/ or its bath$/, ''))}.`)
S(String.raw`An? (\d)-car garage has no spot on this lot that a car can be driven to \(.*?\)\.`, (m) => `Una ${carsEs(m[1])} no tiene un lugar en este lote al que se pueda llegar en carro (de frente no cabe en el espacio que dejan las reglas de la ciudad, y por un lado no hay espacio para dar la vuelta).`)
S(String.raw`The lot's width caps this plan at about (${N}) sf\.`, (m) => `El ancho del lote limita este plano a unos ${m[1]} pies².`)
S(String.raw`This plan has to be trimmed to (${N})% to fit the lot\.`, (m) => `Este plano tendría que reducirse al ${m[1]}% para caber en el lote.`)
S(String.raw`Living area is (${N}) sf, (${N})% (over|under) the (${N}) sf asked for\.`, (m) => `El área habitable es de ${m[1]} pies², un ${m[2]}% ${m[3] === 'over' ? 'más' : 'menos'} que los ${m[4]} pies² que pidió.`)
S(String.raw`This lot is zoned (.+?) \((.+?)\)\. A house may need a rezoning; you can keep drafting, and the office will call you before it is sent on\.`, (m) => `Este lote tiene zonificación ${m[1]} (${m[2]}). Una casa podría necesitar un cambio de zonificación; puedes seguir dibujando, y la oficina te llamará antes de mandarlo.`)
S(String.raw`FEMA has no digital flood map for this spot; the county floodplain administrator sets the slab height\. The office asks before the slab is set\.`, 'FEMA no tiene un mapa digital de inundación para este lugar; el administrador de zonas inundables del condado define la altura de la losa. La oficina pregunta antes de definirla.')
S(String.raw`Inside a FEMA special flood hazard area \(zone (.+?)(?:, base flood elevation (${N}) ft)?\): the slab elevation and flood insurance follow the base flood elevation\.`, (m) => `Dentro de un área especial de riesgo de inundación de FEMA (zona ${m[1]}${m[2] ? `, elevación base de inundación de ${m[2]} pies` : ''}): la altura de la losa y el seguro contra inundación siguen la elevación base de inundación.`)
S(String.raw`Zone X \(shaded\), the 0\.2% annual-chance flood area: lenders and the city may ask for an elevation certificate\.`, 'Zona X (sombreada), el área con 0.2% de probabilidad anual de inundación: el banco y la ciudad pueden pedir un certificado de elevación.')

// ── buttons ──
S(String.raw`Make (.+?) bigger`, (m) => `Haz ${el(m[1])} más grande`)
S(String.raw`Make (.+?) smaller`, (m) => `Haz ${el(m[1])} más ${fem(m[1]) ? 'chica' : 'chico'}`)
S(String.raw`Make the (.+?) (${N})' by (${N})' instead\?`, (m) => `Mejor deja ${el(m[1])} de ${m[2]} por ${m[3]} pies`)
S(String.raw`Make (.+?) (${N}) ft shorter to make room for the (covered patio|rear porch|front porch)`, (m) => `Acorta ${el(m[1])} ${pies(m[2])} para dar lugar ${m[3] === 'covered patio' ? 'al patio techado' : m[3] === 'rear porch' ? 'al porche de atrás' : 'al porche del frente'}`)
S(String.raw`Make (.+?) ((?:${N} ft (?:wider|longer))(?: and ${N} ft (?:wider|longer))?)`, (m) => `Haz ${el(m[1])} ${grewEs(m[2])}`)
S(String.raw`Make it ${COUNT}`, (m) => `Déjala con ${countHalfEs(m[1], m[2], m[3])}`)
S(String.raw`Make it (${N}) sf`, (m) => `Déjala en ${m[1]} pies²`)
S(String.raw`Make it a (\d)-car garage instead\?`, (m) => `Mejor haz una ${carsEs(m[1])}`)
S(String.raw`Make the garage (\d) cars?`, (m) => `Haz la ${carsEs(m[1])}`)
S(String.raw`(\d)-car with a tandem bay \(one bay two cars deep\)\?`, (m) => `Haz la cochera para ${m[1]} carros, con un lugar en fila (dos carros, uno detrás del otro)`)
S(String.raw`Re-draft the house with a (\d)-car garage(?: \((\d+) earlier changes? would not carry over\))?`, (m) => `Vuelve a dibujar la casa con ${carsEs(m[1])}${m[2] ? ` (${m[2] === '1' ? '1 cambio anterior no se conservaría' : `${m[2]} cambios anteriores no se conservarían`})` : ''}`)
S(String.raw`Draw a (smaller|larger) house, about (${N}) sf, with (.+)`, (m) => `Dibuja una casa más ${m[1] === 'smaller' ? 'chica' : 'grande'}, de unos ${m[2]} pies², con ${withEs(m[3])}`)
F('Draw the house again with an office in place of a bedroom', 'Vuelve a dibujar la casa con una oficina en lugar de una recámara')
S(String.raw`Draw the house again with (.+)`, (m) => `Vuelve a dibujar la casa con ${withEs(m[1])}`)
S(String.raw`Make the house smaller, about (${N}) sf, and keep (\d+) (bed|bath)rooms?`, (m) => `Haz la casa más chica, de unos ${m[1]} pies², y deja ${theCountEs(m[2], m[3])}`)
S(String.raw`Keep the house about this size, with (\d+) (bed|bath)rooms?`, (m) => `Deja la casa más o menos de este tamaño, con ${countEs(m[1], m[2])}`)
S(String.raw`Add a smaller (covered patio|rear porch|front porch), (${N}) ft by (${N}) ft`, (m) => `Agrega ${m[1] === 'covered patio' ? 'un patio techado' : m[1] === 'rear porch' ? 'un porche atrás' : 'un porche al frente'} más chico, de ${m[2]} por ${m[3]} pies`)
// "show me garage options": the answer above the option drawings
const topicEs = (t) => (t === 'the garage' ? 'la cochera' : t === 'the porches' ? 'los porches' : t === 'the bedroom wing' ? 'el ala de las recámaras' : 'eso')
S(String.raw`(\d+) options for (the garage|the porches|the bedroom wing) that pass the checks on this lot\. Pick one: that is one change; looking is free\.`, (m) => `${m[1]} opciones para ${topicEs(m[2])} que pasan las revisiones en este lote. Escoge una: eso cuenta como un cambio; ver no usa ninguno.`)
S(String.raw`Only one sound option for (the garage|the porches|the bedroom wing) on this lot\.`, (m) => `Solo hay una opción buena para ${topicEs(m[1])} en este lote.`)
S(String.raw`No sound option for (the garage|the porches|the bedroom wing) on this lot: each one runs too close to an edge of the lot or breaks a plan rule\.`, (m) => `No hay ninguna opción buena para ${topicEs(m[1])} en este lote: cada una queda demasiado cerca de una orilla del lote o rompe una regla del plano.`)
// the suggestions under the chat
F('Bigger primary bath', 'Baño principal más grande')
S(String.raw`Show me (garage|porch|bedroom wing|bedroom) options`, (m) => `Muéstrame opciones para ${m[1] === 'garage' ? 'la cochera' : m[1] === 'porch' ? 'los porches' : 'las recámaras'}`)
S(String.raw`Add a porch on the back`, 'Agrega un porche atrás')
S(String.raw`Add a (\d)-car garage`, (m) => `Agrega una ${carsEs(m[1])}`)
S(String.raw`Add an? ([^.?]+?) next to ([^.?]+)`, (m) => `Agrega ${un(m[1])} junto ${al(m[2])}`)
S(String.raw`Add an? ([^.?]+)`, (m) => `Agrega ${un(m[1])}`)
S(String.raw`Remove the ([^.?]+)`, (m) => `Quita ${el(m[1])}`)
S(String.raw`Move the (.+?) (${N}) ft (west|east|toward the back|toward the street)\?`, (m) => `Mueve ${el(m[1])} ${pies(m[2])} ${wayEs(m[3])}`)
// what fits a lot, on the rooms step
F("Fits this lot and the city's rules for it.", 'Cabe en este lote y cumple las reglas de la ciudad para él.')
S(String.raw`Fits once trimmed about (${N})% to keep the space the city requires along the edges of this lot\.`, (m) => `Cabe si se reduce más o menos un ${m[1]}%, para respetar el espacio que la ciudad pide dejar libre a lo largo de las orillas de este lote.`)
S(String.raw`The house is turned (${N})° from square to the street, to sit in the widest part of your lot\.`, (m) => `La casa está girada ${m[1]}° respecto a la calle, para quedar en la parte más ancha de tu lote.`)
F('We started you with what fits this lot; you can change it.', 'Empezamos con lo que cabe en este lote; tú lo puedes cambiar.')
F('Checking the lot…', 'Revisando el lote…')
S(String.raw`The largest this plan fits here is (${N}) sf\.`, (m) => `Lo más grande que cabe aquí de este plano es ${m[1]} pies².`)
S(String.raw`It fits (smaller, as the (\S+) plan draws it|as (\d+) bed, (\d+)(\.5)? bath(?:, (\d)-car|, no garage)(, no office)? \(what the (\S+) plan holds\)|[^.]+)\.`, (m) => `Sí cabe ${fitLabelEs(m[1])}.`)
S(String.raw`Our smallest plan is about (${N}) by (${N}) ft, and the largest house that fits the space you can build on here is about (${N}) by (${N}) ft\.`, (m) => `Nuestro plano más chico mide más o menos ${m[1]} por ${m[2]} pies, y la casa más grande que cabe en el espacio donde se puede construir aquí es de unos ${m[3]} por ${m[4]} pies.`)
F('With the deed restriction (no garage facing the street) the garage has to load from the side or a side street, and that needs a wider lot. Try fewer cars, or no garage.', 'Por la restricción de la escritura (ninguna cochera de frente a la calle), la cochera tiene que tener la entrada por un lado o por una calle lateral, y para eso se necesita un lote más ancho. Intenta con menos carros, o sin cochera.')
F('Try fewer rooms or a smaller garage.', 'Intenta con menos habitaciones o con una cochera más chica.')
F('Try that', 'Probar eso')
S(String.raw`(Use|Set) (${N}) sf`, (m) => `Usar ${m[2]} pies²`)
S(String.raw`with a (\d)-car garage`, (m) => `con ${carsEs(m[1])}`)
S(String.raw`with (\d+) bedrooms`, (m) => `con ${countEs(m[1], 'bed')}`)
F('without the office or the garage', 'sin la oficina ni la cochera')
F('without the office', 'sin la oficina')
F('without the second suite', 'sin la segunda recámara principal')
F('without the garage', 'sin la cochera')

const EN_WORDS = /(?<![\p{L}\p{N}])(?:the|and|is|are|was|were|this|that|with|would|does|not|for|of|to|on|at|in|it|its|you|your|can|cannot|house|rooms?|lot|make|making|add|adding|added|bigger|smaller|wider|ft|sf|feet|by|from|here|there|have|had|already|will|what|which|next|street|city|keeps|changes?|used|try|tell|step|kitchen|bedrooms?|bathrooms?|bath|garage|office|living|dining|laundry|closet|setbacks?|draft|drafter)(?![\p{L}\p{N}])/iu // letters with accents are letters (\b would cut "así" at the í)
/** Words left in English in a text a Spanish speaker would read (what the client typed, in quotes, does not count). */
export function hasEnglish(text) {
  const t = String(text ?? '').replace(/"[^"]*"/g, ' ').replace(/South Texas Builders/g, ' ')
  return EN_WORDS.test(t)
}
// round 15, U15: the chat says tú, as the screens do. The usted forms a reply could carry (what the client typed, in
// quotes, does not count)
export const USTED = /(?<![\p{L}])(?:usted(?:es)?|dígame|dígalo|dígamelo|diga|toque|pídame|escoja|intente|inicie|llame al|mande|mándelo|coméntelo|regrese|¿quiere|¿puede|¿me (?:lo )?puede|también puede|puede seguir|su plano|sus palabras|su solicitud|su correo|le gustaría|le importa|le agregará|le muestro|le devolvi\p{L}*|se le devolvi\p{L}*|lo pidió|ya usó|se refiere|no le entendí)(?![\p{L}])/iu
/** Usted left in a text a Spanish speaker reads (the chat says tú). */
export function hasUsted(text) {
  return USTED.test(String(text ?? '').replace(/"[^"]*"|«[^»]*»/g, ' '))
}
/** A sentence that is Spanish already (Claude's own reply, the client's words), so it is left as it is. */
function looksSpanish(sentence) {
  return !hasEnglish(sentence) && (isSpanish(sentence) || !/[a-z]{3}/i.test(String(sentence).replace(/"[^"]*"/g, '')))
}

/** Translates sentence by sentence: { out, missed: the sentences no template knew }. */
function run(text, fallback = null) {
  let rest = String(text ?? '').trim()
  const parts = []
  const missed = []
  for (let guard = 0; rest && guard < 80; guard++) {
    let done = false
    for (const [re, fn] of RULES) {
      const m = re.exec(rest)
      if (!m || !m[0]) continue
      parts.push(fn(m))
      rest = rest.slice(m[0].length).trimStart()
      done = true
      break
    }
    if (done) continue
    // no template: one sentence is set aside (to its full stop before a capital letter, or the end)
    const m = /^[\s\S]*?[.!?:](?=\s+["“¿¡A-ZÁÉÍÓÚÑ0-9])/.exec(rest)
    const sentence = m ? m[0] : rest
    if (looksSpanish(sentence)) parts.push(sentence)
    else {
      missed.push(sentence)
      if (fallback === null) parts.push(sentence)
      else if (fallback && !parts.includes(fallback)) parts.push(fallback)
    }
    rest = rest.slice(sentence.length).trimStart()
  }
  return { out: parts.filter(Boolean).join(' '), missed }
}

/**
 * A sentence (or several) the plan code wrote for a homeowner, in Spanish. What is already Spanish stays as it is.
 * A sentence no template knows is left as written, or replaced by `fallback` when one is given (the chat gives
 * one, so a half-English reply never reaches a Spanish speaker).
 * @param {{ fallback?: string }} opts
 */
export function toSpanish(text, opts = {}) {
  const raw = String(text ?? '')
  if (!raw.trim()) return raw
  return run(raw, opts.fallback ?? null).out
}
/** The sentences of a text that toSpanish has no words for (for the tests, and for the chat's fallback). */
export const untranslated = (text) => run(text).missed
