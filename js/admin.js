(function () {
  "use strict";

  var REPAS = ["Standard", "Végétarien", "Végétalien", "Sans gluten", "Sans porc", "Enfant", "Autre"];
  var ROLE_LABEL = { superadmin: "Super admin", admin: "Commandant", hote: "Fêté·e (sans surprises)", equipage: "Équipage" };
  function isAdminRole(r) { return r === "admin" || r === "superadmin"; }

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

  var FARE = { midi: ["Business", "Midi"], soir: ["Premium", "Soir"], journee: ["Première", "Midi + soir"] };
  function fareOf(r) { return r.presence === "oui" ? r.creneau || "journee" : ""; }
  // Billet de chaque personne de la réponse : le répondant, ses accompagnants, puis le reste au billet du répondant
  function fares(r) {
    if (r.presence !== "oui") return [];
    var main = fareOf(r), out = [main], acc = r.creneauxAcc || [];
    for (var i = 1; i < (r.passagers || 1); i++) out.push(acc[i - 1] || main);
    return out;
  }
  function hasFare(r, f) { return fares(r).some(function (x) { return f === "midi-tous" ? x !== "soir" : f === "soir-tous" ? x !== "midi" : x === f; }); }
  function fareTags(r) {
    var by = {};
    fares(r).forEach(function (x) { by[x] = (by[x] || 0) + 1; });
    return Object.keys(by).map(function (k) {
      return '<span class="fare-tag fare-tag--' + k + '" title="' + FARE[k][0] + '">' + FARE[k][1] + (Object.keys(by).length > 1 || by[k] > 1 ? " ×" + by[k] : "") + "</span>";
    }).join(" ");
  }
  function companionsHtml(r) {
    var acc = r.accompagnants || [];
    if (!acc.length) return "";
    var fs = fares(r);
    return "<small>avec " + acc.map(function (n, i) { return esc(n) + " (" + FARE[fs[i + 1] || fs[0]][1].toLowerCase() + ")"; }).join(", ") + "</small>";
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
    $all("[data-admin-only]").forEach(function (el) { el.hidden = !isAdminRole(user.role); });
    $all("[data-super-only]").forEach(function (el) { el.hidden = user.role !== "superadmin"; });
    // Marjorie et Christophe : ni Boîte noire, ni quiz, ni messages des invités, ni sauvegarde
    var host = user.role === "hote";
    document.body.classList.toggle("is-host", host);
    $all("[data-nospoil]").forEach(function (el) { el.hidden = host; });
    $all("[data-not-host]").forEach(function (el) { el.hidden = host; });
    if (user.role === "superadmin" && $("#bk-left")) $("#bk-left").textContent = user.backupLeft ? user.backupLeft + " code(s) de secours encore valable(s)." : "Aucun code de secours pour l'instant.";
  }

  function enterApp(user) {
    setMe(user);
    if (user.mustChange) return showView("password");
    showView("app");
    selectTab(location.hash.slice(1) || "accueil");
    pollChat();
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
    if (!tab || tab.hidden) { name = "accueil"; tab = $('[data-tab="accueil"]'); }
    $all("[data-tab]").forEach(function (b) { b.setAttribute("aria-selected", String(b === tab)); });
    $all(".panel").forEach(function (p) { p.hidden = p.id !== "tab-" + name; });
    history.replaceState(null, "", "#" + name);
    if (name === "accueil") loadHome();
    if (name === "discussion") startChat(); else stopChat();
    if (name === "manifeste") { loadRsvps(); loadNotify(); }
    if (name === "envois") { loadRsvps(); loadNotify(); loadAnnounce(); }
    if (name === "liste") { loadListe(); loadNotify(); }
    if (name === "cabine") startCabin(); else stopCabin();
    if (name === "comptes") loadUsers();
    if (name === "constellation") loadGraph(); else destroyGraph();
    if (name === "equipes") startTeams(); else stopTeams();
    if (name === "quiz") startQuizAdmin(); else stopQuizAdmin();
    if (name === "boite") loadBoite();
    if (name === "partager") renderShare();
    if (name === "radio") startRadio(); else clearTimeout(radioTimer);
  }
  $all("[data-tab]").forEach(function (b) {
    b.addEventListener("click", function () { selectTab(b.getAttribute("data-tab")); });
  });

  /* ───────── Accueil : les chiffres, ce qu'il reste à faire, les gestes courants ───────── */
  var EVENT_DAY = new Date(2026, 10, 7), REMIND_FROM = new Date(2026, 10, 2);
  function plural(n, one, many) { return n + " " + (n > 1 ? many : one); }
  function countdown() {
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var d = Math.round((EVENT_DAY - today) / 86400000);
    return d > 1 ? "Plus que " + d + " jours avant la fête (samedi 7 novembre, 12h30)."
      : d === 1 ? "C'est demain ! Samedi 7 novembre, 12h30." : d === 0 ? "C'est aujourd'hui ! Bonne fête ✈" : "La fête a eu lieu le 7 novembre.";
  }
  function loadHome() {
    $("#h-countdown").textContent = countdown();
    Promise.all([api("/api/rsvp"), api("/api/rsvp?view=liste").catch(function () { return { rows: [] }; }), api("/api/rsvp?view=notify").catch(function () { return notify; }), fetchChat().catch(function () {})])
      .then(function (res) {
        state.rsvps = res[0].rsvps;
        liste = res[1];
        notify = res[2];
        renderHome(res[0].doublons || 0);
      }).catch(function (e) { if (!onAuthError(e)) toast(e.message, true); });
  }
  function renderHome(doublons) {
    var yes = state.rsvps.filter(function (r) { return r.presence === "oui"; }), all = [];
    yes.forEach(function (r) { all = all.concat(fares(r)); });
    $("#h-midi").textContent = all.filter(function (f) { return f !== "soir"; }).length;
    $("#h-soir").textContent = all.filter(function (f) { return f !== "midi"; }).length;
    $("#h-rep").textContent = state.rsvps.length;
    $("#h-rep-d").textContent = plural(all.length, "personne", "personnes") + (state.rsvps.length - yes.length ? " · " + (state.rsvps.length - yes.length) + " ne viennent pas" : "");

    var todo = [], m = liste.rows && liste.rows.length ? matchListe() : null;
    if (doublons) todo.push({ txt: plural(doublons, "inscription en double", "inscriptions en double") + " à regrouper.", btn: "Regrouper", go: "doublons" });
    if (m) {
      var missing = m.rows.filter(function (x) { return x.status === "manque"; });
      var ecart = m.rows.filter(function (x) { return x.ecart; });
      $("#h-fam-box").hidden = false;
      $("#h-fam").textContent = (m.rows.length - missing.length) + " / " + m.rows.length;
      $("#h-fam-d").textContent = missing.length ? plural(missing.length, "pas encore inscrite", "pas encore inscrites") : "toutes inscrites ✓";
      if (missing.length) todo.push({ txt: plural(missing.length, "famille de votre liste n'est", "familles de votre liste ne sont") + " pas encore inscrite" + (missing.length > 1 ? "s" : "") + " : " + missing.map(function (x) { return x.row.famille; }).join(", ") + ".", btn: "Voir", go: "liste:manque" });
      if (ecart.length) todo.push({ txt: plural(ecart.length, "famille n'a", "familles n'ont") + " pas le même nombre que dans votre liste : " + ecart.map(function (x) { return x.row.famille; }).join(", ") + ".", btn: "Voir", go: "liste:ecart" });
      if (m.extra.length) todo.push({ txt: plural(m.extra.length, "inscription n'est", "inscriptions ne sont") + " rattachée" + (m.extra.length > 1 ? "s" : "") + " à aucune famille de votre liste : " + m.extra.map(function (r) { return r.nom; }).join(", ") + ".", btn: "Voir", go: "liste" });
    } else {
      $("#h-fam-box").hidden = true;
      todo.push({ txt: "Importez votre liste Excel pour voir qui manque encore.", btn: "Importer", go: "liste" });
    }
    var unread = unreadCount();
    if (unread) todo.unshift({ txt: plural(unread, "nouveau message", "nouveaux messages") + " dans la discussion.", btn: "Lire", go: "discussion" });
    var today = new Date(), toRemind = yes.filter(function (r) { return r.email && !r.remindedAt; }).length;
    var noMail = yes.filter(function (r) { return !r.email; }).length;
    if (today >= REMIND_FROM && today < EVENT_DAY && toRemind) todo.push({ txt: "Envoyer le rappel avant la fête à " + plural(toRemind, "inscription", "inscriptions") + (noMail ? ", et prévenir par WhatsApp les " + noMail + " sans e-mail" : "") + ".", btn: "Envoyer", go: "envois", hot: true });
    else if (today < REMIND_FROM) todo.push({ txt: "Lundi 2 novembre : envoyer le rappel à tout le monde (un bouton dans « Messages »).", later: true });
    $("#h-todo").innerHTML = (todo.filter(function (t) { return !t.later; }).length ? "" : '<li class="todo__item todo__item--ok">✓ Tout est à jour : rien à faire pour l\'instant.</li>') +
      todo.map(function (t, i) {
        return '<li class="todo__item' + (t.later ? " todo__item--later" : "") + (t.hot ? " todo__item--hot" : "") + '"><span>' + esc(t.txt) + "</span>" +
          (t.btn ? '<button type="button" class="btn btn--small ' + (t.hot ? "btn--gold" : "btn--line") + '" data-todo="' + i + '">' + t.btn + "</button>" : "") + "</li>";
      }).join("");
    $all("[data-todo]").forEach(function (b) { b.addEventListener("click", function () { go(todo[+b.getAttribute("data-todo")].go); }); });
  }
  // Raccourcis de l'accueil : « liste:manque » ouvre la liste filtrée, « ajouter » ouvre une fiche vide…
  function go(where) {
    var parts = where.split(":");
    if (parts[0] === "ajouter") { selectTab("manifeste"); $("#m-add").click(); return; }
    if (parts[0] === "doublons") { selectTab("manifeste"); $("#m-dup").scrollIntoView({ block: "center" }); return; }
    if (parts[0] === "liste") setListeFilter(parts[1] || "");
    selectTab(parts[0]);
    window.scrollTo(0, 0);
  }
  $all("[data-go]").forEach(function (b) { b.addEventListener("click", function () { go(b.getAttribute("data-go")); }); });

  // Onglets peu utilisés avant le jour J : rangés derrière « Plus »
  $("#tabs-more").addEventListener("click", function () {
    var open = !$(".tabs").classList.contains("is-more");
    $(".tabs").classList.toggle("is-more", open);
    this.setAttribute("aria-expanded", String(open));
    this.innerHTML = (open ? "Moins" : "Plus") + ' <span aria-hidden="true">' + (open ? "▴" : "▾") + "</span>";
  });

  /* ───────── Discussion de l'équipe ───────── */
  var chat = { msgs: [], me: "", timer: null, bg: null };
  function chatSeen() { try { return localStorage.getItem("mc-chat-seen") || ""; } catch (e) { return ""; } }
  function setChatSeen(at) { try { localStorage.setItem("mc-chat-seen", at); } catch (e) { /* ignoré */ } }
  function unreadCount() {
    var seen = chatSeen();
    return chat.msgs.filter(function (m) { return m.user !== chat.me && m.at > seen; }).length;
  }
  function updateChatBadge() {
    var n = unreadCount(), b = $("#ch-badge");
    b.hidden = !n || $('[data-tab="discussion"]').getAttribute("aria-selected") === "true";
    b.textContent = n;
  }
  function fetchChat() {
    return api("/api/rsvp?view=chat").then(function (d) { chat.msgs = d.messages; chat.me = d.me; });
  }
  // Toutes les minutes, même ailleurs dans l'admin : la pastille des messages non lus
  function pollChat() {
    clearInterval(chat.bg);
    var tick = function () { if (!document.hidden) fetchChat().then(updateChatBadge).catch(function () {}); };
    tick();
    chat.bg = setInterval(tick, 60000);
  }
  function dayLabel(iso) {
    var d = new Date(iso), t = new Date(); t.setHours(0, 0, 0, 0);
    var diff = Math.round((t - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
    return diff === 0 ? "Aujourd'hui" : diff === 1 ? "Hier" : d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  }
  function renderChat() {
    var list = $("#ch-list"), atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60, day = "";
    var canDel = function (m) { return m.user === chat.me || (state.me && state.me.role === "superadmin"); };
    list.innerHTML = chat.msgs.length ? chat.msgs.map(function (m) {
      var dl = dayLabel(m.at), head = dl !== day ? '<p class="chat__day">' + esc(dl) + "</p>" : "";
      day = dl;
      var mine = m.user === chat.me;
      return head + '<div class="chat__msg' + (mine ? " chat__msg--me" : "") + (m.user === "claude" ? " chat__msg--ai" : "") + '">' +
        '<p class="chat__meta"><b>' + esc(mine ? "Vous" : m.by) + "</b> · " + new Date(m.at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) +
        (canDel(m) ? ' <button type="button" class="chat__del" data-del="' + esc(m.id) + '" aria-label="Effacer ce message">effacer</button>' : "") + "</p>" +
        '<p class="chat__text">' + esc(m.text).replace(/\n/g, "<br>") + "</p></div>";
    }).join("") : '<p class="chat__empty">Aucun message pour l\'instant. Écrivez le premier !</p>';
    if (atBottom || !chat.drawn) list.scrollTop = list.scrollHeight;
    chat.drawn = true;
    if (chat.msgs.length) setChatSeen(chat.msgs[chat.msgs.length - 1].at);
    updateChatBadge();
  }
  function startChat() {
    stopChat();
    chat.drawn = false;
    fetchChat().then(renderChat).catch(function (e) { if (!onAuthError(e)) toast(e.message, true); });
    chat.timer = setInterval(function () {
      if (document.hidden) return;
      var n = chat.msgs.length, last = n ? chat.msgs[n - 1].id : "";
      fetchChat().then(function () { var m = chat.msgs.length; if (m !== n || (m && chat.msgs[m - 1].id !== last)) renderChat(); }).catch(function () {});
    }, 8000);
  }
  function stopChat() { clearInterval(chat.timer); chat.timer = null; }
  $("#ch-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var ta = $("#ch-text"), text = ta.value.trim(), btn = this.querySelector("button");
    if (!text) { ta.focus(); return; }
    btn.disabled = true;
    api("/api/rsvp", { method: "POST", body: { action: "chat-post", text: text } })
      .then(function (d) { chat.msgs = d.messages; chat.me = d.me; ta.value = ""; chat.drawn = false; renderChat(); })
      .catch(function (x) { toast(x.message, true); })
      .then(function () { btn.disabled = false; ta.focus(); });
  });
  $("#ch-text").addEventListener("keydown", function (e) {
    // Entrée envoie (Maj + Entrée pour aller à la ligne) ; sur téléphone, le bouton Envoyer
    if (e.key === "Enter" && !e.shiftKey && !("ontouchstart" in window)) { e.preventDefault(); $("#ch-form").requestSubmit(); }
  });
  $("#ch-list").addEventListener("click", function (e) {
    var b = e.target.closest("[data-del]");
    if (!b || !confirm("Effacer ce message ?")) return;
    api("/api/rsvp", { method: "POST", body: { action: "chat-del", id: b.getAttribute("data-del") } })
      .then(function (d) { chat.msgs = d.messages; renderChat(); })
      .catch(function (x) { toast(x.message, true); });
  });

  /* ───────── Manifeste ───────── */
  function loadRsvps() {
    return api("/api/rsvp").then(function (d) {
      state.rsvps = d.rsvps;
      $("#m-dup").hidden = !d.doublons;
      $("#m-dup-n").textContent = d.doublons + " doublon" + (d.doublons > 1 ? "s" : "") + " à fusionner.";
      renderRsvps();
    }).catch(function (e) { if (!onAuthError(e)) toast(e.message, true); });
  }

  /* Envoi des cartes d'embarquement : automatique (Brevo) ou à la main depuis le téléphone */
  var notify = { email: false, sms: false, site: location.origin };
  function passLink(r) { return notify.site + "/billet?p=" + encodeURIComponent(r.passToken || ""); }
  function passText(r) {
    var first = r.prenom || String(r.nom || "").split(" ")[0];
    return "Bonjour " + first + " ! Voici votre carte d'embarquement pour les 50 & 60 ans de Marjorie et Christophe (samedi 7 novembre, 12h30, Draveil) : " + passLink(r);
  }
  function sendLinks(r) {
    if (r.presence !== "oui" || !r.passToken) return "";
    var out = "";
    if (r.email) out += '<a class="btn btn--small btn--line" title="Ouvrir un e-mail prêt à envoyer" href="mailto:' + encodeURIComponent(r.email) +
      "?subject=" + encodeURIComponent("✈ Votre carte d'embarquement · Vol MC 5060") + "&body=" + encodeURIComponent(passText(r)) + '">✉</a> ';
    out += '<a class="btn btn--small btn--line" title="Voir sa carte" target="_blank" rel="noopener" href="' + passLink(r) + '">Carte</a> ';
    return out;
  }
  var MAIL_HELP = {
    brevo: "Brevo : clé API « xkeysib-… » (Paramètres → SMTP & API → Clés API) ; expéditeur validé dans Brevo ; blocage des IP inconnues désactivé.",
    agentmail: "AgentMail : clé API (console.agentmail.to → API Keys) ; expéditeur = la boîte, ex. vol-mc5060@agentmail.to.",
  };
  var PROVIDER = { brevo: "Brevo", agentmail: "AgentMail" };
  function mailHelp() {
    var p = $("#mail-provider").value;
    $("#mail-help").textContent = MAIL_HELP[p] + (notify.source === "vercel" ? " Réglages actuels lus dans Vercel." : "");
    $("#mail-key").placeholder = notify.keyEnd && notify.provider === p ? "Enregistrée (…" + notify.keyEnd + ")" : p === "agentmail" ? "am_…" : "xkeysib-…";
    $("#mail-from").placeholder = p === "agentmail" ? "vol-mc5060@agentmail.to" : "adresse validée dans Brevo";
  }
  function renderNotify(d) {
    notify = d;
    $("#send-status").innerHTML = d.email
      ? "✓ Envoi automatique actif · " + esc(PROVIDER[d.provider] || d.provider) + (d.from ? " · " + esc(d.from) : "") + ". La carte part toute seule à chaque enregistrement."
      : "L'envoi automatique des e-mails n'est pas encore réglé" + (state.me && state.me.role === "superadmin" ? " (voir « Réglages » ci-dessous)." : " : prévenez Adame.");
    if (d.admin) {
      $("#mail-provider").value = d.provider || "brevo";
      $("#mail-from").value = d.from || "";
      $("#mail-name").value = d.fromName || "";
      $("#mail-key").value = "";
      $("#mail-off").hidden = d.source !== "admin";
      mailHelp();
      $("#mail-log").innerHTML = (d.log || []).slice(0, 5).map(function (l) {
        return '<li class="' + (l.ok ? "mail-log-ok" : "mail-log-err") + '">' + (l.ok ? "✓ " : "✕ ") + esc(l.to) + " · " + esc(l.detail) + " · " + fmtDate(l.at) + "</li>";
      }).join("");
    }
    updateSendButtons();
    renderRsvps();
  }
  function loadNotify() {
    api("/api/rsvp?view=notify").then(renderNotify).catch(function () {});
  }
  $("#mail-provider").addEventListener("change", mailHelp);
  $("#mail-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var form = this, err = form.querySelector(".form-error");
    err.hidden = true;
    api("/api/rsvp", { method: "POST", body: {
      action: "mail-config", provider: $("#mail-provider").value, key: $("#mail-key").value.trim(),
      from: $("#mail-from").value.trim(), fromName: $("#mail-name").value.trim(),
    } }).then(function (d) {
      d.admin = true; renderNotify(d);
      toast("Réglages enregistrés. Envoyez-vous un e-mail d'essai pour vérifier.");
      $("#mail-test-to").focus();
    }).catch(function (x) { err.textContent = x.message; err.hidden = false; });
  });
  $("#mail-test").addEventListener("submit", function (e) {
    e.preventDefault();
    var btn = this.querySelector("button"), to = $("#mail-test-to").value.trim();
    if (!to) { $("#mail-test-to").focus(); return; }
    btn.disabled = true; btn.textContent = "Envoi…";
    api("/api/rsvp", { method: "POST", body: { action: "mail-test", to: to } })
      .then(function (d) { d.admin = true; renderNotify(d); toast("E-mail d'essai envoyé à " + to + " : regardez aussi les spams."); })
      .catch(function (x) { toast(x.message, true); loadNotify(); })
      .then(function () { btn.disabled = false; btn.textContent = "Envoyer l'essai"; });
  });
  $("#mail-off").addEventListener("click", function () {
    if (!confirm("Désactiver l'envoi automatique des cartes par e-mail ?")) return;
    api("/api/rsvp", { method: "POST", body: { action: "mail-off" } })
      .then(function (d) { d.admin = true; renderNotify(d); toast("Envoi automatique désactivé."); })
      .catch(function (x) { toast(x.message, true); });
  });
  function pending(channel) {
    return state.rsvps.filter(function (r) {
      return r.presence === "oui" && (channel === "email" ? r.email && !r.emailedAt : r.telephone && !r.smsAt);
    });
  }
  function updateSendButtons() {
    var e = pending("email");
    $("#send-email").disabled = !notify.email || !e.length;
    $("#send-email").textContent = "Envoyer par e-mail (" + e.length + ")";
    renderRemind();
  }
  ["email"].forEach(function (ch) {
    $("#send-" + ch).addEventListener("click", function () {
      var list = pending(ch);
      if (!list.length || !confirm("Envoyer la carte d'embarquement par " + (ch === "sms" ? "SMS" : "e-mail") + " à " + list.length + " réponse(s) qui ne l'ont pas encore reçue ?")) return;
      var btn = this; btn.disabled = true; btn.textContent = "Envoi…";
      api("/api/rsvp", { method: "POST", body: { action: "send", channel: ch, ids: list.map(function (r) { return r.id; }) } })
        .then(function (d) {
          toast(d.sent + " envoyé(s)" + (d.errors.length ? ", " + d.errors.length + " erreur(s) — " + d.errors[0] : "") + ".", !!d.errors.length);
          if (d.errors.length) console.warn(d.errors);
          loadRsvps();
          loadNotify();
        }).catch(function (e) { toast(e.message, true); updateSendButtons(); });
    });
  });

  /* Rappel J-5 : récapitulatif complet, une seule fois par réponse */
  function remindText(r) {
    var first = r.prenom || String(r.nom || "").split(" ")[0];
    return "Bonjour " + first + " ! J-5 avant le vol MC 5060 ✈ Rendez-vous samedi 7 novembre à 12h30, salle des fêtes de Champrosay, rue du Bas de Champrosay à Draveil (à côté du stade de Champrosay et du centre aéré). Itinéraire : https://maps.app.goo.gl/hPMCvkp1w56v3Ffo6 · Dress code simple et chic, parking sur place." +
      (r.passToken ? " Votre carte d'embarquement : " + passLink(r) : "") + " À samedi !";
  }
  function renderRemind() {
    if (!$("#remind-box")) return;
    var going = state.rsvps.filter(function (r) { return r.presence === "oui"; });
    var todo = going.filter(function (r) { return r.email && !r.remindedAt; });
    var done = going.filter(function (r) { return r.remindedAt; }).length;
    var nomail = going.filter(function (r) { return !r.email; });
    $("#remind-status").textContent = !notify.email ? "L'envoi automatique d'e-mails n'est pas réglé."
      : todo.length ? todo.length + " réponse(s) à prévenir" + (done ? " · " + done + " déjà prévenue(s)" : "") + "."
      : done ? "✓ Tout le monde avec un e-mail a reçu le rappel (" + done + ")." : "Aucune réponse avec e-mail pour l'instant.";
    $("#remind-send").disabled = !notify.email || !todo.length;
    $("#remind-send").textContent = "Envoyer le rappel (" + todo.length + ")";
    $("#remind-nomail").hidden = !nomail.length;
    $("#remind-nomail-sum").textContent = nomail.length + " invité(s) sans e-mail : à prévenir à la main";
    $("#remind-list").innerHTML = nomail.map(function (r, i) {
      return "<li><span>" + esc(r.nom) + (r.telephone ? " · " + esc(r.telephone) : "") + '</span><button class="btn btn--small btn--line" type="button" data-remind-copy="' + i + '">Copier le message</button></li>';
    }).join("");
    $all("[data-remind-copy]").forEach(function (b) {
      b.addEventListener("click", function () {
        var t = remindText(nomail[+b.getAttribute("data-remind-copy")]);
        (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { toast("Message copié : collez-le dans WhatsApp."); }, function () { prompt("Copiez le message :", t); });
      });
    });
  }
  $("#remind-send").addEventListener("click", function () {
    var n = state.rsvps.filter(function (r) { return r.presence === "oui" && r.email && !r.remindedAt; }).length;
    if (!n || !confirm("Envoyer le rappel J-5 à " + n + " réponse(s) ?\n\nConseil : cliquez d'abord sur « Voir l'e-mail » pour le relire.")) return;
    var btn = this; btn.disabled = true; btn.textContent = "Envoi…";
    api("/api/rsvp", { method: "POST", body: { action: "remind" } })
      .then(function (d) {
        toast(d.sent + " rappel(s) envoyé(s)" + (d.errors.length ? ", " + d.errors.length + " erreur(s) — " + d.errors[0] : "") + ".", !!d.errors.length);
        loadRsvps(); loadNotify();
      }).catch(function (e) { toast(e.message, true); renderRemind(); });
  });

  /* Annonces push aux invités */
  function loadAnnounce() {
    api("/api/push?view=admin").then(function (d) {
      $("#an-count").textContent = d.subscribers + " téléphone" + (d.subscribers > 1 ? "s" : "") + " abonné" + (d.subscribers > 1 ? "s" : "");
      $("#an-log").innerHTML = d.announcements.map(function (a) {
        return "<li><b>" + esc(a.title) + "</b> " + esc(a.body) + " <small>· " + fmtDate(a.at) + " · " + esc(a.by || "") + " · " + a.sent + " reçu(s)</small></li>";
      }).join("");
    }).catch(function () {});
  }
  $("#announce").addEventListener("submit", function (e) {
    e.preventDefault();
    var f = e.target, body = $("#an-body").value.trim();
    formError(f, "");
    if (!body) return formError(f, "Écrivez le message de l'annonce.");
    if (!confirm("Envoyer cette annonce à tous les invités abonnés ?\n\n" + body)) return;
    var btn = f.querySelector("button[type=submit]"); btn.disabled = true;
    api("/api/push", { method: "POST", body: { action: "send", title: $("#an-title").value.trim(), body: body, url: $("#an-url").value } })
      .then(function (d) { toast("Annonce envoyée à " + d.sent + " téléphone(s)."); $("#an-body").value = ""; loadAnnounce(); })
      .catch(function (err) { formError(f, err.message); })
      .then(function () { btn.disabled = false; });
  });

  /* ───────── Liste des invités (fiches) ───────── */
  var filter = "";
  function peopleOf(r) {
    var fs = fares(r), names = [r.nom].concat(r.accompagnants || []);
    var n = r.presence === "oui" ? Math.max(1, r.passagers || 1) : 1;
    var out = [];
    for (var i = 0; i < n; i++) out.push({ nom: names[i] || "Passager " + (i + 1), creneau: fs[i] || fs[0] || "journee" });
    return out;
  }
  var FARE_SHORT = { midi: "Midi", soir: "Soir", journee: "Midi + soir" };
  function dupKey(r) { return String(r.nom || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]+/g, " ").trim(); }

  function renderRsvps() {
    var list = state.rsvps;
    var yes = list.filter(function (r) { return r.presence === "oui"; });
    var pax = yes.reduce(function (n, r) { return n + (r.passagers || 0); }, 0);
    var all = [];
    yes.forEach(function (r) { all = all.concat(fares(r)); });
    var cnt = function (t) { return all.filter(t).length; };
    $("#s-pax").textContent = pax;
    $("#s-pax-d").textContent = list.filter(isSpecial).length + " régime(s) ou allergie(s)";
    $("#s-midi").textContent = cnt(function (x) { return x !== "soir"; });
    $("#s-soir").textContent = cnt(function (x) { return x !== "midi"; });
    $("#s-total").textContent = list.length;
    $("#s-total-d").textContent = yes.length + " viennent · " + (list.length - yes.length) + " ne viennent pas";
    var paxIn = yes.filter(function (r) { return r.arrivedAt; }).reduce(function (n, r) { return n + (r.passagers || 0); }, 0);
    $("#s-arrived").textContent = paxIn + " / " + pax;
    $("#s-arrived-box").hidden = !paxIn;

    var seen = {};
    list.forEach(function (r) { var k = dupKey(r); seen[k] = (seen[k] || 0) + 1; });
    var q = $("#m-search").value.trim().toLowerCase();
    var rows = list.filter(function (r) {
      if (q && (r.nom + " " + (r.accompagnants || []).join(" ") + " " + (r.email || "") + " " + (r.telephone || "") + " " + (r.allergies || "")).toLowerCase().indexOf(q) === -1) return false;
      if (filter === "oui" || filter === "non") return r.presence === filter;
      if (filter === "special") return isSpecial(r);
      if (filter === "midi-tous" || filter === "soir-tous") return r.presence === "oui" && hasFare(r, filter);
      if (filter === "nomail") return !r.email;
      if (filter === "attendus") return r.presence === "oui" && !r.arrivedAt;
      return true;
    });
    $("#m-count").textContent = rows.length + " fiche" + (rows.length > 1 ? "s" : "") + (rows.length !== list.length ? " sur " + list.length : "");

    $("#m-list").innerHTML = rows.map(function (r) {
      var on = r.presence === "oui";
      var ppl = on ? peopleOf(r) : [];
      var tags = "";
      if (seen[dupKey(r)] > 1) tags += '<span class="tag tag--warn">en double</span>';
      if (r.updates) tags += '<span class="tag" title="A rempli le formulaire ' + (r.updates + 1) + ' fois">réinscrit·e</span>';
      if (r.editedAt) tags += '<span class="tag" title="Corrigée par ' + esc(r.editedBy || "l\'équipage") + " le " + fmtDate(r.editedAt) + '">corrigée</span>';
      if (r.source === "sur place") tags += '<span class="tag tag--gold">sur place</span>';
      if (r.source === "equipage") tags += '<span class="tag">ajoutée à la main</span>';
      if (on && r.repas && r.repas !== "Standard") tags += '<span class="tag tag--gold">' + esc(r.repas) + "</span>";
      if (on && r.allergies) tags += '<span class="tag tag--gold" title="' + esc(r.allergies) + '">allergie</span>';
      var contact = (r.email ? '<span title="' + esc(r.email) + '">✉ ' + (r.emailedAt ? "carte envoyée" : "carte pas encore envoyée") + "</span>" : '<span class="muted-warn">pas d\'e-mail</span>') +
        (r.telephone ? "<span>☏ " + esc(r.telephone) + "</span>" : "");
      return '<article class="guest' + (on ? "" : " guest--off") + (r.arrivedAt ? " guest--in" : "") + '" data-open="' + esc(r.id) + '" tabindex="0" role="button" aria-label="Ouvrir la fiche de ' + esc(r.nom) + '">' +
        '<div class="guest__main">' +
          '<div class="guest__name"><b>' + esc(r.nom) + "</b>" + tags + "</div>" +
          (on
            ? '<ul class="guest__pax">' + ppl.map(function (p) { return '<li><span>' + esc(p.nom) + '</span><em class="fare fare--' + p.creneau + '">' + FARE_SHORT[p.creneau] + "</em></li>"; }).join("") + "</ul>"
            : '<p class="guest__off">Ne vient pas</p>') +
          '<p class="guest__contact">' + contact + "</p>" +
        "</div>" +
        '<div class="guest__side">' +
          (on ? '<span class="pill pill--on">' + plural(r.passagers || 1, "personne", "personnes") + "</span>" : '<span class="pill pill--off">Ne vient pas</span>') +
          (r.arrivedAt ? '<span class="pill pill--in">Arrivé·e ✓</span>' : "") +
          '<span class="guest__open">Ouvrir ›</span>' +
        "</div>" +
      "</article>";
    }).join("");
    $("#m-empty").hidden = rows.length > 0;
    updateSendButtons();
  }

  $("#m-search").addEventListener("input", renderRsvps);
  $("#m-chips").addEventListener("click", function (e) {
    var b = e.target.closest("[data-f]");
    if (!b) return;
    filter = b.getAttribute("data-f");
    $all("#m-chips [data-f]").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
    renderRsvps();
  });
  $("#m-list").addEventListener("click", function (e) {
    var card = e.target.closest("[data-open]");
    if (card) openGuest(state.rsvps.find(function (x) { return x.id === card.getAttribute("data-open"); }));
  });
  $("#m-list").addEventListener("keydown", function (e) {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches("[data-open]")) { e.preventDefault(); e.target.click(); }
  });
  $("#m-add").addEventListener("click", function () { openGuest(null); });

  /* ───────── Fiche invité : ajouter ou corriger ───────── */
  var sheet = $("#guest-sheet"), gform = $("#guest-form"), current = null;
  $("#g-repas").innerHTML = REPAS.map(function (m) { return "<option>" + m + "</option>"; }).join("");

  function personRow(p, i) {
    var name = "g-f-" + Math.random().toString(36).slice(2, 8);
    return '<div class="person">' +
      '<input class="person__name" value="' + esc(p.nom || "") + '" placeholder="' + (i ? "Prénom et nom" : "Nom du passager principal") + '" aria-label="Nom" maxlength="80" />' +
      '<div class="fare-pick" role="radiogroup" aria-label="Billet">' +
        ["midi", "soir", "journee"].map(function (f) {
          return '<label><input type="radio" name="' + name + '" value="' + f + '"' + (p.creneau === f ? " checked" : "") + " /><span>" + FARE_SHORT[f] + "</span></label>";
        }).join("") +
      "</div>" +
      (i ? '<button type="button" class="person__del" aria-label="Retirer cette personne" title="Retirer">×</button>' : '<span class="person__main">principal</span>') +
    "</div>";
  }
  function renderPeople(list) { $("#g-people").innerHTML = list.map(personRow).join(""); }
  function readPeople() {
    return $all("#g-people .person").map(function (row) {
      var c = row.querySelector("input[type=radio]:checked");
      return { nom: row.querySelector(".person__name").value.trim(), creneau: c ? c.value : "journee" };
    });
  }
  function syncPresence() {
    var on = gform.presence.value === "oui";
    $all("#guest-sheet [data-if-oui]").forEach(function (el) { el.hidden = !on; });
  }
  $all('#guest-form input[name="presence"]').forEach(function (r) { r.addEventListener("change", syncPresence); });
  $("#g-add-person").addEventListener("click", function () {
    var list = readPeople();
    list.push({ nom: "", creneau: (list[0] && list[0].creneau) || "journee" });
    renderPeople(list);
    var rows = $all("#g-people .person__name");
    rows[rows.length - 1].focus();
  });
  $("#g-people").addEventListener("click", function (e) {
    if (!e.target.classList.contains("person__del")) return;
    e.target.closest(".person").remove();
  });

  function openGuest(r) {
    current = r || null;
    formError(gform, "");
    gform.reset();
    $("#g-title").textContent = r ? r.nom : "Nouvelle inscription";
    $("#g-kicker").textContent = r ? "Fiche invité · reçue le " + fmtDate(r.createdAt) : "Réponse reçue par téléphone, de vive voix…";
    $("#g-save").textContent = r ? "Enregistrer les corrections" : "Ajouter";
    gform.presence.value = r && r.presence !== "oui" ? "non" : "oui";
    renderPeople(r ? peopleOf(r) : [{ nom: "", creneau: "journee" }]);
    $("#g-repas").value = (r && r.repas) || "Standard";
    $("#g-all").value = (r && r.allergies) || "";
    $("#g-email").value = (r && r.email) || "";
    $("#g-tel").value = (r && r.telephone) || "";
    $("#g-msg").value = (r && r.message) || "";
    $("#g-actions").hidden = !r;
    if (r) {
      var hasPass = r.presence === "oui" && r.passToken;
      $("#g-open").hidden = !hasPass;
      if (hasPass) $("#g-open").href = passLink(r);
      $("#g-copy").hidden = !hasPass;
      $("#g-send").hidden = !hasPass || !r.email;
      $("#g-send-d").textContent = notify.email ? "à " + r.email + (r.emailedAt ? " · déjà envoyée le " + fmtDate(r.emailedAt) : "") : "ouvre votre messagerie, prête à envoyer";
      $("#g-arrive").hidden = r.presence !== "oui";
      $("#g-arrive").querySelector("b").textContent = r.arrivedAt ? "Annuler l'arrivée" : "Pointer l'arrivée";
      $("#g-arrive").querySelector("small").textContent = r.arrivedAt ? "arrivé·e à " + fmtDate(r.arrivedAt) : "le jour J";
      var tid = state.plan && state.plan.assign && state.plan.assign[r.id];
      var tObj = tid && state.plan.tables && state.plan.tables.find(function (t) { return t.id === tid; });
      var table = tObj ? tObj.name : tid;
      $("#g-meta").textContent = [
        r.updates ? "A rempli le formulaire " + (r.updates + 1) + " fois" : "",
        r.editedAt ? "Corrigée par " + (r.editedBy || "l'équipage") + " le " + fmtDate(r.editedAt) : "",
        table ? "Table : " + table : "",
      ].filter(Boolean).join(" · ");
    }
    syncPresence();
    if (sheet.showModal) sheet.showModal(); else sheet.setAttribute("open", "");
    setTimeout(function () { var n = $("#g-people .person__name"); if (!r && n) n.focus(); }, 50);
  }
  function closeGuest() { if (sheet.close) sheet.close(); else sheet.removeAttribute("open"); current = null; }
  $all("[data-sheet-close]").forEach(function (b) { b.addEventListener("click", closeGuest); });
  sheet.addEventListener("click", function (e) { if (e.target === sheet) closeGuest(); });

  gform.addEventListener("submit", function (e) {
    e.preventDefault();
    formError(gform, "");
    var people = readPeople().filter(function (p, i) { return i === 0 || p.nom; });
    if (!people[0].nom) return formError(gform, "Indiquez au moins le nom du passager principal.");
    var on = gform.presence.value === "oui";
    var body = {
      presence: gform.presence.value, people: people, repas: $("#g-repas").value, allergies: $("#g-all").value,
      email: $("#g-email").value.trim(), telephone: $("#g-tel").value.trim(),
    };
    if (!document.body.classList.contains("is-host")) body.message = $("#g-msg").value;
    var btn = $("#g-save"); btn.disabled = true;
    var req = current
      ? api("/api/rsvp", { method: "PATCH", body: { id: current.id, edit: body } })
      : api("/api/rsvp", { method: "POST", body: {
          source: "equipage", nom: people[0].nom, presence: body.presence, passagers: on ? people.length : 0,
          creneau: people[0].creneau, accompagnants: people.slice(1).map(function (p) { return p.nom; }),
          creneauxAcc: people.slice(1).map(function (p) { return p.creneau; }),
          repas: body.repas, allergies: body.allergies, email: body.email, telephone: body.telephone, message: body.message || "",
        } });
    req.then(function () {
      toast(current ? "Fiche corrigée." : "Réponse ajoutée.");
      closeGuest();
      loadRsvps();
    }).catch(function (err) { formError(gform, err.message); })
      .then(function () { btn.disabled = false; });
  });

  $("#g-send").addEventListener("click", function () {
    var r = current;
    if (!r) return;
    if (!notify.email) { location.href = "mailto:" + encodeURIComponent(r.email) + "?subject=" + encodeURIComponent("✈ Votre carte d'embarquement · Vol MC 5060") + "&body=" + encodeURIComponent(passText(r)); return; }
    if (!confirm("Renvoyer la carte d'embarquement à " + r.email + " ?")) return;
    var b = this; b.disabled = true;
    api("/api/rsvp", { method: "POST", body: { action: "send", channel: "email", ids: [r.id] } })
      .then(function (d) {
        if (d.errors && d.errors.length) toast(d.errors[0], true); else toast("Carte renvoyée à " + r.email + ".");
        closeGuest(); loadRsvps();
      }).catch(function (err) { toast(err.message, true); })
      .then(function () { b.disabled = false; });
  });
  $("#g-copy").addEventListener("click", function () {
    var r = current, text = passText(r);
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
      .then(function () { toast("Message et lien copiés : collez-les dans WhatsApp ou un SMS."); })
      .catch(function () { prompt("Copiez ce message :", text); });
  });
  $("#g-arrive").addEventListener("click", function () {
    var r = current, arrived = !r.arrivedAt;
    api("/api/rsvp", { method: "PATCH", body: { id: r.id, arrived: arrived } })
      .then(function () { toast(arrived ? r.nom + " est arrivé·e." : "Arrivée annulée."); closeGuest(); loadRsvps(); })
      .catch(function (err) { toast(err.message, true); });
  });
  $("#g-delete").addEventListener("click", function () {
    var r = current;
    if (!r || !confirm("Supprimer définitivement la réponse de « " + r.nom + " » ?")) return;
    api("/api/rsvp?id=" + encodeURIComponent(r.id), { method: "DELETE" })
      .then(function () { toast("Réponse supprimée."); closeGuest(); loadRsvps(); })
      .catch(function (err) { toast(err.message, true); });
  });


  // Inscriptions en double (même personne qui a rempli le formulaire plusieurs fois) : la plus récente l'emporte
  $("#m-dedupe").addEventListener("click", function () {
    if (!confirm("Fusionner les inscriptions en double ? Pour chaque personne, on garde une seule réponse : la plus récente, avec sa place à table et ses messages.")) return;
    api("/api/rsvp", { method: "POST", body: { action: "dedupe" } })
      .then(function (d) { toast(d.merged + " doublon" + (d.merged > 1 ? "s fusionnés" : " fusionné") + "."); loadRsvps(); })
      .catch(function (err) { toast(err.message, true); });
  });

  $("#m-export").addEventListener("click", function () {
    api("/api/seating").catch(function () { return state.plan || { tables: [], assign: {} }; }).then(exportCsv);
  });

  function exportCsv(plan) {
    var tableOf = {};
    plan.tables.forEach(function (t) { tableOf[t.id] = t.name; });
    var head = ["Nom", "Prénom", "Nom de famille", "Téléphone", "Accompagnants", "Présence", "Billet", "Personnes", "Régime alimentaire", "Allergies", "E-mail", "Message", "Table", "Arrivé à", "Reçu le"];
    var rows = state.rsvps.map(function (r) {
      var table = plan.assign[r.id] ? tableOf[plan.assign[r.id]] || "" : "";
      var fs = fares(r);
      return [r.nom, r.prenom || "", r.nomFamille || "", r.telephone || "", (r.accompagnants || []).map(function (n, i) { return n + " (" + FARE[fs[i + 1] || fs[0]][1] + ")"; }).join(", "), r.presence === "oui" ? "Vient" : "Ne vient pas", r.presence === "oui" ? FARE[fareOf(r)][1] : "", r.passagers, r.repas, r.allergies, r.email, r.message, table,
        r.arrivedAt ? fmtDate(r.arrivedAt) : "", fmtDate(r.createdAt)];
    });
    xlsx("Inscriptions (détail complet)", [{ name: "Inscriptions", rows: [head].concat(rows) }]);
  }

  /* ───────── Exports Excel (accueil) ───────── */
  function xlsx(title, sheets) {
    var d = new Date();
    // nom de fichier sans accents : certains téléphones et navigateurs les gèrent mal
    var name = ("Vol MC 5060 - " + title + " (" + d.getDate() + "-" + (d.getMonth() + 1) + ")").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    McXlsx.download(name + ".xlsx", sheets);
    toast("Fichier Excel téléchargé : regardez dans vos téléchargements.");
  }
  // Une ligne par personne : le répondant, puis ses accompagnants
  function personRows(r) {
    var names = [r.nom].concat(r.accompagnants || []), fs = fares(r);
    if (r.presence !== "oui") return [{ nom: r.nom, r: r, fare: "" }];
    return fs.map(function (f, i) { return { nom: names[i] || r.nom + " (+" + i + ")", r: r, fare: f }; });
  }
  function totals() {
    var all = [];
    state.rsvps.forEach(function (r) { all = all.concat(fares(r)); });
    return { midi: all.filter(function (f) { return f !== "soir"; }).length, soir: all.filter(function (f) { return f !== "midi"; }).length, pax: all.length };
  }
  var EXPORTS = {
    invites: function () {
      return api("/api/seating").catch(function () { return { tables: [], assign: {} }; }).then(function (plan) {
        var tableOf = {};
        (plan.tables || []).forEach(function (t) { tableOf[t.id] = t.name; });
        var rows = [];
        state.rsvps.slice().sort(function (a, b) { return a.nom.localeCompare(b.nom, "fr"); }).forEach(function (r) {
          personRows(r).forEach(function (p) {
            rows.push([p.nom, r.nom, r.presence === "oui" ? "Oui" : "Non", p.fare && p.fare !== "soir" ? "Oui" : "", p.fare && p.fare !== "midi" ? "Oui" : "",
              r.repas && r.repas !== "Standard" ? r.repas : "", r.allergies || "", plan.assign && plan.assign[r.id] ? tableOf[plan.assign[r.id]] || "" : "", r.email || "", r.telephone || ""]);
          });
        });
        var t = totals();
        xlsx("Liste des invités", [
          { name: "Invités", rows: [["Nom", "Inscrit avec", "Vient", "Midi", "Soir", "Régime", "Allergies", "Table", "E-mail", "Téléphone"]].concat(rows) },
          { name: "Totaux", rows: [["", "Nombre"], ["Au déjeuner (midi)", t.midi], ["Au dîner (soir)", t.soir], ["Personnes en tout", t.pax], ["Inscriptions", state.rsvps.length]] },
        ]);
      });
    },
    traiteur: function () {
      var t = totals(), yes = state.rsvps.filter(function (r) { return r.presence === "oui"; });
      var byRepas = {};
      yes.forEach(function (r) {
        var k = r.repas || "Standard", f = fares(r);
        byRepas[k] = byRepas[k] || { midi: 0, soir: 0 };
        byRepas[k].midi += f.filter(function (x) { return x !== "soir"; }).length;
        byRepas[k].soir += f.filter(function (x) { return x !== "midi"; }).length;
      });
      var special = yes.filter(function (r) { return (r.repas && r.repas !== "Standard") || r.allergies; });
      return Promise.resolve(xlsx("Pour le traiteur", [
        { name: "Totaux", rows: [["Repas", "Midi", "Soir"], ["Tous les invités", t.midi, t.soir]].concat(Object.keys(byRepas).sort().map(function (k) { return ["dont " + k, byRepas[k].midi, byRepas[k].soir]; })) },
        { name: "Régimes et allergies", rows: [["Inscription", "Personnes", "Régime", "Allergies / précisions", "Midi", "Soir"]].concat(special.map(function (r) {
          var f = fares(r);
          return [r.nom, r.passagers || 1, r.repas !== "Standard" ? r.repas : "", r.allergies || "", f.filter(function (x) { return x !== "soir"; }).length, f.filter(function (x) { return x !== "midi"; }).length];
        })) },
      ]));
    },
    tables: function () {
      return api("/api/seating").then(function (plan) {
        var rows = [], placed = {};
        (plan.tables || []).forEach(function (t) {
          state.rsvps.filter(function (r) { return r.presence === "oui" && plan.assign[r.id] === t.id; }).forEach(function (r) {
            placed[r.id] = 1;
            rows.push([t.name, r.nom, r.passagers || 1, [r.nom].concat(r.accompagnants || []).join(", ")]);
          });
        });
        state.rsvps.filter(function (r) { return r.presence === "oui" && !placed[r.id]; }).forEach(function (r) {
          rows.push(["Pas encore placé", r.nom, r.passagers || 1, [r.nom].concat(r.accompagnants || []).join(", ")]);
        });
        xlsx("Plan de table", [{ name: "Plan de table", rows: [["Table", "Inscription", "Personnes", "Noms"]].concat(rows) }]);
      });
    },
    liste: function () {
      return api("/api/rsvp?view=liste").then(function (l) {
        liste = l;
        if (!liste.rows || !liste.rows.length) { toast("Importez d'abord votre liste Excel dans « Liste prévue ».", true); return; }
        listeExport();
      });
    },
  };
  function runExport(kind, btn) {
    if (btn) btn.disabled = true;
    (state.rsvps.length ? Promise.resolve() : api("/api/rsvp").then(function (d) { state.rsvps = d.rsvps; }))
      .then(function () { return EXPORTS[kind](); })
      .catch(function (e) { toast(e.message, true); })
      .then(function () { if (btn) btn.disabled = false; });
  }
  $all("[data-export]").forEach(function (b) { b.addEventListener("click", function () { runExport(b.getAttribute("data-export"), b); }); });

  /* ───────── Liste prévue ─────────
     Le fichier Excel des familles invitées, croisé avec les inscriptions du site.
     Chaque famille est reconnue par ses prénoms / noms ; « links » fixe la correspondance à la main. */
  var liste = { rows: [] }, listeFilter = "", listeMatch = null, lsIndex = -1;

  function loadListe() {
    return Promise.all([api("/api/rsvp?view=liste"), api("/api/rsvp")]).then(function (res) {
      liste = res[0];
      state.rsvps = res[1].rsvps;
      renderListe();
    }).catch(function (e) { if (!onAuthError(e)) toast(e.message, true); });
  }
  function saveListe(msg) {
    return api("/api/rsvp", { method: "POST", body: { action: "liste-save", rows: liste.rows, file: liste.file || "" } })
      .then(function (d) { liste = d; renderListe(); if (msg) toast(msg); })
      .catch(function (e) { toast(e.message, true); });
  }

  /* Lecture d'un .xlsx sans bibliothèque : c'est un zip de fichiers XML */
  function inflateRaw(data) {
    if (typeof DecompressionStream === "undefined") return Promise.reject(new Error("Navigateur trop ancien pour lire le fichier : utilisez « Coller depuis Excel »."));
    return new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer()
      .then(function (b) { return new Uint8Array(b); });
  }
  function unzip(buf) {
    var dv = new DataView(buf), u8 = new Uint8Array(buf), eocd = -1, files = {}, jobs = [];
    for (var i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) return Promise.reject(new Error("Ce fichier n'est pas un fichier Excel (.xlsx)."));
    var off = dv.getUint32(eocd + 16, true);
    for (var k = dv.getUint16(eocd + 10, true); k > 0; k--) {
      var method = dv.getUint16(off + 10, true), size = dv.getUint32(off + 20, true);
      var nlen = dv.getUint16(off + 28, true), skip = dv.getUint16(off + 30, true) + dv.getUint16(off + 32, true);
      var loc = dv.getUint32(off + 42, true), name = new TextDecoder().decode(u8.subarray(off + 46, off + 46 + nlen));
      if (/^xl\/(sharedStrings|worksheets\/sheet\d+)\.xml$/.test(name)) {
        var start = loc + 30 + dv.getUint16(loc + 26, true) + dv.getUint16(loc + 28, true), data = u8.subarray(start, start + size);
        jobs.push((method === 0 ? Promise.resolve(data) : inflateRaw(data)).then(function (n) { return function (out) { files[n] = new TextDecoder().decode(out); }; }(name)));
      }
      off += 46 + nlen + skip;
    }
    return Promise.all(jobs).then(function () { return files; });
  }
  function xlsxGrid(files) {
    var xml = function (s) { return new DOMParser().parseFromString(s, "application/xml"); };
    var text = function (el) { return Array.prototype.map.call(el.getElementsByTagName("t"), function (t) { return t.textContent; }).join(""); };
    var shared = files["xl/sharedStrings.xml"] ? Array.prototype.map.call(xml(files["xl/sharedStrings.xml"]).getElementsByTagName("si"), text) : [];
    var sheet = Object.keys(files).filter(function (n) { return n.indexOf("worksheets/") > 0; }).sort()[0];
    if (!sheet) throw new Error("Aucune feuille trouvée dans le fichier.");
    return Array.prototype.map.call(xml(files[sheet]).getElementsByTagName("row"), function (row) {
      var out = [];
      Array.prototype.forEach.call(row.getElementsByTagName("c"), function (c) {
        var col = 0, letters = (c.getAttribute("r") || "").replace(/\d+/g, "");
        for (var i = 0; i < letters.length; i++) col = col * 26 + letters.charCodeAt(i) - 64;
        var t = c.getAttribute("t"), v = c.getElementsByTagName("v")[0], val = v ? v.textContent : "";
        if (t === "s") val = shared[+val] || "";
        else if (t === "inlineStr") val = text(c);
        out[(col || out.length + 1) - 1] = val;
      });
      return out;
    });
  }
  function textGrid(s) {
    var lines = String(s).replace(/\r/g, "").split("\n").filter(function (l) { return l.trim(); });
    var sep = lines.some(function (l) { return l.indexOf("\t") >= 0; }) ? "\t" : lines.some(function (l) { return l.indexOf(";") >= 0; }) ? ";" : ",";
    return lines.map(function (l) { return l.split(sep).map(function (c) { return c.replace(/^"|"$/g, "").trim(); }); });
  }
  // Repère les colonnes grâce à la ligne des titres (sinon : Familles, Enfants, Adultes, Envoi, Midi, Soir)
  function gridToRows(grid) {
    var COLS = { famille: /famil|^noms?$|invit/, enfants: /enfant/, adultes: /adulte/, envoi: /envoi|site|lien/, midi: /midi|dej/, soir: /soir|din/ };
    var at = { famille: 0, enfants: 1, adultes: 2, envoi: 3, midi: 4, soir: 5 }, head = -1;
    for (var i = 0; i < Math.min(grid.length, 10) && head < 0; i++) {
      var cells = (grid[i] || []).map(function (c) { return lnorm(c); });
      if (cells.some(function (c) { return COLS.famille.test(c); })) {
        head = i;
        Object.keys(COLS).forEach(function (k) {
          var j = cells.findIndex(function (c) { return COLS[k].test(c); });
          at[k] = j;
        });
      }
    }
    var num = function (v) { var n = parseInt(v, 10); return isNaN(n) ? null : n; };
    var cell = function (r, k) { return at[k] >= 0 && r[at[k]] != null ? String(r[at[k]]).trim() : ""; };
    var known = {};
    (liste.rows || []).forEach(function (r) { known[lnorm(r.famille)] = r; });
    return grid.slice(head + 1).map(function (r, i) {
      var fam = cell(r, "famille"), before = known[lnorm(fam)] || {};
      var envoi = cell(r, "envoi");
      return {
        id: before.id || "l" + Date.now().toString(36) + i,
        famille: fam,
        enfants: num(cell(r, "enfants")) || 0,
        adultes: num(cell(r, "adultes")) || 0,
        midi: num(cell(r, "midi")),
        soir: num(cell(r, "soir")),
        envoi: (!!envoi && !/^(non|n|0|-)$/i.test(envoi)) || !!before.envoi,
        links: before.links || null,
        alias: before.alias || "",
      };
    }).filter(function (r) { return r.famille && !/^total/.test(lnorm(r.famille)); });
  }
  function importGrid(grid, file) {
    var rows = gridToRows(grid);
    if (!rows.length) { toast("Aucune famille trouvée : vérifiez que la colonne « Familles » est bien là.", true); return; }
    var replacing = liste.rows.length;
    if (replacing && !confirm("Remplacer la liste actuelle (" + replacing + " familles) par celle-ci (" + rows.length + " familles) ?\n\nLes corrections faites à la main sont gardées pour les familles qui ont le même nom.")) return;
    liste.rows = rows;
    liste.file = file || "";
    saveListe(rows.length + " familles importées.");
    $("#l-paste").hidden = true;
  }
  $("#l-file").addEventListener("change", function () {
    var f = this.files[0];
    this.value = "";
    if (!f) return;
    var read = /\.xlsx$/i.test(f.name)
      ? f.arrayBuffer().then(unzip).then(xlsxGrid)
      : f.text().then(textGrid);
    read.then(function (g) { importGrid(g, f.name); }).catch(function (e) { toast(e.message || "Fichier illisible.", true); });
  });
  $("#l-import-toggle").addEventListener("click", function () {
    $("#l-import").classList.remove("is-compact");
    $("#l-import").dataset.opened = "1";
    this.hidden = true;
  });
  $("#l-paste-btn").addEventListener("click", function () { $("#l-paste").hidden = !$("#l-paste").hidden; if (!$("#l-paste").hidden) $("#l-paste-text").focus(); });
  $("#l-paste").addEventListener("submit", function (e) {
    e.preventDefault();
    var t = $("#l-paste-text").value;
    if (!t.trim()) { formError(this, "Collez d'abord les lignes copiées depuis Excel."); return; }
    formError(this, "");
    importGrid(textGrid(t), "collé depuis Excel");
  });

  /* Reconnaissance : prénoms et noms de la ligne (« Nadette/Jacquot », « Rivières ») contre ceux des inscriptions */
  function lnorm(s) {
    return String(s == null ? "" : s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  }
  var LSTOP = { et: 1, moi: 1, mme: 1, mr: 1, de: 1, du: 1, la: 1, le: 1, les: 1, famille: 1, fam: 1, chez: 1 };
  // « Jean-Jacques » reste un seul prénom
  function nameWords(s) { return lnorm(String(s == null ? "" : s).replace(/(\w)-(?=\w)/g, "$1")).split(" ").filter(function (t) { return t.length > 1; }); }
  function rowTokens(f) { return nameWords(f).filter(function (t) { return !LSTOP[t]; }); }
  // Surnoms → prénoms d'état civil (Tom reste Tom : un Thomas est quelqu'un d'autre)
  var NICK = {
    mc: ["mariechristine"], dany: ["daniel", "danielle", "daniele"], dani: ["daniel", "danielle", "daniele"],
    melo: ["melanie", "melodie"], mick: ["mickael", "michael", "mikael"], mike: ["mickael", "michael", "mikael"],
    nadette: ["bernadette"], jacquot: ["jacques"], fred: ["frederic", "frederique"], greg: ["gregory", "gregoire"],
    jj: ["jeanjacques"], steph: ["stephane", "stephanie"], killian: ["kylian", "kilian", "kyllian"],
    kylian: ["killian", "kilian", "kyllian"], kilian: ["killian", "kylian", "kyllian"],
  };
  // Le fichier est tenu par Marjorie : « moi », c'est elle, « Kiki », c'est Christophe → les fêtés, pas d'inscription à attendre
  function isHostRow(row) { return /(^| )(moi|kiki|marjorie|christophe)( |$)/.test(lnorm(row.famille)); }
  // Une case par personne de la ligne (+ « Autres noms »), avec ses variantes
  function rowSlots(row) {
    return rowTokens(row.famille + " " + (row.alias || "")).map(function (t) { return { key: t, alts: [t].concat(NICK[t] || []) }; });
  }
  function rsvpWords(r) {
    var w = nameWords([r.nom, r.prenom, r.nomFamille].concat(r.accompagnants || []).join(" "));
    return w.concat(w.slice(1).map(function (x, i) { return w[i] + x; })); // « Jean Jacques » écrit sans tiret
  }
  function oneEdit(a, b) { // une seule faute de frappe (« Chistine »)
    if (Math.abs(a.length - b.length) > 1) return false;
    var i = 0, j = 0, d = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++d > 1) return false;
      if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
    }
    return d + (a.length - i) + (b.length - j) <= 1;
  }
  // Paul / Pauline, Jean / Jeanne, Pascal / Pascale : deux personnes différentes
  function genderPair(a, b) {
    var s = a.length < b.length ? a : b, l = a.length < b.length ? b : a;
    return l.indexOf(s) === 0 && /^(e|ne|le|ine|ette|a)$/.test(l.slice(s.length));
  }
  function tokMatch(t, w) {
    if (t === w) return true;
    if (t.length < 4 || w.length < 4 || genderPair(t, w)) return false;
    var s = t.length < w.length ? t : w, l = t.length < w.length ? w : t;
    // diminutif au début ou à la fin (Nadette / Bernadette, Fred / Frédéric), pas un prénom composé (Jean / Jean-Jacques)
    var extra = l.length - s.length;
    if ((extra <= 4 && l.indexOf(s) === 0) || (extra <= 3 && l.slice(-s.length) === s)) return true;
    if (Math.min(t.length, w.length) >= 6 && oneEdit(t, w)) return true;
    var p = 0;
    while (p < t.length && t[p] === w[p]) p++;
    return p >= 5 && /ot$/.test(t); // Jacquot / Jacques, Pierrot / Pierre
  }
  function matchListe() {
    var byId = {}, owner = {}, pairs = [];
    state.rsvps.forEach(function (r) { byId[r.id] = r; });
    var rows = liste.rows.map(function (row) {
      var links = Array.isArray(row.links) ? row.links.filter(function (id) { return byId[id] && !owner[id]; }) : null;
      if (links) links.forEach(function (id) { owner[id] = row.id; });
      return { row: row, manual: !!links, ids: links || [] };
    });
    rows.forEach(function (m, i) {
      m.host = isHostRow(m.row);
      if (m.manual) return;
      if (m.host) { // si les fêtés se sont inscrits eux-mêmes, l'inscription va sur leur ligne
        state.rsvps.forEach(function (r) {
          if (!owner[r.id] && /^(marjorie|christophe)$/.test(lnorm(r.prenom || r.nom).split(" ")[0])) { owner[r.id] = m.row.id; m.ids.push(r.id); }
        });
        return;
      }
      var slots = rowSlots(m.row);
      m.covered = {};
      state.rsvps.forEach(function (r) {
        if (owner[r.id]) return;
        var words = rsvpWords(r), first = lnorm(r.prenom || r.nom).split(" ")[0];
        var fam = nameWords(r.nomFamille || String(r.nom || "").split(" ").slice(1).join(" "));
        var has = function (slot, list) { return slot.alts.some(function (a) { return list.some(function (w) { return tokMatch(a, w); }); }); };
        var hit = slots.filter(function (sl) { return has(sl, words); });
        if (!hit.length) return;
        // l'inscrit lui-même compte plus que ses accompagnants
        var own = slots.some(function (sl) { return has(sl, [first]); }) ? 0.5 : 0;
        pairs.push({ i: i, id: r.id, hit: hit.map(function (sl) { return sl.key; }), score: hit.length + own, share: hit.length / slots.length,
          // famille désignée par son nom (« Rivières ») : toutes les inscriptions à ce nom en font partie
          byName: hit.some(function (sl) { return has(sl, fam); }) });
      });
    });
    pairs.sort(function (a, b) { return b.score - a.score || b.share - a.share; });
    // sinon, une inscription n'est rattachée que si elle apporte quelqu'un de la famille pas encore trouvé
    pairs.forEach(function (p) {
      var m = rows[p.i];
      if (owner[p.id] || (!p.byName && !p.hit.some(function (t) { return !m.covered[t]; }))) return;
      p.hit.forEach(function (t) { m.covered[t] = 1; });
      owner[p.id] = m.row.id;
      m.ids.push(p.id);
    });
    rows.forEach(function (m) {
      var row = m.row, regs = m.ids.map(function (id) { return byId[id]; });
      var yes = regs.filter(function (r) { return r.presence === "oui"; }), all = [];
      yes.forEach(function (r) { all = all.concat(fares(r)); });
      m.regs = regs;
      m.real = { pax: all.length, midi: all.filter(function (f) { return f !== "soir"; }).length, soir: all.filter(function (f) { return f !== "midi"; }).length };
      m.pax = (row.adultes || 0) + (row.enfants || 0);
      m.status = m.host ? "fetes" : !regs.length ? "manque" : yes.length ? "ok" : "non";
      if (m.host) m.real = { pax: m.pax, midi: row.midi || 0, soir: row.soir || 0 };
      var planned = row.midi != null || row.soir != null;
      m.ecart = m.status === "ok" && (planned ? (m.real.midi !== (row.midi || 0) || m.real.soir !== (row.soir || 0)) : m.pax > 0 && m.real.pax !== m.pax);
      m.notes = [];
      if (!m.pax && planned) m.notes.push("nombre de personnes vide dans le fichier");
      else if (m.pax && Math.max(row.midi || 0, row.soir || 0) > m.pax) m.notes.push("fichier : " + Math.max(row.midi || 0, row.soir || 0) + " au repas pour " + m.pax + " personne" + (m.pax > 1 ? "s" : ""));
      if (!planned) m.notes.push("midi / soir pas indiqués dans le fichier");
    });
    var extra = state.rsvps.filter(function (r) { return !owner[r.id]; });
    return { rows: rows, extra: extra };
  }

  function planText(row) {
    var bits = [];
    if (!row.adultes && !row.enfants) bits.push("nombre de personnes ?");
    else bits.push(row.adultes + " adulte" + (row.adultes > 1 ? "s" : ""));
    if (row.enfants) bits.push(row.enfants + " enfant" + (row.enfants > 1 ? "s" : ""));
    bits.push(row.midi != null ? row.midi + " le midi" : "midi ?");
    bits.push(row.soir != null ? row.soir + " le soir" : "soir ?");
    return bits.join(" · ");
  }
  var LSTATUS = { ok: ["✓ Inscrite", "ok"], manque: ["Pas encore inscrite", "manque"], non: ["A répondu non", "non"], fetes: ["★ Les fêtés", "fetes"] };
  function renderListe() {
    var has = liste.rows.length;
    $("#l-body").hidden = !has;
    $("#l-export").hidden = !has;
    $("#l-import-title").textContent = has ? "Liste importée" : "Importer la liste";
    if (!has) $("#l-import").classList.remove("is-compact");
    else if (!$("#l-import").dataset.opened) $("#l-import").classList.add("is-compact");
    $("#l-import-toggle").hidden = !has || !$("#l-import").classList.contains("is-compact");
    $("#l-import-hint").textContent = has
      ? liste.rows.length + " familles" + (liste.file ? " · " + liste.file : "") + (liste.updatedAt ? " · mise à jour " + fmtDate(liste.updatedAt) + (liste.by ? " par " + liste.by : "") : "") + ". Pour la remplacer, importez une nouvelle version du fichier."
      : "Choisissez le fichier Excel (.xlsx) ou collez les lignes copiées depuis Excel. Colonnes reconnues : Familles, Enfants, Adultes, Envoi site, Midi, Soir.";
    if (!has) return;
    listeMatch = matchListe();
    var ms = listeMatch.rows, sum = function (f) { return ms.reduce(function (n, m) { return n + f(m); }, 0); };
    var answered = ms.filter(function (m) { return m.status !== "manque"; }).length;
    $("#l-k-fam").textContent = answered + " / " + ms.length;
    $("#l-k-fam-d").textContent = (ms.length - answered) + " pas encore inscrite" + (ms.length - answered > 1 ? "s" : "");
    $("#l-k-midi").textContent = sum(function (m) { return m.real.midi; });
    $("#l-k-midi-d").textContent = "inscrits · " + sum(function (m) { return m.row.midi || 0; }) + " prévus";
    $("#l-k-soir").textContent = sum(function (m) { return m.real.soir; });
    $("#l-k-soir-d").textContent = "inscrits · " + sum(function (m) { return m.row.soir || 0; }) + " prévus";
    var todo = ms.filter(canInscribe);
    $("#l-missing").hidden = !todo.length;
    $("#l-missing-n").textContent = todo.length + " famille" + (todo.length > 1 ? "s" : "") + " de la liste ne " + (todo.length > 1 ? "sont" : "est") + " pas encore inscrite" + (todo.length > 1 ? "s" : "") + ".";
    $("#l-k-envoi").textContent = ms.filter(function (m) { return !m.row.envoi && m.status === "manque"; }).length;

    var show = ms.map(function (m, i) { m.i = i; return m; }).filter(function (m) {
      return !listeFilter || (listeFilter === "manque" ? m.status === "manque" : listeFilter === "envoi" ? !m.row.envoi && m.status === "manque" : listeFilter === "ecart" ? m.ecart : m.status !== "manque");
    });
    $("#l-count").textContent = show.length + " famille" + (show.length > 1 ? "s" : "");
    $("#l-list").innerHTML = show.map(function (m) {
      var row = m.row, st = LSTATUS[m.status];
      var regs = m.regs.map(function (r) {
        return "<li><span>" + esc(r.nom) + (r.passagers > 1 ? " +" + (r.passagers - 1) : "") + "</span> " + (r.presence === "oui" ? fareTags(r) : '<em class="fare">ne vient pas</em>') + "</li>";
      }).join("");
      return '<div class="guest liste-row liste-row--' + st[1] + (m.ecart ? " liste-row--ecart" : "") + '" tabindex="0" role="button" data-li="' + m.i + '">' +
        '<div class="guest__main"><div class="guest__name"><b>' + esc(row.famille) + "</b>" +
        '<span class="l-pill l-pill--' + st[1] + '">' + st[0] + "</span>" +
        (m.ecart ? '<span class="l-pill l-pill--ecart">⚠ Nombres différents</span>' : "") +
        (!row.envoi && m.status === "manque" ? '<span class="l-pill l-pill--envoi">Lien jamais envoyé</span>' : "") + "</div>" +
        '<p class="liste-row__plan"><b>Prévu</b> ' + esc(planText(row)) + "</p>" +
        (m.status === "ok" ? '<p class="liste-row__plan"><b>Inscrits</b> ' + m.real.pax + " personne" + (m.real.pax > 1 ? "s" : "") + " · " + m.real.midi + " le midi · " + m.real.soir + " le soir</p>" : "") +
        (regs ? '<ul class="guest__pax">' + regs + "</ul>" : "") +
        (m.notes.length ? '<p class="liste-row__note">' + esc(m.notes.join(" · ")) + "</p>" : "") +
        "</div>" +
        '<div class="guest__side"><span class="guest__open">' + (m.host ? "pas d'inscription attendue" : m.manual ? "corrigé à la main" : m.regs.length ? "reconnu auto" : "") + " ›</span></div></div>";
    }).join("") || '<p class="empty">Aucune famille dans ce filtre.</p>';
    $all("[data-li]").forEach(function (el) {
      var open = function () { openListeSheet(+el.getAttribute("data-li")); };
      el.addEventListener("click", open);
      el.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
    });
    var extra = listeMatch.extra;
    $("#l-extra").hidden = !extra.length;
    $("#l-extra-list").innerHTML = extra.map(function (r) {
      return "<li><b>" + esc(r.nom) + "</b>" + ((r.accompagnants || []).length ? " avec " + esc(r.accompagnants.join(", ")) : "") + " " + (r.presence === "oui" ? fareTags(r) : '<em class="fare">ne vient pas</em>') + "</li>";
    }).join("");
  }
  function setListeFilter(f) {
    listeFilter = f;
    $all("#l-chips button").forEach(function (x) { x.setAttribute("aria-pressed", String(x.getAttribute("data-f") === f)); });
  }
  $all("#l-chips button").forEach(function (b) {
    b.addEventListener("click", function () { setListeFilter(b.getAttribute("data-f")); renderListe(); });
  });

  /* Inscrire une famille de la liste avec ses nombres prévus (prénoms de la ligne, midi / soir de l'Excel) */
  function capName(n) { return n.toLowerCase().replace(/(^|[\s-])(\S)/g, function (a, sp, c) { return sp + c.toUpperCase(); }); }
  function planPeople(row) {
    var midi = row.midi || 0, soir = row.soir || 0;
    if (!midi && !soir) return null; // midi / soir pas indiqués : à compléter à la main
    var both = Math.min(midi, soir), f = [];
    for (var i = 0; i < both; i++) f.push("journee");
    for (i = both; i < midi; i++) f.push("midi");
    for (i = both; i < soir; i++) f.push("soir");
    var names = row.famille.split(/\/|,|&|\bet\b/i).map(function (x) { return x.trim(); })
      .filter(function (x) { return x && !/^moi$/i.test(x); }).map(capName);
    if (!names.length) names = [capName(row.famille)];
    return f.map(function (fare, k) { return { nom: names[k] || "Personne " + (k + 1) + " · " + names[0], creneau: fare }; });
  }
  function canInscribe(m) { return m.status === "manque" && !m.host && !!planPeople(m.row); }
  function inscribe(m) {
    var people = planPeople(m.row);
    return api("/api/rsvp", { method: "POST", body: {
      source: "equipage", nom: people[0].nom, presence: "oui", passagers: people.length, creneau: people[0].creneau,
      accompagnants: people.slice(1).map(function (p) { return p.nom; }), creneauxAcc: people.slice(1).map(function (p) { return p.creneau; }),
    } }).then(function (d) { m.row.links = [d.id]; });
  }
  function inscribeAll(list) {
    return list.reduce(function (p, m) { return p.then(function () { return inscribe(m); }); }, Promise.resolve())
      .then(function () { return saveListe(list.length + " famille" + (list.length > 1 ? "s" : "") + " inscrite" + (list.length > 1 ? "s" : "") + "."); })
      .then(loadListe)
      .catch(function (e) { toast(e.message, true); loadListe(); });
  }
  $("#l-inscribe").addEventListener("click", function () {
    var ms = listeMatch.rows, ok = ms.filter(canInscribe);
    var skip = ms.filter(function (m) { return m.status === "manque" && !m.host && !planPeople(m.row); });
    if (!ok.length || !confirm("Inscrire ces " + ok.length + " familles avec les nombres de l'Excel ?\n\n" +
      ok.map(function (m) { var p = planPeople(m.row); return "• " + m.row.famille + " : " + p.length + " pers."; }).join("\n") +
      (skip.length ? "\n\nPas inscrites (midi / soir pas indiqués dans l'Excel) : " + skip.map(function (m) { return m.row.famille; }).join(", ") : ""))) return;
    this.disabled = true;
    inscribeAll(ok).then(function () { $("#l-inscribe").disabled = false; });
  });
  $("#ls-inscribe").addEventListener("click", function () {
    var m = listeMatch.rows[lsIndex];
    if (!canInscribe(m) || !confirm("Inscrire « " + m.row.famille + " » (" + planPeople(m.row).length + " pers.) avec les nombres de l'Excel ?")) return;
    $("#liste-sheet").close();
    inscribeAll([m]);
  });

  /* Fiche d'une famille : corriger les inscriptions rattachées, noter l'envoi du lien */
  function openListeSheet(i) {
    lsIndex = i;
    var m = listeMatch.rows[i], row = m.row, ownerName = {};
    listeMatch.rows.forEach(function (o) { o.ids.forEach(function (id) { ownerName[id] = o.row.famille; }); });
    $("#ls-title").textContent = row.famille;
    $("#ls-plan").textContent = planText(row) + (m.notes.length ? " · ⚠ " + m.notes.join(" · ") : "");
    var mine = state.rsvps.filter(function (r) { return m.ids.indexOf(r.id) >= 0; });
    var others = state.rsvps.filter(function (r) { return m.ids.indexOf(r.id) < 0; }).sort(function (a, b) { return a.nom.localeCompare(b.nom, "fr"); });
    $("#ls-checks").innerHTML = mine.concat(others).map(function (r) {
      var where = ownerName[r.id] && ownerName[r.id] !== row.famille ? " · <small>déjà avec « " + esc(ownerName[r.id]) + " »</small>" : "";
      return '<label class="ls-check" data-s="' + esc(lnorm(rsvpWords(r).join(" "))) + '"><input type="checkbox" value="' + esc(r.id) + '"' + (m.ids.indexOf(r.id) >= 0 ? " checked" : "") + " /><span><b>" + esc(r.nom) + "</b>" +
        ((r.accompagnants || []).length ? " avec " + esc(r.accompagnants.join(", ")) : "") + " · " + (r.presence === "oui" ? r.passagers + " pers." : "ne vient pas") + where + "</span></label>";
    }).join("") || '<p class="hint">Aucune inscription sur le site pour l\'instant.</p>';
    $("#ls-search").value = "";
    $("#ls-envoi").checked = !!row.envoi;
    $("#ls-alias").value = row.alias || "";
    $("#ls-auto").hidden = !m.manual;
    $("#ls-inscribe").hidden = !canInscribe(m);
    $("#liste-sheet").showModal();
  }
  $("#ls-search").addEventListener("input", function () {
    var q = lnorm(this.value);
    $all("#ls-checks .ls-check").forEach(function (l) { l.hidden = !!q && l.getAttribute("data-s").indexOf(q) < 0; });
  });
  $all("[data-ls-close]").forEach(function (b) { b.addEventListener("click", function () { $("#liste-sheet").close(); }); });
  $("#ls-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var row = liste.rows[lsIndex];
    var ids = $all("#ls-checks input:checked").map(function (c) { return c.value; });
    // seules les cases cochées ou décochées passent la famille « à la main » ; sinon elle reste en reconnaissance auto
    if ($all("#ls-checks input").some(function (c) { return c.checked !== c.defaultChecked; })) {
      // une inscription n'appartient qu'à une famille : on fige les autres familles concernées
      listeMatch.rows.forEach(function (o) {
        if (o.row === row || !ids.some(function (id) { return o.ids.indexOf(id) >= 0; })) return;
        o.row.links = o.ids.filter(function (id) { return ids.indexOf(id) < 0; });
      });
      row.links = ids;
    }
    row.alias = $("#ls-alias").value.trim();
    row.envoi = $("#ls-envoi").checked;
    $("#liste-sheet").close();
    saveListe("« " + row.famille + " » enregistrée.");
  });
  $("#ls-auto").addEventListener("click", function () {
    var row = liste.rows[lsIndex];
    row.links = null;
    row.envoi = $("#ls-envoi").checked;
    $("#liste-sheet").close();
    saveListe("Reconnaissance automatique rétablie pour « " + row.famille + " ».");
  });
  $("#ls-copy").addEventListener("click", function () {
    var t = "Bonjour ! Marjorie et Christophe fêtent leurs 50 et 60 ans le samedi 7 novembre à 12h30 à Draveil ✈ Toutes les infos et l'enregistrement des passagers (merci de le faire au plus vite) : " + (notify.site || location.origin);
    var done = function () { $("#ls-envoi").checked = true; toast("Invitation copiée : collez-la dans WhatsApp, puis Enregistrer."); };
    (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(done, function () { prompt("Copiez le message :", t); done(); });
  });

  // La liste à jour, à renvoyer dans Excel
  function listeExport() {
    var m = matchListe();
    var head = ["Familles", "Enfants", "Adultes", "Envoi site", "Midi prévu", "Soir prévu", "Inscrite", "Personnes inscrites", "Midi inscrits", "Soir inscrits", "Écart", "Inscriptions"];
    var rows = m.rows.map(function (x) {
      var r = x.row, real = x.status === "ok" || x.status === "fetes";
      return [r.famille, r.enfants || "", r.adultes || "", r.envoi ? "V" : "", r.midi == null ? "" : r.midi, r.soir == null ? "" : r.soir,
        LSTATUS[x.status][0].replace(/^[✓★] /, ""), real ? x.real.pax : "", real ? x.real.midi : "", real ? x.real.soir : "",
        x.ecart ? "oui" : "", x.regs.map(function (g) { return g.nom; }).join(", ")];
    });
    var sum = function (k) { return m.rows.reduce(function (n, x) { return n + (x.row[k] || 0); }, 0); };
    var got = function (k) { return m.rows.reduce(function (n, x) { return n + x.real[k]; }, 0); };
    rows.push(["Total", "", "", "", sum("midi"), sum("soir"), "", "", got("midi"), got("soir"), "", ""]);
    xlsx("Liste prévue à jour", [{ name: "Liste prévue", rows: [head].concat(rows) }]);
  }
  $("#l-export").addEventListener("click", listeExport);

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
        '<label class="row__seatsl">places <input class="row__seats" type="number" min="1" max="40" value="' + t.seats + '" aria-label="Nombre de places" /></label>' +
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
        onEnd: function () { document.body.classList.remove("is-dragging"); lastDrag = Date.now(); },
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

  /* Placer quelqu'un en touchant son nom : plus simple que le glisser-déposer sur téléphone */
  var placeId = null, lastDrag = 0;
  function seatedAt(tableId) {
    return state.rsvps.filter(function (r) { return r.presence === "oui" && state.plan.assign[r.id] === tableId; })
      .reduce(function (n, r) { return n + (r.passagers || 1); }, 0);
  }
  function openPlace(id) {
    var r = state.rsvps.find(function (x) { return x.id === id; });
    if (!r) return;
    placeId = id;
    var cur = state.plan.assign[id], n = r.passagers || 1;
    $("#pl-title").textContent = r.nom + (n > 1 ? " (" + n + " personnes)" : "");
    $("#pl-who").textContent = (r.accompagnants || []).length ? "Avec " + r.accompagnants.join(", ") + "." : "";
    $("#pl-list").innerHTML = state.plan.tables.map(function (t) {
      var used = seatedAt(t.id) - (cur === t.id ? n : 0), free = t.seats - used, fits = free >= n;
      return '<button type="button" class="place' + (cur === t.id ? " is-current" : "") + (fits ? "" : " is-tight") + '" data-place="' + esc(t.id) + '">' +
        "<b>" + esc(t.name) + "</b><small>" + (cur === t.id ? "sa table actuelle · " : "") +
        (free > 0 ? free + " place" + (free > 1 ? "s" : "") + " libre" + (free > 1 ? "s" : "") : "complète") + (fits ? "" : " · pas assez de place") + "</small></button>";
    }).join("") + (cur ? '<button type="button" class="place place--out" data-place=""><b>Retirer de sa table</b><small>repasse dans « Pas encore à table »</small></button>' : "");
    $("#place-sheet").showModal();
  }
  $("#pl-list").addEventListener("click", function (e) {
    var b = e.target.closest("[data-place]");
    if (!b || !placeId) return;
    var table = b.getAttribute("data-place"), r = state.rsvps.find(function (x) { return x.id === placeId; });
    var t = state.plan.tables.find(function (x) { return x.id === table; });
    if (b.classList.contains("is-tight") && !confirm("« " + t.name + " » n'a pas assez de places libres. Placer quand même ?")) return;
    if (table) { state.plan.assign[placeId] = table; (state.plan.src = state.plan.src || {})[placeId] = "equipage"; }
    else { delete state.plan.assign[placeId]; if (state.plan.src) delete state.plan.src[placeId]; }
    if (seenAssign) seenAssign[placeId] = table || undefined;
    $("#place-sheet").close();
    renderCabin();
    saveAssign(placeId, table);
    toast(r.nom + (table ? " → " + t.name : " retiré·e de sa table") + ".");
  });
  $all("[data-pl-close]").forEach(function (b) { b.addEventListener("click", function () { $("#place-sheet").close(); }); });
  $("#tab-cabine").addEventListener("click", function (e) {
    var p = e.target.closest(".pax");
    if (!p || Date.now() - lastDrag < 400 || document.body.classList.contains("is-dragging")) return;
    openPlace(p.getAttribute("data-id"));
  });

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
  var graphGroup = "table", graphView = "liste";

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
    renderOverviewKpis();
    $("#g-board").hidden = graphView !== "liste";
    $("#g-graph").hidden = graphView === "liste";
    if (graphView === "liste") return renderBoard();
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
      } else if (graphGroup === "moment") {
        var mo = momentOf(r);
        h = hub("mo:" + mo, mo);
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
    $("#g-stats").textContent = plural(confirmed.length, "inscription", "inscriptions") + " · " + plural(pax, "personne", "personnes");
    $("#g-hub-label").textContent = { table: "Table", equipe: "Équipe", repas: "Type de repas", moment: "Midi / soir" }[graphGroup];
    $("#g-empty").hidden = confirmed.length > 0;

    graph = window.McGraph.mount($("#g-canvas"), { nodes: nodes, links: links }, { onSelect: showGraphInfo });
  }

  /* Vue d'ensemble en liste : des cartes par table, moment, régime ou équipe */
  function momentOf(r) {
    var f = fares(r), m = f.filter(function (x) { return x === "midi"; }).length, so = f.filter(function (x) { return x === "soir"; }).length;
    return m === f.length ? "Midi seulement" : so === f.length ? "Soir seulement" : !m && !so ? "Midi et soir" : "Selon la personne";
  }
  function renderOverviewKpis() {
    var yes = state.rsvps.filter(function (r) { return r.presence === "oui"; }), all = [];
    yes.forEach(function (r) { all = all.concat(fares(r)); });
    var special = yes.filter(isSpecial);
    $("#g-kpis").innerHTML =
      '<div class="kpi kpi--main"><span>Personnes</span><strong>' + all.length + "</strong><small>" + plural(yes.length, "inscription", "inscriptions") + "</small></div>" +
      '<div class="kpi"><span>Au déjeuner</span><strong>' + all.filter(function (f) { return f !== "soir"; }).length + "</strong><small>midi</small></div>" +
      '<div class="kpi"><span>Au dîner</span><strong>' + all.filter(function (f) { return f !== "midi"; }).length + "</strong><small>soir</small></div>" +
      '<div class="kpi"><span>Régimes, allergies</span><strong>' + special.length + "</strong><small>inscriptions</small></div>";
  }
  function regLine(r, n) {
    var others = (r.accompagnants || []).map(function (a) { return a.split(" ")[0]; });
    var count = n == null ? r.passagers || 1 : n;
    return '<button type="button" class="bd-reg" data-rid="' + esc(r.id) + '"><span class="bd-reg__who"><b>' + esc(r.nom) + "</b>" +
      (others.length ? '<small> avec ' + esc(others.join(", ")) + "</small>" : "") + "</span>" +
      // vue midi / soir : seulement le nombre concerné ; sinon les billets de la famille (« Midi ×2 »)
      '<span class="bd-reg__tags">' + (n == null ? fareTags(r) : '<em class="bd-n">' + plural(count, "pers.", "pers.") + "</em>") + "</span>" +
      ((r.repas && r.repas !== "Standard") || r.allergies ? '<span class="bd-reg__meal">⚠ ' + esc([r.repas !== "Standard" ? r.repas : "", r.allergies].filter(Boolean).join(" · ")) + "</span>" : "") +
      "</button>";
  }
  function boardCard(title, sub, regs, opts) {
    opts = opts || {};
    var pax = regs.reduce(function (n, x) { return n + (x.n == null ? x.r.passagers || 1 : x.n); }, 0);
    var body = regs.length ? regs.map(function (x) { return regLine(x.r, x.n); }).join("") : '<p class="bd-empty">Personne pour l\'instant</p>';
    return '<section class="bd-card' + (opts.muted ? " bd-card--muted" : "") + (opts.alert ? " bd-card--alert" : "") + '">' +
      '<header><h3>' + esc(title) + '</h3><span class="bd-count">' + (sub ? esc(sub) : plural(pax, "personne", "personnes")) + "</span></header>" +
      (opts.fold ? '<details><summary>Voir les ' + regs.length + " inscriptions</summary>" + body + "</details>" : body) + "</section>";
  }
  function renderBoard() {
    var yes = state.rsvps.filter(function (r) { return r.presence === "oui"; }).sort(function (a, b) { return a.nom.localeCompare(b.nom, "fr"); });
    var wrap = function (r) { return { r: r }; }, html = "";
    if (graphGroup === "table") {
      state.plan.tables.forEach(function (t) {
        var regs = yes.filter(function (r) { return state.plan.assign[r.id] === t.id; });
        var pax = regs.reduce(function (n, r) { return n + (r.passagers || 1); }, 0);
        html += boardCard(t.name, pax + " / " + t.seats + " places", regs.map(wrap), { alert: pax > t.seats });
      });
      var none = yes.filter(function (r) { return !state.plan.tables.some(function (t) { return t.id === state.plan.assign[r.id]; }); });
      if (none.length) html += boardCard("Pas encore à table", "", none.map(wrap), { muted: true });
    } else if (graphGroup === "moment") {
      // une famille peut être dans deux cartes si chacun ne vient pas au même moment : on compte les personnes
      [["Midi et soir", "journee"], ["Midi seulement", "midi"], ["Soir seulement", "soir"]].forEach(function (g) {
        var regs = yes.map(function (r) { return { r: r, n: fares(r).filter(function (f) { return f === g[1]; }).length }; }).filter(function (x) { return x.n; });
        html += boardCard(g[0], "", regs);
      });
    } else if (graphGroup === "repas") {
      var kinds = {};
      yes.forEach(function (r) { if (r.repas && r.repas !== "Standard") (kinds[r.repas] = kinds[r.repas] || []).push(r); });
      Object.keys(kinds).sort().forEach(function (k) { html += boardCard(k, "", kinds[k].map(wrap), { alert: true }); });
      var allerg = yes.filter(function (r) { return r.allergies && (!r.repas || r.repas === "Standard"); });
      html += boardCard("Allergies et précisions", "", allerg.map(wrap), { alert: allerg.length > 0 });
      var std = yes.filter(function (r) { return (!r.repas || r.repas === "Standard") && !r.allergies; });
      html += boardCard("Repas standard", "", std.map(wrap), { muted: true, fold: true });
    } else {
      var teams = state.teams && state.teams.teams || [], inTeam = {};
      teams.forEach(function (t) {
        var ids = {};
        t.people.forEach(function (p) { ids[p.id] = 1; inTeam[p.id] = 1; });
        html += boardCard("Équipe " + t.name, "", yes.filter(function (r) { return ids[r.id]; }).map(wrap));
      });
      var free = yes.filter(function (r) { return !inTeam[r.id]; });
      if (!teams.length) html += '<p class="hint">Pas encore d\'équipes : elles se forment le jour J, à partir des tables (onglet « Équipes »).</p>';
      if (free.length && teams.length) html += boardCard("Sans équipe", "", free.map(wrap), { muted: true });
    }
    $("#g-board").innerHTML = html || '<p class="hint">Aucun invité confirmé pour l\'instant.</p>';
  }
  $("#g-board").addEventListener("click", function (e) {
    var b = e.target.closest("[data-rid]");
    if (!b) return;
    var r = state.rsvps.find(function (x) { return x.id === b.getAttribute("data-rid"); });
    if (r) openGuest(r);
  });
  $all("[data-gview]").forEach(function (b) {
    b.addEventListener("click", function () {
      graphView = b.getAttribute("data-gview");
      $all("[data-gview]").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
      if (state.plan) renderGraph();
    });
  });

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

  // Régie : d'après l'étape en cours, ce que fait le gros bouton et ce que l'animateur annonce
  function nextStep(st, n) {
    var last = st.index >= n - 1;
    switch (st.phase) {
      case "lobby": return { label: "Lancer la question " + (st.index + 2), action: "start" };
      case "question": return { label: "Révéler la réponse", action: "reveal" };
      case "reveal": return { label: "Afficher le classement", action: "board" };
      case "board": return last ? { label: "Afficher le podium final", action: "podium" } : { label: "Lancer la question " + (st.index + 2), action: "start" };
      case "podium": return { label: "Terminer le quiz", action: "off" };
      default:
        if (st.index >= n - 1 && st.index >= 0) return { label: "Quiz terminé ✓", action: null };
        return { label: st.index >= 0 ? "Reprendre le quiz" : "Ouvrir le quiz : les invités rejoignent", action: "lobby" };
    }
  }
  var LETTERS = "ABCD";
  function renderQuizStatus(d) {
    var st = d.state, n = d.questions.length, q = d.questions[st.index], showQ = q && ["question", "reveal", "board"].indexOf(st.phase) >= 0;
    qz.d = d;
    $("#qz-phase").textContent = PHASES[st.phase] || st.phase;
    $("#qz-phase").className = "regie__phase regie__phase--" + st.phase;
    $("#qz-index").textContent = st.index >= 0 ? "Question " + (st.index + 1) + " sur " + n : n + " questions prêtes";
    $("#qz-players").textContent = d.players;
    $("#qz-dots").innerHTML = d.questions.map(function (x, i) {
      var cls = i < st.index || (i === st.index && ["reveal", "board", "podium"].indexOf(st.phase) >= 0) || (st.phase === "podium") ? "is-done" : i === st.index && st.phase === "question" ? "is-now" : "";
      return '<li class="' + cls + '"></li>';
    }).join("");

    // ce qu'il faut dire
    var top = d.top || [], correct = q && st.counts ? st.counts[q.answer] || 0 : 0, total = st.counts ? st.counts.reduce(function (a, b) { return a + b; }, 0) : 0;
    var scored = top.filter(function (p) { return p.score > 0; });
    var medal = function (k) { return scored[k] ? ["🥇", "🥈", "🥉"][k] + " " + scored[k].name + " (" + scored[k].score + " pts)" : ""; };
    var podium = [medal(0), medal(1), medal(2)].filter(Boolean).join(", ") || "personne n'a encore marqué de points";
    var say = {
      off: st.index >= n - 1 && st.index >= 0
        ? "Le quiz est terminé. Pour le rejouer depuis le début : « Autres options » puis « Tout remettre à zéro »."
        : st.index >= 0
          ? "Le quiz est en pause (arrêté après la question " + (st.index + 1) + "). « Reprendre le quiz » continue là où vous en étiez ; pour tout recommencer : « Autres options » puis « Tout remettre à zéro »."
          : "Avant de commencer : affichez l'écran géant sur le vidéoprojecteur (bouton en haut). Puis appuyez sur le gros bouton : l'écran montre le QR code pour rejoindre.",
      lobby: "Annoncez : « Sortez vos téléphones, scannez le QR code à l'écran et entrez votre prénom ! » " + plural(d.players, "joueur est", "joueurs sont") + " déjà là. Quand tout le monde est prêt, lancez la question.",
      question: "Lisez la question à voix haute. Les invités répondent sur leur téléphone. Révélez la réponse quand le chrono est fini (ou quand tout le monde a répondu).",
      reveal: q ? "Annoncez la bonne réponse : « " + LETTERS[q.answer] + " · " + q.choices[q.answer] + " ». " + plural(correct, "joueur a trouvé", "joueurs ont trouvé") + " sur " + total + "." : "",
      board: "Annoncez les leaders : " + podium + ". Puis passez à la suite.",
      podium: "Applaudissements pour le podium ! " + podium + ".",
    }[st.phase] || "";
    $("#qz-say").textContent = say;

    // la question, avec la bonne réponse visible pour l'animateur
    $("#qz-q").hidden = !showQ;
    if (showQ) {
      $("#qz-qtext").textContent = q.q;
      var counts = st.counts || [];
      $("#qz-choices").innerHTML = q.choices.map(function (c, i) {
        var ok = i === q.answer, cnt = st.phase !== "question" && counts.length ? counts[i] || 0 : null;
        return '<li class="regie__choice' + (ok ? " is-ok" : "") + '"><span class="regie__letter">' + LETTERS[i] + "</span><span>" + esc(c) + "</span>" +
          (cnt !== null ? '<b class="regie__cnt">' + cnt + "</b>" : "") +
          (ok ? '<em class="regie__good">' + (st.phase === "question" ? "bonne réponse, ne la dites pas !" : "bonne réponse") + "</em>" : "") + "</li>";
      }).join("");
    }
    // réponses reçues pendant la question
    $("#qz-live").hidden = st.phase !== "question";
    $("#qz-answered").textContent = d.answered;
    $("#qz-players2").textContent = d.players;
    $("#qz-bar").style.width = (d.players ? Math.min(100, Math.round(d.answered / d.players * 100)) : 0) + "%";
    // classement
    var showTop = (st.phase === "board" || st.phase === "podium") && top.length;
    $("#qz-top").hidden = !showTop;
    if (showTop) $("#qz-top").innerHTML = top.slice(0, st.phase === "podium" ? 3 : 5).map(function (p) { return "<li><span>" + esc(p.name) + "</span><b>" + p.score + " pts</b></li>"; }).join("");

    var step = nextStep(st, n), btn = $("#qz-next");
    qz.next = step;
    btn.disabled = !step.action || qz.busy;
    $("#qz-skip").hidden = st.phase !== "reveal";
    $("#qz-skip").textContent = st.index >= n - 1 ? "Passer au podium final" : "Passer le classement → question " + (st.index + 2);
    $("#qz-podium").hidden = ["lobby", "question", "reveal", "board"].indexOf(st.phase) < 0 || st.index >= n - 1 || st.index < 0;
    $all(".qz-item").forEach(function (li, i) { li.classList.toggle("is-current", i === st.index && st.phase !== "off"); });
    cancelAnimationFrame(qz.raf);
    (function tick() {
      var rest = st.phase === "question" ? Math.max(0, st.endsAt - (Date.now() + qz.offset)) : 0;
      $("#qz-left").textContent = st.phase === "question" ? (rest > 0 ? "encore " + Math.ceil(rest / 1000) + " s" : "temps écoulé") : "–";
      btn.textContent = step.label + (st.phase === "question" && rest > 0 ? " (encore " + Math.ceil(rest / 1000) + " s)" : "");
      $("#qz-regie").classList.toggle("is-timeup", st.phase === "question" && rest <= 0);
      if (rest > 0) qz.raf = requestAnimationFrame(tick);
    })();
  }
  $("#qz-next").addEventListener("click", function () {
    var step = qz.next;
    if (!step || !step.action || qz.busy) return;
    quizAction(step.action);
  });
  $("#qz-skip").addEventListener("click", function () {
    var d = qz.d;
    if (!d) return;
    quizAction(d.state.index >= d.questions.length - 1 ? "podium" : "start");
  });
  // barre d'espace = étape suivante (sauf en tapant dans un champ)
  document.addEventListener("keydown", function (e) {
    if (e.code !== "Space" || $("#tab-quiz").hidden || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(document.activeElement.tagName)) return;
    e.preventDefault();
    $("#qz-next").click();
  });

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
    if (action === "off" && qz.d && qz.d.state.phase !== "podium" && qz.d.state.phase !== "off" && !confirm("Fermer le quiz maintenant ? Les joueurs verront « quiz fermé ».")) return;
    var body = Object.assign({ action: action }, extra || {});
    qz.busy = true;
    $("#qz-next").disabled = true;
    api("/api/quiz", { method: "POST", body: body }).then(function () { qz.busy = false; startQuizAdmin(); })
      .catch(function (err) { qz.busy = false; $("#qz-next").disabled = false; toast(err.message, true); });
  }
  $all("[data-qz]").forEach(function (b) {
    b.addEventListener("click", function () { quizAction(b.getAttribute("data-qz")); });
  });

  /* ───────── Boîte noire (modération, place occupée, téléchargement) ───────── */
  var bn = { entries: [], downloaded: {} };
  try { bn.downloaded = JSON.parse(localStorage.getItem("mc-bn-saved") || "{}"); } catch (e) { /* ignoré */ }
  function rememberSaved() { try { localStorage.setItem("mc-bn-saved", JSON.stringify(bn.downloaded)); } catch (e) { /* ignoré */ } }
  function mb(chars) { return (chars * 0.75 / 1048576).toFixed(chars > 10485760 ? 0 : 1).replace(".", ",") + " Mo"; }

  function loadBoite() {
    return api("/api/boite?view=admin").then(function (d) {
      bn.entries = d.entries || [];
      var photos = bn.entries.filter(function (e) { return e.photo; });
      var pct = Math.min(100, Math.round((d.used / d.budget) * 100));
      $("#bn-count").textContent = bn.entries.length;
      $("#bn-photos").textContent = photos.length + " photo" + (photos.length > 1 ? "s" : "");
      $("#bn-used").textContent = "· " + mb(d.used) + " sur " + mb(d.budget) + " (" + pct + " %)";
      $("#bn-bar").style.width = pct + "%";
      $("#bn-bar").className = pct >= 85 ? "is-high" : pct >= 60 ? "is-mid" : "";
      $("#bn-zip").disabled = !photos.length;
      var got = photos.filter(function (e) { return bn.downloaded[e.id]; }).length;
      $("#bn-free").hidden = !got;
      $("#bn-free").textContent = "Libérer l'espace (" + got + " photo" + (got > 1 ? "s" : "") + " téléchargée" + (got > 1 ? "s" : "") + ")";

      // qui envoie le plus de photos
      var by = {};
      photos.forEach(function (e) {
        var k = e.name || "Un passager";
        by[k] = by[k] || { n: 0, size: 0, ids: [] };
        by[k].n++; by[k].size += e.size || 400000; by[k].ids.push(e.id);
      });
      var names = Object.keys(by).sort(function (a, b) { return by[b].n - by[a].n; });
      bn.byName = by;
      $("#bn-who").innerHTML = names.map(function (k) {
        return "<tr><td><b>" + esc(k) + "</b></td><td>" + by[k].n + " photo" + (by[k].n > 1 ? "s" : "") + "</td><td>" + mb(by[k].size) + "</td>" +
          '<td class="actions"><button class="btn btn--small btn--line" data-bn-zipname="' + esc(k) + '">Télécharger</button> ' +
          '<button class="btn btn--small btn--line btn--danger" data-bn-purgename="' + esc(k) + '">Retirer ses photos</button></td></tr>';
      }).join("") || '<tr><td class="hint">Aucune photo pour l\'instant.</td></tr>';

      $("#bn-empty").hidden = bn.entries.length > 0;
      $("#bn-admin").innerHTML = bn.entries.map(function (e) {
        return '<article class="bn-card' + (bn.downloaded[e.id] ? " is-saved" : "") + '">' +
          (e.photo ? '<img loading="lazy" src="/api/boite?photo=' + encodeURIComponent(e.id) + '" alt="" />' : "") +
          (e.message ? "<p>" + esc(e.message) + "</p>" : "") +
          "<footer><small>" + esc(e.name) + " · " + fmtDate(e.createdAt) + (e.photo ? " · " + mb(e.size || 400000) : "") + (bn.downloaded[e.id] ? " · téléchargée ✓" : "") + "</small>" +
          '<span class="bn-card__actions">' +
          (e.photo && e.message ? '<button class="btn btn--small btn--line" data-bn-photo="' + esc(e.id) + '" title="Retirer la photo, garder le message">Retirer la photo</button>' : "") +
          '<button class="btn btn--small btn--line btn--danger" data-bn-del="' + esc(e.id) + '">Supprimer</button></span></footer></article>';
      }).join("");
    }).catch(function (e) { if (!onAuthError(e)) toast("Impossible de charger la boîte noire.", true); });
  }

  function purge(ids, photoOnly, label) {
    if (!ids.length) return Promise.resolve();
    return api("/api/boite", { method: "POST", body: { action: "purge", ids: ids, photoOnly: photoOnly } })
      .then(function (d) { toast(label || (d.count + " élément(s) retiré(s).")); return loadBoite(); })
      .catch(function (err) { toast(err.message, true); });
  }

  $("#bn-admin").addEventListener("click", function (e) {
    var id = e.target.getAttribute("data-bn-del"), pid = e.target.getAttribute("data-bn-photo");
    if (id && confirm("Supprimer ce message (et sa photo) ?")) {
      api("/api/boite?id=" + encodeURIComponent(id), { method: "DELETE" }).then(function () { toast("Supprimé."); loadBoite(); }).catch(function (err) { toast(err.message, true); });
    }
    if (pid && confirm("Retirer la photo ? Le message reste affiché.")) {
      api("/api/boite?id=" + encodeURIComponent(pid) + "&photo=1", { method: "DELETE" }).then(function () { toast("Photo retirée."); loadBoite(); }).catch(function (err) { toast(err.message, true); });
    }
  });

  $("#bn-who").addEventListener("click", function (e) {
    var zn = e.target.getAttribute("data-bn-zipname"), pn = e.target.getAttribute("data-bn-purgename");
    if (zn) zipPhotos(bn.entries.filter(function (x) { return x.photo && (x.name || "Un passager") === zn; }), "boite-noire-" + zn);
    if (pn && confirm("Retirer les " + bn.byName[pn].n + " photos de « " + pn + " » du serveur ? Pensez à les télécharger avant. Les messages restent.")) {
      purge(bn.byName[pn].ids, true, "Photos de " + pn + " retirées.");
    }
  });

  $("#bn-zip").addEventListener("click", function () {
    zipPhotos(bn.entries.filter(function (x) { return x.photo; }), "boite-noire-vol-mc5060");
  });

  $("#bn-free").addEventListener("click", function () {
    var ids = bn.entries.filter(function (x) { return x.photo && bn.downloaded[x.id]; }).map(function (x) { return x.id; });
    if (!ids.length) return;
    if (!confirm("Retirer du serveur les " + ids.length + " photos déjà téléchargées sur cet appareil ? Vérifiez que le ZIP s'ouvre bien. Les messages restent.")) return;
    purge(ids, true, ids.length + " photos retirées : de la place est libérée.");
  });

  /* Fabrique un ZIP (sans compression : les JPEG le sont déjà) directement dans le navigateur */
  var CRC = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(buf) { var c = 0xffffffff; for (var i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  function makeZip(files) {
    var enc = new TextEncoder(), parts = [], central = [], offset = 0;
    files.forEach(function (f) {
      var name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
      var d = new Date(f.date || Date.now());
      var time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
      var date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
      var h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, time, true); h.setUint16(12, date, true); h.setUint32(14, crc, true); h.setUint32(18, size, true); h.setUint32(22, size, true);
      h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      parts.push(new Uint8Array(h.buffer), name, f.data);
      var c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
      c.setUint16(12, time, true); c.setUint16(14, date, true); c.setUint32(16, crc, true); c.setUint32(20, size, true); c.setUint32(24, size, true);
      c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
      central.push(new Uint8Array(c.buffer), name);
      offset += 30 + name.length + size;
    });
    var csize = central.reduce(function (n, p) { return n + p.length; }, 0);
    var e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, csize, true); e.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [new Uint8Array(e.buffer)]), { type: "application/zip" });
  }
  function slug(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "invite"; }

  function zipPhotos(list, base) {
    if (!list.length) return;
    var btn = $("#bn-zip"), label = btn.textContent, done = 0, files = [];
    btn.disabled = true;
    var queue = list.slice();
    function worker() {
      var e = queue.shift();
      if (!e) return Promise.resolve();
      return fetch("/api/boite?photo=" + encodeURIComponent(e.id)).then(function (r) {
        if (!r.ok) throw new Error("photo " + e.id);
        var ext = /png/.test(r.headers.get("Content-Type") || "") ? "png" : /webp/.test(r.headers.get("Content-Type") || "") ? "webp" : "jpg";
        return r.arrayBuffer().then(function (buf) {
          var d = new Date(e.createdAt);
          var stamp = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0") + "_" +
            String(d.getHours()).padStart(2, "0") + "h" + String(d.getMinutes()).padStart(2, "0");
          files.push({ name: stamp + "_" + slug(e.name) + "_" + e.id.slice(0, 6) + "." + ext, data: new Uint8Array(buf), date: e.createdAt, id: e.id });
        });
      }).catch(function () { /* photo déjà retirée : on continue */ }).then(function () {
        done++;
        btn.textContent = "Préparation… " + done + " / " + list.length;
        return worker();
      });
    }
    Promise.all([worker(), worker(), worker(), worker()]).then(function () {
      if (!files.length) throw new Error("Aucune photo récupérée.");
      files.sort(function (a, b) { return a.name.localeCompare(b.name); });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(makeZip(files));
      a.download = slug(base) + ".zip";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
      files.forEach(function (f) { bn.downloaded[f.id] = true; });
      rememberSaved();
      toast(files.length + " photos téléchargées. Vous pouvez maintenant libérer l'espace.");
      loadBoite();
    }).catch(function (err) { toast(err.message, true); }).then(function () { btn.disabled = false; btn.textContent = label; });
  }

  /* ───────── Partager le site : QR code ───────── */
  var share = { path: "/" };
  function shareUrl() { return location.origin + share.path; }
  function qrSvg(url) {
    var q = window.qrcode(0, "Q"); q.addData(url); q.make();
    return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }).replace(/fill="black"|fill="#000000"/g, 'fill="#000033"');
  }
  function renderShare() {
    var url = shareUrl();
    $("#sh-qr").innerHTML = qrSvg(url);
    $("#sh-url").textContent = url.replace(/^https?:\/\//, "");
    $("#sh-send").hidden = !navigator.share;
    $all("[data-share]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-share") === share.path)); });
  }
  $all("[data-share]").forEach(function (b) {
    b.addEventListener("click", function () { share.path = b.getAttribute("data-share"); renderShare(); });
  });
  $("#sh-copy").addEventListener("click", function () {
    var url = shareUrl();
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { toast("Lien copié ✓"); })
      .catch(function () { prompt("Copiez le lien :", url); });
  });
  $("#sh-send").addEventListener("click", function () {
    navigator.share({ title: "Vol MC 5060 · Marjorie & Christophe", text: "Le site de la fête des 50 ans de Marjorie et des 60 ans de Christophe ✈", url: shareUrl() }).catch(function () {});
  });
  $("#sh-full").addEventListener("click", function () {
    var o = $("#sh-overlay");
    $("#sh-qr-big").innerHTML = qrSvg(shareUrl());
    $("#sh-url-big").textContent = shareUrl().replace(/^https?:\/\//, "");
    o.hidden = false;
    if (o.requestFullscreen) o.requestFullscreen().catch(function () {});
    if (navigator.wakeLock) navigator.wakeLock.request("screen").then(function (l) { share.lock = l; }).catch(function () {});
  });
  $("#sh-overlay").addEventListener("click", function () {
    this.hidden = true;
    if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
    if (share.lock) { share.lock.release().catch(function () {}); share.lock = null; }
  });
  $("#sh-png").addEventListener("click", function () {
    var q = window.qrcode(0, "Q"); q.addData(shareUrl()); q.make();
    var n = q.getModuleCount(), cell = 24, pad = 4 * cell, W = n * cell + pad * 2, H = W + 150;
    var c = document.createElement("canvas"); c.width = W; c.height = H;
    var g = c.getContext("2d");
    g.fillStyle = "#fffbfe"; g.fillRect(0, 0, W, H);
    g.fillStyle = "#000033";
    for (var r = 0; r < n; r++) for (var k = 0; k < n; k++) if (q.isDark(r, k)) g.fillRect(pad + k * cell, pad + r * cell, cell, cell);
    g.fillStyle = "#a67046"; g.textAlign = "center";
    g.font = "500 44px 'Cormorant Garamond', Georgia, serif";
    g.fillText("Marjorie & Christophe · Vol MC 5060", W / 2, W + 40);
    g.font = "28px 'JetBrains Mono', monospace";
    g.fillText(shareUrl().replace(/^https?:\/\//, ""), W / 2, W + 95);
    var a = document.createElement("a");
    a.href = c.toDataURL("image/png");
    a.download = "qr-vol-mc5060" + (share.path === "/" ? "" : "-" + share.path.replace(/[^a-z]/g, "")) + ".png";
    document.body.appendChild(a); a.click(); a.remove();
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

  /* ───────── Codes de secours (super admin) ───────── */
  if ($("#bk-generate")) $("#bk-generate").addEventListener("click", function () {
    if (!confirm("Générer 8 nouveaux codes de secours ? Les anciens ne marcheront plus.")) return;
    api("/api/auth", { method: "POST", body: { action: "backup-codes" } }).then(function (d) {
      $("#bk-codes").innerHTML = d.codes.map(function (c) { return "<li><code>" + esc(c) + "</code></li>"; }).join("");
      $("#bk-box").hidden = false;
      $("#bk-left").textContent = d.codes.length + " code(s) de secours encore valable(s).";
      $("#bk-copy").onclick = function () {
        navigator.clipboard.writeText("Codes de secours Vol MC 5060 (identifiant adame) :\n" + d.codes.join("\n")).then(function () { toast("Codes copiés."); });
      };
    }).catch(function (e) { toast(e.message, true); });
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
      var iAmSuper = state.me.role === "superadmin";
      var locked = self || (u.role === "superadmin" && !iAmSuper);
      var roleSel = '<select data-role="' + esc(u.username) + '"' + (locked ? " disabled" : "") + ">" +
        Object.keys(ROLE_LABEL).filter(function (r) { return r !== "superadmin" || iAmSuper || u.role === "superadmin"; }).map(function (r) {
          return '<option value="' + r + '"' + (u.role === r ? " selected" : "") + ">" + ROLE_LABEL[r] + "</option>";
        }).join("") + "</select>";
      return "<tr>" +
        "<td><b>" + esc(u.name) + "</b>" + (self ? " <small>(vous)</small>" : "") + "</td>" +
        "<td><code>" + esc(u.username) + "</code></td>" +
        "<td>" + roleSel + "</td>" +
        "<td>" + (u.mustChange ? '<span class="tag tag--gold">Code provisoire</span>' : '<span class="tag tag--ok">Actif</span>') + "</td>" +
        "<td>" + fmtDate(u.lastLogin) + "</td>" +
        '<td class="actions">' + (locked ? (self ? "" : '<small class="hint">Compte protégé</small>') :
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
