# Ranch Land Group — Landing + Buyer List System

Sistema de captación de compradores: landing premium en español que convierte tráfico
de Meta en leads de WhatsApp y guarda cada lead en Supabase para construir una lista
de compradores reutilizable (inversionistas y cazadores).

**Funnel:** Anuncio Meta → WhatsApp → link a esta landing → formulario → lead a Supabase → redirect a wa.me con mensaje personalizado → seguimiento por tag.

```
ranch-land-group/
├── index.html                          # Landing completa (estática, sin build)
├── assets/logo.png                     # Logo optimizado (fondo transparente)
├── supabase/
│   ├── schema.sql                      # Tabla buyer_leads + índices + RLS + vistas
│   └── functions/lead-webhook/index.ts # Edge Function: guarda lead + notifica
└── n8n/lead-webhook-workflow.json      # Alternativa al Edge Function (importar en n8n)
```

---

## 1. Poner en línea la landing

Es un solo `index.html` estático — sirve en Netlify, Vercel, Cloudflare Pages o
GitHub Pages sin build. Sube el folder `ranch-land-group/` tal cual.

### Configuración pendiente (bloque `CONFIG` al final de `index.html`)

| Variable | Qué poner |
|---|---|
| `WHATSAPP_NUMBER` | Número de WhatsApp Business con lada de país, sin `+` ni espacios. Ej. `5281XXXXXXXX` |
| `LEAD_WEBHOOK` | URL del webhook (paso 2). Si queda vacío, el form igual redirige a WhatsApp — solo no guarda el lead. |

También pendiente (marcado con comentarios en el HTML):

- **VSL**: reemplazar el contenido de `.video-shell` por el iframe del video (instrucciones en el comentario CSS junto a `.video-shell`).
- **Foto de drone del monte**: cambiar `--hero-photo` en `:root` (instrucciones en el comentario).
- **Foto de Rolando** en la sección "Quién está detrás" (hoy muestra el logo).

## 2. Backend de leads (Supabase)

1. Crea un proyecto en [supabase.com](https://supabase.com).
2. En **SQL Editor**, ejecuta `supabase/schema.sql`. Crea la tabla `buyer_leads`
   con RLS activado y **sin** políticas públicas: solo la Edge Function (service role)
   puede escribir. Un mismo teléfono no se duplica por fuente (upsert).
3. Deploy del webhook:
   ```bash
   supabase login
   supabase link --project-ref TU_PROJECT_REF
   supabase functions deploy lead-webhook --no-verify-jwt
   ```
4. Secrets de notificación (opcionales pero recomendados):
   ```bash
   supabase secrets set NOTIFY_EMAIL=rolando@alto-realtygroup.com
   supabase secrets set RESEND_API_KEY=re_xxx        # email vía resend.com (gratis hasta 3k/mes)
   # y/o notificación por WhatsApp Cloud API:
   supabase secrets set WA_TOKEN=EAAG... WA_PHONE_ID=1234567890 WA_NOTIFY_TO=52181XXXXXXXX
   ```
5. Copia la URL de la función —
   `https://TU_PROJECT_REF.functions.supabase.co/lead-webhook` —
   en `CONFIG.LEAD_WEBHOOK` del `index.html`.

### Payload que acepta el webhook

El form manda `{ nombre, tel, email, fuente, fecha }` más dos campos extra de
segmentación (`interes`, `tag`). El webhook acepta el payload original tal cual;
si `tag` no viene, lo deriva de `interes` (inversion/ambos → `inversionista`,
caza → `cazador`, lo demás → `lista_espera`).

### Alternativa n8n

Si prefieres n8n en lugar del Edge Function: importa
`n8n/lead-webhook-workflow.json`, define las variables de entorno
`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` en n8n, conecta la credencial SMTP
del nodo de email, activa el workflow y usa la URL del nodo Webhook como
`CONFIG.LEAD_WEBHOOK`.

### Probar el webhook

```bash
curl -X POST https://TU_PROJECT_REF.functions.supabase.co/lead-webhook \
  -H 'Content-Type: application/json' \
  -d '{"nombre":"Prueba","tel":"528112345678","email":"prueba@test.com","fuente":"landing-568","interes":"inversion"}'
# → {"ok":true,"id":"..."}
```

## 3. Reglas de copy (no negociables)

- Los comparables ($3,200–$3,500) se presentan **siempre** como "rango de mercado
  observado en la zona", **nunca** como promesa de valor presente o futuro.
- "Impuestos casi nulos **con exención agrícola**" — nunca "no pagas impuestos".
- El disclaimer del footer es protección legal: **no se quita**.
- **Nunca** mencionar el precio de adquisición en ningún material.

## 4. Fase 2 — duplicar por propiedad

La landing es un template. Para el rancho #2:

1. Copia el folder: `cp -r ranch-land-group rancho-<nombre>`.
2. Edita el bloque `PROPERTY` al final de `index.html`:
   ```js
   var PROPERTY = {
     fuente: "landing-<nombre>",  // NUEVO tag de origen — así sabes de qué anuncio vino cada lead
     acres: ...,
     precioAcre: ...,
     compMin: ..., compMax: ...,  // rango de mercado de SU zona
     equidad: ...,                // ≈ (promedio del rango − precio) × acres, redondeado hacia abajo
     ubicacion: "...",
     escalaMin: ..., escalaMax: ... // rango visual de la barra (un poco más amplio que compMin/compMax)
   };
   ```
   Todas las cifras con `data-p` (headline, stats, barra de equidad, mensajes de
   WhatsApp) se actualizan solas.
3. Ajusta el copy fijo que aplique (condado, features, título/meta tags, video).
4. Mismo webhook para todas las landings — la columna `fuente` separa cada propiedad.

### Vender a la lista antes de anunciar

`schema.sql` crea dos vistas listas para exportar:

- `lista_inversionistas` — mándales los números (precio/acre, rango de zona, equidad).
- `lista_cazadores` — mándales fotos de monte y venado.

Query rápido en Supabase: `select * from lista_inversionistas;` → exporta CSV →
10 mensajes personales de WhatsApp antes de gastar un peso en anuncios.
