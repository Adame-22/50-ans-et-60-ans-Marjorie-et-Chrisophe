# Vol MC 5060 — Marjorie & Christophe

Site d'invitation pour les **50 ans de Marjorie** et les **60 ans de Christophe**, sur le thème du voyage en avion, dans l'univers d'une compagnie aérienne haut de gamme.

## Sections

- **Accueil** : noms, âges, trajectoire d'avion animée
- **Tableau des départs** : panneau à palettes animé et compte à rebours
- **Carte d'embarquement** : l'invitation (date, heure, lieu, porte)
- **Passagers** : un passeport pour Marjorie, un pour Christophe
- **Plan de vol** : le programme de la soirée
- **Avant le départ** : lieu, dress code, hébergement, parking
- **Enregistrement** : formulaire de réponse (RSVP)

## Personnaliser

Toutes les informations pratiques se trouvent dans **`js/config.js`** : date, heure, lieu, adresse, dress code, date limite de réponse, etc.

- **Photos** : déposez `marjorie.jpg` et `christophe.jpg` dans `assets/`, puis suivez le commentaire dans `index.html` (section « Passagers »).
- **Programme** : modifiez les horaires directement dans `index.html` (section « Plan de vol »).

## Tour de contrôle (`/admin`)

Espace privé pour suivre la fête :

- **Manifeste** : toutes les réponses en direct, avec compteurs (passagers à bord, repas spéciaux…), recherche, ajout manuel et export Excel.
- **Plan de cabine** : qui est à quelle table, en direct. Personne n'est placé à l'avance : chaque invité s'installe où il veut et le signale en scannant le QR code de sa table. L'équipage peut corriger par glisser-déposer, renommer les tables, en ajouter ou en retirer.
- **Constellation** : les invités en graphe façon Obsidian, regroupés par table, par équipe ou par repas.
- **Équipes** : les équipes des jeux, construites à partir de qui est assis où (voir plus bas).
- **Comptes** (commandants uniquement) : créer des comptes, changer les rôles, générer un nouveau code, supprimer.

Deux rôles existent : **Commandant**, qui a accès à tout, et **Équipage**, qui voit le manifeste et le plan mais ne gère pas les comptes.

Les comptes de Marjorie, Christophe, Lucie et Adame sont créés automatiquement au premier démarrage, avec un code provisoire. À la première connexion, chacun choisit son propre mot de passe.

### Pendant la soirée

| Page | Pour qui | À quoi ça sert |
|---|---|---|
| `/table?t=t1` | Invités | « À table ! » : QR code posé sur chaque table. L'invité tape son nom (ou s'ajoute s'il n'est pas dans la liste) et voit qui est à sa table. S'installer vaut pointage d'arrivée. L'ancienne adresse `/place` y mène aussi. |
| `/boite` | Invités | La « Boîte noire » : laisser un message et/ou une photo |
| `/radio` | Invités | Proposer des chansons et voter ; le DJ suit l'onglet Radio de l'admin |
| `/quiz` | Invités | Quiz en direct façon Kahoot, sur téléphone |
| `/ecran` | TV / vidéoprojecteur | Diaporama (photos, messages, QR codes, qui est à quelle table, étape en cours, radio) qui bascule tout seul sur le quiz |

Dans l'admin :
- **Plan de cabine** : se remplit tout seul quand les invités scannent le QR code de leur table ; les nouveaux arrivants s'allument quelques secondes. Glisser un passager pour corriger.
- **Équipes** : trois façons de former les équipes, puis un interrupteur pour les montrer aux invités et sur l'écran géant, et un autre pour le classement par équipe dans le quiz. Tant que rien n'est publié, les équipes restent secrètes.
  - *Une table = une équipe* : automatique, suit le plan en direct.
  - *Regrouper les tables* : N équipes de taille équivalente, chacun joue avec sa tablée sans bouger.
  - *Mélanger les invités* : N équipes équilibrées qui mélangent les tables, sans jamais séparer une famille (une réponse = un groupe).
  - Glisser une table (ou un invité) d'une équipe à l'autre pour ajuster ; cliquer sur un nom d'équipe pour le changer.
- **Quiz** : préparer les questions, puis piloter en direct (embarquement → question → réponse → classement → podium). Avec le classement par équipe, chaque joueur est rattaché à son équipe grâce à la page « À table ! » (ou en choisissant sa table dans le salon du quiz) ; l'équipe gagne à la moyenne des points, et l'écran affiche le podium des équipes.
- **Boîte noire** : supprimer un message ou une photo, voir la place occupée par les photos et qui en envoie le plus, tout télécharger en ZIP (ou les photos d'un invité), puis « Libérer l'espace » : les photos quittent le serveur, les messages restent. Au-delà de 350 Mo, les invités peuvent encore écrire mais plus envoyer de photos, jusqu'à ce qu'on fasse de la place.
- **Radio** : vue DJ, avec les chansons les plus votées en premier.
- **Manifeste** : bouton ✓ pour pointer les arrivées à l'entrée.

Le jour J, la page d'accueil et l'écran géant affichent l'étape en cours du programme, défini dans `js/config.js` (`programme`).

### QR codes à imprimer

`/qr` (lien « QR codes des tables » dans le Plan de cabine) prépare les impressions : **une carte A6 par table** (4 par feuille A4), qui ouvre directement la bonne table, puis une planche Boîte noire · Radio · Quiz · À table et deux affiches A4. Les cartes suivent la liste des tables du Plan de cabine : si vous ajoutez une table, réimprimez depuis le site en ligne. Une version prête à imprimer se trouve dans `imprimer/qr-codes-vol-mc5060.pdf` (10 tables).

### Check-list du jour J

1. **Avant** : imprimer `imprimer/qr-codes-vol-mc5060.pdf` (A4, sans marges), découper les cartes et en poser une sur chaque table ; afficher l'affiche « À table ! » à l'entrée.
2. **Écran** : ouvrir `/ecran` sur la TV ou le vidéoprojecteur, cliquer sur « Plein écran ».
3. **Accueil** : pointer les arrivées dans le Manifeste (bouton ✓). Un invité qui s'installe à table depuis son téléphone est pointé automatiquement.
4. **Équipes** : une fois tout le monde assis, onglet Équipes → choisir la formule → « Générer » → activer « Montrer les équipes » et, pour le quiz, « Classement par équipe ».
5. **Quiz** : onglet Quiz → Ouvrir l'embarquement → Question → Réponse → Classement… → Podium.

Le quiz tient la charge : l'état du jeu est mis en cache une seconde par Vercel, donc les téléphones ne sollicitent presque pas le serveur, qu'il y ait 70 joueurs ou plus. Il en va de même pour la page « À table ! » : chaque placement est écrit à part, si bien que 70 invités peuvent s'installer au même moment sans s'écraser.

### Animations

Le site s'anime avec retenue : prénoms tracés à la plume, ciel en parallaxe, trajet d'avion dans la barre de navigation, carte d'embarquement inclinable, tampons sur les passeports, avion qui parcourt le plan de vol, confettis aux couleurs du vol. Tout est coupé automatiquement si le téléphone ou l'ordinateur demande moins d'animations (réglage d'accessibilité). Code : `js/motion.js` (page d'accueil) et `js/fx.js` (effets partagés).

### Base de données

Les réponses, les comptes, les tables, les placements et les équipes sont stockés dans **Supabase (Postgres)**, relié au projet depuis l'onglet **Storage** de Vercel. La variable `POSTGRES_URL` est ajoutée automatiquement.

Au premier appel, le site crée lui-même sa table `mc.kv`. Il n'y a aucun script SQL à lancer. La table est dans un schéma non exposé par l'API publique de Supabase et la sécurité par ligne (RLS) y est activée : seul le serveur du site peut la lire.

Redis (Upstash) reste pris en charge en solution de repli (`KV_REST_API_URL` et `KV_REST_API_TOKEN`).

## Sécurité et vie privée

- **Aucune requête vers des services tiers** pour les polices et bibliothèques : elles sont hébergées sur le site (`assets/fonts`, `js/vendor`). Les seules exceptions sont le lecteur Spotify (page Radio) et la police Adobe, si elle est configurée.
- **Site non référencé** par les moteurs de recherche (`X-Robots-Tag`, `robots.txt`).
- **En-têtes de sécurité** définis dans `vercel.json` : nosniff, politique de référent, permissions, `frame-ancestors`.
- **Limites anti-abus par IP** sur toutes les routes publiques. Les seuils sont larges, car toute la salle peut partager le même wifi.
- **Mots de passe chiffrés** (scrypt), sessions signées et invalidées au changement de mot de passe, blocage après plusieurs échecs.
- **Base de données** : table dans un schéma non exposé, avec la sécurité par ligne (RLS) activée.
- **Page `/mentions-legales`** : mentions légales (LCEN), droits réservés, conditions d'utilisation, données personnelles (RGPD), cookies et crédits. Le contact et l'éditeur se règlent dans `js/config.js` (`contactLegal`, `editeurLegal`).
- **Durée de conservation annoncée** : suppression des données du serveur au plus tard le 31 mars 2027.

## Voir le site en local

Ouvrez `index.html` dans un navigateur pour voir la vitrine. Pour tester le formulaire et `/admin`, utilisez `vercel dev` : sans base Redis, un fichier JSON local sert de base de secours.

## Mise en ligne

Le site est déployé sur Vercel à chaque push. Les routes `/api/*` sont des fonctions Vercel, donc GitHub Pages ne suffit plus.
