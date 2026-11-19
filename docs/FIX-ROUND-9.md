# Draft House fix round 9: what the live review found

Branch `claude/fix-round-9`: round 7 (`claude/fix-round-7` @dfa150f) merged onto round 8 (`claude/fix-round-8` @1eec6f1) first (item 13), then the fixes. Pictures in `docs/fix-round-9/`.

One sentence: the Style step's "$115/sf" is gone and the homeowner bundle carries no rates at all; the parcel lookup, the flood layers and the zoning URLs now match what the live services answer; the address point's parcel is checked against the situs before it is called a match; the front edge faces the street; the recorder keeps only an allow-list of fields; the parcel routes need a login and are rate-limited; the fixture server fails the way the live layers fail; and a plan-rule refusal is one plain sentence.

**Rules kept.** No money anywhere a homeowner sees (the Style step checked, the bundle checked). Plan changes stay free, 10 per plan, the office grants more. No live parcel recordings committed: the fixtures are synthetic, marked, built from the live numbers in the review (the county and city servers are unreachable from the build machine; FEMA is reachable and was used to verify item 3). No owner name or mailing address anywhere but the drafter-only fields: the recorder is an allow-list now, a test reads every committed fixture, and the routes strip the fields for everyone but drafters.

## P0

| # | Item | What changed | Test (fails before, passes after) | Picture | Status |
|---|------|--------------|-----------------------------------|---------|--------|
| 1 | Money on the Style step; rates in the homeowner bundle | `Style.jsx` says "ready to draft" / "coming soon"; `psf` removed from `STYLES`. `plan-svg.js` and `pdf.js` no longer import `pricing.js`: the summary layouts take a money block as three strings, and only `src/draft/lib/office.js` (meeting prep HTML and PDF) builds it from the rates. The office screens (Review, Admin) are `React.lazy` chunks and the review imports `office.js` on demand, so the entry chunk has no `RATES`, no `115/120` pair, no `$/sf`. `options.js` takes an injected estimator (the office passes `pricing.estimate`; the homeowner never does). `cities.js` no longer says "we price it" (the round-7 table replaced that line). | `test/no-money.test.mjs`: `check('style')` with a picture; the entry chunk has no rates, no rate pair, no `$/sf` statement, and the office code is its own chunk | `docs/fix-round-9/desktop-02b-style.png`, `phone-02b-style.png` | Done |
| 2 | Parcel id queries fail live for Hidalgo | `parcel-sources.mjs` gives each source its field `types`; `whereClause(parts, types)` emits an integer field unquoted, digits only, and refuses any other operator on it; `byId()` uses the same. `lookupOn` runs each step in its own try: a failed step is noted and the next runs (address point → situs → buffer); only when every step failed does the error come out, so the breaker counts a dead source, not one bad query. | `test/parcels.test.mjs`: `prop_id = 255056` unquoted, `'255056'` refused by the fixture server exactly as RGV911 does ("Unable to complete operation."), Kerria matches with no step error | | Done |
| 3 | Every live flood lookup failed | `lots.floodAt()`: availability from FIRM Panels (layer 3: `DFIRM_ID, FIRM_PAN, EFF_DATE`) and `STUDY_ID` on layer 0; zones from 28; LOMRs from layer 1; LOMAs from layer 34, labelled LOMA; preliminary data is not in the public NFHL, is not queried, and the record says so (`prelimNote`). The panel and its effective date are in the record. **Verified live from this box** (FEMA is reachable): Kerria `no-digital-firm` (layers 0 and 3 empty for all of Hidalgo), Melissa X on 48061C0590F, Curtis Clark X on 48355C0510G. | `test/jurisdictions.test.mjs` "item 4" (no FIRM, X with panel and date, AE with a LOMR and a LOMA on the downtown fixture); the fixture server refuses `outFields=DFIRM_ID` on layer 0 and `NFHL/21` | | Done |
| 4 | Zoning URLs 404 | McAllen `gismap.mcallen.net/publication/rest/services/DevelopmentZoning/MapServer/4`; Corpus Christi `ccpublicgis.cctexas.com/server01/rest/services/CC_GENERAL_SERVICES/CC_GENERAL_SERVICES/MapServer/4`. Not reachable from the build machine; taken from the review and the research. | `test/jurisdictions.test.mjs` asserts the layer URLs the lookup used | | Done, verified by the review's run, not from here |
| 5 | The address point's parcel is the neighbour's | After fetching by `parcel_id`, `situsMatches()` runs against the typed number and street; a mismatch is logged (`parcels:disagreements`, shown on the sources page) and the lookup falls through to the situs query, then the buffer. `exact` only when the situs agrees. 118 S Cage Blvd, Pharr is the fourth acceptance address (`259430`, never `259436`). | `test/parcels.test.mjs`: the Pharr fixture carries the live address point's wrong id; the lookup lands on 259430 by situs, confidence not exact, the disagreement on the health page | `admin-sources-rules-1440.png` | Done |
| 6 | Two of three lots draw sideways | `pickFrontEdge(pts, streetPoint)`: each edge is judged from its midpoint and outward normal (how far the street point sits off the midpoint's ray, a penalty when it lies behind the edge), the shorter edge on a tie, never raw segment distance; with no point, the edge facing south. Kerria fronts on its 80 ft side, the Curtis Clark sliver on its 31.6 ft end. | `test/round9.test.mjs` item 6: street points off either corner, the sliver, the fixtures through the pipeline; `test/parcels.test.mjs` asserts both fronts | `lot-parcel-taken-rules-1440.png` | Done (the TIGER / address-point street-name method is not built; the midpoint rule covers the review's cases) |
| 7 | The recorder missed mailing-address keys | `record()` keeps only the fields `parcel-sources.mjs` maps (ids, legal, situs parts, acres, city limits) and the three address-point fields; `assertNoPersonKeys()` runs before every write and throws on `owner|mail|addr|zip|name$|file_as|taxpayer|deed`. | `test/parcels.test.mjs`: every committed fixture against the list; the list catches `addr_line1..3`, `addr_city`, `zip`, `addr1..3`, `addrcity`, `addrzip`, `file_as_name`, `ownerAddre` | | Done |
| 8 | Open, anonymous, unlimited parcel proxy | `/api/lot/parcel` and `/api/lot/parcel/:county/:propId` are `user` routes (401 anonymous). 20 lookups that reach a county per user every 10 minutes (`PARCEL_LOOKUPS_PER_10MIN`), three times that per address; cache hits are free; past it a 429 with "Too many lot lookups for now…". The county key takes the name, the slug or the hyphenated slug (`hidalgo/255056` works now; it was a 404 because the route wanted "Hidalgo County"). | `test/parcels.test.mjs`: 401, the 21st lookup is 429, a cache hit is free, another user is not limited, the three key spellings | | Done |

## P1

| # | Item | What changed | Test | Status |
|---|------|--------------|------|--------|
| 9 | Make the fixtures real | The county parcel and city zoning servers are unreachable from this box (HTTP 000 / ENOTFOUND through the proxy), so no recording could be made here. Done instead: the fixture server enforces each layer's field list and types from `test/fixtures/parcels/layers.json` (NFHL fields read live; county and zoning fields from the sources and the review), answering the way the live layers do (unknown field "Failed to execute query.", quoted integer "Unable to complete operation.", missing layer "Invalid URL"), so round 7's wrong layers and field names fail in CI; the synthetic cases now carry the live numbers (no FIRM in Hidalgo, Melissa `144311` on 48061C, Curtis Clark `236866` on 48355C, Pharr's wrong address point, 2200 S 10th C-2, 1001 E Elizabeth DC with a LOMR and a LOMA to exercise those readers); `test/live-acceptance.test.mjs` runs the acceptance table against the live services with `LIVE=1`; the daily check covers the four addresses. **From the office:** `LIVE=1 node scripts/make-parcel-fixtures.mjs` (allow-listed) and commit; `LIVE=1 node --test test/live-acceptance.test.mjs`. | `test/parcels.test.mjs` "the fixture server answers like the live layers" | Done as far as this box allows; recordings from the office |
| 10 | Validator strings in chat | `plainRefusal()`: one sentence built from what was asked (taking out the Bedroom 3, swapping the kitchen and the garage, resizing the kitchen, adding a bath) and the kind of problem (runs past the setbacks, runs rooms into each other, a size the kit cannot build, takes a bedroom's window away, leaves rooms without a door), one detail in brackets, a suggestion; the raw list stays in `reasons` for the drafter log. | `test/round9.test.mjs` item 10 | Done |
| 11 | Multi-part chat | "make the kitchen bigger and then make it smaller" (and "smaller and then bigger", or with "the kitchen" named twice) answers "That nets out to no change… No change was used." without touching the plan; with sizes given, or two rooms, both parts apply in order. "add 10 bedrooms" on a full plan says "This plan already has the most bedrooms this lot holds (6)." | `test/round9.test.mjs` item 11 | Done |
| 12 | Browser-test hygiene | `test/browser.mjs`: `chromePath()` (CHROME, PLAYWRIGHT_CHROMIUM, `which`, the sandbox path; skip with a reason when none), `freePort()`, `startPreview()` spawned detached and killed with its process group, `appContext()` points the built app at the test's API through `localStorage['drafthouse.api']` (read once by `lib/api.js`), `shotDir()` writes pictures to a temp folder unless `SHOTS` names one. Both suites use it; nothing binds :8787 or :4188/:4189 any more. | both suites run alone and together | Done |
| 13 | Merge round 7 onto round 8 | The six files resolved as the brief lists: round 8's `BILLING_ENABLED` gate, null billing, `safeUser`, `/api/me`, `projects.list`, `readJson` schemas and `makeProjects({…, alerts})` kept; round 7's fixture mode, parcels, zoning, wind, the routes (the jurisdiction edit and call-me routes with schemas), the health rows, the parcel kind in the inbox, Sources beside Allowance, the sourced city table with round 8's `garageFt` helper. Merge regressions found by the suite and fixed: `garageSideEntryExempt` missing on the flat rows; the round-8 five-step chat now lands three of five on McAllen's sourced 20/5/10 setbacks (the 3-car garage and the wider kitchen are refused for the setback and the foyer; the test asks for three). | the full suite; the no-money and lot-flow suites | Done |

## P2

| # | Item | What changed | Status |
|---|------|--------------|--------|
| 14 | Edinburg's 60% is impervious cover | `imperviousMax` is a field of its own (label "Max impervious cover"); Edinburg's row has `imperviousMax: 60%`, `maxCoverage: unknown` (the county default stands in, flagged) and `coverageIncludesImpervious: false`. The audit measures house + porches + driveway + walk against it and raises `impervious` when over; `measures.impervious` carries the numbers. | Done |
| 15 | Large commercial parcels | `large: true` on a parcel over two acres or with more than 60 edges; the Lot card says "A large tract (N acres, M sides): the office draws this one." and skips the edge list, as it does when the zoning is not a house district. | Done |
| 16 | `--program '{"baths":3.5}'` crashes | `normalizeProgram()` in `layout.js`: a fractional bath count becomes whole baths plus `halfBath`, counts are whole and never negative, stories at least 1; run at `starterDraft`, `fitsLot` and in `scripts/plan-audit.mjs`, so the API and the client paths get it too. | Done |
| 17 | Corner lots on a live parcel | Not built this round: a parcel lot gets `front` from the street point and `rear` opposite; a second street is not detected (no street layer is read), so the drafter sets `kinds` on confirmation. Said as not met. | Not met |

## Live checks from this box

FEMA's NFHL answers from here; the county parcel and city zoning servers do not (ENOTFOUND through the proxy).

| Address | NFHL layers 0 / 3 / 28 / 1 / 34 live | What the app now says |
|---|---|---|
| 1201 Kerria Ave, McAllen | empty / empty / empty / empty / empty | no digital FIRM; the county floodplain administrator decides |
| 36 Melissa Dr, Brownsville | 48061C / 48061C0590F eff. 2018-02-16 / X / none / none | zone X on panel 48061C0590F |
| 5435 Curtis Clark Dr, Corpus Christi | 48355C / 48355C0510G eff. 2022-10-13 / X / none / none | zone X on panel 48355C0510G |

Layer 21 does not exist (the service answers "Invalid URL"); layer 34 is LOMAs.

## Verification

- `npm test`: see the PR for the final numbers (this file is written before the last run; the PR body has them).
- `vite build` clean; the entry chunk has no rates; `office-*.js`, `Review-*.js`, `Admin-*.js` are separate chunks.
- `npm audit --omit=dev`: 0 vulnerabilities.
- The no-money suite (Style step included, both widths, the PDF, the bundle) and the lot-flow suite (the parcel offer, the rules panel, the C-2 block at 390 px, the drafter's card and owner lookup, the second send with the PDF text, the sources page and the rules table) on free ports.

## Not met, and why

- **Live recordings** (item 9): not possible from this box; the strict fixture server, the corrected synthetic cases and the `LIVE=1` test are in place so a run from the office is one command and the tests do not change.
- **Zoning URLs** (item 4) and the **integer type** (item 2) are taken from the review's live run, not re-verified here (unreachable hosts); the fixture server encodes them.
- **Front edge by street name** (item 6): the midpoint rule, not a TIGER or address-point street match; the review's cases pass with it.
- **Corner lots** (item 17): not detected on a parcel; the drafter sets the side-street edge.

## Open questions

1. The per-user lookup limit is 20 in 10 minutes (60 per address). Right for an office demo where one drafter tries many addresses?
2. Edinburg's building coverage is now "unknown, confirm with city" until someone reads the UDC; the 60% impervious cap is enforced. Who reads it?
3. A tract over two acres is flagged and not drawn edge by edge; should the app refuse to draft on it at all, or draft with a note?
