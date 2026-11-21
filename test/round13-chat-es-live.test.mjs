// Round 13 against the real Claude interpreter. Skipped unless LIVE=1 and DRAFTHOUSE_CLAUDE_KEY are set:
//   NODE_USE_ENV_PROXY=1 LIVE=1 node --test test/round13-chat-es-live.test.mjs
// The same twenty Spanish requests as test/round13-chat-es.test.mjs, each sent through the office's own change
// path (server/projects.mjs: the prompt and the schema the office uses, the plan code judging the ops, the answer
// put in Spanish), with the real model doing the reading. The key is read by the interpreter from the environment
// and is never printed; only what Claude answered is.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { normalizeOps } from '../src/draft/lib/ops.js'
import { checkRules } from '../src/draft/lib/rules.js'
import { buildLot } from '../src/draft/lib/lot.js'
import { makeInterpreter } from '../server/interpreter.mjs'
import { makeProjects } from '../server/projects.mjs'
import { openStore } from '../server/store/index.mjs'
import { style, PLANS, REQUESTS, spanish, leftoverEnglish, MONEY_ES, JARGON_ES } from './round13-requests.mjs'

const ON = process.env.LIVE === '1' && !!(process.env.DRAFTHOUSE_CLAUDE_KEY || '').trim()
const skip = ON ? false : 'set LIVE=1 and DRAFTHOUSE_CLAUDE_KEY to run against the real Claude interpreter'

/** The office's project code on a scratch store, with the real interpreter; `log` holds what the model sent back. */
async function liveOffice() {
  // the office waits 8 s for Claude before the basic rules answer; this check waits longer so a slow answer is still read
  const interpreter = makeInterpreter({ env: { ...process.env, INTERPRET_TIMEOUT_MS: process.env.INTERPRET_TIMEOUT_MS || '45000' }, log: () => {} })
  assert.equal(interpreter.configured, true)
  const store = openStore({ databaseUrl: '', dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'dh-r13-live-')) })
  const log = []
  const projects = makeProjects({ store, interpreter, event: async () => {}, logInterpret: (rec) => log.push(rec), lots: { lotOfProject: async (p) => buildLot(p.lot.spec) } })
  const user = { id: 'u-test', email: 'homeowner@example.com', name: 'Test Homeowner' }
  await store.users.put(user)
  return {
    log,
    start: async (plan) => (await projects.create(user, { style: { id: 'farmhouse', name: 'Modern Farmhouse' }, program: plan.program, rooms: plan.rooms, client: 'Test Homeowner', lot: { address: 'test lot', spec: plan.lot.spec } })).id,
    change: async (id, text, ops, opts) => projects.change(await projects.load(user, id), text, ops, opts),
    detail: async (id) => projects.detail(await projects.load(user, id)),
  }
}
/** What the model itself sent back for the last request (the office log's "diff" line). */
const modelSaid = (log, text) => [...log].reverse().find((r) => r.request === text && r.diff)

test('live Claude: the twenty Spanish requests are read as the ops they mean, come to the same outcomes as with the basic rules, and are answered in Spanish', { skip, timeout: 900000 }, async (t) => {
  const o = await liveOffice()
  const said = []
  const wrong = []
  let english = 0
  try {
    for (const q of REQUESTS) {
      const plan = PLANS[q.plan]
      const id = await o.start(plan)
      const r = await o.change(id, q.text)
      const sent = modelSaid(o.log, q.text)
      const after = await o.detail(id)
      said.push(`"${q.text}" → ${sent ? `Claude ops ${JSON.stringify(sent.diff.ops)} conf ${sent.diff.confidence} in ${sent.ms} ms, own reply: ${sent.diff.reply}` : 'not sent to the model'} → ${r.applied ? 'applied' : r.fixes?.length ? 'offer' : 'answer'} (${r.source}): ${r.reply}${r.fixes?.length ? ` [buttons: ${r.fixes.map((f) => f.label).join(' | ')}]` : ''}`)
      const what = `"${q.text}"`
      try {
        // the model did the reading (the cost question never reaches it)
        if (q.outcome === 'answer') assert.equal(sent, undefined, `${what}: a cost question is not sent to the model`)
        else {
          assert.equal(r.source, 'claude', `${what}: answered by the model, not the basic rules`)
          assert.ok(sent, `${what}: the model was asked`)
          assert.ok(q.op(normalizeOps(sent.diff.ops, plan.rooms), plan.rooms), `${what}: read as the op it means: ${JSON.stringify(sent.diff.ops)}`)
          // the model's own sentence: Spanish, no money, no trade word (if it slips an English word in, the office
          // replaces the sentence; that is counted, and the answer below is what the homeowner reads)
          assert.doesNotMatch(String(sent.diff.reply), MONEY_ES, `${what}: Claude's own reply: ${sent.diff.reply}`)
          assert.doesNotMatch(String(sent.diff.reply), JARGON_ES, `${what}: Claude's own reply: ${sent.diff.reply}`)
          if (leftoverEnglish(sent.diff.reply)) english++
        }
        assert.equal(r.applied, q.outcome === 'applied', `${what}: ${q.outcome}: ${r.reply}`)
        assert.equal(r.lang, 'es')
        spanish(r.reply, what, { cost: !!q.cost })
        if (q.outcome === 'applied') {
          assert.ok(q.done(r.rooms, after.program, plan.rooms), `${what}: the plan shows it: ${r.reply}`)
          assert.deepEqual(checkRules(r.rooms, after.program, style, plan.lot).reasons, [], what)
          assert.equal(r.changesUsed, 1)
        } else {
          assert.equal(r.changesUsed, 0, `${what}: nothing used`)
          if (q.outcome === 'offer') {
            assert.ok(r.fixes.length >= 1, `${what}: a button is offered`)
            for (const f of r.fixes) spanish(f.label, `${what}: "${f.label}"`)
            const d = await o.change(id, r.fixes[0].label, r.fixes[0].ops)
            assert.equal(d.applied, true, `${what}: the button "${r.fixes[0].label}" applies: ${d.reply}`)
            spanish(d.reply, `${what}: the answer to the tap`)
          } else {
            assert.equal(r.askLabel, 'Pedir a la oficina que programe mi reunión')
          }
        }
      } catch (e) {
        wrong.push(String(e.message).slice(0, 400))
      }
    }
    assert.deepEqual(wrong, [], 'all twenty understood, each with its op or offer and a Spanish answer')
    said.push(`Claude's own sentence carried an English word in ${english} of ${REQUESTS.length - 1} answers (those were replaced by the plan code's Spanish)`)
  } finally {
    for (const line of said) t.diagnostic(line)
  }
})

test('live Claude: an English request on a Spanish screen is answered in Spanish, a request nobody can read gets the three examples, and typed undo and the trade-off never reach the model', { skip, timeout: 600000 }, async (t) => {
  const o = await liveOffice()
  const said = []
  try {
    const id = await o.start(PLANS.roomy)
    // the screen is Spanish (lang "es"), the text is English: the model is told the language
    const es = await o.change(id, 'make the kitchen bigger', null, { lang: 'es' })
    said.push(`"make the kitchen bigger" with lang es → ${es.source}: ${es.reply} (Claude's own: ${modelSaid(o.log, 'make the kitchen bigger')?.diff.reply})`)
    assert.equal(es.applied, true, es.reply)
    assert.equal(es.source, 'claude')
    spanish(es.reply, 'English on a Spanish screen')
    // typed undo: the plan is back, the change is returned, and the model was not asked
    const before = o.log.filter((r) => r.diff).length
    const undo = await o.change(id, 'deshaz eso')
    said.push(`"deshaz eso" → ${undo.reply}`)
    assert.equal(undo.applied, true)
    assert.equal(undo.undo, true)
    assert.equal(undo.changesUsed, 0)
    assert.equal(undo.reply, 'Listo, la casa quedó como estaba. Te devolvimos 1 cambio.') // round 15, P1
    const trade = await o.change(id, 'haz la casa mas chica pero agrega 2 recamaras')
    said.push(`"haz la casa mas chica pero agrega 2 recamaras" → ${trade.reply} [button: ${trade.fixes.map((f) => f.label).join(' | ')}]`)
    assert.equal(trade.offer, 'trade-off')
    assert.equal(trade.fixes.length, 1)
    spanish(trade.reply, 'the trade-off')
    assert.equal(o.log.filter((r) => r.diff).length, before, 'neither was sent to the model')
    // nobody can read these: the model comes back with nothing to do, and the answer is the three examples
    for (const [text, spanishAsked] of [['asdf', false], ['make it nicer', false], ['hmm', false], ['hazla mas bonita', true]]) {
      const r = await o.change(id, text)
      const sent = modelSaid(o.log, text)
      said.push(`"${text}" → Claude ops ${JSON.stringify(sent?.diff.ops)} conf ${sent?.diff.confidence}, own reply: ${sent?.diff.reply} → ${r.reply} [buttons: ${(r.fixes || []).map((f) => f.label).join(' | ')}]`)
      assert.equal(r.applied, false, text)
      assert.equal(r.source, 'claude', text)
      assert.equal(r.offer, 'examples', `${text}: ${r.reply}`)
      assert.equal(r.fixes.length, 3, text)
      assert.match(r.reply, spanishAsked ? /^No le entendí\./ : /^I did not catch that\./, text)
      assert.equal(r.changesUsed, 0, text)
    }
    const tapped = await o.change(id, 'Add a porch on the back', (await o.change(id, 'asdf')).fixes.find((f) => f.label === 'Add a porch on the back').ops)
    assert.equal(tapped.applied, true, tapped.reply)
    assert.equal(tapped.changesUsed, 1)
  } finally {
    for (const line of said) t.diagnostic(line)
  }
})
