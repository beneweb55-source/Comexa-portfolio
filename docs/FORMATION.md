# FORMATION — parcours guidé et environnement d'entraînement COMEXA

> **Constat préalable (audit du code).** COMEXA ne comportait **aucun** système de
> formation, tutoriel ou coach avant cette évolution : ni composant, ni page, ni
> API. Tout ce qui suit a donc été construit à partir des composants, formulaires,
> validations et permissions **réellement présents** dans le code — jamais à partir
> d'une supposition sur une « formation existante ».

Ce document décrit l'architecture, la configuration, le catalogue de missions et
les points restant à valider en environnement réel.

---

## 1. Les trois pièces du système

| Pièce | Rôle | Où |
| --- | --- | --- |
| **Environnement isolé** | Bac à sable de données fictives, séparé de la production au niveau **serveur/base**, réinitialisable | `backend/src/modules/training/`, `backend/src/prisma/prisma.service.ts` |
| **Coach interactif** | Surbrillance des vrais composants, étapes numérotées, vérification automatique, pause/reprise/abandon | `src/lib/training/`, `src/components/training/` |
| **Missions & évaluation** | Parcours par rôle fondés sur les permissions réelles ; réussite vérifiée sur l'état des données, jamais sur un clic | `backend/src/modules/training/missions.ts`, `mission-verification.ts` |

---

## 2. Isolation production / formation

L'isolation **n'est pas** une bannière ni un drapeau navigateur : elle est
appliquée par le serveur, à chaque requête.

1. **Base de données distincte** : `TRAINING_DATABASE_URL` pointe vers une base
   d'entraînement. `PrismaService` route chaque modèle vers le bon client
   (`useTrainingClient(model, isTrainingScope)`), selon la portée ALS
   (`training-scope.ts`) posée par le middleware. Sans `TRAINING_DATABASE_URL`,
   la **production fonctionne normalement** ; seule la formation est
   indisponible (message explicite à l'entrée en formation).
2. **Fail-loud, jamais fail-open** : si la portée de formation est active mais que
   le client d'entraînement n'est pas constructible (variable absente), la
   requête **échoue explicitement**. Un repli silencieux vers la production est
   impossible — c'est vérifié par `prisma-routing.spec.ts`.
3. **Modèles toujours en production** : `refreshToken`, `emailVerificationToken`,
   `passwordResetToken`, `integrationToken`, `trainingSession`,
   `trainingMissionProgress`, `trainingAttempt`. Les identités (`User`, `Role`,
   `Permission`) sont **miroitées** dans l'exercice ; le principal d'authentification
   est toujours lu en production.
4. **Effets externes neutralisés** en portée de formation : e-mails (journalisés,
   non envoyés), notifications temps réel (non émises), documents stockés sous la
   clé `training/`.
5. **Bannière permanente** « MODE FORMATION — DONNÉES FICTIVES » dans la coque
   (`TrainingBanner`), avec sortie et réinitialisation explicites.
6. **Réinitialisation** : `POST /training/reset` vide et réamorce UNIQUEMENT la
   base d'entraînement. La progression pédagogique (base de production) est
   conservée.

### Configuration

```dotenv
# .env du backend
TRAINING_DATABASE_URL=postgresql://…/comexa_training   # base d'entraînement
# MÊME JWT_SECRET que la production : le jeton « formation » (typ: training) doit
# être vérifié par le même serveur.
```

Sans `TRAINING_DATABASE_URL`, `GET /training/status` répond `configured: false` et
l'entrée en formation est refusée avec un message explicite.

### Limites connues (à documenter, pas à masquer)

- **Bac à sable partagé** : tous les membres en formation partagent la même base
  d'entraînement. Un apprenant peut donc rencontrer les données créées par un
  autre. La réinitialisation est ouverte à tout membre authentifié pour cette
  raison. Une base par utilisateur serait une évolution de configuration.
- Les **tests de bout en bout avec base de données** n'ont pas pu être exécutés ici
  (pas de Postgres dans l'environnement de build) : voir §7.

---

## 3. Le coach interactif

- **Ciblage par composant réel** : chaque étape porte un `data-coach-id` posé sur
  le vrai composant (bouton, formulaire, liste) — jamais une position
  approximative, jamais un sélecteur CSS fragile. La liste des ancrages est
  validée par test (`missions.spec.ts`).
- **Surbrillance + infobulle** : titre, consigne, **pourquoi** cette action compte,
  ce qui est attendu, indice dépliable, compteur d'étapes, précédent / suivant,
  pause, quitter.
- **Avancement conditionné** :
  - `action` — n'avance que si l'apprenant clique réellement la cible ;
  - `navigate` — n'avance qu'à l'arrivée sur la page attendue ;
  - `verify` — interroge `GET /training/missions/:id/check` et n'avance **que si
    le critère est satisfait sur les données d'exercice** ;
  - `manual` — l'étape décrit un geste hors bouton (ex. arrêter le minuteur).
- **Mode évaluation** (`assistance: "none"`) : coach réduit (bandeau + validation),
  aucune indice, critères d'évaluation.
- **Reprise** : la session est mémorisée (`sessionStorage`) — recharger la page
  reprend à la même étape.
- **Échecs enregistrés** : chaque validation non satisfaite crée une
  `TrainingAttempt` avec les critères manquants (`errors`), pour le bilan.

---

## 4. Catalogue de missions <a id="missions"></a>

Structure par espace accessible, sur **5 niveaux** :

| Niveau | Sens | Forme |
| --- | --- | --- |
| 1 | Découvrir l'espace | missions guidées |
| 2 | Opérations courantes | missions guidées |
| 3 | Scénario complet (enchaînement) | missions guidées |
| 4 | Détecter et corriger les erreurs | missions guidées + erreurs fréquentes |
| 5 | Mission finale | **évaluation de chaque mission**, sans assistance, critères vérifiés serveur |

Chaque mission fournit : objectif, situation de départ, actions, vérifications
avant d'agir, erreurs fréquentes + conséquences, conditions de « fait », quand
escalader, critères de réussite vérifiables, critères d'évaluation, checklist
méthode, points **à faire confirmer** (jamais inventés), lien vers le module réel.

Le catalogue est **filtré par les permissions effectives** du membre
(`filterMissionsFor`) : deux profils différents ne reçoivent pas les mêmes
missions, même sur le même espace.

### Missions espace équipe <a id="missions-espace-equipe"></a>

| id | Niveau | Titre | Module |
| --- | --- | --- | --- |
| `team-prospects-convertir` | 1 | Qualifier un prospect et le transformer en client | Prospects |
| `team-devis-emettre` | 2 | Émettre un devis et l'envoyer au client | Devis |
| `team-projet-piloter` | 3 | Piloter un projet ouvert : jalon et tâche d'équipe | Projets |
| `team-erreurs-corriger` | 4 | Détecter et corriger une erreur de devis | Devis |

### Missions espace personnel <a id="missions-espace-personnel"></a>

| id | Niveau | Titre | Module |
| --- | --- | --- | --- |
| `personal-tache-assignee` | 1 | Prendre en main mes tâches | Mes tâches |
| `personal-journee` | 2 | Suivre mon temps de travail | Mon temps |

### Missions Comexa Space <a id="missions-comexa-space"></a>

| id | Niveau | Titre | Module |
| --- | --- | --- | --- |
| `comexa-contenu-publier` | 2 | Mettre à jour une offre publiée | Contenu |
| `comexa-membre-inviter` | 3 | Créer un compte membre avec le bon rôle | Membres |

### Missions espace client <a id="missions-espace-client"></a>

| id | Niveau | Titre | Module |
| --- | --- | --- | --- |
| `client-devis-accepter` | 2 | Examiner un devis et prendre une décision | Mes devis |
| `client-modification-demander` | 3 | Demander une modification sur mon projet | Demandes de modification |

**Noms d'objets créés par l'apprenant** (exclusifs aux missions, hors fixtures) :
« Atelier Ziryab », « Clinique El Wafa », « Refonte catalogue », « Contrat de
maintenance », « Recette client », « Livraison », « Intégrer la maquette »,
« Préparer la recette client », « Relire les échanges du client », « Envoyer le
compte-rendu au client », « Ajouter une page tarifs », « Ajouter un formulaire de
contact », `dev.formation@formation.example`, `analyste.formation@formation.example`.

**Données d'exercice déjà présentes** (`training-fixtures.ts`) : clients
« Coopérative Numérique » (projet « Refonte site vitrine », jalon « Cadrage »,
facture réglée), « Cabinet Falconi » (brouillon de devis **volontairement erroné**
— ligne « Maintenance et évolution » pour une demande de création — matière de la
mission d'erreurs), « Dar El Mahatta » (projet « Portail client ») ; prospects
« Maison Yacine », « Studio Falco » ; 6 services dont « Création de site web » et
« Maintenance et évolution » ; devis « Site vitrine » et « Évolution catalogue »
pour l'espace client ; tâche « Préparer la maquette ».

---

## 5. Méthode de travail (contenu pédagogique)

Les missions enseignent explicitement : les **vérifications avant d'agir**, l'ordre
des opérations, les **erreurs fréquentes et leurs conséquences**, les **conditions
de « fait »**, et **quand escalader**. Aucune procédure, hiérarchie, délai ou règle
d'approbation n'est inventée : tout point non déductible du code est listé sous
`toConfirm` (« à faire confirmer par votre responsable/direction »), côté mission
ET côté bilan.

Exemples de points volontairement laissés « à confirmer » : délais de relance
commerciale, seuils de remise, validation d'une date contractuelle, procédure
lorsqu'un devis erroné est déjà parti, politique de correction du temps,
validation éditoriale, délais de réponse aux demandes client.

---

## 6. Évaluation, bilan et bascule vers la production

- **Évaluation** : chaque mission se rejoue en `assistance: "none"`. La réussite est
  validée par le serveur sur les critères d'évaluation (noms de données distincts
  de l'assistance guidée : la démonstration doit être refaite). Score 100/0,
  `evaluationPassed`, détails stockés sur `TrainingMissionProgress`.
- **Progression** : `TrainingMissionProgress` / `TrainingAttempt` (base de
  production — ce sont des données pédagogiques RÉELLES, conservées à la
  réinitialisation de l'exercice).
- **Bilan** (`GET /training/report`) : ce qui est démontré, ce qui reste à
  maîtriser, checklist opérationnelle, points à faire confirmer, **raccourcis vers
  les modules réels**.
- **Bascule explicite** : aucun transfert automatique. Les raccourcis ouvrent les
  modules de production avec les permissions habituelles ; l'apprenant quitte le
  mode formation pour travailler sur des données réelles.

---

## 7. Tests — ce qui est exécuté, ce qui ne l'est pas, ce qui reste à valider

### Exécutés et verts

Les suites de formation vivent dans `backend/tests/` et `tests/` (convention du
dépôt : hors `src/`, comme les suites onboarding déjà présentes).

| Suite | Commande | Résultat |
| --- | --- | --- |
| `backend/tests/training-scope.spec.ts` (portée ALS, modèles toujours-prod) | `cd backend && node --import tsx --test tests/training-scope.spec.ts` | ✅ |
| `backend/tests/prisma-routing.spec.ts` (routage fail-loud, pas de repli production) | idem avec `tests/prisma-routing.spec.ts` | ✅ |
| `backend/tests/mission-verification.spec.ts` (critères, `{{userId}}`/`{{now}}`) | idem | ✅ |
| `backend/tests/missions.spec.ts` (permissions réelles, ancrages, filtre par profil) | idem | ✅ |
| **Total formation** | `cd backend && node --import tsx --test tests/training-scope.spec.ts tests/mission-verification.spec.ts tests/missions.spec.ts tests/prisma-routing.spec.ts` | ✅ **25/25** |
| `tests/contract.test.mjs` (poignée de contrat API, feature `training`) | `node --test tests/contract.test.mjs` | ✅ 5/5 |
| Suites onboarding existantes (non régressées) | `npm run test:onboarding` | ✅ |
| Frontend `npm run lint` | | ✅ |
| Frontend `npm run build` (4 pages `/formation`) | | ✅ |

### Non exécutables ici

- **Tests de bout en bout avec base de données** (entraînement + production) :
  aucun Postgres disponible dans l'environnement de build. La logique de routage,
  de critères et de catalogues est couverte en unitaire ; l'intégration SQL
  (fixtures, reset, miroir d'identités) doit être validée sur un environnement
  avec `TRAINING_DATABASE_URL`.
- Le dépôt ne propose plus les anciennes suites `npm test` / `npm run test:unit`
  (purge volontaire du 20/10) : les commandes ci-dessus sont les suites
  réellement présentes aujourd'hui.

### À valider manuellement (parcours réel)

1. Configurer deux bases + `TRAINING_DATABASE_URL`, démarrer l'API.
2. Se connecter avec un compte de chaque rôle, ouvrir « Mon parcours »,
   exécuter une mission de chaque niveau, réinitialiser, vérifier la bannière et
   l'absence d'e-mails/notifications réels.
3. Tenter un appel direct `POST /clients` avec un jeton de formation **sans**
   passer par l'UI : il doit être routé vers la base d'entraînement (et jamais
   vers la production).
4. Vérifier le bilan et les raccourcis de bascule après une évaluation réussie.

---

## 8. API formation (extrait)

| Méthode | Route | Rôle |
| --- | --- | --- |
| GET | `/training/status` | Formation configurée ? bannière |
| POST | `/training/enter` | Ouvre une session (jeton `typ: training`, fixtures réamorcées) |
| POST | `/training/exit` | Ferme les sessions |
| POST | `/training/reset` | Réinitialise le bac à sable (progression conservée) |
| GET | `/training/catalog?space=` | Missions filtrées par permissions + progression |
| POST | `/training/missions/:id/start` | Démarre/reprend (trace `TrainingAttempt`) |
| GET | `/training/missions/:id/check?evaluation=` | État des critères sur les données d'exercice |
| POST | `/training/missions/:id/complete` | **Valide** : échoue si critères non satisfaits |
| GET | `/training/report` | Bilan + raccourcis production |
