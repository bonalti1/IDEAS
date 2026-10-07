/*
 * ALTO Pro storage layer.
 *
 * Uses Postgres (Supabase) when DATABASE_URL is set; otherwise falls back to
 * a JSON file on disk so local development and demos work with zero setup.
 * Same functions either way — the rest of the server never knows which.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "data", "store.json");
let pool = null; // Postgres when configured
let mem = null;  // JSON fallback
let saveTimer = null;

export const dbKind = () => (pool ? "postgres" : "file");

const newId = () => crypto.randomUUID();
const newToken = () => crypto.randomBytes(24).toString("base64url");

function flushMem() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    // Atomic write: a crash mid-write must not truncate/corrupt store.json
    // (which would silently reset to an empty store on next boot).
    const tmp = FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(mem));
    fs.renameSync(tmp, FILE);
  } catch (e) { console.error("store write failed:", e.message); }
}
function persistMem() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushMem, 300);
}
// Flush pending writes synchronously on shutdown so the last edits aren't lost
// on a deploy (Render sends SIGTERM). No-op in Postgres mode (mem is null).
let flushedOnExit = false;
const flushOnExit = () => { if (flushedOnExit || !mem) return; flushedOnExit = true; clearTimeout(saveTimer); flushMem(); };
process.on("SIGTERM", () => { flushOnExit(); process.exit(0); });
process.on("SIGINT", () => { flushOnExit(); process.exit(0); });
process.on("beforeExit", flushOnExit);

export async function initDb() {
  if (process.env.DATABASE_URL) {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
      max: 5,
    });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS contractors (
        id UUID PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        phone TEXT DEFAULT '',
        data JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        contractor_id UUID REFERENCES contractors(id),
        created_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS invites (
        token TEXT PRIMARY KEY,
        contractor_id UUID REFERENCES contractors(id),
        used BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS app_state (
        contractor_id UUID PRIMARY KEY REFERENCES contractors(id),
        state JSONB DEFAULT '{}',
        updated_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        value JSONB,
        updated_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS metrics (
        day TEXT NOT NULL,
        event TEXT NOT NULL,
        n INTEGER DEFAULT 0,
        PRIMARY KEY (day, event)
      );
      CREATE TABLE IF NOT EXISTS meetings (
        id UUID PRIMARY KEY,
        name TEXT DEFAULT '',
        phone TEXT DEFAULT '',
        outcome TEXT DEFAULT 'scheduled',
        note TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS leads (
        id UUID PRIMARY KEY,
        contractor_id UUID REFERENCES contractors(id),
        name TEXT DEFAULT '',
        phone TEXT DEFAULT '',
        address TEXT DEFAULT '',
        info JSONB DEFAULT '{}',
        status TEXT DEFAULT 'new',
        created_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id UUID PRIMARY KEY,
        slug TEXT DEFAULT '',
        title TEXT NOT NULL,
        note TEXT DEFAULT '',
        status TEXT DEFAULT 'open',
        created_at TIMESTAMPTZ DEFAULT now(),
        done_at TIMESTAMPTZ
      );
    `);
    console.log("db: postgres ready");
  } else {
    // No DATABASE_URL → local JSON file store. On an ephemeral host (Render free
    // tier) this WIPES all data on every deploy/restart. Refuse to boot in that
    // situation only when the operator has opted in via REQUIRE_DB=1 — so this
    // can't surprise-crash a live app that's mid-migration to Postgres.
    if (process.env.REQUIRE_DB === "1") {
      throw new Error("REQUIRE_DB=1 but DATABASE_URL is not set — refusing to boot on the ephemeral file store.");
    }
    console.error("\n⚠️  DATA-LOSS WARNING: no DATABASE_URL set — using the local JSON file store.");
    console.error("⚠️  On Render/ephemeral hosts this ERASES all contractors, jobs, and leads on every");
    console.error("⚠️  deploy or idle spin-down. Set DATABASE_URL (Supabase/Postgres) before real users.\n");
    try { mem = JSON.parse(fs.readFileSync(FILE, "utf8")); }
    catch { mem = { contractors: [], sessions: {}, invites: {}, states: {}, leads: [], metrics: {}, meetings: [], tasks: [] }; }
    mem.meetings = mem.meetings || [];
    mem.tasks = mem.tasks || [];
    console.log("db: json file (set DATABASE_URL for Supabase/Postgres)");
  }
}

export async function createContractor({ name, phone = "", slug }) {
  const id = newId();
  slug = (slug || name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || id.slice(0, 8);
  if (pool) {
    // add a suffix if the slug is taken
    const taken = await pool.query("SELECT 1 FROM contractors WHERE slug=$1", [slug]);
    if (taken.rowCount) slug = `${slug}-${id.slice(0, 4)}`;
    await pool.query("INSERT INTO contractors (id, slug, name, phone) VALUES ($1,$2,$3,$4)", [id, slug, name, phone]);
    return { id, slug, name, phone, data: {} };
  }
  if (mem.contractors.some(c => c.slug === slug)) slug = `${slug}-${id.slice(0, 4)}`;
  const c = { id, slug, name, phone, data: {}, created_at: new Date().toISOString() };
  mem.contractors.push(c);
  persistMem();
  return c;
}

export async function listContractors() {
  if (pool) return (await pool.query("SELECT id, slug, name, phone, data, created_at FROM contractors ORDER BY created_at DESC")).rows;
  return mem.contractors.map(({ id, slug, name, phone, data, created_at }) => ({ id, slug, name, phone, data, created_at }));
}

// Total lead count in a date range (all contractors) — for the command
// center's real cost-per-lead calculator. Mirrors meetingStats' range shape.
export async function leadCountInRange(range = null) {
  if (pool) {
    const { where, args } = rangeWhere(range);
    // archived leads (status='deleted') don't count — a cleared inbox reads 0
    const r = await pool.query(`SELECT COUNT(*)::int AS total FROM leads ${where ? where + " AND" : "WHERE"} (status IS NULL OR status <> 'deleted')`, args);
    return r.rows[0]?.total || 0;
  }
  return memInRange(mem.leads || [], range).filter((l) => l.status !== "deleted").length;
}

/* Per-contractor lead counts for the admin dashboard. */
export async function leadStats() {
  if (pool) {
    const r = await pool.query(
      `SELECT contractor_id, COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS last7,
              MAX(created_at) AS last_at
       FROM leads GROUP BY contractor_id`
    );
    return r.rows;
  }
  const by = {};
  const now = Date.now();
  (mem.leads || []).forEach((l) => {
    const b = by[l.contractor_id] = by[l.contractor_id] || { contractor_id: l.contractor_id, total: 0, last7: 0, last_at: null };
    b.total += 1;
    if (now - new Date(l.created_at).getTime() < 7 * 864e5) b.last7 += 1;
    if (!b.last_at || l.created_at > b.last_at) b.last_at = l.created_at;
  });
  return Object.values(by);
}

/* Closer meetings — logged by the closer, visible to admin. Outcomes:
 * scheduled → no_show / showed / closed. */
export async function addMeeting({ name = "", phone = "", note = "" }) {
  const id = newId();
  if (pool) { await pool.query("INSERT INTO meetings (id, name, phone, note) VALUES ($1,$2,$3,$4)", [id, name, phone, note]); return id; }
  mem.meetings = mem.meetings || [];
  mem.meetings.push({ id, name, phone, note, outcome: "scheduled", created_at: new Date().toISOString() });
  persistMem();
  return id;
}
export async function setMeetingOutcome(id, outcome) {
  if (pool) { await pool.query("UPDATE meetings SET outcome=$2 WHERE id=$1", [id, outcome]); return; }
  const m = (mem.meetings || []).find((x) => x.id === id);
  if (m) { m.outcome = outcome; persistMem(); }
}
export async function setMeetingNote(id, note) {
  if (pool) { await pool.query("UPDATE meetings SET note=$2 WHERE id=$1", [id, note]); return; }
  const m = (mem.meetings || []).find((x) => x.id === id);
  if (m) { m.note = note; persistMem(); }
}

/* Customer-service tasks — assign work tied to a client, track open→done. */
export async function addTask({ slug = "", title = "", note = "" }) {
  const id = newId();
  if (pool) { await pool.query("INSERT INTO tasks (id, slug, title, note) VALUES ($1,$2,$3,$4)", [id, slug, title, note]); return id; }
  mem.tasks = mem.tasks || [];
  mem.tasks.push({ id, slug, title, note, status: "open", created_at: new Date().toISOString(), done_at: null });
  persistMem();
  return id;
}
export async function setTaskStatus(id, status) {
  const done = status === "done";
  if (pool) { await pool.query("UPDATE tasks SET status=$2, done_at=$3 WHERE id=$1", [id, status, done ? new Date().toISOString() : null]); return; }
  const t = (mem.tasks || []).find((x) => x.id === id);
  if (t) { t.status = status; t.done_at = done ? new Date().toISOString() : null; persistMem(); }
}
export async function deleteTask(id) {
  if (pool) { await pool.query("DELETE FROM tasks WHERE id=$1", [id]); return; }
  mem.tasks = (mem.tasks || []).filter((x) => x.id !== id);
  persistMem();
}
export async function listTasks(limit = 200) {
  if (pool) return (await pool.query("SELECT * FROM tasks ORDER BY (status='done'), created_at DESC LIMIT $1", [limit])).rows;
  return (mem.tasks || []).slice().sort((a, b) => (a.status === "done") - (b.status === "done") || (b.created_at > a.created_at ? 1 : -1)).slice(0, limit);
}
function rangeWhere(range, startIdx = 1) {
  const cond = [], args = [];
  const f = range && range.from, t = range && range.to;
  if (f) { args.push(f); cond.push(`created_at >= $${startIdx + args.length - 1}`); }
  if (t) { args.push(t); cond.push(`created_at < $${startIdx + args.length - 1}`); }
  return { where: cond.length ? `WHERE ${cond.join(" AND ")}` : "", args };
}
function memInRange(arr, range) {
  const f = range && range.from, t = range && range.to;
  return arr.filter((m) => (!f || m.created_at >= f) && (!t || m.created_at < t));
}
// Wipe the closer's meeting log (test-era entries) — fresh-start button.
export async function clearMeetings() {
  if (pool) { const r = await pool.query("DELETE FROM meetings"); return r.rowCount; }
  const n = (mem.meetings || []).length;
  mem.meetings = [];
  persistMem();
  return n;
}

export async function listMeetings(limit = 60, range = null) {
  if (pool) {
    const { where, args } = rangeWhere(range);
    args.push(limit);
    return (await pool.query(`SELECT * FROM meetings ${where} ORDER BY created_at DESC LIMIT $${args.length}`, args)).rows;
  }
  return memInRange((mem.meetings || []).slice().reverse(), range).slice(0, limit);
}
export async function meetingStats(range = null) {
  let all;
  if (pool) {
    const { where, args } = rangeWhere(range);
    all = (await pool.query(`SELECT outcome FROM meetings ${where}`, args)).rows;
  } else {
    all = memInRange(mem.meetings || [], range);
  }
  const n = (o) => all.filter((m) => m.outcome === o).length;
  const closed = n("closed");
  const followUp = n("follow_up");
  // follow_up and closed imply the prospect showed up, so both count toward show rate
  return { total: all.length, scheduled: n("scheduled"), noShow: n("no_show"), showed: n("showed") + closed + followUp, closed, followUp, notInterested: n("not_interested") };
}

export async function recentLeads(limit = 15) {
  if (pool) {
    return (await pool.query(
      `SELECT l.id, l.name, l.phone, l.address, l.info, l.status, l.created_at, c.slug, c.name AS contractor_name
       FROM leads l LEFT JOIN contractors c ON c.id = l.contractor_id
       ORDER BY l.created_at DESC LIMIT $1`, [limit]
    )).rows;
  }
  return (mem.leads || []).slice().reverse().slice(0, limit).map((l) => {
    const c = mem.contractors.find((x) => x.id === l.contractor_id) || {};
    return { ...l, slug: c.slug, contractor_name: c.name };
  });
}

export async function getContractor(id) {
  if (pool) return (await pool.query("SELECT * FROM contractors WHERE id=$1", [id])).rows[0] || null;
  return mem.contractors.find(c => c.id === id) || null;
}

export async function getContractorBySlug(slug) {
  if (pool) return (await pool.query("SELECT * FROM contractors WHERE slug=$1", [slug])).rows[0] || null;
  return mem.contractors.find(c => c.slug === slug) || null;
}

// REPLACE the whole data document. Use ONLY when you truly mean to overwrite
// everything (fresh account, reset). For editing a few fields on a live account
// prefer patchContractorData — a whole-document write reads-then-writes and so
// clobbers any field another concurrent request changed in between.
export async function saveContractorData(id, data) {
  if (pool) { await pool.query("UPDATE contractors SET data=$2 WHERE id=$1", [id, data]); return; }
  const c = mem.contractors.find(c => c.id === id);
  if (c) { c.data = data; persistMem(); }
}

// ATOMIC field patch: merge the given top-level keys into data without touching
// any others, so two concurrent patches to different fields both survive (a
// Stripe payStatus write can't be lost under a simultaneous onboarding save).
// A key whose value is `undefined` is DELETED — preserving the old
// `{...data, field: cond || undefined}` idiom that removed a field. Shallow
// merge: patching an object key replaces that whole subtree (callers already
// rebuild whole subtrees like `site`/`profile`, so this matches their intent).
export async function patchContractorData(id, patch) {
  if (!patch || typeof patch !== "object") return;
  const set = {}, del = [];
  for (const [k, v] of Object.entries(patch)) { if (v === undefined) del.push(k); else set[k] = v; }
  if (pool) {
    // (existing || set) then subtract deleted keys — one atomic UPDATE.
    await pool.query(
      "UPDATE contractors SET data = (COALESCE(data,'{}'::jsonb) || $2::jsonb) - $3::text[] WHERE id=$1",
      [id, set, del]);
    return;
  }
  const c = mem.contractors.find(c => c.id === id);
  if (c) { c.data = c.data || {}; Object.assign(c.data, set); for (const k of del) delete c.data[k]; persistMem(); }
}

/* Find a client by the custom domain they connected (host-based routing). */
export async function getContractorByDomain(host) {
  const h = String(host || "").toLowerCase();
  if (!h) return null;
  if (pool) return (await pool.query("SELECT * FROM contractors WHERE lower(data->'site'->>'domain') = $1", [h])).rows[0] || null;
  return mem.contractors.find((c) => String(c.data?.site?.domain || "").toLowerCase() === h) || null;
}

// Permanently remove a contractor and everything tied to it (sessions,
// invites, app state, leads, per-account kv like push subs and reviews,
// and its CS tasks). Admin-only cleanup for test/dead accounts.
export async function deleteContractor(id, slug) {
  if (pool) {
    await pool.query("DELETE FROM sessions WHERE contractor_id=$1", [id]);
    await pool.query("DELETE FROM invites WHERE contractor_id=$1", [id]);
    await pool.query("DELETE FROM app_state WHERE contractor_id=$1", [id]);
    await pool.query("DELETE FROM leads WHERE contractor_id=$1", [id]);
    await pool.query("DELETE FROM kv WHERE key IN ($1,$2)", [`push:${id}`, `rev:${id}`]);
    if (slug) await pool.query("DELETE FROM tasks WHERE slug=$1", [slug]);
    await pool.query("DELETE FROM contractors WHERE id=$1", [id]);
    return true;
  }
  mem.sessions = Object.fromEntries(Object.entries(mem.sessions || {}).filter(([, v]) => v !== id && v?.contractor_id !== id));
  mem.invites = Object.fromEntries(Object.entries(mem.invites || {}).filter(([, v]) => v?.contractor_id !== id));
  if (mem.app_state) delete mem.app_state[id];
  mem.leads = (mem.leads || []).filter((l) => l.contractor_id !== id);
  if (mem.kv) { delete mem.kv[`push:${id}`]; delete mem.kv[`rev:${id}`]; }
  mem.tasks = (mem.tasks || []).filter((t) => t.slug !== slug);
  mem.contractors = (mem.contractors || []).filter((c) => c.id !== id);
  persistMem();
  return true;
}

export async function createInvite(contractorId) {
  const token = newToken();
  if (pool) await pool.query("INSERT INTO invites (token, contractor_id) VALUES ($1,$2)", [token, contractorId]);
  else { mem.invites[token] = { contractor_id: contractorId, used: false }; persistMem(); }
  return token;
}

// Kill every credential for ONE contractor — all sessions (logs out every
// device) and all invite links (old WhatsApp links die). The account and its
// data stay untouched; the admin issues a fresh link right after. This is the
// remedy for a leaked access link: revoke + re-send, no data destroyed.
export async function revokeAccess(contractorId) {
  let sessions = 0, invites = 0;
  if (pool) {
    sessions = (await pool.query("DELETE FROM sessions WHERE contractor_id=$1", [contractorId])).rowCount || 0;
    invites = (await pool.query("DELETE FROM invites WHERE contractor_id=$1", [contractorId])).rowCount || 0;
    return { sessions, invites };
  }
  const sBefore = Object.keys(mem.sessions || {}).length, iBefore = Object.keys(mem.invites || {}).length;
  mem.sessions = Object.fromEntries(Object.entries(mem.sessions || {}).filter(([, v]) => v !== contractorId && v?.contractor_id !== contractorId));
  mem.invites = Object.fromEntries(Object.entries(mem.invites || {}).filter(([, v]) => v?.contractor_id !== contractorId));
  persistMem();
  return { sessions: sBefore - Object.keys(mem.sessions).length, invites: iBefore - Object.keys(mem.invites).length };
}

/* Exchanging an invite creates a session. Invites stay reusable so the same
 * link works if the contractor gets a new phone — it's their key.
 *
 * NO automatic eviction. We tried a rolling device cap and it backfired: every
 * link tap mints a session (one iPhone = 2: Safari + installed PWA), so a few
 * extra taps silently logged the OWNER's phone out and he had to dig up the
 * link again — friction that costs more than sharing does. Sessions now live
 * until the admin acts: /admin flags accounts past the device warning
 * threshold and the 🔄 Revocar accesos button (revokeAccess above) is the
 * manual remedy — kill everything, reissue one fresh link. */
export async function useInvite(token) {
  let contractorId = null;
  if (pool) {
    const r = await pool.query("SELECT contractor_id FROM invites WHERE token=$1", [token]);
    contractorId = r.rows[0]?.contractor_id || null;
  } else {
    contractorId = mem.invites[token]?.contractor_id || null;
  }
  if (!contractorId) return null;
  const session = newToken();
  if (pool) {
    await pool.query("INSERT INTO sessions (token, contractor_id) VALUES ($1,$2)", [session, contractorId]);
  } else {
    mem.sessions[session] = contractorId;
    persistMem();
  }
  return session;
}

export async function getSessionContractor(token) {
  if (!token) return null;
  let id = null;
  if (pool) id = (await pool.query("SELECT contractor_id FROM sessions WHERE token=$1", [token])).rows[0]?.contractor_id || null;
  else id = mem.sessions[token] || null;
  return id ? getContractor(id) : null;
}

/* How many sessions (≈ devices/installs) exist per contractor. A high count
 * flags possible link-sharing — surfaced on admin for an upsell conversation. */
export async function sessionCounts() {
  if (pool) {
    const r = await pool.query("SELECT contractor_id, count(*)::int n FROM sessions GROUP BY contractor_id");
    const m = {}; r.rows.forEach((x) => { m[String(x.contractor_id)] = x.n; }); return m;
  }
  const m = {};
  Object.values(mem.sessions || {}).forEach((id) => { m[String(id)] = (m[String(id)] || 0) + 1; });
  return m;
}

export async function saveState(contractorId, state) {
  if (pool) {
    await pool.query(
      `INSERT INTO app_state (contractor_id, state, updated_at) VALUES ($1,$2,now())
       ON CONFLICT (contractor_id) DO UPDATE SET state=$2, updated_at=now()`,
      [contractorId, state]
    );
    return;
  }
  mem.states[contractorId] = state;
  persistMem();
}

export async function getState(contractorId) {
  if (pool) return (await pool.query("SELECT state FROM app_state WHERE contractor_id=$1", [contractorId])).rows[0]?.state || null;
  return mem.states[contractorId] || null;
}

export async function addLead(contractorId, { name = "", phone = "", address = "", info = {} }) {
  const id = newId();
  if (pool) await pool.query("INSERT INTO leads (id, contractor_id, name, phone, address, info) VALUES ($1,$2,$3,$4,$5,$6)", [id, contractorId, name, phone, address, info]);
  else { mem.leads.push({ id, contractor_id: contractorId, name, phone, address, info, status: "new", created_at: new Date().toISOString() }); persistMem(); }
  return id;
}

// Archive every lead of an account (status='deleted' hides them everywhere
// but keeps the rows) — the pre-ad-launch "empezar en cero" button.
export async function clearLeads(contractorId) {
  if (pool) { const r = await pool.query("UPDATE leads SET status='deleted' WHERE contractor_id=$1 AND (status IS NULL OR status <> 'deleted')", [contractorId]); return r.rowCount; }
  let n = 0;
  for (const l of mem.leads || []) if (l.contractor_id === contractorId && l.status !== "deleted") { l.status = "deleted"; n++; }
  persistMem();
  return n;
}

// Flip a lead's status (new ⇄ contacted; 'deleted' hides it) — used by the
// sales-leads inbox on /admin and /closer.
export async function setLeadStatus(contractorId, id, status) {
  if (pool) await pool.query("UPDATE leads SET status=$3 WHERE id=$1 AND contractor_id=$2", [id, contractorId, status]);
  else { const l = (mem.leads || []).find((x) => x.id === id && x.contractor_id === contractorId); if (l) { l.status = status; persistMem(); } }
}

// Merge extra fields (e.g. the homeowner's stories answer + refined price) into
// an existing lead's info without overwriting what's already there.
export async function updateLeadInfo(contractorId, id, patch = {}) {
  if (pool) await pool.query("UPDATE leads SET info = COALESCE(info,'{}'::jsonb) || $3::jsonb WHERE id = $1 AND contractor_id = $2", [id, contractorId, patch]);
  else { const l = (mem.leads || []).find((x) => x.id === id && x.contractor_id === contractorId); if (l) { l.info = { ...l.info, ...patch }; persistMem(); } }
}

/* Tiny key-value store (e.g., remembering payments that arrived before
 * the account existed). */
export async function kvSet(key, value) {
  if (pool) {
    // node-postgres serializes top-level JS ARRAYS as Postgres array literals
    // (not JSON), which corrupts JSONB writes — push subscriptions and site
    // reviews are arrays. Always hand Postgres explicit JSON text instead.
    await pool.query(
      "INSERT INTO kv (key, value, updated_at) VALUES ($1,$2::jsonb,now()) ON CONFLICT (key) DO UPDATE SET value=$2::jsonb, updated_at=now()",
      [key, JSON.stringify(value)]
    );
    return;
  }
  mem.kv = mem.kv || {};
  mem.kv[key] = { value, at: new Date().toISOString() };
  persistMem();
}

export async function kvGet(key, maxAgeMs = Infinity) {
  if (pool) {
    const r = await pool.query("SELECT value, updated_at FROM kv WHERE key=$1", [key]);
    const row = r.rows[0];
    if (!row) return null;
    if (Date.now() - new Date(row.updated_at).getTime() > maxAgeMs) return null;
    // Heal rows written before the array fix above: a JSONB value that reads
    // back as a string was double-encoded — parse it down to the real value.
    let v = row.value;
    if (typeof v === "string") { try { v = JSON.parse(v); } catch { /* real string value — keep as is */ } }
    return v;
  }
  const row = (mem.kv || {})[key];
  if (!row) return null;
  if (Date.now() - new Date(row.at).getTime() > maxAgeMs) return null;
  return row.value;
}

/* Atomically read-and-delete a kv entry: returns the value (or null) and
 * guarantees it can be consumed only once. Used for pre-account Stripe payment
 * markers so a single payment can never activate two accounts. In Postgres this
 * is a single DELETE … RETURNING; in the JSON store it's read-then-delete in
 * one synchronous tick (the process is single-threaded). */
export async function kvConsume(key, maxAgeMs = Infinity) {
  if (pool) {
    const r = await pool.query("DELETE FROM kv WHERE key=$1 RETURNING value, updated_at", [key]);
    const row = r.rows[0];
    if (!row) return null;
    if (Date.now() - new Date(row.updated_at).getTime() > maxAgeMs) return null;
    let v = row.value;
    if (typeof v === "string") { try { v = JSON.parse(v); } catch { /* real string */ } }
    return v;
  }
  mem.kv = mem.kv || {};
  const row = mem.kv[key];
  if (!row) return null;
  delete mem.kv[key];
  persistMem();
  if (Date.now() - new Date(row.at).getTime() > maxAgeMs) return null;
  return row.value;
}

export async function kvDelete(key) {
  if (pool) { await pool.query("DELETE FROM kv WHERE key=$1", [key]); return; }
  if (mem.kv && key in mem.kv) { delete mem.kv[key]; persistMem(); }
}

/* Delete every kv row whose key starts with prefix; returns how many fell.
 * Callers pass FIXED prefixes only (e.g. "parcel2:") — never user input,
 * since % and _ are LIKE wildcards. */
export async function kvDeletePrefix(prefix) {
  if (pool) {
    const r = await pool.query("DELETE FROM kv WHERE key LIKE $1", [prefix + "%"]);
    return r.rowCount || 0;
  }
  const keys = Object.keys(mem.kv || {}).filter((k) => k.startsWith(prefix));
  for (const k of keys) delete mem.kv[k];
  if (keys.length) persistMem();
  return keys.length;
}

/* Lifetime counter (persists across deploys): increments and returns the new value. */
export async function incrCounter(key) {
  if (pool) {
    const r = await pool.query(
      "INSERT INTO metrics (day, event, n) VALUES ('all',$1,1) ON CONFLICT (day, event) DO UPDATE SET n = metrics.n + 1 RETURNING n",
      [key]
    );
    return Number(r.rows[0].n);
  }
  mem.metrics = mem.metrics || {};
  mem.metrics.all = mem.metrics.all || {};
  const n = (mem.metrics.all[key] || 0) + 1;
  mem.metrics.all[key] = n;
  persistMem();
  return n;
}

/* Funnel counters: one row per day per event, just incremented. */
export async function bumpMetric(event, by = 1) {
  const day = new Date().toISOString().slice(0, 10);
  const n = Math.max(1, Math.round(Number(by) || 1));
  if (pool) {
    await pool.query(
      "INSERT INTO metrics (day, event, n) VALUES ($1,$2,$3) ON CONFLICT (day, event) DO UPDATE SET n = metrics.n + $3",
      [day, event, n]
    );
    return;
  }
  mem.metrics = mem.metrics || {};
  mem.metrics[day] = mem.metrics[day] || {};
  mem.metrics[day][event] = (mem.metrics[day][event] || 0) + n;
  persistMem();
}

// Metrics rows inside an arbitrary date range (ISO bounds, null = open).
export async function getMetricsBetween(fromIso, toIso) {
  const fromD = fromIso ? String(fromIso).slice(0, 10) : null;
  const toD = toIso ? String(toIso).slice(0, 10) : null;
  if (pool) {
    const conds = ["day != 'all'"]; const args = [];
    if (fromD) { args.push(fromD); conds.push(`day >= $${args.length}`); }
    if (toD) { args.push(toD); conds.push(`day <= $${args.length}`); }
    const r = await pool.query(`SELECT day, event, n FROM metrics WHERE ${conds.join(" AND ")} ORDER BY day DESC`, args);
    return r.rows;
  }
  const out = []; const m = mem.metrics || {};
  Object.keys(m).filter((d) => d !== "all" && (!fromD || d >= fromD) && (!toD || d <= toD)).sort().reverse().forEach((d) => {
    Object.entries(m[d]).forEach(([event, n]) => out.push({ day: d, event, n }));
  });
  return out;
}


// Wipe all funnel/visit counters (the admin "empezar de cero" before ads).
export async function clearMetrics() {
  if (pool) { const r = await pool.query("DELETE FROM metrics"); return r.rowCount; }
  const n = Object.keys(mem.metrics || {}).length;
  mem.metrics = {};
  persistMem();
  return n;
}

export async function getMetrics(days = 14) {
  if (pool) {
    const r = await pool.query("SELECT day, event, n FROM metrics WHERE day != 'all' AND day >= to_char(now() - ($1 || ' days')::interval, 'YYYY-MM-DD') ORDER BY day DESC", [String(days)]);
    return r.rows;
  }
  const out = [];
  const m = mem.metrics || {};
  Object.keys(m).filter((d) => d !== "all").sort().reverse().slice(0, days).forEach((d) => {
    Object.entries(m[d]).forEach(([event, n]) => out.push({ day: d, event, n }));
  });
  return out;
}

export async function updateLeadStatus(contractorId, leadId, status) {
  if (pool) { await pool.query("UPDATE leads SET status=$3 WHERE id=$1 AND contractor_id=$2", [leadId, contractorId, status]); return; }
  const l = mem.leads.find(x => x.id === leadId && x.contractor_id === contractorId);
  if (l) { l.status = status; persistMem(); }
}

/* Full business export for the admin's "Descargar respaldo" button — every
 * table a rebuild would need. Sessions/invites (auth tokens) and push
 * subscriptions are deliberately excluded; kv only contributes the review
 * stores (rev:*). */
export async function exportAll() {
  if (pool) {
    const [contractors, states, leads, meetings, tasks, reviews] = await Promise.all([
      pool.query("SELECT id, slug, name, phone, data, created_at FROM contractors ORDER BY created_at"),
      pool.query("SELECT contractor_id, state FROM app_state"),
      pool.query("SELECT * FROM leads ORDER BY created_at"),
      pool.query("SELECT * FROM meetings ORDER BY created_at"),
      pool.query("SELECT * FROM tasks ORDER BY created_at"),
      pool.query("SELECT key, value FROM kv WHERE key LIKE 'rev:%' OR key LIKE 'hq:%' OR key LIKE 'paid:%'"),
    ]);
    return {
      contractors: contractors.rows, states: states.rows, leads: leads.rows,
      meetings: meetings.rows, tasks: tasks.rows, reviews: reviews.rows,
    };
  }
  const reviews = Object.entries(mem.kv || {})
    .filter(([k]) => k.startsWith("rev:") || k.startsWith("hq:") || k.startsWith("paid:"))
    .map(([key, v]) => ({ key, value: v?.value }));
  return {
    contractors: mem.contractors || [],
    states: Object.entries(mem.states || {}).map(([contractor_id, state]) => ({ contractor_id, state })),
    leads: mem.leads || [], meetings: mem.meetings || [], tasks: mem.tasks || [], reviews,
  };
}

// Restore a backup produced by exportAll(). NON-DESTRUCTIVE: it upserts each
// record by its primary key (contractor id, state's contractor_id, lead/meeting/
// task id, kv key), so importing a snapshot rebuilds anything that was lost and
// overwrites those specific rows, but never deletes rows created since the
// backup. Safe to run against a live DB or an empty file store alike. Returns a
// per-table count of rows written.
export async function importAll(dump) {
  if (!dump || typeof dump !== "object") throw new Error("backup vacío o inválido");
  const arr = (x) => (Array.isArray(x) ? x : []);
  const contractors = arr(dump.contractors), states = arr(dump.states),
    leads = arr(dump.leads), meetings = arr(dump.meetings), tasks = arr(dump.tasks),
    reviews = arr(dump.reviews);
  const n = { contractors: 0, states: 0, leads: 0, meetings: 0, tasks: 0, kv: 0 };

  if (pool) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const c of contractors) {
        if (!c?.id || !c?.slug) continue;
        await client.query(
          `INSERT INTO contractors (id, slug, name, phone, data, created_at) VALUES ($1,$2,$3,$4,$5,COALESCE($6,now()))
           ON CONFLICT (id) DO UPDATE SET slug=EXCLUDED.slug, name=EXCLUDED.name, phone=EXCLUDED.phone, data=EXCLUDED.data`,
          [c.id, c.slug, c.name || "", c.phone || "", c.data || {}, c.created_at || null]);
        n.contractors++;
      }
      for (const s of states) {
        if (!s?.contractor_id) continue;
        await client.query(
          `INSERT INTO app_state (contractor_id, state) VALUES ($1,$2)
           ON CONFLICT (contractor_id) DO UPDATE SET state=EXCLUDED.state, updated_at=now()`,
          [s.contractor_id, s.state || {}]);
        n.states++;
      }
      for (const l of leads) {
        if (!l?.id) continue;
        await client.query(
          `INSERT INTO leads (id, contractor_id, name, phone, address, info, status, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,now()))
           ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, phone=EXCLUDED.phone, address=EXCLUDED.address, info=EXCLUDED.info, status=EXCLUDED.status`,
          [l.id, l.contractor_id || null, l.name || "", l.phone || "", l.address || "", l.info || {}, l.status || "new", l.created_at || null]);
        n.leads++;
      }
      for (const m of meetings) {
        if (!m?.id) continue;
        await client.query(
          `INSERT INTO meetings (id, name, phone, outcome, note, created_at) VALUES ($1,$2,$3,$4,$5,COALESCE($6,now()))
           ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, phone=EXCLUDED.phone, outcome=EXCLUDED.outcome, note=EXCLUDED.note`,
          [m.id, m.name || "", m.phone || "", m.outcome || "scheduled", m.note || "", m.created_at || null]);
        n.meetings++;
      }
      for (const t of tasks) {
        if (!t?.id) continue;
        await client.query(
          `INSERT INTO tasks (id, slug, title, note, status, created_at, done_at) VALUES ($1,$2,$3,$4,$5,COALESCE($6,now()),$7)
           ON CONFLICT (id) DO UPDATE SET slug=EXCLUDED.slug, title=EXCLUDED.title, note=EXCLUDED.note, status=EXCLUDED.status, done_at=EXCLUDED.done_at`,
          [t.id, t.slug || "", t.title || "", t.note || "", t.status || "open", t.created_at || null, t.done_at || null]);
        n.tasks++;
      }
      for (const r of reviews) {
        if (!r?.key) continue;
        await client.query(
          `INSERT INTO kv (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`,
          [r.key, r.value ?? null]);
        n.kv++;
      }
      await client.query("COMMIT");
    } catch (e) { await client.query("ROLLBACK"); throw e; }
    finally { client.release(); }
    return n;
  }

  // JSON file store
  mem.contractors = mem.contractors || []; mem.states = mem.states || {};
  mem.leads = mem.leads || []; mem.meetings = mem.meetings || []; mem.tasks = mem.tasks || []; mem.kv = mem.kv || {};
  const upsertById = (list, rec) => { const i = list.findIndex((x) => x.id === rec.id); if (i >= 0) list[i] = { ...list[i], ...rec }; else list.push(rec); };
  for (const c of contractors) { if (!c?.id || !c?.slug) continue; upsertById(mem.contractors, c); n.contractors++; }
  for (const s of states) { if (!s?.contractor_id) continue; mem.states[s.contractor_id] = s.state || {}; n.states++; }
  for (const l of leads) { if (!l?.id) continue; upsertById(mem.leads, l); n.leads++; }
  for (const m of meetings) { if (!m?.id) continue; upsertById(mem.meetings, m); n.meetings++; }
  for (const t of tasks) { if (!t?.id) continue; upsertById(mem.tasks, t); n.tasks++; }
  for (const r of reviews) { if (!r?.key) continue; mem.kv[r.key] = { value: r.value ?? null, at: new Date().toISOString() }; n.kv++; }
  persistMem();
  return n;
}

export async function listLeads(contractorId) {
  if (pool) return (await pool.query("SELECT * FROM leads WHERE contractor_id=$1 AND (status IS NULL OR status <> 'deleted') ORDER BY created_at DESC LIMIT 200", [contractorId])).rows;
  return mem.leads.filter(l => l.contractor_id === contractorId && l.status !== "deleted").slice().reverse();
}
