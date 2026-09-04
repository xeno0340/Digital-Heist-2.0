// The vault — the actual finish line. A team that has cleared at least
// NEEDED_FOR_VAULT nodes assembles their shard codes (in ascending node
// order, no spaces) and submits the combined string here.

const { NEEDED_FOR_VAULT, getShardCode } = require("../data/nodes");
const { arrivalBonusForRank } = require("../data/scoring");

function registerVaultRoutes(app, { supabase, sabotageState }) {
  const { getActiveFreeze } = sabotageState;

  // POST /api/vault/submit { teamId, code }
  app.post("/api/vault/submit", async (req, res) => {
    const { teamId, code } = req.body || {};
    if (!teamId || !code) {
      return res.status(400).json({ error: "teamId and code are required." });
    }

    const freezeExpires = await getActiveFreeze(teamId);
    if (freezeExpires) {
      const secondsLeft = Math.ceil((new Date(freezeExpires) - new Date()) / 1000);
      return res.json({ correct: false, frozen: true, secondsLeft });
    }

    const { data: team, error: teamErr } = await supabase
      .from("teams")
      .select("vault_reached_at, integrity_locked, integrity_lock_reason")
      .eq("id", teamId)
      .maybeSingle();
    if (teamErr || !team) {
      console.error("Vault team lookup failed:", teamErr?.message);
      return res.status(404).json({ error: "No such team." });
    }

    if (team.integrity_locked) {
      return res.json({ correct: false, integrityLocked: true, reason: team.integrity_lock_reason });
    }

    const { data: completions, error: compErr } = await supabase
      .from("node_completions")
      .select("node_id")
      .eq("team_id", teamId);
    if (compErr) {
      console.error("Vault completions lookup failed:", compErr.message);
      return res.status(500).json({ error: "Couldn't check progress. Try again." });
    }

    const clearedIds = (completions || []).map((c) => c.node_id).sort((a, b) => a - b);
    if (clearedIds.length < NEEDED_FOR_VAULT) {
      return res.status(400).json({ error: `Clear at least ${NEEDED_FOR_VAULT} nodes before the vault.` });
    }

    const expected = clearedIds.map((id) => getShardCode(id)).join("");
    const submitted = String(code).replace(/\s+/g, "").toUpperCase();
    if (submitted !== expected) {
      return res.json({ correct: false });
    }

    if (team.vault_reached_at) {
      const { count: rankCount, error: rankErr } = await supabase
        .from("teams")
        .select("id", { count: "exact", head: true })
        .not("vault_reached_at", "is", null)
        .lte("vault_reached_at", team.vault_reached_at);
      const rank = rankErr ? null : rankCount;
      return res.json({
        correct: true,
        alreadyReached: true,
        reachedAt: team.vault_reached_at,
        arrivalRank: rank,
        arrivalBonus: arrivalBonusForRank(rank),
      });
    }

    const reachedAt = new Date().toISOString();
    const { error: updateErr } = await supabase
      .from("teams")
      .update({ vault_reached_at: reachedAt })
      .eq("id", teamId);
    if (updateErr) {
      console.error("Vault update failed:", updateErr.message);
      return res.status(500).json({ error: "Couldn't record vault completion. Try again." });
    }

    // Arrival rank = how many teams (including this one) reached the
    // vault at or before this moment — powers the arrival-order scoring
    // bonus.
    const { count, error: countErr } = await supabase
      .from("teams")
      .select("id", { count: "exact", head: true })
      .not("vault_reached_at", "is", null)
      .lte("vault_reached_at", reachedAt);
    if (countErr) console.error("Arrival rank lookup failed:", countErr.message);

    const arrivalRank = countErr ? null : count;
    res.json({
      correct: true,
      alreadyReached: false,
      reachedAt,
      arrivalRank,
      arrivalBonus: arrivalBonusForRank(arrivalRank),
    });
  });
}

module.exports = { registerVaultRoutes };