/*
 * /api/seating — plan de cabine (répartition des invités par rang / table)
 *   GET → { tables: [{ id, name, seats }], assign: { rsvpId: tableId } }
 *   PUT   même format, remplace le plan
 */
const L = require("./_lib");

function defaultPlan() {
  return {
    tables: Array.from({ length: 10 }, (_, i) => ({ id: "t" + (i + 1), name: "Rang " + (i + 1), seats: 8 })),
    assign: {},
  };
}

module.exports = L.handler(async (req, res) => {
  const me = await L.requireUser(req);

  if (req.method === "GET") {
    const raw = await L.redis(["GET", L.K.seating]);
    return L.send(res, 200, raw ? JSON.parse(raw) : defaultPlan());
  }

  if (req.method === "PUT") {
    const b = await L.readBody(req);
    if (!Array.isArray(b.tables) || b.tables.length > 60) throw new L.HttpError(400, "Plan invalide.");
    const tables = b.tables.map((t, i) => ({
      id: L.str(t.id, 20) || "t" + Date.now() + i,
      name: L.str(t.name, 40) || "Rang " + (i + 1),
      seats: Math.min(40, Math.max(1, parseInt(t.seats, 10) || 8)),
    }));
    const ids = new Set(tables.map((t) => t.id));
    const assign = {};
    for (const [rsvpId, tableId] of Object.entries(b.assign || {})) {
      if (ids.has(tableId)) assign[L.str(rsvpId, 64)] = tableId;
    }
    const plan = { tables, assign, updatedAt: new Date().toISOString(), updatedBy: me.name };
    await L.redis(["SET", L.K.seating, JSON.stringify(plan)]);
    return L.send(res, 200, plan);
  }

  L.send(res, 405, { error: "Méthode non autorisée." });
});
