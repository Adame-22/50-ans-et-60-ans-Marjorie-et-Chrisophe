/*
 * /api/quiz — quiz en direct façon Kahoot
 *
 * Public :
 *   GET  ?view=public                      → état du quiz (mis en cache 1 s par le CDN de Vercel,
 *                                            donc ~1 calcul/s quel que soit le nombre de joueurs)
 *   POST { action: "join", name, rid?, table? } → { pid, pub }   (rid : invité, table : sa table, pour le jeu par équipe)
 *   POST { action: "link", pid, rid?, table? }  → rattache un joueur à sa table / son équipe
 *   POST { action: "answer", pid, choice }      → enregistre la réponse (une seule par question)
 *
 * Quand l'équipage active « classement par équipe » (onglet Équipes), l'état public
 * contient aussi teams (moyenne des points par équipe) et teamOf (joueur → équipe).
 *
 * Équipage (connecté) :
 *   GET  ?view=admin                       → questions complètes + réponses reçues
 *   PUT  { questions: [...] }              → remplace les questions
 *   POST { action: "lobby" | "start" | "reveal" | "board" | "podium" | "off" | "reset", from? }
 *        from = { phase, round, index } vu par l'animateur : si le quiz a déjà avancé (deux animateurs,
 *        double appui, réseau qui renvoie), l'action est refusée au lieu de sauter une question.
 */
const crypto = require("crypto");
const L = require("./_lib");
const TM = require("./_teams");

const K = {
  questions: "mc:quiz:questions",
  state: "mc:quiz:state",
  players: "mc:quiz:players",
  answers: (round) => "mc:quiz:ans:" + round,
  locks: "mc:quiz:locks", // une seule révélation / un seul lancement par manche
};

// Questions de départ : « Qui de… » (réponse à régler dans l'admin selon la vérité !) et culture des années 66 / 76
const QUI = ["Marjorie", "Christophe", "Les deux", "Aucun des deux"];
const DEFAULT_QUESTIONS = [
  { q: "Qui de Marjorie ou Christophe est toujours en retard ?", choices: QUI, answer: 0, time: 15 },
  { q: "Qui de Marjorie ou Christophe s'endort devant la télé ?", choices: QUI, answer: 1, time: 15 },
  { q: "En 1966, année de naissance de Christophe, quel film comique triomphe au cinéma ?", choices: ["Le Corniaud", "La Grande Vadrouille", "Les Tontons flingueurs", "Le Gendarme de Saint-Tropez"], answer: 1, time: 20 },
  { q: "Qui de Marjorie ou Christophe a le plus de paires de chaussures ?", choices: QUI, answer: 0, time: 15 },
  { q: "En 1976, année de naissance de Marjorie, quel avion fait son premier vol commercial ?", choices: ["Le Boeing 747", "L'Airbus A320", "Le Concorde", "La Caravelle"], answer: 2, time: 20 },
  { q: "Qui de Marjorie ou Christophe cuisine le mieux ?", choices: QUI, answer: 0, time: 15 },
  { q: "Quel groupe chante « Dancing Queen », sorti en 1976 ?", choices: ["Boney M.", "ABBA", "Bee Gees", "Queen"], answer: 1, time: 15 },
  { q: "Qui de Marjorie ou Christophe dit « je ne suis pas fatigué·e »… avant de s'endormir ?", choices: QUI, answer: 1, time: 15 },
  { q: "Combien d'années de voyage cumulent les deux commandants de bord ?", choices: ["100 ans", "106 ans", "110 ans", "116 ans"], answer: 2, time: 15 },
  { q: "Qui de Marjorie ou Christophe a le dernier mot dans une dispute ?", choices: QUI, answer: 0, time: 15 },
  { q: "Quelle entreprise est fondée en 1976 dans un garage californien ?", choices: ["Microsoft", "Apple", "Google", "IBM"], answer: 1, time: 15 },
  { q: "Qui de Marjorie ou Christophe sera le premier sur la piste de danse ce soir ?", choices: QUI, answer: 2, time: 15 },
];
const hash = (pid) => crypto.createHash("sha256").update(String(pid)).digest("hex").slice(0, 10);

async function getJson(key, fallback) {
  const raw = await L.redis(["GET", key]);
  return raw ? JSON.parse(raw) : fallback;
}
const setJson = (key, v) => L.redis(["SET", key, JSON.stringify(v)]);

async function getQuestions() {
  return getJson(K.questions, DEFAULT_QUESTIONS);
}
async function getState() {
  return getJson(K.state, { phase: "off", index: -1, round: 0 });
}

async function allPlayers() {
  return Object.values(await L.hgetallJson(K.players));
}
function leaderboard(players) {
  const list = players
    .map((p) => ({ pub: p.pub, name: p.name, score: p.score || 0 }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "fr"));
  // ex aequo : même rang
  list.forEach((p, i) => { p.rank = i && p.score === list[i - 1].score ? list[i - 1].rank : i + 1; });
  return list;
}

function sanitizeQuestions(list) {
  if (!Array.isArray(list) || list.length > 60) throw new L.HttpError(400, "Liste de questions invalide.");
  return list.map((x) => {
    const choices = (Array.isArray(x.choices) ? x.choices : []).map((c) => L.str(c, 80)).filter(Boolean).slice(0, 4);
    if (choices.length < 2) throw new L.HttpError(400, "Chaque question doit avoir au moins 2 réponses.");
    const answer = Math.min(choices.length - 1, Math.max(0, parseInt(x.answer, 10) || 0));
    return { q: L.str(x.q, 200) || "Question", choices, answer, time: Math.min(60, Math.max(5, parseInt(x.time, 10) || 20)) };
  });
}

module.exports = L.handler(async (req, res) => {
  const now = Date.now(); // pris tout de suite : la lenteur de la base ne doit pas coûter de points
  const params = L.query(req);

  /* ───────── Lecture ───────── */
  if (req.method === "GET") {
    const view = params.get("view") || "public";
    const [state, questions] = await Promise.all([getState(), getQuestions()]);
    const cur = questions[state.index];

    if (view === "admin") {
      L.noSpoil(await L.requireUser(req)); // questions et réponses : surprise pour les fêtés
      const answered = state.round ? await L.redis(["HLEN", K.answers(state.round)]) : 0;
      const all = await allPlayers();
      const tq = await TM.quizTeams(all);
      // le top 10 (et les équipes si le jeu est par équipe) pour que l'animateur annonce les bons gagnants
      return L.send(res, 200, { state, questions, answered, players: all.length, top: leaderboard(all).slice(0, 10),
        teams: tq ? tq.teams.slice(0, 10) : null, serverNow: Date.now() });
    }

    const out = { phase: state.phase, index: state.index, total: questions.length, serverNow: Date.now() };
    if (cur && ["question", "reveal", "board"].includes(state.phase)) {
      out.question = { q: cur.q, choices: cur.choices, time: cur.time };
      out.round = state.round;
      out.startedAt = state.startedAt;
      out.endsAt = state.endsAt;
    }
    if (state.phase === "question") out.answered = await L.redis(["HLEN", K.answers(state.round)]);
    out.done = !!state.done;
    if (["reveal", "board"].includes(state.phase)) {
      out.correct = cur ? cur.answer : null;
      out.counts = state.counts || [];
      out.answered = (state.counts || []).reduce((a, b) => a + b, 0);
      out.gains = state.gains || {};
      out.scoring = !!state.scoring; // points en cours de calcul (moins d'une seconde)
    }
    if (["lobby", "reveal", "board", "podium"].includes(state.phase)) {
      const players = await allPlayers();
      out.leaderboard = leaderboard(players);
      const tq = state.phase !== "off" ? await TM.quizTeams(players) : null;
      if (tq) Object.assign(out, { teamMode: true, teams: tq.teams, teamOf: tq.teamOf, teamTables: tq.mode === "mix" ? [] : tq.tables });
    } else {
      out.players = await L.redis(["HLEN", K.players]);
    }
    return L.send(res, 200, out, { "Cache-Control": "public, max-age=0, s-maxage=1, stale-while-revalidate=1" });
  }

  const body = await L.readBody(req);

  /* ───────── Joueurs ───────── */
  if (req.method === "POST" && body.action === "join") {
    const state = await getState();
    if (state.phase === "off") throw new L.HttpError(409, "Le quiz n'a pas encore commencé.");
    const name = L.str(body.name, 24);
    if (!name) throw new L.HttpError(400, "Choisissez un pseudo.");
    await L.rateLimit(req, "quiz-join", 200, 60);
    const players = await allPlayers();
    if (players.length >= 300) throw new L.HttpError(409, "Le quiz est complet.");
    // deux « Papy » : le second devient « Papy 2 » pour qu'on les distingue au classement
    const taken = new Set(players.map((p) => p.name.toLowerCase()));
    let finalName = name;
    for (let n = 2; taken.has(finalName.toLowerCase()); n++) finalName = name.slice(0, 21) + " " + n;
    const pid = crypto.randomUUID();
    const pub = hash(pid);
    const link = { rid: L.str(body.rid, 64) || null, table: L.str(body.table, 20) || null };
    await L.redis(["HSET", K.players, pid, JSON.stringify(Object.assign({ pid, pub, name: finalName, score: 0, played: 0, joinedAt: now }, link))]);
    return L.send(res, 201, { pid, pub, name: finalName });
  }

  if (req.method === "POST" && body.action === "link") {
    const pid = L.str(body.pid, 64);
    await L.rateLimit(req, "quiz-link", 200, 60);
    const raw = await L.redis(["HGET", K.players, pid]);
    if (!raw) throw new L.HttpError(404, "Joueur inconnu, rejoignez à nouveau le quiz.");
    const p = JSON.parse(raw);
    if (body.rid !== undefined) p.rid = L.str(body.rid, 64) || null;
    if (body.table !== undefined) p.table = L.str(body.table, 20) || null;
    // relecture juste avant d'écrire : ne pas écraser des points marqués entre-temps
    const fresh = JSON.parse((await L.redis(["HGET", K.players, pid])) || raw);
    fresh.rid = p.rid; fresh.table = p.table;
    await L.redis(["HSET", K.players, pid, JSON.stringify(fresh)]);
    return L.send(res, 200, { ok: true });
  }

  if (req.method === "POST" && body.action === "answer") {
    const pid = L.str(body.pid, 64);
    await L.rateLimit(req, "quiz-answer", 900, 60);
    const [state, questions, player] = await Promise.all([getState(), getQuestions(), L.redis(["HGET", K.players, pid])]);
    if (!player) throw new L.HttpError(404, "Joueur inconnu, rejoignez à nouveau le quiz.");
    if (state.phase !== "question") throw new L.HttpError(409, "Les réponses sont fermées.");
    if (now < state.startedAt - 250) throw new L.HttpError(409, "Pas encore : attendez le top départ !");
    if (now > state.endsAt + 1500) throw new L.HttpError(409, "Trop tard !");
    const cur = questions[state.index];
    const choice = parseInt(body.choice, 10);
    if (!cur || !(choice >= 0 && choice < cur.choices.length)) throw new L.HttpError(400, "Réponse invalide.");
    // Rapidité : le téléphone dit depuis quand il affiche la question (il la reçoit 1 à 4 s après le lancement) ;
    // on ne lui accorde pas plus de 2,5 s d'avance sur l'heure du serveur.
    const serverMs = Math.max(0, now - state.startedAt);
    const clientMs = Number(body.elapsed);
    const ms = Number.isFinite(clientMs) ? Math.round(Math.min(serverMs, Math.max(serverMs - 2500, clientMs))) : serverMs;
    const ok = await L.redis(["HSETNX", K.answers(state.round), pid, JSON.stringify({ choice, ms })]);
    if (!ok) {
      const prev = JSON.parse((await L.redis(["HGET", K.answers(state.round), pid])) || "{}");
      return L.send(res, 200, { ok: true, already: true, choice: prev.choice, round: state.round });
    }
    return L.send(res, 200, { ok: true, choice, round: state.round });
  }

  /* ───────── Animateur ───────── */
  const me = await L.requireUser(req);
  L.noSpoil(me);

  if (req.method === "PUT") {
    const questions = sanitizeQuestions(body.questions);
    await setJson(K.questions, questions);
    return L.send(res, 200, { questions });
  }

  if (req.method === "POST") {
    const state = await getState();
    const questions = await getQuestions();
    const from = body.from && typeof body.from === "object" ? body.from : null;
    if (from && ["start", "reveal", "board", "podium"].includes(body.action) &&
      (from.phase !== state.phase || (from.round || 0) !== (state.round || 0))) {
      throw new L.HttpError(409, "Le quiz a déjà avancé (double appui, ou quelqu'un d'autre pilote). L'écran se met à jour.");
    }

    switch (body.action) {
      case "lobby":
        Object.assign(state, { phase: "lobby" });
        break;

      case "start": { // question suivante (ou celle demandée)
        if (state.phase === "question") throw new L.HttpError(409, "Révélez d'abord la réponse de la question en cours.");
        const index = body.index !== undefined ? parseInt(body.index, 10) : state.index + 1;
        const q = questions[index];
        if (!q) throw new L.HttpError(400, "Il n'y a plus de question.");
        const round = (state.round || 0) + 1;
        if (!(await L.redis(["HSETNX", K.locks, "start:" + round, String(now)]))) throw new L.HttpError(409, "Cette question vient déjà d'être lancée.");
        Object.assign(state, {
          phase: "question", index, round, done: false,
          startedAt: now + 3000, endsAt: now + 3000 + q.time * 1000, counts: null, gains: null,
        });
        break;
      }

      case "reveal": {
        if (state.phase !== "question") throw new L.HttpError(409, "Aucune question en cours.");
        if (!(await L.redis(["HSETNX", K.locks, "reveal:" + state.round, String(now)]))) throw new L.HttpError(409, "La réponse est déjà en cours de révélation.");
        const q = questions[state.index];
        if (!q) throw new L.HttpError(409, "Cette question n'existe plus.");
        // 1) on ferme les réponses tout de suite, 2) on laisse arriver celles déjà en route, 3) on compte
        Object.assign(state, { phase: "reveal", scoring: true, endsAt: Math.min(state.endsAt, now), counts: q.choices.map(() => 0), gains: {}, by: me.name });
        await setJson(K.state, state);
        await new Promise((r) => setTimeout(r, 400));
        const [answers, players] = await Promise.all([L.hgetallJson(K.answers(state.round)), L.hgetallJson(K.players)]);
        const counts = q.choices.map(() => 0);
        const gains = {};
        const writes = [];
        for (const [pid, a] of Object.entries(answers)) {
          if (a.choice >= 0 && a.choice < counts.length) counts[a.choice]++;
          const p = players[pid];
          if (!p) continue;
          let pts = 0;
          if (a.choice === q.answer) {
            const ratio = Math.min(1, a.ms / (q.time * 1000));
            pts = Math.round(1000 * (1 - ratio / 2)); // 1000 si instantané, 500 au gong
          }
          gains[p.pub] = pts;
          p.score = (p.score || 0) + pts;
          p.played = (p.played || 0) + 1;
          writes.push(pid, JSON.stringify(p));
        }
        // tous les scores en une seule écriture (rapide même avec 70 joueurs)
        if (writes.length) await L.redis(["HSET", K.players].concat(writes));
        Object.assign(state, { counts, gains, scoring: false });
        break;
      }

      case "board":
        Object.assign(state, { phase: "board" });
        break;

      case "podium":
        Object.assign(state, { phase: "podium", done: true });
        break;

      case "off":
        Object.assign(state, { phase: "off" });
        break;

      case "reset": {
        for (let r = 1; r <= (state.round || 0); r++) await L.redis(["DEL", K.answers(r)]);
        await L.redis(["DEL", K.players]);
        await L.redis(["DEL", K.locks]);
        Object.assign(state, { phase: "off", index: -1, round: 0, counts: null, gains: null, done: false });
        break;
      }

      default:
        throw new L.HttpError(400, "Action inconnue.");
    }
    state.by = me.name;
    await setJson(K.state, state);
    return L.send(res, 200, { state });
  }

  L.send(res, 405, { error: "Méthode non autorisée." });
});
