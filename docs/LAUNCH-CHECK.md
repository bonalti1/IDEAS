# Launch check (Phase 7)

The whole loop, run on 2026-11-16 against the production build of the app (`vite build`, served by `vite preview`) and the office API started with production settings: both API keys set, CORS locked to the app origin, Postgres, Stripe test mode with a webhook secret, the Claude key. Nothing was deployed to Render or Netlify yet, so this ran on the build machine; the same script runs against the real URLs once they exist (see the end).

Two runs: the lot typed in, and the lot read from the Garza site plan with the drafter confirming it. Screenshots and the raw reports are in `docs/launch-check/typed-lot/` and `docs/launch-check/plat/`.

## The list

| | Step | Result |
|---|---|---|
| 🟢 | Office API answers, health page lists every check | v0.3.0, Postgres, 3 migrations |
| 🟢 | API keys, CORS, Postgres, Stripe webhook secret | all set |
| 🔴 | Client sign-in through Supabase magic link | **not set up**: the run used local sign-in. Rolando creates the Supabase project and sets `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET` (docs/DEPLOY.md, step 1). The code path exists and is unit-tested with signed JWTs, but no real magic-link email has been sent yet. |
| 🟢 | Sign up (name + email) and land on the start page | |
| 🟢 | Enter a lot by address, pick the city, type width and depth | FEMA flood lookup answered: zone X, outside the 1% flood area |
| 🟢 | Enter a lot from the plat PDF/PNG | the office read 4 calls from the Garza site plan (40% confidence, bearings inferred); send was held until a drafter confirmed the lot in the review inbox, then went through |
| 🟢 | Pick a style (Modern Farmhouse) | |
| 🟢 | Set the rooms from the recent build, draft the house | 10 changes on a new account |
| 🟢 | Edit 1 "make the kitchen bigger" | applied by the live interpreter |
| 🟢 | Edit 2 "add an office" | applied |
| 🟢 | Edit 3 "remove the rear porch" | applied |
| 🟢 | Undo one edit | back to version 3, 1 credit returned (7 → 8 left) |
| 🟢 | Pay in test mode | the paid checkout was simulated with a Stripe-signed webhook event: 5 credits added, receipt row on the billing page, 8 → 13 credits |
| 🔴 | Pay through the real Stripe Checkout page | **not run**: no Stripe account keys yet. Rolando creates the account, sets `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`, sets the prices in the office dashboard; then `REAL_STRIPE=1` drives the real Checkout page with card 4242 4242 4242 4242. |
| 🟢 | Send to the drafters | project in review, versions and asks listed |
| 🟢 | Drafter opens the review, sees the three asks with the undone one struck through, approves | Revit job queued |
| 🟢 | Office computer claims the job, uploads the model, client sees "Your Revit model is ready" with working file links | **pretend** office computer (the script plays the worker role with the worker key) |
| 🔴 | Real Revit build on the office computer | **not run**: there is no Windows computer with Revit yet. Rolando follows docs/OFFICE-CHECKLIST.md; then `REAL_WORKER=1` waits for the real build. |
| 🟢 | No JavaScript errors in the client app across the whole run | |
| 🟢 | `npm test` | 51 tests, 49 pass, 2 skipped (live interpreter and live plat read, run with `LIVE=1`), 0 fail, with Postgres |
| 🟢 | IfcOpenShell check on the exported Garza IFC | IFC4, 322 products; geometry built for all 318 that carry any (site, building, storey and the roof assembly are containers), 0 failures |
| 🟢 | Production build | `vite build` clean |

Red items are all things that need an account or a machine only Rolando can provide; none is a code break. Two breaks were found and fixed during the check, both in the check itself (the drafter inbox picked up houses left by earlier runs; each run now signs up its own client and picks its own rows).

Also red on the health page until set up, not part of the client loop: alert email (`RESEND_API_KEY`, `ALERT_EMAIL_TO`, `ALERT_EMAIL_FROM`) and the nightly backup (runs by itself at 08:00 UTC once the API has been up overnight, or "Back up now" in the office dashboard).

## Run it against production

```
APP=https://<netlify site> API=https://<render service> \
APP_KEY=<DRAFTHOUSE_APP_KEY> WORKER_KEY=<DRAFTHOUSE_WORKER_KEY> \
STRIPE_WEBHOOK_SECRET=<whsec_...> \
npm run launch-check -- shots/launch
```

- With Supabase sign-in there is no dev login, so sign the client and the drafter in by hand in the browser first and add `SKIP_SIGNIN=1`; or keep local sign-in for the first production run and switch after.
- `REAL_STRIPE=1` drives the real Stripe Checkout page (test mode card) instead of the signed webhook.
- `REAL_WORKER=1` waits up to 30 minutes for the office computer instead of playing the worker.
- `PLAT=1` reads the lot from `test/fixtures/garza-site-plan.png` (needs the Claude key on the API).

The script prints a green/red line per step, saves a screenshot per step (and one at the point of failure), and writes `launch-report.md` and `launch-report.json` into the output folder. Exit code 1 when anything is red.
