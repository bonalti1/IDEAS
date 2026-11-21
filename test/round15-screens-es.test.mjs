// Fix round 15, U15 (the screens): a homeowner reading Spanish meets no English. Round 13's scan caught only the
// English sentences the dictionary knows; this one reads every word on every Spanish screen (the page, the titles
// and labels, the 3D tags and the drawings' own words) against a list of English words, at 1440 and 390 px, on a
// lot that fits (Kerria) and a tight one (Kiskadee). What the homeowner typed (their address, their email, their own
// chat lines), county records shown as they are (legal descriptions in capitals) and street and place names are theirs.
// It also checks the screens say "tú" (never "usted"), and that "plat" and "deslinde" are explained once in plain words.
// The office API answers from the recordings; nothing reaches the internet. Skips when no Chrome is found.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { skip, OUT, KERRIA, KISKADEE, setup, signIn, roomsSettled } from './round15-screens-helpers.mjs'
import { es } from '../src/draft/lib/i18n.js'

// English words a Spanish reader would trip over (none of them is also a Spanish word)
export const ENGLISH = ['the', 'and', 'of', 'your', 'with', 'for', 'from', 'via', 'to', 'is', 'this', 'that', 'it', 'on', 'in', 'by', 'at', 'or', 'you', 'we', 'our', 'my', 'are', 'not', 'Porch', 'Porches', 'Rear', 'Front', 'Bedroom', 'Bedrooms', 'Bath', 'Baths', 'Kitchen', 'Garage', 'Living', 'Dining', 'Office', 'Closet', 'Laundry', 'Pantry', 'Primary', 'Room', 'Rooms', 'Lot', 'House', 'Plan', 'Change', 'Changes', 'Free', 'Sign', 'Appraisal', 'District', 'County', 'Style', 'Modern', 'Farmhouse', 'Craftsman', 'Hill', 'Country', 'Mid-Century', 'Coastal', 'Tuscan', 'Transitional', 'Spanish', 'story', 'stories', 'feet', 'ft', 'sf', 'Hall', 'Patio', 'Covered', 'Foyer', 'Mud', 'Linen', 'Storage', 'Hallway', 'Half', 'Mini', 'Draft', 'Send', 'Site', 'Reset', 'Roof', 'Sun', 'Back', 'Next', 'Step', 'Yes', 'None', 'Type', 'Upload', 'survey', 'Survey', 'Unincorporated', 'unincorporated', 'design', 'team', 'Lead', 'Drafter', 'drafter', 'homes', 'built', 'See']
const WORD_RE = new RegExp(`(?<![\\p{L}\\d'’-])(${ENGLISH.join('|')})(?![\\p{L}'’-])`, 'u')
// the drawings write in capitals: there every word is checked whatever its case
const DRAWING_RE = new RegExp(WORD_RE.source, 'iu')

/** Runs in the page: every word a homeowner can read or hear now, with where it is and whether it is their own. */
function readPage() {
  const shown = (el) => {
    if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  // the homeowner's own words, the brand's name (marked translate="no"), and the switch whose label names English for
  // a reader of English
  const own = (el) => !!el.closest('.dh-email, .dh-account-email, .msg.you, input, textarea, [data-own], [translate="no"], [data-testid="lang-switch"]')
  const out = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement
    const text = n.textContent.replace(/\s+/g, ' ').trim()
    if (!el || !text || el.closest('script, style, canvas, option') || !shown(el)) continue
    out.push({ text, where: el.getAttribute('data-testid') || el.closest('[data-testid]')?.getAttribute('data-testid') || el.tagName.toLowerCase(), own: own(el) })
  }
  for (const el of document.querySelectorAll('[title], [placeholder], [aria-label], [alt]')) {
    if (!shown(el)) continue
    for (const a of ['title', 'placeholder', 'aria-label', 'alt']) {
      const text = (el.getAttribute(a) || '').trim()
      if (text) out.push({ text, where: `${el.getAttribute('data-testid') || el.tagName.toLowerCase()} ${a}`, own: el.matches('[data-testid="lang-switch"]') })
    }
  }
  // the selected choice of each list (the others are read when the list is opened, below)
  for (const s of document.querySelectorAll('select')) if (shown(s) && s.selectedIndex >= 0) out.push({ text: s.options[s.selectedIndex].textContent.trim(), where: `select ${s.id}`, own: false })
  return out
}
/** The homeowner's own words and the county's and the streets' names are not English to translate. */
function names(text, extra) {
  let t = ` ${text} `
  for (const n of extra) t = t.split(n).join(' ')
  return t
    .replace(/\b[\dA-Z][\dA-Z.,'&#/-]*(?:\s+[\dA-Z][\dA-Z.,'&#/-]*)+\b/g, ' ') // county records in capitals
    .replace(/\b\d+\s+(?:[NSEW]\.?\s+)?[\p{L}\d]+(?:\s+[\p{L}]+)?\s+(?:Ave|St|Ln|Rd|Dr|Blvd|Ct|Cir|Way|Pkwy|Hwy)\b\.?/gu, ' ')
    .replace(/\b(?:[NSEW]\s+)?[\p{L}\d]+\s+(?:Ave|St|Ln|Rd|Dr|Blvd|Ct|Cir|Way)\b\.?/gu, ' ')
    .replace(/South Texas Builders|Rio Grande City|Rio Grande Valley|McAllen|Mission|Hidalgo|Cameron|Willacy|Starr|Texas|TX|FEMA|IRC|STB|RGV911|Draft House|DRAFT HOUSE/g, ' ')
}

for (const [w, h] of [
  [1440, 900],
  [390, 844],
]) {
  test(`U15 at ${w}: every word on the Spanish screens is Spanish, lot to draft, on Kerria and on Kiskadee`, { skip, timeout: 600000 }, async (t) => {
    const { open, errors } = await setup(t)
    const found = []
    const page = await open([w, h], { lang: 'es' })
    const look = async (step) => {
      await page.waitForTimeout(700)
      const read = async (tag) => {
        for (const item of await page.evaluate(readPage)) {
          if (item.own) continue
          const m = names(item.text, ['garza-site-plan.png', 'rosa.es', '@example.com']).match(WORD_RE)
          if (m) found.push(`${step}${tag}: "${m[1]}" in "${item.text.slice(0, 100)}" (${item.where})`)
        }
      }
      await read('')
      // folded panels open, and every list's choices
      await page.evaluate(() => document.querySelectorAll('details:not(.dh-account):not([open])').forEach((d) => (d.open = true)))
      await page.waitForTimeout(250)
      await read(' (panels open)')
      for (const o of await page.evaluate(() => [...document.querySelectorAll('select option')].map((o) => o.textContent.trim()))) {
        const m = names(o, []).match(WORD_RE)
        if (m) found.push(`${step} (list): "${m[1]}" in "${o}"`)
      }
      await page.evaluate(() => document.querySelectorAll('details:not(.dh-account)[open]').forEach((d) => (d.open = false)))
      if (process.env.SHOTS) await page.screenshot({ path: `${OUT}/u15-es-${w}-${step}.png` })
    }
    await page.locator('#signin-email').waitFor({ timeout: 20000 })
    await look('01-first-screen')
    const text = await page.locator('#root').innerText()
    // "plat" and "deslinde" are explained once, in plain words, where a plat is first asked for
    await signIn(page, 'Rosa Dueña', `rosa.es.${w}@example.com`)
    await look('02-start')
    const start = await page.locator('.start').innerText()
    assert.match(start, /El plat es [^.]+\./, '"plat" is explained in plain words on the first screen')
    assert.match(start, /el deslinde es [^.]+\./i, '"deslinde" is explained in plain words on the first screen')
    assert.doesNotMatch(text + start, /\busted\b|\bsu correo\b/i, 'tú, not usted')
    for (const [address, name] of [
      [KERRIA, 'kerria'],
      [KISKADEE, 'kiskadee'],
    ]) {
      if (name === 'kiskadee') {
        await page.locator('a.brand').click()
        await page.locator('#start-address').waitFor({ timeout: 20000 })
      }
      await page.locator('#start-address').fill(address)
      await page.locator('#start-address').locator('xpath=ancestor::*[contains(@class,"card")][1]').locator('button.btn-primary').last().click()
      await page.getByTestId('parcel-card').waitFor({ timeout: 30000 })
      await page.waitForTimeout(800)
      await look(`03-${name}-lot-offered`)
      await page.getByTestId('parcel-yes').click()
      await page.waitForTimeout(800)
      await look(`04-${name}-lot-taken`)
      await page.getByTestId('lot-next').click()
      await page.getByTestId('style-farmhouse').waitFor({ timeout: 20000 })
      await look(`05-${name}-style`)
      await page.getByTestId('style-farmhouse').click()
      await page.locator('.actions button.btn-primary').last().click()
      await page.getByTestId('lot-strip').waitFor({ timeout: 20000 })
      await roomsSettled(page)
      await page.waitForTimeout(1200)
      await look(`06-${name}-rooms`)
      if (name === 'kerria') {
        await page.getByTestId('draft-my-house').click()
        await page.getByTestId('changes-left').waitFor({ timeout: 60000 })
        await page.locator('[data-testid="scene-loading"]').waitFor({ state: 'detached', timeout: 30000 }).catch(() => {})
        await page.waitForTimeout(1500)
        await look(`07-${name}-draft-3d`)
        // the drawings' own words: the plan and the site plan
        for (const view of [0, 1]) {
          await page.locator('.viewport-views button').nth(view).click()
          await page.waitForTimeout(1200)
          for (const s of await page.evaluate(() => [...document.querySelectorAll('.viewport svg text')].map((x) => x.textContent.trim()).filter(Boolean))) {
            // the line with the homeowner's name and address is theirs; street names are names
            if (/Rosa Dueña|Kerria Ave/.test(s)) continue
            const m = s.replace(/\b[A-Z0-9]+ (ST|RD|AVE|LN|BLVD|DR)\b/g, ' ').replace(/\b(REF|W|D|N)\b/g, ' ').match(DRAWING_RE)
            if (m) found.push(`07-${name}-drawing ${view ? 'site' : 'plan'}: "${m[1]}" in "${s}"`)
          }
        }
        await page.getByTestId('changes-info').click()
        await look(`08-${name}-draft-note-open`)
      }
    }
    assert.deepEqual(errors, [])
    const list = [...new Set(found)]
    assert.deepEqual(list, [], `${list.length} English words on the Spanish screens:\n  ${list.join('\n  ')}`)
  })
}

test('U15 (unit): the Spanish screens say "tú": no "usted", "su casa" or usted commands in the dictionary', () => {
  // "usted", "su casa" said to the homeowner, or a command in the usted form at the start of a sentence ("Escriba",
  // "Elija"); "que un dibujante lo revise" and "la casa sobre el lote" are not usted
  const USTED = /\busted(es)?\b|\bsu (casa|lote|plano|correo|cuenta|direcci[oó]n)\b|(^|[.;:¿¡]\s*)(Escriba|Ingrese|Elija|Suba|Envíe|Haga|Tome|Pulse|Toque|Agregue|Revise|Llame|Intente|Espere|Indique|Ponga|Pruebe|Regrese|Inicie|Confirme|Marque|Busque|Pida)\b/
  const bad = Object.entries(es).filter(([, v]) => USTED.test(v)).map(([k, v]) => `${k} → ${v}`)
  assert.deepEqual(bad, [])
  // the style names a homeowner picks from are Spanish, not English left as they were
  for (const k of ['Modern Farmhouse', 'Hill Country', 'Craftsman', 'Mid-Century', 'Porches']) assert.doesNotMatch(es[k], new RegExp(`^${k}$|Farmhouse`), `${k} → ${es[k]}`)
})
