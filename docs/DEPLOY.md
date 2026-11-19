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

- `PARCEL_DAILY_CHECK=1` runs the three test addresses once a day and emails `ALERT_EMAIL_TO` when a source fails.
  The office dashboard shows the same under Sources, with a "Check now" button.
- `REGRID_API_TOKEN` (optional, paid): the Regrid fallback. Leave it empty. The office turns it on only if the free
  sources fail more than 5% of lookups in a month or the daily check fails three days running. `REGRID_MONTHLY_CAP`
  (default 1500) stops the calls for the month. Never commit a token, and the server never logs one.
- `ASCE_HAZARD_API_KEY` (optional): the ASCE Hazard API for the design wind speed. Without it the app says
  "set by the engineer of record" and a drafter enters each city's speed in the rules table once.
- `CAD_POSTGIS=1` (off): the monthly CAD download into PostGIS, `scripts/cad-import.mjs --plan`. Not scheduled.
- `DRAFTHOUSE_FIXTURES=1`: the server answers parcel, flood and zoning from `test/fixtures/parcels/` instead of the
  internet. For CI and screenshots only; never on Render.

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
| Render | outbound hosts | the API calls api.anthropic.com, geocoding.geo.census.gov and hazards.fema.gov; Render allows outbound traffic by default |
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

## Running locally

Nothing to set. `npm run office` uses the JSON file and local files with the API open, and the health page says so in red on the API keys row. To try the Postgres path on a laptop: `DATABASE_URL=postgres://localhost/drafthouse npm run office`.
