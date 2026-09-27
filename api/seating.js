/*
 * /api/seating — tables et placement (équipage connecté)
 *   GET              → { tables: [{ id, name, seats }], assign: { invitéId: tableId },
 *                        src: { invitéId: "invite" | "equipage" } }
 *   PUT { tables }   → remplace la liste des tables (noms, places) ; les invités
 *                      des tables supprimées redeviennent « pas encore à table »
 *   PATCH { id, table } → place (ou retire, table = null) un invité — sans toucher aux autres
 */
const L = require("./_lib");
const T = require("./_seating");

module.exports = L.handler(async (req, res) => {
  const me = await L.requireUser(req);

  if (req.method === "GET") {
    const plan = await T.getPlan(); // migre au besoin l'ancien format avant de lire les placements
    const full = await T.getAssignFull();
    const assign = {}, src = {};
    for (const [pid, a] of Object.entries(full)) { assign[pid] = a.t; src[pid] = a.src || "equipage"; }
    return L.send(res, 200, { tables: plan.tables, assign, src, updatedAt: plan.updatedAt || null });
  }

  const b = await L.readBody(req);

  if (req.method === "PUT") {
    if (!Array.isArray(b.tables) || b.tables.length > 60) throw new L.HttpError(400, "Liste de tables invalide.");
    const seen = new Set();
    const tables = b.tables.map((t, i) => {
      let id = L.str(t.id, 20).replace(/[^a-z0-9_-]/gi, "") || "t" + Date.now().toString(36) + i;
      while (seen.has(id)) id += "x";
      seen.add(id);
      return { id, name: L.str(t.name, 40) || "Table " + (i + 1), seats: Math.min(40, Math.max(1, parseInt(t.seats, 10) || 8)) };
    });
    const plan = await T.saveTables(tables, me.name);
    return L.send(res, 200, { tables: plan.tables, assign: await T.getAssign() });
  }

  if (req.method === "PATCH") {
    const id = L.str(b.id, 64);
    const table = b.table ? L.str(b.table, 20) : null;
    if (!id) throw new L.HttpError(400, "Invité manquant.");
    if (table) {
      const plan = await T.getPlan();
      if (!plan.tables.some((t) => t.id === table)) throw new L.HttpError(404, "Table introuvable.");
    }
    await T.setAssign(id, table, "equipage");
    return L.send(res, 200, { ok: true });
  }

  L.send(res, 405, { error: "Méthode non autorisée." });
});
