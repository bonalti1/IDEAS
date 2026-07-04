// ============================================================
// Ranch Land Group — lead-webhook (Supabase Edge Function)
//
// Recibe el POST del formulario de la landing:
//   { nombre, tel, email, fuente, fecha, interes?, tag? }
// Guarda (upsert) el lead en buyer_leads y notifica a Rolando.
//
// Deploy:
//   supabase functions deploy lead-webhook --no-verify-jwt
//
// Secrets (Dashboard > Edge Functions > Secrets, o CLI):
//   supabase secrets set NOTIFY_EMAIL=rolando@alto-realtygroup.com
//   supabase secrets set RESEND_API_KEY=re_xxx          (opcional, para email)
//   supabase secrets set WA_TOKEN=EAAG...               (opcional, WhatsApp Cloud API)
//   supabase secrets set WA_PHONE_ID=1234567890         (opcional)
//   supabase secrets set WA_NOTIFY_TO=52181XXXXXXXX     (opcional, tu número)
//
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY las inyecta Supabase solo.
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

function tagFor(interes?: string, tag?: string): string {
  const valid = ["inversionista", "cazador", "lista_espera"];
  if (tag && valid.includes(tag)) return tag;
  if (interes === "inversion" || interes === "ambos") return "inversionista";
  if (interes === "caza") return "cazador";
  return "lista_espera";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), {
      status: 405,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  let body: Record<string, string>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const nombre = (body.nombre ?? "").trim();
  const telefono = (body.tel ?? body.telefono ?? "").replace(/\D/g, "");
  const email = (body.email ?? "").trim() || null;
  const fuente = (body.fuente ?? "landing-568").trim();
  const proposito = (body.interes ?? body.proposito ?? "").trim() || null;
  const tag = tagFor(body.interes, body.tag);

  if (!nombre || telefono.length < 10) {
    return new Response(JSON.stringify({ error: "nombre y tel son obligatorios" }), {
      status: 400,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data, error } = await supabase
    .from("buyer_leads")
    .upsert(
      { nombre, telefono, email, fuente, tag, proposito },
      { onConflict: "telefono,fuente" },
    )
    .select("id")
    .single();

  if (error) {
    console.error("insert error:", error.message);
    return new Response(JSON.stringify({ error: "db error" }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  // ---- Notificaciones (best-effort: nunca tumban la respuesta) ----
  const resumen =
    `Nuevo lead (${fuente})\n` +
    `Nombre: ${nombre}\nWhatsApp: +${telefono}\nCorreo: ${email ?? "—"}\n` +
    `Tag: ${tag}${proposito ? ` (${proposito})` : ""}\n` +
    `Responder: https://wa.me/${telefono}`;

  const jobs: Promise<unknown>[] = [];

  const resendKey = Deno.env.get("RESEND_API_KEY");
  const notifyEmail = Deno.env.get("NOTIFY_EMAIL");
  if (resendKey && notifyEmail) {
    jobs.push(
      fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Ranch Land Group <leads@resend.dev>",
          to: [notifyEmail],
          subject: `🤠 Nuevo lead ${tag}: ${nombre} (${fuente})`,
          text: resumen,
        }),
      }).catch((e) => console.error("resend error:", e)),
    );
  }

  const waToken = Deno.env.get("WA_TOKEN");
  const waPhoneId = Deno.env.get("WA_PHONE_ID");
  const waTo = Deno.env.get("WA_NOTIFY_TO");
  if (waToken && waPhoneId && waTo) {
    jobs.push(
      fetch(`https://graph.facebook.com/v20.0/${waPhoneId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${waToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: waTo,
          type: "text",
          text: { body: resumen },
        }),
      }).catch((e) => console.error("whatsapp error:", e)),
    );
  }

  await Promise.allSettled(jobs);

  return new Response(JSON.stringify({ ok: true, id: data.id }), {
    status: 200,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
