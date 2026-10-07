// Roofing golden flows — run after EVERY commit, before every push.
// Reproducible from a fresh checkout (from tradetechpro/):
//   npm install                 # once — pulls playwright (devDependency)
//   npm run build               # dist/ is what the server serves
//   npm run seed:test           # writes a published test-roofer into the local store
//   npm run server &            # boot (needs ADMIN_KEY/CS_KEY/CLOSER_KEY in env or server/.env)
//   npm run regression          # must print ALL ROOFING FLOWS GREEN
// The seed step also clears the per-IP demo/widget quota counters
// (metrics.all demolk:* / wq:*) that otherwise trip tests 1-2 after repeated
// local runs — so re-run `npm run seed:test` (server stopped) if they flake.
import { chromium } from "playwright";
import { execSync } from "node:child_process";
const B = "http://localhost:5959";
const fails = [];
const ok = (name, cond) => { console.log((cond ? "✓" : "✗ FAIL"), name); if (!cond) fails.push(name); };

// 0. Fence construction math (pure unit tests — no server needed)
try { execSync("node scripts/fence-math-test.mjs", { stdio: "pipe" }); ok("fence math unit tests", true); }
catch { ok("fence math unit tests", false); }

// 0b. Parcel matching state machine (runs its own local Regrid stub)
try { execSync("node scripts/parcel-test.mjs", { stdio: "pipe" }); ok("parcel matching unit tests", true); }
catch { ok("parcel matching unit tests", false); }

// 0c. Survey traverse (metes & bounds → exact lot polygon, pure unit tests)
try { execSync("node scripts/survey-test.mjs", { stdio: "pipe" }); ok("survey traverse unit tests", true); }
catch { ok("survey traverse unit tests", false); }

const b = await chromium.launch();

// 1. App demo measures a roof (simulated fallback)
{
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on("pageerror", e => errs.push(e.message));
  await p.goto(B + "/?demo=roof", { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(1200);
  await p.evaluate(() => { const bx = [...document.querySelectorAll("button")].find(x => /Medir techo/i.test(x.innerText)); bx && bx.click(); });
  await p.waitForTimeout(500);
  const inp = await p.$("input");
  await inp.fill("3811 Braden Dr N Houston TX");
  await p.waitForTimeout(300);
  await inp.press("Enter");
  await p.waitForTimeout(3500);
  const body = await p.evaluate(() => document.body.innerText);
  ok("app demo roof measure", /CUADROS|SQUARES/i.test(body));
  ok("app demo no page errors", errs.length === 0);
  await p.close();
}

// 2. Widget lead capture (test-roofer)
{
  const p = await b.newPage({ viewport: { width: 430, height: 900 } });
  await p.goto(B + "/w/test-roofer", { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(600);
  await p.fill("#addr", "100 Main St McAllen TX");
  await p.click("text=VER MI TECHO");
  await p.waitForSelector("#nm", { state: "visible", timeout: 15000 }).catch(() => {});
  const gotForm = await p.locator("#nm").isVisible();
  ok("widget reaches contact form", gotForm);
  if (gotForm) {
    await p.fill("#nm", "Regression Bot");
    await p.fill("#ph", "9565550000");
    await p.click("#go");
    const done = await p.waitForFunction(() => /Listo|Recibimos|\$/.test(document.body.innerText), null, { timeout: 10000 }).then(() => true).catch(() => false);
    ok("widget lead submits", done);
  }
  await p.close();
}

// 3. Portals render
{
  const p = await b.newPage();
  await p.goto(B + "/admin?key=testadmin", { waitUntil: "domcontentloaded" });
  ok("admin renders", await p.evaluate(() => document.body.innerText.includes("Leads de venta")));
  await p.goto(B + "/closer?key=testcloser", { waitUntil: "domcontentloaded" });
  ok("closer renders", await p.evaluate(() => /reuniones|meetings/i.test(document.body.innerText)));
  await p.goto(B + "/onboarding?slug=test-roofer&key=testcloser", { waitUntil: "domcontentloaded" });
  await p.waitForSelector("#dsearch", { state: "attached", timeout: 10000 }).catch(() => {});
  ok("onboarding renders", (await p.locator("#dsearch").count()) > 0);
  await p.close();
}

// 4. Site + city page render
{
  const p = await b.newPage();
  const r1 = await p.goto(B + "/site/test-roofer?preview=1", { waitUntil: "domcontentloaded" });
  ok("client site renders", r1.status() === 200);
  await p.close();
}

await b.close();
if (fails.length) { console.log("\nREGRESSIONS:", fails.join(" | ")); process.exit(1); }
console.log("\nALL ROOFING FLOWS GREEN");
