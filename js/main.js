(function () {
  "use strict";

  var CFG = window.EVENT || {};
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var target = new Date(CFG.date);

  /* ───────── Programme (Plan de vol) ───────── */
  var progList = document.getElementById("programme");
  if (progList && CFG.programme) {
    progList.innerHTML = CFG.programme.map(function (st) {
      var el = document.createElement("div");
      el.textContent = st.texte || "";
      var t = document.createElement("div");
      t.textContent = st.titre || "";
      var h = document.createElement("div");
      h.textContent = st.heure || "";
      return '<li class="reveal"><time>' + h.innerHTML + "</time><div><h3>" + t.innerHTML + "</h3><p>" + el.innerHTML + "</p></div></li>";
    }).join("");
  }

  /* ───────── Fill config values ───────── */
  document.querySelectorAll("[data-cfg]").forEach(function (el) {
    var v = CFG[el.getAttribute("data-cfg")];
    if (v) el.textContent = v;
  });

  /* ───────── Ciel jour / nuit ─────────
     L'état initial est posé dans <head> (jour entre le lever et le coucher
     du soleil à Draveil, ou choix mémorisé).
     Le bouton du menu bascule, et le choix est retenu sur cet appareil. */
  var starsBox = document.getElementById("sky-stars");
  if (starsBox) {
    var frag = document.createDocumentFragment();
    for (var si = 0; si < 90; si++) {
      var st = document.createElement("span");
      var size = Math.random() < 0.85 ? 1 + Math.random() : 2 + Math.random() * 1.2;
      st.className = "star";
      st.style.cssText = "left:" + (Math.random() * 100).toFixed(2) + "%;top:" + (Math.random() * 78).toFixed(2) + "%;width:" + size.toFixed(1) + "px;height:" + size.toFixed(1) + "px;--tw:" + (2.5 + Math.random() * 4).toFixed(1) + "s;animation-delay:-" + (Math.random() * 6).toFixed(1) + "s";
      frag.appendChild(st);
    }
    starsBox.appendChild(frag);
  }

  var skyBtn = document.getElementById("sky-toggle");
  function setSky(day) {
    document.documentElement.classList.toggle("is-day", day);
    if (skyBtn) {
      skyBtn.setAttribute("aria-pressed", String(day));
      skyBtn.setAttribute("aria-label", day ? "Passer au ciel de nuit" : "Passer au ciel de jour");
    }
  }
  setSky(document.documentElement.classList.contains("is-day")); // état choisi dans <head>
  if (skyBtn) {
    skyBtn.addEventListener("click", function () {
      var day = !document.documentElement.classList.contains("is-day");
      setSky(day);
      try { localStorage.setItem("mc-sky", day ? "day" : "night"); } catch (e) { /* ignoré */ }
    });
  }

  /* ───────── Mode Jour J : étape en cours ───────── */
  var heroEyebrow = document.getElementById("hero-eyebrow");
  var nowBanner = document.getElementById("now-banner");
  function updateJourJ() {
    if (!window.McProgramme) return;
    var st = window.McProgramme.status();
    var items = progList ? progList.querySelectorAll("li") : [];
    items.forEach(function (li, i) { li.classList.toggle("is-now", st.mode === "jourj" && i === st.index); });
    var cdBox = document.querySelector(".countdown");
    if (cdBox) cdBox.hidden = st.mode === "apres" || (st.mode === "jourj" && !!st.current);
    if (st.mode !== "jourj") { nowBanner.hidden = true; return; }
    if (st.current) {
      heroEyebrow.textContent = "En vol · " + st.current.titre;
      nowBanner.innerHTML = "<b>Maintenant</b> " + escapeHtml(st.current.titre) +
        (st.next ? '<span class="now-banner__next">Ensuite · ' + escapeHtml(st.next.titre) + (st.next.at ? " à " + escapeHtml(st.next.heure) : "") + "</span>" : "");
    } else {
      heroEyebrow.textContent = "Aujourd'hui · embarquement " + (CFG.heure || "");
      nowBanner.innerHTML = "<b>Aujourd'hui</b> Embarquement à " + escapeHtml(CFG.heure || "") + " · " + escapeHtml(CFG.lieu || "");
    }
    nowBanner.hidden = false;
  }
  function escapeHtml(v) { var d = document.createElement("div"); d.textContent = v == null ? "" : v; return d.innerHTML; }
  updateJourJ();
  setInterval(updateJourJ, 30000);

  /* ───────── Liens d'itinéraire ───────── */
  var dest = encodeURIComponent([CFG.lieu, CFG.adresse].filter(Boolean).join(", "));
  var gmap = document.getElementById("map-google"), waze = document.getElementById("map-waze");
  if (gmap) gmap.href = "https://www.google.com/maps/search/?api=1&query=" + dest;
  if (waze) waze.href = "https://waze.com/ul?navigate=yes&q=" + dest;
  var apple = document.getElementById("map-apple");
  if (apple) apple.href = "https://maps.apple.com/?daddr=" + dest;
  var copyAddr = document.getElementById("copy-addr");
  if (copyAddr) copyAddr.addEventListener("click", function () {
    var txt = [CFG.lieu, CFG.adresse].filter(Boolean).join(", ");
    (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(function () {
      copyAddr.textContent = "Adresse copiée ✓";
      setTimeout(function () { copyAddr.textContent = "Copier l'adresse"; }, 2500);
    }).catch(function () { window.prompt("Adresse :", txt); });
  });

  /* ───────── Police Adobe (Sweet Fancy Script) ───────── */
  if (CFG.adobeFontsKit) {
    var tk = document.createElement("link");
    tk.rel = "stylesheet";
    tk.href = "https://use.typekit.net/" + encodeURIComponent(CFG.adobeFontsKit) + ".css";
    document.head.appendChild(tk);
  }

  /* ───────── Heures de vol des passeports ───────── */
  var hourCells = document.querySelectorAll("[data-flight-hours]");
  function updateFlightHours() {
    hourCells.forEach(function (dd) {
      if (dd.hasAttribute("data-hold")) return; // chiffre en train de défiler (js/motion.js)
      var birth = CFG[dd.getAttribute("data-birth")];
      var t = birth ? new Date(birth + "T00:00:00") : null;
      var hours = t && !isNaN(t) ? Math.floor((Date.now() - t) / 36e5) : Math.round(parseInt(dd.getAttribute("data-flight-hours"), 10) * 365.25 * 24);
      dd.textContent = hours.toLocaleString("fr-FR") + " h";
    });
  }
  updateFlightHours();
  if (CFG.naissanceMarjorie || CFG.naissanceChristophe) setInterval(updateFlightHours, 60000);

  /* ───────── Nav background on scroll ───────── */
  var nav = document.getElementById("nav");
  function onScroll() { nav.classList.toggle("is-scrolled", window.scrollY > 40); }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ───────── Tampons de passeport : posés quand ils arrivent à l'écran ───────── */
  var visas = document.querySelectorAll(".tampon:not(.tampon--done)");
  if ("IntersectionObserver" in window) {
    var vio = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("is-in"); vio.unobserve(e.target); }
      });
    }, { threshold: 0.4 });
    visas.forEach(function (el) { vio.observe(el); });
  } else {
    visas.forEach(function (el) { el.classList.add("is-in"); });
  }

  /* ───────── Reveal on scroll ───────── */
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("is-visible"); io.unobserve(e.target); }
      });
    }, { threshold: 0, rootMargin: "0px 0px -8% 0px" }); // seuil 0 : un bloc très haut (le formulaire sur téléphone) apparaît dès son entrée
    document.querySelectorAll(".reveal").forEach(function (el) { io.observe(el); });
  } else {
    document.querySelectorAll(".reveal").forEach(function (el) { el.classList.add("is-visible"); });
  }

  /* ───────── Split-flap ─────────
     Chaque case affiche un caractère (.ch__v). Pour changer de caractère,
     le volet du haut (ancien caractère) bascule vers le bas, puis le volet
     du bas (nouveau caractère) se rabat, comme un vrai panneau Solari. */
  var CHARSET = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:-&'";

  function buildFlap(el, len) {
    el.innerHTML = "";
    for (var i = 0; i < len; i++) {
      var c = document.createElement("span");
      c.className = "ch";
      c.dataset.c = " ";
      c.innerHTML = '<span class="ch__v"> </span>';
      el.appendChild(c);
    }
    el.setAttribute("aria-label", "");
  }

  function leaf(cls, ch) {
    var l = document.createElement("span");
    l.className = "ch__leaf " + cls;
    l.setAttribute("aria-hidden", "true");
    var t = document.createElement("span");
    t.className = "ch__t";
    t.textContent = ch;
    l.appendChild(t);
    return l;
  }

  function clearLeaves(cell) {
    cell.querySelectorAll(".ch__leaf").forEach(function (l) { l.remove(); });
  }

  function flipTo(cell, next, dur) {
    var prev = cell.dataset.c;
    if (prev === next) return;
    cell.dataset.c = next;
    clearLeaves(cell);
    cell.firstChild.textContent = next;
    if (!dur) return; // les volets restent actifs même avec « réduire les animations » : petit mouvement sur place
    cell.style.setProperty("--d", dur + "ms");
    var old = leaf("ch__leaf--old", prev);
    var bottom = leaf("ch__leaf--bottom", next);
    var top = leaf("ch__leaf--top", prev);
    cell.appendChild(old);
    cell.appendChild(bottom);
    cell.appendChild(top);
    setTimeout(function () { old.remove(); bottom.remove(); top.remove(); }, dur + 20);
  }

  var STEP = 115; // durée d'un battement de volet (ms) : assez lent pour voir le volet basculer

  function setFlap(el, text, animate) {
    var cells = el.querySelectorAll(".ch");
    var str = text.toUpperCase().padEnd(cells.length, " ").slice(0, cells.length);
    el.setAttribute("aria-label", text);
    cells.forEach(function (cell, i) {
      var final = str[i];
      var run = (cell._run = (cell._run || 0) + 1);
      if (!animate) { flipTo(cell, final, 0); return; }
      // Les volets défilent dans l'ordre du jeu de caractères jusqu'à la cible
      // (moins de battements si l'appareil demande moins d'animations)
      var steps = reduceMotion ? 1 + Math.floor(Math.random() * 3) : 4 + Math.floor(Math.random() * 7) + Math.floor(i / 3);
      var target = Math.max(0, CHARSET.indexOf(final));
      var k = (target - steps + CHARSET.length * 4) % CHARSET.length;
      (function tick() {
        if (cell._run !== run) return;
        k = (k + 1) % CHARSET.length;
        var ch = steps-- <= 0 ? final : CHARSET[k];
        flipTo(cell, ch, STEP - 10);
        if (ch !== final || steps >= 0) setTimeout(tick, STEP);
      })();
    });
  }

  function resetFlap(el) {
    el.querySelectorAll(".ch").forEach(function (cell) {
      cell._run = (cell._run || 0) + 1;
      clearLeaves(cell);
      cell.dataset.c = " ";
      cell.firstChild.textContent = " ";
    });
  }

  function tickDigits(el, text) {
    el.setAttribute("aria-label", text);
    el.querySelectorAll(".ch").forEach(function (cell, i) {
      flipTo(cell, text[i], 260);
    });
  }

  function statusText() {
    var diff = target - new Date();
    if (isNaN(diff)) return "A L'HEURE";
    if (diff <= 0) return diff > -8 * 3600e3 ? "EN VOL" : "ATTERRI";
    if (diff < 24 * 3600e3) return "EMBARQUEMENT";
    return "A L'HEURE";
  }

  var dynamic = {
    "heure-board": (CFG.heure || "19h00").replace(/h/i, ":"),
    porte: CFG.porte || "A50",
    status: statusText()
  };

  var boardFlaps = document.querySelectorAll(".board [data-flap]");
  boardFlaps.forEach(function (el) {
    buildFlap(el, parseInt(el.getAttribute("data-len"), 10));
  });

  var boardTimers = [];
  function runBoard() {
    lastRun = Date.now();
    boardTimers.forEach(clearTimeout);
    boardTimers = [];
    boardFlaps.forEach(function (el, idx) {
      var key = el.getAttribute("data-flap");
      var text = dynamic[key] !== undefined ? dynamic[key] : key;
      resetFlap(el);
      boardTimers.push(setTimeout(function () { setFlap(el, text, true); }, 150 + idx * 140));
      if (key === "status") el.classList.toggle("is-boarding", text !== "A L'HEURE");
    });
  }

  // L'animation se rejoue à chaque fois que le tableau revient à l'écran.
  var board = document.querySelector(".board");
  if ("IntersectionObserver" in window) {
    var boardVisible = false;
    new IntersectionObserver(function (entries) {
      var e = entries[0];
      if (e.isIntersecting && e.intersectionRatio >= 0.35 && !boardVisible) {
        boardVisible = true;
        runBoard();
      } else if (!e.isIntersecting) {
        boardVisible = false;
      }
    }, { threshold: [0, 0.35] }).observe(board);
  } else {
    runBoard();
  }
  // Sur ordinateur, le tableau se rejoue aussi au survol de la souris
  var lastRun = 0;
  board.addEventListener("mouseenter", function () {
    if (Date.now() - lastRun < 4000) return;
    lastRun = Date.now();
    runBoard();
  });

  /* ───────── Countdown ───────── */
  var cd = {
    days: document.getElementById("cd-days"),
    hours: document.getElementById("cd-hours"),
    min: document.getElementById("cd-min"),
    sec: document.getElementById("cd-sec")
  };
  buildFlap(cd.days, 3);
  buildFlap(cd.hours, 2);
  buildFlap(cd.min, 2);
  buildFlap(cd.sec, 2);

  function pad(n, l) { return String(n).padStart(l, "0"); }

  function updateCountdown() {
    var diff = Math.max(0, target - new Date());
    if (isNaN(diff)) diff = 0;
    var s = Math.floor(diff / 1000);
    tickDigits(cd.days, pad(Math.min(999, Math.floor(s / 86400)), 3));
    tickDigits(cd.hours, pad(Math.floor(s / 3600) % 24, 2));
    tickDigits(cd.min, pad(Math.floor(s / 60) % 60, 2));
    tickDigits(cd.sec, pad(s % 60, 2));
  }
  updateCountdown();
  setInterval(updateCountdown, 1000);

  /* ───────── Barcode ───────── */
  document.querySelectorAll(".barcode").forEach(function (svg) {
    var code = svg.getAttribute("data-code") || "MC5060";
    var seed = 0;
    for (var i = 0; i < code.length; i++) seed = (seed * 31 + code.charCodeAt(i)) >>> 0;
    function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
    var x = 0, html = "";
    while (x < 200) {
      var w = 1 + Math.floor(rnd() * 3.2);
      if (rnd() > 0.35) html += '<rect x="' + x + '" y="0" width="' + w + '" height="48"/>';
      x += w + 1;
    }
    svg.innerHTML = html;
  });

  /* ───────── Check-in / RSVP ───────── */
  var form = document.getElementById("checkin");
  var done = document.getElementById("checkin-done");
  var errorEl = document.getElementById("form-error");
  var passName = document.getElementById("pass-name");

  // Une ligne par accompagnant : son nom et son billet (midi, soir ou les deux)
  var compBox = document.getElementById("companions"), compList = document.getElementById("companions-list");
  var FARES = [["midi", "Midi"], ["soir", "Soir"], ["journee", "Les deux"]];
  function mainFare() { var c = form.querySelector('input[name="creneau"]:checked'); return c ? c.value : ""; }
  function syncCompanions() {
    var n = Math.max(0, parseInt(form.passagers.value, 10) - 1);
    var old = Array.prototype.map.call(compList.querySelectorAll(".companion"), function (row) {
      var c = row.querySelector("input[type=radio]:checked");
      var t = row.querySelectorAll("input[type=text]");
      return { prenom: t[0].value, nom: t[1].value, f: c ? c.value : "", touched: row.dataset.touched === "1" };
    });
    compList.innerHTML = "";
    for (var i = 0; i < n; i++) {
      var o = old[i] || { prenom: "", nom: "", f: mainFare(), touched: false };
      var row = document.createElement("div");
      row.className = "companion";
      if (o.touched) row.dataset.touched = "1";
      var html = '<p class="companion__title">Passager ' + (i + 2) + "</p>" +
        '<div class="name-row">' +
        '<div class="sub-field"><label for="cp' + i + '">Prénom</label><input id="cp' + i + '" type="text" maxlength="40" autocomplete="off" autocapitalize="words" /></div>' +
        '<div class="sub-field"><label for="cn' + i + '">Nom</label><input id="cn' + i + '" type="text" maxlength="40" autocomplete="off" autocapitalize="words" /></div></div>' +
        '<p class="companion__q">Vient-il ou elle&nbsp;:</p>' +
        '<div class="companion__fares" role="radiogroup" aria-label="Billet du passager ' + (i + 2) + '">';
      FARES.forEach(function (f) {
        html += '<label class="pill"><input type="radio" name="cf' + i + '" value="' + f[0] + '"' + (o.f === f[0] ? " checked" : "") + " /><span>" + f[1] + "</span></label>";
      });
      row.innerHTML = html + "</div>";
      var tx = row.querySelectorAll("input[type=text]");
      tx[0].value = o.prenom; tx[1].value = o.nom;
      row.addEventListener("change", function (e) { if (e.target.type === "radio") this.dataset.touched = "1"; });
      compList.appendChild(row);
    }
    compBox.hidden = form.presence.value !== "oui" || n === 0;
  }
  // Le billet choisi pour soi est proposé par défaut aux accompagnants (tant qu'on n'a pas changé le leur)
  form.querySelectorAll('input[name="creneau"]').forEach(function (r) {
    r.addEventListener("change", function () {
      compList.querySelectorAll(".companion").forEach(function (row) {
        if (row.dataset.touched === "1") return;
        var t = row.querySelector('input[value="' + r.value + '"]');
        if (t) t.checked = true;
      });
    });
  });
  form.passagers.addEventListener("change", syncCompanions);

  function syncPresence() {
    var yes = form.presence.value === "oui";
    form.querySelectorAll("[data-show-if]").forEach(function (el) { el.hidden = !yes; });
    syncCompanions();
  }

  // Photo souvenir (réduite sur le téléphone avant l'envoi, comme dans la Boîte noire)
  var photoInput = document.getElementById("f-photo"), photoPreview = document.getElementById("f-photo-preview"), photoData = "";
  function shrink(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
        var c = document.createElement("canvas");
        c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("Image illisible (format non pris en charge ?).")); };
      img.src = url;
    });
  }
  photoInput.addEventListener("change", function () {
    var f = photoInput.files[0];
    photoData = ""; photoPreview.hidden = true;
    if (!f) return;
    shrink(f).then(function (d) {
      photoData = d; photoPreview.src = d; photoPreview.hidden = false;
      document.getElementById("f-photo-label").textContent = "Changer de photo";
    }).catch(function (e) { showError(e.message); });
  });

  // Extras envoyés après l'enregistrement : photo → Boîte noire, chanson → Radio de bord
  function sendExtras(data) {
    var jobs = [];
    if (photoData) {
      jobs.push(fetch("/api/boite", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: data.nom.split(" ")[0], message: "", photo: photoData }) }));
    }
    var song = (form.song.value || "").trim();
    if (song && data.presence === "oui") {
      var parts = song.split(/\s+[–—-]\s+/);
      var voter = "";
      try { voter = localStorage.getItem("mc-voter") || ""; if (!voter) { voter = String(Math.random()).slice(2) + Date.now().toString(36); localStorage.setItem("mc-voter", voter); } } catch (e) { voter = String(Math.random()).slice(2); }
      jobs.push(fetch("/api/radio", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add", title: parts[0], artist: parts.slice(1).join(" - "), by: data.nom.split(" ")[0], voter: voter }) }));
    }
    return Promise.all(jobs.map(function (j) { return j.catch(function () {}); }));
  }
  form.querySelectorAll('input[name="presence"]').forEach(function (r) { r.addEventListener("change", syncPresence); });
  syncPresence();

  function showError(msg) { errorEl.textContent = msg; errorEl.hidden = !msg; }

  function fareSummary(data) {
    var all = [data.creneau].concat(data.creneauxAcc || []);
    while (all.length < data.passagers) all.push(data.creneau);
    var lbl = { midi: ["le déjeuner", "le déjeuner"], soir: ["la soirée", "la soirée"], journee: ["midi et soir", "midi et soir"] };
    var by = {};
    all.forEach(function (x) { by[x] = (by[x] || 0) + 1; });
    var keys = Object.keys(by);
    if (keys.length === 1) return (data.passagers > 1 ? "tous " : "") + lbl[keys[0]][0];
    return keys.map(function (k) { return by[k] + " pour " + lbl[k][0]; }).join(", ");
  }

  function finish(data, id, res) {
    res = res || {};
    var link = document.getElementById("done-pass");
    if (link && res.pass && data.presence === "oui") {
      link.href = "/billet?p=" + encodeURIComponent(res.pass);
      link.hidden = false;
      try { localStorage.setItem("mc-pass", res.pass); } catch (e) { /* ignoré */ }
      var note = document.getElementById("done-sent");
      if (note) note.textContent = res.emailed ? "Nous vous l'avons aussi envoyée par e-mail." : "Gardez ce lien : c'est votre carte d'embarquement numérique.";
    }
    var yes = data.presence === "oui";
    // le jour J, la page « À table ! » reconnaîtra l'invité sur ce téléphone
    if (yes && id) {
      try { localStorage.setItem("mc-me", JSON.stringify({ id: id, nom: data.nom, passagers: data.passagers })); } catch (e) { /* ignoré */ }
    }
    form.hidden = true;
    done.hidden = false;
    document.getElementById("done-title").textContent = yes ? "Bon vol, " + data.nom.split(" ")[0] + " !" : "Merci, " + data.nom.split(" ")[0] + ".";
    document.getElementById("done-text").textContent = yes
      ? "Votre enregistrement est confirmé pour " + data.passagers + " passager" + (data.passagers > 1 ? "s" : "") + " : " + fareSummary(data) +
        ". Rendez-vous porte " + (CFG.porte || "A50") + "."
      : "Vous nous manquerez à bord. Votre message a bien été transmis à l'équipage.";
    var status = document.getElementById("done-status"), sum = document.getElementById("done-sum");
    if (status) status.textContent = yes ? "Enregistrement confirmé" : "Réponse bien reçue";
    if (sum) {
      sum.hidden = !yes;
      document.getElementById("done-sum-pax").textContent = data.passagers;
      var d = String(CFG.dateLabel || "").match(/\d+\s+\S+/);
      document.getElementById("done-sum-date").textContent = d ? d[0] : (CFG.dateLabel || "");
    }
    if (yes) {
      passName.textContent = data.nom;
      passName.classList.add("is-new");
    }
    done.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
    if (window.McFx) setTimeout(function () { yes ? window.McFx.celebrate() : window.McFx.plane({ y: 0.6 }); }, 450);
  }

  // « jeanne  MARTIN » → « Jeanne Martin »
  function tidy(v) {
    return String(v || "").trim().replace(/\s+/g, " ").toLowerCase().replace(/(^|[\s'-])(\S)/g, function (m, a, b) { return a + b.toUpperCase(); });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    showError("");
    var data = {
      prenom: tidy(form.prenom.value),
      nomFamille: tidy(form.nomFamille.value),
      telephone: form.telephone.value.trim(),
      presence: form.presence.value,
      passagers: form.presence.value === "oui" ? parseInt(form.passagers.value, 10) : 0,
      creneau: form.presence.value === "oui" ? ((form.querySelector('input[name="creneau"]:checked') || {}).value || "") : "",
      repas: form.presence.value === "oui" ? form.repas.value : "",
      allergies: form.presence.value === "oui" ? form.allergies.value.trim() : "",
      accompagnants: [],
      creneauxAcc: [],
      email: form.email.value.trim(),
      message: form.message.value.trim(),
      website: form.website.value
    };
    data.nom = (data.prenom + " " + data.nomFamille).trim();
    function stop(msg, el) { showError(msg); if (el) el.focus(); form.classList.remove("is-shake"); void form.offsetWidth; form.classList.add("is-shake"); }
    if (!data.prenom) return stop("Merci d'indiquer votre prénom.", form.prenom);
    if (!data.nomFamille) return stop("Merci d'indiquer votre nom.", form.nomFamille);
    if (!data.email && !data.telephone) return stop("Indiquez votre e-mail ou votre numéro de portable pour recevoir votre carte d'embarquement.", form.email);
    if (data.telephone && data.telephone.replace(/\D/g, "").length < 9) return stop("Le numéro de téléphone semble incomplet.", form.telephone);
    if (data.presence === "oui") {
      var rows = compList.querySelectorAll(".companion"), missing = null;
      rows.forEach(function (row, i) {
        var c = row.querySelector("input[type=radio]:checked");
        if (!c && !missing) missing = row;
        var tx = row.querySelectorAll("input[type=text]");
        data.accompagnants.push((tidy(tx[0].value) + " " + tidy(tx[1].value)).trim() || "Passager " + (i + 2));
        data.creneauxAcc.push(c ? c.value : "");
      });
      if (data.creneau && missing) {
        showError("Indiquez pour chaque accompagnant s'il vient le midi, le soir ou les deux.");
        missing.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
        return;
      }
    }
    if (data.presence === "oui" && !data.creneau) {
      showError("Choisissez votre billet : le déjeuner, la soirée ou les deux.");
      form.querySelector(".fares").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
      form.classList.remove("is-shake"); void form.offsetWidth; form.classList.add("is-shake");
      return;
    }
    if (data.email && !form.email.checkValidity()) { showError("L'adresse e-mail semble incorrecte."); form.email.focus(); return; }

    var btn = form.querySelector("button[type=submit]");
    var label = btn.querySelector(".btn__label");
    var labelText = label ? label.textContent : "";
    btn.disabled = true;
    btn.classList.add("is-loading");
    if (label) label.textContent = "Enregistrement";
    fetch("/api/rsvp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (res) {
        if (!r.ok) throw new Error(res.error || "");
        return sendExtras(data).then(function () { finish(data, res.id, res); });
      });
    }).catch(function (err) {
      showError(err.message || "Oups, l'envoi a échoué. Réessayez dans un instant.");
      form.classList.remove("is-shake");
      void form.offsetWidth;
      form.classList.add("is-shake");
    }).then(function () {
      btn.disabled = false;
      btn.classList.remove("is-loading");
      if (label) label.textContent = labelText;
    });
  });
})();
