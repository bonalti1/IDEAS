// Round 15, P1 and P2: a typed undo is answered in the language of the request, in plain words with no version
// number ("Done, the house is back to how it was. 1 change returned." / "Listo, la casa quedó como estaba. Te
// devolvimos 1 cambio."), with nothing to undo too; and "can you undo that?", "please undo", "ctrl z", "¿puedes
// deshacer eso?" are undo. In both chat modes; an undo never uses a change and never reaches the model.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { isUndoRequest } from '../src/draft/lib/ops.js'
import { translate } from '../src/draft/lib/i18n.js'
import { sameRooms } from '../src/draft/lib/interpret.js'
import { PLANS } from './round13-requests.mjs'
import { startOffice, fakeClaude } from './round15-chat-harness.mjs'

const P2 = ['can you undo that?', 'Can you undo that', 'please undo', 'Please undo.', 'undo please', 'ctrl z', 'Ctrl+Z', 'ctrl-z', 'could you please undo that?', '¿puedes deshacer eso?', 'puedes deshacer eso', '¿me puedes deshacer eso, por favor?', 'control z']
const DONE_EN = 'Done, the house is back to how it was. 1 change returned.'
const DONE_ES = 'Listo, la casa quedó como estaba. Te devolvimos 1 cambio.'
const NOTHING_EN = 'There is nothing to undo yet. No change was used.'
const NOTHING_ES = 'Todavía no hay nada que deshacer. No se usó ningún cambio.'

test('P2 (reading): question forms, a please and "ctrl z" are undo; requests that only look like it are not', () => {
  for (const text of P2) assert.equal(isUndoRequest(text), true, text)
  for (const text of ['can you undo the garage?', 'undo the office and add a bedroom', 'ctrl', 'please add an office', '¿puedes agregar una oficina?', 'quita la oficina']) assert.equal(isUndoRequest(text), false, text)
})

test('P1 (the Draft screen): a typed undo is said in the language it was typed in, in plain words, never as a version', () => {
  // the words the screen writes, in both languages
  assert.equal(translate('en', 'Done, the house is back to how it was. {n} {n|change|changes} returned.', { n: 1 }), DONE_EN)
  assert.equal(translate('es', 'Done, the house is back to how it was. {n} {n|change|changes} returned.', { n: 1 }), DONE_ES)
  assert.equal(translate('es', 'Done, the house is back to how it was. {n} {n|change|changes} returned.', { n: 2 }), 'Listo, la casa quedó como estaba. Te devolvimos 2 cambios.')
  assert.equal(translate('es', 'There is nothing to undo yet.') + ' ' + translate('es', 'No change was used.'), NOTHING_ES)
  const src = fs.readFileSync('src/draft/screens/Draft.jsx', 'utf8')
  const undoPart = src.slice(src.indexOf('const undoLast'), src.indexOf('return (', src.indexOf('const undoLast')))
  assert.doesNotMatch(undoPart, /Back to version|Undid/, 'the undo line has no version and no quote of the old request')
  assert.match(src, /const asked = isSpanish\(q\) \? 'es' : lang/, 'the language of the request')
  assert.match(src, /houseText\(m, m\.lang \|\| lang\)/, 'a line keeps the language it was asked in')
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
  test(`P1 and P2 (office API over HTTP, ${mode}): each undo phrasing takes the change off, gives it back and answers in the request's language`, async () => {
    const o = get()
    const from = claude.calls.length
    const id = await o.start(PLANS.roomy)
    const first = await o.detail(id)
    // nothing to undo: said so in the language asked, nothing used
    for (const [text, reply] of [['regrésalo como estaba', NOTHING_ES], ['¿puedes deshacer eso?', NOTHING_ES], ['can you undo that?', NOTHING_EN]]) {
      const none = await o.change(id, text)
      assert.equal(none.applied, false, `${mode}: "${text}"`)
      assert.equal(none.reply, reply, `${mode}: "${text}"`)
      assert.equal(none.changesUsed, 0)
    }
    for (const text of ['undo', 'deshaz eso', ...P2]) {
      const ch = await o.change(id, 'add an office')
      assert.equal(ch.applied, true, ch.reply)
      assert.equal(ch.changesUsed, 1)
      const un = await o.change(id, text)
      assert.equal(un.undo, true, `${mode}: "${text}" is undo: ${un.reply}`)
      assert.equal(un.applied, true)
      assert.equal(un.changesUsed, 0, `${mode}: "${text}": the change is given back`)
      assert.ok(sameRooms(un.rooms, first.rooms), `${mode}: "${text}": the earlier plan`)
      const es = /[¿ñ]|deshaz|deshacer/i.test(text)
      assert.equal(un.reply, es ? DONE_ES : DONE_EN, `${mode}: "${text}"`)
      assert.doesNotMatch(un.reply, /version|versión/i)
    }
    // with the screen in Spanish, an English undo is answered in Spanish too
    await o.change(id, 'add an office')
    assert.equal((await o.change(id, 'undo', { lang: 'es' })).reply, DONE_ES)
    assert.deepEqual(claude.calls.slice(from).map((c) => c.input.request).filter((t) => t !== 'add an office'), [], 'an undo never reaches the model')
  })
}
