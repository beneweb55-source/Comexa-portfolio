# COMEXA — Livraison et recette de la formation

Date : 20 octobre 2026. Voir [l’inventaire audité](FORMATION_INVENTAIRE.md) pour les modules, routes, procédures et conditions de permissions.

## Livraison

- Guide existant enrichi, sans changement du système métier ni du routage : tableau des espaces réellement accessibles, objectif de chaque parcours, chapitres par module, niveaux notions/courant/avancé/sensible, exercices français, résultats attendus, pièges et quiz.
- Accès direct aux chapitres, acquis et restant à faire ; aide permanente dans la coque, reprise, pause, réouverture d’un acquis et recommencement du parcours sélectionné.
- Une formation terminée ne se rouvre pas spontanément. La proposition automatique concerne l’espace courant, pas une succession de fenêtres pour les autres espaces. Fermer un parcours inachevé le met en pause.
- Lecture des espaces autorisés depuis le serveur, permissions effectives propres à chaque espace, puis filtrage des procédures. Rafraîchir le guide rafraîchit aussi le profil et invalide les anciens espaces de navigation si les droits changent.
- Un nouveau droit révèle seulement les chapitres devenus accessibles ; les anciens acquis sont conservés. Un retrait de droit masque les chapitres concernés sans effacer leurs identifiants acquis. Un recommencement retire uniquement les acquis du parcours visible, pas ceux devenus temporairement inaccessibles.
- Progression persistée par utilisateur et espace, IDs de chapitres stables, chapitre courant, version du programme et révision optimiste. Les écritures concurrentes périmées sont refusées avec invitation à recharger. Erreurs d’accès : pas de catalogue de secours permissif. Erreurs de sauvegarde : aucune réussite prétendue.
- Compatibilité conservée avec les anciens champs step/status ; un ancien tutoriel terminé n’est pas considéré comme une preuve d’acquisition des nouveaux exercices et n’est pas imposé à nouveau.
- Correction ciblée d’un écart préexistant entre gardes frontend et politique backend : les permissions de lecture financière donnent accès à Comexa conformément au serveur ; leur gestion reste réservée à cet espace. Cela évite notamment des liens de formation interdits au rôle SALES.

## Résultats réellement exécutés

| Validation | Résultat et portée |
|---|---|
| `npm run test:onboarding` | **48 tests réussis, 0 échec** : 19 formation/permissions, 23 non-régression suppression historique, 6 intégration SQL. La commande compile le backend avant les tests. |
| Formation unitaire | Les 7 rôles du catalogue, multirôle, inscrit sans rôle, intégration exclue, chacune des 123 permissions isolée et catalogue privé successivement de chacune d’elles ; couverture des rubriques visibles, vraies routes et vraies gardes de navigation, filtrage des procédures, progression, anciens acquis, DTO et contrôle serveur. |
| Intégration PostgreSQL embarqué | **6 tests réussis** : exécution des deux vraies migrations de formation avec ancien enregistrement, vrai client Prisma et vrai OnboardingService ; lecture après nouvelle instance du service, séparation comptes/espaces, pause/fin, révision obsolète sans perte, nouveau chapitre, retrait/réattribution des droits, recommencement limité à l’instantané, FK et cascade lors de suppression du compte. |
| Navigateur Chromium / Playwright | **11 scénarios réussis** sur le build frontend final ; vrais composants et navigation, mais API simulée. Les 7 rôles, ordinateur 1440×1000 et mobile 375×812, proposition initiale, pause et absence de popup d’un parcours acquis, dashboard, chapitre, mauvais/bon quiz, enregistrement, rechargement/reprise, relancement, ajout/retrait de droits et nouvel espace sans perte, refus/erreur de sauvegarde et accès indisponible. |
| Responsive | Capture mobile de la formation inspectée : en-tête/pied, défilement des modules et commandes visibles sans débordement horizontal. |
| Backend | Compilation Nest réussie. |
| Frontend | Build de production Next réussi, 65 routes générées. Dernier build utilisé pour les 11 scénarios. |
| ESLint ciblé | 0 erreur sur les composants et bibliothèques modifiés ainsi que les tests frontend. Le fichier backend de test est exclu par la configuration ESLint racine (avertissement signalé, pas prétendu linté). |
| Prisma | Schéma validé avec `PRISMA_SCHEMA_ENGINE_BINARY=/bin/true npx prisma validate` dans backend ; trois avertissements SetNull préexistants, hors formation. Le contournement du téléchargement TLS ne constitue pas un déploiement de migration. |
| Diff | `git diff --check` sans erreur. |

### Reproduction

```sh
# Après installation des dépendances racine et backend et génération Prisma habituelle
npm run test:onboarding
npm run build
npm run start -- --hostname 0.0.0.0 --port 3000
# Dans un autre terminal, avec un Chromium Playwright installé :
COMEXA_TEST_URL=http://127.0.0.1:3000 npm run test:onboarding:browser
```

Dans cette sandbox, Chromium portable était utilisé avec :

```sh
LD_LIBRARY_PATH=/tmp/al2023/lib CHROMIUM_EXECUTABLE=/tmp/chromium \
  node tests/onboarding.browser.mjs
```

Ces chemins temporaires ne sont pas des dépendances du produit. Les captures sont écrites dans `.cache/training-qa`, ignoré par Git. L’URL localhost sert uniquement au pilote de test lancé dans la sandbox ; le frontend ne l’utilise pas pour joindre une API depuis le navigateur utilisateur.

## Limites de la recette — ne pas assimiler à une validation de production

- Le test SQL utilise **PostgreSQL WASM/PGlite**, pas un serveur PostgreSQL déployé. La table users minimale sert à valider la FK des deux migrations de formation ; l’ensemble du schéma et des anciennes migrations métier n’est pas rejoué. Pas de test de restauration, de déploiement Prisma Migrate ni de redémarrage réel du serveur de base.
- Les tests navigateur simulent l’API et sa progression. Ils ne constituent pas un parcours bout en bout Chromium → Nest → PostgreSQL. La persistance réelle est vérifiée séparément par l’intégration Prisma/PGlite.
- Les exercices sont pédagogiques : aucun devis, paiement, suppression, publication ou jeton de production n’a été créé pour valider une leçon. Les API métier et leurs autorisations restent inchangées et doivent être recettées avec des données de test sur l’environnement cible.
- Le quiz enregistre une auto-évaluation, **pas une certification inviolable**. Le serveur protège l’identité, l’espace, les formats/limites et la révision ; le catalogue de chapitres et leurs conditions détaillées sont construits côté frontend. La progression n’accorde aucun droit métier.
- Les erreurs de droits sont testées ; l’ajout/retrait réel des rôles dans une infrastructure d’identité déployée n’est pas réalisé. Le rafraîchissement constate les droits renvoyés par l’API ; il ne modifie pas les rôles.
- Services externes non testés : emails, stockage de fichiers, Telegram, webhook n8n/Console et paiements externes. Les limites ou UI absentes sont explicitement signalées dans le programme et l’inventaire.
- Aucun audit d’accessibilité complet ni essai sur tous les navigateurs/appareils ; focus des chapitres et format mobile vérifiés. Certaines vérifications utilisent un environnement Chromium Linux.
- L’installation backend signale quatre vulnérabilités npm de sévérité élevée. Aucun `audit fix` aveugle ni montée de dépendances métier n’a été appliqué dans cette livraison.

## Mise en service requise

1. Sauvegarder et tester les migrations sur une copie de la base cible.
2. Appliquer avec la procédure Prisma habituelle les migrations `20261020195000_onboarding`, puis `20261020210000_onboarding_chapters` (si la première n’est pas déjà présente), et générer le client Prisma. **Aucune migration de production n’a été appliquée ici.**
3. Déployer le backend et le frontend ensemble ; vérifier les endpoints `/auth/onboarding/access`, `/auth/onboarding` et le rafraîchissement `/auth/me` avec des comptes de test.
4. Recetter au moins ADMIN, SALES, DEVELOPER et CLIENT, un compte multiespace personnalisé et un changement réel d’attributions ; vérifier reprise après déconnexion/reconnexion et deux onglets concurrents.
5. Conserver les acquis existants, ne pas réinitialiser la table de progression lors d’une mise à jour de contenu. Donner une nouvelle clé uniquement à un véritable nouveau chapitre ; corriger une formulation sans changer arbitrairement son identifiant.

Le rapport [suppression et accueil initial](SUPPRESSION_ET_ACCUEIL_QA.md) documente les changements historiques déjà présents ; les résultats et réserves ci-dessus concernent l’extension complète de formation.

---

## Passe de correction du 21 octobre 2026 — parcours guidé

### Symptômes observés en production (captures du 21/10)

| Symptôme | Cause réelle | Correction |
|---|---|---|
| `Uncaught TypeError: Cannot read properties of undefined (reading 'startsWith')` au clic sur le coach | Le catalogue sert `navigateTo`, l'interface lisait `step.page` → `router.push(undefined)` | `src/lib/training/mission-steps.mjs` (`stepPage`), lecture de `page` **ou** `navigateTo`, repli sur le module de la mission |
| « ÉTAPE NaN SUR 5 » | Instantané de reprise non borné + index d'étape non validé | `toStepIndex` borne tout instantané (null, chaîne, NaN, hors limites) |
| Panneau « Cet élément n'est pas visible sur cette page » sur l'écran de parcours | L'étape 1 n'avançait jamais (chemin `undefined`) et la cible personnelle n'existait que dans l'espace équipe | Navigation d'entrée de mission + ancrages `data-coach-id` ajoutés sur `TaskComposer` et la liste personnelle |
| `« »` (libellé de page vide) dans l'infobulle | `step.page` rendu vide | `pageLabel()` nomme l'écran réel, sinon dérive un libellé lisible |
| Rafale de `401 (Unauthorized)` sur `/api/notifications`, `/api/me/tasks`, `/api/notifications/summary` | Après l'échec de connexion, les écrans montés continuaient d'appeler l'API sans jeton | `apiFetch` répond localement `401 SESSION_ABSENTE` hors routes publiques ; `refresh` observe un délai de grâce de 10 s après échec (plus de POST `/auth/refresh` en boucle) |
| `POST /api/auth/login 502 (Bad Gateway)` | Le proxy Vercel n'a pas joint l'API (backend Render endormi / redéploiement) — pas un défaut du code applicatif | Message explicite « passerelle 502/503/504 » + **un** rejeu automatique après 1,2 s pour `GET` et pour `login`/`refresh` uniquement |
| Mission « Suivre mon temps de travail » impossible à valider | Critère `createdAt: { gte: "{{now}}" }` comparé à l'instant de vérification → faux par construction | Substitution `{{since}}` (début de tentative) + test qui interdit `{{now}}` sur un critère temporel |
| Progression feinte (clic n'importe où dans un tableau) | Étapes `action` ciblant un conteneur (`taches-board`, `client-devis-list`) | Cibles précises ou étapes `verify` ; test qui interdit les cibles-conteneurs |
| Mission validée mais carte toujours « À commencer » | Catalogue jamais relu après validation/abandon | `refreshCatalog()` après `validate()` et `quit()` |

### Améliorations livrées avec les correctifs

- Parcours regroupé **par niveau** avec avancement par niveau, compteur d'évaluations finales validées, badges « Évaluation validée / à passer / à repasser ».
- « Voir le déroulé » affiche la **frise des étapes du coach** avec leur nature (se rendre / agir / prouvé par les données / geste guidé).
- Reprise réelle : « Reprendre avec le coach » (instantané `sessionStorage`), bannière « MODE FORMATION » rappelant la mission et l'étape, bouton Reprendre si la mission est en pause.
- Bilan ouvert automatiquement au retour d'une mission (`?bilan=1`) ; carte de validation détaillant chaque critère (satisfait / manquant).
- Infobulle du coach compacte (« Pourquoi cette étape ? » et « Un doute ? L'aide » dépliables), raccourcis clavier ← → / Échap, état « Vérification… » réel (plus de bouton qui paraît bloqué).
- Sortie du mode formation → la session de coach se ferme (plus de scénario guidé sur des données réelles).

### Résultats exécutés dans cette passe

| Commande | Résultat |
|---|---|
| `npm run test:training` (`missions.spec.ts` + `mission-verification.spec.ts`) | **17/17** ✅ |
| `npm run test:training-ui` (`tests/training-steps.test.mjs`) | **13/13** ✅ |
| `node --test tests/contract.test.mjs` | **5/5** ✅ |
| `npx eslint` sur les fichiers modifiés (frontend) | 0 erreur ✅ |
| `npx next build` | build de production réussi (toutes les routes, dont les 4 pages `/formation`) ✅ |
| `npx tsc --ignoreConfig` sur `missions.ts` + `mission-verification.ts` (strict) | 0 erreur ✅ |

### Limites de cette passe

- **Pas de base PostgreSQL dans la sandbox** : les parcours n'ont pas été rejoués de bout en bout (création réelle, minuteur, validation). Les critères sont couverts en unitaire, la vérification réelle reste à recetter sur un environnement avec `TRAINING_DATABASE_URL`.
- La génération du client Prisma (`prisma generate`) exige le téléchargement des moteurs, indisponible ici : le typecheck complet du backend et `prisma-routing.spec.ts` n'ont donc pas été exécutés (échec d'import du client généré, sans rapport avec ces changements). Les modules de catalogue et de critères (sans dépendance Prisma) sont, eux, vérifiés en `strict`.
- Le `502` de connexion relève de l'hébergement (API endormie) : le code affiche désormais un message juste et rejoue une fois, mais ne peut pas garantir le réveil du backend.
