# Suppression des documents et accueil COMEXA

## Analyse et décisions

L’application est composée d’un frontend Next.js et d’une API NestJS/Prisma/PostgreSQL. La navigation est filtrée par les permissions effectives de chaque espace. Le catalogue comporte ADMIN, COMMUNICATION_MANAGER, PROJECT_MANAGER, DEVELOPER, SOCIAL_MEDIA_MANAGER, SALES et CLIENT.

Les trois ressources possédaient déjà une route DELETE protégée. Les devis et factures refusaient cependant les statuts autres que brouillon. La convention métier existante est une **suppression logique persistée en base** (`deletedAt`), pas une suppression physique des lignes. Elle est conservée : les relations, les paiements et les traces d’audit ne doivent pas disparaître avec une pièce commerciale. Il ne s’agit pas d’un masquage local dans React.

Les requêtes existantes des listes et indicateurs de devis/factures filtrent les pièces supprimées. Les encaissements réellement réalisés restent des encaissements : supprimer une facture ne rembourse pas un client, n’annule pas un paiement ni une répartition. Cette distinction est rappelée dans la confirmation. Aucun statut financier n’est réécrit artificiellement.

## Fonctionnalités

### Suppression

- Suppression des devis et factures dans tous leurs statuts, sous réserve des permissions `quote:delete:any` et `invoice:delete:any`.
- Actions dans les listes (cartes et tableau des factures) et dans les fiches.
- Suppression des documents depuis la liste de documents d’un projet, avec `document:delete:any` et les contrôles de lecture/périmètre existants.
- Possibilité de supprimer un document expiré sans ouvrir son téléchargement aux utilisateurs non autorisés.
- Confirmation accessible via le composant Dialog existant ; envoi bloqué pendant la requête ; message d’erreur ; notification de succès qui survit au retrait de la ligne.
- Écriture conditionnelle transactionnelle : une seconde suppression concurrente ne crée pas une deuxième activité de suppression.
- Conservation des relations et des traces commerciales. Le mécanisme de nettoyage du fichier stocké pour les documents est conservé ; les erreurs de stockage restent journalisées par le mécanisme existant.
- Rafraîchissement des listes et agrégats montés après une mutation commerciale confirmée par le serveur.

### Tutoriel

- Disponible dans les quatre espaces : personnel, équipe, Comexa et client.
- Ouverture automatique sur le dashboard pour une progression active ou inexistante.
- Étapes construites exclusivement à partir des groupes de navigation effectivement autorisés par les layouts.
- Explications, exemples, précautions et consignes d’utilisation ; consignes d’écriture supplémentaires conditionnées par les permissions.
- Précédent, suivant, passer une étape, terminer, reprendre plus tard, ouvrir une rubrique pour essayer.
- Bouton permanent « Aide · Guide COMEXA » pour reprendre ou relancer.
- Progression persistée par utilisateur et espace, via `GET/PATCH /auth/onboarding` et la table `onboarding_progress`.
- Identité issue exclusivement de la session ; validation des espaces, statuts et indices ; aucun identifiant de compte accepté dans le DTO.
- Réutilisation de Dialog (portail, focus, Échap, défilement interne), boutons à retour à la ligne pour les petits écrans.
- Aucun compte ou document de démonstration créé.

## Fichiers modifiés ou ajoutés

### API et base

- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20261020195000_onboarding/migration.sql`
- `backend/src/modules/auth/auth.controller.ts`
- `backend/src/modules/auth/dto/onboarding.dto.ts`
- `backend/src/modules/documents/documents.service.ts`
- `backend/src/modules/invoices/invoices.service.ts`
- `backend/src/modules/quotes/quotes.service.ts`
- `backend/src/modules/quotes/quote-state.ts`

### Interface

- `src/components/workspace/DeleteDocumentButton.jsx`
- `src/components/softui/Onboarding.jsx`
- `src/components/softui/Shell.jsx`
- `src/lib/onboarding.mjs`
- `src/lib/use-listing.js`
- `src/lib/use-all-listing.js`
- `src/app/(session)/espace-equipe/devis/page.jsx`
- `src/app/(session)/espace-equipe/devis/[id]/page.jsx`
- `src/app/(session)/espace-equipe/factures/page.jsx`
- `src/app/(session)/espace-equipe/factures/[id]/page.jsx`
- `src/app/(session)/espace-equipe/projets/[id]/page.jsx`

### Tests et compte rendu

- `backend/tests/document-deletion.test.mjs`
- `tests/onboarding.test.mjs`
- `docs/SUPPRESSION_ET_ACCUEIL_QA.md`

## Vérifications effectivement exécutées

- Installation des dépendances frontend et backend avec `npm ci --ignore-scripts`.
- Génération du client Prisma réussie. Le téléchargement du moteur étant bloqué par le réseau, la génération a été exécutée avec `PRISMA_SCHEMA_ENGINE_BINARY=/bin/true` ; la génération du client utilise le générateur disponible dans les dépendances.
- `prisma validate` réussi avec le même réglage. Trois avertissements sur des relations SetNull/champs obligatoires préexistants ; ces relations ne sont pas modifiées ici.
- `npm run build` frontend réussi : 65 pages générées.
- `npm run build --prefix backend` réussi.
- ESLint ciblé sur tous les fichiers frontend et backend modifiés : réussi.
- `git diff --check` réussi.
- `node --test backend/tests/document-deletion.test.mjs tests/onboarding.test.mjs` : **47 tests réussis**.

Les tests appellent les services/contrôleurs compilés avec doubles Prisma/stockage : 14 statuts commerciaux, droits refusés, documents absents, suppression concurrente, suppression d’un fichier après écriture, document expiré, métadonnées de permissions des routes DELETE, 7 rôles × 3 espaces pour le contenu autorisé, guide client, validation du DTO, isolation des progressions entre comptes, pause/reprise/fin/relancement.

**Limites :** ces tests ne sont pas des tests d’intégration sur PostgreSQL. Aucune base configurée ni navigateur de test n’étaient disponibles dans cet environnement. La migration n’a pas été appliquée, les clés étrangères réelles et les calculs des tableaux de bord après suppression n’ont pas été validés de bout en bout. L’affichage mobile/ordinateur et les interactions clavier ont été examinés au niveau du code et des composants existants, mais pas vérifiés dans un navigateur. Ne pas considérer ces validations visuelles comme acquises.

## Déploiement

Avant de lancer la nouvelle API sur une base configurée :

```sh
cd backend
npm run prisma:generate
npm run prisma:deploy
npm run build
```

Puis construire/déployer le frontend. Tant que la migration n’est pas appliquée, le guide signale les erreurs d’enregistrement au lieu de prétendre que la progression est enregistrée.

## Recette restante avant production

1. Appliquer la migration dans une base de test et vérifier son installation sur une base existante.
2. Avec les rôles réels, supprimer un devis accepté lié à une facture/projet et une facture partiellement payée ou payée ; vérifier les références, les filtres et les totaux.
3. Vérifier que les encaissements et répartitions historiques restent inchangés, puis tester leur consultation et les opérations financières encore autorisées.
4. Tester un appel DELETE direct sans permission et depuis un espace incorrect.
5. Vérifier le nettoyage du stockage, y compris le comportement journalisé lors d’une panne du fournisseur de fichiers.
6. Ouvrir un nouveau compte sur chaque espace autorisé ; passer une étape, explorer, reprendre, se reconnecter sur un autre appareil et relancer depuis l’aide.
7. Vérifier au clavier et à 375 px/1440 px : focus, Échap, confirmations, messages de succès et défilement des longues étapes.
