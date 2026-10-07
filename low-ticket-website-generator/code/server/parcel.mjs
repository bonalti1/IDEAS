/* ── Parcel matching (Regrid) — FENCE ACCURATE core ──
 * Own module so the matching states and geometry parsing are unit-testable
 * without booting the server (scripts/parcel-test.mjs runs a local Regrid
 * stub via REGRID_BASE).
 *
 * Contract: parcelLookupV2(lat, lng, {token}) → {
 *   state: 'found' | 'ambiguous' | 'not_found' | 'provider_error' | 'rate_limited',
 *   reason?, candidates: [{ id, path, addr, contains,
 *     raw:  [[lat,lng]…]  7-decimal (~1 cm) — MEASUREMENT geometry, never simplified,
 *     disp: [[lat,lng]…]  ≤40 pts — RENDER geometry only }] }
 *
 * Matching rules (the point is to never silently take features[0]):
 *  - tight radius first (3 m, limit 3); one retry at 30 m only if empty —
 *    rural geocodes land near the road, but a wide hit alone is NEVER auto-
 *    trusted as "found" unless it's the only candidate.
 *  - a parcel that CONTAINS the point beats proximity; exactly one containing
 *    parcel ⇒ found. Several candidates ⇒ ambiguous (containing one listed
 *    first) — the app asks the contractor to tap the right lot.
 *  - MultiPolygon: measure the part that contains the point, else the largest
 *    outer ring (old code silently took coordinates[0][0]).
 *  - provider failure is a STATE, not "this property has no parcel".
 */

const REGRID_BASE = process.env.REGRID_BASE || "https://app.regrid.com";
const LIMIT = 3; // candidate + provider-cost cap (Regrid bills per record)

/* Douglas-Peucker (private copy — index.mjs keeps its own for roofing). */
function simplifyPoly(pts, eps) {
  const dseg = (p, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    if (!dx && !dy) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  };
  const dp = (seg) => {
    if (seg.length < 3) return seg;
    let maxD = 0, idx = 0;
    for (let i = 1; i < seg.length - 1; i++) {
      const d = dseg(seg[i], seg[0], seg[seg.length - 1]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD <= eps) return [seg[0], seg[seg.length - 1]];
    return [...dp(seg.slice(0, idx + 1)).slice(0, -1), ...dp(seg.slice(idx))];
  };
  return dp(pts);
}

// Display ring: capped points for SVG rendering. Measurement always uses raw.
export function displayRing(pts, cap = 40) {
  if (pts.length <= cap) return pts;
  const k = Math.PI / 180, R = 6378137;
  const [la0, ln0] = pts[0], c = Math.cos(la0 * k);
  const m = pts.map(([la, ln]) => [(ln - ln0) * k * R * c, (la - la0) * k * R]);
  let eps = 0.5, out = simplifyPoly(m, eps);
  while (out.length > cap && eps < 10) { eps += 1; out = simplifyPoly(m, eps); }
  return out.map(([x, y]) => [+(la0 + y / (R * k)).toFixed(7), +(ln0 + x / (R * k * c)).toFixed(7)]);
}

export function pointInRing(lat, lng, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i], [yj, xj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const ringArea = (ring) => {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][1] + ring[i][1]) * (ring[j][0] - ring[i][0]);
  return Math.abs(a / 2);
};

// GeoJSON [lng,lat] outer ring → clean [lat,lng] list, closing point dropped, 7dp.
const toRawRing = (coords) => {
  if (!Array.isArray(coords) || coords.length < 4) return null;
  let pts = coords.map(([ln, la]) => [+Number(la).toFixed(7), +Number(ln).toFixed(7)]);
  if (pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts = pts.slice(0, -1);
  return pts.length >= 3 ? pts : null;
};

/* One Regrid feature → one candidate (or null). Handles Polygon and
 * MultiPolygon: the part containing the point wins, else the largest part. */
export function featureToCandidate(f, lat, lng) {
  const g = f?.geometry;
  if (!g) return null;
  let outers = [];
  if (g.type === "Polygon") outers = [g.coordinates?.[0]];
  else if (g.type === "MultiPolygon") outers = (g.coordinates || []).map((poly) => poly?.[0]);
  const rings = outers.map(toRawRing).filter(Boolean);
  if (!rings.length) return null;
  const containing = rings.find((r) => pointInRing(lat, lng, r));
  const raw = containing || rings.reduce((a, b) => (ringArea(b) > ringArea(a) ? b : a));
  const fields = f.properties?.fields || {};
  return {
    id: fields.ll_uuid || f.id || null,
    path: f.properties?.path || null,
    addr: f.properties?.headline || fields.address || null,
    contains: !!containing,
    raw,
    disp: displayRing(raw),
  };
}

export function parseParcels(json, lat, lng) {
  const feats = json?.parcels?.features;
  if (!Array.isArray(feats)) return [];
  return feats.slice(0, LIMIT).map((f) => featureToCandidate(f, lat, lng)).filter(Boolean);
}

export function decide(candidates) {
  if (!candidates.length) return { state: "not_found", candidates: [] };
  const containing = candidates.filter((c) => c.contains);
  if (containing.length === 1) return { state: "found", candidates: [containing[0], ...candidates.filter((c) => !c.contains)] };
  if (candidates.length === 1) return { state: "found", candidates }; // single near-match (rural geocode by the road)
  // several possibilities (or point inside an overlap) — the human decides
  const ordered = [...containing, ...candidates.filter((c) => !c.contains)];
  return { state: "ambiguous", candidates: ordered };
}

/* Cost-control wrapper: persistent cache + in-flight dedupe + metrics.
 * Injected deps (kvGet/kvSet/bump) keep this unit-testable with a fake store.
 *
 *  - cache key: normalized Place ID when available, else lat/lng @5dp.
 *  - only REAL answers are cached (found/ambiguous/not_found, 90 days) — a
 *    provider outage must never be remembered as "no parcel here".
 *  - identical concurrent requests share ONE provider call.
 *  - metrics (day-bucketed): pl_req, pl_cache, pl_found, pl_ambig, pl_none,
 *    pl_err, pl_records (≈ billable parcel records) + rolling latency (kv).
 */
export function makeParcelResolver({ token, kvGet, kvSet, bump, fetchImpl }) {
  const inflight = new Map();
  const CACHE_MS = 90 * 864e5;
  return async function resolve(lat, lng, placeId = null) {
    bump("pl_req");
    if (!token) return { state: "provider_error", reason: "not_configured", candidates: [] };
    const key = `parcel2:${placeId ? `p:${String(placeId).slice(0, 80)}` : `${Number(lat).toFixed(5)},${Number(lng).toFixed(5)}`}`;
    const hit = await kvGet(key, CACHE_MS).catch(() => null);
    if (hit && hit.state) { bump("pl_cache"); return hit; }
    if (inflight.has(key)) return inflight.get(key);
    const p = (async () => {
      const t0 = Date.now();
      const v2 = await parcelLookupV2(lat, lng, { token, fetchImpl }).catch((e) => ({ state: "provider_error", reason: e.message, candidates: [] }));
      bump({ found: "pl_found", ambiguous: "pl_ambig", not_found: "pl_none" }[v2.state] || "pl_err");
      if (v2.candidates?.length) bump("pl_records", v2.candidates.length);
      kvGet("pl_lat").catch(() => null).then((arr) =>
        kvSet("pl_lat", [...(Array.isArray(arr) ? arr : []).slice(-49), Date.now() - t0])).catch(() => {});
      if (["found", "ambiguous", "not_found"].includes(v2.state)) await kvSet(key, v2).catch(() => {});
      return v2;
    })().finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  };
}

export async function parcelLookupV2(lat, lng, { token, fetchImpl = fetch } = {}) {
  if (!token) return { state: "provider_error", reason: "not_configured", candidates: [] };
  const ask = async (radius) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    try {
      const u = `${REGRID_BASE}/api/v2/parcels/point?lat=${lat}&lon=${lng}&radius=${radius}&limit=${LIMIT}&token=${token}`;
      const r = await fetchImpl(u, { signal: ctrl.signal });
      clearTimeout(t);
      if (r.status === 429) return { err: "rate_limited" };
      if (!r.ok) return { err: "provider_error", reason: `http_${r.status}` };
      return { json: await r.json().catch(() => null) };
    } catch (e) {
      clearTimeout(t);
      return { err: "provider_error", reason: e.name === "AbortError" ? "timeout" : e.message };
    }
  };
  // tight first — the parcel under the exact point
  const tight = await ask(3);
  if (tight.err) return { state: tight.err, reason: tight.reason, candidates: [] };
  let candidates = parseParcels(tight.json, lat, lng);
  if (!candidates.length) {
    // rural/imprecise geocode: widen ONCE; still never blind-trust features[0]
    const wide = await ask(30);
    if (wide.err) return { state: wide.err, reason: wide.reason, candidates: [] };
    candidates = parseParcels(wide.json, lat, lng);
  }
  return decide(candidates);
}
