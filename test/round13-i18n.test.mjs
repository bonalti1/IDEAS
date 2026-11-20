// Fix round 13, item 1: the homeowner's screens in Spanish and English.
//   1. the two dictionaries: the same sentences on both sides, nothing empty, nothing left in English but a short
//      list of names and units, the same {placeholders}, and the standing rules (no money, no jargon for the space
//      the city keeps open) in Spanish too
//   2. the language: Spanish for a browser that asks for Spanish, English otherwise; the homeowner's own choice wins
//   3. the words: {name} and {n|one|many}, English exactly as written
//   4. the sentences the plan code writes go through one door (`sentence`), English untouched
//   5. the screens as code (test/i18n-scan.mjs): no English a homeowner reads outside t(...), with file and line
//   6. the words that reach t(...) from data (styles, steps, statuses, the kit, the rules, the rooms) are all there
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { en, es, detectLang, initialLang, rememberedLang, rememberLang, translate, sentence, says, houseText, placeName, roomName, ruleValue, ruleNote, optionLabel, programLineEs, groundWords, LANG_KEY } from '../src/draft/lib/i18n.js'
import { scanAll, HOMEOWNER_FILES } from './i18n-scan.mjs'
import { STYLES } from '../src/draft/lib/styles.js'
import { STATUS } from '../src/draft/lib/status.js'
import { TRUST, CHECKED } from '../src/draft/lib/trust.js'
import { TOPIC_NAMES, optionsFor, OPTION_TOPICS } from '../src/draft/lib/options.js'
import { KIT } from '../src/kits/modern-farmhouse.js'
import { homeLabel, plainReason } from '../src/draft/lib/plain.js'
import { statusWords, geoMessage, JURISDICTIONS, JURISDICTION_IDS, COUNTIES } from '../src/draft/lib/jurisdictions.js'
import { buildLot, lotProblem } from '../src/draft/lib/lot.js'
import { lotMatchNotes } from '../src/draft/lib/parcel-spec.js'
import { generateRooms, DEFAULT_PROGRAM, programLine, isRoom } from '../src/draft/lib/layout.js'
import { historyFrom } from '../src/draft/lib/status.js'

const farmhouse = STYLES.find((s) => s.id === 'farmhouse')
const has = (k) => Object.prototype.hasOwnProperty.call(es, k)

// ── 1. the dictionaries ─────────────────────────────────────────────────────────────────────────────

// the same in both languages on purpose: names, units, and words Spanish borrowed whole
const SAME = new Set(['No', 'no', 'industrial', 'Plat', 'Hill Country', 'Craftsman', 'Mid-Century', '3D', 'Porches', 'Total', 'Material', 'Extras'])
const names = (s) => [...new Set([...s.matchAll(/\{(\w+)(?:\|[^{}]*)?\}/g)].map((m) => m[1]))].sort()

test('1: every sentence is on both sides, none empty, none left in English outside a short list', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(es).sort(), 'the same keys in en and es')
  assert.ok(Object.keys(es).length > 500, `${Object.keys(es).length} sentences`)
  const empty = Object.entries(es).filter(([, v]) => typeof v !== 'string' || !v.trim()).map(([k]) => k)
  assert.deepEqual(empty, [], 'no Spanish sentence is empty')
  const same = Object.entries(es).filter(([k, v]) => v === k && !SAME.has(k)).map(([k]) => k)
  assert.deepEqual(same, [], 'a Spanish sentence that is still the English one')
  for (const k of SAME) assert.ok(has(k), `the allow-list names "${k}", which is not in the dictionary`)
  // English is the sentence itself: what a homeowner read before this round is what they read now
  for (const k of Object.keys(en)) assert.equal(en[k], k)
})

test('1: the {placeholders} are the same on both sides', () => {
  const off = Object.entries(es).filter(([k, v]) => JSON.stringify(names(k)) !== JSON.stringify(names(v))).map(([k, v]) => `${k}  →  ${v}`)
  assert.deepEqual(off, [], 'placeholders differ')
  // <b> opens and closes on both sides
  for (const [k, v] of Object.entries(es)) assert.equal((k.match(/<\/?b>/g) || []).join(''), (v.match(/<\/?b>/g) || []).join(''), k)
})

test('1: the standing rules hold in Spanish: no money, no jargon for the space the city keeps open', () => {
  const MONEY = /\$|\bprecios?\b|\btarifas?\b|\bcr[eé]ditos?\b|\bfactura|\bcobr[ao]|\bpagos?\b|\bpagar\b|\bd[oó]lares?\b|\bcotizaci[oó]n|\bpresupuesto|\bcredits?\b|\bprice|\bbilling|\/sf\b|\/pie/i
  const JARGON = /setback|retranqueo|\bretiros?\b|restricci[oó]n de l[ií]nea|l[ií]nea de construcci[oó]n|remetimiento/i
  const bad = Object.entries(es).filter(([, v]) => MONEY.test(v) || JARGON.test(v)).map(([k, v]) => `${k}  →  ${v}`)
  assert.deepEqual(bad, [])
  // the English sentences a homeowner reads say nothing of the kind either (one is the drafter's sheet list on the Send step's package tab)
  const enBad = Object.keys(es).filter((k) => /\$|\bprice|\bcredits?\b|\bbilling/i.test(k))
  assert.deepEqual(enBad, [])
  const enJargon = Object.keys(es).filter((k) => /setback/i.test(k))
  // two English lines had the word before this round and keep it (English does not change): the drafter's sheet list on the
  // Send step's package tab, and a label on the ground of the demo lot. Their Spanish says it in plain words.
  assert.deepEqual(enJargon.sort(), ["LOT 513 — NEIGHBOR (6' SIDE SETBACK)", 'lot, setbacks, driveway, concrete takeoff, paving details'])
  // where the English says it in plain words, the Spanish does too
  assert.match(es['lot, setbacks, driveway, concrete takeoff, paving details'], /el espacio que la ciudad mantiene libre a lo largo de cada orilla del lote/)
  // the words a Valley homeowner uses
  assert.equal(es.Bedrooms, 'Recámaras')
  assert.equal(es.Garage, 'Cochera')
  assert.equal(es['Full bathrooms'], 'Baños completos')
  assert.match(es['Send my lot to the drafter'], /lote.*dibujante/)
  assert.equal(es.sf, 'pies²')
  assert.equal(es.ft, 'pies')
  // feet stay feet: nobody is given metres
  assert.deepEqual(Object.values(es).filter((v) => /(?<![a-záéíóúñ])metros?\b|\bm²/i.test(v)), [])
})

// ── 2. the language ─────────────────────────────────────────────────────────────────────────────────

const store = (init = {}) => {
  const m = new Map(Object.entries(init))
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }
}

test('2: Spanish for a browser that asks for Spanish, English otherwise', () => {
  for (const l of ['es', 'es-MX', 'es-US', 'es-419', 'ES-mx']) assert.equal(detectLang({ language: l }), 'es', l)
  for (const l of ['en', 'en-US', 'fr-FR', 'pt-BR', 'est', '', undefined]) assert.equal(detectLang({ language: l }), 'en', String(l))
  // the first of the browser's languages decides
  assert.equal(detectLang({ languages: ['es-MX', 'en-US'], language: 'en-US' }), 'es')
  assert.equal(detectLang({ languages: ['en-US', 'es-MX'], language: 'es-MX' }), 'en')
  assert.equal(detectLang({ languages: [], language: 'es-US' }), 'es')
  assert.equal(detectLang(null), 'en')
})

test('2: the choice made with the switch is remembered and wins over the browser', () => {
  assert.equal(initialLang({ language: 'es-MX' }, store()), 'es')
  assert.equal(initialLang({ language: 'es-MX' }, store({ [LANG_KEY]: 'en' })), 'en')
  assert.equal(initialLang({ language: 'en-US' }, store({ [LANG_KEY]: 'es' })), 'es')
  // something else in the box is not a choice
  assert.equal(initialLang({ language: 'es-MX' }, store({ [LANG_KEY]: 'de' })), 'es')
  const s = store()
  rememberLang('es', s)
  assert.equal(rememberedLang(s), 'es')
  // a private window that refuses storage: no throw, the browser decides
  const refuses = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
  assert.doesNotThrow(() => rememberLang('es', refuses))
  assert.equal(rememberedLang(refuses), null)
  assert.equal(initialLang({ language: 'es-US' }, refuses), 'es')
})

// ── 3. the words ────────────────────────────────────────────────────────────────────────────────────

test('3: {name} and {n|one|many} are filled; English is the sentence as written', () => {
  const left = '{n} {n|change|changes} left on this plan'
  assert.equal(translate('en', left, { n: 10 }), '10 changes left on this plan')
  assert.equal(translate('en', left, { n: 1 }), '1 change left on this plan')
  assert.equal(translate('en', left, { n: 0 }), '0 changes left on this plan')
  assert.equal(translate('es', left, { n: 10 }), 'Te quedan 10 cambios')
  assert.equal(translate('es', left, { n: 1 }), 'Te queda 1 cambio')
  assert.equal(translate('en', 'Step {n} of {total} · {name}', { n: 4, total: 5, name: 'Draft' }), 'Step 4 of 5 · Draft')
  assert.equal(translate('es', 'Step {n} of {total} · {name}', { n: 4, total: 5, name: translate('es', 'Draft') }), 'Paso 4 de 5 · Borrador')
  // round 13, item 7: the note beside the count carries the plan's own number and never the words of the count
  const note = "{n} free {n|change|changes}; a failed request doesn't use one"
  assert.equal(translate('en', note, { n: 10 }), "10 free changes; a failed request doesn't use one")
  assert.equal(translate('en', note, { n: 14 }), "14 free changes; a failed request doesn't use one")
  assert.equal(translate('es', note, { n: 10 }), '10 cambios gratis; si uno no se puede hacer, no cuenta')
  assert.doesNotMatch(translate('en', note, { n: 10 }), /changes? left/)
  // a sentence the dictionary does not have comes back in English, never empty
  assert.equal(translate('es', 'A sentence nobody wrote down'), 'A sentence nobody wrote down')
  // a chat line the screens write: English text for the drafter's package, the parts for the homeowner's language
  const line = says(['Back to version {n}.', { n: 2 }], ['{n} {n|change|changes} returned.', { n: 1 }])
  assert.equal(line.text, 'Back to version 2. 1 change returned.')
  assert.equal(houseText({ who: 'house', ...line }, 'en'), 'Back to version 2. 1 change returned.')
  assert.equal(houseText({ who: 'house', ...line }, 'es'), 'De vuelta a la versión 2. Se te devolvió 1 cambio.')
  // the chat history rebuilt from saved versions reads in Spanish too, with the English text unchanged
  const h = historyFrom([{ kind: 'program' }, { kind: 'rollback', text: 'Back to version 3' }, { kind: 'change', text: 'x', reply: '' }])
  assert.deepEqual(h.filter((m) => m.who === 'house').map((m) => m.text), ['Rooms changed, here is the new draft.', 'Back to version 3.', 'Done.'])
  assert.deepEqual(h.filter((m) => m.who === 'house').map((m) => houseText(m, 'es')), ['Cambiaron los cuartos; aquí está el nuevo borrador.', 'De vuelta a la versión 3.', 'Listo.'])
})

// ── 4. sentences the plan code writes ───────────────────────────────────────────────────────────────

test('4: sentence() is the one door for what the plan code writes; English comes back untouched', () => {
  const reply = 'This plan already has 4 bedrooms. No change was used.'
  assert.equal(sentence(reply, 'en'), reply)
  // lib/es.js is plugged in: what the plan code writes is read in Spanish, with nothing of the English left
  assert.equal(sentence(reply, 'es'), 'Este plano ya tiene 4 recámaras. No se usó ningún cambio.')
  assert.equal(sentence('Making the kitchen about 15 percent bigger.', 'es'), 'Hice la cocina más o menos un 15 por ciento más grande.')
  // Spanish the office already sent stays as it is, and a sentence nobody has words for is shown as written, never lost
  assert.equal(sentence('Hice la cocina 2 pies más ancha.', 'es'), 'Hice la cocina 2 pies más ancha.')
  assert.equal(sentence('A sentence nobody wrote words for.', 'es'), 'A sentence nobody wrote words for.')
  assert.equal(sentence('', 'es'), '')
  assert.equal(sentence(undefined, 'es'), undefined)
  // a sentence the dictionary has word for word is Spanish already
  assert.equal(sentence('without the office', 'es'), 'sin la oficina')
  const src = fs.readFileSync('src/draft/lib/i18n.js', 'utf8')
  assert.match(src, /^import \{ toSpanish \} from '\.\/es\.js'/m, 'lib/es.js is the one place the plan\'s sentences are put into Spanish')
  // a line of the chat without its own parts goes through the same door, after "setback" is taken out
  assert.equal(houseText({ who: 'house', text: 'It crosses the rear setback.' }, 'en'), plainReason('It crosses the rear setback.'))
  assert.doesNotMatch(houseText({ who: 'house', text: 'It crosses the rear setback.' }, 'es'), /setback/)
})

test('4: the notes we translate ourselves: Spanish beside the English, the English byte for byte', () => {
  const table = Object.fromEntries(JURISDICTION_IDS.map((id) => [id, JURISDICTIONS[id]]))
  const geos = [
    null,
    { found: false },
    { found: false, note: 'The address was not found.' },
    { found: true, place: 'McAllen', county: 'Hidalgo County', state: 'TX' },
    { found: true, place: 'Edinburg', county: 'Hidalgo County', state: 'TX' },
    { found: true, place: 'La Joya', county: 'Hidalgo County', state: 'TX' },
    { found: true, place: '', county: 'Hidalgo County', state: 'TX' },
    { found: true, place: '', county: 'Starr County', state: 'TX' },
    { found: true, place: 'Laredo', county: 'Webb County', state: 'TX' },
    { found: true, place: '', county: '', state: 'TX' },
  ]
  for (const geo of geos) {
    assert.equal(geoMessage(geo, table, 'en'), geoMessage(geo, table), 'English is what it was')
    const s = geoMessage(geo, table, 'es')
    assert.doesNotMatch(s, /setback|\$|undefined|NaN/)
    if (geo && geo.found) {
      assert.notEqual(s, geoMessage(geo, table), JSON.stringify(geo))
      assert.doesNotMatch(s, /\b(the|rules|county defaults|unverified|summary)\b/, s)
    }
  }
  assert.match(geoMessage(geos[8], table, 'es'), /el espacio que la ciudad mantiene libre a lo largo de cada orilla del lote/)
  assert.match(geoMessage(geos[8], table), /setbacks shown are office defaults/, 'the English line is the one the tests of earlier rounds pin')
  // how a parcel was matched
  for (const spec of [
    { kind: 'parcel', address: '1201 Kerria Ave, McAllen, TX', confidence: 'near', listedAs: '1201 KERRIA' },
    { kind: 'parcel', address: '1201 Kerria Ave', confidence: 'pick', addressGives: 'P1', propId: 'P2', situs: '1203 KERRIA' },
    { kind: 'parcel', address: '', confidence: 'pick' },
    { kind: 'parcel', address: '1 A St', confidence: 'unchecked' },
    { kind: 'parcel', address: '1 A St', confidence: 'exact' },
    { kind: 'manual' },
  ]) {
    assert.deepEqual(lotMatchNotes(spec, 'en'), lotMatchNotes(spec))
    const out = lotMatchNotes(spec, 'es')
    assert.equal(out.length, lotMatchNotes(spec).length)
    for (const line of out) assert.doesNotMatch(line, /\b(the|match|county lists|Check|deed)\b|undefined/, line)
  }
  // what is wrong with a lot as typed
  const lot = buildLot({ kind: 'manual', width: 30, depth: 40, city: 'mcallen', setbacks: {} })
  for (const [spec, l] of [[{ kind: 'manual', width: 10, depth: 100 }, null], [{ kind: 'manual', width: 100, depth: 5 }, null], [{ kind: 'manual', width: 30, depth: 40 }, lot], [{ kind: 'parcel', calls: [] }, null]]) {
    assert.equal(lotProblem(spec, l, 'en'), lotProblem(spec, l))
    const s = lotProblem(spec, l, 'es')
    if (lotProblem(spec, l)) {
      assert.ok(s && s !== lotProblem(spec, l), JSON.stringify(spec))
      assert.doesNotMatch(s, /setback|\b(the|lot|width|depth|feet)\b|undefined|NaN/, s)
    } else assert.equal(s, null)
  }
})

// ── 5. the screens as code ──────────────────────────────────────────────────────────────────────────

// English that stays in a homeowner file on purpose. Each entry: the file, the text (exact, or a pattern), and why.
const OFFICE = 'the office screens are English only (out of scope)'
const ALLOWED = [
  // the office gate, the office links in the header and the loading lines of the office pages
  ['src/draft/DraftApp.jsx', 'Loading…', OFFICE],
  ['src/draft/DraftApp.jsx', 'Office sign-in', OFFICE],
  ['src/draft/DraftApp.jsx', 'Drafters and admins only.', OFFICE],
  ['src/draft/DraftApp.jsx', 'Planning your own house? Start here', OFFICE],
  ['src/draft/DraftApp.jsx', 'Review', OFFICE],
  ['src/draft/DraftApp.jsx', 'Office', OFFICE],
  ['src/draft/DraftApp.jsx', 'Legacy demo', OFFICE],
  ['src/draft/DraftApp.jsx', 'The original Lot 514 event-venue site plan (pool, dance floor). A legacy demo, not a client project.', OFFICE],
  ['src/draft/DraftApp.jsx', 'Loading the office…', OFFICE],
  ['src/draft/DraftApp.jsx', 'Loading the review…', OFFICE],
  // the name of the product
  ['src/draft/DraftApp.jsx', 'Draft House', 'the product name'],
  ['src/draft/screens/Start.jsx', 'Draft', 'the product name, as the wordmark'],
  ['src/draft/screens/Start.jsx', 'House', 'the product name, as the wordmark'],
  ['src/draft/TrustBlock.jsx', 'STB', 'the builder\'s initials'],
  // data, not words
  ['src/draft/DraftApp.jsx', 'Rooms changed', 'the note saved with a version at the office (data, English); the history shows it through the plan\'s sentences'],
  ['src/draft/screens/SignIn.jsx', 'Sign in', 'the default title; every homeowner caller passes its own through t(...), the office gate passes "Office sign-in"'],
  ['src/draft/screens/Lot.jsx', /^\$\{\} R \$\{\}' \$\{\}$|^L \$\{\}'$/, 'a curve as the plat writes it: R 50\' L 31.4\''],
  ['src/draft/screens/Program.jsx', /^(no Worker|worker failed|no worker)$/, 'reasons the fit check falls back to the page; caught, never shown'],
  ['src/draft/screens/Draft.jsx', 'v', 'the "v" of "v3" in the history'],
  ['src/draft/screens/Send.jsx', /^floor plan (11x17|24x36)$/, 'the PDF\'s file name'],
  ['src/draft/HouseScene.jsx', 'N', 'north, the same letter in Spanish'],
  // the drafter's view of the rules panel (mode="drafter", on the office's Review screen)
  ['src/draft/RulesPanel.jsx', /^Every line below says where it came from and when it was checked\./, OFFICE],
  ['src/draft/RulesPanel.jsx', 'Parcel', OFFICE],
  ['src/draft/RulesPanel.jsx', /^· (geo id|fetched|matched by) \$\{\}$/, OFFICE],
  ['src/draft/RulesPanel.jsx', '. Advisory: the recorded plat or a survey wins.', OFFICE],
  ['src/draft/RulesPanel.jsx', 'Look up the owner of record', OFFICE],
  ['src/draft/RulesPanel.jsx', /^Owner of record: \$\{\}\$\{\}\.$/, OFFICE],
  ['src/draft/RulesPanel.jsx', 'not given', OFFICE],
]
const allowed = (v) => ALLOWED.some(([file, text]) => file === v.file && (text instanceof RegExp ? text.test(v.text) : text === v.text))

// t(something) where the sentence comes from data. Each is checked against the dictionary in test 6.
const FROM_DATA = {
  'src/draft/DraftApp.jsx': ['s', 'STEPS[step - 1]'],
  'src/draft/screens/Start.jsx': ['p.style?.name', 'STATUS[p.status]?.label'],
  'src/draft/screens/Style.jsx': ['s.name', 's.blurb', 'ready[0].name'],
  'src/draft/screens/Program.jsx': ['style.name', 'ref.name', 'label'],
  'src/draft/screens/Draft.jsx': ['style.name', 'ASK_LABEL[m.askOffice]', 'ASK_LABEL.meeting', 'TOPIC_NAMES[k]'],
  'src/draft/screens/Send.jsx': ['TRUST.costLine', 'label', 's.title', 'style.name', 'kit.exterior.siding', 'w.type', 'd.material', 's.contents'],
  'src/draft/RulesPanel.jsx': ['title', 'homeLabel(u.id, u.label)', 'statusWords(u)'],
  'src/draft/TrustBlock.jsx': ['d.placeholderName', 'TRUST.team', 'd.title', 'CHECKED', 'n.when', 'n.what', 'TRUST.builtHomes.label'],
}

const scan = scanAll()

test('5: the homeowner screens hold no English outside t(...): bare JSX text, title / placeholder / aria-label, or a sentence in a string', () => {
  assert.equal(HOMEOWNER_FILES.length, 13)
  for (const f of HOMEOWNER_FILES) assert.ok(fs.existsSync(f), f)
  const found = scan.violations.filter((v) => !allowed(v)).map((v) => `${v.file}:${v.line}  ${v.kind}  ${JSON.stringify(v.text.slice(0, 90))}`)
  assert.deepEqual(found, [], `${found.length} English strings a homeowner would read are not handed to t(...):\n  ${found.join('\n  ')}`)
  // the allow-list is short and every entry is still needed
  const unused = ALLOWED.filter(([file, text]) => !scan.violations.some((v) => v.file === file && (text instanceof RegExp ? text.test(v.text) : text === v.text))).map(([f, x]) => `${f}: ${x}`)
  assert.deepEqual(unused, [], 'allow-list entries nothing uses any more')
  assert.ok(ALLOWED.length <= 30, `${ALLOWED.length} allowed strings`)
})

test('5: every sentence a screen hands to t(...) is in the Spanish dictionary', () => {
  assert.ok(scan.keys.length > 450, `${scan.keys.length} sentences found in the screens`)
  const missing = scan.keys.filter((k) => !has(k.key)).map((k) => `${k.file}:${k.line}  ${JSON.stringify(k.key)}`)
  assert.deepEqual(missing, [], `${missing.length} sentences have no Spanish:\n  ${missing.join('\n  ')}`)
  // a t(variable) nobody listed is a sentence nobody checked
  const stray = scan.dynamic.filter((d) => !(FROM_DATA[d.file] || []).includes(d.code)).map((d) => `${d.file}:${d.line}  t(${d.code})`)
  assert.deepEqual(stray, [], `t(...) is handed something the test does not know:\n  ${stray.join('\n  ')}`)
  // the screens the round names all take their words from the hook
  for (const f of HOMEOWNER_FILES) assert.match(fs.readFileSync(f, 'utf8'), /useLang\(\)|wordsFor\(/, `${f} reads the language`)
})

test('5: the scan catches what it is there to catch', async () => {
  const { scanFile } = await import('./i18n-scan.mjs')
  const os = await import('node:os')
  const path = await import('node:path')
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dh-scan-')), 'Probe.jsx')
  fs.writeFileSync(
    f,
    `export default function Probe({ ok, t }) {
  const note = ok ? 'Something went wrong here' : ''
  return (
    <div title="Hover words" data-testid="probe" className="two words">
      <h2>Bare heading</h2>
      <input placeholder="Type here" aria-label={ok ? 'Said aloud' : t('Handed over')} />
      <p>{ok ? 'Inline English' : t('Fine')}</p>
      <p>{t('Also fine')} {note}</p>
    </div>
  )
}
`,
  )
  const r = scanFile(f)
  assert.deepEqual(r.violations.map((v) => v.text).sort(), ['Bare heading', 'Hover words', 'Inline English', 'Said aloud', 'Something went wrong here', 'Type here'])
  assert.deepEqual(r.violations.find((v) => v.text === 'Bare heading').line, 5)
  assert.deepEqual(r.keys.map((k) => k.key).sort(), ['Also fine', 'Fine', 'Handed over'])
})

// ── 6. the words that come from data ────────────────────────────────────────────────────────────────

test('6: the steps, styles, statuses, trust block, kit sheets and schedules all have their Spanish', () => {
  const need = []
  const want = (text, where) => (typeof text === 'string' && text && !has(text) ? need.push(`${where}: ${JSON.stringify(text)}`) : null)
  for (const s of STYLES) (want(s.name, 'style'), want(s.blurb, 'style blurb'))
  for (const s of Object.values(STATUS)) want(s.label, 'status')
  for (const k of Object.values(TOPIC_NAMES)) want(k, 'topic')
  want(TRUST.team, 'trust'), want(TRUST.drafter.title, 'trust'), want(TRUST.drafter.placeholderName, 'trust'), want(TRUST.builtHomes.label, 'trust'), want(TRUST.costLine, 'trust'), want(CHECKED, 'trust')
  for (const n of TRUST.next) (want(n.when, 'trust next'), want(n.what, 'trust next'))
  // the English trust line is the sentence it was, with the audit's own count
  assert.equal(translate('en', CHECKED, { count: 12 }).replace('12', '{count}'), CHECKED)
  assert.equal(TRUST.checked, translate('en', CHECKED, { count: TRUST.checked.match(/against (\d+) IRC/)[1] }))
  for (const s of KIT.sheets) (want(s.title, 'sheet'), want(s.contents, 'sheet contents'))
  want(KIT.exterior.siding, 'siding'), want(KIT.reference.name, 'reference')
  for (const w of Object.values(KIT.windows || {})) want(w.type, 'window type')
  const doorMaterials = new Set()
  JSON.stringify(KIT.doors || {}, (k, v) => (k === 'material' && typeof v === 'string' ? (doorMaterials.add(v), v) : v))
  for (const m of doorMaterials) want(m, 'door material')
  assert.deepEqual(need, [], `no Spanish for:\n  ${need.join('\n  ')}`)
  // the cost line is the only thing the app says about cost, in either language: no number, no sign
  assert.doesNotMatch(es[TRUST.costLine], /\d|\$/)
})

test('6: the rules panel in Spanish: every label, every "how sure", every value, for every city and county we have', () => {
  const PLAIN = ['front', 'side', 'rear', 'streetSide', 'garageFt', 'maxCoverage', 'maxHeightFt', 'minLotSf', 'district', 'irc', 'windstorm', 'wind']
  const need = new Set()
  const english = new Set()
  const lots = [30, 45, 80].flatMap((width) => [...JURISDICTION_IDS.map((id) => ({ kind: 'manual', width, depth: 140, city: id, setbacks: {} })), ...COUNTIES.map((county) => ({ kind: 'manual', width, depth: 140, county, setbacks: {} }))])
  let rows = 0
  for (const spec of lots) {
    const lot = buildLot(spec)
    for (const u of (lot.rulesUsed || []).filter((r) => PLAIN.includes(r.id))) {
      rows++
      const label = homeLabel(u.id, u.label)
      if (!has(label)) need.add(`label ${JSON.stringify(label)}`)
      if (!has(statusWords(u))) need.add(`status ${JSON.stringify(statusWords(u))}`)
      if (typeof u.value === 'string') {
        const v = ruleValue(plainReason(u.value), 'es')
        assert.equal(ruleValue(plainReason(u.value), 'en'), plainReason(u.value))
        if (/\b(ft|sf|yes|unknown|confirm|county default|set by|feet|corner|on a|exempt|adopted|required)\b/.test(v)) english.add(`${u.id}: ${JSON.stringify(u.value)} → ${JSON.stringify(v)}`)
        assert.doesNotMatch(v, /setback|\$/, v)
      }
    }
    // the notes and the flags under the table
    for (const line of [...(lot.ruleNotes || []), ...(lot.flags || [])].map((x) => plainReason(x))) {
      assert.equal(ruleNote(line, 'en'), line)
      const v = ruleNote(line, 'es')
      if (/\b(ft|sf|unknown|confirm|lot of record|county default|at least|at most|below|the)\b/.test(v)) english.add(`note: ${JSON.stringify(line)} → ${JSON.stringify(v)}`)
      assert.doesNotMatch(v, /setback|\$/, v)
    }
    assert.equal(placeName(lot.jurisdiction?.name, 'en'), lot.jurisdiction?.name)
  }
  assert.ok(rows > 100, `${rows} rule rows read`)
  assert.deepEqual([...need], [], 'no Spanish for')
  assert.deepEqual([...english], [], 'a rule value still in English')
  assert.equal(ruleValue('20 ft', 'es'), '20 pies')
  assert.equal(ruleValue('9,000 sf', 'es'), '9,000 pies²')
  assert.equal(placeName('Hidalgo County', 'es'), 'Condado de Hidalgo')
  assert.equal(placeName('Hidalgo County (unincorporated)', 'es'), 'Condado de Hidalgo (fuera de los límites de la ciudad)')
  assert.equal(placeName('McAllen', 'es'), 'McAllen')
})

test('6: every room the kit draws has a Spanish name; the line under the picture reads in Spanish', () => {
  const programs = [
    DEFAULT_PROGRAM,
    { ...DEFAULT_PROGRAM, beds: 5, baths: 4, halfBath: true, office: true, suite2: true, garage: 3, sqft: 3400 },
    { ...DEFAULT_PROGRAM, beds: 2, baths: 1, halfBath: false, office: false, suite2: false, garage: 0, sqft: 1400, rearPorch: false },
    { ...DEFAULT_PROGRAM, beds: 3, baths: 2, garage: 1, sqft: 1800 },
    { ...KIT.reference.program },
  ]
  const namesSeen = new Set()
  for (const p of programs) for (const r of generateRooms(p, farmhouse).filter(isRoom)) namesSeen.add(r.name)
  assert.ok(namesSeen.size >= 15, `${namesSeen.size} room names`)
  const still = [...namesSeen].filter((n) => roomName(n, 'es') === n)
  assert.deepEqual(still, [], 'rooms with no Spanish name')
  for (const n of namesSeen) assert.equal(roomName(n, 'en'), n)
  assert.equal(roomName('Bedroom 2', 'es'), 'Recámara 2')
  assert.equal(roomName('2-Car Garage', 'es'), 'Cochera para 2 carros')
  assert.equal(roomName('3-Car Garage (tandem)', 'es'), 'Cochera para 3 carros (en fila)')
  const p = { beds: 4, baths: 3, halfBath: true, garage: 2, stories: 1 }
  assert.equal(programLine(p), '4 bed · 3.5 bath · 2-car · 1 story', 'the English line is untouched')
  assert.equal(programLineEs(p), '4 recámaras · 3.5 baños · cochera para 2 carros · 1 piso')
  assert.equal(programLineEs({ beds: 1, baths: 1, garage: 0, stories: 2 }), '1 recámara · 1 baño · 2 pisos')
  assert.equal(groundWords('SCALE IN FEET', 'es'), 'ESCALA EN PIES')
  assert.equal(groundWords("LOT 513 — NEIGHBOR (6' SIDE SETBACK)", 'es'), "LOTE 513 — VECINO (6' LIBRES AL LADO)")
  assert.equal(groundWords('±10,405 SF · 0.24 AC', 'es'), '±10,405 PIES² · 0.24 AC')
  assert.equal(groundWords("25' — REAR", 'es'), "25' — FONDO")
  assert.equal(groundWords("25' — REAR", 'en'), "25' — REAR")
})

test('6: the options the chat offers read in Spanish, and the suggestion chips are Spanish sentences that are sent as they are shown', () => {
  const rooms = generateRooms(DEFAULT_PROGRAM, farmhouse)
  const lot = buildLot({ kind: 'manual', width: 100, depth: 150, city: 'mcallen', frontStreet: 'E Nolana Ave', setbacks: {} })
  const still = []
  for (const topic of OPTION_TOPICS) {
    for (const o of optionsFor(topic, rooms, DEFAULT_PROGRAM, farmhouse, lot).options) {
      assert.equal(optionLabel(o.label, 'en'), o.label)
      if (optionLabel(o.label, 'es') === o.label) still.push(`${topic}: ${o.label}`)
    }
  }
  assert.deepEqual(still, [], 'an option label with no Spanish')
  // the chips: one Spanish sentence each, shown and sent; the screen does not keep an English copy to send
  const chips = ['Make the kitchen bigger', 'Add a porch on the back', 'Remove the rear porch', 'Make the garage {n} cars', 'Add a 2-car garage', 'Add a bedroom', 'Add an office', 'Bigger primary bath', 'Add a half bath', 'Show me garage options']
  for (const c of chips) assert.ok(has(c) && es[c] !== c, c)
  const draft = fs.readFileSync('src/draft/screens/Draft.jsx', 'utf8')
  for (const c of chips) assert.ok(draft.includes(`t('${c}'`), `the chip "${c}" is written through t(...)`)
  assert.match(draft, /suggestions\.map\(\(s\) => \(\s*<button key=\{s\} onClick=\{\(\) => send\(s\)\}/, 'the chip sends the words it shows')
  assert.equal(translate('es', 'Make the garage {n} cars', { n: 3 }), 'Haz la cochera para 3 carros')
})

test('6: the Draft step tells the office which language the homeowner reads', () => {
  const api = fs.readFileSync('src/draft/lib/api.js', 'utf8')
  assert.match(api, /change: \(id, text, ops, lang\) =>.*\.\.\.\(lang \? \{ lang \} : \{\}\)/)
  assert.match(fs.readFileSync('src/draft/screens/Draft.jsx', 'utf8'), /api\.change\(project\.id, q, fix\?\.ops, lang\)/)
  // the office reads it on both chat routes (an account's plan, and the no-account interpreter)
  const server = fs.readFileSync('server/index.mjs', 'utf8')
  assert.match(server, /readJson\(req, \{ text: 'string', ops: 'array\?', lang: 'string\?' \}\)/)
  assert.match(server, /client: 'string\?', lang: 'string\?' \}\)/)
  assert.match(server, /const BAD_KEYS = new Set\(\['__proto__', 'constructor', 'prototype'\]\)/)
})
