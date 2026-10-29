# Comexa — Mission 2 : audit approfondi et première amélioration de l’Espace personnel

**Date :** 27 octobre 2026 · **Branche :** `arena/c1004795-comexa-portfolio` · **Base :** `1ae6d10`  
**Rapports précédents lus :** `docs/AUDIT-INCOHERENCES-METIER.md`, `docs/AUDIT-ESPACES-OPPORTUNITES.md`, `docs/STRATEGIE-SAAS-AUDIT.md`, `docs/REFONTE-SOFTUI.md`, `docs/dashboard-design-audit.md`. Aucun de ces rapports n’a été modifié.  
**Méthode :** inspection du code courant, vérification des corrections de la Phase 1, scénarios reproductibles, consultation de sources officielles concurrentielles, puis une première tranche locale et testable. Aucune migration, aucune table, aucun nouveau statut, aucune IA conversationnelle, aucune réécriture de données historiques.

---

## 1. Verdict court

L’Espace personnel possède déjà l’essentiel : tâches privées et tâches de projet assignées dans une même liste, objectifs privés, agenda, minuteur serveur, feuille de temps, rapports journaliers et notifications. La Phase 1 a réellement corrigé les incohérences d’objectifs : le code et les tests sont présents et ont été conservés.

Le principal défaut restant n’est donc pas l’absence d’un module, mais **l’effort mental demandé pour relier les modules existants** : quatre contrôles pour créer une tâche datée et estimée, une estimation ensuite ignorée, un agenda compté en nombre d’éléments et non en temps, aucune « prochaine action » explicite, et un report qui impose d’ouvrir le détail d’une tâche.

La première tranche retenue forme un seul parcours cohérent :

> **Écrire une phrase → voir les valeurs reconnues et les corriger → comprendre la charge connue et la prochaine action → reporter explicitement une tâche à demain.**

Elle réutilise exclusivement les données et routes existantes. Elle n’invente ni capacité de travail, ni statut, ni durée parallèle.

---

## 2. Cartographie réelle de l’Espace personnel

### 2.1 Pages, composants et API

| Route | Composant | Données / actions réellement observées |
|---|---|---|
| `/espace-personnel` | `src/app/(session)/espace-personnel/page.jsx:4-6` | Redirige vers `/espace-personnel/tableau-de-bord`. |
| `/espace-personnel/tableau-de-bord` | `PersonalDashboard.jsx:59+` | `GET /me/tasks`, `/me/calendar/events`, `/time-entries`, `/daily-reports/mine`, `/me/goals?status=ACTIVE` (`PersonalDashboard.jsx:99-103`). KPI, tâches prioritaires, agenda, minuteur, objectifs, rapport du jour. |
| `/espace-personnel/taches` | `PersonalWorkspace.jsx:65+` | `GET /me/tasks`, `/me/goals` (`:80-83`). Vues, filtres, lien profond `?tache=`, objectifs, édition, statut, suppression, minuteur. |
| `/espace-personnel/calendrier` | `CalendarWorkspace.jsx:203+` | `GET /me/calendar/events` ou `/calendar/events` selon l’espace (`:240`). Vues mois/semaine/jour/agenda ; échéances de tâches dérivées, pas recopiées (`backend/src/modules/calendar/calendar.service.ts:16-26`). |
| `/espace-personnel/temps` | Réutilise `espace-equipe/temps/page.jsx` | `GET /time-entries`, minuteur, création/édition/suppression de saisies ; le serveur réduit le périmètre à `own` dans l’espace personnel. |
| `/espace-personnel/rapports-journaliers` | Réutilise `espace-equipe/rapports-journaliers/page.jsx` | `GET/PUT/DELETE /daily-reports/mine` et `/daily-reports/:day`. `DailyReport.contentJson` + résumé libre (`schema.prisma:2855-2862`). |
| `/espace-personnel/notifications` | `NotificationsPanel.jsx:66+` | `/notifications`, lecture, suppression, filtres locaux, liens résolus selon l’espace. |
| `/espace-personnel/compte` | `AccountPanel.jsx` | Profil et préférences du membre connecté. |

### 2.2 Backend, permissions et sources de vérité

- **`GET /me/tasks`** force `assigneeId: <porteur>` même pour un administrateur, combine ensuite le filtre de lecture de l’espace ; les objectifs privés ne sont renvoyés que pour le porteur (`backend/src/modules/tasks/tasks.service.ts:329-380`). La route exige une permission de lecture (`tasks.controller.ts:110-119`).
- **`POST /me/tasks`** exige `task:write:personal` au contrôleur **et** au service ; impose `isPersonal: true`, `assigneeId = reporterId = porteur`, `isClientVisible: false`, aucun projet/jalon/parent (`tasks.controller.ts:130-139`, `tasks.service.ts:540-593`). Le DTO n’accepte que titre, description, priorité, estimation, dates et `goalId` (`tasks/dto/task.dto.ts:122-169`).
- **`PATCH /tasks/:id`** est la route utilisée par le nouveau report ; elle conserve le contrôle d’accès `requireWritable`, la forme des tâches personnelles et l’audit (`tasks.controller.ts:154-164`, `tasks.service.ts:596-699`). Aucun statut n’est envoyé.
- **Objectifs :** progression dérivée des tâches visibles ; `ACHIEVED` exige au moins une tâche `DONE` et aucune tâche ouverte ; seuls les objectifs `ACTIVE` acceptent de nouvelles tâches ; les tâches d’un objectif atteint sont gelées (`backend/src/modules/goals/goal-rules.ts:90-149`, `goals.service.ts:140+`, `tasks.service.ts:759`, `:879`, `:999`, `:1154-1180`). Le frontend ne force plus l’anneau à 100 % (`GoalParts.jsx:68-71`, `PersonalWorkspace.jsx:638-650`).
- **Liaison privée :** `GoalTask` porte `ownerId` et n’écrit rien sur la tâche de projet partagée (`schema.prisma:1356-1402`). Le parseur de cette mission ne peut lier qu’un objectif `ACTIVE` fourni par `/me/goals`.
- **Agenda :** les événements appartiennent à `calendar_events`; `Task.dueDate` et `Project.dueDate` ne sont pas dupliqués (`calendar.service.ts:16-26`). La lecture personnelle filtre propriétaire ou participant (`:185-201`); `present()` expose `startsAt`, `endsAt`, `allDay`, visibilité (`:528-557`).
- **Temps :** `TimerSession.accumulatedSeconds` et `resumedAt` sont la source du décompte ; l’arrêt crée une `TimeEntry` et pose `timeEntryId`/`savedMinutes` (`schema.prisma:1305-1345`, `timer.service.ts:583-654`). Le frontend ne calcule qu’une interpolation d’affichage (`timer.jsx:183-199`). Aucune seconde source de durée n’a été ajoutée.
- **Espace :** chaque requête annonce `X-Comexa-Space` et le backend réduit les droits (`src/lib/spaces.js:1-12`, `SpaceLayout.jsx:33-99`). Le nouveau code n’appelle que les routes déjà utilisées par l’espace personnel.

### 2.3 Classification des fonctionnalités existantes

1. **À conserver sans refonte :** transitions de tâches et sous-tâches, invariants d’objectifs de la Phase 1, confidentialité `GoalTask`, minuteur serveur → `TimeEntry`, calendrier sans duplication d’échéances, états chargement/vide/erreur de `PersonalDashboard`/`PersonalWorkspace`, lien profond `?tache=`.
2. **Fonctionnelles mais inutilement compliquées :** création rapide (`TaskComposer` original : titre + objectif + date + priorité + estimation), report d’une tâche (ouvrir le détail, choisir une date, enregistrer), absence de composeur sur « Ma journée », obligation d’aller à « Mes tâches » pour capturer une idée.
3. **Incomplètes ou incohérentes :** `estimateMinutes` est collecté mais jamais exploité pour la journée ; l’agenda affiche un nombre d’éléments, pas le temps occupé ; « À traiter en priorité » trie globalement les tâches ouvertes sans expliciter la prochaine action ; une estimation absente risquerait d’être lue comme zéro dans un futur bilan ; après création, un échec de rechargement pouvait être affiché comme un échec de création.
4. **Ne répondent pas encore au besoin :** aucune charge connue, aucune décision de report rapide, aucune recommandation fondée sur des données fiables, aucune visualisation de la journée en timeline, aucun bilan hebdomadaire calculé.
5. **Nouvelles fonctions réellement utiles :** parseur déterministe de phrase, panneau « Plan du jour » dérivé des données existantes, bouton « Demain » explicite. Les autres pistes restent à décider ou à instrumenter (§9).

---

## 3. Problèmes confirmés et références

| # | Constat confirmé | Référence | Effet utilisateur |
|---|---|---|---|
| P1 | Une tâche « demain, 2 h, haute priorité, objectif X » demandait quatre contrôles séparés. | `HEAD:src/components/tasks/TaskComposer.jsx:130-184` ; composer original absent de `PersonalDashboard.jsx` | La phrase est déjà dans la tête de l’utilisateur, mais l’interface le force à la traduire en formulaire. |
| P2 | `estimateMinutes` est stocké et affiché, mais ignoré par « Ma journée ». | `PersonalDashboard.jsx:113-136` (avant), `PersonalTaskRow.jsx:109-113`, `tasks.service.ts:569` | L’utilisateur estime son travail sans que Comexa l’aide à arbitrer. |
| P3 | Les événements sont comptés, jamais convertis en temps connu. | `PersonalDashboard.jsx:131-135`, `:173-182`, `calendar.service.ts:528-557` | Deux réunions de 2 h et un rappel de 5 min pèsent le même poids. |
| P4 | « À traiter en priorité » prend les six premières tâches ouvertes triées globalement, sans dire laquelle faire maintenant. | `PersonalDashboard.jsx:119-126` (avant) | L’utilisateur doit refaire mentalement le tri entre retard, jour, priorité et estimation. |
| P5 | Reporter une tâche impose d’ouvrir son détail, modifier la date et enregistrer. | `PersonalTaskRow.jsx:254-284`, `PersonalWorkspace.jsx:292-312` | Sur mobile, un arbitrage simple devient un parcours de formulaire. |
| P6 | Le succès de création n’était pas explicite ; une erreur de `onCreated()` après le POST pouvait être confondue avec un échec de création. | `HEAD:TaskComposer.jsx:82-90` | Risque de créer deux fois la même tâche. |
| P7 | À 768 et 1024 px, le champ de saisie d’une phrase longue était comprimé par le bouton « Ajouter », surtout avec le panneau latéral. | Observation Chromium réelle, `tests/responsive-personal.mjs:412-438` ; correctif CSS `:2844-2858` | Une partie de l’intention disparaît derrière le bouton. |
| P8 | Aucun horaire de travail ni heure de fin de journée n’est stocké. | `schema.prisma` ; recherche dans les DTO/settings | Toute affirmation « journée surchargée » ou « capacité disponible » serait inventée. |

Les corrections de la Phase 1 ont été relues et testées : aucune n’a été annulée. En particulier, le parseur ne propose que des objectifs `ACTIVE`, ne crée aucun statut `ACHIEVED`, et le report n’est pas proposé sur une tâche liée à un objectif `ACHIEVED`.

---

## 4. Étude concurrentielle ciblée — principes retenus

Toutes les pages ci-dessous sont **officielles** et ont été consultées le 27 octobre 2026.

| Source | Ce qui est réellement documenté | Principe retenu pour Comexa | Ce qu’il ne faut pas copier |
|---|---|---|---|
| [Todoist — Quick Add](https://www.todoist.com/help/articles/use-task-quick-add-in-todoist-va4Lhpzz) et [Set a task duration](https://www.todoist.com/help/articles/set-a-task-duration-L1kYkZv8d) | Dates en langage naturel, `p1…p3`, durée `for 1h`; la reconnaissance est visible et peut être annulée. | Une phrase peut porter date, priorité, durée et objectif ; les valeurs détectées doivent rester visibles et modifiables avant création. | Les récurrences complexes, deadlines payantes, labels, capture IA et mapping exact `p1…p4` : Comexa a son propre enum et aucun système de récurrence. |
| [TickTick — Add Tasks](https://help.ticktick.com/articles/7055782422935240704) et [Beginner’s Guide](https://help.ticktick.com/articles/7054286604315131904) | Saisie rapide, reconnaissance de date/heure, tâches + calendrier + Pomodoro dans un même produit ; reconnaissance annulable. | Relier la capture, l’échéance, l’estimation et la concentration sans multiplier les pages. | La voix, les habitudes, les statistiques de Pomodoro propriétaires et les rappels implicites : Comexa n’a pas de champ « heure de début » ni de producteur `TASK_DUE_SOON`. |
| [Sunsama — Timeboxing](https://www.sunsama.com/features/timeboxing) | « Task Projections » confrontent tâches, événements et heure de fin de travail préférée ; le temps réel est suivi au minuteur. | Montrer une charge connue à partir des estimations et des événements datés ; fusionner les chevauchements ; dire explicitement ce qui manque. | Ne pas copier l’heure de fin par défaut, les projections IA ni le glisser-déposer automatique : Comexa ne stocke ni horaires de travail ni décision de réservation. |
| [Structured — Getting Started](https://help.structured.app/en/articles/380546), [Accessibility](https://help.structured.app/en/articles/4725634) et [matrice des plateformes](https://help.structured.app/en/articles/1897986) | Timeline quotidienne, bouton « + » proéminent, VoiceOver, contrastes, texte agrandi, mouvement réduit, différences iOS/Android/Web. | Sur petit écran, garder les actions visibles, larges et utilisables au clavier ; ne pas imposer un geste tactile. | Ne pas copier Replan Pro, les widgets natifs ou une timeline geste-seul : Comexa est une application web et doit garder des contrôles explicites et accessibles partout. |

Ces principes ne justifient pas un « bilan intelligent » générique. Ils justifient une réduction des traductions inutiles entre l’intention de l’utilisateur et les champs déjà présents dans l’API.

---

## 5. Priorisation

| Catégorie | Amélioration | Fréquence / valeur | Confiance | Complexité / risque | Décision |
|---|---|---|---|---|---|
| **Corriger** | Distinguer succès de création et échec de rechargement | À chaque création | Très forte | Faible | **Fait** |
| **Corriger** | Éviter la troncature du composeur sur tablette avec panneau | Fréquent sur 768/1024 | Confirmée en navigateur | Faible, CSS local | **Fait** |
| **Corriger** | Ne jamais transformer une estimation absente en zéro | Permanent dans les calculs | Très forte | Faible, fonction pure | **Fait** |
| **Améliorer** | Saisie rapide déterministe avec valeurs reconnues éditables | Quotidien | Forte (Todoist/TickTick) | Moyenne, aucun backend | **Fait** |
| **Améliorer** | Composeur accessible depuis « Ma journée » | Quotidien | Forte | Faible | **Fait** |
| **Améliorer** | Prochaine action et charge connue | Matin et arbitrages | Forte (Sunsama) | Moyenne, calcul pur | **Fait** |
| **Améliorer** | Bouton « Demain » visible sans ouvrir un panneau | Mobile surtout | Forte (Structured) | Faible, PATCH existant | **Fait** |
| **Ajouter** | Parser, helper de plan et test responsive reproductible | Une seule fois | Forte | Moyenne, tests isolés | **Fait** |
| **Reporter** | Capacité réelle, heure de fin, bilan hebdomadaire, auto-replan | Forte valeur potentielle | Produit ambigu | Élevée | **Documenté, pas imposé** |
| **Reporter** | Timeline façon Structured, gestes tactiles, widgets natifs | Utile mais non démontré | Moyenne | Élevée | **Hors tranche** |

La tranche retenue a le meilleur rapport valeur/risque : elle n’ajoute aucune dépendance métier nouvelle, ne modifie aucun contrat backend, et chaque règle est dans une fonction pure testable.

---

## 6. Première tranche implémentée

### 6.1 Saisie rapide plus naturelle

- `src/lib/task-quick-add.mjs` — parseur déterministe, sans LLM :
  - dates : aujourd’hui, demain, après-demain, `dans N jours`, `JJ/MM[/AAAA]`, `AAAA-MM-JJ`, mois littéral ;
  - priorités : `priorité haute`, `haute priorité`, `p1…p4` ;
  - durées : `pendant 2 h`, `pour 1 h 30`, `durée 90 min`, etc. ;
  - objectifs : `#examen-final`, `objectif:examen-final`, `objectif:"Examen final"`, uniquement parmi les objectifs `ACTIVE`.
  - En cas de valeurs contradictoires, d’objectif inconnu/archivé/ambigu ou de durée invalide : **aucune valeur n’est imposée**, un avertissement explicite demande une correction.
  - `personalTaskPayload()` n’émet que les champs du DTO existant : `title`, `priority`, `dueDate`, `estimateMinutes`, `goalId`. Aucun `status`, `projectId`, `assigneeId`, `isClientVisible`.
- `src/components/tasks/TaskComposer.jsx` :
  - puces vertes « Échéance / Priorité / Estimation / Objectif » avec `role="status"` ;
  - tous les champs restent éditables ; une correction manuelle n’est pas écrasée par la suite de la frappe ;
  - estimation en champ numérique avec présélections, au lieu d’un `<select>` limité ;
  - succès explicite « Tâche « … » ajoutée. » ;
  - si le rechargement échoue après le POST, message distinct : la tâche a bien été créée.
- `PersonalDashboard.jsx:240` rend désormais le composeur directement sur « Ma journée » ; `PersonalWorkspace.jsx:384` continue à l’utiliser avec les objectifs actifs.

### 6.2 Plan du jour honnête

- `src/lib/day-plan.mjs` dérive, sans écriture :
  - tâches ouvertes dues aujourd’hui ou en retard, tri retard → échéance → priorité → titre ;
  - prochaine action ;
  - estimations de tâches et minutes d’événements datés ;
  - chevauchements d’événements fusionnés, y compris la partie d’un événement commencé la veille ;
  - tâches sans estimation comptées séparément ;
  - tâches `DONE` du jour ;
  - événements toute la journée signalés, mais jamais convertis en durée arbitraire.
- `PersonalDashboard.jsx:244-310` affiche « Prochaine action », « Charge connue », « Aujourd’hui » et une explication explicite : Comexa ne connaît pas encore les horaires de travail ; la charge est un repère, **pas une capacité**. Si les données manquent, le texte dit « Données insuffisantes » ; si l’API échoue, le plan est « indisponible », jamais à zéro.
- `planUnavailable` distingue chargement, erreur et absence de permission (`PersonalDashboard.jsx:176-184`).

### 6.3 Report explicite et interactions mobiles

- `canPostponeTask()` n’autorise l’action que pour une tâche ouverte, selon `task:write:personal` ou `task:write:own/any`, et jamais pour une tâche liée à un objectif `ACHIEVED`.
- `postponePayload()` n’envoie que `{ dueDate }` à `PATCH /tasks/:id`, à midi UTC du lendemain — même convention que le formulaire existant (`src/lib/day-utils.mjs:41-44`).
- `PersonalDashboard.jsx:391` expose un bouton visible « Demain » avec libellé accessible complet. Aucune tâche n’est déplacée automatiquement.
- Le backend reste l’autorité : le bouton est une commodité, pas une barrière de sécurité ; le contrôleur vérifie toujours les permissions et le service valide la forme de la tâche.

### 6.4 Responsive local

`src/styles/softui.productivity.css:2561-2872` ajoute uniquement des sélecteurs locaux :

- cibles de 40 px minimum pour les options du composeur, `Demain`, minuteur de liste et bouton de détail ;
- puces et avertissements qui s’enroulent ;
- grille « Plan du jour » qui passe en une colonne selon la largeur réelle du panneau (`@container 620px`) ;
- actions de ligne qui passent sous le titre (`@container 520px`) ;
- composeur nommé `task-composer` : sous 820 px de largeur réelle, le champ occupe la première ligne et « Ajouter » passe dessous. Cela corrige aussi 1024 px avec panneau latéral, là où une simple media query échouait ;
- à 360 px, les faits du plan passent en une seule colonne.

Aucune règle globale de coque, aucune couleur de charte, aucun composant d’un autre espace n’a été modifié. Les sélecteurs du minuteur sont limités à `.sui-lines--tasks` et `.sui-mytask__actions`.

---

## 7. Fichiers modifiés / ajoutés

**Mission 2**

- Modifiés : `package.json`, `src/components/tasks/TaskComposer.jsx`, `src/components/dashboard/PersonalDashboard.jsx`, `src/components/workspace/PersonalWorkspace.jsx`, `src/styles/softui.productivity.css`.
- Nouveaux modules purs : `src/lib/day-utils.mjs`, `src/lib/task-quick-add.mjs`, `src/lib/day-plan.mjs`.
- Nouveaux tests : `tests/personal-space.test.mjs`, `tests/responsive-personal.mjs`.
- Nouveau rapport : `docs/AMELIORATION-ESPACE-PERSONNEL.md`.

**Déjà présents avant cette mission et préservés tels quels** : les 14 fichiers source, 3 nouveaux fichiers de tests et le rapport de la Phase 1, ainsi que `docs/AUDIT-ESPACES-OPPORTUNITES.md` et `docs/STRATEGIE-SAAS-AUDIT.md`.

---

## 8. Tests exécutés et résultats réels

### 8.1 Avant / après les modifications

| Commande | Avant | Après |
|---|---|---|
| Suites existantes (`npm run test:invariants` + `node --test desktop/tests/*.test.cjs`) | Front 9/9 ; backend 25/25 ; desktop 18/18 | Front **29/29** ; backend **25/25** ; desktop **18/18** |
| `node --test tests/personal-space.test.mjs` avec `COMEXA_TEST_SOURCE_ROOT=/tmp/comexa-head` (anciens écrans + nouveaux tests) | **16/20**, 4 contrats d’écran échouent : composeur, plan du jour, confidentialité/permissions, responsive | **20/20** sur le code courant |
| `npx eslint` racine | OK | **OK** |
| `npx eslint` sur les 9 fichiers TS backend de la Phase 1 | OK | **OK** |
| `npm run build` Next 16 / Turbopack | OK, 66 pages | **OK, 66/66 pages statiques/dynamiques générées** |
| `git diff --check` | OK | **OK** |

La reproduction « avant » a été faite en copiant les fichiers `HEAD` de `TaskComposer`, `PersonalDashboard`, `PersonalWorkspace` et du CSS dans `/tmp/comexa-head`, puis en pointant les contrats statiques dessus. Les quatre échecs sont précisément les nouveaux comportements attendus. Les fichiers du workspace n’ont pas été modifiés par cette reproduction.

### 8.2 Couverture des nouveaux tests

`tests/personal-space.test.mjs` couvre 20 cas : phrase métier complète, étiquettes visibles, dates explicites et année déduite, absence de faux positif sur « chapitre 3 », conflits, objectif inconnu/archivé/ambigu, guillemets, durées fractionnaires/invalides, validation et corps API sans statut/projet/assigné, signature de reconnaissance, estimation absente distincte de zéro, prochaine action/retards/tâches terminées, événements chevauchants, événement commencé la veille, journée entière, permissions de report et objectif atteint, contrats d’écran, confidentialité et CSS responsive.

`tests/business-invariants.test.mjs` (Phase 1) continue de vérifier 25/25 que les objectifs, tâches, devis et projets ne régressent pas. Aucun test n’a été désactivé.

### 8.3 Test responsive réel

Commande exécutée avec un dev server Next et un Chromium 153.0.8010.0 extrait d’un paquet npm local, **non ajouté aux dépendances du projet** :

```bash
CHROMIUM_EXECUTABLE=/tmp/chromium-bin \
CHROMIUM_LIB_PATH=/tmp/chromium-libs/lib \
npm run test:responsive:personal
```

Le test ouvre les vraies pages `/espace-personnel/tableau-de-bord` et `/espace-personnel/taches`, intercepte `/api/**` avec des données déterministes, fige l’horloge au 27/10/2026 à 10:00 UTC et utilise le fuseau `Africa/Algiers`. Il vérifie les cinq largeurs, le parcours clavier, la création rapide, le report, les avertissements d’ambiguïté, les états vide/erreur et les erreurs console.

| Largeur | Débordement document | Cible minimale observée | Comportement vérifié |
|---|---:|---:|---|
| 360 px | 0 px | 40 × 40 px | Composeur sur deux lignes, puces enroulées, faits du plan en une colonne, actions sous la tâche. |
| 390 px | 0 px | 40 × 40 px | Création rapide réelle : titre nettoyé, `HIGH`, 75 min après correction manuelle, objectif actif, date à midi UTC. Bouton « Demain » réel : PATCH contenant uniquement `dueDate`. |
| 768 px | 0 px | 40 × 40 px | Plan du jour en deux zones puis faits sur deux colonnes ; avertissements d’ambiguïté visibles. |
| 1024 px | 0 px | 40 × 40 px | Panneau latéral ouvert : le composeur se réorganise selon sa largeur réelle, pas selon une media query globale. |
| 1440 px | 0 px | 40 × 40 px | Composeur sur une ligne, plan en deux zones, aucune colonne supplémentaire inutile. |
| `/taches` à 390 px | 0 px | 40 × 40 px | Même composeur, focus clavier `input → Ajouter`, aucune erreur console. |

Résultats supplémentaires : aucune erreur console ou `pageerror` dans les scénarios ; état vide → « Données insuffisantes… » ; erreur API → « Le plan du jour est indisponible… ». Des captures ont été inspectées visuellement, puis supprimées du workspace pour ne pas ajouter d’artefacts binaires.

**Limites honnêtes :** il s’agit d’un vrai rendu Chromium avec API simulée, pas d’une recette sur PostgreSQL, Safari, iOS/Android physiques, lecteur d’écran matériel ou tactile réel. Le backend `nest build` reste bloqué dans cet environnement par le téléchargement de l’engine Prisma (`binaries.prisma.sh`), exactement comme documenté en Phase 1 ; aucun fichier TypeScript backend n’ayant changé dans cette mission, ce blocage n’a pas été contourné par un faux client.

---

## 9. Non corrigé / idées reportées

1. **Capacité de travail et journées surchargées.** Il faut d’abord décider si l’utilisateur définit des horaires, une heure de fin, des pauses et des jours non travaillés. Sans cela, un seuil « surchargé » serait arbitraire. La tranche actuelle affiche seulement une charge connue et laisse la décision à l’utilisateur.
2. **Bilan hebdomadaire calculé.** Les données existent en partie, mais les reports successifs ne sont pas structurés : `AuditLog.after.dueDate` peut aider, sans garantie de couverture. Construire une recommandation maintenant risquerait de confondre donnée absente et zéro. À faire après inventaire des historiques et définition explicite des règles.
3. **Estimation apprise de l’historique.** Nécessite de relier `TimeEntry` au contexte des tâches terminées, puis de décider du traitement des tâches sans estimation et des valeurs aberrantes. Pas de LLM ajouté sans besoin démontré.
4. **Timeline quotidienne complète et glisser-déposer.** Le calendrier existe déjà. Une timeline geste-seul serait contraire à l’accessibilité demandée. À étudier avec des contrôles visibles et clavier, sur les composants réellement utilisés.
5. **Rappels `TASK_DUE_SOON` / `DOCUMENT_SHARED`.** Types toujours sans producteur backend. Ce sont de vraies fonctionnalités d’émission et de notification, pas un simple libellé.
6. **Objectifs en retard / replanification.** Le compte à rebours existe. Une alerte ou une proposition de découpage doit être fondée sur une règle produit explicite, pas sur une couleur anxiogène.
7. **Rapports journaliers enrichis.** `contentJson` libre ; ajouter des métriques calculées suppose de définir ce qui est une source de vérité et comment préserver les anciens rapports.
8. **Dette de sécurité et de tests de la Phase 1, toujours ouverte :** `/api/agent-chat` transmet le JWT de session complet à n8n ; `render.yaml` garde `EMAIL_VERIFICATION_REQUIRED=false` ; `space-policy.ts` n’a toujours pas ses tests dédiés. Ces points sont hors périmètre de la présente tranche et ne doivent pas être considérés comme résolus.

---

## 10. Recommandation pour la suite

1. **Valider les deux décisions produit** qui débloquent la charge réelle : horaires de travail / heure de fin, et définition d’un report (« nombre de changements de `dueDate` », fenêtre d’historique). Sans elles, ne pas afficher « journée surchargée » ni recommandation hebdomadaire.
2. **Exécuter en CI avec accès aux engines Prisma** : `prisma generate`, `nest build`, suite backend réelle, puis tests responsive avec un vrai compte de démonstration. Ajouter au passage les tests de `space-policy.ts`.
3. **Observer la première tranche** avec quelques utilisateurs : la phrase est-elle comprise ? les puces sont-elles lues avant l’ajout ? le bouton « Demain » est-il découvert sur téléphone ? les avertissements d’ambiguïté sont-ils utiles ou trop verbeux ?
4. **Alors seulement**, enchaîner sur un bilan hebdomadaire sobre, une timeline locale et des rappels d’échéance — chacun avec ses propres règles de calcul, tests de permissions et validation multi-largeurs.

**Résultat de cette mission :** l’Espace personnel permet désormais de capturer une intention complète en une phrase, de voir immédiatement ce que Comexa sait réellement de la journée, de corriger les valeurs reconnues, de reporter explicitement une tâche et d’obtenir des retours clairs — sans reconstruire l’existant, sans inventer de capacité, sans nouvelle IA et sans toucher aux autres espaces.
