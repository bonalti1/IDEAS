// Round 15, U2 and B6: "send my lot to the drafter" is read on meaning, in English and Spanish (accents optional,
// please / por favor anywhere, a question), in the browser and at the office, so both chat modes answer the same:
// the lot goes to the drafter's queue, no change is used, and the model is never asked.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { isSendLot } from '../src/draft/lib/intents.js'
import { interpretRequest } from '../src/draft/lib/interpret.js'
import { PLANS, style } from './round13-requests.mjs'
import { startOffice, fakeClaude } from './round15-chat-harness.mjs'

// the 7 phrasings the review missed come first in each language
export const SEND_LOT = {
  en: [
    'Send my lot to the drafter please',
    'can you send my lot to the drafter?',
    'send my lot to the drafter',
    'Please send my lot to a drafter.',
    'give my lot to the drafter',
    'Pass my lot to your drafter, please!',
    'have the drafter design it',
    'I want a drafter to design my house',
    'Could a drafter design a house for my lot?',
    'Can you hand my lot over to the drafter please?',
  ],
  es: [
    'mándale mi lote al dibujante',
    'envíen mi lote al dibujante',
    'que el dibujante diseñe mi casa',
    'quiero que un dibujante haga mi casa',
    'pásale mi lote al dibujante',
    'manda mi lote al dibujante por favor',
    '¿Puedes mandar mi lote al dibujante?',
    'por favor envia mi lote al dibujante',
    'mandale mi lote al dibujante',
    '¿Le pueden pasar mi terreno a un dibujante, por favor?',
  ],
}
export const NOT_SEND_LOT = ['send it', 'what does the drafter do?', '¿qué hace el dibujante?', 'make the lot bigger', 'send me a copy of the plan', 'who is the drafter', 'manda eso', 'I love it, send to drafters']

test('U2 (reading): the 20 phrasings are "send my lot to the drafter"; the near-misses are not', () => {
  assert.equal(SEND_LOT.en.length, 10)
  assert.equal(SEND_LOT.es.length, 10)
  for (const text of [...SEND_LOT.en, ...SEND_LOT.es]) assert.equal(isSendLot(text), true, text)
  for (const text of NOT_SEND_LOT) assert.equal(isSendLot(text), false, text)
  // nor is any ordinary change
  for (const text of ['add an office', 'make the kitchen bigger', 'agrega una oficina', 'undo', 'deshaz eso', 'make it nicer', 'how much will it cost?']) assert.equal(isSendLot(text), false, text)
})

test('U2 (the Draft screen): the chat reads it with the shared matcher, before any change is posted', () => {
  const src = fs.readFileSync('src/draft/screens/Draft.jsx', 'utf8')
  assert.match(src, /import \{[^}]*\bisSendLot\b[^}]*\} from '\.\.\/lib\/intents\.js'/)
  assert.doesNotMatch(src, /SEND_LOT_RE\s*=/, 'one matcher, not a second pattern in the screen')
  assert.match(src, /isSendLot\(q\)/)
})

test('U2 (the app with no account): the basic rules answer it as the drafter request, never as a change', async () => {
  for (const text of [...SEND_LOT.en, ...SEND_LOT.es]) {
    const r = await interpretRequest(text, PLANS.tight.rooms, PLANS.tight.program, style, { lot: PLANS.tight.lot, interpreter: async () => assert.fail('the model is never asked'), report: false })
    assert.equal(r.applied, false, text)
    assert.equal(r.sendLot, true, text)
  }
})

let office
let claude
let officeClaude
before(async () => {
  claude = await fakeClaude()
  ;[office, officeClaude] = await Promise.all([startOffice(), startOffice({ DRAFTHOUSE_CLAUDE_KEY: 'stand-in-not-a-key', ANTHROPIC_BASE_URL: claude.url })])
})
after(async () => {
  office?.stop()
  officeClaude?.stop()
  await claude?.stop()
})

for (const [mode, get] of [['no Claude key', () => office], ['Claude stubbed', () => officeClaude]]) {
  test(`U2 (office API over HTTP, ${mode}): each of the 20 puts the lot in the drafter's queue, uses no change and never reaches the model`, async () => {
    const o = get()
    const from = claude.calls.length
    const drafter = await o.drafter()
    for (const text of [...SEND_LOT.en, ...SEND_LOT.es]) {
      const id = await o.start(PLANS.tight)
      const r = await o.change(id, text)
      assert.equal(r.sendLot, true, `${mode}: "${text}": ${r.reply}`)
      assert.equal(r.applied, false, text)
      assert.equal(r.changesUsed, 0, `${mode}: "${text}" uses no change`)
      assert.equal(r.changesLeft, 10)
      assert.ok(r.project?.needsCustom, `${mode}: "${text}": the plan is flagged for the drafter`)
      if (/[ñáéíóú¿]|\b(?:mi|lote|dibujante|que)\b/i.test(text)) assert.match(r.reply, /^Tu lote ya está con nuestro dibujante\./, text)
      else assert.match(r.reply, /^Your lot is with our drafter now\./, text)
      const queue = await drafter.call('GET', '/api/review')
      assert.ok(queue.custom.some((p) => p.id === id), `${mode}: "${text}" is in the drafter's queue`)
    }
    // the near-misses are not sent; they go on as chat
    const id = await o.start(PLANS.tight)
    for (const text of NOT_SEND_LOT) {
      const r = await o.change(id, text)
      assert.notEqual(r.sendLot, true, text)
    }
    assert.equal((await o.detail(id)).needsCustom ?? null, null)
    assert.equal(claude.calls.slice(from).filter((c) => isSendLot(c.input.request)).length, 0, 'the model never saw a send-my-lot request')
  })
}
