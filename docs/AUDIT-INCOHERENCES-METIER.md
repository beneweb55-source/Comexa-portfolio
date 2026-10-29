# Comexa — Phase 1 : audit et correction des incohérences métier transversales

**Date :** 27 octobre 2026 · **Branche :** `arena/c1004795-comexa-portfolio` · **Base :** `1ae6d10`
**Périmètre :** fiabilité des statuts et transitions de l'outil interne existant. Aucune fonctionnalité de la roadmap précédente (bilan hebdomadaire, inbox, SaaS public, multi-tenant, abonnements, refonte design/responsive) n'a été développée.
**Méthode :** lecture du code courant (pas de confiance aveugle dans l'audit précédent), scénarios reproductibles, correction **d'abord dans l'API**, puis alignement minimal des écrans, tests automatisés exécutés avant/après. Aucune migration, aucune nouvelle table, aucun nouveau statut, aucune réécriture de données historiques.

---

## A. Incohérences trouvées

### A.1 — Corrigées (confirmées par un scénario reproductible)

| # | Domaine | Scénario reproductible | État observé avant | État attendu |
|---|---|---|---|---|
| 1 | Objectifs / tâches | `POST /me/goals` puis `PATCH /me/goals/:id {status:"ACHIEVED"}` | **200 OK** : objectif « Atteint », `progress.percent = 0`, aucune tâche. Carte React forçait l'anneau à **100 %**. C'est le cas signalé. | 422 avec motif actionnable |
| 2 | Objectifs / tâches | Idem avec 1 tâche `TODO`, ou avec toutes les tâches `CANCELLED` | 200 OK, « Atteint » avec travail restant ou sans aucun travail fait | 422 (les tâches annulées ne comptent ni pour ni contre) |
| 3 | Objectifs / tâches | Objectif `ACHIEVED` + `PUT /me/goals/:id/tasks/:taskId` ou création d'une tâche personnelle avec `goalId` | Liaison acceptée : nouvel objectif « Atteint » avec une tâche ouverte. `goalAcceptsTasks()` n'écartait que `ARCHIVED`, alors que le commentaire de `TasksService.requireOwnOpenGoal` promettait « ni atteint ni archivé » — **le code et son propre commentaire se contredisaient**. | 422 « rouvrez l'objectif » |
| 4 | Objectifs / tâches | Objectif `ACHIEVED`, puis rouvrir une tâche liée (`PATCH /tasks/:id/status`), la supprimer, la réassigner, la détacher ou la déplacer vers un autre objectif | L'objectif reste `ACHIEVED` avec un avancement < 100 % : l'invariant devient faux par cinq chemins différents | 422 unique, même règle partagée |
| 5 | Objectifs — cohérence d'affichage | Même objectif atteint sans tâche | `GoalCard` = 100 %; `GoalFocus` et le tableau de bord = 0 %. Trois écrans, deux vérités | Un seul pourcentage, déduit des tâches |
| 6 | Devis | Devis `SENT` avec `validUntil` dépassé | Le commentaire de `assertNotExpired` affirme qu'**une tâche planifiée écrit `EXPIRED`** ; aucun producteur n'existe (seul `InvoiceOverdueService` est planifié). Résultat : liste = « Envoyé », filtre « Expirés » vide, page client propose « Accepter », l'API répond 422 | Un statut dérivé cohérent sur liste, détail, filtre, PDF et décision |
| 7 | Devis | `validUntil` saisi depuis `<input type="date">` = `AAAA-MM-JJ`, stocké à minuit UTC | `validUntil.getTime() < Date.now()` déclarait le devis expiré dès **00:00 UTC le dernier jour affiché** (01:00 à Alger) : « Valable jusqu'au 01/10 » mais impossibilité d'accepter le 01/10 | Jour de validité **inclusif** |
| 8 | Devis | `POST /quotes/:id/send` sur un brouillon dont la validité est déjà passée | Devis envoyé, immédiatement indécidable (422 à l'acceptation) | 422 avant l'envoi, avec correction demandée |
| 9 | Devis | Client ouvre un devis expiré → `POST /quotes/:id/view` | `SENT` → `VIEWED` : une offre périmée « consultée » aujourd'hui | Pas de transition, réponse `EXPIRED` |
| 10 | Projets | Projet `COMPLETED` → `IN_PROGRESS` via `PATCH /projects/:id/status` (le frontend n'envoie que `{status}`) | `completedAt` effacé mais **`progressPercent` reste à 100** : projet rouvert affiché terminé dans la barre, la liste et le dashboard | Avancement recalculé depuis les tâches |
| 11 | Notifications | Un jalon passe `REACHED` | Notification au manager émise avec `type: SYSTEM` alors que `MILESTONE_REACHED` existe et est mappé côté UI (filtre/icône/lien) | `MILESTONE_REACHED` |
| 12 | PDF devis | Générer le PDF d'un devis périmé | Le PDF lisait le statut brut de la base (« Envoyé ») alors que les écrans lisent désormais « Expiré » | Même statut dérivé à l'impression |

### A.2 — Vérifiés, **sans** incohérence confirmée (donc non modifiés)

- **Tâches :** `TASK_STATUS_TRANSITIONS` ( stricte pour les tâches de projet, libre pour le carnet personnel ), `hasOpenSubTasks` ( refus de clore un parent avec enfants ouverts ), `canAttachSubTask`, `isTaskEditable`, `completedAt` remis à `null` à la réouverture, sélecteur du minuteur qui exclut `DONE`/`CANCELLED`. Les miroirs frontend (`src/lib/task-status.mjs`) correspondent.
- **Factures / paiements :** statut **dérivé** de la somme des paiements via `statusAfterPayment`, écrivain unique `recomputePaymentState`, verrou `lockForPayment`, `canRecordPayment` / `canCancelInvoice` cohérents avec `OVERDUE`, `paidAtFor` remis à `null` quand le statut redescend. Aucune donnée financière n'a été touchée.
- **Minuteur :** `findActive` + index unique partiel + traduction P2002 en 409, transitions `RUNNING/PAUSED/STOPPED`, `savedMinutes`/`timeEntryId` cohérents à l'abandon.
- **Demandes de modification :** `DecideModificationRequestDto` limite explicitement la décision à `APPROVED`/`REJECTED` ; `decide()` est idempotent sur une même décision et refuse un revirement. Pas de porte de traversée trouvée.
- **Demandes de contact :** `CONVERTED` réservé au module commercial (refus explicite ailleurs), `handledBy`/`handledAt` posés au premier traitement. Transitions libres entre `NEW/IN_REVIEW/SPAM/ARCHIVED` : choix produit assumé.
- **Liens de notifications :** `src/lib/notification-links.js` traduit bien tous les liens serveur (`/factures/:id`, `/taches/:id`, `/espace/demandes/:id`, `/admin/demandes/:id`…) vers une route Next existante, par espace. Aucun lien mort trouvé.

---

## B. Corrections appliquées

### B.1 — Invariants explicites (une seule définition, dans la couche métier)

| Id | Invariant |
|---|---|
| **I1** | Un objectif ne peut être **déclaré** `ACHIEVED` que si `progress.done > 0` **et** `progress.open === 0` sur les tâches visibles de son propriétaire. Une tâche annulée ne compte ni pour ni contre. Trois motifs distincts : `GOAL_NO_TASKS`, `GOAL_NO_DONE_TASK`, `GOAL_HAS_OPEN_TASKS`. |
| **I2** | Seul un objectif `ACTIVE` accepte de nouvelles tâches. `ACHIEVED` et `ARCHIVED` sont fermés ; la sortie est explicite (« Rouvrir » / « Réactiver »). |
| **I3** | Un objectif `ACHIEVED` **gèle** ses tâches : aucune ne peut quitter `DONE`, être détachée, supprimée, réassignée ou déplacée vers un autre objectif sans réouverture préalable. Refus explicite plutôt que cascade silencieuse : `achievedAt` est une donnée d'histoire. |
| **I4** | L'avancement affiché n'est **jamais** fabriqué : `GoalRing` reçoit toujours `progress.percent`. Les objectifs historiques incohérents sont **signalés** (`needsReopen`) et non réécrits. |
| **I5** | `EXPIRED` est un **statut dérivé à la lecture** de `validUntil` pour `SENT`/`VIEWED`. Un état déjà tranché (`ACCEPTED`, `REJECTED`, `CANCELLED`, `EXPIRED`) et un `DRAFT` ne sont jamais réécrits par le calendrier. Le jour de validité est inclusif (fin du jour UTC). |
| **I6** | Un projet qui quitte `COMPLETED` voit son `progressPercent` **recalculé** depuis ses tâches (annulées exclues), sauf valeur explicite dans le DTO. La clôture impose toujours 100. |

### B.2 — Fichiers modifiés

**Backend (source de vérité)**
- `backend/src/modules/goals/goal-rules.ts` — `goalAchievementBlocker`, `goalCanBeAchieved`, `goalAchievementMessage`, `goalAcceptsTasks` (désormais `ACTIVE` seulement), `goalFreezesTasks`, `goalAcceptsTaskStatus`. Fonctions pures, sans Prisma.
- `backend/src/modules/goals/goals.service.ts` — garde I1 dans `update()` **avant toute écriture** ; I2/I3 dans `linkTask()` (y compris le déplacement depuis un objectif atteint), `unlinkTask()` ; `present()` expose `needsReopen`.
- `backend/src/modules/tasks/tasks.service.ts` — importe ces règles (pas de copie divergent) ; un seul garde `assertAchievedGoalAllowsTask()` appelé par `changeStatus`, `remove`, `assign` ; `requireOwnOpenGoal()` aligné sur son propre commentaire.
- `backend/src/modules/quotes/quote-state.ts` — `quoteValidityDeadline`, `quoteExpiredBefore`, `isQuoteExpired`, `effectiveQuoteStatus`, `withEffectiveQuoteStatus`.
- `backend/src/modules/quotes/quotes.service.ts` — dérivation dans `list()` (avec filtre `?status=EXPIRED` aligné sur la même règle), `getOne()`, `markViewed()` ; garde `QUOTE_VALIDITY_PAST` dans `send()` ; `assertNotExpired()` utilise la même règle ; combinaison `AND` du filtre de statut et de la recherche.
- `backend/src/modules/pdf/pdf.service.ts` — même statut dérivé à l'impression.
- `backend/src/modules/projects/project-progress.ts` (**nouveau**) — fonction pure `projectProgressFromTaskStatuses`.
- `backend/src/modules/projects/projects.service.ts` — I6 dans `changeStatus()`.
- `backend/src/modules/milestones/milestones.service.ts` — `NotificationType.MILESTONE_REACHED`.

**Frontend (alignement minimal, aucune CSS touchée)**
- `src/lib/goals.mjs` — miroir `goalCanBeAchieved` (documenté comme miroir, le serveur reste la référence).
- `src/components/goals/GoalParts.jsx` — suppression du faux 100 % ; `title` explicatif pour les objectifs historiques.
- `src/components/workspace/PersonalWorkspace.jsx` — même invariant pour la proposition « Objectif atteint ? », sélecteur d'objectifs limité à `ACTIVE`, bouton « Objectif atteint » désactivé **avec explication visible** (`role="status"`) quand l'API le refuserait, message de réouverture pour les données historiques.
- `src/components/tasks/PersonalTaskRow.jsx` — sélecteur limité à `ACTIVE`, objectif atteint déjà lié affiché mais non sélectionnable, aide « Rouvrez cet objectif avant de détacher une tâche ».
- `package.json`, `backend/package.json` — scripts `test:invariants` pour rejouer les suites.

**Nouveaux codes d'erreur stables** (message français renvoyé par `messageOf()` même sans entrée dans `FRIENDLY`) : `GOAL_NOT_COMPLETABLE` (422, avec `details.progress`), `GOAL_ACHIEVED` (422), `GOAL_ACHIEVED_TASK_LOCKED` (422, volontairement le même statut partout), `QUOTE_VALIDITY_PAST` (422). `GOAL_ARCHIVED` et `QUOTE_EXPIRED` conservés.

### B.3 — Permissions, périmètres et données privées

- Aucun nouveau scope ni aucune nouvelle permission : les routes gardent `@RequirePermissions('task:write:personal')`, etc. Les gardes s'ajoutent **après** `refuseClientSpace` / `requireOwn` / `requireWritable`.
- `assertAchievedGoalAllowsTask()` ne renvoie le **titre de l'objectif** qu'à son propriétaire ; un chef de projet qui rouvre une tâche liée à l'objectif privé d'un collègue reçoit un message générique, sans fuite de contenu.
- `needsReopen` est un booléen dérivé des seules tâches que le propriétaire peut déjà voir (`mineTaskWhere`) — aucune donnée supplémentaire exposée.
- Côté devis, le périmètre client (`clientPerimeter`, `NOT: {status:'DRAFT'}`) et le périmètre PDF sont inchangés : seule la **valeur de statut présentée** est dérivée.
- **Aucune réécriture d'historique :** `Goal.status`/`achievedAt`, `Quote.status`/`validUntil`, `Project.completedAt`, montants et paiements restent tels quels en base. Le statut `EXPIRED` n'est jamais écrit.

### B.4 — Données historiques : inventaire manuel, pas de correction automatique

Les objectifs déclarés atteints avant cette correction (sans tâche, ou avec des tâches rouvertes) restent lisibles : l'API renvoie `needsReopen: true`, l'écran affiche un pourcentage honnête et propose « Rouvrir ». Aucun script de reprise n'a été lancé. Requête **de lecture seule** pour les lister (à exécuter sur une copie, jamais en écriture automatique) :

```sql
SELECT g.id, g.title, g."ownerId", g."achievedAt",
       count(t.id) FILTER (WHERE t."deletedAt" IS NULL AND t.status <> 'CANCELLED') AS countable,
       count(t.id) FILTER (WHERE t."deletedAt" IS NULL AND t.status = 'DONE')      AS done
FROM goals g
LEFT JOIN goal_tasks gt ON gt."goalId" = g.id
LEFT JOIN tasks t       ON t.id = gt."taskId"
WHERE g.status = 'ACHIEVED'
GROUP BY g.id
HAVING count(t.id) FILTER (WHERE t."deletedAt" IS NULL AND t.status <> 'CANCELLED') = 0
    OR count(t.id) FILTER (WHERE t."deletedAt" IS NULL AND t.status <> 'CANCELLED')
    <> count(t.id) FILTER (WHERE t."deletedAt" IS NULL AND t.status = 'DONE');
```

Cette requête est **approximative** : la progression réelle dépend aussi de `mineTaskWhere` (tâche assignée au propriétaire, projet non supprimé). La décision de rouvrir ou d'archiver appartient au membre concerné.

---

## C. Tests réels (exécutés, pas supposés)

### C.1 — Reproduction du bogue avant correction, validation après

Les fichiers de services backend ont été temporairement remplacés par leur version `HEAD` (les nouveaux modules de règles pures et les tests restant en place), la suite a été rejouée, puis les fichiers ont été restaurés et la suite rejouée :

| Exécution | Résultat |
|---|---|
| **Avant correction** (services `HEAD`, nouveaux tests) | `25 tests — 7 pass / `**18 fail`** (exit 1) |
| **Après restauration du code corrigé** | `25 tests — 25 pass / 0 fail` (exit 0) |

Les 7 tests qui passaient déjà sont les tests de **règles pures** et de contrats d'énumération ; les 18 échecs couvrent les scénarios d'API de A.1, le garde partagé du module tâches et les contrats de notification. Ce n'est donc pas un test « écrit après coup qui ne prouve rien » : il échoue sur le code d'origine.

### C.2 — Commandes et résultats

| Commande | Résultat réel |
|---|---|
| `npm run test:invariants` (racine : frontend + backend) | **9/9** frontend (dont 5 existants `contract.test.mjs`) puis **25/25** backend — 0 échec |
| `npm run test:invariants --prefix backend` | **25/25** — 0 échec |
| `node --test tests/*.test.mjs` | **9/9** |
| `cd backend && node --import tsx --test tests/document-deletion.test.mjs` (suite existante) | **23/23** — voir la réserve C.3 |
| `node --test desktop/tests/*.test.cjs` | **18/18** |
| `npx eslint` (racine) | **0 erreur** |
| `npx eslint <9 fichiers backend modifiés>` | **0 erreur** (3 erreurs Prettier corrigées puis revérifiées) |
| `npm run build` (Next 16 / Turbopack) | **succès**, 66 pages générées, 0 erreur |
| `tsc` strict ciblé sur les 3 nouveaux modules de règles pures | **0 erreur** |

Nouveaux fichiers de tests : `backend/tests/business-invariants.test.mjs` (25 tests, scénarios d'API avec faux Prisma), `tests/business-invariants.test.mjs` (4 tests, miroir frontend + contrats d'écran), `backend/tests/helpers/prisma-stubs.mjs` (enums lus depuis le schéma, client minimal — **uniquement pour les tests hors ligne**).

### C.3 — Ce qui n'a **pas** pu être exécuté (à ne pas confondre avec un succès)

- **`npm run build --prefix backend` (`nest build`) : IMPOSSIBLE.** `prisma generate` échoue avant compilation : `request to https://binaries.prisma.sh/.../schema-engine.gz failed ... TLS disconnected` (hôte non autorisé dans cet environnement). Le client généré n'est pas versionné, donc ni `nest build` ni les tests qui importent `backend/dist/**` ne peuvent tourner « normalement ».
  - Pour ne rien laisser au hasard, un **typecheck local de substitution** a été fait avec des déclarations générées localement (non versionnées) : avec `--noImplicitAny false`, la vingtaine de lignes d'erreur résiduelles se situe **exclusivement dans des fichiers non modifiés** et provient du client factice (types `any`, `Prisma.TransactionIsolationLevel`, etc.) ; **aucune** dans les fichiers de cette phase. Les 3 modules de règles pures passent un `tsc` strict isolé. **Cela ne remplace pas un vrai `nest build` en CI.**
- La suite existante `backend/tests/document-deletion.test.mjs` a été exécutée via des **shims temporaires** `dist/ → src/` (supprimés ensuite), avec `tsx`. 23/23 passent, mais ce n'est pas une exécution contre un `dist` réellement compilé.
- `backend/tests/health-database-target.spec.ts` : **non exécuté** (runner Nest + base de données + client généré requis).
- `npm run test:onboarding` (racine) : script préexistant qui référence `tests/onboarding.test.mjs`, `backend/tests/onboarding.database.test.mjs` et `tests/onboarding.browser.mjs` — **ces fichiers n'existent pas** dans le dépôt. Non corrigé (hors périmètre), signalé en D.

---

## D. Non corrigé / choix produit à confirmer

1. **Gel des objectifs atteints (I3) — choix produit à valider.** Nous refusons la modification d'une tâche liée à un objectif atteint et demandons une réouverture explicite, pour préserver `achievedAt`. L'alternative (réouverture automatique de l'objectif dès qu'une tâche bouge) est plus fluide mais efface la date d'atteinte en silence. Si l'équipe préfère l'auto-réouverture, il faut la décider explicitement et journaliser l'événement.
2. **Jour de validité inclusif (I5) — choix produit à valider.** Le jour affiché « Valable jusqu'au X » est désormais acceptant jusqu'à 23:59:59 UTC. Cela **allonge d'un jour** la fenêtre d'acceptation par rapport à l'ancienne comparaison instantanée. Si la règle commerciale est « minuit UTC la veille », il suffit de modifier `quoteValidityDeadline()` — un seul endroit, tests compris.
3. **`EXPIRED` reste un statut dérivé, pas persisté.** Conséquence : les exports/comptages qui lisent directement la table `quotes` (hors API) verront encore `SENT`/`VIEWED`. Un cron de bascule est possible mais écrirait de l'historique : à décider séparément, avec inspection des données et plan de retour arrière. **Aucune migration n'a été ajoutée.**
4. **Jalon `REACHED` avec des tâches ouvertes : toujours autorisé.** La table de transitions et les commentaires le décrivent comme un *constat daté*, pas comme une somme de tâches ; imposer « toutes les tâches terminées » changerait le modèle produit. Non modifié.
5. **Projet `COMPLETED` avec des tâches ouvertes : toujours autorisé.** Conformément à la consigne de ne pas imposer arbitrairement ce blocage. Seul l'avancement affiché à la réouverture a été corrigé. Un projet rouvert **sans aucune tâche** repasse à 0 % : c'est honnête, mais à confirmer si l'équipe préfère conserver une valeur déclarée.
6. **Types de notification sans producteur :** `TASK_DUE_SOON` et `DOCUMENT_SHARED` sont déclarés, mappés côté UI, mais aucun code ne les émet. Aucune action impossible n'est annoncée (ils n'existent simplement pas) ; un test inventorie cette dette et échouera si un producteur apparaît sans mise à jour de l'écran. Les émettre = nouvelles fonctionnalités (rappel d'échéance, événement de partage) → **hors Phase 1**.
7. **Statuts dormants :** `ModificationStatus.IN_PROGRESS` / `DONE` et certaines valeurs de `ContactRequestStatus` n'ont pas de machine à états dédiée. Les décisions sont déjà fermement validées par les DTO ; pas d'incohérence de transition constatée, donc pas de changement.
8. **Données historiques d'objectifs :** voir B.4. Correction manuelle uniquement, jamais automatique.
9. **Script `test:onboarding` cassé** (fichiers absents) et **`backend/tests/health-database-target.spec.ts` non exécutable ici** : dette d'outillage de tests, pas de logique métier.
10. **Alertes de sécurité de l'audit précédent — toujours ouvertes, volontairement non traitées ici (hors périmètre) :**
    - `src/app/api/agent-chat/route.js` (l. 84–93) place le **JWT de session complet** dans `metadata.jwt` et l'envoie au webhook n8n externe. À remplacer par un jeton de service à scopes minimaux.
    - `render.yaml` (l. 79–80) : `EMAIL_VERIFICATION_REQUIRED: "false"` en production (vérification e-mail suspendue).
    - `backend/src/common/spaces/space-policy.ts` (l. 14) affirme « fonctions pures, testées à l'unité » ; **aucun test** ne référence ce fichier dans `backend/tests/`, `tests/` ou `desktop/tests/`. À couvrir en priorité.

---

## E. Responsive

**Ce qui a changé dans l'interface (3 écrans seulement) :**
- `GoalParts.jsx` : plus aucun calcul de pourcentage, uniquement un attribut `title` — **aucun changement de dimensions**.
- `PersonalWorkspace.jsx` : ajout d'un `<p className="sui-goalfocus__stats" role="status">` dans `.sui-goalfocus__copy` (colonne flex, `min-width:0`, `gap:6px`) et `disabled`/`title` sur un bouton existant. Le conteneur passe en 2 colonnes puis actions pleine largeur sous **860 px** (media query existante, inchangée).
- `PersonalTaskRow.jsx` : ajout d'un `<span className="sui-field__hint">` (petit texte existant) et `disabled` sur un `<select>`; la grille de contrôles passe en une colonne sous **720 px** (media query existante, inchangée).

**Aucune règle CSS, aucune taille de cible tactile, aucune couleur ni aucune grille globale n'a été modifiée.** Le bouton désactivé hérite de `.sui-btn[disabled] { opacity:.5; cursor:not-allowed }` déjà présent ; l'explication est un texte visible avec `role="status"` (donc annoncé au clavier/lecteur d'écran), pas une simple infobulle. Les états de chargement/erreur existants (`notice`, `messageOf`) sont conservés ; les nouveaux codes d'erreur serveur s'affichent via le message français.

**Ce qui n'a PAS pu être observé :** aucun navigateur (Chromium/Firefox) ni binaire Playwright n'est disponible dans cet environnement, et aucune base ni secrets ne permettent de lancer l'application en conditions réelles. **Aucune validation visuelle réelle à 360 / 390 / 768 / 1024 / 1440 px, aucun test tactile, aucune mesure de débordement horizontal, aucun parcours clavier en conditions réelles n'a été effectué.** Le build Next et les tests statiques ne prouvent pas le rendu. À faire avant mise en production, sur un environnement avec navigateur et données de démonstration, en ciblant en priorité : la carte d'objectif avec le nouveau texte d'aide à 360 px, le panneau `GoalFocus` à 768 px (bascule 860 px), et le détail de tâche avec l'aide sous le sélecteur à 390/720 px.

---

## F. Recommandation pour la suite

**Priorité 1 — débloquer la CI backend.** Faire tourner `prisma generate` + `nest build` + la suite `backend/tests/*` dans un environnement autorisé à joindre `binaries.prisma.sh` (ou mettre en cache les engines Prisma dans l'image de build). Tant que ce n'est pas fait, seul le typecheck de substitution décrit en C.3 valide le TypeScript backend. Ajouter au passage des tests pour `space-policy.ts`, aujourd'hui sans couverture malgré son commentaire.

**Priorité 2 — trancher les deux choix produit de D.1 et D.2** (gel vs auto-réouverture des objectifs ; jour de validité inclusif vs minuit UTC). Ce sont les deux décisions qui changent le comportement utilisateur ; les tests sont déjà écrits autour d'une seule fonction chacune, donc le coût de bascule est faible.

**Priorité 3 — traiter les trois alertes de sécurité de D.10.** Le JWT de session envoyé à n8n est le plus grave : il donne à un service tiers la capacité d'agir avec l'identité de l'utilisateur. À corriger avant toute exposition plus large.

**Priorité 4 — données historiques.** Exécuter la requête B.4 sur une copie de la base, décider au cas par cas (rouvrir / archiver / conserver) avec les membres concernés, et journaliser les corrections. Ne pas automatiser.

**Priorité 5 — validation responsive réelle** (voir E) sur les trois écrans modifiés, puis seulement envisager les fonctionnalités de la roadmap (rappels d'échéance `TASK_DUE_SOON`, partage de documents `DOCUMENT_SHARED`, bilan, inbox) — explicitement hors du périmètre de cette phase.

---

### Fichiers livrés dans cette phase

- 14 fichiers source modifiés + 1 nouveau module (`project-progress.ts`) — liste en B.2.
- 2 suites de tests nouvelles (`backend/tests/business-invariants.test.mjs`, `tests/business-invariants.test.mjs`), 1 helper de tests, 2 scripts npm.
- Ce rapport : `docs/AUDIT-INCOHERENCES-METIER.md`.
- Les rapports précédents `docs/AUDIT-ESPACES-OPPORTUNITES.md` et `docs/STRATEGIE-SAAS-AUDIT.md` sont **conservés tels quels** (fichiers non suivis préexistants).
