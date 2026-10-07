/* Parcel matching unit tests — runs a local Regrid stub (REGRID_BASE) so the
 * full state machine (found/ambiguous/not_found/provider_error/rate_limited),
 * containment, MultiPolygon handling and the widen-once retry are verified
 * without spending provider quota. Run: npm run test:parcel */
import http from "node:http";

process.env.REGRID_BASE = "http://localhost:5977";
const { parcelLookupV2, parseParcels, pointInRing, decide, makeParcelResolver } = await import("../server/parcel.mjs");

let fails = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "✓" : "✗"} ${name}: ${JSON.stringify(got)}${ok ? "" : ` (want ${JSON.stringify(want)})`}`);
  if (!ok) fails++;
};

// GeoJSON helpers ([lng,lat] order, closed rings) around a base point
const B = { lat: 26.38, lng: -98.82 };
const sq = (cLat, cLng, d = 0.0004) => [
  [cLng - d, cLat - d], [cLng + d, cLat - d], [cLng + d, cLat + d], [cLng - d, cLat + d], [cLng - d, cLat - d],
];
const feat = (rings, props = {}, multi = false) => ({
  id: props.id || "f1",
  geometry: multi ? { type: "MultiPolygon", coordinates: rings.map((r) => [r]) } : { type: "Polygon", coordinates: rings },
  properties: { path: props.path || "/us/tx/hidalgo/x", headline: props.addr || "500 N MAIN ST", fields: { ll_uuid: props.uuid || "uuid-1" } },
});

// ── pure parsing tests (no HTTP) ──
{
  eq("pointInRing inside", pointInRing(B.lat, B.lng, sq(B.lat, B.lng).map(([ln, la]) => [la, ln])), true);
  eq("pointInRing outside", pointInRing(B.lat + 0.01, B.lng, sq(B.lat, B.lng).map(([ln, la]) => [la, ln])), false);

  // Polygon containing the point
  const c1 = parseParcels({ parcels: { features: [feat([sq(B.lat, B.lng)])] } }, B.lat, B.lng);
  eq("polygon parsed", c1.length, 1);
  eq("polygon contains", c1[0].contains, true);
  eq("uuid captured", c1[0].id, "uuid-1");
  eq("raw ring 4 pts", c1[0].raw.length, 4);

  // MultiPolygon: point in the SECOND part — old code took the first blindly
  const mp = parseParcels({ parcels: { features: [feat([sq(B.lat + 0.01, B.lng), sq(B.lat, B.lng)], {}, true)] } }, B.lat, B.lng);
  eq("multipolygon picks containing part", mp[0].contains, true);
  eq("multipolygon ring is the right one", Math.abs(mp[0].raw[0][0] - (B.lat - 0.0004)) < 1e-6, true);

  // decide(): one containing + one neighbor = found (containing first)
  const d1 = decide([{ contains: false, id: "n" }, { contains: true, id: "c" }]);
  eq("decide found picks containing", [d1.state, d1.candidates[0].id], ["found", "c"]);
  // two neighbors, none containing = ambiguous
  eq("decide ambiguous", decide([{ contains: false }, { contains: false }]).state, "ambiguous");
  // two containing (overlap/bad data) = ambiguous, human decides
  eq("decide overlap ambiguous", decide([{ contains: true }, { contains: true }]).state, "ambiguous");
  eq("decide empty", decide([]).state, "not_found");
}

// ── full lookups against the stub ──
const routes = {}; // scenario key (from lat) → handler
const stub = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const lat = u.searchParams.get("lat"), radius = u.searchParams.get("radius");
  const h = routes[lat];
  if (!h) { res.writeHead(500); return res.end("{}"); }
  h(res, radius);
});
await new Promise((r) => stub.listen(5977, r));
const send = (res, feats) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ parcels: { features: feats } })); };

// found: single containing parcel on the tight pass
routes["26.38"] = (res) => send(res, [feat([sq(26.38, -98.82)])]);
// ambiguous: two parcels, neither containing (point on the shared line)
routes["26.4"] = (res) => send(res, [feat([sq(26.401, -98.82)], { uuid: "a" }), feat([sq(26.399, -98.82)], { uuid: "b" })]);
// rural: tight empty, wide returns one near parcel → found (single near-match)
routes["26.5"] = (res, radius) => send(res, radius === "3" ? [] : [feat([sq(26.502, -98.82)], { uuid: "rural" })]);
// not_found: empty at both radii
routes["26.6"] = (res) => send(res, []);
// provider_error: 500
routes["26.7"] = (res) => { res.writeHead(500); res.end("boom"); };
// rate_limited: 429
routes["26.8"] = (res) => { res.writeHead(429); res.end("slow down"); };

const T = "tok";
{
  const r = await parcelLookupV2(26.38, -98.82, { token: T });
  eq("live found", [r.state, r.candidates[0].contains], ["found", true]);
  eq("live found disp ring present", r.candidates[0].disp.length >= 3, true);

  const a = await parcelLookupV2(26.4, -98.82, { token: T });
  eq("live ambiguous", [a.state, a.candidates.length], ["ambiguous", 2]);

  const ru = await parcelLookupV2(26.5, -98.82, { token: T });
  eq("rural widen-once found", [ru.state, ru.candidates[0].id], ["found", "rural"]);

  eq("live not_found", (await parcelLookupV2(26.6, -98.82, { token: T })).state, "not_found");
  eq("live provider_error", (await parcelLookupV2(26.7, -98.82, { token: T })).state, "provider_error");
  eq("live rate_limited", (await parcelLookupV2(26.8, -98.82, { token: T })).state, "rate_limited");
  eq("no token = provider_error", (await parcelLookupV2(26.38, -98.82, {})).state, "provider_error");
}

// ── resolver: cache, in-flight dedupe, metrics, error-not-cached ──
{
  let providerHits = 0;
  const baseHandler = routes["26.38"];
  routes["26.38"] = (res) => { providerHits++; baseHandler(res); };
  let errHits = 0;
  const errHandler = routes["26.7"];
  routes["26.7"] = (res) => { errHits++; errHandler(res); };

  const store = new Map();
  const bumps = {};
  const resolver = makeParcelResolver({
    token: T,
    kvGet: async (k) => (store.has(k) ? store.get(k) : null),
    kvSet: async (k, v) => { store.set(k, v); },
    bump: (ev, by = 1) => { bumps[ev] = (bumps[ev] || 0) + by; },
  });

  // 3 SIMULTANEOUS identical requests → ONE provider call
  const trio = await Promise.all([resolver(26.38, -98.82), resolver(26.38, -98.82), resolver(26.38, -98.82)]);
  eq("dedupe: one provider call for 3 concurrent", providerHits, 1);
  eq("dedupe: all three found", trio.every((r) => r.state === "found"), true);

  // 4th request → cache hit, still one provider call
  const again = await resolver(26.38, -98.82);
  eq("cache: repeat is free", [again.state, providerHits], ["found", 1]);
  eq("metrics: pl_req counts all", bumps.pl_req, 4);
  eq("metrics: pl_cache", bumps.pl_cache, 1);
  eq("metrics: pl_found once", bumps.pl_found, 1);
  eq("metrics: billable records", bumps.pl_records, 1);

  // provider errors are NEVER cached — a retry hits the provider again
  await resolver(26.7, -98.82);
  await resolver(26.7, -98.82);
  eq("error not cached: two attempts = two provider calls", errHits >= 2, true);
  eq("metrics: pl_err", bumps.pl_err, 2);

  // Place ID key beats coordinates (same coords, different placeId = distinct cache rows)
  await resolver(26.38, -98.82, "PLACE_A");
  eq("placeId gets its own cache row", providerHits, 2);
}
stub.close();

console.log(fails ? `\n${fails} PARCEL TEST(S) FAILED` : "\nALL PARCEL TESTS GREEN");
process.exit(fails ? 1 : 0);
