/* Quiz — page joueur (téléphone) */
(function () {
  "use strict";

  var SHAPES = ["▲", "◆", "●", "■"];
  var LETTERS = ["A", "B", "C", "D"];
  function badge(i) { return '<span class="shape" aria-hidden="true"><b>' + LETTERS[i] + "</b><i>" + SHAPES[i] + "</i></span>"; }
  var app = document.getElementById("app");
  var meTag = document.getElementById("q-me");
  var me = load("mc-quiz");     // { pid, pub, name, at, rid, table }
  var state = null;             // dernier état public reçu
  var offset = 0;               // horloge serveur - horloge locale
  var picked = {};              // round -> choix
  var viewKey = "";
  var timerRaf = 0;
  var celebrated = {};

  function load(k) {
    try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; }
  }
  function save(v) {
    try { v ? localStorage.setItem("mc-quiz", JSON.stringify(v)) : localStorage.removeItem("mc-quiz"); } catch (e) { /* ignoré */ }
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function post(body) {
    return fetch("/api/quiz", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (d) { if (!r.ok) { var e = new Error(d.error || "Erreur"); e.status = r.status; throw e; } return d; }); });
  }
  function ord(n) { return n === 1 ? "1<sup>er</sup>" : n + "<sup>e</sup>"; }
  function fx(fn) { if (window.McFx) window.McFx[fn].apply(null, [].slice.call(arguments, 1)); }

  // l'invité s'est déjà signalé à sa table (page /table) : on s'en sert pour son équipe
  function seat() {
    var who = load("mc-me"), table = load("mc-table");
    return { rid: who && who.id || null, table: table && table.id || null, nom: who && who.nom || "" };
  }

  function myRank() {
    if (!me || !state || !state.leaderboard) return null;
    for (var i = 0; i < state.leaderboard.length; i++) {
      if (state.leaderboard[i].pub === me.pub) return { rank: i + 1, score: state.leaderboard[i].score, total: state.leaderboard.length };
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

  /* ───────── Écrans ───────── */
  function renderJoin(msg) {
    var s = seat();
    app.innerHTML =
      '<h1 class="live__title fx-rise">Quiz de bord</h1>' +
      '<p class="live__sub fx-rise">Connaissez-vous vos commandants de bord&nbsp;?</p>' +
      '<form class="ticket fx-rise" id="join" novalidate>' +
      '<div class="ticket__head"><span>Vol MC 5060</span><span>Divertissement à bord</span></div>' +
      '<div class="ticket__body"><p class="ticket__title">Carte de joueur</p>' +
      '<div class="field"><label for="j-name">Nom du passager</label>' +
      '<input id="j-name" maxlength="24" autocomplete="nickname" placeholder="Ex. Tonton Jacques" value="' + esc(s.nom.split(" ")[0] || "") + '" required /></div>' +
      '<p class="form-error" role="alert"' + (msg ? "" : " hidden") + ">" + esc(msg || "") + "</p>" +
      '<button class="btn btn--gold btn--block" type="submit">Embarquer</button></div>' +
      '<div class="ticket__stub"><span>Porte <b>A50</b></span><span>Questions <b>' + (state && state.total ? state.total : "12") + '</b></span><span>Classe <b>Quiz</b></span></div></form>';
    var f = document.getElementById("join");
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = f.querySelector("input").value.trim();
      if (!name) return;
      f.querySelector("button").disabled = true;
      var st = seat();
      post({ action: "join", name: name, rid: st.rid, table: st.table }).then(function (d) {
        d.at = Date.now(); d.rid = st.rid; d.table = st.table;
        me = d; save(d); viewKey = ""; render();
        fx("plane", { y: 0.7 });
      }).catch(function (err) {
        f.querySelector("button").disabled = false;
        var el = f.querySelector(".form-error"); el.textContent = err.message; el.hidden = false;
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
      if (t) {
        extra = '<p class="team-line">Vous jouez pour ' + teamChip(t) + "</p>";
      } else if (state.teamTables && state.teamTables.length) {
        extra = '<div class="team-pick"><p class="muted">Ce soir, on joue aussi par équipe&nbsp;! À quelle table êtes-vous&nbsp;?</p>' +
          '<div class="field"><select id="q-table" aria-label="Votre table"><option value="">Choisir ma table…</option>' +
          state.teamTables.map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.name) + "</option>"; }).join("") +
          '</select></div><button class="btn btn--gold btn--block" id="q-link" type="button">Rejoindre mon équipe</button></div>';
      } else {
        extra = '<p class="muted team-line">Pour jouer avec votre équipe, signalez-vous à votre table&nbsp;: <a href="/table">À table&nbsp;!</a></p>';
      }
    }
    var n = (state.leaderboard || []).length;
    app.innerHTML =
      '<div class="ticket fx-rise">' +
      '<div class="ticket__head"><span>Vol MC 5060</span><span class="ticket__live"><i></i>Embarquement</span></div>' +
      '<div class="ticket__body"><p class="ticket__label">Passager</p><p class="ticket__name">' + esc(me.name) + "</p>" +
      '<p class="ticket__text">Vous êtes à bord&nbsp;! Le quiz va commencer&nbsp;: gardez les yeux sur l\'écran géant.</p>' + extra + "</div>" +
      '<div class="ticket__stub"><span>Porte <b>A50</b></span><span>À bord <b>' + (n || 1) + '</b></span><span>Statut <b>Prêt</b></span></div></div>';
    var btn = document.getElementById("q-link");
    if (btn) btn.addEventListener("click", function () {
      var v = document.getElementById("q-table").value;
      if (!v) return;
      btn.disabled = true;
      post({ action: "link", pid: me.pid, table: v }).then(function () {
        me.table = v; save(me);
        var name = (state.teamTables.filter(function (x) { return x.id === v; })[0] || {}).name;
        try { localStorage.setItem("mc-table", JSON.stringify({ id: v, name: name, at: Date.now() })); } catch (e) { /* ignoré */ }
        btn.textContent = "C'est noté ✓";
      }).catch(function (err) { btn.disabled = false; btn.textContent = err.message; });
    });
  }

  function renderQuestion() {
    var q = state.question;
    var mine = picked[state.round];
    app.innerHTML =
      '<div class="q-meta"><span class="q-num">Question <b>' + (state.index + 1) + "</b> / " + state.total + '</span><span id="q-left" class="q-left"></span></div>' +
      '<div class="q-timer" id="q-timer"><i id="q-bar"></i><span class="q-plane" aria-hidden="true"></span></div>' +
      '<p class="q-text fx-rise">' + esc(q.q) + "</p>" +
      '<div class="choices' + (mine !== undefined ? " is-locked" : "") + '" id="choices">' +
      q.choices.map(function (c, i) {
        return '<button class="choice-btn c' + i + (mine === i ? " is-picked" : "") + '" data-i="' + i + '"' + (mine !== undefined ? " disabled" : "") +
          ' style="animation-delay:' + (0.06 * i) + 's">' + badge(i) + '<span class="choice-btn__txt">' + esc(c) + "</span></button>";
      }).join("") + "</div>" +
      '<p class="center muted" id="q-status" style="margin-top:1rem">' + (mine !== undefined ? "Réponse enregistrée ✓" : "") + "</p>";

    document.getElementById("choices").addEventListener("click", function (e) {
      var b = e.target.closest(".choice-btn");
      if (!b || picked[state.round] !== undefined) return;
      var i = parseInt(b.getAttribute("data-i"), 10);
      picked[state.round] = i;
      b.classList.add("is-picked");
      this.classList.add("is-locked");
      this.querySelectorAll("button").forEach(function (x) { x.disabled = true; });
      document.getElementById("q-status").textContent = "Envoi…";
      if (navigator.vibrate) navigator.vibrate(30);
      post({ action: "answer", pid: me.pid, choice: i }).then(function () {
        var s = document.getElementById("q-status"); if (s) s.textContent = "Réponse enregistrée ✓";
      }).catch(function (err) {
        if (err.status === 404) { me = null; save(null); viewKey = ""; render(); return; }
        var s = document.getElementById("q-status"); if (s) s.textContent = err.message;
      });
    });
    runTimer();
  }

  function runTimer() {
    cancelAnimationFrame(timerRaf);
    var bar = document.getElementById("q-bar"), left = document.getElementById("q-left"), box = document.getElementById("q-timer");
    if (!bar || !state.endsAt) return;
    var total = state.question.time * 1000, lastSec = -1;
    (function frame() {
      var rest = Math.max(0, state.endsAt - (Date.now() + offset));
      var sec = Math.ceil(rest / 1000);
      bar.style.transform = "scaleX(" + Math.min(1, rest / total) + ")";
      box.style.setProperty("--p", Math.min(1, rest / total).toFixed(4));
      left.textContent = sec + " s";
      // cinq dernières secondes : la jauge s'emballe
      var hurry = rest > 0 && rest <= 5000;
      box.classList.toggle("is-hurry", hurry);
      left.classList.toggle("is-hurry", hurry);
      if (hurry && sec !== lastSec) {
        lastSec = sec;
        left.classList.remove("tick"); void left.offsetWidth; left.classList.add("tick");
      }
      if (rest <= 0 && picked[state.round] === undefined) {
        var s = document.getElementById("q-status"); if (s) s.textContent = "Temps écoulé…";
        var c = document.getElementById("choices"); if (c) { c.classList.add("is-locked"); c.querySelectorAll("button").forEach(function (x) { x.disabled = true; }); }
      }
      if (rest > 0) timerRaf = requestAnimationFrame(frame);
    })();
  }

  function renderReveal() {
    var q = state.question;
    var mine = picked[state.round];
    var ok = mine === state.correct;
    var gain = state.gains && me ? state.gains[me.pub] || 0 : 0;
    var r = myRank(), t = myTeam();
    app.innerHTML =
      '<div class="live-card"><div class="result ' + (mine === undefined ? "" : ok ? "is-ok" : "is-ko") + '">' +
      '<div class="verdict">' + (mine === undefined ? "Trop tard" : ok ? "Validé" : "Refusé") + "</div>" +
      '<p class="result__title">' + (mine === undefined ? "Pas de réponse" : ok ? "Bonne réponse&nbsp;!" : "Raté, ce sera pour la prochaine") + "</p>" +
      '<p class="result__pts"><b>' + (gain ? "+" + gain : "0") + "</b> point" + (gain > 1 ? "s" : "") + "</p></div>" +
      '<div class="choices is-revealed">' + q.choices.map(function (c, i) {
        return '<div class="choice-btn c' + i + (i === state.correct ? " is-correct" : "") + (i === mine ? " is-picked" : "") + '">' + badge(i) + '<span class="choice-btn__txt">' + esc(c) + "</span></div>";
      }).join("") + "</div>" +
      (r ? '<div class="rankline"><span>Rang <b>' + r.rank + "</b> / " + r.total + "</span><span><b>" + r.score + "</b> pts</span></div>" : "") +
      (t ? '<div class="rankline rankline--team" style="--team:' + esc(t.color) + '"><span>Équipe ' + esc(t.name) + " · " + ord(t.rank) + "</span><span>" + t.score + " pts</span></div>" : "") +
      "</div>";
    var k = "r" + state.round;
    if (ok && !celebrated[k]) { celebrated[k] = true; fx("confetti", { x: 0.5, y: 0.25, count: 70, spread: 110, velocity: 9 }); }
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
    var sub = r ? "Vous êtes <b>" + ord(r.rank) + "</b> sur " + r.total + " avec " + r.score + " pts" : "&nbsp;";
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
    }
  }

  function render() {
    if (!state) return;
    // Quiz remis à zéro : le joueur mémorisé n'existe plus, on redemande un pseudo
    if (me && state.phase === "lobby" && state.leaderboard && Date.now() - (me.at || 0) > 6000 && !state.leaderboard.some(function (p) { return p.pub === me.pub; })) {
      me = null; save(null); celebrated = {};
    }
    meTag.textContent = me ? me.name : "";
    var t = myTeam();
    var key = [state.phase, state.round, state.index, me ? me.pid : "-", picked[state.round], t ? t.id : "", state.teamMode ? 1 : 0].join("|");
    if (state.phase === "reveal" || state.phase === "board" || state.phase === "podium") key += "|" + JSON.stringify(myRank()) + JSON.stringify(t) + (state.teams ? state.teams.length : 0);
    if (key === viewKey) return;
    viewKey = key;
    cancelAnimationFrame(timerRaf);

    if (state.phase === "off") {
      if (!me) return renderWaiting("Le quiz n'a pas commencé", "Gardez cette page ouverte&nbsp;: elle s'activera toute seule au décollage.");
      return renderWaiting("Vous êtes inscrit·e", "Le quiz n'a pas encore commencé.");
    }
    if (!me) return renderJoin();
    if (state.phase === "lobby") return renderLobby();
    if (state.phase === "question") return renderQuestion();
    if (state.phase === "reveal") return renderReveal();
    if (state.phase === "board") return renderBoard(false);
    if (state.phase === "podium") return renderBoard(true);
  }

  function poll() {
    fetch("/api/quiz?view=public").then(function (r) { return r.json(); }).then(function (d) {
      if (d.serverNow) offset = d.serverNow - Date.now();
      state = d;
      if (state.teamMode) syncSeat();
      render();
    }).catch(function () { /* réseau capricieux : on réessaie au prochain tour */ })
      .then(function () { setTimeout(poll, 1500); });
  }
  poll();
})();
