// Shared sabotage/Intel-economy state helpers — the game clock, the
// safe-window gate, cooldowns, Shield, the anti-grief disable cap, and the
// active-Freeze / variant-override lookups that node & vault submission
// also need to check. Everything here is a thin Supabase read/write; the
// actual /api/sabotage/* route handlers live in ./routes.js.
//
// NOTE on Reshuffle: the doc's original version permanently regenerates
// the target's currently-open node. In practice that depended on tracking
// exactly which node a team had open at the moment of attack, which made
// it feel unreliable (it silently no-ops if the target doesn't have a
// node open right then, or has a physical/runner node open) — testing
// showed it landing but being invisible or feeling like it "did nothing."
// Reworked into a timed full-screen jumble effect instead: every word on
// the target's screen (puzzle text, node titles) gets its letters
// scrambled for durationSeconds below, same shape as Freeze/Static Burst
// (an effect row with an expiry), so it always lands and is unmistakable
// when it does. Cost/cooldown are unchanged from the doc; durationSeconds
// is a judgment call standing in for a number the doc never gave this move.
const SABOTAGE_MOVES = {
  peek: { cost: 10, cooldownSeconds: 0, durationSeconds: 0 },
  freeze: { cost: 20, cooldownSeconds: 300, durationSeconds: 60 },
  static_burst: { cost: 20, cooldownSeconds: 300, durationSeconds: 30 },
  reshuffle: { cost: 35, cooldownSeconds: 480, durationSeconds: 45 },
  shield: { cost: 15, cooldownSeconds: 0, durationSeconds: 180 },
};

const DISABLE_CAP_SECONDS = 90;
const DISABLE_CAP_WINDOW_MINUTES = 10;
const SAFE_WINDOW_MINUTES = 8; // opening safe window before sabotage unlocks

// Everything below needs the Supabase client, so this module exports a
// factory: call it once with `supabase` and reuse the returned object
// everywhere (see server.js).
function createSabotageState(supabase) {
  async function getGameState() {
    const { data, error } = await supabase
      .from("game_state")
      .select("started_at, sabotage_suspended")
      .eq("id", 1)
      .maybeSingle();
    if (error) {
      console.error("Game state lookup failed:", error.message);
      return { startedAt: null, sabotageSuspended: false };
    }
    return {
      startedAt: data ? data.started_at : null,
      sabotageSuspended: data ? !!data.sabotage_suspended : false,
    };
  }

  // Is sabotage usable right now, and if not, why (shown straight to
  // players). NOTE: deliberately NOT disabled once some team reaches the
  // vault — see the per-target "already reached the vault" check in each
  // offensive move instead. Sabotage stays live for the whole event; a
  // team that's already finished just can't be targeted anymore (their
  // rank is locked in either way), but they CAN keep attacking teams
  // still racing, at the cost of their own final score (every point they
  // spend comes straight out of their own banked-Intel score component).
  // Keeps the endgame hot instead of going dead the moment the first team
  // crosses the line.
  async function sabotageEnabledCheck() {
    const state = await getGameState();
    if (state.sabotageSuspended) {
      return { enabled: false, reason: "Sabotage has been suspended by the game master." };
    }
    if (!state.startedAt) {
      return { enabled: false, reason: "The game hasn't started yet." };
    }
    const opensAt = new Date(new Date(state.startedAt).getTime() + SAFE_WINDOW_MINUTES * 60 * 1000);
    if (new Date() < opensAt) {
      return { enabled: false, reason: `Sabotage unlocks ${SAFE_WINDOW_MINUTES} minutes into the game.`, opensAt: opensAt.toISOString() };
    }
    return { enabled: true, reason: null };
  }

  // A team that's already reached the vault can't be targeted by any
  // offensive move — their rank is locked in either way, so there's
  // nothing left to sabotage. They CAN still attack others (see the
  // comment on sabotageEnabledCheck above) — this only guards incoming.
  function vaultLockedError(teamName) {
    return { error: `${teamName} already reached the vault — can't be targeted anymore.`, vaultLocked: true };
  }

  async function getShieldUntil(teamId) {
    const { data, error } = await supabase
      .from("team_sabotage")
      .select("shield_until")
      .eq("team_id", teamId)
      .maybeSingle();
    if (error) {
      console.error("Shield lookup failed:", error.message);
      return null;
    }
    return data && data.shield_until && new Date(data.shield_until) > new Date() ? data.shield_until : null;
  }

  async function getCooldown(sourceTeamId, targetTeamId, move) {
    const { data, error } = await supabase
      .from("sabotage_cooldowns")
      .select("available_at")
      .eq("source_team_id", sourceTeamId)
      .eq("target_team_id", targetTeamId)
      .eq("move", move)
      .maybeSingle();
    if (error) {
      console.error("Cooldown lookup failed:", error.message);
      return null;
    }
    return data && new Date(data.available_at) > new Date() ? data.available_at : null;
  }

  async function setCooldown(sourceTeamId, targetTeamId, move, seconds) {
    const availableAt = new Date(Date.now() + seconds * 1000).toISOString();
    const { error } = await supabase
      .from("sabotage_cooldowns")
      .upsert({ source_team_id: sourceTeamId, target_team_id: targetTeamId, move, available_at: availableAt });
    if (error) console.error("Cooldown write failed:", error.message);
  }

  async function getDisabledSecondsInWindow(targetTeamId) {
    const since = new Date(Date.now() - DISABLE_CAP_WINDOW_MINUTES * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("sabotage_disable_log")
      .select("seconds")
      .eq("target_team_id", targetTeamId)
      .gte("applied_at", since);
    if (error) {
      console.error("Disable log lookup failed:", error.message);
      return 0;
    }
    return (data || []).reduce((sum, r) => sum + r.seconds, 0);
  }

  async function logDisableSeconds(targetTeamId, seconds) {
    const { error } = await supabase.from("sabotage_disable_log").insert({ target_team_id: targetTeamId, seconds });
    if (error) console.error("Disable log write failed:", error.message);
  }

  // Blocks node/vault submission — checked by /api/node/submit and
  // /api/vault/submit before anything else. Static Burst is deliberately
  // NOT here: the doc is explicit it only scrambles the display, it never
  // blocks a correct submission.
  async function getActiveFreeze(teamId) {
    const { data, error } = await supabase
      .from("sabotage_effects")
      .select("expires_at")
      .eq("target_team_id", teamId)
      .eq("move", "freeze")
      .gt("expires_at", new Date().toISOString())
      .order("expires_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error("Freeze lookup failed:", error.message);
      return null;
    }
    return data ? data.expires_at : null;
  }

  // A node-specific variant override written by Reshuffle — see
  // data/nodes.js's getNodeDef. Dead code today (Reshuffle no longer
  // writes overrides — see the comment at the top of this file), left in
  // place harmlessly in case a future move wants per-node overrides again.
  async function getVariantOverride(teamId, nodeId) {
    const { data, error } = await supabase
      .from("team_node_variant_overrides")
      .select("variant")
      .eq("team_id", teamId)
      .eq("node_id", nodeId)
      .maybeSingle();
    if (error) {
      console.error("Variant override lookup failed:", error.message);
      return null;
    }
    return data ? data.variant : null;
  }

  // Blocks EVERY sabotage move (source side) the same way it already
  // blocks node/vault submission — a team an admin has blocked (or that
  // got auto-locked for leaving fullscreen/switching tabs) shouldn't be
  // able to keep attacking rivals while locked out of playing themselves.
  // See routes/team.js's integrity-lock endpoint and routes/admin.js's
  // block/unlock endpoints for how this flag gets set/cleared.
  async function isIntegrityLocked(teamId) {
    const { data, error } = await supabase
      .from("teams")
      .select("integrity_locked")
      .eq("id", teamId)
      .maybeSingle();
    if (error) {
      console.error("Integrity lock check failed:", error.message);
      return false; // fail open — a lookup error shouldn't itself block play
    }
    return !!(data && data.integrity_locked);
  }

  async function getVariantOverrides(teamId) {
    const { data, error } = await supabase
      .from("team_node_variant_overrides")
      .select("node_id, variant")
      .eq("team_id", teamId);
    if (error) {
      console.error("Variant overrides lookup failed:", error.message);
      return {};
    }
    const map = {};
    for (const row of data || []) map[row.node_id] = row.variant;
    return map;
  }

  return {
    SABOTAGE_MOVES,
    DISABLE_CAP_SECONDS,
    DISABLE_CAP_WINDOW_MINUTES,
    SAFE_WINDOW_MINUTES,
    getGameState,
    sabotageEnabledCheck,
    vaultLockedError,
    getShieldUntil,
    getCooldown,
    setCooldown,
    getDisabledSecondsInWindow,
    logDisableSeconds,
    getActiveFreeze,
    getVariantOverride,
    getVariantOverrides,
    isIntegrityLocked,
  };
}

module.exports = { createSabotageState };