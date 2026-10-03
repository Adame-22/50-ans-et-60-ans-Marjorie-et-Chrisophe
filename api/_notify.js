/*
 * Envoi des cartes d'embarquement par e-mail, via Brevo (brevo.com, gratuit jusqu'à 300 e-mails par jour).
 * Réglages (variables d'environnement Vercel) :
 *   BREVO_API_KEY      clé API Brevo
 *   MAIL_FROM          adresse d'expéditeur validée dans Brevo (ex. vol.mc5060@gmail.com)
 *   MAIL_FROM_NAME     nom affiché (défaut : « Vol MC 5060 »)
 *   SITE_URL           adresse du site (défaut : celle de la requête)
 * Sans clé, rien n'est envoyé : l'admin propose alors l'envoi manuel (e-mail depuis le téléphone).
 */
const crypto = require("crypto");

const KEY = () => process.env.BREVO_API_KEY || "";
const FARE = { midi: "Business · le déjeuner", soir: "Premium · la soirée", journee: "Première · midi et soir" };

function status() {
  return { email: !!(KEY() && process.env.MAIL_FROM), provider: "Brevo" };
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

async function brevo(path, body) {
  const r = await fetch("https://api.brevo.com/v3" + path, {
    method: "POST",
    headers: { "api-key": KEY(), "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error("Brevo " + r.status + " " + t.slice(0, 160));
  }
  return r.json().catch(() => ({}));
}

async function sendEmail(req, entry) {
  if (!status().email) throw new Error("Envoi d'e-mails non configuré.");
  if (!entry.email) throw new Error("Pas d'e-mail.");
  const url = passUrl(req, entry);
  await brevo("/smtp/email", {
    sender: { email: process.env.MAIL_FROM, name: process.env.MAIL_FROM_NAME || "Vol MC 5060" },
    to: [{ email: entry.email, name: entry.nom }],
    subject: entry.presence === "oui" ? "✈ Votre carte d'embarquement · Vol MC 5060" : "Merci pour votre réponse · Vol MC 5060",
    htmlContent: emailHtml(entry, url),
  });
}

module.exports = { status, siteUrl, passUrl, ensureToken, phoneE164, sendEmail, FARE };
