// What a chat message asks for when it is not a change to the plan (round 15). Shared by the Draft screen (the chat
// with no account, and before it posts to the office) and by the office's change route, so both chat modes (the
// basic rules and Claude) answer the same way: these never reach a model and never use a change.
//
//   isSendLot(text)   "send my lot to the drafter", "can you send my lot to the drafter?", "mándale mi lote al
//                     dibujante", "que el dibujante diseñe mi casa": the lot goes to the drafter's queue for a house
//                     designed for it (what the button on the rooms step does).
//
// Read on meaning, not on one sentence: an action (send, give, pass, hand; mandar, enviar, pasar, dar, entregar) on
// the lot and the drafter, or the drafter asked to design or draw the house; please / por favor anywhere, a question
// ("can you…?", "¿puedes…?"), accents optional. "send it", "what does the drafter do?" are not it.
import { fold } from './es.js'

/** A message folded for reading: accents off, lower case, punctuation and please / por favor / thanks gone. */
export function plainWords(text) {
  return fold(String(text ?? ''))
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/'/g, '')
    .replace(/\b(?:please|pls|plz|kindly|thanks|thank you|thx|por favor|porfavor|porfa|plis|gracias|ok|okay|hey|hi|hola|oye|oiga)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── English ──────────────────────────────────────────────────────────────────────────────────────────────────
const DET = String.raw`(?:the|a|an|your|our|my|one of your|a real|your own)`
const DRAFTER = String.raw`(?:drafter|drafters|draftsman|draftsperson|designer|designers|architect|human drafter|house designer)`
const LOT = String.raw`(?:my|the|this|our) (?:lot|plot|land|property|parcel|lot info|lot details)`
const TO_DRAFTER = String.raw`(?:to|over to|on to|onto|with|for) ${DET} ${DRAFTER}`
const DESIGN = String.raw`(?:design|draw|make|do|create|plan|draft|lay out)`
const HOUSE = String.raw`(?:it|this|one|something|(?:my|a|the|our|this) (?:house|home|plan|design|floor ?plan))`
const FOR_LOT = String.raw`(?: (?:for|on) (?:me|us|it|my lot|this lot|the lot|my land|my property))?`
const EN_LEAD = String.raw`(?:(?:can|could|would|will) (?:you|u|ya|you guys|yall)(?: just)? |(?:can|could) (?:we|i) |i (?:want|need|would like|d like|wd like) (?:you |yall )?to |i want to |lets |let us |go ahead and |just |now )*`
const EN_TAIL = String.raw`(?: (?:now|instead|for me|for us|today|already|right now|asap|for a custom (?:design|house|plan)|so (?:they|he|she) can design (?:it|my house|a house|one)))*`
const EN = [
  // send / give / pass my lot (to the drafter)
  String.raw`(?:send|give|pass|hand|forward|submit)(?: over)? ${LOT}(?: over| along| in)?(?: ${TO_DRAFTER})?`,
  String.raw`(?:send|give|pass|hand|forward) ${DET} ${DRAFTER} ${LOT}`,
  // have the drafter design my house; i want a drafter to design my house
  String.raw`(?:have|let|get) ${DET} ${DRAFTER} (?:to )?${DESIGN} ${HOUSE}${FOR_LOT}`,
  String.raw`(?:i |we )?(?:want|need|would like|d like|wd like|prefer) ${DET} ${DRAFTER} to ${DESIGN} ${HOUSE}${FOR_LOT}`,
  // can a drafter design a house for my lot?
  String.raw`(?:can|could|will|would|should) ${DET} ${DRAFTER} ${DESIGN} ${HOUSE}${FOR_LOT}`,
  String.raw`${DET} ${DRAFTER} (?:should |can |could |will |please )?${DESIGN} ${HOUSE}${FOR_LOT}`,
].map((src) => new RegExp(String.raw`^${EN_LEAD}(?:${src})${EN_TAIL}$`))

// ── Spanish (folded: no accents) ─────────────────────────────────────────────────────────────────────────────
const DIBUJANTE = String.raw`(?:dibujante|dibujantes|disenador|disenadora|disenadores|arquitecto|arquitecta|proyectista)`
const DET_ES = String.raw`(?:el|un|su|tu|los|algun|al|a un|a el|a los|a su|a tu|con el|con un|con su|con tu|para el|para un|para su|pa(?:l| el))`
const LOTE = String.raw`(?:mi|el|este|nuestro|su|tu) (?:lote|terreno|solar|predio|lotecito)`
// mandar, enviar, pasar, dar, entregar: the command (tú, usted, ustedes), the infinitive, the present, with "le" / "selo"
const SEND_ES = String.raw`(?:mand|envi|pas|entreg)(?:a|e|en|ar|as|an|amos)(?:le|les|selo|sela|selos)?|(?:da|de|den|dar|das|dan)(?:le|les|selo|sela)|dale|denle|darle`
const DISENA = String.raw`(?:disene|disenen|dibuje|dibujen|haga|hagan|trace|tracen|planee|arme|diseña)`
const CASA = String.raw`(?:(?:mi|la|una|nuestra|esta|su|tu) (?:casa|casita|vivienda|plano|hogar)|el plano(?: de (?:mi|la) casa)?)`
const PARA_LOTE = String.raw`(?: (?:para|en|de) (?:mi|el|este|nuestro) (?:lote|terreno))?`
const ES_LEAD = String.raw`(?:(?:me|le|nos|se lo|se la)? ?(?:puedes|puede|pueden|podrias|podria|podrian|quieres|quiere|quieren|seria posible|se puede|favor de|me haces el favor de|me hace el favor de|hazme el favor de) |(?:quiero|quisiera|queremos|necesito|ocupo|me gustaria|nos gustaria|prefiero|mejor)(?: que)? |(?:le|les|me) |ya |mejor |entonces |nomas |solo )*`
const ES_TAIL = String.raw`(?: (?:ya|ahora|mejor|nomas|para que (?:me |lo |la )*(?:disene|dibuje|haga)(?: (?:la|mi|una) casa)?|para un diseno (?:a la medida|personalizado)))*`
const ES = [
  // mándale mi lote al dibujante; envíen mi lote al dibujante; pásale mi lote al dibujante
  String.raw`(?:${SEND_ES}) ${LOTE}(?: ${DET_ES} ${DIBUJANTE})?`,
  String.raw`(?:${SEND_ES}) ${DET_ES} ${DIBUJANTE} ${LOTE}`,
  // que el dibujante diseñe mi casa; quiero que un dibujante haga mi casa
  String.raw`(?:que )?(?:el|un|su|tu|algun|los) ${DIBUJANTE} (?:me |nos )?(?:lo |la )?${DISENA}(?: ${CASA})?${PARA_LOTE}`,
  // que lo diseñe el dibujante; que me haga la casa un dibujante
  String.raw`(?:que )?(?:me |nos )?(?:lo |la )?${DISENA}(?: ${CASA})?${PARA_LOTE} (?:el|un|su|tu|algun) ${DIBUJANTE}`,
  // quiero un dibujante que me haga la casa; quiero un dibujante para mi casa / para mi lote
  String.raw`(?:un|el) ${DIBUJANTE} (?:que|para que) (?:me |nos )?(?:lo |la )?${DISENA}(?: ${CASA})?${PARA_LOTE}`,
  String.raw`(?:un|el) ${DIBUJANTE} para (?:mi|la|el|este|nuestra|nuestro) (?:casa|lote|terreno|plano)`,
].map((src) => new RegExp(String.raw`^${ES_LEAD}(?:${src})${ES_TAIL}$`))

// ── "make it nicer", "hazla más bonita" (round 15, B6) ───────────────────────────────────────────────────────
const NICE_EN = String.raw`(?:nicer|prettier|more beautiful|beautiful|nice|pretty|better looking|look better|more attractive|fancier|more stylish|more charming|cuter|lovelier|more elegant|look nice|look nicer|look prettier|look good|look great|more appealing)`
const IT_EN = String.raw`(?:it|this|the house|my house|our house|the home|my home|the place|the outside|the front|the outside of the house|the front of the house|the design)`
const NICER_EN = [
  String.raw`(?:make|get|have) ${IT_EN}(?: look| feel)?(?: a (?:bit|little|lot))?(?: more)? ${NICE_EN}`,
  String.raw`(?:i |we )?(?:want|would like|d like|need) ${IT_EN} (?:to (?:look|be) )?(?:a (?:bit|little) )?${NICE_EN}`,
  String.raw`(?:i |we )?(?:want|would like|d like|need) (?:a )?(?:nicer|prettier|more beautiful|fancier) (?:house|home|design)`,
  // "nicer", "prettier" on its own (never "nice" or "beautiful" alone: that is praise)
  String.raw`(?:a (?:bit|little) |much |way )?(?:nicer|prettier|more beautiful|fancier|lovelier|more elegant|more stylish|more attractive|cuter|more charming)`,
  String.raw`(?:spruce|dress|jazz|pretty|fancy) (?:it|the house|the front) up`,
  String.raw`(?:more |some |give it (?:more |some )?)?curb appeal`,
  String.raw`(?:it|this|the house|the front) (?:looks|is|feels|seems) (?:too |so |kind of |a bit )?(?:plain|boring|bland|ugly|simple|basic)`,
]
const NICE_ES = String.raw`(?:bonit[oa]|lind[oa]|bell[oa]|hermos[oa]|chul[oa]|padre|elegante|atractiv[oa]|bonitill[oa]|guap[oa]|preciosa|precioso|fin[oa])`
const NICER_ES = [
  // hazla más bonita; haz la casa más bonita; más bonita; que se vea más bonita; quiero la casa más linda
  String.raw`(?:(?:haz|has|as)(?:la|lo)?|hazme|asla|ponla|ponlo|dejala|dejalo|haz la casa|has la casa|pon la casa|deja la casa|quiero (?:la casa|mi casa|que (?:se vea|quede|sea|este))|que (?:se vea|quede|sea|este|luzca)|(?:la|mi) casa)? ?(?:un poco |algo |mucho )?mas ${NICE_ES}`,
  String.raw`(?:que (?:se vea|quede|luzca)|quiero que (?:se vea|quede|luzca)|haz que se vea|hazla ver|hazla verse) (?:un poco |algo )?(?:mejor|${NICE_ES})`,
  String.raw`(?:mejorala|embellecela|embellece la casa|arreglala|ponla bonita|ponla linda|dale mas estilo|(?:la casa |mi casa )?(?:se ve|esta|esta muy|se ve muy) (?:fea|feo|simple|sencilla|aburrida|sosa))`,
]
const NICER = [...NICER_EN, ...NICER_ES].map((src) => new RegExp(String.raw`^(?:(?:can|could|would|will) you |(?:me |le )?(?:puedes|puede|pueden|podrias|podria) |just |porfa |ya )?(?:${src})(?: (?:please|now|for me|for us|overall|ya|toda|por fuera|por dentro|a la casa))*$`))

/**
 * True when the whole message asks for the house to be nicer, with nothing to change named: "make it nicer",
 * "hazla más bonita", "más bonita". The chat answers with three things that do that (bigger windows, a front porch,
 * another style) as buttons, never "I did not catch that". "make the kitchen nicer" names a room: it is not this.
 */
export function wantsNicer(text) {
  const t = plainWords(text)
  if (!t || t.length > 120) return false
  return NICER.some((re) => re.test(t))
}

/** True when a chat message asks for the lot to go to the drafter for a house designed for it (English or Spanish). */
export function isSendLot(text) {
  const t = plainWords(text)
  if (!t || t.length > 160) return false
  return EN.some((re) => re.test(t)) || ES.some((re) => re.test(t))
}
