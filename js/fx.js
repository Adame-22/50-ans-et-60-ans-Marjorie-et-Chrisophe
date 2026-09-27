/*
 * Effets partagés — confettis aux couleurs du vol, petit avion qui traverse l'écran,
 * onde au toucher des boutons. Tout est coupé si l'appareil demande moins d'animations.
 *   McFx.confetti({ x, y, angle, spread, velocity, count })   x, y en fraction de l'écran
 *   McFx.celebrate()   deux salves + un avion
 *   McFx.plane()       un avion traverse l'écran
 */
(function () {
  "use strict";

  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var COLORS = ["#ffb100", "#a67046", "#fffbfe", "#bf9468", "#f3cf7a", "#7a7d7d"];
  var canvas, ctx, parts = [], raf = 0, dpr = 1;

  function resize() {
    if (!canvas) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(innerWidth * dpr);
    canvas.height = Math.round(innerHeight * dpr);
  }

  function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement("canvas");
    canvas.className = "fx-canvas";
    canvas.setAttribute("aria-hidden", "true");
    document.body.appendChild(canvas);
    ctx = canvas.getContext("2d");
    resize();
    window.addEventListener("resize", resize);
  }

  function confetti(o) {
    if (reduce) return;
    o = o || {};
    ensureCanvas();
    var n = o.count || 110;
    var x = (o.x != null ? o.x : 0.5) * innerWidth;
    var y = (o.y != null ? o.y : 0.6) * innerHeight;
    var spread = (o.spread != null ? o.spread : 70) * Math.PI / 180;
    var angle = (o.angle != null ? o.angle : 90) * Math.PI / 180;
    var v = o.velocity || 14;
    for (var i = 0; i < n; i++) {
      var a = angle + (Math.random() - 0.5) * spread;
      var sp = v * (0.5 + Math.random() * 0.65);
      parts.push({
        x: x, y: y, vx: Math.cos(a) * sp, vy: -Math.sin(a) * sp,
        w: 5 + Math.random() * 5, h: 9 + Math.random() * 8,
        r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.28,
        tilt: Math.random() * Math.PI, vt: 0.06 + Math.random() * 0.12,
        sway: Math.random() * 6.28,
        c: COLORS[(Math.random() * COLORS.length) | 0],
        round: Math.random() < 0.18,
        life: 0, max: 170 + Math.random() * 90
      });
    }
    if (!raf) raf = requestAnimationFrame(step);
  }

  function step() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    parts = parts.filter(function (p) { return p.life < p.max && p.y < innerHeight + 30; });
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      p.life++;
      p.vx *= 0.986;
      p.vy = p.vy * 0.986 + 0.3;
      p.x += p.vx + Math.sin(p.life / 11 + p.sway) * 0.7;
      p.y += p.vy;
      p.r += p.vr;
      p.tilt += p.vt;
      ctx.save();
      ctx.globalAlpha = Math.min(1, (p.max - p.life) / 35);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.scale(1, Math.cos(p.tilt));
      ctx.fillStyle = p.c;
      if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.w / 2, 0, 6.2832); ctx.fill(); }
      else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (parts.length) raf = requestAnimationFrame(step);
    else { raf = 0; ctx.clearRect(0, 0, innerWidth, innerHeight); }
  }

  var PLANE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>';

  function plane(o) {
    if (reduce || !document.body.animate) return;
    o = o || {};
    var el = document.createElement("div");
    el.className = "fx-plane";
    el.innerHTML = PLANE + "<i></i>";
    document.body.appendChild(el);
    var W = innerWidth, H = innerHeight, y0 = o.y != null ? o.y : 0.78;
    var anim = el.animate([
      { transform: "translate(-80px," + H * y0 + "px) rotate(74deg) scale(.8)", opacity: 0 },
      { opacity: 1, offset: 0.12 },
      { transform: "translate(" + W * 0.5 + "px," + H * (y0 - 0.34) + "px) rotate(64deg) scale(1)", offset: 0.55 },
      { transform: "translate(" + (W + 80) + "px," + H * (y0 - 0.66) + "px) rotate(58deg) scale(.9)", opacity: 1 }
    ], { duration: o.duration || 2600, easing: "cubic-bezier(.45,.05,.4,1)" });
    anim.onfinish = function () { el.remove(); };
  }

  function celebrate() {
    confetti({ x: 0.08, y: 1.02, angle: 64, spread: 46, velocity: 21, count: 90 });
    confetti({ x: 0.92, y: 1.02, angle: 116, spread: 46, velocity: 21, count: 90 });
    setTimeout(function () { plane(); }, 250);
  }

  /* Onde au toucher : sur les boutons (.btn, .fx-press, boutons de quiz) */
  function ripple(e) {
    if (reduce) return;
    var el = e.target.closest && e.target.closest(".btn, .fx-press, .choice-btn");
    if (!el || el.disabled) return;
    var r = el.getBoundingClientRect();
    var d = Math.max(r.width, r.height) * 2.2;
    var s = document.createElement("span");
    s.className = "fx-ripple";
    s.style.width = s.style.height = d + "px";
    s.style.left = (e.clientX - r.left - d / 2) + "px";
    s.style.top = (e.clientY - r.top - d / 2) + "px";
    el.appendChild(s);
    setTimeout(function () { s.remove(); }, 700);
  }
  document.addEventListener("pointerdown", ripple, { passive: true });

  window.McFx = { confetti: confetti, celebrate: celebrate, plane: plane, reduced: reduce };
})();
