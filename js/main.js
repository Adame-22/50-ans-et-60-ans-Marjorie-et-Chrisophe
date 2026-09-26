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

  /* ───────── Split-flap ───────── */
  var CHARSET = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:-&";

  function buildFlap(el, len) {
    el.innerHTML = "";
    for (var i = 0; i < len; i++) {
      var c = document.createElement("span");
      c.className = "ch";
      c.textContent = " ";
      el.appendChild(c);
    }
    el.setAttribute("aria-label", "");
  }

  function setFlap(el, text, animate) {
    var cells = el.querySelectorAll(".ch");
    var str = text.toUpperCase().padEnd(cells.length, " ").slice(0, cells.length);
    el.setAttribute("aria-label", text);
    cells.forEach(function (cell, i) {
      var final = str[i];
      if (cell.textContent === final) return;
      if (!animate || reduceMotion) { cell.textContent = final; return; }
      var steps = 6 + Math.floor(Math.random() * 10) + i;
      var n = 0;
      (function tick() {
        cell.classList.remove("is-flipping");
        void cell.offsetWidth;
        cell.classList.add("is-flipping");
        if (n++ >= steps) { cell.textContent = final; return; }
        cell.textContent = CHARSET[Math.floor(Math.random() * CHARSET.length)];
        setTimeout(tick, 55);
      })();
    });
  }

  function tickDigits(el, text) {
    var cells = el.querySelectorAll(".ch");
    el.setAttribute("aria-label", text);
    cells.forEach(function (cell, i) {
      if (cell.textContent !== text[i]) {
        cell.textContent = text[i];
        if (!reduceMotion) {
          cell.classList.remove("is-flipping");
          void cell.offsetWidth;
          cell.classList.add("is-flipping");
        }
      }
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

  var boardStarted = false;
  function runBoard() {
    if (boardStarted) return;
    boardStarted = true;
    boardFlaps.forEach(function (el, idx) {
      var key = el.getAttribute("data-flap");
      var text = dynamic[key] !== undefined ? dynamic[key] : key;
      setTimeout(function () { setFlap(el, text, true); }, idx * 120);
      if (key === "status") el.classList.toggle("is-boarding", text !== "A L'HEURE");
    });
  }

  var board = document.querySelector(".board");
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (entries, obs) {
      if (entries[0].isIntersecting) { runBoard(); obs.disconnect(); }
    }, { threshold: 0.3 }).observe(board);
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
      email: form.email.value.trim(),
      message: form.message.value.trim()
    };
    if (!data.nom) { showError("Merci d'indiquer le nom du passager."); form.nom.focus(); return; }
    if (data.email && !form.email.checkValidity()) { showError("L'adresse e-mail semble incorrecte."); form.email.focus(); return; }

    var btn = form.querySelector("button[type=submit]");

    if (CFG.formspreeEndpoint) {
      btn.disabled = true;
      fetch(CFG.formspreeEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(data)
      }).then(function (r) {
        if (!r.ok) throw new Error();
        finish(data);
      }).catch(function () {
        showError("Oups, l'envoi a échoué. Réessayez dans un instant.");
      }).then(function () { btn.disabled = false; });
      return;
    }

    if (CFG.contactEmail) {
      var subject = "Enregistrement vol MC 5060 — " + data.nom;
      var body = [
        "Passager : " + data.nom,
        "Présence : " + (data.presence === "oui" ? "Oui" : "Non"),
        data.presence === "oui" ? "Nombre de passagers : " + data.passagers : "",
        data.presence === "oui" ? "Repas : " + data.repas : "",
        data.email ? "E-mail : " + data.email : "",
        data.message ? "\nMessage :\n" + data.message : ""
      ].filter(Boolean).join("\n");
      window.location.href = "mailto:" + CFG.contactEmail + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
    }

    finish(data);
  });
})();
