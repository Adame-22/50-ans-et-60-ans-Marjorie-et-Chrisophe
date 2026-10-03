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
  var entries = [], songs = [], shown = {}, seating = null, teams = null, podiumDone = "";
  var ROTATION = ["info", "tables", "entry", "teams", "entry", "radio", "entry", "tables", "entry", "teams"];
  // ?vue=tables (ou info, entry, radio, teams) : n'affiche que cette vue, pour la vérifier avant la soirée
  var only = new URLSearchParams(location.search).get("vue");
  if (only && ["info", "tables", "entry", "teams", "radio"].indexOf(only) !== -1) ROTATION = [only];
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
      qrCard("/table", "À table&nbsp;!", "Signalez votre table", "M4 11h16M6 11v8M18 11v8M8 7a4 2 0 0 0 8 0") +
      qrCard("/boite", "La Boîte noire", "Un mot, une photo", "M4 7h16v12H4zM8 7V5h8v2M9 13h6") +
      qrCard("/radio", "Radio de bord", "Votre chanson", "M9 18V6l10-2v12M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0M19 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0") +
      qrCard("/quiz", "Quiz de bord", "Jouez avec nous", "M9.2 9a3 3 0 1 1 4.3 2.7c-.9.4-1.5 1.1-1.5 2.1v.4M12 17.6v.1M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 0 0 0-19") +
      "</div></section>";
  }
  function qrCard(path, title, hint, icon) {
    return '<div class="qcard"><div class="qcard__code">' + qr(path) + '</div><div class="qcard__txt">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + icon + '"/></svg><b>' + title + "</b><small>" + hint + "</small>" +
      '<span class="qcard__url">' + esc(location.host) + path + "</span></div></div>";
  }
  function slideEntry(e) {
    shown[e.id] = true;
    if (!e.photo) {
      return '<section class="slide bn-slide no-photo"><div class="postcard">' +
        '<span class="postcard__air">Par avion · Boîte noire · Vol MC 5060</span>' +
        '<p class="bn-slide__msg">' + esc(e.message) + '</p><p class="bn-slide__by">' + esc(e.name) + "</p></div></section>";
    }
    return '<section class="slide bn-slide">' +
      '<div class="bn-slide__photo"><figure class="polaroid"><img src="/api/boite?photo=' + encodeURIComponent(e.id) + '" alt="" /></figure></div>' +
      '<div><p class="eyebrow-xl">La Boîte noire</p>' + (e.message ? '<p class="bn-slide__msg">' + esc(e.message) + "</p>" : "") +
      '<p class="bn-slide__by">' + esc(e.name) + "</p></div></section>";
  }
  function slideRadio() {
    var top = songs.filter(function (s) { return !s.played; }).slice(0, 5);
    var pl = String(CFG.spotifyPlaylist || "").replace(/[^A-Za-z0-9]/g, "");
    return '<section class="slide radio-slide">' +
      '<aside class="onair-xl"><p class="onair-xl__live">Sur les ondes</p><p class="onair-xl__freq">50.60</p><p class="onair-xl__name">Radio de bord</p>' +
      '<div class="eq-xl" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>' +
      '<div class="onair-xl__qr">' + qr(pl ? "https://open.spotify.com/playlist/" + pl : "/radio") + "<span>" + (pl ? "La playlist sur Spotify" : "Proposez votre chanson") + "</span></div></aside>" +
      '<div><p class="eyebrow-xl">Le hit-parade des passagers</p><h2 class="title-xl">Vos demandes</h2>' +
      '<ol class="radio-list">' + top.map(function (s, i) {
        return '<li class="' + (i === 0 ? "is-top" : "") + '"><div><b>' + esc(s.title) + "</b><small>" + esc(s.artist || "") + '</small></div><span class="votes"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z"/></svg>' + s.votes + "</span></li>";
      }).join("") + "</ol></div></section>";
  }

  function slideTables() {
    var d = seating;
    var head = d.seated + " passager" + (d.seated > 1 ? "s" : "") + " à table" + (d.expected ? " sur " + d.expected + " attendus" : "");
    return '<section class="slide tables-slide"><div class="tables-slide__head">' +
      '<div><p class="eyebrow-xl">À table&nbsp;!</p><h2 class="title-xl">Qui est à quelle table&nbsp;?</h2><p class="tables-slide__sub">' + head + "</p></div>" +
      '<div class="qr">' + qr("/table") + "<span>Pas encore signalé&nbsp;? Scannez le QR code posé sur votre table</span></div></div>" +
      '<div class="tables-grid' + (d.tables.length > 10 ? " is-dense" : "") + '">' + d.tables.map(function (t, i) {
        var n = Math.max(4, Math.min(16, t.seats || 8)), seats = "";
        for (var k = 0; k < n; k++) seats += '<i class="' + (k < t.count ? "is-taken" : "") + '" style="--i:' + k + '"></i>';
        return '<div class="tcard' + (t.count ? "" : " is-empty") + (t.count >= t.seats ? " is-full" : "") + '" style="animation-delay:' + (i * 0.06).toFixed(2) + 's">' +
          '<div class="rt" style="--n:' + n + '">' + seats + '<span class="rt__top"><b>' + esc(t.name.replace(/^Table\s+/i, "")) + "</b><small>" + t.count + "/" + t.seats + "</small></span></div>" +
          '<p class="tcard__names">' + (t.people.length ? t.people.map(function (p) { return esc(p.nom) + (p.passagers > 1 ? " <em>+" + (p.passagers - 1) + "</em>" : ""); }).join("<br>") : "Places libres") + "</p></div>";
      }).join("") + "</div></section>";
  }

  function slideTeams() {
    var list = teams.teams;
    return '<section class="slide teams-slide"><div class="center"><p class="eyebrow-xl">Les escadrilles de la soirée</p><h2 class="title-xl">Les équipes</h2></div>' +
      '<div class="teams-wall' + (list.length > 8 ? " is-dense" : "") + '">' + list.map(function (t, i) {
        return '<div class="team-tile" style="--team:' + esc(t.color) + ";animation-delay:" + (i * 0.08).toFixed(2) + 's">' +
          '<div class="team-tile__head"><b>' + esc(t.name) + "</b><span>" + t.count + " passager" + (t.count > 1 ? "s" : "") + "</span></div>" +
          (teams.mode !== "mix" && t.tables.length && !(t.tables.length === 1 && t.tables[0] === t.name) ? '<p class="team-tile__tables">' + t.tables.map(esc).join(" · ") + "</p>" : "") +
          '<p class="team-tile__names">' + t.people.map(function (p) { return esc(p.nom); }).join(" · ") + "</p></div>";
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
      else if (kind === "teams" && teams && teams.show && teams.teams.length) { html = slideTeams(); dur = 14000; }
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
  function loadTeams() {
    getJson("/api/teams").then(function (d) { if (d && d.teams) teams = d; }).catch(function () {})
      .then(function () { setTimeout(loadTeams, 15000); });
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
        '<span class="shape"><b>' + "ABCD".charAt(i) + "</b><i>" + SHAPES[i] + "</i></span><span>" + esc(c) + "</span>" +
        (reveal ? '<span class="count">' + n + "</span>" : "") + "</div>";
    }).join("") + "</div>";
  }

  function renderQuiz() {
    var key = [quiz.phase, quiz.round, quiz.index].join("|");
    if (quiz.phase === "lobby" || quiz.phase === "board" || quiz.phase === "podium") key += "|" + (quiz.leaderboard || []).map(function (p) { return p.pub + p.score; }).join(",") +
      "|" + (quiz.teams || []).map(function (t) { return t.id + t.score + "/" + t.players; }).join(",");
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
        '<div class="lobby-names">' + lb.map(function (p) { return "<span>" + esc(p.name) + "</span>"; }).join("") + "</div>" +
        (quiz.teamMode && quiz.teams && quiz.teams.length ? '<div class="lobby-teams">' + quiz.teams.map(function (t) {
          return '<span style="--team:' + esc(t.color) + '"><i></i>' + esc(t.name) + " <b>" + t.players + "</b></span>";
        }).join("") + "</div>" : "") + "</div></section>";
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
      var players = '<ol class="board-list">' + lb.slice(0, 5).map(function (p, i) {
        return '<li style="animation-delay:' + i * 0.12 + 's"><b>' + esc(p.name) + "</b><span>" + p.score + "</span></li>";
      }).join("") + "</ol>";
      var tlist = quiz.teamMode ? quiz.teams || [] : [];
      stage.innerHTML = '<section class="slide board-slide"><div class="center"><p class="eyebrow-xl">Quiz de bord</p><h2 class="title-xl">Classement</h2></div>' +
        (tlist.length
          ? '<div class="board-cols"><div><p class="eyebrow-xl">Équipes · moyenne des points</p><ol class="board-list board-list--teams">' + tlist.slice(0, 6).map(function (t, i) {
              return '<li style="--team:' + esc(t.color) + ";animation-delay:" + i * 0.12 + 's"><b><i></i>' + esc(t.name) + " <small>" + t.players + "</small></b><span>" + t.score + "</span></li>";
            }).join("") + '</ol></div><div><p class="eyebrow-xl">Joueurs</p>' + players + "</div></div>"
          : players) + "</section>";
      return;
    }
    if (quiz.phase === "podium") {
      var teamPodium = quiz.teamMode && quiz.teams && quiz.teams.length > 1;
      var src = teamPodium ? quiz.teams : lb;
      var order = [src[1], src[0], src[2]];
      stage.innerHTML = '<section class="slide board-slide"><div class="center"><p class="eyebrow-xl">Atterrissage</p><h2 class="title-xl">' +
        (teamPodium ? "Le podium des équipes" : "Le podium") + "</h2></div>" +
        '<div class="podium">' + order.map(function (p, i) {
          var rank = [2, 1, 3][i];
          return '<div class="podium__step"' + (teamPodium && p ? ' style="--team:' + esc(p.color) + '"' : "") + ">" +
            (p ? '<p class="podium__name">' + (teamPodium ? "Équipe " : "") + esc(p.name) + '</p><p class="podium__score">' + p.score + " pts" + (teamPodium ? " · " + p.players + " joueurs" : "") + "</p>" : "") +
            '<div class="podium__block">' + rank + "</div></div>";
        }).join("") + "</div>" +
        (teamPodium && lb[0] ? '<p class="podium__best">Meilleur joueur de la soirée&nbsp;: <b>' + esc(lb[0].name) + "</b> · " + lb[0].score + " pts</p>" : "") +
        "</section>";
      // pluie de confettis quand le premier monte sur la plus haute marche
      var pk = quiz.round + "|" + (order[1] ? order[1].name : "");
      if (window.McFx && podiumDone !== pk) {
        podiumDone = pk;
        setTimeout(function () { window.McFx.celebrate(); }, 1500);
        setTimeout(function () { window.McFx.confetti({ x: 0.5, y: 0.35, count: 160, spread: 160, velocity: 16 }); }, 2300);
      }
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
  loadTeams();
  pollQuiz();
  setTimeout(function () { if (!inQuiz) nextSlide(); }, 400);
})();
