// Leaderboard â€” the "big screen" read-only view from the design doc.
// Deliberately unauthenticated (team names + scores only, never PINs or
// answers) so it can run on a projector without anyone logged in. Same
// scoring formula as the Intel Economy doc's "Final scoring" table:
// banked Intel + a flat node-cleared bonus + a one-time bonus keyed to
// vault arrival order.

const { NODE_CLEARED_BONUS, arrivalBonusForRank } = require("../data/scoring");

function registerLeaderboardRoutes(app, { supabase }) {
  app.get("/api/leaderboard", async (req, res) => {
    const { data: teams, error: teamsErr } = await supabase
      .from("teams")
      .select("id, team_name, intel, vault_reached_at");
    if (teamsErr) {
      console.error("Leaderboard teams lookup failed:", teamsErr.message);
      return res.status(500).json({ error: "Couldn't load the leaderboard. Try again." });
    }

    const { data: completions, error: compErr } = await supabase
      .from("node_completions")
      .select("team_id");
    if (compErr) {
      console.error("Leaderboard completions lookup failed:", compErr.message);
      return res.status(500).json({ error: "Couldn't load the leaderboard. Try again." });
    }

    const nodesClearedByTeam = {};
    for (const row of completions || []) {
      nodesClearedByTeam[row.team_id] = (nodesClearedByTeam[row.team_id] || 0) + 1;
    }

    // Arrival rank comes from vault_reached_at order, not insertion order
    // â€” ties (same millisecond) fall back to team_name so the ordering is
    // at least deterministic and doesn't flicker between polls.
    const arrived = (teams || [])
      .filter((t) => t.vault_reached_at)
      .sort((a, b) => {
        const diff = new Date(a.vault_reached_at) - new Date(b.vault_reached_at);
        return diff !== 0 ? diff : a.team_name.localeCompare(b.team_name);
      });
    const rankByTeamId = {};
    arrived.forEach((t, i) => { rankByTeamId[t.id] = i + 1; });

    const rows = (teams || []).map((t) => {
      const nodesCleared = nodesClearedByTeam[t.id] || 0;
      const nodeBonus = nodesCleared * NODE_CLEARED_BONUS;
      const arrivalRank = rankByTeamId[t.id] || null;
      const arrivalBonus = arrivalBonusForRank(arrivalRank);
      return {
        teamName: t.team_name,
        bankedIntel: t.intel,
        nodesCleared,
        nodeBonus,
        vaultReached: !!t.vault_reached_at,
        vaultReachedAt: t.vault_reached_at,
        arrivalRank,
        arrivalBonus,
        totalScore: t.intel + nodeBonus + arrivalBonus,
      };
    });

    rows.sort((a, b) => {
      if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
      if (a.vaultReached !== b.vaultReached) return a.vaultReached ? -1 : 1;
      if (a.vaultReached && b.vaultReached) return a.arrivalRank - b.arrivalRank;
      return a.teamName.localeCompare(b.teamName);
    });

    res.json({ leaderboard: rows, nodeClearedBonus: NODE_CLEARED_BONUS });
  });
}

module.exports = { registerLeaderboardRoutes };
