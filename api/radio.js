/*
 * /api/radio — « Radio de bord » : propositions de chansons et votes
 *   GET                                         (public) → chansons triées (cache 3 s)
 *   POST { action: "add", title, artist, by, voter }     → propose (et vote pour) une chanson
 *   POST { action: "vote", id, voter }                   → un vote par appareil et par chanson
 *   PATCH { id, played }            (équipage)           → marque comme jouée
 *   DELETE ?id=…                    (équipage)           → supprime
 */
const crypto = require("crypto");
const L = require("./_lib");

const K = { songs: "mc:radio", votes: "mc:radio:votes", voters: "mc:radio:voters", ip: (ip) => "mc:radio:ip:" + ip };
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

async function vote(id, voter) {
  if (!voter) return false;
  const fresh = await L.redis(["HSETNX", K.voters, id + ":" + voter, "1"]);
  if (fresh) await L.redis(["HINCRBY", K.votes, id, 1]);
  return !!fresh;
}

module.exports = L.handler(async (req, res) => {
  if (req.method === "GET") {
    const [songs, votes] = await Promise.all([L.hgetallJson(K.songs), L.redis(["HGETALL", K.votes])]);
    const count = {};
    for (let i = 0; votes && i < votes.length; i += 2) count[votes[i]] = parseInt(votes[i + 1], 10) || 0;
    const list = Object.values(songs)
      .map((s) => Object.assign(s, { votes: count[s.id] || 0 }))
      .sort((a, b) => (a.played - b.played) || (b.votes - a.votes) || a.createdAt.localeCompare(b.createdAt));
    return L.send(res, 200, { songs: list }, { "Cache-Control": "public, max-age=0, s-maxage=3, stale-while-revalidate=5" });
  }

  const b = await L.readBody(req);

  if (req.method === "POST") {
    const voter = L.str(b.voter, 64);
    if (b.action === "vote") {
      const id = L.str(b.id, 64);
      if (!(await L.redis(["HGET", K.songs, id]))) throw new L.HttpError(404, "Chanson introuvable.");
      return L.send(res, 200, { ok: await vote(id, voter) });
    }
    if (b.action === "add") {
      if (b.website) return L.send(res, 201, { ok: true });
      await L.rateLimit(req, "radio", 80, 60);
      const title = L.str(b.title, 100), artist = L.str(b.artist, 80);
      if (!title) throw new L.HttpError(400, "Indiquez le titre de la chanson.");
      const key = norm(title) + "|" + norm(artist);
      const existing = Object.values(await L.hgetallJson(K.songs)).find((s) => s.key === key);
      if (existing) { await vote(existing.id, voter); return L.send(res, 200, { song: existing, duplicate: true }); }
      const song = { id: crypto.randomUUID(), key, title, artist, by: L.str(b.by, 40), played: false, createdAt: new Date().toISOString() };
      await L.redis(["HSET", K.songs, song.id, JSON.stringify(song)]);
      await vote(song.id, voter);
      return L.send(res, 201, { song });
    }
    throw new L.HttpError(400, "Action inconnue.");
  }

  await L.requireUser(req);

  if (req.method === "PATCH") {
    const raw = await L.redis(["HGET", K.songs, L.str(b.id, 64)]);
    if (!raw) throw new L.HttpError(404, "Chanson introuvable.");
    const song = JSON.parse(raw);
    song.played = !!b.played;
    await L.redis(["HSET", K.songs, song.id, JSON.stringify(song)]);
    return L.send(res, 200, { song });
  }

  if (req.method === "DELETE") {
    const id = L.str(L.query(req).get("id"), 64);
    await L.redis(["HDEL", K.songs, id]);
    await L.redis(["HDEL", K.votes, id]);
    return L.send(res, 200, { ok: true });
  }

  L.send(res, 405, { error: "Méthode non autorisée." });
});
