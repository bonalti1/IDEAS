-- Alto Video Factory schema.
-- Columns mirror src/shared/types.ts (camelCase there, snake_case here).
-- Workflow gates are enforced in the API (src/shared/gates.ts); the database
-- additionally guards the invariants that are cheap to express in SQL.

create table if not exists vf_projects (
  id text primary key,
  name text not null,
  trade text not null check (trade in ('concrete_driveway')),
  desired_result text not null default '',
  original_asset_id text not null,
  normalized_asset_id text not null,
  scene jsonb,
  scene_approved_at timestamptz,
  mask_asset_id text,
  mask_source text check (mask_source in ('auto', 'manual')),
  mask_confidence real,
  mask_approved_at timestamptz,
  plan_approved_at timestamptz,
  video_aspect text not null default '16:9' check (video_aspect in ('16:9', '9:16')),
  branding jsonb not null,
  final_asset_id text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  -- approvals are ordered: plan ⇒ mask ⇒ scene
  check (mask_approved_at is null or scene_approved_at is not null),
  check (plan_approved_at is null or mask_approved_at is not null),
  check (mask_approved_at is null or mask_asset_id is not null)
);

create table if not exists vf_assets (
  id text primary key,
  project_id text not null references vf_projects (id) on delete cascade,
  kind text not null check (kind in ('original', 'normalized', 'mask', 'stage_image', 'video_frame', 'clip', 'clip_frame', 'render')),
  storage_key text not null unique,
  mime_type text not null,
  bytes bigint not null,
  sha256 text not null,
  width int,
  height int,
  duration_sec real,
  immutable boolean not null default true,
  created_at timestamptz not null
);
create index if not exists vf_assets_project on vf_assets (project_id);

-- Media is write-once. Asset rows can never be updated; the original upload
-- in particular can never change.
create or replace function vf_assets_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'vf_assets rows are immutable (asset %)', old.id;
end $$;
drop trigger if exists vf_assets_no_update on vf_assets;
create trigger vf_assets_no_update before update on vf_assets
  for each row execute function vf_assets_immutable();

create table if not exists vf_stages (
  id text primary key,
  project_id text not null references vf_projects (id) on delete cascade,
  index int not null,
  title text not null,
  description text not null,
  checklist jsonb not null default '[]',
  motion_hint text not null default '',
  prompt text,
  prompt_source text check (prompt_source in ('ai', 'template', 'user')),
  prompt_approved_at timestamptz,
  approved_candidate_id text,
  approved_at timestamptz,
  updated_at timestamptz not null,
  -- an image can only be approved after its prompt was approved
  check (approved_candidate_id is null or prompt_approved_at is not null),
  check (prompt_approved_at is null or prompt is not null)
);
create index if not exists vf_stages_project on vf_stages (project_id, index);

create table if not exists vf_candidates (
  id text primary key,
  project_id text not null references vf_projects (id) on delete cascade,
  stage_id text not null references vf_stages (id) on delete cascade,
  provider text not null,
  model text not null,
  prompt text not null,
  base_asset_id text not null,
  reference_asset_ids jsonb not null default '[]',
  mask_asset_id text,
  asset_id text,
  status text not null check (status in ('pending', 'ready', 'failed')),
  error text,
  review jsonb,
  review_error text,
  job_id text,
  created_at timestamptz not null
);
create index if not exists vf_candidates_stage on vf_candidates (stage_id);

create table if not exists vf_transitions (
  id text primary key,
  project_id text not null references vf_projects (id) on delete cascade,
  index int not null,
  from_stage_id text,
  to_stage_id text not null,
  from_asset_id text not null,
  to_asset_id text not null,
  prompt text not null,
  duration_sec real not null,
  approved_take_id text,
  approved_at timestamptz,
  created_at timestamptz not null
);
create index if not exists vf_transitions_project on vf_transitions (project_id, index);

create table if not exists vf_takes (
  id text primary key,
  project_id text not null references vf_projects (id) on delete cascade,
  transition_id text not null references vf_transitions (id) on delete cascade,
  provider text not null,
  model text not null,
  prompt text not null,
  operation_id text,
  asset_id text,
  frame_asset_ids jsonb not null default '[]',
  status text not null check (status in ('pending', 'ready', 'failed')),
  error text,
  review jsonb,
  review_error text,
  job_id text,
  created_at timestamptz not null
);
create index if not exists vf_takes_transition on vf_takes (transition_id);

create table if not exists vf_jobs (
  id text primary key,
  project_id text not null references vf_projects (id) on delete cascade,
  type text not null,
  target_id text,
  status text not null check (status in ('queued', 'running', 'succeeded', 'failed')),
  progress real not null default 0,
  message text not null default '',
  error text,
  attempts int not null default 0,
  created_at timestamptz not null,
  updated_at timestamptz not null
);
create index if not exists vf_jobs_project on vf_jobs (project_id, status);

-- The API uses the service-role key. Lock the tables down for anon/auth roles.
alter table vf_projects enable row level security;
alter table vf_assets enable row level security;
alter table vf_stages enable row level security;
alter table vf_candidates enable row level security;
alter table vf_transitions enable row level security;
alter table vf_takes enable row level security;
alter table vf_jobs enable row level security;
