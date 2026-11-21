// Round 15, U3 and U12: "dos baños y medio", "2 y medio baños", "two and a half baths", "2.5 baths" are two full
// baths and one half bath (never 4 full baths, never a "medio" left unread), with the basic rules, at the office with
// no Claude key, and at the office with the model stubbed (the half is read before any model, so both modes agree).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { interpretRequest } from '../src/draft/lib/interpret.js'
import { countAsk, regexOps } from '../src/draft/lib/ops.js'
import { fromSpanish } from '../src/draft/lib/es.js'
import { programOf, DEFAULT_PROGRAM } from '../src/draft/lib/layout.js'
import { checkRules } from '../src/draft/lib/rules.js'
import { buildLot } from '../src/draft/lib/lot.js'
import { draft, style, kit, spanish } from './round13-requests.mjs'
import { startOffice, fakeClaude } from './round15-chat-harness.mjs'

const ROOMY = buildLot({ kind: 'manual', width: 100, depth: 150, city: 'mcallen', frontStreet: 'E Nolana Ave', setbacks: {} })
// the 3/2 plan the review tried it on (no half bath), and a 3-bath plan with one
const PLANS = {
  threeTwo: draft({ ...DEFAULT_PROGRAM, beds: 3, baths: 2, halfBath: false, office: false }, ROOMY),
  threeThree: draft({ ...DEFAULT_PROGRAM, beds: 3, baths: 3, halfBath: false, office: false }, ROOMY),
}
const ASKS = ['dos baños y medio', '2 y medio baños', 'two and a half baths', '2.5 baths', 'quiero dos baños y medio', '2 1/2 bathrooms please']
const halfOf = (rooms, program) => {
  const c = programOf(rooms, program)
  return { baths: c.baths, half: c.halfBaths }
}

test('U3 (reading): a half in a bath count is two full baths and a half bath, in English and Spanish', () => {
  for (const text of ASKS) assert.deepEqual(countAsk(text), [{ kind: 'bath', count: 2, half: 1 }], text)
  assert.equal(fromSpanish('dos baños y medio').text, '2.5 bathrooms')
  assert.equal(fromSpanish('2 y medio baños').text, '2.5 bathrooms')
  assert.deepEqual(countAsk('3 bedrooms 2.5 baths'), [{ kind: 'bath', count: 2, half: 1 }, { kind: 'bed', count: 3 }])
  const read = regexOps('2.5 baths', PLANS.threeTwo.rooms, kit)
  assert.deepEqual(read.ops, [{ op: 'count', kind: 'bath', count: 2, half: 1 }])
  // a half bath on its own is still a room, and other fractions are never a count
  assert.deepEqual(countAsk('add a half bath'), [])
  assert.deepEqual(countAsk('3.7 baths'), [])
})

const offline = async () => {
  throw new Error('no api')
}
// a model that gets it wrong on purpose: 4 full baths. The half is read before it is asked, so it never counts
const wrongModel = async () => ({ ops: [{ op: 'count', kind: 'bath', count: 4 }], reply: 'Agregué 2 baños.', confidence: 0.9 })

test('U3 (basic rules and the app with a model): 2 full baths and 1 half bath on the 3/2 plan and on a 3-bath plan; one change; Spanish answered in Spanish', async () => {
  for (const [name, plan] of Object.entries(PLANS)) {
    for (const text of ASKS) {
      for (const interpreter of [offline, wrongModel]) {
        const r = await interpretRequest(text, plan.rooms, plan.program, style, { lot: plan.lot, interpreter, report: false })
        assert.equal(r.applied, true, `${name}: "${text}": ${r.reply}`)
        assert.deepEqual(halfOf(r.rooms, plan.program), { baths: 2, half: 1 }, `${name}: "${text}" is 2 full baths and a half bath: ${r.reply}`)
        assert.deepEqual(checkRules(r.rooms, r.program || plan.program, style, plan.lot).reasons, [])
        assert.doesNotMatch(r.reply, /medio"|"medio|No hice|didn't do/, `${name}: "${text}": nothing left unread: ${r.reply}`)
        if (/baños/.test(text)) spanish(r.reply, `${name}: "${text}"`)
        else assert.match(r.reply, /2 bathrooms and a half bath/, r.reply)
      }
    }
  }
  // asked again on a plan that has it: nothing to do, nothing used
  const done = await interpretRequest('2.5 baths', PLANS.threeTwo.rooms, PLANS.threeTwo.program, style, { lot: PLANS.threeTwo.lot, interpreter: offline, report: false })
  const again = await interpretRequest('dos baños y medio', done.rooms, PLANS.threeTwo.program, style, { lot: PLANS.threeTwo.lot, interpreter: offline, report: false })
  assert.equal(again.applied, false)
  assert.equal(again.noop, true)
  assert.equal(again.reply, 'Este plano ya tiene 2 baños y medio. No se usó ningún cambio.')
})

let office
let claude
let officeClaude
before(async () => {
  claude = await fakeClaude(() => ({ ops: [{ op: 'count', kind: 'bath', count: 4 }], reply: 'Agregué 2 baños.', confidence: 0.9, intent: 'none' }))
  ;[office, officeClaude] = await Promise.all([startOffice(), startOffice({ DRAFTHOUSE_CLAUDE_KEY: 'stand-in-not-a-key', ANTHROPIC_BASE_URL: claude.url })])
})
after(async () => {
  office?.stop()
  officeClaude?.stop()
  await claude?.stop()
})

for (const [mode, get] of [['no Claude key', () => office], ['Claude stubbed', () => officeClaude]]) {
  test(`U3 (office API over HTTP, ${mode}): each phrasing gives 2 full baths and 1 half bath and uses one change`, async () => {
    const o = get()
    for (const text of ['dos baños y medio', '2 y medio baños', 'two and a half baths', '2.5 baths']) {
      const id = await o.start(PLANS.threeTwo)
      const r = await o.change(id, text)
      assert.equal(r.applied, true, `${mode}: "${text}": ${r.reply}`)
      assert.deepEqual(halfOf(r.rooms, PLANS.threeTwo.program), { baths: 2, half: 1 }, `${mode}: "${text}": ${r.reply}`)
      assert.equal(r.changesUsed, 1)
      if (/baños/.test(text)) spanish(r.reply, `${mode}: "${text}"`)
    }
  })
}
