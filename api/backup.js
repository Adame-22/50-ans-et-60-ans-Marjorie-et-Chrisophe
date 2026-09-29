/*
 * /api/backup — sauvegarde complète (équipage connecté)
 *   GET → un fichier JSON avec les réponses, tables et placements, équipes, quiz,
 *         messages de la Boîte noire (sans les photos : elles se téléchargent en ZIP
 *         depuis l'onglet Boîte noire), radio et comptes (sans les mots de passe).
 */
const L = require("./_lib");
const T = require("./_seating");
const TM = require("./_teams");

async function getJson(key) {
  const raw = await L.redis(["GET", key]);
  try { return raw ? JSON.parse(raw) : null; } catch (e) { return raw; }
}
async function hash(key) {
  const arr = await L.redis(["HGETALL", key]);
  const out = {};
  for (let i = 0; arr && i < arr.length; i += 2) out[arr[i]] = arr[i + 1];
  return out;
}

module.exports = L.handler(async (req, res) => {
  const me = await L.requireUser(req);
  if (req.method !== "GET") return L.send(res, 405, { error: "Méthode non autorisée." });

  const plan = await T.getPlan();
  const [rsvps, assign, teams, users, bn, songs, votes] = await Promise.all([
    L.hgetallJson(L.K.rsvps), T.getAssignFull(), TM.getConfig(), L.hgetallJson(L.K.users),
    L.hgetallJson("mc:bn"), L.hgetallJson("mc:radio"), hash("mc:radio:votes"),
  ]);
  const [questions, state, players] = await Promise.all([
    getJson("mc:quiz:questions"), getJson("mc:quiz:state"), L.hgetallJson("mc:quiz:players"),
  ]);

  const now = new Date();
  const data = {
    app: "Vol MC 5060",
    exportedAt: now.toISOString(),
    exportedBy: me.name,
    note: "Photos de la Boîte noire non incluses : utilisez « Télécharger toutes les photos (ZIP) » dans l'onglet Boîte noire.",
    rsvps: Object.values(rsvps).sort((a, b) => a.nom.localeCompare(b.nom, "fr")),
    tables: plan.tables,
    placements: assign,
    teams,
    quiz: { questions, state, players: Object.values(players).map((p) => ({ name: p.name, score: p.score || 0, rid: p.rid || null, table: p.table || null })) },
    boiteNoire: Object.values(bn).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    radio: Object.values(songs).map((s) => Object.assign({}, s, { votes: parseInt(votes[s.id], 10) || 0 })),
    comptes: Object.values(users).map(L.publicUser),
  };
  const stamp = now.toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
  return L.send(res, 200, data, { "Content-Disposition": 'attachment; filename="sauvegarde-vol-mc5060-' + stamp + '.json"' });
});
