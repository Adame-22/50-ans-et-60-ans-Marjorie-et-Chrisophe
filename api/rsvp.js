/*
 * /api/rsvp — réponses des invités
 *   POST   (public)  { nom, presence, passagers, repas, allergies, email, message }
 *   GET    (équipage) → toutes les réponses
 *   PATCH  (équipage) { id, arrived }  → pointage à l'arrivée
 *   DELETE (équipage) ?id=…
 */
const crypto = require("crypto");
const L = require("./_lib");

const REPAS = ["Standard", "Végétarien", "Végétalien", "Sans gluten", "Sans porc", "Enfant", "Autre"];

module.exports = L.handler(async (req, res) => {
  if (req.method === "POST") {
    const b = await L.readBody(req);
    if (b.website) return L.send(res, 200, { ok: true }); // pot de miel anti-robots
    const nom = L.str(b.nom, 80);
    if (!nom) throw new L.HttpError(400, "Merci d'indiquer le nom du passager.");
    const oui = b.presence === "oui";
    const passagers = oui ? Math.min(12, Math.max(1, parseInt(b.passagers, 10) || 1)) : 0;
    const email = L.str(b.email, 120);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new L.HttpError(400, "L'adresse e-mail semble incorrecte.");
    const entry = {
      id: crypto.randomUUID(),
      nom,
      presence: oui ? "oui" : "non",
      passagers,
      repas: oui && REPAS.includes(b.repas) ? b.repas : oui ? "Standard" : "",
      allergies: oui ? L.str(b.allergies, 300) : "",
      email,
      message: L.str(b.message, 1500),
      createdAt: new Date().toISOString(),
    };
    await L.redis(["HSET", L.K.rsvps, entry.id, JSON.stringify(entry)]);
    return L.send(res, 201, { ok: true, id: entry.id });
  }

  await L.requireUser(req);

  if (req.method === "GET") {
    const rsvps = Object.values(await L.hgetallJson(L.K.rsvps)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return L.send(res, 200, { rsvps });
  }

  if (req.method === "PATCH") {
    const b = await L.readBody(req);
    const raw = await L.redis(["HGET", L.K.rsvps, L.str(b.id, 64)]);
    if (!raw) throw new L.HttpError(404, "Réponse introuvable.");
    const entry = JSON.parse(raw);
    entry.arrivedAt = b.arrived ? new Date().toISOString() : null;
    await L.redis(["HSET", L.K.rsvps, entry.id, JSON.stringify(entry)]);
    return L.send(res, 200, { rsvp: entry });
  }

  if (req.method === "DELETE") {
    const id = L.str(L.query(req).get("id"), 64);
    await L.redis(["HDEL", L.K.rsvps, id]);
    return L.send(res, 200, { ok: true });
  }

  L.send(res, 405, { error: "Méthode non autorisée." });
});
