# Draft House fix round 15: the review of PR #14, and the six-persona walkthrough

Branch `claude/fix-round-15`, on top of `claude/fix-round-14` @4cce6f7. Pictures in `docs/fix-round-15/`: `before/` and `after/` for the screens, `house/` for the house's shape, `walkthrough/` for the six personas, and the two blacked-out plat pictures at the top level.

Source: `draft-house-fix-round-15.md` (the strict review of PR #14 and the real-customer walkthrough of Nov 20), and the three office decisions in it.

In one sentence: uploads now need an account, are limited before the paid read, are readable only by their uploader and the office, and the office record decides whether a plat was read. A homeowner can always press Send. A plat with nothing typed reaches the drafter at once. The chat understands the requests the customers made. The house looks like a Valley one-story instead of a strip.

**Rules kept.**
- No money in the client app.
- 10 free changes per plan; the office grants more.
- No owner names or mailing addresses in code, logs, tests, pictures or this report. The sample plat's names are blacked out (office decision 1). Its file name still carries a surname, and that name no longer reaches any screen (P4); see "Questions".
- No secret is committed or logged.
- Stripe stays in test mode.
- Nothing was merged, pushed to `main` or deployed.
- PRs are no longer watched (office decision 3).

## Office decisions

| # | Decision | What was done | Test (fails before, passes after) | Picture | Status |
|---|---|---|---|---|---|
| 1 | Black out the owner names on the sample plat; rename the recent build | The names on `test/fixtures/garza-site-plan.png` are a solid black box. So are the names in the one committed screenshot that showed the plat page (`docs/launch-check/plat/04-lot.png`; the scan of every committed picture for the plat's navy title block found no other). The untracked copies in `server/data/files/plats/` were overwritten too. The recent build is "Recent build, Rio Grande City" / "Casa reciente, Rio Grande City" on every homeowner screen. The Send step's "set" note no longer says the name, and the old dictionary lines are gone. | `round15-names` (2): the boxes are solid black on both pictures. `round15-screens-rooms`: the old name on no homeowner step, in English or Spanish, at 1440 and 390. | `d1-plat-title-block-names-blacked-out.png`, `d1-launch-check-screenshot-names-blacked-out.png` (a person should look at both) | Done. **The names are still in git history: does the office want it rewritten?** Not done on my own. |
| 2 | Uploading a plat needs an account | `POST /api/lot/plat` is a signed-in route: signed out it is 401 and nothing is stored. The bucket for all visitors without an account is gone. On the first screen, a visitor who picks a plat is asked to sign in right there ("Sign in to send your plat"). The file they picked is kept in the browser meanwhile, also across the emailed sign-in link. Nothing is uploaded before they are signed in, and "Find my lot" waits. "Go on without the plat" drops it. On the lot step, a visitor sees one plain line with a Sign in link instead of a drop zone. A 401 from an old tab reads the same line, never a raw error. | `round15-plats` "D2": 401 signed out, nothing stored, 200 signed in. `round15-lead` "D2 + B5 + P4" at 1440 EN and 390 ES: the sign-in opens with the file kept, no upload request before sign-in, exactly one after, the house in the queue. | `after/lead-d2-signin-1440-en.png`, `after/lead-d2-signin-390-es.png` | Done |
| 3 | Stop watching PRs | No PR is subscribed or polled. This round's PR is opened and left. | n/a | n/a | Done |

## Blockers

| # | Item | What changed | Test (fails before, passes after) | Picture | Status |
|---|---|---|---|---|---|
| B1 | Uploads sent together got round the limit (each is a paid read) | The upload slot is taken **before** the file is read and given back only when the file is refused (400 or 413). There is also a cap per account per day (`PLAT_UPLOADS_PER_DAY`, 30). | `round15-plats` "B1": 12 uploads at once, limit 3, a stand-in reader that takes 3 s: exactly 3 × 200, 9 × 429 and 3 reads. Before: 12 × 200 and 12 reads. "U7: a day cap…". | n/a (HTTP) | Done |
| B2 | "Plat not read" came from the browser | The server rebuilds `lot.plat` from its own record of `plat:<platId>`. A plat lot without a platId, or with one the office does not have, is 400 in plain words. An unread plat is always "Plat not read", whatever the browser sends. A read plat whose outline differs by more than 1 ft from the one read is marked (`outlineGapFt`), and the drafter sees it in red. | `round15-plats` "B2": a forged `unread:false` shows "Plat not read"; a moved corner is marked; an unknown platId is 400; a plat lot with no platId is 400. | `after/lead-u19-card-1440.png` (the card) | Done |
| B3 | Plats readable by anyone with the link; one account could attach another's | `GET /api/lot/plat/:id` needs an account. It opens for the uploader, the owner of a house that uses it, and drafters; anyone else gets 404. It answers with `nosniff`, `inline; filename="plat.<ext>"` and `private, no-store`. Saving a house with another account's platId is 400. The drafter's "Open the plat" fetches it with the token and opens it in a new tab. | `round15-plats` "B3": signed out 401, another homeowner 404, uploader and drafter 200 with the headers; attaching another account's plat 400. | n/a (HTTP) | Done |
| B4 | No Send button until the drafter confirms the lot | Per the office decision, Send is always there. With the lot not confirmed yet, one plain line sits above it: "Our drafter will check your lot first, usually within 1 business day. You don't need to do anything." (ES: "Nuestro dibujante revisa tu lote primero, por lo general en 1 día hábil. No tienes que hacer nada."). Send puts the house in "Waiting for you" as **Lot to confirm + plan**. The drafter cannot approve the plan until the lot is confirmed (409, "Confirm the lot first…"). If confirming changes the lot, the plan goes back to the homeowner with a plain note. | `round15-send` "B4" (HTTP: send 200, the queue mark, approve 409 then 200, the auto-return) and "B4 (screen)". Six older tests that pinned the old dead end were moved to the decision. | walkthrough pictures `*-send.png` | Done |
| B5 | A plat-only homeowner never reached the drafter | The upload saves the house at once with its plat (`platId`). On a house first saved with only its address, the plat is added to that house. The queue row reads "no address · Plat (photo), date" with **Plat not read, nothing typed yet**. The card opens the file and says what to do. | `round15-send` "B5" (HTTP), `round15-lead` "B5 (HTTP)" (address first, then the plat; another account's plat 400) and the D2 + B5 screen test (the house is in the queue after the browser upload). | `after/lead-b5-lot-step-1440-en.png` | Done |
| B6 | "mándale mi lote al dibujante" and "hazla más bonita" not understood | See U2 and B6 below (chat). | | | Done |

## Ugly

| # | Item | What changed | Test (fails before, passes after) | Picture | Status |
|---|---|---|---|---|---|
| U1, U17 | Kiskadee: "Send my lot to the drafter" below the first screen; after sending, "Draft my house" still the big button | The tight-lot card and its button are the first thing on the rooms step. After sending, the confirmation takes the card's place and "Draft my house" becomes an outline button. | `round15-screens-rooms` U1/U17 at 1440 and 390: the button's bottom edge is inside 900 and 844 px. | `before/u1-kiskadee-rooms-first-screen-*.png`, `after/u1-…`, `after/u17-kiskadee-sent-*.png` | Done |
| U2, B6 | The chat missed most ways of asking to send the lot | One reader, `isSendLot` (`src/draft/lib/intents.js`). It takes send/give/pass/hand and mandar/enviar/pasar/dar/entregar with the lot, or the drafter asked to design the house. Please or por favor can go anywhere, question forms work, and accents are optional. The office reads it before any model, puts the lot in the queue and uses no change. | `round15-chat-sendlot`: 20 phrasings (the review's 7 among them) and 8 near-misses, over HTTP, with no key and with Claude stubbed. | | Done |
| U3, U12 | "dos baños y medio" added two full baths | "two and a half baths", "2.5", "2 1/2", "dos baños y medio" and "2 y medio baños" all mean 2 full baths plus a half bath. The Spanish "y" no longer splits it, and it is read before the model in both modes. | `round15-chat-halfbath` (4). | | Done |
| U4, U12, P3 | The first examples failed on a tight lot; "Try a smaller step" | The buttons under the chat are each checked on this plan and lot before they are shown. A refused add gives the real reason in one sentence plus the one thing that works. A refused resize is one sentence plus "the most that fits" as a button, to the quarter foot. | `round15-chat-examples` (5) on Kiskadee and Kerria. | | Done |
| U5, U10 | A tight lot offered a recent build that cannot fit; red bar on first view; tiny card | The recent build is offered only where it fits (footprint first, then rooms, in the worker); where only part of it fits it is offered "Fitted to your lot: …". The size bar is red only for a real problem. The card is larger. The fit starts as soon as the lot is taken. | `round15-screens-rooms` (red-bar watcher; no card on Kiskadee; the fitted card on Kerria with the new name), `round15-screens` unit. | `after/u16-kerria-rooms-*.png` | Done |
| U6 | A misspelled street found nothing | When no parcel is at the typed number on the typed street, a street one letter away is tried at that number ("Kiskade", "Keria"). One such parcel is offered as a near match and shown plainly: "We found 2002 KISKADEE LN MISSION. The street is spelled a little differently from what you typed…". The drafter's queue marks it "Near match". The county comes from the city typed when the address service found nothing. Two letters off is never guessed. A different number is a different street ("10TH" is not a slip of "11TH"; the live run caught this). | `round15-address` (4) and `round15-lead` "U6 (screen)" at 1440 EN and 390 ES. | `after/lead-u6-kiskade-*.png` | Done |
| U7 | Uploads kept forever | An upload no house uses is removed after 30 days (daily, `PLAT_PRUNE=0` turns it off). One a house uses stays. The health page shows the disk ("N files, X MB; uploaded plats: N files, Y MB"). | `round15-plats` "U7" (2). | | Done |
| U8 | "Is this your lot?" drew a 100 × 150 placeholder | While the parcel is looked up the map says "Looking for your lot on the county map…" and draws nothing. Then it draws the parcel's own outline. The typed tab's numbers wait for an answer. | `round15-screens-lot` U8 at 1440 and 390. | `before/u8-…`, `after/u8-is-this-your-lot-*.png` | Done |
| U9 | The house looked like a motel | New **Valley plan** for lots under 66 ft buildable: about 51 × 68 ft (depth/width 1.33, was 1.98 on Kerria), the garage forward, the porch tucked beside it. It has three hip roofs stepping down, a lighter shingle, windows sized by room (an 84 × 60 picture window, a kitchen window over the counter, small bath windows), and plan labels that read at 100% (13 px, were 5). On the Valley plan the kitchen grows, the front porch deepens and a rear porch goes on in place, through the chat. | `round15-house-shape` (10), `round15-house-browser`, `round15-house-grow` (4). | `house/before-*.png`, `house/after-*.png` | Done for 60 to 80 ft lots. **Not reached:** the 100 × 150 lot keeps the garage-forward plan with gables (depth/width 0.82), because the Valley plan there broke 27 pinned tests and hips broke 4 roof rules; 60 ft lots keep the narrow plan. The Valley plan is drawn by the office, not traced from a set: it needs a drafter's sign-off. |
| U11 | Resuming changed the rooms silently | Rooms saved from the rooms step or later come back exactly. The house card says "Rooms chosen, ready to draft". | `round15-screens-rooms` U11 at 1440 and 390. | `after/u11-*.png` | Done |
| U13 | Phone: sign-in two screens down; Draft header 140 px; the house scrolls away | Sign-in follows the logo and promise. On Draft the header is one short row, the view buttons sit on the picture, and the picture stays at the top above the chat. | `round15-screens-phone` (header and tabs ≤ 100 px; the picture stays at the top while chatting). | `before/u13-*.png`, `after/u13-*.png` | Done |
| U14 | The free-changes note always open and run together | One line, "10 free changes; a failed request doesn't use one.", with an info button for the rest. | `round15-screens-phone`, U14 at 1440. | `before/u14-changes-note-1440.png`, `after/u14-*.png` | Done |
| U15 | usted in the chat, English leaks on Spanish screens | The chat says tú everywhere, and a model reply in usted is replaced with the plan's own Spanish. Buttons are tú commands. These are translated: style names, "Área de porches", the county source line, the zoning line, and the plan and site drawings on a Spanish screen. "Plat" and "deslinde" are explained once on the first screen. | `round15-chat-tu` (44 requests on 4 plans, every reply and button), `round15-screens-es` (every word on each Spanish screen at 1440 and 390, on Kerria and Kiskadee). | | Done. **P5 (tú or usted) is the office's to confirm; tú is used throughout.** |
| U16 | "Un lote justo" shown on a lot that fits | "Tight" is worked out from the lot: the default rooms had to be turned, or what fits drops bedrooms, the garage or more than 25% of the size. | `round15-screens-rooms` U16, `round15-screens` unit. | `before/u16-…`, `after/u16-…` | Done |
| U18 | Plat-only screen: huge empty map, tiny address box, city chosen silently, warning above empty fields, no preview | The map takes at most 38% of a wide screen. The address box is full width. The city says "Pick the city" until one is picked, and "Looks right" waits for it. The size request is a calm line. "Your plat is saved for the drafter" shows a small picture of it. | `round15-screens-lot` U18 at 1440 and 390. | `after/u18-plat-only-*.png` (the round 14 pictures showed the uploaded file's name, which carries a surname, so they are not committed) | Done |
| U19 | Drafter: a 55 ft hall the audit passed; confirmations twice; a long card; narrow wrapping rows; rows that look alike | Halls are measured as drawn (a 55 ft hall warns), and the narrow plan's hall is two halls with the kitchen between. The queue is wider, each row on one line. A row reads "Test Customer · 1201 Kerria Ave" and "Nov 21, 3:05 PM (just now)". A house still being drafted reads "Homeowner still drafting". "Confirm lot" and the read zoning are asked once, in the checklist. The plat-not-read, outline-differs, near-match and plat-only marks are on the rows. | `round15-house-halls` (3), `round15-lead` "U19" (two houses of one client told apart, a queue at least 860 px wide, one Confirm lot). | `after/lead-u19-queue-1440.png`, `after/lead-u19-card-1440.png` | Done |

## Polish

| # | Item | What changed | Test | Status |
|---|---|---|---|---|
| P1 | Typed undo answered in English on Spanish requests | Typed undo answers in the request's language, in plain words: "Listo, la casa quedó como estaba. Te devolvimos 1 cambio." It never says "version". | `round15-chat-undo` | Done |
| P2 | "can you undo that?", "ctrl z" | Question forms, "please" and "ctrl z" are undo. | `round15-chat-undo` | Done |
| P3 | A refused size didn't offer the most that fits | See U4. | `round15-chat-examples` | Done |
| P4 | The queue showed the uploaded file's own name | The homeowner and the queue row see "Plat (PDF)" or "Plat (photo)" and the date. The original name is only inside the drafter's card. It is never logged (the log names the platId). | `round15-plats`, `round15-lead` (no file name on any homeowner screen) | Done |
| P5 | tú or usted | Still the office's call; this round uses tú everywhere. | | Waiting on the office |
| P6 | G1 (a pie-lot plan) and G3 (the west end of the roof) | Not started. | | Waiting on the office |
| P (walkthrough) | "same size · 1 change used" vague | The line under a change says what it did: "Rear porch added · same floor area · 1 change used", "Kitchen now 16 × 14 ft". | `round15-screens-phone`, `round15-screens-polish` | Done |
| P (walkthrough) | The 3D view cut off the curved street side | The 3D view holds the house and the lot's street side; the camera steps back until both fit. | `round15-lead` "P (3D)" (fails on round 14: a Kiskadee street point out of the picture) | Done |
| P (walkthrough) | Phone style labels touch; lot sides run together | Fixed: style names no longer touch, and the lot sides are one per line. | `round15-screens-polish` | Done |
| P (walkthrough) | Phone map labels unreadable | The words on the lot map are drawn half as big again on a phone (about 11 px, were 7). | `round15-lead` "P (k02)" | Done |

## Found on the way and fixed

| # | What | What changed | Test |
|---|---|---|---|
| A | The chat never understood "make the kitchen 1 ft longer" in English, though its own buttons say "Make the living room 3.25 ft longer". "2 ft narrower" and "2 ft shorter" shrank the room both ways. "más angosta" did the same. Replies said "1 feet". | "longer" grows the room one way. "narrower", "shorter", "más angosta" and "más corta" shrink it one way. A single foot is "1 foot". | `round15-lead` "chat: 1 ft longer…" |
| B | The street-spelling step (U6) treated "11TH" as a slip of "10TH" and stopped the lookup of 2200 S 10th St, McAllen, before the step that finds it | A different number is a different street, and several near streets let the later steps go on. | `round15-address` unit; the live acceptance run |
| C | On the Valley plan every wall move slid the half bath's pocket door in front of the lavatory, so the audit refused every change near it ("the closet next to it would be left too small") | The door is centred on its wall; the lavatory hangs on the far wall. | `round15-house-grow` |
| D | "We could not find this address" stayed above the lot the county map had just found | Hidden once a parcel is found. | `round15-lead` "U6 (screen)" |
| E | A round 14 test read the ".503" in a timestamp ("…:41.503Z") as a 503 to the homeowner and failed now and then | It looks for 503 as a word. | `round14` "2 and 4" |
| F | The drafter's "Drafting" pill on a house the homeowner is still working on read as if a drafter was drafting | "Homeowner still drafting" in the queue. | `round15-lead` "U19" |

## Tests

- **Full suite** (`TEST_DATABASE_URL=… npm test`, after `vite build`, on the final code): **584 tests, 574 pass, 0 fail, 10 skipped** (the billing and LIVE ones).
- **npm audit:** 0 vulnerabilities (with and without dev dependencies).
- **Fails before:** every new test file was run against round 14 (4cce6f7) and fails there; see each row.
- **Live** (`LIVE=1`, real lookups and the real Claude key):
  - `lot.test` (the plat read on the blacked-out plat), `round12-chat-live` and `round13-chat-es-live` pass.
  - `live-acceptance`: 1 of 2 passes. The other fails on round 14 as well: the county record for the Premont acceptance address no longer has mailing fields. That is an upstream change, not ours; no value was printed.
  - `round10` was included by mistake: its guard and FEMA tests are meant for non-LIVE runs and fail under `LIVE=1` on purpose.

## The walkthrough

Run last, on this branch's final build, with `scripts/personas.mjs`. It uses a real browser, the live county, address and flood lookups, and the real Claude key, and runs at 1440 and 390 px in English and Spanish. Each homeowner runs twice: as the review had them, and at the other width in the other language.
- **Each homeowner** signs in as `drafthouse.test+customerN@example.com`, takes the lot, signs out and back in (Maria, Rosa, Mike), chooses rooms, chats (a typed undo included), and presses Send.
- **Then** `drafter.test@drafthouse.local` opens every row, confirms the lot and opens the plan.

The script scores each run from 10 against the review's own items: a blocker costs 3, an ugly 1, a polish 0.5. The same script ran on round 14 (4cce6f7) for the before scores.

| Persona | Round 14 (before) | Round 15 (after) | What changed for them |
|---|---|---|---|
| Maria, 1201 Kerria Ave, 1440 EN | 0: no Send button (B4), the fake 100 × 150 lot (U8), the recent build under its old name, red bar, run-together note | **10**, sent | The parcel's own outline. The Valley plan with the default rooms. Send is there, with the one line about the lot. "Rear Porch added · same floor area · 1 change used". |
| Maria, 390 ES | 0 | **10**, sent | The same, in Spanish, with tú. "Listo, la casa quedó como estaba. Te devolvimos 1 cambio." |
| Rosa, Kerria, 1440 ES | 0: "hazla más bonita" and "dos baños y medio" not understood, usted/tú mixed | **10**, sent | "dos baños y medio" → 2 full and a half, "en el plano del Valle". "hazla más bonita" → three buttons. |
| Rosa, 390 EN | 0 | **10**, sent | |
| Jose, 2002 Kiskadee Ln, 1440 EN | 0: the drafter button below the screen, the recent build offered where it cannot fit | **10**, sent | The tight-lot card first on the rooms step. "Send my lot to the drafter please" sends it (no change used). The 3D view holds the curved street side. |
| Jose, 390 ES | 0: "mándale mi lote al dibujante" not understood | **10**, sent | "Tu lote ya está con nuestro dibujante." |
| Mike, 2218 Royal Palm Dr, 390 EN | 0: sign-in below the screen, the header 140 px, typed undo | **10**, sent | Sign-in on the first screen. The picture stays above the chat. "can you undo that?" gives the change back. |
| Mike, 1440 ES | 0 | **10**, sent | "¿puedes deshacer eso?" is undo. |
| Ana, plat only, 1440 EN | 4.5 | **10**, sent | With the real key the sample plat is read (the address printed on it, "2554 N. FM 2360"). She signs in first, and the plat goes to the queue with the house. |
| Ana, 390 ES | 3.5 | **10**, sent | |
| Drafter | 7: Ana missing, "Waiting for you (0)" with 7 rows marked DRAFTING | **10** | "Waiting for you (10)", every row marked "Lot to confirm + plan". Every lot confirmed; each card opened with its plan. |

The scores above are the script's, and it only counts the review's items. **My own reading as a customer, of the final pictures and transcripts:**

| Persona | My score | What still is not perfect |
|---|---|---|
| Maria | 8.5 | "add an office" on a plan that already has one adds a **second** office without asking which she meant. The kitchen reply says "roughly 21¾ by 18 feet" and the line under it "Kitchen now 22 × 18 ft" (one rounds, the other does not). |
| Rosa | 8 | "la sala 3 pies más ancha" is refused in one plain sentence ("la entrada de servicio de al lado se quedaría con muy poco espacio") with no button: on the Valley plan the living room cannot get wider at all. It can get longer, and the examples offer that, but the refusal does not say so. |
| Jose | 8.5 | The Kiskadee rooms step offers only one example button ("Add a porch on the back"), because the others do not fit that lot. |
| Mike | 9 | Nothing found. |
| Ana | 8.5 | With the key on, the plat is read, so the "Plat not read" path was not walked by her. The tests walk it without the key. |
| Drafter | 8.5 | The card is shorter, but the floor plan's smallest rooms still need leaders below the drawing (Vestibule, Closet, Linen). |

Pictures: `walkthrough/before/` (round 14) and `walkthrough/after/` (this build), with the step in the file name (`-13-send`, `-14-sent`, `drafter-01-inbox`). The after run's full record (each chat line and reply, the queue rows, which lots were confirmed) is `walkthrough/after/personas.json`. The round 14 record and its rooms-step pictures are not committed: they show the old recent-build name (office decision 1), and the round 14 plat-only pictures show the uploaded file's name. None of the committed pictures shows an owner name, a mailing address or the plat's file name.

The walkthrough ran three times. In the first run, two checks of the script itself were wrong: it read the Send confirmation case-sensitively, but the button is drawn in capitals, and it expected "Plat not read" though the real key reads the plat. It scored 7 everywhere until those were fixed; the app was the same. The second run, on the build before the last 3D and wording changes, also scored 10 everywhere.

## Questions for the office

1. **Git history.** The owner names are blacked out in the image now, but the earlier versions of `test/fixtures/garza-site-plan.png` and `docs/launch-check/plat/04-lot.png` are in git history. Do you want that history rewritten? I did not do it. The fixture's file name also carries a surname. It is no longer shown on any homeowner screen, but it is in test code; renaming it touches about 15 tests. Say if you want that too.
2. **tú or usted (P5).** This round uses tú everywhere, chat included.
3. **G1 and G3 (P6)** are still waiting.
4. **Upload limits.** 8 per account per 10 minutes, 20 per internet address, and 30 per account per day. Uploads no house uses are kept 30 days. Say if any should differ.
5. **The Valley plan** was drawn here, not traced from a set: a drafter should look at it before homeowners see it on 60 to 80 ft lots. The 100 × 150 lot still gets the garage-forward plan with farmhouse gables.
6. **Shrinking a room on Kerria** ("make the kitchen 2 ft narrower") is refused with the audit's own words in a long sentence. Adds and grows were reworked this round; shrinks were not. Say if it matters.
