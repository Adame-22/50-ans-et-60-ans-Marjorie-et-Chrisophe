/*
 * Équipes, construites à partir de « qui est à quelle table ».
 *
 * mc:teams → {
 *   mode: "tables" | "groups" | "mix",
 *   show: bool,          // équipes visibles par les invités et sur l'écran géant
 *   quiz: bool,          // classement par équipe dans le quiz
 *   names: { teamId: nom }            // mode "tables" : noms personnalisés
 *   teams: [{ id, name, color, tables: [tableId], members: [invitéId] }]   // modes "groups" et "mix"
 * }
 *
 * - "tables" : une table = une équipe (automatique, suit le plan en direct)
 * - "groups" : les tables sont regroupées en N équipes équilibrées ; les invités
 *              suivent leur table, y compris ceux qui s'installent plus tard
 * - "mix"    : les invités sont répartis en N équipes équilibrées, sans séparer
 *              un groupe (une réponse = une famille), en mélangeant les tables
 */
const crypto = require("crypto");
const L = require("./_lib");
const T = require("./_seating");

const K_TEAMS = "mc:teams";
const NATO = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel", "India", "Juliett",
  "Kilo", "Lima", "Mike", "November", "Oscar", "Papa", "Quebec", "Romeo", "Sierra", "Tango"];
const COLORS = ["#ffb100", "#5b8def", "#e8704f", "#2bb3a3", "#b98150", "#8a6fd6", "#d9669a", "#6aa84f",
  "#d4af37", "#4f6bd8", "#c0504d", "#8f9496", "#3aa0c8", "#9b59b6", "#e67e22", "#16a085", "#f06292", "#8d6e63", "#546e7a", "#cddc39"];

const DEFAULT = { mode: "tables", show: false, quiz: false, names: {}, teams: [] };

async function getConfig() {
  const raw = await L.redis(["GET", K_TEAMS]);
  return Object.assign({}, DEFAULT, raw ? JSON.parse(raw) : {});
}
function saveConfig(cfg) {
  cfg.updatedAt = new Date().toISOString();
  return L.redis(["SET", K_TEAMS, JSON.stringify(cfg)]);
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const pax = (p) => Math.max(1, p.passagers || 1);

/* Lecture de tout ce qu'il faut pour résoudre les équipes */
async function loadWorld() {
  const plan = await T.getPlan();
  const [assign, rsvps, cfg] = await Promise.all([T.getAssign(), L.hgetallJson(L.K.rsvps), getConfig()]);
  const people = Object.values(rsvps).filter((r) => r.presence === "oui");
  return { plan, assign, people, cfg };
}

/* Équipes « résolues » : membres actuels, effectifs, tables */
function resolve(world) {
  const { plan, assign, people, cfg } = world;
  const tableName = {};
  plan.tables.forEach((t) => { tableName[t.id] = t.name; });

  let teams;
  if (cfg.mode === "tables") {
    teams = plan.tables.map((t, i) => ({
      id: "tb-" + t.id, name: (cfg.names || {})["tb-" + t.id] || t.name, color: COLORS[i % COLORS.length], tables: [t.id], members: [],
    }));
  } else {
    teams = (cfg.teams || []).map((t) => ({
      id: t.id, name: t.name, color: t.color, tables: (t.tables || []).filter((id) => tableName[id]), members: t.members || [],
    }));
  }

  const teamOfTable = {}, teamOfPid = {};
  teams.forEach((tm) => tm.tables.forEach((id) => { teamOfTable[id] = tm.id; }));
  if (cfg.mode === "mix") teams.forEach((tm) => tm.members.forEach((pid) => { teamOfPid[pid] = tm.id; }));
  else people.forEach((p) => { if (assign[p.id] && teamOfTable[assign[p.id]]) teamOfPid[p.id] = teamOfTable[assign[p.id]]; });

  const byId = {};
  teams.forEach((tm) => { tm.people = []; byId[tm.id] = tm; });
  const unassigned = [];
  people.forEach((p) => {
    const item = { id: p.id, nom: p.nom, passagers: pax(p), table: assign[p.id] || null };
    const tm = byId[teamOfPid[p.id]];
    (tm ? tm.people : unassigned).push(item);
  });
  const sortNom = (a, b) => a.nom.localeCompare(b.nom, "fr");
  teams.forEach((tm) => {
    tm.people.sort(sortNom);
    tm.count = tm.people.reduce((n, p) => n + p.passagers, 0);
    tm.tableNames = tm.tables.map((id) => tableName[id]);
    delete tm.members;
  });
  unassigned.sort(sortNom);
  // en mode « une table = une équipe », seules les tables occupées forment une équipe
  if (cfg.mode === "tables") teams = teams.filter((tm) => tm.count > 0);
  return { cfg, teams, unassigned, teamOfPid, teamOfTable, tableName };
}

/* Génération équilibrée */
function generate(world, mode, n, onlySeated) {
  const { plan, assign, people } = world;
  n = Math.min(20, Math.max(2, parseInt(n, 10) || 4));
  const teams = Array.from({ length: n }, (_, i) => ({
    id: "eq-" + NATO[i].toLowerCase(), name: NATO[i], color: COLORS[i], tables: [], members: [], total: 0, per: {},
  }));
  const lightest = (list) => list.reduce((best, tm) => (tm.total < best.total ? tm : best), list[0]);

  if (mode === "groups") {
    const count = {};
    people.forEach((p) => { if (assign[p.id]) count[assign[p.id]] = (count[assign[p.id]] || 0) + pax(p); });
    const tables = shuffle(plan.tables.map((t) => ({ id: t.id, n: count[t.id] || 0 }))).sort((a, b) => b.n - a.n);
    for (const t of tables) {
      // tables occupées : vers l'équipe la plus légère ; tables vides : vers celle qui a le moins de tables
      const tm = t.n > 0 ? lightest(shuffle(teams.slice()))
        : teams.slice().sort((a, b) => a.tables.length - b.tables.length || a.total - b.total)[0];
      tm.tables.push(t.id);
      tm.total += t.n;
    }
  } else {
    let pool = people;
    if (onlySeated) pool = pool.filter((p) => assign[p.id] || p.arrivedAt);
    const groups = shuffle(pool.slice()).sort((a, b) => pax(b) - pax(a));
    for (const g of groups) {
      const table = assign[g.id];
      // l'équipe la plus légère, en évitant de regrouper les voisins de table
      let best = null, bestScore = Infinity;
      for (const tm of shuffle(teams.slice())) {
        const score = tm.total + (table ? (tm.per[table] || 0) * 0.75 : 0);
        if (score < bestScore) { best = tm; bestScore = score; }
      }
      best.members.push(g.id);
      best.total += pax(g);
      if (table) best.per[table] = (best.per[table] || 0) + pax(g);
    }
  }
  return teams.map((tm) => ({ id: tm.id, name: tm.name, color: tm.color, tables: tm.tables, members: tm.members }));
}

/* Version publique (invités, écran) : seulement si l'équipage a publié les équipes */
function publicView(r) {
  const on = r.cfg.show || r.cfg.quiz;
  return {
    show: !!r.cfg.show, quiz: !!r.cfg.quiz, mode: r.cfg.mode,
    teams: on ? r.teams.filter((tm) => tm.count > 0).map((tm) => ({
      id: tm.id, name: tm.name, color: tm.color, count: tm.count, tables: tm.tableNames,
      people: tm.people.map((p) => ({ nom: p.nom, passagers: p.passagers })),
    })) : [],
  };
}

/* Classement du quiz par équipe : moyenne des points des joueurs de l'équipe */
async function quizTeams(players) {
  const world = await loadWorld();
  if (!world.cfg.quiz) return null;
  const r = resolve(world);
  const byTeam = {};
  r.teams.forEach((tm) => { byTeam[tm.id] = { id: tm.id, name: tm.name, color: tm.color, score: 0, players: 0, sum: 0 }; });
  const teamOf = {};
  for (const p of players) {
    const tid = (p.rid && r.teamOfPid[p.rid]) || (r.cfg.mode !== "mix" && p.table && r.teamOfTable[p.table]) || null;
    if (!tid || !byTeam[tid]) continue;
    teamOf[p.pub] = tid;
    byTeam[tid].players++;
    byTeam[tid].sum += p.score || 0;
  }
  const teams = Object.values(byTeam)
    .filter((t) => t.players > 0)
    .map((t) => ({ id: t.id, name: t.name, color: t.color, players: t.players, score: Math.round(t.sum / t.players) }))
    .sort((a, b) => b.score - a.score || b.players - a.players || a.name.localeCompare(b.name, "fr"));
  const tables = world.plan.tables.map((t) => ({ id: t.id, name: t.name }));
  return { teams, teamOf, mode: r.cfg.mode, tables };
}

module.exports = { K_TEAMS, NATO, COLORS, getConfig, saveConfig, loadWorld, resolve, generate, publicView, quizTeams };
