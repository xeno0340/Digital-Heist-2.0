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
  -- Which puzzle variant (0-based index) this team was randomly assigned
  -- at creation time — see VARIANT_NODES in server.js. Keeps nearby teams
  -- from working the exact same puzzle instance.
  variant      integer not null default 0,
  -- Set once, the moment a team successfully submits the vault code.
  -- Null = hasn't reached the vault yet. Used to compute arrival order
  -- for the scoring bonus (see the Intel Economy doc).
  vault_reached_at timestamptz,
  -- Fullscreen/tab-switch integrity lock (see routes/team.js's
  -- integrity-lock endpoint and map.html's fullscreen/visibility
  -- listeners): the frontend reports itself locked the moment a team
  -- exits fullscreen or switches tabs mid-game, which blocks every
  -- node/vault submission server-side until an admin manually clears it
  -- from admin.html. This is a deterrent for the obvious "open Copilot
  -- in this same browser" move, NOT real anti-cheat — it can't detect a
  -- phone or a second device, and it can false-positive on an OS
  -- notification or alt-tab for an innocent reason, which is exactly why
  -- unlocking is a manual admin action rather than automatic.
  integrity_locked      boolean not null default false,
  integrity_lock_reason text,
  integrity_locked_at   timestamptz,
  created_at   timestamptz not null default now()
);

-- If you already ran an earlier version of this schema (teams table
-- exists but is missing newer columns), these are safe to run even if
-- the column already exists — they only add what's missing:
-- alter table teams add column if not exists variant integer not null default 0;
-- alter table teams add column if not exists vault_reached_at timestamptz;
-- alter table teams add column if not exists integrity_locked boolean not null default false;
-- alter table teams add column if not exists integrity_lock_reason text;
-- alter table teams add column if not exists integrity_locked_at timestamptz;

-- Which nodes each team has cleared. One row per (team, node) — the
-- primary key doubles as the "already completed" guard so a resubmit of
-- a correct answer can't double-award intel.
create table if not exists node_completions (
  team_id      uuid not null references teams(id) on delete cascade,
  node_id      integer not null,
  completed_at timestamptz not null default now(),
  primary key (team_id, node_id)
);

-- Per-team, per-node wrong-answer lockout (carried over from v1): a
-- wrong guess locks that node for 20 seconds before the next attempt,
-- correct or not. One row per (team, node) currently in a lockout.
create table if not exists node_lockouts (
  team_id      uuid not null references teams(id) on delete cascade,
  node_id      integer not null,
  locked_until timestamptz not null,
  primary key (team_id, node_id)
);

alter table teams enable row level security;
alter table node_completions enable row level security;
alter table node_lockouts enable row level security;
-- Intentionally no policies added on any of these: RLS enabled + zero
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

-- ---------------------------------------------------------------------
-- Sabotage / Intel economy (see the Intel Economy doc). Everything below
-- is only ever touched by the backend via the service role key — same
-- "RLS enabled, zero policies" lockdown as the rest of this file.
-- ---------------------------------------------------------------------

-- Single-row game clock + room-wide GM override. id is always 1.
create table if not exists game_state (
  id                  integer primary key default 1,
  -- Null until an admin hits "Start game" — sabotage stays disabled
  -- (the opening 8-minute safe window from the doc) until this is set.
  started_at          timestamptz,
  sabotage_suspended  boolean not null default false
);
insert into game_state (id) values (1) on conflict (id) do nothing;

-- Which node each team currently has open, reported by map.html whenever
-- a puzzle modal opens/closes. Powers Peek (what a rival is working on)
-- and Reshuffle (which node to regenerate). Also holds Shield state.
create table if not exists team_sabotage (
  team_id              uuid primary key references teams(id) on delete cascade,
  active_node_id       integer,
  shield_until         timestamptz,
  -- Every team starts with one free Shield activation (doc: "one free
  -- charge") before it starts costing Intel.
  shield_free_charges  integer not null default 1
);

-- A node-specific variant override, written by Reshuffle. getNodeDef()
-- checks this before falling back to the team's global `variant` column,
-- so a reshuffled node changes on its own without touching every other
-- node's puzzle (which the team's global variant would otherwise do).
create table if not exists team_node_variant_overrides (
  team_id  uuid not null references teams(id) on delete cascade,
  node_id  integer not null,
  variant  integer not null,
  primary key (team_id, node_id)
);

-- Active timed effects currently applied to a team (Freeze locks
-- submission, Static Burst just scrambles the display). Expired rows are
-- harmless and simply ignored by expires_at checks — no cleanup job
-- needed for a one-night event.
create table if not exists sabotage_effects (
  id              uuid primary key default gen_random_uuid(),
  target_team_id  uuid not null references teams(id) on delete cascade,
  source_team_id  uuid not null references teams(id) on delete cascade,
  move            text not null,           -- 'freeze' | 'static_burst'
  expires_at      timestamptz not null,
  created_at      timestamptz not null default now()
);

-- Per (attacker, target, move) cooldown for the offensive moves that have
-- one (Freeze, Static Burst, Reshuffle — Peek has none).
create table if not exists sabotage_cooldowns (
  source_team_id  uuid not null references teams(id) on delete cascade,
  target_team_id  uuid not null references teams(id) on delete cascade,
  move            text not null,
  available_at    timestamptz not null,
  primary key (source_team_id, target_team_id, move)
);

-- Log of "disabled seconds" inflicted on a team by Freeze/Reshuffle, used
-- to enforce the doc's 90-seconds-per-rolling-10-minutes anti-grief cap.
create table if not exists sabotage_disable_log (
  id              uuid primary key default gen_random_uuid(),
  target_team_id  uuid not null references teams(id) on delete cascade,
  seconds         integer not null,
  applied_at      timestamptz not null default now()
);

alter table game_state enable row level security;
alter table team_sabotage enable row level security;
alter table team_node_variant_overrides enable row level security;
alter table sabotage_effects enable row level security;
alter table sabotage_cooldowns enable row level security;
alter table sabotage_disable_log enable row level security;
-- Same story as everywhere else in this file: RLS on, no policies, so
-- only the service-role backend can touch any of this.

-- ---------------------------------------------------------------------
-- Reference Console — a curated, organizer-populated fact lookup, kept
-- entirely separate from The Informant and its 8-question leverage cap.
-- This is NOT a general web search and it does not (and technically
-- cannot) "block AI" on a device — a website has no way to stop someone
-- from opening ChatGPT/Gemini/a phone's browser in another tab. What it
-- *can* do is give teams a legitimate, on-theme place to look up the
-- small number of real-world facts a puzzle needs (e.g. "what date did
-- the Titanic sink") without needing outside internet access at all, so
-- that "no phones, use the console" is an enforceable house rule backed
-- by a tool that actually has the answer. See README, Known Limitations.
-- ---------------------------------------------------------------------
create table if not exists reference_facts (
  id           uuid primary key default gen_random_uuid(),
  -- Short search keywords/phrases, lowercase, comma-separated is fine
  -- (e.g. "titanic, titanic sinking, rms titanic"). The search endpoint
  -- does simple substring matching against this plus the question.
  keywords     text not null,
  question     text not null,   -- e.g. "When did the Titanic sink?"
  answer       text not null,   -- e.g. "15 April 1912"
  created_at   timestamptz not null default now()
);

alter table reference_facts enable row level security;
-- Same story: RLS on, no policies. Reads go through GET
-- /api/reference/search (service role key), never straight to Supabase
-- from the browser.

-- ---------------------------------------------------------------------
-- Team profile — collected once on a team's first login (map.html's
-- profile gate), editable anytime after from the dashboard's "Team
-- Profile" button. One row per team; a team with no row yet just hasn't
-- filled it in. members is a JSON array of {name, roll}, 2-4 entries,
-- validated by routes/profile.js (not by the DB — Supabase's free tier
-- has no easy row-level JSON-shape check, and this data isn't sensitive
-- enough to need one).
-- ---------------------------------------------------------------------
create table if not exists team_profiles (
  team_id      uuid primary key references teams(id) on delete cascade,
  members      jsonb not null default '[]'::jsonb,
  lead_email   text not null default '',
  lead_phone   text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table team_profiles enable row level security;
-- Same story: RLS on, no policies. Reads/writes go through
-- GET/POST /api/team/:teamId/profile (service role key) only.