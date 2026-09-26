/*
 * /api/accounts — gestion des comptes (administrateurs uniquement)
 *   GET                                           → liste des comptes
 *   POST   { username, name, role }               → crée un compte, renvoie un code provisoire
 *   PATCH  { username, name?, role?, resetPassword? } → modifie / réinitialise (renvoie un code)
 *   DELETE ?username=…                            → supprime
 */
const L = require("./_lib");

const ROLES = ["admin", "equipage"];

async function allUsers() {
  return Object.values(await L.hgetallJson(L.K.users));
}

async function assertAnotherAdmin(exceptUsername) {
  const admins = (await allUsers()).filter((u) => u.role === "admin" && u.username !== exceptUsername);
  if (!admins.length) throw new L.HttpError(400, "Il doit rester au moins un administrateur.");
}

module.exports = L.handler(async (req, res) => {
  const me = await L.requireUser(req, { admin: true });

  if (req.method === "GET") {
    const users = (await allUsers()).map(L.publicUser).sort((a, b) => a.name.localeCompare(b.name, "fr"));
    return L.send(res, 200, { users });
  }

  if (req.method === "DELETE") {
    const username = L.str(L.query(req).get("username"), 40).toLowerCase();
    if (username === me.username) throw new L.HttpError(400, "Vous ne pouvez pas supprimer votre propre compte.");
    const user = await L.getUser(username);
    if (!user) throw new L.HttpError(404, "Compte introuvable.");
    if (user.role === "admin") await assertAnotherAdmin(username);
    await L.redis(["HDEL", L.K.users, username]);
    return L.send(res, 200, { ok: true });
  }

  const body = await L.readBody(req);

  if (req.method === "POST") {
    const name = L.str(body.name, 60);
    const username = L.str(body.username || name, 40)
      .toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9._-]/g, "");
    const role = ROLES.includes(body.role) ? body.role : "equipage";
    if (!name) throw new L.HttpError(400, "Indiquez un prénom ou un nom.");
    if (username.length < 2) throw new L.HttpError(400, "Identifiant invalide (lettres et chiffres, 2 caractères minimum).");
    const code = L.tempCode();
    const created = await L.redis(["HSETNX", L.K.users, username, JSON.stringify({
      username, name, role, hash: L.hashPassword(code), mustChange: true, createdAt: new Date().toISOString(), createdBy: me.username,
    })]);
    if (!created) throw new L.HttpError(409, "L'identifiant « " + username + " » existe déjà.");
    return L.send(res, 201, { user: L.publicUser(await L.getUser(username)), code });
  }

  if (req.method === "PATCH") {
    const user = await L.getUser(L.str(body.username, 40).toLowerCase());
    if (!user) throw new L.HttpError(404, "Compte introuvable.");
    if (body.name !== undefined) {
      const name = L.str(body.name, 60);
      if (name) user.name = name;
    }
    if (body.role !== undefined && ROLES.includes(body.role) && body.role !== user.role) {
      if (user.role === "admin") await assertAnotherAdmin(user.username);
      user.role = body.role;
    }
    let code;
    if (body.resetPassword) {
      if (user.username === me.username) throw new L.HttpError(400, "Changez votre propre mot de passe depuis « Mon compte ».");
      code = L.tempCode();
      user.hash = L.hashPassword(code);
      user.mustChange = true;
    }
    await L.saveUser(user);
    return L.send(res, 200, { user: L.publicUser(user), code });
  }

  L.send(res, 405, { error: "Méthode non autorisée." });
});
