# ALTO Pro — Website Generator (/pagina) — Developer Handoff

This archive is a snapshot of the ALTO Pro repository (`tradetechpro/`) taken
from branch `claude/inspiring-lamport-qeh1wi`. The website generator is NOT a
separate package: it lives inside the Express monolith (`server/index.mjs`)
and the template engine (`server/templates.mjs`). This document is the map.

Read `CLAUDE.md` (repo root) first — it is the living project brief, and the
"/pagina — the $49 website-factory funnel" bullet describes the current state
in detail. The env catalog is `tradetechpro/playbook/05-env.md`.

## 1. What the generator does (60 seconds)

1. Anonymous visitor opens `/pagina` (optionally `/pagina?t=cercas|techos`).
2. Fills a 5-field form (trade, business, name, phone, city, years). The lead
   is saved FIRST to the `alto-ventas` account (src `pagina-funnel`).
3. `POST /api/pagina/draft` creates a DRAFT in the KV store (`pgdraft:<id>`).
4. A "construction" interstitial (~4.6 s) plays while the draft is created.
5. `GET /pagina/preview?d=<id>` renders the visitor's real website through the
   SAME `renderSite()` every paying client uses, with a ribbon, a fixed claim
   bar ("ESTRENARLA $49") and an injected customize panel.
6. A Tesla-style wizard (6 steps: estilo · color · negocio · logo · fotos ·
   texto) PATCHes the draft via `POST /api/pagina/draft/:id` and reloads —
   the server re-renders, so the preview IS what they buy.
7. Buy = Stripe Payment Link with `client_reference_id=pagina-<id>`.
8. The Stripe webhook (`/api/stripe/webhook`, $49 → plan `pagina`) loads the
   draft, builds an account with the site PUBLISHED (`paginaSiteFromDraft`),
   and `/bienvenida?session_id=…` hands the buyer the live site + editor link.
9. Plan `pagina` is site-only: `clientLocked()` returns `"siteonly"`, so the
   measuring APIs refuse — the $67 app is the upsell.

Every generated site embeds a live quote widget iframe (`/w/<slug>`). Previews
embed the shared demo widget accounts (`alto-cercas` / `alto-demo`).

## 2. Where the code is

### `server/index.mjs` (line numbers at snapshot time)

| Line | Anchor | What |
|---|---|---|
| 70 | `const PAGINA_ENABLED` | feature flag (`PAGINA_ENABLED=1`); off → `/pagina` 302 → `/app` |
| 219 | `async function aiChat(` | Claude/OpenAI wrapper used by the copywriter |
| 330 | `const PLANS` | `PLANS.pagina = { price: 19 }` (hosting number MRR counts) |
| 379 | `const PLAN_BY_AMOUNT` | `4900: "pagina"` — Stripe amount → plan |
| 396 | `app.post("/api/stripe/webhook"` | signed webhook; `client_reference_id` prefix parse (~L464); auto-provision branch builds the account from the draft |
| 3836 | `function overQuota(` | in-memory per-IP daily limiter (resets on restart; single instance) |
| 7000 | `app.get("/api/checkout-result"` | polled by `/bienvenida`; returns `siteUrl` + `accessUrl` |
| 7009 | `app.get("/bienvenida"` | welcome page; pagina layout when `siteUrl` present |
| 7229 | `/* ── /pagina — …` | the generator block starts here |
| 7240 | `PG_COLORS` / `PG_TPL_IDS` / `PG_SVC` | whitelists: 6 colors, templates "1".."6", service chips per trade |
| 7255 | `function paginaSiteFromDraft(` | draft → account `{trade, profile, site}` (what the webhook publishes) |
| 7281 | `GET /api/pagina/photo/:id/:i` | serves draft photos as images (panel thumbnails) |
| 7290 | `POST /api/pagina/draft` | anonymous draft creation |
| 7309 | `POST /api/pagina/draft/:id` | the PATCH — ALL user-editable fields validate here (template/color whitelists, logo/photo data-URL mime+size caps, text length caps, `photosAdd`/`photoDel` ops, https-only socials) |
| 7371 | `POST /api/pagina/copy/:id` | AI copywriter (tagline + about from the visitor's facts; canned fallback without AI key; 6/draft + per-IP caps) |
| 7402 | `POST /api/pagina/voice/:id` | voice note → Whisper → AI-shaped copy (OPENAI_KEY-gated; 4/draft + per-IP caps; 1.6 MB audio cap) |
| 7447 | `function paginaPage(` | the form page + construction interstitial (`#pgbuild`) |
| 7611 | `GET /pagina` | serves the form |
| 7620–7935 | `GET /pagina/preview` | draft render + video-hero post-process + injected toolbar/wizard JS + claim bar (`?tpl=N` override, `&bare=1` strips chrome for thumbnails) |
| 7987 | `GET /site/:slug` | the published client site (what the buyer gets) |

### `server/templates.mjs`

| Line | Anchor | What |
|---|---|---|
| 50 | `TRADE_WORDS` | every trade-specific phrase, swapped by `d.trade` |
| 97 | `SVC_LOOKUP` | service chip strings → service cards |
| 278 | `widgetSpotBits(d)` | preview-only glow + badge around the quote widget (`d.widgetSpot`) |
| ~1000 | `renderSite` internals | the sanitization gauntlet: `esc()` on text sinks, shape checks on URL/src sinks |
| 1292 | `const TEMPLATES` | 1 Clásica · 2 Moderna · 3 Bold · 4 Elegante · 5 Vivo · 6 Sencilla |
| 1294 | `export function renderSite(data, opts)` | the entry point |

Other files the server imports: `server/db.mjs` (Postgres via `DATABASE_URL`,
JSON-file fallback at `server/data/store.json`), `server/parcel.mjs`,
`server/png.mjs`, `server/takeoff.mjs`, `src/fenceMath.js`.

## 3. Running it locally

```
cd tradetechpro
npm install            # npm ci currently fails (lock drift) — use install
npm run build          # vite → dist/ (the server serves dist/)
npm run seed:test      # seeds test-roofer / test-fencer, clears demo quotas
ADMIN_KEY=testadmin CS_KEY=testcs CLOSER_KEY=testcloser DEMO_PASS=testpass \
HQ_KEY=testhq FENCE_ENABLED=1 PAGINA_ENABLED=1 PORT=5959 node server/index.mjs &
open http://localhost:5959/pagina?t=cercas
npm run regression     # roofing golden-flow suite — must be ALL GREEN
```

No AI key → the copywriter serves 3 curated variants per trade. No
`STRIPE_LINK_PAGINA` → the buy button falls back to WhatsApp. To exercise the
payment path locally, set `STRIPE_WEBHOOK_SECRET` and POST a signed
`checkout.session.completed` event (`amount_total: 4900`,
`client_reference_id: "pagina-<draftid>"`) to `/api/stripe/webhook`.

## 4. Invariants — do not break

1. **Templates 1–3 serve EXISTING paying clients.** Their output must stay
   byte-identical. Every new behavior is behind `d.widgetSpot` or new template
   ids (4–6). Verify by rendering a fixed data object before/after.
2. **All new features go behind flags** (`PAGINA_ENABLED`, `FENCE_ENABLED`).
   Roofing output for existing accounts never changes.
3. **Every anonymous draft field is attacker-controlled** and ends up in public
   HTML. Validation at PATCH time + escaping at render time + `esc2()` for
   panel input attributes. Keep all three layers.
4. **No fake content.** A real business preview renders `reviews: []`. No
   fake testimonials, no AI images posing as the client's work.
5. **Spanish-first copy, warm contractor tone.**
6. **Run `npm run regression` before every commit.**

## 5. Known gaps / pending work (in priority order)

1. **Hosting:** $19/mo subscription from month 2 (disclosed at point of sale)
   + pause page on non-payment. Not built — currently the $49 is a one-time
   Payment Link only.
2. **📋 DETALLES section** in the customizer: hours / 24-7, Google reviews
   link, second phone, payment methods, licensed/insured badges, email.
3. **🪄 AI edit box** (free-text "cambia esto…") + a custom `hero` field.
4. **In-app site editor** for buyers with the 6-template picker (today the
   buyer edits through the app's existing site editor, which predates t4–t6).
5. **SMS delivery** of the access link + phone-number recovery (no passwords
   by design — magic link only).
6. **Draft TTL/cleanup job.** Drafts (up to ~1.5 MB with photos) accumulate
   in KV with no expiry.
7. **`overQuota` is in-memory** — resets on deploy, not shared across
   instances. Fine at one instance; move to KV before scaling out.
8. **English `/pagina` variant.**
9. Thumbnail cost: the style picker lazy-loads 6 `bare=1` renders, each
   loading the widget iframe. Consider suppressing the widget in bare mode.

## 6. Review priorities if you are auditing rather than extending

1. Anonymous input → rendered HTML (XSS through any draft field, attribute
   breakout in panel inputs, `javascript:` URLs via logo/photos/socials,
   oversized payloads, prototype-pollution keys in the PATCH body).
2. Cost-burn surfaces: AI/voice caps, the demo widget's Regrid gate (2 scans
   lifetime per IP, anonymous never spends a fresh credit).
3. Stripe path: prefix regex on `client_reference_id` can't mis-attribute;
   replayed/forged reference ids do nothing (signature check upstream).
4. Draft store hygiene (no TTL, non-atomic read-modify-write, 6-byte hex ids).

## 7. Secrets

None are in this archive. Every key lives in the environment (see
`server/.env.example` and `playbook/05-env.md`). Never commit values.
