/* Carte d'embarquement numérique personnelle : /billet?p=<jeton> */
(function () {
  "use strict";
  var CFG = window.EVENT || {};
  var app = document.getElementById("app");
  var token = new URLSearchParams(location.search).get("p") || "";
  var FARE = {
    midi: { cls: "Business", name: "Vol de jour", when: "Le déjeuner" },
    soir: { cls: "Premium", name: "Vol de nuit", when: "La soirée" },
    journee: { cls: "Première", name: "Long-courrier", when: "Midi & soir" },
  };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function qr(text) {
    var q = window.qrcode(0, "M"); q.addData(text); q.make();
    return q.createSvgTag({ cellSize: 3, margin: 0, scalable: true }).replace(/fill="black"|fill="#000000"/g, 'fill="#000033"');
  }
  var dest = encodeURIComponent([CFG.lieu, CFG.adresse].filter(Boolean).join(", "));

  if (!token) { app.innerHTML = '<p class="billet__loading">Lien incomplet. Ouvrez le lien reçu par e-mail ou SMS.</p>'; return; }
  fetch("/api/rsvp?pass=" + encodeURIComponent(token)).then(function (r) {
    return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || "Carte introuvable."); return d; });
  }).then(function (d) {
    try { localStorage.setItem("mc-pass", token); } catch (e) { /* ignoré */ }
    if (d.presence !== "oui") {
      app.innerHTML = '<div class="bp bp--ground"><p class="bp__eyebrow">Vol MC 5060</p><h1>Merci ' + esc(d.prenom) + '</h1><p>Vous nous manquerez à bord. Votre message a bien été transmis à l\'équipage.</p></div>';
      return;
    }
    var html = '<p class="billet__hello">Bonjour ' + esc(d.prenom) + ', voici ' + (d.people.length > 1 ? "vos " + d.people.length + " cartes" : "votre carte") + " d'embarquement.</p>";
    html += d.people.map(function (p, i) {
      var f = FARE[p.creneau] || FARE.journee;
      return '<article class="bp" style="animation-delay:' + (i * 0.12) + 's">' +
        '<div class="bp__head"><span class="bp__airline">M<span>&amp;</span>C Airlines</span><span class="bp__class bp__class--' + p.creneau + '">' + f.cls + "</span></div>" +
        '<div class="bp__route"><div><small>De</small><b>MAR</b></div><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" transform="rotate(90 12 12)" d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg><div class="r"><small>À</small><b>CHR</b></div></div>' +
        '<dl class="bp__grid">' +
        '<div class="wide"><dt>Passager</dt><dd>' + esc(p.nom) + "</dd></div>" +
        "<div><dt>Vol</dt><dd>MC 5060</dd></div>" +
        "<div><dt>Date</dt><dd>" + esc(CFG.dateLabel || "") + "</dd></div>" +
        "<div><dt>Embarquement</dt><dd>" + esc(CFG.heure || "") + "</dd></div>" +
        "<div><dt>Porte</dt><dd>" + esc(CFG.porte || "") + "</dd></div>" +
        '<div><dt>Billet</dt><dd>' + f.name + "</dd></div>" +
        "<div><dt>Présent</dt><dd>" + f.when + "</dd></div>" +
        "</dl>" +
        '<div class="bp__stub"><div class="bp__qr">' + qr(location.origin + "/billet?p=" + token + "#" + (i + 1)) + "</div>" +
        '<div class="bp__stubtxt"><small>Réf.</small><b>' + esc(d.ref) + "-" + (i + 1) + "</b><small>Terminal</small><span>" + esc(CFG.lieu || "") + "</span></div></div>" +
        "</article>";
    }).join("");
    html += '<div class="billet__actions">' +
      '<a class="big-btn" href="/agenda.ics" download="vol-mc5060.ics"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M5 5h14v15H5zM5 10h14M9 3v4M15 3v4"/></svg><span><b>Ajouter à mon agenda</b><small>Rappel la veille</small></span></a>' +
      '<a class="big-btn" href="https://www.google.com/maps/search/?api=1&query=' + dest + '" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5" fill="currentColor"/></svg><span><b>Itinéraire</b><small>Google Maps</small></span></a>' +
      '<a class="big-btn" href="https://waze.com/ul?navigate=yes&q=' + dest + '" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="11" r="7.5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="9.5" cy="10" r="1" fill="currentColor"/><circle cx="14.5" cy="10" r="1" fill="currentColor"/></svg><span><b>Waze</b><small>Guidage en voiture</small></span></a>' +
      '<a class="big-btn" href="/"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg><span><b>Le site de la fête</b><small>Programme et infos</small></span></a>' +
      "</div>" +
      '<a class="big-btn" href="webcal://' + location.host + '/agenda.ics"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M5 5h14v15H5zM5 10h14M9 3v4M15 3v4M9 15l2 2 4-4"/></svg><span><b>S\'abonner au calendrier</b><small>Rappels et nouvelles mis à jour automatiquement</small></span></a>' +
      '<div class="push-slot" id="push-slot" data-push></div>' +
      '<p class="billet__tip">Astuce : faites une capture d\'écran de votre carte, ou ajoutez cette page à l\'écran d\'accueil.</p>';
    app.innerHTML = html;
    if (window.McPush) window.McPush.mount(document.getElementById("push-slot"));
  }).catch(function (e) {
    app.innerHTML = '<p class="billet__loading">' + esc(e.message) + '</p><p class="billet__loading"><a href="/">Retour au site</a></p>';
  });
})();
