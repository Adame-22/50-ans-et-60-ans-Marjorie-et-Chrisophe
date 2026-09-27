(function () {
  "use strict";

  var REPAS = ["Standard", "Végétarien", "Végétalien", "Sans gluten", "Sans porc", "Enfant", "Autre"];
  var ROLE_LABEL = { admin: "Commandant", equipage: "Équipage" };

  var state = { me: null, rsvps: [], plan: null, users: [] };

  /* ───────── Utilitaires ───────── */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || "GET", credentials: "same-origin", headers: {} };
    if (opts.body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }
    return fetch(path, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) {
          var err = new Error(data.error || "Erreur " + r.status);
          err.status = r.status;
          throw err;
        }
        return data;
      });
    });
  }

  var toastTimer;
  function toast(msg, isErr) {
    var t = $("#toast");
    t.textContent = msg;
    t.classList.toggle("is-err", !!isErr);
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 3200);
  }

  function formError(form, msg) {
    var el = $(".form-error", form);
    if (!el) return;
    el.textContent = msg || "";
    el.hidden = !msg;
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }) + " " +
      d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  }

  function isSpecial(r) { return r.presence === "oui" && ((r.repas && r.repas !== "Standard") || r.allergies); }

  function onAuthError(e) {
    if (e.status === 401) { showView("login"); return true; }
    if (e.status === 403 && /mot de passe/.test(e.message)) { showView("password"); return true; }
    return false;
  }

  /* ───────── Vues ───────── */
  function showView(name) {
    ["login", "password", "app"].forEach(function (v) { $("#view-" + v).hidden = v !== name; });
    if (name === "login") setTimeout(function () { $("#l-user").focus(); }, 30);
    if (name === "password") setTimeout(function () { $("#fp-current").focus(); }, 30);
  }

  function setMe(user) {
    state.me = user;
    $all("[data-me=name]").forEach(function (el) { el.textContent = user.name; });
    $all("[data-me=roleLabel]").forEach(function (el) { el.textContent = ROLE_LABEL[user.role] || user.role; });
    $all("[data-admin-only]").forEach(function (el) { el.hidden = user.role !== "admin"; });
  }

  function enterApp(user) {
    setMe(user);
    if (user.mustChange) return showView("password");
    showView("app");
    selectTab(location.hash.slice(1) || "manifeste");
  }

  /* ───────── Connexion ───────── */
  $("#login-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var f = e.target, btn = $("button[type=submit]", f);
    formError(f, "");
    btn.disabled = true;
    api("/api/auth", { method: "POST", body: { action: "login", username: f.username.value.trim(), password: f.password.value } })
      .then(function (d) { f.reset(); enterApp(d.user); })
      .catch(function (err) { formError(f, err.message); })
      .then(function () { btn.disabled = false; });
  });

  function changePassword(f, done) {
    formError(f, "");
    var ok = $(".form-ok", f);
    if (ok) ok.hidden = true;
    if (f.next.value.length < 8) return formError(f, "Au moins 8 caractères, s'il vous plaît.");
    if (f.next.value !== f.confirm.value) return formError(f, "Les deux mots de passe ne correspondent pas.");
    var btn = $("button[type=submit]", f);
    btn.disabled = true;
    api("/api/auth", { method: "POST", body: { action: "password", current: f.current.value, next: f.next.value } })
      .then(function (d) { f.reset(); done(d.user); })
      .catch(function (err) { formError(f, err.message); })
      .then(function () { btn.disabled = false; });
  }

  $("#first-pass-form").addEventListener("submit", function (e) {
    e.preventDefault();
    changePassword(e.target, function (user) { enterApp(user); toast("Bienvenue à bord, " + user.name + " !"); });
  });

  $("#pass-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var f = e.target;
    changePassword(f, function (user) { setMe(user); $(".form-ok", f).hidden = false; });
  });

  $all("[data-action=logout]").forEach(function (b) {
    b.addEventListener("click", function () {
      api("/api/auth", { method: "POST", body: { action: "logout" } }).catch(function () {}).then(function () {
        state.me = null;
        showView("login");
      });
    });
  });

  /* ───────── Onglets ───────── */
  function selectTab(name) {
    var tab = $('[data-tab="' + name + '"]');
    if (!tab || tab.hidden) { name = "manifeste"; tab = $('[data-tab="manifeste"]'); }
    $all("[data-tab]").forEach(function (b) { b.setAttribute("aria-selected", String(b === tab)); });
    $all(".panel").forEach(function (p) { p.hidden = p.id !== "tab-" + name; });
    history.replaceState(null, "", "#" + name);
    if (name === "manifeste") loadRsvps();
    if (name === "cabine") loadCabin();
    if (name === "comptes") loadUsers();
    if (name === "constellation") loadGraph(); else destroyGraph();
    if (name === "quiz") startQuizAdmin(); else stopQuizAdmin();
    if (name === "boite") loadBoite();
    if (name === "radio") startRadio(); else clearTimeout(radioTimer);
  }
  $all("[data-tab]").forEach(function (b) {
    b.addEventListener("click", function () { selectTab(b.getAttribute("data-tab")); });
  });

  /* ───────── Manifeste ───────── */
  function loadRsvps() {
    return api("/api/rsvp").then(function (d) {
      state.rsvps = d.rsvps;
      renderRsvps();
    }).catch(function (e) { if (!onAuthError(e)) toast(e.message, true); });
  }

  function renderRsvps() {
    var list = state.rsvps;
    var yes = list.filter(function (r) { return r.presence === "oui"; });
    $("#s-total").textContent = list.length;
    $("#s-pax").textContent = yes.reduce(function (n, r) { return n + (r.passagers || 0); }, 0);
    $("#s-no").textContent = list.length - yes.length;
    $("#s-meal").textContent = list.filter(isSpecial).length;

    var q = $("#m-search").value.trim().toLowerCase();
    var f = $("#m-filter").value;
    var rows = list.filter(function (r) {
      if (q && (r.nom + " " + r.email + " " + r.message + " " + r.allergies).toLowerCase().indexOf(q) === -1) return false;
      if (f === "oui" || f === "non") return r.presence === f;
      if (f === "special") return isSpecial(r);
      return true;
    });

    $("#m-table tbody").innerHTML = rows.map(function (r) {
      var yesR = r.presence === "oui";
      return "<tr>" +
        "<td><b>" + esc(r.nom) + "</b>" + (r.email ? "<small>" + esc(r.email) + "</small>" : "") + "</td>" +
        "<td>" + (yesR ? '<span class="tag tag--ok">À bord</span>' : '<span class="tag tag--no">Au sol</span>') + "</td>" +
        "<td>" + (yesR ? r.passagers : "—") + "</td>" +
        "<td>" + (yesR ? (r.repas && r.repas !== "Standard" ? '<span class="tag tag--gold">' + esc(r.repas) + "</span>" : "Standard") : "—") + "</td>" +
        "<td>" + esc(r.allergies || "") + "</td>" +
        '<td class="msg">' + esc(r.message || "") + "</td>" +
        "<td>" + fmtDate(r.createdAt) + "</td>" +
        '<td class="actions"><button class="btn btn--small btn--line btn--danger" data-del="' + esc(r.id) + '">Supprimer</button></td>' +
        "</tr>";
    }).join("");
    $("#m-empty").hidden = rows.length > 0;
  }

  $("#m-search").addEventListener("input", renderRsvps);
  $("#m-filter").addEventListener("change", renderRsvps);

  $("#m-table").addEventListener("click", function (e) {
    var id = e.target.getAttribute("data-del");
    if (!id) return;
    var r = state.rsvps.find(function (x) { return x.id === id; });
    if (!r || !confirm("Supprimer la réponse de « " + r.nom + " » ?")) return;
    api("/api/rsvp?id=" + encodeURIComponent(id), { method: "DELETE" })
      .then(function () { toast("Réponse supprimée."); loadRsvps(); })
      .catch(function (err) { toast(err.message, true); });
  });

  $("#a-repas").innerHTML = REPAS.map(function (m) { return "<option>" + m + "</option>"; }).join("");
  $("#m-add").addEventListener("click", function () {
    var f = $("#add-pax");
    f.hidden = !f.hidden;
    if (!f.hidden) f.nom.focus();
  });
  $("#add-pax [data-close]").addEventListener("click", function () { $("#add-pax").hidden = true; });
  $("#add-pax").addEventListener("submit", function (e) {
    e.preventDefault();
    var f = e.target;
    formError(f, "");
    api("/api/rsvp", { method: "POST", body: {
      nom: f.nom.value, presence: f.presence.value, passagers: f.passagers.value, repas: f.repas.value, allergies: f.allergies.value
    } }).then(function () {
      f.reset();
      f.hidden = true;
      toast("Passager ajouté au manifeste.");
      loadRsvps();
    }).catch(function (err) { formError(f, err.message); });
  });

  function csvCell(v) {
    v = String(v == null ? "" : v);
    return /[";\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }

  $("#m-export").addEventListener("click", function () {
    var tableOf = {};
    if (state.plan) state.plan.tables.forEach(function (t) { tableOf[t.id] = t.name; });
    var head = ["Nom", "Présence", "Passagers", "Repas spécial", "Allergies", "E-mail", "Message", "Rang / table", "Reçu le"];
    var lines = [head.join(";")].concat(state.rsvps.map(function (r) {
      var table = state.plan && state.plan.assign[r.id] ? tableOf[state.plan.assign[r.id]] : "";
      return [r.nom, r.presence === "oui" ? "À bord" : "Au sol", r.passagers, r.repas, r.allergies, r.email, r.message, table, fmtDate(r.createdAt)]
        .map(csvCell).join(";");
    }));
    // BOM pour qu'Excel lise correctement les accents
    var blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "manifeste-MC5060.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });

  /* ───────── Plan de cabine ───────── */
  var sortables = [];
  var saveTimer;

  function loadCabin() {
    return Promise.all([api("/api/rsvp"), api("/api/seating")]).then(function (res) {
      state.rsvps = res[0].rsvps;
      state.plan = res[1];
      renderCabin();
    }).catch(function (e) { if (!onAuthError(e)) toast(e.message, true); });
  }

  function paxHtml(r) {
    var meal = r.repas && r.repas !== "Standard" ? '<span class="pax__meal">' + esc(r.repas) + "</span>" : "";
    var title = r.allergies ? ' title="Allergies : ' + esc(r.allergies) + '"' : "";
    return '<div class="pax" data-id="' + esc(r.id) + '"' + title + "><b>" + esc(r.nom) + "</b>" +
      '<span class="pax__n">×' + r.passagers + "</span>" + meal + (r.allergies ? " ⚠" : "") + "</div>";
  }

  function renderCabin() {
    sortables.forEach(function (s) { s.destroy(); });
    sortables = [];
    var plan = state.plan;
    var confirmed = state.rsvps.filter(function (r) { return r.presence === "oui"; })
      .sort(function (a, b) { return a.nom.localeCompare(b.nom, "fr"); });
    var ids = {};
    plan.tables.forEach(function (t) { ids[t.id] = true; });

    var pool = confirmed.filter(function (r) { return !ids[plan.assign[r.id]]; });
    $("#c-pool").innerHTML = pool.map(paxHtml).join("");

    $("#c-rows").innerHTML = plan.tables.map(function (t) {
      var inRow = confirmed.filter(function (r) { return plan.assign[r.id] === t.id; });
      return '<div class="row" data-row="' + esc(t.id) + '">' +
        '<div class="row__head">' +
        '<input class="row__name" value="' + esc(t.name) + '" aria-label="Nom du rang" maxlength="40" />' +
        '<span class="row__count"></span>' +
        '<input class="row__seats" type="number" min="1" max="40" value="' + t.seats + '" aria-label="Nombre de places" title="Places" />' +
        '<button class="row__del" type="button" title="Supprimer ce rang" aria-label="Supprimer ce rang">×</button>' +
        "</div>" +
        '<div class="dropzone" data-table="' + esc(t.id) + '">' + inRow.map(paxHtml).join("") + "</div>" +
        "</div>";
    }).join("");

    $all(".dropzone").forEach(function (zone) {
      sortables.push(new Sortable(zone, {
        group: "cabin",
        animation: 160,
        forceFallback: false,
        onStart: function () { document.body.classList.add("is-dragging"); },
        onEnd: function () { document.body.classList.remove("is-dragging"); },
        onAdd: function (evt) {
          var id = evt.item.getAttribute("data-id");
          var table = zone.getAttribute("data-table");
          if (table) state.plan.assign[id] = table; else delete state.plan.assign[id];
          updateCounts();
          scheduleSave();
        },
      }));
    });
    updateCounts();
  }

  function paxCount(zone) {
    return $all(".pax", zone).reduce(function (n, el) {
      var r = state.rsvps.find(function (x) { return x.id === el.getAttribute("data-id"); });
      return n + (r ? r.passagers : 0);
    }, 0);
  }

  function updateCounts() {
    $("#c-pool-count").textContent = paxCount($("#c-pool"));
    $all(".row").forEach(function (row) {
      var t = state.plan.tables.find(function (x) { return x.id === row.getAttribute("data-row"); });
      var n = paxCount($(".dropzone", row));
      $(".row__count", row).textContent = n + " / " + t.seats;
      row.classList.toggle("is-full", n > t.seats);
    });
  }

  function setSaveState(text, cls) {
    var el = $("#c-state");
    el.textContent = text;
    el.className = "save-state" + (cls ? " " + cls : "");
  }

  function scheduleSave() {
    setSaveState("Enregistrement…");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      api("/api/seating", { method: "PUT", body: state.plan })
        .then(function (plan) { state.plan = plan; setSaveState("Enregistré ✓", "is-ok"); })
        .catch(function (e) { if (!onAuthError(e)) setSaveState("Échec de l'enregistrement", "is-err"); });
    }, 500);
  }

  $("#c-rows").addEventListener("input", function (e) {
    var row = e.target.closest(".row");
    if (!row) return;
    var t = state.plan.tables.find(function (x) { return x.id === row.getAttribute("data-row"); });
    if (e.target.classList.contains("row__name")) t.name = e.target.value;
    if (e.target.classList.contains("row__seats")) t.seats = Math.max(1, parseInt(e.target.value, 10) || 1);
    updateCounts();
    scheduleSave();
  });

  $("#c-rows").addEventListener("click", function (e) {
    if (!e.target.classList.contains("row__del")) return;
    var id = e.target.closest(".row").getAttribute("data-row");
    var t = state.plan.tables.find(function (x) { return x.id === id; });
    if (!confirm("Supprimer « " + t.name + " » ? Ses passagers retourneront dans la liste « À placer ».")) return;
    state.plan.tables = state.plan.tables.filter(function (x) { return x.id !== id; });
    Object.keys(state.plan.assign).forEach(function (k) { if (state.plan.assign[k] === id) delete state.plan.assign[k]; });
    renderCabin();
    scheduleSave();
  });

  $("#c-add").addEventListener("click", function () {
    state.plan.tables.push({ id: "t" + Date.now().toString(36), name: "Rang " + (state.plan.tables.length + 1), seats: 8 });
    renderCabin();
    scheduleSave();
    var rows = $all(".row");
    rows[rows.length - 1].scrollIntoView({ behavior: "smooth", block: "center" });
  });

  /* ───────── Constellation ───────── */
  var graph = null;
  var graphGroup = "table";

  function destroyGraph() {
    if (graph) { graph.destroy(); graph = null; }
  }

  function loadGraph() {
    return Promise.all([api("/api/rsvp"), api("/api/seating")]).then(function (res) {
      state.rsvps = res[0].rsvps;
      state.plan = res[1];
      renderGraph();
    }).catch(function (e) { if (!onAuthError(e)) toast(e.message, true); });
  }

  function renderGraph() {
    destroyGraph();
    $("#g-info").hidden = true;
    var confirmed = state.rsvps.filter(function (r) { return r.presence === "oui"; });
    var tableName = {};
    state.plan.tables.forEach(function (t) { tableName[t.id] = t.name; });

    var nodes = [{ id: "mc", label: "Marjorie & Christophe", kind: "center" }];
    var links = [];
    var hubs = {};
    function hub(key, label) {
      if (!hubs[key]) {
        hubs[key] = true;
        nodes.push({ id: "h:" + key, label: label, kind: "hub" });
        links.push(["mc", "h:" + key]);
      }
      return "h:" + key;
    }
    confirmed.forEach(function (r) {
      var h;
      if (graphGroup === "table") {
        var t = state.plan.assign[r.id];
        h = tableName[t] ? hub(t, tableName[t]) : hub("_none", "À placer");
      } else {
        var m = r.repas || "Standard";
        h = hub(m, m);
      }
      nodes.push({
        id: r.id, kind: "guest", weight: r.passagers || 1, special: isSpecial(r),
        label: r.nom + (r.passagers > 1 ? " ×" + r.passagers : ""), data: r
      });
      links.push([h, r.id]);
    });

    var pax = confirmed.reduce(function (n, r) { return n + (r.passagers || 0); }, 0);
    $("#g-stats").textContent = confirmed.length + " réponse" + (confirmed.length > 1 ? "s" : "") + " à bord · " + pax + " passager" + (pax > 1 ? "s" : "");
    $("#g-hub-label").textContent = graphGroup === "table" ? "Table (rang)" : "Type de repas";
    $("#g-empty").hidden = confirmed.length > 0;

    graph = window.McGraph.mount($("#g-canvas"), { nodes: nodes, links: links }, { onSelect: showGraphInfo });
  }

  function showGraphInfo(n) {
    var box = $("#g-info");
    if (!n || n.kind !== "guest") { box.hidden = true; return; }
    var r = n.data;
    var t = state.plan.assign[r.id];
    var table = state.plan.tables.find(function (x) { return x.id === t; });
    box.innerHTML =
      '<p class="eyebrow">Passager</p><h3>' + esc(r.nom) + "</h3>" +
      "<dl>" +
      "<div><dt>Personnes</dt><dd>" + r.passagers + "</dd></div>" +
      "<div><dt>Table</dt><dd>" + (table ? esc(table.name) : "À placer") + "</dd></div>" +
      "<div><dt>Repas</dt><dd>" + esc(r.repas || "Standard") + "</dd></div>" +
      (r.allergies ? "<div><dt>Allergies</dt><dd>" + esc(r.allergies) + "</dd></div>" : "") +
      (r.message ? '<div class="wide"><dt>Message</dt><dd>' + esc(r.message) + "</dd></div>" : "") +
      "</dl>";
    box.hidden = false;
  }

  $all("[data-group]").forEach(function (b) {
    b.addEventListener("click", function () {
      graphGroup = b.getAttribute("data-group");
      $all("[data-group]").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
      if (state.plan) renderGraph();
    });
  });
  $("#g-fit").addEventListener("click", function () { if (graph) graph.fit(); });

  /* ───────── Quiz (animateur) ───────── */
  var PHASES = { off: "Fermé", lobby: "Embarquement", question: "Question", reveal: "Réponse", board: "Classement", podium: "Podium" };
  var qz = { timer: 0, questions: null, state: null, offset: 0, dirty: false, raf: 0 };

  function startQuizAdmin() {
    stopQuizAdmin();
    (function poll() {
      api("/api/quiz?view=admin").then(function (d) {
        qz.state = d.state; qz.offset = d.serverNow - Date.now();
        if (!qz.questions || !qz.dirty) { qz.questions = d.questions; renderQuizList(); }
        renderQuizStatus(d);
      }).catch(function (e) { onAuthError(e); }).then(function () {
        if (!$("#tab-quiz").hidden) qz.timer = setTimeout(poll, 1500);
      });
    })();
  }
  function stopQuizAdmin() { clearTimeout(qz.timer); cancelAnimationFrame(qz.raf); }

  function renderQuizStatus(d) {
    var st = d.state, q = d.questions[st.index];
    $("#qz-phase").textContent = PHASES[st.phase] || st.phase;
    $("#qz-index").textContent = st.index >= 0 ? (st.index + 1) + " / " + d.questions.length : "– / " + d.questions.length;
    $("#qz-players").textContent = d.players;
    $("#qz-answered").textContent = st.phase === "question" ? d.answered : (st.counts ? st.counts.reduce(function (a, b) { return a + b; }, 0) : "–");
    $("#qz-current").innerHTML = q && st.phase !== "off" && st.phase !== "lobby"
      ? "En cours : <b>" + esc(q.q) + "</b> — bonne réponse : <b>" + esc(q.choices[q.answer]) + "</b>" : "";
    $all(".qz-item").forEach(function (li, i) { li.classList.toggle("is-current", i === st.index && st.phase !== "off"); });
    cancelAnimationFrame(qz.raf);
    (function tick() {
      var rest = st.phase === "question" ? Math.max(0, st.endsAt - (Date.now() + qz.offset)) : 0;
      $("#qz-left").textContent = st.phase === "question" ? Math.ceil(rest / 1000) + " s" : "–";
      if (rest > 0) qz.raf = requestAnimationFrame(tick);
    })();
  }

  function renderQuizList() {
    $("#qz-list").innerHTML = qz.questions.map(function (q, i) {
      var ch = q.choices.concat(["", "", "", ""]).slice(0, 4);
      return '<li class="qz-item" data-i="' + i + '">' +
        '<div class="qz-item__head"><input type="text" class="qz-item__q" data-f="q" value="' + esc(q.q) + '" placeholder="Question" maxlength="200" />' +
        '<input type="number" class="qz-item__time" data-f="time" min="5" max="60" value="' + q.time + '" title="Secondes" /></div>' +
        '<div class="qz-choices">' + ch.map(function (c, j) {
          return '<label class="qz-choice"><input type="radio" name="qz-ok-' + i + '" data-f="answer" value="' + j + '"' + (q.answer === j ? " checked" : "") + ' title="Bonne réponse" />' +
            '<input type="text" data-f="c' + j + '" value="' + esc(c) + '" placeholder="Réponse ' + "ABCD"[j] + '" maxlength="80" /></label>';
        }).join("") + "</div>" +
        '<div class="qz-item__actions"><button type="button" class="btn btn--small btn--line" data-launch="' + i + '">Lancer celle-ci</button>' +
        '<button type="button" class="btn btn--small btn--line btn--danger" data-del-q="' + i + '">Supprimer</button></div></li>';
    }).join("");
  }

  function readQuizList() {
    return $all(".qz-item").map(function (li) {
      var get = function (f) { var el = li.querySelector('[data-f="' + f + '"]'); return el ? el.value : ""; };
      var ok = li.querySelector('[data-f="answer"]:checked');
      var choices = [0, 1, 2, 3].map(function (j) { return get("c" + j).trim(); });
      var answer = ok ? parseInt(ok.value, 10) : 0;
      // On retire les réponses vides en gardant l'index de la bonne réponse cohérent
      var kept = [], newAnswer = 0;
      choices.forEach(function (c, j) { if (c) { if (j === answer) newAnswer = kept.length; kept.push(c); } });
      return { q: get("q").trim(), choices: kept, answer: newAnswer, time: parseInt(get("time"), 10) || 20 };
    });
  }

  $("#qz-list").addEventListener("input", function () { qz.dirty = true; $("#qz-save-state").textContent = "Modifications non enregistrées"; });
  $("#qz-list").addEventListener("click", function (e) {
    var del = e.target.getAttribute("data-del-q"), launch = e.target.getAttribute("data-launch");
    if (del !== null) {
      qz.questions = readQuizList(); qz.questions.splice(parseInt(del, 10), 1); qz.dirty = true; renderQuizList();
      $("#qz-save-state").textContent = "Modifications non enregistrées";
    }
    if (launch !== null) {
      if (qz.dirty) return toast("Enregistrez d'abord les questions.", true);
      quizAction("start", { index: parseInt(launch, 10) });
    }
  });
  $("#qz-add").addEventListener("click", function () {
    qz.questions = readQuizList().concat([{ q: "", choices: ["", "", "", ""], answer: 0, time: 20 }]);
    qz.dirty = true; renderQuizList();
    var items = $all(".qz-item"); items[items.length - 1].querySelector("input").focus();
  });
  $("#qz-save").addEventListener("click", function () {
    var list = readQuizList();
    api("/api/quiz", { method: "PUT", body: { questions: list } }).then(function (d) {
      qz.questions = d.questions; qz.dirty = false; renderQuizList();
      $("#qz-save-state").textContent = "Enregistré ✓"; toast("Questions enregistrées.");
    }).catch(function (err) { toast(err.message, true); });
  });

  function quizAction(action, extra) {
    if (action === "reset" && !confirm("Remettre le quiz à zéro ? Les joueurs et les scores seront effacés.")) return;
    var body = Object.assign({ action: action }, extra || {});
    api("/api/quiz", { method: "POST", body: body }).then(function () { startQuizAdmin(); })
      .catch(function (err) { toast(err.message, true); });
  }
  $all("[data-qz]").forEach(function (b) {
    b.addEventListener("click", function () { quizAction(b.getAttribute("data-qz")); });
  });

  /* ───────── Boîte noire (modération) ───────── */
  function loadBoite() {
    return fetch("/api/boite", { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (d) {
      var list = d.entries || [];
      $("#bn-count").textContent = list.length;
      $("#bn-empty").hidden = list.length > 0;
      $("#bn-admin").innerHTML = list.map(function (e) {
        return '<article class="bn-card">' +
          (e.photo ? '<img loading="lazy" src="/api/boite?photo=' + encodeURIComponent(e.id) + '" alt="" />' : "") +
          (e.message ? "<p>" + esc(e.message) + "</p>" : "") +
          "<footer><small>" + esc(e.name) + " · " + fmtDate(e.createdAt) + "</small>" +
          '<button class="btn btn--small btn--line btn--danger" data-bn-del="' + esc(e.id) + '">Supprimer</button></footer></article>';
      }).join("");
    }).catch(function () { toast("Impossible de charger la boîte noire.", true); });
  }
  $("#bn-admin").addEventListener("click", function (e) {
    var id = e.target.getAttribute("data-bn-del");
    if (!id || !confirm("Supprimer ce message (et sa photo) ?")) return;
    api("/api/boite?id=" + encodeURIComponent(id), { method: "DELETE" })
      .then(function () { toast("Supprimé."); e.target.closest(".bn-card").remove(); })
      .catch(function (err) { toast(err.message, true); });
  });

  /* ───────── Radio de bord (vue DJ) ───────── */
  var radioTimer = 0;
  function startRadio() {
    clearTimeout(radioTimer);
    fetch("/api/radio", { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (d) {
      var songs = d.songs || [];
      $("#radio-empty").hidden = songs.length > 0;
      $("#radio-table tbody").innerHTML = songs.map(function (s) {
        return '<tr style="' + (s.played ? "opacity:.45" : "") + '">' +
          '<td><span class="pill">' + s.votes + "</span></td>" +
          "<td><b>" + esc(s.title) + "</b></td><td>" + esc(s.artist || "—") + "</td><td>" + fmtDate(s.createdAt) + "</td>" +
          '<td class="actions"><button class="btn btn--small btn--line" data-played="' + esc(s.id) + '" data-v="' + (s.played ? "0" : "1") + '">' + (s.played ? "Remettre" : "Jouée ✓") + "</button> " +
          '<button class="btn btn--small btn--line btn--danger" data-song-del="' + esc(s.id) + '">Supprimer</button></td></tr>';
      }).join("");
    }).catch(function () { /* on réessaie */ }).then(function () {
      if (!$("#tab-radio").hidden) radioTimer = setTimeout(startRadio, 5000);
    });
  }
  $("#radio-table").addEventListener("click", function (e) {
    var played = e.target.getAttribute("data-played"), del = e.target.getAttribute("data-song-del");
    if (played) {
      api("/api/radio", { method: "PATCH", body: { id: played, played: e.target.getAttribute("data-v") === "1" } })
        .then(startRadio).catch(function (err) { toast(err.message, true); });
    }
    if (del && confirm("Supprimer cette proposition ?")) {
      api("/api/radio?id=" + encodeURIComponent(del), { method: "DELETE" }).then(startRadio).catch(function (err) { toast(err.message, true); });
    }
  });

  /* ───────── Comptes ───────── */
  function loadUsers() {
    return api("/api/accounts").then(function (d) {
      state.users = d.users;
      renderUsers();
    }).catch(function (e) { if (!onAuthError(e)) toast(e.message, true); });
  }

  function renderUsers() {
    $("#acc-table tbody").innerHTML = state.users.map(function (u) {
      var self = u.username === state.me.username;
      var roleSel = '<select data-role="' + esc(u.username) + '"' + (self ? " disabled" : "") + ">" +
        Object.keys(ROLE_LABEL).map(function (r) {
          return '<option value="' + r + '"' + (u.role === r ? " selected" : "") + ">" + ROLE_LABEL[r] + "</option>";
        }).join("") + "</select>";
      return "<tr>" +
        "<td><b>" + esc(u.name) + "</b>" + (self ? " <small>(vous)</small>" : "") + "</td>" +
        "<td><code>" + esc(u.username) + "</code></td>" +
        "<td>" + roleSel + "</td>" +
        "<td>" + (u.mustChange ? '<span class="tag tag--gold">Code provisoire</span>' : '<span class="tag tag--ok">Actif</span>') + "</td>" +
        "<td>" + fmtDate(u.lastLogin) + "</td>" +
        '<td class="actions">' + (self ? "" :
          '<button class="btn btn--small btn--line" data-reset="' + esc(u.username) + '">Nouveau code</button> ' +
          '<button class="btn btn--small btn--line btn--danger" data-remove="' + esc(u.username) + '">Supprimer</button>') +
        "</td></tr>";
    }).join("");
  }

  function showCode(user, code) {
    var url = location.origin + "/admin";
    $("#code-title").textContent = user.name;
    $("#code-url").textContent = url;
    $("#code-user").textContent = user.username;
    $("#code-value").textContent = code;
    $("#code-copy").onclick = function () {
      var msg = "Bonjour " + user.name + " ! Voici ton accès à la tour de contrôle du vol MC 5060 :\n" +
        url + "\nIdentifiant : " + user.username + "\nCode provisoire : " + code +
        "\n(Tu choisiras ton propre mot de passe à la première connexion.)";
      navigator.clipboard.writeText(msg).then(function () { toast("Message copié."); }, function () { toast("Copie impossible, notez le code.", true); });
    };
    $("#code-modal").showModal();
  }
  $("[data-close-modal]").addEventListener("click", function () { $("#code-modal").close(); });

  $("#acc-name").addEventListener("input", function (e) {
    var u = $("#acc-user");
    if (u.dataset.touched) return;
    u.value = e.target.value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9._-]/g, "");
  });
  $("#acc-user").addEventListener("input", function (e) { e.target.dataset.touched = "1"; });

  $("#acc-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var f = e.target;
    formError(f, "");
    api("/api/accounts", { method: "POST", body: { name: f.name.value, username: f.username.value, role: f.role.value } })
      .then(function (d) {
        f.reset();
        delete $("#acc-user").dataset.touched;
        loadUsers();
        showCode(d.user, d.code);
      })
      .catch(function (err) { formError(f, err.message); });
  });

  $("#acc-table").addEventListener("change", function (e) {
    var username = e.target.getAttribute("data-role");
    if (!username) return;
    api("/api/accounts", { method: "PATCH", body: { username: username, role: e.target.value } })
      .then(function () { toast("Rôle mis à jour."); loadUsers(); })
      .catch(function (err) { toast(err.message, true); loadUsers(); });
  });

  $("#acc-table").addEventListener("click", function (e) {
    var reset = e.target.getAttribute("data-reset");
    var remove = e.target.getAttribute("data-remove");
    if (reset) {
      if (!confirm("Générer un nouveau code provisoire pour « " + reset + " » ? L'ancien mot de passe ne marchera plus.")) return;
      api("/api/accounts", { method: "PATCH", body: { username: reset, resetPassword: true } })
        .then(function (d) { loadUsers(); showCode(d.user, d.code); })
        .catch(function (err) { toast(err.message, true); });
    }
    if (remove) {
      if (!confirm("Supprimer définitivement le compte « " + remove + " » ?")) return;
      api("/api/accounts?username=" + encodeURIComponent(remove), { method: "DELETE" })
        .then(function () { toast("Compte supprimé."); loadUsers(); })
        .catch(function (err) { toast(err.message, true); });
    }
  });

  /* ───────── Démarrage ───────── */
  api("/api/auth").then(function (d) { enterApp(d.user); }).catch(function (e) {
    showView("login");
    if (e.status && e.status !== 401) toast(e.message, true);
  });
})();
