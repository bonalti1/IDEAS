// Fix round 15, the rooms step (src/draft/screens/Program.jsx) and the first screen's houses, in a browser:
//   U1, U17  Kiskadee, a tight lot: "A tight lot for our ready plans" and its "Send my lot to the drafter" button are
//            on the first screen at 1440 x 900 and 390 x 844; after sending, the confirmation is on screen and
//            "Draft my house" is no longer the big primary button
//   U16      Kerria fits our plans fine: no "tight lot" card there, in Spanish or English
//   U5, U10  the recent build is offered only where it fits (none on Kiskadee, still on Kerria); it is called "Recent
//            build, Rio Grande City" ("Casa reciente, Rio Grande City"), in letters a homeowner can read; the rooms
//            start at what fits, and the size bar is never red on first view
//   U11      a house resumed from "Your houses" has exactly the rooms that were chosen, and the card says so
// The office API answers from the recordings; nothing reaches the internet. Skips when no Chrome is found.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { skip, OUT, KISKADEE, KERRIA, setup, signIn, signOut, toRooms, watchRooms, roomsSettled, pageWords } from './round15-screens-helpers.mjs'

const OLD_NAME = /Garza/i

for (const size of [
  [1440, 900],
  [390, 844],
]) {
  const [w, h] = size
  test(`U1, U17, U5, U10 at ${w}: on Kiskadee the tight-lot card and its button are on the first screen, no recent build is offered, the bar is never red, and once sent the confirmation is on screen and "Draft my house" steps back`, { skip, timeout: 300000 }, async (t) => {
    const { open, errors } = await setup(t)
    const page = await open(size)
    await signIn(page, 'Jose Kiskadee', `jose.${w}@example.com`)
    await page.locator('#start-address').fill(KISKADEE)
    await page.locator('#start-address').locator('xpath=ancestor::*[contains(@class,"card")][1]').locator('button.btn-primary').last().click()
    await page.getByTestId('parcel-card').waitFor({ timeout: 30000 })
    await page.getByTestId('parcel-yes').click()
    await page.waitForTimeout(600)
    await page.getByTestId('lot-next').click()
    await page.getByTestId('style-farmhouse').click()
    await page.locator('.actions button.btn-primary').last().click()
    await page.getByTestId('lot-strip').waitFor({ timeout: 20000 })
    await watchRooms(page)
    const card = page.getByTestId('tight-lot')
    await card.waitFor({ timeout: 120000 })
    await roomsSettled(page)
    await page.screenshot({ path: `${OUT}/u1-kiskadee-rooms-first-screen-${w}.png` })
    // U1: the button is whole inside the first screen, with nothing scrolled
    const box = await page.getByTestId('send-lot-tight').evaluate((el) => {
      const r = el.getBoundingClientRect()
      const scrolled = [...document.querySelectorAll('.screen, .dh-main'), document.scrollingElement].some((s) => s && s.scrollTop > 0)
      return { top: r.top, bottom: r.bottom, scrolled, vh: window.innerHeight }
    })
    assert.equal(box.scrolled, false, 'nothing was scrolled')
    assert.ok(box.top >= 0 && box.bottom <= box.vh, `the button's bottom edge (${Math.round(box.bottom)}px) is inside the first screen (${box.vh}px)`)
    assert.match(await card.innerText(), /A tight lot for our ready plans/i)
    // U5: no recent build on a lot it cannot fit (the largest house here is about 37 by 43 ft)
    assert.equal(await page.locator('.preset').count(), 0, 'no recent-build card on Kiskadee')
    // U10: the rooms start at what fits; nothing red on the way there
    assert.deepEqual(await page.evaluate(() => [...new Set(window.__red)]), [], 'the size bar was never red and "does not fit" was never said on first view')
    assert.equal(await page.locator('.meter-fill.over').count(), 0)
    assert.doesNotMatch(await pageWords(page), OLD_NAME)
    // U17: sending puts the confirmation where the button was, and "Draft my house" is no longer the big primary button
    await page.getByTestId('send-lot-tight').click()
    const sent = page.getByText('Your lot is with our drafter').first()
    await sent.waitFor({ timeout: 30000 })
    const seen = await sent.evaluate((el) => {
      const r = el.getBoundingClientRect()
      return r.top >= 0 && r.bottom <= window.innerHeight
    })
    assert.ok(seen, 'the confirmation is on the screen')
    const draft = page.getByTestId('draft-my-house')
    assert.equal(await draft.count(), 1)
    assert.doesNotMatch(await draft.getAttribute('class'), /btn-primary/, '"Draft my house" is no longer the primary button')
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/u17-kiskadee-sent-${w}.png` })
    assert.deepEqual(errors, [])
  })
}

for (const [size, lang] of [
  [[1440, 900], 'es'],
  [[390, 844], 'en'],
]) {
  const [w] = size
  test(`U16, U5, U10 at ${w} (${lang}): Kerria fits our plans, so no tight-lot card; the recent build is offered, renamed and legible; the bar is never red`, { skip, timeout: 300000 }, async (t) => {
    const { open, errors } = await setup(t)
    const page = await open(size, { lang })
    await signIn(page, 'Rosa Kerria', `rosa.kerria.${w}@example.com`)
    const words = []
    words.push(await pageWords(page))
    await page.locator('#start-address').fill(KERRIA)
    await page.locator('#start-address').locator('xpath=ancestor::*[contains(@class,"card")][1]').locator('button.btn-primary').last().click()
    await page.getByTestId('parcel-card').waitFor({ timeout: 30000 })
    words.push(await pageWords(page))
    await page.getByTestId('parcel-yes').click()
    await page.waitForTimeout(600)
    await page.getByTestId('lot-next').click()
    await page.getByTestId('style-farmhouse').click()
    words.push(await pageWords(page))
    await page.locator('.actions button.btn-primary').last().click()
    await page.getByTestId('lot-strip').waitFor({ timeout: 20000 })
    await watchRooms(page)
    await roomsSettled(page)
    await page.waitForTimeout(1500)
    await page.screenshot({ path: `${OUT}/u16-kerria-rooms-${lang}-${w}.png`, fullPage: w < 600 })
    // U16: nothing says this lot is tight
    assert.equal(await page.getByTestId('tight-lot').count(), 0, 'no "tight lot" card on Kerria')
    assert.doesNotMatch(await page.locator('main').innerText(), /tight lot|lote justo/i)
    // U5: the recent build is offered here, under its new name
    const preset = page.locator('.preset')
    assert.equal(await preset.count(), 1, 'Kerria still offers the recent build')
    assert.match(await preset.innerText(), lang === 'es' ? /Casa reciente, Rio Grande City/ : /Recent build, Rio Grande City/)
    // U10: legible: the name at 15 px or more, the line under it at 13 px or more
    const sizes = await preset.evaluate((el) => ({ b: parseFloat(getComputedStyle(el.querySelector('b')).fontSize), small: parseFloat(getComputedStyle(el.querySelector('small')).fontSize) }))
    assert.ok(sizes.b >= 15 && sizes.small >= 13, `the card reads at ${sizes.b} / ${sizes.small} px`)
    assert.deepEqual(await page.evaluate(() => [...new Set(window.__red)]), [], 'never red on first view')
    words.push(await pageWords(page))
    // office decision 1: the old name is nowhere a homeowner looks, in either language
    await preset.click()
    await page.waitForTimeout(800)
    words.push(await pageWords(page))
    for (const text of words) assert.doesNotMatch(text, OLD_NAME)
    assert.deepEqual(errors, [])
  })
}

test('U11 at 1440 and 390: rooms the homeowner chose (3 baths, 2,800 sf, an office and a half bath) come back exactly from "Your houses", and the card says "Rooms chosen, ready to draft"', { skip, timeout: 300000 }, async (t) => {
  const { open, errors } = await setup(t)
  const page = await open([1440, 900])
  await signIn(page, 'Maria Resume', 'maria.resume@example.com')
  await toRooms(page, KERRIA)
  await roomsSettled(page)
  // she sets the rooms she wants: 4 bedrooms, 3 baths, 2,800 sf, an office and a half bath
  const value = async (label) => Number((await page.locator('.stepper', { hasText: label }).first().locator('.stepper-val').innerText()).replace(/\D/g, ''))
  const setTo = async (label, want) => {
    for (let i = 0; i < 8 && (await value(label)) !== want; i++) {
      await page.getByRole('button', { name: `${(await value(label)) < want ? 'More' : 'Fewer'} ${label}` }).click()
      await page.waitForTimeout(150)
    }
  }
  await setTo('Bedrooms', 4)
  await setTo('Full bathrooms', 3)
  await page.locator('input[type=range]').evaluate((el) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    set.call(el, '2800')
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  for (const extra of ['Office', 'Half bath']) {
    const chip = page.locator('.stepper.extras .chips button', { hasText: new RegExp(`^${extra}$`) })
    if (!/\bon\b/.test((await chip.getAttribute('class')) || '')) await chip.click()
  }
  await page.waitForTimeout(400)
  const chosen = { beds: await value('Bedrooms'), baths: await value('Full bathrooms'), sqft: Number((await page.locator('.stepper', { hasText: 'Living area' }).locator('.stepper-val').innerText()).replace(/\D/g, '')), extras: await page.locator('.stepper.extras .chips button.on').allInnerTexts() }
  assert.deepEqual(chosen, { beds: 4, baths: 3, sqft: 2800, extras: ['Office', 'Half bath', 'Front porch'] })
  await page.waitForTimeout(2000) // saved a moment after the last tap
  await signOut(page)
  await signIn(page, 'Maria Resume', 'maria.resume@example.com')
  const house = page.locator('.houses .house').first()
  await house.waitFor({ timeout: 20000 })
  assert.match(await house.textContent(), /Rooms chosen, ready to draft/)
  await page.screenshot({ path: `${OUT}/u11-your-houses-rooms-chosen-1440.png` })
  await house.click()
  await page.getByTestId('lot-strip').waitFor({ timeout: 30000 })
  await roomsSettled(page)
  await page.waitForTimeout(1500)
  const back = { beds: await value('Bedrooms'), baths: await value('Full bathrooms'), sqft: Number((await page.locator('.stepper', { hasText: 'Living area' }).locator('.stepper-val').innerText()).replace(/\D/g, '')), extras: await page.locator('.stepper.extras .chips button.on').allInnerTexts() }
  assert.deepEqual(back, chosen, 'the rooms are exactly the ones chosen')
  assert.equal(await page.getByTestId('auto-start').count(), 0, 'nothing was re-fitted silently')
  await page.screenshot({ path: `${OUT}/u11-resumed-rooms-exact-1440.png` })
  // the same house on a phone: the card and the rooms
  const phone = await open([390, 844])
  await signIn(phone, 'Maria Resume', 'maria.resume@example.com')
  await phone.locator('.houses .house').first().waitFor({ timeout: 20000 })
  assert.match(await phone.locator('.houses .house').first().textContent(), /Rooms chosen, ready to draft/)
  await phone.screenshot({ path: `${OUT}/u11-your-houses-rooms-chosen-390.png` })
  await phone.locator('.houses .house').first().click()
  await phone.getByTestId('lot-strip').waitFor({ timeout: 30000 })
  await roomsSettled(phone)
  await phone.waitForTimeout(1200)
  assert.equal(Number((await phone.locator('.stepper', { hasText: 'Full bathrooms' }).locator('.stepper-val').innerText()).replace(/\D/g, '')), 3)
  await phone.screenshot({ path: `${OUT}/u11-resumed-rooms-exact-390.png`, fullPage: true })
  assert.deepEqual(errors, [])
})
