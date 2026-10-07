/*
 * Trade Tech Pro backend.
 *
 * Three endpoints, each with a demo fallback so the app works with no keys:
 *   GET  /api/health  — which features are live vs demo
 *   GET  /api/places  — address autocomplete (Google Places, else mock list)
 *   POST /api/lookup  — roof + property data (Google Geocoding + Solar API +
 *                       RentCast, else simulated data)
 *   POST /api/ai      — the "Pregúntale a TTP" assistant (Anthropic API)
 */
import express from "express";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { fromArrayBuffer } from "geotiff";
import proj4 from "proj4";
import webpush from "web-push";
import * as db from "./db.mjs";
import { renderSite, chatHtml, areaCities, citySlug } from "./templates.mjs";
import { computeTakeoff } from "./takeoff.mjs";
import { makeParcelResolver } from "./parcel.mjs";
import { pngEncode } from "./png.mjs";
// The fence construction engine is shared with the app (pure module, no DOM):
// the /f estimate document recomputes panels/posts/prices from the same
// geometry with the same code, so the PDF can never disagree with the app.
import { fenceQuote, cornerIndexes as fenceCornerIdx, distFt as fenceDistFt, runFt as fenceRunFt } from "../src/fenceMath.js";

const PORT = process.env.PORT || 8787;
const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY || "";
const RENTCAST_KEY = process.env.RENTCAST_API_KEY || "";
const REGRID_KEY = process.env.REGRID_API_KEY || "";
const ADMIN_KEY = process.env.ADMIN_KEY || "";
const CLOSER_KEY = process.env.CLOSER_KEY || "";
const CS_KEY = process.env.CS_KEY || "";
// Private demo passcode: when a widget link carries ?demo=<DEMO_PASS> the quote
// widget runs unlimited (no daily/lifetime caps) and skips saving/forwarding a
// real lead — for recording sales demos. Off unless DEMO_PASS is set, so public
// links stay rate-limited and only the passcode holder gets unlimited use.
const DEMO_PASS = process.env.DEMO_PASS || "";
const SALES_WA = "19568670754"; // ALTO's own sales WhatsApp (demo takeovers point here)
const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
// Web Push (buzz the contractor's phone on a new lead, even with the app closed).
// Generate keys once with `npx web-push generate-vapid-keys`. Off until set.
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || "";
const PUSH_ON = !!(VAPID_PUBLIC && VAPID_PRIVATE);
if (PUSH_ON) {
  try { webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:soporte@alto-pro.com", VAPID_PUBLIC, VAPID_PRIVATE); }
  catch (e) { console.error("VAPID config failed:", e.message); }
}
// Cloudflare for SaaS (custom client domains). Off until configured.
const CF_API_TOKEN = process.env.CF_API_TOKEN || "";
const CF_ZONE_ID = process.env.CF_ZONE_ID || "";
const CF_CNAME_TARGET = process.env.CF_CNAME_TARGET || "app.alto-pro.com";
// GHL calendar permanent link — when set, the landing quiz's success screen
// embeds it so a fresh lead can self-book the call on the spot.
const GHL_BOOKING_URL = process.env.GHL_BOOKING_URL || "";
// The private WhatsApp Community the /app + /app-cercas landings promise. When
// set, /bienvenida hands a new buyer the join link the moment their account is
// live — the promise gets fulfilled automatically, no setter step. Empty = the
// invite is delivered by the human welcome message instead (nothing breaks).
const COMMUNITY_INVITE_URL = process.env.COMMUNITY_INVITE_URL || "";
// Fence vertical dark-launch switch: until this is "1", no trade selector is
// shown anywhere and no fence client can be created — roofing is untouched.
const FENCE_ENABLED = process.env.FENCE_ENABLED === "1";
// The $49 website-factory funnel (/pagina). Additive, flag-gated — the app
// funnels are untouched; turning this off hides the new door, nothing else.
const PAGINA_ENABLED = process.env.PAGINA_ENABLED === "1";
// Register a client's custom hostname with Cloudflare (auto SSL). Safe no-op
// until CF_API_TOKEN + CF_ZONE_ID are set in the environment.
async function cfAddHostname(hostname) {
  if (!CF_API_TOKEN || !CF_ZONE_ID) return { ok: false, reason: "cf_off" };
  try {
    const r = await fetch(`https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/custom_hostnames`, {
      method: "POST",
      headers: { Authorization: `Bearer ${CF_API_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ hostname, ssl: { method: "http", type: "dv", settings: { min_tls_version: "1.2" } } }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, reason: "cf_error", errors: j.errors };
    return { ok: true, id: j.result?.id, status: j.result?.status };
  } catch (e) { return { ok: false, reason: e.message }; }
}

// Cloudflare Registrar API (beta, April 2026): buy a domain outright, straight
// from onboarding — no separate trip to the Cloudflare dashboard. Every domain
// is registered under OUR account/registrant (not the client's) so ownership
// stays centralized at scale; the client gets a real working custom domain,
// not a legal claim on it.
// Needs CF_ACCOUNT_ID + a token with Registrar write permission, a billing
// profile with a payment method, a default registrant contact (address book),
// and the Domain Registration Agreement accepted — all one-time setup in the
// Cloudflare dashboard, not something this code can do.
// Shapes below match Cloudflare's published OpenAPI schema
// (POST /registrar/domain-check and POST /registrar/registrations).
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || "";
async function cfCheckDomains(names) {
  if (!CF_API_TOKEN || !CF_ACCOUNT_ID) return { ok: false, reason: "cf_off" };
  try {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/registrar/domain-check`, {
      method: "POST",
      headers: { Authorization: `Bearer ${CF_API_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ domains: names.slice(0, 20) }), // API max: 20 per request
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) return { ok: false, reason: "cf_error", errors: j.errors };
    const map = {};
    for (const row of j.result?.domains || []) {
      map[String(row.name || "").toLowerCase()] = {
        available: !!row.registrable,
        price: row.pricing?.registration_cost ? Number(row.pricing.registration_cost) : null,
        currency: row.pricing?.currency || "USD",
        reason: row.reason || null, // e.g. domain_unavailable, unsupported_tld
      };
    }
    return { ok: true, map };
  } catch (e) { return { ok: false, reason: e.message }; }
}
// Registrant contact sent inline with each purchase. Without these env vars
// the account's default address book entry is used instead — that default can
// only be created in the dashboard (Domain Registration → Manage Domains);
// there's no API for it, so the env vars are the more reliable path.
const CF_REGISTRANT = (() => {
  const E = (k) => String(process.env[k] || "").trim();
  const c = { name: E("CF_REG_NAME"), org: E("CF_REG_ORG"), email: E("CF_REG_EMAIL"), phone: E("CF_REG_PHONE"), street: E("CF_REG_STREET"), city: E("CF_REG_CITY"), state: E("CF_REG_STATE"), zip: E("CF_REG_ZIP"), country: E("CF_REG_COUNTRY") || "US" };
  if (!(c.name && c.email && c.phone && c.street && c.city && c.state && c.zip)) return null;
  return {
    registrant: {
      email: c.email,
      phone: c.phone, // E.164 with a dot: +1.9565551234
      postal_info: {
        name: c.name,
        ...(c.org ? { organization: c.org } : {}),
        address: { street: c.street, city: c.city, state: c.state, postal_code: c.zip, country_code: c.country },
      },
    },
  };
})();
async function cfRegisterDomain(name) {
  if (!CF_API_TOKEN || !CF_ACCOUNT_ID) return { ok: false, reason: "cf_off" };
  try {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/registrar/registrations`, {
      method: "POST",
      headers: { Authorization: `Bearer ${CF_API_TOKEN}`, "Content-Type": "application/json" },
      // auto_renew so client sites never die on the 1-year anniversary;
      // registrant comes from CF_REG_* env vars, else the account's default
      // address book entry
      body: JSON.stringify({ domain_name: name, auto_renew: true, ...(CF_REGISTRANT ? { contacts: CF_REGISTRANT } : {}) }),
    });
    const j = await r.json().catch(() => ({}));
    // 201 = registered within the sync wait window, 202 = still processing
    // (workflow keeps running server-side; poll j.result.links.self if needed)
    if ((!r.ok && r.status !== 202) || j.success === false) return { ok: false, reason: "cf_error", errors: j.errors };
    const w = j.result || {};
    return { ok: true, status: w.completed ? "complete" : (w.state || "pending"), poll: w.links?.self || null };
  } catch (e) { return { ok: false, reason: e.message }; }
}
// A domain bought via Registrar lands in our account as a fresh Cloudflare
// zone. Point it at Render: CNAME @ and www → the Render service host
// (DNS-only so Render can terminate TLS itself; Cloudflare flattens the apex
// CNAME automatically). Zone creation can lag the purchase by a few seconds,
// so we retry the lookup briefly.
const RENDER_ORIGIN = process.env.RENDER_ORIGIN || "tradetechpro.onrender.com";
async function cfPointZoneAtRender(domain) {
  if (!CF_API_TOKEN) return { ok: false, reason: "cf_off" };
  const H = { Authorization: `Bearer ${CF_API_TOKEN}`, "Content-Type": "application/json" };
  try {
    let zone = null;
    for (let i = 0; i < 5 && !zone; i++) {
      if (i) await new Promise((s) => setTimeout(s, 3000));
      const r = await fetch(`https://api.cloudflare.com/client/v4/zones?name=${encodeURIComponent(domain)}`, { headers: H });
      const j = await r.json().catch(() => ({}));
      zone = (j.result || [])[0] || null;
    }
    if (!zone) return { ok: false, reason: "zone_not_found" };
    const recs = [];
    for (const name of [domain, `www.${domain}`]) {
      const r = await fetch(`https://api.cloudflare.com/client/v4/zones/${zone.id}/dns_records`, {
        method: "POST", headers: H,
        body: JSON.stringify({ type: "CNAME", name, content: RENDER_ORIGIN, proxied: false, ttl: 1 }),
      });
      const j = await r.json().catch(() => ({}));
      const dup = (j.errors || []).some((e) => e.code === 81053 || e.code === 81057); // already exists
      recs.push({ name, ok: r.ok || dup });
    }
    return { ok: recs.every((x) => x.ok), zone: zone.id, records: recs };
  } catch (e) { return { ok: false, reason: e.message }; }
}
// Render only serves hostnames it knows about (it routes by SNI/Host and
// issues the Let's Encrypt cert per domain), so every custom domain — bought
// or client-owned — must also be added to the Render service. Needs an API
// key + the service id (srv-…) in the environment.
const RENDER_API_KEY = process.env.RENDER_API_KEY || "";
const RENDER_SERVICE_ID = process.env.RENDER_SERVICE_ID || "";
async function renderAddDomain(domain) {
  if (!RENDER_API_KEY || !RENDER_SERVICE_ID) return { ok: false, reason: "render_off" };
  const H = { Authorization: `Bearer ${RENDER_API_KEY}`, "Content-Type": "application/json" };
  try {
    const out = [];
    for (const name of [domain, `www.${domain}`]) {
      const r = await fetch(`https://api.render.com/v1/services/${RENDER_SERVICE_ID}/custom-domains`, {
        method: "POST", headers: H, body: JSON.stringify({ name }),
      });
      const j = await r.json().catch(() => ({}));
      // 409 = already added (fine); Render also auto-adds the www twin for
      // apex domains, which surfaces as the same conflict — also fine.
      out.push({ name, ok: r.ok || r.status === 409, status: r.status, msg: r.ok ? undefined : j.message });
    }
    return { ok: out.some((x) => x.ok), results: out };
  } catch (e) { return { ok: false, reason: e.message }; }
}
const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
const aiLive = !!(anthropic || OPENAI_KEY);

/* One helper for both AI providers — Anthropic when ANTHROPIC_API_KEY is set,
 * else OpenAI when OPENAI_API_KEY is set. Same input, returns plain text. */
async function aiChat({ system, messages, maxTokens = 1024, model }) {
  if (anthropic) {
    // Default: Opus 4.8 for the high-volume surfaces (client bots, copywriter).
    // Callers that are low-volume/high-stakes (the owner's HQ brain) pass the
    // top-tier model explicitly.
    const msg = await anthropic.messages.create({ model: model || "claude-opus-4-8", max_tokens: maxTokens, system, messages });
    return msg.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
  }
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      max_tokens: maxTokens,
      messages: [{ role: "system", content: system }, ...messages],
    }),
  });
  if (!r.ok) throw new Error(`openai ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  return j.choices?.[0]?.message?.content || "";
}

const app = express();
// We sit behind Render's proxy: trust exactly one hop so req.ip is the real
// client and rate limiters can't be bypassed by spoofing X-Forwarded-For.
app.set("trust proxy", 1);

// Baseline security headers on EVERY response. Anti-framing is applied ONLY to
// staff surfaces — the widget (/w/) and client sites must stay embeddable in
// third-party pages (iframes on client websites ARE the product), and the /demo
// deck iframes the app cross-subdomain, so those paths get no frame policy.
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  if (req.secure) res.setHeader("Strict-Transport-Security", "max-age=31536000");
  if (/^\/(admin|cs|closer|cierre|onboarding|hq)(\/|$)/.test(req.path)) {
    // Staff portals: same-origin framing only (the admin link previews iframe
    // sibling portals from /admin itself; anything else is clickjacking bait).
    res.setHeader("Content-Security-Policy", "frame-ancestors 'self'");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
  }
  next();
});

/* ── Privacy policy (/privacidad) ──
 * One honest Spanish-first page, registered EARLY so it answers on every host
 * this server serves: alto-pro.com, app., and every client's custom domain
 * (their site footers link here). Covers both audiences: homeowners quoting on
 * a client's widget/site, and contractors signing up with ALTO Pro. */
app.get(["/privacidad", "/privacy"], (req, res) => {
  res.send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Política de Privacidad · ALTO Pro</title><meta name="robots" content="noindex">
<style>*{box-sizing:border-box}body{font-family:Inter,Arial,sans-serif;max-width:680px;margin:0 auto;padding:40px 22px 70px;color:#101B30;line-height:1.75;font-size:15.5px}
h1{font-size:26px;margin:0 0 4px}h2{font-size:17px;margin:30px 0 8px}p,li{color:#3A4358}small{color:#8A94A8}
.box{background:#F6F8FB;border:1px solid #E4E7EC;border-radius:14px;padding:16px 18px;margin:18px 0}</style></head><body>
<h1>Política de Privacidad</h1>
<small>ALTO Pro · alto-pro.com · Última actualización: julio 2026</small>

<div class="box"><b>En corto:</b> usamos tus datos solo para lo que los diste — que te contacten
sobre tu cotización o tu cuenta. No vendemos tus datos. Nunca.</div>

<h2>1. Si pediste una cotización en el sitio de un contratista</h2>
<p>Los sitios web y cotizadores "hecho con ⚡ ALTO Pro" pertenecen a contratistas
independientes. Cuando llenas su formulario recopilamos: <b>tu nombre, tu teléfono y la
dirección del proyecto</b> (y tus mensajes si usas el chat). Se usan para UNA cosa: que ese
contratista te contacte y prepare tu cotización.</p>
<p><b>Al enviar un formulario aceptas que el contratista te contacte por llamada, mensaje de
texto (SMS) o WhatsApp sobre tu proyecto.</b> Para dejar de recibir mensajes, responde
<b>STOP</b> o pídeselo directamente — se respeta de inmediato.</p>

<h2>2. Si eres contratista y usas ALTO Pro</h2>
<p>Recopilamos los datos de tu negocio (nombre, teléfono, materiales, fotos de tus trabajos) y
los datos de operación de tu cuenta. Los pagos los procesa <b>Stripe</b> — nosotros nunca vemos
ni guardamos tu número de tarjeta.</p>

<h2>3. Con quién se comparten</h2>
<p>Solo con los proveedores que hacen funcionar el servicio: <b>Stripe</b> (pagos),
<b>Google Maps/Solar</b> (medición satelital de la dirección que escribes), hosting y base de
datos, y la plataforma de mensajería del contratista. Con nadie más. <b>No vendemos ni rentamos
datos personales a terceros.</b></p>

<h2>4. Cuánto tiempo y tus derechos</h2>
<p>Guardamos los datos mientras la cuenta del contratista esté activa. Puedes pedir ver,
corregir o borrar tus datos cuando quieras: escríbenos a
<a href="mailto:privacidad@alto-pro.com">privacidad@alto-pro.com</a> o díselo al contratista
que tiene tu cotización.</p>

<h2>5. Cookies y seguridad</h2>
<p>No usamos cookies de publicidad ni rastreadores de terceros en los sitios de clientes.
Usamos almacenamiento técnico mínimo (por ejemplo, para no pedirte lo mismo dos veces). Los
datos viajan cifrados (HTTPS) y el acceso está restringido por cuenta.</p>

<h2>English summary</h2>
<p><small>Sites and quote widgets "made with ALTO Pro" belong to independent contractors. When
you submit a form we collect your name, phone and project address so that contractor can
contact you about your quote — by call, SMS or WhatsApp (reply STOP to opt out). Payments are
processed by Stripe. We never sell personal data. Questions or deletion requests:
privacidad@alto-pro.com.</small></p>
</body></html>`);
});

// A single rejected promise or thrown async error must never take the whole
// server down for every user. Log and keep serving.
process.on("unhandledRejection", (e) => { try { console.error("unhandledRejection:", e && e.stack ? e.stack : e); } catch { /* noop */ } });
process.on("uncaughtException", (e) => { try { console.error("uncaughtException:", e && e.stack ? e.stack : e); } catch { /* noop */ } });

/* ── Pricing plans (three tiers, no setup fee) ──
 * pro = the app alone · widget = + quote widget on their existing website ·
 * complete = + we build their website, AI chat and domain. Every account is
 * created by staff, so plan limits are enforced by the team — the server
 * doesn't hard-gate features by plan (yet). */
const PLANS = {
  pro: { price: 67, name: "Pro · La App" },
  widget: { price: 197, name: "Widget · Tu Página" },
  complete: { price: 297, name: "Completo · Todo Hecho" },
  // /pagina buyers: $49 once (ledger) + $19/mes hosting from month 2 — the
  // recurring number is what MRR should count. Site-only: no app measuring.
  pagina: { price: 19, name: "Página · Tu Sitio" },
};
const planOf = (c) => (PLANS[c?.data?.plan] ? c.data.plan : "complete");
// Entitlement gate for a LOGGED-IN contractor on a billable action. A session
// alone is not enough — the account must actually be active. LOCKED when:
//   • status "paused"  — stopped paying (Stripe canceled / staff paused), or
//   • payStatus "pending" — created (invite works) but the first payment never
//     landed, so the app must NOT burn measure-API money before they pay.
// Deliberately does NOT lock payStatus "ok"/"failed"/undefined: "ok" and manual
// (cash/Zelle) activations are paying; "failed" keeps a grace window after a
// card lapses; undefined covers legacy/built-in accounts that predate the field
// — locking those would wrongly cut off real clients. Returns a reason or null.
const clientLocked = (me) => {
  if (!me) return null;
  if (me.data?.status === "paused") return "paused";
  if (me.data?.payStatus === "pending") return "pending";
  // Site-only plan ($49 página + hosting): the account exists for the site,
  // its leads and the editor — never for measuring (Solar/Regrid spend). The
  // app upsell is the path to measuring.
  if (me.data?.plan === "pagina") return "siteonly";
  return null;
};
// Bound a client-supplied lead `info` object before it's stored and forwarded to
// the contractor's GHL. Anonymous widget visitors control this, so cap the shape:
// flat primitives only (no nested objects/arrays), ≤24 keys, ≤40-char keys,
// ≤500-char string values. Stops storage bloat and arbitrary-key CRM pollution;
// the admin/CS views already render only known keys and escape them.
const sanitizeInfo = (info) => {
  if (!info || typeof info !== "object" || Array.isArray(info)) return {};
  const out = {};
  let n = 0;
  for (const [k, v] of Object.entries(info)) {
    if (n >= 24) break;
    if (v == null || typeof v === "object") continue;
    out[String(k).slice(0, 40)] = (typeof v === "number" || typeof v === "boolean") ? v : String(v).slice(0, 500);
    n++;
  }
  return out;
};
// The only prices we sell, in cents — the Stripe webhook activates a plan ONLY
// when the amount paid matches one of these exactly. A new tier ($179) is added
// here + a Stripe Payment Link (playbook/01). Amount is authoritative because
// these are fixed Payment Link prices, not arbitrary invoices.
const PLAN_BY_AMOUNT = { 6700: "pro", 19700: "widget", 29700: "complete", 4900: "pagina" };
// One Stripe Payment Link per plan. The old single STRIPE_PAYMENT_LINK keeps
// working as the Complete link so nothing breaks mid-migration.
const STRIPE_LINKS = {
  pro: process.env.STRIPE_LINK_PRO || "",
  widget: process.env.STRIPE_LINK_WIDGET || "",
  complete: process.env.STRIPE_LINK_COMPLETE || process.env.STRIPE_PAYMENT_LINK || "",
  pagina: process.env.STRIPE_LINK_PAGINA || "", // $49 website funnel
};

/* ── Stripe billing webhook ──
 * Registered BEFORE the JSON parser because Stripe signatures are computed
 * over the raw body. Flow: invoice paid → reactivate instantly · payment
 * failed → 7-day grace countdown · subscription canceled → pause.
 * Configure in Stripe: endpoint /api/stripe/webhook, then put the signing
 * secret in Render as STRIPE_WEBHOOK_SECRET. */
const STRIPE_WH_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  if (!STRIPE_WH_SECRET) return res.status(503).json({ error: "webhook not configured" });
  try {
    const sig = String(req.headers["stripe-signature"] || "");
    const t = /t=(\d+)/.exec(sig)?.[1];
    const v1s = [...sig.matchAll(/v1=([a-f0-9]+)/g)].map((m) => m[1]);
    const expected = crypto.createHmac("sha256", STRIPE_WH_SECRET).update(`${t}.${req.body}`).digest("hex");
    const ok = t && v1s.some((v) => { try { return crypto.timingSafeEqual(Buffer.from(v), Buffer.from(expected)); } catch { return false; } });
    if (!ok || Math.abs(Date.now() / 1000 - Number(t)) > 600) return res.status(400).json({ error: "bad signature" });
  } catch { return res.status(400).json({ error: "bad signature" }); }

  let event;
  try { event = JSON.parse(req.body.toString("utf8")); } catch { return res.status(400).json({ error: "bad json" }); }
  const obj = event.data?.object || {};
  const customerId = obj.customer || null;
  const email = String(obj.customer_email || obj.customer_details?.email || obj.billing_details?.email || "").toLowerCase();
  const phone = String(obj.customer_phone || obj.customer_details?.phone || obj.billing_details?.phone || "").replace(/\D/g, "").replace(/^1/, "");
  // Ordering guard: Stripe does NOT guarantee delivery order. We stamp the
  // account with the time of the last-applied billing event and ignore any
  // STATE change from an older event (a late failure can't un-activate a newer
  // payment; a late payment can't undo a newer cancellation).
  const evTime = Number(event.created) || Math.floor(Date.now() / 1000);

  // What counts as a real, paid activation. Stripe delivers many event types
  // and many amounts; we activate ONLY when money was actually captured, in
  // USD, for one of our exact plan prices. This blocks: unpaid/delayed
  // checkouts (payment_status !== "paid"), unrelated small invoices, and any
  // non-USD or unknown-amount charge.
  const isCheckout = event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded";
  const isInvoicePaid = event.type === "invoice.paid" || event.type === "invoice.payment_succeeded";
  const amountCents = obj.amount_paid ?? obj.amount_total ?? null;
  const currency = String(obj.currency || "usd").toLowerCase();
  const paidPlan = amountCents != null ? PLAN_BY_AMOUNT[Math.round(amountCents)] : null;
  // Invoices only fire when actually paid; checkouts must be explicitly paid.
  const moneyCaptured = isInvoicePaid || (isCheckout && (obj.payment_status === "paid" || obj.payment_status === "no_payment_required"));
  const paidActivation = moneyCaptured && currency === "usd" && !!paidPlan;
  // 7-day free trial (a Payment Link with a trial period): the checkout
  // completes with $0 — payment_status "no_payment_required", mode
  // "subscription". No money moved yet, but access starts TODAY: payStatus
  // "trial" (excluded from MRR on purpose), plan from the link's
  // metadata.plan when set, else the $67 app tier (the only link we attach
  // trials to). Day 8's invoice.paid flips it to a normal paid activation;
  // a cancel during the trial arrives as subscription.deleted → pause.
  const trialActivation = !paidActivation && isCheckout && obj.payment_status === "no_payment_required"
    && currency === "usd" && Math.round(amountCents || 0) === 0 && obj.mode === "subscription";
  const trialPlan = trialActivation ? (PLANS[String(obj.metadata?.plan || "")] ? String(obj.metadata.plan) : "pro") : null;

  // Match the Stripe customer to a contractor: stored id first, then email, then phone
  const list = await db.listContractors();
  const match =
    list.find((c) => c.data?.stripeCustomer && customerId && c.data.stripeCustomer === customerId) ||
    list.find((c) => email && String(c.data?.profile?.email || "").toLowerCase() === email) ||
    list.find((c) => phone && [c.phone, c.data?.profile?.phone].some((p) => String(p || "").replace(/\D/g, "").replace(/^1/, "") === phone));
  if (!match) {
    // AUTO-PROVISION (night sales): a first purchase (checkout) with no
    // existing account creates the account RIGHT NOW — no human in the
    // loop. The invite link is parked under the checkout session id so the
    // /bienvenida page (Stripe's after-payment redirect) can hand the buyer
    // their access seconds after paying. The purchase also lands in the
    // alto-ventas inbox (src "app-buy", access link included) → push + GHL
    // forward, so the team sees every sale and onboarding can chase.
    if ((paidActivation || trialActivation) && isCheckout && obj.id) {
      const sessKey = `stripe_sess:${obj.id}`;
      const dup = await db.kvGet(sessKey).catch(() => null);
      if (dup) return res.json({ ok: true, matched: false, auto: "dup" });
      try {
        const buyerName = String(obj.customer_details?.name || "").trim().slice(0, 60) || `Cliente ${phone.slice(-4) || "ALTO"}`;
        const plan2 = paidPlan || trialPlan;
        // The funnel page stamps the Stripe link with client_reference_id
        // ("app" | "app-cercas") so the buyer's account opens in their trade
        // AND the sale is attributed to its funnel on the Embudos board.
        const buyRef = String(obj.client_reference_id || "");
        const buyTrade = FENCE_ENABLED && /cercas/.test(buyRef) ? "fence" : "roofing";
        // "pagina-<draftid>" carries the buyer's customized draft along with
        // the funnel id — match on the prefix, keep the suffix for Phase 2.
        const buyFunnel = (buyRef.match(new RegExp(`^(${FUNNEL_IDS})(?:-|$)`)) || [])[1] || "app";
        const buyDraft = buyRef.startsWith("pagina-") ? pgId(buyRef.slice(7)) : "";
        // /pagina purchase: the customized draft IS the account. Business name
        // becomes the account name (the slug → /site/<slug>), the site ships
        // published, and the buyer's app is site-only (plan "pagina").
        const draft = buyDraft ? await db.kvGet(pgKey(buyDraft)).catch(() => null) : null;
        const fromDraft = draft ? paginaSiteFromDraft(draft) : null;
        const c = await db.createContractor({ name: fromDraft ? (draft.biz || buyerName) : buyerName, phone: phone || (draft && draft.phone) || "" });
        const cData = fromDraft ? {
          plan: "pagina", payStatus: "ok",
          trade: fromDraft.trade,
          profile: { ...fromDraft.profile, ...(email ? { email } : {}), ...(phone ? { phone } : {}) },
          site: fromDraft.site,
          funnel: buyFunnel, paginaDraft: buyDraft,
          autoProvisioned: new Date().toISOString(), billingEventAt: evTime,
        } : {
          plan: plan2, payStatus: trialActivation ? "trial" : "ok",
          trade: buyTrade, profile: { trade: buyTrade, ...(email ? { email } : {}), ...(phone ? { phone } : {}) },
          funnel: buyFunnel,
          ...(buyDraft ? { paginaDraft: buyDraft } : {}),
          autoProvisioned: new Date().toISOString(), billingEventAt: evTime,
        };
        if (customerId) cData.stripeCustomer = customerId;
        if (trialActivation) cData.trialStartedAt = new Date(evTime * 1000).toISOString();
        else if (amountCents) cData.payments = [{ evId: obj.invoice || obj.id, at: new Date(evTime * 1000).toISOString(), amount: Math.round(amountCents) / 100, url: null }];
        await db.saveContractorData(c.id, cData);
        const token = await db.createInvite(c.id);
        const accessUrl = `${appBase(req)}/invite/${token}`;
        const siteUrl = fromDraft ? `${appBase(req)}/site/${c.slug}` : "";
        await db.kvSet(sessKey, { contractorId: c.id, accessUrl, name: buyerName, trial: trialActivation, funnel: buyFunnel, ...(siteUrl ? { siteUrl } : {}) }).catch(() => {});
        if (draft) await db.kvSet(pgKey(buyDraft), { ...draft, purchased: c.id, purchasedAt: new Date().toISOString() }).catch(() => {});
        db.bumpMetric(`fn:${buyFunnel}:sale`).catch(() => {}); // Embudos board: account created by this funnel
        const av = await db.getContractorBySlug("alto-ventas").catch(() => null);
        if (av) {
          const linfo = { src: "app-buy", plan: plan2, trial: trialActivation, funnel: buyFunnel, access: accessUrl };
          const leadId = await db.addLead(av.id, { name: buyerName, phone, address: "", info: linfo }).catch(() => null);
          forwardLead(av, { id: leadId, name: buyerName, phone, ...linfo });
          notifyLead(av, { id: leadId, name: buyerName, phone }).catch(() => {});
        }
        console.log(`stripe webhook: AUTO-PROVISIONED ${c.slug} (${trialActivation ? "trial" : "paid"} ${plan2})`);
        return res.json({ ok: true, matched: false, auto: true });
      } catch (e) { console.error("auto-provision failed:", e.message); /* fall through to the marker */ }
    }
    // Fallback (invoice events, or auto-provision failure): remember the
    // activation so the account activates the moment a human creates it.
    if (paidActivation || trialActivation) {
      const marker = { customerId, email, phone, plan: paidPlan || trialPlan, amountCents, trial: trialActivation || undefined, evId: obj.id || null, at: new Date().toISOString() };
      if (phone) await db.kvSet(`paid:${phone}`, marker).catch(() => {});
      if (email) await db.kvSet(`paid:${email}`, marker).catch(() => {});
    }
    console.log("stripe webhook: no contractor match for", event.type, customerId, email, phone,
      paidActivation ? `(paid ${paidPlan})` : trialActivation ? `(trial ${trialPlan})` : "(ignored)");
    return res.json({ ok: true, matched: false });
  }

  // Build a MINIMAL field patch (not a whole-document rewrite) so a payment
  // event can't clobber an unrelated field a concurrent onboarding/admin save
  // changed between our read and write. `undefined` in the patch deletes the key.
  const cur = match.data || {};
  const patch = {};
  if (customerId) patch.stripeCustomer = customerId;
  // A STATE change is stale if an older event already moved this account. The
  // ledger records real money regardless of order (deduped); only the
  // entitlement state is ordering-sensitive.
  const stale = evTime < (Number(cur.billingEventAt) || 0);
  const addLedger = (row) => {
    const payments = Array.isArray(cur.payments) ? cur.payments.slice(-59) : [];
    if (!payments.some((p) => p.evId === row.evId)) payments.push(row);
    patch.payments = payments;
  };
  if (paidActivation) {
    // Ledger keyed by the INVOICE id when present so a subscription's
    // checkout.session AND its invoice.paid (same money) collapse to one row.
    const ledgerId = obj.invoice || obj.id;
    if (ledgerId) addLedger({
      evId: ledgerId,
      at: new Date(evTime * 1000).toISOString(),
      amount: Math.round(amountCents) / 100,
      url: obj.hosted_invoice_url || obj.invoice_pdf || null,
    });
    if (!stale) {
      patch.status = undefined; // unpause — access back the second the card goes through
      patch.payFailedAt = undefined;
      patch.payStatus = "ok";
      patch.plan = paidPlan; // the plan actually paid (an upgrade retags too)
      patch.billingEventAt = evTime;
      // Embudos board: a trial that survives to real money is the funnel's
      // TRUE conversion — count it once, on the trial→ok transition.
      if (cur.payStatus === "trial") db.bumpMetric(`fn:${cur.funnel || "app"}:paid`).catch(() => {});
    }
  } else if (trialActivation) {
    if (!stale) {
      patch.status = undefined; // access starts today — $0 collected, card on file
      patch.payFailedAt = undefined;
      patch.payStatus = "trial";
      patch.plan = trialPlan;
      patch.trialStartedAt = cur.trialStartedAt || new Date(evTime * 1000).toISOString();
      patch.billingEventAt = evTime;
    }
  } else if (event.type === "charge.refunded") {
    // Reverse refunded money in the ledger (negative row, idempotent). Access
    // is handled by the separate subscription.deleted event, not here.
    const refunded = obj.amount_refunded ?? 0;
    if (refunded > 0 && obj.id) addLedger({
      evId: "refund:" + obj.id,
      at: new Date(evTime * 1000).toISOString(),
      amount: -Math.round(refunded) / 100,
      url: obj.receipt_url || null,
      refund: true,
    });
  } else if (event.type === "invoice.payment_failed") {
    if (!stale) { patch.payStatus = "failed"; patch.payFailedAt = cur.payFailedAt || new Date().toISOString(); patch.billingEventAt = evTime; }
  } else if (event.type === "customer.subscription.deleted") {
    if (!stale) {
      patch.status = "paused"; patch.payStatus = "canceled"; patch.billingEventAt = evTime;
      // Embudos board: a cancel DURING the trial week (never paid a cent)
      if (cur.payStatus === "trial") db.bumpMetric(`fn:${cur.funnel || "app"}:cancel`).catch(() => {});
    }
  }
  await db.patchContractorData(match.id, patch);
  console.log(`stripe webhook: ${event.type} → ${match.slug} (${patch.payStatus || cur.payStatus || "—"}${patch.status ? ", " + patch.status : ""})`);
  res.json({ ok: true });
});

app.use(express.json({ limit: "2mb" })); // job photos travel in /api/state
app.use(express.urlencoded({ extended: false }));

// Real client IP for rate limiting. With `trust proxy` set, req.ip is the
// left-most address Express trusts — NOT a client-spoofable header value.
const clientIp = (req) => req.ip || req.socket?.remoteAddress || "?";

// The bare brand domain shows the sales landing page; the app lives on
// app.alto-pro.com (and keeps working on the onrender.com address).
app.use((req, res, next) => {
  const h = String(req.hostname || "").toLowerCase();
  if ((h === "alto-pro.com" || h === "www.alto-pro.com") && (req.path === "/" || req.path === "/index.html")) {
    // Demo (?demo=roof — the sales deck's phone mockup embeds the REAL app),
    // owner passcode and session links must reach the app, not the landing.
    if (req.query.demo != null || req.query.pass != null || req.query.s != null) return next();
    return res.send(landingPage(req));
  }
  next();
});

/* ── Client website host-routing ──
 * A client's site lives at app.alto-pro.com/site/<slug>. When a request
 * arrives on a client's own domain (custom .com via Cloudflare for SaaS) or
 * on <slug>.alto-pro.com, we serve that client's site by rewriting the root
 * path to /site/<slug>. Our own hosts and all non-root paths (assets, /api,
 * /w, …) pass straight through untouched. */
const OUR_HOSTS = new Set(["app.alto-pro.com", "alto-pro.com", "www.alto-pro.com", "localhost", "127.0.0.1", ""]);
function reqHost(req) {
  return String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].split(":")[0].trim().toLowerCase();
}
app.use(async (req, res, next) => {
  const h = reqHost(req);
  if (OUR_HOSTS.has(h) || h.endsWith(".onrender.com")) return next();
  // only take over site page navigations (home, city pages, review funnel,
  // sitemap/robots); let assets/api/widget pass through untouched
  if (req.method !== "GET") return next();
  const p = req.path;
  const wants = p === "/" || p === "/index.html" || p === "/opina" || p === "/sitemap.xml" || p === "/robots.txt" || /^\/zona\/[a-z0-9-]{1,60}$/.test(p);
  if (!wants) return next();
  try {
    let slug = null;
    if (h.endsWith(".alto-pro.com")) slug = h.slice(0, -13); // <slug>.alto-pro.com
    else {
      // domains are stored bare (mirandaroofing.com) but visitors may arrive on www.
      const c = (await db.getContractorByDomain(h)) || (h.startsWith("www.") ? await db.getContractorByDomain(h.slice(4)) : null);
      slug = c?.slug || null;
    }
    if (slug) {
      const s = encodeURIComponent(slug);
      if (p === "/" || p === "/index.html") req.url = `/site/${s}`;
      else if (p === "/opina") req.url = `/opina/${s}`;
      else req.url = `/site/${s}${p}`; // /zona/<city>, /sitemap.xml, /robots.txt
    }
  } catch (e) { console.error("host routing:", e.message); }
  next();
});

// Personalized PWA manifest: when a logged-in client installs the app, the page
// points the manifest at /manifest.webmanifest?s=<session> so the installed
// home-screen app opens already logged in (iOS gives it its own storage, so the
// Safari login wouldn't otherwise carry over). Registered before the static dir
// so it wins over the file. No ?s → the plain default manifest.
app.get("/manifest.webmanifest", (req, res) => {
  const s = String(req.query.s || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 120);
  res.type("application/manifest+json").send(JSON.stringify({
    name: "ALTO Pro", short_name: "ALTO Pro",
    description: "Cotiza techos en 60 segundos. Estimados, facturas y cobros para contratistas.",
    start_url: s ? `/?s=${s}` : "/",
    display: "standalone", background_color: "#101B30", theme_color: "#101B30", lang: "es",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  }));
});

// Serve the built app (run `npm run build` first) so one process can host
// everything in production; in dev, Vite serves the app and proxies /api here.
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
// Never let the app shell (index.html) be cached — otherwise a phone or CDN can
// keep loading an OLD build (and its old code) for days after a deploy. The JS/CSS
// under /assets are content-hashed and immutable, so those still cache long.
app.get(["/", "/index.html"], (req, res) => {
  res.set("Cache-Control", "no-cache, no-store, must-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  res.sendFile(path.join(dist, "index.html"));
});
app.use(express.static(dist, {
  setHeaders(res, filePath) {
    if (filePath.includes(`${path.sep}assets${path.sep}`)) {
      res.set("Cache-Control", "public, max-age=31536000, immutable");
    } else if (filePath.endsWith("index.html")) {
      res.set("Cache-Control", "no-cache, no-store, must-revalidate");
    }
  },
}));

/* ── Demo data (mirrors the frontend's offline fallback) ── */
const PITCH_FACTORS = { 3: 1.031, 4: 1.054, 5: 1.083, 6: 1.118, 7: 1.158, 8: 1.202, 9: 1.25, 10: 1.302, 12: 1.414 };
const MOCK_PROPERTIES = [
  { addr: "456 Oak Dr, Rio Grande City, TX", roofArea: 2460, pitch: "6", stories: 1, beds: 3, baths: 2, sqft: 1850, year: 2004, segments: 4 },
  { addr: "210 Mesquite Ln, Roma, TX", roofArea: 3120, pitch: "4", stories: 1, beds: 4, baths: 2, sqft: 2400, year: 1998, segments: 6 },
  { addr: "88 Palma St, La Grulla, TX", roofArea: 1690, pitch: "5", stories: 1, beds: 2, baths: 1, sqft: 1240, year: 1987, segments: 2 },
  { addr: "1204 Cenizo Ct, Rio Grande City, TX", roofArea: 3890, pitch: "8", stories: 2, beds: 4, baths: 3, sqft: 2980, year: 2019, segments: 8 },
  { addr: "35 Rancho Viejo Rd, Garciasville, TX", noData: true },
];

const hashAddr = (s) => { let h = 7; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 99991; return h; };

function mockLookup(addr) {
  const h = hashAddr(addr.toLowerCase());
  // Deterministic coords (RGV area) so the offline demo can open the trace tool.
  const coords = { lat: 26.3796 + ((h % 200) - 100) / 8000, lng: -98.8203 + ((h % 160) - 80) / 8000 };
  const known = MOCK_PROPERTIES.find((p) => p.addr.toLowerCase() === addr.toLowerCase());
  if (known) return known.noData ? null : { ...coords, ...known };
  const stories = h % 5 === 0 ? 2 : 1;
  const sqft = 1100 + (h % 1900);
  const pitch = ["4", "5", "6", "8"][h % 4];
  return {
    ...coords, addr, stories, sqft, pitch,
    beds: 2 + (h % 3), baths: 1 + (h % 3 === 0 ? 1 : 0),
    year: 1975 + (h % 50), segments: 2 + (h % 7),
    roofArea: Math.round((sqft / stories) * PITCH_FACTORS[pitch] * 1.12),
  };
}

/* Convert a roof pitch in degrees to the nearest x/12 key the app uses. */
function pitchKeyFromDegrees(deg) {
  const rise = Math.tan((deg * Math.PI) / 180) * 12;
  let best = "6", bestDiff = Infinity;
  for (const k of Object.keys(PITCH_FACTORS)) {
    const d = Math.abs(rise - Number(k));
    if (d < bestDiff) { bestDiff = d; best = k; }
  }
  return best;
}

/* ── Live lookups ── */
// GMAPS_BASE override exists ONLY so integration tests can stub Google
// locally (scripts run a fixture server); production never sets it.
const GMAPS_BASE = process.env.GMAPS_BASE || "https://maps.googleapis.com";
async function geocode(address) {
  const url = `${GMAPS_BASE}/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${GOOGLE_KEY}`;
  const j = await (await fetch(url)).json();
  const r = j.results?.[0];
  if (!r) return null;
  // location_type: ROOFTOP is building-exact; RANGE_INTERPOLATED / GEOMETRIC_CENTER /
  // APPROXIMATE pins can land on the neighbor — the lookup flags those.
  return { lat: r.geometry.location.lat, lng: r.geometry.location.lng, formatted: r.formatted_address, locType: r.geometry.location_type || null };
}

/* Google's encoded-polyline format → [{lat,lng}] (Routes API returns routes
 * encoded; the app draws them as a plain Polyline). */
function decodePolyline(str) {
  const pts = []; let i = 0, lat = 0, lng = 0;
  while (i < str.length) {
    for (const which of [0, 1]) {
      let shift = 0, result = 0, b;
      do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      const d = (result & 1) ? ~(result >> 1) : (result >> 1);
      if (which === 0) lat += d; else lng += d;
    }
    pts.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return pts;
}

/* GPS coordinates → street address (the contractor parked outside the job) */
async function reverseGeocode(lat, lng) {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_KEY}`;
  const j = await (await fetch(url)).json();
  return j.results?.[0]?.formatted_address || `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
}

/* Place details give the exact building location the user picked in
 * autocomplete — more accurate than re-geocoding the address text, which can
 * land on a nearby outbuilding. */
async function placeDetails(placeId) {
  const r = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
    headers: { "X-Goog-Api-Key": GOOGLE_KEY, "X-Goog-FieldMask": "location,formattedAddress" },
  });
  if (!r.ok) return null;
  const j = await r.json();
  if (!j.location) return null;
  return { lat: j.location.latitude, lng: j.location.longitude, formatted: j.formattedAddress || "" };
}

async function solarLookup(lat, lng) {
  const url = `https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${lat}&location.longitude=${lng}&requiredQuality=LOW&key=${GOOGLE_KEY}`;
  const res = await fetch(url);
  if (!res.ok) return null; // 404 = no building data for this location
  const j = await res.json();
  const sp = j.solarPotential;
  if (!sp?.wholeRoofStats?.areaMeters2) return null;
  const segsRaw = sp.roofSegmentStats || [];
  // Area-weighted average pitch across roof segments
  let pitchDeg = 22, totalArea = 0, weighted = 0;
  for (const s of segsRaw) {
    const a = s.stats?.areaMeters2 || 0;
    totalArea += a;
    weighted += (s.pitchDegrees || 0) * a;
  }
  if (totalArea > 0) pitchDeg = weighted / totalArea;
  // Per-section detail for the measurement overlay (largest first, capped)
  const segs = segsRaw
    .map((s) => ({
      area: Math.round((s.stats?.areaMeters2 || 0) * 10.7639),
      pitch: Math.max(0, Math.round(Math.tan(((s.pitchDegrees || 0) * Math.PI) / 180) * 12)),
      box: s.boundingBox
        ? [s.boundingBox.sw.latitude, s.boundingBox.sw.longitude, s.boundingBox.ne.latitude, s.boundingBox.ne.longitude]
        : null,
    }))
    .filter((s) => s.area >= 25 && s.box) // skip slivers that just clutter the overlay
    .sort((a, b) => b.area - a.area)
    .slice(0, 8);
  const bb = j.boundingBox;
  return {
    roofArea: Math.round(sp.wholeRoofStats.areaMeters2 * 10.7639),
    pitch: pitchKeyFromDegrees(pitchDeg),
    segments: segsRaw.length || 1,
    segs,
    bbox: bb ? [bb.sw.latitude, bb.sw.longitude, bb.ne.latitude, bb.ne.longitude] : null,
    imageryDate: j.imageryDate ? `${j.imageryDate.month}/${j.imageryDate.year}` : null,
    imageryYear: j.imageryDate?.year || null,
    quality: j.imageryQuality || null,
  };
}

/* ── True roof outline from the Solar API building mask ──
 * dataLayers returns a GeoTIFF where roof pixels are 1. We trace the boundary
 * of the building at the center and simplify it to a clean polygon. */
function simplifyPoly(pts, eps) {
  const dseg = (p, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    if (!dx && !dy) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  };
  const dp = (seg) => {
    if (seg.length < 3) return seg;
    let maxD = 0, idx = 0;
    for (let i = 1; i < seg.length - 1; i++) {
      const d = dseg(seg[i], seg[0], seg[seg.length - 1]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD <= eps) return [seg[0], seg[seg.length - 1]];
    return [...dp(seg.slice(0, idx + 1)).slice(0, -1), ...dp(seg.slice(idx))];
  };
  return dp(pts);
}

function traceMaskOutline(data, w, h) {
  const at = (x, y) => x >= 0 && y >= 0 && x < w && y < h && data[y * w + x] > 0;
  // nearest roof pixel to the image center
  const cx = w >> 1, cy = h >> 1;
  let sx = -1, sy = -1;
  outer: for (let r = 0; r < Math.max(w, h); r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      if (at(cx + dx, cy + dy)) { sx = cx + dx; sy = cy + dy; break outer; }
    }
  }
  if (sx < 0) return null;
  // flood-fill the building the pixel belongs to (ignore neighbors in frame)
  const comp = new Uint8Array(w * h);
  const stack = [[sx, sy]];
  comp[sy * w + sx] = 1;
  while (stack.length) {
    const [x, y] = stack.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (at(nx, ny) && !comp[ny * w + nx]) { comp[ny * w + nx] = 1; stack.push([nx, ny]); }
    }
  }
  const inC = (x, y) => x >= 0 && y >= 0 && x < w && y < h && comp[y * w + x] === 1;
  // boundary start: topmost-left pixel of the component
  let bx = -1, by = -1;
  scan: for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (comp[y * w + x]) { bx = x; by = y; break scan; }
  // Moore-neighbor boundary tracing (clockwise from the backtrack direction)
  const dirs = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1]]; // W NW N NE E SE S SW
  const pts = [];
  let px = bx, py = by, back = 0;
  for (let iter = 0; iter < 60000; iter++) {
    pts.push([px, py]);
    let found = -1;
    for (let k = 1; k <= 8; k++) {
      const d = (back + k) % 8;
      if (inC(px + dirs[d][0], py + dirs[d][1])) { found = d; break; }
    }
    if (found < 0) break; // single-pixel component
    px += dirs[found][0];
    py += dirs[found][1];
    back = (found + 6) % 8;
    if (px === bx && py === by && pts.length > 2) break;
  }
  if (pts.length < 8) return null;
  let eps = 1.5, out = simplifyPoly(pts, eps);
  while (out.length > 60 && eps < 8) { eps += 1; out = simplifyPoly(pts, eps); }
  return out;
}

/* Straighten a traced outline so it reads like a drawn roof diagram:
 * simplify, find the building's dominant orientation, snap near-axis edges
 * square, then merge collinear runs and slivers. Input/output [lat,lng]. */
function regularizeOutline(ll) {
  if (!ll || ll.length < 4) return ll;
  const k = Math.PI / 180, R = 6378137;
  const la0 = ll[0][0], ln0 = ll[0][1], c = Math.cos(la0 * k);
  let pts = ll.map(([la, ln]) => [(ln - ln0) * k * R * c, (la - la0) * k * R]); // local meters
  pts = simplifyPoly(pts, 0.6);
  if (pts.length >= 2 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 0.3) pts.pop();
  if (pts.length < 4) return ll;
  // dominant direction mod 90°, length-weighted (angle-quadrupling trick)
  let sx = 0, sy = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]) * 4;
    sx += Math.cos(ang) * len; sy += Math.sin(ang) * len;
  }
  const theta = Math.atan2(sy, sx) / 4;
  const rot = (p, t) => [p[0] * Math.cos(t) - p[1] * Math.sin(t), p[0] * Math.sin(t) + p[1] * Math.cos(t)];
  const q = pts.map(p => rot(p, -theta));
  // relax near-axis edges square; leave true diagonals (hips, angled walls) alone
  for (let iter = 0; iter < 10; iter++) {
    for (let i = 0; i < q.length; i++) {
      const j = (i + 1) % q.length;
      const dx = q[j][0] - q[i][0], dy = q[j][1] - q[i][1];
      const a = Math.abs(Math.atan2(dy, dx)) % (Math.PI / 2);
      if (Math.min(a, Math.PI / 2 - a) > 25 * k) continue;
      if (Math.abs(dx) > Math.abs(dy)) { const m = (q[i][1] + q[j][1]) / 2; q[i][1] = m; q[j][1] = m; }
      else { const m = (q[i][0] + q[j][0]) / 2; q[i][0] = m; q[j][0] = m; }
    }
  }
  // drop collinear vertices
  let r = [];
  for (let i = 0; i < q.length; i++) {
    const prev = q[(i - 1 + q.length) % q.length], cur = q[i], nxt = q[(i + 1) % q.length];
    let d = Math.abs(Math.atan2(cur[1] - prev[1], cur[0] - prev[0]) - Math.atan2(nxt[1] - cur[1], nxt[0] - cur[0]));
    if (d > Math.PI) d = 2 * Math.PI - d;
    if (d < 6 * k) continue;
    r.push(cur);
  }
  if (r.length < 4) r = q;
  // merge sliver edges
  const r2 = [];
  for (let i = 0; i < r.length; i++) {
    const nxt = r[(i + 1) % r.length];
    if (Math.hypot(nxt[0] - r[i][0], nxt[1] - r[i][1]) < 0.9) {
      nxt[0] = (nxt[0] + r[i][0]) / 2; nxt[1] = (nxt[1] + r[i][1]) / 2;
      continue;
    }
    r2.push(r[i]);
  }
  if (r2.length >= 4) r = r2;
  return r.map(p => {
    const [X, Y] = rot(p, theta);
    return [+(la0 + Y / (R * k)).toFixed(7), +(ln0 + X / (R * k * c)).toFixed(7)];
  });
}

async function roofOutline(lat, lng, clipBbox) {
  const u = `https://solar.googleapis.com/v1/dataLayers:get?location.latitude=${lat}&location.longitude=${lng}&radiusMeters=30&requiredQuality=LOW&key=${GOOGLE_KEY}`;
  const r = await fetch(u);
  if (!r.ok) return null;
  const j = await r.json();
  if (!j.maskUrl) return null;
  const buf = await (await fetch(`${j.maskUrl}&key=${GOOGLE_KEY}`)).arrayBuffer();
  const tiff = await fromArrayBuffer(buf);
  const img = await tiff.getImage();
  const w = img.getWidth(), h = img.getHeight();
  const [minX, minY, maxX, maxY] = img.getBoundingBox();
  // The mask arrives in the local UTM zone (projected meters) — convert to lat/lng
  const gk = img.getGeoKeys?.() || {};
  const code = gk.ProjectedCSTypeGeoKey || gk.GeographicTypeGeoKey || 4326;
  let toLl, fromLl;
  if (code === 4326) {
    toLl = (x, y) => [y, x];
    fromLl = (la, ln) => [ln, la];
  } else {
    let def = null;
    if (code >= 32601 && code <= 32660) def = `+proj=utm +zone=${code - 32600} +datum=WGS84 +units=m +no_defs`;
    else if (code >= 32701 && code <= 32760) def = `+proj=utm +zone=${code - 32700} +south +datum=WGS84 +units=m +no_defs`;
    else if (code === 3857) def = "EPSG:3857";
    if (!def) return null;
    const conv = proj4(def, "WGS84");
    toLl = (x, y) => { const [ln, la] = conv.forward([x, y]); return [la, ln]; };
    fromLl = (la, ln) => conv.inverse([ln, la]);
  }
  const data = (await img.readRasters())[0];
  // Clip to the target building's bounding box (padded ~3m) so the outline
  // can't bleed into a touching neighbor's roof in the mask.
  if (clipBbox) {
    const [sLat, wLng, nLat, eLng] = clipBbox;
    const [x1, y1] = fromLl(sLat, wLng), [x2, y2] = fromLl(nLat, eLng);
    const toPx = (X, Y) => [((X - minX) / (maxX - minX)) * w, ((maxY - Y) / (maxY - minY)) * h];
    const [pxa, pya] = toPx(x1, y1), [pxb, pyb] = toPx(x2, y2);
    const pad = 12;
    const xLo = Math.min(pxa, pxb) - pad, xHi = Math.max(pxa, pxb) + pad;
    const yLo = Math.min(pya, pyb) - pad, yHi = Math.max(pya, pyb) + pad;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (x < xLo || x > xHi || y < yLo || y > yHi) data[y * w + x] = 0;
    }
  }
  const px = traceMaskOutline(data, w, h);
  if (!px) return null;
  const raw = px.map(([x, y]) => {
    const [la, ln] = toLl(minX + ((x + 0.5) / w) * (maxX - minX), maxY - ((y + 0.5) / h) * (maxY - minY));
    return [+la.toFixed(7), +ln.toFixed(7)];
  });
  return regularizeOutline(raw);
}

async function rentcastLookup(address) {
  const url = `https://api.rentcast.io/v1/properties?address=${encodeURIComponent(address)}`;
  const res = await fetch(url, { headers: { "X-Api-Key": RENTCAST_KEY } });
  if (!res.ok) return null;
  const j = await res.json();
  const p = Array.isArray(j) ? j[0] : j;
  if (!p) return null;
  return {
    beds: p.bedrooms ?? null,
    baths: p.bathrooms ?? null,
    sqft: p.squareFootage ?? null,
    year: p.yearBuilt ?? null,
    stories: p.features?.floorCount ?? null,
  };
}

/* ── Routes ── */
/* Self-diagnosis: runs a live Regrid test from the server and reports the
 * raw outcome, so problems can be debugged by opening one URL. */
app.get("/api/diag", async (req, res) => {
  if (!adminOk(req)) return res.status(403).json({ error: "no auth" }); // spends live Regrid quota
  // tokenLen catches a truncated paste (a real Regrid JWT is hundreds of chars;
  // the dashboard textbox only SHOWS ~60 — selecting the visible text truncates it)
  const out = { google: !!GOOGLE_KEY, regridKeySet: !!REGRID_KEY, regridTokenLen: (REGRID_KEY || "").length, rentcast: !!RENTCAST_KEY, ai: aiLive };
  const testPoint = async (label, lat, lon, radius, auth = "query") => {
    const t = {};
    try {
      const base = `${process.env.REGRID_BASE || "https://app.regrid.com"}/api/v2/parcels/point?lat=${lat}&lon=${lon}&radius=${radius}`;
      const r = auth === "bearer"
        ? await fetch(base, { headers: { Authorization: `Bearer ${REGRID_KEY}` } })
        : await fetch(`${base}&token=${REGRID_KEY}`);
      t.status = r.status;
      const body = await r.text();
      if (r.ok) {
        const j = JSON.parse(body);
        t.features = j?.parcels?.features?.length ?? null;
        t.geometryType = j?.parcels?.features?.[0]?.geometry?.type || null;
        t.sampleProps = Object.keys(j?.parcels?.features?.[0]?.properties?.fields || {}).slice(0, 6);
        // empty-but-200 is the confusing case — show what Regrid actually said
        if (!t.features) t.body = body.slice(0, 300);
      } else {
        t.error = body.slice(0, 300);
      }
    } catch (e) { t.error = e.message; }
    out[label] = t;
  };
  if (REGRID_KEY) {
    // radius 250 = Regrid's own docs example — an exact point often sits in the
    // road, so a tight radius reads as "no data" when coverage is fine.
    await testPoint("rioGrandeCity", req.query.lat || 26.3827418, req.query.lon || -98.8196915, 250);
    await testPoint("detroitDocsExample", 42.36511, -83.073107, 250);
    // same point, token in the Authorization header — tells apart "sandbox
    // token wants header auth" from "trial has no data access" in one run
    await testPoint("detroitBearerAuth", 42.36511, -83.073107, 250, "bearer");
    // ?address= runs the REAL app path: geocode → cached resolver → match state
    if (req.query.address) {
      const t = {};
      try {
        const g = await geocode(String(req.query.address));
        if (!g) t.error = "geocode found nothing";
        else {
          const v2 = await resolveParcel(g.lat, g.lng);
          Object.assign(t, { formatted: g.formatted, locType: g.locType, state: v2.state, reason: v2.reason || null,
            candidates: (v2.candidates || []).map((c) => ({ addr: c.addr, contains: c.contains, rawPts: c.raw?.length })) });
        }
      } catch (e) { t.error = e.message; }
      out.addressTest = t;
    }
  }
  res.json(out);
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, db: db.dbKind(), live: { google: !!GOOGLE_KEY, parcels: !!REGRID_KEY, property: !!RENTCAST_KEY, ai: aiLive, push: !!(VAPID_PUBLIC && VAPID_PRIVATE) } });
});

app.get("/api/places", async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (q.length < 3) return res.json({ suggestions: [], source: "demo" }); // no billable call for 1-2 chars
  // Anonymous by design (address autocomplete on public widgets), but capped so
  // automated traffic can't run up the Google bill: per-IP + global daily.
  if (overQuota(`places:${clientIp(req)}`, 120) || overQuota("places:all", 20000)) return res.json({ suggestions: [], source: "quota" });
  if (GOOGLE_KEY) {
    try {
      const r = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": GOOGLE_KEY },
        body: JSON.stringify({ input: q, includedRegionCodes: ["us"] }),
      });
      if (r.ok) {
        const j = await r.json();
        const sugs = (j.suggestions || [])
          .map((s) => ({ text: s.placePrediction?.text?.text, placeId: s.placePrediction?.placeId || null }))
          .filter((s) => s.text)
          .slice(0, 5);
        return res.json({ suggestions: sugs, source: "live" });
      }
      console.error("places failed:", r.status, await r.text());
    } catch (e) {
      console.error("places failed:", e.message);
    }
  }
  const ql = q.toLowerCase();
  res.json({
    suggestions: MOCK_PROPERTIES.map((p) => p.addr).filter((a) => a.toLowerCase().includes(ql)).map((a) => ({ text: a, placeId: null })),
    source: "demo",
  });
});

/* ── Parcel boundary (Regrid) for the fence estimator ──
 * The matching logic lives in server/parcel.mjs (unit-testable): containment-
 * first, limited candidate set, Polygon+MultiPolygon, distinct states instead
 * of collapsing everything into null. The resolver adds the 90-day cache,
 * in-flight dedupe and pl_* metrics. See scripts/parcel-test.mjs. */
const resolveParcel = makeParcelResolver({
  token: REGRID_KEY,
  kvGet: (k, age) => db.kvGet(k, age),
  kvSet: (k, v) => db.kvSet(k, v),
  bump: (ev, by) => db.bumpMetric(ev, by).catch(() => {}),
});

/* Curated public-demo examples: real parcels the owner seeded ONCE via the
 * admin endpoint below (a normal lot, a corner lot, a cul-de-sac). Anonymous
 * demo users open these instead of spending live Regrid lookups — clearly
 * labeled examples, cached forever. */
async function parcelExamples() {
  const out = [];
  for (const slot of [1, 2, 3]) {
    const ex = await db.kvGet(`parcel_example:${slot}`).catch(() => null);
    if (ex?.parcel?.length >= 3) out.push({ slot, name: ex.name, addr: ex.addr, lat: ex.lat, lng: ex.lng, parcel: ex.parcel });
  }
  return out;
}

/* Admin: seed/replace a curated demo example — geocodes the address, runs a
 * live (cached, metered) parcel lookup, and stores the display ring. Usage:
 * /api/admin/parcel-example?slot=1&name=Lote normal&address=... */
app.get("/api/admin/parcel-example", async (req, res) => {
  if (!adminOk(req)) return res.status(403).json({ error: "no auth" });
  const slot = parseInt(String(req.query.slot || ""), 10);
  const address = String(req.query.address || "").trim();
  if (![1, 2, 3].includes(slot) || address.length < 6) return res.status(400).json({ error: "slot 1-3 y address requeridos" });
  if (!GOOGLE_KEY) return res.status(503).json({ error: "no_maps" });
  const geo = await geocode(address).catch(() => null);
  if (!geo) return res.status(404).json({ error: "dirección no encontrada" });
  const v2 = await resolveParcel(geo.lat, geo.lng).catch(() => ({ state: "provider_error", candidates: [] }));
  if (v2.state !== "found") return res.status(422).json({ error: `parcela no encontrada (${v2.state})`, state: v2.state });
  const name = String(req.query.name || geo.formatted).slice(0, 60);
  await db.kvSet(`parcel_example:${slot}`, { name, addr: geo.formatted, lat: geo.lat, lng: geo.lng, parcel: v2.candidates[0].disp });
  res.json({ ok: true, slot, name, addr: geo.formatted, points: v2.candidates[0].disp.length });
});

/* Admin: flush the whole parcel cache. Needed after a bad-token window:
 * Regrid answers 200-empty for a broken key, the resolver reads that as
 * not_found, and not_found IS cached (90d) — so addresses tried during the
 * outage stay "sin lote" until this is hit. One URL, all parcel2:* rows. */
app.get("/api/admin/parcel-cache-clear", async (req, res) => {
  if (!adminOk(req)) return res.status(403).json({ error: "no auth" });
  const cleared = await db.kvDeletePrefix("parcel2:").catch(() => 0);
  res.json({ ok: true, cleared });
});

/* ── Live material prices (Home Depot via SerpApi) ──
 * A REFERENCE the contractor peeks at from the products editor — never the
 * quote engine. Curated Valley staples, priced at the zip's store, cached
 * 24h per zip so the whole market costs ~10 credits/day. Paid accounts and
 * the private demo only (same wallet rule as parcels). */
const SERPAPI_KEY = process.env.SERPAPI_KEY || "";
const SERPAPI_BASE = process.env.SERPAPI_BASE || "https://serpapi.com"; // test override
const HD_ZIP = process.env.HD_ZIP || "78501"; // McAllen default
const HD_MATERIALS = [
  // The MASTER list (owner-finalized): what a Valley fence contractor buys.
  // `k` is the stable key the app's per-quote takeoff math references.
  { k: "picketCedar", es: "Picket de cedro dog-ear 6 ft", en: "Cedar dog-ear picket 6 ft", q: "cedar dog-ear fence picket 6 ft" },
  { k: "picketPine", es: "Picket pino tratado 6 ft", en: "Treated pine picket 6 ft", q: "6 ft pressure treated pine dog ear fence picket" },
  { k: "post44", es: "Poste 4x4x8 tratado", en: "Treated 4x4x8 post", q: "4 in x 4 in x 8 ft pressure treated timber" },
  { k: "postSteel", es: "Poste de acero 8 ft (Postmaster)", en: "Steel fence post 8 ft (Postmaster)", q: "postmaster steel fence post 8 ft" },
  { k: "rail24", es: "Riel 2x4x8 tratado", en: "Treated 2x4x8 rail", q: "2x4x8 pressure treated lumber" },
  { k: "rot26", es: "Tabla patín 2x6x8 tratada", en: "Treated 2x6x8 rot board", q: "2 in x 6 in x 8 ft pressure treated lumber" },
  { k: "concrete", es: "Concreto 50 lb (fraguado rápido)", en: "Concrete mix 50 lb fast-setting", q: "quikrete 50 lb fast setting concrete mix" },
  { k: "chainFabric", es: "Malla galvanizada 4x50 ft", en: "Chain link fabric 4x50 ft", q: "4 ft x 50 ft 11.5 gauge galvanized chain link fence fabric" },
  { k: "chainTerm", es: "Poste terminal 2-3/8 in galv.", en: "Terminal post 2-3/8 in galv.", q: "2-3/8 in x 8 ft galvanized chain link terminal post" },
  { k: "chainTop", es: "Top rail 1-3/8 x 10.5 ft", en: "Top rail 1-3/8 x 10.5 ft", q: "1-3/8 in x 10.5 ft galvanized chain link top rail" },
  { k: "vinylPanel", es: "Panel vinilo privacidad 6x8", en: "Vinyl privacy panel 6x8", q: "6 ft x 8 ft white vinyl privacy fence panel" },
  { k: "gateKit", es: "Kit herrajes de puerta", en: "Gate hardware kit", q: "fence gate hardware kit hinges latch" },
];
app.post("/api/fence/materials", async (req, res) => {
  const me = await auth(req).catch(() => null);
  const demoOk = !!DEMO_PASS && String(req.body?.demo || "") === DEMO_PASS;
  if (!SERPAPI_KEY) return res.status(503).json({ error: "not_configured" });
  if (overQuota(`hdmat:${clientIp(req)}`, 30)) return res.status(429).json({ error: "quota" });
  const zip = /^\d{5}$/.test(String(req.body?.zip || "")) ? String(req.body.zip) : HD_ZIP;
  const key = `hdmat3:${zip}`; // v3: takeoff keys + retuned picket/rail queries
  // ── Anonymous funnel demo: CACHE-ONLY ── the /app-cercas 3-try demo gets
  // real Home Depot prices whenever a paid account already warmed this zip
  // today, and NEVER spends a SerpApi credit itself. Cold cache → the same
  // no_auth the app already turns into its local-prices fallback.
  if (!me && !demoOk) {
    const hit = await db.kvGet(key, 24 * 3600 * 1000).catch(() => null);
    if (hit && hit.items) { db.bumpMetric("mat_demo").catch(() => {}); return res.json(hit); }
    return res.status(403).json({ error: "no_auth" });
  }
  db.bumpMetric("mat_req").catch(() => {});
  const hit = await db.kvGet(key, 24 * 3600 * 1000).catch(() => null);
  if (hit && hit.items) { db.bumpMetric("mat_cache").catch(() => {}); return res.json(hit); }
  const items = await Promise.all(HD_MATERIALS.map(async (m) => {
    try {
      const ctrl = new AbortController();
      const tm = setTimeout(() => ctrl.abort(), 8000);
      const r = await fetch(`${SERPAPI_BASE}/search.json?engine=home_depot&q=${encodeURIComponent(m.q)}&delivery_zip=${zip}&api_key=${SERPAPI_KEY}`, { signal: ctrl.signal });
      clearTimeout(tm);
      if (!r.ok) throw new Error(`http_${r.status}`);
      const j = await r.json();
      const p = j.products?.[0];
      const thumb = Array.isArray(p?.thumbnails?.[0]) ? p.thumbnails[0][0] : (typeof p?.thumbnails?.[0] === "string" ? p.thumbnails[0] : null);
      return { k: m.k, es: m.es, en: m.en, price: p?.price ?? null, title: p?.title || null, thumb };
    } catch { return { k: m.k, es: m.es, en: m.en, price: null }; }
  }));
  const out = { zip, updatedAt: new Date().toISOString(), items };
  if (items.some((i) => i.price != null)) {
    await db.kvSet(key, out).catch(() => {});
    db.bumpMetric("mat_live").catch(() => {});
    return res.json(out);
  }
  db.bumpMetric("mat_err").catch(() => {});
  res.status(502).json({ error: "provider" });
});

/* ── Product photo lookup (Home Depot via SerpApi) ──
 * The fence product picker shows REAL catalog product shots instead of the
 * baked-in 3D renders: one search per product name, top-5 results cached 30
 * days per query (a catalog photo doesn't change), so the whole catalog
 * costs ~5 credits/month. `i` cycles through the cached results — the 🔄
 * button in the product editor when the first match grabbed the wrong item.
 * Same wallet rule as materials: paid accounts + the private demo only. */
app.post("/api/fence/prodimg", async (req, res) => {
  const me = await auth(req).catch(() => null);
  const demoOk = !!DEMO_PASS && String(req.body?.demo || "") === DEMO_PASS;
  if (!me && !demoOk) return res.status(403).json({ error: "no_auth" });
  if (!SERPAPI_KEY) return res.status(503).json({ error: "not_configured" });
  if (overQuota(`hdimg:${clientIp(req)}`, 40)) return res.status(429).json({ error: "quota" });
  const q = String(req.body?.q || "").trim().slice(0, 80);
  if (q.length < 3) return res.status(400).json({ error: "q required" });
  const i = Math.max(0, Math.min(9, parseInt(String(req.body?.i || "0"), 10) || 0));
  db.bumpMetric("pimg_req").catch(() => {});
  const key = `hdimg:${q.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60)}`;
  const pick = (list) => {
    const it = list[i % list.length];
    return it ? { img: it.img, title: it.title, n: list.length } : null;
  };
  const hit = await db.kvGet(key, 30 * 24 * 3600 * 1000).catch(() => null);
  if (hit?.list?.length) {
    db.bumpMetric("pimg_cache").catch(() => {});
    return res.json(pick(hit.list));
  }
  try {
    const ctrl = new AbortController();
    const tm = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(`${SERPAPI_BASE}/search.json?engine=home_depot&q=${encodeURIComponent(q)}&api_key=${SERPAPI_KEY}`, { signal: ctrl.signal });
    clearTimeout(tm);
    if (!r.ok) throw new Error(`http_${r.status}`);
    const j = await r.json();
    const list = (j.products || []).slice(0, 5).map((p) => {
      const t = Array.isArray(p?.thumbnails?.[0]) ? p.thumbnails[0][0] : (typeof p?.thumbnails?.[0] === "string" ? p.thumbnails[0] : null);
      // HD's CDN encodes the size in the filename — ask for the 600px render
      return t ? { img: String(t).replace(/_(\d{2,3})(\.\w+)$/, "_600$2"), title: p?.title || null } : null;
    }).filter(Boolean);
    if (!list.length) return res.status(404).json({ error: "no_match" });
    await db.kvSet(key, { list }).catch(() => {});
    db.bumpMetric("pimg_live").catch(() => {});
    res.json(pick(list));
  } catch (e) {
    db.bumpMetric("pimg_err").catch(() => {});
    res.status(502).json({ error: "provider" });
  }
});

/* Address → coordinates only (no Solar, no measurement) — powers the quick
 * invoice's "fotos de la casa": one cheap geocode so the document can show
 * the street photo and aerial view of the right house. */
app.post("/api/geocode", async (req, res) => {
  const me = await auth(req).catch(() => null);
  const demoOk = !!DEMO_PASS && String(req.body?.demo || "") === DEMO_PASS;
  if (!me && !demoOk) {
    if (overQuota(`geo:${clientIp(req)}`, 10)) return res.status(429).json({ error: "demo_limit" });
  } else if (me && clientLocked(me)) return res.status(403).json({ error: clientLocked(me) });
  if (!GOOGLE_KEY) return res.status(503).json({ error: "no_maps" });
  const { address = "", placeId = null } = req.body || {};
  if (!String(address).trim() && !placeId) return res.status(400).json({ error: "address required" });
  try {
    const geo = (placeId && (await placeDetails(String(placeId)).catch(() => null))) || (await geocode(String(address).slice(0, 200)));
    if (!geo) return res.status(404).json({ error: "not_found" });
    res.json({ lat: geo.lat, lng: geo.lng, formatted: geo.formatted });
  } catch (e) {
    console.error("geocode failed:", e.message);
    res.status(502).json({ error: "geocode_failed" });
  }
});

app.post("/api/lookup", async (req, res) => {
  // Demo mode (no account) gets a small daily allowance per IP — enough to be
  // wowed, not enough to freeload. Clients get a high anti-runaway ceiling.
  const me = await auth(req).catch(() => null);
  const lkIp = clientIp(req);
  // Private unlimited-demo passcode: the owner's personal link carries it so
  // they can show the app to contractors in person without the trial cap.
  const demoOk = !!DEMO_PASS && String(req.body?.demo || "") === DEMO_PASS;
  if (!me && !demoOk) {
    if (overQuota(`lk:${lkIp}`, 6)) return res.status(429).json({ error: "demo_limit" });
    // monthly allowance per connection — survives incognito/browser wipes, but
    // resets each month so carrier-shared IPs (CGNAT) don't lock out real
    // homeowners forever as strangers on the same IP burn the counter
    const lifetime = await db.incrCounter(`demolk:${lkIp}:${new Date().toISOString().slice(0, 7)}`).catch(() => 0);
    if (lifetime > 10) return res.status(429).json({ error: "demo_limit" });
  } else if (me) {
    // A client who stopped paying (paused) OR never paid (pending) is locked out
    // of measuring — the app shows the lock screen; this enforces it server-side
    // so it can't be bypassed and can't burn Solar/Maps money before payment.
    const locked = clientLocked(me);
    if (locked) return res.status(403).json({ error: locked });
    if (overQuota(`lkc:${me.id}`, 40)) return res.status(429).json({ error: "quota" }); // per-account daily measure cap
  }
  const address = String(req.body?.address || "").trim();
  const placeId = req.body?.placeId || null;
  const gpsLat = parseFloat(req.body?.lat), gpsLng = parseFloat(req.body?.lng);
  const hasGps = Number.isFinite(gpsLat) && Number.isFinite(gpsLng);
  if (!address && !hasGps) return res.status(400).json({ error: "address or coordinates required" });

  if (GOOGLE_KEY) {
    try {
      const geo = hasGps
        ? { lat: gpsLat, lng: gpsLng, formatted: await reverseGeocode(gpsLat, gpsLng).catch(() => "") }
        : (placeId && (await placeDetails(placeId).catch(() => null))) || (await geocode(address));
      if (!geo) return res.json({ found: false, source: "live" });
      // Fence flow: only the location and the parcel boundary are needed.
      // No real parcel → no parcel at all; never show a fake boundary.
      if (req.body?.parcel) {
        // ENTITLEMENTS (enforced HERE, not by hidden UI): paying accounts and
        // the private sales demo (DEMO_PASS) get live parcel lookups; the
        // anonymous public demo NEVER spends Regrid money — it draws by hand
        // at its real address, or opens a curated cached example. Pending/
        // paused accounts were already rejected above (clientLocked).
        let v2, examples;
        if (!me && !demoOk) {
          v2 = { state: "demo", candidates: [] };
          examples = await parcelExamples();
        } else {
          v2 = await resolveParcel(geo.lat, geo.lng, placeId || null).catch((e) => { console.error("parcel:", e.message); return { state: "provider_error", reason: e.message, candidates: [] }; });
          if (demoOk && !me) db.bumpMetric("pl_demo").catch(() => {}); // sales-demo provider cost, attributed
        }
        // ONE unambiguous match → legacy `parcel` field keeps installed PWAs
        // (stale JS for days) working exactly as before, with a truer ring.
        const single = v2.state === "found" ? v2.candidates[0] : null;
        return res.json({
          found: true, source: single ? "live" : "demo", addr: geo.formatted, lat: geo.lat, lng: geo.lng,
          parcel: single ? single.disp : null,
          parcelV2: { state: v2.state, reason: v2.reason || null, candidates: v2.candidates.map((c) => ({ id: c.id, addr: c.addr, contains: c.contains, raw: c.raw, disp: c.disp })) },
          ...(examples?.length ? { examples } : {}),
        });
      }
      const [roof, prop] = await Promise.all([
        solarLookup(geo.lat, geo.lng),
        RENTCAST_KEY ? rentcastLookup(geo.formatted).catch(() => null) : Promise.resolve(null),
      ]);
      // Outline runs after Solar so it can clip to the target building's bbox
      const outline = roof
        ? await roofOutline(geo.lat, geo.lng, roof.bbox).catch((e) => { console.error("outline failed:", e.message); return null; })
        : null;
      // No roof data, but we know where the house is — the app offers tracing
      if (!roof && !prop) return res.json({ found: false, source: "live", lat: geo.lat, lng: geo.lng, addr: geo.formatted });
      const stories = prop?.stories || 1;
      const sqft = prop?.sqft || (roof ? Math.round(roof.roofArea / 1.118 / 1.12) * stories : null);
      // No satellite roof data but we know the house: estimate like the manual calculator does
      const estRoof = !roof && sqft
        ? { roofArea: Math.round((sqft / stories) * 1.118 * 1.12), pitch: "6", segments: 1, estimated: true }
        : null;
      const r = roof || estRoof;
      // Confidence: did the satellite likely capture the WHOLE roof? Compare the
      // measured footprint to the property's footprint; if it's suspiciously
      // small (or there's no real mask), the app nudges them to measure by hand.
      const PF = { "0": 1, "1": 1.003, "2": 1.014, "3": 1.031, "4": 1.054, "5": 1.083, "6": 1.118, "7": 1.158, "8": 1.202, "9": 1.25, "10": 1.302, "11": 1.357, "12": 1.414 };
      let lowConf = false, confReason = null;
      // Imprecise pin (typed address, no autocomplete pick, non-ROOFTOP geocode):
      // findClosest may have measured the NEIGHBOR — most severe, checked first.
      const pinApprox = !hasGps && geo.locType && geo.locType !== "ROOFTOP";
      if (pinApprox) { lowConf = true; confReason = "approx_pin"; }
      else if (estRoof) { lowConf = true; confReason = "estimated"; }
      else if (roof) {
        if (!outline) { lowConf = true; confReason = "no_outline"; }
        else {
          const footprint = r.roofArea / (PF[String(r.pitch)] || 1.118) / 1.12;
          const expected = prop?.sqft ? prop.sqft / (prop.stories || 1) : null;
          if (expected && footprint < expected * 0.62) { lowConf = true; confReason = "partial"; }
          else if (String(r.quality || "").toUpperCase() === "LOW") { lowConf = true; confReason = "low_imagery"; }
        }
      }
      return res.json({
        found: true, source: "live", addr: geo.formatted, lat: geo.lat, lng: geo.lng,
        segs: r.segs || [], bbox: r.bbox || null, imageryDate: r.imageryDate || null,
        imageryYear: r.imageryYear || null, quality: r.quality || null,
        outline: outline || null, lowConf, confReason,
        roofArea: r.roofArea, pitch: r.pitch, segments: r.segments, estimated: !!r.estimated,
        stories, sqft: sqft ?? 0,
        beds: prop?.beds ?? null, baths: prop?.baths ?? null, year: prop?.year ?? null,
      });
    } catch (e) {
      console.error("lookup failed:", e.message);
      return res.status(502).json({ error: "lookup_failed" });
    }
  }

  const m = mockLookup(address);
  if (!m) return res.json({ found: false, source: "demo" });
  res.json({ found: true, source: "demo", ...m });
});

/* Satellite photo of the measured roof, proxied so the key stays server-side.
 * Draws the measured roof sections (numbered orange boxes) when `boxes` is
 * provided. Requires "Maps Static API" enabled on the Google key. */
/* Crop window (projected coords) shared by /api/takeoff and /api/tkimg so the
 * report's source-photo backdrop and its lines use the exact same frame. */
function tkProjRect(fromLl, lat, lng, bb, degGrid) {
  const pad = degGrid ? 3 / 111320 : 3;
  if (bb && bb.length === 4 && bb.every(Number.isFinite)) {
    const [x1, y1] = fromLl(bb[0], bb[1]), [x2, y2] = fromLl(bb[2], bb[3]);
    return [Math.min(x1, x2) - pad, Math.min(y1, y2) - pad, Math.max(x1, x2) + pad, Math.max(y1, y2) + pad];
  }
  const m = degGrid ? 20 / 111320 : 20;
  const [cx, cy] = fromLl(lat, lng);
  return [cx - m, cy - m, cx + m, cy + m];
}

/* ── Linear takeoff (BETA, on-demand) ──
 * Ridge/hip/valley/eave/rake footage from the Solar DSM. Deliberately NOT part
 * of the measure flow — it downloads two rasters and does real geometry, so it
 * runs only when the contractor asks, and results cache for a week. */
app.post("/api/takeoff", async (req, res) => {
  const me = await auth(req).catch(() => null);
  const demoOk = !!DEMO_PASS && String(req.body?.demo || "") === DEMO_PASS;
  if (!me && !demoOk) return res.status(403).json({ error: "login" });
  // Internal beta: contractors need the per-account switch (flipped in the
  // admin); the owner's demo pass always works for validation runs.
  if (!demoOk && !me?.data?.tkBeta) return res.status(403).json({ error: "beta_off" });
  if (me && !demoOk) { const locked = clientLocked(me); if (locked) return res.status(403).json({ error: locked }); }
  if (!GOOGLE_KEY) return res.status(503).json({ error: "no_key" });
  const lat = parseFloat(req.body?.lat), lng = parseFloat(req.body?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: "coords" });
  if (me && overQuota(`tk:${me.id}`, 20)) return res.status(429).json({ error: "quota" });
  const ck = `tk4:${lat.toFixed(5)},${lng.toFixed(5)}`;
  const cached = await db.kvGet(ck, 7 * 864e5).catch(() => null);
  if (cached) return res.json(cached);
  try {
    const u = `https://solar.googleapis.com/v1/dataLayers:get?location.latitude=${lat}&location.longitude=${lng}&radiusMeters=30&requiredQuality=LOW&key=${GOOGLE_KEY}`;
    const meta = await (await fetch(u)).json();
    if (!meta.maskUrl || !meta.dsmUrl) return res.status(404).json({ error: "no_data" });
    // A+ rule: really good or nothing. Ridge/valley extraction needs HIGH
    // quality elevation data (~10cm pixels). On MEDIUM/LOW the lines come out
    // confidently wrong — refuse with the reason instead of showing garbage.
    const quality = String(meta.imageryQuality || "").toUpperCase();
    const imgDate = meta.imageryDate ? `${meta.imageryDate.month}/${meta.imageryDate.year}` : null;
    if (quality && quality !== "HIGH") {
      return res.json({ ok: false, reason: "low_data", quality, imageryDate: imgDate });
    }
    const load = async (url) => {
      const t = await fromArrayBuffer(await (await fetch(`${url}&key=${GOOGLE_KEY}`)).arrayBuffer());
      const img = await t.getImage();
      return { w: img.getWidth(), h: img.getHeight(), bbox: img.getBoundingBox(), gk: img.getGeoKeys?.() || {}, data: (await img.readRasters())[0] };
    };
    const [mk, dm] = await Promise.all([load(meta.maskUrl), load(meta.dsmUrl)]);
    // CRS of the rasters → lat/lng converters (same handling as roofOutline)
    const code = dm.gk.ProjectedCSTypeGeoKey || dm.gk.GeographicTypeGeoKey || 4326;
    let toLl, fromLl, degGrid = false;
    if (code === 4326) {
      toLl = (x, y) => [y, x]; fromLl = (la2, ln2) => [ln2, la2]; degGrid = true;
    } else {
      let def = null;
      if (code >= 32601 && code <= 32660) def = `+proj=utm +zone=${code - 32600} +datum=WGS84 +units=m +no_defs`;
      else if (code >= 32701 && code <= 32760) def = `+proj=utm +zone=${code - 32700} +south +datum=WGS84 +units=m +no_defs`;
      else if (code === 3857) def = "EPSG:3857";
      if (!def) return res.status(500).json({ error: "crs" });
      const conv = proj4(def, "WGS84");
      toLl = (x, y) => { const [ln2, la2] = conv.forward([x, y]); return [la2, ln2]; };
      fromLl = (la2, ln2) => conv.inverse([ln2, la2]);
    }
    const { w, h } = dm;
    const [minX, minY, maxX, maxY] = dm.bbox;
    const mPerPx = degGrid ? ((maxX - minX) / w) * 111320 * Math.cos((lat * Math.PI) / 180) : (maxX - minX) / w;
    // Same rule for resolution: coarser than ~30cm/px can't resolve hip/valley lines
    if (mPerPx > 0.3) return res.json({ ok: false, reason: "low_data", quality: quality || "?", res: +mPerPx.toFixed(2), imageryDate: imgDate });
    // Resample the roof mask onto the DSM grid (they usually match; be safe)
    const mask = new Uint8Array(w * h);
    const [aX, aY, bX, bY] = mk.bbox;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const X = minX + ((x + 0.5) / w) * (maxX - minX), Y = maxY - ((y + 0.5) / h) * (maxY - minY);
        const mx2 = Math.floor(((X - aX) / (bX - aX)) * mk.w), my2 = Math.floor(((bY - Y) / (bY - aY)) * mk.h);
        if (mx2 >= 0 && my2 >= 0 && mx2 < mk.w && my2 < mk.h && mk.data[my2 * mk.w + mx2]) mask[y * w + x] = 1;
      }
    }
    const fromLlPx = (la2, ln2) => {
      const [X, Y] = fromLl(la2, ln2);
      return [((X - minX) / (maxX - minX)) * w, ((maxY - Y) / (maxY - minY)) * h];
    };
    // Clip to the target building so a touching neighbor can't leak in
    const bb = Array.isArray(req.body?.bbox) && req.body.bbox.length === 4 ? req.body.bbox.map(Number) : null;
    if (bb && bb.every(Number.isFinite)) {
      const pa = fromLlPx(bb[0], bb[1]), pb = fromLlPx(bb[2], bb[3]);
      const pad = 12;
      const xLo = Math.min(pa[0], pb[0]) - pad, xHi = Math.max(pa[0], pb[0]) + pad;
      const yLo = Math.min(pa[1], pb[1]) - pad, yHi = Math.max(pa[1], pb[1]) + pad;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < xLo || x > xHi || y < yLo || y > yHi) mask[y * w + x] = 0;
    }
    const outlineLl = (Array.isArray(req.body?.outline) ? req.body.outline.slice(0, 60) : [])
      .map((p) => (Array.isArray(p) ? [Number(p[0]), Number(p[1])] : null))
      .filter((p) => p && p.every(Number.isFinite));
    const outlinePx = outlineLl.map(([a2, b2]) => fromLlPx(a2, b2));
    const r = computeTakeoff({ dsm: dm.data, mask, w, h, mPerPx, outlinePx });
    const toLlPx = (x, y) => toLl(minX + (x / w) * (maxX - minX), maxY - (y / h) * (maxY - minY));
    const rect = tkProjRect(fromLl, lat, lng, bb, degGrid);
    const out = {
      ok: true, beta: true, quality, res: +mPerPx.toFixed(2), imageryDate: imgDate,
      // the exact geographic window of /api/tkimg for this house — the report
      // draws lines over THAT photo (same flight as the DSM), so they align
      im: { c: code, b: rect.map((n) => +n.toFixed(degGrid ? 7 : 2)) },
      coverage: r.coverage, totals: r.totals, outlineTypes: r.outlineTypes,
      lines: r.lines.map((l) => {
        const A = toLlPx(l.a[0], l.a[1]), B = toLlPx(l.b[0], l.b[1]);
        return { t: l.t, a: [+A[0].toFixed(6), +A[1].toFixed(6)], b: [+B[0].toFixed(6), +B[1].toFixed(6)], ft: l.ft };
      }),
    };
    await db.kvSet(ck, out).catch(() => {});
    res.json(out);
  } catch (e) {
    console.error("takeoff:", e.message);
    res.status(500).json({ error: "takeoff_failed" });
  }
});

/* The takeoff's own aerial photo: the RGB image from the SAME Solar flight as
 * the elevation model, cropped to the same window /api/takeoff reported — so
 * takeoff lines drawn over it are aligned by construction (the Static Maps
 * photo is often a different flight, which made correct lines look wrong). */
const tkImgCache = new Map();
app.get("/api/tkimg", async (req, res) => {
  if (!GOOGLE_KEY) return res.status(404).end();
  if (overQuota(`tki:${clientIp(req)}`, 120)) return res.status(429).end();
  const lat = parseFloat(req.query.lat), lng = parseFloat(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).end();
  const bb = req.query.bbox ? String(req.query.bbox).split(",").map(Number) : null;
  const key = `${lat.toFixed(5)},${lng.toFixed(5)},${bb ? bb.map((n) => n.toFixed(5)).join(",") : ""}`;
  const hit = tkImgCache.get(key);
  if (hit && Date.now() - hit.ts < 30 * 60e3) {
    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "public, max-age=3600");
    return res.send(hit.buf);
  }
  try {
    const u = `https://solar.googleapis.com/v1/dataLayers:get?location.latitude=${lat}&location.longitude=${lng}&radiusMeters=30&requiredQuality=LOW&key=${GOOGLE_KEY}`;
    const meta = await (await fetch(u)).json();
    if (!meta.rgbUrl) return res.status(404).end();
    const t = await fromArrayBuffer(await (await fetch(`${meta.rgbUrl}&key=${GOOGLE_KEY}`)).arrayBuffer());
    const img = await t.getImage();
    const rw = img.getWidth(), rh = img.getHeight();
    const [rx0, ry0, rx1, ry1] = img.getBoundingBox();
    const gk = img.getGeoKeys?.() || {};
    const code = gk.ProjectedCSTypeGeoKey || gk.GeographicTypeGeoKey || 4326;
    let fromLl, degGrid = false;
    if (code === 4326) { fromLl = (la2, ln2) => [ln2, la2]; degGrid = true; }
    else {
      let def = null;
      if (code >= 32601 && code <= 32660) def = `+proj=utm +zone=${code - 32600} +datum=WGS84 +units=m +no_defs`;
      else if (code >= 32701 && code <= 32760) def = `+proj=utm +zone=${code - 32700} +south +datum=WGS84 +units=m +no_defs`;
      else if (code === 3857) def = "EPSG:3857";
      if (!def) return res.status(404).end();
      const conv = proj4(def, "WGS84");
      fromLl = (la2, ln2) => conv.inverse([ln2, la2]);
    }
    const rect = tkProjRect(fromLl, lat, lng, bb && bb.every(Number.isFinite) ? bb : null, degGrid);
    const cl = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const xLo = cl(Math.floor(((rect[0] - rx0) / (rx1 - rx0)) * rw), 0, rw - 2);
    const xHi = cl(Math.ceil(((rect[2] - rx0) / (rx1 - rx0)) * rw), xLo + 1, rw);
    const yLo = cl(Math.floor(((ry1 - rect[3]) / (ry1 - ry0)) * rh), 0, rh - 2);
    const yHi = cl(Math.ceil(((ry1 - rect[1]) / (ry1 - ry0)) * rh), yLo + 1, rh);
    const step = Math.max(1, Math.ceil(Math.max(xHi - xLo, yHi - yLo) / 1400));
    const cw = Math.floor((xHi - xLo) / step), ch = Math.floor((yHi - yLo) / step);
    const sp = img.getSamplesPerPixel();
    const rast = await img.readRasters({ interleave: true });
    const out = new Uint8Array(cw * ch * 3);
    for (let y = 0; y < ch; y++) {
      const sy = yLo + y * step;
      for (let x = 0; x < cw; x++) {
        const si = (sy * rw + (xLo + x * step)) * sp;
        const di = (y * cw + x) * 3;
        out[di] = rast[si]; out[di + 1] = rast[si + 1]; out[di + 2] = rast[si + 2];
      }
    }
    const buf = pngEncode(out, cw, ch);
    if (tkImgCache.size > 24) tkImgCache.delete(tkImgCache.keys().next().value);
    tkImgCache.set(key, { buf, ts: Date.now() });
    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "public, max-age=3600");
    res.send(buf);
  } catch (e) {
    console.error("tkimg:", e.message);
    res.status(404).end();
  }
});

app.get("/api/roofimg", async (req, res) => {
  const { lat, lng, boxes, bbox, zoom, outline, lines } = req.query;
  if (!GOOGLE_KEY || !lat || !lng) return res.status(404).end();
  const riIp = clientIp(req);
  if (overQuota(`ri:${riIp}`, 120)) return res.status(429).end();
  try {
    // sq=1 → 640×640 (Google's max), the square fence map; default 640x400.
    // GMAPS_BASE override is test-only (stub serves geocode AND staticmap).
    let url = `${process.env.GMAPS_BASE || "https://maps.googleapis.com"}/maps/api/staticmap?size=${req.query.sq ? "640x640" : "640x400"}&scale=2&maptype=satellite&key=${GOOGLE_KEY}`;
    const f = (n) => Number(n).toFixed(6);
    // Frame the shot: explicit zoom (trace view) > building bounding box > default
    let framed = false;
    if (zoom) {
      // wide=1 unlocks the low zooms (space→city) for the widget's intro
      // fly-in; measurement views keep the 15+ floor.
      const z = Math.min(Math.max(parseInt(zoom) || 20, req.query.wide ? 4 : 15), 21);
      url += `&center=${encodeURIComponent(lat)},${encodeURIComponent(lng)}&zoom=${z}`;
      framed = true;
    } else if (bbox) {
      const [s, w, n, e] = String(bbox).split(",").map(Number);
      if ([s, w, n, e].every(Number.isFinite)) {
        const ctrLat = (s + n) / 2, ctrLng = (w + e) / 2;
        const span = Math.max(n - s, (e - w) * Math.cos((ctrLat * Math.PI) / 180), 0.00005) * 2.2;
        const zoom = Math.min(Math.max(Math.floor(Math.log2((360 * (640 / 256)) / span)), 17), 21);
        url += `&center=${f(ctrLat)},${f(ctrLng)}&zoom=${zoom}`;
        framed = true;
      }
    }
    if (!framed) url += `&center=${encodeURIComponent(lat)},${encodeURIComponent(lng)}&zoom=20`;
    // Fence runs: open polylines, white-cased orange
    if (lines) {
      for (const run of String(lines).split(";").slice(0, 12)) {
        const pts = run.split("|").map((p) => p.split(",").map(Number)).filter((p) => p.length === 2 && p.every(Number.isFinite));
        if (pts.length < 2) continue;
        const pp = pts.map(([la, ln]) => `${f(la)},${f(ln)}`).join("|");
        url += `&path=color:0xFFFFFFCC|weight:7|${pp}`;
        url += `&path=color:0xF8B408FF|weight:4|${pp}`;
      }
    }
    // Preferred overlay: one clean traced outline of the actual roof
    if (outline) {
      const pts = String(outline).split(";").map((p) => p.split(",").map(Number)).filter((p) => p.length === 2 && p.every(Number.isFinite));
      if (pts.length >= 3) {
        const pathPts = [...pts, pts[0]].map(([la, ln]) => `${f(la)},${f(ln)}`).join("|");
        // white casing under the orange line so it reads on any roof color
        url += `&path=color:0xFFFFFFCC|weight:6|${pathPts}`;
        url += `&path=color:0xF8B408FF|weight:3|fillcolor:0xF8B40810|${pathPts}`;
      }
    } else if (boxes) {
      const list = String(boxes).split(";").slice(0, 8);
      list.forEach((b, i) => {
        const [s, w, n, e] = b.split(",").map(Number);
        if (![s, w, n, e].every(Number.isFinite)) return;
        url += `&path=color:0xF8B408E6|weight:2|fillcolor:0xF8B40830|${f(s)},${f(w)}|${f(s)},${f(e)}|${f(n)},${f(e)}|${f(n)},${f(w)}|${f(s)},${f(w)}`;
        url += `&markers=size:mid|color:0x101B30|label:${i + 1}|${f((s + n) / 2)},${f((w + e) / 2)}`;
      });
    }
    const r = await fetch(url);
    if (!r.ok) {
      console.error("roofimg failed:", r.status, (await r.text()).slice(0, 200));
      return res.status(404).end();
    }
    res.set("Content-Type", r.headers.get("content-type") || "image/png");
    res.set("Cache-Control", "public, max-age=86400");
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    console.error("roofimg failed:", e.message);
    res.status(404).end();
  }
});

// Ask Google (via the free metadata endpoint) whether a street photo exists.
// Returns the raw status object, or null if the call itself failed.
async function svMetadata(lat, lng, source) {
  const u = `https://maps.googleapis.com/maps/api/streetview/metadata?location=${encodeURIComponent(lat)},${encodeURIComponent(lng)}${source ? `&source=${source}` : ""}&key=${GOOGLE_KEY}`;
  return fetch(u).then((r) => r.json()).catch(() => null);
}

// Plain-language explanation of a Street View metadata status, for the owner.
function svReason(status) {
  switch (status) {
    case "OK": return { ok: true, es: "✅ Street View funciona en esta ubicación.", en: "✅ Street View works at this location." };
    case "ZERO_RESULTS": return { ok: false, es: "Google no tiene foto de calle en esta dirección (común en zonas rurales). Tu API sí funciona — prueba una dirección en el pueblo.", en: "Google has no street photo here (common in rural areas). Your API is fine — try an in-town address." };
    case "NOT_FOUND": return { ok: false, es: "Google no pudo ubicar este punto.", en: "Google could not locate this point." };
    case "REQUEST_DENIED": return { ok: false, es: "❌ La clave fue rechazada. Activa “Street View Static API” en Google Cloud y revisa las restricciones de la clave y la facturación.", en: "❌ Key denied. Enable “Street View Static API” in Google Cloud and check the key restrictions / billing." };
    case "OVER_QUERY_LIMIT": return { ok: false, es: "❌ Se acabó la cuota o falta activar la facturación en Google Cloud.", en: "❌ Quota exceeded or billing isn't enabled in Google Cloud." };
    case "NO_KEY": return { ok: false, es: "❌ No hay clave de Google configurada en el servidor (GOOGLE_MAPS_API_KEY).", en: "❌ No Google key is set on the server (GOOGLE_MAPS_API_KEY)." };
    default: return { ok: false, es: "Estado de Google: " + (status || "sin respuesta"), en: "Google status: " + (status || "no response") };
  }
}

// Street View front-of-house photo for the homeowner proposal. Proxied so the
// API key stays server-side; only served where Google actually has coverage.
app.get("/api/streetview", async (req, res) => {
  const { lat, lng } = req.query;
  if (!GOOGLE_KEY || !lat || !lng) return res.status(404).end();
  const svIp = clientIp(req);
  if (overQuota(`sv:${svIp}`, 120)) return res.status(429).end();
  try {
    // Prefer outdoor imagery (cleanest front-of-house); fall back to the broader
    // default set so rural addresses with any coverage still get a photo.
    let meta = await svMetadata(lat, lng, "outdoor");
    let source = "outdoor";
    if (!meta || meta.status !== "OK") { meta = await svMetadata(lat, lng, ""); source = ""; }
    // No coverage → 404 so the client hides the photo instead of showing "no image".
    if (!meta || meta.status !== "OK") return res.status(404).end();
    // Aim the camera straight at the house: bearing from where the Street View
    // car actually stood (the panorama point in the metadata) to the building,
    // so the home sits centered instead of off to the side. Also nudge the
    // framing — a touch tighter and pointing at the location, not the parcel —
    // and tilt up slightly to catch the roofline (this is a roofing app).
    let aim = "&fov=72&pitch=10";
    const pano = meta.location;
    if (pano && Number.isFinite(pano.lat) && Number.isFinite(pano.lng)) {
      const toRad = (d) => (d * Math.PI) / 180;
      const p1 = toRad(pano.lat), p2 = toRad(Number(lat)), dL = toRad(Number(lng) - pano.lng);
      const y = Math.sin(dL) * Math.cos(p2);
      const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dL);
      const heading = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
      // How far the car was from the house (m) → zoom: close pano can frame
      // tighter; a far pano stays wider so the house doesn't turn to mush.
      const R = 6371000, dφ = p2 - p1, dλ = toRad(Number(lng) - pano.lng);
      const a = Math.sin(dφ / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dλ / 2) ** 2;
      const dist = 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const fov = dist > 60 ? 80 : dist < 22 ? 62 : 72;
      aim = `&heading=${heading.toFixed(1)}&fov=${fov}&pitch=10`;
    }
    const url = `https://maps.googleapis.com/maps/api/streetview?size=640x480&location=${encodeURIComponent(lat)},${encodeURIComponent(lng)}${aim}${source ? `&source=${source}` : ""}&key=${GOOGLE_KEY}`;
    const r = await fetch(url);
    if (!r.ok) return res.status(404).end();
    res.set("Content-Type", r.headers.get("content-type") || "image/jpeg");
    res.set("Cache-Control", "public, max-age=86400");
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    console.error("streetview failed:", e.message);
    res.status(404).end();
  }
});

// Browser key for the interactive Google Map (the JS map runs client-side, so it
// needs a key in the page). This MUST be a dedicated, HTTP-referrer-restricted
// key — never the main server key, which would then be exposed to abuse. When
// unset, the client simply uses the classic image map. Nothing is leaked.
app.get("/api/maps-config", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ key: process.env.MAPS_BROWSER_KEY || "" });
});

// In-app directions (Cómo llegar). Google retired the legacy Directions API
// for projects created after March 2025 — the browser's DirectionsService
// answers REQUEST_DENIED no matter what the key allows — so the route is
// computed HERE with its replacement (Routes API) under the server key.
// ROUTES_BASE override is test-only (the stub serves computeRoutes).
const ROUTES_BASE = process.env.ROUTES_BASE || "https://routes.googleapis.com";
app.get("/api/directions", async (req, res) => {
  res.set("Cache-Control", "no-store");
  const olat = +req.query.olat, olng = +req.query.olng, dlat = +req.query.dlat, dlng = +req.query.dlng;
  const daddr = String(req.query.daddr || "").trim().slice(0, 200);
  if (!Number.isFinite(olat) || !Number.isFinite(olng) || (!daddr && (!Number.isFinite(dlat) || !Number.isFinite(dlng))))
    return res.status(400).json({ error: "bad_request" });
  if (!GOOGLE_KEY) return res.status(503).json({ error: "no_key" });
  if (overQuota(`dir:${clientIp(req)}`, 100)) return res.status(429).json({ error: "rate" });
  try {
    const destination = Number.isFinite(dlat) && Number.isFinite(dlng)
      ? { location: { latLng: { latitude: dlat, longitude: dlng } } }
      : { address: daddr };
    const r = await fetch(`${ROUTES_BASE}/directions/v2:computeRoutes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_KEY,
        "X-Goog-FieldMask": "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline",
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: olat, longitude: olng } } },
        destination,
        travelMode: "DRIVE",
      }),
    });
    const j = await r.json().catch(() => ({}));
    const route = j.routes && j.routes[0];
    if (!r.ok || !route || !route.polyline || !route.polyline.encodedPolyline) {
      const code = (j.error && j.error.status) || (r.ok ? "NO_ROUTE" : `HTTP_${r.status}`);
      console.error("directions failed:", code, (j.error && j.error.message) || "");
      return res.status(502).json({ error: code });
    }
    const secs = parseInt(String(route.duration || "0"), 10) || 0;
    let h = Math.floor(secs / 3600), m = Math.round((secs % 3600) / 60);
    if (m === 60) { h += 1; m = 0; }
    const mi = (route.distanceMeters || 0) / 1609.344;
    res.json({
      path: decodePolyline(route.polyline.encodedPolyline),
      durationText: h ? `${h} h ${m} min` : `${Math.max(m, 1)} min`,
      distanceText: mi >= 10 ? `${Math.round(mi)} mi` : `${mi.toFixed(1)} mi`,
    });
  } catch (e) {
    console.error("directions failed:", e.message);
    res.status(502).json({ error: "network" });
  }
});

// Lightweight: does a front-of-house photo exist here, and from when? Lets the
// app know up front (no broken-image flash) and show the photo's year.
app.get("/api/streetview/info", async (req, res) => {
  const { lat, lng } = req.query;
  if (!GOOGLE_KEY || !lat || !lng) return res.json({ ok: false, date: null });
  const ip = clientIp(req);
  if (overQuota(`svi:${ip}`, 200)) return res.json({ ok: false, date: null });
  let meta = await svMetadata(lat, lng, "outdoor");
  if (!meta || meta.status !== "OK") meta = await svMetadata(lat, lng, "");
  if (!meta || meta.status !== "OK") return res.json({ ok: false, date: null });
  res.set("Cache-Control", "public, max-age=86400");
  res.json({ ok: true, date: meta.date || null });
});

// JSON diagnostic: is Street View actually working on this server's key?
// Defaults to a Times Square coordinate that always has coverage, so a failure
// there means the key/API — not coverage — is the problem.
app.get("/api/svcheck", async (req, res) => {
  const ip = clientIp(req);
  if (overQuota(`svc:${ip}`, 60)) return res.status(429).json({ error: "rate" });
  if (!GOOGLE_KEY) return res.json({ keySet: false, status: "NO_KEY", reason: svReason("NO_KEY"), isDefault: req.query.lat == null });
  const lat = req.query.lat || "40.758", lng = req.query.lng || "-73.9855";
  let meta = await svMetadata(lat, lng, "outdoor");
  if (!meta || (meta.status !== "OK" && meta.status !== "REQUEST_DENIED")) {
    const broad = await svMetadata(lat, lng, "");
    if (broad) meta = broad;
  }
  const status = meta ? meta.status : "NO_RESPONSE";
  res.json({ keySet: true, status, reason: svReason(status), lat, lng, isDefault: req.query.lat == null });
});

// Friendly self-check page the owner can open on their phone: /svcheck
app.get("/svcheck", (req, res) => {
  res.set("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Street View — Diagnóstico</title>
<style>
  *{box-sizing:border-box} body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#F4F6FA;color:#101B30;padding:20px;max-width:520px;margin:0 auto}
  h1{font-size:21px;margin:6px 0 2px} .sub{color:#67718A;font-size:14px;margin:0 0 18px}
  .box{background:#fff;border:1.5px solid #E6E8EC;border-radius:16px;padding:18px;margin-bottom:14px}
  .big{font-size:17px;font-weight:800;line-height:1.4} .muted{color:#67718A;font-size:13px;margin-top:8px;line-height:1.5}
  .ok{color:#1E7B3C} .bad{color:#B4232A}
  .pill{display:inline-block;font-size:12px;font-weight:800;letter-spacing:.06em;padding:4px 10px;border-radius:999px;background:#EEF1F6;color:#67718A;margin-bottom:10px}
  button{width:100%;border:none;border-radius:12px;padding:14px;font-size:16px;font-weight:800;background:#F8B408;color:#101B30;margin-top:6px}
  .spin{color:#67718A;font-size:15px}
  code{background:#EEF1F6;padding:2px 6px;border-radius:6px;font-size:13px}
</style></head><body>
<h1>⚡ ALTO Pro · Street View</h1>
<p class="sub">Esta página le pregunta a Google directamente si las fotos de la casa funcionan.</p>
<div class="box"><span class="pill">PRUEBA AUTOMÁTICA (NUEVA YORK)</span><div id="auto" class="spin">Revisando con Google…</div><div id="automuted" class="muted"></div></div>
<div class="box"><span class="pill">PROBAR MI UBICACIÓN</span><div id="mine" class="muted">Párese frente a una casa y toque el botón.</div><button onclick="checkMine()">📍 Probar mi ubicación</button></div>
<script>
  function render(el,muted,j){
    var r=j.reason||{}; var ok=r.ok;
    el.className='big '+(ok?'ok':'bad'); el.textContent=(r.es||j.status);
    if(muted) muted.innerHTML='<code>'+(j.status||'?')+'</code> &nbsp;'+(r.en||'');
  }
  fetch('/api/svcheck').then(r=>r.json()).then(j=>render(document.getElementById('auto'),document.getElementById('automuted'),j))
    .catch(function(){document.getElementById('auto').textContent='No se pudo conectar.';});
  function checkMine(){
    var m=document.getElementById('mine'); m.className='big spin'; m.textContent='Obteniendo ubicación…';
    if(!navigator.geolocation){m.textContent='Tu teléfono no permite ubicación.';return;}
    navigator.geolocation.getCurrentPosition(function(p){
      m.textContent='Revisando con Google…';
      fetch('/api/svcheck?lat='+p.coords.latitude+'&lng='+p.coords.longitude).then(r=>r.json()).then(function(j){render(m,null,j);})
        .catch(function(){m.textContent='No se pudo conectar.';});
    },function(){m.className='muted';m.textContent='No diste permiso de ubicación.';},{enableHighAccuracy:true,timeout:8000});
  }
</script>
</body></html>`);
});

// Definitive check for the interactive Google map: actually loads it with the
// browser key and reports exactly what Google says (works / API not enabled /
// site not allowed / no key). Open at /mapcheck on the phone.
app.get("/mapcheck", (req, res) => {
  res.set("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mapa — Diagnóstico</title>
<style>
  *{box-sizing:border-box} body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#F4F6FA;color:#101B30;padding:20px;max-width:520px;margin:0 auto}
  h1{font-size:21px;margin:6px 0 2px} .sub{color:#67718A;font-size:14px;margin:0 0 18px}
  .box{background:#fff;border:1.5px solid #E6E8EC;border-radius:16px;padding:18px;margin-bottom:14px}
  .big{font-size:17px;font-weight:800;line-height:1.4} .muted{color:#67718A;font-size:13px;margin-top:8px;line-height:1.5}
  .ok{color:#1E7B3C} .bad{color:#B4232A} .spin{color:#67718A;font-size:15px}
  #map{height:240px;border-radius:12px;overflow:hidden;background:#0B1322}
  code{background:#EEF1F6;padding:2px 6px;border-radius:6px;font-size:12px;word-break:break-all}
</style></head><body>
<h1>⚡ ALTO Pro · Mapa real</h1>
<p class="sub">Esta página carga el mapa real de Google con tu clave y dice exactamente qué pasa.</p>
<div class="box"><div id="status" class="big spin">Probando el mapa…</div><div id="detail" class="muted"></div></div>
<div id="map"></div>
<script>
  var statusEl=document.getElementById('status'), detailEl=document.getElementById('detail'), gErr=null, done=false;
  function show(ok,msg,detail){ if(done)return; done=true; statusEl.className='big '+(ok?'ok':'bad'); statusEl.textContent=msg; detailEl.innerHTML=detail?('<code>'+detail+'</code>'):''; }
  var oe=console.error; console.error=function(){ try{var m=Array.prototype.join.call(arguments,' '); if(/Google Maps/i.test(m)&&!gErr)gErr=m;}catch(e){} return oe.apply(console,arguments); };
  window.gm_authFailure=function(){ show(false,'❌ Google rechazó la clave. Revisa que “Maps JavaScript API” esté activada y que app.alto-pro.com esté permitido en la clave.', gErr||'auth failure'); };
  fetch('/api/maps-config').then(function(r){return r.json();}).then(function(j){
    if(!j.key){ show(false,'❌ No hay clave del mapa en el servidor. Agrega MAPS_BROWSER_KEY en Render y vuelve a desplegar.',''); return; }
    window.__mapcb=function(){
      try{
        var map=new google.maps.Map(document.getElementById('map'),{center:{lat:26.379,lng:-98.82},zoom:18,mapTypeId:'satellite',disableDefaultUI:true});
        google.maps.event.addListenerOnce(map,'tilesloaded',function(){ show(true,'✅ El mapa real de Google funciona con tu clave.','Si en la app aún se ve lento, dímelo y lo afino.'); });
        setTimeout(function(){ show(false,'❌ El mapa no terminó de cargar. La clave o la API quizá no están activas todavía (espera 5 min).', gErr||'timeout'); }, 9000);
      }catch(e){ show(false,'❌ Error al crear el mapa.', String(e)); }
    };
    var s=document.createElement('script');
    s.src='https://maps.googleapis.com/maps/api/js?key='+encodeURIComponent(j.key)+'&v=quarterly&callback=__mapcb';
    s.onerror=function(){ show(false,'❌ No se pudo cargar Google Maps (red o clave inválida).', gErr||'script error'); };
    document.head.appendChild(s);
  }).catch(function(){ show(false,'❌ No se pudo conectar al servidor.',''); });
</script>
</body></html>`);
});

/* ── Accounts, login, and saved data ── */

// who is calling? (session token in the Authorization header)
async function auth(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || "");
  return m ? db.getSessionContractor(m[1]) : null;
}

// Logins: the key can come from the URL once — after that it lives in an
// HttpOnly cookie for ~30 days, so bookmarked /admin and /closer just work.
const reqCookies = (req) => Object.fromEntries(
  String(req.headers.cookie || "").split(/; */).filter(Boolean).map((c) => {
    const i = c.indexOf("=");
    return [c.slice(0, i), decodeURIComponent(c.slice(i + 1))];
  })
);
const setKeyCookie = (req, res, name, val) =>
  res.setHeader("Set-Cookie", `${name}=${encodeURIComponent(val)}; Path=/; HttpOnly; SameSite=Lax${req.secure ? "; Secure" : ""}; Max-Age=${30 * 86400}`);
const clearKeyCookie = (res, name) => res.setHeader("Set-Cookie", `${name}=; Path=/; Max-Age=0`);
// Canonical public base for generated links: always the main https domain in
// production (never app./www. or http), so copied links work everywhere.
function canonBase(req) {
  const host = String(req.get("host") || "").split(":")[0];
  if (/(^|\.)alto-pro\.com$/.test(host)) return "https://alto-pro.com";
  return `${req.protocol}://${req.get("host")}`;
}
// Where the contractor APP lives. The bare alto-pro.com root serves the sales
// landing page, so a logged-in client must be sent to app.alto-pro.com (which
// serves the built app), NOT to "/" — otherwise they land on the marketing site.
function appBase(req) {
  const host = String(req.get("host") || "").split(":")[0];
  if (/(^|\.)alto-pro\.com$/.test(host)) return "https://app.alto-pro.com";
  return `${req.protocol}://${req.get("host")}`;
}

const adminOk = (req) => ADMIN_KEY && (
  req.query.key === ADMIN_KEY || req.body?.key === ADMIN_KEY || reqCookies(req).alto_admin === ADMIN_KEY
);
// Closers get a limited portal: create clients + the sales toolkit, nothing else
const closerOk = (req) => {
  const k = req.query.key || req.body?.key || reqCookies(req).alto_closer || reqCookies(req).alto_admin;
  return (CLOSER_KEY && k === CLOSER_KEY) || (ADMIN_KEY && k === ADMIN_KEY);
};
// Customer service: the command center (tasks + edit client sites), no money/MRR
const csOk = (req) => {
  const k = req.query.key || req.body?.key || reqCookies(req).alto_cs || reqCookies(req).alto_admin;
  return (CS_KEY && k === CS_KEY) || (ADMIN_KEY && k === ADMIN_KEY);
};

function loginPage(title, action, wrong) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ALTO Pro · ${title}</title><link rel="icon" href="/icon-192.png"><style>
*{box-sizing:border-box;font-family:Inter,Arial,sans-serif;margin:0}
body{background:#101B30;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.card{background:#fff;border-radius:22px;padding:36px 30px;width:100%;max-width:380px;text-align:center;box-shadow:0 30px 80px rgba(0,0,0,.45)}
img{height:52px;margin-bottom:14px}
h1{font-size:18px;color:#101B30;margin-bottom:4px}
p{color:#67718A;font-size:13px;font-weight:600;margin-bottom:18px}
input{width:100%;padding:14px;border-radius:12px;border:1.5px solid #DDE3EE;font-size:16px;font-weight:600;outline:none;text-align:center}
input:focus{border-color:#F8B408}
button{width:100%;margin-top:10px;padding:14px;border:none;border-radius:12px;background:#F8B408;color:#101B30;font-size:16px;font-weight:800;cursor:pointer}
.err{color:#D93025;font-size:13px;font-weight:700;margin-top:10px}
</style></head><body><form class="card" method="get" action="${action}">
<img src="/brand-logo.png" alt="ALTO Pro">
<h1>${title}</h1>
<p>Escribe tu clave para entrar</p>
<input name="key" type="password" placeholder="Clave / Password" autofocus autocomplete="current-password">
<button>Entrar →</button>
${wrong ? `<p class="err">Clave incorrecta — intenta de nuevo.</p>` : ""}
</form></body></html>`;
}

// Admin: create a contractor account + invite link (you run this per sale)
app.post("/api/admin/contractors", async (req, res) => {
  if (!adminOk(req)) return res.status(403).json({ error: "bad admin key" });
  const { name, phone, slug } = req.body || {};
  if (!name) return res.status(400).json({ error: "name required" });
  const c = await db.createContractor({ name, phone, slug });
  const trade0 = FENCE_ENABLED && req.body?.trade === "fence" ? "fence" : "roofing";
  // Same pay-before-account rule the closer path uses: a Stripe payment in the
  // last 48h matching this phone activates now; the marker is CONSUMED (atomic
  // delete) so the same payment can never activate a second account. Without
  // this, admin creation would leave the marker live for a closer to re-claim.
  const pickedPlan = PLANS[req.body?.plan] ? req.body.plan : null;
  const digits = String(phone || "").replace(/\D/g, "").replace(/^1/, "");
  const paid = digits ? await db.kvConsume(`paid:${digits}`, 48 * 3600 * 1000).catch(() => null) : null;
  if (paid?.email) await db.kvDelete(`paid:${paid.email}`).catch(() => {});
  // Money is the source of truth for the plan; fall back to what admin picked.
  const plan = paid && PLANS[paid.plan] ? paid.plan : pickedPlan;
  const cData = { trade: trade0, profile: { trade: trade0 } };
  if (paid) {
    cData.plan = plan; cData.payStatus = paid.trial ? "trial" : "ok";
    if (paid.customerId) cData.stripeCustomer = paid.customerId;
    // A trial marker is a card on file, not money — no $0 ledger row.
    if (paid.amountCents != null && paid.evId && !paid.trial) {
      cData.payments = [{ evId: paid.evId, at: paid.at || new Date().toISOString(), amount: Math.round(paid.amountCents) / 100, url: null }];
    }
  } else if (plan) {
    cData.plan = plan; cData.payStatus = "pending";
  }
  await db.saveContractorData(c.id, cData);
  const invite = await db.createInvite(c.id);
  const inviteUrl = `${req.protocol}://${req.get("host")}/invite/${invite}`;
  if (req.query.html) {
    return res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cuenta creada</title>
<style>body{font-family:Arial;max-width:560px;margin:40px auto;padding:0 16px;color:#101B30}h2{margin-bottom:6px}
.link{background:#FEF5DC;border:2px solid #F8B408;border-radius:12px;padding:14px;word-break:break-all;font-size:14px;margin:14px 0}
a{color:#F8B408;font-weight:800}</style></head><body>
<h2>✓ Cuenta creada: ${c.name}</h2>
<p>Manda este link por WhatsApp al contratista. Un tap y queda dentro de su app, con sus datos guardados para siempre:</p>
<div class="link">${inviteUrl}</div>
<p><b>Su widget de cotización</b> (link directo para anuncios, o para probar):</p>
<div class="link">${req.protocol}://${req.get("host")}/w/${c.slug}</div>
<p>Código para pegar en su página web:</p>
<div class="link">&lt;iframe src="${req.protocol}://${req.get("host")}/w/${c.slug}" style="width:100%;max-width:430px;height:560px;border:0;border-radius:18px" loading="lazy"&gt;&lt;/iframe&gt;</div>
<a href="/admin">← Volver al admin</a></body></html>`);
  }
  res.json({ contractor: c, inviteUrl });
});

app.get("/api/admin/contractors", async (req, res) => {
  if (!adminOk(req)) return res.status(403).json({ error: "bad admin key" });
  res.json({ contractors: await db.listContractors() });
});

// Admin: fresh access link for an existing contractor (lost phone, or the
// built-in alto-ventas account where landing-page leads arrive)
app.get("/api/admin/invite", async (req, res) => {
  if (!adminOk(req)) return res.status(403).send("bad admin key");
  const c = await db.getContractor(String(req.query.id || ""));
  if (!c) return res.status(404).send("no contractor");
  const token = await db.createInvite(c.id);
  const url = `${req.protocol}://${req.get("host")}/invite/${token}`;
  res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Link de acceso</title>
<style>body{font-family:Arial;max-width:560px;margin:40px auto;padding:0 16px;color:#101B30}
a.link{display:block;background:#FEF5DC;border:2px solid #F8B408;border-radius:12px;padding:14px;word-break:break-all;font-size:14px;margin:14px 0;color:#101B30;font-weight:700;text-decoration:underline}
.row{display:flex;gap:10px;flex-wrap:wrap;margin:6px 0 18px}
.row a,.row button{flex:1 1 150px;text-align:center;border:none;border-radius:12px;font-weight:800;font-size:14.5px;padding:14px;cursor:pointer;text-decoration:none}
.open{background:#101B30;color:#fff}.cp{background:#F8B408;color:#101B30}
a.back{color:#F8B408;font-weight:800}</style></head><body>
<h2>🔑 Link de acceso: ${c.name}</h2>
<p>Tócalo para abrir la app, o cópialo y mándalo por WhatsApp:</p>
<a class="link" href="${url}">${url}</a>
<div class="row">
  <a class="open" href="${url}">🚀 Abrir la app ahora</a>
  <button class="cp" onclick="navigator.clipboard.writeText('${url}').then(()=>{this.textContent='✓ Copiado'})">📋 Copiar link</button>
</div>
<a class="back" href="/admin">← Volver al admin</a></body></html>`);
});

/* Admin: revoke ALL access for one client — kills every session (logs out
 * every device) and every old invite link, then issues ONE fresh link to
 * re-send by WhatsApp. The remedy for a leaked access link: his data is never
 * touched, only the keys change. */
app.get("/api/admin/revoke", async (req, res) => {
  if (!adminOk(req)) return res.status(403).send("bad admin key");
  const c = await db.getContractor(String(req.query.id || ""));
  if (!c) return res.status(404).send("no contractor");
  const killed = await db.revokeAccess(c.id);
  const token = await db.createInvite(c.id);
  const url = `${req.protocol}://${req.get("host")}/invite/${token}`;
  console.log(`access revoked for ${c.slug}: ${killed.sessions} sessions + ${killed.invites} invites killed, fresh link issued`);
  res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Accesos revocados</title>
<style>body{font-family:Arial;max-width:560px;margin:40px auto;padding:0 16px;color:#101B30}
.ok{background:#EAF8EF;border:1.5px solid #34A853;color:#1E7B3C;border-radius:12px;padding:12px 16px;font-weight:700;font-size:14px}
a.link{display:block;background:#FEF5DC;border:2px solid #F8B408;border-radius:12px;padding:14px;word-break:break-all;font-size:14px;margin:14px 0;color:#101B30;font-weight:700;text-decoration:underline}
.row{display:flex;gap:10px;flex-wrap:wrap;margin:6px 0 18px}
.row a,.row button{flex:1 1 150px;text-align:center;border:none;border-radius:12px;font-weight:800;font-size:14.5px;padding:14px;cursor:pointer;text-decoration:none}
.cp{background:#F8B408;color:#101B30}.wa{background:#25D366;color:#fff}
p{font-size:14px;line-height:1.6}a.back{color:#F8B408;font-weight:800}</style></head><body>
<h2>🔄 Accesos revocados: ${String(c.name).replace(/</g, "&lt;")}</h2>
<div class="ok">✓ ${killed.sessions} ${killed.sessions === 1 ? "dispositivo cerró sesión" : "dispositivos cerraron sesión"} · ${killed.invites} ${killed.invites === 1 ? "link viejo anulado" : "links viejos anulados"}. Sus datos quedaron intactos.</div>
<p>Los links anteriores <b>ya no funcionan</b>. Mándale este link NUEVO por WhatsApp — es su nueva llave 🔑:</p>
<a class="link" href="${url}">${url}</a>
<div class="row">
  <button class="cp" onclick="navigator.clipboard.writeText('${url}').then(()=>{this.textContent='✓ Copiado'})">📋 Copiar link</button>
  ${String(c.phone || "").replace(/\D/g, "").replace(/^1/, "").length === 10 ? `<a class="wa" target="_blank" href="https://wa.me/1${String(c.phone).replace(/\D/g, "").replace(/^1/, "")}?text=${encodeURIComponent(`Por seguridad renovamos tu llave de ALTO Pro 🔑 Este es tu link NUEVO — ábrelo y guárdalo (los anteriores ya no sirven): ${url}`)}">💬 Enviar por WhatsApp</a>` : ""}
</div>
<a class="back" href="/admin/c/${c.slug}">← Volver al cliente</a></body></html>`);
});

// Admin: per-client switch for the takeoff beta — off for everyone by default;
// turn it on only where the data quality has been validated by eye first.
app.get("/api/admin/tkbeta", async (req, res) => {
  if (!adminOk(req)) return res.status(403).json({ ok: false, error: "bad admin key" });
  const c = await db.getContractor(String(req.query.id || ""));
  if (!c) return res.status(404).json({ ok: false, error: "no contractor" });
  const on = String(req.query.on || "") === "1";
  await db.patchContractorData(c.id, { tkBeta: on || undefined });
  res.json({ ok: true, tkBeta: on });
});

// Admin: per-client bot facts — the ONLY extra truths the website chat may
// assert (office address, hours, no-weekends, financing…). Staff-edited, so
// the bot can be "trained" per contractor without ever becoming free-form.
app.post("/api/admin/botfacts", async (req, res) => {
  if (!adminOk(req)) return res.status(403).json({ ok: false, error: "bad admin key" });
  const c = await db.getContractor(String(req.body?.id || ""));
  if (!c) return res.status(404).json({ ok: false, error: "no contractor" });
  const facts = String(req.body?.facts || "").replace(/\s+/g, " ").trim().slice(0, 600);
  await db.patchContractorData(c.id, { site: { ...(c.data?.site || {}), botFacts: facts } });
  res.json({ ok: true, facts });
});

// Admin: freeform notes + training checklist per client — everything about
// them that isn't a task ticket or a bot fact lives here.
const ADMIN_TRAINING_ITEMS = [
  ["demo", "Vio la demo completa"],
  ["app", "Sabe usar la app (estimados/facturas)"],
  ["cotizador", "Sabe usar el cotizador por satélite"],
  ["fotos", "Sabe subir fotos y logo"],
  ["dominio", "Conectó su propio dominio"],
];
app.post("/api/admin/notes", async (req, res) => {
  if (!adminOk(req)) return res.status(403).json({ ok: false, error: "bad admin key" });
  const c = await db.getContractor(String(req.body?.id || ""));
  if (!c) return res.status(404).json({ ok: false, error: "no contractor" });
  const notes = String(req.body?.notes || "").slice(0, 4000);
  const training = {};
  for (const [k] of ADMIN_TRAINING_ITEMS) if (req.body?.training?.[k]) training[k] = true;
  await db.patchContractorData(c.id, { adminNotes: notes, training });
  res.json({ ok: true });
});

/* Admin: one-click business backup — downloads every client, lead, job,
 * meeting, task and review as a dated JSON file. The owner keeps a copy
 * outside the platform (playbook/06-respaldo.md). */
app.get("/api/admin/backup", async (req, res) => {
  if (!adminOk(req)) return res.status(403).json({ error: "bad admin key" });
  const dump = await db.exportAll();
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="alto-respaldo-${stamp}.json"`);
  res.send(JSON.stringify({ exported_at: new Date().toISOString(), ...dump }, null, 1));
});

// Admin: restore a backup file produced by /api/admin/backup. Its own 25mb JSON
// parser (backups with job photos exceed the 2mb global limit). NON-DESTRUCTIVE
// upsert — see db.importAll: it rebuilds/overwrites the rows in the file but
// never deletes anything created since the backup. Requires an explicit typed
// confirmation so it can't fire by accident.
app.post("/api/admin/restore", express.json({ limit: "25mb" }), async (req, res) => {
  if (!adminOk(req)) return res.status(403).json({ error: "bad admin key" });
  const body = req.body || {};
  if (body.confirm !== "RESTAURAR") return res.status(400).json({ error: 'falta la confirmación (escribe "RESTAURAR")' });
  const dump = body.dump || body.backup || body;
  if (!dump || typeof dump !== "object" || !Array.isArray(dump.contractors)) {
    return res.status(400).json({ error: "el archivo no parece un respaldo de ALTO Pro (falta la lista de contractors)" });
  }
  try {
    const counts = await db.importAll(dump);
    console.log("restore OK:", JSON.stringify(counts));
    res.json({ ok: true, restored: counts });
  } catch (e) {
    console.error("restore failed:", e.message);
    res.status(500).json({ error: "no se pudo restaurar: " + e.message });
  }
});

// Admin: connect/disconnect a contractor's HighLevel webhook (empty url clears)
app.get("/api/admin/webhook", async (req, res) => {
  if (!adminOk(req)) return res.status(403).json({ error: "bad admin key" });
  const c = await db.getContractor(String(req.query.id || ""));
  if (!c) return res.status(404).json({ error: "no contractor" });
  const url = String(req.query.url || "").trim();
  if (url && !/^https:\/\//.test(url)) return res.status(400).json({ error: "url must start with https://" });
  await db.patchContractorData(c.id, { webhook: url || undefined });
  res.json({ ok: true, webhook: url || null });
});

// Admin: change a client's plan (pro/widget/complete). Normally the Stripe
// webhook tags it from the amount paid; this is the manual override.
app.get("/api/admin/plan", async (req, res) => {
  if (!adminOk(req)) return res.status(403).json({ error: "bad admin key" });
  const c = await db.getContractor(String(req.query.id || ""));
  if (!c) return res.status(404).json({ error: "no contractor" });
  const plan = String(req.query.plan || "");
  if (!PLANS[plan]) return res.status(400).json({ error: "bad plan" });
  await db.patchContractorData(c.id, { plan });
  res.json({ ok: true, plan });
});

// Admin: pause/reactivate a client (paused = widget + website stop taking leads;
// the app and their data stay untouched)
app.get("/api/admin/status", async (req, res) => {
  if (!adminOk(req)) return res.status(403).json({ error: "bad admin key" });
  const c = await db.getContractor(String(req.query.id || ""));
  if (!c) return res.status(404).json({ error: "no contractor" });
  const paused = req.query.status === "paused";
  const patch = { status: paused ? "paused" : undefined };
  if (!paused && c.data?.payStatus === "pending") patch.payStatus = "ok"; // manual activation (cash/Zelle deals)
  await db.patchContractorData(c.id, patch);
  res.json({ ok: true, status: paused ? "paused" : "active" });
});

// Operations dashboard: KPIs, funnel, clients with lead activity, latest leads
/* Month/date filtering for the closer's sales numbers.
 * period = this | last | all | custom (+ from/to YYYY-MM-DD). */
function periodRange(q, en) {
  const now = new Date();
  const period = q.period || "this";
  const iso = (d) => d.toISOString();
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const mlabel = (d) => cap(d.toLocaleDateString(en ? "en-US" : "es-MX", { month: "long", year: "numeric", timeZone: "UTC" }));
  if (period === "all") return { from: null, to: null, period: "all", label: en ? "All time" : "Todo el tiempo" };
  if (period === "custom" && q.from) {
    const from = new Date(q.from + "T00:00:00Z");
    const to = q.to ? new Date(q.to + "T23:59:59Z") : now;
    return { from: iso(from), to: iso(to), period: "custom", fromStr: q.from, toStr: q.to || "", label: `${q.from} → ${q.to || (en ? "now" : "hoy")}` };
  }
  if (period === "last") {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return { from: iso(d), to: iso(to), period: "last", label: mlabel(d) };
  }
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { from: iso(d), to: null, period: "this", label: mlabel(d) };
}
/* Segmented month control — links reload the page with ?period=… */
function periodSeg(basePath, range, en) {
  const lang = en ? "&lang=en" : "";
  const T = en
    ? { this: "This month", last: "Last month", all: "All", apply: "View" }
    : { this: "Este mes", last: "Mes pasado", all: "Todo", apply: "Ver" };
  const seg = (p, label) => `<a class="seg${range.period === p ? " on" : ""}" href="${basePath}?period=${p}${lang}">${label}</a>`;
  return `<div class="periodbar">
    <div class="segs">${seg("this", T.this)}${seg("last", T.last)}${seg("all", T.all)}</div>
    <form class="segcustom" method="get" action="${basePath}">
      <input type="hidden" name="period" value="custom">${en ? '<input type="hidden" name="lang" value="en">' : ""}
      <input type="date" name="from" value="${range.fromStr || ""}">
      <input type="date" name="to" value="${range.toStr || ""}">
      <button class="${range.period === "custom" ? "on" : ""}">${T.apply}</button>
    </form>
    ${range.label ? `<span class="plabel">${range.label}</span>` : ""}
  </div>`;
}

/* ── Sales-leads inbox (alto-ventas) — shared by /admin and /closer ──
 * Every form on alto-pro.com lands here: the quiz at the bottom
 * (info.src "landing", carries the 4 quiz answers) and the "Pruébala en tu
 * teléfono" trial-link box (info.src "trial-app"). DMs stay in GHL. */
function salesLeadsPanel(leads, K, opts = {}) {
  const esc = (x) => String(x || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const ago = (iso) => {
    const m = Math.max(0, Math.round((Date.now() - new Date(iso || 0).getTime()) / 60000));
    if (m < 60) return `hace ${m} min`;
    if (m < 1440) return `hace ${Math.round(m / 60)} h`;
    return `hace ${Math.round(m / 1440)} d`;
  };
  const SRC = { "trial-app": ["app", "🧪 Probó la app"], "app-funnel": ["app", "📱 Funnel app ($67)"], "vsl-app": ["quiz", "🎬 VSL app ($67)"], "vsl-completo": ["quiz", "🎬 VSL $297"], landing: ["quiz", "📋 Quiz anuncios"],
    whatsapp: ["chat", "💬 WhatsApp"], instagram: ["chat", "📸 Instagram"], facebook: ["chat", "💬 Messenger"], messenger: ["chat", "💬 Messenger"], chat: ["chat", "💬 Chat"] };
  const QL = { work: "", crew: "equipo: ", revenue: "factura: ", marketing: "marketing: " };
  const pend = leads.filter((l) => (l.status || "new") === "new").length;
  const STAGES = [["new", "🔴 Nuevo"], ["contacted", "🟡 Contactado"], ["scheduled", "📅 Agendó"], ["closed", "🎉 Cerró"], ["not_interested", "✕ No interesado"]];
  const rows = leads.slice(0, 60).map((l, i) => {
    const [srcKey, srcLabel] = SRC[l.info?.src] || ["otro", "🌐 Otro"];
    const stage = STAGES.some(([k]) => k === l.status) ? l.status : "new";
    const st = stage === "new" ? "open" : "done";
    const digits = String(l.phone || "").replace(/\D/g, "");
    const wa = digits ? `https://wa.me/${digits.length === 10 ? "1" + digits : digits}?text=${encodeURIComponent(`Hola${l.name ? " " + l.name : ""} 👋 Soy del equipo de ALTO Pro — vi que pediste info en nuestra página. ¿Te marco ahorita o prefieres que te mande la info por aquí?`)}` : "";
    const quiz = ["work", "crew", "revenue", "marketing"].filter((k) => l.info?.[k]).map((k) => `<span class="slq">${QL[k]}${esc(l.info[k])}</span>`).join("");
    return `<div class="slrow stage-${stage}" data-src="${srcKey}" data-st="${st}">
      <span class="sln">${i + 1}</span>
      <div class="slmain">
        <div><b>${esc(l.name) || "Sin nombre"}</b>${l.info?.biz ? ` <span style="color:#67718A;font-weight:700">· ${esc(l.info.biz)}</span>` : ""} <span class="slsrc ${srcKey}">${srcLabel}</span></div>
        ${quiz ? `<div class="slqs">${quiz}</div>` : ""}
        <div class="slsub">${esc(l.phone)} · ${ago(l.created_at)}</div>
        <div class="slnote" onclick="slNote('${l.id}',this)" title="Click para editar">${l.info?.crm_note ? "📝 " + esc(l.info.crm_note) : '<span style="color:#B6BCC8">📝 agregar nota…</span>'}</div>
      </div>
      <div class="slacts">
        ${wa ? `<a href="${wa}" target="_blank" title="WhatsApp">💬</a><a href="tel:+1${digits.length === 10 ? digits : digits.slice(-10)}" title="Llamar">📞</a>` : ""}
        <select class="slsel st-${stage}" onchange="slStat('${l.id}',this.value)">
          ${STAGES.map(([k, lbl]) => `<option value="${k}" ${k === stage ? "selected" : ""}>${lbl}</option>`).join("")}
        </select>
      </div>
    </div>`;
  }).join("");
  return `<style>
.slrow{display:flex;align-items:center;gap:12px;padding:11px 4px;border-bottom:1px solid #F0F2F6}
.slrow.stage-not_interested{opacity:.4}
.slrow.stage-closed{background:#F6FDF8}
.slnote{margin-top:4px;font-size:12px;font-weight:600;color:#4A5568;cursor:pointer}
.slsel{border-radius:10px;font-weight:800;font-size:12px;padding:8px 8px;cursor:pointer;border:1.5px solid #E4E7EC;background:#fff;color:#101B30;max-width:150px}
.slsel.st-new{background:#FDECEC;border-color:#F5C6C0;color:#9B1C10}
.slsel.st-contacted{background:#FEF5DC;border-color:#F4DE9A;color:#8A6D00}
.slsel.st-scheduled{background:#EAF3FE;border-color:#BBD6F7;color:#1A5CB0}
.slsel.st-closed{background:#EAF8EF;border-color:#BFE6CC;color:#1E7B3C}
.sln{width:26px;height:26px;border-radius:99px;background:#F0F2F6;color:#67718A;font-weight:800;font-size:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.slmain{flex:1;min-width:0}.slmain b{font-size:14.5px;color:#101B30}
.slsrc{font-size:11px;font-weight:800;border-radius:99px;padding:3px 9px;margin-left:6px;vertical-align:middle;white-space:nowrap;display:inline-block}
.slsrc.app{background:#EAF3FE;color:#1A5CB0}.slsrc.quiz{background:#FEF5DC;color:#8A6D00}.slsrc.chat{background:#EAF8EF;color:#1E7B3C}.slsrc.otro{background:#F0F2F6;color:#67718A}
.slqs{margin-top:4px;display:flex;flex-wrap:wrap;gap:5px}
.slq{font-size:11px;font-weight:700;background:#F7F9FC;border:1px solid #E4E7EC;border-radius:8px;padding:2px 8px;color:#4A5568}
.slsub{margin-top:3px;font-size:12px;color:#8A94A8;font-weight:600}
.slacts{display:flex;align-items:center;gap:8px;flex-shrink:0}
.slacts a{font-size:18px;text-decoration:none}
.slbtn{border:none;border-radius:10px;font-weight:800;font-size:12px;padding:8px 12px;cursor:pointer;background:#EAF8EF;color:#1E7B3C}
.slbtn.done{background:#F0F2F6;color:#67718A;padding:8px 10px}
.sltabs{display:flex;gap:8px;margin:4px 0 8px;flex-wrap:wrap}
.sltab{border:1.5px solid #E4E7EC;background:#fff;border-radius:99px;font-weight:800;font-size:12px;color:#67718A;padding:7px 14px;cursor:pointer}
.sltab.on{background:#101B30;color:#fff;border-color:#101B30}
.slempty{color:#8A94A8;font-weight:600;font-size:13.5px;padding:14px 4px}
</style>
<div class="sltabs">
  <button class="sltab on" onclick="slF(this,'all')">Todos (${leads.length})</button>
  <button class="sltab" onclick="slF(this,'open')">Sin contactar (${pend})</button>
  <button class="sltab" onclick="slF(this,'app')">🧪 Probó la app</button>
  <button class="sltab" onclick="slF(this,'quiz')">📋 Quiz</button>
  <button class="sltab" onclick="slF(this,'chat')">💬 Chats</button>
  <a class="sltab" style="text-decoration:none" href="/api/sales/leads.csv">⬇️ Excel</a>
</div>
${rows || `<p class="slempty">Todavía no hay leads de venta — llegan solos cuando alguien llena el quiz o pide su link de prueba en alto-pro.com.</p>`}
<p class="legend" style="font-size:11.5px;color:#8A94A8;font-weight:600;margin-top:8px">Los DMs de Instagram/Facebook viven en GHL (el bot los atiende) — aquí llega todo lo que entra por alto-pro.com.</p>
<script>
function slF(btn,f){document.querySelectorAll(".sltab").forEach(b=>b.classList.remove("on"));btn.classList.add("on");
  document.querySelectorAll(".slrow").forEach(r=>{
    var show = f==="all" || (f==="open" ? r.dataset.st==="open" : r.dataset.src===f);
    r.style.display = show ? "" : "none";
  });}
function slClear(n){if(!confirm("¿Archivar TODOS los "+n+" leads actuales? El buzón queda en cero para el arranque de los anuncios. (No se borran de la base — solo se archivan.)"))return;
  fetch("/api/sales/clearleads",{method:"POST"}).then(r=>r.json()).then(j=>{if(j.ok)location.reload();else alert("Error");}).catch(()=>alert("Error"));}
function slNote(id,el){var cur=el.innerText.indexOf("📝 agregar")>=0?"":el.innerText.replace(/^📝 /,"");
  var t=prompt("Nota del lead:",cur);if(t===null)return;
  fetch("/api/sales/leadnote",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:id,note:t})})
    .then(r=>r.json()).then(j=>{if(j.ok)location.reload();else alert("Error");}).catch(()=>alert("Error"));}
function slStat(id,st){fetch("/api/sales/leadstatus",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:id,status:st})})
  .then(r=>r.json()).then(j=>{if(j.ok)location.reload();else alert("Error");}).catch(()=>alert("Error"));}
</script>`;
}

// Excel-friendly export of the sales leads (CSV with BOM so Excel shows
// accents right) — for handing the day's list to the closer.
app.get("/api/sales/leads.csv", async (req, res) => {
  if (!adminOk(req) && !closerOk(req)) return res.status(403).send("no auth");
  const av = await db.getContractorBySlug("alto-ventas");
  const leads = av ? await db.listLeads(av.id).catch(() => []) : [];
  const SRC = { "trial-app": "Probó la app", "app-funnel": "Funnel app ($67)", "vsl-app": "VSL app ($67)", "vsl-completo": "VSL $297", landing: "Quiz anuncios", whatsapp: "WhatsApp", instagram: "Instagram", facebook: "Messenger", messenger: "Messenger", chat: "Chat" };
  const esc = (x) => `"${String(x ?? "").replace(/"/g, '""')}"`;
  const rows = [
    ["Nombre", "Teléfono", "Fuente", "Trabajo", "Equipo", "Factura mensual", "Marketing", "Estado", "Nota", "Fecha"],
    ...leads.map((l) => [
      l.name, l.phone, SRC[l.info?.src] || l.info?.src || "Otro",
      l.info?.work || "", l.info?.crew || "", l.info?.revenue || "", l.info?.marketing || "",
      ({ contacted: "Contactado", scheduled: "Agendó", closed: "Cerró", not_interested: "No interesado" })[l.status] || "Nuevo",
      l.info?.crm_note || "",
      new Date(l.created_at).toLocaleString("es-US", { timeZone: "America/Chicago" }),
    ]),
  ];
  const csv = "\uFEFF" + rows.map((r) => r.map(esc).join(",")).join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="leads-venta-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
});

// Delete a contractor and all its data — admin only, slug must be re-typed
app.post("/api/admin/delete", async (req, res) => {
  if (!adminOk(req)) return res.status(403).json({ error: "solo admin" });
  const c = await db.getContractor(String(req.body?.id || ""));
  if (!c) return res.status(404).json({ error: "cliente no encontrado" });
  if (["alto-demo", "alto-ventas", "alto-cercas"].includes(c.slug)) return res.status(400).json({ error: "cuenta interna — no se puede borrar" });
  if (String(req.body?.confirm || "") !== c.slug) return res.status(400).json({ error: "el texto de confirmación no coincide con el slug" });
  await db.deleteContractor(c.id, c.slug);
  res.json({ ok: true });
});

// Wipe the closer meeting log (fresh start) — admin only
app.post("/api/admin/clearmeetings", async (req, res) => {
  if (!adminOk(req)) return res.status(403).json({ error: "solo admin" });
  const n = await db.clearMeetings();
  res.json({ ok: true, cleared: n });
});

// Reset all visit/funnel counters (fresh start before launching ads) — admin only
app.post("/api/sales/clearmetrics", async (req, res) => {
  if (!adminOk(req)) return res.status(403).json({ error: "solo admin" });
  const n = await db.clearMetrics();
  res.json({ ok: true, cleared: n });
});

// Archive ALL sales leads (fresh start before launching ads) — admin only
app.post("/api/sales/clearleads", async (req, res) => {
  if (!adminOk(req)) return res.status(403).json({ error: "solo admin" });
  const av = await db.getContractorBySlug("alto-ventas");
  if (!av) return res.status(404).json({ error: "cuenta de ventas no existe" });
  const n = await db.clearLeads(av.id);
  res.json({ ok: true, archived: n });
});

// Quick CRM note on a sales lead (admin or closer)
app.post("/api/sales/leadnote", async (req, res) => {
  if (!adminOk(req) && !closerOk(req)) return res.status(403).json({ error: "no auth" });
  const av = await db.getContractorBySlug("alto-ventas");
  if (!av) return res.status(404).json({ error: "cuenta de ventas no existe" });
  await db.updateLeadInfo(av.id, String(req.body?.id || ""), { crm_note: String(req.body?.note || "").replace(/\s+/g, " ").trim().slice(0, 200) });
  res.json({ ok: true });
});

// Move a sales lead through the mini-pipeline (admin or closer)
app.post("/api/sales/leadstatus", async (req, res) => {
  if (!adminOk(req) && !closerOk(req)) return res.status(403).json({ error: "no auth" });
  const status = String(req.body?.status || "");
  if (!["new", "contacted", "scheduled", "closed", "not_interested"].includes(status)) return res.status(400).json({ error: "status inválido" });
  const av = await db.getContractorBySlug("alto-ventas");
  if (!av) return res.status(404).json({ error: "cuenta de ventas no existe" });
  await db.setLeadStatus(av.id, String(req.body?.id || ""), status);
  res.json({ ok: true });
});

app.get("/admin", async (req, res) => {
  if (!ADMIN_KEY) return res.status(503).send("Set ADMIN_KEY env var to enable admin.");
  if (req.query.logout != null) { clearKeyCookie(res, "alto_admin"); return res.redirect("/admin"); }
  if (req.query.key === ADMIN_KEY) { setKeyCookie(req, res, "alto_admin", ADMIN_KEY); return res.redirect("/admin"); }
  if (req.query.key && overQuota(`keyguess:${clientIp(req)}`, 30)) return res.status(429).send("Demasiados intentos. Intenta más tarde.");
  if (!adminOk(req)) return res.status(req.query.key ? 403 : 401).send(loginPage("Admin", "/admin", !!req.query.key));
  const KEY = encodeURIComponent(ADMIN_KEY);
  const base = canonBase(req);
  const range = periodRange(req.query, false);
  const [list, stats, recent, rows, mst, devCounts] = await Promise.all([
    db.listContractors(),
    db.leadStats().catch(() => []),
    db.recentLeads(12).catch(() => []),
    db.getMetricsBetween(range.from, range.to).catch(() => []),
    db.meetingStats(range).catch(() => ({ total: 0, scheduled: 0, noShow: 0, showed: 0, closed: 0 })),
    db.sessionCounts().catch(() => ({})),
  ]);
  const closeRate = mst.total ? Math.round((mst.closed / mst.total) * 100) : 0;
  const BUILTIN = new Set(["alto-demo", "alto-ventas", "alto-cercas"]);
  const realClients = list.filter((c) => !BUILTIN.has(c.slug));
  const avAcct = list.find((c) => c.slug === "alto-ventas");
  const salesLeads = avAcct ? await db.listLeads(avAcct.id).catch(() => []) : [];
  const salesPend = salesLeads.filter((l) => (l.status || "new") === "new").length;
  const statOf = (id) => stats.find((x) => String(x.contractor_id) === String(id)) || { total: 0, last7: 0, last_at: null };
  const tot = (e) => rows.filter((r) => r.event === e).reduce((a, r) => a + Number(r.n), 0);
  // Visitor cities (geo:* counters bumped by /api/track) — aggregated over the
  // same date range as the rest of the dashboard, sorted by volume.
  const geoTop = (() => {
    const m = {};
    rows.filter((r) => r.event.startsWith("geo:")).forEach((r) => { const k = r.event.slice(4); m[k] = (m[k] || 0) + Number(r.n); });
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 12);
  })();
  const leadsRange = await db.leadCountInRange(range).catch(() => 0);
  // parcel lookup latency: rolling sample kept by the resolver (diagnostics)
  const plLat = await db.kvGet("pl_lat").catch(() => null);
  const plLatAvg = Array.isArray(plLat) && plLat.length ? Math.round(plLat.reduce((a, b) => a + b, 0) / plLat.length) : 0;
  // real MRR = only clients confirmed paying (Stripe payment or manual activation)
  const payCount = (s) => realClients.filter((c) => (c.data?.payStatus || "") === s).length;
  const paying = payCount("ok");
  const pendingPay = payCount("pending");
  const failedPay = payCount("failed");
  const mrr = realClients.filter((c) => (c.data?.payStatus || "") === "ok").reduce((a, c) => a + PLANS[planOf(c)].price, 0);
  // last-7-days series for the chart (visits per day)
  // chart days = the days that actually have data in the selected range
  // (fallback: last 7 days), newest at the right, capped at 31 columns
  const dataDays = [...new Set(rows.map((r) => r.day))].sort();
  const days = dataDays.length ? dataDays.slice(-31)
    : [...Array(7)].map((_, i) => new Date(Date.now() - (6 - i) * 864e5).toISOString().slice(0, 10));
  const get = (d, e) => Number(rows.find((r) => r.day === d && r.event === e)?.n || 0);
  const maxV = Math.max(1, ...days.map((d) => get(d, "visit")));
  const ago = (x) => { if (!x) return "—"; const h = (Date.now() - new Date(x).getTime()) / 36e5; return h < 1 ? "hace minutos" : h < 24 ? `hace ${Math.round(h)}h` : `hace ${Math.round(h / 24)}d`; };
  const esc = (x) => String(x || "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  // Clientes month tabs — "since when they've been there," newest first.
  // created_at is an ISO string from the JSON store but a Date object from
  // Postgres; normalize through Date or the tabs read "Invalid Date".
  const monthKey = (x) => { const d = new Date(x || ""); return isNaN(d) ? "" : d.toISOString().slice(0, 7); };
  const monthLabel = (mk) => { if (!/^\d{4}-\d{2}$/.test(mk)) return mk; const [y, m] = mk.split("-").map(Number); const s = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("es-MX", { month: "long", year: "numeric" }); return s.charAt(0).toUpperCase() + s.slice(1); };
  const monthsPresent = [...new Set(list.map((c) => monthKey(c.created_at)).filter(Boolean))].sort().reverse();
  res.send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ALTO Pro · Admin</title><link rel="icon" href="/icon-192.png">
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
*{box-sizing:border-box;margin:0;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","SF Pro Display",Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
body{background:#F5F6F8;color:#0B1220;letter-spacing:-0.011em}
::selection{background:rgba(248,180,8,.35)}
a{-webkit-tap-highlight-color:transparent}
header{position:sticky;top:0;z-index:30;background:rgba(16,27,48,.9);backdrop-filter:saturate(180%) blur(20px);-webkit-backdrop-filter:saturate(180%) blur(20px);color:#fff;padding:15px 24px;display:flex;align-items:center;gap:13px;border-bottom:1px solid rgba(255,255,255,.07)}
header img{height:32px;background:#fff;border-radius:10px;padding:4px 7px}
header b{font-size:16px;font-weight:700;letter-spacing:-0.02em}header b em{color:#F8B408;font-style:normal}
header .tag{margin-left:auto;font-size:12.5px;color:#9DA8C4;font-weight:600}
header .tag a{color:#cdd5e5;text-decoration:none}
.wrap{max-width:1100px;margin:0 auto;padding:26px 22px 64px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(166px,1fr));gap:14px}
.card{background:#fff;border:1px solid rgba(16,27,48,.05);border-radius:20px;padding:20px 22px;box-shadow:0 1px 2px rgba(16,27,48,.04),0 10px 26px rgba(16,27,48,.045);transition:transform .2s cubic-bezier(.2,.7,.2,1),box-shadow .2s cubic-bezier(.2,.7,.2,1)}
.card:hover{transform:translateY(-2px);box-shadow:0 2px 5px rgba(16,27,48,.06),0 20px 44px rgba(16,27,48,.10)}
.card .v{font-size:33px;font-weight:700;letter-spacing:-0.035em;line-height:1.04}
.card .l{font-size:11px;font-weight:700;color:#9097A3;letter-spacing:.55px;text-transform:uppercase;margin-top:6px}
.card.gold{background:linear-gradient(155deg,#16243f 0%,#0d1729 100%);color:#fff;border:none;box-shadow:0 1px 2px rgba(0,0,0,.25),0 20px 48px rgba(16,27,48,.30)}
.card.gold .v{color:#F8B408}
.card.gold .l{color:#9DA8C4}
.panel{background:#fff;border:1px solid rgba(16,27,48,.05);border-radius:24px;padding:24px;margin-top:18px;box-shadow:0 1px 2px rgba(16,27,48,.04),0 12px 32px rgba(16,27,48,.05)}
.panel h2{font-size:15.5px;font-weight:700;letter-spacing:-0.015em;margin-bottom:16px}
.chart{display:flex;align-items:flex-end;gap:10px;height:114px;padding:4px 2px 0}
.chart .col{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:6px;height:100%}
.chart .bar{width:100%;max-width:46px;background:linear-gradient(180deg,#FFC83D,#F0A500);border-radius:10px 10px 4px 4px;min-height:3px;box-shadow:0 5px 12px rgba(240,165,0,.28);transition:filter .15s}
.chart .bar:hover{filter:brightness(1.06)}
.chart .lbl{font-size:10.5px;color:#9097A3;font-weight:700}
.chart .num{font-size:11px;font-weight:800;color:#0B1220}
table{width:100%;border-collapse:collapse;font-size:13.5px}
th{text-align:left;color:#9097A3;font-size:10.5px;letter-spacing:.7px;text-transform:uppercase;font-weight:700;padding:10px;border-bottom:1px solid #EEF0F4}
td{padding:14px 10px;border-bottom:1px solid #F2F4F7;font-weight:600;color:#1B2433;vertical-align:middle}
tr[data-name]{transition:background .12s}
tr[data-name]:hover{background:#F8F9FB}
td a{color:#B07A00;font-weight:700;text-decoration:none}
td a:hover{text-decoration:underline}
.pill{display:inline-block;border-radius:99px;padding:4px 11px;font-size:11px;font-weight:700;letter-spacing:.1px;white-space:nowrap}
td .pill{margin:2px 3px 2px 0}
.pill.ok{background:#E7F7ED;color:#10803C}
.pill.warn{background:#FDECEC;color:#C5221F}
.pill.dim{background:#F0F2F6;color:#8A94A8}
.pill.gold{background:#FEF3D6;color:#946400}
/* Client list — a calm scan, not a wall of pills: bold name, one muted
 * metadata line, warning pills ONLY when something needs attention, and a
 * tight row of icon buttons instead of scattered colored links. */
.csum{color:#67718A;font-size:13px;font-weight:700;margin:0 0 12px}
.csum b{color:#101B30}
.crow{display:flex;gap:12px;align-items:center;padding:15px 10px;border-bottom:1px solid #F2F4F7;text-decoration:none;color:#101B30;transition:background .12s}
.crow:last-child{border-bottom:none}
.crow:hover{background:#F7F9FC}
.cdot{width:9px;height:9px;border-radius:50%;background:#1E9E5A;flex-shrink:0;box-shadow:0 0 0 3px rgba(30,158,90,.14)}
.cdot.off{background:#C5221F;box-shadow:0 0 0 3px rgba(197,34,31,.12)}
.cname{flex:1;min-width:0;font-weight:800;font-size:14.5px;letter-spacing:-.01em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cplan{background:#FEF3D6;color:#946400;border-radius:99px;padding:5px 12px;font-size:11.5px;font-weight:800;letter-spacing:.2px;white-space:nowrap;flex-shrink:0}
.cplan.dim{background:#F0F2F6;color:#8A94A8}
.cflag{background:#FDECEC;color:#C5221F;border-radius:99px;padding:5px 10px;font-size:11.5px;font-weight:800;white-space:nowrap;flex-shrink:0}
.cchev{color:#C3C9D4;font-size:19px;font-weight:700;flex-shrink:0;line-height:1}
@media(max-width:560px){.cplann{display:none}.cplan{font-size:11px;padding:4px 10px}.crow{gap:9px}}
.pcount{color:#9097A3;font-weight:600;font-size:13px;margin-left:6px}
.newform{display:flex;gap:10px;flex-wrap:wrap}
.newform input{flex:1;min-width:160px;font-family:inherit;padding:13px 15px;border-radius:13px;border:1px solid #E4E7EC;background:#fff;font-size:14.5px;font-weight:500;outline:none;transition:border-color .15s,box-shadow .15s}
.newform input:focus{border-color:#F8B408;box-shadow:0 0 0 4px rgba(248,180,8,.18)}
.newform button{background:#F8B408;color:#101B30;border:none;border-radius:13px;padding:13px 24px;font-weight:700;cursor:pointer;font-size:14.5px;transition:transform .12s,filter .15s;box-shadow:0 6px 16px rgba(248,180,8,.3)}
.newform button:hover{filter:brightness(1.03)}.newform button:active{transform:scale(.97)}
.legend{color:#9097A3;font-size:12px;margin-top:12px;line-height:1.6}
.closures{border:1px solid rgba(248,180,8,.28);box-shadow:0 1px 2px rgba(16,27,48,.04),0 12px 32px rgba(248,180,8,.08)}
.periodbar{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin:2px 0 18px}
.segs{display:inline-flex;background:#EEF0F4;border-radius:12px;padding:3px;gap:2px}
.segcustom{flex-wrap:wrap}
.segcustom input[type=date]{max-width:146px;min-width:0}
.seg{padding:8px 15px;border-radius:9px;font-size:13px;font-weight:700;color:#5A6475;text-decoration:none;white-space:nowrap}
.seg.on{background:#fff;color:#101B30;box-shadow:0 1px 3px rgba(16,27,48,.12)}
.segcustom{display:inline-flex;gap:7px;align-items:center}
.segcustom input{font-family:inherit;padding:8px 10px;border-radius:10px;border:1px solid #E4E7EC;font-size:13px;font-weight:600;color:#1B2433;outline:none}
.segcustom input:focus{border-color:#F8B408;box-shadow:0 0 0 3px rgba(248,180,8,.18)}
.segcustom button{background:#101B30;color:#fff;border:none;border-radius:10px;padding:9px 16px;font-weight:700;font-size:13px;cursor:pointer}
.segcustom button.on{background:#F8B408;color:#101B30}
.plabel{font-size:12.5px;font-weight:700;color:#9097A3}
.subcards{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:12px}
.sub{background:#F7F8FA;border:1px solid rgba(16,27,48,.05);border-radius:16px;padding:16px 18px}
.sub .v{font-size:26px;font-weight:700;letter-spacing:-.03em;line-height:1.05}
.sub .l{font-size:10.5px;font-weight:700;color:#9097A3;letter-spacing:.5px;text-transform:uppercase;margin-top:5px}
.sub.gold{background:linear-gradient(155deg,#16243f 0%,#0d1729 100%);border:none}
.sub.gold .v{color:#F8B408}.sub.gold .l{color:#9DA8C4}
.grid2{display:grid;gap:18px;grid-template-columns:minmax(0,1fr)}
.grid2>.panel{min-width:0}
@media(min-width:900px){.grid2{grid-template-columns:minmax(0,1.1fr) minmax(0,1fr)}}
.scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
.lgrid{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start;margin-top:6px}
@media(max-width:900px){.lgrid{grid-template-columns:1fr}}
.lgrp{border:1.5px solid #E6E8EC;border-radius:16px;padding:4px 14px 8px;background:#FAFBFD}
.lgrp-t{font-size:11px;font-weight:800;letter-spacing:1.5px;color:#8A94A8;margin:10px 2px 2px}
.lrow{display:flex;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid #EDF0F5;font-size:13.5px;font-weight:600}
.lrow:last-child{border-bottom:none}
.lurl{color:#9AA0AC;font-size:12px;word-break:break-all}
.lbtns{display:flex;gap:6px;flex-shrink:0}
/* Collapsible panels — closed by default so they're out of the way until
 * you actually need them; native <details> handles the show/hide. */
summary.psum{cursor:pointer;list-style:none;display:flex;align-items:center;gap:8px;font-size:15.5px;font-weight:700;letter-spacing:-0.015em}
summary.psum::-webkit-details-marker{display:none}
summary.psum::after{content:"▾";margin-left:auto;color:#9097A3;font-size:13px;transition:transform .15s}
details[open]>summary.psum::after{transform:rotate(180deg)}
.pbody{margin-top:16px}
.mtabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}
.mtabs a{display:inline-flex;align-items:center;gap:5px;background:#EEF0F4;color:#5A6475;text-decoration:none;font-size:13px;font-weight:700;padding:8px 14px;border-radius:99px;white-space:nowrap}
.mtabs a b{font-weight:800}
.mtabs a.on{background:#101B30;color:#fff}
</style></head><body>
<header><img src="/brand-logo.png" alt=""><b>ALTO <em>PRO</em> · Admin</b><span class="tag"><a href="/admin/economics" style="color:#F8B408">🧮 Calculadora</a> · <a href="/cs" style="color:#9DA8C4">🎧 Servicio</a> · <a href="/admin?logout" style="color:#9DA8C4">salir</a></span></header>
<div class="wrap">

${periodSeg("/admin", range, false)}
<div class="cards">
  <div class="card gold"><div class="v">$${mrr.toLocaleString("en-US")}</div><div class="l" style="color:#9DA8C4">MRR · clientes pagando</div></div>
  <div class="card"><div class="v">${paying}</div><div class="l">Pagando</div>${(pendingPay || failedPay) ? `<div style="font-size:11px;font-weight:700;color:#8A94A8;margin-top:4px">${pendingPay ? `${pendingPay} pendiente` : ""}${pendingPay && failedPay ? " · " : ""}${failedPay ? `<span style="color:#C5221F">${failedPay} falló</span>` : ""}</div>` : ""}</div>
  <div class="card"><div class="v">${realClients.length}</div><div class="l">Clientes total</div></div>
  <div class="card"><div class="v">${leadsRange}</div><div class="l">Leads · ${range.label}</div></div>
  <div class="card"><div class="v">${tot("visit")}</div><div class="l">Visitas · ${range.label}</div></div>
  <div class="card"><div class="v">${tot("quiz_done")}</div><div class="l">Llamadas pedidas</div></div>
</div>

<div class="panel closures"><details data-p="cierres">
  <summary class="psum">💰 Cierres · reuniones del closer <span style="color:#9097A3;font-weight:600;font-size:12.5px">· ${range.label}</span></summary>
  <div class="subcards">
    <div class="sub gold"><div class="v">${closeRate}%</div><div class="l">Tasa de cierre</div></div>
    <div class="sub"><div class="v">${mst.total}</div><div class="l">Reuniones</div></div>
    <div class="sub"><div class="v">${mst.showed}</div><div class="l">Asistieron</div></div>
    <div class="sub"><div class="v" style="color:#21438A">${mst.followUp || 0}</div><div class="l">En seguimiento</div></div>
    <div class="sub"><div class="v" style="color:#C5221F">${mst.noShow}</div><div class="l">No-shows</div></div>
    <div class="sub"><div class="v">${mst.closed}</div><div class="l">Cerrados</div></div>
  </div>
  <p class="legend">Lo que registra tu closer en su portal. Las cuentas activadas con pago se ven en <b>MRR</b> arriba.</p>
</details></div>

<div class="grid2">
<div class="panel"><details data-p="visitas">
  <summary class="psum">📈 Visitas a la página · ${range.label}</summary>
  <div class="chart">
    ${days.map((d) => { const v = get(d, "visit"); return `<div class="col"><span class="num">${v || ""}</span><div class="bar" style="height:${Math.round((v / maxV) * 100)}%"></div><span class="lbl">${d.slice(5)}</span></div>`; }).join("")}
  </div>
</details></div>
<div class="panel"><details data-p="embudo">
  <summary class="psum">🫙 Embudo · ${range.label}</summary>
  <div class="scroll"><table>
    <tr><th>Visitas</th><th>Widget visto</th><th>Cotizó</th><th>Prueba app</th><th>Quiz inició</th><th>Agendó</th></tr>
    <tr><td>${tot("visit")}</td><td>${tot("w_view")}</td><td>${tot("w_result")}</td><td>${tot("trial_link")}</td><td>${tot("quiz_work")}</td><td>${tot("quiz_done")}</td></tr>
  </table></div>
  ${geoTop.length || tot("geo_bot") ? (() => {
    const mx = geoTop.length ? geoTop[0][1] : 1;
    const totalGeo = geoTop.reduce((a, [, n]) => a + n, 0) || 1;
    const bots = tot("geo_bot");
    return `<p style="font-size:12px;font-weight:800;letter-spacing:1px;color:#8A94A8;margin:18px 0 8px">🌎 DE DÓNDE NOS VISITAN</p>
    ${geoTop.map(([city, n]) => `<div style="display:flex;align-items:center;gap:10px;margin:5px 0">
      <span style="flex:0 0 170px;font-size:13px;font-weight:700;color:#101B30;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${city.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]))}</span>
      <span style="flex:1;background:#F0F2F6;border-radius:6px;height:14px;overflow:hidden"><span style="display:block;height:100%;width:${Math.max(4, Math.round((n / mx) * 100))}%;background:#F8B408;border-radius:6px"></span></span>
      <span style="flex:0 0 64px;text-align:right;font-size:12.5px;font-weight:800;color:#5A6478">${n} · ${Math.round((n / totalGeo) * 100)}%</span>
    </div>`).join("")}
    ${bots ? `<p style="font-size:12px;color:#9AA3B2;font-weight:600;margin:8px 0 0">🤖 ${bots} visita${bots === 1 ? "" : "s"} de bots o proxies (datacenters, rastreadores de links, iCloud Private Relay) — no cuentan como ciudades.</p>` : ""}`;
  })() : ""}
  ${tot("pl_req") ? `<p style="font-size:12px;font-weight:800;letter-spacing:1px;color:#8A94A8;margin:18px 0 4px">🗺️ PARCELAS (REGRID)</p>
  <p style="font-size:12.5px;color:#5A6478;font-weight:600;line-height:1.7">${tot("pl_req")} búsquedas · ${tot("pl_cache")} de caché (gratis) · ${tot("pl_found")} encontradas · ${tot("pl_ambig")} ambiguas · ${tot("pl_none")} sin datos · ${tot("pl_err")} errores · ~${tot("pl_records")} registros cobrados${plLatAvg ? ` · ${plLatAvg} ms prom.` : ""}</p>` : ""}
  <p class="legend">Visitas = página de ventas · Widget visto = abrieron el cotizador · Cotizó = vieron precio · Prueba app = pidieron su link de prueba · Quiz inició = 1ª pregunta · Agendó = dejaron datos. Las ciudades salen de la IP del visitante (solo totales, nunca guardamos la IP en las métricas). El filtro de fechas de arriba aplica a todo el tablero.</p>
</details></div>
</div>

<div class="panel"><details data-p="embudos2">
  <summary class="psum">📊 Embudos de pago · ${range.label}</summary>
  ${(() => {
    // Executive funnel board: north-star tiles, one shared stage skeleton
    // (funnels as columns, TOTAL last), benchmark-colored rates so the leak
    // screams without reading numbers, and a CAC calculator per funnel.
    // sale/paid/cancel come from the Stripe webhook — the page can't lie.
    const FUNNELS = [["app", "📱 App Techos", "/app"], ["app-cercas", "🪵 App Cercas", "/app-cercas"], ["vsl-app", "🎬 VSL App", "/video"], ["vsl-completo", "🎬 VSL $297", "/completo"], ["pagina", "🌐 Página $49", "/pagina"]];
    const PRICE = { app: 67, "app-cercas": 67, "vsl-app": 67, "vsl-completo": 297 };
    const STEPS = [["visit", "Visitas"], ["play", "▶ Empezó el video"], ["watch50", "Vio la mitad del video"], ["lead", "Leads (dejó teléfono)"], ["try", "Probó la app (1ª medición)"], ["block", "Llegó al tope (3)"], ["buy", "Click a pagar"], ["sale", "Cuenta creada ($0 hoy)"], ["paid", "Pagó día 8 💰"], ["cancel", "Canceló la prueba"]];
    const f = (fn, st) => (fn === "__total" ? FUNNELS.reduce((a, [id]) => a + tot(`fn:${id}:${st}`), 0) : tot(`fn:${fn}:${st}`));
    // benchmarks (% of the DENOMINATOR stage): [good, acceptable] — cold-traffic SaaS
    const BM = { lead: [12, 6], try: [60, 35], block: [50, 25], buy: [20, 10], sale: [40, 20], paid: [40, 25], play: [50, 30], watch50: [50, 30] };
    // explicit denominator per stage (first non-zero wins) — video steps are a
    // side-path, so leads compare against VISITS, never against watch counts
    const DEN = { play: ["visit"], watch50: ["play"], lead: ["visit"], try: ["lead"], block: ["try", "lead"], buy: ["block", "lead", "visit"], sale: ["buy", "lead", "visit"], paid: ["sale"], cancel: ["sale"] };
    const COLS = [...FUNNELS.map(([id]) => id), "__total"];
    const cell = (fn, i) => {
      const st = STEPS[i][0];
      const n = f(fn, st);
      if (!n) return `<td style="color:#C2C8D4">—</td>`;
      let prev = 0;
      for (const d of DEN[st] || []) { const p = f(fn, d); if (p > 0) { prev = p; break; } }
      let pctHtml = "";
      if (prev > 0 && i > 0) {
        const pct = Math.round((n / prev) * 100);
        let color = "#8A94A8", tip = "";
        if (st === "cancel") { color = pct <= 40 ? "#1E7B3C" : pct <= 60 ? "#B07A00" : "#C5221F"; tip = "Bueno ≤40% · Regular ≤60% (de las cuentas creadas)"; }
        else if (BM[st]) { const [g, a] = BM[st]; color = pct >= g ? "#1E7B3C" : pct >= a ? "#B07A00" : "#C5221F"; tip = `Bueno ≥${g}% · Regular ≥${a}% (de la etapa anterior)`; }
        pctHtml = ` <span title="${tip}" style="color:${color};font-weight:800;font-size:11px">${pct}%</span>`;
      }
      return `<td><b>${n}</b>${pctHtml}</td>`;
    };
    // north-star strip: what the CEO reads before anything else
    const tv = f("__total", "visit"), tl = f("__total", "lead"), ts = f("__total", "sale"), tp = f("__total", "paid"), tc = f("__total", "cancel");
    const newMrr = FUNNELS.reduce((a, [id]) => a + f(id, "paid") * PRICE[id], 0);
    const pct2 = (n, d) => (d > 0 ? Math.round((n / d) * 100) + "%" : "—");
    const tiles = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin:14px 0 18px">
      <div class="sub"><div class="v">${tv}</div><div class="l">Visitas</div></div>
      <div class="sub"><div class="v">${tl} <small style="color:#8A94A8;font-size:12px">${pct2(tl, tv)}</small></div><div class="l">Leads</div></div>
      <div class="sub"><div class="v">${ts}</div><div class="l">Pruebas (tarjeta)</div></div>
      <div class="sub"><div class="v" style="color:${tp > 0 ? "#1E7B3C" : "#101B30"}">${tp} <small style="color:#8A94A8;font-size:12px">${pct2(tp, ts)}</small></div><div class="l">Pagaron día 8</div></div>
      <div class="sub"><div class="v" style="color:${tc > 0 ? "#C5221F" : "#101B30"}">${tc}</div><div class="l">Cancelaron</div></div>
      <div class="sub"><div class="v" style="color:#1E7B3C">$${newMrr.toLocaleString()}</div><div class="l">MRR nuevo (rango)</div></div>
    </div>`;
    const header = `<tr><th style="text-align:left">Etapa</th>${FUNNELS.map(([, lbl, url]) => `<th>${lbl}<br><a href="${url}" target="_blank" rel="noreferrer" style="font-weight:700;font-size:10.5px;color:#21438A;text-decoration:none">Ver página ↗</a></th>`).join("")}<th style="background:#F7F9FC">Σ TOTAL</th></tr>`;
    const table = `<div class="scroll"><table>
      ${header}
      ${STEPS.map(([, lbl], i) => `<tr><td style="text-align:left;font-weight:700">${lbl}</td>${COLS.map((id) => cell(id, i)).join("")}</tr>`).join("")}
    </table></div>`;
    // CAC calculator: type this range's ad spend per funnel → CPL, cost per
    // trial and CAC appear instantly (client-side; nothing is saved).
    const counts = {};
    for (const [id] of FUNNELS) counts[id] = { lead: f(id, "lead"), sale: f(id, "sale"), paid: f(id, "paid") };
    const calc = `<p style="font-size:12px;font-weight:800;letter-spacing:1px;color:#8A94A8;margin:18px 0 8px">💸 CALCULADORA CAC — escribe el gasto de anuncios del rango</p>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px">
      ${FUNNELS.map(([id, lbl]) => `<div style="background:#fff;border:1px solid #E8ECF3;border-radius:14px;padding:12px 14px">
        <div style="font-size:12.5px;font-weight:800;margin-bottom:6px">${lbl}</div>
        <input id="sp_${id}" type="number" min="0" placeholder="$ gastado" oninput="embCalc('${id}')" style="width:100%;padding:9px 10px;border:1.5px solid #E4E7EC;border-radius:10px;font-size:14px;font-weight:600;font-family:inherit;outline:none">
        <div id="spr_${id}" style="font-size:12px;font-weight:700;color:#5A6478;margin-top:7px">—</div>
      </div>`).join("")}
    </div>
    <script>
    var EMB=${JSON.stringify(counts)};
    function embCalc(fn){
      var v=parseFloat(document.getElementById('sp_'+fn).value)||0;
      var d=EMB[fn],el=document.getElementById('spr_'+fn);
      if(!v){el.textContent='—';return}
      var m=function(n){return n>0?'$'+Math.round(v/n).toLocaleString():'—'};
      el.innerHTML='CPL <b>'+m(d.lead)+'</b> · Costo/prueba <b>'+m(d.sale)+'</b> · CAC <b style="color:'+(d.paid>0&&v/d.paid<=220?'#1E7B3C':'#C5221F')+'">'+m(d.paid)+'</b>';
    }
    </script>`;
    // per-creative attribution: the table that decides which ads DIE
    const crAgg = {};
    for (const r of rows) {
      if (!r.event.startsWith("cr:")) continue;
      const parts = r.event.split(":");
      const key = parts[1] + "|" + parts.slice(3).join(":");
      crAgg[key] = crAgg[key] || { funnel: parts[1], slug: parts.slice(3).join(":"), visit: 0, lead: 0, buy: 0 };
      crAgg[key][parts[2]] = (crAgg[key][parts[2]] || 0) + Number(r.n);
    }
    const crRows = Object.values(crAgg).sort((a, b) => b.visit - a.visit).slice(0, 20);
    const crTable = crRows.length ? `<p style="font-size:12px;font-weight:800;letter-spacing:1px;color:#8A94A8;margin:18px 0 8px">🎯 POR ANUNCIO (utm_content)</p>
    <div class="scroll"><table>
      <tr><th style="text-align:left">Anuncio</th><th>Embudo</th><th>Visitas</th><th>Leads</th><th>Lead %</th><th>Click a pagar</th></tr>
      ${crRows.map((c) => `<tr><td style="text-align:left;font-weight:700">${String(c.slug).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]))}</td><td>${c.funnel}</td><td>${c.visit || 0}</td><td>${c.lead || 0}</td><td>${c.visit ? Math.round(((c.lead || 0) / c.visit) * 100) + "%" : "—"}</td><td>${c.buy || 0}</td></tr>`).join("")}
    </table></div>` : `<p style="font-size:12.5px;color:#9AA3B2;font-weight:600;margin-top:14px">🎯 Para ver resultados POR ANUNCIO: a cada link de anuncio agrégale <code style="background:#F0F2F6;padding:2px 6px;border-radius:6px">?utm_source=fb&utm_campaign=nombre-campaña&utm_content=nombre-del-anuncio</code> — aquí aparecerá una fila por anuncio con sus visitas, leads y clicks a pagar.</p>`;
    return tiles + table + calc + crTable;
  })()}
  <p class="legend">Cada columna es un embudo (click en "Ver página ↗" para abrirlo); cada celda muestra el total y el % de la etapa anterior, coloreado contra referencias de la industria: <b style="color:#1E7B3C">verde</b> = bueno, <b style="color:#B07A00">ámbar</b> = regular, <b style="color:#C5221F">rojo</b> = ahí se fuga la gente (pasa el mouse para ver la referencia). "Cuenta creada", "Pagó día 8" y "Canceló" los reporta Stripe solo — la página no puede inflarlos. Regla del CAC: un cliente vale LTV ≈ $67 ÷ churn mensual (con 10% de churn ≈ $670), y el negocio escala sano con CAC ≤ ⅓ del LTV (≈ $220) — la calculadora lo pinta verde/rojo con esa regla. El filtro de fechas de arriba aplica aquí también.</p>
</details></div>

<div class="panel"><details data-p="ventas">
  <summary class="psum">📣 Leads de venta ${salesPend ? `· <b style="color:#C5221F">${salesPend} sin contactar</b>` : `(${salesLeads.length})`}</summary>
  <div class="pbody">${salesLeadsPanel(salesLeads, KEY)}</div>
</details></div>

<div class="panel"><details data-p="enlaces">
  <summary class="psum">🔗 Tus enlaces</summary>
  <div class="pbody">
  ${[
    ["⭐ TU DÍA A DÍA — LOS 3 DE SIEMPRE", [
      ["1️⃣ 🎤 Presentación de ventas (en la llamada)", `${base}/demo`],
      ["2️⃣ 🎨 Onboarding (armar/editar páginas)", `${base}/onboarding`],
      ["3️⃣ 🎧 Customer service (tickets y tareas)", `${base}/cs`],
    ]],
    ["PÚBLICO · VENTAS", [
      ["🌐 Página de ventas", "https://alto-pro.com"],
      ["🛰️ Demo del cotizador (mándalo a prospectos)", `${base}/w/alto-demo`],
      ["🏠 Página de ejemplo", `${base}/ejemplo`],
      ["🎨 Las 3 plantillas", `${base}/plantillas`],
      ...(FENCE_ENABLED ? [
        ["🪵 CERCAS · página de ventas", `${base}/cercas`],
        ["🪵 CERCAS · demo del cotizador", `${base}/w/alto-cercas`],
        ["🪵 CERCAS · página de ejemplo", `${base}/ejemplo-cercas`],
        ["🪵 CERCAS · demo de la app", `${base}/?demo=fence`],
      ] : []),
    ]],
    ["EQUIPO · VENTAS (closer)", [
      ["🔒 Portal del closer", `${base}/closer`],
      ["📋 Cierre / objeciones (privado)", `${base}/cierre`],
    ]],
    ["RECLUTAR", [
      ["👤 Presentación del rol (reclutar)", `${base}/equipo`],
    ]],
    ["PRIVADO · TÚ", [
      ["📊 Este tablero (admin)", `${base}/admin`],
      ["🧠 Centro de mando · números + IA", `${base}/admin/economics`],
      ["📣 Leads de ventas (llegan de los anuncios)", `${base}/admin/c/alto-ventas`],
      ["📲 La app (instalar/probar)", "https://app.alto-pro.com"],
      ["🩺 Estado del sistema (health)", `${base}/api/health`],
    ]],
  ].reduce((h, [group, links]) => h + `
    <div class="lgrp">
    <p class="lgrp-t">${group}</p>
    ${links.map(([name, url]) => {
      return `<div class="lrow">
      <span style="flex:1">${name}<br><span class="lurl">${url}</span></span>
      <span class="lbtns">
        <button onclick="cpy(this,'${url}')" style="background:#F8B408;color:#101B30;border:none;border-radius:8px;padding:7px 12px;font-weight:800;cursor:pointer;font-size:12px">Copiar</button>
        <a href="${url}" target="_blank" style="background:#101B30;color:#fff;border-radius:8px;padding:7px 12px;font-weight:800;text-decoration:none;font-size:12px">Abrir</a>
      </span>
    </div>`; }).join("")}
    </div>
  `, `<div class="lgrid">`) + `</div>`}
  <p style="color:#9AA0AC;font-size:12px;margin-top:14px">El portal del closer y el onboarding piden clave; los públicos no.</p>
  </div>
</details></div>

<div class="panel"><details data-p="nuevo">
  <summary class="psum">➕ Nuevo cliente</summary>
  <form class="newform" method="post" action="/api/admin/contractors?html=1">
    <input name="name" placeholder="Nombre del negocio" required>
    <input name="phone" placeholder="Teléfono">
    ${FENCE_ENABLED ? `<select name="trade" style="font-family:inherit;padding:12px 14px;border-radius:12px;border:1.5px solid #E4E7EC;font-weight:600;background:#fff;color:#101B30"><option value="roofing">🏠 Techos</option><option value="fence">🪵 Cercas</option></select>` : ""}
    <select name="plan" style="font-family:inherit;padding:12px 14px;border-radius:12px;border:1.5px solid #E4E7EC;font-weight:600;background:#fff;color:#101B30"><option value="">Plan (opcional) — se auto-detecta con el pago</option>${Object.entries(PLANS).map(([k, p]) => `<option value="${k}">${p.name} — $${p.price}/mes</option>`).join("")}</select>
    <button>Crear cuenta</button>
  </form>
</details></div>

<div class="panel"><details data-p="clientes">
  <summary class="psum">👷 Clientes<span class="pcount">(${list.length})</span></summary>
  <div class="pbody">
  <p class="csum"><b>${realClients.filter((c) => !(c.data && c.data.status === "paused")).length}</b> activos · <b>${realClients.filter((c) => c.data && c.data.status === "paused").length}</b> pausados · <b>$${mrr.toLocaleString("en-US")}</b> MRR</p>
  <input id="csearch" placeholder="🔍 Buscar cliente por nombre…" onkeyup="filterClients()" style="width:100%;padding:14px 16px;border:1px solid #E4E7EC;border-radius:14px;font-size:14.5px;font-weight:500;font-family:inherit;outline:none;margin-bottom:14px;transition:border-color .15s,box-shadow .15s" onfocus="this.style.borderColor='#F8B408';this.style.boxShadow='0 0 0 4px rgba(248,180,8,.18)'" onblur="this.style.borderColor='#E4E7EC';this.style.boxShadow='none'">
  <div class="mtabs" id="mtabs">
    <a href="#" class="on" data-m="all" onclick="filterMonth('all');return false">Todos <b>(${list.length})</b></a>
    ${monthsPresent.map((mk) => {
      const count = list.filter((c) => monthKey(c.created_at) === mk).length;
      return `<a href="#" data-m="${mk}" onclick="filterMonth('${mk}');return false">${monthLabel(mk)} <b>(${count})</b></a>`;
    }).join("")}
  </div>
  <div id="clist">
  ${list.map((c) => {
    const isB = BUILTIN.has(c.slug);
    const isPaused = c.data && c.data.status === "paused";
    const pay = c.data && c.data.payStatus;
    const dev = devCounts[String(c.id)] || 0;
    // The row answers one question at a glance: who is it, what plan, and is
    // anything on fire. Everything else (actions, links, payments, GHL) lives
    // on the client page the whole row links to.
    const issues = [
      isPaused ? "pausado" : "",
      pay === "failed" ? "pago falló" : "",
      pay === "pending" ? "pago pendiente" : "",
      pay === "canceled" ? "canceló" : "",
      (!isB && dev > 5) ? `${dev} dispositivos — posible link compartido` : "",
    ].filter(Boolean);
    return `<a class="crow" href="/admin/c/${c.slug}" data-name="${esc(c.name).toLowerCase()} ${c.slug}" data-month="${monthKey(c.created_at)}">
      <span class="cdot${isPaused ? " off" : ""}" title="${isPaused ? "Pausado" : "Activo"}"></span>
      <span class="cname">${esc(c.name)}</span>
      ${c.data?.trade === "fence" ? '<span class="cplan" style="background:#E8F4EA;color:#1E6B33">🪵 CERCAS</span>' : ""}
      ${issues.length ? `<span class="cflag" title="${esc(issues.join(" · "))}">⚠ ${issues.length}</span>` : ""}
      ${isB ? '<span class="cplan dim">interno</span>' : `<span class="cplan"><span class="cplann">${PLANS[planOf(c)].name.split(" ·")[0].toUpperCase()} · </span>$${PLANS[planOf(c)].price}/mes</span>`}
      <span class="cchev">›</span>
    </a>`;
  }).join("")}
  </div>
  </div>
</details></div>

<div class="panel"><details data-p="ultimos">
  <summary class="psum">📥 Últimos leads (todos los clientes)</summary>
  <div class="pbody">
  <div class="scroll"><table>
  <tr><th>Cuándo</th><th>Cliente</th><th>Nombre</th><th>Teléfono</th><th>Dirección / datos</th><th>Estimado</th></tr>
  ${recent.length === 0 ? `<tr><td colspan="6" style="color:#8A94A8">Todavía no hay leads — llegarán aquí en cuanto alguien cotice o llene el quiz.</td></tr>` : recent.map((l) => {
    const i = l.info || {};
    const extra = i.work ? `${esc(i.work)} · ${esc(i.crew || "")} · ${esc(i.revenue || "")}` : esc(l.address);
    const est = i.low ? `$${Number(i.low).toLocaleString("en-US")}–$${Number(i.high).toLocaleString("en-US")}` : "—";
    return `<tr><td>${ago(l.created_at)}</td><td>${esc(l.contractor_name || l.slug)}</td><td>${esc(l.name)}</td><td>${esc(l.phone)}</td><td>${extra}</td><td>${est}</td></tr>`;
  }).join("")}
  </table></div>
  </div>
</details></div>

</div>
<div class="panel"><details data-p="mant">
  <summary class="psum">⚙️ Mantenimiento · empezar de cero</summary>
  <div class="pbody">
    <p class="legend" style="margin-bottom:12px">Botones de reinicio total — pensados para justo antes de prender anuncios. Cada uno pide confirmación. Para borrar un cliente: entra a su página y usa 🗑️ Eliminar.</p>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <a class="mant" style="background:#E8F4EA;border-color:#BFE3C6;color:#1E6B33;text-decoration:none;display:inline-block" href="/api/admin/backup">⬇️ Descargar respaldo (todos los datos)</a>
      <button class="mant" style="background:#EAF1FB;border-color:#Bcd3f2;color:#1A5AAB" onclick="document.getElementById('restoreFile').click()">⬆️ Restaurar respaldo</button>
      <input type="file" id="restoreFile" accept="application/json,.json" style="display:none" onchange="doRestore(this)">
      <button class="mant" onclick="if(confirm('¿Archivar TODOS los leads de venta actuales? El buzón queda en cero. (Se archivan, no se destruyen.)'))fetch('/api/sales/clearleads',{method:'POST'}).then(r=>r.json()).then(j=>j.ok?location.reload():alert('Error'))">🧹 Archivar leads de venta</button>
      <button class="mant" onclick="if(confirm('¿Reiniciar TODAS las estadísticas de visitas y embudo a cero?'))fetch('/api/sales/clearmetrics',{method:'POST'}).then(r=>r.json()).then(j=>j.ok?location.reload():alert('Error'))">🧹 Reiniciar visitas y embudo</button>
      <button class="mant" onclick="if(confirm('¿Borrar TODO el historial de reuniones del closer?'))fetch('/api/admin/clearmeetings',{method:'POST'}).then(r=>r.json()).then(j=>j.ok?location.reload():alert('Error'))">🧹 Reiniciar reuniones del closer</button>
    </div>
  </div>
</details></div>
<style>.mant{border:1.5px solid #F5C6C0;background:#fff;color:#C5221F;border-radius:12px;font-weight:800;font-size:13px;padding:12px 16px;cursor:pointer}</style>

<script>
// panels ALWAYS start collapsed (owner's call) — no per-browser memory
try{localStorage.removeItem('alto_panels')}catch(e){}
function cpy(btn,url){navigator.clipboard.writeText(url);var o=btn.textContent;btn.textContent='✓';setTimeout(function(){btn.textContent=o},900);}
function doRestore(inp){
  var f=inp.files&&inp.files[0]; inp.value='';
  if(!f)return;
  var rd=new FileReader();
  rd.onload=function(){
    var dump; try{dump=JSON.parse(rd.result);}catch(e){alert('Ese archivo no es un respaldo válido (no es JSON).');return;}
    var nC=(dump.contractors||[]).length, nL=(dump.leads||[]).length;
    if(!Array.isArray(dump.contractors)){alert('Ese archivo no parece un respaldo de ALTO Pro.');return;}
    if(!confirm('Restaurar este respaldo?\\n\\n'+nC+' clientes y '+nL+' leads se van a AGREGAR o ACTUALIZAR. No se borra nada de lo que ya tienes.\\n\\nEscribe RESTAURAR en el siguiente paso para confirmar.'))return;
    var typed=prompt('Para confirmar, escribe: RESTAURAR');
    if(typed!=='RESTAURAR'){alert('Cancelado — no se restauró nada.');return;}
    fetch('/api/admin/restore',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirm:'RESTAURAR',dump:dump})})
      .then(function(r){return r.json();})
      .then(function(j){ if(j.ok){var n=j.restored||{};alert('Respaldo restaurado ✓\\n\\nClientes: '+n.contractors+'\\nLeads: '+n.leads+'\\nReuniones: '+n.meetings+'\\nTareas: '+n.tasks);location.reload();} else alert('Error: '+(j.error||'?')); })
      .catch(function(){alert('No se pudo restaurar (revisa tu conexión).');});
  };
  rd.readAsText(f);
}
var currentMonth='all';
function filterMonth(m){
  currentMonth=m;
  [].forEach.call(document.querySelectorAll('#mtabs a'),function(a){a.classList.toggle('on',a.getAttribute('data-m')===m);});
  filterClients();
}
function filterClients(){
  var q=document.getElementById('csearch').value.toLowerCase().trim();
  [].forEach.call(document.querySelectorAll('.crow[data-name]'),function(row){
    var matchQ = !q || row.getAttribute('data-name').indexOf(q)>=0;
    var matchM = currentMonth==='all' || row.getAttribute('data-month')===currentMonth;
    row.style.display = (matchQ && matchM) ? '' : 'none';
  });
}
</script>
</body></html>`);
});

// Per-client control page — everything about one client + every action
/* Unit-economics calculator (/admin/economics) — private, admin-only.
 * Plug in the 5 funnel numbers → live CAC, payback, LTV, profit/client. */
// AI "CEO briefing": turns the cockpit numbers into a short prioritized plan.
app.post("/api/admin/ceo", async (req, res) => {
  if (!adminOk(req)) return res.status(403).json({ error: "no auth" });
  const en = req.body?.lang === "en";
  const m = req.body?.metrics || {};
  const system = `You are a sharp, no-nonsense fractional CEO / growth advisor for ALTO Pro, a Spanish-first SaaS sold to Hispanic roofing contractors in three plans: $67/mo (app only), $197/mo (app + roof-quote widget on their existing site), $297/mo (done-for-you website + AI chat + domain + leads). Given the numbers, write a concise, PRIORITIZED action plan in ${en ? "English" : "Spanish"}, max 160 words, plain text (no markdown headers). Be direct and specific: if close rate is low, say to fix/coach/replace closers BEFORE scaling ads; if unit economics are strong (LTV:CAC >= 3, payback < 3mo), say to scale ad spend and by roughly how much; flag churn and failed payments as fires to put out first. End with the single most important next action. No fluff.`;
  const user = `Numbers: ${JSON.stringify(m)}`;
  try {
    const text = await aiChat({ system, messages: [{ role: "user", content: user }], maxTokens: 380 });
    if (!text) return res.json({ ok: false, error: "ai_off" });
    res.json({ ok: true, text });
  } catch (e) { res.json({ ok: false, error: "ai_off" }); }
});

app.get("/admin/economics", async (req, res) => {
  if (!ADMIN_KEY) return res.status(503).send("Set ADMIN_KEY env var to enable admin.");
  if (req.query.key === ADMIN_KEY) { setKeyCookie(req, res, "alto_admin", ADMIN_KEY); return res.redirect("/admin/economics"); }
  if (req.query.key && overQuota(`keyguess:${clientIp(req)}`, 30)) return res.status(429).send("Demasiados intentos. Intenta más tarde.");
  if (!adminOk(req)) return res.status(req.query.key ? 403 : 401).send(loginPage("Admin", "/admin/economics", !!req.query.key));
  const en = req.query.lang === "en";
  const tr = (es, eng) => (en ? eng : es);
  // pull REAL numbers from the system
  const now = new Date();
  const mFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const [mst, mstMonth, list, leadsMonth] = await Promise.all([
    db.meetingStats().catch(() => ({ total: 0, closed: 0, noShow: 0 })),
    db.meetingStats({ from: mFrom, to: null }).catch(() => ({ total: 0, closed: 0 })),
    db.listContractors().catch(() => []),
    db.leadCountInRange({ from: mFrom, to: null }).catch(() => 0),
  ]);
  const clients = list.filter((c) => !["alto-demo", "alto-ventas", "alto-cercas"].includes(c.slug));
  const payCount = (s) => clients.filter((c) => (c.data?.payStatus || "") === s).length;
  const live = {
    realClose: mst.total ? Math.round((mst.closed / mst.total) * 100) : null,
    meetings: mst.total, closed: mst.closed, noShow: mst.noShow || 0, meetingsMonth: mstMonth.total || 0,
    closedMonth: mstMonth.closed || 0, closeRateMonth: mstMonth.total ? Math.round((mstMonth.closed / mstMonth.total) * 100) : 0, leadsMonth,
    clients: clients.length, paying: payCount("ok"), pending: payCount("pending"), failed: payCount("failed"), canceled: payCount("canceled"),
  };
  res.send(`<!doctype html><html lang="${en ? "en" : "es"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ALTO Pro · ${tr("Centro de mando", "Command center")}</title><link rel="icon" href="/icon-192.png"><style>
*{box-sizing:border-box;margin:0;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
body{background:#F5F6F8;color:#0B1220;letter-spacing:-0.011em}
::selection{background:rgba(248,180,8,.35)}
.appheader{position:sticky;top:0;z-index:30;background:rgba(16,27,48,.9);backdrop-filter:saturate(180%) blur(20px);-webkit-backdrop-filter:saturate(180%) blur(20px);color:#fff;padding:15px 24px;display:flex;align-items:center;gap:13px;border-bottom:1px solid rgba(255,255,255,.07)}
.appheader img{height:30px;background:#fff;border-radius:9px;padding:4px 6px}
.appheader b{font-size:16px;font-weight:700;letter-spacing:-0.02em}.appheader b em{color:#F8B408;font-style:normal}
.appheader .right{margin-left:auto;display:flex;gap:8px;align-items:center}
.appheader .right a{color:#cdd5e5;text-decoration:none;font-weight:600;font-size:13px;border-radius:99px;padding:7px 14px}
.appheader .right a.dark{background:rgba(255,255,255,.1);color:#fff}
.wrap{max-width:1120px;margin:0 auto;padding:24px 22px 70px}
h1{font-size:25px;font-weight:700;letter-spacing:-0.03em}
.sub{color:#5E6675;font-weight:500;font-size:13.5px;margin:6px 0 18px;line-height:1.6;max-width:680px}
.sect{font-size:12px;color:#9097A3;letter-spacing:.6px;text-transform:uppercase;font-weight:800;margin:22px 0 10px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px}
.card{background:#fff;border:1px solid rgba(16,27,48,.05);border-radius:16px;padding:16px;box-shadow:0 1px 2px rgba(16,27,48,.04),0 8px 22px rgba(16,27,48,.045)}
.card .v{font-size:25px;font-weight:700;letter-spacing:-0.035em;line-height:1.04}
.card .l{font-size:10.5px;font-weight:700;color:#9097A3;letter-spacing:.4px;text-transform:uppercase;margin-top:5px}
.card .s{font-size:11px;font-weight:600;color:#8A94A8;margin-top:4px;line-height:1.4}
.card.gold{background:linear-gradient(155deg,#16243f 0%,#0d1729 100%);border:none}
.card.gold .v{color:#F8B408}.card.gold .l{color:#9DA8C4}.card.gold .s{color:#9DA8C4}
.card.good .v{color:#10803C}.card.bad .v{color:#C5221F}.card.warnc .v{color:#946400}
.grid{display:grid;gap:16px;margin-top:6px}
@media(min-width:900px){.grid{grid-template-columns:360px 1fr;align-items:start}}
.panel{background:#fff;border:1px solid rgba(16,27,48,.05);border-radius:20px;padding:20px 22px;box-shadow:0 1px 2px rgba(16,27,48,.04),0 10px 26px rgba(16,27,48,.05)}
.panel h3{font-size:12px;color:#9097A3;letter-spacing:.6px;text-transform:uppercase;font-weight:700;margin-bottom:14px}
.fld{margin-bottom:13px}
.fld label{display:block;font-weight:600;font-size:12.5px;color:#475067;margin-bottom:5px}
.fld .row{display:flex;align-items:center;gap:9px}
.fld input[type=range]{flex:1;accent-color:#F8B408}
.fld .val{min-width:78px;display:flex;align-items:center;background:#F4F6FA;border:1px solid #E4E7EC;border-radius:9px;padding:6px 9px;font-weight:800;font-size:13.5px;color:#101B30}
.fld .val .pre{color:#9097A3;font-weight:700;margin-right:2px}
.fld .val input{width:100%;border:none;background:none;outline:none;font-weight:800;font-size:13.5px;color:#101B30;text-align:right;font-family:inherit}
.fld .hint{color:#9097A3;font-size:11px;font-weight:500;margin-top:3px}
.fx{display:flex;gap:7px;align-items:center;margin-bottom:7px}
.fx input.n{flex:1;font-family:inherit;padding:8px 10px;border:1px solid #E4E7EC;border-radius:9px;font-size:13px;font-weight:600;outline:none}
.fx input.a{width:74px;font-family:inherit;padding:8px 10px;border:1px solid #E4E7EC;border-radius:9px;font-size:13px;font-weight:800;text-align:right;outline:none}
.fx button{background:#FDECEC;border:none;color:#C5221F;border-radius:8px;width:30px;height:32px;font-weight:800;cursor:pointer}
.fxadd{background:#fff;border:1px dashed #C9CDD6;border-radius:9px;padding:8px;font-weight:700;font-size:12.5px;color:#475067;cursor:pointer;width:100%}
.fxtot{display:flex;justify-content:space-between;font-weight:800;font-size:14px;margin-top:8px;padding-top:8px;border-top:1px solid #EEF0F4}
.adv{display:flex;gap:10px;align-items:flex-start;padding:10px 0;border-bottom:1px solid #F2F4F7;font-size:13px;font-weight:600;line-height:1.5}
.adv:last-child{border-bottom:none}.adv .ic{flex-shrink:0;font-size:16px}
.adv.bad{color:#9B1C10}.adv.warn{color:#7a5600}.adv.good{color:#1E7B3C}
.aibtn{background:#101B30;color:#fff;border:none;border-radius:12px;padding:13px 20px;font-weight:800;cursor:pointer;font-size:14px;margin-top:4px}
.aibtn:disabled{opacity:.6}
.aibox{white-space:pre-wrap;background:#0B1226;color:#E7ECF6;border-radius:14px;padding:16px 18px;margin-top:12px;font-size:13px;line-height:1.65;font-weight:500;display:none}
.aibox.show{display:block}
.vnote{background:#FFF7E0;border:1px solid #F3D27A;border-radius:14px;padding:13px 16px;font-size:13px;font-weight:500;color:#5E6675;line-height:1.6;margin-bottom:16px}
.vnote b{color:#7a5600}
/* Two zones, unmistakably different: what's REAL vs. what's SIMULATED —
 * the single biggest source of confusion before this reorg. */
.zone{margin-top:32px;padding-top:24px;border-top:1px solid rgba(16,27,48,.07)}
.zone:first-of-type{margin-top:22px;padding-top:0;border-top:none}
.zonehd{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px}
.zonehd h2{font-size:18px;font-weight:800;letter-spacing:-0.02em}
.zonetag{font-size:10px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;padding:4px 10px;border-radius:99px;white-space:nowrap}
.zonetag.real{background:#E7F7ED;color:#10803C}
.zonetag.sim{background:#F0EAFB;color:#6B3FA0}
.zonesub{color:#5E6675;font-weight:500;font-size:13px;margin:2px 0 18px;line-height:1.6;max-width:680px}
.grouplbl{font-size:10.5px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:#9097A3;margin:16px 0 8px}
.grouplbl:first-child{margin-top:0}
</style></head><body>
<div class="appheader">
  <img src="/brand-logo.png" alt=""><b>ALTO <em>PRO</em> · ${tr("Centro de mando", "Command center")}</b>
  <div class="right"><a href="/admin">← Admin</a><a href="/admin/economics?lang=${en ? "es" : "en"}">${en ? "🇲🇽 Español" : "🇺🇸 English"}</a><a class="dark" href="/admin?logout">${tr("salir", "log out")}</a></div>
</div>
<div class="wrap">
<h1>${tr("Centro de mando del negocio", "Business command center")}</h1>
<p class="sub">${tr("Dos partes: lo que ya pasó (real, de tu sistema) y lo que podría pasar (tu simulador de crecimiento).", "Two parts: what already happened (real, from your system) and what could happen (your growth simulator).")}</p>

<div class="zone">
  <div class="zonehd"><h2>📡 ${tr("Tu negocio hoy", "Your business today")}</h2><span class="zonetag real">${tr("real", "real")}</span></div>
  <p class="zonesub">${tr("Números de tu sistema — nada que ajustar aquí, así están las cosas ahora mismo.", "Numbers straight from your system — nothing to tune here, this is where things actually stand.")}</p>

  <div class="grouplbl">💰 ${tr("Ingresos", "Revenue")}</div>
  <div class="cards">
    <div class="card gold"><div class="v" id="o_mrr">$0</div><div class="l">MRR</div><div class="s">${live.paying} ${tr("pagando", "paying")}</div></div>
  </div>

  <div class="grouplbl">🤝 ${tr("Ventas", "Sales")}</div>
  <div class="cards">
    <div class="card ${live.realClose == null ? "" : live.realClose < 25 ? "bad" : live.realClose < 35 ? "warnc" : "good"}"><div class="v">${live.realClose == null ? "—" : live.realClose + "%"}</div><div class="l">${tr("Tasa de cierre real", "Real close rate")}</div><div class="s">${live.closed}/${live.meetings} ${tr("reuniones", "meetings")}</div></div>
    <div class="card"><div class="v">${live.meetingsMonth}</div><div class="l">${tr("Reuniones este mes", "Meetings this month")}</div></div>
  </div>

  <div class="grouplbl">💳 ${tr("Salud de cobro", "Billing health")}</div>
  <div class="cards">
    <div class="card ${live.failed ? "bad" : ""}"><div class="v">${live.failed}</div><div class="l">${tr("Pago fallido", "Failed payments")}</div></div>
    <div class="card ${live.canceled ? "warnc" : ""}"><div class="v">${live.canceled}</div><div class="l">${tr("Cancelados", "Canceled")}</div></div>
    <div class="card"><div class="v">${live.pending}</div><div class="l">${tr("Esperando pago", "Awaiting payment")}</div></div>
  </div>

  <div class="grouplbl">🧮 ${tr("Costo real de adquisición — este mes", "Real acquisition cost — this month")}</div>
  <div class="panel">
    <p class="sub" style="margin:0 0 14px">${tr("Escribe lo que gastaste en anuncios este mes — el costo por lead y por reunión salen de tus números reales, no de una suposición.", "Type what you actually spent on ads this month — cost per lead and per meeting come from your real numbers, not a guess.")}</p>
    <div class="fld"><label>${tr("Inversión en anuncios — este mes", "Ad spend — this month")}</label><div class="row"><input type="range" id="r_qspend" min="0" max="10000" step="50"><div class="val"><span class="pre">$</span><input id="i_qspend"></div></div></div>
    <div class="cards" style="margin-top:16px">
      <div class="card"><div class="v">${live.leadsMonth}</div><div class="l">${tr("Leads este mes", "Leads this month")}</div></div>
      <div class="card gold"><div class="v" id="q_cpl">—</div><div class="l">${tr("Costo por lead", "Cost per lead")}</div></div>
      <div class="card"><div class="v">${live.meetingsMonth}</div><div class="l">${tr("Reuniones este mes", "Meetings this month")}</div></div>
      <div class="card gold"><div class="v" id="q_cpm">—</div><div class="l">${tr("Costo por reunión", "Cost per meeting")}</div></div>
      <div class="card"><div class="v">${live.closedMonth}</div><div class="l">${tr("Cerrados este mes", "Closed this month")}</div></div>
      <div class="card ${live.closeRateMonth >= 35 ? "good" : live.closeRateMonth >= 20 ? "warnc" : live.closeRateMonth ? "bad" : ""}"><div class="v">${live.closeRateMonth}%</div><div class="l">${tr("Tasa de cierre este mes", "Close rate this month")}</div></div>
    </div>
  </div>
</div>

<div class="zone">
  <div class="zonehd"><h2>🔮 ${tr("Simulador de crecimiento", "Growth simulator")}</h2><span class="zonetag sim">${tr("hipotético", "hypothetical")}</span></div>
  <p class="zonesub">${tr("Nada de esto es real todavía — mueve los números y mira qué necesitarías para llegar ahí. El consejero al final te dice qué hacer con esto.", "None of this has happened yet — move the numbers and see what it would take to get there. The advisor at the bottom tells you what to do with it.")}</p>

  <div class="grid">
    <div>
      <div class="panel">
        <h3>💸 ${tr("Costos fijos / mes", "Fixed costs / month")}</h3>
        <div id="fxlist"></div>
        <button class="fxadd" onclick="fxAdd()">+ ${tr("Agregar costo", "Add cost")}</button>
        <div class="fxtot"><span>${tr("Total fijo / mes", "Total fixed / month")}</span><span id="fxtot">$0</span></div>
      </div>
      <div class="panel" style="margin-top:16px">
        <h3>🚀 ${tr("Ajusta tu plan", "Adjust your plan")}</h3>
        <div class="fld"><label>${tr("Inversión en anuncios / mes", "Ad spend / month")}</label><div class="row"><input type="range" id="r_spend" min="100" max="10000" step="100"><div class="val"><span class="pre">$</span><input id="i_spend"></div></div></div>
        <div class="fld"><label>${tr("Costo por lead (anuncio)", "Cost per lead (ads)")}</label><div class="row"><input type="range" id="r_lead" min="1" max="40" step="1"><div class="val"><span class="pre">$</span><input id="i_lead"></div></div></div>
        <div class="fld"><label>${tr("Lead → reunión", "Lead → meeting")}</label><div class="row"><input type="range" id="r_book" min="2" max="80" step="1"><div class="val"><input id="i_book"><span style="color:#9097A3;font-weight:700">%</span></div></div></div>
        <div class="fld"><label>${tr("Reunión → cierre", "Meeting → close")} <span id="closehint" style="color:#1E7B3C;font-weight:700"></span></label><div class="row"><input type="range" id="r_close" min="5" max="90" step="1"><div class="val"><input id="i_close"><span style="color:#9097A3;font-weight:700">%</span></div></div></div>
        <div class="fld"><label>${tr("Precio mensual", "Monthly price")}</label><div class="row"><input type="range" id="r_price" min="99" max="699" step="10"><div class="val"><span class="pre">$</span><input id="i_price"></div></div></div>
        <div class="fld"><label>${tr("Costo de servir / cliente (APIs, Stripe)", "Cost to serve / client (APIs, Stripe)")}</label><div class="row"><input type="range" id="r_serve" min="10" max="120" step="5"><div class="val"><span class="pre">$</span><input id="i_serve"></div></div></div>
        <div class="fld"><label>${tr("Comisión del closer (por venta)", "Closer commission (per sale)")}</label><div class="row"><input type="range" id="r_comm" min="0" max="400" step="10"><div class="val"><span class="pre">$</span><input id="i_comm"></div></div></div>
        <div class="fld"><label>${tr("Meses que se queda el cliente", "Months a client stays")}</label><div class="row"><input type="range" id="r_life" min="1" max="36" step="1"><div class="val"><input id="i_life"><span style="color:#9097A3;font-weight:700">${tr("mes", "mo")}</span></div></div></div>
      </div>
    </div>
    <div>
      <div class="sect" style="margin-top:0">📉 ${tr("Resultado proyectado — si gastas esto en anuncios", "Projected result — if you spend this on ads")}</div>
      <div class="cards" style="margin-bottom:12px">
        <div class="card"><div class="v" id="o_leads">0</div><div class="l">${tr("Leads / mes", "Leads / month")}</div><div class="s" id="o_leadss"></div></div>
        <div class="card"><div class="v" id="o_meet">0</div><div class="l">${tr("Reuniones / mes", "Meetings / month")}</div><div class="s" id="o_meets"></div></div>
        <div class="card"><div class="v" id="o_close">0</div><div class="l">${tr("Ventas / mes", "Sales / month")}</div><div class="s" id="o_closes"></div></div>
        <div class="card gold"><div class="v" id="o_nmrr">$0</div><div class="l">${tr("Nuevo MRR / mes", "New MRR / month")}</div><div class="s" id="o_nmrrs"></div></div>
        <div class="card good"><div class="v" id="o_coh">$0</div><div class="l">${tr("Valor total (su vida)", "Total value (lifetime)")}</div></div>
        <div class="card"><div class="v" id="o_ratio">0x</div><div class="l">${tr("Retorno (LTV:CAC)", "Return (LTV:CAC)")}</div><div class="s" id="o_ratiomsg"></div></div>
      </div>
      <div class="vnote" id="verdict"></div>
      <div class="panel">
        <h3>🧭 ${tr("El consejero — qué hacer", "The advisor — what to do")}</h3>
        <div id="advice"></div>
        <button class="aibtn" id="aibtn" onclick="genPlan()">🧠 ${tr("Generar mi plan con IA", "Generate my plan with AI")}</button>
        <div class="aibox" id="aibox"></div>
      </div>
    </div>
  </div>
</div>
</div>
<script>
var EN=${en ? "true" : "false"};
var LIVE=${JSON.stringify(live)};
function mm(es,eng){return EN?eng:es;}
function money(n){return "$"+Math.round(n).toLocaleString("en-US");}
// inputs
var F=[["spend",1000],["price",297],["serve",25],["comm",100],["lead",8],["book",20],["close",${live.realClose != null ? live.realClose : 33}],["life",12]];
var S={};try{S=JSON.parse(localStorage.getItem("alto_cockpit")||"{}")||{}}catch(e){S={}}
F.forEach(function(f){if(S[f[0]]==null)S[f[0]]=f[1];});
// fixed costs
var FX=[];try{FX=JSON.parse(localStorage.getItem("alto_fixed")||"null")}catch(e){FX=null}
if(!FX)FX=EN?[{n:"Hosting (Render)",a:25},{n:"Database (Supabase)",a:25},{n:"HighLevel",a:97},{n:"Domain",a:1},{n:"Your salary",a:0}]:[{n:"Hosting (Render)",a:25},{n:"Base de datos (Supabase)",a:25},{n:"HighLevel",a:97},{n:"Dominio",a:1},{n:"Tu sueldo",a:0}];
function fxRender(){var h="";FX.forEach(function(x,i){h+='<div class="fx"><input class="n" value="'+(x.n||"").replace(/"/g,"&quot;")+'" oninput="fxSet('+i+',\\'n\\',this.value)"><input class="a" type="number" value="'+(x.a||0)+'" oninput="fxSet('+i+',\\'a\\',this.value)"><button onclick="fxDel('+i+')">×</button></div>';});document.getElementById("fxlist").innerHTML=h;}
function fxSet(i,k,v){FX[i][k]=k==="a"?(parseFloat(v)||0):v;fxSave();calc();}
function fxDel(i){FX.splice(i,1);fxSave();fxRender();calc();}
function fxAdd(){FX.push({n:"",a:0});fxSave();fxRender();}
function fxSave(){try{localStorage.setItem("alto_fixed",JSON.stringify(FX))}catch(e){}}
function fxTotal(){return FX.reduce(function(a,x){return a+(parseFloat(x.a)||0);},0);}
function clampNum(v,k){v=parseFloat(v);if(isNaN(v))v=0;if(k==="book"||k==="close")v=Math.max(1,Math.min(99,v));if(k==="life")v=Math.max(1,Math.min(60,v));if(v<0)v=0;return v;}
function bind(k){var r=document.getElementById("r_"+k),i=document.getElementById("i_"+k);r.value=S[k];i.value=S[k];
  r.addEventListener("input",function(){S[k]=clampNum(r.value,k);i.value=S[k];calc();});
  i.addEventListener("input",function(){S[k]=clampNum(i.value,k);r.value=S[k];calc();});}
var LASTM={};
function calc(){
  var spend=S.spend,cpl=S.lead,l2m=S.book/100,m2c=S.close/100,price=S.price,comm=S.comm,serve=S.serve,life=S.life;
  var leads=cpl>0?spend/cpl:0;
  var meetings=leads*l2m;
  var costPerMeeting=meetings>0?spend/meetings:0;
  var closes=meetings*m2c;
  var cac=closes>0?(spend/closes+comm):0;
  var contrib=price-serve, ltvClient=contrib*life;
  var newMRR=closes*price, cohort=closes*ltvClient;
  var ratio=cac>0?ltvClient/cac:0, payback=contrib>0?cac/contrib:99;
  var fixed=fxTotal(), beClients=contrib>0?Math.ceil(fixed/contrib):0;
  var mrrNow=LIVE.paying*price, coProfit=mrrNow-fixed-(LIVE.paying*serve);
  document.getElementById("o_mrr").textContent=money(mrrNow);
  document.getElementById("fxtot").textContent=money(fixed);
  document.getElementById("o_leads").textContent=Math.round(leads);
  document.getElementById("o_leadss").textContent=money(cpl)+"/lead";
  document.getElementById("o_meet").textContent=Math.round(meetings);
  document.getElementById("o_meets").textContent=mm("c/reunión ","/meeting ")+money(costPerMeeting);
  document.getElementById("o_close").textContent=(Math.round(closes*10)/10);
  document.getElementById("o_closes").textContent="CAC "+money(cac);
  document.getElementById("o_nmrr").textContent=money(newMRR);
  document.getElementById("o_nmrrs").textContent="≈"+money(newMRR*12)+mm("/año","/yr");
  document.getElementById("o_coh").textContent=money(cohort);
  document.getElementById("o_ratio").textContent=(ratio?ratio.toFixed(1):"0")+"x";
  document.getElementById("o_ratiomsg").textContent=ratio>=3?mm("sano","healthy"):ratio>0?mm("flojo","weak"):"";
  var ch=document.getElementById("closehint");ch.textContent=LIVE.realClose!=null?"(real: "+LIVE.realClose+"%)":"";
  document.getElementById("verdict").innerHTML=mm(
    "Con <b>"+money(spend)+"/mes</b> en anuncios: ~<b>"+Math.round(leads)+" leads</b> → <b>"+Math.round(meetings)+" reuniones</b> (a "+money(costPerMeeting)+" c/u) → <b>"+(Math.round(closes*10)/10)+" ventas</b>. Eso suma <b>"+money(newMRR)+" de MRR nuevo CADA mes</b> ("+money(cohort)+" en toda su vida). Cada cliente te cuesta <b>"+money(cac)+"</b> y vale <b>"+money(ltvClient)+"</b>.",
    "With <b>"+money(spend)+"/mo</b> in ads: ~<b>"+Math.round(leads)+" leads</b> → <b>"+Math.round(meetings)+" meetings</b> (at "+money(costPerMeeting)+" each) → <b>"+(Math.round(closes*10)/10)+" sales</b>. That adds <b>"+money(newMRR)+" new MRR EVERY month</b> ("+money(cohort)+" lifetime). Each client costs <b>"+money(cac)+"</b> and is worth <b>"+money(ltvClient)+"</b>.");
  LASTM={adSpendMonth:spend,costPerLead:cpl,leadsPerMonth:Math.round(leads),leadToMeetingPct:S.book,meetingsPerMonth:Math.round(meetings),costPerMeeting:Math.round(costPerMeeting),meetingToClosePct:S.close,realCloseRate:LIVE.realClose,salesPerMonth:+closes.toFixed(1),CAC:Math.round(cac),price:price,newMRRPerMonth:Math.round(newMRR),ltvPerClient:Math.round(ltvClient),cohortLifetimeValue:Math.round(cohort),ltvCacRatio:+ratio.toFixed(1),retentionMonths:life,fixedCostsMonth:Math.round(fixed),clientsToCoverFixed:beClients,currentMRR:Math.round(mrrNow),payingClients:LIVE.paying,failedPayments:LIVE.failed,canceled:LIVE.canceled};
  advise(cac,ltvClient,ratio,payback,(ltvClient-cac),fixed,beClients,coProfit);
  try{localStorage.setItem("alto_cockpit",JSON.stringify(S))}catch(e){}
}
function advise(cac,ltv,ratio,payback,profit,fixed,beClients,coProfit){
  var A=[];var cr=LIVE.realClose!=null?LIVE.realClose:S.close;
  if(cr<20)A.push(["bad","🛑",mm("Cierre muy bajo ("+cr+"%). El problema NO son los leads — es el cierre. Entrena o cambia al closer ANTES de gastar más en anuncios.","Close rate very low ("+cr+"%). The problem is NOT leads — it's closing. Coach or replace the closer BEFORE spending more on ads.")]);
  else if(cr<35)A.push(["warn","⚠️",mm("Cierre mejorable ("+cr+"%). Subir el cierre baja tu CAC más que cualquier otra palanca — trabaja guion y objeciones.","Close rate improvable ("+cr+"%). Lifting close rate cuts CAC more than any other lever — work the script and objections.")]);
  else A.push(["good","✅",mm("Cierre fuerte ("+cr+"%). Tus closers convierten.","Strong close rate ("+cr+"%). Your closers convert.")]);
  if(profit<=0)A.push(["bad","🛑",mm("Pierdes dinero por cliente con estos números — sube precio, baja costo por lead, o mejora cierre/retención.","You lose money per client with these numbers — raise price, lower cost per lead, or improve close/retention.")]);
  else if(ratio>=3&&payback<3&&cr>=30)A.push(["good","🚀",mm("Tus números aguantan crecer (retorno "+ratio.toFixed(1)+"x, recuperas en "+payback.toFixed(1)+" meses). Sube el presupuesto de anuncios.","Your numbers support scaling (return "+ratio.toFixed(1)+"x, payback "+payback.toFixed(1)+"mo). Increase ad spend.")]);
  else if(ratio<3)A.push(["warn","⚠️",mm("Retorno flojo ("+ratio.toFixed(1)+"x). Antes de escalar: sube precio, baja costo por lead, o mejora cierre/retención.","Weak return ("+ratio.toFixed(1)+"x). Before scaling: raise price, lower cost per lead, or improve close/retention.")]);
  if(LIVE.canceled>0&&LIVE.clients>0&&(LIVE.canceled/LIVE.clients)>0.1)A.push(["warn","🔁",mm("Cancelaciones altas ("+LIVE.canceled+"). Arregla retención — estás llenando una cubeta con hoyos.","High churn ("+LIVE.canceled+"). Fix retention — you're filling a leaky bucket.")]);
  if(LIVE.failed>0)A.push(["warn","💳",mm(LIVE.failed+" cliente(s) con pago fallido. Que servicio les recuerde HOY actualizar su tarjeta.","Cancel "+LIVE.failed+" client(s) with failed payments. Have CS remind them TODAY to update their card.")]);
  A.push([coProfit>=0?"good":"warn",coProfit>=0?"💰":"📉",LIVE.paying>=beClients?mm("Ya cubres tus costos fijos ("+LIVE.paying+" de "+beClients+" clientes). Lo demás es ganancia.","You cover your fixed costs ("+LIVE.paying+" of "+beClients+" clients). The rest is profit."):mm("Aún no cubres lo fijo: necesitas "+beClients+" clientes pagando y tienes "+LIVE.paying+".","Not covering fixed costs yet: you need "+beClients+" paying clients and have "+LIVE.paying+".")]);
  document.getElementById("advice").innerHTML=A.map(function(x){return '<div class="adv '+x[0]+'"><span class="ic">'+x[1]+'</span><span>'+x[2]+'</span></div>';}).join("");
}
function genPlan(){var b=document.getElementById("aibtn"),box=document.getElementById("aibox");b.disabled=true;b.textContent=mm("🧠 Pensando…","🧠 Thinking…");
  fetch("/api/admin/ceo",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({lang:EN?"en":"es",metrics:LASTM})}).then(function(r){return r.json()}).then(function(j){
    b.disabled=false;b.textContent=mm("🧠 Generar mi plan con IA","🧠 Generate my plan with AI");
    if(j&&j.ok){box.textContent=j.text;box.classList.add("show");}
    else{box.textContent=mm("La IA no está activa (falta API key).","AI is not active (missing API key).");box.classList.add("show");}
  }).catch(function(){b.disabled=false;b.textContent=mm("🧠 Generar mi plan con IA","🧠 Generate my plan with AI");box.textContent=mm("No se pudo — intenta de nuevo.","Couldn't generate — try again.");box.classList.add("show");});}
fxRender();F.forEach(function(f){bind(f[0]);});calc();
// Quick calculator — real leads/meetings this month ÷ what you actually
// spent, not an assumed cost-per-lead like the projection tool above.
var QSPEND=0;try{QSPEND=parseFloat(localStorage.getItem("alto_qspend"))||0}catch(e){QSPEND=0}
function qcalc(){
  var leads=${live.leadsMonth},meetings=${live.meetingsMonth};
  document.getElementById("q_cpl").textContent=leads>0?money(QSPEND/leads):"—";
  document.getElementById("q_cpm").textContent=meetings>0?money(QSPEND/meetings):"—";
  try{localStorage.setItem("alto_qspend",String(QSPEND))}catch(e){}
}
(function(){
  var r=document.getElementById("r_qspend"),i=document.getElementById("i_qspend");
  r.value=QSPEND;i.value=QSPEND;
  r.addEventListener("input",function(){QSPEND=parseFloat(r.value)||0;i.value=QSPEND;qcalc();});
  i.addEventListener("input",function(){QSPEND=parseFloat(i.value)||0;r.value=QSPEND;qcalc();});
  qcalc();
})();
</script>
</body></html>`);
});

app.get("/admin/c/:slug", async (req, res) => {
  if (!ADMIN_KEY) return res.status(503).send("Set ADMIN_KEY env var.");
  if (!adminOk(req)) return res.status(401).send(loginPage("Admin", "/admin", false));
  const c = await db.getContractorBySlug(String(req.params.slug));
  if (!c) return res.status(404).send("Cliente no encontrado. <a href='/admin'>← Volver</a>");
  const KEY = encodeURIComponent(ADMIN_KEY);
  const esc = (x) => String(x || "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  const d = c.data || {}, p = d.profile || {}, st = d.site || {};
  const leads = await db.listLeads(c.id).catch(() => []);
  const devCount = (await db.sessionCounts().catch(() => ({})))[String(c.id)] || 0;
  const pushSubs0 = await db.kvGet(`push:${c.id}`).catch(() => null); const pushSubs = Array.isArray(pushSubs0) ? pushSubs0 : [];
  const ago = (x) => { if (!x) return "—"; const h = (Date.now() - new Date(x).getTime()) / 36e5; return h < 1 ? "hace minutos" : h < 24 ? `hace ${Math.round(h)}h` : `hace ${Math.round(h / 24)}d`; };
  const prettyPhone = (x) => { const z = String(x || "").replace(/\D/g, "").replace(/^1/, ""); if (z.length === 10) return `(${z.slice(0, 3)}) ${z.slice(3, 6)}-${z.slice(6)}`; const raw = String(x || ""); return raw ? raw.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])).slice(0, 40) : "—"; };
  const isPaused = d.status === "paused";
  const pay = d.payStatus || "—";
  const payColor = pay === "ok" ? "#1E7B3C" : pay === "failed" ? "#C5221F" : pay === "pending" ? "#9A6E00" : "#8A94A8";
  const payLabel = { ok: "✓ pagando", failed: "💳 pago falló", pending: "⏳ pendiente de pago", canceled: "canceló" }[pay] || "sin estado";
  const payments = Array.isArray(d.payments) ? d.payments : [];
  const training = d.training || {};
  // Widget-plan embed code: the exact snippet the client (or their web
  // developer) pastes once into their existing site. Canonical www URL in
  // production so it keeps working no matter which host admin is opened on.
  const host = String(req.get("host") || "").split(":")[0];
  const wBase = /(^|\.)alto-pro\.com$/.test(host) ? "https://www.alto-pro.com" : `${req.protocol}://${req.get("host")}`;
  const embedCode = `<iframe src="${wBase}/w/${c.slug}" style="width:100%;max-width:430px;height:560px;border:0;border-radius:18px" loading="lazy" title="Cotizador de techos"></iframe>`;
  const waEmbed = encodeURIComponent(`Hola 👋 Este es el código del cotizador de techos para la página de ${c.name}. Se pega UNA sola vez, donde quieran que aparezca el cotizador:\n\n${embedCode}\n\nFunciona en WordPress, Wix, GoDaddy — cualquier página. ¿Dudas? Respondan aquí y les ayudamos. — Equipo ALTO Pro`);
  res.send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(c.name)} · ALTO Pro Admin</title><link rel="icon" href="/icon-192.png"><style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
*{box-sizing:border-box;margin:0;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","SF Pro Display",Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
body{background:#F5F6F8;color:#0B1220;letter-spacing:-0.011em}
::selection{background:rgba(248,180,8,.35)}
header{position:sticky;top:0;z-index:30;background:rgba(16,27,48,.9);backdrop-filter:saturate(180%) blur(20px);-webkit-backdrop-filter:saturate(180%) blur(20px);color:#fff;padding:15px 24px;display:flex;align-items:center;gap:13px;border-bottom:1px solid rgba(255,255,255,.07)}
header img{height:30px;background:#fff;border-radius:9px;padding:4px 6px}
header a{color:#cdd5e5;text-decoration:none;font-weight:600;font-size:13px}
.wrap{max-width:940px;margin:0 auto;padding:26px 22px 64px}
h1{font-size:28px;font-weight:700;letter-spacing:-0.03em}.slug{color:#9097A3;font-weight:600;font-size:14px;margin-top:2px}
.badges{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0 4px}
.pill{border-radius:99px;padding:5px 13px;font-size:12px;font-weight:700;white-space:nowrap}
.panel{background:#fff;border:1px solid rgba(16,27,48,.05);border-radius:22px;padding:22px 24px;margin-top:18px;box-shadow:0 1px 2px rgba(16,27,48,.04),0 12px 30px rgba(16,27,48,.05)}
.panel h2{font-size:12px;color:#9097A3;letter-spacing:.6px;text-transform:uppercase;font-weight:700;margin-bottom:14px}
.kv{display:flex;justify-content:space-between;align-items:center;padding:11px 0;border-bottom:1px solid #F2F4F7;font-weight:600;font-size:14.5px}
.kv:last-child{border-bottom:none}
.kv span:first-child{color:#67718A}
.kv a{color:#B07A00;font-weight:700;text-decoration:none}
.acts{display:flex;flex-wrap:wrap;gap:10px}
.acts a,.acts button{display:inline-flex;align-items:center;text-decoration:none;border:none;border-radius:13px;padding:12px 18px;font-weight:700;font-size:13.5px;cursor:pointer;font-family:inherit;transition:transform .12s,filter .15s}
.acts a:hover,.acts button:hover{filter:brightness(1.02);transform:translateY(-1px)}
.acts a:active,.acts button:active{transform:scale(.97)}
.b-dark{background:#101B30;color:#fff;box-shadow:0 6px 16px rgba(16,27,48,.2)}
.b-gold{background:#F8B408;color:#101B30;box-shadow:0 6px 16px rgba(248,180,8,.3)}
.b-line{background:#fff;border:1px solid #E4E7EC;color:#101B30;box-shadow:0 1px 2px rgba(16,27,48,.04)}
.b-red{background:#FDECEC;color:#C5221F}
table{width:100%;border-collapse:collapse;font-size:13.5px}
th{text-align:left;color:#9097A3;font-size:10.5px;letter-spacing:.7px;text-transform:uppercase;font-weight:700;padding:10px;border-bottom:1px solid #EEF0F4}
td{padding:13px 10px;border-bottom:1px solid #F2F4F7;font-weight:600;color:#1B2433}
.sw{width:18px;height:18px;border-radius:6px;display:inline-block;vertical-align:middle;border:1px solid rgba(0,0,0,.1)}
</style></head><body>
<header><img src="/brand-logo.png" alt=""><a href="/admin">← Tablero</a></header>
<div class="wrap">
<h1>${esc(c.name)}</h1><div class="slug">/${c.slug}</div>
<div class="badges">
  <span class="pill" style="background:${isPaused ? "#FDECEC" : "#EAF8EF"};color:${isPaused ? "#C5221F" : "#1E7B3C"}">${isPaused ? "⏸ pausado" : "● activo"}</span>
  <span class="pill" style="background:#FEF3D6;color:#946400">📦 ${PLANS[planOf(c)].name} · $${PLANS[planOf(c)].price}/mes</span>
  <span class="pill" style="background:#F0F2F6;color:${payColor}">${payLabel}</span>
  ${d.trade === "fence" ? '<span class="pill" style="background:#E8F4EA;color:#1E6B33">🪵 Cercas</span>' : ""}
  <span class="pill" style="background:#F0F2F6;color:${st.published ? "#1E7B3C" : "#9A6E00"}">${st.published ? "🌐 página publicada" : "🏗️ en construcción"}</span>
</div>

<div class="panel"><h2>Acciones</h2><div class="acts">
  ${isPaused
    ? `<button class="b-gold" onclick="act('/api/admin/status?id=${c.id}&status=active','¿Reactivar?')">▶ Reactivar</button>`
    : `<button class="b-red" onclick="act('/api/admin/status?id=${c.id}&status=paused','¿Pausar? Su sitio y cotizador dejan de recibir leads.')">⏸ Pausar</button>`}
  ${!isPaused && pay === "pending"
    ? `<button class="b-gold" onclick="act('/api/admin/status?id=${c.id}&status=active','¿Marcar como pagado? Úsalo solo si pagó por efectivo, Zelle u otro medio fuera de Stripe — su link de acceso se activa al instante.')">💵 Marcar como pagado</button>`
    : ""}
  <button class="b-dark" onclick="pub(${st.published ? "false" : "true"})">${st.published ? "Ocultar página" : "🚀 Publicar página"}</button>
  <a class="b-line" href="/onboarding?slug=${c.slug}">🎨 Onboarding</a>
  <a class="b-line" href="/api/admin/invite?id=${c.id}">🔑 Link de acceso</a>
  <button class="b-line" style="color:#8A6D00;border-color:#F4DE9A" onclick="if(confirm('¿Revocar TODOS sus accesos? Se cierra la sesión en todos sus dispositivos y sus links viejos dejan de funcionar. Sus datos NO se tocan — al confirmar te damos su link nuevo para reenviárselo.'))location.href='/api/admin/revoke?id=${c.id}'">🔄 Revocar accesos</button>
  <button class="b-line" onclick="hook()">🤖 GHL ${d.webhook ? "(conectado)" : ""}</button>
  <button class="b-line" style="color:#C5221F;border-color:#F5C6C0" onclick="delc()">🗑️ Eliminar</button>
  <button class="b-line" onclick="act('/api/admin/tkbeta?id=${c.id}&on=${d.tkBeta ? 0 : 1}','${d.tkBeta ? "¿Quitar el takeoff beta a este cliente?" : "¿Activar el takeoff beta para este cliente? Solo si ya validaste que sus techos salen bien."}')">📐 Takeoff beta ${d.tkBeta ? "(ON)" : "(off)"}</button>
  <select class="b-line" style="font-family:inherit;font-size:13.5px;font-weight:700;cursor:pointer" onchange="if(this.value&&confirm('¿Cambiar su plan a '+this.options[this.selectedIndex].text+'? (Normalmente lo pone solo el pago de Stripe)')){fetch('/api/admin/plan?id=${c.id}&plan='+this.value).then(function(){location.reload()})}else{this.value=''}">
    <option value="">📦 Cambiar plan…</option>
    <option value="pro">PRO · $67/mes</option>
    <option value="widget">WIDGET · $197/mes</option>
    <option value="complete">COMPLETO · $297/mes</option>
  </select>
</div></div>

<div class="panel"><h2>Enlaces</h2>
  <div class="kv"><span>Widget</span><a href="/w/${c.slug}" target="_blank">/w/${c.slug}</a></div>
  <div class="kv"><span>Página (pública)</span><a href="/site/${c.slug}" target="_blank">/site/${c.slug}</a></div>
  <div class="kv"><span>Borrador (preview)</span><a href="/site/${c.slug}?preview=1" target="_blank">ver borrador</a></div>
  <div class="kv"><span>Subdominio</span><span>${c.slug}.alto-pro.com</span></div>
  ${st.domain ? `<div class="kv"><span>Dominio propio</span><a href="https://${esc(st.domain)}" target="_blank">${esc(st.domain)}</a></div>` : ""}
</div>

<div class="panel"><h2>🧩 Código del widget — para pegar en su página</h2>
  <p style="color:#67718A;font-weight:600;font-size:12.5px;margin:0 0 10px;line-height:1.5">Plan Widget ($197): cópialo y mándaselo al cliente o a su web developer. Se pega <b>una sola vez</b> donde quieran el cotizador — WordPress, Wix, GoDaddy, donde sea — y los leads le llegan solos a su app.</p>
  <pre style="background:#0F1830;color:#D7E3FF;border-radius:12px;padding:14px 16px;font:600 12px/1.6 ui-monospace,Menlo,Consolas,monospace;overflow-x:auto;white-space:pre-wrap;word-break:break-all;margin:0 0 12px">${esc(embedCode)}</pre>
  <div class="acts">
    <button class="b-gold" onclick="cpEmbed(this)">📋 Copiar código</button>
    <a class="b-line" href="https://wa.me/?text=${waEmbed}" target="_blank">💬 Mandarlo por WhatsApp</a>
    <a class="b-line" href="/w/${c.slug}" target="_blank">🛰️ Probar el widget</a>
  </div>
</div>

<div class="panel"><h2>Negocio y sitio</h2>
  <div class="kv"><span>Teléfono</span><span>${prettyPhone(p.phone || c.phone)}</span></div>
  <div class="kv"><span>Ciudad</span><span>${esc(st.city) || "—"}</span></div>
  <div class="kv"><span>Plantilla</span><span>${st.template || "1"}</span></div>
  <div class="kv"><span>Color</span><span><span class="sw" style="background:${/^#[0-9a-fA-F]{6}$/.test(st.color || "") ? st.color : "#B30F24"}"></span> ${esc(st.color) || "—"}</span></div>
  <div class="kv"><span>Creado</span><span>${(() => { const d = new Date(c.created_at || ""); return isNaN(d) ? "—" : d.toISOString().slice(0, 10); })()}</span></div>
  <div class="kv"><span>Dispositivos / aperturas</span><span>${devCount > 5 ? `<b style="color:#C5221F">📱 ${devCount}</b> — posible link compartido; ofrécele cuentas para su equipo o revoca accesos abajo` : (devCount || "—")}</span></div>
</div>

<div class="panel"><h2>💳 Pagos</h2>
  <div class="kv"><span>Cobro mensual</span><span>${pay === "ok" ? `$${PLANS[planOf(c)].price}/mes · ${PLANS[planOf(c)].name}` : "—"}</span></div>
  <div class="kv"><span>Total cobrado</span><span>$${payments.reduce((s, p) => s + (Number(p.amount) || 0), 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</span></div>
  <div style="overflow-x:auto"><table>
  <tr><th>Fecha</th><th>Monto</th><th></th></tr>
  ${payments.length ? payments.slice().reverse().map((p) => `<tr><td>${String(p.at || "").slice(0, 10) || "—"}</td><td>$${Number(p.amount || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</td><td>${p.url ? `<a href="${esc(p.url)}" target="_blank">Ver recibo →</a>` : ""}</td></tr>`).join("") : `<tr><td colspan="3" style="color:#8A94A8">Sin pagos registrados todavía.</td></tr>`}
  </table></div>
</div>

<div class="panel"><h2>🤖 Bot del sitio</h2>
  <p style="color:#67718A;font-weight:600;font-size:12.5px;margin:0 0 8px;line-height:1.5">Lo que el bot puede afirmar de este negocio. <b>Solo lectura</b> — se entrena en el onboarding (Paso 6 · Su bot) o en Servicio al cliente → 🤖 Entrenamiento del bot, para que haya una sola fuente de verdad.</p>
  <div style="background:#F7F9FC;border:1px solid #EDF0F5;border-radius:12px;padding:12px 14px;font:600 13px/1.7 Inter,Arial,sans-serif;color:#3A4250;white-space:pre-wrap;word-break:break-word">${esc(st.botFacts || "— sin entrenar todavía —")}</div>
  <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;align-items:center">
    <a class="b-gold" href="/onboarding?slug=${c.slug}&step=5&field=botaddr">🤖 Entrenar (onboarding · Paso 6)</a>
    <a class="b-line" href="/cs" target="_blank">🎓 Entrenamiento completo (/cs)</a>
    <a class="b-line" href="/site/${c.slug}?preview=1&chat=open" target="_blank">💬 Probar el chat</a>
  </div>
  <p style="color:#9AA3B2;font-weight:600;font-size:11.5px;margin:8px 0 0;line-height:1.5">🧪 Pruebas de guardrails en el chat: pide un <b>precio exacto</b> (debe mandarte al cotizador), pide una <b>cita "mañana a las 10"</b> (no debe prometer horarios), pregunta la <b>dirección</b> (solo la dice si está entrenada), y deja un <b>teléfono</b> (debe confirmar que ya avisó al equipo — y el lead debe aparecer en la app).</p>
</div>

<div class="panel"><h2>App del contratista</h2>
  <div class="kv"><span>Abrió la app por última vez</span><span>${d.lastSeen ? ago(d.lastSeen) : "— nunca"}</span></div>
  <div class="kv"><span>Instaló la app en su teléfono</span><span>${d.installed ? "✅ Sí" : "— no aún"}</span></div>
  <div class="kv"><span>Avisos de leads (push)</span><span>${pushSubs.length ? `🔔 activados · ${pushSubs.length} dispositivo${pushSubs.length > 1 ? "s" : ""}` : "— apagados"}</span></div>
  <div style="margin-top:10px"><button class="b-line" onclick="pushTest(this)" style="border:1px solid #E4E7EC;background:#fff;border-radius:13px;padding:12px 18px;font-weight:700;font-size:13.5px;cursor:pointer;font-family:inherit">🔔 Probar aviso — mandar push de prueba</button></div>
</div>

<div class="panel"><h2>Leads (${leads.length})</h2>
  <div style="overflow-x:auto"><table>
  <tr><th>Cuándo</th><th>Nombre</th><th>Teléfono</th><th>Dirección</th><th>Estimado</th><th></th></tr>
  ${leads.length ? leads.slice(0, 50).map((l) => {
    const i = l.info || {};
    const est = i.low ? `$${Number(i.low).toLocaleString("en-US")}–$${Number(i.high).toLocaleString("en-US")}` : "—";
    const wa = String(l.phone || "").replace(/\D/g, "").replace(/^1/, "");
    return `<tr><td>${ago(l.created_at)}</td><td>${esc(l.name) || "—"}</td><td>${prettyPhone(l.phone)}</td><td>${esc(l.address) || (i.work ? esc(i.work) : "—")}</td><td>${est}</td><td>${wa.length === 10 ? `<a href="https://wa.me/1${wa}" target="_blank">💬</a>` : ""}</td></tr>`;
  }).join("") : `<tr><td colspan="6" style="color:#8A94A8">Sin leads todavía.</td></tr>`}
  </table></div>
</div>

<div class="panel"><h2>📝 Notas y capacitación</h2>
  <p style="color:#67718A;font-weight:600;font-size:12.5px;margin:0 0 8px;line-height:1.5">Todo lo que no encaja en otro lado: por qué se molestó, qué le prometiste, cómo va su negocio…</p>
  <textarea id="adminnotes" rows="5" style="width:100%;border:1.5px solid #E2E6ED;border-radius:10px;padding:10px 12px;font:600 13px Inter,Arial,sans-serif;color:#16202E;resize:vertical" placeholder="Notas libres sobre este cliente…">${esc(d.adminNotes || "")}</textarea>
  <div style="margin:14px 0 8px;font-weight:700;font-size:11.5px;color:#9097A3;letter-spacing:.5px;text-transform:uppercase">Capacitación</div>
  <div style="display:flex;flex-direction:column;gap:9px">
    ${ADMIN_TRAINING_ITEMS.map(([k, label]) => `<label style="display:flex;align-items:center;gap:9px;font-weight:600;font-size:13.5px;color:#1B2433;cursor:pointer"><input type="checkbox" id="tr_${k}" ${training[k] ? "checked" : ""} style="width:17px;height:17px;accent-color:#F8B408">${esc(label)}</label>`).join("")}
  </div>
  <button class="b-dark" style="margin-top:14px" onclick="saveNotes(this)">Guardar notas</button>
</div>
</div>
<script>
var EMB=${JSON.stringify(embedCode)};
function cpEmbed(b){navigator.clipboard.writeText(EMB).then(function(){var o=b.textContent;b.textContent='✓ Copiado';setTimeout(function(){b.textContent=o},1600)});}
function pushTest(btn){
  btn.disabled=true;btn.textContent='🔔 enviando…';
  fetch('/api/admin/pushtest?id=${c.id}').then(function(r){return r.json()}).then(function(j){
    btn.disabled=false;btn.textContent='🔔 Probar aviso — mandar push de prueba';
    if(j.ok){alert('✅ Enviado a '+j.sent+' dispositivo(s) — el teléfono debe sonar AHORA.');return;}
    if(j.error){alert('❌ '+j.error);return;}
    var bad=(j.results||[]).filter(function(x){return !x.ok});
    alert('❌ Falló en '+bad.length+' de '+j.total+' dispositivo(s):\\n'+bad.map(function(x){return x.device+' → código '+x.status+(x.msg?' — '+x.msg:'')}).join('\\n')+'\\n\\nCódigo 403 = la suscripción es de otras llaves VAPID: en el teléfono toca Apagar y luego Activar avisos.\\nCódigo 404/410 = suscripción vencida: igual — Apagar y Activar de nuevo.');
  }).catch(function(){btn.disabled=false;btn.textContent='🔔 Probar aviso — mandar push de prueba';alert('Error de red');});
}
function act(url,q){ if(q&&!confirm(q))return; fetch(url).then(r=>r.json()).then(j=>{ if(!j.ok)alert('Error: '+j.error); location.reload(); }); }
function pub(v){ fetch('/api/onboarding/publish',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({slug:'${c.slug}',publish:v})}).then(r=>r.json()).then(()=>location.reload()); }
function delc(){ var t=prompt('⚠️ Esto BORRA este cliente con todo: página, leads, tareas y accesos. No se puede deshacer.\\n\\nPara confirmar escribe: ${c.slug}'); if(t===null)return; if(t!=='${c.slug}'){alert('No coincide — no se borró nada.');return;}
  fetch('/api/admin/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'${c.id}',confirm:t})}).then(r=>r.json()).then(j=>{ if(j.ok){alert('✓ Eliminado');location.href='/admin';} else alert('Error: '+(j.error||'?')); }); }
function hook(){ var u=prompt('Webhook de HighLevel (vacío = desconectar):'); if(u===null)return; fetch('/api/admin/webhook?id=${c.id}&url='+encodeURIComponent(u)).then(r=>r.json()).then(j=>{alert(j.ok?'✓ Guardado':'Error');location.reload();}); }
function saveNotes(btn){
  var training={};
  [].forEach.call(document.querySelectorAll('[id^="tr_"]'),function(el){training[el.id.slice(3)]=el.checked;});
  btn.disabled=true;btn.textContent='…';
  fetch('/api/admin/notes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:'${KEY}',id:'${c.id}',notes:document.getElementById('adminnotes').value,training:training})})
    .then(r=>r.json()).then(j=>{btn.disabled=false;btn.textContent=j.ok?'✓ Guardado':'Error';setTimeout(()=>{btn.textContent='Guardar notas';},1600);}).catch(()=>{btn.disabled=false;btn.textContent='Error';});
}
</script>
</body></html>`);
});

// Invite link: exchanges for a session and drops the user into the app.
// Accounts pending payment see a wait page instead — the same link starts
// working the moment Stripe confirms (or the admin activates manually).
app.get("/invite/:token", async (req, res) => {
  const session = await db.useInvite(req.params.token);
  if (!session) return res.status(404).send("Invitación no válida.");
  const who = await db.getSessionContractor(session).catch(() => null);
  if (who?.data?.payStatus === "pending") {
    return res.send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ALTO Pro</title><style>
*{box-sizing:border-box;font-family:Inter,Arial,sans-serif;margin:0}
body{background:#101B30;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.card{background:#fff;border-radius:22px;padding:36px 28px;max-width:400px;text-align:center;box-shadow:0 30px 80px rgba(0,0,0,.45)}
img{height:48px;margin-bottom:12px}h1{font-size:19px;color:#101B30;margin-bottom:8px}
p{color:#5A6478;font-size:14px;font-weight:600;line-height:1.6}
a{display:inline-block;margin-top:18px;background:#F8B408;color:#101B30;text-decoration:none;font-weight:800;padding:13px 24px;border-radius:12px}
</style></head><body><div class="card">
<img src="/brand-logo.png" alt="ALTO Pro">
<h1>⏳ Tu cuenta se está activando</h1>
<p>Se activa sola en cuanto se confirme tu pago — normalmente toma <b>1 minuto</b>.<br><br>Guarda este link (es tu llave 🔑) y vuelve a tocarlo en un momento.</p>
<a href="">Intentar de nuevo</a>
</div></body></html>`);
  }
  res.redirect(`${appBase(req)}/#session=${session}`);
});

// The app asks: who am I, and what's my saved data?
app.get("/api/me", async (req, res) => {
  const c = await auth(req);
  if (!c) return res.status(401).json({ error: "no session" });
  // Track setup progress for the admin: when they last opened the app and
  // whether they opened the installed (home-screen) version. Throttled so it
  // doesn't write on every poll, and never allowed to break login.
  let data = c.data || {};
  try {
    const now = Date.now();
    const last = data.lastSeen ? new Date(data.lastSeen).getTime() : 0;
    const patch = {};
    if (now - last > 5 * 60 * 1000) patch.lastSeen = new Date(now).toISOString();
    if (req.query.standalone === "1" && !data.installed) { patch.installed = true; patch.installedAt = new Date(now).toISOString(); }
    if (Object.keys(patch).length) { data = { ...data, ...patch }; await db.patchContractorData(c.id, patch); }
  } catch { /* tracking is best-effort */ }
  const state = await db.getState(c.id);
  res.json({ contractor: { id: c.id, slug: c.slug, name: c.name, phone: c.phone, data }, state });
});

// Demo gate: validate the owner's demo password (just a password, no username)
// so the locked screen can be unlocked by typing it — not only via a ?pass=
// link. Rate-limited so it can't be brute-forced. Off unless DEMO_PASS is set.
app.post("/api/demo-auth", (req, res) => {
  const ip = clientIp(req);
  if (overQuota(`da:${ip}`, 20)) return res.status(429).json({ ok: false });
  res.json({ ok: !!DEMO_PASS && String(req.body?.pass || "") === DEMO_PASS });
});

// The app saves its data (customers, jobs, profile) — whole snapshot, simple and safe
app.put("/api/state", async (req, res) => {
  const c = await auth(req);
  if (!c) return res.status(401).json({ error: "no session" });
  await db.saveState(c.id, req.body?.state || {});
  const incoming = req.body?.profile;
  if (incoming && typeof incoming === "object") {
    // MERGE, never replace. The client only owns its editable `profile` fields;
    // spreading the current record first preserves every server-owned field
    // (status, payStatus, payFailedAt, stripeCustomer, webhook, site, installed)
    // so a routine autosave can't wipe billing state or un-pause a non-payer.
    const cur = c.data || {};
    const clientProfile = incoming.profile && typeof incoming.profile === "object" ? incoming.profile : incoming;
    // Atomic patch of only `profile` — the surrounding fields (status, payStatus,
    // stripeCustomer, site…) are never read-then-written here, so a routine
    // autosave can't clobber a concurrent billing update.
    await db.patchContractorData(c.id, { profile: { ...(cur.profile || {}), ...clientProfile } });
  }
  res.json({ ok: true });
});

// Forward a fresh lead to the contractor's HighLevel (or any) webhook so
// automations — AI texting, booking, notifications — fire instantly.
// Fire-and-forget: a dead webhook must never lose or delay the lead.
async function forwardLead(c, lead) {
  const hook = c.data?.webhook;
  if (!hook || !/^https:\/\//.test(hook)) return;
  const body = JSON.stringify({ source: "alto-pro", contractor: c.slug, ...lead });
  // Fire-and-forget from the caller, but DON'T lose the lead on a transient GHL
  // failure: check the HTTP status (a rotated webhook or 429/500 resolves fine
  // and would otherwise pass silently), time out, and retry with backoff. If
  // every attempt fails, park it in a capped kv list so it's recoverable and
  // the failure is loud in the logs — the lead itself is already saved locally.
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 10000);
      const r = await fetch(hook, { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: ctrl.signal });
      clearTimeout(to);
      if (r.ok) return;
      throw new Error(`HTTP ${r.status}`);
    } catch (e) {
      console.error(`webhook ${c.slug} attempt ${attempt}/3 failed:`, e.message);
      if (attempt < 3) { await new Promise((rs) => setTimeout(rs, attempt * 2000)); continue; }
      try {
        const failed = (await db.kvGet("ghl_failed").catch(() => null)) || [];
        failed.push({ at: new Date().toISOString(), contractor: c.slug, lead: { name: lead.name, phone: lead.phone, source: lead.source || lead.src || "" }, error: e.message });
        await db.kvSet("ghl_failed", failed.slice(-100)).catch(() => {});
      } catch { /* best effort */ }
      console.error(`webhook ${c.slug}: GIVING UP after 3 attempts — lead parked in kv ghl_failed`);
    }
  }
}

// Widget (and anything public) drops a lead for a contractor by slug
app.post("/api/widget/lead", async (req, res) => {
  const wlIp = clientIp(req);
  if (overQuota(`wl:${wlIp}`, 10)) return res.status(429).json({ error: "quota" });
  const { slug, name, phone, address, info } = req.body || {};
  const c = slug && (await db.getContractorBySlug(String(slug)));
  if (!c) return res.status(404).json({ error: "unknown contractor" });
  if (c.data?.status === "paused") return res.status(403).json({ error: "paused" });
  // Validate a real phone (10–11 digits) and cap free-text so the widget can't
  // be used to inject junk or oversized leads.
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 11) return res.status(400).json({ error: "phone required" });
  const clean = (s, n) => String(s || "").slice(0, n);
  const safe = { name: clean(name, 80), phone: digits, address: clean(address, 160), info: sanitizeInfo(info) };
  const id = await db.addLead(c.id, safe);
  forwardLead(c, { id, name: safe.name, phone: safe.phone, address: safe.address, ...safe.info });
  notifyLead(c, { id, name: safe.name, phone: safe.phone, address: safe.address }).catch(() => {});
  res.json({ ok: true, id });
});

app.get("/api/leads", async (req, res) => {
  const c = await auth(req);
  if (!c) return res.status(401).json({ error: "no session" });
  res.json({ leads: await db.listLeads(c.id) });
});

/* ── Web Push: buzz the contractor's phone the moment a lead lands ──
 * The app subscribes the device; we store the subscription per account and
 * fire a notification on every new lead. iOS needs the app installed to the
 * home screen (Add to Home Screen) for this to work. */
app.get("/api/push/key", (req, res) => res.json({ key: PUSH_ON ? VAPID_PUBLIC : "" }));

app.post("/api/push/subscribe", async (req, res) => {
  const c = await auth(req);
  if (!c) return res.status(401).json({ error: "no session" });
  const sub = req.body?.subscription;
  if (!sub || !sub.endpoint) return res.status(400).json({ error: "bad subscription" });
  const key = `push:${c.id}`;
  const subs0 = await db.kvGet(key).catch(() => null); const subs = Array.isArray(subs0) ? subs0 : [];
  if (!subs.some((s) => s.endpoint === sub.endpoint)) subs.push(sub);
  try {
    await db.kvSet(key, subs.slice(-10)); // a few devices per account
  } catch (e) {
    // Be honest: if the subscription didn't persist, the phone will NOT buzz
    // on new leads. The app checks r.ok and tells the user to retry — silently
    // returning ok here was the "activé las alertas pero no me llegó" mystery.
    console.error("push subscribe save failed:", e.message);
    return res.status(503).json({ error: "no se pudo guardar — intenta de nuevo" });
  }
  res.json({ ok: true });
});

// Contractor turns lead alerts off on this device (Ajustes toggle).
app.post("/api/push/unsubscribe", async (req, res) => {
  const c = await auth(req);
  if (!c) return res.status(401).json({ error: "no session" });
  const endpoint = req.body?.endpoint;
  if (!endpoint) return res.status(400).json({ error: "bad endpoint" });
  const key = `push:${c.id}`;
  const subs0 = await db.kvGet(key).catch(() => null); const subs = Array.isArray(subs0) ? subs0 : [];
  try {
    await db.kvSet(key, subs.filter((s) => s.endpoint !== endpoint));
  } catch (e) {
    // Same honesty as subscribe: a swallowed failure here means the phone
    // keeps buzzing after the user turned alerts off.
    console.error("push unsubscribe save failed:", e.message);
    return res.status(503).json({ error: "no se pudo guardar — intenta de nuevo" });
  }
  res.json({ ok: true });
});

/* Admin: fire a test push to every device on the account and report exactly
 * what the push service said — turns "no me llegó el aviso" into a diagnosis
 * (no devices vs expired subscription vs VAPID mismatch vs delivered). */
app.get("/api/admin/pushtest", async (req, res) => {
  if (!adminOk(req)) return res.status(403).json({ error: "no auth" });
  if (!PUSH_ON) return res.json({ ok: false, error: "push apagado en el servidor (faltan VAPID keys)" });
  const c = await db.getContractor(String(req.query.id || ""));
  if (!c) return res.status(404).json({ error: "no contractor" });
  const subs0 = await db.kvGet(`push:${c.id}`).catch(() => null); const subs = Array.isArray(subs0) ? subs0 : [];
  if (!subs.length) return res.json({ ok: false, error: "0 dispositivos suscritos — en el teléfono: Ajustes → Activar avisos" });
  const body = JSON.stringify({ title: "🔔 Prueba de avisos", body: `Si ves esto, los avisos de ${c.name} funcionan.`, tag: "pushtest", url: "/" });
  const results = [];
  for (const s of subs) {
    try { await webpush.sendNotification(s, body); results.push({ device: `…${String(s.endpoint).slice(-10)}`, ok: true }); }
    catch (e) { results.push({ device: `…${String(s.endpoint).slice(-10)}`, ok: false, status: e.statusCode || 0, msg: String(e.body || e.message || "").slice(0, 140) }); }
  }
  res.json({ ok: results.every((r) => r.ok), sent: results.filter((r) => r.ok).length, total: results.length, results });
});

// Fire-and-forget web push to every device on the account, pruning
// subscriptions the browser has expired (404/410).
async function pushToContractor(c, payload) {
  if (!PUSH_ON || !c) return;
  const key = `push:${c.id}`;
  const subs0 = await db.kvGet(key).catch(() => null); const subs = Array.isArray(subs0) ? subs0 : [];
  if (!subs.length) return;
  const body = JSON.stringify(payload);
  const alive = [];
  await Promise.all(subs.map(async (s) => {
    try { await webpush.sendNotification(s, body); alive.push(s); }
    catch (e) { if (e.statusCode !== 404 && e.statusCode !== 410) alive.push(s); }
  }));
  if (alive.length !== subs.length) await db.kvSet(key, alive).catch(() => {});
}

async function notifyLead(c, lead) {
  await pushToContractor(c, {
    title: "🎉 Nuevo lead",
    body: `${lead.name || "Cliente"}${lead.address ? " — " + lead.address : ""}${lead.phone ? " · " + lead.phone : ""}`,
    tag: "lead-" + (lead.id || ""),
    url: "/",
  });
}

app.post("/api/leads/:id", async (req, res) => {
  const c = await auth(req);
  if (!c) return res.status(401).json({ error: "no session" });
  const status = String(req.body?.status || "contacted").slice(0, 20);
  await db.updateLeadStatus(c.id, String(req.params.id), status);
  res.json({ ok: true });
});

/* ── Review funnel (/opina/<slug>) ──
 * The contractor sends this link after every finished job. Happy customers
 * (4–5★) are walked to the contractor's Google review page; unhappy ones
 * (1–3★) vent privately and the owner gets a push — the complaint never
 * goes public. Good reviews with text also feed the website's reseñas
 * section, so every job makes the site stronger. */
const getReviews = async (cid) => { const v = await db.kvGet(`rev:${cid}`).catch(() => null); return Array.isArray(v) ? v : []; };

app.post("/api/review/:slug", async (req, res) => {
  const c = await db.getContractorBySlug(String(req.params.slug));
  if (!c) return res.status(404).json({ error: "unknown" });
  if (c.data?.status === "paused") return res.status(403).json({ error: "paused" });
  const ip = clientIp(req);
  if (overQuota(`rvw:${ip}`, 6) || overQuota(`rvs:${c.slug}`, 80)) return res.status(429).json({ error: "quota" });
  const stars = Math.round(Number(req.body?.stars));
  if (!(stars >= 1 && stars <= 5)) return res.status(400).json({ error: "stars 1-5" });
  const clean = (s, n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);
  const r = {
    id: crypto.randomUUID(),
    s: stars,
    n: clean(req.body?.name, 60),
    t: clean(req.body?.text, 600),
    ph: String(req.body?.phone || "").replace(/\D/g, "").slice(0, 11),
    d: new Date().toISOString(),
  };
  const list = await getReviews(c.id);
  list.push(r);
  await db.kvSet(`rev:${c.id}`, list.slice(-100)).catch(() => {});
  if (stars <= 3) {
    pushToContractor(c, {
      title: "⚠️ Cliente insatisfecho",
      body: `${r.n || "Un cliente"} dejó ${stars}★${r.t ? ": " + r.t.slice(0, 90) : ""}${r.ph ? " · " + r.ph : ""}`,
      tag: "rev-" + r.id,
      url: "/",
    }).catch(() => {});
  }
  const gmb = stars >= 4 ? String(c.data?.site?.gmb || c.data?.site?.facebook || "") : "";
  res.json({ ok: true, gmb: /^https:\/\//.test(gmb) ? gmb : null });
});

app.get("/opina/:slug", async (req, res) => {
  const c = await db.getContractorBySlug(String(req.params.slug));
  if (!c || c.data?.status === "paused") return res.status(404).send("Not found");
  const p = c.data?.profile || {};
  const biz = String(p.biz || c.name).replace(/[&<>"'\\`]/g, "");
  const logo = /^data:image\/(png|jpeg);base64,/.test(String(p.logo || "")) ? p.logo : null;
  const color = /^#[0-9a-fA-F]{6}$/.test(String(c.data?.site?.color || "")) ? c.data.site.color : "#B30F24";
  // Back-to-app button when the contractor previews from inside the app (?app=1).
  // Real client links (shared or embedded on their site) never carry ?app=1.
  const oBack = req.query.app != null ? `<div style="padding:12px 16px 0;max-width:430px;margin:0 auto"><a href="/" onclick="if(history.length>1){history.back();return false}" style="display:inline-flex;align-items:center;gap:5px;background:#fff;border:1.5px solid #E6E8EC;border-radius:999px;padding:8px 13px;font-weight:800;font-size:14px;color:#101B30;text-decoration:none;box-shadow:0 4px 14px rgba(16,27,48,.1)">‹ Volver a la app</a></div>` : "";
  res.send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tu opinión — ${biz}</title><meta name="robots" content="noindex">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700;800&display=swap" media="print" onload="this.media='all'">
<style>
*{box-sizing:border-box;font-family:Inter,Arial,sans-serif;margin:0;-webkit-tap-highlight-color:transparent}
body{min-height:100vh;display:flex;flex-direction:column;gap:12px;align-items:center;justify-content:center;padding:18px;background:linear-gradient(160deg,${color} 0%,#101B30 90%)}
.card{background:#fff;border-radius:26px;max-width:430px;width:100%;padding:34px 26px;text-align:center;box-shadow:0 30px 90px rgba(0,0,0,.4)}
.logo{max-height:56px;max-width:190px;margin-bottom:6px}
.biz{font-weight:800;font-size:20px;color:${color}}
h1{font-size:21px;margin:14px 0 6px;color:#101B30;letter-spacing:-.3px}
.sub{color:#67718A;font-weight:600;font-size:14px;line-height:1.55}
.stars{display:flex;justify-content:center;gap:6px;margin:22px 0 4px}
.stars button{font-size:44px;background:none;border:none;cursor:pointer;filter:grayscale(1);opacity:.45;transition:transform .12s,filter .12s,opacity .12s;padding:2px}
.stars button.on{filter:none;opacity:1;transform:scale(1.12)}
textarea,input{width:100%;border:1.5px solid #E4E7EE;border-radius:13px;padding:13px 14px;font-size:15px;font-family:inherit;outline:none;margin-top:10px;color:#101B30}
textarea{min-height:96px;resize:vertical}
textarea:focus,input:focus{border-color:${color}}
.btn{display:inline-block;width:100%;border:none;cursor:pointer;background:${color};color:#fff;font-weight:800;font-size:16px;padding:15px;border-radius:13px;margin-top:14px;text-decoration:none}
.btn.g{background:#fff;color:#101B30;border:2px solid #E4E7EE;font-weight:700}
.hide{display:none}
.big{font-size:52px;margin:6px 0}
.lang{position:fixed;top:14px;right:16px;background:#ffffff2e;border:1px solid #ffffff55;color:#fff;font-weight:700;font-size:12.5px;padding:7px 13px;border-radius:99px;cursor:pointer}
.foot{margin-top:18px;color:#9AA3B2;font-size:11.5px;font-weight:600}
</style></head><body>${oBack}
<button class="lang" id="lang">🇺🇸 English</button>
<div class="card">
  ${logo ? `<img class="logo" src="${logo}" alt="${biz}">` : `<div class="biz">${biz}</div>`}
  <div id="p1">
    <h1 data-i="q">¿Cómo fue tu experiencia con ${biz}?</h1>
    <p class="sub" data-i="qs">Toca las estrellas — nos ayuda muchísimo.</p>
    <div class="stars" id="stars">${[1, 2, 3, 4, 5].map((n) => `<button data-s="${n}" aria-label="${n}">⭐</button>`).join("")}</div>
  </div>
  <div id="p2" class="hide">
    <h1 id="h2"></h1>
    <p class="sub" id="s2"></p>
    <textarea id="txt"></textarea>
    <input id="nm">
    <input id="ph" type="tel" class="hide">
    <button class="btn" id="send" data-i="send">Enviar</button>
  </div>
  <div id="p3" class="hide">
    <div class="big" id="emo">🙏</div>
    <h1 id="h3"></h1>
    <p class="sub" id="s3"></p>
    <a class="btn hide" id="gbtn" target="_blank" rel="noopener"></a>
  </div>
  <p class="foot">${biz}</p>
</div>
<script>(function(){
var slug=${JSON.stringify(c.slug)},stars=0,en=false,sent=false;
var T={
 q:["¿Cómo fue tu experiencia con ${biz}?","How was your experience with ${biz}?"],
 qs:["Toca las estrellas — nos ayuda muchísimo.","Tap the stars — it helps us a lot."],
 hGood:["¡Qué alegría! 🎉","So glad to hear it! 🎉"],
 sGood:["¿Nos cuentas en unas palabras cómo te fue? (opcional)","Mind telling us a bit about it? (optional)"],
 hBad:["Lo sentimos mucho 😔","We're really sorry 😔"],
 sBad:["Cuéntanos qué pasó. El dueño lo lee personalmente.","Tell us what happened. The owner reads this personally."],
 txtG:["Ej. Llegaron a tiempo y dejaron todo limpio…","E.g. They came on time and left everything clean…"],
 txtB:["Cuéntanos qué salió mal…","Tell us what went wrong…"],
 nm:["Tu nombre (opcional)","Your name (optional)"],
 ph:["Tu teléfono — te llamamos para arreglarlo (opcional)","Your phone — we'll call to make it right (optional)"],
 send:["Enviar","Send"],
 h3G:["¡Mil gracias!","Thank you so much!"],
 s3G:["Tu opinión ya quedó publicada en nuestra página web. Nos ayuda muchísimo — gracias de verdad.","Your review is now published on our website. It helps us so much — thank you."],
 s3GG:["¿Nos ayudas publicándola también ahí? Ya copiamos tu texto — solo pégalo. Es 1 minuto y nos cambia el negocio.","One more favor: post it there too? We already copied your text — just paste it. Takes 1 minute and changes everything for us."],
 gbtnG:["⭐ Dejar reseña en Google","⭐ Leave the review on Google"],
 gbtnF:["👍 Dejar reseña en Facebook","👍 Leave the review on Facebook"],
 gbtnI:["📸 Encuéntranos en Instagram","📸 Find us on Instagram"],
 gbtnX:["⭐ Dejar tu reseña ahí","⭐ Leave your review there"],
 h3B:["Gracias por decírnoslo","Thank you for telling us"],
 s3B:["El dueño lo verá hoy mismo y te contactará para arreglarlo. De verdad, gracias por darnos la oportunidad.","The owner will see this today and reach out to make it right. Truly, thank you for giving us the chance."]
};
function t(k){return T[k][en?1:0];}
function apply(){document.querySelectorAll('[data-i]').forEach(function(e){e.textContent=t(e.getAttribute('data-i'));});
 document.getElementById('lang').textContent=en?'🇲🇽 Español':'🇺🇸 English';
 if(stars){paint();}}
document.getElementById('lang').onclick=function(){en=!en;apply();paint();};
var txt=document.getElementById('txt'),nm=document.getElementById('nm'),ph=document.getElementById('ph');
function paint(){
 if(!stars)return;
 var good=stars>=4;
 document.getElementById('h2').textContent=good?t('hGood'):t('hBad');
 document.getElementById('s2').textContent=good?t('sGood'):t('sBad');
 txt.placeholder=good?t('txtG'):t('txtB');
 nm.placeholder=t('nm');ph.placeholder=t('ph');
 ph.classList.toggle('hide',good);
 document.getElementById('send').textContent=t('send');
}
document.getElementById('stars').addEventListener('click',function(e){
 var b=e.target.closest('button');if(!b)return;
 stars=+b.getAttribute('data-s');
 [].forEach.call(document.querySelectorAll('#stars button'),function(x){x.classList.toggle('on',+x.getAttribute('data-s')<=stars);});
 paint();
 document.getElementById('p2').classList.remove('hide');
 setTimeout(function(){txt.focus();},150);
});
document.getElementById('send').onclick=function(){
 if(sent)return;sent=true;this.textContent='…';
 fetch('/api/review/'+slug,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({stars:stars,text:txt.value,name:nm.value,phone:ph.value})})
 .then(function(r){return r.json()}).then(function(j){
   var good=stars>=4;
   document.getElementById('p1').classList.add('hide');
   document.getElementById('p2').classList.add('hide');
   document.getElementById('p3').classList.remove('hide');
   document.getElementById('emo').textContent=good?'🙏':'🤝';
   document.getElementById('h3').textContent=good?t('h3G'):t('h3B');
   if(good&&j.gmb){
     document.getElementById('s3').textContent=t('s3GG');
     var h='';try{h=new URL(j.gmb).hostname}catch(e){}
     var bk=/google\\.|g\\.page|goo\\.gl/.test(h)?'gbtnG':/facebook\\.|fb\\./.test(h)?'gbtnF':/instagram\\./.test(h)?'gbtnI':'gbtnX';
     var g=document.getElementById('gbtn');g.textContent=t(bk);g.href=j.gmb;g.classList.remove('hide');
     if(txt.value.trim()&&navigator.clipboard){navigator.clipboard.writeText(txt.value.trim()).catch(function(){});}
   } else {
     document.getElementById('s3').textContent=good?t('s3G'):t('s3B');
   }
 }).catch(function(){sent=false;document.getElementById('send').textContent=t('send');});
};
apply();
})();</script>
</body></html>`);
});

/* ── Instant-quote widget ──
 * Public page each client website embeds (or links to directly from an ad).
 * A homeowner types their address, leaves name + phone, and sees a satellite-
 * measured ballpark price computed from THIS contractor's saved prices.
 * Every submission becomes a lead in the contractor's app — even when the
 * roof can't be measured. */

// Cost control: daily caps per visitor IP and per contractor, plus a 24h
// per-address cache so repeat lookups don't re-bill the Solar API.
const quotaMap = new Map();
function overQuota(key, max) {
  const day = new Date().toISOString().slice(0, 10);
  const q = quotaMap.get(key);
  if (!q || q.day !== day) { quotaMap.set(key, { day, n: 1 }); return false; }
  q.n += 1;
  if (quotaMap.size > 5000) quotaMap.delete(quotaMap.keys().next().value);
  return q.n > max;
}
const quoteCache = new Map();

/* Funnel tracking: tiny first-party counters, no cookies, no identities.
 * Only whitelisted event names are accepted. */
const TRACK_EVENTS = new Set(["visit", "quiz_work", "quiz_crew", "quiz_revenue", "quiz_marketing", "quiz_done", "w_view", "w_result", "trial_link"]);
// Paid-funnel analytics (the /admin → 📊 Embudos board). Two families:
//  · fn:<funnel>:<step> — the canonical funnel stages, one shared skeleton
//    so every funnel is comparable (visit→lead→try→block/buy→sale→paid).
//    sale/paid/cancel are bumped SERVER-side by the Stripe webhook.
//  · cr:<funnel>:<step>:<creative> — per-ad-creative attribution; the slug
//    comes from utm_content (or utm_campaign) on the ad link, sanitized
//    client-side and validated here so junk can't flood the metrics table.
const FUNNEL_IDS = "app|app-cercas|vsl-app|vsl-completo|pagina";
const FN_EVENT = new RegExp(`^fn:(${FUNNEL_IDS}):(visit|lead|try|block|buy|sale|paid|cancel|welcome|play|watch25|watch50|watch75)$`);
const CR_EVENT = new RegExp(`^cr:(${FUNNEL_IDS}):(visit|lead|buy):[a-z0-9_-]{1,40}$`);
const trackable = (ev) => TRACK_EVENTS.has(ev) || FN_EVENT.test(ev) || CR_EVENT.test(ev);

/* Where landing visitors come from: on each tracked visit, resolve the IP to a
 * city (cached 30 days per IP in kv, so repeat visits cost nothing) and bump an
 * aggregate geo:<Ciudad, ST> counter — the admin funnel shows the totals. The
 * IP itself never lands in the metrics, only city counts. Lookup uses the free
 * no-key ipwho.is API, hard-capped per day and fire-and-forget: a slow or dead
 * geo service can never slow down or break the page. */
// Datacenter/proxy detection: an IP whose network is a hosting company is a
// bot (link-preview crawlers, scanners, monitors) or a relay (iCloud Private
// Relay, Cloudflare WARP) — not a homeowner on Spectrum. Those count in their
// own bucket so the city list only shows real people on real networks.
// `google(?! fiber)` keeps Google Fiber customers (a real consumer ISP) human.
const HOSTED_ORG = /amazon|aws\b|google(?! fiber)|microsoft|azure|cloudflare|akamai|apple|icloud|digital ?ocean|linode|ovh|hetzner|oracle|vultr|fastly|facebook|meta plat|hosting|data ?cent|leaseweb|choopa|m247|colocat|server|crawl|spider|bot/i;
async function geoBump(ip) {
  try {
    if (!ip || /^(10\.|192\.168\.|127\.|::1|::ffff:127\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)) return;
    // v2 cache key: v1 entries lack the network org, so let them lapse and
    // re-resolve once — otherwise pre-upgrade bot IPs would stay "cities".
    const ck = `geoip2:${ip}`;
    let g = await db.kvGet(ck, 30 * 864e5).catch(() => null);
    if (!g) {
      if (overQuota("geoipd:all", 800)) return; // stay well under the free tier
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 3500);
      const r = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, { signal: ctrl.signal });
      clearTimeout(t);
      const j = await r.json().catch(() => null);
      g = j && j.success !== false && j.city
        ? { c: String(j.city).slice(0, 40), r: String(j.region_code || j.region || "").slice(0, 20), cc: String(j.country_code || "").slice(0, 2), o: String(j.connection?.org || j.connection?.isp || "").slice(0, 60) }
        : { fail: 1 }; // cache failures too — don't re-ask for the same IP all day
      await db.kvSet(ck, g).catch(() => {});
    }
    if (g.fail || !g.c) return;
    if (HOSTED_ORG.test(String(g.o || ""))) { await db.bumpMetric("geo_bot"); return; }
    const label = g.cc === "US" ? `${g.c}, ${g.r}` : `${g.c}, ${g.cc}`;
    await db.bumpMetric(`geo:${label}`.slice(0, 60));
  } catch { /* analytics must never touch the page */ }
}

app.post("/api/track", (req, res) => {
  const trIp = clientIp(req);
  if (overQuota(`tr:${trIp}`, 300)) return res.json({ ok: true }); // silently ignore spam
  const event = String(req.body?.event || "");
  if (!trackable(event)) return res.status(400).json({ error: "bad event" });
  db.bumpMetric(event).catch(() => { /* counters must never break the page */ });
  if (event === "visit") geoBump(trIp); // deliberately not awaited
  res.json({ ok: true });
});

// Receives a JS error captured on a real device (index.html crash reporter) and
// stores the last few so they can be read at /errors. Never fails the caller.
app.post("/api/clienterror", async (req, res) => {
  try {
    const ceIp = clientIp(req);
    if (!overQuota(`ce:${ceIp}`, 20)) {
      const e = req.body || {};
      // Belt-and-suspenders: strip credential-like params server-side too, so a
      // stale cached index.html (pre-redaction) can't log a session token.
      const redact = (u) => String(u || "").replace(/([?&#](s|key|pass|session|token|invite)=)[^&#]*/gi, "$1REDACTED");
      const entry = {
        t: String(e.t || new Date().toISOString()).slice(0, 30),
        kind: String(e.kind || "").slice(0, 12),
        msg: redact(e.msg).slice(0, 500),
        line: e.line, src: redact(e.src).slice(0, 220),
        stack: redact(e.stack).slice(0, 1400),
        ua: String(e.ua || "").slice(0, 320),
        url: redact(e.url).slice(0, 320),
      };
      console.error("CLIENT ERROR:", entry.msg, "|", entry.url, "|", entry.ua.slice(0, 50));
      const list0 = await db.kvGet("clienterr").catch(() => null); const list = Array.isArray(list0) ? list0 : [];
      list.push(entry);
      await db.kvSet("clienterr", list.slice(-40)).catch(() => {});
    }
  } catch { /* reporting must never break anything */ }
  res.json({ ok: true });
});

// Read the captured device errors (gated by the CS/admin key, same as /cs).
app.get("/errors", async (req, res) => {
  if (!CS_KEY && !ADMIN_KEY) return res.status(503).send("Set CS_KEY or ADMIN_KEY.");
  if (!csOk(req)) return res.status(req.query.key ? 403 : 401).send("Agrega ?key=TU_CS_KEY a la URL.");
  const list0 = await db.kvGet("clienterr").catch(() => null); const list = (Array.isArray(list0) ? list0 : []).slice().reverse();
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const rows = list.length
    ? list.map((e) => `<div class="e"><div class="m">${esc(e.msg)}</div>${e.line ? `<div class="meta">línea ${esc(e.line)} · ${esc(e.src)}</div>` : ""}${e.stack ? `<div class="s">${esc(e.stack)}</div>` : ""}<div class="meta">${esc(e.t)} · ${esc(e.url)}<br>${esc(e.ua)}</div></div>`).join("")
    : "<p>Sin errores 🎉</p>";
  res.send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Errores</title><style>
body{font-family:-apple-system,system-ui,sans-serif;background:#0F1726;color:#E6EBF3;margin:0;padding:16px}
h1{font-size:18px;margin:0 0 12px}
.e{background:#16223A;border:1px solid #283656;border-radius:10px;padding:12px;margin:10px 0;font-size:13px}
.m{color:#FFB3B3;font-weight:700;word-break:break-word}
.s{color:#9AA7C0;white-space:pre-wrap;font-size:11px;margin-top:6px;overflow-x:auto}
.meta{color:#7A8AA8;font-size:11px;margin-top:6px;word-break:break-word}
</style></head><body><h1>📋 Errores del cliente (${list.length})</h1>${rows}</body></html>`);
});

/* AI chat assistant — two hats, one engine:
 *  · no slug (or alto-demo) → the "Techos García" demo persona the sales
 *    deck shows a prospect;
 *  · a real client slug → the assistant of THAT contractor's website,
 *    briefed with their business data. When a visitor drops a phone number
 *    it becomes a lead in the contractor's app, exactly like the widget. */
app.post("/api/widget/chat", async (req, res) => {
  const msgs = Array.isArray(req.body?.messages) ? req.body.messages.slice(-12) : [];
  if (!msgs.length) return res.status(400).json({ error: "messages required" });
  const ip = clientIp(req);
  if (overQuota(`chat:${ip}`, 40) || overQuota("chat:all", 500)) return res.status(429).json({ error: "quota" });
  const slug = String(req.body?.slug || "").slice(0, 60);
  const demoSlug = slug === "alto-demo" || slug === "alto-cercas"; // sales personas — never create real leads
  const c = slug && !demoSlug ? await db.getContractorBySlug(slug).catch(() => null) : null;
  const live = c && c.data?.status !== "paused" ? c : null;

  // Staff "Probar el chat" (?preview=1) marks every message testMode=true —
  // same bot, same wording, but NO real lead, NO push to the real contractor.
  // Client-controlled, but only reachable because the page itself required
  // closerOk/csOk auth to render with testMode on in the first place.
  const testMode = req.body?.test === true;

  // Lead capture: only the NEWEST visitor message is scanned (history is
  // re-sent every turn), and the client sets leadSent after the first catch.
  let captured = false;
  if (live && !req.body?.leadSent && !testMode) {
    const lastUser = [...msgs].reverse().find((m) => m.role !== "assistant");
    const userText = String(lastUser?.content || "");
    const m = userText.match(/\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
    const digits = m ? m[0].replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "") : "";
    if (digits.length === 10) {
      // Grab the name when they introduce themselves ("soy Pedro García…")
      let name = "";
      const nm = userText.match(/(?:me llamo|mi nombre es|soy|my name is|i am|i'm|this is)[\s:]+([a-zA-ZÀ-ſ]+(?:\s+[a-zA-ZÀ-ſ]+)?)/i);
      if (nm && !/^(de|del|la|el|un|una|cliente|yo|the|a)$/i.test(nm[1].split(/\s/)[0])) name = nm[1].slice(0, 40);
      if (!name) {
        // "rolando pena 9562576072" — the most common way people actually
        // answer "déjame tu nombre y teléfono": bare name + number. Strip
        // the phone; if the leftover reads like a name (1–4 plain words,
        // none of them everyday chat words), that's the name.
        const left = userText.replace(m[0], " ").replace(/[.,;:()!¡¿?"'’]/g, " ").replace(/\s+/g, " ").trim();
        const words = left ? left.split(" ") : [];
        // polite wrappers aren't part of the name: "hola … por favor"
        while (words.length && /^(hola|buenas|buenos|dias|días|tardes|noches|hey|hi|hello)$/i.test(words[0])) words.shift();
        while (words.length && /^(por|favor|gracias|please|thanks|thank|you)$/i.test(words[words.length - 1])) words.pop();
        const NOTNAME = /^(hola|buenas|buenos|dias|días|tardes|noches|quiero|necesito|precio|precios|cotizar|cotizacion|cotización|estimado|cita|cerca|cercas|techo|techos|roof|roofing|fence|quote|price|nombre|name|telefono|teléfono|numero|número|phone|cel|celular|whatsapp|llamame|llámame|llamenme|marcame|márcame|call|text|please|por|favor|gracias|aqui|aquí|este|esta|es|mi|my|hi|hello|hey|si|sí|no|ok|yes|de|del|la|el|los|las|un|una|the|a|y|and|me|yo|i|im|soy|casa|house|info|informacion|información)$/i;
        const looksName = words.length >= 1 && words.length <= 4
          && words.every((w) => /^[a-zA-ZÀ-ſ-]{2,20}$/.test(w) && !NOTNAME.test(w));
        if (looksName) name = words.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(" ").slice(0, 40);
      }
      try {
        const convo = msgs.filter((x) => x.role !== "assistant").map((x) => String(x.content || "").slice(0, 200)).join(" · ").slice(0, 600);
        const id = await db.addLead(live.id, { name, phone: digits, address: "", info: { source: "chat", chat: convo } });
        forwardLead(live, { id, name, phone: digits, source: "chat" });
        notifyLead(live, { id, name: name || "💬 Chat de tu página", phone: digits }).catch(() => {});
        captured = true;
      } catch (e) { console.error("chat lead failed:", e.message); }
    }
  }

  if (!aiLive) return res.json({ text: "(Demo) La IA se activa cuando el servidor tenga su API key.", source: "demo", captured });
  try {
    const inEnglish = req.body?.lang === "en";
    const tone = `Responde SIEMPRE en ${inEnglish ? "inglés" : "español"}, estilo mensaje de texto: cálido, profesional, máximo 45 palabras, sin markdown.`;
    // The one true story the bot tells: leaving a phone number notifies the
    // roofer's phone INSTANTLY (real push). It captures the lead — it does
    // NOT manage a calendar, so it never invents appointment slots.
    const playbook = ` Tu meta #1: conseguir el NOMBRE y TELÉFONO del cliente. Si piden que alguien les llame o les urge: di que SÍ — pide su nombre y teléfono, y explica que al dejarlo le llega la notificación al equipo EN ESE MOMENTO, directo a su celular. NO manejas calendario: nunca inventes horarios de cita ni prometas "mañana a las 10". Si piden cita, di que con gusto la confirman cuando le marquen de regreso. NUNCA des precios exactos: el cotizador de esta misma página (60 segundos, por satélite) da el estimado, y la inspección gratis el precio final. Lo que no sepas, di que el equipo lo confirma cuando le llamen — no inventes datos.`;
    // Did the newest message include a phone number? (also true in the deck
    // demo, where no lead is saved but the mock phone dings via postMessage)
    const gaveContact = captured || /\d{3}[\s.\-()]*\d{3}[\s.\-]*\d{4}/.test(String([...msgs].reverse().find((x) => x.role !== "assistant")?.content || ""));
    const confirmLine = " El cliente ACABA de dejar su teléfono: dale las gracias por su nombre y número, y confirma que EN ESTE MOMENTO le llegó la notificación al equipo a su celular y que le marcan de regreso muy pronto.";
    let system;
    if (live) {
      const p = live.data?.profile || {}, st = live.data?.site || {};
      const fence = live.data?.trade === "fence";
      const clean = (s, n) => String(s || "").replace(/\s+/g, " ").slice(0, n);
      const biz = clean(p.biz || live.name, 60) || "la compañía";
      const svc = Array.isArray(st.services) ? st.services.map((s) => clean(Array.isArray(s) ? s[1] : s, 40)).filter(Boolean).slice(0, 9) : [];
      system = `Eres el asistente virtual del sitio web de "${biz}", una compañía de ${fence ? "cercas" : "techos"}${st.city ? ` en ${clean(st.city, 40)}` : ""}.`
        + (st.years ? ` Llevan ${clean(st.years, 4)} años en el negocio.` : "")
        + (svc.length ? ` Servicios: ${svc.join(", ")}.` : "")
        + (st.warranty ? ` Garantía: ${clean(st.warranty, 80)}.` : "")
        // Staff-curated facts (admin → "Bot del sitio"): the ONLY extra things
        // the bot may assert — office/address, hours, weekends, financing…
        + (st.botFacts ? ` DATOS CONFIRMADOS del negocio — tu única fuente de verdad para dirección, horarios, financiamiento, preguntas frecuentes y temas parecidos; lo que no esté aquí NO lo afirmes, di que lo confirman cuando le llamen: ${clean(st.botFacts, 1600)}.` : ` No tienes confirmados dirección de oficina ni horarios: si preguntan, di que el equipo lo confirma cuando le llame.`)
        + ` ${tone} ${fence ? "Contesta dudas de cercas (madera, vinilo, malla ciclónica, portones, reparaciones)." : "Contesta dudas de techos (goteras, reemplazo, granizo, reclamos de seguro)."}`
        + (fence ? playbook.replace("(60 segundos, por satélite)", "(60 segundos)") : playbook)
        + (gaveContact ? confirmLine : "");
    } else if (slug === "alto-cercas") {
      system = `Eres el asistente virtual del sitio web de "Cercas García", una compañía de cercas en Texas (el dueño se llama José). Estás en una DEMO en vivo frente a un contratista interesado en este servicio. ${tone} Contesta dudas de cercas (madera, vinilo, malla ciclónica, portones, reparaciones).` + playbook.replace("(60 segundos, por satélite)", "(60 segundos)").replace(/el equipo/g, "José")
        + (gaveContact ? confirmLine.replace("al equipo", "a José") : "")
        + " Si preguntan algo fuera de tema, redirige con amabilidad a la cerca.";
    } else {
      system = `Eres el asistente virtual del sitio web de "Techos García", una compañía de techos en Texas (el dueño se llama José). Estás en una DEMO en vivo frente a un contratista interesado en este servicio. ${tone} Contesta dudas de techos (goteras, reemplazo, reparación, reclamos de seguro).` + playbook.replace(/el equipo/g, "José")
        + (gaveContact ? confirmLine.replace("al equipo", "a José") : "")
        + " Si preguntan algo fuera de tema, redirige con amabilidad al techo.";
    }
    const text = await aiChat({
      maxTokens: 180,
      system,
      messages: msgs.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "").slice(0, 400) })),
    });
    res.json({ text, source: live ? "site" : "live", captured });
  } catch (e) {
    console.error("widget chat failed:", e.message);
    res.status(502).json({ error: "ai_failed", captured });
  }
});

app.post("/api/widget/quote", async (req, res) => {
  const { slug, name = "", phone = "", address = "", placeId = null, lat = null, lng = null } = req.body || {};
  const c = slug && (await db.getContractorBySlug(String(slug)));
  if (!c) return res.status(404).json({ error: "unknown contractor" });
  if (c.data?.status === "paused") return res.status(403).json({ error: "paused" });
  const digits = String(phone).replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 11) return res.status(400).json({ error: "phone required" });
  // The homeowner can give us a typed address OR tap "use my location" (GPS).
  const hasGps = lat != null && lng != null && isFinite(+lat) && isFinite(+lng);
  if (!String(address).trim() && !hasGps) return res.status(400).json({ error: "address required" });
  const ip = clientIp(req);
  // Private demo mode (passcode in the link) = unlimited runs, no lead saved.
  const demoOk = !!DEMO_PASS && String(req.body?.demo || "") === DEMO_PASS;
  const demoAcct = slug === "alto-demo" || slug === "alto-cercas";
  if (!demoOk) {
    if (demoAcct) {
      // The shared demo link is a SALES tool: a prospect gets TWO full quotes
      // per device, then the widget flips to "hablemos" (demo_done). Staff
      // demos carry ?pass=<DEMO_PASS> and never hit this.
      const wqLife = await db.incrCounter(`wq:${slug}:${ip}`).catch(() => 0);
      if (wqLife > 2 || overQuota(`wslug:${slug}`, 150)) return res.status(429).json({ error: "demo_done" });
    } else {
      if (overQuota(`wip:${ip}`, 2) || overQuota(`wslug:${slug}`, 150)) return res.status(429).json({ error: "quota" });
      // lifetime per connection per widget: homeowners quote a roof 1-3 times
      // ever; only freeloaders and price-spies get anywhere near 20
      const wqLife = await db.incrCounter(`wq:${slug}:${ip}`).catch(() => 0);
      if (wqLife > 5) return res.status(429).json({ error: "quota" });
    }
  }

  // Save the CONTACT first — before any external measurement call — so a
  // stalled Google/Solar request or a process restart can never lose the
  // homeowner's name and phone. The lead is enriched with the quote below.
  let leadId = null;
  if (!demoOk) {
    leadId = await db.addLead(c.id, {
      name: String(name).slice(0, 80),
      phone: digits.slice(0, 15),
      address: String(address || "").slice(0, 160),
      info: { unmeasured: true },
    }).catch((e) => { console.error("early lead save failed:", e.message); return null; });
  }

  // Measure the roof (best effort — the lead is already saved)
  let m = null;
  try {
    const ck = hasGps ? `${(+lat).toFixed(5)},${(+lng).toFixed(5)}` : String(address).toLowerCase().replace(/\s+/g, " ").trim();
    const hit = quoteCache.get(ck);
    if (hit && Date.now() - hit.at < 86400e3) m = hit.data;
    else if (GOOGLE_KEY) {
      // GPS skips geocoding — go straight to the homeowner's coordinates.
      const geo = hasGps
        ? { lat: +lat, lng: +lng, formatted: (await reverseGeocode(+lat, +lng).catch(() => "")) || String(address).trim() }
        : (placeId && (await placeDetails(placeId).catch(() => null))) || (await geocode(address));
      if (geo) {
        const roof = await solarLookup(geo.lat, geo.lng).catch(() => null);
        const outline = roof ? await roofOutline(geo.lat, geo.lng, roof.bbox).catch(() => null) : null;
        m = { addr: geo.formatted, lat: geo.lat, lng: geo.lng };
        if (roof) Object.assign(m, { roofArea: roof.roofArea, pitch: roof.pitch, bbox: roof.bbox, outline });
        quoteCache.set(ck, { at: Date.now(), data: m });
        if (quoteCache.size > 500) quoteCache.delete(quoteCache.keys().next().value);
      }
    }
  } catch (e) { console.error("widget measure failed:", e.message); }

  // Same math as the app's calculator, with the contractor's saved prices;
  // shown as a range because the homeowner gets a ballpark, not a bid.
  let quote = null;
  if (m?.roofArea) {
    const prices = c.data?.profile?.prices || {};
    const p = (k, dflt) => (prices[k] != null && prices[k] !== "" ? Number(prices[k]) : dflt);
    const squares = Math.ceil(m.roofArea / 100);
    const matSquares = Math.ceil(squares * 1.1);
    const base = matSquares * (p("arch", 110) + 30) + squares * (p("labor", 150) + p("tear", 50));
    quote = { squares, low: Math.round((base * 0.9) / 50) * 50, high: Math.round((base * 1.15) / 50) * 50 };
  }

  // Demo rehearsals must not pollute the contractor's real pipeline, so skip
  // enriching and forwarding the lead when running in passcode demo mode.
  if (!demoOk && leadId) {
    // Enrich the already-saved contact with the measurement + quote.
    const enrichAddr = String(m?.addr || address || "").slice(0, 160);
    await db.updateLeadInfo(c.id, leadId, quote
      ? { squares: quote.squares, low: quote.low, high: quote.high, roofArea: m.roofArea, measuredAddr: enrichAddr, unmeasured: false }
      : { unmeasured: true, measuredAddr: enrichAddr }).catch(() => {});
    forwardLead(c, {
      id: leadId, name: String(name).slice(0, 80), phone: digits.slice(0, 15),
      address: enrichAddr,
      low: quote?.low ?? null, high: quote?.high ?? null, squares: quote?.squares ?? null,
    });
    notifyLead(c, { id: leadId, name: String(name).slice(0, 80), phone: digits.slice(0, 15), address: enrichAddr }).catch(() => {});
  }

  let img = null, street = null;
  if (m?.lat && GOOGLE_KEY) {
    img = `/api/roofimg?lat=${m.lat}&lng=${m.lng}` +
      (m.bbox ? `&bbox=${m.bbox.join(",")}` : "") +
      (m.outline ? `&outline=${encodeURIComponent(m.outline.map((p2) => p2.join(",")).join(";"))}` : "");
    street = `/api/streetview?lat=${m.lat}&lng=${m.lng}`;
  }
  res.json({ ok: true, id: leadId, addr: m?.addr || address, measured: !!quote, squares: quote?.squares ?? null, low: quote?.low ?? null, high: quote?.high ?? null, img, street });
});

// After the homeowner sees their house, one quick question — stories — refines
// the price (+10% labor per extra story, matching the app). Reuses the measured
// square count, so no new map lookups; updates the lead with their answer.
app.post("/api/widget/requote", async (req, res) => {
  const { slug, leadId = null, squares, stories } = req.body || {};
  const c = slug && (await db.getContractorBySlug(String(slug)));
  if (!c) return res.status(404).json({ error: "unknown contractor" });
  const sq = Math.max(1, Math.min(300, parseInt(squares) || 0));
  const st = Math.max(1, Math.min(3, parseInt(stories) || 1));
  if (!sq) return res.json({ ok: false });
  const prices = c.data?.profile?.prices || {};
  const p = (k, dflt) => (prices[k] != null && prices[k] !== "" ? Number(prices[k]) : dflt);
  const storyMult = 1 + (st - 1) * 0.1;
  const matSquares = Math.ceil(sq * 1.1);
  const base = matSquares * (p("arch", 110) + 30) + sq * (p("labor", 150) * storyMult + p("tear", 50));
  const low = Math.round((base * 0.9) / 50) * 50, high = Math.round((base * 1.15) / 50) * 50;
  if (leadId) db.updateLeadInfo(c.id, String(leadId), { stories: st, low, high }).catch(() => {});
  res.json({ ok: true, low, high });
});

/* ── Fence widget: the REAL satellite scan ──
 * The homeowner types their address and watches the satellite find their
 * actual lot: geocode → parcel lookup (the same FENCE ACCURATE resolver the
 * app uses, cached 90 days) → the red boundary draws itself on the aerial
 * photo. That reveal is free; the interactive fence picker behind it costs a
 * name + phone. Runs under the CONTRACTOR's account (their widget, their
 * entitlement), metered per visitor with the same lifetime counter as the
 * roofing widget (wq:<slug>:<ip> ≤ 5). ?pass=<DEMO_PASS> = unlimited + no
 * real lead, for sales demos. No parcel coverage → ok:true with parcel:null
 * and the widget falls back to the classic material/size funnel. */
/* The widget's idle state runs a REAL scan on a demo house (Dallas — trial
 * Regrid coverage) so the visitor watches exactly what will happen to their
 * own address: aerial → sweep → the boundary draws itself, on a loop. One
 * geocode + one parcel lookup, cached 30 days — the loop itself is free. */
const FENCE_DEMO_ADDR = "1211 Cascade Ave, Dallas, TX";
async function getFenceDemoScan() {
  if (!GOOGLE_KEY || !REGRID_KEY) return null;
  const hit = await db.kvGet("wdemo:cascade", 30 * 24 * 3600 * 1000).catch(() => null);
  if (hit?.parcel) return hit;
  try {
    const geo = await geocode(FENCE_DEMO_ADDR);
    if (!geo) return null;
    const v = await resolveParcel(geo.lat, geo.lng).catch(() => null);
    if (v?.state !== "found" || !(v.candidates?.[0]?.disp?.length >= 3)) return null;
    const P = v.candidates[0].disp;
    let s = 90, w = 180, nn = -90, e = -180;
    P.forEach(([la, ln]) => { s = Math.min(s, la); nn = Math.max(nn, la); w = Math.min(w, ln); e = Math.max(e, ln); });
    const ctrLat = (s + nn) / 2, ctrLng = (w + e) / 2;
    const span = Math.max(nn - s, (e - w) * Math.cos((ctrLat * Math.PI) / 180), 0.0001) * 1.6;
    const view = { lat: ctrLat, lng: ctrLng, zoom: Math.min(Math.max(Math.floor(Math.log2((360 * (640 / 256)) / span)), 15), 20) };
    const out = { view, parcel: P, img: `/api/roofimg?lat=${view.lat}&lng=${view.lng}&zoom=${view.zoom}&sq=1` };
    await db.kvSet("wdemo:cascade", out).catch(() => {});
    return out;
  } catch { return null; }
}
const widgetFenceProducts = (c) => {
  const RATE = { cedar: 28, vinyl: 38, chain: 18, alum: 45, ranch: 20 };
  const NAMES = { cedar: "Madera (cedro)", vinyl: "Vinilo", chain: "Malla ciclónica", alum: "Aluminio", ranch: "Rancho" };
  const saved = Array.isArray(c.data?.profile?.fenceProducts) ? c.data.profile.fenceProducts : null;
  const list = saved && saved.length
    ? saved.filter((p) => p.on !== false)
    : Object.keys(RATE).map((k) => ({ id: k, name: NAMES[k], price: RATE[k] }));
  return list.slice(0, 12).map((p) => ({
    id: String(p.id || "").slice(0, 24),
    name: String(p.name || "").slice(0, 40),
    price: Math.max(1, Math.min(500, Number(p.price) || RATE[p.id] || 28)),
    img: /^https?:\/\//.test(String(p.img || "")) ? String(p.img).slice(0, 300) : null,
  })).filter((p) => p.name);
};
app.post("/api/widget/fence-scan", async (req, res) => {
  const { slug, address = "", placeId = null, lat = null, lng = null } = req.body || {};
  const c = slug && (await db.getContractorBySlug(String(slug)));
  if (!c) return res.status(404).json({ error: "unknown contractor" });
  if (c.data?.status === "paused") return res.status(403).json({ error: "paused" });
  const hasGps = lat != null && lng != null && isFinite(+lat) && isFinite(+lng);
  if (!String(address).trim() && !hasGps) return res.status(400).json({ error: "address required" });
  const ip = clientIp(req);
  const demoOk = !!DEMO_PASS && String(req.body?.demo || "") === DEMO_PASS;
  const demoAcct = slug === "alto-demo" || slug === "alto-cercas";
  if (!demoOk) {
    if (demoAcct) {
      // sales demo: 2 scans per device, then the takeover (see /api/widget/quote)
      const life = await db.incrCounter(`wq:${slug}:${ip}`).catch(() => 0);
      if (life > 2 || overQuota(`wslug:${slug}`, 150)) return res.status(429).json({ error: "demo_done" });
    } else {
      if (overQuota(`wip:${ip}`, 3) || overQuota(`wslug:${slug}`, 150)) return res.status(429).json({ error: "quota" });
      const life = await db.incrCounter(`wq:${slug}:${ip}`).catch(() => 0);
      if (life > 5) return res.status(429).json({ error: "quota" });
    }
  }
  db.bumpMetric("fsc_req").catch(() => {});
  if (!GOOGLE_KEY) return res.status(503).json({ error: "no_maps" });
  try {
    const geo = hasGps
      ? { lat: +lat, lng: +lng, formatted: (await reverseGeocode(+lat, +lng).catch(() => "")) || String(address).trim() }
      : (placeId && (await placeDetails(String(placeId)).catch(() => null))) || (await geocode(String(address).slice(0, 200)));
    if (!geo) return res.status(404).json({ error: "not_found" });
    const v = REGRID_KEY ? await resolveParcel(geo.lat, geo.lng).catch(() => ({ state: "provider_error", candidates: [] })) : { state: "no_key", candidates: [] };
    const found = v.state === "found" && v.candidates?.[0]?.disp?.length >= 3;
    const P = found ? v.candidates[0].disp : null;
    // Frame the aerial exactly like the app's fence map (square, whole lot)
    let view = { lat: geo.lat, lng: geo.lng, zoom: 19 };
    if (P) {
      let s = 90, w = 180, nn = -90, e = -180;
      P.forEach(([la, ln]) => { s = Math.min(s, la); nn = Math.max(nn, la); w = Math.min(w, ln); e = Math.max(e, ln); });
      const ctrLat = (s + nn) / 2, ctrLng = (w + e) / 2;
      const span = Math.max(nn - s, (e - w) * Math.cos((ctrLat * Math.PI) / 180), 0.0001) * 1.6;
      view = { lat: ctrLat, lng: ctrLng, zoom: Math.min(Math.max(Math.floor(Math.log2((360 * (640 / 256)) / span)), 15), 20) };
    }
    db.bumpMetric(found ? "fsc_found" : "fsc_miss").catch(() => {});
    res.json({
      ok: true, addr: geo.formatted, lat: geo.lat, lng: geo.lng,
      parcel: P, view,
      img: `/api/roofimg?lat=${view.lat}&lng=${view.lng}&zoom=${view.zoom}&sq=1`,
      products: widgetFenceProducts(c),
    });
  } catch (e) {
    console.error("fence-scan failed:", e.message);
    db.bumpMetric("fsc_err").catch(() => {});
    res.status(502).json({ error: "scan_failed" });
  }
});

/* The homeowner finished picking their sides + material → recompute the
 * range SERVER-side from the contractor's own price (never trust client
 * math for the number the contractor sees) and enrich the lead saved at
 * the unlock step. Range, not a bid — the exact price belongs to the
 * contractor's free visit. */
app.post("/api/widget/fence-estimate", async (req, res) => {
  const { slug, leadId = null, prodId = "", netFt = 0 } = req.body || {};
  const c = slug && (await db.getContractorBySlug(String(slug)));
  if (!c) return res.status(404).json({ error: "unknown contractor" });
  const gates = Math.max(0, Math.min(20, Math.round(Number(req.body?.gates) || 0)));
  const ft = Math.max(10, Math.min(5000, Math.round(Number(netFt) || 0)));
  if (!ft) return res.status(400).json({ error: "netFt required" });
  const prods = widgetFenceProducts(c);
  const prod = prods.find((p) => p.id === String(prodId)) || prods[0];
  if (!prod) return res.status(400).json({ error: "no products" });
  const base = ft * prod.price;
  const low = Math.round((base * 0.9) / 50) * 50, high = Math.round((base * 1.2) / 50) * 50;
  if (leadId) {
    await db.updateLeadInfo(c.id, String(leadId), { fenceFt: ft, material: prod.name, low, high, gates }).catch(() => {});
  }
  res.json({ ok: true, low, high, ft, material: prod.name });
});

/* ── Fence quote widget ──
 * Served instead of the roofing widget when the contractor's trade is fence.
 * Same funnel shape (address → details → contact → price range), but fences
 * can't be satellite-measured without a parcel API, so the details step asks
 * material + yard size and prices from typical linear-feet per size. */
/* The widget's measuring tool runs the SAME construction math as the app:
 * src/fenceMath.js is inlined verbatim (exports stripped) into the page so
 * panels/posts/net-feet can never disagree between surfaces. The module has
 * no backticks or ${} so it embeds safely in the template literal. */
const FENCE_MATH_JS = fs.readFileSync(new URL("../src/fenceMath.js", import.meta.url), "utf8").replace(/^export /gm, "");
function fenceWidgetHtml({ biz, bizPhone, logo, es, slug, wBase, appBack, demoScan }) {
  // Demo takeover: the shared demo link stops after 2 scans and sells ALTO.
  const ddoneHtml = `<p class="q" style="text-align:center">${es ? "🚀 ¿Viste qué fácil?" : "🚀 See how easy that was?"}</p>`
    + `<p class="sub" style="text-align:center">${es
      ? "Ya usaste tus 2 cotizaciones de prueba. Así de fácil te ahorras el tiempo, el gas y las vueltas — cotizas desde donde estés, sin manejar a cada casa. Imagínate el dinero que te ahorras teniendo esta aplicación."
      : "You've used your 2 trial quotes. That's how easily you save the time, the gas and the trips — you quote from wherever you are, without driving to every house. Imagine the money you save with this app."}</p>`
    + `<a href="https://wa.me/${SALES_WA}?text=${encodeURIComponent(es
      ? "Hola 👋 Probé el demo del cotizador de cercas de ALTO Pro y quiero verlo en MI página web."
      : "Hi 👋 I tried the ALTO Pro fence quote demo and I want it on MY website.")}" target="_blank" style="display:block;text-align:center;background:#F8B408;color:#101B30;border-radius:14px;padding:15px;font-weight:800;text-decoration:none;margin:14px 0 10px">${es ? "💬 Obtener mi app" : "💬 Get my app"}</a>`
    + (GHL_BOOKING_URL ? `<a href="${GHL_BOOKING_URL}" target="_blank" style="display:block;text-align:center;background:#fff;border:1.5px solid #E6E8EC;color:#101B30;border-radius:14px;padding:13px;font-weight:800;text-decoration:none;margin-bottom:10px">${es ? "📅 Agendar una llamada" : "📅 Schedule a call"}</a>` : "")
    + `<a href="/cercas" target="_blank" style="display:block;text-align:center;background:#fff;border:1.5px solid #E6E8EC;color:#101B30;border-radius:14px;padding:13px;font-weight:800;text-decoration:none">${es ? "Ver planes y precios" : "See plans & pricing"}</a>`;
  const L = es ? {
    title: "Mide tu cerca por satélite — gratis",
    sub: "Pon tu dirección, marca tu cerca sobre la foto satelital con nuestras herramientas y recibe tu estimado gratis.",
    st1: "Pon tu dirección", st2: "Marca tu cerca", st3: "Recibe tu estimado",
    trust: "🛰️ Cotización con satélite · 💯 Gratis · 🔒 Sin compromiso",
    addr: "Dirección de tu casa", cont: "CONTINUAR →",
    or2: "o", useLoc: "📍 Usar mi ubicación", locating: "📍 Buscando tu ubicación…",
    locErr: "No pudimos obtener tu ubicación. Mejor escribe tu dirección.", myLoc: "Mi ubicación",
    matQ: "¿Qué tipo de cerca quieres?", sizeQ: "¿Qué tan grande es tu patio?",
    sizes: [["Chico", "hasta 30 pies de frente"], ["Mediano", "30–50 pies de frente"], ["Grande", "esquina o lote amplio"]],
    who: "¿A dónde mandamos tu precio?", name: "Tu nombre", phone: "Tu teléfono (celular)",
    bizName: "Nombre de tu negocio (opcional)", bookCall: "📅 Agendar una llamada",
    see: "VER MI PRECIO →", back: "← Regresar",
    m1: "Ubicando tu propiedad por satélite…", m2: "Calculando material y mano de obra…", m3: "Preparando tu precio…",
    range: "PRECIO ESTIMADO", rangeSub: (m) => `Cerca de ${m}, instalada.`,
    scan2: "Analizando el terreno…", scan3: "Dibujando el límite de tu lote…",
    scanFound: "🛰️ ¡Encontramos tu propiedad!", scanMiss: "🏠 Encontramos tu casa — confirmamos las medidas en tu visita gratis.",
    unlockT: "¿A nombre de quién preparamos tu estimado?", unlockB: "MEDIR MI CERCA →",
    edT: "Marca tu cerca con las herramientas", edSub: "Tu lote ya está marcado en naranja y los pies se miden solos. TOCA un lado para quitarlo (ej. quita el frente si es solo patio) — tócalo otra vez para regresarlo.",
    matPick: "Elige tu material", ftOf: "pies de cerca", estB: "RECIBIR MI ESTIMADO →",
    edErr: "Deja al menos un lado de cerca prendido 🙂", chgAddr: "← Cambiar dirección",
    foundHome: "🏠 ¡Encontramos tu casa!",
    drawT: "Marca tu cerca, esquina por esquina",
    drawSub: "TOCA cada esquina de tu cerca sobre la foto — los pies se miden solos. Para cerrar el circuito, toca la primera esquina otra vez. Equivócate sin miedo: Deshacer borra el último punto.",
    drawUndo: "↩ Deshacer último punto", drawErr: "Toca al menos 2 esquinas de tu cerca 🙂",
    gateBtn: "➕ Agregar puerta", gateDone: "✓ Listo",
    gateHint: "Elige el ancho y TOCA sobre la línea de tu cerca donde va la puerta. Toca una puerta para quitarla.",
    gW4: "Sencilla 4′", gD10: "Doble 10′", gD12: "Doble 12′", gD16: "Doble 16′",
    gate1: "puerta", gateN: "puertas",
    fenceHint: "🖐 ARRASTRA para dibujar la cerca — sigue del último poste · un toque = un poste",
    addFence: "➕ Agregar cerca", modeDraw: "✏️ Dibujar",
    undoB: "↩ Deshacer", clearB: "✕ Borrar", endB: "✓ Terminar línea",
    totalLF: "PIES LINEALES", panelsL: "PANELES", postsL: "POSTES", cornersL: "esquinas",
    estTotal: "TOTAL ESTIMADO",
    disc: "Este es un precio estimado — tu precio final depende de los pies exactos y puede ser más bajo.",
    team: (b) => `Un miembro de ${b} te contacta hoy para medir gratis y darte tu precio exacto, sin compromiso.`,
    sent: "✓ Recibimos tus datos", callBtn: "📞 LLAMAR AHORA",
    phoneErr: "Pon un teléfono de 10 dígitos", addrErr: "Pon la dirección de tu casa",
    err: "Algo falló — intenta otra vez o llámanos.",
  } : {
    title: "Measure your fence by satellite — free",
    sub: "Enter your address, mark your fence on the satellite photo with our tools, and get your free estimate.",
    st1: "Enter address", st2: "Mark your fence", st3: "Get your estimate",
    trust: "🛰️ Satellite-assisted quote · 💯 Free · 🔒 No obligation",
    addr: "Your home address", cont: "CONTINUE →",
    or2: "or", useLoc: "📍 Use my location", locating: "📍 Finding your location…",
    locErr: "We couldn't get your location. Please type your address instead.", myLoc: "My location",
    matQ: "Which fence do you want?", sizeQ: "How big is your yard?",
    sizes: [["Small", "up to 30 ft of frontage"], ["Medium", "30–50 ft of frontage"], ["Large", "corner or wide lot"]],
    who: "Where do we send your price?", name: "Your name", phone: "Your phone (mobile)",
    bizName: "Your business name (optional)", bookCall: "📅 Schedule a call",
    see: "SEE MY PRICE →", back: "← Go back",
    m1: "Locating your property by satellite…", m2: "Calculating materials and labor…", m3: "Preparing your price…",
    range: "ESTIMATED PRICE", rangeSub: (m) => `${m} fence, installed.`,
    scan2: "Analyzing the terrain…", scan3: "Drawing your lot boundary…",
    scanFound: "🛰️ We found your property!", scanMiss: "🏠 We found your home — we confirm measurements at your free visit.",
    unlockT: "Who do we prepare your estimate for?", unlockB: "MEASURE MY FENCE →",
    edT: "Mark your fence with the tools", edSub: "Your lot is already outlined in orange and the feet measure themselves. TAP a side to remove it (e.g. remove the front for a backyard-only fence) — tap again to bring it back.",
    matPick: "Pick your material", ftOf: "feet of fence", estB: "GET MY ESTIMATE →",
    edErr: "Leave at least one fence side on 🙂", chgAddr: "← Change address",
    foundHome: "🏠 We found your home!",
    drawT: "Mark your fence, corner by corner",
    drawSub: "TAP each corner of your fence on the photo — the feet measure themselves. To close the loop, tap the first corner again. Mistakes are fine: Undo removes the last point.",
    drawUndo: "↩ Undo last point", drawErr: "Tap at least 2 corners of your fence 🙂",
    gateBtn: "➕ Add a gate", gateDone: "✓ Done",
    gateHint: "Pick the width and TAP on your fence line where the gate goes. Tap a gate to remove it.",
    gW4: "Walk 4′", gD10: "Double 10′", gD12: "Double 12′", gD16: "Double 16′",
    gate1: "gate", gateN: "gates",
    fenceHint: "🖐 DRAG to draw the fence — it follows from the last post · one tap = one post",
    addFence: "➕ Add fence", modeDraw: "✏️ Draw",
    undoB: "↩ Undo", clearB: "✕ Clear", endB: "✓ End line",
    totalLF: "LINEAR FEET", panelsL: "PANELS", postsL: "POSTS", cornersL: "corners",
    estTotal: "ESTIMATED TOTAL",
    disc: "This is an estimated price — your final price depends on exact footage and could be lower.",
    team: (b) => `Someone from ${b} will contact you today to measure for free and give you your exact price — no obligation.`,
    sent: "✓ We got your info", callBtn: "📞 CALL NOW",
    phoneErr: "Enter a 10-digit phone", addrErr: "Enter your home address",
    err: "Something went wrong — try again or call us.",
  };
  const MATS = es
    ? [["cedar", "🪵", "Madera (cedro)"], ["vinyl", "⬜", "Vinilo"], ["chain", "🔗", "Malla ciclónica"], ["alum", "🛡️", "Aluminio"], ["ranch", "🐎", "Rancho"], ["gate", "🚪", "Portón / otro"]]
    : [["cedar", "🪵", "Wood (cedar)"], ["vinyl", "⬜", "Vinyl"], ["chain", "🔗", "Chain link"], ["alum", "🛡️", "Aluminum"], ["ranch", "🐎", "Ranch"], ["gate", "🚪", "Gate / other"]];
  // Brand fence icon (pickets + rails) — replaces the wood-log emoji.
  const fenceIcon = (w) => `<svg width="${w}" height="${Math.round(w * 0.82)}" viewBox="0 0 32 26" style="vertical-align:-3px"><path d="M3 8l3.5-5L10 8v17H3z" fill="#F8B408"/><path d="M12.5 8L16 3l3.5 5v17h-7z" fill="#F8B408"/><path d="M22 8l3.5-5L29 8v17h-7z" fill="#F8B408"/><rect y="11.4" width="32" height="3.2" rx="1.4" fill="#101B30"/><rect y="18.4" width="32" height="3.2" rx="1.4" fill="#101B30"/></svg>`;
  const backHtml = appBack ? `<div style="padding:12px 16px 0;max-width:520px;margin:0 auto;position:relative;z-index:2"><a href="/" onclick="if(history.length>1){history.back();return false}" style="display:inline-flex;align-items:center;gap:5px;background:#fff;border:1.5px solid #E6E8EC;border-radius:999px;padding:8px 13px;font-weight:800;font-size:14px;color:#101B30;text-decoration:none;box-shadow:0 4px 14px rgba(16,27,48,.1)">‹ ${es ? "Volver a la app" : "Back to app"}</a></div>` : "";
  return `<!doctype html><html lang="${es ? "es" : "en"}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${biz}</title>
<meta property="og:title" content="${biz} — ${es ? "Mide tu cerca por satélite" : "Measure your fence by satellite"}">
<meta property="og:description" content="${es ? "Marca tu cerca sobre la foto satelital y recibe tu estimado gratis, sin compromiso." : "Mark your fence on the satellite photo and get your free estimate, no obligation."}">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@800&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;font-family:Inter,Arial,sans-serif;-webkit-tap-highlight-color:transparent}
body{margin:0;background:#F4F6FA;color:#101B30}
.wrap{max-width:520px;margin:0 auto;padding:10px 10px 26px}
@media(min-width:768px){.wrap{max-width:560px;padding-top:18px}}
.brand{display:flex;align-items:center;gap:10px;margin:4px 2px 10px}
.brand img{max-height:40px;max-width:130px;border-radius:8px}
.brand .nm{font-weight:800;font-size:17px}
.card{background:#fff;border:1.5px solid #E6E8EC;border-radius:22px;padding:0;overflow:hidden;box-shadow:0 14px 44px rgba(16,27,48,.14)}
.cardbody{padding:16px 18px 20px}
/* ── the satellite window: the instrument at the top of the card. The
   fly-in, the scan of THEIR lot and the tap-the-sides editor all happen
   HERE — one persistent screen through the whole funnel. ── */
.mapwin{position:relative;overflow:hidden;background:#04070E;height:min(52dvh,470px)}
@media(min-width:768px){.mapwin{height:420px}}
.mapwin:after{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(to bottom,rgba(4,7,14,.22),rgba(4,7,14,0) 26%,rgba(4,7,14,0) 68%,rgba(4,7,14,.42));z-index:5}
.mwgrid{position:absolute;inset:0;pointer-events:none;z-index:4;opacity:.5;background-image:linear-gradient(rgba(255,255,255,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.07) 1px,transparent 1px);background-size:64px 64px}
.hudchip{position:absolute;top:12px;right:12px;z-index:6;background:rgba(4,7,14,.55);color:#fff;font-size:9.5px;font-weight:800;letter-spacing:1.2px;padding:5px 10px;border-radius:99px;backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)}
.hudc{position:absolute;width:20px;height:20px;border:2.5px solid rgba(255,255,255,.8);z-index:6;pointer-events:none}
.hudc.a{top:10px;left:10px;border-right:none;border-bottom:none;border-radius:5px 0 0 0}
.hudc.b{top:10px;right:10px;border-left:none;border-bottom:none;border-radius:0 5px 0 0}
.hudc.c{bottom:10px;left:10px;border-right:none;border-top:none;border-radius:0 0 0 5px}
.hudc.d{bottom:10px;right:10px;border-left:none;border-top:none;border-radius:0 0 5px 0}
#mwintro{position:absolute;inset:0;transition:opacity .6s}
#mwintro.off{opacity:0;pointer-events:none}
.stars{position:absolute;inset:0;opacity:.9;background-image:
 radial-gradient(1.6px 1.6px at 12% 22%,#fff,transparent),radial-gradient(1.2px 1.2px at 32% 64%,#cfd8ff,transparent),
 radial-gradient(1.8px 1.8px at 54% 14%,#fff,transparent),radial-gradient(1.1px 1.1px at 68% 48%,#aeb9e6,transparent),
 radial-gradient(1.5px 1.5px at 82% 26%,#fff,transparent),radial-gradient(1.2px 1.2px at 24% 86%,#fff,transparent),
 radial-gradient(1.7px 1.7px at 90% 72%,#dfe6ff,transparent),radial-gradient(1.2px 1.2px at 46% 38%,#fff,transparent),
 radial-gradient(1.4px 1.4px at 74% 90%,#fff,transparent),radial-gradient(1px 1px at 6% 52%,#fff,transparent)}
.hz{position:absolute;inset:0;opacity:0;transform:scale(1.85)}
.hz img{width:100%;height:100%;object-fit:cover;display:block}
.hz1{animation:hzin 1.15s .3s cubic-bezier(.22,.7,.3,1) forwards}
.hz2{animation:hzin 1.15s 1.35s cubic-bezier(.22,.7,.3,1) forwards}
.hz3{animation:hzin 1.15s 2.4s cubic-bezier(.22,.7,.3,1) forwards}
.hz4{animation:hzin 1.3s 3.45s cubic-bezier(.22,.7,.3,1) forwards}
.hz4 img{animation:kb 46s 5s ease-in-out infinite alternate}
@keyframes hzin{0%{opacity:0;transform:scale(1.85)}30%{opacity:1}100%{opacity:1;transform:scale(1)}}
@keyframes kb{from{transform:scale(1) translate(0,0)}to{transform:scale(1.14) translate(-2%,1.5%)}}
@media(prefers-reduced-motion:reduce){.hz{animation:none!important}.hz4{opacity:1;transform:none}.hz4 img{animation:none!important}}
.mwimg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity .5s}
#mwsvg{position:absolute;inset:0;width:100%;height:100%;z-index:3}
.flowline{text-align:center;color:#475067;font-size:13px;font-weight:800;margin:0 0 14px}
h1{font-size:27px;font-weight:800;margin:0 0 6px;line-height:1.12;letter-spacing:-.01em}
.sub{color:#67718A;font-size:14px;font-weight:600;margin:0 0 16px;line-height:1.45}
.steps{display:flex;gap:8px;margin:16px 0 12px}
.steps .stp{flex:1;text-align:center;background:#F7F9FC;border:1.5px solid #EDF0F5;border-radius:13px;padding:11px 5px}
.steps .ic{font-size:21px;line-height:1}
.steps .tx{font-size:11px;font-weight:700;color:#475067;margin-top:5px;line-height:1.25}
.trust{text-align:center;color:#8A93A5;font-size:11.5px;font-weight:700;margin-top:12px}
.ordiv{display:flex;align-items:center;gap:10px;margin:12px 2px;color:#A7AEBE;font-size:12px;font-weight:700}
.ordiv:before,.ordiv:after{content:"";flex:1;height:1.5px;background:#EAEDF2}
.locbtn{width:100%;padding:14px;border:1.5px solid #E6E8EC;border-radius:12px;background:#fff;color:#101B30;font-size:15px;font-weight:800;cursor:pointer;margin-bottom:10px;animation:locGlow 2.6s ease-in-out infinite}
.locbtn:active{transform:scale(.98)}
.locbtn[disabled]{opacity:.6;animation:none}
@keyframes locGlow{0%,100%{box-shadow:0 0 0 rgba(248,180,8,0);border-color:#E6E8EC}50%{box-shadow:0 6px 22px rgba(248,180,8,.45);border-color:#F8B408}}
@media(prefers-reduced-motion:reduce){.locbtn{animation:none}}
input{width:100%;padding:14px;border:1.5px solid #E6E8EC;border-radius:12px;font-size:16px;font-weight:600;outline:none;margin-bottom:10px}
input:focus{border-color:#F8B408}
.btn{width:100%;padding:15px;border:none;border-radius:12px;background:#F8B408;color:#fff;font-size:16px;font-weight:800;cursor:pointer}
.btn:active{transform:scale(.98)}.btn[disabled]{opacity:.5}
.ghost{background:none;border:none;color:#67718A;font-weight:700;font-size:13px;cursor:pointer;padding:10px 0}
.q{font-size:17px;font-weight:800;margin:0 0 10px}
.opts{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-bottom:16px}
.opt{border:1.5px solid #E6E8EC;border-radius:13px;background:#fff;padding:13px 8px;text-align:center;font-weight:800;font-size:14px;cursor:pointer;color:#101B30}
.opt .oic{display:block;font-size:23px;margin-bottom:4px}
.opt.on{border-color:#F8B408;background:#FEF5DC;box-shadow:0 4px 14px rgba(248,180,8,.25)}
.opt small{display:block;font-weight:600;color:#8A93A5;font-size:11px;margin-top:3px}
.opts.sz{grid-template-columns:1fr 1fr 1fr}
.load{text-align:center;padding:30px 0}
.spin{width:46px;height:46px;border:5px solid #FEF5DC;border-top-color:#F8B408;border-radius:50%;margin:0 auto 14px;animation:sp 1s linear infinite}
@keyframes sp{to{transform:rotate(360deg)}}
.lmsg{font-weight:700;color:#67718A;font-size:14px}
.range{background:#101B30;border-radius:14px;padding:16px;text-align:center;margin-bottom:12px}
.range .lbl{color:#F8B408;font-size:11px;font-weight:800;letter-spacing:2px}
.range .val{color:#fff;font-size:30px;font-weight:800;margin-top:4px}
.range .rsub{color:#9DA8C4;font-size:12px;font-weight:700;margin-top:5px}
.note{color:#67718A;font-size:12px;font-weight:600;line-height:1.5}
.callbtn{display:block;text-align:center;background:#101B30;color:#fff;text-decoration:none;font-weight:800;padding:14px;border-radius:12px;margin-top:12px}
.scanline{position:absolute;left:0;right:0;height:3px;top:-4%;background:linear-gradient(90deg,rgba(248,180,8,0),#F8B408,rgba(248,180,8,0));box-shadow:0 0 18px 6px rgba(248,180,8,.5);opacity:0}
.scanline.on{opacity:1;animation:sweep 1.7s ease-in-out infinite}
@keyframes sweep{0%{top:-2%}50%{top:100%}100%{top:-2%}}
.scmsg{position:absolute;left:0;right:0;bottom:0;padding:12px;text-align:center;color:#fff;font-weight:800;font-size:13.5px;background:linear-gradient(to top,rgba(11,19,34,.85),rgba(11,19,34,0))}
@keyframes ringdraw{to{stroke-dashoffset:0}}
.ring{stroke-dasharray:6000;stroke-dashoffset:6000;animation:ringdraw 1.4s ease-out forwards}
.ftbar{background:#101B30;border-radius:13px;padding:11px 16px;display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px}
.toolrow{display:flex;gap:7px;margin-bottom:8px}
.toolrow button{flex:1;padding:10px 4px;border-radius:12px;background:#fff;font-size:13px;font-weight:800;cursor:pointer;white-space:nowrap}
.toolrow button:disabled{opacity:.45}
#addfence{border:1.5px solid #F8B408;color:#C98A00}
#gatebtn{border:1.5px solid #2E9E44;color:#1E7B33}
#drawbtn{border:1.5px solid #E6E8EC;color:#101B30}
#drawbtn.on{background:#101B30;color:#fff;border-color:#101B30}
#undobtn,#endbtn{border:1.5px solid #E6E8EC;color:#101B30}
#clearbtn{border:1.5px solid #E6E8EC;color:#E5484D}
.statpanel{background:#101B30;border-radius:16px;padding:12px 12px 10px;margin-bottom:12px}
.statshead{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:10px;padding:0 4px}
.statlbl{display:block;font-size:11px;font-weight:800;letter-spacing:2px;color:#9DA8C4}
#gateft{display:block;font-size:10px;font-weight:700;color:#7D89A6;margin-top:2px}
#gateft.hide{display:none}
.statshead>b{font-family:'Barlow Condensed',Arial,sans-serif;font-weight:800;color:#fff;font-size:46px;line-height:1}
.statshead>b small{font-size:24px;color:#9DA8C4;font-weight:800}
.stattiles{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px}
.stattiles>div{background:rgba(255,255,255,.07);border-radius:12px;padding:6px 4px;text-align:center}
.stattiles b{display:block;font-family:'Barlow Condensed',Arial,sans-serif;color:#fff;font-size:24px;font-weight:800;line-height:1.15}
.stattiles span{display:block;font-size:10px;font-weight:800;letter-spacing:.5px;color:#9DA8C4;text-transform:uppercase}
.stattiles small{display:block;font-size:10px;font-weight:600;color:#7D89A6;min-height:12px}
.totrow{display:flex;justify-content:space-between;align-items:center;background:#fff;border:1.5px solid #E6E8EC;border-radius:14px;padding:12px 14px;margin-bottom:12px}
.totrow span{font-family:'Barlow Condensed',Arial,sans-serif;font-weight:800;font-size:19px;color:#101B30;letter-spacing:.5px}
.totrow b{font-family:'Barlow Condensed',Arial,sans-serif;font-weight:800;font-size:24px;color:#F8B408}
.zbtns{position:absolute;right:12px;top:44px;z-index:6;display:none;flex-direction:column;gap:8px}
.zbtns.on{display:flex}
.zbtns button{width:38px;height:38px;border-radius:99px;border:none;background:rgba(255,255,255,.95);color:#101B30;font-size:22px;font-weight:800;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.35)}
.mapwin.edon{touch-action:none}
.gchips{display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap}
.gchips.hide{display:none}
.gchip{flex:1;padding:9px 2px;border:1.5px solid #E6E8EC;border-radius:10px;background:#fff;font-size:12.5px;font-weight:800;color:#101B30;cursor:pointer;white-space:nowrap}
.gchip.on{border-color:#2E9E44;background:#EAF7EE;color:#1E7B33}
.gdone{flex:0 0 auto;padding:9px 12px;border:1.5px solid #E6E8EC;border-radius:10px;background:#F3F5F9;font-size:12.5px;font-weight:800;cursor:pointer}
#gateinfo{text-align:center;color:#1E7B33;font-size:13px;font-weight:800;margin:-4px 0 8px}
.ftbar b{color:#fff;font-size:24px}.ftbar span{color:#9DA8C4;font-size:12px;font-weight:700}
.prods{display:flex;gap:8px;overflow-x:auto;padding-bottom:6px;margin-bottom:10px;-webkit-overflow-scrolling:touch}
.prod{min-width:96px;max-width:96px;border:1.5px solid #E6E8EC;border-radius:13px;background:#fff;padding:0 0 8px;text-align:center;font-weight:800;font-size:12px;cursor:pointer;color:#101B30;overflow:hidden;flex-shrink:0}
.prod img{width:100%;height:52px;object-fit:cover;display:block;background:#fff;margin-bottom:6px}
.prod .noimg{width:100%;height:52px;display:flex;align-items:center;justify-content:center;font-size:24px;background:#F7F9FC;margin-bottom:6px}
.prod small{display:block;font-weight:700;color:#8A93A5;font-size:10.5px;margin-top:2px}
.prod.on{border-color:#F8B408;background:#FEF5DC;box-shadow:0 4px 14px rgba(248,180,8,.25)}
.hide{display:none}
</style></head><body>${backHtml}<div class="wrap">
<div class="brand">${logo ? `<img src="${logo}" alt="">` : ""}<span class="nm">${biz}</span></div>
<div class="card">
  <div class="mapwin">
    <div id="mwintro">
      <div class="stars"></div>
      <div class="hz hz1"><img src="/api/roofimg?lat=${demoScan ? demoScan.view.lat : 26.2034}&lng=${demoScan ? demoScan.view.lng : -98.23}&zoom=5&sq=1&wide=1" alt="" loading="eager"></div>
      <div class="hz hz2"><img src="/api/roofimg?lat=${demoScan ? demoScan.view.lat : 26.2034}&lng=${demoScan ? demoScan.view.lng : -98.23}&zoom=11&sq=1&wide=1" alt="" loading="eager"></div>
      <div class="hz hz3"><img src="/api/roofimg?lat=${demoScan ? demoScan.view.lat : 26.2034}&lng=${demoScan ? demoScan.view.lng : -98.23}&zoom=15&sq=1&wide=1" alt="" loading="eager"></div>
      <div class="hz hz4"><img src="${demoScan ? demoScan.img : "/api/roofimg?lat=26.2034&lng=-98.23&zoom=18&sq=1"}" alt="" loading="eager"></div>
    </div>
    <img id="mwimg" class="mwimg" alt="">
    <div class="scanline" id="scanline"></div>
    <svg id="mwsvg" viewBox="0 0 1280 1280" preserveAspectRatio="none"></svg>
    <div class="mwgrid"></div>
    <span class="hudchip">🛰️ ${es ? "VISTA SATELITAL" : "SATELLITE VIEW"}</span>
    <div class="zbtns" id="zbtns"><button onclick="zoomBy(1)">+</button><button onclick="zoomBy(-1)">−</button></div>
    <i class="hudc a"></i><i class="hudc b"></i><i class="hudc c"></i><i class="hudc d"></i>
    <div id="scdemo" style="display:none;position:absolute;left:12px;bottom:12px;z-index:6;background:rgba(4,7,14,.55);color:#fff;font-size:9.5px;font-weight:800;letter-spacing:1px;padding:5px 10px;border-radius:99px;backdrop-filter:blur(4px)">▶ DEMO · ${es ? "así escaneamos tu casa" : "this is how we scan your home"}</div>
    <div class="scmsg" id="scmsg"></div>
  </div>
  <div class="cardbody">
  <div id="s1">
    <h1 style="font-size:24px;margin-bottom:10px">${fenceIcon(26)} ${L.title}</h1>
    <p class="flowline">📍 ${L.st1} &nbsp;→&nbsp; 🛰️ ${L.st2} &nbsp;→&nbsp; 💰 ${L.st3}</p>
    <input id="addr" placeholder="${L.addr}" autocomplete="street-address">
    <button class="btn" onclick="toS2()">${L.cont}</button>
    <div class="ordiv">${L.or2}</div>
    <button class="locbtn" id="locbtn" onclick="useLoc()">${L.useLoc}</button>
    <p class="trust">${L.trust}</p>
  </div>
  <div id="sc" class="hide">
    <div id="unlock" class="hide">
      <p class="q" id="foundlbl"></p>
      <input id="nm2" placeholder="${L.name}" autocomplete="name">
      ${slug === "alto-cercas" ? `<input id="biz2" placeholder="${L.bizName}" autocomplete="organization">` : ""}
      <input id="ph2" placeholder="${L.phone}" type="tel" autocomplete="tel">
      <button class="btn" id="unlockbtn" onclick="unlock()">${L.unlockB}</button>
      <button class="ghost" onclick="mapIdle();show('s1')">${L.chgAddr}</button>
      <p style="font-size:10.5px;color:#9AA3B2;line-height:1.55;margin:8px 4px 0">${es ? `Al enviar, aceptas recibir llamadas, SMS o WhatsApp sobre tu cotización. No vendemos tus datos. <a href="/privacidad" target="_blank" style="color:inherit">Privacidad</a>` : `By submitting, you agree to receive calls, SMS or WhatsApp about your quote. We never sell your data. <a href="/privacidad" target="_blank" style="color:inherit">Privacy</a>`}</p>
    </div>
  </div>
  <div id="ed" class="hide">
    <p class="q" style="margin-bottom:4px" id="edtitle">${L.edT}</p>
    <p class="sub" style="margin-bottom:10px" id="edsub">${L.edSub}</p>
    <div class="toolrow">
      <button id="addfence" onclick="addFence()">${L.addFence}</button>
      <button id="gatebtn" onclick="gateOpen()">${L.gateBtn}</button>
      <button id="drawbtn" onclick="modeDrawBtn()">${L.modeDraw}</button>
    </div>
    <div id="gatechips" class="gchips hide">
      <button class="gchip" data-w="4" onclick="gateMode(4)">${L.gW4}</button>
      <button class="gchip" data-w="10" onclick="gateMode(10)">${L.gD10}</button>
      <button class="gchip" data-w="12" onclick="gateMode(12)">${L.gD12}</button>
      <button class="gchip" data-w="16" onclick="gateMode(16)">${L.gD16}</button>
      <button class="gdone" onclick="gateDone()">${L.gateDone}</button>
    </div>
    <div class="toolrow">
      <button id="undobtn" onclick="undoEd()" disabled>${L.undoB}</button>
      <button id="clearbtn" onclick="clearAllEd()">${L.clearB}</button>
      <button id="endbtn" onclick="endRunBtn()" disabled>${L.endB}</button>
    </div>
    <div class="statpanel">
      <div class="statshead">
        <div><span class="statlbl">${L.totalLF}</span><span id="gateft" class="hide"></span></div>
        <b><span id="ftval">0</span><small> ft</small></b>
      </div>
      <div class="stattiles">
        <div><b id="tpanels">0</b><span>${L.panelsL}</span><small id="tpanelsub"></small></div>
        <div><b id="tposts">0</b><span>${L.postsL}</span><small id="tcorners">0 ${L.cornersL}</small></div>
        <div><b id="tgates">0</b><span>${L.gateN.toUpperCase()}</span><small id="tgatesub">—</small></div>
      </div>
    </div>
    <p class="q" style="font-size:15px">${L.matPick}</p>
    <div class="prods" id="prods"></div>
    <div class="totrow"><span>${L.estTotal}</span><b id="livetot">$0</b></div>
    <button class="btn" id="estbtn" onclick="estimate()">${L.estB}</button>
  </div>
  <div id="s2" class="hide">
    <p class="q">${L.matQ}</p>
    <div class="opts" id="mats">${MATS.map(([k, ic, nm], i) => `<button class="opt${i === 0 ? " on" : ""}" data-m="${k}" onclick="pick('mats',this)"><span class="oic">${ic}</span>${nm}</button>`).join("")}</div>
    <p class="q">${L.sizeQ}</p>
    <div class="opts sz" id="szs">${L.sizes.map(([nm, d], i) => `<button class="opt${i === 1 ? " on" : ""}" data-s="${i}" onclick="pick('szs',this)">${nm}<small>${d}</small></button>`).join("")}</div>
    <button class="btn" onclick="toS3()">${L.cont}</button>
    <button class="ghost" onclick="show('s1')">${L.back}</button>
  </div>
  <div id="s3" class="hide">
    <p class="q">${L.who}</p>
    <input id="nm" placeholder="${L.name}" autocomplete="name">
    <input id="ph" placeholder="${L.phone}" type="tel" autocomplete="tel">
    <button class="btn" id="go" onclick="send()">${L.see}</button>
    <button class="ghost" onclick="show('s2')">${L.back}</button>
    <p style="font-size:10.5px;color:#9AA3B2;line-height:1.55;margin:10px 4px 0">${es ? `Al enviar, aceptas recibir llamadas, SMS o WhatsApp sobre tu cotización. No vendemos tus datos. <a href="/privacidad" target="_blank" style="color:inherit">Privacidad</a>` : `By submitting, you agree to receive calls, SMS or WhatsApp about your quote. We never sell your data. <a href="/privacidad" target="_blank" style="color:inherit">Privacy</a>`}</p>
  </div>
  <div id="ld" class="hide"><div class="load"><div class="spin"></div><p class="lmsg" id="lmsg">${L.m1}</p></div></div>
  <div id="s4" class="hide">
    <p class="q">${L.sent}</p>
    <div class="range"><div class="lbl">${L.range}</div><div class="val" id="rng"></div><div class="rsub" id="rsub"></div></div>
    <p class="note">${L.disc}</p>
    <p class="note" style="margin-top:8px">${L.team(biz)}</p>
    ${bizPhone ? `<a class="callbtn" href="tel:+1${bizPhone}">${L.callBtn}</a>` : ""}
  </div>
  </div>
</div></div>
<script>
var RATE={cedar:28,vinyl:38,chain:18,alum:45,ranch:20,gate:30};
var gpsLat=null,gpsLng=null;
var SCAN=null,VIEW=null,SIDES=[],SIDEON=[],LEADID=null,PRODSEL=null;
var DRAW=false,RUNS=[],CUR=[],GATES=[],GMODE=0,HIST=[],EDON=false;
/* finger-sized dots on touch; slim ones under a mouse so they don't bury the map */
var FINE=false;try{FINE=matchMedia("(pointer:fine)").matches}catch(e){}
var DOT_R=FINE?"10":"16",DOT_W=FINE?"4":"6";
/* the app's construction math, inlined verbatim from src/fenceMath.js */
var FM=(function(){
${FENCE_MATH_JS}
return{distFt:distFt,runFt:runFt,realCorners:realCorners,fenceQuote:fenceQuote};
})();
var DEMOSCAN=${demoScan ? JSON.stringify(demoScan) : "null"};
var demoT=[];
var DEMO="";try{DEMO=new URLSearchParams(location.search).get("pass")||""}catch(e){}
function useLoc(){
  var btn=document.getElementById("locbtn");
  if(!navigator.geolocation){alert(${JSON.stringify(L.locErr)});return}
  btn.disabled=true;btn.textContent=${JSON.stringify(L.locating)};
  navigator.geolocation.getCurrentPosition(function(pos){
    gpsLat=pos.coords.latitude;gpsLng=pos.coords.longitude;
    document.getElementById("addr").value="📍 "+${JSON.stringify(L.myLoc)};
    btn.disabled=false;btn.textContent=${JSON.stringify(L.useLoc)};
    scan();
  },function(){
    btn.disabled=false;btn.textContent=${JSON.stringify(L.useLoc)};
    alert(${JSON.stringify(L.locErr)});
  },{enableHighAccuracy:true,timeout:10000,maximumAge:60000});
}
var MATNM=${JSON.stringify(Object.fromEntries(MATS.map(([k, , nm]) => [k, nm])))};
var LF=[100,150,250];
function show(id){["s1","sc","ed","s2","s3","ld","s4"].forEach(function(x){document.getElementById(x).className=x===id?"":"hide"})}
function pick(grp,el){var g=document.getElementById(grp);[].forEach.call(g.children,function(c){c.className="opt"});el.className="opt on"}
function val(grp,attr){var on=document.querySelector("#"+grp+" .on");return on?on.getAttribute(attr):null}
function toS2(){var a=document.getElementById("addr").value.trim();if(a.length<6){alert(${JSON.stringify(L.addrErr)});return}scan()}
function demoDone(){
  mapIdle();
  ["s1","sc","ed","s2","s3","ld","s4"].forEach(function(x){var el=document.getElementById(x);if(el)el.className="hide"});
  var d=document.getElementById("ddone");
  if(!d){
    d=document.createElement("div");d.id="ddone";
    d.innerHTML=${JSON.stringify(ddoneHtml)};
    document.querySelector(".cardbody").appendChild(d);
  }
  d.className="";
}
function toS3(){show("s3")}
/* ── the REAL satellite scan: geocode + parcel, then the boundary draws itself ── */
function mercY(la){return Math.log(Math.tan(Math.PI/4+la*Math.PI/360))}
function toPx(p){var w=256*Math.pow(2,VIEW.zoom)*2;return[(p[1]-VIEW.lng)/360*w+640,(mercY(VIEW.lat)-mercY(p[0]))/(2*Math.PI)*w+640]}
function dFt(a,b){var k=Math.PI/180,R=6378137;return Math.hypot((b[1]-a[1])*k*R*Math.cos(a[0]*k),(b[0]-a[0])*k*R)*3.28084}
function runFtOf(pts){var f=0;for(var i=1;i<pts.length;i++)f+=dFt(pts[i-1],pts[i]);return f}
function pxToLl(x,y){
  var w=256*Math.pow(2,VIEW.zoom)*2;
  var lng=VIEW.lng+(x-640)*360/w;
  var my=mercY(VIEW.lat)-(y-640)*2*Math.PI/w;
  var lat=(2*Math.atan(Math.exp(my))-Math.PI/2)*180/Math.PI;
  return[lat,lng];
}
function turnDeg(a,b,c){
  var k=Math.PI/180,cz=Math.cos(b[0]*k);
  var v1=[(b[1]-a[1])*cz,b[0]-a[0]],v2=[(c[1]-b[1])*cz,c[0]-b[0]];
  var m1=Math.hypot(v1[0],v1[1]),m2=Math.hypot(v2[0],v2[1]);
  if(!m1||!m2)return 0;
  return Math.acos(Math.max(-1,Math.min(1,(v1[0]*v2[0]+v1[1]*v2[1])/(m1*m2))))*180/Math.PI;
}
function svgEl(tag,at){var e=document.createElementNS("http://www.w3.org/2000/svg",tag);for(var k in at)e.setAttribute(k,at[k]);return e}
function ringDraw(parcel){
  var sv=document.getElementById("mwsvg"),pts=parcel.map(toPx).map(function(p){return p[0].toFixed(0)+","+p[1].toFixed(0)}).join(" ");
  sv.appendChild(svgEl("polygon",{points:pts,fill:"rgba(229,72,77,.10)",stroke:"#fff","stroke-width":"12","stroke-linejoin":"round",opacity:".85"}));
  sv.appendChild(svgEl("polygon",{points:pts,fill:"none",stroke:"#E5484D","stroke-width":"6","stroke-linejoin":"round",class:"ring"}));
  parcel.forEach(function(p){var c=toPx(p);sv.appendChild(svgEl("circle",{cx:c[0].toFixed(0),cy:c[1].toFixed(0),r:"10",fill:"#E5484D",stroke:"#fff","stroke-width":"4"}))});
}
/* idle = a REAL scan of the demo house, on a loop: the visitor watches
   exactly what will happen to their own address */
function demoPlay(){
  if(!DEMOSCAN)return;
  VIEW=DEMOSCAN.view;
  var im=document.getElementById("mwimg");
  im.src=DEMOSCAN.img;im.onload=function(){im.style.opacity="1"};
  document.getElementById("mwintro").className="off";
  document.getElementById("scdemo").style.display="block";
  document.getElementById("mwsvg").innerHTML="";
  document.getElementById("scanline").className="scanline on";
  demoT.push(setTimeout(function(){
    if(!DEMOSCAN)return;
    document.getElementById("scanline").className="scanline";
    ringDraw(DEMOSCAN.parcel);
    demoT.push(setTimeout(demoPlay,8000));
  },2000));
}
if(DEMOSCAN)demoT.push(setTimeout(demoPlay,4800));
function stopDemo(){DEMOSCAN=null;demoT.forEach(clearTimeout);demoT=[];document.getElementById("scdemo").style.display="none"}
function mapIdle(){
  document.getElementById("mwintro").className="";
  document.getElementById("mwimg").style.opacity="0";
  document.getElementById("mwsvg").innerHTML="";
  document.getElementById("scanline").className="scanline";
  document.getElementById("scmsg").textContent="";
}
function scan(){
  stopDemo();
  var a=document.getElementById("addr").value.trim();
  show("sc");
  document.getElementById("unlock").className="hide";
  document.getElementById("mwsvg").innerHTML="";
  document.getElementById("mwintro").className="off";
  document.getElementById("scanline").className="scanline on";
  var msgs=[${JSON.stringify(L.m1)},${JSON.stringify(L.scan2)},${JSON.stringify(L.scan3)}],mi=0;
  var sm=document.getElementById("scmsg");sm.textContent=msgs[0];
  var tick=setInterval(function(){if(mi<msgs.length-1)sm.textContent=msgs[++mi]},1100);
  fetch("/api/widget/fence-scan",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
    slug:${JSON.stringify(slug)},address:a,lat:gpsLat,lng:gpsLng,demo:DEMO
  })}).then(function(r){return r.json().catch(function(){return{}})}).then(function(j){
    if(!j.ok){clearInterval(tick);if(j&&j.error==="demo_done"){demoDone();return}mapIdle();show("s2");return}
    SCAN=j;VIEW=j.view;LEADID=null;
    var im=document.getElementById("mwimg");
    im.src=j.img;im.onload=function(){im.style.opacity="1"};
    setTimeout(function(){
      clearInterval(tick);
      document.getElementById("scanline").className="scanline";
      var found=j.parcel&&j.parcel.length>=3;
      if(found){
        ringDraw(j.parcel);
        sm.textContent="";
        document.getElementById("foundlbl").textContent=${JSON.stringify(L.scanFound)};
        document.getElementById("unlock").className="";
      }else{
        sm.textContent="";
        document.getElementById("foundlbl").textContent=${JSON.stringify(L.foundHome)};
        document.getElementById("unlock").className="";
      }
    },1800);
  }).catch(function(){clearInterval(tick);mapIdle();show("s2")});
}
/* the reveal is free — the interactive picker costs a name + phone */
function unlock(){
  var nm=document.getElementById("nm2").value.trim();
  var ph=document.getElementById("ph2").value.replace(/\\D/g,"");
  var bizEl=document.getElementById("biz2"),biz=bizEl?bizEl.value.trim():"";
  if(ph.length<10||ph.length>11){alert(${JSON.stringify(L.phoneErr)});return}
  var btn=document.getElementById("unlockbtn");btn.disabled=true;
  var openEd=function(){initTool();show("ed")};
  if(DEMO){btn.disabled=false;openEd();return}
  fetch("/api/widget/lead",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
    slug:${JSON.stringify(slug)},name:nm,phone:ph,address:SCAN.addr,
    info:{trade:"fence",scanned:!!(SCAN&&SCAN.parcel),drawn:!(SCAN&&SCAN.parcel),lat:SCAN.lat,lng:SCAN.lng,biz:biz}
  })}).then(function(r){return r.json()}).then(function(j){
    btn.disabled=false;
    if(!j.ok){alert(${JSON.stringify(L.err)});return}
    LEADID=j.id;
    try{if(window.parent!==window)parent.postMessage({alto:"lead",src:"fence-scan",phone:ph,name:nm},"*")}catch(e){}
    // The shared demo persona (alto-cercas) is a SALES tool: every prospect
    // who tries it becomes a sales lead too, in the SAME inbox as the quiz —
    // its GHL webhook already forwards to setters, so nobody who tries the
    // landing demo goes unfollowed just because they didn't WhatsApp us.
    if(${JSON.stringify(slug === "alto-cercas")}){
      fetch("/api/widget/lead",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
        slug:"alto-ventas",name:nm,phone:ph,address:SCAN.addr,info:{src:"trial-app",trade:"fence",biz:biz}
      })}).catch(function(){});
    }
    openEd();
  }).catch(function(){btn.disabled=false;alert(${JSON.stringify(L.err)})});
}
/* logical sides: split the ring at real corners (≥45°) so a curved frontage
 * stays ONE tappable side, exactly like the contractor's app */
function buildSides(P){
  var n=P.length,corners=[],i;
  for(i=0;i<n;i++){if(turnDeg(P[(i-1+n)%n],P[i],P[(i+1)%n])>=45)corners.push(i)}
  if(corners.length<2){SIDES=[{pts:P.concat([P[0]])}]}
  else{SIDES=corners.map(function(ci,k){
    var e=corners[(k+1)%corners.length],pts=[P[ci]],j=ci;
    do{j=(j+1)%n;pts.push(P[j])}while(j!==e&&pts.length<=n);
    return{pts:pts};
  })}
  SIDES.forEach(function(s){s.ft=0;for(var k=1;k<s.pts.length;k++)s.ft+=dFt(s.pts[k-1],s.pts[k])});
  SIDEON=SIDES.map(function(){return true});
}
function prodNow(){
  var ps=(SCAN&&SCAN.products)||[];
  for(var i=0;i<ps.length;i++)if(ps[i].id===PRODSEL)return ps[i];
  return ps[0]||{name:"",price:28};
}
/* what gets measured: draw mode = the drawn runs (+ the growing line);
   sides mode = contiguous ON sides merged into chains (all on = closed ring)
   so FM.fenceQuote counts posts exactly like the app */
function runList(){
  if(DRAW){
    var rs=RUNS.map(function(r){return{pts:r.pts,closed:r.closed}});
    if(CUR.length>=2)rs.push({pts:CUR,closed:false});
    return rs;
  }
  var n=SIDES.length,rs2=[],i;
  if(!n||!SCAN||!SCAN.parcel)return rs2;
  var all=true;
  for(i=0;i<n;i++)if(!SIDEON[i])all=false;
  if(all)return[{pts:SCAN.parcel,closed:true}];
  var i0=0;while(i0<n&&SIDEON[i0])i0++;
  var chain=null;
  for(var k=1;k<=n;k++){
    i=(i0+k)%n;
    if(SIDEON[i]){
      if(chain)chain=chain.concat(SIDES[i].pts.slice(1));
      else chain=SIDES[i].pts.slice();
    }else if(chain){rs2.push({pts:chain,closed:false});chain=null}
  }
  if(chain)rs2.push({pts:chain,closed:false});
  return rs2;
}
function segsOf(runs){
  var segs=[];
  runs.forEach(function(r,ri){
    var q=r.closed?r.pts.concat([r.pts[0]]):r.pts;
    for(var k=1;k<q.length;k++)segs.push({a:q[k-1],b:q[k],run:ri});
  });
  return segs;
}
function gateGeom(g,runs){
  var best=null,c=toPx(g.c);
  segsOf(runs||runList()).forEach(function(sg){
    var a=toPx(sg.a),b=toPx(sg.b);
    var vx=b[0]-a[0],vy=b[1]-a[1],l2=vx*vx+vy*vy;if(!l2)return;
    var t=Math.max(0,Math.min(1,((c[0]-a[0])*vx+(c[1]-a[1])*vy)/l2));
    var d=Math.hypot(a[0]+t*vx-c[0],a[1]+t*vy-c[1]);
    if(!best||d<best.d)best={d:d,t:t,sg:sg};
  });
  if(!best||best.d>150)return null;
  var ln=dFt(best.sg.a,best.sg.b);if(ln<2)return null;
  var half=(g.w/2)/ln,t0=Math.max(0,best.t-half),t1=Math.min(1,best.t+half);
  var lp=function(t){return[best.sg.a[0]+(best.sg.b[0]-best.sg.a[0])*t,best.sg.a[1]+(best.sg.b[1]-best.sg.a[1])*t]};
  return{a:lp(t0),b:lp(t1),run:best.sg.run};
}
function quoteNow(){
  var runs=runList(),gl=[];
  // a gate whose line went away DETACHES (hidden, not counted) instead of
  // dying — switch modes or undo and it re-snaps, exactly like the app
  GATES.forEach(function(g){
    var gg=gateGeom(g,runs);
    g.on=!!gg;
    if(gg)gl.push({kind:g.w<=6?"walk":"double",widthFt:g.w,price:0,runIdx:gg.run});
  });
  return FM.fenceQuote({runs:runs,gates:gl,product:{lfPrice:prodNow().price,panelW:8,walkGatePrice:0,dblGatePrice:0},markupPct:0});
}
function gatesOn(){return GATES.filter(function(g){return g.on!==false})}
function updateFt(){
  var q=quoteNow(),p=prodNow();
  document.getElementById("ftval").textContent=q.netFt.toLocaleString();
  var gf=document.getElementById("gateft");
  if(q.gateFt>0){gf.className="";gf.textContent="−"+q.gateFt+" ft "+${JSON.stringify(L.gateN)}}
  else gf.className="hide";
  document.getElementById("tpanels").textContent=q.panels;
  document.getElementById("tpanelsub").textContent=String(p.name||"").slice(0,16)+" · 8 ft";
  document.getElementById("tposts").textContent=q.postsTotal;
  document.getElementById("tcorners").textContent=q.corners+" "+${JSON.stringify(L.cornersL)};
  var ga=gatesOn();
  document.getElementById("tgates").textContent=ga.length;
  var gw=0;ga.forEach(function(g){gw+=g.w});
  document.getElementById("tgatesub").textContent=ga.length?Math.round(gw)+" ft":"—";
  var lo=Math.round(q.netFt*p.price*0.9/50)*50,hi=Math.round(q.netFt*p.price*1.2/50)*50;
  document.getElementById("livetot").textContent=q.netFt>0?"$"+lo.toLocaleString()+" – $"+hi.toLocaleString():"$0";
  return q.netFt;
}
/* history: one snapshot before every mutation, exactly like the app */
function pushHist(){
  HIST=HIST.slice(-39);
  HIST.push(JSON.stringify({r:RUNS,c:CUR,g:GATES,s:SIDEON}));
  document.getElementById("undobtn").disabled=false;
}
function undoEd(){
  if(!HIST.length)return;
  var h=JSON.parse(HIST.pop());
  RUNS=h.r;CUR=h.c;GATES=h.g;SIDEON=h.s||SIDEON;
  document.getElementById("undobtn").disabled=!HIST.length;
  document.getElementById("endbtn").disabled=!(DRAW&&CUR.length>=2);
  redrawAll();updateFt();
}
function clearAllEd(){
  pushHist();
  RUNS=[];CUR=[];GATES=[];
  if(!DRAW)SIDEON=SIDES.map(function(){return true});
  document.getElementById("endbtn").disabled=true;
  redrawAll();updateFt();
}
function endRunBtn(){
  if(CUR.length<2)return;
  pushHist();
  RUNS.push({pts:CUR,closed:false});CUR=[];
  document.getElementById("endbtn").disabled=true;
  drawRedraw();updateFt();
}
function addFence(){
  pushHist();
  if(!DRAW)setMode(true,true);
  RUNS.push({pts:[pxToLl(480,640),pxToLl(800,640)],closed:false});
  drawRedraw();updateFt();
}
function setMode(draw,keep){
  DRAW=draw;
  if(!keep)CUR=[];
  document.getElementById("edtitle").textContent=draw?${JSON.stringify(L.drawT)}:${JSON.stringify(L.edT)};
  if(!GMODE)document.getElementById("edsub").textContent=draw?${JSON.stringify(L.fenceHint)}:${JSON.stringify(L.edSub)};
  document.getElementById("drawbtn").className=draw?"on":"";
  document.getElementById("endbtn").disabled=!(draw&&CUR.length>=2);
  redrawAll();updateFt();
}
function modeDrawBtn(){
  var hasP=SCAN&&SCAN.parcel&&SCAN.parcel.length>=3;
  if(DRAW&&hasP)setMode(false);
  else setMode(true);
}
function initTool(){
  EDON=true;HIST=[];RUNS=[];CUR=[];GATES=[];GMODE=0;
  document.getElementById("undobtn").disabled=true;
  document.getElementById("zbtns").className="zbtns on";
  document.querySelector(".mapwin").className="mapwin edon";
  gateDone();
  buildProds();
  var hasP=SCAN&&SCAN.parcel&&SCAN.parcel.length>=3;
  if(hasP)buildSides(SCAN.parcel);
  setMode(!hasP);
}
function zoomBy(dz){
  if(!VIEW)return;
  var z=Math.max(15,Math.min(21,(VIEW.zoom||19)+dz));
  if(z===VIEW.zoom)return;
  VIEW={lat:VIEW.lat,lng:VIEW.lng,zoom:z};
  document.getElementById("mwimg").src="/api/roofimg?lat="+VIEW.lat+"&lng="+VIEW.lng+"&zoom="+z+"&sq=1";
  redrawAll();
  if(EDON)updateFt();
}
/* gate mode sits on top of either mode */
function gateMode(w){
  GMODE=w;
  [].forEach.call(document.querySelectorAll("#gatechips .gchip"),function(c){c.className="gchip"+(+c.getAttribute("data-w")===w?" on":"")});
  document.getElementById("edsub").textContent=${JSON.stringify(L.gateHint)};
}
function gateOpen(){
  document.getElementById("gatebtn").className="hide";
  document.getElementById("gatechips").className="gchips";
  gateMode(4);
}
function gateDone(){
  GMODE=0;
  document.getElementById("gatechips").className="gchips hide";
  document.getElementById("gatebtn").className="";
  document.getElementById("edsub").textContent=DRAW?${JSON.stringify(L.fenceHint)}:${JSON.stringify(L.edSub)};
}
function gatesDraw(){
  var gl=document.getElementById("gatelayer");if(!gl)return;gl.innerHTML="";
  GATES.forEach(function(g){
    var gg=gateGeom(g);if(!gg)return;
    var a=toPx(gg.a),b=toPx(gg.b),mx=(a[0]+b[0])/2,my=(a[1]+b[1])/2;
    gl.appendChild(svgEl("line",{x1:a[0].toFixed(0),y1:a[1].toFixed(0),x2:b[0].toFixed(0),y2:b[1].toFixed(0),stroke:"#fff","stroke-width":"16","stroke-linecap":"round",opacity:".9"}));
    gl.appendChild(svgEl("line",{x1:a[0].toFixed(0),y1:a[1].toFixed(0),x2:b[0].toFixed(0),y2:b[1].toFixed(0),stroke:"#2E9E44","stroke-width":"10","stroke-linecap":"round"}));
    [a,b].forEach(function(e){gl.appendChild(svgEl("circle",{cx:e[0].toFixed(0),cy:e[1].toFixed(0),r:DOT_R,fill:"#fff",stroke:"#2E9E44","stroke-width":DOT_W}))});
    var tx=svgEl("text",{x:mx.toFixed(0),y:(my-26).toFixed(0),"text-anchor":"middle","font-size":"40","font-weight":"800",fill:"#2E9E44",stroke:"#fff","stroke-width":"9","paint-order":"stroke","font-family":"'Barlow Condensed',Arial,sans-serif"});
    tx.textContent="🚪 "+Math.round(g.w)+"′";
    gl.appendChild(tx);
  });
}
function redrawAll(){if(DRAW)drawRedraw();else sidesDraw()}
/* sides mode (parcel found): the ring split into tappable logical sides */
function styleSide(i){
  var on=SIDEON[i],s=SIDES[i];
  if(!s.vis)return;
  s.vis.setAttribute("stroke",on?"#F8B408":"rgba(255,255,255,.45)");
  s.vis.setAttribute("stroke-width",on?"9":"5");
  s.vis.setAttribute("stroke-dasharray",on?"none":"14 12");
  s.lbl.setAttribute("opacity",on?"1":".35");
}
function toggleSide(i){pushHist();SIDEON[i]=!SIDEON[i];styleSide(i);updateFt();gatesDraw()}
function sidesDraw(){
  var sv=document.getElementById("mwsvg");sv.innerHTML="";
  if(!SCAN||!SCAN.parcel){sv.appendChild(svgEl("g",{id:"gatelayer"}));gatesDraw();return}
  var pts=SCAN.parcel.map(toPx).map(function(p){return p[0].toFixed(0)+","+p[1].toFixed(0)}).join(" ");
  sv.appendChild(svgEl("polygon",{points:pts,fill:"none",stroke:"#E5484D","stroke-width":"4","stroke-dasharray":"14 10",opacity:".9"}));
  SIDES.forEach(function(s,i){
    var px=s.pts.map(toPx),str=px.map(function(p){return p[0].toFixed(0)+","+p[1].toFixed(0)}).join(" ");
    var halo=svgEl("polyline",{points:str,fill:"none",stroke:"#fff","stroke-width":"14","stroke-linecap":"round",opacity:".75"});
    var vis=svgEl("polyline",{points:str,fill:"none","stroke-linecap":"round"});
    var hit=svgEl("polyline",{points:str,fill:"none",stroke:"rgba(0,0,0,0)","stroke-width":"70",style:"cursor:pointer;pointer-events:stroke"});
    hit.addEventListener("click",function(){if(!GMODE)toggleSide(i)});
    var mid=px[Math.floor(px.length/2)];
    var lbl=svgEl("text",{x:mid[0].toFixed(0),y:(mid[1]-16).toFixed(0),"text-anchor":"middle","font-size":"46","font-weight":"800",fill:"#101B30",stroke:"#fff","stroke-width":"10","paint-order":"stroke","font-family":"'Barlow Condensed',Arial,sans-serif",style:"pointer-events:none"});
    lbl.textContent=Math.round(s.ft)+"′";
    s.vis=vis;s.lbl=lbl;
    sv.appendChild(halo);sv.appendChild(vis);sv.appendChild(lbl);sv.appendChild(hit);
    styleSide(i);
  });
  sv.appendChild(svgEl("g",{id:"gatelayer"}));
  gatesDraw();
}
function buildProds(){
  var pr=document.getElementById("prods");pr.innerHTML="";
  (SCAN.products||[]).forEach(function(p,i){
    var b=document.createElement("button");
    b.className="prod"+(i===0?" on":"");
    if(i===0)PRODSEL=p.id;
    b.innerHTML=(p.img?'<img src="'+p.img.replace(/"/g,"")+'" alt="" onerror="this.outerHTML=\\'<span class=noimg>🪵</span>\\'">':'<span class="noimg">🪵</span>')
      +'<span>'+String(p.name).replace(/[<>&]/g,"")+'</span><small>$'+p.price+'/ft</small>';
    b.onclick=function(){[].forEach.call(pr.children,function(c){c.className="prod"});b.className="prod on";PRODSEL=p.id;if(EDON)updateFt()};
    pr.appendChild(b);
  });
}
/* draw mode: runs render exactly like the app (halo 9 / orange 5, r16 posts,
   per-segment ft labels, dashed while the line is still growing) */
function drawOneRun(sv,pts,closed,cur){
  var P=closed&&pts.length>2?pts.concat([pts[0]]):pts;
  if(P.length>=2){
    var str=P.map(toPx).map(function(p){return p[0].toFixed(0)+","+p[1].toFixed(0)}).join(" ");
    sv.appendChild(svgEl("polyline",{points:str,fill:"none",stroke:"#fff","stroke-width":"9","stroke-linecap":"round","stroke-linejoin":"round",opacity:".85"}));
    sv.appendChild(svgEl("polyline",{points:str,fill:"none",stroke:"#F8B408","stroke-width":"5","stroke-linecap":"round","stroke-linejoin":"round","stroke-dasharray":cur?"16 10":"none"}));
  }
  pts.forEach(function(p,i){
    var c=toPx(p);
    if(cur&&i===0&&pts.length>=3){
      var pulse=svgEl("circle",{cx:c[0].toFixed(0),cy:c[1].toFixed(0),r:DOT_R,fill:"none",stroke:"#fff","stroke-width":"4",opacity:".8"});
      pulse.appendChild(svgEl("animate",{attributeName:"r",values:FINE?"10;20;10":"16;28;16",dur:"1.6s",repeatCount:"indefinite"}));
      pulse.appendChild(svgEl("animate",{attributeName:"opacity",values:".8;0;.8",dur:"1.6s",repeatCount:"indefinite"}));
      sv.appendChild(pulse);
    }
    sv.appendChild(svgEl("circle",{cx:c[0].toFixed(0),cy:c[1].toFixed(0),r:DOT_R,fill:"#fff",stroke:"#F8B408","stroke-width":DOT_W}));
  });
  for(var i=1;i<P.length;i++){
    var ft=dFt(P[i-1],P[i]);
    var a=toPx(P[i-1]),b=toPx(P[i]);
    var sl=Math.hypot(b[0]-a[0],b[1]-a[1]);
    if(ft<3||sl<55)continue;
    var nx=-(b[1]-a[1])/sl,ny=(b[0]-a[0])/sl;
    var tx=svgEl("text",{x:((a[0]+b[0])/2+nx*40).toFixed(0),y:((a[1]+b[1])/2+ny*40+14).toFixed(0),"text-anchor":"middle","font-size":"46","font-weight":"800",fill:"#101B30",stroke:"#fff","stroke-width":"10","paint-order":"stroke","font-family":"'Barlow Condensed',Arial,sans-serif"});
    tx.textContent=Math.round(ft)+"′";
    sv.appendChild(tx);
  }
}
function drawRedraw(){
  var sv=document.getElementById("mwsvg");sv.innerHTML="";
  if(SCAN&&SCAN.parcel&&SCAN.parcel.length>=3){
    var rp=SCAN.parcel.map(toPx).map(function(p){return p[0].toFixed(0)+","+p[1].toFixed(0)}).join(" ");
    sv.appendChild(svgEl("polygon",{points:rp,fill:"none",stroke:"#E5484D","stroke-width":"4","stroke-dasharray":"14 10",opacity:".55"}));
  }
  RUNS.forEach(function(r){drawOneRun(sv,r.pts,r.closed,false)});
  if(CUR.length)drawOneRun(sv,CUR,false,true);
  sv.appendChild(svgEl("g",{id:"gatelayer"}));
  gatesDraw();
}
/* offset crosshair, app-style: the point lands ABOVE the finger */
function crossDraw(x,y,pt,ft){
  var sv=document.getElementById("mwsvg");
  var old=document.getElementById("ptrx");if(old)old.remove();
  var g=svgEl("g",{id:"ptrx","pointer-events":"none"});
  var c=toPx(pt);
  g.appendChild(svgEl("line",{x1:x.toFixed(0),y1:y.toFixed(0),x2:c[0].toFixed(0),y2:c[1].toFixed(0),stroke:"#fff","stroke-width":"3",opacity:".65"}));
  g.appendChild(svgEl("circle",{cx:c[0].toFixed(0),cy:c[1].toFixed(0),r:"30",fill:"none",stroke:"#fff","stroke-width":"5",opacity:".95"}));
  g.appendChild(svgEl("circle",{cx:c[0].toFixed(0),cy:c[1].toFixed(0),r:"5",fill:"#fff"}));
  [[-46,0,-32,0],[46,0,32,0],[0,-46,0,-32],[0,46,0,32]].forEach(function(l){
    g.appendChild(svgEl("line",{x1:(c[0]+l[0]).toFixed(0),y1:(c[1]+l[1]).toFixed(0),x2:(c[0]+l[2]).toFixed(0),y2:(c[1]+l[3]).toFixed(0),stroke:"#fff","stroke-width":"5"}));
  });
  if(ft!=null){
    var t=svgEl("text",{x:c[0].toFixed(0),y:(c[1]-58).toFixed(0),"text-anchor":"middle","font-size":"52","font-weight":"800",fill:"#fff",stroke:"#101B30","stroke-width":"10","paint-order":"stroke","font-family":"'Barlow Condensed',Arial,sans-serif"});
    t.textContent=Math.round(ft)+"′";
    g.appendChild(t);
  }
  sv.appendChild(g);
}
function crossHide(){var g=document.getElementById("ptrx");if(g)g.remove()}
function snapParcel(x,y,pt){
  if(!SCAN||!SCAN.parcel)return pt;
  for(var i=0;i<SCAN.parcel.length;i++){var v=toPx(SCAN.parcel[i]);if(Math.hypot(v[0]-x,v[1]-y)<45)return SCAN.parcel[i]}
  return pt;
}
function hitPost(x,y){
  var hit=null;
  var chk=function(pts,set,i){pts.forEach(function(p,pi){var v=toPx(p);if(!hit&&Math.hypot(v[0]-x,v[1]-y)<60)hit={set:set,i:i,pi:pi}})};
  RUNS.forEach(function(r,i){chk(r.pts,"runs",i)});
  chk(CUR,"cur",-1);
  return hit;
}
function hitLine(x,y){
  var hit=null;
  var chk=function(pts,closed,set,i){
    var q=closed?pts.concat([pts[0]]):pts;
    for(var k=1;k<q.length&&!hit;k++){
      var A=toPx(q[k-1]),B=toPx(q[k]);
      var dx=B[0]-A[0],dy=B[1]-A[1],l2=dx*dx+dy*dy||1;
      var t=Math.max(0,Math.min(1,((x-A[0])*dx+(y-A[1])*dy)/l2));
      if(Math.hypot(x-(A[0]+t*dx),y-(A[1]+t*dy))<45)hit={set:set,i:i};
    }
  };
  RUNS.forEach(function(r,i){chk(r.pts,r.closed,"runs",i)});
  if(!hit&&CUR.length>=2)chk(CUR,false,"cur",-1);
  return hit;
}
/* one pointer engine: drag draws (or moves a post / a whole line), a still
   tap drops ONE post, tapping the first post closes the loop, gate mode
   places/removes gates. Same gestures as the app. */
var PTR=null;
function evPt(e){
  var r=document.querySelector(".mapwin").getBoundingClientRect();
  return{x:(e.clientX-r.left)/r.width*1280,y:(e.clientY-r.top)/r.height*1280,r:r};
}
document.addEventListener("DOMContentLoaded",function(){
  var mw=document.querySelector(".mapwin");
  mw.addEventListener("pointerdown",function(e){
    if(!EDON)return;
    if(e.target&&e.target.closest&&e.target.closest("button"))return;
    var p=evPt(e),drag=null;
    if(!GMODE&&DRAW){
      var hp=hitPost(p.x,p.y);
      if(hp)drag={kind:"pt",set:hp.set,i:hp.i,pi:hp.pi};
      if(!drag){
        var hl=hitLine(p.x,p.y);
        if(hl)drag={kind:"line",set:hl.set,i:hl.i,ox:p.x,oy:p.y,orig:JSON.stringify(hl.set==="cur"?CUR:RUNS[hl.i].pts)};
      }
      if(!drag)drag={kind:"draw"};
    }
    PTR={sx:e.clientX,sy:e.clientY,px:p,moved:false,drag:drag,pushed:false,started:false};
  });
  mw.addEventListener("pointermove",function(e){
    if(!PTR||!PTR.drag)return;
    if(Math.abs(e.clientX-PTR.sx)>6||Math.abs(e.clientY-PTR.sy)>6)PTR.moved=true;
    if(!PTR.moved)return;
    e.preventDefault();
    if(!PTR.pushed){pushHist();PTR.pushed=true}
    var p=evPt(e),d=PTR.drag;
    var py=p.y-((e.pointerType==="mouse"?0:70)/p.r.height)*1280;
    if(d.kind==="draw"){
      var pt=snapParcel(p.x,py,pxToLl(p.x,py));
      if(!PTR.started){
        PTR.started=true;
        if(CUR.length)CUR=CUR.concat([pt]);
        else CUR=[snapParcel(PTR.px.x,PTR.px.y,pxToLl(PTR.px.x,PTR.px.y)),pt];
      }else CUR[CUR.length-1]=pt;
      document.getElementById("endbtn").disabled=false;
      drawRedraw();crossDraw(p.x,p.y,pt,FM.runFt(CUR));updateFt();
    }else if(d.kind==="pt"){
      var pt2=snapParcel(p.x,py,pxToLl(p.x,py));
      if(d.set==="cur")CUR[d.pi]=pt2;else RUNS[d.i].pts[d.pi]=pt2;
      drawRedraw();crossDraw(p.x,p.y,pt2,null);updateFt();
    }else if(d.kind==="line"){
      var a0=pxToLl(d.ox,d.oy),a1=pxToLl(p.x,p.y);
      var dl=a1[0]-a0[0],dg=a1[1]-a0[1];
      var src=JSON.parse(d.orig).map(function(q2){return[q2[0]+dl,q2[1]+dg]});
      if(d.set==="cur")CUR=src;else RUNS[d.i].pts=src;
      drawRedraw();updateFt();
    }
  });
  var up=function(){
    if(!PTR)return;
    var start=PTR;PTR=null;crossHide();
    if(!EDON||start.moved)return;
    var p=start.px;
    if(GMODE){
      for(var i=0;i<GATES.length;i++){
        var gg=gateGeom(GATES[i]);if(!gg)continue;
        var a=toPx(gg.a),b=toPx(gg.b);
        if(Math.hypot((a[0]+b[0])/2-p.x,(a[1]+b[1])/2-p.y)<70){pushHist();GATES.splice(i,1);redrawAll();updateFt();return}
      }
      var g={c:pxToLl(p.x,p.y),w:GMODE};
      if(gateGeom(g)){pushHist();GATES.push(g)}
      redrawAll();updateFt();
      return;
    }
    if(!DRAW)return;
    if(CUR.length>=3){
      var f=toPx(CUR[0]);
      if(Math.hypot(f[0]-p.x,f[1]-p.y)<55){pushHist();RUNS.push({pts:CUR,closed:true});CUR=[];document.getElementById("endbtn").disabled=true;drawRedraw();updateFt();return}
    }
    pushHist();
    CUR=CUR.concat([snapParcel(p.x,p.y,pxToLl(p.x,p.y))]);
    document.getElementById("endbtn").disabled=!(CUR.length>=2);
    drawRedraw();updateFt();
  };
  mw.addEventListener("pointerup",up);
  mw.addEventListener("pointercancel",function(){PTR=null;crossHide()});
});
/* server recomputes the range from the contractor's real price and attaches
 * it to the lead saved at the unlock step */
function estimate(){
  var ft=updateFt();
  if(ft<10){alert(DRAW?${JSON.stringify(L.drawErr)}:${JSON.stringify(L.edErr)});return}
  var p=(SCAN.products||[]).filter(function(x){return x.id===PRODSEL})[0]||(SCAN.products||[])[0]||{name:"",price:28};
  var btn=document.getElementById("estbtn");btn.disabled=true;
  show("ld");
  var msgs=[${JSON.stringify(L.m2)},${JSON.stringify(L.m3)}],mi=0;
  document.getElementById("lmsg").textContent=msgs[0];
  var tick=setInterval(function(){if(mi<msgs.length-1)document.getElementById("lmsg").textContent=msgs[++mi]},900);
  fetch("/api/widget/fence-estimate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
    slug:${JSON.stringify(slug)},leadId:LEADID,prodId:PRODSEL,netFt:ft,gates:gatesOn().length
  })}).then(function(r){return r.json()}).then(function(j){
    clearInterval(tick);btn.disabled=false;
    if(!j.ok){alert(${JSON.stringify(L.err)});show("ed");return}
    document.getElementById("rng").textContent="$"+j.low.toLocaleString()+" – $"+j.high.toLocaleString();
    document.getElementById("rsub").textContent=${JSON.stringify(L.rangeSub("~"))}.replace("~",j.material||p.name);
    setTimeout(function(){EDON=false;document.getElementById("zbtns").className="zbtns";document.querySelector(".mapwin").className="mapwin";crossHide();show("s4")},1000);
  }).catch(function(){clearInterval(tick);btn.disabled=false;alert(${JSON.stringify(L.err)});show("ed")});
}
function send(){
  var nm=document.getElementById("nm").value.trim();
  var ph=document.getElementById("ph").value.replace(/\\D/g,"");
  if(ph.length<10||ph.length>11){alert(${JSON.stringify(L.phoneErr)});return}
  var m=val("mats","data-m")||"cedar",sz=parseInt(val("szs","data-s")||"1",10);
  var lf=LF[sz]||150,rate=RATE[m]||28;
  var low=Math.round(lf*rate*0.9/100)*100,high=Math.round(lf*rate*1.25/100)*100;
  document.getElementById("go").disabled=true;
  show("ld");
  var msgs=[${JSON.stringify(L.m2)},${JSON.stringify(L.m3)}],mi=0;
  var tick=setInterval(function(){if(mi<msgs.length)document.getElementById("lmsg").textContent=msgs[mi++]},900);
  fetch("/api/widget/lead",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
    slug:${JSON.stringify(slug)},name:nm,phone:ph,address:document.getElementById("addr").value.trim(),
    info:{trade:"fence",material:MATNM[m]||m,yard:sz===0?"chico":sz===2?"grande":"mediano",low:low,high:high,lat:gpsLat,lng:gpsLng}
  })}).then(function(r){return r.json()}).then(function(j){
    clearInterval(tick);
    if(!j.ok){alert(${JSON.stringify(L.err)});document.getElementById("go").disabled=false;show("s3");return}
    try{if(window.parent!==window)parent.postMessage({alto:"lead",src:"form",phone:ph,name:nm},"*")}catch(e){}
    document.getElementById("rng").textContent="$"+low.toLocaleString()+" – $"+high.toLocaleString();
    document.getElementById("rsub").textContent=${JSON.stringify(L.rangeSub("~"))}.replace("~",MATNM[m]||m);
    setTimeout(function(){show("s4")},1400);
  }).catch(function(){clearInterval(tick);alert(${JSON.stringify(L.err)});document.getElementById("go").disabled=false;show("s3")});
}
</script></body></html>`;
}

app.get("/w/:slug", async (req, res) => {
  const c = await db.getContractorBySlug(String(req.params.slug));
  if (!c) return res.status(404).send("Not found");
  if (c.data?.status === "paused") {
    const pProf = c.data?.profile || {};
    const pBiz = String(pProf.biz || c.name).replace(/[&<>"]/g, "");
    const pPhone = String(pProf.phone || c.phone || "").replace(/\D/g, "");
    return res.send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${pBiz}</title><style>
*{box-sizing:border-box;font-family:Inter,Arial,sans-serif;margin:0}body{background:#F4F6FA;color:#101B30;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
.card{background:#fff;border:1px solid #E6EBF3;border-radius:22px;padding:36px 28px;max-width:420px;text-align:center;box-shadow:0 20px 60px rgba(16,27,48,.1)}
h1{font-size:20px;margin:12px 0 8px}p{color:#5A6478;font-weight:600;font-size:14.5px;line-height:1.6}
a{display:inline-block;margin-top:18px;background:#101B30;color:#fff;text-decoration:none;font-weight:800;padding:14px 26px;border-radius:12px}
</style></head><body><div class="card">
<span style="font-size:40px">🛠️</span>
<h1>${pBiz}</h1>
<p>La cotización en línea no está disponible por el momento.<br>Online quotes are temporarily unavailable.</p>
${pPhone ? `<a href="tel:+1${pPhone}">📞 Llámanos / Call us</a>` : ""}
</div></body></html>`);
  }
  const esc = (s) => String(s || "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  const prof = c.data?.profile || {};
  const biz = esc(prof.biz || c.name);
  const bizPhone = String(prof.phone || c.phone || "").replace(/\D/g, "");
  const logo = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(String(prof.logo || "")) ? prof.logo : null;
  const es = (req.query.lang || prof.lang || "es") !== "en";
  if ((c.data?.trade || "") === "fence") {
    const demoScan = await getFenceDemoScan().catch(() => null);
    return res.send(fenceWidgetHtml({ biz, bizPhone, logo, es, slug: c.slug, wBase: `${req.protocol}://${req.get("host")}`, appBack: req.query.app != null, demoScan }));
  }
  const L = es ? {
    title: `Tu techo, medido por satélite`,
    sub: "Pon tu dirección y mira cómo lo medimos al instante — gratis y sin que nadie te visite.",
    st1: "Pon tu dirección", st2: "El satélite mide tu techo", st3: "Recibe tu precio",
    scan: "📐 Midiendo tu techo…", trust: "🛰️ Medido por satélite · 💯 Gratis · 🔒 Sin compromiso",
    addr: "Dirección de tu casa", cont: "VER MI TECHO →",
    or2: "o", useLoc: "📍 Usar mi ubicación", locating: "📍 Buscando tu ubicación…",
    locErr: "No pudimos obtener tu ubicación. Mejor escribe tu dirección.", myLoc: "Tu ubicación",
    who: "¿A dónde mandamos tu precio?", name: "Tu nombre", phone: "Tu teléfono (celular)",
    bizName: "Nombre de tu negocio (opcional)", bookCall: "📅 Agendar una llamada",
    see: "VER MI PRECIO →", back: "← Cambiar dirección",
    m1: "Buscando imagen satelital…", m2: "Midiendo tu techo…", m3: "Calculando tu precio…",
    foundHouse: "Encontramos tu casa 🏠", storiesQ: "¿Cuántos pisos tiene?", storiesSub: "Así te damos un precio más exacto.",
    p1s: "1 piso", p2s: "2 pisos", p3s: "3 o más",
    propTitle: "Tu propuesta", yourRoof: "📐 Tu techo, medido por satélite", yourHouse: "🏠 Tu casa",
    range: "PRECIO ESTIMADO", rangeSub: "Teja arquitectónica, instalada.",
    disc: "Este es un precio estimado — tu precio final puede ser más bajo.",
    team: (b) => `Un miembro de ${b} te contactará hoy para darte tu precio exacto, sin compromiso.`,
    sent: "✓ Recibimos tus datos", call: (b) => `${b} te contacta hoy mismo.`,
    nores: "¡Listo! Recibimos tu información.", noresSub: (b) => `${b} te llama hoy con tu precio.`,
    callBtn: "📞 LLAMAR AHORA", phoneErr: "Pon un teléfono de 10 dígitos", addrErr: "Pon la dirección de tu casa",
    err: "Algo falló — intenta otra vez o llámanos.",
  } : {
    title: "Your roof, measured by satellite",
    sub: "Type your address and watch us measure it instantly — free, with no one visiting you.",
    st1: "Type your address", st2: "Satellite measures your roof", st3: "Get your price",
    scan: "📐 Measuring your roof…", trust: "🛰️ Satellite-measured · 💯 Free · 🔒 No obligation",
    addr: "Your home address", cont: "SEE MY ROOF →",
    or2: "or", useLoc: "📍 Use my location", locating: "📍 Finding your location…",
    locErr: "We couldn't get your location. Please type your address instead.", myLoc: "Your location",
    who: "Where do we send your price?", name: "Your name", phone: "Your phone (mobile)",
    bizName: "Your business name (optional)", bookCall: "📅 Schedule a call",
    see: "SEE MY PRICE →", back: "← Change address",
    m1: "Finding satellite imagery…", m2: "Measuring your roof…", m3: "Calculating your price…",
    foundHouse: "We found your home 🏠", storiesQ: "How many stories?", storiesSub: "So we can give you a more exact price.",
    p1s: "1 story", p2s: "2 stories", p3s: "3 or more",
    propTitle: "Your proposal", yourRoof: "📐 Your roof, measured by satellite", yourHouse: "🏠 Your home",
    range: "ESTIMATED PRICE", rangeSub: "Architectural shingle, installed.",
    disc: "This is an estimated price — your final price could be lower.",
    team: (b) => `Someone from ${b} will contact you today with your exact price — no obligation.`,
    sent: "✓ We got your info", call: (b) => `${b} will contact you today.`,
    nores: "Done! We received your information.", noresSub: (b) => `${b} will call you today with your price.`,
    callBtn: "📞 CALL NOW", phoneErr: "Enter a 10-digit phone", addrErr: "Enter your home address",
    err: "Something went wrong — try again or call us.",
  };
  const wBase = `${req.protocol}://${req.get("host")}`;
  // Demo takeover: after the 2nd trial quote the demo widget stops selling
  // roofs and starts selling ALTO — WhatsApp straight to our sales line.
  const ddoneHtml = `<div class="prophead">${es ? "🚀 ¿Viste qué fácil?" : "🚀 See how easy that was?"}</div>`
    + `<p style="color:#475067;font-weight:600;line-height:1.6;margin:6px 0 16px;text-align:center">${es
      ? "Ya usaste tus 2 cotizaciones de prueba. Así de fácil te ahorras el tiempo, el gas y las vueltas — cotizas desde donde estés, sin manejar a cada casa. Imagínate el dinero que te ahorras teniendo esta aplicación."
      : "You've used your 2 trial quotes. That's how easily you save the time, the gas and the trips — you quote from wherever you are, without driving to every house. Imagine the money you save with this app."}</p>`
    + `<a href="https://wa.me/${SALES_WA}?text=${encodeURIComponent(es
      ? "Hola 👋 Probé el demo del cotizador de ALTO Pro y quiero verlo en MI página web."
      : "Hi 👋 I tried the ALTO Pro quote demo and I want it on MY website.")}" target="_blank" style="display:block;text-align:center;background:#F8B408;color:#101B30;border-radius:14px;padding:15px;font-weight:800;text-decoration:none;margin-bottom:10px">${es ? "💬 Obtener mi app" : "💬 Get my app"}</a>`
    + (GHL_BOOKING_URL ? `<a href="${GHL_BOOKING_URL}" target="_blank" style="display:block;text-align:center;background:#fff;border:1.5px solid #E6E8EC;color:#101B30;border-radius:14px;padding:13px;font-weight:800;text-decoration:none;margin-bottom:10px">${es ? "📅 Agendar una llamada" : "📅 Schedule a call"}</a>` : "")
    + `<a href="/ventas" target="_blank" style="display:block;text-align:center;background:#fff;border:1.5px solid #E6E8EC;color:#101B30;border-radius:14px;padding:13px;font-weight:800;text-decoration:none">${es ? "Ver planes y precios" : "See plans & pricing"}</a>`;
  // When the contractor previews from inside the app (?app=1), show a back
  // button so they're never stranded. Real client links never carry ?app=1.
  const appBack = req.query.app != null ? `<div style="padding:12px 16px 0;max-width:430px;margin:0 auto"><a href="/" onclick="if(history.length>1){history.back();return false}" style="display:inline-flex;align-items:center;gap:5px;background:#fff;border:1.5px solid #E6E8EC;border-radius:999px;padding:8px 13px;font-weight:800;font-size:14px;color:#101B30;text-decoration:none;box-shadow:0 4px 14px rgba(16,27,48,.1)">‹ ${es ? "Volver a la app" : "Back to app"}</a></div>` : "";
  res.send(`<!doctype html><html lang="${es ? "es" : "en"}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${biz}</title>
<meta property="og:title" content="${biz} — ${es ? "Precio de tu techo en 60 segundos" : "Your roof price in 60 seconds"}">
<meta property="og:description" content="${es ? "Pon tu dirección y mira tu techo medido por satélite. Gratis, sin compromiso." : "Type your address and see your roof measured by satellite. Free, no obligation."}">
<meta property="og:image" content="${wBase}/landing/og.png?v=3">
<meta name="twitter:card" content="summary_large_image">
<style>
*{box-sizing:border-box;font-family:Inter,Arial,sans-serif;-webkit-tap-highlight-color:transparent}
body{margin:0;background:#F4F6FA;color:#101B30}
.wrap{max-width:430px;margin:0 auto;padding:18px 16px 28px}
.brand{display:flex;align-items:center;gap:10px;margin-bottom:14px}
.brand img{max-height:44px;max-width:140px;border-radius:8px}
.brand .nm{font-weight:800;font-size:18px}
.card{background:#fff;border:1.5px solid #E6E8EC;border-radius:18px;padding:20px;box-shadow:0 6px 22px rgba(16,27,48,.06)}
h1{font-size:27px;font-weight:800;margin:0 0 6px;line-height:1.12;letter-spacing:-.01em}
.sub{color:#67718A;font-size:14px;font-weight:600;margin:0 0 16px;line-height:1.45}
.hero{position:relative;border-radius:16px;overflow:hidden;margin-bottom:16px;box-shadow:0 10px 26px rgba(16,27,48,.16)}
.hero svg{display:block;width:100%;height:auto}
.scanbar{position:absolute;left:0;right:0;height:46px;top:-20%;background:linear-gradient(180deg,rgba(248,180,8,0),rgba(248,180,8,.30) 65%,rgba(248,180,8,.5));border-bottom:2.5px solid #F8B408;animation:scan 2.7s ease-in-out infinite;pointer-events:none}
@keyframes scan{0%{top:-20%;opacity:0}12%{opacity:1}88%{opacity:1}100%{top:100%;opacity:0}}
.sat{position:absolute;top:9px;left:11px;font-size:21px;filter:drop-shadow(0 2px 4px rgba(0,0,0,.4))}
.mbadge{position:absolute;top:11px;right:11px;background:#F8B408;color:#101B30;font-weight:800;font-size:11.5px;padding:5px 10px;border-radius:99px;box-shadow:0 4px 10px rgba(0,0,0,.28)}
.steps{display:flex;gap:8px;margin:16px 0 12px}
.steps .stp{flex:1;text-align:center;background:#F7F9FC;border:1.5px solid #EDF0F5;border-radius:13px;padding:11px 5px}
.steps .ic{font-size:21px;line-height:1}
.steps .tx{font-size:11px;font-weight:700;color:#475067;margin-top:5px;line-height:1.25}
.trust{text-align:center;color:#8A93A5;font-size:11.5px;font-weight:700;margin-top:2px}
.ordiv{display:flex;align-items:center;gap:10px;margin:12px 2px;color:#A7AEBE;font-size:12px;font-weight:700}
.ordiv:before,.ordiv:after{content:"";flex:1;height:1.5px;background:#EAEDF2}
.locbtn{width:100%;padding:14px;border:1.5px solid #E6E8EC;border-radius:12px;background:#fff;color:#101B30;font-size:15px;font-weight:800;cursor:pointer;animation:locGlow 2.6s ease-in-out infinite}
.locbtn:active{transform:scale(.98)}
.locbtn[disabled]{opacity:.6;animation:none}
@keyframes locGlow{0%,100%{box-shadow:0 0 0 rgba(248,180,8,0);border-color:#E6E8EC}50%{box-shadow:0 6px 22px rgba(248,180,8,.45);border-color:#F8B408}}
@media(prefers-reduced-motion:reduce){.locbtn{animation:none}}
@media (prefers-reduced-motion:reduce){.scanbar{animation:none;top:42%;opacity:1}}
input{width:100%;padding:14px;border:1.5px solid #E6E8EC;border-radius:12px;font-size:16px;font-weight:600;outline:none;margin-bottom:10px}
input:focus{border-color:#F8B408}
.btn{width:100%;padding:15px;border:none;border-radius:12px;background:#F8B408;color:#fff;font-size:16px;font-weight:800;cursor:pointer}
.btn:active{transform:scale(.98)}
.btn[disabled]{opacity:.5}
.sug{border:1.5px solid #E6E8EC;border-top:none;border-radius:0 0 12px 12px;margin:-12px 0 10px;background:#fff;overflow:hidden}
.sug button{display:block;width:100%;text-align:left;padding:11px 13px;border:none;background:#fff;font-size:14px;font-weight:600;cursor:pointer;border-top:1px solid #F0F2F6}
.sug button:active{background:#FEF5DC}
.ghost{background:none;border:none;color:#67718A;font-weight:700;font-size:13px;cursor:pointer;padding:10px 0}
.load{text-align:center;padding:30px 0}
.spin{width:46px;height:46px;border:5px solid #FEF5DC;border-top-color:#F8B408;border-radius:50%;margin:0 auto 14px;animation:sp 1s linear infinite}
@keyframes sp{to{transform:rotate(360deg)}}
.lmsg{font-weight:700;color:#67718A;font-size:14px}
.photo{width:100%;border-radius:14px;display:block;margin-bottom:12px}
.range{background:#101B30;border-radius:14px;padding:16px;text-align:center;margin-bottom:12px}
.range .lbl{color:#F8B408;font-size:11px;font-weight:800;letter-spacing:2px}
.range .val{color:#fff;font-size:30px;font-weight:800;margin-top:4px}
.note{color:#67718A;font-size:12px;font-weight:600;line-height:1.5}
.prophead{font-size:22px;font-weight:800;color:#101B30;margin:0 0 14px;letter-spacing:-.01em}
.shot{position:relative;border-radius:14px;overflow:hidden;margin-bottom:12px;box-shadow:0 8px 24px rgba(16,27,48,.14)}
.shot .ken{width:100%;display:block;animation:ken 6s ease-out forwards}
@keyframes ken{from{transform:scale(1.22)}to{transform:scale(1)}}
.shotlbl{position:absolute;top:10px;left:10px;z-index:2;background:rgba(16,27,48,.82);color:#fff;font-size:12px;font-weight:800;padding:5px 11px;border-radius:99px}
.range .rsub{color:#AEB8CC;font-size:11px;font-weight:600;margin-top:6px}
.disc{background:#FEF5DC;border:1.5px solid #F4D78A;color:#7A5A00;border-radius:12px;padding:11px 13px;font-weight:700;font-size:12.5px;line-height:1.45;margin-bottom:10px}
.team{color:#475067;font-size:13px;font-weight:600;line-height:1.5;margin:8px 2px 0;text-align:center}
.qbox{background:#fff;border:1.5px solid #E6E8EC;border-radius:14px;padding:16px;margin-bottom:4px}
.qh{font-size:18px;font-weight:800;color:#101B30}
.qsub{font-size:12.5px;font-weight:600;color:#67718A;margin:3px 0 12px}
.qopts{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}
.qopt{display:flex;flex-direction:column;align-items:center;gap:5px;padding:14px 6px;border:1.5px solid #E6E8EC;border-radius:12px;background:#F7F9FC;color:#101B30;font-size:13px;font-weight:800;cursor:pointer}
.qopt span{font-size:24px}
.qopt:active{transform:scale(.97)}
.qopt:disabled{opacity:.5}
.ok{background:#EAF8EF;border:1.5px solid #34A853;color:#1E7B3C;border-radius:12px;padding:12px;font-weight:700;font-size:14px;margin:12px 0}
.manual{background:#FEF5DC;border:1.5px solid #F8B408;color:#7A5A00;border-radius:12px;padding:12px;font-weight:700;font-size:13px;line-height:1.5;margin:12px 0}
.call{display:block;text-align:center;text-decoration:none;margin-top:12px;padding:15px;border-radius:12px;background:#101B30;color:#fff;font-weight:800;font-size:16px}
.ft{text-align:center;color:#9AA3B5;font-size:11px;font-weight:600;margin-top:18px}
.err{color:#D93025;font-size:13px;font-weight:700;margin:-4px 0 8px}
</style></head><body>${appBack}<div class="wrap">
<div class="brand">${logo ? `<img src="${logo}" alt="">` : ""}<span class="nm">${biz}</span></div>
<div class="card" id="card">
  <div id="s1">
    <div class="hero">
      <svg viewBox="0 0 400 188" xmlns="http://www.w3.org/2000/svg">
        <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1B2A3D"/><stop offset="1" stop-color="#0E1825"/></linearGradient></defs>
        <rect width="400" height="188" fill="url(#sky)"/>
        <g stroke="#2C3E55" stroke-width="1.5" opacity=".55"><line x1="0" y1="52" x2="400" y2="42"/><line x1="0" y1="142" x2="400" y2="150"/><line x1="118" y1="0" x2="108" y2="188"/><line x1="298" y1="0" x2="308" y2="188"/></g>
        <rect x="22" y="62" width="68" height="46" rx="3" fill="#26333f" opacity=".7"/>
        <rect x="320" y="104" width="62" height="48" rx="3" fill="#26333f" opacity=".7"/>
        <polygon points="160,56 240,56 250,72 150,72" fill="#4A5868"/>
        <polygon points="150,72 250,72 270,112 130,112" fill="#3A4756"/>
        <polygon points="130,112 270,112 250,72 150,72 160,56 240,56 250,72" fill="none" stroke="#F8B408" stroke-width="3" stroke-dasharray="7 5"/>
        <g stroke="#F8B408" stroke-width="3" fill="none" stroke-linecap="round"><path d="M16 30 H42 M16 30 V56"/><path d="M384 30 H358 M384 30 V56"/><path d="M16 158 H42 M16 158 V132"/><path d="M384 158 H358 M384 158 V132"/></g>
      </svg>
      <div class="scanbar"></div>
      <span class="sat">🛰️</span>
      <span class="mbadge">${L.scan}</span>
    </div>
    <h1>${L.title}</h1><p class="sub">${L.sub}</p>
    <input id="addr" placeholder="${L.addr}" autocomplete="street-address">
    <div class="sug" id="sug" style="display:none"></div>
    <p class="err" id="e1" style="display:none">${L.addrErr}</p>
    <button class="btn" onclick="toStep2()">${L.cont}</button>
    <div class="ordiv"><span>${L.or2}</span></div>
    <button class="locbtn" id="locbtn" onclick="useLoc()">${L.useLoc}</button>
    <div class="steps">
      <div class="stp"><div class="ic">📍</div><div class="tx">${L.st1}</div></div>
      <div class="stp"><div class="ic">🛰️</div><div class="tx">${L.st2}</div></div>
      <div class="stp"><div class="ic">💵</div><div class="tx">${L.st3}</div></div>
    </div>
    <div class="trust">${L.trust}</div>
  </div>
  <div id="s2" style="display:none">
    <h1>${L.who}</h1><p class="sub" id="addrEcho"></p>
    <input id="nm" placeholder="${L.name}" autocomplete="name">
    ${c.slug === "alto-demo" ? `<input id="biz2" placeholder="${L.bizName}" autocomplete="organization">` : ""}
    <input id="ph" placeholder="${L.phone}" type="tel" autocomplete="tel" inputmode="numeric">
    <p class="err" id="e2" style="display:none">${L.phoneErr}</p>
    <button class="btn" id="go" onclick="submit()">${L.see}</button>
    <button class="ghost" onclick="back1()">${L.back}</button>
    <p style="font-size:10.5px;color:#9AA3B2;line-height:1.55;margin:10px 4px 0">${es ? `Al enviar, aceptas recibir llamadas, SMS o WhatsApp sobre tu cotización. No vendemos tus datos. <a href="/privacidad" target="_blank" style="color:inherit">Privacidad</a>` : `By submitting, you agree to receive calls, SMS or WhatsApp about your quote. We never sell your data. <a href="/privacidad" target="_blank" style="color:inherit">Privacy</a>`}</p>
  </div>
  <div id="s3" style="display:none" class="load"><div class="spin"></div><p class="lmsg" id="lmsg">${L.m1}</p></div>
  <div id="s5" style="display:none"></div>
  <div id="s4" style="display:none"></div>
</div>
<div class="ft">⚡ ALTO Pro</div>
</div>
<script>
var SLUG=${JSON.stringify(c.slug)},BIZ=${JSON.stringify(prof.biz || c.name)},BPH=${JSON.stringify(bizPhone)};
var MIRROR_LEAD=${JSON.stringify(c.slug === "alto-demo")};
var DEMO=${JSON.stringify(String(req.query.demo || "")).replace(/</g, "\\u003c").replace(/\//g, "\\/")};
var L=${JSON.stringify({ m1: L.m1, m2: L.m2, m3: L.m3, range: L.range, rangeSub: L.rangeSub, sent: L.sent, callTxt: L.call(prof.biz || c.name), nores: L.nores, noresSub: L.noresSub(prof.biz || c.name), callBtn: L.callBtn, err: L.err,
  useLoc: L.useLoc, locating: L.locating, locErr: L.locErr, myLoc: L.myLoc,
  propTitle: L.propTitle, yourRoof: L.yourRoof, yourHouse: L.yourHouse, disc: L.disc, teamTxt: L.team(prof.biz || c.name),
  foundHouse: L.foundHouse, storiesQ: L.storiesQ, storiesSub: L.storiesSub, p1s: L.p1s, p2s: L.p2s, p3s: L.p3s,
  // contractor-facing note, demo widget only — homeowners on client sites get the free-inspection line instead
  manual: c.slug === "alto-demo" ? (es
    ? "👆 ¿La línea no quedó perfecta? En tu app ALTO Pro tú mismo trazas el techo con el dedo y sacas la medida exacta — para que cotices con confianza."
    : "👆 Outline not perfect? In your ALTO Pro app you trace the roof with your finger and get the exact measurement — so you quote with confidence.") : null })};
// funnel events only for OUR demo widgets — client-site widget traffic
// belongs to the client, not the ALTO sales funnel
function track(ev){try{if(${JSON.stringify(["alto-demo", "alto-ventas", "alto-cercas"].includes(c.slug))})fetch('/api/track',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event:ev})})}catch(e){}}
track('w_view');
var placeId=null,tmr=null,gpsLat=null,gpsLng=null;
var addr=document.getElementById('addr'),sug=document.getElementById('sug');
addr.addEventListener('input',function(){placeId=null;clearTimeout(tmr);var q=addr.value.trim();
  if(q.length<4){sug.style.display='none';return}
  tmr=setTimeout(function(){fetch('/api/places?q='+encodeURIComponent(q)).then(r=>r.json()).then(function(j){
    var s=(j.suggestions||[]).slice(0,4);if(!s.length){sug.style.display='none';return}
    sug.innerHTML=s.map(function(x,i){return '<button data-i="'+i+'">📍 '+x.text.replace(/</g,'&lt;')+'</button>'}).join('');
    sug.style.display='block';
    Array.prototype.forEach.call(sug.children,function(b){b.onclick=function(){var x=s[+b.dataset.i];addr.value=x.text;placeId=x.placeId;sug.style.display='none'}});
  }).catch(function(){})},250)});
function show(id){['s1','s2','s3','s4','s5'].forEach(function(s){document.getElementById(s).style.display=s===id?'block':'none'})}
function toStep2(){if(addr.value.trim().length<6){document.getElementById('e1').textContent=${JSON.stringify(L.addrErr)};document.getElementById('e1').style.display='block';return}
  gpsLat=gpsLng=null; // a typed address overrides any earlier GPS
  document.getElementById('e1').style.display='none';
  document.getElementById('addrEcho').textContent='📍 '+addr.value.trim();show('s2');document.getElementById('nm').focus()}
function useLoc(){
  var btn=document.getElementById('locbtn');
  if(!navigator.geolocation){document.getElementById('e1').textContent=L.locErr;document.getElementById('e1').style.display='block';return}
  btn.disabled=true;btn.textContent=L.locating;
  navigator.geolocation.getCurrentPosition(function(pos){
    gpsLat=pos.coords.latitude;gpsLng=pos.coords.longitude;placeId=null;
    document.getElementById('e1').style.display='none';
    btn.disabled=false;btn.textContent=L.useLoc;
    document.getElementById('addrEcho').textContent='📍 '+L.myLoc;
    show('s2');document.getElementById('nm').focus();
  },function(){
    btn.disabled=false;btn.textContent=L.useLoc;
    document.getElementById('e1').textContent=L.locErr;document.getElementById('e1').style.display='block';
  },{enableHighAccuracy:true,timeout:10000,maximumAge:60000})}
function back1(){show('s1')}
function submit(){
  var ph=document.getElementById('ph').value.replace(/\\D/g,'');
  if(ph.length<10){document.getElementById('e2').style.display='block';return}
  try{if(window.parent!==window)parent.postMessage({alto:'lead',src:'form',phone:ph,name:document.getElementById('nm').value.trim()},'*')}catch(e){}
  document.getElementById('e2').style.display='none';show('s3');
  // The shared demo persona (alto-demo) is a SALES tool: every prospect who
  // tries it becomes a sales lead too, in the SAME inbox as the quiz — its
  // GHL webhook already forwards to setters, so nobody who tries the landing
  // demo goes unfollowed just because they didn't WhatsApp us.
  if(MIRROR_LEAD){
    var bizEl=document.getElementById('biz2');
    fetch('/api/widget/lead',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      slug:'alto-ventas',name:document.getElementById('nm').value.trim(),phone:ph,address:addr.value.trim(),
      info:{src:'trial-app',trade:'roofing',biz:bizEl?bizEl.value.trim():''}
    })}).catch(function(){});
  }
  var msgs=[L.m1,L.m2,L.m3],mi=0,lm=document.getElementById('lmsg');
  var mt=setInterval(function(){mi=(mi+1)%msgs.length;lm.textContent=msgs[mi]},1600);
  var wait=new Promise(function(r){setTimeout(r,2800)});
  var req=fetch('/api/widget/quote',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({slug:SLUG,name:document.getElementById('nm').value.trim(),phone:ph,address:addr.value.trim(),placeId:placeId,lat:gpsLat,lng:gpsLng,demo:DEMO})
  }).then(function(r){if(r.ok)return r.json();return r.json().then(function(e){return e&&e.error==='demo_done'?{__demo:1}:null}).catch(function(){return null})}).catch(function(){return null});
  Promise.all([req,wait]).then(function(a){clearInterval(mt);afterMeasure(a[0])})}
function fmt(n){return '$'+Number(n).toLocaleString('en-US',{maximumFractionDigits:0})}
var QJ=null;
// Measured → show the house and ask one quick question (stories). Not measured
// (no satellite data) → skip straight to the result; the lead is already saved.
function afterMeasure(j){
  if(j&&j.__demo){demoDone();return}
  QJ=j;
  if(!j||!j.measured||!j.squares){render(j);return}
  var h='<div class="prophead">'+L.foundHouse+'</div>';
  if(j.img)h+='<div class="shot"><div class="shotlbl">'+L.yourRoof+'</div><img class="ken" src="'+j.img+'" alt=""></div>';
  h+='<div class="qbox"><div class="qh">'+L.storiesQ+'</div><div class="qsub">'+L.storiesSub+'</div>'
    +'<div class="qopts">'
    +'<button class="qopt" onclick="pickStories(1)"><span>🏠</span>'+L.p1s+'</button>'
    +'<button class="qopt" onclick="pickStories(2)"><span>🏠</span>'+L.p2s+'</button>'
    +'<button class="qopt" onclick="pickStories(3)"><span>🏢</span>'+L.p3s+'</button>'
    +'</div></div>';
  document.getElementById('s5').innerHTML=h;show('s5');
  window.scrollTo&&window.scrollTo(0,0);
}
function pickStories(st){
  var opts=document.querySelectorAll('#s5 .qopt');opts.forEach(function(b){b.disabled=true});
  fetch('/api/widget/requote',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({slug:SLUG,leadId:QJ&&QJ.id,squares:QJ&&QJ.squares,stories:st})
  }).then(function(r){return r.ok?r.json():null}).then(function(q){
    if(q&&q.ok){QJ.low=q.low;QJ.high=q.high}
    QJ.stories=st;render(QJ);
  }).catch(function(){render(QJ)});
}
function demoDone(){
  track('w_demo_done');
  var s4=document.getElementById('s4');
  s4.innerHTML=${JSON.stringify(ddoneHtml)};
  show('s4');window.scrollTo&&window.scrollTo(0,0);
}
function render(j){track('w_result');var s4=document.getElementById('s4'),h='';
  if(!j){s4.innerHTML='<p class="err">'+L.err+'</p>';show('s4');return}
  h+='<div class="prophead">'+L.propTitle+'</div>';
  if(j.measured){
    if(j.img)h+='<div class="shot"><div class="shotlbl">'+L.yourRoof+'</div><img class="ken" src="'+j.img+'" alt=""></div>';
    if(j.street)h+='<div class="shot"><div class="shotlbl">'+L.yourHouse+'</div><img class="ken" src="'+j.street+'" alt="" onerror="this.parentNode.style.display=\\'none\\'"></div>';
    h+='<div class="range"><div class="lbl">'+L.range+'</div><div class="val">'+fmt(j.low)+' – '+fmt(j.high)+'</div><div class="rsub">'+L.rangeSub+'</div></div>';
    h+='<div class="disc">💡 '+L.disc+'</div>';
    h+='<div class="ok">'+L.sent+'</div>';
    h+='<p class="team">'+L.teamTxt+'</p>';
  }else{
    h+='<div class="ok">'+L.nores+'</div><p class="team">'+L.noresSub+'</p>';
  }
  if(L.manual)h+='<div class="manual">'+L.manual+'</div>';
  if(BPH)h+='<a class="call" href="tel:+1'+BPH+'">'+L.callBtn+'</a>';
  s4.innerHTML=h;show('s4')}
</script></body></html>`);
});

/* ── Sales landing page (alto-pro.com) ──
 * One bold page that sells the bundle by SHOWING it: the live widget is
 * embedded so a visitor can measure a real roof right on the page.
 * Interested roofers leave name + phone → lead in the "alto-ventas" account. */
// Meta Pixel for ad tracking — only renders once META_PIXEL_ID is set.
// Shared by every sales landing (/ventas, /cercas, /app).
function metaPixelHead() {
  const pixelId = (process.env.META_PIXEL_ID || "").replace(/[^0-9]/g, "");
  return pixelId ? `<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${pixelId}');fbq('track','PageView');</script><noscript><img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=${pixelId}&ev=PageView&noscript=1"/></noscript>` : "";
}
function landingPage(req, fence = false) {
  const base = canonBase(req);
  const en = req.query.lang === "en";
  const pixelHead = metaPixelHead();
  // keep the language toggle on the same path (/ on the root domain, /ventas elsewhere)
  const langHref = `${fence ? "/cercas" : req.path.startsWith("/ventas") ? "/ventas" : "/"}?lang=${en ? "es" : "en"}`;
  const L = en ? {
    lang: "en", langBtn: "🇲🇽 Español", langHref: "/?lang=es",
    title: "ALTO Pro — Quote any roof in 60 seconds",
    desc: "The all-in-one tool for roofers: measure by satellite, quote and invoice from your phone. Plus a website that captures customers 24/7. Plans from $67/mo.",
    ogTitle: "ALTO Pro — Win more jobs. Quote any roof in 60 seconds.",
    ogDesc: "Measure any roof by satellite from your phone and quote it on the spot — plus a website that captures customers while you sleep. Try it live.",
    h1: "WIN MORE JOBS.<br>QUOTE ANY ROOF<br>IN <em>60 SECONDS</em>",
    sub: `The all-in-one tool for roofers — measure by <b>satellite</b>, quote and invoice right from your phone. Show up already knowing the number. <b>Plus a website that captures customers while you sleep.</b>`,
    cta1: "SEE THE LIVE DEMO ↓", cta2: "See plans",
    chips: ["🇺🇸 Bilingual", "🏠 Built for roofers", "📲 No App Store"],
    tryAppT: "TRY IT <em>YOURSELF</em>",
    tryAppSub: `Type a real address and watch exactly what your future customers would see — on YOUR website, with YOUR prices, live in seconds. Two free tries — then we'll show you how to get it. Yours from <b style="color:#101B30">$67/mo</b>.`,
    fullQ: "What about the full website?", fullSub: "See a sample website, actually working — imagine your logo, your colors and your name.",
    fullBtn: "TAP TO SEE YOUR WEBSITE →",
    howT: "HOW DOES IT <em>WORK</em>?",
    s1t: "The customer lands on your site", s1x: "From an ad, from Google, or because someone shared your link. Your website works even while you're up on a roof.",
    s2t: "They leave their phone to see the price", s2x: `<b style="color:#D99E00">No name and phone, no price.</b> The satellite measures their roof and calculates a range with YOUR prices — you edit them in the app anytime, and the quote tool uses them instantly.`,
    s3t: "The lead hits your phone", s3x: "Name, address, phone and the price they saw — instantly, in your app. One button and you're already writing them on WhatsApp with the message pre-written.",
    leadsT: "HOMEOWNERS LAND<br><em>ON YOUR PHONE</em>",
    leadsSub: "Watch it happen — a homeowner quotes their roof on your website and lands on your phone, ready for WhatsApp.",
    leads: ["<b>📥</b> Every lead buzzes in your pocket instantly", "<b>💰</b> Your prices, your range — raise them whenever you want", "<b>💬</b> WhatsApp message pre-written — one tap and you reply", "<b>🛰️</b> Satellite estimates in 60 seconds", "<b>🧾</b> Professional invoices with your logo"],
    ceLinks: "Home · Services · Free Quote · Contact", ceKick: "FREE ROOF QUOTE", ceHead: "What does my new roof cost?",
    cePhName: "Full name", cePhPhone: "Phone (mobile)", ceBtn: "GET MY FREE ROOF ESTIMATE →", ceSent: "✓ Sent!",
    ceResT: "YOUR ESTIMATED PRICE", ceResSub: "based on your roof's size",
    ceNotif: "New roof lead · just now", ceEmpty: "Your roof leads land here…",
    ceNew: "NEW", ceNew1: "1 NEW", ceNew2: "2 NEW",
    appT: "AND ON YOUR PHONE, <em>THE APP</em>",
    appSub: `You're on a job and the neighbor asks "how much for mine?" — you type their address (or use your GPS), the satellite measures it, and you send the formal quote right there.`,
    cap1: "Measured by satellite<br>in 60 seconds", cap2: "Want to be sure?<br>Trace it yourself with your finger", cap3: "Formal quote with your<br>brand, ready to send",
    plansT: "PICK YOUR <em>PLAN</em>",
    plansSub: "No fine print. No setup fee. No long contracts. Cancel anytime.",
    pop: "MOST POPULAR", noSetup: "no setup fee", per: "/mo", planCta: "Get started →",
    plansNote: `Not sure which one? <a href="#contacto" style="color:#B07A00;font-weight:800">Book a call</a> — we'll tell you honestly.`,
    plans: [
      { tier: "PRO · THE TOOL", price: 67, who: "Just want the tool? The full ALTO Pro app, self-serve.", feats: ["Measure any roof by satellite in 60 sec", "Formal quotes & invoices with your logo", "Jobs, payments & customers organized", "English y Español"] },
      { tier: "WIDGET · YOUR SITE", price: 197, hot: true, who: "Already have a website? We send you the code — you paste it in.", feats: ["Everything in Pro", "The satellite quote tool on YOUR website", "Leads straight to your WhatsApp", "Works on WordPress, Wix, GoDaddy — any site"] },
      { tier: "COMPLETE · DONE FOR YOU", price: 297, who: "No website — or want a better one? We build it for you, with your brand.", feats: ["Everything in Widget", "Your professional website with your brand", "AI chat that answers customers 24/7", "Your domain (yourbusiness.com) is yours — by contract", "Bilingual support"] },
    ],
    talkT: "READY? <em>LET'S TALK</em>", talkSub: "Answer 4 quick questions and schedule a call with the team. No obligation — we answer everything and you decide.",
    q1: "What type of work do you do?", q1o: ["Residential", "Commercial", "Both", "Other"],
    q2: "How big is your crew?", q2o: ["Just me", "2–5", "6–10", "More than 10"],
    q3: "About how much revenue per month?", q3o: ["Under $10k", "$10k–$30k", "$30k–$80k", "Over $80k"],
    q4: "How much do you spend on marketing monthly?", q4o: ["Nothing yet", "Under $500", "$500–$2,000", "Over $2,000"],
    q5: "Last step — where do we call you?", back: "← Back", qStep: "Question {n} of 5",
    fName: "Your name", fBiz: "Your business name", fPhone: "Your phone (mobile)", fBtn: "SCHEDULE MY CALL →", fOk: "✓ Done! The team will contact you today to set a time.",
    fSafe: "No obligation · We call you today · No spam", fErr: "Enter your 10-digit number, e.g. 956 555 0188", formErr: "Couldn't send — check your connection and try again, or call us.",
    fOkTry: "While you wait, try the&nbsp;app&nbsp;→",
    fBook: "📅 Want to lock in your time NOW? Pick the slot that works for you:",
    foot: `ALTO Pro · Made in Texas 🤠 · <a href="https://app.alto-pro.com">app.alto-pro.com</a> · <a href="/privacidad">Privacy</a>`,
    consent: `By submitting, you agree that ALTO Pro may contact you by call, SMS or WhatsApp. We never sell your data. <a href="/privacidad" target="_blank" style="color:inherit">Privacy</a>`,
  } : {
    lang: "es", langBtn: "🇺🇸 English", langHref: "/?lang=en",
    title: "ALTO Pro — Cotiza cualquier techo en 60 segundos",
    desc: "La herramienta todo-en-uno para roferos: mide por satélite, cotiza y factura desde tu teléfono. Más una página web que capta clientes 24/7. Planes desde $67/mes.",
    ogTitle: "ALTO Pro — Gana más trabajos. Cotiza cualquier techo en 60 segundos.",
    ogDesc: "Mide cualquier techo por satélite desde tu teléfono y cotízalo ahí mismo — más una página web que capta clientes mientras duermes. Pruébalo en vivo.",
    h1: "GANA MÁS TRABAJOS.<br>COTIZA CUALQUIER TECHO<br>EN <em>60 SEGUNDOS</em>",
    sub: `La herramienta todo-en-uno para roferos — mide por <b>satélite</b>, cotiza y factura desde tu teléfono. Llega con el cliente ya sabiendo el número. <b>Más una página web que te capta clientes mientras duermes.</b>`,
    cta1: "VER DEMO EN VIVO ↓", cta2: "Ver planes",
    chips: ["🇺🇸 En español", "🏠 Hecho para roferos", "📲 Sin App Store"],
    tryAppT: "PRUÉBALO <em>TÚ MISMO</em>",
    tryAppSub: `Escribe una dirección real y mira exactamente lo que verían tus futuros clientes — en TU página, con TUS precios, en segundos. Dos pruebas gratis — luego te decimos cómo tenerlo. Desde <b style="color:#101B30">$67/mes</b>.`,
    fullQ: "¿Y la página completa?", fullSub: "Mira una página de ejemplo, funcionando de verdad — imagina tu logo, tus colores y tu nombre.",
    fullBtn: "PRESIONA PARA VER TU PÁGINA →",
    howT: "¿CÓMO <em>FUNCIONA</em>?",
    s1t: "El cliente entra a tu página", s1x: "De un anuncio, de Google, o porque alguien le pasó tu link. Tu página trabaja aunque tú estés arriba de un techo.",
    s2t: "Deja su teléfono para ver su precio", s2x: `<b style="color:#D99E00">Sin nombre y teléfono, no hay precio.</b> El satélite mide su techo y calcula un rango con TUS precios — los editas en la app cuando quieras, y el cotizador los usa al instante.`,
    s3t: "El lead te llega a tu teléfono", s3x: "Nombre, dirección, teléfono y el precio que vio — al instante, en tu app. Un botón y ya le estás escribiendo por WhatsApp con el mensaje listo.",
    leadsT: "LOS CLIENTES LLEGAN<br><em>A TU TELÉFONO</em>",
    leadsSub: "Míralo pasar — un cliente cotiza su techo en tu página web y cae en tu teléfono, listo para WhatsApp.",
    leads: ["<b>📥</b> Cada lead suena en tu bolsillo al instante", "<b>💰</b> Tus precios, tu rango — los subes cuando quieras", "<b>💬</b> Mensaje de WhatsApp ya escrito — un tap y contestas", "<b>🛰️</b> Estimados por satélite en 60 segundos", "<b>🧾</b> Facturas profesionales con tu logo"],
    ceLinks: "Inicio · Servicios · Cotiza gratis · Contacto", ceKick: "COTIZACIÓN GRATIS DE TU TECHO", ceHead: "¿Cuánto cuesta mi techo nuevo?",
    cePhName: "Nombre completo", cePhPhone: "Teléfono (celular)", ceBtn: "VER MI PRECIO GRATIS →", ceSent: "✓ ¡Enviado!",
    ceResT: "TU PRECIO ESTIMADO", ceResSub: "según el tamaño de tu techo",
    ceNotif: "Nuevo lead de techo · ahora mismo", ceEmpty: "Tus leads de techos llegan aquí…",
    ceNew: "NUEVO", ceNew1: "1 NUEVO", ceNew2: "2 NUEVOS",
    appT: "Y EN TU TELÉFONO, <em>LA APP</em>",
    appSub: `Estás en un trabajo y el vecino te pregunta "¿cuánto por el mío?" — pones su dirección (o usas tu GPS), el satélite lo mide, y le mandas la cotización formal ahí mismo.`,
    cap1: "Medido por satélite<br>en 60 segundos", cap2: "¿Quieres estar seguro?<br>Trázalo tú mismo con el dedo", cap3: "Cotización formal con tu<br>marca, lista para mandar",
    plansT: "ELIGE TU <em>PLAN</em>",
    plansSub: "Sin letras chiquitas. Sin cargo de inicio. Sin contratos largos. Cancelas cuando quieras.",
    pop: "MÁS POPULAR", noSetup: "sin cargo de inicio", per: "/mes", planCta: "Empezar →",
    plansNote: `¿No sabes cuál? <a href="#contacto" style="color:#B07A00;font-weight:800">Agenda una llamada</a> — te decimos con honestidad.`,
    plans: [
      { tier: "PRO · LA APP", price: 67, who: "¿Solo quieres la herramienta? La app ALTO Pro completa, para ti solo.", feats: ["Mide cualquier techo por satélite en 60 seg", "Cotizaciones y facturas formales con tu logo", "Trabajos, cobros y clientes organizados", "Español e inglés"] },
      { tier: "WIDGET · TU PÁGINA", price: 197, hot: true, who: "¿Ya tienes página web? Te mandamos el código — lo pegas y listo.", feats: ["Todo lo de Pro", "El cotizador satelital en TU página", "Leads directo a tu WhatsApp", "Funciona en WordPress, Wix, GoDaddy — donde sea"] },
      { tier: "COMPLETO · TODO HECHO", price: 297, who: "¿Sin página, o quieres una mejor? La hacemos por ti, con tu marca.", feats: ["Todo lo de Widget", "Tu página web profesional con tu marca", "Chat con IA que atiende a tus clientes 24/7", "Tu dominio (tunegocio.com) es tuyo — por contrato", "Soporte en español"] },
    ],
    talkT: "¿LISTO? <em>HABLEMOS</em>", talkSub: "Contesta 4 preguntas rápidas y agenda una llamada con el equipo. Sin compromiso — resolvemos todas tus dudas y tú decides.",
    q1: "¿Qué tipo de trabajos haces?", q1o: ["Residencial", "Comercial", "Ambos", "Otro"],
    q2: "¿De qué tamaño es tu equipo?", q2o: ["Solo yo", "2–5", "6–10", "Más de 10"],
    q3: "¿Cuánto facturas al mes (aprox.)?", q3o: ["Menos de $10k", "$10k–$30k", "$30k–$80k", "Más de $80k"],
    q4: "¿Cuánto inviertes en marketing al mes?", q4o: ["Nada todavía", "Menos de $500", "$500–$2,000", "Más de $2,000"],
    q5: "Último paso — ¿a dónde te llamamos?", back: "← Atrás", qStep: "Pregunta {n} de 5",
    fName: "Tu nombre", fBiz: "Nombre de tu negocio", fPhone: "Tu teléfono (celular)", fBtn: "AGENDAR MI LLAMADA →", fOk: "✓ ¡Listo! El equipo te contacta hoy mismo para apartar tu hora.",
    fSafe: "Sin compromiso · Te llamamos hoy · No spam", fErr: "Pon tus 10 dígitos, ej. 956 555 0188", formErr: "No se pudo enviar — revisa tu conexión e intenta de nuevo, o llámanos.",
    fOkTry: "Mientras te llamamos, prueba la&nbsp;app&nbsp;→",
    fBook: "📅 ¿Quieres apartar tu hora AHORA? Elige el espacio que te quede mejor:",
    foot: `ALTO Pro · Hecho en Texas 🤠 · <a href="https://app.alto-pro.com">app.alto-pro.com</a> · <a href="/privacidad">Privacidad</a>`,
    consent: `Al enviar, aceptas que ALTO Pro te contacte por llamada, SMS o WhatsApp. No vendemos tus datos. <a href="/privacidad" target="_blank" style="color:inherit">Privacidad</a>`,
  };
  // ── Fence vertical (/cercas): same page, fence copy pack — the engine
  // pattern. Only the strings that talk about roofs are overridden; layout,
  // funnel, pixel and forms are shared. IMPORTANT: the fence quote flow is
  // material + yard size (no satellite), so this copy promises instant
  // quotes, never satellite measuring.
  if (fence) Object.assign(L, en ? {
    langHref: "/cercas?lang=es",
    title: "ALTO Pro Cercas — Quote any fence from anywhere",
    desc: "The all-in-one tool for fence contractors: quote from anywhere, formal invoices from your phone, plus a website that captures customers 24/7. Plans from $67/mo.",
    ogTitle: "ALTO Pro Cercas — Win more jobs. Quote any fence from anywhere.",
    ogDesc: "Your customer picks material and yard size and sees their price range — plus a website that captures customers while you sleep. Try it live.",
    h1: "WIN MORE JOBS.<br>QUOTE ANY FENCE<br><em>FROM ANYWHERE</em>",
    sub: `The all-in-one tool for fence contractors — the customer picks <b>material and size</b> and sees their price range. Quote from anywhere and never lose a job. <b>Plus a website that captures customers while you sleep.</b>`,
    chips: ["🇺🇸 Bilingual", "🪵 Built for fence pros", "📲 No App Store"],
    tryAppSub: `Pick a material and yard size and watch exactly what your future customers would see — on YOUR website, with YOUR prices, live in seconds. Two free tries — then we'll show you how to get it. Yours from <b style="color:#101B30">$67/mo</b>.`,
    s1x: "From an ad, from Google, or because someone shared your link. Your website works even while you're setting posts.",
    s2x: `<b style="color:#D99E00">No name and phone, no price.</b> They pick their material and yard size and the quote tool calculates a range with YOUR prices — you edit them in the app anytime.`,
    leadsSub: "Watch it happen — a homeowner quotes their fence on your website and lands on your phone, ready for WhatsApp.",
    leads: ["<b>📥</b> Every lead buzzes in your pocket instantly", "<b>💰</b> Your prices, your range — raise them whenever you want", "<b>💬</b> WhatsApp message pre-written — one tap and you reply", "<b>🪵</b> Estimates from anywhere — material and size", "<b>🛒</b> It tells you the material each job needs — with real Home Depot prices, today's", "<b>🧾</b> Professional invoices with your logo"],
    ceKick: "FREE FENCE QUOTE", ceHead: "What does my new fence cost?",
    ceBtn: "GET MY FREE FENCE ESTIMATE →",
    ceResSub: "based on material and size",
    ceNotif: "New fence lead · just now", ceEmpty: "Your fence leads land here…",
    appSub: `You're on a job and the neighbor asks "how much for mine?" — you pick the material and size, and you send the formal quote right there.`,
    cap1: "Quoted from anywhere<br>with YOUR prices", cap2: "Exact measure?<br>Trace the fence line with your finger", cap3: "Formal quote with your<br>brand, ready to send",
    plans: [
      { tier: "PRO · THE TOOL", price: 67, who: "Just want the tool? The full ALTO Pro app, self-serve.", feats: ["Quote any fence from anywhere", "Material list with real Home Depot prices", "Formal quotes & invoices with your logo", "Jobs, payments & customers organized", "English y Español"] },
      { tier: "WIDGET · YOUR SITE", price: 197, hot: true, who: "Already have a website? We send you the code — you paste it in.", feats: ["Everything in Pro", "The fence quote tool on YOUR website", "Leads straight to your WhatsApp", "Works on WordPress, Wix, GoDaddy — any site"] },
      { tier: "COMPLETE · DONE FOR YOU", price: 297, who: "No website — or want a better one? We build it for you, with your brand.", feats: ["Everything in Widget", "Your professional website with your brand", "AI chat that answers customers 24/7", "Your domain (yourbusiness.com) is yours — by contract", "Bilingual support"] },
    ],
  } : {
    langHref: "/cercas?lang=en",
    title: "ALTO Pro Cercas — Cotiza cualquier cerca desde donde sea",
    desc: "La herramienta todo-en-uno para contratistas de cercas: cotiza desde donde sea, facturas formales desde tu teléfono, más una página web que capta clientes 24/7. Planes desde $67/mes.",
    ogTitle: "ALTO Pro Cercas — Gana más trabajos. Cotiza cualquier cerca desde donde sea.",
    ogDesc: "Tu cliente elige material y tamaño de patio y ve su rango de precio — más una página web que capta clientes mientras duermes. Pruébalo en vivo.",
    h1: "GANA MÁS TRABAJOS.<br>COTIZA CUALQUIER CERCA<br><em>DESDE DONDE SEA</em>",
    sub: `La herramienta todo-en-uno para contratistas de cercas — el cliente elige <b>material y tamaño</b> y ve su rango de precio. Cotiza desde donde estés y no pierdas ni un trabajo. <b>Más una página web que te capta clientes mientras duermes.</b>`,
    chips: ["🇺🇸 En español", "🪵 Hecho para cercas", "📲 Sin App Store"],
    tryAppSub: `Elige material y tamaño de patio y mira exactamente lo que verían tus futuros clientes — en TU página, con TUS precios, en segundos. Dos pruebas gratis — luego te decimos cómo tenerlo. Desde <b style="color:#101B30">$67/mes</b>.`,
    s1x: "De un anuncio, de Google, o porque alguien le pasó tu link. Tu página trabaja aunque tú estés poniendo postes.",
    s2x: `<b style="color:#D99E00">Sin nombre y teléfono, no hay precio.</b> El cliente elige material y tamaño de su patio y el cotizador calcula un rango con TUS precios — los editas en la app cuando quieras.`,
    leadsSub: "Míralo pasar — un cliente cotiza su cerca en tu página web y cae en tu teléfono, listo para WhatsApp.",
    leads: ["<b>📥</b> Cada lead suena en tu bolsillo al instante", "<b>💰</b> Tus precios, tu rango — los subes cuando quieras", "<b>💬</b> Mensaje de WhatsApp ya escrito — un tap y contestas", "<b>🪵</b> Estimados desde donde sea — material y tamaño", "<b>🛒</b> Te dice el material que lleva cada trabajo — con precios reales de Home Depot, los de HOY", "<b>🧾</b> Facturas profesionales con tu logo"],
    ceKick: "COTIZACIÓN GRATIS DE TU CERCA", ceHead: "¿Cuánto cuesta mi cerca nueva?",
    ceBtn: "VER MI PRECIO GRATIS →",
    ceResSub: "según el material y tamaño",
    ceNotif: "Nuevo lead de cerca · ahora mismo", ceEmpty: "Tus leads de cercas llegan aquí…",
    appSub: `Estás en un trabajo y el vecino te pregunta "¿cuánto por la mía?" — eliges el material y el tamaño, y le mandas la cotización formal ahí mismo.`,
    cap1: "Cotizada desde donde sea<br>con TUS precios", cap2: "¿Medida exacta?<br>Traza la línea de la cerca con tu dedo", cap3: "Cotización formal con tu<br>marca, lista para mandar",
    plans: [
      { tier: "PRO · LA APP", price: 67, who: "¿Solo quieres la herramienta? La app ALTO Pro completa, para ti solo.", feats: ["Cotiza cualquier cerca desde donde sea", "Lista de materiales con precios reales de Home Depot", "Cotizaciones y facturas formales con tu logo", "Trabajos, cobros y clientes organizados", "Español e inglés"] },
      { tier: "WIDGET · TU PÁGINA", price: 197, hot: true, who: "¿Ya tienes página web? Te mandamos el código — lo pegas y listo.", feats: ["Todo lo de Pro", "El cotizador de cercas en TU página", "Leads directo a tu WhatsApp", "Funciona en WordPress, Wix, GoDaddy — donde sea"] },
      { tier: "COMPLETO · TODO HECHO", price: 297, who: "¿Sin página, o quieres una mejor? La hacemos por ti, con tu marca.", feats: ["Todo lo de Widget", "Tu página web profesional con tu marca", "Chat con IA que atiende a tus clientes 24/7", "Tu dominio (tunegocio.com) es tuyo — por contrato", "Soporte en español"] },
    ],
  });
  const appB = appBase(req);
  const trialLink = `${appB}/?demo=${fence ? "fence" : "roof"}`;
  return `<!doctype html><html lang="${L.lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${L.title}</title>
<meta name="description" content="${L.desc}">
<meta property="og:title" content="${L.ogTitle}">
<meta property="og:description" content="${L.ogDesc}">
<meta property="og:image" content="${base}/landing/og.png?v=3">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:type" content="website">
<meta property="og:url" content="${base}${fence ? "/cercas" : "/"}">
<meta name="twitter:card" content="summary_large_image">
<meta name="facebook-domain-verification" content="p9jieaz9ygad3z6fw0z1uthqrww4g3">
<link rel="icon" href="/icon-192.png">
${pixelHead}
<style>
@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=Inter:wght@400;600;700;800&display=swap');
*{box-sizing:border-box;font-family:Inter,Arial,sans-serif;margin:0;-webkit-tap-highlight-color:transparent}
body{background:#fff;color:#101B30}
.bc{font-family:'Barlow Condensed',sans-serif}
.wrap{max-width:1020px;margin:0 auto;padding:0 22px}
nav{display:flex;align-items:center;justify-content:center;padding:30px 0 4px}
nav .lg img{height:66px;display:block}
.langpill{position:fixed;top:14px;right:16px;z-index:50;background:#101B30;color:#fff;border-radius:99px;padding:9px 17px;font-weight:800;font-size:13px;text-decoration:none;box-shadow:0 10px 26px rgba(16,27,48,.3)}
.hero{padding:48px 0 56px;text-align:center}
.hero h1{font-family:'Barlow Condensed',sans-serif;font-size:clamp(44px,8vw,80px);line-height:1.0;font-weight:800;letter-spacing:.5px}
.hero h1 em{color:#F8B408;font-style:normal}
.hero p{color:#5A6478;font-size:clamp(15px,2.5vw,19px);font-weight:600;margin:18px auto 0;max-width:620px;line-height:1.55}
.cta{display:inline-block;margin-top:30px;background:#F8B408;color:#101B30;font-weight:800;font-size:17px;padding:17px 36px;border-radius:14px;text-decoration:none;box-shadow:0 14px 34px rgba(248,180,8,.35)}
.cta2{display:inline-block;margin-top:30px;margin-left:12px;color:#101B30;font-weight:700;font-size:15px;padding:17px 24px;text-decoration:none;border:1.5px solid #DDE3EE;border-radius:14px}
.chips{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:26px}
.chip{background:#F4F7FB;border:1px solid #E6EBF3;border-radius:99px;padding:8px 16px;font-size:13px;font-weight:700;color:#44506A}
section{padding:64px 0}
.band{background:#F7F9FC}
.dark{background:#101B30;color:#fff}
.sec-t{font-family:'Barlow Condensed',sans-serif;font-size:clamp(32px,5vw,48px);font-weight:800;text-align:center;line-height:1.05}
.sec-t em{color:#F8B408;font-style:normal}
.sec-sub{color:#5A6478;text-align:center;font-weight:600;margin:12px auto 34px;max-width:600px;font-size:15px;line-height:1.6}
.dark .sec-sub{color:#9DA8C4}
.demo-frame{background:#fff;border:1px solid #E6EBF3;border-radius:26px;padding:10px;max-width:460px;margin:0 auto;box-shadow:0 26px 70px rgba(16,27,48,.13)}
.demo-frame iframe{width:100%;height:540px;border:0;border-radius:18px;display:block}
.steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:18px}
.step{background:#fff;border:1px solid #E8ECF3;border-radius:22px;padding:28px;box-shadow:0 10px 30px rgba(16,27,48,.05)}
.step .n{font-family:'Barlow Condensed',sans-serif;color:#F8B408;font-size:44px;font-weight:800}
.step h3{font-size:18px;margin:8px 0 8px}
.step p{color:#5A6478;font-size:14px;font-weight:600;line-height:1.6}
/* ── Cause-and-effect demo: homeowner quotes on the site → lead lands on the phone ── */
.cegrid{position:relative;display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:center;gap:38px;margin-top:36px}
.celap{flex:1 1 330px;max-width:520px;min-width:0}
.cebrowser{background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 30px 70px rgba(0,0,0,.45)}
.cebar{display:flex;align-items:center;gap:10px;background:#EDF0F5;padding:9px 12px}
.cdots i{display:inline-block;width:9px;height:9px;border-radius:99px;background:#C9CDD6;margin-right:4px}
.ceurl{flex:1;background:#fff;border-radius:8px;padding:4px 12px;font-size:11px;font-weight:700;color:#67718A}
.cesite{padding:0 0 16px;color:#101B30}
.cenav{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 16px;border-bottom:1px solid #EDF0F5}
.cenav b{font-size:13px;letter-spacing:.4px}.cenav b em{color:#B30F24;font-style:normal}
.celinks{color:#8A94A8;font-weight:600;font-size:10.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cehero{padding:14px 16px 4px;text-align:center}
.cekick{color:#B30F24;font-weight:800;font-size:10px;letter-spacing:2px}
.cehead{font-family:'Barlow Condensed',sans-serif;font-size:24px;font-weight:800;margin-top:2px}
.cewidget{background:#F7F9FC;border:1.5px solid #E8ECF3;border-radius:16px;margin:12px 14px 0;padding:13px}
.cefield{background:#fff;border:1.5px solid #E4E7EC;border-radius:10px;padding:9px 12px;font-size:12.5px;font-weight:600;margin-bottom:8px;min-height:36px;text-align:left;color:#101B30}
.cefield .ph{color:#A7AEBE;font-weight:500}
.caret{display:inline-block;width:2px;height:13px;background:#101B30;margin-left:1px;vertical-align:-2px;opacity:0}
.cefield.on .caret{opacity:1;animation:ceblink 1s steps(1) infinite}
@keyframes ceblink{50%{opacity:0}}
.cebtn{width:100%;background:#B30F24;color:#fff;border:none;border-radius:10px;padding:11px;font-weight:800;font-size:12.5px;cursor:default;transition:transform .15s,background .2s;box-shadow:none}
.cebtn.press{transform:scale(.96)}
.cebtn.sent{background:#1E7B3C}
.ceresult{display:none;background:#101B30;border-radius:12px;color:#fff;text-align:center;padding:12px;margin-top:10px}
.ceresult.on{display:block;animation:cepop .5s cubic-bezier(.2,1.4,.4,1)}
@keyframes cepop{0%{transform:scale(.6);opacity:0}100%{transform:scale(1);opacity:1}}
.ceresult small{display:block;color:#F8B408;font-weight:800;font-size:9px;letter-spacing:1.5px}
.ceresult b{font-size:20px;font-family:'Barlow Condensed',sans-serif}
.ceresult span{display:block;color:#9DA8C4;font-size:10.5px;font-weight:600}
.cephone{width:262px;background:#0B1226;border:9px solid #1E2A45;border-radius:40px;padding:16px 12px 22px;box-shadow:0 36px 90px rgba(0,0,0,.45);flex-shrink:0;max-width:100%}
.cenotch{width:100px;height:20px;background:#1E2A45;border-radius:0 0 13px 13px;margin:-16px auto 12px}
.cephone.shake{animation:ceshake .55s}
@keyframes ceshake{0%,100%{transform:rotate(0)}20%{transform:rotate(1.6deg)}40%{transform:rotate(-1.4deg)}60%{transform:rotate(1deg)}80%{transform:rotate(-.7deg)}}
.ceapp{background:#F4F6FA;border-radius:16px;padding:11px;color:#101B30;min-height:330px}
.ceapphead{font-weight:800;font-size:13px;display:flex;align-items:center;gap:7px}
.cebadge{background:#F8B408;color:#101B30;border-radius:99px;font-size:10px;font-weight:800;padding:3px 9px;margin-left:auto;visibility:hidden}
.cebadge.on{visibility:visible}
.cenotif{display:none;background:#101B30;color:#fff;border-radius:99px;font-size:10px;font-weight:700;padding:6px 11px;margin-top:9px;text-align:center}
.cenotif.on{display:block;animation:cedrop .4s ease}
@keyframes cedrop{0%{transform:translateY(-14px);opacity:0}100%{transform:translateY(0);opacity:1}}
.ceempty{color:#8A94A8;font-size:11px;font-weight:600;text-align:center;padding:26px 6px}
.celead{background:#fff;border:2px solid #F8B408;border-radius:13px;padding:10px 11px;font-size:11.5px;line-height:1.5;margin-top:9px}
.celead.in{animation:ceslide .45s cubic-bezier(.2,1.2,.4,1)}
@keyframes ceslide{0%{transform:translateY(-12px) scale(.95);opacity:0}100%{transform:none;opacity:1}}
.celead b{font-size:12.5px}
.cenew{background:#F8B408;color:#101B30;border-radius:99px;font-size:9px;font-weight:800;padding:2px 7px;margin-left:5px}
.cerange{color:#D99E00;font-weight:800}
.cewa{background:#25D366;color:#fff;border-radius:9px;text-align:center;font-weight:800;font-size:11px;padding:7px;margin-top:8px}
.cefly{position:absolute;z-index:5;font-size:22px;transition:transform .75s cubic-bezier(.3,.7,.4,1),opacity .75s;pointer-events:none}
.ben{max-width:520px;margin:34px auto 0;padding:0}
.ben li{list-style:none;padding:11px 0;font-weight:600;font-size:15.5px;color:#E7ECF6;border-bottom:1px solid rgba(255,255,255,.09)}
.ben li b{color:#F8B408}
.shots{display:flex;gap:28px;justify-content:center;flex-wrap:wrap;margin-bottom:10px}
.shot img{width:240px;border-radius:26px;border:1px solid #E6EBF3;display:block;box-shadow:0 22px 56px rgba(16,27,48,.14)}
.shot p{text-align:center;color:#5A6478;font-size:13px;font-weight:700;margin-top:13px;line-height:1.45}
.trygrid{display:flex;gap:44px;align-items:center;justify-content:center;flex-wrap:wrap}
.tryphone{width:300px;background:#0B1226;border:10px solid #1E2A45;border-radius:44px;padding:12px 8px 16px;box-shadow:0 36px 90px rgba(0,0,0,.35)}
.trynotch{width:110px;height:20px;background:#1E2A45;border-radius:0 0 14px 14px;margin:-12px auto 10px}
.tryphone video{width:100%;border:0;border-radius:26px;background:#0B1226;display:block}
.plans{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:20px;max-width:1010px;margin:0 auto}
.plan{position:relative;background:#fff;border:1px solid #E8ECF3;border-radius:26px;padding:34px 28px 28px;box-shadow:0 18px 50px rgba(16,27,48,.07);display:flex;flex-direction:column}
.plan.pop{border:2px solid #F8B408;box-shadow:0 26px 70px rgba(248,180,8,.18)}
.ptag{position:absolute;top:-13px;left:50%;transform:translateX(-50%);background:#F8B408;color:#101B30;border-radius:99px;font-size:11px;font-weight:800;letter-spacing:1px;padding:5px 16px;white-space:nowrap}
.ptier{text-align:center;font-size:12px;font-weight:800;letter-spacing:1.2px;color:#9097A3}
.pamt2{font-family:'Barlow Condensed',sans-serif;font-size:56px;font-weight:800;text-align:center;line-height:1;margin-top:8px}
.pamt2 small{font-size:20px;color:#67718A;font-weight:700}
.pfree{text-align:center;color:#8A94A8;font-weight:700;font-size:12.5px;margin-top:4px}
.pwho{color:#5A6478;font-weight:600;font-size:13.5px;text-align:center;margin:12px 0 4px;line-height:1.55}
.plan ul{list-style:none;padding:0;margin:14px 0 20px}
.plan li{padding:7px 0;font-weight:600;font-size:13.5px}
.plan li::before{content:"✓ ";color:#34A853;font-weight:800}
.pcta{display:block;margin-top:auto;background:#F8B408;color:#101B30;text-align:center;border-radius:13px;padding:15px;font-weight:800;text-decoration:none;font-size:15px;box-shadow:0 10px 26px rgba(248,180,8,.28)}
.quizcard{max-width:560px;margin:0 auto;background:#fff;color:#101B30;border:2.5px solid #F8B408;border-radius:28px;padding:36px 30px;box-shadow:0 0 0 6px rgba(248,180,8,.14),0 34px 90px rgba(0,0,0,.45)}
@media(max-width:520px){.quizcard{padding:26px 18px}}
.quiz{max-width:480px;margin:0 auto;position:relative}
.qcount{text-align:center;font-size:12px;font-weight:800;letter-spacing:1.2px;color:#B07A00;text-transform:uppercase;margin-bottom:10px}
.qbar{height:6px;background:#EDF0F5;border-radius:99px;margin-bottom:26px;overflow:hidden}
.qfill{height:100%;width:20%;background:#F8B408;border-radius:99px;transition:width .3s ease}
.qstep{display:none}
.qstep.on{display:block}
.qq{font-weight:800;font-size:19px;text-align:center;margin-bottom:18px}
.opts{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.opt{background:#fff;border:1.5px solid #DDE3EE;border-radius:14px;padding:18px 12px;font-weight:700;font-size:15px;color:#101B30;cursor:pointer;box-shadow:0 6px 18px rgba(16,27,48,.05)}
.opt:hover{border-color:#F8B408;background:#FFFBEF}
.opt.sel{border-color:#F8B408;background:#FFF3CF;box-shadow:0 0 0 3px rgba(248,180,8,.25)}
.qsafe{text-align:center;color:#8A94A8;font-size:12.5px;font-weight:700;margin-top:12px}
.qerr{display:none;color:#D93025;font-size:13px;font-weight:700;margin:-4px 0 10px;text-align:center}
.oktry{display:block;margin-top:12px;background:#101B30;color:#fff;border-radius:11px;padding:13px;font-weight:800;font-size:14.5px;text-decoration:none;text-align:center}
.qback{display:block;margin:18px auto 0;background:none;border:none;color:#8A94A8;font-weight:700;font-size:13px;cursor:pointer;box-shadow:none;width:auto;padding:6px 12px}
form{max-width:440px;margin:0 auto}
input{width:100%;padding:15px;border-radius:12px;border:1.5px solid #DDE3EE;background:#fff;color:#101B30;font-size:16px;font-weight:600;margin-bottom:10px;outline:none}
input:focus{border-color:#F8B408}
button{width:100%;padding:17px;border:none;border-radius:12px;background:#F8B408;color:#101B30;font-size:17px;font-weight:800;cursor:pointer;box-shadow:0 12px 30px rgba(248,180,8,.3)}
.ok-msg{display:none;background:#EAF8EF;border:1.5px solid #34A853;color:#1E7B3C;border-radius:12px;padding:14px;font-weight:700;text-align:center;margin-top:10px}
footer{padding:40px 0 54px;text-align:center;font-size:13px;color:#8A94A8;font-weight:600}
footer a{color:#8A94A8}
</style></head><body>
<a class="langpill" href="${langHref}">${L.langBtn}</a>
<div class="wrap">
<nav><span class="lg"><img src="/brand-logo.png" alt="ALTO Pro"></span></nav>
<div class="hero">
  <h1>${L.h1}</h1>
  <p>${L.sub}</p>
  <a class="cta" href="#demo">${L.cta1}</a><a class="cta2" href="#planes">${L.cta2}</a>
  <div class="chips">${L.chips.map((c) => `<span class="chip">${c}</span>`).join("")}</div>
</div>
</div>

<div class="band"><div class="wrap"><section id="demo" style="padding-bottom:70px">
  <h2 class="sec-t">${L.tryAppT}</h2>
  <p class="sec-sub">${L.tryAppSub}</p>
  <div class="trygrid">
    <div class="tryphone"><div class="trynotch"></div><video poster="/landing/${fence ? "fence-demo" : "app-demo"}-poster.jpg" autoplay muted loop playsinline preload="metadata"><source src="/landing/${fence ? "fence-demo" : "app-demo"}.webm" type="video/webm"><source src="/landing/${fence ? "fence-demo" : "app-demo"}.mp4" type="video/mp4"></video></div>
    <div class="demo-frame"><iframe src="/w/${fence ? "alto-cercas" : "alto-demo"}${en ? "?lang=en" : ""}" loading="lazy" title="Demo"></iframe></div>
  </div>
  <div style="text-align:center;margin-top:38px">
    <p style="font-weight:800;font-size:17px;margin-bottom:4px">${L.fullQ}</p>
    <p class="sec-sub" style="margin-bottom:18px">${L.fullSub}</p>
    <a class="cta" href="${fence ? "/ejemplo-cercas" : "/ejemplo"}" target="_blank">${L.fullBtn}</a>
  </div>
</section></div></div>

<div class="band"><div class="wrap"><section>
  <h2 class="sec-t">${L.howT}</h2>
  <div class="steps" style="margin-top:34px">
    <div class="step"><div class="n">1</div><h3>${L.s1t}</h3><p>${L.s1x}</p></div>
    <div class="step"><div class="n">2</div><h3>${L.s2t}</h3><p>${L.s2x}</p></div>
    <div class="step"><div class="n">3</div><h3>${L.s3t}</h3><p>${L.s3x}</p></div>
  </div>
</section></div></div>

<div class="dark"><div class="wrap"><section>
  <h2 class="sec-t">${L.leadsT}</h2>
  <p class="sec-sub">${L.leadsSub}</p>
  <div class="cegrid" id="cedemo">
    <div class="celap">
      <div class="cebrowser">
        <div class="cebar"><span class="cdots"><i></i><i></i><i></i></span><span class="ceurl">${fence ? "cercasgarcia.com" : "techosgarcia.com"}</span></div>
        <div class="cesite">
          <div class="cenav"><b>${fence ? "CERCAS" : "TECHOS"} <em>GARCÍA</em></b><span class="celinks">${L.ceLinks}</span></div>
          <div class="cehero"><p class="cekick">${L.ceKick}</p><p class="cehead">${L.ceHead}</p></div>
          <div class="cewidget">
            <div class="cefield" id="ce_addr">📍 <span>118 Palm Dr, McAllen, TX</span></div>
            <div class="cefield" id="ce_name"><span>María Sánchez</span><i class="caret"></i></div>
            <div class="cefield" id="ce_phone"><span>(832) 555-0164</span><i class="caret"></i></div>
            <button class="cebtn sent" id="ce_btn" type="button">${L.ceSent}</button>
            <div class="ceresult on" id="ce_result"><small>${L.ceResT}</small><b id="ce_range">$12,400 – $15,800</b><span>${L.ceResSub}</span></div>
          </div>
        </div>
      </div>
    </div>
    <div class="cephone" id="cephone">
      <div class="cenotch"></div>
      <div class="ceapp">
        <div class="ceapphead">📥 Leads <span class="cebadge on" id="ce_badge">${L.ceNew2}</span></div>
        <div class="cenotif on" id="ce_notif">📥 ${L.ceNotif}</div>
        <div id="ce_leads">
          <p class="ceempty" id="ce_empty" style="display:none">${L.ceEmpty}</p>
          <div class="celead"><b>María Sánchez</b><span class="cenew">${L.ceNew}</span><br>📍 118 Palm Dr · (832) 555-0164<br><span class="cerange">$12,400 – $15,800</span><div class="cewa">💬 WhatsApp</div></div>
          <div class="celead"><b>Carlos Pérez</b><span class="cenew">${L.ceNew}</span><br>📍 502 Britton Ave · (956) 555-0188<br><span class="cerange">$7,700 – $9,850</span><div class="cewa">💬 WhatsApp</div></div>
        </div>
      </div>
    </div>
  </div>
  <ul class="ben">${L.leads.map((x) => `<li>${x}</li>`).join("")}</ul>
</section></div></div>

<div class="band"><div class="wrap"><section id="planes">
  <h2 class="sec-t">${L.plansT}</h2>
  <p class="sec-sub">${L.plansSub}</p>
  <div class="plans">
    ${L.plans.map((p) => `<div class="plan${p.hot ? " pop" : ""}">
      ${p.hot ? `<span class="ptag">${L.pop}</span>` : ""}
      <p class="ptier">${p.tier}</p>
      <div class="pamt2">$${p.price}<small>${L.per}</small></div>
      <p class="pfree">${L.noSetup}</p>
      <p class="pwho">${p.who}</p>
      <ul>${p.feats.map((f) => `<li>${f}</li>`).join("")}</ul>
      <a class="pcta" href="#contacto">${L.planCta}</a>
    </div>`).join("")}
  </div>
  <p class="sec-sub" style="margin-top:28px;margin-bottom:0">${L.plansNote}</p>
</section></div></div>

<div class="dark"><div class="wrap"><section id="contacto">
  <h2 class="sec-t">${L.talkT}</h2>
  <p class="sec-sub">${L.talkSub}</p>
  <div class="quizcard">
  <div class="quiz" id="quiz">
    <p class="qcount" id="qcount">${L.qStep.replace("{n}", "1")}</p>
    <div class="qbar"><div class="qfill" id="qfill"></div></div>
    <div class="qstep on" data-q="work">
      <p class="qq">${L.q1}</p>
      <div class="opts">${L.q1o.map((o) => `<button type="button" class="opt" onclick="qPick('work','${o}',this)">${o}</button>`).join("")}</div>
    </div>
    <div class="qstep" data-q="crew">
      <p class="qq">${L.q2}</p>
      <div class="opts">${L.q2o.map((o) => `<button type="button" class="opt" onclick="qPick('crew','${o}',this)">${o}</button>`).join("")}</div>
    </div>
    <div class="qstep" data-q="revenue">
      <p class="qq">${L.q3}</p>
      <div class="opts">${L.q3o.map((o) => `<button type="button" class="opt" onclick="qPick('revenue','${o}',this)">${o}</button>`).join("")}</div>
    </div>
    <div class="qstep" data-q="marketing">
      <p class="qq">${L.q4}</p>
      <div class="opts">${L.q4o.map((o) => `<button type="button" class="opt" onclick="qPick('marketing','${o}',this)">${o}</button>`).join("")}</div>
    </div>
    <div class="qstep" data-q="contact">
      <p class="qq">${L.q5}</p>
      <form id="f" onsubmit="return sendLead(event)">
        <input id="fn" placeholder="${L.fName}" required>
        <input id="fbz" placeholder="${L.fBiz}" required>
        <input id="fp" placeholder="${L.fPhone}" type="tel" inputmode="numeric" required>
        <p class="qerr" id="fperr">${L.fErr}</p>
        <button>${L.fBtn}</button>
        <p class="qsafe">${L.fSafe}</p>
        <p style="font-size:10.5px;color:#8A94A8;line-height:1.55;margin:8px 2px 0">${L.consent}</p>
      </form>
    </div>
    <div class="ok-msg" id="okm">${L.fOk}<a class="oktry" href="${trialLink}" target="_blank" rel="noopener">${L.fOkTry}</a></div>
    ${GHL_BOOKING_URL ? `<div id="bookwrap" style="display:none;margin-top:14px"><p style="font-weight:800;font-size:15px;margin-bottom:10px">${L.fBook}</p><iframe id="bookfrm" style="width:100%;height:740px;border:1.5px solid #E4E7EC;border-radius:14px;background:#fff" title="Agenda"></iframe></div>` : ""}
    <button type="button" class="qback" id="qback" onclick="qBack()" style="display:none">${L.back}</button>
  </div>
  </div>
</section></div></div>
<div class="wrap"><footer>${L.foot}</footer></div>
<script>
var BOOK_URL=${JSON.stringify(GHL_BOOKING_URL)};
function track(ev){try{fetch('/api/track',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event:ev})})}catch(e){}}
track('visit');
var qAns={},qSteps=[].slice.call(document.querySelectorAll('.qstep')),qCur=0,qLock=false;
var QOF=${JSON.stringify(L.qStep)};
function qShow(i){
  qCur=Math.max(0,Math.min(qSteps.length-1,i));
  qSteps.forEach(function(st,k){st.classList.toggle('on',k===qCur)});
  document.getElementById('qcount').textContent=QOF.replace('{n}',qCur+1);
  document.getElementById('qfill').style.width=((qCur+1)/qSteps.length*100)+'%';
  document.getElementById('qback').style.display=qCur>0?'block':'none';
  if(qSteps[qCur].getAttribute('data-q')==='contact')setTimeout(function(){try{document.getElementById('fn').focus()}catch(e){}},250);
}
function qPick(key,val,btn){
  if(qLock)return;qLock=true;
  qAns[key]=val;track('quiz_'+key);
  if(btn){[].forEach.call(btn.parentNode.children,function(b){b.classList.remove('sel')});btn.classList.add('sel')}
  setTimeout(function(){qLock=false;qShow(qCur+1)},180);
}
function qBack(){qShow(qCur-1)}
document.getElementById('fp').addEventListener('input',function(){this.style.borderColor='#DDE3EE';document.getElementById('fperr').style.display='none'});
function sendLead(e){e.preventDefault();
  var fp=document.getElementById('fp'),ph=fp.value.replace(/\\D/g,'');
  if(ph.length<10){fp.style.borderColor='#D93025';document.getElementById('fperr').style.display='block';fp.focus();return false}
  var qbtn=e.target.querySelector('button');if(qbtn)qbtn.disabled=true;
  fetch('/api/widget/lead',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({slug:'alto-ventas',name:document.getElementById('fn').value,phone:ph,
      info:{src:'landing'${fence ? ",trade:'fence'" : ""},biz:document.getElementById('fbz').value.trim(),work:qAns.work||'',crew:qAns.crew||'',revenue:qAns.revenue||'',marketing:qAns.marketing||''}})})
  .then(function(r){return r.ok?r.json():null})
  .then(function(j){ if(qbtn)qbtn.disabled=false;
    // Only claim success when the lead REALLY saved — otherwise keep the form
    // and show a retry message (and never fire the Meta pixel on a failure).
    if(j&&j.ok){track('quiz_done');if(window.fbq)fbq('track','Lead');finishQuiz();}
    else{var el=document.getElementById('fperr');el.textContent=${JSON.stringify(L.formErr)};el.style.display='block';}
  }).catch(function(){if(qbtn)qbtn.disabled=false;var el=document.getElementById('fperr');el.textContent=${JSON.stringify(L.formErr)};el.style.display='block';});
  return false}
function finishQuiz(){
  qSteps.forEach(function(st){st.classList.remove('on')});
  document.getElementById('qback').style.display='none';
  document.getElementById('qcount').style.display='none';
  document.getElementById('qfill').style.width='100%';
  document.getElementById('okm').style.display='block';
  var bw=document.getElementById('bookwrap');
  if(bw&&BOOK_URL){
    var nm=document.getElementById('fn').value,ph=document.getElementById('fp').value.replace(/\\D/g,'');
    var sep=BOOK_URL.indexOf('?')>=0?'&':'?';
    document.getElementById('bookfrm').src=BOOK_URL+sep+'full_name='+encodeURIComponent(nm)+'&phone='+encodeURIComponent(ph);
    bw.style.display='block';
    setTimeout(function(){bw.scrollIntoView({behavior:'smooth',block:'start'})},400);
  }
}
/* Cause-and-effect demo: types like a homeowner, reveals the estimate, and
 * flies the lead to the phone. The server renders the FINISHED state, so
 * no-JS and reduced-motion visitors still see the whole story. */
(function(){
  var demo=document.getElementById('cedemo');
  if(!demo)return;
  var reduce=false;
  try{reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches}catch(e){}
  if(reduce||!('IntersectionObserver' in window))return;
  var CE=${JSON.stringify({ btn: L.ceBtn, sent: L.ceSent, nw: L.ceNew, new1: L.ceNew1, new2: L.ceNew2, ph1: L.cePhName, ph2: L.cePhPhone })};
  var P=[
    {n:'Carlos Pérez',a:'502 Britton Ave, Pharr, TX',as:'502 Britton Ave',p:'(956) 555-0188',r:'$7,700 – $9,850'},
    {n:'María Sánchez',a:'118 Palm Dr, McAllen, TX',as:'118 Palm Dr',p:'(832) 555-0164',r:'$12,400 – $15,800'}
  ];
  var addrS=document.getElementById('ce_addr').querySelector('span'),
      nameF=document.getElementById('ce_name'),nameS=nameF.querySelector('span'),
      phoneF=document.getElementById('ce_phone'),phoneS=phoneF.querySelector('span'),
      btn=document.getElementById('ce_btn'),result=document.getElementById('ce_result'),
      range=document.getElementById('ce_range'),badge=document.getElementById('ce_badge'),
      notif=document.getElementById('ce_notif'),leadsBox=document.getElementById('ce_leads'),
      empty=document.getElementById('ce_empty'),phone=document.getElementById('cephone');
  var visible=false,running=false;
  function sleep(ms){return new Promise(function(res){setTimeout(res,ms)})}
  function typeInto(f,s,txt,ms){
    f.classList.add('on');s.textContent='';s.classList.remove('ph');
    var i=0;
    return new Promise(function(res){
      (function tick(){
        if(!visible){f.classList.remove('on');res(false);return}
        if(i>=txt.length){f.classList.remove('on');res(true);return}
        s.textContent+=txt.charAt(i++);setTimeout(tick,ms);
      })();
    });
  }
  function formReset(p){
    btn.classList.remove('sent','press');btn.textContent=CE.btn;
    result.classList.remove('on');
    addrS.textContent=p.a;
    nameS.textContent=CE.ph1;nameS.classList.add('ph');
    phoneS.textContent=CE.ph2;phoneS.classList.add('ph');
  }
  function resetAll(){
    formReset(P[0]);
    badge.classList.remove('on');badge.textContent='';
    notif.classList.remove('on');
    var cards=leadsBox.querySelectorAll('.celead');
    for(var i=0;i<cards.length;i++)cards[i].parentNode.removeChild(cards[i]);
    empty.style.display='';
  }
  function fly(){
    var s=document.createElement('span');s.className='cefly';s.textContent='📥';
    var f=btn.getBoundingClientRect(),t=badge.getBoundingClientRect(),h=demo.getBoundingClientRect();
    s.style.left=(f.left-h.left+f.width/2-11)+'px';s.style.top=(f.top-h.top-4)+'px';
    demo.appendChild(s);
    requestAnimationFrame(function(){requestAnimationFrame(function(){
      s.style.transform='translate('+(t.left-f.left-f.width/2+t.width/2)+'px,'+(t.top-f.top)+'px) scale(.5)';
      s.style.opacity='.25';
    })});
    setTimeout(function(){if(s.parentNode)s.parentNode.removeChild(s)},850);
  }
  function addLead(p,count){
    empty.style.display='none';
    var d=document.createElement('div');d.className='celead in';
    d.innerHTML='<b>'+p.n+'</b><span class="cenew">'+CE.nw+'</span><br>📍 '+p.as+' · '+p.p+'<br><span class="cerange">'+p.r+'</span><div class="cewa">💬 WhatsApp</div>';
    leadsBox.insertBefore(d,empty.nextSibling);
    badge.textContent=count===1?CE.new1:CE.new2;badge.classList.add('on');
  }
  function cycle(i){
    var p=P[i];
    formReset(p);
    return sleep(700).then(function(){
      if(!visible)return false;
      return typeInto(nameF,nameS,p.n,60).then(function(ok){
        if(!ok)return false;
        return sleep(250).then(function(){return typeInto(phoneF,phoneS,p.p,45)}).then(function(ok2){
          if(!ok2)return false;
          return sleep(350).then(function(){
            if(!visible)return false;
            btn.classList.add('press');
            return sleep(180).then(function(){
              btn.classList.remove('press');btn.classList.add('sent');btn.textContent=CE.sent;
              return sleep(500);
            }).then(function(){
              range.textContent=p.r;result.classList.add('on');
              return sleep(800);
            }).then(function(){
              if(!visible)return false;
              fly();
              return sleep(700).then(function(){
                phone.classList.add('shake');notif.classList.add('on');
                addLead(p,i+1);
                setTimeout(function(){phone.classList.remove('shake')},650);
                return sleep(1400).then(function(){return true});
              });
            });
          });
        });
      });
    });
  }
  function loop(){
    if(running)return;running=true;
    (function round(){
      if(!visible){running=false;return}
      resetAll();
      sleep(600)
        .then(function(){return cycle(0)})
        .then(function(ok){return ok?cycle(1):false})
        .then(function(ok){
          if(!ok){running=false;return}
          sleep(2800).then(round);
        });
    })();
  }
  new IntersectionObserver(function(en){
    visible=en[0].isIntersecting;
    if(visible)loop();
  },{threshold:.35}).observe(demo);
})();
</script></body></html>`;
}

// Preview the landing on any host (and in dev) without touching DNS
app.get("/ventas", (req, res) => res.send(landingPage(req)));
// Fence-contractor sales landing: same page, fence copy pack. If the vertical
// is off, fall back to the roofing pitch rather than 404 a paid ad click.
app.get(["/cercas", "/ventas-cercas"], (req, res) => (FENCE_ENABLED ? res.send(landingPage(req, true)) : res.redirect("/ventas")));

/* ── App-only funnel (/app) — one page, one offer ──
 * The ads proved prospects want the APP and get confused by the 3-tier menu.
 * This page sells ONLY the $67 app: pain point (the money you burn driving
 * to quotes), a form-gated LIVE demo of the real PWA (lead → alto-ventas,
 * src "app-funnel", so setters follow up on non-buyers), a hard block after
 * 3 measures with the Stripe link right there, and a single price card.
 * The 3-try block is enforced by THIS page: the PWA iframe is same-origin,
 * so the parent polls the app's own localStorage counter (alto_demo_meas)
 * and overlays the buy screen — zero changes inside the app itself (the
 * app's 6/day cap stays as the backstop). Upsells happen AFTER purchase,
 * never on this page. */
function appFunnelPage(req, fence = false) {
  const base = canonBase(req);
  const en = req.query.lang === "en";
  const L = en ? {
    lang: "en", langBtn: "🇲🇽 Español", langHref: "/app?lang=es",
    title: "ALTO Pro — More quotes. Fewer miles.",
    desc: "Quote any roof from your phone: the satellite measures it in 60 seconds and you send the formal quote without driving to the house. Try it live right here. $67/mo.",
    h1: "MORE QUOTES.<br><em>FEWER MILES.</em>",
    sub: `Quote any roof from your phone — the satellite measures it in 60 seconds and you send the formal quote without driving to the house. Imagine the gas, the hours and the trips you get back. <b>On your phone AND on your computer.</b>`,
    cta1: "TRY IT FREE ↓", cta2: "7 days free — then $67/mo",
    chips: ["🇺🇸 Bilingual", "📲 No App Store", "🖥️ Phone + computer"],
    tryT: "TRY IT <em>RIGHT HERE</em>",
    trySub: `The real app, live — not a video. Leave your name and phone and measure a real roof right now. <b>3 free measurements.</b>`,
    fT: "Who's trying it?", fName: "Your name", fBiz: "Your business name (optional)", fPhone: "Your phone (mobile)", fBtn: "OPEN THE APP →",
    fErr: "Enter your 10-digit number, e.g. 956 555 0188", sendErr: "Couldn't send — check your connection and try again.",
    consent: `By submitting, you agree that ALTO Pro may contact you by call, SMS or WhatsApp. We never sell your data. <a href="/privacidad" target="_blank" style="color:inherit">Privacy</a>`,
    deskNote: "🖥️ You also get it on your computer — same account, big screen for the office.",
    blockT: "🚀 See how easy that was?",
    blockSub: "You've used your 3 free measurements. That's how easily you save the time, the gas and the trips — you quote from wherever you are, without driving to every house. Imagine the money you save with this app.",
    blockCta: "🚀 START MY 7 FREE DAYS",
    blockFine: "$0 today · $67/mo starting day 8 · cancel before and pay nothing",
    waMsg: "Hi 👋 I tried the ALTO Pro app and I want it.",
    getT: "ALL OF THIS IS <em>YOURS TODAY</em>",
    feats: ["<b>🛰️</b> Measure any roof by satellite in 60 seconds", "<b>✏️</b> Want to be sure? Trace it with your finger for the exact measurement", "<b>🧾</b> Formal quotes & invoices with your logo — ready for WhatsApp", "<b>📋</b> Jobs, customers and payments organized in one place", "<b>🖥️</b> The same app on your computer — big screen for the office", "<b>👥</b> Private contractor community — sales & marketing tips, videos, and masterminds with other contractors", "<b>🇺🇸</b> English and Spanish — you and your customer both get it"],
    priceKick: "ONE PLAN. NO FINE PRINT.",
    priceT: "THE FULL APP", per: "/mo",
    trialBadge: "🎁 7 DAYS FREE — $0 TODAY",
    priceBullets: ["7 days free — then $67/mo", "Cancel anytime — cancel before day 8 and pay nothing", "No setup fee", "Install it TODAY (no App Store)", "Phone + computer"],
    buyBtn: "🚀 START MY 7 FREE DAYS →",
    buyNote: "Register your card today ($0) and your app opens INSTANTLY — account created and active on the spot, any hour. The $67/mo starts on day 8; cancel before and pay nothing.",
    roi: "An average roof leaves you $2,000–$4,000. ONE extra job pays for the app for years.",
    commBadge: "🎁 INCLUDED FREE WITH YOUR ACCOUNT",
    commT: "MORE THAN AN APP: A COMMUNITY THAT <em>GROWS</em> YOUR BUSINESS.",
    commSub: `With your account you get FREE access to ALTO Pro's private community, where we share marketing and sales tips, videos and strategies to fill your calendar. You're getting in early — be one of the first contractors in the group where we grow together, side by side.`,
    commKick: "You're not buying an app. You're joining a team. 🤝",
    foot: `ALTO Pro · Made in Texas 🤠 · <a href="https://app.alto-pro.com">app.alto-pro.com</a> · <a href="/privacidad">Privacy</a>`,
  } : {
    lang: "es", langBtn: "🇺🇸 English", langHref: "/app?lang=en",
    title: "ALTO Pro — Más cotizaciones. Menos millas.",
    desc: "Cotiza cualquier techo desde tu celular: el satélite lo mide en 60 segundos y mandas la cotización formal sin manejar a la casa. Pruébala en vivo aquí mismo. $67/mes.",
    h1: "MÁS COTIZACIONES.<br><em>MENOS MILLAS.</em>",
    sub: `Cotiza cualquier techo desde tu celular — el satélite lo mide en 60 segundos y mandas la cotización formal sin manejar a la casa. Imagínate el gas, las horas y las vueltas que recuperas. <b>En tu teléfono Y en tu computadora.</b>`,
    cta1: "PROBARLA GRATIS ↓", cta2: "7 días gratis — luego $67/mes",
    chips: ["🇺🇸 En español", "📲 Sin App Store", "🖥️ Teléfono + computadora"],
    tryT: "PRUÉBALA <em>AQUÍ MISMO</em>",
    trySub: `La app de verdad, en vivo — no un video. Deja tu nombre y teléfono y mide un techo real ahora mismo. <b>3 mediciones gratis.</b>`,
    fT: "¿Quién la va a probar?", fName: "Tu nombre", fBiz: "Nombre de tu negocio (opcional)", fPhone: "Tu teléfono (celular)", fBtn: "ABRIR LA APP →",
    fErr: "Pon tus 10 dígitos, ej. 956 555 0188", sendErr: "No se pudo enviar — revisa tu conexión e intenta de nuevo.",
    consent: `Al enviar, aceptas que ALTO Pro te contacte por llamada, SMS o WhatsApp. No vendemos tus datos. <a href="/privacidad" target="_blank" style="color:inherit">Privacidad</a>`,
    deskNote: "🖥️ También la tienes en tu computadora — misma cuenta, pantalla grande para la oficina.",
    blockT: "🚀 ¿Viste qué fácil?",
    blockSub: "Ya usaste tus 3 mediciones gratis. Así de fácil te ahorras el tiempo, el gas y las vueltas — cotizas desde donde estés, sin manejar a cada casa. Imagínate el dinero que te ahorras teniendo esta aplicación.",
    blockCta: "🚀 EMPEZAR MIS 7 DÍAS GRATIS",
    blockFine: "$0 hoy · $67/mes desde el día 8 · cancela antes y no pagas nada",
    waMsg: "Hola 👋 Probé la app de ALTO Pro y la quiero.",
    getT: "TODO ESTO ES <em>TUYO HOY</em>",
    feats: ["<b>🛰️</b> Mide cualquier techo por satélite en 60 segundos", "<b>✏️</b> ¿Quieres estar seguro? Trázalo con el dedo y saca la medida exacta", "<b>🧾</b> Cotizaciones y facturas formales con tu logo — listas para WhatsApp", "<b>📋</b> Trabajos, clientes y cobros organizados en un solo lugar", "<b>🖥️</b> La misma app en tu computadora — pantalla grande para la oficina", "<b>👥</b> Comunidad privada de contratistas — tips de ventas y marketing, videos, y masterminds con otros contratistas", "<b>🇺🇸</b> Español e inglés — tú y tu cliente la entienden"],
    priceKick: "UN SOLO PLAN. SIN LETRAS CHIQUITAS.",
    priceT: "LA APP COMPLETA", per: "/mes",
    trialBadge: "🎁 7 DÍAS GRATIS — HOY PAGAS $0",
    priceBullets: ["7 días gratis — luego $67/mes", "Cancela cuando quieras — antes del día 8 no pagas nada", "Sin cargo de inicio", "La instalas HOY (sin App Store)", "Teléfono + computadora"],
    buyBtn: "🚀 EMPEZAR MIS 7 DÍAS GRATIS →",
    buyNote: "Registras tu tarjeta hoy ($0) y tu app se abre AL INSTANTE — cuenta creada y activa ahí mismo, a la hora que sea. Los $67/mes empiezan el día 8; cancela antes y no pagas nada.",
    roi: "Un techo promedio te deja $2,000–$4,000. UN trabajo extra paga la app por años.",
    commBadge: "🎁 INCLUIDO GRATIS CON TU CUENTA",
    commT: "MÁS QUE UNA APP: UNA COMUNIDAD QUE TE HACE <em>CRECER</em>.",
    commSub: `Con tu cuenta entras GRATIS a la comunidad privada de ALTO Pro, donde compartimos tips de marketing y ventas, videos y estrategias para llenar tu calendario. Estás entrando temprano — sé de los primeros contratistas del grupo donde nos ayudamos a crecer, uno al lado del otro.`,
    commKick: "No compras una app. Entras a un equipo. 🤝",
    foot: `ALTO Pro · Hecho en Texas 🤠 · <a href="https://app.alto-pro.com">app.alto-pro.com</a> · <a href="/privacidad">Privacidad</a>`,
  };
  // ── Fence twin (/app-cercas): same page, fence copy pack — the engine
  // pattern. The hook survives verbatim; only the trade words change. The
  // Stripe link carries client_reference_id so the webhook auto-provisions
  // the buyer's account with trade "fence".
  if (fence) Object.assign(L, en ? {
    langHref: "/app-cercas?lang=es",
    title: "ALTO Pro Cercas — Measure & quote fences from your phone",
    desc: "The satellite marks the lot, you draw the fence and the feet measure themselves — plus the material you need with real Home Depot prices. Try it live right here. $67/mo.",
    h1: "MEASURE & QUOTE FENCES<br><em>FROM YOUR PHONE.</em>",
    sub: `The satellite marks the lot, you draw the fence with your finger and the feet (posts, panels, gates) measure themselves. And it doesn't stop at measuring: the app tells you <b>how much material you need — with real Home Depot prices</b>. Send the formal quote without driving to the house. <b>On your phone AND on your computer.</b>`,
    trySub: `The real app, live — not a video. Leave your name and phone and quote a real fence right now. <b>3 free tries.</b>`,
    feats: ["<b>🛰️</b> The satellite marks the lot — the boundary draws itself", "<b>✏️</b> Draw the fence with your finger — the feet measure themselves", "<b>🚪</b> Single and double gates — deducted automatically", "<b>🛒</b> It tells you the material you need — posts, panels, concrete — with today's real Home Depot prices", "<b>🧾</b> Formal quotes & invoices with your logo — ready for WhatsApp", "<b>📋</b> Jobs, customers and payments organized in one place", "<b>🖥️</b> The same app on your computer — big screen for the office", "<b>👥</b> Private contractor community — sales & marketing tips, videos, and masterminds with other contractors", "<b>🇺🇸</b> English and Spanish — you and your customer both get it"],
    waMsg: "Hi 👋 I tried the ALTO Pro fence app and I want it.",
    roi: "An average fence leaves you $1,500–$3,000. ONE extra job pays for the app for years.",
  } : {
    langHref: "/app-cercas?lang=en",
    title: "ALTO Pro Cercas — Mide y cotiza cercas desde tu celular",
    desc: "El satélite marca el lote, dibujas la cerca y los pies se miden solos — más el material que necesitas con precios reales de Home Depot. Pruébala en vivo aquí mismo. $67/mes.",
    h1: "MIDE Y COTIZA CERCAS<br><em>DESDE TU CELULAR.</em>",
    sub: `El satélite marca el lote, dibujas la cerca con el dedo y los pies (postes, paneles, puertas) se miden solos. Y no se queda en medir: la app te dice <b>cuánto material necesitas — con precios reales de Home Depot</b>. Mandas la cotización formal sin manejar a la casa. <b>En tu teléfono Y en tu computadora.</b>`,
    trySub: `La app de verdad, en vivo — no un video. Deja tu nombre y teléfono y cotiza una cerca real ahora mismo. <b>3 pruebas gratis.</b>`,
    feats: ["<b>🛰️</b> El satélite marca el lote — el límite se dibuja solo", "<b>✏️</b> Dibuja la cerca con el dedo — los pies se miden solos", "<b>🚪</b> Puertas sencillas y dobles — se descuentan solas", "<b>🛒</b> Te dice el material que necesitas — postes, paneles, concreto — con precios reales de Home Depot HOY", "<b>🧾</b> Cotizaciones y facturas formales con tu logo — listas para WhatsApp", "<b>📋</b> Trabajos, clientes y cobros organizados en un solo lugar", "<b>🖥️</b> La misma app en tu computadora — pantalla grande para la oficina", "<b>👥</b> Comunidad privada de contratistas — tips de ventas y marketing, videos, y masterminds con otros contratistas", "<b>🇺🇸</b> Español e inglés — tú y tu cliente la entienden"],
    waMsg: "Hola 👋 Probé la app de cercas de ALTO Pro y la quiero.",
    roi: "Una cerca promedio te deja $1,500–$3,000. UN trabajo extra paga la app por años.",
  });
  const appSrc = `${appBase(req)}/?demo=${fence ? "fence" : "roof"}&clean=1`;
  // client_reference_id rides the Payment Link into the checkout session so
  // the webhook knows which trade to auto-provision (app-cercas → fence).
  const buyHref = STRIPE_LINKS.pro
    ? STRIPE_LINKS.pro + (STRIPE_LINKS.pro.includes("?") ? "&" : "?") + "client_reference_id=" + (fence ? "app-cercas" : "app")
    : `https://wa.me/${SALES_WA}?text=${encodeURIComponent(L.waMsg)}`;
  return `<!doctype html><html lang="${L.lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${L.title}</title>
<meta name="description" content="${L.desc}">
<meta property="og:title" content="${L.title}">
<meta property="og:description" content="${L.desc}">
<meta property="og:image" content="${base}/landing/${fence ? "og-app-cercas.jpg?v=2" : "og-app.jpg?v=2"}">
<meta property="og:image:width" content="1800">
<meta property="og:image:height" content="945">
<meta property="og:type" content="website">
<meta property="og:url" content="${base}${fence ? "/app-cercas" : "/app"}">
<link rel="icon" href="/icon-192.png">
${metaPixelHead()}
<style>
@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=Inter:wght@400;600;700;800&display=swap');
*{box-sizing:border-box;font-family:Inter,Arial,sans-serif;margin:0;-webkit-tap-highlight-color:transparent}
body{background:#fff;color:#101B30}
.wrap{max-width:1020px;margin:0 auto;padding:0 22px}
nav{display:flex;align-items:center;justify-content:center;padding:30px 0 4px}
nav .lg img{height:66px;display:block}
.langpill{position:fixed;top:14px;right:16px;z-index:50;background:#101B30;color:#fff;border-radius:99px;padding:9px 17px;font-weight:800;font-size:13px;text-decoration:none;box-shadow:0 10px 26px rgba(16,27,48,.3)}
.hero{padding:48px 0 56px;text-align:center}
.hero h1{font-family:'Barlow Condensed',sans-serif;font-size:clamp(44px,8vw,80px);line-height:1.0;font-weight:800;letter-spacing:.5px}
.hero h1 em{color:#F8B408;font-style:normal}
.hero p{color:#5A6478;font-size:clamp(15px,2.5vw,19px);font-weight:600;margin:18px auto 0;max-width:620px;line-height:1.55}
.cta{display:inline-block;margin-top:30px;background:#F8B408;color:#101B30;font-weight:800;font-size:17px;padding:17px 36px;border-radius:14px;text-decoration:none;box-shadow:0 14px 34px rgba(248,180,8,.35)}
.cta2{display:inline-block;margin-top:30px;margin-left:12px;color:#101B30;font-weight:700;font-size:15px;padding:17px 24px;text-decoration:none;border:1.5px solid #DDE3EE;border-radius:14px}
.chips{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:26px}
.chip{background:#F4F7FB;border:1px solid #E6EBF3;border-radius:99px;padding:8px 16px;font-size:13px;font-weight:700;color:#44506A}
section{padding:64px 0}
.band{background:#F7F9FC}
.sec-t{font-family:'Barlow Condensed',sans-serif;font-size:clamp(32px,5vw,48px);font-weight:800;text-align:center;line-height:1.05}
.sec-t em{color:#F8B408;font-style:normal}
.sec-sub{color:#5A6478;text-align:center;font-weight:600;margin:12px auto 34px;max-width:600px;font-size:15px;line-height:1.6}
.trygrid{display:flex;gap:44px;align-items:center;justify-content:center;flex-wrap:wrap}
.tryphone{width:300px;background:#0B1226;border:10px solid #1E2A45;border-radius:44px;padding:12px 8px 16px;box-shadow:0 36px 90px rgba(0,0,0,.35)}
.trynotch{width:110px;height:20px;background:#1E2A45;border-radius:0 0 14px 14px;margin:-12px auto 10px}
.tryphone video{width:100%;border:0;border-radius:26px;background:#0B1226;display:block}
.gatecard{background:#fff;border:1px solid #E8ECF3;border-radius:24px;padding:30px 28px;max-width:430px;flex:1 1 320px;box-shadow:0 20px 54px rgba(16,27,48,.09)}
.gatecard h3{font-size:20px;margin-bottom:14px}
.gatecard input{width:100%;font-family:inherit;padding:15px 16px;border-radius:13px;border:1.5px solid #E4E7EC;font-size:16px;font-weight:500;outline:none;margin-bottom:10px}
.gatecard input:focus{border-color:#F8B408;box-shadow:0 0 0 4px rgba(248,180,8,.18)}
.gatecard button{width:100%;background:#F8B408;color:#101B30;border:none;border-radius:13px;padding:16px;font-weight:800;cursor:pointer;font-size:16.5px;box-shadow:0 8px 20px rgba(248,180,8,.32)}
.gerr{display:none;color:#D93025;font-weight:700;font-size:13px;margin:4px 0 6px}
.appwrap{display:none;max-width:430px;margin:0 auto}
.appframe{position:relative;background:#fff;border:1px solid #E6EBF3;border-radius:26px;padding:10px;box-shadow:0 26px 70px rgba(16,27,48,.13)}
.appframe iframe{width:100%;height:640px;border:0;border-radius:18px;display:block}
.blockov{display:none;position:absolute;inset:10px;border-radius:18px;background:rgba(255,255,255,.97);z-index:5;flex-direction:column;justify-content:center;padding:26px;text-align:center}
.blockov h3{font-size:22px;margin-bottom:10px}
.blockov p{color:#475067;font-weight:600;line-height:1.6;font-size:14.5px;margin-bottom:18px}
.blockov .bbuy{display:block;background:#F8B408;color:#101B30;border-radius:14px;padding:16px;font-weight:800;font-size:16px;text-decoration:none;box-shadow:0 8px 20px rgba(248,180,8,.32)}
.blockov .bfine{color:#8A94A8;font-size:11.5px;font-weight:700;margin-top:10px}
.ptrial{display:inline-block;background:#FEF9E9;border:1.5px solid #F4DE9A;color:#7A5A00;border-radius:99px;padding:7px 16px;font-weight:800;font-size:13px;margin:10px 0 6px}
.desknote{color:#67718A;text-align:center;font-weight:600;font-size:13px;margin-top:14px}
.featlist{max-width:560px;margin:0 auto;list-style:none;padding:0}
.featlist li{display:flex;gap:14px;align-items:flex-start;background:#fff;border:1px solid #E8ECF3;border-radius:16px;padding:16px 18px;margin-bottom:10px;font-weight:600;font-size:15px;line-height:1.5;box-shadow:0 6px 20px rgba(16,27,48,.04)}
.featlist b{font-size:20px;font-weight:400}
.pcard{background:#fff;border:2px solid #F8B408;border-radius:26px;padding:38px 32px;max-width:430px;margin:0 auto;text-align:center;box-shadow:0 30px 80px rgba(248,180,8,.18)}
.pkick{font-size:11.5px;font-weight:800;letter-spacing:1.5px;color:#B07A00}
.pname{font-family:'Barlow Condensed',sans-serif;font-size:30px;font-weight:800;margin:8px 0 2px}
.pprice{font-family:'Barlow Condensed',sans-serif;font-size:74px;font-weight:800;line-height:1}
.pprice small{font-size:22px;color:#67718A;font-weight:700}
.pb{list-style:none;padding:0;margin:18px 0 22px;text-align:left}
.pb li{padding:7px 0 7px 26px;position:relative;font-weight:600;font-size:14.5px;color:#1B2433}
.pb li:before{content:"✓";position:absolute;left:2px;color:#1E7B3C;font-weight:800}
.pbuy{display:block;background:#F8B408;color:#101B30;border-radius:14px;padding:17px;font-weight:800;font-size:17px;text-decoration:none;box-shadow:0 10px 26px rgba(248,180,8,.35)}
.pnote{color:#67718A;font-size:12.5px;font-weight:600;margin-top:14px;line-height:1.55}
.roi{max-width:430px;margin:22px auto 0;background:#FEF9E9;border:1.5px solid #F4DE9A;border-radius:16px;padding:14px 18px;text-align:center;font-weight:700;font-size:14px;color:#7A5A00}
.commwrap{padding:8px 0 6px}
.comm{position:relative;overflow:hidden;max-width:660px;margin:0 auto;background:linear-gradient(135deg,#101B30,#1C2C4B);border-radius:26px;padding:42px 34px;text-align:center;color:#fff;box-shadow:0 30px 80px rgba(16,27,48,.24)}
.comm .cbadge{display:inline-block;background:#F8B408;color:#101B30;font-weight:800;font-size:12px;letter-spacing:.4px;border-radius:99px;padding:8px 17px;margin-bottom:18px}
.comm h2{font-family:'Barlow Condensed',sans-serif;font-size:clamp(28px,4.6vw,44px);font-weight:800;line-height:1.05;margin:0 auto 16px;max-width:600px}
.comm h2 em{color:#F8B408;font-style:normal}
.comm p{color:#C7D0E4;font-size:clamp(14px,2.2vw,17px);font-weight:600;line-height:1.62;max-width:540px;margin:0 auto}
.comm .ckick{color:#fff;font-weight:800;font-size:15.5px;margin-top:20px}
footer{padding:40px 0 54px;text-align:center;font-size:13px;color:#8A94A8;font-weight:600}
footer a{color:#8A94A8}
</style></head><body>
<a class="langpill" href="${L.langHref}">${L.langBtn}</a>
<div class="wrap">
<nav><span class="lg"><img src="/brand-logo.png" alt="ALTO Pro"></span></nav>
<div class="hero">
  <h1>${L.h1}</h1>
  <p>${L.sub}</p>
  <a class="cta" href="#probar">${L.cta1}</a><a class="cta2" href="#precio">${L.cta2}</a>
  <div class="chips">${L.chips.map((c) => `<span class="chip">${c}</span>`).join("")}</div>
</div>
</div>

<div class="wrap"><section id="probar">
  <h2 class="sec-t">${L.tryT}</h2>
  <p class="sec-sub">${L.trySub}</p>
  <div id="gate" class="trygrid">
    <div class="tryphone"><div class="trynotch"></div><video poster="/landing/${fence ? "fence-demo" : "app-demo"}-poster.jpg" autoplay muted loop playsinline preload="metadata"><source src="/landing/${fence ? "fence-demo" : "app-demo"}.webm" type="video/webm"><source src="/landing/${fence ? "fence-demo" : "app-demo"}.mp4" type="video/mp4"></video></div>
    <div class="gatecard">
      <h3>${L.fT}</h3>
      <form id="gf" onsubmit="return gateSend(event)">
        <input id="gn" placeholder="${L.fName}" required>
        <input id="gb" placeholder="${L.fBiz}" autocomplete="organization">
        <input id="gp" placeholder="${L.fPhone}" type="tel" inputmode="numeric" required>
        <p class="gerr" id="gerr">${L.fErr}</p>
        <button>${L.fBtn}</button>
        <p style="font-size:10.5px;color:#8A94A8;line-height:1.55;margin:10px 2px 0">${L.consent}</p>
      </form>
    </div>
  </div>
  <div id="appwrap" class="appwrap">
    <div class="appframe">
      <iframe id="appfrm" title="ALTO Pro" allow="geolocation"></iframe>
      <div class="blockov" id="blockov">
        <h3>${L.blockT}</h3>
        <p>${L.blockSub}</p>
        <a class="bbuy" href="${buyHref}" target="_blank" rel="noopener" onclick="buyClick()">${L.blockCta}</a>
        <p class="bfine">${L.blockFine}</p>
      </div>
    </div>
    <p class="desknote">${L.deskNote}</p>
  </div>
</section></div>

<div class="band"><div class="wrap"><section>
  <h2 class="sec-t">${L.getT}</h2>
  <ul class="featlist" style="margin-top:34px">${L.feats.map((f) => `<li>${f}</li>`).join("")}</ul>
</section></div></div>

<div class="wrap"><section class="commwrap">
  <div class="comm">
    <span class="cbadge">${L.commBadge}</span>
    <h2>${L.commT}</h2>
    <p>${L.commSub}</p>
    <p class="ckick">${L.commKick}</p>
  </div>
</section></div>

<div class="wrap"><section id="precio">
  <div class="pcard">
    <p class="pkick">${L.priceKick}</p>
    <p class="pname">${L.priceT}</p>
    <p class="ptrial">${L.trialBadge}</p>
    <p class="pprice">$67<small>${L.per}</small></p>
    <ul class="pb">${L.priceBullets.map((b) => `<li>${b}</li>`).join("")}</ul>
    <a class="pbuy" href="${buyHref}" target="_blank" rel="noopener" onclick="buyClick()">${L.buyBtn}</a>
    <p class="pnote">${L.buyNote}</p>
  </div>
  <div class="roi">💰 ${L.roi}</div>
</section></div>
<div class="wrap"><footer>${L.foot}</footer></div>
<script>
var APP_SRC=${JSON.stringify(appSrc)};
var FUNNEL=${JSON.stringify(fence ? "app-cercas" : "app")};
var blockShown=false,tryShown=false;
function track(ev){try{fetch('/api/track',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event:ev})})}catch(e){}}
/* First-touch attribution: the ad link carries utm_* — remember the FIRST
 * set this device arrived with so a return visit still credits the ad. */
var UTM={};
try{
  var sp=new URLSearchParams(location.search);
  var stored=JSON.parse(localStorage.getItem('alto_utm')||'null');
  if(sp.get('utm_source')||sp.get('utm_campaign')||sp.get('utm_content')){
    UTM={source:sp.get('utm_source')||'',campaign:sp.get('utm_campaign')||'',content:sp.get('utm_content')||''};
    if(!stored)localStorage.setItem('alto_utm',JSON.stringify(UTM));else UTM=stored;
  }else if(stored){UTM=stored}
}catch(e){}
function crSlug(){return String(UTM.content||UTM.campaign||'').toLowerCase().replace(/[^a-z0-9_-]/g,'-').replace(/^-+|-+$/g,'').slice(0,40)}
function trackStep(step){
  track('fn:'+FUNNEL+':'+step);
  var s=crSlug();
  if(s&&(step==='visit'||step==='lead'||step==='buy'))track('cr:'+FUNNEL+':'+step+':'+s);
}
trackStep('visit');
function demoUsed(){try{return parseInt(localStorage.getItem('alto_demo_meas')||'0',10)||0}catch(e){return 0}}
function checkBlock(){
  var used=demoUsed();
  // activation: the FIRST real measurement in the embedded app
  if(used>=1&&!tryShown){tryShown=true;
    try{if(localStorage.getItem('alto_try_'+FUNNEL)!=='1'){localStorage.setItem('alto_try_'+FUNNEL,'1');trackStep('try')}}catch(e){trackStep('try')}
  }
  if(used<3)return;
  document.getElementById('blockov').style.display='flex';
  if(!blockShown){blockShown=true;
    try{if(localStorage.getItem('alto_blk_'+FUNNEL)!=='1'){localStorage.setItem('alto_blk_'+FUNNEL,'1');trackStep('block')}}catch(e){trackStep('block')}
  }
}
function unlockUI(){
  document.getElementById('gate').style.display='none';
  document.getElementById('appwrap').style.display='block';
  var f=document.getElementById('appfrm');
  if(!f.getAttribute('src'))f.setAttribute('src',APP_SRC);
  checkBlock();setInterval(checkBlock,800);
}
function gateSend(e){e.preventDefault();
  var ph=document.getElementById('gp').value.replace(/\\D/g,'');
  var gerr=document.getElementById('gerr');
  if(ph.length<10){gerr.textContent=${JSON.stringify(L.fErr)};gerr.style.display='block';return false}
  gerr.style.display='none';
  var btn=e.target.querySelector('button');btn.disabled=true;
  fetch('/api/widget/lead',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({slug:'alto-ventas',name:document.getElementById('gn').value.trim(),phone:ph,
      info:{src:'app-funnel',funnel:FUNNEL,trade:${JSON.stringify(fence ? "fence" : "roofing")},biz:document.getElementById('gb').value.trim(),
        utm_source:UTM.source||'',utm_campaign:UTM.campaign||'',utm_content:UTM.content||''}})})
  .then(function(r){return r.ok?r.json():null})
  .then(function(j){btn.disabled=false;
    if(j&&j.ok){
      try{localStorage.setItem('alto_app_lead','1')}catch(e){}
      trackStep('lead');if(window.fbq)fbq('track','Lead');
      unlockUI();
      document.getElementById('appwrap').scrollIntoView({behavior:'smooth',block:'center'});
    }else{gerr.textContent=${JSON.stringify(L.sendErr)};gerr.style.display='block'}
  }).catch(function(){btn.disabled=false;gerr.textContent=${JSON.stringify(L.sendErr)};gerr.style.display='block'});
  return false}
function buyClick(){trackStep('buy');if(window.fbq)fbq('track','InitiateCheckout')}
try{if(localStorage.getItem('alto_app_lead')==='1')unlockUI()}catch(e){}
</script></body></html>`;
}
app.get(["/app", "/aplicacion"], (req, res) => {
  res.set("Content-Type", "text/html; charset=utf-8");
  res.send(appFunnelPage(req));
});
// Fence twin: same funnel, fence copy pack. Vertical off → keep the ad click.
app.get(["/app-cercas", "/aplicacion-cercas"], (req, res) => {
  if (!FENCE_ENABLED) return res.redirect("/app");
  res.set("Content-Type", "text/html; charset=utf-8");
  res.send(appFunnelPage(req, true));
});

/* ── VSL funnels (/video, /completo) — built video-READY ──
 * The pages ship before the videos exist: the player slot auto-detects
 * public/landing/vsl-app.mp4 / vsl-completo.mp4 (+ optional -poster.jpg).
 * Until the file is there, a clean branded placeholder holds the spot; the
 * moment the owner commits the video, the real player appears with
 * watch-depth tracking (fn:<funnel>:play/watch25/50/75) — no code change.
 *  · /video   (vsl-app):      VSL → the $67 trial, sold directly.
 *  · /completo (vsl-completo): VSL → book the call (GHL_BOOKING_URL) with a
 *    "ya lo quiero" direct-pay escape for night closers ($297 link).
 * Same UTM first-touch + fn:/cr: analytics skeleton as the app funnels. */
// The team, copied from the owner's construction-co site as-is: photo, name,
// role. Shared by the VSL pages (EL EQUIPO section) and the /demo deck's
// quiénes-somos slide. A member renders only while their file exists in
// public/landing/team/.
const STB_TEAM = [
    { f: "rolando-pena.jpg", name: "Rolando Peña", role: "Director de Operaciones", roleEN: "Director of Operations" },
    { f: "javier-gonzalez.jpg", name: "Javier González", role: "Gerente de Construcción", roleEN: "Construction Manager" },
    { f: "cristo-calderon.jpg", name: "Cristo Calderón", role: "Gerente de Finanzas", roleEN: "Finance Manager" },
    { f: "rael-gonzalez.jpg", name: "Israel Gonzalez", role: "Gerente de Proyecto", roleEN: "Project Manager" },
    { f: "graciela-leal.jpg", name: "Graciela Leal", role: "Gerente de Ventas", roleEN: "Sales Manager" },
    { f: "claudia-garza.jpg", name: "Claudia Garza", role: "Asesora de Construcción", roleEN: "Construction Advisor" },
    { f: "andres-richarte.jpg", name: "Andres Richarte", role: "Asesor de Construcción", roleEN: "Construction Advisor" },
    { f: "leroy-flores.jpg", name: "Leroy Flores", role: "Dibujante Principal", roleEN: "Lead Drafter" },
    { f: "noe-belmares.jpg", name: "Noe Belmares", role: "Dibujante", roleEN: "Drafter" },
    { f: "mariana-belmares.jpg", name: "Mariana Belmares", role: "Dibujante", roleEN: "Drafter" },
    { f: "nadia-benavides.jpg", name: "Nadia Benavides", role: "Coordinadora de Transacciones", roleEN: "Transaction Coordinator" },
    { f: "orlando-pena.jpg", name: "Orlando Peña", role: "Departamento de Permisos", roleEN: "Permitting Department" },
    { f: "yamir-gonzalez.jpg", name: "Yamir González", role: "Directora de Marketing", roleEN: "Marketing Director" },
    { f: "ramiro-lerma.jpg", name: "Ramiro Lerma", role: "Coordinador de Proyecto", roleEN: "Project Scheduler" },
    { f: "angel-lopez.jpg", name: "Angel Lopez", role: "Supervisor de Obra", roleEN: "Site Runner" },
  ];
const teamAvail = () => STB_TEAM.filter((t) => fs.existsSync(new URL(`../public/landing/team/${t.f}`, import.meta.url)));
// Real built houses for the deck (drop-the-file pattern, up to 7)
const homesAvail = () => Array.from({ length: 7 }, (_, i) => `house-0${i + 1}.jpg`)
  .filter((f) => fs.existsSync(new URL(`../public/landing/homes/${f}`, import.meta.url)));
function vslPage(req, completo = false) {
  const base = canonBase(req);
  const en = req.query.lang === "en";
  const funnel = completo ? "vsl-completo" : "vsl-app";
  const route = completo ? "/completo" : "/video";
  const vidFile = `vsl-${completo ? "completo" : "app"}`;
  const hasVideo = fs.existsSync(new URL(`../public/landing/${vidFile}.mp4`, import.meta.url));
  const hasPoster = fs.existsSync(new URL(`../public/landing/${vidFile}-poster.jpg`, import.meta.url));
  // Founder card appears automatically once the photo exists — same drop-the-
  // file pattern as the VSL videos. The story is the deck's proven founder
  // slide: a builder who made the tool for himself, not a software salesman.
  const TEAM = teamAvail();
  const L = en ? {
    lang: "en", langBtn: "🇲🇽 Español", langHref: `${route}?lang=es`,
    title: completo ? "ALTO Pro — Your whole business online. We build it all." : "ALTO Pro — Watch how it works",
    desc: completo
      ? "Website + AI chat + your domain + the app + the quote widget — done FOR you, $297/mo. Watch the video and book your call."
      : "Watch the app measure and quote from the phone — then try it 7 days free. $67/mo after.",
    kick: completo ? "THE COMPLETE PACKAGE · DONE FOR YOU" : "FOR CONTRACTORS",
    h1: completo ? "YOUR WHOLE BUSINESS ONLINE.<br><em>WE BUILD IT ALL.</em>" : "WATCH HOW IT<br><em>WORKS.</em>",
    sub: completo
      ? `Professional website, AI that answers your customers 24/7, your own domain, the quote widget and the full app — <b>built FOR you</b>. Watch the video, then book your call.`
      : `3 minutes that save you hours of driving every week. Watch it, then try it yourself — <b>7 days free</b>.`,
    soon: "🎬 Video coming — press play soon", playHint: "▶ WATCH THE VIDEO",
    // vsl-app offer
    priceKick: "ONE PLAN. NO FINE PRINT.", priceT: "THE FULL APP", per: "/mo",
    trialBadge: "🎁 7 DAYS FREE — $0 TODAY",
    priceBullets: ["7 days free — then $67/mo", "Cancel anytime — cancel before day 8 and pay nothing", "No setup fee", "Install it TODAY (no App Store)", "Phone + computer"],
    buyBtn: "🚀 START MY 7 FREE DAYS →",
    buyNote: "Register your card today ($0) and your app opens INSTANTLY — account created and active on the spot, any hour.",
    roi: "An average job leaves you $2,000–$4,000. ONE extra job pays for the app for years.",
    // vsl-completo offer
    incT: "EVERYTHING <em>DONE FOR YOU</em>",
    inc: ["<b>🌐</b> Your professional website with your brand", "<b>🤖</b> AI chat that answers customers 24/7 and captures their phone", "<b>🔗</b> Your domain (yourbusiness.com) is yours — by contract", "<b>📲</b> The full ALTO Pro app — measure, quote, invoice", "<b>🧲</b> The satellite quote widget capturing leads on your site", "<b>🇺🇸</b> Bilingual support, onboarding included"],
    cprice: "$297", cper: "/mo — no setup fee",
    bookT: "📅 BOOK YOUR CALL <em>NOW</em>", bookSub: "15 minutes. We show you everything live, answer every question, and if it's a fit you leave with your site in production.",
    payNow: "Already sure? Start now — $297/mo →",
    // shared lead form
    fT: completo ? "Prefer we call you?" : "Want us to show you live?",
    fName: "Your name", fBiz: "Your business name (optional)", fPhone: "Your phone (mobile)", fBtn: "CALL ME →",
    fOk: "✓ Done — the team calls you today.",
    fErr: "Enter your 10-digit number", sendErr: "Couldn't send — try again.",
    consent: `By submitting, you agree that ALTO Pro may contact you by call, SMS or WhatsApp. We never sell your data. <a href="/privacidad" target="_blank" style="color:inherit">Privacy</a>`,
    teamT: "THE TEAM",
    chips: ["🛰️ Measures by satellite", "💲 Real Home Depot prices", "📄 Quote via WhatsApp"],
    testiT: "REAL <em>CONTRACTORS</em>", testiSub: "Real clips, no script.",
    testiPh: "YOUR CLIENT'S<br>VIDEO GOES HERE", testiPhSub: "Name · City, TX",
    sctaBtn: "🎁 7 DAYS FREE — $0 TODAY →",
    foot: `ALTO Pro · Made in Texas 🤠 · <a href="https://app.alto-pro.com">app.alto-pro.com</a> · <a href="/privacidad">Privacy</a>`,
  } : {
    lang: "es", langBtn: "🇺🇸 English", langHref: `${route}?lang=en`,
    title: completo ? "ALTO Pro — Tu negocio completo en línea. Lo hacemos todo." : "ALTO Pro — Mira cómo funciona",
    desc: completo
      ? "Página + IA + tu dominio + la app + el cotizador — hecho POR nosotros, $297/mes. Mira el video y agenda tu llamada."
      : "Mira la app medir y cotizar desde el teléfono — y pruébala 7 días gratis. Luego $67/mes.",
    kick: completo ? "EL PAQUETE COMPLETO · TODO HECHO" : "PARA CONTRATISTAS",
    h1: completo ? "TU NEGOCIO COMPLETO EN LÍNEA.<br><em>LO HACEMOS TODO.</em>" : "MIRA CÓMO<br><em>FUNCIONA.</em>",
    sub: completo
      ? `Página web profesional, IA que atiende a tus clientes 24/7, tu propio dominio, el cotizador y la app completa — <b>hecho POR nosotros</b>. Mira el video y agenda tu llamada.`
      : `3 minutos que te ahorran horas de troca cada semana. Míralo y pruébala tú mismo — <b>7 días gratis</b>.`,
    soon: "🎬 Video muy pronto — ya casi está listo", playHint: "▶ VER EL VIDEO",
    priceKick: "UN SOLO PLAN. SIN LETRAS CHIQUITAS.", priceT: "LA APP COMPLETA", per: "/mes",
    trialBadge: "🎁 7 DÍAS GRATIS — HOY PAGAS $0",
    priceBullets: ["7 días gratis — luego $67/mes", "Cancela cuando quieras — antes del día 8 no pagas nada", "Sin cargo de inicio", "La instalas HOY (sin App Store)", "Teléfono + computadora"],
    buyBtn: "🚀 EMPEZAR MIS 7 DÍAS GRATIS →",
    buyNote: "Registras tu tarjeta hoy ($0) y tu app se abre AL INSTANTE — cuenta creada y activa ahí mismo, a la hora que sea.",
    roi: "Un trabajo promedio te deja $2,000–$4,000. UN trabajo extra paga la app por años.",
    incT: "TODO <em>HECHO POR NOSOTROS</em>",
    inc: ["<b>🌐</b> Tu página web profesional con tu marca", "<b>🤖</b> IA que atiende a tus clientes 24/7 y capta su teléfono", "<b>🔗</b> Tu dominio (tunegocio.com) es tuyo — por contrato", "<b>📲</b> La app ALTO Pro completa — mide, cotiza, factura", "<b>🧲</b> El cotizador satelital captando leads en tu página", "<b>🇺🇸</b> Soporte en español, onboarding incluido"],
    cprice: "$297", cper: "/mes — sin cargo de inicio",
    bookT: "📅 AGENDA TU LLAMADA <em>AHORA</em>", bookSub: "15 minutos. Te enseñamos todo en vivo, resolvemos tus dudas, y si te late sales con tu página en producción.",
    payNow: "¿Ya estás seguro? Empezar ahora — $297/mes →",
    fT: completo ? "¿Prefieres que te llamemos?" : "¿Quieres que te lo enseñemos en vivo?",
    fName: "Tu nombre", fBiz: "Nombre de tu negocio (opcional)", fPhone: "Tu teléfono (celular)", fBtn: "LLÁMENME →",
    fOk: "✓ Listo — el equipo te llama hoy mismo.",
    fErr: "Pon tus 10 dígitos", sendErr: "No se pudo enviar — intenta otra vez.",
    consent: `Al enviar, aceptas que ALTO Pro te contacte por llamada, SMS o WhatsApp. No vendemos tus datos. <a href="/privacidad" target="_blank" style="color:inherit">Privacidad</a>`,
    teamT: "EL EQUIPO",
    chips: ["🛰️ Mide por satélite", "💲 Precios reales de Home Depot", "📄 Cotización por WhatsApp"],
    testiT: "CONTRATISTAS <em>REALES</em>", testiSub: "Clips reales, sin guión.",
    testiPh: "AQUÍ VA EL VIDEO<br>DE TU CLIENTE", testiPhSub: "Nombre · Ciudad, TX",
    sctaBtn: "🎁 7 DÍAS GRATIS — HOY PAGAS $0 →",
    foot: `ALTO Pro · Hecho en Texas 🤠 · <a href="https://app.alto-pro.com">app.alto-pro.com</a> · <a href="/privacidad">Privacidad</a>`,
  };
  const buyHref = completo
    ? (STRIPE_LINKS.complete ? STRIPE_LINKS.complete + (STRIPE_LINKS.complete.includes("?") ? "&" : "?") + "client_reference_id=vsl-completo" : "#agenda")
    : (STRIPE_LINKS.pro ? STRIPE_LINKS.pro + (STRIPE_LINKS.pro.includes("?") ? "&" : "?") + "client_reference_id=vsl-app" : `https://wa.me/${SALES_WA}`);
  // Testimonial carousel (vsl-app only): drop REAL customer clips into
  // public/landing/testimonios/*.mp4 (+ optional <name>-poster.jpg). The
  // section renders only when at least one clip exists — never staged
  // content, same drop-the-file pattern as the VSL video itself.
  let TESTIS = [];
  if (!completo) {
    try {
      TESTIS = fs.readdirSync(new URL("../public/landing/testimonios/", import.meta.url))
        .filter((f) => /\.mp4$/i.test(f)).sort()
        .map((f) => ({ f, poster: fs.existsSync(new URL(`../public/landing/testimonios/${f.replace(/\.mp4$/i, "")}-poster.jpg`, import.meta.url)) }));
    } catch {}
  }
  const videoBlock = hasVideo
    ? `<div class="vwrap" id="vslwrap"><video id="vsl" controls playsinline preload="metadata"${hasPoster ? ` poster="/landing/${vidFile}-poster.jpg"` : ""}><source src="/landing/${vidFile}.mp4" type="video/mp4"></video></div>`
    : `<div class="vwrap" id="vslwrap"><div class="vph"><span class="vplay">▶</span><p>${L.playHint}</p><small>${L.soon}</small></div></div>`;
  return `<!doctype html><html lang="${L.lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${L.title}</title>
<meta name="description" content="${L.desc}">
<meta property="og:title" content="${L.title}">
<meta property="og:description" content="${L.desc}">
<meta property="og:image" content="${base}/landing/${completo ? "og.png?v=3" : "og-app.jpg?v=2"}">
<meta property="og:type" content="website">
<meta property="og:url" content="${base}${route}">
<link rel="icon" href="/icon-192.png">
${metaPixelHead()}
<style>
@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=Inter:wght@400;600;700;800&display=swap');
*{box-sizing:border-box;font-family:Inter,Arial,sans-serif;margin:0;-webkit-tap-highlight-color:transparent}
body{background:#fff;color:#101B30}
.wrap{max-width:860px;margin:0 auto;padding:0 22px}
nav{display:flex;align-items:center;justify-content:center;padding:30px 0 4px}
nav .lg img{height:60px;display:block}
.langpill{position:fixed;top:14px;right:16px;z-index:50;background:#101B30;color:#fff;border-radius:99px;padding:9px 17px;font-weight:800;font-size:13px;text-decoration:none;box-shadow:0 10px 26px rgba(16,27,48,.3)}
.hero{padding:30px 0 26px;text-align:center}
.kick{font-size:12px;font-weight:800;letter-spacing:2px;color:#B07A00}
.hero h1{font-family:'Barlow Condensed',sans-serif;font-size:clamp(40px,7vw,68px);line-height:1.0;font-weight:800;letter-spacing:.5px;margin-top:10px}
.hero h1 em{color:#F8B408;font-style:normal}
.hero p{color:#5A6478;font-size:clamp(15px,2.4vw,18px);font-weight:600;margin:16px auto 0;max-width:600px;line-height:1.55}
.vwrap{max-width:760px;margin:26px auto 0;border-radius:22px;overflow:hidden;box-shadow:0 30px 80px rgba(16,27,48,.25);background:#0B1226}
.vwrap video{width:100%;display:block;aspect-ratio:16/9;background:#0B1226}
.vph{aspect-ratio:16/9;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;background:linear-gradient(135deg,#16233A,#0B1226);color:#fff}
.vplay{width:84px;height:84px;border-radius:999px;background:#F8B408;color:#101B30;font-size:34px;display:flex;align-items:center;justify-content:center;padding-left:6px;box-shadow:0 16px 44px rgba(248,180,8,.45)}
.vph p{font-family:'Barlow Condensed',sans-serif;font-size:24px;font-weight:800;letter-spacing:1px}
.vph small{color:#9DA8C4;font-weight:700;font-size:13px}
section{padding:44px 0}
.band{background:#F7F9FC}
.sec-t{font-family:'Barlow Condensed',sans-serif;font-size:clamp(30px,5vw,44px);font-weight:800;text-align:center;line-height:1.05}
.sec-t em{color:#F8B408;font-style:normal}
.sec-sub{color:#5A6478;text-align:center;font-weight:600;margin:10px auto 26px;max-width:560px;font-size:15px;line-height:1.6}
.featlist{max-width:560px;margin:0 auto;list-style:none;padding:0}
.featlist li{display:flex;gap:14px;align-items:flex-start;background:#fff;border:1px solid #E8ECF3;border-radius:16px;padding:15px 18px;margin-bottom:10px;font-weight:600;font-size:15px;line-height:1.5;box-shadow:0 6px 20px rgba(16,27,48,.04)}
.featlist b{font-size:20px;font-weight:400}
.pcard{background:#fff;border:2px solid #F8B408;border-radius:26px;padding:34px 30px;max-width:430px;margin:0 auto;text-align:center;box-shadow:0 30px 80px rgba(248,180,8,.18)}
.pkick{font-size:11.5px;font-weight:800;letter-spacing:1.5px;color:#B07A00}
.pname{font-family:'Barlow Condensed',sans-serif;font-size:28px;font-weight:800;margin:8px 0 2px}
.ptrial{display:inline-block;background:#FEF9E9;border:1.5px solid #F4DE9A;color:#7A5A00;border-radius:99px;padding:7px 16px;font-weight:800;font-size:13px;margin:10px 0 6px}
.pprice{font-family:'Barlow Condensed',sans-serif;font-size:68px;font-weight:800;line-height:1}
.pprice small{font-size:20px;color:#67718A;font-weight:700}
.pb{list-style:none;padding:0;margin:16px 0 20px;text-align:left}
.pb li{padding:6px 0 6px 26px;position:relative;font-weight:600;font-size:14.5px;color:#1B2433}
.pb li:before{content:"✓";position:absolute;left:2px;color:#1E7B3C;font-weight:800}
.pbuy{display:block;background:#F8B408;color:#101B30;border-radius:14px;padding:16px;font-weight:800;font-size:16.5px;text-decoration:none;box-shadow:0 10px 26px rgba(248,180,8,.35)}
.pnote{color:#67718A;font-size:12.5px;font-weight:600;margin-top:12px;line-height:1.55}
.roi{max-width:430px;margin:20px auto 0;background:#FEF9E9;border:1.5px solid #F4DE9A;border-radius:16px;padding:13px 18px;text-align:center;font-weight:700;font-size:14px;color:#7A5A00}
.bookfrm{width:100%;height:740px;border:1.5px solid #E4E7EC;border-radius:18px;background:#fff;margin-top:8px}
.paylink{display:block;text-align:center;margin-top:16px;color:#101B30;font-weight:800;font-size:14.5px}
.gatecard{background:#fff;border:1px solid #E8ECF3;border-radius:24px;padding:28px;max-width:430px;margin:0 auto;box-shadow:0 20px 54px rgba(16,27,48,.09)}
.gatecard h3{font-size:19px;margin-bottom:12px;text-align:center}
.gatecard input{width:100%;font-family:inherit;padding:14px 16px;border-radius:13px;border:1.5px solid #E4E7EC;font-size:16px;font-weight:500;outline:none;margin-bottom:10px}
.gatecard input:focus{border-color:#F8B408;box-shadow:0 0 0 4px rgba(248,180,8,.18)}
.gatecard button{width:100%;background:#101B30;color:#fff;border:none;border-radius:13px;padding:15px;font-weight:800;cursor:pointer;font-size:16px}
.gerr{display:none;color:#D93025;font-weight:700;font-size:13px;margin:4px 0 6px}
.gok{display:none;color:#1E7B3C;font-weight:800;font-size:15px;text-align:center;padding:10px 0}
.who{padding:14px 0 6px}
.wt-row{display:flex;flex-wrap:wrap;justify-content:center;gap:24px 18px;max-width:780px;margin:28px auto 0}
.wt{width:110px;text-align:center}
.wt img{width:74px;height:74px;border-radius:99px;object-fit:cover;border:1.5px solid #E6E8EC}
.wt b{display:block;font-size:12px;font-weight:800;color:#101B30;margin-top:7px;line-height:1.2}
.wt small{display:block;font-size:10px;color:#67718A;font-weight:600;margin-top:2px}
footer{padding:36px 0 50px;text-align:center;font-size:13px;color:#8A94A8;font-weight:600}
footer a{color:#8A94A8}
.chips{display:flex;justify-content:center;gap:10px;flex-wrap:wrap;margin:18px auto 0;max-width:680px}
.chip{background:#fff;border:1px solid #E8ECF3;border-radius:99px;padding:9px 16px;font-weight:700;font-size:13.5px;color:#1B2433;box-shadow:0 6px 18px rgba(16,27,48,.05)}
.trow{overflow:hidden;padding:10px 0 20px;perspective:1100px;height:392px;position:relative}
.trow.tsolo{perspective:none;height:auto}
.ttrack{position:absolute;left:50%;top:14px;width:190px;height:338px;margin-left:-95px;transform-style:preserve-3d;animation:tring var(--tdur,24s) linear infinite}
.ttrack.hold,.ttrack:hover{animation-play-state:paused}
.ttrack.solo{position:static;margin:0 auto;animation:none;transform:none}
@keyframes tring{from{transform:rotateY(0)}to{transform:rotateY(-360deg)}}
@media (prefers-reduced-motion:reduce){.ttrack{animation:none}}
.tcard{position:absolute;inset:0;border-radius:18px;background:#0B1226;box-shadow:0 16px 44px rgba(16,27,48,.22);transform-style:preserve-3d}
.ttrack.solo .tcard{position:static;width:216px}
.tface{position:absolute;inset:0;border-radius:18px;overflow:hidden;backface-visibility:hidden;-webkit-backface-visibility:hidden;background:#0B1226}
.ttrack.solo .tface{position:static}
.tcard video{width:100%;height:100%;display:block;object-fit:cover;background:#0B1226}
.ttrack.solo .tcard video{aspect-ratio:9/16;height:auto}
.tback{position:absolute;inset:0;border-radius:18px;transform:rotateY(180deg);backface-visibility:hidden;-webkit-backface-visibility:hidden;background:linear-gradient(160deg,#16233A,#0B1226);display:flex;align-items:center;justify-content:center}
.tback img{opacity:.5;border-radius:14px}
.tcard.tph .tface{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;background:linear-gradient(160deg,#1C2C4B,#0B1226);text-align:center;padding:16px}
.tph .tq{font-size:54px;line-height:1;color:#F8B408;font-weight:800;font-family:Georgia,serif}
.tph b{color:#fff;font-size:15px;font-weight:800;letter-spacing:.5px;line-height:1.35}
.tph small{color:#9DA8C4;font-size:11.5px;font-weight:700}
.tph .tplay{width:44px;height:44px;border-radius:99px;background:#F8B408;color:#101B30;font-size:17px;display:flex;align-items:center;justify-content:center;padding-left:4px;margin-top:6px}
.scta{position:fixed;left:12px;right:12px;bottom:12px;z-index:60;background:#F8B408;color:#101B30;border-radius:16px;padding:15px;text-align:center;font-weight:800;font-size:15.5px;text-decoration:none;box-shadow:0 14px 40px rgba(16,27,48,.28);max-width:520px;margin:0 auto;transform:translateY(140%);transition:transform .25s;display:block}
.scta.on{transform:none}
.vapp footer{padding-bottom:120px}
</style></head><body${completo ? "" : ` class="vapp"`}>
<a class="langpill" href="${L.langHref}">${L.langBtn}</a>
<div class="wrap">
<nav><span class="lg"><img src="/brand-logo.png" alt="ALTO Pro"></span></nav>
<div class="hero">
  <p class="kick">${L.kick}</p>
  <h1>${L.h1}</h1>
  <p>${L.sub}</p>
  ${videoBlock}
  ${completo ? "" : `<div class="chips">${L.chips.map((c) => `<span class="chip">${c}</span>`).join("")}</div>`}
</div>
</div>

${completo && TEAM.length >= 3 ? `
<div class="wrap"><section class="who">
  <h2 class="sec-t">${L.teamT}</h2>
  <div class="wt-row">${TEAM.map((t) => `<div class="wt"><img src="/landing/team/${t.f}" alt="${t.name}" loading="lazy" width="74" height="74"><b>${t.name}</b><small>${en ? t.roleEN : t.role}</small></div>`).join("")}</div>
</section></div>
` : ""}

${completo ? `
<div class="band"><div class="wrap"><section>
  <h2 class="sec-t">${L.incT}</h2>
  <ul class="featlist" style="margin-top:26px">${L.inc.map((f) => `<li>${f}</li>`).join("")}</ul>
  <p style="text-align:center;margin-top:22px"><span style="font-family:'Barlow Condensed',sans-serif;font-size:56px;font-weight:800">${L.cprice}</span><span style="color:#67718A;font-weight:700;font-size:16px">${L.cper}</span></p>
</section></div></div>
<div class="wrap"><section id="agenda">
  <h2 class="sec-t">${L.bookT}</h2>
  <p class="sec-sub">${L.bookSub}</p>
  ${GHL_BOOKING_URL ? `<iframe class="bookfrm" src="${GHL_BOOKING_URL}" title="Agenda"></iframe>` : ""}
  ${STRIPE_LINKS.complete ? `<a class="paylink" href="${buyHref}" target="_blank" rel="noopener" onclick="buyClick()">${L.payNow}</a>` : ""}
</section></div>
` : `
<div class="band"><div class="wrap"><section id="precio">
  <div class="pcard">
    <p class="pkick">${L.priceKick}</p>
    <p class="pname">${L.priceT}</p>
    <p class="ptrial">${L.trialBadge}</p>
    <p class="pprice">$67<small>${L.per}</small></p>
    <ul class="pb">${L.priceBullets.map((b) => `<li>${b}</li>`).join("")}</ul>
    <a class="pbuy" href="${buyHref}" target="_blank" rel="noopener" onclick="buyClick()">${L.buyBtn}</a>
    <p class="pnote">${L.buyNote}</p>
  </div>
  <div class="roi">💰 ${L.roi}</div>
</section></div></div>
${(() => {
  // 3D rolodex ring: cards stand on a rotating carousel (rotateY), the front
  // one faces you while the rest curve away and circle through the back.
  // Each card has a branded back face so cards facing away read as card
  // backs, not mirrored content. No real clips yet → explicitly-placeholder
  // cards (owner's call; they SAY they're placeholders and are replaced
  // automatically the moment real files land in testimonios/).
  const inner = TESTIS.length
    ? TESTIS.map((t) => `<video controls playsinline preload="metadata"${t.poster ? ` poster="/landing/testimonios/${t.f.replace(/\.mp4$/i, "")}-poster.jpg"` : ""}><source src="/landing/testimonios/${t.f}" type="video/mp4"></video>`)
    : [1, 2, 3].map(() => `<span class="tq">”</span><b>${L.testiPh}</b><small>${L.testiPhSub}</small><span class="tplay">▶</span>`);
  const isPh = !TESTIS.length;
  const solo = inner.length === 1;
  // pad to ≥6 ring positions so the wheel never looks sparse
  const slots = [];
  if (!solo) { while (slots.length < Math.max(6, inner.length)) slots.push(...inner.slice(0, Math.max(6, inner.length) - slots.length)); }
  else slots.push(inner[0]);
  const N = slots.length;
  const ang = 360 / N;
  const R = solo ? 0 : Math.round(121 / Math.tan(Math.PI / N));
  const cards = slots.map((c, i) => `<div class="tcard${isPh ? " tph" : ""}"${solo ? "" : ` style="transform:rotateY(${Math.round(i * ang)}deg) translateZ(${R}px)"`}><div class="tface">${c}</div><div class="tback"><img src="/icon-192.png" alt="" width="54" height="54"></div></div>`).join("");
  return `
<div class="wrap"><section class="testi">
  <h2 class="sec-t">${L.testiT}</h2>
  <p class="sec-sub">${L.testiSub}</p>
  <div class="trow${solo ? " tsolo" : ""}"><div id="ttrack" class="ttrack${solo ? " solo" : ""}" style="--tdur:${N * 4}s">${cards}</div></div>
</section></div>`;
})()}
<a id="scta" class="scta" href="${buyHref}" target="_blank" rel="noopener" onclick="buyClick()">${L.sctaBtn}</a>
`}

<div class="wrap"><section>
  <div class="gatecard">
    <h3>${L.fT}</h3>
    <form id="gf" onsubmit="return leadSend(event)">
      <input id="gn" placeholder="${L.fName}" required>
      <input id="gb" placeholder="${L.fBiz}" autocomplete="organization">
      <input id="gp" placeholder="${L.fPhone}" type="tel" inputmode="numeric" required>
      <p class="gerr" id="gerr">${L.fErr}</p>
      <button>${L.fBtn}</button>
      <p style="font-size:10.5px;color:#8A94A8;line-height:1.55;margin:10px 2px 0">${L.consent}</p>
    </form>
    <p class="gok" id="gok">${L.fOk}</p>
  </div>
</section></div>
<div class="wrap"><footer>${L.foot}</footer></div>
<script>
var FUNNEL=${JSON.stringify(funnel)};
function track(ev){try{fetch('/api/track',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event:ev})})}catch(e){}}
var UTM={};
try{
  var sp=new URLSearchParams(location.search);
  var stored=JSON.parse(localStorage.getItem('alto_utm')||'null');
  if(sp.get('utm_source')||sp.get('utm_campaign')||sp.get('utm_content')){
    UTM={source:sp.get('utm_source')||'',campaign:sp.get('utm_campaign')||'',content:sp.get('utm_content')||''};
    if(!stored)localStorage.setItem('alto_utm',JSON.stringify(UTM));else UTM=stored;
  }else if(stored){UTM=stored}
}catch(e){}
function crSlug(){return String(UTM.content||UTM.campaign||'').toLowerCase().replace(/[^a-z0-9_-]/g,'-').replace(/^-+|-+$/g,'').slice(0,40)}
function trackStep(step){
  track('fn:'+FUNNEL+':'+step);
  var s=crSlug();
  if(s&&(step==='visit'||step==='lead'||step==='buy'))track('cr:'+FUNNEL+':'+step+':'+s);
}
trackStep('visit');
// watch-depth: the VSL's real KPI — where do they stop watching?
var v=document.getElementById('vsl');
if(v){var fired={};
  v.addEventListener('play',function(){if(!fired.play){fired.play=1;track('fn:'+FUNNEL+':play');if(window.fbq)fbq('track','ViewContent')}});
  v.addEventListener('timeupdate',function(){
    if(!v.duration)return;var p=v.currentTime/v.duration;
    [['watch25',.25],['watch50',.5],['watch75',.75]].forEach(function(x){
      if(p>=x[1]&&!fired[x[0]]){fired[x[0]]=1;track('fn:'+FUNNEL+':'+x[0])}
    });
  });
}
function leadSend(e){e.preventDefault();
  var ph=document.getElementById('gp').value.replace(/\\D/g,'');
  var gerr=document.getElementById('gerr');
  if(ph.length<10){gerr.textContent=${JSON.stringify(L.fErr)};gerr.style.display='block';return false}
  gerr.style.display='none';
  var btn=e.target.querySelector('button');btn.disabled=true;
  fetch('/api/widget/lead',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({slug:'alto-ventas',name:document.getElementById('gn').value.trim(),phone:ph,
      info:{src:FUNNEL,funnel:FUNNEL,biz:document.getElementById('gb').value.trim(),
        utm_source:UTM.source||'',utm_campaign:UTM.campaign||'',utm_content:UTM.content||''}})})
  .then(function(r){return r.ok?r.json():null})
  .then(function(j){btn.disabled=false;
    if(j&&j.ok){
      trackStep('lead');if(window.fbq)fbq('track','Lead');
      document.getElementById('gf').style.display='none';
      document.getElementById('gok').style.display='block';
    }else{gerr.textContent=${JSON.stringify(L.sendErr)};gerr.style.display='block'}
  }).catch(function(){btn.disabled=false;gerr.textContent=${JSON.stringify(L.sendErr)};gerr.style.display='block'});
  return false}
function buyClick(){trackStep('buy');if(window.fbq)fbq('track','InitiateCheckout')}
// Sticky CTA: follows the viewer once the video is off-screen, hides while
// the real price card is visible so it never covers the button it points to.
var scta=document.getElementById('scta');
if(scta&&'IntersectionObserver'in window){
  var sctaVid=true,sctaCard=false;
  var sio=new IntersectionObserver(function(es){
    es.forEach(function(e){
      if(e.target.id==='vslwrap')sctaVid=e.isIntersecting;
      else sctaCard=e.isIntersecting;
    });
    if(!sctaVid&&!sctaCard)scta.classList.add('on');else scta.classList.remove('on');
  },{threshold:.1});
  var vw=document.getElementById('vslwrap');if(vw)sio.observe(vw);
  var pc=document.querySelector('.pcard');if(pc)sio.observe(pc);
}
// Testimonial revolving-door: spins on its own, holds while a finger is on it
// or a clip is playing, resumes 1.5s after both end.
var tt=document.getElementById('ttrack');
if(tt){
  var tplay=0,ttouch=false;
  function thold(){if(tplay>0||ttouch)tt.classList.add('hold');else setTimeout(function(){if(tplay<=0&&!ttouch)tt.classList.remove('hold')},1500)}
  var tv=tt.querySelectorAll('video');
  for(var ti=0;ti<tv.length;ti++){
    tv[ti].addEventListener('play',function(){tplay++;thold()});
    tv[ti].addEventListener('pause',function(){tplay=Math.max(0,tplay-1);thold()});
    tv[ti].addEventListener('ended',function(){tplay=Math.max(0,tplay-1);thold()});
  }
  tt.addEventListener('touchstart',function(){ttouch=true;thold()},{passive:true});
  tt.addEventListener('touchend',function(){ttouch=false;thold()},{passive:true});
}
</script></body></html>`;
}
app.get(["/video", "/vsl"], (req, res) => {
  res.set("Content-Type", "text/html; charset=utf-8");
  res.send(vslPage(req));
});
app.get(["/completo", "/vsl-completo"], (req, res) => {
  res.set("Content-Type", "text/html; charset=utf-8");
  res.send(vslPage(req, true));
});

/* ── After-payment welcome (/bienvenida) — night sales need no human ──
 * Stripe's Payment Link redirects here with ?session_id={CHECKOUT_SESSION_ID}.
 * The webhook auto-provisions the account and parks the invite under
 * stripe_sess:<id>; this page polls until it appears (usually 1-3 s) and
 * hands the buyer their access link + install steps on the spot. If the
 * webhook is slow/dead, it degrades honestly: "te lo mandamos por WhatsApp
 * hoy" (the team sees the sale in Leads de venta regardless). */
app.get("/api/checkout-result", async (req, res) => {
  res.set("Cache-Control", "no-store");
  const sid = String(req.query.session_id || "");
  if (!/^cs_[a-zA-Z0-9_]{8,}$/.test(sid)) return res.status(400).json({ error: "bad session" });
  if (overQuota(`ckr:${clientIp(req)}`, 200)) return res.status(429).json({ error: "rate" });
  const rec = await db.kvGet(`stripe_sess:${sid}`).catch(() => null);
  if (!rec || !rec.accessUrl) return res.json({ ready: false });
  res.json({ ready: true, accessUrl: rec.accessUrl, name: rec.name || "", trial: !!rec.trial, funnel: rec.funnel || "app", ...(rec.siteUrl ? { siteUrl: rec.siteUrl } : {}) });
});
app.get("/bienvenida", (req, res) => {
  const es = req.query.lang !== "en";
  const L = es ? {
    title: "¡Bienvenido a ALTO Pro!",
    prep: "Preparando tu app…", prepSub: "Tu pago se confirmó — dale unos segundos.",
    hi: "🎉 ¡Bienvenido a ALTO Pro", trialNote: "Tus 7 días gratis empezaron HOY.",
    open: "🚀 ABRIR MI APP →",
    s1: "Toca el botón y tu app se abre — es TU cuenta, ya activa.",
    s2: "Guárdala en tu pantalla de inicio: Compartir → \"Agregar a inicio\". Sin App Store.",
    s3: "Hoy te escribimos por WhatsApp para ayudarte a arrancar (tu logo, tus precios).",
    save: "📋 Copiar mi link de acceso", saved: "✓ Copiado — guárdalo",
    commJoin: "👥 Entrar a la comunidad de contratistas",
    commNote: "Tu grupo privado: tips de ventas y marketing, videos y masterminds con otros contratistas. Vas entrando temprano — sé de los primeros.",
    slow: "Tu pago se procesó ✓ — tu acceso te llega por WhatsApp hoy mismo.",
    slowBtn: "💬 Escríbenos por WhatsApp",
    waMsg: "Hola 👋 Acabo de registrarme en ALTO Pro y quiero mi acceso.",
    // /pagina buyers: the site is LIVE right now; the "app" is their editor + leads
    pgHi: "🎉 ¡Tu página ya está EN LÍNEA", pgOpen: "🌐 VER MI PÁGINA →", pgEdit: "✏️ Editar mi página · ver mis clientes",
    pgS1: "Tu página ya está publicada — compártela en tu Facebook, tu WhatsApp y tus tarjetas.",
    pgS2: "Con el botón de editar cambias textos, fotos, colores y estilo cuando quieras. Guarda ese link: es tu llave.",
    pgS3: "Cada cliente que cotice o escriba en tu página te llega ahí mismo. Hosting: $19/mes desde el mes 2 — cancela cuando quieras.",
  } : {
    title: "Welcome to ALTO Pro!",
    prep: "Setting up your app…", prepSub: "Your payment is confirmed — give it a few seconds.",
    hi: "🎉 Welcome to ALTO Pro", trialNote: "Your 7 free days started TODAY.",
    open: "🚀 OPEN MY APP →",
    s1: "Tap the button and your app opens — it's YOUR account, already active.",
    s2: "Save it to your home screen: Share → \"Add to Home Screen\". No App Store.",
    s3: "We'll message you on WhatsApp today to help you get rolling (your logo, your prices).",
    save: "📋 Copy my access link", saved: "✓ Copied — save it",
    commJoin: "👥 Join the contractor community",
    commNote: "Your private group: sales & marketing tips, videos and masterminds with other contractors. You're getting in early — be one of the first.",
    slow: "Your payment went through ✓ — your access arrives by WhatsApp today.",
    slowBtn: "💬 Message us on WhatsApp",
    waMsg: "Hi 👋 I just signed up for ALTO Pro and I want my access.",
    pgHi: "🎉 Your website is LIVE", pgOpen: "🌐 SEE MY WEBSITE →", pgEdit: "✏️ Edit my page · see my leads",
    pgS1: "Your page is already published — share it on Facebook, WhatsApp and your cards.",
    pgS2: "The edit button changes texts, photos, colors and style anytime. Save that link: it's your key.",
    pgS3: "Every customer who quotes or writes on your page lands right there. Hosting: $19/mo from month 2 — cancel anytime.",
  };
  res.set("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html><html lang="${es ? "es" : "en"}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${L.title}</title>
<meta name="robots" content="noindex"><link rel="icon" href="/icon-192.png">
${metaPixelHead()}
<style>
*{box-sizing:border-box;font-family:Inter,Arial,sans-serif;margin:0;-webkit-tap-highlight-color:transparent}
body{background:#101B30;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.card{background:#fff;border-radius:24px;padding:36px 28px;max-width:430px;width:100%;text-align:center;box-shadow:0 30px 80px rgba(0,0,0,.45)}
img.lg{height:52px;margin-bottom:14px}
h1{font-size:22px;color:#101B30;margin-bottom:6px;line-height:1.25}
.sub{color:#5A6478;font-weight:600;font-size:14px;line-height:1.55}
.spin{width:44px;height:44px;border:4px solid #EEF1F6;border-top-color:#F8B408;border-radius:99px;margin:18px auto;animation:sp 1s linear infinite}
@keyframes sp{to{transform:rotate(360deg)}}
.trial{display:inline-block;background:#FEF9E9;border:1.5px solid #F4DE9A;color:#7A5A00;border-radius:99px;padding:7px 16px;font-weight:800;font-size:13px;margin:12px 0 4px}
.open{display:block;background:#F8B408;color:#101B30;border-radius:14px;padding:17px;font-weight:800;font-size:17px;text-decoration:none;margin:18px 0 12px;box-shadow:0 10px 26px rgba(248,180,8,.35)}
.copy{width:100%;background:#fff;border:1.5px solid #E6E8EC;color:#101B30;border-radius:13px;padding:12px;font-weight:800;font-size:13.5px;cursor:pointer}
ol{text-align:left;padding-left:22px;margin:16px 0 4px}
ol li{color:#1B2433;font-weight:600;font-size:13.5px;line-height:1.5;margin-bottom:9px}
.wa{display:block;background:#F8B408;color:#101B30;border-radius:14px;padding:15px;font-weight:800;text-decoration:none;margin-top:16px}
.comm{display:block;background:#101B30;color:#fff;border-radius:14px;padding:14px;font-weight:800;font-size:14.5px;text-decoration:none;margin-top:14px}
.commsub{color:#7C879C;font-weight:600;font-size:12px;line-height:1.5;margin-top:8px}
</style></head><body>
<div class="card">
  <img class="lg" src="/brand-logo.png" alt="ALTO Pro">
  <div id="wait">
    <h1>${L.prep}</h1>
    <div class="spin"></div>
    <p class="sub">${L.prepSub}</p>
  </div>
  <div id="ready" style="display:none">
    <h1 id="hi">${L.hi} 👋</h1>
    <span class="trial" id="trialb" style="display:none">🎁 ${L.trialNote}</span>
    <a class="open" id="openbtn" href="#">${L.open}</a>
    <a class="copy" id="editbtn" href="#" style="display:none;text-decoration:none;margin-bottom:10px">${L.pgEdit}</a>
    <button class="copy" id="copybtn">${L.save}</button>
    <ol>
      <li id="st1">${L.s1}</li>
      <li id="st2">${L.s2}</li>
      <li id="st3">${L.s3}</li>
    </ol>
    ${COMMUNITY_INVITE_URL ? `<a class="comm" href="${COMMUNITY_INVITE_URL}" target="_blank" rel="noopener" onclick="track('fn:community:join')">${L.commJoin}</a><p class="commsub">${L.commNote}</p>` : ""}
  </div>
  <div id="slow" style="display:none">
    <h1>${L.slow}</h1>
    <a class="wa" href="https://wa.me/${SALES_WA}?text=${encodeURIComponent(L.waMsg)}" target="_blank" rel="noopener">${L.slowBtn}</a>
  </div>
</div>
<script>
function track(ev){try{fetch('/api/track',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event:ev})})}catch(e){}}
var sid=new URLSearchParams(location.search).get('session_id')||'';
var tries=0,ACCESS='',PIXELED=false;
function showReady(j){
  ACCESS=j.accessUrl;
  track('fn:'+(j.funnel||'app')+':welcome');
  if(window.fbq&&!PIXELED){PIXELED=true;fbq('track','Purchase',{value:j.siteUrl?49:67,currency:'USD'})}
  document.getElementById('wait').style.display='none';
  document.getElementById('ready').style.display='block';
  if(j.siteUrl){
    // /pagina buyer: site is live NOW — lead with the site, editor second
    document.getElementById('hi').textContent=${JSON.stringify(L.pgHi)}+(j.name?', '+j.name.split(' ')[0]:'')+' 👋';
    var ob=document.getElementById('openbtn');ob.textContent=${JSON.stringify(L.pgOpen)};ob.href=j.siteUrl;ob.target='_blank';
    var eb=document.getElementById('editbtn');eb.style.display='block';eb.href=ACCESS;
    document.getElementById('st1').textContent=${JSON.stringify(L.pgS1)};
    document.getElementById('st2').textContent=${JSON.stringify(L.pgS2)};
    document.getElementById('st3').textContent=${JSON.stringify(L.pgS3)};
    return;
  }
  if(j.name)document.getElementById('hi').textContent=${JSON.stringify(L.hi)}+', '+j.name.split(' ')[0]+' 👋';
  if(j.trial)document.getElementById('trialb').style.display='inline-block';
  document.getElementById('openbtn').href=ACCESS;
}
function showSlow(){
  document.getElementById('wait').style.display='none';
  document.getElementById('slow').style.display='block';
}
function poll(){
  if(!sid){showSlow();return}
  tries++;
  fetch('/api/checkout-result?session_id='+encodeURIComponent(sid))
    .then(function(r){return r.ok?r.json():null})
    .then(function(j){
      if(j&&j.ready){showReady(j);return}
      if(tries>=30){showSlow();return}
      setTimeout(poll,2000);
    }).catch(function(){if(tries>=30)showSlow();else setTimeout(poll,2000)});
}
poll();
document.getElementById('copybtn').onclick=function(){
  if(!ACCESS)return;
  navigator.clipboard.writeText(ACCESS);
  this.textContent=${JSON.stringify(L.saved)};
};
</script></body></html>`);
});

/* ── Example client website (template #1, "Clásico") ──
 * A complete, working roofer site a prospect can click through — the
 * live widget is embedded, so it really quotes. Branded with honest
 * placeholders ("imagina TU logo aquí"), never fake reviews. */
app.get("/ejemplo", (req, res) => {
  /* The deck's website example IS the real product: rendered through the
   * same template engine as every client site, so whatever a prospect sees
   * here — reviews, social footer, zonas, FAQ, gallery — is exactly what
   * their own page will carry. One engine, no drift. */
  const embed = req.query.embed != null;
  const heroAsset = (name) =>
    fs.existsSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "landing", name))
    || fs.existsSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "landing", name));
  res.send(renderSite({
    slug: "alto-demo",
    heroImg: heroAsset("hero-roof.jpg") ? "/landing/hero-roof.jpg" : "",
    biz: "Tu Negocio",
    phone: "9565550100",
    logo: null,
    template: "1",
    color: "#B30F24",
    city: "Tu Ciudad, TX",
    years: 15,
    license: "00000",
    tagline: "Reemplazo y reparación de techos con garantía por escrito — cotiza el tuyo aquí mismo, medido por satélite, sin que nadie te visite.",
    about: "Empezamos hace 15 años con una troca y muchas ganas. Hoy somos un equipo que ha hecho cientos de techos en la región — y seguimos tratando cada casa como si fuera la nuestra.",
    area: "Tu Ciudad, Pueblo Nuevo, Villa Verde, El Campo",
    warranty: "10 años por escrito en mano de obra",
    diff: "Somos familia local — el mismo dueño supervisa cada trabajo, del primer clavo al último.",
    facebook: "https://facebook.com",
    instagram: "https://instagram.com",
    opinaHref: "/opina/alto-demo",
    photos: [
      "/api/roofimg?lat=26.3827418&lng=-98.8196915&zoom=20",
      "/api/roofimg?lat=26.3795779&lng=-98.8186812&zoom=20",
      "/api/roofimg?lat=26.3807212&lng=-98.8148616&zoom=20",
    ],
    zonaLinks: false,
    reviews: [
      { s: 5, n: "María G.", t: "Llegaron a la hora que dijeron, terminaron en dos días y dejaron todo limpio. El precio fue el que me dieron desde el principio." },
      { s: 5, n: "José R.", t: "Me ayudaron con el reclamo de la aseguranza después del granizo. Techo nuevo y casi no pagué de mi bolsa." },
      { s: 5, n: "Ana T.", t: "Muy profesionales y hablan los dos idiomas. Me explicaron todo antes de empezar y cumplieron con la garantía por escrito." },
    ],
  }, embed ? {} : { ribbon: "PÁGINA DE EJEMPLO — imagina TU logo y TU nombre aquí.", backAlto: true }));
});

/* Fence twin of /ejemplo: the same template engine with trade="fence", so a
 * fence prospect clicks through a real working fence site (fence widget,
 * fence bot, fence copy). */
app.get("/ejemplo-cercas", (req, res) => {
  const embed = req.query.embed != null;
  const heroAssetC = (name) =>
    fs.existsSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "landing", name))
    || fs.existsSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "landing", name));
  res.send(renderSite({
    slug: "alto-cercas",
    trade: "fence",
    heroImg: heroAssetC("hero-fence.jpg") ? "/landing/hero-fence.jpg" : "",
    biz: "Tu Negocio",
    phone: "9565550100",
    logo: null,
    template: "1",
    color: "#1E6B33",
    city: "Tu Ciudad, TX",
    years: 12,
    license: "00000",
    tagline: "Cercas nuevas y reparaciones con garantía por escrito — cotiza la tuya aquí mismo, en 60 segundos, sin que nadie te visite.",
    about: "Empezamos hace 12 años con una troca y muchas ganas. Hoy somos un equipo que ha levantado cientos de cercas en la región — y seguimos tratando cada patio como si fuera el nuestro.",
    area: "Tu Ciudad, Pueblo Nuevo, Villa Verde, El Campo",
    warranty: "5 años por escrito en mano de obra",
    diff: "Somos familia local — el mismo dueño supervisa cada trabajo, del primer poste al último.",
    facebook: "https://facebook.com",
    instagram: "https://instagram.com",
    opinaHref: "/opina/alto-cercas",
    photos: [],
    zonaLinks: false,
    reviews: [
      { s: 5, n: "María G.", t: "Llegaron a la hora que dijeron, terminaron en dos días y dejaron todo limpio. El precio fue el que me dieron desde el principio." },
      { s: 5, n: "José R.", t: "Cerca de cedro para todo el patio. Postes bien anclados y líneas derechitas — se ve de lujo." },
      { s: 5, n: "Ana T.", t: "Muy profesionales y hablan los dos idiomas. Me explicaron todo antes de empezar y cumplieron con la garantía por escrito." },
    ],
  }, embed ? {} : { ribbon: "PÁGINA DE EJEMPLO — imagina TU logo y TU nombre aquí.", backAlto: true }));
});

/* ── /pagina — the $49 website-factory funnel (PAGINA_ENABLED) ──
 * Ad → form (lead captured to alto-ventas FIRST) → instant preview of THEIR
 * real site rendered by the same engine as every client site → claim bar
 * ($49 Stripe link, WhatsApp fallback while the link env is unset).
 * v1 serves techos + cercas only — the trades the factory already renders
 * and the only buyers who fit the $67 app upsell. Zero-touch by design. */
/* ── /pagina draft store + customizer ──
 * The funnel form creates a DRAFT (kv pgdraft:<id>); the preview loads it and
 * the customize toolbar PATCHes it (template / color / logo) or asks the AI
 * for copy. The draft id rides to Stripe as client_reference_id=pagina-<id>
 * so the webhook can (Phase 2) provision the exact page the buyer approved. */
const PG_COLORS = ["#1E6B33", "#B30F24", "#0F4C81", "#7A4B12", "#101B30", "#C2410C"];
const PG_TPL_IDS = ["1", "2", "3", "4", "5", "6"];
const PG_TPL_NAMES = { "1": "Clásica", "2": "Moderna", "3": "Bold", "4": "Elegante", "5": "Vivo", "6": "Sencilla" };
// Service chips the panel offers per trade — plain strings; SVC_LOOKUP in
// templates.mjs upgrades each to a full icon+copy card at render time.
const PG_SVC = {
  fence: ["Cerca de madera", "Cerca de vinilo", "Malla ciclónica", "Portones", "Reparación de cercas", "Cercas comerciales"],
  roofing: ["Reemplazo de techo", "Reparaciones", "Techo de metal", "Shingle arquitectónico", "Reclamos de seguro", "Inspección gratuita"],
};
const pgKey = (id) => `pgdraft:${id}`;
const pgId = (v) => String(v || "").replace(/[^a-f0-9]/g, "").slice(0, 16);

// Phase 2: the buyer's customized draft becomes their real account + PUBLISHED
// site the moment Stripe confirms the $49 — the exact page they approved
// (template, color, logo, photos, services, copy), no human in the loop.
function paginaSiteFromDraft(d) {
  const fence = d.trade === "fence";
  const trade = fence ? "fence" : "roofing";
  return {
    trade,
    profile: {
      trade, biz: d.biz, phone: d.phone,
      ...(d.logo ? { logo: d.logo } : {}),
      ...(d.license ? { license: d.license } : {}),
    },
    site: {
      template: PG_TPL_IDS.includes(String(d.template)) ? String(d.template) : "1",
      color: d.color || (fence ? "#1E6B33" : "#B30F24"),
      city: d.city || "", years: d.years || null,
      tagline: d.tagline || "", about: d.about || "",
      area: d.area || d.city || "",
      photos: Array.isArray(d.photos) ? d.photos : [],
      services: Array.isArray(d.services) ? d.services : [],
      facebook: d.facebook || "", instagram: d.instagram || "",
      published: true, source: "pagina", publishedAt: new Date().toISOString(),
    },
  };
}

// Serve a draft photo as a real image (the customize panel's thumbnails —
// keeps the panel light instead of re-embedding every data URL twice).
app.get("/api/pagina/photo/:id/:i", async (req, res) => {
  if (!PAGINA_ENABLED) return res.status(404).end();
  const d = await db.kvGet(pgKey(pgId(req.params.id))).catch(() => null);
  const p = d && Array.isArray(d.photos) ? d.photos[parseInt(req.params.i, 10) || 0] : null;
  const m = typeof p === "string" ? p.match(/^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/) : null;
  if (!m) return res.status(404).end();
  res.set("Content-Type", m[1]).set("Cache-Control", "no-store").send(Buffer.from(m[2], "base64"));
});

app.post("/api/pagina/draft", async (req, res) => {
  if (!PAGINA_ENABLED) return res.status(404).json({ error: "off" });
  if (overQuota(`pgd:${clientIp(req)}`, 20)) return res.status(429).json({ error: "quota" });
  const b = req.body || {};
  const draft = {
    trade: b.trade === "fence" ? "fence" : "roofing",
    biz: String(b.biz || "").slice(0, 60).trim() || "Tu Negocio",
    name: String(b.name || "").slice(0, 60).trim(),
    phone: String(b.phone || "").replace(/\D/g, "").slice(0, 11),
    city: String(b.city || "").slice(0, 60).trim() || "Tu Ciudad, TX",
    years: Math.max(1, Math.min(60, parseInt(b.years, 10) || 10)),
    template: "1", color: "", logo: null, tagline: "", about: "", aiN: 0,
    created: Date.now(),
  };
  const id = crypto.randomBytes(6).toString("hex");
  await db.kvSet(pgKey(id), draft);
  res.json({ ok: 1, id });
});

app.post("/api/pagina/draft/:id", async (req, res) => {
  if (!PAGINA_ENABLED) return res.status(404).json({ error: "off" });
  if (overQuota(`pgp:${clientIp(req)}`, 120)) return res.status(429).json({ error: "quota" });
  const id = pgId(req.params.id);
  const d = await db.kvGet(pgKey(id)).catch(() => null);
  if (!d) return res.status(404).json({ error: "draft" });
  const b = req.body || {};
  if (b.template != null && PG_TPL_IDS.includes(String(b.template))) d.template = String(b.template);
  if (b.color != null) d.color = PG_COLORS.includes(String(b.color)) ? String(b.color) : "";
  if (b.logo === null || b.logo === "") d.logo = null;
  else if (typeof b.logo === "string" && /^data:image\/(png|jpeg);base64,/.test(b.logo) && b.logo.length <= 300000) d.logo = b.logo;
  if (b.years != null) d.years = Math.max(1, Math.min(60, parseInt(b.years, 10) || d.years || 10));
  if (b.area != null) d.area = String(b.area).slice(0, 140).trim(); // cities served — feeds the site's SEO/area line
  // Content the owner edits himself — structured fields only, all escaped at
  // render time by templates.mjs. Photos are HIS work (the panel says so).
  if (b.biz != null && String(b.biz).trim()) d.biz = String(b.biz).slice(0, 60).trim();
  if (b.phone != null && String(b.phone).replace(/\D/g, "").length >= 10) d.phone = String(b.phone).replace(/\D/g, "").slice(0, 11);
  if (b.city != null && String(b.city).trim()) d.city = String(b.city).slice(0, 60).trim();
  if (b.license != null) d.license = String(b.license).slice(0, 40).trim();
  if (b.tagline != null) d.tagline = String(b.tagline).slice(0, 140).trim();
  if (b.about != null) d.about = String(b.about).slice(0, 450).trim();
  if (b.facebook != null) d.facebook = /^https:\/\/[^\s"'<>]{8,300}$/.test(String(b.facebook).trim()) ? String(b.facebook).trim() : "";
  if (b.instagram != null) d.instagram = /^https:\/\/[^\s"'<>]{8,300}$/.test(String(b.instagram).trim()) ? String(b.instagram).trim() : "";
  if (Array.isArray(b.services)) d.services = b.services.map((s) => String(s).slice(0, 40).trim()).filter(Boolean).slice(0, 8);
  const okPhoto = (p) => typeof p === "string" && /^data:image\/(png|jpeg);base64,/.test(p) && p.length <= 320000;
  if (Array.isArray(b.photos)) {
    const ph = b.photos.filter(okPhoto).slice(0, 6);
    if (ph.reduce((n, p) => n + p.length, 0) <= 1500000) d.photos = ph; // total cap ~1.5MB per draft
  }
  if (Array.isArray(b.photosAdd)) { // append — the panel never re-uploads what's already there
    const cur = Array.isArray(d.photos) ? d.photos : [];
    const next = cur.concat(b.photosAdd.filter(okPhoto)).slice(0, 6);
    if (next.reduce((n, p) => n + p.length, 0) <= 1500000) d.photos = next;
  }
  if (b.photoDel != null && Array.isArray(d.photos)) {
    const i = parseInt(b.photoDel, 10);
    if (i >= 0 && i < d.photos.length) d.photos.splice(i, 1);
  }
  await db.kvSet(pgKey(id), d);
  res.json({ ok: 1 });
});

// AI copy for the draft: tagline + about from ONLY the facts the visitor gave
// (no invented claims). No AI key → curated variants, same as /api/ai's demo.
const PG_COPY = {
  fence: [
    { t: (d) => `Cercas de calidad en ${d.city} — cotiza la tuya en 60 segundos, sin visitas ni esperas.`,
      a: (d) => `Somos ${d.biz}: ${d.years} años levantando cercas en ${d.city} y alrededores. Trabajo derecho, precios claros y garantía por escrito — tratas directo con el dueño.` },
    { t: (d) => `Tu cerca nueva empieza aquí: marca tu terreno por satélite y recibe tu estimado al instante.`,
      a: (d) => `En ${d.biz} llevamos ${d.years} años haciendo cercas como si fueran para nuestra propia casa. Materiales de primera, fechas que se cumplen y un precio que no cambia a mitad del trabajo.` },
    { t: (d) => `${d.biz} — cercas residenciales y comerciales en ${d.city}, con garantía por escrito.`,
      a: (d) => `${d.years} años de experiencia nos respaldan. Cotiza hoy mismo desde tu teléfono: pones tu dirección, marcas tu cerca y te llega tu estimado — así de fácil.` },
  ],
  roofing: [
    { t: (d) => `Techos bien hechos en ${d.city} — cotiza el tuyo por satélite, sin que nadie te visite.`,
      a: (d) => `Somos ${d.biz}: ${d.years} años reparando y reemplazando techos en ${d.city}. Trabajo garantizado por escrito y un precio claro desde el primer día.` },
    { t: (d) => `Tu techo nuevo empieza aquí: tu dirección, tu medida por satélite y tu estimado al instante.`,
      a: (d) => `En ${d.biz} llevamos ${d.years} años cuidando las casas de la región como si fueran la nuestra. Materiales de primera y fechas que se cumplen.` },
    { t: (d) => `${d.biz} — techos residenciales y comerciales en ${d.city}, con garantía por escrito.`,
      a: (d) => `${d.years} años de experiencia nos respaldan. Cotiza hoy mismo desde tu teléfono — sin llamadas, sin esperas, sin compromiso.` },
  ],
};
app.post("/api/pagina/copy/:id", async (req, res) => {
  if (!PAGINA_ENABLED) return res.status(404).json({ error: "off" });
  if (overQuota(`pgai:${clientIp(req)}`, 15)) return res.status(429).json({ error: "quota" });
  const id = pgId(req.params.id);
  const d = await db.kvGet(pgKey(id)).catch(() => null);
  if (!d) return res.status(404).json({ error: "draft" });
  if ((d.aiN || 0) >= 6) return res.status(429).json({ error: "max" });
  let tagline = "", about = "";
  if (aiLive) {
    try {
      const out = await aiChat({
        system: `Eres el copywriter de ALTO Pro. Responde SOLO un JSON válido: {"tagline":"...","about":"..."} para la página web de un contratista hispano. Español cálido de tú, concreto, profesional. PROHIBIDO inventar datos (premios, cifras, clientes) — usa solo lo que te doy. tagline ≤ 130 caracteres; about ≤ 350 caracteres.`,
        messages: [{ role: "user", content: `Negocio: ${d.biz}. Oficio: ${d.trade === "fence" ? "cercas" : "techos"}. Ciudad: ${d.city}. Años de experiencia: ${d.years}. La página incluye un cotizador satelital integrado — puedes mencionarlo. Variante #${(d.aiN || 0) + 1}, hazla distinta a las anteriores.` }],
        maxTokens: 400,
      });
      const j = JSON.parse((out.match(/\{[\s\S]*\}/) || ["{}"])[0]);
      if (j.tagline && j.about) { tagline = String(j.tagline).slice(0, 140); about = String(j.about).slice(0, 400); }
    } catch {}
  }
  if (!tagline) {
    const v = PG_COPY[d.trade === "fence" ? "fence" : "roofing"][(d.aiN || 0) % 3];
    tagline = v.t(d); about = v.a(d);
  }
  d.tagline = tagline; d.about = about; d.aiN = (d.aiN || 0) + 1;
  await db.kvSet(pgKey(id), d);
  res.json({ ok: 1, tagline, about });
});

// 🎤 Voice note → Whisper → about-section in the contractor's OWN words.
// Same Whisper plumbing as the voice invoice; needs OPENAI_KEY (the toolbar
// only shows the mic button when the server has it).
app.post("/api/pagina/voice/:id", async (req, res) => {
  if (!PAGINA_ENABLED) return res.status(404).json({ error: "off" });
  if (!OPENAI_KEY) return res.status(503).json({ error: "no_stt" });
  if (overQuota(`pgstt:${clientIp(req)}`, 10)) return res.status(429).json({ error: "quota" });
  const id = pgId(req.params.id);
  const d = await db.kvGet(pgKey(id)).catch(() => null);
  if (!d) return res.status(404).json({ error: "draft" });
  if ((d.vN || 0) >= 4) return res.status(429).json({ error: "max" });
  const b64 = String(req.body?.audio || "");
  if (!b64 || b64.length > 1.6e6) return res.status(400).json({ error: "audio" });
  const mime = /^audio\/(webm|mp4|mpeg|ogg|wav)$/.test(String(req.body?.mime || "")) ? req.body.mime : "audio/webm";
  try {
    const buf = Buffer.from(b64, "base64");
    const fd = new FormData();
    fd.append("file", new Blob([buf], { type: mime }), mime.includes("mp4") ? "a.mp4" : "a.webm");
    fd.append("model", "whisper-1");
    fd.append("language", "es");
    fd.append("prompt", `Un contratista de ${d.trade === "fence" ? "cercas" : "techos"} cuenta la historia de su negocio para su página web: años de experiencia, su ciudad, especialidades, por qué confiar en él.`);
    const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST", headers: { Authorization: `Bearer ${OPENAI_KEY}` }, body: fd,
    });
    if (!r.ok) throw new Error(`stt ${r.status}`);
    const transcript = String((await r.json()).text || "").slice(0, 900).trim();
    if (!transcript) return res.status(400).json({ error: "empty" });
    let about = "", tagline = "";
    try {
      const out2 = await aiChat({
        system: `Eres el copywriter de ALTO Pro. Un contratista hispano contó su negocio EN VOZ ALTA; conviértelo en el texto de su página web. Responde SOLO JSON: {"tagline":"...","about":"..."}. Usa SUS palabras y hechos — PROHIBIDO inventar datos que no dijo. Español cálido de tú. tagline ≤ 130 caracteres; about ≤ 380 caracteres, primera persona ("Somos…", "Llevamos…").`,
        messages: [{ role: "user", content: `Negocio: ${d.biz}. Oficio: ${d.trade === "fence" ? "cercas" : "techos"}. Ciudad: ${d.city}. Lo que contó: "${transcript}"` }],
        maxTokens: 400,
      });
      const j2 = JSON.parse((out2.match(/\{[\s\S]*\}/) || ["{}"])[0]);
      if (j2.about) { about = String(j2.about).slice(0, 400); tagline = String(j2.tagline || "").slice(0, 140); }
    } catch {}
    if (!about) about = transcript.slice(0, 380); // worst case: his words, verbatim
    d.about = about; if (tagline) d.tagline = tagline;
    d.vN = (d.vN || 0) + 1;
    await db.kvSet(pgKey(id), d);
    res.json({ ok: 1, about, tagline });
  } catch (e) {
    console.error("pagina voice:", e.message);
    res.status(502).json({ error: "stt_failed" });
  }
});

function paginaPage(req) {
  const base = canonBase(req);
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ALTO Pro — Tu página web inteligente por $49</title>
<meta name="description" content="Es 2026 y tu negocio todavía no tiene página web. Llena el formulario, mira TU página lista en 1 minuto y estrénala hoy por $49.">
<meta property="og:title" content="Tu página web inteligente — lista en 1 minuto, $49">
<meta property="og:description" content="Llena el formulario, mira TU página terminada y estrénala hoy. Para techeros y cerqueros.">
<meta property="og:type" content="website">
<meta property="og:url" content="${base}/pagina">
<link rel="icon" href="/icon-192.png">
${metaPixelHead()}
<style>
@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=Inter:wght@400;600;700;800&display=swap');
*{box-sizing:border-box;font-family:Inter,Arial,sans-serif;margin:0;-webkit-tap-highlight-color:transparent}
body{background:#fff;color:#101B30}
.wrap{max-width:760px;margin:0 auto;padding:0 22px}
nav{display:flex;justify-content:center;padding:28px 0 2px}
nav img{height:60px}
.hero{padding:36px 0 26px;text-align:center}
.hero h1{font-family:'Barlow Condensed',sans-serif;font-size:clamp(40px,8vw,72px);line-height:1.0;font-weight:800}
.hero h1 em{color:#F8B408;font-style:normal}
.hero p{color:#5A6478;font-size:clamp(15px,2.4vw,18px);font-weight:600;margin:16px auto 0;max-width:560px;line-height:1.55}
.steps{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:22px}
.steps span{background:#F4F7FB;border:1px solid #E6EBF3;border-radius:99px;padding:8px 15px;font-size:12.5px;font-weight:700;color:#44506A}
.card{background:#fff;border:2px solid #F8B408;border-radius:24px;padding:30px 26px;max-width:560px;margin:26px auto 40px;box-shadow:0 30px 80px rgba(248,180,8,.18)}
.card h2{font-family:'Barlow Condensed',sans-serif;font-size:26px;font-weight:800;text-align:center;margin-bottom:4px}
.card .sub{text-align:center;color:#67718A;font-size:13px;font-weight:600;margin-bottom:18px}
label{display:block;font-size:12px;font-weight:800;color:#44506A;margin:13px 0 5px;letter-spacing:.03em}
input,select{width:100%;border:1.5px solid #E4E7EC;border-radius:12px;padding:13px 14px;font-size:15px;font-weight:600;color:#101B30;background:#fff}
input:focus,select:focus{outline:none;border-color:#F8B408}
.go{width:100%;background:#F8B408;border:none;color:#101B30;border-radius:14px;padding:16px;font-weight:800;font-size:16.5px;margin-top:20px;cursor:pointer;box-shadow:0 10px 26px rgba(248,180,8,.35)}
.err{display:none;color:#C0392B;font-size:12.5px;font-weight:700;margin-top:8px}
.fine{color:#8A94A8;font-size:11px;font-weight:600;line-height:1.55;margin-top:12px;text-align:center}
footer{padding:30px 0 50px;text-align:center;font-size:13px;color:#8A94A8;font-weight:600}
#pgbuild .pgm{opacity:0;animation:pgin .55s cubic-bezier(.16,1,.3,1) forwards}
@keyframes pgin{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
#pgbuild .pgpop{animation-name:pgpop}
@keyframes pgpop{0%{opacity:0;transform:scale(.5)}70%{opacity:1;transform:scale(1.1)}100%{opacity:1;transform:scale(1)}}
#pgbuild .pgshine{position:absolute;inset:0;background:linear-gradient(110deg,transparent 30%,rgba(255,255,255,.4) 50%,transparent 70%);transform:translateX(-100%);animation:pgsh 1.5s ease 1.1s 3}
@keyframes pgsh{to{transform:translateX(100%)}}
</style></head><body>
<div class="wrap">
<nav><img src="/brand-logo.png" alt="ALTO Pro"></nav>
<div class="hero">
  <h1>ES 2026 — ¿Y TU NEGOCIO TODAVÍA NO TIENE <em>PÁGINA WEB?</em></h1>
  <p>¿No tienes página — o la que tienes <b>no cotiza sola</b>? Llena el formulario y mira <b>TU página terminada</b> en 1 minuto — con tu nombre, tu ciudad y un cotizador con inteligencia artificial que capta clientes las 24 horas. Si te gusta, la estrenas hoy por <b style="color:#101B30">$49</b>.</p>
  <div class="steps"><span>1️⃣ Llena el formulario</span><span>2️⃣ Mira TU página lista</span><span>3️⃣ Estrénala hoy</span></div>
</div>
<div class="card">
  <h2>ARMA TU PÁGINA AHORA</h2>
  <p class="sub">1 minuto · sin compromiso · la ves antes de pagar</p>
  <form id="pf" onsubmit="return goPreview(event)">
    <label>¿Qué trabajo haces?</label>
    <select id="f_trade"><option value="roofing">🏠 Techos</option><option value="fence">🪵 Cercas</option></select>
    <label>Nombre de tu negocio</label>
    <input id="f_biz" placeholder="Ej. González Roofing" required maxlength="60">
    <label>Tu nombre</label>
    <input id="f_name" placeholder="Tu nombre" required maxlength="60">
    <label>Tu celular</label>
    <input id="f_phone" type="tel" inputmode="numeric" placeholder="956 555 0188" required>
    <label>Tu ciudad</label>
    <input id="f_city" placeholder="Ej. McAllen, TX" required maxlength="60">
    <label>Años de experiencia</label>
    <input id="f_years" type="number" inputmode="numeric" min="1" max="60" value="10">
    <p class="err" id="perr">Pon tus 10 dígitos, ej. 956 555 0188</p>
    <button class="go">🚀 VER MI PÁGINA →</button>
    <p class="fine">Estreno: <b>$49 una sola vez</b> · hosting $19/mes a partir del mes 2 (tu página en línea 24/7 + el cotizador) · cancela cuando quieras.</p>
    <p class="fine">Al enviar, aceptas que ALTO Pro te contacte por llamada, SMS o WhatsApp. No vendemos tus datos. <a href="/privacidad" target="_blank" style="color:inherit">Privacidad</a></p>
  </form>
</div>
</div>
<div class="wrap"><footer>ALTO Pro · Hecho en Texas 🤠 · <a href="https://app.alto-pro.com" style="color:inherit">app.alto-pro.com</a></footer></div>
<div id="pgbuild" style="display:none;position:fixed;inset:0;z-index:99999;background:#fff;flex-direction:column;align-items:center;justify-content:center;gap:20px;padding:26px;text-align:center;--pga:#1E6B33">
  <img src="/brand-logo.png" alt="ALTO Pro" style="height:52px">
  <div style="width:300px;max-width:88vw;background:#fff;border:1px solid #E6EBF3;border-radius:16px;box-shadow:0 30px 70px rgba(16,27,48,.16);overflow:hidden;text-align:left">
    <div style="display:flex;gap:5px;padding:9px 12px;background:#F4F6FA;border-bottom:1px solid #E9EDF3">
      <span style="width:8px;height:8px;border-radius:99px;background:#FF5F57"></span><span style="width:8px;height:8px;border-radius:99px;background:#FEBC2E"></span><span style="width:8px;height:8px;border-radius:99px;background:#28C840"></span>
    </div>
    <div style="padding:13px">
      <div class="pgm" style="animation-delay:.35s;display:flex;justify-content:space-between;align-items:center">
        <span style="width:66px;height:10px;border-radius:6px;background:#D9DEE8"></span>
        <span style="width:56px;height:17px;border-radius:9px;background:var(--pga)"></span>
      </div>
      <div class="pgm" style="animation-delay:1.0s;margin-top:11px;height:88px;border-radius:11px;background:linear-gradient(135deg,var(--pga),#0B1226);position:relative;overflow:hidden">
        <span class="pgshine"></span>
        <span style="position:absolute;left:12px;bottom:26px;width:120px;height:9px;border-radius:6px;background:rgba(255,255,255,.85)"></span>
        <span style="position:absolute;left:12px;bottom:12px;width:84px;height:7px;border-radius:6px;background:rgba(255,255,255,.5)"></span>
      </div>
      <span class="pgm" style="animation-delay:1.8s;display:block;margin-top:11px;height:9px;width:84%;border-radius:6px;background:#E3E8F0"></span>
      <span class="pgm" style="animation-delay:2.1s;display:block;margin-top:6px;height:9px;width:62%;border-radius:6px;background:#E9EDF3"></span>
      <span class="pgm pgpop" style="animation-delay:2.6s;display:block;margin:13px auto 0;height:27px;width:128px;border-radius:9px;background:#F8B408"></span>
      <div style="display:flex;gap:7px;margin-top:13px">
        <span class="pgm" style="animation-delay:3.1s;flex:1;height:36px;border-radius:8px;background:#EDF0F5"></span>
        <span class="pgm" style="animation-delay:3.4s;flex:1;height:36px;border-radius:8px;background:#E9EDF3"></span>
        <span class="pgm" style="animation-delay:3.7s;flex:1;height:36px;border-radius:8px;background:#EDF0F5"></span>
      </div>
    </div>
  </div>
  <div id="pgsteps" style="display:flex;flex-direction:column;gap:9px;align-items:flex-start;min-width:250px"></div>
  <div style="width:220px;height:5px;border-radius:9px;background:#ECEFF5;overflow:hidden"><div id="pgprog" style="width:0%;height:100%;border-radius:9px;background:#F8B408;transition:width .9s ease"></div></div>
  <p style="color:#8A94A8;font-weight:700;font-size:13px;margin:0">Construyendo tu página…</p>
</div>
<script>
function track(ev){try{fetch('/api/track',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event:ev})})}catch(e){}}
var UTM={};
try{
  var sp=new URLSearchParams(location.search);
  var stored=JSON.parse(localStorage.getItem('alto_utm')||'null');
  if(sp.get('utm_source')||sp.get('utm_campaign')||sp.get('utm_content')){
    UTM={source:sp.get('utm_source')||'',campaign:sp.get('utm_campaign')||'',content:sp.get('utm_content')||''};
    if(!stored)localStorage.setItem('alto_utm',JSON.stringify(UTM));else UTM=stored;
  }else if(stored){UTM=stored}
}catch(e){}
// ad links can pre-pick the trade: /pagina?t=cercas (fence ads) or ?t=techos
try{var tp=new URLSearchParams(location.search).get('t');
  if(tp==='cercas'||tp==='fence')document.getElementById('f_trade').value='fence';
  else if(tp==='techos'||tp==='roofing')document.getElementById('f_trade').value='roofing';
}catch(e){}
function crSlug(){return String(UTM.content||UTM.campaign||'').toLowerCase().replace(/[^a-z0-9_-]/g,'-').replace(/^-+|-+$/g,'').slice(0,40)}
function trackStep(step){track('fn:pagina:'+step);var s=crSlug();if(s&&(step==='visit'||step==='lead'||step==='buy'))track('cr:pagina:'+step+':'+s)}
trackStep('visit');
function goPreview(e){e.preventDefault();
  var ph=document.getElementById('f_phone').value.replace(/\D/g,'');
  if(ph.length<10){document.getElementById('perr').style.display='block';return false}
  document.getElementById('perr').style.display='none';
  var d={trade:document.getElementById('f_trade').value,biz:document.getElementById('f_biz').value.trim(),
    name:document.getElementById('f_name').value.trim(),phone:ph,
    city:document.getElementById('f_city').value.trim(),years:document.getElementById('f_years').value||'10'};
  // the lead lands in alto-ventas BEFORE the preview — non-buyers stay reachable
  try{fetch('/api/widget/lead',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({slug:'alto-ventas',name:d.name,phone:d.phone,
      info:{src:'pagina-funnel',funnel:'pagina',biz:d.biz,city:d.city,trade:d.trade,
        utm_source:UTM.source||'',utm_campaign:UTM.campaign||'',utm_content:UTM.content||''}})})}catch(e){}
  trackStep('lead');if(window.fbq)fbq('track','Lead');
  // The "construction moment": 4 visible steps while the draft is created.
  // Perceived effort = perceived value — the reveal lands harder after it.
  var ov=document.getElementById('pgbuild');
  ov.style.setProperty('--pga', d.trade==='fence'?'#1E6B33':'#B30F24');
  ov.style.display='flex';
  var steps=['🛰️ Ubicando '+(d.city||'tu ciudad')+'…','🎨 Diseñando tu página…','✍️ Escribiendo tu texto…',(d.trade==='fence'?'🪵 Colocando tu cerca…':'🏠 Montando tu techo…')];
  var box=document.getElementById('pgsteps'),prog=document.getElementById('pgprog');
  steps.forEach(function(s,i){setTimeout(function(){
    var p=document.createElement('p');
    p.style.cssText='margin:0;color:#101B30;font-weight:800;font-size:14.5px;opacity:0;transition:opacity .4s';
    p.textContent=s;box.appendChild(p);requestAnimationFrame(function(){p.style.opacity='1'});
    prog.style.width=Math.round((i+1)/steps.length*100)+'%';
    if(i>0)box.children[i-1].textContent='✓ '+steps[i-1].slice(steps[i-1].indexOf(' ')+1);
  },400+i*950)});
  // create the draft (kv) so the preview is customizable; legacy query-string
  // preview stays as the fallback if the draft API hiccups
  var t0=Date.now();
  function go(url){var wait=Math.max(0,4600-(Date.now()-t0));setTimeout(function(){location.href=url},wait)}
  fetch('/api/pagina/draft',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)})
    .then(function(r){return r.ok?r.json():null})
    .then(function(j){
      if(j&&j.ok&&j.id)go('/pagina/preview?d='+j.id);
      else go('/pagina/preview?'+new URLSearchParams(d).toString());
    })
    .catch(function(){go('/pagina/preview?'+new URLSearchParams(d).toString())});
  return false}
</script></body></html>`;
}

app.get("/pagina", (req, res) => {
  if (!PAGINA_ENABLED) return res.redirect("/app");
  res.set("Content-Type", "text/html; charset=utf-8");
  res.send(paginaPage(req));
});

// The preview IS the product: their data through the same renderSite() as
// every client site, wearing a claim bar. No fake reviews on a real business
// preview — the reviews section simply waits for their own.
app.get("/pagina/preview", async (req, res) => {
  if (!PAGINA_ENABLED) return res.redirect("/app");
  // draft-backed preview (?d=<id>) is the customizable one; the legacy
  // query-string form still renders for old links and as the JS fallback
  let draft = null, did = "";
  if (req.query.d) {
    did = pgId(req.query.d);
    draft = await db.kvGet(pgKey(did)).catch(() => null);
    if (!draft) return res.redirect("/pagina");
  }
  const src = draft || req.query;
  const fence = src.trade === "fence";
  const biz = String(src.biz || "Tu Negocio").slice(0, 60);
  const city = String(src.city || "Tu Ciudad, TX").slice(0, 60);
  const years = Math.max(1, Math.min(60, parseInt(src.years, 10) || 10));
  const phone = String(src.phone || "").replace(/\D/g, "").slice(0, 11);
  // ?tpl=N previews a specific template (the toolbar's thumbnail cards);
  // ?bare=1 strips ribbon/toolbar/bar/chat — the thumbnails' clean render.
  const tplOv = PG_TPL_IDS.includes(String(req.query.tpl)) ? String(req.query.tpl) : "";
  const bare = req.query.bare === "1";
  const heroAsset = (name) =>
    fs.existsSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "landing", name))
    || fs.existsSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "landing", name));
  const heroName = fence ? "hero-fence.jpg" : "hero-roof.jpg";
  const heroImgPath = heroAsset(heroName) ? `/landing/${heroName}` : "";
  const tplUsed = tplOv || (draft && PG_TPL_IDS.includes(String(draft.template)) && String(draft.template)) || "1";
  const html = renderSite({
    slug: fence ? "alto-cercas" : "alto-demo", // demo widget engine backs the preview quote tool
    trade: fence ? "fence" : undefined,
    heroImg: heroImgPath,
    biz, phone: phone || "9565550100",
    logo: draft && /^data:image\/(png|jpeg);base64,/.test(String(draft.logo || "")) ? draft.logo : null,
    template: tplUsed,
    color: (draft && draft.color) || (fence ? "#1E6B33" : "#B30F24"),
    city, years,
    tagline: (draft && draft.tagline) || (fence
      ? "Cercas nuevas y reparaciones con garantía — cotiza la tuya aquí mismo, en 60 segundos, sin que nadie te visite."
      : "Reemplazo y reparación de techos con garantía — cotiza el tuyo aquí mismo, medido por satélite, sin que nadie te visite."),
    about: (draft && draft.about) || `Empezamos hace ${years} años con una troca y muchas ganas. Hoy ${biz} ${fence ? "ha levantado cientos de cercas" : "ha hecho cientos de techos"} en la región — y seguimos tratando cada ${fence ? "patio" : "casa"} como si fuera ${fence ? "el nuestro" : "la nuestra"}.`,
    area: (draft && draft.area) || city,
    warranty: fence ? "Garantía por escrito en mano de obra" : "Garantía por escrito en mano de obra",
    diff: "Somos familia local — el mismo dueño supervisa cada trabajo, de principio a fin.",
    ...(draft && Array.isArray(draft.services) && draft.services.length ? { services: draft.services } : {}),
    ...(draft && draft.license ? { license: draft.license } : {}),
    ...(draft && draft.facebook ? { facebook: draft.facebook } : {}),
    ...(draft && draft.instagram ? { instagram: draft.instagram } : {}),
    photos: (draft && Array.isArray(draft.photos) && draft.photos) || [], reviews: [], zonaLinks: false,
    widgetSpot: true, // the cotizador is the star of the product — glow + badge (previews only)
  }, bare ? { chat: false } : { ribbon: "ASÍ SE VERÁ TU PÁGINA — revísala y estrénala abajo 👇" });
  // Video hero (Clásica): drop REAL fence/roof b-roll (no faces, no crew
  // branding — ambiance, never a portfolio claim) at public/landing/
  // broll-fence.mp4 / broll-roof.mp4 and every Clásica preview breathes.
  // File-gated like the VSL: nothing renders until the footage exists.
  const brollName = fence ? "broll-fence.mp4" : "broll-roof.mp4";
  let out = html;
  if (tplUsed === "1" && heroAsset(brollName)) {
    const vid = `<video class="hbg" autoplay muted loop playsinline${heroImgPath ? ` poster="${heroImgPath}"` : ""}><source src="/landing/${brollName}" type="video/mp4"></video>`;
    out = /<img class="hbg"/.test(out)
      ? out.replace(/<img class="hbg"[^>]*>/, vid)
      : out.replace('<div class="hero">', `<div class="hero">${vid}`);
  }
  const buyHref = STRIPE_LINKS.pagina
    ? STRIPE_LINKS.pagina + (STRIPE_LINKS.pagina.includes("?") ? "&" : "?") + "client_reference_id=pagina" + (did ? `-${did}` : "")
    : `https://wa.me/${SALES_WA}?text=${encodeURIComponent(`Hola 👋 Quiero estrenar mi página web ($49) para ${biz}.`)}`;
  // Customize toolbar — draft-backed previews only. Every choice PATCHes the
  // draft and reloads (the server re-renders the real site, so what they see
  // is always exactly what they'd buy).
  const curTpl = (draft && String(draft.template)) || "1";
  const curColor = (draft && draft.color) || "";
  const esc2 = (s) => String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const toolbar = !draft ? "" : `
<style>.pgl{display:block;font-size:10.5px;font-weight:800;color:#8A94A8;margin-bottom:4px;letter-spacing:.04em}
.pgi{width:100%;padding:11px;border:1.5px solid #E4E7EC;border-radius:11px;font-size:14px;font-weight:600;color:#101B30;box-sizing:border-box;background:#fff}
.pgi:focus{outline:none;border-color:#F8B408}</style>
<div id="pgsc" onclick="pgTb(false)" style="display:none;position:fixed;inset:0;z-index:99997;background:rgba(11,18,38,.55)"></div>
<div id="pgtb" style="display:none;position:fixed;left:12px;right:12px;bottom:84px;z-index:99998;background:#fff;border-radius:22px;max-width:600px;margin:0 auto;box-shadow:0 30px 80px rgba(11,18,38,.45);padding:0 16px 12px;font-family:Inter,Arial,sans-serif;max-height:70vh;overflow-y:auto">
  <div style="max-width:560px;margin:0 auto">
    <div style="position:sticky;top:0;background:#fff;padding:14px 0 10px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #F0F2F7;margin-bottom:12px">
      <p id="pgttl" style="margin:0;font-size:14px;font-weight:800;color:#101B30">🎨 PERSONALIZA TU PÁGINA</p>
      <button onclick="pgWizClose()" aria-label="Cerrar" style="border:none;background:#F4F7FB;color:#44506A;width:32px;height:32px;border-radius:99px;font-size:15px;font-weight:800;cursor:pointer">✕</button>
    </div>
    <div class="pgsec" id="pgs1">
    <p style="margin:0 0 7px;font-size:11px;font-weight:800;letter-spacing:.06em;color:#44506A">ELIGE TU ESTILO <span style="color:#8A94A8;font-weight:600">— así se ve TU página en cada uno</span></p>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:9px">
      ${PG_TPL_IDS.map((v) => `<div onclick="pgPatch({template:'${v}'})" style="cursor:pointer;border-radius:13px;overflow:hidden;border:2.5px solid ${curTpl === v ? "#F8B408" : "#E4E7EC"};background:#F4F7FB">
        <div style="height:148px;overflow:hidden;pointer-events:none;position:relative"><iframe data-src="/pagina/preview?d=${did}&tpl=${v}&bare=1" style="width:860px;height:1180px;border:0;transform:scale(.125);transform-origin:0 0;background:#fff" tabindex="-1" scrolling="no"></iframe></div>
        <p style="margin:0;padding:7px 4px;text-align:center;font-weight:800;font-size:12px;color:#101B30;background:${curTpl === v ? "#FEF9E9" : "#fff"}">${curTpl === v ? "✓ " : ""}${PG_TPL_NAMES[v]}</p>
      </div>`).join("")}
    </div>
    </div>
    <div class="pgsec" id="pgs2">
    <p style="margin:14px 0 7px;font-size:11px;font-weight:800;letter-spacing:.06em;color:#44506A">TU COLOR</p>
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <button onclick="pgPatch({color:''})" style="padding:9px 13px;border-radius:99px;font-weight:800;font-size:12px;cursor:pointer;border:1.5px solid ${!curColor ? "#F8B408" : "#E4E7EC"};background:#fff;color:#101B30">Auto</button>
      ${PG_COLORS.map((c) => `<button onclick="pgPatch({color:'${c}'})" aria-label="color" style="width:34px;height:34px;border-radius:99px;cursor:pointer;background:${c};border:${curColor === c ? "3px solid #F8B408" : "2px solid #fff"};box-shadow:0 2px 8px rgba(16,27,48,.25)"></button>`).join("")}
    </div>
    </div>
    <div class="pgsec" id="pgs3">
    <p style="margin:14px 0 7px;font-size:11px;font-weight:800;letter-spacing:.06em;color:#44506A">TU NEGOCIO <span style="color:#8A94A8;font-weight:600">— esto ayuda a que te encuentren en Google</span></p>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <div style="flex:1;min-width:160px">
        <label class="pgl">NOMBRE DEL NEGOCIO</label>
        <input id="pgbiz" class="pgi" value="${esc2(draft.biz || "")}" maxlength="60">
      </div>
      <div style="flex:0 0 150px">
        <label class="pgl">TELÉFONO</label>
        <input id="pgtel" class="pgi" type="tel" inputmode="numeric" value="${esc2(draft.phone || "")}">
      </div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
      <div style="flex:1;min-width:140px">
        <label class="pgl">TU CIUDAD</label>
        <input id="pgcity" class="pgi" value="${esc2(draft.city || "")}" maxlength="60">
      </div>
      <div style="flex:0 0 96px">
        <label class="pgl">AÑOS EXP.</label>
        <input id="pgyrs" class="pgi" type="number" min="1" max="60" value="${draft.years || 10}">
      </div>
      <div style="flex:1;min-width:140px">
        <label class="pgl">LICENCIA (opcional)</label>
        <input id="pglic" class="pgi" value="${esc2(draft.license || "")}" placeholder="# de licencia" maxlength="40">
      </div>
    </div>
    <label class="pgl" style="margin-top:8px">CIUDADES QUE CUBRES</label>
    <input id="pgarea" class="pgi" value="${esc2(draft.area || "")}" placeholder="Ej. McAllen, Edinburg, Mission" maxlength="140">
    <label class="pgl" style="margin-top:10px">TUS SERVICIOS <span style="color:#8A94A8">— toca los que haces</span></label>
    <div id="pgsvcs" style="display:flex;gap:7px;flex-wrap:wrap">
      ${(PG_SVC[draft.trade === "fence" ? "fence" : "roofing"]).map((s) => {
        const on = Array.isArray(draft.services) && draft.services.includes(s);
        return `<button data-svc="${esc2(s)}" onclick="pgSvcT(this)" style="padding:9px 14px;border-radius:99px;font-weight:700;font-size:12.5px;cursor:pointer;border:1.5px solid ${on ? "#F8B408" : "#E4E7EC"};background:${on ? "#FEF9E9" : "#fff"};color:#101B30">${on ? "✓ " : ""}${s}</button>`;
      }).join("")}
    </div>
    <button onclick="pgSave3()" style="width:100%;margin-top:10px;padding:11px;border-radius:11px;font-weight:800;font-size:13.5px;cursor:pointer;border:none;background:#101B30;color:#fff">Guardar ✓</button>
    </div>
    <div class="pgsec" id="pgs4">
    <p style="margin:14px 0 7px;font-size:11px;font-weight:800;letter-spacing:.06em;color:#44506A">TU LOGO</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button onclick="document.getElementById('pglf').click()" style="flex:1;min-width:150px;padding:11px;border-radius:11px;font-weight:800;font-size:13px;cursor:pointer;border:1.5px solid #E4E7EC;background:#fff;color:#101B30">📷 ${draft.logo ? "Cambiar logo" : "Subir mi logo"}</button>
      ${draft.logo ? `<button onclick="pgPatch({logo:''})" style="padding:11px 14px;border-radius:11px;font-weight:800;font-size:13px;cursor:pointer;border:1.5px solid #E4E7EC;background:#fff;color:#C0392B">🗑</button>` : ""}
    </div>
    <input id="pglf" type="file" accept="image/png,image/jpeg" style="display:none" onchange="pgLogo(this)">
    </div>
    <div class="pgsec" id="pgs5">
    <p style="margin:14px 0 7px;font-size:11px;font-weight:800;letter-spacing:.06em;color:#44506A">FOTOS DE TUS TRABAJOS <span style="color:#8A94A8;font-weight:600">— TUS trabajos reales (hasta 6)</span></p>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      ${(Array.isArray(draft.photos) ? draft.photos : []).map((p, i) => `<div style="position:relative;width:74px;height:74px"><img src="/api/pagina/photo/${did}/${i}" style="width:74px;height:74px;object-fit:cover;border-radius:12px;border:1.5px solid #E4E7EC"><button onclick="pgFotoDel(${i})" style="position:absolute;top:-7px;right:-7px;width:22px;height:22px;border-radius:99px;border:none;background:#101B30;color:#fff;font-size:11px;font-weight:800;cursor:pointer">✕</button></div>`).join("")}
      ${(!draft.photos || draft.photos.length < 6) ? `<button onclick="document.getElementById('pgff').click()" style="width:74px;height:74px;border-radius:12px;border:1.5px dashed #C9CFDA;background:#F8FAFC;color:#44506A;font-size:22px;cursor:pointer">➕</button>` : ""}
    </div>
    <input id="pgff" type="file" accept="image/png,image/jpeg" multiple style="display:none" onchange="pgFotos(this)">
    </div>
    <div class="pgsec" id="pgs6">
    <p style="margin:14px 0 7px;font-size:11px;font-weight:800;letter-spacing:.06em;color:#44506A">TU TEXTO</p>
    <label class="pgl">FRASE PRINCIPAL</label>
    <input id="pgtag" class="pgi" value="${esc2(draft.tagline || "")}" placeholder="Ej. Cercas de calidad en tu ciudad — cotiza en 60 segundos" maxlength="140">
    <label class="pgl" style="margin-top:8px">TU HISTORIA</label>
    <textarea id="pgabt" class="pgi" rows="4" maxlength="450" placeholder="Cuéntales quién eres y por qué confiar en ti…" style="resize:vertical;font-family:inherit">${esc2(draft.about || "")}</textarea>
    <button onclick="pgSaveTxt()" style="width:100%;margin-top:8px;padding:11px;border-radius:11px;font-weight:800;font-size:13.5px;cursor:pointer;border:1.5px solid #E4E7EC;background:#fff;color:#101B30">Guardar mi texto ✓</button>
    <button id="pgai" onclick="pgAI()" style="width:100%;margin-top:8px;padding:12px;border-radius:11px;font-weight:800;font-size:13.5px;cursor:pointer;border:none;background:#101B30;color:#fff">✨ Escribirlo con IA</button>
    ${OPENAI_KEY ? `<button id="pgvz" onclick="pgVoice()" style="width:100%;margin-top:8px;padding:12px;border-radius:11px;font-weight:800;font-size:13.5px;cursor:pointer;border:1.5px dashed #C9B26B;background:#FEF9E9;color:#7A5A00">🎤 O cuéntanos tu negocio (20 seg) — la IA usa TUS palabras</button>` : ""}
    </div>
    <div class="pgsec pgfull" id="pgs7">
    <p style="margin:14px 0 7px;font-size:11px;font-weight:800;letter-spacing:.06em;color:#44506A">TUS REDES <span style="color:#8A94A8;font-weight:600">— aparecen al pie de tu página</span></p>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <input id="pgfb" class="pgi" style="flex:1;min-width:170px" value="${esc2(draft.facebook || "")}" placeholder="https://facebook.com/tunegocio">
      <input id="pgig" class="pgi" style="flex:1;min-width:170px" value="${esc2(draft.instagram || "")}" placeholder="https://instagram.com/tunegocio">
    </div>
    <button onclick="pgSaveSoc()" style="width:100%;margin-top:8px;padding:11px;border-radius:11px;font-weight:800;font-size:13.5px;cursor:pointer;border:1.5px solid #E4E7EC;background:#fff;color:#101B30">Guardar redes ✓</button>
    </div>
    <div id="pgwf" style="display:none;align-items:center;justify-content:space-between;margin-top:14px;padding-top:11px;border-top:1px solid #F0F2F7">
      <button id="pgback" onclick="pgWizGo(pgWiz-1)" style="border:none;background:none;color:#8A94A8;font-weight:800;font-size:13px;cursor:pointer;padding:8px 4px">← Atrás</button>
      <div id="pgdots" style="display:flex;gap:6px"></div>
      <button id="pgnext" onclick="pgWizGo(pgWiz+1)" style="border:none;background:#F8B408;color:#101B30;font-weight:800;font-size:13.5px;cursor:pointer;padding:10px 18px;border-radius:11px">Siguiente →</button>
    </div>
    <p style="margin:12px 0 4px;text-align:center;color:#8A94A8;font-size:10.5px;font-weight:600">Cada cambio se guarda solo — lo que ves es lo que estrenas.</p>
  </div>
</div>
<div id="pgok" style="display:none;position:fixed;top:18px;left:12px;right:12px;z-index:99999;max-width:420px;margin:0 auto;background:#101B30;color:#fff;font-family:Inter,Arial,sans-serif;font-weight:800;font-size:14px;text-align:center;padding:14px;border-radius:14px;box-shadow:0 18px 44px rgba(11,18,38,.4)">✅ ¡Quedó! Revísala — y estrénala aquí abajo 👇</div>
<div id="pgrev" style="display:none;position:fixed;top:18px;left:12px;right:12px;z-index:99999;max-width:420px;margin:0 auto;background:#F8B408;color:#101B30;font-family:Inter,Arial,sans-serif;font-weight:800;font-size:14px;text-align:center;padding:14px;border-radius:14px;box-shadow:0 18px 44px rgba(11,18,38,.35)">✨ ¡Así quedó tu página! Échale un ojo…</div>
<script>
var PGD=${JSON.stringify(did)};
// Tesla-configurator wizard: one choice per screen, the page changes behind
// the card after each one. pgWiz 0 = full panel (re-edits via 🎨).
var pgWiz=0;
var PGSTEPS=['','Tu estilo','Tu color','Tu negocio','Tu logo','Tus fotos','Tu texto'];
var PGW_MAX=6,PGS_ALL=7;
var pgSvcSel=${JSON.stringify((draft && draft.services) || [])};
function pgTb(open){var t=document.getElementById('pgtb');t.style.display=open?'block':'none';
  var sc=document.getElementById('pgsc');if(sc)sc.style.display=open?'block':'none';
  if(open){var ifs=t.querySelectorAll('iframe[data-src]');for(var i=0;i<ifs.length;i++){ifs[i].src=ifs[i].getAttribute('data-src');ifs[i].removeAttribute('data-src')}}
  try{sessionStorage.setItem('pgtb',open?'1':'0')}catch(e){}}
function pgWizGo(n){
  if(n>PGW_MAX){pgWiz=0;try{sessionStorage.removeItem('pgwiz');sessionStorage.setItem('pgtb','0')}catch(e){}
    pgTb(false);var ok=document.getElementById('pgok');ok.style.display='block';
    setTimeout(function(){ok.style.display='none'},3500);return}
  pgWiz=n;try{sessionStorage.setItem('pgwiz',String(n))}catch(e){}
  pgTb(true);
  for(var i=1;i<=PGS_ALL;i++)document.getElementById('pgs'+i).style.display=(i===n)?'block':'none';
  document.getElementById('pgttl').textContent='Paso '+n+' de '+PGW_MAX+' — '+PGSTEPS[n];
  document.getElementById('pgnext').textContent=(n===PGW_MAX)?'Terminar ✓':'Siguiente →';
  document.getElementById('pgback').style.visibility=(n>1)?'visible':'hidden';
  var d=document.getElementById('pgdots'),h='';
  for(var k=1;k<=PGW_MAX;k++)h+='<span style="width:8px;height:8px;border-radius:99px;background:'+(k<=n?'#F8B408':'#E4E7EC')+'"></span>';
  d.innerHTML=h;
  document.getElementById('pgwf').style.display='flex';}
function pgWizFull(){pgWiz=0;try{sessionStorage.removeItem('pgwiz')}catch(e){}
  for(var i=1;i<=PGS_ALL;i++)document.getElementById('pgs'+i).style.display='block';
  document.getElementById('pgttl').textContent='🎨 PERSONALIZA TU PÁGINA';
  document.getElementById('pgwf').style.display='none';pgTb(true)}
function pgWizClose(){if(pgWiz>0){try{sessionStorage.removeItem('pgwiz')}catch(e){}pgWiz=0}pgTb(false)}
function pgPatch(o){fetch('/api/pagina/draft/'+PGD,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(o)}).then(function(r){return r.json()}).then(function(j){if(j&&j.ok){
  try{if(pgWiz>0)sessionStorage.setItem('pgwiz',String(pgWiz+1));sessionStorage.setItem('pgtb','1')}catch(e){}
  location.reload()}}).catch(function(){})}
function pgSave3(){pgPatch({
  biz:document.getElementById('pgbiz').value,
  phone:document.getElementById('pgtel').value,
  city:document.getElementById('pgcity').value,
  years:document.getElementById('pgyrs').value,
  license:document.getElementById('pglic').value,
  area:document.getElementById('pgarea').value,
  services:pgSvcSel})}
function pgSvcT(btn){var s=btn.getAttribute('data-svc');var i=pgSvcSel.indexOf(s);
  if(i>=0){pgSvcSel.splice(i,1);btn.style.borderColor='#E4E7EC';btn.style.background='#fff';btn.textContent=s}
  else{pgSvcSel.push(s);btn.style.borderColor='#F8B408';btn.style.background='#FEF9E9';btn.textContent='✓ '+s}}
function pgSaveTxt(){pgPatch({tagline:document.getElementById('pgtag').value,about:document.getElementById('pgabt').value})}
function pgSaveSoc(){pgPatch({facebook:document.getElementById('pgfb').value,instagram:document.getElementById('pgig').value})}
function pgFotoDel(i){pgPatch({photoDel:i})}
function pgFotos(inp){
  var fs=[].slice.call(inp.files||[]).slice(0,6);
  if(!fs.length)return;
  var out=[];
  (function next(k){
    if(k>=fs.length){if(out.length)pgPatch({photosAdd:out});return}
    var rd=new FileReader();var img=new Image();
    rd.onload=function(){img.onload=function(){
      var s=Math.min(1,900/Math.max(img.width,img.height));
      var cv=document.createElement('canvas');cv.width=Math.round(img.width*s);cv.height=Math.round(img.height*s);
      cv.getContext('2d').drawImage(img,0,0,cv.width,cv.height);
      var du=cv.toDataURL('image/jpeg',.82);
      if(du.length<=320000)out.push(du);
      next(k+1);
    };img.onerror=function(){next(k+1)};img.src=rd.result};
    rd.readAsDataURL(fs[k]);
  })(0)}
function pgLogo(inp){var f=inp.files&&inp.files[0];if(!f)return;
  var img=new Image();var rd=new FileReader();
  rd.onload=function(){img.onload=function(){
    var s=Math.min(1,240/Math.max(img.width,img.height));
    var cv=document.createElement('canvas');cv.width=Math.round(img.width*s);cv.height=Math.round(img.height*s);
    cv.getContext('2d').drawImage(img,0,0,cv.width,cv.height);
    var du=cv.toDataURL('image/png');
    if(du.length>300000)du=cv.toDataURL('image/jpeg',.8);
    if(du.length>300000){alert('La imagen es muy pesada — intenta con otra.');return}
    pgPatch({logo:du});
  };img.src=rd.result};rd.readAsDataURL(f)}
function pgAI(){var b=document.getElementById('pgai');b.disabled=true;b.textContent='✨ Escribiendo…';
  fetch('/api/pagina/copy/'+PGD,{method:'POST'}).then(function(r){return r.json()}).then(function(j){
    if(j&&j.ok){try{if(pgWiz>0)sessionStorage.setItem('pgwiz',String(pgWiz+1));sessionStorage.setItem('pgtb','1')}catch(e){};location.reload()}
    else{b.disabled=false;b.textContent='✨ Escribir mi texto con IA'}
  }).catch(function(){b.disabled=false;b.textContent='✨ Escribir mi texto con IA'})}
// 🎤 voice note → Whisper → the AI writes the about-section in HIS words
var pgRec=null,pgChunks=[],pgTmr=null;
function pgVoice(){
  var b=document.getElementById('pgvz');
  if(pgRec){pgRec.stop();return}
  if(!navigator.mediaDevices||!window.MediaRecorder){alert('Tu navegador no permite grabar audio.');return}
  navigator.mediaDevices.getUserMedia({audio:true}).then(function(st){
    var mime=MediaRecorder.isTypeSupported('audio/webm')?'audio/webm':(MediaRecorder.isTypeSupported('audio/mp4')?'audio/mp4':'');
    pgRec=new MediaRecorder(st,mime?{mimeType:mime}:undefined);pgChunks=[];
    pgRec.ondataavailable=function(e){if(e.data.size)pgChunks.push(e.data)};
    pgRec.onstop=function(){
      clearTimeout(pgTmr);st.getTracks().forEach(function(t){t.stop()});
      var blob=new Blob(pgChunks,{type:pgRec.mimeType||'audio/webm'});pgRec=null;
      b.textContent='✨ Escribiendo tu página…';
      var rd=new FileReader();
      rd.onload=function(){
        var b64=String(rd.result).split(',')[1]||'';
        fetch('/api/pagina/voice/'+PGD,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({audio:b64,mime:blob.type.split(';')[0]})})
          .then(function(r){return r.json()}).then(function(j){
            if(j&&j.ok){try{if(pgWiz>0)sessionStorage.setItem('pgwiz',String(pgWiz+1));sessionStorage.setItem('pgtb','1')}catch(e){};location.reload()}
            else{b.disabled=false;b.textContent='🎤 Cuéntanos tu negocio (20 seg) — la IA escribe tu página con TUS palabras';alert('No se pudo — intenta otra vez.')}
          }).catch(function(){b.disabled=false;b.textContent='🎤 Intentar otra vez'});
      };rd.readAsDataURL(blob);
    };
    pgRec.start();b.textContent='⏺ Grabando… toca para terminar';
    pgTmr=setTimeout(function(){if(pgRec)pgRec.stop()},20000);
  }).catch(function(){alert('Permite el micrófono para contarnos de tu negocio.')})}
try{
  var wz=parseInt(sessionStorage.getItem('pgwiz')||'0');
  if(wz>=1)document.addEventListener('DOMContentLoaded',function(){pgWizGo(wz)});
  else if(sessionStorage.getItem('pgtb')==='1')document.addEventListener('DOMContentLoaded',function(){pgWizFull()});
  // first visit: let them ABSORB the full page for a few seconds (with a
  // "¡así quedó!" toast), THEN the guided configurator invites itself
  else if(!localStorage.getItem('pgseen_'+PGD)){localStorage.setItem('pgseen_'+PGD,'1');document.addEventListener('DOMContentLoaded',function(){
    var rv=document.getElementById('pgrev');
    setTimeout(function(){if(rv)rv.style.display='block'},700);
    setTimeout(function(){if(rv)rv.style.display='none'},4300);
    setTimeout(function(){pgWizGo(1)},5000)})}
}catch(e){}
</script>`;
  const bar = `
<div style="position:fixed;left:0;right:0;bottom:0;z-index:99999;background:#101B30;padding:12px 14px calc(12px + env(safe-area-inset-bottom));box-shadow:0 -12px 30px rgba(16,27,48,.3)">
  <div style="max-width:560px;margin:0 auto;display:flex;gap:10px;align-items:center">
    <div style="flex:1;min-width:0">
      <p style="margin:0;color:#fff;font-weight:800;font-size:13.5px;font-family:Inter,Arial,sans-serif">✅ Tu página está LISTA</p>
      <p style="margin:0;color:#93A0BC;font-weight:600;font-size:10.5px;font-family:Inter,Arial,sans-serif">$49 hoy · hosting $19/mes desde el mes 2 · <a href="/pagina" style="color:#93A0BC">cambiar datos</a></p>
    </div>
    ${draft ? `<button onclick="document.getElementById('pgtb').style.display==='block'?pgWizClose():pgWizFull()" style="background:#1C2C4B;color:#fff;border:none;font-weight:800;font-size:13px;padding:13px 13px;border-radius:12px;cursor:pointer;font-family:Inter,Arial,sans-serif;white-space:nowrap">🎨</button>` : ""}
    <a href="${buyHref}" target="_blank" rel="noopener" onclick="try{fetch('/api/track',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event:'fn:pagina:buy'})})}catch(e){};if(window.fbq)fbq('track','InitiateCheckout')"
      style="background:#F8B408;color:#101B30;font-weight:800;font-size:14.5px;padding:13px 18px;border-radius:12px;text-decoration:none;font-family:Inter,Arial,sans-serif;white-space:nowrap">🚀 ESTRENARLA — $49</a>
  </div>
</div>
<script>try{fetch('/api/track',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event:'fn:pagina:try'})})}catch(e){}</script>`;
  res.set("Content-Type", "text/html; charset=utf-8");
  if (bare) return res.send(out); // thumbnail render: the site alone
  res.send(out.replace("</body>", toolbar + bar + "</body>"));
});

/* ── Client websites (the factory's output) ──
 * Rendered from the client's data card through template 1/2/3.
 * No code per client — improve a template, every site improves. */
async function siteDataOf(c, req, extra = {}) {
  const p = c.data?.profile || {};
  const site = c.data?.site || {};
  // Where this site canonically lives: the client's own domain when they have
  // one, else our /site/<slug> path on the current (or production) host.
  const host = reqHost(req);
  const onOwnHost = !OUR_HOSTS.has(host) && !host.endsWith(".onrender.com");
  const proto = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";
  const origin = site.domain ? `https://${site.domain}`
    : `${proto}://${/(^|\.)alto-pro\.com$/.test(host) ? "app.alto-pro.com" : host}`;
  const base = site.domain ? origin : `${origin}/site/${c.slug}`;
  const photos = Array.isArray(site.photos) ? site.photos : [];
  const firstPhoto = photos.find((x) => /^\/api\/logo\//.test(String(x)));
  return {
    slug: c.slug,
    trade: c.data?.trade === "fence" ? "fence" : "roofing",
    biz: p.biz || c.name,
    phone: String(p.phone || c.phone || "").replace(/\D/g, "").replace(/^1/, ""),
    logo: /^data:image\/(png|jpeg);base64,/.test(String(p.logo || "")) ? p.logo : null,
    license: p.license || "",
    template: site.template || "1",
    color: site.color || "#B30F24",
    hero: site.hero || "",
    heroImg: site.heroImg || "",
    city: site.city || "",
    years: site.years || null,
    tagline: site.tagline || "",
    about: site.about || "",
    photos,
    area: site.area || "",
    warranty: site.warranty || "",
    diff: site.diff || "",
    facebook: site.facebook || "",
    instagram: site.instagram || "",
    reviews: await getReviews(c.id),
    basePath: onOwnHost || site.domain ? "" : `/site/${c.slug}`,
    canonical: `${base}${extra.pageCity ? `/zona/${citySlug(extra.pageCity)}` : ""}`,
    ogImage: firstPhoto ? `${origin}${firstPhoto}` : "",
    opinaHref: onOwnHost ? "/opina" : `/opina/${c.slug}`,
    // FAQs approved with the client (bot training) — merged into the site's
    // FAQ section so the page answers with the client's own words.
    clientFaqs: Array.isArray(site.botTrain?.faqs) ? site.botTrain.faqs : [],
    ...(Array.isArray(site.services) && site.services.length ? { services: site.services } : {}),
    ...extra,
  };
}

app.get("/site/:slug", async (req, res) => {
  const c = await db.getContractorBySlug(String(req.params.slug));
  if (!c) return res.status(404).send("Not found");
  // Back-to-app button when the contractor previews from inside the app (?app=1).
  const sBack = req.query.app != null ? `<div style="padding:12px 16px 0"><a href="/" onclick="if(history.length>1){history.back();return false}" style="display:inline-flex;align-items:center;gap:5px;background:#fff;border:1.5px solid #E6E8EC;border-radius:999px;padding:8px 13px;font-weight:800;font-size:14px;color:#101B30;text-decoration:none;box-shadow:0 4px 14px rgba(16,27,48,.1)">‹ Volver a la app</a></div>` : "";
  if (c.data?.status === "paused" || c.data?.payStatus === "pending") {
    const pProf = c.data?.profile || {};
    const pBiz = String(pProf.biz || c.name).replace(/[&<>"]/g, "");
    const pPhone = String(pProf.phone || c.phone || "").replace(/\D/g, "");
    return res.send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${pBiz}</title><style>
*{box-sizing:border-box;font-family:Inter,Arial,sans-serif;margin:0}body{background:#F4F6FA;color:#101B30;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
.card{background:#fff;border:1px solid #E6EBF3;border-radius:22px;padding:36px 28px;max-width:420px;text-align:center;box-shadow:0 20px 60px rgba(16,27,48,.1)}
h1{font-size:20px;margin:12px 0 8px}p{color:#5A6478;font-weight:600;font-size:14.5px;line-height:1.6}
a{display:inline-block;margin-top:18px;background:#101B30;color:#fff;text-decoration:none;font-weight:800;padding:14px 26px;border-radius:12px}
</style></head><body><div class="card">
<span style="font-size:40px">🛠️</span><h1>${pBiz}</h1>
<p>Este sitio no está disponible por el momento.<br>This site is temporarily unavailable.</p>
${pPhone ? `<a href="tel:+1${pPhone}">📞 Llámanos / Call us</a>` : ""}
</div></body></html>`);
  }
  // Not published yet → branded "en construcción" page (the site is ready
  // internally; staff reveal it on delivery day). Staff preview with ?preview=1.
  const published = c.data?.site?.published === true;
  const preview = req.query.preview != null && (closerOk(req) || csOk(req));
  if (!published && !preview) {
    const cProf = c.data?.profile || {};
    const cBiz = String(cProf.biz || c.name).replace(/[&<>"]/g, "");
    const cLogo = /^data:image\/(png|jpeg);base64,/.test(String(cProf.logo || "")) ? cProf.logo : null;
    const cColor = /^#[0-9a-fA-F]{6}$/.test(String(c.data?.site?.color || "")) ? c.data.site.color : "#101B30";
    const cFence = c.data?.trade === "fence";
    return res.send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${cBiz} — en construcción</title><style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap');
*{box-sizing:border-box;font-family:Inter,Arial,sans-serif;margin:0}
body{background:#0F1726;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:22px}
.card{background:#fff;color:#101B30;border-radius:26px;padding:40px 30px;max-width:440px;width:100%;text-align:center;box-shadow:0 30px 80px rgba(0,0,0,.4)}
.logo{max-height:60px;max-width:200px;margin-bottom:8px}
.biz{font-weight:800;font-size:22px;color:${cColor}}
h1{font-size:20px;margin:18px 0 6px}
.sub{color:#5A6478;font-weight:600;font-size:14px;line-height:1.6}
.bar{height:8px;background:#EDF0F5;border-radius:99px;margin:22px 0 8px;overflow:hidden}
.fill{height:100%;width:66%;background:${cColor};border-radius:99px}
.eta{color:#8A94A8;font-weight:700;font-size:12px;letter-spacing:1px;text-transform:uppercase}
ul{list-style:none;padding:0;margin:24px 0 0;text-align:left}
li{padding:10px 0;border-bottom:1px solid #F0F2F6;font-weight:600;font-size:14px;display:flex;gap:10px;align-items:center}
li b{margin-left:auto;font-size:12px;font-weight:800}
.done b{color:#34A853}.wip b{color:#D99E00}
.ft{color:#9AA3B2;font-size:11.5px;font-weight:600;margin-top:22px}
</style></head><body>${sBack}<div class="card">
${cLogo ? `<img class="logo" src="${cLogo}" alt="${cBiz}">` : `<div class="biz">${cBiz}</div>`}
<h1>🏗️ Tu página web se está armando</h1>
<p class="sub">Nuestro equipo está poniendo los últimos detalles a tu página, tu cotizador ${cFence ? "de cercas" : "por satélite"} y tu sistema de mensajes.</p>
<div class="bar"><div class="fill"></div></div>
<p class="eta">Lista en los próximos días</p>
<ul>
<li class="done">🎨 Diseño y tu marca <b>✓ Listo</b></li>
<li class="done">${cFence ? "🪵 Cotizador de cercas" : "🛰️ Cotizador por satélite"} <b>✓ Listo</b></li>
<li class="done">🤖 Asistente que contesta tus mensajes <b>✓ Listo</b></li>
<li class="wip">🚀 Últimos detalles y publicación <b>En proceso</b></li>
</ul>
<p class="ft">⚡ Hecho con ALTO Pro</p>
</div></body></html>`);
  }
  res.send(renderSite(await siteDataOf(c, req, { testMode: preview })).replace("</head><body>", "</head><body>" + sBack));
});

/* City landing pages — one per town in "pueblos o condados que cubre".
 * Each is a separate shot at ranking for "techos en <ciudad>". */
app.get("/site/:slug/zona/:city", async (req, res) => {
  const c = await db.getContractorBySlug(String(req.params.slug));
  if (!c) return res.status(404).send("Not found");
  const zPub = c.data?.site?.published === true || (req.query.preview != null && (closerOk(req) || csOk(req)));
  if (c.data?.status === "paused" || c.data?.payStatus === "pending" || !zPub) {
    return res.redirect(`/site/${encodeURIComponent(c.slug)}`);
  }
  const cities = areaCities(c.data?.site?.area);
  const city = cities.find((x) => citySlug(x) === String(req.params.city));
  if (!city) return res.redirect(`/site/${encodeURIComponent(c.slug)}`);
  res.send(renderSite(await siteDataOf(c, req, { pageCity: city, city })));
});

app.get("/site/:slug/sitemap.xml", async (req, res) => {
  const c = await db.getContractorBySlug(String(req.params.slug));
  if (!c || c.data?.site?.published !== true || c.data?.status === "paused") return res.status(404).send("Not found");
  const d = await siteDataOf(c, req);
  const xesc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const urls = [d.canonical, ...areaCities(d.area).map((x) => `${d.canonical}/zona/${citySlug(x)}`)];
  res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${xesc(u)}</loc></url>`).join("\n")}
</urlset>`);
});

app.get("/site/:slug/robots.txt", async (req, res) => {
  const c = await db.getContractorBySlug(String(req.params.slug));
  if (!c) return res.status(404).send("Not found");
  const d = await siteDataOf(c, req);
  res.type("text/plain").send(`User-agent: *\nAllow: /\nSitemap: ${d.canonical}/sitemap.xml\n`);
});
// call so the client picks their look). ?embed=1 hides the demo chrome.
app.get("/plantilla/:n", (req, res) => {
  const n = ["1", "2", "3"].includes(req.params.n) ? req.params.n : "1";
  const embed = req.query.embed != null;
  // each template previews in its own signature color so the personalities
  // read instantly; every template repaints to the client's brand color
  const SIG = { 1: "#B30F24", 2: "#E8540C", 3: "#1B6FB8" };
  res.send(renderSite({
    slug: "alto-demo",
    biz: "Tu Negocio",
    phone: "9565550100",
    logo: null,
    template: n,
    color: req.query.color && /^#?[a-f0-9]{6}$/i.test(req.query.color) ? (req.query.color.startsWith("#") ? req.query.color : "#" + req.query.color) : SIG[n],
    city: "Tu Ciudad, TX",
    years: 15,
    license: "00000",
    about: "Empezamos hace 15 años con una troca y muchas ganas. Hoy somos un equipo que ha hecho cientos de techos en la región — y seguimos tratando cada casa como si fuera la nuestra.",
    // demo content so the prospect sees the FULL site: zones, guarantee,
    // reviews, FAQ — everything their own page will carry
    area: "Tu Ciudad, Pueblo Nuevo, Villa Verde, El Campo",
    warranty: "10 años por escrito en mano de obra",
    diff: "Somos familia local — el mismo dueño supervisa cada trabajo, del primer clavo al último.",
    facebook: "https://facebook.com",
    instagram: "https://instagram.com",
    opinaHref: "/opina/alto-demo",
    photos: [
      "/api/roofimg?lat=26.3827418&lng=-98.8196915&zoom=20",
      "/api/roofimg?lat=26.3795779&lng=-98.8186812&zoom=20",
      "/api/roofimg?lat=26.3807212&lng=-98.8148616&zoom=20",
    ],
    zonaLinks: false,
    reviews: [
      { s: 5, n: "María G.", t: "Llegaron a la hora que dijeron, terminaron en dos días y dejaron todo limpio. El precio fue el que me dieron desde el principio." },
      { s: 5, n: "José R.", t: "Me ayudaron con el reclamo de la aseguranza después del granizo. Techo nuevo y casi no pagué de mi bolsa." },
      { s: 5, n: "Ana T.", t: "Muy profesionales y hablan los dos idiomas. Me explicaron todo antes de empezar y cumplieron con la garantía por escrito." },
    ],
  }, embed ? {} : { ribbon: `OPCIÓN ${n} — imagina TU logo y TU nombre aquí.`, backAlto: true }));
});

/* ── Template chooser (/plantillas) — shown on the onboarding call ── */
app.get("/plantillas", (req, res) => {
  const T = [
    ["1", "Opción 1", "Elegante y premium — la opción cara.", "#B30F24"],
    ["2", "Opción 2", "Energía y músculo — marca joven.", "#E8540C"],
    ["3", "Opción 3", "Suave y de confianza — el vecino honesto.", "#1B6FB8"],
  ];
  res.send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ALTO Pro · Elige tu plantilla</title><link rel="icon" href="/icon-192.png"><style>
*{box-sizing:border-box;font-family:Inter,Arial,sans-serif;margin:0}
body{background:#101B30;color:#fff;padding:34px 20px 60px}
h1{text-align:center;font-size:clamp(24px,4.5vw,36px);font-weight:800}
h1 em{color:#F8B408;font-style:normal}
.sub{text-align:center;color:#9DA8C4;font-weight:600;font-size:14px;margin:10px auto 6px;max-width:520px;line-height:1.6}
.colorbar{display:flex;gap:10px;justify-content:center;align-items:center;margin:18px 0 30px;flex-wrap:wrap}
.colorbar label{font-weight:700;font-size:13px;color:#C9D2E5}
.colorbar input[type=color]{width:46px;height:38px;border:none;border-radius:10px;background:none;cursor:pointer}
.colorbar button{background:#F8B408;color:#101B30;border:none;border-radius:10px;padding:10px 18px;font-weight:800;cursor:pointer}
.grid{display:flex;gap:34px;justify-content:center;flex-wrap:wrap}
.card{text-align:center}
.phone{background:#0B1226;border:9px solid #1E2A45;border-radius:40px;padding:10px;box-shadow:0 26px 70px rgba(0,0,0,.5)}
.scr{width:252px;height:512px;overflow:hidden;border-radius:26px}
.scr iframe{width:390px;height:792px;border:0;transform:scale(.6462);transform-origin:0 0;background:#fff}
.nm{font-weight:800;font-size:17px;margin-top:16px}
.nm span{color:#F8B408}
.ds{color:#9DA8C4;font-weight:600;font-size:13px;margin-top:4px}
.open{display:inline-block;margin-top:12px;background:#fff;color:#101B30;text-decoration:none;font-weight:800;font-size:13px;padding:10px 20px;border-radius:99px}
</style></head><body>
<h1>¿Cuál se siente <em>más tú</em>?</h1>
<p class="sub">Tres diseños probados que generan clientes — los personalizamos con tu logo, tus colores y tus fotos, con el cotizador por satélite adentro. Prueba tu color de marca — las tres se pintan al instante.</p>
<div class="colorbar">
  <label>🎨 Tu color:</label>
  <input type="color" id="col" value="#B30F24">
  <button onclick="paint()">Pintar las 3</button>
  <button onclick="reset()" style="background:#1E2A45;color:#fff">Colores originales</button>
</div>
<div class="grid">
${T.map(([n, nm, ds]) => `
  <div class="card">
    <div class="phone"><div class="scr"><iframe id="f${n}" src="/plantilla/${n}?embed=1" title="${nm}"></iframe></div></div>
    <p class="nm">Opción <span>${n}</span></p>
    <p class="ds">${ds}</p>
    <a class="open" id="o${n}" href="/plantilla/${n}" target="_blank">Abrir completa →</a>
  </div>`).join("")}
</div>
<script>
function paint(){
  var c = document.getElementById('col').value.replace('#','');
  [1,2,3].forEach(function(n){
    document.getElementById('f'+n).src = '/plantilla/'+n+'?embed=1&color='+c;
    document.getElementById('o'+n).href = '/plantilla/'+n+'?color='+c;
  });
}
function reset(){
  [1,2,3].forEach(function(n){
    document.getElementById('f'+n).src = '/plantilla/'+n+'?embed=1';
    document.getElementById('o'+n).href = '/plantilla/'+n;
  });
}
</script>
</body></html>`);
});

/* Contractors don't edit their own website — they ask, and the request
 * lands in the CS queue as a ticket (human or ✨AI resolves it). */
app.post("/api/change-request", async (req, res) => {
  const c = await auth(req);
  if (!c) return res.status(401).json({ error: "no session" });
  if (overQuota(`chreq:${c.id}`, 5)) return res.status(429).json({ error: "quota" });
  const text = String(req.body?.text || "").trim().slice(0, 600);
  if (!text) return res.status(400).json({ error: "text required" });
  // The contractor tags what it's about on the phone — the ticket lands in
  // /cs pre-sorted, with the right suggestion and the right buttons.
  const TITLES = {
    bot: "🤖 Cliente pide cambio del BOT",
    web: "🌐 Cliente pide cambio de su PÁGINA",
    queja: "😕 QUEJA del cliente",
    any: "🙋 Solicitud del cliente",
  };
  const kind = TITLES[String(req.body?.kind || "")] ? String(req.body.kind) : "any";
  const id = await db.addTask({ slug: c.slug, title: TITLES[kind], note: text });
  res.json({ ok: true, id });
});

// The contractor's own ticket history — ONLY tickets they sent from the app
// (kind-prefixed titles), never internal CS tasks about them.
app.get("/api/my-requests", async (req, res) => {
  const c = await auth(req);
  if (!c) return res.status(401).json({ error: "no session" });
  const mine = (await db.listTasks(500))
    .filter((t) => t.slug === c.slug && /^(🤖|🌐 Cliente|😕|🙋)/.test(String(t.title || "")))
    .slice(0, 20)
    .map((t) => ({ id: t.id, note: String(t.note || "").slice(0, 200), status: t.status, at: t.created_at }));
  res.json({ tickets: mine });
});

/* ── Customer-service command center (/cs) ──
 * Tasks + a client directory with one-click edit (the onboarding wizard).
 * Gated by CS_KEY (admin key also works). No money/MRR shown. */
app.post("/api/cs/task", async (req, res) => {
  if (!csOk(req)) return res.status(403).json({ error: "no auth" });
  const title = String(req.body?.title || "").slice(0, 160).trim();
  if (!title) return res.status(400).json({ error: "falta título" });
  const slug = String(req.body?.slug || "").slice(0, 80);
  const note = String(req.body?.note || "").slice(0, 600);
  const id = await db.addTask({ slug, title, note });
  res.json({ ok: true, id });
});
app.post("/api/cs/task/:id", async (req, res) => {
  if (!csOk(req)) return res.status(403).json({ error: "no auth" });
  const id = String(req.params.id);
  if (req.body?.delete) { await db.deleteTask(id); return res.json({ ok: true }); }
  const status = ["open", "doing", "done"].includes(req.body?.status) ? req.body.status : "open";
  await db.setTaskStatus(id, status);
  res.json({ ok: true });
});

// Plain-language names for the only fields the AI is allowed to touch —
// shown to the CS agent so "✨ Arreglar en automático" is never a black box.
const BOTFIX_CAPS = { botFacts: 1600, hero: 160, tagline: 300, about: 1400, warranty: 120, area: 200, city: 80 };
const BOTFIX_LABELS = {
  botFacts: "Lo que el bot del chat puede decir (horarios, dirección, citas)",
  hero: "Título grande de la página",
  tagline: "Frase debajo del título",
  about: "Historia / quiénes somos",
  warranty: "Garantía que se muestra en cotizaciones",
  area: "Zonas que cubre",
  city: "Ciudad principal",
};

/* ✨ Step 1 — PREVIEW: the AI proposes a patch to ONLY the whitelisted site
 * fields (bot facts, hero, tagline, about, warranty, area, city). Nothing is
 * saved and the ticket isn't touched — the agent sees exactly what would
 * change, in plain language, before deciding. Anything outside the
 * whitelist (photos, domain, template, billing) comes back handled=false
 * with why, so a human takes over. */
app.post("/api/cs/aifix", async (req, res) => {
  if (!csOk(req)) return res.status(403).json({ error: "no auth" });
  const id = String(req.body?.id || "");
  const t = (await db.listTasks(500)).find((x) => String(x.id) === id);
  if (!t || !t.slug || !t.note) return res.status(400).json({ error: "la tarea necesita cliente y detalle" });
  if (t.title.startsWith("😕")) return res.json({ ok: true, handled: false, summary: "Es una queja — se arregla hablando con el cliente (WhatsApp o llamada), no editando la página." });
  const c = await db.getContractorBySlug(t.slug);
  if (!c) return res.status(404).json({ error: "cliente no encontrado" });
  if (!aiLive) return res.status(503).json({ error: "IA no configurada en el servidor" });
  const st = c.data?.site || {};
  const cur = { botFacts: st.botFacts || "", hero: st.hero || "", tagline: st.tagline || "", about: st.about || "", warranty: st.warranty || "", area: st.area || "", city: st.city || "" };
  const kindHint = t.title.startsWith("🤖") ? " El cliente marcó que la solicitud es sobre el BOT del chat: casi seguro el cambio va en botFacts (horarios, dirección, citas — todo lo que el bot afirma)."
    : t.title.startsWith("🌐") ? " El cliente marcó que la solicitud es sobre su PÁGINA web: revisa hero, tagline, about, warranty, area, city — y botFacts si también aplica."
    : "";
  try {
    const raw = await aiChat({
      maxTokens: 600,
      system: `Eres el editor del sitio web de una compañía de techos. Te doy la SOLICITUD del cliente y sus campos editables actuales. Responde SOLO con JSON: {"handled": true/false, "summary": "en una frase, en español simple, qué cambiarías y por qué (o por qué debe hacerlo un especialista)", "patch": {…solo los campos que cambias, entre: botFacts, hero, tagline, about, warranty, area, city}}. Reglas: botFacts son los datos que el bot del chat afirma (dirección/oficina, horarios, financiamiento, citas) — si la solicitud es de ese tipo, REESCRIBE botFacts completo conservando lo actual que siga siendo cierto. hero máximo 8 palabras. No inventes datos que el cliente no dio. Si piden algo fuera de esos campos (fotos, dominio, plantilla, precios, facturación, logo), handled=false.${kindHint}`,
      messages: [{ role: "user", content: `SOLICITUD DEL CLIENTE: ${String(t.note).slice(0, 600)}\n\nCAMPOS ACTUALES: ${JSON.stringify(cur)}` }],
    });
    const j = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || "{}");
    const patch = {};
    for (const k of Object.keys(BOTFIX_CAPS)) if (j.patch && typeof j.patch[k] === "string") patch[k] = j.patch[k].slice(0, BOTFIX_CAPS[k]);
    const handled = !!j.handled && Object.keys(patch).length > 0;
    const changes = Object.keys(patch).map((k) => ({ key: k, label: BOTFIX_LABELS[k] || k, before: cur[k] || "(vacío)", after: patch[k] || "(vacío)" }));
    res.json({ ok: true, handled, summary: String(j.summary || "").slice(0, 300), changes, patch });
  } catch (e) {
    console.error("cs aifix preview failed:", e.message);
    res.status(502).json({ error: "la IA no pudo — hazlo manual con ✏️ Editar" });
  }
});

/* ✨ Step 2 — APPLY: the agent reviewed the exact patch from the preview
 * above and approved it. We re-validate it server-side (whitelist + length
 * caps) rather than trusting the client blindly, then save and close the
 * ticket. No second AI call — what you saw is exactly what gets written. */
app.post("/api/cs/aifix/apply", async (req, res) => {
  if (!csOk(req)) return res.status(403).json({ error: "no auth" });
  const id = String(req.body?.id || "");
  const t = (await db.listTasks(500)).find((x) => String(x.id) === id);
  if (!t || !t.slug) return res.status(400).json({ error: "tarea no encontrada" });
  const c = await db.getContractorBySlug(t.slug);
  if (!c) return res.status(404).json({ error: "cliente no encontrado" });
  const patch = {};
  const given = req.body?.patch;
  for (const k of Object.keys(BOTFIX_CAPS)) if (given && typeof given[k] === "string") patch[k] = given[k].slice(0, BOTFIX_CAPS[k]);
  if (!Object.keys(patch).length) return res.status(400).json({ error: "nada que aplicar" });
  await db.patchContractorData(c.id, { site: { ...(c.data?.site || {}), ...patch } });
  await db.setTaskStatus(id, "done");
  res.json({ ok: true });
});

/* 🔔 "Avisarle": tell the contractor their request is done — INSIDE their
 * own app (a real push notification, tapping it opens ALTO Pro), not a
 * WhatsApp text that leaves our product. Falls back to WhatsApp only for
 * contractors who never enabled push (no app installed / notifications off). */
app.post("/api/cs/notify", async (req, res) => {
  if (!csOk(req)) return res.status(403).json({ error: "no auth" });
  const id = String(req.body?.id || "");
  const t = (await db.listTasks(500)).find((x) => String(x.id) === id);
  if (!t || !t.slug) return res.status(400).json({ error: "tarea no encontrada" });
  const c = await db.getContractorBySlug(t.slug);
  if (!c) return res.status(404).json({ error: "cliente no encontrado" });
  const subs0 = await db.kvGet(`push:${c.id}`).catch(() => null); const subs = Array.isArray(subs0) ? subs0 : [];
  if (PUSH_ON && subs.length) {
    await pushToContractor(c, {
      title: "✅ Tu solicitud ya está lista",
      body: String(t.note || "Hicimos el cambio que pediste").slice(0, 140),
      tag: "ticket-" + id,
      url: "/",
    });
    return res.json({ ok: true, pushed: true });
  }
  // No push device on file — hand CS a WhatsApp link as the fallback so the
  // client still hears back, just not through the in-app channel.
  const phone = String(c.data?.profile?.phone || c.phone || "").replace(/\D/g, "").replace(/^1/, "");
  const wa = phone.length === 10 ? `https://wa.me/1${phone}?text=${encodeURIComponent("¡Listo! Ya quedó el cambio que pediste 🙌 Revísalo y me dices.")}` : null;
  res.json({ ok: true, pushed: false, waFallback: wa, error: wa ? undefined : "Sin teléfono ni notificaciones activas para este cliente" });
});

app.get("/cs", async (req, res) => {
  if (!CS_KEY && !ADMIN_KEY) return res.status(503).send("Set CS_KEY or ADMIN_KEY.");
  if (req.query.logout != null) { clearKeyCookie(res, "alto_cs"); return res.redirect("/cs"); }
  const qk = req.query.key;
  if (qk && ((CS_KEY && qk === CS_KEY) || (ADMIN_KEY && qk === ADMIN_KEY))) { setKeyCookie(req, res, "alto_cs", qk); return res.redirect("/cs"); }
  if (qk && overQuota(`keyguess:${clientIp(req)}`, 30)) return res.status(429).send("Demasiados intentos. Intenta más tarde.");
  if (!csOk(req)) return res.status(qk ? 403 : 401).send(loginPage("Servicio al cliente", "/cs", !!qk));
  const ck = reqCookies(req);
  const K = encodeURIComponent(String(ck.alto_cs || ck.alto_admin || qk || ""));
  const esc = (x) => String(x || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const [list, stats, tasks, devCounts] = await Promise.all([
    db.listContractors(), db.leadStats().catch(() => []), db.listTasks().catch(() => []), db.sessionCounts().catch(() => ({})),
  ]);
  const BUILTIN = new Set(["alto-demo", "alto-ventas", "alto-cercas"]);
  const clients = list.filter((c) => !BUILTIN.has(c.slug));
  const statOf = (id) => stats.find((x) => String(x.contractor_id) === String(id)) || { total: 0, last7: 0 };
  const nameOf = (slug) => (clients.find((c) => c.slug === slug)?.name) || slug || "general";
  const openCount = tasks.filter((t) => t.status !== "done").length;
  const leads7 = stats.reduce((a, x) => a + Number(x.last7 || 0), 0);
  const stLabel = { open: "nueva", doing: "en proceso", done: "hecha" };
  const waOf = (ph) => { const d = String(ph || "").replace(/\D/g, "").replace(/^1/, ""); return d.length === 10 ? `https://wa.me/1${d}` : null; };
  const phoneOf = (c) => c.data?.profile?.phone || c.phone || "";
  const ago = (x) => { if (!x) return "nunca"; const h = (Date.now() - new Date(x).getTime()) / 36e5; return h < 1 ? "hace minutos" : h < 24 ? `hace ${Math.round(h)}h` : `hace ${Math.round(h / 24)}d`; };
  // Auto worklist: the rep just works this top to bottom — no judgment needed.
  const attention = [];
  for (const c of clients) {
    const s = c.data?.site || {}, d = c.data || {};
    const dev = devCounts[String(c.id)] || 0;
    if (d.status === "paused" || d.payStatus === "canceled") attention.push({ slug: c.slug, name: c.name, tag: "pausada", icon: "⏸", msg: "Cuenta pausada — confirma si quiere reactivar", act: "site", c });
    else if (d.payStatus === "failed") attention.push({ slug: c.slug, name: c.name, tag: "pago falló", icon: "💳", msg: "Falló su pago — recuérdale actualizar su tarjeta", act: "site", c });
    else if (d.payStatus === "pending") attention.push({ slug: c.slug, name: c.name, tag: "esperando pago", icon: "⏳", msg: "Aún no activa — se activa sola al pagar", act: "site", c });
    else if (!(s.template || s.about)) attention.push({ slug: c.slug, name: c.name, tag: "falta onboarding", icon: "🆕", msg: "Cliente nuevo sin página — haz su onboarding", act: "edit", c });
    else if (!s.published) attention.push({ slug: c.slug, name: c.name, tag: "sin publicar", icon: "🏗️", msg: "Su página está lista pero no publicada — revísala y publícala", act: "edit", c });
    if (dev > 5) attention.push({ slug: c.slug, name: c.name, tag: "link compartido", icon: "📱", msg: `${dev} dispositivos — ofrécele cuentas para su equipo o usa 🔄 Revocar accesos`, act: "site", c });
  }
  // Quick-edit: the raw data behind every client's onboarding, embedded so the
  // rep can edit ANY field in one place. Saving posts to /api/onboarding/save,
  // which merges and keeps logo/photos/publish state untouched.
  const qeData = {};
  for (const c of clients) {
    const s = c.data?.site || {}, p = c.data?.profile || {};
    qeData[c.slug] = {
      name: c.name, biz: p.biz || "", phone: p.phone || c.phone || "", license: p.license || "",
      template: s.template || "1", color: s.color || "#B30F24", city: s.city || "", area: s.area || "",
      years: s.years || "", services: (Array.isArray(s.services) ? s.services : []).join(", "),
      warranty: s.warranty || "", diff: s.diff || "", tagline: s.tagline || "", hero: s.hero || "",
      about: s.about || "", gmb: s.gmb || "", facebook: s.facebook || "", instagram: s.instagram || "",
      published: !!s.published,
    };
  }
  // Bot trainer data: structured botTrain when it exists; else migrate what's
  // already known (botAddr/botHours, or a hand-written botFacts into "extra").
  const btData = {};
  for (const c of clients) {
    const s = c.data?.site || {};
    const bt = s.botTrain || null;
    btData[c.slug] = {
      addr: bt ? bt.addr || "" : (s.botAddr || ""),
      hours: bt ? bt.hours || "" : (s.botHours || ""),
      financing: bt?.financing || "", payments: bt?.payments || "", insurance: bt?.insurance || "",
      emergency: bt?.emergency || "", languages: bt?.languages || "", promos: bt?.promos || "",
      extra: bt ? bt.extra || "" : ((s.botFacts && !(s.botAddr || s.botHours)) ? s.botFacts : ""),
      faqs: Array.isArray(bt?.faqs) ? bt.faqs : [],
    };
  }
  // Tasks: pending is the morning worklist; done is history, tucked away.
  const pendTasks = tasks.filter((t) => t.status !== "done");
  const doneTasks = tasks.filter((t) => t.status === "done");
  const taskRow = (t, badge) => {
    // Client-request tickets arrive pre-tagged from the app; each kind gets
    // its own one-line playbook and only the buttons that make sense.
    const kind = t.title.startsWith("🤖") ? "bot" : t.title.startsWith("🌐 Cliente") ? "web" : t.title.startsWith("😕") ? "queja" : t.title.startsWith("🙋") ? "any" : "";
    const cli = kind && t.slug ? clients.find((x) => x.slug === t.slug) : null;
    const cwa = cli ? waOf(phoneOf(cli)) : "";
    const hint = kind === "bot" ? "💡 Toca ✨ para VER qué cambiaría antes de aplicarlo. Luego pruébalo tú mismo en su chat, y avísale con 🔔."
      : kind === "web" ? "💡 Textos, horarios o datos → toca ✨ y revisa el cambio antes de aplicarlo. Fotos, plantilla o dominio → ✏️ Onboarding."
      : kind === "queja" ? "💡 Una queja se arregla hablando — mándale WhatsApp o llámalo hoy. Nada de botones."
      : kind === "any" ? "💡 Léelo: si es del bot o de la página, toca ✨ y revisa antes de aplicar. Si es otra cosa, hazlo con ⚡ Editar datos u ✏️ Onboarding."
      : "";
    return `<details class="task ${t.status}">
    <summary class="attsum">
      <span class="an${t.status === "done" ? " dn" : ""}">${badge}</span>
      <div class="am"><b>${esc(t.title)}</b><span class="x">${t.slug ? esc(nameOf(t.slug)) : "general"}${t.note ? ` — ${esc(String(t.note).slice(0, 90))}${String(t.note).length > 90 ? "…" : ""}` : ""}</span></div>
      <span class="tstat ${t.status}">${stLabel[t.status] || t.status}</span>
      ${t.status !== "done"
        ? `<button class="tbtn go" onclick="event.preventDefault();tStat('${t.id}','done')">✓ Hecho</button>`
        : `<button class="tbtn" onclick="event.preventDefault();tStat('${t.id}','open')">↩ Reabrir</button>`}
      <span class="achev">▾</span>
    </summary>
    <div class="abody">
      ${t.note ? `<div class="asec"><b>Lo que pidió</b><p class="qnote">${esc(t.note)}</p></div>` : ""}
      ${hint && t.status !== "done" ? `<p class="qhint">${hint}</p>` : ""}
      <div class="aacts">
        ${t.status !== "done" && t.slug && t.note && kind !== "queja" ? `<button class="tbtn" style="border-color:#F8B408" onclick="aiFix('${t.id}',this)">${kind ? "✨ Ver arreglo automático" : "✨ IA"}</button>` : ""}
        ${t.slug ? `<button class="tbtn" onclick="qeOpen('${esc(t.slug)}')">⚡ Editar datos</button>` : ""}
        ${t.slug && (kind === "bot" || kind === "any" || !kind) ? `<button class="tbtn" onclick="btOpen('${esc(t.slug)}')">🤖 Entrenar bot</button>` : ""}
        ${kind && kind !== "queja" && t.slug ? `<a class="tbtn" href="/site/${esc(t.slug)}?preview=1&chat=open" target="_blank">💬 Probar su chat</a>` : ""}
        ${cwa && t.status !== "done" ? `<a class="wa" href="${cwa}" target="_blank" style="padding:6px 12px;border-radius:9px;font-size:12.5px">💬 WhatsApp</a>` : ""}
        ${kind && kind !== "queja" && t.slug ? `<button class="tbtn" onclick="notifyClient('${t.id}','${esc(t.slug)}',this)">🔔 Avisarle</button>` : ""}
        ${t.status === "open" && !kind ? `<button class="tbtn" onclick="tStat('${t.id}','doing')">▶ Empezar</button>` : ""}
        ${t.slug ? `<a class="tbtn" href="/onboarding?slug=${esc(t.slug)}${kind === "bot" ? "&step=5&field=botaddr" : kind === "web" ? "&step=3&field=hero" : ""}">✏️ Onboarding</a><a class="tbtn" href="/site/${esc(t.slug)}" target="_blank">🌐 Página</a>` : ""}
        <button class="tbtn del" onclick="tDel('${t.id}')">🗑 Borrar</button>
      </div>
      <div class="tpreview" id="pv-${t.id}" style="display:none"></div>
    </div>
  </details>`;
  };
  res.send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ALTO Pro · Servicio</title><link rel="icon" href="/icon-192.png"><style>
*{box-sizing:border-box;margin:0;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
body{background:#F5F6F8;color:#0B1220;letter-spacing:-0.011em}
::selection{background:rgba(248,180,8,.35)}
.appheader{position:sticky;top:0;z-index:30;background:rgba(16,27,48,.9);backdrop-filter:saturate(180%) blur(20px);-webkit-backdrop-filter:saturate(180%) blur(20px);color:#fff;padding:15px 24px;display:flex;align-items:center;gap:13px;border-bottom:1px solid rgba(255,255,255,.07)}
.appheader img{height:30px;background:#fff;border-radius:9px;padding:4px 6px}
.appheader b{font-size:16px;font-weight:700;letter-spacing:-0.02em}.appheader b em{color:#F8B408;font-style:normal}
.appheader .right{margin-left:auto;display:flex;gap:8px}.appheader .right a{color:#cdd5e5;text-decoration:none;font-weight:600;font-size:13px;border-radius:99px;padding:7px 14px}
.wrap{max-width:1120px;margin:0 auto;padding:24px 22px 64px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-bottom:18px}
.card{background:#fff;border:1px solid rgba(16,27,48,.05);border-radius:18px;padding:18px 20px;box-shadow:0 1px 2px rgba(16,27,48,.04),0 8px 22px rgba(16,27,48,.045)}
.card .v{font-size:28px;font-weight:700;letter-spacing:-0.035em}.card .l{font-size:11px;font-weight:700;color:#9097A3;letter-spacing:.5px;text-transform:uppercase;margin-top:6px}
.card.gold{background:linear-gradient(155deg,#16243f,#0d1729);border:none}.card.gold .v{color:#F8B408}.card.gold .l{color:#9DA8C4}
.panel{background:#fff;border:1px solid rgba(16,27,48,.05);border-radius:20px;padding:22px 24px;margin-bottom:18px;box-shadow:0 1px 2px rgba(16,27,48,.04),0 10px 26px rgba(16,27,48,.05)}
.panel h2{font-size:15px;font-weight:700;margin-bottom:14px}
.tform{display:grid;gap:8px;grid-template-columns:1fr;margin-bottom:16px}
@media(min-width:760px){.tform{grid-template-columns:200px 1fr auto}}
.tform select,.tform input{font-family:inherit;padding:11px 13px;border-radius:11px;border:1px solid #E4E7EC;font-size:14px;font-weight:500;outline:none;background:#fff}
.tform select:focus,.tform input:focus{border-color:#F8B408;box-shadow:0 0 0 3px rgba(248,180,8,.18)}
.tform button{background:#F8B408;color:#101B30;border:none;border-radius:11px;padding:11px 20px;font-weight:800;cursor:pointer;white-space:nowrap}
.task{border-bottom:1px solid #F2F4F7}
.task:last-of-type{border-bottom:none}
.task.done .am b{text-decoration:line-through;color:#9097A3}
.task.done{opacity:.75}
.an.dn{background:#E7F7ED;color:#10803C}
.qnote{font-size:13px;font-weight:600;color:#3A4250;background:#fff;border:1px solid #E7EAF0;border-radius:10px;padding:9px 12px;line-height:1.6;margin:0}
.qhint{color:#9A6E00;background:#FFF8E1;border-radius:10px;padding:8px 11px;font-size:12.5px;font-weight:600;margin:10px 0 0;line-height:1.6}
.qe .qegrid{display:grid;gap:12px;grid-template-columns:1fr}
@media(min-width:820px){.qe .qegrid{grid-template-columns:1fr 1fr}}
.qe label{display:block}
.qe .qel{display:block;font-size:11px;color:#8A94A8;text-transform:uppercase;letter-spacing:.5px;font-weight:800;margin-bottom:5px}
.qe input,.qe textarea,.qe select{width:100%;font-family:inherit;padding:10px 12px;border-radius:10px;border:1px solid #E4E7EC;font-size:13.5px;font-weight:600;color:#16202E;outline:none;background:#fff}
.qe input:focus,.qe textarea:focus{border-color:#F8B408;box-shadow:0 0 0 3px rgba(248,180,8,.16)}
.qe textarea{resize:vertical}
.qe .full{grid-column:1/-1}
.qemsg{font-size:13px;font-weight:700;color:#10803C}
.btfaq{display:grid;grid-template-columns:1fr 1.4fr auto;gap:8px;margin:0 0 8px}
@media(max-width:700px){.btfaq{grid-template-columns:1fr;border-bottom:1px dashed #E4E7EC;padding-bottom:10px}}
.tdone{margin-top:14px;border-top:1px solid #F2F4F7}
.tdsum{cursor:pointer;list-style:none;display:flex;align-items:center;gap:8px;padding:12px 4px;color:#8A94A8;font-weight:700;font-size:13px}
.tdsum::-webkit-details-marker{display:none}
.tdsum:hover{color:#5A6478}
.tdone[open] .tdsum .achev{transform:rotate(180deg)}
.tstat{border-radius:99px;padding:3px 10px;font-size:11px;font-weight:800;white-space:nowrap}
.tstat.open{background:#FEF3D6;color:#946400}.tstat.doing{background:#E5EFFE;color:#21438A}.tstat.done{background:#E7F7ED;color:#10803C}
.tbtn{border:1px solid #E4E7EC;background:#fff;border-radius:9px;padding:6px 11px;font-weight:700;font-size:12px;cursor:pointer;text-decoration:none;color:#101B30}
.tbtn.go{background:#101B30;color:#fff;border:none}.tbtn.del{color:#C5221F;border-color:#F3B4B0}
.tpreview{width:100%;order:99}
.pvbox{background:#FFFBEF;border:1.5px solid #F8B408;border-radius:14px;padding:14px 16px;margin-top:8px}
.pvbox.pvno{background:#F4F6FA;border-color:#E4E7EC}
.pvsum{font-weight:700;font-size:13.5px;color:#101B30;margin-bottom:10px;line-height:1.5}
.pvrow{border-top:1px solid #F0E4B8;padding:9px 0}
.pvrow:first-of-type{border-top:none}
.pvrow b{display:block;font-size:12.5px;color:#8A6D00;margin-bottom:4px}
.pvold{font-size:12.5px;color:#9097A3;text-decoration:line-through;margin-bottom:2px;word-break:break-word}
.pvnew{font-size:13px;color:#101B30;font-weight:600;word-break:break-word}
.pvbtns{display:flex;gap:8px;margin-top:12px}
.pvbtns .tbtn{font-size:13px;padding:8px 16px}
.search{width:100%;font-family:inherit;padding:11px 14px;border-radius:11px;border:1px solid #E4E7EC;font-size:14px;font-weight:500;outline:none;margin-bottom:12px}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;color:#9097A3;font-size:10.5px;letter-spacing:.6px;text-transform:uppercase;font-weight:700;padding:9px 8px;border-bottom:1px solid #EEF0F4}
td{padding:11px 8px;border-bottom:1px solid #F2F4F7;font-weight:600;vertical-align:middle}
td a{color:#B07A00;font-weight:700;text-decoration:none}
.edit{background:#F8B408;color:#101B30 !important;border-radius:9px;padding:6px 12px;font-weight:800;font-size:12.5px}
.empty{color:#9097A3;font-weight:600;padding:14px 0}
.card.cardred .v{color:#C5221F}
.att{border-bottom:1px solid #F2F4F7}
.att:last-child{border-bottom:none}
.attsum{display:flex;gap:11px;align-items:center;padding:13px 4px;cursor:pointer;list-style:none;flex-wrap:wrap}
.attsum::-webkit-details-marker{display:none}
.attsum:hover{background:#FBFBFD}
.an{width:24px;height:24px;border-radius:8px;background:#101B30;color:#fff;font-weight:800;font-size:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.achev{color:#9097A3;font-size:12px;flex-shrink:0;transition:transform .15s}
.att[open] .achev{transform:rotate(180deg)}
.abody{background:#F7F9FC;border:1px solid #EDF0F5;border-radius:16px;padding:16px 18px 18px;margin:2px 4px 16px 39px}
.agrid{display:grid;gap:16px}
@media(min-width:920px){.agrid{grid-template-columns:1fr 1.25fr}}
.asec>b{display:block;font-size:11px;color:#8A94A8;text-transform:uppercase;letter-spacing:.6px;font-weight:800;margin-bottom:8px}
.asec ol{margin:0 0 0 18px;color:#3A4250;font-size:13px;font-weight:500;line-height:1.75}
.ckbar{display:inline-block;width:84px;height:5px;background:#E9EDF3;border-radius:99px;margin-left:8px;vertical-align:2px}
.ckbar i{display:block;height:100%;background:#F8B408;border-radius:99px}
.ck{display:flex;flex-wrap:wrap;gap:7px}
.ck span{font-size:12px;font-weight:700;border-radius:99px;padding:5px 11px;white-space:nowrap}
.ck .y{background:#E7F7ED;color:#10803C}
.ck .n{background:#fff;border:1px solid #EAD3D2;color:#A04441}
.ck .o{background:transparent;border:1px dashed #D5DAE3;color:#9097A3}
.ck .i{background:#fff;border:1px solid #E7EAF0;color:#3A4250}
.asec+.asec,.agrid+.asec{margin-top:15px}
.aacts{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px;padding-top:14px;border-top:1px solid #EDF0F5}
.aacts .tbtn{background:#fff}
.aacts .tbtn.go{background:#101B30}
@media(max-width:600px){.abody{margin-left:4px}}
.att .ai{font-size:20px;flex-shrink:0}
.am{flex:1;min-width:190px}
.am b{font-size:14px}.am .x{display:block;color:#67718A;font-size:12.5px;font-weight:500;margin-top:1px}
.att .atag{border-radius:99px;padding:3px 10px;font-size:11px;font-weight:800;background:#FDECEC;color:#C5221F;white-space:nowrap}
.qchips{display:flex;gap:7px;flex-wrap:wrap;margin:0 0 12px}
.qchip{border:1px dashed #C9CDD6;background:#FBFBFD;border-radius:99px;padding:7px 13px;font-size:12.5px;font-weight:700;color:#475067;cursor:pointer}
.qchip:hover{border-color:#F8B408;background:#FFFBEF}
.wa{background:#25D366;color:#fff !important;border-radius:8px;padding:5px 11px;font-weight:800;font-size:12px;text-decoration:none;white-space:nowrap}
.slug2{color:#9097A3;font-size:11.5px}
.guide details{border:1px solid #EEF0F4;border-radius:12px;margin:8px 0;background:#FBFBFD}
.guide summary{cursor:pointer;padding:12px 14px;font-weight:700;font-size:13.5px;list-style:none}
.guide summary::-webkit-details-marker{display:none}
.guide summary::before{content:"▸ ";color:#D99E00}
.guide details[open] summary::before{content:"▾ "}
.guide .gb{padding:0 14px 13px;color:#475067;font-size:12.5px;font-weight:500;line-height:1.7}
.guide .gb ol{margin:6px 0 0 18px}.guide .gb li{margin:3px 0}
/* Collapsible panels — closed by default so nothing sits in the way. */
summary.psum{cursor:pointer;list-style:none;display:flex;align-items:center;gap:8px;margin:0}
summary.psum::-webkit-details-marker{display:none}
summary.psum::after{content:"▾";margin-left:auto;color:#9097A3;font-size:13px;transition:transform .15s}
details[open]>summary.psum::after{transform:rotate(180deg)}
.pbody{margin-top:16px}
.guide summary.psum::before,.guide details[open] summary.psum::before{content:none}
</style></head><body>
<div class="appheader">
  <img src="/brand-logo.png" alt=""><b>ALTO <em>PRO</em> · Servicio al cliente</b>
  <div class="right"><a href="/cs?logout">salir</a></div>
</div>
<div class="wrap">
<div class="cards">
  <div class="card ${attention.length ? "cardred" : ""}"><div class="v">${attention.length}</div><div class="l">Necesita atención</div></div>
  <div class="card gold"><div class="v">${openCount}</div><div class="l">Tareas pendientes</div></div>
  <div class="card"><div class="v">${clients.length}</div><div class="l">Clientes</div></div>
  <div class="card"><div class="v">${leads7}</div><div class="l">Leads · 7 días</div></div>
</div>

${attention.length ? `<div class="panel"><details open><summary class="psum"><h2 style="margin:0">🚨 Necesita atención (${attention.length}) <span style="color:#9097A3;font-weight:600;font-size:13px">— trabaja de arriba a abajo; toca una para ver TODO lo del cliente</span></h2></summary>
  <div class="pbody">
  ${attention.map((a, ai) => {
    const wa = waOf(phoneOf(a.c));
    const editUrl = `/onboarding?slug=${esc(a.slug)}`;
    const s = a.c.data?.site || {}, d = a.c.data || {};
    const devN = devCounts[String(a.c.id)] || 0;
    const nPhotos = Array.isArray(s.photos) ? s.photos.length : 0;
    const nServ = Array.isArray(s.services) ? s.services.length : 0;
    // The FULL state of the client, not just what's broken — ✓ done,
    // ✗ missing (blocks a good page), ○ optional. CS fixes any ✗ via onboarding.
    const check = [
      ["Logo", !!d.profile?.logo],
      ["Teléfono", !!phoneOf(a.c)],
      ["Ciudad / área", !!(s.city || s.area)],
      ["Plantilla elegida", !!s.template],
      ["Textos (titular e historia)", !!(s.hero && s.about)],
      [`Fotos de trabajos (${nPhotos}/8)`, nPhotos > 0],
      [`Servicios (${nServ})`, nServ > 0],
      ["Link de reseñas (Google)", !!s.gmb],
      ["Datos del bot (dirección/horarios)", !!(s.botFacts || s.botAddr || s.botHours)],
      ["Página publicada", !!s.published],
      ["Facebook", !!s.facebook, true],
      ["Instagram", !!s.instagram, true],
      ["Dominio propio", !!s.domain, true],
    ];
    const okCount = check.filter((x) => x[1]).length;
    const STEPS = {
      "pausada": ["Confírmale por WhatsApp si quiere seguir con el servicio.", "Si quiere volver: pídele al admin que la reactive en /admin.", "Si canceló de plano: no borres nada — sus datos quedan guardados por si regresa."],
      "pago falló": ["Avísale por WhatsApp: su tarjeta no pasó.", "Que actualice su tarjeta con el mismo link de pago de su plan (te lo pasa el closer o el admin).", "En cuanto pague, su cuenta se reactiva sola — no hay que tocar nada."],
      "esperando pago": ["Todavía no paga — su cuenta se activa sola al pagar; no hay nada técnico que hacer.", "¿Dice que ya pagó por Zelle o efectivo? El admin la marca como pagada en /admin y listo.", "Si no responde en 2 días, mándale un recordatorio amable por WhatsApp."],
      "falta onboarding": ["Llama al cliente y abre el onboarding (botón abajo) — se llena junto con él en ~20 min.", "El checklist de abajo te dice exactamente qué le falta.", "Al terminar, revisa el borrador y publica desde el mismo onboarding."],
      "sin publicar": ["Abre el borrador (botón abajo) y revisa que todo se vea bien.", "Lo que falte, corrígelo en el onboarding — guíate con el checklist de abajo.", "Cuando esté lista, publícala desde el onboarding."],
      "link compartido": ["Su equipo entra con el mismo link — señal de que la app les gusta 💪.", "Ofrécele cuentas para su equipo (el admin las crea).", "No es urgente: es oportunidad, no problema."],
    };
    return `<details class="att">
    <summary class="attsum">
      <span class="an">${ai + 1}</span>
      <span class="ai">${a.icon}</span>
      <div class="am"><b>${esc(a.name)}</b><span class="x">${a.msg}</span></div>
      <span class="atag">${a.tag}</span>
      <span class="achev">▾</span>
    </summary>
    <div class="abody">
      <div class="agrid">
      <div class="asec"><b>Qué hacer — ${a.tag}</b><ol>${(STEPS[a.tag] || []).map((step) => `<li>${step}</li>`).join("")}</ol></div>
      <div class="asec"><b>Su página — ${okCount}/${check.length} listo<span class="ckbar"><i style="width:${Math.round((okCount / check.length) * 100)}%"></i></span></b>
        <div class="ck">${check.map(([label, ok, opt]) => `<span class="${ok ? "y" : opt ? "o" : "n"}">${ok ? "✓" : opt ? "○" : "✗"} ${label}${!ok && opt ? " · opcional" : ""}</span>`).join("")}</div>
      </div>
      </div>
      <div class="asec"><b>Datos del cliente</b>
        <div class="ck">
          <span class="i">📦 ${esc(PLANS[planOf(a.c)].name)}</span>
          <span class="i">📞 ${esc(phoneOf(a.c)) || "sin teléfono"}</span>
          <span class="i">📱 ${devN} dispositivo${devN === 1 ? "" : "s"}</span>
          <span class="i">🕐 Abrió la app: ${ago(d.lastSeen)}</span>
          <span class="i">📲 Instalada: ${d.installed ? "sí" : "no"}</span>
        </div>
      </div>
      <div class="aacts">
        <a class="tbtn go" href="${editUrl}">✏️ Abrir onboarding</a>
        <a class="tbtn" href="/site/${esc(a.slug)}?preview=1" target="_blank">👁️ Borrador</a>
        <a class="tbtn" href="/site/${esc(a.slug)}" target="_blank">🌐 Página</a>
        <a class="tbtn" href="/w/${esc(a.slug)}" target="_blank">🛰️ Widget</a>
        ${wa ? `<a class="wa" href="${wa}" target="_blank">💬 WhatsApp</a>` : ""}
        <button class="tbtn" onclick="mkTask('${esc(a.slug)}','${esc(a.tag)}: ')">＋ Crear tarea</button>
      </div>
    </div>
  </details>`; }).join("")}
  </div>
</details></div>` : `<div class="panel"><h2>🎉 Todo al día</h2><p class="empty" style="padding:4px 0">Nada necesita atención ahora mismo. Buen trabajo.</p></div>`}

<div class="panel"><details open><summary class="psum"><h2 style="margin:0">✅ Tareas${pendTasks.length ? ` (${pendTasks.length})` : ""} <span style="color:#9097A3;font-weight:600;font-size:13px">— tu trabajo del día</span></h2></summary>
  <div class="pbody">
  <div class="qchips">
    <span class="qchip" onclick="quick('Cambiar teléfono')">📞 Cambiar teléfono</span>
    <span class="qchip" onclick="quick('Subir fotos nuevas')">📷 Subir fotos</span>
    <span class="qchip" onclick="quick('Publicar la página')">🚀 Publicar página</span>
    <span class="qchip" onclick="quick('Conectar su dominio')">🌐 Conectar dominio</span>
    <span class="qchip" onclick="quick('Actualizar precios / info')">💲 Actualizar info</span>
  </div>
  <div class="tform">
    <select id="t_slug"><option value="">— sin cliente —</option>${clients.map((c) => `<option value="${esc(c.slug)}">${esc(c.name)}</option>`).join("")}</select>
    <input id="t_title" placeholder="¿Qué hay que hacer? (ej. cambiar teléfono, subir fotos)">
    <button onclick="addTask()">+ Agregar tarea</button>
  </div>
  ${pendTasks.length ? pendTasks.map((t, i) => taskRow(t, String(i + 1))).join("") : `<p class="empty">🎉 Nada pendiente — todo el trabajo del día está hecho.</p>`}
  ${doneTasks.length ? `<details class="tdone"><summary class="tdsum">📁 Hechas (${doneTasks.length}) — ver historial<span class="achev" style="margin-left:auto">▾</span></summary>
    <div>${doneTasks.map((t) => taskRow(t, "✓")).join("")}</div>
  </details>` : ""}
  </div>
</details></div>

<div class="panel qe"><details id="qepanel"><summary class="psum"><h2 style="margin:0">⚡ Edición rápida <span style="color:#9097A3;font-weight:600;font-size:13px">— cambia cualquier dato de un cliente aquí mismo, sin pasar por el onboarding</span></h2></summary>
  <div class="pbody">
  <select id="qe_slug" onchange="qeShow()" style="max-width:340px;margin-bottom:4px"><option value="">— elige un cliente —</option>${clients.map((c) => `<option value="${esc(c.slug)}">${esc(c.name)}</option>`).join("")}</select>
  <div id="qe_form" style="display:none">
    <div class="qegrid" style="margin-top:12px">
      <label><span class="qel">Nombre del negocio</span><input id="qe_biz"></label>
      <label><span class="qel">Teléfono</span><input id="qe_phone" inputmode="numeric"></label>
      <label><span class="qel">Ciudad</span><input id="qe_city"></label>
      <label><span class="qel">Área que cubre</span><input id="qe_area"></label>
      <label><span class="qel">Años de experiencia</span><input id="qe_years" inputmode="numeric"></label>
      <label><span class="qel">Licencia / registro</span><input id="qe_license"></label>
      <label><span class="qel">Plantilla</span><select id="qe_template"><option value="1">1 · Elegante</option><option value="2">2 · Con energía</option><option value="3">3 · De confianza</option></select></label>
      <label><span class="qel">Color de la marca</span><input id="qe_color" placeholder="#B30F24"></label>
      <label class="full"><span class="qel">Servicios (separados por coma)</span><input id="qe_services" placeholder="Techos nuevos, Reparaciones, Inspecciones"></label>
      <label><span class="qel">Titular de la página (hero)</span><input id="qe_hero"></label>
      <label><span class="qel">Frase de apoyo (tagline)</span><input id="qe_tagline"></label>
      <label class="full"><span class="qel">Su historia (about)</span><textarea id="qe_about" rows="3"></textarea></label>
      <label class="full"><span class="qel">Qué los hace diferentes</span><textarea id="qe_diff" rows="2"></textarea></label>
      <label><span class="qel">Garantía</span><input id="qe_warranty"></label>
      <label><span class="qel">Link de reseñas (Google)</span><input id="qe_gmb" placeholder="g.page/r/…"></label>
      <label><span class="qel">Facebook</span><input id="qe_facebook" placeholder="facebook.com/… o @usuario"></label>
      <label><span class="qel">Instagram</span><input id="qe_instagram" placeholder="instagram.com/… o @usuario"></label>
    </div>
    <p style="color:#9AA3B2;font-size:12px;font-weight:600;margin:12px 0 0">📷 Logo y fotos se cambian en el onboarding (suben archivos). 🤖 Lo que el bot dice (dirección, horarios, FAQs) se entrena en su propia área abajo. Todo lo demás se guarda desde aquí — y si su página ya está publicada, el cambio sale al instante.</p>
    <div class="aacts" style="border-top:none;padding-top:0">
      <button class="tbtn go" id="qe_save" onclick="qeSave(this)">💾 Guardar cambios</button>
      <button class="tbtn" onclick="btOpen(document.getElementById('qe_slug').value)">🤖 Entrenar su bot</button>
      <a class="tbtn" id="qe_prev" href="#" target="_blank">👁️ Ver borrador</a>
      <a class="tbtn" id="qe_live" href="#" target="_blank">🌐 Ver página</a>
      <span class="qemsg" id="qe_msg"></span>
    </div>
  </div>
  </div>
</details></div>

<div class="panel qe"><details id="btpanel"><summary class="psum"><h2 style="margin:0">🤖 Entrenamiento del bot <span style="color:#9097A3;font-weight:600;font-size:13px">— todo lo que el bot puede afirmar; lo que no esté aquí, dice que se confirma por teléfono</span></h2></summary>
  <div class="pbody">
  <select id="bt_slug" onchange="btShow()" style="max-width:340px;margin-bottom:4px"><option value="">— elige un cliente —</option>${clients.map((c) => `<option value="${esc(c.slug)}">${esc(c.name)}</option>`).join("")}</select>
  <div id="bt_form" style="display:none">
    <div class="asec" style="margin-top:14px"><b>Qué sabe — <span id="bt_count"></span><span class="ckbar"><i id="bt_bar"></i></span></b><div class="ck" id="bt_sum"></div></div>
    <div class="qegrid" style="margin-top:14px">
      <label><span class="qel">📍 Dirección / oficina</span><input id="bt_addr" placeholder='ej. "123 Main St, McAllen" o "sin oficina — trabajo a domicilio"'></label>
      <label><span class="qel">🕐 Horarios</span><input id="bt_hours" placeholder="ej. Lun–Vie 8am–5pm, sábados hasta mediodía, no domingos"></label>
      <label><span class="qel">💳 Financiamiento</span><input id="bt_financing" placeholder='ej. "Sí, con pagos mensuales" o "No ofrecemos"'></label>
      <label><span class="qel">💵 Formas de pago</span><input id="bt_payments" placeholder="ej. Efectivo, cheque, tarjeta, Zelle"></label>
      <label><span class="qel">🛡️ Aseguranza / reclamos de seguro</span><input id="bt_insurance" placeholder="ej. Sí trabajamos con reclamos de seguro y granizo"></label>
      <label><span class="qel">🚨 Emergencias / urgencias</span><input id="bt_emergency" placeholder="ej. Atendemos goteras de emergencia el mismo día"></label>
      <label><span class="qel">🗣️ Idiomas</span><input id="bt_languages" placeholder="ej. Español e inglés"></label>
      <label><span class="qel">🎁 Promociones vigentes</span><input id="bt_promos" placeholder="ej. Inspección gratis todo este mes"></label>
      <label class="full"><span class="qel">➕ Otros datos confirmados</span><textarea id="bt_extra" rows="2" placeholder="Cualquier otra verdad que el bot pueda afirmar de este negocio…"></textarea></label>
    </div>
    <div class="asec" style="margin-top:14px"><b>Preguntas frecuentes — respuestas oficiales (máx. 10)</b>
      <div id="bt_faqs"></div>
      <button class="tbtn" type="button" onclick="btAddFaq('','')">＋ Agregar pregunta</button>
    </div>
    <p style="color:#9AA3B2;font-size:12px;font-weight:600;margin:12px 0 0;line-height:1.6">🧠 El bot solo afirma lo que esté aquí — lo demás contesta "se lo confirmamos por teléfono". Nunca da precios (manda al cotizador) ni agenda citas.</p>
    <div class="aacts" style="border-top:none;padding-top:2px">
      <button class="tbtn go" id="bt_save" onclick="btSave(this)">💾 Guardar entrenamiento</button>
      <a class="tbtn" id="bt_chat" href="#" target="_blank">💬 Probar el chat</a>
      <span class="qemsg" id="bt_msg"></span>
    </div>
  </div>
  </div>
</details></div>

<div class="panel"><details><summary class="psum"><h2 style="margin:0">📋 Clientes</h2></summary>
  <div class="pbody">
  <input class="search" id="csearch" placeholder="Buscar cliente…" oninput="filt()">
  <div style="overflow-x:auto"><table id="ctab">
    <tr><th>Negocio</th><th>Leads (7d / total)</th><th>Enlaces</th><th>Editar página</th></tr>
    ${clients.length ? clients.map((c) => {
      const s = statOf(c.id); const wa = waOf(phoneOf(c)); const sd = c.data?.site || {}, dd = c.data || {};
      const pill = dd.status === "paused" ? '<span class="tstat" style="background:#FDECEC;color:#C5221F">pausada</span>'
        : sd.published ? '<span class="tstat done">publicada</span>'
        : (sd.template || sd.about) ? '<span class="tstat open">en construcción</span>'
        : '<span class="tstat" style="background:#F0F2F6;color:#8A94A8">nueva</span>';
      return `<tr data-n="${esc(c.name).toLowerCase()} ${c.slug}">
      <td><b>${esc(c.name)}</b> ${pill}<br><span class="slug2">/${c.slug}</span></td>
      <td>${s.last7} / ${s.total}</td>
      <td><a href="/site/${c.slug}" target="_blank">🌐</a> · <a href="/site/${c.slug}?preview=1&chat=open" target="_blank" title="Probar el chat del bot">🤖</a> · <a href="/w/${c.slug}" target="_blank">🛰️</a>${wa ? ` · <a class="wa" href="${wa}" target="_blank">💬</a>` : ""}</td>
      <td><a class="edit" href="/onboarding?slug=${c.slug}">✏️ Editar</a></td>
    </tr>`; }).join("") : `<tr><td colspan="4" class="empty">Todavía no hay clientes.</td></tr>`}
  </table></div>
  </div>
</details></div>

<div class="panel guide"><details><summary class="psum"><h2 style="margin:0">📘 Guía rápida — cómo hacer cada cosa</h2></summary>
  <div class="pbody">
  <details><summary>El cliente quiere que el BOT diga algo (horarios, dirección, citas)</summary><div class="gb"><ol><li>En la tarea, toca <b>✨ Ver arreglo automático</b> — la IA te MUESTRA qué cambiaría (antes → después), sin guardar nada todavía.</li><li>Lee el cambio. Si tiene sentido, toca <b>✅ Sí, aplicar</b>. Si no, <b>✕ Cancelar</b> y hazlo tú con ✏️ Editar.</li><li>Toca <b>💬 Probar el chat</b> (es el chat REAL de ese cliente, no uno genérico) y pregúntale lo que el cliente pidió — es un chat de prueba, no crea leads falsas.</li><li>Toca <b>🔔 Avisarle</b> — le llega un aviso directo a su celular (push), no un WhatsApp. Marca <b>✓ Hecho</b>.</li></ol></div></details>
  <details><summary>El cliente quiere cambiar su info (teléfono, nombre, color, historia)</summary><div class="gb"><ol><li>En "Clientes" o en la tarea, toca <b>✏️ Editar</b>.</li><li>Cambia lo que pide en los pasos.</li><li>En el último paso toca <b>Enviar / Guardar</b> y luego <b>🚀 Publicar página</b>.</li><li>Marca la tarea <b>✓ Hecho</b>.</li></ol></div></details>
  <details><summary>El cliente quiere subir fotos nuevas</summary><div class="gb"><ol><li>Pídele las fotos por <b>💬 WhatsApp</b>.</li><li><b>✏️ Editar</b> → paso <b>Logo y fotos</b> → súbelas.</li><li>Guarda y <b>Publica</b>. Marca <b>Hecho</b>.</li></ol></div></details>
  <details><summary>La página está "en construcción" / sin publicar</summary><div class="gb"><ol><li><b>✏️ Editar</b> y revisa que esté completa.</li><li>En el último paso toca <b>🚀 Publicar página al cliente</b>.</li></ol></div></details>
  <details><summary>El cliente quiere su propio dominio (ej. sutecho.com)</summary><div class="gb"><ol><li><b>✏️ Editar</b> → paso <b>Su dominio</b> → buscar/conectar.</li><li>Pásale el registro <b>CNAME</b> para que lo ponga en su dominio.</li></ol></div></details>
  <details><summary>Dice que su página "no aparece" en Google</summary><div class="gb">Su página ya está en línea (sitio + cotizador). Salir en Google toma tiempo. Confírmale que su link funciona y que ya puede compartirlo por WhatsApp y redes.</div></details>
  <details><summary>Pago falló / cuenta pausada</summary><div class="gb">Recuérdale por <b>💬 WhatsApp</b> actualizar su tarjeta. Cuando pague, la cuenta se reactiva sola. Si pagó por otro medio, avísale al admin.</div></details>
  <details><summary>Aparece "📱 link compartido"</summary><div class="gb">Su cuenta se está abriendo en muchos teléfonos — su equipo la está compartiendo. Ofrécele por <b>💬 WhatsApp</b> cuentas para su equipo (más venta para nosotros).</div></details>
  </div>
</details></div>
</div>
<script>
function quick(t){var i=document.getElementById('t_title');i.value=t;document.getElementById('t_slug').focus();}
function mkTask(slug,pre){
  var s=document.getElementById('t_slug'),t=document.getElementById('t_title');
  s.value=slug;t.value=pre;
  s.scrollIntoView({behavior:'smooth',block:'center'});
  setTimeout(function(){t.focus()},350);
}
var QE=${JSON.stringify(qeData).replace(/</g, "\\u003c")};
var QE_FIELDS=['biz','phone','city','area','years','license','template','color','services','hero','tagline','about','diff','warranty','gmb','facebook','instagram'];
function qeShow(){
  var slug=document.getElementById('qe_slug').value,f=document.getElementById('qe_form');
  if(!slug||!QE[slug]){f.style.display='none';return;}
  var d=QE[slug];
  QE_FIELDS.forEach(function(k){var el=document.getElementById('qe_'+k);if(el)el.value=d[k]==null?'':d[k];});
  document.getElementById('qe_prev').href='/site/'+slug+'?preview=1';
  document.getElementById('qe_live').href='/site/'+slug;
  document.getElementById('qe_msg').textContent=d.published?'':'(su página aún no está publicada — los cambios se guardan en el borrador)';
  f.style.display='block';
}
function qeOpen(slug){
  var p=document.getElementById('qepanel');p.open=true;
  document.getElementById('qe_slug').value=slug;qeShow();
  p.scrollIntoView({behavior:'smooth',block:'start'});
}
function qeSave(btn){
  var slug=document.getElementById('qe_slug').value;
  if(!slug)return;
  var body={slug:slug};
  QE_FIELDS.forEach(function(k){body[k]=document.getElementById('qe_'+k).value;});
  body.services=body.services.split(',').map(function(x){return x.trim()}).filter(function(x){return x});
  btn.disabled=true;btn.textContent='…guardando';
  fetch('/api/onboarding/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
  .then(function(r){return r.json()}).then(function(j){
    btn.disabled=false;
    if(j.ok){
      btn.textContent='✓ Guardado';
      document.getElementById('qe_msg').textContent=j.published?'✓ Cambios en vivo en su página.':'✓ Guardado en su borrador (página sin publicar).';
      QE_FIELDS.forEach(function(k){QE[slug][k]=document.getElementById('qe_'+k).value;});
      setTimeout(function(){btn.textContent='💾 Guardar cambios'},2000);
    }else{btn.textContent='💾 Guardar cambios';alert('Error: '+(j.error||'no se pudo guardar'));}
  }).catch(function(){btn.disabled=false;btn.textContent='💾 Guardar cambios';alert('Error de red');});
}
var BT=${JSON.stringify(btData).replace(/</g, "\\u003c")};
var BT_FIELDS=['addr','hours','financing','payments','insurance','emergency','languages','promos','extra'];
var BT_CATS=[['addr','Dirección'],['hours','Horarios'],['financing','Financiamiento'],['payments','Pago'],['insurance','Aseguranza'],['emergency','Emergencias'],['languages','Idiomas'],['promos','Promos']];
function btChips(d){
  // Untrained topics are the NORMAL starting state — quiet dashed chips, not
  // red alarms. Green ✓ marks what the bot can already answer.
  var n=0,h='';
  BT_CATS.forEach(function(c){
    var ok=!!(d[c[0]]&&String(d[c[0]]).trim());if(ok)n++;
    h+='<span class="'+(ok?'y':'o')+'" style="cursor:pointer" title="'+(ok?'entrenado — clic para editarlo':'sin entrenar — clic para llenarlo')+'" onclick="btGo(\\''+c[0]+'\\')">'+(ok?'✓ ':'')+c[1]+'</span>';
  });
  var nf=(d.faqs||[]).length;
  h+='<span class="'+(nf?'y':'o')+'">'+(nf?'✓ ':'')+nf+' pregunta'+(nf===1?'':'s')+'</span>';
  document.getElementById('bt_sum').innerHTML=h;
  document.getElementById('bt_count').textContent=n+'/8 temas · '+nf+' preguntas';
  document.getElementById('bt_bar').style.width=Math.round(((n+Math.min(nf,1))/9)*100)+'%';
}
function btGo(k){
  var el=document.getElementById('bt_'+k);
  el.scrollIntoView({behavior:'smooth',block:'center'});
  setTimeout(function(){el.focus()},300);
}
function btAddFaq(q,a){
  var row=document.createElement('div');
  row.className='btfaq';
  row.innerHTML='<input class="fq" placeholder="Pregunta — ej. ¿Cobran por la inspección?"><input class="fa" placeholder="Respuesta oficial — ej. No, la inspección es gratis."><button class="tbtn del" type="button" onclick="this.parentNode.remove()">✕</button>';
  row.querySelector('.fq').value=q||'';
  row.querySelector('.fa').value=a||'';
  document.getElementById('bt_faqs').appendChild(row);
}
function btShow(){
  var slug=document.getElementById('bt_slug').value,f=document.getElementById('bt_form');
  if(!slug||!BT[slug]){f.style.display='none';return;}
  var d=BT[slug];
  BT_FIELDS.forEach(function(k){document.getElementById('bt_'+k).value=d[k]==null?'':d[k];});
  document.getElementById('bt_faqs').innerHTML='';
  (d.faqs||[]).forEach(function(x){btAddFaq(x.q,x.a)});
  document.getElementById('bt_chat').href='/site/'+slug+'?preview=1&chat=open';
  document.getElementById('bt_msg').textContent='';
  btChips(d);
  f.style.display='block';
}
function btOpen(slug){
  var p=document.getElementById('btpanel');p.open=true;
  document.getElementById('bt_slug').value=slug;btShow();
  p.scrollIntoView({behavior:'smooth',block:'start'});
}
function btSave(btn){
  var slug=document.getElementById('bt_slug').value;
  if(!slug)return;
  var train={};
  BT_FIELDS.forEach(function(k){train[k]=document.getElementById('bt_'+k).value;});
  train.faqs=[].map.call(document.querySelectorAll('#bt_faqs .btfaq'),function(r){
    return {q:r.querySelector('.fq').value.trim(),a:r.querySelector('.fa').value.trim()};
  }).filter(function(x){return x.q&&x.a});
  btn.disabled=true;btn.textContent='…guardando';
  fetch('/api/cs/bottrain',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({slug:slug,train:train})})
  .then(function(r){return r.json()}).then(function(j){
    btn.disabled=false;
    if(j.ok){
      btn.textContent='✓ Entrenado';
      document.getElementById('bt_msg').textContent='✓ El bot ya contesta con esto — usa '+j.chars+'/'+j.max+' de su memoria. Pruébalo en el chat →';
      BT[slug]=train;btChips(train);
      setTimeout(function(){btn.textContent='💾 Guardar entrenamiento'},2200);
    }else{btn.textContent='💾 Guardar entrenamiento';alert('Error: '+(j.error||'no se pudo guardar'));}
  }).catch(function(){btn.disabled=false;btn.textContent='💾 Guardar entrenamiento';alert('Error de red');});
}
function addTask(){var s=document.getElementById('t_slug').value,t=document.getElementById('t_title').value.trim();if(!t){document.getElementById('t_title').focus();return;}
  fetch('/api/cs/task',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({slug:s,title:t})}).then(function(r){return r.json()}).then(function(){location.reload()}).catch(function(){alert('Error')});}
function tStat(id,st){fetch('/api/cs/task/'+encodeURIComponent(id)+'',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:st})}).then(function(){location.reload()});}
function tDel(id){if(!confirm('¿Borrar tarea?'))return;fetch('/api/cs/task/'+encodeURIComponent(id)+'',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({delete:true})}).then(function(){location.reload()});}
function hesc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
// Step 1: ask the AI what it WOULD change. Nothing is saved yet — the agent
// sees a plain-language before/after per field and decides.
function aiFix(id,btn){
  var orig=btn.textContent;btn.disabled=true;btn.textContent='✨ pensando…';
  fetch('/api/cs/aifix',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:id})})
  .then(function(r){return r.json()}).then(function(j){
    btn.disabled=false;btn.textContent=orig;
    var box=document.getElementById('pv-'+id);
    if(!box)return;
    if(!j.ok){alert(j.error||'Error');return;}
    if(!j.handled){
      box.innerHTML='<div class="pvbox pvno">🙅 La IA no puede resolver esto sola:<br>'+hesc(j.summary||'pide algo fuera de lo que edita el bot/la página')+'<br><small>Hazlo con ✏️ Editar.</small></div>';
      box.style.display='block';return;
    }
    var rows=(j.changes||[]).map(function(ch){
      return '<div class="pvrow"><b>'+hesc(ch.label)+'</b><div class="pvold">Antes: '+hesc(ch.before)+'</div><div class="pvnew">Después: '+hesc(ch.after)+'</div></div>';
    }).join('');
    box.innerHTML='<div class="pvbox"><p class="pvsum">🧠 '+hesc(j.summary)+'</p>'+rows
      +'<div class="pvbtns"><button class="tbtn go" onclick="aiApply(\\''+id+'\\',this)">✅ Sí, aplicar este cambio</button>'
      +'<button class="tbtn" onclick="pvCancel(\\''+id+'\\')">✕ Cancelar</button></div></div>';
    box.dataset.patch=JSON.stringify(j.patch||{});
    box.style.display='block';
  }).catch(function(){btn.disabled=false;btn.textContent=orig;alert('Error de red — intenta de nuevo');});}
// Step 2: the agent approved exactly what they just read — apply THAT patch,
// no second AI call, so what you saw is what gets written.
function aiApply(id,btn){
  var box=document.getElementById('pv-'+id);
  var patch=JSON.parse(box.dataset.patch||'{}');
  btn.disabled=true;btn.textContent='Aplicando…';
  fetch('/api/cs/aifix/apply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:id,patch:patch})})
  .then(function(r){return r.json()}).then(function(j){
    if(j.ok){location.reload();}else{alert('Error: '+(j.error||''));btn.disabled=false;btn.textContent='✅ Sí, aplicar este cambio';}
  }).catch(function(){alert('Error de red');btn.disabled=false;btn.textContent='✅ Sí, aplicar este cambio';});}
function pvCancel(id){var box=document.getElementById('pv-'+id);box.style.display='none';box.innerHTML='';}
// Avisarle: push straight to the contractor's phone/app. Falls back to
// WhatsApp only if they have no push device registered.
function notifyClient(id,slug,btn){
  var orig=btn.textContent;btn.disabled=true;btn.textContent='🔔 avisando…';
  fetch('/api/cs/notify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:id})})
  .then(function(r){return r.json()}).then(function(j){
    btn.disabled=false;
    if(j.pushed){btn.textContent='🔔 Avisado ✓';return;}
    if(j.waFallback){window.open(j.waFallback,'_blank');btn.textContent='💬 Sin app — WhatsApp abierto';setTimeout(function(){btn.textContent=orig;},3200);}
    else{btn.textContent=orig;alert(j.error||'No se pudo avisar');}
  }).catch(function(){btn.disabled=false;btn.textContent=orig;alert('Error de red');});}
function filt(){var q=document.getElementById('csearch').value.toLowerCase();document.querySelectorAll('#ctab tr[data-n]').forEach(function(r){r.style.display=r.getAttribute('data-n').indexOf(q)>=0?'':'none';});}
</script>
</body></html>`);
});

/* ── Onboarding form (/onboarding) — staff fills the client's data card ──
 * Writes into c.data.site / c.data.profile. Purely additive; the site
 * renderer already reads these fields. Closer or admin key required. */
app.get("/onboarding", async (req, res) => {
  if (!CLOSER_KEY && !ADMIN_KEY) return res.status(503).send("Set CLOSER_KEY or ADMIN_KEY.");
  if (!closerOk(req) && !csOk(req)) return res.status(req.query.key ? 403 : 401).send(loginPage("Onboarding", "/onboarding", !!req.query.key));
  const ck = reqCookies(req);
  const K = encodeURIComponent(String(req.query.key || ck.alto_closer || ck.alto_cs || ck.alto_admin || ""));
  const esc = (x) => String(x || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const slug = String(req.query.slug || "").trim();

  // No client picked → show a picker
  if (!slug) {
    const list = (await db.listContractors()).filter((c) => !["alto-demo", "alto-ventas", "alto-cercas"].includes(c.slug));
    return res.send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ALTO Pro · Onboarding</title><link rel="icon" href="/icon-192.png"><style>
*{box-sizing:border-box;font-family:Inter,Arial,sans-serif;margin:0}body{background:#F4F6FA;color:#101B30}
header{background:#101B30;color:#fff;padding:14px 22px;display:flex;align-items:center;gap:12px}
header img{height:32px;background:#fff;border-radius:8px;padding:4px 6px}header b em{color:#F8B408;font-style:normal}
.wrap{max-width:640px;margin:0 auto;padding:24px}
h1{font-size:20px;margin-bottom:6px}.sub{color:#67718A;font-size:14px;font-weight:600;margin-bottom:18px}
.row{display:flex;align-items:center;justify-content:space-between;background:#fff;border:1px solid #E8ECF3;border-radius:14px;padding:14px 16px;margin-bottom:10px}
.row b{font-size:15px}.row small{color:#9AA0AC;display:block;font-weight:600}
.row a{background:#F8B408;color:#101B30;text-decoration:none;font-weight:800;border-radius:10px;padding:9px 16px;font-size:13px}
.empty{color:#8A94A8;font-weight:600;text-align:center;padding:30px}
</style></head><body>
<header><img src="/brand-logo.png" alt=""><b>ALTO <em>PRO</em> · Onboarding</b></header>
<div class="wrap">
<h1>¿Para qué cliente es la página?</h1>
<p class="sub">Elige el cliente que ya creaste. Si no aparece, créalo primero en el portal del closer.</p>
${list.length ? list.map((c) => `<div class="row"><span><b>${esc(c.name)}</b><small>/${esc(c.slug)}</small></span><a href="/onboarding?slug=${esc(c.slug)}">Personalizar →</a></div>`).join("") : `<p class="empty">Todavía no hay clientes. Créalos en <a href="/closer">/closer</a>.</p>`}
</div></body></html>`);
  }

  const c = await db.getContractorBySlug(slug);
  if (!c) return res.status(404).send("Cliente no encontrado.");
  const fenceC = c.data?.trade === "fence";
  const p = c.data?.profile || {};
  const st = c.data?.site || {};
  const v = (x) => esc(x);
  const svc = Array.isArray(st.services) ? st.services : [];
  const chk = (x) => (svc.indexOf(x) >= 0 ? "checked" : "");
  res.send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Onboarding · ${esc(c.name)}</title><link rel="icon" href="/icon-192.png"><style>
@import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,600;0,9..144,700;1,9..144,600&family=Inter:wght@400;500;600;700;800&display=swap');
*{box-sizing:border-box;font-family:Inter,Arial,sans-serif;margin:0;-webkit-tap-highlight-color:transparent}
:root{--navy:#101B30;--navy2:#0B1226;--gold:#F8B408;--mut:#9DA8C4;--line:rgba(255,255,255,.1)}
body{background:var(--navy2);color:#fff;overflow:hidden}
.layout{display:flex;height:100vh;height:100dvh}
aside{width:268px;background:#fff;border-right:1px solid #E9EAEE;display:flex;flex-direction:column;flex-shrink:0}
.sb-brand{display:flex;align-items:center;gap:10px;padding:22px 20px 14px}
.sb-brand img{height:30px;background:#fff;border-radius:8px}
.sb-brand b{color:#101B30;font-weight:800;font-size:15px}.sb-brand b em{color:#D99E00;font-style:normal}
.sb-label{font-size:10px;letter-spacing:2px;color:#9AA0AC;font-weight:800;padding:8px 20px 6px;text-transform:uppercase}
nav{flex:1;overflow-y:auto;padding-bottom:10px;display:flex;flex-direction:column}
.nav-it{flex:1;display:flex;align-items:center;gap:13px;width:100%;background:none;border:none;color:#6A7384;font-weight:700;font-size:15px;padding:0 20px;cursor:pointer;text-align:left;border-left:4px solid transparent;min-height:46px}
.nav-it .no{font-family:'Fraunces',Georgia,serif;font-size:13px;color:#B6BCC8;width:20px;flex-shrink:0}
.nav-it.on{color:#101B30;background:rgba(248,180,8,.13);border-left-color:var(--gold)}
.nav-it.on .no{color:#D99E00}
.nav-it.done .no{color:#1E7B3C}
.sb-foot{padding:13px 20px;font-size:11px;color:#9AA0AC;font-weight:700;border-top:1px solid #E9EAEE}
main{flex:1;position:relative;display:flex;flex-direction:column;min-width:0}
.mtop{display:none}
.stage{flex:1;position:relative;overflow:hidden}
.slide{position:absolute;inset:0;display:none;flex-direction:column;overflow-y:auto;background:radial-gradient(120% 120% at 100% 0,rgba(16,27,48,.65),var(--navy2))}
.slide.on{display:flex}
.s-in{position:relative;flex:1;display:flex;flex-direction:column;justify-content:center;padding:clamp(26px,5vw,60px);max-width:1040px;width:100%}
.s-in.top{justify-content:flex-start;padding-top:clamp(30px,5vh,52px)}
.kick{color:var(--gold);font-weight:800;font-size:12px;letter-spacing:3px;margin-bottom:14px;text-transform:uppercase}
h1{font-family:'Fraunces',Georgia,serif;font-size:clamp(30px,4.4vw,52px);line-height:1.07;font-weight:700;max-width:760px;color:#fff}
h1 em{font-style:italic;color:var(--gold)}
h1 small{display:block;font-family:Inter;font-size:14px;color:var(--mut);font-weight:600;margin-top:10px;letter-spacing:0}
.rule{width:50px;height:4px;background:var(--gold);border-radius:2px;margin:20px 0}
.body{color:var(--mut);font-weight:500;font-size:clamp(15px,1.7vw,18px);line-height:1.7;max-width:580px}
.fcard{background:#fff;color:#0B1220;border-radius:24px;padding:24px 26px;max-width:640px;width:100%;box-shadow:0 30px 80px rgba(0,0,0,.45);margin-top:24px}
label{display:block;font-weight:600;font-size:13px;margin:16px 0 6px;color:#475067}
label:first-child{margin-top:0}
input,textarea,select{width:100%;padding:13px 15px;border-radius:13px;border:1px solid #E4E7EC;font-size:15px;font-weight:500;outline:none;font-family:inherit;color:#0B1220;background:#fff;transition:border-color .15s,box-shadow .15s}
input:focus,textarea:focus{border-color:var(--gold);box-shadow:0 0 0 4px rgba(248,180,8,.18)}
textarea{min-height:96px;resize:vertical;line-height:1.5}
input[type=file]{padding:10px;background:#F7F8FA;font-weight:600}
.hint{color:#67718A;font-size:12px;font-weight:500;margin-top:6px;line-height:1.5}
.btn-dark{background:#101B30;color:#fff;border:none;border-radius:11px;padding:12px 18px;font-weight:800;cursor:pointer}
.obfaq{display:grid;grid-template-columns:1fr 1.3fr auto;gap:8px;margin:0 0 8px}
.obfaq input{padding:10px 12px;font-size:13.5px}
.btgrid{display:grid;gap:4px 14px;grid-template-columns:1fr}
@media(min-width:860px){.btgrid{grid-template-columns:1fr 1fr}}
.obck-t{font-size:11px;color:#8A94A8;text-transform:uppercase;letter-spacing:.6px;font-weight:800;margin:0 0 8px}
.ckbar{display:inline-block;width:84px;height:5px;background:#E9EDF3;border-radius:99px;margin-left:8px;vertical-align:2px}
.ckbar i{display:block;height:100%;background:var(--gold);border-radius:99px}
.ck{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:14px}
.ck span{font-size:12px;font-weight:700;border-radius:99px;padding:5px 11px;white-space:nowrap;cursor:pointer}
.ck .y{background:#E7F7ED;color:#10803C}
.ck .o{background:transparent;border:1px dashed #D5DAE3;color:#9097A3}
.obfaq button{background:#FDECEC;color:#C5221F;border:none;border-radius:10px;padding:0 12px;font-weight:800;cursor:pointer}
.faqbtns{display:flex;gap:8px;flex-wrap:wrap;margin-top:2px}
.faqbtns .gen{background:#F8B408;color:#101B30;border:none;border-radius:11px;padding:11px 16px;font-weight:800;cursor:pointer;font-size:13px}
.faqbtns .add{background:#fff;border:1px solid #E4E7EC;color:#101B30;border-radius:11px;padding:11px 16px;font-weight:700;cursor:pointer;font-size:13px}
@media(max-width:640px){.obfaq{grid-template-columns:1fr}.obfaq button{padding:8px}}
.colorrow{display:flex;gap:12px;align-items:center;margin-top:6px}
.colorrow input[type=color]{width:54px;height:46px;padding:2px;border-radius:12px;cursor:pointer;border:1px solid #E4E7EC}
.tgrid{display:flex;gap:20px;flex-wrap:wrap;margin-top:6px}
.swatches{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:4px}
.sw{width:44px;height:44px;border-radius:14px;border:3px solid transparent;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.18);transition:transform .12s;padding:0}
.sw:hover{transform:scale(1.08)}
.sw.on{border-color:#101B30;box-shadow:0 0 0 3px rgba(248,180,8,.75)}
.sw.custom{background:conic-gradient(#f43,#fb0,#3c6,#0bc,#36f,#c3f,#f43);position:relative;overflow:hidden}
.sw.custom input{position:absolute;inset:-6px;opacity:0;cursor:pointer;width:56px;height:56px}
.logoprev.lupa{cursor:crosshair}
.rvsw{display:inline-block;width:16px;height:16px;border-radius:5px;vertical-align:-3px;border:1px solid rgba(0,0,0,.15);margin-right:2px}
.staffbox{margin-top:14px;text-align:center}
.staffbox summary{list-style:none;cursor:pointer;color:#D5DAE3;font-size:15px;display:inline-block;padding:2px 10px}
.staffbox summary::-webkit-details-marker{display:none}
.staffbox summary:hover{color:#67718A}
@keyframes cfall{to{transform:translateY(108vh) rotate(720deg);opacity:.9}}
.tpl{cursor:pointer;border-radius:30px;padding:9px;border:2px solid transparent;transition:border-color .15s,background .15s,transform .12s}
.tpl:hover{transform:translateY(-2px)}
.tpl.on{border-color:var(--gold);background:rgba(248,180,8,.1)}
.tphone{background:#0B1226;border:8px solid #1E2A45;border-radius:34px;padding:7px;box-shadow:0 22px 60px rgba(0,0,0,.5)}
.tscr{width:208px;height:420px;overflow:hidden;border-radius:24px}
.tscr iframe{width:390px;height:788px;border:0;transform:scale(.5333);transform-origin:0 0;background:#fff}
.tpl .tn{text-align:center;font-weight:800;margin-top:12px;color:#fff;font-size:15px}
.tpl .tn span{color:var(--gold)}
.tpl .td{text-align:center;color:var(--mut);font-size:12px;font-weight:600;margin-top:3px}
.tpl .pick{display:block;text-align:center;margin:9px auto 0;color:#101B30;background:#fff;border:1.5px solid #E4E7EC;border-radius:99px;padding:8px 0;max-width:150px;font-weight:800;font-size:11px;letter-spacing:1px;text-transform:uppercase}
.tpl.on .pick{background:var(--gold);border-color:var(--gold)}
.tpl.on .pick::before{content:"✓ "}
.tplbar{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:18px 0 4px}
.tplbar label{margin:0;color:#C9D2E5;font-weight:700;font-size:13px}
.tplbar input[type=color]{width:46px;height:38px;border:1px solid var(--line);border-radius:10px;background:none;cursor:pointer;padding:2px}
.thumbs{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
.thumbs .th{position:relative}
.thumbs img{width:74px;height:74px;object-fit:cover;border-radius:12px;border:1px solid #E4E7EC}
.thumbs .x{position:absolute;top:-6px;right:-6px;background:#D93025;color:#fff;border:none;border-radius:50%;width:22px;height:22px;font-weight:800;cursor:pointer}
.logoprev{max-height:54px;max-width:160px;border:1px solid #E4E7EC;border-radius:10px;padding:4px;background:#fff;margin-top:8px;display:none}
.navbar{display:flex;align-items:center;gap:16px;padding:13px 22px;background:rgba(11,18,38,.9);backdrop-filter:saturate(160%) blur(14px);-webkit-backdrop-filter:saturate(160%) blur(14px);border-top:1px solid var(--line)}
.progress{flex:1;height:6px;background:rgba(255,255,255,.12);border-radius:99px;overflow:hidden}
.progress>i{display:block;height:100%;width:14%;background:var(--gold);border-radius:99px;transition:width .3s}
.nb-btn{background:rgba(255,255,255,.08);color:#fff;border:1px solid var(--line);border-radius:11px;padding:11px 20px;font-weight:800;cursor:pointer;font-size:14px}
.nb-btn.next{background:var(--gold);color:#101B30;border:none;box-shadow:0 8px 20px rgba(248,180,8,.3)}
.nb-btn:disabled{opacity:.35;cursor:default}
.save{width:100%;padding:16px;border:none;border-radius:14px;background:var(--gold);color:#101B30;font-size:16px;font-weight:800;cursor:pointer;box-shadow:0 10px 26px rgba(248,180,8,.35);transition:transform .12s,filter .15s;margin-top:6px}
.save:hover{filter:brightness(1.03)}.save:active{transform:scale(.98)}.save:disabled{opacity:.6}
.ok{display:none;background:#E7F7ED;border:1px solid #B6E3C6;color:#10803C;border-radius:14px;padding:14px;font-weight:600;text-align:center;margin-top:12px}
.ok a{color:#10803C;font-weight:800}
.linkrow a{color:var(--gold);font-weight:700;text-decoration:none;font-size:13px}
.rev{list-style:none;padding:0;margin:0}
.rev li{display:flex;justify-content:space-between;gap:12px;padding:11px 0;border-bottom:1px solid #EDF0F5;font-size:14px}
.rev li:last-child{border-bottom:none}
.rev li b{color:#475067;font-weight:600}.rev li span{font-weight:700;color:#0B1220;text-align:right}
.wflow{display:flex;gap:14px;flex-wrap:wrap;margin-top:28px;max-width:760px}
.wflow .wf{flex:1;min-width:150px;background:rgba(255,255,255,.05);border:1px solid var(--line);border-radius:18px;padding:18px 20px}
.wflow .wf .n{font-family:'Fraunces',Georgia,serif;color:var(--gold);font-size:13px;font-weight:700;letter-spacing:2px}
.wflow .wf h4{font-size:15px;margin:8px 0 5px;color:#fff;font-weight:700}
.wflow .wf p{color:var(--mut);font-size:12.5px;font-weight:500;line-height:1.55}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px}
.chip{display:inline-flex;align-items:center;gap:6px;border:1.5px solid #E4E7EC;border-radius:99px;padding:9px 15px;font-size:13.5px;font-weight:700;color:#475067;cursor:pointer;user-select:none;transition:border-color .12s,background .12s,color .12s}
.chip input{display:none}
.chip:has(input:checked){border-color:var(--gold);background:#FFFBEF;color:#101B30}
.chip:has(input:checked)::before{content:"✓";color:#D99E00;font-weight:900}
.microw{display:flex;gap:8px;align-items:flex-start}
.micbtn{background:#fff;border:1.5px solid #E4E7EC;border-radius:12px;width:48px;height:48px;font-size:19px;cursor:pointer;flex-shrink:0;transition:border-color .15s,background .15s}
.micbtn:hover{border-color:#C9CDD6}
.micbtn.rec{border-color:#D93025;background:#FDECEC;animation:micpulse 1.1s infinite}
@keyframes micpulse{0%,100%{box-shadow:0 0 0 0 rgba(217,48,37,.35)}50%{box-shadow:0 0 0 7px rgba(217,48,37,0)}}
textarea.big{min-height:150px;font-size:16px}
.bigwrap{margin-top:26px}
.bigwrap .cap{color:var(--mut);font-weight:700;font-size:11px;letter-spacing:1.8px;text-transform:uppercase;margin-bottom:11px}
.webframe{background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.5);width:min(760px,100%)}
.webframe .wbar{display:flex;align-items:center;gap:6px;background:#E9EAEE;padding:9px 14px}
.webframe .wdot{width:10px;height:10px;border-radius:50%;background:#C9CDD6}
.webframe .wurl{flex:1;background:#fff;border-radius:8px;font-size:11.5px;color:#5E6470;font-weight:600;padding:5px 12px;margin-left:8px}
.dscr{width:100%;height:452px;overflow:hidden}
.dscr iframe{width:1180px;height:880px;border:0;transform:scale(.6441);transform-origin:0 0;display:block;background:#fff}
@media(max-width:860px){
  aside{display:none}
  .mtop{display:flex;align-items:center;gap:12px;background:rgba(16,27,48,.92);color:#fff;padding:13px 18px;border-bottom:1px solid var(--line)}
  .mtop img{height:26px;background:#fff;border-radius:7px;padding:3px 5px}
  .mtop .mstep{font-size:11px;color:var(--gold);font-weight:800;letter-spacing:1px}
  .mtop .mtitle{font-weight:800;font-size:14px}
  .s-in{padding:22px 18px 30px}
}
</style></head><body>
<div class="layout">
<aside>
  <div class="sb-brand"><img src="/brand-logo.png" alt=""><b>ALTO <em>PRO</em></b></div>
  <div class="sb-label">Onboarding · ${esc(c.name)}</div>
  <nav id="nav">
    <button class="nav-it on" onclick="go(0)"><span class="no">1</span>Bienvenida</button>
    <button class="nav-it" onclick="go(1)"><span class="no">2</span>Su negocio</button>
    <button class="nav-it" onclick="go(2)"><span class="no">3</span>Su diseño</button>
    <button class="nav-it" onclick="go(3)"><span class="no">4</span>Su historia</button>
    <button class="nav-it" onclick="go(4)"><span class="no">5</span>Fotos de trabajos</button>
    <button class="nav-it" onclick="go(5)"><span class="no">6</span>Su bot 🤖</button>
    <button class="nav-it" onclick="go(6)"><span class="no">7</span>Su dominio</button>
    <button class="nav-it" onclick="go(7)"><span class="no">8</span>Listo</button>
  </nav>
  <div class="sb-foot">🌐 ${esc(c.slug)}.alto-pro.com</div>
</aside>
<main>
  <div class="mtop"><img src="/brand-logo.png" alt=""><div><div class="mstep" id="mstep">Paso 1 de 8</div><div class="mtitle" id="mtitle">Bienvenida</div></div></div>
  <div class="stage">

    <section class="slide on">
      <div class="s-in">
        <p class="kick">Onboarding · ${esc(c.name)}</p>
        <h1>Bienvenido a tu <em>onboarding.</em></h1>
        <div class="rule"></div>
        <p class="body">En esta reunión vamos a juntar todo lo que hace único a tu negocio — tu estilo, tu historia, tu logo y tus fotos. Con eso, nuestro equipo de diseño construye tu página a mano. Tú solo contesta unas preguntas; nosotros nos encargamos del resto.</p>
        <div class="wflow">
          <div class="wf"><div class="n">01</div><h4>Tus preferencias</h4><p>Juntamos tu estilo, tu historia y tus fotos en esta llamada.</p></div>
          <div class="wf"><div class="n">02</div><h4>Nuestro equipo de diseño</h4><p>Lo arma todo a mano con tu marca — no es una plantilla genérica.</p></div>
          <div class="wf"><div class="n">03</div><h4>Tu página, lista</h4><p>En 7–14 días, en ${esc(c.slug)}.alto-pro.com o tu propio dominio.</p></div>
        </div>
      </div>
    </section>

    <section class="slide">
      <div class="s-in top">
        <p class="kick">Paso 2 · Su negocio</p>
        <h1>Cuéntanos de <em>tu negocio.</em></h1>
        <div class="fcard">
          <label>Nombre del negocio</label><input id="biz" value="${v(p.biz || c.name)}">
          <label>Teléfono</label><input id="phone" type="tel" value="${v(p.phone || c.phone)}" placeholder="(956) 555-0100">
          <label>Ciudad principal</label><input id="city" value="${v(st.city)}" placeholder="Rio Grande City, TX">
          <label>Pueblos o condados que cubre</label><input id="area" value="${v(st.area)}" placeholder="Starr, Hidalgo, Zapata…">
          <label>Años en el negocio</label><input id="years" type="number" value="${v(st.years)}" placeholder="15">
          <label>Servicios que ofrece</label>
          <div class="chips" id="services">
            ${(fenceC ? [
              ["Cerca de madera", "Madera"], ["Cerca de vinilo", "Vinilo"], ["Malla ciclónica", "Malla"],
              ["Cerca de aluminio", "Aluminio"], ["Portones", "Portones"], ["Reparación de cercas", "Reparación"],
              ["Medición gratis", "Medición gratis"], ["Cerca comercial", "Comercial"], ["Financiamiento", "Financiamiento"],
            ] : [
              ["Reparación de techos", "Reparación"], ["Techo nuevo / reemplazo", "Techo nuevo"], ["Inspección gratis", "Inspección gratis"],
              ["Daño por granizo / seguro", "Granizo / seguro"], ["Techo de metal", "Metal"], ["Shingle / asfalto", "Shingle"],
              ["Teja", "Teja"], ["Emergencias 24/7", "Emergencias 24/7"], ["Financiamiento", "Financiamiento"],
            ]).map(([val, lab]) => `<label class="chip"><input type="checkbox" value="${val}" ${chk(val)}>${lab}</label>`).join("\n            ")}
          </div>
          <label>Garantía que ofrece</label><input id="warranty" value="${v(st.warranty)}" placeholder="Ej. 10 años por escrito en mano de obra">
          <label>¿Qué los hace diferentes? (opcional)</label><input id="diff" value="${v(st.diff)}" placeholder="Ej. familia local, mismo dueño en cada trabajo">
          <label>Licencia / seguro (opcional)</label><input id="license" value="${v(p.license)}" placeholder="RCAT-12345 · asegurado">
        </div>
      </div>
    </section>

    <section class="slide">
      <div class="s-in top">
        <p class="kick">Paso 3 · Su diseño</p>
        <h1>¿Cuál se siente <em>más tú?</em></h1>
        <p class="body" style="margin-top:8px">Tres diseños <b>probados que generan clientes</b>. 🖐️ <b>Desliza dentro de cada teléfono</b> para recorrer la página completa — es la página de verdad, funcionando. Toca <b>Elegir</b> en el que más te guste; abajo lo ves en grande, en computadora.</p>
        <div class="tgrid" id="tpls">
          <div class="tpl" data-t="1" onclick="pickTpl('1')"><div class="tphone"><div class="tscr"><iframe id="f1" src="/plantilla/1?embed=1" title="Opción 1"></iframe></div></div><p class="tn">Opción <span>1</span></p><p class="td">Elegante y premium</p><span class="pick">Elegir</span></div>
          <div class="tpl" data-t="2" onclick="pickTpl('2')"><div class="tphone"><div class="tscr"><iframe id="f2" src="/plantilla/2?embed=1" title="Opción 2"></iframe></div></div><p class="tn">Opción <span>2</span></p><p class="td">Fuerte y con energía</p><span class="pick">Elegir</span></div>
          <div class="tpl" data-t="3" onclick="pickTpl('3')"><div class="tphone"><div class="tscr"><iframe id="f3" src="/plantilla/3?embed=1" title="Opción 3"></iframe></div></div><p class="tn">Opción <span>3</span></p><p class="td">Limpio y de confianza</p><span class="pick">Elegir</span></div>
        </div>
        <div class="fcard" style="margin-top:22px">
          <label>Su logo — súbalo y sacamos su color solo</label>
          <input type="file" id="logofile" accept="image/*">
          <img class="logoprev lupa" id="logoprev" onclick="lupaPick(event)" title="🔍 Toca el logo para copiar ese color exacto" ${/^data:image/.test(String(p.logo || "")) ? `src="${p.logo}" style="display:block"` : ""}>
          <p class="hint" id="lupahint" style="${/^data:image/.test(String(p.logo || "")) ? "" : "display:none"}">🔍 <b>La lupa:</b> toca cualquier parte del logo y copiamos ese color exacto a la página.</p>
          <input type="hidden" id="color" value="${st.color && /^#[0-9a-fA-F]{6}$/.test(st.color) ? st.color : ""}">
          <label style="margin-top:16px">🎨 Su color de marca — toca uno y mira su página repintarse</label>
          <div class="swatches">
            ${["#B30F24", "#E8540C", "#D99E00", "#1E7B3C", "#0F5E4F", "#1B6FB8", "#0B3D66", "#5B2A86", "#4A3728", "#101B30", "#54616F"].map((hex) => `<button type="button" class="sw" data-c="${hex}" style="background:${hex}" onclick="setColor('${hex}')" title="${hex}"></button>`).join("")}
            <label class="sw custom" title="Color exacto de su marca — rueda de color"><input type="color" id="colorwheel" value="${st.color && /^#[0-9a-fA-F]{6}$/.test(st.color) ? st.color : "#B30F24"}" oninput="setColor(this.value)"></label>
          </div>
          <p class="hint">Esto es una <b>vista previa</b> de sus colores — su página final la arma nuestro equipo de diseño a mano y se entrega en 7–14 días.</p>
        </div>
        <div class="bigwrap">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:11px">
            <p class="cap" style="margin-bottom:0">Así se vería en computadora — haz scroll adentro</p>
            <a id="expand" href="/plantilla/1?embed=1" target="_blank" class="btn-dark" style="text-decoration:none;display:inline-flex;align-items:center;gap:7px;padding:11px 18px;font-size:13px">⛶ Expandir — presentar en grande</a>
          </div>
          <div class="webframe">
            <div class="wbar"><span class="wdot"></span><span class="wdot"></span><span class="wdot"></span><span class="wurl">${esc(c.slug)}.alto-pro.com</span></div>
            <div class="dscr"><iframe id="bigframe" src="/plantilla/1?embed=1" title="Vista de computadora"></iframe></div>
          </div>
        </div>
      </div>
    </section>

    <section class="slide">
      <div class="s-in top">
        <p class="kick">Paso 4 · Su historia</p>
        <h1>Cuéntanos <em>su historia.</em></h1>
        <div class="fcard">
          <label>Cuéntanos del negocio — habla o escribe</label>
          <textarea id="rough" class="big" placeholder="¿Cómo empezó? ¿Cuánt${fenceC ? "as cercas" : "os techos"} han hecho? ¿Qué los hace diferentes? ¿Su garantía? Puedes hablar con el micrófono — no tiene que estar bonito, la IA lo acomoda."></textarea>
          <div class="microw" style="margin-top:8px">
            <button type="button" id="aibtn" onclick="aiWrite()" class="btn-dark">✨ Escribir con IA</button>
            <button type="button" class="micbtn" onclick="dictate('rough',this)" title="Hablar en vez de escribir">🎤</button>
            <span class="hint" id="aihint" style="align-self:center"></span>
          </div>
          <hr style="border:none;border-top:1px solid #EDF0F5;margin:18px 0">
          <label>Titular (opcional)</label><input id="hero" value="${v(st.hero)}" placeholder="Déjalo vacío para usar el de la plantilla">
          <label>Frase corta</label><input id="tagline" value="${v(st.tagline)}" placeholder="${fenceC ? "Cercas" : "Techos"} con garantía por escrito en toda la región.">
          <label>Su historia (lo que va en la página)</label>
          <div class="microw">
            <textarea id="about" class="big" placeholder="2-3 oraciones sobre el negocio — la IA la llena desde tus notas de arriba.">${v(st.about)}</textarea>
            <button type="button" class="micbtn" onclick="dictate('about',this)" title="Hablar en vez de escribir">🎤</button>
          </div>
          <p class="hint">La IA llena el titular, la frase y la historia desde tus notas — <b>revísalos y edítalos</b> antes de enviar.</p>
        </div>
      </div>
    </section>

    <section class="slide">
      <div class="s-in top">
        <p class="kick">Paso 5 · Fotos de trabajos</p>
        <h1>Sus <em>trabajos.</em></h1>
        <div class="fcard">
          <label>Fotos de trabajos terminados</label>
          <p class="hint" style="margin-top:0">📲 Pídele al cliente que mande sus mejores fotos por WhatsApp y tú las subes aquí durante la llamada. Fotos reales se ven mucho mejor que las de internet.</p>
          <input type="file" id="photofiles" accept="image/*" multiple>
          <div class="thumbs" id="thumbs"></div>
        </div>
      </div>
    </section>

    <section class="slide">
      <div class="s-in top">
        <p class="kick">Paso 6 · Su bot</p>
        <h1>Su asistente que <em>nunca duerme.</em> <small>Contesta el chat de su página 24/7 y convierte visitas en clientes.</small></h1>
        <div class="fcard">
          <p class="obck-t">QUÉ SABE — <span id="ob_count">0/8 temas · 0 preguntas</span><span class="ckbar"><i id="ob_bar"></i></span></p>
          <div class="ck" id="ob_sum"></div>
          <div class="btgrid">
            <div><label>📍 Dirección / oficina</label><input id="botaddr" value="${v(st.botTrain?.addr ?? st.botAddr)}" placeholder='Ej. "500 N Main St, McAllen" o "sin oficina — a domicilio"'></div>
            <div><label>🕐 Horarios</label><input id="bothours" value="${v(st.botTrain?.hours ?? st.botHours)}" placeholder="Ej. Lun–Vie 8am–6pm, sábados hasta mediodía, no domingos"></div>
            <div><label>💳 Financiamiento</label><input id="obt_financing" value="${v(st.botTrain?.financing)}" placeholder='Ej. "Sí, con pagos mensuales" o "No ofrecemos"'></div>
            <div><label>💵 Formas de pago</label><input id="obt_payments" value="${v(st.botTrain?.payments)}" placeholder="Ej. Efectivo, cheque, tarjeta, Zelle"></div>
            <div><label>🛡️ Aseguranza / reclamos de seguro</label><input id="obt_insurance" value="${v(st.botTrain?.insurance)}" placeholder="Ej. Sí trabajamos con reclamos de seguro y granizo"></div>
            <div><label>🚨 Emergencias / urgencias</label><input id="obt_emergency" value="${v(st.botTrain?.emergency)}" placeholder="Ej. Atendemos goteras de emergencia el mismo día"></div>
            <div><label>🗣️ Idiomas</label><input id="obt_languages" value="${v(st.botTrain?.languages)}" placeholder="Ej. Español e inglés"></div>
            <div><label>🎁 Promociones vigentes</label><input id="obt_promos" value="${v(st.botTrain?.promos)}" placeholder="Ej. Inspección gratis todo este mes"></div>
          </div>
          <label>➕ Otros datos confirmados</label>
          <textarea id="obt_extra" rows="2" placeholder="Cualquier otra verdad que el bot pueda afirmar de este negocio…">${esc(st.botTrain?.extra || "")}</textarea>
          <label style="margin-top:18px">💬 Preguntas frecuentes — genéralas y léeselas al cliente (máx. 10)</label>
          <p class="hint" style="margin-top:0">La que le guste se queda, la que no, bórrala con ✕. Puedes editar cualquier respuesta antes de guardar.</p>
          <div id="faqlist"></div>
          <div class="faqbtns">
            <button type="button" class="gen" id="faqgen" onclick="genFaq()">✨ Generar preguntas con IA</button>
            <button type="button" class="add" onclick="obAddFaq('','')">＋ Agregar a mano</button>
          </div>
          <div class="faqbtns" style="margin-top:14px">
            <button type="button" class="gen" id="obsave" onclick="obSaveBot(this)" style="background:#101B30;color:#fff">💾 Guardar entrenamiento ahora</button>
            <a href="/site/${esc(c.slug)}?preview=1&chat=open" target="_blank" class="add" style="text-decoration:none;display:inline-flex;align-items:center">💬 Probar el chat</a>
            <span class="hint" id="obmsg" style="margin:0;align-self:center"></span>
          </div>
          <p class="hint">🧠 El bot SOLO afirma lo que esté en esta pestaña — lo demás contesta "se lo confirmamos cuando le llamemos". Nunca da precios (manda al cotizador) ni agenda citas con hora. Deja un campo vacío y el bot simplemente no toca ese tema. También se guarda todo junto con el botón del último paso.</p>
        </div>
      </div>
    </section>

    <section class="slide">
      <div class="s-in top">
        <p class="kick">Paso 7 · Su dominio</p>
        <h1>Su propio <em>dominio.</em> <small>Opcional — su página ya vive en ${esc(c.slug)}.alto-pro.com</small></h1>
        <div class="fcard">
          <label>Buscar un dominio disponible</label>
          <div style="display:flex;gap:8px"><input id="dsearch" placeholder="Nombre del negocio o dominio" style="flex:1" onkeydown="if(event.key==='Enter'){event.preventDefault();checkDomain();}"><button type="button" onclick="checkDomain()" id="dsbtn" class="btn-dark" style="white-space:nowrap;background:var(--gold);color:#101B30">Buscar</button></div>
          <div id="dresults" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px"></div>
          <p class="hint" id="dsearchhint" style="margin-top:4px"></p>
          <hr style="border:none;border-top:1px solid #EDF0F5;margin:14px 0">
          <label>Dominio del cliente (conectar)</label>
          <div style="display:flex;gap:8px"><input id="domain" value="${v(st.domain)}" placeholder="mirandaroofing.com" style="flex:1"><button type="button" onclick="connectDomain()" id="dombtn" class="btn-dark" style="white-space:nowrap">Conectar</button></div>
          <div id="dommsg" class="hint" style="margin-top:8px"></div>
          <hr style="border:none;border-top:1px solid #EDF0F5;margin:14px 0">
          <div style="background:#F4F9F4;border:1.5px solid #BFE6CC;border-radius:14px;padding:14px 16px;margin-bottom:12px">
            <p style="font-weight:800;font-size:13.5px;color:#1E7B3C;margin:0 0 6px">⭐ Explícale su sistema de reseñas (esto vende solo):</p>
            <p class="hint" style="margin:0;line-height:1.65">Después de cada trabajo manda un link. Cliente <b>contento (4–5★)</b> → lo llevamos directo a dejar sus 5 estrellas en el link de abajo (su Google o Facebook), y la reseña también aparece sola en su página web. Cliente <b>descontento (1–3★)</b> → se queda 100% privado, nunca se publica, y a él le llega un aviso al celular para arreglarlo con una llamada.</p>
          </div>
          <label>Link de reseñas — donde el cliente YA tenga presencia (opcional)</label>
          <input id="gmb" value="${v(st.gmb)}" placeholder="Google (g.page/r/…), página de Facebook, Instagram…">
          <p class="hint" style="margin-top:4px"><b>¿No tiene nada?</b> Déjalo vacío: las buenas reseñas se publican en su propia página web automáticamente. (Crear su perfil de Google no es parte del servicio — posible upsell futuro.)</p>
          <hr style="border:none;border-top:1px solid #EDF0F5;margin:14px 0">
          <label>Redes sociales — se ponen como botones al pie de su página (opcional)</label>
          <div style="display:flex;gap:8px;margin-top:2px"><span style="align-self:center;font-size:19px">📘</span><input id="fb" value="${v(st.facebook)}" placeholder="facebook.com/su-negocio o @usuario" style="flex:1"><button type="button" id="fbno" onclick="socNo('fb')" style="white-space:nowrap;background:#F0F2F6;border:1.5px solid #E4E7EC;border-radius:10px;padding:0 14px;font-weight:700;font-size:12.5px;color:#67718A;cursor:pointer;font-family:inherit">No tiene</button></div>
          <div style="display:flex;gap:8px;margin-top:8px"><span style="align-self:center;font-size:19px">📸</span><input id="ig" value="${v(st.instagram)}" placeholder="instagram.com/su-negocio o @usuario" style="flex:1"><button type="button" id="igno" onclick="socNo('ig')" style="white-space:nowrap;background:#F0F2F6;border:1.5px solid #E4E7EC;border-radius:10px;padding:0 14px;font-weight:700;font-size:12.5px;color:#67718A;cursor:pointer;font-family:inherit">No tiene</button></div>
          <p class="hint" style="margin-top:6px">Puedes pegar el link completo o solo el @usuario. Si no tiene, toca <b>No tiene</b> y el botón simplemente no aparece en su página.</p>
        </div>
      </div>
    </section>

    <section class="slide">
      <div class="s-in top">
        <p class="kick">Paso 8 · Listo</p>
        <h1>Todo listo para <em>enviarlo.</em></h1>
        <div class="fcard">
          <div style="text-align:center"><div style="font-size:42px;line-height:1">📨</div></div>
          <p style="text-align:center;color:#475067;font-weight:600;font-size:14px;margin:8px 0 18px;line-height:1.6">Todo lo que armamos hoy, junto. Al enviar, nuestro equipo de diseño arma tu página a mano y te la entregamos lista en <b style="color:#0B1220">7–14 días</b>.</p>
          <ul class="rev">
            <li><b>Negocio</b><span id="rvbiz">—</span></li>
            <li><b>Teléfono</b><span id="rvphone">—</span></li>
            <li><b>Ciudad</b><span id="rvcity">—</span></li>
            <li><b>Estilo elegido</b><span id="rvtpl">—</span></li>
            <li><b>Color de marca</b><span id="rvcolor">—</span></li>
            <li><b>Servicios</b><span id="rvserv">—</span></li>
            <li><b>Fotos de trabajos</b><span id="rvfotos">—</span></li>
            <li><b>Su historia</b><span id="rvhist">—</span></li>
            <li><b>Bot entrenado</b><span id="rvbot">—</span></li>
            <li><b>Link de reseñas</b><span id="rvgmb">—</span></li>
            <li><b>Dominio</b><span id="rvdom">su subdominio</span></li>
            <li><b>Redes</b><span id="rvsoc">—</span></li>
          </ul>
          <button class="save" id="save" onclick="save()">Enviar al equipo de diseño 🎨</button>
          <div class="ok" id="ok"></div>
          <div id="wowprev" style="display:none;margin-top:20px;text-align:center">
            <p style="font-weight:800;font-size:15px;margin:0 0 12px">🎬 Así va quedando — su página, en vivo</p>
            <div class="tphone" style="margin:0 auto;width:224px"><div class="tscr"><iframe id="wowframe" title="Su página"></iframe></div></div>
            <p class="hint" style="margin-top:10px">Desliza dentro del teléfono — el equipo de diseño la pule desde aquí.</p>
          </div>
          <details class="staffbox"><summary title="Herramientas internas — no compartir en pantalla">⚙</summary>
            <div style="margin-top:10px;text-align:center">
              <a href="/site/${esc(c.slug)}?preview=1" target="_blank" class="linkrow" style="margin-right:14px">👁 Ver borrador (interno)</a>
              <button onclick="publish()" id="pub" class="btn-dark" style="background:${st.published ? "#1E7B3C" : "#101B30"}">${st.published ? "✓ Publicada — clic para ocultar" : "🚀 Publicar página al cliente"}</button>
            </div>
          </details>
        </div>
      </div>
    </section>

  </div>
  <div class="navbar">
    <button class="nb-btn" id="prevb" onclick="go(STEP-1)">‹ Atrás</button>
    <div class="progress"><i id="prog"></i></div>
    <button class="nb-btn next" id="nextb" onclick="go(STEP+1)">Siguiente ›</button>
  </div>
</main>
</div>
<script>
var LOGO = ${/^data:image/.test(String(p.logo || "")) ? JSON.stringify(p.logo) : "null"};
var PHOTOS = ${JSON.stringify(Array.isArray(st.photos) ? st.photos : [])};
var TPL = "${["1", "2", "3"].includes(String(st.template)) ? st.template : "1"}";
var PUBLISHED = ${st.published ? "true" : "false"};
// ── step navigation (deck-style) ──
var NAVT=["Bienvenida","Su negocio","Su diseño","Su historia","Fotos de trabajos","Su bot","Su dominio","Listo"];
var STEP=0;var MAX=8;
function go(i){
  if(i<0||i>=MAX)return;STEP=i;
  var sl=document.querySelectorAll('.slide');for(var s=0;s<sl.length;s++){sl[s].classList.toggle('on',s===i);}
  var nv=document.querySelectorAll('.nav-it');for(var n=0;n<nv.length;n++){nv[n].classList.toggle('on',n===i);nv[n].classList.toggle('done',n<i);}
  document.getElementById('prog').style.width=Math.round(((i+1)/MAX)*100)+'%';
  document.getElementById('mstep').textContent='Paso '+(i+1)+' de '+MAX;
  document.getElementById('mtitle').textContent=NAVT[i];
  document.getElementById('prevb').disabled=(i===0);
  document.getElementById('nextb').style.visibility=(i===MAX-1)?'hidden':'visible';
  if(i===7)review();
  if(sl[i])sl[i].scrollTop=0;
}
var TNAME={'1':'Opción 1 — elegante','2':'Opción 2 — con energía','3':'Opción 3 — limpio'};
function review(){
  document.getElementById('rvbiz').textContent=document.getElementById('biz').value||'—';
  document.getElementById('rvphone').textContent=document.getElementById('phone').value||'—';
  document.getElementById('rvcity').textContent=document.getElementById('city').value||'—';
  document.getElementById('rvtpl').textContent=TNAME[TPL]||('Opción '+TPL);
  var col=document.getElementById('color').value;
  document.getElementById('rvcolor').innerHTML=col?('<span class="rvsw" style="background:'+col+'"></span> '+col):'— se saca del logo';
  var n=document.querySelectorAll('#services input:checked').length;
  document.getElementById('rvserv').textContent=n?(n+(n===1?' servicio':' servicios')):'—';
  document.getElementById('rvfotos').textContent=PHOTOS.length?(PHOTOS.length+(PHOTOS.length===1?' foto':' fotos')):'— pendientes';
  document.getElementById('rvhist').textContent=document.getElementById('about').value.trim()?'✓ lista':'— pendiente';
  var bt=0;(OB_CATS||[]).forEach(function(cat){if(document.getElementById(cat[0]).value.trim())bt++;});
  var bf=document.querySelectorAll('#faqlist .obfaq').length;
  document.getElementById('rvbot').textContent=(bt||bf)?('✓ '+bt+'/8 temas · '+bf+' pregunta'+(bf===1?'':'s')):'— sin entrenar';
  document.getElementById('rvgmb').textContent=document.getElementById('gmb').value.trim()?'✓ conectado':'—';
  var d=document.getElementById('domain').value.trim();
  document.getElementById('rvdom').textContent=d||'su subdominio';
  var socs=[];if(document.getElementById('fb').value.trim())socs.push('Facebook');if(document.getElementById('ig').value.trim())socs.push('Instagram');
  var rvsoc=document.getElementById('rvsoc');if(rvsoc)rvsoc.textContent=socs.length?socs.join(' + '):'— sin redes';
}
function socNo(id){
  var i=document.getElementById(id),b=document.getElementById(id+'no');
  if(b.dataset.on==='1'){b.dataset.on='';i.disabled=false;b.style.background='#F0F2F6';b.style.color='#67718A';b.style.borderColor='#E4E7EC';b.textContent='No tiene';}
  else{b.dataset.on='1';i.value='';i.disabled=true;b.style.background='#101B30';b.style.color='#fff';b.style.borderColor='#101B30';b.textContent='✓ Sin red';}
}
// ── template picker: one desktop frame swaps to the chosen template ──
function paintTpl(){[].forEach.call(document.querySelectorAll('.tpl'),function(el){el.classList.toggle('on',el.dataset.t===TPL)})}
// ── live brand-color preview: swatches + wheel repaint the templates ──
var CURC=document.getElementById('color').value||'';
var _rpT=null;
function tplQ(){return '?embed=1'+(CURC?'&color='+encodeURIComponent(CURC):'');}
function repaintPreviews(){
  var q=tplQ();
  ['1','2','3'].forEach(function(n){var f=document.getElementById('f'+n);if(f)f.src='/plantilla/'+n+q;});
  var bf=document.getElementById('bigframe');if(bf)bf.src='/plantilla/'+TPL+q;
  var ex=document.getElementById('expand');if(ex)ex.href='/plantilla/'+TPL+q;
}
function setColor(hex){
  if(!/^#[0-9a-fA-F]{6}$/.test(hex))return;
  CURC=hex;document.getElementById('color').value=hex;
  var w=document.getElementById('colorwheel');if(w&&w.value.toLowerCase()!==hex.toLowerCase())w.value=hex;
  [].forEach.call(document.querySelectorAll('.sw[data-c]'),function(s){s.classList.toggle('on',s.getAttribute('data-c').toLowerCase()===hex.toLowerCase())});
  clearTimeout(_rpT);_rpT=setTimeout(repaintPreviews,250);
}
if(CURC&&/^#[0-9a-fA-F]{6}$/.test(CURC))setColor(CURC);
// ── the lupa: click anywhere on the logo to copy that exact pixel color ──
function lupaPick(ev){
  var img=document.getElementById('logoprev');
  if(!img.src||!img.naturalWidth)return;
  var r=img.getBoundingClientRect();
  var x=Math.max(0,Math.min(img.naturalWidth-1,Math.round((ev.clientX-r.left)*(img.naturalWidth/r.width))));
  var y=Math.max(0,Math.min(img.naturalHeight-1,Math.round((ev.clientY-r.top)*(img.naturalHeight/r.height))));
  var cv=document.createElement('canvas');cv.width=img.naturalWidth;cv.height=img.naturalHeight;
  var ctx=cv.getContext('2d');ctx.drawImage(img,0,0);
  var d;try{d=ctx.getImageData(x,y,1,1).data;}catch(e){return;}
  if(d[3]<40)return; // transparent pixel — nothing to copy
  var hex='#'+[d[0],d[1],d[2]].map(function(v){return ('0'+v.toString(16)).slice(-2)}).join('');
  setColor(hex);
}
function pickTpl(t){TPL=t;paintTpl();var q=tplQ();var bf=document.getElementById('bigframe');if(bf)bf.src='/plantilla/'+t+q;var ex=document.getElementById('expand');if(ex)ex.href='/plantilla/'+t+q;}
// ── voice dictation (closer can speak instead of type) ──
var _rec=null,_recBtn=null;
function dictate(targetId,btn){
  var SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){alert('Tu navegador no soporta dictado por voz. Usa Google Chrome.');return;}
  if(_rec){_rec.stop();return;}
  var ta=document.getElementById(targetId);var base=ta.value?ta.value.replace(/\\s*$/,'')+' ':'';
  _rec=new SR();_rec.lang='es-MX';_rec.interimResults=true;_rec.continuous=true;
  _recBtn=btn;btn.classList.add('rec');ta.focus();
  _rec.onresult=function(e){var interim='';for(var i=e.resultIndex;i<e.results.length;i++){var r=e.results[i];if(r.isFinal){base+=r[0].transcript+' ';}else{interim+=r[0].transcript;}}ta.value=base+interim;};
  _rec.onend=function(){if(_recBtn)_recBtn.classList.remove('rec');_rec=null;_recBtn=null;};
  _rec.onerror=function(){if(_recBtn)_recBtn.classList.remove('rec');_rec=null;_recBtn=null;};
  _rec.start();
}
// ── pull the brand color out of the uploaded logo ──
function logoColor(img){
  var w=44,h=44,cv=document.createElement('canvas');cv.width=w;cv.height=h;
  var ctx=cv.getContext('2d');ctx.drawImage(img,0,0,w,h);
  var d;try{d=ctx.getImageData(0,0,w,h).data;}catch(e){return null;}
  var buckets={},best=null,bestC=-1;
  for(var i=0;i<d.length;i+=4){
    var r=d[i],g=d[i+1],b=d[i+2],a=d[i+3];if(a<128)continue;
    var mx=Math.max(r,g,b),mn=Math.min(r,g,b);
    if(mx>238&&mn>238)continue;if(mx<24)continue;if(mx-mn<26)continue;
    var k=(r>>5)+'-'+(g>>5)+'-'+(b>>5),bk=buckets[k]||(buckets[k]={c:0,r:0,g:0,b:0});
    bk.c++;bk.r+=r;bk.g+=g;bk.b+=b;
  }
  for(var key in buckets){if(buckets[key].c>bestC){bestC=buckets[key].c;best=buckets[key];}}
  if(!best)return null;
  function hx(x){return('0'+Math.round(x).toString(16)).slice(-2);}
  return '#'+hx(best.r/best.c)+hx(best.g/best.c)+hx(best.b/best.c);
}
pickTpl(TPL);
// Deep link from a CS ticket (?step=5&field=botaddr): jump straight to the
// step and flash-focus the exact field, so "✏️ Editar" doesn't dump the
// agent at step 1 to go hunting.
(function(){
  var qs=new URLSearchParams(location.search),qStep=qs.get('step'),qField=qs.get('field');
  go(qStep!=null?Math.max(0,Math.min(MAX-1,parseInt(qStep,10)||0)):0);
  if(qField){var fld=document.getElementById(qField);if(fld){setTimeout(function(){
    fld.scrollIntoView({block:'center',behavior:'smooth'});fld.focus();
    fld.style.transition='box-shadow .2s';fld.style.boxShadow='0 0 0 4px rgba(248,180,8,.6)';
    setTimeout(function(){fld.style.boxShadow='';},2600);
  },380);}}
})();
// image compression to a data URL
function compress(file,maxW,quality){return new Promise(function(res){
  var img=new Image();img.onload=function(){
    var s=Math.min(1,maxW/img.width);var cv=document.createElement('canvas');
    cv.width=Math.round(img.width*s);cv.height=Math.round(img.height*s);
    cv.getContext('2d').drawImage(img,0,0,cv.width,cv.height);
    res(cv.toDataURL('image/jpeg',quality));URL.revokeObjectURL(img.src);
  };img.src=URL.createObjectURL(file);
});}
// logo — preview it AND pull the brand color from it
document.getElementById('logofile').onchange=function(e){var f=e.target.files[0];if(!f)return;
  var im=new Image();im.onload=function(){var col=logoColor(im);if(col)setColor(col);URL.revokeObjectURL(im.src);};im.src=URL.createObjectURL(f);
  compress(f,240,0.9).then(function(d){LOGO=d;var pv=document.getElementById('logoprev');pv.src=d;pv.style.display='block';var lh=document.getElementById('lupahint');if(lh)lh.style.display='';});};
// photos → upload to /api/logo, store the served URL
function renderThumbs(){var t=document.getElementById('thumbs');t.innerHTML=PHOTOS.map(function(u,i){
  return '<div class="th"><img src="'+u+'"><button class="x" onclick="rmPhoto('+i+')">×</button></div>';}).join('');}
function rmPhoto(i){PHOTOS.splice(i,1);renderThumbs();}
renderThumbs();
document.getElementById('photofiles').onchange=function(e){
  var files=[].slice.call(e.target.files).slice(0,6);
  files.forEach(function(f){
    compress(f,1100,0.82).then(function(d){
      // step down quality if too big for the 150KB image store
      function tryUp(data,q){
        return fetch('/api/logo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:data})})
          .then(function(r){if(r.status===413&&q>0.4){return compress(f,900,q-0.15).then(function(d2){return tryUp(d2,q-0.15)});}return r.json();});
      }
      tryUp(d,0.82).then(function(j){if(j&&j.id&&PHOTOS.length<8){PHOTOS.push('/api/logo/'+j.id);renderThumbs();}});
    });
  });
};
function checkDomain(){
  var btn=document.getElementById('dsbtn'),box=document.getElementById('dresults'),hint=document.getElementById('dsearchhint');
  var q=document.getElementById('dsearch').value.trim();
  if(!q){hint.textContent='Escribe un nombre o dominio.';return;}
  btn.disabled=true;btn.textContent='…';box.innerHTML='';hint.style.color='#67718A';hint.textContent='Buscando…';
  fetch('/api/onboarding/domaincheck?name='+encodeURIComponent(q))
    .then(function(r){return r.json();}).then(function(j){
      btn.disabled=false;btn.textContent='Buscar';
      if(!j||!j.ok||!j.results){hint.textContent='No se pudo buscar — intenta de nuevo.';return;}
      hint.innerHTML='💡 Precio de costo, sin sobreprecio. Cloudflare no vende dominios premium — si no te deja comprarlo, elige otro.';
      box.innerHTML=j.results.map(function(x){
        var bg=x.status==='available'?'#EAF8EF':x.status==='taken'?'#FDECEC':'#F0F2F6';
        var fg=x.status==='available'?'#1E7B3C':x.status==='taken'?'#9B1C10':'#67718A';
        var tag=x.status==='available'?(x.price?('✓ disponible · $'+Number(x.price).toFixed(2)+'/año'):'✓ disponible'):x.status==='taken'?'✕ ocupado':'? sin verificar';
        var pill='<span style="background:'+bg+';color:'+fg+';border-radius:10px;padding:8px 12px;font-weight:700;font-size:13px">'+x.domain+' · '+tag+'</span>';
        if(x.canBuy) return '<span style="display:inline-flex;gap:6px;align-items:center">'+pill+'<button type="button" onclick="buyDomain(\\''+x.domain+'\\','+(x.price||0)+')" class="btn-dark" style="padding:7px 12px;font-size:12.5px;white-space:nowrap">Comprar y conectar</button></span>';
        if(x.status==='available') return '<span onclick="useDomain(\\''+x.domain+'\\')" style="cursor:pointer">'+pill+'</span>';
        return pill;
      }).join('');
    }).catch(function(){btn.disabled=false;btn.textContent='Buscar';hint.textContent='No se pudo buscar — intenta de nuevo.';});
}
function useDomain(d){document.getElementById('domain').value=d;document.getElementById('domain').scrollIntoView({block:'center'});}
function connectDomain(){
  var btn=document.getElementById('dombtn'),msg=document.getElementById('dommsg');
  var d=document.getElementById('domain').value.trim();
  btn.disabled=true;btn.textContent='…';msg.style.color='#67718A';
  fetch('/api/onboarding/domain',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({slug:${JSON.stringify(c.slug)},domain:d})})
    .then(function(r){return r.json();}).then(function(j){
      btn.disabled=false;btn.textContent='Conectar';
      if(!j||!j.ok){msg.style.color='#9B1C10';msg.textContent='Error: '+((j&&j.error)||'intenta de nuevo');return;}
      if(!j.domain){msg.style.color='#67718A';msg.textContent='Dominio quitado. Su página sigue en su subdominio.';return;}
      var cfNote = j.render&&j.render.ok ? 'El certificado SSL se emite automáticamente cuando el DNS apunte.' : (j.render&&j.render.reason==='render_off' ? 'Falta RENDER_API_KEY/RENDER_SERVICE_ID en el servidor — agrega el dominio en Render a mano.' : 'Registro en Render pendiente — revisa el panel.');
      msg.style.color='#1E7B3C';
      msg.innerHTML='✓ Guardado. Pídele al cliente que agregue este registro en su dominio:<br><b>Tipo:</b> CNAME · <b>Nombre:</b> @ (o www) · <b>Destino:</b> '+j.cname_target+'<br><span style="color:#67718A">'+cfNote+'</span>';
    }).catch(function(){btn.disabled=false;btn.textContent='Conectar';msg.style.color='#9B1C10';msg.textContent='No se pudo — intenta de nuevo.';});
}
function buyDomain(d,price){
  var priceTxt=price?('$'+Number(price).toFixed(2)+'/año'):'el precio de costo';
  if(!confirm('¿Comprar '+d+' ahora por '+priceTxt+'? Se cobra a la cuenta de Cloudflare y no se puede deshacer.'))return;
  var msg=document.getElementById('dommsg');
  msg.style.color='#67718A';msg.textContent='Comprando '+d+'…';
  fetch('/api/onboarding/domain/buy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({slug:${JSON.stringify(c.slug)},domain:d})})
    .then(function(r){return r.json();}).then(function(j){
      if(!j||!j.ok){msg.style.color='#9B1C10';msg.textContent='Error: '+((j&&j.error)||'intenta de nuevo')+(j&&j.detail?' — '+JSON.stringify(j.detail):'');return;}
      document.getElementById('domain').value=j.domain;
      var dnsNote = j.dns&&j.dns.ok ? 'DNS listo' : 'DNS pendiente ('+((j.dns&&j.dns.reason)||'revisa Cloudflare')+')';
      var sslNote = j.render&&j.render.ok ? 'SSL en camino (Render, unos minutos)' : (j.render&&j.render.reason==='render_off' ? 'falta RENDER_API_KEY/RENDER_SERVICE_ID en el servidor' : 'SSL pendiente — agrega el dominio en Render');
      msg.style.color=(j.dns&&j.dns.ok&&j.render&&j.render.ok)?'#1E7B3C':'#8A6D00';
      msg.innerHTML='✓ '+j.domain+' comprado. '+dnsNote+' · '+sslNote+'.';
    }).catch(function(){msg.style.color='#9B1C10';msg.textContent='No se pudo comprar — intenta de nuevo.';});
}
function aiWrite(){
  var btn=document.getElementById('aibtn'),hint=document.getElementById('aihint');
  var rough=document.getElementById('rough').value.trim();
  if(!rough){hint.textContent='Escribe unas notas primero ↑';return;}
  btn.disabled=true;btn.textContent='✨ Escribiendo…';hint.textContent='';
  fetch('/api/onboarding/ai',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
    biz:document.getElementById('biz').value,city:document.getElementById('city').value,
    years:document.getElementById('years').value,rough:rough,trade:'${fenceC ? "fence" : "roofing"}'
  })}).then(function(r){return r.json();}).then(function(j){
    btn.disabled=false;btn.textContent='✨ Escribir con IA';
    if(j&&j.source==='live'){
      if(j.hero)document.getElementById('hero').value=j.hero;
      if(j.tagline)document.getElementById('tagline').value=j.tagline;
      if(j.about)document.getElementById('about').value=j.about;
      hint.style.color='#1E7B3C';hint.textContent='✓ Listo — revisa y edita';
    } else if(j&&j.error==='ai_off'){hint.style.color='#9B1C10';hint.textContent='La IA no está activa (falta API key).';}
    else{hint.style.color='#9B1C10';hint.textContent='No se pudo — intenta de nuevo o escríbelo a mano.';}
  }).catch(function(){btn.disabled=false;btn.textContent='✨ Escribir con IA';hint.style.color='#9B1C10';hint.textContent='No se pudo — intenta de nuevo.';});
}
var FAQ0=${JSON.stringify(Array.isArray(st.botTrain?.faqs) ? st.botTrain.faqs : []).replace(/</g, "\\u003c")};
var OB_CATS=[['botaddr','Dirección'],['bothours','Horarios'],['obt_financing','Financiamiento'],['obt_payments','Pago'],['obt_insurance','Aseguranza'],['obt_emergency','Emergencias'],['obt_languages','Idiomas'],['obt_promos','Promos']];
function obGo(id){var el=document.getElementById(id);el.scrollIntoView({block:'center',behavior:'smooth'});setTimeout(function(){el.focus()},250);}
function obChips(){
  var n=0,h='';
  OB_CATS.forEach(function(cat){
    var ok=!!document.getElementById(cat[0]).value.trim();if(ok)n++;
    h+='<span class="'+(ok?'y':'o')+'" onclick="obGo(\\''+cat[0]+'\\')" title="'+(ok?'entrenado — clic para editarlo':'sin entrenar — clic para llenarlo')+'">'+(ok?'✓ ':'')+cat[1]+'</span>';
  });
  var nf=document.querySelectorAll('#faqlist .obfaq').length;
  h+='<span class="'+(nf?'y':'o')+'">'+(nf?'✓ ':'')+nf+' pregunta'+(nf===1?'':'s')+'</span>';
  document.getElementById('ob_sum').innerHTML=h;
  document.getElementById('ob_count').textContent=n+'/8 temas · '+nf+' preguntas';
  document.getElementById('ob_bar').style.width=Math.round(((n+Math.min(nf,1))/9)*100)+'%';
}
function obAddFaq(q,a){
  var row=document.createElement('div');
  row.className='obfaq';
  row.innerHTML='<input class="fq" placeholder="Pregunta — ej. ¿Cobran por la inspección?"><input class="fa" placeholder="Respuesta oficial corta"><button type="button" title="Quitar" onclick="this.parentNode.remove();obChips()">✕</button>';
  row.querySelector('.fq').value=q||'';
  row.querySelector('.fa').value=a||'';
  document.getElementById('faqlist').appendChild(row);
  obChips();
}
FAQ0.forEach(function(f){obAddFaq(f.q,f.a)});
OB_CATS.forEach(function(cat){document.getElementById(cat[0]).addEventListener('input',obChips);});
obChips();
function obFaqs(){
  return [].map.call(document.querySelectorAll('#faqlist .obfaq'),function(r){
    return {q:r.querySelector('.fq').value.trim(),a:r.querySelector('.fa').value.trim()};
  }).filter(function(x){return x.q&&x.a});
}
function obTrain(){
  var g=function(id){return document.getElementById(id).value};
  return {addr:g('botaddr'),hours:g('bothours'),financing:g('obt_financing'),payments:g('obt_payments'),insurance:g('obt_insurance'),emergency:g('obt_emergency'),languages:g('obt_languages'),promos:g('obt_promos'),extra:g('obt_extra'),faqs:obFaqs()};
}
function obSaveBot(btn){
  btn.disabled=true;btn.textContent='…guardando';
  fetch('/api/cs/bottrain',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({slug:${JSON.stringify(c.slug)},train:obTrain()})})
  .then(function(r){return r.json()}).then(function(j){
    btn.disabled=false;
    if(j.ok){btn.textContent='✓ Entrenado';document.getElementById('obmsg').textContent='El bot ya contesta con esto — pruébalo →';setTimeout(function(){btn.textContent='💾 Guardar entrenamiento ahora'},2200);}
    else{btn.textContent='💾 Guardar entrenamiento ahora';alert('Error: '+(j.error||'no se pudo guardar'));}
  }).catch(function(){btn.disabled=false;btn.textContent='💾 Guardar entrenamiento ahora';alert('Error de red');});
}
function genFaq(){
  var btn=document.getElementById('faqgen');btn.disabled=true;btn.textContent='✨ Pensando…';
  var services=[];[].forEach.call(document.querySelectorAll('#services input:checked'),function(c){services.push(c.value);});
  fetch('/api/onboarding/botfaq',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
    biz:document.getElementById('biz').value,city:document.getElementById('city').value,
    area:document.getElementById('area').value,services:services,
    warranty:document.getElementById('warranty').value,diff:document.getElementById('diff').value,
    botAddr:document.getElementById('botaddr').value,botHours:document.getElementById('bothours').value,trade:'${fenceC ? "fence" : "roofing"}'
  })}).then(function(r){return r.json()}).then(function(j){
    btn.disabled=false;btn.textContent='✨ Generar preguntas con IA';
    if(!j||!j.faqs||!j.faqs.length){alert('No se pudo generar — agrégalas a mano.');return;}
    var have={};[].forEach.call(document.querySelectorAll('#faqlist .fq'),function(i){have[i.value.trim().toLowerCase()]=1;});
    j.faqs.forEach(function(f){if(!have[String(f.q).trim().toLowerCase()])obAddFaq(f.q,f.a);});
  }).catch(function(){btn.disabled=false;btn.textContent='✨ Generar preguntas con IA';alert('Error de red — intenta de nuevo');});
}
function save(){
  var btn=document.getElementById('save');btn.disabled=true;btn.textContent='Guardando…';
  var services=[];[].forEach.call(document.querySelectorAll('#services input:checked'),function(c){services.push(c.value);});
  fetch('/api/onboarding/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
    slug:${JSON.stringify(c.slug)},template:TPL,color:document.getElementById('color').value,
    biz:document.getElementById('biz').value,phone:document.getElementById('phone').value,
    city:document.getElementById('city').value,area:document.getElementById('area').value,
    years:document.getElementById('years').value,services:services,train:obTrain(),
    warranty:document.getElementById('warranty').value,diff:document.getElementById('diff').value,
    license:document.getElementById('license').value,hero:document.getElementById('hero').value,
    tagline:document.getElementById('tagline').value,about:document.getElementById('about').value,
    gmb:document.getElementById('gmb').value,
    facebook:document.getElementById('fb').value,instagram:document.getElementById('ig').value,
    logo:LOGO,photos:PHOTOS
  })}).then(function(r){return r.json();}).then(function(j){
    btn.disabled=false;btn.textContent='Enviar al equipo de diseño 🎨';
    var ok=document.getElementById('ok');
    if(j&&j.ok){
      ok.style.background='#EAF8EF';ok.style.borderColor='#34A853';ok.style.color='#1E7B3C';
      ok.innerHTML='🎉 ¡Listo! Su página quedó en manos del equipo de diseño — se la entregamos en 7–14 días.';
      ok.style.display='block';
      confetti();
      var wp=document.getElementById('wowprev');
      if(wp){wp.style.display='block';document.getElementById('wowframe').src='/site/'+${JSON.stringify(c.slug)}+'?preview=1';setTimeout(function(){wp.scrollIntoView({behavior:'smooth',block:'center'})},400);}
    }
    else{ok.style.background='#FDECEC';ok.style.borderColor='#D93025';ok.style.color='#9B1C10';ok.textContent='Error: '+((j&&j.error)||'intenta de nuevo');ok.style.display='block';}
  }).catch(function(){btn.disabled=false;btn.textContent='Enviar al equipo de diseño 🎨';});
}
// The closing moment deserves ceremony — a quick confetti burst on send.
function confetti(){
  var cols=['#F8B408','#B30F24','#1B6FB8','#1E7B3C','#E8540C','#5B2A86'];
  var box=document.createElement('div');
  box.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:9999;overflow:hidden';
  for(var i=0;i<44;i++){
    var p=document.createElement('i');
    p.style.cssText='position:absolute;top:-24px;width:10px;height:14px;border-radius:3px;opacity:.95;'
      +'left:'+(Math.random()*100)+'%;background:'+cols[i%cols.length]+';'
      +'animation:cfall '+(2.2+Math.random()*1.8)+'s ease-in '+(Math.random()*.8)+'s forwards;'
      +'transform:rotate('+Math.round(Math.random()*360)+'deg)';
    box.appendChild(p);
  }
  document.body.appendChild(box);
  setTimeout(function(){box.remove()},5200);
}
function publish(){
  var pub=document.getElementById('pub');pub.disabled=true;
  fetch('/api/onboarding/publish',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({slug:${JSON.stringify(c.slug)},publish:!PUBLISHED})})
    .then(function(r){return r.json();}).then(function(j){
      pub.disabled=false;
      if(j&&j.ok){PUBLISHED=j.published;
        pub.textContent=PUBLISHED?'✓ Publicada — clic para ocultar':'🚀 Publicar página al cliente';
        pub.style.background=PUBLISHED?'#1E7B3C':'#101B30';
      }
    }).catch(function(){pub.disabled=false;});
}
// Deep links can land on the review step before the later vars exist —
// re-run it now that everything is defined so the summary is complete.
if(STEP===MAX-1)review();
</script></body></html>`);
});

const normSocialUrl = (v, host) => {
  let s = String(v || "").trim();
  if (!s) return "";
  if (/^@?[A-Za-z0-9_.]{2,60}$/.test(s)) return `https://${host}/${s.replace(/^@/, "")}`;
  s = s.replace(/^http:\/\//, "https://");
  if (!s.startsWith("https://")) s = "https://" + s;
  return /^https:\/\/[^\s"'<>]{8,300}$/.test(s) ? s : "";
};

/* One composer for the bot's knowledge blob (site.botFacts) — the single
 * string the chat prompt reads. Both the onboarding save and the CS bot
 * trainer go through here so neither can clobber the other's training. */
function sanitizeTrain(t) {
  const S = (x, n) => String(x || "").replace(/\s+/g, " ").trim().slice(0, n);
  return {
    addr: S(t.addr, 160), hours: S(t.hours, 160), financing: S(t.financing, 200),
    payments: S(t.payments, 200), insurance: S(t.insurance, 200), emergency: S(t.emergency, 200),
    languages: S(t.languages, 120), promos: S(t.promos, 200), extra: S(t.extra, 400),
    faqs: (Array.isArray(t.faqs) ? t.faqs : []).map((f) => ({ q: S(f?.q, 120), a: S(f?.a, 250) })).filter((f) => f.q && f.a).slice(0, 10),
  };
}
function composeBotFacts(train) {
  const parts = [
    train.addr && `Oficina/dirección: ${train.addr}`,
    train.hours && `Horarios: ${train.hours}`,
    train.financing && `Financiamiento: ${train.financing}`,
    train.payments && `Formas de pago: ${train.payments}`,
    train.insurance && `Aseguranza/reclamos de seguro: ${train.insurance}`,
    train.emergency && `Emergencias/urgencias: ${train.emergency}`,
    train.languages && `Idiomas: ${train.languages}`,
    train.promos && `Promociones: ${train.promos}`,
    train.extra,
  ].filter(Boolean);
  const faqs = Array.isArray(train.faqs) ? train.faqs : [];
  const faqTxt = faqs.length ? ` Preguntas frecuentes (respuestas oficiales): ${faqs.map((f) => `P: ${f.q} R: ${f.a}`).join(" | ")}` : "";
  return (parts.join(". ") + (parts.length ? "." : "") + faqTxt).replace(/\.{2,}/g, ".").trim().slice(0, 1600);
}

app.post("/api/onboarding/save", async (req, res) => {
  if (!closerOk(req) && !csOk(req)) return res.status(403).json({ error: "no auth" });
  const b = req.body || {};
  const c = b.slug && (await db.getContractorBySlug(String(b.slug)));
  if (!c) return res.status(404).json({ error: "cliente no encontrado" });
  const data = { ...(c.data || {}) };
  data.profile = { ...(data.profile || {}) };
  if (b.biz) data.profile.biz = String(b.biz).slice(0, 80);
  if (b.phone != null) data.profile.phone = String(b.phone).replace(/\D/g, "").replace(/^1/, "").slice(0, 15);
  if (b.license != null) data.profile.license = String(b.license).slice(0, 40);
  if (typeof b.logo === "string" && /^data:image\/(png|jpeg);base64,/.test(b.logo) && b.logo.length < 220000) data.profile.logo = b.logo;
  // Bot fields: only the onboarding form sends botAddr/botHours (quick edit
  // no longer does — the bot has its own trainer). When they DO arrive and
  // the client has structured training, fold them into it and recompose the
  // whole knowledge blob so FAQs/categories survive an onboarding save.
  const sentBot = b.botAddr != null || b.botHours != null;
  const botAddr = sentBot ? String(b.botAddr || "").trim().slice(0, 120) : (data.site?.botAddr || "");
  const botHours = sentBot ? String(b.botHours || "").trim().slice(0, 120) : (data.site?.botHours || "");
  // The onboarding bot tab is the same full trainer as /cs — it sends the
  // whole `train` object, sharing sanitize + compose so nothing desyncs.
  const sentTrain = b.train && typeof b.train === "object";
  const sentFaqs = Array.isArray(b.faqs);
  const Sq = (x, n) => String(x || "").replace(/\s+/g, " ").trim().slice(0, n);
  const cleanFaqs = sentFaqs ? b.faqs.map((f) => ({ q: Sq(f?.q, 120), a: Sq(f?.a, 250) })).filter((f) => f.q && f.a).slice(0, 10) : null;
  let botTrain = data.site?.botTrain || null;
  let botAddr2 = botAddr, botHours2 = botHours;
  if (sentTrain) {
    botTrain = sanitizeTrain(b.train);
    botAddr2 = botTrain.addr; botHours2 = botTrain.hours;
  } else if (sentBot || sentFaqs) {
    botTrain = { ...(botTrain || {}), ...(sentBot ? { addr: botAddr, hours: botHours } : {}), ...(sentFaqs ? { faqs: cleanFaqs } : {}) };
  }
  const botFacts = (!sentTrain && !sentBot && !sentFaqs) ? (data.site?.botFacts || "")
    : botTrain ? composeBotFacts(botTrain)
    : (data.site?.botFacts || "");
  data.site = {
    ...(data.site || {}), // keep fields this form doesn't own (domain, publish flags, …)
    template: ["1", "2", "3"].includes(String(b.template)) ? String(b.template) : (data.site?.template || "1"),
    color: /^#?[a-f0-9]{6}$/i.test(String(b.color || "")) ? (String(b.color).startsWith("#") ? b.color : "#" + b.color) : (data.site?.color || "#B30F24"),
    city: String(b.city || "").slice(0, 80),
    area: String(b.area || "").slice(0, 200),
    years: b.years ? Math.max(0, Math.min(99, parseInt(b.years) || 0)) : null,
    services: Array.isArray(b.services) ? b.services.map((x) => String(x).slice(0, 60)).slice(0, 12) : (data.site?.services || []),
    warranty: String(b.warranty || "").slice(0, 120),
    diff: String(b.diff || "").slice(0, 300),
    tagline: String(b.tagline || "").slice(0, 300),
    hero: String(b.hero || "").slice(0, 160),
    about: String(b.about || "").slice(0, 1400),
    gmb: (() => { // Google review link — tolerate a pasted "g.page/…" without protocol
      let g = String(b.gmb || "").trim().replace(/^http:\/\//, "https://");
      if (g && !g.startsWith("https://")) g = "https://" + g;
      return /^https:\/\/[^\s"'<>]{8,300}$/.test(g) ? g : "";
    })(),
    // Social links for the site footer — accept a full URL, a pasted link
    // without protocol, or a bare @handle typed straight from the call.
    facebook: normSocialUrl(b.facebook, "facebook.com"),
    instagram: normSocialUrl(b.instagram, "instagram.com"),
    botAddr: botAddr2, botHours: botHours2, botFacts,
    ...(botTrain ? { botTrain } : {}),
    photos: Array.isArray(b.photos) ? b.photos.filter((u) => /^\/api\/logo\/[a-f0-9]{16}\.(png|jpg)$/.test(u)).slice(0, 8) : (data.site?.photos || []),
    published: data.site?.published === true, // saving keeps current publish state
  };
  // Patch only the two subtrees this form rebuilds; billing/state fields the
  // form never touches can't be clobbered by a concurrent Stripe write.
  await db.patchContractorData(c.id, { profile: data.profile, site: data.site });
  res.json({ ok: true, site: `/site/${c.slug}`, published: data.site.published });
});

/* Bot training (CS "Entrenamiento del bot"): structured categories + FAQs.
 * Stored as site.botTrain, and composed into the single botFacts blob the
 * chat prompt reads — so training here IS what the bot says. Also syncs
 * botAddr/botHours so the onboarding fields stay consistent. */
app.post("/api/cs/bottrain", async (req, res) => {
  if (!csOk(req) && !closerOk(req)) return res.status(403).json({ error: "no auth" });
  const b = req.body || {};
  const c = b.slug && (await db.getContractorBySlug(String(b.slug)));
  if (!c) return res.status(404).json({ error: "cliente no encontrado" });
  const train = sanitizeTrain(b.train || {});
  const facts = composeBotFacts(train);
  await db.patchContractorData(c.id, { site: { ...(c.data?.site || {}), botTrain: train, botFacts: facts, botAddr: train.addr, botHours: train.hours } });
  res.json({ ok: true, chars: facts.length, max: 1600 });
});

/* FAQ suggestions for the bot, generated DURING the onboarding call so the
 * rep can read them to the client — keep the ones they approve, ✕ the rest.
 * Uses only the facts the form already has; with no AI key it returns a
 * solid roofing starter pack personalized from the same facts. */
app.post("/api/onboarding/botfaq", async (req, res) => {
  if (!closerOk(req) && !csOk(req)) return res.status(403).json({ error: "no auth" });
  const b = req.body || {};
  const S = (x, n) => String(x || "").replace(/\s+/g, " ").trim().slice(0, n);
  const services = Array.isArray(b.services) ? b.services.map((x) => S(x, 40)).filter(Boolean) : [];
  const hasFin = services.some((s) => /financ/i.test(s));
  const zone = S(b.area, 80) || S(b.city, 60);
  const fenceB = b.trade === "fence";
  const fallback = [
    fenceB ? { q: "¿Cobran por la medición o el estimado?", a: "No — la medición y el estimado son completamente gratis." }
      : { q: "¿Cobran por la inspección o el estimado?", a: "No — la inspección y el estimado son completamente gratis." },
    { q: "¿Dan garantía?", a: b.warranty ? `Sí — ${S(b.warranty, 100)}.` : "Sí, damos garantía por escrito en mano de obra." },
    fenceB ? { q: "¿Qué materiales manejan?", a: services.length ? `Trabajamos ${services.slice(0, 4).join(", ").toLowerCase()} — le recomendamos el mejor para su patio y presupuesto.` : "Madera, vinilo y malla ciclónica — le recomendamos el mejor para su patio y presupuesto." }
      : { q: "¿Trabajan con reclamos de seguro (aseguranza)?", a: "Sí — le ayudamos con el proceso del reclamo con su aseguranza." },
    { q: "¿Ofrecen financiamiento?", a: hasFin ? "Sí, ofrecemos financiamiento con pagos mensuales — en su llamada le explicamos las opciones." : "Pregúntenos en su llamada y le confirmamos las opciones de pago." },
    { q: "¿En qué zonas trabajan?", a: zone ? `Trabajamos en ${zone} y alrededores.` : "Trabajamos en toda la zona local — déjenos su dirección y le confirmamos." },
    { q: "¿Qué tan rápido responden?", a: "El mismo día — deje su nombre y teléfono aquí en el chat y el equipo le llama." },
  ];
  if (!aiLive) return res.json({ ok: true, source: "demo", faqs: fallback });
  const facts = [
    b.biz && `Negocio: ${S(b.biz, 80)}`,
    zone && `Zona: ${zone}`,
    services.length && `Servicios: ${services.join(", ")}`,
    b.warranty && `Garantía: ${S(b.warranty, 120)}`,
    b.diff && `Los diferencia: ${S(b.diff, 200)}`,
    b.botAddr && `Oficina: ${S(b.botAddr, 120)}`,
    b.botHours && `Horarios: ${S(b.botHours, 120)}`,
  ].filter(Boolean).join("\n");
  try {
    const raw = await aiChat({
      maxTokens: 700,
      system: `Eres el asistente de una compañía de ${fenceB ? "cercas" : "techos"} hispana en Texas. Con los datos que te doy, escribe las 6 preguntas más frecuentes que un dueño de casa haría por chat, con su respuesta oficial corta (máx 30 palabras), en español sencillo y cálido. NO inventes datos que no te di (precios, marcas, tiempos exactos): si el dato no está, la respuesta debe ofrecer confirmarlo por teléfono. Nunca prometas precios ni citas con hora. Responde SOLO con un arreglo JSON: [{"q":"…","a":"…"}] — sin markdown.`,
      messages: [{ role: "user", content: facts || `Compañía de ${fenceB ? "cercas" : "techos"} local, sin datos extra.` }],
    });
    const arr = JSON.parse(raw.match(/\[[\s\S]*\]/)?.[0] || "[]");
    const faqs = (Array.isArray(arr) ? arr : []).map((f) => ({ q: S(f?.q, 120), a: S(f?.a, 250) })).filter((f) => f.q && f.a).slice(0, 8);
    res.json({ ok: true, source: "live", faqs: faqs.length ? faqs : fallback });
  } catch { res.json({ ok: true, source: "demo", faqs: fallback }); }
});

// AI copywriter: turn the staff's rough facts + story into polished Spanish
// website copy. Suggestion only — staff reviews/edits before saving.
app.post("/api/onboarding/ai", async (req, res) => {
  if (!closerOk(req) && !csOk(req)) return res.status(403).json({ error: "no auth" });
  const b = req.body || {};
  const facts = [
    b.biz ? `Negocio: ${b.biz}` : "",
    b.city ? `Ciudad/área: ${b.city}` : "",
    b.years ? `Años en el negocio: ${b.years}` : "",
    b.rough ? `Notas del contratista: ${b.rough}` : "",
  ].filter(Boolean).join("\n").slice(0, 1000);
  if (!facts) return res.status(400).json({ error: "faltan datos" });
  if (!aiLive) return res.json({ source: "demo", error: "ai_off" });
  try {
    const raw = await aiChat({
      maxTokens: 400,
      system: `Eres redactor publicitario de una compañía de ${req.body?.trade === "fence" ? "cercas (fencing)" : "techos (roofing)"} hispana en Texas. Con los datos que te doy, escribe el texto de su página web en español, cálido y confiable, sin exagerar ni inventar datos que no te dieron. Responde SOLO con un objeto JSON: {"hero": titular corto y fuerte (máx 6 palabras), "tagline": una frase de apoyo (máx 18 palabras), "about": párrafo de "nuestra historia" en 2-3 oraciones, en primera persona del negocio}. Nada de markdown, nada de comillas tipográficas.`,
      messages: [{ role: "user", content: facts }],
    });
    const j = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || "{}");
    res.json({
      source: "live",
      hero: String(j.hero || "").slice(0, 120),
      tagline: String(j.tagline || "").slice(0, 200),
      about: String(j.about || "").slice(0, 800),
    });
  } catch (e) {
    console.error("onboarding ai failed:", e.message);
    res.status(502).json({ error: "ai_failed" });
  }
});

// Check domain availability (RDAP) so clients can pick a name on the call.
function domainCandidates(input) {
  const raw = String(input || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*/, "");
  if (/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(raw)) return [raw]; // full domain given
  const base = raw.replace(/[^a-z0-9]/g, "");
  if (!base || base.length < 2) return [];
  const variations = [base + ".com", base + ".net", base + ".co", "get" + base + ".com"];
  variations.push(base.includes("roofing") ? base + "tx.com" : base + "roofing.com");
  return variations.filter((d, i, a) => a.indexOf(d) === i).slice(0, 6);
}
async function rdapAvailable(domain) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4500);
    const r = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, { signal: ctrl.signal, redirect: "follow" });
    clearTimeout(t);
    if (r.status === 404) return "available";
    if (r.status === 200) return "taken";
    return "unknown";
  } catch { return "unknown"; }
}
app.get("/api/onboarding/domaincheck", async (req, res) => {
  if (!closerOk(req) && !csOk(req)) return res.status(403).json({ error: "no auth" });
  const ip = clientIp(req);
  if (overQuota(`dchk:${ip}`, 60)) return res.status(429).json({ error: "quota" });
  const cands = domainCandidates(req.query.name);
  if (!cands.length) return res.status(400).json({ error: "escribe un nombre" });
  // Cloudflare's own check gives real price + availability for all candidates
  // in one batched call; fall back to the free RDAP lookup (availability only,
  // no price, no buy button) when Cloudflare Registrar isn't configured yet or
  // for extensions the Registrar API doesn't cover.
  const cf = await cfCheckDomains(cands);
  const results = await Promise.all(cands.map(async (d) => {
    const row = cf.ok ? cf.map[d] : null;
    if (row) return { domain: d, status: row.available ? "available" : "taken", price: row.price, currency: row.currency, canBuy: row.available };
    return { domain: d, status: await rdapAvailable(d), canBuy: false };
  }));
  res.json({ ok: true, results });
});

// Buy a domain outright via Cloudflare Registrar, then connect it (same SSL
// step as the manual "conectar" flow below). Registered under OUR account —
// see the note above cfRegisterDomain for why.
app.post("/api/onboarding/domain/buy", async (req, res) => {
  // Buying a domain spends real money on the Cloudflare billing account —
  // admin only. Connecting an already-owned domain stays closer/cs (no charge).
  if (!adminOk(req)) return res.status(403).json({ error: "solo admin puede comprar dominios" });
  const c = req.body?.slug && (await db.getContractorBySlug(String(req.body.slug)));
  if (!c) return res.status(404).json({ error: "cliente no encontrado" });
  const domain = String(req.body?.domain || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
  if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(domain) || domain.length > 80) return res.status(400).json({ error: "dominio no válido" });
  if (domain.endsWith(".alto-pro.com")) return res.status(400).json({ error: "ese es un subdominio nuestro, no un dominio propio" });

  // Resumable purchase: each step's outcome is checkpointed in kv, so if DNS
  // or Render fails after the money was spent (or the process restarts
  // mid-flight), re-clicking "Comprar" resumes from the record — it re-runs
  // ONLY the steps that haven't succeeded and never re-buys a purchased
  // domain. The steps themselves are idempotent too (dup-CNAME codes and
  // Render 409 count as ok), so a resume can't double-create anything.
  const stKey = `dombuy:${domain}`;
  const prior = await db.kvGet(stKey).catch(() => null);
  const state = prior && typeof prior === "object" ? { ...prior } : { domain, slug: c.slug, startedAt: new Date().toISOString() };

  if (!state.purchase?.ok) {
    state.purchase = await cfRegisterDomain(domain);
    await db.kvSet(stKey, state).catch(() => {});
    if (!state.purchase.ok) return res.status(502).json({ error: "no se pudo comprar el dominio", detail: state.purchase });
  }

  await db.patchContractorData(c.id, { site: { ...(c.data?.site || {}), domain } });
  // Serve it: DNS records in the new zone → Render, then register the domain
  // with Render so it routes the host and issues the SSL cert.
  if (!state.dns?.ok) state.dns = await cfPointZoneAtRender(domain);
  if (!state.render?.ok) state.render = await renderAddDomain(domain);
  state.done = !!(state.purchase.ok && state.dns.ok && state.render.ok);
  state.updatedAt = new Date().toISOString();
  await db.kvSet(stKey, state).catch(() => {});
  res.json({ ok: true, domain, purchase: state.purchase, dns: state.dns, render: state.render, resumed: !!prior, done: state.done });
});

// Connect a client's own domain (Cloudflare for SaaS). Saves it, registers
// the custom hostname, and returns the CNAME the client must add.
app.post("/api/onboarding/domain", async (req, res) => {
  if (!closerOk(req) && !csOk(req)) return res.status(403).json({ error: "no auth" });
  const c = req.body?.slug && (await db.getContractorBySlug(String(req.body.slug)));
  if (!c) return res.status(404).json({ error: "cliente no encontrado" });
  let domain = String(req.body.domain || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
  if (req.body.domain === "") { // clearing it
    const site = { ...(c.data?.site || {}) }; delete site.domain;
    await db.patchContractorData(c.id, { site });
    return res.json({ ok: true, domain: null });
  }
  if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(domain) || domain.length > 80) return res.status(400).json({ error: "dominio no válido" });
  if (domain.endsWith(".alto-pro.com")) return res.status(400).json({ error: "ese es un subdominio nuestro, no un dominio propio" });
  await db.patchContractorData(c.id, { site: { ...(c.data?.site || {}), domain } });
  // Render must know the hostname to route it + issue its cert; the client
  // still has to point their DNS (CNAME → CF_CNAME_TARGET) on their side.
  const render = await renderAddDomain(domain);
  const cf = await cfAddHostname(domain); // legacy CF-for-SaaS path, harmless no-op when unset
  res.json({ ok: true, domain, cname_target: CF_CNAME_TARGET, cf, render });
});

// Reveal/unpublish a client's site (staff controls the "unveiling" moment)
app.post("/api/onboarding/publish", async (req, res) => {
  if (!closerOk(req) && !csOk(req)) return res.status(403).json({ error: "no auth" });
  const c = req.body?.slug && (await db.getContractorBySlug(String(req.body.slug)));
  if (!c) return res.status(404).json({ error: "cliente no encontrado" });
  const published = req.body.publish !== false;
  await db.patchContractorData(c.id, { site: { ...(c.data?.site || {}), published } });
  res.json({ ok: true, published });
});

/* ── Team onboarding deck (/equipo) — shown to a new content+closer hire ──
 * Explains the offer, the audience, his two roles (closer + content), and
 * the exact content shot-list. Unlisted, no login (safe to screen-share). */
/* ── Team onboarding deck (/equipo) — shown to a new content+closer hire ──
 * Showcase version: live website mockups, live app, live cotizador — the
 * actual products he sells and films. Unlisted, no login. */
app.get("/equipo", (req, res) => {
  const base = canonBase(req);
  res.send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ALTO Pro · Equipo</title><link rel="icon" href="/icon-192.png"><style>
@import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,600;0,9..144,700;1,9..144,600&family=Inter:wght@400;500;600;700;800&display=swap');
*{box-sizing:border-box;font-family:Inter,Arial,sans-serif;margin:0;-webkit-tap-highlight-color:transparent}
:root{--navy:#101B30;--navy2:#0B1226;--gold:#F8B408;--mut:#9DA8C4;--line:rgba(255,255,255,.1)}
body{background:var(--navy2);color:#fff;overflow:hidden}
.layout{display:flex;height:100vh;height:100dvh}
aside{width:260px;background:#fff;border-right:1px solid #E9EAEE;display:flex;flex-direction:column;flex-shrink:0}
.sb-brand{display:flex;justify-content:center;padding:24px 18px 14px}.sb-brand img{height:54px}
.sb-label{font-size:10px;letter-spacing:2.5px;color:#9AA0AC;font-weight:800;padding:8px 18px 6px}
nav{flex:1;overflow-y:auto;display:flex;flex-direction:column}
.nav-it{flex:1;display:flex;align-items:center;gap:12px;background:none;border:none;color:#6A7384;font-weight:700;font-size:14.5px;padding:0 20px;cursor:pointer;text-align:left;border-left:4px solid transparent;min-height:42px}
.nav-it .no{font-family:'Fraunces',Georgia,serif;font-size:12px;color:#B6BCC8;width:20px}
.nav-it.on{color:#101B30;background:rgba(248,180,8,.13);border-left-color:var(--gold)}
.nav-it.on .no{color:#D99E00}
.sb-foot{padding:13px 18px;font-size:11px;color:#9AA0AC;font-weight:700;border-top:1px solid #E9EAEE}
main{flex:1;position:relative;display:flex;flex-direction:column;min-width:0}
.stage{flex:1;position:relative;overflow:hidden}
.slide{position:absolute;inset:0;display:none;flex-direction:column;overflow-y:auto}
.slide.on{display:flex}
.s-bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.32;filter:saturate(.6)}
.s-veil{position:absolute;inset:0;background:linear-gradient(160deg,rgba(11,18,38,.96) 0%,rgba(16,27,48,.85) 55%,rgba(16,27,48,.6) 100%)}
.s-in{position:relative;flex:1;display:flex;flex-direction:column;justify-content:center;padding:clamp(26px,5vw,70px);max-width:1180px}
.kick{color:var(--gold);font-weight:800;font-size:12px;letter-spacing:3.5px;margin-bottom:16px;text-transform:uppercase}
h1{font-family:'Fraunces',Georgia,serif;font-size:clamp(30px,4.6vw,56px);line-height:1.05;font-weight:700;max-width:760px}
h1 em{font-style:italic;color:var(--gold)}
.rule{width:54px;height:4px;background:var(--gold);border-radius:2px;margin:20px 0}
.body{color:var(--mut);font-weight:500;font-size:clamp(15px,1.8vw,18px);line-height:1.7;max-width:580px}
ul.pts{list-style:none;padding:0;margin:20px 0 0;max-width:720px}
ul.pts li{padding:12px 0;border-bottom:1px solid var(--line);font-weight:600;font-size:clamp(14px,1.8vw,17px);line-height:1.55;color:#E7ECF6;display:flex;gap:14px}
ul.pts li b{color:var(--gold);flex-shrink:0}
.grid{display:grid;gap:14px;margin-top:22px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));max-width:920px}
.card{background:rgba(255,255,255,.05);border:1px solid var(--line);border-radius:18px;padding:20px}
.card .ic{font-size:28px}.card h3{font-family:'Fraunces',Georgia,serif;font-size:18px;margin:8px 0 6px}
.card p{color:var(--mut);font-size:13px;font-weight:500;line-height:1.55}
.glass{display:flex;gap:clamp(18px,4vw,52px);background:rgba(255,255,255,.06);border:1px solid var(--line);border-radius:18px;padding:18px 26px;margin-top:26px;width:fit-content;flex-wrap:wrap}
.glass b{font-family:'Fraunces',Georgia,serif;font-size:clamp(22px,2.6vw,32px);color:var(--gold);display:block;font-weight:700}
.glass span{font-size:11px;letter-spacing:1.5px;color:#C9D2E5;font-weight:700;text-transform:uppercase}
.link{display:inline-block;margin:8px 8px 0 0;background:var(--gold);color:var(--navy);font-weight:800;font-size:14px;padding:12px 20px;border-radius:11px;text-decoration:none}
.link.ghost{background:transparent;color:#fff;border:1.5px solid rgba(255,255,255,.3)}
.duo{display:grid;gap:38px;align-items:center;margin-top:8px}
@media(min-width:980px){.duo{grid-template-columns:1fr auto}}
.devices{display:flex;align-items:center;gap:30px;flex-wrap:wrap;margin-top:10px}
.webframe{background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.5);width:min(560px,100%)}
.webframe .bar{display:flex;align-items:center;gap:6px;background:#E9EAEE;padding:8px 12px}
.webframe .dot{width:9px;height:9px;border-radius:50%;background:#C9CDD6}
.webframe .url{flex:1;background:#fff;border-radius:7px;font-size:11px;color:#5E6470;font-weight:600;padding:4px 10px;margin-left:8px}
.dscr{width:100%;height:400px;overflow:hidden}
.dscr iframe{width:1180px;height:846px;border:0;transform:scale(.474);transform-origin:0 0;display:block;background:#fff}
.iphone{position:relative;background:#0B1226;border:9px solid #1E2A45;border-radius:44px;padding:10px;box-shadow:0 30px 80px rgba(0,0,0,.55)}
.inotch{position:absolute;top:10px;left:50%;transform:translateX(-50%);width:100px;height:20px;background:#1E2A45;border-radius:0 0 12px 12px;z-index:2}
.mscr{width:300px;height:600px;overflow:hidden;border-radius:30px}
.mscr iframe{width:390px;height:780px;border:0;transform:scale(.769);transform-origin:0 0;background:#fff}
.frame{background:#fff;border-radius:20px;padding:8px;width:min(380px,100%);box-shadow:0 30px 80px rgba(0,0,0,.5)}
.frame iframe{width:100%;height:min(54vh,500px);border:0;border-radius:14px;display:block;background:#F4F6FA}
.bbar{display:flex;align-items:center;justify-content:space-between;padding:14px clamp(16px,3vw,30px);border-top:1px solid var(--line);background:var(--navy)}
.bbar button{border-radius:11px;font-weight:800;font-size:14px;padding:12px 22px;cursor:pointer}
.bbar .prev{background:transparent;color:#fff;border:1.5px solid rgba(255,255,255,.25)}
.bbar .next{background:var(--gold);color:var(--navy);border:none}
.bbar .ct{font-family:'Fraunces',Georgia,serif;font-size:15px;color:var(--mut)}
.mtop{display:none;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--navy);border-bottom:1px solid var(--line)}
.mtop button{background:none;border:1.5px solid rgba(255,255,255,.25);color:#fff;border-radius:10px;padding:8px 14px;font-weight:800;font-size:13px;cursor:pointer}
@media(max-width:899px){aside{position:fixed;z-index:60;left:0;top:0;bottom:0;transform:translateX(-100%);transition:.25s;width:250px}aside.open{transform:none}.mtop{display:flex}.scrim{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:55;display:none}.scrim.on{display:block}}
</style></head><body>
<div class="layout">
<aside id="sb"><div class="sb-brand"><img src="/brand-logo.png" alt=""></div><div class="sb-label">ALTO PRO</div><nav id="nav"></nav><div class="sb-foot">Presentación del rol</div></aside>
<div class="scrim" id="scrim" onclick="sb(false)"></div>
<main>
<div class="mtop"><button onclick="sb(true)">☰ Menú</button><b style="font-weight:800">ALTO <span style="color:#F8B408">PRO</span></b><span style="width:64px"></span></div>
<div class="stage" id="stage">

<section class="slide" data-t="El rol">
  <img class="s-bg" src="/api/roofimg?lat=26.3828&lng=-98.8198&zoom=17" alt=""><div class="s-veil"></div>
  <div class="s-in">
    <p class="kick">ALTO PRO · MARKETING Y TECNOLOGÍA PARA ROFEROS</p>
    <h1>Dos trabajos, <em>un solo rol.</em></h1>
    <div class="rule"></div>
    <p class="body">El rol combina dos cosas: <b style="color:#fff">cerrar ventas</b> y <b style="color:#fff">crear el contenido</b> que trae esos clientes. En esta presentación vas a ver, en vivo, los productos que venderías y grabarías.</p>
  </div>
</section>

<section class="slide" data-t="A quién le vendes">
  <div class="s-veil"></div>
  <div class="s-in">
    <p class="kick">01 · A QUIÉN LE VENDES</p>
    <h1>Contratistas hispanos <em>de techos.</em></h1>
    <div class="rule"></div>
    <ul class="pts">
      <li><b>🇲🇽</b> Hablan español, trabajan con las manos, odian la tecnología complicada</li>
      <li><b>📞</b> Consiguen trabajo por recomendación — pero pierden llamadas cuando están en un techo</li>
      <li><b>💵</b> Un techo les deja $2,000–$4,000 de ganancia — tienen con qué pagar</li>
      <li><b>🎯</b> Empezamos SOLO con roferos — enfocados</li>
    </ul>
    <p class="body" style="margin-top:16px"><b style="color:var(--gold)">Háblales como un amigo que entiende su negocio — no como vendedor de tecnología.</b></p>
  </div>
</section>

<section class="slide" data-t="Qué vendemos">
  <div class="s-veil"></div>
  <div class="s-in">
    <p class="kick">02 · QUÉ VENDEMOS</p>
    <h1>Una máquina que <em>trae trabajos.</em></h1>
    <div class="rule"></div>
    <div class="grid">
      <div class="card"><div class="ic">🌐</div><h3>Página web</h3><p>Profesional, con su marca. Lista en 7-14 días.</p></div>
      <div class="card"><div class="ic">🛰️</div><h3>Cotizador satelital</h3><p>El cliente pone su dirección y ve su precio en 60 seg.</p></div>
      <div class="card"><div class="ic">📲</div><h3>La app ALTO Pro</h3><p>Mide techos, hace facturas, recibe los leads.</p></div>
      <div class="card"><div class="ic">🤖</div><h3>Chat con IA</h3><p>Contesta en tu página a cualquier hora y capta el teléfono del cliente.</p></div>
    </div>
    <div class="glass"><div><b>3 planes</b><span>$67 · $197 · $297 /mes</span></div><div><b>$0</b><span>cargo de inicio</span></div></div>
  </div>
</section>

<section class="slide" data-t="La página (en vivo)">
  <div class="s-veil"></div>
  <div class="s-in">
    <p class="kick">03 · SU PÁGINA WEB · EN VIVO</p>
    <h1>Esto es lo que <em>reciben.</em></h1>
    <p class="body" style="margin-top:12px">Se ve perfecta en computadora y celular. Esto es lo que vas a mostrar en tus videos — haz scroll, está viva.</p>
    <div class="devices">
      <div class="webframe"><div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="url">tunegocio.com</span></div><div class="dscr"><iframe data-src="/ejemplo?embed=1" title="Web"></iframe></div></div>
      <div class="iphone"><div class="inotch"></div><div class="mscr"><iframe data-src="/ejemplo?embed=1" title="Móvil"></iframe></div></div>
    </div>
  </div>
</section>

<section class="slide" data-t="El cotizador (wow)">
  <div class="s-veil"></div>
  <div class="s-in" style="max-width:1000px">
    <p class="kick">04 · EL COTIZADOR · EL WOW</p>
    <h1>Pon una <em>dirección.</em></h1>
    <div class="duo">
      <div>
        <p class="body">El momento "wow" de toda la venta. Escribe una dirección real y mira cómo el satélite mide el techo y da un precio. ESTO es lo que grabas para los anuncios.</p>
        <a class="link" href="/demo" target="_blank">Ver la presentación de venta →</a>
      </div>
      <div class="frame"><iframe data-src="/w/alto-demo" title="Cotizador"></iframe></div>
    </div>
  </div>
</section>

<section class="slide" data-t="La app (en vivo)">
  <div class="s-veil"></div>
  <div class="s-in" style="max-width:1000px">
    <p class="kick">05 · LA APP · EN VIVO</p>
    <h1>Su oficina, <em>en el bolsillo.</em></h1>
    <div class="duo">
      <div>
        <ul class="pts" style="margin-top:0">
          <li><b>🛰️</b> Mide techos: dirección, GPS, o con el dedo</li>
          <li><b>📥</b> Los leads le llegan con botón de WhatsApp</li>
          <li><b>🧾</b> Cotizaciones y facturas con su marca</li>
        </ul>
        <p class="body" style="font-size:14px;margin-top:14px">👉 La app de la derecha está EN VIVO — tócala.</p>
      </div>
      <div class="iphone"><div class="inotch"></div><div class="mscr"><iframe data-src="/?demo=roof&clean=1" title="App"></iframe></div></div>
    </div>
  </div>
</section>

<section class="slide" data-t="Tu rol: Closer">
  <div class="s-veil"></div>
  <div class="s-in">
    <p class="kick">06 · TU PRIMER TRABAJO · CERRAR</p>
    <h1>Cómo <em>cierras.</em></h1>
    <div class="rule"></div>
    <ul class="pts">
      <li><b>1</b> El prospecto agenda una llamada (de los anuncios que TÚ grabas)</li>
      <li><b>2</b> Compartes pantalla y caminas la presentación: <b style="color:#fff">/demo</b></li>
      <li><b>3</b> En vivo pones SU dirección y le mides SU techo — ahí cambia todo</li>
      <li><b>4</b> Le mandas el link de pago y cierras en la misma llamada</li>
    </ul>
    <p class="body" style="margin-top:14px">Tu portal privado tiene el guion, los links y las respuestas a objeciones:</p>
    <a class="link" href="/closer" target="_blank">Abrir el portal del closer →</a>
  </div>
</section>

<section class="slide" data-t="Tu rol: Contenido">
  <div class="s-veil"></div>
  <div class="s-in" style="max-width:1000px">
    <p class="kick">07 · TU SEGUNDO TRABAJO · CONTENIDO</p>
    <h1>El contenido que <em>trae clientes.</em></h1>
    <div class="rule"></div>
    <p class="body">Corremos anuncios en WhatsApp e Instagram/Facebook, en español, para roferos. Tu contenido es el motor del negocio.</p>
    <div class="grid">
      <div class="card"><div class="ic">🎬</div><h3>Anuncios cortos (9:16)</h3><p>15-40 seg para WhatsApp/Reels. Hook fuerte en los primeros 3 seg.</p></div>
      <div class="card"><div class="ic">🎥</div><h3>VSL (1-2 min)</h3><p>Video para la página explicando la oferta — tú a cámara, directo.</p></div>
      <div class="card"><div class="ic">📱</div><h3>Grabación de pantalla</h3><p>Midiendo un techo en 60 seg — el wow en video.</p></div>
      <div class="card"><div class="ic">📸</div><h3>Fotos del equipo</h3><p>Tú y el equipo con la camisa ALTO en un techo real.</p></div>
    </div>
  </div>
</section>

<section class="slide" data-t="Lista de contenido">
  <div class="s-veil"></div>
  <div class="s-in" style="max-width:1000px">
    <p class="kick">08 · TUS PRIMEROS VIDEOS</p>
    <h1>Lista para <em>grabar ya.</em></h1>
    <ul class="pts">
      <li><b>🎯</b> "¿Cuántos trabajos pierdes mientras estás arriba de un techo?" — hook de dolor, a cámara</li>
      <li><b>🛰️</b> "Mira cómo cotizo un techo en 60 segundos sin subirme" — grabación de pantalla</li>
      <li><b>💬</b> "Tus clientes te llegan directo al WhatsApp" — muestra el lead llegando</li>
      <li><b>🌐</b> "Tu página web vende sola, 24/7" — muestra la página de ejemplo</li>
      <li><b>🤖</b> "Un asistente con IA en su página que nunca duerme" — muestra el chat contestando</li>
    </ul>
    <p class="body" style="margin-top:12px">Regla de oro: <b style="color:#fff">habla como rofero, no como tecnología.</b></p>
  </div>
</section>

<section class="slide" data-t="Empecemos">
  <img class="s-bg" src="/api/roofimg?lat=26.3828&lng=-98.8198&zoom=18" alt=""><div class="s-veil"></div>
  <div class="s-in">
    <p class="kick">09 · EMPECEMOS</p>
    <h1>Manos a la <em>obra.</em></h1>
    <div class="rule"></div>
    <ul class="pts">
      <li><b>1</b> Explora la presentación de venta y el portal del closer</li>
      <li><b>2</b> Graba los primeros 3 anuncios de la lista esta semana</li>
      <li><b>3</b> Agenda la foto del equipo con la camisa ALTO</li>
    </ul>
    <div style="margin-top:20px">
      <a class="link" href="/demo" target="_blank">/demo · venta</a>
      <a class="link ghost" href="/closer" target="_blank">/closer · portal</a>
      <a class="link ghost" href="/ventas" target="_blank">/ventas · la página</a>
      <a class="link ghost" href="/plantillas" target="_blank">/plantillas</a>
    </div>
  </div>
</section>

</div>
<div class="bbar"><div><button class="prev" onclick="go(-1)">‹ Anterior</button> <button class="next" onclick="go(1)">Siguiente ›</button></div><span class="ct" id="ct">1 / 10</span></div>
</main></div>
<script>
var slides=[].slice.call(document.querySelectorAll('.slide')),cur=0,nav=document.getElementById('nav');
slides.forEach(function(s,i){var b=document.createElement('button');b.className='nav-it';b.innerHTML='<span class="no">'+String(i+1).padStart(2,'0')+'</span>'+s.dataset.t;b.onclick=function(){show(i);sb(false)};nav.appendChild(b);});
function show(i){cur=Math.max(0,Math.min(slides.length-1,i));slides.forEach(function(s,k){s.classList.toggle('on',k===cur)});[].slice.call(nav.children).forEach(function(b,k){b.classList.toggle('on',k===cur)});document.getElementById('ct').textContent=(cur+1)+' / '+slides.length;[].slice.call(slides[cur].querySelectorAll('iframe[data-src]')).forEach(function(f){if(!f.src)f.src=f.dataset.src});location.hash=cur+1;}
function go(d){show(cur+d)}
function sb(o){document.getElementById('sb').classList.toggle('open',o);document.getElementById('scrim').classList.toggle('on',o)}
document.addEventListener('keydown',function(e){if(e.key==='ArrowRight')go(1);if(e.key==='ArrowLeft')go(-1)});
show(parseInt(location.hash.slice(1))-1||0);
</script>
</body></html>`);
});


/* ── Sales presentation (/demo — used AFTER a call is booked) ──
 * Full-screen slides the closer walks through with the prospect: who we
 * are → the problem → live demo → the app → what's included → price →
 * close, ending with copy-paste links to send during the call. */
// Closer: crear cliente nuevo + access link (no other admin powers)
// Closer logs a meeting / marks its outcome (visible to admin too)
app.post("/api/closer/meeting", async (req, res) => {
  if (!closerOk(req)) return res.status(403).json({ error: "no auth" });
  const name = String(req.body?.name || "").slice(0, 80);
  const phone = String(req.body?.phone || "").replace(/\D/g, "").slice(0, 15);
  if (!name && !phone) return res.status(400).json({ error: "falta nombre o teléfono" });
  const id = await db.addMeeting({ name, phone });
  res.json({ ok: true, id });
});
app.post("/api/closer/meeting/:id", async (req, res) => {
  if (!closerOk(req)) return res.status(403).json({ error: "no auth" });
  const id = String(req.params.id);
  if (typeof req.body?.outcome === "string") {
    const outcome = ["scheduled", "no_show", "showed", "closed", "not_interested", "follow_up"].includes(req.body.outcome) ? req.body.outcome : "scheduled";
    await db.setMeetingOutcome(id, outcome);
  }
  if (typeof req.body?.note === "string") {
    await db.setMeetingNote(id, req.body.note.slice(0, 500));
  }
  res.json({ ok: true });
});

/* Inbound lead from the sales WhatsApp bot (HighLevel webhook).
 * Secured by HL_WEBHOOK_SECRET so only your HighLevel can post.
 * Creates a sales lead tagged with its channel (whatsapp/instagram/…),
 * shows in the Leads de venta panel, and buzzes the phone. */
app.post("/api/hl/lead", async (req, res) => {
  const secret = process.env.HL_WEBHOOK_SECRET || "";
  const got = String(req.query.key || req.get("x-alto-key") || req.body?.key || "");
  if (!secret || got !== secret) return res.status(403).json({ error: "no auth" });
  const b = req.body || {};
  const c = b.contact && typeof b.contact === "object" ? b.contact : {};
  const cd = b.customData && typeof b.customData === "object" ? b.customData : {};
  const name = String(b.name || b.full_name || c.full_name || c.name || b.first_name || "").slice(0, 80);
  const phone = String(b.phone || b.phone_number || c.phone || b.number || "").replace(/\D/g, "").slice(0, 15);
  const channel = String(cd.channel || b.channel || b.source || c.source || "chat").toLowerCase().slice(0, 40);
  const note = String(cd.note || b.note || b.message || "").slice(0, 300);
  if (!name && !phone) return res.status(400).json({ error: "missing name/phone" });
  const av = await db.getContractorBySlug("alto-ventas");
  if (!av) return res.status(500).json({ error: "cuenta de ventas no existe" });
  // de-dupe: same phone already logged in the last 24h → don't create a twin
  // (GHL fires Contact Created once, but manual re-triggers happen)
  const last10 = (x) => String(x || "").replace(/\D/g, "").slice(-10);
  try {
    const recent = await db.listLeads(av.id);
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const dup = recent.find((l) => phone && last10(l.phone) === last10(phone) && new Date(l.created_at).getTime() > cutoff);
    if (dup) return res.json({ ok: true, deduped: true, id: dup.id });
  } catch { /* fall through and create it */ }
  // Atomic claim closes the race the read above can't: two simultaneous
  // webhooks for the same phone both pass listLeads (neither sees the other's
  // lead yet). incrCounter is a single atomic UPSERT — the first request gets
  // 1 and creates; the in-flight twin gets 2 and defers to it. Day-keyed, and
  // the 24h read-check above still covers the midnight boundary.
  if (phone) {
    const claim = await db.incrCounter(`hlk:${last10(phone)}:${new Date().toISOString().slice(0, 10)}`).catch(() => 1);
    if (claim > 1) return res.json({ ok: true, deduped: true });
  }
  const id = await db.addLead(av.id, { name, phone, info: { src: channel, ...(note ? { note } : {}) } });
  notifyLead(av, { id, name, phone, address: "" }).catch(() => {});
  res.json({ ok: true, id });
});

app.post("/api/closer/contractors", async (req, res) => {
  if (!closerOk(req)) return res.status(403).send("Clave incorrecta.");
  const { name, phone } = req.body || {};
  if (!name) return res.status(400).send("Falta el nombre del negocio.");
  const pickedPlan = PLANS[req.body?.plan] ? req.body.plan : "complete";
  const c = await db.createContractor({ name, phone });
  // Closer accounts activate only with money: a Stripe payment in the last
  // 48h matching this phone activates now; otherwise the access link waits.
  // CONSUME the marker (atomic delete) so the same payment can't activate a
  // second account, and also clear the twin email marker it left.
  const digits = String(phone || "").replace(/\D/g, "").replace(/^1/, "");
  const paid = digits ? await db.kvConsume(`paid:${digits}`, 48 * 3600 * 1000).catch(() => null) : null;
  if (paid?.email) await db.kvDelete(`paid:${paid.email}`).catch(() => {});
  // The plan is what was actually PAID, not what the closer clicked — money is
  // the source of truth (paid $197 → widget, even if "complete" was selected).
  const plan = paid && PLANS[paid.plan] ? paid.plan : pickedPlan;
  const trade = FENCE_ENABLED && req.body?.trade === "fence" ? "fence" : "roofing";
  const cData = paid
    ? { plan, payStatus: paid.trial ? "trial" : "ok", ...(paid.customerId ? { stripeCustomer: paid.customerId } : {}) }
    : { plan, payStatus: "pending" };
  cData.trade = trade;
  cData.profile = { trade }; // the app reads profile.trade and opens in that mode
  // Record the pre-account payment in the ledger so it isn't lost.
  // (A trial marker is a card on file, not money — no $0 ledger row.)
  if (paid?.amountCents != null && paid.evId && !paid.trial) {
    cData.payments = [{ evId: paid.evId, at: paid.at || new Date().toISOString(), amount: Math.round(paid.amountCents) / 100, url: null }];
  }
  await db.saveContractorData(c.id, cData);
  const invite = await db.createInvite(c.id);
  const base = canonBase(req);
  const K = encodeURIComponent(String(req.query.key || req.body?.key || ""));
  res.send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cliente creado</title>
<style>body{font-family:Arial;max-width:560px;margin:40px auto;padding:0 16px;color:#101B30}h2{margin-bottom:6px}
.link{background:#FEF5DC;border:2px solid #F8B408;border-radius:12px;padding:13px;word-break:break-all;font-size:14px;margin:10px 0;display:flex;gap:10px;align-items:center}
.link button{margin-left:auto;background:#F8B408;color:#101B30;border:none;border-radius:8px;padding:8px 14px;font-weight:800;cursor:pointer;flex-shrink:0}
a{color:#B57E00;font-weight:800}small{color:#67718A}
.hero{background:#fff;border:2px solid #F8B408;border-radius:18px;padding:22px;margin:12px 0 22px;box-shadow:0 14px 36px rgba(248,180,8,.2)}
.hero .lbl{font-size:13px;font-weight:800;color:#7A5A00;text-transform:uppercase;letter-spacing:.5px}
.hero .url{background:#FEF9E9;border:1px solid #F4DE9A;border-radius:11px;padding:13px;word-break:break-all;font-size:14px;font-weight:600;margin:10px 0 14px;color:#101B30}
.hero .btns{display:flex;gap:10px;flex-wrap:wrap}
.hero .big{flex:1 1 180px;text-align:center;border:none;border-radius:13px;padding:17px;font-weight:800;font-size:16.5px;cursor:pointer;text-decoration:none;display:inline-block;font-family:inherit}
.hero .copybtn{background:#F8B408;color:#101B30;box-shadow:0 8px 20px rgba(248,180,8,.32)}
.hero .wabtn{background:#25D366;color:#fff;box-shadow:0 8px 20px rgba(37,211,102,.3)}</style></head><body>
<h2>✓ Cliente creado: ${String(c.name).replace(/</g, "&lt;")}</h2>
<p style="background:#F0F2F6;border-radius:12px;padding:8px 14px;font-weight:700;font-size:13.5px">📦 Plan: ${PLANS[plan].name} · $${PLANS[plan].price}/mes${STRIPE_LINKS[plan] ? ` — <a href="${STRIPE_LINKS[plan]}" target="_blank" rel="noreferrer">su link de pago →</a>` : ""}</p>
${paid
  ? `<p style="background:#EAF8EF;border:1.5px solid #34A853;color:#1E7B3C;border-radius:12px;padding:10px 14px;font-weight:700">✅ Pago confirmado — la cuenta está ACTIVA.</p>`
  : `<p style="background:#FEF5DC;border:1.5px solid #F8B408;color:#7A5A00;border-radius:12px;padding:10px 14px;font-weight:700">⏳ El link de acceso se ACTIVA solo cuando Stripe confirme su pago (≈1 min después de pagar). Si pagó por otro medio, el admin la activa desde su tablero.</p>`}
<p><b>1.</b> Mándale su <b>link de acceso</b> — es su llave para entrar a la app:</p>
<div class="hero">
  <div class="lbl">🔑 Link de acceso de ${String(c.name).replace(/</g, "&lt;")}</div>
  <div class="url" id="inviteUrl">${base}/invite/${invite}</div>
  <div class="btns">
    <button class="big copybtn" onclick="cp(this,'${base}/invite/${invite}')">📋 Copiar link</button>
    ${digits.length === 10 ? `<a class="big wabtn" target="_blank" href="https://wa.me/1${digits}?text=${encodeURIComponent(`¡Bienvenido a ALTO Pro! 🎉 Esta es tu app — ábrela con este link y guárdalo, es tu llave 🔑: ${base}/invite/${invite}`)}">💬 Enviar por WhatsApp</a>` : ""}
  </div>
</div>
<p><b>2.</b> Su cotizador (va dentro de su página web):</p>
<div class="link"><span><b>🛰️ Widget</b><br><small>${base}/w/${c.slug}</small></span><button onclick="navigator.clipboard.writeText('${base}/w/${c.slug}');this.textContent='✓'">Copiar</button></div>
<p><b>3.</b> Personaliza su página web (plantilla, color, fotos):</p>
<div class="link"><span><b>🎨 Onboarding de su página</b></span><a href="/onboarding?slug=${c.slug}" style="margin-left:auto;background:#F8B408;color:#101B30;border-radius:8px;padding:8px 14px;font-weight:800;text-decoration:none">Abrir →</a></div>
<a href="/closer">← Volver al portal del closer</a>
<script>function cp(b,t){navigator.clipboard.writeText(t);var o=b.textContent;b.textContent='✓ Copiado';setTimeout(function(){b.textContent=o},1200);}</script>
</body></html>`);
});

/* ── Closer portal (/closer) — crear cliente nuevo + toolkit, nothing else ── */
app.get("/closer", async (req, res) => {
  if (!CLOSER_KEY && !ADMIN_KEY) return res.status(503).send("Set CLOSER_KEY env var to enable.");
  if (req.query.logout != null) { clearKeyCookie(res, "alto_closer"); return res.redirect("/closer"); }
  const qk = req.query.key;
  if (qk && ((CLOSER_KEY && qk === CLOSER_KEY) || (ADMIN_KEY && qk === ADMIN_KEY))) {
    setKeyCookie(req, res, "alto_closer", qk);
    return res.redirect("/closer" + (req.query.lang === "en" ? "?lang=en" : ""));
  }
  if (qk && overQuota(`keyguess:${clientIp(req)}`, 30)) return res.status(429).send("Demasiados intentos. Intenta más tarde.");
  if (!closerOk(req)) return res.status(qk ? 403 : 401).send(loginPage("Portal del closer", "/closer", !!qk));
  const base = canonBase(req);
  const ck = reqCookies(req);
  const K = encodeURIComponent(String(ck.alto_closer || ck.alto_admin || qk || ""));
  const en = req.query.lang === "en";
  // meeting stats + log (closer's dashboard numbers), filtered by month/range
  const range = periodRange(req.query, en);
  const mst = await db.meetingStats(range).catch(() => ({ total: 0, scheduled: 0, noShow: 0, showed: 0, closed: 0 }));
  const meetings = await db.listMeetings(40, range).catch(() => []);
  const allAccts = await db.listContractors().catch(() => []);
  const clientCount = allAccts.filter((c) => !["alto-demo", "alto-ventas", "alto-cercas"].includes(c.slug)).length;
  const avAcct = allAccts.find((c) => c.slug === "alto-ventas");
  const salesLeads = avAcct ? await db.listLeads(avAcct.id).catch(() => []) : [];
  const salesPend = salesLeads.filter((l) => (l.status || "new") === "new").length;
  const closeRate = mst.total ? Math.round((mst.closed / mst.total) * 100) : 0;
  const wMsg = en
    ? `Check this out 👀 — type your address and see what your customers would see on YOUR website:\n${base}/w/alto-demo`
    : `Mira esto 👀 — escribe tu dirección y ve lo que tus clientes verían en TU página web:\n${base}/w/alto-demo`;
  const welcome = en
    ? `Congratulations and welcome to ALTO Pro! 🎉 Tap this link from your phone and save it — it's your personal key to your app: [PASTE THEIR ACCESS LINK HERE]. You can measure roofs and quote starting today. See you at your onboarding call 💪`
    : `¡Felicidades y bienvenido a ALTO Pro! 🎉 Toca este link desde tu teléfono y guárdalo — es tu llave personal a tu app: [PEGA AQUÍ SU LINK DE ACCESO]. Hoy mismo puedes medir techos y cotizar. Nos vemos en tu llamada de onboarding 💪`;
  // Full HTML escape (was only "<"): the meeting note renders into a value="…"
  // attribute, so an unescaped " truncated/corrupted the note — a plain closer
  // writing `cliente dijo "sí"` broke the field. Escaping &<>" fixes that and
  // closes attribute injection. All uses here are text/attribute (the copy
  // buttons use JSON.stringify, not esc), so escaping more is strictly safer.
  const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const L = en ? {
    title: "Closer portal", langBtn: "🇲🇽 Español", langQ: "",
    warn: "⚠️ Private page — NEVER screen-share it. The client-facing presentation is /demo.",
    altaT: "➕ Create new client (while they pay)",
    altaName: "Business name", altaPhone: "Phone (the SAME one they use in Stripe)", altaBtn: "Create account",
    altaTip: "💡 Use the same phone the client enters at checkout — their payments connect to their account automatically.",
    linksT: "Links & messages",
    payT: "💳 Payment links — no setup fee", payNames: { pro: "PRO · the app · $67/mo", widget: "WIDGET · their site · $197/mo", complete: "COMPLETE · done for you · $297/mo" }, payMissing: "Not configured yet (STRIPE_LINK_PRO / STRIPE_LINK_WIDGET / STRIPE_LINK_COMPLETE in Render).",
    welT: "👋 Welcome (paste their access link)", demoT: "🛰️ Quote tool demo", demoMsgT: "👀 Demo message",
    open: "Open", copy: "Copy",
  } : {
    title: "Portal del closer", langBtn: "🇺🇸 English", langQ: "&lang=en",
    warn: "⚠️ Página privada — NUNCA la compartas en pantalla. La presentación para el cliente es /demo.",
    altaT: "➕ Crear cliente nuevo (mientras paga)",
    altaName: "Nombre del negocio", altaPhone: "Teléfono (el MISMO que usa en Stripe)", altaBtn: "Crear cuenta",
    altaTip: "💡 Usa el mismo teléfono que el cliente pone al pagar — así sus pagos se conectan solos a su cuenta.",
    linksT: "Links y mensajes",
    payT: "💳 Links de pago — sin cargo de inicio", payNames: { pro: "PRO · la app · $67/mes", widget: "WIDGET · su página · $197/mes", complete: "COMPLETO · todo hecho · $297/mes" }, payMissing: "Aún no configurado (STRIPE_LINK_PRO / STRIPE_LINK_WIDGET / STRIPE_LINK_COMPLETE en Render).",
    welT: "👋 Bienvenida (pega su link de acceso)", demoT: "🛰️ Demo del cotizador", demoMsgT: "👀 Mensaje de demo",
    open: "Abrir", copy: "Copiar",
  };
  res.send(`<!doctype html><html lang="${en ? "en" : "es"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ALTO Pro · ${L.title}</title><link rel="icon" href="/icon-192.png"><style>
*{box-sizing:border-box;margin:0;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","SF Pro Display",Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
html{background:#F5F6F8}
body{max-width:680px;margin:0 auto;padding:34px 20px 72px;color:#0B1220;line-height:1.55;letter-spacing:-0.011em}
::selection{background:rgba(248,180,8,.35)}
h1{font-size:26px;font-weight:700;letter-spacing:-0.025em;margin-bottom:18px}
h1 span{color:#D99E00}
h2{font-size:12.5px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#9097A3;margin:34px 0 12px}
.lang{position:fixed;top:14px;right:16px;background:rgba(16,27,48,.9);backdrop-filter:saturate(180%) blur(14px);-webkit-backdrop-filter:saturate(180%) blur(14px);color:#fff;border-radius:99px;padding:9px 17px;font-weight:700;font-size:13px;text-decoration:none;box-shadow:0 6px 18px rgba(16,27,48,.25)}
.warn{background:#FFF4F4;border:1px solid #F6D5D5;color:#B42318;border-radius:16px;padding:14px 16px;font-weight:600;font-size:13.5px;box-shadow:0 1px 2px rgba(180,35,24,.05)}
.altaHead{font-size:19px;font-weight:700;color:#0B1220;text-transform:none;letter-spacing:-0.02em;margin:34px 0 14px}
.alta{display:flex;gap:12px;flex-wrap:wrap;background:#fff;border:1.5px solid rgba(248,180,8,.4);border-radius:22px;padding:24px;box-shadow:0 1px 2px rgba(16,27,48,.04),0 18px 44px rgba(248,180,8,.12)}
.alta input{flex:1 1 200px;min-width:180px;font-family:inherit;padding:17px 18px;border-radius:14px;border:1.5px solid #E4E7EC;font-size:16.5px;font-weight:500;outline:none;transition:border-color .15s,box-shadow .15s}
.alta input:focus{border-color:#F8B408;box-shadow:0 0 0 4px rgba(248,180,8,.18)}
.alta button{flex:1 1 100%;background:#F8B408;color:#101B30;border:none;border-radius:14px;padding:18px 24px;font-weight:800;cursor:pointer;font-size:17.5px;box-shadow:0 8px 20px rgba(248,180,8,.32);transition:transform .12s,filter .15s}
.alta button:hover{filter:brightness(1.03)}.alta button:active{transform:scale(.97)}
.alta select{min-width:0;max-width:100%}
ol{padding-left:22px;margin-top:4px}ol li{margin-bottom:10px;font-weight:500;color:#1B2433}
ul{padding-left:22px}ul li{margin-bottom:7px;font-weight:500;color:#1B2433}
small{color:#9097A3}
.sc{background:#fff;border:1px solid rgba(16,27,48,.05);border-left:3px solid #F8B408;border-radius:16px;padding:16px 18px;margin:10px 0;box-shadow:0 1px 2px rgba(16,27,48,.04),0 8px 22px rgba(16,27,48,.045)}
.sc b{display:block;font-size:11px;color:#B07A00;letter-spacing:.8px;text-transform:uppercase;margin-bottom:6px;font-weight:700}
.sc p{font-size:15px;font-style:italic;color:#1B2433;line-height:1.6}
.link{background:#fff;border:1px solid rgba(16,27,48,.06);border-radius:16px;padding:13px 16px;word-break:break-all;font-size:14px;margin:9px 0;display:flex;gap:10px;align-items:center;box-shadow:0 1px 2px rgba(16,27,48,.04),0 8px 22px rgba(16,27,48,.04);transition:box-shadow .18s,transform .18s}
.link:hover{transform:translateY(-1px);box-shadow:0 2px 4px rgba(16,27,48,.06),0 14px 32px rgba(16,27,48,.08)}
.link>span{flex:1;min-width:0}
.link b{font-weight:700}
.link small{color:#9097A3}
.link button{background:#F8B408;color:#101B30;border:none;border-radius:11px;padding:9px 15px;font-weight:700;cursor:pointer;flex-shrink:0;font-size:13px;transition:filter .15s}
.link button:hover{filter:brightness(1.03)}
.ob{background:#fff;border:1px solid rgba(16,27,48,.05);border-radius:16px;padding:14px 16px;margin:10px 0;box-shadow:0 1px 2px rgba(16,27,48,.04),0 8px 20px rgba(16,27,48,.04)}
.ob b{font-size:14px;font-weight:700;color:#0B1220}
.ob p{font-size:14px;color:#475067;font-style:italic;margin-top:5px;line-height:1.55}
.lang{position:static}
.topbar{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-bottom:14px}
.topbar h1{margin:0}
.topactions{display:flex;gap:8px}
.lang.dark{background:rgba(16,27,48,.92);color:#fff;border:none}
.toolbar{display:flex;gap:10px;flex-wrap:wrap;margin:0 0 8px}
.navbtn{display:inline-flex;align-items:center;gap:8px;background:#fff;border:1px solid rgba(16,27,48,.06);border-radius:14px;padding:13px 20px;font-weight:700;font-size:14.5px;color:#0B1220;text-decoration:none;box-shadow:0 1px 2px rgba(16,27,48,.04),0 8px 22px rgba(16,27,48,.05);transition:transform .15s,box-shadow .15s}
.navbtn:hover{transform:translateY(-1px);box-shadow:0 2px 4px rgba(16,27,48,.06),0 14px 30px rgba(16,27,48,.09)}
.navbtn.primary{background:#F8B408;border:none;box-shadow:0 6px 18px rgba(248,180,8,.35)}
.cols{display:grid;gap:24px;grid-template-columns:minmax(0,1fr)}
.cols>.col{min-width:0}
.segcustom{flex-wrap:wrap}
.segcustom input[type=date]{max-width:146px;min-width:0}
.col>h2:first-child{margin-top:6px}
body{max-width:none;margin:0;padding:0}
.appheader{position:sticky;top:0;z-index:30;background:rgba(16,27,48,.9);backdrop-filter:saturate(180%) blur(20px);-webkit-backdrop-filter:saturate(180%) blur(20px);color:#fff;padding:15px 24px;display:flex;align-items:center;gap:13px;border-bottom:1px solid rgba(255,255,255,.07)}
.appheader img{height:30px;background:#fff;border-radius:9px;padding:4px 6px}
.appheader b{font-size:16px;font-weight:700;letter-spacing:-0.02em}.appheader b em{color:#F8B408;font-style:normal}
.appheader .right{margin-left:auto;display:flex;gap:8px;align-items:center}
.appheader .right a{color:#cdd5e5;text-decoration:none;font-weight:600;font-size:13px;border-radius:99px;padding:7px 14px}
.appheader .right a.dark{background:rgba(255,255,255,.1);color:#fff}
.wrap{max-width:1180px;margin:0 auto;padding:24px 22px 64px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(158px,1fr));gap:14px;margin-bottom:8px}
.card{background:#fff;border:1px solid rgba(16,27,48,.05);border-radius:20px;padding:18px 20px;box-shadow:0 1px 2px rgba(16,27,48,.04),0 10px 26px rgba(16,27,48,.045)}
.card .v{font-size:30px;font-weight:700;letter-spacing:-0.035em;line-height:1.04}
.card .l{font-size:11px;font-weight:700;color:#9097A3;letter-spacing:.55px;text-transform:uppercase;margin-top:6px}
.card .sub{font-size:11px;font-weight:700;color:#8A94A8;margin-top:4px}
.card.gold{background:linear-gradient(155deg,#16243f 0%,#0d1729 100%);color:#fff;border:none;box-shadow:0 1px 2px rgba(0,0,0,.25),0 20px 48px rgba(16,27,48,.3)}
.card.gold .v{color:#F8B408}.card.gold .l{color:#9DA8C4}
.panel{background:#fff;border:1px solid rgba(16,27,48,.05);border-radius:22px;padding:22px 24px;margin:18px 0;box-shadow:0 1px 2px rgba(16,27,48,.04),0 12px 30px rgba(16,27,48,.05)}
.panel h3{font-size:13px;color:#9097A3;letter-spacing:.6px;text-transform:uppercase;font-weight:700;margin-bottom:14px}
.mform{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}
.mform input{flex:1;min-width:140px;font-family:inherit;padding:12px 14px;border-radius:12px;border:1px solid #E4E7EC;font-size:14px;font-weight:500;outline:none;transition:border-color .15s,box-shadow .15s}
.mform input:focus{border-color:#F8B408;box-shadow:0 0 0 4px rgba(248,180,8,.18)}
.mform button{background:#101B30;color:#fff;border:none;border-radius:12px;padding:12px 20px;font-weight:700;cursor:pointer;font-size:14px}
.mrow{display:flex;align-items:center;gap:9px;padding:11px 0;border-bottom:1px solid #F2F4F7;font-size:14px;font-weight:600;flex-wrap:wrap}
.mrow:last-child{border-bottom:none}
.mrow .nm{flex:1;min-width:120px}
.mrow .nm small{color:#9097A3;font-weight:500}
.mbtn{border:none;border-radius:9px;padding:7px 11px;font-weight:700;font-size:12px;cursor:pointer}
.mbtn.show{background:#E7F7ED;color:#10803C}.mbtn.no{background:#FDECEC;color:#C5221F}.mbtn.win{background:#F8B408;color:#101B30}
.mbtn.meh{background:#F0F2F6;color:#67718A}
.mbtn.fup{background:#E5EFFE;color:#21438A}
.mtag.follow_up{background:#E5EFFE;color:#21438A}
.mtag{border-radius:99px;padding:4px 11px;font-size:11px;font-weight:700;white-space:nowrap}
.mtag.showed{background:#E7F7ED;color:#10803C}.mtag.no_show{background:#FDECEC;color:#C5221F}.mtag.closed{background:#FEF3D6;color:#946400}.mtag.scheduled{background:#F0F2F6;color:#8A94A8}
.mtag.not_interested{background:#F0F2F6;color:#67718A;text-decoration:line-through}
.mwa{text-decoration:none;font-size:14px}
.mtabs{display:flex;gap:7px;flex-wrap:wrap;margin:0 0 12px}
.mtabs a{border:1px solid #E4E7EC;background:#fff;border-radius:99px;padding:7px 13px;font-size:12.5px;font-weight:700;color:#475067;text-decoration:none;white-space:nowrap}
.mtabs a b{color:#9097A3;font-weight:700}
.mtabs a.on{background:#101B30;border-color:#101B30;color:#fff}
.mtabs a.on b{color:#9DA8C4}
.mnote{flex-basis:100%;font-family:inherit;margin-top:4px;padding:9px 12px;border-radius:10px;border:1px solid #E4E7EC;font-size:13px;font-weight:500;color:#1B2433;outline:none;transition:border-color .2s,box-shadow .15s}
.mnote::placeholder{color:#B6BCC8;font-weight:500}
.mnote:focus{border-color:#F8B408;box-shadow:0 0 0 3px rgba(248,180,8,.16)}
.periodbar{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin:2px 0 16px}
.segs{display:inline-flex;background:#EEF0F4;border-radius:12px;padding:3px;gap:2px}
.seg{padding:8px 15px;border-radius:9px;font-size:13px;font-weight:700;color:#5A6475;text-decoration:none;white-space:nowrap}
.seg.on{background:#fff;color:#101B30;box-shadow:0 1px 3px rgba(16,27,48,.12)}
.segcustom{display:inline-flex;gap:7px;align-items:center}
.segcustom input{font-family:inherit;padding:8px 10px;border-radius:10px;border:1px solid #E4E7EC;font-size:13px;font-weight:600;color:#1B2433;outline:none}
.segcustom input:focus{border-color:#F8B408;box-shadow:0 0 0 3px rgba(248,180,8,.18)}
.segcustom button{background:#101B30;color:#fff;border:none;border-radius:10px;padding:9px 16px;font-weight:700;font-size:13px;cursor:pointer}
.segcustom button.on{background:#F8B408;color:#101B30}
.plabel{font-size:12.5px;font-weight:700;color:#9097A3}
@media(max-width:480px){.alta input{min-width:0}}
/* Collapsible panels — closed by default so nothing sits in the way. */
summary.psum{cursor:pointer;list-style:none;display:flex;align-items:center;gap:8px;margin:0}
summary.psum::-webkit-details-marker{display:none}
summary.psum::after{content:"▾";margin-left:auto;color:#9097A3;font-size:13px;transition:transform .15s}
details[open]>summary.psum::after{transform:rotate(180deg)}
.pbody{margin-top:16px}
.panel>details>summary.psum>h3,.panel>details>summary.psum>h2{margin:0}
</style></head><body>
<div class="appheader">
  <img src="/brand-logo.png" alt="">
  <b>ALTO <em>PRO</em> · ${en ? "Closer" : "Closer"}</b>
  <div class="right">
    <a href="/closer?logout">${en ? "log out" : "salir"}</a>
    <a class="dark" href="/closer${en ? "" : "?lang=en"}">${L.langBtn}</a>
  </div>
</div>
<div class="wrap">
<div class="cards">
  <div class="card gold"><div class="v">${closeRate}%</div><div class="l">${en ? "Close rate" : "Tasa de cierre"}</div></div>
  <div class="card"><div class="v">${mst.total}</div><div class="l">${en ? "Meetings" : "Reuniones"}</div></div>
  <div class="card"><div class="v">${mst.showed}</div><div class="l">${en ? "Showed up" : "Asistieron"}</div>${mst.total ? `<div class="sub">${Math.round((mst.showed / mst.total) * 100)}%</div>` : ""}</div>
  <div class="card"><div class="v">${mst.noShow}</div><div class="l">No-shows</div>${mst.total ? `<div class="sub" style="color:#C5221F">${Math.round((mst.noShow / mst.total) * 100)}%</div>` : ""}</div>
  <div class="card"><div class="v">${mst.closed}</div><div class="l">${en ? "Closed" : "Cerrados"}</div></div>
  <div class="card"><div class="v">${clientCount}</div><div class="l">${en ? "Clients" : "Clientes"}</div></div>
</div>
<div class="toolbar">
  <a class="navbtn primary" href="/demo" target="_blank">🎤 ${en ? "Open presentation" : "Abrir presentación"}</a>
</div>
<div class="panel"><details open><summary class="psum"><h3 style="margin:0;display:inline">📅 ${en ? "Log a meeting" : "Agendar reunión"}</h3></summary>
  <div class="pbody">
  <div class="mform">
    <input id="mname" placeholder="${en ? "Prospect name" : "Nombre del prospecto"}">
    <input id="mphone" placeholder="${en ? "Phone" : "Teléfono"}" inputmode="numeric">
    <button onclick="addMeeting()">${en ? "Log meeting" : "Agendar reunión"}</button>
  </div>
  </div>
</details></div>
<div class="panel"><details open><summary class="psum"><h3>📅 ${en ? "My meetings" : "Mis reuniones"} <span style="color:#9097A3;font-weight:600;font-size:12.5px">· ${range.label}</span></h3></summary>
  <div class="pbody">
  ${periodSeg("/closer", range, en)}
  ${(() => {
    // Mini-CRM pipeline tabs: one click shows exactly who sits in each stage,
    // with their phone and notes right there.
    const ocCount = (o) => meetings.filter((m) => (m.outcome || "scheduled") === o).length;
    const TABS = [
      ["all", en ? "All" : "Todas", meetings.length],
      ["scheduled", en ? "📅 Scheduled" : "📅 Agendadas", ocCount("scheduled")],
      ["showed", en ? "✅ Showed" : "✅ Asistió", ocCount("showed")],
      ["follow_up", en ? "⏳ Follow up" : "⏳ Seguimiento", ocCount("follow_up")],
      ["closed", en ? "💰 Closed" : "💰 Cerró", ocCount("closed")],
      ["not_interested", en ? "🙅 Not interested" : "🙅 No le interesa", ocCount("not_interested")],
      ["no_show", "👻 No-show", ocCount("no_show")],
    ];
    return meetings.length ? `<div class="mtabs" id="mftabs">${TABS.map(([k, label, n]) => `<a href="#" data-oc="${k}"${k === "all" ? ' class="on"' : ""} onclick="mFilter('${k}');return false">${label} <b>(${n})</b></a>`).join("")}</div>` : "";
  })()}
  <div id="mlist">
  ${meetings.length ? meetings.map((m) => {
    const pp = String(m.phone || "").replace(/\D/g, "").replace(/^1/, "");
    const phoneTxt = pp.length === 10 ? `(${pp.slice(0, 3)}) ${pp.slice(3, 6)}-${pp.slice(6)}` : (m.phone || "");
    const oc = m.outcome || "scheduled";
    const tagTxt = { scheduled: "agendada", showed: "asistió", no_show: "no-show", closed: "cerró ✓", not_interested: en ? "not interested" : "no le interesa", follow_up: en ? "follow up ⏳" : "seguimiento ⏳" }[oc];
    return `<div class="mrow" data-oc="${oc}"><span class="nm">${esc(m.name) || "—"}${phoneTxt ? ` <small>· ${phoneTxt}</small>` : ""}${pp.length === 10 ? ` <a class="mwa" href="https://wa.me/1${pp}" target="_blank" title="WhatsApp">💬</a>` : ""}</span>
      <span class="mtag ${oc}">${tagTxt}</span>
      <button class="mbtn show" onclick="mOutcome('${m.id}','showed')">${en ? "Showed" : "Asistió"}</button>
      <button class="mbtn fup" onclick="mOutcome('${m.id}','follow_up')">${en ? "Follow up ⏳" : "Seguimiento ⏳"}</button>
      <button class="mbtn no" onclick="mOutcome('${m.id}','no_show')">No-show</button>
      <button class="mbtn meh" onclick="mOutcome('${m.id}','not_interested')">${en ? "Not interested" : "No le interesa"}</button>
      <button class="mbtn win" onclick="mOutcome('${m.id}','closed')">${en ? "Closed 💰" : "Cerró 💰"}</button>
      <input class="mnote" id="note_${m.id}" placeholder="${en ? "note (saves when you click away)…" : "nota (se guarda al salir del campo)…"}" value="${esc(m.note || "")}" onblur="saveNote('${m.id}')"></div>`;
  }).join("") : `<p style="color:#9097A3;font-weight:500">${en ? "No meetings logged yet — add them above to track your show & close rate." : "Aún no hay reuniones — agrégalas arriba para ver tu % de asistencia y cierre."}</p>`}
  </div>
  </div>
</details></div>
<div class="panel"><details ${salesPend ? "open" : ""}><summary class="psum"><h3 style="margin:0;display:inline">📣 ${en ? "Sales leads" : "Leads de venta"} ${salesPend ? `· <b style="color:#C5221F">${salesPend} ${en ? "to contact" : "sin contactar"}</b>` : `(${salesLeads.length})`}</h3></summary>
  <div class="pbody">${salesLeadsPanel(salesLeads, K)}</div>
</details></div>
<p class="warn">${L.warn}</p>
<div class="cols">
  <div class="col">
    <div class="panel"><details open><summary class="psum"><h2 class="altaHead" style="margin:0">${L.altaT}</h2></summary>
      <div class="pbody">
      <form class="alta" method="post" action="/api/closer/contractors">
        <input name="name" placeholder="${L.altaName}" required>
        <input name="phone" placeholder="${L.altaPhone}">
        <select name="plan" style="flex:1 1 100%;font-family:inherit;padding:15px 16px;border-radius:14px;border:1.5px solid #E4E7EC;font-size:15px;font-weight:600;background:#fff;color:#101B30">
          <option value="complete">${en ? "COMPLETE · done for you · $297/mo" : "COMPLETO · todo hecho · $297/mes"}</option>
          <option value="widget">${en ? "WIDGET · their site · $197/mo" : "WIDGET · su página · $197/mes"}</option>
          <option value="pro">${en ? "PRO · just the app · $67/mo" : "PRO · solo la app · $67/mes"}</option>
        </select>
        ${FENCE_ENABLED ? `<select name="trade" style="flex:1 1 100%;font-family:inherit;padding:15px 16px;border-radius:14px;border:1.5px solid #E4E7EC;font-size:15px;font-weight:600;background:#fff;color:#101B30">
          <option value="roofing">🏠 ${en ? "ROOFING" : "TECHOS"}</option>
          <option value="fence">🪵 ${en ? "FENCE" : "CERCAS"}</option>
        </select>` : ""}
        <button>${L.altaBtn}</button>
      </form>
      <p><small>${L.altaTip}</small></p>
      </div>
    </details></div>
    <div class="panel"><details><summary class="psum"><h2 style="margin:0">${L.linksT}</h2></summary>
      <div class="pbody">
      <p style="font-weight:800;font-size:13px;margin:2px 0 2px">${L.payT}</p>
      ${["pro", "widget", "complete"].map((pl) => STRIPE_LINKS[pl]
        ? `<div class="link"><span><b>${L.payNames[pl]}</b><br><small>${esc(STRIPE_LINKS[pl])}</small></span><a href="${STRIPE_LINKS[pl]}" target="_blank" rel="noreferrer" style="background:#101B30;color:#fff;border-radius:11px;padding:9px 15px;font-weight:700;text-decoration:none;flex-shrink:0;font-size:13px">${L.open}</a><button onclick="cp(this,'${STRIPE_LINKS[pl]}')">${L.copy}</button></div>`
        : `<div class="link" style="border-style:dashed"><span><b>💳 ${L.payNames[pl]}</b><br><small>${L.payMissing}</small></span></div>`).join("")}
      <div class="link"><span><b>${L.welT}</b><br><small>${esc(welcome.slice(0, 70))}…</small></span><button onclick='cp(this,${JSON.stringify(welcome)})'>${L.copy}</button></div>
      <div class="link"><span><b>${L.demoT}</b><br><small>${base}/w/alto-demo</small></span><button onclick="cp(this,'${base}/w/alto-demo')">${L.copy}</button></div>
      <div class="link"><span><b>${L.demoMsgT}</b><br><small>${esc(wMsg.slice(0, 70))}…</small></span><button onclick='cp(this,${JSON.stringify(wMsg)})'>${L.copy}</button></div>
      </div>
    </details></div>
  </div>
</div>
</div>
<script>
function cp(b,t){navigator.clipboard.writeText(t);b.textContent='✓'}
function addMeeting(){var n=document.getElementById('mname'),p=document.getElementById('mphone');var nm=n.value.trim(),ph=p.value.trim();if(!nm&&!ph)return;fetch('/api/closer/meeting',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:nm,phone:ph})}).then(function(r){return r.json()}).then(function(){location.reload()}).catch(function(){alert('Error')});}
function mOutcome(id,o){var el=document.getElementById('note_'+id);var note=el?el.value:'';fetch('/api/closer/meeting/'+encodeURIComponent(id)+'',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({outcome:o,note:note})}).then(function(r){return r.json()}).then(function(){location.reload()}).catch(function(){alert('Error')});}
function saveNote(id){var el=document.getElementById('note_'+id);if(!el)return;fetch('/api/closer/meeting/'+encodeURIComponent(id)+'',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({note:el.value})}).then(function(){el.style.borderColor='#10803C';setTimeout(function(){el.style.borderColor='';},900);}).catch(function(){});}
function mFilter(oc){
  [].forEach.call(document.querySelectorAll('#mftabs a'),function(a){a.classList.toggle('on',a.getAttribute('data-oc')===oc);});
  [].forEach.call(document.querySelectorAll('#mlist .mrow'),function(r){r.style.display=(oc==='all'||r.getAttribute('data-oc')===oc)?'':'none';});
}
</script>
</body></html>`);
});

/* ── Closer's private toolkit (/cierre — NEVER screen-shared) ──
 * The client-facing deck is /demo; this page holds the script,
 * payment link, ready messages, and objection answers. */
app.get("/cierre", (req, res) => {
  // Private closer toolkit (scripts, payment links, objection answers) — gate
  // it like the other staff pages so it isn't public.
  if (req.query.logout != null) { clearKeyCookie(res, "alto_closer"); return res.redirect("/cierre"); }
  const cqk = req.query.key;
  if (cqk && ((CLOSER_KEY && cqk === CLOSER_KEY) || (ADMIN_KEY && cqk === ADMIN_KEY))) { setKeyCookie(req, res, "alto_closer", cqk); return res.redirect("/cierre"); }
  if (cqk && overQuota(`keyguess:${clientIp(req)}`, 30)) return res.status(429).send("Demasiados intentos. Intenta más tarde.");
  if (!closerOk(req)) return res.status(cqk ? 403 : 401).send(loginPage("Cierre", "/cierre", !!cqk));
  const base = canonBase(req);
  const wMsg = `Mira esto 👀 — escribe tu dirección y ve lo que tus clientes verían en TU página web:\n${base}/w/alto-demo`;
  const welcome = `¡Felicidades y bienvenido a ALTO Pro! 🎉 Toca este link desde tu teléfono y guárdalo — es tu llave personal a tu app: [PEGA AQUÍ SU LINK DE ACCESO]. Hoy mismo puedes medir techos y cotizar. Nos vemos en tu llamada de onboarding 💪`;
  const esc = (s) => String(s).replace(/</g, "&lt;");
  res.send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ALTO Pro · Cierre (privado)</title><style>
body{font-family:Arial;max-width:640px;margin:30px auto;padding:0 18px;color:#101B30;line-height:1.55}
h1{font-size:22px}h2{font-size:16px;margin-top:24px}
.warn{background:#FDECEC;border:1.5px solid #D93025;color:#9B1C10;border-radius:12px;padding:10px 14px;font-weight:700;font-size:13px}
.link{background:#FEF5DC;border:2px solid #F8B408;border-radius:12px;padding:12px;word-break:break-all;font-size:14px;margin:8px 0;display:flex;gap:10px;align-items:center}
.link button{margin-left:auto;background:#F8B408;color:#101B30;border:none;border-radius:8px;padding:8px 14px;font-weight:800;cursor:pointer;flex-shrink:0}
.link small{color:#67718A}
ol li{margin-bottom:10px}small{color:#67718A}
</style></head><body>
<h1>🔒 Cierre · ALTO <span style="color:#D99E00">PRO</span></h1>
<p class="warn">⚠️ Página privada del closer — NUNCA la compartas en pantalla. La presentación para el cliente es /demo.</p>
<h2>El cierre, paso a paso (todo en la misma llamada)</h2>
<ol>
<li>Elige su plan ($67 solo la app · $197 cotizador en su página · $297 todo hecho) y mándale su <b>link de pago</b> por WhatsApp — paga desde su teléfono, aquí mismo.</li>
<li>Mientras paga: crea su cuenta en <a href="/closer">/closer</a> y copia su <b>link de acceso</b>.</li>
<li>Mándale la <b>bienvenida</b> con su acceso — ya tiene su app hoy mismo.</li>
<li>Agenda su <b>onboarding</b> antes de colgar.</li>
</ol>
<h2>Links y mensajes</h2>
${[["pro", "💳 PRO · la app · $67/mes"], ["widget", "💳 WIDGET · su página · $197/mes"], ["complete", "💳 COMPLETO · todo hecho · $297/mes"]].map(([pl, lbl]) => {
  const lk = STRIPE_LINKS[pl];
  return `<div class="link"><span><b>${lbl}</b><br><small>${esc(lk || "buy.stripe.com/… (aún sin configurar)")}</small></span><a href="${lk || "#"}" ${lk ? `target="_blank" rel="noreferrer"` : `onclick="alert('Aún no está configurado: crea el Payment Link en Stripe y agrégalo en Render como STRIPE_LINK_${pl.toUpperCase()}');return false"`} style="background:#101B30;color:#fff;border-radius:8px;padding:8px 14px;font-weight:800;text-decoration:none;flex-shrink:0">Abrir</a><button onclick="${lk ? `cp(this,'${lk}')` : `alert('Aún no está configurado: crea el Payment Link en Stripe y agrégalo en Render como STRIPE_LINK_${pl.toUpperCase()}')`}">Copiar</button></div>`;
}).join("")}
<p style="font-size:12px;color:#67718A;margin:-2px 0 10px"><b>Copiar</b> → se lo mandas por WhatsApp y paga desde su teléfono. <b>Abrir</b> → si te da la tarjeta por teléfono, la escribes tú aquí mismo. Sin cargo de inicio en ningún plan.</p>
<div class="link"><span><b>👋 Bienvenida (pega su link de acceso)</b><br><small>${esc(welcome.slice(0, 70))}…</small></span><button onclick='cp(this,${JSON.stringify(welcome)})'>Copiar</button></div>
<div class="link"><span><b>🛰️ Demo del cotizador</b><br><small>${base}/w/alto-demo</small></span><button onclick="cp(this,'${base}/w/alto-demo')">Copiar</button></div>
<div class="link"><span><b>👀 Mensaje de demo</b><br><small>${esc(wMsg.slice(0, 70))}…</small></span><button onclick='cp(this,${JSON.stringify(wMsg)})'>Copiar</button></div>
<h2>⌨️ Atajos secretos en la presentación (/demo)</h2>
<p><small>El cliente nunca los ve. Funcionan en cualquier slide:</small></p>
<ul style="font-size:14px;line-height:1.8">
<li><b>Doble clic en el contador</b> (el "8 / 8" de abajo) o tecla <b>C</b> → abre/cierra el panel del closer</li>
<li>Tecla <b>P</b> → copia el link de pago de $297 (solo verás una palomita verde ✓); los 3 links están en el panel del closer</li>
<li>Tecla <b>B</b> → copia el mensaje de bienvenida</li>
<li>Tecla <b>D</b> → copia el mensaje de demo</li>
<li>Tecla <b>O</b> → abre el checkout de Stripe en otra pestaña</li>
</ul>
<p><small>⚠️ Si compartes la PANTALLA completa, la pestaña de Stripe se ve. Comparte solo la pestaña de /demo y usa las teclas — el cliente no nota nada.</small></p>
<h2>Objeciones y cómo regresar</h2>
<p><small>
<b>"Está caro"</b> → "Un techo promedio te deja $2,000–$4,000 de ganancia. Con UN trabajo extra al año, esto ya se pagó. La pregunta no es si cuesta — es cuántos trabajos se te están yendo hoy."<br><br>
<b>"Ya tengo página"</b> → "Qué bueno — ¿y te manda los teléfonos de los clientes al bolsillo, con su techo ya cotizado? Eso es lo que hace la diferencia. Tu página de hoy es la tarjeta; esta es la que vende."<br><br>
<b>"Déjame pensarlo"</b> → "Claro. ¿Qué es lo que quieres pensar — el precio, o si te va a funcionar? (espera la respuesta y resuélvela). Te aparto el precio hoy y la demo queda abierta."<br><br>
<b>"Lo tengo que hablar con mi esposa / mi socio"</b> → "Perfecto, así debe ser. ¿Qué te va a preguntar? … Mejor aún: agendemos 10 minutos mañana con los dos y le enseño la demo igual que a ti — que lo vea con sus propios ojos. ¿Mañana a qué hora pueden?"<br><br>
<b>"Mis clientes llegan por recomendación, no por internet"</b> → "Exacto — ¿y qué hace la gente cuando le recomiendan a alguien? Lo busca en Google antes de llamar. Si no encuentra nada, la recomendación se enfría. Esto convierte tus recomendaciones en citas."<br><br>
<b>"No soy bueno con la tecnología"</b> → "Por eso lo hicimos así: si sabes mandar un WhatsApp, sabes usar ALTO. Y el onboarding lo hacemos contigo, en español, paso a paso. No estás solo."<br><br>
<b>"¿Y si no me funciona?"</b> → "Sin contratos largos: cancelas cuando quieras y tu dominio se va contigo — está en el contrato. El riesgo lo cargamos nosotros, no tú."<br><br>
<b>"Ahorita no hay dinero / es temporada baja"</b> → "Justo por eso es el momento: tu página se construye AHORA, para que cuando venga la temporada de lluvias y granizo ya estés posicionado. El que la monta en plena temporada, llega tarde."<br><br>
<b>"Ya trabajo con una agencia de marketing"</b> → "No competimos con tu agencia — le damos a dónde mandar a la gente. ¿Su página te cotiza techos sola y te manda el teléfono al bolsillo? Eso es lo nuestro; lo demás lo puede seguir haciendo ella."<br><br>
<b>"Suena demasiado bueno / ¿por qué tan barato?"</b> → "Porque es software que ya construimos — no te cobramos horas de agencia. Y ganamos cuando te quedas meses, así que nos conviene más que a nadie que te funcione."<br><br>
<b>"Los leads de internet son basura"</b> → "Los leads comprados, sí. Estos no son comprados: es gente que puso SU dirección y SU teléfono para ver el precio de SU techo. Más caliente que eso no existe."
</small></p>
<script>function cp(b,t){navigator.clipboard.writeText(t);b.textContent='✓'}</script>
</body></html>`);
});

app.get("/demo", (req, res) => {
  const base = canonBase(req);
  const en = req.query.lang === "en";
  // ?trade=cercas flips the same deck into fence mode: live demos, scripts and
  // ROI swap; structure, slides and hotkeys stay identical.
  const fence = FENCE_ENABLED && req.query.trade === "cercas";
  const demoWidget = fence ? "alto-cercas" : "alto-demo";
  const wMsg = en
    ? `Check this out 👀 — type your address and see what your customers would see on YOUR website:\n${base}/w/${demoWidget}`
    : `Mira esto 👀 — escribe tu dirección y ve lo que tus clientes verían en TU página web:\n${base}/w/${demoWidget}`;
  const welcome = en
    ? `Congratulations and welcome to ALTO Pro! 🎉 Tap this link from your phone and save it — it's your personal key to your app: [PASTE THEIR ACCESS LINK HERE]. You can ${fence ? "quote fences" : "measure roofs and quote"} starting today. See you at your onboarding call 💪`
    : `¡Felicidades y bienvenido a ALTO Pro! 🎉 Toca este link desde tu teléfono y guárdalo — es tu llave personal a tu app: [PEGA AQUÍ SU LINK DE ACCESO]. Hoy mismo ya puedes ${fence ? "cotizar cercas" : "medir techos y cotizar"}. Nos vemos en tu llamada de onboarding 💪`;
  // marketing photos appear automatically once the files exist in public/landing/
  const hasAsset = (name) =>
    fs.existsSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "landing", name))
    || fs.existsSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "landing", name));
  const teamPhoto = hasAsset("team.jpg");
  const founderBg = hasAsset("founder-bg.jpg");
  const deckTeam = teamAvail();
  const deckHomes = homesAvail();
  const stbLogo = hasAsset("stb-logo.png");

  // Every visible string in both languages
  const L = en ? {
    title: "ALTO Pro · Presentation", presentation: "PRESENTATION", forClients: "Client presentation",
    menu: "☰ Menu", prev: "‹ Previous", next: "Next ›", langBtn: "🇲🇽 Español", langHref: "?lang=es",
    t1: "Welcome", t2: "Who we are", t3: "The problem", t4: "Your website", t5: "Your app", t6: "Your AI assistant", t7: "Your investment", t8: "Let's begin",
    k1: "ALTO PRO · MARKETING & TECHNOLOGY FOR ROOFERS", h1a: "More customers,", h1b: "without chasing them.",
    b1: "Thanks for booking. In the next 10 minutes I'll show you the tools that will work FOR you: your own roof measured by satellite right here, and your website selling for you 24 hours a day — even while you're up on a roof.",
    g1: "60 sec", g1s: "satellite quote", g2: "24/7", g2s: "your site selling", g3: "100%", g3s: "bilingual support", tag: "Your business, on top",
    k2: "02 · WHO WE ARE", h2a: "Built by a contractor,", h2b: "for contractors.",
    b2: "Rolando, our founder, owns residential construction and technology companies in Texas. Measuring the roofs of his own houses, he lived how hard it was to get the measurement right to order materials — so he built this tool for himself. It worked so well he opened it to the public, and today he uses this same system to get leads for his own company.",
    p2a: "Contractor founder: he builds houses, not just software", p2b: "20+ people on the ALTO team working behind your account", p2c: "We use our own tools, every single day",
    cap2: "Rolando · Founder of ALTO", ph2a: "Photo of Rolando and the team", ph2b: "in ALTO shirts",
    k3: "03 · WHY IT MATTERS", h3a: "Work gets lost", h3b: "up on the roof.",
    p3a: 'When you\'re working, you can\'t answer. And most customers go with <b style="color:#fff">whoever responds first</b>.',
    p3b: 'Every estimate costs you: the visit, the gas, the time. <b style="color:#fff">And many of those visits never turn into work.</b>',
    p3c: 'A pretty website with no system behind it is <b style="color:#fff">an expensive business card</b>.',
    p3d: 'Big companies already answer with artificial intelligence — in seconds, around the clock. <b style="color:#fff">The question isn\'t whether this is coming. It\'s which side you\'ll be on.</b>',
    c3: "You work hard. What you're missing is a system that works when you can't.",
    k4: "04 · YOUR WEBSITE", h4a: "This is what", h4b: "your site would look like.",
    b4: "It looks excellent on the phone and on the computer — with your logo, your colors and the quote tool inside. This one is a sample; yours is delivered in 7–14 days. Both are live: scroll, and type YOUR address into the quote tool.",
    k5: "05 · YOUR APP", h5a: "Your office,", h5b: "in your pocket.",
    p5a: "Quote wherever you are: address or GPS, and trace it with your finger if you want", p5b: "Every lead hits your phone with a WhatsApp button and the message pre-written", p5c: "An AI chat on your website answers your customers 24/7 and drops their number in your app", p5d: "Formal quotes and invoices with your brand",
    live5: '🔴 <b style="color:#fff">The app on the right is LIVE</b> — explore it: tap MEASURE ROOF, type a real address and measure it right here, with the client.',
    k6: "06 · ARTIFICIAL INTELLIGENCE", h6a: "Your own assistant,", h6b: "who never sleeps.",
    b6: "We all know artificial intelligence is here — what better way than starting now? A chat assistant on your website answers your customers' questions at any hour, and when they leave their number it lands in your app as a lead.",
    live6: '🔴 <b style="color:#fff">EVERYTHING here is LIVE</b> — open the chat and leave a phone number, or fill out the quote tool like a homeowner… either way, watch it land in the app as a lead, right on this call. 👉',
    k7: "07 · YOUR INVESTMENT", h7a: "All of this —", h7b: "pick your plan.",
    b7: "What this would cost separately (typical market prices):",
    s7a: "🌐 Professional website with your brand", s7b: "🛰️ Satellite quote tool on your site", s7c: "🤖 AI chat on your site — answers 24/7, captures leads", s7d: "📲 Estimates, invoices & leads app", s7e: "🇺🇸 Domain, hosting & bilingual support",
    s7tot: "Separately", roi7: '💰 <b style="color:#fff">An average roof leaves you $2,000–$4,000 in profit.</b> One single extra job pays for your whole year.',
    pk7: "WITH ALTO PRO · PICK YOUR PLAN", mo: "/mo", setup7: "No setup fee — you start today",
    pl7a: "Just the app", pl7b: "App + quote tool on YOUR site", pl7c: "Done for you: website + AI + domain",
    pr7a: "✓ No long contracts", pr7b: "✓ Cancel anytime", pr7c: "✓ Custom domain included",
    k8: "08 · LET'S BEGIN", h8a: "Let's start", h8b: "today.",
    b8: "Getting started is this easy — everything begins on this very call:",
    d8a: "STEP 1", t8a: "Secure your spot", x8a: "We send a secure payment link to your WhatsApp. You pay by card, protected by Stripe 🔒.",
    d8b: "STEP 2 · TODAY", t8b: "Your app, today", x8b: "Your access arrives by WhatsApp before we hang up. You're measuring roofs today.",
    d8c: "STEP 3", t8c: "Your onboarding", x8c: "We book your call right now: your logo, your colors, your prices and your photos.",
    d8d: "DAY 7–14", t8d: "Everything live", x8d: "Your website, your quote tool and your AI chat — working 24/7. We use these days to polish every detail with you before going public.",
    c8: "🤝 Ready? I'll send you the link right now.",
  } : {
    title: "ALTO Pro · Presentación", presentation: "PRESENTACIÓN", forClients: "Presentación para clientes",
    menu: "☰ Menú", prev: "‹ Anterior", next: "Siguiente ›", langBtn: "🇺🇸 English", langHref: "?lang=en",
    t1: "Bienvenida", t2: "Quiénes somos", t3: "El problema", t4: "Tu página", t5: "Tu app", t6: "Tu asistente IA", t7: "Tu inversión", t8: "Empecemos",
    k1: "ALTO PRO · MARKETING Y TECNOLOGÍA PARA ROFEROS", h1a: "Más clientes,", h1b: "sin perseguirlos.",
    b1: "Gracias por agendar. En los próximos 10 minutos te enseño las herramientas que van a trabajar PARA ti: tu propio techo medido por satélite aquí mismo, y tu página vendiendo por ti las 24 horas — hasta cuando andas arriba de un techo.",
    g1: "60 seg", g1s: "cotización satelital", g2: "24/7", g2s: "tu página vendiendo", g3: "100%", g3s: "en español", tag: "Tu negocio, en alto",
    k2: "02 · QUIÉNES SOMOS", h2a: "Construido por un contratista,", h2b: "para contratistas.",
    b2: "Rolando, nuestro fundador, tiene compañías de construcción residencial y de tecnología en Texas. Midiendo los techos de sus propias casas vivió lo difícil que era sacar la medida correcta para pedir el material — así que construyó esta herramienta para él mismo. Funcionó tan bien que la abrió al público, y hoy usa este mismo sistema para conseguir leads para su propia compañía.",
    p2a: "Fundador contratista: construye casas, no solo software", p2b: "Más de 20 personas del equipo ALTO trabajando detrás de tu cuenta", p2c: "Usamos nuestras propias herramientas, todos los días",
    cap2: "Rolando · Fundador de ALTO", ph2a: "Foto de Rolando y el equipo", ph2b: "con la camisa ALTO",
    k3: "03 · POR QUÉ IMPORTA", h3a: "Los trabajos se pierden", h3b: "arriba del techo.",
    p3a: 'Cuando estás trabajando, no puedes contestar. Y la mayoría de los clientes se queda con <b style="color:#fff">el primero que les responde</b>.',
    p3b: 'Cada estimado cuesta: la visita, la gasolina, el tiempo. <b style="color:#fff">Y muchas de esas visitas nunca se vuelven trabajo.</b>',
    p3c: 'Una página bonita sin un sistema detrás es <b style="color:#fff">una tarjeta de presentación cara</b>.',
    p3d: 'Las compañías grandes ya responden con inteligencia artificial — en segundos, a toda hora. <b style="color:#fff">La pregunta no es si esto llega. Es de qué lado vas a estar.</b>',
    c3: "Trabajas duro. Lo que te falta es un sistema que trabaje cuando tú no puedes.",
    k4: "04 · TU PÁGINA WEB", h4a: "Así se vería", h4b: "tu página.",
    b4: "Se mira excelente en el celular y en la computadora — con tu logo, tus colores y el cotizador adentro. Esta es de ejemplo; la tuya se entrega en 7–14 días. Las dos están vivas: haz scroll, y pon TU dirección en el cotizador.",
    k5: "05 · TU APP", h5a: "Tu oficina,", h5b: "en tu bolsillo.",
    p5a: "Cotiza donde estés: dirección o GPS, y si quieres lo trazas con el dedo", p5b: "Cada lead llega a tu teléfono con botón de WhatsApp y el mensaje ya escrito", p5c: "Un chat con IA en tu página le contesta a tus clientes 24/7 y te deja su teléfono en la app", p5d: "Cotizaciones y facturas formales con tu marca",
    live5: '🔴 <b style="color:#fff">La app de la derecha está EN VIVO</b> — explórala: toca MEDIR TECHO, pon una dirección real y mídelo aquí mismo, con el cliente.',
    k6: "06 · INTELIGENCIA ARTIFICIAL", h6a: "Tu propio asistente,", h6b: "que nunca duerme.",
    b6: "Todos sabemos que la inteligencia artificial ya viene — ¿qué mejor que empezar desde ahora? Un asistente con IA vive en tu página: contesta las dudas de tus clientes a cualquier hora, y cuando dejan su teléfono te cae como lead en tu app.",
    live6: '🔴 <b style="color:#fff">TODO esto está EN VIVO</b> — abre el chat y deja un teléfono, o llena el cotizador como si fueras el dueño de casa… de las dos formas, míralo caer como lead en la app, aquí mismo en la llamada. 👉',
    k7: "07 · TU INVERSIÓN", h7a: "Todo esto —", h7b: "elige tu plan.",
    b7: "Lo que esto costaría por separado (precios típicos del mercado):",
    s7a: "🌐 Página web profesional con tu marca", s7b: "🛰️ Cotizador por satélite en tu página", s7c: "🤖 Chat con IA — contesta 24/7 y capta leads", s7d: "📲 App de estimados, facturas y leads", s7e: "🇺🇸 Dominio, hosting y soporte en español",
    s7tot: "Por separado", roi7: '💰 <b style="color:#fff">Un techo promedio te deja $2,000–$4,000 de ganancia.</b> Un solo trabajo extra paga tu año entero.',
    pk7: "CON ALTO PRO · ELIGE TU PLAN", mo: "/mes", setup7: "Sin cargo de inicio — empiezas hoy mismo",
    pl7a: "Solo la app", pl7b: "App + cotizador en TU página", pl7c: "Todo hecho: página + IA + dominio",
    pr7a: "✓ Sin contratos largos", pr7b: "✓ Cancelas cuando quieras", pr7c: "✓ Dominio propio incluido",
    k8: "08 · EMPECEMOS", h8a: "Empecemos", h8b: "hoy mismo.",
    b8: "Así de fácil es arrancar — todo empieza en esta misma llamada:",
    d8a: "PASO 1", t8a: "Asegura tu lugar", x8a: "Te mandamos un link de pago seguro a tu WhatsApp. Pagas con tarjeta, protegido por Stripe 🔒.",
    d8b: "PASO 2 · HOY", t8b: "Tu app, hoy mismo", x8b: "Tu acceso te llega por WhatsApp antes de colgar. Hoy mismo ya estás midiendo techos.",
    d8c: "PASO 3", t8c: "Tu onboarding", x8c: "Agendamos tu llamada ahorita: tu logo, tus colores, tus precios y tus fotos.",
    d8d: "DÍA 7–14", t8d: "Todo funcionando", x8d: "Tu página, tu cotizador y tu chat con IA — trabajando 24/7. Usamos estos días para pulir cada detalle contigo antes de salir al público.",
    c8: "🤝 ¿Listo? Te mando el link ahora mismo.",
  };

  if (fence) Object.assign(L, en ? {
    title: "ALTO Pro · Presentation (Fences)",
    langHref: "?trade=cercas",
    k1: "ALTO PRO · MARKETING & TECHNOLOGY FOR FENCE PROS",
    b1: "Thanks for booking. In the next 10 minutes I'll show you the tools that will work FOR you: a fence quoted in 60 seconds right here, and your website selling for you 24 hours a day — even while you're out on the job.",
    g1s: "instant quote",
    h3a: "Work gets lost", h3b: "out on the job.",
    live5: '🔴 <b style="color:#fff">The app on the right is LIVE</b> — explore it: tap MEASURE FENCE, type a real address, draw the line with your finger and price it right here, with the client. Then tap 💲 and show them the materials list with real Home Depot prices.',
    s7b: "🪵 Instant fence-quote tool on your site",
    roi7: '💰 <b style="color:#fff">An average fence job leaves you $1,500–$3,000 in profit.</b> A couple of extra jobs pay for your whole year.',
    x8b: "Your access arrives by WhatsApp before we hang up. You're quoting fences today.",
  } : {
    title: "ALTO Pro · Presentación (Cercas)",
    langHref: "?trade=cercas&lang=en",
    k1: "ALTO PRO · MARKETING Y TECNOLOGÍA PARA CERQUEROS",
    b1: "Gracias por agendar. En los próximos 10 minutos te enseño las herramientas que van a trabajar PARA ti: una cerca cotizada en 60 segundos aquí mismo, y tu página vendiendo por ti las 24 horas — hasta cuando andas en la obra.",
    g1s: "cotización al instante",
    h3a: "Los trabajos se pierden", h3b: "en la obra.",
    live5: '🔴 <b style="color:#fff">La app de la derecha está EN VIVO</b> — explórala: toca MEDIR CERCA, pon una dirección real, traza la línea con el dedo y cotízala aquí mismo, con el cliente. Luego toca 💲 y enséñale la lista de materiales con precios reales de Home Depot.',
    s7b: "🪵 Cotizador de cercas al instante en tu página",
    roi7: '💰 <b style="color:#fff">Una cerca promedio te deja $1,500–$3,000 de ganancia.</b> Un par de trabajos extra pagan tu año entero.',
    x8b: "Tu acceso te llega por WhatsApp antes de colgar. Hoy mismo ya estás cotizando cercas.",
  });
  const exPage = fence ? "/ejemplo-cercas" : "/ejemplo";
  // Staff presenting the deck get the unlimited-demo passcode injected into
  // the live app mockup, so the 6-measure prospect cap can never interrupt a
  // sales call. The public /demo (no staff cookie) stays capped by design.
  const staff = closerOk(req) || csOk(req) || adminOk(req);
  const appDemo = `${fence ? "/?demo=fence" : "/?demo=roof"}&clean=1${staff && DEMO_PASS ? `&pass=${encodeURIComponent(DEMO_PASS)}` : ""}`;
  res.send(`<!doctype html><html lang="${en ? "en" : "es"}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${L.title}</title><link rel="icon" href="/icon-192.png">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,600;0,9..144,700;1,9..144,600&family=Inter:wght@400;500;600;700;800&display=swap" media="print" onload="this.media='all'">
<style>
*{box-sizing:border-box;font-family:Inter,Arial,sans-serif;margin:0;-webkit-tap-highlight-color:transparent}
:root{--navy:#101B30;--navy2:#0B1226;--gold:#F8B408;--mut:#9DA8C4;--line:rgba(255,255,255,.1)}
body{background:var(--navy2);color:#fff;overflow:hidden}
.layout{display:flex;height:100vh;height:100dvh}
aside{width:268px;background:#fff;border-right:1px solid #E9EAEE;display:flex;flex-direction:column;flex-shrink:0}
.sb-brand{display:flex;justify-content:center;padding:26px 18px 16px}
.sb-brand img{height:58px;display:block}
.sb-label{font-size:10px;letter-spacing:2.5px;color:#9AA0AC;font-weight:800;padding:10px 18px 6px}
nav{flex:1;overflow-y:auto;padding-bottom:10px;display:flex;flex-direction:column}
.nav-it{flex:1;display:flex;align-items:center;gap:14px;width:100%;background:none;border:none;color:#6A7384;font-weight:700;font-size:16px;padding:0 20px;cursor:pointer;text-align:left;border-left:4px solid transparent;min-height:48px}
.nav-it .no{font-family:'Fraunces',Georgia,serif;font-size:13px;color:#B6BCC8;width:22px}
.nav-it.on{color:#101B30;background:rgba(248,180,8,.13);border-left-color:var(--gold)}
.nav-it.on .no{color:#D99E00}
.sb-foot{padding:14px 18px;font-size:11px;color:#9AA0AC;font-weight:700;border-top:1px solid #E9EAEE}
main{flex:1;position:relative;display:flex;flex-direction:column;min-width:0}
.stage{flex:1;position:relative;overflow:hidden}
.slide{position:absolute;inset:0;display:none;flex-direction:column;overflow-y:auto}
.slide.on{display:flex}
.s-bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.38;filter:saturate(.65)}
.s-veil{position:absolute;inset:0;background:linear-gradient(160deg,rgba(11,18,38,.95) 0%,rgba(16,27,48,.82) 55%,rgba(16,27,48,.55) 100%)}
.s-in{position:relative;flex:1;display:flex;flex-direction:column;justify-content:center;padding:clamp(26px,5vw,72px);max-width:980px}
.kick{color:var(--gold);font-weight:800;font-size:12px;letter-spacing:3.5px;margin-bottom:18px;text-transform:uppercase}
h1{font-family:'Fraunces',Georgia,serif;font-size:clamp(34px,5.2vw,64px);line-height:1.06;font-weight:700;max-width:740px}
h1 em{font-style:italic;color:var(--gold)}
.rule{width:54px;height:4px;background:var(--gold);border-radius:2px;margin:22px 0}
.body{color:var(--mut);font-weight:500;font-size:clamp(15px,1.8vw,18px);line-height:1.7;max-width:560px}
.glass{display:flex;gap:clamp(18px,4vw,52px);background:rgba(255,255,255,.06);border:1px solid var(--line);border-radius:18px;padding:20px 26px;margin-top:34px;width:fit-content;flex-wrap:wrap;backdrop-filter:blur(8px)}
.glass .g b{font-family:'Fraunces',Georgia,serif;font-size:clamp(22px,2.6vw,32px);color:var(--gold);display:block;font-weight:700}
.glass .g span{font-size:11px;letter-spacing:1.8px;color:#C9D2E5;font-weight:700;text-transform:uppercase}
ul.pts{list-style:none;padding:0;margin:26px 0 0;max-width:580px}
ul.pts li{padding:13px 0;border-bottom:1px solid var(--line);font-weight:600;font-size:clamp(14px,1.7vw,17px);line-height:1.55;color:#E7ECF6;display:flex;gap:12px}
ul.pts li b{color:var(--gold);flex-shrink:0}
ul.pts.big{max-width:940px}
ul.pts.big li{font-size:clamp(16px,2.2vw,22px);padding:19px 0;line-height:1.6;gap:16px}
.devices{display:flex;align-items:center;gap:36px;flex-wrap:wrap;margin-top:30px}
.webframe{background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.5);width:min(600px,100%)}
.webframe .bar{display:flex;align-items:center;gap:6px;background:#E9EAEE;padding:9px 14px}
.webframe .dot{width:10px;height:10px;border-radius:50%;background:#C9CDD6}
.webframe .url{flex:1;background:#fff;border-radius:8px;font-size:11.5px;color:#5E6470;font-weight:600;padding:5px 12px;margin-left:8px}
.dscr{width:100%;height:430px;overflow:hidden}
.dscr iframe{width:1180px;height:846px;border:0;transform:scale(.508);transform-origin:0 0;display:block;background:#fff}
/* slide 5: bigger phone + bigger bullets — use the whole slide */
@media(min-width:980px){.duo.app5{grid-template-columns:1fr 400px}}
.app5 ul.pts{max-width:660px}
.app5 ul.pts li{font-size:clamp(15px,1.5vw,20px)}
.app5 .body{font-size:clamp(14px,1.2vw,17px);max-width:640px}
@media(min-width:1250px){
  .app5 .iphone.big .mscr{width:332px;height:663px}
  .app5 .iphone.big .mscr iframe{transform:scale(.85);height:780px}
}
/* slide 6: full-width headline band on top, then ONE row — website left,
 * phone right. Devices are sized per breakpoint so the pair ALWAYS fits
 * side by side; spare width becomes breathing room between them. */
.si6{max-width:1560px;width:100%;justify-content:flex-start;padding-top:28px;padding-bottom:86px}
/* everything centered, read straight down: label → headline → pitch → EN VIVO */
.head6{text-align:center;margin-bottom:22px}
.head6 .kick{margin-bottom:10px}
.head6 h1{max-width:none;margin:0 auto;font-size:clamp(32px,3.2vw,54px)}
.b6t{font-size:clamp(14px,1.1vw,17px);max-width:920px;margin:12px auto 0}
.live6{display:block;background:rgba(248,180,8,.09);border:1.5px solid rgba(248,180,8,.35);border-radius:12px;padding:10px 16px;margin:12px auto 0;font-size:clamp(13px,1vw,15.5px);max-width:920px}
.demo6{display:flex;gap:28px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap}
/* the website frame keeps a real desktop shape — wide, ~16:10 */
.wf6{width:min(560px,100%)}
.wf6 .dscr{height:361px}
.wf6 .dscr iframe{width:1180px;height:760px;transform:scale(.4746)}
.ip6 .mscr{width:234px;height:474px}
.ip6 .mscr iframe{width:390px;height:790px;transform:scale(.6)}
@media(min-width:1450px){
  .wf6{width:min(640px,100%)}
  .wf6 .dscr{height:412px}
  .wf6 .dscr iframe{transform:scale(.5424)}
  .ip6 .mscr{width:273px;height:553px}
  .ip6 .mscr iframe{transform:scale(.7)}
}
@media(min-width:1680px){
  .wf6{width:min(760px,100%)}
  .wf6 .dscr{height:490px}
  .wf6 .dscr iframe{transform:scale(.644)}
  .ip6 .mscr{width:281px;height:569px}
  .ip6 .mscr iframe{transform:scale(.72)}
}
.iphone{position:relative;background:#0B1226;border:10px solid #1E2A45;border-radius:48px;padding:11px;box-shadow:0 30px 80px rgba(0,0,0,.55)}
.inotch{position:absolute;top:11px;left:50%;transform:translateX(-50%);width:110px;height:22px;background:#1E2A45;border-radius:0 0 13px 13px;z-index:2}
.mscr{width:234px;height:464px;overflow:hidden;border-radius:26px}
.mscr iframe{width:390px;height:776px;border:0;transform:scale(.6);transform-origin:0 0;background:#fff}
.iphone.big .mscr{width:330px;height:660px}
.iphone.big .mscr iframe{transform:scale(.846);height:780px}
.tl{display:grid;gap:22px;margin-top:32px}
@media(min-width:760px){.tl{grid-template-columns:repeat(3,1fr)}}
@media(min-width:980px){.tl.four{grid-template-columns:repeat(4,1fr);gap:18px}}
.tl .ph{background:rgba(255,255,255,.05);border:1px solid var(--line);border-radius:20px;padding:26px}
.tl .ph .ic{font-size:36px;display:block;margin-bottom:12px}
.tl .ph .d{color:var(--gold);font-weight:800;font-size:12px;letter-spacing:2.5px}
.tl .ph h3{font-family:'Fraunces',Georgia,serif;font-size:22px;margin:8px 0 8px;font-weight:700}
.tl .ph p{color:var(--mut);font-size:14px;font-weight:500;line-height:1.65}
.tl .ph.hot{border:1.5px solid var(--gold);background:rgba(248,180,8,.1);box-shadow:0 18px 48px rgba(248,180,8,.14)}
.amt{font-family:'Fraunces',Georgia,serif;font-size:clamp(72px,11vw,130px);font-weight:700;line-height:1;color:#fff;margin-top:6px}
.amt small{font-size:clamp(20px,2.8vw,30px);color:var(--mut)}
.stack{border:1px solid var(--line);border-radius:18px;overflow:hidden;max-width:560px}
.srow{display:flex;justify-content:space-between;align-items:center;gap:14px;padding:13px 18px;border-bottom:1px solid var(--line);font-weight:600;font-size:14.5px;color:#E7ECF6}
.srow s{color:#8E99B5;font-weight:700;white-space:nowrap}
.srow.tot{background:rgba(255,255,255,.05);border-bottom:none;font-weight:800}
.srow.tot s{color:#C9D2E5}
.pcard{background:#fff;color:#101B30;border-radius:26px;padding:34px 32px;text-align:center;box-shadow:0 34px 90px rgba(248,180,8,.18),0 30px 70px rgba(0,0,0,.45);width:min(340px,100%)}
.pcard .pk{color:#D99E00;font-weight:800;font-size:11px;letter-spacing:2.5px}
.pcard .pamt{font-family:'Fraunces',Georgia,serif;font-size:74px;font-weight:700;line-height:1;margin-top:10px}
.pcard .pamt small{font-size:24px;color:#67718A}
.pcard .psetup{color:#67718A;font-weight:700;font-size:14px;margin-top:8px}
.pcard .pdiv{height:1px;background:#E9EAEE;margin:20px 0}
.pcard .prow{font-weight:700;font-size:14px;padding:5px 0;text-align:left}
.pcard .p3{margin-top:14px}
.pcard .p3row{display:flex;align-items:center;justify-content:space-between;gap:10px;text-align:left;border:1.5px solid #E9EAEE;border-radius:13px;padding:11px 14px;margin-bottom:8px}
.pcard .p3row.hot{border-color:#F8B408;background:#FFFBEF}
.pcard .p3row .p3t{font-weight:700;font-size:12.5px;color:#3A4356;line-height:1.35;flex:1}
.pcard .p3row b{font-family:'Fraunces',Georgia,serif;font-size:24px;white-space:nowrap}
.pcard .p3row b small{font-size:12px;color:#67718A;font-family:Inter,Arial,sans-serif;font-weight:700}
.chat{background:#fff;border-radius:22px;padding:16px;width:min(350px,100%);box-shadow:0 30px 70px rgba(0,0,0,.5)}
.ch-head{color:#5E6470;font-weight:800;font-size:12px;text-align:center;padding-bottom:10px;border-bottom:1px solid #EDF0F5;margin-bottom:12px}
.bub{max-width:85%;border-radius:16px;padding:10px 14px;font-size:13.5px;font-weight:600;line-height:1.5;margin-bottom:8px}
.bub.them{background:#F0F2F6;color:#16202E;border-bottom-left-radius:5px}
.bub.me{background:#101B30;color:#fff;margin-left:auto;border-bottom-right-radius:5px}
.ch-foot{color:#9AA0AC;font-weight:700;font-size:11.5px;text-align:center;padding-top:8px}
#chatlog{max-height:300px;overflow-y:auto;display:flex;flex-direction:column}
.ch-in{display:flex;gap:8px;margin-top:10px}
.ch-in input{flex:1;border:1.5px solid #E2E6ED;border-radius:11px;padding:11px 13px;font-size:13.5px;font-weight:600;outline:none;color:#16202E;min-width:0}
.ch-in input:focus{border-color:#F8B408}
.ch-in button{background:#F8B408;color:#101B30;border:none;border-radius:11px;padding:0 18px;font-weight:800;font-size:17px;cursor:pointer}
.bub.typing{color:#9AA0AC;background:#F0F2F6;font-weight:800;letter-spacing:2px}
.duo{display:grid;gap:44px;align-items:start;margin-top:6px}
@media(min-width:980px){.duo{grid-template-columns:1fr 350px}}
.photocard{background:#fff;border-radius:6px;padding:12px 12px 0;box-shadow:0 30px 70px rgba(0,0,0,.5);transform:rotate(2deg);width:min(350px,100%)}
.photocard img{width:100%;border-radius:3px;display:block}
.photocard .cap{display:block;text-align:center;color:#3A4252;font-weight:700;font-size:13px;padding:13px 0;font-family:'Fraunces',Georgia,serif}
.photocard.empty{display:flex;flex-direction:column;align-items:center;justify-content:center;border:2px dashed rgba(255,255,255,.3);background:rgba(255,255,255,.04);box-shadow:none;min-height:300px;padding:24px;transform:none}
.photocard.empty span{font-size:40px}
.photocard.empty p{color:var(--mut);font-weight:700;font-size:13.5px;text-align:center;line-height:1.6;margin-top:10px}
/* Team slide (deck slide 2): one centered vertical axis — heading, intro,
   proof chips, logo, 5×3 team grid, houses row. Everything shares max-width
   920 so edges line up. */
.team-slide .s-in{text-align:center;display:flex;flex-direction:column;align-items:center}
.team-slide .kick,.team-slide h1{text-align:center}
.team-slide .rule{margin:20px auto}
.team-slide .body{max-width:660px}
.t-intro{margin:0 auto}
.t-pts{display:flex;flex-wrap:wrap;justify-content:center;gap:10px;margin:24px auto 0;max-width:820px}
.t-pts span{background:rgba(255,255,255,.05);border:1px solid var(--line);border-radius:99px;padding:9px 17px;font-size:12.5px;font-weight:700;color:#E7ECF6}
.t-pts span::before{content:"✓ ";color:var(--gold);font-weight:800}
.stblogo{display:inline-flex;flex-direction:column;align-items:center;gap:9px;text-decoration:none;background:#fff;border-radius:16px;padding:18px 30px 13px;margin:38px auto 0;box-shadow:0 18px 44px rgba(0,0,0,.4);transition:transform .15s}
.stblogo:hover{transform:translateY(-2px)}
.stblogo img{width:min(220px,64vw);display:block}
.stblogo span{color:#1877F2;font-weight:800;font-size:13px}
.teamgrid{display:grid;grid-template-columns:repeat(5,1fr);gap:26px 16px;width:100%;max-width:920px;margin:34px auto 0}
.tg{text-align:center}
.tg img{width:76px;height:76px;border-radius:99px;object-fit:cover;border:2px solid rgba(248,180,8,.55)}
.tg b{display:block;font-size:12.5px;font-weight:800;color:#fff;margin-top:8px;line-height:1.2}
.tg small{display:block;font-size:10px;color:var(--mut);font-weight:600;margin-top:2px}
.homerow{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;width:100%;max-width:920px;margin:32px auto 0}
.homerow img{width:100%;aspect-ratio:3/2;object-fit:cover;border-radius:10px;box-shadow:0 16px 40px rgba(0,0,0,.4)}
@media(max-width:720px){.teamgrid{grid-template-columns:repeat(3,1fr);gap:20px 10px}.homerow{grid-template-columns:repeat(2,1fr)}}
.bbar{display:flex;align-items:center;justify-content:space-between;padding:14px clamp(16px,3vw,30px);border-top:1px solid var(--line);background:var(--navy)}
.bbar .pn{display:flex;gap:10px}
.bbar button{border-radius:11px;font-weight:800;font-size:14px;padding:12px 22px;cursor:pointer}
.bbar .prev{background:transparent;color:#fff;border:1.5px solid rgba(255,255,255,.25)}
.bbar .next{background:var(--gold);color:var(--navy);border:none}
.bbar .ct{font-family:'Fraunces',Georgia,serif;font-size:15px;color:var(--mut)}
.langpill{position:fixed;top:16px;right:18px;z-index:45;background:rgba(255,255,255,.95);color:#101B30;border-radius:99px;padding:9px 18px;font-weight:800;font-size:13px;text-decoration:none;box-shadow:0 10px 28px rgba(0,0,0,.35)}
@media(max-width:899px){
  aside{position:fixed;z-index:60;left:0;top:0;bottom:0;transform:translateX(-100%);transition:transform .25s ease;width:260px}
  aside.open{transform:none}
  .mtop{display:flex !important}
  .scrim{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:55;display:none}
  .scrim.on{display:block}
  .langpill{top:auto;bottom:74px;right:14px}
}
.mtop{display:none;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--navy);border-bottom:1px solid var(--line)}
.mtop .mt-b{background:none;border:1.5px solid rgba(255,255,255,.25);color:#fff;border-radius:10px;padding:8px 14px;font-weight:800;font-size:13px;cursor:pointer}
.mtop b em{color:var(--gold);font-style:normal}
#ckit{display:none;position:fixed;right:18px;bottom:70px;z-index:80;background:#fff;color:#101B30;border-radius:16px;padding:14px 16px;box-shadow:0 24px 60px rgba(0,0,0,.5);width:280px}
#ckit.on{display:block}
#ckit .ck-t{font-weight:800;font-size:13px;margin-bottom:10px}
#ckit .ck-t small{color:#9AA0AC;font-weight:600;font-size:10.5px}
#ckit .ck-row{display:flex;align-items:center;gap:8px;padding:6px 0;font-weight:700;font-size:13px}
#ckit .ck-row span{flex:1}
#ckit button{background:#F8B408;color:#101B30;border:none;border-radius:8px;padding:6px 12px;font-weight:800;font-size:12px;cursor:pointer}
#ckit .ck-k{color:#9AA0AC;font-size:10.5px;font-weight:600;margin-top:8px}
#ktoast{display:none;position:fixed;left:18px;bottom:70px;z-index:80;background:#34A853;color:#fff;border-radius:99px;width:34px;height:34px;align-items:center;justify-content:center;font-weight:800}
#ktoast.on{display:flex}
.ct{cursor:default;user-select:none}
</style></head><body>
<a class="langpill" href="${L.langHref}">${L.langBtn}</a>
<div class="layout">
<aside id="sb">
  <div class="sb-brand"><img src="/brand-logo.png" alt="ALTO Pro"></div>
  ${FENCE_ENABLED ? `<div style="padding:0 18px 12px">
    <select onchange="if(this.value)location.href=this.value" aria-label="trade"
      style="width:100%;padding:8px 12px;border-radius:99px;border:1.5px solid #E9EAEE;background:#F7F8FA;font-weight:800;font-size:12.5px;color:#101B30;cursor:pointer;font-family:inherit">
      <option value="?${en ? "lang=en" : ""}"${!fence ? " selected" : ""}>🏠 ${en ? "Roofs" : "Techos"}</option>
      <option value="?trade=cercas${en ? "&lang=en" : ""}"${fence ? " selected" : ""}>🪵 ${en ? "Fences" : "Cercas"}</option>
    </select>
  </div>` : ""}
  <div class="sb-label">${L.presentation}</div>
  <nav id="nav"></nav>
  <div class="sb-foot">${L.forClients}</div>
</aside>
<div class="scrim" id="scrim" onclick="toggleSb(false)"></div>
<main>
<div class="mtop"><button class="mt-b" onclick="toggleSb(true)">${L.menu}</button><b>ALTO <em>PRO</em></b><span style="width:64px"></span></div>
<div class="stage" id="stage">

<section class="slide" data-t="${L.t1}">
  <img class="s-bg" src="/api/roofimg?lat=26.3828&lng=-98.8198&zoom=17" alt=""><div class="s-veil"></div>
  <div class="s-in">
    <p class="kick">${L.k1}</p>
    <h1>${L.h1a}<br><em>${L.h1b}</em></h1>
    <div class="rule"></div>
    <p class="body">${L.b1}</p>
    <div class="glass">
      <div class="g"><b>${L.g1}</b><span>${L.g1s}</span></div>
      <div class="g"><b>${L.g2}</b><span>${L.g2s}</span></div>
      <div class="g"><b>${L.g3}</b><span>${L.g3s}</span></div>
    </div>
  </div>
</section>

<section class="slide team-slide" data-t="${L.t2}">
  ${founderBg ? `<img class="s-bg" src="/landing/founder-bg.jpg" alt="" style="opacity:.14">` : ""}
  <div class="s-veil"></div>
  <div class="s-in" style="max-width:1000px">
    <p class="kick">${L.k2}</p>
    <h1>${L.h2a} <em>${L.h2b}</em></h1>
    <div class="rule"></div>
    <p class="body t-intro">${L.b2}</p>
    <div class="t-pts">
      <span>${L.p2a}</span>
      <span>${L.p2b}</span>
      <span>${L.p2c}</span>
    </div>
    ${teamPhoto
      ? `<div class="photocard" style="margin:36px auto 0"><img src="/landing/team.jpg" alt=""><span class="cap">${L.cap2}</span></div>`
      : deckTeam.length >= 3
        ? `${stbLogo ? `<a class="stblogo" href="https://www.facebook.com/southtexasbuilders" target="_blank" rel="noopener"><img src="/landing/stb-logo.png" alt="South Texas Builders"><span>${en ? "See us on Facebook →" : "Míranos en Facebook →"}</span></a>` : ""}
           <div class="teamgrid">${deckTeam.map((t) => `<div class="tg"><img src="/landing/team/${t.f}" alt="${t.name}" loading="lazy" width="76" height="76"><b>${t.name}</b><small>${en ? t.roleEN : t.role}</small></div>`).join("")}</div>
           ${deckHomes.length >= 3 ? `<div class="homerow">${deckHomes.slice(0, 4).map((f) => `<img src="/landing/homes/${f}" alt="" loading="lazy">`).join("")}</div>` : ""}`
        : ""}
  </div>
</section>

<section class="slide" data-t="${L.t3}">
  <div class="s-veil"></div>
  <div class="s-in" style="max-width:1150px">
    <p class="kick">${L.k3}</p>
    <h1>${L.h3a}<br><em>${L.h3b}</em></h1>
    <div class="rule"></div>
    <ul class="pts big">
      <li><b>📵</b><span>${L.p3a}</span></li>
      <li><b>🕐</b><span>${L.p3b}</span></li>
      <li><b>🌐</b><span>${L.p3c}</span></li>
      <li><b>🤖</b><span>${L.p3d}</span></li>
    </ul>
    <p class="body" style="margin-top:28px;font-size:clamp(17px,2.3vw,23px);max-width:940px"><b style="color:#F8B408">${L.c3}</b></p>
  </div>
</section>

<section class="slide" data-t="${L.t4}">
  <div class="s-veil"></div>
  <div class="s-in" style="max-width:1180px">
    <p class="kick">${L.k4}</p>
    <h1>${L.h4a} <em>${L.h4b}</em></h1>
    <p class="body" style="margin-top:14px">${L.b4}</p>
    <div class="devices">
      <div class="webframe"><div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="url">tunegocio.com</span></div><div class="dscr"><iframe data-src="${exPage}?embed=1" title="Web"></iframe></div></div>
      <div class="iphone"><div class="inotch"></div><div class="mscr"><iframe data-src="${exPage}?embed=1" title="Mobile"></iframe></div></div>
    </div>
  </div>
</section>

<section class="slide" data-t="${L.t5}">
  <div class="s-veil"></div>
  <div class="s-in" style="max-width:1340px">
    <p class="kick">${L.k5}</p>
    <h1>${L.h5a}<br><em>${L.h5b}</em></h1>
    <div class="rule"></div>
    <div class="duo app5">
      <div>
        <ul class="pts" style="margin-top:0">
          <li><b>🛰️</b><span>${L.p5a}</span></li>
          <li><b>📥</b><span>${L.p5b}</span></li>
          <li><b>🤖</b><span>${L.p5c}</span></li>
          <li><b>🧾</b><span>${L.p5d}</span></li>
        </ul>
        <p class="body" style="margin-top:22px">${L.live5}</p>
      </div>
      <div class="iphone big"><div class="inotch"></div><div class="mscr"><iframe data-src="${appDemo}" title="App"></iframe></div></div>
    </div>
  </div>
</section>

<section class="slide" data-t="${L.t6}">
  <div class="s-veil"></div>
  <div class="s-in si6">
    <div class="head6">
      <p class="kick">${L.k6}</p>
      <h1>${L.h6a} <em>${L.h6b}</em></h1>
      <p class="body b6t">${L.b6}</p>
      <p class="body live6">${L.live6}</p>
    </div>
    <div class="demo6">
      <div class="webframe wf6"><div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="url">tunegocio.com</span></div><div class="dscr"><iframe data-src="${exPage}?embed=1&chat=open" title="Web + chat"></iframe></div></div>
      <div class="iphone ip6"><div class="inotch"></div><div class="mscr"><iframe id="appf6" data-src="${appDemo}" title="App"></iframe></div></div>
    </div>
  </div>
</section>

<section class="slide" data-t="${L.t7}">
  <div class="s-veil"></div>
  <div class="s-in" style="max-width:1150px">
    <p class="kick">${L.k7}</p>
    <h1>${L.h7a} <em>${L.h7b}</em></h1>
    <div class="rule"></div>
    <div class="duo" style="align-items:center">
      <div>
        <p class="body" style="font-size:13.5px;margin-bottom:14px">${L.b7}</p>
        <div class="stack">
          <div class="srow"><span>${L.s7a}</span><s>$1,500+</s></div>
          <div class="srow"><span>${L.s7b}</span><s>$250${L.mo}</s></div>
          <div class="srow"><span>${L.s7c}</span><s>$300${L.mo}</s></div>
          <div class="srow"><span>${L.s7d}</span><s>$99${L.mo}</s></div>
          <div class="srow"><span>${L.s7e}</span><s>$50${L.mo}</s></div>
          <div class="srow tot"><span>${L.s7tot}</span><s>$1,500+</s></div>
        </div>
        <p class="body" style="margin-top:20px;font-size:14px">${L.roi7}</p>
      </div>
      <div class="pcard">
        <p class="pk">${L.pk7}</p>
        <div class="p3">
          <div class="p3row"><span class="p3t">${L.pl7a}</span><b>$67<small>${L.mo}</small></b></div>
          <div class="p3row"><span class="p3t">${L.pl7b}</span><b>$197<small>${L.mo}</small></b></div>
          <div class="p3row hot"><span class="p3t">${L.pl7c}</span><b>$297<small>${L.mo}</small></b></div>
        </div>
        <p class="psetup">${L.setup7}</p>
        <div class="pdiv"></div>
        <p class="prow">${L.pr7a}</p>
        <p class="prow">${L.pr7b}</p>
        <p class="prow">${L.pr7c}</p>
      </div>
    </div>
  </div>
</section>

<section class="slide" data-t="${L.t8}">
  <img class="s-bg" src="/api/roofimg?lat=26.3828&lng=-98.8198&zoom=18" alt=""><div class="s-veil"></div>
  <div class="s-in" style="max-width:1150px">
    <p class="kick">${L.k8}</p>
    <h1>${L.h8a} <em>${L.h8b}</em></h1>
    <div class="rule"></div>
    <p class="body">${L.b8}</p>
    <div class="tl four">
      <div class="ph hot"><span class="ic">💳</span><span class="d">${L.d8a}</span><h3>${L.t8a}</h3><p>${L.x8a}</p></div>
      <div class="ph"><span class="ic">📲</span><span class="d">${L.d8b}</span><h3>${L.t8b}</h3><p>${L.x8b}</p></div>
      <div class="ph"><span class="ic">🤝</span><span class="d">${L.d8c}</span><h3>${L.t8c}</h3><p>${L.x8c}</p></div>
      <div class="ph"><span class="ic">🚀</span><span class="d">${L.d8d}</span><h3>${L.t8d}</h3><p>${L.x8d}</p></div>
    </div>
    <p class="body" style="margin-top:26px;font-size:15px"><b style="color:#fff">${L.c8}</b></p>
  </div>
</section>

</div>
<div class="bbar">
  <div class="pn"><button class="prev" onclick="go(-1)">${L.prev}</button><button class="next" onclick="go(1)">${L.next}</button></div>
  <span class="ct" id="ct">1 / 8</span>
</div>
</main>
</div>
<div id="ckit">
  <p class="ck-t">🔒 Closer · <small>doble clic en el contador o tecla C</small></p>
  <div class="ck-row"><span>💳 Pago $67</span><button onclick="kCopy(K.pay.pro,this)">Copiar</button></div>
  <div class="ck-row"><span>💳 Pago $197</span><button onclick="kCopy(K.pay.widget,this)">Copiar</button></div>
  <div class="ck-row"><span>💳 Pago $297</span><button onclick="kCopy(K.pay.complete,this)">Copiar</button><button onclick="kOpen()">Abrir</button></div>
  <div class="ck-row"><span>👋 Bienvenida</span><button onclick="kCopy(K.wel,this)">Copiar</button></div>
  <div class="ck-row"><span>👀 Msj demo</span><button onclick="kCopy(K.dem,this)">Copiar</button></div>
  <p class="ck-k">Teclas rápidas: <b>P</b> pago $297 · <b>B</b> bienvenida · <b>D</b> demo · <b>O</b> abrir pago</p>
</div>
<div id="ktoast">✓</div>
<script>
var EN=${en ? "true" : "false"};
var slides=[].slice.call(document.querySelectorAll('.slide')),cur=0,nav=document.getElementById('nav');
slides.forEach(function(s,i){
  var b=document.createElement('button');b.className='nav-it';
  b.innerHTML='<span class="no">'+String(i+1).padStart(2,'0')+'</span>'+s.dataset.t;
  b.onclick=function(){show(i);toggleSb(false)};nav.appendChild(b);
});
function show(i){
  cur=Math.max(0,Math.min(slides.length-1,i));
  slides.forEach(function(s,k){s.classList.toggle('on',k===cur)});
  [].slice.call(nav.children).forEach(function(b,k){b.classList.toggle('on',k===cur)});
  document.getElementById('ct').textContent=(cur+1)+' / '+slides.length;
  [].slice.call(slides[cur].querySelectorAll('iframe[data-src]')).forEach(function(f){if(!f.src)f.src=f.dataset.src});
  location.hash=cur+1;
}
function go(d){show(cur+d)}
function cp(btn,t){navigator.clipboard.writeText(t);btn.textContent='✓'}
/* hidden closer kit: double-click the counter or press C */
var K={pay:${JSON.stringify(STRIPE_LINKS)},wel:${JSON.stringify(welcome)},dem:${JSON.stringify(wMsg)}};
function kToast(){var t=document.getElementById('ktoast');t.classList.add('on');setTimeout(function(){t.classList.remove('on')},700)}
function kCopy(v,btn){
  if(!v){alert('Falta configurar los links de pago en Render (STRIPE_LINK_PRO / STRIPE_LINK_WIDGET / STRIPE_LINK_COMPLETE)');return}
  navigator.clipboard.writeText(v);kToast();
  if(btn){btn.textContent='✓';setTimeout(function(){btn.textContent='Copiar'},900)}
}
function kOpen(){if(!K.pay.complete){alert('Falta configurar STRIPE_LINK_COMPLETE en Render');return}window.open(K.pay.complete,'_blank')}
document.getElementById('ct').addEventListener('dblclick',function(){document.getElementById('ckit').classList.toggle('on')});
document.addEventListener('keydown',function(e){
  if(/INPUT|TEXTAREA/.test(e.target.tagName))return;
  var k=e.key.toLowerCase();
  if(k==='c')document.getElementById('ckit').classList.toggle('on');
  if(k==='p')kCopy(K.pay.complete);
  if(k==='b')kCopy(K.wel);
  if(k==='d')kCopy(K.dem);
  if(k==='o')kOpen();
});
// Slide 6 live wire: the website's chat widget announces a captured phone
// number (postMessage) → relay it into the app mockup so the prospect
// watches their own message become a lead on the phone.
window.addEventListener('message',function(e){
  var d=e.data;if(!d||d.alto!=='lead')return;
  var f=document.getElementById('appf6');
  if(f&&f.contentWindow)f.contentWindow.postMessage(d,'*');
});
document.addEventListener('keydown',function(e){if(e.key==='ArrowRight')go(1);if(e.key==='ArrowLeft')go(-1)});
show(parseInt(location.hash.slice(1))-1||0);
</script>
</body></html>`);
});

/* ── Contractor logos ──
 * Stored by content hash; the app re-uploads automatically whenever it shares,
 * so logos self-heal after server restarts. */
const logosDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "logos");
fs.mkdirSync(logosDir, { recursive: true });

app.post("/api/logo", (req, res) => {
  const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.data || ""));
  if (!m) return res.status(400).json({ error: "bad image" });
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > 150000) return res.status(413).json({ error: "too large" });
  const id = crypto.createHash("sha1").update(buf).digest("hex").slice(0, 16) + (m[1] === "png" ? ".png" : ".jpg");
  try { fs.writeFileSync(path.join(logosDir, id), buf); } catch (e) { return res.status(500).json({ error: e.message }); }
  res.json({ id });
});

app.get("/api/logo/:id", (req, res) => {
  const id = String(req.params.id);
  if (!/^[a-f0-9]{16}\.(png|jpg)$/.test(id)) return res.status(404).end();
  const p = path.join(logosDir, id);
  if (!fs.existsSync(p)) return res.status(404).end();
  res.set("Content-Type", id.endsWith(".png") ? "image/png" : "image/jpeg");
  res.set("Cache-Control", "public, max-age=604800");
  res.send(fs.readFileSync(p));
});

/* ── Public invoice/estimate page ──
 * All data travels in the link itself (base64url JSON in ?d=) — nothing is
 * stored server-side, so links survive restarts and redeploys. */
app.get("/i", (req, res) => {
  let d;
  try {
    const b64 = String(req.query.d || "").replace(/-/g, "+").replace(/_/g, "/");
    d = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  } catch {
    return res.status(400).send("Invalid link");
  }
  const es = d.lang !== "en";
  const L = es
    ? { inv: "FACTURA", est: "COTIZACIÓN", for: "Preparado para", item: "Concepto", subtotal: "Subtotal", deposit: "Depósito recibido", due: "SALDO PENDIENTE", paid: "PAGADO", how: "CÓMO PAGAR", zelle: "Zelle", cash: "Efectivo o cheque aceptado", print: "🖨️ Imprimir / Guardar PDF", made: "Hecho con ALTO Pro", meas: "Medición satelital del techo", date: "Fecha", area: "Área del techo", pitch: "Inclinación", sqs: "Cuadros (squares)", imgOf: "Imagen satelital", valid: "Esta cotización es válida por 30 días.", sig: "Autorizado por (firma del cliente)", sigDate: "Fecha", includes: "LO QUE INCLUYE", warranty: "GARANTÍA", measNote: "≈ Medición satelital preliminar — es un estimado. El número final se confirma con la inspección en sitio.", rec: "RECIBO DE PAGO", recd: "Recibido", paidTotal: "Total pagado", mCash: "Efectivo", mCheck: "Cheque" }
    : { inv: "INVOICE", est: "QUOTE", for: "Prepared for", item: "Item", subtotal: "Subtotal", deposit: "Deposit received", due: "BALANCE DUE", paid: "PAID", how: "HOW TO PAY", zelle: "Zelle", cash: "Cash or check accepted", print: "🖨️ Print / Save PDF", made: "Made with ALTO Pro", meas: "Satellite roof measurement", date: "Date", area: "Roof area", pitch: "Pitch", sqs: "Squares", imgOf: "Satellite imagery", valid: "This quote is valid for 30 days.", sig: "Authorized by (client signature)", sigDate: "Date", includes: "WHAT'S INCLUDED", warranty: "WARRANTY", measNote: "≈ Preliminary satellite measurement — this is an estimate. Final numbers are confirmed at the on-site inspection.", rec: "PAYMENT RECEIPT", recd: "Received", paidTotal: "Total paid", mCash: "Cash", mCheck: "Check" };
  const fmtM = (n) => "$" + Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
  const esc = (s) => String(s || "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  const bal = (d.tot || 0) - (d.dep || 0);
  // The whole `d` object is attacker-controllable (base64 ?d= link). Coerce every
  // coordinate to a finite number so nothing but digits can land in a src="..."
  // attribute — closes the reflected-XSS/attribute-breakout vector entirely.
  const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : null; };
  const pair = (p) => (Array.isArray(p) ? [num(p[0]), num(p[1])] : [null, null]);
  const la = d.m ? num(d.m.la) : null, ln = d.m ? num(d.m.ln) : null;
  const bbN = Array.isArray(d.m?.bb) ? d.m.bb.map(num) : null;
  const bbOk = bbN && bbN.length === 4 && bbN.every((n) => n != null);
  const outN = Array.isArray(d.m?.o) ? d.m.o.map(pair).filter(([a, b]) => a != null && b != null) : [];
  const linN = Array.isArray(d.m?.l) ? d.m.l.map((run) => (Array.isArray(run) ? run.map(pair).filter(([a, b]) => a != null && b != null) : [])).filter((run) => run.length) : [];
  // sv/av: 0 = the contractor unchecked that image on a quick invoice.
  const img = la != null && ln != null && d.m?.av !== 0
    ? `/api/roofimg?lat=${la}&lng=${ln}` +
      (bbOk ? `&bbox=${bbN.join(",")}` : "") +
      (!bbOk && linN.length ? "&zoom=19" : "") +
      (outN.length ? `&outline=${outN.map((p) => p.join(",")).join(";")}` : "") +
      (linN.length ? `&lines=${linN.map((run) => run.map((p) => p.join(",")).join("|")).join(";")}` : "")
    : null;
  // A real photo of the house front (Street View) — hidden where there's no coverage.
  const street = la != null && ln != null && d.m?.sv !== 0 ? `/api/streetview?lat=${la}&lng=${ln}` : null;
  const streetYear = d.m && d.m.sd ? String(d.m.sd).replace(/\D/g, "").slice(0, 4) || null : null;
  // Back-to-app button when the contractor previews from inside the app (?app=1).
  const iBack = req.query.app != null ? `<div class="noprint" style="padding:12px 16px 0"><a href="/" onclick="if(history.length>1){history.back();return false}" style="display:inline-flex;align-items:center;gap:5px;background:#fff;border:1.5px solid #E6E8EC;border-radius:999px;padding:8px 13px;font-weight:800;font-size:14px;color:#101B30;text-decoration:none">‹ ${es ? "Volver a la app" : "Back to app"}</a></div>` : "";
  res.send(`<!doctype html><html lang="${es ? "es" : "en"}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(d.biz)} · ${d.k === "inv" ? L.inv : L.est} #${esc(d.inv)}</title>
<style>
  body{margin:0;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;background:#F4F5F7;color:#101B30}
  .page{max-width:560px;margin:0 auto;background:#fff;min-height:100vh}
  .hd{background:#fff;color:#101B30;padding:28px 24px 18px;text-align:center;border-bottom:2.5px solid #101B30}
  .hd img.lg{max-height:88px;max-width:72%;display:block;margin:0 auto 12px}
  .hd .biz{font-size:25px;font-weight:800;letter-spacing:.03em;color:#101B30}
  .hd .sub{color:#67718A;font-size:13px;margin-top:3px;font-weight:600}
  .tag{display:inline-block;background:#fff;color:#101B30;border:1.5px solid #101B30;font-size:12px;font-weight:800;border-radius:99px;padding:3px 14px;margin-top:12px;letter-spacing:.08em}
  .tag.paid{background:#1E9E5A;color:#fff;border-color:#1E9E5A}
  .sec{padding:18px 24px;border-bottom:1px solid #E6E8EC}
  .lbl{font-size:11px;font-weight:700;letter-spacing:.1em;color:#67718A;margin-bottom:6px}
  .cust{font-size:17px;font-weight:700}.addr{font-size:14px;color:#67718A}
  img.roof{width:100%;display:block}
  .roofwrap{position:relative;border-radius:12px;overflow:hidden;border:1px solid #E6E8EC}
  .roofbadges{position:absolute;left:0;right:0;bottom:0;display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:9px 10px;background:linear-gradient(to top,rgba(11,19,34,.9),rgba(11,19,34,0))}
  .rb{border-radius:8px;padding:5px 10px;font-weight:800;font-size:15px;line-height:1}
  .rb-sq{background:#F8B408;color:#101B30}
  .rb-pi{background:rgba(255,255,255,.95);color:#101B30}
  .rb-ft{background:rgba(255,255,255,.18);color:#fff;font-size:12px;font-weight:700}
  .cap{font-size:11px;color:#67718A;margin-top:6px}
  .scope{list-style:none;padding:0;margin:0}
  .scope li{padding:7px 0 7px 26px;position:relative;font-size:14.5px;line-height:1.4;border-bottom:1px solid #F0F2F6}
  .scope li:last-child{border-bottom:none}
  .scope li:before{content:"✓";position:absolute;left:0;top:7px;color:#1E9E5A;font-weight:900}
  .warr{background:#EAF8EF;border:1.5px solid #BFE6CC;border-radius:12px;padding:13px 15px;display:flex;gap:10px;align-items:flex-start}
  .warr .ic{font-size:20px;line-height:1.2}
  .warr .wl{font-size:10px;font-weight:800;letter-spacing:.1em;color:#1E9E5A;display:block;margin-bottom:2px}
  .warr .wt{font-size:14.5px;font-weight:700;color:#1E7B3C;line-height:1.4}
  table{width:100%;border-collapse:collapse;font-size:15px}
  td{padding:7px 0}td:last-child{text-align:right;font-weight:700}
  .tot td{border-top:2px solid #E6E8EC;font-size:15px}
  .due td{font-size:20px;font-weight:800}
  .due .amt{color:${d.paid ? "#1E9E5A" : "#F8B408"}}
  .pay{background:#FEF5DC;border-radius:12px;padding:14px 16px;font-size:15px}
  .pay b{display:block;font-size:11px;letter-spacing:.1em;color:#F8B408;margin-bottom:6px}
  .btn{display:block;width:calc(100% - 48px);margin:18px 24px;background:#F8B408;color:#fff;border:none;border-radius:12px;padding:15px;font-size:16px;font-weight:800;cursor:pointer}
  .ft{text-align:center;color:#9DA8C4;font-size:12px;padding:14px 0 26px}
  @media print{.btn,.noprint{display:none}body{background:#fff}.page{max-width:none}}
  @page{margin:12mm}
</style></head><body><div class="page">${iBack}
<div class="hd">
  ${d.lg ? `<img class="lg" src="/api/logo/${esc(d.lg)}" alt="" onerror="this.style.display='none'">` : ""}
  <div class="biz">${esc(d.biz).toUpperCase()}</div>
  <div class="sub">${d.k === "rec" ? L.rec : d.k === "inv" ? L.inv : L.est} #${esc(d.inv)} · ${L.date}: ${esc(d.dt)}${d.ph ? " · " + esc(d.ph) : ""}</div>
  ${d.em || d.lic ? `<div class="sub">${[d.em && esc(d.em), d.lic && (es ? "Licencia: " : "License: ") + esc(d.lic)].filter(Boolean).join(" · ")}</div>` : ""}
  ${d.paid ? `<span class="tag paid">✓ ${L.paid}</span>` : `<span class="tag">${d.k === "rec" ? L.rec : d.k === "inv" ? L.inv : L.est}</span>`}
</div>
<div class="sec"><div class="lbl">${L.for}</div><div class="cust">${esc(d.cn)}</div><div class="addr">${esc(d.ca)}</div></div>
${d.k === "rec" && d.pay && typeof d.pay === "object" && Number(d.pay.a) > 0 ? `<div class="sec">
<div style="background:#EAF8EF;border:2px solid #1E9E5A;border-radius:14px;padding:16px;text-align:center">
  <div style="font-size:12px;font-weight:800;letter-spacing:1.5px;color:#1E7B3C">✓ ${L.recd}</div>
  <div style="font-size:34px;font-weight:800;color:#101B30;margin:4px 0">${fmtM(Number(d.pay.a))}</div>
  <div style="font-size:13px;font-weight:700;color:#5A6478">${esc(String(d.pay.m || "").slice(0, 24))} · ${esc(d.dt)}</div>
</div></div>` : ""}
${img ? `<div class="sec"><div class="lbl">${d.ms ? L.meas : `🛰️ ${es ? "La propiedad" : "The property"}`}</div>
<div class="roofwrap"><img class="roof" src="${img}" alt="" onclick="zoomImg(this.src)" style="cursor:zoom-in">
${d.ms ? `<div class="roofbadges"><span class="rb rb-sq">${esc(d.ms.sq)} ${es ? "CUADROS" : "SQUARES"}</span><span class="rb rb-pi">${esc(d.ms.pi)}/12</span><span class="rb rb-ft">${Number(d.ms.ra).toLocaleString()} sq ft</span></div>` : ""}</div>
<div class="cap">🛰️ ${d.ms && d.ms.id ? "Google · " + esc(d.ms.id) : esc(d.ti)}</div>
${d.k === "est" && d.ms ? `<div class="cap" style="margin-top:4px">${L.measNote}</div>` : ""}</div>` : `<div class="sec"><div class="cust">${esc(d.ti)}</div></div>`}
${street ? `<div class="sec" id="streetsec"><div class="lbl">🏠 ${es ? "La casa" : "The home"}</div>
<img src="${street}" alt="" onclick="zoomImg(this.src)" style="width:100%;display:block;border-radius:12px;border:1px solid #E6E8EC;cursor:zoom-in" onerror="var s=document.getElementById('streetsec');if(s)s.style.display='none'">
${streetYear ? `<div class="cap">📷 ${es ? "Foto del exterior" : "Exterior photo"} · ${streetYear}</div>` : ""}</div>` : ""}
${Array.isArray(d.sc) && d.sc.length ? `<div class="sec"><div class="lbl">${L.includes}</div><ul class="scope">${d.sc.map((s) => `<li>${esc(s)}</li>`).join("")}</ul></div>` : ""}
<div class="sec"><table>
${(d.li || []).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${fmtM(v)}</td></tr>`).join("")}
<tr class="tot"><td>${L.subtotal}</td><td>${fmtM(d.tot)}</td></tr>
${d.dep ? `<tr><td>${d.k === "rec" ? L.paidTotal : L.deposit}</td><td style="color:#1E9E5A">–${fmtM(d.dep)}</td></tr>` : ""}
<tr class="due"><td>${d.paid ? L.paid : L.due}</td><td class="amt">${d.paid ? "✓" : fmtM(bal)}</td></tr>
</table></div>
${d.wr ? `<div class="sec"><div class="warr"><span class="ic">🛡️</span><span><span class="wl">${L.warranty}</span><span class="wt">${esc(d.wr)}</span></span></div></div>` : ""}
<div class="sec"><div class="pay"><b>${L.how}</b>${d.zelle ? `🏦 ${L.zelle}: <strong>${esc(d.zelle)}</strong><br>` : ""}💵 ${L.cash}</div></div>
${d.k === "est" && !d.paid ? `<div class="sec" style="font-size:12px;color:#67718A">
<p>${L.valid}</p>
<div style="display:flex;gap:24px;margin-top:34px">
  <div style="flex:2;border-top:1.5px solid #101B30;padding-top:5px">${L.sig}</div>
  <div style="flex:1;border-top:1.5px solid #101B30;padding-top:5px">${L.sigDate}</div>
</div></div>` : ""}
<button class="btn" onclick="window.print()">${L.print}</button>
<div class="ft">⚡ ${L.made}</div>
</div>
<div id="lb" onclick="this.style.display='none'" style="display:none;position:fixed;inset:0;z-index:9999;background:rgba(8,12,20,.93);align-items:center;justify-content:center;padding:16px">
  <img id="lbimg" alt="" style="max-width:100%;max-height:86%;border-radius:14px;box-shadow:0 12px 44px rgba(0,0,0,.6)">
  <div style="position:absolute;top:16px;right:18px;width:42px;height:42px;border-radius:999px;background:rgba(255,255,255,.18);color:#fff;font-size:20px;display:flex;align-items:center;justify-content:center">✕</div>
</div>
<script>function zoomImg(s){var b=document.getElementById('lb');document.getElementById('lbimg').src=s;b.style.display='flex';}</script>
</body></html>`);
});

/* ── Measurement report (/r) — a professional PDF-style report built from a
 * measurement, in the contractor's brand. Competitors sell this exact document
 * for $7+/each; here it's generated free from data the app already has.
 * Same architecture as /i: everything travels inside the ?d= link. */
app.get("/r", (req, res) => {
  let d;
  try {
    const b64 = String(req.query.d || "").replace(/-/g, "+").replace(/_/g, "/");
    d = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  } catch {
    return res.status(400).send("Invalid link");
  }
  const es = d.lang !== "en";
  const esc = (s) => String(s || "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : null; };
  const la = num(d.la), ln = num(d.ln);
  if (la == null || ln == null) return res.status(400).send("Invalid link");
  const bbRaw = Array.isArray(d.bb) && d.bb.length === 4 ? d.bb.map(num) : null;
  const bb = bbRaw && bbRaw.every((v) => v != null) ? bbRaw : null;
  const outline = (Array.isArray(d.o) ? d.o.slice(0, 60) : [])
    .map((p) => (Array.isArray(p) ? [num(p[0]), num(p[1])] : null))
    .filter((p) => p && p[0] != null && p[1] != null);
  const ra = num(d.ra) || 0, sq = num(d.sq) || 0;
  const w = Math.min(40, Math.max(0, num(d.w) ?? 10));
  const msq = num(d.msq) || Math.ceil(sq * (1 + w / 100));
  const seg = Math.min(99, num(d.seg) || 1);
  const pitch = String(d.pi || "6").replace(/[^0-9]/g, "").slice(0, 2) || "6";
  const imgDate = String(d.id || "").replace(/[^0-9/]/g, "").slice(0, 8);
  const dt = esc(String(d.dt || "").slice(0, 24));
  const addr = esc(String(d.addr || "").slice(0, 120));
  const biz = esc(String(d.biz || "").slice(0, 60));
  const ph = esc(String(d.ph || "").slice(0, 24));
  const em = d.em ? esc(String(d.em).slice(0, 60)) : "";
  const lic = d.lic ? esc(String(d.lic).slice(0, 40)) : "";
  const lg = d.lg ? String(d.lg).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60) : "";
  const traced = d.src === "trace";
  // Frame the satellite shot exactly like /api/roofimg frames a bbox, so the
  // SVG overlay's pixel math lines up with the photo underneath.
  const W = 1280, H = 800;
  let view;
  if (bb) {
    const ctrLat = (bb[0] + bb[2]) / 2, ctrLng = (bb[1] + bb[3]) / 2;
    const span = Math.max(bb[2] - bb[0], (bb[3] - bb[1]) * Math.cos((ctrLat * Math.PI) / 180), 0.00005) * 2.2;
    const zoom = Math.min(Math.max(Math.floor(Math.log2((360 * (640 / 256)) / span)), 17), 21);
    view = { lat: ctrLat, lng: ctrLng, zoom };
  } else {
    view = { lat: la, lng: ln, zoom: 20 };
  }
  const img = `/api/roofimg?lat=${view.lat}&lng=${view.lng}` + (bb ? `&bbox=${bb.join(",")}` : "");
  const street = `/api/streetview?lat=${la}&lng=${ln}`;
  const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  const worldN = 256 * Math.pow(2, view.zoom) * 2;
  const toPx = ([pla, pln]) => [
    ((pln - view.lng) / 360) * worldN + W / 2,
    ((mercY(view.lat) - mercY(pla)) / (2 * Math.PI)) * worldN + H / 2,
  ];
  const kR = Math.PI / 180, RE = 6378137;
  const ftBetween = (a, b) => Math.hypot((b[1] - a[1]) * kR * RE * Math.cos(a[0] * kR), (b[0] - a[0]) * kR * RE) * 3.28084;
  // Numbered edges: labels on the diagram + a per-side table, like the $7 reports
  const px = outline.map(toPx);
  const edges = [];
  let svgLabels = "", svgPoly = "";
  if (outline.length >= 3) {
    const cx = px.reduce((s, p) => s + p[0], 0) / px.length;
    const cy = px.reduce((s, p) => s + p[1], 0) / px.length;
    for (let i = 0; i < outline.length; i++) {
      const j = (i + 1) % outline.length;
      const ft = Math.round(ftBetween(outline[i], outline[j]));
      edges.push({ n: i + 1, ft });
      const [pa, pb] = [px[i], px[j]];
      const sl = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
      if (sl < 40) continue;
      const mx = (pa[0] + pb[0]) / 2, my = (pa[1] + pb[1]) / 2;
      let nx = -(pb[1] - pa[1]) / sl, ny = (pb[0] - pa[0]) / sl;
      if ((mx + nx * 46 - cx) ** 2 + (my + ny * 46 - cy) ** 2 < (mx - nx * 46 - cx) ** 2 + (my - ny * 46 - cy) ** 2) { nx = -nx; ny = -ny; }
      const lx = mx + nx * 46, ly = my + ny * 46;
      svgLabels += `<text x="${lx.toFixed(0)}" y="${(ly + 12).toFixed(0)}" text-anchor="middle" font-size="34" font-weight="800" fill="#101B30" stroke="#fff" stroke-width="9" paint-order="stroke" font-family="Arial">${i + 1} · ${ft}′</text>`;
    }
    const ptsStr = px.map((p) => `${p[0].toFixed(0)},${p[1].toFixed(0)}`).join(" ");
    svgPoly = `<polygon points="${ptsStr}" fill="rgba(248,180,8,.14)" stroke="#fff" stroke-width="7" stroke-linejoin="round"/>`
      + `<polygon points="${ptsStr}" fill="none" stroke="#F8B408" stroke-width="3.5" stroke-linejoin="round"/>`
      + px.map((p) => `<circle cx="${p[0].toFixed(0)}" cy="${p[1].toFixed(0)}" r="7" fill="#fff" stroke="#F8B408" stroke-width="3"/>`).join("");
  }
  const perim = edges.reduce((s, e) => s + e.ft, 0);
  const factor = { 0: 1, 1: 1.003, 2: 1.014, 3: 1.031, 4: 1.054, 5: 1.083, 6: 1.118, 7: 1.158, 8: 1.202, 9: 1.25, 10: 1.302, 11: 1.357, 12: 1.414 }[pitch] || 1.118;
  const L = es ? {
    title: "REPORTE DE MEDICIÓN DE TECHO", date: "Fecha", prepared: "Preparado por",
    diagram: "Diagrama de medición", area: "Área del techo", sqs: "Cuadros (squares)",
    pitchL: "Inclinación", mat: `Material con merma (+${w}%)`, sides: "Medidas por lado",
    side: "Lado", length: "Largo", perimeter: "Perímetro total", details: "Detalles de la medición",
    facets: "Secciones del techo", pf: "Factor de inclinación", src: "Fuente",
    srcSat: "Satélite (Google)", srcTrace: "Trazado a mano sobre satélite", imagery: "Imagen satelital",
    house: "La casa", notes: "Notas",
    note1: "Medición preliminar por satélite — es un estimado profesional, no un levantamiento en sitio.",
    note2: "Los cuadros con merma incluyen el desperdicio típico por cortes según la complejidad del techo.",
    note3: "Confirme las medidas finales en la inspección en sitio antes de ordenar material.",
    made: "Hecho con ALTO Pro", pageOf: (a, b) => `Página ${a} de ${b}`, print: "🖨️ Imprimir / Guardar PDF",
    matList: "Lista de materiales (estimada)", prod: "Producto", qty: "Cantidad", noteC: "Nota",
    mShing: "Paquetes de teja", mShingN: "3 paquetes por cuadro, con merma incluida",
    mUnder: "Underlayment sintético", mUnderN: "1 rollo ≈ 10 cuadros",
    mDrip: "Drip edge (piezas de 10′)", mDripN: (p) => `del perímetro ${p}′ — exacto`,
    mStart: "Starter strip", mStartN: "1 rollo ≈ 100′ · por perímetro",
    mRidge: "Ridge cap", mRidgeEst: (lf) => `≈ ${lf}′ · estimado — el lado más largo`, mRidgeSite: "Medir en sitio — techo de varias secciones",
    mNails: "Clavos de bobina", mNailsN: "1 caja ≈ 18 cuadros",
    pcs: "pzas", rolls: "rollos", bundles: "paquetes", boxes: "cajas", site: "—",
    vent: "Ventilación (estimada)", attic: "Área de ático (estimada)", nfva: "Ventilación requerida — NFVA (regla 1/300)",
    exh: "Escape (mitad superior)", intk: "Entrada (mitad inferior)",
    optA: "Opción A — Ridge vent (caballete)", optB: "Opción B — Box vents (hongos)", optIn: "Entrada — Soffit / drip edge ventilado",
    ftN: "pies necesarios", unitsN: "unidades", sqin: "pulg²",
    ventNote: "Cálculo con la regla 1/300: mitad entrada, mitad escape. Rendimiento típico: ridge vent ≈18 pulg²/pie · box vent ≈50 pulg² c/u · soffit/drip edge ventilado ≈9 pulg²/pie. Verifique el código local y la ventilación existente antes de instalar.",
    tkTitle: "Takeoff lineal (BETA)", tkEave: "Alero (eave)", tkRake: "Rake", tkRidge: "Caballete (ridge)",
    tkHip: "Lima tesa (hip)", tkValley: "Lima hoya (valley)", tkTotal: "Total lineal",
    tkBeta: "BETA — números derivados del modelo de elevación satelital. Verifica en sitio antes de ordenar material por estas líneas.",
    tkLow: "⚠️ Cobertura baja del análisis en este techo — usa estos números solo como referencia.",
  } : {
    title: "ROOF MEASUREMENT REPORT", date: "Date", prepared: "Prepared by",
    diagram: "Measurement diagram", area: "Roof area", sqs: "Squares",
    pitchL: "Pitch", mat: `Material with waste (+${w}%)`, sides: "Length per side",
    side: "Side", length: "Length", perimeter: "Total perimeter", details: "Measurement details",
    facets: "Roof sections", pf: "Pitch factor", src: "Source",
    srcSat: "Satellite (Google)", srcTrace: "Hand-traced over satellite", imagery: "Satellite imagery",
    house: "The home", notes: "Notes",
    note1: "Preliminary satellite measurement — a professional estimate, not an on-site survey.",
    note2: "Squares with waste include typical cutting waste for this roof's complexity.",
    note3: "Confirm final measurements at the on-site inspection before ordering material.",
    made: "Made with ALTO Pro", pageOf: (a, b) => `Page ${a} of ${b}`, print: "🖨️ Print / Save PDF",
    matList: "Materials list (estimated)", prod: "Product", qty: "Quantity", noteC: "Note",
    mShing: "Shingle bundles", mShingN: "3 bundles per square, waste included",
    mUnder: "Synthetic underlayment", mUnderN: "1 roll ≈ 10 squares",
    mDrip: "Drip edge (10′ pieces)", mDripN: (p) => `from the ${p}′ perimeter — exact`,
    mStart: "Starter strip", mStartN: "1 roll ≈ 100′ · by perimeter",
    mRidge: "Ridge cap", mRidgeEst: (lf) => `≈ ${lf}′ · estimated — longest side`, mRidgeSite: "Measure on site — multi-section roof",
    mNails: "Coil nails", mNailsN: "1 box ≈ 18 squares",
    pcs: "pcs", rolls: "rolls", bundles: "bundles", boxes: "boxes", site: "—",
    vent: "Ventilation (estimated)", attic: "Attic area (estimated)", nfva: "Required ventilation — NFVA (1/300 rule)",
    exh: "Exhaust (upper half)", intk: "Intake (lower half)",
    optA: "Option A — Ridge vent", optB: "Option B — Box vents", optIn: "Intake — Soffit / vented drip edge",
    ftN: "feet needed", unitsN: "units", sqin: "sq in",
    ventNote: "Calculated with the 1/300 rule: half intake, half exhaust. Typical ratings: ridge vent ≈18 sq in/ft · box vent ≈50 sq in each · soffit/vented drip edge ≈9 sq in/ft. Verify local code and existing ventilation before installing.",
    tkTitle: "Linear takeoff (BETA)", tkEave: "Eave", tkRake: "Rake", tkRidge: "Ridge",
    tkHip: "Hip", tkValley: "Valley", tkTotal: "Total linear",
    tkBeta: "BETA — numbers derived from the satellite elevation model. Verify on site before ordering material from these lines.",
    tkLow: "⚠️ Low analysis coverage on this roof — treat these numbers as reference only.",
  };
  // Ventilation math (1/300 rule) from the estimated attic footprint
  const attic = Math.round(ra / factor);
  const nfvaIn2 = Math.round((attic * 144) / 300);
  const half = Math.round(nfvaIn2 / 2);
  const ridgeFt = Math.ceil(half / 18), boxUnits = Math.ceil(half / 50), soffitFt = Math.ceil(half / 9);
  // Optional linear takeoff payload (BETA) — sanitize hard, it draws on the page
  const tkRaw = d.tk && typeof d.tk === "object" ? d.tk : null;
  const tk = tkRaw ? {
    e: num(tkRaw.e) || 0, rk: num(tkRaw.rk) || 0, rd: num(tkRaw.rd) || 0, hp: num(tkRaw.hp) || 0, vl: num(tkRaw.vl) || 0,
    cf: Math.max(0, Math.min(1, num(tkRaw.cf) ?? 0)),
    ot: Array.isArray(tkRaw.ot) ? tkRaw.ot.slice(0, 60).map((v) => (v ? 1 : 0)) : [],
    ln: (Array.isArray(tkRaw.ln) ? tkRaw.ln.slice(0, 40) : [])
      .map((l) => (Array.isArray(l) && l.length === 6
        ? { t: l[0] === "r" ? "ridge" : l[0] === "h" ? "hip" : "valley", a: [num(l[1]), num(l[2])], b: [num(l[3]), num(l[4])], ft: num(l[5]) || 0 }
        : null))
      .filter((l) => l && l.a.every((v) => v != null) && l.b.every((v) => v != null)),
    im: tkRaw.im && typeof tkRaw.im === "object" && Array.isArray(tkRaw.im.b) && tkRaw.im.b.length === 4
      ? { c: num(tkRaw.im.c), b: tkRaw.im.b.map(num) }
      : null,
  } : null;
  const TK_COLORS = { eave: "#F8B408", rake: "#2E7CF6", ridge: "#D93025", hip: "#8B5CF6", valley: "#1E9E5A" };
  let tkSvg = "", tkVW = W, tkVH = H, tkImgSrc = img;
  if (tk) {
    // The lines come from the Solar flight's elevation model — draw them over
    // THAT flight's own photo (/api/tkimg) whenever we know its exact window,
    // so lines and photo are aligned by construction. The Static Maps photo is
    // often a different flight and made correct lines look wrong.
    let P = toPx;
    if (tk.im && tk.im.c != null && tk.im.b.every((v) => v != null)) {
      const [X0, Y0, X1, Y1] = tk.im.b;
      let fwd = null;
      const c2 = tk.im.c;
      if (c2 === 4326) fwd = (la2, ln2) => [ln2, la2];
      else {
        let def = null;
        if (c2 >= 32601 && c2 <= 32660) def = `+proj=utm +zone=${c2 - 32600} +datum=WGS84 +units=m +no_defs`;
        else if (c2 >= 32701 && c2 <= 32760) def = `+proj=utm +zone=${c2 - 32700} +south +datum=WGS84 +units=m +no_defs`;
        else if (c2 === 3857) def = "EPSG:3857";
        if (def) { try { const cv = proj4(def, "WGS84"); fwd = (la2, ln2) => cv.inverse([ln2, la2]); } catch { /* bad crs → fall back */ } }
      }
      if (fwd && X1 > X0 && Y1 > Y0) {
        tkVW = 1200;
        tkVH = Math.max(240, Math.round((1200 * (Y1 - Y0)) / (X1 - X0)));
        P = (p) => { const [X, Y] = fwd(p[0], p[1]); return [((X - X0) / (X1 - X0)) * tkVW, ((Y1 - Y) / (Y1 - Y0)) * tkVH]; };
        tkImgSrc = `/api/tkimg?lat=${la}&lng=${ln}` + (bb ? `&bbox=${bb.join(",")}` : "");
      }
    }
    const pxT = outline.map(P);
    for (let i = 0; i < pxT.length; i++) {
      const jn = (i + 1) % pxT.length;
      const c = TK_COLORS[tk.ot[i] ? "rake" : "eave"];
      tkSvg += `<line x1="${pxT[i][0].toFixed(0)}" y1="${pxT[i][1].toFixed(0)}" x2="${pxT[jn][0].toFixed(0)}" y2="${pxT[jn][1].toFixed(0)}" stroke="#fff" stroke-width="9" stroke-linecap="round"/>`
        + `<line x1="${pxT[i][0].toFixed(0)}" y1="${pxT[i][1].toFixed(0)}" x2="${pxT[jn][0].toFixed(0)}" y2="${pxT[jn][1].toFixed(0)}" stroke="${c}" stroke-width="4.5" stroke-linecap="round"/>`;
    }
    let lblN = 0;
    for (const l of tk.ln) {
      const A = P(l.a), B = P(l.b);
      const c = TK_COLORS[l.t];
      tkSvg += `<line x1="${A[0].toFixed(0)}" y1="${A[1].toFixed(0)}" x2="${B[0].toFixed(0)}" y2="${B[1].toFixed(0)}" stroke="#fff" stroke-width="9" stroke-linecap="round"/>`
        + `<line x1="${A[0].toFixed(0)}" y1="${A[1].toFixed(0)}" x2="${B[0].toFixed(0)}" y2="${B[1].toFixed(0)}" stroke="${c}" stroke-width="4.5" stroke-linecap="round" stroke-dasharray="${l.t === "valley" ? "14 8" : "none"}"/>`;
      // Label only lines long enough to read (short ones still count in totals);
      // alternate above/below the line so neighbors don't pile up.
      const scrLen = Math.hypot(B[0] - A[0], B[1] - A[1]);
      if (l.ft >= 12 && scrLen >= 90) {
        const off = (lblN++ % 2 === 0) ? -12 : 34;
        tkSvg += `<text x="${((A[0] + B[0]) / 2).toFixed(0)}" y="${((A[1] + B[1]) / 2 + off).toFixed(0)}" text-anchor="middle" font-size="26" font-weight="800" fill="${c}" stroke="#fff" stroke-width="7" paint-order="stroke" font-family="Arial">${l.ft}′</text>`;
      }
    }
  }
  const totalPages = tk ? 4 : 3;
  const header = `<div class="hd">
    <div class="hd-l">${lg ? `<img src="/api/logo/${lg}" alt="" onerror="this.style.display='none'">` : ""}<div><div class="hd-biz">${biz || "—"}</div><div class="hd-sub">${[ph, em, lic && ((es ? "Licencia: " : "License: ") + lic)].filter(Boolean).join(" · ")}</div></div></div>
    <div class="hd-r"><div class="hd-title">${L.title}</div><div class="hd-sub">${L.date}: ${dt}</div></div>
  </div>`;
  const footer = (n) => `<div class="ft"><span>${biz}${addr ? " · " + addr : ""}</span><span>${L.made} · ${L.pageOf(n, totalPages)}</span></div>`;
  // Materials list — exact where the geometry is exact (perimeter), labeled
  // estimates elsewhere, and "measure on site" where the data can't say.
  const maxEdge = edges.reduce((m, e) => Math.max(m, e.ft), 0);
  const ridgeSimple = seg <= 3 && maxEdge > 0; // gable-ish: ridge ≈ longest side
  const matRows = [
    [L.mShing, `${msq * 3} ${L.bundles}`, L.mShingN],
    sq > 0 ? [L.mUnder, `${Math.ceil(sq / 10)} ${L.rolls}`, L.mUnderN] : null,
    edges.length ? [L.mDrip, `${Math.ceil(perim / 10)} ${L.pcs}`, L.mDripN(perim)] : null,
    edges.length ? [L.mStart, `${Math.ceil(perim / 100)} ${L.rolls}`, L.mStartN] : null,
    ridgeSimple
      ? [L.mRidge, `${Math.ceil(maxEdge / 25)} ${L.bundles}`, L.mRidgeEst(maxEdge)]
      : [L.mRidge, L.site, L.mRidgeSite],
    [L.mNails, `${Math.max(1, Math.ceil(msq / 18))} ${L.boxes}`, L.mNailsN],
  ].filter(Boolean);
  const matTable = `<table><tr><th>${L.prod}</th><th>${L.qty}</th><th>${L.noteC}</th></tr>`
    + matRows.map(([a, b, c]) => `<tr><td style="font-weight:700">${a}</td><td style="font-weight:800;white-space:nowrap">${b}</td><td style="color:#67718A;font-size:11.5px">${c}</td></tr>`).join("")
    + `</table>`;
  const sideRows = edges.map((e) => `<tr><td>${e.n}</td><td>${e.ft}′</td></tr>`).join("");
  const sideCols = edges.length
    ? `<table class="sides"><tr><th>${L.side}</th><th>${L.length}</th></tr>${sideRows}<tr class="tot"><td>${L.perimeter}</td><td>${perim}′</td></tr></table>`
    : `<p class="mut">—</p>`;
  res.send(`<!doctype html><html lang="${es ? "es" : "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=880">
<title>${L.title} — ${addr}</title><meta name="robots" content="noindex">
<style>
*{box-sizing:border-box;margin:0;font-family:Arial,Helvetica,sans-serif}
body{background:#E8EBF1;color:#101B30}
.page{width:816px;min-height:1056px;margin:16px auto;background:#fff;border-left:10px solid #F8B408;padding:36px 42px 60px;position:relative;box-shadow:0 10px 30px rgba(16,27,48,.15)}
.hd{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #101B30;padding-bottom:14px;margin-bottom:22px}
.hd-l{display:flex;gap:12px;align-items:center}.hd-l img{max-height:52px;max-width:150px}
.hd-biz{font-weight:800;font-size:19px}.hd-sub{font-size:11px;color:#67718A;font-weight:600;margin-top:2px}
.hd-title{font-weight:800;font-size:15px;letter-spacing:1px;text-align:right;color:#101B30}
h2{font-size:14px;letter-spacing:1.5px;color:#B57E00;text-transform:uppercase;margin:20px 0 10px}
.addr{font-size:22px;font-weight:800;margin-bottom:14px}
.diagram{position:relative;width:100%;aspect-ratio:1280/800;background:#0B1322;border-radius:10px;overflow:hidden}
.diagram img{position:absolute;inset:0;width:100%;height:100%}
.diagram svg{position:absolute;inset:0;width:100%;height:100%}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:16px}
.stat{border:1.5px solid #E6E8EC;border-radius:12px;padding:12px 10px;text-align:center}
.stat b{display:block;font-size:24px}.stat span{font-size:10.5px;color:#67718A;font-weight:700;letter-spacing:.4px}
table{width:100%;border-collapse:collapse;font-size:13px}
table td,table th{padding:7px 10px;border-bottom:1px solid #EDF0F4;text-align:left}
table th{font-size:10.5px;letter-spacing:1px;color:#67718A;text-transform:uppercase}
.sides{width:46%;display:inline-table;vertical-align:top;margin-right:3%}
.sides td:last-child{text-align:right;font-weight:700}
.tot td{font-weight:800;border-top:2px solid #101B30}
.kv td:first-child{color:#67718A;font-weight:600;width:55%}
.kv td:last-child{font-weight:800;text-align:right}
.mut{color:#9AA0AC;font-weight:600;font-size:13px}
.house{width:100%;border-radius:10px;display:block}
.notes p{font-size:12px;color:#5A6478;font-weight:600;line-height:1.65;margin-bottom:6px}
.ft{position:absolute;left:42px;right:42px;bottom:20px;display:flex;justify-content:space-between;font-size:10px;color:#9AA0AC;font-weight:700;border-top:1px solid #EDF0F4;padding-top:8px}
.btn{position:fixed;right:18px;bottom:18px;background:#F8B408;color:#101B30;border:none;border-radius:12px;padding:13px 20px;font-weight:800;font-size:14px;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.25);z-index:9}
@media print{body{background:#fff}.page{margin:0;box-shadow:none;width:auto;min-height:auto;page-break-after:always}.btn,.noprint{display:none}}
</style></head><body>
${req.query.app != null ? `<div class="noprint" style="padding:12px 16px 0;max-width:816px;margin:0 auto"><a href="/" onclick="if(history.length>1){history.back();return false}" style="display:inline-flex;align-items:center;gap:5px;background:#fff;border:1.5px solid #E6E8EC;border-radius:999px;padding:10px 16px;font-weight:800;font-size:15px;color:#101B30;text-decoration:none;box-shadow:0 4px 14px rgba(16,27,48,.12)">‹ ${es ? "Volver a la app" : "Back to app"}</a></div>` : ""}
<button class="btn" onclick="window.print()">${L.print}</button>
<div class="page">
  ${header}
  <div class="addr">${addr}</div>
  <h2>${L.diagram}</h2>
  <div class="diagram">
    <img src="${img}" alt="" onerror="this.style.display='none'">
    ${svgPoly ? `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${svgPoly}${svgLabels}</svg>` : ""}
  </div>
  <div class="stats">
    <div class="stat"><b>${ra.toLocaleString()}</b><span>${L.area} (sq ft)</span></div>
    <div class="stat"><b>${sq}</b><span>${L.sqs}</span></div>
    <div class="stat"><b>${pitch}/12</b><span>${L.pitchL}</span></div>
    <div class="stat"><b>${msq}</b><span>${L.mat}</span></div>
  </div>
  <h2>${L.details}</h2>
  <table class="kv">
    <tr><td>${L.facets}</td><td>${seg}</td></tr>
    <tr><td>${L.pf} (${pitch}/12)</td><td>${factor.toFixed(3)}</td></tr>
    <tr><td>${L.src}</td><td>${traced ? L.srcTrace : L.srcSat}${imgDate ? ` · ${L.imagery} ${imgDate}` : ""}</td></tr>
  </table>
  ${footer(1)}
</div>
<div class="page">
  ${header}
  <h2>${L.sides}</h2>
  ${sideCols}
  <h2 style="margin-top:24px">${L.matList}</h2>
  ${matTable}
  <h2 style="margin-top:26px">${L.house}</h2>
  <img class="house" src="${street}" alt="" onerror="this.style.display='none'">
  ${footer(2)}
</div>
${tk ? `<div class="page">
  ${header}
  <h2>${L.tkTitle}</h2>
  <div style="background:#FDECEC;border:1.5px solid #D93025;color:#9B1C10;border-radius:10px;padding:9px 13px;font-weight:700;font-size:12px;margin-bottom:12px">${L.tkBeta}${tk.cf > 0 && tk.cf < 0.7 ? `<br>${L.tkLow}` : ""}</div>
  <div class="diagram" style="aspect-ratio:${tkVW}/${tkVH}">
    <img src="${tkImgSrc}" alt="" onerror="this.style.display='none'">
    <svg viewBox="0 0 ${tkVW} ${tkVH}" preserveAspectRatio="none">${tkSvg}</svg>
  </div>
  <div style="display:flex;gap:14px;flex-wrap:wrap;margin:10px 0 4px;font-size:11px;font-weight:800">
    ${[["eave", L.tkEave], ["rake", L.tkRake], ["ridge", L.tkRidge], ["hip", L.tkHip], ["valley", L.tkValley]]
      .map(([k, lb]) => `<span style="display:inline-flex;align-items:center;gap:5px"><span style="width:14px;height:5px;border-radius:3px;background:${TK_COLORS[k]}"></span>${lb}</span>`).join("")}
  </div>
  <h2 style="margin-top:14px">${L.tkTotal}</h2>
  <table class="kv">
    <tr><td>${L.tkEave}</td><td>${tk.e}′</td></tr>
    <tr><td>${L.tkRake}</td><td>${tk.rk}′</td></tr>
    <tr><td>${L.tkRidge}</td><td>${tk.rd}′</td></tr>
    <tr><td>${L.tkHip}</td><td>${tk.hp}′</td></tr>
    <tr><td>${L.tkValley}</td><td>${tk.vl}′</td></tr>
    <tr class="tot"><td>${L.tkTotal}</td><td>${tk.e + tk.rk + tk.rd + tk.hp + tk.vl}′</td></tr>
  </table>
  ${footer(3)}
</div>` : ""}
<div class="page">
  ${header}
  <h2>${L.vent}</h2>
  <div class="stats" style="grid-template-columns:repeat(2,1fr)">
    <div class="stat"><b>${attic.toLocaleString()}</b><span>${L.attic} (sq ft)</span></div>
    <div class="stat"><b>${nfvaIn2.toLocaleString()}</b><span>${L.nfva} (${L.sqin})</span></div>
  </div>
  <table class="kv" style="margin-top:14px">
    <tr><td>${L.exh}</td><td>${half.toLocaleString()} ${L.sqin}</td></tr>
    <tr><td>${L.intk}</td><td>${half.toLocaleString()} ${L.sqin}</td></tr>
  </table>
  <h2 style="margin-top:24px">${L.optA}</h2>
  <table class="kv"><tr><td>${L.ftN}</td><td>${ridgeFt}′</td></tr></table>
  <h2 style="margin-top:18px">${L.optB}</h2>
  <table class="kv"><tr><td>${L.unitsN}</td><td>${boxUnits}</td></tr></table>
  <h2 style="margin-top:18px">${L.optIn}</h2>
  <table class="kv"><tr><td>${L.ftN}</td><td>${soffitFt}′</td></tr></table>
  <div class="notes" style="margin-top:22px"><h2>${L.notes}</h2>
    <p>• ${L.ventNote}</p>
    <p>≈ ${L.note1}</p><p>• ${L.note2}</p><p>• ${L.note3}</p>
  </div>
  ${footer(totalPages)}
</div>
</body></html>`);
});

/* ── Fence estimate document (/f) — the closing document for the fence
 * vertical: satellite diagram (red lot line + orange fence + green gates),
 * per-side measurements, full construction breakdown (panels, every post
 * type, corners) and the itemized price with signature line. Same ?d=
 * architecture as /i and /r: everything travels inside the link, and all
 * construction math is recomputed here with src/fenceMath.js — the same
 * engine the app used — so document and app can never diverge. */
app.get("/f", (req, res) => {
  let d;
  try {
    const b64 = String(req.query.d || "").replace(/-/g, "+").replace(/_/g, "/");
    d = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  } catch {
    return res.status(400).send("Invalid link");
  }
  const es = d.lang !== "en";
  const esc = (s) => String(s || "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  // ?d= is attacker-controllable: every coordinate is coerced to a finite
  // number (nothing but digits can land inside src/points attributes) and
  // every string is escaped + length-capped before it touches the page.
  const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : null; };
  const pair = (p) => (Array.isArray(p) ? [num(p[0]), num(p[1])] : [null, null]);
  const okPt = (p) => p[0] != null && p[1] != null && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180;
  const runs = (Array.isArray(d.l) ? d.l.slice(0, 30) : [])
    .map((r) => (Array.isArray(r) ? r.slice(0, 200).map(pair).filter(okPt) : []))
    .filter((r) => r.length >= 2);
  if (!runs.length) return res.status(400).send("Invalid link");
  const pc = (Array.isArray(d.pc) ? d.pc.slice(0, 80) : []).map(pair).filter(okPt);
  const gatesIn = (Array.isArray(d.g) ? d.g.slice(0, 40) : [])
    .map((g) => (Array.isArray(g) ? { a: [num(g[0]), num(g[1])], b: [num(g[2]), num(g[3])], price: num(g[4]) } : null))
    .filter((g) => g && okPt(g.a) && okPt(g.b));
  const lf = Math.max(0, num(d.pr?.lf) ?? 0);
  const panelW = num(d.pr?.pw) > 0 ? num(d.pr.pw) : 8;
  const prodN = esc(String(d.pr?.n || (es ? "Cerca" : "Fence")).slice(0, 40));
  const mkPct = Math.max(0, Math.min(100, num(d.mk) ?? 0));
  const dt = esc(String(d.dt || "").slice(0, 24));
  const addr = esc(String(d.ca || "").slice(0, 120));
  const cn = esc(String(d.cn || "").slice(0, 60));
  const biz = esc(String(d.biz || "").slice(0, 60));
  const ph = esc(String(d.ph || "").slice(0, 24));
  const em = d.em ? esc(String(d.em).slice(0, 60)) : "";
  const lic = d.lic ? esc(String(d.lic).slice(0, 40)) : "";
  const lg = d.lg ? String(d.lg).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60) : "";
  const inv = esc(String(d.inv || "").slice(0, 12));
  const zelle = d.zelle ? esc(String(d.zelle).slice(0, 40)) : "";
  const wr = d.wr ? esc(String(d.wr).slice(0, 200)) : "";

  // Gate width IS the drawn line's length; which run it opens is derived by
  // geometry (midpoint within 2.5 ft of a run) — exactly like the app.
  const closedRun = (r) => r.length > 3 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1];
  const gateRunOf = (g) => {
    const m = [(g.a[0] + g.b[0]) / 2, (g.a[1] + g.b[1]) / 2];
    const kR = Math.PI / 180, F = (kR * 6378137) * 3.28084; // ° → ft
    const cz = Math.cos(m[0] * kR);
    let best = -1, bestD = 2.5;
    runs.forEach((pts, ri) => {
      for (let i = 1; i < pts.length; i++) {
        const ax = (pts[i - 1][1] - m[1]) * cz * F, ay = (pts[i - 1][0] - m[0]) * F;
        const bx = (pts[i][1] - m[1]) * cz * F, by = (pts[i][0] - m[0]) * F;
        const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
        const tt = Math.max(0, Math.min(1, (-ax * dx - ay * dy) / L2));
        const dd = Math.hypot(ax + tt * dx, ay + tt * dy);
        if (dd < bestD) { bestD = dd; best = ri; }
      }
    });
    return best;
  };
  const gates = gatesIn.map((g) => {
    const widthFt = fenceDistFt(g.a, g.b);
    return { a: g.a, b: g.b, widthFt, kind: widthFt <= 6 ? "walk" : "double", price: g.price ?? 0, runIdx: gateRunOf(g) };
  });
  const q = fenceQuote({
    runs: runs.map((pts) => ({ pts })),
    gates: gates.map((g) => ({ kind: g.kind, widthFt: g.widthFt, price: g.price, runIdx: g.runIdx })),
    product: { lfPrice: lf, panelW },
    markupPct: mkPct,
  });

  // Frame the WHOLE drawing (lot + fence + gates) in the same square view the
  // app uses (roofimg &sq=1 → 1280×1280), same zoom law as openFence.
  const W = 1280, H = 1280;
  let s = 90, w = 180, nn = -90, e = -180;
  [...pc, ...runs.flat(), ...gates.flatMap((g) => [g.a, g.b])].forEach(([la, ln]) => {
    s = Math.min(s, la); nn = Math.max(nn, la); w = Math.min(w, ln); e = Math.max(e, ln);
  });
  const ctrLat = (s + nn) / 2, ctrLng = (w + e) / 2;
  const span = Math.max(nn - s, (e - w) * Math.cos((ctrLat * Math.PI) / 180), 0.0001) * 1.6;
  const zoom = Math.min(Math.max(Math.floor(Math.log2((360 * (640 / 256)) / span)), 15), 20);
  const img = `/api/roofimg?lat=${ctrLat}&lng=${ctrLng}&zoom=${zoom}&sq=1`;
  const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  const worldN = 256 * Math.pow(2, zoom) * 2;
  const toPx = ([pla, pln]) => [
    ((pln - ctrLng) / 360) * worldN + W / 2,
    ((mercY(ctrLat) - mercY(pla)) / (2 * Math.PI)) * worldN + H / 2,
  ];

  // Logical SIDES: split every run at real corners (≥45° turns) — a curved
  // frontage stays ONE side. Numbered on the diagram AND in the table.
  const turnAt = (a, b, c) => {
    const k = Math.PI / 180, cz = Math.cos(b[0] * k);
    const v1 = [(b[1] - a[1]) * cz, b[0] - a[0]], v2 = [(c[1] - b[1]) * cz, c[0] - b[0]];
    const m1 = Math.hypot(...v1), m2 = Math.hypot(...v2);
    if (!m1 || !m2) return 0;
    return (Math.acos(Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / (m1 * m2)))) * 180) / Math.PI;
  };
  const sidesOf = (ptsIn) => {
    const cl = closedRun(ptsIn);
    const pts = cl ? ptsIn.slice(0, -1) : ptsIn;
    const n2 = pts.length;
    if (n2 < 2) return [];
    let breaks;
    if (cl) {
      breaks = [...Array(n2).keys()].filter((i) => turnAt(pts[(i - 1 + n2) % n2], pts[i], pts[(i + 1) % n2]) >= 45);
      if (breaks.length < 2) return [{ pts: [...pts, pts[0]] }];
      return breaks.map((bI, k2) => {
        const eI = breaks[(k2 + 1) % breaks.length];
        const seg = [pts[bI]];
        for (let i = (bI + 1) % n2; ; i = (i + 1) % n2) { seg.push(pts[i]); if (i === eI) break; if (seg.length > n2 + 1) break; }
        return { pts: seg };
      });
    }
    breaks = [0];
    for (let i = 1; i < n2 - 1; i++) if (turnAt(pts[i - 1], pts[i], pts[i + 1]) >= 45) breaks.push(i);
    breaks.push(n2 - 1);
    const out = [];
    for (let k2 = 0; k2 < breaks.length - 1; k2++) out.push({ pts: pts.slice(breaks[k2], breaks[k2 + 1] + 1) });
    return out;
  };
  const allSides = [];
  runs.forEach((pts, ri) => sidesOf(pts).forEach((sd) => allSides.push({ run: ri, pts: sd.pts, ft: Math.round(fenceRunFt(sd.pts)) })));
  allSides.forEach((sd, i) => { sd.n = i + 1; });

  // ── The diagram SVG: red lot truth, orange fence, green gates ──
  let svg = "";
  if (pc.length >= 3) {
    const pxc = pc.map(toPx);
    svg += `<polygon points="${pxc.map((p) => `${p[0].toFixed(0)},${p[1].toFixed(0)}`).join(" ")}" fill="none" stroke="#E5484D" stroke-width="4" stroke-dasharray="14 10" stroke-linecap="round" opacity=".9"/>`;
    svg += fenceCornerIdx(pc, 45).map((ci) => { const h = toPx(pc[ci]); return `<circle cx="${h[0].toFixed(0)}" cy="${h[1].toFixed(0)}" r="8" fill="#E5484D" stroke="#fff" stroke-width="3"/>`; }).join("");
  }
  for (const pts of runs) {
    const px = pts.map(toPx);
    const ptStr = px.map((p) => `${p[0].toFixed(0)},${p[1].toFixed(0)}`).join(" ");
    svg += `<polyline points="${ptStr}" fill="none" stroke="#fff" stroke-width="11" stroke-linecap="round" stroke-linejoin="round" opacity=".85"/>`
      + `<polyline points="${ptStr}" fill="none" stroke="#F8B408" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`;
    const uniq = closedRun(pts) ? px.slice(0, -1) : px;
    svg += uniq.map((p) => `<circle cx="${p[0].toFixed(0)}" cy="${p[1].toFixed(0)}" r="8" fill="#fff" stroke="#F8B408" stroke-width="4"/>`).join("");
  }
  // numbered side labels, pushed outward from the drawing's center
  const ctrPx = toPx([ctrLat, ctrLng]);
  for (const sd of allSides) {
    const px = sd.pts.map(toPx);
    const chord = Math.hypot(px[px.length - 1][0] - px[0][0], px[px.length - 1][1] - px[0][1]);
    if (sd.ft < 3 || chord < 46) continue;
    let half = fenceRunFt(sd.pts) / 2, i = 0;
    while (i < sd.pts.length - 2 && half > fenceDistFt(sd.pts[i], sd.pts[i + 1])) { half -= fenceDistFt(sd.pts[i], sd.pts[i + 1]); i++; }
    const A = px[i], B = px[i + 1];
    const segL = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1;
    const f = Math.max(0, Math.min(1, half / (fenceDistFt(sd.pts[i], sd.pts[i + 1]) || 1)));
    const mx = A[0] + (B[0] - A[0]) * f, my = A[1] + (B[1] - A[1]) * f;
    let nx = -(B[1] - A[1]) / segL, ny = (B[0] - A[0]) / segL;
    if ((mx + nx * 48 - ctrPx[0]) ** 2 + (my + ny * 48 - ctrPx[1]) ** 2 < (mx - nx * 48 - ctrPx[0]) ** 2 + (my - ny * 48 - ctrPx[1]) ** 2) { nx = -nx; ny = -ny; }
    svg += `<text x="${(mx + nx * 48).toFixed(0)}" y="${(my + ny * 48 + 13).toFixed(0)}" text-anchor="middle" font-size="38" font-weight="800" fill="#101B30" stroke="#fff" stroke-width="9" paint-order="stroke" font-family="Arial">${sd.n} · ${sd.ft}′</text>`;
  }
  gates.forEach((g, gi) => {
    const A = toPx(g.a), B = toPx(g.b);
    svg += `<line x1="${A[0].toFixed(0)}" y1="${A[1].toFixed(0)}" x2="${B[0].toFixed(0)}" y2="${B[1].toFixed(0)}" stroke="#fff" stroke-width="12" stroke-linecap="round"/>`
      + `<line x1="${A[0].toFixed(0)}" y1="${A[1].toFixed(0)}" x2="${B[0].toFixed(0)}" y2="${B[1].toFixed(0)}" stroke="#2E9E44" stroke-width="7" stroke-linecap="round"/>`
      + `<circle cx="${A[0].toFixed(0)}" cy="${A[1].toFixed(0)}" r="7" fill="#fff" stroke="#2E9E44" stroke-width="4"/>`
      + `<circle cx="${B[0].toFixed(0)}" cy="${B[1].toFixed(0)}" r="7" fill="#fff" stroke="#2E9E44" stroke-width="4"/>`
      + `<text x="${((A[0] + B[0]) / 2).toFixed(0)}" y="${((A[1] + B[1]) / 2 + 44).toFixed(0)}" text-anchor="middle" font-size="34" font-weight="800" fill="#1E7B33" stroke="#fff" stroke-width="8" paint-order="stroke" font-family="Arial">P${gi + 1} · ${Math.round(g.widthFt)}′</text>`;
  });

  const L = es ? {
    title: "ESTIMADO DE CERCA", date: "Fecha", for: "Preparado para",
    diagram: "Diagrama de la cerca", legend: "🔴 Límite del lote (catastro) · 🟠 Cerca propuesta · 🟢 Puertas",
    netFt: "Pies lineales de cerca", panels: "Paneles", posts: "Postes", gatesL: "Puertas",
    sides: "Medidas por lado", side: "Lado", length: "Largo", fenceRun: "Cerca",
    grossFt: "Pies totales dibujados", gateOpen: "Aberturas de puertas", netRow: "PIES NETOS DE CERCA",
    gTable: "Puertas", gNum: "Puerta", gKind: "Tipo", gWidth: "Ancho", gPrice: "Precio",
    walk: "Sencilla", dbl: "Doble",
    build: "Desglose de construcción", panelsRow: (n2, w2) => `Paneles de ${w2}′`, panelsN: (n2) => `${n2}`,
    postLine: "Postes de línea", postCorner: "Postes de esquina", postTerm: "Postes terminales", postGate: "Postes de puerta",
    postTotal: "TOTAL DE POSTES", cornersRow: "Esquinas reales",
    price: "Precio", concept: "Concepto", amount: "Importe",
    fenceLine: (p2, ft2, lf2) => `${p2} — ${ft2} ft × $${lf2}/ft`,
    gateLine: (i2, k2, w2) => `Puerta ${i2} — ${k2} de ${w2}′`,
    markup: (pct) => `Ajuste de materiales (${pct}%)`, totalL: "TOTAL",
    how: "CÓMO PAGAR", zelleL: "Zelle", cash: "Efectivo o cheque aceptado",
    warranty: "GARANTÍA", valid: "Este estimado es válido por 30 días.",
    sig: "Autorizado por (firma del cliente)", sigDate: "Fecha",
    notes: "Notas",
    note1: "Medición sobre imagen satelital y límite catastral aproximado — no sustituye un levantamiento topográfico.",
    note2: "Verifica marcadores, servidumbres, setbacks y reglas del municipio o HOA antes de construir.",
    note3: "Los postes y paneles son el plan de construcción calculado; el número final se confirma en sitio.",
    made: "Hecho con ALTO Pro", pageOf: (a, b) => `Página ${a} de ${b}`, print: "🖨️ Imprimir / Guardar PDF",
  } : {
    title: "FENCE ESTIMATE", date: "Date", for: "Prepared for",
    diagram: "Fence diagram", legend: "🔴 Lot boundary (county) · 🟠 Proposed fence · 🟢 Gates",
    netFt: "Linear feet of fence", panels: "Panels", posts: "Posts", gatesL: "Gates",
    sides: "Length per side", side: "Side", length: "Length", fenceRun: "Fence",
    grossFt: "Total feet drawn", gateOpen: "Gate openings", netRow: "NET FENCE FEET",
    gTable: "Gates", gNum: "Gate", gKind: "Type", gWidth: "Width", gPrice: "Price",
    walk: "Walk", dbl: "Double",
    build: "Construction breakdown", panelsRow: (n2, w2) => `${w2}′ panels`, panelsN: (n2) => `${n2}`,
    postLine: "Line posts", postCorner: "Corner posts", postTerm: "End posts", postGate: "Gate posts",
    postTotal: "TOTAL POSTS", cornersRow: "Real corners",
    price: "Price", concept: "Item", amount: "Amount",
    fenceLine: (p2, ft2, lf2) => `${p2} — ${ft2} ft × $${lf2}/ft`,
    gateLine: (i2, k2, w2) => `Gate ${i2} — ${w2}′ ${k2}`,
    markup: (pct) => `Material adjustment (${pct}%)`, totalL: "TOTAL",
    how: "HOW TO PAY", zelleL: "Zelle", cash: "Cash or check accepted",
    warranty: "WARRANTY", valid: "This estimate is valid for 30 days.",
    sig: "Authorized by (client signature)", sigDate: "Date",
    notes: "Notes",
    note1: "Measured over satellite imagery and the approximate cadastral boundary — not a substitute for a survey.",
    note2: "Verify markers, easements, setbacks and city/HOA rules before building.",
    note3: "Posts and panels are the computed build plan; final counts are confirmed on site.",
    made: "Made with ALTO Pro", pageOf: (a, b) => `Page ${a} of ${b}`, print: "🖨️ Print / Save PDF",
  };
  const fmtM = (n2) => "$" + Number(n2 || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
  const lfDisp = lf % 1 ? lf.toFixed(2) : String(lf);
  const header = `<div class="hd">
    <div class="hd-l">${lg ? `<img src="/api/logo/${lg}" alt="" onerror="this.style.display='none'">` : ""}<div><div class="hd-biz">${biz || "—"}</div><div class="hd-sub">${[ph, em, lic && ((es ? "Licencia: " : "License: ") + lic)].filter(Boolean).join(" · ")}</div></div></div>
    <div class="hd-r"><div class="hd-title">${L.title}${inv ? ` #${inv}` : ""}</div><div class="hd-sub">${L.date}: ${dt}</div></div>
  </div>`;
  const totalPages = 3;
  const footer = (n2) => `<div class="ft"><span>${biz}${addr ? " · " + addr : ""}</span><span>${L.made} · ${L.pageOf(n2, totalPages)}</span></div>`;
  const multiRun = runs.length > 1;
  const sideRows = allSides.map((sd) =>
    `<tr><td>${sd.n}${multiRun ? ` <span style="color:#9AA0AC;font-size:11px">(${L.fenceRun} ${sd.run + 1})</span>` : ""}</td><td>${sd.ft}′</td></tr>`).join("");
  const gateRows = gates.map((g, gi) =>
    `<tr><td>P${gi + 1}</td><td>${g.kind === "walk" ? L.walk : L.dbl}</td><td>${Math.round(g.widthFt * 10) / 10}′</td><td style="text-align:right;font-weight:700">${fmtM(g.price)}</td></tr>`).join("");
  const priceRows = [
    `<tr><td>${L.fenceLine(prodN, q.netFt, lfDisp)}</td><td>${fmtM(q.fenceCost)}</td></tr>`,
    ...gates.map((g, gi) => `<tr><td>${L.gateLine(gi + 1, g.kind === "walk" ? L.walk : L.dbl, Math.round(g.widthFt * 10) / 10)}</td><td>${fmtM(g.price)}</td></tr>`),
    ...(q.markupAmt ? [`<tr><td>${L.markup(mkPct)}</td><td>${fmtM(q.markupAmt)}</td></tr>`] : []),
  ].join("");
  res.send(`<!doctype html><html lang="${es ? "es" : "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=880">
<title>${L.title} — ${addr || cn}</title><meta name="robots" content="noindex">
<style>
*{box-sizing:border-box;margin:0;font-family:Arial,Helvetica,sans-serif}
body{background:#E8EBF1;color:#101B30}
.page{width:816px;min-height:1056px;margin:16px auto;background:#fff;border-left:10px solid #F8B408;padding:36px 42px 60px;position:relative;box-shadow:0 10px 30px rgba(16,27,48,.15)}
.hd{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #101B30;padding-bottom:14px;margin-bottom:22px}
.hd-l{display:flex;gap:12px;align-items:center}.hd-l img{max-height:52px;max-width:150px}
.hd-biz{font-weight:800;font-size:19px}.hd-sub{font-size:11px;color:#67718A;font-weight:600;margin-top:2px}
.hd-title{font-weight:800;font-size:15px;letter-spacing:1px;text-align:right;color:#101B30}
h2{font-size:14px;letter-spacing:1.5px;color:#B45309;text-transform:uppercase;margin:20px 0 10px}
.addr{font-size:22px;font-weight:800}
.cust{font-size:14px;color:#67718A;font-weight:700;margin:2px 0 14px}
.diagram{position:relative;width:100%;aspect-ratio:1/1;background:#0B1322;border-radius:10px;overflow:hidden}
.diagram img{position:absolute;inset:0;width:100%;height:100%}
.diagram svg{position:absolute;inset:0;width:100%;height:100%}
.legend{font-size:11.5px;color:#5A6478;font-weight:700;margin-top:8px}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:16px}
.stat{border:1.5px solid #E6E8EC;border-radius:12px;padding:12px 10px;text-align:center}
.stat b{display:block;font-size:24px}.stat span{font-size:10.5px;color:#67718A;font-weight:700;letter-spacing:.4px}
table{width:100%;border-collapse:collapse;font-size:13px}
table td,table th{padding:7px 10px;border-bottom:1px solid #EDF0F4;text-align:left}
table th{font-size:10.5px;letter-spacing:1px;color:#67718A;text-transform:uppercase}
.sides{width:46%;display:inline-table;vertical-align:top;margin-right:3%}
.sides td:last-child{text-align:right;font-weight:700}
.tot td{font-weight:800;border-top:2px solid #101B30}
.kv td:first-child{color:#67718A;font-weight:600;width:55%}
.kv td:last-child{font-weight:800;text-align:right}
.price td:last-child{text-align:right;font-weight:700;white-space:nowrap}
.due td{font-size:19px;font-weight:800;border-top:2px solid #101B30}
.due td:last-child{color:#B45309}
.pay{background:#FEF5DC;border-radius:12px;padding:14px 16px;font-size:14px;margin-top:14px}
.pay b{display:block;font-size:11px;letter-spacing:1px;color:#B45309;margin-bottom:6px}
.warr{background:#EAF8EF;border:1.5px solid #BFE6CC;border-radius:12px;padding:13px 15px;margin-top:14px;font-size:13.5px;font-weight:700;color:#1E7B3C}
.warr b{display:block;font-size:10px;letter-spacing:1px;color:#1E9E5A;margin-bottom:2px}
.notes p{font-size:12px;color:#5A6478;font-weight:600;line-height:1.65;margin-bottom:6px}
.sig{display:flex;gap:24px;margin-top:44px;font-size:12px;color:#67718A}
.sig div{border-top:1.5px solid #101B30;padding-top:5px}
.ft{position:absolute;left:42px;right:42px;bottom:20px;display:flex;justify-content:space-between;font-size:10px;color:#9AA0AC;font-weight:700;border-top:1px solid #EDF0F4;padding-top:8px}
.btn{position:fixed;right:18px;bottom:18px;background:#F8B408;color:#101B30;border:none;border-radius:12px;padding:13px 20px;font-weight:800;font-size:14px;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.25);z-index:9}
@media print{body{background:#fff}.page{margin:0;box-shadow:none;width:auto;min-height:auto;page-break-after:always}.btn,.noprint{display:none}}
</style></head><body>
${req.query.app != null ? `<div class="noprint" style="padding:12px 16px 0;max-width:816px;margin:0 auto"><a href="/" onclick="if(history.length>1){history.back();return false}" style="display:inline-flex;align-items:center;gap:5px;background:#fff;border:1.5px solid #E6E8EC;border-radius:999px;padding:10px 16px;font-weight:800;font-size:15px;color:#101B30;text-decoration:none;box-shadow:0 4px 14px rgba(16,27,48,.12)">‹ ${es ? "Volver a la app" : "Back to app"}</a></div>` : ""}
<button class="btn" onclick="window.print()">${L.print}</button>
<div class="page">
  ${header}
  <div class="addr">${addr || "—"}</div>
  <div class="cust">${L.for}: ${cn || "—"}</div>
  <h2>${L.diagram}</h2>
  <div class="diagram">
    <img src="${img}" alt="" onerror="this.style.display='none'">
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${svg}</svg>
  </div>
  <div class="legend">${L.legend}</div>
  <div class="stats">
    <div class="stat"><b>${q.netFt.toLocaleString()}′</b><span>${L.netFt}</span></div>
    <div class="stat"><b>${q.panels}</b><span>${L.panels} (${panelW}′)</span></div>
    <div class="stat"><b>${q.postsTotal}</b><span>${L.posts}</span></div>
    <div class="stat"><b>${gates.length}</b><span>${L.gatesL}</span></div>
  </div>
  ${footer(1)}
</div>
<div class="page">
  ${header}
  <h2>${L.sides}</h2>
  <table class="sides"><tr><th>${L.side}</th><th>${L.length}</th></tr>${sideRows}
    <tr class="tot"><td>${L.grossFt}</td><td>${q.grossFt}′</td></tr></table>
  <table class="sides kv" style="margin-right:0">
    <tr><td>${L.grossFt}</td><td>${q.grossFt}′</td></tr>
    <tr><td>− ${L.gateOpen}</td><td>−${q.gateFt}′</td></tr>
    <tr class="tot"><td>${L.netRow}</td><td>${q.netFt}′</td></tr>
  </table>
  ${gates.length ? `<h2 style="margin-top:24px">${L.gTable}</h2>
  <table><tr><th>${L.gNum}</th><th>${L.gKind}</th><th>${L.gWidth}</th><th style="text-align:right">${L.gPrice}</th></tr>${gateRows}</table>` : ""}
  <h2 style="margin-top:24px">${L.build}</h2>
  <table class="kv">
    <tr><td>${L.panelsRow(q.panels, panelW)} — ${prodN}</td><td>${q.panels}</td></tr>
    <tr><td>${L.postLine}</td><td>${q.posts.line}</td></tr>
    <tr><td>${L.postCorner}</td><td>${q.posts.corner}</td></tr>
    <tr><td>${L.postTerm}</td><td>${q.posts.terminal}</td></tr>
    <tr><td>${L.postGate}</td><td>${q.posts.gate}</td></tr>
    <tr class="tot"><td>${L.postTotal}</td><td>${q.postsTotal}</td></tr>
    <tr><td>${L.cornersRow}</td><td>${q.corners}</td></tr>
  </table>
  ${footer(2)}
</div>
<div class="page">
  ${header}
  <h2>${L.price}</h2>
  <table class="price"><tr><th>${L.concept}</th><th style="text-align:right">${L.amount}</th></tr>
    ${priceRows}
    <tr class="due"><td>${L.totalL}</td><td>${fmtM(q.total)}</td></tr>
  </table>
  ${wr ? `<div class="warr"><b>🛡️ ${L.warranty}</b>${wr}</div>` : ""}
  <div class="pay"><b>${L.how}</b>${zelle ? `🏦 ${L.zelleL}: <strong>${zelle}</strong><br>` : ""}💵 ${L.cash}</div>
  <div class="notes" style="margin-top:20px"><h2>${L.notes}</h2>
    <p>≈ ${L.note1}</p><p>• ${L.note2}</p><p>• ${L.note3}</p>
  </div>
  <p style="font-size:12px;color:#67718A;font-weight:600;margin-top:18px">${L.valid}</p>
  <div class="sig">
    <div style="flex:2">${L.sig}</div>
    <div style="flex:1">${L.sigDate}</div>
  </div>
  ${footer(3)}
</div>
</body></html>`);
});

/* ── Hoja de materiales (/m) — the CONTRACTOR's internal sheet, never the
 * homeowner's: who and where the job is, the measurements, and the shopping
 * list exactly as configured in the app's takeoff (checked lines, edited
 * quantities and prices), with printable ☐ checkboxes for the store run.
 * Same ?d= everything-in-the-link pattern as /i, /r and /f. */
app.get("/m", (req, res) => {
  let d;
  try {
    const b64 = String(req.query.d || "").replace(/-/g, "+").replace(/_/g, "/");
    d = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  } catch {
    return res.status(400).send("Invalid link");
  }
  const es = d.lang !== "en";
  const esc = (s) => String(s || "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : 0; };
  const m = d.m && typeof d.m === "object" ? d.m : {};
  const rows = (Array.isArray(d.rows) ? d.rows.slice(0, 20) : [])
    .map((r) => (Array.isArray(r) ? { name: esc(String(r[0] || "").slice(0, 60)), qty: Math.max(0, Math.round(num(r[1]))), price: r[2] == null ? null : Math.max(0, num(r[2])) } : null))
    .filter((r) => r && r.name && r.qty > 0);
  const tot = rows.reduce((s, r) => (r.price != null ? s + r.qty * r.price : s), 0);
  const biz = esc(String(d.biz || "").slice(0, 60));
  const ph = esc(String(d.ph || "").slice(0, 24));
  const lg = d.lg ? String(d.lg).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60) : "";
  const cn = esc(String(d.cn || "").slice(0, 60));
  const ca = esc(String(d.ca || "").slice(0, 120));
  const dt = esc(String(d.dt || "").slice(0, 24));
  const zip = String(d.zip || "").replace(/\D/g, "").slice(0, 5);
  const upd = esc(String(d.upd || "").slice(0, 24));
  const prod = esc(String(m.prod || "").slice(0, 40));
  const posts = m.posts && typeof m.posts === "object" ? m.posts : {};
  // House photos: aerial with the fence drawn over it + the street elevation.
  // Coordinates are attacker-controllable (?d= link) — coerce every number so
  // only digits reach the src attributes, same rule as /i and /f.
  const fin = (x) => { const n = Number(x); return Number.isFinite(n) ? n : null; };
  const la = fin(m.la), ln = fin(m.ln);
  const zm = Math.min(21, Math.max(14, Math.round(fin(m.zm) ?? 19)));
  const liN = (Array.isArray(m.li) ? m.li.slice(0, 8) : [])
    .map((run) => (Array.isArray(run) ? run.slice(0, 60).map((p) => (Array.isArray(p) ? [fin(p[0]), fin(p[1])] : null)).filter((p) => p && p[0] != null && p[1] != null) : []))
    .filter((run) => run.length >= 2);
  const aerial = la != null && ln != null
    ? `/api/roofimg?lat=${la}&lng=${ln}&zoom=${zm}&sq=1` +
      (liN.length ? `&lines=${liN.map((run) => run.map((p) => p.join(",")).join("|")).join(";")}` : "")
    : null;
  const street = la != null && ln != null ? `/api/streetview?lat=${la}&lng=${ln}` : null;
  const L = es ? {
    title: "HOJA DE MATERIALES", internal: "USO INTERNO — no es la cotización del cliente",
    client: "Cliente", addr: "Dirección", date: "Fecha",
    meas: "Medidas de la cerca", netFt: "Pies netos de cerca", panels: "Paneles", postsL: "Postes", gatesL: "Puertas",
    grossFt: "Pies totales dibujados", gateOpen: "Aberturas de puertas", panelW: "Ancho de panel",
    pLine: "Postes de línea", pCorner: "Postes de esquina", pTerm: "Postes terminales", pGate: "Postes de puerta", cornersL: "Esquinas reales",
    list: "Lista de compra", item: "Material", qty: "Cant.", unit: "Precio", line: "Total",
    total: "TOTAL MATERIALES", src: (z, u) => `Precios Home Depot${z ? " " + z : ""}${u ? " · actualizado " + u : ""} — referencia, verifica en tienda.`,
    aerialT: "🛰️ Vista aérea (cerca marcada)", streetT: "🏠 Fachada de la casa",
    made: "Hecho con ALTO Pro", print: "🖨️ Imprimir / Guardar PDF",
  } : {
    title: "MATERIALS SHEET", internal: "INTERNAL USE — not the client's quote",
    client: "Client", addr: "Address", date: "Date",
    meas: "Fence measurements", netFt: "Net fence feet", panels: "Panels", postsL: "Posts", gatesL: "Gates",
    grossFt: "Total feet drawn", gateOpen: "Gate openings", panelW: "Panel width",
    pLine: "Line posts", pCorner: "Corner posts", pTerm: "End posts", pGate: "Gate posts", cornersL: "Real corners",
    list: "Shopping list", item: "Material", qty: "Qty", unit: "Price", line: "Total",
    total: "MATERIALS TOTAL", src: (z, u) => `Home Depot prices${z ? " " + z : ""}${u ? " · updated " + u : ""} — reference, verify in store.`,
    aerialT: "🛰️ Aerial view (fence marked)", streetT: "🏠 Front of the house",
    made: "Made with ALTO Pro", print: "🖨️ Print / Save PDF",
  };
  const fmtM = (n) => "$" + Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
  const fmt2 = (n) => "$" + Number(n || 0).toFixed(2);
  res.send(`<!doctype html><html lang="${es ? "es" : "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${L.title} — ${ca || biz}</title><meta name="robots" content="noindex">
<style>
*{box-sizing:border-box;margin:0;font-family:Arial,Helvetica,sans-serif}
body{background:#E8EBF1;color:#101B30}
.page{max-width:816px;min-height:9in;margin:16px auto;background:#fff;border-left:10px solid #F8B408;padding:34px 40px 46px;position:relative;box-shadow:0 10px 30px rgba(16,27,48,.15)}
.hd{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #101B30;padding-bottom:13px;margin-bottom:16px}
.hd-l{display:flex;gap:12px;align-items:center}.hd-l img{max-height:50px;max-width:150px}
.hd-biz{font-weight:800;font-size:18px}.hd-sub{font-size:11px;color:#67718A;font-weight:600;margin-top:2px}
.hd-title{font-weight:800;font-size:15px;letter-spacing:1px;text-align:right}
.internal{display:inline-block;background:#FDECEC;color:#B91C1C;border:1.5px solid #E5484D;border-radius:8px;padding:5px 12px;font-weight:800;font-size:10.5px;letter-spacing:.8px;margin-bottom:14px}
h2{font-size:13.5px;letter-spacing:1.4px;color:#B57E00;text-transform:uppercase;margin:18px 0 8px;border-bottom:1.5px solid #E6E8EC;padding-bottom:4px}
.who td{padding:4px 10px 4px 0;font-size:13.5px}
.who td:first-child{color:#67718A;font-weight:700;width:110px}
.who td:last-child{font-weight:800}
.blank{display:inline-block;min-width:280px;border-bottom:1.5px solid #101B30;height:16px;vertical-align:bottom}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:9px;margin:4px 0 8px}
.stat{border:1.5px solid #E6E8EC;border-radius:12px;padding:10px 8px;text-align:center}
.stat b{display:block;font-size:22px}.stat span{font-size:10px;color:#67718A;font-weight:700;letter-spacing:.4px}
table.kv{width:100%;border-collapse:collapse;font-size:12.5px}
table.kv td{padding:5px 8px;border-bottom:1px solid #EDF0F4}
table.kv td:first-child{color:#67718A;font-weight:600;width:55%}
table.kv td:last-child{font-weight:800;text-align:right}
table.buy{width:100%;border-collapse:collapse;font-size:13px}
table.buy th{font-size:10px;letter-spacing:1px;color:#67718A;text-transform:uppercase;text-align:left;padding:6px 8px;border-bottom:1.5px solid #E6E8EC}
table.buy td{padding:8px;border-bottom:1px solid #EDF0F4}
.cb{width:15px;height:15px;border:2px solid #101B30;border-radius:4px;display:inline-block;vertical-align:middle}
td.r{text-align:right;font-weight:700;white-space:nowrap}
tr.tt td{border-top:2px solid #101B30;border-bottom:none;font-weight:800;font-size:15px;padding-top:10px}
tr.tt td.r{color:#1E7B33;font-size:20px}
.src{font-size:10.5px;color:#9AA0AC;font-weight:600;margin-top:8px}
.ft{position:absolute;left:40px;right:40px;bottom:14px;display:flex;justify-content:space-between;font-size:9.5px;color:#9AA0AC;font-weight:700;border-top:1px solid #EDF0F4;padding-top:7px}
.btn{position:fixed;right:18px;bottom:18px;background:#F8B408;color:#101B30;border:none;border-radius:12px;padding:13px 20px;font-weight:800;font-size:14px;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.25);z-index:9}
@media print{body{background:#fff}.page{margin:0;box-shadow:none;max-width:none;min-height:auto}.btn,.noprint{display:none}}
@page{margin:10mm}
</style></head><body>
${req.query.app != null ? `<div class="noprint" style="padding:12px 16px 0;max-width:816px;margin:0 auto"><a href="/" onclick="if(history.length>1){history.back();return false}" style="display:inline-flex;align-items:center;gap:5px;background:#fff;border:1.5px solid #E6E8EC;border-radius:999px;padding:9px 14px;font-weight:800;font-size:14px;color:#101B30;text-decoration:none;box-shadow:0 4px 14px rgba(16,27,48,.12)">‹ ${es ? "Volver a la app" : "Back to app"}</a></div>` : ""}
<button class="btn" onclick="window.print()">${L.print}</button>
<div class="page">
  <div class="hd">
    <div class="hd-l">${lg ? `<img src="/api/logo/${lg}" alt="" onerror="this.style.display='none'">` : ""}<div><div class="hd-biz">${biz || "—"}</div><div class="hd-sub">${ph}</div></div></div>
    <div><div class="hd-title">${L.title}</div><div class="hd-sub" style="text-align:right">${L.date}: ${dt}</div></div>
  </div>
  <span class="internal">🔒 ${L.internal}</span>
  <table class="who">
    <tr><td>${L.client}:</td><td>${cn || '<span class="blank"></span>'}</td></tr>
    <tr><td>${L.addr}:</td><td>${ca || '<span class="blank"></span>'}</td></tr>
  </table>
  <h2>${L.meas}${prod ? ` · ${prod}` : ""}</h2>
  <div class="stats">
    <div class="stat"><b>${num(m.net).toLocaleString()}′</b><span>${L.netFt}</span></div>
    <div class="stat"><b>${num(m.panels)}</b><span>${L.panels}${m.pw ? ` (${num(m.pw)}′)` : ""}</span></div>
    <div class="stat"><b>${num(m.postsTotal)}</b><span>${L.postsL}</span></div>
    <div class="stat"><b>${num(m.gates)}</b><span>${L.gatesL}</span></div>
  </div>
  <table class="kv">
    <tr><td>${L.grossFt}</td><td>${num(m.gross)}′</td></tr>
    ${num(m.gate) ? `<tr><td>− ${L.gateOpen}</td><td>−${num(m.gate)}′</td></tr>` : ""}
    <tr><td>${L.pLine} / ${L.pCorner.toLowerCase()} / ${L.pTerm.toLowerCase()} / ${L.pGate.toLowerCase()}</td><td>${num(posts.line)} / ${num(posts.corner)} / ${num(posts.terminal)} / ${num(posts.gate)}</td></tr>
    <tr><td>${L.cornersL}</td><td>${num(m.corners)}</td></tr>
  </table>
  ${aerial ? `<div style="display:grid;grid-template-columns:1.08fr 1fr;gap:12px;margin:16px 0 2px">
    <div><h2 style="margin-top:0">${L.aerialT}</h2>
      <img src="${aerial}" alt="" style="width:100%;display:block;border-radius:10px;border:1px solid #E6E8EC"></div>
    <div id="stw"><h2 style="margin-top:0">${L.streetT}</h2>
      <img src="${street}" alt="" style="width:100%;display:block;border-radius:10px;border:1px solid #E6E8EC" onerror="var s=document.getElementById('stw');if(s)s.style.display='none'"></div>
  </div>` : ""}
  <h2>${L.list}</h2>
  <table class="buy">
    <tr><th></th><th>${L.item}</th><th style="text-align:right">${L.qty}</th><th style="text-align:right">${L.unit}</th><th style="text-align:right">${L.line}</th></tr>
    ${rows.map((r) => `<tr><td style="width:26px"><span class="cb"></span></td><td style="font-weight:700">${r.name}</td><td class="r">${r.qty}</td><td class="r">${r.price != null ? fmt2(r.price) : "—"}</td><td class="r">${r.price != null ? fmtM(r.qty * r.price) : "—"}</td></tr>`).join("")}
    <tr class="tt"><td></td><td>${L.total}</td><td></td><td></td><td class="r">${fmtM(tot)}</td></tr>
  </table>
  <p class="src">💲 ${L.src(zip, upd)}</p>
  <div class="ft"><span>${biz}${ca ? " · " + ca : ""}</span><span>⚡ ${L.made}</span></div>
</div>
</body></html>`);
});

app.post("/api/ai", async (req, res) => {
  const { messages, lang = "es", trade = "concrete", bizName = "", data = {} } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 40) return res.status(400).json({ error: "messages required" });
  // Only a logged-in contractor reaches the paid model. Anyone else (and the
  // no-key demo) gets the canned demo reply — so the LLM bill can't be run up
  // by anonymous traffic, and demo users still see a sensible response.
  const c = await auth(req).catch(() => null);
  if (!c || !aiLive) {
    return res.json({
      text: lang === "es"
        ? "(Demo) El asistente se activa cuando entras a tu cuenta y el servidor tiene una clave de IA. Todo lo demás de la app ya funciona."
        : "(Demo) The assistant turns on once you're signed in and the server has an AI key. Everything else in the app already works.",
      source: "demo",
    });
  }
  if (overQuota(`ai:${c.id}`, 60) || overQuota("ai:all", 2000)) {
    return res.status(429).json({ error: "rate", text: lang === "es" ? "Demasiadas preguntas por hoy — intenta más tarde." : "Too many questions today — try again later." });
  }
  try {
    const text = await aiChat({
      maxTokens: 1024,
      system: `You are the AI assistant inside ALTO Pro, an app for Latino contractors. The contractor is a ${trade} contractor${bizName ? ` (business: ${bizName})` : ""}. Reply in ${lang === "es" ? "Spanish" : "English"}, max 90 words, plain text only (no markdown). Concrete math: cubic yards = (L ft × W ft × thickness in/12) / 27, add waste %, trucks hold 10 yd³. Roofing math: roof area = footprint sq ft × pitch factor (6/12 = 1.118), squares = area/100 rounded up, add 10% material waste. NEVER invent prices from the contractor's data; if asked about market rates, give a clearly-labeled rough range and say to verify locally. Contractor's current data: ${JSON.stringify(data).slice(0, 4000)}`,
      messages,
    });
    res.json({ text, source: "live" });
  } catch (e) {
    console.error("ai failed:", e.message);
    res.status(502).json({ error: "ai_failed" });
  }
});

/* Read a property survey / plat's boundary "calls" (quadrant bearing + distance)
 * off a photo or PDF, so the fence tool can draw the EXACT lot a licensed
 * surveyor measured — tighter than a satellite trace. VISION ONLY: the
 * deterministic traverse (src/surveyTraverse.js) runs client-side and lands in
 * an EDITABLE review step, so a misread never silently corrupts a quote. Same
 * gate as the AI assistant (signed-in contractor). No AI key configured → canned
 * demo calls, exactly like /api/ai, so the whole flow stays demoable offline. */
app.post("/api/survey-extract", async (req, res) => {
  const me = await auth(req).catch(() => null);
  const demoOk = !!DEMO_PASS && String(req.body?.demo || "") === DEMO_PASS;
  if (!me && !demoOk) return res.status(403).json({ error: "login" });
  if (me && overQuota(`survey:${me.id}`, 40)) return res.status(429).json({ error: "quota" });
  const b64 = String(req.body?.file || "");
  if (!b64 || b64.length > 9e6) return res.status(400).json({ error: "file" }); // ≈6.5 MB binary
  const mime = /^(image\/(png|jpe?g|webp|gif)|application\/pdf)$/.test(String(req.body?.mime || "")) ? req.body.mime : "image/jpeg";

  // Demo fallback (no AI key): a canonical rectangular lot so the full
  // import → traverse → editable-lot → quote path is testable and demoable
  // offline. Production always has the key, so real extraction runs there.
  if (!anthropic) {
    return res.json({
      source: "demo",
      note: "Ejemplo — el lector de levantamientos usa la IA del servidor (falta la clave). Todo lo demás ya funciona.",
      calls: [
        { ns: "S", deg: 60, min: 24, sec: 0, ew: "E", dist: 55 },
        { ns: "S", deg: 30, min: 5, sec: 20, ew: "W", dist: 114 },
        { ns: "N", deg: 60, min: 24, sec: 0, ew: "W", dist: 55 },
        { ns: "N", deg: 30, min: 5, sec: 20, ew: "E", dist: 114 },
      ],
    });
  }

  const source = { type: "base64", media_type: mime, data: b64 };
  const block = mime === "application/pdf" ? { type: "document", source } : { type: "image", source };
  const sys = "You read US property surveys / plats. Extract the boundary CALLS that trace the lot perimeter, in order (clockwise or counter-clockwise, consistent). Each call is a quadrant bearing + a distance in FEET. Reply with STRICT JSON only, no prose, no code fence: {\"calls\":[{\"ns\":\"N|S\",\"deg\":0-90,\"min\":0-59,\"sec\":0-59,\"ew\":\"E|W\",\"dist\":feet},...],\"note\":\"short note in Spanish about anything you skipped or were unsure of\"}. Read bearings like S 60°24'00\" E as {ns:S,deg:60,min:24,sec:0,ew:E}. Use the plat's recorded (deed) bearings and distances, not measured field ties. SKIP curved segments (arc/radius/delta/chord) — do not invent straight calls for them; mention them in note. If the image is not a boundary survey, return {\"calls\":[],\"note\":\"...\"}.";
  try {
    const msg = await anthropic.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 1500,
      system: sys,
      messages: [{ role: "user", content: [block, { type: "text", text: "Extract the boundary calls as JSON." }] }],
    });
    const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
    let parsed = null;
    try { parsed = JSON.parse(text); }
    catch { const m = /\{[\s\S]*\}/.exec(text); if (m) { try { parsed = JSON.parse(m[0]); } catch { /* give up */ } } }
    if (!parsed || !Array.isArray(parsed.calls)) return res.json({ source: "live", calls: [], note: "No pude leer los lados del lote en esta imagen." });
    res.json({ source: "live", calls: parsed.calls.slice(0, 60), note: String(parsed.note || "").slice(0, 240) });
  } catch (e) {
    console.error("survey-extract failed:", e.message);
    res.status(502).json({ error: "extract_failed" });
  }
});

/* Parse a spoken phrase like "factura para María García, reparación de techo,
 * 450 dólares" into draft invoice fields. Claude when a key is set, simple
 * pattern matching otherwise. Always returns a draft for human review. */
function parseInvoiceFallback(text) {
  const amounts = [...String(text).matchAll(/\$?\s?(\d[\d,]*(?:\.\d{1,2})?)/g)].map((m) => parseFloat(m[1].replace(/,/g, "")));
  const amount = amounts.length ? Math.max(...amounts) : null;
  const nm = String(text).match(/(?:para|for)\s+([A-ZÁÉÍÓÚÑ][\wáéíóúñ'-]*(?:\s+[A-ZÁÉÍÓÚÑ][\wáéíóúñ'-]*){0,2})/i);
  return { name: nm ? nm[1].trim() : "", concept: String(text).trim(), amount };
}

/* Whisper transcription for the quick invoice — dramatically better Spanish
 * than the browser's built-in speech recognition, especially with accents and
 * roofing vocabulary. Audio arrives as base64 (a few hundred KB for ~20s). */
app.post("/api/transcribe", async (req, res) => {
  const me = await auth(req).catch(() => null);
  const demoOk = !!DEMO_PASS && String(req.body?.demo || "") === DEMO_PASS;
  if (!me && !demoOk) return res.status(403).json({ error: "login" });
  if (!OPENAI_KEY) return res.status(503).json({ error: "no_stt" });
  if (me && overQuota(`stt:${me.id}`, 150)) return res.status(429).json({ error: "quota" });
  const b64 = String(req.body?.audio || "");
  if (!b64 || b64.length > 1.6e6) return res.status(400).json({ error: "audio" });
  const mime = /^audio\/(webm|mp4|mpeg|ogg|wav)$/.test(String(req.body?.mime || "")) ? req.body.mime : "audio/webm";
  try {
    const buf = Buffer.from(b64, "base64");
    const fd = new FormData();
    fd.append("file", new Blob([buf], { type: mime }), mime.includes("mp4") ? "a.mp4" : "a.webm");
    fd.append("model", "whisper-1");
    fd.append("language", req.body?.lang === "en" ? "en" : "es");
    fd.append("prompt", "Factura de un contratista de techos: trabajos y precios. Ej: subida de teja, instalación de tejado, reparación de goteras.");
    const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_KEY}` },
      body: fd,
    });
    if (!r.ok) throw new Error(`stt ${r.status}: ${(await r.text()).slice(0, 120)}`);
    const j = await r.json();
    res.json({ ok: true, text: String(j.text || "").slice(0, 800) });
  } catch (e) {
    console.error("transcribe:", e.message);
    res.status(502).json({ error: "stt_failed" });
  }
});

// Polish the contractor's "lo que incluye" proposal text: same points,
// professional wording, one line per item. Suggestion only — the contractor
// sees the result in the textarea and can keep editing.
app.post("/api/scopeai", async (req, res) => {
  const c = await auth(req);
  if (!c) return res.status(401).json({ error: "no session" });
  const text = String(req.body?.text || "").slice(0, 1500);
  if (!text.trim()) return res.status(400).json({ error: "text required" });
  if (!aiLive) return res.status(503).json({ error: "ai_off" });
  if (overQuota(`scai:${clientIp(req)}`, 10)) return res.status(429).json({ error: "quota" });
  const en = req.body?.lang === "en";
  try {
    const out = await aiChat({
      maxTokens: 400,
      system: `Eres redactor de propuestas de una compañía de techos. Te doy la lista de "lo que incluye el trabajo" de un contratista. Mejórala: redacción clara, profesional y concreta, UNA línea por punto, sin numeración, sin viñetas, sin markdown, máximo 10 líneas, en ${en ? "inglés" : "español"}. Conserva los puntos que él puso — no inventes servicios que no mencionó. Responde SOLO con las líneas.`,
      messages: [{ role: "user", content: text }],
    });
    res.json({ text: String(out || "").trim().slice(0, 1500) });
  } catch (e) {
    console.error("scopeai failed:", e.message);
    res.status(502).json({ error: "ai_failed" });
  }
});

app.post("/api/parse", async (req, res) => {
  const { text, lang = "es" } = req.body || {};
  if (!text || String(text).length > 2000) return res.status(400).json({ error: "text required" });
  // Same rule as /api/ai: only a signed-in, under-quota contractor hits the
  // paid model; everyone else gets the local pattern-match fallback below.
  const c = await auth(req).catch(() => null);
  if (c && aiLive && !overQuota(`ai:${c.id}`, 60) && !overQuota("ai:all", 2000)) {
    try {
      const raw = await aiChat({
        maxTokens: 500,
        system: `Extract invoice data from a contractor's spoken phrase (Spanish or English, from speech recognition — expect transcription errors). The phrase may contain SEVERAL line items. Reply with ONLY a JSON object: {"name": customer or company name or "", "lines": [{"c": short clean description of one work item in ${lang === "es" ? "Spanish" : "English"} (no customer name, no amount in it), "a": number}]}. One object per work item. Numbers may be spoken as words ("cuatrocientos cincuenta" = 450, "mil doscientos" = 1200). If an item has no amount, omit it from lines.`,
        messages: [{ role: "user", content: String(text) }],
      });
      const j = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || "{}");
      const lines = (Array.isArray(j.lines) ? j.lines : [])
        .map((l) => ({ c: String(l.c || l.concept || "").slice(0, 90), a: Math.round(Number(l.a ?? l.amount) || 0) }))
        .filter((l) => l.c && l.a > 0)
        .slice(0, 12);
      // keep the old single-field shape too so nothing downstream breaks
      return res.json({ name: j.name || "", lines, concept: lines[0]?.c || String(text), amount: lines[0]?.a ?? null, source: "live" });
    } catch (e) {
      console.error("parse failed:", e.message);
    }
  }
  res.json({ ...parseInvoiceFallback(text), source: "demo" });
});

// Terminal error handler: any error bubbling out of a route returns a clean 500
// without leaking a stack trace or hanging the request. (Express 5 forwards
// rejected async handlers here automatically.)
app.use((err, req, res, next) => {
  console.error("route error:", err && err.stack ? err.stack : err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "server_error" });
});

await db.initDb();

/* Grace period: a failed payment older than 7 days pauses the client
 * automatically. Reactivation happens instantly via the Stripe webhook. */
async function graceSweep() {
  try {
    const list = await db.listContractors();
    for (const c of list) {
      const d = c.data || {};
      if (d.payStatus === "failed" && d.payFailedAt && d.status !== "paused"
        && Date.now() - new Date(d.payFailedAt).getTime() > 7 * 864e5) {
        await db.patchContractorData(c.id, { status: "paused" });
        console.log(`grace expired → paused ${c.slug}`);
      }
    }
  } catch (e) { console.error("grace sweep failed:", e.message); }
}

/* ═════════ ALTO Pro HEADQUARTERS (/hq) — the owner's private cockpit ═════════
 * Portfolio of every product (live numbers for ALTO verticals, manual cards
 * for external ones), the mastermind idea board, and an AI thinking partner
 * that knows the real numbers. Guarded by its OWN key (HQ_KEY) — no staff
 * key opens it, not even ADMIN_KEY. */
const HQ_KEY = process.env.HQ_KEY || "";
const hqOk = (req) => HQ_KEY && (req.query.key === HQ_KEY || req.body?.key === HQ_KEY || reqCookies(req).alto_hq === HQ_KEY);

async function hqNumbers() {
  const list = await db.listContractors();
  const real = list.filter((c) => !["alto-demo", "alto-ventas", "alto-cercas"].includes(c.slug));
  const pack = (cs) => ({
    clients: cs.filter((c) => !(c.data && c.data.status === "paused")).length,
    paying: cs.filter((c) => (c.data?.payStatus || "") === "ok").length,
    mrr: cs.filter((c) => (c.data?.payStatus || "") === "ok").reduce((a, c) => a + PLANS[planOf(c)].price, 0),
  });
  return {
    roofing: pack(real.filter((c) => (c.data?.trade || "roofing") !== "fence")),
    fence: pack(real.filter((c) => c.data?.trade === "fence")),
  };
}
const hqId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// One endpoint mutates both stores: hq:portfolio (manual cards) + hq:ideas.
app.post("/api/hq/save", async (req, res) => {
  if (!hqOk(req)) return res.status(403).json({ error: "no" });
  const { kind, action, item = {} } = req.body || {};
  const key = kind === "card" ? "hq:portfolio" : kind === "idea" ? "hq:ideas" : null;
  if (!key || !["add", "update", "del"].includes(action)) return res.status(400).json({ error: "bad request" });
  const cur0 = await db.kvGet(key).catch(() => null);
  let arr = Array.isArray(cur0) ? cur0 : [];
  const S = (x, n) => String(x || "").slice(0, n);
  if (action === "add") {
    const it = kind === "card"
      ? { id: hqId(), name: S(item.name, 60), clients: Math.max(0, parseInt(item.clients) || 0), mrr: Math.max(0, parseInt(item.mrr) || 0), note: S(item.note, 300) }
      : { id: hqId(), lane: item.lane === "futuro" ? "futuro" : "mejora", title: S(item.title, 120), note: S(item.note, 600), stage: "idea", created_at: new Date().toISOString() };
    if (kind === "card" ? !it.name : !it.title) return res.status(400).json({ error: "falta nombre" });
    arr = [...arr, it].slice(-200);
  } else if (action === "update") {
    const STAGES = ["idea", "investigado", "planeado", "construyendo", "vivo"];
    arr = arr.map((x) => x.id !== item.id ? x : {
      ...x,
      ...(item.name != null ? { name: S(item.name, 60) } : {}),
      ...(item.title != null ? { title: S(item.title, 120) } : {}),
      ...(item.note != null ? { note: S(item.note, 600) } : {}),
      ...(item.clients != null ? { clients: Math.max(0, parseInt(item.clients) || 0) } : {}),
      ...(item.mrr != null ? { mrr: Math.max(0, parseInt(item.mrr) || 0) } : {}),
      ...(item.stage != null && STAGES.includes(item.stage) ? { stage: item.stage } : {}),
    });
  } else {
    arr = arr.filter((x) => x.id !== item.id);
  }
  await db.kvSet(key, arr);
  res.json({ ok: true });
});

// The thinking partner: brainstorms WITH the real portfolio in context.
app.post("/api/hq/brain", async (req, res) => {
  if (!hqOk(req)) return res.status(403).json({ error: "no" });
  const q = String(req.body?.q || "").slice(0, 1200);
  if (!q.trim()) return res.status(400).json({ error: "pregunta vacía" });
  if (!aiLive) return res.json({ text: "(Demo) La IA se activa cuando el servidor tenga su API key." });
  const [live, cards0, ideas0] = await Promise.all([
    hqNumbers(),
    db.kvGet("hq:portfolio").catch(() => null),
    db.kvGet("hq:ideas").catch(() => null),
  ]);
  const cards = Array.isArray(cards0) ? cards0 : [];
  const ideas = (Array.isArray(ideas0) ? ideas0 : []).map((i) => `[${i.lane}/${i.stage}] ${i.title}${i.note ? " — " + i.note.slice(0, 120) : ""}`);
  try {
    const text = await aiChat({
      maxTokens: 700,
      model: "claude-fable-5", // the strongest available — this is the owner thinking
      system: `Eres el socio estratégico personal de Rolando, dueño de ALTO Pro: un sistema operativo de negocio (ventas + Stripe + onboarding + CS + GHL) sobre el que estampa productos SaaS para contratistas hispanos. Su modelo: 4 VAs por lanzamiento (closer, setter, onboarding, CS), un lanzamiento a la vez, anuncios en Meta. Piensa con él como un fundador experimentado: directo, números primero, sin humo. Cuando proponga ideas, evalúa contra: ¿usa el motor existente?, ¿mismo motion de ventas?, ¿tamaño del mercado hispano?, ¿costo de APIs?, ¿carga para los VAs? Responde en español, máximo 250 palabras, con una recomendación clara al final.`,
      messages: [{ role: "user", content: `MIS NÚMEROS HOY: ${JSON.stringify(live)}. OTROS PRODUCTOS (manual): ${JSON.stringify(cards)}. MI TABLERO DE IDEAS: ${JSON.stringify(ideas.slice(0, 40))}.\n\nQUIERO PENSAR ESTO: ${q}` }],
    });
    res.json({ text });
  } catch (e) {
    console.error("hq brain failed:", e.message);
    res.status(502).json({ error: "ai_failed" });
  }
});

app.get("/hq", async (req, res) => {
  if (!HQ_KEY) return res.status(503).send("Set HQ_KEY env var to enable headquarters.");
  if (req.query.logout != null) { clearKeyCookie(res, "alto_hq"); return res.redirect("/hq"); }
  if (req.query.key === HQ_KEY) { setKeyCookie(req, res, "alto_hq", HQ_KEY); return res.redirect("/hq"); }
  if (req.query.key && overQuota(`keyguess:${clientIp(req)}`, 30)) return res.status(429).send("Demasiados intentos. Intenta más tarde.");
  if (!hqOk(req)) return res.status(req.query.key ? 403 : 401).send(loginPage("Headquarters", "/hq", !!req.query.key));
  const esc = (x) => String(x || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const [live, cards0, ideas0] = await Promise.all([
    hqNumbers(),
    db.kvGet("hq:portfolio").catch(() => null),
    db.kvGet("hq:ideas").catch(() => null),
  ]);
  const cards = Array.isArray(cards0) ? cards0 : [];
  const ideas = Array.isArray(ideas0) ? ideas0 : [];
  const STAGES = { idea: ["💭 Idea", "#8A93A5"], investigado: ["🔎 Investigado", "#1B6FB8"], planeado: ["📋 Planeado", "#D99E00"], construyendo: ["🔨 Construyendo", "#B3611B"], vivo: ["🟢 Vivo", "#1E7B3C"] };
  const stageSel = (i) => `<select onchange="ideaUpd('${i.id}',{stage:this.value})" class="stg" style="color:${(STAGES[i.stage] || STAGES.idea)[1]}">${Object.entries(STAGES).map(([k, [lbl]]) => `<option value="${k}" ${i.stage === k ? "selected" : ""}>${lbl}</option>`).join("")}</select>`;
  const ideaRow = (i) => `<div class="idea">
    <div class="it"><b>${esc(i.title)}</b>${stageSel(i)}</div>
    <div class="inote" onclick="ideaNote('${i.id}',this)">${i.note ? "📝 " + esc(i.note) : '<span style="color:#5A6478">📝 agregar notas…</span>'}</div>
    <button class="x" onclick="if(confirm('¿Borrar esta idea?'))ideaDel('${i.id}')">✕</button>
  </div>`;
  const autoCard = (name, icon, n) => `<div class="pcard live">
    <div class="pn">${icon} ${name} <span class="lv">EN VIVO</span></div>
    <div class="big">$${n.mrr.toLocaleString("en-US")}<span class="mo">/mes</span></div>
    <div class="ps">${n.paying} pagando · ${n.clients} activos</div>
  </div>`;
  res.send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ALTO PRO · Headquarters</title><link rel="icon" href="/icon-192.png"><style>
*{box-sizing:border-box;font-family:Inter,Arial,sans-serif;margin:0;-webkit-tap-highlight-color:transparent}
body{background:#0B1226;color:#fff;padding-bottom:60px}
.wrap{max-width:1080px;margin:0 auto;padding:0 18px}
header{padding:26px 0 18px;display:flex;align-items:center;justify-content:space-between}
header b{font-size:22px;letter-spacing:.5px}header b em{color:#F8B408;font-style:normal}
header a{color:#9DA8C4;font-size:12.5px;font-weight:700;text-decoration:none}
h2{font-size:13px;letter-spacing:2.5px;color:#F8B408;margin:26px 0 12px;text-transform:uppercase}
.pgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}
.pcard{background:#121D36;border:1px solid rgba(255,255,255,.09);border-radius:16px;padding:16px;position:relative}
.pcard.live{border-color:rgba(248,180,8,.45)}
.pn{font-weight:800;font-size:14px}.lv{font-size:9.5px;background:#F8B408;color:#101B30;font-weight:800;border-radius:99px;padding:2px 7px;margin-left:6px;letter-spacing:1px}
.big{font-size:30px;font-weight:800;margin-top:8px;font-family:'Barlow Condensed',Arial}.mo{font-size:14px;color:#9DA8C4;font-weight:700}
.ps{color:#9DA8C4;font-size:12.5px;font-weight:600;margin-top:2px}
.pnote{color:#7E8AA6;font-size:12px;margin-top:6px}
.x{position:absolute;top:10px;right:10px;background:none;border:none;color:#5A6478;font-size:14px;cursor:pointer;font-weight:700}
.addrow{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.addrow input{background:#0E1730;border:1.5px solid rgba(255,255,255,.14);border-radius:10px;color:#fff;padding:10px 12px;font-size:13.5px;font-weight:600;outline:none}
.addrow input:focus{border-color:#F8B408}
.addrow button,.brain button{background:#F8B408;border:none;border-radius:10px;color:#101B30;font-weight:800;padding:10px 16px;font-size:13px;cursor:pointer}
.lanes{display:grid;gap:14px}@media(min-width:860px){.lanes{grid-template-columns:1fr 1fr}}
.lane{background:#0E1730;border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:14px}
.lane h3{font-size:14.5px;margin-bottom:10px}
.idea{background:#121D36;border:1px solid rgba(255,255,255,.09);border-radius:12px;padding:11px 34px 11px 12px;margin-bottom:8px;position:relative}
.it{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:14px}
.stg{background:#0E1730;border:1px solid rgba(255,255,255,.14);border-radius:8px;font-weight:800;font-size:11.5px;padding:4px 6px;cursor:pointer}
.inote{color:#9DA8C4;font-size:12px;margin-top:6px;cursor:pointer;line-height:1.5}
.brain{background:#0E1730;border:1px solid rgba(248,180,8,.3);border-radius:16px;padding:16px}
.brain textarea{width:100%;background:#121D36;border:1.5px solid rgba(255,255,255,.14);border-radius:12px;color:#fff;padding:12px;font-size:14px;font-weight:600;outline:none;min-height:74px;font-family:inherit;resize:vertical}
.brain textarea:focus{border-color:#F8B408}
#bout{white-space:pre-wrap;background:#121D36;border-radius:12px;padding:14px;margin-top:12px;font-size:14px;line-height:1.65;color:#DCE4F5;display:none}
</style></head><body><div class="wrap">
<header><b>🏛 ALTO <em>PRO</em> · HEADQUARTERS</b><a href="/hq?logout=1">Salir</a></header>

<h2>Portafolio</h2>
<div class="pgrid">
  ${autoCard("ALTO Techos", "🏠", live.roofing)}
  ${FENCE_ENABLED ? autoCard("ALTO Cercas", "🪵", live.fence) : ""}
  ${cards.map((c) => `<div class="pcard">
    <div class="pn">📦 ${esc(c.name)}</div>
    <div class="big">$${(c.mrr || 0).toLocaleString("en-US")}<span class="mo">/mes</span></div>
    <div class="ps">${c.clients || 0} clientes <button style="background:none;border:none;color:#5A6478;cursor:pointer;font-size:11px" onclick="cardEdit('${c.id}',${c.clients || 0},${c.mrr || 0})">✏️ actualizar</button></div>
    ${c.note ? `<div class="pnote">${esc(c.note)}</div>` : ""}
    <button class="x" onclick="if(confirm('¿Quitar este producto del portafolio?'))cardDel('${c.id}')">✕</button>
  </div>`).join("")}
</div>
<div class="addrow">
  <input id="cn" placeholder="Producto (ej. GetQuickComp)" style="flex:2;min-width:180px">
  <input id="cc" placeholder="Clientes" type="number" style="width:90px">
  <input id="cm" placeholder="$/mes" type="number" style="width:100px">
  <button onclick="cardAdd()">＋ Agregar producto</button>
</div>

<h2>Mastermind</h2>
<div class="lanes">
  <div class="lane"><h3>💡 Mejoras a lo que ya existe</h3>
    ${ideas.filter((i) => i.lane === "mejora").map(ideaRow).join("") || '<p style="color:#5A6478;font-size:13px">Nada todavía — agrega tu primera idea.</p>'}
    <div class="addrow"><input id="im" placeholder="Nueva mejora…" style="flex:1"><button onclick="ideaAdd('mejora')">＋</button></div>
  </div>
  <div class="lane"><h3>🚀 Productos futuros</h3>
    ${ideas.filter((i) => i.lane === "futuro").map(ideaRow).join("") || '<p style="color:#5A6478;font-size:13px">Nada todavía — ¿cuál es el siguiente negocio?</p>'}
    <div class="addrow"><input id="if" placeholder="Nuevo producto/nicho…" style="flex:1"><button onclick="ideaAdd('futuro')">＋</button></div>
  </div>
</div>

<h2>🧠 Piénsalo conmigo</h2>
<div class="brain">
  <textarea id="bq" placeholder="Ej.: ¿Lanzo el vertical de concreto o empujo más anuncios a cercas? / ¿Qué le falta a la app para subir el precio?"></textarea>
  <div style="margin-top:10px"><button id="bgo" onclick="brain()">Pensar con mis números →</button></div>
  <div id="bout"></div>
</div>
</div>
<script>
function post(body){return fetch('/api/hq/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(function(r){return r.json()}).then(function(j){if(j.ok)location.reload();else alert(j.error||'Error')})}
function cardAdd(){var n=document.getElementById('cn').value.trim();if(!n)return;post({kind:'card',action:'add',item:{name:n,clients:document.getElementById('cc').value,mrr:document.getElementById('cm').value}})}
function cardEdit(id,c,m){var nc=prompt('Clientes:',c);if(nc===null)return;var nm=prompt('$/mes:',m);if(nm===null)return;post({kind:'card',action:'update',item:{id:id,clients:nc,mrr:nm}})}
function cardDel(id){post({kind:'card',action:'del',item:{id:id}})}
function ideaAdd(lane){var el=document.getElementById(lane==='mejora'?'im':'if');var t=el.value.trim();if(!t)return;post({kind:'idea',action:'add',item:{lane:lane,title:t}})}
function ideaUpd(id,patch){post({kind:'idea',action:'update',item:Object.assign({id:id},patch)})}
function ideaNote(id,el){var t=prompt('Notas de la idea:',el.textContent.replace(/^📝 /,'').replace('agregar notas…','').trim());if(t===null)return;ideaUpd(id,{note:t})}
function ideaDel(id){post({kind:'idea',action:'del',item:{id:id}})}
function brain(){var q=document.getElementById('bq').value.trim();if(!q)return;var b=document.getElementById('bgo');b.disabled=true;b.textContent='Pensando…';
  fetch('/api/hq/brain',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({q:q})}).then(function(r){return r.json()}).then(function(j){
    b.disabled=false;b.textContent='Pensar con mis números →';var o=document.getElementById('bout');o.style.display='block';o.textContent=j.text||j.error||'Error';
  }).catch(function(){b.disabled=false;b.textContent='Pensar con mis números →';alert('Error de red')})}
</script></body></html>`);
});

graceSweep();
setInterval(graceSweep, 6 * 3600 * 1000);

// Accounts the landing page depends on: the live demo widget and the inbox
// where the landing's own leads land. Created once, then left alone.
async function ensureAccount(slug, name, profile) {
  let c = await db.getContractorBySlug(slug);
  if (!c) {
    c = await db.createContractor({ name, slug });
    await db.saveContractorData(c.id, { profile });
    console.log(`created built-in account: ${slug}`);
  }
  return c;
}
{
  // ensureAccount only sets the name/profile on first creation, so a bare
  // literal change here would never reach an already-existing install.
  // Force this ONE shared demo account's business name to the generic
  // "Tu Negocio" placeholder every boot, so every preview surface that
  // embeds it (onboarding picker, sales deck, /opina review widget) stays
  // consistent — a real client's own data is never touched this way.
  const altoDemo = await ensureAccount("alto-demo", "Tu Negocio (Demo)", { biz: "Tu Negocio", lang: "es", trade: "roofing" });
  if (altoDemo.data?.profile?.biz !== "Tu Negocio") {
    await db.patchContractorData(altoDemo.id, { profile: { ...(altoDemo.data?.profile || {}), biz: "Tu Negocio" } });
  }
}
await ensureAccount("alto-ventas", "ALTO Pro Ventas", { biz: "ALTO Pro", lang: "es", trade: "roofing" });
if (FENCE_ENABLED) {
  // Fence twin of alto-demo: powers /w/alto-cercas + /ejemplo-cercas for the
  // sales demo. data.trade drives the widget/site/bot into fence mode.
  const altoCercas = await ensureAccount("alto-cercas", "Tu Negocio (Demo Cercas)", { biz: "Tu Negocio", lang: "es", trade: "fence" });
  if (altoCercas.data?.trade !== "fence") {
    await db.patchContractorData(altoCercas.id, { trade: "fence", profile: { ...(altoCercas.data?.profile || {}), biz: "Tu Negocio", trade: "fence" } });
  }
}

app.listen(PORT, () => {
  console.log(`ALTO Pro server on http://localhost:${PORT}`);
  console.log(`  google: ${GOOGLE_KEY ? "LIVE" : "demo"} · parcels: ${REGRID_KEY ? "LIVE" : "demo"} · property: ${RENTCAST_KEY ? "LIVE" : "demo"} · ai: ${aiLive ? `LIVE (${anthropic ? "anthropic" : "openai"})` : "demo"}`);
});
