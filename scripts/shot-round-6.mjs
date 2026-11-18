// Screenshots for fix round 6 (the round-5 run, with the 430 x 932 set completed: narrow plan, narrow site, review),
// at 1440 and at a true 390 x 844 and 430 x 932: every step of the
// client flow on the phone, the McAllen site plan with its driveway, the mud room zoomed, the narrow
// plan's rear, the PDF page zoomed on the baths (and its fonts), the phone chat, the new options and
// an option opened full size, the tabloid on two sheets, the drafter's review.
//   node scripts/shot-round-6.mjs <outDir> [appUrl]     (office API behind the app, local sign-in)
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { generateRooms, DEFAULT_PROGRAM } from '../src/draft/lib/layout.js'
import { buildDesign } from '../src/draft/lib/contract.js'
import { planSVG, cropSVG } from '../src/draft/lib/plan-svg.js'
import { STYLES } from '../src/draft/lib/styles.js'
import { buildLot } from '../src/draft/lib/lot.js'

const out = process.argv[2] || 'shots/round-6'
const APP = (process.argv[3] || 'http://localhost:4173').replace(/\/$/, '')
const RUN = Date.now().toString(36).slice(-4)
fs.mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium' })
const errors = []
const notes = []
const note = (s) => {
  notes.push(s)
  console.log('  ' + s)
}
const ctxFor = (viewport) => browser.newContext({ viewport, deviceScaleFactor: viewport.width < 500 ? 2 : 1, isMobile: viewport.width < 500, hasTouch: viewport.width < 500, acceptDownloads: true })

async function signIn(page, tag, who = 'Round Six') {
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)
  await page.locator('#signin-name').fill(who)
  await page.locator('#signin-email').fill(`r6-${RUN}-${tag}@example.com`)
  await page.getByRole('button', { name: /Continue|Email me/ }).click()
  await page.locator('#start-address').waitFor({ timeout: 20000 })
}
async function toLot(page, address) {
  await page.locator('#start-address').fill(address)
  await page.getByRole('button', { name: 'Find my lot' }).click()
  await page.locator('#lot-city').waitFor({ timeout: 20000 })
  await page.waitForTimeout(3000)
}
async function toRooms(page) {
  const confirm = page.locator('#lot-confirm')
  if (await confirm.count()) await confirm.check()
  await page.getByRole('button', { name: /pick a style/ }).click()
  await page.waitForTimeout(500)
}
async function toDraft(page) {
  await page.getByRole('button', { name: /Modern Farmhouse/ }).click()
  await page.getByRole('button', { name: /Next, rooms/ }).click()
  await page.waitForTimeout(600)
  for (const name of ['Try that', /^Use [\d,]+ sf$/]) {
    const b = page.getByRole('button', { name })
    if (await b.count()) {
      await b.first().click()
      await page.waitForTimeout(400)
    }
  }
  await page.getByRole('button', { name: /Draft my house/ }).click()
  await page.getByText(/changes? left/).waitFor({ timeout: 30000 })
  await page.waitForTimeout(2500)
}
// the house's newest reply, once it has stopped thinking
const lastReply = async (page) => {
  await page.locator('.msg.thinking').waitFor({ state: 'hidden', timeout: 90000 })
  await page.waitForTimeout(900)
  const last = page.locator('.msg.house').last()
  return { text: (await last.textContent()).trim(), held: (await last.getAttribute('class')).includes('held') }
}
const ask = async (page, text) => {
  await page.getByPlaceholder(/change|Move the laundry/).fill(text)
  await page.getByRole('button', { name: 'Change', exact: true }).click()
  return lastReply(page)
}
const run = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8' })

/** The PDF's fonts and its label words: no serif fallback, the room names present. */
function checkPDF(file, label) {
  const fonts = run('pdffonts', [file]).stdout || ''
  const names = fonts.split('\n').slice(2).map((l) => l.trim().split(/\s+/)[0]).filter(Boolean)
  const serif = names.filter((n) => /Times|Serif/i.test(n))
  const embedded = fonts.split('\n').slice(2).filter((l) => /LiberationSans/.test(l) && /\byes\b/.test(l)).length
  note(`${label}: fonts ${names.join(', ') || 'none'} · Liberation Sans embedded: ${embedded ? 'yes' : 'NO'} · serif fallback: ${serif.length ? serif.join(', ') : 'none'}`)
  const words = run('pdftotext', ['-bbox', '-f', '1', '-l', '1', file, '-']).stdout || ''
  const found = ['KITCHEN', 'PRIMARY', 'BATH', 'BEDROOM', 'GARAGE'].filter((w) => words.includes(`>${w}<`))
  note(`${label}: label words found on page 1: ${found.join(', ')}`)
  return { serif: serif.length, embedded }
}

async function flow(viewport, tag) {
  const ctx = await ctxFor(viewport)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`))
  const phone = viewport.width < 500
  const shot = async (name, opts = {}) => {
    await page.waitForTimeout(opts.wait ?? 900)
    await page.screenshot({ path: `${out}/${tag}-${name}.png`, fullPage: !!opts.full })
    console.log('saved', `${tag}-${name}`)
  }
  await signIn(page, tag)
  if (phone) await shot('00a-start')
  await toLot(page, '1300 W Nolana Ave, McAllen, TX 78504')
  if (phone) await shot('00b-lot', { full: true })
  await toRooms(page)
  if (phone) await shot('00c-style')
  await page.getByRole('button', { name: /Modern Farmhouse/ }).click()
  await page.getByRole('button', { name: /Next, rooms/ }).click()
  await page.waitForTimeout(600)
  if (phone) await shot('00d-rooms', { full: true })
  for (const name of ['Try that', /^Use [\d,]+ sf$/]) {
    const b = page.getByRole('button', { name })
    if (await b.count()) {
      note(`${tag}: the rooms step offered "${(await b.first().textContent()).trim()}" and the flow took it`)
      await b.first().click()
      await page.waitForTimeout(400)
    }
  }
  await page.getByRole('button', { name: /Draft my house/ }).click()
  await page.getByText(/changes? left/).waitFor({ timeout: 30000 })
  await page.waitForTimeout(2500)
  const header = (await page.locator('.viewport-tag').textContent().catch(() => '')).trim()
  note(`${tag}: first draft "${header}"`)
  await page.getByRole('button', { name: 'Site', exact: true }).click()
  await shot('01-site-plan', { wait: 1400 })
  const r2 = await ask(page, 'make the garage 3 cars')
  note(`${tag}: "make the garage 3 cars" → ${r2.held ? 'REFUSED' : 'applied'}: ${r2.text.slice(0, 110)}`)
  if (phone) {
    // the chat: the user's bubble and the price note each in a row of its own
    await page.locator('.chat .log').scrollIntoViewIfNeeded()
    // the log is scrolled to its newest line; show the whole user bubble and the reply under it
    await page.locator('.msg.you').last().evaluate((el) => {
      const log = el.closest('.log')
      if (log) log.scrollTop = Math.max(0, el.offsetTop - log.offsetTop - 6)
    })
    await page.waitForTimeout(300)
    await shot('02-phone-chat')
    // the price note sits above the chat log in a row of its own; the user's bubble is inside the log (which scrolls)
    const you = page.locator('.msg.you').last()
    const price = page.locator('.price-line')
    const log = page.locator('.chat .log')
    const [yb, pb, lb] = await Promise.all([you.boundingBox(), price.boundingBox(), log.boundingBox()])
    const rows = pb && lb && (lb.y >= pb.y + pb.height - 1 || lb.y + lb.height <= pb.y + 1)
    const inside = yb && lb && yb.y >= lb.y - 1 && yb.y + yb.height <= lb.y + lb.height + 1
    note(`${tag}: price note y ${Math.round(pb?.y)}–${Math.round(pb?.y + pb?.height)}, chat log y ${Math.round(lb?.y)}–${Math.round(lb?.y + lb?.height)} → ${rows ? 'separate rows' : 'OVERLAP'}; user bubble y ${Math.round(yb?.y)}–${Math.round(yb?.y + yb?.height)} ${inside ? 'whole, inside the log' : 'CLIPPED'}`)
    const bar = await page.locator('.viewport-views').boundingBox()
    const stage = await page.locator('.viewport-stage').boundingBox()
    note(`${tag}: Plan/Site/3D bar y ${Math.round(bar?.y)}–${Math.round(bar?.y + bar?.height)} vs the drawing y ${Math.round(stage?.y)}–${Math.round(stage?.y + stage?.height)} → ${bar && stage && bar.y >= stage.y + stage.height - 1 ? 'its own row' : 'OVER THE DRAWING'}`)
  }
  await page.getByRole('button', { name: 'Plan', exact: true }).click()
  await shot('03-plan-3-car', { wait: 1400 })
  await page.getByRole('button', { name: '3D', exact: true }).click()
  await shot('04-3d-3-car', { wait: 1800 })
  const r3 = await ask(page, 'show me options for the garage')
  const n = await page.locator('.picker .option').count()
  const labels = await page.locator('.picker .option b').allTextContents()
  note(`${tag}: typed "show me options for the garage" → ${n} options: ${labels.join(' | ')} · ${r3.text.slice(0, 80)}`)
  await shot('05-options-garage')
  if (n) {
    // a thumbnail opens full size on a tap
    const thumb = page.locator('.picker .thumb').first()
    await thumb.scrollIntoViewIfNeeded()
    if (phone) await thumb.tap()
    else await thumb.click()
    await page.waitForTimeout(700)
    const open = await page.locator('.lightbox').count()
    note(`${tag}: tap on a thumbnail → ${open ? 'opened full size' : 'NO lightbox'}`)
    await shot('06-option-full-size')
    await page.keyboard.press('Escape').catch(() => {})
    const close = page.getByRole('button', { name: 'Close' })
    if (await close.count()) await close.click()
    await page.waitForTimeout(400)
  }
  const r4 = await ask(page, 'show me options for the bedrooms')
  note(`${tag}: "show me options for the bedrooms" → ${await page.locator('.picker .option').count()} options: ${(await page.locator('.picker').last().locator('.option b').allTextContents()).join(' | ')}`)
  await shot('07-options-wing')
  const r5 = await ask(page, 'make the house 3,000 sf')
  note(`${tag}: typed "make the house 3,000 sf" → ${r5.held ? 'REFUSED' : 'applied'}: ${r5.text.slice(0, 160)}`)
  if (r5.held) {
    // the refusal names the largest size that fits and offers it: take it
    const fix = page.locator('.fixes button').last()
    if (await fix.count()) {
      const label = await fix.textContent()
      await fix.click()
      await page.waitForTimeout(400)
      const r = await lastReply(page)
      note(`${tag}: took the offered "${label.trim()}" → ${r.held ? 'REFUSED' : 'applied'}: ${r.text.slice(0, 140)}`)
    }
  }
  const r6 = await ask(page, 'swap the office and the dining room')
  note(`${tag}: typed "swap the office and the dining room" → ${r6.held ? 'REFUSED' : 'applied'}: ${r6.text.slice(0, 110)}`)
  await page.getByRole('button', { name: /send to drafters/ }).click()
  await page.waitForTimeout(800)
  await shot('08-send', { full: true })
  if (!phone) {
    await page.getByRole('button', { name: 'Drafter package' }).click()
    await page.waitForTimeout(600)
    for (const [name, file, label] of [[/Download PDF · 24 × 36/, 'plan-24x36.pdf', 'ARCH D'], [/^11 × 17$/, 'plan-11x17.pdf', 'tabloid']]) {
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 90000 }), page.getByRole('button', { name }).click()])
      const f = path.join(out, `${tag}-${file}`)
      await dl.saveAs(f)
      const pages = +((run('pdfinfo', [f]).stdout || '').match(/Pages:\s+(\d+)/) || [])[1] || 0
      note(`${label}: ${file} ${fs.statSync(f).size.toLocaleString()} bytes, ${pages} pages`)
      checkPDF(f, label)
      run('pdftoppm', ['-r', '60', '-png', '-f', '1', '-l', pages > 2 ? '2' : '1', f, path.join(out, `${tag}-pdf-${label.replace(/\s/g, '').toLowerCase()}`)])
      if (label === 'ARCH D') {
        // the baths zoomed: the right third of the sheet at 150 dpi (the primary suite and the half bath)
        run('pdftoppm', ['-r', '150', '-png', '-f', '1', '-l', '1', '-x', '2900', '-y', '900', '-W', '1700', '-H', '1500', f, path.join(out, `${tag}-pdf-baths-zoom`)])
      }
    }
    const sendBtn = page.getByRole('button', { name: 'Send to drafters', exact: true })
    if ((await sendBtn.count()) && (await sendBtn.isEnabled())) {
      await sendBtn.click()
      await page.waitForTimeout(2500)
      const sum = page.getByRole('button', { name: /Download your summary/ }).first()
      if (await sum.count()) {
        const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), sum.click()])
        const f = path.join(out, `${tag}-summary.pdf`)
        await dl.saveAs(f)
        checkPDF(f, 'summary')
        run('pdftoppm', ['-r', '60', '-png', '-f', '1', '-l', '1', f, path.join(out, `${tag}-pdf-summary`)])
      }
    } else note(`${tag}: Send is disabled: ${await page.locator('.rules, .problems').first().textContent().catch(() => '(no reason shown)')}`)
  }
  await ctx.close()
}

async function narrowLot(viewport, tag) {
  const ctx = await ctxFor(viewport)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`${tag} narrow: ${e.message}`))
  await signIn(page, tag + '-n', 'Narrow Lot')
  await toLot(page, '500 S Cage Blvd, Pharr, TX 78577')
  const typeIn = page.getByRole('button', { name: 'Type it in' })
  if ((await typeIn.count()) && !((await typeIn.getAttribute('class')) || '').includes('on')) await typeIn.click({ force: true })
  await page.locator('#lot-width').fill('50')
  await page.locator('#lot-depth').fill('120')
  await page.locator('#lot-city').selectOption('pharr')
  await page.waitForTimeout(600)
  await toRooms(page)
  await toDraft(page)
  await page.getByRole('button', { name: 'Plan', exact: true }).click()
  await page.waitForTimeout(1400)
  await page.screenshot({ path: `${out}/${tag}-09-narrow-lot-plan.png` })
  note(`${tag}: narrow lot first draft "${(await page.locator('.viewport-tag').textContent().catch(() => '')).trim()}"`)
  await page.getByRole('button', { name: 'Site', exact: true }).click()
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${out}/${tag}-10-narrow-lot-site.png` })
  console.log('saved', `${tag}-10-narrow-lot-site`)
  await ctx.close()
}

/** Drawings rendered straight from the library and cropped: the mud room zoomed, the narrow plan's rear. */
async function crops() {
  const style = STYLES.find((s) => s.id === 'farmhouse')
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  const render = async (name, svg, w, h) => {
    const file = path.join(out, `${name}.html`)
    fs.writeFileSync(file, `<!doctype html><html><body style="margin:0;background:#fff">${svg}</body></html>`)
    await page.setViewportSize({ width: Math.ceil(w) + 2, height: Math.ceil(h) + 2 })
    await page.goto('file://' + path.resolve(file), { waitUntil: 'load' })
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${out}/${name}.png` })
    fs.unlinkSync(file)
    // the crop is drawn on a canvas sized for the whole plan: cut the blank paper off, leaving a margin
    const trim = spawnSync('convert', [`${out}/${name}.png`, '-fuzz', '2%', '-trim', '-bordercolor', 'white', '-border', '24', '+repage', `${out}/${name}.png`], { encoding: 'utf8' })
    if (trim.status !== 0) console.log('  (not trimmed: convert is not here)')
    console.log('saved', name)
  }
  const mcallen = buildLot({ kind: 'manual', width: 100, depth: 150, city: 'mcallen', frontStreet: 'W Nolana Ave', setbacks: {} })
  const p = { ...DEFAULT_PROGRAM, sqft: 2350 }
  const rooms = generateRooms(p, style, mcallen)
  const plan = planSVG(buildDesign({ rooms, program: p, style, lot: mcallen, client: 'Round Six' }))
  const mud = plan.labels.find((l) => l.id === 'mud')?.room
  if (mud) {
    const box = { x: mud.x - 110, y: mud.y - 110, w: mud.w + 220, h: mud.h + 220 }
    await render('crop-mud-room-zoom', cropSVG(plan.svg, box), box.w * 2.5, box.h * 2.5)
  }
  const pharr = buildLot({ kind: 'manual', width: 50, depth: 120, city: 'pharr', setbacks: {} })
  const pn = { ...DEFAULT_PROGRAM, beds: 4, baths: 2, halfBath: false, office: false, garage: 2, suite2: false, sqft: 2350 }
  const nrooms = generateRooms(pn, style, pharr)
  const nplan = planSVG(buildDesign({ rooms: nrooms, program: pn, style, lot: pharr, client: 'Narrow Lot' }))
  const rear = { x: 0, y: 0, w: nplan.width, h: nplan.height * 0.5 }
  await render('crop-narrow-plan-rear', cropSVG(nplan.svg, rear), rear.w * 1.4, rear.h * 1.4)
  await ctx.close()
}

const ONLY = process.env.ONLY || ''
// VIEWPORTS=phone390,phone430 narrows a flow run to those sizes
const VIEWPORTS = (process.env.VIEWPORTS || 'desktop,phone390,phone430').split(',')
if (!ONLY || ONLY === 'flow') {
  if (VIEWPORTS.includes('desktop')) await flow({ width: 1440, height: 900 }, 'desktop')
  if (VIEWPORTS.includes('phone390')) await flow({ width: 390, height: 844 }, 'phone390')
  if (VIEWPORTS.includes('phone430')) await flow({ width: 430, height: 932 }, 'phone430')
}
if (!ONLY || ONLY === 'narrow') {
  await narrowLot({ width: 1440, height: 900 }, 'desktop')
  await narrowLot({ width: 390, height: 844 }, 'phone390')
  await narrowLot({ width: 430, height: 932 }, 'phone430') // round 6: the 430 set is complete
}
if (!ONLY || ONLY === 'crops') await crops()

// the drafter: the review with its audit panel
for (const [viewport, tag] of ONLY && ONLY !== 'review' ? [] : [[{ width: 1440, height: 900 }, 'desktop'], [{ width: 390, height: 844 }, 'phone390'], [{ width: 430, height: 932 }, 'phone430']]) {
  const ctx = await ctxFor(viewport)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`review ${tag}: ${e.message}`))
  await page.goto(APP + '/#/review', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  if (await page.locator('#signin-email').count()) {
    await page.locator('#signin-email').fill('maria@drafthouse.test')
    await page.getByRole('button', { name: /Continue|Email me|Sign in/ }).click()
    await page.waitForTimeout(1500)
  }
  const rows = page.locator('.inbox-row')
  if (await rows.count()) {
    await rows.first().click()
    await page.waitForTimeout(2200)
    await page.screenshot({ path: `${out}/${tag}-11-review-audit.png`, fullPage: true })
    const warn = await page.locator('.checks li.warn').count()
    const audit = await page.locator('.card.audit h3').first().textContent().catch(() => null)
    note(`${tag}: review · ${audit || 'NO AUDIT PANEL'} · ${warn} ⚠ row${warn === 1 ? '' : 's'}`)
  } else note(`${tag}: review inbox is empty`)
  await ctx.close()
}
await browser.close()
// a partial run (ONLY=...) keeps its notes beside the full run's
fs.writeFileSync(path.join(out, ONLY ? `notes.${ONLY}.txt` : 'notes.txt'), notes.join('\n') + '\n')
if (errors.length) {
  console.log('PAGE ERRORS:')
  errors.forEach((e) => console.log('  ' + e))
}
console.log(`done: ${out}`)
