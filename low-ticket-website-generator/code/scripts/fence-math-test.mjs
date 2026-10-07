/* Fence math unit tests — the 7 required construction cases from the FENCE
 * ACCURATE spec. Pure node, no server needed. Run: npm run test:fence
 * (also invoked by scripts/regression.mjs so it guards every commit). */
import { fenceQuote, realCorners, runFt } from "../src/fenceMath.js";

// Build points in feet from a local origin (RGV latitude) so distances are exact.
const LAT0 = 26.38, LNG0 = -98.82;
const K = Math.PI / 180, R = 6378137, FT = 3.28084;
const pt = (ftE, ftN) => [LAT0 + ftN / (K * R * FT), LNG0 + ftE / (K * R * FT * Math.cos(LAT0 * K))];

let fails = 0;
const eq = (name, got, want, tol = 0) => {
  const ok = tol ? Math.abs(got - want) <= tol : got === want;
  console.log(`${ok ? "✓" : "✗"} ${name}: ${got}${ok ? "" : ` (want ${want})`}`);
  if (!ok) fails++;
};

const PROD = { lfPrice: 30, panelW: 8, walkGatePrice: 250, dblGatePrice: 450 };

// 1. One 16-ft open run, 8-ft spacing → 2 panels, 3 posts (2 terminal + 1 line), 0 corners
{
  const q = fenceQuote({ runs: [{ pts: [pt(0, 0), pt(16, 0)] }], product: PROD });
  eq("1 gross 16ft", q.grossFt, 16);
  eq("1 net 16ft", q.netFt, 16);
  eq("1 panels", q.panels, 2);
  eq("1 posts total", q.postsTotal, 3);
  eq("1 terminals", q.posts.terminal, 2);
  eq("1 line posts", q.posts.line, 1);
  eq("1 corners", q.corners, 0);
  eq("1 price", q.total, 480);
}

// 2. Two disconnected 10-ft runs, 8-ft panels → each: 2 panels, 3 posts; independent
{
  const q = fenceQuote({ runs: [{ pts: [pt(0, 0), pt(10, 0)] }, { pts: [pt(0, 50), pt(10, 50)] }], product: PROD });
  eq("2 net 20ft", q.netFt, 20);
  eq("2 panels", q.panels, 4);
  eq("2 posts total", q.postsTotal, 6);
  eq("2 terminals", q.posts.terminal, 4);
  eq("2 runs independent", q.perRun.length, 2);
}

// 3. Closed 32-ft square (8-ft sides) → 4 panels, 4 posts, ALL corners, no terminals
{
  const q = fenceQuote({ runs: [{ pts: [pt(0, 0), pt(8, 0), pt(8, 8), pt(0, 8)], closed: true }], product: PROD });
  eq("3 net 32ft", q.netFt, 32);
  eq("3 panels", q.panels, 4);
  eq("3 corners", q.corners, 4);
  eq("3 posts total", q.postsTotal, 4);
  eq("3 terminals", q.posts.terminal, 0);
  eq("3 line posts", q.posts.line, 0);
}

// 3b. Same square handed in legacy form [...ring, ring[0]] must auto-close
{
  const ring = [pt(0, 0), pt(8, 0), pt(8, 8), pt(0, 8)];
  const q = fenceQuote({ runs: [{ pts: [...ring, ring[0]] }], product: PROD });
  eq("3b auto-closed net", q.netFt, 32);
  eq("3b corners", q.corners, 4);
  eq("3b terminals", q.posts.terminal, 0);
}

// 4. 4-ft walk gate inside a straight 16-ft run → net 12, gate posts 2, gate price added
{
  const q = fenceQuote({ runs: [{ pts: [pt(0, 0), pt(16, 0)] }], gates: [{ kind: "walk" }], product: PROD });
  eq("4 gross", q.grossFt, 16);
  eq("4 gate ft", q.gateFt, 4);
  eq("4 net", q.netFt, 12);
  eq("4 panels (net)", q.panels, 2);
  eq("4 gate posts", q.posts.gate, 2);
  eq("4 fence cost", q.fenceCost, 360);
  eq("4 gates cost", q.gatesCost, 250);
  eq("4 total", q.total, 610);
}

// 5. 12-ft double gate in a 40-ft run → net 28, double price
{
  const q = fenceQuote({ runs: [{ pts: [pt(0, 0), pt(40, 0)] }], gates: [{ kind: "double", widthFt: 12 }], product: PROD });
  eq("5 net", q.netFt, 28);
  eq("5 gates cost", q.gatesCost, 450);
  eq("5 gate posts", q.posts.gate, 2);
  eq("5 panels", q.panels, 4);
}

// 6. Cadastral curve: a 90° street corner drawn as many small bends must be
//    ONE corner, and a gentle arc (tiny bends, long straights between) ZERO.
{
  // six 15° turns = one accumulated 90° corner
  const pts = [pt(0, 0)];
  let ang = 0, x = 0, y = 0;
  for (let i = 0; i < 6; i++) { ang += 15; x += 10 * Math.cos((ang * Math.PI) / 180); y += 10 * Math.sin((ang * Math.PI) / 180); pts.push(pt(x, y)); }
  pts.unshift(pt(-40, 0)); // straight approach
  pts.push(pt(x - 40 * Math.sin(0), y + 40)); // straight exit (roughly upward)
  eq("6 curved 90° = 1 corner", realCorners(pts), 1);
  // old behavior would have been pts.length-2 = 6 fake corners
  const q = fenceQuote({ runs: [{ pts }], product: PROD });
  eq("6 corner posts", q.posts.corner, 1);
  // isolated 4° wiggles separated by straights = 0 corners
  const gentle = [pt(0, 0), pt(30, 0), pt(60, 2), pt(90, 2), pt(120, 4), pt(150, 4)];
  eq("6 gentle wiggles = 0 corners", realCorners(gentle), 0);
}

// 7. Mixed parcel-chain + manual run → totals are the sum of independent runs
{
  const parcelChain = [pt(0, 0), pt(50, 0), pt(50, 30)]; // open L: 80 ft, 1 corner
  const manual = [pt(100, 0), pt(100, 20)]; // 20 ft straight
  const q = fenceQuote({ runs: [{ pts: parcelChain }, { pts: manual }], product: PROD });
  eq("7 net 100ft", q.netFt, 100);
  eq("7 corners", q.corners, 1);
  eq("7 runs", q.perRun.length, 2);
  eq("7 run1 net", Math.round(q.perRun[0].netFt), 80);
  eq("7 run2 net", Math.round(q.perRun[1].netFt), 20);
  eq("7 total", q.total, 3000);
}

// Sanity: runFt symmetry + a gate can never make footage negative
{
  eq("runFt 100ft", Math.round(runFt([pt(0, 0), pt(100, 0)])), 100);
  const q = fenceQuote({ runs: [{ pts: [pt(0, 0), pt(6, 0)] }], gates: [{ kind: "double", widthFt: 12 }], product: PROD });
  eq("gate capped at run length", q.netFt, 0);
  eq("no panels on fully-gated run", q.panels, 0);
}

console.log(fails ? `\n${fails} FENCE MATH TEST(S) FAILED` : "\nALL FENCE MATH TESTS GREEN");
process.exit(fails ? 1 : 0);
