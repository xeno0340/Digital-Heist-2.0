// Node puzzles — submit an answer, fetch progress, fetch this team's
// puzzle text. The real answer key lives in data/nodes.js, server-side
// only, exactly like the Informant's fact list — the browser only ever
// gets a correct/incorrect verdict or pre-stripped display text, never
// the answer itself.

const {
  NEEDED_FOR_VAULT,
  WRONG_ANSWER_LOCKOUT_SECONDS,
  getNodeDef,
  getPuzzleDisplay,
  normalizeAnswer,
  getShardCode,
} = require("../data/nodes");
const { NODE_CLEARED_BONUS, arrivalBonusForRank } = require("../data/scoring");

function registerNodeRoutes(app, { supabase, sabotageState }) {
  const { getActiveFreeze, getVariantOverride, getVariantOverrides } = sabotageState;

  // POST /api/node/submit { teamId, nodeId, answer }
  app.post("/api/node/submit", async (req, res) => {
    const { teamId, nodeId, answer } = req.body || {};
    const numericNodeId = Number(nodeId);
    if (!teamId || !Number.isInteger(numericNodeId) || !answer) {
      return res.status(400).json({ error: "teamId, nodeId, and answer are required." });
    }

    // A Freeze in effect blocks submission outright — checked before
    // anything else, same as the doc: "locks a rival team's screen from
    // submitting."
    const freezeExpires = await getActiveFreeze(teamId);
    if (freezeExpires) {
      const secondsLeft = Math.ceil((new Date(freezeExpires) - new Date()) / 1000);
      return res.json({ correct: false, frozen: true, secondsLeft });
    }

    // Need the team's assigned variant before we know which puzzle
    // instance (and therefore which answer) to check against — unless
    // Reshuffle has overridden this specific node with a different variant.
    const { data: team0, error: team0Err } = await supabase
      .from("teams")
      .select("intel, variant, integrity_locked, integrity_lock_reason")
      .eq("id", teamId)
      .maybeSingle();
    if (team0Err || !team0) {
      console.error("Team lookup failed:", team0Err?.message);
      return res.status(404).json({ error: "No such team." });
    }

    // An integrity lock (fullscreen exit / tab switch — see
    // POST /api/team/:teamId/integrity-lock) blocks submissions the same
    // way a Freeze does, until an admin clears it from admin.html.
    if (team0.integrity_locked) {
      return res.json({ correct: false, integrityLocked: true, reason: team0.integrity_lock_reason });
    }

    const override = await getVariantOverride(teamId, numericNodeId);
    const effectiveVariant = override !== null ? override : team0.variant || 0;
    const nodeDef = getNodeDef(numericNodeId, effectiveVariant);
    if (!nodeDef) return res.status(404).json({ error: "No such node." });

    // Wrong-answer lockout (carried over from v1): a bad guess locks this
    // node for WRONG_ANSWER_LOCKOUT_SECONDS before the next attempt of any
    // kind, correct or not — checked before we even look at the answer.
    const { data: lockout, error: lockoutErr } = await supabase
      .from("node_lockouts")
      .select("locked_until")
      .eq("team_id", teamId)
      .eq("node_id", numericNodeId)
      .maybeSingle();
    if (lockoutErr) {
      console.error("Lockout lookup failed:", lockoutErr.message);
      return res.status(500).json({ error: "Couldn't check lockout. Try again." });
    }
    if (lockout && new Date(lockout.locked_until) > new Date()) {
      const secondsLeft = Math.ceil((new Date(lockout.locked_until) - new Date()) / 1000);
      return res.json({ correct: false, locked: true, secondsLeft });
    }

    if (normalizeAnswer(answer) !== normalizeAnswer(nodeDef.answer)) {
      const lockedUntil = new Date(Date.now() + WRONG_ANSWER_LOCKOUT_SECONDS * 1000).toISOString();
      const { error: lockErr } = await supabase
        .from("node_lockouts")
        .upsert({ team_id: teamId, node_id: numericNodeId, locked_until: lockedUntil });
      if (lockErr) console.error("Lockout write failed:", lockErr.message);
      return res.json({ correct: false, locked: false, secondsLeft: WRONG_ANSWER_LOCKOUT_SECONDS });
    }

    // Correct — check whether this team already cleared it before
    // awarding intel again, since a team may resubmit the right answer
    // more than once.
    const { data: existing, error: existingErr } = await supabase
      .from("node_completions")
      .select("node_id")
      .eq("team_id", teamId)
      .eq("node_id", numericNodeId)
      .maybeSingle();

    if (existingErr) {
      console.error("Node completion lookup failed:", existingErr.message);
      return res.status(500).json({ error: "Couldn't check progress. Try again." });
    }

    if (existing) {
      return res.json({
        correct: true,
        alreadyCompleted: true,
        shardCode: nodeDef.shardCode,
        intelAwarded: 0,
        totalIntel: team0.intel,
      });
    }

    const { error: insertErr } = await supabase
      .from("node_completions")
      .insert({ team_id: teamId, node_id: numericNodeId });
    if (insertErr) {
      console.error("Node completion insert failed:", insertErr.message);
      return res.status(500).json({ error: "Couldn't save progress. Try again." });
    }

    // Award intel via an atomic RPC-free read-then-write is fine here —
    // one team submitting from one device at a time is the realistic case
    // for this event, so a race window isn't worth the extra complexity.
    const { data: team, error: teamErr } = await supabase
      .from("teams")
      .select("intel")
      .eq("id", teamId)
      .maybeSingle();
    if (teamErr || !team) {
      console.error("Team intel lookup failed:", teamErr?.message);
      return res.status(500).json({ error: "Couldn't award intel. Try again." });
    }

    const totalIntel = team.intel + nodeDef.intel;
    const { error: updateErr } = await supabase
      .from("teams")
      .update({ intel: totalIntel })
      .eq("id", teamId);
    if (updateErr) {
      console.error("Team intel update failed:", updateErr.message);
      return res.status(500).json({ error: "Couldn't award intel. Try again." });
    }

    res.json({
      correct: true,
      alreadyCompleted: false,
      shardCode: nodeDef.shardCode,
      intelAwarded: nodeDef.intel,
      totalIntel,
    });
  });

  // GET /api/team/:teamId/progress
  app.get("/api/team/:teamId/progress", async (req, res) => {
    const { teamId } = req.params;

    const { data: team, error: teamErr } = await supabase
      .from("teams")
      .select("intel, vault_reached_at, integrity_locked, integrity_lock_reason, integrity_locked_at")
      .eq("id", teamId)
      .maybeSingle();
    if (teamErr) {
      console.error("Progress lookup failed:", teamErr.message);
      return res.status(500).json({ error: "Couldn't load progress." });
    }
    if (!team) return res.status(404).json({ error: "No such team." });

    const { data: completions, error: compErr } = await supabase
      .from("node_completions")
      .select("node_id")
      .eq("team_id", teamId);
    if (compErr) {
      console.error("Completions lookup failed:", compErr.message);
      return res.status(500).json({ error: "Couldn't load progress." });
    }

    const nodesCleared = (completions || []).map((c) => c.node_id).sort((a, b) => a - b);
    // Shard codes for every cleared node, keyed by node id — fixed per
    // node regardless of variant, so this is safe to hand back directly.
    // Lets a team see (and assemble) their vault code without having to
    // remember what each node showed them at the time.
    const shardCodes = {};
    for (const id of nodesCleared) shardCodes[id] = getShardCode(id);

    // Live score, same formula as /api/leaderboard: banked Intel + a flat
    // per-node bonus + (once they've reached the vault) the arrival-order
    // bonus. Lets a team see roughly where they stand without exposing
    // anyone else's numbers.
    const nodeBonus = nodesCleared.length * NODE_CLEARED_BONUS;
    let arrivalRank = null;
    if (team.vault_reached_at) {
      const { count: rankCount, error: rankErr } = await supabase
        .from("teams")
        .select("id", { count: "exact", head: true })
        .not("vault_reached_at", "is", null)
        .lte("vault_reached_at", team.vault_reached_at);
      if (!rankErr) arrivalRank = rankCount;
    }
    const arrivalBonus = arrivalBonusForRank(arrivalRank);
    const score = team.intel + nodeBonus + arrivalBonus;

    res.json({
      intel: team.intel,
      nodesCleared,
      shardCodes,
      neededForVault: NEEDED_FOR_VAULT,
      vaultReached: !!team.vault_reached_at,
      vaultReachedAt: team.vault_reached_at,
      nodeBonus,
      arrivalRank,
      arrivalBonus,
      score,
      integrityLocked: !!team.integrity_locked,
      integrityLockReason: team.integrity_lock_reason || null,
      integrityLockedAt: team.integrity_locked_at || null,
    });
  });

  // GET /api/team/:teamId/nodes — the puzzle text for this team's
  // assigned variant, one entry per node. Never includes answers, so it's
  // safe to call on every map load. map.html uses this instead of
  // hardcoding one shared puzzle for every team.
  app.get("/api/team/:teamId/nodes", async (req, res) => {
    const { teamId } = req.params;

    const { data: team, error: teamErr } = await supabase
      .from("teams")
      .select("variant")
      .eq("id", teamId)
      .maybeSingle();
    if (teamErr) {
      console.error("Node text lookup failed:", teamErr.message);
      return res.status(500).json({ error: "Couldn't load puzzles." });
    }
    if (!team) return res.status(404).json({ error: "No such team." });

    const overrides = await getVariantOverrides(teamId);
    res.json({ nodes: getPuzzleDisplay(team.variant || 0, overrides) });
  });
}

module.exports = { registerNodeRoutes };