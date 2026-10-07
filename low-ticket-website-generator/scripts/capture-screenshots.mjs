// Captures every screen of the /pagina website generator for the handoff.
// Usage: APP=<path to code/> node capture-screenshots.mjs <out-dir>
// Needs the server from HANDOFF.md §4 on :5959 (STRIPE_WEBHOOK_SECRET=whsec_test).
import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const APP = process.env.APP || new URL("../code", import.meta.url).pathname;
const { chromium } = createRequire(APP + "/package.json")("playwright");
const OUT = process.argv[2];
const B = "http://localhost:5959";
fs.mkdirSync(OUT, { recursive: true });
const MOBILE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: "reduce" };
const DESK = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: "reduce" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const log = [];
async function shot(page, name, opts = {}) {
  const f = path.join(OUT, name + ".png");
  if (opts.fullPage) { // trigger lazy images before a full-page capture
    await page.evaluate(async () => { const h = document.body.scrollHeight; for (let y = 0; y < h; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); } window.scrollTo(0, 0); });
    await new Promise((r) => setTimeout(r, 800));
  }
  await page.screenshot({ path: f, ...opts });
  log.push(name);
  console.log("📸", name);
}
async function settle(page, ms = 800) { await page.waitForLoadState("networkidle").catch(() => {}); await sleep(ms); }

async function fillForm(page, trade) {
  await page.selectOption("#f_trade", trade);
  await page.fill("#f_biz", trade === "fence" ? "González Fencing" : "Rio Grande Roofing");
  await page.fill("#f_name", "Javier González");
  await page.fill("#f_phone", "956 555 0188");
  await page.fill("#f_city", "McAllen, TX");
  await page.fill("#f_years", "12");
}

// Runs the whole funnel for one trade and one device; returns the draft id.
async function funnel(trade, dev, tag) {
  const ctx = await browser.newContext(dev);
  const page = await ctx.newPage();
  const q = trade === "fence" ? "?t=cercas" : "?t=techos";
  await page.goto(B + "/pagina" + q); await settle(page);
  await shot(page, `${tag}-01-form-landing`, { fullPage: true });
  await fillForm(page, trade);
  await page.locator(".card").scrollIntoViewIfNeeded();
  await shot(page, `${tag}-02-form-filled`);
  // phone validation error
  await page.fill("#f_phone", "956");
  await page.click(".go");
  await sleep(300);
  await page.locator("#perr").scrollIntoViewIfNeeded();
  await shot(page, `${tag}-03-form-phone-error`);
  await page.fill("#f_phone", "956 555 0188");
  await page.click(".go");
  await sleep(2600);
  await shot(page, `${tag}-04-construction-interstitial`);
  await page.waitForURL(/\/pagina\/preview\?d=/, { timeout: 15000 });
  const id = new URL(page.url()).searchParams.get("d");
  await settle(page, 1200);
  await shot(page, `${tag}-05-preview-reveal-toast`);
  await shot(page, `${tag}-06-preview-fullpage`, { fullPage: true });
  // wizard invites itself ~5s after first load
  await page.waitForSelector("#pgtb", { state: "visible", timeout: 10000 });
  await sleep(2500); // thumbnails load
  const names = ["estilo", "color", "negocio", "logo", "fotos", "texto"];
  for (let n = 1; n <= 6; n++) {
    await page.evaluate((k) => window.pgWizGo(k), n);
    await sleep(n === 1 ? 2500 : 500);
    await shot(page, `${tag}-07-wizard-step${n}-${names[n - 1]}`);
  }
  await page.evaluate(() => window.pgWizGo(7)); // "Terminar" → ¡Quedó! toast
  await sleep(400);
  await shot(page, `${tag}-08-wizard-done-toast`);
  await sleep(3600);
  await shot(page, `${tag}-09-claim-bar`);
  // full panel (🎨)
  await page.evaluate(() => window.pgWizFull());
  await sleep(2500);
  await shot(page, `${tag}-10-full-panel-top`);
  await page.evaluate(() => { const t = document.getElementById("pgtb"); t.scrollTop = t.scrollHeight; });
  await sleep(400);
  await shot(page, `${tag}-11-full-panel-bottom`);
  await ctx.close();
  return id;
}

async function patch(id, body) {
  const r = await fetch(`${B}/api/pagina/draft/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return r.json();
}
const dataUrl = (f, mime) => `data:${mime};base64,` + fs.readFileSync(f).toString("base64");

// 1) Mobile funnel (ads are mobile) — fence and roofing
const fenceId = await funnel("fence", MOBILE, "m-fence");
const roofId = await funnel("roofing", MOBILE, "m-roof");
// 2) Desktop funnel — fence
const deskId = await funnel("fence", DESK, "d-fence");

// 3) All 6 templates, both trades, desktop full page (bare = the site alone)
const tplNames = { 1: "clasica", 2: "moderna", 3: "bold", 4: "elegante", 5: "vivo", 6: "sencilla" };
{
  const ctx = await browser.newContext(DESK);
  const page = await ctx.newPage();
  for (const [trade, id] of [["fence", fenceId], ["roof", roofId]]) {
    for (let t = 1; t <= 6; t++) {
      await page.goto(`${B}/pagina/preview?d=${id}&tpl=${t}&bare=1`); await settle(page, 1500);
      await shot(page, `tpl-${trade}-${t}-${tplNames[t]}-desktop`, { fullPage: true });
    }
  }
  await ctx.close();
  const mctx = await browser.newContext(MOBILE);
  const mp = await mctx.newPage();
  for (let t = 1; t <= 6; t++) {
    await mp.goto(`${B}/pagina/preview?d=${fenceId}&tpl=${t}&bare=1`); await settle(mp, 1500);
    await shot(mp, `tpl-fence-${t}-${tplNames[t]}-mobile`, { fullPage: true });
  }
  await mctx.close();
}

// 4) A fully customized draft (real UI uploads for logo + photos, API for the rest)
{
  const ctx = await browser.newContext(MOBILE);
  await ctx.addInitScript((id) => { try { localStorage.setItem("pgseen_" + id, "1"); } catch {} }, fenceId);
  const page = await ctx.newPage();
  await page.goto(`${B}/pagina/preview?d=${fenceId}`); await settle(page);
  // logo via the real file input
  await page.evaluate(() => window.pgWizGo(4));
  await page.setInputFiles("#pglf", path.join(path.dirname(new URL(import.meta.url).pathname), "sample-logo.png"));
  await page.waitForLoadState("load"); await settle(page, 1200);
  // photos via the real file input (client resize → photosAdd)
  await page.evaluate(() => window.pgWizGo(5));
  await page.setInputFiles("#pgff", ["cedar", "vinyl", "ranch", "custom"].map((n) => path.join(APP, `public/fence/${n}.jpg`)));
  await page.waitForLoadState("load"); await settle(page, 1500);
  await shot(page, "c-fence-01-wizard-photos-uploaded");
  await patch(fenceId, {
    template: "1", color: "#0F4C81", license: "TX-FC-48213", area: "McAllen, Edinburg, Mission, Pharr",
    services: ["Cerca de madera", "Cerca de vinilo", "Portones", "Reparación de cercas"],
    facebook: "https://facebook.com/gonzalezfencing", instagram: "https://instagram.com/gonzalezfencing",
  });
  // AI copy button (no key → curated variant)
  await page.evaluate(() => window.pgWizGo(6));
  await sleep(300);
  await page.click("#pgai");
  await page.waitForLoadState("load"); await settle(page, 1200);
  await shot(page, "c-fence-02-wizard-text-after-ai");
  await page.evaluate(() => window.pgWizClose());
  await sleep(300);
  await shot(page, "c-fence-03-customized-preview-mobile", { fullPage: true });
  await ctx.close();
  const d = await browser.newContext(DESK);
  const dp = await d.newPage();
  for (let t = 1; t <= 6; t++) {
    await dp.goto(`${B}/pagina/preview?d=${fenceId}&tpl=${t}&bare=1`); await settle(dp, 1500);
    await shot(dp, `c-fence-04-customized-tpl${t}-${tplNames[t]}-desktop`, { fullPage: true });
  }
  await d.close();
}

// 5) Purchase: signed Stripe webhook → /bienvenida → published /site/<slug>
{
  const sess = "cs_test_" + crypto.randomBytes(8).toString("hex");
  const body = JSON.stringify({
    id: "evt_" + crypto.randomBytes(6).toString("hex"), type: "checkout.session.completed", created: Math.floor(Date.now() / 1000),
    data: { object: { id: sess, object: "checkout.session", mode: "payment", payment_status: "paid", status: "complete",
      amount_total: 4900, currency: "usd", client_reference_id: `pagina-${fenceId}`, customer: null,
      customer_details: { email: `j${Date.now()}@example.com`, phone: "+1956" + String(Date.now()).slice(-7), name: "Javier González" } } },
  });
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac("sha256", "whsec_test").update(`${t}.${body}`).digest("hex");
  const r = await fetch(`${B}/api/stripe/webhook`, { method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": `t=${t},v1=${sig}` }, body });
  console.log("webhook", r.status, await r.text());
  const cr = await (await fetch(`${B}/api/checkout-result?session_id=${sess}`)).json();
  console.log("checkout-result", JSON.stringify(cr).slice(0, 300));
  for (const [dev, tag] of [[MOBILE, "m"], [DESK, "d"]]) {
    const ctx = await browser.newContext(dev);
    const page = await ctx.newPage();
    await page.goto(`${B}/bienvenida?session_id=${sess}`); await settle(page, 3000);
    await shot(page, `${tag}-buy-01-bienvenida`, { fullPage: true });
    if (cr.siteUrl) {
      await page.goto(cr.siteUrl.replace(/^https?:\/\/[^/]+/, B)); await settle(page, 2000);
      await shot(page, `${tag}-buy-02-published-site`, { fullPage: true });
    }
    if (tag === "m" && cr.accessUrl) {
      await page.goto(cr.accessUrl.replace(/^https?:\/\/[^/]+/, B)); await settle(page, 3000);
      await shot(page, `m-buy-03-buyer-app-siteonly`);
    }
    await ctx.close();
  }
}

// 6) The embedded quote widgets every site carries
{
  const ctx = await browser.newContext(MOBILE);
  const page = await ctx.newPage();
  for (const s of ["alto-cercas", "alto-demo"]) {
    await page.goto(`${B}/w/${s}`); await settle(page, 2000);
    await shot(page, `widget-${s}`, { fullPage: true });
  }
  await ctx.close();
}

// 7) Legacy query-string preview (fallback when draft API fails) — no toolbar
{
  const ctx = await browser.newContext(MOBILE);
  const page = await ctx.newPage();
  await page.goto(`${B}/pagina/preview?trade=fence&biz=Legacy%20Fence&city=Pharr,%20TX&years=5&phone=9565550100`); await settle(page);
  await shot(page, "m-legacy-querystring-preview");
  await ctx.close();
}

await browser.close();
fs.writeFileSync(path.join(OUT, "_index.json"), JSON.stringify({ fenceId, roofId, deskId, shots: log }, null, 2));
console.log("done", log.length);
