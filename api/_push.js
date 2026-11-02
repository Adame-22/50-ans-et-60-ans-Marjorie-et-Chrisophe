/*
 * Notifications « push » (Web Push) : clés partagées et alertes réservées à l'équipage.
 * Les invités s'abonnent aux annonces de la fête (mc:push:subs, voir /api/push) ;
 * les membres de l'équipage qui le demandent reçoivent en plus des alertes privées
 * (mc:push:crew), par exemple « Shazam repéré » pendant le blind test.
 */
const crypto = require("crypto");
const webpush = require("web-push");
const L = require("./_lib");

const K = { vapid: "mc:push:vapid", crew: "mc:push:crew" };

async function vapid() {
  let raw = await L.redis(["GET", K.vapid]);
  if (!raw) {
    await L.redis(["SETNX", K.vapid, JSON.stringify(webpush.generateVAPIDKeys())]);
    raw = await L.redis(["GET", K.vapid]);
  }
  return JSON.parse(raw);
}

const subId = (endpoint) => crypto.createHash("sha256").update(String(endpoint || "")).digest("hex").slice(0, 24);

// abonnement envoyé par le navigateur, vérifié et réduit à l'essentiel
function cleanSub(s) {
  s = s || {};
  if (!/^https:\/\//.test(s.endpoint || "") || !s.keys || !s.keys.p256dh || !s.keys.auth) return null;
  return { endpoint: L.str(s.endpoint, 600), keys: { p256dh: L.str(s.keys.p256dh, 200), auth: L.str(s.keys.auth, 100) } };
}

// Alerte privée aux téléphones de l'équipage abonnés ; les abonnements périmés sont retirés
async function notifyCrew(payload, site) {
  const subs = await L.hgetallJson(K.crew);
  const list = Object.entries(subs);
  if (!list.length) return 0;
  const keys = await vapid();
  webpush.setVapidDetails(/^https:\/\//.test(site || "") ? site : "mailto:vol-mc5060@example.org", keys.publicKey, keys.privateKey);
  const body = JSON.stringify(payload);
  let sent = 0;
  await Promise.all(list.map(async ([id, s]) => {
    try { await webpush.sendNotification(s.sub, body, { TTL: 600, timeout: 4000 }); sent++; }
    catch (e) { if (e.statusCode === 404 || e.statusCode === 410) await L.redis(["HDEL", K.crew, id]); }
  }));
  return sent;
}

module.exports = { K, vapid, subId, cleanSub, notifyCrew };
