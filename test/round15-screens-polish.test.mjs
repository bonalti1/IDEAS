// Fix round 15, polish on the phone (390 x 844), in English and Spanish:
//   - the names under "More styles soon" never touch (CRAFTSMAN ran into TRANSITIONAL)
//   - the lot's sides on "Is this your lot?" are a list, one side to a line (they ran together)
// (The line under a change the chat made is in test/round15-screens-phone.test.mjs.)
// The office API answers from the recordings; nothing reaches the internet. Skips when no Chrome is found.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { skip, OUT, KERRIA, setup, signIn } from './round15-screens-helpers.mjs'

for (const lang of ['en', 'es']) {
  test(`polish (${lang}, 390): the style names do not touch, and the lot's sides are one to a line`, { skip, timeout: 300000 }, async (t) => {
    const { open, errors } = await setup(t)
    const page = await open([390, 844], { lang })
    await signIn(page, 'Kim Phone', `kim.${lang}@example.com`)
    await page.locator('#start-address').fill(KERRIA)
    await page.locator('#start-address').locator('xpath=ancestor::*[contains(@class,"card")][1]').locator('button.btn-primary').last().click()
    const sides = page.getByTestId('lot-sides')
    await sides.waitFor({ timeout: 30000 })
    await sides.scrollIntoViewIfNeeded()
    await page.waitForTimeout(500)
    await page.getByTestId('parcel-card').screenshot({ path: `${OUT}/polish-lot-sides-${lang}-390.png` })
    const lines = await sides.evaluate((el) => [...el.children].map((c) => ({ text: c.textContent, top: Math.round(c.getBoundingClientRect().top) })))
    const sideLines = lines.slice(0, 4)
    assert.equal(new Set(sideLines.map((l) => l.top)).size, sideLines.length, `each side on its own line: ${JSON.stringify(sideLines)}`)
    await page.getByTestId('parcel-yes').click()
    await page.waitForTimeout(600)
    await page.getByTestId('lot-next').click()
    const soon = page.getByTestId('styles-soon')
    await soon.waitFor({ timeout: 20000 })
    await soon.scrollIntoViewIfNeeded()
    await page.waitForTimeout(400)
    await soon.screenshot({ path: `${OUT}/polish-style-names-${lang}-390.png` })
    // the words of each name, measured as drawn: no two names closer than 8 px side by side on the same row
    const boxes = await soon.evaluate((el) =>
      [...el.querySelectorAll('li')].map((li) => {
        const r = document.createRange()
        const text = [...li.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim())
        r.selectNodeContents(text)
        const rects = [...r.getClientRects()]
        return { name: text.textContent.trim(), left: Math.min(...rects.map((q) => q.left)), right: Math.max(...rects.map((q) => q.right)), top: Math.min(...rects.map((q) => q.top)), bottom: Math.max(...rects.map((q) => q.bottom)), inside: li.scrollWidth <= li.clientWidth + 1 }
      }),
    )
    for (const b of boxes) assert.ok(b.inside, `${b.name} fits its place`)
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]
        const b = boxes[j]
        const sameRow = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2
        if (!sameRow) continue
        const gap = Math.max(b.left - a.right, a.left - b.right)
        assert.ok(gap >= 8, `"${a.name}" and "${b.name}" are ${Math.round(gap)} px apart`)
      }
    assert.deepEqual(errors, [])
  })
}
