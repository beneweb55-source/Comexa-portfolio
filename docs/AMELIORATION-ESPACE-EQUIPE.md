# Mission 3 — Amélioration de l’Espace équipe / Business

**Date :** 28 octobre 2026  
**Branche :** `arena/c1004795-comexa-portfolio`  
**HEAD de référence :** `1ae6d10`  
**Rapports antérieurs lus et non modifiés :** `docs/AUDIT-INCOHERENCES-METIER.md`, `docs/AUDIT-ESPACES-OPPORTUNITES.md`, `docs/STRATEGIE-SAAS-AUDIT.md`, `docs/AMELIORATION-ESPACE-PERSONNEL.md`, `docs/REFONTE-SOFTUI.md`, `docs/dashboard-design-audit.md`.  
**Règle de cadrage :** les corrections Phase 1 et Mission 2 sont conservées intactes. Cette mission ne reconstruit ni l’Espace personnel, ni Comexa Space, ni le portail client, ni un futur SaaS public. Elle ne crée aucune table, aucun statut, aucune migration, aucune notification et aucun calcul de marge.

---

## 1. Résumé du diagnostic

L’Espace équipe est déjà un vrai back-office : les rules métier importantes sont côté serveur, la facturation et les paiements ont des garde-fous, la séparation personnel/équipe est réelle, et les écrans Soft UI ont déjà des états de chargement, vides et d’erreur. Le problème principal n’est donc pas « l’absence de fonctionnalités », mais **la fragmentation de l’attention et la dissimulation de certains états**.

Trois constats dominent :

1. **Le Kanban imposait un geste implicite.** Avant cette mission, le statut d’une tâche ne changeait que par glisser-déposer ; toute la carte était `cursor-grab touch-none`, sans `TouchSensor` explicite. `BLOCKED` était fondu dans la colonne « En cours » et `CANCELLED` n’avait aucune colonne : une tâche annulée disparaissait du board. Le mobile et le clavier n’avaient pas d’alternative évidente.
2. **Les devis proches de leur échéance n’étaient pas signalés avant l’expiration.** La Phase 1 avait correctement corrigé l’expiration dérivée `EXPIRED` et la validité inclusive, mais l’interface ne montrait qu’une date. Rien n’aidait le commercial à repérer, la veille ou le jour même, une proposition encore décisionnable.
3. **Plusieurs files d’attention restent séparées.** `ControlCenter` agrège factures, projets, devis et échéances, mais les contacts, demandes de projet, demandes de modification et messages vivent dans d’autres rubriques. Cela invite à construire une « inbox universelle » ; or les règles d’ownership, de déduplication, d’idempotence et de préférences de notification ne sont pas encore définies.

La première tranche retenue est volontairement limitée : **rendre visibles et actionnables les statuts cachés du Kanban, et signaler les devis proches de l’échéance là où l’équipe regarde déjà**. Elle corrige des problèmes concrets sans inventer de nouvelle source de vérité.

---

## 2. Cartographie des parcours de bout en bout

| Parcours | Étapes réelles | Source de vérité | Point d’attention |
| --- | --- | --- | --- |
| **Demande → prospect → client** | `/espace-equipe/contacts`, `/espace-equipe/demandes` → `/espace-equipe/prospects` → conversion en client | `backend/src/modules/prospects/prospects.service.ts`, schéma `Prospect`/`Client` | La conversion est transactionnelle et compare-and-swap sur `convertedClientId`. Les demandes entrantes restent dans des rubriques séparées du dashboard. |
| **Devis → encaissement** | Brouillon → envoyé/consulté → accepté/refusé/expiré → projet + facture → paiement → état facture | `backend/src/modules/quotes/quote-state.ts`, `quotes.service.ts`, `backend/src/modules/invoices/invoices.service.ts`, `payments.service.ts` | `EXPIRED` est dérivé à la lecture, jour UTC inclus. `recomputePaymentState` est le seul écrivain de `amountPaid`/`status`. L’échéance proche n’était pas mise en avant. |
| **Projet → livraison** | Acceptation du devis → `createProjectFromQuote` → jalons, tâches, activité, progression → vue client | `backend/src/modules/quotes/quotes.service.ts:826,1354`, `projects.service.ts`, `milestones.service.ts`, `project-progress.ts` | La progression est recalculée à la réouverture (Phase 1). Le Kanban doit refléter les statuts réels, pas seulement quatre colonnes. |
| **Temps → finance** | `TimeEntry.minutes`/`billable` → facturation → paiements → répartition et soldes | `backend/prisma/schema.prisma:1276-1292`, `ProjectDistribution:2536`, `BalanceTransaction:2722`, `distribution-math.ts` | Le temps saisi, le montant facturé, l’encaissé, la répartition et la rentabilité sont cinq notions distinctes. Le schéma n’a ni coût, ni taux horaire, ni dépense fiable : aucune marge n’est calculée. |
| **Communication → décision** | Messages, demandes de modification, notifications, liens profonds `?tache=`, files « À suivre » | `/espace-equipe/messagerie`, `/modifications`, `ControlCenter.jsx`, backend notifications | Les événéments existent, mais il n’existe pas encore de responsable, d’état de triage ni de règle d’idempotence. Aucun rappel automatique n’a été ajouté. |

Cette cartographie confirme que les données circulent déjà ; ce qui manque, c’est une **visibilité honnête des états et une action locale claire**.

---

## 3. Fonctionnalités existantes à préserver absolument

- **Phase 1 — objectifs, devis, projets, jalons.** Un objectif vide ne peut pas être `ACHIEVED` ; un objectif atteint gèle les tâches liées ; les devis utilisent `effectiveQuoteStatus` et `quoteValidityDeadline` ; un devis envoyé ne se réécrit plus ; la progression projet est recalculée à la réouverture ; `MILESTONE_REACHED` est utilisé pour les jalons.
- **Mission 2 — Espace personnel.** Ajout rapide déterministe, valeurs reconnues visibles et éditables, « Plan du jour », report explicite à demain, distinction données absentes/zéro/erreur, CSS responsive locale. Aucun de ces fichiers n’a été modifié par Mission 3, sauf ajout en fin de `softui.productivity.css`.
- **Backend autoritaire.** `PATCH /tasks/:id/status` vérifie les permissions, la transition, les sous-tâches ouvertes, l’objectif atteint et le compare-and-swap sur l’ancien statut : `backend/src/modules/tasks/tasks.service.ts:712-784`. Le frontend ne propose que les transitions déjà connues via `src/lib/task-status.mjs`.
- **Séparation des espaces.** `src/lib/spaces.js` et l’en-tête `X-Comexa-Space` gardent les données personnelles hors du dashboard équipe. Les tests navigateur utilisent un utilisateur ADMIN d’équipe et des permissions explicites.
- **Finances.** `payments.service.ts` verrouille la facture avant paiement ; `invoices.service.ts:739,783` centralise `recomputePaymentState` et `lockForPayment`. La répartition des revenus est versionnée et idempotente, mais elle n’est pas un calcul de profit.
- **États d’interface déjà présents.** `useListing` conserve la liste affichée en cas d’erreur de rechargement, expose `items === null` pour le chargement, et les écrans utilisent déjà `Empty`, `SkeletonList`, `Notice` et `Alert`.

---

## 4. Problèmes confirmés, avec références

Références « avant » prises sur `HEAD 1ae6d10`, puis vérifiées dans le code courant avant modification.

1. **Kanban : changement de statut uniquement par DnD.** `src/app/(session)/espace-equipe/taches/page.jsx:155-158` déclarait `PointerSensor` + `KeyboardSensor`; `onDragEnd` appelait `move()` aux lignes 228-232 ; le board était rendu aux lignes 321-328. Aucun contrôle explicite n’existait.
2. **Carte entière tactile bloquée.** L’ancienne `TaskCard:372` portait `cursor-grab touch-none` sur tout l’article. Les autres contrôles de la carte — minuteur, assignation, actions — cohabitaient avec les listeners de drag posés sur le parent.
3. **Statuts réels écrasés par la projection en colonnes.** L’ancien `columnOf()` aux lignes 39-42 renvoyait `IN_PROGRESS` pour `BLOCKED` et `null` pour `CANCELLED`. Les tâches `CANCELLED` étaient donc absentes du board.
4. **Mise à jour optimistic non réconciliée.** L’ancien `move()` aux lignes 182-207 posait un override, appelait `PATCH /tasks/:id/status`, supprimait l’override en cas d’erreur, mais ne rechargeait jamais la liste. Aucun message de succès n’était affiché ; un 409 concurrent laissait l’utilisateur avec un statut local potentiellement faux.
5. **Aucun garde-fou de double soumission.** Deux changements rapides sur la même tâche pouvaient lancer deux PATCH avant que le serveur ne réponde.
6. **Échéance de devis correcte mais invisible jusqu’à l’expiration.** `quote-state.ts:31-60` dérive `EXPIRED` en jour UTC inclus ; `quotes.service.ts:190,233,256,548-556,789` applique cette vérité aux listes, détails, envoi et décision. Pourtant l’ancien `devis/page.jsx:104-107` affichait seulement « Valable jusqu’au … » et `ControlCenter.jsx` ne distinguait pas les devis encore ouverts proches de leur fin.
7. **Files d’entrée éparpillées.** `ControlCenter.jsx:198-204` charge `/projects`, `/me/tasks`, `/time-entries`, `/invoices`, `/quotes`, `/prospects`, `/orders`. Les routes `/contacts`, `/demandes`, `/modifications` et `/messagerie` ne sont pas agrégées. Une « inbox » universelle n’est pas encore justifiée.
8. **Risque de confusion finance/rentabilité.** `TimeEntry` contient `minutes` et `billable`, mais aucun coût ou rate card ; `ProjectDistribution` et `BalanceTransaction` décrivent une répartition de revenus, pas une marge. Productive et Teamwork confirment qu’un calcul de profit ou de capacité exige des paramètres absents ici.
9. **Rappels et notifications non définis.** Les types `TASK_DUE_SOON` et `DOCUMENT_SHARED` restent inventoriés sans producteur. Ajouter une relance automatique sans destinataire, état, idempotence et préférences créerait des notifications fausses ou répétées.
10. **Dette de sécurité et de tests conservée visible.** `src/app/api/agent-chat/route.js:84` transmet le JWT de session à n8n ; `render.yaml:79-80` garde `EMAIL_VERIFICATION_REQUIRED=false` ; `backend/src/common/spaces/space-policy.ts` manque de tests. Ces points restent hors périmètre de Mission 3.

---

## 5. Analyse de l’intuitivité, des statuts, permissions et états

**Statuts.** Le board parlait en quatre colonnes alors que le backend connaît six statuts. `BLOCKED` n’est pas « En cours » : c’est une tâche en cours mais bloquée. `CANCELLED` n’est pas « terminée » et ne doit pas disparaître. La nouvelle interface garde la densité des quatre colonnes, mais affiche le statut réel dans un select et regroupe les statuts hors colonnes dans une section repliée.

**Permissions.** `canWriteProjectTask` reste un miroir d’affichage : `task:write:any`, ou `task:write:own` sur une tâche assignée. Le select n’est rendu que si l’action est permise ; sinon un badge en lecture seule est affiché. En cas de 403 serveur, l’erreur est montrée et le statut est restauré. Le backend demeure la seule autorité.

**Transitions.** Les options du select viennent de `nextStatuses({ isPersonal: false })`, miroir exact de `TASK_STATUS_TRANSITIONS`. Une tâche `BLOCKED` ne propose pas `DONE` ; une tâche `DONE` ne propose que `IN_PROGRESS` ; une tâche `CANCELLED` propose `TODO`. Cela évite d’offrir une action vouée à un 422.

**Chargement / vide / erreur / succès / interdit.** Les quatre premiers états existaient déjà ; le succès de statut et l’interdiction explicite manquaient. La tranche ajoute un `Notice tone="success"`, un `Notice` d’erreur avec « Statut restauré », un badge en lecture seule, et des tests navigateur pour les états vide, erreur API, 403 et 409.

**Mobile et clavier.** Le drag n’est plus la seule porte d’entrée. Une poignée de 40 px porte les listeners DnD et reste utilisable au `KeyboardSensor` ; le select natif est focusable ; la carte n’est plus `touch-action: none`. Le formulaire de création utilise une container query, car à 768 px la fenêtre est large mais le conteneur Kanban peut être étroit.

**Fuites privées/financières.** Aucune nouvelle donnée financière n’est exposée : les bandeaux de devis utilisent des devis déjà visibles via `quote:read:any`. Aucune marge, aucun coût, aucune capacité « surchargée » et aucune donnée personnelle n’est ajoutée au dashboard équipe. Les tests avec utilisateur en lecture seule vérifient l’absence d’actions d’écriture, mais ne remplacent pas des tests backend réels de `space-policy.ts`.

**Soumissions doubles / concurrence.** Un `useRef` synchronisé interdit deux PATCH sur la même tâche dans le même tick ; les overrides optimistes sont attachés à la référence de la liste qui les a vus ; `tasks.reload()` est appelé après succès, 403 ou 409. Un conflit 409 repeint donc le statut serveur au lieu de conserver une illusion locale.

---

## 6. Étude concurrentielle sourcée — official docs consultées le 28/10/2026

### Linear — Triage et Inbox

- **Source :** [Triage](https://linear.app/docs/triage), [Inbox](https://linear.app/docs/inbox).
- **Fonctionnalité réelle :** Triage est une file pour les issues créées par intégration ou hors équipe ; actions `accept`, `decline`, `duplicate`, `snooze` ; responsabilité tournante configurable. L’Inbox sépare les notifications Priority/Other, permet snooze, reminders et actions sur l’issue depuis la notification.
- **Besoin Comexa :** réduire la dispersion entre contacts, demandes, modifications, messages et devis à échéance.
- **Comparaison :** Comexa a déjà des files séparées et une section « À suivre », mais pas de responsable, d’état de triage, de déduplication ni de préférences de rappel.
- **Amélioration inspirée :** rendre l’action visible là où l’on travaille ; distinguo entre « information » et « décision à prendre ». La tranche actuelle applique ce principe aux devis et aux cartes Kanban, sans créer d’inbox.
- **À ne pas copier :** ni Triage Intelligence/IA, ni snooze, ni rotation de responsables, ni règles automatiques avant d’avoir défini propriétaire, état, idempotence et permissions.

### Teamwork — Client users et Workload Planner

- **Sources :** [Client Users](https://support.teamwork.com/projects/using-teamwork/working-with-client-users), [Using the Workload Planner](https://support.teamwork.com/projects/workload/using-the-workload-planner).
- **Fonctionnalité réelle :** les client users ont des droits réduits : pas de profitabilité projet, pas de rapports, pas de Workload Planner. La capacité du planner est calculée à partir des heures travaillées et des indisponibilités configurées ; client/collaborator users ne peuvent pas l’ouvrir.
- **Besoin Comexa :** éviter qu’un utilisateur voie des données financières ou une alerte de charge que le modèle ne peut pas justifier.
- **Comparaison :** Comexa a déjà une séparation espace/rôle, mais `time:read:any`, facturation et répartition sont des données sensibles. Le schéma ne contient ni horaires de travail, ni indisponibilités, ni coût interne.
- **Amélioration inspirée :** garder les contrôles d’écriture et les informations financières derrière les permissions existantes ; ne pas inventer de « surcharge ».
- **À ne pas copier :** aucun graphique de capacité, aucune alerte d’overload, aucune visibilité profitabilité tant que working hours, unavailable time et coûts ne sont pas modélisés.

### Productive — Budgeting

- **Source :** [Budgeting](https://productive.io/budgeting/).
- **Fonctionnalité réelle :** budgets fixes/horaires, rate cards par client, temps et dépenses saisis, suivi de budget spend, profit et alertes de dépassement personnalisées.
- **Besoin Comexa :** distinguer temps saisi, montant facturé, encaissé, répartition et rentabilité.
- **Comparaison :** Comexa possède `TimeEntry.minutes`, factures, paiements et distributions, mais pas de rate card ni de dépense/coût fiable. Un « profit » calculé avec `amountPaid - minutes * taux inventé` serait faux.
- **Amélioration inspirée :** documenter les prérequis avant tout graphique financier ; la tranche actuelle n’ajoute aucun indicateur de marge.
- **À ne pas copier :** ni marge en temps réel, ni alerte de dépassement, ni forecast de profit sans modèle de coût et de taux validé.

### Odoo — Quotations et Access Rights

- **Sources :** [Sales quotations 20.0](https://www.odoo.com/documentation/20.0/applications/sales/sales/sales_quotations.html), [Quotation deadlines 20.0](https://www.odoo.com/documentation/20.0/applications/sales/sales/sales_quotations/deadline.html), [Access rights 19.0](https://www.odoo.com/documentation/19.0/applications/general/users/access_rights.html).
- **Fonctionnalité réelle :** Odoo décrit le flux devis → commande → livraison → facture → paiement ; les devis ont une date d’expiration visible dans l’aperçu client et les modèles peuvent calculer une expiration ; les droits sont définis par rôles/groupes avec un avertissement explicite sur les changements d’accès.
- **Besoin Comexa :** rendre la finite validity actionable avant l’expiration et ne jamais contourner les transitions par l’UI.
- **Comparaison :** Comexa a déjà le flux devis → projet/facture → paiement et une expiration dérivée correcte. Il manquait un signal d’attention avant l’échéance.
- **Amélioration inspirée :** bandeau « devis envoyés à échéance dans 3 jours » sur le tableau de bord et la liste des devis, avec un lien manuel vers le plus urgent. Aucun nouveau statut, aucun e-mail, aucune notification.
- **À ne pas copier :** ni signature/paiement en ligne, ni nouveau workflow commercial, ni modification des droits depuis le frontend.

---

## 7. Améliorations proposées et valeur métier

| Piste | Proposition | Valeur | Décision |
| --- | --- | --- | --- |
| **A — File d’attention unifiée** | Agréger contacts, demandes, modifications, messages et devis avec triage/snooze/ownership | Moins d’oubli, une seule décision par entrée | **Différée** : règles produit et idempotence absentes |
| **B — Kanban explicite** | Select de statut sur chaque carte, poignée DnD, section « Autres statuts », réconciliation serveur | Mobile, clavier, `BLOCKED`/`CANCELLED` visibles, moins de contradictions | **Retenue** |
| **C — Devis à échéance proche** | Bandeau d’attention 3 jours sur dashboard + liste, lien manuel | Relance commerciale au bon moment, sans notification parasite | **Retenue** |
| **D — Clarification finance** | Dictionnaire temps/facturé/encaissé/répartition/coût/marge et prérequis de marge | Évite les faux indicateurs de rentabilité | **Différée** |
| **E — Charge et capacité** | Horaires, indisponibilités, estimation, puis alertes configurables | Planning honnête | **Différée** : données absentes |
| **F — Rappels idempotents** | Destinataire, vérification d’état, clé d’idempotence, préférences, audit | Rappels utiles sans spam | **Différée** |

La tranche B+C a été choisie parce qu’elle touche deux écrans déjà fréquentés, réutilise des endpoints existants, n’exige aucune migration et corrige des états réellement faux ou invisibles.

---

## 8. Priorités, complexité et dépendances

| Priorité | Chantier | Complexité | Dépendances | Risque si lancé trop tôt |
| --- | --- | --- | --- | --- |
| **P0 — fait** | Statut Kanban explicite + statuts hors colonnes | Moyenne | `task-status.mjs`, `PATCH /tasks/:id/status`, permissions | Faible : règles backend déjà stables |
| **P0 — fait** | Devis proches de l’échéance | Faible | `validUntil`, statut déjà dérivé par l’API | Faible : aucun envoi automatique |
| **P1** | Tests backend réels de `space-policy.ts` | Moyenne | Environnement Prisma/CI fonctionnel | Fuite de données entre espaces non détectée |
| **P1** | Taxonomie et ownership de la file d’attention | Moyenne | Décision produit sur responsables, états, doublons | Inbox universelle vide de sens |
| **P2** | Rappels de devis/échéances idempotents | Moyenne | Préférences, canal, template, état, clé d’idempotence | Notifications répétées ou fausses |
| **P2** | Modèle de coût, rate cards, dépenses | Élevée | Décision financière + schéma + historique | Marge inventée |
| **P2** | Capacité/working hours/unavailable time | Élevée | Paramètres utilisateur, calendrier, estimation | Alertes de surcharge arbitraires |
| **P3** | Résorption dette sécurité | Moyenne | Rotation du secret n8n, Mailjet, tests d’accès | Dette connue mais non traitée |

---

## 9. Première tranche implémentée

### 9.1 Kanban : un statut explicite sans abandonner le drag

- Chaque carte lisible en écriture possède un `<select>` natif **Statut**, avec le statut courant et uniquement les transitions autorisées par `src/lib/task-status.mjs`.
- Les cartes en lecture seule affichent un badge de statut, pas de faux contrôle.
- `BLOCKED` reste dans la colonne « En cours » avec son badge, mais le select montre « Bloquée » et permet de la débloquer vers « À faire » ou « En cours ».
- `CANCELLED` et tout statut inconnu d’une API future apparaissent dans une section repliée **« Autres statuts »** ; une tâche annulée peut être rouverte en `TODO` si les droits le permettent.
- Le glisser-déposer est conservé via une **poignée dédiée** de 40 px, focusable au clavier. La carte entière n’est plus `touch-none`.
- Le changement de statut est optimiste, mais les overrides sont attachés à la liste qui les a vus : un rechargement serveur les invalide sans effet en cascade.
- Un `useRef` synchronisé empêche deux PATCH concurrents sur la même tâche ; le select est désactivé pendant la requête.
- Après succès, 403 ou 409, `tasks.reload()` recharge la vérité serveur. Un message de succès ou d’erreur explicite est affiché.
- Le formulaire de création et le sélecteur de projet sont adaptés au conteneur, pas seulement à la fenêtre.

### 9.2 Devis : une attention visible, pas une nouvelle expiration

- Nouveau module pur `src/lib/quote-attention.mjs` : fenêtre de **3 jours UTC**, uniquement pour les statuts `SENT` et `VIEWED` renvoyés par l’API.
- L’API reste seule autorité pour `EXPIRED` : le helper ne recalcule pas l’expiration, il lit une date et un statut déjà dérivés.
- Bandeau sur `/espace-equipe/devis` et dans « À suivre » du tableau de bord : « 1/3 devis envoyés arrivent à échéance dans les 3 prochains jours », avec lien vers le plus urgent.
- Les cartes de devis ajoutent une métadonnée « À relancer · Expire aujourd’hui/demain/dans N jours » et une teinte d’attention.
- Le tableau de bord priorise les devis à échéance proche dans les trois premières cartes de la file.
- **Aucune notification, aucun e-mail, aucune tâche planifiée, aucune relance automatique, aucun statut `EXPIRING_SOON`.**

### 9.3 Choix produit documentés

- **3 jours** est un seuil de présentation, pas une règle métier. Il est centralisé et testé. Si l’équipe souhaite 1, 7 ou 14 jours, une seule constante change.
- Le jour de validité est comparé en **UTC**, comme `quoteValidityDeadline` de la Phase 1. Cela évite de déclarer expiré un devis encore valable à Alger.
- `BLOCKED` n’est pas transformé en colonne : la densité du board est conservée, mais le statut réel est affiché.
- `CANCELLED` n’est pas supprimé : il est rangeable, consultable et rouvrable.
- Aucune marge, capacité ou alerte de surcharge n’a été ajoutée : les prérequis de données ne sont pas réunis.

---

## 10. Fichiers modifiés

**Nouveaux fichiers**

- `src/lib/kanban-board.mjs` — colonnes, projection des statuts, options du select.
- `src/lib/quote-attention.mjs` — fenêtre d’attention des devis, pure et sans effet.
- `tests/team-space.test.mjs` — 9 tests purs + contrat de source.
- `tests/responsive-team.mjs` — vrai test Chromium sur les trois écrans modifiés.
- `docs/AMELIORATION-ESPACE-EQUIPE.md` — ce rapport.

**Fichiers existants modifiés**

- `src/app/(session)/espace-equipe/taches/page.jsx` — Kanban, statut explicite, autres statuts, réconciliation serveur, responsive.
- `src/app/(session)/espace-equipe/devis/page.jsx` — bandeau et métadonnées d’échéance proche.
- `src/components/dashboard/ControlCenter.jsx` — bandeau « À suivre » et priorisation des devis urgents.
- `src/styles/softui.productivity.css` — ajout en fin de fichier : poignée, select, autres statuts, container query, cible du lien de relance.
- `package.json` — script `test:responsive:team`.

**Non modifiés :** tous les rapports antérieurs, tous les fichiers backend, tous les fichiers Mission 2 hors ajout CSS, aucun schéma Prisma, aucune route API, aucune migration.

---

## 11. Résultats de tests réellement exécutés

### 11.1 Baseline avant modifications Mission 3

Enregistrée au début de la mission : `npm run test:invariants` → 29/29 frontend + 25/25 backend ; `node --test tests/contract.test.mjs` → 5/5 ; desktop → 18/18 ; `npx eslint` → OK.

### 11.2 Tests ajoutés et preuve avant/après

- `node --test tests/team-space.test.mjs` → **9/9 pass**.
- Preuve que les tests détectent l’ancien comportement : avec `COMEXA_TEST_SOURCE_ROOT=/tmp/comexa-head-team` contenant les versions `HEAD` des trois écrans, du CSS et de `package.json`, le même fichier donne **6/9 pass, 3 fail**. Les trois contrats de source échouent bien sur l’ancien Kanban, l’ancien devis et l’ancien CSS.
- Les tests couvrent : `BLOCKED → IN_PROGRESS`, `CANCELLED → autres`, transitions exactes, lecture seule, fenêtre 0/1/3 jours, exclusion `DRAFT`/`ACCEPTED`/`EXPIRED`/>+3 jours, validité inclusive, tri des urgences, absence de statut inventé.

### 11.3 Suite complète après modifications

| Commande | Résultat |
| --- | --- |
| `npm run test:invariants` | **38/38 frontend, 25/25 backend, 0 fail** |
| `node --test tests/contract.test.mjs` | **5/5 pass** |
| `npm test --prefix desktop` | **18/18 pass** |
| `npx eslint` | **exit 0**, aucun message |
| `npm run build` | **Compiled successfully**, 66/66 pages statiques générées |
| `git diff --check` | **OK** |
| `CHROMIUM_EXECUTABLE=/tmp/chromium-bin CHROMIUM_LIB_PATH=/tmp/chromium-libs/lib npm run test:responsive:team` | **OK**, Chromium 153.0.8010.0, `"errors": []` |
| `CHROMIUM_EXECUTABLE=/tmp/chromium-bin CHROMIUM_LIB_PATH=/tmp/chromium-libs/lib npm run test:responsive:personal` | **OK**, régression Mission 2 : `"errors": []` |

### 11.4 Contrôles de permissions, transitions et concurrence

- Options exactes de `BLOCKED` vérifiées dans le navigateur : `Bloquée (actuel)`, `À faire`, `En cours`, `Annulée` — pas de `Terminée`.
- Un seul PATCH envoyé pour `task-todo` malgré un second événement `change` pendant la requête ; payload `{ "status": "IN_PROGRESS" }`.
- Réouverture `CANCELLED → TODO` vérifiée avec PATCH réel simulé.
- Utilisateur lecture seule : 0 select d’écriture, 0 poignée DnD, 0 PATCH.
- 409 concurrent : le serveur simulé force `IN_REVIEW`, l’écran affiche « Statut restauré » puis le select repasse à `IN_REVIEW`.
- 403 backend : message « Droits insuffisants », statut local restauré à `TODO`.
- États vide et erreur API : aucun bandeau de relance, messages d’erreur visibles, aucun contrôle de statut fantôme.

### 11.5 Blocage backend connu, non masqué

`npm run build --prefix backend` a été tenté et échoue avec **921 erreurs TypeScript** parce que `backend/src/generated/prisma` ne contient que `client.js` et `enums.js`, sans déclarations `.d.ts`. `npm run prisma:generate --prefix backend` échoue ensuite sur :

```text
request to https://binaries.prisma.sh/.../schema-engine.sha256 failed,
reason: Client network socket disconnected before secure TLS connection was established
```

Aucun fichier backend n’a été modifié par Mission 3 ; ce blocage environnemental est antérieur et doit être traité dans un environnement CI capable de générer Prisma. Le build Next et les invariants backend via `tsx` restent verts.

---

## 12. Validation responsive et limites exactes

**Réellement mesuré dans Chromium 153.0.8010.0**, avec Next dev sur `0.0.0.0:3000`, horloge figée au `2026-10-28T10:00:00Z`, locale `fr-FR`, fuseau `Africa/Algiers`, `reducedMotion: reduce` :

- 3 écrans modifiés : `/espace-equipe/taches`, `/espace-equipe/devis`, `/espace-equipe/tableau-de-bord`.
- 5 largeurs chacun : **360, 390, 768, 1024, 1440 px** → 15 mesures.
- `documentElement.scrollWidth - innerWidth = 0` sur les 15 mesures.
- Aucun composant `.sui-kcard`, `.sui-newtask`, `.sui-kanban-others`, `.sui-queue-followup` hors cadre.
- Hauteur minimale des cibles mesurées : **40 px** ; largeur minimale : **40 px** sur le Kanban, ≥ 125 px sur les liens de relance.
- `touchAction` de la carte : `auto`, pas `none`.
- Focus clavier vérifié sur le select, nom accessible `Changer le statut de la tâche …`, Tab avance vers une autre commande.
- Aucune erreur `console`/`pageerror` retenue dans le résumé JSON.

**Limites assumées :**

- Les appels `/api/**` sont simulés par Playwright. Il n’y a **ni PostgreSQL, ni backend Nest réel, ni cookie HttpOnly réel, ni WebSocket socket.io** pendant ces tests. Les logs du dev server contiennent des `ECONNREFUSED localhost:3001/socket.io` attendus, ignorés par le harness.
- Les permissions sont simulées par un objet utilisateur et par des réponses 403/409 ; cela valide le comportement frontend, pas la politique backend `space-policy.ts`.
- Aucun lecteur d’écran réel, aucun appareil tactile physique, aucun test de contraste automatisé, aucun zoom 200 % système n’a été exécuté.
- `reducedMotion: reduce` était activé : les animations n’ont pas été évaluées.
- Le seuil de 3 jours est testé avec une horloge fixe ; un passage de minuit UTC en production suit la règle backend déjà inclusive.
- La régression responsive Mission 2 a été relancée après l’ajout CSS, mais les tests PDF, paiement réel, e-mail et notifications n’ont pas été rejoués avec des services externes.

---

## 13. Problèmes différés et prérequis

1. **File d’attention unifiée.** Nécessite une taxonomie des événements, un responsable, un état (`NEW`/`TRIAGED`/`DECLINED`/`SNOOZED`), une règle de doublon, une clé d’idempotence, des permissions par type et un lien d’audit. Sans cela, une inbox ne serait qu’une cinquième liste.
2. **Rappels automatiques de devis.** Nécessitent destinataire, vérification d’état avant émission, idempotence, canal, template, préférences utilisateur et journal d’envoi. La tranche actuelle est volontairement un simple bandeau.
3. **Notifications Priority/snooze.** Les types morts `TASK_DUE_SOON` et `DOCUMENT_SHARED` doivent rester inventoriés jusqu’à ce qu’un producteur et une UI soient décidés ensemble.
4. **Rentabilité et marges.** Nécessitent rate cards, coûts internes, dépenses, modèle de facturation et historique. La répartition des revenus n’est pas une marge.
5. **Charge de travail.** Nécessitent horaires contractuels, indisponibilités, congés, estimations et règles d’alerte. Aucun « surchargé » n’est affiché aujourd’hui.
6. **Tests de fuite financière/privée.** `space-policy.ts` doit être testé avec de vrais rôles backend, notamment client users et `time:read:any`.
7. **Dette sécurité.** Rotation/limitation du JWT envoyé à n8n, activation de `EMAIL_VERIFICATION_REQUIRED` quand Mailjet est prêt, tests d’accès. Ces éléments restent visibles et hors périmètre.
8. **CI backend.** Restaurer `prisma generate` dans un environnement autorisé à télécharger `schema-engine`, puis exécuter un vrai `nest build`. Le script `test:onboarding` reste également stale et référence des fichiers absents.

---

## 14. Recommandation pour la prochaine mission

**Mission 4 — « Décider la file d’entrée Business », pas « construire une inbox ».**

L’étape suivante la plus utile est de transformer la Piste A en spécification exécutable, mais en commençant par les règles, pas par l’UI :

1. Inventorier les événements entrants : contact, demande de projet, demande de modification, message non lu, devis à échéance, facture en retard, tâche en retard.
2. Pour chaque type, définir : destinataire ou responsable, état de triage, action possible, condition de clôture automatique, règle de déduplication, clé d’idempotence et permission backend.
3. Ajouter un endpoint backend agrégé, filtré par espace et permissions, sans nouvelle table si une vue dérivée suffit.
4. Ajouter des tests de transition, de non-duplication et de non-fuite avant toute notification ou snooze.
5. Ensuite seulement, enrichir « À suivre » avec des actions `accept`/`decline`/`snooze` à la Linear, et éventuellement des préférences de rappel.

En parallèle technique, il faudra réparer la génération Prisma en CI et écrire les tests manquants de `space-policy.ts`. Ce préalable est indispensable avant d’élargir encore les données visibles dans le dashboard équipe.
