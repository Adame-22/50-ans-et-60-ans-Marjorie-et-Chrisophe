/* À table ! — chaque invité indique lui-même à quelle table il s'est installé */
(function () {
  "use strict";

  var app = document.getElementById("app");
  var tag = document.getElementById("t-tag");
  var tableId = new URLSearchParams(location.search).get("t") || "";
  var tables = [];
  var me = read("mc-me");
  var refreshTimer = 0;

  function read(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }
  function write(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* navigation privée */ } }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function json(r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) throw new Error(d.error || "Connexion difficile, réessayez."); return d; }); }
  function getJson(url) { return fetch(url).then(json); }
  function sit(body) {
    body.action = "sit";
    return fetch("/api/tables", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(json);
  }
  function current() { return tables.find(function (t) { return t.id === tableId; }) || null; }
  function plural(n, word) { return n + " " + word + (n > 1 ? "s" : ""); }
  function people(t) {
    return t.people.length
      ? '<div class="neighbours">' + t.people.map(function (p, i) {
          var mine = me && p.nom === me.nom;
          return '<span class="fx-pop' + (mine ? " is-me" : "") + '" style="animation-delay:' + Math.min(i * 0.04, 0.6) + 's">' +
            esc(p.nom) + (p.passagers > 1 ? " ×" + p.passagers : "") + "</span>";
        }).join("") + "</div>"
      : '<p class="muted">Personne encore&nbsp;: soyez le premier passager installé&nbsp;!</p>';
  }
  function fill(t) {
    var pct = Math.min(100, Math.round((t.count / Math.max(1, t.seats)) * 100));
    return '<div class="fill" role="img" aria-label="' + t.count + " sur " + t.seats + ' places"><i style="width:' + pct + '%"></i></div>';
  }
  function showError(msg) {
    var el = app.querySelector(".form-error");
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
  }

  /* ───────── Sans QR code : choisir sa table ───────── */
  function renderPicker(msg) {
    tag.textContent = "À table !";
    app.innerHTML =
      '<h1 class="live__title fx-rise">À table&nbsp;!</h1>' +
      '<p class="live__sub fx-rise">' + (msg || "Scannez le QR code posé sur votre table, ou choisissez-la ci-dessous.") + "</p>" +
      '<div class="table-grid">' + tables.map(function (t, i) {
        return '<a class="table-tile fx-press fx-rise' + (t.count >= t.seats ? " is-full" : "") + '" style="animation-delay:' + (0.04 * i) + 's" href="?t=' + encodeURIComponent(t.id) + '">' +
          "<b>" + esc(t.name) + "</b><small>" + (t.count ? t.count + " / " + t.seats + (t.count >= t.seats ? " · complet" : "") : "libre") + "</small>" + fill(t) + "</a>";
      }).join("") + "</div>";
  }

  /* ───────── Table choisie : qui êtes-vous ? ───────── */
  function renderWho() {
    var t = current();
    tag.textContent = t.name;
    app.innerHTML =
      '<div class="table-hero fx-rise"><p class="live__tag">Vous êtes à la</p><h1 class="table-hero__name">' + esc(t.name) + "</h1>" +
      '<p class="muted">' + (t.count ? plural(t.count, "passager") + " déjà installé" + (t.count > 1 ? "s" : "") : "Aucun passager pour l'instant") + "</p>" + fill(t) + "</div>" +
      (me ? '<div class="live-card center fx-rise" style="animation-delay:.08s" id="t-mebox"><p class="muted" style="margin:0">Vous êtes bien</p>' +
        '<p class="who-name">' + esc(me.nom) + "&nbsp;?</p>" +
        '<button class="btn btn--gold btn--block" id="t-me" type="button">Oui, je m\'installe ici</button>' +
        '<button class="linklike muted" id="t-notme" type="button" style="margin-top:.9rem">Ce n\'est pas moi</button></div>' : "") +
      '<form class="live-card fx-rise" id="t-search" style="animation-delay:.12s"' + (me ? " hidden" : "") + " novalidate>" +
      '<div class="field"><label for="t-q">Votre nom</label><input id="t-q" type="search" autocomplete="name" placeholder="Tapez au moins 3 lettres" /></div>' +
      '<div class="pick-list" id="t-results"></div>' +
      '<button type="button" class="linklike muted" id="t-new-toggle">Je ne suis pas dans la liste</button>' +
      '<div id="t-new" class="t-new" hidden>' +
      '<div class="field"><label for="t-nom">Prénom et nom</label><input id="t-nom" maxlength="80" autocomplete="name" /></div>' +
      '<div class="field"><label for="t-nb">Combien êtes-vous (vous compris)&nbsp;?</label><select id="t-nb"><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option><option>6</option></select></div>' +
      '<button type="button" class="btn btn--gold btn--block" id="t-new-go">Je m\'installe ici</button></div>' +
      '<p class="form-error" role="alert" hidden></p></form>' +
      '<div class="live-card fx-rise" style="animation-delay:.16s"><p class="live__tag" style="margin:0 0 .6rem">Déjà à cette table</p>' + people(t) + "</div>";

    function busy(btn, on) { if (btn) btn.disabled = on; }

    if (me) {
      document.getElementById("t-me").addEventListener("click", function () {
        var btn = this;
        busy(btn, true);
        sit({ table: tableId, id: me.id }).then(done).catch(function (err) {
          // invité introuvable (supprimé entre-temps) : retour à la recherche
          me = null;
          write("mc-me", null);
          renderWho();
          showError(err.message);
        });
      });
      document.getElementById("t-notme").addEventListener("click", function () {
        me = null;
        write("mc-me", null);
        renderWho();
      });
    }

    var q = document.getElementById("t-q"), results = document.getElementById("t-results"), timer, seq = 0;
    q.addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        var v = q.value.trim();
        if (v.length < 3) { results.innerHTML = ""; return; }
        var my = ++seq;
        getJson("/api/tables?q=" + encodeURIComponent(v)).then(function (d) {
          if (my !== seq) return;
          var list = d.results || [];
          results.innerHTML = list.map(function (r, i) {
            var where = r.table ? (r.table.id === tableId ? "déjà ici ✓" : "actuellement " + esc(r.table.name)) : "";
            return '<button type="button" class="fx-press fx-rise" style="animation-delay:' + (i * 0.03) + 's" data-i="' + i + '"><b>' + esc(r.nom) + "</b>" +
              (r.passagers > 1 ? " <span class=\"muted\">×" + r.passagers + "</span>" : "") + (where ? "<small>" + where + "</small>" : "") + "</button>";
          }).join("") || '<p class="muted">Personne à ce nom. Essayez votre nom de famille, ou «&nbsp;Je ne suis pas dans la liste&nbsp;».</p>';
          results.querySelectorAll("[data-i]").forEach(function (b) {
            b.addEventListener("click", function () {
              var r = list[parseInt(b.getAttribute("data-i"), 10)];
              busy(b, true);
              sit({ table: tableId, id: r.id }).then(done).catch(function (err) { busy(b, false); showError(err.message); });
            });
          });
        }).catch(function (err) { showError(err.message); });
      }, 250);
    });
    document.getElementById("t-search").addEventListener("submit", function (e) { e.preventDefault(); });
    document.getElementById("t-new-toggle").addEventListener("click", function () {
      var box = document.getElementById("t-new");
      box.hidden = !box.hidden;
      if (!box.hidden) {
        var guess = q.value.trim();
        if (guess && !document.getElementById("t-nom").value) document.getElementById("t-nom").value = guess;
        document.getElementById("t-nom").focus();
      }
    });
    document.getElementById("t-new-go").addEventListener("click", function () {
      var btn = this, nom = document.getElementById("t-nom").value.trim();
      if (nom.length < 2) return showError("Indiquez votre prénom et votre nom.");
      busy(btn, true);
      sit({ table: tableId, nom: nom, passagers: document.getElementById("t-nb").value }).then(done)
        .catch(function (err) { busy(btn, false); showError(err.message); });
    });
    if (!me) setTimeout(function () { q.focus({ preventScroll: true }); }, 80);
  }

  /* ───────── Installé ! ───────── */
  function done(d) {
    me = d.me;
    write("mc-me", me);
    write("mc-table", { id: d.table.id, name: d.table.name, at: Date.now() });
    tables = tables.map(function (t) { return t.id === d.table.id ? d.table : t; });
    if (navigator.vibrate) navigator.vibrate([30, 40, 30]);
    renderSeated(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (window.McFx) window.McFx.celebrate();
  }

  function renderSeated(first) {
    var t = current();
    tag.textContent = t.name;
    app.innerHTML =
      '<div class="table-hero' + (first ? " fx-land" : " fx-rise") + '"><p class="live__tag">Bienvenue à bord, ' + esc(me.nom.split(" ")[0]) + "</p>" +
      '<h1 class="table-hero__name">' + esc(t.name) + '</h1><p class="muted">C\'est noté&nbsp;: bon vol parmi nous&nbsp;!</p></div>' +
      '<div class="live-card fx-rise" style="animation-delay:.1s"><p class="live__tag" style="margin:0 0 .6rem">Votre tablée · <span id="t-count">' + plural(t.count, "passager") + "</span></p>" +
      '<div id="t-people">' + people(t) + "</div></div>" +
      '<div id="t-team"></div>' +
      '<div class="quick-links fx-rise" style="animation-delay:.2s">' +
      '<a class="btn btn--gold" href="/quiz">Quiz de bord</a>' +
      '<a class="btn btn--line-light" href="/boite">Boîte noire</a>' +
      '<a class="btn btn--line-light" href="/radio">Radio de bord</a></div>' +
      '<p class="center"><a class="linklike muted" href="/table">Changer de table</a></p>';
    clearInterval(refreshTimer);
    refreshTimer = setInterval(refresh, 10000);
    loadTeam();
  }

  /* Équipe du joueur, dès que l'équipage a publié les équipes */
  var teamSig = "";
  function loadTeam() {
    getJson("/api/teams").then(function (d) {
      var box = document.getElementById("t-team");
      if (!box) return;
      var mine = d.show && me ? (d.teams || []).filter(function (tm) {
        return tm.people.some(function (p) { return p.nom === me.nom; });
      })[0] : null;
      var sig = mine ? mine.name + mine.count + mine.color : "";
      if (sig === teamSig) return;
      teamSig = sig;
      box.innerHTML = mine
        ? '<div class="live-card team-card-live fx-land" style="--team:' + esc(mine.color) + '"><p class="live__tag" style="margin:0">Votre équipe pour les jeux</p>' +
          '<p class="team-card-live__name">Équipe ' + esc(mine.name) + "</p>" +
          '<p class="muted" style="margin:0">' + plural(mine.count, "passager") + " dans l'équipe" + (mine.tables && mine.tables.length && d.mode !== "mix" ? " · " + mine.tables.map(esc).join(", ") : "") + "</p>" +
          (d.mode === "mix" ? '<div class="neighbours">' + mine.people.map(function (p) { return "<span>" + esc(p.nom) + "</span>"; }).join("") + "</div>" : "") + "</div>"
        : "";
      if (mine && window.McFx) window.McFx.confetti({ x: 0.5, y: 0.5, count: 60, spread: 120, velocity: 10 });
    }).catch(function () {});
  }

  function refresh() {
    if (document.hidden) return;
    getJson("/api/tables").then(function (d) {
      tables = d.tables || tables;
      var t = current(), box = document.getElementById("t-people"), count = document.getElementById("t-count");
      if (!t || !box) return;
      var html = people(t);
      if (box.getAttribute("data-sig") !== String(t.count) + t.people.length) {
        box.innerHTML = html;
        box.setAttribute("data-sig", String(t.count) + t.people.length);
        count.textContent = plural(t.count, "passager");
      }
      loadTeam();
    }).catch(function () { /* on réessaiera au prochain tour */ });
  }

  getJson("/api/tables").then(function (d) {
    tables = d.tables || [];
    if (!tableId) return renderPicker();
    if (!current()) return renderPicker("Cette table n'existe pas (ou plus)&nbsp;: choisissez la vôtre ci-dessous.");
    var saved = read("mc-table");
    var seatedHere = me && saved && saved.id === tableId && current().people.some(function (p) { return p.nom === me.nom; });
    return seatedHere ? renderSeated(false) : renderWho();
  }).catch(function () {
    app.innerHTML = '<div class="live-card center"><p class="muted">Connexion difficile avec la tour de contrôle…</p>' +
      '<button class="btn btn--gold" type="button" onclick="location.reload()">Réessayer</button></div>';
  });
})();
