// Round 13, the chat part of the customer-test addendum, in every mode the chat runs in: the basic rules called
// directly, the office API over HTTP with no Claude key, and the Claude path with the model stubbed (a stand-in
// for api.anthropic.com on this machine, so nothing leaves it).
//   1. Spanish: twenty requests the way a homeowner in the Valley texts them are all understood, each comes to
//      the op or the offer it means, and the answer (reply, button labels, the office button) is Spanish with no
//      English left in it;
//   2. typed undo ("undo that", "go back to how it was", "deshaz eso", ...) does what the Undo button does;
//   3. two wishes that pull against each other get the trade-off in plain words and ONE button that applies; a
//      request nobody can read gets "I did not catch that" and three example buttons that fit the plan.
// A refusal, an offer or an answer uses no change; a tapped button that applies uses one. No money words, and
// never the word "setback" or a calque of it.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { programOf, floorArea } from '../src/draft/lib/layout.js'
import { interpretRequest, decide, sameRooms, localize, exampleFixes, ASK_LABEL } from '../src/draft/lib/interpret.js'
import { regexOps, normalizeOps, validateOps, summarizeRooms, isUndoRequest, tradeOffAsk, unclearAsk, countAsk, wantsOpen, isCostQuestion, OPS } from '../src/draft/lib/ops.js'
import { checkRules } from '../src/draft/lib/rules.js'
import { isSpanish, fromSpanish, toSpanish, untranslated, hasEnglish, ASK_LABEL_ES, COST_REPLY_ES } from '../src/draft/lib/es.js'
import { plainReason } from '../src/draft/lib/plain.js'
import { makeInterpreter, backstop, tidy, DIFF_SCHEMA, INTERPRET_SYSTEM } from '../server/interpreter.mjs'
import { fixtureEnv } from './server-env.mjs'
import { style, kit, PLANS, REQUESTS, asPrompted, spanish, leftoverEnglish, room, count, MONEY_ES, JARGON_ES } from './round13-requests.mjs'

const offline = async () => {
  throw new Error('no api')
}
const basic = (text, plan, opts = {}) => interpretRequest(text, plan.rooms, plan.program, style, { lot: plan.lot, interpreter: offline, report: false, ...opts })
/** A tap on an offered button the way the Draft screen sends it with no account: the label as the text, the button's ops taken as given. */
const tap = (fix, plan, opts = {}) => interpretRequest(fix.label.replace(/\?$/, ''), plan.rooms, plan.program, style, { lot: plan.lot, interpreter: async () => ({ ops: fix.ops, reply: '', confidence: 1 }), report: false, ...opts })
const sound = (rooms, program, lot, what) => assert.deepEqual(checkRules(rooms, program, style, lot).reasons, [], `${what}: the plan passes every rule`)
const MONEY_EN = /\$|\b\d+k\b|\/sf\b|\bcredits?\b|\bbuy\b|\bpurchase\b|\bprices?\b|\bpricing\b|\brates?\b|\bcosts?\b|\bbilling\b|\bbill\b|\bpay(ment)?s?\b|\bfees?\b|\bdollars?\b|\bcharged?\b|\bfree\b/i
const JARGON_EN = /setback|cannot grow that way|would cross|opens to the outside|egress|validator|undefined|null\b|NaN|\[object/i
/** An English answer: a real sentence, no money, no trade word. */
function plain(text, what) {
  assert.ok(String(text).trim().length > 15, `${what}: a real sentence: "${text}"`)
  assert.doesNotMatch(text, MONEY_EN, `${what}: no money words: "${text}"`)
  assert.doesNotMatch(text, JARGON_EN, `${what}: plain words: "${text}"`)
}

// ── 1. Spanish: reading ───────────────────────────────────────────────────────────────────────────────────────
test('1 (reading): the twenty requests are Spanish and each reads as the English it means; English requests are never taken for Spanish', () => {
  assert.equal(REQUESTS.length, 20)
  for (const q of REQUESTS) {
    assert.equal(isSpanish(q.text), true, q.text)
    assert.equal(fromSpanish(q.text).text, q.means, q.text)
  }
  const english = ['I want 4 bedrooms', 'make it 4 bedrooms', 'Add a covered patio in the back', 'Make the kitchen bigger', 'Make it feel more open', 'add an office', 'remove the half bath', 'make the kitchen 2 feet wider', 'make the garage 3 cars', 'make the garage side-load', 'move the office next to the laundry', 'push the office 3 feet toward the street', 'swap the office and the dining room', 'make the house 3,000 square feet', 'add a bedroom across the hall', 'how much will this house cost?', 'undo', 'undo that', 'go back', 'go back to how it was', 'put it back', 'make the house smaller but add 2 bedrooms', 'asdf', 'hmm', 'make it nicer', 'ok', 'no garage', 'add a patio', 'a 3 car garage please', 'Make the garage 3 cars', 'Add a porch on the back', 'Make the primary bath bigger', 'Draw a smaller house, about 2,700 sf, with 6 bedrooms', 'Ask the office to set up my meeting']
  for (const text of english) assert.equal(isSpanish(text), false, text)
})

test('1 (reading): the intents the chat has in English, in casual Spanish with and without accents and with typos', () => {
  const means = (text) => fromSpanish(text).text
  const cases = {
    // counts
    'quiero 3 recámaras': '3 bedrooms', 'quiero 4 recamaras': '4 bedrooms', 'quiero 4 cuartos': '4 bedrooms', 'quiero 4 habitaciones': '4 bedrooms', 'ocupo cuatro recamaras': '4 bedrooms', '3 baños': '3 bathrooms', '3 banos': '3 bathrooms', 'que tenga 5 recámaras y 3 baños': '5 bedrooms and 3 bathrooms',
    // add, remove
    'agrega una oficina': 'add an office', 'ponle una ofisina': 'add an office', 'quita la oficina': 'remove the office', 'sin oficina': 'remove the office', 'ya no quiero la oficina': 'remove the office', 'agrega 2 recamaras': 'add 2 bedrooms', 'otro baño': 'add a bathroom', 'quiero un medio baño': 'add a half bath', 'agrega una despensa': 'add a pantry',
    // bigger, smaller
    'la cocina más grande': 'make the kitchen bigger', 'la cocina mas grande': 'make the kitchen bigger', 'haz la sala más chica': 'make the living room smaller', 'haz la sala mas chica': 'make the living room smaller', 'la cocina 2 pies más ancha': 'make the kitchen 2 ft wider', 'agranda el comedor': 'make the dining room bigger', 'la lavanderia mas grande': 'make the laundry bigger', 'la recámara principal más grande': 'make the primary bedroom bigger',
    // patio, porch
    'quiero un porche atrás': 'add a back porch', 'quiero un porche atras': 'add a back porch', 'un patio techado': 'add a covered patio', 'quiero un patio': 'add a covered patio', 'un porche enfrente': 'add a front porch',
    // garage
    'cochera para 3 carros': 'make the garage 3 cars', 'agrega una cochera para 2 carros': 'add a 2-car garage', 'garaje para 2 carros': 'make the garage 2 cars', 'sin cochera': 'remove the garage', 'cochera de lado': 'make the garage side-load', 'la cochera con entrada por un lado': 'make the garage side-load',
    // the house, more open, cost
    'que la casa sea de 2,500 pies': 'make the house 2,500 sf', 'la casa de 2500 pies cuadrados': 'make the house 2,500 sf', 'que se sienta más abierta': 'make it feel more open', 'que se sienta mas abierta': 'make it feel more open', 'concepto abierto': 'make it feel more open', 'cuanto cuesta': 'how much does it cost?', '¿cuánto me sale?': 'how much does it cost?', 'cual es el precio': 'how much does it cost?',
    // two parts, a move, a swap
    'agrega una oficina y quita el medio baño': 'add an office and remove the half bath', 'quita la oficina y el medio baño': 'remove the office and remove the half bath', 'que la cocina y la sala sean mas grandes': 'make the kitchen bigger and make the living room bigger', 'agranda el closet principal': 'make the primary closet bigger', 'mueve la oficina junto a la lavanderia': 'move the office next to the laundry', 'cambia de lugar la oficina y el comedor': 'swap the office and the dining room',
  }
  for (const [text, en] of Object.entries(cases)) {
    assert.equal(isSpanish(text), true, text)
    assert.equal(means(text), en, text)
  }
  // the checks that run before any model read Spanish too
  assert.equal(isCostQuestion(means('cuanto cuesta')), true)
  assert.deepEqual(countAsk('quiero 4 recámaras'), [{ kind: 'bed', count: 4 }])
  assert.deepEqual(countAsk('ocupamos 3 banos'), [{ kind: 'bath', count: 3 }])
  assert.deepEqual(countAsk('agrega 2 recamaras'), [], 'two more is not a count')
  assert.equal(wantsOpen('que se sienta más abierta'), true)
  assert.equal(wantsOpen('la cocina más grande'), false)
})

// ── 1. Spanish: (a) the basic rules, directly ─────────────────────────────────────────────────────────────────
/** One answer against what the request must come to. `get`: the plan after (rooms, program) when it applied. */
async function judge(q, r, plan, mode) {
  const what = `${mode}: "${q.text}"`
  assert.equal(r.applied, q.outcome === 'applied', `${what}: ${q.outcome}: ${r.reply}`)
  spanish(r.reply, what, { cost: !!q.cost })
  if (q.outcome === 'applied') {
    const program = r.program || plan.program
    assert.ok(q.done(r.rooms, program, plan.rooms), `${what}: the plan shows it: ${r.reply}`)
    sound(r.rooms, program, plan.lot, what)
  } else if (q.outcome === 'offer') {
    assert.ok(r.fixes?.length >= 1, `${what}: a button is offered: ${r.reply}`)
    for (const f of r.fixes) {
      spanish(f.label, `${what}: the button "${f.label}"`)
      assert.ok(f.ops.every((o) => OPS.includes(o.op)), `${what}: "${f.label}" uses ops the plan code has`)
    }
  } else {
    assert.equal(r.askOffice, 'meeting', what)
    assert.equal(r.askLabel, 'Pedir a la oficina que programe mi reunión', `${what}: the office button is Spanish`)
    assert.equal(r.reply, COST_REPLY_ES)
    assert.deepEqual(r.fixes || [], [])
  }
}

test('1a (basic rules): the twenty Spanish requests are all understood: the op each means, the outcome, a Spanish reply, Spanish buttons that apply', async () => {
  for (const q of REQUESTS) {
    const plan = PLANS[q.plan]
    // the op the request is read as
    const read = regexOps(q.text, plan.rooms, kit, plan.lot)
    const ops = normalizeOps(read.ops, plan.rooms)
    assert.ok(q.op(ops, plan.rooms), `"${q.text}" is read as the op it means: ${JSON.stringify(read.ops)}`)
    assert.doesNotMatch(String(read.reply), /did not catch/, q.text)
    const r = await basic(q.text, plan)
    assert.equal(r.lang, 'es', q.text)
    await judge(q, r, plan, 'basic rules')
    // every button offered applies when tapped, and the answer to the tap is Spanish
    for (const f of r.fixes || []) {
      const d = await tap(f, plan)
      assert.equal(d.applied, true, `"${q.text}": the button "${f.label}" applies: ${d.reply}`)
      sound(d.rooms, d.program || plan.program, plan.lot, `"${q.text}" after "${f.label}"`)
      spanish(d.reply, `"${q.text}": the answer to "${f.label}"`)
    }
  }
})

test('1a (basic rules): refusals and offers on a tight lot are Spanish too, with the reason in plain words and buttons that apply', async () => {
  const tight = PLANS.tight
  const cases = [
    ['quiero un patio techado atrás', /^Un patio techado atrás no cabe como lo pidió: la casa y los porches cubrirían el 51 por ciento del lote, más del 50 por ciento que permite McAllen, TX\. Esto es lo que sí funcionaría:$/],
    ['la cocina más grande', /^La cocina no puede crecer tanto aquí: .+\. Lo que sí cabe es 1 pie más de largo\.$/],
    ['quiero 5 recámaras', /^5 recámaras no caben en este lote: la casa quedaría demasiado cerca del costado del lote, donde la ciudad mantiene 5 pies libres\. Este plano tiene 4\./],
    ['que se sienta más abierta', /^La cocina, el comedor y la sala de este plano ya son un solo espacio abierto, sin paredes de por medio/],
    ['agrega una oficina', /^Agregar una oficina se pasa de los 10 pies que la ciudad mantiene libres al fondo del lote, así que el plano no funcionaría como está dibujado\. Intente con un paso más chico\.$/],
    ['quiero 4 recámaras', /^Este plano ya tiene 4 recámaras\. No se usó ningún cambio\.$/],
    ['agrega una alberca', /^Eso no es algo que este plano pueda llevar: aquí solo se dibuja la casa\./],
    ['quiero un segundo piso', /^Por ahora el estilo Modern Farmhouse es de un solo piso; el segundo piso está en la lista, pero todavía no se dibuja\./],
    ['quita la cocina', /^Toda casa necesita una cocina, así que esa se queda\. Mejor dígame qué le gustaría cambiarle\.$/],
    ['haz la cocina más grande y luego más chica', /^Eso se cancela solo: agrandar y luego achicar la cocina la deja como está\. No se usó ningún cambio\.$/],
  ]
  for (const [text, re] of cases) {
    const r = await basic(text, tight)
    assert.equal(r.applied, false, `${text}: ${r.reply}`)
    assert.match(r.reply, re, text)
    spanish(r.reply, text)
    for (const f of r.fixes || []) {
      spanish(f.label, `${text}: "${f.label}"`)
      const d = await tap(f, tight)
      assert.equal(d.applied, true, `${text}: the button "${f.label}" applies: ${d.reply}`)
      sound(d.rooms, d.program || tight.program, tight.lot, `${text} after "${f.label}"`)
      spanish(d.reply, `${text}: the answer to "${f.label}"`)
    }
  }
  // a request in parts: what was done and what was not, each in Spanish, the client's own words quoted
  const parts = await basic('agrega una oficina y agrega una alberca', PLANS.roomy)
  assert.equal(parts.applied, true, parts.reply)
  assert.equal(parts.reply, 'Agregué una oficina. No hice: "agrega una alberca": eso no es algo que este plano pueda llevar: aquí solo se dibuja la casa. El cambio cuenta una sola vez, por lo que sí se hizo.')
  // a change beside a cost question: the change is done, the cost sentence follows, the office button is Spanish
  const both = await basic('que la casa sea de 2,500 pies, ¿cuánto cuesta?', PLANS.roomy)
  assert.equal(both.applied, true, both.reply)
  assert.ok(both.reply.endsWith(COST_REPLY_ES), both.reply)
  assert.equal(both.askLabel, ASK_LABEL_ES.meeting)
})

test('1a (basic rules): the screen language decides when the text does not: lang "es" answers an English request in Spanish, and English stays English without it', async () => {
  const en = await basic('make the kitchen bigger', PLANS.tight)
  assert.equal(en.lang, undefined)
  assert.match(en.reply, /^The kitchen cannot get that much bigger here: /)
  assert.deepEqual(en.fixes.map((f) => f.label), ['Make the kitchen 1 ft longer'])
  const es = await basic('make the kitchen bigger', PLANS.tight, { lang: 'es' })
  assert.equal(es.lang, 'es')
  assert.match(es.reply, /^La cocina no puede crecer tanto aquí: /)
  spanish(es.reply, 'lang es')
  assert.deepEqual(es.fixes.map((f) => f.label), ['Hacer la cocina 1 pie más de largo'])
  assert.deepEqual(es.fixes[0].ops, en.fixes[0].ops, 'the same button, in Spanish')
  // the office button: its words travel with the answer in both languages
  const cost = await basic('how much will this cost?', PLANS.roomy)
  assert.equal(cost.askLabel, ASK_LABEL.meeting)
  const costo = await basic('how much will this cost?', PLANS.roomy, { lang: 'es' })
  assert.equal(costo.askLabel, 'Pedir a la oficina que programe mi reunión')
  assert.equal(costo.reply, COST_REPLY_ES)
  // a Spanish request on an English screen is still answered in Spanish
  const typed = await basic('la cocina más grande', PLANS.roomy, { lang: 'en' })
  assert.equal(typed.lang, 'es')
  spanish(typed.reply, 'Spanish typed on an English screen')
  // a tapped button (fixOps: the label is not read) answers in the screen's language
  const done = await interpretRequest(es.fixes[0].label, PLANS.tight.rooms, PLANS.tight.program, style, { lot: PLANS.tight.lot, fixOps: es.fixes[0].ops, lang: 'es', report: false })
  assert.equal(done.applied, true, done.reply)
  assert.equal(done.source, 'fix')
  spanish(done.reply, 'the tap')
})

// ── 1. Spanish: writing. Every sentence the plan code writes has Spanish ──────────────────────────────────────
test('1 (writing): toSpanish covers what the plan code writes: a sweep of requests on four plans leaves no sentence without Spanish and no English in any reply or button', async () => {
  const requests = ['I want 4 bedrooms', 'I want 5 bedrooms', 'we need 2 bedrooms', 'I want 7 bedrooms', 'make it 2 bathrooms', 'I want 4 bathrooms', '4 bed 3 bath', 'Add a covered patio in the back', 'add a 12 by 14 covered patio', 'add a front porch', 'add a porch', 'Make the kitchen bigger', 'make the kitchen much bigger', 'make the kitchen 30 by 30', 'make the kitchen 6 by 6', 'make bedroom 2 8 by 8', 'make the living room smaller', 'make the primary bedroom bigger', 'make the kitchen 2 feet wider', 'make the kitchen 4 feet deeper', 'Make it feel more open', 'add an office', 'add a second office next to the laundry', 'remove the office', 'remove the kitchen', 'remove the half bath', 'remove bedroom 2', 'add a bedroom', 'add 2 bedrooms', 'add a half bath', 'add a pantry', 'add a bathroom', 'make the garage 3 cars', 'make the garage 1 car', 'make the garage side-load', 'add a garage', 'remove the garage', 'make the garage tandem', 'make the house 2,400 sf', 'make the house 3,000 sf', 'make the house 6,000 sf', 'make the house 900 sf', 'make the house 20000 sf', 'make the house -5 sf', 'move the office next to the laundry', 'move the office 3 feet toward the street', 'move the laundry 10 feet east', 'swap the office and the dining room', 'swap the kitchen and the garage', 'swap the office', 'how much will it cost?', 'make the house 2,400 sf, how much is that?', 'add a pool', 'add a second story', 'paint it blue', 'add a basement', 'make the kitchen bigger and then make it smaller', 'make the kitchen bigger and add a pool', 'make it feel more open and add an office', 'add an office and remove the half bath and make the kitchen bigger and add a pantry and add a bedroom', 'make the house smaller but add 2 bedrooms', 'a smaller house with 5 bedrooms', 'make the house smaller and add a bathroom', 'asdf', 'make it nicer', 'undo', 'porch', 'the kitchen', 'make the closet bigger', 'make the laundry bigger', 'make the dining room bigger', 'make bedroom 9 bigger', 'make the primary bath bigger', 'add a bedroom across the hall', 'remove the front porch', 'add a 3-car garage']
  const missed = []
  const english = []
  let seen = 0
  const look = (r, where) => {
    for (const text of [r.reply, ...(r.fixes || []).map((f) => f.label)]) {
      seen++
      for (const m of untranslated(text)) missed.push(`${where}: ${m}`)
      const es = toSpanish(text)
      if (leftoverEnglish(es) || hasEnglish(es) || JARGON_ES.test(es) || MONEY_ES.test(es)) english.push(`${where}: ${es}`)
    }
  }
  for (const [name, plan] of Object.entries(PLANS)) {
    for (const text of requests) {
      const r = await basic(text, plan)
      look(r, `${name}: ${text}`)
      // each button tapped, and a new size after a change that applied (a new draft names the edits it kept or lost)
      for (const f of r.fixes || []) look(await tap(f, plan), `${name}: ${text} → ${f.label}`)
      if (r.applied && /bigger|office|garage|patio/.test(text)) look(await interpretRequest('make the house 2,200 sf', r.rooms, r.program || plan.program, style, { lot: plan.lot, interpreter: offline, report: false, history: [{ text, ops: r.ops }] }), `${name}: ${text}, then 2,200 sf`)
    }
  }
  assert.ok(seen > 400, `${seen} sentences looked at`)
  assert.deepEqual(missed, [], 'every sentence has Spanish')
  assert.deepEqual(english, [], 'no English, no trade word and no money word in any of them')
})

test('1 (writing): the sentences around the chat: the rule reasons as plain.js words them, the fit messages, the office, undo, button labels, the count suffix', () => {
  const fixed = {
    'Fits this lot and the city\'s rules for it.': 'Cabe en este lote y cumple las reglas de la ciudad para él.',
    'Fits once trimmed about 8% to keep the space the city requires along the edges of this lot.': 'Cabe si se reduce más o menos un 8%, para respetar el espacio que la ciudad pide dejar libre a lo largo de las orillas de este lote.',
    'We started you with what fits this lot; you can change it.': 'Empezamos con lo que cabe en este lote; usted lo puede cambiar.',
    'It fits with a 1-car garage.': 'Sí cabe con cochera para 1 carro.',
    'It fits without the office.': 'Sí cabe sin la oficina.',
    'It fits as a 3 bed, 2 bath starter with no garage.': 'Sí cabe como una casa sencilla de 3 recámaras y 2 baños, sin cochera.',
    'The largest this plan fits here is 2,350 sf.': 'Lo más grande que cabe aquí de este plano es 2,350 pies².',
    'Try fewer rooms or a smaller garage.': 'Intente con menos habitaciones o con una cochera más chica.',
    'No change was used.': 'No se usó ningún cambio.',
    'same size': 'mismo tamaño',
    '1 change used': '1 cambio usado',
    '3 changes used': '3 cambios usados',
    'Ask the office to set up my meeting': 'Pedir a la oficina que programe mi reunión',
    'Ask the office for more changes': 'Pedir más cambios a la oficina',
    "You've used the free changes on this plan. The office will add more for you. Want me to let them know?": 'Ya usó los cambios incluidos en este plano. La oficina le agregará más. ¿Quiere que les avise?',
    'Thanks! The office will reach out within 1 business day. You can also call (956) 594-6936.': '¡Gracias! La oficina se comunicará con usted en 1 día hábil. También puede llamar al (956) 594-6936.',
    'Done. The office has your request and usually adds more within 1 business day. You can also call (956) 594-6936.': 'Listo. La oficina ya tiene su solicitud y normalmente agrega más cambios en 1 día hábil. También puede llamar al (956) 594-6936.',
    'Back to version 3. 1 change returned.': 'Regresé a la versión 3. Te devolvimos 1 cambio.',
    'Done, the house is back to how it was. 1 change returned.': 'Listo, la casa quedó como estaba. Te devolvimos 1 cambio.',
    'Back to version 1. 2 changes returned.': 'Regresé a la versión 1. Te devolvimos 2 cambios.',
    'There is nothing to undo yet. No change was used.': 'Todavía no hay nada que deshacer. No se usó ningún cambio.',
    'Undid "agrega una oficina". That change is back on your plan.': 'Deshice "agrega una oficina". Ese cambio regresó a su plano.',
    'This design is with the drafters now, so it cannot change.': 'Este diseño ya está con los dibujantes, así que no se puede cambiar.',
    'Something went wrong on our side. Try again in a moment.': 'Algo salió mal de nuestro lado. Intente de nuevo en un momento.',
    'Make the kitchen bigger': 'Hacer la cocina más grande',
    'Add a porch on the back': 'Agregar un porche atrás',
    'Make the garage 3 cars': 'Dejar la cochera para 3 carros',
    'Add a bedroom': 'Agregar una recámara',
    'Add a half bath': 'Agregar un medio baño',
    'Make it 2,400 sf': 'Dejarla en 2,400 pies²',
    // the suggestions the Draft screen shows under the chat
    'Remove the rear porch': 'Quitar el porche de atrás',
    'Add a 2-car garage': 'Agregar una cochera para 2 carros',
    'Add an office': 'Agregar una oficina',
    'Bigger primary bath': 'Baño principal más grande',
    'Show me garage options': 'Ver opciones para la cochera',
    '3 options for the garage that pass the checks on this lot. Pick one: that is one change; looking is free.': '3 opciones para la cochera que pasan las revisiones en este lote. Escoja una: eso cuenta como un cambio; ver no usa ninguno.',
    'Only one sound option for the porches on this lot.': 'Solo hay una opción buena para los porches en este lote.',
    'No sound option for the bedroom wing on this lot: each one runs too close to an edge of the lot or breaks a plan rule.': 'No hay ninguna opción buena para el ala de las recámaras en este lote: cada una queda demasiado cerca de una orilla del lote o rompe una regla del plano.',
    'Sign in with your email first so the office knows which house is yours. Then this button sends your request. You can also call (956) 594-6936.': 'Primero inicie sesión con su correo para que la oficina sepa cuál casa es la suya. Después este botón envía su solicitud. También puede llamar al (956) 594-6936.',
  }
  for (const [en, es] of Object.entries(fixed)) {
    assert.equal(toSpanish(en), es, en)
    assert.deepEqual(untranslated(en), [], en)
  }
  // a rule's reason the way a homeowner reads it (plain.js), then in Spanish: the open space is said in plain
  // words, never as the trade word or a calque of it
  const reasons = [
    ['Bedroom 2 would cross the setback at 5 ft from side.', 'La Recámara 2 quedaría demasiado cerca del costado del lote (ahí la ciudad mantiene 5 pies libres).'],
    ['Kitchen would cross the setback at 10 ft from rear.', 'La cocina quedaría demasiado cerca del fondo del lote (ahí la ciudad mantiene 10 pies libres).'],
    ['2-Car Garage would cross the setback at 20 ft from front.', 'La cochera para 2 carros quedaría demasiado cerca de la calle (ahí la ciudad mantiene 20 pies libres).'],
    ['Kitchen would run into dining.', 'La cocina chocaría con el comedor.'],
    ["Office would be 6' by 6', under the 8' by 9' minimum.", 'La oficina quedaría de 6 por 6 pies, por debajo del mínimo de 8 por 9 pies.'],
    ['Bedroom 3 would be under 70 square feet, the code minimum for a living space.', 'La Recámara 3 quedaría con menos de 70 pies², el mínimo que pide el reglamento para un espacio habitable.'],
    ['The house would cover 4,100 square feet of the lot; this lot allows 3,300.', 'La casa cubriría 4,100 pies² del lote; este lote permite 3,300.'],
    ['Every house needs a kitchen.', 'Toda casa necesita una cocina.'],
    ['This plan has to be trimmed to 88% to fit the lot.', 'Este plano tendría que reducirse al 88% para caber en el lote.'],
    ["The lot's width caps this plan at about 2,150 sf.", 'El ancho del lote limita este plano a unos 2,150 pies².'],
  ]
  for (const [rule, es] of reasons) {
    const read = plainReason(rule)
    assert.doesNotMatch(read, /setback/i, rule)
    assert.equal(toSpanish(read), es, read)
    assert.equal(toSpanish(`Does not fit this lot: ${read}`), `No cabe en este lote: ${es}`)
    spanish(toSpanish(read), read)
  }
  assert.equal(toSpanish('At 6,000 sf this plan runs past the setbacks on this lot.'), 'Con 6,000 pies² este plano se pasa del espacio que la ciudad mantiene libre a lo largo de cada orilla del lote.')
  // what is Spanish already is left alone; a sentence nobody wrote a template for is never passed on half-English
  assert.equal(toSpanish('Hice la cocina más grande.'), 'Hice la cocina más grande.')
  assert.equal(toSpanish('Zorbled the flux capacitor.', { fallback: 'No pude hacer ese cambio.' }), 'No pude hacer ese cambio.')
  assert.deepEqual(untranslated('Zorbled the flux capacitor.'), ['Zorbled the flux capacitor.'])
  // the chat's own safety net: an English sentence from the model, on a Spanish screen, is replaced by what the plan
  // code says was done; a refusal nobody has Spanish for becomes one plain Spanish sentence
  const done = localize({ applied: true, reply: 'Made the kitchen a bit roomier for you.', did: ["Kitchen is now 15.75' by 18.75' (was 13.75' by 16.25')"], ops: [{ op: 'resize' }] }, 'es')
  assert.equal(done.reply, 'La cocina ahora mide 15.75 por 18.75 pies (antes 13.75 por 16.25).')
  const asked = localize({ applied: false, reply: 'Which bedroom did you have in mind?', ops: [] }, 'es')
  assert.equal(asked.reply, 'No estoy seguro de qué cambiar. ¿Me lo puede decir de otra manera?')
  assert.equal(localize({ applied: false, reply: 'x', askOffice: 'more-changes' }, 'en').askLabel, 'Ask the office for more changes')
})

// ── the office API over HTTP ──────────────────────────────────────────────────────────────────────────────────
async function freePort() {
  const s = net.createServer()
  await new Promise((r) => s.listen(0, '127.0.0.1', r))
  const { port } = s.address()
  await new Promise((r) => s.close(r))
  return port
}
/** A stand-in for api.anthropic.com on this machine: it answers the Messages API with what `asPrompted` says the model is asked to send. */
async function fakeClaude() {
  const calls = []
  let answer = asPrompted
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      const send = (status, body) => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(body))
      }
      if (req.method === 'GET' && req.url.startsWith('/v1/models/')) return send(200, { type: 'model', id: decodeURIComponent(req.url.split('/').pop()), display_name: 'stand-in', created_at: '2026-01-01T00:00:00Z' })
      if (req.method === 'POST' && req.url.startsWith('/v1/messages')) {
        const body = JSON.parse(raw)
        const input = JSON.parse(body.messages[0].content)
        calls.push({ input, system: body.system, output_config: body.output_config, model: body.model })
        return send(200, { id: 'msg_standin', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: JSON.stringify(answer(input.request, input.rooms, input)) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 900, output_tokens: 60 } })
      }
      send(404, { type: 'error', error: { type: 'not_found_error', message: 'not here' } })
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  return { url: `http://127.0.0.1:${server.address().port}`, calls, stop: () => new Promise((r) => server.close(r)), answerWith: (fn) => (answer = fn || asPrompted) }
}
async function startOffice(env = {}) {
  const port = await freePort()
  const base = `http://127.0.0.1:${port}`
  const proc = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, ...fixtureEnv, DRAFTHOUSE_CLAUDE_KEY: '', ANTHROPIC_API_KEY: '', ANTHROPIC_BASE_URL: '', NODE_USE_ENV_PROXY: '', NO_PROXY: '127.0.0.1,localhost', DATABASE_URL: '', SUPABASE_URL: '', RESEND_API_KEY: '', DRAFTHOUSE_APP_KEY: '', DRAFTHOUSE_WORKER_KEY: 'test-worker-key', DRAFTHOUSE_DRAFTERS: 'drafter@drafthouse.test', PORT: String(port), DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dh-r13-')), ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  proc.stdout.on('data', (c) => (out += c))
  proc.stderr.on('data', (c) => (out += c))
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(base + '/api/health')
      break
    } catch {
      if (i === 99) throw new Error('the office did not start:\n' + out)
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  const login = await (await fetch(base + '/api/auth/dev-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'homeowner@example.com', name: 'Test Homeowner' }) })).json()
  const h = { 'content-type': 'application/json', authorization: `Bearer ${login.token}` }
  // one connection per request (no keep-alive): a socket the office closed while other tests ran is never reused
  const raw = (method, p, body, headers = h) =>
    new Promise((resolve, reject) => {
      const req = http.request(base + p, { method, headers, agent: false }, (res) => {
        let text = ''
        res.on('data', (c) => (text += c))
        res.on('end', () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : {} }))
      })
      req.on('error', reject)
      if (body !== undefined) req.write(JSON.stringify(body))
      req.end()
    })
  const call = async (method, p, body) => {
    const r = await raw(method, p, body)
    assert.ok(r.status < 300, `${method} ${p} → ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`)
    return r.body
  }
  return {
    base,
    raw,
    log: () => out,
    stop: () => proc.kill(),
    /** A new saved plan on a lot; its id. */
    start: async (plan) => (await call('POST', '/api/projects', { style: { id: 'farmhouse', name: 'Modern Farmhouse' }, program: plan.program, rooms: plan.rooms, client: 'Test Homeowner', lot: { address: 'test lot', spec: plan.lot.spec } })).id,
    /** One chat message (or a tapped button, with its ops), the way the app posts it. */
    change: (id, text, { ops, lang } = {}) => call('POST', `/api/projects/${id}/change`, { text, ...(ops ? { ops } : {}), ...(lang ? { lang } : {}) }),
    detail: (id) => call('GET', `/api/projects/${id}`),
    rollback: (id, version) => call('POST', `/api/projects/${id}/rollback`, { version }),
  }
}

let office // no Claude key: the basic rules answer
let claude // the stand-in model
let officeClaude // the office with a key, talking to the stand-in
before(async () => {
  claude = await fakeClaude()
  ;[office, officeClaude] = await Promise.all([startOffice(), startOffice({ DRAFTHOUSE_CLAUDE_KEY: 'stand-in-not-a-key', ANTHROPIC_BASE_URL: claude.url })])
})
after(async () => {
  office?.stop()
  officeClaude?.stop()
  await claude?.stop()
})

/** The twenty through one office; `mode` names it in messages. Each on a fresh plan with 10 changes. */
async function twentyOverHttp(o, mode, expectSource) {
  const table = []
  for (const q of REQUESTS) {
    const plan = PLANS[q.plan]
    const id = await o.start(plan)
    const r = await o.change(id, q.text) // no lang in the body: the language is read from the text
    const after = await o.detail(id)
    await judge(q, { ...r, program: after.program }, plan, mode)
    assert.equal(r.source, q.outcome === 'answer' ? 'fallback' : expectSource, `${mode}: "${q.text}"`)
    assert.equal(r.lang, 'es', q.text)
    assert.doesNotMatch(JSON.stringify(r.fixes || []), MONEY_ES, q.text)
    if (q.outcome === 'applied') {
      assert.equal(r.changesUsed, 1, `${mode}: "${q.text}": one change used`)
      assert.equal(r.changesLeft, 9)
      assert.ok(sameRooms(after.rooms, r.rooms), 'the saved plan is the one that was answered')
    } else {
      assert.equal(r.changesUsed, 0, `${mode}: "${q.text}": nothing used`)
      assert.equal(r.changesLeft, 10)
      assert.equal(after.version, 1, 'the plan did not change')
    }
    // an offered button: tapped, it applies, uses one change, and the answer is Spanish
    if (q.outcome === 'offer') {
      const f = r.fixes[0]
      const d = await o.change(id, f.label, { ops: f.ops })
      assert.equal(d.applied, true, `${mode}: "${q.text}": the button "${f.label}" applies: ${d.reply}`)
      assert.equal(d.source, 'fix')
      assert.equal(d.changesUsed, 1, 'the tap is the change')
      spanish(d.reply, `${mode}: the answer to "${f.label}"`)
      const then = await o.detail(id)
      sound(then.rooms, then.program, plan.lot, `${mode}: after "${f.label}"`)
    }
    table.push(`${q.text} → ${q.outcome}: ${r.reply}`)
  }
  return table
}

test('1b (office API over HTTP, no Claude key): the twenty Spanish requests: same outcomes, Spanish replies and buttons, a change used only when the plan changes', async (t) => {
  const table = await twentyOverHttp(office, 'office, no key', 'fallback')
  for (const line of table) t.diagnostic(line)
})

test('1b (office API over HTTP): `lang` in the body sets the language when the text does not; a wrong type is refused at the door', async () => {
  const id = await office.start(PLANS.tight)
  const en = await office.change(id, 'Make the kitchen bigger')
  assert.equal(en.lang, undefined)
  assert.match(en.reply, /^The kitchen cannot get that much bigger here: /)
  const es = await office.change(id, 'Make the kitchen bigger', { lang: 'es' })
  assert.equal(es.lang, 'es')
  assert.match(es.reply, /^La cocina no puede crecer tanto aquí: /)
  assert.deepEqual(es.fixes.map((f) => f.label), ['Hacer la cocina 1 pie más de largo'])
  assert.equal(es.changesUsed, 0)
  // the tap sends the button's Spanish label; the answer is Spanish with or without lang
  const picked = await office.change(id, es.fixes[0].label, { ops: es.fixes[0].ops })
  assert.equal(picked.applied, true, picked.reply)
  spanish(picked.reply, 'the tap')
  assert.equal(picked.changesUsed, 1)
  // an English label tapped on a Spanish screen
  const open = await office.change(id, 'Make it feel more open', { lang: 'es' })
  assert.equal(open.applied, false)
  spanish(open.reply, 'more open, lang es')
  for (const f of open.fixes) spanish(f.label, f.label)
  // the cost answer: Spanish, with the office button's words; with lang "en" an English question stays English
  const cost = await office.change(id, 'how much is it?', { lang: 'es' })
  assert.equal(cost.reply, COST_REPLY_ES)
  assert.equal(cost.askOffice, 'meeting')
  assert.equal(cost.askLabel, 'Pedir a la oficina que programe mi reunión')
  const costEn = await office.change(id, 'how much is it?', { lang: 'en' })
  assert.equal(costEn.askLabel, 'Ask the office to set up my meeting')
  assert.match(costEn.reply, /^Great question\./)
  assert.equal(costEn.changesUsed, 1, 'only the tap used a change')
  const bad = await office.raw('POST', `/api/projects/${id}/change`, { text: 'add an office', lang: 5 })
  assert.equal(bad.status, 400)
  assert.match(bad.body.error, /lang must be a string/)
})

test('1b (office API over HTTP): out of changes in Spanish: the answer and the office button', async () => {
  const id = await office.start(PLANS.roomy)
  // ten changes that apply: the kitchen a foot wider, then back, five times
  const k = room(PLANS.roomy.rooms, 'kitchen')
  for (let i = 0; i < 10; i++) {
    const r = await office.change(id, 'tap', { ops: [{ op: 'resize', room: 'kitchen', w: k.w + (i % 2 ? 0 : 1), d: k.d }] })
    assert.equal(r.applied, true, r.reply)
  }
  const out = await office.change(id, 'agrega una oficina')
  assert.equal(out.applied, false)
  assert.equal(out.outOfChanges, true)
  assert.equal(out.reply, 'Ya usó los cambios incluidos en este plano. La oficina le agregará más. ¿Quiere que les avise?')
  assert.equal(out.askOffice, 'more-changes')
  assert.equal(out.askLabel, 'Pedir más cambios a la oficina')
  assert.equal(out.changesLeft, 0)
})

// ── 1. Spanish: (c) the Claude path ───────────────────────────────────────────────────────────────────────────
test('1c (Claude path): the prompt tells the model to read Spanish and to answer in the client\'s language; the answer shape is the one the API takes', async () => {
  assert.match(INTERPRET_SYSTEM, /Many buyers write in Spanish, the casual Spanish of the Rio Grande Valley, with or without accents and with typos/)
  assert.match(INTERPRET_SYSTEM, /Read a Spanish request exactly as you would the same request in English and write the same ops/)
  assert.match(INTERPRET_SYSTEM, /"Quiero 4 recámaras", "3 baños" are count ops/)
  assert.match(INTERPRET_SYSTEM, /"Que la casa sea de 2,500 pies" is a scale op with sqft 2500/)
  assert.match(INTERPRET_SYSTEM, /Write the reply in the buyer's language: the input's "lang" when it is given \("es" Spanish, "en" English\), otherwise the language the request is written in/)
  assert.match(INTERPRET_SYSTEM, /never "setback" or a trade word for it in Spanish; say "el espacio que la ciudad mantiene libre a lo largo de cada orilla del lote"/)
  assert.match(INTERPRET_SYSTEM, /never the word "precio"/)
  // the shape did not grow: one shape per op, every field required, the intent as it was (round 12: an optional
  // field more and the API refuses the schema as too complex)
  const shapes = DIFF_SCHEMA.properties.ops.items.anyOf
  assert.deepEqual(shapes.map((s) => s.properties.op.enum[0]), ['resize', 'add', 'remove', 'move', 'moveBeside', 'garage', 'scale', 'swap', 'count'])
  for (const s of [...shapes, DIFF_SCHEMA]) {
    assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort(), 'every field is required')
    assert.equal(s.additionalProperties, false)
  }
  assert.deepEqual(Object.keys(DIFF_SCHEMA.properties), ['ops', 'reply', 'confidence', 'intent'])
  assert.deepEqual(DIFF_SCHEMA.properties.intent.enum, ['open', 'none'])
  // what asPrompted stands in with is an answer that shape allows
  for (const q of REQUESTS) {
    const a = q.claude(summarizeRooms(PLANS[q.plan].rooms))
    assert.deepEqual(Object.keys(a).sort(), ['confidence', 'intent', 'ops', 'reply'])
    for (const o of a.ops) assert.deepEqual(Object.keys(o).sort(), [...shapes.find((s) => s.properties.op.enum[0] === o.op).required].sort(), `${q.text}: every field of the op is written`)
    assert.deepEqual(validateOps(normalizeOps(tidy(a).ops, PLANS[q.plan].rooms), PLANS[q.plan].rooms, kit).errors, [], q.text)
  }
  // when the model comes back with nothing to do, a plain count and a wish for a more open house are read in Spanish too
  const unsure = { ops: [], reply: '¿Cuál habitación?', confidence: 0.3 }
  assert.deepEqual(backstop('quiero 4 recámaras', unsure).ops, [{ op: 'count', kind: 'bed', count: 4 }])
  assert.equal(backstop('que se sienta más abierta', unsure).intent, 'open')
  assert.deepEqual(backstop('hazla más bonita', unsure), unsure)
  // the interpreter sends the request as the client wrote it, with the language beside it
  const calls = []
  const interpreter = makeInterpreter({ env: {}, log: () => {}, client: { messages: { parse: async (params) => (calls.push(params), { stop_reason: 'end_turn', usage: { input_tokens: 900, output_tokens: 60 }, parsed_output: asPrompted(JSON.parse(params.messages[0].content).request, JSON.parse(params.messages[0].content).rooms) }) } } })
  const diff = await interpreter.ask({ request: 'quita la oficina', lang: 'es', program: PLANS.roomy.program, kit: { id: kit.id, name: kit.name, kinds: {} }, rooms: summarizeRooms(PLANS.roomy.rooms) })
  assert.deepEqual(diff.ops, [{ op: 'remove', room: 'office' }])
  assert.equal(calls[0].system[0].text, INTERPRET_SYSTEM)
  assert.deepEqual(calls[0].output_config.format.schema, DIFF_SCHEMA, 'the schema is sent as written')
  assert.deepEqual(JSON.parse(calls[0].messages[0].content).lang, 'es')
  assert.equal(JSON.parse(calls[0].messages[0].content).request, 'quita la oficina')
})

test('1c (Claude path, the office over HTTP with the model stubbed): the twenty Spanish requests come to the same outcomes, with Spanish replies and buttons', async (t) => {
  const from = claude.calls.length
  const table = await twentyOverHttp(officeClaude, 'office, Claude', 'claude')
  for (const line of table) t.diagnostic(line)
  const calls = claude.calls.slice(from)
  // the model was asked 19 times (the cost question never reaches it), each time with the client's own words,
  // the language, the prompt and the schema
  assert.deepEqual(calls.map((c) => c.input.request), REQUESTS.filter((q) => q.outcome !== 'answer').map((q) => q.text))
  for (const c of calls) {
    assert.equal(c.input.lang, 'es', c.input.request)
    assert.equal(c.system[0].text, INTERPRET_SYSTEM)
    assert.deepEqual(c.output_config.format.schema, DIFF_SCHEMA)
    assert.ok(c.input.rooms.some((r) => r.kind === 'kitchen'), 'the rooms go with the request')
  }
})

test('1c (Claude path): what the model writes is never passed on half-English: an English reply on a Spanish request is replaced by the plan code\'s Spanish, and an English request is not sent `lang`', async () => {
  const from = claude.calls.length
  // the model answers in English whatever it was told
  claude.answerWith((request, rooms) => {
    const a = asPrompted(request, rooms)
    return { ...a, reply: a.ops.length ? 'I made that change to your house plan for you.' : 'Which room would you like to change?' }
  })
  try {
    const id = await officeClaude.start(PLANS.roomy)
    const done = await officeClaude.change(id, 'la cocina más grande')
    assert.equal(done.applied, true, done.reply)
    assert.equal(done.source, 'claude')
    spanish(done.reply, 'an English reply from the model')
    assert.match(done.reply, /^La cocina ahora mide [\d.]+ por [\d.]+ pies \(antes [\d.]+ por [\d.]+\)\.$/)
    const asked = await officeClaude.change(id, 'quiero cambiar el cuarto')
    assert.equal(asked.applied, false)
    assert.equal(asked.reply, 'No estoy seguro de qué cambiar. ¿Me lo puede decir de otra manera?')
    assert.equal(asked.changesUsed, 1)
  } finally {
    claude.answerWith(null)
  }
  // an English request with no lang: the model is not told a language, and the answer is the model's own English
  const id = await officeClaude.start(PLANS.roomy)
  const en = await officeClaude.change(id, 'add an office')
  assert.equal(en.lang, undefined)
  const sent = claude.calls.slice(from).find((c) => c.input.request === 'add an office')
  assert.equal(sent.input.lang, undefined)
  // an English request on a Spanish screen: the model is told "es"
  await officeClaude.change(id, 'remove the half bath', { lang: 'es' })
  assert.equal(claude.calls.slice(from).find((c) => c.input.request === 'remove the half bath').input.lang, 'es')
})

// ── 2. typed undo ─────────────────────────────────────────────────────────────────────────────────────────────
const UNDO = ['undo', 'undo that', 'go back', 'go back to how it was', 'put it back', 'deshaz eso', 'regresa como estaba', 'quita el último cambio']
test('2 (reading): the undo phrasings in English and Spanish are undo, and requests that only look like them are not', () => {
  for (const text of [...UNDO, 'Undo that.', 'undo the last change', 'go back to the way it was', 'put it back how it was', 'revert that', 'please undo', 'Deshaz eso', 'deshaz el ultimo cambio', 'deshacer', 'regresa como estaba antes', 'regrésalo como estaba', 'vuelve a como estaba', 'quita el ultimo cambio', 'déjalo como estaba']) assert.equal(isUndoRequest(text), true, text)
  for (const text of ['undo the garage', 'go back to 3 bedrooms', 'put the office back', 'quita la oficina', 'quita el medio baño', 'regresa la oficina a donde estaba', 'add an office', 'la cocina más grande', 'asdf', '']) assert.equal(isUndoRequest(text), false, text)
})

test('2 (the app with no account): typed undo is answered as undo, uses nothing, and never reaches the model', async () => {
  let asked = 0
  const model = async () => {
    asked++
    return { ops: [], reply: 'x', confidence: 0.2 }
  }
  for (const text of UNDO) {
    const none = await interpretRequest(text, PLANS.roomy.rooms, PLANS.roomy.program, style, { lot: PLANS.roomy.lot, interpreter: model, report: false, history: [] })
    assert.equal(none.applied, false, text)
    assert.equal(none.undo, true, text)
    const es = isSpanish(text)
    assert.equal(none.reply, es ? 'Todavía no hay nada que deshacer. No se usó ningún cambio.' : 'There is nothing to undo yet. No change was used.', text)
    // with a change standing, the screen does the undo (it holds the earlier plan); the answer carries `undo`
    const some = await interpretRequest(text, PLANS.roomy.rooms, PLANS.roomy.program, style, { lot: PLANS.roomy.lot, interpreter: model, report: false, history: [{ text: 'add an office', ops: [{ op: 'add', kind: 'office' }] }] })
    assert.equal(some.undo, true, text)
    assert.equal(some.applied, false)
  }
  assert.equal(asked, 0)
})

/** A change, then each typed undo, over HTTP: the plan is the earlier version and the change is given back, as with the Undo button. */
async function undoOverHttp(o, mode, expectSource) {
  const id = await o.start(PLANS.roomy)
  const first = await o.detail(id)
  // nothing to undo on a first draft: said so, in the language asked, and nothing is used
  for (const [text, reply] of [['undo that', 'There is nothing to undo yet. No change was used.'], ['deshaz eso', 'Todavía no hay nada que deshacer. No se usó ningún cambio.']]) {
    const none = await o.change(id, text)
    assert.equal(none.applied, false, `${mode}: ${text}`)
    assert.equal(none.reply, reply)
    assert.equal(none.changesUsed, 0)
    assert.equal(none.version, 1)
  }
  for (const text of UNDO) {
    const ch = await o.change(id, 'add an office')
    assert.equal(ch.applied, true, `${mode}: ${ch.reply}`)
    assert.equal(ch.source, expectSource)
    assert.equal(ch.changesUsed, 1)
    assert.equal(count(ch.rooms, 'office'), 2)
    const un = await o.change(id, text)
    assert.equal(un.applied, true, `${mode}: "${text}": ${un.reply}`)
    assert.equal(un.undo, true, text)
    assert.equal(un.changesUsed, 0, `${mode}: "${text}": the change is given back`)
    assert.equal(un.changesLeft, 10)
    assert.equal(un.refunded, 1)
    assert.equal(un.version, ch.version + 1)
    assert.ok(sameRooms(un.rooms, first.rooms), `${mode}: "${text}": the plan is the earlier version`)
    // round 15, P1: plain words, no version number
    assert.equal(un.reply, isSpanish(text) ? "Listo, la casa quedó como estaba. Te devolvimos 1 cambio." : "Done, the house is back to how it was. 1 change returned.", text)
    const now = await o.detail(id)
    assert.ok(sameRooms(now.rooms, first.rooms), 'saved that way')
    assert.equal(now.changesUsed, 0)
    assert.equal(now.changesLeft, 10)
    assert.equal(now.versions[now.versions.length - 1].kind, 'rollback', 'the same version entry the Undo button writes')
    assert.equal(count(now.rooms, 'office'), 1)
    // typed again with nothing more to take off: said so, nothing changes (before round 13 this put the undone change back at no change)
    const again = await o.change(id, text)
    assert.equal(again.applied, false, `${mode}: "${text}" a second time`)
    assert.match(again.reply, /^(There is nothing to undo yet\. No change was used\.|Todavía no hay nada que deshacer\. No se usó ningún cambio\.)$/)
    assert.equal(again.version, un.version)
    assert.equal(again.changesUsed, 0)
  }
  // exactly what the Undo button does: the button's own route on a twin plan gives the same plan and the same count
  const twin = await o.start(PLANS.roomy)
  const c2 = await o.change(twin, 'add an office')
  const viaButton = await o.rollback(twin, c2.version - 1)
  assert.ok(sameRooms(viaButton.rooms, first.rooms))
  assert.equal(viaButton.changesUsed, 0)
  assert.equal(viaButton.refunded, 1)
  // two changes, undo typed twice: each comes off in turn and comes back to the plan
  const a = await o.change(twin, 'add an office')
  const b = await o.change(twin, 'remove the half bath')
  assert.equal(b.applied, true, b.reply)
  assert.equal(b.changesUsed, 2)
  const u1 = await o.change(twin, 'go back to how it was')
  assert.ok(sameRooms(u1.rooms, a.rooms), 'back to the plan with the office')
  assert.equal(u1.changesUsed, 1)
  const u2 = await o.change(twin, 'regresa como estaba')
  assert.ok(sameRooms(u2.rooms, first.rooms), 'back to the first draft')
  assert.equal(u2.changesUsed, 0)
  const u3 = await o.change(twin, 'undo')
  assert.equal(u3.applied, false)
  assert.equal(u3.changesUsed, 0)
}

test('2 (office API over HTTP, no Claude key): a change, then typed undo in each phrasing: the earlier plan is back and the change is returned', async () => {
  await undoOverHttp(office, 'office, no key', 'fallback')
})

test('2 (office API over HTTP, Claude stubbed): the same, and an undo never reaches the model', async () => {
  const from = claude.calls.length
  await undoOverHttp(officeClaude, 'office, Claude', 'claude')
  const asked = claude.calls.slice(from).map((c) => c.input.request)
  assert.ok(asked.length > 0 && asked.every((t) => t === 'add an office' || t === 'remove the half bath'), `only the changes were sent to the model: ${[...new Set(asked)].join(' | ')}`)
})

// ── 3. two wishes that pull against each other; a request nobody can read ─────────────────────────────────────
test('3 (reading): a smaller house with more bedrooms or bathrooms is a trade-off; a size, a room, or fewer rooms is not; "asdf" and "make it nicer" are unclear, a real request is not', () => {
  assert.deepEqual(tradeOffAsk('make the house smaller but add 2 bedrooms'), { kind: 'bed', add: 2 })
  assert.deepEqual(tradeOffAsk('a smaller house with 5 bedrooms'), { kind: 'bed', count: 5 })
  assert.deepEqual(tradeOffAsk('shrink the house and add a bathroom'), { kind: 'bath', add: 1 })
  assert.deepEqual(tradeOffAsk('haz la casa mas chica pero agrega 2 recamaras'), { kind: 'bed', add: 2 })
  assert.deepEqual(tradeOffAsk('quiero la casa más chica y con otro baño'), { kind: 'bath', add: 1 })
  for (const text of ['make the house 2,400 sf and add 2 bedrooms', 'make the kitchen smaller and add a bedroom', 'make the house smaller', 'add 2 bedrooms', 'make the house smaller and remove a bedroom', 'make the kitchen wider, then make it smaller', 'que la casa sea de 2,500 pies y agrega una recámara']) assert.equal(tradeOffAsk(text), null, text)
  for (const text of ['asdf', 'make it nicer', 'hmm', 'ok', 'hazla mas bonita', 'no se', 'hola', '???']) assert.equal(unclearAsk(text), true, text)
  for (const text of ['make the kitchen bigger', 'add an office', 'make it 2,400 sf', 'I want 4 bedrooms', 'la cocina más grande', 'make it feel more open', 'how much is it', 'undo', 'move the wall', 'make the house smaller']) assert.equal(unclearAsk(text), false, text)
})

test('3 (basic rules): "make the house smaller but add 2 bedrooms" explains the trade-off and offers one button that applies and passes the rules, on a roomy lot and on a tight one, in English and Spanish', async () => {
  for (const [text, es] of [['make the house smaller but add 2 bedrooms', false], ['haz la casa mas chica pero agrega 2 recamaras', true]]) {
    for (const name of ['roomy', 'three', 'tight']) {
      const plan = PLANS[name]
      const what = `${name}: ${text}`
      const now = floorArea(plan.rooms, 1)
      const had = programOf(plan.rooms, plan.program).beds
      const r = await basic(text, plan)
      assert.equal(r.applied, false, what)
      assert.equal(r.offer, 'trade-off', what)
      assert.equal(r.fixes.length, 1, `${what}: one option: ${r.reply}`)
      // the trade-off in plain words, with the plan's own numbers; not a refusal about the edge of the lot
      if (es) {
        spanish(r.reply, what)
        spanish(r.fixes[0].label, what)
        assert.match(r.reply, /^Una casa más chica y con más recámaras son dos deseos que jalan cada uno para su lado: cada recámara necesita su propio espacio, así que las demás habitaciones tienen que ceder un poco\. Este plano tiene [\d,]+ pies² con \d recámaras\. /, what)
        assert.match(r.reply, / Toque el botón para verla; solo se usa un cambio cuando usted lo toca\.$/)
      } else {
        plain(r.reply, what)
        plain(r.fixes[0].label, what)
        assert.match(r.reply, /^A smaller house with more bedrooms is two wishes that pull against each other: every bedroom needs floor area of its own, so the other rooms have to give some up\. This plan is [\d,]+ sf with \d bedrooms\. /, what)
        assert.match(r.reply, / Tap the button to see it; a change is used only when you tap\.$/)
        assert.doesNotMatch(r.reply, /too close to|runs past|edge of the lot/, 'not a refusal about the edge of the lot')
      }
      // the one button: it applies, the plan passes every rule, and the house is smaller
      const d = await tap(r.fixes[0], plan)
      assert.equal(d.applied, true, `${what}: the button "${r.fixes[0].label}" applies: ${d.reply}`)
      const program = d.program || plan.program
      sound(d.rooms, program, plan.lot, what)
      assert.ok(floorArea(d.rooms, 1) < now - 25, `${what}: the house is smaller (${Math.round(floorArea(d.rooms, 1))} from ${Math.round(now)})`)
      const got = programOf(d.rooms, program).beds
      if (name === 'tight') {
        // more bedrooms fit nowhere on this lot: the option is the smaller house with the bedrooms it has, and the answer says so
        assert.equal(got, had, what)
        assert.match(r.reply, es ? /Más recámaras no caben en este lote, ni en una casa más chica ni en esta\./ : /More bedrooms do not fit on this lot, in a smaller house or in this one\./)
      } else assert.equal(got, had + 2, `${what}: with the two bedrooms`)
      if (es) spanish(d.reply, `${what}: the answer to the tap`)
    }
  }
  // bathrooms the same way; a plan that already has the number asked for is not a trade-off
  const bath = await basic('a smaller house with one more bathroom', PLANS.roomy)
  assert.equal(bath.offer, 'trade-off')
  assert.equal(bath.fixes.length, 1)
  assert.match(bath.reply, /^A smaller house with more bathrooms is two wishes/)
  assert.equal((await tap(bath.fixes[0], PLANS.roomy)).applied, true)
  const same = await basic('a smaller house with 4 bedrooms', PLANS.roomy)
  assert.notEqual(same.offer, 'trade-off')
})

test('3 (basic rules): "asdf", "make it nicer", "hmm": "I did not catch that" and three example buttons that fit the plan as it is; nothing applied; each button applies', async () => {
  for (const [text, es] of [['asdf', false], ['make it nicer', false], ['hmm', false], ['hazla mas bonita', true], ['no se', true]]) {
    for (const name of ['roomy', 'tight']) {
      const plan = PLANS[name]
      const what = `${name}: ${text}`
      const r = await basic(text, plan)
      assert.equal(r.applied, false, what)
      assert.equal(r.offer, 'examples', what)
      assert.equal(r.reply, es ? 'No le entendí. Aquí hay algunos cambios que sí funcionan en este plano. Toque uno, o dígame con sus palabras qué le gustaría; solo se usa un cambio cuando usted toca uno.' : 'I did not catch that. Here are some changes that work on this plan. Tap one, or tell me in your own words what you would like; a change is used only when you tap one.', what)
      assert.equal(r.fixes.length, 3, what)
      assert.equal(new Set(r.fixes.map((f) => f.label)).size, 3)
      for (const f of r.fixes) {
        if (es) spanish(f.label, what)
        else plain(`${f.label}, as a button`, what)
        assert.deepEqual(validateOps(f.ops, plan.rooms, kit).errors, [], `${what}: "${f.label}"`)
        const d = await tap(f, plan)
        assert.equal(d.applied, true, `${what}: the button "${f.label}" applies: ${d.reply}`)
        sound(d.rooms, d.program || plan.program, plan.lot, `${what} after "${f.label}"`)
      }
    }
  }
  // the examples follow the plan: with a porch at the back already, adding one is not offered; taking it off is
  const labels = (plan) => exampleFixes(plan.rooms, plan.program, style, kit, plan.lot).map((f) => f.label)
  assert.deepEqual(labels(PLANS.roomy), ['Make the kitchen bigger', 'Add a porch on the back', 'Add a bedroom'])
  const porch = await basic('add a porch on the back', PLANS.roomy)
  assert.equal(porch.applied, true)
  const withPorch = { ...PLANS.roomy, rooms: porch.rooms }
  assert.ok(labels(withPorch).includes('Remove the rear porch') && !labels(withPorch).includes('Add a porch on the back'), labels(withPorch).join(' | '))
  // on the tight lot "bigger" does not fit, so the example is the growth that does
  assert.equal(labels(PLANS.tight)[0], 'Make the kitchen 1 ft longer')
  // the house bigger or smaller with no size is not guessed at and is not "unclear": the size is asked for
  const bigger = await basic('make the house bigger', PLANS.roomy)
  assert.equal(bigger.applied, false)
  assert.equal(bigger.reply, 'How big should the house be? Tell me the living area you want, like "make the house 2,400 sf".')
  assert.equal((await basic('haz la casa mas grande', PLANS.roomy)).reply, '¿De qué tamaño quiere la casa? Dígame el área habitable que quiere, por ejemplo "que la casa sea de 2,400 pies²".')
  // the model coming back unsure on such a request gets the same answer; its question stands when a room was named
  const unsure = async () => ({ ops: [], reply: 'Which room do you mean?', confidence: 0.2 })
  const viaModel = await interpretRequest('make it nicer', PLANS.roomy.rooms, PLANS.roomy.program, style, { lot: PLANS.roomy.lot, interpreter: unsure, report: false })
  assert.equal(viaModel.source, 'claude')
  assert.equal(viaModel.offer, 'examples')
  assert.equal(viaModel.fixes.length, 3)
  const named = await interpretRequest('make the bedroom nicer', PLANS.roomy.rooms, PLANS.roomy.program, style, { lot: PLANS.roomy.lot, interpreter: unsure, report: false })
  assert.equal(named.reply, 'Which room do you mean?')
  assert.equal(decide({ ops: [], reply: 'x', confidence: 0.2, intent: 'unclear' }, PLANS.roomy.rooms, PLANS.roomy.program, style, kit, 'claude', PLANS.roomy.lot).fixes.length, 3)
})

/** Item 3 through one office over HTTP: nothing is used by the answers, the tapped button uses one change. */
async function vagueOverHttp(o, mode) {
  for (const [text, es, name] of [['make the house smaller but add 2 bedrooms', false, 'roomy'], ['haz la casa mas chica pero agrega 2 recamaras', true, 'roomy'], ['make the house smaller but add 2 bedrooms', false, 'tight']]) {
    const plan = PLANS[name]
    const what = `${mode}, ${name}: ${text}`
    const id = await o.start(plan)
    const r = await o.change(id, text)
    assert.equal(r.applied, false, what)
    assert.equal(r.offer, 'trade-off', what)
    assert.equal(r.fixes.length, 1, `${what}: ${r.reply}`)
    assert.equal(r.changesUsed, 0, `${what}: nothing used`)
    assert.equal(r.changesLeft, 10)
    assert.match(r.reply, es ? /^Una casa más chica y con más recámaras son dos deseos que jalan cada uno para su lado/ : /^A smaller house with more bedrooms is two wishes that pull against each other/)
    if (es) {
      spanish(r.reply, what)
      spanish(r.fixes[0].label, what)
    } else plain(r.reply, what)
    const direct = await basic(text, plan)
    assert.equal(r.reply, direct.reply, `${what}: the same answer as the basic rules give directly`)
    assert.deepEqual(r.fixes, direct.fixes, `${what}: the same button`)
    const d = await o.change(id, r.fixes[0].label, { ops: r.fixes[0].ops })
    assert.equal(d.applied, true, `${what}: the button applies: ${d.reply}`)
    assert.equal(d.changesUsed, 1, 'the tap is the change')
    const after = await o.detail(id)
    sound(after.rooms, after.program, plan.lot, what)
    assert.ok(floorArea(after.rooms, 1) < floorArea(plan.rooms, 1) - 25, `${what}: the house is smaller`)
    assert.equal(programOf(after.rooms, after.program).beds, programOf(plan.rooms, plan.program).beds + (name === 'tight' ? 0 : 2), what)
    if (es) spanish(d.reply, `${what}: the answer to the tap`)
  }
  const id = await o.start(PLANS.roomy)
  for (const [text, es] of [['asdf', false], ['make it nicer', false], ['hmm', false], ['hazla mas bonita', true]]) {
    const r = await o.change(id, text)
    const what = `${mode}: ${text}`
    assert.equal(r.applied, false, what)
    assert.equal(r.offer, 'examples', what)
    assert.match(r.reply, es ? /^No le entendí\. Aquí hay algunos cambios que sí funcionan en este plano\./ : /^I did not catch that\. Here are some changes that work on this plan\./, what)
    assert.deepEqual(r.fixes.map((f) => f.label), es ? ['Hacer la cocina más grande', 'Agregar un porche atrás', 'Agregar una recámara'] : ['Make the kitchen bigger', 'Add a porch on the back', 'Add a bedroom'], what)
    assert.equal(r.changesUsed, 0, `${what}: nothing used`)
    assert.equal(r.changesLeft, 10)
  }
  // "asdf" on a Spanish screen; then one example tapped: it applies and uses one change
  const es = await o.change(id, 'asdf', { lang: 'es' })
  assert.match(es.reply, /^No le entendí\./)
  const d = await o.change(id, es.fixes[1].label, { ops: es.fixes[1].ops, lang: 'es' })
  assert.equal(d.applied, true, d.reply)
  assert.equal(d.changesUsed, 1)
  assert.equal(count(d.rooms, 'rearPorch'), 1)
  spanish(d.reply, `${mode}: the example tapped`)
  // the examples now follow the plan: the porch is there, so adding one is no longer offered
  const next = await o.change(id, 'hmm')
  assert.ok(!next.fixes.some((f) => f.label === 'Add a porch on the back'), next.fixes.map((f) => f.label).join(' | '))
  assert.equal(next.fixes.length, 3)
  assert.equal(next.changesUsed, 1)
}

test('3 (office API over HTTP, no Claude key): the trade-off with its one button, and the unclear request with its three, use no change until a button is tapped', async () => {
  await vagueOverHttp(office, 'office, no key')
})

test('3 (office API over HTTP, Claude stubbed): the same answers when the model is the one reading; the trade-off never reaches it', async () => {
  const from = claude.calls.length
  await vagueOverHttp(officeClaude, 'office, Claude')
  const asked = claude.calls.slice(from).map((c) => c.input.request)
  assert.ok(!asked.some((t) => /smaller|chica/.test(t)), 'the trade-off is answered before any model is asked')
  assert.ok(asked.includes('asdf') && asked.includes('make it nicer') && asked.includes('hmm'), 'the unclear requests went to the model, which came back unsure')
})
