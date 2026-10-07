// Seed the local JSON store with the fixtures the regression suite needs, so
// `node scripts/regression.mjs` is green on a FRESH machine (no DATABASE_URL).
// Run this BEFORE booting the test server. Idempotent — safe to re-run.
// Never touches a real Postgres DB: it only writes the local fallback file.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.DATABASE_URL) {
  console.error("Refusing to seed: DATABASE_URL is set (that's a real DB). Seed only the local JSON store.");
  process.exit(1);
}

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "server", "data");
const file = path.join(dir, "store.json");
fs.mkdirSync(dir, { recursive: true });

let store = { contractors: [], sessions: {}, invites: {}, states: {}, leads: [], metrics: {}, meetings: [], tasks: [] };
try { store = JSON.parse(fs.readFileSync(file, "utf8")); } catch { /* fresh */ }
store.contractors = store.contractors || [];

// test-roofer: a published, active roofing client the widget/site/onboarding
// tests point at.
const SLUG = "test-roofer";
let c = store.contractors.find((x) => x.slug === SLUG);
if (!c) {
  c = { id: "test-roofer-fixed-0001", slug: SLUG, name: "Techos Prueba", phone: "9565551234", created_at: new Date(0).toISOString() };
  store.contractors.push(c);
}
c.data = {
  payStatus: "ok",
  profile: { biz: "Techos Del Valle", phone: "9565551234", lang: "es", trade: "roofing",
    materials: [{ n: "Shingle 3-tab", p: 110 }, { n: "Metal", p: 280 }], setupDone: true },
  site: { published: true, template: "2", color: "#1B6FB8", city: "McAllen, TX", years: 12,
    services: ["Techos nuevos", "Reparaciones"], area: "McAllen, Misión", published_at: new Date(0).toISOString() },
};

// test-fencer: a published fence client for the fence-widget suites, so they
// never burn the alto-cercas DEMO cap (2 lifetime scans per IP).
const FSLUG = "test-fencer";
let f = store.contractors.find((x) => x.slug === FSLUG);
if (!f) {
  f = { id: "test-fencer-fixed-0001", slug: FSLUG, name: "Cercas Prueba", phone: "9565554321", created_at: new Date(0).toISOString() };
  store.contractors.push(f);
}
f.data = {
  payStatus: "ok",
  trade: "fence", // the widget/site routers read data.trade; the app reads profile.trade
  profile: { biz: "Cercas Del Valle", phone: "9565554321", lang: "es", trade: "fence", setupDone: true },
  site: { published: true, template: "2", color: "#2E7D32", city: "McAllen, TX", years: 8,
    services: ["Cercas nuevas"], area: "McAllen", published_at: new Date(0).toISOString() },
};

// Clear the per-IP lifetime quota counters that trip tests 1-2 after repeated runs.
if (store.metrics && store.metrics.all) {
  for (const k of Object.keys(store.metrics.all)) if (/^(demolk|wq):/.test(k)) delete store.metrics.all[k];
}

fs.writeFileSync(file, JSON.stringify(store));
console.log("seeded test-roofer + test-fencer (published, active) + cleared demo/widget quota counters");
