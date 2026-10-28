# Mission 6 — Audit transversal global de Comexa Portfolio

**Date :** 28 octobre 2026 (Africa/Algiers)  
**Branche :** `arena/c1004795-comexa-portfolio` — HEAD de départ `1ae6d10`  
**Périmètre :** l'ensemble des quatre espaces (personnel, équipe, client, Comexa Space), leurs composants partagés, règles métier, permissions, notifications, navigation et build backend. Aucune refonte, aucune nouvelle fonctionnalité, aucune migration.

---

## 1. État initial réel du dépôt

### 1.1 Git et fichiers non commités

| Élément | État |
|---|---|
| Branche active | `arena/c1004795-comexa-portfolio`, HEAD `1ae6d10` (fusion de PR #50) |
| Modifications non commitées en début de session | 33 fichiers suivis modifiés (Phase 1, Missions 2, 3, 4, 5) |
| Fichiers non suivis en début de session | rapports des Missions 1-5, nouveaux modules et tests |
| Préservés | tous les rapports précédents et leur contenu ; aucune ligne de rapport antérieur n'a été réécrite |

### 1.2 Scripts de test disponibles

`package.json` (racine) : `test:invariants`, `test:comexa`, `test:responsive:personal|team|client|comexa|notifications`, `build`, `lint`, `test:onboarding` (référence des fichiers absents, hors périmètre).  
`backend/package.json` : `test:invariants` (+ `pretest:invariants` ajouté en Mission 6), `build` (`nest build`), `lint`, `prisma:*`, `typecheck:scripts`.  
`desktop/package.json` : `test` (18 tests Electron), `start` (Electron), `dist`.  
Aucun workflow CI (`/.github/workflows` ne contient que `android.yml` et `desktop.yml`, déclenchés manuellement ou par tag).

### 1.3 Blocage technique confirmé — build backend NestJS / Prisma

Vérifié réellement en début de mission :

- `backend/src/generated/prisma/` n'existe pas sur disque (ni stubs, ni client généré) ; le dossier est gitignoré.
- `npm ci --prefix backend` installe bien `@prisma/client@7.10.0` et `@prisma/engines@7.10.0`, mais le paquet `@prisma/engines` ne contient que l'orchestrateur de téléchargement, pas les binaires moteurs.
- `npm run prisma:generate --prefix backend` échoue avec :

```
request to https://binaries.prisma.sh/all_commits/0edf323efd1d98336f3f0a68684b56f689b900d3/debian-openssl-3.0.x/schema-engine.gz.sha256 failed,
reason: Client network socket disconnected before secure TLS connection was established
```

- `@prisma/schema-engine-wasm@7.10.0-4.0edf323efd1d98336f3f0a68684b56f689b900d3` est publiable sur npm (1,9 Mo, contient le Wasm du moteur de schéma), mais le projet ne l'utilise pas ; l'installer en plus de `@prisma/engines` reviendrait à ajouter une dépendance non déclarée pour contourner un blocage environnemental.
- `npm run build --prefix backend` (`nest build`) : **921 erreurs TypeScript**, toutes en cascade depuis l'absence de déclarations `../generated/prisma/client.js` (`TS2307`, `TS7006`, `TS2339` sur `PrismaService`).

Conclusion documentée : **le véritable `nest build` ne peut pas être exécuté dans cet environnement**. Les tests backend purs passent via `tsx` avec des stubs Prisma hors ligne (enums lus depuis le schéma, client minimal, jamais utilisé en production). Aucun fichier n'a été masqué ni aucune vérification désactivée.

### 1.4 Rapports précédents lus et utilisés comme base de vérification (non modifiés)

`docs/AUDIT-INCOHERENCES-METIER.md`, `docs/AMELIORATION-ESPACE-PERSONNEL.md`, `docs/AMELIORATION-ESPACE-EQUIPE.md`, `docs/AMELIORATION-ESPACE-CLIENT.md`, `docs/AMELIORATION-COMEXA-SPACE.md` (et les rapports conservés `AUDIT-ESPACES-OPPORTUNITES.md`, `STRATEGIE-SAAS-AUDIT.md`, `REFONTE-SOFTUI.md`, `dashboard-design-audit.md`, `backend/docs/security-audit.md`, `API-N8N.md`, `CONSOLE-N8N-AFFICHAGE.md`).

---

## 2. Vérifications réalisées

### 2.1 Lecture du code courant (tous les espaces)

Backend : `notifications/*` (service, inbox, controller, DTO), `audit/redact.ts`, `common/spaces/space-policy.ts`, `common/auth/principal.ts`, `common/auth/permissions.catalogue.ts`, `modules/users/identity-rules.ts`, `modules/quotes/quotes.service.ts`, `modules/quotes/quote-state.ts`, `modules/goals/goal-rules.ts`, `modules/projects/projects.service.ts`, `modules/milestones/milestones.service.ts`, `modules/invoices/invoice-overdue.*`, `modules/tasks/tasks.service.ts`, `modules/content/modification-request.service.ts`, `modules/content/contact-request.service.ts`, `modules/payments/payments.service.ts`, `modules/auth/auth.service.ts`, `config/env.validation.ts`, `render.yaml`.

Frontend partagé : `src/lib/notification-links.js`, `src/components/softui/notification-map.js`, `src/components/workspace/NotificationsPanel.jsx`, `src/lib/use-realtime-notifications.js`, `src/components/softui/primitives.jsx`, `src/components/softui/panels.jsx`, styles `softui.components.css` / `softui.productivity.css`, `src/lib/access.js`, `src/lib/spaces.js`.

### 2.2 Tests réels exécutés (avant et après corrections)

| Suite | Avant Mission 6 | Après Mission 6 |
|---|---|---|
| `npm run test:invariants` (frontend) | 58/58 | 58/58 |
| `npm run test:invariants` (backend) | 30/30 (échec sur `admin-policy.test.mjs` sans stubs préparés) | **44/44** |
| `npm run test:comexa` | 15/15 | 15/15 |
| `node --test tests/contract.test.mjs` | 5/5 | 5/5 |
| `npm test --prefix desktop` | 18/18 | 18/18 |
| `npx eslint` | 0 | 0 |
| `npm run build` (Next) | succès, 66/66 pages | succès, 66/66 pages |
| `git diff --check` | OK | OK |
| Responsive personnel / équipe / client / Comexa Space | tous verts (missions précédentes) | tous verts (régression vérifiée) |
| Responsive notifications | n'existait pas | **20 mesures, 0 débordement, 0 erreur** |

### 2.3 Validation navigateur réelle

Chromium 153.0.8010.0 extrait de `@sparticuz/chromium@153.0.0` (binaires brotli décompressés localement, `LD_LIBRARY_PATH=/tmp/chromium-libs/lib`), Next dev sur `0.0.0.0:3000`, fuseau `Africa/Algiers`, horloge figée, API simulée par interception Playwright (`**/api/**`).

- **Notifications partagées** : 4 écrans (équipe, personnel, Comexa Space, client) × 5 largeurs (360, 390, 768, 1024, 1440) = 20 mesures ; `documentWidth - viewport = 0` partout, cibles ≥ 44 px, 0 erreur console/page, 0 composant hors cadre.
- Interactions : liens profonds réels (`/espace-equipe/prospects/pr1`, `/espace-client/devis/q1`, …), double-clic sur « marquer lue » = exactement 1 POST, « tout lire » équipe = 1 POST avec `space=team`, client sans en-tête `X-Comexa-Space`, erreur 500 affichée sans réussite fictive, refus 403 sur notification d'autrui sans marquage.

Les tests des quatre autres espaces ont été rejoués après la modification du composant partagé `NotificationsPanel.jsx` : aucune régression.

---

## 3. Incohérences confirmées (avec fichiers et emplacements précis)

### 3.1 P0 — Notifications `SYSTEM` classées dans Comexa Space, alors qu'aucun producteur Comexa n'existe

**Endroit précis :** `backend/src/common/spaces/space-policy.ts`, `NOTIFICATION_TYPES_BY_SPACE.comexa = ['SYSTEM']`.  
**Règle contraire :** `spaceOfNotificationType()` trie par espace pour que « la cloche et ses compteurs ne mélangent jamais deux espaces » ; le frontend `NotificationsPanel.jsx` affiche les compteurs par espace et filtre `spaceWhere` par type.

**Scénario reproductible :** un jalon atteint émet `MILESTONE_REACHED` (espace équipe), une facture en retard émet `INVOICE_OVERDUE` (espace équipe), un ajout à un projet émet `SYSTEM` avec lien `/projets/:id` (espace équipe). `spaceOfNotificationType('SYSTEM')` renvoyait `comexa`, donc :
- une notification métier d'équipe comptait dans la pastille « Comexa Space » ;
- son lien `/projets/p1` ou `/taches/:id` retombait sur la page Notifications de Comexa Space, qui n'a aucune rubrique de projet ni de tâche ;
- l'admin de Comepa Space voyait des alertes qu'il ne pouvait pas traiter.

**Preuve :** test `admin-policy.test.mjs` (`spaceOfNotificationType("SYSTEM")` attendait `"comexa"`), et `notification-routing.test.mjs` (avant correction : lien `/prospects/pr1` résolvait vers `/espace-equipe/notifications` au lieu de `/espace-equipe/prospects/pr1`).

**Risque utilisateur :** l'utilisateur clique sur une notification et atterrit sur une page sans rapport avec le contenu ; les compteurs par espace sont faux.

### 3.2 P0 — `notifyMany()` publiait une ancienne notification au lieu de la nouvelle en temps réel

**Endroit précis :** `backend/src/modules/notifications/notification.service.ts`, ancienne implémentation de `notifyMany()` (relecture `createMany` puis `findMany({ where: { type, title, entityId, readAt: null } })`).

**Scénario reproductible :** deux messages envoyés dans la même conversation (même `type: 'MESSAGE_RECEIVED'`, même `title: 'Nouveau message'`, même `entityId`). Le second `notifyMany` relisait les lignes par `{ type, title, entityId, readAt: null }` et renvoyait la première ligne non lue encore publiée ; le socket diffusait donc l'identifiant de l'ancienne notification. Le hook `useRealtimeNotifications` déduit par identifiant : la nouvelle notification n'apparaissait jamais dans l'alerte temps réel, seulement après rechargement.

**Preuve :** `tests/notification-routing.test.mjs` — avant correction, `created.map(id)` valait `['batch-1', 'batch-2']` (anciennes lignes) au lieu de `['new-1', 'new-2']`, et les `payload.notification.body` étaient `'ancien'`.

**Risque utilisateur :** une notification reçue en temps réel peut être celle d'un autre événement du même type ; l'utilisateur rate l'alerte réelle.

### 3.3 P0 — Liens de notification non résolus vers des rubriques inexistantes ou hors périmètre

**Endroit précis :** `src/lib/notification-links.js` (aucune route pour `/prospects/:id`) ; `backend/src/modules/prospects/prospects.service.ts:650-658` (notification `SYSTEM` avec `link: '/prospects/${client.id}'`).

**Scénario reproductible :** « Nouvelle piste issue du formulaire de contact » émet un lien `/prospects/pr1` ; `resolveNotificationHref('/prospects/pr1', 'team')` ne trouvait aucun motif et retournait la page Notifications de l'équipe, pas le prospect.

**Risque utilisateur :** lien mort vers une page qui affiche la liste vide au lieu de la fiche concernée.

### 3.4 P1 — Build backend non validable (Prisma / NestJS)

**Endroit précis :** `backend/src/generated/prisma/` absent ; `prisma.config.ts` appelle `binaries.prisma.sh` (bloqué par TLS dans ce sandbox) ; `nest build` émet 921 erreurs TS en cascade.

**Risque utilisateur :** aucune preuve que le backend compilé correspond au code source ; une régression de compilation passerait inaperçue en local.

### 3.5 P1 — JWT de session complet transmis à n8n (risque connu, non corrigé silencieusement)

**Endroit précis :** `src/app/api/agent-chat/route.js` (`metadata: { jwt }` transmis au webhook `N8N_AGENT_WEBHOOK_URL`).  
**État :** le contrat n8n externe n'est pas dans le dépôt ; retirer `metadata.jwt` casserait le workflow existant. Correction limitée déjà appliquée en Mission 5 : refus HTTP externe, refus jeton `cxi_`, validation de forme `eyJ…`, et risque affiché comme dégradé dans `AdminHealthPanel.jsx`. Le retrait définitif attend un jeton de délégation court signé côté backend + migration du workflow externe.

### 3.6 P1 — Vérification e-mail désactivée en production

**Endroit précis :** `render.yaml:79-80` (`EMAIL_VERIFICATION_REQUIRED: "false"`). Le code backend gère les deux cas (`auth.service.ts`, `emailVerificationRequired` lit la variable à chaque appel). **Non modifié** : la réactivation dépend du domaine Mailjet et de la remise en état des tests d'onboarding obsolètes (`test:onboarding` référence des fichiers absents).

---

## 4. Problèmes classés par priorité

| Priorité | Constat | Endroit | Statut |
|---|---|---|---|
| **P0** | Notifications `SYSTEM` classées Comexa Space, liens vers rubriques absentes | `space-policy.ts`, `propospects.service.ts`, `notification-links.js` | **Corrigé** |
| **P0** | `notifyMany` publie une ancienne notification en temps réel | `notification.service.ts` | **Corrigé** |
| **P0** | Lien `/prospects/:id` non résolu | `notification-links.js` | **Corrigé** |
| **P1** | Build backend NestJS impossible en local (Prisma) | `prisma.config.ts`, `nest build` | Documenté, blocage environnemental |
| **P1** | JWT session transmis à n8n | `agent-chat/route.js` | Atténué (Mission 5), correction définitive différée (workflow externe absent) |
| **P1** | `EMAIL_VERIFICATION_REQUIRED=false` en production | `render.yaml` | Non modifié (décision produit Mailjet) |
| **P2** | Cibles tactiles < 44 px dans la boîte de notifications (34 px icônes, ~20 px titre) | `NotificationsPanel.jsx`, `softui.components.css` | **Corrigé** |
| **P2** | `space-policy.ts` sans tests dédiés (alerte Phase 1) | `backend/tests/admin-policy.test.mjs` | **Couvert** (test existant corrigé + nouvelle suite) |

---

## 5. Problèmes corrigés et fichiers modifiés

### 5.1 `backend/src/common/spaces/space-policy.ts`

`SYSTEM` retiré de `comexa` et ajouté à `team` (avec commentaire expliquant que tous les producteurs `SYSTEM` actuels sont des faits d'équipe). `comexa` est désormais vide : un futur message d'administration Comexa recevra son propre type plutôt que de polluer l'espace admin avec des événements métier.

### 5.2 `backend/tests/admin-policy.test.mjs`

L'assertion `spaceOfNotificationType("SYSTEM")` passe de `"comexa"` à `"team"` ; un type inconnu reste `"team"` (règle de repli inchangée).

### 5.3 `src/lib/notification-links.js`

Ajout des motifs `/prospects/:id` et `/prospects` → `/espace-equipe/prospects/${id}` pour l'espace équipe. Les liens producteurs existants étaient déjà corrects pour les autres rubriques (vérifiés par test : factures, devis, projets, clients, tâches, modifications, messagerie, demandes, et leurs équivalents client).

### 5.4 `backend/src/modules/notifications/notification.service.ts`

`notifyMany()` réécrit : un `create` par destinataire (dans la transaction de l'appelant quand elle existe), retournant directement les lignes créées. Suppression de la relecture ambiguë `type + title + entityId + readAt:null` qui publiait l'ancienne notification non lue en cas de doublon de type/titre/entité.

### 5.5 `src/components/workspace/NotificationsPanel.jsx`

- Garde de double-clic (`pending` par clé) sur « marquer lue », « supprimer » et « tout marquer comme lu » : exactement un POST par action même en cas de deux clics rapides.
- Bandeau de classe `cx-notifications` pour les styles locaux.
- Aucun changement du hook `useAction` partagé : les autres écrans conservent leur comportement.

### 5.6 `src/styles/softui.productivity.css`

Ajout local : pilules de filtre et icônes d'action à 44 px min, titre cliquable à 44 px min dans `.cx-notifications`. Aucune règle globale touchée.

### 5.7 Nouveaux tests

- `backend/tests/notification-routing.test.mjs` : 8 tests (classification des types par espace, résolution de tous les liens producteurs, double lecture `notifyMany` corrigée, isolation porteur/espace de la boîte, refus notification d'autrui).
- `tests/responsive-notifications.mjs` : 20 mesures réelles Chromium, 4 écrans × 5 largeurs, interactions (liens, double-clic, erreur 500, refus 403, « tout lire » par espace).

### 5.8 Scripts et configuration de test

- `backend/package.json` : `pretest:invariants` prépare les stubs Prisma hors ligne avant toute résolution de test ; `test:invariants` inclut `notification-routing.test.mjs`.
- `package.json` : `test:responsive:notifications`.

---

## 6. Raisons justifiant chaque correction

1. **Classification `SYSTEM`** : la règle de `space-policy.ts` est la source de vérité des compteurs par espace. Laisser `SYSTEM` dans `comexa` contredisait directement le commentaire du fichier (« la cloche et ses compteurs ne mélangent jamais deux espaces ») et rompait la navigation des notifications métier. Aucun nouveau statut ni nouvelle table n'a été ajouté.
2. **`notifyMany`** : le contrat `NotificationService.notifyMany` promet de publier les notifications créées. La relecture par critères non uniques violait ce contrat dès que deux événements partageaient type/titre/entité. Le coût de quelques `create` supplémentaires est négligeable face à la correction de la diffusion temps réel.
3. **Lien `/prospects/:id`** : un lien de notification doit ouvrir l'objet concerné, pas une boîte de réception vide. L'ajout est un motif de traduction, pas une nouvelle page.
4. **Cibles 44 px** : les mesures réelles montraient 20-34 px sur téléphone ; le design system impose déjà 44 px pour `.sui-btn` et `.sui-iconbtn`, la boîte de notifications dérogeait localement.

---

## 7. Tests exécutés et résultats exacts

### 7.1 Suite finale (toutes réellement exécutées)

```
npm run test:invariants
  frontend: 58/58 pass, 0 fail
  backend:  44/44 pass, 0 fail   (inclut notification-routing.test.mjs, 8/8)
npm run test:comexa
  15/15 pass, 0 fail
node --test tests/contract.test.mjs
  5/5 pass, 0 fail
npm test --prefix desktop
  18/18 pass, 0 fail
npx eslint (racine)
  exit 0, 0 erreur
npm run build (Next 16 / Turbopack)
  Compiled successfully, 66/66 pages statiques générées
git diff --check
  OK
```

### 7.2 Responsive navigateur réelle (Chromium 153.0.8010.0)

| Suite | Mesures | Largeurs | Débordements | Composants hors cadre | Erreurs console/page | Cible min |
|---|---:|---|---:|---:|---:|---:|
| personnel | 6 | 360/390/768/1024/1440 | 0 | 0 | 0 | 44 px |
| équipe | 15 | 5 largeurs | 0 | 0 | 0 | 40 px |
| client | 30 | 5 largeurs | 0 | 0 | 0 | 44 px |
| Comexa Space | 70 | 5 largeurs | 0 | 0 | 0 | 44 px |
| **notifications (Mission 6)** | **20** | **5 largeurs** | **0** | **0** | **0** | **44 px** |

Toutes les régressions des quatre espaces ont été rejouées après la modification du composant partagé `NotificationsPanel.jsx` : vertes.

### 7.3 Interactions réelles vérifiées (notifications)

- `teamHrefs` : `/espace-equipe/prospects/pr1`, `/espace-equipe/taches?tache=t1`, `/espace-equipe/messagerie`, … (5 liens réels, aucun ne retombe sur la boîte)
- `doubleClickReadPosts` : 1 (un seul POST malgré deux clics)
- `serverError` : 500 affichée, aucune réussite fictive
- `permissionRefusal` : 403 sur notification d'autrui, non marquée
- `teamReadAll` : 1 POST avec `space=team`
- `personalReadAll` : 1 POST avec `space=personal`
- `comexaEmpty` : vrai (plus de `SYSTEM` métier dans Comexa Space)
- `clientHrefs` : `/espace-client/devis/q1`, `/espace-client/factures`, `/espace-client/modifications`, `/espace-client/messagerie`
- `clientReadAll` : 1 POST, `space=null` (pas d'en-tête `X-Comexa-Space` côté client)

### 7.4 Ce qui n'a pas pu être exécuté

- `npm run build --prefix backend` / `nest build` : 921 erreurs TS, blocage Prisma documenté en section 1.3.
- `npm run prisma:generate --prefix backend` : échec réseau TLS sur `binaries.prisma.sh`.
- Tests contre un vrai backend PostgreSQL et une vraie base : pas de base disponible ; les tests backend purs utilisent des stubs.
- Tests d'onboarding (`npm run test:onboarding`) : script préexistant référençant des fichiers absents, hors périmètre.
- Tests sur appareils physiques (Safari, iOS, Android) et lecteurs d'écran : non exécutés, documentés comme limites.

---

## 8. Limites de validation

| Domaine | Ce qui a été vérifié | Ce qui reste impossible à valider ici |
|---|---|---|
| Backend NestJS | Fonctions pures réelles via `tsx` (44/44), règles de permissions, masquage d'audit, routage notifications | Vrai `nest build`, démarrage du serveur Nest, migrations Prisma |
| Base de données | Absence de test d'intégration HTTP avec deux vrais comptes | Isolation horizontale en conditions réelles (testée fonctionnellement par les stubs, pas en base) |
| n8n / agent IA | Route refusée si HTTP externe, si `cxi_`, si valeur non-JWT ; contrat `metadata.jwt` conservé et testé avec fetch simulé | Comportement réel du workflow n8n externe (absent du dépôt) |
| E-mail / vérification | Code backend lit `EMAIL_VERIFICATION_REQUIRED` à chaque appel | Activation en production (dépend du domaine Mailjet) |
| Electron / Android | Code lu (`desktop/main.js`, `android/…`) ; pas de build exécutable ici | APK / installateur réel, comportement sur appareil |
| Navigateurs | Chromium 153.0.8010.0 uniquement | Safari, Firefox, iOS, Android WebView réel, lecteur d'écran matériel |

---

## 9. Risques de sécurité encore ouverts

1. **JWT de session complet vers n8n** (`src/app/api/agent-chat/route.js`) : le transport HTTPS est imposé, le jeton `cxi_` refusé, la forme `eyJ…` validée, mais le workflow externe reçoit toujours un jeton donnant tous les droits du membre jusqu'à expiration. Correction définitive : jeton de délégation court signé côté backend + migration du workflow externe. Non appliqué silencieusement pour ne pas casser le contrat existant.
2. **`EMAIL_VERIFICATION_REQUIRED=false`** en production (`render.yaml`) : compte actif immédiatement sans vérification d'adresse. Code prêt (`auth.service.ts` bascule selon la variable) ; activation dépend du domaine Mailjet.
3. **Espace comme restriction contextuelle, pas frontière** (`X-Comexa-Space` facultatif) : documenté dans `space-policy.ts` et `access.js` ; les gardes de ligne restent côté backend.

---

## 10. Anomalies volontairement non corrigées (avec raisons)

| Anomalie | Raison |
|---|---|
| Build backend / Prisma non exécutable | Blocage environnemental (TLS `binaries.prisma.sh`, client généré absent) ; aucune déclaration fabriquée, aucun contournement |
| `EMAIL_VERIFICATION_REQUIRED=false` | Décision produit liée à Mailjet ; modifier en aveugle pourrait bloquer les inscriptions |
| Retrait de `metadata.jwt` de n8n | Casserait le workflow externe absent du dépôt ; pas de preuve de compatibilité |
| Types sans producteur (`TASK_DUE_SOON`, `DOCUMENT_SHARED`) | Inventoriés, non émis ; les émettre serait une nouvelle fonctionnalité (rappel, partage) hors périmètre |
| `company.*` sans lecteur PDF | Décider source de vérité (UI vs variables d'environnement) avant de câbler ou déprécier |
| Décision de supplément côté client non structurée | Exige champs horodatés, permission `own` stricte, endpoint idempotent ; aucun faux bouton ajouté |
| `EXPIRED` dérivé, non persistant | Choisir avec plan de retour arrière si bascule souhaitée |

---

## 11. Trois prochaines actions prioritaires

1. **Débloquer la CI backend** : exécuter `prisma generate` + `nest build` + la suite `backend/tests/*` dans un environnement autorisé à joindre `binaries.prisma.sh` (ou mettre en cache les engines Prisma dans l'image de build). Tant que ce n'est pas fait, seul le typecheck de substitution et les tests `tsx` valident le backend.
2. **Clore le risque n8n** : concevoir avec le propriétaire du workflow externe un jeton de délégation court (portées minimales, expiration courte, signé côté backend), prévoir une période de double lecture (`metadata.jwt` + `metadata.delegation`), puis retirer `metadata.jwt`. Ne pas modifier `docs/API-N8N.md` avant migration réelle du contrat.
3. **Passer les tests d'isolation client en base** : transformer les tests purs `backend/tests/client-isolation.test.mjs` en tests d'intégration HTTP avec deux comptes `CLIENT` réels contre une base PostgreSQL, une fois le build backend débloqué.
