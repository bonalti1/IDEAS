// Fix round 15, the lead's screen pieces on top of the server work:
// D2 (screen): a visitor without an account who picks a plat is asked to sign in right there; the file picked is
//   kept, nothing is uploaded until they are signed in, and the file's own name is never shown (P4).
// B5 (screen): the plat, once uploaded with nothing typed, is a house in the drafter queue at once; a plat uploaded
//   on a house saved with only its address goes with that house too.
// U6 (screen): a street one letter off ("Kiskade") is said plainly with the county's spelling.
// The office API answers from the recordings; nothing reaches the internet.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { setup, skip, OUT, PLAT, startApi } from './round15-screens-helpers.mjs'
import path from 'node:path'

async function who(base, email) {
  const { token } = await (await fetch(base + '/api/auth/dev-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, name: email.split('@')[0] }) })).json()
  const h = { 'content-type': 'application/json', authorization: `Bearer ${token}` }
  return {
    get: (p) => fetch(base + p, { headers: h }),
    post: (p, b = {}) => fetch(base + p, { method: 'POST', headers: h, body: JSON.stringify(b) }),
    put: (p, b = {}) => fetch(base + p, { method: 'PUT', headers: h, body: JSON.stringify(b) }),
  }
}

test('B5 (HTTP): a plat uploaded after the address was saved goes with that house; saved with an address and a plat together, both are kept; another account\'s plat is refused', async (t) => {
  const base = await startApi(t, { PLAT_PRUNE: '0' })
  const ana = await who(base, 'ana.lead@example.com')
  const bob = await who(base, 'bob.lead@example.com')
  const maria = await who(base, 'maria@drafthouse.test')
  const data = fs.readFileSync(PLAT).toString('base64')
  const rec = await (await ana.post('/api/lot/plat', { name: 'x.png', data })).json()
  const bobs = await (await bob.post('/api/lot/plat', { name: 'y.png', data })).json()
  // the address first (the first screen saves it), then the plat on the lot step
  const first = await (await ana.post('/api/projects', { address: '1201 Kerria Ave, McAllen, TX 78501' })).json()
  assert.equal(first.platId, undefined)
  assert.equal((await ana.put(`/api/projects/${first.id}`, { platId: bobs.platId, stage: 'lot' })).status, 400, 'not another account\'s plat')
  const upd = await ana.put(`/api/projects/${first.id}`, { platId: rec.platId, stage: 'lot' })
  assert.equal(upd.status, 200)
  assert.equal((await upd.json()).platId, rec.platId)
  const row = (await (await maria.get('/api/review')).json()).lots.find((p) => p.id === first.id)
  assert.ok(row, 'in "Lots to confirm" with its plat')
  // both at once (the lot step saves a house that had nothing yet)
  const rec2 = await (await ana.post('/api/lot/plat', { name: 'z.png', data })).json()
  const both = await (await ana.post('/api/projects', { address: '2002 Kiskadee Ln, Mission, TX 78572', platId: rec2.platId })).json()
  assert.equal(both.platId, rec2.platId)
  assert.match(both.address, /Kiskadee/)
})

test('D2 + B5 + P4 (screen, 1440 and 390): a visitor picks a plat; sign-in opens right there with the file kept; nothing is uploaded until signed in; the plat is then in the drafter queue', { skip, timeout: 300000 }, async (t) => {
  const { open, apiBase, errors } = await setup(t)
  for (const [size, lang, email] of [[[1440, 900], 'en', 'visitor.d2a@example.com'], [[390, 844], 'es', 'visitor.d2b@example.com']]) {
    const page = await open(size, { lang })
    const uploads = []
    page.on('request', (r) => r.method() === 'POST' && /\/api\/lot\/plat$/.test(r.url()) && uploads.push(Date.now()))
    await page.getByRole('button', { name: lang === 'es' ? /Probar sin cuenta|sin una cuenta/i : 'Try it without an account' }).click()
    await page.getByTestId('start-plat-input').setInputFiles(PLAT)
    await page.getByTestId('plat-signin').waitFor({ timeout: 10000 })
    const picked = await page.getByTestId('start-plat-picked').innerText()
    assert.match(picked, lang === 'es' ? /Plat en foto/ : /Plat \(photo\)/, 'the kind, not the name')
    assert.doesNotMatch(await page.evaluate(() => document.body.innerText), /garza|site-plan|\.png/i, 'the file name is never shown')
    assert.equal(await page.getByRole('button', { name: lang === 'es' ? /Buscar mi lote/ : 'Find my lot' }).count(), 0, 'no way past the sign-in with the plat')
    await page.screenshot({ path: path.join(OUT, `lead-d2-signin-${size[0]}-${lang}.png`) })
    assert.equal(uploads.length, 0, 'nothing uploaded before sign-in')
    // signs in right there
    const form = page.getByTestId('plat-signin')
    if (await form.locator('#signin-name').count()) await form.locator('#signin-name').fill('Visitor')
    await form.locator('#signin-email').fill(email)
    await form.locator('#signin-email').press('Enter')
    await page.getByTestId('plat-signin').waitFor({ state: 'detached', timeout: 20000 })
    assert.match(await page.getByTestId('start-plat-picked').innerText(), lang === 'es' ? /Plat en foto/ : /Plat \(photo\)/, 'the file is still there')
    await page.getByRole('button', { name: lang === 'es' ? /Buscar mi lote/ : 'Find my lot' }).click()
    // the lot step reads it (no reader key here: unread, kept for the drafter) and the house is saved with it
    await page.waitForFunction(() => /saved for the drafter|guardado para el dibujante|guardamos|Your plat|Tu plat/i.test(document.body.innerText), null, { timeout: 30000 }).catch(() => {})
    assert.equal(uploads.length, 1, 'uploaded once, signed in')
    let row = null
    const maria = await who(apiBase, 'maria@drafthouse.test')
    for (let i = 0; i < 40 && !row; i++) {
      const inbox = await (await maria.get('/api/review')).json()
      row = inbox.lots.find((p) => p.email === email)
      if (!row) await new Promise((r) => setTimeout(r, 250))
    }
    assert.ok(row, 'the plat-only house is in the drafter queue at once')
    assert.ok(row.platId, 'with its plat')
    await page.screenshot({ path: path.join(OUT, `lead-b5-lot-step-${size[0]}-${lang}.png`) })
    await page.context().close()
  }
  assert.deepEqual(errors, [])
})

test('U6 (screen): "2002 Kiskade Ln Mission" finds the Kiskadee parcel and says the street is spelled a little differently, in English and Spanish', { skip, timeout: 240000 }, async (t) => {
  const { open } = await setup(t)
  for (const [size, lang] of [[[1440, 900], 'en'], [[390, 844], 'es']]) {
    const page = await open(size, { lang })
    await page.locator('#signin-email').waitFor({ timeout: 20000 })
    if (await page.locator('#signin-name').count()) await page.locator('#signin-name').fill('Jose')
    await page.locator('#signin-email').fill(`jose.u6.${lang}@example.com`)
    await page.locator('#signin-email').press('Enter')
    await page.locator('#start-address').waitFor({ timeout: 20000 })
    await page.locator('#start-address').fill('2002 Kiskade Ln Mission')
    await page.getByRole('button', { name: lang === 'es' ? /Buscar mi lote/ : 'Find my lot' }).click()
    const line = page.getByTestId('listed-as-street')
    await line.waitFor({ timeout: 40000 })
    const text = await line.innerText()
    assert.match(text, /KISKADEE/i)
    assert.match(text, lang === 'es' ? /se escribe un poco distinto/ : /spelled a little differently/)
    assert.equal(await page.getByTestId('geo-not-found').count(), 0, 'no "we could not find this address" above the lot that was found')
    await page.screenshot({ path: path.join(OUT, `lead-u6-kiskade-${size[0]}-${lang}.png`) })
    await page.context().close()
  }
})

test('U19 (drafter, 1440): two houses of the same client are told apart by street and day on one line each; the card asks to confirm the lot and the zoning once', { skip, timeout: 240000 }, async (t) => {
  const { open, apiBase, appBase } = await setup(t)
  const { buildLot } = await import('../src/draft/lib/lot.js')
  const { parcelSpec } = await import('../src/draft/lib/parcel-spec.js')
  const tc = await who(apiBase, 'same.name@example.com')
  for (const address of ['1201 Kerria Ave, McAllen, TX 78501', '2002 Kiskadee Ln, Mission, TX 78572']) {
    const parcel = await (await tc.get(`/api/lot/parcel?address=${encodeURIComponent(address)}`)).json()
    const lot = buildLot(parcelSpec(parcel, { address, city: /McAllen/.test(address) ? 'mcallen' : 'mission', county: 'Hidalgo County' }))
    assert.equal((await tc.post('/api/projects', { lot, client: 'Test Customer', stage: 'style' })).status, 201)
  }
  const page = await open([1440, 900])
  await page.goto(`${appBase}/#/review`, { waitUntil: 'domcontentloaded' })
  await page.locator('#signin-email').fill('maria@drafthouse.test')
  await page.locator('#signin-email').press('Enter')
  await page.getByText('Review inbox').waitFor({ timeout: 30000 })
  const rows = page.locator('.inbox-row', { hasText: 'Test Customer' })
  await rows.first().waitFor({ timeout: 20000 })
  const titles = await rows.getByTestId('row-title').allInnerTexts()
  assert.equal(titles.length, 2)
  assert.ok(titles.some((x) => /Test Customer · 1201 Kerria Ave/.test(x)) && titles.some((x) => /Test Customer · 2002 Kiskadee Ln/.test(x)), titles.join(' | '))
  assert.match(await rows.first().getByTestId('row-when').innerText(), /[A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} [AP]M/)
  assert.match(await rows.first().innerText(), /Homeowner still drafting/i)
  const width = await page.locator('.inbox-list').first().evaluate((e) => e.getBoundingClientRect().width)
  assert.ok(width >= 860, `the queue is wide enough for a row on a line (${Math.round(width)} px)`)
  await page.screenshot({ path: path.join(OUT, 'lead-u19-queue-1440.png'), fullPage: true })
  await rows.first().click()
  await page.getByTestId('review-checklist').waitFor({ timeout: 30000 })
  await page.waitForTimeout(1000)
  assert.equal(await page.getByRole('button', { name: 'Confirm lot', exact: true }).count(), 1, 'Confirm lot once')
  assert.ok((await page.getByRole('button', { name: /^Confirm R-|^Confirm [A-Z]{1,3}-?\d/ }).count()) <= 1, 'the read zoning is confirmed once')
  await page.screenshot({ path: path.join(OUT, 'lead-u19-card-1440.png'), fullPage: true })
})

test('P (k02): on a phone the words on the lot map are drawn half as big again; beside a house in 3D they stay small', async () => {
  const { groundTextScale } = await import('../src/draft/lib/camera.js')
  assert.equal(groundTextScale({ phone: true }), 1.5)
  assert.equal(groundTextScale({ phone: false }), 1)
  assert.equal(groundTextScale({ house: true, view: '3d', phone: true }), 0.45)
  assert.equal(groundTextScale({ house: true, view: 'top', phone: true }), 1.5)
  assert.match(fs.readFileSync('src/draft/HouseScene.jsx', 'utf8'), /groundTextScale\(\{ house: [^}]*phone \}\)/)
})
