/* Trouver ma place — recherche d'un invité et de sa table */
(function () {
  "use strict";
  var input = document.getElementById("s-name");
  var out = document.getElementById("out");
  var timer, seq = 0;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function showSeat(r) {
    out.innerHTML = '<div class="live-card seat-result" style="margin-top:14px">' +
      '<p class="live__tag">' + esc(r.nom) + (r.passagers > 1 ? " · " + r.passagers + " passagers" : "") + "</p>" +
      (r.table
        ? '<p class="big-table">' + esc(r.table) + '</p><p class="muted">Installez-vous, le commandant vous souhaite un excellent vol.</p>' +
          (r.voisins.length ? '<p class="live__tag" style="margin-top:1.2rem">Vos voisins de rang</p><div class="neighbours">' +
            r.voisins.map(function (v) { return "<span>" + esc(v) + "</span>"; }).join("") + "</div>" : "")
        : '<p class="big-table">À l\'accueil</p><p class="muted">Votre place n\'est pas encore attribuée : l\'équipage vous accompagnera.</p>') +
      "</div>";
  }

  function search() {
    var q = input.value.trim();
    if (q.length < 2) { out.innerHTML = ""; return; }
    var my = ++seq;
    fetch("/api/place?q=" + encodeURIComponent(q)).then(function (r) { return r.json(); }).then(function (d) {
      if (my !== seq) return;
      var list = d.results || [];
      if (!list.length) {
        out.innerHTML = '<div class="live-card center" style="margin-top:14px"><p class="muted">Aucun passager trouvé. Essayez votre nom de famille, ou demandez à l\'équipage.</p></div>';
      } else if (list.length === 1) {
        showSeat(list[0]);
      } else {
        out.innerHTML = '<div class="live-card" style="margin-top:14px"><p class="live__tag" style="margin-bottom:.8rem">Qui êtes-vous ?</p><div class="pick-list">' +
          list.map(function (r, i) { return '<button type="button" data-i="' + i + '">' + esc(r.nom) + "</button>"; }).join("") + "</div></div>";
        out.querySelectorAll("[data-i]").forEach(function (b) {
          b.addEventListener("click", function () { showSeat(list[parseInt(b.getAttribute("data-i"), 10)]); });
        });
      }
    }).catch(function () {
      out.innerHTML = '<div class="live-card center" style="margin-top:14px"><p class="muted">Connexion difficile… réessayez dans un instant.</p></div>';
    });
  }

  input.addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(search, 250); });
  document.getElementById("seek").addEventListener("submit", function (e) { e.preventDefault(); search(); });
  input.focus();
})();
