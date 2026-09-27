/*
 * Constellation — graphe à forces façon Obsidian, sur <canvas>, sans dépendance.
 *
 *   var g = McGraph.mount(canvas, { nodes: [...], links: [[idA, idB], ...] }, { onSelect: fn });
 *   g.fit();  g.destroy();
 *
 * Nœud : { id, label, kind: "center" | "hub" | "guest", weight, special, data }
 */
(function () {
  "use strict";

  var COLORS = {
    bg: "#04041c",
    link: "rgba(255, 251, 254, 0.13)",
    linkHi: "rgba(255, 177, 0, 0.75)",
    center: "#fffbfe",
    hub: "#a67046",
    guest: "#b8bac4",
    hi: "#ffb100",
    label: "rgba(255, 251, 254, 0.82)",
    labelDim: "rgba(255, 251, 254, 0.25)",
  };

  function radius(n) {
    if (n.kind === "center") return 16;
    if (n.kind === "hub") return 9;
    return 3.5 + 1.6 * Math.sqrt(n.weight || 1);
  }

  function mount(canvas, data, opts) {
    opts = opts || {};
    var ctx = canvas.getContext("2d");
    var dpr = Math.max(1, window.devicePixelRatio || 1);
    var W = 0, H = 0;
    var view = { x: 0, y: 0, k: 1 };
    var alpha = 1;
    var raf = 0;
    var hover = null, selected = null, drag = null, pan = null;
    var pointers = {};
    var pinch = null;
    var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    var byId = {};
    var nodes = data.nodes.map(function (n, i) {
      var o = Object.assign({}, n);
      o.r = radius(o);
      o.vx = 0; o.vy = 0;
      o.nb = [];
      byId[o.id] = o;
      return o;
    });
    var links = data.links.map(function (l) { return { a: byId[l[0]], b: byId[l[1]] }; })
      .filter(function (l) { return l.a && l.b; });
    links.forEach(function (l) { l.a.nb.push(l.b); l.b.nb.push(l.a); });

    // Positions initiales : hubs en couronne, invités autour de leur hub
    var hubs = nodes.filter(function (n) { return n.kind === "hub"; });
    nodes.forEach(function (n) {
      if (n.kind === "center") { n.x = 0; n.y = 0; return; }
      if (n.kind === "hub") {
        var a = (hubs.indexOf(n) / Math.max(1, hubs.length)) * Math.PI * 2;
        n.x = Math.cos(a) * 190; n.y = Math.sin(a) * 190; return;
      }
      var p = n.nb[0] || { x: 0, y: 0 };
      n.x = (p.x || 0) + (Math.random() - 0.5) * 80;
      n.y = (p.y || 0) + (Math.random() - 0.5) * 80;
    });

    function linkLength(l) {
      var kinds = l.a.kind + l.b.kind;
      if (kinds.indexOf("center") > -1) return 170 + 6 * Math.sqrt(Math.max(l.a.nb.length, l.b.nb.length));
      // Les groupes nombreux s'étalent davantage pour garder les noms lisibles
      var hub = l.a.kind === "hub" ? l.a : l.b;
      return 50 + 11 * Math.sqrt(hub.nb.length) + Math.min(l.a.r, l.b.r) * 2;
    }

    function tick() {
      var i, j, a, b, dx, dy, d2, d, f;
      // Répulsion entre tous les nœuds
      for (i = 0; i < nodes.length; i++) {
        a = nodes[i];
        for (j = i + 1; j < nodes.length; j++) {
          b = nodes[j];
          dx = b.x - a.x; dy = b.y - a.y;
          d2 = dx * dx + dy * dy || 0.01;
          if (d2 > 250000) continue;
          d = Math.sqrt(d2);
          f = (900 + 40 * (a.r + b.r)) / d2 * alpha;
          dx /= d; dy /= d;
          a.vx -= dx * f; a.vy -= dy * f;
          b.vx += dx * f; b.vy += dy * f;
        }
      }
      // Ressorts le long des liens
      links.forEach(function (l) {
        dx = l.b.x - l.a.x; dy = l.b.y - l.a.y;
        d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        f = (d - linkLength(l)) * 0.035 * alpha;
        dx /= d; dy /= d;
        l.a.vx += dx * f; l.a.vy += dy * f;
        l.b.vx -= dx * f; l.b.vy -= dy * f;
      });
      // Gravité douce vers le centre, amortissement
      nodes.forEach(function (n) {
        n.vx -= n.x * 0.004 * alpha; n.vy -= n.y * 0.004 * alpha;
        if (n === drag || n.kind === "center") { n.vx = 0; n.vy = 0; return; }
        n.vx *= 0.82; n.vy *= 0.82;
        n.x += n.vx; n.y += n.vy;
      });
      alpha = Math.max(0.03, alpha * 0.992);
    }

    function isHi(n) {
      var focus = hover || selected;
      return !focus || n === focus || focus.nb.indexOf(n) > -1;
    }

    function draw() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = COLORS.bg;
      ctx.fillRect(0, 0, W, H);
      ctx.setTransform(dpr * view.k, 0, 0, dpr * view.k, dpr * (W / 2 + view.x), dpr * (H / 2 + view.y));
      var focus = hover || selected;

      links.forEach(function (l) {
        var hi = focus && (l.a === focus || l.b === focus);
        ctx.strokeStyle = hi ? COLORS.linkHi : COLORS.link;
        ctx.globalAlpha = focus && !hi ? 0.35 : 1;
        ctx.lineWidth = (hi ? 1.6 : 1) / view.k;
        ctx.beginPath(); ctx.moveTo(l.a.x, l.a.y); ctx.lineTo(l.b.x, l.b.y); ctx.stroke();
      });

      nodes.forEach(function (n) {
        var on = isHi(n);
        ctx.globalAlpha = on ? 1 : 0.22;
        if (n.kind === "center") {
          ctx.shadowColor = "rgba(255, 177, 0, .55)"; ctx.shadowBlur = 24;
        }
        ctx.fillStyle = n === focus ? COLORS.hi : COLORS[n.kind];
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
        if (n.special) {
          ctx.strokeStyle = COLORS.hi; ctx.lineWidth = 1.5 / view.k;
          ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 3 / view.k, 0, Math.PI * 2); ctx.stroke();
        }
      });

      // Étiquettes : toujours pour le centre et les hubs, au zoom ou au survol pour les invités
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      nodes.forEach(function (n) {
        var near = focus && (n === focus || focus.nb.indexOf(n) > -1);
        if (n.kind === "guest" && view.k < 0.9 && !near) return;
        var size = (n.kind === "center" ? 15 : n.kind === "hub" ? 12.5 : 11) / Math.max(0.75, view.k);
        ctx.font = (n.kind === "guest" ? "500 " : "600 ") + size + "px Manrope, system-ui, sans-serif";
        ctx.globalAlpha = 1;
        ctx.fillStyle = isHi(n) ? COLORS.label : COLORS.labelDim;
        ctx.fillText(n.label, n.x, n.y + n.r + 4 / view.k);
      });
      ctx.globalAlpha = 1;
    }

    function loop() {
      if (!reduce || alpha > 0.5) tick();
      draw();
      raf = requestAnimationFrame(loop);
    }

    function resize() {
      var rect = canvas.getBoundingClientRect();
      W = rect.width; H = rect.height;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    }

    function fit() {
      if (!nodes.length) return;
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      nodes.forEach(function (n) {
        minX = Math.min(minX, n.x - n.r); maxX = Math.max(maxX, n.x + n.r);
        minY = Math.min(minY, n.y - n.r); maxY = Math.max(maxY, n.y + n.r + 18);
      });
      var k = Math.min(W / (maxX - minX + 80), H / (maxY - minY + 80), 1.6);
      view.k = Math.max(0.3, k);
      view.x = -((minX + maxX) / 2) * view.k;
      view.y = -((minY + maxY) / 2) * view.k;
    }

    function toWorld(px, py) {
      return { x: (px - W / 2 - view.x) / view.k, y: (py - H / 2 - view.y) / view.k };
    }

    function pick(px, py) {
      var p = toWorld(px, py), best = null, bestD = Infinity;
      nodes.forEach(function (n) {
        var d = Math.hypot(n.x - p.x, n.y - p.y);
        if (d < n.r + 6 / view.k && d < bestD) { best = n; bestD = d; }
      });
      return best;
    }

    function local(e) {
      var r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    function onDown(e) {
      canvas.setPointerCapture(e.pointerId);
      var p = local(e);
      pointers[e.pointerId] = p;
      var ids = Object.keys(pointers);
      if (ids.length === 2) {
        var a = pointers[ids[0]], b = pointers[ids[1]];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: view.k };
        drag = null; pan = null;
        return;
      }
      var n = pick(p.x, p.y);
      if (n) { drag = n; drag.moved = false; alpha = Math.max(alpha, 0.5); }
      else pan = { x: p.x, y: p.y, vx: view.x, vy: view.y, moved: false };
    }

    function onMove(e) {
      var p = local(e);
      if (pointers[e.pointerId]) pointers[e.pointerId] = p;
      if (pinch) {
        var ids = Object.keys(pointers);
        if (ids.length === 2) {
          var a = pointers[ids[0]], b = pointers[ids[1]];
          view.k = Math.min(4, Math.max(0.25, pinch.k * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d));
        }
        return;
      }
      if (drag) {
        var w = toWorld(p.x, p.y);
        drag.x = w.x; drag.y = w.y; drag.moved = true;
        alpha = Math.max(alpha, 0.3);
        return;
      }
      if (pan) {
        view.x = pan.vx + p.x - pan.x; view.y = pan.vy + p.y - pan.y;
        if (Math.abs(p.x - pan.x) + Math.abs(p.y - pan.y) > 3) pan.moved = true;
        return;
      }
      var h = pick(p.x, p.y);
      if (h !== hover) { hover = h; canvas.style.cursor = h ? "pointer" : "grab"; }
    }

    function onUp(e) {
      delete pointers[e.pointerId];
      if (pinch) { if (Object.keys(pointers).length < 2) pinch = null; return; }
      if (drag && !drag.moved) select(drag);
      if (pan && !pan.moved) select(null);
      drag = null; pan = null;
    }

    function onWheel(e) {
      e.preventDefault();
      var p = local(e);
      var w = toWorld(p.x, p.y);
      view.k = Math.min(4, Math.max(0.25, view.k * Math.exp(-e.deltaY * 0.0015)));
      view.x = p.x - W / 2 - w.x * view.k;
      view.y = p.y - H / 2 - w.y * view.k;
    }

    function onLeave() { hover = null; }

    function select(n) {
      selected = n;
      if (opts.onSelect) opts.onSelect(n);
    }

    canvas.style.cursor = "grab";
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    var ro = new ResizeObserver(function () { resize(); });
    ro.observe(canvas);

    resize();
    for (var i = 0; i < 220; i++) tick(); // pré-calcul pour un affichage posé
    alpha = reduce ? 0 : 0.25;
    fit();
    loop();

    return {
      fit: fit,
      destroy: function () {
        cancelAnimationFrame(raf);
        ro.disconnect();
        canvas.removeEventListener("pointerdown", onDown);
        canvas.removeEventListener("pointermove", onMove);
        canvas.removeEventListener("pointerup", onUp);
        canvas.removeEventListener("pointercancel", onUp);
        canvas.removeEventListener("pointerleave", onLeave);
        canvas.removeEventListener("wheel", onWheel);
      },
    };
  }

  window.McGraph = { mount: mount };
})();
