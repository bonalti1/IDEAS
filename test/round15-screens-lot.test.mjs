// Fix round 15, the lot step (src/draft/screens/Lot.jsx), in a browser, at 1440 x 900 and 390 x 844:
//   U8   "Is this your lot?" draws the county parcel itself (or nothing, with a line saying it is being looked up);
//        never the typed tab's 100 by 150 ft, 15,000 sf placeholder or its numbers
//   U18  the plat-only screen: no huge empty map, an address box wide enough for its words, no silent "Hidalgo County
//        (unincorporated)" (an explicit "Pick the city"), no warning box over empty fields, and a small picture of the
//        plat on "Your plat is saved for the drafter"
// The office API answers from the recordings; nothing reaches the internet. Skips when no Chrome is found.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { skip, OUT, KISKADEE, PLAT, setup, signIn } from './round15-screens-helpers.mjs'

const FAKE = /15,000|100 by 150|100 x 150|100 por 150/

for (const size of [
  [1440, 900],
  [390, 844],
]) {
  const [w, h] = size
  test(`U8 at ${w}: while the county parcel is looked up and offered, the lot drawn is that parcel (or nothing yet), never a 100 by 150 ft placeholder or its numbers`, { skip, timeout: 300000 }, async (t) => {
    const { open, errors } = await setup(t)
    const page = await open(size)
    await signIn(page, 'Jose Kiskadee', `jose.lot.${w}@example.com`)
    await page.locator('#start-address').fill(KISKADEE)
    // everything the lot step says or draws on the way to "Is this your lot?" is recorded
    await page.evaluate(() => {
      window.__said = new Set()
      const look = () => {
        const root = document.querySelector('#root')
        if (!root) return
        for (const line of root.innerText.split('\n')) window.__said.add(line)
        const tag = document.querySelector('[data-testid="lot-tag"]')
        if (tag) window.__said.add('area ' + tag.getAttribute('data-area'))
      }
      new MutationObserver(look).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true })
    })
    await page.locator('#start-address').locator('xpath=ancestor::*[contains(@class,"card")][1]').locator('button.btn-primary').last().click()
    const card = page.getByTestId('parcel-card')
    await card.waitFor({ timeout: 30000 })
    await page.waitForTimeout(1500)
    await page.screenshot({ path: `${OUT}/u8-is-this-your-lot-${w}.png` })
    const said = await page.evaluate(() => [...window.__said])
    assert.deepEqual(said.filter((l) => FAKE.test(l)), [], 'no 100 by 150 ft lot and no 15,000 sf was ever on the screen')
    // what is drawn is the parcel on the card: about 5,880 sf
    const tag = page.getByTestId('lot-tag')
    assert.equal(await tag.count(), 1)
    const area = Number(await tag.getAttribute('data-area'))
    assert.ok(Math.abs(area - 5880) < 60, `the outline drawn is the county parcel (${area} sf)`)
    assert.ok(!said.some((l) => /^area (15000|14999)/.test(l)), 'never the 15,000 sf placeholder')
    assert.match(await tag.textContent(), /2002 Kiskadee/i)
    assert.equal(await page.locator('.lot-side .stats').count(), 0, 'no lot numbers until the homeowner says it is theirs')
    // taken: the numbers are the parcel's
    await page.getByTestId('parcel-yes').click()
    await page.locator('.lot-side .stats').waitFor({ timeout: 10000 })
    assert.match(await page.locator('.lot-side .stats').innerText(), /5,8\d\d sf/)
    assert.doesNotMatch(await page.locator('#root').innerText(), FAKE)
    assert.deepEqual(errors, [])
  })

  test(`U18 at ${w}: a plat with no address: a small empty area, a wide address box, "Pick the city" with no silent county, no warning over empty fields, and the plat's picture on its card`, { skip, timeout: 300000 }, async (t) => {
    const { open, errors } = await setup(t)
    const page = await open(size)
    await signIn(page, 'Ana Plat', `ana.plat.${w}@example.com`)
    await page.locator('.start .drop input[type=file]').setInputFiles(PLAT)
    await page.getByTestId('start-file-only').waitFor({ timeout: 10000 })
    await page.locator('.start-card button.btn-primary').last().click()
    const saved = page.getByTestId('plat-saved')
    await saved.waitFor({ timeout: 30000 })
    await page.waitForTimeout(1200)
    await page.screenshot({ path: `${OUT}/u18-plat-only-${w}.png`, fullPage: w < 600 })
    // the empty area waiting for a lot is small
    const wait = await page.locator('.viewport.lot-view').evaluate((el) => {
      const r = el.getBoundingClientRect()
      return { w: r.width, h: r.height }
    })
    if (w > 600) assert.ok(wait.w <= w * 0.45, `the empty map is ${Math.round(wait.w)} px of a ${w} px screen`)
    else assert.ok(wait.h <= 170, `the empty map is ${Math.round(wait.h)} px tall on a phone`)
    // the address box: wide, and its words fit in it
    const box = await page.locator('#lot-address').evaluate((el) => {
      const cs = getComputedStyle(el)
      const c = document.createElement('canvas').getContext('2d')
      c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
      const room = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
      return { width: el.getBoundingClientRect().width, words: c.measureText(el.placeholder).width, room, font: parseFloat(cs.fontSize) }
    })
    assert.ok(box.width >= Math.min(300, w - 60), `the address box is ${Math.round(box.width)} px wide`)
    assert.ok(box.words <= box.room, `its placeholder fits (${Math.round(box.words)} px of words in ${Math.round(box.room)} px)`)
    assert.ok(box.font >= 14, 'its words are a readable size')
    // the city: nothing chosen for the homeowner, and they are asked
    assert.equal(await page.locator('#lot-city').inputValue(), '')
    const chosen = await page.locator('#lot-city').evaluate((el) => el.options[el.selectedIndex].textContent)
    assert.match(chosen, /^Pick the city$/)
    // (the list of cities holds it, as one choice among the others; nothing else says it)
    const outsideTheList = await page.locator('.lot-side').evaluate((el) => {
      const copy = el.cloneNode(true)
      copy.querySelectorAll('select').forEach((s) => s.remove())
      return copy.textContent
    })
    assert.doesNotMatch(outsideTheList, /Hidalgo County \(unincorporated\)/)
    // no warning box sitting over the empty fields
    assert.equal(await page.locator('.lot-side .fine.assume').count(), 0, 'no yellow warning above empty fields')
    // the plat's own picture on its card
    const thumb = saved.getByTestId('plat-thumb')
    await thumb.waitFor({ timeout: 15000 })
    const pic = await thumb.evaluate((el) => {
      const r = el.getBoundingClientRect()
      const img = el.tagName === 'IMG' ? el : el.querySelector('img, canvas')
      return { w: r.width, h: r.height, drawn: img ? (img.naturalWidth || img.width) > 0 : false }
    })
    assert.ok(pic.drawn && pic.w >= 48 && pic.w <= 160, `a small picture of the plat (${Math.round(pic.w)} x ${Math.round(pic.h)})`)
    // the homeowner types the plat's numbers: the lot is drawn, and goes on once the city is picked
    await page.locator('#lot-width').fill('80')
    await page.locator('#lot-depth').fill('140')
    await page.locator('#lot-street').fill('Showers Rd')
    await page.locator('.lot-side .stats').waitFor({ timeout: 10000 })
    assert.ok(await page.getByTestId('lot-next').isDisabled(), 'not before the city is picked')
    await page.locator('#lot-city').selectOption('mcallen')
    await page.waitForTimeout(400)
    assert.ok(await page.getByTestId('lot-next').isEnabled(), 'the lot goes on once the city is picked')
    await page.screenshot({ path: `${OUT}/u18-plat-only-city-picked-${w}.png`, fullPage: w < 600 })
    await page.getByTestId('lot-next').click()
    await page.getByTestId('style-farmhouse').waitFor({ timeout: 20000 })
    assert.deepEqual(errors, [])
  })
}
