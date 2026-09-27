/*
 * Animations de la page d'accueil : entrée du hero, parallaxe du ciel, trajet
 * de l'avion dans la barre de navigation, carte d'embarquement inclinable,
 * tampons des passeports, avion qui parcourt le plan de vol, boutons aimantés.
 * Tout est désactivé si l'appareil demande moins d'animations.
 */
(function () {
  "use strict";

  var CFG = window.EVENT || {};
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  var root = document.documentElement;
  var ease = function (t) { return 1 - Math.pow(1 - t, 4); };

  function onFrame(fn) {
    var queued = false;
    return function () {
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () { queued = false; fn(); });
    };
  }
  function countUp(el, to, dur, fmt) {
    var t0 = performance.now();
    (function frame(now) {
      var k = Math.min(1, (now - t0) / dur);
      el.textContent = fmt(Math.round(to * ease(k)));
      if (k < 1) requestAnimationFrame(frame);
    })(t0);
  }
  function once(el, cb, threshold) {
    if (!el || !("IntersectionObserver" in window)) return cb && cb();
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { io.disconnect(); cb(); } });
    }, { threshold: threshold || 0.35 });
    io.observe(el);
  }

  if (reduce) return;
  root.classList.add("motion-ok");

  /* ───────── Hero : les âges défilent jusqu'à 50 et 60 ───────── */
  document.querySelectorAll(".hero__ages strong").forEach(function (el) {
    var to = parseInt(el.textContent, 10);
    if (!to) return;
    el.textContent = "0";
    setTimeout(function () { countUp(el, to, 1400, String); }, 1700);
  });

  /* ───────── Hero : parallaxe (défilement + souris) ───────── */
  var hero = document.querySelector(".hero");
  if (hero) {
    var mx = 0, my = 0;
    var apply = onFrame(function () {
      var y = Math.min(window.scrollY, hero.offsetHeight);
      hero.style.setProperty("--sy", y.toFixed(1));
      hero.style.setProperty("--fade", Math.max(0, 1 - y / (hero.offsetHeight * 0.85)).toFixed(3));
      hero.style.setProperty("--mx", mx.toFixed(3));
      hero.style.setProperty("--my", my.toFixed(3));
    });
    window.addEventListener("scroll", apply, { passive: true });
    if (fine) {
      hero.addEventListener("pointermove", function (e) {
        mx = e.clientX / innerWidth - 0.5;
        my = e.clientY / innerHeight - 0.5;
        apply();
      });
      hero.addEventListener("pointerleave", function () { mx = 0; my = 0; apply(); });
    }
    apply();
  }

  /* ───────── Trajet de vol : progression de lecture dans la barre de navigation ───────── */
  var nav = document.getElementById("nav");
  if (nav) {
    var path = document.createElement("div");
    path.className = "nav__path";
    path.setAttribute("aria-hidden", "true");
    path.innerHTML = '<i class="nav__path-done"></i><svg class="nav__path-plane" viewBox="0 0 24 24"><path fill="currentColor" transform="rotate(90 12 12)" d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>';
    nav.appendChild(path);
    var progress = onFrame(function () {
      var max = document.documentElement.scrollHeight - innerHeight;
      var p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      path.style.setProperty("--p", p.toFixed(4));
    });
    window.addEventListener("scroll", progress, { passive: true });
    window.addEventListener("resize", progress);
    progress();

    // lien de la section en cours
    var links = {};
    nav.querySelectorAll('.nav__links a[href^="#"]').forEach(function (a) { links[a.getAttribute("href").slice(1)] = a; });
    if ("IntersectionObserver" in window) {
      var spy = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          var a = links[e.target.id];
          if (a && e.isIntersecting) {
            Object.keys(links).forEach(function (k) { links[k].classList.toggle("is-current", links[k] === a); });
          }
        });
      }, { rootMargin: "-45% 0px -50% 0px" });
      Object.keys(links).forEach(function (id) { var s = document.getElementById(id); if (s) spy.observe(s); });
    }
  }

  /* ───────── Carte d'embarquement : inclinaison 3D et reflet holographique ───────── */
  var pass = document.querySelector(".pass");
  if (pass && fine) {
    var tilt = { x: 0, y: 0 };
    var draw = onFrame(function () {
      var ang = Math.sqrt(tilt.x * tilt.x + tilt.y * tilt.y);
      if (ang < 0.001) { pass.style.rotate = ""; return; }
      pass.style.rotate = (-tilt.y / ang).toFixed(3) + " " + (tilt.x / ang).toFixed(3) + " 0 " + (ang * 9).toFixed(2) + "deg";
    });
    pass.addEventListener("pointermove", function (e) {
      var r = pass.getBoundingClientRect();
      tilt.x = (e.clientX - r.left) / r.width - 0.5;
      tilt.y = (e.clientY - r.top) / r.height - 0.5;
      pass.style.setProperty("--px", ((tilt.x + 0.5) * 100).toFixed(1) + "%");
      pass.style.setProperty("--py", ((tilt.y + 0.5) * 100).toFixed(1) + "%");
      pass.classList.add("is-tilting");
      draw();
    });
    pass.addEventListener("pointerleave", function () {
      tilt.x = 0; tilt.y = 0;
      pass.classList.remove("is-tilting");
      draw();
    });
  }
  once(pass, function () { pass.classList.add("is-scanned"); }, 0.5);

  /* ───────── Passeports : tampon « admis » et heures de vol qui défilent ───────── */
  document.querySelectorAll("[data-flight-hours]").forEach(function (dd) { dd.setAttribute("data-hold", ""); dd.textContent = "0 h"; });
  document.querySelectorAll(".passport").forEach(function (pp, i) {
    once(pp, function () {
      setTimeout(function () {
        pp.classList.add("is-stamped");
        var dd = pp.querySelector("[data-flight-hours]");
        var birth = dd && CFG[dd.getAttribute("data-birth")];
        var t = birth ? new Date(birth + "T00:00:00") : null;
        if (dd) {
          var hours = t && !isNaN(t) ? Math.floor((Date.now() - t) / 36e5) : Math.round(parseInt(dd.getAttribute("data-flight-hours"), 10) * 8766);
          countUp(dd, hours, 1600, function (n) { return n.toLocaleString("fr-FR") + " h"; });
          setTimeout(function () { dd.removeAttribute("data-hold"); }, 1700);
        }
      }, 350 + i * 450);
    }, 0.45);
  });

  /* ───────── Plan de vol : un avion descend le long du programme ───────── */
  var list = document.getElementById("programme");
  if (list) {
    var plane = document.createElement("li");
    plane.className = "timeline__plane";
    plane.setAttribute("aria-hidden", "true");
    plane.innerHTML = '<svg viewBox="0 0 24 24"><path fill="currentColor" transform="rotate(180 12 12)" d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>';
    list.appendChild(plane);
    list.classList.add("has-flight");
    var steps = function () { return list.querySelectorAll("li:not(.timeline__plane)"); };
    var fly = onFrame(function () {
      var r = list.getBoundingClientRect();
      var p = (innerHeight * 0.62 - r.top) / r.height;
      p = Math.min(1, Math.max(0, p));
      list.style.setProperty("--prog", p.toFixed(4));
      var y = p * r.height;
      steps().forEach(function (li) { li.classList.toggle("is-passed", li.offsetTop + 28 <= y + 6); });
    });
    window.addEventListener("scroll", fly, { passive: true });
    window.addEventListener("resize", fly);
    fly();
  }

  /* ───────── Boutons d'action aimantés (souris uniquement) ───────── */
  if (fine) {
    document.querySelectorAll(".btn--magnet").forEach(function (b) {
      b.addEventListener("pointermove", function (e) {
        var r = b.getBoundingClientRect();
        var dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
        var dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
        b.style.translate = (dx * 6).toFixed(1) + "px " + (dy * 4).toFixed(1) + "px";
      });
      b.addEventListener("pointerleave", function () { b.style.translate = ""; });
    });
  }
})();
