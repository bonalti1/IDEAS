# Draft House fix round 10: the street side of a lot, hermetic tests, and what the live review of PR #9 found

Branch `claude/fix-round-10`, on top of `claude/fix-round-9` @8f7c45c. Pictures in `docs/fix-round-10/`.

One sentence: the street side of a lot is now read from the road that carries the address's street name, which makes all nine reviewed lots right (two were); the tests run on live recordings and cannot reach a real host; and the Lot step asks before it uses an address the geocoder changed, never blocks a draft over zoning, and says so in plain words when an outside service does not answer.

**Rules kept.** No money in the client app (the no-money suite passes with the internet on). 10 free changes per plan, the office grants more. No owner data in fixtures or logs: the recordings keep only ids, legal, situs and acres, and the owner gate is tested on made-up values.

**This box.** Round 9 could not reach the county, city or TIGERweb servers from here. Rolando approved adding those twelve hosts to this session's environment, so everything below marked "live" was run from this box on Nov 19, 2026.

## P0

| # | Item | What changed | Test (fails before, passes after) | Picture | Status |
|---|------|--------------|-----------------------------------|---------|--------|
| 1 | The front edge is wrong on 7 of 9 live lots | `server/parcels.mjs`: `withFront()` asks TIGERweb for the roads within 120 m of the parcel's interior point (layers 8 and 6 side by side, then 2), matches the road's name to the typed street or the Census match, ignoring directions and the suffix (`sameStreet`, `streetCore`), and `frontFromRoads()` takes the edge of 5 ft or more whose midpoint is nearest that road with its outward normal facing it; within 3 ft, the shorter edge. Fallbacks in order: the county address point when it sits within 20 ft of an edge, the Census point, the southern edge. The answer (`frontEdge`, `frontBy`, `frontStreet`, `streets`, `edgeKinds`, `corner`) is stored with the parcel; older cached parcels are read again (`v: 2`). A second named road along another edge makes `corner: true` and that edge takes the street-side setback (this closes round 9 item 17); a street behind the lot is a through lot, not a corner; a second name on the same centreline (S 10th St is also State Hwy 336) is not a side street; a curved frontage in several chords fronts on all of them. All nine addresses are in `TEST_ADDRESSES` with `frontFt`. The Lot view always draws a parcel or plat lot: with no room inside the setbacks it is tinted red, tagged "no room to build" and the reason is in the panel; the scene no longer crashes on an empty envelope (that crash is why the previous lot used to stay). | `test/round10.test.mjs` "1: …" (six tests: the nine lots within half a foot of the measured frontage; without the road map at least five of nine are wrong; names; the picker on plain shapes; corners; Armagoza and the sliver as lots). `test/lot-front.test.mjs` on the screens at 1440 and 390. Live: `test/live-acceptance.test.mjs`. | `lot-kerria-1440`, `lot-armagoza-1440`, `lot-curtis-clark-1440`, the three at `-390`, `lot-no-room-drawn-red-1440` | Done |
| 2 | The browser money test fails on a machine with internet | Every place a test starts the API spreads `fixtureEnv` (`DRAFTHOUSE_FIXTURES=1` unless `LIVE=1`) from `test/server-env.mjs`; `spawnGroup` adds it for the browser tests. `guardNetwork()` in `server/fixtures.mjs` replaces the global fetch: loopback passes, any other host throws, naming it, unless `LIVE=1`. It is on in every test process (`npm test` runs `--import ./test/guard.mjs`) and in a server started on the fixtures. | `test/round10.test.mjs` "2: …" (a source scan of every server spawn; the guard on, off with `LIVE=1`, allow-list). The no-money suite passes here with the internet on. | | Done |

The guard found one more leak on its first run: `test/alerts.test.mjs` was posting to `api.resend.com` with a made-up key. `makeAlerts` now takes a `fetchImpl`, and the test asserts on what would be sent.

### The nine lots, live from this box

| Address | Round 9 gave | Measured in the review | Round 10 gives | On |
|---|---|---|---|---|
| 1201 Kerria Ave, McAllen | 79.75 | 79.6 | 79.75 | Kerria Ave (corner: N 12th St) |
| 36 Melissa Dr, Brownsville | 120.44 | 63.4 | 63.53 | Melissa Dr |
| 5435 Curtis Clark Dr, Corpus Christi | 300.67 | 31.1 | 31.15 | Curtis Clark Dr |
| 3305 N 27th St, McAllen | 109.52 | 65.1 | 65.23 | N 27th St |
| 1534 Armagoza Dr, Edinburg | 140.27 | 67.3 | 67.43 | N Armagoza Dr |
| 3013 Yvonne St, Edinburg | 133.16 | 54.8 | 54.90 | E Yvonne St |
| 2218 Royal Palm Dr, Mission | 124.79 | 80.1 | 80.28 | Royal Palm Dr (corner: E Griffin Pkwy) |
| 2454 E 30th St, Brownsville | 99.86 | 50.1 | 50.17 | E 30th St |
| 4175 Sierra Madre Dr, Brownsville | 50.04 | 49.9 | 50.04 | Sierra Madre Dr |

Armagoza's buildable area is 5,559 sf (it was 3,519 sf with the 140 ft side on the street). Curtis Clark is drawn as the 31 × 300 sliver with a 5,857 sf envelope.

## P1

| # | Item | What changed | Test | Picture | Status |
|---|------|--------------|------|---------|--------|
| 3 | The Census "found" a different address | `lots.geocode()` compares the house number, the direction before the street (only when both have one) and the street's name (`addressMismatch`). On a difference the Lot step shows a yellow card, "We found 1300 **E** Nolana Ave, not W. Is that right?", with Yes and No; no parcel, flood or zoning is looked up until Yes. The server holds it too: `/api/lot/parcel` answers `match: 'confirm-address'` without `confirmed=1`. The typed lot keeps the typed street name. | `round10` "3: …" and "6 and 3 over HTTP"; `lot-front` second test. | `address-check-w-nolana-1440`, `-390`, `address-confirmed-large-tract-390` | Done |
| 4 | Zoning from an unconfirmed address blocks Draft | The audit's zoning finding is a warning, so Rooms and Draft stay open. `zoningBlocksSend(lot)` blocks Send only for a parcel or plat lot, or a typed lot whose zoning a drafter confirmed (new `POST /api/review/:id/zoning` and a small box on the drafter's review card). A typed lot never carries the zoning read at a parcel nobody accepted. The server enforces the same on Send. | `lot-rules` zoning test; `round10` "4 over HTTP"; `lot-front` second test (Draft enabled). | `rooms-draft-open-unconfirmed-address-1440` | Done |
| 5 | The drafter's owner lookup is empty for Hidalgo; Cameron has no mailing address | Real columns mapped: Hidalgo `file_as_name` and `addr_line1..3, addr_city, addr_state, zip`; Cameron `addr1..3, addrcity, addrstate, addrzip`; the BIS counties (Nueces, Kleberg, San Patricio, Starr) the same six mailing columns; `mailing` is a list joined in order. `parcels.checkFields()` reads each layer's `?f=json` and compares every mapped column and id type; it runs at start, daily and from "Check the columns" on the Sources page, which shows a column per source. Live: all eight counties and the road layers pass. | `round10` "5: …" (two tests); `parcels` HTTP test (a drafter gets the owner and the joined mailing address for Hidalgo, Cameron and Nueces; a homeowner gets none). Live acceptance asserts both are present. | | Done |
| 6 | An upstream network error becomes a 500 | A dropped connection, a timeout or a bad answer from FEMA, the Census, the county, a city zoning server or TIGERweb is a 502 with a plain line ("FEMA did not answer; the office checks the flood zone"); the cause goes to the log. FEMA gets one retry. A net in the dispatcher turns any uncaught `fetch failed`, abort or timeout into a 502. The Lot step shows the line. TIGERweb down is not an error at all: the street side falls back. | `round10` "6: …" and "6 over HTTP"; `lot-front` third test. | `fema-did-not-answer-1440` | Done |
| 7 | The recorded fixtures are clean but not committable | Recorded here with the rewritten `scripts/make-parcel-fixtures.mjs`: 13 live cases (the nine lots, Pharr, 2200 S 10th, 1001 E Elizabeth, 1300 W Nolana) with their roads, and `layers.json` from the live field lists; Rio Grande City stays synthetic. Only ids, legal, situs and acres are kept. The recorder checks each file replays to the live answer. Expectations updated to the recorded truth (Pharr C2 ×3, the buffer neighbour 1104 Clarissa, cleaned counts). The owner gate is tested on a made-up owner the fixture server adds (`DRAFTHOUSE_FIXTURE_OWNER=sentinel`). Committed after `npm test` passed on them. | `parcels` (13 tests), `jurisdictions`, `round9`. | | Done |
| 8 | Chat leftovers | "make the kitchen bigger and then make it smaller" now nets to no change in the app's own chat (the check was only on the offline path, not in `projects.change`). The swap sentence names both rooms and the real reason ("Swapping the kitchen and the 2-car garage does not work on this plan: the two rooms are too different in size to trade places."). No reply carries the validator's text or a bracket; the list stays in `reasons`, which the drafter log keeps. A setback refusal names the setback ("the 20 ft setback from Elm St"). | `round10` "8: …" and "8 over HTTP"; `round9` test 10 rewritten. | | Done |

On item 7, the owner check: the recorder counts, without printing a value, how many owner strings also occur in a kept column. One did, inside a legal description on the 1001 E Elizabeth recording (the string the review mentioned). The recorder now cuts such a string out of the kept column, so the count in every file is 0. An owner-occupied lot is mailed at its situs, which is the property address and stays.

## P2

| # | Item | What changed | Test | Status |
|---|------|--------------|------|--------|
| 9 | Geocode, flood, zoning and wind routes are open | All four are `user` routes (401 anonymous) with the same limit as the parcel routes, counted per kind; an answer from the cache is free. | `round10` "9: …"; `fuzz`. | Done |
| 10 | Rate-limit details | `server/net.mjs`: `clientIp(req, hops)` reads `x-forwarded-for` only behind `TRUST_PROXY_HOPS` proxies (1 in `render.yaml`), taking the entry that many places from the right; unset, the socket's address. The window deletes a key when its list is empty, and a sweep every ten minutes removes the ones nobody reads again. | `round10` "10: …". | Done |
| 11 | Large commercial tracts | Kept: `large` on a tract over two acres or 60 edges; the card skips the edge list for it and for a lot that is not a house district. | `round10` "11: …"; `lot-front` (the Nolana tract). | Done |

## Found on the way and fixed

| What | Fix |
|------|-----|
| Willacy's address points pointed at layer 0 of the SCC service, which is Texas_Railroads | They are in the RGV911 web-apps layer 0 with Hidalgo's; the source now points there. |
| Jim Wells mapped `prop_id` and `geo_id`; the layer has `pid` and `geoID` | Mapped; the field check now covers it. |
| Cameron's third fallback layer spells its columns in another case (`PROP_ID`, `situsDispl`), so a lookup through it returned no id or situs | Attributes are read case-insensitively (`attr()`); the Sources page notes the spelling. |
| Nueces `cityLimits: 'CITY_LIMITS'`: no such column (its `city` is a taxing-unit code) | Removed. |
| A homeowner's browser could send a lot marked `confirmed: true` | `projects.ownerLot()` on create and update: the drafter's marks (a confirmed lot, a confirmed zoning) are never taken from a browser. |
| The 3D scene threw on an empty envelope | Guarded; the lot is drawn red with the reason. |
| The lot's line of text ran across the street's name when the street was north of the lot | It sits on the side away from the street, in two short lines. |
| FEMA drops a connection now and then (it did during the first live run here) | One retry, then the plain line. |
| `test/alerts.test.mjs` posted to the real Resend API | The sender takes an injected fetch. |

## Verification

| Check | Result |
|-------|--------|
| `npm test` (fixtures, guard on, internet on) | 365 tests, 359 pass, 0 fail, 6 skipped (3 `LIVE`, 3 dormant billing) |
| `LIVE=1 node --test test/live-acceptance.test.mjs` | 2 of 2 pass, twice in a row: the nine fronts, Pharr 259430, flood and zoning, owner and mailing present |
| The no-money suite with the internet on | passes (part of `npm test`): 20 screens, no money |
| `vite build` | clean; `office`, `Review` and `Admin` are still their own chunks |
| `npm audit --omit=dev` | 0 vulnerabilities |
| Field check, live | all mapped columns present on the eight county sources and the road layers |

Before, on round 9's code with this round's tests and recordings: `round10` and `parcels` and `lot-rules` do not load (the functions do not exist), `round9` 1 of 6 fails, `fuzz` fails (the geocode route was open), `alerts` 1 of 3 fails.

## Not met, or different from the brief

- **"More than one named road within 25 ft means a corner lot."** The measured frontages sit 15 to 34 ft from the centreline, so 25 ft would miss real side streets. A second named road counts within 40 ft of an edge's midpoint for a local road and 60 ft for a secondary road (`ROAD_SOURCE.cornerFt`). On the recordings this finds Kerria/N 12th St (22 ft), Royal Palm/E Griffin Pkwy (37 ft), Cage/W Caffery St (28 ft) and Elizabeth/E 10th St (14 ft).
- **"Secondary Roads (layer 2)."** On the live service layer 2 is Primary Roads and Secondary Roads is layer 6. The code reads 8 and 6, then 2.
- **The address point as a fallback** is used only when it sits within 20 ft of an edge. Live it sits on the house, mid-lot (for 3305 N 27th St it is nearer the rear), so in the middle of a lot it says nothing and the Census point decides.
- **A cul-de-sac or flag lot** whose frontage is not on the road's centreline side is still a judgement: the card says "our best guess" whenever the front did not come from the named road, and the drafter confirms every parcel lot.

## Questions for the office

1. Confirm `TRUST_PROXY_HOPS=1` on Render (how to check is in `docs/DEPLOY.md`).
2. The corner distances (40 ft local, 60 ft secondary): keep, or set others?
3. The ten acceptance addresses now run in the daily check (ten county lookups and ten road lookups a day). Fine?
