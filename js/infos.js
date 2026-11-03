/*
 * Page « Infos passagers » (/infos) : remplit les horaires, le lieu, le plan de vol
 * et les liens d'itinéraire à partir de js/config.js.
 */
(function () {
  "use strict";
  var CFG = window.EVENT || {};
  function esc(v) { var d = document.createElement("div"); d.textContent = v == null ? "" : v; return d.innerHTML; }

  document.querySelectorAll("[data-cfg]").forEach(function (el) {
    var v = CFG[el.getAttribute("data-cfg")];
    if (v) el.textContent = v;
  });
  if (!CFG.heureSoir) document.querySelectorAll(".ip-time")[1].hidden = true;

  var prog = document.getElementById("programme");
  if (prog && CFG.programme) {
    prog.innerHTML = CFG.programme.map(function (st) {
      return "<li><time>" + esc(st.heure) + "</time><div><h3>" + esc(st.titre) + "</h3><p>" + esc(st.texte) + "</p></div></li>";
    }).join("");
  }

  var dest = encodeURIComponent(CFG.navQuery || [CFG.lieu, CFG.adresse].filter(Boolean).join(", "));
  var set = function (id, href) { var a = document.getElementById(id); if (a) a.href = href; };
  set("map-google", CFG.mapsUrl || "https://www.google.com/maps/search/?api=1&query=" + dest);
  set("map-waze", "https://waze.com/ul?navigate=yes&q=" + dest);
  set("map-apple", "https://maps.apple.com/?daddr=" + dest);

  var copy = document.getElementById("copy-addr");
  if (copy) copy.addEventListener("click", function () {
    var txt = [CFG.lieu, CFG.adresse, CFG.repere ? "(" + CFG.repere.toLowerCase() + ")" : ""].filter(Boolean).join(", ");
    (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(function () {
      copy.textContent = "Adresse copiée ✓";
      setTimeout(function () { copy.textContent = "Copier l'adresse"; }, 2500);
    }).catch(function () { window.prompt("Adresse :", txt); });
  });
})();
