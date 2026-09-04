// Team login (no self-registration — accounts are admin-created only,
// see routes/admin.js).

const bcrypt = require("bcryptjs");

function registerTeamRoutes(app, { supabase }) {
  // POST /api/team/login { teamName, pin }
  app.post("/api/team/login", async (req, res) => {
    const { teamName, pin } = req.body || {};
    if (!teamName || !pin) {
      return res.status(400).json({ error: "Team name and PIN are required." });
    }

    const { data: team, error } = await supabase
      .from("teams")
      .select("id, team_name, pin_hash")
      .ilike("team_name", teamName.trim())
      .maybeSingle();

    if (error) {
      console.error("Team login lookup failed:", error.message);
      return res.status(500).json({ error: "Login failed. Try again." });
    }

    // Same error for "no such team" and "wrong PIN" so this can't be used
    // to enumerate real team names.
    const genericError = "Team name and PIN don't match.";
    if (!team) return res.status(401).json({ error: genericError });

    const ok = await bcrypt.compare(String(pin), team.pin_hash);
    if (!ok) return res.status(401).json({ error: genericError });

    res.json({ teamId: team.id, teamName: team.team_name });
  });

  // POST /api/team/:teamId/integrity-lock { reason }
  // Called by map.html the moment it detects the team left fullscreen or
  // switched tabs mid-game. Sets the lock; every node/vault submission
  // checks it server-side (see routes/nodes.js and routes/vault.js) so
  // this can't be bypassed by just refreshing the page. Only an admin
  // (admin.html) can clear it — see POST /api/admin/teams/:teamId/unlock.
  // A team that already reached the vault is done racing, so a stray
  // fullscreen-exit after that shouldn't lock them out of anything.
  app.post("/api/team/:teamId/integrity-lock", async (req, res) => {
    const { teamId } = req.params;
    const reason = String(req.body?.reason || "unspecified").slice(0, 200);

    const { data: team, error: teamErr } = await supabase
      .from("teams")
      .select("vault_reached_at, integrity_locked")
      .eq("id", teamId)
      .maybeSingle();
    if (teamErr) {
      console.error("Integrity lock team lookup failed:", teamErr.message);
      return res.status(500).json({ error: "Couldn't record lock. Try again." });
    }
    if (!team) return res.status(404).json({ error: "No such team." });

    if (team.vault_reached_at) {
      return res.json({ ok: true, locked: false, reason: "vault already reached, not locking" });
    }

    const { error: updateErr } = await supabase
      .from("teams")
      .update({
        integrity_locked: true,
        integrity_lock_reason: reason,
        integrity_locked_at: new Date().toISOString(),
      })
      .eq("id", teamId);
    if (updateErr) {
      console.error("Integrity lock write failed:", updateErr.message);
      return res.status(500).json({ error: "Couldn't record lock. Try again." });
    }

    res.json({ ok: true, locked: true, reason });
  });
}

module.exports = { registerTeamRoutes };