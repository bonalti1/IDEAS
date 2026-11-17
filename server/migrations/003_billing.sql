-- Credits live on the account; payments add them. Projects keep what they used.
alter table users add column if not exists credits integer not null default 0;
alter table projects add column if not exists credits_used integer not null default 0;

create table if not exists payments (
  id          text primary key,            -- the Stripe Checkout Session id (idempotent webhook)
  user_id     text not null references users(id),
  pack        text,
  credits     integer not null default 0,
  amount      integer not null default 0,  -- cents
  currency    text not null default 'usd',
  status      text not null,               -- paid | refunded | granted
  receipt_url text,
  at          timestamptz not null default now(),
  doc         jsonb not null default '{}'::jsonb
);
create index if not exists payments_user on payments (user_id, at desc);
