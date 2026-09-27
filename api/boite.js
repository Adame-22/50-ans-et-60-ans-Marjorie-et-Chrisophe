/*
 * /api/boite — la « Boîte noire » : messages et photos des invités
 *   GET                 (public)   → messages, du plus récent au plus ancien (cache 3 s)
 *   GET ?photo=<id>     (public)   → l'image (mise en cache longue durée)
 *   POST { name, message, photo }  → photo = data URL JPEG/PNG/WebP déjà réduite côté téléphone
 *   DELETE ?id=<id>     (équipage) → supprime un message et sa photo
 */
const crypto = require("crypto");
const L = require("./_lib");

const K = { list: "mc:bn", photo: (id) => "mc:photo:" + id, ip: (ip) => "mc:bn:ip:" + ip };
const MAX_PHOTO = 3 * 1024 * 1024; // en caractères base64 (~2,2 Mo d'image)

module.exports = L.handler(async (req, res) => {
  const params = L.query(req);

  if (req.method === "GET" && params.get("photo")) {
    const raw = await L.redis(["GET", K.photo(L.str(params.get("photo"), 64))]);
    const m = raw && raw.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
    if (!m) return L.send(res, 404, { error: "Photo introuvable." });
    res.statusCode = 200;
    res.setHeader("Content-Type", m[1]);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    return res.end(Buffer.from(m[2], "base64"));
  }

  if (req.method === "GET") {
    const entries = Object.values(await L.hgetallJson(K.list))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 400);
    return L.send(res, 200, { entries }, { "Cache-Control": "public, max-age=0, s-maxage=3, stale-while-revalidate=5" });
  }

  if (req.method === "POST") {
    const b = await L.readBody(req);
    if (b.website) return L.send(res, 201, { ok: true }); // pot de miel
    const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "?").split(",")[0].trim();
    const hits = await L.redis(["INCR", K.ip(ip)]);
    if (hits === 1) await L.redis(["EXPIRE", K.ip(ip), 60]);
    if (hits > 8) throw new L.HttpError(429, "Doucement ! Réessayez dans une minute.");

    const name = L.str(b.name, 60);
    const message = L.str(b.message, 1000);
    const photo = typeof b.photo === "string" ? b.photo : "";
    if (photo && (!/^data:image\/(jpeg|png|webp);base64,/.test(photo) || photo.length > MAX_PHOTO)) {
      throw new L.HttpError(400, "Photo non prise en charge ou trop lourde.");
    }
    if (!message && !photo) throw new L.HttpError(400, "Écrivez un message ou ajoutez une photo.");

    const id = crypto.randomUUID();
    if (photo) await L.redis(["SET", K.photo(id), photo]);
    const entry = { id, name: name || "Un passager", message, photo: !!photo, createdAt: new Date().toISOString() };
    await L.redis(["HSET", K.list, id, JSON.stringify(entry)]);
    return L.send(res, 201, { entry });
  }

  if (req.method === "DELETE") {
    await L.requireUser(req);
    const id = L.str(params.get("id"), 64);
    await L.redis(["HDEL", K.list, id]);
    await L.redis(["DEL", K.photo(id)]);
    return L.send(res, 200, { ok: true });
  }

  L.send(res, 405, { error: "Méthode non autorisée." });
});
