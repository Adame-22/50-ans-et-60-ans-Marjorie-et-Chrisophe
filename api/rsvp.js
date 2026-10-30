/*
 * /api/rsvp — réponses des invités
 *   POST   (public)  { nom, presence, creneau (midi | soir | journee), passagers, accompagnants, repas, allergies, email, message }
 *   GET    (équipage) → toutes les réponses
 *   PATCH  (équipage) { id, arrived }  → pointage à l'arrivée
 *   PATCH  (équipage) { id, edit: { presence, people: [{ nom, creneau }], repas, allergies, email, telephone, message } } → corrige une réponse
 *   DELETE (équipage) ?id=…
 *   GET    ?pass=<jeton>   (public)   → carte d'embarquement d'une réponse (lien personnel)
 *   GET    ?view=notify    (équipage) → envoi automatique par e-mail configuré ?
 *   POST   { action: "dedupe" } (équipage) → fusionne les inscriptions en double déjà enregistrées
 *   Une personne qui remplit le formulaire une deuxième fois met à jour sa réponse (pas de doublon).
 *   GET    ?view=report    (en-tête Authorization: Bearer <REPORT_TOKEN>, ou ?key=<REPORT_TOKEN>) → point des réponses en lecture seule, sans coordonnées
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

/* ───────── Doublons ─────────
   Même personne = même prénom + nom (sans accents, majuscules ni tirets),
   ou même prénom avec le même e-mail ou le même portable (un couple qui partage un e-mail reste distinct). */
function normName(s) { return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]+/g, " ").trim(); }
function firstName(e) { return normName(e.prenom || String(e.nom || "").split(" ")[0]).split(" ")[0]; }
function tel9(t) { const d = String(t || "").replace(/\D/g, ""); return d.length >= 9 ? d.slice(-9) : ""; }
function samePerson(a, b) {
  const na = normName(a.nom);
  if (na && na === normName(b.nom)) return true;
  const fa = firstName(a);
  if (!fa || fa !== firstName(b)) return false;
  if (a.email && b.email && a.email.toLowerCase() === b.email.toLowerCase()) return true;
  return !!tel9(a.telephone) && tel9(a.telephone) === tel9(b.telephone);
}
// La réponse la plus récente l'emporte ; on garde l'identité de la première (lien de carte, place à table, pointage)
function mergeInto(old, neu) {
  const m = Object.assign({}, old, neu, { id: old.id, passToken: old.passToken || neu.passToken, createdAt: old.createdAt });
  for (const k of ["email", "telephone", "allergies", "arrivedAt", "emailedAt", "source"]) if (!neu[k] && old[k]) m[k] = old[k];
  // les deux mots pour Marjorie et Christophe sont gardés s'ils diffèrent
  if (old.message && neu.message && old.message !== neu.message) m.message = old.message + "\n\n" + neu.message;
  else m.message = neu.message || old.message || "";
  m.updatedAt = new Date().toISOString();
  m.updates = (old.updates || 0) + 1;
  return m;
}
// Regroupe les inscriptions d'une même personne, de la plus ancienne à la plus récente
function groupDuplicates(all) {
  const groups = [];
  all.slice().sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).forEach((e) => {
    const g = groups.find((grp) => grp.some((x) => samePerson(x, e)));
    if (g) g.push(e); else groups.push([e]);
  });
  return groups;
}
// Fusionne un groupe dans sa première inscription, supprime les autres et garde la place à table
// Ordre de fusion : l'identité vient de la plus ancienne inscription, les valeurs de la plus récemment
// touchée (correction de l'équipage, réinscription…), pour qu'une correction ne soit jamais écrasée.
const touched = (e) => String(e.editedAt || e.updatedAt || e.createdAt || "");
async function mergeGroup(group, extra) {
  const first = group[0];
  const rest = group.slice(1).concat(extra ? [extra] : []);
  const ordered = [first].concat(rest).sort((a, b) => touched(a).localeCompare(touched(b)));
  const base = Object.assign({}, ordered[0], { id: first.id, passToken: first.passToken, createdAt: first.createdAt });
  const kept = ordered.slice(1).reduce(mergeInto, base);
  kept.id = first.id; kept.passToken = first.passToken || kept.passToken; kept.createdAt = first.createdAt;
  const assign = group.length > 1 ? await T.getAssignFull() : {};
  for (const d of group.slice(1)) {
    if (!assign[kept.id] && assign[d.id]) { await T.setAssign(kept.id, assign[d.id].t, "fusion"); assign[kept.id] = assign[d.id]; }
    await T.setAssign(d.id, null);
    await L.redis(["HDEL", L.K.rsvps, d.id]);
  }
  await L.redis(["HSET", L.K.rsvps, kept.id, JSON.stringify(kept)]);
  return kept;
}

// Ce que les invités écrivent pour Marjorie et Christophe reste une surprise pour eux
function hideSurprise(e) { const c = Object.assign({}, e); delete c.message; return c; }

// Point des réponses en lecture seule, sans coordonnées (ni e-mail, ni téléphone, ni photo, ni lien de carte)
function report(all) {
  const t = { reponses: all.length, oui: 0, non: 0, passagers: 0, midi: 0, soir: 0, journee: 0, repas: {} };
  const list = all.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).map(function (e) {
    const yes = e.presence === "oui";
    if (yes) {
      t.oui++; t.passagers += e.passagers || 1;
      const fares = [e.creneau || "journee"].concat(e.creneauxAcc || []);
      for (let i = 0; i < (e.passagers || 1); i++) { const f = fares[i] || fares[0]; if (t[f] !== undefined) t[f]++; }
      if (e.repas) t.repas[e.repas] = (t.repas[e.repas] || 0) + 1;
    } else t.non++;
    return { nom: e.nom, presence: e.presence, passagers: yes ? e.passagers || 1 : 0, creneau: e.creneau || null, creneauxAcc: e.creneauxAcc || [],
      accompagnants: e.accompagnants || [], repas: e.repas || null, allergies: e.allergies || "", carteEnvoyee: !!e.emailedAt, le: e.createdAt };
  });
  // déjeuner = midi + journée, dîner = soir + journée
  return { totaux: Object.assign(t, { auDejeuner: t.midi + t.journee, auDiner: t.soir + t.journee }), reponses: list, genereLe: new Date().toISOString() };
}

const K_LISTE = "mc:liste";
const K_CHAT = "mc:chat"; // discussion de l'équipe dans l'admin (les fêtés la voient aussi)

module.exports = L.handler(async (req, res) => {
  const q = L.query(req);
  // Lecture seule avec la clé REPORT_TOKEN (variable d'environnement Vercel), demandée par l'organisateur
  if (req.method === "GET" && q.get("view") === "report") {
    await L.rateLimit(req, "report", 60, 600);
    const key = process.env.REPORT_TOKEN || "";
    const given = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "") || String(q.get("key") || "");
    const ok = key.length >= 24 && given.length === key.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(key));
    if (!ok) throw new L.HttpError(401, "Clé de lecture absente ou invalide.");
    return L.send(res, 200, report(Object.values(await L.hgetallJson(L.K.rsvps))));
  }
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
    if (b.action === "dedupe") {
      await L.requireUser(req);
      let merged = 0;
      for (const g of groupDuplicates(Object.values(await L.hgetallJson(L.K.rsvps)))) {
        if (g.length > 1) { await mergeGroup(g); merged += g.length - 1; }
      }
      return L.send(res, 200, { ok: true, merged });
    }
    // Discussion de l'équipe : écrire, ou effacer son propre message (le super admin peut tout effacer)
    if (b.action === "chat-post" || b.action === "chat-del") {
      const me = await L.requireUser(req);
      const raw = await L.redis(["GET", K_CHAT]);
      let msgs = raw ? JSON.parse(raw) : [];
      if (b.action === "chat-post") {
        await L.rateLimit(req, "chat", 30, 60);
        const text = L.str(b.text, 1000);
        if (!text) throw new L.HttpError(400, "Écrivez un message.");
        msgs.push({ id: crypto.randomBytes(6).toString("hex"), user: me.username, by: me.name || me.username, text, at: new Date().toISOString() });
        msgs = msgs.slice(-500);
      } else {
        const m = msgs.find((x) => x.id === L.str(b.id, 20));
        if (!m) throw new L.HttpError(404, "Message introuvable.");
        if (m.user !== me.username && me.role !== "superadmin") throw new L.HttpError(403, "Vous ne pouvez effacer que vos messages.");
        msgs = msgs.filter((x) => x !== m);
      }
      await L.redis(["SET", K_CHAT, JSON.stringify(msgs)]);
      return L.send(res, 200, { messages: msgs, me: me.username });
    }
    // Liste prévue (fichier Excel des familles invitées), croisée avec les inscriptions dans l'admin
    if (b.action === "liste-save") {
      const me = await L.requireUser(req);
      const n = (v) => Math.max(0, Math.min(99, parseInt(v, 10) || 0));
      const opt = (v) => (v === null || v === undefined || v === "" ? null : n(v));
      const rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 300).map((r, i) => ({
        id: L.str(r.id, 16) || "l" + i,
        famille: L.str(r.famille, 80),
        alias: L.str(r.alias, 120),
        enfants: n(r.enfants), adultes: n(r.adultes),
        midi: opt(r.midi), soir: opt(r.soir),
        envoi: !!r.envoi,
        links: Array.isArray(r.links) ? r.links.slice(0, 20).map((x) => L.str(x, 64)).filter(Boolean) : null,
      })).filter((r) => r.famille);
      const liste = { rows, file: L.str(b.file, 120), updatedAt: new Date().toISOString(), by: me.name };
      await L.redis(["SET", K_LISTE, JSON.stringify(liste)]);
      return L.send(res, 200, liste);
    }
    // Rappel J-5 : récapitulatif complet à ceux qui viennent (ids donnés, sinon tous ceux qui ne l'ont pas reçu)
    if (b.action === "remind") {
      await L.requireUser(req);
      const cfg = await N.getConfig();
      if (!(await N.status()).email) throw new L.HttpError(400, "L'envoi automatique n'est pas encore réglé.");
      if (b.test) {
        const to = L.str(b.test, 120);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new L.HttpError(400, "Adresse de test incorrecte.");
        const demo = { nom: "Passager test", prenom: "Passager test", presence: "oui", passagers: 2, creneau: "journee", creneauxAcc: ["soir"], accompagnants: ["Accompagnant test"], email: to };
        try { await N.sendReminder(req, demo, cfg, N.siteUrl(req) + "/billet?p=demo"); } catch (e) { throw new L.HttpError(502, e.message); }
        return L.send(res, 200, { ok: true, test: true });
      }
      const all = Object.values(await L.hgetallJson(L.K.rsvps));
      const want = Array.isArray(b.ids) ? b.ids.map((x) => L.str(x, 64)) : null;
      const list = all.filter((e) => e.presence === "oui" && e.email && (want ? want.includes(e.id) : !e.remindedAt)).slice(0, 300);
      const out = { sent: 0, errors: [] };
      for (const e of list) {
        try {
          N.ensureToken(e);
          await N.sendReminder(req, e, cfg);
          e.remindedAt = new Date().toISOString();
          await L.redis(["HSET", L.K.rsvps, e.id, JSON.stringify(e)]);
          out.sent++;
        } catch (err) { out.errors.push(e.nom + " : " + err.message); }
      }
      return L.send(res, 200, out);
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
    // déjà inscrit·e ? on met à jour sa réponse plutôt que d'en créer une deuxième
    const same = groupDuplicates(Object.values(await L.hgetallJson(L.K.rsvps)).filter((e) => samePerson(e, entry)))
      .reduce((acc, g) => acc.concat(g), [])
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    const updated = same.length > 0;
    let saved = entry;
    if (updated) saved = await mergeGroup(same, entry);
    else await L.redis(["HSET", L.K.rsvps, entry.id, JSON.stringify(entry)]);
    Object.assign(entry, saved);
    // carte d'embarquement envoyée tout de suite par e-mail, si l'envoi est configuré
    let emailed = false;
    if (entry.email && (await N.status()).email) {
      try { await N.sendEmail(req, entry); entry.emailedAt = new Date().toISOString(); emailed = true; await L.redis(["HSET", L.K.rsvps, entry.id, JSON.stringify(entry)]); }
      catch (e) { console.error("e-mail non envoyé", e.message); }
    }
    return L.send(res, updated ? 200 : 201, { ok: true, id: entry.id, pass: entry.passToken, emailed, updated });
  }

  const me = await L.requireUser(req);

  if (req.method === "GET" && q.get("view") === "chat") {
    const raw = await L.redis(["GET", K_CHAT]);
    return L.send(res, 200, { messages: raw ? JSON.parse(raw) : [], me: me.username });
  }

  if (req.method === "GET" && q.get("view") === "liste") {
    const raw = await L.redis(["GET", K_LISTE]);
    return L.send(res, 200, raw ? JSON.parse(raw) : { rows: [] });
  }

  if (req.method === "GET" && q.get("view") === "reminder-preview") {
    const demo = { nom: "Jeanne Martin", prenom: "Jeanne", presence: "oui", passagers: 3, creneau: "journee", creneauxAcc: ["soir", "midi"], accompagnants: ["Paul Martin", "Léo Martin"], repas: "Végétarien" };
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(N.reminderHtml(demo, N.siteUrl(req) + "/billet?p=demo"));
  }

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
    let rsvps = Object.values(await L.hgetallJson(L.K.rsvps)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (L.isHost(me)) rsvps = rsvps.map(hideSurprise); // pas les mots laissés aux fêtés
    const doublons = groupDuplicates(rsvps).reduce((n, g) => n + g.length - 1, 0);
    return L.send(res, 200, { rsvps, surprisesHidden: L.isHost(me), doublons });
  }

  if (req.method === "PATCH") {
    const b = await L.readBody(req);
    const raw = await L.redis(["HGET", L.K.rsvps, L.str(b.id, 64)]);
    if (!raw) throw new L.HttpError(404, "Réponse introuvable.");
    const entry = JSON.parse(raw);
    if (b.edit && typeof b.edit === "object") {
      // correction complète depuis l'admin : statut, chaque passager et son billet, repas, contact, message
      const x = b.edit, FARES = ["midi", "soir", "journee"];
      const people = (Array.isArray(x.people) ? x.people : []).slice(0, 12)
        .map((p) => ({ nom: L.str(p && p.nom, 80), creneau: FARES.includes(p && p.creneau) ? p.creneau : "journee" }));
      const nom = (people[0] && people[0].nom) || L.str(x.nom, 80);
      if (!nom) throw new L.HttpError(400, "Indiquez le nom du passager principal.");
      if (nom !== entry.nom) { entry.nom = nom; entry.prenom = nom.split(" ")[0]; entry.nomFamille = nom.split(" ").slice(1).join(" "); }
      const oui = x.presence === "oui";
      entry.presence = oui ? "oui" : "non";
      if (oui) {
        const list = people.length ? people : [{ nom, creneau: entry.creneau || "journee" }];
        entry.passagers = list.length;
        entry.creneau = list[0].creneau;
        entry.accompagnants = list.slice(1).map((p, i) => p.nom || "Passager " + (i + 2));
        entry.creneauxAcc = list.slice(1).map((p) => p.creneau);
        if (REPAS.includes(x.repas)) entry.repas = x.repas;
        if (x.allergies !== undefined) entry.allergies = L.str(x.allergies, 300);
      } else {
        entry.passagers = 0;
      }
      if (x.email !== undefined) {
        const email = L.str(x.email, 120);
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new L.HttpError(400, "L'adresse e-mail semble incorrecte.");
        if (email !== entry.email) delete entry.emailedAt; // nouvelle adresse : la carte pourra être renvoyée
        entry.email = email;
      }
      if (x.telephone !== undefined) entry.telephone = L.str(x.telephone, 20).replace(/[^\d+ .()-]/g, "");
      // les fêtés ne voient pas les messages : ils ne peuvent pas non plus les modifier
      if (x.message !== undefined && !L.isHost(me)) entry.message = L.str(x.message, 1500);
      entry.editedAt = new Date().toISOString();
      entry.editedBy = me.name || me.username;
    } else {
      entry.arrivedAt = b.arrived ? new Date().toISOString() : null;
    }
    await L.redis(["HSET", L.K.rsvps, entry.id, JSON.stringify(entry)]);
    return L.send(res, 200, { rsvp: L.isHost(me) ? hideSurprise(entry) : entry });
  }

  if (req.method === "DELETE") {
    const id = L.str(L.query(req).get("id"), 64);
    await L.redis(["HDEL", L.K.rsvps, id]);
    await T.setAssign(id, null);
    return L.send(res, 200, { ok: true });
  }

  L.send(res, 405, { error: "Méthode non autorisée." });
});
