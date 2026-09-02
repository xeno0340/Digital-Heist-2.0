-- Digital Heist 2.0 — game data storage
-- Run this once in your Supabase project's SQL editor (Project > SQL Editor > New query).

create extension if not exists pgcrypto; -- gives us gen_random_uuid()

-- ---------------------------------------------------------------------
-- Teams. Accounts are admin-created only (see the admin panel /
-- POST /api/admin/teams in server.js) — there is no public sign-up, so
-- the only way into a team is a name + PIN you handed out yourself.
-- pin_hash is a bcrypt hash; the plaintext PIN is shown once at creation
-- time and never stored.
-- ---------------------------------------------------------------------
create table if not exists teams (
  id           uuid primary key default gen_random_uuid(),
  team_name    text not null unique,
  pin_hash     text not null,
  intel        integer not null default 0,
  created_at   timestamptz not null default now()
);

-- Which nodes each team has cleared. One row per (team, node) — the
-- primary key doubles as the "already completed" guard so a resubmit of
-- a correct answer can't double-award intel.
create table if not exists node_completions (
  team_id      uuid not null references teams(id) on delete cascade,
  node_id      integer not null,
  completed_at timestamptz not null default now(),
  primary key (team_id, node_id)
);

alter table teams enable row level security;
alter table node_completions enable row level security;
-- Intentionally no policies added on either table: RLS enabled + zero
-- policies = the anon/authenticated roles can do nothing on them at all.
-- Only this backend, using the service role key, can read or write teams,
-- PIN hashes, or progress.

create table if not exists informant_sessions (
  team_id      text primary key,
  history      jsonb not null default '[]'::jsonb,
  lie_indexes  jsonb not null default '[]'::jsonb,
  leverage     integer not null default 8,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Lock this table down completely from the public/anon key — only the
-- backend, using the service role key (which bypasses RLS), can touch it.
-- Without this, anyone with your Supabase anon key could read every
-- team's session directly, including which facts are lies.
alter table informant_sessions enable row level security;
-- Intentionally no policies added: RLS enabled + zero policies = the
-- anon and authenticated roles can do nothing on this table at all.