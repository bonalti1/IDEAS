-- Draft House office database, first schema.
-- Each row keeps its full document in doc (jsonb) plus the columns the API filters and sorts on.

create table if not exists designs (
  id          text primary key,
  created_at  timestamptz not null default now(),
  client      text,
  doc         jsonb not null
);

create table if not exists jobs (
  id          text primary key,
  design_id   text not null references designs(id),
  status      text not null,
  worker      text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  doc         jsonb not null
);
create index if not exists jobs_status_created on jobs (status, created_at);
create index if not exists jobs_created on jobs (created_at desc);

create table if not exists workers (
  id          text primary key,
  name        text,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  doc         jsonb not null
);

create table if not exists commands (
  id          text primary key,
  worker      text not null,
  command     text not null,
  at          timestamptz not null default now(),
  taken       timestamptz
);
create index if not exists commands_pending on commands (worker) where taken is null;

create table if not exists events (
  id          text primary key,
  at          timestamptz not null default now(),
  kind        text not null,
  message     text not null,
  doc         jsonb not null default '{}'::jsonb
);
create index if not exists events_at on events (at desc);

create table if not exists interpret_log (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  request     text,
  client      text,
  verdict     text,
  source      text,
  ms          integer,
  cost        numeric(10, 6),
  doc         jsonb not null
);
create index if not exists interpret_log_at on interpret_log (at desc);

create table if not exists meta (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);
