/*
 * « Recevoir les annonces de la fête » : abonnement aux notifications push (gratuit).
 * McPush.mount(element) affiche le bouton là où on le souhaite.
 */
(function () {
  "use strict";
  var supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  var ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  var standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;

  function b64ToBytes(s) {
    var pad = "=".repeat((4 - (s.length % 4)) % 4);
    var raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(raw, function (c) { return c.charCodeAt(0); });
  }
  function reg() { return navigator.serviceWorker.register("/sw.js"); }

  function subscribe() {
    return Notification.requestPermission().then(function (perm) {
      if (perm !== "granted") throw new Error("refus");
      return Promise.all([reg(), fetch("/api/push?view=key").then(function (r) { return r.json(); })]);
    }).then(function (res) {
      return res[0].pushManager.getSubscription().then(function (old) {
        return old || res[0].pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(res[1].publicKey) });
      });
    }).then(function (sub) {
      return fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "subscribe", subscription: sub.toJSON() }) });
    });
  }

  function mount(el) {
    if (!el) return;
    function render(state) {
      var txt = {
        on: ["Annonces activées ✓", "Vous serez prévenu·e des nouvelles du vol."],
        off: ["Recevoir les annonces de la fête", "Une notification sur ce téléphone pour les nouvelles importantes."],
        ios: ["Recevoir les annonces de la fête", "Sur iPhone : ajoutez d'abord le site à l'écran d'accueil (bouton Partager, puis « Sur l'écran d'accueil »), puis ouvrez-le depuis l'icône."],
        denied: ["Annonces bloquées", "Les notifications sont refusées pour ce site : autorisez-les dans les réglages du navigateur."],
        none: ["Annonces indisponibles", "Ce navigateur ne gère pas les notifications. Ajoutez plutôt la fête à votre agenda."],
      }[state];
      el.innerHTML = '<button type="button" class="push-btn' + (state === "on" ? " is-on" : "") + '"' + (state === "off" ? "" : " disabled") + '>' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0"/></svg>' +
        "<span><b>" + txt[0] + "</b><small>" + txt[1] + "</small></span></button>";
      var b = el.querySelector("button");
      if (state === "off") b.addEventListener("click", function () {
        b.disabled = true;
        subscribe().then(function () { render("on"); }).catch(function () { render(Notification.permission === "denied" ? "denied" : "off"); });
      });
    }
    if (ios && !standalone) return render("ios");
    if (!supported) return render("none");
    if (Notification.permission === "denied") return render("denied");
    if (Notification.permission === "granted") {
      reg().then(function (r) { return r.pushManager.getSubscription(); }).then(function (s) {
        if (s) { render("on"); subscribe().catch(function () {}); } else render("off");
      }).catch(function () { render("off"); });
      return;
    }
    render("off");
  }

  window.McPush = { mount: mount, supported: supported };
  document.querySelectorAll("[data-push]").forEach(mount);
})();
