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
- **Plan de cabine** : glisser-déposer des invités confirmés dans les rangs (tables), avec enregistrement automatique.
- **Comptes** (commandants uniquement) : créer des comptes, changer les rôles, générer un nouveau code, supprimer.

Deux rôles existent : **Commandant**, qui a accès à tout, et **Équipage**, qui voit le manifeste et le plan mais ne gère pas les comptes.

Les comptes de Marjorie, Christophe, Lucie et Adame sont créés automatiquement au premier démarrage, avec un code provisoire. À la première connexion, chacun choisit son propre mot de passe.

### Base de données

Les réponses, les comptes et le plan de cabine sont stockés dans **Supabase (Postgres)**, relié au projet depuis l'onglet **Storage** de Vercel. La variable `POSTGRES_URL` est ajoutée automatiquement.

Au premier appel, le site crée lui-même sa table `mc.kv`. Il n'y a aucun script SQL à lancer. La table est dans un schéma non exposé par l'API publique de Supabase et la sécurité par ligne (RLS) y est activée : seul le serveur du site peut la lire.

Redis (Upstash) reste pris en charge en solution de repli (`KV_REST_API_URL` et `KV_REST_API_TOKEN`).

## Voir le site en local

Ouvrez `index.html` dans un navigateur pour voir la vitrine. Pour tester le formulaire et `/admin`, utilisez `vercel dev` : sans base Redis, un fichier JSON local sert de base de secours.

## Mise en ligne

Le site est déployé sur Vercel à chaque push. Les routes `/api/*` sont des fonctions Vercel, donc GitHub Pages ne suffit plus.
