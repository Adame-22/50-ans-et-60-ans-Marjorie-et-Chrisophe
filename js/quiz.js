/* Quiz — page joueur (téléphone), façon Kahoot
   Robuste aux rechargements, à la veille et au réseau lent :
   - la réponse donnée est mémorisée (et le serveur la renvoie) ; le verdict vient des points calculés par le serveur ;
   - chaque requête a un délai maximum, l'envoi d'une réponse est réessayé ;
   - l'heure du serveur est estimée en écartant les réponses servies par le cache. */
(function () {
  "use strict";

  var SHAPES = ["▲", "◆", "●", "■"];
  var LETTERS = ["A", "B", "C", "D"];
  function badge(i) { return '<span class="shape" aria-hidden="true"><i>' + SHAPES[i] + "</i><b>" + LETTERS[i] + "</b></span>"; }
  var app = document.getElementById("app");
  var meTag = document.getElementById("q-me");
  // Répétition privée (lien /quiz?test=code) : joueurs à part, rien n'est mélangé avec la soirée
  var TEST = (new URLSearchParams(location.search).get("test") || "").replace(/[^a-z0-9]/gi, "").slice(0, 20);
  var SUFFIX = TEST ? "-test" : "";
  var me = load("mc-quiz" + SUFFIX);          // { pid, pub, name, at, rid, table }
  var mem = load("mc-quiz-mem" + SUFFIX) || { ans: {}, gains: {}, rank: {} }; // réponses, points et rangs par manche
  var state = null;                  // dernier état public reçu
  var offsets = [];                  // mesures « heure serveur − heure locale »
  var offset = 0;
  var viewKey = "";
  var timerRaf = 0, startTimer = 0;
  var celebrated = {};
  var shownAt = {};                  // manche → instant où les réponses sont apparues (pour la rapidité)
  var sending = false;

  function load(k) {
    try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; }
  }
  function store(k, v) {
    try { v ? localStorage.setItem(k, JSON.stringify(v)) : localStorage.removeItem(k); } catch (e) { /* ignoré */ }
  }
  function save(v) { store("mc-quiz" + SUFFIX, v); }
  function saveMem() { store("mc-quiz-mem" + SUFFIX, mem); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  // Requête avec délai maximum : une connexion qui traîne ne fige pas le jeu
  function request(url, opts, ms) {
    var ctl = window.AbortController ? new AbortController() : null;
    var t = ctl ? setTimeout(function () { ctl.abort(); }, ms || 5000) : 0;
    return fetch(url, Object.assign({}, opts || {}, ctl ? { signal: ctl.signal } : {})).then(function (r) {
      clearTimeout(t);
      return r.text().then(function (txt) {
        var d = {};
        try { d = JSON.parse(txt || "{}"); } catch (e) { d = {}; }
        if (!r.ok) { var e = new Error(d.error || "Le réseau fait des siennes, réessayez."); e.status = r.status; throw e; }
        d._age = parseFloat(r.headers.get("Age")) || 0;
        return d;
      });
    }, function (err) {
      clearTimeout(t);
      var e = new Error("Pas de réseau pour l'instant… réessayez.");
      e.network = true; e.cause = err;
      throw e;
    });
  }
  function post(body, ms) {
    if (TEST) body.test = TEST;
    return request("/api/quiz", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, ms);
  }
  function ord(n) { return n === 1 ? "1<sup>er</sup>" : n + "<sup>e</sup>"; }
  function fx(fn) { if (window.McFx) window.McFx[fn].apply(null, [].slice.call(arguments, 1)); }
  function buzz(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* ignoré */ } }
  function now() { return Date.now() + offset; }
  // une « manche » est identifiée par son numéro ET son heure de départ : une remise à zéro ne la confond pas
  function rk(s) { s = s || state; return s && s.round ? s.round + ":" + (s.startedAt || 0) : ""; }

  // L'écran reste allumé pendant le quiz (sinon le téléphone se met en veille entre deux questions)
  var lock = null;
  function keepAwake(on) {
    if (on && !lock && navigator.wakeLock && document.visibilityState === "visible") {
      navigator.wakeLock.request("screen").then(function (l) { lock = l; l.addEventListener("release", function () { lock = null; }); }).catch(function () {});
    } else if (!on && lock) { lock.release().catch(function () {}); lock = null; }
  }

  // l'invité s'est déjà signalé à sa table (page /table) : on s'en sert pour son équipe
  function seat() {
    var who = load("mc-me"), table = load("mc-table");
    var first = who && (who.prenom || String(who.nom || "").split(" ")[0]) || "";
    if (/^famille$/i.test(first)) first = "";
    return { rid: who && who.id || null, table: table && table.id || null, prenom: first };
  }

  function myRank() {
    if (!me || !state || !state.leaderboard) return null;
    var lb = state.leaderboard;
    for (var i = 0; i < lb.length; i++) {
      if (lb[i].pub === me.pub) {
        var ahead = null;
        for (var j = i - 1; j >= 0; j--) { if (lb[j].score > lb[i].score) { ahead = lb[j]; break; } }
        return { rank: lb[i].rank || i + 1, score: lb[i].score, total: lb.length, ahead: ahead };
      }
    }
    return null;
  }
  function myTeam() {
    if (!me || !state || !state.teamMode || !state.teamOf) return null;
    var id = state.teamOf[me.pub];
    if (!id) return null;
    for (var i = 0; i < state.teams.length; i++) {
      if (state.teams[i].id === id) return Object.assign({ rank: i + 1, of: state.teams.length }, state.teams[i]);
    }
    return null;
  }
  function teamChip(t) {
    return '<span class="team-chip" style="--team:' + esc(t.color) + '">Équipe ' + esc(t.name) + "</span>";
  }
  // Série de bonnes réponses : d'après les points gagnés aux manches précédentes
  function streak() {
    var rounds = Object.keys(mem.gains).sort(function (a, b) { return parseInt(b, 10) - parseInt(a, 10); });
    var n = 0;
    for (var i = 0; i < rounds.length; i++) { if (mem.gains[rounds[i]] > 0) n++; else break; }
    return n;
  }

  /* Rattache le joueur à sa table si elle est connue et n'a pas encore été transmise */
  var lastSync = 0;
  function syncSeat() {
    if (!me || Date.now() - lastSync < 10000) return;
    var s = seat();
    if ((s.rid && s.rid !== me.rid) || (s.table && s.table !== me.table)) {
      lastSync = Date.now();
      post({ action: "link", pid: me.pid, rid: s.rid, table: s.table }).then(function () {
        me.rid = s.rid; me.table = s.table; save(me);
      }).catch(function () { /* on réessaiera */ });
    }
  }
  function tablePicker(id) {
    if (!state || !state.teamMode || !state.teamTables || !state.teamTables.length) return "";
    return '<div class="field"><label for="' + id + '">Votre table (pour jouer en équipe)</label><select id="' + id + '"><option value="">Choisir ma table…</option>' +
      state.teamTables.map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.name) + "</option>"; }).join("") + "</select></div>";
  }

  /* ───────── Écrans ───────── */
  function renderJoin(msg) {
    var s = seat();
    app.innerHTML =
      '<h1 class="live__title fx-rise">Quiz de bord</h1>' +
      '<p class="live__sub fx-rise">Connaissez-vous vos commandants de bord&nbsp;?</p>' +
      '<form class="ticket fx-rise" id="join" novalidate>' +
      '<div class="ticket__head"><span>Vol MC 5060</span><span>Divertissement à bord</span></div>' +
      '<div class="ticket__body"><p class="ticket__title">Carte de joueur</p>' +
      '<div class="field"><label for="j-name">Votre prénom (ou surnom)</label>' +
      '<input id="j-name" maxlength="24" autocomplete="given-name" placeholder="Ex. Tonton Jacques" value="' + esc(s.prenom) + '" required /></div>' +
      (s.table ? "" : tablePicker("j-table")) +
      '<p class="form-error" role="alert"' + (msg ? "" : " hidden") + ">" + esc(msg || "") + "</p>" +
      '<button class="btn btn--gold btn--block" type="submit">Embarquer</button></div>' +
      '<div class="ticket__stub"><span>Porte <b>A50</b></span><span>Questions <b>' + (state && state.total ? state.total : "12") + '</b></span><span>Classe <b>Quiz</b></span></div></form>';
    var f = document.getElementById("join");
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = f.querySelector("#j-name").value.trim(), err = f.querySelector(".form-error");
      if (!name) { err.textContent = "Écrivez votre prénom pour jouer."; err.hidden = false; return; }
      f.querySelector("button").disabled = true;
      var st = seat(), pick = document.getElementById("j-table");
      var table = st.table || (pick && pick.value) || null;
      post({ action: "join", name: name, rid: st.rid, table: table }, 8000).then(function (d) {
        d.at = Date.now(); d.rid = st.rid; d.table = table;
        if (pick && pick.value) store("mc-table", { id: pick.value, name: pick.options[pick.selectedIndex].text, at: Date.now() });
        me = d; save(d); mem = { ans: {}, gains: {}, rank: {} }; saveMem(); viewKey = ""; render();
        fx("plane", { y: 0.7 });
      }).catch(function (x) {
        f.querySelector("button").disabled = false;
        err.textContent = x.message; err.hidden = false;
      });
    });
    setTimeout(function () { var i = document.getElementById("j-name"); if (i && !i.value) i.focus(); }, 50);
  }

  function renderWaiting(title, text, extra) {
    app.innerHTML = '<div class="live-card center fx-rise"><div class="pulse"></div>' +
      '<h2 class="result__title">' + title + "</h2><p class=\"muted\">" + text + "</p>" + (extra || "") + "</div>";
  }

  function renderLobby() {
    var t = myTeam(), extra = "";
    if (state.teamMode) {
      if (t) extra = '<p class="team-line">Vous jouez pour ' + teamChip(t) + "</p>";
      else if (state.teamTables && state.teamTables.length) {
        extra = '<div class="team-pick"><p class="muted">Ce soir, on joue aussi par équipe&nbsp;!</p>' + tablePicker("q-table") +
          '<button class="btn btn--gold btn--block" id="q-link" type="button">Rejoindre mon équipe</button></div>';
      } else extra = '<p class="muted team-line">Pour jouer avec votre équipe, signalez-vous à votre table&nbsp;: <a href="/table">À table&nbsp;!</a></p>';
    }
    var n = (state.leaderboard || []).length;
    app.innerHTML =
      '<div class="ticket fx-rise">' +
      '<div class="ticket__head"><span>Vol MC 5060</span><span class="ticket__live"><i></i>Embarquement</span></div>' +
      '<div class="ticket__body"><p class="ticket__label">Passager</p><p class="ticket__name">' + esc(me.name) + "</p>" +
      '<p class="ticket__text">Vous êtes à bord&nbsp;! Gardez cette page ouverte et les yeux sur l\'écran géant&nbsp;: les questions vont arriver.</p>' +
      (state.game && state.game !== "Quiz de bord" ? '<p class="ticket__text">Prochain jeu&nbsp;: <b>' + esc(state.game) + "</b>. Tout le monde repart de zéro point.</p>" : "") + extra + "</div>" +
      '<div class="ticket__stub"><span>Porte <b>A50</b></span><span>À bord <b>' + (n || 1) + '</b></span><span>Statut <b>Prêt</b></span></div></div>';
    var btn = document.getElementById("q-link");
    if (btn) btn.addEventListener("click", function () {
      var v = document.getElementById("q-table").value;
      if (!v) return;
      btn.disabled = true;
      post({ action: "link", pid: me.pid, table: v }).then(function () {
        me.table = v; save(me);
        var name = (state.teamTables.filter(function (x) { return x.id === v; })[0] || {}).name;
        store("mc-table", { id: v, name: name, at: Date.now() });
        btn.textContent = "C'est noté ✓";
      }).catch(function (err) { btn.disabled = false; btn.textContent = err.message; });
    });
  }

  // Avant le top départ : la question seule, avec « 3, 2, 1 »
  function renderCountdown() {
    var q = state.question;
    app.innerHTML =
      '<div class="q-meta"><span class="q-num">Question <b>' + (state.index + 1) + "</b> / " + state.total + "</span></div>" +
      '<p class="q-text fx-rise">' + esc(q.q) + "</p>" + (q.audio ? '<p class="q-music">🎵 Ouvrez grand les oreilles…</p>' : "") +
      '<div class="q-ready"><span id="q-count">3</span><p>Préparez-vous…</p></div>';
    clearTimeout(startTimer);
    (function tick() {
      var rest = state.startedAt - now();
      var el = document.getElementById("q-count");
      if (!el) return;
      if (rest <= 0) { viewKey = ""; render(); return; }
      el.textContent = Math.ceil(rest / 1000);
      startTimer = setTimeout(tick, Math.min(250, rest));
    })();
  }

  // Blind test : la musique passe sur l'écran géant, pas sur les téléphones
  function musicBanner(q) {
    return q.audio ? '<p class="q-music"><span class="q-eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>Écoutez l\'extrait sur l\'écran géant</p>' : "";
  }
  function songCard(q) {
    var a = q.audio;
    if (!a || !a.title) return "";
    return '<div class="q-song fx-rise">' + (a.cover ? '<img src="' + esc(a.cover) + '" alt="" loading="lazy" />' : "") +
      "<div><b>" + esc(a.title) + "</b><span>" + esc(a.artist) + (a.year ? " · " + esc(a.year) : "") + "</span></div></div>";
  }

  function renderQuestion() {
    var q = state.question, k = rk(), mine = mem.ans[k];
    if (mine !== undefined) return renderSent();
    if (!shownAt[k]) shownAt[k] = Date.now();
    document.body.classList.add("is-playing"); // les 4 cases occupent tout le bas de l'écran, sous le pouce
    app.innerHTML =
      '<div class="q-meta"><span class="q-num">Question <b>' + (state.index + 1) + "</b> / " + state.total + '</span><span id="q-left" class="q-left"></span></div>' +
      '<div class="q-timer" id="q-timer"><i id="q-bar"></i><span class="q-plane" aria-hidden="true"></span></div>' +
      '<p class="q-text q-text--small">' + esc(q.q) + "</p>" + musicBanner(q) +
      '<div class="choices choices--kahoot" id="choices">' +
      q.choices.map(function (c, i) {
        var len = c.length, size = len > 30 ? " is-xlong" : len > 16 ? " is-long" : "";
        return '<button class="choice-btn k' + i + size + '" data-i="' + i + '" style="animation-delay:' + (0.06 * i) + 's">' + badge(i) + '<span class="choice-btn__txt">' + esc(c).replace(/(\S)-(\S)/g, "$1&#8209;$2") + "</span></button>"; // « Jean-Jacques » ne se coupe pas au tiret
      }).join("") + "</div>" +
      '<p class="center q-status" id="q-status" role="status"></p>';

    document.getElementById("choices").addEventListener("click", function (e) {
      var b = e.target.closest(".choice-btn");
      if (!b || sending || mem.ans[rk()] !== undefined) return;
      choose(parseInt(b.getAttribute("data-i"), 10), b);
    });
    runTimer();
  }

  // Envoi de la réponse : deux nouveaux essais si le réseau flanche, sinon on rend la main au joueur
  function choose(i, btn) {
    var k = rk(), box = document.getElementById("choices"), status = document.getElementById("q-status");
    sending = true;
    box.classList.add("is-locked");
    btn.classList.add("is-picked");
    box.querySelectorAll("button").forEach(function (x) { x.disabled = true; });
    status.textContent = "Envoi…";
    buzz(25);
    var elapsed = Math.max(0, Date.now() - Math.max(shownAt[k] || Date.now(), state.startedAt - offset));
    (function attempt(n) {
      post({ action: "answer", pid: me.pid, choice: i, elapsed: elapsed }, 5000).then(function (d) {
        sending = false;
        mem.ans[k] = d.choice !== undefined ? d.choice : i; saveMem();
        viewKey = ""; render();
      }, function (err) {
        if (err.status === 404) { sending = false; me = null; save(null); viewKey = ""; render(); return; }
        if (err.network && n < 2) { status.textContent = "Réseau lent… nouvel essai"; return setTimeout(function () { attempt(n + 1); }, 700); }
        sending = false;
        if (err.status === 409) { status.textContent = err.message; return; } // trop tard / pas encore : la page se met à jour seule
        box.classList.remove("is-locked");
        btn.classList.remove("is-picked");
        box.querySelectorAll("button").forEach(function (x) { x.disabled = false; });
        status.textContent = "Réponse non envoyée : touchez à nouveau votre choix.";
      });
    })(0);
  }

  // Réponse envoyée : suspense jusqu'à la révélation
  function renderSent() {
    var q = state.question, mine = mem.ans[rk()];
    app.innerHTML =
      '<div class="q-meta"><span class="q-num">Question <b>' + (state.index + 1) + "</b> / " + state.total + '</span><span id="q-left" class="q-left"></span></div>' +
      '<div class="q-timer" id="q-timer"><i id="q-bar"></i><span class="q-plane" aria-hidden="true"></span></div>' +
      '<div class="sent k' + mine + ' fx-rise">' + badge(mine) + '<p class="sent__txt">' + esc(q.choices[mine]) + "</p></div>" +
      '<p class="sent__title">Réponse envoyée&nbsp;!</p>' + musicBanner(q) +
      '<p class="center muted" id="q-answered"></p>';
    updateAnswered();
    runTimer();
  }
  function updateAnswered() {
    var el = document.getElementById("q-answered");
    if (el && state.answered !== undefined) el.textContent = state.answered + (state.players ? " / " + state.players : "") + " ont répondu… suspense !";
  }

  function runTimer() {
    cancelAnimationFrame(timerRaf);
    var bar = document.getElementById("q-bar"), left = document.getElementById("q-left"), box = document.getElementById("q-timer");
    if (!bar || !state.endsAt) return;
    var total = state.question.time * 1000, lastSec = -1;
    (function frame() {
      var rest = Math.max(0, Math.min(total, state.endsAt - now()));
      var sec = Math.ceil(rest / 1000);
      bar.style.transform = "scaleX(" + Math.min(1, rest / total) + ")";
      box.style.setProperty("--p", Math.min(1, rest / total).toFixed(4));
      left.textContent = rest > 0 ? sec + " s" : "Temps écoulé";
      var hurry = rest > 0 && rest <= 5000;
      box.classList.toggle("is-hurry", hurry);
      left.classList.toggle("is-hurry", hurry);
      if (hurry && sec !== lastSec) { lastSec = sec; left.classList.remove("tick"); void left.offsetWidth; left.classList.add("tick"); }
      if (rest <= 0 && mem.ans[rk()] === undefined && !sending) {
        var s = document.getElementById("q-status"); if (s) s.textContent = "Temps écoulé… la réponse arrive.";
        var c = document.getElementById("choices"); if (c) { c.classList.add("is-locked"); c.querySelectorAll("button").forEach(function (x) { x.disabled = true; }); }
      }
      if (rest > 0) timerRaf = requestAnimationFrame(frame);
    })();
  }

  function renderReveal() {
    var q = state.question, k = rk();
    if (state.scoring) return renderWaiting("Calcul des points…", "Encore une seconde de suspense.");
    var answered = !!(state.gains && me && Object.prototype.hasOwnProperty.call(state.gains, me.pub));
    var gain = answered ? state.gains[me.pub] : 0, ok = gain > 0;
    var mine = mem.ans[k];
    // 0 point (ou pas de réponse) casse la série
    if (mem.gains[state.round] === undefined) { mem.gains[state.round] = gain; saveMem(); }
    var r = myRank(), t = myTeam(), s = streak();
    var prev = mem.rank[state.round - 1];
    var move = r && prev ? prev - r.rank : 0;
    app.innerHTML =
      '<div class="verdict-screen ' + (!answered ? "is-none" : ok ? "is-ok" : "is-ko") + ' fx-rise">' +
      '<div class="verdict-screen__icon" aria-hidden="true">' + (!answered ? "⏱" : ok ? "✓" : "✗") + "</div>" +
      '<p class="verdict-screen__title">' + (!answered ? "Pas de réponse" : ok ? "Bonne réponse&nbsp;!" : "Raté&nbsp;!") + "</p>" +
      '<p class="verdict-screen__pts">' + (ok ? "+" + gain + " points" : answered ? "C'était : " + esc(q.choices[state.correct]) : "La bonne réponse : " + esc(q.choices[state.correct])) + "</p>" +
      (ok && s >= 2 ? '<p class="verdict-screen__streak">🔥 ' + s + " bonnes réponses d'affilée&nbsp;!</p>" : "") +
      "</div>" + songCard(q) +
      (r ? '<div class="rankline"><span>' + ord(r.rank) + " sur " + r.total + (move > 0 ? ' <em class="up">▲ ' + move + "</em>" : move < 0 ? ' <em class="down">▼ ' + (-move) + "</em>" : "") + "</span><span><b>" + r.score + "</b> pts</span></div>" +
        (r.ahead ? '<p class="gap">à ' + (r.ahead.score - r.score) + " pts de " + esc(r.ahead.name) + "</p>" : r.rank === 1 && r.score > 0 ? '<p class="gap">Vous êtes en tête&nbsp;!</p>' : "") : "") +
      (t ? '<div class="rankline rankline--team" style="--team:' + esc(t.color) + '"><span>Équipe ' + esc(t.name) + " · " + ord(t.rank) + "</span><span>" + t.score + " pts</span></div>" : "") +
      (mine !== undefined && !answered ? '<p class="center muted">Votre réponse n\'est pas arrivée à temps.</p>' : "");
    if (r) { mem.rank[state.round] = r.rank; saveMem(); }
    var key = "r" + k;
    if (!celebrated[key]) {
      celebrated[key] = true;
      if (ok) { buzz([60, 40, 60]); fx("confetti", { x: 0.5, y: 0.25, count: 70, spread: 110, velocity: 9 }); } else if (answered) buzz(220);
    }
  }

  function renderBoard(final) {
    var r = myRank(), t = myTeam();
    var top = (state.leaderboard || []).slice(0, final ? 10 : 5);
    var teams = state.teamMode ? (state.teams || []) : [];
    var teamsHtml = teams.length ? '<div class="live-card fx-rise"><p class="live__tag" style="margin:0 0 .6rem">Classement des équipes</p><ol class="lb lb--teams">' +
      teams.slice(0, final ? 12 : 6).map(function (x) {
        return '<li class="' + (t && t.id === x.id ? "is-me" : "") + '" style="--team:' + esc(x.color) + '"><b><i class="dot"></i>' + esc(x.name) +
          ' <small>' + x.players + " joueur" + (x.players > 1 ? "s" : "") + "</small></b><span>" + x.score + "</span></li>";
      }).join("") + "</ol></div>" : "";
    var sub = r ? "Vous êtes <b>" + ord(r.rank) + "</b> sur " + r.total + " avec " + r.score + " pts" + (r.ahead && !final ? "<br><small>à " + (r.ahead.score - r.score) + " pts de " + esc(r.ahead.name) + "</small>" : "") : "&nbsp;";
    if (t) sub += "<br>" + teamChip(t) + " " + ord(t.rank) + " sur " + t.of;
    app.innerHTML =
      '<h1 class="live__title fx-rise">' + (final ? "Atterrissage&nbsp;!" : "Classement") + "</h1>" +
      '<p class="live__sub fx-rise">' + sub + "</p>" +
      (final && teams.length ? teamsHtml : "") +
      '<div class="live-card fx-rise"><p class="live__tag" style="margin:0 0 .6rem">' + (teams.length ? "Meilleurs joueurs" : "Top " + top.length) + '</p><ol class="lb">' + top.map(function (p, i) {
        return '<li class="' + (me && p.pub === me.pub ? "is-me " : "") + (i < 3 ? "is-top is-top" + (i + 1) : "") + '" style="animation-delay:' + (0.08 * i) + 's"><b>' + esc(p.name) + "</b><span>" + p.score + "</span></li>";
      }).join("") + "</ol></div>" +
      (!final && teams.length ? teamsHtml : "");
    if (final && !celebrated.podium && ((r && r.rank <= 3) || (t && t.rank === 1))) {
      celebrated.podium = true;
      fx("celebrate");
      buzz([80, 60, 80, 60, 200]);
    }
  }

  function render() {
    if (!state) return;
    // Quiz remis à zéro : le joueur mémorisé n'existe plus, on redemande un prénom
    if (me && state.phase === "lobby" && state.leaderboard && Date.now() - (me.at || 0) > 6000 && !state.leaderboard.some(function (p) { return p.pub === me.pub; })) {
      me = null; save(null); celebrated = {}; mem = { ans: {}, gains: {}, rank: {} }; saveMem();
    }
    meTag.textContent = me ? me.name : "";
    keepAwake(state.phase !== "off");
    var t = myTeam(), k = rk();
    // Pas encore inscrit : on ne redessine pas le formulaire pendant qu'il tape son prénom
    var key = !me ? (state.phase === "off" ? "off" : "join")
      : [state.phase, k, state.index, me.pid, mem.ans[k], t ? t.id : "", state.teamMode ? 1 : 0, state.scoring ? 1 : 0, state.done ? 1 : 0, state.game || ""].join("|");
    if (me && state.phase === "question" && state.startedAt && now() < state.startedAt) key += "|wait";
    if (me && (state.phase === "reveal" || state.phase === "board" || state.phase === "podium")) key += "|" + JSON.stringify(myRank()) + JSON.stringify(t) + (state.teams ? state.teams.length : 0);
    if (key === viewKey) {
      if (state.phase === "question") updateAnswered();
      return;
    }
    viewKey = key;
    cancelAnimationFrame(timerRaf);
    document.body.classList.remove("is-playing");
    clearTimeout(startTimer);

    if (state.phase === "off") {
      if (state.done && me) return renderWaiting("Merci d'avoir joué&nbsp;!", "Le quiz est terminé. Bon vol pour la suite de la soirée&nbsp;!");
      if (!me) return renderWaiting("Le quiz n'a pas commencé", "Gardez cette page ouverte&nbsp;: elle s'activera toute seule au décollage.");
      return renderWaiting("Vous êtes inscrit·e", "Le quiz est en pause. Gardez cette page ouverte.");
    }
    if (!me) return renderJoin();
    if (state.phase === "lobby") return renderLobby();
    if (state.phase === "question") return state.startedAt && now() < state.startedAt ? renderCountdown() : renderQuestion();
    if (state.phase === "reveal") return renderReveal();
    if (state.phase === "board") return renderBoard(false);
    if (state.phase === "podium") return renderBoard(true);
  }

  // Heure du serveur : une réponse servie par le cache est en retard, on garde donc la mesure la plus haute des dernières
  function clock(d) {
    if (!d.serverNow) return;
    offsets.push(d.serverNow + d._age * 1000 - Date.now());
    if (offsets.length > 8) offsets.shift();
    offset = Math.max.apply(null, offsets);
  }

  var pollTimer = 0;
  function poll() {
    clearTimeout(pollTimer);
    request("/api/quiz?view=public" + (TEST ? "&test=" + TEST : ""), null, 4000).then(function (d) {
      clock(d);
      state = d;
      if (state.teamMode) syncSeat();
      render();
    }).catch(function (err) {
      // répétition terminée (ou mauvais lien)
      if (TEST && err.status === 404) { viewKey = "test-end"; app.innerHTML = '<div class="live-card center"><p class="live__tag">🧪 Répétition</p><h2>Cette répétition est terminée</h2><p class="muted">Merci d\'avoir testé&nbsp;! Le vrai quiz aura lieu pendant la fête.</p></div>'; }
      /* sinon réseau capricieux : on réessaie au prochain tour */
    })
      .then(function () { pollTimer = setTimeout(poll, document.hidden ? 4000 : 1500); });
  }
  // retour sur la page (téléphone rallumé) : mise à jour immédiate
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") { lock = null; poll(); if (state) keepAwake(state.phase !== "off"); }
  });
  if (TEST) { document.body.classList.add("is-test"); if (meTag) meTag.insertAdjacentHTML("beforebegin", '<span class="live__tag live__tag--test">🧪 Répétition</span>'); }
  poll();
})();
