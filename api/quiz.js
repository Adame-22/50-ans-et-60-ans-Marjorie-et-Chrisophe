/*
 * /api/quiz — quiz en direct façon Kahoot
 *
 * Public :
 *   GET  ?view=public                      → état du quiz (mis en cache 1 s par le CDN de Vercel,
 *                                            donc ~1 calcul/s quel que soit le nombre de joueurs)
 *   POST { action: "join", name, rid?, table? } → { pid, pub }   (rid : invité, table : sa table, pour le jeu par équipe)
 *   POST { action: "link", pid, rid?, table? }  → rattache un joueur à sa table / son équipe
 *   POST { action: "answer", pid, choice }      → enregistre la réponse (une seule par question)
 *   POST { action: "answer", pid, text }        → réponse tapée (questions « à taper » : blind test)
 *
 * Question « à taper » (mode: "type") : pendant hintAt secondes, les joueurs tapent leur réponse
 * (jusqu'à 1000 points, correction tolérante) ; ensuite les 4 choix apparaissent (400 points au plus).
 * À la révélation, l'écran montre quelques réponses fausses tapées (« réponses drôles », filtrées).
 *
 * Quand l'équipage active « classement par équipe » (onglet Équipes), l'état public
 * contient aussi teams (moyenne des points par équipe) et teamOf (joueur → équipe).
 *
 * Équipage (connecté) :
 *   GET  ?view=admin                       → questions complètes + réponses reçues + jeux enregistrés
 *   GET  ?view=music&q=…                   → recherche d'extraits (30 s, catalogue iTunes, gratuit)
 *   PUT  { questions: [...] }              → remplace les questions (et les garde dans le jeu en cours)
 *   POST { action: "game", name, create? } → change de jeu (ex. « Quiz de bord » → « Blind test ») :
 *        les joueurs restent connectés, les scores repartent de zéro
 *   POST { action: "game-delete", name }
 *   POST { action: "lobby" | "start" | "reveal" | "board" | "podium" | "off" | "reset", from? }
 *        from = { phase, round, index } vu par l'animateur : si le quiz a déjà avancé (deux animateurs,
 *        double appui, réseau qui renvoie), l'action est refusée au lieu de sauter une question.
 *
 * Répétition privée (super admin et comptes autorisés, invisible pour les invités) :
 *   même API avec ?test=1 / { test: true } côté équipage, et ?test=<code> / { test: "<code>" } côté joueurs
 *   et écran géant (lien secret /quiz?test=<code>, /ecran?test=<code>). Joueurs, scores et état séparés ;
 *   les questions sont celles du jeu choisi (modifiables pendant la répétition).
 *   POST { action: "test-open", game?, test: true } → ouvre une répétition (nouveau code)
 *   POST { action: "test-close", test: true }       → la termine (le lien ne marche plus)
 */
const crypto = require("crypto");
const L = require("./_lib");
const TM = require("./_teams");
const TY = require("./_typed");

function keysFor(test) {
  const p = test ? "mc:quiz:test:" : "mc:quiz:";
  return {
    test: !!test,
    questions: p + "questions",
    state: p + "state",
    players: p + "players",
    answers: (round) => p + "ans:" + round,
    locks: p + "locks", // une seule révélation / un seul lancement par manche
    games: "mc:quiz:games", // jeux enregistrés : nom → { questions } (communs à la soirée et aux répétitions)
  };
}
const REAL = keysFor(false);
const TEST = keysFor(true);
const TEST_META = "mc:quiz:test:meta"; // { code, game, by, openedAt }
const DEFAULT_GAME = "Quiz de bord";
const MAX_GAMES = 8;

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

async function getState(K) {
  return getJson(K.state, { phase: "off", index: -1, round: 0 });
}
// questions d'un jeu : celles en cours pour le jeu chargé, sinon celles enregistrées
async function gameQuestions(name) {
  const real = await getState(REAL);
  if (name === (real.game || DEFAULT_GAME)) return getJson(REAL.questions, DEFAULT_QUESTIONS);
  const raw = await L.redis(["HGET", REAL.games, name]);
  return raw ? JSON.parse(raw).questions || [] : null;
}
async function getQuestions(K) {
  if (!K.test) return getJson(REAL.questions, DEFAULT_QUESTIONS);
  const meta = await getJson(TEST_META, null);
  return (meta && (await gameQuestions(meta.game))) || [];
}
// lien de répétition : un code faux ou périmé ne donne accès à rien
async function testGate(code) {
  const meta = await getJson(TEST_META, null);
  if (!meta || !code || String(code) !== meta.code) throw new L.HttpError(404, "Cette répétition est terminée (ou le lien n'est pas le bon).");
  return meta;
}
// qui peut faire des répétitions (affiché dans la régie)
async function testers() {
  return Object.values(await L.hgetallJson(L.K.users)).filter((u) => L.canTestQuiz(u)).map((u) => u.name).sort((a, b) => a.localeCompare(b, "fr"));
}
async function wipe(K, state) {
  for (let r = 1; r <= (state.round || 0); r++) await L.redis(["DEL", K.answers(r)]);
  await L.redis(["DEL", K.players]);
  await L.redis(["DEL", K.locks]);
}

async function allPlayers(K) {
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

// Extrait musical : aperçu de 30 s servi par Apple (lien direct, rien n'est stocké chez nous)
function sanitizeAudio(a) {
  if (!a || typeof a !== "object") return null;
  const url = L.str(a.url, 500);
  if (!/^https:\/\/[a-z0-9.-]+\.(apple\.com|mzstatic\.com)\//i.test(url)) return null;
  const cover = L.str(a.cover, 500);
  return {
    url,
    start: Math.min(25, Math.max(0, Math.round(Number(a.start) || 0))),
    title: L.str(a.title, 120), artist: L.str(a.artist, 120), year: L.str(a.year, 4),
    cover: /^https:\/\/[a-z0-9.-]+\.mzstatic\.com\//i.test(cover) ? cover : "",
  };
}

function sanitizeQuestions(list) {
  if (!Array.isArray(list) || list.length > 60) throw new L.HttpError(400, "Liste de questions invalide.");
  return list.map((x) => {
    const choices = (Array.isArray(x.choices) ? x.choices : []).map((c) => L.str(c, 80)).filter(Boolean).slice(0, 4);
    if (choices.length < 2) throw new L.HttpError(400, "Chaque question doit avoir au moins 2 réponses.");
    const answer = Math.min(choices.length - 1, Math.max(0, parseInt(x.answer, 10) || 0));
    const out = { q: L.str(x.q, 200) || "Question", choices, answer, time: Math.min(60, Math.max(5, parseInt(x.time, 10) || 20)) };
    if (x.mode === "type") {
      out.mode = "type";
      out.time = Math.max(out.time, 12);
      out.hintAt = Math.min(out.time - 4, Math.max(3, parseInt(x.hintAt, 10) || 10));
      out.accept = (Array.isArray(x.accept) ? x.accept : String(x.accept || "").split(/[,;\n]/)).map((a) => L.str(a, 80)).filter(Boolean).slice(0, 10);
    }
    const audio = sanitizeAudio(x.audio);
    if (audio) out.audio = audio;
    return out;
  });
}

async function testGames(game, questions) {
  const real = await getState(REAL);
  return (await gameList(real, await getQuestions(REAL))).map((g) => Object.assign(g, { current: g.name === game },
    g.name === game ? { count: questions.length, music: questions.filter((q) => q.audio).length } : {}));
}

async function gameList(state, questions) {
  const all = await L.hgetallJson(REAL.games);
  const cur = state.game || DEFAULT_GAME;
  all[cur] = { questions };
  return Object.keys(all).sort((a, b) => (b === cur) - (a === cur) || a.localeCompare(b, "fr")).map((name) => {
    const qs = all[name].questions || [];
    return { name, count: qs.length, music: qs.filter((q) => q.audio).length, current: name === cur };
  });
}

// Recherche d'extraits dans le catalogue iTunes (gratuit, sans clé)
async function searchMusic(term) {
  const url = "https://itunes.apple.com/search?" + new URLSearchParams({ term, country: "FR", media: "music", entity: "song", limit: "25" });
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 7000);
  let d;
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { accept: "application/json" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    d = await r.json();
  } catch (e) {
    throw new L.HttpError(502, "La recherche de musique ne répond pas, réessayez dans un instant.");
  } finally { clearTimeout(t); }
  const seen = new Set();
  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\(.*?\)|\[.*?\]|- (remaster|live|version).*$/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  return (d.results || []).filter((r) => r.previewUrl && r.trackName).map((r) => ({
    title: r.trackName, artist: r.artistName, year: String(r.releaseDate || "").slice(0, 4), album: r.collectionName || "",
    url: r.previewUrl, cover: String(r.artworkUrl100 || "").replace(/\/\d+x\d+bb\./, "/600x600bb."),
  })).filter((r) => { const k = norm(r.title) + "|" + norm(r.artist); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 12);
}

module.exports = L.handler(async (req, res) => {
  const now = Date.now(); // pris tout de suite : la lenteur de la base ne doit pas coûter de points
  const params = L.query(req);

  /* ───────── Lecture ───────── */
  if (req.method === "GET") {
    const view = params.get("view") || "public";
    let K = REAL, meta = null;
    if (view === "admin" && params.get("test")) {
      const me = await L.requireUser(req);
      L.noSpoil(me);
      if (!L.canTestQuiz(me)) throw new L.HttpError(403, "Les répétitions sont réservées aux comptes autorisés par le super admin.");
      K = TEST;
      meta = await getJson(TEST_META, null);
      if (!meta) {
        const real = await getState(REAL);
        return L.send(res, 200, { test: null, testers: await testers(), games: await gameList(real, await getQuestions(REAL)), serverNow: Date.now() });
      }
    } else if (view !== "admin" && view !== "music" && params.get("test")) {
      meta = await testGate(params.get("test"));
      K = TEST;
    }
    const [state, questions] = await Promise.all([getState(K), getQuestions(K)]);
    const cur = questions[state.index];

    if (view === "admin") {
      if (!K.test) L.noSpoil(await L.requireUser(req)); // questions et réponses : surprise pour les fêtés
      const answered = state.round ? await L.redis(["HLEN", K.answers(state.round)]) : 0;
      const all = await allPlayers(K);
      const tq = K.test ? null : await TM.quizTeams(all);
      // le top 10 (et les équipes si le jeu est par équipe) pour que l'animateur annonce les bons gagnants
      return L.send(res, 200, { state, questions, answered, players: all.length, top: leaderboard(all).slice(0, 10),
        teams: tq ? tq.teams.slice(0, 10) : null, serverNow: Date.now(),
        games: K.test ? await testGames(meta.game, questions) : await gameList(state, questions),
        test: K.test ? { code: meta.code, game: meta.game, by: meta.by, openedAt: meta.openedAt } : undefined,
        testers: K.test ? await testers() : undefined });
    }

    if (view === "music") {
      L.noSpoil(await L.requireUser(req));
      await L.rateLimit(req, "quiz-music", 60, 60);
      const term = L.str(params.get("q"), 100);
      if (term.length < 2) throw new L.HttpError(400, "Tapez au moins 2 lettres.");
      return L.send(res, 200, { results: await searchMusic(term) });
    }

    const out = { phase: state.phase, index: state.index, total: questions.length, serverNow: Date.now() };
    if (K.test) out.test = true;
    if (cur && ["question", "reveal", "board"].includes(state.phase)) {
      out.question = { q: cur.q, choices: cur.choices, time: cur.time };
      if (cur.mode === "type") {
        const hintTs = state.startedAt + cur.hintAt * 1000;
        Object.assign(out.question, { mode: "type", hintAt: hintTs, n: cur.choices.length });
        if (state.phase === "question" && now < hintTs) out.question.choices = null; // les choix n'arrivent qu'après le temps de saisie
      }
      // l'écran géant joue l'extrait ; le titre n'est donné qu'à la révélation
      if (cur.audio) out.question.audio = state.phase === "question" ? { url: cur.audio.url, start: cur.audio.start } : cur.audio;
      out.round = state.round;
      out.startedAt = state.startedAt;
      out.endsAt = state.endsAt;
    }
    if (state.phase === "question") out.answered = await L.redis(["HLEN", K.answers(state.round)]);
    out.done = !!state.done;
    out.game = state.game || DEFAULT_GAME;
    // l'écran géant charge à l'avance l'extrait de la question suivante
    const next = ["lobby", "reveal", "board"].includes(state.phase) ? questions[state.index + 1] : null;
    if (next && next.audio) out.preload = next.audio.url;
    if (["reveal", "board"].includes(state.phase)) {
      out.correct = cur ? cur.answer : null;
      out.counts = state.counts || [];
      out.answered = (state.counts || []).reduce((a, b) => a + b, 0) + (state.typed ? state.typed.ok + state.typed.ko : 0);
      if (state.typed) { out.typed = state.typed; out.funnies = state.showFunny === false ? [] : state.funnies || []; }
      out.gains = state.gains || {};
      out.scoring = !!state.scoring; // points en cours de calcul (moins d'une seconde)
    }
    if (["lobby", "reveal", "board", "podium"].includes(state.phase)) {
      const players = await allPlayers(K);
      out.leaderboard = leaderboard(players);
      const tq = state.phase !== "off" && !K.test ? await TM.quizTeams(players) : null;
      if (tq) Object.assign(out, { teamMode: true, teams: tq.teams, teamOf: tq.teamOf, teamTables: tq.mode === "mix" ? [] : tq.tables });
    } else {
      out.players = await L.redis(["HLEN", K.players]);
    }
    // la répétition n'est pas mise en cache : le lien s'arrête dès qu'on la termine
    return L.send(res, 200, out, { "Cache-Control": K.test ? "no-store" : "public, max-age=0, s-maxage=1, stale-while-revalidate=1" });
  }

  const body = await L.readBody(req);
  const isPlayer = req.method === "POST" && ["join", "link", "answer"].includes(body.action);
  let K = REAL;
  if (isPlayer && body.test) { await testGate(body.test); K = TEST; }

  /* ───────── Joueurs ───────── */
  if (req.method === "POST" && body.action === "join") {
    const state = await getState(K);
    if (state.phase === "off") throw new L.HttpError(409, "Le quiz n'a pas encore commencé.");
    const name = L.str(body.name, 24);
    if (!name) throw new L.HttpError(400, "Choisissez un pseudo.");
    await L.rateLimit(req, "quiz-join", 200, 60);
    const players = await allPlayers(K);
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
    const [state, questions, player] = await Promise.all([getState(K), getQuestions(K), L.redis(["HGET", K.players, pid])]);
    if (!player) throw new L.HttpError(404, "Joueur inconnu, rejoignez à nouveau le quiz.");
    if (state.phase !== "question") throw new L.HttpError(409, "Les réponses sont fermées.");
    if (now < state.startedAt - 250) throw new L.HttpError(409, "Pas encore : attendez le top départ !");
    if (now > state.endsAt + 1500) throw new L.HttpError(409, "Trop tard !");
    const cur = questions[state.index];
    if (!cur) throw new L.HttpError(400, "Réponse invalide.");
    const typing = cur.mode === "type";
    let rec;
    if (body.text !== undefined) {
      const text = L.str(body.text, 60);
      if (!typing) throw new L.HttpError(400, "Réponse invalide.");
      if (!text) throw new L.HttpError(400, "Tapez une réponse.");
      rec = { text };
    } else {
      const choice = parseInt(body.choice, 10);
      if (!(choice >= 0 && choice < cur.choices.length)) throw new L.HttpError(400, "Réponse invalide.");
      if (typing && now < state.startedAt + cur.hintAt * 1000 - 400) throw new L.HttpError(409, "Les choix ne sont pas encore affichés : tapez votre réponse ou patientez.");
      rec = { choice };
    }
    // Rapidité : le téléphone dit depuis quand il affiche la question (il la reçoit 1 à 4 s après le lancement) ;
    // on ne lui accorde pas plus de 2,5 s d'avance sur l'heure du serveur.
    const serverMs = Math.max(0, now - state.startedAt);
    const clientMs = Number(body.elapsed);
    const ms = Number.isFinite(clientMs) ? Math.round(Math.min(serverMs, Math.max(serverMs - 2500, clientMs))) : serverMs;
    rec.ms = ms;
    const ok = await L.redis(["HSETNX", K.answers(state.round), pid, JSON.stringify(rec)]);
    if (!ok) {
      const prev = JSON.parse((await L.redis(["HGET", K.answers(state.round), pid])) || "{}");
      return L.send(res, 200, { ok: true, already: true, choice: prev.choice, text: prev.text, round: state.round });
    }
    return L.send(res, 200, { ok: true, choice: rec.choice, text: rec.text, round: state.round });
  }

  /* ───────── Animateur ───────── */
  const me = await L.requireUser(req);
  L.noSpoil(me);
  if (body.test) {
    if (!L.canTestQuiz(me)) throw new L.HttpError(403, "Les répétitions sont réservées aux comptes autorisés par le super admin.");
    K = TEST;
  }

  if (req.method === "PUT") {
    const questions = sanitizeQuestions(body.questions);
    const real = await getState(REAL);
    // en répétition, on modifie le jeu en cours de test (qui n'est pas forcément celui de la soirée)
    const meta = K.test ? await getJson(TEST_META, null) : null;
    if (K.test && !meta) throw new L.HttpError(409, "Aucune répétition en cours.");
    const name = meta ? meta.game : real.game || DEFAULT_GAME;
    if (name === (real.game || DEFAULT_GAME)) await setJson(REAL.questions, questions);
    await L.redis(["HSET", REAL.games, name, JSON.stringify({ questions })]);
    return L.send(res, 200, { questions });
  }

  if (req.method === "POST" && K.test && (body.action === "test-open" || body.action === "test-close")) {
    const state = await getState(TEST);
    await wipe(TEST, state);
    if (body.action === "test-close") {
      await L.redis(["DEL", TEST_META]);
      await L.redis(["DEL", TEST.state]);
      return L.send(res, 200, { test: null });
    }
    const real = await getState(REAL);
    const game = L.str(body.game, 40) || real.game || DEFAULT_GAME;
    if (!(await gameQuestions(game))) throw new L.HttpError(404, "Jeu introuvable.");
    const meta = { code: crypto.randomBytes(5).toString("hex"), game, by: me.name, openedAt: now };
    await setJson(TEST_META, meta);
    const fresh = { phase: "lobby", index: -1, round: 0, game, by: me.name, done: false };
    await setJson(TEST.state, fresh);
    return L.send(res, 200, { test: meta, state: fresh });
  }

  if (req.method === "POST") {
    const state = await getState(K);
    const questions = await getQuestions(K);
    const testMeta = K.test ? await getJson(TEST_META, null) : null;
    if (K.test && !testMeta) throw new L.HttpError(409, "Aucune répétition en cours : ouvrez-en une.");
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
          startedAt: now + 3000, endsAt: now + 3000 + q.time * 1000, counts: null, gains: null, typed: null, funnies: null,
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
        const typing = q.mode === "type", T = q.time * 1000, H = typing ? q.hintAt * 1000 : 0;
        const targets = [q.choices[q.answer]].concat(q.accept || []);
        const typed = { ok: 0, ko: 0 }, wrong = [];
        for (const [pid, a] of Object.entries(answers)) {
          const p = players[pid];
          let good;
          if (a.text !== undefined) {
            good = TY.isRight(a.text, targets);
            if (good) typed.ok++; else { typed.ko++; if (p) wrong.push({ name: p.name, text: a.text }); }
          } else {
            if (a.choice >= 0 && a.choice < counts.length) counts[a.choice]++;
            good = a.choice === q.answer;
          }
          if (!p) continue;
          let pts = 0;
          if (good && !typing) {
            const ratio = Math.min(1, a.ms / T);
            pts = Math.round(1000 * (1 - ratio / 2)); // 1000 si instantané, 500 au gong
          } else if (good && a.text !== undefined && a.ms <= H) {
            pts = Math.round(1000 * (1 - Math.min(1, a.ms / H) / 2)); // trouvé au clavier : 1000 → 500
          } else if (good) {
            pts = Math.round(400 * (1 - Math.min(1, Math.max(0, a.ms - H) / Math.max(1, T - H)) / 2)); // avec les choix : 400 → 200
          }
          gains[p.pub] = pts;
          p.score = (p.score || 0) + pts;
          p.played = (p.played || 0) + 1;
          writes.push(pid, JSON.stringify(p));
        }
        // tous les scores en une seule écriture (rapide même avec 70 joueurs)
        if (writes.length) await L.redis(["HSET", K.players].concat(writes));
        Object.assign(state, { counts, gains, scoring: false, typed: typing ? typed : null, funnies: typing ? TY.funny(wrong, 4) : null });
        break;
      }

      case "board":
        Object.assign(state, { phase: "board" });
        break;

      case "funny": // afficher ou non les réponses drôles sur l'écran géant
        state.showFunny = !!body.on;
        break;

      case "podium":
        Object.assign(state, { phase: "podium", done: true });
        break;

      case "off":
        Object.assign(state, { phase: "off" });
        break;

      case "game": { // changer de jeu : les joueurs restent, les scores repartent de zéro
        const name = L.str(body.name, 40);
        if (!name) throw new L.HttpError(400, "Donnez un nom au jeu.");
        if (["question", "reveal"].includes(state.phase) || (state.phase === "board" && !state.done)) {
          throw new L.HttpError(409, "Une partie est en cours : terminez-la (podium) ou fermez le quiz avant de changer de jeu.");
        }
        if (K.test) { // en répétition : on teste un autre jeu, la soirée n'est pas touchée
          if (body.create || !(await gameQuestions(name))) throw new L.HttpError(404, "Jeu introuvable.");
          testMeta.game = name;
          await setJson(TEST_META, testMeta);
          await wipe(TEST, state);
          Object.assign(state, { game: name, phase: "lobby", index: -1, round: 0, counts: null, gains: null, done: false });
          break;
        }
        const cur = state.game || DEFAULT_GAME;
        const games = await L.hgetallJson(REAL.games);
        let next;
        if (body.create) {
          if (games[name] || name === cur) throw new L.HttpError(409, "Un jeu porte déjà ce nom.");
          if (Object.keys(games).length + (games[cur] ? 0 : 1) >= MAX_GAMES) throw new L.HttpError(409, "Il y a déjà " + MAX_GAMES + " jeux : supprimez-en un.");
          next = [];
        } else {
          if (name === cur) throw new L.HttpError(409, "Ce jeu est déjà chargé.");
          if (!games[name]) throw new L.HttpError(404, "Jeu introuvable.");
          next = games[name].questions || [];
        }
        await L.redis(["HSET", REAL.games, cur, JSON.stringify({ questions }), name, JSON.stringify({ questions: next })]);
        await setJson(REAL.questions, next);
        // scores à zéro, joueurs gardés (ils n'ont pas à se réinscrire)
        const players = await L.hgetallJson(K.players);
        const writes = [];
        for (const [pid, p] of Object.entries(players)) { p.score = 0; p.played = 0; writes.push(pid, JSON.stringify(p)); }
        if (writes.length) await L.redis(["HSET", K.players].concat(writes));
        Object.assign(state, { game: name, phase: state.phase === "off" ? "off" : "lobby", index: -1, counts: null, gains: null, done: false });
        break;
      }

      case "game-delete": {
        const name = L.str(body.name, 40);
        const real = K.test ? await getState(REAL) : state;
        if (name === (real.game || DEFAULT_GAME) || (testMeta && name === testMeta.game)) throw new L.HttpError(409, "On ne peut pas supprimer un jeu chargé.");
        await L.redis(["HDEL", REAL.games, name]);
        return L.send(res, 200, { ok: true });
      }

      case "reset": {
        await wipe(K, state);
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
