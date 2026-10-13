# API Comexa et n8n — guide de connexion

Ce document explique comment un serveur externe (n8n, agent IA, script) appelle
l'API Comexa **sans emprunter la session d'un utilisateur connecté dans son
navigateur**.

Il décrit ce qui est **réellement implémenté** à ce jour. Ce qui ne l'est pas
encore est listé à la fin, dans « État d'avancement » — aucune route n'est
documentée par avance.

---

## 1. URL de base et préfixe

| | |
|---|---|
| URL publique | l'URL du service Render, par ex. `https://comexa-api.onrender.com` |
| Préfixe pour les intégrations | `/api/v1` |
| Préfixe historique (frontend) | `/api` |
| Contrôle de santé | `GET /api/health` (public) |

**`/api/v1/...` est un alias de `/api/...`** : les deux tombent sur le même
contrôleur. Le frontend continue d'appeler `/api/*`, les machines écrivent
`/api/v1/*`. Une seule implémentation, donc aucun risque de divergence entre les
deux.

```bash
curl https://comexa-api.onrender.com/api/health
# { "success": true, "data": { "status": "ok", "contract": { ... } } }
```

Le bloc `contract` de cette réponse donne la version du contrat servie
(`version`) et les fonctionnalités activées (`features`). C'est le premier
réflexe en cas de doute : **si `taskCreators` n'y figure pas, le backend n'a pas
encore été redéployé** avec le code à jour.

---

## 2. Créer un jeton

### 2.1 Premier jeton, depuis le serveur (procédure sûre)

La première machine doit être autorisée sans qu'aucune machine ne le soit déjà :
c'est pourquoi la création initiale se fait par un **script exécuté côté
serveur**, avec l'accès à la base — et non par une route qui exigerait un
administrateur déjà connecté.

```bash
cd backend
INTEGRATION_NAME=n8n-production \
INTEGRATION_SCOPES=task:read:any,project:read:any \
INTEGRATION_EXPIRES_DAYS=365 \
npm run integration:token
```

Sortie :

```
Jeton d’integration cree.
  nom        : n8n-production
  identifiant: cmv…
  prefixe    : cxi_1a2b3c4d… (reconnaissance, jamais un secret)
  droits     : project:read:any, task:read:any
  expiration : 2027-10-13T00:00:00.000Z

SECRET — affiche une seule fois, il n’est pas stocke :

    cxi_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

> **Le secret n'est pas stocké.** La base ne conserve que son empreinte SHA-256.
> Si vous le perdez, il n'y a pas de récupération : on en crée un nouveau, ou on
> renouvelle le jeton. Copiez-le immédiatement dans n8n.

`INTEGRATION_NAME` : minuscules, chiffres et tirets, 3 à 40 caractères
(`n8n-production`, `agent-veille`). Il est unique et sert à reconnaître le jeton.

### 2.2 Jetons suivants, par l'API

Une fois un administrateur connecté, tout se fait en HTTP :

| Action | Requête |
|---|---|
| Créer | `POST /api/integrations/tokens` — `integration:manage:any` → **201**, `secret` dans la réponse |
| Lister | `GET /api/integrations/tokens` — `integration:read:any` |
| Renouveler le secret | `POST /api/integrations/tokens/:id/renew` → **200**, nouveau `secret` |
| Révoquer | `POST /api/integrations/tokens/:id/revoke` |
| Supprimer | `DELETE /api/integrations/tokens/:id` |

```bash
curl -X POST https://…/api/integrations/tokens \
  -H "Authorization: Bearer <JWT administrateur>" \
  -H "Content-Type: application/json" \
  -d '{"name":"agent-veille","scopes":["task:read:any"],"expiresInDays":180}'
```

Les listes ne rendent **jamais** de secret : `name`, `prefix`, `scopes`,
`lastUsedAt`, `expiresAt`, `revokedAt`, `createdAt`, `active`.

---

## 3. Configurer n8n

### 3.1 Le credential

**Credentials → New → Header Auth**

| Champ | Valeur |
|---|---|
| Name | `Authorization` |
| Value | `Bearer cxi_…` (le secret, sans guillemets) |

Un credential par intégration : c'est ce qui permet de révoquer un workflow sans
casser les autres, et de voir dans les journaux lequel a appelé.

### 3.2 Le nœud HTTP Request

| Champ | Valeur |
|---|---|
| Method | selon l'opération |
| URL | `https://comexa-api.onrender.com/api/v1/tasks?perPage=50` |
| Authentication | **Predefined Credential Type** |
| Credential Type | Header Auth |
| Header Auth | le credential créé ci-dessus |
| Options → Response → Full Response | **off** (le corps suffit) |

Ne jamais cocher « Send Body » sur un `GET`, et ne jamais construire l'en-tête
`Authorization` à la main dans un champ « Headers » : le secret finirait dans
l'historique des exécutions.

### 3.3 Trois recettes

**Tâches en retard, chaque matin à 8 h** — `GET /api/v1/me/tasks?perPage=100`,
puis un nœud `IF` sur `dueDate < now` et `status != DONE`.

**Alerter quand une tâche est créée** (polling) — `GET
/api/v1/projects/{projectId}/tasks?perPage=100` avec un nœud de dédoublonnement
sur `id` (l'API ne diffuse pas encore d'événements, voir §8).

**Rapport hebdomadaire** — `GET /api/v1/time-entries?from=…&to=…&perPage=100`,
agrégation dans un nœud `Code`.

---

## 4. Format des réponses

Toute réponse suit la même enveloppe.

**Succès**

```json
{
  "success": true,
  "data": { "id": "cmv…", "title": "Maquette de l'accueil" }
}
```

**Liste paginée** — les métadonnées sortent de `data` :

```json
{
  "success": true,
  "data": [ { "id": "cmv…" } ],
  "meta": { "page": 1, "perPage": 20, "total": 137, "totalPages": 7 }
}
```

**Échec**

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Les paramètres envoyés sont invalides",
    "details": {}
  }
}
```

`error.code` est **stable** : c'est lui qu'un workflow doit tester, jamais le
message (qui est fait pour un humain et peut être reformulé).

### Codes HTTP

| Code | Signification |
|---|---|
| 200 | succès |
| 201 | ressource créée |
| 400 | requête mal formée (`VALIDATION_ERROR` le plus souvent) |
| 401 | jeton absent, invalide, révoqué ou expiré |
| 403 | jeton valide, mais l'opération n'est pas permise |
| 404 | ressource inexistante **ou hors de portée** (volontaire : ne pas révéler ce qui existe) |
| 409 | conflit d'état (ex. un minuteur déjà actif) |
| 422 | requête comprise, mais contraire à une règle métier |
| 429 | limite de débit dépassée |
| 500 | erreur interne, sans détail technique |

### Pagination et filtres

`?page=1&perPage=20` — `perPage` est plafonné à 100, `page` commence à 1. Les
filtres dépendent de la ressource ; ils sont listés dans `backend/docs/API.md` et
dans le Swagger.

### Rejouer une création sans la refaire (idempotence)

n8n réessaie. Un nœud HTTP qui expire côté client renvoie la même requête, et le
serveur — qui l'a peut-être déjà traitée — créerait une **deuxième** tâche. Deux
appels identiques donneraient deux lignes, et l'équipe perdrait confiance dans
l'automatisme.

La parade est une **clé d'idempotence**, envoyée dans un en-tête :

```
Idempotency-Key: n8n-creation-tache-2026-10-13-001
```

| Situation | Réponse |
|---|---|
| Pas d'en-tête | exécution normale — **rien ne change** pour le frontend, qui n'en envoie jamais |
| Clé inconnue | exécution, puis mémorisation de la réponse (24 h) |
| Même clé, même corps | la réponse est **rejouée**, avec l'en-tête `Idempotency-Replayed: true` |
| Même clé, autre corps | **422** `IDEMPOTENCY_KEY_REUSED` — jamais une réponse qui ne correspond pas à la demande |
| Clé mal formée | **400** `IDEMPOTENCY_KEY_INVALID` |

La clé est **par opération logique**, pas par essai : une clé par tâche à créer.
Dans n8n, générez-la en amont (un nœud `Code`, ou une expression), et conservez-la
dans les rejeux du nœud HTTP.

Seules les créations sont concernées aujourd'hui :
`POST /api/v1/projects/{id}/tasks` et `POST /api/v1/me/tasks`. Une réponse en
erreur n'est jamais rejouée : le client corrige son corps et renvoie la **même**
clé, ce qui est précisément l'usage voulu.

---

## 5. Permissions : n'accorder que le nécessaire

`scopes` est un sous-ensemble du catalogue de permissions
(`backend/src/common/auth/permissions.catalogue.ts`). Un code inconnu est
**refusé** à la création (422) plutôt qu'ignoré.

| Cas d'usage | Permissions minimales |
|---|---|
| Lire les tâches et les projets | `task:read:any`, `project:read:any` |
| Créer et faire avancer des tâches | `task:read:any`, `task:write:any` |
| Piloter l'équipe (assigner) | les précédentes + `task:assign:any` |
| Consulter le temps passé | `time:read:any` |
| Écrire du temps (saisie automatique) | `time:write:any` |
| Lecture seule, pour un tableau de bord | `dashboard:read:any` si le rôle le prévoit |

**Le niveau de lecture suit le jeton, pas la confiance.** Une intégration qui n'a
que `task:read:own` ne verra que les tâches qui lui sont assignées — mais un
compte technique n'est assigné à rien, elle ne verrait donc rien. Pour une
machine, il faut un scope `any`.

**Aucune intégration ne peut gérer les intégrations** : `integration:manage:any`
est refusé dans `scopes`. Une machine ne se distribue pas d'accès à elle-même.

---

## 6. Ce qui protège l'API

| Mesure | État |
|---|---|
| HTTPS en production | oui (Render) ; **jamais** d'appel en `http` avec un jeton |
| Authentification obligatoire | oui — garde global : tout est fermé sauf les routes `@Public()` |
| Droits par ressource | oui — les scopes (`any`/`own`/`assigned`) sont appliqués dans la requête SQL, pas après coup |
| Secret jamais stocké en clair | oui — empreinte SHA-256, comparaison à durée constante |
| Révocation immédiate | oui — le jeton est relu en base à chaque requête, sans cache |
| Expiration configurable | oui (`expiresInDays`) |
| Traçabilité | oui — journal d'audit (`INTEGRATION_TOKEN_*`) et `lastUsedAt` |
| Validation stricte des entrées | oui — `ValidationPipe` global, `whitelist` + `forbidNonWhitelisted` |
| Limitation de débit | oui — globale, réglable (`RATE_LIMIT_LIMIT`, `RATE_LIMIT_TTL`) |
| Rejeu sans double création | oui — en-tête `Idempotency-Key` sur les créations (ci-dessus) |
| Plafond de pagination | oui — 100 éléments par page |
| Accès direct à la base depuis Internet | **non et jamais** — aucun port PostgreSQL n'est exposé |
| CORS | liste blanche (`CORS_ORIGIN`) ; n8n appelle en serveur-à-serveur et n'en dépend pas |
| Secrets dans les réponses / journaux | non — `tokenHash` est exclu de toute projection ; seul le `prefix` est journalisé |

**Test d'accès horizontal** : remplacer un identifiant dans l'URL
(`/api/v1/tasks/{id}` d'une autre équipe) renvoie **404**, pas la donnée, et pas
403 — un 403 confirmerait que la ressource existe.

---

## 7. Dépannage

| Symptôme | Cause probable |
|---|---|
| 401 `INTEGRATION_TOKEN_INVALID` | jeton mal copié, tronqué, ou préfixe `Bearer ` oublié |
| 401 `INTEGRATION_TOKEN_REVOKED` | jeton révoqué → renouveler (`renew`) et remettre le secret dans n8n |
| 401 `INTEGRATION_TOKEN_EXPIRED` | `expiresInDays` dépassé → renouveler |
| 403 `Droit insuffisant : …` | le code manque dans `scopes` → renouveler avec les bons |
| 404 sur une ressource qui existe | hors de portée du jeton (scope trop étroit) |
| 422 `INTEGRATION_SCOPE_UNKNOWN` | faute de frappe dans un code de permission |
| 404 sur `/api/v1/...` | backend pas redéployé, ou `API_PREFIX` différent |
| 429 | plafond atteint → desserrer `RATE_LIMIT_*`, ou espacer les exécutions |

---

## 8. État d'avancement

**En place** : jetons d'intégration (création, liste, renouvellement,
révocation, suppression), vérification serveur, permissions par jeton,
traçabilité, alias `/api/v1`, limitation de débit réglable, idempotence des
créations, documentation.

**Non implémenté** (et volontairement absent de ce document jusqu'à livraison) :

- **webhooks signés** (tentatives, doublons, échecs). Aujourd'hui, une
  automatisation qui veut réagir à un événement interroge l'API à intervalle et
  dédoublonne côté workflow. Des webhooks supposent une signature, une file
  d'attente, des rejeux et une politique d'échec : autant de pièces à livrer
  ensemble, sinon le premier incident double les notifications ;
- **documentation Swagger publique** : le Swagger reste protégé par identifiants
  (`DOCS_ENABLED`, `DOCS_USER`, `DOCS_PASSWORD`). Le contrat complet est commité
  dans `shared/api/openapi.json`, et se consulte sans déployer.

---

## 9. Ce qui reste à faire côté hébergement

Le code est prêt ; il reste des actions **manuelles**, impossibles depuis ce
dépôt :

1. **Redéployer le backend** (Render → service `comexa-api` → *Manual Deploy*, ou
   laisser `autoDeploy` suivre `main`). Les migrations, dont la table
   `integration_tokens`, s'appliquent automatiquement au démarrage du conteneur.
2. **Créer le premier jeton** sur le serveur (§2.1) puis coller le secret dans
   les credentials n8n.
3. **Vérifier** `GET /api/health` : la version du contrat doit être celle du code
   déployé.
4. **Renseigner** `RATE_LIMIT_LIMIT` / `RATE_LIMIT_TTL` dans l'environnement
   Render si les valeurs par défaut (120 / 60 s) ne conviennent pas au volume de
   workflows.
