/*
 * /api/rsvp — réponses des invités
 *   POST   (public)  { nom, presence, creneau (midi | soir | journee), passagers, accompagnants, repas, allergies, email, message }
 *   GET    (équipage) → toutes les réponses
 *   PATCH  (équipage) { id, arrived }  → pointage à l'arrivée
 *   DELETE (équipage) ?id=…
 *   GET    ?pass=<jeton>   (public)   → carte d'embarquement d'une réponse (lien personnel)
 *   GET    ?view=notify    (équipage) → envoi automatique par e-mail configuré ?
 *   POST   { action: "send", ids } (équipage) → envoie les cartes par e-mail
 *   POST   { action: "mail-config", provider, key, from, fromName } (admin) → réglages d'envoi
 *   POST   { action: "mail-test", to } (admin) → e-mail d'essai ; { action: "mail-off" } → efface les réglages
 *   À l'enregistrement, la carte est envoyée par e-mail si l'envoi est configuré (Brevo ou AgentMail).
 */
const crypto = require("crypto");
const L = require("./_lib");
const N = require("./_notify");
const T = require("./_seating");

const REPAS = ["Standard", "Végétarien", "Végétalien", "Sans gluten", "Sans porc", "Enfant", "Autre"];

function passView(e) {
  const fares = [e.creneau || "journee"].concat(e.creneauxAcc || []);
  const names = [e.nom].concat(e.accompagnants || []);
  const people = [];
  for (let i = 0; i < Math.max(1, e.passagers || 1); i++) {
    people.push({ nom: names[i] || "Passager " + (i + 1), creneau: fares[i] || fares[0] });
  }
  return { presence: e.presence, nom: e.nom, prenom: e.prenom || String(e.nom || "").split(" ")[0], passagers: e.passagers, people, repas: e.repas, ref: String(e.id).slice(0, 6).toUpperCase() };
}

module.exports = L.handler(async (req, res) => {
  const q = L.query(req);
  if (req.method === "GET" && q.get("pass")) {
    await L.rateLimit(req, "pass", 300, 600);
    const token = L.str(q.get("pass"), 40);
    // carte de démonstration (lien des e-mails d'essai)
    if (token === "demo") {
      return L.send(res, 200, passView({ id: "demo00", presence: "oui", nom: "Passager test", prenom: "Passager", passagers: 1, creneau: "journee", repas: "Standard" }));
    }
    const all = Object.values(await L.hgetallJson(L.K.rsvps));
    const e = token.length >= 12 && all.find((r) => r.passToken === token);
    if (!e) throw new L.HttpError(404, "Carte introuvable : le lien est peut-être incomplet.");
    return L.send(res, 200, passView(e));
  }

  if (req.method === "POST") {
    const b = await L.readBody(req);
    if (b.action === "mail-config" || b.action === "mail-test" || b.action === "mail-off") {
      const me = await L.requireUser(req, { admin: true });
      if (b.action === "mail-config") await N.saveConfig(b, me.username);
      if (b.action === "mail-off") await N.clearConfig();
      if (b.action === "mail-test") await N.sendTest(req, L.str(b.to, 120));
      return L.send(res, 200, Object.assign(await N.adminView(), { site: N.siteUrl(req) }));
    }
    if (b.action === "send") {
      await L.requireUser(req);
      const cfg = await N.getConfig();
      if (!(await N.status()).email) throw new L.HttpError(400, "L'envoi automatique n'est pas encore réglé (Manifeste → Réglages de l'envoi).");
      const channel = "email";
      const ids = (Array.isArray(b.ids) ? b.ids : []).slice(0, 300).map((x) => L.str(x, 64));
      const out = { sent: 0, skipped: 0, errors: [] };
      for (const id of ids) {
        const raw = await L.redis(["HGET", L.K.rsvps, id]);
        if (!raw) continue;
        const e = JSON.parse(raw);
        if (channel === "email" ? !e.email : !N.phoneE164(e.telephone)) { out.skipped++; continue; }
        try {
          N.ensureToken(e);
          await N.sendEmail(req, e, cfg);
          e[channel === "email" ? "emailedAt" : "smsAt"] = new Date().toISOString();
          await L.redis(["HSET", L.K.rsvps, e.id, JSON.stringify(e)]);
          out.sent++;
        } catch (err) { out.errors.push(e.nom + " : " + err.message); }
      }
      return L.send(res, 200, out);
    }
    if (b.website) return L.send(res, 200, { ok: true }); // pot de miel anti-robots
    await L.rateLimit(req, "rsvp", 60, 600);
    const prenom = L.str(b.prenom, 40), nomFamille = L.str(b.nomFamille, 40);
    const nom = L.str(b.nom, 80) || (prenom + " " + nomFamille).trim();
    if (!nom) throw new L.HttpError(400, "Merci d'indiquer le nom du passager.");
    const oui = b.presence === "oui";
    const passagers = oui ? Math.min(12, Math.max(1, parseInt(b.passagers, 10) || 1)) : 0;
    const email = L.str(b.email, 120);
    const telephone = L.str(b.telephone, 20).replace(/[^\d+ .()-]/g, "");
    const byCrew = b.source === "equipage" && (await L.requireUser(req)); // ajout manuel depuis l'admin
    if (!email && !telephone && !byCrew) throw new L.HttpError(400, "Indiquez votre e-mail ou votre numéro de portable.");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new L.HttpError(400, "L'adresse e-mail semble incorrecte.");
    const entry = {
      id: crypto.randomUUID(),
      nom, prenom, nomFamille, telephone,
      passToken: crypto.randomBytes(12).toString("base64url"),
      source: byCrew ? "equipage" : undefined,
      presence: oui ? "oui" : "non",
      passagers,
      creneau: oui && ["midi", "soir", "journee"].includes(b.creneau) ? b.creneau : oui ? "journee" : "",
      repas: oui && REPAS.includes(b.repas) ? b.repas : oui ? "Standard" : "",
      allergies: oui ? L.str(b.allergies, 300) : "",
      accompagnants: oui && Array.isArray(b.accompagnants) ? b.accompagnants.slice(0, 11).map((x) => L.str(x, 60)).filter(Boolean) : [],
      // billet de chaque accompagnant, dans le même ordre (midi | soir | journee)
      creneauxAcc: oui && Array.isArray(b.creneauxAcc) ? b.creneauxAcc.slice(0, 11).map((x) => (["midi", "soir", "journee"].includes(x) ? x : "")) : [],
      email,
      message: L.str(b.message, 1500),
      createdAt: new Date().toISOString(),
    };
    await L.redis(["HSET", L.K.rsvps, entry.id, JSON.stringify(entry)]);
    // carte d'embarquement envoyée tout de suite par e-mail, si l'envoi est configuré
    let emailed = false;
    if (entry.email && (await N.status()).email) {
      try { await N.sendEmail(req, entry); entry.emailedAt = new Date().toISOString(); emailed = true; await L.redis(["HSET", L.K.rsvps, entry.id, JSON.stringify(entry)]); }
      catch (e) { console.error("e-mail non envoyé", e.message); }
    }
    return L.send(res, 201, { ok: true, id: entry.id, pass: entry.passToken, emailed });
  }

  const me = await L.requireUser(req);

  if (req.method === "GET" && q.get("view") === "notify") {
    const view = L.isAdmin(me) ? Object.assign(await N.adminView(), { admin: true }) : await N.status();
    return L.send(res, 200, Object.assign(view, { site: N.siteUrl(req) }));
  }

  if (req.method === "GET") {
    // jeton de carte pour les réponses plus anciennes
    const map = await L.hgetallJson(L.K.rsvps);
    for (const e of Object.values(map)) {
      if (!e.passToken) { N.ensureToken(e); await L.redis(["HSET", L.K.rsvps, e.id, JSON.stringify(e)]); }
    }
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
    await T.setAssign(id, null);
    return L.send(res, 200, { ok: true });
  }

  L.send(res, 405, { error: "Méthode non autorisée." });
});
