/* ── Fence quote engine ──
 * ONE pure module for every surface that prices a fence (app today; widget,
 * estimate doc and measurement sheet as they migrate). No React, no DOM —
 * plain functions over lat/lng runs so node can unit-test the construction
 * math directly (scripts/fence-math-test.mjs).
 *
 * Vocabulary:
 *   run    = one continuous fence line: { pts: [[lat,lng],…], closed? }
 *            closed=true means a loop (full perimeter) — no end terminals.
 *   gate   = { kind: 'walk'|'double'|'custom', widthFt, price?, runIdx? }
 *            A gate SUBTRACTS its opening from fence footage and ADDS its own
 *            price + 2 gate posts. runIdx ties it to a run; when absent
 *            (legacy counter UI) it lands on the longest run.
 *   product= { lfPrice, panelW=8, walkGatePrice=250, dblGatePrice=450 }
 *
 * Post model per run (industry-standard layout, spacing = panelW):
 *   open run:   posts = panels + 1 → 2 terminals, N real corners, rest line.
 *   closed run: posts = panels     → 0 terminals, N real corners, rest line.
 * Corners are REAL direction changes (≥ cornerDeg), never raw vertex count —
 * a cadastral curve of tiny 3° bends must not mint a corner post per vertex.
 */

export const distFt = (a, b) => {
  const k = Math.PI / 180, R = 6378137;
  return Math.hypot((b[1] - a[1]) * k * R * Math.cos(a[0] * k), (b[0] - a[0]) * k * R) * 3.28084;
};

export const runFt = (pts) => {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += distFt(pts[i - 1], pts[i]);
  return s;
};

// SIGNED direction change (degrees, −180…180) at vertex b coming from a and
// going to c, measured in local feet so latitude doesn't distort angles.
// Sign lets a curve accumulate while a zigzag cancels itself out.
const turnDeg = (a, b, c) => {
  const k = Math.PI / 180, cs = Math.cos(b[0] * k);
  const v1 = [(b[1] - a[1]) * cs, b[0] - a[0]];
  const v2 = [(c[1] - b[1]) * cs, c[0] - b[0]];
  const m1 = Math.hypot(v1[0], v1[1]), m2 = Math.hypot(v2[0], v2[1]);
  if (!m1 || !m2) return 0;
  const dot = Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / (m1 * m2)));
  const deg = (Math.acos(dot) * 180) / Math.PI;
  return v1[0] * v2[1] - v1[1] * v2[0] >= 0 ? deg : -deg;
};

/* Count REAL corners in a run. Open runs look at interior vertices only;
 * closed rings wrap around (every vertex is interior).
 * A sharp vertex (≥ cornerDeg) is one corner. Contiguous gentle bends (a
 * surveyed curve) form ONE group: the group's total SIGNED swing decides
 * whether it counts as a single corner — so a 90° street corner drawn as six
 * 15° vertices is ONE corner, a long cul-de-sac arc is ONE, and a wiggly but
 * straight-on-average line is ZERO. */
export function realCorners(pts, closed = false, cornerDeg = 25) {
  const n = pts.length;
  if (n < 3) return 0;
  let corners = 0, acc = 0;
  const flush = () => { if (Math.abs(acc) >= cornerDeg) corners++; acc = 0; };
  const idx = closed ? [...Array(n).keys()] : [...Array(n - 2).keys()].map((i) => i + 1);
  for (const i of idx) {
    const a = pts[(i - 1 + n) % n], b = pts[i], c = pts[(i + 1) % n];
    const t = turnDeg(a, b, c);
    if (Math.abs(t) >= cornerDeg) { flush(); corners++; }
    else if (Math.abs(t) >= 3) acc += t; // part of a curve group
    else flush(); // straight stretch closes any open curve group
  }
  flush();
  return corners;
}

/* Corner POSITIONS on a closed ring (same rules as realCorners: sharp vertex
 * = a corner; an accumulated gentle-curve group = ONE corner at its middle).
 * Used to split a parcel into LOGICAL SIDES — a curved cul-de-sac frontage is
 * one side, not thirty. Returns sorted vertex indexes. */
export function cornerIndexes(pts, cornerDeg = 25) {
  const n = pts.length;
  if (n < 3) return [];
  const out = [];
  let acc = 0, accStart = -1;
  const flush = (endI) => {
    if (Math.abs(acc) >= cornerDeg && accStart >= 0) out.push(((Math.round((accStart + endI) / 2)) % n + n) % n);
    acc = 0; accStart = -1;
  };
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n], b = pts[i], c = pts[(i + 1) % n];
    const t = turnDeg(a, b, c);
    if (Math.abs(t) >= cornerDeg) { flush(i - 1); out.push(i); }
    else if (Math.abs(t) >= 3) { if (accStart < 0) accStart = i; acc += t; }
    else flush(i - 1);
  }
  flush(n - 1);
  return [...new Set(out)].sort((x, y) => x - y);
}

export const DEFAULT_GATE_WIDTH = { walk: 4, double: 10 };

/* The quote. Returns everything a UI, estimate or measurement sheet needs —
 * numbers only, no display strings (the caller owns i18n). */
export function fenceQuote({ runs = [], gates = [], product = {}, markupPct = 0 }) {
  const lfPrice = Number(product.lfPrice) || 0;
  const panelW = Number(product.panelW) > 0 ? Number(product.panelW) : 8;
  const walkP = Number(product.walkGatePrice) || 0;
  const dblP = Number(product.dblGatePrice) || 0;

  const clean = runs
    .map((r) => {
      let pts = r.pts || [];
      let closed = !!r.closed;
      // a loop handed in as [...ring, ring[0]] is closed with a duplicated end
      if (!closed && pts.length > 3 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) {
        pts = pts.slice(0, -1);
        closed = true;
      }
      return { pts, closed, grossFt: closed ? runFt([...pts, pts[0]]) : runFt(pts) };
    })
    .filter((r) => r.pts.length >= 2 && r.grossFt > 0.5);

  // Attach each gate to a run: explicit runIdx wins; legacy counter gates
  // (no position yet) go on the longest run so the opening subtracts somewhere real.
  const longest = clean.reduce((bi, r, i) => (r.grossFt > (clean[bi]?.grossFt || 0) ? i : bi), 0);
  const gateList = gates.map((g) => {
    const widthFt = Number(g.widthFt) > 0 ? Number(g.widthFt) : DEFAULT_GATE_WIDTH[g.kind] || 4;
    const price = g.price != null && g.price !== "" ? Number(g.price) : g.kind === "double" ? dblP : g.kind === "walk" ? walkP : dblP;
    // runIdx -1 = a FREE gate (not sitting on any fence line): it is priced
    // and gets its posts, but subtracts its opening from nothing.
    const runIdx = g.runIdx === -1 ? -1 : Number.isInteger(g.runIdx) && clean[g.runIdx] ? g.runIdx : longest;
    return { kind: g.kind || "walk", widthFt, price, runIdx };
  });

  const perRun = clean.map((r, i) => {
    const gateFt = Math.min(r.grossFt, gateList.filter((g) => g.runIdx === i).reduce((s, g) => s + g.widthFt, 0));
    const netFt = r.grossFt - gateFt;
    // 0.05 ft tolerance: float noise (16.0000000004 ft) must not mint a panel
    const panels = netFt > 0.5 ? Math.ceil((netFt - 0.05) / panelW) : 0;
    const corners = realCorners(r.pts, r.closed);
    const postsTotal = panels > 0 ? (r.closed ? panels : panels + 1) : 0;
    const terminal = r.closed || panels === 0 ? 0 : 2;
    const corner = Math.min(corners, Math.max(0, postsTotal - terminal));
    const line = Math.max(0, postsTotal - terminal - corner);
    return { grossFt: r.grossFt, gateFt, netFt, panels, corners, posts: { line, corner, terminal } };
  });

  const grossFt = Math.round(perRun.reduce((s, r) => s + r.grossFt, 0));
  const gateFt = Math.round(perRun.reduce((s, r) => s + r.gateFt, 0));
  const netFt = Math.round(perRun.reduce((s, r) => s + r.netFt, 0));
  const panels = perRun.reduce((s, r) => s + r.panels, 0);
  const posts = perRun.reduce(
    (s, r) => ({ line: s.line + r.posts.line, corner: s.corner + r.posts.corner, terminal: s.terminal + r.posts.terminal, gate: s.gate }),
    { line: 0, corner: 0, terminal: 0, gate: gateList.length * 2 }
  );
  const corners = perRun.reduce((s, r) => s + r.corners, 0);

  const fenceCost = Math.round(netFt * lfPrice);
  const gatesCost = Math.round(gateList.reduce((s, g) => s + g.price, 0));
  const markupAmt = Math.round((fenceCost + gatesCost) * ((Number(markupPct) || 0) / 100));
  const total = fenceCost + gatesCost + markupAmt;

  return { grossFt, gateFt, netFt, panels, corners, posts,
    postsTotal: posts.line + posts.corner + posts.terminal + posts.gate,
    perRun, gates: gateList, fenceCost, gatesCost, markupAmt, total };
}
