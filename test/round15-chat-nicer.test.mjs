// Round 15, B6: "make it nicer", "hazla más bonita", "más bonita" get three buttons (bigger windows, a front porch,
// another style) instead of "I did not catch that". Each button works: the windows and the porch apply and pass the
// rules when tapped (one change), "another style" opens the style step (#/style/<id>, nothing used). The same in
// both chat modes: it is read before any model.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { wantsNicer } from '../src/draft/lib/intents.js'
import { interpretRequest } from '../src/draft/lib/interpret.js'
import { checkRules } from '../src/draft/lib/rules.js'
import { DEFAULT_PROGRAM, programOf } from '../src/draft/lib/layout.js'
import { buildLot } from '../src/draft/lib/lot.js'
import { stepHash, readHash } from '../src/draft/lib/route.js'
import { PLANS, draft, style, spanish } from './round13-requests.mjs'
import { plans } from './round15-lots.mjs'
import { startOffice, fakeClaude } from './round15-chat-harness.mjs'

const NICER = ['make it nicer', 'Make it nicer please', 'can you make it prettier?', 'make the house look nicer', 'nicer', 'hazla más bonita', 'más bonita', 'mas bonita', 'que se vea más bonita', 'haz la casa más bonita', 'hazla mas linda por favor']
const NOT = ['make the kitchen nicer', 'nice', 'that looks nice', 'beautiful!', 'add an office', 'asdf', 'la cocina más grande', 'make the kitchen bigger', 'quiero la cocina más bonita']
const ROOMY = buildLot({ kind: 'manual', width: 100, depth: 150, city: 'mcallen', frontStreet: 'E Nolana Ave', setbacks: {} })
const offline = async () => {
  throw new Error('no api')
}
const basic = (text, plan) => interpretRequest(text, plan.rooms, plan.program, style, { lot: plan.lot, interpreter: offline, report: false })
const tap = (fix, plan) => interpretRequest(fix.label, plan.rooms, plan.program, style, { lot: plan.lot, interpreter: async () => ({ ops: fix.ops, reply: '', confidence: 1 }), report: false })
const windowSpan = (rooms) => rooms.filter((e) => e.kind === 'window').reduce((s, e) => s + (e.span || 0), 0)

test('B6 (reading): "make it nicer" and "hazla más bonita" are read as a wish for a nicer house; a room named, or praise, is not', () => {
  for (const text of NICER) assert.equal(wantsNicer(text), true, text)
  for (const text of NOT) assert.equal(wantsNicer(text), false, text)
})

test('B6 (basic rules): three buttons, never "I did not catch that"; the windows and the porch apply when tapped, another style opens the style step', async () => {
  const P = { roomy: PLANS.roomy, tight: PLANS.tight, noPorch: draft({ ...DEFAULT_PROGRAM, frontPorch: false }, ROOMY), ...(await plans()) }
  for (const [name, plan] of Object.entries(P)) {
    for (const text of ['make it nicer', 'hazla más bonita', 'más bonita']) {
      const r = await basic(text, plan)
      const es = text !== 'make it nicer'
      assert.equal(r.applied, false, `${name}: "${text}" changes nothing by itself`)
      assert.equal(r.offer, 'nicer', `${name}: "${text}": ${r.reply}`)
      assert.doesNotMatch(r.reply, /did not catch|No le entendí|No te entendí/, r.reply)
      if (es) spanish(r.reply, `${name}: "${text}"`)
      const style2 = r.fixes.find((f) => f.goto === 'style')
      assert.ok(style2, `${name}: another style is offered`)
      assert.deepEqual(style2.ops, [])
      assert.equal(style2.label, es ? 'Escoge otro estilo para la casa' : 'Choose another style')
      const windows = r.fixes.find((f) => f.ops.some((o) => o.op === 'windows'))
      const porch = r.fixes.find((f) => /porch|porche/i.test(f.label))
      assert.ok(windows, `${name}: bigger windows offered`)
      if (name !== 'kiskadee') assert.ok(porch, `${name}: a front porch offered`)
      if (name === 'roomy' || name === 'kerria') assert.equal(r.fixes.length, 3)
      for (const f of r.fixes) {
        if (es) spanish(f.label, `${name}: "${f.label}"`)
        if (f.goto) continue
        const done = await tap(f, plan)
        assert.equal(done.applied, true, `${name}: "${f.label}" applies: ${done.reply}`)
        assert.deepEqual(checkRules(done.rooms, done.program || plan.program, style, plan.lot).reasons, [], `${name}: "${f.label}" passes the rules`)
        if (f === windows) assert.ok(windowSpan(done.rooms) > windowSpan(plan.rooms) + 1, `${name}: the windows are wider`)
        if (f === porch) assert.equal(programOf(done.rooms, plan.program).frontPorch, true)
      }
    }
  }
  // a plan with no front porch is offered one
  const noPorch = await basic('make it nicer', P.noPorch)
  assert.ok(noPorch.fixes.some((f) => /^(Add a front porch|Draw the house again with a front porch)/.test(f.label)), noPorch.fixes.map((f) => f.label).join(' | '))
})

test('B6 (the Draft screen): "Choose another style" opens the style step through the app\'s own address, and uses nothing', () => {
  const src = fs.readFileSync('src/draft/screens/Draft.jsx', 'utf8')
  assert.match(src, /f\.goto === 'style' \? toStyleStep\(\)/)
  assert.match(src, /window\.location\.hash = stepHash\(2, project\?\.id\)/)
  assert.equal(readHash(stepHash(2, 'prj_abc123')).step, 2)
  assert.equal(stepHash(2, 'prj_abc123'), '#/style/prj_abc123')
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
  test(`B6 (office API over HTTP, ${mode}): the three buttons, nothing used; a tapped window or porch button applies and uses one change`, async () => {
    const o = get()
    const from = claude.calls.length
    for (const text of ['make it nicer', 'hazla más bonita', 'más bonita']) {
      const id = await o.start(PLANS.roomy)
      const r = await o.change(id, text)
      assert.equal(r.offer, 'nicer', `${mode}: "${text}": ${r.reply}`)
      assert.equal(r.changesUsed, 0)
      assert.equal(r.fixes.length, 3)
      if (text !== 'make it nicer') spanish(r.reply, `${mode}: "${text}"`)
      for (const f of r.fixes.filter((x) => !x.goto)) {
        const twin = await o.start(PLANS.roomy)
        const done = await o.change(twin, f.label, { ops: f.ops })
        assert.equal(done.applied, true, `${mode}: "${f.label}": ${done.reply}`)
        assert.equal(done.changesUsed, 1)
      }
    }
    assert.equal(claude.calls.slice(from).filter((c) => wantsNicer(c.input.request)).length, 0, 'the model never saw it')
  })
}
