/*
 * /api/boite — la « Boîte noire » : messages et photos des invités
 *   GET                 (public)   → messages, du plus récent au plus ancien (cache 3 s)
 *   GET ?photo=<id>     (public)   → l'image (mise en cache longue durée)
 *   POST { name, message, photo }  → photo = data URL JPEG/PNG/WebP déjà réduite côté téléphone
 *   GET ?view=admin     (équipage) → tout, avec la place occupée par les photos
 *   DELETE ?id=<id>     (équipage) → supprime un message et sa photo
 *   DELETE ?id=<id>&photo=1         → retire seulement la photo (le message reste)
 *   POST { action: "purge", ids, photoOnly } (équipage) → suppression groupée
 *
 * Les photos sont gardées dans la base : un plafond (PHOTO_BUDGET) évite de la saturer
 * si des invités en envoient énormément ; l'équipage peut les télécharger puis les retirer.
 */
const crypto = require("crypto");
const L = require("./_lib");

const K = { list: "mc:bn", photo: (id) => "mc:photo:" + id, ip: (ip) => "mc:bn:ip:" + ip };
const MAX_PHOTO = 3 * 1024 * 1024; // en caractères base64 (~2,2 Mo d'image)
const PHOTO_BUDGET = parseInt(process.env.MC_PHOTO_BUDGET, 10) || 350 * 1024 * 1024; // place totale réservée aux photos (base gratuite Supabase : 500 Mo)

async function removePhoto(id, keepMessage) {
  const raw = await L.redis(["HGET", K.list, id]);
  const entry = raw ? JSON.parse(raw) : null;
  if (entry && entry.photo) {
    await L.redis(["DEL", K.photo(id)]);
  }
  if (!entry) return;
  if (keepMessage && entry.message) {
    entry.photo = false;
    entry.size = 0;
    entry.photoRemovedAt = new Date().toISOString();
    await L.redis(["HSET", K.list, id, JSON.stringify(entry)]);
  } else {
    await L.redis(["HDEL", K.list, id]);
    await L.redis(["DEL", K.photo(id)]);
  }
}

async function usedBytes() {
  const all = Object.values(await L.hgetallJson(K.list));
  return all.reduce((n, e) => n + (e.photo ? e.size || 400000 : 0), 0);
}

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

  if (req.method === "GET" && params.get("view") === "admin") {
    await L.requireUser(req);
    const entries = Object.values(await L.hgetallJson(K.list)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const used = entries.reduce((n, e) => n + (e.photo ? e.size || 400000 : 0), 0);
    return L.send(res, 200, { entries, used, budget: PHOTO_BUDGET });
  }

  if (req.method === "GET") {
    const entries = Object.values(await L.hgetallJson(K.list))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 400);
    return L.send(res, 200, { entries }, { "Cache-Control": "public, max-age=0, s-maxage=3, stale-while-revalidate=5" });
  }

  if (req.method === "POST") {
    const b = await L.readBody(req);
    if (b.action === "purge") {
      await L.requireUser(req);
      const ids = (Array.isArray(b.ids) ? b.ids : []).slice(0, 1000).map((x) => L.str(x, 64)).filter(Boolean);
      for (const id of ids) await removePhoto(id, !!b.photoOnly);
      return L.send(res, 200, { ok: true, count: ids.length });
    }
    if (b.website) return L.send(res, 201, { ok: true }); // pot de miel
    await L.rateLimit(req, "boite", 80, 60);

    const name = L.str(b.name, 60);
    const message = L.str(b.message, 1000);
    const photo = typeof b.photo === "string" ? b.photo : "";
    if (photo && (!/^data:image\/(jpeg|png|webp);base64,/.test(photo) || photo.length > MAX_PHOTO)) {
      throw new L.HttpError(400, "Photo non prise en charge ou trop lourde.");
    }
    if (!message && !photo) throw new L.HttpError(400, "Écrivez un message ou ajoutez une photo.");

    if (photo && (await usedBytes()) + photo.length > PHOTO_BUDGET) {
      throw new L.HttpError(507, "L'album photo est plein pour l'instant : l'équipage fait de la place, réessayez dans quelques minutes (votre message seul passe).");
    }
    const id = crypto.randomUUID();
    if (photo) await L.redis(["SET", K.photo(id), photo]);
    const entry = { id, name: name || "Un passager", message, photo: !!photo, size: photo.length, createdAt: new Date().toISOString() };
    await L.redis(["HSET", K.list, id, JSON.stringify(entry)]);
    return L.send(res, 201, { entry });
  }

  if (req.method === "DELETE") {
    await L.requireUser(req);
    const id = L.str(params.get("id"), 64);
    await removePhoto(id, params.get("photo") === "1");
    return L.send(res, 200, { ok: true });
  }

  L.send(res, 405, { error: "Méthode non autorisée." });
});
