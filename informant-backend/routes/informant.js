// The Informant â€” GET/POST /api/informant, POST /api/informant/reset.
// Session state (history, which facts are lies, remaining leverage) lives
// in Supabase, not server memory â€” required for this to work correctly on
// Vercel, where a serverless function can't rely on the same process
// handling a team's next request.

const { FRAGMENTS, STARTING_LEVERAGE, pickLieIndexes, buildSystemPrompt } = require("../data/informantKnowledge");

// Cost note: with the leverage cap (8 questions/team) and short, capped
// replies, ~30 teams playing a full game costs a few cents on
// gpt-4o-mini, not dollars â€” the leverage limit is your real cost
// control, not the model choice. Watch usage at platform.openai.com/usage
// during your first dry run to confirm.

async function callOpenAI(OPENAI_API_KEY, OPENAI_MODEL, systemPrompt, history) {
  const url = "https://api.openai.com/v1/chat/completions";

  const messages = [
    { role: "system", content: systemPrompt },
    ...history.map((turn) => ({
      role: turn.role, // "user" or "assistant"
      content: turn.text,
    })),
  ];

  const body = {
    model: OPENAI_MODEL,
    messages,
    temperature: 0.9,
    max_tokens: 120, // keep replies short - also keeps cost near-zero
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`OpenAI API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error("OpenAI returned no text (empty response).");
  return text.trim();
}

function registerInformantRoutes(app, { supabase, OPENAI_API_KEY, OPENAI_MODEL }) {
  async function getSession(teamId) {
    const { data, error } = await supabase
      .from("informant_sessions")
      .select("*")
      .eq("team_id", teamId)
      .maybeSingle();

    if (error) throw new Error(`Supabase read failed: ${error.message}`);

    if (data) {
      return {
        history: data.history || [],
        lieIndexes: data.lie_indexes || [],
        leverage: data.leverage,
      };
    }

    // First time this team has messaged The Informant â€” create their row.
    const fresh = {
      history: [],
      lieIndexes: pickLieIndexes(),
      leverage: STARTING_LEVERAGE,
    };

    const { error: insertError } = await supabase.from("informant_sessions").insert({
      team_id: teamId,
      history: fresh.history,
      lie_indexes: fresh.lieIndexes,
      leverage: fresh.leverage,
    });

    if (insertError) throw new Error(`Supabase insert failed: ${insertError.message}`);
    return fresh;
  }

  async function saveSession(teamId, session) {
    const { error } = await supabase
      .from("informant_sessions")
      .update({
        history: session.history,
        leverage: session.leverage,
        updated_at: new Date().toISOString(),
      })
      .eq("team_id", teamId);

    if (error) throw new Error(`Supabase write failed: ${error.message}`);
  }

  // GET /api/informant/:teamId â€” load existing history + leverage without
  // spending a question. Powers frontend/index.html's dev test page (and
  // map.html's Informant tab) "resume where I left off on reload"
  // behavior: it calls this first, and only asks for the opening line via
  // POST if history comes back empty.
  app.get("/api/informant/:teamId", async (req, res) => {
    const { teamId } = req.params;
    if (!teamId) return res.status(400).json({ error: "teamId is required" });

    try {
      const session = await getSession(teamId);
      res.json({
        history: session.history,
        leverage: session.leverage,
        gameOver: session.leverage <= 0,
      });
    } catch (err) {
      console.error(err.message);
      res.status(500).json({ error: "Couldn't load session." });
    }
  });

  // POST /api/informant  { teamId, message }
  // message can be omitted on the very first call to just get the opening line.
  app.post("/api/informant", async (req, res) => {
    const { teamId, message } = req.body || {};
    if (!teamId || typeof teamId !== "string") {
      return res.status(400).json({ error: "teamId is required" });
    }

    let session;
    try {
      session = await getSession(teamId);
    } catch (err) {
      console.error(err.message);
      return res.status(500).json({ error: "Couldn't load session." });
    }

    if (session.leverage <= 0) {
      return res.json({
        reply: "The Informant has gone dark. There's nothing left to ask.",
        leverage: 0,
        gameOver: true,
      });
    }

    const isFirstMessage = session.history.length === 0 && !message;

    if (!isFirstMessage) {
      if (!message || typeof message !== "string") {
        return res.status(400).json({ error: "message is required" });
      }
      session.history.push({ role: "user", text: message });
      session.leverage -= 1;
    } else {
      session.history.push({
        role: "user",
        text: "(A player has just opened this channel. Give your opening line.)",
      });
    }

    try {
      const systemPrompt = buildSystemPrompt(session);
      const reply = await callOpenAI(OPENAI_API_KEY, OPENAI_MODEL, systemPrompt, session.history);
      session.history.push({ role: "assistant", text: reply });
      await saveSession(teamId, session);

      res.json({
        reply,
        leverage: session.leverage,
        gameOver: session.leverage <= 0,
      });
    } catch (err) {
      console.error("Informant error:", err.message);
      // Roll back the spent leverage since the call failed â€” the team
      // shouldn't lose a question to a server/network error. Note we
      // don't save session here, so the DB still holds the pre-spend
      // leverage.
      res.status(502).json({ error: "The Informant didn't respond. Try again." });
    }
  });

  // POST /api/informant/reset { teamId } â€” used by the dev test page's
  // "New test team" button; not part of the real team-facing flow.
  app.post("/api/informant/reset", async (req, res) => {
    const { teamId } = req.body || {};
    if (!teamId) return res.status(400).json({ error: "teamId is required" });
    const { error } = await supabase.from("informant_sessions").delete().eq("team_id", teamId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  });
}

module.exports = { registerInformantRoutes, FRAGMENTS };
