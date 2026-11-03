# Draft House, engineering handoff

Status as of 2026-11-03. Branch `claude/revit-workflow-optimization-vjh5id` in `bonalti1/IDEAS`, 18 commits. Everything below is in that branch. Read this top to bottom once, then use the section index to find things.

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

Environment: `VITE_API_URL` for the office API address (default `http://localhost:8787`). The server takes `PORT` and `DATA_DIR`.

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

`applyRequest(text, rooms, stories, style)` is a **mock** interpreter: regexes for bigger, smaller, add, remove over a list of room kinds. It resizes in place, appends new rooms below the bedroom wing, removes a room and its elements. The real version sends the request and the current rooms to Claude and gets a structured diff, then validates it with a rules engine. Neither exists yet.

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

Store: `server/data/db.json` written debounced, files under `server/data/files/<design>/`. CORS open. No auth. Replace the JSON store with Postgres and add an API key before any client-facing deployment.

### Worker, `worker/draft_house_worker.py`

Loop: heartbeat every 30 s with six checks, claim every 10 s, smoke test at start and every six hours. A job: download design.json, run `pyrevit run revit/build_model.py <template> --revit=<year>` with the design path in env, relay `DH_PROGRESS` lines, read report.json, upload model.rvt, sheets.pdf, model.ifc, report.json, mark complete; on any error kill Revit and fail. 15 minute timeout per job.

### Build script, `worker/revit/build_model.py`

Transactions: walls (`Wall.Create` by kit wall type, base and height), openings (`NewFamilyInstance` on the nearest host wall, sill parameter for windows), rooms and slab, fixtures, roofs (`NewFootPrintRoof` per gable mass with slope-defining eaves), sheets (`ViewSheet.Create` per kit sheet, plan placed on 200), save, IFC export, PDF export of all sheets. Unknown type or family names fall back to the template default and log a warning. **Written from the Revit API reference; never executed.** Expect to fix API signatures on first run.

### Dashboard, `src/draft/screens/Admin.jsx`

Polls the overview every 5 s. Manifold of eight nodes from client to drafters, queue tiles, build-time bars, health check table with Run Revit check, jobs with outputs, warnings, logs, retry, and activity.

### Design contract

See `docs/design-contract.md`. Version 1. The worker refuses other versions.

## 13. Tests and checks

- `npm test`: `garza.test.mjs` checks areas, takeoff, schedules, plan counts, roof masses and ridge heights, no buried roof vertices, IFC well-formedness including door, window, void, and roof panel counts. `server.test.mjs` starts the API on a random port and runs a full job.
- Screenshots: `scripts/shot-flow.mjs` walks every step including Send and the dashboard; it expects the API and a worker running for the last two.
- IFC geometry: the IfcOpenShell check described in section 11. Not automated in `npm test` because it needs Python 3.13.

## 14. Known gaps, assumptions, and what is untested

- Survey upload does nothing. Lot and city rules are Lot 514 and Palmview constants.
- Only one kit. Everything was traced from a PDF at screen resolution; positions can be off by a foot. The right fix is to extract kits from the drafter's Revit export (IFC from Revit, parsed with IfcOpenShell into the kit shape). Not built.
- The plain-language interpreter is regex. No Claude call, no rules engine, no price model beyond dollars per square foot by style.
- Credits, accounts, saving, and payments do not exist.
- Changing a room does not move its fixtures or openings.
- Roof: see section 9 limits. Revit's footprint roofs in the build script do not reproduce the clipped valleys; Revit joins roofs its own way.
- `build_model.py` has never run. The Revit name mapping in the kit is placeholders.
- Office API has no auth, no HTTPS, a JSON file store.
- Desktop Revit licensing for unattended automation needs a written answer from Autodesk before paying clients depend on it. Autodesk Design Automation is the sanctioned route; the add-in code is the same.
- The 3D page uses a painter's algorithm; expect small artifacts at eye level.

## 15. Roadmap, in order

1. **Get the build script running on the office machine.** Install per `worker/INSTALL.md`, enable Remote Control, run the Garza design, fix API calls, fill the real type and family names into `kit.revit`.
2. **Kit extraction from Revit.** Drafter exports each style's model to IFC4; a script reads spaces, walls, openings, fixtures, roofs into the kit shape. Replaces tracing. Unlocks the other nine styles.
3. **Real change interpreter.** Claude turns a request plus the current plan into a structured diff; a rules engine (setbacks, minimum room sizes, egress, plumbing stacking, buildability) accepts or rejects with a plain-language reason.
4. **Persistence and accounts.** Postgres, saved versions with rollback, credits that survive reload, client logins, drafter review queue.
5. **Survey and city intake.** Plat PDF to lot polygon with Claude plus a drafter confirmation step; county GIS, zoning, FEMA layers for the top cities.
6. **Production hardening.** API auth, HTTPS, worker watchdog as a Windows service, backups, monitoring on the dashboard checks.
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
