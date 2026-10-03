/* Carte d'embarquement numérique personnelle : /billet?p=<jeton> */
(function () {
  "use strict";
  var VISAS = ["france", "italie", "japon", "grece", "portugal", "maroc", "espagne", "mexique", "canada", "royaume_uni", "islande", "suisse"];
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
    var n = d.people.length;
    var html = '<header class="billet__intro"><p class="billet__kicker">Vol MC 5060 · ' + esc(CFG.dateLabel || "") + '</p><h1>Bonjour ' + esc(d.prenom) + "</h1>" +
      "<p>" + (n > 1 ? "Voici les " + n + " cartes d'embarquement de votre groupe." : "Voici votre carte d'embarquement.") + " Présentez-" + (n > 1 ? "les" : "la") + " à l'accueil, à l'écran ou " + (n > 1 ? "imprimées" : "imprimée") + ".</p></header>";
    html += d.people.map(function (p, i) {
      var f = FARE[p.creneau] || FARE.journee;
      return '<article class="bp bp--' + (p.creneau || "journee") + '" style="animation-delay:' + (i * 0.12) + 's">' +
        '<div class="bp__head"><span class="bp__airline">M<span>&amp;</span>C Airlines</span>' +
        (n > 1 ? '<span class="bp__count">' + (i + 1) + " / " + n + "</span>" : "") +
        '<span class="bp__class">' + f.cls + "</span></div>" +
        '<div class="bp__route"><div><small>Départ</small><b>MAR</b><i class="script">Marjorie</i></div>' +
        '<div class="bp__arc" aria-hidden="true"><svg viewBox="0 0 120 40"><path d="M4 34 Q60 -6 116 34" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="2 5" stroke-linecap="round"/></svg>' +
        '<svg class="bp__plane" viewBox="0 0 24 24"><path fill="currentColor" transform="rotate(90 12 12)" d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg><span>50 · 60</span></div>' +
        '<div class="r"><small>Arrivée</small><b>CHR</b><i class="script">Christophe</i></div></div>' +
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
        '<div class="bp__stubtxt"><small>Référence</small><b>' + esc(d.ref) + "-" + (i + 1) + "</b><small>Terminal</small><span>" + esc(CFG.lieu || "") + "</span></div>" +
        '<span class="tampon bp__tampon tampon--' + VISAS[i % VISAS.length] + '" aria-hidden="true"></span></div>' +
        '<div class="bp__barcode" aria-hidden="true"></div>' +
        "</article>";
    }).join("");
    function act(href, icon, title, sub, extra) {
      return '<a class="bact" href="' + href + '"' + (extra || "") + '><svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + icon + '"/></svg><b>' + title + "</b><small>" + sub + "</small></a>";
    }
    html += '<section class="billet__prep"><h2>Préparer le voyage</h2><div class="billet__actions">' +
      act("/agenda.ics", "M5 5h14v15H5zM5 10h14M9 3v4M15 3v4", "Agenda", "Rappel la veille", ' download="vol-mc5060.ics"') +
      act("webcal://" + location.host + "/agenda.ics", "M5 5h14v15H5zM5 10h14M9 3v4M15 3v4M9 15l2 2 4-4", "S'abonner", "Mises à jour auto") +
      act("https://www.google.com/maps/search/?api=1&query=" + dest, "M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21zM12 7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5", "Itinéraire", "Google Maps", ' target="_blank" rel="noopener"') +
      act("https://waze.com/ul?navigate=yes&q=" + dest, "M12 3.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15M9.5 10v.1M14.5 10v.1M9 13.5c1.6 1.3 4.4 1.3 6 0", "Waze", "En voiture", ' target="_blank" rel="noopener"') +
      "</div></section>" +
      '<div class="push-slot" id="push-slot" data-push></div>' +
      '<p class="billet__tip">Astuce : faites une capture d\'écran de votre carte, ou ajoutez cette page à l\'écran d\'accueil.<br><a href="/">Le site de la fête : programme et infos</a></p>';
    app.innerHTML = html;
    if (window.McPush) window.McPush.mount(document.getElementById("push-slot"));
  }).catch(function (e) {
    app.innerHTML = '<p class="billet__loading">' + esc(e.message) + '</p><p class="billet__loading"><a href="/">Retour au site</a></p>';
  });
})();
