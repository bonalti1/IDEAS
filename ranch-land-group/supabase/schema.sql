-- ============================================================
-- Ranch Land Group — tabla de lista de compradores
-- Ejecutar en: Supabase Dashboard > SQL Editor (una sola vez)
-- ============================================================

create table if not exists public.buyer_leads (
  id             uuid primary key default gen_random_uuid(),
  nombre         text not null,
  telefono       text not null,
  email          text,
  fuente         text not null default 'landing-568',     -- ej. landing-568, landing-<propiedad>, referido
  tag            text not null default 'lista_espera'
                 check (tag in ('inversionista', 'cazador', 'lista_espera')),
  presupuesto    text,                                    -- se llena en el seguimiento por WhatsApp
  acres_buscados text,                                    -- ídem
  proposito      text,                                    -- inversion | caza | ambos | familia
  notas          text,
  created_at     timestamptz not null default now()
);

-- Un mismo teléfono no se duplica por fuente (si vuelve a llenar el form, se actualiza)
create unique index if not exists buyer_leads_tel_fuente_uidx
  on public.buyer_leads (telefono, fuente);

create index if not exists buyer_leads_tag_idx     on public.buyer_leads (tag);
create index if not exists buyer_leads_fuente_idx  on public.buyer_leads (fuente);
create index if not exists buyer_leads_created_idx on public.buyer_leads (created_at desc);

-- ============================================================
-- Seguridad: RLS activado y SIN políticas públicas.
-- Solo el service_role (la Edge Function / n8n) puede escribir y leer.
-- El formulario de la landing NUNCA habla directo con la tabla.
-- ============================================================
alter table public.buyer_leads enable row level security;

-- ============================================================
-- Vistas útiles para segmentar la lista (fase 2)
-- ============================================================
create or replace view public.lista_inversionistas as
  select nombre, telefono, email, presupuesto, acres_buscados, fuente, created_at
  from public.buyer_leads where tag = 'inversionista' order by created_at desc;

create or replace view public.lista_cazadores as
  select nombre, telefono, email, fuente, created_at
  from public.buyer_leads where tag = 'cazador' order by created_at desc;
