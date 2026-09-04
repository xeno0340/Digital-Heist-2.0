// Team profile — collected once on a team's first login (map.html's
// profile gate), editable anytime after from the dashboard's "Team
// Profile" button. See schema.sql's team_profiles table for the shape.
//
// No admin secret required here (unlike routes/admin.js) — a team only
// needs its own teamId, which it already holds from login, to read or
// write its own profile. There's no cross-team read here since every
// query is scoped to the :teamId in the URL.

const MIN_MEMBERS = 2;
const MAX_MEMBERS = 4;

// Shared shape check for POST — used instead of a DB constraint so a bad
// request gets a clear 400 with a real reason, rather than a vague
// Postgres error.
function validateProfileBody(body) {
    const { members, leadEmail, leadPhone } = body || {};

    if (!Array.isArray(members) || members.length < MIN_MEMBERS || members.length > MAX_MEMBERS) {
        return `members must be an array of ${MIN_MEMBERS}-${MAX_MEMBERS} people.`;
    }
    for (const m of members) {
        const name = String(m?.name || "").trim();
        const roll = String(m?.roll || "").trim();
        if (!name || !roll) return "Every member needs a name and a roll number.";
    }
    if (!String(leadEmail || "").trim()) return "leadEmail is required.";
    if (!String(leadPhone || "").trim()) return "leadPhone is required.";

    return null; // valid
}

function registerProfileRoutes(app, { supabase }) {
    // GET /api/team/:teamId/profile — returns { profile: null } if the team
    // hasn't filled one in yet (map.html's gate uses null to decide whether
    // to block the dashboard).
    //
    // IMPORTANT: a deleted team's profile row is gone too (cascade delete),
    // so without the existence check below this would return { profile:
    // null } for a deleted team - indistinguishable from a brand-new team
    // that just hasn't filled the form in yet. That's exactly what
    // map.html's onboarding gate reads as "show the profile form," so a
    // team deleted mid-session would land right back on the same gate with
    // no way out (every save attempt would then also fail - see the POST
    // handler below). Checking the team still exists first turns that into
    // a clean 404 the client can recognize and bounce back to login on.
    app.get("/api/team/:teamId/profile", async (req, res) => {
        const { teamId } = req.params;
        if (!teamId) return res.status(400).json({ error: "teamId is required." });

        const { data: team, error: teamErr } = await supabase.from("teams").select("id").eq("id", teamId).maybeSingle();
        if (teamErr) {
            console.error("Team existence check failed (profile GET):", teamErr.message);
            return res.status(500).json({ error: "Couldn't load the team profile." });
        }
        if (!team) return res.status(404).json({ error: "No such team." });

        const { data, error } = await supabase
            .from("team_profiles")
            .select("members, lead_email, lead_phone, updated_at")
            .eq("team_id", teamId)
            .maybeSingle();

        if (error) {
            console.error("Profile lookup failed:", error.message);
            return res.status(500).json({ error: "Couldn't load the team profile." });
        }

        if (!data) return res.json({ profile: null });

        res.json({
            profile: {
                members: data.members || [],
                leadEmail: data.lead_email || "",
                leadPhone: data.lead_phone || "",
                updatedAt: data.updated_at,
            },
        });
    });

    // POST /api/team/:teamId/profile { members, leadEmail, leadPhone }
    // Upsert — the first save creates the row, every save after that
    // (editing from the dashboard) just overwrites it. Team membership IS
    // re-checked against the teams table here (used to just rely on the
    // foreign key and return a generic 500 on failure — that turned into a
    // real bug: a team deleted from admin.html mid-session would get stuck
    // forever re-submitting into a 500 with no way to tell it was actually
    // gone). A proper 404 here lets the client recognize "this team no
    // longer exists" and bounce back to login instead.
    app.post("/api/team/:teamId/profile", async (req, res) => {
        const { teamId } = req.params;
        if (!teamId) return res.status(400).json({ error: "teamId is required." });

        const { data: team, error: teamErr } = await supabase.from("teams").select("id").eq("id", teamId).maybeSingle();
        if (teamErr) {
            console.error("Team existence check failed (profile POST):", teamErr.message);
            return res.status(500).json({ error: "Couldn't save the team profile." });
        }
        if (!team) return res.status(404).json({ error: "No such team." });

        const validationError = validateProfileBody(req.body);
        if (validationError) return res.status(400).json({ error: validationError });

        const { members, leadEmail, leadPhone } = req.body;
        const cleanMembers = members.map((m) => ({
            name: String(m.name).trim(),
            roll: String(m.roll).trim(),
        }));

        const { data, error } = await supabase
            .from("team_profiles")
            .upsert(
                {
                    team_id: teamId,
                    members: cleanMembers,
                    lead_email: String(leadEmail).trim(),
                    lead_phone: String(leadPhone).trim(),
                    updated_at: new Date().toISOString(),
                },
                { onConflict: "team_id" }
            )
            .select("members, lead_email, lead_phone, updated_at")
            .maybeSingle();

        if (error) {
            console.error("Profile save failed:", error.message);
            return res.status(500).json({ error: "Couldn't save the team profile." });
        }

        res.json({
            ok: true,
            profile: {
                members: data.members || [],
                leadEmail: data.lead_email || "",
                leadPhone: data.lead_phone || "",
                updatedAt: data.updated_at,
            },
        });
    });
}

module.exports = { registerProfileRoutes };