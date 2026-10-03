/* Service worker : affiche les annonces de la fête (notifications push) */
self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener("push", function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "Vol MC 5060", {
    body: d.body || "", icon: "/assets/icon-192.png", badge: "/assets/icon-192.png",
    data: { url: d.url || "/" }, tag: "vol-mc5060", renotify: true, lang: "fr",
  }));
});
self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) if ("focus" in list[i]) { list[i].navigate(url); return list[i].focus(); }
    return self.clients.openWindow(url);
  }));
});
