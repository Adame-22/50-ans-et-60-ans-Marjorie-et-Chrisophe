/*
 * /api/push — annonces de la fête, gratuites, sans service payant
 *
 * 1. Notifications « push » (Web Push) sur les téléphones qui les ont acceptées :
 *    Android (Chrome, Firefox…) et ordinateurs ; iPhone seulement si le site est
 *    ajouté à l'écran d'accueil (iOS 16.4 et plus).
 *    GET  ?view=key                         → clé publique (créée et gardée dans la base au premier appel)
 *    POST { action: "subscribe", subscription }   → enregistre un téléphone
 *    POST { action: "unsubscribe", endpoint }
 *    GET  ?view=admin            (équipage) → nombre d'abonnés, dernières annonces
 *    POST { action: "send", title, body, url } (équipage) → envoie l'annonce à tous
 *
 * 2. Calendrier auquel on s'abonne (webcal) : /agenda.ics → GET ?view=ics
 *    L'agenda du téléphone le relit régulièrement : rappels la veille et 2 h avant,
 *    et la dernière annonce apparaît dans la description de l'événement.
 */
const crypto = require("crypto");
const webpush = require("web-push");
const L = require("./_lib");

const K = { vapid: "mc:push:vapid", subs: "mc:push:subs", log: "mc:push:log" };

async function vapid() {
  let raw = await L.redis(["GET", K.vapid]);
  if (!raw) {
    await L.redis(["SETNX", K.vapid, JSON.stringify(webpush.generateVAPIDKeys())]);
    raw = await L.redis(["GET", K.vapid]);
  }
  return JSON.parse(raw);
}

function site(req) {
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
  const proto = req.headers["x-forwarded-proto"] || (/localhost|127\./.test(host) ? "http" : "https");
  return proto + "://" + host;
}

async function announcements() {
  const raw = await L.redis(["GET", K.log]);
  return raw ? JSON.parse(raw) : [];
}

function icsText(s) { return String(s || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1"); }
function fold(line) { // lignes de 75 octets max (RFC 5545)
  const out = []; let cur = "";
  for (const ch of line) { if (Buffer.byteLength(cur + ch) > 73) { out.push(cur); cur = " " + ch; } else cur += ch; }
  return out.concat(cur).join("\r\n");
}

async function ics(req) {
  const base = site(req);
  const last = (await announcements())[0];
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const desc = "Embarquement à 12h30. Dress code : élégant, tenue de cocktail." +
    (last ? "\n\nDernière annonce (" + new Date(last.at).toLocaleDateString("fr-FR") + ") : " + last.title + " — " + last.body : "") +
    "\n\nToutes les infos : " + base + "/";
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Vol MC 5060//FR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:Vol MC 5060", "X-PUBLISHED-TTL:PT6H", "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
    "BEGIN:VEVENT", "UID:vol-mc5060-20261107@marjorie-christophe", "DTSTAMP:" + stamp,
    "LAST-MODIFIED:" + (last ? new Date(last.at).toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "") : "20261003T120000Z"),
    "SEQUENCE:" + (last ? last.seq : 0),
    "DTSTART:20261107T113000Z", "DTEND:20261107T225900Z",
    fold("SUMMARY:" + icsText("Vol MC 5060 · 50 ans de Marjorie & 60 ans de Christophe")),
    fold("LOCATION:" + icsText("Salle des fêtes de Champrosay, 1 allée des Alouettes, 91270 Draveil")),
    fold("DESCRIPTION:" + icsText(desc)),
    "URL:" + base + "/",
    "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Demain : Vol MC 5060 ✈", "TRIGGER:-P1D", "END:VALARM",
    "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Embarquement dans 2 heures ✈", "TRIGGER:-PT2H", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR", "",
  ].join("\r\n");
}

module.exports = L.handler(async (req, res) => {
  const view = L.query(req).get("view");

  if (req.method === "GET" && view === "ics") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", 'inline; filename="vol-mc5060.ics"');
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=300");
    return res.end(await ics(req));
  }
  if (req.method === "GET" && view === "key") {
    return L.send(res, 200, { publicKey: (await vapid()).publicKey });
  }
  if (req.method === "GET" && view === "admin") {
    await L.requireUser(req);
    const n = await L.redis(["HLEN", K.subs]);
    return L.send(res, 200, { subscribers: n, announcements: (await announcements()).slice(0, 10) });
  }

  if (req.method !== "POST") return L.send(res, 405, { error: "Méthode non autorisée." });
  const b = await L.readBody(req);

  if (b.action === "subscribe") {
    await L.rateLimit(req, "push-sub", 200, 600);
    const s = b.subscription || {};
    if (!/^https:\/\//.test(s.endpoint || "") || !s.keys || !s.keys.p256dh || !s.keys.auth) throw new L.HttpError(400, "Abonnement invalide.");
    const sub = { endpoint: L.str(s.endpoint, 600), keys: { p256dh: L.str(s.keys.p256dh, 200), auth: L.str(s.keys.auth, 100) }, at: new Date().toISOString() };
    const id = crypto.createHash("sha256").update(sub.endpoint).digest("hex").slice(0, 24);
    await L.redis(["HSET", K.subs, id, JSON.stringify(sub)]);
    return L.send(res, 200, { ok: true });
  }
  if (b.action === "unsubscribe") {
    const id = crypto.createHash("sha256").update(String(b.endpoint || "")).digest("hex").slice(0, 24);
    await L.redis(["HDEL", K.subs, id]);
    return L.send(res, 200, { ok: true });
  }

  if (b.action === "send") {
    const me = await L.requireUser(req);
    const title = L.str(b.title, 60) || "Vol MC 5060";
    const body = L.str(b.body, 240);
    if (!body) throw new L.HttpError(400, "Écrivez le message de l'annonce.");
    const url = /^\/[^\s]*$/.test(b.url || "") ? b.url : "/";
    const keys = await vapid();
    webpush.setVapidDetails(site(req).startsWith("https") ? site(req) : "mailto:vol-mc5060@example.org", keys.publicKey, keys.privateKey);
    const subs = await L.hgetallJson(K.subs);
    const payload = JSON.stringify({ title, body, url });
    let sent = 0, gone = 0, failed = 0;
    await Promise.all(Object.entries(subs).map(async ([id, sub]) => {
      try { await webpush.sendNotification(sub, payload, { TTL: 6 * 3600 }); sent++; }
      catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) { gone++; await L.redis(["HDEL", K.subs, id]); }
        else failed++;
      }
    }));
    const log = await announcements();
    log.unshift({ title, body, url, at: new Date().toISOString(), by: me.name, sent, seq: (log[0] ? log[0].seq || 0 : 0) + 1 });
    await L.redis(["SET", K.log, JSON.stringify(log.slice(0, 30))]);
    return L.send(res, 200, { sent, gone, failed });
  }

  L.send(res, 400, { error: "Action inconnue." });
});
