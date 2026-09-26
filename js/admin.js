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
