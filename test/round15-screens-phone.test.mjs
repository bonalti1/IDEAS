// Fix round 15, the first screen and the Draft step, in a browser:
//   U13  on a phone (390 x 844) the sign-in is on the first screen; on the Draft step the header and the view tabs
//        are short, and a small 3D / plan picture stays above the chat while the homeowner scrolls and types
//   U14  the free-changes explanation waits behind an info button by the count, and reads as two sentences
//   P    a change that keeps the floor area says what changed ("Rear porch added · same floor area"), not
//        "same size"
// The office API answers from the recordings; nothing reaches the internet. Skips when no Chrome is found.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { skip, OUT, KERRIA, setup, signIn, toRooms, roomsSettled } from './round15-screens-helpers.mjs'

for (const lang of ['en', 'es']) {
  test(`U13 (${lang}): the first screen on a phone has the sign-in on it, nothing scrolled; on a wide screen too`, { skip, timeout: 200000 }, async (t) => {
    const { open, errors } = await setup(t)
    for (const size of [
      [390, 844],
      [1440, 900],
    ]) {
      const page = await open(size, { lang })
      await page.locator('#signin-email').waitFor({ timeout: 20000 })
      await page.waitForTimeout(800)
      await page.screenshot({ path: `${OUT}/u13-first-screen-${lang}-${size[0]}.png` })
      const go = await page.locator('form.signin button[type=submit]').evaluate((el) => {
        const r = el.getBoundingClientRect()
        const scrolled = [...document.querySelectorAll('.screen, .start, .dh-main'), document.scrollingElement].some((s) => s && s.scrollTop > 0)
        return { bottom: r.bottom, vh: window.innerHeight, scrolled }
      })
      const email = await page.locator('#signin-email').evaluate((el) => el.getBoundingClientRect().bottom)
      assert.equal(go.scrolled, false)
      assert.ok(email <= go.vh && go.bottom <= go.vh, `${size[0]}: the email box (${Math.round(email)}) and its button (${Math.round(go.bottom)}) are on the first screen (${go.vh})`)
    }
    assert.deepEqual(errors, [])
  })
}

test('U13, U14, P at 390: on the Draft step the header and tabs are short, the picture stays above the chat while chatting, the free-changes note waits behind an info button, and a change says what changed', { skip, timeout: 400000 }, async (t) => {
  const { open, errors } = await setup(t)
  const page = await open([390, 844])
  await signIn(page, 'Mike Phone', 'mike.phone@example.com')
  await toRooms(page, KERRIA)
  await roomsSettled(page)
  await page.getByTestId('draft-my-house').or(page.locator('.actions button').last()).first().click()
  await page.getByTestId('changes-left').waitFor({ timeout: 60000 })
  await page.locator('[data-testid="scene-loading"]').waitFor({ state: 'detached', timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${OUT}/u13-draft-phone-top-390.png` })
  // the header and the view tabs together take little of the screen
  const chrome = await page.evaluate(() => {
    const head = document.querySelector('.dh-head').getBoundingClientRect()
    const views = document.querySelector('.screen.split > .viewport .viewport-views').getBoundingClientRect()
    const stage = document.querySelector('.screen.split > .viewport .viewport-stage').getBoundingClientRect()
    // the tabs sit on the picture or in a row of their own; either way, what is not picture above the chat
    const own = views.top >= stage.bottom - 1 ? views.height : 0
    return { head: head.height, views: own }
  })
  assert.ok(chrome.head + chrome.views <= 100, `the header and tabs take ${Math.round(chrome.head + chrome.views)} px (they took about 140)`)
  // U14: one short line by the count; the rest behind the info button
  const note = page.getByTestId('changes-note')
  const more = page.getByTestId('changes-more')
  assert.equal(await more.isVisible(), false, 'the explanation is hidden at first')
  assert.match(await note.innerText(), /^10 free changes; a failed request doesn't use one\.?$/)
  await page.getByTestId('changes-info').click()
  await more.waitFor({ state: 'visible', timeout: 5000 })
  const full = (await note.innerText()).replace(/\s+/g, ' ').trim()
  assert.match(full, /doesn't use one\. Only a change the chat makes to your plan uses one\./, `the two sentences are apart: "${full}"`)
  await page.screenshot({ path: `${OUT}/u14-changes-info-open-390.png` })
  await page.getByTestId('changes-info').click()
  await more.waitFor({ state: 'hidden', timeout: 5000 })
  // U13: chatting, the picture stays at the top of the screen, above the chat
  const box = page.getByLabel('Your change')
  await box.scrollIntoViewIfNeeded()
  await box.fill('add a porch on the back')
  await box.press('Enter')
  await page.locator('.msg.thinking').waitFor({ state: 'detached', timeout: 60000 }).catch(() => {})
  await page.waitForTimeout(1500)
  await box.scrollIntoViewIfNeeded()
  await page.waitForTimeout(500)
  const view = await page.evaluate(() => {
    const v = document.querySelector('.screen.split > .viewport').getBoundingClientRect()
    const input = document.querySelector('form.ask input').getBoundingClientRect()
    const head = document.querySelector('.dh-head').getBoundingClientRect()
    const scrolled = document.querySelector('.screen.split').scrollTop
    return { top: v.top, bottom: v.bottom, h: v.height, input: input.top, inputBottom: input.bottom, head: head.bottom, scrolled, vh: window.innerHeight }
  })
  await page.screenshot({ path: `${OUT}/u13-draft-phone-chatting-390.png` })
  assert.ok(view.scrolled > 0, 'the page was scrolled down to the chat')
  assert.ok(view.top <= view.head + 2 && view.h >= 150, `the picture stays at the top (${Math.round(view.top)} px, ${Math.round(view.h)} px tall)`)
  assert.ok(view.bottom <= view.input && view.inputBottom <= view.vh, 'the chat box is below the picture, on the screen')
  // P: what the change did, in words
  const meta = await page.locator('.msg.house .meta').last().innerText()
  assert.doesNotMatch(meta, /same size/i)
  assert.match(meta, /Rear porch added · same floor area · 1 change used/i, `the change says what it did: "${meta}"`)
  assert.deepEqual(errors, [])
})

test('U14 at 1440: the free-changes note is one line until the info button is pointed at or tapped', { skip, timeout: 300000 }, async (t) => {
  const { open, errors } = await setup(t)
  const page = await open([1440, 900])
  await signIn(page, 'Maria Wide', 'maria.wide@example.com')
  await toRooms(page, KERRIA)
  await roomsSettled(page)
  await page.getByTestId('draft-my-house').or(page.locator('.actions button').last()).first().click()
  await page.getByTestId('changes-left').waitFor({ timeout: 60000 })
  await page.waitForTimeout(1200)
  const more = page.getByTestId('changes-more')
  assert.equal(await more.isVisible(), false)
  await page.screenshot({ path: `${OUT}/u14-changes-note-1440.png` })
  await page.getByTestId('changes-info').hover()
  await more.waitFor({ state: 'visible', timeout: 5000 })
  await page.screenshot({ path: `${OUT}/u14-changes-info-hover-1440.png` })
  assert.match((await page.getByTestId('changes-note').innerText()).replace(/\s+/g, ' '), /doesn't use one\. Only a change/)
  assert.deepEqual(errors, [])
})
