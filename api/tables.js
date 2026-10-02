/*
 * /api/tables — « À table ! » (public)
 *   GET                      → tables et invités installés (cache 2 s)
 *   GET ?q=nom               → recherche parmi les invités (3 caractères min., 8 résultats max.)
 *   POST { action: "sit", table, id }             → « je suis à cette table »
 *   POST { action: "sit", table, nom, passagers } → idem pour un invité absent de la liste
 *                                                   (créé comme réponse « sur place »)
 * S'installer à une table vaut pointage d'arrivée.
 */
const crypto = require("crypto");
const L = require("./_lib");
const T = require("./_seating");

const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

async function snapshot() {
  const plan = await T.getPlan(); // d'abord : migre au besoin l'ancien format avant de lire les placements
  const [assign, rsvps] = await Promise.all([T.getAssign(), L.hgetallJson(L.K.rsvps)]);
  const people = Object.values(rsvps).filter((r) => r.presence === "oui");
  let seated = 0;
  const tables = plan.tables.map((t) => {
    const here = people
      .filter((p) => assign[p.id] === t.id)
      .sort((a, b) => a.nom.localeCompare(b.nom, "fr"))
      .map((p) => ({ nom: p.nom, passagers: p.passagers || 1 }));
    const count = here.reduce((n, p) => n + p.passagers, 0);
    seated += count;
    return { id: t.id, name: t.name, seats: t.seats, count, people: here };
  });
  const expected = people.reduce((n, p) => n + (p.passagers || 1), 0);
  return { tables, seated, expected, rsvps, plan, assign };
}

module.exports = L.handler(async (req, res) => {
  if (req.method === "GET") {
    const q = norm(L.query(req).get("q")).slice(0, 40);
    if (L.query(req).has("q")) {
      if (q.length < 3) return L.send(res, 200, { results: [] });
      await L.rateLimit(req, "tables-q", 400, 60);
      const { rsvps, plan, assign } = await snapshot();
      const names = {};
      plan.tables.forEach((t) => { names[t.id] = t.name; });
      const results = Object.values(rsvps)
        .filter((r) => r.presence === "oui" && norm([r.nom].concat(r.accompagnants || []).join(" ")).includes(q))
        .sort((a, b) => a.nom.localeCompare(b.nom, "fr"))
        .slice(0, 8)
        .map((r) => ({ id: r.id, nom: r.nom + (r.accompagnants && r.accompagnants.length ? " (avec " + r.accompagnants.join(", ") + ")" : ""), passagers: r.passagers || 1, table: assign[r.id] && names[assign[r.id]] ? { id: assign[r.id], name: names[assign[r.id]] } : null }));
      return L.send(res, 200, { results });
    }
    const { tables, seated, expected } = await snapshot();
    return L.send(res, 200, { tables, seated, expected }, { "Cache-Control": "public, max-age=0, s-maxage=2, stale-while-revalidate=3" });
  }

  if (req.method === "POST") {
    const b = await L.readBody(req);
    if (b.action !== "sit") throw new L.HttpError(400, "Action inconnue.");
    if (b.website) return L.send(res, 200, { ok: true });
    await L.rateLimit(req, "tables-sit", 300, 60);

    const plan = await T.getPlan();
    const table = plan.tables.find((t) => t.id === L.str(b.table, 20));
    if (!table) throw new L.HttpError(404, "Cette table n'existe pas (ou plus). Demandez à l'équipage.");

    let entry = null;
    if (b.id) {
      const raw = await L.redis(["HGET", L.K.rsvps, L.str(b.id, 64)]);
      if (!raw) throw new L.HttpError(404, "Invité introuvable, cherchez à nouveau votre nom.");
      entry = JSON.parse(raw);
    } else {
      const nom = L.str(b.nom, 80);
      if (norm(nom).length < 2) throw new L.HttpError(400, "Indiquez votre nom.");
      const all = Object.values(await L.hgetallJson(L.K.rsvps));
      entry = all.find((r) => norm(r.nom) === norm(nom)) || null;
      if (!entry) {
        await L.rateLimit(req, "tables-new", 150, 600); // ajouts sur place : toute la salle, pas plus
        entry = {
          id: crypto.randomUUID(), nom, presence: "oui",
          passagers: Math.min(12, Math.max(1, parseInt(b.passagers, 10) || 1)),
          repas: "Standard", allergies: "", email: "", message: "",
          source: "sur place", createdAt: new Date().toISOString(),
        };
      }
    }
    entry.presence = "oui";
    if (!(entry.passagers >= 1)) entry.passagers = 1; // avait répondu « au sol » mais est finalement venu
    if (!entry.arrivedAt) entry.arrivedAt = new Date().toISOString();
    await L.redis(["HSET", L.K.rsvps, entry.id, JSON.stringify(entry)]);
    await T.setAssign(entry.id, table.id, "invite");

    const snap = await snapshot();
    const mine = snap.tables.find((t) => t.id === table.id);
    return L.send(res, 200, { me: { id: entry.id, nom: entry.nom, passagers: entry.passagers || 1 }, table: mine });
  }

  L.send(res, 405, { error: "Méthode non autorisée." });
});
