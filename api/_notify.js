/*
 * Envoi des cartes d'embarquement par e-mail, avec un service gratuit au choix :
 *   - Brevo (brevo.com) : 300 e-mails par jour ; expéditeur validé dans Brevo
 *   - AgentMail (agentmail.to) : boîte d'envoi du type vol-mc5060@agentmail.to
 * Réglage le plus simple : dans l'admin (Manifeste → Cartes d'embarquement → Réglages),
 * coller la clé API ; elle est gardée dans la base et n'est jamais renvoyée au navigateur.
 * À défaut, variables d'environnement Vercel : BREVO_API_KEY + MAIL_FROM (+ MAIL_FROM_NAME),
 * ou AGENTMAIL_API_KEY + AGENTMAIL_INBOX. SITE_URL : adresse du site (défaut : celle de la requête).
 * Sans réglage, rien n'est envoyé : l'admin propose alors l'envoi manuel (e-mail depuis le téléphone).
 */
const crypto = require("crypto");

const L = require("./_lib");

const K_MAIL = "mc:mail";        // réglages saisis dans l'admin
const K_MAIL_LOG = "mc:mail:log"; // derniers envois (succès / erreurs), pour l'admin
const PROVIDERS = ["brevo", "agentmail"];
const FARE = { midi: "Business · le déjeuner", soir: "Premium · la soirée", journee: "Première · midi et soir" };

/* Réglages effectifs : ceux de l'admin d'abord, sinon les variables Vercel */
async function getConfig() {
  const raw = await L.redis(["GET", K_MAIL]).catch(() => null);
  const db = raw ? JSON.parse(raw) : null;
  if (db && db.key) return Object.assign({ source: "admin" }, db);
  const env = process.env;
  if (env.BREVO_API_KEY) return { source: "vercel", provider: "brevo", key: env.BREVO_API_KEY, from: env.MAIL_FROM || "", fromName: env.MAIL_FROM_NAME || "" };
  if (env.AGENTMAIL_API_KEY) return { source: "vercel", provider: "agentmail", key: env.AGENTMAIL_API_KEY, from: env.AGENTMAIL_INBOX || env.MAIL_FROM || "", fromName: env.MAIL_FROM_NAME || "" };
  return { source: "", provider: (db && db.provider) || "brevo", key: "", from: (db && db.from) || "", fromName: (db && db.fromName) || "" };
}
const ready = (c) => !!(c && c.key && c.from && PROVIDERS.includes(c.provider));

async function status() {
  const c = await getConfig();
  return { email: ready(c), provider: c.provider === "agentmail" ? "AgentMail" : "Brevo" };
}

/* Vue admin : jamais la clé, seulement ses 4 derniers caractères */
async function adminView() {
  const c = await getConfig();
  const rawLog = await L.redis(["GET", K_MAIL_LOG]).catch(() => null);
  const log = rawLog ? JSON.parse(rawLog) : [];
  return {
    email: ready(c), source: c.source, provider: c.provider, from: c.from, fromName: c.fromName,
    keyEnd: c.key ? c.key.slice(-4) : "", log: log.slice(0, 8),
  };
}

async function saveConfig(b, by) {
  const raw = await L.redis(["GET", K_MAIL]);
  const old = raw ? JSON.parse(raw) : {};
  const provider = PROVIDERS.includes(b.provider) ? b.provider : "brevo";
  const key = String(b.key || "").trim();
  const cfg = {
    provider,
    // clé vide = garder l'ancienne (si on ne change pas de service)
    key: key || (old.provider === provider ? old.key || "" : ""),
    from: String(b.from || "").trim().slice(0, 120),
    fromName: String(b.fromName || "").trim().slice(0, 60),
    updatedAt: new Date().toISOString(), by,
  };
  if (cfg.from && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cfg.from)) throw new L.HttpError(400, "L'adresse d'expéditeur semble incorrecte.");
  if (!cfg.key) throw new L.HttpError(400, "Collez la clé API du service choisi.");
  if (!cfg.from) throw new L.HttpError(400, provider === "agentmail" ? "Indiquez la boîte AgentMail (ex. vol-mc5060@agentmail.to)." : "Indiquez l'adresse d'expéditeur validée dans Brevo.");
  await L.redis(["SET", K_MAIL, JSON.stringify(cfg)]);
}

async function clearConfig() { await L.redis(["DEL", K_MAIL]); }

async function logSend(ok, to, detail) {
  try {
    const raw = await L.redis(["GET", K_MAIL_LOG]);
    const log = raw ? JSON.parse(raw) : [];
    log.unshift({ ok, to: String(to || "").replace(/^(.).*(@.*)$/, "$1…$2"), detail: String(detail || "").slice(0, 200), at: new Date().toISOString() });
    await L.redis(["SET", K_MAIL_LOG, JSON.stringify(log.slice(0, 20))]);
  } catch (e) { /* le journal ne doit jamais bloquer un envoi */ }
}

function siteUrl(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, "");
  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  const proto = req.headers["x-forwarded-proto"] || (/localhost|127\./.test(host) ? "http" : "https");
  return proto + "://" + host;
}

function ensureToken(entry) {
  if (!entry.passToken) entry.passToken = crypto.randomBytes(12).toString("base64url");
  return entry.passToken;
}

function passUrl(req, entry) { return siteUrl(req) + "/billet?p=" + ensureToken(entry); }

// 06 12 34 56 78 → 33612345678 ; +44 7… → 447…
function phoneE164(v) {
  let d = String(v || "").replace(/[^\d+]/g, "");
  if (d.startsWith("+")) return d.slice(1);
  if (d.startsWith("00")) return d.slice(2);
  if (/^0\d{9}$/.test(d)) return "33" + d.slice(1);
  return d.length >= 10 ? d : "";
}

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function emailHtml(entry, url) {
  const first = esc(entry.prenom || String(entry.nom || "").split(" ")[0]);
  const yes = entry.presence === "oui";
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#f7f1ed;font-family:Helvetica,Arial,sans-serif;color:#000033">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f1ed;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fffbfe;border-radius:18px;overflow:hidden;border:1px solid #e8e1dc">
<tr><td style="background:#000033;padding:28px 28px 22px;text-align:center">
<div style="font-family:Courier,monospace;letter-spacing:4px;font-size:12px;color:#ffb100">VOL MC 5060 · EMBARQUEMENT</div>
<div style="font-family:Georgia,serif;font-size:30px;color:#fffbfe;margin-top:10px">Marjorie &amp; Christophe</div>
<div style="font-family:Courier,monospace;font-size:13px;color:#a67046;margin-top:6px">50 ans · 60 ans</div></td></tr>
<tr><td style="padding:28px">
<p style="font-size:18px;margin:0 0 12px">Bonjour ${first},</p>
<p style="font-size:16px;line-height:1.55;margin:0 0 18px">${yes ? "Votre enregistrement est confirmé. Voici votre <b>carte d'embarquement numérique</b> : gardez-la sur votre téléphone, elle vous sera utile le jour de la fête." : "Merci pour votre réponse : vous nous manquerez à bord !"}</p>
${yes ? `<table role="presentation" width="100%" style="border:1px dashed #a67046;border-radius:12px;margin:0 0 22px"><tr><td style="padding:16px 18px;font-size:15px;line-height:1.7">
<b>Samedi 7 novembre 2026</b> · embarquement 12h30<br>Salle des fêtes de Champrosay, 1 allée des Alouettes, 91270 Draveil<br>
${entry.passagers > 1 ? entry.passagers + " passagers · " : ""}Billet : ${esc(FARE[entry.creneau] || FARE.journee)}</td></tr></table>
<p style="text-align:center;margin:0 0 8px"><a href="${url}" style="display:inline-block;background:#a67046;color:#000033;text-decoration:none;font-weight:bold;font-size:17px;padding:16px 28px;border-radius:999px">Voir ma carte d'embarquement</a></p>` : ""}
<p style="font-size:13px;color:#7a7d7d;margin:22px 0 0;text-align:center">Vol MC 5060 · Marjorie &amp; Christophe</p>
</td></tr></table></td></tr></table></body></html>`;
}

/* Explications lisibles pour les erreurs les plus courantes */
function explain(provider, status, text) {
  const t = String(text || "");
  if (provider === "brevo") {
    if (/unrecognised IP|unrecognized IP|authorised_ips|authorized IP/i.test(t)) return "Brevo bloque l'adresse IP du site : dans Brevo, Sécurité → Adresses IP autorisées, désactivez le blocage.";
    if (status === 401) return "Clé Brevo refusée : vérifiez qu'il s'agit bien d'une clé API (xkeysib-…), pas d'une clé SMTP.";
    if (/sender/i.test(t)) return "Expéditeur refusé par Brevo : l'adresse doit être validée dans Brevo (Expéditeurs).";
    if (/not.*activated|account.*(suspend|block|review)|phone/i.test(t)) return "Compte Brevo pas encore activé : terminez la vérification (téléphone) dans Brevo.";
  } else {
    if (status === 401 || status === 403) return "Clé AgentMail refusée : vérifiez la clé API dans la console AgentMail.";
    if (status === 404) return "Boîte AgentMail introuvable : vérifiez l'adresse (ex. vol-mc5060@agentmail.to).";
  }
  return (provider === "brevo" ? "Brevo" : "AgentMail") + " " + status + " " + t.slice(0, 160);
}

async function post(url, headers, body, provider) {
  let r;
  try {
    r = await fetch(url, { method: "POST", headers: Object.assign({ "Content-Type": "application/json", accept: "application/json" }, headers), body: JSON.stringify(body) });
  } catch (e) { throw new Error("Service d'envoi injoignable : " + e.message); }
  if (!r.ok) throw new Error(explain(provider, r.status, await r.text().catch(() => "")));
  return r.json().catch(() => ({}));
}

async function deliver(c, msg) {
  const name = c.fromName || "Vol MC 5060";
  if (c.provider === "agentmail") {
    return post("https://api.agentmail.to/v0/inboxes/" + encodeURIComponent(c.from) + "/messages/send",
      { Authorization: "Bearer " + c.key },
      { to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text }, "agentmail");
  }
  return post("https://api.brevo.com/v3/smtp/email", { "api-key": c.key }, {
    sender: { email: c.from, name },
    to: [{ email: msg.to, name: msg.toName || undefined }],
    subject: msg.subject, htmlContent: msg.html, textContent: msg.text,
  }, "brevo");
}

function emailText(entry, url) {
  const first = entry.prenom || String(entry.nom || "").split(" ")[0];
  if (entry.presence !== "oui") return "Bonjour " + first + ",\n\nMerci pour votre réponse : vous nous manquerez à bord !\n\nVol MC 5060 · Marjorie & Christophe";
  return "Bonjour " + first + ",\n\nVotre enregistrement est confirmé. Voici votre carte d'embarquement numérique : gardez-la sur votre téléphone.\n\n" +
    "Samedi 7 novembre 2026 · embarquement 12h30\nSalle des fêtes de Champrosay, 1 allée des Alouettes, 91270 Draveil\n" +
    "Billet : " + (FARE[entry.creneau] || FARE.journee) + "\n\nVotre carte : " + url + "\n\nVol MC 5060 · Marjorie & Christophe";
}

async function sendEmail(req, entry, cfg, linkUrl) {
  const c = cfg || (await getConfig());
  if (!ready(c)) throw new Error("Envoi d'e-mails non configuré.");
  if (!entry.email) throw new Error("Pas d'e-mail.");
  const url = linkUrl || passUrl(req, entry);
  try {
    await deliver(c, {
      to: entry.email, toName: entry.nom,
      subject: entry.presence === "oui" ? "✈ Votre carte d'embarquement · Vol MC 5060" : "Merci pour votre réponse · Vol MC 5060",
      html: emailHtml(entry, url), text: emailText(entry, url),
    });
  } catch (e) { await logSend(false, entry.email, e.message); throw e; }
  await logSend(true, entry.email, entry.nom);
}

/* E-mail d'essai, envoyé depuis l'admin */
async function sendTest(req, to) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to || "")) throw new L.HttpError(400, "Adresse de test incorrecte.");
  const c = await getConfig();
  if (!ready(c)) throw new L.HttpError(400, "Enregistrez d'abord les réglages d'envoi.");
  const demo = { nom: "Passager test", prenom: "Passager test", presence: "oui", passagers: 1, creneau: "journee", email: to };
  try { await sendEmail(req, demo, c, siteUrl(req) + "/billet?p=demo"); }
  catch (e) { throw new L.HttpError(502, e.message); }
}

module.exports = { status, adminView, saveConfig, clearConfig, getConfig, siteUrl, passUrl, ensureToken, phoneE164, sendEmail, sendTest, emailHtml, FARE };
