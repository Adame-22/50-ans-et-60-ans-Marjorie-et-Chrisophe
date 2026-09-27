/* Boîte noire — dépôt de messages et photos, mur des souvenirs */
(function () {
  "use strict";
  var form = document.getElementById("bn-form");
  var fileInput = document.getElementById("bn-photo");
  var preview = document.getElementById("bn-preview");
  var wall = document.getElementById("bn-wall");
  var errorEl = form.querySelector(".form-error");
  var photoData = "";

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

  fileInput.addEventListener("change", function () {
    var f = fileInput.files[0];
    photoData = ""; preview.hidden = true;
    if (!f) return;
    shrink(f).then(function (d) { photoData = d; preview.src = d; preview.hidden = false; document.getElementById("bn-photo-label").textContent = "📷 Changer de photo"; })
      .catch(function (e) { errorEl.textContent = e.message; errorEl.hidden = false; });
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    errorEl.hidden = true;
    var message = form.message.value.trim();
    if (!message && !photoData) { errorEl.textContent = "Écrivez un message ou ajoutez une photo."; errorEl.hidden = false; return; }
    var btn = form.querySelector("button[type=submit]");
    btn.disabled = true; btn.textContent = "Enregistrement…";
    try { localStorage.setItem("mc-name", form.name.value.trim()); } catch (err) { /* ignoré */ }
    fetch("/api/boite", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: form.name.value, message: message, photo: photoData, website: form.website.value })
    }).then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || "Erreur"); return d; }); })
      .then(function (d) {
        form.message.value = ""; fileInput.value = ""; photoData = ""; preview.hidden = true;
        document.getElementById("bn-photo-label").textContent = "📷 Ajouter une photo";
        if (d.entry) {
          wall.insertAdjacentHTML("afterbegin", item(d.entry));
          if (wall.firstElementChild) wall.firstElementChild.classList.add("fx-land");
        }
        btn.textContent = "Enregistré ✓";
        if (window.McFx) window.McFx.celebrate();
        setTimeout(function () { btn.textContent = "Enregistrer"; }, 2500);
      })
      .catch(function (err) { errorEl.textContent = err.message; errorEl.hidden = false; btn.textContent = "Enregistrer"; })
      .then(function () { btn.disabled = false; });
  });

  function item(e) {
    return '<figure class="wall-item" data-id="' + esc(e.id) + '">' +
      (e.photo ? '<img loading="lazy" src="/api/boite?photo=' + encodeURIComponent(e.id) + '" alt="Photo de ' + esc(e.name) + '" />' : "") +
      (e.message ? "<p>" + esc(e.message) + "</p>" : "") +
      "<small>" + esc(e.name) + "</small></figure>";
  }

  function load() {
    fetch("/api/boite").then(function (r) { return r.json(); }).then(function (d) {
      var known = {};
      wall.querySelectorAll("[data-id]").forEach(function (el) { known[el.getAttribute("data-id")] = true; });
      var fresh = (d.entries || []).filter(function (e) { return !known[e.id]; });
      if (!wall.children.length) wall.innerHTML = (d.entries || []).map(item).join("");
      else if (fresh.length) wall.insertAdjacentHTML("afterbegin", fresh.map(item).join(""));
    }).catch(function () { /* on réessaie plus tard */ })
      .then(function () { setTimeout(load, 15000); });
  }
  load();
})();
