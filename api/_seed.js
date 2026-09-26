/*
 * Comptes créés au premier démarrage de la base (si elle est vide).
 * Chaque compte a un code provisoire, à remplacer à la première connexion.
 * Seules les empreintes (scrypt) figurent ici, jamais les codes.
 */
module.exports = [
  { username: "marjorie", name: "Marjorie", role: "admin", hash: "a7a619de724a5e558f23636ade7d6fab:9e86c40138eb60b0e166293e7407595b48d31d1aa14088349989613b532db2540b6e1bf6482ef5c1ff7b49bdf14faf5d5b42d9ee246d73e6b06926422ae80679" },
  { username: "christophe", name: "Christophe", role: "admin", hash: "ff7f2ed6c2b2cf900346f4a55e771757:4a6267a11fd8d7b8d315b2aa563d8508025b2550b3a090895e9bf16e22b8620647de2f6e768ffd7fcf67ebbc93c0d1cd0efc220865f9e4c9632ff233faca4fc4" },
  { username: "lucie", name: "Lucie", role: "admin", hash: "33bd0d20a8d2fa988a972c8f72e2d184:16e0c6418062e98949ebe84346be37c610d0a1f7de127cc323007b006cceee3ed3444a694c6042b921028136040f15fb6ee18dbbc6edb74c6449cc275c96c697" },
  { username: "adame", name: "Adame", role: "admin", hash: "fbb07599ed900644cc7f5896a4c4d450:a6b970ad4e4f73e766b1915f80fa4e776d8e64596abce47367bfb40619e74ba0cd37e92145f378cd5a4849a16822848c7fbb75e6f0d22d07572be681dcb06437" },
];
