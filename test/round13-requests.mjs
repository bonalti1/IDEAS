// Round 13, shared by test/round13-chat-es.test.mjs and test/round13-chat-es-live.test.mjs: the plans, the twenty
// Spanish requests written the way a homeowner in the Valley texts them (accents or none, a few typos), what each
// must come to, and the checks every Spanish answer has to pass. Not a test file itself.
import assert from 'node:assert/strict'
import { generateRooms, DEFAULT_PROGRAM, kitFor, programOf, isRoom, floorArea } from '../src/draft/lib/layout.js'
import { checkRules } from '../src/draft/lib/rules.js'
import { fitsLot } from '../src/draft/lib/fit.js'
import { STYLES } from '../src/draft/lib/styles.js'
import { buildLot } from '../src/draft/lib/lot.js'

export const style = STYLES.find((s) => s.id === 'farmhouse')
export const kit = kitFor(style)
export const kitMeta = { id: kit.id, name: kit.name, kinds: Object.fromEntries(Object.entries(kit.rooms).map(([k, t]) => [k, { name: t.name, w: t.w, d: t.d, zone: t.zone }])), minSize: kit.rules?.minSize || {} }

/** What the rooms step drafts for a program on a lot (the program itself, or what the fit offers in its place). */
export function draft(program, lot) {
  const f = fitsLot(program, style, lot)
  const p = f.ok ? program : f.maxSqft ? { ...program, sqft: f.maxSqft } : f.suggestion?.program
  assert.ok(p, 'the lot takes a draft')
  const rooms = generateRooms(p, style, lot)
  assert.deepEqual(checkRules(rooms, p, style, lot).reasons, [], 'the first draft passes the rules')
  return { program: p, rooms, lot }
}
const ROOMY = buildLot({ kind: 'manual', width: 100, depth: 150, city: 'mcallen', frontStreet: 'E Nolana Ave', setbacks: {} })
const TIGHT = buildLot({ kind: 'manual', width: 60, depth: 110, city: 'mcallen', setbacks: {} })
export const PLANS = {
  roomy: draft(DEFAULT_PROGRAM, ROOMY), // 4 bedrooms, 3 baths, an office, a half bath, a 2-car garage; about 2,800 sf
  three: draft({ ...DEFAULT_PROGRAM, beds: 3, baths: 2 }, ROOMY),
  tight: draft(DEFAULT_PROGRAM, TIGHT), // the narrow-lot plan on 60 x 110
}

export const room = (rooms, kind) => rooms.find((r) => isRoom(r) && r.kind === kind)
export const count = (rooms, kind) => rooms.filter((r) => isRoom(r) && r.kind === kind).length
const area = (r) => r.w * r.d
const beds = (rooms, program) => programOf(rooms, program).beds
const baths = (rooms, program) => programOf(rooms, program).baths
const q4 = (v) => Math.round(v * 4) / 4

// ── what an answer to a Spanish speaker may never carry ───────────────────────────────────────────────────────
// money in any form (the cost answer alone names "el costo", to say it is covered at the meeting)
export const MONEY_ES = /\$|\b\d+k\b|\bprecios?\b|\bprices?\b|\bpricing\b|\btarifas?\b|\brates?\b|\bcr[eé]ditos?\b|\bcredits?\b|\bd[oó]lar(?:es)?\b|\bpagos?\b|\bpagar\b|\bcobr\w+|\bcuotas?\b|\bfactura\w*|\bbilling\b|\bgratis\b|\bfree\b/i
export const COST_WORDS = /\bcost[oae]s?\b|\bcuesta\b|\bcosts?\b/i
// the trade word and its calques, and anything that is code leaking out
export const JARGON_ES = /setback|retranqueo|remetimiento|\bretiros?\b|servidumbre|restricci[oó]n de construcci[oó]n|l[ií]nea de construcci[oó]n|validator|undefined|\bnull\b|\bNaN\b|\[object/i
// English left in a sentence: the words the plan code's own English is made of. What the client typed (in quotes),
// the label printed on the plan drawing ("(Rear Porch)") and names (the office, the style, the city) are set aside.
const ENGLISH = /(?<![\p{L}\p{N}])(?:the|and|with|without|your|you|house|home|rooms?|bedrooms?|bathrooms?|baths?|kitchen|living|dining|garage|office|laundry|porch|closet|make|making|made|add|adding|added|remove|removing|removed|move|moved|bigger|smaller|wider|deeper|longer|changes?|used|plan|draft|drew|lot|feet|foot|ft|sf|sq|not|this|that|there|here|is|are|was|were|does|did|fits?|what|which|would|could|can|cannot|tap|button|undo|back|version|returned|nothing|yet|try|tell|step|street|city|keeps|open|already|has|have|had|it|its|of|to|for|from|on|at|by|as|or|but|so|too|about|now|next|each|every|one|two|cars?)(?![\p{L}\p{N}])/iu // letters with accents are letters: "así" is not "as"
export function leftoverEnglish(text) {
  const t = String(text ?? '').replace(/"[^"]*"/g, ' ').replace(/\((?:Rear Porch|Front Porch)\)/g, ' ').replace(/South Texas Builders|Modern Farmhouse|McAllen, TX|E Nolana Ave/g, ' ')
  const m = ENGLISH.exec(t)
  return m ? m[0] : null
}
const SPANISH_MARK = /[áéíóúñ¿¡]|\b(?:la|el|los|las|un|una|de|del|que|con|para|por|no|se|su|en|es|y)\b/i
/** A reply (or a button's label) a Spanish speaker reads: Spanish, whole, with no money, no trade word, no English left in it. */
export function spanish(text, what, { cost = false } = {}) {
  assert.equal(typeof text, 'string', what)
  assert.ok(text.trim().length > 3, `${what}: something is said: "${text}"`)
  assert.match(text, SPANISH_MARK, `${what}: it is Spanish: "${text}"`)
  assert.equal(leftoverEnglish(text), null, `${what}: no English left: "${text}"`)
  assert.doesNotMatch(text, MONEY_ES, `${what}: no money words: "${text}"`)
  if (!cost) assert.doesNotMatch(text, COST_WORDS, `${what}: no cost words: "${text}"`)
  assert.doesNotMatch(text, JARGON_ES, `${what}: plain words: "${text}"`)
}

// ── the twenty ────────────────────────────────────────────────────────────────────────────────────────────────
// text:    what the homeowner typed
// plan:    the plan it is sent on (a key of PLANS)
// outcome: 'applied' (the plan changes, one change used), 'offer' (nothing changes, at least one button, nothing
//          used) or 'answer' (words only, nothing used)
// op:      the op the request must be read as (the ops as the plan code holds them, after normalizing)
// done:    for 'applied', what the new plan must show
// claude:  what the prompt asks the model to send back for it (every field written, null for "not given"), with
//          the reply sentence in Spanish
const say = (ops, reply, extra = {}) => ({ ops, reply, confidence: 0.92, intent: 'none', ...extra })
const add = (kind, over = {}) => ({ op: 'add', kind, name: null, w: null, d: null, near: null, side: null, ...over })
const idOf = (rooms, kind) => rooms.find((r) => r.kind === kind)?.id
export const REQUESTS = [
  {
    text: 'quiero 4 recamaras', plan: 'three', outcome: 'applied', means: '4 bedrooms',
    op: (ops) => ops.some((o) => (o.op === 'count' && o.kind === 'bed' && o.count === 4) || (o.op === 'add' && o.kind === 'bed')),
    done: (rooms, program) => beds(rooms, program) === 4,
    claude: () => say([{ op: 'count', kind: 'bed', count: 4 }], 'Dejé la casa con 4 recámaras.'),
  },
  {
    text: 'ocupamos 3 banos', plan: 'three', outcome: 'applied', means: '3 bathrooms',
    op: (ops) => ops.some((o) => (o.op === 'count' && o.kind === 'bath' && o.count === 3) || (o.op === 'add' && o.kind === 'bath')),
    done: (rooms, program) => baths(rooms, program) === 3,
    claude: () => say([{ op: 'count', kind: 'bath', count: 3 }], 'Dejé la casa con 3 baños.'),
  },
  {
    text: 'Quiero 5 cuartos', plan: 'roomy', outcome: 'applied', means: '5 bedrooms',
    op: (ops) => ops.some((o) => (o.op === 'count' && o.kind === 'bed' && o.count === 5) || (o.op === 'add' && o.kind === 'bed')),
    done: (rooms, program) => beds(rooms, program) === 5,
    claude: () => say([{ op: 'count', kind: 'bed', count: 5 }], 'Dejé la casa con 5 recámaras.'),
  },
  {
    text: 'agrega una oficina', plan: 'roomy', outcome: 'applied', means: 'add an office',
    op: (ops) => ops.length === 1 && ops[0].op === 'add' && ops[0].kind === 'office',
    done: (rooms, program, before) => count(rooms, 'office') === count(before, 'office') + 1,
    claude: () => say([add('office')], 'Agregué una oficina.'),
  },
  {
    text: 'quita la oficina', plan: 'roomy', outcome: 'applied', means: 'remove the office',
    op: (ops) => ops.length === 1 && ops[0].op === 'remove' && ops[0].room === 'office',
    done: (rooms) => count(rooms, 'office') === 0,
    claude: (rooms) => say([{ op: 'remove', room: idOf(rooms, 'office') }], 'Quité la oficina.'),
  },
  {
    text: 'sin medio baño porfa', plan: 'roomy', outcome: 'applied', means: 'remove the half bath',
    op: (ops) => ops.length === 1 && ops[0].op === 'remove' && ops[0].room === 'halfbath',
    done: (rooms) => count(rooms, 'halfbath') === 0,
    claude: (rooms) => say([{ op: 'remove', room: idOf(rooms, 'halfbath') }], 'Quité el medio baño.'),
  },
  {
    text: 'la cocina más grande', plan: 'roomy', outcome: 'applied', means: 'make the kitchen bigger',
    op: (ops) => ops.length === 1 && ops[0].op === 'resize' && ops[0].room === 'kitchen' && ops[0].soft === true,
    done: (rooms, program, before) => area(room(rooms, 'kitchen')) > area(room(before, 'kitchen')) + 1,
    claude: (rooms) => {
      const k = rooms.find((r) => r.kind === 'kitchen')
      return say([{ op: 'resize', room: k.id, w: q4(k.w * 1.15), d: q4(k.d * 1.15), soft: true }], 'Hice la cocina más grande.')
    },
  },
  {
    text: 'haz la sala mas chica', plan: 'roomy', outcome: 'applied', means: 'make the living room smaller',
    op: (ops) => ops.length === 1 && ops[0].op === 'resize' && ops[0].room === 'living' && ops[0].soft === true,
    done: (rooms, program, before) => area(room(rooms, 'living')) < area(room(before, 'living')) - 1,
    claude: (rooms) => {
      const k = rooms.find((r) => r.kind === 'living')
      return say([{ op: 'resize', room: k.id, w: q4(k.w * 0.87), d: q4(k.d * 0.87), soft: true }], 'Hice la sala más chica.')
    },
  },
  {
    text: 'la cosina 2 pies mas ancha', plan: 'roomy', outcome: 'applied', means: 'make the kitchen 2 ft wider',
    op: (ops, before) => ops.length === 1 && ops[0].op === 'resize' && ops[0].room === 'kitchen' && Math.abs(ops[0].w - (room(before, 'kitchen').w + 2)) < 0.01 && Math.abs(ops[0].d - room(before, 'kitchen').d) < 0.01 && !ops[0].soft,
    done: (rooms, program, before) => Math.abs(room(rooms, 'kitchen').w - (room(before, 'kitchen').w + 2)) < 0.01,
    claude: (rooms) => {
      const k = rooms.find((r) => r.kind === 'kitchen')
      return say([{ op: 'resize', room: k.id, w: k.w + 2, d: k.d, soft: false }], 'Hice la cocina 2 pies más ancha.')
    },
  },
  {
    text: 'quiero un porche atrás', plan: 'roomy', outcome: 'applied', means: 'add a back porch',
    op: (ops) => ops.length === 1 && ops[0].op === 'add' && ops[0].kind === 'rearPorch',
    done: (rooms) => count(rooms, 'rearPorch') === 1,
    claude: () => say([add('rearPorch')], 'Agregué un porche en la parte de atrás de la casa.'),
  },
  {
    text: 'ponle un patio techado', plan: 'roomy', outcome: 'applied', means: 'add a covered patio',
    op: (ops) => ops.length === 1 && ops[0].op === 'add' && ops[0].kind === 'rearPorch',
    done: (rooms) => count(rooms, 'rearPorch') === 1,
    claude: () => say([add('rearPorch', { name: 'Covered Patio' })], 'Agregué un patio techado en la parte de atrás de la casa.'),
  },
  {
    // on this plan the garage sits at the front and cannot take a third bay in place: the answer is the button
    text: 'cochera para 3 carros', plan: 'roomy', outcome: 'offer', means: 'make the garage 3 cars',
    op: (ops) => ops.length === 1 && ops[0].op === 'garage' && ops[0].cars === 3,
    claude: () => say([{ op: 'garage', cars: 3, load: null, tandem: false }], 'Dejé la cochera para 3 carros.'),
  },
  {
    text: 'sin cochera', plan: 'roomy', outcome: 'applied', means: 'remove the garage',
    op: (ops) => ops.length === 1 && ops[0].op === 'remove' && ops[0].room === 'garage',
    done: (rooms) => count(rooms, 'garage') === 0,
    claude: (rooms) => say([{ op: 'remove', room: idOf(rooms, 'garage') }], 'Quité la cochera.'),
  },
  {
    text: 'la cochera de lado', plan: 'roomy', outcome: 'offer', means: 'make the garage side-load',
    op: (ops) => ops.length === 1 && ops[0].op === 'garage' && ops[0].load === 'side',
    claude: () => say([{ op: 'garage', cars: null, load: 'side', tandem: false }], 'Dejé la cochera con la entrada de lado.'),
  },
  {
    text: 'que la casa sea de 2,500 pies', plan: 'roomy', outcome: 'applied', means: 'make the house 2,500 sf',
    op: (ops) => ops.length === 1 && ops[0].op === 'scale' && ops[0].sqft === 2500,
    done: (rooms, program) => Math.abs(floorArea(rooms, program.stories || 1) - 2500) < 60,
    claude: () => say([{ op: 'scale', sqft: 2500 }], 'Dejé la casa en unos 2,500 pies cuadrados.'),
  },
  {
    text: 'que se sienta mas abierta', plan: 'roomy', outcome: 'offer', means: 'make it feel more open',
    op: (ops) => ops.length === 0,
    claude: () => say([], 'Esto es lo que puede hacer que se sienta más abierta.', { intent: 'open' }),
  },
  {
    // never reaches the model: the meeting answer, with the office button in Spanish
    text: 'cuanto cuesta?', plan: 'roomy', outcome: 'answer', means: 'how much does it cost?', cost: true,
    op: (ops) => ops.length === 0,
    claude: () => say([], 'El costo se revisa en tu reunión con la oficina de South Texas Builders.', { confidence: 0.3 }),
  },
  {
    text: 'agrega otra recamara', plan: 'roomy', outcome: 'applied', means: 'add a bedroom',
    op: (ops) => ops.length === 1 && ops[0].op === 'add' && ops[0].kind === 'bed',
    done: (rooms, program) => beds(rooms, program) === 5,
    claude: () => say([add('bed')], 'Agregué otra recámara.'),
  },
  {
    text: 'haz mas grande la recamra principal', plan: 'roomy', outcome: 'applied', means: 'make the primary bedroom bigger',
    op: (ops) => ops.length === 1 && ops[0].op === 'resize' && ops[0].room === 'master' && ops[0].soft === true,
    done: (rooms, program, before) => area(room(rooms, 'master')) > area(room(before, 'master')) + 1,
    claude: (rooms) => {
      const k = rooms.find((r) => r.kind === 'master')
      return say([{ op: 'resize', room: k.id, w: q4(k.w * 1.15), d: q4(k.d * 1.15), soft: true }], 'Hice la recámara principal más grande.')
    },
  },
  {
    text: 'necesito otro baño', plan: 'roomy', outcome: 'applied', means: 'add a bathroom',
    op: (ops) => ops.length === 1 && ops[0].op === 'add' && ops[0].kind === 'bath',
    done: (rooms, program) => baths(rooms, program) === 4,
    claude: () => say([add('bath')], 'Agregué otro baño.'),
  },
]
/** What the model is prompted to send for a request, by its text (the stand-in for Claude in the tests). */
export function asPrompted(request, rooms) {
  const r = REQUESTS.find((q) => q.text === request)
  if (r) return r.claude(rooms)
  // the English requests the other tests send through the model
  if (/^add an office$/i.test(request)) return say([add('office')], 'Added an office.')
  if (/^remove the half bath$/i.test(request)) return say([{ op: 'remove', room: idOf(rooms, 'halfbath') }], 'Removed the half bath.')
  // anything else: the model comes back unsure, in the client's language
  return { ops: [], reply: /[áéíóúñ¿]|\b(?:la|el|que|mas|casa)\b/i.test(request) ? '¿Me puedes decir qué quieres cambiar?' : 'Could you tell me what you would like to change?', confidence: 0.2, intent: 'none' }
}
