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
    if (name === "cabine") startCabin(); else stopCabin();
    if (name === "comptes") loadUsers();
    if (name === "constellation") loadGraph(); else destroyGraph();
    if (name === "equipes") startTeams(); else stopTeams();
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
    var paxIn = yes.filter(function (r) { return r.arrivedAt; }).reduce(function (n, r) { return n + (r.passagers || 0); }, 0);
    $("#s-arrived").textContent = paxIn + " / " + yes.reduce(function (n, r) { return n + (r.passagers || 0); }, 0);

    var q = $("#m-search").value.trim().toLowerCase();
    var f = $("#m-filter").value;
    var rows = list.filter(function (r) {
      if (q && (r.nom + " " + r.email + " " + r.message + " " + r.allergies).toLowerCase().indexOf(q) === -1) return false;
      if (f === "oui" || f === "non") return r.presence === f;
      if (f === "special") return isSpecial(r);
      if (f === "attendus") return r.presence === "oui" && !r.arrivedAt;
      if (f === "arrives") return !!r.arrivedAt;
      return true;
    });

    $("#m-table tbody").innerHTML = rows.map(function (r) {
      var yesR = r.presence === "oui";
      return "<tr>" +
        "<td>" + (yesR ? '<button class="checkin-btn' + (r.arrivedAt ? " is-in" : "") + '" data-checkin="' + esc(r.id) + '" title="' + (r.arrivedAt ? "Arrivé à " + fmtDate(r.arrivedAt) : "Pointer l'arrivée") + '" aria-label="Pointer l\'arrivée de ' + esc(r.nom) + '">✓</button>' : "") + "</td>" +
        "<td><b>" + esc(r.nom) + "</b>" + (r.source === "sur place" ? ' <span class="tag tag--gold" title="Ajouté·e depuis la page À table !, le jour J">sur place</span>' : "") +
        (r.email ? "<small>" + esc(r.email) + "</small>" : "") + "</td>" +
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
    var ci = e.target.getAttribute("data-checkin");
    if (ci) {
      var entry = state.rsvps.find(function (x) { return x.id === ci; });
      var arrived = !entry.arrivedAt;
      entry.arrivedAt = arrived ? new Date().toISOString() : null; // affichage immédiat
      renderRsvps();
      api("/api/rsvp", { method: "PATCH", body: { id: ci, arrived: arrived } })
        .then(function (d) { entry.arrivedAt = d.rsvp.arrivedAt; })
        .catch(function (err) { entry.arrivedAt = arrived ? null : new Date().toISOString(); renderRsvps(); toast(err.message, true); });
      return;
    }
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
    api("/api/seating").catch(function () { return state.plan || { tables: [], assign: {} }; }).then(exportCsv);
  });

  function exportCsv(plan) {
    var tableOf = {};
    plan.tables.forEach(function (t) { tableOf[t.id] = t.name; });
    var head = ["Nom", "Présence", "Passagers", "Repas spécial", "Allergies", "E-mail", "Message", "Table", "Arrivé à", "Reçu le"];
    var lines = [head.join(";")].concat(state.rsvps.map(function (r) {
      var table = plan.assign[r.id] ? tableOf[plan.assign[r.id]] || "" : "";
      return [r.nom, r.presence === "oui" ? "À bord" : "Au sol", r.passagers, r.repas, r.allergies, r.email, r.message, table,
        r.arrivedAt ? fmtDate(r.arrivedAt) : "", fmtDate(r.createdAt)]
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
  }

  /* ───────── Plan de cabine ─────────
     Les invités se placent eux-mêmes (page /table). Ici : vue en direct + corrections par glisser-déposer.
     Chaque déplacement est enregistré seul (PATCH), la liste des tables à part (PUT). */
  var sortables = [];
  var saveTimer, cabinTimer, cabinSig = "", seenAssign = null, pendingPatches = 0, tablesSaving = false;

  function cabinSignature(rsvps, plan) {
    return JSON.stringify([plan.tables, plan.assign, rsvps.map(function (r) { return [r.id, r.nom, r.passagers, r.presence, !!r.arrivedAt]; })]);
  }

  function loadCabin(quiet) {
    return Promise.all([api("/api/rsvp"), api("/api/seating")]).then(function (res) {
      var sig = cabinSignature(res[0].rsvps, res[1]);
      state.rsvps = res[0].rsvps;
      state.plan = res[1];
      if (!quiet || sig !== cabinSig) renderCabin();
      cabinSig = sig;
    }).catch(function (e) { if (!onAuthError(e) && !quiet) toast(e.message, true); });
  }

  function cabinBusy() {
    var a = document.activeElement;
    return document.body.classList.contains("is-dragging") || pendingPatches > 0 || tablesSaving ||
      (a && a.closest && a.closest("#c-rows") && a.tagName === "INPUT");
  }

  function startCabin() {
    stopCabin();
    loadCabin();
    cabinTimer = setInterval(function () {
      if (!document.hidden && !cabinBusy()) loadCabin(true);
    }, 5000);
  }
  function stopCabin() { clearInterval(cabinTimer); seenAssign = null; }

  function paxHtml(r, isNew) {
    var src = state.plan.src && state.plan.src[r.id];
    var meal = r.repas && r.repas !== "Standard" ? '<span class="pax__meal">' + esc(r.repas) + "</span>" : "";
    var title = (r.allergies ? "Allergies : " + r.allergies + " · " : "") + (src === "invite" ? "S'est installé·e depuis son téléphone" : src === "equipage" ? "Placé·e par l'équipage" : "");
    return '<div class="pax' + (r.arrivedAt ? " pax--arrived" : "") + (isNew ? " is-new" : "") + '" data-id="' + esc(r.id) + '"' +
      (title ? ' title="' + esc(title.replace(/ · $/, "")) + '"' : "") + "><b>" + esc(r.nom) + "</b>" +
      '<span class="pax__n">×' + r.passagers + "</span>" + meal + (r.allergies ? " ⚠" : "") +
      "</div>";
  }

  function renderCabin() {
    sortables.forEach(function (s) { s.destroy(); });
    sortables = [];
    var plan = state.plan;
    var confirmed = state.rsvps.filter(function (r) { return r.presence === "oui"; })
      .sort(function (a, b) { return a.nom.localeCompare(b.nom, "fr"); });
    var ids = {};
    plan.tables.forEach(function (t) { ids[t.id] = true; });
    // surligne ceux qui viennent de changer de table depuis le dernier affichage
    var fresh = {};
    if (seenAssign) Object.keys(plan.assign).forEach(function (k) { if (seenAssign[k] !== plan.assign[k]) fresh[k] = true; });
    seenAssign = Object.assign({}, plan.assign);

    var pool = confirmed.filter(function (r) { return !ids[plan.assign[r.id]]; })
      .sort(function (a, b) { return (b.arrivedAt ? 1 : 0) - (a.arrivedAt ? 1 : 0); });
    $("#c-pool").innerHTML = pool.map(function (r) { return paxHtml(r, false); }).join("");

    $("#c-rows").innerHTML = plan.tables.map(function (t) {
      var inRow = confirmed.filter(function (r) { return plan.assign[r.id] === t.id; });
      return '<div class="row" data-row="' + esc(t.id) + '">' +
        '<div class="row__head">' +
        '<input class="row__name" value="' + esc(t.name) + '" aria-label="Nom de la table" maxlength="40" />' +
        '<span class="row__count"></span>' +
        '<input class="row__seats" type="number" min="1" max="40" value="' + t.seats + '" aria-label="Nombre de places" title="Places" />' +
        '<button class="row__del" type="button" title="Supprimer cette table" aria-label="Supprimer cette table">×</button>' +
        "</div>" +
        '<div class="dropzone" data-table="' + esc(t.id) + '">' + inRow.map(function (r) { return paxHtml(r, fresh[r.id]); }).join("") + "</div>" +
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
          if (!state.plan.src) state.plan.src = {};
          if (table) state.plan.src[id] = "equipage"; else delete state.plan.src[id];
          seenAssign[id] = table || undefined;
          updateCounts();
          saveAssign(id, table);
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
    var pool = paxCount($("#c-pool"));
    $("#c-pool-count").textContent = pool;
    var seated = 0, full = 0;
    $all(".row").forEach(function (row) {
      var t = state.plan.tables.find(function (x) { return x.id === row.getAttribute("data-row"); });
      var n = paxCount($(".dropzone", row));
      seated += n;
      if (n >= t.seats) full++;
      $(".row__count", row).textContent = n + " / " + t.seats;
      row.classList.toggle("is-full", n > t.seats);
    });
    var total = seated + pool;
    var pct = total ? Math.round((seated / total) * 100) : 0;
    $("#c-stats").innerHTML =
      '<div><strong>' + seated + "</strong><span>à table</span></div>" +
      '<div><strong>' + pool + "</strong><span>pas encore à table</span></div>" +
      '<div><strong>' + state.plan.tables.length + "</strong><span>tables" + (full ? " · " + full + " complète" + (full > 1 ? "s" : "") : "") + "</span></div>" +
      '<div class="cabin-stats__bar" role="img" aria-label="' + pct + ' % des passagers sont à table"><i style="width:' + pct + '%"></i><em>' + pct + " %</em></div>";
  }

  function setSaveState(text, cls) {
    var el = $("#c-state");
    el.textContent = text;
    el.className = "save-state" + (cls ? " " + cls : "");
  }

  function saveAssign(id, table) {
    pendingPatches++;
    setSaveState("Enregistrement…");
    api("/api/seating", { method: "PATCH", body: { id: id, table: table || null } })
      .then(function () { setSaveState("Enregistré ✓", "is-ok"); })
      .catch(function (e) {
        if (onAuthError(e)) return;
        setSaveState("Échec de l'enregistrement", "is-err");
        toast(e.message, true);
      })
      .then(function () {
        pendingPatches--;
        if (!pendingPatches) loadCabin(true);
      });
  }

  // Noms et nombre de places des tables : enregistrés ensemble, avec un léger délai pendant la saisie
  function scheduleSave() {
    setSaveState("Enregistrement…");
    clearTimeout(saveTimer);
    tablesSaving = true;
    saveTimer = setTimeout(function () {
      api("/api/seating", { method: "PUT", body: { tables: state.plan.tables } })
        .then(function (d) {
          state.plan.tables = d.tables;
          state.plan.assign = d.assign;
          setSaveState("Enregistré ✓", "is-ok");
        })
        .catch(function (e) { if (!onAuthError(e)) setSaveState("Échec de l'enregistrement", "is-err"); })
        .then(function () { tablesSaving = false; });
    }, 500);
  }

  $("#c-rows").addEventListener("input", function (e) {
    var row = e.target.closest(".row");
    if (!row) return;
    var t = state.plan.tables.find(function (x) { return x.id === row.getAttribute("data-row"); });
    if (e.target.classList.contains("row__name")) t.name = e.target.value;
    if (e.target.classList.contains("row__seats")) t.seats = Math.min(40, Math.max(1, parseInt(e.target.value, 10) || 1));
    updateCounts();
    scheduleSave();
  });

  $("#c-rows").addEventListener("click", function (e) {
    if (!e.target.classList.contains("row__del")) return;
    var id = e.target.closest(".row").getAttribute("data-row");
    var t = state.plan.tables.find(function (x) { return x.id === id; });
    if (!confirm("Supprimer « " + t.name + " » ? Les passagers installés à cette table repasseront dans « Pas encore à table », et son QR code ne fonctionnera plus.")) return;
    state.plan.tables = state.plan.tables.filter(function (x) { return x.id !== id; });
    Object.keys(state.plan.assign).forEach(function (k) { if (state.plan.assign[k] === id) delete state.plan.assign[k]; });
    renderCabin();
    scheduleSave();
  });

  $("#c-add").addEventListener("click", function () {
    var used = {};
    state.plan.tables.forEach(function (t) { used[t.name] = true; });
    var n = state.plan.tables.length + 1;
    while (used["Table " + n]) n++;
    state.plan.tables.push({ id: "t" + Date.now().toString(36), name: "Table " + n, seats: 8 });
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
    return Promise.all([api("/api/rsvp"), api("/api/seating"), api("/api/teams?view=admin").catch(function () { return null; })]).then(function (res) {
      state.rsvps = res[0].rsvps;
      state.plan = res[1];
      state.teams = res[2];
      renderGraph();
    }).catch(function (e) { if (!onAuthError(e)) toast(e.message, true); });
  }

  function renderGraph() {
    destroyGraph();
    $("#g-info").hidden = true;
    var confirmed = state.rsvps.filter(function (r) { return r.presence === "oui"; });
    var tableName = {};
    state.plan.tables.forEach(function (t) { tableName[t.id] = t.name; });
    var teamOf = {}, teamName = {};
    if (state.teams) state.teams.teams.forEach(function (t) {
      teamName[t.id] = t.name;
      t.people.forEach(function (p) { teamOf[p.id] = t.id; });
    });

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
        h = tableName[t] ? hub(t, tableName[t]) : hub("_none", "Pas encore à table");
      } else if (graphGroup === "equipe") {
        var e = teamOf[r.id];
        h = e ? hub("e:" + e, "Équipe " + teamName[e]) : hub("_noteam", "Sans équipe");
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
    $("#g-hub-label").textContent = { table: "Table", equipe: "Équipe", repas: "Type de repas" }[graphGroup];
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
      "<div><dt>Table</dt><dd>" + (table ? esc(table.name) : "Pas encore à table") + "</dd></div>" +
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

  /* ───────── Équipes ─────────
     Construites à partir de qui est assis où (voir api/_teams.js). */
  var tm = { data: null, sig: "", timer: 0, sortables: [], busy: 0, pendingMode: null };
  var MODE_HINT = {
    tables: "Chaque table forme une équipe, automatiquement : un invité qui s'installe rejoint l'équipe de sa table. Renommez les équipes à votre guise.",
    groups: "Les tables sont réparties en équipes de taille équivalente : chacun joue avec sa tablée, sans bouger. Glissez une table d'une équipe à l'autre pour ajuster.",
    mix: "Les invités sont répartis en équipes équilibrées en mélangeant les tables, sans jamais séparer un même groupe (une réponse = une famille). Glissez un invité pour ajuster.",
  };

  function startTeams() {
    stopTeams();
    loadTeams();
    tm.timer = setInterval(function () { if (!document.hidden && !teamsBusy()) loadTeams(true); }, 8000);
  }
  function stopTeams() {
    clearInterval(tm.timer);
    tm.sortables.forEach(function (x) { x.destroy(); });
    tm.sortables = [];
  }
  function teamsBusy() {
    var a = document.activeElement;
    return document.body.classList.contains("is-dragging") || tm.busy > 0 || (a && a.classList && a.classList.contains("team-card__name"));
  }
  function setTeamsState(text, cls) {
    var el = $("#e-state");
    el.textContent = text;
    el.className = "save-state" + (cls ? " " + cls : "");
  }
  function loadTeams(quiet) {
    return api("/api/teams?view=admin").then(function (d) {
      var sig = JSON.stringify(d);
      if (quiet && sig === tm.sig) return;
      tm.sig = sig;
      tm.data = d;
      renderTeams();
    }).catch(function (e) { if (!onAuthError(e) && !quiet) toast(e.message, true); });
  }
  function teamsSend(body, method) {
    tm.busy++;
    setTeamsState("Enregistrement…");
    return api("/api/teams", { method: method || "PATCH", body: body })
      .then(function (d) {
        tm.data = d;
        tm.sig = JSON.stringify(d);
        renderTeams();
        setTeamsState("Enregistré ✓", "is-ok");
      })
      .catch(function (e) {
        if (onAuthError(e)) return;
        setTeamsState("Échec de l'enregistrement", "is-err");
        toast(e.message, true);
        loadTeams();
      })
      .then(function () { tm.busy--; });
  }

  function chipPerson(p) {
    return '<div class="pax" data-id="' + esc(p.id) + '"><b>' + esc(p.nom) + '</b><span class="pax__n">×' + p.passagers + "</span></div>";
  }
  function chipTable(id, name, n) {
    return '<div class="tchip" data-id="' + esc(id) + '"><b>' + esc(name) + "</b><span>" + n + "</span></div>";
  }
  function names(list) {
    return list.length ? list.map(function (p) { return esc(p.nom) + (p.passagers > 1 ? " <small>×" + p.passagers + "</small>" : ""); }).join(" · ") : '<span class="muted">Personne pour l\'instant</span>';
  }

  function renderTeams() {
    var d = tm.data, cfg = d.cfg;
    var mode = tm.pendingMode || cfg.mode;
    var pending = mode !== cfg.mode;
    $all("[data-mode]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-mode") === mode)); });
    $("#e-hint").textContent = MODE_HINT[mode];
    $("#e-gen").hidden = mode === "tables";
    $("#e-only-wrap").hidden = mode !== "mix";
    $("#e-generate").textContent = !pending && mode !== "tables" && d.teams.length ? "Refaire les équipes" : "Générer les équipes";
    $("#e-show").checked = cfg.show;
    $("#e-quiz").checked = cfg.quiz;

    var inTeams = d.teams.reduce(function (n, t) { return n + t.count; }, 0);
    var none = d.unassigned.reduce(function (n, p) { return n + p.passagers; }, 0);
    $("#e-stats").innerHTML = pending
      ? "Réglez le nombre d'équipes puis cliquez sur <b>Générer les équipes</b>. Les équipes actuelles restent en place d'ici là."
      : d.teams.length + " équipe" + (d.teams.length > 1 ? "s" : "") + " · " + inTeams + " passager" + (inTeams > 1 ? "s" : "") + " en équipe" +
        (none ? " · " + none + " sans équipe" : "") + (cfg.updatedAt ? " · modifié " + fmtDate(cfg.updatedAt) + (cfg.by ? " par " + esc(cfg.by) : "") : "") +
        (cfg.show ? " · <b>visibles par les invités</b>" : " · encore secrètes pour les invités");

    tm.sortables.forEach(function (x) { x.destroy(); });
    tm.sortables = [];
    var shown = pending ? [] : d.teams;
    var tableName = {};
    d.tables.forEach(function (t) { tableName[t.id] = t.name; });

    var html = shown.map(function (t, i) {
      var body;
      if (cfg.mode === "groups") {
        body = '<div class="team-card__drop" data-team="' + esc(t.id) + '">' + t.tables.map(function (id) {
          var n = t.people.filter(function (p) { return p.table === id; }).reduce(function (a, p) { return a + p.passagers; }, 0);
          return chipTable(id, tableName[id] || id, n);
        }).join("") + '</div><p class="team-card__people">' + names(t.people) + "</p>";
      } else if (cfg.mode === "mix") {
        body = '<div class="team-card__drop" data-team="' + esc(t.id) + '">' + t.people.map(chipPerson).join("") + "</div>";
      } else {
        body = '<p class="team-card__people">' + names(t.people) + "</p>";
      }
      return '<article class="team-card" style="--team:' + esc(t.color) + ";animation-delay:" + (Math.min(i, 12) * 0.04) + 's">' +
        '<header><input class="team-card__name" data-id="' + esc(t.id) + '" value="' + esc(t.name) + '" maxlength="40" aria-label="Nom de l\'équipe" />' +
        '<span class="team-card__count" title="personnes">' + t.count + "</span></header>" +
        body + "</article>";
    }).join("");

    // « sans équipe »
    if (!pending) {
      if (cfg.mode === "mix") {
        html += '<article class="team-card team-card--none"><header><h3>Sans équipe</h3><span class="team-card__count">' + none + "</span></header>" +
          '<div class="team-card__drop" data-team="">' + d.unassigned.map(chipPerson).join("") + "</div></article>";
      } else if (cfg.mode === "groups") {
        var used = {};
        d.teams.forEach(function (t) { t.tables.forEach(function (id) { used[id] = true; }); });
        var free = d.tables.filter(function (t) { return !used[t.id]; });
        html += '<article class="team-card team-card--none"><header><h3>Tables sans équipe</h3><span class="team-card__count">' + free.length + "</span></header>" +
          '<div class="team-card__drop" data-team="">' + free.map(function (t) { return chipTable(t.id, t.name, 0); }).join("") + "</div>" +
          (none ? '<p class="team-card__people">Pas encore à table&nbsp;: ' + names(d.unassigned) + "</p>" : "") + "</article>";
      } else if (d.unassigned.length) {
        html += '<article class="team-card team-card--none"><header><h3>Pas encore à table</h3><span class="team-card__count">' + none + "</span></header>" +
          '<p class="team-card__people">' + names(d.unassigned) + "</p></article>";
      }
    }
    $("#e-grid").innerHTML = html || '<p class="empty">Aucune équipe pour l\'instant.</p>';

    if (!pending && cfg.mode !== "tables") {
      $all("#e-grid .team-card__drop").forEach(function (zone) {
        tm.sortables.push(new Sortable(zone, {
          group: "teams",
          animation: 160,
          onStart: function () { document.body.classList.add("is-dragging"); },
          onEnd: function () { document.body.classList.remove("is-dragging"); },
          onAdd: function (evt) {
            teamsSend({ move: { id: evt.item.getAttribute("data-id"), team: zone.getAttribute("data-team") || null } });
          },
        }));
      });
    }
  }

  $all("[data-mode]").forEach(function (b) {
    b.addEventListener("click", function () {
      var mode = b.getAttribute("data-mode");
      if (!tm.data) return;
      if (mode === "tables") {
        tm.pendingMode = null;
        if (tm.data.cfg.mode !== "tables") teamsSend({ mode: "tables" }); else renderTeams();
        return;
      }
      tm.pendingMode = mode === tm.data.cfg.mode ? null : mode;
      renderTeams();
    });
  });
  $("#e-generate").addEventListener("click", function () {
    var mode = tm.pendingMode || tm.data.cfg.mode;
    if (mode === "tables") return;
    if (!tm.pendingMode && tm.data.teams.length && !confirm("Refaire toutes les équipes ? Les ajustements faits à la main seront perdus.")) return;
    tm.pendingMode = null;
    teamsSend({ action: "generate", mode: mode, count: $("#e-count").value, onlySeated: $("#e-only").checked }, "POST")
      .then(function () { toast("Équipes prêtes ✈"); });
  });
  $("#e-show").addEventListener("change", function () { teamsSend({ show: this.checked }); });
  $("#e-quiz").addEventListener("change", function () { teamsSend({ quiz: this.checked }); });
  $("#e-grid").addEventListener("change", function (e) {
    if (!e.target.classList.contains("team-card__name")) return;
    var name = e.target.value.trim();
    if (!name) { e.target.value = e.target.defaultValue; return; }
    teamsSend({ rename: { id: e.target.getAttribute("data-id"), name: name } });
  });
  $("#e-grid").addEventListener("keydown", function (e) {
    if (e.key === "Enter" && e.target.classList.contains("team-card__name")) e.target.blur();
  });

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
