/* Quiz — page joueur (téléphone) */
(function () {
  "use strict";

  var SHAPES = ["▲", "◆", "●", "■"];
  var app = document.getElementById("app");
  var meTag = document.getElementById("q-me");
  var me = load();              // { pid, pub, name }
  var state = null;             // dernier état public reçu
  var offset = 0;               // horloge serveur - horloge locale
  var picked = {};              // round -> choix
  var viewKey = "";
  var timerRaf = 0;

  function load() {
    try { return JSON.parse(localStorage.getItem("mc-quiz") || "null"); } catch (e) { return null; }
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

  function myRank() {
    if (!me || !state || !state.leaderboard) return null;
    for (var i = 0; i < state.leaderboard.length; i++) {
      if (state.leaderboard[i].pub === me.pub) return { rank: i + 1, score: state.leaderboard[i].score, total: state.leaderboard.length };
    }
    return null;
  }

  /* ───────── Écrans ───────── */
  function renderJoin(msg) {
    app.innerHTML =
      '<h1 class="live__title">Quiz de bord</h1>' +
      '<p class="live__sub">Connaissez-vous vos commandants de bord&nbsp;?</p>' +
      '<form class="live-card" id="join" novalidate>' +
      '<div class="field"><label for="j-name">Votre pseudo</label>' +
      '<input id="j-name" maxlength="24" autocomplete="nickname" placeholder="Ex. Tonton Jacques" required /></div>' +
      '<p class="form-error" role="alert"' + (msg ? "" : " hidden") + ">" + esc(msg || "") + "</p>" +
      '<button class="btn btn--gold btn--block" type="submit">Embarquer</button></form>';
    var f = document.getElementById("join");
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = f.querySelector("input").value.trim();
      if (!name) return;
      f.querySelector("button").disabled = true;
      post({ action: "join", name: name }).then(function (d) {
        d.at = Date.now(); me = d; save(d); viewKey = ""; render();
      }).catch(function (err) {
        f.querySelector("button").disabled = false;
        var el = f.querySelector(".form-error"); el.textContent = err.message; el.hidden = false;
      });
    });
    setTimeout(function () { var i = document.getElementById("j-name"); if (i) i.focus(); }, 50);
  }

  function renderWaiting(title, text) {
    app.innerHTML = '<div class="live-card center"><div class="pulse"></div>' +
      '<h2 class="result__title">' + title + "</h2><p class=\"muted\">" + text + "</p></div>";
  }

  function renderQuestion() {
    var q = state.question;
    var mine = picked[state.round];
    app.innerHTML =
      '<div class="q-meta"><span>Question ' + (state.index + 1) + " / " + state.total + '</span><span id="q-left"></span></div>' +
      '<div class="q-timer"><i id="q-bar"></i></div>' +
      '<p class="q-text">' + esc(q.q) + "</p>" +
      '<div class="choices' + (mine !== undefined ? " is-locked" : "") + '" id="choices">' +
      q.choices.map(function (c, i) {
        return '<button class="choice-btn c' + i + (mine === i ? " is-picked" : "") + '" data-i="' + i + '"' + (mine !== undefined ? " disabled" : "") + '>' +
          '<span class="shape">' + SHAPES[i] + "</span><span>" + esc(c) + "</span></button>";
      }).join("") + "</div>" +
      '<p class="center muted" id="q-status" style="margin-top:1rem">' + (mine !== undefined ? "Réponse enregistrée ✓" : "") + "</p>";

    document.getElementById("choices").addEventListener("click", function (e) {
      var b = e.target.closest(".choice-btn");
      if (!b || picked[state.round] !== undefined) return;
      var i = parseInt(b.getAttribute("data-i"), 10);
      var round = state.round;
      picked[round] = i;
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
    var bar = document.getElementById("q-bar"), left = document.getElementById("q-left");
    if (!bar || !state.endsAt) return;
    var total = state.question.time * 1000;
    (function frame() {
      var rest = Math.max(0, state.endsAt - (Date.now() + offset));
      bar.style.transform = "scaleX(" + Math.min(1, rest / total) + ")";
      left.textContent = Math.ceil(rest / 1000) + " s";
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
    var r = myRank();
    app.innerHTML =
      '<div class="live-card"><div class="result">' +
      '<div class="result__icon">' + (mine === undefined ? "⏱" : ok ? "✈️" : "🌧") + "</div>" +
      '<p class="result__title">' + (mine === undefined ? "Pas de réponse" : ok ? "Bonne réponse !" : "Raté…") + "</p>" +
      '<p class="result__pts">' + (gain ? "+ " + gain + " pts" : "0 pt") + "</p></div>" +
      '<div class="choices is-revealed">' + q.choices.map(function (c, i) {
        return '<div class="choice-btn c' + i + (i === state.correct ? " is-correct" : "") + (i === mine ? " is-picked" : "") + '"><span class="shape">' + SHAPES[i] + "</span><span>" + esc(c) + "</span></div>";
      }).join("") + "</div>" +
      (r ? '<div class="rankline"><span>Rang ' + r.rank + " / " + r.total + "</span><span>" + r.score + " pts</span></div>" : "") +
      "</div>";
  }

  function renderBoard(final) {
    var r = myRank();
    var top = (state.leaderboard || []).slice(0, final ? 10 : 5);
    app.innerHTML =
      '<h1 class="live__title">' + (final ? "Atterrissage !" : "Classement") + "</h1>" +
      (r ? '<p class="live__sub">Vous êtes <b>' + (r.rank === 1 ? "1<sup>er</sup>" : r.rank + "<sup>e</sup>") + "</b> sur " + r.total + " avec " + r.score + " pts</p>" : '<p class="live__sub">&nbsp;</p>') +
      '<div class="live-card"><ol class="lb">' + top.map(function (p) {
        return '<li class="' + (me && p.pub === me.pub ? "is-me" : "") + '"><b>' + esc(p.name) + "</b><span>" + p.score + "</span></li>";
      }).join("") + "</ol></div>";
  }

  function render() {
    if (!state) return;
    // Quiz remis à zéro : le joueur mémorisé n'existe plus, on redemande un pseudo
    if (me && state.phase === "lobby" && state.leaderboard && Date.now() - (me.at || 0) > 6000 && !state.leaderboard.some(function (p) { return p.pub === me.pub; })) {
      me = null; save(null);
    }
    meTag.textContent = me ? me.name : "";
    var key = [state.phase, state.round, state.index, me ? me.pid : "-", picked[state.round]].join("|");
    if (state.phase === "reveal" || state.phase === "board" || state.phase === "podium") key += "|" + JSON.stringify(myRank());
    if (key === viewKey) return;
    viewKey = key;
    cancelAnimationFrame(timerRaf);

    if (state.phase === "off") {
      if (!me) return renderWaiting("Le quiz n'a pas commencé", "Gardez cette page ouverte : elle s'activera toute seule au décollage.");
      return renderWaiting("Vous êtes inscrit·e", "Le quiz n'a pas encore commencé.");
    }
    if (!me) return renderJoin();
    if (state.phase === "lobby") return renderWaiting("Vous êtes à bord, " + esc(me.name) + " !", "Le quiz va commencer. Regardez l'écran géant.");
    if (state.phase === "question") return renderQuestion();
    if (state.phase === "reveal") return renderReveal();
    if (state.phase === "board") return renderBoard(false);
    if (state.phase === "podium") return renderBoard(true);
  }

  function poll() {
    fetch("/api/quiz?view=public").then(function (r) { return r.json(); }).then(function (d) {
      if (d.serverNow) offset = d.serverNow - Date.now();
      state = d;
      render();
    }).catch(function () { /* réseau capricieux : on réessaie au prochain tour */ })
      .then(function () { setTimeout(poll, 1500); });
  }
  poll();
})();
