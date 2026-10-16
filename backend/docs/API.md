# API Comexa — contrat d'integration

Document destine au developpeur frontend. Il decrit ce que l'API garantit, pas ce
qu'elle espere : chaque affirmation ci-dessous a ete **mesuree sur l'application
reelle** (build compile, base Neon connectee) et non redigee de memoire.

Sauf mention contraire, les chemins sont relatifs au prefixe global (`API_PREFIX`,
`api` par defaut). Exemple : une route notee `/projects` s'appelle en realite
`/api/projects`.

---

## 1. Contrat de reponse — la seule chose a retenir

**Toutes** les reponses, succes comme echec, partagent la meme enveloppe. Le
frontend peut donc toujours tester `body.success` avant de lire quoi que ce soit.

### Succes

```json
{ "success": true, "data": { ... } }
```

`data` vaut `null` pour une operation sans contenu (un `DELETE`).

### Echec

```json
{
  "success": false,
  "error": { "code": "PROJECT_NOT_FOUND", "message": "Projet introuvable", "details": null }
}
```

**Le champ a tester est `error.code`, jamais `error.message`.** Le message est
destine a un humain : il peut etre reformule ou traduit sans preavis. Le code, lui,
est stable — c'est un contrat. Un `if (code === 'QUOTE_ALREADY_ACCEPTED')` ne
cassera pas au prochain changement de formulation.

Aucune trace de pile ne figure dans une reponse, en aucune circonstance.
L'implementation est dans `common/filters/all-exceptions.filter.ts` ; le
constructeur d'erreurs metier est `common/errors/app-error.ts`.

### PIEGE — les listes paginees

Pour une route qui renvoie une liste, `data` est **le tableau**, et les
metadonnees sont **a cote**, pas dedans :

```json
{
  "success": true,
  "data": [ { "id": "...", "name": "..." } ],
  "meta": { "page": 1, "perPage": 20, "total": 43, "totalPages": 3 }
}
```

Un service renvoie en interne `{ items, meta }`, et `TransformInterceptor`
deplace `meta` hors de `data` a la serialisation. Consequence a ne pas manquer :
**`data.items` n'existe pas** et vaut `undefined`. Le code qui ecrit
`body.data.items.map(...)` ne plante pas toujours — il iterera sur `undefined` et
affichera une liste vide, ce qui donne l'impression que l'API ne renvoie rien
alors que la requete est correcte. Ecrire `body.data.map(...)` et lire
`body.meta.total`.

Regle identique pour `totalPages` : **zero resultat donne `totalPages: 0`**, pas
`1`. Afficher « page 1 sur 1 » sur une liste vide est un bogue d'affichage, pas
une convention.

Bornes de pagination : `perPage` vaut 20 par defaut et **100 au maximum**. Le
plafond est volontaire : sans lui, `?perPage=1000000` transforme une liste en
export complet de la table.

---

## 2. Authentification

### Les dix routes d'authentification

| Route | Role | Acces |
|---|---|---|
| `POST /auth/login` | Connexion. Renvoie le jeton d'acces et pose le cookie de rafraichissement. | publique, 10/min |
| `POST /auth/refresh` | Renouvelle le jeton d'acces a partir du cookie. | publique, 30/min |
| `POST /auth/logout` | Revoque la session courante et efface le cookie. | publique |
| `POST /auth/logout-all` | Revoque **toutes** les sessions du porteur. | jeton |
| `POST /auth/forgot-password` | Envoie un lien de reinitialisation. | publique, 5/min |
| `POST /auth/reset-password` | Consomme le lien et pose le nouveau mot de passe. | publique, 10/min |
| `POST /auth/change-password` | Change le mot de passe du porteur connecte. | jeton |
| `GET /auth/me` | Profil du porteur : `roles`, `permissions`, `clientId`, `mustChangePassword`. | jeton |
| `GET /auth/sessions` | Sessions actives du porteur (agent et adresse d'origine). | jeton |
| `DELETE /auth/sessions/:id` | Ferme une session precise. | jeton |

**`POST /auth/register` n'existe pas.** Ce document l'annoncait : la ligne est
retiree, et aucun controleur de `src/` ne porte cette route. Un compte se cree
par un administrateur (`POST /users`, permission `user:manage:any`) ; le
formulaire public appelle `POST /public/contact-requests`, qui cree une
**demande de contact**, pas un compte. Le titulaire recoit un mot de passe
temporaire — c'est ce qui declenche l'etat decrit plus bas.

Aucune de ces dix routes ne porte de permission : le role n'y est jamais lu, et un
porteur authentifie y accede quel que soit son role. Sur les routes marquees
`publique`, le jeton est meme facultatif. Les refus y sont donc rares
(`PASSWORD_CHANGE_REQUIRED` mis a part, voir ci-dessous) — et c'est aussi pourquoi
le role `CLIENT` peut fermer ses propres sessions sans detenir de code dedie — le
catalogue n'en contient aucun (`session:*` n'existe pas).

### Utiliser un jeton

Le **jeton d'acces** se place dans l'en-tete, et nulle part ailleurs :

```
Authorization: Bearer <accessToken>
```

#### Les jetons d'integration (n8n, agents IA) — `Authorization: Bearer cxi_...`

Un serveur externe n'a ni navigateur, ni cookie, ni session : il presente un
**jeton d'integration** dans le meme en-tete.

```
Authorization: Bearer cxi_<secret>
```

Ce que ce jeton est, et n'est pas :

- **Un jeton par integration**, nomme (`n8n-production`), revocable et
  renouvelable separement. Jamais un mot de passe partage, jamais une cle
  codee en dur.
- **Des droits propres**, listes dans `scopes` : un sous-ensemble du catalogue
  de permissions. Une integration qui lit les taches ne recoit ni la
  facturation, ni les devis, ni la gestion des utilisateurs. Le compte
  technique qui la porte n'a AUCUN role : ses droits viennent du jeton, et de
  rien d'autre.
- **Jamais stocke en clair.** La base ne garde que son empreinte SHA-256 ; le
  secret n'est rendu qu'une fois, a la creation ou au renouvellement.
- **Revoque a la requete suivante** : le jeton est relu en base a chaque appel,
  sans cache. Revoquer coupe l'acces immediatement — c'est le seul comportement
  qui tient face a une fuite.
- **Refuse sur l'administration des integrations** : `integration:manage:any`
  ne peut pas figurer dans `scopes`. Une machine ne distribue pas d'acces,
  sinon un jeton vole permettrait d'en fabriquer d'autres.

Les routes d'administration (creer, renouveler, revoquer) sont reservees a un
administrateur authentifie par session. La procedure complete, les exemples n8n
et les codes d'erreur sont dans **`docs/API-N8N.md`** a la racine du depot.

Le **jeton de rafraichissement** voyage dans un cookie `httpOnly` nomme
`refresh_token`. Il est `httpOnly` volontairement : le JavaScript de la page ne
peut pas le lire, donc une injection de script ne peut pas le voler. Vous n'avez
donc rien a en faire — mais vous devez demander au navigateur de l'envoyer :

```js
fetch(`${API}/projects`, {
  credentials: 'include',                       // OBLIGATOIRE, voir ci-dessous
  headers: { Authorization: `Bearer ${token}` },
})
```

**`credentials: 'include'` est obligatoire** sur tout appel authentifie. Le CORS
est configure avec `credentials: true` et une liste blanche d'origines
(`CORS_ORIGIN`) : sans cette option, le navigateur n'envoie pas le cookie et
`POST /auth/refresh` echoue avec un 401 que rien dans la requete n'explique.
C'est le premier point a verifier devant un 401 inattendu.

### Rejouer une creation sans la refaire (`Idempotency-Key`)

Un client qui reessaie — timeout reseau, rejeu d'un workflow n8n — renvoie parfois
une requete deja traitee. Sans precaution, la creation se produit deux fois.

Deux routes l'acceptent aujourd'hui, `POST /projects/:projectId/tasks` et
`POST /me/tasks`, via un en-tete optionnel :

```
Idempotency-Key: creation-tache-2026-10-13-001
```

| Situation | Reponse |
|---|---|
| Aucun en-tete | execution normale. **Le frontend n'en envoie jamais** : son comportement ne change pas d'un octet. |
| Cle inconnue | execution, puis memorisation de la reponse pendant 24 h. |
| Meme cle, meme corps | la reponse est REJOUEE, avec `Idempotency-Replayed: true`. Rien n'est reecrit. |
| Meme cle, autre corps | 422 `IDEMPOTENCY_KEY_REUSED`. |
| Cle mal formee | 400 `IDEMPOTENCY_KEY_INVALID` (8 a 128 caracteres, lettres, chiffres, tirets et soulignes). |

La cle est propre au PORTEUR : deux integrations peuvent employer la meme chaine
sans se marcher dessus. Seules les reponses 2xx sont memorisees — une 400 corrigee
puis renvoyee avec la meme cle est exactement l'usage voulu.

### L'etat « mot de passe a changer »

Un compte cree par un administrateur a un mot de passe initial que
l'administrateur connait. Tant qu'il n'a pas ete change, **le serveur ferme tout**
et repond `PASSWORD_CHANGE_REQUIRED` (HTTP 403) sur chaque appel, sauf sur les
routes marquees `@AllowPasswordChangeRequired()`. Elles sont **trois** :
`POST /auth/change-password`, `GET /auth/me` et `POST /auth/logout-all`. S'y
ajoutent les routes publiques, qu'aucun jeton n'ouvre : `POST /auth/logout` et
`POST /auth/refresh` restent donc joignables.

Cette liste est plus courte qu'elle n'en a l'air : `GET /auth/sessions` et
`DELETE /auth/sessions/:id` **sont fermees** tant que le mot de passe n'a pas ete
change — un porteur dans cet etat ne peut pas fermer une session. Le refus est un
403 `PASSWORD_CHANGE_REQUIRED`, jamais un 401 : le jeton est valide, c'est l'etat
du compte qui ferme la porte.

Ce n'est pas un drapeau d'affichage : cacher un bouton ne protegerait rien, un
appel direct a l'API passerait outre. Le frontend doit donc intercepter ce code
**globalement** et rediriger vers l'ecran de changement de mot de passe, pas le
traiter au cas par cas dans chaque ecran.

---

## 3. Codes d'erreur

### Codes generiques (`ErrorCode`, `common/errors/app-error.ts`)

| Code | HTTP | Signification |
|---|---|---|
| `VALIDATION_FAILED` | 400 | Le corps ne respecte pas le contrat du DTO. |
| `UNAUTHENTICATED` | 401 | Aucun jeton, ou jeton illisible. |
| `INVALID_CREDENTIALS` | 401 | Identifiants incorrects. |
| `TOKEN_EXPIRED` | 401 | Jeton d'acces expire : tenter `POST /auth/refresh`. |
| `TOKEN_INVALID` | 401 | Jeton malforme ou signature invalide. |
| `IDEMPOTENCY_KEY_INVALID` | 400 | Cle d'idempotence mal formee. |
| `IDEMPOTENCY_KEY_REUSED` | 422 | Cle d'idempotence rejouee avec un autre corps. |
| `REFRESH_TOKEN_REUSED` | 401 | Reutilisation d'un jeton de rafraichissement : session revoquee. |
| `ACCOUNT_LOCKED` | 403 | Compte verrouille apres trop d'echecs. |
| `ACCOUNT_SUSPENDED` | 403 | Compte suspendu par un administrateur. |
| `ACCOUNT_INVITED` | 403 | Cree mais jamais active. Message different de « suspendu ». |
| `PASSWORD_CHANGE_REQUIRED` | 403 | Voir §2. |
| `FORBIDDEN` | 403 | Authentifie, mais sans le droit necessaire. |
| `NOT_FOUND` | 404 | Route inconnue. |
| `CONFLICT` | 409 | Violation d'unicite. |
| `UNPROCESSABLE` | 422 | Requete bien formee, etat metier incompatible. |
| `RATE_LIMITED` | 429 | Voir §6. |
| `PAYLOAD_TOO_LARGE` | 413 | Corps trop volumineux. |
| `INTERNAL_ERROR` | 500 | Le detail reste dans les journaux du serveur. |
| `SERVICE_UNAVAILABLE` | 503 | Dependance indisponible (base de donnees, stockage). |

`TOKEN_EXPIRED` et `TOKEN_INVALID` sont distincts a dessein : le premier doit
declencher un `refresh` transparent, le second doit deconnecter. Les confondre
provoque soit une boucle de rafraichissement, soit une deconnexion sur un jeton
simplement perime.

### Codes metier

Ils suivent la convention `RESSOURCE_NOT_FOUND` et sont, comme les precedents,
stables. **Les 137 codes que le code leve reellement**, groupes par domaine comme
dans `shared/api/error-codes.ts`, chacun avec le statut HTTP de la fabrique qui le
leve (`AppException.notFound` 404, `conflict` 409, `unprocessable` 422,
`badRequest` 400 — lire `common/errors/app-error.ts`) :

#### Contenu public

| Code | HTTP |
|---|---|
| `SERVICE_NOT_FOUND` | 404 |
| `PACKAGE_NOT_FOUND` | 404 |
| `CASE_STUDY_NOT_FOUND` | 404 |
| `CONTENT_NOT_FOUND` | 404 |
| `CATEGORY_NOT_FOUND` | 404 |
| `SLUG_INVALID` | 422 |
| `SLUG_RESERVED` | 422 |
| `SLUG_TAKEN` | 409 |
| `MODIFICATION_REQUEST_NOT_FOUND` | 404 |
| `MODIFICATION_ALREADY_DECIDED` | 409 |

#### CRM : visiteur -> prospect -> client

| Code | HTTP |
|---|---|
| `CONTACT_REQUEST_NOT_FOUND` | 404 |
| `CONTACT_REQUEST_ALREADY_CONVERTED` | 409 |
| `CONTACT_REQUEST_CONVERT` | 422 |
| `PROSPECT_NOT_FOUND` | 404 |
| `PROSPECT_ALREADY_CONVERTED` | 409 |
| `PROSPECT_CONVERTED_NOT_DELETABLE` | 409 |
| `PROSPECT_LOST_NOT_CONVERTIBLE` | 422 |
| `PROSPECT_OWNER_NOT_FOUND` | 422 |
| `PROSPECT_STATUS_CHANGED` | 409 |
| `LEAD_STATUS_TRANSITION_INVALID` | 422 |
| `LEAD_STATUS_UNCHANGED` | 422 |
| `CLIENT_NOT_FOUND` | 404 |
| `CLIENT_ACCOUNT_MANAGER_NOT_FOUND` | 422 |
| `CONTACT_NOT_FOUND` | 404 |

#### Projets

| Code | HTTP |
|---|---|
| `PROJECT_NOT_FOUND` | 404 |
| `PROJECT_CODE_TAKEN` | 409 |
| `PROJECT_CLIENT_NOT_FOUND` | 422 |
| `PROJECT_MEMBER_NOT_FOUND` | 404 |
| `PROJECT_USER_NOT_FOUND` | 422 |
| `PROJECT_MANAGER_MUST_BE_MEMBER` | 422 |
| `PROJECT_STATUS_TRANSITION_REFUSED` | 422 |
| `PROJECT_STATUS_UNCHANGED` | 409 |

#### Taches

| Code | HTTP |
|---|---|
| `TASK_NOT_FOUND` | 404 |
| `TASK_ASSIGNEE_IS_CLIENT` | 422 |
| `TASK_ASSIGNEE_NOT_FOUND` | 422 |
| `TASK_ASSIGNEE_UNCHANGED` | 409 |
| `TASK_CLOSED_NOT_EDITABLE` | 422 |
| `TASK_EDIT_CONFLICT` | 409 |
| `TASK_HAS_OPEN_SUBTASKS` | 422 |
| `TASK_HAS_SUBTASKS` | 422 |
| `TASK_MILESTONE_NOT_FOUND` | 422 |
| `TASK_PARENT_CLOSED` | 422 |
| `TASK_PARENT_NOT_FOUND` | 422 |
| `TASK_STATUS_CONFLICT` | 409 |
| `TASK_STATUS_TRANSITION_REFUSED` | 422 |
| `TASK_STATUS_UNCHANGED` | 409 |

#### Jalons

| Code | HTTP |
|---|---|
| `MILESTONE_NOT_FOUND` | 404 |
| `MILESTONE_EDIT_CONFLICT` | 409 |
| `MILESTONE_HAS_TASKS` | 422 |
| `MILESTONE_REACHED_NOT_DELETABLE` | 422 |
| `MILESTONE_STATUS_TRANSITION_REFUSED` | 422 |

#### Temps passe

| Code | HTTP |
|---|---|
| `TIME_ENTRY_NOT_FOUND` | 404 |
| `TIME_ENTRY_AUTHOR_IS_CLIENT` | 422 |
| `TIME_ENTRY_AUTHOR_NOT_FOUND` | 422 |
| `TIME_ENTRY_DELETE_CONFLICT` | 409 |
| `TIME_ENTRY_EDIT_CONFLICT` | 409 |
| `TIME_ENTRY_FUTURE_DAY` | 422 |
| `TIME_INVALID_MINUTES` | 422 |

#### Devis

| Code | HTTP |
|---|---|
| `QUOTE_NOT_FOUND` | 404 |
| `QUOTE_EXPIRED` | 409 |
| `QUOTE_ALREADY_ACCEPTED` | 409 |
| `QUOTE_ALREADY_REJECTED` | 409 |
| `QUOTE_CANCELLED` | 409 |
| `QUOTE_NOT_SENT` | 409 |
| `QUOTE_EMPTY` | 422 |
| `QUOTE_LINES_INCONSISTENT` | 422 |
| `QUOTE_CLIENT_NOT_FOUND` | 422 |
| `QUOTE_PROSPECT_NOT_FOUND` | 422 |
| `QUOTE_TARGET_INVALID` | 422 |
| `QUOTE_NOT_DELETABLE` | 409 |
| `QUOTE_NOT_EDITABLE` | 409 |
| `QUOTE_NOT_INVOICEABLE` | 409 |
| `QUOTE_NOT_SENDABLE` | 409 |
| `QUOTE_NOT_VIEWABLE` | 409 |

#### Factures et paiements

| Code | HTTP |
|---|---|
| `INVOICE_NOT_FOUND` | 404 |
| `INVOICE_NOT_CANCELLABLE` | 409 |
| `INVOICE_NOT_DELETABLE` | 409 |
| `INVOICE_NOT_PAYABLE` | 409 |
| `INVOICE_NOT_SENDABLE` | 409 |
| `INVOICE_DUE_DATE_BEFORE_ISSUE` | 400 |
| `PAYMENT_NOT_FOUND` | 404 |
| `PAYMENT_ALREADY_REMOVED` | 409 |
| `PAYMENT_AMOUNT_INVALID` | 422 |
| `PAYMENT_EXCEEDS_BALANCE` | 422 |
| `PAYMENT_PROOF_NOT_FOUND` | 422 |

#### Documents et stockage

| Code | HTTP |
|---|---|
| `DOCUMENT_NOT_FOUND` | 404 |
| `DOCUMENT_ATTACHMENT_MISMATCH` | 422 |
| `DOCUMENT_ATTACHMENT_REQUIRED` | 422 |
| `FILE_REQUIRED` | 400 |
| `EMPTY_FILE` | 422 / 400 |
| `INVALID_FILE_SIZE` | 400 |
| `UNSUPPORTED_FILE_TYPE` | 422 |
| `STORAGE_OBJECT_NOT_FOUND` | 404 |
| `INVALID_STORAGE_KEY` | 400 |
| `INVALID_STORAGE_PREFIX` | 400 |
| `STORAGE_SIGNED_URL_UNSUPPORTED` | 422 |
| `STORAGE_STREAM_UNSUPPORTED` | 422 |
| `STORAGE_WRITE_INCOMPLETE` | 422 |

#### Messagerie et notifications

| Code | HTTP |
|---|---|
| `CONVERSATION_NOT_FOUND` | 404 |
| `CONVERSATION_NOTHING_TO_UPDATE` | 422 |
| `CONVERSATION_PARTICIPANT_NOT_FOUND` | 404 |
| `CONVERSATION_PARTICIPANT_UNKNOWN` | 422 |
| `CONVERSATION_WITHOUT_PARTICIPANT` | 422 |
| `MESSAGE_ATTACHMENT_UNKNOWN` | 422 |
| `MESSAGE_CURSOR_INVALID` | 400 |
| `MESSAGE_REPLY_TARGET_NOT_FOUND` | 422 |
| `NOTIFICATION_NOT_FOUND` | 404 |

#### Comptes, roles, sessions

| Code | HTTP |
|---|---|
| `USER_NOT_FOUND` | 404 |
| `USER_ALREADY_ACTIVE` | 409 |
| `USER_ALREADY_SUSPENDED` | 409 |
| `LAST_ADMIN_PROTECTED` | 422 |
| `SELF_ADMIN_REMOVAL_FORBIDDEN` | 422 |
| `SELF_DELETE_FORBIDDEN` | 422 |
| `SELF_SUSPEND_FORBIDDEN` | 422 |
| `CLIENT_ROLE_REQUIRED` | 422 |
| `CLIENT_SCOPE_STILL_ATTACHED` | 422 |
| `ROLE_NOT_FOUND` | 404 |
| `ROLE_IMMUTABLE` | 422 |
| `UNKNOWN_ROLE` | 422 |
| `UNKNOWN_PERMISSION` | 422 |
| `SESSION_NOT_FOUND` | 404 |
| `WEAK_PASSWORD` | 422 |
| `PASSWORD_MISMATCH` | 422 |
| `PASSWORD_UNCHANGED` | 422 |
| `EMAIL_ALREADY_USED` | 409 |
| `CONCURRENT_MODIFICATION` | 409 |

#### Rapports et parametres

| Code | HTTP |
|---|---|
| `REPORT_NOT_FOUND` | 404 |
| `REPORT_PROJECT_NOT_FOUND` | 404 |
| `REPORT_PERIOD_INVALID` | 422 |
| `REPORT_PERIOD_AMBIGUOUS` | 422 |
| `REPORT_PERIOD_INCOMPLETE` | 422 |
| `REPORT_TYPE_UNSUPPORTED` | 422 |
| `INVALID_PERIOD` | 422 |
| `SETTING_VALUE_INVALID` | 422 |
| `SETTING_KEY_INVALID` | 400 |
| `SETTING_KEY_DUPLICATED` | 400 |
| `SETTING_VALUE_TOO_LARGE` | 422 |

Deux pieges que le nom du code ne donne pas :

- **`EMPTY_FILE` porte deux statuts** : 422 sur le chemin du stockage
  (`common/storage/storage.key.ts`, `AppException.unprocessable`) et 400 sur celui
  des documents (`documents/documents.service.ts`, `AppException.badRequest`). Le
  meme fichier vide ne se refuse donc pas de la meme facon selon la route.
- **Douze codes en `_NOT_FOUND` repondent 422, pas 404** :
  `PROSPECT_OWNER_NOT_FOUND` `CLIENT_ACCOUNT_MANAGER_NOT_FOUND`
  `PROJECT_CLIENT_NOT_FOUND` `PROJECT_USER_NOT_FOUND` `TASK_ASSIGNEE_NOT_FOUND`
  `TASK_MILESTONE_NOT_FOUND` `TASK_PARENT_NOT_FOUND` `TIME_ENTRY_AUTHOR_NOT_FOUND`
  `QUOTE_CLIENT_NOT_FOUND` `QUOTE_PROSPECT_NOT_FOUND` `PAYMENT_PROOF_NOT_FOUND`
  `MESSAGE_REPLY_TARGET_NOT_FOUND`. Ce sont les refus portant sur une entite
  **citee** dans la requete (un responsable, un client, un jalon, une tache
  parente) : la requete est bien formee, la reference qu'elle contient ne resout
  pas. Le suffixe ne suffit donc pas a deduire le statut.

Cette liste est une **mesure**, et elle se regenere. Depuis `backend/` :

```sh
grep -rzoE "AppException\.(notFound|conflict|unprocessable|badRequest)\([[:space:]]*'[A-Z_]+'" \
  --exclude-dir=generated src \
  | tr '\0' '\n' | grep -oE "'[A-Z_]+'" | tr -d "'" | sort -u
```

Elle en trouve **132**. Les **cinq** autres lui echappent, et pas par accident :
trois sortent d'un `switch` qui les retourne (`QUOTE_ALREADY_REJECTED`,
`QUOTE_CANCELLED`, `QUOTE_NOT_SENT`, dans `quotes/quote-state.ts`, tous 409) et
deux d'un ternaire (`SELF_DELETE_FORBIDDEN`, `SELF_SUSPEND_FORBIDDEN`, dans
`users/identity-rules.ts`, tous 422). 132 + 5 = 137. Un code construit dans une
variable echapperait de meme : c'est pourquoi `error.code` se **teste**, il ne
s'enumere pas.

`LAST_ADMIN_PROTECTED` merite une mention : il refuse la suppression ou la
suspension du **dernier** administrateur actif. Sans cette regle, un
administrateur distrait peut se verrouiller dehors, lui et toute l'organisation,
sans aucun moyen de revenir en arriere par l'API.

---

## 4. Autorisation

### Les sept roles

`ADMIN` · `COMMUNICATION_MANAGER` · `PROJECT_MANAGER` · `DEVELOPER` · `DESIGNER`
· `SALES` · `CLIENT`

### Les permissions

Le catalogue compte **100 codes** de la forme `ressource:action:portee`
(exactement trois segments). Chaque role detient une liste de codes ; `ADMIN`
detient `'ALL'`.

Le typage est verifie a la compilation et par `permissions.catalogue.spec.ts` :
un code mal orthographie fait echouer la suite de tests plutot que de refuser
silencieusement un acces legitime en production.

### Les six portees, et pourquoi il y en a deux sortes

Quatre sont des **perimetres de lignes** — ils disent *quelles lignes* le porteur
voit, et sont poses **dans le `where` Prisma**, jamais dans un `if` apres lecture :

| Portee | Perimetre |
|---|---|
| `any` | Toutes les lignes. |
| `own` | Les lignes dont le porteur est proprietaire. |
| `assigned` | Les lignes qui lui sont assignees. |
| `client` | Les lignes de son dossier client. |

Deux sont des **portees de capacite** — elles ne filtrent aucune ligne, elles
designent une action qui n'a pas de sens en « lignes » : `team`
(`project:manage:team`, composer l'equipe) et `status`
(`project:manage:status`, faire avancer le statut). Un tableau a un seul element
comme `['status']` signifie « exige exactement celle-ci », pas « la plus large
disponible ».

Le filtre est dans le `where` et non apres lecture, et la difference n'est pas
stylistique : un `if (row.clientId !== me.clientId) throw` suppose que la ligne a
ete **lue**, donc chargee en memoire, donc presente dans le journal de requetes et
dans la reponse si le controle est oublie sur un seul chemin. Un `where` qui ne
correspond pas ne renvoie rien.

Consequence pour l'espace client : **remplacer un identifiant dans l'URL ne donne
jamais acces a un autre dossier**. Un client qui appelle `/clients/<autre-id>`
recoit un 404 — pas la donnee, et pas non plus un 403 qui confirmerait que le
dossier existe.

### Les espaces de travail (`X-Comexa-Space`)

L'interface d'equipe est decoupee en trois espaces : **Espace personnel**
(`personal`), **Espace equipe** (`team`) et **Comexa Space** (`comexa`). Le
frontend annonce l'espace actif dans l'en-tete `X-Comexa-Space` ; le serveur
recalcule alors les droits du porteur **pour cet espace**, avant
`PermissionsGuard` (`JwtAuthGuard.applySpace`, regles dans
`common/spaces/space-policy.ts`). Les routes et les services voient donc les
memes droits, et les `where` Prisma restent la seule source du perimetre.

Regle d'or : **un espace ne fait que retirer des droits**, jamais en ajouter.

| Espace | Droits effectifs |
|---|---|
| `personal` | les portees personnelles (`*:own`, `task:*:personal`, `task:read:assigned`, agenda propre, temps propre, notifications) ; `task:read:any` devient `task:read:assigned`, `time:read:any` devient `time:read:own`, etc. |
| `team` | les droits du role **moins** l'administration de l'organisation (`COMEXA_ONLY` : comptes, roles, audit, integrations, parametres, contenu du site, `telegram:link:any`) **moins** les taches personnelles et l'agenda prive (`task:*:personal`, `calendar:read:own`) |
| `comexa` | `COMEXA_ONLY` + les lectures utiles a l'administration (comptes, roles, parametres, contenu) |

Acces (`GET /me/spaces`) : ADMIN, COMMUNICATION_MANAGER et PROJECT_MANAGER
entrent dans les trois espaces ; DEVELOPER, DESIGNER et SALES dans
`personal` et `team` ; CLIENT dans aucun (il garde l'espace client, sans
en-tete).

| Cas | Reponse |
|---|---|
| En-tete absent, ou jeton d'integration | droits complets du role / du jeton (compatibilite : espace client, n8n, anciens clients) |
| Valeur inconnue | **400** `SPACE_INVALID` (jamais de repli silencieux sur tous les droits) |
| Espace non accessible au porteur | **403** `SPACE_FORBIDDEN` |
| Creation d'un evenement `PRIVATE` depuis l'espace equipe | **422** `CALENDAR_PRIVATE_IN_TEAM_SPACE` |

Routes dediees :

- `GET /me/spaces` (`@IgnoreSpace()`) : `{ spaces: [{ id, label, description, permissions }], defaultSpace }`
  — `permissions` = droits effectifs que l'API appliquera dans chaque espace ;
- `GET /notifications/summary` (`@IgnoreSpace()`) : `{ unread, unreadBySpace: { personal, team, comexa } }`
  pour les pastilles du selecteur d'espace.

Les notifications sont rattachees a un espace par leur type
(`NOTIFICATION_TYPES_BY_SPACE`) : `personal` = `TASK_ASSIGNED`,
`TASK_DUE_SOON` ; `comexa` = `SYSTEM` ; tout le reste (projets, commercial,
facturation, messages) = `team`. `GET /notifications` et ses compteurs filtrent
selon l'espace annonce : une cloche ne melange jamais deux espaces.

Aucune donnee n'a ete migree ni dupliquee : l'espace est une **vue** sur les
donnees existantes (une tache personnelle est une tache `isPersonal`, un
evenement prive un evenement `PRIVATE`, etc.).

### L'ordre des gardes

`ThrottlerGuard` → `JwtAuthGuard` → `PermissionsGuard`, tous globaux.

L'ordre est une partie de la securite. La limitation vient **en premier** : la
placer apres l'authentification ferait travailler argon2 et PostgreSQL pour
chaque tentative d'une attaque par force brute. Le compteur est justement ce qui
rend cette attaque assez couteuse pour qu'elle n'arrive pas jusqu'au hachage.

---

## 5. Validation — le corps est strict

`ValidationPipe` est configure avec `whitelist: true` et
**`forbidNonWhitelisted: true`**.

Consequence pratique : **un champ non declare dans le DTO fait echouer la requete
en 400**, il n'est pas ignore en silence. Envoyer `{ "name": "x", "truc": 1 }` a
une route qui n'attend que `name` donne `VALIDATION_FAILED`, pas un succes partiel.

C'est aussi le mecanisme qui empeche un client d'injecter `{ "roleId": "..." }`
ou `{ "clientId": "autre-client" }` dans un corps en esperant qu'un service
distrait le recopie. Le champ est refuse avant meme que le service ne le voie.

Pour le frontend : n'envoyez que les champs du DTO. Un `PATCH` qui renvoie l'objet
complet relu depuis le serveur, champs calcules (`id`, `createdAt`, `total`)
compris, sera refuse.

---

## 6. Limites de debit

Limite globale : **120 requetes par 60 secondes**, par client. Les en-tetes de
reponse donnent l'etat courant :

```
x-ratelimit-limit: 120
x-ratelimit-remaining: 119
x-ratelimit-reset: 60
```

Les routes sensibles (`/auth/login`, `/auth/forgot-password`) ont une limite
propre, plus stricte. Un depassement renvoie **429** avec `RATE_LIMITED`.

Les limites declarees par `@Throttle` sur les controleurs ne prennent effet que
parce que `ThrottlerGuard` est enregistre globalement. Sans cet enregistrement,
elles seraient decoratives — et une limite de dix tentatives de connexion par
minute qui n'existe pas est pire qu'aucune limite, parce qu'elle rassure.

### Ce que « par client » veut dire derriere un proxy

`ThrottlerGuard` compte par `request.ip` (son `getTracker` est
`normalizeIp(req.ip)`). Derriere un reverse proxy et sans reglage, `request.ip`
est **l'adresse du proxy** : tous les visiteurs partagent alors un seul compteur
de 120 requetes par minute, et le site finit par repondre 429 **a tout le monde**.
C'est le premier point a verifier devant des 429 qui n'ont aucun sens.

C'est le role de `TRUST_PROXY` (valeur par defaut `false`, declaree dans
`.env.example` et `config/env.validation.ts`) : **derriere un reverse proxy,
mettre `1`** — le nombre de sauts a traverser. `true` est deconseille :
l'application doit alors n'etre joignable *que* par le proxy, sinon un client
forge une adresse par requete et echappe entierement au limiteur.

La variable est une **chaine, pas un booleen**, et c'est volontaire :
`validateEnv` s'execute avec `enableImplicitConversion`, ou `'false'` devient
`true`. Un champ booleen inverserait donc le reglage le plus dangereux a
inverser. La traduction est faite une fois par `parseTrustProxy`, qui refuse de
demarrer sur une valeur qui n'en est pas une (`false`, `true`, un nombre de sauts,
ou une liste de `loopback` / `linklocal` / `uniquelocal` / adresses ou plages
CIDR).

Ce reglage gouverne aussi l'adresse **enregistree**. Quatre colonnes la portent —
la session (`sessions`), le journal d'audit (`audit_logs`), la signature d'un
devis (`quotes.acceptedByIp`) et la file des demandes de contact
(`contact_requests`) — et les quatre passent par un seul lecteur,
`common/http/client-ip.ts`, qui retire le prefixe `::ffff:` et borne l'adresse a
45 caracteres et l'agent a 512. Le fichier porte une mise en garde a ne pas
perdre : cette valeur est un **indice, pas une preuve**. Un en-tete HTTP se
falsifie ; elle sert a reconstituer une chronologie, jamais a autoriser quoi que
ce soit. Aucune decision d'acces ne la lit.

---

## 7. Documentation OpenAPI

| Chemin | Contenu |
|---|---|
| `/api/docs` | Interface Swagger. |
| `/api/docs-json` | Document OpenAPI brut (JSON). |
| `/api/docs-yaml` | Document OpenAPI brut (YAML). |

**Hors production, ces routes sont servies sans protection.** En production, elles
sont ABSENTES et repondent 404 : un plan detaille de l'API aiderait surtout
quelqu'un a la cartographier.

**Une exception, sur decision explicite : `DOCS_ENABLED=true`.** Les routes
existent alors, mais **derriere un mot de passe** (`DOCS_USER` / `DOCS_PASSWORD`),
et `assertDocsConfigured` refuse le demarrage si le drapeau est ouvert sans
identifiants ou avec un mot de passe de moins de 16 caracteres. La raison de cette
longueur : ces routes ne passent pas par le limiteur de debit global —
`SwaggerModule` les monte sur l'adaptateur HTTP, en dehors du routeur de Nest —
donc rien ne borne le nombre d'essais.

**Comment ce mot de passe se saisit, dans un navigateur.** `/api/docs` sert une
page de connexion HTML rendue par le serveur, sans JavaScript, dont le formulaire
poste sur `/api/docs-login` (le prefixe suit `API_PREFIX`). Rien a regler cote
navigateur : ni fenetre privee, ni vidage de cache, ni invite native a faire
revenir. La connexion pose un cookie de session signe de 7 jours, qui couvre les
trois routes ci-dessus.

Deux details surprennent a la lecture des journaux :

- une connexion refusee repond **200**, avec le message dans la page, et non 401.
  C'est voulu : un 401 accompagne de `WWW-Authenticate` ferait apparaitre l'invite
  native par-dessus le message d'erreur — soit exactement le probleme que cette
  page resout ;
- le cookie est pose sur `/api/docs`, `/api/docs-json` et `/api/docs-yaml`
  separement. Ces chemins sont des freres et non des enfants : un cookie pose sur
  `/api/docs` seul ne couvrirait pas les deux autres.

**Pour les clients qui ne sont pas des navigateurs**, l'authentification HTTP
Basic reste acceptee sur les trois routes, et le refus y repond bien 401 avec
`WWW-Authenticate` :

```sh
curl -u "$DOCS_USER:$DOCS_PASSWORD" https://api.exemple.tld/api/docs-yaml
```

Changer `DOCS_PASSWORD` invalide les sessions en cours : la cle qui signe les
cookies derive du mot de passe.

Ne construisez rien qui depende de ces routes a l'execution : elles peuvent etre
fermees d'un redemarrage a l'autre, selon une variable d'environnement.

### Le document est aussi committe, et c'est celui que lit le frontend

L'associe a besoin de ce document pour integrer l'API, et il ne peut pas
l'obtenir du service deploye : les deux routes ci-dessus y repondent 404. Le
document est donc **committe dans le depot**, a cote des types partages :

```
shared/api/openapi.json      112 chemins, 165 operations
```

Il se regenere depuis le code — ce qui lui garantit de ne jamais decrire une API
qui n'existe plus :

```bash
cd backend
npm run openapi:export
```

La commande compile `src/` et `scripts/export-openapi.ts` (voir
`tsconfig.export.json`, sortie `.export-build/`), demarre le vrai `AppModule`
pour obtenir le document de la MEME fonction `configureApp` que la production, et
l'ecrit a la racine du depot. Elle lit `backend/.env` — le demarrage ouvre une
connexion PostgreSQL, sans lire ni ecrire aucune donnee metier — et elle refuse
de tourner si `NODE_ENV` vaut `production`, cas ou `configureApp` ne construit
aucun document.

Corriger le fichier a la main ne sert a rien : `test/docs.e2e-spec.ts` le compare
a la sortie fraiche et echoue au premier ecart, en nommant les operations **et
les schemas** concernes. Un DTO modifie sans relancer l'export fait donc tomber
la suite e2e.

L'egalite entre ce fichier et ce que sert le serveur de developpement tient a un
detail de compilation : **le plugin Swagger de `nest-cli.json`**. Il n'est
applique que par `nest build`, jamais par `tsc`. Ce plugin lit les decorateurs
class-validator et recopie leurs bornes dans le schema (`@MaxLength` ->
`maxLength`, `@Min` -> `minimum`, `@IsEmail` -> `format: email`), en plus de
resoudre le type reel des champs optionnels. Les deux commandes qui produisent ou
verifient ce document (`openapi:export` et `build:e2e`) passent donc par
`nest build` — sinon le document committe serait plus pauvre que celui de
`/api/docs` : c'etait le cas, 463 feuilles en moins, 46 valeurs fausses et 67
operations sur 165 concernees. Le detail de cette mesure est dans
`docs/TESTING.md`. En local, `npm run start:dev` sert donc **ce meme** document
sur `/api/docs`, avec l'interface Swagger pour l'explorer.

### Authentification : une exigence globale, et des exceptions declarees

Le schema Bearer est declare sous le nom `access-token`, et `persistAuthorization`
est actif : le jeton saisi dans l'interface survit au rechargement de la page.

Ce jeton est exige **globalement**, au niveau racine du document (`security`), et
non operation par operation. Ce n'est pas un raccourci : `JwtAuthGuard` est
enregistre en `APP_GUARD`, donc l'API **refuse par defaut** — toute route exige un
jeton sauf mention contraire. Une exigence globale decrit exactement cela, et elle
resiste a l'ajout d'une route : celle-ci est protegee sans que personne ait a y
penser, et elle est documentee comme telle.

L'effet secondaire est ce qui rend l'affichage juste. Une route reellement ouverte
declare l'inverse, `security: []` — « aucune exigence », ce qui n'est pas la meme
chose que « non declaree », qui herite du global. Ces routes n'affichent donc
aucun cadenas, et Swagger UI n'y attache pas d'en-tete `Authorization`.

C'est `@Public()` qui pose les deux : la metadonnee que lit le garde, et le
`security: []`. Les fusionner fait qu'une route ne peut pas devenir publique sans
que sa documentation suive. Les routes concernees sont celles qui portent
`@Public()` — la sante (§8), les cinq routes d'authentification (connexion,
rafraichissement, deconnexion, mot de passe oublie, reinitialisation ; §2) et les
onze routes de contenu public. L'inventaire complet est en §10, ou ces routes se
reconnaissent a leur colonne **Permission** valant `publique`. Les trois sources
doivent concorder : l'inventaire, les `@Public()` du code, et le document genere.

Deux tests tiennent cet accord entre le code et le document :
`src/common/decorators/public.decorator.spec.ts` verifie la mecanique du
decorateur, et `test/docs.e2e-spec.ts` verifie le document que `configureApp`
produit reellement — il compare notamment le nombre de routes publiques
documentees au nombre de `@Public()` ecrits dans les sources, et l'egalite entre
le document genere et `shared/api/openapi.json`.

---

## 8. Sante

`GET /api/health` est **publique** (aucun jeton) et ne figure pas dans le journal
des requetes, parce que l'hebergeur l'appelle en boucle :

```json
{
  "success": true,
  "data": { "status": "ok", "database": "up", "uptimeSeconds": 3, "timestamp": "2026-09-29T01:06:10.324Z" }
}
```

`database` reflete un vrai aller-retour vers PostgreSQL, pas la simple presence
d'une variable de configuration.

---

## 9. Ecarts connus et limites assumes

Cette section existe pour que personne ne decouvre ces points en production. Ils
sont documentes, pas caches.

### Permissions absentes du catalogue

Dix lignes ci-dessous, dont **neuf besoins reellement absents du catalogue** — la
dixieme (`setting:write:any`) existe, mais n'est accordee a aucun role nomme.
Chaque cas est traite en toute securite par le code le plus proche, et **aucun
n'elargit un droit**. Un seul, cependant, s'est revele **nuisible** :
`quote:accept:any`, dont l'absence a refuse un droit legitime (detail ci-dessous).

| Besoin | Traitement actuel |
|---|---|
| `quote:accept:any` | **Cet ecart a produit un 403 reel** — voir « L'absence de `quote:accept:any` a refuse un administrateur ». Traitement : repli sur `quote:write:any`, rendu atteignable dans `billing-access.ts`. La branche `SCOPE_ANY` reste ecrite ; ajouter le code au catalogue la fera fonctionner sans autre changement, **a condition de re-semer** — la ligne ADMIN en base est une copie du catalogue, pas une reference. |
| `conversation:manage:own` | Code declare le plus proche. |
| `prospect:status:*` | Reemploi de `prospect:write:*`. |
| `contact:read:own` / `contact:write:own` | `client:read:own` plus une restriction au niveau du service. |
| `contact:delete:any` | Reemploi de `contact:write:any`. |
| `client:write:own` | Absent par conception : un client ne modifie pas son propre dossier. |
| `report:generate:own` | Absent. Un DEVELOPER/DESIGNER detient `report:read:own` mais pas `report:generate:any` (porte par PROJECT_MANAGER seul) : il ne peut donc pas produire son propre rapport. Verifie : le code n'existe nulle part dans le catalogue. |
| `setting:write:any` | Declare (ligne 174) mais accorde a AUCUN role nomme : seul ADMIN le detient, par `'ALL'`. Un COMMUNICATION_MANAGER lit les parametres sans pouvoir les modifier — probablement voulu, mais c'est implicite. |
| `invoice:cancel:any` | Absent. L'annulation d'une facture passe par `invoice:write:any` — que **seul ADMIN** detient, par `'ALL'` : mesure sur `permissions.catalogue.ts`, **aucun role nomme** ne porte ce code, SALES compris. La version precedente de ce document ecrivait « detenu par ADMIN et SALES » ; c'etait faux. L'ecart reste **de nom seulement** (le geste est possible), mais il n'est ouvert qu'a ADMIN, et rien ne distingue « modifier une facture » de « l'annuler ». |
| `payment:write:own` | Absent — et c'est **volontaire**. Un porteur de l'espace client detient `payment:read:own` : il voit ses encaissements, il ne les declare pas. C'est l'agence qui enregistre un paiement (`payment:write:any`). A rouvrir seulement si le client doit un jour declarer un virement lui-meme. |

Ces codes n'ont pas ete ajoutes a la hate : le faire modifierait les attributions
de roles et destabiliserait une suite de tests verte. La bonne prochaine etape est
de les ajouter au catalogue **avec** les tests qui vont avec.

### `composeAnd` vit dans `prospects/prospect-scope.ts`

et est importe par `clients/client-scope.ts`. Sa place finale est
`common/dto/where.dto.ts` ; le deplacement a ete differe pour ne pas modifier un
fichier partage en cours d'ecriture.

### `Session` vit dans `auth.controller.ts`

et est importe par **deux** autres modules (`roles/role.controller.ts`,
`users/user.controller.ts`). C'est un couplage cosmetique, sans effet a
l'execution. Ce document annoncait « trois autres modules » : mesure faite, ils
sont deux.

`SessionMeta`, lui, **a demenage** : le type vit desormais dans `auth/session.ts`,
avec `UNKNOWN_SESSION`, et c'est `auth.service.ts` qui l'importe. Ce document le
situait dans `auth.controller.ts` — c'etait vrai, ce ne l'est plus.

### Deux colonnes manquantes, contournees par convention

`Report` n'a pas de colonne de resultat. L'instantane d'un rapport est donc range
dans `params` sous un schema **nomme et versionne** (`comexa.report.v1`), et sa
relecture rend `null` sur une forme inconnue plutot que des zeros — un rapport
illisible ne doit pas se presenter comme un rapport a zero. La forme propre serait
une colonne `result Json?` dediee : `params` est ici detourne de son sens.

`Setting` n'a pas de marqueur de visibilite. La qualite « interne » d'un parametre
est donc deduite de son **nom** (`internal.`, `private.`, segments `token`,
`secret`, `password`...). La regle est ecrite pour se tromper **dans le sens de
cacher** : un parametre interne mal nomme est masque a tort, jamais expose a tort.
La forme propre serait une colonne `internal Boolean @default(false)`.

### Le demarrage doit se faire depuis le build compile

Lancer l'application avec `tsx` (ou tout outil s'appuyant sur esbuild) **echoue a
l'injection de dependances** : esbuild n'emet pas la metadonnee
`design:paramtypes` malgre `emitDecoratorMetadata: true`, et Nest ne sait alors
plus quoi injecter. Le symptome est
`Nest can't resolve dependencies of the JwtAuthGuard (?, Symbol(...))`.

C'est pourquoi `test:e2e` compile d'abord (`npm run build:e2e`) et pourquoi la
production demarre par `node dist/main.js`. `npm test` sous `tsx` reste valide : la
suite unite ne teste que des fonctions pures, sans conteneur d'injection.

### Image Docker non verifiee

Le `Dockerfile` et `docker-compose.yml` sont ecrits mais n'ont **jamais** ete
construits ni demarres : aucun CLI Docker n'est disponible sur la machine de
developpement. A verifier avant tout deploiement conteneurise.

### `npm audit` signale 4 vulnerabilites hautes

via `@prisma/config` (`deepmerge-ts`) et `mysql2`. Le correctif propose par
`--force` installerait `prisma@6.19.3` et doit **ne pas** etre applique : il
casserait la version du client. Detail dans `docs/security-audit.md`.

### La chaine de connexion

L'application refuse de demarrer si la configuration est incomplete
(`config/env.validation.ts`). Le fichier `.env` porte la chaine de connexion
Neon et **n'est jamais committe** — `.gitignore` couvre `.env`, `.env.*` et
`*.env`, tout en laissant `.env.example` versionne.

### L'absence de `quote:accept:any` a refuse un administrateur

Mesure, sur la base reelle, jeton d'un compte **ADMIN** :

| Appel | Resultat |
|---|---|
| `POST /api/quotes/:id/send` | **201** |
| `POST /api/quotes/:id/accept` | **403** `« Aucun dossier client est rattache a ce compte. »` |

Le meme jeton, deux appels consecutifs de la meme famille, l'un accepte et
l'autre refuse. La cause n'est pas un droit manquant mais un droit **en trop** :

1. Les permissions d'ADMIN sont la copie du catalogue (`ROLE_PERMISSIONS.ADMIN`
   vaut `'ALL'`, et le seed developpe la liste en base). ADMIN detient donc
   **toutes** les permissions, y compris `quote:accept:own` — un code qui
   n'existe que pour l'espace client.
2. Le catalogue ne contient **aucun** `quote:accept:any`. Dans
   `acceptancePerimeter` (`invoices/billing-access.ts`), l'appel
   `widestScope('quote', 'accept', [ANY, OWN])` ne peut donc jamais remonter
   jusqu'a `ANY` : il s'arrete sur `OWN`.
3. La branche `OWN` lit `policy.clientId`. Un compte interne n'a pas de dossier
   client : la valeur est nulle, et la fonction leve.

**L'inversion est le vrai enseignement** : plus un porteur detient de
permissions, plus il a de chances d'entrer dans la branche cliente. SALES et
PROJECT_MANAGER n'etaient pas touches — non parce qu'ils sont mieux traites,
mais parce qu'ils ne detiennent pas `quote:accept:own` et retombaient donc sur
le repli `quote:write:any`. Le defaut frappait exactement le compte le plus
privilegie. Consequence mesuree : les 16 tests de bout en bout de la facturation
ont ete annules d'un seul coup, par un `before` qui echouait.

Le repli interne est desormais atteignable avant que la branche cliente ne
conclue. Aucun acces n'est elargi : `quote:write:any` n'est accorde qu'a SALES,
PROJECT_MANAGER et ADMIN, jamais a CLIENT.

**Ajouter le code au catalogue ne suffirait pas** : la ligne ADMIN en base est
une copie du catalogue, materialisee au moment du seed. Un code ajoute au
catalogue n'est detenu par ADMIN qu'apres un nouveau `db:seed`.

### Le pipeline commercial : transitions et champ `allowed`

La table des transitions est `LEAD_TRANSITIONS` dans
`src/modules/prospects/lead-pipeline.ts`. C'est **la** source de verite ; le
frontend ne doit pas la redériver, deux tables divergeraient au premier ajout.

Une transition non declaree renvoie **422** `LEAD_STATUS_TRANSITION_INVALID`,
et le detail porte les sorties reellement autorisees :

```json
{ "from": "NEW", "to": "PROPOSAL_SENT",
  "allowed": ["CONTACTED", "QUALIFIED", "LOST"] }
```

Lire `allowed`, jamais `error.message` : c'est ce qui permet a un ecran d'etat
de proposer les seules etapes valides sans connaitre la regle.

Un point qui surprend a la lecture : **`NEW -> QUALIFIED` est autorise**. La
regle de la table n'est pas « on ne peut pas qualifier directement », c'est
**« on ne saute pas la qualification »** — `NEW -> WON` et
`NEW -> PROPOSAL_SENT` sont refuses. Le statut n'etant ni un champ de creation
ni un champ de modification (`CreateProspectDto`), un prospect nait toujours
`NEW` ; `NEW -> QUALIFIED` est donc la seule facon d'enregistrer une piste
entrante dont le besoin est deja cadre, la prise de contact ayant eu lieu
**avant** la fiche (formulaire, puis appel). Exiger un passage par `CONTACTED`
obligerait le commercial a ecrire une ligne d'historique qui n'a pas eu lieu,
alors que l'historique est la preuve du parcours.

### `import type` sur un DTO de controleur : la requete entiere perd sa validation

**Un seul mot de trop, et tout le filtrage d'une famille de routes disparait.**

`tsconfig.json` active `emitDecoratorMetadata`, et c'est ainsi que Nest sait
quelle classe valider : TypeScript ecrit la classe de chaque parametre decore
dans `design:paramtypes`. Or un `import type` est **efface du JavaScript emis**,
et le compilateur ne peut alors plus nommer la classe — il ecrit `Function`.

`ValidationPipe.toValidate()` n'exclut que
`[String, Boolean, Number, Array, Object, Buffer, Date]`. `Function` n'y figure
pas : la validation s'execute donc, sur une classe qui ne declare **aucune**
propriete blanchissable. Avec `forbidNonWhitelisted`, chaque parametre envoye
est alors « non declare ».

Le cas reel, sur `GET /api/invoices` (compte ADMIN, base Neon) :

| Requete | Avant | Apres |
|---|---|---|
| `?clientId=<id>` | **400** `VALIDATION_FAILED` — `["property clientId should not exist"]` | 200, filtre applique |
| `?status=SENT` | **400**, meme message avec `status` | 200, filtre applique |
| `?page=2` | **400**, meme message avec `page` | 200, page 2 rendue |

Le DTO, lui, etait **correct** : `clientId` y etait bien declare avec ses
validateurs. Le message d'erreur designait donc un innocent — c'est ce qui rend
ce defaut couteux a diagnostiquer. Ce n'est pas `clientId` qui etait fautif :
c'est le seul parametre que les tests envoyaient. `?projectId=`, `?quoteId=`,
`?search=` et `?page=` recevaient exactement le meme 400.

**La regle qui en decoule, et qui vaut pour tout DTO de controleur :**
`import type` se reserve aux types qui ne franchissent aucune frontiere
d'execution — interfaces, modeles Prisma, types de retour, DTO **de service**.
Des qu'un DTO apparait dans une signature decoree (`@Body()`, `@Query()`,
`@Param()`), l'import doit etre un **import de valeur**. Le fichier
`src/modules/invoices/invoices.controller.ts` porte le commentaire complet.

Un DTO de service, a l'inverse, ne craint rien : un service n'a pas de
metadonnee de parametre, et `import type` y reste le bon choix. C'est pourquoi
d'autres `import type` de DTO subsistent dans `src/` — `documents.service.ts`,
`payments.service.ts`, `settings.service.ts`, `message.service.ts`,
`notification-inbox.service.ts`, `dashboard.service.ts`, `role.service.ts`,
`audit-log.service.ts` — sans aucun effet a l'execution : aucun n'apparait dans
une signature decoree.

### Ce que la reponse d'erreur ne contient jamais

- **Aucune trace de pile.** `AllExceptionsFilter` ecrit `exception.stack` dans
  le journal, et rien d'autre : la reponse ne porte que
  `{ code, message, details }`.
- **Le code, pas le message.** `error.code` est stable (`VALIDATION_FAILED`,
  `INVOICE_NOT_FOUND`, ...) ; `error.message` est redige en francais et peut
  changer sans preavis. C'est `code` que le frontend teste.
- **Un rejet de validation nomme la propriete, pas la donnee.** `details` est la
  liste des messages de `class-validator` ; chaque message designe la propriete
  fautive, ce qui suffit a corriger l'appel sans journaliser la valeur envoyee.
- **En production, `details` est reduit.** Les precisions issues de Prisma
  (`fields` sur une violation d'unicite, `prismaCode`) valent `null` hors
  developpement : le detail ne sort que sur la machine de developpement.

### Le compte administrateur neuf ne peut RIEN faire avant d'avoir change son mot de passe

C'est le point qui a rendu le service deploye inutilisable, et l'endroit ou il
aurait du etre ecrit ne le portait pas.

`upsertAccount` (`prisma/seed.ts`) cree le compte administrateur avec
`mustChangePassword: true`, et le commentaire donne la raison : le mot de passe
est connu de qui a lance le seed, il doit donc etre change a la premiere
connexion. La decision est bonne.

`docs/DEPLOYMENT.md` §13 decrit l'etape pour la **voie VM**, et la decrit bien —
l'avertissement « tant que ce n'est pas fait, tout repond `403
PASSWORD_CHANGE_REQUIRED` » y figure mot pour mot. Mais l'**annexe A**, qui
decrit la voie **Render**, n'en dit pas un mot : elle couvre les migrations (A.5)
et la verification (A.7) sans jamais parler du compte administrateur. Or c'est
cette voie-la qui est deployee. La lacune n'est donc pas dans le fond, elle est
dans l'annexe, et elle suffit a bloquer. Le garde
(`common/guards/access.guards.ts`) ferme **tout** pour un porteur dont le drapeau
est pose, sauf les trois routes marquees `@AllowPasswordChangeRequired()`. Donc :

| Appel, avec le jeton d'un administrateur neuf | Resultat |
|---|---|
| `POST /api/auth/login` | **200** — le jeton est bel et bien delivre |
| `GET /api/auth/me` | 200 — c'est ce qui permet d'afficher l'ecran de changement |
| `POST /api/auth/change-password` | 200 |
| `POST /api/auth/logout-all` | 200 — fermer toutes ses sessions reste possible |
| **Toute autre route, y compris `GET /api/users`** | **403 `PASSWORD_CHANGE_REQUIRED`** |

La connexion reussit, puis la premiere route metier echoue. Un deploiement neuf
est donc inutilisable en l'etat, et le seul symptome est un 403 sur la premiere
requete venue — mesure sur `https://comexa-portfolio.onrender.com`, sur
`GET /api/contact-requests`.

**La mise en service est une etape de deploiement, pas un detail.** Elle tient en
un appel, avec le mot de passe du seed :

```
POST /api/auth/change-password
{ "currentPassword": "<SEED_ADMIN_PASSWORD>", "newPassword": "<le mot de passe voulu>", "confirmPassword": "<le meme>" }
```

Le drapeau retombe et **ne se repose jamais** : `changePassword` ecrit
`mustChangePassword: false`, et rien d'autre dans le code ne le remet a `true`
pour un compte existant — le seed ne retouche pas le mot de passe d'un compte
deja present. Un deploiement n'a donc besoin de cette etape **qu'une seule fois**.

`npm run smoke:prod` la detecte et l'effectue, puis REMET le mot de passe a sa
valeur de `backend/.env` : le compte se retrouve avec le mot de passe que
l'operateur connait deja, et le drapeau tombe. Le retour en arriere est possible
parce que `changePassword` n'interdit que « identique a l'actuel » — il n'existe
aucun historique de mots de passe. La manœuvre est idempotente : sur un compte
deja en service, le script ne touche a rien.

### `GET /documents/:id/content` ne sert pas de flux en production

Le tableau de la section 10 annonce `200` pour cette route. En production, avec
`STORAGE_DRIVER=s3`, elle repond **422 `STORAGE_STREAM_UNSUPPORTED`**. Ce n'est
pas une panne : c'est le partage des roles entre deux routes, et il est voulu.

`StorageDriver` et `StreamingStorageDriver` sont deux interfaces **separees**
(`common/storage/storage.types.ts`), et le commentaire dit pourquoi :
« un stockage objet n'a aucune raison d'exposer une lecture qui ferait transiter
les octets par l'API — le tout interet de l'URL signee est justement de
l'eviter. Seul le pilote local en a besoin. »

| Route | Ce qu'elle fait | Ou elle sert |
|---|---|---|
| `GET /documents/:id/download` | Rend une **URL signee** vers le stockage | **Production** — le fichier ne traverse jamais l'API |
| `GET /documents/:id/content` | Sert le **flux** des octets | **Developpement** — le pilote local ne signe rien |

**Consequence pour le frontend, et c'est la seule chose a retenir : utiliser
`/download`.** Un appel a `/content` en production rend un 422, et le message
renvoie explicitement vers `/download`. Le refus est nomme et non un 500 : c'est
un contrat, pas un incident.

Mesure faite en suivant reellement le lien signe jusqu'a
`s3.us-east-005.backblazeb2.com` : le contenu est identique **octet pour octet**
a celui qui a ete depose. Le stockage objet repond donc bien depuis le reseau de
Render.

### Une facture encaissee ne peut PAS etre corrigee par un avoir

`InvoiceType.CREDIT_NOTE` **est declare** dans le schema Prisma, et **aucun chemin
de code n'en ecrit** : le type n'apparait que dans deux commentaires
(`invoices/invoice-state.ts` et `invoices/invoices.service.ts`). L'API ne sait donc
pas emettre d'avoir.

Ce n'est pas un detail theorique, c'est une limite a connaitre avant de la
decouvrir en clientele. Une facture **deja remise au client** dont le montant doit
changer n'a aujourd'hui **aucune correction disponible par l'API**.

Ce qu'elle sait faire, en revanche — et c'est ce que le message d'erreur nomme
desormais :

| Situation | Ce qui est possible |
|---|---|
| Facture `PAID` ou `PARTIALLY_PAID`, encaissement saisi par erreur | `DELETE /api/payments/:id` sur **tous** les encaissements, **puis** `POST /api/invoices/:id/cancel`. `remove()` fait une suppression logique et appelle `recomputePaymentState()` : solde retombe a zero, la facture revient en `SENT`, le seul etat annulable parmi ceux-la — `canCancelInvoice` n'accepte que `DRAFT`, `SENT` et `OVERDUE`. **Il faut donc les retirer tous** : tant qu'un encaissement reste, la facture est `PARTIALLY_PAID` et l'annulation echoue de nouveau, avec le meme code. |
| Facture deja remise au client, montant a corriger | **Rien.** C'est le trou decrit ci-dessus. |
| Facture `CANCELLED` | Rien a faire, elle l'est deja. Le message le dit maintenant, au lieu de parler d'encaissement sur une piece annulee. |

L'annulation d'un encaissement exige `payment:write:any`, que detiennent ADMIN
(par `'ALL'`) **et le role SALES**, par declaration explicite dans le catalogue
(`permissions.catalogue.ts`, `[RoleCode.SALES]`). La seconde etape, elle, exige
`invoice:write:any` : **aucun role nomme** ne le porte (meme constat que pour
`invoice:cancel:any` ci-dessus), donc un SALES peut defaire un paiement mais pas
annuler la facture qui suit — la sequence complete reste ADMIN. Un porteur de
l'espace client, lui, ne detient que `payment:read:own` : il ne peut pas defaire un
paiement, pas meme le sien.

Ce document disait l'inverse jusqu'ici : le message d'erreur promettait « une
facture encaissee se corrige par un avoir ». C'etait un remede imaginaire, et un
remede imaginaire est pire qu'une absence de remede — il fait perdre du temps a
qui le suit.

---

## 10. Inventaire des routes

Les **165 routes** que l'application enregistre, relevees une par une dans les
`src/**/*.controller.ts` (28 controleurs). C'est la piece a opposer au reste de ce
document : une route absente d'ici n'existe pas, et une route presente existe.

Trois colonnes, trois lectures :

- **Route** : chemin relatif au prefixe global, comme partout dans ce document.
  Un `@Get()` sans argument sous un prefixe donne le prefixe seul (`GET /clients`) :
  Nest retire la barre oblique finale. Les 165 entrees sont listees par fichier, et
  le fichier est le controleur — donc la route y est, et c'est la source.
- **Permission** : `publique` (aucun jeton n'est exige), `jeton seul` (route
  d'authentification : le jeton suffit, aucune permission n'est lue), sinon les
  codes exiges. **`ou` separe des codes dont UN SEUL suffit**
  (`@RequireAnyPermission`) ; une **virgule** separe des codes dont **tous** sont
  exiges (`@RequirePermissions`). `ADMIN` detenant `'ALL'`, il n'est jamais
  repete ligne par ligne.
- **Succes** : le statut rendu en cas de succes. Il vaut le defaut de Nest pour le
  verbe (`POST` 201, les autres 200) **sauf** quand le controleur pose
  `@HttpCode(...)` — et ces exceptions sont nombreuses sur les `POST` d'action
  (`/auth/*`, `/prospects/:id/convert`, `/users/:id/suspend`, ...), qui rendent
  **200** parce qu'ils ne creent pas la ressource du chemin. La colonne est
  mesuree, pas deduite du verbe : un test qui attend 201 sur un `POST` d'action
  echouera.

#### `health/health.controller.ts`

| Route | Permission | Succes |
|---|---|---|
| `GET /health` | publique | 200 |

#### `audit/audit-log.controller.ts`

| Route | Permission | Succes |
|---|---|---|
| `GET /audit-logs` | `audit:read:any` | 200 |

#### `auth/auth.controller.ts`

| Route | Permission | Succes |
|---|---|---|
| `POST /auth/login` | publique | 200 |
| `POST /auth/refresh` | publique | 200 |
| `POST /auth/logout` | publique | 200 |
| `POST /auth/logout-all` | jeton seul | 200 |
| `POST /auth/forgot-password` | publique | 200 |
| `POST /auth/reset-password` | publique | 200 |
| `POST /auth/change-password` | jeton seul | 200 |
| `GET /auth/me` | jeton seul | 200 |
| `GET /auth/sessions` | jeton seul | 200 |
| `DELETE /auth/sessions/:id` | jeton seul | 200 |

#### `clients/clients.controller.ts`

| Route | Permission | Succes |
|---|---|---|
| `GET /clients` | `client:read:any` | 200 |
| `POST /clients` | `client:write:any` | 201 |
| `GET /clients/:id` | `client:read:any` **ou** `client:read:own` | 200 |
| `PATCH /clients/:id` | `client:write:any` | 200 |
| `GET /clients/:id/contacts` | `contact:read:any` **ou** `client:read:own` | 200 |
| `POST /clients/:id/contacts` | `contact:write:any` | 201 |

#### `clients/contacts.controller.ts`

| Route | Permission | Succes |
|---|---|---|
| `PATCH /contacts/:id` | `contact:write:any` | 200 |
| `DELETE /contacts/:id` | `contact:write:any` | 200 |

#### `content/contact-request.controller.ts`

| Route | Permission | Succes |
|---|---|---|
| `GET /contact-requests` | `contactrequest:read:any` | 200 |
| `GET /contact-requests/:id` | `contactrequest:read:any` | 200 |
| `PATCH /contact-requests/:id` | `contactrequest:write:any` | 200 |
| `DELETE /contact-requests/:id` | `contactrequest:write:any` | 200 |

#### `content/content-admin.controller.ts`

| Route | Permission | Succes |
|---|---|---|
| `GET /content/services` | `service:read:any` | 200 |
| `POST /content/services` | `service:write:any` | 201 |
| `PATCH /content/services/:id` | `service:write:any` | 200 |
| `DELETE /content/services/:id` | `service:write:any` | 200 |
| `GET /content/packages` | `package:read:any` | 200 |
| `POST /content/packages` | `package:write:any` | 201 |
| `PATCH /content/packages/:id` | `package:write:any` | 200 |
| `DELETE /content/packages/:id` | `package:write:any` | 200 |
| `GET /content/case-study-categories` | `casestudy:read:any` | 200 |
| `POST /content/case-study-categories` | `casestudy:write:any` | 201 |
| `PATCH /content/case-study-categories/:id` | `casestudy:write:any` | 200 |
| `DELETE /content/case-study-categories/:id` | `casestudy:write:any` | 200 |
| `GET /content/case-studies` | `casestudy:read:any` | 200 |
| `POST /content/case-studies` | `casestudy:write:any` | 201 |
| `PATCH /content/case-studies/:id` | `casestudy:write:any` | 200 |
| `DELETE /content/case-studies/:id` | `casestudy:write:any` | 200 |
| `GET /content/testimonials` | `testimonial:read:any` | 200 |
| `POST /content/testimonials` | `testimonial:write:any` | 201 |
| `PATCH /content/testimonials/:id` | `testimonial:write:any` | 200 |
| `PATCH /content/testimonials/:id/publication` | `testimonial:moderate:any` | 200 |
| `DELETE /content/testimonials/:id` | `testimonial:write:any` | 200 |
| `GET /content/partners` | `partner:read:any` | 200 |
| `POST /content/partners` | `partner:write:any` | 201 |
| `PATCH /content/partners/:id` | `partner:write:any` | 200 |
| `DELETE /content/partners/:id` | `partner:write:any` | 200 |
| `GET /content/faqs` | `faq:read:any` | 200 |
| `POST /content/faqs` | `faq:write:any` | 201 |
| `PATCH /content/faqs/:id` | `faq:write:any` | 200 |
| `DELETE /content/faqs/:id` | `faq:write:any` | 200 |

#### `content/content-public.controller.ts`

| Route | Permission | Succes |
|---|---|---|
| `GET /public/services` | publique | 200 |
| `GET /public/services/:slug` | publique | 200 |
| `GET /public/packages` | publique | 200 |
| `GET /public/packages/:slug` | publique | 200 |
| `GET /public/case-study-categories` | publique | 200 |
| `GET /public/case-studies` | publique | 200 |
| `GET /public/case-studies/:slug` | publique | 200 |
| `GET /public/testimonials` | publique | 200 |
| `GET /public/partners` | publique | 200 |
| `GET /public/faqs` | publique | 200 |
| `POST /public/contact-requests` | publique | 201 |

#### `content/modification-request.controller.ts`

| Route | Permission | Succes |
|---|---|---|
| `GET /modification-requests` | `modificationrequest:read:any` **ou** `modificationrequest:read:own` | 200 |
| `GET /modification-requests/:id` | `modificationrequest:read:any` **ou** `modificationrequest:read:own` | 200 |
| `POST /modification-requests` | `modificationrequest:write:own` | 201 |
| `PATCH /modification-requests/:id` | `modificationrequest:decide:any` | 200 |

#### `dashboard/dashboard.controller.ts`

| Route | Permission | Succes |
|---|---|---|
| `GET /dashboard` | `dashboard:read:any` | 200 |
| `GET /dashboard/me` | `dashboard:read:any` **ou** `dashboard:read:own` | 200 |
| `GET /dashboard/client` | `dashboard:read:own` | 200 |

#### `documents/documents.controller.ts`

| Route | Permission | Succes |
|---|---|---|
| `POST /documents` | `document:write:any` **ou** `document:write:own` | 201 |
| `GET /documents` | `document:read:any` **ou** `document:read:own` **ou** `document:read:client` | 200 |
| `GET /documents/:id` | `document:read:any` **ou** `document:read:own` **ou** `document:read:client` | 200 |
| `PATCH /documents/:id` | `document:write:any` **ou** `document:write:own` | 200 |
| `DELETE /documents/:id` | `document:delete:any` | 200 |
| `GET /documents/:id/download` | `document:read:any` **ou** `document:read:own` **ou** `document:read:client` | 200 |
| `GET /documents/:id/content` | `document:read:any` **ou** `document:read:own` **ou** `document:read:client` | 200 **ou** 422 — voir §9 |

#### `invoices/invoices.controller.ts`

| Route | Permission | Succes |
|---|---|---|
| `GET /invoices` | `invoice:read:any` **ou** `invoice:read:own` | 200 |
| `GET /invoices/:id` | `invoice:read:any` **ou** `invoice:read:own` | 200 |
| `POST /invoices/:id/send` | `invoice:send:any` | 201 |
| `POST /invoices/:id/cancel` | `invoice:write:any` | 201 |
| `DELETE /invoices/:id` | `invoice:delete:any` | 200 |

#### `invoices/quote-invoice.controller.ts`

| Route | Permission | Succes |
|---|---|---|
| `POST /quotes/:id/invoice` | `invoice:write:any` | 201 |

#### `messaging/messaging.controller.ts`

| Route | Permission | Succes |
|---|---|---|
| `GET /conversations` | `conversation:read:own` | 200 |
| `POST /conversations` | `conversation:create:own` | 201 |
| `GET /conversations/:id` | `conversation:read:own` | 200 |
| `PATCH /conversations/:id` | `conversation:manage:any` | 200 |
| `POST /conversations/:id/participants` | `conversation:manage:any` | 201 |
| `DELETE /conversations/:id/participants/:userId` | `conversation:manage:any` | 200 |
| `GET /conversations/:id/messages` | `message:read:own` | 200 |
| `POST /conversations/:id/messages` | `message:write:own` | 201 |
| `POST /conversations/:id/read` | `message:read:own` | 200 |

#### `milestones/milestones.controller.ts`

| Route | Permission | Succes |
|---|---|---|
| `GET /projects/:projectId/milestones` | `milestone:read:any` | 200 |
| `POST /projects/:projectId/milestones` | `milestone:write:any` | 201 |
| `PATCH /milestones/:id` | `milestone:write:any` | 200 |
| `DELETE /milestones/:id` | `milestone:write:any` | 200 |

#### `notifications/notification.controller.ts`

| Route | Permission | Succes |
|---|---|---|
| `GET /notifications` | `notification:read:own` | 200 |
| `POST /notifications/read-all` | `notification:read:own` | 200 |
| `POST /notifications/:id/read` | `notification:read:own` | 200 |
| `DELETE /notifications/:id` | `notification:manage:own` | 200 |

#### `payments/invoice-payments.controller.ts`

| Route | Permission | Succes |
|---|---|---|
| `POST /invoices/:id/payments` | `payment:write:any` | 201 |
| `GET /invoices/:id/payments` | `payment:read:any` **ou** `payment:read:own` | 200 |

#### `payments/payments.controller.ts`

| Route | Permission | Succes |
|---|---|---|
| `GET /payments` | `payment:read:any` **ou** `payment:read:own` | 200 |
| `GET /payments/:id` | `payment:read:any` **ou** `payment:read:own` | 200 |
| `DELETE /payments/:id` | `payment:write:any` | 200 |

#### `projects/projects.controller.ts`

| Route | Permission | Succes |
|---|---|---|
| `GET /projects` | `project:read:any` **ou** `project:read:assigned` **ou** `project:read:own` | 200 |
| `POST /projects` | `project:write:any` | 201 |
| `GET /projects/:id` | `project:read:any` **ou** `project:read:assigned` **ou** `project:read:own` | 200 |
| `PATCH /projects/:id` | `project:write:any` | 200 |
| `PATCH /projects/:id/status` | `project:manage:status` | 200 |
| `DELETE /projects/:id` | `project:delete:any` | 200 |
| `GET /projects/:id/members` | `project:read:any` **ou** `project:read:assigned` | 200 |
| `POST /projects/:id/members` | `project:manage:team` | 201 |
| `DELETE /projects/:id/members/:userId` | `project:manage:team` | 200 |
| `GET /projects/:id/activities` | `activity:read:any` **ou** `activity:read:own` | 200 |

#### `prospects/contact-request-conversion.controller.ts`

| Route | Permission | Succes |
|---|---|---|
| `POST /contact-requests/:id/convert` | `contactrequest:convert:any` | 200 |

#### `prospects/prospects.controller.ts`

| Route | Permission | Succes |
|---|---|---|
| `GET /prospects` | `prospect:read:any` **ou** `prospect:read:own` | 200 |
| `POST /prospects` | `prospect:write:any` **ou** `prospect:write:own` | 201 |
| `GET /prospects/:id` | `prospect:read:any` **ou** `prospect:read:own` | 200 |
| `PATCH /prospects/:id` | `prospect:write:any` **ou** `prospect:write:own` | 200 |
| `DELETE /prospects/:id` | `prospect:delete:any` | 200 |
| `POST /prospects/:id/status` | `prospect:write:any` **ou** `prospect:write:own` | 200 |
| `GET /prospects/:id/history` | `prospect:read:any` **ou** `prospect:read:own` | 200 |
| `POST /prospects/:id/convert` | `prospect:convert:any` | 200 |

#### `quotes/quotes.controller.ts`

| Route | Permission | Succes |
|---|---|---|
| `GET /quotes` | `quote:read:any` **ou** `quote:read:own` | 200 |
| `POST /quotes` | `quote:write:any` | 201 |
| `GET /quotes/:id` | `quote:read:any` **ou** `quote:read:own` | 200 |
| `PATCH /quotes/:id` | `quote:write:any` | 200 |
| `DELETE /quotes/:id` | `quote:delete:any` | 200 |
| `POST /quotes/:id/send` | `quote:send:any` | 201 |
| `POST /quotes/:id/view` | `quote:read:own` | 201 |
| `POST /quotes/:id/accept` | `quote:accept:own` **ou** `quote:write:any` | 201 |
| `POST /quotes/:id/refuse` | `quote:accept:own` **ou** `quote:write:any` | 201 |

#### `reports/reports.controller.ts`

| Route | Permission | Succes |
|---|---|---|
| `GET /reports` | `report:read:any` **ou** `report:read:own` | 200 |
| `POST /reports` | `report:generate:any` | 201 |
| `GET /reports/:id` | `report:read:any` **ou** `report:read:own` | 200 |

#### `roles/role.controller.ts`

| Route | Permission | Succes |
|---|---|---|
| `GET /roles` | `role:read:any` | 200 |
| `GET /roles/:code` | `role:read:any` | 200 |
| `PATCH /roles/:code/permissions` | `role:manage:any` | 200 |
| `GET /permissions` | `permission:read:any` | 200 |

#### `settings/settings.controller.ts`

| Route | Permission | Succes |
|---|---|---|
| `GET /settings` | `setting:read:any` | 200 |
| `PATCH /settings` | `setting:write:any` | 200 |

#### `tasks/tasks.controller.ts`

| Route | Permission | Succes |
|---|---|---|
| `GET /projects/:projectId/tasks` | `task:read:any` **ou** `task:read:assigned` **ou** `task:read:own` | 200 |
| `GET /projects/:projectId/tasks/creators` | `task:read:any` **ou** `task:read:assigned` **ou** `task:read:own` | 200 |
| `POST /projects/:projectId/tasks` | `task:write:any` **ou** `task:write:own` | 201 |
| `GET /me/tasks` | `task:read:any` **ou** `task:read:assigned` **ou** `task:read:own` | 200 |
| `GET /tasks/:id` | `task:read:any` **ou** `task:read:assigned` **ou** `task:read:own` | 200 |
| `PATCH /tasks/:id` | `task:write:any` **ou** `task:write:own` | 200 |
| `PATCH /tasks/:id/status` | `task:write:any` **ou** `task:write:own` | 200 |
| `PATCH /tasks/:id/assign` | `task:assign:any` | 200 |
| `DELETE /tasks/:id` | `task:delete:any` | 200 |

**Ce que porte une tache de la liste.** `id`, `title`, `projectId` et
`project: { id, name }`, `reporterId` et `reporter: { id, firstName, lastName,
avatarKey }` — le créateur —, `assigneeId` et `assignee` quand il y en a un, plus
le statut, la priorité, l'échéance et l'ordre. Le créateur d'une tâche est
TOUJOURS le porteur du jeton qui l'a créée : `reporterId` n'est pas un champ du
corps de `POST`, il est écrit depuis la session. `avatarKey` est la clé de
stockage de la photo (`null` s'il n'y en a pas) : l'interface affiche la photo
quand elle existe et retombe sur les initiales sinon.

**Le filtre « par personne »** s'applique avec `?reporterId=<id>` sur
`GET /projects/:projectId/tasks`. C'est un IDENTIFIANT de compte, jamais un nom :
deux homonymes ne se confondent pas, et un renommage ne déplace pas les tâches.
Le filtre est combiné en `AND` avec le projet et avec la portée du porteur : il ne
peut donc pas faire sortir la liste du projet interrogé, et un identifiant qui n'a
créé aucune tâche dans ce projet rend une liste vide (200), pas une erreur. Sans
`reporterId`, la liste contient les tâches du projet **quel que soit leur auteur**.

**`GET /projects/:projectId/tasks/creators`** rend les profils à afficher dans le
filtre, déjà restreints aux tâches que le porteur peut lire :
`[{ id, firstName, lastName, avatarKey, taskCount }]`, trié par nom. Un projet
sans tâche rend `[]`.

#### `time-entries/time-entries.controller.ts`

| Route | Permission | Succes |
|---|---|---|
| `GET /tasks/:taskId/time-entries` | `time:read:any` **ou** `time:read:own` | 200 |
| `POST /tasks/:taskId/time-entries` | `time:write:any` **ou** `time:write:own` | 201 |
| `GET /time-entries` | `time:read:any` **ou** `time:read:own` | 200 |
| `PATCH /time-entries/:id` | `time:write:any` **ou** `time:write:own` | 200 |
| `DELETE /time-entries/:id` | `time:write:any` **ou** `time:write:own` | 200 |

#### `integrations/integrations.controller.ts`

| Route | Permission | Succes |
|---|---|---|
| `POST /integrations/tokens` | `integration:manage:any` | 201 |
| `GET /integrations/tokens` | `integration:read:any` | 200 |
| `POST /integrations/tokens/:id/renew` | `integration:manage:any` | 200 |
| `POST /integrations/tokens/:id/revoke` | `integration:manage:any` | 200 |
| `DELETE /integrations/tokens/:id` | `integration:manage:any` | 200 |

**Le secret n'est rendu qu'une fois**, dans la reponse de `POST` et de `renew`
(champ `secret`). `GET` ne peut pas le rendre : il n'existe plus nulle part, la
base ne gardant que son empreinte (`tokenHash`, jamais selectionnee). Une liste
n'affiche donc que `name`, `prefix` (fragment de reconnaissance), `scopes`,
`lastUsedAt`, `expiresAt`, `revokedAt` et `active`.

**Aucun jeton ne peut gerer les integrations** : `integration:manage:any` est
refuse dans `scopes` (422 `INTEGRATION_SCOPE_FORBIDDEN`). C'est ce qui garantit
qu'une machine ne s'attribue jamais de droits elle-meme.

#### `users/user.controller.ts`

| Route | Permission | Succes |
|---|---|---|
| `GET /users` | `user:read:any` | 200 |
| `POST /users` | `user:manage:any` | 201 |
| `GET /users/:id` | `user:read:any` **ou** `user:read:own` | 200 |
| `PATCH /users/:id` | `user:write:any` | 200 |
| `DELETE /users/:id` | `user:manage:any` | 200 |
| `POST /users/:id/suspend` | `user:manage:any` | 200 |
| `POST /users/:id/reactivate` | `user:manage:any` | 200 |
| `POST /users/:id/roles` | `user:manage:any` | 200 |
| `POST /users/:id/reset-password` | `user:manage:any` | 200 |

---

## 11. Deux contrats detailles ailleurs

Deux sujets portent leur propre document, plus long que ce qu'un contrat general
doit contenir. Ils sont references ici **et** resumés : un lecteur de ce seul
fichier ne doit pas croire qu'ils n'existent pas.

### 11.1 `POST /contact-requests/:id/convert` — demande de contact vers prospect

| | |
|---|---|
| **Route** | `POST /contact-requests/:id/convert` |
| **Permission** | `contactrequest:convert:any` |
| **Codes qui la detiennent** | `ADMIN` (par `'ALL'`), `SALES`, `COMMUNICATION_MANAGER` |
| **Succes** | **200**, corps `{ prospect, contactRequest }` |
| **Controleur** | `src/modules/prospects/contact-request-conversion.controller.ts` |

**Le corps de la requete est vide** — la route ne lit rien de l'appelant, et
l'etat de la demande, sa reference, le responsable de la piste et la date de
conversion sont decides par le serveur. **Le corps de la reponse, lui, ne l'est
pas** : il porte la fiche creee (`prospect`, avec sa reference `PRO-`) *et* la
demande mise a jour (`contactRequest`, avec `convertedProspectId`), pour que
l'appelant n'ait pas a faire un second appel.

L'appel est monte sur `contact-requests` mais vit dans le module commercial : il
cree un prospect, et la regle « un prospect nait numerote, journalise et
attribue » appartient a ce module. C'est le precedent de `POST /quotes/:id/invoice`.

| HTTP | Code | Quand |
|---|---|---|
| 401 | `UNAUTHENTICATED` | Sans jeton, ou jeton illisible. |
| 403 | `FORBIDDEN` | Sans `contactrequest:convert:any` — dont le role `CLIENT`, qui ne detient aucun code `contactrequest:*`. Second verrou, sur le role : l'espace client est refuse par `assertInternalSpace` (`prospects/prospect-scope.ts`), meme si un code lui etait accorde un jour. |
| 404 | `CONTACT_REQUEST_NOT_FOUND` | Demande inconnue, **ou retiree de la file** (`deletedAt` non nul). Une demande que l'agence a ecartee ne produit pas de piste. |
| 409 | `CONTACT_REQUEST_ALREADY_CONVERTED` | La demande porte deja un `convertedProspectId`. Aucune fiche n'est creee : la garantie est un compare-and-swap (`updateMany` avec `convertedProspectId: null` dans le `where`), pas un `if` de pre-lecture. |
| 429 | `RATE_LIMITED` | Voir §6. |

**Cette route ne produit ni 422 ni 400.** Ses refus d'etat sont un 404 et un 409,
et rien d'autre : aucun `AppException.unprocessable` n'est leve sur ce chemin. Le
400 `VALIDATION_FAILED` qu'annonce `docs/api-contact-request.md` §4 n'est pas
davantage produisible, et pour une raison qu'il faut connaitre : la route ne
declare **aucun `@Body()`**, donc `ValidationPipe` ne voit jamais le corps de la
requete et `forbidNonWhitelisted` n'a rien a refuser. Un champ inattendu dans le
corps est **ignore**, pas rejete. Un `curl` avec un corps non vide le montre en un
appel.

Detail complet (transaction, champs de la reponse, audit) :
`docs/api-contact-request.md`.

### 11.2 `clientId` — rattacher un compte a un dossier client

Trois routes, et elles ne se lisent pas de la meme facon.

| Route | Champ | Permission |
|---|---|---|
| `POST /users` | `clientId?: string` — **facultatif** | `user:manage:any` |
| `PATCH /users/:id` | `clientId?: string \| null` — **trois etats** | `user:write:any` |
| `POST /users/:id/roles` | porte le second refus ci-dessous | `user:manage:any` |

Sur `PATCH`, la distinction « absent » / « `null` » **est** le contrat :

| Corps envoye | Effet |
|---|---|
| champ **absent** | Le rattachement n'est pas touche. |
| `"clientId": null` | Le rattachement est **retire**, sans lire le dossier. |
| `"clientId": "<id>"` | Le compte est rattache a ce dossier, apres trois verifications (il existe, il n'est pas supprime logiquement, le porteur peut le lire). |
| `"clientId": ""` | **400** `VALIDATION_FAILED` : une chaine vide n'est ni « absent » ni « null », c'est une faute de saisie. Le message nomme la valeur a utiliser pour detacher (`null`). |

Le champ n'existe que sur ces routes : `UpdateUserDto` ne porte **pas** de
`roleCodes`, et les roles se changent par `POST /users/:id/roles`. C'est ce qui
rend le second refus ci-dessous necessaire.

| HTTP | Code | Quand |
|---|---|---|
| 422 | `CLIENT_ROLE_REQUIRED` | Le compte ne porte pas le role `CLIENT`. Un `clientId` sur un compte sans ce role est l'etat **dangereux** : le porteur recevrait les notifications du dossier sans pouvoir en lire une ligne. L'inverse — un compte `CLIENT` sans dossier — est un etat de transition **legitime et inerte**. |
| 422 | `CLIENT_SCOPE_STILL_ATTACHED` | Sur `POST /users/:id/roles` : la nouvelle liste de roles **retire** `CLIENT` alors qu'un `clientId` est encore pose. Le refus ne detache pas en silence. Le chemin explicite est `PATCH /users/:id` avec `clientId: null`, **puis** le changement de roles — l'ordre compte. |
| 404 | `CLIENT_NOT_FOUND` | Le dossier n'existe pas, ou est supprime logiquement. |
| 403 | `FORBIDDEN` | Le porteur de la requete ne peut pas lire ce dossier (`clientPerimeter`). |
| 400 | `VALIDATION_FAILED` | Chaine vide, ou champ non declare dans le DTO (§5). |

`clientId` est rendu par `data.user` dans `POST /users`, `GET /users`,
`GET /users/:id`, `PATCH /users/:id` et `GET /auth/me`, et par la reponse de
`POST /auth/login`. Un appelant peut donc verifier un rattachement sans route
dediee.

Detail complet (les trois etats et leur raison d'etre, l'audit
`USER_CLIENT_SCOPE_CHANGED`) : `docs/api-user-client-scope.md`.


## Routes ajoutées après la veille e-mail (P1 → P3)

Le tableau ci-dessus date de l'inventaire « 165 routes ». Les ajouts suivants
sont en service et **doivent figurer dans tout contrôle d'accès** :

| Route | Permission(s) | Notes |
| --- | --- | --- |
| `POST /me/tasks` | `task:write:personal` | Tâche personnelle : sans projet, non visible client. |
| `GET /me/tasks` | `task:read:any` **ou** `task:read:assigned` **ou** `task:read:own` **ou** `task:read:personal` | `?personalOnly=true` restreint à l'espace personnel. |
| `GET /timer` | `time:write:own` **ou** `time:write:any` | Session active du porteur (ou `null`). |
| `POST /timer/start` | `time:write:own` **ou** `time:write:any` | `taskId` facultatif (temps sans tâche, non facturable). |
| `POST /timer/pause` `POST /timer/resume` `POST /timer/stop` | idem | 200 ; un second `start` concurrent → 409 `TIMER_ALREADY_ACTIVE`. |
| `GET /me/calendar/events` | `calendar:read:own` | Ses événements + ceux où il est invité. |
| `GET /calendar/events` | `calendar:read:team` | Événements PARTAGÉS uniquement. |
| `POST /me/calendar/events` `PATCH|DELETE /me/calendar/events/:id` | `calendar:write:own` | Proprietaire uniquement (un privé reste privé, admin compris). |
| `PUT /me/calendar/events/:id/participants` | `calendar:write:own` | Liste complète des invités (événements SHARED). |
| `GET /api/health` | publique | Sondage réel (`SELECT 1`) **et bloc `contract`** (poignée de main de version). |

Chaque réponse porte l'en-tête `X-Comexa-Contract` : voir `src/health/contract.ts`.
