/* Boîte noire — dépôt de messages et photos, mur des souvenirs */
(function () {
  "use strict";
  var form = document.getElementById("bn-form");
  var fileInput = document.getElementById("bn-photo");
  var preview = document.getElementById("bn-preview");
  var wall = document.getElementById("bn-wall");
  var errorEl = form.querySelector(".form-error");

  try { form.name.value = localStorage.getItem("mc-name") || ""; } catch (e) { /* ignoré */ }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // Réduit la photo (1600 px max, JPEG 82 %) avant l'envoi
  function shrink(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var max = 1600, w = img.naturalWidth, h = img.naturalHeight;
        var k = Math.min(1, max / Math.max(w, h));
        var c = document.createElement("canvas");
        c.width = Math.round(w * k); c.height = Math.round(h * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("Image illisible (format non pris en charge ?).")); };
      img.src = url;
    });
  }

  // Jusqu'à 10 photos d'un coup : chacune devient une carte de la Boîte noire
  var MAX_PHOTOS = 10, photos = [];
  var label = document.getElementById("bn-photo-label");
  function showPhotos() {
    preview.innerHTML = photos.map(function (d, i) {
      return '<span class="bn-thumb"><img src="' + d + '" alt="Photo ' + (i + 1) + '" /><button type="button" data-rm="' + i + '" aria-label="Retirer la photo ' + (i + 1) + '">×</button></span>';
    }).join("");
    preview.hidden = !photos.length;
    label.textContent = photos.length ? "Ajouter d'autres photos (" + photos.length + ")" : "Ajouter des photos";
  }
  preview.addEventListener("click", function (e) {
    var b = e.target.closest("[data-rm]");
    if (!b) return;
    photos.splice(+b.getAttribute("data-rm"), 1);
    showPhotos();
  });
  fileInput.addEventListener("change", function () {
    var files = Array.prototype.slice.call(fileInput.files || []);
    fileInput.value = "";
    errorEl.hidden = true;
    if (photos.length + files.length > MAX_PHOTOS) {
      errorEl.textContent = MAX_PHOTOS + " photos maximum à la fois : envoyez-en d'abord " + MAX_PHOTOS + ", puis les suivantes.";
      errorEl.hidden = false;
      files = files.slice(0, Math.max(0, MAX_PHOTOS - photos.length));
    }
    label.textContent = "Préparation…";
    files.reduce(function (p, f) {
      return p.then(function () { return shrink(f).then(function (d) { photos.push(d); }); });
    }, Promise.resolve())
      .catch(function (e) { errorEl.textContent = e.message; errorEl.hidden = false; })
      .then(showPhotos);
  });

  function post(body) {
    return fetch("/api/boite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || "Erreur"); return d; }); })
      .then(function (d) {
        if (d.entry) {
          wall.insertAdjacentHTML("afterbegin", item(d.entry));
          if (wall.firstElementChild) wall.firstElementChild.classList.add("fx-land");
        }
      });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    errorEl.hidden = true;
    var message = form.message.value.trim();
    if (!message && !photos.length) { errorEl.textContent = "Écrivez un message ou ajoutez une photo."; errorEl.hidden = false; return; }
    var btn = form.querySelector("button[type=submit]");
    btn.disabled = true; btn.textContent = "Enregistrement…";
    try { localStorage.setItem("mc-name", form.name.value.trim()); } catch (err) { /* ignoré */ }
    var name = form.name.value, website = form.website.value;
    // le message part avec la première photo, les suivantes une par une
    var queue = photos.length ? photos.slice() : [""], total = queue.length, done = 0;
    queue.reduce(function (p, photo, i) {
      return p.then(function () {
        if (total > 1) btn.textContent = "Envoi " + (i + 1) + " / " + total + "…";
        return post({ name: name, message: i ? "" : message, photo: photo, website: website }).then(function () {
          done++;
          if (i === 0) form.message.value = "";
          photos.shift();
        });
      });
    }, Promise.resolve())
      .then(function () {
        btn.textContent = total > 1 ? total + " photos enregistrées ✓" : "Enregistré ✓";
        if (window.McFx) window.McFx.celebrate();
        setTimeout(function () { btn.textContent = "Enregistrer"; }, 2500);
      })
      .catch(function (err) {
        errorEl.textContent = (done ? done + " envoyée" + (done > 1 ? "s" : "") + ", la suite a échoué : " : "") + err.message;
        errorEl.hidden = false;
        btn.textContent = "Enregistrer";
      })
      .then(function () { showPhotos(); btn.disabled = false; });
  });

  function item(e) {
    // photo : polaroïd ; mot seul : carte postale « Par avion »
    if (e.photo) {
      return '<figure class="wall-item wall-item--photo" data-id="' + esc(e.id) + '">' +
        '<img loading="lazy" src="/api/boite?photo=' + encodeURIComponent(e.id) + '" alt="Photo de ' + esc(e.name) + '" />' +
        "<figcaption>" + (e.message ? "<p>" + esc(e.message) + "</p>" : "") + '<small class="sig">' + esc(e.name) + "</small></figcaption></figure>";
    }
    return '<figure class="wall-item wall-item--card" data-id="' + esc(e.id) + '">' +
      '<span class="card__airmail" aria-hidden="true">Par avion<span> · Vol MC 5060</span></span><span class="card__stamp" aria-hidden="true"><b>50·60</b></span>' +
      "<p>" + esc(e.message) + '</p><small class="sig">' + esc(e.name) + "</small></figure>";
  }

  function load() {
    fetch("/api/boite").then(function (r) { return r.json(); }).then(function (d) {
      var known = {};
      wall.querySelectorAll("[data-id]").forEach(function (el) { known[el.getAttribute("data-id")] = true; });
      var fresh = (d.entries || []).filter(function (e) { return !known[e.id]; });
      var title = document.getElementById("bn-title");
      // Boîte scellée jusqu'au jour J : on n'affiche que le compteur, pour garder la surprise
      if (d.sealed) {
        var n = d.count || 0;
        if (title) { title.hidden = false; title.textContent = n + " message" + (n > 1 ? "s" : "") + " à bord"; }
        wall.innerHTML = '<div class="sealed"><span class="sealed__lock" aria-hidden="true">🔒</span><p><b>La boîte noire est scellée.</b></p>' +
          "<p>Les messages et les photos restent secrets jusqu'à l'atterrissage, le 7 novembre : ils seront révélés à Marjorie et Christophe sur l'écran géant.</p></div>";
        return;
      }
      if (title) { title.hidden = !(d.entries || []).length; title.textContent = (d.entries || []).length + " message" + ((d.entries || []).length > 1 ? "s" : "") + " enregistré" + ((d.entries || []).length > 1 ? "s" : ""); }
      if (!wall.children.length) wall.innerHTML = (d.entries || []).map(item).join("");
      else if (fresh.length) wall.insertAdjacentHTML("afterbegin", fresh.map(item).join(""));
    }).catch(function () { /* on réessaie plus tard */ })
      .then(function () { setTimeout(load, 15000); });
  }
  load();
})();
