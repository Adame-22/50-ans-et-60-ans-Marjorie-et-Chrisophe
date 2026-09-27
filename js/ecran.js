/*
 * Écran géant : diaporama de la soirée, qui bascule automatiquement sur le
 * quiz dès que l'animateur l'ouvre depuis l'espace admin.
 */
(function () {
  "use strict";

  var CFG = window.EVENT || {};
  var SHAPES = ["▲", "◆", "●", "■"];
  var stage = document.getElementById("stage");
  var quiz = null, offset = 0, quizKey = "", timerRaf = 0;
  var entries = [], songs = [], shown = {}, seating = null;
  var ROTATION = ["info", "tables", "entry", "entry", "radio", "entry", "tables", "entry"];
  var slideTimer = 0, slideIdx = 0, bnIdx = 0, inQuiz = false;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function qr(path) {
    var url = /^https?:/.test(path) ? path : location.origin + path;
    if (!window.qrcode) return '<div class="qr__code"></div>';
    var q = window.qrcode(0, "M");
    q.addData(url); q.make();
    return '<div class="qr__code">' + q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }) + "</div>";
  }
  function getJson(url) { return fetch(url).then(function (r) { return r.json(); }); }

  /* ───────── En-tête : horloge et étape en cours ───────── */
  function updateTop() {
    var d = new Date();
    document.getElementById("sc-clock").textContent = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    var st = window.McProgramme ? window.McProgramme.status(d) : { mode: "avant" };
    document.getElementById("sc-now").textContent = st.current ? "En vol · " + st.current.titre : "Vol MC 5060 · " + (CFG.dateLabel || "");
  }
  updateTop();
  setInterval(updateTop, 15000);

  /* ───────── Diaporama ───────── */
  function slideInfo() {
    var st = window.McProgramme ? window.McProgramme.status() : {};
    var line = st.current
      ? "Maintenant · " + esc(st.current.titre) + (st.next ? "<small>Ensuite · " + esc(st.next.titre) + (st.next.at ? " à " + esc(st.next.heure) : "") + "</small>" : "")
      : "Bienvenue à bord<small>Vol MC 5060 · " + esc(CFG.lieu || "") + "</small>";
    return '<section class="slide info-slide"><p class="step">' + line + "</p>" +
      '<div class="qr-row">' +
      '<div class="qr">' + qr("/table") + "<b>À table&nbsp;!</b><span>/table</span></div>" +
      '<div class="qr">' + qr("/boite") + "<b>La Boîte noire</b><span>/boite</span></div>" +
      '<div class="qr">' + qr("/radio") + "<b>Radio de bord</b><span>/radio</span></div>" +
      '<div class="qr">' + qr("/quiz") + "<b>Quiz de bord</b><span>/quiz</span></div>" +
      "</div></section>";
  }
  function slideEntry(e) {
    shown[e.id] = true;
    return '<section class="slide bn-slide' + (e.photo ? "" : " no-photo") + '">' +
      (e.photo ? '<div class="bn-slide__photo"><img src="/api/boite?photo=' + encodeURIComponent(e.id) + '" alt="" /></div>' : "") +
      "<div>" + (e.message ? '<p class="bn-slide__msg">' + esc(e.message) + "</p>" : "") +
      '<p class="bn-slide__by">' + esc(e.name) + " · Boîte noire</p></div></section>";
  }
  function slideRadio() {
    var top = songs.filter(function (s) { return !s.played; }).slice(0, 5);
    var pl = String(CFG.spotifyPlaylist || "").replace(/[^A-Za-z0-9]/g, "");
    return '<section class="slide radio-slide' + (pl ? " has-spotify" : "") + '"><div class="center"><p class="eyebrow-xl">Radio de bord · /radio</p><h2 class="title-xl">Vos demandes</h2></div>' +
      (pl ? '<div class="qr radio-spotify">' + qr("https://open.spotify.com/playlist/" + pl) + "<span>La playlist sur Spotify</span></div>" : "") +
      '<ol class="radio-list">' + top.map(function (s) {
        return "<li><div><b>" + esc(s.title) + "</b><small>" + esc(s.artist || "") + '</small></div><span class="votes">▲ ' + s.votes + "</span></li>";
      }).join("") + "</ol></section>";
  }

  function slideTables() {
    var d = seating;
    var head = d.seated + " passager" + (d.seated > 1 ? "s" : "") + " à table" + (d.expected ? " sur " + d.expected + " attendus" : "");
    return '<section class="slide tables-slide"><div class="tables-slide__head">' +
      '<div><p class="eyebrow-xl">À table&nbsp;!</p><h2 class="title-xl">Qui est à quelle table&nbsp;?</h2><p class="tables-slide__sub">' + head + "</p></div>" +
      '<div class="qr">' + qr("/table") + "<span>Pas encore signalé&nbsp;? Scannez le QR code posé sur votre table</span></div></div>" +
      '<div class="tables-grid' + (d.tables.length > 10 ? " is-dense" : "") + '">' + d.tables.map(function (t, i) {
        var pct = Math.min(100, Math.round((t.count / Math.max(1, t.seats)) * 100));
        return '<div class="tcard' + (t.count ? "" : " is-empty") + '" style="animation-delay:' + (i * 0.06).toFixed(2) + 's">' +
          '<div class="tcard__head"><b>' + esc(t.name) + "</b><span>" + t.count + " / " + t.seats + "</span></div>" +
          '<div class="tcard__fill"><i style="width:' + pct + '%"></i></div>' +
          '<p class="tcard__names">' + (t.people.length ? t.people.map(function (p) { return esc(p.nom) + (p.passagers > 1 ? " ×" + p.passagers : ""); }).join(" · ") : "En attente de passagers") + "</p></div>";
      }).join("") + "</div></section>";
  }

  function nextEntry() {
    if (!entries.length) return null;
    // priorité aux messages jamais affichés
    var fresh = entries.filter(function (e) { return !shown[e.id]; });
    if (fresh.length) return fresh[fresh.length - 1];
    bnIdx = (bnIdx + 1) % entries.length;
    return entries[bnIdx];
  }

  function nextSlide() {
    clearTimeout(slideTimer);
    if (inQuiz) return;
    var html = "", dur = 9000;
    // chaque type de diapositive n'est montré que s'il a du contenu
    for (var tries = 0; !html && tries < ROTATION.length; tries++) {
      var kind = ROTATION[slideIdx++ % ROTATION.length];
      if (kind === "info") html = slideInfo();
      else if (kind === "tables" && seating && seating.seated > 0) { html = slideTables(); dur = 13000; }
      else if (kind === "radio" && songs.length) html = slideRadio();
      else if (kind === "entry") {
        var e = nextEntry();
        if (e) { html = slideEntry(e); if (e.photo) dur = 11000; }
      }
    }
    stage.innerHTML = html || slideInfo();
    slideTimer = setTimeout(nextSlide, dur);
  }

  function loadEntries() {
    getJson("/api/boite").then(function (d) { entries = d.entries || []; }).catch(function () {})
      .then(function () { setTimeout(loadEntries, 12000); });
  }
  function loadTables() {
    getJson("/api/tables").then(function (d) { if (d && d.tables) seating = d; }).catch(function () {})
      .then(function () { setTimeout(loadTables, 10000); });
  }
  function loadSongs() {
    getJson("/api/radio").then(function (d) { songs = d.songs || []; }).catch(function () {})
      .then(function () { setTimeout(loadSongs, 15000); });
  }

  /* ───────── Quiz ───────── */
  function tiles(q, reveal) {
    var total = reveal ? Math.max(1, quiz.counts.reduce(function (a, b) { return a + b; }, 0)) : 1;
    return '<div class="qz-grid' + (reveal ? " is-reveal" : "") + '">' + q.choices.map(function (c, i) {
      var n = reveal ? quiz.counts[i] || 0 : 0;
      return '<div class="qz-tile c' + i + (reveal && i === quiz.correct ? " is-correct" : "") + '">' +
        (reveal ? '<span class="fill" style="width:' + Math.round((n / total) * 100) + '%"></span>' : "") +
        '<span class="shape">' + SHAPES[i] + "</span><span>" + esc(c) + "</span>" +
        (reveal ? '<span class="count">' + n + "</span>" : "") + "</div>";
    }).join("") + "</div>";
  }

  function renderQuiz() {
    var key = [quiz.phase, quiz.round, quiz.index].join("|");
    if (quiz.phase === "lobby" || quiz.phase === "board" || quiz.phase === "podium") key += "|" + (quiz.leaderboard || []).map(function (p) { return p.pub + p.score; }).join(",");
    if (key === quizKey) {
      var a = document.getElementById("qz-answered");
      if (a && quiz.phase === "question") a.textContent = (quiz.answered || 0) + " réponse" + (quiz.answered > 1 ? "s" : "");
      return;
    }
    quizKey = key;
    cancelAnimationFrame(timerRaf);
    var lb = quiz.leaderboard || [];

    if (quiz.phase === "lobby") {
      stage.innerHTML = '<section class="slide lobby-slide"><div class="qr">' + qr("/quiz") + "<span>" + esc(location.host) + "/quiz</span></div>" +
        '<div><p class="eyebrow-xl">Quiz de bord</p><h2 class="title-xl">Connaissez-vous vos commandants de bord&nbsp;?</h2>' +
        '<p class="eyebrow-xl" style="margin-top:4vh">' + lb.length + " passager" + (lb.length > 1 ? "s" : "") + " à bord</p>" +
        '<div class="lobby-names">' + lb.map(function (p) { return "<span>" + esc(p.name) + "</span>"; }).join("") + "</div></div></section>";
      return;
    }
    if (quiz.phase === "question" || quiz.phase === "reveal") {
      var q = quiz.question, reveal = quiz.phase === "reveal";
      stage.innerHTML = '<section class="slide quiz-slide">' +
        '<div class="qz-top"><span>Question ' + (quiz.index + 1) + " / " + quiz.total + '</span><span class="answered" id="qz-answered">' +
        (reveal ? "" : (quiz.answered || 0) + " réponse" + (quiz.answered > 1 ? "s" : "")) + '</span><span id="qz-left"></span></div>' +
        '<div class="qz-bar"><i id="qz-bar"' + (reveal ? ' style="transform:scaleX(0)"' : "") + "></i></div>" +
        '<p class="qz-question">' + esc(q.q) + "</p>" + tiles(q, reveal) + "</section>";
      if (!reveal) runTimer();
      return;
    }
    if (quiz.phase === "board") {
      stage.innerHTML = '<section class="slide board-slide"><div class="center"><p class="eyebrow-xl">Quiz de bord</p><h2 class="title-xl">Classement</h2></div>' +
        '<ol class="board-list">' + lb.slice(0, 5).map(function (p, i) {
          return '<li style="animation-delay:' + i * 0.12 + 's"><b>' + esc(p.name) + "</b><span>" + p.score + "</span></li>";
        }).join("") + "</ol></section>";
      return;
    }
    if (quiz.phase === "podium") {
      var order = [lb[1], lb[0], lb[2]];
      stage.innerHTML = '<section class="slide board-slide"><div class="center"><p class="eyebrow-xl">Atterrissage</p><h2 class="title-xl">Le podium</h2></div>' +
        '<div class="podium">' + order.map(function (p, i) {
          var rank = [2, 1, 3][i];
          return '<div class="podium__step">' + (p ? '<p class="podium__name">' + esc(p.name) + '</p><p class="podium__score">' + p.score + " pts</p>" : "") +
            '<div class="podium__block">' + rank + "</div></div>";
        }).join("") + "</div></section>";
    }
  }

  function runTimer() {
    var bar = document.getElementById("qz-bar"), left = document.getElementById("qz-left");
    var total = quiz.question.time * 1000;
    (function frame() {
      var rest = Math.max(0, quiz.endsAt - (Date.now() + offset));
      if (bar) bar.style.transform = "scaleX(" + Math.min(1, rest / total) + ")";
      if (left) left.textContent = Math.ceil(rest / 1000) + " s";
      if (rest > 0) timerRaf = requestAnimationFrame(frame);
    })();
  }

  function pollQuiz() {
    getJson("/api/quiz?view=public").then(function (d) {
      quiz = d;
      if (d.serverNow) offset = d.serverNow - Date.now();
      var active = d.phase && d.phase !== "off";
      if (active) {
        if (!inQuiz) { inQuiz = true; clearTimeout(slideTimer); quizKey = ""; }
        renderQuiz();
      } else if (inQuiz) {
        inQuiz = false; cancelAnimationFrame(timerRaf); nextSlide();
      }
    }).catch(function () {}).then(function () { setTimeout(pollQuiz, 1000); });
  }

  /* ───────── Plein écran, veille, curseur ───────── */
  var fsBtn = document.getElementById("sc-fs");
  fsBtn.addEventListener("click", function () {
    var el = document.documentElement;
    (el.requestFullscreen || el.webkitRequestFullscreen || function () {}).call(el);
  });
  document.addEventListener("fullscreenchange", function () {
    document.body.classList.toggle("is-fullscreen", !!document.fullscreenElement);
  });
  var lock = null;
  function keepAwake() {
    if (navigator.wakeLock && document.visibilityState === "visible") {
      navigator.wakeLock.request("screen").then(function (l) { lock = l; }).catch(function () {});
    }
  }
  document.addEventListener("visibilitychange", keepAwake);
  keepAwake();
  var cursorTimer;
  document.addEventListener("mousemove", function () {
    document.body.classList.add("show-cursor");
    clearTimeout(cursorTimer);
    cursorTimer = setTimeout(function () { document.body.classList.remove("show-cursor"); }, 2500);
  });

  loadEntries();
  loadSongs();
  loadTables();
  pollQuiz();
  setTimeout(function () { if (!inQuiz) nextSlide(); }, 400);
})();
