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
| Transcrire les vocaux Telegram | `telegram:transcribe:any` |
| Envoyer un message WhatsApp depuis un compte autorisé | `whatsapp:send:any` + `telegram:link:any` (résoudre l'expéditeur) |
| Appairer / révoquer une session WhatsApp | `whatsapp:link:any` |
| Lire le répertoire et le journal des envois | `whatsapp:read:any` |

**Le niveau de lecture suit le jeton, pas la confiance.** Une intégration qui n'a
que `task:read:own` ne verra que les tâches qui lui sont assignées — mais un
compte technique n'est assigné à rien, elle ne verrait donc rien. Pour une
machine, il faut un scope `any`.

**Aucune intégration ne peut gérer les intégrations** : `integration:manage:any`
est refusé dans `scopes`. Une machine ne se distribue pas d'accès à elle-même.

**Un jeton WhatsApp ne devrait presque jamais tout porter.** `whatsapp:send:any`
envoie des messages depuis le téléphone d'une personne réelle ; `whatsapp:read:any`
lit un répertoire qui contient les coordonnées de gens qui n'ont rien demandé. Les
mettre sur le même jeton revient à donner à un seul workflow volé la capacité
d'écrire au nom de quelqu'un **et** de récupérer son carnet d'adresses. Deux
jetons, deux workflows, deux révocations indépendantes.

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
| 429 `WHATSAPP_RATE_LIMITED` | plafond **par compte WhatsApp** atteint (`WHATSAPP_MAX_MESSAGES_PER_HOUR`) → attendre la fin de l'heure glissante ; ne pas rejouer tout de suite |
| 409 `WHATSAPP_SESSION_NOT_CONNECTED` | le téléphone n'a pas scanné le QR, ou la session s'est déconnectée → relancer l'appairage (§10.3) |
| 403 `WHATSAPP_CONSENT_EXPIRED` / `_REVOKED` / `_OUTDATED` | le titulaire a retiré l'autorisation, ou le texte a changé → un nouveau consentement est nécessaire, aucun rejeu ne le contournera |
| 403 `WHATSAPP_SCOPE_NOT_GRANTED` | la capacité demandée (ex. `contact:read`) n'a pas été accordée au moment du consentement |
| 503 `WHATSAPP_GATEWAY_NOT_CONFIGURED` | `WHATSAPP_GATEWAY_DRIVER=none` côté serveur → la fonctionnalité n'est pas déployée |
| 502 / 503 `WHATSAPP_GATEWAY_*` | la passerelle (WAHA / Evolution) ne répond pas → vérifier son conteneur, pas le jeton |
| 503 `TRANSCRIPTION_NOT_CONFIGURED` | `TRANSCRIPTION_PROVIDER=none` → renseigner le moteur (§10.1) |
| 413 `TRANSCRIPTION_PAYLOAD_TOO_LARGE` | corps au-dessus de `TRANSCRIPTION_MAX_BYTES` ; le plus souvent, ce n'est pas un vocal |
| 422 `TRANSCRIPTION_UNSUPPORTED_FORMAT` | type MIME non audio (une vidéo Telegram arrive en `video/mp4`) |
| 502 `TRANSCRIPTION_UNAUTHORIZED` | la clé **du fournisseur** de transcription est refusée — pas votre jeton `cxi_` |

---

## 8. État d'avancement

**En place** : jetons d'intégration (création, liste, renouvellement,
révocation, suppression), vérification serveur, permissions par jeton,
traçabilité, alias `/api/v1`, limitation de débit réglable, idempotence des
créations, documentation, liaison Telegram multi-utilisateurs
(`/integrations/telegram/*`), transcription des vocaux Telegram et passerelle
WhatsApp (§10).

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

---

## 10. Vocaux Telegram et WhatsApp

Ces routes sont **servies** ; elles attendent chacune une configuration côté
serveur, sans laquelle elles répondent `503` avec un code stable plutôt que de
faire semblant. Le détail de l'architecture, du consentement et des risques est
dans `docs/TELEGRAM-VOIX-WHATSAPP.md`.

### 10.1 Transcrire un vocal

```
POST /api/v1/integrations/telegram/transcribe
Content-Type: multipart/form-data
```

| Champ | Obligatoire | Rôle |
|---|---|---|
| `file` | oui | les octets audio, téléchargés depuis Telegram |
| `telegramUserId` | oui | expéditeur — résolu en membre Comexa via la liaison existante |
| `telegramFileId` | oui | **clé de rejeu** : unique par fichier |
| `telegramChatId`, `telegramMessageId` | non | retrouver le message d'origine |
| `mimeType` | non | défaut : celui de la pièce jointe |
| `durationSeconds` | non | durée annoncée par Telegram |
| `language` | non | `fr`, `ar`… ; omis, le moteur détecte |
| `prompt` | non | vocabulaire attendu, pas une consigne |

Le workflow télécharge **d'abord** le fichier (`getFile`, puis
`https://api.telegram.org/file/bot<token>/<file_path>`) : l'API ne parle jamais à
Telegram. Un vocal arrive en OGG/Opus et se transmet **tel quel** — aucune
conversion, aucun ffmpeg.

Réponse : `data.text`, `data.language`, `data.provider`, `data.model`, et
`data.replayed`. **Aucun octet audio n'est conservé** ; le texte l'est
`TRANSCRIPT_RETENTION_DAYS` jours.

Un second appel sur le même `telegramFileId` rend la transcription existante avec
`replayed: true`, **sans nouvel appel au moteur** — donc sans nouveau coût. C'est
ce qui rend le nœud HTTP rejouable sans risque.

### 10.2 Envoyer un message WhatsApp

```
POST /api/v1/integrations/whatsapp/users/{userId}/messages
```

`{userId}` est l'identifiant **Comexa**, obtenu par
`GET /api/v1/integrations/telegram/resolve/{telegramUserId}`. Le corps :

| Champ | Obligatoire | Rôle |
|---|---|---|
| `to` | oui | numéro (`+213555123456`, `0555123456`) ou JID complet |
| `body` | oui | texte, ≤ `WHATSAPP_MAX_BODY_LENGTH` |
| `idempotencyKey` | conseillé | anti-double-envoi sur un rejeu du workflow |
| `countryCode` | non | indicatif par défaut pour un numéro local (défaut : `WHATSAPP_DEFAULT_COUNTRY_CODE`) |
| `telegramChatId`, `telegramMessageId` | non | rattacher l'envoi à la demande |

La règle s'applique **avant** tout appel à la passerelle : consentement, état de
session, destinataire, longueur, plafond horaire. Un refus laisse une ligne
`REFUSED` dans le journal et rend le code correspondant (§7) — la passerelle n'est
pas appelée.

Les **groupes sont refusés** (`WHATSAPP_GROUP_NOT_ALLOWED`, 422) : un message de
groupe touche tous ses membres, ce qui dépasse l'autorisation donnée pour des
contacts individuels.

### 10.3 Appairage et consentement d'un tiers

| Route | Permission | Rôle |
|---|---|---|
| `POST /api/v1/integrations/whatsapp/users/{userId}/session` | `whatsapp:link:any` | démarre l'appairage, rend le QR en base64 (PNG) à afficher dans le chat |
| `GET …/users/{userId}/session` | `whatsapp:link:any` | état (`WAITING_QR` → `CONNECTED` après le scan) |
| `DELETE …/users/{userId}/session` | `whatsapp:link:any` | révocation : coupe la session, supprime les contacts copiés |
| `GET …/users/{userId}/contacts` | `whatsapp:read:any` | répertoire en cache, **seulement** si `contact:read` a été accordé |
| `GET …/users/{userId}/messages` | `whatsapp:read:any` | journal des envois |
| `POST /api/v1/integrations/whatsapp/delegations/accept` | `whatsapp:link:any` | le tiers envoie `/autoriser <code>` → QR à lui afficher |
| `POST /api/v1/integrations/whatsapp/delegations/refuse` | `whatsapp:link:any` | le tiers envoie `/refuser <code>` |

Une invitation est créée côté application web (`POST /api/whatsapp/delegations`) :
le code `WA-XXXX-XXXX-XXXX` est rendu **une seule fois**, et le texte de
consentement part par courriel au tiers. C'est **son** scan, depuis **son**
téléphone, qui termine l'appairage.

Le QR est rendu en base64 **sans préfixe `data:`** : Telegram attend des octets.
Dans n8n, un nœud *Convert to File* (base64 → binaire) puis *Send a photo* suffit.

