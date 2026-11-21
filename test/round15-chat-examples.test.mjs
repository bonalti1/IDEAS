// Round 15, U4, U12 and P3, on the two lots the review tried (Kiskadee, a tight pie lot, and Kerria, 2,833 sf),
// built from the recordings, plus the round 13 test plans:
//   U4   the example buttons under the chat are checked on THIS plan before they are shown, and each applies when
//        tapped; a refused add ("add an office") names the real reason and offers the one thing that works, or says
//        plainly there is no room, never "Try a smaller step";
//   U12  a refused resize ("make the kitchen bigger") is ONE sentence plus the smaller option as a button;
//   P3   a refused size ("la sala 3 pies más ancha") offers the widest that fits as the button.
// Nothing refused or offered uses a change; a tapped button that applies uses one.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { interpretRequest, exampleFixes, decide } from '../src/draft/lib/interpret.js'
import { kitFor, programOf } from '../src/draft/lib/layout.js'
import { checkRules } from '../src/draft/lib/rules.js'
import { lotOf } from '../src/draft/lib/layout.js'
import { plans, style } from './round15-lots.mjs'
import { PLANS, spanish } from './round13-requests.mjs'

const kit = kitFor(style)
const offline = async () => {
  throw new Error('no api')
}
const basic = (text, plan, opts = {}) => interpretRequest(text, plan.rooms, plan.program, style, { lot: plan.lot, interpreter: offline, report: false, ...opts })
/** A button tapped the way the Draft screen sends it: its label as the text, its ops as given. */
const tap = (fix, plan) => interpretRequest(fix.label, plan.rooms, plan.program, style, { lot: plan.lot, interpreter: async () => ({ ops: fix.ops, reply: '', confidence: 1 }), report: false })
const sentences = (text) => String(text).trim().split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ¿¡])/).length
const sound = (r, plan, what) => assert.deepEqual(checkRules(r.rooms, r.program || plan.program, style, plan.lot).reasons, [], `${what}: the plan passes every rule`)

test('U4 (the Draft screen): the example buttons are the checked ones, sent with the ops that were checked', () => {
  const src = fs.readFileSync('src/draft/screens/Draft.jsx', 'utf8')
  assert.match(src, /exampleFixes\(rooms, program, style, kit, lot/, 'the chips come from the checked examples')
  assert.match(src, /send\(say\(s\.label\), \{ ops: s\.ops, label: s\.label \}\)/, 'a chip is sent with its checked ops')
  assert.doesNotMatch(src, /out\.push\(t\('Make the kitchen bigger'\)\)/, 'no unchecked list')
})

test('U4 (Kiskadee and Kerria): every example button the chat shows applies when tapped, in English and in Spanish', async () => {
  const P = await plans()
  for (const [name, plan] of Object.entries(P)) {
    const list = exampleFixes(plan.rooms, plan.program, style, kit, plan.lot, 5)
    assert.ok(list.length >= 1, `${name}: at least one change works here`)
    for (const fix of list) {
      const r = await tap(fix, plan)
      assert.equal(r.applied, true, `${name}: "${fix.label}" applies when tapped: ${r.reply}`)
      sound(r, plan, `${name}: "${fix.label}"`)
      const es = await interpretRequest(fix.label, plan.rooms, plan.program, style, { lot: plan.lot, lang: 'es', interpreter: async () => ({ ops: fix.ops, reply: '', confidence: 1 }), report: false })
      assert.equal(es.applied, true)
    }
    // the request nobody could read offers the same checked buttons, and each of them applies too
    const vague = await basic('asdf', plan)
    assert.equal(vague.applied, false)
    for (const fix of vague.fixes) assert.equal((await tap(fix, plan)).applied, true, `${name}: "${fix.label}"`)
  }
  // Kiskadee: "make the kitchen bigger" does not fit there, so it is not offered (round 14 offered it, then refused it)
  const kis = P.kiskadee
  const shown = exampleFixes(kis.rooms, kis.program, style, kit, kis.lot, 5).map((f) => f.label)
  assert.ok(!shown.includes('Make the kitchen bigger'), shown.join(' | '))
  assert.equal((await basic('Make the kitchen bigger', kis)).applied, false)
})

test('U4 (Kerria and Kiskadee): "add an office" applies or names the real reason, with no "smaller step"; a button offered applies', async () => {
  const P = await plans()
  for (const [name, plan] of Object.entries(P)) {
    for (const text of ['add an office', 'Add an office', 'agrega una oficina', 'add a bedroom', 'add a half bath']) {
      const r = await basic(text, plan)
      assert.doesNotMatch(r.reply, /smaller step|paso más chico/i, `${name}: "${text}": ${r.reply}`)
      if (r.applied) continue
      assert.match(r.reply, /^(There is no room for an? [a-z ]+ (where it would go|on this lot): .+\.|No hay espacio para un[a]? [a-zé ]+ (donde iría|en este lote): .+\.)$/, `${name}: "${text}": the real reason in one sentence: ${r.reply}`)
      assert.equal(sentences(r.reply), 1, r.reply)
      if (/[áéíóúñ]|agrega/.test(text)) spanish(r.reply, `${name}: "${text}"`)
      for (const fix of r.fixes || []) {
        const done = await tap(fix, plan)
        assert.equal(done.applied, true, `${name}: "${fix.label}" applies: ${done.reply}`)
        sound(done, plan, `${name}: "${fix.label}"`)
      }
    }
  }
  // Kerria: the office goes in where there is room for it, as the button
  const ker = await basic('add an office', P.kerria)
  if (!ker.applied) {
    assert.equal(ker.fixes.length, 1, ker.reply)
    const done = await tap(ker.fixes[0], P.kerria)
    assert.equal(programOf(done.rooms, P.kerria.program).office, true)
  }
})

test('U12 (Kerria, Kiskadee, a tight lot): a refused "make the kitchen bigger" is one sentence, with the most that fits as the button', async () => {
  const P = { ...(await plans()), tight: PLANS.tight }
  let offered = 0
  for (const [name, plan] of Object.entries(P)) {
    for (const text of ['make the kitchen bigger', 'la cocina más grande']) {
      const r = await basic(text, plan)
      if (r.applied) continue
      assert.equal(sentences(r.reply), 1, `${name}: "${text}": one sentence: ${r.reply}`)
      assert.doesNotMatch(r.reply, /I tried smaller steps|Tell me which room|Probé con pasos|Dígame|in this kit goes up to/, r.reply)
      if (/cocina/.test(text)) spanish(r.reply, `${name}: "${text}"`)
      assert.ok(r.fixes.length <= 1)
      for (const fix of r.fixes) {
        offered++
        const done = await tap(fix, plan)
        assert.equal(done.applied, true, `${name}: "${fix.label}"`)
        sound(done, plan, `${name}: "${fix.label}"`)
      }
    }
  }
  assert.ok(offered >= 2, 'the smaller option is offered where one fits')
  // Kerria drafts the Valley plan (round 15): the kitchen grows as asked; a wider kitchen than the hall allows is
  // refused in one sentence with the widest that fits as the button
  const kerria = (await plans()).kerria
  const ker = await basic('make the kitchen bigger', kerria)
  assert.equal(ker.applied, true, ker.reply)
  const before = kerria.rooms.find((r) => r.id === 'kitchen')
  const after = ker.rooms.find((r) => r.id === 'kitchen')
  assert.ok(after.w * after.d >= before.w * before.d + 19, `the kitchen grows by a foot or more (${before.w} x ${before.d} → ${after.w} x ${after.d})`)
  sound(ker, kerria, 'the bigger kitchen on Kerria')
  const wider = await basic('make the kitchen 2 ft wider', kerria)
  assert.equal(wider.applied, false)
  assert.match(wider.reply, /^The kitchen can only grow [\d.]+ ft wider here: .+\.$/)
  assert.match(wider.fixes[0].label, /^Make the kitchen [\d.]+ ft wider$/)
  const done = await tap(wider.fixes[0], kerria)
  assert.equal(done.applied, true, done.reply)
  sound(done, kerria, `"${wider.fixes[0].label}"`)
})

test('P3: "la sala 3 pies más ancha" refused offers the widest that fits as the button; a foot more than that does not fit', async () => {
  const P = { roomy: PLANS.roomy, three: PLANS.three, ...(await plans()) }
  let offered = 0
  for (const [name, plan] of Object.entries(P)) {
    for (const text of ['la sala 3 pies más ancha', 'make the living room 3 feet wider']) {
      const r = await basic(text, plan)
      if (r.applied) continue
      assert.equal(sentences(r.reply), 1, `${name}: "${text}": ${r.reply}`)
      if (/sala/.test(text)) spanish(r.reply, `${name}: "${text}"`)
      if (!r.fixes.length) continue
      offered++
      const fix = r.fixes[0]
      const living = plan.rooms.find((x) => x.kind === 'living')
      const w = fix.ops[0].w
      assert.ok(w > living.w && w < living.w + 3, `${name}: wider, by less than asked (${living.w} → ${w})`)
      const done = await tap(fix, plan)
      assert.equal(done.applied, true, `${name}: "${fix.label}" applies`)
      sound(done, plan, `${name}: "${fix.label}"`)
      // the widest: a quarter foot more does not go through
      const more = decide({ ops: [{ op: 'resize', room: living.id, w: w + 0.25, d: living.d }], reply: '', confidence: 1 }, plan.rooms, plan.program, style, kit, 'fallback', lotOf(plan.lot), { depth: 2 })
      assert.equal(more.applied, false, `${name}: ${w + 0.25} ft does not fit`)
    }
  }
  assert.ok(offered >= 2, 'the widest that fits is offered on the plans where the living room can grow at all')
  // round 14 refused it on the roomy plan with the kit's limit and no button
  const roomy = await basic('la sala 3 pies más ancha', PLANS.roomy)
  assert.equal(roomy.fixes.length, 1, roomy.reply)
  assert.match(roomy.reply, /^La sala solo puede crecer [\d.]+ pies? más de ancho aquí: .+\.$/)
})
