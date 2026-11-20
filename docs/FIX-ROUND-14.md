# Draft House fix round 14: a plat uploaded with no address, on a server with no reader key

Branch `claude/fix-round-14`, on top of `claude/fix-round-13` @4b64251. Pictures in `docs/fix-round-14/`; the walkthrough's step sheets in `docs/fix-round-14/walkthrough/`.

Source: a homeowner-view screenshot of the live site (drafthouse.netlify.app, Nov 19 2026) sent by Rolando with no other words. A plat PDF was uploaded with no address typed. The screen showed another lot's name as the address, an office error about a key, a 15,000 sf lot that was nobody's, and "Looks right, pick a style" switched on.

One sentence: a plat on its own is now enough to start; a plat the office cannot read is kept for the drafter instead of refused; and no lot is drawn or passed on as the homeowner's before there is one.

**Rules kept.** No money in the client app (and what a plat read cost the office no longer travels to the browser at all). 10 free changes per plan, the office grants more. No owner names or mailing addresses in code, logs, tests or pictures. No secret is committed or logged. Nothing was merged; Render and Netlify were not touched.

## What the screenshot showed, and why

All of it reproduces on the round 13 build (`before-plat-no-address-1440.png`, `-390.png`), so none of it is only an old deploy.

| On the screen | Why |
|---|---|
| "Lot 514, Villa-Rama East Phase V" as the homeowner's address, in the panel and over the drawing | The first screen filled in the demo lot's name whenever a plat was uploaded with no address typed. |
| "the plat reader needs the office Claude key" in red | The office API the site talks to has no `DRAFTHOUSE_CLAUDE_KEY`. The server answered 503 with a line written for the office, and threw the file away. |
| "The Census geocoder did not find this address" | The made-up address was sent to the address service, which of course does not know it. |
| A 100 by 150 ft lot, "Lot area 15,000 sf", "Buildable area 10,350 sf" | The typed tab's starting guess was drawn and measured on the plat tab too. |
| "Looks right, pick a style" switched on | The "I know this is my assumption" tick was asked only on the typed tab; on the plat tab the guess passed without it. |
| "5' — SIDE" printed on top of the red property line | The label was always put 4 ft outside the dashed line, in letters 4 ft tall or more; a 5 ft side yard is narrower than that. |
| The lot's name printed over the north arrow | Already fixed in rounds 11 and 12: the arrow now sits bottom left. The live site runs an older build than that. |

## Fixed

| # | Item | What changed | Test (fails before, passes after) | Picture | Status |
|---|------|--------------|-----------------------------------|---------|--------|
| 1 | Another lot's name given as the homeowner's address | A plat with no address goes on with no address. Nothing is sent to the address service, and the drawing is titled "your lot". The first screen says "Add the address too if the lot has one." The lot step has a field for it ("Street address, if the lot has one", "Look it up"); when the reader finds an address printed on the plat it is offered there, not looked up on its own. | `test/round14.test.mjs` "5 (unit)": no "Lot 514" in the first screen's code. Both "screens at ... a plat with no address" tests: no "Lot 514", no "Villa-Rama" anywhere on the lot step. Before: both words were on the screen at 1440 and 390 px. | `before-plat-no-address-1440.png`, `1-plat-saved-no-lot-yet-1440.png` | Done |
| 2 | "the plat reader needs the office Claude key" | The upload answers 200 whenever the file is a PDF or a photo. A plat the office cannot read (no key on the server, the reader did not answer, or it found fewer than three sides or sides that do not join up) is **kept**, marked unread, with the reason logged for the office only. The homeowner reads "Your plat is saved for the drafter. We could not read it automatically this time, so a drafter draws your exact lot from it." and is shown the two ways to keep going (item 4). | "2 and 5 (unit)": the three cases keep the file, store the reason, and send the browser five fields with no reason in them. "2 and 4 (HTTP)": 200, the file opens again at its address, the activity log names the missing key, the homeowner's project does not. Before: 503 `{"error":"the plat reader needs the office Claude key"}` and nothing kept. | `1-plat-saved-no-lot-yet-1440.png`, `-390.png` | Done |
| 3 | A lot that is nobody's, drawn, measured and passed on | On the plat tab, until there is a lot from the plat (read, or typed off it), nothing is drawn: the drawing area says what it is waiting for, there are no square feet, no rules panel, and "Looks right, pick a style" is off with the reason on hover. On a phone the empty drawing area is 150 px tall, so the fields are on the first screen. | The screens tests: `lot-wait` is shown, no "15,000", no `.stats`, the button is disabled, at both widths; and with nothing uploaded at all, the plat tab never passes the 100 by 150 guess. Before: 15,000 sf shown and the button enabled with no tick. | `7-plat-tab-waits-for-the-plat-1440.png` | Done |
| 4 | Nowhere to go when the plat is not read | Two ways on, both ending in the drafter's queue with the file attached. **By address:** type it on the lot step, the county parcel is offered as usual, and taking it keeps the plat with the lot ("Your lot from the county map is used for now, and the drafter checks it against your plat"). **By size:** type the width, depth and street printed on the plat; the lot is saved as a plat lot (so a drafter must confirm it, like any plat) whose outline is that rectangle. Going back to the lot step shows the numbers again. | "1 and 3 (unit)": the typed rectangle builds to the same area, buildable area and edge kinds as a typed lot, and is unconfirmed. "2 and 4 (HTTP)": saved as a plat lot, listed under "Lots to confirm", confirmed by the drafter. The screens tests walk both ways. | `2-lot-from-the-plat-numbers-1440.png`, `-390.png`, `5-address-added-parcel-offered-1440.png`, `6-parcel-taken-plat-attached-1440.png` | Done |
| 5 | The drafter could not tell a read plat from an unread one | The queue row carries "Plat not read" and, when there is no address, names the file (or shows the address printed on the plat, when it was read). The checklist and the card say in red "Plat not read by the office. The homeowner typed 80 by 140 ft from it: open the plat and check the outline before confirming." and links the file ("Open the plat photo" or "PDF"). It no longer says "Read with 0% confidence". A county parcel that came with an unread plat says so too. | The screens tests open the queue and the card as the drafter and fetch the file through its link. | `3-drafter-queue-plat-not-read-1440.png`, `4-drafter-card-plat-not-read-1440.png`, both also at 390 | Done |
| 6 | Office words on a homeowner's screen | "The Census geocoder did not find this address" is "We could not find this address. Check the street number and the city, or type the lot in." "(office defaults, unverified)" is "(a drafter checks these)". A file that is too big or not a plat is refused in a sentence ("That file is not a PDF or a photo. Upload a PDF, PNG or JPEG."). A lost connection is "We could not send the file just now…", never "Failed to fetch". All of it in Spanish too. | "5 (unit)" and the screens tests (no "Census geocoder", "unverified", "Claude", "503" on any homeowner screen). The translation scan (`test/round13-i18n.test.mjs`) passes with the new strings. | `8-no-account-one-calm-line-1440.png` | Done |
| 7 | "5' — SIDE" on top of the property line | A strip wide enough for the words holds them between the two lines. A strip narrower than the words puts them just outside the lot, clear of the red line. | "6 (unit)": for 4, 5.2 and 8 ft letters, a 5 or 6 ft side yard's label clears the property line; the old rule's label reached or crossed it. | `2-lot-from-the-plat-numbers-1440.png` | Done |

## Found on the way and fixed

| # | What | What changed | Test |
|---|------|--------------|------|
| A | **A visitor without an account who typed an address got three errors:** "Could not look the address up (sign in first)", "Could not reach the county parcel map (sign in first)", "The flood map could not be read (sign in first)". The lookups have needed an account since round 10; "Try it without an account" still asked them. | Without an account nothing is asked. One line says why and how: "Without an account we cannot find your lot on the county map or check the flood map. Type the lot in or upload the plat. Or sign in with your email, and we find it for you." with a "Sign in" link that goes back to the first screen. Typing the lot in and uploading a plat still work. | The last screens test: no refused call, none of the three errors, the line and its link. Picture `8-no-account-one-calm-line-1440.png`. |
| B | **Plat uploads were neither counted nor behind a sign-in.** Anyone with the page could have the office read plat after plat (each read costs the office), and from this round each upload is also kept. | Counted per ten minutes: 8 for an account, 20 for one internet address, 30 for all visitors without an account together (`PLAT_UPLOADS_PER_10MIN` moves the first; the others follow). Over it: 429, "Too many files at once. Wait a few minutes and try again, or type the lot in." A refused file is not counted. | "2 and 4 (HTTP)": the fourth upload of an account set to 3 waits; another account is not held up. |
| C | **What a plat read cost the office was sent to the browser** (`cost`, token counts, milliseconds) and stored inside the homeowner's project. Never shown, but it is money in the client app's data. | The browser gets the outline and the reader's notes only. The office's record keeps the cost. | "2 and 5 (unit)" and the live test. |
| D | **A plat whose sides do not join up drew the previous lot.** The reader's answer was taken even with two sides or an outline that does not close; the drawing then fell back to the 100 by 150 guess. | Such a read is kept for the drafter as unread (what the reader found stays on the office's record), and the homeowner gets item 4's two ways on. | "2 and 5 (unit)", the two-sides case. |
| E | The office health page called the missing key "Change interpreter: no API key, clients get the basic rules", which does not say plats are affected. | "Chat and plat reader: no API key: homeowners get the basic chat rules, and an uploaded plat is saved unread for the drafter. Set DRAFTHOUSE_CLAUDE_KEY on the API host." | n/a (wording) |
| F | The live test of the plat reader (`test/lot.test.mjs`, `LIVE=1`) had been failing since round 10: it asked the flood route without an account. It is not part of the live acceptance run, so nobody saw. | It signs in first. It also checks that no cost comes back. | `LIVE=1` with the real key: 1 of 1. |

Three older tests pinned the 503 and were moved to the new behaviour (`test/lot.test.mjs`, `test/fuzz.test.mjs`, `test/round6-api.test.mjs`; the last one keeps its "a meant 503 keeps its words" check on the test-only route). One allow-list entry of the translation scan named the demo lot's address on the first screen; it is gone with the address.

## What the office has to do for the live site

These are settings and merges; nothing here was done from this branch.

1. **Set `DRAFTHOUSE_CLAUDE_KEY` on the Render service** the live site talks to. Without it the chat runs on the basic rules and, after this round, every uploaded plat is saved unread for the drafter (before this round it was refused). With it, the sample site plan in the tests is read in under 20 seconds: 4 sides, closing within 0.03 ft, 43,635 sf, its printed setbacks and its street. The office health page line "Chat and plat reader" turns green when the key is in.
2. **The live site is an older build.** `main` is still at fix round 1, and PRs #11 to #14 are open. The north arrow under the lot's name in the screenshot was fixed two rounds ago. Whatever branch Netlify and Render build from, these fixes reach homeowners only once the rounds are merged down to it.

## The walkthrough (real browser, live lookups, 1440 and 390 px, English and Spanish, both chat modes)

Run last, on this branch's build, with `scripts/walkthrough.mjs`: signed in as `drafthouse.test+customerN@example.com`, the lot taken, rooms chosen, seven chat requests, Back, Forward and reload, Send; then `drafter.test@drafthouse.local` confirmed every lot and each homeowner sent. Two customers in each run: one who **uploads only a plat and types no address** (new this round) and one who types a normal address (1201 Kerria Ave, McAllen), as a check that nothing else moved.

| Run | Sessions | Sent | Lots confirmed by the drafter | Page errors | Bad words on a screen | Back, Forward, reload |
|---|---|---|---|---|---|---|
| Basic chat rules, English | 4 | 4 | 4 | 0 | 0 | OK in all 4 |
| Basic chat rules, Spanish | 4 | 4 | 4 | 0 | 0 | OK in all 4 |
| Real Claude key, English | 4 | 4 | 4 | 0 | 0 | OK in all 4 |
| Real Claude key, Spanish | 4 | 4 | 4 | 0 | 0 | OK in all 4 |
| **All** | **16** (312 screens) | **16** | **16** | **0** | **0** | |

"Bad words" are the round 12 and 13 scans (a `$` amount, "setback", "NaN", "undefined", English on a Spanish screen) plus this round's: "Lot 514", "Villa-Rama", "Claude", "Census geocoder" on the lot step.

What the plat-only customer met:

| Chat mode | The plat | The lot step | Then |
|---|---|---|---|
| Basic rules (no key on the server, the live site's state today) | Saved for the drafter in under a second; not read | "Your plat is saved for the drafter", an empty drawing area, "Looks right, pick a style" off. They typed 150 by 260 ft on FM 2360; the lot was drawn (39,000 sf) and the button came on. | Style, rooms, first draft, chat, Send. The drafter's queue: `no address, plat "garza-site-plan.png"`, marked "Plat not read". Confirmed; sent. |
| Real key | Read in about 18 s: 4 sides, closing within 0.03 ft, 43,635 sf, with the reader's own note that it had to infer the bearings (45% confidence) | The outline as read (a curved street side), "A drafter checks this against the plat before anything is built. You can keep going meanwhile." The address printed on the plat was offered in the address field. | The same, on the real outline. Confirmed; sent. |

Sheets, one per session with every screen and its time: `docs/fix-round-14/walkthrough/walk-<mode>[-es]-<width>-<plat|normal>.jpg`, the drafter's cards in `walk-<mode>[-es]-drafter.jpg`, and the words of every screen and chat reply in the four `walkthrough-*.json` files. No sheet shows the page of the plat itself: it prints its owners' names, so the script switches to the drawn outline before each picture.

**After the walkthrough**, three small things it turned up were fixed and are covered by the round 14 tests, not by the sheets: the Send step's "Lot" line was blank for a lot with no address (now "From your plat, no address yet"; the real-key sheets were taken after this, the basic-rules sheets before); the drafter's checklist still said "Read from the plat" for an unread one; and the drafter's queue now shows the address printed on a plat that was read when the homeowner typed none.

Not covered: the walkthrough's plat-only customer did not add an address on the lot step (the round 14 browser test does, against the recorded county answers, not live), and did not sign out midway (the normal-address customer did, as in round 13).

## Checks

| Check | Result |
|---|---|
| `npm test` (recordings, guard on, Postgres up) | 495 tests, 485 pass, 0 fail, 10 skipped (live and dormant billing) |
| `test/round14.test.mjs` | 9 of 9: 4 unit, 1 over HTTP, 4 in a real browser (1440 and 390 px) |
| The same nine against round 13 | Cannot pass: the file imports `platFromTyped` and `edgeLabelOffset`, which do not exist there. The before facts were taken separately on the round 13 build: "Lot 514" shown, "Claude key" shown, "Census geocoder" shown, 15,000 sf shown, the button enabled with no tick, at both widths; the upload 503. |
| `LIVE=1 test/lot.test.mjs`, the plat reader with the real key | 1 of 1 (was failing since round 10, item F) |
| `LIVE=1` acceptance | 2 of 2 |
| Phone audit at 390 px, English and Spanish; translation scan; no-money suite | All pass on this build |
| `vite build` | Clean |
| `npm audit --omit=dev` | 0 vulnerabilities |

## Not done, or less than it should be

- **The plat in the screenshot itself was not tested.** Only its name is in the picture. Everything here was run with the one plat in the repository (a site plan with a curved street side). A scanned survey with small bearings may read worse; when it does, the homeowner now lands on item 4, not on an error.
- **The typed-off-the-plat lot is a rectangle.** A pie lot or a lot with a clipped corner typed as width and depth is only a stand-in; the screen says so and the drafter's card says it in red. The drafter still has no editor for the outline on the card: they confirm, or send it back with a note, as for any plat.
- **A visitor without an account still cannot look an address up.** That is the round 10 decision (the lookups cost the counties and the office); this round only says it calmly.
- **The address a reader finds on the plat is offered, not used.** The homeowner presses "Look it up". Looking it up unasked would spend a county lookup on a guess.
- **Unread plats are kept forever**, like read ones. There is still no clean-up of files whose house was never saved.
- The Spanish for the new lines was written here and has not had a native read (same as round 13).

## Questions for the office

1. `test/fixtures/garza-site-plan.png` (the plat reader's test file since round 7) prints its owners' names in its title block, and the rooms step offers "Garza residence, Rio Grande City" as a recent build. No picture in this report shows the plat's page. Keep both as they are, or black the names out of the file and rename the recent build?
2. The upload limits (8 per account, 20 per address, 30 for all visitors without an account, per ten minutes): right for the office?
3. Should uploading a plat need an account, like the address lookups? It would close the "visitors without an account" bucket entirely.
4. Still open from round 13: tú or usted; a native read of the Spanish; G1 (a plan for pie lots); G3 (the west end of the roof).
