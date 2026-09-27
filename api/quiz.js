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
 *   POST { action: "lobby" | "start" | "reveal" | "board" | "podium" | "off" | "reset" }
 */
const crypto = require("crypto");
const L = require("./_lib");
const TM = require("./_teams");

const K = {
  questions: "mc:quiz:questions",
  state: "mc:quiz:state",
  players: "mc:quiz:players",
  answers: (round) => "mc:quiz:ans:" + round,
};

const DEFAULT_QUESTIONS = [
  { q: "En quelle année est née Marjorie ?", choices: ["1974", "1976", "1978", "1980"], answer: 1, time: 20 },
  { q: "Quel âge fête Christophe ?", choices: ["55 ans", "58 ans", "60 ans", "62 ans"], answer: 2, time: 15 },
  { q: "Quel est le numéro de vol de la fête ?", choices: ["AF 1976", "MC 5060", "CM 6050", "MC 2026"], answer: 1, time: 15 },
  { q: "Dans quelle ville se trouve le « terminal » de la fête ?", choices: ["Juvisy", "Évry", "Draveil", "Corbeil"], answer: 2, time: 15 },
  { q: "Combien d'heures de vol Christophe a-t-il (environ) ?", choices: ["52 600 h", "256 000 h", "525 600 h", "5 256 000 h"], answer: 2, time: 20 },
  { q: "Question à personnaliser : où Marjorie et Christophe se sont-ils rencontrés ?", choices: ["Réponse A", "Réponse B", "Réponse C", "Réponse D"], answer: 0, time: 20 },
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
  return players
    .map((p) => ({ pub: p.pub, name: p.name, score: p.score || 0 }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "fr"));
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
  const params = L.query(req);

  /* ───────── Lecture ───────── */
  if (req.method === "GET") {
    const view = params.get("view") || "public";
    const [state, questions] = await Promise.all([getState(), getQuestions()]);
    const cur = questions[state.index];

    if (view === "admin") {
      await L.requireUser(req);
      const answered = state.round ? await L.redis(["HLEN", K.answers(state.round)]) : 0;
      const players = await L.redis(["HLEN", K.players]);
      return L.send(res, 200, { state, questions, answered, players, serverNow: Date.now() });
    }

    const out = { phase: state.phase, index: state.index, total: questions.length, serverNow: Date.now() };
    if (cur && ["question", "reveal", "board"].includes(state.phase)) {
      out.question = { q: cur.q, choices: cur.choices, time: cur.time };
      out.round = state.round;
      out.endsAt = state.endsAt;
    }
    if (state.phase === "question") out.answered = await L.redis(["HLEN", K.answers(state.round)]);
    if (["reveal", "board"].includes(state.phase)) {
      out.correct = cur ? cur.answer : null;
      out.counts = state.counts || [];
      out.answered = (state.counts || []).reduce((a, b) => a + b, 0);
      out.gains = state.gains || {};
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
    const count = await L.redis(["HLEN", K.players]);
    if (count >= 300) throw new L.HttpError(409, "Le quiz est complet.");
    const pid = crypto.randomUUID();
    const pub = hash(pid);
    const link = { rid: L.str(body.rid, 64) || null, table: L.str(body.table, 20) || null };
    await L.redis(["HSET", K.players, pid, JSON.stringify(Object.assign({ pid, pub, name, score: 0, joinedAt: Date.now() }, link))]);
    return L.send(res, 201, { pid, pub, name });
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
    const [state, questions, player] = await Promise.all([getState(), getQuestions(), L.redis(["HGET", K.players, pid])]);
    if (!player) throw new L.HttpError(404, "Joueur inconnu, rejoignez à nouveau le quiz.");
    if (state.phase !== "question") throw new L.HttpError(409, "Les réponses sont fermées.");
    const now = Date.now();
    if (now > state.endsAt + 1500) throw new L.HttpError(409, "Trop tard !");
    const cur = questions[state.index];
    const choice = parseInt(body.choice, 10);
    if (!cur || !(choice >= 0 && choice < cur.choices.length)) throw new L.HttpError(400, "Réponse invalide.");
    const ok = await L.redis(["HSETNX", K.answers(state.round), pid, JSON.stringify({ choice, ms: Math.max(0, now - state.startedAt) })]);
    return L.send(res, 200, { ok: true, already: !ok });
  }

  /* ───────── Animateur ───────── */
  const me = await L.requireUser(req);

  if (req.method === "PUT") {
    const questions = sanitizeQuestions(body.questions);
    await setJson(K.questions, questions);
    return L.send(res, 200, { questions });
  }

  if (req.method === "POST") {
    const state = await getState();
    const questions = await getQuestions();
    const now = Date.now();

    switch (body.action) {
      case "lobby":
        Object.assign(state, { phase: "lobby" });
        break;

      case "start": { // question suivante (ou celle demandée)
        const index = body.index !== undefined ? parseInt(body.index, 10) : state.index + 1;
        const q = questions[index];
        if (!q) throw new L.HttpError(400, "Il n'y a plus de question.");
        Object.assign(state, {
          phase: "question", index, round: (state.round || 0) + 1,
          startedAt: now + 1200, endsAt: now + 1200 + q.time * 1000, counts: null, gains: null,
        });
        break;
      }

      case "reveal": {
        if (state.phase !== "question") throw new L.HttpError(409, "Aucune question en cours.");
        const q = questions[state.index];
        const answers = await L.hgetallJson(K.answers(state.round));
        const counts = q.choices.map(() => 0);
        const gains = {};
        const players = await L.hgetallJson(K.players);
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
          if (pts) {
            p.score = (p.score || 0) + pts;
            await L.redis(["HSET", K.players, pid, JSON.stringify(p)]);
          }
        }
        Object.assign(state, { phase: "reveal", counts, gains, endsAt: Math.min(state.endsAt, now) });
        break;
      }

      case "board":
        Object.assign(state, { phase: "board" });
        break;

      case "podium":
        Object.assign(state, { phase: "podium" });
        break;

      case "off":
        Object.assign(state, { phase: "off" });
        break;

      case "reset": {
        for (let r = 1; r <= (state.round || 0); r++) await L.redis(["DEL", K.answers(r)]);
        await L.redis(["DEL", K.players]);
        Object.assign(state, { phase: "off", index: -1, round: 0, counts: null, gains: null });
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
