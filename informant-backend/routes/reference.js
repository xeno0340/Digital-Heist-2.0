// Reference Console â€” curated fact lookup, deliberately separate from
// The Informant (see schema.sql for why: it's not a leverage-capped
// oracle, it's the venue's stand-in for "you're not allowed your phone").
// No auth required to search â€” these are meant to be look-up-able, and a
// query returns only rows that match it, not the whole table, so a team
// can't dump the full fact list without already knowing what to search
// for. Admin CRUD for this content lives in routes/admin.js.

function registerReferenceRoutes(app, { supabase }) {
  // GET /api/reference/search?q=titanic
  app.get("/api/reference/search", async (req, res) => {
    const q = String(req.query.q || "").trim().toLowerCase();
    if (!q) return res.json({ results: [] });
    if (q.length < 2) return res.status(400).json({ error: "Query too short." });

    const { data, error } = await supabase
      .from("reference_facts")
      .select("id, question, answer, keywords")
      .limit(500);
    if (error) return res.status(500).json({ error: error.message });

    const results = (data || [])
      .filter((row) =>
        row.keywords.toLowerCase().includes(q) ||
        row.question.toLowerCase().includes(q) ||
        row.answer.toLowerCase().includes(q)
      )
      .slice(0, 10)
      .map((row) => ({ question: row.question, answer: row.answer }));

    res.json({ results });
  });
}

module.exports = { registerReferenceRoutes };
