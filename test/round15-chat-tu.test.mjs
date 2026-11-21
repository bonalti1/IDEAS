// Round 15, U15 (the chat part): the chat says tú, as the screens do, in every Spanish reply, offer and button; the
// buttons are tú commands ("Haz la cocina más grande", never "Hacer"); nothing a homeowner reads in the Spanish chat
// is left in English ("Rear Porch", a style's English name). A scan of every Spanish answer, button and the answer
// to each tapped button, for about forty requests on four plans, in the basic rules and at the office (with no key,
// and with the model stubbed answering in usted).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { interpretRequest, exampleFixes } from '../src/draft/lib/interpret.js'
import { hasUsted, hasEnglish, COST_REPLY_ES, ASK_LABEL_ES } from '../src/draft/lib/es.js'
import { translate, sentence } from '../src/draft/lib/i18n.js'
import { kitFor } from '../src/draft/lib/layout.js'
import { PLANS, style, leftoverEnglish } from './round13-requests.mjs'
import { plans } from './round15-lots.mjs'
import { startOffice, fakeClaude } from './round15-chat-harness.mjs'

export const REQUESTS_ES = [
  'agrega una oficina', 'quita la oficina', 'la cocina más grande', 'la sala 3 pies más ancha', 'quiero 5 recámaras', 'quiero 3 recámaras',
  'quiero 4 recámaras', 'dos baños y medio', 'quiero un porche atrás', 'un patio techado', 'cochera para 3 carros', 'sin cochera',
  'cochera de lado', 'que la casa sea de 2,500 pies', 'que la casa sea de 9,000 pies', 'que se sienta más abierta', 'cuanto cuesta',
  'hazla más bonita', 'más bonita', 'asdf', 'no se', 'haz la casa mas chica pero agrega 2 recamaras', 'quiero un segundo piso',
  'agrega una alberca', 'pinta la casa de azul', 'mueve la oficina junto a la lavandería', 'cambia de lugar la oficina y el comedor',
  'quita la cocina', 'haz la cocina más grande y luego más chica', 'deshaz eso', '¿puedes deshacer eso?', 'agrega un medio baño',
  'agrega una recámara', 'la recámara principal más grande', 'agranda el comedor', 'haz la casa mas grande', 'mándale mi lote al dibujante',
  'agrega una oficina y agrega una alberca', 'quiero cambiar el cuarto',
  // English typed on a Spanish screen: answered in Spanish
  'add an office', 'make the kitchen bigger', 'add a covered patio in the back', 'make the living room 10 feet wider', 'remove the garage',
]
// the infinitives the old buttons used; a button is a tú command
const INFINITIVE = /^¿?(?:Hacer|Agregar|Quitar|Dejar|Dejarla|Volver|Dibujar|Acortar|Mover|Ver|Pedir|Probar|Usar|Mejor dejar)\b/
const offline = async () => {
  throw new Error('no api')
}

/** One Spanish text a homeowner reads: no usted, no English left, no plan-drawing label in English. */
function tu(text, what) {
  assert.equal(typeof text, 'string', what)
  assert.equal(hasUsted(text), false, `${what}: tú, not usted: "${text}"`)
  assert.equal(leftoverEnglish(text), null, `${what}: no English left: "${text}"`)
  assert.equal(hasEnglish(text), false, `${what}: no English left: "${text}"`)
  assert.doesNotMatch(text, /\b(?:Rear|Front) Porch\b|\bPorches?\b|Modern Farmhouse/, `${what}: no English room or style name: "${text}"`)
}
function button(label, what) {
  tu(label, what)
  assert.doesNotMatch(label, INFINITIVE, `${what}: a tú command, not an infinitive: "${label}"`)
}

test('U15 (the words): the usted scan catches usted and lets tú through', () => {
  for (const t of ['Dígame qué quiere', 'Toque uno', 'Intente de nuevo', 'con usted', 'Se le devolvió 1 cambio.', '¿Quiere que les avise?', 'Ya usó los cambios', 'No le entendí.']) assert.equal(hasUsted(t), true, t)
  for (const t of ['Dime qué quieres', 'Toca uno', 'Intenta de nuevo', 'contigo', 'Te devolvimos 1 cambio.', '¿Quieres que les avise?', 'La cochera puede ser para 1 a 4 carros.', 'Agregué "dígame algo".']) assert.equal(hasUsted(t), false, t)
})

test('U15 (basic rules): about forty requests on four plans: every Spanish reply, button and tapped-button answer says tú, with no English', async () => {
  const P = { roomy: PLANS.roomy, tight: PLANS.tight, ...(await plans()) }
  let seen = 0
  for (const [name, plan] of Object.entries(P)) {
    for (const text of REQUESTS_ES) {
      const what = `${name}: "${text}"`
      const r = await interpretRequest(text, plan.rooms, plan.program, style, { lot: plan.lot, interpreter: offline, report: false, lang: 'es', history: [{ text: 'agrega una oficina', ops: [{ op: 'add', kind: 'office' }] }] })
      tu(r.reply, what)
      seen++
      if (r.askLabel) button(r.askLabel, `${what}: the office button`)
      for (const f of r.fixes || []) {
        button(f.label, `${what}: "${f.label}"`)
        if (f.goto) continue
        const d = await interpretRequest(f.label, plan.rooms, plan.program, style, { lot: plan.lot, lang: 'es', interpreter: async () => ({ ops: f.ops, reply: '', confidence: 1 }), report: false })
        tu(d.reply, `${what}: the answer to "${f.label}"`)
        seen++
      }
    }
    // the example buttons under the chat, as the Draft screen shows them in Spanish
    for (const f of exampleFixes(plan.rooms, plan.program, style, kitFor(style), plan.lot, 6)) button(sentence(f.label, 'es'), `${name}: chip "${f.label}"`)
  }
  assert.ok(seen > 150, `${seen} Spanish answers read`)
})

test('U15 (the Draft screen): the chat lines it writes itself, the cost answer and the office buttons say tú', () => {
  const src = fs.readFileSync('src/draft/screens/Draft.jsx', 'utf8')
  const keys = [...src.matchAll(/(?:says\(\[|\[)\s*'((?:[^'\\]|\\.)+)'/g), ...src.matchAll(/(?:says\(\[|\[)\s*"((?:[^"\\]|\\.)+)"/g)].map((m) => m[1].replace(/\\'/g, "'")).filter((k) => /\s/.test(k) && /^[A-Z{]/.test(k))
  assert.ok(keys.length >= 10, `${keys.length} chat lines found`)
  for (const k of keys) {
    const es = translate('es', k, { n: 2, phone: '(956) 594-6936', text: 'algo', topic: 'la cochera', error: 'x', label: 'x' })
    assert.notEqual(es, k, `"${k}" has Spanish`)
    tu(es.replace(/\(956\) 594-6936/g, ''), `the screen's "${k}"`)
  }
  tu(COST_REPLY_ES.replace('South Texas Builders', ''), 'the cost answer')
  for (const label of Object.values(ASK_LABEL_ES)) button(label, 'the office button')
  for (const chip of ['Show me garage options', 'Make the kitchen bigger', 'Add a porch on the back', 'Make the garage {n} cars', 'Add a bedroom', 'Add an office', 'Add a half bath']) button(translate('es', chip, { n: 3 }), `chip "${chip}"`)
})

let office
let claude
let officeClaude
before(async () => {
  // a model that answers in usted, the way round 13's prompt asked it to
  claude = await fakeClaude((request) => (/oficina/.test(request) ? { ops: [], reply: '¿Dónde quiere usted la oficina? Dígame y la agrego.', confidence: 0.3, intent: 'none' } : { ops: [], reply: '¿Me puede decir qué quiere cambiar?', confidence: 0.2, intent: 'none' }))
  ;[office, officeClaude] = await Promise.all([startOffice(), startOffice({ DRAFTHOUSE_CLAUDE_KEY: 'stand-in-not-a-key', ANTHROPIC_BASE_URL: claude.url })])
})
after(async () => {
  office?.stop()
  officeClaude?.stop()
  await claude?.stop()
})

for (const [mode, get] of [['no Claude key', () => office], ['Claude stubbed, answering in usted', () => officeClaude]]) {
  test(`U15 (office API over HTTP, ${mode}): the office's Spanish says tú too: replies, buttons, undo, the drafter request`, async () => {
    const o = get()
    for (const text of ['agrega una oficina', 'deshaz eso', 'regrésalo como estaba', 'cuanto cuesta', 'hazla más bonita', 'quiero cambiar el cuarto', 'agrega una alberca', 'la sala 3 pies más ancha', 'dos baños y medio', 'mándale mi lote al dibujante']) {
      const id = await o.start(PLANS.tight)
      const r = await o.change(id, text)
      tu(r.reply, `${mode}: "${text}"`)
      if (r.askLabel) button(r.askLabel, `${mode}: "${text}": the office button`)
      for (const f of r.fixes || []) button(f.label, `${mode}: "${text}": "${f.label}"`)
    }
    // the stated model's usted is never passed on
    const id = await o.start(PLANS.roomy)
    const asked = await o.change(id, 'quiero cambiar el cuarto')
    assert.equal(hasUsted(asked.reply), false, asked.reply)
  })
}
