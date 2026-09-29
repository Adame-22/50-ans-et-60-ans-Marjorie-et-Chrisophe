/*
 * « Ajouter à l'écran d'accueil » : une petite carte, proposée une seule fois,
 * pour retrouver le site comme une appli le jour J (quiz, table, boîte noire…).
 * Android / Chrome : bouton d'installation natif. iPhone : l'astuce du bouton Partager.
 */
(function () {
  "use strict";
  var KEY = "mc-install";
  function get() { try { return localStorage.getItem(KEY); } catch (e) { return "x"; } }
  function set(v) { try { localStorage.setItem(KEY, v); } catch (e) { /* ignoré */ } }
  var standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
  if (standalone || get()) return;
  var ua = navigator.userAgent;
  var ios = /iPhone|iPad|iPod/.test(ua) && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  var deferred = null, shown = false;

  function show() {
    if (shown || get()) return;
    shown = true;
    var el = document.createElement("div");
    el.className = "install-card";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", "Ajouter le site à l'écran d'accueil");
    el.innerHTML = '<img src="/assets/icon-192.png" alt="" width="44" height="44" />' +
      '<div><b>Gardez le vol à portée de main</b><span>' +
      (deferred ? "Ajoutez le site à votre écran d'accueil : quiz, table et boîte noire en un geste."
        : "Touchez <svg viewBox=\"0 0 24 24\" aria-label=\"Partager\"><path fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" d=\"M12 3v12M7 8l5-5 5 5M5 12v8h14v-8\"/></svg> puis «&nbsp;Sur l'écran d'accueil&nbsp;».") +
      "</span></div>" +
      (deferred ? '<button type="button" class="install-card__go">Ajouter</button>' : "") +
      '<button type="button" class="install-card__x" aria-label="Fermer">×</button>';
    document.body.appendChild(el);
    requestAnimationFrame(function () { el.classList.add("is-in"); });
    function close(v) { set(v || "non"); el.classList.remove("is-in"); setTimeout(function () { el.remove(); }, 400); }
    el.querySelector(".install-card__x").addEventListener("click", function () { close("non"); });
    var go = el.querySelector(".install-card__go");
    if (go) go.addEventListener("click", function () {
      deferred.prompt();
      deferred.userChoice.then(function (c) { close(c && c.outcome === "accepted" ? "oui" : "non"); });
    });
  }

  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferred = e;
    setTimeout(show, 12000);
  });
  window.addEventListener("appinstalled", function () { set("oui"); });
  if (ios) setTimeout(show, 15000);
  window.McInstall = { show: show };
})();
