# Draft House, engineering handoff

Status as of 2026-11-03 (go-live phases 1–7 landed after; see docs/DEPLOY.md and docs/LAUNCH-CHECK.md). Branch `claude/revit-workflow-optimization-vjh5id` in `bonalti1/IDEAS`. Everything below is in that branch. Read this top to bottom once, then use the section index to find things.

## 1. What the product is

A web service for a custom-home builder (South Texas Builders, Rio Grande Valley). A client or a drafter enters a lot, picks one of the builder's home styles, sets rooms and square footage, gets an 80 percent house drafted on the lot, changes it in plain language within a credit limit, and approves. The office then builds the real Revit model automatically on a central computer, and drafters finish structure, details, and code. The product name is provisional; the brand (compass mark, Montserrat, the brown and off-white) is fixed.

What is true today:

- The client flow works end to end with one real style kit, Modern Farmhouse, traced from the builder's own Garza residence set (plan FD-25083 rev 08).
- The draft is a real floor plan: walls with kit thicknesses, open living area, door swings, windows by schedule mark, cabinets and fixtures, and a roof whose planes are clipped against each other with valleys.
- The draft exports to IFC4 that opens in Revit, validated with IfcOpenShell on every element.
- An office API, a Revit worker for the central computer, and an admin dashboard exist and were run together end to end with a stand-in worker. The Revit build script has never run on a real Revit.
- A reference test locks the Garza numbers to the builder's cover sheet within a few percent.

## 2. Architecture

```
┌──────────────┐   design.json + IFC   ┌──────────────┐   claim / progress   ┌──────────────────────┐
│  Client app  │ ────────────────────▶ │  Office API  │ ◀──────────────────▶ │  Office computer     │
│  React/Vite  │ ◀──────────────────── │  server/     │  heartbeat + checks  │  Windows, Revit,     │
│  src/draft   │   job status, files   │  queue+files │                      │  pyRevit, worker/    │
└──────────────┘                       └──────────────┘                      └──────────┬───────────┘
       │                                       ▲                                        │ model.rvt, sheets.pdf, model.ifc
       │ #/admin dashboard reads /api/admin/overview                                    ▼
       └───────────────────────────────────────┘                             shared folder → drafters
```

Three processes. The app is static (Vite build). The office API is one Node file with a JSON store on disk. The worker is one Python file that drives Revit through the pyRevit CLI. Nothing else is required. There is no auth yet, no database server, no cloud dependency.

## 3. Repository map

| Path | What it is |
|---|---|
| `src/main.jsx` | Entry. Hash routing: `#/admin` dashboard, `#/lot514` the original drafter site-plan viewer, anything else the client flow. |
| `src/draft/DraftApp.jsx` | Client flow controller. Six steps, all state in React memory. |
| `src/draft/screens/*.jsx` | Start, Lot, Style, Program (rooms), Draft (3D + edits), Send (summary, drafter package, IFC, office send), Admin (dashboard). |
| `src/draft/HouseScene.jsx` | three.js scene for the draft: lot, walls cut for openings, door leaves with arcs, windows, fixtures, roof. |
| `src/draft/lib/layout.js` | Layout engine. Plan-based generation from the kit, packer fallback, elements, plain-language change interpreter (mock). |
| `src/draft/lib/ifc.js` | Wall builder (`wallsFrom`) and the IFC4 writer. |
| `src/draft/lib/openings.js` | Finds the host wall for a door or window and splits wall segments into pieces, headers, sills. |
| `src/draft/lib/roof.js` | Roof masses to planar sheets to clipped visible faces with valleys, cheeks, notch walls, fascia. |
| `src/draft/lib/takeoff.js` | Building areas, siding, stone, tile, window and door schedules. |
| `src/draft/lib/contract.js` | Builds the design JSON sent to the office (contract v1). |
| `src/draft/lib/api.js` | Fetch client for the office API, fails soft. |
| `src/draft/lib/styles.js` | The ten style cards. Only farmhouse carries a kit. |
| `src/kits/modern-farmhouse.js` | The kit. Everything extracted from the Garza set plus the traced plan, openings, fixtures, roof masses, open-room pairs, Revit name mapping. |
| `src/kits/README.md` | What a drafter must confirm in the kit. |
| `src/brand/` | Tokens CSS and brand README. `public/brand/` has the logos and the vector mark. |
| `src/components/`, `src/data/`, `src/lib/geometry.js`, `src/App.jsx` | The original Lot 514 site-plan viewer: plat boundary with the Don St arc, setbacks, streets. The client flow reuses the lot. |
| `server/index.mjs` | Office API. |
| `worker/draft_house_worker.py` | Worker service for the Revit machine. |
| `worker/revit/build_model.py` | pyRevit script that builds the model from design.json. Untested on Revit. |
| `worker/revit/smoke.py` | Health check script: proves Revit launches and opens the template. |
| `worker/INSTALL.md` | Runbook for the office machine. |
| `docs/design-contract.md` | Field by field description of the design JSON. |
| `scripts/export-ifc.mjs`, `scripts/ifc-to-obj.py`, `scripts/shot-ifc.mjs`, `ifc-preview.html` | Export the Garza IFC without the browser, convert to OBJ, render it. |
| `scripts/export-boxes.mjs` | Dumps rooms, wall pieces, doors, windows, fixtures, and roof faces as JSON for the standalone 3D page. |
| `scripts/shot-flow.mjs`, `scripts/shot.mjs` | Playwright screenshot walks of the client flow and the site plan. |
| `scripts/fake-worker.mjs` | Pretend office computer for demos. |
| `test/garza.test.mjs` | Reference test against the Garza cover sheet. |
| `test/server.test.mjs` | Office API end to end. |
| `video-factory/` | Unrelated earlier project on the same branch. Ignore. |

## 4. Running it

```
npm install
npm run dev                      # app at http://localhost:5173
npm test                         # reference test + API test
npm run office                   # office API on :8787, data in server/data/
npm run office:demo-worker       # pretend Revit machine
node scripts/shot-flow.mjs out   # screenshots of every step, dev server running
```

Environment: `VITE_API_URL` for the office API address (default `http://localhost:8787`) and `VITE_API_KEY` (the app key, empty locally). The server takes `PORT`, `DATA_DIR`, `DATABASE_URL`, the Supabase and key settings listed in `docs/DEPLOY.md`, and the Claude key for the change interpreter from `DRAFTHOUSE_CLAUDE_KEY`, falling back to `ANTHROPIC_API_KEY` (some hosts blank the latter). Only the key's length is ever printed. At start the server checks that api.anthropic.com is reachable and says so in its log and in the health check, including when network access blocks it. `node scripts/try-interpret.mjs` runs ten live requests and grades them; see `docs/change-diff.md`.

Tooling in this repo's development environment: Node 22, Python 3.11 for scripts, Python 3.13 with `ifcopenshell` for IFC validation (`pip install ifcopenshell`), Playwright with Chromium for screenshots.

## 5. The client flow

| Step | Screen | What happens | State |
|---|---|---|---|
| 1 | Start | Name, address or survey upload. Survey parsing is not built; the lot is always Lot 514. | `lot = { address, file, client }` |
| 2 | Lot | Plat in 3D, setbacks, buildable area, city zoning (hard-coded Palmview). | |
| 3 | Style | Ten cards. Farmhouse is marked kit ready. | `style` |
| 4 | Rooms | Beds, baths, garage, stories, square footage slider, extras (office, second suite, half bath, porches), a "start from a recent build" preset that loads the Garza program. Lot-fit meter and a rough estimate. | `program` |
| 5 | Draft | `generateRooms(program, style)` produces rooms plus elements. 3D with Plan, 3D, Roof toggle. Plain-language edits via `applyRequest`, ten credits, history. | `rooms`, `credits`, `history` |
| 6 | Send | Summary tab and Drafter package tab (areas, takeoff, schedules, sheet list, IFC download). Send posts the contract and polls the job. | `job` |

Credits reset on reload. Nothing persists. There are no accounts.

## 6. The kit system

A kit is one JS object. `src/kits/modern-farmhouse.js` is the only one. Sections:

- **Construction rules** from the set: wall studs and thicknesses, plate heights by room, roof pitch and overhang and framing, foundation spec, exterior materials.
- **Standard openings**: door sizes by role (interior, interiorWide, closet, barn, pantry, utility, showerGlass, exteriorSingle, exteriorPair) and window marks A to D with size, type, head height.
- **Room templates** with real sizes and a zone (public, private, service, front, rear) for the packer fallback.
- **`plan`**: the traced Garza plan. 26 rooms with x, y, w, d in feet from the rear-left corner; 23 doors with wall axis, swing, hinge, pair, cased; 14 windows by mark with sill and head overrides; 34 fixtures; 14 roof masses; `open` pairs of rooms that share no wall.
- **`reference`**: the Garza program and the cover sheet numbers the test compares against.
- **`revit`**: template name, wall types, door and window families, fixture families, title block, view templates. These are placeholder names until a drafter supplies the real ones.
- **Electrical and code notes, sheet list, title block, general notes** for the drafter package.

To add a style: copy the file, trace the plan the same way (or, better, extract it from the drafter's Revit export, see section 14), register it in `styles.js` with `kit` and `ready: true`. Styles without a kit borrow the farmhouse room templates and use the packer.

Items a drafter must confirm are listed in `src/kits/README.md`.

## 7. Layout engine, `layout.js`

`generateRooms(program, style)`:

- If the kit has a `plan`, `fromPlan` starts from the traced rooms. It drops extras that are off, adds or removes secondary bedrooms and baths at the bottom of the bedroom wing, attaches a garage beside the laundry, scales everything about the plan centre to hit the requested square footage, then carries doors, windows, fixtures as **elements** and computes the roof. Elements live in the same array as rooms with `element: true`; `isRoom` and `isConditioned` filter them.
- Otherwise `roomsFor` builds a room list from templates and `place` packs them in zone rows.

`placeLocal` converts plan coordinates to the lot: local x along the front, z toward the street (positive z is south, the front street), then rotates by the lot angle about the setback envelope centre. Every room and element keeps `local: [x, z]`; everything downstream uses local feet.

Plain-language changes go through `src/draft/lib/interpret.js`: the office API asks Claude for a structured diff (`docs/change-diff.md`), `ops.js` checks and applies it, and `rules.js` accepts or rejects the result with a reason the client can read. When the office API or Claude is unavailable, `regexOps` in `ops.js` produces the diff from keywords instead.

`outline(rooms)` samples room edges to get exterior perimeter and footprint for the takeoff.

## 8. Walls and openings

`wallsFrom(rooms, kit)` in `ifc.js` walks every room edge in half-foot steps. Each sample probes across the edge: no neighbour is exterior, a neighbour is interior, a neighbour listed in `kit.plan.open` is no wall. Runs become segments; exact shared edges are emitted once. Thickness comes from the kit: exterior 4 inches, interior 4, plumbing 6 when either room is a plumbing room. Dormer faces are added as walls with a `base` height.

`openings.js`: `hostWall` finds the wall a door or window sits on (same axis, within 0.9 ft). `splitWalls` cuts the segment into full-height pieces, a header above every opening, and a sill below windows. The app scene, the viewer export, and the IFC all consume this.

Tracing gaps: the traced rooms leave small gaps where the real walls are, so probes use a 1.25 ft reach and nearly coincident walls on both sides of a gap both get the opening cut. This is why wall counts look high (116). Extracting from Revit removes the gaps.

## 9. Roof engine, `roof.js`

Input: `kit.plan.roof` masses. Kinds: `gable` (ridge `ew` or `ns`, plate and optional `plate2` for an asymmetric ridge, `ends` listing which ends are gables, optional `cuts` rectangles removed from the footprint), `shed` (high side, plate, pitch), `dormer` (face line, plate at the face, base, depth).

Pipeline:

1. `roofSheets` turns each mass into planar sheets: two per gable, one per shed or dormer. Each sheet has a plane `h = a x + b z + c`, a plan footprint (MultiPolygon), and its outer edge lines. Gable ends become vertical triangles. Non-gable ends run 20 ft into the neighbour so planes meet instead of stopping at the wall.
2. `roofSurfaces` keeps, for each sheet, only the region where no other mass's sheet is higher. The hidden region of each other sheet is its footprint clipped by the half-plane where it is higher (Sutherland–Hodgman), unioned and subtracted with `polygon-clipping`. The boundary is the valley or hip. Gable-end triangles are clipped the same way along their line.
3. Fascia strips along outer eave and rake edges, dormer cheeks sampled against the roof below, notch walls where a cut-back roof edge stands above a lower roof.

Output: faces with 3D rings (outer plus holes), kind `slope`, `end`, `fascia`, material. The app triangulates them with `THREE.ShapeUtils`; the viewer draws them with even-odd fill; the IFC writes each as a roof panel.

Known limits: no underside or soffit geometry, overhang depth is one constant, the test only checks that no visible vertex is buried. The main roof is modelled with a 9.5 ft rear eave and a 14 ft front plate with the office and pantry gables cut out in front; the exact meeting height of those small gables was not readable from the drawings and should be confirmed from the Revit model.

## 10. Takeoff and schedules, `takeoff.js`

Areas from rooms (plan-based plans count halls and closets, so no circulation factor; packed plans use 1.22). Siding is exterior perimeter times average plate plus six 16 ft gable ends at 10:12, minus windows, exterior doors, and stone; stone is front width times a 3.33 ft wainscot. Window and door schedules count from the traced elements when present (twins count as two units), otherwise from per-room defaults.

Reference, Garza program, app versus cover sheet: living 2,532 vs 2,533 sf; total 2,859 vs 2,870; board and batten within 4 percent; stone within 3; shower tile exact; windows 18 single hung and 3 fixed, exact; exterior doors 3, exact; interior doors 23 vs 22.

## 11. IFC export, `ifc.js`

IFC4, STEP text written by hand, no library, so it runs in the browser. Project, site, building rotated to the lot, one storey. Walls as IfcWall with openings as IfcOpeningElement voids filled by IfcDoor and IfcWindow carrying width, height, swing type. Slabs per room. Rooms as IfcSpace. Fixtures as IfcSanitaryTerminal, IfcElectricAppliance, IfcFurniture by category. Roof as one IfcRoof aggregating IfcSlab roof panels, each the clipped polygon with holes drawn in its own plane and extruded 6 inches. A property set on the building carries kit notes. Apostrophes are doubled (`esc`) because STEP strings break otherwise; the test checks for unbalanced quotes.

Validation: `node scripts/export-ifc.mjs out.ifc` then open with IfcOpenShell in Python 3.13 and build geometry for every product. Current count 318 products, zero failures.

Standalone 3D page: `scripts/export-boxes.mjs` dumps JSON; a dependency-free canvas page renders it (the published artifact at https://claude.ai/artifact/NyMzKsrmrxGxJJWiCNMyqw). That page is generated in the development session, not in the repo; the exporter and the app scene are the sources of truth.

## 12. Office pipeline

### API, `server/index.mjs`

| Method and path | Purpose |
|---|---|
| `POST /api/designs` | Body `{ design, ifc }`. Stores design.json and draft.ifc, creates a queued job. |
| `GET /api/designs`, `GET /api/designs/:id/design.json` | List, fetch. |
| `GET /api/jobs`, `GET /api/jobs/:id` | List, fetch with steps, outputs, warnings, log. |
| `POST /api/jobs/claim` | Worker takes the oldest queued job. 204 when none. |
| `POST /api/jobs/:id/progress` | `{ step, message, pct }`. |
| `PUT /api/jobs/:id/files/:name` | Raw body upload. Appears in outputs. |
| `POST /api/jobs/:id/complete`, `/fail`, `/retry` | Fail re-queues once, then stays failed. |
| `GET /files/:design/:name` | Download. |
| `POST /api/workers/heartbeat` | Upserts the worker, stores its checks, returns pending commands. |
| `GET /api/workers`, `POST /api/workers/:id/commands` | List; queue `smoke` or `restart-revit`. |
| `GET /api/health` | Aggregate checks: API, store, queue (stuck jobs over 20 min), worker online within 90 s, plus every worker check. |
| `GET /api/admin/overview` | Everything the dashboard shows. |

Store: `server/store/` behind one interface. Postgres (`postgres.mjs`, migrations in `server/migrations/`, run at start) when `DATABASE_URL` is set; otherwise the JSON file (`json.mjs`, `server/data/db.json`) for laptops and tests. Files: `server/files/` the same way, Supabase Storage (`supabase.mjs`, private bucket, REST, no SDK) when `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` are set, else `server/data/files/`. Downloads always go through the API (`/files/:design/:name`), so the bucket stays private.

Accounts (`server/users.mjs`): Supabase Auth magic link in the app (`src/draft/lib/auth.js`, `@supabase/supabase-js`), the access token goes to the API as a Bearer token and is verified there (HS256 with `SUPABASE_JWT_SECRET`, or the project's public keys). Without `SUPABASE_URL` the API hands out its own signed tokens for any email (`POST /api/auth/dev-login`), which is what the tests and screenshots use. Roles client, drafter, admin: `DRAFTHOUSE_DRAFTERS` and `DRAFTHOUSE_ADMINS` seed them, the users table keeps them. Routes declare `user` or `drafter`.

Projects (`server/projects.mjs`, migration `002_accounts.sql`): a project is lot, style, program, status, credits, and every version of the rooms (`versions` table, one row per version with the full rooms array). A change runs on the server: `POST /api/projects/:id/change` asks Claude (or the basic rules when it is unavailable), applies the diff with the same `decide()` the browser uses, checks the plan rules, and takes one credit only when the change applies (`projects.charge`, an atomic decrement). `POST .../rollback {version}` restores any version as a new version and refunds the credits spent after it. `POST .../send` stores the design and sets `in_review`; a drafter's `POST /api/review/:id {decision, note}` sets `approved` (and queues the Revit job) or `returned` (the client sees the note and keeps drafting). The worker's `complete` call sets `built`. Statuses in order: drafting, in_review, approved, built, plus returned. The client app (`DraftApp.jsx`) creates the project when the client enters the Draft step, resumes any house from the start screen, and shows the status timeline on the Send step; without an account (office unreachable or sign-in skipped) it drafts in the tab as before.

Auth (`server/auth.mjs`): two keys. `DRAFTHOUSE_APP_KEY` for the client app and dashboard, `DRAFTHOUSE_WORKER_KEY` for the office worker; each route states which it needs (`app`, `worker`, `any`, `public`). Keys travel in `x-api-key`, `Authorization: Bearer`, or `?key=` for file links opened in a tab. With no keys set the API is open and the health row says so. CORS is locked to `DRAFTHOUSE_APP_ORIGIN` when set. `/api/health` without a key returns only the verdict (for the hosting health probe).

Lots (`src/draft/lib/lot.js`, `cities.js`, `server/lots.mjs`): nothing about Lot 514 or Palmview is wired in any more; the recorded plat is `buildLot({ kind: 'reference' })`, the default for tests and the drafter view. A lot is built from a small spec, so the server rebuilds it from the spec instead of trusting browser geometry: `manual` (width, depth, city, front street, corner lot) or `plat` (surveyor's calls with lines and curves, streets, the front side, per-side kinds). `traverse()` walks the calls (bearings in any common spelling, curves by radius with arc length, delta or chord), `envelopeOf()` clips the boundary by each side's setback, and the house frame's angle comes from the front side's outward normal (local +z toward the street). The layout, rules, ops, IFC and scene all take the lot as a parameter. City rules (`cities.js`: Mission, McAllen, Edinburg, Pharr, Palmview, Weslaco, Hidalgo County; setbacks, street side, coverage, height) start as unverified office defaults and are edited on the dashboard (`PUT /api/admin/cities/:id`, kept in the store). Plat reading: `POST /api/lot/plat` sends the PDF or photo to Claude with a schema (`PLAT_SCHEMA`) and gets calls, streets, front, printed setbacks, the page box and north direction; the client shows the polygon over the sheet (approximate) and continues with the lot marked unconfirmed; a drafter confirms or corrects it from the Review inbox ("Lots to confirm", `POST /api/review/:id/lot`), and sending is refused until then (409 `lotPending`). Flood: `GET /api/lot/flood?address=` geocodes with the Census geocoder and asks the FEMA NFHL flood-zone layer; results are cached 30 days. On a machine behind an HTTP proxy, run the API with `NODE_USE_ENV_PROXY=1` so Node's fetch reaches those hosts.

Billing (`server/billing.mjs`, `src/draft/screens/Billing.jsx`, `#/billing`, migration `003_billing.sql`): credits are on the account (`users.credits`), charged by `store.users.charge` (atomic) when a change applies and returned by rollback; projects count `creditsUsed`. Pricing is a table in the store (`PUT /api/admin/pricing`, admin), placeholders until set. `POST /api/billing/checkout` creates a Stripe Checkout Session with `price_data` from the pack and the user id in the metadata and returns its URL; `POST /api/billing/webhook` verifies the signature with `STRIPE_WEBHOOK_SECRET` and, on a paid `checkout.session.completed`, writes one `payments` row keyed by the session id (so retries never credit twice), adds the credits and fetches the receipt URL from the charge. After the redirect the billing page polls `GET /api/billing/session/:id` until the webhook has landed. Admins grant credits by hand (`POST /api/admin/users/:id/credits`), which shows in the history as a grant. Health row "Payments" shows the Stripe mode and whether the webhook secret is set.

Review screen (`src/draft/screens/Review.jsx`, `#/review`): the drafter inbox, the plan, the client's requests, approve or return with a note. The Office dashboard and the inbox need a drafter sign-in.

Alerts (`server/alerts.mjs`): every minute, a worker silent for more than 10 minutes gets one email through Resend and one more when it is back; the flag lives on the worker row so a restart does not resend. Backups (`server/backup.mjs`): nightly gzip JSON dump of every table to the file store under `backups/`, last 30 kept, also on demand from the dashboard and `scripts/backup-db.mjs`; restore or import with `scripts/migrate-json-to-pg.mjs`. Deployment: `render.yaml` (API), `netlify.toml` (app), `docs/DEPLOY.md` (every setting and where it goes).

### Worker, `worker/draft_house_worker.py`

Loop: heartbeat every 30 s with six checks, claim every 10 s, smoke test at start and every six hours. A job: download design.json, run `pyrevit run revit/build_model.py <template> --revit=<year>` with the design path in env, relay `DH_PROGRESS` lines, read report.json, upload model.rvt, sheets.pdf, model.ifc, report.json, mark complete; on any error kill Revit and fail. 15 minute timeout per job.

### Office install and the name mapping

`docs/OFFICE-CHECKLIST.md` is the step list for the person at the Revit computer: smoke test, `list_names.py` (writes every type and family name in the template to `template-names.json`), fill `worker/kit.revit.json` from it (kit name on the left, template name on the right), `selfcheck.py` (a dry run without Revit that validates the design and lists the names that will fall back), the Garza build locally (`--job design.json`), one heartbeat, then `install.ps1`. The worker runs as a self-restarting scheduled task in the logged-on session plus a watchdog task, not a Windows service, because Revit needs an interactive desktop; automatic logon makes it reboot-proof. `docs/autodesk-email.md` asks Autodesk whether unattended desktop Revit is covered and outlines the move to Design Automation if not.

### Build script, `worker/revit/build_model.py`

Transactions: walls (`Wall.Create` by kit wall type, base and height), openings (`NewFamilyInstance` on the nearest host wall within 1.5 ft, hand and facing flipped from the kit's swing, sill parameter for windows), one slab from the design's `footprint` (`Floor.Create` on 2022+, `NewFloor` before), rooms by point, fixtures (turned a quarter when drawn deeper than wide), roofs (`NewFootPrintRoof` per gable mass about the roof centre and scale, eaves slope-defining; the slope is written as a ratio by default and the script reads the model's slope back into the report so `roofSlopeUnits` in `kit.revit.json` can be flipped to radians if Revit disagrees), sheets (`ViewSheet.Create` per kit sheet with the title block family, the Level 1 plan on sheet 200, project information filled), save, IFC4 export, PDF export of all sheets. Every name goes through `kit.revit.json`; a name the template lacks falls back to the template default and is listed in `report.fallbacks` and on the job. **Written from the Revit API reference and reviewed, never executed on a live Revit.** The first run on the office machine follows `docs/OFFICE-CHECKLIST.md`; the fixes come from the `report.json` and `revit.log` it sends back.

### Dashboard, `src/draft/screens/Admin.jsx`

Polls the overview every 5 s. Manifold of eight nodes from client to drafters, queue tiles, build-time bars, health check table with Run Revit check, jobs with outputs, warnings, logs, retry, and activity.

### Design contract

See `docs/design-contract.md`. Version 1. The worker refuses other versions.

### Kits from IFC exports

`scripts/kit-from-ifc.py <model.ifc> --id <style> --name "<Style>"` reads a Revit IFC4 export with IfcOpenShell and writes `src/kits/<style>.ifc.js`, a kit in the farmhouse shape: rooms from IfcSpace (kinds by name, plates from the space height), walls by thickness and IsExternal, doors and windows with their host wall (axis, width, sill and head, cased openings from unfilled voids), fixtures from furnishing and flow terminals, gable roof masses by pairing opposite slopes that share a ridge and merging the clipped pieces, open pairs where touching rooms have no wall on either facing edge, and the reference program and living area. The plan frame is straightened by the dominant wall direction and re-based on the rooms' corner. Templates, rules, sheets and finish schedules come from the base farmhouse kit. `src/kits/generated.js` is the registry the script rewrites; `styles.js` marks a style ready when a generated kit has its id. `scripts/convert-kits.mjs` converts every file in `kits-ifc/` (the exports themselves stay out of git). `--compare src/kits/modern-farmhouse.js` prints the round-trip report against the traced kit; on our own Garza export it matches all 26 rooms, 22 of 23 doors, 14 of 14 windows, 34 fixtures, the open pairs and the living area, and reads 10 roof masses where the drafter traced 7 (clipped pieces that the roof engine re-clips the same way).

## 13. Tests and checks

- `npm test`: `garza.test.mjs` checks areas, takeoff, schedules, plan counts, roof masses and ridge heights, no buried roof vertices, IFC well-formedness including door, window, void, and roof panel counts. `server.test.mjs` starts the API on a random port and runs the full pipeline on the JSON store, then again with API keys and CORS; with `TEST_DATABASE_URL` set it also runs on a throwaway Postgres database and checks that eight workers claiming at once get three distinct jobs. `alerts.test.mjs` covers the offline email logic with a fake clock and the backup rotation. `lot.test.mjs` covers bearings, the traverse of the recorded Lot 514 plat (closure, area, arc), manual and plat lots, the envelope, the city table and its edits, the Garza plan on a 100 by 150 lot, the send gate until a drafter confirms a plat lot, and with `LIVE=1` the real plat reader on the Garza site plan (`test/fixtures/garza-site-plan.png`) plus the FEMA lookup. `billing.test.mjs` covers account credits across houses, the 402, rollback refunds, pricing edits, admin grants, and the webhook: an event signed with the Stripe library's own test signer adds the pack's credits once, a retry is a duplicate, a bad signature is refused, an unpaid session is ignored; with `LIVE=1` and a test secret key it creates a real Checkout Session. `kits.test.mjs` exports the Garza house to IFC, converts it back with the script, checks the round trip against the traced kit, loads the generated module, and drafts its reference house through the rules and the IFC export; every kit in `generated.js` gets the same reference checks. `worker.test.mjs` checks the design the worker gets (names, footprint, roof placement data), that the Revit scripts parse, and the dry-run self-check with and without a template names file. `accounts.test.mjs` covers sign-in, roles, credits (charged only on applied changes, refunded on rollback, 402 when gone), permissions (a client cannot see another client's project), the review round trip and the built status, on both stores. `interpret.test.mjs` covers the interpreter and rules.
- Screenshots: `scripts/shot-flow.mjs` walks every step including Send and the dashboard; it expects the API and a worker running for the last two.
- IFC geometry: the IfcOpenShell check described in section 11. Not automated in `npm test` because it needs Python 3.13.

## 14. Known gaps, assumptions, and what is untested

- Survey upload does nothing. Lot and city rules are Lot 514 and Palmview constants.
- Only one kit. Everything was traced from a PDF at screen resolution; positions can be off by a foot. The right fix is to extract kits from the drafter's Revit export (IFC from Revit, parsed with IfcOpenShell into the kit shape). Not built.
- The change interpreter calls Claude through the office API, with a regex fallback and a rules engine. On 2026-11-03 the ten named requests came out right 10 of 10 in three consecutive live runs, at about $0.012 and 2.2 s per request. There is no price model beyond dollars per square foot by style.
- Credits, accounts, saving, and payments do not exist.
- Changing a room does not move its fixtures or openings.
- Roof: see section 9 limits. Revit's footprint roofs in the build script do not reproduce the clipped valleys; Revit joins roofs its own way.
- `build_model.py` has never run. The Revit name mapping in the kit is placeholders.
- Office API has no auth, no HTTPS, a JSON file store.
- Desktop Revit licensing for unattended automation needs a written answer from Autodesk before paying clients depend on it. Autodesk Design Automation is the sanctioned route; the add-in code is the same.
- The 3D page uses a painter's algorithm; expect small artifacts at eye level.

## 15. Roadmap, in order

1. **Get the build script running on the office machine.** Follow `docs/OFFICE-CHECKLIST.md`; fix `build_model.py` from the `report.json` and `revit.log` it sends back; the drafter fills `worker/kit.revit.json` from `template-names.json`.
2. **Kit extraction from Revit.** Done: `scripts/kit-from-ifc.py` and `kits-ifc/README.md`. Waiting on the drafters' nine exports; each one converted is a ready style.
3. **Real change interpreter.** Claude turns a request plus the current plan into a structured diff; a rules engine (setbacks, minimum room sizes, egress, plumbing stacking, buildability) accepts or rejects with a plain-language reason.
4. **Accounts and payments.** Done: Supabase Auth, saved versions with rollback, account credits, drafter review inbox, status for the client, Stripe Checkout with the webhook adding credits, receipts, admin pricing and grants.
5. **Survey and city intake.** Done: typed lots, plat reading with drafter confirmation, city rules table, FEMA flood zone. Remaining: county GIS parcel lookup by address, so the lot can be found without a plat.
6. **Production hardening.** Done: self-restarting worker task with a watchdog (`worker/install.ps1`), API keys, HTTPS through Render, backups, offline alerts.
7. **Renders and sales assets** once a layout is approved.

## 16. Decisions and why

- **Trace a real plan instead of generating layouts.** Generated layouts did not look like the builder's drawings. A traced plan adjusted parametrically does.
- **IFC as the handoff.** Vendor neutral, validated here without Revit, opens in Revit. The Revit worker is additive, not a replacement.
- **Dependency-free API and viewer page.** No install friction for the office; the artifact viewer runs on phones without external scripts.
- **Central office machine before Autodesk cloud.** Zero per-job cost for the pilot; the same add-in code moves to Design Automation when volume or licensing requires it.
- **Walls from room edges, not drawn walls.** Keeps the kit small and lets rooms be resized; costs some precision at tracing gaps.
- **Roof as clipped planes.** Gives real valleys from simple mass descriptions and feeds Revit true panels.

## 17. Brand

Tokens in `src/brand/tokens.css`: paper `#F7F7F7`, ink `#111111`, brown `#4E3C30`, hair `#D9D6D1`, muted `#6B6560`. Montserrat, uppercase with wide tracking for the wordmark and labels. Status colours for the dashboard: good `#2E6B3A`, warning `#9A6B12`, bad `#A33A2D`, always with a label, never colour alone. The name is to be decided; it will contain "House".
