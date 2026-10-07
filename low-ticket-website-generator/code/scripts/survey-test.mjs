/* Survey traverse unit tests — the deterministic core of "Importar levantamiento".
 * The AI reads bearing+distance calls off a survey image; THIS math turns them
 * into the exact lot polygon the fence engine prices. If these pass, a misread
 * is the only failure mode left — and that lands in the editable review step. */
import { callAzimuth, parseBearing, normalizeCalls, traverse } from "../src/surveyTraverse.js";
import { runFt } from "../src/fenceMath.js";

let fail = 0;
const ok = (n, c) => { if (!c) { console.log(`  ✗ ${n}`); fail++; } };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// ── quadrant bearing → azimuth (clockwise from north) ──
ok("N30E → 30",   near(callAzimuth({ ns: "N", deg: 30, ew: "E" }), 30, 1e-9));
ok("S60E → 120",  near(callAzimuth({ ns: "S", deg: 60, ew: "E" }), 120, 1e-9));
ok("S30W → 210",  near(callAzimuth({ ns: "S", deg: 30, ew: "W" }), 210, 1e-9));
ok("N60W → 300",  near(callAzimuth({ ns: "N", deg: 60, ew: "W" }), 300, 1e-9));
ok("DMS folds in", near(callAzimuth({ ns: "S", deg: 60, min: 24, sec: 0, ew: "E" }), 180 - 60.4, 1e-9));

// ── free-text bearing parsing (the many ways a survey writes it) ──
ok('parses S 60°24\'00" E', (() => { const p = parseBearing('S 60°24\'00" E'); return p && p.ns === "S" && p.deg === 60 && p.min === 24 && p.ew === "E"; })());
ok("parses S60-24-00E",     (() => { const p = parseBearing("S60-24-00E"); return p && p.deg === 60 && p.min === 24; })());
ok("parses N 30 05 20 E",   (() => { const p = parseBearing("N 30 05 20 E"); return p && p.deg === 30 && p.min === 5 && p.sec === 20; })());
ok("rejects garbage",       parseBearing("hello 5") === null);

// ── normalizeCalls: accepts structured + string bearings, drops junk ──
const cleaned = normalizeCalls([
  { ns: "S", deg: 60, min: 24, ew: "E", dist: 55 },
  { bearing: 'N 30°05\'20" E', dist: 114.81 },
  { ns: "S", deg: 0, ew: "E", dist: 0 },        // zero length → dropped
  { header: "row" },                             // not a call → dropped
]);
ok("normalize keeps the 2 real calls", cleaned.length === 2);
ok("normalize parsed the string bearing", cleaned[1].deg === 30 && cleaned[1].min === 5 && cleaned[1].sec === 20);

// ── a clean rectangle traverses and CLOSES to ~0 ──
const rect = normalizeCalls([
  { ns: "S", deg: 60, ew: "E", dist: 55 },   // top
  { ns: "S", deg: 30, ew: "W", dist: 114 },  // right side, going down
  { ns: "N", deg: 60, ew: "W", dist: 55 },   // bottom
  { ns: "N", deg: 30, ew: "E", dist: 114 },  // left side, going up
]);
const tv = traverse(rect);
ok("rectangle has 4 distinct corners", tv.ring.length === 4);
ok("rectangle perimeter = 338 ft", near(tv.perimFt, 338, 1e-6));
ok("rectangle closes to < 0.01 ft", tv.closureFt < 0.01);
ok("rectangle closure ratio ~0", tv.closurePct < 1e-4);

// ── the feet→lat/lng conversion the app uses must round-trip the perimeter ──
// (this is the number the contractor sees; it must equal the survey, not drift)
const FT_PER_DEG = (Math.PI / 180) * 6378137 * 3.28084;
const lat0 = 31.05, lng0 = -97.35;
const toLL = ({ x, y }) => [lat0 + y / FT_PER_DEG, lng0 + x / (FT_PER_DEG * Math.cos(lat0 * Math.PI / 180))];
const ll = tv.ring.map(toLL);
const perimLL = runFt([...ll, ll[0]]);
ok(`lat/lng ring measures 338 ft (got ${perimLL.toFixed(2)})`, near(perimLL, 338, 0.5));

// ── a broken (non-closing) survey is flagged, not silently priced ──
const broken = traverse(normalizeCalls([
  { ns: "S", deg: 60, ew: "E", dist: 55 },
  { ns: "S", deg: 30, ew: "W", dist: 114 },
  { ns: "N", deg: 60, ew: "W", dist: 20 },   // wrong length → won't close
  { ns: "N", deg: 30, ew: "E", dist: 114 },
]));
ok("broken survey flags a large closure error", broken.closurePct > 0.05);

if (fail) { console.log(`\n${fail} SURVEY TEST(S) FAILED`); process.exit(1); }
console.log("✓ survey traverse unit tests");
