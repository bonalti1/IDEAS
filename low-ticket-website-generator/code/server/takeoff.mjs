/* Linear roof takeoff from the Solar API's elevation raster (DSM).
 *
 * Pure geometry — no network. The caller hands us the DSM + roof mask on the
 * same pixel grid; we cluster roof planes by slope direction, find the lines
 * where planes meet, and classify every line the way a roofer names them:
 *   ridge  — high horizontal line between planes facing away from each other
 *   hip    — high SLOPED line between planes facing away
 *   valley — low line between planes facing toward each other
 *   eave   — outline edge along the bottom of a plane (gutter line)
 *   rake   — outline edge running up the slope (gable end)
 * Everything is v1-honest: straight-line fits, confidence reported, and the
 * caller labels the output BETA until field-validated.
 */

const FT = 3.28084;

/* Cluster roof pixels into planes by aspect (8 compass bins), 4-connected. */
export function computeTakeoff({ dsm, mask, w, h, mPerPx, outlinePx }) {
  const N = w * h;
  const slope = new Float32Array(N);
  const aspect = new Float32Array(N); // radians, direction of DOWNHILL
  const roof = new Uint8Array(N);
  const inb = (x, y) => x >= 0 && y >= 0 && x < w && y < h;
  // Real DSMs are noisy (trees, blur) — smooth before taking gradients, or the
  // roof shatters into dozens of tiny fake planes. Two 3x3 mean passes, masked.
  let sm = dsm;
  for (let pass = 0; pass < 2; pass++) {
    const out = new Float32Array(N);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!mask[i]) { out[i] = sm[i]; continue; }
        let s = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (inb(xx, yy) && mask[yy * w + xx]) { s += sm[yy * w + xx]; n++; }
        }
        out[i] = n ? s / n : sm[i];
      }
    }
    sm = out;
  }
  const at = (x, y) => sm[y * w + x];
  // Per-pixel gradient (central differences) on masked pixels
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      const gx = (at(x + 1, y) - at(x - 1, y)) / (2 * mPerPx);
      const gy = (at(x, y + 1) - at(x, y - 1)) / (2 * mPerPx);
      const s = Math.atan(Math.hypot(gx, gy)); // radians
      slope[i] = s;
      aspect[i] = Math.atan2(-gy, -gx); // downhill direction
      if (s > 0.06 && s < 1.45) roof[i] = 1; // ~3.4°..83° — sloped roof plane
    }
  }
  // Quantize aspect into 8 bins and grow connected components per bin
  const BINS = 8;
  const binOf = (i) => ((Math.round((aspect[i] * BINS) / (2 * Math.PI)) % BINS) + BINS) % BINS;
  const comp = new Int32Array(N).fill(-1);
  const compBin = [];
  const compSize = [];
  let nc = 0;
  const qx = new Int32Array(N), qy = new Int32Array(N);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i0 = y * w + x;
      if (!roof[i0] || comp[i0] !== -1) continue;
      const b = binOf(i0);
      let head = 0, tail = 0;
      qx[tail] = x; qy[tail] = y; tail++;
      comp[i0] = nc;
      let size = 0;
      while (head < tail) {
        const cx = qx[head], cy = qy[head]; head++;
        size++;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx2 = cx + dx, ny2 = cy + dy;
          if (!inb(nx2, ny2)) continue;
          const j = ny2 * w + nx2;
          if (!roof[j] || comp[j] !== -1 || binOf(j) !== b) continue;
          comp[j] = nc;
          qx[tail] = nx2; qy[tail] = ny2; tail++;
        }
      }
      compBin.push(b);
      compSize.push(size);
      nc++;
    }
  }
  // Real-world noise shatters planes into shards. Merge each small fragment
  // into the neighbor it touches most (instead of dropping it and leaving
  // gaps), then keep only substantial planes (~4 m²+).
  const minPx = Math.max(8, Math.round(4 / (mPerPx * mPerPx)));
  for (let iter = 0; iter < 2; iter++) {
    const size = new Array(nc).fill(0);
    for (let i = 0; i < N; i++) if (comp[i] >= 0) size[comp[i]]++;
    const contact = new Map(); // small comp -> Map(neighbor -> touch count)
    const touch = (a, b) => {
      if (!contact.has(a)) contact.set(a, new Map());
      contact.get(a).set(b, (contact.get(a).get(b) || 0) + 1);
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x, a = comp[i];
        if (a < 0) continue;
        for (const [dx, dy] of [[1, 0], [0, 1]]) {
          const xx = x + dx, yy = y + dy;
          if (!inb(xx, yy)) continue;
          const b = comp[yy * w + xx];
          if (b < 0 || b === a) continue;
          if (size[a] < minPx) touch(a, b);
          if (size[b] < minPx) touch(b, a);
        }
      }
    }
    if (!contact.size) break;
    const target = new Array(nc).fill(-1);
    for (const [a, m] of contact) {
      let best = -1, bc = 0;
      for (const [b, c] of m) if (c > bc) { bc = c; best = b; }
      target[a] = best;
    }
    for (let i = 0; i < N; i++) { const c = comp[i]; if (c >= 0 && target[c] >= 0) comp[i] = target[c]; }
  }
  const finalSize = new Array(nc).fill(0);
  for (let i = 0; i < N; i++) if (comp[i] >= 0) finalSize[comp[i]]++;
  const keep = finalSize.map((s) => s >= minPx);
  // Collect boundary pixels between kept plane pairs. The meeting line itself
  // (ridge/valley crease) is near-flat or noisy and often forms a 1–3px gap of
  // unassigned pixels — so reach ACROSS up to 4px to find the neighboring plane.
  const REACH = Math.max(3, Math.round(1 / mPerPx));
  const pairs = new Map(); // "a:b" -> [midpointIndex, ...]
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const a = comp[i];
      if (a < 0 || !keep[a]) continue;
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        for (let r = 1; r <= REACH; r++) {
          const nx2 = x + dx * r, ny2 = y + dy * r;
          if (!inb(nx2, ny2)) break;
          const j = ny2 * w + nx2;
          const b = comp[j];
          if (b === a) break;               // same plane again — no boundary here
          if (b >= 0 && keep[b]) {          // reached a different plane
            const midX = Math.round(x + (dx * r) / 2), midY = Math.round(y + (dy * r) / 2);
            const key = a < b ? `${a}:${b}` : `${b}:${a}`;
            if (!pairs.has(key)) pairs.set(key, []);
            pairs.get(key).push(midY * w + midX);
            break;
          }
          if (!mask[j]) break;              // walked off the roof
          // else: unassigned crease pixel — keep reaching
        }
      }
    }
  }
  // Classify each plane-pair boundary as ridge / hip / valley
  const lines = [];
  for (const [key, px] of pairs) {
    if (px.length < Math.max(5, Math.round(1.8 / mPerPx))) continue; // < ~6 ft — noise
    // Straight-line fit: principal axis through the boundary pixels
    let mx = 0, my = 0;
    for (const i of px) { mx += i % w; my += (i / w) | 0; }
    mx /= px.length; my /= px.length;
    let sxx = 0, sxy = 0, syy = 0;
    for (const i of px) {
      const dx = (i % w) - mx, dy = ((i / w) | 0) - my;
      sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
    }
    const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const ux = Math.cos(ang), uy = Math.sin(ang);
    let tMin = Infinity, tMax = -Infinity;
    for (const i of px) {
      const t = ((i % w) - mx) * ux + (((i / w) | 0) - my) * uy;
      if (t < tMin) tMin = t;
      if (t > tMax) tMax = t;
    }
    const planM = (tMax - tMin) * mPerPx;
    if (planM < 1.8) continue; // shorter than ~6 ft — dormers/noise, not takeoff lines
    const pA = [mx + ux * tMin, my + uy * tMin];
    const pB = [mx + ux * tMax, my + uy * tMax];
    // High line (ridge/hip) or low line (valley)? Sample elevation along the
    // fitted line vs. offsets perpendicular to it — a valley sits BELOW both
    // sides, a ridge/hip sits above. (The crease pixels' own slope direction
    // is unreliable, so never use it for this.)
    const [nxp, nyp] = [-uy, ux];
    let hiVotes = 0, loVotes = 0;
    for (let s = 1; s <= 7; s++) {
      const tt = tMin + ((tMax - tMin) * s) / 8;
      const cx2 = mx + ux * tt, cy2 = my + uy * tt;
      const zi = (xx, yy) => {
        const xr = Math.round(xx), yr = Math.round(yy);
        return inb(xr, yr) && mask[yr * w + xr] ? sm[yr * w + xr] : null;
      };
      const zb = zi(cx2, cy2);
      const z1 = zi(cx2 + nxp * 3, cy2 + nyp * 3);
      const z2 = zi(cx2 - nxp * 3, cy2 - nyp * 3);
      if (zb == null || z1 == null || z2 == null) continue;
      const side = (z1 + z2) / 2;
      if (zb < side - 0.01) loVotes++;
      else if (zb > side + 0.01) hiVotes++;
    }
    const isHigh = hiVotes >= loVotes;
    const zA = sm[Math.min(N - 1, Math.max(0, Math.round(pA[1]) * w + Math.round(pA[0])))];
    const zB = sm[Math.min(N - 1, Math.max(0, Math.round(pB[1]) * w + Math.round(pB[0])))];
    const dz = Math.abs((zA || 0) - (zB || 0));
    const len3d = Math.hypot(planM, dz);
    let type;
    if (!isHigh) type = "valley";
    else type = dz / planM < 0.18 ? "ridge" : "hip"; // ridges run level
    lines.push({ t: type, a: pA, b: pB, ft: Math.round(len3d * FT) });
  }
  // Keep the diagram readable: longest lines first, capped
  lines.sort((a, b) => b.ft - a.ft);
  if (lines.length > 16) lines.length = 16;
  // Outline edges → eave vs rake, from the adjacent plane's downhill direction
  const outlineTypes = [];
  let eaveFt = 0, rakeFt = 0;
  if (Array.isArray(outlinePx) && outlinePx.length >= 3) {
    for (let e = 0; e < outlinePx.length; e++) {
      const p1 = outlinePx[e], p2 = outlinePx[(e + 1) % outlinePx.length];
      const ex = p2[0] - p1[0], ey = p2[1] - p1[1];
      const elen = Math.hypot(ex, ey) || 1;
      const [ux2, uy2] = [ex / elen, ey / elen];
      // Sample the plane just inside the roof at several points along the edge
      // (the midpoint alone can land on the flat ridge crease on gable ends).
      let rakeVotes = 0, eaveVotes = 0, slp = 0, slpN = 0;
      for (const tFrac of [0.25, 0.5, 0.75]) {
        const mx2 = p1[0] + ex * tFrac, my2 = p1[1] + ey * tFrac;
        let asp = null;
        for (const side of [1, -1]) {
          for (const d of [2, 4, 6, 8]) {
            const sx = Math.round(mx2 + side * -uy2 * d), sy = Math.round(my2 + side * ux2 * d);
            if (inb(sx, sy) && roof[sy * w + sx]) { asp = aspect[sy * w + sx]; slp += slope[sy * w + sx]; slpN++; break; }
          }
          if (asp != null) break;
        }
        if (asp == null) continue;
        const dot = Math.abs(ux2 * Math.cos(asp) + uy2 * Math.sin(asp));
        if (dot > 0.5) rakeVotes++; else eaveVotes++; // slope runs along the edge → rake
      }
      slp = slpN ? slp / slpN : 0;
      const planFt = elen * mPerPx * FT;
      const type = rakeVotes > eaveVotes ? "rake" : "eave";
      outlineTypes.push(type);
      if (type === "rake") rakeFt += planFt / Math.cos(slp || 0); // true length up the slope
      else eaveFt += planFt;
    }
  }
  const totals = { eave: Math.round(eaveFt), rake: Math.round(rakeFt), ridge: 0, hip: 0, valley: 0 };
  for (const l of lines) totals[l.t === "ridge" ? "ridge" : l.t === "hip" ? "hip" : "valley"] += l.ft;
  // Confidence: how much of the mask did we manage to explain with planes?
  let maskPx = 0, roofPx = 0;
  for (let i = 0; i < N; i++) { if (mask[i]) { maskPx++; if (roof[i] && comp[i] >= 0 && keep[comp[i]]) roofPx++; } }
  const coverage = maskPx ? roofPx / maskPx : 0;
  return { totals, lines, outlineTypes, coverage: +coverage.toFixed(2) };
}
