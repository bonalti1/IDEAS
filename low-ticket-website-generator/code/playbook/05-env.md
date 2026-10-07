# 🔑 Catálogo de variables de entorno

Los VALORES nunca van en git — viven en Render (producción) y en el
administrador de contraseñas del dueño. Este catálogo dice qué es cada llave,
de dónde sale y qué se rompe si falta. `server/.env.example` tiene el mismo
catálogo en formato .env.

## Acceso a portales (SECRETOS — únicos y fuertes)

| Var | Qué abre |
|---|---|
| `ADMIN_KEY` | /admin — todo el negocio. La más sensible. |
| `CS_KEY` | /cs (ADMIN_KEY también entra) |
| `CLOSER_KEY` | /closer + /onboarding (ADMIN_KEY también entra) |
| `DEMO_PASS` | Modo demo ilimitado (`?pass=`). No adivinable — cada medición gratis cuesta API. |
| `HQ_KEY` | /hq — el cockpit privado del dueño (portafolio, ideas, IA). SOLO esta llave lo abre; ni ADMIN_KEY entra. |

⚠️ Regla: las tres llaves distintas entre sí, distintas de cualquier
contraseña de otra cuenta, y rotadas si alguna aparece en un screenshot.

## Datos

| Var | Notas |
|---|---|
| `DATABASE_URL` | Postgres de Supabase. Sin ella: archivo JSON local (SE BORRA en cada deploy de Render). |
| `REQUIRE_DB` | =1 para negarse a arrancar sin base de datos (ponerla en prod). |

## Dinero (Stripe)

| Var | Notas |
|---|---|
| `STRIPE_LINK_PRO` / `STRIPE_LINK_WIDGET` / `STRIPE_LINK_COMPLETE` | Un Payment Link por plan ($67/$197/$297). Precio nuevo = link nuevo + monto en `planByAmount` (index.mjs). El link PRO debe llevar **free trial de 7 días** (lo promete /app): el checkout llega en $0 y el webhook activa la cuenta como `payStatus "trial"`; el cobro del día 8 la pasa a "ok". Si el link fuera de otro plan con trial, ponle metadata `plan=widget/complete` en Stripe — sin metadata el trial se asume "pro". |
| `STRIPE_WEBHOOK_SECRET` | Firma del webhook /api/stripe/webhook (invoice.paid → activa cuenta y etiqueta plan). |

## APIs del producto

| Var | Notas |
|---|---|
| `GOOGLE_MAPS_API_KEY` | Server-side: Places + Geocoding + Solar (mediciones) + **Routes API** (la ruta de Cómo llegar se calcula en el servidor vía `/api/directions` — Google retiró la Directions API clásica para proyectos nuevos, el navegador ya no puede pedirla). Si falta Routes API, el overlay dice "Ruta no disponible (PERMISSION_DENIED)". |
| `MAPS_BROWSER_KEY` | Llave restringida por dominio para el mapa del navegador. En sus **API restrictions** debe permitir: Maps JavaScript API y Geocoding API (pin por dirección sin coords). Ya NO necesita Directions API. |
| `ANTHROPIC_API_KEY` | El asistente IA (bots de sitios, copywriter, CEO advisor). |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | Fallback del asistente + Whisper (factura por voz). |
| `RENTCAST_API_KEY` | Datos de la propiedad (recámaras, sqft). |
| `SERPAPI_KEY` | Home Depot vía SerpApi, dos usos: (1) precios de materiales (botón 💲, caché 24h por zip ≈ 250 búsquedas/mes) y (2) fotos de catálogo para el picker de productos de cerca (una búsqueda por producto, caché 30 días ≈ 5/mes; 🔄 en el editor busca el siguiente resultado). Plan Starter $25/mes (1,000 búsquedas) sobra. Búsquedas NUEVAS: solo cuentas pagadas + DEMO_PASS. El demo anónimo (el funnel /app-cercas) recibe SOLO CACHÉ — si una cuenta pagada ya calentó ese zip hoy ve los precios reales, si no cae al fallback local; jamás gasta un crédito. Sin llave la app usa los renders locales. `HD_ZIP` = zip de la tienda por defecto (78501 McAllen). Métricas: mat_* y pimg_req/pimg_cache/pimg_live/pimg_err. |
| `REGRID_API_KEY` | Parcelas (límites de lote para cercas). Quién gasta: cuentas PAGADAS y el demo privado (`DEMO_PASS`) — con caché de 90 días, así que repetir la misma dirección es gratis. El demo público NUNCA gasta: dibuja a mano o abre los ejemplos curados. Sembrar ejemplos (1 vez, 3 lookups): `/api/admin/parcel-example?slot=1&name=Lote normal&address=...` (slots 1-3: lote normal, esquina, cul-de-sac). Verificar de punta a punta: `/api/diag?address=123 Main St, McAllen, TX` (admin) — geocodifica y corre el matching real; esperar `state:"found"`. Si la llave estuvo mala y ya se arregló: `/api/admin/parcel-cache-clear` (los "no encontrado" de la ventana mala quedan cacheados 90 días hasta limpiarlos). Costos y estados en /admin → Embudo → 🗺️ PARCELAS. |

## Notificaciones

| Var | Notas |
|---|---|
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web push (el buzz de leads). Generar una vez: `npx web-push generate-vapid-keys`. |

## Dominios de clientes

| Var | Notas |
|---|---|
| `CF_API_TOKEN` | Cloudflare: Registrar Domains Edit + Zone Read + DNS Edit (All Domains). |
| `CF_ACCOUNT_ID` | Cuenta CF (compra de dominios). |
| `CF_ZONE_ID` / `CF_CNAME_TARGET` | Zona de alto-pro.com para subdominios/conexiones legacy. |
| `CF_REG_NAME/ORG/EMAIL/PHONE/STREET/CITY/STATE/ZIP/COUNTRY` | Contacto registrante WHOIS. Teléfono formato `+1.9565551234` (con PUNTO). |
| `RENDER_API_KEY` / `RENDER_SERVICE_ID` / `RENDER_ORIGIN` | Para registrar dominios comprados en Render y emitir SSL. |

## GHL / marketing

| Var | Notas |
|---|---|
| `HL_WEBHOOK_SECRET` | Secreto compartido del puente GHL→motor (/api/hl/lead). |
| `GHL_BOOKING_URL` | Scheduling Link del calendario (se incrusta al terminar el quiz, y aparece como botón "📅 Agendar una llamada" en el cierre del demo de `/w/alto-demo` y `/w/alto-cercas` tras las 2 pruebas). |
| `COMMUNITY_INVITE_URL` | Link de invitación a la Comunidad de WhatsApp privada de contratistas (la que promete `/app` y `/app-cercas`). Puesta: `/bienvenida` le entrega al comprador el botón "👥 Entrar a la comunidad" en cuanto su cuenta queda activa — sin paso manual. Vacía: la promesa se cumple con el mensaje de bienvenida humano (nada se rompe; el link no aparece). Recomendado: una **WhatsApp Community** (canal de anuncios para tips/videos + grupo de discusión para el mastermind) — escala más allá del tope de 1024 del grupo simple. Sembrar con contenido y algunos miembros ANTES de escalar anuncios: un grupo vacío mata la promesa. |
| `META_PIXEL_ID` | Pixel de Meta en páginas públicas. |

## Flags / varios

| Var | Notas |
|---|---|
| `PAGINA_ENABLED` | =1 enciende el funnel de fábrica de páginas `/pagina` ($49): formulario auto-servicio → preview instantáneo de SU página (mismo motor que los sitios de clientes) → barra de compra. El lead cae en alto-ventas ANTES del preview (src `pagina-funnel`). Apagado: `/pagina` redirige a `/app`. Los funnels de la app no se tocan. |
| `STRIPE_LINK_PAGINA` | Payment Link de **$49 pago único** del funnel `/pagina` (crear en Stripe; el server le pega `client_reference_id=pagina-<borrador>`). **After-payment URL del link: `https://alto-pro.com/bienvenida?session_id={CHECKOUT_SESSION_ID}`** — con eso el webhook publica la página del comprador SOLA (la exacta que aprobó) y /bienvenida le entrega su sitio + su link de edición al instante. Sin la var, el botón cae a WhatsApp (SALES_WA). Pendiente: producto de hosting $19/mes (mes 2) + dominio $50/año. |
| `FENCE_ENABLED` | =1 enciende el vertical de cercas: selector de oficio, cuenta alto-cercas, links del deck y la página de ventas `/cercas` (con FENCE_ENABLED=0 redirige a /ventas para no perder clics de anuncios). Kit completo: `/cercas` (ventas) · `/w/alto-cercas` (cotizador demo) · `/ejemplo-cercas` (página ejemplo) · `/?demo=fence` (app demo). Patrón a copiar para verticales nuevos. |
| ~~`MAX_DEVICES`~~ | RETIRADA (jul 2026). El tope rotativo sacaba al dueño de su propio teléfono cada pocos taps del link (un iPhone gasta 2 sesiones: Safari + app instalada) y lo obligaba a buscar el link a cada rato — más fricción que lo que costaba el compartir. Modelo actual: el link personal es reusable y las sesiones NUNCA expiran solas; /admin marca ⚠️ la cuenta que pasa de 5 dispositivos y el remedio es manual — 🔄 Revocar accesos (mata todo y emite link nuevo). Si la var sigue puesta en Render, se ignora. |
| `PORT` | Puerto local (Render lo inyecta). |

## Desarrollo local

Arrancar desde `tradetechpro/`:

```
(ADMIN_KEY=testadmin CS_KEY=testcs CLOSER_KEY=testcloser DEMO_PASS=testpass FENCE_ENABLED=1 PORT=5959 setsid node server/index.mjs > /tmp/srv.log 2>&1 &)
```

Luego `node scripts/regression.mjs` (todo verde antes de commitear). Si las
pruebas 1–2 fallan de la nada: los contadores de cuota (`demolk:*`, `wq:*`)
persistidos en `server/data/store.json → metrics.all` se quemaron con las
corridas — apagar el server, borrar esas llaves y volver a arrancar.
