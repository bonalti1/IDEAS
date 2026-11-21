// Fix round 15, U6: a one-letter slip in the street name ("2002 Kiskade Ln Mission", "1201 Keria Ave") finds the
// right parcel as a near match: said as one to the homeowner, stamped "near" by the server, marked "Near match" in
// the drafter's queue. Format slips keep working; a street two letters off or another number is not guessed.
// The office API answers from the recordings; nothing reaches the internet.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnGroup, freePort } from './browser.mjs'
import { buildLot } from '../src/draft/lib/lot.js'
import { parcelSpec } from '../src/draft/lib/parcel-spec.js'
import { oneEditApart, countyFromText } from '../server/parcels.mjs'
import { fixtureEnv } from './server-env.mjs'

async function startApi(t) {
  const port = await freePort()
  const base = `http://127.0.0.1:${port}`
  spawnGroup(t, process.execPath, ['server/index.mjs'], { env: { ...fixtureEnv, DRAFTHOUSE_CLAUDE_KEY: '', ANTHROPIC_API_KEY: '', DATABASE_URL: '', SUPABASE_URL: '', RESEND_API_KEY: '', DRAFTHOUSE_APP_KEY: '', DRAFTHOUSE_WORKER_KEY: 'wk', DRAFTHOUSE_DRAFTERS: 'maria@drafthouse.test', REGRID_API_TOKEN: '', PARCEL_DAILY_CHECK: '0', PARCEL_FIELD_CHECK: '0', PLAT_PRUNE: '0', PORT: String(port), DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dh-r15-addr-')), ALLOWED_ORIGINS: '*' } })
  for (let i = 0; i < 150; i++) {
    try {
      await fetch(`${base}/api/health`)
      return base
    } catch {
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  throw new Error('the office API did not start')
}
async function who(base, email) {
  const { token } = await (await fetch(base + '/api/auth/dev-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, name: email.split('@')[0] }) })).json()
  const h = { 'content-type': 'application/json', authorization: `Bearer ${token}` }
  return { get: (p) => fetch(base + p, { headers: h }), post: (p, b = {}) => fetch(base + p, { method: 'POST', headers: h, body: JSON.stringify(b) }) }
}
const enc = encodeURIComponent

test('U6 (unit): one slip apart, and the county from the city typed', () => {
  assert.equal(oneEditApart('KISKADE', 'KISKADEE'), true, 'a letter dropped')
  assert.equal(oneEditApart('KERIA', 'KERRIA'), true)
  assert.equal(oneEditApart('KERRIAA', 'KERRIA'), true, 'a letter added')
  assert.equal(oneEditApart('KERRUA', 'KERRIA'), true, 'a letter changed')
  assert.equal(oneEditApart('KERIRA', 'KERRIA'), true, 'two letters swapped')
  assert.equal(oneEditApart('KERRIA', 'KERRIA'), false, 'the same street is not a slip')
  assert.equal(oneEditApart('KRIA', 'KERRIA'), false, 'two letters off is not guessed')
  assert.equal(oneEditApart('NOLANA', 'KERRIA'), false)
  assert.equal(countyFromText('2002 Kiskade Ln Mission'), 'Hidalgo County')
  assert.equal(countyFromText('1201 Keria Ave, Mc Allen, TX'), 'Hidalgo County')
  assert.equal(countyFromText('344 SE 3rd St, Premont'), null, 'a city we have no rules for names no county')
})

for (const [typed, street, propId] of [
  ['2002 Kiskade Ln Mission', 'KISKADEE', null],
  ['1201 Keria Ave, McAllen, TX', 'KERRIA', '255056'],
]) {
  test(`U6 (HTTP): "${typed}" offers the right parcel as a near match, the server keeps it near, and the drafter's queue marks it`, async (t) => {
    const base = await startApi(t)
    const ana = await who(base, `ana.${street.toLowerCase()}@example.com`)
    const maria = await who(base, 'maria@drafthouse.test')
    const p = await (await ana.get(`/api/lot/parcel?address=${enc(typed)}`)).json()
    assert.equal(p.match, 'one', JSON.stringify(p).slice(0, 300))
    assert.equal(p.confidence, 'near')
    assert.equal(p.nearWhy, 'street')
    assert.match(p.listedAs, new RegExp(`^${typed.split(' ')[0]} ${street}\\b`))
    if (propId) assert.equal(p.propId, propId)
    // the exact address finds the same parcel, exactly
    const exact = await (await ana.get(`/api/lot/parcel?address=${enc(typed.replace(/Kiskade\b/, 'Kiskadee').replace(/Keria\b/, 'Kerria'))}`)).json()
    assert.equal(exact.match, 'one')
    assert.notEqual(exact.confidence, 'near')
    assert.equal(exact.propId, p.propId)
    // taken: the server stamps it near (whatever the browser says), and the queue marks it
    const spec = { ...parcelSpec(p, { address: typed, city: 'mcallen', county: 'Hidalgo County' }), confidence: 'exact', listedAs: null }
    const prj = await (await ana.post('/api/projects', { lot: buildLot(spec), stage: 'style' })).json()
    assert.equal(prj.lot.spec.confidence, 'near')
    assert.match(prj.lot.spec.listedAs, new RegExp(street))
    const row = (await (await maria.get('/api/review')).json()).lots.find((x) => x.id === prj.id)
    assert.equal(row.lot.spec.confidence, 'near', 'the row shows "Near match: check the address"')
  })
}

test('U6: a street two letters off finds no parcel by guessing', async (t) => {
  const base = await startApi(t)
  const ana = await who(base, 'ana.krria@example.com')
  const p = await (await ana.get(`/api/lot/parcel?address=${enc('1201 Krr Ave, McAllen, TX')}`)).json()
  assert.notEqual(p.match, 'one')
})
