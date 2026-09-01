# TekaSafe — étape PostgreSQL

TekaSafe utilise maintenant PostgreSQL : les utilisateurs, annonces, commandes, sessions et messages ne sont plus stockés dans un fichier local lors de l’exécution de l’application.

## Première mise en route (sans programmation)

1. Créez une base PostgreSQL hébergée et récupérez sa **chaîne de connexion**. Gardez-la privée.
2. Dans ce dossier, copiez le fichier `.env.example` et renommez la copie en `.env`.
3. Ouvrez `.env`, collez votre chaîne à droite de `DATABASE_URL=`, puis choisissez une longue valeur privée pour `OTP_SECRET=`.
4. Ouvrez PowerShell dans ce dossier et exécutez :

   ```powershell
   & "C:\Program Files\nodejs\npm.cmd" run db:init --cache ".npm-cache"
   ```

   Cette commande crée les tables PostgreSQL et ajoute les huit annonces de démonstration une seule fois.

5. Lancez l’application :

   ```powershell
   & "C:\Program Files\nodejs\npm.cmd" start --cache ".npm-cache"
   ```

6. Ouvrez `http://127.0.0.1:4173`.

Le code OTP de démonstration est `1234`. Il n’est affiché que car `DEMO_MODE=true` dans `.env`.

## Important pour la sécurité

- Ne partagez jamais le fichier `.env` ni la valeur `DATABASE_URL`.
- Avant la publication, passez `DEMO_MODE=false` et connectez un fournisseur SMS compatible RDC.
- Le paiement Mobile Money reste simulé : il faut un partenaire agréé avant d’encaisser de vrais paiements.

## Fonctions disponibles

- Connexion par OTP de démonstration.
- Catalogue, recherche et catégories, dont les voitures d’occasion.
- Annonces automobiles avec kilométrage, année, carburant, boîte et demande d’essai.
- Création et modification d’annonces depuis l’espace vendeur.
- Panier, commande, suivi de livraison et paiement Mobile Money simulé.
- Messagerie et données persistantes dans PostgreSQL.
- PWA installable lorsque l’application est hébergée en HTTPS.

## À réaliser avant publication publique

- Remplacer le code OTP de démonstration par un fournisseur SMS compatible RDC.
- Connecter un prestataire Mobile Money agréé ; ne jamais gérer les fonds directement sans cadre légal et partenaire autorisé.
- Ajouter la vérification KYC des vendeurs, le contrôle des annonces automobiles et la gestion complète des litiges.
- Configurer des sauvegardes automatiques PostgreSQL, chiffrer les secrets et limiter les droits administrateurs.
- Héberger l’API en HTTPS et publier les versions Android/iOS avec Capacitor ou Expo.

## Déploiement de préproduction sur Render

Le projet comprend maintenant un fichier `render.yaml` pour héberger l’application Node.js sur Render. Cette étape rend l’adresse accessible en ligne, mais elle ne transforme pas encore la démonstration OTP en un service SMS réel.

1. Créez un dépôt **privé** sur GitHub, puis publiez ce dossier sans le fichier `.env`.
2. Créez un compte Render, cliquez sur **New → Blueprint**, puis choisissez ce dépôt GitHub.
3. Dans l’écran Render, renseignez uniquement les valeurs privées demandées : `DATABASE_URL`, `OTP_SECRET` et, si nécessaire, `ADMIN_PHONE_NUMBERS`.
4. Laissez `DEMO_MODE=false`. Dans cet état, personne ne peut se connecter avant le branchement d’un fournisseur SMS : c’est intentionnel et évite d’exposer le code de démonstration sur Internet.
5. Une fois le service créé, ouvrez l’adresse `onrender.com` fournie par Render. Le contrôle technique se fait avec `/api/health`.

Ne copiez jamais le contenu de `.env` dans GitHub, Render Blueprint ou une conversation. Les variables privées doivent être saisies dans l’espace **Environment** de Render.
