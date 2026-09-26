(function () {
  "use strict";

  var CFG = window.EVENT || {};
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var target = new Date(CFG.date);

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

  /* ───────── Liens d'itinéraire ───────── */
  var dest = encodeURIComponent([CFG.lieu, CFG.adresse].filter(Boolean).join(", "));
  var gmap = document.getElementById("map-google"), waze = document.getElementById("map-waze");
  if (gmap) gmap.href = "https://www.google.com/maps/search/?api=1&query=" + dest;
  if (waze) waze.href = "https://waze.com/ul?navigate=yes&q=" + dest;

  /* ───────── Nav background on scroll ───────── */
  var nav = document.getElementById("nav");
  function onScroll() { nav.classList.toggle("is-scrolled", window.scrollY > 40); }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ───────── Reveal on scroll ───────── */
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("is-visible"); io.unobserve(e.target); }
      });
    }, { threshold: 0.15, rootMargin: "0px 0px -40px 0px" });
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
    if (reduceMotion || !dur) return;
    cell.style.setProperty("--d", dur + "ms");
    var old = leaf("ch__leaf--old", prev);
    var bottom = leaf("ch__leaf--bottom", next);
    var top = leaf("ch__leaf--top", prev);
    cell.appendChild(old);
    cell.appendChild(bottom);
    cell.appendChild(top);
    setTimeout(function () { old.remove(); bottom.remove(); top.remove(); }, dur + 20);
  }

  var STEP = 75; // durée d'un battement de volet (ms)

  function setFlap(el, text, animate) {
    var cells = el.querySelectorAll(".ch");
    var str = text.toUpperCase().padEnd(cells.length, " ").slice(0, cells.length);
    el.setAttribute("aria-label", text);
    cells.forEach(function (cell, i) {
      var final = str[i];
      var run = (cell._run = (cell._run || 0) + 1);
      if (!animate || reduceMotion) { flipTo(cell, final, 0); return; }
      // Les volets défilent dans l'ordre du jeu de caractères jusqu'à la cible
      var steps = 6 + Math.floor(Math.random() * 9) + Math.floor(i / 2);
      var target = Math.max(0, CHARSET.indexOf(final));
      var k = (target - steps + CHARSET.length * 4) % CHARSET.length;
      (function tick() {
        if (cell._run !== run) return;
        k = (k + 1) % CHARSET.length;
        var ch = steps-- <= 0 ? final : CHARSET[k];
        flipTo(cell, ch, STEP - 5);
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

  function syncPresence() {
    var yes = form.presence.value === "oui";
    form.querySelectorAll("[data-show-if]").forEach(function (el) { el.hidden = !yes; });
  }
  form.querySelectorAll('input[name="presence"]').forEach(function (r) { r.addEventListener("change", syncPresence); });
  syncPresence();

  function showError(msg) { errorEl.textContent = msg; errorEl.hidden = !msg; }

  function finish(data) {
    var yes = data.presence === "oui";
    form.hidden = true;
    done.hidden = false;
    document.getElementById("done-title").textContent = yes ? "Bon vol, " + data.nom.split(" ")[0] + " !" : "Merci, " + data.nom.split(" ")[0] + ".";
    document.getElementById("done-text").textContent = yes
      ? "Votre enregistrement est confirmé pour " + data.passagers + " passager" + (data.passagers > 1 ? "s" : "") + ". Rendez-vous porte " + (CFG.porte || "A50") + "."
      : "Vous nous manquerez à bord. Votre message a bien été transmis à l'équipage.";
    if (yes) passName.textContent = data.nom;
    done.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    showError("");
    var data = {
      nom: form.nom.value.trim(),
      presence: form.presence.value,
      passagers: form.presence.value === "oui" ? parseInt(form.passagers.value, 10) : 0,
      repas: form.presence.value === "oui" ? form.repas.value : "",
      allergies: form.presence.value === "oui" ? form.allergies.value.trim() : "",
      email: form.email.value.trim(),
      message: form.message.value.trim(),
      website: form.website.value
    };
    if (!data.nom) { showError("Merci d'indiquer le nom du passager."); form.nom.focus(); return; }
    if (data.email && !form.email.checkValidity()) { showError("L'adresse e-mail semble incorrecte."); form.email.focus(); return; }

    var btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    fetch("/api/rsvp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (res) {
        if (!r.ok) throw new Error(res.error || "");
        finish(data);
      });
    }).catch(function (err) {
      showError(err.message || "Oups, l'envoi a échoué. Réessayez dans un instant.");
    }).then(function () { btn.disabled = false; });
  });
})();
