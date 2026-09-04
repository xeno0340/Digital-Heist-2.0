# Digital Heist 2.0

A hacking-heist-themed escape room built for the MAD Club's Engineers Day event. Teams authenticate with credentials issued in advance, work through a ten-node puzzle map, consult an AI-driven informant for optional leads, and compete on a live leaderboard that accounts for both puzzle progress and a sabotage-based resource economy. The system is a Node.js/Express backend (organized as one module per feature) backed by Supabase (PostgreSQL), serving a static, vanilla-JavaScript frontend kept in its own top-level folder.

This document describes the system's architecture, setup procedure, and current implementation status. It is intended for anyone continuing development or preparing the system for the live event.

**Live URL:** https://digital-hesit-20.vercel.app/ — redirects to `login.html`. Deploys automatically from pushes to `main` (see Section 4.1 for the deployment config).

## 1. Project Status

### 1.1 Completed

The following systems are implemented, have been exercised through manual and live browser testing, and are considered functionally complete:

- **Account provisioning.** Team accounts are created exclusively by an administrator through a bulk-creation panel; there is no public self-registration path. Each account receives a randomly generated PIN, stored only as a bcrypt hash, and is shown once at creation time.
- **Team authentication.** Teams authenticate with a team name and PIN against the hashed credential store.
- **Puzzle map.** Ten nodes covering ciphers, logic locks, riddles, wordplay, and in-person "runner" tasks. Seven of the ten nodes are digitally randomized across eight variants per team, so that teams working in physical proximity are unlikely to be assigned identical puzzle instances. The remaining three nodes are fixed — issued identically to every team rather than randomized. Two of those three correspond to shared physical props (a designated person, a physical padlock) that can't be regenerated per team in a physical space; the third (the "keyboard" riddle) is simply a fixed, non-randomized riddle with no physical component. Node 10 (Morse code, decoded by hand from a blinking light) is deliberately the last node before the vault — it's the hardest, and since the vault now requires all ten nodes (see below), every team has to clear it eventually regardless of order.
- **The Informant.** An auxiliary, LLM-backed chat interface that supplies optional intelligence fragments, a subset of which are deliberately false. Each team has a bounded number of queries ("leverage") before the channel closes. Session state is persisted server-side and never exposes which fragments are true or false to the client.
- **Wrong-answer lockout.** An incorrect submission on a node locks that node for twenty seconds before a further attempt is permitted, enforced server-side and backed by persistent storage so it survives a server restart.
- **Vault mechanic.** Upon clearing all ten nodes, a team may assemble the shard codes awarded by each cleared node, in ascending node order, and submit the resulting string to reach the vault. Vault arrival is timestamped and ranked.
- **Scoring and leaderboard.** A team's score is computed as banked Intel (Intel earned less Intel spent on sabotage) plus a fixed bonus per node cleared plus a one-time bonus keyed to vault arrival order. A public, unauthenticated, auto-refreshing leaderboard view is provided for projection on a shared screen.
- **Sabotage / Intel economy.** Teams may spend banked Intel against rival teams through five moves: Peek (reveal a rival's current node, informational only), Freeze (temporarily blocks a rival's ability to submit answers), Static Burst (a purely cosmetic, full-screen visual disruption combining animated noise and scrambled on-screen text), Reshuffle (a stronger, longer visual disruption of the same kind), and Shield (a self-targeted, temporary immunity to incoming sabotage, with one complimentary activation per team before it consumes Intel). The system enforces an opening safe window after the event begins, per-target cooldowns on offensive moves, and a rolling anti-abuse cap limiting how much cumulative disruption a single team may be subjected to within a ten-minute window. A team that has reached the vault can no longer be targeted, but retains the ability to spend remaining Intel against teams still in progress, at direct cost to its own final score.
- **Unified team interface.** Login, the puzzle map, The Informant, and the Reference Console are now one page (`map.html`, with `login.html` as its entry point) rather than four separately linked files. A persistent top bar shows Intel, score, and a link to the leaderboard; a tab strip switches between Map, Informant, and Reference Console without leaving the page or losing sabotage polling.
- **Reference Console.** A curated, organizer-populated fact lookup (`GET /api/reference/search`), intended as the venue's alternative to teams using their own phones for incidental real-world facts a puzzle needs (for example, a historical date). It is deliberately independent of The Informant and does not draw on its 8-question leverage budget. It is a fixed, admin-curated list, not a general web search, and it makes no claim to technically prevent someone from using a phone or an AI assistant elsewhere — see Known Limitations.
- **Administrative controls.** The administrator panel is gated by a shared admin-secret login (no username/password), and supports bulk account creation, a full team roster (score, Intel, nodes cleared, vault status, elapsed time, team-profile contact info — with per-team detail rows), a live leaderboard ranked by nodes cleared then elapsed time, blocking/unblocking/deleting individual teams, starting the event clock, suspending or resuming sabotage room-wide, and adding, listing, and removing Reference Console entries. It uses the same shared design tokens (colors, components, light/dark toggle) as the player-facing pages.
- **Integrity lock.** The team-facing map page requires fullscreen for the whole session; leaving fullscreen or switching tabs/apps locks that team out of node submission, the vault, and sabotage until an admin manually clears it from the admin panel (self-reported client-side, enforced server-side). This is a deterrent, not real anti-cheat — it can't detect a second device, and can false-positive on things like OS notifications.
- **Reference Console content.** Populated with facts covering Node 3 (general-knowledge dates/trivia) and Node 4 (background context for its 8 landmark riddles, without revealing the landmark names themselves).
- **Production deployment.** The system is deployed on Vercel and verified reachable at its public URL, serving both the static frontend and the Express backend from a single deployment (see Section 4.1 for the exact configuration and a gotcha worth knowing about).

### 1.2 In Progress / Not Yet Implemented

- **Room-wide broadcasts and admin-triggered bonus nodes.** Not built — the admin panel covers roster/moderation/leaderboard/game-clock/content-editing, but there's no mechanism to push a message to every team's screen or spring a bonus puzzle mid-event.
- **Visual design pass on the player pages.** The interface unification (one page, tabbed navigation, shared session) is structural; further graphic-design polish — typography, iconography, animation — hasn't been done. (Note: the admin panel itself has since been restyled onto the same design tokens as the player pages — see 1.1.)
- **Load and dry-run testing.** The system has been exercised with a small number of manually created test teams. It has not yet been tested at or near the expected scale of thirty to forty concurrent teams, and no scheduled dry run has been conducted.
- **Pre-event data hygiene.** Test team accounts created during development remain in the production database and should be removed prior to the live event.
- **Unused audio assets.** `frontend/audio/*.wav` (the original Morse-code audio clips) are dead files left over from before Node 10's Morse puzzle was switched to a blinking-light indicator — nothing in the code references them anymore. Safe to delete whenever convenient; not blocking anything.

## 2. Architecture

| Layer | Technology | Responsibility |
|---|---|---|
| Backend | Node.js, Express | Authentication, puzzle answer validation, session and progress state, sabotage logic, scoring — split into one route module per feature (see Project Structure) |
| Database | Supabase (PostgreSQL) | Persistent storage for teams, progress, sabotage state, and Informant sessions; Row Level Security is enabled with no policies granted, so only the backend's service-role key can read or write |
| Frontend | Static HTML/CSS/JavaScript, no build step, kept in its own top-level folder | Team login, the puzzle map (with The Informant and Reference Console as tabs), the admin panel, and the public leaderboard view |
| External service | OpenAI API | Powers The Informant's conversational responses |

All puzzle answers, shard codes, and sabotage state are validated and stored server-side. The browser is never sent an answer key; it receives only puzzle prompts and correct/incorrect verdicts.

## 3. Project Structure

```
frontend/
  login.html            Team authentication (entry point — also the site root "/")
  map.html               Puzzle map, vault, sabotage panel, The Informant, and the Reference Console — one page, tabbed
  admin.html             Administrator panel, including the Reference Console content editor
  leaderboard.html       Public, read-only leaderboard view (meant for a projected/shared screen)
  index.html             Informant dev/test page — NOT part of the team-facing flow (see Section 6)
  audio/                 Unused — original Morse audio clips, superseded by the blinking-light version of node 10; safe to delete

backend/
  server.js             Entry point: Express app setup, mounts every feature's routes, starts listening
  schema.sql             Supabase schema (run once per environment; safe to re-run)
  .env.example            Template for required environment variables
  package.json
  data/
    nodes.js              The node/puzzle answer key, its variants, and lookup helpers
    scoring.js             The scoring formula (node bonus, vault arrival-order bonus)
    informantKnowledge.js  The Informant's fact list and system-prompt builder
  lib/
    auth.js                Admin-secret gate and the PIN generator
  sabotage/
    state.js               Shared sabotage state: game clock, cooldowns, Shield, the anti-grief cap
    routes.js               The /api/sabotage/* and /api/game/state routes
  routes/
    informant.js            The Informant chat routes
    reference.js             The Reference Console search route
    team.js                  Team login
    nodes.js                 Node answer submission, team progress, per-team puzzle text
    vault.js                 The vault finish line
    leaderboard.js           The public leaderboard route
    admin.js                 Team creation, event-clock controls, Reference Console content editor
```

Each backend file above corresponds to one feature — Informant, team auth, node/vault mechanics, leaderboard, sabotage, admin, Reference Console — with `data/` and `lib/` holding the plain data and small helpers more than one feature shares. `server.js` itself only does setup and wiring; none of the actual game logic lives there anymore.

## 4. Setup

1. In the Supabase project's SQL editor, run `backend/schema.sql`. The file is idempotent and may be re-run safely if the schema is later extended.
2. From `backend/`, install dependencies:
   ```
   npm install
   ```
3. Copy `.env.example` to `.env` and populate the required values (see Section 5).
4. Start the server:
   ```
   npm start
   ```
   Run this from inside `backend/` — it serves the sibling `frontend/` folder, so the working directory matters.
5. Also in the Supabase SQL editor, run `backend/seed_reference.sql` and `backend/seed_reference_landmarks.sql` to populate the Reference Console with its starter facts (general-knowledge dates for Node 3, landmark background for Node 4). Both are additive — safe to run once each, and you can add more facts anytime from the admin panel afterward.
6. Open `frontend/admin.html` in a browser (or `http://localhost:3000/admin.html` once the server is running) and supply the administrator secret. From there, bulk-create team accounts from the event's registration list — record the generated credentials, since PINs are shown once and are not retrievable afterward.
7. Distribute credentials to teams and direct them to `login.html` (also the site's root `/`, which redirects there). From the map page, Informant and Reference Console are tabs alongside the puzzle map — teams never need a separate URL for either. `frontend/index.html` is a separate, unlinked dev tool for iterating on The Informant's persona/fact list without a real team login — it is not part of what teams see.

### 4.1 Deploying to Vercel

Live at https://digital-hesit-20.vercel.app/ — team login is at that URL directly (or `/login.html`); the admin panel is at `/admin.html`; the public leaderboard for projection is at `/leaderboard.html`.

The repo includes a `vercel.json` at the **true repo root** — the same folder that contains `frontend/` and `informant-backend/` as siblings, not inside either of them. This location matters and is easy to get wrong: every `"src"` path inside `vercel.json` is resolved relative to whichever folder the file itself lives in. A `vercel.json` accidentally committed inside `informant-backend/` will silently fail to find `informant-backend/server.js` or the sibling `frontend/` folder, and Vercel will deploy only the static frontend assets with no working backend — no error, just a 404 on load or a site that never reaches the API. If a deploy ever regresses to serving only static files, check this first.

Current config:
```json
{
  "version": 2,
  "builds": [
    { "src": "informant-backend/server.js", "use": "@vercel/node" },
    { "src": "frontend/**", "use": "@vercel/static" }
  ],
  "routes": [
    { "src": "/api/(.*)", "dest": "informant-backend/server.js" },
    { "src": "/", "dest": "informant-backend/server.js" },
    { "src": "/(.*)", "dest": "/frontend/$1" }
  ]
}
```

`informant-backend/server.js` exports the Express app (`module.exports = app`) in addition to calling `.listen()` — Vercel's Node runtime calls the exported handler directly per-request and ignores `.listen()`, while `npm start` locally still uses `.listen()` as normal. Same file, both environments, no fork needed.

Every environment variable in Section 5 must also be set in the Vercel project's Settings → Environment Variables — Vercel does not read the local `.env` file (it's git-ignored, so it never reaches Vercel at all). A deploy can succeed and the login page can load with all of these values missing; the failure only shows up once a request actually needs Supabase or OpenAI (login, node submission, the Informant), so verify with a real login attempt after any redeploy, not just by loading the homepage.

## 5. Environment Variables

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` | Authenticates requests to the OpenAI API for The Informant |
| `OPENAI_MODEL` | Model identifier used for Informant responses |
| `PORT` | Port the Express server listens on |
| `ADMIN_SECRET` | Shared secret required by all administrative endpoints |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key; bypasses Row Level Security and must never be exposed to the client |

`.env` is excluded from version control via `.gitignore` and must not be committed.

## 6. Notable Design Decisions

- **Physical nodes are not randomized.** Three of the ten nodes correspond to shared physical props and are therefore issued identically across all teams, rather than randomized as the digital nodes are.
- **Reshuffle was adapted from its original specification.** The originating design document specifies that Reshuffle permanently regenerates a rival's actively open puzzle. In implementation, this depended on precisely tracking which node a team had open at the moment of attack and proved unreliable in testing. Reshuffle was accordingly reimplemented as a timed, purely cosmetic screen-disruption effect, consistent in mechanism with Static Burst but longer and more disruptive, which lands unconditionally regardless of the target's current activity.
- **Sabotage remains active for the duration of the event**, rather than disabling globally once the first team reaches the vault, in order to preserve competitive stakes for teams still contesting lower arrival-order bonuses. A team that has reached the vault is exempted from being targeted but may continue to spend Intel offensively.
- **The Reference Console is a curated list, not a search engine, and this is intentional.** The original ask was a lookup tool that blocks AI assistants and open web search while still letting teams find real-world facts a puzzle needs. A web page cannot enforce that distinction: it has no way to prevent a phone or laptop from opening ChatGPT, Gemini, Google's AI Overview, or any other site in a different tab or a different device, regardless of what this application does. The practical substitute implemented here is a small, organizer-populated table of exactly the facts a given puzzle set requires, searchable with no query limit and kept entirely separate from The Informant's leverage-limited channel. It answers only what an organizer has explicitly added. Actually keeping phones off the table during the event is a room-management rule for proctors to enforce, not something this software can do on its own.

## 7. Known Limitations

- The system has not been load-tested at the scale of a full event.
- No automated test suite exists; verification to date has been manual and browser-based.
- The Vercel deployment has been verified reachable end-to-end for the login page; it has not yet been load-tested at event scale, and it's worth doing one full login-through-vault run against the live URL (not just localhost) before the event to confirm Supabase/OpenAI calls succeed there too.
- The Reference Console cannot detect or block use of outside devices or AI tools; see Section 6 above.
- The interface unification (Section 1.1) is structural only; no dedicated visual design pass has been done yet.