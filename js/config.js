/*
 * ─────────────────────────────────────────────────────────────
 *  CONFIGURATION DE LA FÊTE
 *  Modifiez uniquement ce fichier pour mettre à jour le site.
 * ─────────────────────────────────────────────────────────────
 */
window.EVENT = {
  // Date et heure de début (format AAAA-MM-JJTHH:MM:SS, heure locale)
  date: "2026-11-07T12:30:00",

  // Textes affichés
  dateLabel: "Samedi 7 novembre 2026",
  heure: "12h30",
  lieu: "Salle des fêtes de Champrosay",
  adresse: "1 allée des Alouettes, 91270 Draveil",
  ville: "Draveil",
  porte: "A50", // la « porte d'embarquement » affichée sur le tableau
  dressCode: "Élégant — tenue de cocktail",
  rsvpAvant: "15 octobre 2026",
  hebergement: "Une liste d'hôtels à proximité sera communiquée prochainement.",
  parking: "Parking disponible sur place.",

  // Heures de vol des passeports : avec les dates de naissance (AAAA-MM-JJ),
  // le compteur est exact et avance en direct. Sinon : âge × 8 766 h.
  naissanceMarjorie: "1976-02-20",
  naissanceChristophe: "1966-10-12",

  // Police Sweet Fancy Script (Adobe Fonts) : créez un « projet web » sur
  // fonts.adobe.com avec cette police et collez son identifiant ici (ex. "abc1def").
  // Sans identifiant, la police gratuite Monsieur La Doulaise est utilisée.
  adobeFontsKit: "",

  // Page « Mentions légales & confidentialité » : contact pour les demandes
  // (données, retrait d'une photo…) et, si vous le souhaitez, le nom de l'éditeur.
  // Laissés vides : l'éditeur reste anonyme (autorisé pour un particulier, LCEN)
  // et le contact renvoie vers les organisateurs.
  contactLegal: "",
  editeurLegal: "",

  // Playlist Spotify de la soirée (identifiant visible dans le lien
  // open.spotify.com/playlist/<identifiant>). Affichée sur la page /radio.
  spotifyPlaylist: "4uputorzDEUxb8xpZmzif9",

  // Programme (« Plan de vol »). Les heures servent aussi, le jour J, à
  // afficher l'étape en cours sur le site et sur l'écran géant.
  // Une étape sans heure (ex. « Tard ») suit simplement la précédente.
  programme: [
    { heure: "12h30", titre: "Enregistrement", texte: "Accueil des passagers et remise des cartes d'embarquement." },
    { heure: "13h00", titre: "Embarquement", texte: "Apéritif et champagne au salon première classe." },
    { heure: "14h00", titre: "Service à bord", texte: "Un buffet qui réveillera vos papilles. On y a mis tout notre cœur… Bon appétit !" },
    { heure: "16h30", titre: "Altitude de croisière", texte: "Discours, surprises et gâteau d'anniversaire." },
    { heure: "17h30", titre: "Zone de turbulences", texte: "La piste de danse est ouverte. Ceintures détachées." },
    { heure: "Tard", titre: "Atterrissage", texte: "Dernier verre et retour en douceur." },
  ],
};
