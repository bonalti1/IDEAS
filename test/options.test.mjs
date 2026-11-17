// "Show me options": two or three sound options for the garage, the porches and the bedroom wing on
// the default draft and on the Garza sample, each passing the rules and the audit, each with its area
// and price change, each made of ops a pick sends as one ordinary change.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { optionsFor, optionTopic, OPTION_TOPICS } from '../src/draft/lib/options.js'
import { generateRooms, DEFAULT_PROGRAM, kitFor, isRoom } from '../src/draft/lib/layout.js'
import { auditPlan } from '../src/draft/lib/audit.js'
import { interpretRequest } from '../src/draft/lib/interpret.js'
import { STYLES } from '../src/draft/lib/styles.js'
import { DEFAULT_LOT } from '../src/draft/lib/lot.js'

const style = STYLES.find((s) => s.id === 'farmhouse')
const kit = kitFor(style)

test('the words that ask for options', () => {
  assert.equal(optionTopic('show me options for the garage'), 'garage')
  assert.equal(optionTopic('what are my choices for the porch?'), 'porch')
  assert.equal(optionTopic('bedroom wing options'), 'wing')
  assert.equal(optionTopic('make the garage 3 cars'), null)
  assert.equal(optionTopic('show me the plan'), null)
})

for (const [name, program] of [['the default draft', DEFAULT_PROGRAM], ['the Garza sample', { ...kit.reference.program }]]) {
  for (const topic of OPTION_TOPICS) {
    test(`options for ${topic} on ${name}: at least two, every one passes the audit, with ops and deltas`, async () => {
      const rooms = generateRooms(program, style, DEFAULT_LOT)
      const { options } = optionsFor(topic, rooms, program, style, DEFAULT_LOT)
      assert.ok(options.length >= 2 && options.length <= 3, `${options.length} options: ${options.map((o) => o.label).join(', ')}`)
      for (const o of options) {
        assert.deepEqual(auditPlan(o.rooms, program, kit, DEFAULT_LOT).errors.map((e) => e.message), [], o.label)
        assert.ok(o.ops.length >= 1 && typeof o.sf === 'number' && typeof o.cost === 'number' && o.svg.startsWith('<svg'), o.label)
        assert.ok(o.rooms.filter(isRoom).length >= 10)
        // picking it is one ordinary change with these ops, and lands on the same plan
        const picked = await interpretRequest(o.label, rooms, program, style, { lot: DEFAULT_LOT, interpreter: async () => ({ ops: o.ops, reply: o.label, confidence: 1 }), report: false })
        assert.equal(picked.applied, true, `${o.label}: ${picked.reply}`)
        assert.equal(picked.rooms.filter(isRoom).length, o.rooms.filter(isRoom).length)
      }
      const labels = options.map((o) => o.label)
      assert.equal(new Set(labels).size, labels.length, 'no two options alike')
    })
  }
}
