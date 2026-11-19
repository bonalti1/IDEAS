# Deploying Draft House

Three pieces: the office API on Render, the client app on Netlify, the Revit worker at the office. Postgres and file storage live in one Supabase project.

## 1. Supabase (database and files)

1. Create a project at supabase.com (region: US East).
2. Project Settings, Database, Connection string: copy the **Transaction pooler** URI (port 6543). That is `DATABASE_URL`. Put the database password in it.
3. Project Settings, API: copy the project URL (`SUPABASE_URL`) and the **service_role** key (`SUPABASE_SERVICE_KEY`). The service key is server-side only; it never goes to Netlify or the browser.
4. Authentication, Providers: keep Email on, turn off "Confirm email" if you want the first link to sign the client straight in, and under URL Configuration add the Netlify site URL to the redirect allow list (the magic link returns there).
5. Project Settings, API: the **anon** key goes to Netlify as `VITE_SUPABASE_ANON_KEY` with the project URL as `VITE_SUPABASE_URL`. Optional: Project Settings, API, JWT Settings, copy the JWT secret to Render as `SUPABASE_JWT_SECRET` (faster token checks; without it the API uses the project's public keys).
6. Nothing else to create by hand. The API runs its migrations (`server/migrations/*.sql`) at start and creates the private bucket `drafthouse` for files on first start.

To bring the data from the laptop along: `DATABASE_URL=... node scripts/migrate-json-to-pg.mjs server/data/db.json`, then upload `server/data/files/<design>/` folders into the bucket with the same paths (Supabase Studio, Storage).

## 2. Render (office API)

1. Render dashboard, New, Blueprint, pick this repo and branch. `render.yaml` defines the service `drafthouse-office`.
2. Render asks for the secrets marked `sync: false` once. Two keys are generated for you: `DRAFTHOUSE_APP_KEY` and `DRAFTHOUSE_WORKER_KEY` (Environment tab after the first deploy; copy them for steps 3 and 4).
3. After the deploy, open `https://<service>.onrender.com/api/health`: `{"ok":false,...}` until the worker connects is expected. With the app key as `?key=` the full checks show. The Database, File store, API keys and Nightly backup rows must be green by the next morning.

Plan note: the **starter** plan keeps the API awake. On the free plan it sleeps after 15 minutes, every worker heartbeat wakes it slowly and the dashboard will show the worker offline.

## 3. Netlify (client app)

1. Netlify, Add new site, Import from Git, pick this repo and branch. `netlify.toml` sets the build.
2. Site settings, Environment variables: `VITE_API_URL` = the Render URL (no trailing slash), `VITE_API_KEY` = the `DRAFTHOUSE_APP_KEY` value.
3. Back on Render, set `DRAFTHOUSE_APP_ORIGIN` to the Netlify site URL (`https://<site>.netlify.app`, or the custom domain; comma separated for both) and redeploy. Until then CORS is open to any site.

The app key is visible to anyone who opens the site (it is in the built JavaScript). It keeps bots and strangers off the API, it is not a login. Clients sign in with an email link (Supabase Auth); their token goes to the API with every call and decides what they can see.

## 3b. Who is a drafter

Everyone who signs in is a client. `DRAFTHOUSE_DRAFTERS` (comma-separated emails) on Render makes those accounts drafters: they get the Review inbox and the Office dashboard. `DRAFTHOUSE_ADMINS` makes admins, who can also change roles from the API (`POST /api/admin/users/:id/role`). Roles stick in the users table, so an email can be removed from the list later without losing the role.

Without `SUPABASE_URL` the API runs in local sign-in mode: any email signs in at once, no link is sent, and `drafter@drafthouse.local` is a drafter. That is for laptops and tests only; the health row "Client accounts" is red until Supabase is set.

## 4. Office worker

`worker/INSTALL.md`. In `config.json`: `api` = the Render URL, `workerKey` = `DRAFTHOUSE_WORKER_KEY`.

## 5. Alerts and backups

- Worker offline for more than 10 minutes: one email, and one more when it is back. Needs a Resend account (resend.com, free tier is enough): verify the sending domain, create an API key, set `RESEND_API_KEY`, `ALERT_EMAIL_FROM` (on the verified domain), `ALERT_EMAIL_TO` (comma separated). Without these the alert still appears in the dashboard activity and the health row says email is not set.
- One email to the homeowner (round 12): when a drafter confirms a lot for the first time, the homeowner is told "your lot is confirmed" so they can send their plan. It uses the same `RESEND_API_KEY` and `ALERT_EMAIL_FROM`; without them nothing is sent (the Send page still shows the button on its own within 20 seconds). No email goes out when the lot is zoned for something other than a house: the office calls instead. The email carries the address the homeowner typed and no price.
- Nightly backup at 08:00 UTC (2 am Texas): a gzip JSON dump of every table, stored in the Supabase bucket under `backups/`, last 30 kept. "Back up now" on the dashboard runs one; `node scripts/backup-db.mjs` runs one from a shell. Restore with `node scripts/migrate-json-to-pg.mjs backups/db-....json.gz`. Supabase Pro also keeps its own daily snapshots.

## 6. Payments: off. Unused while `BILLING_ENABLED` is off

Since round 8 the client app never talks about money: no prices, no estimate, no billing page, no Stripe Checkout. Plan changes are free to the homeowner and come from an allowance on each plan (10 by default) that the office grants from the review inbox and the dashboard. Cost is covered at the meeting with the office; the app has an "Ask the office to set up my meeting" button that emails `ALERT_EMAIL_TO` and shows in the activity.

The Stripe code (`server/billing.mjs`) is kept dormant behind `BILLING_ENABLED`. With it unset (the default) the billing and pricing routes are not registered (they answer 404), the health list has no "Payments" row and the launch check skips the payment step. Set `BILLING_ENABLED=1` only on Rolando's say-so.

**Unused while `BILLING_ENABLED` is off** (leave the values in Render alone; the office removes them when it is sure):

| Name | Was for |
|---|---|
| `STRIPE_SECRET_KEY` | the Stripe secret key that created Checkout Sessions |
| `STRIPE_WEBHOOK_SECRET` | the webhook signing secret (`whsec_...`) that let a paid session add credits |
| `APP_URL` | where Stripe sent the client back |
| `FREE_CREDITS_PER_ACCOUNT` | credits a new account started with; replaced by `CHANGES_PER_PROJECT` and the dashboard default |

The old account balances are not lost: the first time a plan saved before round 8 is read, any balance left on its owner's account is mapped onto that plan's allowance (logged on the plan and in the activity).

## 7. Parcels, flood, zoning and the rules table (round 7)

The Lot step looks the address up at the county appraisal district (free ArcGIS layers, `server/parcel-sources.mjs`),
reads the FEMA flood zone at a point inside the parcel, and the city zoning district where the city publishes a
layer. Nothing here needs a key:

- `PARCEL_DAILY_CHECK=1` runs the 14 acceptance addresses once a day (Hidalgo, Cameron, Nueces, Willacy and Jim Wells). For each it checks the parcel id, the legal description, the street side's width (within 1 ft of the recorded one), the corner flag, and that an owner and a mailing address came back (yes or no; the values are never stored or logged). It emails `ALERT_EMAIL_TO` when the same address fails two runs in a row, so one bad minute at a county does not page the office. The Sources page shows each failed address with the reason and how many runs it has failed.
  The office dashboard shows the same under Sources, with a "Check now" button.
- The mapped columns (round 10): at start, daily, and on "Check the columns" the server reads each layer's own field
  list and compares it with the columns `server/parcel-sources.mjs` maps (ids, owner, mailing, situs, legal, acres). A
  column a layer does not have shows red on the Sources page and raises an alert: the owner lookup or the parcel
  match fails for that county until the mapping is fixed. `PARCEL_FIELD_CHECK=0` turns the start-up check off.
- The street side of a lot (round 10) is read from the Census TIGERweb roads
  (`tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Transportation/MapServer`, layers 8 and 6, then 2): the edge
  nearest the road that carries the address's street name. When TIGERweb does not answer, the lookup still works and
  the street side falls back to the county address point, then the Census point; the Sources page shows the row red.
- `TRUST_PROXY_HOPS` (rounds 10 and 11): the per-address lookup limit reads `x-forwarded-for` only behind a known
  chain of proxies. It is the visitor's position in that header counted from the right. On Render the chain is
  client, Cloudflare, Render's load balancer, so `render.yaml` sets 3. To confirm it, read one line in the Render
  log: at its first request (and once more at the first request that came through Cloudflare) the API logs

      proxy chain: X-Forwarded-For has 3 entries; CF-Connecting-IP is entry 3 from the right; TRUST_PROXY_HOPS is 3 (right)

  The line carries positions only, never an address. If it ends "(set it to N)", set `TRUST_PROXY_HOPS` to N.
  Until then nobody is locked out by a wrong value: when the entry it picks is an address many visitors share (a
  private address such as a load balancer's, or one of Cloudflare's), the per-address limit is left out and only
  the per-user limit counts. Unset or 0, the header is ignored and the socket's address is used (a laptop).
- `REGRID_API_TOKEN` (optional, paid): the Regrid fallback. Leave it empty. The office turns it on only if the free
  sources fail more than 5% of lookups in a month or the daily check fails three days running. `REGRID_MONTHLY_CAP`
  (default 1500) stops the calls for the month. Never commit a token, and the server never logs one.
- `ASCE_HAZARD_API_KEY` (optional): the ASCE Hazard API for the design wind speed. Without it the app says
  "set by the engineer of record" and a drafter enters each city's speed in the rules table once.
- `CAD_POSTGIS=1` (off): the monthly CAD download into PostGIS, `scripts/cad-import.mjs --plan`. Not scheduled.
- `DRAFTHOUSE_FIXTURES=1`: the server answers parcel, flood and zoning from `test/fixtures/parcels/` instead of the
  internet. For CI and screenshots only; never on Render.
- The parcel, geocode, flood, zoning and wind routes need a signed-in user (round 10 for the last four) and allow
  `PARCEL_LOOKUPS_PER_10MIN` (default 20) lookups of each kind that reach an outside service per user every ten
  minutes, three times that per address; cache hits do not count. Past that the app says to try again
  in ten minutes or type the lot in. The county in `/api/lot/parcel/:county/:propId` is the name or its slug
  (`hidalgo`, `cameron`, `nueces`, `starr`, `willacy`, `jimwells`, `kleberg`, `sanpatricio`).
- Recording the fixtures: `LIVE=1 node scripts/make-parcel-fixtures.mjs` records every case from the live services
  (the Census, the county parcel and address-point layers, TIGERweb roads, FEMA, the city zoning layers) and
  `layers.json` (each layer's field list). It keeps only the mapped columns for ids, legal, situs and acres, never an
  owner or mailing column, cuts an owner's name out of a kept column when it sits inside a legal description, refuses
  to write a file with a person-shaped key, and checks that the recording replays to the live answer. One word after
  the command records only the cases whose name holds it (`... kerria`). `npm run test:live` (or
  `LIVE=1 node --test test/live-acceptance.test.mjs`) runs the ten acceptance addresses against the live services.
  Behind a proxy, put `NODE_USE_ENV_PROXY=1` in front of either.
- `npm test` never reaches a real host (round 10): every test that starts the API starts it on the fixtures, and a
  fetch to a real host throws, naming the host, unless `LIVE=1`.

Don't delete any values from Render; the office does that.

## Every setting

| Where | Name | What |
|---|---|---|
| Render | `DATABASE_URL` | Supabase transaction-pooler URI with password. Without it the API uses `server/data/db.json` (laptop only). |
| Render | `SUPABASE_URL` | `https://<project>.supabase.co` |
| Render | `SUPABASE_SERVICE_KEY` | service_role key. Never in Netlify. |
| Render | `SUPABASE_BUCKET` | `drafthouse` (default) |
| Render | `SUPABASE_JWT_SECRET` | optional; verifies sign-in tokens locally instead of with the project's public keys |
| Render | `DRAFTHOUSE_DRAFTERS`, `DRAFTHOUSE_ADMINS` | comma-separated emails that get the drafter and admin roles |
| Render | `CHANGES_PER_PROJECT` (10) | free changes a new plan starts with; the office dashboard setting overrides it |
| Render | `BILLING_ENABLED` | unset. `1` registers the dormant Stripe routes again (§6) |
| Render | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `APP_URL` | optional and unused while `BILLING_ENABLED` is off (§6) |
| Render | outbound hosts | the API calls api.anthropic.com, geocoding.geo.census.gov, tigerweb.geo.census.gov, hazards.fema.gov, the county parcel servers (gis.rgv911.org, cobgis.brownsvilletx.gov, services, services2, services6 and services8.arcgis.com) and the city zoning servers (gismap.mcallen.net, ccpublicgis.cctexas.com, services3 and services7.arcgis.com); Render allows outbound traffic by default |
| Render | `DRAFTHOUSE_CLAUDE_KEY` | Claude API key for the change interpreter. `ANTHROPIC_API_KEY` is read as a fallback. |
| Render | `DRAFTHOUSE_APP_KEY` | generated; same value as Netlify `VITE_API_KEY` |
| Render | `DRAFTHOUSE_WORKER_KEY` | generated; same value as `workerKey` in the office `config.json` |
| Render | `DRAFTHOUSE_APP_ORIGIN` | Netlify site URL(s). Empty = CORS open. |
| Render | `RESEND_API_KEY`, `ALERT_EMAIL_FROM`, `ALERT_EMAIL_TO` | alert email |
| Render | `BACKUP_HOUR_UTC` (8), `BACKUP_KEEP` (30), `BACKUP_DISABLED` | backup schedule |
| Render | `WORKER_ALERT_MIN` (10) | minutes offline before the alert |
| Render | `INTERPRET_MODEL`, `INTERPRET_TIMEOUT_MS`, `INTERPRET_PRICES` | interpreter model, time limit, prices per million tokens |
| Netlify | `VITE_API_URL` | Render service URL |
| Netlify | `VITE_API_KEY` | = `DRAFTHOUSE_APP_KEY` |
| Netlify | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Supabase project URL and anon key, for the email sign-in link. Without them the app offers local sign-in. |
| Office PC | `config.json` `api`, `workerKey` | Render URL, = `DRAFTHOUSE_WORKER_KEY` |
| Tests | `TEST_DATABASE_URL` | optional; runs the server tests on a real Postgres too (a throwaway database is created and dropped) |

## The customer walkthrough (every round's acceptance, from round 12)

Unit and browser tests passing is not enough on its own. Before a round is reported, the build is used like a customer would use it, in a real browser on this machine, with live county, FEMA and zoning lookups, billing off and no email:

    npx vite build
    node scripts/walkthrough.mjs basic     # the chat's own rules
    node scripts/walkthrough.mjs claude    # the real Claude interpreter; needs DRAFTHOUSE_CLAUDE_KEY in the environment

(`NODE_USE_ENV_PROXY=1` in front on a machine behind a proxy; `OUT=docs/fix-round-N` for the pictures.) It walks a homeowner at 1440 px and at 390 px from sign-in to Send on a normal lot, the curved lot (2002 Kiskadee Ln), the near match (323 N 11th St, Raymondville), the C-2 lot (118 S Cage Blvd, Pharr) and the W/E mismatch (1300 W Nolana Ave), signs out and back in mid-way, and has a drafter confirm the lots and read the review card. It writes a picture per step and `walkthrough-<mode>.json` (what each screen said, every chat reply, page errors, timings). It asserts nothing: someone reads the result, and the round's report carries the pictures and a short customer and drafter rating.

## Running locally

Nothing to set. `npm run office` uses the JSON file and local files with the API open, and the health page says so in red on the API keys row. To try the Postgres path on a laptop: `DATABASE_URL=postgres://localhost/drafthouse npm run office`.
