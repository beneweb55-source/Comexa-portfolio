# Mission 4 — Audit approfondi et amélioration de l’Espace client

**Date :** 28 octobre 2026  
**Branche :** `arena/c1004795-comexa-portfolio`  
**HEAD de référence :** `1ae6d10`  
**Rapports antérieurs lus et non modifiés :** `docs/AUDIT-INCOHERENCES-METIER.md`, `docs/AUDIT-ESPACES-OPPORTUNITES.md`, `docs/STRATEGIE-SAAS-AUDIT.md`, `docs/AMELIORATION-ESPACE-PERSONNEL.md`, `docs/AMELIORATION-ESPACE-EQUIPE.md`, `docs/REFONTE-SOFTUI.md`, `docs/dashboard-design-audit.md`.  
**Règle de cadrage :** toutes les corrections Phase 1 / Missions 2 et 3 sont conservées. Aucun rapport antérieur n’a été modifié. Aucune migration, aucun nouveau statut Prisma, aucune nouvelle permission et aucun endpoint backend métier n’ont été ajoutés.

---

## 1. Résumé exécutif

L’Espace client possédait déjà de vraies fondations : suivi de projet, devis, factures, documents, messagerie, notifications et demandes de modification. Le défaut principal n’était pas l’absence de modules, mais **leur présentation fragmentée et leur langage trop interne**.

Trois problèmes dominaient :

1. **L’accueil ne répondait pas à la première question du client : « qu’attend-on de moi ? »**  
   La page d’arrivée `/espace-client` affichait quatre KPI descriptifs ; `/espace-client/tableau-de-bord` affichait encore un `DataView` générique qui devinait des libellés depuis les clés JSON. Un client pouvait voir « open », « pending », « byStatus » sans savoir s’il devait répondre à un devis, régler une facture ou lire un message.
2. **Le suivi de projet ne racontait rien.**  
   Le détail projet montrait une barre de progression et des jalons, mais aucune explication du statut, aucune prochaine étape et aucune chronologie lisible. Le fil d’activité client existe bien côté backend, mais il est inaccessible au rôle `CLIENT` car `activity:read:own` n’est pas dans son jeu de permissions.
3. **Certaines boucles restaient incomplètes ou peu claires.**  
   Un devis expiré disait « contactez l’agence » sans lien ; une facture ne distinguait pas clairement « réglée » de « solde restant » ; une demande de modification avec supplément proposé montrait le montant sans expliquer au client comment donner son accord ; une notification de facture ouvrait le tableau de bord générique au lieu de la liste des factures.

La première tranche retenue est volontairement limitée et sûre : **un accueil orienté actions, un récit de projet basé sur les seuls jalons déjà visibles par le client, et quatre clarifications ciblées sur devis / factures / modifications / liens profonds**. Elle améliore fortement la compréhension sans inventer de règle métier, sans exposer de donnée interne et sans reconstruire les modules existants.

---

## 2. Cartographie de l’Espace client

### 2.1 Pages réellement présentes

| Rubrique | Chemin réel | Remarque |
| --- | --- | --- |
| Accueil après connexion | `/espace-client` | `homeFor()` renvoie ici pour un compte non membre ; c’est donc le premier écran. |
| Tableau de bord | `/espace-client/tableau-de-bord` | Second écran de synthèse. |
| Projet | `/espace-client/projets/[id]` | Il n’existe **pas** de liste `/projets` côté client. |
| Devis | `/espace-client/devis/[id]` | Il n’existe **pas** de liste `/devis` côté client. |
| Factures | `/espace-client/factures` | Liste + PDF + solde. |
| Commandes | `/espace-client/commander` | Commande de pack. |
| Modifications | `/espace-client/modifications` | Dépôt et suivi. |
| Messagerie | `/espace-client/messagerie` | `MessagingPanel`. |
| Notifications | `/espace-client/notifications` | `NotificationsPanel`. |
| Compte | `/espace-client/compte` | Compte client. |

Le layout `src/app/(session)/espace-client/layout.jsx` utilise `RequireSession` + `WorkspaceShell`. La navigation est construite à partir de permissions explicites ; elle ne propose pas de rubriques projets/devis en liste, ce qui a été respecté dans les nouveaux liens.

### 2.2 Backend et permissions

- `ROLE_PERMISSIONS[RoleCode.CLIENT]` — `backend/src/common/auth/permissions.catalogue.ts:509-528` — donne notamment `project:read:own`, `milestone:read:any`, `quote:read:own`, `quote:accept:own`, `invoice:read:own`, `document:read:client`, `modificationrequest:read:own`, `message:read:own`, `notification:read:own`, `dashboard:read:own`.
- Aucune permission `task:*`, `time:*`, `activity:*`, `report:*` ou `document:read:any` n’est accordée au client.
- `projectScopeWhere('own', { isClient: true, clientId })` — `backend/src/modules/projects/project-scope.ts:88-111` — filtre sur `clientId` du jeton, jamais sur un paramètre de requête.
- `resolveDocumentAccess` — `backend/src/modules/documents/document-visibility.ts:92-103` — limite le client à `CLIENT` et `PUBLIC`, même si un droit trop large était ajouté par erreur.
- `ActivityService.listForProject(..., { asClient: true })` — `backend/src/modules/activity/activity.service.ts:142-148` — force `isClientVisible: true`. `ProjectsService.listActivities` l’utilise bien (`projects.service.ts:727-732`), mais `GET /projects/:id/activities` exige `activity:read:own`, absent du rôle `CLIENT` : la route reste donc fermée au client.
- `DashboardController.client` — `backend/src/modules/dashboard/dashboard.controller.ts:53-58` — n’accepte aucun `clientId` : le périmètre vient du jeton.
- `ModificationRequestService` — `backend/src/modules/content/modification-request.service.ts` — construit son `where` avec `clientId` du porteur et une décision `decide:any` réservée à l’agence.

### 2.3 Composants partagés concernés

- `DataView` reste utile pour les rapports internes ; il n’a pas été supprimé, seulement retiré du tableau de bord client.
- `notification-links.js` est partagé ; seule la destination client des liens `/factures/...` a été corrigée.
- `softui.productivity.css` est partagé ; les styles Mission 4 sont ajoutés en fin de fichier avec un préfixe `client-`, sans modifier les règles des autres espaces.
- `quote-attention.mjs` de la Mission 3 est réutilisé pour le bandeau d’échéance côté client.

---

## 3. Parcours métier réels

### Parcours A — Le client se connecte

**Avant :** le client arrivait sur `/espace-client` et voyait quatre KPI : projets, devis, commandes, demandes. Les devis à décider étaient plus bas, les factures absentes de l’accueil, les messages non lus absents. `/tableau-de-bord` affichait `DataView`, donc des clés JSON.

**Après :** le premier écran commence par « À faire de votre côté », puis « Vos projets », « Vos factures » et « Vos échanges ». Une catégorie vide reste discrète : si rien n’attend le client, un état calme « Rien ne demande votre intervention » remplace les KPI décoratifs.

### Parcours B — Le client suit un projet

**Avant :** barre de progression, échéance, chef de projet, jalons, documents. Aucune phrase expliquant `IN_PROGRESS`, `ON_HOLD` ou `IN_REVIEW`, aucune prochaine étape.

**Après :** `ClientProjectStory` explique le statut, affiche la prochaine étape connue à partir des jalons, puis une frise « étapes terminées / en cours / à venir ». Aucune date ni responsable n’est inventé. Le nom du chef de projet, information interne non nécessaire, a été retiré de cette vue.

### Parcours C — Le client reçoit un devis

Le client voit le montant TTC, le détail des prestations, la date de validité, les conditions, le PDF, puis une décision en deux temps. La Phase 1 avait déjà corrigé l’expiration dérivée : `EXPIRED` est renvoyé par l’API et `QUOTE_OPEN_STATUSES` exclut ce statut.

**Améliorations :** bandeau « expire aujourd’hui / demain / dans N jours » réutilisant `quoteFollowup`, confirmation d’acceptation plus explicite, et remplacement du simple « contactez l’agence » par un lien réel vers la messagerie lorsqu’un devis est expiré. Aucune relance automatique n’a été ajoutée.

### Parcours D — Le client demande une modification

Le client peut déposer une demande et voir le statut, la note de décision et `extraCost`. Le backend ne possède **aucun champ de décision client** et aucune route permettant au client d’accepter/refuser formellement un supplément : `PATCH /modification-requests/:id` est protégé par `modificationrequest:decide:any`.

**Décision de mission :** ne pas ajouter un faux bouton. La page explique désormais la réponse, la date, le supplément et renvoie vers la messagerie. La boucle formelle est documentée comme différée car elle exige une décision produit, de nouveaux champs et une permission stricte.

### Parcours E — Le client doit payer

La liste des factures montre total, réglé, solde, échéance, statut et PDF. Il n’existe pas de RIB/CCP/lien de paiement configurable exposé par une API client ; les variables `PAYMENT_METHODS_*` concernent les commandes, pas une consigne de virement pour factures.

**Amélioration :** une facture réglée affiche « Facture réglée » au lieu de « Solde : 0 » ; un bandeau explique que les modalités doivent être consultées sur le PDF ou demandées par messagerie. Aucun moyen de paiement, RIB ou lien n’a été inventé.

### Parcours F — Le client communique

`MessagingPanel` affiche les conversations du porteur avec `unreadCount`. Les notifications utilisent `resolveNotificationHref`. Le lien `/factures/:id` pointait vers `/espace-client/tableau-de-bord`, alors qu’il n’existe pas de détail facture côté client : il pointe désormais vers `/espace-client/factures`. L’accueil agrège les messages non lus, notifications non lues et réponses de modification sans prétendre qu’une réponse est « attendue » si les données ne le disent pas.

---

## 4. Incohérences et frictions confirmées

1. **`DataView` sur le tableau de bord client** — `src/app/(session)/espace-client/tableau-de-bord/page.jsx:20,52` avant modification. Le composant générique produisait des libellés depuis les clés JSON (`open`, `pending`, `items`…). Corrigé.
2. **Accueil `/espace-client` descriptif** — KPI `Projects actifs`, `Mes devis`, etc. sans action prioritaire. Corrigé par `ClientFocusBoard`.
3. **Lien de notification facture incorrect** — `src/lib/notification-links.js:44` avant modification renvoyait `/espace-client/tableau-de-bord`. Corrigé vers `/espace-client/factures`.
4. **Devis expiré sans action** — `devis/[id]/page.jsx:93` avant modification : simple texte « contactez l’agence ». Corrigé par un lien de messagerie.
5. **Facture réglée encore présentée avec un solde** — `factures/page.jsx:111-113` avant modification. Corrigé.
6. **Aucune consigne de paiement honnête** — absence de données configurées. Ajout d’un message explicitant le manque, sans inventer de coordonnées.
7. **Supplément de modification non décisionnable en ligne** — confirmé : `DecideModificationRequestDto` accepte `extraCost` mais la route est `decide:any`; aucun champ `clientDecision*`, aucune route client. Amélioration de la clarté, décision formelle différée.
8. **Activité client prête mais inaccessible** — `ActivityService.listForProject` filtre correctement, mais `activity:read:own` n’est pas dans `ROLE_PERMISSIONS.CLIENT`. La frise utilise donc les jalons, pas les activités internes.
9. **Statuts projet non expliqués** — `PLANNED`, `ON_HOLD`, `IN_REVIEW` étaient de simples badges. Corrigé.
10. **Risque de fuite de données personnelles internes** — l’ancien détail projet affichait le nom du chef de projet. Retiré du nouveau récit.
11. **Dette connue conservée visible** — `src/app/api/agent-chat/route.js:84` transmet toujours le JWT complet à n8n ; `render.yaml:79-80` garde `EMAIL_VERIFICATION_REQUIRED=false`. `space-policy.ts` n’avait pas de tests ; la Mission 4 ajoute cinq tests backend purs qui couvrent notamment `accessibleSpaces` et `effectivePermissions`.

---

## 5. Analyse de l’intuitivité

**Actions réelles uniquement.** Le modèle `buildClientFocus` ne propose que des liens vers des pages existantes : détail devis, liste factures, messagerie, notifications, projet. Un devis `EXPIRED`, `ACCEPTED`, `REJECTED`, `DRAFT` ne crée aucune action. Une facture `PAID`, `CANCELLED`, `REFUNDED` ou à solde zéro ne crée aucune action. Une demande de modification déjà traitée n’est pas une action en attente ; elle devient une information discrète dans « Vos échanges ».

**Donnée absente ≠ zéro.** Les sources non chargées alimentent `model.unknown`. L’interface affiche alors « Le solde de vos factures n’est pas disponible » plutôt que « 0 DA ». Les erreurs API sont regroupées dans un message calme ; les autres sections restent affichées.

**Statuts expliqués.** `buildProjectStory` traduit chaque statut projet en phrase métier. Pour `ON_HOLD`, le texte dit « Le projet est en pause. Aucune date de reprise n’est indiquée ici. » — il ne dit jamais « en attente du client » sans donnée. Une étape `MISSED` est « Échéance dépassée », sans accusation.

**Prochaine étape honnête.** Le prochain jalon est le premier jalon `IN_PROGRESS`, sinon le premier jalon ouvert par date. S’il n’y en a pas, l’écran dit explicitement qu’aucune étape datée n’a été publiée. Aucune date, tâche ou responsabilité n’est générée.

**Confidentialité.** Le nouveau hook ne demande que `/dashboard/client`, `/quotes`, `/invoices`, `/modification-requests`, `/conversations`, `/projects` et `/projects/:id/milestones`. Il ne demande ni tâches, ni temps, ni budget, ni activités, ni documents internes. Le filtrage documentaire reste backend : `document-visibility.ts` exclut `INTERNAL` pour un client.

**Décisions sensibles.** L’acceptation de devis garde sa confirmation en deux temps et son garde-fou `useAction.busy`. Le test navigateur vérifie qu’un second clic pendant la requête ne produit qu’un seul POST. Aucune décision de supplément n’est simulée.

**Responsive.** Les nouvelles cartes utilisent une container query, des boutons de 44 px minimum et des grilles qui passent en une colonne lorsque le conteneur est étroit — y compris à 768/1024 px où la fenêtre est large mais le panneau utile réduit.

---

## 6. Étude concurrentielle sourcée

Sources consultées le **28/10/2026**.

### HoneyBook — « Announcing the new and improved client portal »

- **URL :** https://www.honeybook.com/blog/announcing-the-new-client-portal
- **Article officiel**, « Last Modified February 20, 2026 ».
- **Fonction vérifiée :** « Key details, up front » — jalons, dates, fichiers, informations clés et tâches côté client affichés sur la page d’aperçu ; possibilité d’assigner des tâches au client avec échéance ; portail activable/désactivable par projet.
- **Problème utilisateur :** le client ne doit pas chercher dans des e-mails ce qu’il doit valider ou fournir.
- **Comparaison Comexa :** les jalons et documents existaient, mais aucun accueil ne transformait les devis, factures ou messages en actions.
- **Amélioration retenue :** bloc « À faire de votre côté », prochaine étape de jalon et lien direct vers l’écran de décision.
- **À ne pas copier :** personnalisation graphique complète, tâches client avec échéance, portail activable par projet. Comexa n’a ni modèle de tâche client ni règle d’activation ; inventer ces objets créerait une seconde source de vérité.

### Assembly — portail client unifié

- **URLs :** https://assembly.com/client-portal et https://assembly.com/solutions/marketing-agency-client-portal
- **Fonctions vérifiées :** parcours en étapes Onboard → Collaborate → Track → Transact → Support ; accueil configurable ; messages, fichiers, factures, propositions et approbations dans un même portail ; chaque client ne voit que ses données ; garde-fous de permissions et d’audit.
- **Problème utilisateur :** dispersion entre e-mails, fichiers, factures et messages.
- **Comparaison Comexa :** les modules existent déjà mais sont répartis entre accueil, factures, modifications et messagerie.
- **Amélioration retenue :** regrouper les signaux d’attention sur l’accueil, relier chaque action à sa page réelle, garder les détails dans les écrans existants.
- **À ne pas copier :** AI app builder, Stripe, paiement en ligne, magic links, 30+ apps configurables. Ce serait reconstruire un produit SaaS public hors périmètre.

### Teamwork — client users

- **URL :** https://support.teamwork.com/projects/using-teamwork/working-with-client-users
- **Fonction vérifiée :** utilisateurs clients gratuits avec droits réduits ; ils peuvent voir/commenter des éléments de projet et des fichiers, mais pas la profitabilité, les rapports, le workload ou l’administration des membres.
- **Problème utilisateur :** donner de la visibilité sans ouvrir le back-office interne.
- **Comparaison Comexa :** le rôle `CLIENT` est déjà très contraint : pas de tâches, pas de temps, pas d’activité, documents limités à `CLIENT`/`PUBLIC`.
- **Amélioration retenue :** la frise client utilise uniquement des jalons filtrés par le backend ; le récit n’affiche ni budget, ni marge, ni tâches internes, ni nom de collaborateur.
- **À ne pas copier :** autoriser le client à créer/modifier des tâches ou jalons. Le modèle Comexa ne prévoit pas ce droit et l’ajouter affaiblirait la séparation équipe/client.

---

## 7. Améliorations envisagées et raisons de leur priorité

| Catégorie | Proposition | Problème réel | Décision | Complexité / risque |
| --- | --- | --- | --- | --- |
| **1 — Corriger** | Remplacer `DataView` du tableau de bord client | Clés JSON illisibles | **Retenue** | Faible, frontend seul |
| **1 — Corriger** | Notification facture → liste factures | Lien profond inutile | **Retenue** | Faible, testée |
| **1 — Corriger** | Devis expiré → messagerie | Action impossible | **Retenue** | Faible |
| **1 — Corriger** | Facture réglée ≠ solde à payer | Confusion financière | **Retenue** | Faible |
| **2 — Améliorer** | Accueil orienté actions | Le client ne sait pas quoi faire | **Retenue** | Moyenne, plusieurs endpoints déjà autorisés |
| **2 — Améliorer** | Récit projet + prochaine étape | Progression sans histoire | **Retenue** | Moyenne, jalons existants |
| **2 — Améliorer** | Consigne de paiement honnête | Aucune coordonnée configurée | **Retenue** | Faible, sans invention |
| **2 — Améliorer** | Réponse de modification expliquée | Supplément proposé incompris | **Retenue partielle** | Faible, sans fausse action |
| **3 — Ajouter** | Décision formelle du client sur `extraCost` | Boucle incomplète confirmée | **Différée** | Élevée : nouveaux champs, permission stricte, DTO, service, migration, idempotence, UI équipe + client |
| **3 — Ajouter** | Fil d’activité client visible | Le backend sait filtrer | **Différée** | Moyenne : ajouter `activity:read:own` au rôle + seed + tests d’intégration |
| **3 — Ajouter** | Consignes de paiement configurables | Manque réel | **Différée** | Moyenne : modèle de paramètres, droits d’écriture, affichage PDF et portail |
| **3 — Ajouter** | Tâches/actions côté client | HoneyBook le fait | **Différée** | Élevée : nouveau modèle, ownership, échéances, permissions |

La combinaison retenue a le meilleur rapport valeur/risque : elle touche les écrans que le client voit dès la connexion, corrige des liens et des statuts, et reste entièrement compatible avec le backend actuel.

---

## 8. Première tranche implémentée

### 8.1 Accueil client orienté actions

- Nouveau module pur `src/lib/client-portal.mjs` : `buildClientFocus`, `buildProjectStory`, `clientModificationAdvice`, `invoiceRemaining`.
- Nouveau composant `src/components/client/ClientFocusBoard.jsx` :
  - « À faire de votre côté » avec devis `SENT`/`VIEWED`, factures à solde positif, messages et notifications non lus ;
  - « Vos projets » avec progression, explication du statut et prochaine étape ;
  - « Vos factures » avec solde restant par devise, sans addition inter-devises ;
  - « Vos échanges » avec messagerie, demandes et notifications ;
  - états vides discrets, message distinct pour données indisponibles, liens vers les vraies pages.
- Nouveau hook `src/components/client/useClientPortalData.js` : charge uniquement les endpoints déjà autorisés au client, récupère les jalons des projets actifs, distingue chargement / erreur / absence de donnée.
- `/espace-client` et `/espace-client/tableau-de-bord` utilisent ce board. `DataView` n’est plus utilisé sur ces écrans mais reste disponible ailleurs.
- `invoiceRemaining` ne fait aucune conversion de devise et ne transforme pas une donnée absente en zéro.

### 8.2 Récit de projet

- Nouveau composant `src/components/client/ClientProjectStory.jsx`.
- Le détail projet client affiche désormais :
  - statut expliqué en français métier ;
  - avancement et nombre d’étapes terminées ;
  - prochaine étape connue avec date lorsqu’elle existe ;
  - frise verticale des jalons `REACHED` / `IN_PROGRESS` / `PENDING` / `MISSED` / `CANCELLED` ;
  - message honnête lorsqu’aucune étape n’est publiée ;
  - documents partagés avec bouton de téléchargement visible.
- Aucune tâche interne, aucun temps saisi, aucun budget, aucune marge, aucune activité interne et aucun nom de collaborateur ne sont affichés.

### 8.3 Clarifications devis, factures, modifications, notifications

- Devis : bandeau d’échéance proche, expiration avec lien de messagerie, confirmation d’acceptation plus explicite, boutons de décision à 44 px.
- Factures : mention « Facture réglée », « Solde restant », et bandeau « Demander les modalités de paiement » sans inventer de RIB ni de lien.
- Modifications : conseil de lecture selon statut, date de réponse, supplément proposé, contact messagerie. Aucun faux bouton « Accepter le supplément ».
- Notifications : `/factures/:id` ouvre désormais `/espace-client/factures`.
- CSS local `client-*` avec container queries et cibles tactiles 44 px.

### 8.4 Choix produit documentés

- Le seuil de 3 jours du bandeau devis est un seuil de **présentation**, réutilisé de la Mission 3 ; l’expiration réelle reste dérivée par le backend.
- Les réponses de modification déjà traitées ne restent pas dans « À faire » ; elles sont mentionnées discrètement dans « Vos échanges ».
- Aucune relance automatique, aucun e-mail, aucun nouveau type de notification.
- Aucune permission `activity:read:own` n’a été ajoutée : l’ajout devra passer par une décision de compatibilité et un seed, pas par un raccourci frontend.

---

## 9. Fichiers modifiés

**Nouveaux fichiers**

- `src/lib/client-portal.mjs`
- `src/components/client/ClientFocusBoard.jsx`
- `src/components/client/ClientProjectStory.jsx`
- `src/components/client/useClientPortalData.js`
- `tests/client-portal.test.mjs`
- `tests/responsive-client.mjs`
- `backend/tests/client-isolation.test.mjs`
- `docs/AMELIORATION-ESPACE-CLIENT.md`

**Fichiers existants modifiés**

- `src/app/(session)/espace-client/page.jsx`
- `src/app/(session)/espace-client/tableau-de-bord/page.jsx`
- `src/app/(session)/espace-client/projets/[id]/page.jsx`
- `src/app/(session)/espace-client/devis/[id]/page.jsx`
- `src/app/(session)/espace-client/factures/page.jsx`
- `src/app/(session)/espace-client/modifications/page.jsx`
- `src/lib/notification-links.js`
- `src/styles/softui.productivity.css` — ajout local en fin de fichier.
- `backend/package.json` — `test:invariants` inclut désormais `client-isolation.test.mjs`.
- `package.json` — script `test:responsive:client`.

**Non modifiés :** tous les rapports antérieurs, tous les fichiers backend métier ou Prisma, tous les fichiers Mission 2 hors CSS partagé, tous les fichiers Mission 3 hors réutilisation de `quote-attention.mjs`.

---

## 10. Tests réellement exécutés et résultats

### 10.1 Restauration de l’environnement

Au début de la mission, `node_modules`, `backend/node_modules`, `desktop/node_modules` et le binaire Chromium avaient disparu du sandbox. Les dépendances ont été réinstallées avec `npm ci --ignore-scripts` dans les trois dossiers, puis Chromium 153.0.8010.0 a été extrait de `@sparticuz/chromium` vers `/tmp/chromium-bin` avec ses bibliothèques dans `/tmp/chromium-libs/lib`. Sans cette étape, la baseline échouait pour des raisons d’environnement, pas de code.

### 10.2 Baseline après restauration, avant modifications

- `npm run test:invariants` : **38/38 frontend, 25/25 backend**.
- `node --test tests/contract.test.mjs` : **5/5**.
- `npm test --prefix desktop` : **18/18**.
- `npx eslint` : **exit 0**.
- Chromium : **153.0.8010.0**.

### 10.3 Tests ajoutés

- `node --test tests/client-portal.test.mjs` : **11/11 pass**.
  - actions excluant devis expirés, factures réglées, demandes déjà traitées ;
  - donnée absente ≠ zéro ;
  - récit projet sans responsabilité inventée ;
  - supplément expliqué sans faux bouton ;
  - lien de notification facture ;
  - contrats de source sur les six écrans modifiés ;
  - absence de routes internes dans le projet client.
- Preuve avant/après : avec `COMEXA_TEST_SOURCE_ROOT=/tmp/comexa-head-client` contenant les versions `HEAD` des fichiers, le même test donne **8/11 pass, 3 fail**. Les trois contrats échouent bien sur l’ancien `DataView`, l’ancien projet et l’ancien devis/facture/modification.
- `backend/tests/client-isolation.test.mjs` : **5/5 pass** via `node --import tsx --test`.
  - `projectScopeWhere` pour deux clients différents ;
  - client sans `clientId` → filtre fermé ;
  - `resolveDocumentAccess` refuse `INTERNAL` même avec `document:read:any` ;
  - `ActivityService.listForProject(..., { asClient: true })` force `isClientVisible: true` ;
  - `listForClient` filtre aussi sur `clientId` ;
  - `accessibleSpaces` renvoie `[]` pour un compte `CLIENT`.

### 10.4 Suite finale

| Commande | Résultat |
| --- | --- |
| `npm run test:invariants` | **49/49 frontend, 30/30 backend, 0 fail** |
| `node --test tests/contract.test.mjs` | **5/5** |
| `npm test --prefix desktop` | **18/18** |
| `npx eslint` | **exit 0**, aucun message |
| `npm run build` | **Compiled successfully**, 66/66 pages statiques |
| `git diff --check` | **OK** |
| `npm run test:responsive:client` | **OK**, Chromium 153.0.8010.0 |
| `npm run test:responsive:personal` | **OK**, régression Mission 2 |
| `npm run test:responsive:team` | **OK**, régression Mission 3 |

### 10.5 Blocage backend connu, non masqué

`npm run build --prefix backend` a été tenté et échoue avec **921 erreurs TypeScript** parce que `backend/src/generated/prisma` ne contient que des stubs `client.js` / `enums.js`, sans déclarations `.d.ts`. `npm run prisma:generate --prefix backend` échoue ensuite sur :

```text
request to https://binaries.prisma.sh/.../schema-engine.gz.sha256 failed,
reason: Client network socket disconnected before secure TLS connection was established
```

Aucun fichier backend métier n’a été modifié par la Mission 4 ; les tests backend purs via `tsx` et le build Next sont réellement passés. Le vrai `nest build` reste à exécuter dans un environnement CI autorisé à générer Prisma.

---

## 11. État des vérifications responsive

**Réellement mesuré dans Chromium 153.0.8010.0**, avec Next dev sur `0.0.0.0:3000`, horloge figée au `2026-10-28T10:00:00Z`, locale `fr-FR`, fuseau `Africa/Algiers`, `reducedMotion: reduce` :

- 6 écrans modifiés : accueil, tableau de bord, projet, devis, factures, modifications.
- 5 largeurs : **360, 390, 768, 1024, 1440 px** → **30 mesures**.
- `documentElement.scrollWidth - innerWidth = 0` sur les 30 mesures.
- Aucun composant `.client-focus`, `.client-action`, `.client-story`, `.client-modification`, `.client-document`, `.sui-row` hors cadre.
- Hauteur minimale des cibles mesurées : **44 px** (certaines mesures à 64 px) ; largeur minimale ≥ 44 px.
- Aucune erreur `console` / `pageerror` retenue dans le résumé JSON.

**Interactions vérifiées à 390 px :**

- Devise, montants, devis proche de l’échéance et décision visibles.
- Acceptation de devis : confirmation en deux temps, un seul `POST /api/quotes/quote-open/accept` malgré un second clic programmé pendant la requête.
- Devis expiré : aucune décision, lien de messagerie présent.
- Facture : solde restant, facture réglée, consigne de paiement sans coordonnées inventées.
- Modification : supplément lisible, explication « validation en ligne pas encore disponible », contact messagerie, aucun faux bouton d’acceptation.
- Projet : prochaine étape « Maquette à valider », trois jalons, un document partagé, aucune chaîne interne.
- Isolation : `/projects/project-client-b`, `/quotes/quote-client-b`, `/documents/doc-internal/content` renvoient **404 / 404 / 404** et aucun nom de l’autre client n’apparaît.
- Aucune requête vers `/tasks`, `/activities` ou `/time-entries` depuis le projet client.
- États vide et erreur : accueil calme quand il n’y a rien à faire ; message global quand une API échoue, sans transformer l’erreur en zéro.

**Limites assumées :** les appels `/api/**` sont simulés ; il n’y a ni PostgreSQL, ni backend Nest réel, ni cookie HttpOnly réel, ni WebSocket socket.io pendant ces tests. Les logs du dev server contiennent des `ECONNREFUSED localhost:3001/socket.io` attendus, ignorés par le harness. Aucun lecteur d’écran, appareil tactile physique, zoom système 200 %, ni génération PDF réelle n’a été testé. Les régressions responsive Personnel et Équipe ont été relancées avec succès.

---

## 12. Risques et limitations restants

1. **Duplication de deux appels sur l’accueil.** La page `/espace-client` garde ses listes paginées existantes et le hook d’actions charge aussi tous les devis/projets pour calculer les priorités. C’est acceptable pour la tranche, mais à optimiser avec un endpoint d’agrégation ou un cache partagé.
2. **Agrégation côté frontend.** Les actions sont dérivées de données déjà filtrées par le backend, mais aucune agrégation serveur unique ne garantit l’ordre métier. Une future file d’attention devra déplacer cette priorisation côté backend si elle devient critique.
3. **Jalons seulement, pas activité.** La frise ne montre pas les événements `isClientVisible: true` du fil d’activité car la permission n’est pas accordée au rôle. Le récit est donc exact mais moins riche qu’un vrai journal client.
4. **Décision de supplément toujours hors ligne.** Le client peut comprendre la proposition et contacter l’équipe, mais aucune acceptation/refus structuré n’est enregistré.
5. **Consignes de paiement absentes.** Le portail dit honnêtement qu’elles sont à demander ; il ne résout pas le manque de configuration.
6. **Tests d’isolation purs, pas HTTP de bout en bout.** Les fonctions backend sont testées, mais un test d’intégration avec deux vrais comptes et une base PostgreSQL reste nécessaire.
7. **Build backend bloqué.** Prisma generate ne peut pas télécharger son moteur dans ce sandbox ; `nest build` reste non validé.
8. **Dette sécurité antérieure.** JWT transmis à n8n, vérification e-mail désactivée en production, `test:onboarding` stale. Ces points restent visibles et hors périmètre.

---

## 13. Améliorations reportées et pourquoi

1. **Boucle formelle de décision sur supplément.** Nécessite un choix produit : le client accepte-t-il seulement le supplément, ou aussi la modification révisée ? Que se passe-t-il en cas de refus ? Il faudra ajouter des champs tracés (`clientDecision`, `clientDecisionAt`, `clientDecisionNote`, version du montant), une permission `own` stricte, un DTO sans montant libre, un service idempotent avec compare-and-swap, et une vue équipe. Migration et compatibilité des demandes historiques à prévoir. Aucun faux bouton n’a été ajouté en attendant.
2. **Fil d’activité client.** Nécessite d’ajouter `activity:read:own` au rôle `CLIENT`, de relancer le seed des permissions, de vérifier que la route applique bien `asClient`, puis d’ajouter des labels compréhensibles et une limite d’événements. C’est une bonne Mission 5, mais pas un simple changement de composant.
3. **Consignes de paiement configurables.** Nécessite un modèle de paramètres, des droits d’administration, une propagation vers le PDF et le portail, et une validation juridique. Aucun RIB/CCP/BaridiMob n’a été inventé.
4. **Tâches côté client.** HoneyBook inspire cette idée, mais Comexa n’a ni modèle de tâche client, ni ownership, ni état de validation. L’ajouter maintenant créerait un nouveau système parallèle.
5. **Portail personnalisable par projet.** Assembly le propose ; Comexa n’a pas de configuration par client. Hors périmètre.
6. **Paiement en ligne.** Aucune intégration financière nouvelle dans cette mission.
7. **Rappels automatiques de devis / factures.** Nécessitent destinataire, état, idempotence, préférences et canal. La Mission 3 les avait déjà différés ; la Mission 4 conserve cette prudence.

---

## 14. Recommandation pour la mission suivante

**Mission 5 — Fermer la boucle de décision des demandes de modification, avec le backend d’abord.**

C’est le seul parcours où une action métier reste réellement impossible malgré une donnée financière déjà présente. La mission devrait commencer par une spécification courte mais complète :

1. Décider si le client valide le **supplément**, la **modification révisée**, ou les deux.
2. Ajouter des champs de décision horodatés et une version du montant proposé, sans permettre au client de saisir un montant.
3. Créer une permission `own` stricte, jamais `decide:any`, et un endpoint idempotent avec compare-and-swap.
4. Tracer la décision dans une activité `isClientVisible: true` et notifier l’équipe sans doublon.
5. Mettre à jour les écrans client et équipe, puis ajouter des tests de double soumission, de décision périmée et d’isolation entre deux clients.

En parallèle technique, il faudra réparer la génération Prisma en CI pour pouvoir exécuter un vrai `nest build`, puis transformer les tests d’isolation purs de cette mission en tests d’intégration HTTP avec deux comptes `CLIENT` réels.

Le portail est désormais plus clair et plus rassurant ; la prochaine mission doit le rendre **complètement décisionnel** sans ouvrir de droit administratif au client.
