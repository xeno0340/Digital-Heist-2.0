# Digital Heist 2.0 (Work in Progress)

A hacking-heist-themed escape room built for the MAD Club's Engineers Day event. Teams authenticate with credentials issued in advance, work through a ten-node puzzle map, consult an AI-driven informant for optional leads, and compete on a live leaderboard that accounts for both puzzle progress and a sabotage-based resource economy. The system is implemented as a single Node.js/Express backend backed by Supabase (PostgreSQL), serving a static, vanilla-JavaScript frontend.

This document describes the system's architecture, setup procedure, and current implementation status. It is intended for anyone continuing development or preparing the system for the live event.

## 1. Project Status

### 1.1 Completed

The following systems are implemented, have been exercised through manual and live browser testing, and are considered functionally complete:

- **Account provisioning.** Team accounts are created exclusively by an administrator through a bulk-creation panel; there is no public self-registration path. Each account receives a randomly generated PIN, stored only as a bcrypt hash, and is shown once at creation time.
- **Team authentication.** Teams authenticate with a team name and PIN against the hashed credential store.
- **Puzzle map.** Ten nodes covering ciphers, logic locks, riddles, wordplay, and in-person "runner" tasks. Seven of the ten nodes are digitally randomized across eight variants per team, so that teams working in physical proximity are unlikely to be assigned identical puzzle instances. The remaining three nodes correspond to shared physical props (a proctor desk, a designated person, a physical padlock) and are therefore issued identically to every team, as they cannot be regenerated per team in a physical space.
- **The Informant.** An auxiliary, LLM-backed chat interface that supplies optional intelligence fragments, a subset of which are deliberately false. Each team has a bounded number of queries ("leverage") before the channel closes. Session state is persisted server-side and never exposes which fragments are true or false to the client.
- **Wrong-answer lockout.** An incorrect submission on a node locks that node for twenty seconds before a further attempt is permitted, enforced server-side and backed by persistent storage so it survives a server restart.
- **Vault mechanic.** Upon clearing a minimum number of nodes, a team may assemble the shard codes awarded by each cleared node, in ascending node order, and submit the resulting string to reach the vault. Vault arrival is timestamped and ranked.
- **Scoring and leaderboard.** A team's score is computed as banked Intel (Intel earned less Intel spent on sabotage) plus a fixed bonus per node cleared plus a one-time bonus keyed to vault arrival order. A public, unauthenticated, auto-refreshing leaderboard view is provided for projection on a shared screen.
- **Sabotage / Intel economy.** Teams may spend banked Intel against rival teams through five moves: Peek (reveal a rival's current node, informational only), Freeze (temporarily blocks a rival's ability to submit answers), Static Burst (a purely cosmetic, full-screen visual disruption combining animated noise and scrambled on-screen text), Reshuffle (a stronger, longer visual disruption of the same kind), and Shield (a self-targeted, temporary immunity to incoming sabotage, with one complimentary activation per team before it consumes Intel). The system enforces an opening safe window after the event begins, per-target cooldowns on offensive moves, and a rolling anti-abuse cap limiting how much cumulative disruption a single team may be subjected to within a ten-minute window. A team that has reached the vault can no longer be targeted, but retains the ability to spend remaining Intel against teams still in progress, at direct cost to its own final score.
- **Administrative controls.** The administrator panel supports bulk account creation, roster review, starting the event clock (which governs the sabotage safe window), and suspending or resuming sabotage room-wide.

### 1.2 In Progress / Not Yet Implemented

- **Game-master console.** Beyond the start/suspend controls described above, there is no consolidated live view of every team's map position, no mechanism for room-wide broadcasts, and no support for admin-triggered bonus nodes. This remains to be built.
- **Production deployment.** The system currently runs against a local Express server (`localhost`) for development and testing. A `vercel.json` configuration is present but deployment to a publicly reachable environment has not been finalized or verified end-to-end.
- **Load and dry-run testing.** The system has been exercised with a small number of manually created test teams. It has not yet been tested at or near the expected scale of thirty to forty concurrent teams, and no scheduled dry run has been conducted.
- **Pre-event data hygiene.** Test team accounts created during development remain in the production database and should be removed prior to the live event.

## 2. Architecture

| Layer | Technology | Responsibility |
|---|---|---|
| Backend | Node.js, Express | Authentication, puzzle answer validation, session and progress state, sabotage logic, scoring |
| Database | Supabase (PostgreSQL) | Persistent storage for teams, progress, sabotage state, and Informant sessions; Row Level Security is enabled with no policies granted, so only the backend's service-role key can read or write |
| Frontend | Static HTML/CSS/JavaScript, no build step | Team login, puzzle map, sabotage panel, and the public leaderboard view |
| External service | OpenAI API | Powers The Informant's conversational responses |

All puzzle answers, shard codes, and sabotage state are validated and stored server-side. The browser is never sent an answer key; it receives only puzzle prompts and correct/incorrect verdicts.

## 3. Project Structure

```
backend/
  server.js            Express application: all API routes and game logic
  schema.sql            Supabase schema (run once per environment; safe to re-run)
  .env.example           Template for required environment variables
  package.json
  public/
    login.html          Team authentication
    map.html             Puzzle map, vault, and sabotage panel
    admin.html           Administrator panel
    leaderboard.html     Public, read-only leaderboard view
    index.html           Standalone Informant chat interface (development/testing)
    audio/               Synthesized Morse code clips used by node 6
```

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
5. Open `admin.html` in a browser, supply the administrator secret, and bulk-create team accounts from the event's registration list. Record the generated credentials; PINs are shown once and are not retrievable afterward.
6. Distribute credentials to teams and direct them to `login.html`.

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

## 7. Known Limitations

- The system has not been load-tested at the scale of a full event.
- No automated test suite exists; verification to date has been manual and browser-based.
- Deployment beyond a local development server is unverified.