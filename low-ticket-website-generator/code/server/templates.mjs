/*
 * ALTO Pro website factory — the 3 client templates.
 *
 * Every client site is RENDERED FROM DATA through these battle-tested
 * templates; no code is ever generated per client. Improve a template
 * here and every client site improves instantly.
 *
 * Sold to clients as Opción 1 / 2 / 3 (proven layouts, customized with
 * their colors, logo and photos). Internal design languages:
 *   1 · editorial serif, hairlines, cream bands — quiet luxury
 *   2 · condensed poster, dark, outline numerals — high energy
 *   3 · warm white, soft cards, rounded — family trust
 */

const esc = (s) => String(s || "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));

// Web fonts load WITHOUT blocking parsing or scripts (media="print" swap):
// if the fonts CDN is slow the page still renders instantly in system fonts.
export const fontLink = (href) => `<link rel="stylesheet" href="${href}" media="print" onload="this.media='all'">`;

const pretty = (d) => (String(d).length === 10 ? `(${String(d).slice(0, 3)}) ${String(d).slice(3, 6)}-${String(d).slice(6)}` : d);

// darken/lighten a hex color (f < 0 darkens)
function shade(hex, f) {
  const m = /^#?([a-f0-9]{6})$/i.exec(String(hex).trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = (x) => Math.max(0, Math.min(255, Math.round(x + (f < 0 ? x * f : (255 - x) * f))));
  const r = ch((n >> 16) & 255), g = ch((n >> 8) & 255), b = ch(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

const DEFAULT_SERVICES = [
  ["🏠", "Reemplazo de techo", "Teja arquitectónica, metal o teja de barro. Trabajo limpio, rápido y con garantía por escrito."],
  ["🔧", "Reparaciones", "Goteras, tejas voladas por el viento, flasheo. Respuesta el mismo día cuando es posible."],
  ["🌪️", "Reclamos de seguro", "Te acompañamos en la inspección y el papeleo después de granizo o tormenta."],
  ["🔍", "Inspección gratuita", "Revisamos tu techo y te decimos la verdad — aunque no necesites nada todavía."],
];

const FENCE_SERVICES = [
  ["🪵", "Cerca de madera", "Cedro de calidad, postes bien anclados y acabado parejo. Trabajo limpio y con garantía por escrito."],
  ["⬜", "Cerca de vinilo", "Sin pintura y sin mantenimiento — se ve nueva por años, aguante el sol que aguante."],
  ["🔗", "Malla ciclónica", "La opción fuerte y económica para patios, negocios y terrenos grandes."],
  ["🚪", "Portones", "Sencillos, dobles o automáticos — a la medida de tu entrada y a juego con tu cerca."],
];

/* Every hardcoded phrase in the templates that says what the business DOES
 * comes from this table, keyed by d.trade — the layouts never change, only
 * the words. Roofing stays byte-for-byte what it always was. */
const TRADE_WORDS = {
  roofing: {
    kickUp: "TECHOS RESIDENCIALES", kickSent: "Techos residenciales", pill3: "🏠 Techos residenciales",
    hero1: `Un techo que protege<br>lo que <em>más importa</em>`,
    hero2: `Techos <em>fuertes.</em><br>Hechos bien.`,
    hero3: `Tu casa, protegida.<br><em>Tu familia, tranquila.</em>`,
    tag1: "Reemplazo y reparación de techos con garantía por escrito. Cotiza el tuyo ahora mismo, medido por satélite — sin que nadie te visite.",
    tag2: "Reemplazo y reparación con garantía por escrito. Cotiza tu techo en 60 segundos — medido por satélite, sin visitas.",
    tag3: "Reemplazo y reparación de techos con garantía por escrito — cotiza el tuyo aquí mismo, sin que nadie te visite.",
    wSub1: "Escribe tu dirección y mira tu techo medido por satélite, con tu precio estimado. Gratis y sin compromiso.",
    qLab2: "Cotización satelital",
    wLead2: "Escribe tu dirección. El satélite mide tu techo y te da el precio estimado al instante. Gratis, sin compromiso, sin esperar a nadie.",
    qTag3: "Cotiza tu techo aquí — gratis",
    bar2: "🛰️ Cotiza gratis",
    galAlt: "Trabajo de techo por",
    cta1: `¿Listo para un techo<br><em>hecho bien?</em>`,
    procesoH: `Del precio al techo, <em>sin sorpresas</em>`,
    insp: "Inspección gratis",
    chatTopic: "techo",
    icon: "🏠",
  },
  fence: {
    kickUp: "CERCAS RESIDENCIALES", kickSent: "Cercas residenciales", pill3: "🪵 Cercas residenciales",
    hero1: `Una cerca que cuida<br>lo que <em>más importa</em>`,
    hero2: `Cercas <em>fuertes.</em><br>Hechas bien.`,
    hero3: `Tu patio, privado.<br><em>Tu familia, tranquila.</em>`,
    tag1: "Cercas nuevas y reparaciones con garantía por escrito. Cotiza la tuya ahora mismo, en 60 segundos — sin que nadie te visite.",
    tag2: "Cercas nuevas y reparaciones con garantía por escrito. Cotiza la tuya en 60 segundos — sin visitas.",
    tag3: "Cercas nuevas y reparaciones con garantía por escrito — cotiza la tuya aquí mismo, sin que nadie te visite.",
    wSub1: "Dinos dónde está tu casa y qué cerca quieres — tu precio estimado al instante. Gratis y sin compromiso.",
    qLab2: "Cotización instantánea",
    wLead2: "Elige tu cerca y el tamaño de tu patio, y mira tu precio estimado al instante. Gratis, sin compromiso, sin esperar a nadie.",
    qTag3: "Cotiza tu cerca aquí — gratis",
    bar2: "🪵 Cotiza gratis",
    galAlt: "Cerca hecha por",
    cta1: `¿Listo para una cerca<br><em>hecha bien?</em>`,
    procesoH: `Del precio a la cerca, <em>sin sorpresas</em>`,
    insp: "Medición gratis",
    chatTopic: "cerca",
    icon: "🪵",
  },
};
const wordsOf = (d) => TRADE_WORDS[d.trade === "fence" ? "fence" : "roofing"];

// Onboarding saves the services a client checked as plain strings ("Techo de
// metal"); the templates render [icon, title, description] cards. This lookup
// upgrades every known string to a full card; unknown ones get a generic icon.
const SVC_LOOKUP = [
  // Fence-specific strings first, so "Reparación de cercas" reads as a fence
  // card, not the roofing repair card.
  [/port[oó]n|gate/i, "🚪", "Sencillos, dobles o automáticos — a la medida de tu entrada y a juego con tu cerca."],
  [/malla|cicl[oó]nica|chain/i, "🔗", "La opción fuerte y económica para patios, negocios y terrenos grandes."],
  [/vinilo|vinyl/i, "⬜", "Sin pintura y sin mantenimiento — se ve nueva por años."],
  [/cerca|fence/i, "🪵", "Postes bien anclados, líneas parejas y materiales de calidad, con garantía por escrito."],
  [/reparaci/i, "🔧", "Goteras, tejas voladas por el viento, flasheo. Respuesta rápida y arreglo garantizado."],
  [/nuevo|reemplaz/i, "🏠", "Techo completo con materiales de calidad y garantía por escrito."],
  [/inspecci/i, "🔍", "Revisamos tu techo gratis y te decimos la verdad — aunque no necesites nada todavía."],
  [/granizo|seguro/i, "🌪️", "Te acompañamos en la inspección y el papeleo del reclamo después de granizo o tormenta."],
  [/metal/i, "🏗️", "Techos de metal que duran décadas y aguantan el sol y las tormentas de Texas."],
  [/shingle|asfalto/i, "🧱", "Shingle arquitectónico en los colores y estilos más pedidos de la zona."],
  [/teja/i, "🏛️", "Teja de barro o concreto — el acabado clásico que dura generaciones."],
  [/emergencia/i, "🚨", "¿Gotera en plena tormenta? Escríbenos — atendemos emergencias 24/7."],
  [/financia/i, "💳", "Planes de pago para que arregles tu techo hoy, no “algún día”."],
];

/* ── Local-SEO helpers ── */

// "Starr, Hidalgo y Zapata" → ["Starr","Hidalgo","Zapata"]
export function areaCities(area) {
  return String(area || "")
    .split(/[,;·|\/]+|\s+y\s+|\s+and\s+/i)
    .map((s) => s.trim())
    .filter((s) => s && s.length <= 40)
    .slice(0, 12);
}

export function citySlug(city) {
  return String(city).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);
}

// FAQ built from the client's own data — real questions homeowners google.
function faqsOf(d, cities) {
  const city = d.pageCity || d.city || "tu ciudad";
  const hasSeguro = d.services.some(([, t]) => /granizo|seguro/i.test(t));
  if (d.trade === "fence") return [
    [`¿Cuánto cuesta una cerca nueva en ${city}?`,
      `Depende de los pies lineales y el material (madera, vinilo o malla). Por eso esta página tiene un cotizador: elige tu cerca y el tamaño de tu patio y en 60 segundos ves tu precio estimado — gratis y sin compromiso.`],
    [`¿La cotización y la medición son gratis?`,
      `Sí. La cotización en línea es instantánea y la medición en persona también es gratis. Solo pagas si decides hacer el trabajo con nosotros.`],
    [`¿Cuánto tarda una cerca nueva?`,
      `La mayoría de los patios se terminan en 1 a 3 días, dependiendo de los pies y el clima. Te confirmamos la fecha antes de empezar.`],
    [`¿Dan garantía por escrito?`,
      d.warranty ? `Sí: ${d.warranty}. Te la entregamos por escrito, en tu mano.` : `Sí, garantía por escrito en mano de obra. Pregúntanos los detalles para tu tipo de cerca.`],
    cities.length ? [`¿Atienden en mi ciudad?`,
      `Servimos ${cities.join(", ")} y sus alrededores. Si estás cerca, escríbenos por el chat — casi seguro llegamos.`] : null,
  ].filter(Boolean);
  return [
    [`¿Cuánto cuesta un techo nuevo en ${city}?`,
      `Depende del tamaño de tu casa y el material. Por eso esta página tiene un cotizador por satélite: escribe tu dirección y en 60 segundos ves tu techo medido y tu precio estimado — gratis y sin compromiso.`],
    [`¿La cotización y la inspección son gratis?`,
      `Sí. La cotización por satélite es instantánea y la inspección en persona también es gratis. Solo pagas si decides hacer el trabajo con nosotros.`],
    [`¿Cuánto tarda un reemplazo de techo?`,
      `La mayoría de las casas se terminan en 1 a 3 días, dependiendo del tamaño y el clima. Te confirmamos la fecha antes de empezar.`],
    hasSeguro ? [`¿Trabajan con reclamos de aseguranza?`,
      `Sí. Después de granizo o tormenta te acompañamos en la inspección y el papeleo del reclamo, para que tu aseguranza responda como debe.`] : null,
    [`¿Dan garantía por escrito?`,
      d.warranty ? `Sí: ${d.warranty}. Te la entregamos por escrito, en tu mano.` : `Sí, garantía por escrito en mano de obra. Pregúntanos los detalles para tu tipo de techo.`],
    cities.length ? [`¿Atienden en mi ciudad?`,
      `Servimos ${cities.join(", ")} y sus alrededores. Si estás cerca, escríbenos por el chat — casi seguro llegamos.`] : null,
  ].filter(Boolean);
}

/* Merge the client's bot-trained FAQs (approved with them on the onboarding
 * call) with the auto-generated SEO set above. The client's own wording goes
 * first; an auto question only fills in when its topic isn't already covered,
 * so "¿Dan garantía?" never shows up twice with two different answers. */
const FAQ_TOPICS = [
  /cuesta|precio/i,
  /gratis|cobran/i,
  /tarda|cu[aá]nto tiempo|d[ií]as/i,
  /asegur|seguro|reclamo|granizo/i,
  /garant/i,
  /ciudad|zona|d[oó]nde trabajan/i,
  /financ|mensualidad/i,
];
function mergeFaqs(clientFaqs, autoFaqs) {
  const topicOf = (q) => FAQ_TOPICS.findIndex((rx) => rx.test(q));
  const covered = new Set();
  const out = [];
  for (const f of clientFaqs) {
    const q = String(f?.q || "").trim(), a = String(f?.a || "").trim();
    if (!q || !a) continue;
    out.push([q, a]);
    const t = topicOf(q);
    if (t >= 0) covered.add(t);
  }
  for (const [q, a] of autoFaqs) {
    const t = topicOf(q);
    if (t >= 0 && covered.has(t)) continue;
    out.push([q, a]);
    if (t >= 0) covered.add(t);
  }
  return out.slice(0, 9);
}

/* Shared pieces */
function headBase(d, css) {
  const fence = d.trade === "fence";
  const loc = d.pageCity || d.city || "";
  const title = fence
    ? (loc ? `Cercas en ${loc} — Instalación y Reparación | ${d.biz}` : `${d.biz} — Cercas Residenciales`)
    : (loc ? `Techos en ${loc} — Reparación y Reemplazo | ${d.biz}` : `${d.biz} — Techos Residenciales`);
  const svcNames = d.services.map(([, t]) => t).slice(0, 4).join(", ");
  const descr = fence
    ? `${d.biz}${loc ? ` — cercas en ${loc}` : " — cercas residenciales"}. ${svcNames}. Cotiza tu cerca gratis en 60 segundos.`
    : `${d.biz}${loc ? ` — techos en ${loc}` : " — techos residenciales"}. ${svcNames}. Cotiza tu techo gratis en 60 segundos, medido por satélite.`;
  const canonical = d.canonical || "";
  const ogImage = d.ogImage || "";
  const cities = d._cities || [];
  // Structured data: tells Google this is a roofing business, where it works,
  // and (below) the FAQ answers — feeds map-pack and rich results.
  const ld = {
    "@context": "https://schema.org",
    "@type": fence ? "HomeAndConstructionBusiness" : "RoofingContractor",
    name: d.biz,
    description: descr,
    ...(d.phone ? { telephone: `+1${d.phone}` } : {}),
    ...(canonical ? { url: canonical } : {}),
    ...(ogImage ? { image: ogImage } : {}),
    ...(d.city ? { address: { "@type": "PostalAddress", addressLocality: d.city } } : {}),
    ...(cities.length ? { areaServed: cities.map((c) => ({ "@type": "City", name: c })) } : {}),
    priceRange: "$$",
  };
  const faqLd = (d._faqs || []).length ? {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: d._faqs.map(([q, a]) => ({
      "@type": "Question", name: q,
      acceptedAnswer: { "@type": "Answer", text: a },
    })),
  } : null;
  const ldSafe = (o) => JSON.stringify(o).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(descr)}">
${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ""}
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(descr)}">
${canonical ? `<meta property="og:url" content="${esc(canonical)}">` : ""}
${ogImage ? `<meta property="og:image" content="${esc(ogImage)}">` : ""}
<link rel="icon" href="${d.logo && d.logo.startsWith("data:") ? d.logo : `data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>${fence ? "🪵" : "🏠"}</text></svg>`}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<script type="application/ld+json">${ldSafe(ld)}</script>
${faqLd ? `<script type="application/ld+json">${ldSafe(faqLd)}</script>` : ""}
<style>${css}</style></head><body>`;
}

function ribbonHtml(opts) {
  if (!opts.ribbon) return "";
  return `<div style="background:#F8B408;color:#101B30;text-align:center;font-weight:800;font-size:12.5px;padding:9px 14px;font-family:Inter,Arial,sans-serif">📋 ${esc(opts.ribbon)}</div>`;
}

function backAltoHtml(opts) {
  if (!opts.backAlto) return "";
  return `<a style="position:fixed;bottom:18px;left:50%;transform:translateX(-50%);z-index:50;background:#101B30;color:#fff;text-decoration:none;font-weight:800;font-size:14px;padding:13px 22px;border-radius:99px;box-shadow:0 14px 36px rgba(16,27,48,.5);font-family:Inter,Arial,sans-serif;white-space:nowrap" href="/ventas#precio">← Volver a <span style="color:#F8B408">ALTO PRO</span></a>`;
}

const FB_SVG = `<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13.5 21v-8h2.7l.4-3.1h-3.1V7.9c0-.9.25-1.5 1.55-1.5h1.65V3.6c-.29-.04-1.28-.12-2.43-.12-2.4 0-4.05 1.46-4.05 4.15v2.27H7.5V13h2.72v8h3.28z"/></svg>`;
const IG_SVG = `<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.2c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41a3.7 3.7 0 0 1-1.38-.9 3.7 3.7 0 0 1-.9-1.38c-.16-.42-.36-1.06-.41-2.23C2.21 15.58 2.2 15.2 2.2 12s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41C8.42 2.21 8.8 2.2 12 2.2m0 1.8c-3.15 0-3.52.01-4.77.07-1.08.05-1.67.23-2.06.38-.52.2-.89.44-1.28.83-.39.39-.63.76-.83 1.28-.15.39-.33.98-.38 2.06-.06 1.25-.07 1.62-.07 4.77s.01 3.52.07 4.77c.05 1.08.23 1.67.38 2.06.2.52.44.89.83 1.28.39.39.76.63 1.28.83.39.15.98.33 2.06.38 1.25.06 1.62.07 4.77.07s3.52-.01 4.77-.07c1.08-.05 1.67-.23 2.06-.38.52-.2.89-.44 1.28-.83.39-.39.63-.76.83-1.28.15-.39.33-.98.38-2.06.06-1.25.07-1.62.07-4.77s-.01-3.52-.07-4.77c-.05-1.08-.23-1.67-.38-2.06-.2-.52-.44-.89-.83-1.28a3.44 3.44 0 0 0-1.28-.83c-.39-.15-.98-.33-2.06-.38-1.25-.06-1.62-.07-4.77-.07M12 6.87A5.13 5.13 0 1 0 17.13 12 5.13 5.13 0 0 0 12 6.87m0 8.46A3.33 3.33 0 1 1 15.33 12 3.33 3.33 0 0 1 12 15.33m6.54-8.67a1.2 1.2 0 1 1-1.2-1.2 1.2 1.2 0 0 1 1.2 1.2"/></svg>`;

function footerBits(d) {
  // Social buttons inherit the footer's text color via currentColor, so the
  // same markup sits correctly on all three templates (light, dark, warm).
  const ic = (href, label, svg) => `<a href="${esc(href)}" target="_blank" rel="noopener" aria-label="${label}" style="width:40px;height:40px;border-radius:50%;border:1.5px solid currentColor;display:inline-flex;align-items:center;justify-content:center;color:inherit;opacity:.8;text-decoration:none">${svg}</a>`;
  const soc = (d.facebook || d.instagram)
    ? `<div style="display:flex;gap:12px;justify-content:center;margin-bottom:16px">${d.facebook ? ic(d.facebook, "Facebook", FB_SVG) : ""}${d.instagram ? ic(d.instagram, "Instagram", IG_SVG) : ""}</div>`
    : "";
  return `${soc}<b>${esc(d.biz)}</b>${d.city ? ` · ${esc(d.city)}` : ""}${d.license ? ` · Lic. ${esc(d.license)}` : ""}${d.opinaHref ? `<br><a href="${esc(d.opinaHref)}" style="color:inherit">⭐ ¿Trabajamos en tu casa? Deja tu opinión</a>` : ""}<br>Página hecha con ⚡ ALTO Pro · <a href="/privacidad" style="color:inherit">Privacidad</a>`;
}

/* Widget spotlight (d.widgetSpot only — set by the /pagina preview; absent on
 * existing client sites so their output stays byte-identical): a pulsing
 * accent glow around the quote widget + a bouncing badge above it. The
 * cotizador is the product's differentiator — the page should look like it
 * knows that. */
function widgetSpotBits(d) {
  if (!d.widgetSpot) return { css: "", badge: "", cls: "" };
  const c1 = d.color;
  return {
    cls: " wspot",
    css: `
.wspot{animation:wsglow 2.4s ease-in-out infinite;border-color:${c1} !important}
@keyframes wsglow{0%,100%{box-shadow:0 0 0 0 ${c1}59,0 30px 80px rgba(15,18,22,.13)}50%{box-shadow:0 0 0 16px ${c1}00,0 30px 80px rgba(15,18,22,.13)}}
.wsb{display:flex;align-items:center;justify-content:center;gap:8px;max-width:450px;margin:34px auto -22px;position:relative;z-index:2;background:${c1};color:#fff;font-family:Inter,Arial,sans-serif;font-weight:800;font-size:13.5px;letter-spacing:.3px;padding:11px 20px;border-radius:99px;box-shadow:0 14px 36px ${c1}66;animation:wsbob 2.2s ease-in-out infinite}
@keyframes wsbob{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
@media (prefers-reduced-motion:reduce){.wspot,.wsb{animation:none}}`,
    badge: `<div class="wsb">⚡ TU COTIZADOR — atiende y cotiza por ti 24/7. ¡Pruébalo! 👇</div>`,
  };
}

const statsCells = (d) => [
  d.years ? [`${d.years}+`, "años de experiencia"] : null,
  ["100%", "garantía escrita"],
  ["ES/EN", "hablamos los dos"],
].filter(Boolean);

/* ── Deep-content sections: garantía · proceso · reseñas · zonas · FAQ ──
 * Shared DATA prep, but each template renders its OWN layout — the sections
 * must feel designed for that template, not the same skeleton recolored. */
function extrasData(d) {
  const cities = d._cities || [];
  const faqs = d._faqs || [];
  const revs = d.reviews || [];
  const cur = d.pageCity || "";
  // Template previews have no real city pages behind them — chips stay put.
  const zHref = (c) => (d.zonaLinks === false ? "#zonas" : `${d.basePath || ""}/zona/${citySlug(c)}`);
  const stars = (n) => "★".repeat(Math.max(1, Math.min(5, n))) + "☆".repeat(5 - Math.max(1, Math.min(5, n)));
  const palabra = [
    d.warranty ? ["🛡️", "Garantía por escrito", `${d.warranty} — firmada y en tu mano, no de palabra.`] : null,
    d.diff ? ["💪", "Lo que nos hace diferentes", d.diff] : null,
    d.license ? ["📋", "Licencia y seguro", `Lic. ${d.license}. Trabajamos asegurados — tu casa y nuestra gente, protegidas.`] : null,
  ].filter(Boolean);
  const pasos = d.trade === "fence" ? [
    ["Cotiza en 60 segundos", "Elige tu cerca y el tamaño de tu patio. Ves tu precio estimado al instante."],
    ["Medición gratis", "Vamos a tu casa, medimos los pies exactos y te damos precio firme por escrito."],
    ["Hacemos el trabajo", "Postes bien anclados y líneas parejas, terminamos en el día prometido y dejamos todo limpio."],
    ["Garantía en tu mano", "Te entregamos tu garantía firmada y las fotos del trabajo terminado."],
  ] : [
    ["Cotiza en 60 segundos", "Escribe tu dirección y el satélite mide tu techo. Ves tu precio estimado al instante."],
    ["Inspección gratis", "Subimos a tu techo, confirmamos medidas y te damos precio firme por escrito."],
    ["Hacemos el trabajo", "Protegemos tu jardín y tu casa, terminamos en el día prometido y dejamos todo limpio."],
    ["Garantía en tu mano", "Te entregamos tu garantía firmada y las fotos del trabajo terminado."],
  ];
  const introTxt = cur ? (d.trade === "fence"
    ? `${d.biz} hace cercas en ${cur} y sus alrededores: ${d.services.slice(0, 4).map(([, t]) => t.toLowerCase()).join(", ")}.${d.years ? ` Llevamos ${d.years} años trabajando en la región.` : ""} Cotiza aquí arriba y mira tu precio estimado — gratis, en 60 segundos.`
    : `${d.biz} hace techos en ${cur} y sus alrededores: ${d.services.slice(0, 4).map(([, t]) => t.toLowerCase()).join(", ")}.${d.years ? ` Llevamos ${d.years} años trabajando en la región.` : ""} Escribe tu dirección aquí arriba y mira tu techo medido por satélite con tu precio estimado — gratis, en 60 segundos.`) : "";
  return { cities, faqs, revs, cur, zHref, stars, palabra, pasos, introTxt };
}

/* Scroll-reveal: sections drift up as they enter the viewport. The hiding
 * class only exists after JS confirms it can reveal (rvon on <html>), so a
 * broken script or reduced-motion setting means everything just shows. */
const RV_CSS = `
html.rvon [data-rv]{opacity:0;transform:translateY(26px);transition:opacity .8s cubic-bezier(.16,1,.3,1),transform .8s cubic-bezier(.16,1,.3,1)}
html.rvon [data-rv].rv-in{opacity:1;transform:none}
html.rvon [data-rv].rvd2{transition-delay:.08s}html.rvon [data-rv].rvd3{transition-delay:.16s}html.rvon [data-rv].rvd4{transition-delay:.24s}`;
const RV_JS = `<script>(function(){try{if(matchMedia('(prefers-reduced-motion:reduce)').matches||!('IntersectionObserver'in window))return;document.documentElement.classList.add('rvon');var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('rv-in');io.unobserve(e.target)}})},{rootMargin:'0px 0px -7% 0px',threshold:.06});[].forEach.call(document.querySelectorAll('[data-rv]'),function(el){io.observe(el)})}catch(e){}})();</script>`;
const rvd = (i) => (i % 4 ? ` rvd${(i % 4) + 1}` : "");

/* ── Opción 1 · editorial luxury: hairlines, roman numerals, cream bands ── */
function extras1(d) {
  const D = extrasData(d);
  const c1 = d.color, cream = "#FAF8F5", line = "#E7E2D8", ink = "#0F1216", mut = "#5E6470";
  const SERIF = "'Fraunces',Georgia,serif";
  const css = `${RV_CSS}
.e1w{max-width:1060px;margin:0 auto;padding:0 24px}
.e1s{padding:78px 0}
.e1band{background:${cream};border-top:1px solid ${line};border-bottom:1px solid ${line}}
.e1eye{color:${c1};font-weight:800;font-size:12px;letter-spacing:3.5px;text-transform:uppercase;text-align:center}
.e1t{font-family:${SERIF};font-size:clamp(30px,4.8vw,46px);font-weight:700;text-align:center;line-height:1.08;margin-top:12px;color:${ink}}
.e1t em{font-style:italic;color:${c1}}
.e1p{color:${mut};font-weight:500;font-size:15.5px;line-height:1.75;max-width:600px;margin:16px auto 0;text-align:center}
.e1word{display:grid;gap:0;margin-top:46px;grid-template-columns:repeat(auto-fit,minmax(250px,1fr))}
.e1wi{padding:8px 34px 6px;border-left:1px solid ${line}}
.e1wi:first-child{border-left:none}
.e1wi .rn{font-family:${SERIF};font-style:italic;font-size:30px;color:${c1};display:block}
.e1wi h3{font-family:${SERIF};font-size:21px;font-weight:700;margin:14px 0 9px;color:${ink}}
.e1wi p{color:${mut};font-size:14.5px;font-weight:500;line-height:1.75}
@media(max-width:719px){.e1word{gap:30px}.e1wi{border-left:none;border-top:1px solid ${line};padding:26px 4px 0}.e1wi:first-child{border-top:none;padding-top:0}}
.e1tl{max-width:640px;margin:48px auto 0;position:relative}
.e1tl::before{content:"";position:absolute;left:27px;top:10px;bottom:10px;width:1px;background:${line}}
.e1st{position:relative;padding:0 0 40px 86px}
.e1st:last-child{padding-bottom:0}
.e1st .n{position:absolute;left:0;top:-4px;width:56px;height:56px;border:1px solid ${line};border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;font-family:${SERIF};font-style:italic;font-size:22px;color:${c1};box-shadow:0 6px 18px rgba(15,18,22,.06)}
.e1st b{font-family:${SERIF};font-size:21px;font-weight:700;color:${ink}}
.e1st p{color:${mut};font-size:14.5px;font-weight:500;line-height:1.7;margin-top:7px;max-width:460px}
.e1feat{max-width:720px;margin:46px auto 0;text-align:center}
.e1feat .qm{font-family:${SERIF};font-size:88px;line-height:.4;height:40px;color:${c1}}
.e1feat blockquote{font-family:${SERIF};font-style:italic;font-size:clamp(20px,3vw,27px);font-weight:600;line-height:1.55;color:${ink}}
.e1feat figcaption{margin-top:20px;font-size:12px;font-weight:800;letter-spacing:2.5px;text-transform:uppercase;color:${mut}}
.e1feat .st{color:#E2A400;font-size:15px;letter-spacing:3px;display:block;margin-top:8px}
.e1revs{display:grid;gap:0 44px;margin:34px auto 0;max-width:880px;grid-template-columns:repeat(auto-fit,minmax(280px,1fr))}
.e1rev{border-top:1px solid ${line};padding:24px 4px}
.e1rev .st{color:#E2A400;font-size:13px;letter-spacing:2.5px}
.e1rev p{color:${ink};font-size:14.5px;font-weight:500;line-height:1.75;margin-top:10px}
.e1rev b{display:block;color:${mut};font-size:11.5px;font-weight:800;letter-spacing:2px;text-transform:uppercase;margin-top:12px}
.e1revform{max-width:440px;margin:36px auto 0;border-radius:24px;overflow:hidden;border:1px solid ${line};box-shadow:0 24px 60px rgba(15,18,22,.10)}
.e1revform iframe{width:100%;height:600px;border:0;display:block}
.e1chips{display:flex;gap:12px;flex-wrap:wrap;justify-content:center;margin-top:34px}
.e1chips a{border:1px solid ${line};background:#fff;border-radius:99px;padding:12px 22px;font-weight:700;font-size:12px;letter-spacing:1.8px;text-transform:uppercase;color:#3A4252;text-decoration:none;transition:border-color .2s,color .2s,transform .2s}
.e1chips a:hover{border-color:${c1};color:${c1};transform:translateY(-2px)}
.e1chips a.on{background:${c1};border-color:${c1};color:#fff}
.e1faq{max-width:720px;margin:38px auto 0;border-top:1px solid ${line}}
.e1faq details{border-bottom:1px solid ${line}}
.e1faq summary{cursor:pointer;list-style:none;display:flex;justify-content:space-between;align-items:center;gap:16px;padding:21px 4px;font-family:${SERIF};font-weight:600;font-size:17.5px;color:${ink}}
.e1faq summary::-webkit-details-marker{display:none}
.e1faq summary::after{content:"+";font-family:${SERIF};color:${c1};font-size:26px;font-weight:400;flex-shrink:0;transition:transform .25s}
.e1faq details[open] summary::after{transform:rotate(45deg)}
.e1faq .xa{padding:0 4px 22px;color:${mut};font-size:14.5px;font-weight:500;line-height:1.75;max-width:600px}`;

  const roman = ["I", "II", "III"];
  const intro = D.cur ? `
<div class="e1w"><section class="e1s" style="padding-bottom:0" data-rv>
  <p class="e1eye">${esc(D.cur)}</p>
  <h2 class="e1t">Techos en <em>${esc(D.cur)}</em></h2>
  <p class="e1p">${esc(D.introTxt)}</p>
</section></div>` : "";

  const palabra = D.palabra.length ? `
<div class="e1band"><div class="e1w"><section class="e1s">
  <div data-rv><p class="e1eye">Nuestra palabra</p>
  <h2 class="e1t">Por qué la gente <em>nos elige</em></h2></div>
  <div class="e1word">
    ${D.palabra.map(([, t, x], i) => `<article class="e1wi${rvd(i + 1)}" data-rv><span class="rn">${roman[i] || i + 1}.</span><h3>${esc(t)}</h3><p>${esc(x)}</p></article>`).join("")}
  </div>
</section></div></div>` : "";

  const proceso = `
<div class="e1w"><section class="e1s">
  <div data-rv><p class="e1eye">Cómo trabajamos</p>
  <h2 class="e1t">${wordsOf(d).procesoH}</h2></div>
  <div class="e1tl">
    ${D.pasos.map(([t, x], i) => `<div class="e1st${rvd(i)}" data-rv><span class="n">${roman[i] || "IV"}</span><b>${esc(t)}</b><p>${esc(x)}</p></div>`).join("")}
  </div>
</section></div>`;

  const [feat, ...rest] = D.revs;
  const resenas = D.revs.length ? `
<div class="e1band"><div class="e1w"><section class="e1s">
  <div data-rv><p class="e1eye">Reseñas</p>
  <h2 class="e1t">Lo que dicen <em>nuestros clientes</em></h2></div>
  <figure class="e1feat" data-rv>
    <div class="qm">“</div>
    <blockquote>${esc(feat.t)}</blockquote>
    <figcaption>— ${esc(feat.n || "Cliente verificado")}<span class="st">${D.stars(feat.s)}</span></figcaption>
  </figure>
  ${rest.length ? `<div class="e1revs">${rest.map((r, i) => `<div class="e1rev${rvd(i)}" data-rv><span class="st">${D.stars(r.s)}</span><p>“${esc(r.t)}”</p><b>— ${esc(r.n || "Cliente verificado")}</b></div>`).join("")}</div>` : ""}
</section></div></div>` : "";

  const opinBox = d.opinaHref ? `
<div class="e1w"><section class="e1s" style="padding-top:${D.revs.length ? "0" : ""}">
  <div data-rv><p class="e1eye">Tu opinión importa</p>
  <h2 class="e1t">Cuéntanos <em>cómo te fue</em></h2>
  <p class="e1p">Tu experiencia ayuda a otras familias a decidir. Si nos das 5 estrellas te llevamos directo a publicarla en Google o Facebook — toma un minuto.</p></div>
  <div class="e1revform" data-rv><iframe src="${esc(d.opinaHref)}" loading="lazy" title="Danos tu opinión"></iframe></div>
</section></div>` : "";

  const zonas = D.cities.length ? `
<div class="e1w"><section class="e1s" id="zonas">
  <div data-rv><p class="e1eye">Zonas que cubrimos</p>
  <h2 class="e1t">Techos en <em>toda la región</em></h2>
  <p class="e1p">Atendemos ${D.cities.map(esc).join(", ")} y sus alrededores. Toca tu ciudad:</p></div>
  <div class="e1chips" data-rv>${D.cities.map((c) => `<a${D.cur === c ? ' class="on"' : ""} href="${esc(D.zHref(c))}">${esc(c)}</a>`).join("")}</div>
</section></div>` : "";

  const faq = D.faqs.length ? `
<div class="e1band"><div class="e1w"><section class="e1s">
  <div data-rv><p class="e1eye">Preguntas frecuentes</p>
  <h2 class="e1t">Lo que todos <em>preguntan</em></h2></div>
  <div class="e1faq" data-rv>
    ${D.faqs.map(([q, a]) => `<details><summary>${esc(q)}</summary><div class="xa">${esc(a)}</div></details>`).join("")}
  </div>
</section></div></div>` : "";

  return { css, intro, html: palabra + proceso + resenas + opinBox + zonas + faq + RV_JS };
}

/* ── Opción 2 · industrial poster: outline numerals, slabs, ghost words ── */
function extras2(d) {
  const D = extrasData(d);
  const c1 = d.color, ink = "#14171C", panel = "#FFFFFF", bd = "rgba(20,23,28,.09)", mut = "#5B6472";
  const COND = "'Barlow Condensed',sans-serif";
  const css = `${RV_CSS}
.e2w{max-width:1140px;margin:0 auto;padding:0 26px}
.e2s{padding:78px 0;position:relative;overflow:hidden}
.e2gw{position:absolute;right:-2%;top:-14px;font-family:${COND};font-size:clamp(90px,16vw,200px);font-weight:800;color:${ink}07;text-transform:uppercase;letter-spacing:-3px;pointer-events:none;line-height:.8;white-space:nowrap}
.e2lab{display:inline-flex;align-items:center;gap:10px;color:${c1};font-weight:800;letter-spacing:4px;font-size:12px;text-transform:uppercase}
.e2lab::before{content:"";width:32px;height:3px;background:${c1}}
.e2t{font-family:${COND};font-size:clamp(42px,6.6vw,72px);font-weight:800;text-transform:uppercase;line-height:.94;margin-top:12px;color:${ink}}
.e2t em{color:${c1};font-style:normal}
.e2p{color:${mut};font-weight:600;font-size:15.5px;line-height:1.7;max-width:560px;margin-top:16px}
.e2word{display:grid;gap:14px;margin-top:42px}
.e2wi{position:relative;background:${panel};border:1px solid ${bd};border-left:5px solid ${c1};border-radius:4px;padding:30px 110px 30px 32px;overflow:hidden;transition:transform .25s;box-shadow:0 10px 30px rgba(20,23,28,.05)}
.e2wi:hover{transform:translateX(6px)}
.e2wi .gic{position:absolute;right:-8px;bottom:-22px;font-size:110px;opacity:.06;transform:rotate(-10deg);pointer-events:none}
.e2wi h3{font-family:${COND};font-size:clamp(22px,3vw,29px);font-weight:800;text-transform:uppercase;color:${ink};line-height:1}
.e2wi p{color:${mut};font-weight:600;font-size:14.5px;line-height:1.65;margin-top:9px;max-width:640px}
@media(max-width:640px){.e2wi{padding-right:32px}}
.e2steps{display:grid;gap:2px;margin-top:44px;background:${bd};border:1px solid ${bd};border-radius:6px;overflow:hidden;grid-template-columns:repeat(auto-fit,minmax(215px,1fr))}
.e2st{background:${panel};padding:30px 26px 36px;position:relative}
.e2st::after{content:"";position:absolute;left:26px;bottom:0;width:36px;height:4px;background:${c1}}
.e2st .n{font-family:${COND};font-size:74px;font-weight:800;line-height:.85;color:${c1}}
@supports(-webkit-text-stroke:2px red){.e2st .n{color:transparent;-webkit-text-stroke:2px ${c1}}}
.e2st b{font-family:${COND};font-size:21px;font-weight:800;text-transform:uppercase;color:${ink};display:block;margin-top:16px;line-height:1.05}
.e2st p{color:${mut};font-weight:600;font-size:13.5px;line-height:1.6;margin-top:8px}
.e2revs{display:grid;gap:14px;margin-top:42px;grid-template-columns:repeat(auto-fit,minmax(270px,1fr))}
.e2rev{background:${panel};border:1px solid ${bd};border-radius:4px;border-top:4px solid ${c1};padding:26px;transition:transform .25s;box-shadow:0 10px 30px rgba(20,23,28,.05)}
.e2rev:hover{transform:translateY(-4px)}
.e2rev .st{color:#E2A400;font-size:17px;letter-spacing:3px}
.e2rev p{color:${ink};font-weight:600;font-size:14.5px;line-height:1.65;margin-top:12px}
.e2rev b{display:block;font-family:${COND};font-size:15px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:${mut};margin-top:14px}
.e2revform{max-width:440px;margin:36px 0 0;border-radius:6px;overflow:hidden;border:1px solid ${bd};box-shadow:0 10px 30px rgba(20,23,28,.06)}
.e2revform iframe{width:100%;height:600px;border:0;display:block}
.e2chips{display:flex;gap:10px;flex-wrap:wrap;margin-top:36px}
.e2chips a{background:${panel};border:2px solid ${bd};border-radius:4px;padding:12px 22px;font-family:${COND};font-weight:800;font-size:16px;letter-spacing:1px;text-transform:uppercase;color:${ink};text-decoration:none;transition:border-color .2s,color .2s}
.e2chips a:hover{border-color:${c1};color:${c1}}
.e2chips a.on{background:${c1};border-color:${c1};color:#fff}
.e2faq{max-width:820px;margin-top:38px}
.e2faq details{background:${panel};border:1px solid ${bd};border-left:4px solid ${c1};border-radius:4px;margin-bottom:10px;overflow:hidden;box-shadow:0 8px 24px rgba(20,23,28,.05)}
.e2faq summary{cursor:pointer;list-style:none;display:flex;justify-content:space-between;align-items:center;gap:14px;padding:18px 22px;font-family:${COND};font-weight:800;font-size:19px;text-transform:uppercase;color:${ink};line-height:1.15}
.e2faq summary::-webkit-details-marker{display:none}
.e2faq summary::after{content:"+";color:${c1};font-size:26px;font-weight:800;flex-shrink:0;transition:transform .25s}
.e2faq details[open] summary::after{transform:rotate(45deg)}
.e2faq .xa{padding:0 22px 20px;color:${mut};font-weight:600;font-size:14.5px;line-height:1.7}`;

  const intro = D.cur ? `
<div class="e2w"><section class="e2s" style="padding-bottom:0">
  <div data-rv><p class="e2lab">${esc(D.cur)}</p>
  <h2 class="e2t">Techos en <em>${esc(D.cur)}</em></h2>
  <p class="e2p">${esc(D.introTxt)}</p></div>
</section></div>` : "";

  const palabra = D.palabra.length ? `
<div class="e2w"><section class="e2s">
  <div class="e2gw">Palabra</div>
  <div data-rv><p class="e2lab">Nuestra palabra</p>
  <h2 class="e2t">Por qué nos <em>eligen</em></h2></div>
  <div class="e2word">
    ${D.palabra.map(([ic, t, x], i) => `<article class="e2wi${rvd(i + 1)}" data-rv><span class="gic">${ic}</span><h3>${esc(t)}</h3><p>${esc(x)}</p></article>`).join("")}
  </div>
</section></div>` : "";

  const proceso = `
<div class="e2w"><section class="e2s">
  <div class="e2gw">Proceso</div>
  <div data-rv><p class="e2lab">Cómo trabajamos</p>
  <h2 class="e2t">${wordsOf(d).procesoH}</h2></div>
  <div class="e2steps" data-rv>
    ${D.pasos.map(([t, x], i) => `<div class="e2st"><span class="n">0${i + 1}</span><b>${esc(t)}</b><p>${esc(x)}</p></div>`).join("")}
  </div>
</section></div>`;

  const resenas = D.revs.length ? `
<div class="e2w"><section class="e2s">
  <div class="e2gw">Reseñas</div>
  <div data-rv><p class="e2lab">Reseñas</p>
  <h2 class="e2t">Lo que dice <em>la gente</em></h2></div>
  <div class="e2revs">
    ${D.revs.map((r, i) => `<div class="e2rev${rvd(i)}" data-rv><span class="st">${D.stars(r.s)}</span><p>“${esc(r.t)}”</p><b>— ${esc(r.n || "Cliente verificado")}</b></div>`).join("")}
  </div>

</section></div>` : "";

  const opinBox = d.opinaHref ? `
<div class="e2w"><section class="e2s">
  <div class="e2gw">Opinión</div>
  <div data-rv><p class="e2lab">Tu opinión importa</p>
  <h2 class="e2t">Cuéntanos <em>cómo te fue</em></h2>
  <p class="e2p">Tu experiencia ayuda a otras familias a decidir. Si nos das 5 estrellas te llevamos directo a publicarla en Google o Facebook — toma un minuto.</p></div>
  <div class="e2revform" data-rv><iframe src="${esc(d.opinaHref)}" loading="lazy" title="Danos tu opinión"></iframe></div>
</section></div>` : "";

  const zonas = D.cities.length ? `
<div class="e2w"><section class="e2s" id="zonas">
  <div class="e2gw">Zonas</div>
  <div data-rv><p class="e2lab">Zonas que cubrimos</p>
  <h2 class="e2t">Toda <em>la región</em></h2>
  <p class="e2p">Atendemos ${D.cities.map(esc).join(", ")} y sus alrededores. Toca tu ciudad:</p></div>
  <div class="e2chips" data-rv>${D.cities.map((c) => `<a${D.cur === c ? ' class="on"' : ""} href="${esc(D.zHref(c))}">${esc(c)}</a>`).join("")}</div>
</section></div>` : "";

  const faq = D.faqs.length ? `
<div class="e2w"><section class="e2s">
  <div class="e2gw">FAQ</div>
  <div data-rv><p class="e2lab">Preguntas frecuentes</p>
  <h2 class="e2t">Lo que todos <em>preguntan</em></h2></div>
  <div class="e2faq" data-rv>
    ${D.faqs.map(([q, a]) => `<details><summary>${esc(q)}</summary><div class="xa">${esc(a)}</div></details>`).join("")}
  </div>
</section></div>` : "";

  return { css, intro, html: palabra + proceso + resenas + opinBox + zonas + faq + RV_JS };
}

/* ── Opción 3 · warm modern: tinted cards, avatars, dotted connectors ── */
function extras3(d) {
  const D = extrasData(d);
  const c1 = d.color, ink = "#1B2330", soft = "#5C6675", tint = shade(d.color, 0.92), deep = shade(d.color, -0.35);
  const tints = [tint, "#EAF6EE", "#FFF5E1"];
  const css = `${RV_CSS}
.e3w{max-width:1140px;margin:0 auto;padding:0 24px}
.e3s{padding:70px 0}
.e3eye{color:${c1};font-weight:800;font-size:12px;letter-spacing:3px;text-transform:uppercase;text-align:center}
.e3t{font-size:clamp(28px,4.4vw,42px);font-weight:800;letter-spacing:-.8px;text-align:center;line-height:1.12;margin-top:10px;color:${ink}}
.e3t em{color:${c1};font-style:normal}
.e3p{color:${soft};font-weight:500;font-size:15.5px;line-height:1.7;max-width:560px;margin:12px auto 0;text-align:center}
.e3word{display:grid;gap:18px;margin-top:42px;grid-template-columns:repeat(auto-fit,minmax(255px,1fr))}
.e3wi{border-radius:28px;padding:30px;transition:transform .25s}
.e3wi:hover{transform:translateY(-5px)}
.e3wi .ic{width:54px;height:54px;border-radius:18px;background:#fff;display:flex;align-items:center;justify-content:center;font-size:26px;box-shadow:0 10px 26px rgba(27,35,48,.10)}
.e3wi h3{font-size:17.5px;font-weight:800;letter-spacing:-.3px;margin:16px 0 8px;color:${ink}}
.e3wi p{color:#414B5A;font-size:14.5px;font-weight:500;line-height:1.7}
.e3steps{display:grid;gap:18px;margin-top:44px;grid-template-columns:repeat(auto-fit,minmax(215px,1fr))}
.e3st{background:#fff;border-radius:26px;padding:28px;box-shadow:0 16px 44px rgba(27,35,48,.07);border:1px solid #0000000a;position:relative;transition:transform .25s}
.e3st:hover{transform:translateY(-4px)}
.e3st .n{width:46px;height:46px;border-radius:50%;background:${tint};color:${deep};font-weight:800;font-size:18px;display:flex;align-items:center;justify-content:center}
.e3st b{display:block;font-size:16.5px;font-weight:800;letter-spacing:-.3px;color:${ink};margin-top:15px}
.e3st p{color:${soft};font-size:13.5px;font-weight:500;line-height:1.65;margin-top:7px}
@media(min-width:975px){.e3st:not(:last-child)::after{content:"";position:absolute;right:-16px;top:48px;width:16px;border-top:3px dotted #D5DAE1}}
.e3revs{display:grid;gap:18px;margin-top:42px;grid-template-columns:repeat(auto-fit,minmax(270px,1fr))}
.e3rev{background:#fff;border-radius:26px;padding:26px;box-shadow:0 16px 44px rgba(27,35,48,.07);border:1px solid #0000000a;transition:transform .25s}
.e3rev:hover{transform:translateY(-4px)}
.e3rev .hd{display:flex;gap:13px;align-items:center}
.e3rev .av{width:46px;height:46px;border-radius:50%;background:${tint};color:${deep};font-weight:800;font-size:18px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.e3rev .who b{display:block;font-size:14.5px;font-weight:800;color:${ink}}
.e3rev .who span{color:#F0A500;font-size:13px;letter-spacing:2px}
.e3rev p{color:#3A4252;font-size:14.5px;font-weight:500;line-height:1.7;margin-top:14px}
.e3revform{max-width:440px;margin:36px auto 0;border-radius:30px;overflow:hidden;box-shadow:0 24px 70px rgba(27,35,48,.12);border:1px solid #0000000a}
.e3revform iframe{width:100%;height:600px;border:0;display:block}
.e3chips{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin-top:34px}
.e3chips a{background:#fff;border-radius:99px;padding:11px 20px;font-weight:700;font-size:13.5px;color:${ink};text-decoration:none;box-shadow:0 8px 22px rgba(27,35,48,.07);border:1px solid #0000000a;transition:transform .2s,background .2s,color .2s}
.e3chips a:hover{transform:translateY(-2px)}
.e3chips a.on{background:${c1};color:#fff}
.e3faq{max-width:760px;margin:36px auto 0}
.e3faq details{background:#fff;border-radius:20px;margin-bottom:12px;overflow:hidden;box-shadow:0 10px 30px rgba(27,35,48,.06);border:1px solid #0000000a}
.e3faq summary{cursor:pointer;list-style:none;display:flex;justify-content:space-between;align-items:center;gap:14px;padding:19px 22px;font-weight:700;font-size:15px;color:${ink}}
.e3faq summary::-webkit-details-marker{display:none}
.e3faq summary::after{content:"+";width:30px;height:30px;border-radius:50%;background:${tint};color:${deep};font-size:19px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:transform .25s}
.e3faq details[open] summary::after{transform:rotate(45deg)}
.e3faq .xa{padding:0 22px 20px;color:${soft};font-size:14.5px;font-weight:500;line-height:1.7}`;

  const intro = D.cur ? `
<div class="e3w"><section class="e3s" style="padding-bottom:0" data-rv>
  <p class="e3eye">${esc(D.cur)}</p>
  <h2 class="e3t">Techos en <em>${esc(D.cur)}</em></h2>
  <p class="e3p">${esc(D.introTxt)}</p>
</section></div>` : "";

  const palabra = D.palabra.length ? `
<div class="e3w"><section class="e3s">
  <div data-rv><p class="e3eye">Nuestra palabra</p>
  <h2 class="e3t">Por qué la gente <em>nos elige</em></h2></div>
  <div class="e3word">
    ${D.palabra.map(([ic, t, x], i) => `<article class="e3wi${rvd(i + 1)}" data-rv style="background:${tints[i % 3]}"><div class="ic">${ic}</div><h3>${esc(t)}</h3><p>${esc(x)}</p></article>`).join("")}
  </div>
</section></div>` : "";

  const proceso = `
<div class="e3w"><section class="e3s">
  <div data-rv><p class="e3eye">Cómo trabajamos</p>
  <h2 class="e3t">${wordsOf(d).procesoH}</h2></div>
  <div class="e3steps">
    ${D.pasos.map(([t, x], i) => `<div class="e3st${rvd(i)}" data-rv><span class="n">${i + 1}</span><b>${esc(t)}</b><p>${esc(x)}</p></div>`).join("")}
  </div>
</section></div>`;

  const resenas = D.revs.length ? `
<div class="e3w"><section class="e3s">
  <div data-rv><p class="e3eye">Reseñas</p>
  <h2 class="e3t">Familias que ya <em>confiaron</em></h2></div>
  <div class="e3revs">
    ${D.revs.map((r, i) => `<div class="e3rev${rvd(i)}" data-rv><div class="hd"><span class="av">${esc((r.n || "C").trim().charAt(0).toUpperCase())}</span><span class="who"><b>${esc(r.n || "Cliente verificado")}</b><span>${D.stars(r.s)}</span></span></div><p>“${esc(r.t)}”</p></div>`).join("")}
  </div>

</section></div>` : "";

  const opinBox = d.opinaHref ? `
<div class="e3w"><section class="e3s">
  <div data-rv><p class="e3eye">Tu opinión importa</p>
  <h2 class="e3t">Cuéntanos <em>cómo te fue</em></h2>
  <p class="e3p">Tu experiencia ayuda a otras familias a decidir. Si nos das 5 estrellas te llevamos directo a publicarla en Google o Facebook — toma un minuto.</p></div>
  <div class="e3revform" data-rv><iframe src="${esc(d.opinaHref)}" loading="lazy" title="Danos tu opinión"></iframe></div>
</section></div>` : "";

  const zonas = D.cities.length ? `
<div class="e3w"><section class="e3s" id="zonas">
  <div data-rv><p class="e3eye">Zonas que cubrimos</p>
  <h2 class="e3t">Techos en <em>toda la región</em></h2>
  <p class="e3p">Atendemos ${D.cities.map(esc).join(", ")} y sus alrededores. Toca tu ciudad:</p></div>
  <div class="e3chips" data-rv>${D.cities.map((c) => `<a${D.cur === c ? ' class="on"' : ""} href="${esc(D.zHref(c))}">📍 ${esc(c)}</a>`).join("")}</div>
</section></div>` : "";

  const faq = D.faqs.length ? `
<div class="e3w"><section class="e3s">
  <div data-rv><p class="e3eye">Preguntas frecuentes</p>
  <h2 class="e3t">Lo que todos <em>preguntan</em></h2></div>
  <div class="e3faq" data-rv>
    ${D.faqs.map(([q, a]) => `<details><summary>${esc(q)}</summary><div class="xa">${esc(a)}</div></details>`).join("")}
  </div>
</section></div>` : "";

  return { css, intro, html: palabra + proceso + resenas + opinBox + zonas + faq + RV_JS };
}

/* ── Template 1 · Clásico ── */
function t1(d, opts) {
  const W = wordsOf(d);
  const WS = widgetSpotBits(d);
  const c1 = d.color, c2 = shade(d.color, -0.45), cream = "#FAF8F5";
  const X = extras1(d);
  const css = `
*{box-sizing:border-box;font-family:Inter,Arial,sans-serif;margin:0;-webkit-tap-highlight-color:transparent}
body{background:#fff;color:#0F1216}
.wrap{max-width:1060px;margin:0 auto;padding:0 24px}
header{position:sticky;top:0;z-index:40;background:rgba(255,255,255,.85);backdrop-filter:blur(14px);border-bottom:1px solid #E9EAEE}
.hrow{display:flex;align-items:center;justify-content:space-between;padding:13px 0}
.hbrand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:16px}
.hbrand img{max-height:42px;max-width:140px}
.callbtn{background:${c1};color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 20px;border-radius:10px;box-shadow:0 8px 22px ${c1}44}
.hero{position:relative;color:#fff;overflow:hidden;background:${c2}}
.hero .hbg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:brightness(.8) saturate(.9)}
.hero .veil{position:absolute;inset:0;background:${d.heroImg ? `linear-gradient(165deg,${shade(d.color, -0.72)}B3 0%,${c2}80 55%,${c1}4D 100%)` : `linear-gradient(165deg,${shade(d.color, -0.72)} 0%,${c2} 60%,${c1} 100%)`}}
.hero .in{position:relative;padding:96px 0 84px;text-align:center}
.kick{display:inline-block;border:1px solid rgba(255,255,255,.35);border-radius:99px;padding:8px 18px;font-size:12px;font-weight:700;letter-spacing:3px;margin-bottom:24px}
.hero h1{font-family:'Fraunces',Georgia,serif;font-size:clamp(40px,7vw,72px);line-height:1.04;font-weight:700;max-width:820px;margin:0 auto}
.hero h1 em{font-style:italic;opacity:.92}
.hero p{opacity:.85;font-weight:500;font-size:clamp(15px,2.3vw,18px);margin:20px auto 0;max-width:540px;line-height:1.65}
.hero .cta{display:inline-block;margin:32px 7px 0;background:#fff;color:${c1};font-weight:800;font-size:16px;padding:16px 32px;border-radius:12px;text-decoration:none;box-shadow:0 18px 44px rgba(0,0,0,.35)}
.hero .cta.ghost{background:transparent;color:#fff;border:1px solid rgba(255,255,255,.45);box-shadow:none;font-weight:700}
.stats{position:relative;display:flex;justify-content:center;gap:clamp(26px,6vw,72px);padding:22px 18px 32px;flex-wrap:wrap}
.stat{text-align:center}
.stat b{font-family:'Fraunces',Georgia,serif;font-size:clamp(24px,3.6vw,34px);font-weight:700;display:block}
.stat span{font-size:11px;letter-spacing:1.5px;opacity:.75;font-weight:700;text-transform:uppercase}
.trust{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;padding:20px;background:${shade(d.color, 0.92)}}
.trust span{font-size:13px;font-weight:700;color:${shade(d.color, -0.55)}}
section{padding:74px 0}
.eyebrow{color:${c1};font-weight:800;font-size:12px;letter-spacing:3.5px;text-transform:uppercase;text-align:center}
.t{font-family:'Fraunces',Georgia,serif;font-size:clamp(30px,4.8vw,46px);font-weight:700;text-align:center;line-height:1.08;margin-top:12px}
.t em{font-style:italic;color:${c1}}
.sub{color:#5E6470;text-align:center;font-weight:500;margin:14px auto 0;max-width:560px;font-size:15.5px;line-height:1.7}
.qframe{background:#fff;border:1px solid #E9EAEE;border-radius:24px;padding:10px;max-width:450px;margin:38px auto 0;box-shadow:0 30px 80px rgba(15,18,22,.13)}
.qframe iframe{width:100%;height:530px;border:0;border-radius:16px;display:block}
.svc{display:grid;grid-template-columns:54px 1fr;gap:18px;align-items:baseline;padding:28px 6px;border-bottom:1px solid #E9EAEE}
.svc:first-of-type{border-top:1px solid #E9EAEE}
.svc .ic{font-size:30px}
.svc h3{font-family:'Fraunces',Georgia,serif;font-size:clamp(20px,2.8vw,25px);font-weight:700}
.svc p{color:#5E6470;font-size:14.5px;font-weight:500;line-height:1.65;margin-top:6px;max-width:560px}
.about{background:${cream}}
.about .bx{max-width:680px;margin:0 auto;text-align:center}
.about p.body{color:#3A4252;font-size:16.5px;font-weight:500;line-height:1.85;margin-top:22px}
.gal{display:grid;gap:16px;margin-top:38px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}
.gal img{width:100%;height:230px;object-fit:cover;border-radius:18px;border:1px solid #E9EAEE;box-shadow:0 16px 44px rgba(15,18,22,.10)}
.ctaband{position:relative;background:${shade(d.color, -0.7)};color:#fff;text-align:center;padding:86px 22px}
.ctaband h2{font-family:'Fraunces',Georgia,serif;font-size:clamp(30px,5vw,50px);font-weight:700;line-height:1.1}
.ctaband a{display:inline-block;margin:28px 7px 0;font-weight:800;font-size:16px;padding:16px 28px;border-radius:12px;text-decoration:none}
.ctaband .a1{background:#fff;color:${c1}}
.ctaband .a2{background:#25D366;color:#fff}
footer{padding:40px 22px ${opts.backAlto ? "110px" : "44px"};text-align:center;color:#9AA0AC;font-size:13px;font-weight:500;line-height:2}
footer b{color:#0F1216;font-family:'Fraunces',Georgia,serif;font-size:16px}
${X.css}${WS.css}`;
  return `${headBase(d, css)}${fontLink('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,600;0,9..144,700;1,9..144,600&family=Inter:wght@400;500;600;700;800&display=swap')}
${ribbonHtml(opts)}
<header><div class="wrap hrow">
  <span class="hbrand">${d.logo ? `<img src="${d.logo}" alt="${esc(d.biz)}">` : esc(d.biz)}</span>
  ${d.phone ? `<a class="callbtn" href="tel:+1${d.phone}">📞 ${pretty(d.phone)}</a>` : ""}
</div></header>
<div class="hero">${d.heroImg ? `<img class="hbg" src="${esc(d.heroImg)}" alt="" loading="eager">` : ""}<div class="veil"></div>
  <div class="wrap in">
    <span class="kick">${W.kickUp}${d.city ? ` · ${esc(d.city).toUpperCase()}` : ""}</span>
    <h1>${d.hero || W.hero1}</h1>
    <p>${esc(d.tagline) || W.tag1}</p>
    <a class="cta" href="#cotiza">COTIZA EN 60 SEGUNDOS</a>${d.phone ? `<a class="cta ghost" href="tel:+1${d.phone}">Llámanos</a>` : ""}
  </div>
  <div class="wrap stats">${statsCells(d).map(([b, s]) => `<div class="stat"><b>${b}</b><span>${s}</span></div>`).join("")}</div>
</div>
<div class="trust"><span>✓ ${d.license ? "Licenciado y asegurado" : "Asegurado"}</span><span>✓ Garantía por escrito</span><span>✓ ${W.insp}</span><span>✓ Hablamos español</span></div>
${X.intro}
<div class="wrap"><section id="cotiza">
  <p class="eyebrow">Cotización instantánea</p>
  <h2 class="t">Tu precio, <em>sin esperar</em></h2>
  <p class="sub">${W.wSub1}</p>
  ${WS.badge}<div class="qframe${WS.cls}"><iframe src="/w/${esc(d.slug)}" loading="lazy" title="Cotizador"></iframe></div>
</section></div>

<div class="wrap"><section style="padding-top:6px">
  <p class="eyebrow">Servicios</p>
  <h2 class="t">Lo que hacemos <em>bien</em></h2>
  <div style="margin-top:38px">
    ${d.services.map(([ic, t, x]) => `<div class="svc"><span class="ic">${ic}</span><div><h3>${esc(t)}</h3><p>${esc(x)}</p></div></div>`).join("")}
  </div>
</section></div>

${d.about ? `<div class="about"><div class="wrap"><section><div class="bx">
  <p class="eyebrow">Quiénes somos</p>
  <h2 class="t">Nuestra <em>historia</em></h2>
  <p class="body">${esc(d.about)}</p>
</div></section></div></div>` : ""}

${d.photos.length ? `<div class="wrap"><section style="padding-top:10px">
  <p class="eyebrow">Trabajos recientes</p>
  <h2 class="t">Hecho con <em>orgullo</em></h2>
  <div class="gal">${d.photos.map((p) => `<img loading="lazy" src="${esc(p)}" alt="${W.galAlt} ${esc(d.biz)}${d.city ? " en " + esc(d.city) : ""}">`).join("")}</div>
</section></div>` : ""}
${X.html}
<div class="ctaband">
  <h2>${W.cta1}</h2>
  <a class="a1" href="#cotiza">COTIZA AHORA</a>${d.phone ? `<a class="a2" href="https://wa.me/1${d.phone}">💬 WhatsApp</a>` : ""}
</div>
<footer>${footerBits(d)}</footer>
${backAltoHtml(opts)}
</body></html>`;
}

/* ── Template 2 · Fuerte (industrial poster · light steel · high energy) ── */
function t2(d, opts) {
  const W = wordsOf(d);
  const WS = widgetSpotBits(d);
  const c1 = d.color, ink = "#14171C", steel = "#F1F2F5", mut = "#5B6472", bd = "rgba(20,23,28,.09)";
  const ghost = esc(String(d.biz || (d.trade === "fence" ? "Cercas" : "Techos")).split(" ")[0].toUpperCase());
  const X = extras2(d);
  const css = `
*{box-sizing:border-box;font-family:Inter,Arial,sans-serif;margin:0;-webkit-tap-highlight-color:transparent}
body{background:${steel};color:${ink};padding-bottom:70px}
.bc{font-family:'Barlow Condensed',sans-serif}
.wrap{max-width:1140px;margin:0 auto;padding:0 26px}
header{position:sticky;top:0;z-index:40;background:${steel}E8;backdrop-filter:blur(12px);border-bottom:1px solid ${bd}}
.hrow{display:flex;align-items:center;justify-content:space-between;padding:15px 0}
.hbrand{display:flex;align-items:center;gap:11px;font-weight:800;font-size:16px;text-transform:uppercase;letter-spacing:1px;color:${ink}}
.hbrand img{max-height:42px;max-width:150px}
.callbtn{background:${c1};color:#fff;text-decoration:none;font-weight:800;font-size:14px;padding:13px 22px;border-radius:7px;text-transform:uppercase;letter-spacing:.5px;box-shadow:0 10px 26px ${c1}38}
.hero{position:relative;min-height:82vh;display:flex;align-items:center;overflow:hidden;background:${steel}}
.ghostword{position:absolute;right:-3%;bottom:-9%;font-size:33vw;font-weight:800;line-height:.8;color:${ink}08;text-transform:uppercase;pointer-events:none;white-space:nowrap;letter-spacing:-4px}
.hero .in{position:relative;padding:64px 0}
.hk{display:inline-flex;align-items:center;gap:10px;color:${ink};font-weight:800;letter-spacing:4px;font-size:12px;text-transform:uppercase}
.hk::before{content:"";width:32px;height:3px;background:${c1}}
.hero h1{font-family:'Barlow Condensed',sans-serif;font-size:clamp(58px,12vw,138px);line-height:.9;font-weight:800;text-transform:uppercase;margin-top:18px;letter-spacing:-1px;color:${ink}}
.hero h1 em{color:${c1};font-style:normal}
.hero .lede{color:${mut};font-weight:600;font-size:clamp(16px,2.1vw,19px);margin-top:24px;max-width:540px;line-height:1.6}
.ctas{margin-top:36px;display:flex;gap:12px;flex-wrap:wrap}
.btn{display:inline-block;font-weight:800;font-size:16px;padding:18px 36px;border-radius:7px;text-decoration:none;text-transform:uppercase;letter-spacing:.8px}
.btn.p{background:${c1};color:#fff;box-shadow:0 16px 40px ${c1}40}
.btn.g{background:#fff;color:${ink};border:2px solid ${bd}}
.strip{background:${c1}}
.strip .in{display:flex;flex-wrap:wrap;justify-content:space-between;gap:22px;padding:28px 0}
.strip .num b{font-family:'Barlow Condensed',sans-serif;font-size:clamp(40px,6vw,62px);font-weight:800;line-height:1;display:block;color:#fff}
.strip .num span{font-size:12px;letter-spacing:2px;font-weight:800;text-transform:uppercase;opacity:.92;color:#fff}
.quote{padding:88px 0}
.qgrid{display:grid;gap:46px;align-items:center}
@media(min-width:900px){.qgrid{grid-template-columns:1fr 440px}}
.lab{color:${c1};font-weight:800;letter-spacing:4px;font-size:12px;text-transform:uppercase}
.t{font-family:'Barlow Condensed',sans-serif;font-size:clamp(44px,7vw,76px);font-weight:800;text-transform:uppercase;line-height:.95;margin-top:10px;color:${ink}}
.t em{color:${c1};font-style:normal}
.lead{color:${mut};font-weight:600;margin-top:16px;font-size:16px;line-height:1.65;max-width:520px}
.qframe{background:#fff;border:1px solid ${bd};border-radius:12px;padding:10px;box-shadow:0 30px 80px rgba(20,23,28,.14)}
.qframe iframe{width:100%;height:540px;border:0;border-radius:7px;display:block}
.svcwrap{border-top:1px solid ${bd}}
.svc{display:grid;grid-template-columns:auto 1fr auto;gap:clamp(16px,4vw,44px);align-items:center;padding:34px 0;border-bottom:1px solid ${bd}}
.svc .no{font-family:'Barlow Condensed',sans-serif;font-size:clamp(40px,6vw,66px);font-weight:800;color:${c1};line-height:1}
.svc h3{font-family:'Barlow Condensed',sans-serif;font-size:clamp(25px,3.6vw,37px);font-weight:800;text-transform:uppercase;line-height:1;color:${ink}}
.svc p{color:${mut};font-weight:600;font-size:15px;line-height:1.6;margin-top:8px;max-width:640px}
.svc .ic{font-size:30px;opacity:.6}
.about{background:${c1};padding:86px 0}
.about .qm{font-family:'Barlow Condensed',sans-serif;font-size:96px;color:#ffffff70;line-height:.5;height:48px}
.about p{color:#fff;font-size:clamp(18px,2.4vw,25px);font-weight:600;line-height:1.55;max-width:780px;margin-top:8px}
.gal{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));padding:72px 0}
.gal img{width:100%;height:262px;object-fit:cover;border-radius:4px}
.bar{position:fixed;left:0;right:0;bottom:0;z-index:45;display:flex}
.bar a{flex:1;text-align:center;color:#fff;text-decoration:none;font-weight:800;font-size:15px;padding:18px 10px;text-transform:uppercase;letter-spacing:1px;background:${c1}}
.bar a+a{background:#1FAF52}
footer{padding:54px 26px ${opts.backAlto ? "120px" : "50px"};text-align:center;color:${mut};font-size:13px;font-weight:600;line-height:2}
footer b{color:${ink};font-family:'Barlow Condensed',sans-serif;font-size:19px;text-transform:uppercase}
${X.css}${WS.css}`;
  return `${headBase(d, css)}${fontLink('https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@0,600;0,700;0,800;1,800&family=Inter:wght@400;500;600;700;800&display=swap')}
${ribbonHtml(opts)}
<header><div class="wrap hrow">
  <span class="hbrand">${d.logo ? `<img src="${d.logo}" alt="${esc(d.biz)}">` : esc(d.biz)}</span>
  ${d.phone ? `<a class="callbtn" href="tel:+1${d.phone}">📞 ${pretty(d.phone)}</a>` : ""}
</div></header>
<div class="hero">
  <div class="ghostword bc">${ghost}</div>
  <div class="wrap in">
    <p class="hk">${W.kickSent}${d.city ? ` · ${esc(d.city).toUpperCase()}` : ""}</p>
    <h1>${d.hero || W.hero2}</h1>
    <p class="lede">${esc(d.tagline) || W.tag2}</p>
    <div class="ctas"><a class="btn p" href="#cotiza">Cotiza ya</a>${d.phone ? `<a class="btn g" href="tel:+1${d.phone}">Llámanos</a>` : ""}</div>
  </div>
</div>
<div class="strip"><div class="wrap in">${statsCells(d).map(([b, s]) => `<div class="num"><b>${b}</b><span>${s}</span></div>`).join("")}</div></div>
${X.intro}
<div class="quote" id="cotiza"><div class="wrap"><div class="qgrid">
  <div>
    <p class="lab">${W.qLab2}</p>
    <h2 class="t">Tu precio <em>en 60 segundos</em></h2>
    <p class="lead">${W.wLead2}</p>
  </div>
  ${WS.badge}<div class="qframe${WS.cls}"><iframe src="/w/${esc(d.slug)}" loading="lazy" title="Cotizador"></iframe></div>
</div></div></div>
<div class="wrap"><div class="svcwrap">
  ${d.services.map(([ic, t, x], i) => `<div class="svc"><div class="no">${String(i + 1).padStart(2, "0")}</div><div><h3>${esc(t)}</h3><p>${esc(x)}</p></div><div class="ic">${ic}</div></div>`).join("")}
</div></div>
${d.about ? `<div class="about"><div class="wrap"><div class="qm bc">&ldquo;</div><p>${esc(d.about)}</p></div></div>` : ""}
${d.photos.length ? `<div class="wrap"><div class="gal">${d.photos.map((p) => `<img loading="lazy" src="${esc(p)}" alt="${W.galAlt} ${esc(d.biz)}${d.city ? " en " + esc(d.city) : ""}">`).join("")}</div></div>` : ""}
${X.html}
<footer>${footerBits(d)}</footer>
<div class="bar"><a href="#cotiza">${W.bar2}</a>${d.phone ? `<a href="https://wa.me/1${d.phone}">💬 WhatsApp</a>` : ""}</div>
${backAltoHtml(opts)}
</body></html>`;
}

/* ── Template 3 · Limpio (warm · trust · quote-in-hero) ── */
function t3(d, opts) {
  const W = wordsOf(d);
  const WS = widgetSpotBits(d);
  const c1 = d.color, warm = "#FBFAF7", tint = shade(d.color, 0.92), ink = "#1B2330", soft = "#5C6675";
  const X = extras3(d);
  const css = `
*{box-sizing:border-box;font-family:Inter,Arial,sans-serif;margin:0;-webkit-tap-highlight-color:transparent}
body{background:${warm};color:${ink}}
.wrap{max-width:1140px;margin:0 auto;padding:0 24px}
header{position:sticky;top:0;z-index:40;background:${warm}E6;backdrop-filter:blur(12px)}
.hrow{display:flex;align-items:center;justify-content:space-between;padding:15px 0}
.hbrand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:16px}
.hbrand img{max-height:44px;max-width:150px}
.callbtn{background:${c1};color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 22px;border-radius:99px;box-shadow:0 10px 26px ${c1}3D}
.hero{padding:46px 0 64px}
.hgrid{display:grid;gap:46px;align-items:center}
@media(min-width:920px){.hgrid{grid-template-columns:1.04fr 432px}}
.pill{display:inline-block;background:#fff;border-radius:99px;padding:9px 18px;font-size:12.5px;font-weight:700;color:${shade(d.color, -0.4)};box-shadow:0 8px 22px rgba(27,35,48,.08);margin-bottom:20px}
.hero h1{font-size:clamp(38px,5.4vw,60px);line-height:1.05;font-weight:800;letter-spacing:-1.5px;max-width:620px}
.hero h1 em{color:${c1};font-style:normal}
.hero .lede{color:${soft};font-weight:500;font-size:clamp(16px,2vw,18px);margin-top:18px;max-width:480px;line-height:1.7}
.hcta{margin-top:28px;display:flex;gap:10px;flex-wrap:wrap}
.btn{display:inline-block;font-weight:800;font-size:16px;padding:16px 30px;border-radius:99px;text-decoration:none}
.btn.p{background:${c1};color:#fff;box-shadow:0 16px 40px ${c1}45}
.btn.g{background:#fff;color:${ink};box-shadow:0 8px 22px rgba(27,35,48,.09)}
.qcard{background:#fff;border-radius:30px;padding:12px;box-shadow:0 44px 100px rgba(27,35,48,.16);border:1px solid #00000008}
.qcard .qtag{display:flex;align-items:center;gap:8px;font-weight:800;font-size:13px;color:${ink};padding:8px 8px 12px}
.qcard .qtag .dot{width:9px;height:9px;border-radius:50%;background:#22C55E;box-shadow:0 0 0 4px #22C55E22}
.qcard iframe{width:100%;height:512px;border:0;border-radius:22px;display:block}
.trust{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;padding:0}
.trust span{background:#fff;border-radius:99px;padding:9px 16px;font-size:13px;font-weight:700;color:#465060;box-shadow:0 6px 18px rgba(27,35,48,.06)}
section{padding:64px 0}
.head{text-align:center}
.eye{color:${c1};font-weight:800;font-size:12px;letter-spacing:3px;text-transform:uppercase}
.t{font-size:clamp(28px,4.4vw,42px);font-weight:800;letter-spacing:-.8px;line-height:1.12;margin-top:10px}
.t em{color:${c1};font-style:normal}
.sub{color:${soft};text-align:center;font-weight:500;margin:12px auto 0;max-width:560px;font-size:15.5px;line-height:1.7}
.svcs{display:grid;gap:18px;margin-top:40px;grid-template-columns:repeat(auto-fit,minmax(250px,1fr))}
.svc{background:#fff;border-radius:26px;padding:28px;box-shadow:0 16px 44px rgba(27,35,48,.07);border:1px solid #0000000a;transition:transform .2s}
.svc:hover{transform:translateY(-4px)}
.svc .ic{width:56px;height:56px;border-radius:18px;background:${tint};display:flex;align-items:center;justify-content:center;font-size:27px}
.svc h3{font-size:18px;font-weight:800;margin:16px 0 7px;letter-spacing:-.3px}
.svc p{color:${soft};font-size:14px;font-weight:500;line-height:1.65}
.about{background:#fff;border-radius:36px;padding:48px clamp(24px,5vw,60px);box-shadow:0 24px 70px rgba(27,35,48,.08);display:grid;gap:30px;align-items:center}
@media(min-width:820px){.about{grid-template-columns:auto 1fr}}
.about .badge{width:118px;height:118px;border-radius:30px;background:${tint};display:flex;align-items:center;justify-content:center;font-size:52px;margin:0 auto}
.about .eye{text-align:left}
.about h2{text-align:left;margin-top:8px}
.about p.body{color:#3A4252;font-size:16px;font-weight:500;line-height:1.85;margin-top:14px}
.gal{display:grid;gap:16px;margin-top:38px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}
.gal img{width:100%;height:236px;object-fit:cover;border-radius:24px;box-shadow:0 16px 44px rgba(27,35,48,.1)}
.ctacard{background:linear-gradient(135deg,${c1},${shade(d.color, -0.28)});border-radius:40px;color:#fff;text-align:center;padding:64px clamp(24px,6vw,70px)}
.ctacard h2{font-size:clamp(28px,4.6vw,44px);font-weight:800;letter-spacing:-.5px;line-height:1.12}
.ctacard p{opacity:.92;font-weight:500;margin-top:12px;font-size:16px}
.ctacard a{display:inline-block;margin:26px 6px 0;font-weight:800;font-size:16px;padding:16px 30px;border-radius:99px;text-decoration:none}
.ctacard .a1{background:#fff;color:${c1}}
.ctacard .a2{background:#1FAF52;color:#fff}
footer{padding:42px 22px ${opts.backAlto ? "115px" : "46px"};text-align:center;color:#9AA3B2;font-size:13px;font-weight:500;line-height:2}
footer b{color:${ink};font-size:15px}
${X.css}${WS.css}`;
  return `${headBase(d, css)}${fontLink('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap')}
${ribbonHtml(opts)}
<header><div class="wrap hrow">
  <span class="hbrand">${d.logo ? `<img src="${d.logo}" alt="${esc(d.biz)}">` : esc(d.biz)}</span>
  ${d.phone ? `<a class="callbtn" href="tel:+1${d.phone}">📞 ${pretty(d.phone)}</a>` : ""}
</div></header>
<div class="hero"><div class="wrap"><div class="hgrid">
  <div>
    <span class="pill">${W.pill3}${d.city ? ` · ${esc(d.city)}` : ""}</span>
    <h1>${d.hero || W.hero3}</h1>
    <p class="lede">${esc(d.tagline) || W.tag3}</p>
    <div class="hcta"><a class="btn p" href="#cotiza">Cotiza gratis</a>${d.phone ? `<a class="btn g" href="tel:+1${d.phone}">📞 Llámanos</a>` : ""}</div>
  </div>
  ${WS.badge ? `<div>${WS.badge}` : ""}<div class="qcard${WS.cls}" id="cotiza">
    <div class="qtag"><span class="dot"></span> ${W.qTag3}</div>
    <iframe src="/w/${esc(d.slug)}" loading="lazy" title="Cotizador"></iframe>
  </div>${WS.badge ? "</div>" : ""}
</div>
<div class="trust" style="margin-top:36px">${statsCells(d).map(([b, s]) => `<span>✓ ${b} ${s}</span>`).join("")}<span>✓ ${W.insp}</span></div>
</div></div>
${X.intro}
<div class="wrap"><section>
  <div class="head"><p class="eye">Servicios</p><h2 class="t">¿Cómo te <em>ayudamos</em>?</h2></div>
  <div class="svcs">${d.services.map(([ic, t, x]) => `<div class="svc"><div class="ic">${ic}</div><h3>${esc(t)}</h3><p>${esc(x)}</p></div>`).join("")}</div>
</section></div>
${d.about ? `<div class="wrap"><section style="padding-top:6px"><div class="about">
  <div class="badge">🏡</div>
  <div><p class="eye">Quiénes somos</p><h2 class="t">Nuestra <em>historia</em></h2><p class="body">${esc(d.about)}</p></div>
</div></section></div>` : ""}
${d.photos.length ? `<div class="wrap"><section style="padding-top:6px">
  <div class="head"><p class="eye">Galería</p><h2 class="t">Trabajos <em>recientes</em></h2></div>
  <div class="gal">${d.photos.map((p) => `<img loading="lazy" src="${esc(p)}" alt="${W.galAlt} ${esc(d.biz)}${d.city ? " en " + esc(d.city) : ""}">`).join("")}</div>
</section></div>` : ""}
${X.html}
<div class="wrap"><section style="padding-top:6px"><div class="ctacard">
  <h2>¿Listo para empezar?</h2>
  <p>Tu cotización está a 60 segundos de distancia.</p>
  <a class="a1" href="#cotiza">Cotiza ahora</a>${d.phone ? `<a class="a2" href="https://wa.me/1${d.phone}">💬 WhatsApp</a>` : ""}
</div></section></div>
<footer>${footerBits(d)}</footer>
${backAltoHtml(opts)}
</body></html>`;
}

/* ── Template 4 · Elegante (dark luxury · serif · hairlines) ── */
function t4(d, opts) {
  const W = wordsOf(d);
  const WS = widgetSpotBits(d);
  const c1 = d.color, night = "#0D0F14", paper = "#F2EFE9", hair = "rgba(242,239,233,.14)", dim = "#A9A69E";
  const X = extras1(d);
  const css = `
*{box-sizing:border-box;font-family:Inter,Arial,sans-serif;margin:0;-webkit-tap-highlight-color:transparent}
body{background:${night};color:${paper}}
.serif{font-family:'Fraunces',Georgia,serif}
.wrap{max-width:1080px;margin:0 auto;padding:0 26px}
header{position:sticky;top:0;z-index:40;background:${night}E8;backdrop-filter:blur(12px);border-bottom:1px solid ${hair}}
.hrow{display:flex;align-items:center;justify-content:space-between;padding:16px 0}
.hbrand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:15px;letter-spacing:2px;text-transform:uppercase;color:${paper}}
.hbrand img{max-height:42px;max-width:150px}
.callbtn{border:1px solid ${c1};color:${paper};text-decoration:none;font-weight:700;font-size:13.5px;padding:12px 22px;border-radius:2px;letter-spacing:1px}
.hero{position:relative;text-align:center;padding:104px 0 84px;overflow:hidden}
.hero .hbg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.28;filter:saturate(.7)}
.hero .in{position:relative}
.kick{display:inline-block;color:${c1};font-weight:700;letter-spacing:6px;font-size:11.5px;text-transform:uppercase}
.kick::after{content:"";display:block;width:44px;height:1px;background:${c1};margin:16px auto 0}
.hero h1{font-family:'Fraunces',Georgia,serif;font-size:clamp(42px,7vw,78px);line-height:1.06;font-weight:600;margin-top:26px}
.hero h1 em{font-style:italic;color:${c1}}
.hero p{color:${dim};font-weight:400;font-size:clamp(15px,2.2vw,18px);margin:22px auto 0;max-width:560px;line-height:1.75}
.hero .cta{display:inline-block;margin:34px 8px 0;background:${c1};color:#fff;font-weight:700;font-size:14.5px;letter-spacing:1.5px;padding:17px 38px;border-radius:2px;text-decoration:none;text-transform:uppercase}
.hero .cta.ghost{background:transparent;border:1px solid ${hair};color:${paper}}
.stats{display:flex;justify-content:center;gap:0;margin-top:56px;border-top:1px solid ${hair};border-bottom:1px solid ${hair}}
.stat{padding:22px clamp(18px,5vw,54px);text-align:center}
.stat+.stat{border-left:1px solid ${hair}}
.stat b{font-family:'Fraunces',Georgia,serif;font-size:clamp(22px,3.4vw,32px);font-weight:600;display:block;color:${paper}}
.stat span{font-size:10.5px;letter-spacing:2.5px;color:${dim};font-weight:600;text-transform:uppercase}
section{padding:78px 0}
.eye{color:${c1};font-weight:700;font-size:11.5px;letter-spacing:5px;text-transform:uppercase;text-align:center}
.t{font-family:'Fraunces',Georgia,serif;font-size:clamp(30px,4.6vw,46px);font-weight:600;text-align:center;line-height:1.1;margin-top:14px}
.t em{font-style:italic;color:${c1}}
.sub{color:${dim};text-align:center;font-weight:400;margin:14px auto 0;max-width:540px;font-size:15px;line-height:1.75}
.qframe{background:#fff;border-radius:4px;padding:10px;max-width:450px;margin:40px auto 0;box-shadow:0 40px 100px rgba(0,0,0,.5)}
.qframe iframe{width:100%;height:530px;border:0;border-radius:2px;display:block}
.svcs{max-width:820px;margin:44px auto 0;border-top:1px solid ${hair}}
.svc{display:grid;grid-template-columns:auto 1fr;gap:22px;align-items:baseline;padding:30px 6px;border-bottom:1px solid ${hair}}
.svc .ic{font-size:26px;opacity:.85}
.svc h3{font-family:'Fraunces',Georgia,serif;font-size:clamp(20px,2.8vw,26px);font-weight:600;color:${paper}}
.svc p{color:${dim};font-size:14.5px;font-weight:400;line-height:1.7;margin-top:7px;max-width:560px}
.aboutb{border-top:1px solid ${hair};border-bottom:1px solid ${hair}}
.aboutb .bx{max-width:680px;margin:0 auto;text-align:center}
.aboutb p.body{color:${paper};font-family:'Fraunces',Georgia,serif;font-size:clamp(17px,2.4vw,22px);font-weight:400;font-style:italic;line-height:1.85;margin-top:22px;opacity:.92}
.gal{display:grid;gap:14px;margin-top:40px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}
.gal img{width:100%;height:250px;object-fit:cover;border-radius:3px;filter:saturate(.92)}
.ctaband{border-top:1px solid ${hair};text-align:center;padding:88px 22px}
.ctaband h2{font-family:'Fraunces',Georgia,serif;font-size:clamp(30px,5vw,52px);font-weight:600;line-height:1.1;color:${paper}}
.ctaband a{display:inline-block;margin:30px 8px 0;font-weight:700;font-size:14.5px;letter-spacing:1.5px;padding:17px 34px;border-radius:2px;text-decoration:none;text-transform:uppercase}
.ctaband .a1{background:${c1};color:#fff}
.ctaband .a2{border:1px solid ${hair};color:${paper}}
footer{padding:44px 22px ${opts.backAlto ? "115px" : "48px"};text-align:center;color:${dim};font-size:13px;font-weight:400;line-height:2;border-top:1px solid ${hair}}
footer b{color:${paper};font-family:'Fraunces',Georgia,serif;font-size:16px}
${X.css}${WS.css}`;
  return `${headBase(d, css)}${fontLink('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;1,9..144,400;1,9..144,600&family=Inter:wght@400;500;600;700&display=swap')}
${ribbonHtml(opts)}
<header><div class="wrap hrow">
  <span class="hbrand">${d.logo ? `<img src="${d.logo}" alt="${esc(d.biz)}">` : esc(d.biz)}</span>
  ${d.phone ? `<a class="callbtn" href="tel:+1${d.phone}">📞 ${pretty(d.phone)}</a>` : ""}
</div></header>
<div class="hero">${d.heroImg ? `<img class="hbg" src="${esc(d.heroImg)}" alt="" loading="eager">` : ""}
  <div class="wrap in">
    <span class="kick">${W.kickUp}${d.city ? ` · ${esc(d.city).toUpperCase()}` : ""}</span>
    <h1>${d.hero || W.hero1}</h1>
    <p>${esc(d.tagline) || W.tag1}</p>
    <a class="cta" href="#cotiza">Cotiza gratis</a>${d.phone ? `<a class="cta ghost" href="tel:+1${d.phone}">Llámanos</a>` : ""}
  </div>
  <div class="wrap"><div class="stats">${statsCells(d).map(([b, s]) => `<div class="stat"><b>${b}</b><span>${s}</span></div>`).join("")}</div></div>
</div>
${X.intro}
<div class="wrap"><section id="cotiza">
  <p class="eye">Cotización instantánea</p>
  <h2 class="t">Tu precio, <em>sin esperar</em></h2>
  <p class="sub">${W.wSub1}</p>
  ${WS.badge}<div class="qframe${WS.cls}"><iframe src="/w/${esc(d.slug)}" loading="lazy" title="Cotizador"></iframe></div>
</section></div>
<div class="wrap"><section style="padding-top:0">
  <p class="eye">Servicios</p>
  <h2 class="t">Lo que hacemos <em>bien</em></h2>
  <div class="svcs">${d.services.map(([ic, t, x]) => `<div class="svc"><span class="ic">${ic}</span><div><h3>${esc(t)}</h3><p>${esc(x)}</p></div></div>`).join("")}</div>
</section></div>
${d.about ? `<div class="aboutb"><div class="wrap"><section><div class="bx">
  <p class="eye">Quiénes somos</p>
  <p class="body">&ldquo;${esc(d.about)}&rdquo;</p>
</div></section></div></div>` : ""}
${d.photos.length ? `<div class="wrap"><section>
  <p class="eye">Trabajos recientes</p>
  <h2 class="t">Hecho con <em>orgullo</em></h2>
  <div class="gal">${d.photos.map((p) => `<img loading="lazy" src="${esc(p)}" alt="${W.galAlt} ${esc(d.biz)}${d.city ? " en " + esc(d.city) : ""}">`).join("")}</div>
</section></div>` : ""}
${X.html}
<div class="ctaband">
  <h2>${W.cta1}</h2>
  <a class="a1" href="#cotiza">Cotiza ahora</a>${d.phone ? `<a class="a2" href="https://wa.me/1${d.phone}">💬 WhatsApp</a>` : ""}
</div>
<footer>${footerBits(d)}</footer>
${backAltoHtml(opts)}
</body></html>`;
}

/* ── Template 5 · Vivo (photo-first · full-bleed hero · vibrant) ── */
function t5(d, opts) {
  const W = wordsOf(d);
  const WS = widgetSpotBits(d);
  const c1 = d.color, ink = "#171A21", soft = "#5A6371", tint = shade(d.color, 0.9);
  const X = extras3(d);
  const css = `
*{box-sizing:border-box;font-family:Inter,Arial,sans-serif;margin:0;-webkit-tap-highlight-color:transparent}
body{background:#fff;color:${ink}}
.wrap{max-width:1140px;margin:0 auto;padding:0 24px}
header{position:absolute;top:0;left:0;right:0;z-index:40}
.hrow{display:flex;align-items:center;justify-content:space-between;padding:18px 0}
.hbrand{display:flex;align-items:center;gap:10px;font-weight:900;font-size:17px;color:#fff;text-shadow:0 2px 12px rgba(0,0,0,.4)}
.hbrand img{max-height:44px;max-width:150px;filter:drop-shadow(0 2px 10px rgba(0,0,0,.35))}
.callbtn{background:#ffffffE6;color:${ink};text-decoration:none;font-weight:800;font-size:14px;padding:12px 20px;border-radius:99px;backdrop-filter:blur(8px)}
.hero{position:relative;min-height:88vh;display:flex;align-items:flex-end;overflow:hidden;background:linear-gradient(150deg,${shade(d.color, -0.45)},${shade(d.color, -0.75)})}
.hero .hbg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.hero .veil{position:absolute;inset:0;background:linear-gradient(180deg,rgba(10,12,16,.25) 0%,rgba(10,12,16,.05) 40%,rgba(10,12,16,.78) 100%)}
.hero .in{position:relative;width:100%;padding:0 0 54px;color:#fff}
.pill{display:inline-block;background:#ffffff26;border:1px solid #ffffff45;backdrop-filter:blur(8px);border-radius:99px;padding:9px 18px;font-size:12.5px;font-weight:800;letter-spacing:1px;text-transform:uppercase}
.hero h1{font-size:clamp(42px,7vw,82px);line-height:1.0;font-weight:900;letter-spacing:-2px;margin-top:18px;max-width:760px;text-shadow:0 4px 30px rgba(0,0,0,.35)}
.hero h1 em{font-style:normal;color:#fff;border-bottom:6px solid ${c1}}
.hero .lede{font-weight:600;font-size:clamp(15px,2vw,18px);margin-top:16px;max-width:520px;line-height:1.6;opacity:.94}
.hcta{margin-top:26px;display:flex;gap:10px;flex-wrap:wrap}
.btn{display:inline-block;font-weight:800;font-size:16px;padding:17px 32px;border-radius:99px;text-decoration:none}
.btn.p{background:${c1};color:#fff;box-shadow:0 18px 50px rgba(0,0,0,.35)}
.btn.g{background:#ffffffE8;color:${ink}}
.stripe{background:${ink};color:#fff}
.stripe .in{display:flex;flex-wrap:wrap;justify-content:center;gap:clamp(24px,6vw,76px);padding:26px 0}
.stripe b{font-size:clamp(22px,3.2vw,30px);font-weight:900;display:block}
.stripe span{font-size:11px;letter-spacing:2px;font-weight:700;opacity:.75;text-transform:uppercase}
section{padding:70px 0}
.eye{color:${c1};font-weight:900;font-size:12px;letter-spacing:3px;text-transform:uppercase;text-align:center}
.t{font-size:clamp(30px,4.8vw,46px);font-weight:900;letter-spacing:-1.4px;text-align:center;line-height:1.06;margin-top:10px}
.t em{font-style:normal;color:${c1}}
.sub{color:${soft};text-align:center;font-weight:500;margin:12px auto 0;max-width:560px;font-size:15.5px;line-height:1.7}
.gal{display:grid;gap:12px;margin-top:38px;grid-template-columns:repeat(auto-fit,minmax(250px,1fr))}
.gal img{width:100%;height:300px;object-fit:cover;border-radius:22px}
.qframe{background:#fff;border-radius:28px;padding:12px;max-width:460px;margin:40px auto 0;box-shadow:0 40px 110px rgba(23,26,33,.22);border:1px solid #00000009}
.qframe iframe{width:100%;height:530px;border:0;border-radius:18px;display:block}
.svcs{display:grid;gap:16px;margin-top:40px;grid-template-columns:repeat(auto-fit,minmax(250px,1fr))}
.svc{background:${tint};border-radius:24px;padding:26px}
.svc .ic{font-size:34px}
.svc h3{font-size:18.5px;font-weight:900;margin:14px 0 7px;letter-spacing:-.3px}
.svc p{color:${shade(d.color, -0.5)};font-size:14px;font-weight:600;line-height:1.6;opacity:.85}
.aboutb{background:${ink};color:#fff;border-radius:36px;padding:56px clamp(24px,5vw,64px);text-align:center}
.aboutb p.body{font-size:clamp(16px,2.3vw,21px);font-weight:600;line-height:1.8;max-width:760px;margin:18px auto 0;opacity:.95}
.ctacard{background:linear-gradient(135deg,${c1},${shade(d.color, -0.3)});border-radius:36px;color:#fff;text-align:center;padding:62px clamp(24px,6vw,70px)}
.ctacard h2{font-size:clamp(28px,4.6vw,44px);font-weight:900;letter-spacing:-1px;line-height:1.1}
.ctacard a{display:inline-block;margin:26px 6px 0;font-weight:800;font-size:16px;padding:16px 30px;border-radius:99px;text-decoration:none}
.ctacard .a1{background:#fff;color:${c1}}
.ctacard .a2{background:#1FAF52;color:#fff}
footer{padding:42px 22px ${opts.backAlto ? "115px" : "46px"};text-align:center;color:#9AA3B2;font-size:13px;font-weight:500;line-height:2}
footer b{color:${ink};font-size:15px}
${X.css}${WS.css}`;
  return `${headBase(d, css)}${fontLink('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap')}
${ribbonHtml(opts)}
<div class="hero">${d.heroImg ? `<img class="hbg" src="${esc(d.heroImg)}" alt="" loading="eager">` : ""}<div class="veil"></div>
<header><div class="wrap hrow">
  <span class="hbrand">${d.logo ? `<img src="${d.logo}" alt="${esc(d.biz)}">` : esc(d.biz)}</span>
  ${d.phone ? `<a class="callbtn" href="tel:+1${d.phone}">📞 ${pretty(d.phone)}</a>` : ""}
</div></header>
  <div class="wrap in">
    <span class="pill">${W.icon} ${W.kickSent}${d.city ? ` · ${esc(d.city)}` : ""}</span>
    <h1>${d.hero || W.hero2}</h1>
    <p class="lede">${esc(d.tagline) || W.tag2}</p>
    <div class="hcta"><a class="btn p" href="#cotiza">${W.bar2}</a>${d.phone ? `<a class="btn g" href="tel:+1${d.phone}">📞 Llámanos</a>` : ""}</div>
  </div>
</div>
<div class="stripe"><div class="wrap in">${statsCells(d).map(([b, s]) => `<div style="text-align:center"><b>${b}</b><span>${s}</span></div>`).join("")}</div></div>
${d.photos.length ? `<div class="wrap"><section style="padding-bottom:10px">
  <p class="eye">Galería</p><h2 class="t">Nuestro trabajo <em>habla</em></h2>
  <div class="gal">${d.photos.map((p) => `<img loading="lazy" src="${esc(p)}" alt="${W.galAlt} ${esc(d.biz)}${d.city ? " en " + esc(d.city) : ""}">`).join("")}</div>
</section></div>` : ""}
${X.intro}
<div class="wrap"><section id="cotiza">
  <p class="eye">${W.qLab2}</p>
  <h2 class="t">Tu precio <em>al instante</em></h2>
  <p class="sub">${W.wLead2}</p>
  ${WS.badge}<div class="qframe${WS.cls}"><iframe src="/w/${esc(d.slug)}" loading="lazy" title="Cotizador"></iframe></div>
</section></div>
<div class="wrap"><section style="padding-top:0">
  <p class="eye">Servicios</p><h2 class="t">¿Cómo te <em>ayudamos</em>?</h2>
  <div class="svcs">${d.services.map(([ic, t, x]) => `<div class="svc"><div class="ic">${ic}</div><h3>${esc(t)}</h3><p>${esc(x)}</p></div>`).join("")}</div>
</section></div>
${d.about ? `<div class="wrap"><section style="padding-top:0"><div class="aboutb">
  <p class="eye" style="color:#fff;opacity:.8">Quiénes somos</p>
  <p class="body">${esc(d.about)}</p>
</div></section></div>` : ""}
${X.html}
<div class="wrap"><section style="padding-top:0"><div class="ctacard">
  <h2>${W.cta1}</h2>
  <a class="a1" href="#cotiza">Cotiza ahora</a>${d.phone ? `<a class="a2" href="https://wa.me/1${d.phone}">💬 WhatsApp</a>` : ""}
</div></section></div>
<footer>${footerBits(d)}</footer>
${backAltoHtml(opts)}
</body></html>`;
}

/* ── Template 6 · Sencilla (minimal editorial · one column · quiet) ── */
function t6(d, opts) {
  const W = wordsOf(d);
  const WS = widgetSpotBits(d);
  const c1 = d.color, ink = "#16181D", mut = "#6A7280", line = "#ECEDF0";
  const X = extras1(d);
  const css = `
*{box-sizing:border-box;font-family:Inter,Arial,sans-serif;margin:0;-webkit-tap-highlight-color:transparent}
body{background:#fff;color:${ink};border-top:5px solid ${c1}}
.wrap{max-width:780px;margin:0 auto;padding:0 24px}
header{border-bottom:1px solid ${line}}
.hrow{display:flex;align-items:center;justify-content:space-between;padding:18px 0}
.hbrand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:16px;letter-spacing:-.3px}
.hbrand img{max-height:42px;max-width:150px}
.callbtn{color:${ink};text-decoration:none;font-weight:700;font-size:14.5px;border-bottom:2px solid ${c1};padding-bottom:2px}
.hero{padding:78px 0 56px}
.kick{color:${c1};font-weight:800;font-size:12px;letter-spacing:3px;text-transform:uppercase}
.hero h1{font-size:clamp(38px,6vw,64px);line-height:1.04;font-weight:800;letter-spacing:-2.2px;margin-top:16px}
.hero h1 em{font-style:normal;color:${c1}}
.hero p{color:${mut};font-weight:500;font-size:clamp(16px,2.1vw,18px);margin-top:18px;max-width:560px;line-height:1.75}
.hcta{margin-top:28px;display:flex;gap:18px;align-items:center;flex-wrap:wrap}
.btn{display:inline-block;background:${ink};color:#fff;font-weight:800;font-size:15.5px;padding:16px 30px;border-radius:10px;text-decoration:none}
.lnk{color:${ink};font-weight:700;font-size:15px;text-decoration:none;border-bottom:2px solid ${c1};padding-bottom:2px}
.facts{display:flex;gap:clamp(22px,5vw,54px);flex-wrap:wrap;padding:22px 0;border-top:1px solid ${line};border-bottom:1px solid ${line}}
.facts b{font-size:20px;font-weight:800;display:block;letter-spacing:-.5px}
.facts span{font-size:11.5px;letter-spacing:1.5px;color:${mut};font-weight:600;text-transform:uppercase}
section{padding:60px 0}
.eye{color:${c1};font-weight:800;font-size:11.5px;letter-spacing:3px;text-transform:uppercase}
.t{font-size:clamp(26px,4vw,38px);font-weight:800;letter-spacing:-1.2px;line-height:1.12;margin-top:10px}
.t em{font-style:normal;color:${c1}}
.sub{color:${mut};font-weight:500;margin-top:12px;max-width:560px;font-size:15.5px;line-height:1.75}
.qframe{border:1px solid ${line};border-radius:16px;padding:8px;margin-top:30px;box-shadow:0 20px 60px rgba(22,24,29,.07)}
.qframe iframe{width:100%;height:530px;border:0;border-radius:10px;display:block}
.svc{display:grid;grid-template-columns:44px 1fr;gap:16px;align-items:baseline;padding:22px 0;border-bottom:1px solid ${line}}
.svc:first-of-type{border-top:1px solid ${line};margin-top:30px}
.svc .ic{font-size:26px}
.svc h3{font-size:18px;font-weight:800;letter-spacing:-.3px}
.svc p{color:${mut};font-size:14.5px;font-weight:500;line-height:1.7;margin-top:5px}
.aboutb{background:#FAFAFB;border-radius:18px;padding:36px clamp(22px,4vw,44px);border:1px solid ${line}}
.aboutb p.body{color:#3A4252;font-size:16px;font-weight:500;line-height:1.85;margin-top:12px}
.gal{display:grid;gap:12px;margin-top:30px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}
.gal img{width:100%;height:220px;object-fit:cover;border-radius:14px;border:1px solid ${line}}
.ctab{border:1.5px solid ${ink};border-radius:18px;text-align:center;padding:46px clamp(22px,5vw,54px)}
.ctab h2{font-size:clamp(26px,4vw,38px);font-weight:800;letter-spacing:-1px;line-height:1.1}
.ctab a{display:inline-block;margin:22px 6px 0;font-weight:800;font-size:15.5px;padding:15px 28px;border-radius:10px;text-decoration:none}
.ctab .a1{background:${c1};color:#fff}
.ctab .a2{background:#fff;color:${ink};border:1.5px solid ${line}}
footer{padding:38px 22px ${opts.backAlto ? "112px" : "42px"};text-align:center;color:#9AA3B2;font-size:13px;font-weight:500;line-height:2;border-top:1px solid ${line}}
footer b{color:${ink};font-size:15px}
${X.css}${WS.css}`;
  return `${headBase(d, css)}${fontLink('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap')}
${ribbonHtml(opts)}
<header><div class="wrap hrow">
  <span class="hbrand">${d.logo ? `<img src="${d.logo}" alt="${esc(d.biz)}">` : esc(d.biz)}</span>
  ${d.phone ? `<a class="callbtn" href="tel:+1${d.phone}">📞 ${pretty(d.phone)}</a>` : ""}
</div></header>
<div class="wrap"><div class="hero">
  <span class="kick">${W.kickUp}${d.city ? ` · ${esc(d.city).toUpperCase()}` : ""}</span>
  <h1>${d.hero || W.hero3}</h1>
  <p>${esc(d.tagline) || W.tag3}</p>
  <div class="hcta"><a class="btn" href="#cotiza">Cotiza gratis</a>${d.phone ? `<a class="lnk" href="tel:+1${d.phone}">📞 ${pretty(d.phone)}</a>` : ""}</div>
</div>
<div class="facts">${statsCells(d).map(([b, s]) => `<div><b>${b}</b><span>${s}</span></div>`).join("")}</div></div>
${X.intro}
<div class="wrap"><section id="cotiza">
  <p class="eye">Cotización instantánea</p>
  <h2 class="t">Tu precio, <em>sin esperar</em></h2>
  <p class="sub">${W.wSub1}</p>
  ${WS.badge}<div class="qframe${WS.cls}"><iframe src="/w/${esc(d.slug)}" loading="lazy" title="Cotizador"></iframe></div>
</section></div>
<div class="wrap"><section style="padding-top:0">
  <p class="eye">Servicios</p>
  <h2 class="t">Lo que hacemos <em>bien</em></h2>
  ${d.services.map(([ic, t, x]) => `<div class="svc"><span class="ic">${ic}</span><div><h3>${esc(t)}</h3><p>${esc(x)}</p></div></div>`).join("")}
</section></div>
${d.about ? `<div class="wrap"><section style="padding-top:0"><div class="aboutb">
  <p class="eye">Quiénes somos</p>
  <p class="body">${esc(d.about)}</p>
</div></section></div>` : ""}
${d.photos.length ? `<div class="wrap"><section style="padding-top:0">
  <p class="eye">Trabajos recientes</p>
  <h2 class="t">Hecho con <em>orgullo</em></h2>
  <div class="gal">${d.photos.map((p) => `<img loading="lazy" src="${esc(p)}" alt="${W.galAlt} ${esc(d.biz)}${d.city ? " en " + esc(d.city) : ""}">`).join("")}</div>
</section></div>` : ""}
${X.html}
<div class="wrap"><section style="padding-top:0"><div class="ctab">
  <h2>${W.cta1}</h2>
  <a class="a1" href="#cotiza">Cotiza ahora</a>${d.phone ? `<a class="a2" href="https://wa.me/1${d.phone}">💬 WhatsApp</a>` : ""}
</div></section></div>
<footer>${footerBits(d)}</footer>
${backAltoHtml(opts)}
</body></html>`;
}

const TEMPLATES = { 1: t1, 2: t2, 3: t3, 4: t4, 5: t5, 6: t6 };

export function renderSite(data, opts = {}) {
  const d = {
    services: data && data.trade === "fence" ? FENCE_SERVICES : DEFAULT_SERVICES,
    photos: [],
    color: "#B30F24",
    ...data,
  };
  // Sanitize every value that reaches an UNescaped sink (CSS color, <img src>,
  // raw hero HTML, service icon) — contractor/staff-entered fields must not be
  // able to inject script or break out of a style/attribute on the public page.
  d.color = /^#[0-9a-fA-F]{6}$/.test(String(d.color || "")) ? d.color : "#B30F24";
  const logo = String(d.logo || "");
  d.logo = (/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(logo) || /^https:\/\/[^"'\s>]+$/.test(logo)) ? d.logo : null;
  if (d.hero) d.hero = esc(d.hero).replace(/&lt;(\/?(?:br|em))&gt;/g, "<$1>"); // allow only <br>/<em>, nothing else
  if (Array.isArray(d.services)) {
    d.services = d.services.map((s) => {
      if (Array.isArray(s)) return [esc(s[0]), s[1], s[2]];
      const t = String(s || "").trim();
      if (!t) return null;
      const hit = SVC_LOOKUP.find(([re]) => re.test(t));
      return [hit ? hit[1] : "✅", t, hit ? hit[2] : "Pregúntanos por el chat — con gusto te decimos cómo funciona."];
    }).filter(Boolean);
    if (!d.services.length) d.services = d.trade === "fence" ? FENCE_SERVICES : DEFAULT_SERVICES;
  }
  // Photos are uploaded through the app and served from /api/logo/<id> —
  // relative paths are ours and safe; absolute ones must be clean URLs.
  // /api/roofimg (our satellite renderer) is allowed for demo galleries.
  if (Array.isArray(d.photos)) d.photos = d.photos.filter((p) => /^https?:\/\/[^"'\s>]+$/.test(String(p || "")) || /^\/api\/logo\/[a-f0-9]{16}\.(png|jpg)$/.test(String(p || "")) || /^\/api\/roofimg\?[A-Za-z0-9=&.,_-]{1,200}$/.test(String(p || "")) || /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(String(p || "")));
  // SEO/content inputs — everything lands in escaped sinks, but URLs and
  // paths also get shape-checked here since they reach href/src/JSON-LD.
  d.pageCity = String(d.pageCity || "").slice(0, 60);
  d.area = String(d.area || "").slice(0, 200);
  d.warranty = String(d.warranty || "").slice(0, 160);
  d.diff = String(d.diff || "").slice(0, 400);
  d._cities = areaCities(d.area);
  d.canonical = /^https?:\/\/[^\s"'<>]+$/.test(String(d.canonical || "")) ? d.canonical : "";
  d.facebook = /^https:\/\/[^\s"'<>]{8,300}$/.test(String(d.facebook || "")) ? d.facebook : "";
  d.instagram = /^https:\/\/[^\s"'<>]{8,300}$/.test(String(d.instagram || "")) ? d.instagram : "";
  d.ogImage = /^https?:\/\/[^\s"'<>]+$/.test(String(d.ogImage || "")) ? d.ogImage : "";
  d.heroImg = /^\/landing\/[a-z0-9-]+\.(jpg|png|webp)$/.test(String(d.heroImg || "")) || /^\/api\/logo\/[a-f0-9]{16}\.(png|jpg)$/.test(String(d.heroImg || "")) || /^https:\/\/[^"'\s>]+$/.test(String(d.heroImg || "")) ? d.heroImg : "";
  d.basePath = /^\/site\/[a-z0-9-]+$/.test(String(d.basePath || "")) ? d.basePath : "";
  d.opinaHref = /^\/opina(\/[a-z0-9-]+)?$/.test(String(d.opinaHref || "")) ? d.opinaHref : "";
  d.reviews = (Array.isArray(d.reviews) ? d.reviews : [])
    .filter((r) => r && r.t && r.s >= 4)
    .slice(-6).reverse()
    .map((r) => ({ s: Math.max(1, Math.min(5, Math.round(r.s))), n: String(r.n || "").slice(0, 60), t: String(r.t || "").slice(0, 300) }));
  d._faqs = mergeFaqs(Array.isArray(d.clientFaqs) ? d.clientFaqs : [], faqsOf(d, d._cities));
  const fn = TEMPLATES[String(d.template || "1")] || t1;
  let html = fn(d, opts);
  // Every client site ships with the AI chat assistant (the same engine the
  // sales deck demos). It answers 24/7 and turns phone numbers into leads.
  // Injected at the TOP of <body>: it's position:fixed anyway, and this way a
  // slow stylesheet (fonts CDN) can never stall the parser before the widget.
  if (d.slug && opts.chat !== false) html = html.replace(/(<body[^>]*>)/, `$1${chatHtml(d)}`);
  return html;
}

/* Floating AI chat bubble injected into every template. Improve it here and
 * every client site upgrades at once. Talks to /api/widget/chat with the
 * site's slug so the AI answers as THIS contractor's business. */
export function chatHtml(d) {
  const js = (v) => JSON.stringify(String(v || "")).replace(/</g, "\\u003c");
  // Template 2 has a fixed bottom CTA bar — float the bubble above it.
  const lift = String(d.template) === "2" ? 72 : 16;
  return `<style>
#apw-btn{position:fixed;right:16px;bottom:${lift}px;z-index:70;width:58px;height:58px;border-radius:50%;border:none;background:${d.color};color:#fff;font-size:26px;cursor:pointer;box-shadow:0 10px 30px rgba(0,0,0,.32);display:flex;align-items:center;justify-content:center}
#apw-box{position:fixed;right:12px;bottom:${lift + 68}px;z-index:70;width:min(92vw,352px);background:#fff;border-radius:18px;box-shadow:0 24px 70px rgba(0,0,0,.35);display:none;flex-direction:column;overflow:hidden;font-family:Inter,Arial,sans-serif}
#apw-box.on{display:flex}
#apw-hd{background:${d.color};color:#fff;padding:13px 16px}
#apw-hd b{font-size:15px;display:block}
#apw-hd span{font-size:11.5px;opacity:.88;font-weight:600}
#apw-test{background:#101B30;color:#F8B408;font-size:11px;font-weight:800;text-align:center;padding:6px 10px;letter-spacing:.3px}
#apw-msgs{height:min(46vh,340px);overflow-y:auto;padding:14px 12px;display:flex;flex-direction:column;gap:8px;background:#F6F7FA}
.apw-m{max-width:84%;padding:9px 12px;border-radius:14px;font-size:13.5px;line-height:1.45;white-space:pre-wrap;word-break:break-word}
.apw-a{background:#fff;border:1px solid #E8EAF0;align-self:flex-start;border-bottom-left-radius:4px;color:#1A2233}
.apw-u{background:${d.color};color:#fff;align-self:flex-end;border-bottom-right-radius:4px}
#apw-in{display:flex;gap:8px;padding:10px;background:#fff;border-top:1px solid #EEF0F4}
#apw-in input{flex:1;border:1.5px solid #E4E7EE;border-radius:11px;padding:10px 12px;font-size:14px;outline:none;font-family:inherit;min-width:0}
#apw-in button{border:none;background:${d.color};color:#fff;border-radius:11px;padding:0 15px;font-size:16px;cursor:pointer}
</style>
<button id="apw-btn" aria-label="Abrir chat">💬</button>
<div id="apw-box" role="dialog" aria-label="Chat">
  ${d.testMode ? `<div id="apw-test">🧪 MODO PRUEBA — este chat no crea leads reales ni avisa al negocio</div>` : ""}
  <div id="apw-hd"><b>${esc(d.biz)}</b><span>🟢 En línea — contesta en segundos</span></div>
  <div id="apw-msgs"></div>
  <div id="apw-in"><input id="apw-t" placeholder="Escribe tu pregunta…" maxlength="300"><button id="apw-s" aria-label="Enviar">➤</button></div>
</div>
<script>(function(){
// Embedded quote widget announces a submitted lead (postMessage). When this
// site is itself inside the sales deck, relay it up so the app mockup dings.
window.addEventListener('message',function(e){var d=e.data;if(d&&d.alto==='lead'&&window.parent!==window){try{parent.postMessage(d,'*')}catch(err){}}});
var slug=${js(d.slug)},biz=${js(d.biz)},topic=${js(wordsOf(d).chatTopic)},hist=[],leadSent=false,busy=false,testMode=${d.testMode ? "true" : "false"};
var box=document.getElementById('apw-box'),msgs=document.getElementById('apw-msgs'),inp=document.getElementById('apw-t');
function add(role,text){var e=document.createElement('div');e.className='apw-m '+(role==='assistant'?'apw-a':'apw-u');e.textContent=text;msgs.appendChild(e);msgs.scrollTop=msgs.scrollHeight;return e;}
document.getElementById('apw-btn').onclick=function(){box.classList.toggle('on');if(box.classList.contains('on')){if(!hist.length){var hi='\\u00a1Hola! \\ud83d\\udc4b Soy el asistente de '+biz+'. Preg\\u00fantame lo que sea de tu '+topic+' \\u2014 o d\\u00e9jame tu nombre y tel\\u00e9fono y te llamamos hoy.';hist.push({role:'assistant',content:hi});add('assistant',hi);}inp.focus();}};
function send(){var t=inp.value.trim();if(!t||busy)return;busy=true;inp.value='';hist.push({role:'user',content:t});add('user',t);
// Tell the embedding page (the sales deck) when a phone number lands, so its
// app mockup can show the lead arriving live. No-op on a normal visit.
var pm=t.match(/\\+?1?[\\s.\\-]?\\(?\\d{3}\\)?[\\s.\\-]?\\d{3}[\\s.\\-]?\\d{4}/);
if(pm){var dg=pm[0].replace(/\\D/g,'').replace(/^1(?=\\d{10}$)/,'');if(dg.length===10){
  var nm='';var nmm=t.match(/(?:me llamo|mi nombre es|soy|my name is|i am|i'm|this is)[\\s:]+([a-zA-Z\\u00c0-\\u017f]+(?:\\s+[a-zA-Z\\u00c0-\\u017f]+)?)/i);
  if(nmm&&!/^(de|del|la|el|un|una|cliente|yo|the|a)$/i.test(nmm[1].split(/\\s/)[0]))nm=nmm[1].slice(0,40);
  try{parent.postMessage({alto:'lead',phone:dg,name:nm,text:t},'*');}catch(e){}
}}
var w=add('assistant','\\u2026');
fetch('/api/widget/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({slug:slug,messages:hist.slice(-12),leadSent:leadSent,test:testMode})})
.then(function(r){return r.json()}).then(function(j){var tx=j.text||'Perd\\u00f3n, intenta de nuevo \\u2014 o ll\\u00e1manos directo.';if(j.captured)leadSent=true;w.textContent=tx;hist.push({role:'assistant',content:tx});})
.catch(function(){w.textContent='Sin conexi\\u00f3n \\u2014 intenta de nuevo.';}).then(function(){busy=false;msgs.scrollTop=msgs.scrollHeight;});}
document.getElementById('apw-s').onclick=send;
inp.addEventListener('keydown',function(e){if(e.key==='Enter')send();});
if(/[?&]chat=(open|1)/.test(location.search)){setTimeout(function(){document.getElementById('apw-btn').click();},500);}
})();</script>`;
}
