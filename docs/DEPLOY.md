# Deploying Draft House

Three pieces: the office API on Render, the client app on Netlify, the Revit worker at the office. Postgres and file storage live in one Supabase project.

## 1. Supabase (database and files)

1. Create a project at supabase.com (region: US East).
2. Project Settings, Database, Connection string: copy the **Transaction pooler** URI (port 6543). That is `DATABASE_URL`. Put the database password in it.
3. Project Settings, API: copy the project URL (`SUPABASE_URL`) and the **service_role** key (`SUPABASE_SERVICE_KEY`). The service key is server-side only; it never goes to Netlify or the browser.
4. Nothing else to create by hand. The API runs its migrations (`server/migrations/*.sql`) at start and creates the private bucket `drafthouse` for files on first start.

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

The app key is visible to anyone who opens the site (it is in the built JavaScript). It keeps bots and strangers off the API, it is not a login. Client accounts come in phase 2.

## 4. Office worker

`worker/INSTALL.md`. In `config.json`: `api` = the Render URL, `workerKey` = `DRAFTHOUSE_WORKER_KEY`.

## 5. Alerts and backups

- Worker offline for more than 10 minutes: one email, and one more when it is back. Needs a Resend account (resend.com, free tier is enough): verify the sending domain, create an API key, set `RESEND_API_KEY`, `ALERT_EMAIL_FROM` (on the verified domain), `ALERT_EMAIL_TO` (comma separated). Without these the alert still appears in the dashboard activity and the health row says email is not set.
- Nightly backup at 08:00 UTC (2 am Texas): a gzip JSON dump of every table, stored in the Supabase bucket under `backups/`, last 30 kept. "Back up now" on the dashboard runs one; `node scripts/backup-db.mjs` runs one from a shell. Restore with `node scripts/migrate-json-to-pg.mjs backups/db-....json.gz`. Supabase Pro also keeps its own daily snapshots.

## Every setting

| Where | Name | What |
|---|---|---|
| Render | `DATABASE_URL` | Supabase transaction-pooler URI with password. Without it the API uses `server/data/db.json` (laptop only). |
| Render | `SUPABASE_URL` | `https://<project>.supabase.co` |
| Render | `SUPABASE_SERVICE_KEY` | service_role key. Never in Netlify. |
| Render | `SUPABASE_BUCKET` | `drafthouse` (default) |
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
| Office PC | `config.json` `api`, `workerKey` | Render URL, = `DRAFTHOUSE_WORKER_KEY` |
| Tests | `TEST_DATABASE_URL` | optional; runs the server tests on a real Postgres too (a throwaway database is created and dropped) |

## Running locally

Nothing to set. `npm run office` uses the JSON file and local files with the API open, and the health page says so in red on the API keys row. To try the Postgres path on a laptop: `DATABASE_URL=postgres://localhost/drafthouse npm run office`.
