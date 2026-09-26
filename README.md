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

### Recevoir les réponses du formulaire

Il y a deux options, à configurer dans `js/config.js` :

1. **Formspree** (recommandé, gratuit) : créez un formulaire sur [formspree.io](https://formspree.io) et collez son URL dans `formspreeEndpoint`. Les réponses arrivent par e-mail.
2. **E-mail** : indiquez une adresse dans `contactEmail`. Le formulaire ouvre alors la messagerie de l'invité avec la réponse déjà rédigée.

## Voir le site en local

Ouvrez simplement `index.html` dans un navigateur. Aucune installation n'est nécessaire.

## Mettre en ligne (GitHub Pages)

Dans le dépôt GitHub : **Settings → Pages → Build and deployment → Deploy from a branch**, choisissez la branche et le dossier `/ (root)`. Le site sera disponible à l'adresse `https://<utilisateur>.github.io/<depot>/`.
