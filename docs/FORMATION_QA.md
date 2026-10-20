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
