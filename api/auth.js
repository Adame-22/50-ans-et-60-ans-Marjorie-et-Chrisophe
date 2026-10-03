/*
 * /api/auth
 *   GET                         → utilisateur connecté (ou 401)
 *   POST { action: "login", username, password }
 *   POST { action: "logout" }
 *   POST { action: "password", current, next }
 */
const L = require("./_lib");

const MAX_FAILS = 8; // tentatives par identifiant et par quart d'heure

// Réinitialisations ponctuelles demandées par un commandant : appliquées une seule fois
// (repérées par leur id), avec obligation de choisir un nouveau mot de passe ensuite.
const RESETS = [];
async function applyResets(username) {
  const r = RESETS.find((x) => x.username === username);
  if (!r) return;
  const user = await L.getUser(username);
  if (!user || user.resetId === r.id) return;
  user.hash = r.hash;
  user.mustChange = true;
  user.resetId = r.id;
  await L.saveUser(user);
  await L.redis(["DEL", L.K.fail(username)]);
}

module.exports = L.handler(async (req, res) => {
  if (req.method === "GET") {
    const user = await L.requireUser(req, { allowMustChange: true });
    return L.send(res, 200, { user: L.publicUser(user) });
  }
  if (req.method !== "POST") return L.send(res, 405, { error: "Méthode non autorisée." });

  const body = await L.readBody(req);

  if (body.action === "logout") {
    return L.send(res, 200, { ok: true }, { "Set-Cookie": L.sessionCookie(req, "", 0) });
  }

  if (body.action === "login") {
    await L.ensureSeed();
    const username = L.str(body.username, 40).toLowerCase();
    const password = String(body.password || "");
    await L.rateLimit(req, "login", 40, 900);
    await applyResets(username);
    const fails = parseInt(await L.redis(["GET", L.K.fail(username)]), 10) || 0;
    if (fails >= MAX_FAILS) throw new L.HttpError(429, "Trop de tentatives. Réessayez dans 15 minutes.");

    const user = username && (await L.getUser(username));
    if (!user || !L.verifyPassword(password, user.hash)) {
      await L.redis(["INCR", L.K.fail(username)]);
      await L.redis(["EXPIRE", L.K.fail(username), 900]);
      throw new L.HttpError(401, "Identifiant ou mot de passe incorrect.");
    }
    await L.redis(["DEL", L.K.fail(username)]);
    user.lastLogin = new Date().toISOString();
    await L.saveUser(user);
    const token = await L.signSession(user.username, user.hash.slice(0, 12));
    return L.send(res, 200, { user: L.publicUser(user) }, { "Set-Cookie": L.sessionCookie(req, token, 30 * 86400) });
  }

  if (body.action === "password") {
    const user = await L.requireUser(req, { allowMustChange: true });
    const next = String(body.next || "");
    if (!L.verifyPassword(String(body.current || ""), user.hash)) throw new L.HttpError(400, "Le mot de passe actuel est incorrect.");
    if (next.length < 8) throw new L.HttpError(400, "Le nouveau mot de passe doit faire au moins 8 caractères.");
    if (next === body.current) throw new L.HttpError(400, "Choisissez un mot de passe différent de l'actuel.");
    user.hash = L.hashPassword(next);
    user.mustChange = false;
    await L.saveUser(user);
    const token = await L.signSession(user.username, user.hash.slice(0, 12));
    return L.send(res, 200, { user: L.publicUser(user) }, { "Set-Cookie": L.sessionCookie(req, token, 30 * 86400) });
  }

  L.send(res, 400, { error: "Action inconnue." });
});
