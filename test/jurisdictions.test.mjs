// Round 7, items 2, 5, 6 and 10: the sourced jurisdiction table. Every row says where each number came from and
// how sure we are; rules that depend on the lot (Pharr's rear as a share of the depth, Weslaco's lesser-of,
// Hidalgo County's half right of way, McAllen's narrow lots of record) resolve against the lot's own width and
// depth; unknown fields fall back to the county default and are flagged; a date over 180 days old asks for a
// re-check; the wind speed is never a number nobody entered; the geocode note covers the four cases.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JURISDICTIONS, JURISDICTION_IDS, RULE_FIELDS, ALL_FIELDS, resolveRule, resolveRules, staleness, jurisdictionTable, jurisdictionFor, geoMessage, WIND_UNSET, WINDSTORM_COUNTIES, COUNTIES, countyRowId } from '../src/draft/lib/jurisdictions.js'
import { cityTable, rulesFor, CITY_IDS, guessCity } from '../src/draft/lib/cities.js'
import { buildLot } from '../src/draft/lib/lot.js'
import { makeZoning, normalizeDistrict, classify, NO_LAYER, WESLACO_CONVERSION } from '../server/zoning.mjs'
import { makeWind } from '../server/wind.mjs'
import { makeLots } from '../server/lots.mjs'
import { fixtureFetch, loadFixtures } from '../server/fixtures.mjs'

const FIX = loadFixtures()
const memStore = () => {
  const m = new Map()
  return { meta: { get: async (k) => (m.has(k) ? m.get(k) : null), set: async (k, v) => m.set(k, v) } }
}

test('every row: 14 cities and 8 county rows, each field an object with value, source, status and date; nothing is a bare number', () => {
  assert.equal(JURISDICTION_IDS.length, 22)
  assert.equal(JURISDICTION_IDS.filter((id) => JURISDICTIONS[id].kind === 'city').length, 14)
  assert.equal(JURISDICTION_IDS.filter((id) => JURISDICTIONS[id].kind === 'county').length, 8, 'Hidalgo County plus the seven others')
  for (const id of JURISDICTION_IDS) {
    const row = JURISDICTIONS[id]
    assert.ok(COUNTIES.includes(row.county), `${id} is in one of the eight counties`)
    for (const k of ALL_FIELDS) {
      const f = row[k]
      if (f === undefined) continue
      assert.ok(typeof f === 'object' && 'value' in f && 'status' in f, `${id}.${k} is a sourced field`)
      assert.ok(['verified', 'summary', 'unknown'].includes(f.status), `${id}.${k} status`)
      if (f.status !== 'unknown') assert.ok(f.source, `${id}.${k} has a source`)
      if (f.status === 'verified') assert.ok(f.checkedAt, `${id}.${k} verified fields carry a date`)
      if (k === 'wind') assert.ok(!f.value || f.value.mph === undefined || f.status !== 'unknown', `${id}: a wind number is never guessed`)
    }
    assert.ok(!row.irc || row.irc.value || row.irc.status === 'unknown', `${id}: the IRC edition is named or marked unknown`)
  }
  // McAllen R-1 is read from the code: 20 / 5 / 10 / 10, and says so
  const mc = JURISDICTIONS.mcallen
  assert.deepEqual([mc.front.value, mc.side.value, mc.rear.value, mc.streetSide.value], [20, 5, 10, 10])
  assert.equal(mc.front.status, 'verified')
  assert.match(mc.front.source, /mcallen/i)
  // the coastal counties are windstorm counties; Hidalgo is not
  assert.equal(JURISDICTIONS.brownsville.windstorm.value, true)
  assert.equal(JURISDICTIONS.mcallen.windstorm.value, false)
  assert.ok(WINDSTORM_COUNTIES.includes('Cameron County') && !WINDSTORM_COUNTIES.includes('Hidalgo County'))
  // the wind speed is a drafter lookup, never a number from a range
  for (const id of JURISDICTION_IDS) assert.equal(resolveRules(JURISDICTIONS[id], {}, { width: 100, depth: 150 }).windText, WIND_UNSET, `${id} wind unset until a drafter enters it`)
})

test('rules that depend on the lot resolve on its own width and depth, and say how', () => {
  // Pharr: rear 10% of the depth, at least 9, at most 15
  assert.equal(resolveRule(JURISDICTIONS.pharr.rear, 'rear', { depth: 131 }).value, 13.1)
  assert.equal(resolveRule(JURISDICTIONS.pharr.rear, 'rear', { depth: 80 }).value, 9)
  assert.equal(resolveRule(JURISDICTIONS.pharr.rear, 'rear', { depth: 200 }).value, 15)
  assert.match(resolveRule(JURISDICTIONS.pharr.rear, 'rear', { depth: 131 }).text, /13\.1 ft = 10% of 131 ft depth/)
  // no depth yet: the minimum, flagged
  assert.equal(resolveRule(JURISDICTIONS.pharr.rear, 'rear', {}).flag, 'needs-dims')
  // Weslaco: the lesser of 25 ft and 20% of the depth
  assert.equal(resolveRule(JURISDICTIONS.weslaco.rear, 'rear', { depth: 100 }).value, 20)
  assert.equal(resolveRule(JURISDICTIONS.weslaco.rear, 'rear', { depth: 150 }).value, 25)
  // Hidalgo County: front is half the right of way, 50 ft assumed when unknown, at most 50
  const h = resolveRule(JURISDICTIONS.hidalgo.front, 'front', {})
  assert.equal(h.value, 25)
  assert.equal(h.flag, 'row-assumed')
  assert.equal(resolveRule(JURISDICTIONS.hidalgo.front, 'front', { rowFt: 80 }).value, 40)
  assert.equal(resolveRule(JURISDICTIONS.hidalgo.front, 'front', { rowFt: 120 }).value, 50)
  // McAllen's narrow lot of record: side yards 10% of the width, never under 3.5 ft, flagged
  const narrow = resolveRules(JURISDICTIONS.mcallen, {}, { width: 40, depth: 120 })
  assert.equal(narrow.side, 4)
  assert.ok(narrow.flags.includes('narrow lot of record'))
  assert.equal(resolveRules(JURISDICTIONS.mcallen, {}, { width: 30, depth: 120 }).side, 3.5)
  assert.equal(resolveRules(JURISDICTIONS.mcallen, {}, { width: 60, depth: 120 }).side, 5, 'a normal lot keeps the 5 ft side')
  // the same numbers through buildLot: Pharr 60 x 131 gets rear 13.1 and the derived line
  const ph = buildLot({ kind: 'manual', width: 60, depth: 131, city: 'pharr', setbacks: {} })
  assert.equal(ph.rules.rear, 13.1)
  assert.ok(ph.ruleNotes.some((n) => /rear 13\.1 ft = 10% of 131 ft depth/.test(n)))
  assert.equal(ph.dims.depth, 131)
  // a plat's printed setback wins over the table and says so
  const o = resolveRules(JURISDICTIONS.pharr, { rear: 12 }, { depth: 131 })
  assert.equal(o.rear, 12)
  assert.ok(o.derived.some((d) => /rear 12 ft: printed on the plat/.test(d)))
})

test('unknown fields fall back to the county default and are flagged on the lot; a 180-day-old date asks for a re-check', () => {
  const sj = resolveRules(JURISDICTIONS.sanjuan, {}, { width: 60, depth: 120 })
  assert.ok(sj.unknown.length > 0, 'San Juan has fields nobody read yet')
  assert.ok(sj.flags.some((f) => /unknown, confirm with city/.test(f)))
  const u = sj.used.find((x) => x.status === 'unknown')
  assert.match(u.value, /county default; unknown, confirm with city/)
  // staleness
  assert.equal(staleness({ checkedAt: '2026-11-18', status: 'verified' }, Date.parse('2026-12-01')), 'ok')
  assert.equal(staleness({ checkedAt: '2026-01-01', status: 'verified' }, Date.parse('2026-12-01')), 're-check due')
  assert.equal(staleness({ status: 'unknown' }), 'unknown')
  const old = resolveRules(JURISDICTIONS.mcallen, {}, { width: 100, depth: 150 }, Date.parse('2027-09-01'))
  assert.ok(old.recheck.includes('front'), 'McAllen front read 2026-11-18 is due for a re-check by 2027-09')
  assert.ok(old.flags.some((f) => /front: re-check due/.test(f)))
  const lot = buildLot({ kind: 'manual', width: 60, depth: 120, city: 'sanjuan', setbacks: {} })
  assert.ok(lot.flags.some((f) => /unknown, confirm with city/.test(f)))
  assert.ok(lot.rulesUsed.length >= 19)
  // the Edinburg and Weslaco rows carry their code-change flags
  assert.ok(JURISDICTIONS.edinburg.flags.some((f) => /pending/.test(f)))
  assert.ok(JURISDICTIONS.weslaco.flags.some((f) => /just changed/.test(f)))
})

test("the office's edits apply as sourced fields; the flat table (cities.js) still reads as before", () => {
  const t = jurisdictionTable({ sanjuan: { front: { value: 25, source: 'San Juan UDC 4.2', status: 'verified', checkedAt: '2026-11-18' }, flags: ['read 2026-11-18'] }, mcallen: { rear: 12 } })
  assert.equal(t.sanjuan.front.value, 25)
  assert.equal(t.sanjuan.front.status, 'verified')
  assert.deepEqual(t.sanjuan.flags, ['read 2026-11-18'])
  assert.equal(t.mcallen.rear.value, 12)
  assert.equal(t.mcallen.rear.status, 'verified', 'a bare number keeps the seed status')
  const flat = cityTable({ sanjuan: { front: 25 } })
  assert.equal(flat.sanjuan.front, 25)
  assert.equal(flat.mcallen.front, 20)
  assert.equal(rulesFor('pharr', {}, cityTable(), { width: 60, depth: 131 }).rear, 13.1)
  assert.equal(rulesFor('nowhere', { county: 'Cameron County' }).name, 'Cameron County (unincorporated)')
  assert.equal(countyRowId('Hidalgo County'), 'hidalgo')
  assert.equal(countyRowId('Nueces County'), 'nueces-county')
  assert.equal(guessCity('123 Main St, Harlingen TX'), 'harlingen')
  assert.equal(CITY_IDS.length, JURISDICTION_IDS.length)
})

test('item 2: the lot step says one of four things about a geocoded address, from the table', () => {
  assert.deepEqual(jurisdictionFor({ place: 'McAllen', county: 'Hidalgo County' }), { type: 'city', id: 'mcallen', name: 'McAllen, TX', county: 'Hidalgo County', etj: null, source: 'Census Incorporated Places' })
  assert.equal(jurisdictionFor({ place: 'Los Fresnos', county: 'Cameron County' }).id, 'cameron-county')
  assert.equal(jurisdictionFor({ place: null, county: 'Hidalgo County' }).id, 'hidalgo')
  assert.equal(jurisdictionFor({ place: 'Austin', county: 'Travis County' }), null)
  assert.match(geoMessage({ found: true, place: 'McAllen', county: 'Hidalgo County' }), /^We have the McAllen, TX rules, from the city code\.$/)
  assert.match(geoMessage({ found: true, place: 'Corpus Christi', county: 'Nueces County' }), /Corpus Christi, TX rules; 2 of them are summaries the office confirms \(streetSide, garageFt\)/)
  assert.match(geoMessage({ found: true, place: 'Brownsville', county: 'Cameron County' }), /one of them is a summary/)
  assert.match(geoMessage({ found: true, place: 'Los Fresnos', county: 'Cameron County' }), /Los Fresnos is in Cameron County; we have no rules for that city yet, so the county row is used, unverified/)
  assert.match(geoMessage({ found: true, place: null, county: 'Hidalgo County' }), /Unincorporated Hidalgo County: the county subdivision rules are used, and a drafter checks them/)
  assert.match(geoMessage({ found: true, place: 'Austin', state: 'TX', county: 'Travis County' }), /Austin, TX is outside the eight counties we build in \(Hidalgo, Cameron, Starr, Willacy, Jim Wells, Nueces, Kleberg, San Patricio\)/)
  assert.match(geoMessage({ found: false }), /not found/)
})

test('item 5: zoning districts normalise to the codes the table knows; Weslaco old codes convert; non-residential says so; three cities have no layer', async () => {
  assert.equal(normalizeDistrict('mcallen', 'r1'), 'R-1')
  assert.equal(normalizeDistrict('mcallen', 'R-1 '), 'R-1')
  assert.equal(normalizeDistrict('mcallen', 'R1/CC'), 'R-1')
  assert.equal(normalizeDistrict('corpuschristi', 'rs6'), 'RS-6')
  assert.equal(normalizeDistrict('corpuschristi', 'RS-4.5'), 'RS-4.5')
  assert.equal(normalizeDistrict('weslaco', 'R-4'), 'R-1-N')
  assert.equal(normalizeDistrict('weslaco', 'R-3'), WESLACO_CONVERSION['R-3'])
  assert.equal(normalizeDistrict('mcallen', ''), null)
  assert.deepEqual(classify('mcallen', 'R-1'), { residential: true, use: 'single-family' })
  assert.deepEqual(classify('mcallen', 'C-3'), { residential: false, use: 'commercial' })
  assert.equal(classify('edinburg', 'I-1').use, 'industrial')
  assert.equal(classify('mcallen', 'R-3A').residential, true)
  assert.deepEqual(NO_LAYER, ['mission', 'sanbenito', 'riograndecity'])
  const z = makeZoning({ store: memStore(), fetchImpl: fixtureFetch(FIX) })
  const k = FIX.find((f) => f.slug === 'kerria-1201-mcallen')
  const r = await z.lookup({ cityId: 'mcallen', lat: k.point.lat, lon: k.point.lon })
  assert.equal(r.status, 'found')
  assert.equal(r.district, 'R-1')
  assert.equal(r.residential, true)
  assert.equal(r.message, null)
  const c = FIX.find((f) => f.slug === 'n-10th-1300-mcallen')
  const bad = await z.lookup({ cityId: 'mcallen', lat: c.point.lat, lon: c.point.lon })
  assert.equal(bad.district, 'C-3')
  assert.equal(bad.residential, false)
  assert.equal(bad.message, 'This lot is zoned C-3 (commercial). A house may need a rezoning; the office will call you.')
  const none = await z.lookup({ cityId: 'mission', lat: 26.2, lon: -98.3 })
  assert.equal(none.status, 'unknown')
  assert.match(none.reason, /no zoning layer/)
  // Harlingen: the newest COH_Zoning_Map_* service is picked from the list
  const hl = await z.lookup({ cityId: 'harlingen', lat: 26.19, lon: -97.69 })
  assert.match(hl.layer, /COH_Zoning_Map_2026\/FeatureServer\/0$/)
  assert.equal(hl.status, 'none')
})

test('item 6: the wind speed is the row the drafter filled, else "set by the engineer of record"; the ASCE API runs only with a key, counts calls, never logs it', async () => {
  const store = memStore()
  const off = makeWind({ store, env: {}, fetchImpl: async () => { throw new Error('must not be called') } })
  assert.deepEqual(await off.lookup({ lat: 26.2, lon: -98.2 }), { mph: null, text: WIND_UNSET, source: null, status: 'unset' })
  assert.equal(off.enabled, false)
  const fromRow = await off.lookup({ lat: 26.2, lon: -98.2, row: { wind: { value: { mph: 115, standard: '7-22', riskCategory: 'II' }, source: 'ASCE Hazard Tool, read by Leroy 2026-11-18', status: 'verified', checkedAt: '2026-11-18' } } })
  assert.equal(fromRow.mph, 115)
  assert.equal(fromRow.text, '115 mph (ASCE 7-22, risk category II)')
  const logs = []
  let calls = 0
  const on = makeWind({ store, env: { ASCE_HAZARD_API_KEY: 'asce-TESTONLY-key' }, log: (m) => logs.push(m), fetchImpl: async (url) => { calls++; assert.ok(String(url).includes('token=asce-TESTONLY-key')); return new Response(JSON.stringify({ data: { wind: { speed: 142.4 } } }), { status: 200 }) } })
  const w = await on.lookup({ lat: 25.9, lon: -97.5 })
  assert.equal(w.mph, 142)
  assert.equal(w.status, 'verified')
  const again = await on.lookup({ lat: 25.9, lon: -97.5 })
  assert.equal(again.mph, 142)
  assert.equal(calls, 1, 'cached per point')
  assert.equal(await store.meta.get(`asce:usage:${new Date().toISOString().slice(0, 7)}`), 1)
  assert.ok(!logs.join('\n').includes('TESTONLY'))
  assert.ok(!JSON.stringify(w).includes('TESTONLY'))
})

test('item 4: the flood zone is read at a point, first whether a digital FIRM exists; no FIRM is never "outside the flood area"', async () => {
  const lots = makeLots({ store: memStore(), fetchImpl: fixtureFetch(FIX), files: {}, interpreter: {}, event: async () => {} })
  const by = (slug) => FIX.find((f) => f.slug === slug).point
  const ranch = await lots.floodAt(by('ranch-rd-rio-grande-city'))
  assert.equal(ranch.status, 'no-digital-firm')
  assert.equal(ranch.sfha, null)
  assert.equal(ranch.zone, null)
  assert.match(ranch.note, /no digital flood map/)
  assert.doesNotMatch(ranch.note, /outside/)
  const k = await lots.floodAt(by('kerria-1201-mcallen'))
  assert.equal(k.status, 'x')
  assert.equal(k.sfha, false)
  assert.equal(k.zone, 'X')
  assert.equal(k.lomr, null)
  const m = await lots.floodAt(by('melissa-36-brownsville'))
  assert.equal(m.status, 'sfha')
  assert.equal(m.zone, 'AE')
  assert.equal(m.bfe, 20)
  assert.equal(m.lomr.length, 1)
  assert.equal(m.lomr[0].caseNo, '24-06-1234P')
  assert.match(m.note, /Letter of Map Revision/)
  const c = await lots.floodAt(by('curtis-clark-5435-corpus-christi'))
  assert.equal(c.status, 'shaded-x')
  assert.equal(c.sfha, false)
  assert.ok(c.prelim.length >= 1)
  assert.match(c.note, /preliminary map change/)
  assert.match(c.source, /parcel interior point/)
  await assert.rejects(lots.floodAt({ lat: 'x', lon: null }), /lat and lon required/)
  // by address: the street point, and the note says it is the street point
  const s = await lots.flood('1201 Kerria Ave, McAllen, TX 78501')
  assert.equal(s.zone, 'X')
  assert.match(s.where, /street point/)
  const nf = await lots.flood('999 Nowhere Ln, Austin, TX')
  assert.equal(nf.status, 'no-address')
})
