// Sabotage routes. Every offensive move (Freeze / Static Burst /
// Reshuffle) charges the attacker up front and sets its cooldown before
// checking the anti-grief cap — per the doc: a capped attempt still costs
// the attacker, no refund. Shield blocks all four when active. Shared
// state helpers (game clock, cooldowns, Shield, disable cap) live in
// ./state.js.

function registerSabotageRoutes(app, { supabase, sabotageState }) {
  const {
    SABOTAGE_MOVES,
    DISABLE_CAP_SECONDS,
    SAFE_WINDOW_MINUTES,
    getGameState,
    sabotageEnabledCheck,
    vaultLockedError,
    getShieldUntil,
    getCooldown,
    setCooldown,
    getDisabledSecondsInWindow,
    logDisableSeconds,
    isIntegrityLocked,
  } = sabotageState;

  // GET /api/game/state — public: is sabotage on right now, and why not
  // if it isn't. map.html polls this alongside /api/sabotage/state/:teamId.
  app.get("/api/game/state", async (req, res) => {
    const state = await getGameState();
    const gate = await sabotageEnabledCheck();
    res.json({
      startedAt: state.startedAt,
      sabotageSuspended: state.sabotageSuspended,
      safeWindowMinutes: SAFE_WINDOW_MINUTES,
      sabotageEnabled: gate.enabled,
      sabotageDisabledReason: gate.enabled ? null : gate.reason,
    });
  });

  // POST /api/sabotage/active-node { teamId, nodeId } — nodeId may be
  // null to clear it. Called by map.html whenever a puzzle modal
  // opens/closes; powers Peek (what a rival's working on) and Reshuffle
  // (which node to regenerate).
  app.post("/api/sabotage/active-node", async (req, res) => {
    const { teamId } = req.body || {};
    let { nodeId } = req.body || {};
    if (!teamId) return res.status(400).json({ error: "teamId is required." });
    nodeId = nodeId === null || nodeId === undefined ? null : Number(nodeId);
    if (nodeId !== null && !Number.isInteger(nodeId)) {
      return res.status(400).json({ error: "nodeId must be an integer or null." });
    }

    const { error } = await supabase.from("team_sabotage").upsert({ team_id: teamId, active_node_id: nodeId });
    if (error) {
      console.error("Active-node write failed:", error.message);
      return res.status(500).json({ error: "Couldn't update active node." });
    }
    res.json({ ok: true });
  });

  // GET /api/sabotage/state/:teamId — everything a team's sabotage panel
  // needs in one poll: their own Intel/Shield, incoming effects, and
  // every rival with per-move cooldowns so the UI can grey out what's on
  // cooldown before the team even tries it.
  app.get("/api/sabotage/state/:teamId", async (req, res) => {
    const { teamId } = req.params;

    const { data: team, error: teamErr } = await supabase.from("teams").select("id, intel").eq("id", teamId).maybeSingle();
    if (teamErr || !team) return res.status(404).json({ error: "No such team." });

    const gate = await sabotageEnabledCheck();

    const { data: sab, error: sabErr } = await supabase
      .from("team_sabotage")
      .select("shield_until, shield_free_charges")
      .eq("team_id", teamId)
      .maybeSingle();
    if (sabErr) console.error("Sabotage state lookup failed:", sabErr.message);
    const shieldUntil = sab && sab.shield_until && new Date(sab.shield_until) > new Date() ? sab.shield_until : null;
    const shieldFreeCharges = sab ? sab.shield_free_charges : 1;

    const { data: incomingRows, error: incomingErr } = await supabase
      .from("sabotage_effects")
      .select("move, expires_at, source_team_id")
      .eq("target_team_id", teamId)
      .gt("expires_at", new Date().toISOString());
    if (incomingErr) console.error("Incoming effects lookup failed:", incomingErr.message);

    const sourceIds = [...new Set((incomingRows || []).map((r) => r.source_team_id))];
    let sourceNames = {};
    if (sourceIds.length) {
      const { data: sourceTeams } = await supabase.from("teams").select("id, team_name").in("id", sourceIds);
      for (const t of sourceTeams || []) sourceNames[t.id] = t.team_name;
    }
    const incoming = (incomingRows || []).map((r) => ({
      move: r.move,
      expiresAt: r.expires_at,
      secondsLeft: Math.ceil((new Date(r.expires_at) - new Date()) / 1000),
      sourceTeamName: sourceNames[r.source_team_id] || "Unknown",
    }));

    const { data: rivalTeams, error: rivalErr } = await supabase
      .from("teams")
      .select("id, team_name, vault_reached_at")
      .neq("id", teamId)
      .order("team_name", { ascending: true });
    if (rivalErr) console.error("Rival roster lookup failed:", rivalErr.message);

    const { data: cooldownRows, error: cooldownErr } = await supabase
      .from("sabotage_cooldowns")
      .select("target_team_id, move, available_at")
      .eq("source_team_id", teamId)
      .gt("available_at", new Date().toISOString());
    if (cooldownErr) console.error("Cooldown roster lookup failed:", cooldownErr.message);

    const cooldownByTarget = {};
    for (const row of cooldownRows || []) {
      if (!cooldownByTarget[row.target_team_id]) cooldownByTarget[row.target_team_id] = {};
      cooldownByTarget[row.target_team_id][row.move] = Math.ceil((new Date(row.available_at) - new Date()) / 1000);
    }

    const rivals = (rivalTeams || []).map((t) => ({
      teamId: t.id,
      teamName: t.team_name,
      vaultReached: !!t.vault_reached_at,
      cooldowns: {
        freeze: (cooldownByTarget[t.id] && cooldownByTarget[t.id].freeze) || 0,
        static_burst: (cooldownByTarget[t.id] && cooldownByTarget[t.id].static_burst) || 0,
        reshuffle: (cooldownByTarget[t.id] && cooldownByTarget[t.id].reshuffle) || 0,
      },
    }));

    res.json({
      intel: team.intel,
      sabotageEnabled: gate.enabled,
      sabotageDisabledReason: gate.enabled ? null : gate.reason,
      shieldUntil,
      shieldFreeCharges,
      incoming,
      rivals,
      moves: {
        peek: { cost: SABOTAGE_MOVES.peek.cost },
        freeze: { cost: SABOTAGE_MOVES.freeze.cost, cooldownSeconds: SABOTAGE_MOVES.freeze.cooldownSeconds, durationSeconds: SABOTAGE_MOVES.freeze.durationSeconds },
        static_burst: { cost: SABOTAGE_MOVES.static_burst.cost, cooldownSeconds: SABOTAGE_MOVES.static_burst.cooldownSeconds, durationSeconds: SABOTAGE_MOVES.static_burst.durationSeconds },
        reshuffle: { cost: SABOTAGE_MOVES.reshuffle.cost, cooldownSeconds: SABOTAGE_MOVES.reshuffle.cooldownSeconds },
        shield: { cost: SABOTAGE_MOVES.shield.cost, durationSeconds: SABOTAGE_MOVES.shield.durationSeconds },
      },
    });
  });

  // POST /api/sabotage/peek { teamId, targetTeamId } — info only, no cooldown.
  app.post("/api/sabotage/peek", async (req, res) => {
    const { teamId, targetTeamId } = req.body || {};
    if (!teamId || !targetTeamId) return res.status(400).json({ error: "teamId and targetTeamId are required." });
    if (teamId === targetTeamId) return res.status(400).json({ error: "Can't target your own team." });

    const gate = await sabotageEnabledCheck();
    if (!gate.enabled) return res.status(400).json({ error: gate.reason });

    if (await isIntegrityLocked(teamId)) {
      return res.status(400).json({ error: "Your station is locked - find a volunteer to unlock it.", integrityLocked: true });
    }

    const move = SABOTAGE_MOVES.peek;
    const { data: source, error: sourceErr } = await supabase.from("teams").select("intel").eq("id", teamId).maybeSingle();
    if (sourceErr || !source) return res.status(404).json({ error: "No such team." });
    if (source.intel < move.cost) return res.status(400).json({ error: `Not enough Intel — Peek costs ${move.cost}.` });

    const { data: target, error: targetErr } = await supabase.from("teams").select("team_name, vault_reached_at").eq("id", targetTeamId).maybeSingle();
    if (targetErr || !target) return res.status(404).json({ error: "No such target team." });
    if (target.vault_reached_at) return res.status(400).json(vaultLockedError(target.team_name));

    const shieldUntil = await getShieldUntil(targetTeamId);
    if (shieldUntil) return res.status(400).json({ error: `${target.team_name} is shielded.`, shielded: true });

    const { error: chargeErr } = await supabase.from("teams").update({ intel: source.intel - move.cost }).eq("id", teamId);
    if (chargeErr) {
      console.error("Peek charge failed:", chargeErr.message);
      return res.status(500).json({ error: "Couldn't charge Intel. Try again." });
    }

    const { data: sab, error: sabErr } = await supabase
      .from("team_sabotage")
      .select("active_node_id")
      .eq("team_id", targetTeamId)
      .maybeSingle();
    if (sabErr) console.error("Peek active-node lookup failed:", sabErr.message);

    res.json({
      ok: true,
      targetTeamName: target.team_name,
      activeNodeId: sab ? sab.active_node_id : null,
      intelSpent: move.cost,
      remainingIntel: source.intel - move.cost,
    });
  });

  // POST /api/sabotage/freeze { teamId, targetTeamId }
  app.post("/api/sabotage/freeze", async (req, res) => {
    const { teamId, targetTeamId } = req.body || {};
    if (!teamId || !targetTeamId) return res.status(400).json({ error: "teamId and targetTeamId are required." });
    if (teamId === targetTeamId) return res.status(400).json({ error: "Can't target your own team." });

    const gate = await sabotageEnabledCheck();
    if (!gate.enabled) return res.status(400).json({ error: gate.reason });

    if (await isIntegrityLocked(teamId)) {
      return res.status(400).json({ error: "Your station is locked - find a volunteer to unlock it.", integrityLocked: true });
    }

    const move = SABOTAGE_MOVES.freeze;
    const { data: source, error: sourceErr } = await supabase.from("teams").select("intel").eq("id", teamId).maybeSingle();
    if (sourceErr || !source) return res.status(404).json({ error: "No such team." });
    if (source.intel < move.cost) return res.status(400).json({ error: `Not enough Intel — Freeze costs ${move.cost}.` });

    const { data: target, error: targetErr } = await supabase.from("teams").select("team_name, vault_reached_at").eq("id", targetTeamId).maybeSingle();
    if (targetErr || !target) return res.status(404).json({ error: "No such target team." });
    if (target.vault_reached_at) return res.status(400).json(vaultLockedError(target.team_name));

    const shieldUntil = await getShieldUntil(targetTeamId);
    if (shieldUntil) return res.status(400).json({ error: `${target.team_name} is shielded.`, shielded: true });

    const cooldownUntil = await getCooldown(teamId, targetTeamId, "freeze");
    if (cooldownUntil) {
      const secondsLeft = Math.ceil((new Date(cooldownUntil) - new Date()) / 1000);
      return res.status(400).json({ error: `Freeze on ${target.team_name} is on cooldown.`, cooldownSecondsLeft: secondsLeft });
    }

    // Charge + set cooldown up front — the doc is explicit that a
    // blocked attempt (anti-grief cap) still costs the attacker, no refund.
    const { error: chargeErr } = await supabase.from("teams").update({ intel: source.intel - move.cost }).eq("id", teamId);
    if (chargeErr) {
      console.error("Freeze charge failed:", chargeErr.message);
      return res.status(500).json({ error: "Couldn't charge Intel. Try again." });
    }
    await setCooldown(teamId, targetTeamId, "freeze", move.cooldownSeconds);

    const disabledSoFar = await getDisabledSecondsInWindow(targetTeamId);
    if (disabledSoFar + move.durationSeconds > DISABLE_CAP_SECONDS) {
      return res.json({
        ok: true,
        applied: false,
        reason: "capped",
        message: `${target.team_name} has hit the anti-grief cap — Freeze didn't land, but the Intel is still spent.`,
        intelSpent: move.cost,
        remainingIntel: source.intel - move.cost,
      });
    }

    const expiresAt = new Date(Date.now() + move.durationSeconds * 1000).toISOString();
    const { error: effErr } = await supabase
      .from("sabotage_effects")
      .insert({ target_team_id: targetTeamId, source_team_id: teamId, move: "freeze", expires_at: expiresAt });
    if (effErr) {
      console.error("Freeze effect insert failed:", effErr.message);
      return res.status(500).json({ error: "Couldn't apply Freeze. Try again." });
    }
    await logDisableSeconds(targetTeamId, move.durationSeconds);

    res.json({
      ok: true,
      applied: true,
      targetTeamName: target.team_name,
      expiresAt,
      intelSpent: move.cost,
      remainingIntel: source.intel - move.cost,
    });
  });

  // POST /api/sabotage/static-burst { teamId, targetTeamId }
  app.post("/api/sabotage/static-burst", async (req, res) => {
    const { teamId, targetTeamId } = req.body || {};
    if (!teamId || !targetTeamId) return res.status(400).json({ error: "teamId and targetTeamId are required." });
    if (teamId === targetTeamId) return res.status(400).json({ error: "Can't target your own team." });

    const gate = await sabotageEnabledCheck();
    if (!gate.enabled) return res.status(400).json({ error: gate.reason });

    if (await isIntegrityLocked(teamId)) {
      return res.status(400).json({ error: "Your station is locked - find a volunteer to unlock it.", integrityLocked: true });
    }

    const move = SABOTAGE_MOVES.static_burst;
    const { data: source, error: sourceErr } = await supabase.from("teams").select("intel").eq("id", teamId).maybeSingle();
    if (sourceErr || !source) return res.status(404).json({ error: "No such team." });
    if (source.intel < move.cost) return res.status(400).json({ error: `Not enough Intel — Static Burst costs ${move.cost}.` });

    const { data: target, error: targetErr } = await supabase.from("teams").select("team_name, vault_reached_at").eq("id", targetTeamId).maybeSingle();
    if (targetErr || !target) return res.status(404).json({ error: "No such target team." });
    if (target.vault_reached_at) return res.status(400).json(vaultLockedError(target.team_name));

    const shieldUntil = await getShieldUntil(targetTeamId);
    if (shieldUntil) return res.status(400).json({ error: `${target.team_name} is shielded.`, shielded: true });

    const cooldownUntil = await getCooldown(teamId, targetTeamId, "static_burst");
    if (cooldownUntil) {
      const secondsLeft = Math.ceil((new Date(cooldownUntil) - new Date()) / 1000);
      return res.status(400).json({ error: `Static Burst on ${target.team_name} is on cooldown.`, cooldownSecondsLeft: secondsLeft });
    }

    const { error: chargeErr } = await supabase.from("teams").update({ intel: source.intel - move.cost }).eq("id", teamId);
    if (chargeErr) {
      console.error("Static Burst charge failed:", chargeErr.message);
      return res.status(500).json({ error: "Couldn't charge Intel. Try again." });
    }
    await setCooldown(teamId, targetTeamId, "static_burst", move.cooldownSeconds);

    const expiresAt = new Date(Date.now() + move.durationSeconds * 1000).toISOString();
    const { error: effErr } = await supabase
      .from("sabotage_effects")
      .insert({ target_team_id: targetTeamId, source_team_id: teamId, move: "static_burst", expires_at: expiresAt });
    if (effErr) {
      console.error("Static Burst effect insert failed:", effErr.message);
      return res.status(500).json({ error: "Couldn't apply Static Burst. Try again." });
    }

    res.json({
      ok: true,
      applied: true,
      targetTeamName: target.team_name,
      expiresAt,
      intelSpent: move.cost,
      remainingIntel: source.intel - move.cost,
    });
  });

  // POST /api/sabotage/reshuffle { teamId, targetTeamId } — same shape as
  // Freeze/Static Burst now (a timed effect row), so it always lands. See
  // the comment at the top of ./state.js for why this changed from the
  // doc's original "regenerate their active node" version.
  app.post("/api/sabotage/reshuffle", async (req, res) => {
    const { teamId, targetTeamId } = req.body || {};
    if (!teamId || !targetTeamId) return res.status(400).json({ error: "teamId and targetTeamId are required." });
    if (teamId === targetTeamId) return res.status(400).json({ error: "Can't target your own team." });

    const gate = await sabotageEnabledCheck();
    if (!gate.enabled) return res.status(400).json({ error: gate.reason });

    if (await isIntegrityLocked(teamId)) {
      return res.status(400).json({ error: "Your station is locked - find a volunteer to unlock it.", integrityLocked: true });
    }

    const move = SABOTAGE_MOVES.reshuffle;
    const { data: source, error: sourceErr } = await supabase.from("teams").select("intel").eq("id", teamId).maybeSingle();
    if (sourceErr || !source) return res.status(404).json({ error: "No such team." });
    if (source.intel < move.cost) return res.status(400).json({ error: `Not enough Intel — Reshuffle costs ${move.cost}.` });

    const { data: target, error: targetErr } = await supabase.from("teams").select("team_name, vault_reached_at").eq("id", targetTeamId).maybeSingle();
    if (targetErr || !target) return res.status(404).json({ error: "No such target team." });
    if (target.vault_reached_at) return res.status(400).json(vaultLockedError(target.team_name));

    const shieldUntil = await getShieldUntil(targetTeamId);
    if (shieldUntil) return res.status(400).json({ error: `${target.team_name} is shielded.`, shielded: true });

    const cooldownUntil = await getCooldown(teamId, targetTeamId, "reshuffle");
    if (cooldownUntil) {
      const secondsLeft = Math.ceil((new Date(cooldownUntil) - new Date()) / 1000);
      return res.status(400).json({ error: `Reshuffle on ${target.team_name} is on cooldown.`, cooldownSecondsLeft: secondsLeft });
    }

    // Charge + set cooldown up front — same "no refund" reasoning as Freeze.
    const { error: chargeErr } = await supabase.from("teams").update({ intel: source.intel - move.cost }).eq("id", teamId);
    if (chargeErr) {
      console.error("Reshuffle charge failed:", chargeErr.message);
      return res.status(500).json({ error: "Couldn't charge Intel. Try again." });
    }
    await setCooldown(teamId, targetTeamId, "reshuffle", move.cooldownSeconds);

    const disabledSoFar = await getDisabledSecondsInWindow(targetTeamId);
    if (disabledSoFar + move.durationSeconds > DISABLE_CAP_SECONDS) {
      return res.json({
        ok: true,
        applied: false,
        reason: "capped",
        message: `${target.team_name} has hit the anti-grief cap — Reshuffle didn't land, but the Intel is still spent.`,
        intelSpent: move.cost,
        remainingIntel: source.intel - move.cost,
      });
    }

    const expiresAt = new Date(Date.now() + move.durationSeconds * 1000).toISOString();
    const { error: effErr } = await supabase
      .from("sabotage_effects")
      .insert({ target_team_id: targetTeamId, source_team_id: teamId, move: "reshuffle", expires_at: expiresAt });
    if (effErr) {
      console.error("Reshuffle effect insert failed:", effErr.message);
      return res.status(500).json({ error: "Couldn't apply Reshuffle. Try again." });
    }
    await logDisableSeconds(targetTeamId, move.durationSeconds);

    res.json({
      ok: true,
      applied: true,
      targetTeamName: target.team_name,
      expiresAt,
      intelSpent: move.cost,
      remainingIntel: source.intel - move.cost,
    });
  });

  // POST /api/sabotage/shield { teamId } — self only. Every team gets one
  // free activation (doc: "one free charge") before it starts costing
  // Intel; stacking while already shielded keeps the longer expiry rather
  // than adding time.
  app.post("/api/sabotage/shield", async (req, res) => {
    const { teamId } = req.body || {};
    if (!teamId) return res.status(400).json({ error: "teamId is required." });

    const gate = await sabotageEnabledCheck();
    if (!gate.enabled) return res.status(400).json({ error: gate.reason });

    if (await isIntegrityLocked(teamId)) {
      return res.status(400).json({ error: "Your station is locked - find a volunteer to unlock it.", integrityLocked: true });
    }

    const move = SABOTAGE_MOVES.shield;
    const { data: sab, error: sabErr } = await supabase
      .from("team_sabotage")
      .select("shield_until, shield_free_charges")
      .eq("team_id", teamId)
      .maybeSingle();
    if (sabErr) {
      console.error("Shield lookup failed:", sabErr.message);
      return res.status(500).json({ error: "Couldn't check Shield. Try again." });
    }

    const freeCharges = sab ? sab.shield_free_charges : 1;
    const currentUntil = sab && sab.shield_until && new Date(sab.shield_until) > new Date() ? sab.shield_until : null;

    let usedFreeCharge = false;
    let intelSpent = 0;
    let remainingIntel;

    if (freeCharges > 0) {
      usedFreeCharge = true;
    } else {
      const { data: team, error: teamErr } = await supabase.from("teams").select("intel").eq("id", teamId).maybeSingle();
      if (teamErr || !team) return res.status(404).json({ error: "No such team." });
      if (team.intel < move.cost) return res.status(400).json({ error: `Not enough Intel — Shield costs ${move.cost}.` });
      const { error: chargeErr } = await supabase.from("teams").update({ intel: team.intel - move.cost }).eq("id", teamId);
      if (chargeErr) {
        console.error("Shield charge failed:", chargeErr.message);
        return res.status(500).json({ error: "Couldn't charge Intel. Try again." });
      }
      intelSpent = move.cost;
      remainingIntel = team.intel - move.cost;
    }

    const newUntil = new Date(Date.now() + move.durationSeconds * 1000).toISOString();
    const shieldUntil = currentUntil && new Date(currentUntil) > new Date(newUntil) ? currentUntil : newUntil;

    const { error: upsertErr } = await supabase.from("team_sabotage").upsert({
      team_id: teamId,
      shield_until: shieldUntil,
      shield_free_charges: usedFreeCharge ? Math.max(0, freeCharges - 1) : freeCharges,
    });
    if (upsertErr) {
      console.error("Shield write failed:", upsertErr.message);
      return res.status(500).json({ error: "Couldn't activate Shield. Try again." });
    }

    res.json({ ok: true, shieldUntil, usedFreeCharge, intelSpent, remainingIntel });
  });
}

module.exports = { registerSabotageRoutes };