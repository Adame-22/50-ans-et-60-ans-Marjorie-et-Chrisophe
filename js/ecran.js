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

  /* ───────── Sons de la salle (synthétisés : aucun fichier à charger) ─────────
     Activés par le bouton « Son » (les navigateurs exigent un clic). Uniquement sur l'écran géant. */
  var Sound = (function () {
    var ctx = null, master = null, on = false, loop = null, loopStep = 0;
    try { on = localStorage.getItem("mc-screen-sound") === "1"; } catch (e) { /* ignoré */ }
    function init() {
      if (ctx) { if (ctx.state === "suspended") ctx.resume(); return true; }
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = 0.55; master.connect(ctx.destination);
      return true;
    }
    function tone(freq, start, dur, type, vol, slide) {
      if (!on || !ctx) return;
      var o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + (start || 0);
      o.type = type || "triangle";
      o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol || 0.2, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + dur + 0.05);
    }
    function noise(start, dur, vol, freq) {
      if (!on || !ctx) return;
      var len = Math.floor(ctx.sampleRate * dur), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      var src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), t = ctx.currentTime + (start || 0);
      src.buffer = buf; f.type = "bandpass"; f.frequency.value = freq || 1800; g.gain.value = vol || 0.3;
      src.connect(f); f.connect(g); g.connect(master); src.start(t);
    }
    var N = function (semi) { return 261.63 * Math.pow(2, semi / 12); }; // do = 0
    // petites boucles : attente (salle d'embarquement) et réflexion (pendant la question)
    var LOOPS = {
      lobby: { ms: 240, notes: [0, 4, 7, 12, 7, 4, 2, 7, 0, 4, 9, 12, 9, 4, 2, 7], bass: [-12, -12, -15, -17], vol: 0.07 },
      think: { ms: 180, notes: [12, 7, 12, 14, 12, 7, 12, 16], bass: [-12, -10], vol: 0.05 },
    };
    function startLoop(name) {
      if (loop && loop.name === name) return;
      stopLoop();
      if (!on || !ctx) return;
      var L = LOOPS[name];
      loopStep = 0;
      loop = { name: name, timer: setInterval(function () {
        var s = loopStep++;
        tone(N(L.notes[s % L.notes.length]), 0, L.ms / 1000 * 0.9, "triangle", L.vol);
        if (s % 4 === 0) tone(N(L.bass[(s / 4) % L.bass.length]), 0, L.ms / 1000 * 3.5, "sine", L.vol * 1.6);
      }, L.ms) };
    }
    function stopLoop() { if (loop) { clearInterval(loop.timer); loop = null; } }
    return {
      get on() { return on; },
      toggle: function () {
        on = !on;
        try { localStorage.setItem("mc-screen-sound", on ? "1" : "0"); } catch (e) { /* ignoré */ }
        if (on) { init(); tone(N(12), 0, 0.15, "sine", 0.2); tone(N(19), 0.12, 0.25, "sine", 0.2); } else stopLoop();
        return on;
      },
      wake: function () { if (on) init(); },
      loop: startLoop,
      stop: stopLoop,
      join: function () { tone(N(19), 0, 0.12, "sine", 0.12); tone(N(24), 0.07, 0.16, "sine", 0.1); },
      tick: function (last) { noise(0, 0.05, last ? 0.5 : 0.35, last ? 2600 : 2000); tone(last ? 1200 : 900, 0, 0.06, "square", 0.05); },
      gong: function () { [55, 110, 165.5, 221, 277].forEach(function (f, i) { tone(f, 0, 2.6 - i * 0.3, "sine", 0.35 / (i + 1)); }); noise(0, 0.4, 0.25, 400); },
      go: function () { tone(N(12), 0, 0.12, "square", 0.08); tone(N(19), 0.1, 0.12, "square", 0.08); tone(N(24), 0.2, 0.3, "square", 0.09); },
      reveal: function () { [0, 4, 7, 12].forEach(function (s, i) { tone(N(s + 12), i * 0.09, 0.35, "triangle", 0.16); }); },
      whoosh: function () { noise(0, 0.5, 0.2, 900); tone(N(0), 0, 0.4, "sine", 0.08, N(12)); },
      drumroll: function (sec) { var n = Math.floor(sec * 18); for (var i = 0; i < n; i++) noise(i / 18, 0.07, 0.12 + 0.25 * i / n, 1200); },
      fanfare: function () {
        [[0, 0, 0.18], [7, 0.18, 0.18], [12, 0.36, 0.18], [16, 0.54, 0.5], [12, 0.95, 0.18], [16, 1.13, 0.9]].forEach(function (x) {
          tone(N(x[0]), x[1], x[2] + 0.1, "sawtooth", 0.07); tone(N(x[0] - 12), x[1], x[2] + 0.1, "triangle", 0.1);
        });
        noise(0.54, 0.6, 0.18, 4000); noise(1.13, 1.2, 0.22, 4000);
      },
    };
  })();
  /* ───────── Blind test : extraits de 30 s (aperçus iTunes), joués seulement ici ───────── */
  var Music = (function () {
    var pool = {}, cur = null, fadeT = 0;
    function get(url) {
      if (!pool[url]) { var a = new Audio(); a.preload = "auto"; a.src = url; pool[url] = a; }
      return pool[url];
    }
    function fade(a, to, ms, done) {
      clearInterval(fadeT);
      var from = a.volume, t0 = Date.now();
      fadeT = setInterval(function () {
        var k = Math.min(1, (Date.now() - t0) / ms);
        a.volume = Math.max(0, Math.min(1, from + (to - from) * k));
        if (k >= 1) { clearInterval(fadeT); if (done) done(); }
      }, 40);
    }
    return {
      preload: function (url) { if (url) get(url); },
      // joue l'extrait à partir de « pos » secondes
      play: function (url, pos, vol) {
        if (!Sound.on || !url) return;
        var a = get(url);
        if (cur && cur !== a) cur.pause();
        cur = a;
        var t0 = Date.now(), seek = function () {
          // si le fichier arrive en retard, on rattrape le temps passé à l'attendre
          var want = pos + (Date.now() - t0) / 1000;
          try { if (Math.abs(a.currentTime - want) > 0.6) a.currentTime = want; } catch (e) { /* ignoré */ }
        };
        if (a.readyState >= 1) seek(); else a.addEventListener("loadedmetadata", seek, { once: true });
        a.volume = 0;
        var p = a.play();
        if (p && p.catch) p.catch(function () {});
        fade(a, vol || 1, 600);
      },
      resume: function (url, start, vol) {
        if (!Sound.on || !url) return;
        var a = get(url);
        // l'aperçu fait 30 s : s'il est fini, on reprend au début de l'extrait
        var pos = a.ended || a.currentTime >= 28 || a.currentTime < start ? start : a.currentTime;
        this.play(url, pos, vol);
      },
      fadeOut: function (ms) { if (cur) { var a = cur; fade(a, 0, ms || 800, function () { a.pause(); }); } },
      stop: function () { clearInterval(fadeT); if (cur) cur.pause(); cur = null; },
    };
  })();

  var soundBtn = document.getElementById("sc-sound");
  function soundLabel() { soundBtn.textContent = Sound.on ? "🔊 Son activé" : "🔇 Activer le son"; soundBtn.classList.toggle("is-on", Sound.on); }
  soundBtn.addEventListener("click", function () { Sound.toggle(); soundLabel(); if (!Sound.on) Music.stop(); if (inQuiz) { quizKey = ""; renderQuiz(); } });
  soundLabel();
  document.addEventListener("click", function () { Sound.wake(); }, { once: false });

  /* ───────── Quiz ───────── */
  // Heure du serveur : on écarte les réponses servies en retard par le cache (en-tête Age)
  var offsets = [];
  function clock(d, age) {
    offsets.push(d.serverNow + (age || 0) * 1000 - Date.now());
    if (offsets.length > 10) offsets.shift();
    offset = Math.max.apply(null, offsets);
  }
  function now() { return Date.now() + offset; }
  var lobbySeen = {}, lobbyOrder = [], lastTick = -1, timeUpDone = "", stageTimers = [];
  function later(fn, ms) { stageTimers.push(setTimeout(fn, ms)); }
  function clearStage() { stageTimers.forEach(clearTimeout); stageTimers = []; cancelAnimationFrame(timerRaf); }
  function isLong(q) { return q.q.length > 110 || q.choices.some(function (c) { return c.length > 40; }); }

  function tiles(q) {
    return '<div class="qz-grid">' + q.choices.map(function (c, i) {
      return '<div class="qz-tile k' + i + '" data-i="' + i + '"><span class="qz-shape">' + SHAPES[i] + "</span><span class=\"qz-txt\">" + esc(c) + "</span></div>";
    }).join("") + "</div>";
  }
  function playersCount() { return quiz.players || (quiz.leaderboard || []).length || 0; }

  function renderLobby() {
    var lb = quiz.leaderboard || [];
    var game = quiz.game || "Quiz de bord", other = game !== "Quiz de bord";
    if (!document.getElementById("lobby-n") || stage.getAttribute("data-game") !== game) {
      lobbySeen = {}; lobbyOrder = [];
      stage.setAttribute("data-game", game);
      stage.innerHTML = '<section class="slide lobby-slide2">' +
        '<div class="lobby2__join"><div class="lobby2__qr">' + qr("/quiz") + '</div><p class="lobby2__url">' + esc(location.host) + "/quiz</p>" +
        '<p class="lobby2__how">Scannez avec l\'appareil photo<br>et entrez votre prénom</p></div>' +
        '<div class="lobby2__side"><p class="eyebrow-xl">' + (other ? "Nouveau jeu" : "Quiz de bord") + '</p><h2 class="lobby2__title">' + (other ? esc(game) : "Connaissez-vous vos commandants de bord&nbsp;?") + "</h2>" +
        '<p class="lobby2__count"><b id="lobby-n">0</b><span>joueurs à bord</span></p>' +
        '<div class="lobby2__names" id="lobby-names"></div><p class="lobby2__more" id="lobby-more"></p>' +
        '<div class="lobby-teams" id="lobby-teams"></div></div></section>';
      Sound.loop("lobby");
    }
    // nouveaux joueurs en tête, sans tout redessiner
    var fresh = lb.filter(function (p) { return !lobbySeen[p.pub]; });
    fresh.forEach(function (p) { lobbySeen[p.pub] = 1; lobbyOrder.unshift(p); });
    if (fresh.length && Object.keys(lobbySeen).length > fresh.length) Sound.join();
    document.getElementById("lobby-n").textContent = lb.length;
    var MAX = 28;
    document.getElementById("lobby-names").innerHTML = lobbyOrder.slice(0, MAX).map(function (p) {
      return '<span class="' + (fresh.indexOf(p) >= 0 ? "is-new" : "") + '">' + esc(p.name) + "</span>";
    }).join("");
    document.getElementById("lobby-more").textContent = lobbyOrder.length > MAX ? "+ " + (lobbyOrder.length - MAX) + " autres" : "";
    document.getElementById("lobby-teams").innerHTML = quiz.teamMode && quiz.teams && quiz.teams.length ? quiz.teams.map(function (t) {
      return '<span style="--team:' + esc(t.color) + '"><i></i>' + esc(t.name) + " <b>" + t.players + "</b></span>";
    }).join("") : "";
  }

  function renderCountdown() {
    var q = quiz.question;
    stage.innerHTML = '<section class="slide quiz-intro"><p class="qz-num">Question ' + (quiz.index + 1) + " sur " + quiz.total + "</p>" +
      '<p class="qz-question qz-question--intro' + (isLong(q) ? " is-long" : "") + '">' + esc(q.q) + "</p>" +
      (q.audio ? '<p class="qz-intro-music">🎵 Blind test : ouvrez grand les oreilles&nbsp;!</p>' : "") +
      '<div class="qz-intro-count"><span id="qz-count">3</span></div></section>';
    Sound.stop(); Music.stop();
    if (q.audio) Music.preload(q.audio.url);
    var last = -1;
    (function tick() {
      var rest = quiz.startedAt - now(), el = document.getElementById("qz-count");
      if (!el) return;
      if (rest <= 0) { quizKey = ""; renderQuiz(); return; }
      var s = Math.ceil(rest / 1000);
      if (s !== last) { last = s; el.textContent = s; el.classList.remove("pop"); void el.offsetWidth; el.classList.add("pop"); Sound.tick(false); }
      later(tick, Math.min(200, rest));
    })();
  }

  function renderQuestion() {
    var q = quiz.question;
    stage.innerHTML = '<section class="slide quiz-slide2' + (isLong(q) ? " is-long" : "") + '">' +
      '<div class="qz-head"><span class="qz-num">Question ' + (quiz.index + 1) + " sur " + quiz.total + "</span></div>" +
      '<p class="qz-question">' + esc(q.q) + "</p>" +
      '<div class="qz-mid"><div class="qz-clock" id="qz-clock"><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="44" class="qz-clock__bg"/><circle cx="50" cy="50" r="44" class="qz-clock__fg" id="qz-ring"/></svg><b id="qz-left"></b></div>' +
      (q.audio ? '<div class="qz-listen">' + (Sound.on
        ? '<span class="qz-eq" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span><b>Écoutez&nbsp;!</b>'
        : '<b>🔇 Son coupé</b><small>cliquez sur « Activer le son »</small>') + "</div>" : "") +
      '<div class="qz-answers"><b id="qz-answered">' + (quiz.answered || 0) + '</b><span>réponses<br>sur ' + playersCount() + "</span></div></div>" +
      tiles(q) + "</section>";
    if (q.audio) {
      // l'extrait démarre au top départ (ou là où il en est si l'écran vient d'être rechargé)
      Sound.stop();
      Music.play(q.audio.url, q.audio.start + Math.max(0, now() - quiz.startedAt) / 1000, 1);
    } else {
      Music.stop();
      Sound.loop("think");
      Sound.go();
    }
    lastTick = -1;
    runTimer();
  }

  function runTimer() {
    var ring = document.getElementById("qz-ring"), left = document.getElementById("qz-left"), box = document.getElementById("qz-clock");
    var total = quiz.question.time * 1000, C = 2 * Math.PI * 44;
    if (ring) ring.style.strokeDasharray = C;
    (function frame() {
      var rest = Math.max(0, Math.min(total, quiz.endsAt - now())), sec = Math.ceil(rest / 1000);
      if (ring) ring.style.strokeDashoffset = C * (1 - rest / total);
      if (left) left.textContent = rest > 0 ? sec : "0";
      if (box) box.classList.toggle("is-hurry", rest > 0 && rest <= 5000);
      if (rest > 0 && rest <= 5000 && sec !== lastTick && !quiz.question.audio) { lastTick = sec; Sound.tick(sec <= 1); }
      if (rest <= 0) {
        var k = quiz.round + ":" + quiz.startedAt;
        if (timeUpDone !== k) {
          timeUpDone = k;
          Sound.stop(); Music.fadeOut(700); Sound.gong();
          var sl = stage.querySelector(".quiz-slide2");
          if (sl) sl.classList.add("is-timeup");
          var head = stage.querySelector(".qz-head");
          if (head) head.insertAdjacentHTML("beforeend", '<span class="qz-timeup">Temps écoulé&nbsp;!</span>');
        }
        return;
      }
      timerRaf = requestAnimationFrame(frame);
    })();
  }

  function renderReveal() {
    var q = quiz.question, counts = quiz.counts || [], total = counts.reduce(function (a, b) { return a + b; }, 0);
    var max = Math.max.apply(null, counts.concat([1])), good = counts[quiz.correct] || 0;
    var pct = total ? Math.round(good / total * 100) : 0;
    var song = q.audio && q.audio.title;
    stage.innerHTML = '<section class="slide quiz-slide2 is-reveal' + (isLong(q) ? " is-long" : "") + (song ? " is-song" : "") + '">' +
      '<div class="qz-head"><span class="qz-num">Question ' + (quiz.index + 1) + " sur " + quiz.total + '</span><span class="qz-pct">' + pct + " % de bonnes réponses</span></div>" +
      (song
        ? '<div class="qz-song">' + (q.audio.cover ? '<img src="' + esc(q.audio.cover) + '" alt="" />' : "") +
          "<div><b>" + esc(q.audio.title) + "</b><span>" + esc(q.audio.artist) + (q.audio.year ? " · " + esc(q.audio.year) : "") + "</span></div></div>"
        : '<p class="qz-question">' + esc(q.q) + "</p>") +
      '<div class="qz-hist">' + q.choices.map(function (c, i) {
        return '<div class="qz-col k' + i + (i === quiz.correct ? " is-correct" : "") + '"><span class="qz-col__n">' + (counts[i] || 0) + "</span>" +
          '<i class="qz-col__bar" data-h="' + Math.round((counts[i] || 0) / max * 100) + '"></i><span class="qz-col__shape">' + SHAPES[i] + (i === quiz.correct ? " ✓" : "") + "</span></div>";
      }).join("") + "</div>" + tiles(q) + "</section>";
    stage.querySelectorAll(".qz-tile").forEach(function (t) { t.classList.toggle("is-correct", +t.getAttribute("data-i") === quiz.correct); t.classList.toggle("is-wrong", +t.getAttribute("data-i") !== quiz.correct); });
    // les barres montent (au rendu suivant, pour que l'animation se joue)
    requestAnimationFrame(function () { requestAnimationFrame(function () {
      stage.querySelectorAll(".qz-col__bar").forEach(function (b) { b.style.height = Math.max(3, +b.getAttribute("data-h")) + "%"; });
    }); });
    Sound.stop(); Sound.reveal();
    // la chanson repart pendant qu'on découvre la réponse
    if (q.audio) later(function () { Music.resume(q.audio.url, q.audio.start, 0.85); }, 700);
  }

  function renderBoard() {
    var lb = quiz.leaderboard || [], gains = quiz.gains || {};
    // rang avant cette question : score moins les points qu'on vient de gagner
    var before = lb.map(function (p) { return { pub: p.pub, s: p.score - (gains[p.pub] || 0), name: p.name }; })
      .sort(function (a, b) { return b.s - a.s || a.name.localeCompare(b.name, "fr"); });
    var prevRank = {};
    before.forEach(function (p, i) { prevRank[p.pub] = i + 1; });
    var players = '<ol class="board2">' + lb.slice(0, 5).map(function (p, i) {
      var mv = (prevRank[p.pub] || i + 1) - (i + 1), g = gains[p.pub] || 0;
      return '<li style="animation-delay:' + (0.15 * i).toFixed(2) + 's"><span class="board2__rank">' + (p.rank || i + 1) + "</span><b>" + esc(p.name) + "</b>" +
        (g ? '<em class="board2__gain">+' + g + "</em>" : "") +
        (mv > 0 ? '<em class="board2__up">▲ ' + mv + "</em>" : mv < 0 ? '<em class="board2__down">▼ ' + (-mv) + "</em>" : "") +
        "<span class=\"board2__score\">" + p.score + "</span></li>";
    }).join("") + "</ol>";
    var tlist = quiz.teamMode ? quiz.teams || [] : [];
    stage.innerHTML = '<section class="slide board-slide"><div class="center"><p class="eyebrow-xl">Après la question ' + (quiz.index + 1) + '</p><h2 class="title-xl">Classement</h2></div>' +
      (tlist.length
        ? '<div class="board-cols"><div><p class="eyebrow-xl">Équipes · moyenne des points</p><ol class="board-list board-list--teams">' + tlist.slice(0, 6).map(function (t, i) {
            return '<li style="--team:' + esc(t.color) + ";animation-delay:" + i * 0.12 + 's"><b><i></i>' + esc(t.name) + " <small>" + t.players + "</small></b><span>" + t.score + "</span></li>";
          }).join("") + '</ol></div><div><p class="eyebrow-xl">Joueurs</p>' + players + "</div></div>"
        : players) + "</section>";
    Music.fadeOut(2500);
    Sound.whoosh();
  }

  // Podium en trois temps : 3e, 2e, roulement de tambour, 1er
  function renderPodium() {
    var lb = quiz.leaderboard || [];
    var teamPodium = quiz.teamMode && quiz.teams && quiz.teams.length > 1;
    var src = teamPodium ? quiz.teams : lb;
    var order = [src[1], src[0], src[2]];
    stage.innerHTML = '<section class="slide board-slide"><div class="center"><p class="eyebrow-xl">Atterrissage</p><h2 class="title-xl">' +
      (teamPodium ? "Le podium des équipes" : "Le podium") + "</h2></div>" +
      '<div class="podium podium--staged">' + order.map(function (p, i) {
        var rank = [2, 1, 3][i];
        return '<div class="podium__step" data-rank="' + rank + '"' + (teamPodium && p ? ' style="--team:' + esc(p.color) + '"' : "") + ">" +
          (p ? '<p class="podium__name">' + (teamPodium ? "Équipe " : "") + esc(p.name) + '</p><p class="podium__score">' + p.score + " pts" + (teamPodium ? " · " + p.players + " joueurs" : "") + "</p>" : "") +
          '<div class="podium__block">' + rank + "</div></div>";
      }).join("") + "</div>" +
      (teamPodium && lb[0] ? '<p class="podium__best" id="podium-best">Meilleur joueur de la soirée&nbsp;: <b>' + esc(lb[0].name) + "</b> · " + lb[0].score + " pts</p>" : "") +
      "</section>";
    var pk = quiz.round + "|" + (order[1] ? order[1].name : "");
    var show = function (r) { var s = stage.querySelector('.podium__step[data-rank="' + r + '"]'); if (s) s.classList.add("is-shown"); };
    if (podiumDone === pk) { show(3); show(2); show(1); var b = document.getElementById("podium-best"); if (b) b.classList.add("is-shown"); return; }
    podiumDone = pk;
    Sound.stop(); Music.fadeOut(1500);
    later(function () { show(3); Sound.reveal(); }, 1200);
    later(function () { show(2); Sound.reveal(); }, 3400);
    later(function () { Sound.drumroll(2.6); }, 5000);
    later(function () {
      show(1); Sound.fanfare();
      var b = document.getElementById("podium-best"); if (b) b.classList.add("is-shown");
      if (window.McFx) { window.McFx.celebrate(); later(function () { window.McFx.confetti({ x: 0.5, y: 0.35, count: 160, spread: 160, velocity: 16 }); }, 700); }
    }, 7700);
  }

  function renderQuiz() {
    var waiting = quiz.phase === "question" && quiz.startedAt && now() < quiz.startedAt;
    var key = [quiz.phase, quiz.round, quiz.index, waiting ? "w" : "", quiz.scoring ? "s" : ""].join("|");
    // le classement change seulement entre deux questions : les nouvelles inscriptions n'y touchent pas
    if (quiz.phase === "board") key += "|" + (quiz.leaderboard || []).slice(0, 5).map(function (p) { return p.pub + p.score; }).join(",") + "|" + (quiz.teams || []).map(function (t) { return t.id + t.score; }).join(",");
    if (quiz.preload) Music.preload(quiz.preload);
    if (quiz.phase === "lobby") { if (quizKey.indexOf("lobby|") !== 0) { clearStage(); Music.stop(); quizKey = key; stage.innerHTML = ""; } renderLobby(); return; }
    if (key === quizKey) {
      if (quiz.phase === "question") {
        var a = document.getElementById("qz-answered"); if (a) a.textContent = quiz.answered || 0;
      }
      return;
    }
    quizKey = key;
    clearStage();
    if (quiz.phase === "question") return waiting ? renderCountdown() : renderQuestion();
    if (quiz.phase === "reveal") {
      if (quiz.scoring) { var sl = stage.querySelector(".quiz-slide2"); if (!sl) renderQuestion(); return; } // on attend la fin du calcul
      return renderReveal();
    }
    if (quiz.phase === "board") return renderBoard();
    if (quiz.phase === "podium") return renderPodium();
  }

  function pollQuiz() {
    fetch("/api/quiz?view=public").then(function (r) {
      // une erreur passagère de la base ne doit pas faire quitter le quiz
      if (!r.ok) throw new Error("HTTP " + r.status);
      var age = parseFloat(r.headers.get("Age")) || 0;
      return r.json().then(function (d) { if (!d || !d.phase) throw new Error("réponse vide"); return { d: d, age: age }; });
    }).then(function (x) {
      var d = x.d;
      quiz = d;
      if (d.serverNow) clock(d, x.age);
      var active = d.phase !== "off";
      if (active) {
        if (!inQuiz) { inQuiz = true; clearTimeout(slideTimer); quizKey = ""; }
        renderQuiz();
      } else if (inQuiz) {
        inQuiz = false; clearStage(); Sound.stop(); Music.stop(); quizKey = ""; nextSlide();
      }
    }).catch(function () { /* on garde l'affichage en cours et on réessaie */ })
      .then(function () { setTimeout(pollQuiz, 1000); });
  }

  /* ───────── Plein écran, veille, curseur ───────── */
  var fsBtn = document.getElementById("sc-fs");
  fsBtn.addEventListener("click", function () {
    Sound.wake();
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
