/*
 * /api/teams — équipes pour les jeux de la soirée
 *   GET                (public)   → équipes publiées (liste vide tant que l'équipage ne les a pas publiées)
 *   GET ?view=admin    (équipage) → réglages, équipes, invités sans équipe, tables
 *   POST  { action: "generate", mode: "groups" | "mix", count, onlySeated }        (équipage)
 *   PATCH { mode: "tables" } | { show } | { quiz } | { rename: { id, name } }
 *         | { move: { id, team } }  → déplace une table (mode groups) ou un invité (mode mix)
 */
const L = require("./_lib");
const TM = require("./_teams");

function adminOut(res, world) {
  const r = TM.resolve(world);
  const c = r.cfg;
  return L.send(res, 200, {
    cfg: { mode: c.mode, show: !!c.show, quiz: !!c.quiz, updatedAt: c.updatedAt || null, by: c.by || null },
    teams: r.teams, unassigned: r.unassigned,
    tables: world.plan.tables.map((t) => ({ id: t.id, name: t.name })),
  });
}

module.exports = L.handler(async (req, res) => {
  if (req.method === "GET") {
    if (L.query(req).get("view") === "admin") {
      await L.requireUser(req);
      return adminOut(res, await TM.loadWorld());
    }
    const r = TM.resolve(await TM.loadWorld());
    return L.send(res, 200, TM.publicView(r), { "Cache-Control": "public, max-age=0, s-maxage=3, stale-while-revalidate=5" });
  }

  const me = await L.requireUser(req);
  const b = await L.readBody(req);
  const world = await TM.loadWorld();
  const cfg = world.cfg;

  if (req.method === "POST" && b.action === "generate") {
    cfg.mode = b.mode === "mix" ? "mix" : "groups";
    cfg.teams = TM.generate(world, cfg.mode, b.count, b.onlySeated !== false);
  } else if (req.method === "PATCH") {
    if (b.mode === "tables") cfg.mode = "tables";
    if (typeof b.show === "boolean") cfg.show = b.show;
    if (typeof b.quiz === "boolean") cfg.quiz = b.quiz;
    if (b.rename) {
      const id = L.str(b.rename.id, 40), name = L.str(b.rename.name, 40);
      if (!name) throw new L.HttpError(400, "Donnez un nom à l'équipe.");
      if (cfg.mode === "tables") {
        cfg.names = Object.assign({}, cfg.names, { [id]: name });
      } else {
        const t = (cfg.teams || []).find((x) => x.id === id);
        if (!t) throw new L.HttpError(404, "Équipe introuvable.");
        t.name = name;
      }
    }
    if (b.move) {
      if (cfg.mode === "tables") throw new L.HttpError(409, "Ici, une table = une équipe : déplacez plutôt l'invité de table dans le Plan de cabine.");
      const id = L.str(b.move.id, 64);
      const to = b.move.team ? L.str(b.move.team, 40) : null;
      if (!id) throw new L.HttpError(400, "Élément manquant.");
      if (to && !(cfg.teams || []).some((t) => t.id === to)) throw new L.HttpError(404, "Équipe introuvable.");
      const key = cfg.mode === "mix" ? "members" : "tables";
      cfg.teams.forEach((t) => { t[key] = (t[key] || []).filter((x) => x !== id); });
      if (to) cfg.teams.find((t) => t.id === to)[key].push(id);
    }
  } else {
    return L.send(res, 405, { error: "Méthode non autorisée." });
  }

  cfg.by = me.name;
  await TM.saveConfig(cfg);
  world.cfg = cfg;
  return adminOut(res, world);
});
