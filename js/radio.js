/* Radio de bord — propositions et votes */
(function () {
  "use strict";
  var form = document.getElementById("r-form");
  var list = document.getElementById("r-list");
  var errorEl = form.querySelector(".form-error");
  var voter, mine;
  try {
    voter = localStorage.getItem("mc-voter");
    if (!voter) { voter = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)); localStorage.setItem("mc-voter", voter); }
    mine = JSON.parse(localStorage.getItem("mc-votes") || "{}");
  } catch (e) { voter = String(Math.random()).slice(2); mine = {}; }
  var songs = [];

  // Playlist Spotify (lecteur intégré + lien vers l'application)
  var playlist = String((window.EVENT || {}).spotifyPlaylist || "").replace(/[^A-Za-z0-9]/g, "");
  if (playlist) {
    var box = document.getElementById("spotify");
    var frame = document.createElement("iframe");
    frame.src = "https://open.spotify.com/embed/playlist/" + playlist + "?utm_source=generator&theme=0";
    frame.title = "Playlist Spotify de la soirée";
    frame.loading = "lazy";
    frame.allow = "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture";
    box.querySelector(".spotify__frame").appendChild(frame);
    document.getElementById("spotify-open").href = "https://open.spotify.com/playlist/" + playlist;
    box.hidden = false;
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function remember(id) { mine[id] = 1; try { localStorage.setItem("mc-votes", JSON.stringify(mine)); } catch (e) { /* ignoré */ } }
  function post(body) {
    return fetch("/api/radio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || "Erreur"); return d; }); });
  }

  function render() {
    list.innerHTML = songs.map(function (s) {
      var voted = !!mine[s.id];
      return '<li class="song' + (s.played ? " is-played" : "") + '">' +
        '<div class="song__txt"><b>' + esc(s.title) + "</b><small>" + esc(s.artist || "Artiste inconnu") + (s.played ? " · déjà diffusée" : "") + "</small></div>" +
        '<button class="vote' + (voted ? " is-voted" : "") + '" data-id="' + esc(s.id) + '"' + (voted || s.played ? " disabled" : "") + ' aria-label="Voter pour ' + esc(s.title) + '">' +
        "▲<span>" + s.votes + "</span><small>" + (voted ? "VOTÉ" : "VOTER") + "</small></button></li>";
    }).join("") || '<li class="live-card center muted">Aucune chanson pour l\'instant : lancez la première !</li>';
  }

  list.addEventListener("click", function (e) {
    var b = e.target.closest(".vote");
    if (!b || b.disabled) return;
    var id = b.getAttribute("data-id");
    remember(id);
    songs.forEach(function (s) { if (s.id === id) s.votes++; });
    render();
    post({ action: "vote", id: id, voter: voter }).catch(function () { /* le prochain rafraîchissement corrigera */ });
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    errorEl.hidden = true;
    var title = document.getElementById("r-title").value.trim();
    if (!title) { errorEl.textContent = "Indiquez le titre de la chanson."; errorEl.hidden = false; return; }
    var btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    post({ action: "add", title: title, artist: document.getElementById("r-artist").value.trim(), voter: voter, website: form.website.value })
      .then(function (d) {
        if (d.song) remember(d.song.id);
        form.reset();
        btn.textContent = d.duplicate ? "Déjà proposée : votre vote est compté ✓" : "Proposée ✓";
        setTimeout(function () { btn.textContent = "Proposer"; }, 2500);
        // Affichage immédiat, sans attendre le cache du serveur
        if (d.song && !songs.some(function (s) { return s.id === d.song.id; })) { d.song.votes = 1; songs.push(d.song); render(); }
      })
      .catch(function (err) { errorEl.textContent = err.message; errorEl.hidden = false; })
      .then(function () { btn.disabled = false; });
  });

  function load() {
    fetch("/api/radio").then(function (r) { return r.json(); }).then(function (d) { songs = d.songs || []; render(); })
      .catch(function () { /* on réessaie */ })
      .then(function () { setTimeout(load, 6000); });
  }
  load();
})();
