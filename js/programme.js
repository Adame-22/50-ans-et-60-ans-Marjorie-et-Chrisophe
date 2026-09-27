/*
 * Programme de la fête et « étape en cours » le jour J.
 * Utilisé par la page d'accueil et par l'écran géant.
 *   McProgramme.steps()          → étapes avec leur horaire (Date) quand il existe
 *   McProgramme.status(now)      → { mode: "avant" | "jourj" | "apres", current, next }
 */
(function () {
  "use strict";
  var CFG = window.EVENT || {};

  function steps() {
    var start = new Date(CFG.date);
    return (CFG.programme || []).map(function (s) {
      var m = /^(\d{1,2})\s*[h:]\s*(\d{2})?$/i.exec(String(s.heure || "").trim());
      var at = null;
      if (m && !isNaN(start)) {
        at = new Date(start);
        at.setHours(parseInt(m[1], 10), parseInt(m[2] || "0", 10), 0, 0);
      }
      return { heure: s.heure, titre: s.titre, texte: s.texte, at: at };
    });
  }

  function status(now) {
    now = now || new Date();
    var list = steps();
    var start = new Date(CFG.date);
    if (isNaN(start) || !list.length) return { mode: "avant", current: null, next: null };
    var sameDay = now.getFullYear() === start.getFullYear() && now.getMonth() === start.getMonth() && now.getDate() === start.getDate();
    if (!sameDay) return { mode: now < start ? "avant" : "apres", current: null, next: null };
    var cur = -1;
    list.forEach(function (s, i) {
      // une étape sans heure prend le relais de la précédente une fois celle-ci entamée
      if (s.at ? now >= s.at : cur === i - 1 && i > 0 && list[i - 1].at && now - list[i - 1].at > 90 * 60e3) cur = i;
    });
    return { mode: "jourj", current: cur >= 0 ? list[cur] : null, next: list[cur + 1] || null, index: cur };
  }

  window.McProgramme = { steps: steps, status: status };
})();
