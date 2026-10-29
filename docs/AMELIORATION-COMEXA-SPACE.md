# Mission 5 — Audit approfondi et première amélioration de Comexa Space

**Date :** 28 octobre 2026 (Africa/Algiers)  
**Branche :** `arena/c1004795-comexa-portfolio` — HEAD de départ `1ae6d10`  
**Périmètre :** Comexa Space uniquement. Les rapports Phase 1 / Missions 2, 3 et 4 sont conservés tels quels.  
**État Git :** toutes les modifications restent non commitées, comme demandé ; aucun rapport précédent n’a été modifié.

---

## 1. Synthèse exécutive

L’audit a confirmé que Comexa Space n’est pas un « portail à reconstruire » : c’est déjà un espace d’administration cohérent, avec un backend qui fait autorité sur les permissions, des gardes d’identité solides, une matrice de rôles réelle, un journal d’audit déjà rédigé côté serveur, et des jetons d’intégration correctement hachés. Le vrai problème n’est pas l’absence de fonctionnalités : c’est **le manque de lisibilité sur ce qui est réellement actif, vérifié et traçable**.

Trois angles morts dominaient :

1. **Le journal d’audit était sous-exploité.** Le backend expose déjà `actorId`, `entityId`, `before`, `after`, `userAgent` et six filtres ; l’interface n’en utilisait que quatre et n’affichait ni identifiant d’objet, ni avant/après, ni agent utilisateur.
2. **L’état de la plateforme n’était pas distingué de l’état supposé.** `/api/health` vérifie réellement la base et le contrat, mais rien n’indiquait que les e-mails, le stockage et la relance des factures n’ont aucune sonde active. Le risque était de transformer une configuration en voyant vert.
3. **Les réglages et l’intégration n8n laissaient croire à des effets non prouvés.** Les champs `company.*` sont enregistrés sans lecteur connu ; le proxy `/api/agent-chat` transmet encore un JWT de session complet au webhook externe. Aucun de ces deux sujets ne pouvait être corrigé intégralement sans décision produit ou sans le workflow n8n externe, absent du dépôt.

La première tranche retenue est donc volontairement limitée : **un diagnostic administratif honnête**. Elle rend le journal exploitable, affiche un état de plateforme qui dit explicitement ce qui est vérifié ou non, clarifie l’effet réel des réglages, ajoute une revue des jetons inutilisés sans révocation automatique, renforce le masquage des secrets `cxi_`, sécurise le transport du proxy n8n sans casser son contrat, et corrige un bug réel de menu d’actions découvert pendant les tests.

Aucune migration, aucun nouveau statut, aucun nouveau endpoint public, aucune permission élargie, aucune suppression de paramètre et aucune modification de la configuration de production n’ont été introduites. Les permissions restent côté backend ; les miroirs frontend ne servent qu’à éviter des actions impossibles.

---

## 2. Cartographie réelle de Comexa Space

### 2.1 Routes et coquille

| Écran | Objectif réel | Utilisateurs | Opérations | Données affichées | Validation frontend | Garantie backend | États | Actions / données peu visibles |
|---|---|---|---|---|---|---|---|---|
| `/espace-comexa` | Entrée de l’espace | Membre habilité | Redirection vers le tableau de bord | — | `RequireSession` + `allowedPath` | `X-Comexa-Space: comexa`, `space-policy.ts` | chargement / refus | — |
| `/tableau-de-bord` | Vue d’ensemble de l’organisation | `user:read:any`, `audit:read:any`, `integration:*`, `setting:read:any`, droits contenu | Lire compteurs, contenus, jetons, audit | KPI membres, contenus visibles, jetons actifs, actions 7 jours, dernières actions | `can*` sur chaque bloc | `/users`, `/content/*`, `/integrations/tokens`, `/audit-logs` | erreurs par bloc, chargements `…` | La santé des services était absente ; `lastUsedAt` n’était pas exploité. |
| `/membres` | Comptes, invitations, rôles, suspension | `user:read:any`, `user:manage:any`, `role:read:any` | Créer, filtrer, modifier rôles, réinitialiser MDP, suspendre, réactiver, supprimer | Liste paginée, statuts, rôles, dernière connexion | formulaire, `ConfirmDialog`, `RecordActions` | `/users`, `/users/:id/roles`, `/users/:id/suspend`, `/users/:id/reactivate`, `identity-rules.ts` | chargement, vide, erreur, succès | Le menu d’actions se fermait immédiatement dans Chromium à cause d’un focus provoquant un scroll ; corrigé. |
| `/roles` | Matrice des permissions | `role:read:any`, `role:manage:any`, `permission:read:any` | Sélectionner un rôle, cocher des permissions, enregistrer | Rôles, catalogue groupé par ressource | `ADMIN` verrouillé, codes inconnus refusés | `/roles`, `/roles/:code`, `/permissions`, `ROLE_PERMISSIONS.ADMIN = 'ALL'` | chargement, erreur 403, vide | Pas de résumé en langage clair, pas de diff avant/après, pas d’avertissement « grosse modification ». |
| `/integrations` | Jetons serveur-à-serveur | `integration:read:any`, `integration:manage:any`, `permission:read:any` | Créer, renouveler, révoquer, supprimer, accorder tous les droits | Nom, préfixe, portées, statut, création, expiration, dernier usage, révocation, créateur | nom technique, expiration 1–3650 j, catalogue, confirmation | `/integrations/tokens`, hash SHA-256, secret affiché une fois, `integration:manage:any` interdit aux jetons | chargement, erreur catalogue, succès, secret unique | Dernier usage arrondi à la minute ; aucune détection de jeton jamais utilisé / inactif ; pas de durée de vie maximale. |
| `/journal` | Traçabilité | `audit:read:any` | Filtrer, lire le détail | Date, auteur, action, type, ID, IP, agent, avant/après | filtres, masquage de sécurité | `/audit-logs`, `redactPayload`, DTO six filtres | chargement, vide, erreur, succès | Avant correction : seulement action/type/dates ; `entityId`, `actorId`, `before/after`, `userAgent` inutilisés. |
| `/parametres` | Configuration de l’organisation | `setting:read:any`, `setting:write:any` | Lire/écrire clés JSON, préférences temps, devises, taux | `company.*`, clés techniques, préférences locales | clé minuscule, valeur JSON non nulle, taille | `/settings`, `settings-policy.ts`, `settings.service.ts`, audit | chargement, erreur, succès, confirmation de fermeture | `company.*` sans lecteur ; préférences temps en `localStorage` ; clés techniques sans registre des consommateurs. |
| `/contenu` | Site public | droits `service|package|testimonial|partner|faq:read:any` | CRUD des cinq ressources | Services, packs, témoignages, partenaires, FAQ | formulaires par onglet, `ConfirmDialog` | `/content/*`, publication/visibilité | chargement, vide, erreur | Contenu éditorial correct mais sans workflow de modération avancé. |
| `/notifications` | Notifications de l’espace | `notification:read:own` | Lire, marquer | Notifications `SYSTEM` et compteurs par espace | `NotificationsPanel` | `space-policy.ts` route les types | chargement, vide, erreur | Pas de broadcast admin visible dans cette page. |
| `/compte` | Profil et sessions | `user:read:own` | Changer MDP, fermer sessions | Profil, sessions | formulaires | `/auth/me`, `/auth/sessions`, `/auth/change-password`, `/auth/logout-all` | chargement, erreur, succès | — |

La coquille est `SpaceLayout(space="comexa", withTimer=false, withConsole=false)`. Elle applique `SpaceScopedAuth`, réduit les permissions affichées aux droits effectifs de l’espace, envoie l’en-tête `X-Comexa-Space`, et laisse `ApiContractBanner` vérifier `/api/health`. `RequireSession` reste un confort UX ; les services backend vérifient à nouveau les portées.

### 2.2 API et services concernés

- Journal : `backend/src/modules/audit/audit-log.controller.ts`, `audit-log.service.ts`, `dto/audit-log.dto.ts`, `redact.ts`.
- Jetons : `backend/src/modules/integrations/integrations.controller.ts`, `integration-token.service.ts`, `dto/integration-token.dto.ts`, `integration-token.presenter.ts`, `backend/src/common/auth/integration-token.ts`.
- Rôles / identité : `backend/src/common/auth/permissions.catalogue.ts`, `backend/src/modules/users/identity-rules.ts`, `backend/src/common/spaces/space-policy.ts`.
- Paramètres : `backend/src/modules/settings/settings.service.ts`, `settings-policy.ts`, `dto/settings.dto.ts`.
- Santé : `backend/src/health/health.controller.ts`, `contract.ts`, `database-target.ts`, miroir `src/lib/contract.js`.
- Assistant : `src/app/api/agent-chat/route.js`, `docs/API-N8N.md`, `docs/CONSOLE-N8N-AFFICHAGE.md`.
- Indicateurs décoratifs : `src/components/softui/AdminDeskPanel.jsx` sait afficher chargement/erreur/vide, mais n’est pas une sonde système.

---

## 3. État des membres, rôles et permissions

### 3.1 Ce qui est déjà solide

- Le catalogue `permissions.catalogue.ts` est la source de vérité des codes `resource:action:scope`. `ADMIN` vaut `'ALL'` ; les autres rôles portent une liste explicite.
- `space-policy.ts` ne crée jamais de droit : il retire ou rétrograde. Comexa Space garde les droits d’administration et certaines lectures, retire les données commerciales de l’espace, et interdit aux comptes `CLIENT` ou aux machines d’entrer dans les espaces internes.
- `identity-rules.ts` protège contre l’auto-suppression, l’auto-suspension, la modification du rôle `ADMIN`, la perte du dernier administrateur actif, et les rattachements client incohérents.
- `user.service.ts` applique ces règles dans des transactions sérialisables ; la suspension révoque aussi les sessions.
- Le frontend `src/lib/access.js` et `src/lib/spaces.js` ne sont que des miroirs : ils évitent d’afficher une action impossible, jamais ne protègent une donnée.

### 3.2 Ce qui manquait

- `space-policy.ts` n’avait pas de suite dédiée ; seuls quelques tests d’isolation client le touchaient indirectement.
- `/roles` montrait le catalogue mais pas de résumé lisible, de diff avant/après, d’avertissement sur les changements larges, ni de simulation « que se passe-t-il si je retire ce droit ? ».
- `RecordActions` — composant partagé utilisé par `/membres` et d’autres espaces — refermait son menu dès l’ouverture dans Chromium : le focus du premier item déclenchait un scroll capturé comme un scroll externe.

### 3.3 Correction apportée

- Nouvelle suite `backend/tests/admin-policy.test.mjs` : catalogue, espaces, entrée, notifications par espace, identité, administration, portée client, masquage d’audit, jetons.
- `src/components/softui/RecordActions.jsx` : focus avec `preventScroll: true`, navigation clavier idem, et écouteur de scroll qui ignore tout défilement interne au menu. Les tests responsive des trois autres espaces ont été rejoués pour vérifier l’absence de régression.

Aucune refonte RBAC, aucun nouveau rôle, aucune migration et aucun droit élargi n’ont été introduits.

---

## 4. Audit du journal d’audit

### 4.1 Backend

`GET /audit-logs` exige `audit:read:any` au niveau du garde **et** du service. Le DTO accepte exactement : `actorId`, `action`, `entityType`, `entityId`, `from`, `to`. Il n’y a volontairement pas de recherche plein texte dans `before`/`after` : filtrer sur une valeur que l’on refuse d’afficher transformerait le journal en oracle. La vue renvoie `id`, `actorId`, `actorEmail`, `action`, `entityType`, `entityId`, `before`, `after`, `ipAddress`, `userAgent`, `createdAt`.

`redact.ts` masque récursivement jusqu’à la profondeur 8 les clés sensibles, les JWT, les valeurs `Bearer …`, et remplace explicitement par `[masque]`. Il conserve les faits en base mais filtre la diffusion. La Mission 5 ajoute le masquage des valeurs `cxi_…` de 43 caractères minimum, même sous une clé anodine comme `note`.

### 4.2 Avant / après interface

| Élément | Avant | Après |
|---|---|---|
| Filtres | action, type, du, au | action, type, ID objet, ID auteur, du, au — tous envoyés au backend avec bornes ISO complètes |
| Ligne | date, auteur, action, type, IP | date/heure, auteur + ID court, action, type, ID objet court, IP, bouton détail 44 px |
| Détail | inexistant | tiroir modal : auteur, ID auteur, objet, ID objet, IP, user-agent, diff avant/après, copier l’ID, lien conditionnel |
| Secrets | masqués côté backend | double barrière : masquage backend + masquage frontend avant DOM |
| Lien objet | aucun | fiche cible si type connu et permission de lecture ; sinon rubrique ou absence de lien |
| États | erreur/chargement basiques | chargement, vide, erreur avec réessai, succès, Escape, noms accessibles |

Le diff ne montre jamais de JSON brut : il aplatit les chemins, tronque les valeurs longues, distingue ajout/retrait/modification/inchangé, et marque explicitement les valeurs masquées. Aucun nouveau endpoint n’a été ajouté : la liste contient déjà `before`/`after`.

---

## 5. Audit des intégrations et jetons

### 5.1 Mécanismes confirmés

- Le secret est généré côté serveur, préfixé `cxi_`, haché en SHA-256, stocké uniquement sous forme d’empreinte, et affiché une seule fois à la création ou au renouvellement.
- `normalizeIntegrationScopes` refuse les codes inconnus, déduplique, trie, et interdit `integration:read:any` / `integration:manage:any` : une machine ne distribue pas d’accès.
- `expiresInDays` est optionnel, compris entre 1 et 3650 ; l’absence signifie « jamais ». Il n’existe pas de durée de vie maximale imposée par l’organisation.
- `revoke` pose `revokedAt`, `renew` change le secret et invalide l’ancien dès la réponse, `delete` supprime le jeton et son compte technique.
- `lastUsedAt` est mis à jour au plus une fois par minute via `touchLastUsedAt`, sans écriture coûteuse à chaque requête. Ce n’est donc pas une date d’utilisation exacte.
- Le presenter expose `lastUsedAt`, `expiresAt`, `revokedAt`, `createdBy`, `active`.

### 5.2 Ce qui reste un risque produit

- Aucun jeton n’est automatiquement révoqué pour inactivité ; aucun seuil maximum n’est imposé.
- L’interface affichait « Jamais utilisé » mais ne transformait pas cette information en revue administrative.
- Le proxy `/api/agent-chat` envoie `{ chatInput, sessionId, metadata: { jwt } }` à `N8N_AGENT_WEBHOOK_URL`. Il refuse déjà les jetons `cxi_`, mais acceptait toute valeur `eyJ` ou arbitraire et pouvait théoriquement utiliser un webhook HTTP externe. Le workflow n8n externe n’est pas dans le dépôt : impossible de savoir comment il consomme le JWT, ni de prouver une fuite.

### 5.3 Décision de la tranche

- Le contrat n8n **n’est pas cassé** : `metadata.jwt` reste envoyé sur HTTPS, car le workflow externe peut en dépendre.
- Ajout d’un garde-fou de transport : HTTPS obligatoire en production, HTTP autorisé uniquement sur loopback en développement.
- Ajout d’une validation stricte de forme du JWT de session `eyJ…` ; une valeur arbitraire n’est plus transmise.
- Extension du masquage backend aux secrets `cxi_`.
- Le tableau de bord affiche désormais une **revue** des jetons : jamais utilisés, sans usage depuis 90 jours, expiration sous 30 jours. C’est une incitation à vérifier, pas une révocation automatique.
- Le panneau de santé affiche le risque n8n comme « Dégradé — risque confirmé par le code », et non comme une panne de service. Le drapeau `AGENT_SESSION_JWT_FORWARDING` documente ce fait de code ; il n’est pas une sonde runtime.

La correction définitive — jeton de délégation court, limité, signé par le backend et accepté par le workflow — est différée car elle exige une migration coordonnée du workflow externe.

---

## 6. Audit des paramètres

### 6.1 Stockage et garanties

`/settings` est une table clé/valeur JSON. `settings-policy.ts` impose une clé minuscule segmentée, une valeur non nulle, des limites de taille/profondeur/éléments, et classe comme internelles les clés `internal.*`, `private.*` ou contenant des segments sensibles. `settings.service.ts` lit au plus 500 lignes, vérifie `setting:read:any` puis `setting:write:any` pour l’inclusion des paramètres internes, écrit plusieurs paramètres dans une même logique, et journalise les changements.

Les réglages sont donc **bien validés et audités**. Le problème est leur **effet réel**, pas leur stockage.

### 6.2 Classification actuelle

| Onglet / clé | Où stocké | Lecteur réel | Effet | Classification |
|---|---|---|---|---|
| `company.*` | `prisma.setting` via `/settings` | Aucun lecteur trouvé hors du service settings | Aucun effet confirmé ; les PDF lisent `PDF_COMPANY_*` côté environnement | **Incomplet / inactif**. Ne pas supprimer automatiquement. |
| Clés techniques avancées | `prisma.setting` | Uniquement si un module lit la clé | Non vérifiable depuis l’API | **Effet inconnu**. L’interface le dit désormais. |
| Préférences de temps | `localStorage` du navigateur | `useTimePreferences` | Actif sur ce navigateur, pour ce compte, pas sur le serveur | **Actif mais local**. |
| Devises | `/currencies` | `CurrencyPanel` + backend | Actif | **Actif**. |
| Taux de change | `/exchange-rates` | `ExchangeRatePanel` + backend | Actif | **Actif**. |
| Répartitions | Renvoi vers l’Espace équipe | `/espace-equipe/repartition` | Ce n’est plus un paramètre Comexa | **Renvoi**, pas un réglage. |

Changer une variable d’environnement PDF demande un redéploiement/redémarrage serveur ; changer `company.*` dans l’interface ne produit aujourd’hui aucun effet documenté. L’interface ne doit donc pas donner l’illusion d’une identité officielle des documents.

### 6.3 Correction apportée

Un bandeau `SettingsImpactNotice` classe chaque onglet : « Enregistré, effet non confirmé », « Effet non vérifié », « Actif, mais local au navigateur », « Réglage actif », « Renvoi vers l’Espace équipe ». Aucune clé n’a été supprimée et aucun effet non prouvé n’a été promis.

---

## 7. Visibilité de l’état de la plateforme

### 7.1 Ce que `/api/health` prouve réellement

Le endpoint est public, exempté de throttling, et exécute réellement `SELECT 1` via `prisma.isHealthy()`. Il renvoie `status`, `database`, `databaseTarget` (famille d’hébergement seulement), `uptimeSeconds`, `timestamp`, `contract`. Le frontend `checkApiContract()` compare les fonctionnalités requises. Il n’existe aucune vérification d’envoi d’e-mail, de lecture/écriture de stockage, ni de dernière exécution du cron de relance.

Le nouveau panneau n’ajoute **aucun endpoint**. Il relit `/api/health`, relit la liste des jetons déjà autorisée, et affiche six contrôles :

| Contrôle | État possible | Règle |
|---|---|---|
| API et base | Opérationnel / Indisponible | Vert uniquement si `status=ok` **et** `database=up`. |
| Contrat API | Opérationnel / Dégradé / Inconnu | Compare `REQUIRED_FEATURES` au contrat servi. |
| Envoi d’e-mails | Vérification non configurée | Aucune sonde d’envoi réel. |
| Stockage des fichiers | État inconnu | Aucune vérification lecture/écriture exposée. |
| Relance des factures | État inconnu | Aucune date de dernière exécution réussie. |
| Jetons d’intégration | Opérationnel / État inconnu / Dégradé | Basé sur `lastUsedAt`, jamais utilisé, inactif 90 j, expiration 30 j. |

Un risque séparé signale le JWT de session n8n. Le résumé reste « Contrôles partiels » : même quand l’API et le contrat sont verts, l’interface ne conclut jamais à une santé globale verte. `databaseTarget`, l’uptime et les URL ne sont pas affichés dans le panneau.

---

## 8. Risques et incohérences confirmés

| ID | Risque | Confirmation | Traitement Mission 5 |
|---|---|---|---|
| R1 | JWT de session complet transmis à n8n | `src/app/api/agent-chat/route.js`, `metadata.jwt` | Contrat conservé, transport HTTPS imposé, forme JWT stricte, risque visible. Pas de preuve de fuite. |
| R2 | Vérification e-mail désactivée en production | `render.yaml`, `EMAIL_VERIFICATION_REQUIRED=false` | Dette conservée visible ; correction différée car dépend du domaine Mailjet. |
| R3 | `company.*` sans lecteur | Aucun lecteur `prisma.setting` trouvé ; PDF via variables d’environnement | UI classée inactive ; pas de suppression automatique. |
| R4 | Pas de durée de vie maximale des jetons | DTO 1–3650 j, expiration optionnelle | Revue des jetons inutilisés ; politique de révocation différée. |
| R5 | Mail / stockage / cron non vérifiés | `health.controller.ts` | États explicites inconnu / non configuré ; aucun faux vert. |
| R6 | `space-policy.ts` sans tests dédiés | Inspection du dépôt | Suite backend dédiée ajoutée. |
| R7 | Détail d’audit non exploité | Ancien `journal/page.jsx` | Filtres, diff détaillé, IDs, user-agent, lien conditionnel. |
| R8 | Secret `cxi_` sous clé anodine non masqué | `redact.ts` ne reconnaissait que JWT/Bearer | Masquage ajouté côté backend + frontend. |
| R9 | Menu d’actions qui se referme | Reproduit en Chromium 153 | `preventScroll` + scroll interne ignoré ; régressions autres espaces rejouées. |
| R10 | `databaseTarget` déjà public | Endpoint `/api/health` | Non étendu ; non réaffiché dans le nouveau panneau. |

---

## 9. Étude concurrentielle et sources officielles

Toutes les sources ci-dessous ont été consultées le **28 octobre 2026**. Elles servent à challenger nos choix, pas à recopier un produit.

| Source officielle | Principe | Comparaison avec Comexa | Enseignement raisonnable | À ne pas copier |
|---|---|---|---|---|
| [Odoo 19 — Access rights](https://www.odoo.com/documentation/19.0/applications/general/users/access_rights.html) | Seuls les administrateurs changent les droits ; Odoo avertit du risque d’« impotent admin » et rend visibles les permissions héritées / conflictuelles. | Comexa a déjà `identity-rules.ts`, `ADMIN='ALL'`, et des espaces restrictifs. L’écran `/roles` montre le catalogue mais pas les héritages ni l’effet d’un retrait. | Ajouter plus tard un résumé lisible, un diff avant/après et un avertissement de verrouillage, sans refonte RBAC. | Le modèle complet groupes / record rules / rôles techniques d’Odoo. |
| [GitHub — Audit log events](https://docs.github.com/en/organizations/keeping-your-organization-secure/managing-security-settings-for-your-organization/audit-log-events-for-your-organization) | Les événements sont nommés catégorie + opération et incluent horodatage, action, acteur, ID acteur, hashed token, token ID/scopes, user agent, type d’opération. | Le backend Comexa expose déjà des champs comparables, mais l’interface ne les montrait pas. | Rendre acteur, action, entité, ID, IP, agent et avant/après consultables sans jamais afficher le secret brut. | Le catalogue géant d’événements, le polling API ou les webhooks globaux. |
| [GitHub — Reviewing the audit log](https://docs.github.com/en/organizations/keeping-your-organization-secure/managing-security-settings-for-your-organization/reviewing-the-audit-log-for-your-organization) | Le journal répond « qui, quoi, quand » ; recherche par acteur, opération, action, dépôt, dates ; pas de recherche plein texte. | Le DTO Comexa a exactement six filtres structurés et refuse la recherche dans les valeurs masquées. | Exposer les six filtres et un détail lisible ; conserver le refus de recherche plein texte pour éviter un oracle. | La rétention de 180 jours, les qualifiers de recherche avancés, la limitation aux owners. |
| [GitHub — Token expiration and revocation](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/token-expiration-and-revocation) | Recommande une expiration ; un jeton expiré/révoqué ne peut plus s’authentifier ; GitHub révoque après exposition publique, après un an d’inutilisation, ou lors d’un excès de jetons. | Comexa a déjà expiration optionnelle, révocation, renouvellement, secret haché, `lastUsedAt` throttle. Il manque une politique de durée maximale et une revue d’inactivité. | Afficher une revue « jamais utilisé / inactif 90 j / expiration proche » sans révocation automatique. | La révocation automatique après un an, l’API de révocation tierce non authentifiée, la limite de dix jetons. |
| [GitHub — Personal access token policy](https://docs.github.com/en/organizations/managing-programmatic-access-to-your-organization/setting-a-personal-access-token-policy-for-your-organization) | Une organisation peut imposer une durée de vie maximale (366 j par défaut pour les fine-grained tokens) et une approbation administrateur. | Comexa n’a pas de politique d’organisation configurée ; le DTO autorise jusqu’à 3650 j et l’absence d’expiration. | Envisager plus tard une politique explicite et configurable, avec période de transition. | Imposer brutalement 366 j à des workflows existants sans inventaire ni migration. |

Les sources produit vues dans les missions précédentes — HoneyBook, Assembly, Teamwork, Todoist, Linear, etc. — renforcent la même idée : un écran d’administration doit dire **ce qui demande une décision** et **ce qui est réellement actif**. Elles ne justifient ni un portail SaaS public, ni un nouveau modèle de tâches, ni une refonte graphique globale.

---

## 10. Tableau des opportunités

Légende : **C** = Corriger, **A** = Améliorer, **+** = Ajouter. Complexité : F/M/E. Les permissions restent backend ; « impact » précise les autres espaces.

| ID | Type | Problème & réf. code | Comportement actuel → attendu | Valeur / risques | Permissions & impact autres espaces | Complexité / responsive / validation |
|---|---|---|---|---|---|---|
| O1 | C | Journal sous-exploité : `journal/page.jsx`, `audit-log.dto.ts` | 4 filtres et 5 colonnes → 6 filtres, IDs, diff, user-agent, lien conditionnel | Enquête administrative rapide ; risque de secret si mal affiché | `audit:read:any` + droits de lecture de la cible ; aucun impact autres espaces | F / cartes 1 colonne <620 px / tests filtres, secret masqué, lien, 5 largeurs |
| O2 | C | Secret `cxi_` sous clé anodine : `redact.ts` | JWT/Bearer masqués, pas `cxi_` → tout secret reconnaissable masqué | Évite une fuite via `note`, `label`… | Aucune permission nouvelle ; impact positif sur tout journal | F / pas d’UI / test backend + frontend |
| O3 | A | Santé plateforme absente : `ComexaOverview.jsx`, `health.controller.ts` | KPI métier seuls → contrôles API/contrat/tokens + états non vérifiés | Arrête les faux verts | Visible si `audit`/`integration`/`setting` ; aucun endpoint nouveau | M / grilles 1–2 colonnes / 5 largeurs, erreur/vide/chargement |
| O4 | A | `lastUsedAt` inutilisé au dashboard : `integration-token.presenter.ts` | « Jamais utilisé » isolé → revue never/stale/expiring | Détecte les jetons oubliés | Aucune auto-révocation ; autres espaces inchangés | F / KPI + panneau / test réel navigateur |
| O5 | A | Effet des réglages opaque : `parametres/page.jsx`, `pdf.service.ts` | Formulaire muet → bandeau actif / local / non confirmé | Évite une fausse identité PDF | `setting:read:any` / `setting:write:any` ; autres espaces inchangés | F / bandeau fluide / 5 largeurs |
| O6 | C | Proxy n8n : `agent-chat/route.js` | Webhook HTTP possible, valeur arbitraire → HTTPS + JWT strict, contrat conservé | Empêche une fuite certaine sur transport clair | Route session utilisateur ; autres espaces inchangés | F / pas d’UI / tests route 6 cas |
| O7 | C | `space-policy.ts` sans suite dédiée | Couverture indirecte → 8 tests backend dédiés | Verrouille l’accès aux espaces | Impact indirect positif sur personnel/équipe/client | F / pas d’UI / 38/38 backend |
| O8 | C | Menu `RecordActions` se ferme : `RecordActions.jsx` | Focus provoque un scroll externe → menu stable | Rend suspension/réactivation utilisables | Composant partagé : régressions 3 autres espaces obligatoires | F / dialogues 5 largeurs / harness Comexa + personal/team/client |
| O9 | A | Matrice des rôles sans diff : `roles/page.jsx` | Cases cochées seules → résumé, diff, avertissement gros changement | Réduit le risque d’« impotent admin » | `role:*`, `permission:read:any` ; aucun changement backend | M / matrice en cartes / à valider avec Odoo lesson |
| O10 | + | Durée de vie max des jetons : `integration-token.dto.ts` | Expiration optionnelle 3650 j → politique d’organisation configurable | Réduit la surface d’un secret oublié | Décision produit ; peut casser des workflows n8n | E / formulaire + migration / tests création + renouvellement |
| O11 | + | Délégation n8n : `agent-chat/route.js`, `docs/API-N8N.md` | JWT de session complet → jeton court, scoped, signé backend | Corrige R1 sans casser le workflow | Nécessite le workflow externe ; aucun droit élargi | E / double lecture transitoire / tests contrat externe indisponibles |
| O12 | + | Sondes mail/storage/cron : `health.controller.ts` | États inconnus → endpoint admin minimal, seulement si justifié | Distingue dégradé / indisponible / non configuré | Ne pas rendre public ; secrets jamais exposés | E / nouveaux états / tests de panne simulée |
| O13 | A | `company.*` sans lecteur : `settings.service.ts`, `pdf.service.ts` | UI enregistre sans effet → soit câbler, soit déprécier explicitement | Redonne un effet réel aux réglages | Peut toucher PDF des autres espaces | M / formulaire inchangé / test génération PDF |
| O14 | A | Vérification e-mail désactivée : `render.yaml` | `false` en production → `true` après domaine Mailjet prêt | Réduit les comptes non vérifiés | Impact inscription globale ; hors périmètre Comexa seul | M / pas d’UI Comexa / test onboarding à réparer au préalable |
| O15 | A | Admin notifications / contenu : `notifications/page.jsx`, `contenu/page.jsx` | Diffusion et modération basiques → décisions explicites | Évite les notifications vagues | Droits `notification:*`, `testimonial:moderate:any` | M / cartes / tests d’idempotence à définir |

---

## 11. Priorisation et choix de la tranche

La tranche devait être **cohérente, limitée, testable et sans décision produit ambiguë**. Ont été retenus : O1, O2, O3, O4, O5, O6, O7, O8. Ils partagent un même objectif : *savoir ce qui s’est passé, ce qui est vérifié et ce qui est actif*.

Ont été écartés volontairement :

- **O9** : utile mais nécessite une vraie simulation d’héritage / conflits ; le simple diff visuel serait trompeur sans règle backend.
- **O10** : imposer une durée maximale ou une révocation automatique sans inventaire des workflows existants pourrait casser n8n. La revue affichée est déjà un premier pas honnête.
- **O11** : impossible sans le workflow externe ; casser `metadata.jwt` silencieusement aurait pu provoquer une panne invisible.
- **O12** : un nouvel endpoint doit être justifié par de vraies sondes. `/api/health` suffit pour la première tranche ; les services non vérifiés restent explicitement inconnus.
- **O13** : câbler `company.*` aux PDF touche la facturation et les autres espaces ; il faut d’abord une décision sur la source de vérité.
- **O14** : `EMAIL_VERIFICATION_REQUIRED` dépend du domaine Mailjet et de tests d’onboarding obsolètes ; la dette reste visible.
- **O15** : notifications broadcast et modération avancée demandent des règles d’idempotence et de destinataires, pas un bouton décoratif.

Aucun nouvel endpoint, aucune migration, aucune donnée financière et aucun secret supplémentaire n’ont été exposés.

---

## 12. Tranche implémentée

### 12.1 Journal d’audit exploitable

`src/app/(session)/espace-comexa/journal/page.jsx` a été réécrit autour de `src/lib/admin-diagnostics.mjs` :

- six filtres backend : `action`, `entityType`, `entityId`, `actorId`, `from`, `to` ;
- conversion des dates de formulaire en bornes ISO complètes, fin de journée incluse ;
- liste en cartes responsives avec IDs techniques abrégés mais copiables ;
- tiroir modal `SideSheet` avec métadonnées complètes et diff avant/après ;
- deuxième barrière de masquage : JWT, `cxi_`, `Bearer`, `[masque]`, valeurs longues tronquées ;
- lien direct uniquement si le type d’entité est connu et si le porteur a la permission de lecture ; sinon rubrique ou absence de lien ;
- copie de l’ID, fermeture par Escape, chargement / vide / erreur avec réessai ;
- aucun endpoint de détail supplémentaire : la liste fournit déjà les charges utiles.

### 12.2 État de plateforme honnête

`src/components/admin/AdminHealthPanel.jsx` et `src/components/dashboard/ComexaOverview.jsx` :

- six contrôles avec états `Opérationnel`, `Dégradé`, `Indisponible`, `État inconnu`, `Vérification non configurée` ;
- contrat API comparé à `REQUIRED_FEATURES` ;
- revue des jetons : jamais utilisé, inactif 90 jours, expiration sous 30 jours ;
- risque n8n affiché comme fait de code, pas comme panne ;
- aucun voyant vert global ; `databaseTarget`, uptime et URL non réaffichés ;
- bouton d’actualisation, liens vers intégrations et journal selon permissions.

### 12.3 Paramètres explicites

`src/app/(session)/espace-comexa/parametres/page.jsx` affiche un bandeau par onglet. Les réglages inactifs ou locaux sont nommés comme tels. Aucun réglage n’a été supprimé ; aucune validation serveur n’a été contournée.

### 12.4 Sécurité locale

- `backend/src/modules/audit/redact.ts` masque désormais les secrets `cxi_` sous une clé anodine.
- `src/app/api/agent-chat/route.js` exige un webhook HTTPS (ou loopback HTTP en développement), refuse les `cxi_`, exige une forme JWT compacte, et conserve `metadata.jwt` sur HTTPS. Le commentaire de route documente la dette de délégation.
- `src/components/softui/RecordActions.jsx` corrige le menu d’actions qui se refermait ; composant partagé modifié au minimum, avec régressions des autres espaces.

### 12.5 Styles

Les classes `cx-audit-*`, `cx-health-*`, `cx-settings-impact` et `cx-audit-field` sont locales à `src/styles/softui.productivity.css`. Aucune refonte du design system global.

---

## 13. Fichiers

### Nouveaux

| Fichier | Rôle |
|---|---|
| `src/lib/admin-diagnostics.mjs` | Helpers purs : dates, URL de webhook, masquage, diff d’audit, liens d’entités, santé, revue de jetons, impact des réglages. |
| `src/components/admin/AdminHealthPanel.jsx` | Panneau de santé admin basé sur `/api/health` et `/integrations/tokens`. |
| `tests/comexa-space.test.mjs` | 9 tests purs des helpers Mission 5. |
| `tests/agent-chat-route.case.mjs` | 6 tests de la route `/api/agent-chat`. |
| `tests/alias-loader.mjs`, `tests/register-loader.mjs` | Résolution de `next/server` pour les tests Node de route. |
| `tests/responsive-comexa.mjs` | Harness Chromium, 14 écrans × 5 largeurs, interactions et états. |
| `backend/tests/admin-policy.test.mjs` | 8 tests backend : catalogue, espaces, identité, jetons, masquage. |
| `docs/AMELIORATION-COMEXA-SPACE.md` | Ce rapport. |

### Modifiés

| Fichier | Modification |
|---|---|
| `src/app/(session)/espace-comexa/journal/page.jsx` | Journal filtrable, détaillé, masqué, responsive. |
| `src/app/(session)/espace-comexa/parametres/page.jsx` | Bandeau d’effet réel des réglages. |
| `src/components/dashboard/ComexaOverview.jsx` | Intégration du panneau de santé et de la revue des jetons. |
| `src/components/softui/RecordActions.jsx` | Correction du menu d’actions. |
| `src/app/api/agent-chat/route.js` | HTTPS, JWT strict, refus `cxi_`, documentation de la dette. |
| `backend/src/modules/audit/redact.ts` | Masquage des valeurs `cxi_`. |
| `src/styles/softui.productivity.css` | Styles locaux Comexa Space. |
| `package.json` | Scripts `test:comexa`, `test:responsive:comexa`. |
| `backend/package.json` | `test:invariants` inclut `admin-policy.test.mjs`. |

### Intacts

Les rapports `docs/AUDIT-INCOHERENCES-METIER.md`, `docs/AUDIT-ESPACES-OPPORTUNITES.md`, `docs/STRATEGIE-SAAS-AUDIT.md`, `docs/AMELIORATION-ESPACE-PERSONNEL.md`, `docs/AMELIORATION-ESPACE-EQUIPE.md`, `docs/AMELIORATION-ESPACE-CLIENT.md`, `docs/REFONTE-SOFTUI.md`, `docs/dashboard-design-audit.md`, `backend/docs/security-audit.md`, `docs/API-N8N.md` et `docs/CONSOLE-N8N-AFFICHAGE.md` n’ont pas été modifiés. Aucune migration Prisma, aucun changement de schéma, aucun changement de `render.yaml`.

---

## 14. Résultats des tests réels

### 14.1 Baseline après Mission 4, avant modification Mission 5

- `npm run test:invariants` : **49/49 frontend + 30/30 backend**.
- `node --test tests/contract.test.mjs` : **5/5**.
- `npm test --prefix desktop` : **18/18**.
- `npx eslint` : **exit 0**.
- Chromium disponible : `153.0.8010.0`.

### 14.2 Après implémentation

| Commande | Résultat |
|---|---|
| `npm run test:invariants` | **58/58 frontend + 38/38 backend** |
| `npm run test:comexa` | **15/15** (9 helpers + 6 route agent-chat) |
| `node --test tests/contract.test.mjs` | **5/5** |
| `npm test --prefix desktop` | **18/18** |
| `npx eslint` | **exit 0** |
| `npm run build` | **Compiled successfully**, **66/66 pages** statiques générées |
| `git diff --check` | **OK** |
| `npm run test:responsive:comexa` | **70 mesures, 0 débordement, 0 erreur navigateur** |
| `npm run test:responsive:personal` | **6 mesures, 0 erreur** |
| `npm run test:responsive:team` | **15 mesures, 0 erreur** |
| `npm run test:responsive:client` | **30 mesures, 0 erreur** |

### 14.3 Blocage backend build

`npm run build --prefix backend` échoue avec **921 erreurs TypeScript**, dont l’absence de déclaration pour `../generated/prisma/client.js` (`TS7016`) et les erreurs en cascade qui en découlent. Le dossier `backend/src/generated/prisma/` ne contient que `client.js` et `enums.js`, sans fichiers `.d.ts`. `npm run prisma:generate --prefix backend` reste bloqué par le téléchargement du moteur Prisma (`binaries.prisma.sh`, erreur TLS). Ce blocage est environnemental et antérieur à la Mission 5 ; il n’est pas présenté comme un build CI réussi. Les tests backend utilisent `tsx` et les fonctions pures réelles, pas le `dist` compilé.

### 14.4 Ce que les nouveaux tests verrouillent

- Aucun JWT, secret `cxi_`, `Bearer` ou masque backend ne rejoint le DOM d’un détail d’audit.
- Un lien d’entité n’est jamais inventé sans permission ; les IDs sont encodés.
- Les filtres de journal envoient des bornes ISO, pas des dates ambiguës.
- Mail, stockage et cron ne passent jamais « opérationnels » sans sonde.
- Une sonde indisponible et un contrat incomplet produisent des états explicites.
- Le proxy agent-chat refuse HTTP externe, jeton `cxi_`, valeur non-JWT et message vide, sans appel réseau.
- Le contrat HTTPS historique `metadata.jwt` est conservé, mais le secret n’apparaît ni dans l’URL ni dans les en-têtes.
- Les règles d’espaces, d’identité, de portée client, de hachage de jeton et de refus des portées interdites sont testées directement côté backend.

---

## 15. Validation responsive et limites

### 15.1 Conditions réelles

- Navigateur : **Chromium 153.0.8010.0**, headless, `LD_LIBRARY_PATH=/tmp/chromium-libs/lib`.
- Serveur : `npm run dev -- --hostname 0.0.0.0 --port 3000`, API simulée par `context.route("**/api/**")`.
- Largeurs : **360, 390, 768, 1024, 1440 px**.
- Écrans mesurés : 14 — tableau de bord, journal, détail du journal, trois onglets de paramètres, matrice des rôles, intégrations, dialogue de révocation, membres, dialogue de suspension, notifications, contenu, compte.
- **70 mesures** au total : `documentWidth - viewport = 0` partout, 0 composant hors cadre, hauteur minimale des cibles **44 px**, largeur minimale mesurée **68 px**, 0 erreur console/page.

### 15.2 Interactions vérifiées à 390 px

- Filtres du journal : les six paramètres partent au backend ; `from`/`to` sont des ISO complets tenant compte d’Africa/Algiers.
- Détail : dialogue `aria-modal`, diff avant/après, valeurs masquées, lien vers devis autorisé, copie réelle de l’ID via clipboard, fermeture par Escape.
- Accessibilité : boutons visibles avec nom accessible ; dialogue modal identifié.
- Paramètres : trois bandeaux d’impact distincts.
- Matrice : 46 cases de permissions visibles.
- Révocation : dialogue, confirmation, succès visible, exactement un POST `/revoke`.
- Suspension : menu d’actions stable, dialogue de confirmation.
- États : chargement avec squelette, vide avec message honnête, erreur API avec sonde indisponible et contrôles non vérifiés conservés.
- Aucun secret factice ni chaîne de type JWT dans le DOM ; les charges utiles d’audit simulées arrivent déjà `[masque]`.

### 15.3 Limites assumées

- API simulée : pas de PostgreSQL, pas de Mailjet, pas de stockage S3, pas de cron réel, pas de Socket.IO backend.
- n8n externe absent : le contrat `metadata.jwt` est testé avec un fetch simulé, pas avec le workflow de production.
- Chromium uniquement, pas de Safari/Firefox ; pas de test utilisateur réel.
- Aucune capture d’écran générée par défaut ; `RESPONSIVE_SHOTS_DIR` permet d’en générer sans secret.
- La date de dernier usage des jetons est arrondie à la minute par le backend : les seuils de revue sont des indicateurs, pas une preuve d’inactivité exacte.
- Les tests d’onboarding historiques restent obsolètes (`npm run test:onboarding` référence des fichiers absents) ; ce point est hors périmètre Comexa Space.

---

## 16. Problèmes différés et blocages

1. **Délégation n8n courte durée.** Il faut un jeton signé par le backend, avec une portée minimale, une expiration courte, un lien avec la session utilisateur, et une migration du workflow externe. Blocage : workflow et propriétaire n8n hors dépôt.
2. **`EMAIL_VERIFICATION_REQUIRED=true`.** Correction souhaitable mais dépendante du domaine Mailjet et de la remise en état des tests d’onboarding.
3. **Source de vérité `company.*` vs `PDF_COMPANY_*`.** Il faut décider si les paramètres UI alimentent les PDF ou si l’UI est retirée/dépréciée. Impact facturation et autres espaces.
4. **Politique de durée de vie des jetons.** Une durée maximale organisationnelle et une éventuelle révocation automatique exigent un inventaire des intégrations actives et une période de transition.
5. **Sondes mail / stockage / cron.** Un endpoint admin minimal pourrait être justifié plus tard, mais uniquement avec de vraies vérifications et des états dégradés / indisponibles / non configurés. `/api/health` public ne doit pas devenir un annuaire technique.
6. **Simulation et diff des rôles.** Le résumé en langage clair, les permissions héritées et l’avertissement de verrouillage demandent une règle backend, pas seulement des cases colorées.
7. **Notifications admin et workflow éditorial.** Toute diffusion doit définir destinataires, idempotence et état de lecture ; aucun bouton « broadcast » décoratif n’a été ajouté.
8. **Recherche plein texte dans l’audit.** Refusée par conception : elle créerait un oracle sur des valeurs masquées.
9. **SSO/SAML, multi-tenant, abonnements, monitoring externe.** Hors périmètre et non justifiés par l’audit.

---

## 17. Recommandation pour la prochaine mission

**Mission 6 recommandée : « clore le risque n8n et rendre les paramètres réellement actifs ».**

Ordre proposé :

1. **Délégation n8n.** Créer côté backend un jeton de délégation court, signé, lié à la session et limité aux droits nécessaires ; faire accepter ce jeton par le workflow externe ; prévoir une période de double lecture (`metadata.jwt` + `metadata.delegation`) avant de retirer l’ancien champ. Ne pas modifier `docs/API-N8N.md` avant que le contrat externe soit réellement migré.
2. **`company.*` → PDF.** Choisir une source de vérité unique. Soit le service PDF lit les paramètres validés avec un cache et une valeur de repli explicite, soit l’UI cesse de présenter ces champs comme configurables. Ajouter un test de génération PDF avec coordonnées personnalisées.
3. **Politique de jetons.** Après inventaire des workflows, introduire une durée de vie maximale configurable et une alerte d’inactivité, sans révocation automatique brutale.
4. **Sondes d’exploitation.** Si le besoin est confirmé, ajouter un endpoint **autorisé** distinct de `/api/health` pour les derniers résultats mail/storage/cron, avec horodatage et états explicites. Ne jamais déduire « opérationnel » de la seule présence de variables d’environnement.

Cette mission doit rester dans la même discipline : petite tranche cohérente, tests qui échouent sur l’ancien comportement, backend autoritaire, aucun secret dans les journaux, et validation navigateur aux cinq largeurs avant toute nouvelle richesse graphique.
