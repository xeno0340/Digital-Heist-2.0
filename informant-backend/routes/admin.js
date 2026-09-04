// Admin — bulk-create team accounts, list teams, event-clock controls,
// and the Reference Console content editor. Every route here requires the
// x-admin-secret header to match ADMIN_SECRET (see lib/auth.js). See
// frontend/admin.html for the panel that calls these.
//
// Accounts are ADMIN-CREATED ONLY — there is no public "New Team"
// sign-up. Use frontend/admin.html or a direct call to POST /api/admin/teams
// to pre-create every team from your Engineers Day registration list
// before the event, then hand out the generated team name + PIN at
// check-in. This is the tradeoff from the design discussion: more setup
// work up front, but no risk of joke teams, name-squatting, or early
// registrations at the door.

const bcrypt = require("bcryptjs");
const { requireAdmin, randomPin } = require("../lib/auth");
const { VARIANT_COUNT, NEEDED_FOR_VAULT } = require("../data/nodes");
const { NODE_CLEARED_BONUS, arrivalBonusForRank } = require("../data/scoring");

function registerAdminRoutes(app, { supabase, ADMIN_SECRET }) {
  const adminGate = requireAdmin(ADMIN_SECRET);

  // POST /api/admin/teams { teamNames: string[], pinDigits?: number }
  // Creates one account per name with a random PIN. Returns the plaintext
  // PIN for each team ONCE — it is never stored or retrievable again, so
  // the caller must save/print this response immediately.
  app.post("/api/admin/teams", adminGate, async (req, res) => {
    const { teamNames, pinDigits } = req.body || {};
    if (!Array.isArray(teamNames) || teamNames.length === 0) {
      return res.status(400).json({ error: "teamNames must be a non-empty array." });
    }

    const digits = Number.isInteger(pinDigits) && pinDigits >= 4 && pinDigits <= 6 ? pinDigits : 4;
    const results = [];

    for (const rawName of teamNames) {
      const teamName = String(rawName || "").trim();
      if (!teamName) {
        results.push({ teamName: rawName, ok: false, error: "Empty name." });
        continue;
      }

      const pin = randomPin(digits);
      const pinHash = await bcrypt.hash(pin, 10);
      // Random variant assignment — with 30-40 teams across VARIANT_COUNT
      // buckets this spreads out evenly enough (~4-5 teams/variant)
      // without needing to track a running counter across separate
      // bulk-create calls.
      const variant = Math.floor(Math.random() * VARIANT_COUNT);

      const { data, error } = await supabase
        .from("teams")
        .insert({ team_name: teamName, pin_hash: pinHash, variant })
        .select("id, team_name, variant")
        .maybeSingle();

      if (error) {
        // Most likely a duplicate team_name (unique constraint).
        results.push({ teamName, ok: false, error: error.message });
        continue;
      }

      results.push({ teamId: data.id, teamName: data.team_name, pin, variant: data.variant, ok: true });
    }

    res.json({ results });
  });

  // GET /api/admin/teams — the full roster with everything a game master
  // actually wants at a glance: nodes cleared, live score, vault/arrival
  // status, how long each team has taken, block status, and team-profile
  // contact info. This single endpoint also doubles as the admin login
  // check (see frontend/admin.html) — a wrong secret gets a 401 from
  // adminGate before any of this runs, a right one gets the dashboard's
  // first data load for free in the same request.
  app.get("/api/admin/teams", adminGate, async (req, res) => {
    const { data: teams, error: teamsErr } = await supabase
      .from("teams")
      .select("id, team_name, intel, variant, created_at, vault_reached_at, integrity_locked, integrity_lock_reason, integrity_locked_at")
      .order("created_at", { ascending: true });
    if (teamsErr) return res.status(500).json({ error: teamsErr.message });

    const { data: completions, error: compErr } = await supabase
      .from("node_completions")
      .select("team_id, node_id");
    if (compErr) return res.status(500).json({ error: compErr.message });

    const { data: profiles, error: profErr } = await supabase
      .from("team_profiles")
      .select("team_id, members, lead_email, lead_phone");
    if (profErr) return res.status(500).json({ error: profErr.message });

    const { data: gameState, error: gsErr } = await supabase
      .from("game_state")
      .select("started_at")
      .eq("id", 1)
      .maybeSingle();
    if (gsErr) console.error("Game state lookup failed (admin roster):", gsErr.message);
    const startedAt = gameState ? gameState.started_at : null;

    const nodesByTeam = {};
    for (const row of completions || []) {
      (nodesByTeam[row.team_id] = nodesByTeam[row.team_id] || []).push(row.node_id);
    }
    const profileByTeam = {};
    for (const row of profiles || []) profileByTeam[row.team_id] = row;

    // Arrival rank, same formula/tie-break as GET /api/leaderboard, needed
    // here too since a team's score depends on it.
    const arrived = (teams || [])
      .filter((t) => t.vault_reached_at)
      .sort((a, b) => {
        const diff = new Date(a.vault_reached_at) - new Date(b.vault_reached_at);
        return diff !== 0 ? diff : a.team_name.localeCompare(b.team_name);
      });
    const rankByTeamId = {};
    arrived.forEach((t, i) => { rankByTeamId[t.id] = i + 1; });

    const now = Date.now();
    const rows = (teams || []).map((t) => {
      const nodesCleared = (nodesByTeam[t.id] || []).sort((a, b) => a - b);
      const nodeBonus = nodesCleared.length * NODE_CLEARED_BONUS;
      const arrivalRank = rankByTeamId[t.id] || null;
      const arrivalBonus = arrivalBonusForRank(arrivalRank);
      const profile = profileByTeam[t.id] || null;

      // "Time taken": elapsed since the event clock started (POST
      // /api/admin/game/start), up to whichever came first for this team
      // - reaching the vault, or right now if they're still racing. Null
      // before the game has started at all, since there's nothing to
      // measure yet.
      let elapsedSeconds = null;
      if (startedAt) {
        const startMs = new Date(startedAt).getTime();
        const endMs = t.vault_reached_at ? new Date(t.vault_reached_at).getTime() : now;
        elapsedSeconds = Math.max(0, Math.round((endMs - startMs) / 1000));
      }

      return {
        id: t.id,
        teamName: t.team_name,
        intel: t.intel,
        variant: t.variant,
        createdAt: t.created_at,
        nodesCleared,
        nodesClearedCount: nodesCleared.length,
        neededForVault: NEEDED_FOR_VAULT,
        nodeBonus,
        vaultReached: !!t.vault_reached_at,
        vaultReachedAt: t.vault_reached_at,
        arrivalRank,
        arrivalBonus,
        score: t.intel + nodeBonus + arrivalBonus,
        elapsedSeconds,
        integrityLocked: !!t.integrity_locked,
        integrityLockReason: t.integrity_lock_reason,
        integrityLockedAt: t.integrity_locked_at,
        profile: profile
          ? {
            memberCount: (profile.members || []).length,
            members: profile.members || [],
            leadEmail: profile.lead_email,
            leadPhone: profile.lead_phone,
          }
          : null,
      };
    });

    res.json({ teams: rows, gameStartedAt: startedAt });
  });

  // POST /api/admin/teams/:teamId/block { reason? } — admin-initiated
  // version of the same lock a team's own browser can self-report (see
  // routes/team.js's integrity-lock endpoint) for leaving fullscreen or
  // switching tabs. Same enforcement everywhere: node submit, vault
  // submit, and every sabotage move all already check this one flag, so
  // a team an admin blocks for any reason (suspected phone use, a rules
  // violation you saw in person, anything) is fully shut out until
  // unblocked - not just kept from submitting answers.
  app.post("/api/admin/teams/:teamId/block", adminGate, async (req, res) => {
    const { teamId } = req.params;
    const reason = String(req.body?.reason || "blocked by admin").slice(0, 200);
    const { error } = await supabase
      .from("teams")
      .update({ integrity_locked: true, integrity_lock_reason: reason, integrity_locked_at: new Date().toISOString() })
      .eq("id", teamId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  });

  // POST /api/admin/teams/:teamId/unlock — clears a block/lock, whether it
  // was auto-reported (fullscreen exit / tab switch) or set manually via
  // the Block button above. This is the "admin decides they were
  // wrongfully blocked" escape hatch - the lock itself is just a flag, not
  // proof of anything, so clearing it needs no more than an admin's
  // judgment call.
  app.post("/api/admin/teams/:teamId/unlock", adminGate, async (req, res) => {
    const { teamId } = req.params;
    const { error } = await supabase
      .from("teams")
      .update({ integrity_locked: false, integrity_lock_reason: null, integrity_locked_at: null })
      .eq("id", teamId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  });

  // DELETE /api/admin/teams/:teamId — permanently removes a team account
  // and everything tied to it. Every table that references teams(id) is
  // declared "on delete cascade" in schema.sql, so this one delete also
  // removes their node completions, lockouts, sabotage state/cooldowns/
  // effects, variant overrides, and profile automatically. The one
  // exception is informant_sessions, whose team_id column is plain text
  // (not a foreign key, so it doesn't cascade) - deleted explicitly here
  // to avoid leaving an orphaned chat history behind.
  app.delete("/api/admin/teams/:teamId", adminGate, async (req, res) => {
    const { teamId } = req.params;
    const { error: sessionErr } = await supabase.from("informant_sessions").delete().eq("team_id", teamId);
    if (sessionErr) console.error("Informant session cleanup failed (non-fatal):", sessionErr.message);

    const { error } = await supabase.from("teams").delete().eq("id", teamId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  });

  // POST /api/admin/game/start — starts the event clock. Sabotage stays
  // disabled (the opening safe window) until SAFE_WINDOW_MINUTES after this.
  app.post("/api/admin/game/start", adminGate, async (req, res) => {
    const { error } = await supabase
      .from("game_state")
      .update({ started_at: new Date().toISOString() })
      .eq("id", 1);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  });

  // POST /api/admin/game/suspend-sabotage { suspended: boolean } — the
  // doc's "game master can suspend sabotage room-wide at will," e.g.
  // right before a scripted lockdown event.
  app.post("/api/admin/game/suspend-sabotage", adminGate, async (req, res) => {
    const { suspended } = req.body || {};
    const { error } = await supabase
      .from("game_state")
      .update({ sabotage_suspended: !!suspended })
      .eq("id", 1);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true, suspended: !!suspended });
  });

  // ---- Reference Console content editor ----

  // GET /api/admin/reference — full list, newest first, for the editor table.
  app.get("/api/admin/reference", adminGate, async (req, res) => {
    const { data, error } = await supabase
      .from("reference_facts")
      .select("id, keywords, question, answer, created_at")
      .order("created_at", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ facts: data });
  });

  // POST /api/admin/reference { keywords, question, answer }
  app.post("/api/admin/reference", adminGate, async (req, res) => {
    const keywords = String(req.body?.keywords || "").trim();
    const question = String(req.body?.question || "").trim();
    const answer = String(req.body?.answer || "").trim();
    if (!keywords || !question || !answer) {
      return res.status(400).json({ error: "keywords, question, and answer are all required." });
    }
    const { data, error } = await supabase
      .from("reference_facts")
      .insert({ keywords, question, answer })
      .select("id, keywords, question, answer, created_at")
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ fact: data });
  });

  // DELETE /api/admin/reference/:id
  app.delete("/api/admin/reference/:id", adminGate, async (req, res) => {
    const { error } = await supabase.from("reference_facts").delete().eq("id", req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  });
}

module.exports = { registerAdminRoutes };