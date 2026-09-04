// Admin auth (the x-admin-secret header gate) and a small PIN helper used
// when bulk-creating team accounts.

function requireAdmin(ADMIN_SECRET) {
  return function (req, res, next) {
    const provided = req.get("x-admin-secret");
    if (!ADMIN_SECRET || !provided || provided !== ADMIN_SECRET) {
      return res.status(401).json({ error: "Not authorized." });
    }
    next();
  };
}

function randomPin(digits = 4) {
  const min = 10 ** (digits - 1);
  const max = 10 ** digits;
  return String(Math.floor(min + Math.random() * (max - min)));
}

module.exports = { requireAdmin, randomPin };
