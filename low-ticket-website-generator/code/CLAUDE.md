# ALTO Pro — engine + business OS

Spanish-first SaaS sold to Hispanic contractors. One Express server serves the
client PWA, all staff portals, the sales landing, and every client website.
The codebase is a reusable **engine**: what changes per service/vertical is a
copy pack + config, not code (proven by the fence vertical). The human side of
the machine (team roles, scripts, GHL recipes, launch steps) lives in
`tradetechpro/playbook/` — read it before re-deriving any process.

## Map

- `tradetechpro/server/index.mjs` — the monolith: APIs, portals (/admin, /cs,
  /closer, /onboarding, /hq — owner-only cockpit gated by HQ_KEY exclusively),
  sales landing (/ventas), sales deck (/demo), client widgets (/w/:slug),
  example sites (/ejemplo, /ejemplo-cercas), Stripe + Cloudflare + Render +
  GHL integrations.
- `tradetechpro/server/templates.mjs` — the website factory: 6 client-site
  templates rendered from data (1 Clásica · 2 Moderna/Fuerte · 3 Bold/Limpio ·
  4 Elegante dark-serif · 5 Vivo photo-first · 6 Sencilla minimal; t4/t6
  reuse extras1, t5 reuses extras3). `TRADE_WORDS` swaps every
  service-specific phrase by `d.trade`; t1–t3 output for existing sites must
  stay byte-identical (t4–t6 were additive).
- `tradetechpro/server/db.mjs` — Postgres (Supabase) with JSON-file fallback
  (`server/data/store.json`, mem + debounced persist).
- `tradetechpro/src/TradeTechPro.jsx` — the client PWA (React, vite →
  `dist/`). Trade-aware: `p.trade` from the account flips roofing/fence mode.
- `tradetechpro/public/` — static assets (vite copies to dist on build).
- `tradetechpro/scripts/regression.mjs` — roofing golden-flow suite. Run it
  after EVERY change, before every commit.
- `tradetechpro/playbook/` — the business playbook (launch, team, GHL, sales,
  env catalog, backups).

## Non-negotiable conventions

1. **Push BOTH branches after every commit**: `claude/inspiring-lamport-qeh1wi`
   and `HEAD:claude/gifted-rubin-srvpvn`. Render deploys from gifted-rubin.
   Never open a PR unless explicitly asked.
2. **Test live before committing.** From `tradetechpro/`: `npm run build` →
   `npm run seed:test` (writes a published test-roofer + clears demo/widget
   quota counters) → boot the server with the test keys
   (`ADMIN_KEY=testadmin CS_KEY=testcs CLOSER_KEY=testcloser DEMO_PASS=testpass HQ_KEY=testhq FENCE_ENABLED=1 PORT=5959 node server/index.mjs &`)
   → drive the affected flow with Playwright → `npm run regression`
   (must be ALL GREEN). Playwright is a devDependency; `setsid` isn't
   required (plain `&` works on macOS and Linux).
3. **Small additive commits.** New verticals/features go behind flags
   (`FENCE_ENABLED` pattern); existing roofing output must not change.
4. **App changes need `npm run build`** (dist is what the server serves) —
   dist/ itself is gitignored; Render builds on deploy.
5. Spanish-first copy, warm contractor tone. No fake reviews, no AI images
   posing as the client's own work.

## Domain knowledge that keeps getting re-learned

- **Built-in accounts** (protected from deletion, hidden from client lists):
  `alto-demo` (roofing demo widget/site), `alto-ventas` (sales landing's own
  lead inbox — its GHL webhook forwards every landing lead to setters),
  `alto-cercas` (fence demo, created at boot when FENCE_ENABLED=1).
- **Trades**: `data.trade` + `data.profile.trade` ∈ {roofing, fence}. Drives
  app mode, widget variant, site copy pack, bot persona, onboarding chips.
- **Fence parcels (FENCE ACCURATE)**: matching lives in `server/parcel.mjs`
  (states found/ambiguous/not_found/provider_error/rate_limited, containment-
  first, ≤3 candidates, raw 7-dp ring for MEASUREMENT + ≤40-pt disp ring for
  RENDER). `makeParcelResolver` adds a 90-day kv cache (`parcel2:*`), in-flight
  dedupe and pl_* metrics (visible in /admin → Embudo). Entitlements are
  server-side in `/api/lookup`: paid + DEMO_PASS get live lookups; anonymous
  demo gets `state:"demo"` + curated examples (`parcel_example:1..3`, seeded
  via `/api/admin/parcel-example`) and NEVER spends Regrid. The legacy
  `parcel` response field must stay until installed PWAs refresh. Fence
  construction math is `src/fenceMath.js` ONLY (net = gross − gates, per-run
  panels, real-corner detection) — unit tests in `scripts/fence-math-test.mjs`
  + `scripts/parcel-test.mjs`, both wired into the regression suite.
- **Import survey (metes & bounds → exact lot)**: the homeowner's plat is a
  THIRD geometry source next to Regrid-scan and manual-draw. "📄 Importar
  levantamiento" (fence draw toolbar + FenceConfirm) uploads a photo/PDF →
  `POST /api/survey-extract` (Claude vision, same auth gate as `/api/ai`; no AI
  key → canned demo rectangle, exactly like `/api/ai`) reads the boundary calls
  (quadrant bearing + distance). `src/surveyTraverse.js` (pure, node-tested in
  `scripts/survey-test.mjs`, wired into regression) walks the calls into a lot
  polygon in feet; the app converts feet→lat/lng (bearings are true-north and
  the aerial is north-up, so NO rotation — just anchor at the map center) and
  feeds the ring into `openFence` AS A PARCEL, so the contractor lands in the
  normal tap-the-sides flow on an EXACT lot (feet from the survey, not a trace).
  Vision only READS; the deterministic traverse recomputes here, so a misread
  lands in the editable draw screen (+🧭 Ajustar lote to align to the photo),
  never a silent bad quote. Closure error > 3% → toast warns the lot didn't
  close. v1 skips curves (arc/radius/delta) — flagged in the returned `note`;
  app-only (not on the public `/w/:slug` widget yet).
- **Fence estimate document**: fence estimates share as `/f?d=` (same
  everything-in-the-link pattern as `/i` and `/r`): satellite diagram (red
  lot / orange fence / green gates, numbered sides), per-side table, posts
  breakdown, itemized price + signature. The server imports `src/fenceMath.js`
  and RECOMPUTES the quote from the geometry in the link — doc and app can't
  diverge. `buildShareUrl` routes `kind==="est"` with `meas.prod` to /f;
  invoices stay on /i. 🧭 button on the fence map = "Ajustar lote": one drag
  translates parcel (raw+disp) + runs + gates together (imagery offset fix),
  auto-locks after the gesture, undoable.
- **Demo caps**: anonymous app measuring 6/day per IP + monthly backstop
  (`demolk:<ip>:<YYYY-MM>` kv counter > 10 blocks); CLIENT widget lifetime cap
  `wq:<slug>:<ip>` > 5. The SHARED demo widgets (alto-demo/alto-cercas) are a
  sales tool: **2 quotes/scans lifetime per IP**, then the server returns
  `demo_done` and the widget flips to a takeover (WhatsApp → SALES_WA +
  planes link, plus a "📅 Agendar una llamada" button to `GHL_BOOKING_URL`
  when that env var is set) instead of a dead end; ?pass=<DEMO_PASS> bypasses
  (the /closer toolbar demo links carry it). Widget test suites use
  `test-fencer` / `test-roofer` (seeded), never the demo accounts. These
  counters persist in store.json `metrics.all` — local test runs burn them;
  clear those keys (server stopped) when the regression suite mysteriously
  fails tests 1–2.
- **HD prices for the anonymous demo (cache-only)**: `/api/fence/materials`
  serves anonymous visitors (no session, no pass) FROM CACHE ONLY — a warm
  `hdmat3:<zip>` (some paid account fetched it in the last 24 h) returns the
  real Home Depot prices (metric `mat_demo`), a cold zip returns the same 403
  the app turns into its local-prices fallback. A fresh SerpApi credit is
  ONLY ever spent by paid accounts + DEMO_PASS. The fence draw screen shows
  the 💲 button to everyone now (the `session || DEMO_KEY` gate is gone —
  the server decides). This is why the /app-cercas funnel demo can flash
  real prices during the 3 free tries without any API risk.
- **`/app` funnel (one page, one offer)**: ads proved prospects want the APP
  and the 3-tier menu confuses them, so `/app` (+`/aplicacion`) sells ONLY
  the $67 app: drive-time-savings pain point, form-gated LIVE PWA demo
  (lead → `alto-ventas`, `info.src:"app-funnel"`), hard block after **3
  measures** with ONE button only — "Empezar mis 7 días gratis" → the
  Stripe PRO link (no WhatsApp escape hatch; the lead is already captured,
  setters follow up), single $67
  price card ("tu app se abre AL INSTANTE" — access delivery is
  AUTOMATED: webhook auto-provision + /bienvenida), desktop+phone
  mention. The 3-try block lives in the PAGE, not the app: the PWA iframe
  (`/?demo=roof&clean=1`) is same-origin, so the parent polls the app's own
  `alto_demo_meas` localStorage counter and overlays the buy screen at ≥3
  (app's 6/day cap = backstop; zero app-code changes). **Funnel analytics
  (/admin → 📊 Embudos de pago)**: every funnel fires the SAME stage
  skeleton `fn:<funnel>:<step>` (funnel ∈ app|app-cercas|vsl-app|
  vsl-completo; step visit/lead/try/block/buy + webhook-reported
  sale/paid/cancel + welcome + VSL play/watch25/50/75) so funnels are
  comparable columns; per-creative attribution `cr:<funnel>:<visit|lead|
  buy>:<slug>` where slug = sanitized utm_content||utm_campaign
  (first-touch, persisted in localStorage `alto_utm`; leads carry flat
  utm_source/utm_campaign/utm_content + funnel in info). Ad links MUST
  carry `?utm_source=fb&utm_campaign=X&utm_content=creative-name`.
  Auto-provisioned accounts store `data.funnel` (from Stripe
  client_reference_id) — sale/paid/cancel bumps attribute to it.
  fbq: Lead on form, InitiateCheckout on Stripe clicks. Upsells happen
  AFTER purchase, never on this page. **Community bonus (both /app +
  /app-cercas)**: a dedicated 🎁 navy section above the price card (growth-
  first: "MÁS QUE UNA APP: UNA COMUNIDAD QUE TE HACE CRECER") + a 👥 bullet
  in the feature list — sells a private WhatsApp Community (ALTO drops
  marketing/sales tips + videos; contractors mastermind together).
  **Founding-member framing** ("sé de los primeros contratistas", NOT "de
  todo el país que ya lo están logrando") — honest at N=1 while the group is
  small; upgrade to the nationwide line once it's genuinely national. Copy is
  trade-agnostic and lives in the roof base L (fence inherits it). DELIVERY: `/bienvenida` shows a "👥 Entrar a la
  comunidad" button the moment the account is live IFF `COMMUNITY_INVITE_URL`
  is set (empty → human welcome delivers it; nothing breaks). Seed the
  group before scaling ads — an empty group kills the promise. `fn:community:join`
  tracks welcome-page joins. **VSL pages (built, videos
  pending)**: `/video` (+/vsl, funnel vsl-app: VSL → $67 trial direct)
  and `/completo` (+/vsl-completo, funnel vsl-completo: VSL → $297
  included-list → embedded GHL_BOOKING_URL calendar + discreet direct-pay
  link). The video slot auto-detects `public/landing/vsl-app.mp4` /
  `vsl-completo.mp4` (+ optional `-poster.jpg`) per request — branded
  "Video muy pronto" placeholder until the file exists, real player with
  play/watch25/50/75 events once it does (no code change). `/video` is a
  pure direct-response page now: NO team grid (it stays on `/completo`,
  where humans are the product), a 3-chip strip under the video (satélite ·
  precios HD · WhatsApp) for non-watchers, a sticky bottom CTA bar (appears
  via IntersectionObserver when neither the video nor the price card is on
  screen — never covers the real button), fbq ViewContent on play, and a
  file-gated testimonial carousel below the price card:
  `public/landing/testimonios/*.mp4` (+ optional `<name>-poster.jpg`),
  9:16 cards on an auto-rotating 3D ring (rolodex: `#ttrack`
  preserve-3d rotateY loop, cards padded to ≥6 slots at
  `rotateY(i·360/N) translateZ(R)`, branded `.tback` faces so
  away-facing cards read as card backs; holds on touch/hover or while a
  clip plays, resumes 1.5s after; single clip = static centered;
  prefers-reduced-motion respected). With ZERO clips it shows 3 spinning
  EXPLICIT placeholder cards ("AQUÍ VA EL VIDEO DE TU CLIENTE" — owner's
  call, no fake names/claims ever); real files replace them automatically. NOTE: files are SERVED from dist/ (vite copies public/ at
  build), so locally a dropped file needs a rebuild or a copy into
  dist/landing/testimonios — on Render the deploy build handles it. Both pages
  carry the optional "¿Prefieres que te llamemos?" lead form
  (src vsl-app|vsl-completo) + the same UTM/fn:/cr: skeleton. **Team
  section ("EL EQUIPO")**: plain grid after the hero — 15 members (photo,
  full name, real role) copied verbatim from the owner's construction-co
  team page, Rolando first (Director de Operaciones). NO founder story, NO
  hype copy — the owner does the selling in the VSL himself; the section
  only shows a real team exists. Avatars in `public/landing/team/*.jpg`
  (240px ~7KB each, lazy); module-scope `STB_TEAM` + `teamAvail()` filter by
  file existence, renders at ≥3 photos (delete a file → member disappears, no
  code change). The SAME team + real built houses also appear on the `/demo`
  deck's "Quiénes somos" slide (both roof + fence): `teamAvail()` grid when
  there's no single `team.jpg`, plus a `homesAvail()` row of up to 4 photos
  from `public/landing/homes/house-0N.jpg` (≥3 to show) — deck logo is the
  sidebar brand mark, already there. Remaining owner assets: the two videos +
  the WhatsApp Loom flow.
- **`/pagina` — the $49 website-factory funnel (PAGINA_ENABLED)**: the new
  acquisition motion. Price is **$49 FINAL** (owner locked it; spoken ads say
  "menos de cincuenta dólares"). Hosting $19/mes from month 2 is DISCLOSED at
  the point of sale (form fine print + preview claim bar). Ad links can
  pre-pick the trade: `/pagina?t=cercas` (fence ads) or `?t=techos`.
  Ad → self-serve form (trade techos/cercas, biz, name,
  phone, city, years) → lead saved to alto-ventas FIRST (src `pagina-funnel`)
  → form POSTs `/api/pagina/draft` (kv `pgdraft:<id>`, legacy query-string
  preview = fallback) → `GET /pagina/preview?d=<id>` renders THEIR site
  through the SAME `renderSite()` as every client site (no fake reviews —
  reviews:[] on a real business preview) with a ribbon + fixed claim bar
  ("Tu página está LISTA — ESTRENARLA $49"). **Customize toolbar** (draft
  previews only; wow first, choices after): Tesla-configurator WIZARD on
  first visit (localStorage `pgseen_<id>`): 5 steps — Tu estilo · Tu color
  · Tu negocio (años + área SEO) · Tu logo · Tu texto — one section per
  screen with Saltar/Siguiente + progress dots; each choice PATCHes and
  reloads (the page visibly changes behind the card), `pgwiz` in
  sessionStorage resumes the next step after reload, finish → "✅ ¡Quedó!"
  toast. 🎨 in the claim bar opens the FULL panel (all sections) for
  re-edits —
  "ELIGE TU ESTILO" shows 6 live THUMBNAILS of their own site (lazy
  scaled iframes → `?d=<id>&tpl=N&bare=1`; bare strips ribbon/bar/toolbar/
  chat; `PG_TPL_IDS`/`PG_TPL_NAMES`), 6 `PG_COLORS` swatches + Auto, logo
  upload (client-side canvas → ≤300KB data URL), **content editing** (all
  server-validated on `/api/pagina/draft/:id`): TU NEGOCIO fixes
  biz/phone/city + años + área + licencia + `PG_SVC` service CHIPS per trade
  (strings → SVC_LOOKUP cards; empty → trade defaults), FOTOS DE TUS
  TRABAJOS (≤6, client-resized ≤320KB each / 1.5MB total, `photosAdd`/
  `photoDel` partial ops, thumbs served by `GET /api/pagina/photo/:id/:i`
  so the panel stays light), TU TEXTO direct tagline/about fields
  (Guardar) beside the AI/voice buttons, TUS REDES facebook/instagram
  (https-validated; full panel only, not a wizard step — wizard is 6 steps:
  estilo·color·negocio·logo·fotos·texto), "✨ Escribir mi texto con IA" → `POST
  /api/pagina/copy/:id` (aiChat writes tagline+about from ONLY the
  visitor's facts; no AI key → 3 curated variants per trade rotate; 6
  regens/draft + per-IP caps), and 🎤 voice note (button only when
  OPENAI_KEY): MediaRecorder ≤20s → `POST /api/pagina/voice/:id` →
  Whisper → aiChat shapes about+tagline from HIS words (worst case: raw
  transcript; 4/draft + per-IP caps). Every choice PATCHes
  `/api/pagina/draft/:id` (validated: template/color whitelists, logo
  mime+size) and reloads — the server re-renders, so the preview IS
  what they buy. **Construction interstitial** on the form: 4 animated
  steps (~4.6s, city + trade-aware) while the draft is created — perceived
  effort before the reveal. **Video hero (file-gated)**: drop REAL
  ambient b-roll (no faces, no crew branding) at
  `public/landing/broll-fence.mp4` / `broll-roof.mp4` and every Clásica
  preview swaps its hero image for the muted loop (post-processed
  `<video class="hbg">`, poster = hero img; templates.mjs untouched). Buy = `STRIPE_LINK_PAGINA`
  (+client_reference_id=pagina-<draftid>; webhook matches funnel by prefix
  and stores `paginaDraft` on the account for Phase-2 provisioning);
  unset → wa.me fallback. Funnel id `pagina` is in FUNNEL_IDS + the Embudos
  board (🌐 Página $49). Flag off → 302 /app; the app funnels are untouched
  (additive, FENCE_ENABLED pattern — NOT a code duplicate). v1 is techos +
  cercas only (richest templates, app-upsell fit). **Phase 2 — BUILT
  (zero-touch fulfillment)**: `PLAN_BY_AMOUNT[4900] = "pagina"` (PLANS.pagina
  price 19 = the hosting number MRR should count; the $49 lands in the
  ledger). The webhook's auto-provision branch loads the draft from
  `client_reference_id=pagina-<id>` → `paginaSiteFromDraft()` → account
  named after the business (slug → `/site/<slug>`), `trade` from the draft,
  `site` = the EXACT approved page (template/color/logo/photos/services/
  tagline/about/area/license/socials) with `published:true, source:"pagina"`,
  plan `"pagina"` payStatus `"ok"`; draft marked `purchased`. `stripe_sess`
  record carries `siteUrl` → `/api/checkout-result` returns it → `/bienvenida`
  flips to the pagina layout ("¡Tu página ya está EN LÍNEA" · 🌐 VER MI PÁGINA
  · ✏️ Editar mi página, hosting reminder; Purchase pixel value 49). The
  access link opens the app as the site EDITOR + leads inbox only:
  `clientLocked()` returns `"siteonly"` for plan pagina, so measuring
  (`/api/lookup` etc.) is refused server-side — the $67 app is the upsell.
  Stripe Payment Link's after-payment URL must be
  `/bienvenida?session_id={CHECKOUT_SESSION_ID}` (same as PRO). Suite:
  scratchpad `pagina-phase2-test.mjs` (HMAC-signed webhook, end to end).
  Still pending: $19/mes hosting subscription product + pause-on-nonpayment,
  $50/año domain bump, app-trial OTO with the $49 credit, SMS delivery.
- **`/ventas` + `/cercas` demo section**: the old "give name/business/phone,
  get a link that opens elsewhere" trial box is gone — sending a Facebook-ad
  visitor off-page made reconversion hard once they left. The SAME live
  widget iframe (`/w/alto-demo` / `/w/alto-cercas`) is now embedded next to
  the demo video as the single "try it" touchpoint. Its name/phone step
  grows an optional "Nombre de tu negocio" field for these two demo
  accounts only (real client widgets unaffected), and on submit the client
  JS mirrors the lead into `alto-ventas` (`info.src:"trial-app"`) via
  `/api/widget/lead` so every prospect who tries it lands in the SAME "Leads
  de venta" inbox the setters already work — not just the demo account's own
  (unwatched) lead list — even if they never WhatsApp from the takeover.
- **DEMO_PASS**: `?pass=<DEMO_PASS>` makes a device unlimited (stored in
  localStorage). The /demo deck injects it into the embedded app for
  authenticated staff so sales calls never hit the cap.
- **Desktop mode**: at ≥1024px (`isDesk` matchMedia state) the SAME app gets
  an office shell — `SideNav` left, slim left-aligned page titles (no logo/
  back on top-level tabs), toasts on top. Inicio = overview (greeting + date +
  5 clickable stat tiles). Trabajos/Clientes = dense rows with search (`listQ`)
  and sort chips (`sortJ` Recientes/Deben más/Mayor $ — non-date sorts render
  a FLAT list, no month folders; `sortC` A–Z/Deben más) + inline icon actions
  and debt badges. Two-panel grids (content left, 380–420px rail right):
  fenceDraw + roofing calc (1500), jobDetail (info/fotos left, estado/factura
  right) and send — which shows the REAL estimate document in a scaled iframe
  (`sendPrev` effect) beside the send buttons (1080). Hover styles live in
  index.html behind `@media (min-width:1024px)`. Below the breakpoint NOTHING
  changes — the phone PWA is the golden path and the regression suite runs at
  phone size.
- **Fence widget scan**: `/w/:slug` (trade fence) = address → REAL parcel scan
  (`/api/widget/fence-scan`: geocode + resolveParcel under the contractor's
  entitlement, lifetime `wq:<slug>:<ip>` ≤ 5, `?pass=<DEMO_PASS>` = unlimited
  + no lead) → red boundary draws itself → name+phone unlocks the tap-sides
  picker (lead saved FIRST) → `/api/widget/fence-estimate` recomputes the
  range server-side from the contractor's `fenceProducts` and enriches the
  lead (fenceFt/material/low/high; app lead card shows 🛰️ ft · material).
  No parcel (outside Regrid coverage) → same unlock card, then the homeowner
  measures themselves (lead carries `drawn:true`); same estimate endpoint.
  The measuring tool IS the app's Dibujar cerca screen ported to vanilla JS:
  drag-to-draw with offset crosshair (tap = one post, tap first post closes
  the loop), movable posts/lines, multiple runs, Agregar cerca / Agregar
  puerta / Dibujar toolbar + Deshacer / Borrar / Terminar línea (history
  undo), map zoom buttons, dark PIES LINEALES panel with PANELES/POSTES/
  PUERTAS tiles, live TOTAL ESTIMADO range. `src/fenceMath.js` is inlined
  verbatim into the page (`FENCE_MATH_JS`, exports stripped, IIFE `FM`) so
  widget numbers can never diverge from the app. Rendering mirrors the app
  (white-cased orange 9/5 runs, r16 posts, Barlow Condensed ft labels) and
  BOTH paths (parcel sides + draw, toggleable via ✏️ Dibujar) support 🚪
  gates (presets 4/10/12/16 ft; detach-not-delete when their line goes; lead
  carries `gates`). Over quota / scan error → classic material+size funnel —
  never a dead end. Metrics: fsc_req/found/miss/err.
- **Map pan/zoom (roof trace + fence draw)**: the app's two measuring maps
  (static satellite `/api/roofimg` + an SVG overlay in world coords) support
  **two-finger pan + pinch-zoom** (Google-Maps feel) via a shared
  `makeMapHandlers(single, base, setBase, W, H, cancel)` wrapper — refs
  `mapPtrs`/`mapGest`/`panLatch` + `mapXform` state. It's PURELY ADDITIVE:
  one pointer runs the existing single-finger draw/edit untouched; the 2nd
  finger switches to move-the-map. The whole wrapper (image + drawing) rides
  one live CSS transform (`mapXform` → translate+scale, transform-origin at
  the pinch midpoint) so geometry stays locked to the world, then the base
  recenters + snaps zoom to integer on release (Google Static Maps only
  fetches integer zoom). Desktop: scroll-wheel zoom. Containers carry
  `data-map="roof"|"fence"`. Both maps share `dragOff`/`mapXform`/`tracePtr`
  (only one renders at a time). **✋ Mover mode**: a toggle button above the
  +/− zoom buttons (both maps) — while ON, `mapPan` state makes the 1st
  finger start the move gesture (translate-only: `dist=g.dist0` ⇒ scale 1)
  so ONE finger pans exactly like Google Maps and taps never draw; a 2nd
  finger joining re-anchors `mid0/dist0` against `g.last` so the map never
  jumps mid-gesture. Resets to draw on screen change; hint bar swaps to
  `t.panHint` while active. Zoom floor is 16 (was 17). Suites: scratchpad
  `map-pan-test.mjs` (two-finger) + `map-pan2-test.mjs` (✋ mode: 1-finger
  pan, tap-doesn't-draw, pinch, toggle-restore) — both need the gmaps stub
  (`gmaps-stub.mjs` on :5978, boot server with `GOOGLE_MAPS_API_KEY=test
  GMAPS_BASE=http://localhost:5978`), otherwise the aerial errors into the
  retry card and center touches hit the card, not the map. NOT yet done on
  the public `/w/:slug` fence widget (its own engine).
- **Directions (Cómo llegar)**: `driveTo()` opens the in-app `DriveMap`
  overlay (module-scope component; same `loadGoogleMaps`/maps-config key as
  the trace map) — pin-first, then geolocation → `/api/directions` (server
  computes the route with the **Routes API** under GOOGLE_MAPS_API_KEY;
  Google retired the legacy Directions API for new projects, so the browser
  DirectionsService answers REQUEST_DENIED regardless of key restrictions)
  → manual Polyline + 🚗 time·distance chip; location blocked → pin + hint;
  route/API failure → gray hint bar WITH the error code; key fails →
  graceful message. `ROUTES_BASE` env overrides the Routes host (test stub).
  The installed PWA never loses its page; external Google Maps
  (turn-by-turn) only via the explicit "Abrir en Google Maps ↗" button.
- **Leads flow**: widget/quiz/trial → `/api/widget/lead` or `/api/widget/quote`
  → saved + push (`notifyLead`) + `forwardLead` → per-account GHL webhook
  (`data.webhook`, https only). Channel leads (WhatsApp/IG/Messenger) come IN
  from GHL via `/api/hl/lead` (HL_WEBHOOK_SECRET, phone dedupe 24h) and are
  NOT re-forwarded (no loop).
- **Stripe**: 3 payment links (env), webhook tags plan by exact amount paid
  ($67→pro, $197→widget, $297→complete), handles pay-before-account via
  `paid:<phone|email>` kv. **7-day trial** (PRO link must carry a free
  trial in Stripe — /app promises it): a $0 `no_payment_required`
  subscription checkout activates as `payStatus "trial"` (plan from
  checkout `metadata.plan`, default pro; excluded from MRR; no $0 ledger
  row; `paid:` marker carries `trial:true` for pay-before-account), day-8
  `invoice.paid` flips it to "ok" + ledger, mid-trial cancel arrives as
  `subscription.deleted` → paused. **Night-sale auto-provision**: a first
  CHECKOUT (trial or paid) with no matching account creates the contractor
  on the spot (name+phone from checkout, trade roofing, `autoProvisioned`
  stamp), parks the invite under kv `stripe_sess:<id>`, and drops the sale
  in alto-ventas (src "app-buy", access link in the GHL-forwarded payload
  + push). Stripe's after-payment redirect must point at
  `/bienvenida?session_id={CHECKOUT_SESSION_ID}` — that page polls
  `/api/checkout-result` and hands the buyer the access link + install
  steps instantly (WhatsApp fallback on timeout). `invoice.paid` with no
  match keeps the `paid:` marker path for closer-created accounts.
  Suites: scratchpad `trial-test.mjs` + `autoprov-test.mjs` (HMAC-signed).
- **Domain buy**: CF Registrar API (`/registrar/domain-check`, registrations
  with CF_REG_* contact, phone format `+1.9565551234`) → zone CNAME → Render
  custom domain + SSL. Purchased domains are one click end-to-end.
- **curl-ing portals**: `/admin?key=` redirects key→cookie; use
  `curl -s -L -c jar -b jar`.

## Current state / flags

- FENCE_ENABLED=1 in production (fence vertical live end to end).
- Planned next (decided, not built): "Contratistas" $179 Página con IA tier —
  trade `general` (app without measuring), Stripe $179 link + webhook amount,
  `/paginas` landing, third option in the deck's trade dropdown,
  `/ejemplo-contratista`. See playbook/01.
- Standing security debt: rotate ADMIN/CS/CLOSER keys + Supabase password
  (shared value exposed repeatedly). Nag the owner until done.
