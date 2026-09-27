/*
 * /api/place?q=nom — « Trouver ma place » (public)
 * Renvoie au plus 6 invités confirmés dont le nom contient la recherche,
 * avec leur table et leurs voisins de table. Au moins 2 caractères requis.
 */
const L = require("./_lib");

const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

module.exports = L.handler(async (req, res) => {
  if (req.method !== "GET") return L.send(res, 405, { error: "Méthode non autorisée." });
  const q = norm(L.query(req).get("q")).slice(0, 40);
  if (q.length < 2) return L.send(res, 200, { results: [] });

  const [rsvps, rawPlan] = await Promise.all([L.hgetallJson(L.K.rsvps), L.redis(["GET", L.K.seating])]);
  const plan = rawPlan ? JSON.parse(rawPlan) : { tables: [], assign: {} };
  const tables = {};
  plan.tables.forEach((t) => { tables[t.id] = t; });
  const confirmed = Object.values(rsvps).filter((r) => r.presence === "oui");

  const results = confirmed
    .filter((r) => norm(r.nom).includes(q))
    .slice(0, 6)
    .map((r) => {
      const t = tables[plan.assign[r.id]];
      const voisins = t ? confirmed.filter((o) => o.id !== r.id && plan.assign[o.id] === t.id).map((o) => o.nom) : [];
      return { nom: r.nom, passagers: r.passagers, table: t ? t.name : null, voisins };
    });
  L.send(res, 200, { results });
});
