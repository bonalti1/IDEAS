// Fix round 13, item 1 in a browser: with a Spanish browser (es-MX) the homeowner flow opens in Spanish with no
// switch tapped, and stays Spanish on every step, at 1440 px and at 390 px. On each step the words on the page
// (and the titles, placeholders and spoken labels) hold none of the English the dictionary knows, no dollar sign,
// no "setback", no "NaN" or "undefined". The switch brings English back, and a reload remembers it.
// The office API answers from the recordings; nothing reaches the internet. Skips when no Chrome is found.
// With SHOTS set, each Spanish step is saved as SHOTS/es-<width>-<step>.png.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromePath, startPreview, appContext, spawnGroup, freePort, shotDir } from './browser.mjs'
import { fixtureEnv } from './server-env.mjs'
import { phoneAudit } from './phone-audit.mjs'
import { es } from '../src/draft/lib/i18n.js'

const CHROME = chromePath()
const skip = !CHROME && 'no Chrome found (set CHROME=/path/to/chrome)'
const OUT = shotDir('round13-i18n')

async function startApi(t, { port, DATA_DIR }) {
  const apiBase = `http://127.0.0.1:${port}`
  spawnGroup(t, process.execPath, ['server/index.mjs'], { env: { ...fixtureEnv, DRAFTHOUSE_CLAUDE_KEY: '', ANTHROPIC_API_KEY: '', DATABASE_URL: '', SUPABASE_URL: '', RESEND_API_KEY: '', DRAFTHOUSE_APP_KEY: '', DRAFTHOUSE_WORKER_KEY: 'wk', DRAFTHOUSE_DRAFTERS: 'maria@drafthouse.test', REGRID_API_TOKEN: '', PARCEL_DAILY_CHECK: '0', PARCEL_FIELD_CHECK: '0', PORT: String(port), DATA_DIR, ALLOWED_ORIGINS: '*' } })
  for (let i = 0; i < 150; i++) {
    try {
      await fetch(`${apiBase}/api/health`)
      return { apiBase }
    } catch {
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  throw new Error('the office API did not start')
}

// ── the English a Spanish reader must not meet ──────────────────────────────────────────────────────
// Built from the English side of the dictionary: every sentence of two words or more whose Spanish is different,
// as a pattern ({name} is anything, {n|change|changes} either form). Plus the single words the round names.
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const SAME_WORDS = new Set(['Hill Country', 'Mid-Century'])
const TELLTALES = Object.keys(es)
  .filter((k) => es[k] !== k && !SAME_WORDS.has(k))
  .map((k) => {
    const fixed = k.replace(/\{\w+\|([^|{}]*)\|([^|{}]*)\}/g, '$2').replace(/\{\w+\}/g, ' ').replace(/<\/?b>/g, '')
    const words = fixed.split(/[^A-Za-z']+/).filter((w) => w.length > 1)
    if (words.length < 2 || fixed.replace(/[^A-Za-z]/g, '').length < 8) return null
    const body = k
      .split(/(\{\w+\|[^|{}]*\|[^|{}]*\}|\{\w+\}|<\/?b>)/)
      .map((part) => {
        const pl = part.match(/^\{\w+\|([^|{}]*)\|([^|{}]*)\}$/)
        if (pl) return `(?:${esc(pl[1])}|${esc(pl[2])})`
        if (/^\{\w+\}$/.test(part)) return '[^\\n]{0,80}?'
        if (/^<\/?b>$/.test(part)) return ''
        return esc(part).replace(/ /g, '\\s+')
      })
      .join('')
    return { key: k, re: new RegExp(`(?<![A-Za-z])${body}(?![A-Za-z])`) }
  })
  .filter(Boolean)
// single words and short phrases a homeowner would spot at once
// (not "County" or "City": they are in names that stay as they are, "Hidalgo County Appraisal District", "Rio Grande City")
const WORDS = ['Sign out', 'Bedrooms', 'Full bathrooms', 'Garage', 'changes left', 'change left', 'Your lot', 'Pick a style', 'What goes in the house', 'Shape it', 'Ready to hand off', 'Back', 'Continue', 'Address', 'Email', 'Stories', 'Living area', 'Rooms', 'Style', 'Summary', 'Change', 'Reset', 'Roof', 'Plan', 'Site', 'Step', 'Office', 'Zoning', 'Front', 'Rear', 'Side', 'Your houses', 'Find my lot', 'Draft my house', 'Send to drafters', 'Undo last change', 'Drawing your house', 'free changes']
const WORD_RES = WORDS.map((w) => ({ key: w, re: new RegExp(`(?<![A-Za-z])${esc(w)}(?![A-Za-z])`) }))

/** Runs in the page: every piece of text a homeowner can read or hear right now, without the drawings. */
function wordsOnPage() {
  const seen = (el) => {
    if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const out = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement
    const text = n.textContent.replace(/\s+/g, ' ').trim()
    if (!el || !text || el.closest('svg, canvas, script, style') || !seen(el)) continue
    out.push({ text, where: el.getAttribute('data-testid') || (typeof el.className === 'string' && el.className.split(' ')[0]) || el.tagName.toLowerCase(), chat: !!el.closest('.log .msg'), own: !!el.closest('.dh-email, .dh-account-email, .msg.you, .house-main, input') })
  }
  for (const el of document.querySelectorAll('[title], [placeholder], [aria-label], [alt]')) {
    if ((el.closest('svg, canvas') && !el.matches('svg')) || !seen(el)) continue
    for (const a of ['title', 'placeholder', 'aria-label', 'alt']) {
      const text = (el.getAttribute(a) || '').trim()
      if (text) out.push({ text, where: `${el.getAttribute('data-testid') || el.tagName.toLowerCase()} ${a}`, chat: !!el.closest('.log .msg'), own: false })
    }
  }
  return out
}

for (const width of [1440, 390]) {
  test(`screens ${width}: a Spanish browser gets the whole homeowner flow in Spanish; the switch brings English back and is remembered`, { skip, timeout: 600000 }, async (t) => {
    const phone = width < 600
    const appBase = await startPreview(t)
    const api = await startApi(t, { port: await freePort(), DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dh-r13-i18n-')) })
    const { chromium } = await import('playwright-core')
    const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })
    t.after(() => browser.close())
    const ctx = await appContext(browser, api.apiBase, { viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 }, ...(phone ? { deviceScaleFactor: 2, isMobile: true, hasTouch: true } : {}), locale: 'es-MX' })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    const sent = [] // what the Draft step posts to the office
    page.on('request', (r) => {
      if (r.method() === 'POST' && /\/api\/projects\/[^/]+\/change$/.test(r.url())) sent.push(JSON.parse(r.postData() || '{}'))
    })
    const found = []
    let chatted = false

    // one step: the words on the page (then again with every folded panel open), the switch, a picture
    const check = async (step, { shot = true } = {}) => {
      await page.waitForTimeout(700)
      const read = async (tag) => {
        const words = await page.evaluate(wordsOnPage)
        assert.ok(words.length > 5, `${step}: the page has words on it`)
        for (const w of words) {
          if (/\$|setback|\bNaN\b|\bundefined\b|\bnull\b|\[object /i.test(w.text)) found.push(`${step}${tag}: "${w.text.slice(0, 90)}" (${w.where})`)
          // what the homeowner typed themselves (their email, their address, their own chat line) is theirs
          if (w.own) continue
          // a reply the plan code wrote is Spanish once lib/es.js lands (sentence() in lib/i18n.js); the screens' own words are checked
          if (w.chat && chatted) continue
          for (const tale of [...TELLTALES, ...WORD_RES]) if (tale.re.test(w.text)) found.push(`${step}${tag}: English "${tale.key.slice(0, 60)}" in "${w.text.slice(0, 90)}" (${w.where})`)
        }
        return words
      }
      const words = await read('')
      assert.equal(await page.evaluate(() => document.documentElement.lang), 'es', `${step}: <html lang> says Spanish`)
      // the switch is on this step: in the header, or on a phone with someone signed in, in the account menu
      const sw = page.getByTestId('lang-switch')
      assert.equal(await sw.count(), 1, `${step}: one language switch on the page`)
      assert.equal(await sw.getAttribute('data-lang'), 'es')
      if (await sw.isVisible()) assert.ok(await page.locator('.dh-head').getByTestId('lang-switch').count(), `${step}: the switch is in the header`)
      else assert.ok(phone && (await page.locator('details.dh-account').getByTestId('lang-switch').count()), `${step}: on a phone the switch is in the account menu`)
      if (shot && process.env.SHOTS) await page.screenshot({ path: `${OUT}/es-${width}-${step}.png` })
      // the panels that open on a tap (the rules used for this lot, "more"): open, they read in Spanish too
      const opened = await page.evaluate(() => {
        const list = [...document.querySelectorAll('details:not(.dh-account):not([open])')]
        list.forEach((d) => (d.open = true))
        return list.length
      })
      if (opened) {
        await page.waitForTimeout(300)
        await read(' (panels open)')
        await page.evaluate(() => document.querySelectorAll('details:not(.dh-account)[open]').forEach((d) => (d.open = false)))
      }
      return words.map((w) => w.text).join('\n')
    }

    // ── the first screen, nobody signed in: Spanish at once, the switch in the header ──
    await page.goto(appBase, { waitUntil: 'domcontentloaded' })
    await page.locator('#signin-email').waitFor({ timeout: 20000 })
    let text = await check('01-start')
    assert.match(text, /Tu lote\. Tu estilo\./)
    assert.match(text, /Empieza con tu correo/)
    assert.ok(await page.locator('.dh-head').getByTestId('lang-switch').isVisible(), 'before sign-in the switch is in the header, at any width')
    assert.equal(await page.locator('#signin-email').getAttribute('placeholder'), 'tu@ejemplo.com')
    if (phone) assert.deepEqual(await page.evaluate(phoneAudit), [], 'the first screen with the switch in the header fits the phone')

    if (await page.locator('#signin-name').count()) await page.locator('#signin-name').fill('Rosa Dueña')
    await page.locator('#signin-email').fill(`rosa.${width}@example.com`)
    await page.locator('#signin-email').press('Enter')
    await page.locator('#start-address').waitFor({ timeout: 20000 })
    text = await check('02-start-signed-in')
    assert.match(text, /¿Dónde está el lote\?/)
    assert.match(text, /Buscar mi lote/)

    // ── the lot ──
    await page.locator('#start-address').fill('1201 Kerria Ave, McAllen, TX 78501')
    await page.locator('#start-address').locator('xpath=ancestor::*[contains(@class,"card")][1]').locator('button').last().click()
    await page.getByTestId('parcel-card').waitFor({ timeout: 30000 })
    text = await check('03-lot')
    assert.match(text, /Tu lote/)
    assert.match(text, /¿Este es tu lote\?/)
    await page.getByTestId('parcel-yes').click()
    await page.waitForTimeout(800)
    text = await check('04-lot-taken')
    assert.match(text, /Tu lote, según el mapa de lotes del condado/)
    assert.match(text, /Espacio que la ciudad mantiene libre a lo largo de cada orilla/)
    if (phone) assert.equal(await page.getByTestId('step-name').innerText(), 'PASO 1 DE 5 · LOTE')

    // ── the style ──
    await page.getByTestId('lot-next').click()
    await page.getByTestId('style-farmhouse').waitFor({ timeout: 20000 })
    text = await check('05-style')
    assert.match(text, /Elige un estilo/)
    await page.getByTestId('style-farmhouse').click()
    await page.locator('.actions button').last().click()

    // ── the rooms ──
    await page.getByTestId('lot-strip').waitFor({ timeout: 20000 })
    await page.getByTestId('auto-start').or(page.locator('.fine')).first().waitFor({ timeout: 90000 })
    const draftBtn = page.locator('.actions button').last()
    for (let i = 0; i < 400 && !(await draftBtn.isEnabled()); i++) await page.waitForTimeout(250)
    text = await check('06-rooms')
    assert.match(text, /¿Qué lleva la casa\?/)
    assert.match(text, /Recámaras/)
    assert.match(text, /Baños completos/)
    assert.match(text, /Cochera/)
    assert.match(text, /pies²/)
    await draftBtn.click()

    // ── the draft ──
    await page.getByTestId('changes-left').waitFor({ timeout: 60000 })
    await page.locator('[data-testid="scene-loading"]').waitFor({ state: 'detached', timeout: 30000 }).catch(() => {})
    await page.waitForTimeout(1500)
    text = await check('07-draft')
    assert.match(text, /Dale forma/)
    assert.match(await page.getByTestId('changes-left').innerText(), /^TE QUEDAN 10 CAMBIOS$/i)
    // the step is named: under the numbers on a phone, beside each number on a wide screen
    if (phone) assert.match(text, /Paso 4 de 5 · Borrador/)
    else assert.deepEqual(await page.locator('.steps li span').allInnerTexts().then((l) => l.map((x) => x.toLowerCase())), ['lote', 'estilo', 'cuartos', 'borrador', 'enviar'])
    // round 13, item 7: one line beside the count, with the plan's own number; on the page, not under anything
    const note = page.getByTestId('changes-note')
    // (the review of PR #12 added what counts and what does not)
    assert.equal(await note.innerText(), '10 cambios gratis; si uno no se puede hacer, no cuenta Solo cuenta un cambio que el chat le hace a tu plano. Elegir tu lote y tus cuartos, tu primer borrador y deshacer no cuentan.')
    await note.scrollIntoViewIfNeeded()
    const clear = await note.evaluate((el) => {
      const r = el.getBoundingClientRect()
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      const over = [...document.querySelectorAll('.side-head, .stats, .log, .dh-head')].filter((o) => {
        const q = o.getBoundingClientRect()
        return Math.min(r.right, q.right) - Math.max(r.left, q.left) > 1 && Math.min(r.bottom, q.bottom) - Math.max(r.top, q.top) > 1
      })
      return { onTop: hit === el || el.contains(hit), inside: r.left >= 0 && r.right <= document.documentElement.clientWidth + 1, over: over.map((o) => o.className), cut: el.scrollWidth > el.clientWidth + 1 }
    })
    assert.deepEqual(clear, { onTop: true, inside: true, over: [], cut: false }, 'the note is on the page, whole, over nothing')
    if (phone) assert.deepEqual((await page.evaluate(phoneAudit)).filter((f) => /changes-note|lang-switch/.test(f)), [])
    await page.evaluate(() => window.scrollTo(0, 0))

    // the suggestion chips are Spanish, and a tap sends what the chip says, with the language the homeowner reads
    const chip = page.locator('.chips button').first()
    const chipText = (await chip.innerText()).trim()
    assert.equal(chipText, 'Haz la cocina más grande')
    await chip.click()
    await page.locator('.msg.you').last().waitFor({ timeout: 10000 })
    await page.locator('.msg.thinking').waitFor({ state: 'detached', timeout: 60000 }).catch(() => {})
    await page.waitForTimeout(800)
    chatted = true
    assert.equal((await page.locator('.msg.you').last().innerText()).trim(), chipText)
    assert.equal(sent.length, 1, 'one request went to the office')
    assert.equal(sent[0].text, chipText, 'the chip is sent as it is shown')
    assert.equal(sent[0].lang, 'es', 'the office is told the homeowner reads Spanish')
    assert.equal((await page.locator('.msg.house').count()) >= 1, true, 'the office answered (today\'s office takes the extra key)')
    await check('07b-draft-after-chat', { shot: false })

    // ── the send step ──
    await page.locator('.actions button').last().click()
    await page.getByTestId('lot-waiting').waitFor({ timeout: 30000 })
    text = await check('08-send')
    assert.match(text, /¿Listo para entregarlo\?/)
    assert.match(text, /Nuestro dibujante revisa tu lote primero/)
    assert.match(text, /Lo que cuesta/)
    assert.match(text, /El costo lo vemos contigo en tu reunión con la oficina de South Texas Builders\./)

    assert.deepEqual(errors, [], 'no page error on the way')
    assert.deepEqual([...new Set(found)], [], `${new Set(found).size} things a Spanish reader should not meet:\n  ${[...new Set(found)].join('\n  ')}`)

    // ── the switch: English is back at once ──
    const tapSwitch = async () => {
      const sw = page.getByTestId('lang-switch')
      if (!(await sw.isVisible())) await page.locator('details.dh-account > summary').click()
      await sw.click()
      await page.waitForTimeout(500)
    }
    await tapSwitch()
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'en')
    assert.equal(await page.getByTestId('lang-switch').getAttribute('data-lang'), 'en')
    let english = (await page.evaluate(wordsOnPage)).map((w) => w.text).join('\n')
    assert.match(english, /Ready to hand off\?/)
    assert.match(english, /Our drafter will check your lot first/)
    // "Sign out" is in the header, or on a phone in the account menu
    const signOut = async () => (phone ? await page.locator('details.dh-account').textContent() : english)
    assert.match(await signOut(), /Sign out/)
    assert.doesNotMatch(await signOut(), /Salir/)
    if (phone) assert.match(english, /Step 5 of 5 · Send/)
    assert.match(english, /\d+ changes? left on this plan/)
    assert.doesNotMatch(english, /¿Listo para entregarlo\?|Paso 5 de 5|Nuestro dibujante revisa tu lote primero/)

    // ── a reload: the choice is remembered, though the browser still asks for Spanish ──
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByTestId('lang-switch').waitFor({ state: 'attached', timeout: 20000 })
    await page.getByTestId('step-name').waitFor({ state: 'attached', timeout: 30000 })
    await page.waitForTimeout(1500)
    assert.equal(await page.evaluate(() => navigator.language), 'es-MX')
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'en', 'the choice made with the switch is remembered')
    english = (await page.evaluate(wordsOnPage)).map((w) => w.text).join('\n')
    assert.match(await signOut(), /Sign out/)
    assert.match(english, /Ready to hand off\?|Shape it|Your houses/)
    assert.doesNotMatch(english, /Paso \d de 5|¿Listo para entregarlo\?/)
    // and back: Spanish again, remembered the same way
    await tapSwitch()
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'es')
    assert.equal(await page.evaluate(() => localStorage.getItem('dh.lang')), 'es')
    assert.deepEqual(errors, [], 'no page error after the switch')
  })
}
