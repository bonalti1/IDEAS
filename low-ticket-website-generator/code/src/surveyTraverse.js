/* ── Survey traverse (metes & bounds) ──
 * Pure geometry: turn a property survey's boundary "calls" (quadrant bearing +
 * distance) into a closed polygon in local feet, so the fence engine can price
 * the EXACT lot a licensed surveyor measured — tighter than a satellite trace
 * or a cadastral parcel. No DOM, no network: node unit-tests it directly
 * (scripts/survey-test.mjs). The AI only READS the calls off the survey image;
 * THIS module does the deterministic math, so a misread can never silently
 * corrupt geometry — the contractor sees the numbers, edits them, and the
 * polygon recomputes here in the open.
 *
 * A call: { ns:'N'|'S', deg, min, sec, ew:'E'|'W', dist }   (dist = feet)
 *   Bearing  S 60°24'00" E   ->   ns:'S', deg:60, min:24, sec:0, ew:'E'
 * Azimuth = clockwise angle from TRUE NORTH (0…360). Because bearings reference
 * true north and the app's satellite map is north-up, the traversed polygon is
 * already correctly ORIENTED on the map — only its POSITION needs anchoring
 * (the existing 🧭 Ajustar lote nudge handles that). Feet are exact regardless.
 */

// One boundary call -> azimuth (deg clockwise from north, 0…360).
export function callAzimuth(c) {
  const a = (Number(c.deg) || 0) + (Number(c.min) || 0) / 60 + (Number(c.sec) || 0) / 3600;
  const ns = String(c.ns || "N").trim().toUpperCase()[0];
  const ew = String(c.ew || "E").trim().toUpperCase()[0];
  if (ns === "N") return ew === "E" ? a % 360 : (360 - a) % 360; // NE : NW
  return ew === "E" ? 180 - a : 180 + a;                         // SE : SW
}

/* Free-text bearing -> {ns,deg,min,sec,ew} (or null). Tolerates the many ways a
 * survey writes it: `S 60°24'00" E`, `S60-24-00E`, `S 60 24 00 E`, `N30E`. */
export function parseBearing(str) {
  const s = String(str || "").toUpperCase().replace(/[^NSEW0-9.]+/g, " ").trim();
  const m = /^([NS])\s*([0-9.]+)(?:\s+([0-9.]+))?(?:\s+([0-9.]+))?\s*([EW])$/.exec(s);
  if (!m) return null;
  return { ns: m[1], deg: +m[2], min: +(m[3] || 0), sec: +(m[4] || 0), ew: m[5] };
}

/* Normalize whatever the extractor returns into clean calls. Accepts either
 * structured {ns,deg,min,sec,ew,dist} rows or {bearing:"S 60°24' E", dist} rows,
 * and drops anything that isn't a real quadrant bearing with a positive length
 * (a stray table header, a curve we can't yet traverse, an OCR smudge). */
export function normalizeCalls(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c) => {
      const dist = Number(c && (c.dist ?? c.distance ?? c.length)) || 0;
      let b = c || {};
      if (b.bearing) { const p = parseBearing(b.bearing); if (p) b = p; }
      const ns = String(b.ns || "").trim().toUpperCase()[0];
      const ew = String(b.ew || "").trim().toUpperCase()[0];
      if (!(ns === "N" || ns === "S") || !(ew === "E" || ew === "W") || !(dist > 0)) return null;
      return { ns, deg: Number(b.deg) || 0, min: Number(b.min) || 0, sec: Number(b.sec) || 0, ew, dist };
    })
    .filter(Boolean);
}

/* Walk the calls from (0,0). Returns the polygon vertices in feet
 * (x = easting, east positive; y = northing, north positive), the perimeter,
 * and the CLOSURE error — how far the last vertex lands from the first. A tidy
 * survey closes to a fraction of a foot; a big closure error means a misread
 * call, so the UI can warn instead of pricing a broken shape. */
export function traverse(calls) {
  const pts = [{ x: 0, y: 0 }];
  let x = 0, y = 0, perim = 0;
  for (const c of calls) {
    const d = Number(c.dist) || 0;
    if (d <= 0) continue;
    const az = (callAzimuth(c) * Math.PI) / 180;
    x += d * Math.sin(az);
    y += d * Math.cos(az);
    perim += d;
    pts.push({ x, y });
  }
  const closureFt = Math.hypot(x, y);
  // drop the closing vertex (≈ the start) so the ring is n DISTINCT corners
  const ring = pts.length > 1 ? pts.slice(0, -1) : pts;
  return { ring, pts, perimFt: perim, closureFt, closurePct: perim ? closureFt / perim : 0 };
}
