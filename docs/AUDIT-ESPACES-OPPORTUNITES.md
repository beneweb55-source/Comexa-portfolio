# Comexa Portfolio — Audit produit complet, étude concurrentielle et plan d'amélioration des 4 espaces

**Date : 27 octobre 2026.**  
**Périmètre : le dépôt `Comexa-portfolio` tel qu'il existe, sans modification du code applicatif.**  
**Livrable : ce rapport uniquement.** Aucune API, aucun modèle Prisma, aucune migration, aucune configuration et aucun composant n'ont été modifiés.

---

## 0. Méthode, vérifications et limites de cet audit

### 0.1 Ce qui a été réellement fait

| Vérification | Résultat |
| --- | --- |
| Lecture du code | 681 fichiers suivis par Git ; lecture ciblée des routes, layouts, composants, contrôleurs, services, schéma Prisma, catalogue de permissions, CSS et tests. Les références de fichiers et de lignes ci-dessous renvoient à l'état du commit de travail du 27/10/2026. |
| Frontend | `npm ci` (dépendances installées dans `node_modules`, non versionné), `npx eslint` : **0 erreur**. `npm run build` (Next 16 / Turbopack) : **compilation réussie**, 0 erreur. |
| Tests | `node --test tests/contract.test.mjs` : **5/5**. `node --test desktop/tests/*.test.cjs` : **18/18** (après installation des dépendances `desktop/`). |
| Tests non exécutés | `backend/tests/document-deletion.test.mjs` et `backend/tests/health-database-target.spec.ts` : ils importent `backend/dist/…` et le client Prisma généré (`backend/src/generated/`), qui ne sont **pas versionnés** (0 fichier suivi). Les exécuter exige `npm ci` + `prisma generate` + `nest build` et une base PostgreSQL pour la sonde de santé. Non fait : cela aurait généré des artefacts de build pendant un audit « sans modification ». |
| État Git après vérifications | Un seul fichier non suivi : `docs/STRATEGIE-SAAS-AUDIT.md` (rapport précédent). Aucun fichier applicatif modifié. |
| Navigation réelle dans l'application | **Non possible dans cet environnement** : aucun navigateur (Chromium/Firefox) n'est installé, aucun navigateur Playwright n'est téléchargeable (accès réseau limité), et le backend exige une base PostgreSQL et des secrets non présents. L'analyse responsive est donc **statique et sourcée** (CSS, media queries, container queries, composants), complétée par les recettes navigateur déjà documentées dans `docs/dashboard-design-audit.md` (15/10/2026) et `docs/REFONTE-SOFTUI.md`. Ce point est une limite assumée, pas un résultat de test. |
| Recherche concurrentielle | Sites officiels, documentations et pages de fonctionnalités consultés le 27/10/2026. Chaque affirmation externe porte un numéro de source `[S…]` renvoyant à la section 13. Les rares affirmations issues de revues tierces sont explicitement marquées comme telles. |

### 0.2 Règle de lecture

Les constats sont classés en : **(1) vérifié dans le code** (référence de fichier/ligne), **(2) déduit d'un contrat d'API ou d'un commentaire de code** (signalé), **(3) hypothèse produit** (signalée explicitement dans la section 12). Aucune fonctionnalité supposée n'est présentée comme confirmée.

---

## 1. Résumé exécutif

1. **Comexa Portfolio n'est pas un prototype.** C'est un ERP d'agence mono-organisation abouti : 66 modèles Prisma, 25 migrations, 43 contrôleurs NestJS, 4 espaces authentifiés, un site public, une app desktop Electron avec cache chiffré hors ligne, une coque Android, des PDF, de l'audit, des websockets, des jetons d'intégration et une console IA. Toute proposition « refaire un dashboard » serait un contresens.

2. **Le responsive est déjà un point fort, pas un chantier à ouvrir.** La coque `Shell.jsx` (1 230 lignes) gère explicitement 5 contextes : barre d'onglets mobile, tiroir « Toutes les rubriques », rail desktop, dock, panneau de suivi en tiroir < 1024 px. Les tableaux `.sui-table` / `.cx-stack-table` deviennent des cartes libellées sur mobile (`comexa.responsive.css:638-735`), le calendrier bascule en vue « agenda » sous 767 px, et le CSS utilise des **container queries** pour adapter les grilles à la largeur réellement disponible. Les défauts restants sont **locaux et identifiés**, pas structurels.

3. **Le vrai défaut de l'espace personnel n'est pas l'absence de tâches, d'objectifs, de minuteur ou de concentration : tout cela existe.** Ce qui manque, c'est la **boucle de retour** : comparer le prévu au réel, détecter les reports, ajuster la charge. `DailyReport` n'est qu'un JSON libre + un résumé de 280 caractères ; aucune vue ne rapproche `estimateMinutes`, `dueDate`, `completedAt`, `TimeEntry` et `TimerSession`. C'est la meilleure opportunité produit du rapport.

4. **Une fonctionnalité est déclarée mais morte** : `TASK_DUE_SOON` existe dans l'énumération, dans la politique d'espaces et dans la carte des notifications, mais **aucun code backend ne l'émet** (seule la page de démonstration `refonte-apercu` la simule). C'est exactement le genre de « fonctionnalité existante mais incomplète » que l'audit doit signaler plutôt que de proposer un énième rappel.

5. **L'espace Business automatise déjà bien les grandes transitions** : demande de contact → prospect, prospect → client, acceptation d'un devis → projet + client, devis → facture, facture en retard → relance cron. Les ruptures sont ailleurs : pas de file d'entrée unifiée, pas de notion de coût/marge par projet (la répartition des revenus existe, la rentabilité non), pas de rappel avant l'expiration d'un devis, et un Kanban qui reste dépendant d'un glisser-déposer peu adapté au tactile.

6. **Comexa Space est un back-office honnête mais incomplet sur la traçabilité et l'exploitation.** Le backend `audit-logs` renvoie `entityId`, `before`, `after` (redressés) et accepte des filtres `actorId`/`entityId` ; la page `/espace-comexa/journal` n'affiche ni l'identifiant de l'objet, ni le contenu de la modification, et n'expose que 4 filtres. Aucune vue ne répond à « est-ce que le mail, le stockage et le cron tournent ? » alors que `/api/health` existe.

7. **L'espace client est le plus perfectible des quatre.** Il a les briques (projets, jalons, documents, devis acceptables, factures, demandes de modification, messagerie) mais il ne dit jamais clairement **« voici ce qu'on attend de vous maintenant »**. Le tableau de bord client affiche un `DataView` générique qui transforme un objet JSON en grille de chiffres ; le suivi de projet n'exploite pas le fil d'activité `isClientVisible` pourtant présent côté backend ; un supplément proposé sur une demande de modification ne peut pas être accepté ou refusé par le client dans l'interface.

8. **Trois risques de sécurité / robustesse à documenter sans les corriger ici (P0/P1)** : (a) le proxy `/api/agent-chat` transmet le **JWT de session complet** à un webhook n8n externe (`src/app/api/agent-chat/route.js:81-85`) — le workflow n8n n'est pas dans le dépôt, donc le traitement côté tiers n'est pas vérifiable ; (b) `EMAIL_VERIFICATION_REQUIRED: "false"` est explicitement configuré en production (`render.yaml:79-80`) ; (c) le commentaire de `space-policy.ts` annonce des « fonctions pures, testées à l'unité », mais **aucun test** ne référence `effectivePermissions` ou `canEnterSpace` dans le dépôt. Détails en section 11.

9. **Les concurrents les plus instructifs ne sont pas toujours les plus connus.** Pour le personnel : Todoist (saisie rapide en langage naturel, objectifs quotidiens), Sunsama (projection de la charge réelle vs temps disponible, estimation apprise de l'historique), Structured (timeline visuelle mobile, mais matrice de fonctions par plateforme très inégale), TickTick (matrice d'Eisenhower + Pomodoro + habitudes). Pour l'équipe : Linear (triage + inbox prioritaire + snooze), Productive (budget/marge en temps réel), Teamwork (utilisateurs clients gratuits + planificateur de charge), Odoo (flux devis → commande → facture → paiement). Pour Comexa Space : Odoo (droits par groupe + avertissement « admin impuissant »), GitHub (journal d'audit avec identifiants de jetons, expiration automatique). Pour le client : HoneyBook (jalons et tâches côté client dès la page d'accueil), Assembly/ex-Copilot (portail unifié, mais paiement Stripe et pas d'app native), Teamwork (permissions fines côté client).

10. **Contrainte locale à ne pas perdre de vue** : les outils étudiés facturent en USD/EUR (la page de tarifs Todoist ne propose pas le DZD), s'appuient sur Stripe/cartes internationales et, pour HoneyBook, réservent le service aux professionnels US/CA/UK/AU. Pour un usage algérien, le paiement en ligne passe par CIB/Edahabia via SATIM avec un contrat marchand (4 à 12 semaines). Comexa a donc un avantage structurel : DZD, CCP/BaridiMob, français, et une facturation déjà construite. **[S2][S27][S28]**

11. **Les cinq améliorations les plus importantes** (détaillées section 9) : (1) le bilan intelligent déterministe du personnel, (2) la file d'entrée unifiée de l'équipe, (3) les « prochaines étapes » côté client, (4) la traçabilité exploitable dans Comexa Space, (5) la sécurisation des fondations (tests de la politique d'espaces, vérification e-mail, secret transmis à n8n).

12. **Ordre recommandé** : sécuriser et tester les fondations (vague 0) → livrer le bilan personnel et la file d'entrée (vague 1) → clarifier le parcours client (vague 2) → seulement ensuite rentabilité et santé opérationnelle (vague 3). Ne pas lancer quatre chantiers à la fois.

---

## 2. Cartographie de l'application actuelle

### 2.1 Stack et déploiement

| Couche | Technologie constatée | Source |
| --- | --- | --- |
| Front | Next.js 16.4 (App Router, React 19, Turbopack), Tailwind 4, lucide-react, framer-motion, dnd-kit, react-big-calendar, recharts, TipTap, socket.io-client | `package.json` |
| Back | NestJS, Prisma 7 + PostgreSQL (`@prisma/adapter-pg`), class-validator, helmet, `@nestjs/throttler`, `@nestjs/schedule`, JWT + refresh tokens en cookie, Socket.IO, Mailjet/SMTP, stockage S3 ou local (local refusé en prod) | `backend/package.json`, `backend/src/app.setup.ts`, `render.yaml` |
| Données | 66 modèles Prisma, 25 migrations, suppression logique (`deletedAt`), références métier (`PRJ-`, `FAC-`, `DEV-`, `PRO-`…), multi-devises (DZD/EUR) sans conversion automatique | `backend/prisma/schema.prisma`, `backend/prisma/migrations/`, `README.md` |
| Clients lourds | Electron 44 (`desktop/`) avec store SQLite chiffré et file d'attente hors ligne (18 tests), WebView Android (`android/`) | `desktop/`, `android/` |
| Déploiement | API sur Render (plan **free**, mise en veille après 15 min), base Supabase, front Vercel, stockage S3 compatible | `render.yaml`, `docs/DEPLOIEMENT-RENDER-VERCEL.md` |

### 2.2 Architecture front

- **Site public** : `/`, `/services`, `/realisations`, `/partenaires`, `/contact`, `/espaces/apercu`, `/refonte-apercu` (page de démonstration avec données simulées, utilisée comme vitrine de la charte).
- **Authentification** : `/inscription`, `/verify-email`, `/connexion`, `/mot-de-passe-oublie`, `/reset-password`, `/espaces` (hub de sélection d'espace, entrée des apps desktop/Android).
- **Quatre espaces** : `/espace-personnel` (8 pages), `/espace-equipe` (28 pages), `/espace-comexa` (10 pages), `/espace-client` (10 pages). Chaque `page.jsx` est le plus souvent un **mince wrapper** vers un composant métier — la logique vit dans `src/components/`.
- **Coque unique** : `src/components/softui/Shell.jsx` (1 230 lignes) reçoit `area`, `title`, `groups`, `dockEnd`. `WorkspaceShell.jsx` est l'adaptateur ; `SpaceLayout.jsx` ajoute `RequireSession`, `SpaceScopedAuth` (droits réduits + en-tête `X-Comexa-Space`), `TimerProvider`, `FocusProvider`, `AiAgentDrawer`.
- **Navigation déclarative** : `src/lib/space-navigation.js` (une seule source pour layouts, coque, palette de commandes), `src/lib/spaces.js` (miroir local de la politique serveur + mémorisation du dernier espace), `src/lib/access.js` (`homeFor`, `allowedPath`).
- **CSS** : 11 feuilles, ~570 Ko. `softui.components.css` (173 Ko, coque + composants), `softui.productivity.css` (51 Ko, tâches/calendrier/focus), `comexa.responsive.css` (30 Ko, adaptations), `workspace-shell.css` (97 Ko, coque historique). Le design system « soft UI pastel dans une coque noire » est décrit dans `docs/REFONTE-SOFTUI.md`.
- **États** : `Alert`, `Notice`, `Empty`, `SkeletonList`, `Pagination`, `ConfirmDialog`, `SideSheet`, `Dialog` (piège à focus, Échap, restitution du focus — `useDialogBehavior.js`), notifications temps réel (`use-realtime-notifications.js`, `LiveNotification.jsx`).

### 2.3 Architecture back

- 43 contrôleurs dans `backend/src/modules/*` : auth, users, roles, spaces, tasks, goals, timer, time-entries, calendar, daily-reports, dashboard, projects, milestones, activity, prospects, clients, contacts, quotes, invoices, payments, orders, project-requests, documents, messaging, notifications, reports, distributions, balances, currencies, exchange-rates, content, audit, integrations, telegram, pdf, settings, health.
- **Garde unique** : `backend/src/common/guards/access.guards.ts` — « tout est fermé par défaut », vérification du jeton, chargement du porteur, puis `applySpace()` qui lit `X-Comexa-Space`, refuse 400 si valeur inconnue, 403 si espace interdit, et calcule les **permissions effectives**.
- **Portées** : `AccessPolicy` (`common/auth/principal.ts`) impose `resource:action:scope` avec scopes `any / own / assigned / personal / team / client`. Chaque service filtre ses lignes en base.
- **Politique d'espaces** : `common/spaces/space-policy.ts` — `personal`, `team`, `comexa`. Un espace ne fait que **retirer** des droits (`PERSONAL_KEEP`, `PERSONAL_DOWNGRADE`, `COMEXA_ONLY`, `PERSONAL_ONLY`) ; il ne peut jamais en donner. `/me/spaces` expose la liste et les droits effectifs.
- **Rôles** : 7 codes stables (`ADMIN`, `COMMUNICATION_MANAGER`, `PROJECT_MANAGER`, `DEVELOPER`, `SOCIAL_MEDIA_MANAGER`, `SALES`, `CLIENT`) dans `RoleCode`, avec catalogue de permissions `common/auth/permissions.catalogue.ts` (~600 lignes).
- **Séparation privé / équipe** : au niveau des **lignes**, pas seulement de l'UI. `Task.isPersonal`, `Goal.ownerId`, `GoalTask.ownerId`, `CalendarEvent.visibility`, `tasks.service.ts:332-339` (filtre `assigneeId`), `task-access.service.ts:59-66` (une tâche personnelle n'est lisible que par son propriétaire), `tasks.service.ts:755-757` (aucune notification pour une tâche privée).
- **Sécurité complémentaire** : audit (`AuditService`, `redact.ts`), idempotence, jetons d'intégration `cxi_` à portées limitées et révocables, hachage Argon2, verrouillage après échecs, rate limiting, en-têtes helmet, CORS sur liste blanche, cookie `SameSite=lax`.

### 2.4 Modèle de données — les relations qui portent les parcours

| Parcours | Modèles impliqués | Ce qui est déjà automatique |
| --- | --- | --- |
| Visiteur → prospect → client | `ContactRequest` → `Prospect` → `LeadStatusHistory` → `Client` / `Contact` | `contact-request-conversion.controller.ts` et `prospects.service.ts:536-631` : conversion transactionnelle, référence `PRO-`, historique d'étapes, activité visible du client. |
| Devis → projet | `Quote` / `QuoteItem` → `Project` (`quoteId` unique) | `quotes.service.ts:715-880` : l'acceptation crée le projet, convertit le prospect si besoin, fige le devis, notifie l'équipe, trace `QUOTE_ACCEPTED`. |
| Devis → facture → paiement | `Quote` → `Invoice` / `InvoiceItem` → `Payment` | `invoices/quote-invoice.controller.ts` : lignes copiées, totaux recalculés, aucun montant accepté dans le corps. `invoice-overdue.service.ts` : cron horaire de relance des impayés. |
| Commande de pack → projet | `Order` / `PackageRate` / `ProjectRequest` | `orders.service.ts:320-338` : à la première commande, création de la fiche `Client` et attribution du rôle `CLIENT`. |
| Tâche → temps → répartition | `Task` → `TimeEntry` / `TimerSession` → `ProjectDistribution` / `BalanceTransaction` | Le minuteur est **serveur** (`TimerSession.accumulatedSeconds`) ; la répartition est calculée en décimaux exacts, versionnée, jamais recalculée sur une ligne appliquée. |
| Client ↔ équipe | `ModificationRequest`, `Conversation` / `Message` / `MessageResource` / `MessageReadReceipt`, `Document`, `Activity.isClientVisible` | Accusés de lecture, ressources partagées citées dans les messages, documents filtrés par visibilité, décision d'agence avec motif visible du client. |

### 2.5 Flux utilisateurs réels (reconstitués depuis le code)

**Membre d'équipe, matin** : `/connexion` → `homeFor()` (`src/lib/access.js:140-146`) → dernier espace mémorisé ou `/espace-equipe/tableau-de-bord` → `ControlCenter.jsx` (1 153 lignes : KPI, points d'attention, « À suivre », activité récente, minuteur) → `/espace-personnel/tableau-de-bord` pour « Ma journée ». Le sélecteur d'espace envoie `X-Comexa-Space` sur chaque requête.

**Client, réception d'un devis** : notification `QUOTE_SENT` → `/espace-client` (`page.jsx:120-151`) carte « Devis en attente de votre décision » → `/espace-client/devis/[id]` → bouton « Accepter » → confirmation en 2 temps → `POST /quotes/:id/accept`. Si `validUntil` est dépassé, `assertNotExpired()` refuse en 422 (`quotes.service.ts:1169-1178`) et la page affiche « contactez l'agence pour un nouveau devis ».

**Commercial, nouveau projet** : `/espace-equipe/contacts` (demande site) → « convertir en prospect » → `/espace-equipe/prospects` (pipeline) → devis → envoi → acceptation client → projet créé automatiquement → `/espace-equipe/projets/[id]` (jalons, tâches, activité) → `/espace-equipe/temps` → facture.

**Administrateur** : `/espace-comexa/tableau-de-bord` (`ComexaOverview.jsx`) → `/membres` (création, rôles, suspension), `/roles` (matrice de permissions), `/integrations` (jetons, portées, expiration, révocation), `/journal` (audit), `/parametres` (identité, configuration avancée, préférences de temps), `/contenu` (site public).

### 2.6 États, erreurs, tests

- Les composants récents (`PersonalDashboard`, `ControlCenter`, `ComexaOverview`, `FacturesClientPage`) distinguent correctement **chargement / vide / erreur** avec `SkeletonList`, `Empty`, `Alert`/`Notice`, dédupliquent les erreurs et masquent les blocs refusés en 403.
- Les pages d'administration plus anciennes (`journal`, `membres`, `roles`, `modifications`) utilisent des états plus frustes (`<p className="cx-small">Chargement…</p>`), mais restent corrects.
- `ApiContractBanner` compare la version du contrat API (`/api/health`) au frontend et affiche un diagnostic si le backend est périmé — bonne pratique, testée (5/5).
- **Lacune de tests** : aucun test pour `space-policy.ts`, aucun test de parcours front (E2E), aucun test des services métier autres que la suppression de documents (non exécutable ici). Les 18 tests desktop couvrent bien le mode hors ligne, pas les règles d'autorisation.

---

## 3. État réel des quatre espaces

Les noms ont été vérifiés dans le code : **Espace personnel**, **Espace équipe**, **Comexa Space**, **Espace client**. Un cinquième écran, `/espaces`, est un **hub de sélection**, pas un espace métier.

### A. Espace personnel — `src/app/(session)/espace-personnel/`

**Présent et fonctionnel**
- « Ma journée » (`components/dashboard/PersonalDashboard.jsx:1-359`) : KPI (tâches ouvertes, retards, temps saisi, rendez-vous), 6 tâches prioritaires triées, agenda 7 jours, minuteur, objectifs, bandeau « rapport du jour ».
- Tâches personnelles + tâches de projet assignées dans **une seule liste** (`components/workspace/PersonalWorkspace.jsx:1-696`), vues « À faire / Aujourd'hui / En retard / Terminées », filtres par nature, lien profond `?tache=<id>`, modifications optimistes.
- Saisie rapide (`components/tasks/TaskComposer.jsx:95-193`) : titre + Entrée, objectif, « Aujourd'hui / Demain », date, priorité, estimation (15 min à 4 h).
- Objectifs (`Goal`, `GoalTask`, `goals.controller.ts`) privés, avec progression calculée et compte à rebours (`components/goals/GoalParts.jsx`).
- Calendrier privé/partagé (`CalendarEvent`, `components/calendar/CalendarWorkspace.jsx`) avec vues mois/semaine/jour/agenda.
- Temps (`/temps`), rapports journaliers (`/rapports-journaliers`), notifications, compte.
- Mode concentration (`components/focus/*`, `TimerSession`) : décompte serveur, reprise après rechargement, note, « ne pas déranger », bilan de fin de session.
- Minuteur serveur partagé avec l'équipe : le temps de concentration devient une `TimeEntry` cohérente avec la feuille de temps.

**Perfectible**
- `TaskComposer` demande de cliquer sur 4 contrôles pour une tâche datée et estimée : pas de saisie en langage naturel (« réviser chapitre 3 demain 2h !haute »).
- Le bilan de `FocusOverlay` s'arrête à la session ; rien ne relie les sessions entre elles ni à la semaine.
- Les objectifs affichent une progression, mais aucune alerte « objectif en retard » ni replanification.
- Aucune notion de **charge du jour** : `estimateMinutes` est collecté mais jamais comparé au temps réellement disponible (agenda) ou au temps passé.
- Actions « terminer », « reporter », « démarrer le minuteur » demandent d'ouvrir le détail ou de viser un petit bouton : usage à une main perfectible.

**Incomplet / défectueux**
- `TASK_DUE_SOON` : déclaré (`schema.prisma:232-249`), routé vers l'espace personnel (`space-policy.ts:311`), libellé (`notification-map.js:23`), mais **jamais créé par le backend**. Seul `refonte-apercu/ApercuExtras.jsx:84` en simule une.
- `DailyReport` est un `contentJson` libre + résumé 280 caractères (`daily-reports.service.ts:92-99`) : aucune donnée calculée, aucune comparaison prévu/réel.

**Absent**
- Bilan prévu vs réel, détection des reports successifs, estimation apprise de l'historique, planification réaliste, gestes tactiles (glisser pour terminer/reporter), widgets hors application (desktop/Android existent mais n'exposent pas « Ma journée »).

**Risque**
- Les données nécessaires au bilan existent déjà (`AuditLog` trace `TASK_UPDATED` avec `after.dueDate`, `tasks.service.ts:687-693`) : le risque est de construire une IA générique alors qu'une requête SQL suffit.

### B. Espace équipe / Business — `src/app/(session)/espace-equipe/`

**Présent et fonctionnel** : 28 pages. Prospects (pipeline), contacts, clients, demandes de projet, devis (création, détail, PDF, envoi), factures, paiements, commandes, projets (jalons, santé, activité), tâches (Kanban), calendrier d'équipe, suivi du temps, rapports journaliers, messagerie, demandes de modification, analytique 30 jours, rapports générés, répartition & soldes (moteur financier transactionnel et versionné).

**Perfectible**
- Les entrées arrivent par **quatre files distinctes** (`/contacts`, `/demandes`, `/modifications`, `/messagerie`) sans vue consolidée, sans responsable de tri, sans « snooze ».
- Le Kanban (`taches/page.jsx:155-157, 321-328`) ne déclare que `PointerSensor` + `KeyboardSensor` ; aucun `TouchSensor` et aucune règle `touch-action` dans les CSS : le glisser-déposer au doigt est fragile, et il n'existe pas de sélecteur de statut alternatif sur mobile.
- `/analytique` affiche des heures et des tâches sur 30 jours ; rien ne relie le temps saisi au prix de vente, au coût d'un membre ou à une marge.
- Les formulaires de création (tâche, devis, rapport) utilisent des largeurs fixes (`!w-[340px]`, `!w-[240px]`, `!w-[220px]`) ; ils sont dans des conteneurs `flex-wrap`, donc ça passe, mais une vérification réelle à 360 px reste à faire.
- `ControlCenter.jsx` (1 153 lignes) charge de nombreuses listes en parallèle ; sur un réseau mobile lent, la quantité de requêtes est un risque de perception de lenteur (hypothèse à mesurer).

**Incomplet / défectueux**
- Expiration des devis : `assertNotExpired()` bloque l'acceptation après la date, mais aucun rappel n'est émis avant l'échéance (le seul cron du dépôt concerne les factures impayées).
- Les notifications `INVOICE_OVERDUE` existent ; `QUOTE_SENT`, `PROJECT_STATUS_CHANGED` aussi ; il n'existe pas d'équipe « devis sans réponse depuis X jours ».

**Absent**
- File d'entrée/triage, coût horaire ou taux de revient par membre, budget/marge par projet, alertes de dépassement de budget, affectation en masse, modèles de projets/tâches, vue charge/capacité de l'équipe.

**Risque**
- La répartition des revenus (`DistributionConfig`, `BalanceTransaction`) calcule qui touche quoi, mais **pas si le projet est rentable**. Confondre les deux conduirait à des décisions commerciales fausses.

### C. Comexa Space — `src/app/(session)/espace-comexa/`

**Présent et fonctionnel** : vue d'ensemble (`ComexaOverview.jsx` : membres actifs/invités, jetons actifs et proches de l'expiration, entrées d'audit sur 7 jours, contenus publiés), contenu du site public (services, packs, témoignages, partenaires, FAQ, réalisations), membres (création, rôles, suspension, réinitialisation de mot de passe confirmée), rôles et permissions (matrice, ADMIN verrouillé), intégrations (création de jeton avec portées, secret affiché une fois, renouvellement, révocation, suppression, confirmations), journal d'audit, paramètres (identité, configuration avancée, préférences de saisie du temps), notifications.

**Perfectible**
- Journal d'audit (`journal/page.jsx:36-108`) : filtres limités à action/type/période, colonnes date/auteur/action/type/adresse. Ni `entityId`, ni `before`/`after`, ni filtre par porteur ou objet — alors que l'API les fournit.
- Rôles (`roles/page.jsx:44-78`) : grille à deux colonnes sur desktop, mais aucune simulation « que voit ce rôle ? » ; l'ADMIN est protégé côté API, ce qui est bien.
- Intégrations (`integrations/page.jsx`, 952 lignes) : très complet, mais la page cumule création, liste, édition, confirmations et secret en un seul écran long.
- Paramètres (`parametres/page.jsx`, 626 lignes) : « configuration avancée » avec clés techniques ; le libellé dit lui-même qu'elles ne produisent un effet que si un module les utilise (risque de réglage illusoire).

**Incomplet / défectueux**
- Aucune vue de **santé opérationnelle** : `/api/health` (DB + contrat) est public, mais l'administrateur ne voit pas l'état du mail, du stockage S3, du cron de relance, des erreurs récentes, ni la version du contrat déployé.
- Aucun indicateur « dernière utilisation d'un jeton » ou « jetons jamais utilisés ».

**Absent**
- Simulation de permissions, détection de configuration incohérente (rôle sans accès, membre sans rôle), alertes d'expiration de jetons dans l'interface (pourtant calculées dans `ComexaOverview`), export du journal, rétention documentée.

**Risque**
- Voir section 11 : secret de session transmis à n8n, vérification e-mail désactivée en production, absence de tests de la politique d'espaces.

### D. Espace client — `src/app/(session)/espace-client/`

**Présent et fonctionnel** : vue d'ensemble (4 KPI, devis à valider, projets avec progression, commandes avec étapes, demandes sur mesure, historique des devis), tableau de bord, projets (détail : progression, échéance, chef de projet, jalons, tâches visibles, documents téléchargeables), devis (détail + accepter/refuser en 2 temps avec motif), factures (liste, soldes, PDF), commande de pack, demandes de modification (dépôt + suivi + réponse de l'agence), messagerie, notifications, compte.

**Perfectible**
- `/tableau-de-bord/page.jsx` (56 lignes) affiche `DataView` sur `/dashboard/client` : le composant générique devine les libellés à partir des clés JSON (`labelOf`, `formatValue`). Résultat lisible pour un développeur, peu pour un client.
- La vue d'ensemble (`page.jsx`) est bonne mais **descriptive** : elle montre ce qui existe, pas ce qui est attendu du client.
- `/projets/[id]/page.jsx` : jalons et documents, mais aucun **fil d'activité** (`ActivityService.listForProject(..., { asClient: true })` existe côté backend, `activity.service.ts:142-152`) et aucune explication des statuts.
- Responsive : les cartes de devis/factures utilisent `flex-wrap`, les tableaux de lignes de devis deviennent des cartes labellisées — correct.

**Incomplet / défectueux**
- **Supplément de modification** : l'agence peut proposer `extraCost` avec une décision `APPROVED` (`espace-equipe/modifications/page.jsx:73-129`), le client voit le montant et la note (`espace-client/modifications/page.jsx:82-91`) mais ne peut ni l'accepter ni le refuser dans l'interface ; le DTO de décision n'accepte que `APPROVED`/`REJECTED` et porte `modificationrequest:decide:any` (agence). La boucle de validation est donc incomplète.
- Aucune indication des moyens de paiement (RIB, CCP, BaridiMob, virement) dans l'espace client : la facture est consultable/PDF, mais le client ne sait pas **comment** payer.
- Devis expiré : message « contactez l'agence », sans bouton de demande de renouvellement ni lien vers la messagerie.

**Absent**
- Tâches/actions côté client (« valider la maquette », « fournir les accès »), jalons avec dates et état explicité, notifications expliquant la prochaine étape, accusé de réception des documents, parcours de paiement.

---

## 4. Tableau des fonctionnalités existantes et de leurs lacunes

| # | Fonctionnalité | Espace | État vérifié | Lacune précise | Fichiers |
| --- | --- | --- | --- | --- | --- |
| 1 | Cockpit quotidien | Personnel | Présent | Pas de confrontation charge/temps disponible | `dashboard/PersonalDashboard.jsx:44-183` |
| 2 | Saisie rapide | Personnel | Présent | 4 contrôles pour date + estimation ; pas de langage naturel | `tasks/TaskComposer.jsx:130-184` |
| 3 | Objectifs | Personnel | Présent | Progression seulement ; pas d'alerte d'échéance ni de replanification | `goals/goals.controller.ts`, `goals/GoalParts.jsx` |
| 4 | Mode concentration | Personnel | Présent | Bilan de session, pas de bilan de semaine | `focus/FocusOverlay.jsx:437+`, `timer/timer.service.ts` |
| 5 | Rapports journaliers | Personnel/Équipe | Présent | JSON libre + résumé ; aucune mesure calculée | `daily-reports.service.ts:92-99`, `schema.prisma:2855-2870` |
| 6 | Rappel d'échéance | Personnel | **Incomplet** | Type `TASK_DUE_SOON` jamais émis | `schema.prisma:232`, `space-policy.ts:311`, `notification-map.js:23` |
| 7 | Kanban tâches | Équipe | Présent | DnD sans `TouchSensor`/`touch-action`, pas d'alternative tactile | `espace-equipe/taches/page.jsx:155-157, 321-328` |
| 8 | Flux devis → projet | Équipe | Présent | Expiration bloquante sans alerte amont | `quotes.service.ts:715-880, 1169-1178` |
| 9 | Relance impayés | Équipe | Présent | Seul cron du dépôt ; rien pour devis/échéances/jalons | `invoices/invoice-overdue.service.ts:103` |
| 10 | Suivi du temps | Équipe | Présent | Non relié à un coût ni à un budget projet | `time-entries/*`, `espace-equipe/temps/page.jsx` |
| 11 | Répartition & soldes | Équipe | Présent | Calcule la distribution du revenu, pas la rentabilité | `README.md` § Répartition, `distributions/*` |
| 12 | File d'entrée | Équipe | **Absente** | 4 files séparées, aucune priorisation | `space-navigation.js:48-92` |
| 13 | Journal d'audit | Comexa | Présent mais pauvre | `entityId`, `before`, `after`, filtres `actorId`/`entityId` non exploités côté UI | `audit/audit-log.service.ts:43-102`, `espace-comexa/journal/page.jsx:36-108` |
| 14 | Jetons d'intégration | Comexa | Présent | Pas de durée de vie maximale imposée ni de dernière utilisation | `espace-comexa/integrations/page.jsx:693+` |
| 15 | Santé plateforme | Comexa | **Absente** | `/api/health` public non repris dans l'admin | `health/health.controller.ts`, `ComexaOverview.jsx` |
| 16 | Vérification e-mail | Plateforme | Code présent | Désactivée en production | `render.yaml:79-80`, `auth.service.ts:374-455` |
| 17 | Console IA | Transverse | Présent | Transmet le JWT complet à un webhook externe | `api/agent-chat/route.js:81-96`, `AiAgentDrawer.jsx:21-24` |
| 18 | Tableau de bord client | Client | Présent | `DataView` générique, aucune action prioritaire | `espace-client/tableau-de-bord/page.jsx`, `DataView.jsx` |
| 19 | Suivi projet client | Client | Présent | Pas de fil d'activé ni de « prochaine étape » | `espace-client/projets/[id]/page.jsx`, `activity.service.ts:142-152` |
| 20 | Demande de modification | Client/Équipe | Présent | Supplément proposé non validable par le client | `modifications/page.jsx:73-129`, `modification-request.dto.ts` |
| 21 | Paiement client | Client | Partiel | PDF + solde, aucune consigne de paiement ni paiement en ligne | `espace-client/factures/page.jsx:116-123` |
| 22 | Tests de la politique d'espaces | Plateforme | **Absent** | Commentaire annonce des tests, aucun fichier ne les contient | `space-policy.ts:1-30`, `find . -name '*.test.*'` |

---

## 5. Audit responsive détaillé

### 5.1 Ce qui est déjà solide (et qu'il ne faut pas casser)

| Mécanisme | Détail vérifié | Fichier |
| --- | --- | --- |
| Barre d'onglets mobile | 3 rubriques + Compte + « Plus » (tiroir de toutes les rubriques et des espaces). Toujours dans le DOM, révélée par CSS, y compris en paysage. | `softui/Shell.jsx:717-758` |
| Tiroir de navigation | `role="dialog"`, `aria-modal`, groupes, actions rapides, sélecteur d'espaces. | `Shell.jsx:836-974` |
| Rail / panneau de suivi | Rail masqué < 1024 px, `AdminDesk` passe en tiroir < 1024 px et se resserre < 1280 px. | `softui.components.css:3786-3810` |
| Tableaux | `.sui-table` et `.cx-stack-table` deviennent des cartes avec libellés `data-label` sous 767 px ; les `minWidth` en ligne sont neutralisés (`min-width: 0 !important`). | `comexa.responsive.css:638-735` |
| Container queries | `.sui-main__scroll` est un conteneur ; grilles KPI 1/2/4 colonnes et `.sui-split` 1/2 colonnes selon la largeur **du contenu**, pas de la fenêtre. | `softui.components.css:533-552, 618-628` |
| Calendrier | Sous 767 px, vue « agenda » par défaut (`CalendarWorkspace.jsx:194, 212`), grille semaine/jour avec `min-width: 560px` + défilement horizontal contenu. | `CalendarWorkspace.jsx`, `comexa.responsive.css:975-985` |
| Focus | Préréglages sur une seule ligne sur téléphone pour garder l'action principale sous le pouce. | `softui.components.css:7242-7254` |
| Dialogues | Portail, piège à focus, Échap, restitution du focus, pieds de dialogue empilés < 560 px. | `Dialog.jsx`, `useDialogBehavior.js`, `softui.components.css:2755-2764` |
| Cibles tactiles | Icônes de l'appbar 40-42 px, badge, zone élargie du minuteur. | `comexa.responsive.css:202-260` |
| Accessibilité | `:focus-visible` global sur coque/rail/dock/tabbar, `prefers-reduced-motion`, `prefers-reduced-transparency`, contraste pastel/texte noir. | `softui.components.css:3754-3775`, `workspace-shell.css` |
| Zones de sécurité mobile | `SafeAreaSync.jsx`, `safe-area.mjs`, media queries `max-height` + orientation paysage. | `src/components/SafeAreaSync.jsx`, `comexa.responsive.css` |

Ces mécanismes sont décrits et justifiés dans la documentation interne du dépôt (`docs/REFONTE-SOFTUI.md`, `docs/dashboard-design-audit.md`, `README.md`) **[S29]**.

**Conclusion : le produit n'a pas besoin d'une « refonte responsive ».** Les propositions ci-dessous doivent **réutiliser** la coque, les classes `sui-*` et les container queries existantes ; toute nouvelle page qui introduit son propre `overflow-x: auto` sans `data-label` créera une régression par rapport à l'existant.

### 5.2 Grille des cinq points de contrôle

| Contexte | Comportement actuel vérifié | Risques résiduels | Parcours les plus exposés |
| --- | --- | --- | --- |
| **360 px (téléphone compact)** | Tabbar 5 entrées, contenu 1 colonne, KPI 1 colonne, tableaux en cartes, padding 16 px, règles spécifiques `max-width: 380/360/340 px`. | Champs de filtres fixes (170-240 px) empilés mais encore larges ; un libellé long + un `select` peuvent occuper tout l'écran. Deux actions côte à côte dans un pied de dialogue deviennent pleine largeur (déjà prévu). | Filtres admin (`journal`, `membres`, `rapports`), formulaire « Nouveau devis », décision de modification. |
| **390 px (téléphone courant)** | Idem, marge supérieure. | Mêmes risques, atténués. Le panneau de suivi est un tiroir plein écran : risque de perte de contexte entre la liste et le détail. | Tâches personnelles → détail, messagerie. |
| **768 px (tablette portrait)** | **Zone charnière** : ce n'est plus le mobile (navbar réapparaît, rail masqué, bouton « rubriques » compact), mais le contenu reste ≤ ~730 px → `.sui-split` reste en 1 colonne, les KPI en 2. | Le calendrier n'est plus en vue agenda (le seuil est 767 px) alors que la largeur disponible est encore limitée ; risque de semaine illisible. Les tableaux sont encore des cartes (seuil 767 px) → beaucoup de défilement vertical pour peu de données. | Calendrier d'équipe, listes de factures/devis, dashboards. |
| **1024 px (tablette paysage)** | Rail visible à nouveau, `AdminDesk` en tiroir (< 1024 strict), navbar complète, `.sui-split` en 2 colonnes au-delà de 860 px de conteneur. | Le croisement entre media queries (fenêtre) et container queries (contenu) peut donner un panneau de suivi en tiroir alors que la grille est déjà en 2 colonnes : densité irrégulière selon l'état du rail. | ControlCenter + panneau de suivi, projets. |
| **1440 px (ordinateur)** | Rail + navbar + dock + panneau de suivi inline, `.sui-split` 2 colonnes, tableaux complets. | Peu de risques. Attention au `max-width: 1400px` de `.sui-canvas-inner` : sur écran très large, l'espace reste vide (choisi et documenté). | Aucun critique. |

### 5.3 Problèmes précis et composants concernés

| # | Problème | Composant / fichier | Correction recommandée (sans coder ici) |
| --- | --- | --- | --- |
| R1 | **Kanban : drag & drop au doigt fragile.** `PointerSensor` avec distance 6 px, aucun `TouchSensor`, aucune règle `touch-action` sur les cartes. Le navigateur peut interpréter le geste comme un défilement. | `espace-equipe/taches/page.jsx:155-157, 321-328` ; aucune règle `touch-action` trouvée dans les 11 feuilles CSS (seule `touch-action: manipulation` globale à `comexa.responsive.css:72`) | Ajouter un capteur tactile dédié, `touch-action: none` sur la poignée uniquement, et surtout un **sélecteur de statut** dans le détail de la tâche : changer de colonne doit rester possible sans glisser. |
| R2 | **Calendrier en tablette portrait.** Le seuil « agenda » est `max-width: 767px` (`CalendarWorkspace.jsx:194`), donc 768 px affiche une semaine/jour `min-width: 560px` dans ~700 px de contenu. | `CalendarWorkspace.jsx:194-213`, `comexa.responsive.css:975-985` | Piloter la vue par **container query** sur `.sui-cal__main` plutôt que par largeur de fenêtre ; proposer un sélecteur explicite Mois/Semaine/Agenda visible en permanence. |
| R3 | **Filtres d'administration à largeur fixe.** `!w-[200px]`, `!w-[180px]`, `!w-[170px]`, `!w-[240px]` dans des formulaires `flex-wrap`. | `espace-comexa/journal/page.jsx:43-75`, `membres/page.jsx:146-157`, `espace-equipe/rapports/page.jsx:138-152`, `modifications/page.jsx:29` | Remplacer par `w-full sm:w-[…]` ou `min-w-0 flex-1` ; sur 360 px, un filtre = une ligne, boutons « Appliquer/Réinitialiser » collés en bas, accessibles au pouce. |
| R4 | **Tableau de bord client = données brutes.** `DataView` devine des libellés et produit jusqu'à 7 colonnes ; sur mobile chaque ligne devient une carte, mais le sens métier reste obscur. | `espace-client/tableau-de-bord/page.jsx`, `DataView.jsx:110-143` | Remplacer par 3 cartes d'action (« Devis à valider », « Facture à régler », « Prochaine étape ») + liens profonds. Le `DataView` reste utile pour les rapports générés, pas pour l'accueil client. |
| R5 | **Panneau de suivi en tiroir < 1024 px.** Le tiroir couvre le contenu ; aucun état « liste + détail » partagé visible simultanément en tablette portrait. | `Shell.jsx:599-641, 760-768`, `softui.components.css:3793-3810` | En tablette paysage, autoriser un panneau redimensionnable (ou un onglet « Détail ») plutôt qu'un voile plein écran ; conserver le tiroir en portrait. |
| R6 | **États de chargement hétérogènes.** Certaines pages récentes utilisent `SkeletonList`, d'autres un simple `<p>Chargement…</p>` ; en mobile, le passage du texte au tableau provoque un saut de mise en page. | `espace-comexa/journal/page.jsx:78`, `membres/page.jsx`, `roles/page.jsx:47` | Uniformiser avec `SkeletonList` et réserver la hauteur des cartes. |
| R7 | **Absence de gestes à une main dans l'espace personnel.** Terminer/reporter une tâche demande de viser une case ou d'ouvrir un panneau. | `PersonalTaskRow.jsx:67-90`, `TaskCheck.jsx` | Swipe gauche/droite sur la ligne (terminer / reporter à demain) avec confirmation visuelle et `aria-live`, en gardant les boutons pour l'accessibilité clavier. |
| R8 | **Aucune vérification navigateur réelle dans cet audit.** Les recettes multi-résolutions de `docs/dashboard-design-audit.md` datent de la direction « verre liquide », remplacée depuis par la charte soft UI ; le document lui-même dit qu'elles sont à rejouer. | `docs/dashboard-design-audit.md` § Vérifications | Rejouer une matrice 360/390/768/1024/1440 sur les 12 parcours critiques avant toute mise en production des propositions. |

### 5.4 Mini-spécification responsive à respecter pour toute nouvelle fonctionnalité

Toute proposition de la section 8 n'est considérée « prête à développer » que si elle précise :

1. **360/390 px** : une seule colonne ; action principale dans la barre mobile ou fixée en bas (zone pouce) ; aucun tableau horizontal ; les filtres dans un tiroir ou repliés ; cibles ≥ 44 px ; pas de saisie multi-champs sur une ligne.
2. **768 px portrait** : deux colonnes **uniquement si le conteneur dépasse 860 px** (sinon rester en une colonne) ; le panneau de détail reste un tiroir ; les actions secondaires passent dans un menu « … ».
3. **1024 px paysage** : rail visible, panneau de détail en tiroir ou inline selon la densité ; vérifier le croisement media/container queries ; pas de débordement horizontal.
4. **1440 px** : exploiter la largeur sans dépasser `max-width: 1400px` ; garder un seul `h1` ; recherche dans le bandeau, pas dans chaque carte.
5. **Transverse** : charger/erreur/vide avec la même hauteur réservée ; focus visible au clavier ; `prefers-reduced-motion` respecté ; aucun contenu métier uniquement accessible au survol ; tableaux avec `data-label` ; modales via `Dialog`/`useDialogBehavior`.

---

## 6. Étude concurrentielle sourcée, espace par espace

Toutes les pages officielles ci-dessous ont été consultées le **27/10/2026**. Les numéros renvoient à la section 13. Quand une information ne vient pas de l'éditeur, c'est indiqué.

### 6.1 Espace personnel — panel retenu

| Outil | Ce qui est vérifié | Pourquoi c'est pertinent pour Comexa | Limite observée |
| --- | --- | --- | --- |
| **Todoist** | Quick Add en langage naturel, dates récurrentes, rappels, vues Aujourd'hui/À venir, filtres, **objectifs quotidiens/hebdomadaires + visualisations de productivité + Karma** **[S1]**. Gratuit 5 projets, Pro 5 $/mois (annuel), Business 8 $/utilisateur/mois **[S2]**. | Le combo « saisie minimale + mesure des progrès » est exactement ce qui manque au bilan Comexa. | L'offre gratuite limite l'historique d'activité à 1 semaine et le calendrier est payant **[S2]**. Pas de DZD dans la liste des devises de la page de tarifs **[S2]**. |
| **TickTick** | Tâches + calendrier + **matrice d'Eisenhower + Pomodoro + suivi d'habitudes** dans un seul produit **[S3][S4]** ; vues multiples (année, mois, semaine, agenda, multi-semaine) **[S4]**. | Montre qu'une matrice de priorisation et un minuteur peuvent coexister sans complexifier l'écran. | Certaines vues et statistiques sont derrière l'abonnement Premium ; les prix relevés par des tiers varient (35,99 → 49,99 $/an selon la période) — à ne pas citer comme vérité officielle. |
| **Sunsama** | **Task Projections** : aperçu dynamique de la façon dont les tâches remplissent le temps disponible, en tenant compte des événements d'agenda et de l'heure de fin souhaitée ; verrouillage d'une plage, décalage automatique des autres tâches ; **estimation initiale apprise de l'historique** ; temps réellement passé affiché sur le calendrier **[S5]**. 22 $/utilisateur/mois, 204 $/an, 14 jours sans carte, et un manifeste qui refuse explicitement le « free forever » **[S6]**. | La meilleure réponse du marché à « planifier une charge réaliste » et « comprendre prévu vs réel ». Comexa a déjà `estimateMinutes`, `CalendarEvent` et `TimeEntry` : les données sont là. | Payant uniquement, cher pour un usage étudiant, dépend d'outils externes ; son manifeste est un choix de modèle économique, pas une vérité produit **[S6]**. |
| **Structured** | Timeline visuelle journalière, boîte de réception, glisser-déposer, sous-tâches, minuteur Pomodoro, widgets, Live Activities, accessibilité (VoiceOver, police dyslexie) **[S7][S8]**. Matrice officielle des fonctions gratuites/Pro **par plateforme** **[S7]**. | Référence pour le mobile une main et la lisibilité d'une journée ; la matrice par plateforme est un modèle d'honnêteté produit. | Le gratuit n'inclut ni tâches récurrentes, ni import d'agenda, ni « Replan » **[S7]**. Une revue tierce (09/10/2026) rapporte que Replan, l'import de rappels et certaines vues timeline manquent sur Android, et que le web reste en bêta **[S9]** — information non officielle, à pondérer. |

**Idées à écarter pour Comexa Personnel** : recopier Karma (gamification superficielle), ajouter un chatbot de planification (la console IA existe déjà et le besoin est un calcul, pas une conversation), construire un énième calendrier (celui du dépôt gère déjà 6 vues), ajouter un suivi d'habitudes complet (hors périmètre « travail/études », coût élevé pour un bénéfice incertain).

### 6.2 Espace équipe / Business — panel retenu

| Outil | Ce qui est vérifié | Pourquoi c'est pertinent | Limite observée |
| --- | --- | --- | --- |
| **Linear** | **Triage** : file d'entrée dédiée pour tout ce qui arrive par intégration ou d'une autre équipe ; actions *accepter / refuser / doublon / snooze* avec raccourcis ; responsabilité de tri tournante configurable **[S10]**. **Inbox** avec onglet « Priority », snooze, rappels programmables, actions directement depuis la notification **[S11]**. Apps natives + PWA, navigation mobile personnalisable **[S12]**. | Modèle direct pour la file d'entrée unifiée de Comexa et pour des notifications actionnables. | Triage est orienté « issues produit » ; l'automatisation avancée est réservée aux offres Business/Enterprise **[S10]**. À transposer, pas à copier tel quel. |
| **Productive** | Budgets à prix fixe / temps & matériel / récurrents, **cartes de taux par client**, suivi de la consommation budgétaire et du profit **en temps réel**, alertes de dépassement configurables, prévision de marge future **[S13]**. Essential 10 $/utilisateur/mois (annuel), Professional 25 $, 14 jours sans carte **[S14]**. | C'est le chaînon manquant entre le temps saisi et la rentabilité d'un projet Comexa. | Tarification par siège, 3 sièges minimum, pas d'offre gratuite **[S14]** ; complexité de paramétrage élevée. |
| **Teamwork.com** | **Utilisateurs clients gratuits** ne comptant pas dans l'abonnement, avec droits projet (tâches, jalons, fichiers, messages) mais **pas de rentabilité, ni d'administration, ni de charge de travail** **[S15]**. Workload Planner : capacité par personne, tâches non planifiées, répartition de capacité, vue semaine/mois **[S16]**. | Confirme qu'un client peut être invité dans l'outil **sans voir les marges** — exactement la frontière que Comexa doit maintenir. | Planificateur de charge indisponible aux clients et aux collaborateurs **[S16]** ; les paliers tarifaires varient selon les sources (officiel vs revues) — ne pas citer un chiffre unique sans re-vérifier. |
| **Odoo** | Flux documenté : **devis → commande créée automatiquement à l'acceptation → livraison → facture → paiement**, avec échéances sur les devis, signature en ligne et paiement en ligne pour confirmer **[S17]**. Multi-devises avec taux et écritures d'écart **[S17]**. | Valide le flux déjà implémenté par Comexa et donne des idées pour l'expiration des devis (échéance = incitation, pas seulement blocage). | ERP généraliste, lourd à déployer ; la personnalisation et l'hébergement ont un coût que Comexa n'a pas. |

**Idées à écarter** : reconstruire un CRM (prospects + historique d'étapes existent), une facturation (devis→facture→paiement existe), un moteur de workflows visuel type Zapier (coût disproportionné pour une équipe interne), ou une IA de tri (le triage de Linear fonctionne déjà très bien avec des règles simples **[S10]**).

### 6.3 Comexa Space — panel retenu

Il n'existe pas de « concurrent » direct d'un back-office propriétaire. La comparaison porte donc sur des **pratiques d'administration** vérifiables.

| Référence | Ce qui est vérifié | Leçon pour Comexa |
| --- | --- | --- |
| **Odoo — droits d'accès** | Rôles prédéfinis, groupes, droits CRUD par modèle, **règles d'enregistrement** (domaines) pour filtrer les lignes ; avertissement explicite : modifier les droits peut rendre « l'admin impuissant » (aucun utilisateur ne peut plus administrer) **[S18]**. | Un écran de rôles doit **prévenir les erreurs de configuration** et permettre de vérifier « que voit ce rôle ? ». Comexa protège déjà ADMIN côté API ; il manque la simulation et l'alerte. |
| **GitHub — journal d'audit** | Événements détaillés avec champs `actor`, `action`, `token_scopes`, `hashed_token`, `token_expires_at`, adresse IP, etc. **[S19]** ; rétention de 180 jours pour les événements web, 7 jours pour les événements Git **[S30]**. | Un journal utile dit **quel objet** a changé et **quelles valeurs**, pas seulement « qui a fait quoi ». Comexa a les données en base ; l'UI ne les montre pas. |
| **GitHub — jetons** | Expiration recommandée, révocation automatique à l'échéance, révocation après inactivité d'un an, révocation si un secret fuit dans un dépôt public **[S20]**. | Comexa gère déjà expiration, renouvellement et révocation ; il manque une **durée de vie maximale imposée** et un indicateur « dernière utilisation ». |
| **Health checks** | `/api/health` du dépôt interroge réellement la base (`SELECT 1`) et expose la version du contrat API (`health.controller.ts`). | Cette sonde est un atout : il suffit de la **reprendre dans l'admin** et de la compléter (mail, stockage, cron) au lieu d'acheter un outil externe. |

**Idées à écarter** : un SSO/SAML maison, une gestion fine de organisations (hors périmètre Comexa Portfolio, et le schéma n'a pas d'entité `Organization`), un tableau de bord d'observabilité tiers type Grafana.

### 6.4 Espace client — panel retenu

| Outil | Ce qui est vérifié | Pourquoi c'est pertinent | Limite observée |
| --- | --- | --- | --- |
| **HoneyBook** | Portail client 2.0 (20/02/2026) : **jalons, dates, tâches côté client, fichiers et informations clés affichés dès la page d'accueil** ; possibilité d'**assigner des tâches au client avec échéance** pour débloquer les validations ; activation/désactivation du portail par projet **[S21]**. | C'est la référence la plus directe à la question centrale de l'espace client : rendre l'attente explicite. | Le site officiel indique que le service est réservé aux professionnels **US, Canada, UK, Australie** (bandeau géo, consulté 27/10/2026) **[S21]**. L'app mobile iOS/Android est **réservée au prestataire** : les clients utilisent le web mobile **[S22]**. Donc : Comexa doit soigner son web mobile, pas rêver d'une app cliente. |
| **Assembly (ex-Copilot)** | Portail unifié : messages, fichiers, tâches, factures, contrats, formulaires, propositions, avec **étapes explicites du parcours client** (Onboard → Collaborate → Track → Transact → Support) et une page d'accueil configurable par client **[S23]**. Modèles prêts à l'emploi (collecte de documents, suivi de jalons, messagerie, facturation) **[S23]**. Plans gratuit puis 29/99/499 $/mois, jamais facturé **par client** **[S24]**. | Montre la valeur d'un parcours client raconté en étapes, et d'un portail où tout est lié à la fiche client — Comexa a déjà la fiche `Client`. | Le paiement repose sur **Stripe** et l'intégration → carte internationale ; une revue tierce (07/09/2026) indique l'absence d'app native et d'automatisations profondes **[S25]**. À noter : l'ancien domaine `copilot.com` redirige désormais vers Microsoft Copilot ; les pages officielles du produit sont sur `assembly.com`. Ne pas citer l'ancienne marque comme source vérifiable. |
| **Teamwork (client users)** | Clients invités gratuitement, peuvent créer/commenter des tâches et téléverser des fichiers, mais ne voient ni la rentabilité ni la charge de travail de l'agence **[S15]**. | Confirme le principe « donner de la visibilité sans exposer l'interne » — déjà respecté par `DocumentVisibility` et `isClientVisible` de Comexa. | Limite à 5 projets actifs par utilisateur client **[S15]** ; Comexa n'a pas cette limite. |

**Idées à écarter** : donner au client un Kanban interne, lui montrer les marges ou les temps de l'équipe, reproduire un espace de facturation complexe (il a déjà ses factures et ses soldes), construire une app mobile cliente native (le web mobile suffit, cf. **[S22]**).

### 6.5 Contraintes de coût, de mobile et de marché algérien

- **Devises** : Todoist affiche ses prix en USD/EUR/etc. mais **pas en DZD** sur sa page officielle **[S2]** ; Productive, Sunsama, Assembly et HoneyBook facturent en USD **[S6][S14][S24]**. Pour un utilisateur algérien, s'abonner suppose une carte internationale et subit le change — un avantage réel pour Comexa, qui gère déjà DZD/EUR, CCP et BaridiMob (`PaymentMethod`, `render.yaml`).
- **Paiement en ligne local** : Stripe/PayPal ne fonctionnent pas avec les cartes algériennes ; CIB et Edahabia via SATIM (passerelles SlickPay, Chargily, OneClick, CIBWeb) nécessitent un registre de commerce, un compte bancaire et 4 à 12 semaines d'activation **[S27][S28]**. Toute proposition de « paiement en ligne » doit donc être traitée comme un projet à part, pas comme un bouton.
- **Langue** : Comexa est intégralement en français. Plusieurs concurrents documentent surtout en anglais ; Structured propose plusieurs langues et une police adaptée à la dyslexie **[S7][S8]**. Ne pas perdre l'avantage linguistique.
- **Disponibilité** : HoneyBook exclut officiellement l'Algérie de ses pays supportés **[S21]**. C'est un argument de différenciation, pas une raison pour ajouter des fonctions « internationales ».
- **Repère de marché (hors périmètre de cette mission)** : l'étude ChartMogul / Kyle Poyar / ProductLed menée en janvier 2026 sur 200 produits B2B indique que 62 % des essais gratuits durent 14 jours et que la conversion médiane free→paid est de 8 % **[S26]**. Ce chiffre n'est utile que pour éclairer une éventuelle commercialisation future ; il ne doit pas orienter les priorités internes de Comexa Portfolio.
- **Mobile d'abord** : l'app HoneyBook côté client n'existe pas, le web mobile est la norme **[S22]** ; Linear mise sur une PWA + apps natives pour l'équipe **[S12]**. Comexa dispose déjà d'un hub mobile/desktop (`/espaces`) : c'est un atout à exploiter avant d'ajouter des canaux.

---

## 7. Matrice besoins / concurrents / opportunités

| Besoin utilisateur | Comexa aujourd'hui (vérifié) | Solution concurrente observée | Limite actuelle | Opportunité pour Comexa | Valeur attendue |
| --- | --- | --- | --- | --- | --- |
| Créer une tâche sans réfléchir à l'interface | `TaskComposer` : titre + 4 contrôles (objectif, date, priorité, estimation) | Todoist Quick Add en langage naturel **[S1]**, TickTick saisie vocale/rappels multiples **[S3]** | 4 gestes là où une phrase suffirait | Analyseur local de dates/priorités dans le champ titre | Temps de saisie divisé par ~3 ; plus de tâches correctement datées |
| Savoir si ma journée est réaliste | KPI « tâches ouvertes » + agenda 7 jours, sans croisement | Sunsama Task Projections + heure de fin **[S5]**, Teamwork Workload Planner **[S16]** | `estimateMinutes` collecté mais jamais comparé au temps libre | « Charge du jour » = somme des estimations vs créneaux libres de l'agenda | Moins de journées surchargées, meilleure confiance dans l'outil |
| Comprendre pourquoi je n'avance pas | Rapport journalier libre, bilan de session de concentration | Todoist objectifs + visualisations **[S1]**, Sunsama estimation apprise de l'historique **[S5]**, Structured Replan **[S7]** | Aucun calcul prévu/réel, aucun historique de report | Bilan hebdomadaire déterministe + détection des reports via `AuditLog` | L'utilisateur ajuste sa semaine ; effet rétention |
| Ne pas oublier une échéance | Notifications `TASK_ASSIGNED` ; `TASK_DUE_SOON` déclaré mais non émis | Todoist rappels **[S1]**, Linear snooze/reminders **[S11]** | Rappel d'échéance = fonctionnalité morte | Cron de rapprochement des `dueDate` avec idempotence | Moins de retards, confiance dans les notifications |
| Traiter les demandes entrantes sans les éparpiller | 4 files séparées (contacts, demandes, modifications, messagerie) | Linear Triage + responsabilité tournante **[S10]**, Inbox prioritaire **[S11]** | Aucune vue consolidée, aucune notion de « à traiter par X » | File d'entrée unifiée avec accepter / reporter / assigner | Une seule file à vider le matin ; délai de réponse réduit |
| Savoir si un projet est rentable | Temps saisi, factures, répartition des revenus | Productive budget/marge temps réel + alertes **[S13]** | Aucun coût par membre, aucun budget projet | Taux de revient optionnel + marge = facturé − coût du temps | Décisions de prix et de charge fondées sur des chiffres |
| Éviter qu'un devis meure sans réponse | Expiration bloquante côté client, relance impayés seulement | Odoo échéances de devis **[S17]**, Linear snooze **[S11]** | Aucun rappel avant l'expiration | Rappels J-3/J-1 à l'équipe + bouton « demander un renouvellement » côté client | Moins de devis perdus, moins d'allers-retours |
| Comprendre ce qu'on attend de moi (client) | KPI + listes, `DataView` brut sur le tableau de bord | HoneyBook jalons/tâches client en page d'accueil **[S21]**, Assembly étapes Onboard→Support **[S23]** | Aucune « prochaine étape », aucun fil d'activité client | Bloc « À faire de votre côté » + frise d'avancement lisible | Moins de messages « où en est mon projet ? » |
| Valider un supplément sans email | L'agence propose un `extraCost`, le client le lit | HoneyBook tâches de validation **[S21]**, Assembly approbations **[S23]** | Aucun geste d'acceptation/refus côté client | Statut d'acceptation du supplément, tracé | Décision tracée, démarrage plus rapide |
| Savoir si la plateforme fonctionne | `/api/health` public (DB + version du contrat) | Journaux d'audit détaillés GitHub **[S19][S30]** | Aucune vue admin de l'état mail/stockage/cron | Vue « Santé » dans Comexa Space | Incident détecté avant l'utilisateur |
| Comprendre une action sensible | Journal : date, auteur, action, type, IP | GitHub : `entityId`, `token_scopes`, avant/après **[S19]** | L'API a `entityId`/`before`/`after`, l'UI les ignore | Détail d'audit enrichi + filtres porteur/objet | Traçabilité réellement exploitable |
| Changer le statut d'une tâche avec un doigt | Kanban DnD `PointerSensor`, détail de tâche | Linear mobile : actions depuis l'inbox **[S11][S12]** | Pas de capteur tactile dédié, pas d'alternative | Sélecteur de statut + geste swipe sur mobile | Parité desktop/mobile réelle |

---

## 8. Améliorations et ajouts proposés

Chaque fiche précise : problème, utilisateur, état vérifié, solution, différence, source, valeur, impact, permissions, complexité, responsive et critères mesurables. Les prérequis sont indiqués sur la fiche quand ils existent et **consolidés en section 9.6** ; règle générale : toute proposition qui ajoute une permission dépend de **C1**, et toute proposition qui ajoute un rappel dépend de **C5/C6**. Les catégories suivent la demande : **Corriger / Améliorer / Ajouter**.

### Catégorie 1 — CORRIGER

#### C1 — Tests de la politique d'espaces et du garde d'accès
- **Espace** : transversal (sécurité des 4 espaces). **Priorité : P0.**
- **Problème** : `space-policy.ts` annonce des « fonctions pures, testées à l'unité » (`space-policy.ts:1-30`) ; la recherche sur tout le dépôt ne trouve **aucun test** référençant `effectivePermissions`, `canEnterSpace` ou `accessibleSpaces`. Or toute modification des rôles, des espaces ou des propositions ci-dessous touchera ce fichier.
- **Utilisateur** : tout le monde ; situation = un développeur modifie une permission et casse silencieusement la séparation privé/équipe.
- **État actuel** : garde `access.guards.ts:224-257` solide sur le principe, mais non couvert par des tests automatisés.
- **Solution** : suite `node:test` sur les fonctions pures : (a) aucun espace n'ajoute un droit absent du rôle ; (b) `personal` retire `task:read:personal` en équipe ; (c) un compte sans rôle n'entre dans aucun espace ; (d) valeur d'en-tête inconnue → 400 ; (e) non-rétrogradation des portées.
- **Différence** : passer d'une garantie documentée à une garantie exécutable. **Source concurrentielle** : Odoo documente le risque d'« admin impuissant » après modification des droits **[S18]**.
- **Valeur** : confiance avant tout refactoring. **Impact modules/données** : aucun (tests seulement). **Permissions/sécurité** : renforce la frontière la plus sensible. **Complexité : faible** (fonctions pures, pas de DB).
- **Responsive** : sans effet direct ; garantit que le filtrage des rubriques (mobile inclus) reste exact. **Prérequis** : aucun.
- **Critères** : ≥ 12 cas de test, 100 % des branches de `effectivePermissions` couvertes, exécutés en CI.

#### C2 — Activer la vérification e-mail et protéger l'inscription
- **État actuel** : le parcours de vérification est codé (`auth.service.ts`), mais la configuration de production le désactive ; l'inscription publique reste donc ouverte à des adresses non vérifiées.
- **Espace** : plateforme / Comexa Space. **Priorité : P0 (sécurité).**
- **Problème** : `render.yaml:79-80` fixe `EMAIL_VERIFICATION_REQUIRED: "false"` en production (« veille »). Le code de vérification existe et fonctionne (`auth.service.ts:374-455`, `verify-email`), mais n'est pas appliqué. Avec un formulaire public `/inscription`, cela autorise des comptes non vérifiés et du spam.
- **Utilisateur** : administrateur, et toute personne s'inscrivant.
- **Solution** : activer le flag une fois le domaine Mailjet validé ; ajouter une limitation spécifique à l'inscription (le rate limit global est 120/min), un CAPTCHA léger ou une preuve de travail, et journaliser les échecs d'envoi.
- **Différence** : la vérification devient effective au lieu d'être un code dormant. **Source** : configuration interne (`render.yaml`, `auth.service.ts`) ; pratique courante documentée par **[S20]** pour la réduction des accès non contrôlés.
- **Valeur** : moins de comptes jetables, moins d'abus. **Impact** : les comptes `INVITED` existants doivent être traités (réémission du lien). **Permissions** : aucune nouvelle permission.
- **Complexité : faible à moyenne** (configuration + tests d'envoi). **Responsive** : la page `/verify-email` doit rester lisible à 360 px, avec un bouton « renvoyer le lien » accessible au pouce et un message d'erreur non ambigu.
- **Critères** : 100 % des nouveaux comptes `INVITED` jusqu'à vérification ; 0 compte actif non vérifié ; test d'envoi Mailjet OK en préproduction.

#### C3 — Secret de session transmis au webhook n8n (risque documenté, non corrigé)
- **Utilisateur** : tout membre qui ouvre la console IA ; **Solution** : remplacer le JWT complet par une délégation à portées minimales et à courte durée, puis tracer les appels.
- **Espace** : Comexa Space / transverse. **Priorité : P0 — à traiter comme un risque, pas comme une fuite avérée.**
- **Problème** : `src/app/api/agent-chat/route.js:81-85` envoie le **JWT de session complet** dans `metadata.jwt` au webhook `N8N_AGENT_WEBHOOK_URL`. Le dépôt ne contient pas le workflow n8n : impossible de vérifier comment ce secret est stocké, journalisé ou retransmis. Un service tiers recevant un jeton de session peut agir avec **tous les droits de l'utilisateur** pendant sa durée de validité (`JWT_ACCESS_TTL: 15m` dans `render.yaml`).
- **État actuel** : la route refuse les jetons `cxi_`, exige une session, impose un timeout 60 s et garde l'URL secrète — de bonnes protections, mais le principe même du JWT complet vers un tiers reste une surface d'attaque.
- **Solution à étudier (hors périmètre de cet audit)** : remplacer par un jeton d'intégration dédié, à portées minimales et à courte durée, ou par une signature de requête sans secret réutilisable ; documenter contractuellement la non-conservation du jeton côté n8n ; ajouter une journalisation locale des appels.
- **Différence** : d'un secret réutilisable à une délégation limitée. **Source** : **[S20]** (expiration/révocation des jetons), **[S19]** (champs `token_scopes`/`hashed_token` dans les journaux).
- **Valeur** : réduction du risque d'usurpation de session. **Impact** : change le contrat avec le workflow n8n existant. **Permissions** : aucune nouvelle permission côté application.
- **Complexité : moyenne** (dépend d'un service externe non versionné). **Responsive** : sans effet sur l'UI ; la console IA doit afficher un état d'erreur clair sur mobile si la délégation échoue.
- **Critères** : aucun JWT de session ne quitte le domaine Comexa ; test de non-régression sur `/api/agent-chat`.

#### C4 — Kanban : changer le statut d'une tâche sans glisser-déposer
- **Espace** : Équipe. **Utilisateur** : chef de projet sur téléphone, ou toute personne utilisant le clavier.
- **Problème** : `espace-equipe/taches/page.jsx:155-157` ne déclare que `PointerSensor` (distance 6 px) et `KeyboardSensor` ; aucune règle `touch-action: none` sur les cartes. Sur navigateur mobile, le geste peut être volé par le défilement.
- **État actuel** : le drag fonctionne avec une souris ; le détail d'une tâche permet certaines transitions, mais aucun sélecteur de colonne explicite n'est visible dans le parcours mobile.
- **Solution** : (1) ajouter un capteur tactile dédié + `touch-action: none` **uniquement sur la poignée** ; (2) ajouter un sélecteur « Statut » dans l'en-tête du détail de tâche, visible sur tous formats ; (3) conserver `KeyboardSensor`.
- **Différence** : le glisser devient une commodité, plus une obligation. **Source** : Linear permet d'agir depuis l'inbox et sur mobile sans manipulation complexe **[S11][S12]**.
- **Valeur** : parité desktop/mobile, accessibilité clavier. **Impact** : composant Kanban uniquement ; utiliser la route `PATCH /tasks/:id/status` existante, aucune migration.
- **Permissions** : respecter `task:write:any` / `task:write:own` et les transitions de `task-rules.ts` ; ne pas proposer un statut que l'API refusera.
- **Complexité : faible à moyenne**. **Responsive** : 360/390 = colonnes empilées en accordéon ou carrousel, sélecteur pleine largeur ; 768 portrait = 2 colonnes max avec sélecteur ; 1024/1440 = 4 colonnes + DnD. Éviter le défilement horizontal des colonnes.
- **Critères** : changer le statut en ≤ 2 gestes à 360 px ; 0 régression sur les transitions serveur ; test tactile + clavier.

#### C5 — Émettre réellement `TASK_DUE_SOON` (ou supprimer le type mort)
- **Utilisateur** : membre ou étudiant dont une tâche arrive à échéance le lendemain et qui n'ouvre pas forcément l'application.
- **Espace** : Personnel (et Équipe pour les tâches assignées).
- **Problème** : le type existe, est routé vers l'espace personnel, est libellé — mais n'est jamais créé. L'utilisateur n'est donc jamais prévenu d'une échéance proche.
- **État actuel** : `schema.prisma:232-249`, `space-policy.ts:311`, `notification-map.js:23` ; seule simulation dans `refonte-apercu/ApercuExtras.jsx:84`. Le seul cron du dépôt est `invoice-overdue-sweep`.
- **Solution** : tâche planifiée quotidienne (ou horaire) idempotente : tâches ouvertes dont `dueDate` tombe dans les prochaines 24 h, notification unique par tâche et par jour, avec lien profond `?tache=<id>`, en respectant les préférences de notification.
- **Différence** : une fonctionnalité déclarée devient réelle. **Source** : Todoist rappels **[S1]**, Linear snooze/reminders **[S11]**.
- **Valeur** : moins d'échéances oubliées ; restaure la confiance dans la cloche. **Impact** : nouvelle écriture `Notification` ; table de déduplication ou clause `upsert` ; pas de migration lourde.
- **Permissions** : n'émettre que pour le propriétaire/assigné ; aucune tâche privée d'un tiers ne doit générer de notification (cf. `tasks.service.ts:755-757`).
- **Complexité : moyenne** (cron + idempotence + fuseaux). **Responsive** : notification = carte actionnable « Ouvrir / Reporter », cible ≥ 44 px, regroupement par jour sur 360 px.
- **Critères** : exactement 1 notification par tâche et par jour ; 0 notification pour une tâche privée d'autrui ; test d'idempotence sur double exécution du cron.

#### C6 — Expiration des devis : prévenir au lieu de seulement bloquer
- **Utilisateur** : commercial qui attend une réponse ; client qui laisse passer la date de validité sans avoir été relancé.
- **Espace** : Équipe + Client.
- **Problème** : `assertNotExpired()` (`quotes.service.ts:1169-1178`) refuse l'acceptation après `validUntil`, et la page client affiche « contactez l'agence pour un nouveau devis ». Aucun rappel n'est émis avant cette date : un devis peut mourir silencieusement.
- **État actuel** : `validUntil` est stocké, `QUOTE_SENT` est notifié à l'envoi, mais aucun suivi de « sans réponse ».
- **Solution** : (1) rappel interne à J-3 et J-1 pour les devis `SENT`/`VIEWED` non répondus ; (2) côté client, bandeau « ce devis expire dans X jours » + bouton « Demander une prolongation » qui crée un message dans la conversation existante ; (3) à l'expiration, garder la donnée et proposer « Dupliquer ce devis » à l'équipe.
- **Différence** : l'échéance devient un levier de relance, pas un mur. **Source** : Odoo « quotation deadlines » et flux devis→commande **[S17]** ; Linear snooze **[S11]**.
- **Valeur** : moins de devis perdus, moins d'emails de relance manuels. **Impact** : nouveau cron, réutilise `Conversation`/`Message`, aucune suppression de devis.
- **Permissions** : rappels internes `quote:read:any` ; demande de prolongation `quote:read:own` + `message:write:own` (le client ne peut pas modifier le devis).
- **Complexité : moyenne**. **Responsive** : 360/390 = bandeau pleine largeur avec une seule action ; 768 = bandeau + montant sur la même ligne ; 1024/1440 = colonne latérale. Ne pas mettre la date d'expiration uniquement dans un tableau.
- **Critères** : taux de devis expirés sans réponse en baisse ; 100 % des devis à J-3 génèrent un rappel traçable.

### Catégorie 2 — AMÉLIORER

#### A1 — Saisie rapide en langage naturel
- **Problème** : dater, prioriser et estimer une tâche demandent quatre interactions ; **Utilisateur** : saisie de 10 tâches par jour, souvent sur téléphone.
- **Espace** : Personnel. **Utilisateur** : étudiant/membre qui crée 10 tâches par jour sur téléphone.
- **État actuel** : `TaskComposer.jsx:95-193` — titre + 4 contrôles séparés.
- **Solution** : analyser le titre côté client pour extraire `demain`, `vendredi`, `dans 3 jours`, `!haute`, `2h`, `#objectif`, puis pré-remplir les contrôles existants (qui restent modifiables). Aucun LLM, aucune requête réseau.
- **Différence** : une phrase remplace 4 clics. **Source** : Todoist Smart Quick Add **[S1]**, TickTick Smart Recognition **[S3]**.
- **Valeur** : saisie plus rapide, estimations mieux renseignées (donc meilleur bilan). **Impact** : `TaskComposer` + `src/lib/task-status.mjs` ; DTO inchangé (`POST /me/tasks` accepte déjà `dueDate`, `priority`, `estimateMinutes`, `goalId`).
- **Permissions** : `task:write:personal` inchangée. **Complexité : faible à moyenne** (parseur français + tests).
- **Responsive** : sur 360 px, les jetons détectés s'affichent sous le champ sous forme de puces cliquables (pas de nouvelle ligne de contrôles) ; sur tablette/desktop, les contrôles existants restent visibles. Cible tactile ≥ 44 px pour retirer un jeton.
- **Critères** : « Rapport demain 2h !haute » crée une tâche datée, estimée, prioritaire en 1 saisie + Entrée ; 20 expressions françaises couvertes par des tests ; 0 régression sur la saisie manuelle.

#### A2 — Du bilan de session à la continuité de concentration
- **Problème** : chaque session de concentration est isolée des précédentes ; le temps déjà passé sur une tâche n'est jamais rappelé.
- **Espace** : Personnel. **Utilisateur** : membre qui enchaîne plusieurs sessions de travail.
- **État actuel** : `FocusOverlay.jsx` affiche un bilan de fin de session ; `TimerSession` conserve `accumulatedSeconds`, `note`, `savedMinutes`. Il n'existe aucun lien entre deux sessions d'une même tâche.
- **Solution** : à la fin d'une session, proposer « Reprendre plus tard » qui crée une session en pause liée à la même tâche, et afficher dans le bilan « temps déjà passé sur cette tâche / estimation restante ».
- **Différence** : la concentration devient un fil continu, pas une série de chronomètres isolés. **Source** : Sunsama affiche le temps réellement passé sur le calendrier et apprend des estimations **[S5]** ; TickTick suit les sessions Pomodoro **[S3]**.
- **Valeur** : meilleure perception du temps réel, moins de sous-estimation. **Impact** : lecture de `TimeEntry` + `TimerSession`, aucune migration si on réutilise `taskId`.
- **Permissions** : `time:write:own` (déjà exigée par le minuteur).
- **Complexité : moyenne**. **Responsive** : bilan en plein écran sur 360 px avec 2 actions max ; sur tablette, carte latérale ; sur desktop, panneau. Respecter `prefers-reduced-motion` pour les animations du décompte.
- **Critères** : le temps cumulé affiché = somme des `TimeEntry` de la tâche ; reprise en 1 geste.

#### A3 — Objectifs : alerte d'échéance et replanification
- **Problème** : un objectif dont l'échéance approche avec 8 tâches ouvertes n'émet aucun signal ; **Utilisateur** : suivi d'un objectif sur plusieurs semaines.
- **Espace** : Personnel. **État actuel** : `Goal.targetDate`, `GoalRing`, `GoalCountdown`, progression calculée côté serveur (`goals.service.ts`). Aucun signal quand un objectif dérape.
- **Solution** : calculer un « reste à faire » = tâches ouvertes rattachées vs jours restants ; afficher un état « En danger » quand la charge restante dépasse la capacité quotidienne déclarée ; proposer « Décaler l'échéance » en un geste.
- **Différence** : l'objectif devient un pilotage, pas une décoration. **Source** : Todoist objectifs quotidiens **[S1]**, Structured Replan (Pro, iOS uniquement) **[S7]**.
- **Valeur** : objectifs crédibles, moins d'abandons. **Impact** : `PATCH /me/goals/:id` existe déjà ; calcul côté serveur de préférence.
- **Permissions** : `task:read:personal` / `task:write:personal` (les objectifs suivent déjà ces droits).
- **Complexité : moyenne** (dépend de N2 pour la capacité). **Prérequis** : N2 ou valeur par défaut explicite.
- **Responsive** : 360 px = une carte d'objectif par ligne avec anneau + échéance + une action ; 768 = 2 cartes ; 1024+ = 3-4 cartes. Pas de tableau.
- **Critères** : un objectif en retard est signalé avant sa date ; l'action « décaler » met à jour `targetDate` sans toucher aux tâches.

#### A4 — Notifications actionnables et snooze
- **Problème** : la cloche mélange les alertes qui exigent une décision et les simples informations ; **Utilisateur** : membre recevant une vingtaine de notifications par jour.
- **Espace** : Personnel + Équipe. **État actuel** : `NotificationsPanel.jsx` regroupe par jour, filtre par groupe, marque comme lu ; `LiveNotification` temps réel. Pas de « snooze », pas d'onglet prioritaire.
- **Solution** : onglet « À traiter » (notifications qui demandent une action : devis à valider, tâche assignée, facture en retard, message), « Autres » pour le bruit ; action « Reporter à demain » sur les notifications actionnables, stockée côté serveur.
- **Différence** : la cloche devient une file de décisions. **Source** : Linear Inbox Priority + snooze + actions depuis la notification **[S11]**.
- **Valeur** : moins de bruit, moins d'oublis. **Impact** : colonne `snoozedUntil` sur `Notification` (migration légère) ou table dédiée ; ne pas supprimer la notification.
- **Permissions** : `notification:manage:own` déjà existante ; aucune élévation.
- **Complexité : moyenne**. **Responsive** : 360/390 = liste pleine largeur, actions en bouton unique + menu « … » ; 768 = liste + aperçu ; 1024+ = deux colonnes. Cibles ≥ 44 px, `aria-live` pour les mises à jour.
- **Critères** : une notification reportée réapparaît à l'heure dite ; 0 notification critique masquée par le filtre. **Prérequis** : C5 et C6 pour disposer des premiers rappels à trier.

#### A5 — Journal d'audit réellement exploitable
- **Problème** : le journal ne dit ni quel objet précis a changé, ni quelles valeurs ont été modifiées ; **Utilisateur** : administrateur enquêtant sur un incident.
- **Espace** : Comexa Space. **État actuel** : `audit-log.service.ts:89-119` renvoie `entityId`, `before`, `after` (redressés par `redact.ts`), `userAgent`, et accepte `actorId`, `entityId`, `action`, `entityType`, `from`, `to`. L'UI (`journal/page.jsx`) n'en montre que 5 colonnes et 4 filtres.
- **Solution** : ajouter filtres « porteur » et « identifiant d'objet », colonne « Objet » cliquable, et un panneau de dépliant « Avant / Après » lisible (pas de JSON brut) avec les champs redressés.
- **Différence** : on répond à « qu'est-ce qui a changé ? » au lieu de « qui a fait quelque chose ? ». **Source** : GitHub audit log avec `token_scopes`, `hashed_token`, champs d'objet **[S19]**.
- **Valeur** : diagnostic d'incident en minutes. **Impact** : page `journal` + `src/lib/audit-labels.js` ; aucun changement d'API.
- **Permissions** : `audit:read:any` inchangée ; ne jamais afficher de valeur non redressée.
- **Complexité : faible à moyenne**. **Responsive** : 360/390 = cartes d'audit avec libellés `data-label`, dépliant pleine largeur ; 768 = tableau compact ; 1024+ = tableau complet. Les valeurs longues (JWT, User-Agent) doivent être tronquées avec « copier ».
- **Critères** : 100 % des événements affichent un objet identifiable ; un test vérifie qu'aucun secret n'apparaît en clair.

#### A6 — Cycle de vie des jetons d'intégration
- **Problème** : rien n'impose une durée de vie maximale ni ne signale un jeton jamais utilisé ; **Utilisateur** : administrateur qui reprend la plateforme après plusieurs mois.
- **Espace** : Comexa Space. **État actuel** : création avec portées, secret affiché une fois, renouvellement, révocation, expiration, confirmations (`integrations/page.jsx`, 952 lignes) ; `ComexaOverview` calcule déjà les jetons proches de l'expiration.
- **Solution** : imposer une durée de vie maximale à la création (valeur par défaut + maximum), afficher « dernière utilisation » et « jamais utilisé », et ajouter une alerte visible dans la vue d'ensemble avec lien direct vers le jeton.
- **Différence** : d'une gestion réactive à une hygiène proactive. **Source** : GitHub expiration automatique, révocation après inactivité, champs `token_expires_at` dans le journal **[S20][S19]**.
- **Valeur** : moins de secrets oubliés. **Impact** : DTO de création + colonne `lastUsedAt` (migration) + écriture à chaque appel authentifié par jeton — à faire avec parcimonie (pas d'écriture à chaque requête chaude : cache/batch).
- **Permissions** : `integration:manage:any` ; la création de jeton ne doit jamais donner `manage` (déjà garanti).
- **Complexité : moyenne**. **Responsive** : 360/390 = liste de cartes avec statut + actions dans un menu, secret révélé dans une modale plein écran avec bouton « copier » ; 768+ = tableau. Confirmation de révocation toujours explicite.
- **Critères** : 0 jeton sans expiration maximale ; 100 % des jetons inutilisés depuis 90 jours signalés.

#### A7 — Remplacer le tableau de bord client `DataView` par des cartes d'action
- **Problème** : l'accueil client affiche des clés JSON génériques à la place d'informations exploitables ; **Utilisateur** : client qui se connecte sur son téléphone pour savoir quoi faire.
- **Espace** : Client. **État actuel** : `/tableau-de-bord/page.jsx` (56 lignes) affiche `<DataView value={counters} />` ; `DataView.jsx` devine les libellés depuis les clés JSON et peut produire 7 colonnes.
- **Solution** : trois cartes maximum — « Devis à valider » (avec bouton Répondre), « Facture à régler » (montant + échéance + moyen de paiement), « Prochaine étape sur votre projet » (jalon + date). Conserver un lien « Vue d'ensemble complète » vers `/espace-client`.
- **Différence** : le client comprend en 5 secondes ce qu'il doit faire. **Source** : HoneyBook « key details up front » **[S21]**, Assembly home configurable **[S23]**.
- **Valeur** : moins d'appels/emails de suivi. **Impact** : réutilise `/dashboard/client` et les endpoints existants ; `DataView` reste pour les rapports générés.
- **Permissions** : `dashboard:read:own`, `quote:read:own`, `invoice:read:own`, `project:read:own` — déjà détenues par `CLIENT`.
- **Complexité : faible**. **Responsive** : 360/390 = cartes empilées, une action primaire par carte, bouton pleine largeur ; 768 = 2 cartes + 1 pleine largeur ; 1024+ = 3 colonnes. Pas de tableau, pas de défilement horizontal.
- **Critères** : temps moyen pour trouver « combien dois-je payer » < 10 s sur mobile ; 0 clé JSON brute visible. **Prérequis** : question 10 de la section 12 pour les consignes de paiement à afficher.

#### A8 — Suivi de projet client : fil d'activité et jalons expliqués
- **Problème** : une barre de progression sans histoire ni jalon expliqué ; **Utilisateur** : client qui veut comprendre l'avancement sans écrire à l'équipe.
- **Espace** : Client. **État actuel** : `/projets/[id]/page.jsx` affiche progression, jalons, tâches (souvent masquées faute de droits `task:*`), documents. Le backend `ActivityService.listForProject(projectId, { asClient: true })` filtre `isClientVisible: true` (`activity.service.ts:142-152, 204-208`) mais **aucune page client ne l'appelle**.
- **Solution** : ajouter une frise « Ce qui s'est passé » (activités client-visibles, libellées en français via `activity-labels.mjs`), et expliciter chaque jalon (« À venir / En cours / Livré le … ») avec la prochaine date utile.
- **Différence** : le client voit une histoire, pas seulement une barre de pourcentage. **Source** : HoneyBook jalons et dates en page d'accueil **[S21]**, Assembly « Stage 3: Track » **[S23]**.
- **Valeur** : réduction des « où en est mon projet ? ». **Impact** : nouvel appel GET sur une route existante ; aucune migration.
- **Permissions** : impératif `clientVisibleOnly: true` côté serveur ; ne jamais exposer `Activity.isClientVisible: false`, ni les notes internes, ni les temps.
- **Complexité : faible à moyenne**. **Responsive** : 360/390 = frise verticale avec date + une phrase, jalons en cartes ; 768 = frise + jalons côte à côte ; 1024+ = frise + colonne latérale « Votre prochaine action ».
- **Critères** : 100 % des événements affichés sont `isClientVisible: true` (test) ; 0 information interne visible ; 1 seule date « prochaine étape » mise en avant.

### Catégorie 3 — AJOUTER

#### N1 — Bilan intelligent hebdomadaire (déterministe)
- **Problème** : aucune vue ne compare le travail prévu au travail réellement accompli ; l'utilisateur ne peut donc pas corriger sa semaine suivante.
- **Espace** : Personnel. **Utilisateur** : membre/étudiant qui finit sa semaine sans savoir pourquoi elle a déraillé.
- **État actuel** : `Task.estimateMinutes`, `dueDate`, `completedAt`, `TimeEntry.minutes`, `TimerSession.accumulatedSeconds`, `AuditLog` (`TASK_UPDATED` avec `after.dueDate`), `DailyReport.contentJson`. Aucune vue ne les rapproche.
- **Solution** : `GET /me/insights/week` calculant : prévu vs réalisé (minutes estimées vs saisies), taux de complétion, **tâches reportées ≥ 2 fois** (déduites des `TASK_UPDATED` de l'audit), objectifs en danger, et **une seule recommandation actionnable** formulée par une règle explicite (ex. « 3 tâches reportées deux fois : réduisez la charge de mercredi ou découpez-les »). Aucun LLM.
- **Différence** : c'est la seule brique réellement absente du cockpit ; elle transforme des données déjà collectées en décision. **Source** : Todoist visualisations **[S1]**, Sunsama estimation apprise de l'historique **[S5]**, Structured Replan **[S7]**.
- **Valeur** : effet « outil qui me comprend » sans IA générique. **Impact** : nouvelle route de lecture, aucun nouveau modèle en v1 (l'audit fournit l'historique) ; attention au volume d'audit à long terme (index `entityType/entityId/createdAt` déjà présent). Prévoir une table d'agrégats si le calcul devient lourd.
- **Permissions** : `dashboard:read:own` + portée `own` stricte ; un administrateur dans son espace personnel ne doit voir que ses propres données (déjà le cas, `space-policy.ts`).
- **Complexité : moyenne** (SQL + règles + UI). **Responsive** : 360/390 = 1 KPI + 1 graphique sparkline + 1 recommandation en carte, tout tient dans 2 écrans ; 768 = 2 colonnes ; 1024/1440 = graphique + liste des reports côte à côte. Pas de graphique décoratif : une seule courbe lisible, contraste vérifié.
- **Critères** : pour un jeu de données de test, prévu/réel exact au minuté près ; les tâches reportées détectées correspondent à l'audit ; 0 conseil générique (« travaillez plus »). **Prérequis** : fiabilité des estimations (question 1 de la section 12) ; C1 si le calcul touche aux portées.

#### N2 — Planification réaliste : charge du jour vs disponibilité
- **Problème** : Comexa accepte sans rien dire une journée de 8 h de tâches pour 3 h de disponibilité ; **Utilisateur** : planification du matin.
- **Espace** : Personnel. **État actuel** : `PersonalDashboard` compte les tâches, `CalendarWorkspace` connaît les événements, `TaskComposer` collecte `estimateMinutes`. Aucun rapprochement.
- **Solution** : un bloc « Aujourd'hui : 4 h 30 de travail prévu pour 3 h 15 disponibles » calculé à partir des estimations des tâches dues aujourd'hui et des créneaux libres de l'agenda ; bouton « Ajuster » qui propose de déplacer les tâches les moins prioritaires à demain (action explicite, jamais automatique).
- **Différence** : Comexa cesse de valider une journée impossible. **Source** : Sunsama Task Projections + heure de fin **[S5]**, Teamwork Workload Planner **[S16]**.
- **Valeur** : moins de frustration, meilleure qualité des estimations (effet N1). **Impact** : nouveau calcul serveur (agrégation `Task` + `CalendarEvent`), paramètre « heures de travail » à stocker (préférence utilisateur, colonne ou `Setting`).
- **Permissions** : `calendar:read:own` + `task:read:personal` + `task:read:assigned` ; ne jamais lire les événements privés d'un collègue.
- **Complexité : moyenne à élevée** (calcul de créneaux + fuseaux). **Prérequis** : clarifier la définition d'un « créneau disponible » (section 12).
- **Responsive** : 360/390 = bandeau « charge » avec une jauge et une action « Ajuster » ; 768 = jauge + liste des tâches déplaçables ; 1024+ = colonne latérale de planification. Actions tactiles ≥ 44 px.
- **Critères** : la somme affichée = somme des `estimateMinutes` des tâches dues ce jour ; l'ajustement modifie uniquement les `dueDate` choisies et est tracé dans l'audit.

#### N3 — File d'entrée unifiée (triage)
- **Problème** : les demandes entrantes sont éparpillées dans quatre rubriques, sans ordre de priorité ni responsable désigné.
- **Espace** : Équipe. **Utilisateur** : la personne qui ouvre l'outil le matin et doit décider quoi traiter.
- **État actuel** : 4 rubriques séparées dans `space-navigation.js` (`contacts`, `demandes`, `modifications`, `messagerie`), chacune avec sa propre liste ; pas de responsable de tri, pas de snooze.
- **Solution** : `GET /inbox` agrégeant en lecture seule les demandes de contact non converties, demandes de projet `SUBMITTED`, demandes de modification `SUBMITTED`, messages non lus et factures/devis en attente ; actions « Prendre en charge », « Reporter », « Convertir » qui appellent les endpoints existants ; responsable de tri configurable.
- **Différence** : une seule file au lieu de cinq onglets. **Source** : Linear Triage + responsabilité tournante + accept/decline/duplicate/snooze **[S10]**, Inbox Priority **[S11]**.
- **Valeur** : délai de première réponse réduit, rien n'est oublié. **Impact** : nouvelle route d'agrégation (pas de nouvelle table en v1), réutilise les statuts existants ; attention aux permissions : chaque ligne doit être filtrée selon les droits du porteur.
- **Permissions** : respecter `contactrequest:read:any`, `project_request:read:any`, `modificationrequest:decide:any`, `conversation:read:own`, etc. ; ne pas créer de « super-permission » qui contournerait les gardes.
- **Complexité : moyenne à élevée** (agrégation multi-modules + cohérence des statuts). **Responsive** : 360/390 = liste de cartes avec 2 actions (Prendre / Reporter), tri par urgence ; 768 = liste + aperçu ; 1024+ = trois colonnes (file / détail / actions). Aucun tableau horizontal.
- **Critères** : une demande présente dans l'une des 4 files apparaît dans l'inbox ; une action « convertir » produit exactement le même effet que depuis la page d'origine ; 0 fuite d'une demande non autorisée. **Prérequis** : C1 (tests de périmètre) et A4 (notifications actionnables) pour les gestes depuis la cloche.

#### N4 — Rentabilité par projet (coûts, budget, marge)
- **Problème** : le temps saisi et les factures ne permettent pas de dire si un projet gagne de l'argent ; **Utilisateur** : direction qui fixe un prix ou une affectation.
- **Espace** : Équipe. **État actuel** : `TimeEntry` (minutes), `Invoice` (montants), `DistributionConfig` (répartition des recettes), `PackageRate`. Aucun champ de coût horaire, aucun budget projet, aucune marge calculée.
- **Solution** : ajouter un taux de revient par membre (optionnel, visible seulement aux rôles autorisés), un budget temps/argent par projet, puis calculer `marge = facturé − (temps × coût)`, avec alerte à 70/90 % de consommation. Ne pas confondre avec la répartition : les deux vues restent séparées.
- **Différence** : répondre à « ce projet nous rapporte-t-il ? ». **Source** : Productive budget/marge temps réel, cartes de taux et alertes **[S13][S14]**.
- **Valeur** : décisions de prix et d'affectation fondées. **Impact** : nouvelle migration (`costRate`, `budget`), nouveaux calculs, impacts sur les rapports générés et sur les permissions financières existantes.
- **Permissions** : créer un droit `finance:read:margin` (ou équivalent) distinct de `balance:read:own` — un membre ne doit pas voir les coûts des autres ; les clients n'y ont jamais accès **[S15]**.
- **Complexité : élevée**. **Prérequis** : validation du modèle de coût par l'équipe (section 12) ; chantier à ne lancer qu'après N3.
- **Responsive** : 360/390 = une carte « marge » + jauge de budget, détails dans un dépliant ; 768 = 2 colonnes ; 1024+ = graphique de consommation. Les montants multi-devises doivent conserver la devise d'origine (pas de conversion automatique, conformément au `README.md`).
- **Critères** : marge recalculée identique au tableur de référence de l'équipe ; 0 donnée de coût visible par un compte `CLIENT`.

#### N5 — « Prochaines étapes » et tâches côté client
- **Problème** : le client ne voit jamais « ce qu'on attend de lui » ; **Utilisateur** : validation d'une maquette, fourniture d'accès, confirmation de livraison.
- **Espace** : Client. **État actuel** : le client voit des statuts et des jalons mais aucune liste d'actions le concernant ; les tâches de projet sont masquées car `CLIENT` n'a aucun droit `task:*` (`permissions.catalogue.ts:509-528`).
- **Solution** : nouveau modèle léger `ClientAction` (ou extension de `Milestone`) : « Valider la maquette », « Fournir les accès », « Confirmer la livraison », avec échéance, responsable client, état et document lié. L'équipe les crée depuis le projet ; le client les voit en haut de sa vue d'ensemble et les marque « fait » — sans lui donner de droits sur les tâches internes.
- **Différence** : le client devient acteur du projet, pas simple spectateur. **Source** : HoneyBook « client facing tasks » avec échéances **[S21]**, Assembly approbations et étapes **[S23]**, Teamwork client users **[S15]**.
- **Valeur** : moins d'attentes bloquantes, moins de relances. **Impact** : nouvelle table + droits + notifications `CLIENT_ACTION_DUE` ; ne pas réutiliser `Task` (risque de fuite vers l'interne).
- **Permissions** : nouvelle permission `clientaction:write:own` pour le client, `clientaction:manage:any` pour l'équipe ; filtrage strict par `clientId` du porteur.
- **Complexité : moyenne**. **Responsive** : 360/390 = une carte d'action par ligne, bouton « Marquer fait » pleine largeur, date lisible ; 768 = 2 colonnes ; 1024+ = encart dans la vue d'ensemble. Cible ≥ 44 px, confirmation visuelle immédiate.
- **Critères** : 100 % des actions créées par l'équipe apparaissent chez le bon client uniquement ; temps de compréhension < 10 s sur mobile. **Prérequis** : A7 (accueil client) pour l'emplacement ; C1 pour la nouvelle permission `clientaction:*` ; mise à jour du contrat API et de la synchro desktop.

#### N6 — Validation explicite du supplément par le client
- **Problème** : un supplément est proposé sans que le client puisse l'accepter ou le refuser formellement ; **Utilisateur** : demande de modification avec surcoût.
- **Espace** : Client + Équipe. **État actuel** : l'agence décide `APPROVED`/`REJECTED` avec `extraCost` (`modifications/page.jsx:73-129`) ; le client lit le montant et la note (`espace-client/modifications/page.jsx:82-91`) sans pouvoir répondre. Le DTO de décision est réservé à `modificationrequest:decide:any`.
- **Solution** : ajouter un état d'acceptation du supplément (`extraCostAcceptedAt`, `extraCostAcceptedBy`) et une route `POST /modification-requests/:id/accept-cost` ouverte à `modificationrequest:write:own`, avec refus motivé. L'équipe voit « En attente de votre accord » puis « Accepté le … ».
- **Différence** : une décision commerciale tracée au lieu d'un malentendu par email. **Source** : HoneyBook tâches de validation **[S21]**, Assembly approbations **[S23]**.
- **Valeur** : démarrage des travaux plus rapide, litige réduit. **Impact** : colonnes + statuts + notification ; attention à ne pas permettre au client de modifier le montant (il ne peut qu'accepter/refuser).
- **Permissions** : le client ne peut accepter que les demandes de son `clientId` (contrôle serveur, comme dans `modification-request.service.ts:36-83`) ; aucune élévation vers `decide:any`.
- **Complexité : moyenne**. **Responsive** : 360/390 = carte « Supplément proposé : X DA » + 2 boutons empilés (Accepter / Refuser avec motif) ; 768+ = actions côte à côte. Confirmation explicite avant acceptation (acte engageant).
- **Critères** : 0 acceptation d'une demande d'un autre client (test) ; l'acceptation est journalisée dans l'audit et visible des deux côtés. **Prérequis** : C1 (nouvelle permission) et validation produit de la question 8 de la section 12.

#### N7 — Santé opérationnelle dans Comexa Space
- **Problème** : aucune vue ne dit si le courriel, le stockage ou le cron fonctionnent ; **Utilisateur** : administrateur face à « l'application ne marche pas ».
- **Espace** : Comexa Space. **État actuel** : `/api/health` public renvoie `status`, `database`, `databaseTarget`, `uptimeSeconds`, `contract` (`health.controller.ts`) ; `ComexaOverview` affiche des compteurs métier mais aucun état technique.
- **Solution** : une carte « Plateforme » : version du contrat API déployé vs version attendue par le front (`ApiContractBanner` existe déjà), état DB, dernier envoi d'e-mail réussi/échoué, dernière exécution du cron de relance, accessibilité du stockage S3, nombre d'erreurs 5xx sur 24 h. Endpoint admin `GET /admin/health` (protégé, `audit:read:any`), sans exposer d'hôte ni de secret.
- **Différence** : l'administrateur détecte une panne avant l'équipe. **Source** : pratique des journaux d'audit détaillés **[S19][S30]** ; la sonde existe déjà dans le dépôt.
- **Valeur** : diagnostic plus rapide, moins de « le site ne marche pas » sans contexte. **Impact** : nouvel endpoint d'agrégation, éventuellement une table de « dernières exécutions » pour le cron ; ne pas journaliser de données personnelles.
- **Permissions** : `audit:read:any` ou nouveau `health:read:any` ; ne jamais rendre publics les détails (seuls `status`/`contract` le sont aujourd'hui).
- **Complexité : moyenne**. **Responsive** : 360/390 = liste de voyants (vert/orange/rouge) avec libellé + heure, une ligne par service ; 768 = 2 colonnes ; 1024+ = grille 4 colonnes. Pas de graphique, pas de tooltip seul (accessibilité).
- **Critères** : chaque voyant a une source de vérité identifiable ; 0 secret exposé ; test simulant une panne DB affiche l'état dégradé.

#### N8 — Rappels proactifs multi-objets
- **Problème** : un seul cron existe (factures impayées) et chaque nouvel objet exigerait le sien ; **Utilisateur** : tous les espaces, tous les jours.
- **Espace** : transverse (Équipe, Client, Personnel). **État actuel** : un seul cron (`invoice-overdue-sweep`), notifications réactives aux actions, `TASK_DUE_SOON` non émis.
- **Solution** : un **service de rappels unifié**, paramétrable et idempotent, pour : devis proches de l'expiration (C6), jalons à échéance, tâches dues (C5), actions client (N5), factures à échoir (pas seulement en retard). Une seule table `Reminder` (objet, type, date, destinataire, état) évite cinq crons concurrents.
- **Différence** : d'une relance ponctuelle à une politique cohérente. **Source** : Odoo échéances de devis **[S17]**, Linear reminders/snooze **[S11]**, Todoist rappels **[S1]**.
- **Valeur** : moins d'oublis dans tous les espaces, une seule maintenance. **Impact** : nouvelle table + cron + branches dans chaque module ; risque de spam si les règles sont mal calibrées → préférences utilisateur obligatoires.
- **Permissions** : chaque rappel est calculé dans le périmètre du destinataire ; un rappel ne doit jamais révéler l'existence d'un objet qu'il ne peut pas lire.
- **Complexité : élevée** (transverse). **Prérequis** : C1 (tests de périmètre) et C5/C6 livrés séparément d'abord ; N8 est la factorisation, pas le premier chantier.
- **Responsive** : voir les fiches C5/C6/N5 — le rappel n'est qu'un canal, l'action doit rester accessible dans l'interface.
- **Critères** : 1 rappel maximum par objet et par règle ; désactivation possible par l'utilisateur ; 0 rappel sur un objet non lisible.

---

## 9. Priorités, complexité et dépendances

### 9.1 Évaluation qualitative (sans scores artificiels)

| Proposition | Valeur | Fréquence du problème | Urgence / risque | Confiance dans le besoin | Complexité | Risque de régression | Gain mobile | Intérêt stratégique |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C1 Tests politique d'espaces | Forte | Structurelle | **P0** | Très forte (code lu) | Faible | Très faible | Indirect | Prérequis à tout |
| C2 Vérification e-mail | Forte | À chaque inscription | **P0** | Très forte (config lue) | Faible-moyenne | Faible | Moyen | Confiance |
| C3 Secret n8n | Forte | Continue | **P0** (risque) | Forte (route lue, workflow inconnu) | Moyenne | Moyenne (contrat externe) | Faible | Sécurité |
| C4 Kanban tactile | Forte | Quotidienne | Haute | Forte (capteurs lus) | Faible-moyenne | Faible | **Fort** | Parité |
| C5 `TASK_DUE_SOON` | Moyenne-forte | Quotidienne | Haute | Très forte (type mort) | Moyenne | Moyenne (cron) | Fort | Rétention |
| C6 Expiration devis | Forte | Hebdomadaire | Haute | Forte (code + client lus) | Moyenne | Faible | Fort | Revenu |
| A1 Saisie naturelle | Forte | Pluriquotidienne | Moyenne | Forte (concurrents) | Faible-moyenne | Faible | **Fort** | Différenciation |
| A2 Continuité concentration | Moyenne | Hebdomadaire | Faible | Moyenne (hypothèse) | Moyenne | Faible | Moyen | Cohérence |
| A3 Objectifs en danger | Moyenne | Hebdomadaire | Faible | Moyenne | Moyenne | Faible | Moyen | Rétention |
| A4 Notifications actionnables | Forte | Quotidienne | Moyenne | Forte | Moyenne | Moyenne | Fort | Socle N3/N8 |
| A5 Audit exploitable | Forte | Incident | Moyenne | Très forte (API vs UI) | Faible-moyenne | Faible | Moyen | Traçabilité |
| A6 Cycle de vie jetons | Moyenne | Mensuelle | Moyenne | Forte | Moyenne | Faible | Faible | Sécurité |
| A7 Accueil client en cartes | **Très forte** | À chaque visite | Haute | Très forte | **Faible** | Très faible | **Très fort** | Image pro |
| A8 Frise d'activité client | Forte | Hebdomadaire | Moyenne | Forte | Faible-moyenne | Faible | Fort | Réduction du suivi |
| N1 Bilan intelligent | **Très forte** | Hebdomadaire | Haute | Très forte (données présentes) | Moyenne | Faible | Fort | **Cœur produit** |
| N2 Planification réaliste | Forte | Quotidienne | Moyenne | Forte | Moyenne-élevée | Moyenne | Fort | Différenciation |
| N3 File d'entrée | **Très forte** | Quotidienne | Haute | Forte | Moyenne-élevée | Moyenne (multi-modules) | Fort | Pilotage |
| N4 Rentabilité projet | Forte | Mensuelle | Faible | **Moyenne** (modèle de coût à valider) | **Élevée** | Élevée (finance) | Moyen | Stratégique mais tardif |
| N5 Actions côté client | Forte | Par projet | Moyenne | Forte | Moyenne | Moyenne | **Très fort** | Expérience client |
| N6 Validation supplément | Moyenne-forte | Par modification | Moyenne | Forte (boucle cassée lue) | Moyenne | Faible | Fort | Juridique/commercial |
| N7 Santé plateforme | Moyenne | Incident | Moyenne | Forte | Moyenne | Faible | Moyen | Exploitation |
| N8 Rappels unifiés | Forte | Quotidienne | Faible | Forte | **Élevée** | Élevée (transverse) | Fort | Factorisation tardive |

### 9.2 Les cinq améliorations les plus importantes du produit

1. **N1 — Le bilan intelligent hebdomadaire.** C'est le seul endroit où Comexa possède déjà toutes les données (estimations, échéances, temps saisi, historique d'audit) et ne produit **aucune** information utile. Il répond directement à la question centrale de l'espace personnel. Complexité maîtrisée, aucun LLM, forte valeur perçue.
2. **N3 — La file d'entrée unifiée.** Le problème est quotidien et mesurable : quatre files, aucune priorisation. C'est le pendant, côté équipe, du triage de Linear, et c'est un prérequis naturel à des notifications actionnables (A4) et à des rappels (N8).
3. **A7 + N5 — Un accueil client orienté action.** Deux changements de faible complexité (remplacer `DataView`, ajouter des actions côté client) transforment la perception de l'espace client : de « je consulte des chiffres » à « je sais quoi faire ». Source directe : HoneyBook 2026 **[S21]** et Assembly **[S23]**.
4. **C1 + C2 + C3 — Sécuriser et tester les fondations.** Aucune amélioration visible, mais ce sont les trois points qui, s'ils sont ignorés, rendent dangereuses toutes les autres évolutions : politique d'espaces non testée, vérification e-mail désactivée, JWT de session transmis à un tiers. À traiter en lotissement 0, avant toute nouvelle permission.
5. **A5 + N7 — Un Comexa Space qui explique et surveille.** Le journal d'audit enrichi (données déjà en base) et une vue de santé (sonde déjà existante) sont peu coûteux et répondent au besoin des créateurs : « comprendre l'état de la plateforme et intervenir ».

**Pourquoi N4 (rentabilité) n'est pas dans le top 5** : c'est probablement la fonctionnalité la plus « impressionnante », mais elle exige un modèle de coût validé, une migration sur des données financières, de nouveaux droits et une vérification comptable. La confiance dans le besoin est encore moyenne. Elle doit être **approfondie avant décision** (section 9.4), pas lancée maintenant.

### 9.3 Trois améliorations prioritaires par espace

| Espace | 1 | 2 | 3 |
| --- | --- | --- | --- |
| **Personnel** | C5 + N1 : émettre le rappel d'échéance et livrer le bilan prévu/réel | A1 : saisie en langage naturel | N2 : charge du jour vs disponibilité (après validation de la règle de capacité) |
| **Équipe / Business** | C4 : statut de tâche modifiable sans glisser-déposer sur mobile | N3 : file d'entrée unifiée | C6 : relances avant expiration des devis |
| **Comexa Space** | C1/C2/C3 : tests, vérification e-mail, délégation du secret IA | A5 : journal d'audit avec objet et avant/après | A6 + N7 : hygiène des jetons et santé plateforme |
| **Espace client** | A7 : accueil en cartes d'action (remplace `DataView`) | A8 : frise d'activité + jalons expliqués | N5 + N6 : actions côté client et validation du supplément |

### 9.4 Fonctionnalités concurrentielles à approfondir avant toute décision

| Sujet | Ce qu'il faut vérifier avant de coder | Pourquoi |
| --- | --- | --- |
| **N4 Rentabilité** | Le modèle de coût de Comexa : taux horaire par membre ? charges ? overhead ? qui a le droit de voir une marge ? | Productive propose cartes de taux et overhead **[S13][S14]**, mais transposer sans modèle validé produirait un chiffre faux et trompeur. |
| **N2 Capacité** | Définition d'un « créneau disponible » : heures de travail, pause, événements privés vs partagés, week-end, fuseau (Africa/Algiers). | Sunsama utilise l'heure de fin choisie et l'agenda **[S5]** ; Comexa doit choisir sa propre règle. |
| **N8 Rappels** | Préférences utilisateur, quiet hours, canaux (in-app/e-mail/Telegram), seuil de spam. | Linear documente snooze, rappels et notifications planifiées **[S11]** ; cinq crons concurrents créeraient du bruit. |
| **A4 Snooze** | Stockage du report : colonne sur `Notification` ou table dédiée ; interaction avec les counters non lus. | Impacte directement le badge de la coque sur mobile et les notifications temps réel. |
| **C3 Délégation IA** | Contrat réel avec le workflow n8n (le dépôt ne le contient pas) : conservation des logs, durée de vie, portées nécessaires. | Impossible de proposer un correctif sûr sans voir le traitement côté tiers. |
| **Paiement en ligne** | Disponibilité d'un contrat SATIM/CIB ou d'une passerelle locale pour Comexa. | Les délais sont de 4 à 12 semaines **[S28]** ; ce n'est pas une itération produit mais un projet administratif. |

### 9.5 Idées à ne pas développer pour le moment

- Reconstruire un CRM, une facturation, un gestionnaire de tâches ou un calendrier : **tout existe et fonctionne** (section 2.4).
- Une IA de planification conversationnelle : la console IA existe (`AiAgentDrawer`) et le besoin identifié est un **calcul déterministe** (N1/N2), pas une conversation.
- Gamification type Karma, suivi d'habitudes complet, matrice d'Eisenhower : populaires mais sans problème identifié dans les parcours Comexa (règle 2 de la mission).
- Un tableau de bord rempli de graphiques : `ControlCenter.jsx` fait déjà 1 153 lignes ; ajouter des courbes sans décision associée dilue l'information.
- Un système de workflows visuel / automatisations type Zapier : disproportionné pour une équipe interne, et N3 suffit à court terme.
- Une application mobile native côté **client** : HoneyBook lui-même utilise le web mobile pour les clients **[S22]** ; Comexa doit d'abord parfaire ce web mobile (A7/A8/N5).
- Un modèle multi-organisations, un SSO ou une offre « free forever » publique : **hors périmètre** de cette mission. Le schéma n'a aucune entité `Organization` ; en introduire une maintenant contraindrait toutes les propositions ci-dessus sans bénéfice interne.
- Toute modification du design system : la charte soft UI est récente, documentée et cohérente (`docs/REFONTE-SOFTUI.md`).

### 9.6 Dépendances qui imposent un ordre

```
C1 (tests espaces) ──► toutes les propositions qui ajoutent des permissions (N3, N5, N6, N7, N4)
C2 (vérification e-mail) ──► toute ouverture d'inscription externe (hors périmètre actuel, mais bloquant)
C3 (délégation IA) ──► toute évolution de la console IA
C5, C6 ──► N8 (factorisation des rappels : on ne factorise que ce qui marche déjà)
A4 (notifications actionnables) ──► N3 (la file d'entrée a besoin d'actions depuis la notification)
A7 (accueil client) ──► N5 (les actions client ont besoin d'un emplacement visible)
N2 (capacité) ──► A3 (alerte d'objectif « en danger »)
N3 (file d'entrée) ──► N4 (rentabilité : même effort de pilotage, à ne pas mener en parallèle)
N4 ──► nécessite la validation du modèle de coût (section 12)
```

### 9.7 Ordre de réalisation recommandé

| Vague | Contenu | Durée indicative | Porte de sortie |
| --- | --- | --- | --- |
| **V0 — Fondations** | C1, C2, C3 (décision + design), C4, C5 | 1 à 2 sprints | Tests de périmètre en CI ; 0 JWT de session sortant ; vérification e-mail active ; Kanban utilisable à 360 px ; rappel d'échéance effectivement émis. |
| **V1 — Valeur quotidienne** | N1, A1, A7, A8, A5 | 2 sprints | Bilan hebdo exact sur un jeu de test ; accueil client sans clé JSON ; frise d'activité filtrée `isClientVisible` ; audit avec objet/avant/après. |
| **V2 — Pilotage** | N3, C6, A4, N5, N6, A2 | 2 sprints | Une seule file d'entrée ; devis rappelés avant expiration ; notifications snooze ; actions client ; supplément validable. |
| **V3 — Approfondissement** | N2, A3, A6, N7, puis N4 et N8 après validation | 2 à 3 sprints | Charge réaliste, objectifs en danger, hygiène des jetons, santé plateforme ; rentabilité et rappels unifiés uniquement si les validations de la section 12 sont tranchées. |

**Règle de lotissement** : jamais plus de deux propositions touchant le même fichier critique (`space-policy.ts`, `access.guards.ts`, `Shell.jsx`, schéma Prisma) dans le même sprint. Chaque vague se termine par une passe responsive sur les 5 largeurs (360/390/768/1024/1440) et par `npm run lint` + `npm run build` + les suites de tests existantes.

---

## 10. Plan de réalisation recommandé (vue d'ensemble)

1. **Semaine 1** : atelier de validation des questions de la section 12 (surtout modèle de coût, capacité, préférences de rappel). Écriture des tests C1. Décision sur C3 avec le propriétaire du workflow n8n.
2. **Semaines 2-3** : C2, C4, C5. Correction responsive R1/R3/R6 en profitant du passage sur les composants concernés.
3. **Semaines 4-6** : N1 + A1 (espace personnel), A7 + A8 (espace client), A5 (Comexa Space). Trois espaces progressent en parallèle sur des fichiers disjoints.
4. **Semaines 7-9** : N3 + A4 + C6 côté équipe, N5/N6 côté client. Rejouer la matrice responsive sur les nouveaux écrans.
5. **Semaines 10-12** : N2, A3, A6, N7. Puis, seulement si le modèle de coût est validé, lancer N4 ; N8 en dernier, une fois C5/C6/A4/N5 stabilisés.

Ce plan privilégie **la valeur perçue chaque semaine** et **la faible régression** : les deux premières vagues ne créent aucune table financière et ne touchent pas aux flux devis/facture existants.

---

## 11. Risques techniques, fonctionnels et de sécurité

### 11.1 Sécurité — points à documenter immédiatement (aucune correction faite ici)

| Niveau | Risque | Élément vérifié | Action recommandée |
| --- | --- | --- | --- |
| **P0** | Transmission du JWT de session complet à un webhook n8n externe. Le workflow n'est pas dans le dépôt : traitement du secret non vérifiable. | `src/app/api/agent-chat/route.js:81-96` ; `AiAgentDrawer.jsx:21-24`. | C3 : délégation à portées minimales, non-conservation contractuelle du secret, journalisation locale. **Aucune fuite avérée constatée — risque de surface d'attaque.** |
| **P0** | Vérification e-mail désactivée en production, inscription publique active. | `render.yaml:79-80` ; `auth.service.ts:374-455` ; `/inscription`. | C2 : activer le flag, limiter l'inscription, surveiller les envois Mailjet. |
| **P0** | Politique de séparation des espaces non testée. Toute évolution des permissions peut casser la frontière privé/équipe sans que la CI le voie. | `space-policy.ts:1-30` ; aucun `*.test.*` ne le référence. | C1 : suite de tests en CI avant toute autre modification. |
| **P1** | Nouvelles routes proposées (N3, N5, N6) manipulent des identifiants d'objets : risque de contournement si le `clientId` est lu dans le corps. | Pattern déjà correct dans `modification-request.service.ts:36-83` et `dashboard.controller.ts` (aucun identifiant dans les DTO de périmètre). | Imposer le même pattern : périmètre issu du jeton, 404 (pas 403) sur objet d'autrui. |
| **P1** | Affichage d'un audit enrichi (A5) pourrait exposer un secret si la redaction est contournée. | `common/audit/redact.ts` filtre à la diffusion. | Réutiliser `presentAuditLog` tel quel ; test de non-régression sur les mots-clés sensibles. |
| **P1** | Jetons d'intégration sans durée de vie maximale ni suivi d'usage (A6). | `integrations/page.jsx`, `IntegrationToken`. | Durée maximale + dernière utilisation, sans écrire en base à chaque requête chaude. |
| **P2** | `X-Comexa-Space` est un en-tête **facultatif** : sans lui, le porteur garde les droits complets de son rôle. | `access.guards.ts:229-233`, `space-policy.ts:1-30`. | Ce n'est **pas une fuite** : la séparation des tâches privées est aussi appliquée au niveau des lignes (`task-access.service.ts`, `tasks.service.ts:332-339`). Mais il faut le rappeler : l'espace est une restriction contextuelle, pas une frontière de sécurité. À ne pas durcir sans casser les intégrations n8n. |
| **P2** | `/api/health` est public et expose la famille d'hébergement de la base et la version du contrat. | `health.controller.ts`, `health/database-target.ts`. | Information volontairement peu détaillée (pas d'hôte/URL). Ne pas ajouter de détails dans la future vue N7 côté public. |
| **Information** | 4 vulnérabilités `npm audit` non corrigées (Prisma 7 / deepmerge-ts / mysql2), documentées et justifiées dans `backend/docs/security-audit.md` (29/09/2026). | Document du dépôt. | Ne pas lancer `npm audit fix --force`. Réévaluer à la prochaine montée de version Prisma. |

### 11.2 Risques techniques

- **Croisement media queries / container queries** (R5) : un changement de la coque peut décaler les grilles sur tablette paysage. Toute proposition doit être testée sur les 5 largeurs.
- **Volume d'audit pour N1** : déduire les reports depuis `AuditLog` est élégant en v1 mais peut devenir coûteux ; prévoir un agrégat hebdomadaire si la table grossit.
- **Cron et idempotence** (C5, C6, N8) : le dépôt a déjà un exemple propre (`invoice-overdue.service.ts` avec `sweepOverdue` testable sans attendre le cron). Réutiliser ce patron, sinon risque de relances en double.
- **Migrations financières** (N4) : toute modification des modèles `Invoice`/`Distribution*`/`Balance*` doit respecter la règle documentée dans le README : une opération validée ne se supprime jamais, on passe par une contre-opération.
- **Performance perçue sur mobile** : `ControlCenter.jsx` et `ComexaOverview.jsx` lancent de nombreuses requêtes en parallèle. Les nouvelles cartes (N7, N3) doivent paginer/agréger côté serveur plutôt que multiplier les appels.
- **Dépendance au workflow n8n externe** : C3 et toute évolution de la console IA dépendent d'un composant hors dépôt, non testable ici.
- **Désynchronisation desktop/Android** : les nouvelles entités (N5, N6) devront être ajoutées à la whitelist de synchronisation hors ligne (`desktop/offline-*`) et au contrat API (`src/lib/contract.js`), sinon les apps lourdes afficheront des données périmées.

### 11.3 Risques fonctionnels

- **Spam de notifications** (C5, C6, N8) : sans préférences utilisateur et quiet hours, les rappels se retournent contre le produit.
- **Chiffre de rentabilité faux** (N4) : un taux de revient mal renseigné produit une marge trompeuse, pire que pas de marge.
- **Confusion client** (N5, N6) : de nouveaux statuts et de nouvelles actions doivent être expliqués en français, avec une seule « prochaine étape » visible.
- **Perte de repères** (A7) : supprimer le `DataView` du tableau de bord client sans garder un lien vers la vue détaillée ferait perdre des indicateurs à certains utilisateurs.
- **Estimations absentes** : N1/N2 dépendent de `estimateMinutes`, qui est facultatif. Prévoir un mode dégradé explicite (« estimation inconnue ») plutôt qu'un calcul à zéro.

---

## 12. Questions restant à valider auprès des utilisateurs

| # | Question | À qui | Pourquoi c'est bloquant |
| --- | --- | --- | --- |
| 1 | Utilisez-vous réellement les estimations de temps (`estimateMinutes`) ? Si non, faut-il les rendre obligatoires ou les déduire du minuteur ? | Équipe + utilisateurs personnels | N1 et N2 n'ont de valeur que si cette donnée est fiable. |
| 2 | Quelle est votre définition d'une journée de travail (heures, pauses, week-end, fuseau) ? | Équipe | N2 (charge réaliste) et A3 en dépendent. |
| 3 | Combien de fois une tâche est-elle reportée avant que vous considériez qu'il y a un problème ? | Utilisateurs personnels | Calibre la règle de détection de N1. |
| 4 | Qui doit être « de permanence » sur les demandes entrantes, et à quelle fréquence ? | Équipe | N3 (triage) sans responsable = une file de plus. |
| 5 | Quel modèle de coût pour la rentabilité : taux horaire par membre, forfait projet, charges incluses ? | Direction / finance | N4 ne peut pas être lancé sans réponse. |
| 6 | Qui a le droit de voir une marge : ADMIN seulement, PROJECT_MANAGER, SALES ? | Direction | Impacte directement le catalogue de permissions. |
| 7 | Quelles notifications voulez-vous recevoir, sur quels canaux et à quelles heures ? | Tous | Évite le spam de C5/C6/N8. |
| 8 | Que fait un client aujourd'hui quand il voit un supplément sur une demande de modification ? | Clients + équipe | Confirme le besoin N6 et la forme du geste d'acceptation. |
| 9 | Quelles sont les trois questions que les clients posent le plus souvent au support ? | Équipe | A7/A8/N5 doivent répondre à ces questions en priorité. |
| 10 | Quels moyens de paiement sont réellement utilisés (virement, CCP, BaridiMob, espèces) et quelles informations figurent sur la facture ? | Finance + clients | Décide si une consigne de paiement suffit ou si un projet SATIM est à lancer. |
| 11 | Le workflow n8n conserve-t-il les journaux des requêtes reçues et que fait-il du JWT ? | Propriétaire de l'intégration | C3 ne peut pas être tranché sans cette réponse. |
| 12 | Les recettes navigateur de `docs/dashboard-design-audit.md` ont-elles été rejouées sur la charte soft UI actuelle ? | Équipe front | L'analyse responsive de ce rapport est statique ; une validation réelle reste nécessaire. |

---

## 13. Sources consultées

**Toutes les pages ont été consultées le 27 octobre 2026.** Les sources marquées « tiers » sont des revues ou analyses externes, utilisées uniquement pour des informations non disponibles chez l'éditeur, et signalées comme telles dans le corps du rapport.

| # | Éditeur / source | Titre et URL | Date de publication ou de mise à jour constatée |
| --- | --- | --- | --- |
| S1 | Todoist (officiel) | Features — Quick Add, dates récurrentes, objectifs et visualisations — https://www.todoist.com/features | Page consultée le 27/10/2026 |
| S2 | Todoist (officiel) | Plans and pricing (Beginner / Pro / Business, devises proposées) — https://www.todoist.com/pricing | Page consultée le 27/10/2026 |
| S3 | TickTick (officiel) | Beginner's Guide : Tasks, Calendar, Eisenhower Matrix, Pomodoro, Habit Tracker — https://help.ticktick.com/articles/7054286604315131904 | Centre d'aide, consulté le 27/10/2026 |
| S4 | TickTick (officiel) | Features : vues calendaires, Kanban, Timeline, Eisenhower — https://ticktick.com/?language=en_US | Page consultée le 27/10/2026 |
| S5 | Sunsama (officiel) | Timeboxing : Task Projections, verrouillage, estimation IA, temps réel — https://www.sunsama.com/features/timeboxing | Page consultée le 27/10/2026 |
| S6 | Sunsama (officiel) | Pricing Manifesto : 22 $/mois, 204 $/an, 14 jours sans carte, refus du free forever — https://help.sunsama.com/docs/billing/pricing-manifesto/ | Document officiel, consulté le 27/10/2026 |
| S7 | Structured (officiel) | Matrice des fonctionnalités gratuites / Pro par plateforme — https://help.structured.app/en/articles/1897986 | Article « Edited 5 months ago » (≈ mai 2026) |
| S8 | Structured (officiel) | Fiches App Store et Google Play (timeline, Pomodoro, widgets, accessibilité) — https://apps.apple.com/us/app/structured-daily-planner-todo/id1499198946 et https://play.google.com/store/apps/details?id=io.unorderly.structured | Fiches mises à jour en 2026 |
| S9 | Habitbox (tiers) | Structured App Review 2026 : écarts Android/iOS, prix — https://habitbox.app/blog/structured-app-review | 09/10/2026 — **source tierce** |
| S10 | Linear (officiel) | Triage : file d'entrée, accepter/refuser/doublon/snooze, responsabilité tournante — https://linear.app/docs/triage | Documentation consultée le 27/10/2026 |
| S11 | Linear (officiel) | Inbox : onglet Priority, snooze, reminders, actions depuis la notification — https://linear.app/docs/inbox | Documentation mise à jour le 16/07/2026 |
| S12 | Linear (officiel) | Mobile / Get the app : apps natives, PWA, navigation mobile — https://linear.app/mobile et https://linear.app/docs/get-the-app | Consulté le 27/10/2026 |
| S13 | Productive (officiel) | Budgeting : budgets, profit en temps réel, alertes de dépassement, cartes de taux — https://productive.io/budgeting/ | Page consultée le 27/10/2026 |
| S14 | Productive (officiel) | Pricing : Essential / Professional, 14 jours sans carte — https://productive.io/pricing/ | Page consultée le 27/10/2026 |
| S15 | Teamwork.com (officiel) | Client Users : licence gratuite, droits projet, exclusions (rentabilité, charge) — https://support.teamwork.com/projects/using-teamwork/working-with-client-users | Base de connaissances, consultée le 27/10/2026 |
| S16 | Teamwork.com (officiel) | Using the Workload Planner : capacité, tâches non planifiées, vues semaine/mois — https://support.teamwork.com/projects/workload/using-the-workload-planner | Base de connaissances, consultée le 27/10/2026 |
| S17 | Odoo (officiel) | Sales quotations 20.0 : flux devis → commande → facture → paiement, échéances, signature/paiement en ligne — https://www.odoo.com/documentation/20.0/applications/sales/sales/sales_quotations.html | Documentation 20.0, consultée le 27/10/2026 |
| S18 | Odoo (officiel) | Access rights 19.0 : rôles, groupes, règles d'enregistrement, avertissement « impotent admin » — https://www.odoo.com/documentation/19.0/applications/general/users/access_rights.html | Documentation 19.0, consultée le 27/10/2026 |
| S19 | GitHub Docs (officiel) | Audit log events for your organization : champs `token_scopes`, `hashed_token`, `token_expires_at` — https://docs.github.com/en/organizations/keeping-your-organization-secure/managing-security-settings-for-your-organization/audit-log-events-for-your-organization | Consulté le 27/10/2026 |
| S20 | GitHub Docs (officiel) | Token expiration and revocation — https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/token-expiration-and-revocation | Consulté le 27/10/2026 |
| S21 | HoneyBook (officiel) | Announcing the new and improved client portal : jalons, tâches côté client, personnalisation — https://www.honeybook.com/blog/announcing-the-new-client-portal | 20/02/2026 (bandeau géo US/CA/UK/AU constaté le 27/10/2026) |
| S22 | HoneyBook (officiel) | HoneyBook on mobile : l'app est réservée au prestataire, les clients utilisent le web mobile — https://help.honeybook.com/en/articles/2673568-honeybook-on-mobile-key-features-for-small-business-owners | Article mis à jour il y a moins de 2 semaines (octobre 2026) |
| S23 | Assembly, ex-Copilot (officiel) | The client portal you can build on : étapes Onboard/Collaborate/Track/Transact/Support, modèles, marque blanche — https://assembly.com/client-portal | Page consultée le 27/10/2026 |
| S24 | Assembly (officiel) | Marketing agency client portal : plans, absence de facturation par client — https://assembly.com/solutions/marketing-agency-client-portal | Page consultée le 27/10/2026 |
| S25 | The Stack Architects (tiers) | Copilot Review 2026 : absence d'app native, Stripe, limites d'automatisation — https://thestackarchitects.com/copilot-review/ | 07/09/2026 — **source tierce** |
| S26 | ChartMogul / Kyle Poyar / ProductLed | The SaaS Conversion Report : 200 produits B2B, 14 jours = 62 % des essais, conversion médiane 8 % — https://chartmogul.com/reports/saas-conversion-report/ | 04/02/2026 |
| S27 | Amar Neche (tiers, technique) | Accept online payments in Algeria : CIB/Edahabia via SATIM, Stripe/PayPal inopérants — https://amarneche.me/blog/accept-online-payments-algeria | 01/10/2026 |
| S28 | DZ-Ecom (tiers, technique) | Intégrer le paiement CIB/SATIM : RC, convention bancaire, 8 à 12 semaines — https://dz-ecom.com/en/blog/integrer-paiement-cib-satim-site-ecommerce-algerie | 25/05/2026 |
| S29 | Dépôt Comexa (interne) | `README.md`, `docs/REFONTE-SOFTUI.md`, `docs/dashboard-design-audit.md`, `docs/API-N8N.md`, `docs/DEPLOIEMENT-RENDER-VERCEL.md`, `backend/docs/security-audit.md`, `backend/prisma/schema.prisma`, `src/styles/*.css` | État du dépôt au 27/10/2026 |
| S30 | GitHub Docs (officiel) | Reviewing the audit log : rétention 180 jours / 7 jours pour les événements Git — https://docs.github.com/en/enterprise-cloud@latest/organizations/keeping-your-organization-secure/managing-security-settings-for-your-organization/reviewing-the-audit-log-for-your-organization | Consulté le 27/10/2026 |

**Note de vérification sur les marques** : le produit anciennement « Copilot » (portail client) a été renommé **Assembly** ; l'ancien domaine `copilot.com` sert désormais Microsoft Copilot (constaté lors de la consultation). Ce rapport cite donc les pages officielles `assembly.com` **[S23][S24]** et signale la revue tierce **[S25]** comme telle. Les prix des outils tiers (TickTick, Teamwork, HoneyBook) varient selon les sources et les périodes : ils ne sont pas repris comme des vérités officielles dans ce rapport.

---

## 14. Conditions de validation — état final

- **Aucun fichier applicatif modifié** : ni code source, ni API, ni modèle Prisma, ni migration, ni configuration. Le seul fichier créé pour cette mission est `docs/AUDIT-ESPACES-OPPORTUNITES.md`.
- Les dépendances installées (`node_modules/`, `desktop/node_modules/`) et les artefacts de build (`.next/`) sont des répertoires non suivis par Git, utilisés uniquement pour exécuter les vérifications ; `git status` ne montre aucun fichier applicatif modifié.
- Les quatre espaces ont été analysés, les parcours critiques ont été reconstitués depuis le code, les concurrents ont été consultés sur leurs sources officielles, l'responsive a été traité comme un sujet à part entière avec cinq points de contrôle, et chaque proposition porte ses critères mesurables, ses impacts permissions et sa mini-spécification responsive.
- **Limite explicite** : faute de navigateur et de base de données dans l'environnement, aucune vérification visuelle en conditions réelles n'a pu être rejouée. La matrice responsive de la section 5 doit être validée sur appareils avant le développement des vagues V1-V3.


