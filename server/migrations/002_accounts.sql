-- Accounts, saved projects with every version, credits, drafter reviews.

create table if not exists users (
  id          text primary key,            -- Supabase auth user id, or usr_<hash> in local mode
  email       text not null unique,
  role        text not null default 'client',  -- client | drafter | admin
  name        text,
  created_at  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  doc         jsonb not null default '{}'::jsonb
);

create table if not exists projects (
  id          text primary key,
  user_id     text not null references users(id),
  status      text not null default 'drafting',  -- drafting | in_review | returned | approved | built
  credits     integer not null default 0,
  version     integer not null default 1,        -- current version number
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  doc         jsonb not null
);
create index if not exists projects_user on projects (user_id, updated_at desc);
create index if not exists projects_status on projects (status, updated_at desc);

create table if not exists versions (
  project_id  text not null references projects(id),
  n           integer not null,
  at          timestamptz not null default now(),
  kind        text not null,                     -- initial | program | change | rollback
  credit      integer not null default 0,        -- credits this version cost
  refunded    boolean not null default false,
  doc         jsonb not null,                    -- text, reply, source, ops, rooms
  primary key (project_id, n)
);

create table if not exists reviews (
  id          text primary key,
  project_id  text not null references projects(id),
  drafter_id  text not null references users(id),
  decision    text not null,                     -- approved | returned
  note        text,
  at          timestamptz not null default now()
);
create index if not exists reviews_project on reviews (project_id, at desc);
