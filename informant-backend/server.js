// Digital Heist 2.0 — backend entry point.
//
// This file's job is just setup: create the Express app, wire up
// Supabase, and mount each feature's routes from ./routes and ./sabotage.
// The actual game logic lives in those modules — see README.md's Project
// Structure section for the map, or open the file for the feature you're
// after directly:
//   routes/informant.js    — The Informant chat
//   routes/reference.js    — Reference Console fact search
//   routes/team.js         — team login
//   routes/profile.js      — team profile (members, lead contact)
//   routes/nodes.js        — node answer submission, progress, puzzle text
//   routes/vault.js        — the vault finish line
//   routes/leaderboard.js  — the public leaderboard
//   sabotage/routes.js     — Peek/Freeze/Static Burst/Reshuffle/Shield
//   routes/admin.js        — team creation, game controls, Reference
//                             Console content editor
//
// Setup (nothing to run except these three things):
//   1. In your Supabase project's SQL editor, run schema.sql (in this folder).
//   2. npm install
//   3. cp .env.example .env, then fill in OPENAI_API_KEY, SUPABASE_URL,
//      and SUPABASE_SERVICE_ROLE_KEY (Project Settings > API in Supabase).
//   4. npm start — then open http://localhost:3000

require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const { createSabotageState } = require("./sabotage/state");
const { registerInformantRoutes } = require("./routes/informant");
const { registerReferenceRoutes } = require("./routes/reference");
const { registerTeamRoutes } = require("./routes/team");
const { registerProfileRoutes } = require("./routes/profile");
const { registerNodeRoutes } = require("./routes/nodes");
const { registerVaultRoutes } = require("./routes/vault");
const { registerLeaderboardRoutes } = require("./routes/leaderboard");
const { registerSabotageRoutes } = require("./sabotage/routes");
const { registerAdminRoutes } = require("./routes/admin");

const app = express();
app.use(cors());
app.use(express.json());

// The team-facing site (login, map+Informant+Reference Console, admin,
// leaderboard) lives in ../frontend, one level up from this backend/
// folder — see the project's top-level README for the full layout.
// { index: false } matters here: frontend/ has its own index.html (the
// Informant dev test page), and express.static's default behavior would
// silently serve THAT at "/" instead of ever reaching the redirect below
// — teams hitting the bare site URL would land on a dev tool instead of
// the login screen.
const FRONTEND_DIR = path.join(__dirname, "..", "frontend");
app.use(express.static(FRONTEND_DIR, { index: false }));
app.get("/", (req, res) => res.redirect("/login.html"));

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_SECRET = process.env.ADMIN_SECRET;
const PORT = process.env.PORT || 3000;

for (const [name, val] of Object.entries({
  OPENAI_API_KEY,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  ADMIN_SECRET,
})) {
  if (!val) console.warn(`\n⚠️  ${name} is not set. Copy .env.example to .env and fill it in.\n`);
}

// Service-role key bypasses Row Level Security — that's intentional and
// safe HERE because this key only ever lives on the server, never sent to
// the browser. The SQL schema locks every table down from the anon/public
// key entirely, so only this backend can read or write anything.
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Sabotage's shared state helpers (game clock, cooldowns, Shield, the
// anti-grief disable cap, active-Freeze checks) are needed by node/vault
// submission as well as the sabotage routes themselves — build them once
// here and hand the same instance to whichever routes need it.
const sabotageState = createSabotageState(supabase);

registerInformantRoutes(app, { supabase, OPENAI_API_KEY, OPENAI_MODEL });
registerReferenceRoutes(app, { supabase });
registerTeamRoutes(app, { supabase });
registerProfileRoutes(app, { supabase });
registerNodeRoutes(app, { supabase, sabotageState });
registerVaultRoutes(app, { supabase, sabotageState });
registerLeaderboardRoutes(app, { supabase });
registerSabotageRoutes(app, { supabase, sabotageState });
registerAdminRoutes(app, { supabase, ADMIN_SECRET });

app.listen(PORT, () => {
  console.log(`Digital Heist 2.0 backend running at http://localhost:${PORT}`);
});